import "../../../../scripts/load-env";

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { and, eq, inArray, like } from "drizzle-orm";

import { db, pgClient } from "../connection";
import { attachments, auditLogs, domesticOrders, quotes, users } from "../schema";
import {
  QUOTE_ATTACHMENT_IN_TRASH_MESSAGE,
  QUOTE_ATTACHMENT_REPLACED_REASON,
  QuoteAttachmentRejectedError,
  createAttachmentRecord,
  type CreateAttachmentRecordInput,
  type QuoteAttachmentRejectionCode,
} from "./attachments";
import {
  QUOTE_ATTACHMENT_SLOT_OCCUPIED_MESSAGE,
  QUOTE_DELETED_ATTACHMENT_REASON,
  restoreAttachment,
  softDeleteAttachment,
} from "./attachment-trash";
import { createQuote, updateQuote } from "./quotes";
import { permanentlyDeleteQuote, restoreQuote, softDeleteQuote } from "./quote-trash";
import { purgeExpiredQuote } from "./master-data-purge";
import { createDomesticOrder } from "./domestic-orders";
import { getAttachmentForDownload } from "../queries/attachment-download";
import {
  getQuoteAttachmentUploadTarget,
  listLiveQuoteAttachments,
  listQuoteAttachmentSlots,
} from "../queries/attachments";
import { getQuoteForEdit, listQuotes, listQuotesForRepairCase } from "../queries/quotes";
import { listDomesticOrders } from "../queries/domestic-orders";
import { decideQuoteDownloadSource } from "@/app/api/quotes/[id]/xlsx/download-source";
import { MAX_ATTACHMENT_SIZE_BYTES, isExtensionAllowedForCategory } from "@/lib/domain/attachment-allowlist";
import { isAttachmentCategoryAllowedForOwner, type AttachmentCategory } from "@/lib/domain/attachment-category";
import {
  buildAttachmentStoredPath,
  buildQuoteAttachmentStoredPath,
  resolveAttachmentAbsolutePath,
} from "@/lib/domain/attachment-path";
import { decideAttachmentDownload, isAttachmentOwnerAccessAllowed } from "@/lib/domain/attachment-download-policy";
import { MASTER_DATA_TRASH_RETENTION_DAYS } from "@/lib/domain/master-data-trash-retention";
import { validateQuoteFields, type QuoteFields } from "@/lib/validation/quote-input";
import type { DomesticOrderFields } from "@/lib/validation/domestic-order-input";
import { createLocalFileSystemStorageAdapter } from "@/lib/storage/local-fs-adapter";
import type { StorageAdapter } from "@/lib/storage/storage-adapter";

/**
 * ============================================================================
 * 견적서 첨부 · 엑셀 전용 견적서 — 서버 쪽 전부 (2026-09-15 Q2)
 * ============================================================================
 * 확인하는 것:
 *  1. **기록** — 넷째 주인 칸(quote_id 만 차고 앞의 셋은 NULL) · 분류 · 경로 모양
 *     (`quotes/{견적서id}/{첨부id}.{확장자}`) · FILE_UPLOAD 감사의 주인.
 *  2. **분류 · 확장자** — 견적서에는 두 칸만, 두 칸은 견적서에만 · PDF 칸은 pdf, 엑셀 칸은
 *     xlsx · xls(라우트가 부르는 순수 함수 그대로).
 *  3. **칸 교체** — 같은 칸에 다시 올리면 옛 파일이 첨부 휴지통으로(고정 사유 · FILE_DELETE).
 *     🔴 동시에 올려도 칸마다 살아 있는 파일은 하나다(견적서 행 잠금).
 *  4. **휴지통 견적서** — 올리기 거절(QUOTE_IN_TRASH) · 내려받기 거절(판정 함수 수준) ·
 *     첨부 되살리기 거절.
 *  5. **견적서 휴지통 ↔ 첨부 휴지통** — 보내면 살아 있는 첨부가 함께, 되살리면 **함께 간
 *     것만** 돌아온다(칸 교체로 간 옛 파일 · 사람이 따로 지운 파일은 남는다).
 *  6. **영구 삭제 · 15일 정리** — PURGE 스냅숏에 붙었던 첨부 id, 첨부 행 · 실물은 남고
 *     연결만 풀린다.
 *  7. **엑셀 전용 저장** — 줄이 있으면 거절 · 금액 필수 · 일반 견적서에 수기 금액 거절.
 *  8. **금액 한 곳** — 목록 · 수리 건 탭 · 내자 정리 연결 금액 · PURGE 스냅숏이 수기 공급가액.
 *  9. **조회** — 수정 화면의 칸별 파일 · 목록의 hasSignedPdf/hasExcel · 받기의 파일 고르기.
 *
 * ── 라우트를 직접 부르지 않는다 ─────────────────────────────────────────
 * 이 저장소의 관례대로(개선 요청 첨부 시험 헤더) 라우트가 부르는 함수를 그대로 부른다 —
 * 판정(isAttachmentOwnerAccessAllowed · decideAttachmentDownload · decideQuoteDownloadSource)
 * 과 저장(createAttachmentRecord · softDeleteAttachment …)은 라우트 · 액션과 같은 함수다.
 * 권한 표(quotes READ / WRITE)는 단위 시험(attachment-download-policy.test.ts)이 본다.
 *
 * ── 디스크는 임시 폴더에 쓴다 ────────────────────────────────────────────
 * 실제 저장 루트를 건드리지 않는다. 대부분의 시험은 행만 본다 — createAttachmentRecord 는
 * 파일을 쓰지 않고 경로의 모양만 본다.
 *
 * ── 격리 규약 ────────────────────────────────────────────────────────────
 * 이 스위트가 만드는 견적서는 발행번호 `QUOTE-ATTACH-TEST-{토큰}-`, 내자 줄은 발주서번호
 * `QA-ATTACH-TEST-{토큰}-` 로 시작한다(실행마다 다른 토큰). after() 는 내자 줄 → 이 스위트가
 * 만든 첨부(id) → 견적서(접두어) 순으로 지운다. 감사 로그는 견적서 쪽만 (엔티티, 대상 id)
 * 쌍으로 지운다(quote-trash 시험과 같다 — 3년 보존 대상이다). 첨부의 감사 로그는 지우지
 * 않는다 — 첨부 시험들과 같은 규칙이다. 15일을 기다리는 대신 이 스위트가 만든 견적서의
 * deleted_at 만 과거로 돌린다.
 * ============================================================================
 */

const RUN_TOKEN = randomUUID();
const QUOTE_NUMBER_PREFIX = `QUOTE-ATTACH-TEST-${RUN_TOKEN}-`;
const PO_PREFIX = `QA-ATTACH-TEST-${RUN_TOKEN}-`;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** PDF · xlsx 앞머리 — 내용 대조를 흉내 낼 필요는 없지만 디스크에 놓는 파일에 그럴듯한 바이트를 둔다. */
const PDF_BYTES = new TextEncoder().encode("%PDF-1.4\n% 결재 견적서 시험\n");

const MIME_BY_EXTENSION: Record<string, string> = {
  pdf: "application/pdf",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xls: "application/vnd.ms-excel",
};

let actorUserId: string;
let storageRoot: string;
let storage: StorageAdapter;
const touchedQuoteIds: string[] = [];
const createdAttachmentIds: string[] = [];

type QuoteRef = { id: string; version: number };

function quoteFields(suffix: string, overrides: Partial<QuoteFields> = {}): QuoteFields {
  return {
    quoteNumber: `${QUOTE_NUMBER_PREFIX}${suffix}`,
    kind: "DOMESTIC",
    quoteDate: "2096-05-10",
    repairCaseId: null,
    intakeNumberText: null,
    customerId: null,
    customerNameText: "시험 공급처",
    modelNameText: null,
    lotNumberText: null,
    serialNumberText: null,
    faultDescriptionText: null,
    subject: "시험 견적",
    validity: null,
    delivery: null,
    payment: null,
    workCost: "0",
    laborEquipmentKind: null,
    laborBaseCost: null,
    investigationExcluded: false,
    powerTestExcluded: false,
    laborPowerTestDeduction: null,
    documentExcluded: false,
    isExcelOnly: false,
    manualSupplyAmount: null,
    repairTasks: [],
    workScopeLines: [],
    items: [],
    ...overrides,
  };
}

/** 품목 없이 손으로 적은 공급가액만 있는 엑셀 전용 견적서의 입력. */
function excelOnlyFields(suffix: string, overrides: Partial<QuoteFields> = {}): QuoteFields {
  return quoteFields(suffix, { isExcelOnly: true, manualSupplyAmount: "3456789.50", ...overrides });
}

async function createTestQuote(fields: QuoteFields): Promise<QuoteRef> {
  const result = await createQuote({ fields, actorUserId });
  assert.equal(result.ok, true, `setup create quote failed: ${JSON.stringify(result)}`);
  if (!result.ok) throw new Error("unreachable");
  touchedQuoteIds.push(result.id);
  return { id: result.id, version: result.version };
}

async function readQuote(id: string) {
  const [row] = await db.select().from(quotes).where(eq(quotes.id, id));
  return row;
}

/** 견적서 첨부 한 파일의 입력. 파일은 쓰지 않는다 — 경로 모양만 규칙대로 만든다. */
function quoteFileInput(
  quoteId: string,
  category: AttachmentCategory,
  options: { extension?: string; fileName?: string } = {}
): CreateAttachmentRecordInput {
  const attachmentId = randomUUID().toLowerCase();
  createdAttachmentIds.push(attachmentId);
  const extension = options.extension ?? (category === "QUOTE_EXCEL" ? "xlsx" : "pdf");
  return {
    id: attachmentId,
    owner: { kind: "QUOTE", quoteId },
    category,
    originalFileName: options.fileName ?? `견적서.${extension}`,
    storedPath: buildQuoteAttachmentStoredPath({ quoteId, attachmentId, extension }),
    mimeType: MIME_BY_EXTENSION[extension] ?? "application/octet-stream",
    fileSize: 1234,
    checksumSha256: "0".repeat(64),
    description: null,
    uploadedBy: actorUserId,
  };
}

async function addFile(
  quoteId: string,
  category: "SIGNED_QUOTE_PDF" | "QUOTE_EXCEL",
  options: Parameters<typeof quoteFileInput>[2] = {}
): Promise<string> {
  const created = await createAttachmentRecord(quoteFileInput(quoteId, category, options));
  // 올린 차례(uploaded_at)로 가르는 단언이 있다 — 같은 순간에 찍히지 않게 한 틈을 둔다.
  await new Promise((resolve) => setTimeout(resolve, 5));
  return created.id;
}

async function expectRejected(run: () => Promise<unknown>, code: QuoteAttachmentRejectionCode): Promise<void> {
  await assert.rejects(run, (error: unknown) => {
    assert.ok(error instanceof QuoteAttachmentRejectedError, `다른 오류로 실패했다: ${String(error)}`);
    assert.equal(error.code, code);
    return true;
  });
}

async function readAttachment(attachmentId: string) {
  const [row] = await db.select().from(attachments).where(eq(attachments.id, attachmentId));
  return row;
}

async function liveInSlot(quoteId: string, category: AttachmentCategory): Promise<string[]> {
  const rows = await db
    .select({ id: attachments.id })
    .from(attachments)
    .where(and(eq(attachments.quoteId, quoteId), eq(attachments.category, category), eq(attachments.isDeleted, false)));
  return rows.map((row) => row.id);
}

async function attachmentAudits(attachmentId: string, actionType: "FILE_UPLOAD" | "FILE_DELETE" | "RESTORE") {
  return db
    .select({ actorUserId: auditLogs.actorUserId, previousValue: auditLogs.previousValue, newValue: auditLogs.newValue })
    .from(auditLogs)
    .where(
      and(
        eq(auditLogs.targetEntity, "attachments"),
        eq(auditLogs.targetRecordId, attachmentId),
        eq(auditLogs.actionType, actionType)
      )
    );
}

async function quoteAudit(quoteId: string, actionType: "SOFT_DELETE" | "RESTORE" | "PURGE") {
  const rows = await db
    .select({ actorUserId: auditLogs.actorUserId, previousValue: auditLogs.previousValue, newValue: auditLogs.newValue })
    .from(auditLogs)
    .where(
      and(eq(auditLogs.targetEntity, "quotes"), eq(auditLogs.targetRecordId, quoteId), eq(auditLogs.actionType, actionType))
    );
  assert.equal(rows.length, 1, `${actionType} 감사가 정확히 한 줄이어야 한다`);
  return rows[0];
}

/** 휴지통으로 보내고, 보낸 뒤의 version 을 돌려준다. */
async function trashQuote(id: string): Promise<number> {
  const current = await readQuote(id);
  const result = await softDeleteQuote({ quoteId: id, expectedVersion: current.version, actorUserId, reason: "시험" });
  assert.equal(result.ok, true, `soft delete failed: ${JSON.stringify(result)}`);
  return (await readQuote(id)).version;
}

async function existsOnDisk(absolutePath: string): Promise<boolean> {
  try {
    return (await stat(absolutePath)).isFile();
  } catch {
    return false;
  }
}

function streamOf(bytes: Uint8Array): ReadableStream<Uint8Array> {
  let sent = false;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent) {
        controller.close();
        return;
      }
      controller.enqueue(bytes);
      sent = true;
    },
  });
}

function domesticFields(suffix: string, overrides: Partial<DomesticOrderFields> = {}): DomesticOrderFields {
  return {
    repairCaseId: null,
    quoteId: null,
    intakeNumberText: null,
    customerId: null,
    modelNameText: null,
    lotNumberText: null,
    serialNumberText: null,
    faultDescriptionText: null,
    displayOrder: null,
    purchaseOrderNumber: `${PO_PREFIX}${suffix}`,
    projectName: null,
    orderIssuedDate: null,
    dueDates: [],
    quoteIssuedDate: null,
    quoteNumber: null,
    progressNote: null,
    deliveredDate: null,
    deliveredBy: null,
    taxInvoiceDate: null,
    amountExcludingVat: null,
    paymentCompleted: false,
    japanRemittanceNote: null,
    historyNote: null,
    etcNote: null,
    ...overrides,
  };
}

before(async () => {
  const [anyone] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.approvalStatus, "APPROVED"), eq(users.isDeleted, false)))
    .limit(1);
  // 행위자는 uploaded_by · deleted_by · created_by · 감사 로그의 actor 로만 쓰인다.
  // 역할 판정은 여기서 하지 않는다(서버 액션 · 라우트의 몫).
  assert.ok(anyone, "expected at least one approved user in the test DB");
  actorUserId = anyone.id;

  storageRoot = await mkdtemp(path.join(tmpdir(), "dss-quote-attach-test-"));
  storage = createLocalFileSystemStorageAdapter(storageRoot);
});

after(async () => {
  await db.delete(domesticOrders).where(like(domesticOrders.purchaseOrderNumber, `${PO_PREFIX}%`));
  if (createdAttachmentIds.length > 0) {
    await db.delete(attachments).where(inArray(attachments.id, createdAttachmentIds));
  }
  if (touchedQuoteIds.length > 0) {
    await db
      .delete(auditLogs)
      .where(and(eq(auditLogs.targetEntity, "quotes"), inArray(auditLogs.targetRecordId, touchedQuoteIds)));
  }
  await db.delete(quotes).where(like(quotes.quoteNumber, `${QUOTE_NUMBER_PREFIX}%`));
  if (storageRoot) {
    await rm(storageRoot, { recursive: true, force: true });
  }
  await pgClient.end({ timeout: 5 });
});

// ─────────────────────────────────────────────────── 1 · 2. 기록 · 분류 · 확장자

describe("올리기 — 견적서가 넷째 주인", () => {
  test("결재 PDF 를 붙이면 주인 칸 · 분류 · 경로 모양이 맞고 FILE_UPLOAD 감사가 남는다", async () => {
    const quote = await createTestQuote(quoteFields("UPLOAD"));

    // 라우트와 같은 순서 — 임시 저장 → 최종 자리 → 그 다음에 행.
    const written = await storage.writeTemp(streamOf(PDF_BYTES), { maxBytes: MAX_ATTACHMENT_SIZE_BYTES });
    const input = quoteFileInput(quote.id, "SIGNED_QUOTE_PDF", { fileName: "결재본.pdf" });
    await storage.commit(written.tempPath, input.storedPath);
    const created = await createAttachmentRecord({ ...input, fileSize: written.size, checksumSha256: written.sha256 });

    assert.deepEqual(created.displacedAttachmentIds, [], "빈 칸에 처음 올리면 밀려나는 것이 없다");
    const row = await readAttachment(created.id);
    assert.equal(row.quoteId, quote.id);
    // 🔴 주인이 아닌 세 칸은 NULL — 여기에 값이 들어가면 사는 폴더가 정해지지 않는다.
    assert.equal(row.repairCaseId, null);
    assert.equal(row.productModelId, null);
    assert.equal(row.improvementRequestId, null);
    assert.equal(row.category, "SIGNED_QUOTE_PDF");
    assert.equal(row.storedPath, `quotes/${quote.id}/${created.id}.pdf`);
    assert.equal(row.mimeType, "application/pdf");
    assert.equal(row.isDeleted, false);
    assert.equal(await existsOnDisk(resolveAttachmentAbsolutePath(storageRoot, row.storedPath)), true);

    const [audit] = await attachmentAudits(created.id, "FILE_UPLOAD");
    const newValue = audit.newValue as Record<string, unknown>;
    assert.equal(newValue.ownerType, "QUOTE");
    assert.equal(newValue.quoteId, quote.id);
    assert.equal("repairCaseId" in newValue, false, "주인이 아닌 쪽 키는 싣지 않는다");
    assert.equal(newValue.category, "SIGNED_QUOTE_PDF");
    assert.deepEqual(newValue.displacedAttachmentIds, []);
    assert.equal(audit.actorUserId, actorUserId);

    // 올리기 통로의 빠른 거절 — 대상 조회.
    assert.deepEqual(await getQuoteAttachmentUploadTarget(quote.id), { id: quote.id, isDeleted: false });
    assert.equal(await getQuoteAttachmentUploadTarget(randomUUID()), null);
    assert.equal(await getQuoteAttachmentUploadTarget("not-a-uuid"), null);
  });

  test("분류와 주인의 짝 — 견적서에 다른 분류도, 다른 주인에 견적서 칸도 행을 넣기 전에 거절한다", async () => {
    const quote = await createTestQuote(quoteFields("CATEGORY"));
    const attempts: CreateAttachmentRecordInput[] = [
      // 견적서에는 두 칸만 — 수리 건 파일 탭의 「견적서」(QUOTE) 분류도 아니다.
      { ...quoteFileInput(quote.id, "SIGNED_QUOTE_PDF"), category: "QUOTE" },
      { ...quoteFileInput(quote.id, "SIGNED_QUOTE_PDF"), category: "INTAKE_PHOTO" },
      // 두 칸은 견적서에만.
      {
        ...quoteFileInput(quote.id, "SIGNED_QUOTE_PDF"),
        owner: { kind: "REPAIR_CASE", repairCaseId: randomUUID().toLowerCase() },
        storedPath: buildAttachmentStoredPath({
          repairCaseId: randomUUID().toLowerCase(),
          attachmentId: randomUUID().toLowerCase(),
          extension: "pdf",
        }),
      },
    ];
    for (const attempt of attempts) {
      await assert.rejects(() => createAttachmentRecord(attempt), /분류는 이 주인/, `${attempt.owner.kind}/${attempt.category}`);
      assert.equal(await readAttachment(attempt.id), undefined);
    }
    // 올리기 통로의 400 도 같은 순수 함수다.
    assert.equal(isAttachmentCategoryAllowedForOwner("SIGNED_QUOTE_PDF", "QUOTE"), true);
    assert.equal(isAttachmentCategoryAllowedForOwner("QUOTE_EXCEL", "QUOTE"), true);
    assert.equal(isAttachmentCategoryAllowedForOwner("QUOTE", "QUOTE"), false);
    assert.equal(isAttachmentCategoryAllowedForOwner("QUOTE_EXCEL", "REPAIR_CASE"), false);
  });

  test("확장자 — 결재 PDF 칸은 pdf 만, 엑셀 칸은 xlsx · xls 만(올리기 통로의 415)", () => {
    assert.equal(isExtensionAllowedForCategory("pdf", "SIGNED_QUOTE_PDF"), true);
    for (const extension of ["jpg", "png", "xlsx", "docx"]) {
      assert.equal(isExtensionAllowedForCategory(extension, "SIGNED_QUOTE_PDF"), false, extension);
    }
    assert.equal(isExtensionAllowedForCategory("xlsx", "QUOTE_EXCEL"), true);
    assert.equal(isExtensionAllowedForCategory("xls", "QUOTE_EXCEL"), true);
    for (const extension of ["pdf", "csv", "zip", "jpg"]) {
      assert.equal(isExtensionAllowedForCategory(extension, "QUOTE_EXCEL"), false, extension);
    }
  });

  test("없는 견적서면 NOT_FOUND, 🔴 휴지통 견적서면 QUOTE_IN_TRASH — 잠금에서 걸려 행도 감사도 남지 않는다", async () => {
    await expectRejected(() => addFile(randomUUID().toLowerCase(), "SIGNED_QUOTE_PDF"), "NOT_FOUND");

    const quote = await createTestQuote(quoteFields("UPLOAD-TRASHED"));
    await trashQuote(quote.id);
    assert.deepEqual(await getQuoteAttachmentUploadTarget(quote.id), { id: quote.id, isDeleted: true });

    const input = quoteFileInput(quote.id, "QUOTE_EXCEL");
    await assert.rejects(
      () => createAttachmentRecord(input),
      (error: unknown) => {
        assert.ok(error instanceof QuoteAttachmentRejectedError);
        assert.equal(error.code, "QUOTE_IN_TRASH");
        assert.equal(error.message, QUOTE_ATTACHMENT_IN_TRASH_MESSAGE);
        return true;
      }
    );
    assert.equal(await readAttachment(input.id), undefined);
    assert.equal((await attachmentAudits(input.id, "FILE_UPLOAD")).length, 0);
  });
});

// ─────────────────────────────────────────────────── 3. 칸 교체

describe("칸 교체 — 칸마다 한 파일, 새 파일이 옛 파일을 첨부 휴지통으로", () => {
  test("같은 칸에 다시 올리면 옛 파일이 휴지통으로(고정 사유 · FILE_DELETE) — 다른 칸은 그대로", async () => {
    const quote = await createTestQuote(quoteFields("REPLACE"));
    const oldPdf = await addFile(quote.id, "SIGNED_QUOTE_PDF");
    const excel = await addFile(quote.id, "QUOTE_EXCEL");

    const replacement = await createAttachmentRecord(quoteFileInput(quote.id, "SIGNED_QUOTE_PDF"));
    assert.deepEqual(replacement.displacedAttachmentIds, [oldPdf]);

    const old = await readAttachment(oldPdf);
    assert.equal(old.isDeleted, true);
    assert.equal(old.deleteReason, QUOTE_ATTACHMENT_REPLACED_REASON);
    assert.equal(old.deletedBy, actorUserId);
    assert.equal(old.quoteId, quote.id, "휴지통으로 가도 주인 칸은 그대로다");

    const [deleteAudit] = await attachmentAudits(oldPdf, "FILE_DELETE");
    const deleteValue = deleteAudit.newValue as Record<string, unknown>;
    assert.equal(deleteValue.ownerType, "QUOTE");
    assert.equal(deleteValue.quoteId, quote.id);
    assert.equal(deleteValue.deleteReason, QUOTE_ATTACHMENT_REPLACED_REASON);
    assert.equal(deleteValue.replacedByAttachmentId, replacement.id);
    assert.equal(deleteValue.storedFileRetained, true);
    const [uploadAudit] = await attachmentAudits(replacement.id, "FILE_UPLOAD");
    assert.deepEqual((uploadAudit.newValue as Record<string, unknown>).displacedAttachmentIds, [oldPdf]);

    assert.deepEqual(await liveInSlot(quote.id, "SIGNED_QUOTE_PDF"), [replacement.id]);
    assert.deepEqual(await liveInSlot(quote.id, "QUOTE_EXCEL"), [excel], "다른 칸의 파일은 밀려나지 않는다");
  });

  test("🔴 같은 칸에 동시에 올려도 살아 남는 파일은 하나다 — 견적서 행을 잠근 트랜잭션에서 바꾼다", async () => {
    const quote = await createTestQuote(quoteFields("REPLACE-RACE"));
    const inputs = Array.from({ length: 6 }, (_, index) =>
      quoteFileInput(quote.id, "QUOTE_EXCEL", { fileName: `동시-${index}.xlsx` })
    );

    const results = await Promise.allSettled(inputs.map((input) => createAttachmentRecord(input)));
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 6, "교체라 거절이 없다");

    const live = await liveInSlot(quote.id, "QUOTE_EXCEL");
    assert.equal(live.length, 1, "칸마다 살아 있는 파일은 하나여야 한다");
    const trashedRows = await db
      .select({ id: attachments.id, deleteReason: attachments.deleteReason })
      .from(attachments)
      .where(and(eq(attachments.quoteId, quote.id), eq(attachments.isDeleted, true)));
    assert.equal(trashedRows.length, 5);
    for (const row of trashedRows) assert.equal(row.deleteReason, QUOTE_ATTACHMENT_REPLACED_REASON);
  });
});

// ─────────────────────────────────────────────────── 9. 조회 — 칸 · 받기의 파일 고르기

describe("조회 — 수정 화면의 칸별 파일 · 받기의 파일 고르기", () => {
  test("칸마다 지금 붙어 있는 파일(이름 · 크기 · 올린 때 · 올린 사람) — 교체로 간 옛 파일은 보이지 않는다", async () => {
    const quote = await createTestQuote(quoteFields("SLOTS"));
    assert.deepEqual(await listQuoteAttachmentSlots(quote.id), { SIGNED_QUOTE_PDF: null, QUOTE_EXCEL: null });

    await addFile(quote.id, "SIGNED_QUOTE_PDF", { fileName: "옛 결재본.pdf" });
    const pdf = await addFile(quote.id, "SIGNED_QUOTE_PDF", { fileName: "새 결재본.pdf" });
    const excel = await addFile(quote.id, "QUOTE_EXCEL", { fileName: "수기 견적서.xls", extension: "xls" });

    const slots = await listQuoteAttachmentSlots(quote.id);
    assert.equal(slots.SIGNED_QUOTE_PDF?.id, pdf);
    assert.equal(slots.SIGNED_QUOTE_PDF?.originalFileName, "새 결재본.pdf");
    assert.equal(slots.SIGNED_QUOTE_PDF?.fileSize, 1234);
    assert.equal(slots.QUOTE_EXCEL?.id, excel);
    for (const file of [slots.SIGNED_QUOTE_PDF, slots.QUOTE_EXCEL]) {
      assert.ok(file);
      assert.equal(new Date(file.uploadedAt).toISOString(), file.uploadedAt, "올린 시각은 ISO 문자열이다");
      assert.ok(file.uploadedByName.length > 0, "올린 사람 이름이 실린다");
      assert.equal("storedPath" in file, false, "내부 경로는 싣지 않는다");
    }
    assert.equal(await listQuoteAttachmentSlots("not-a-uuid").then((value) => value.QUOTE_EXCEL), null);
  });

  test("받기의 파일 고르기 — 엑셀 전용이면 엑셀 칸의 파일(확장자 그대로), 일반 견적서는 앱 양식", async () => {
    const excelOnly = await createTestQuote(excelOnlyFields("DOWNLOAD-SOURCE"));
    // 붙인 엑셀이 없으면 받기가 404 로 끝난다.
    assert.deepEqual(decideQuoteDownloadSource({ isExcelOnly: true }, await listLiveQuoteAttachments(excelOnly.id)), {
      kind: "MISSING_EXCEL",
    });

    await addFile(excelOnly.id, "SIGNED_QUOTE_PDF");
    const excel = await addFile(excelOnly.id, "QUOTE_EXCEL", { extension: "xls" });
    const source = decideQuoteDownloadSource(
      { isExcelOnly: (await getQuoteForEdit(excelOnly.id))?.isExcelOnly ?? false },
      await listLiveQuoteAttachments(excelOnly.id)
    );
    assert.equal(source.kind, "ATTACHED_EXCEL");
    if (source.kind === "ATTACHED_EXCEL") {
      assert.equal(source.attachment.id, excel);
      assert.equal(source.extension, "xls");
      // 받기 통로가 내보내기 전에 거치는 판정 — 살아 있는 견적서의 살아 있는 파일은 통과한다.
      assert.equal(
        decideAttachmentDownload({
          repairCaseId: null,
          productModelId: null,
          improvementRequestId: null,
          quoteId: excelOnly.id,
          isDeleted: source.attachment.isDeleted,
          quoteInTrash: false,
          malwareScanStatus: source.attachment.malwareScanStatus,
        }).allowed,
        true
      );
    }

    const regular = await createTestQuote(quoteFields("DOWNLOAD-REGULAR"));
    await addFile(regular.id, "QUOTE_EXCEL");
    assert.deepEqual(
      decideQuoteDownloadSource(
        { isExcelOnly: (await getQuoteForEdit(regular.id))?.isExcelOnly ?? true },
        await listLiveQuoteAttachments(regular.id)
      ),
      { kind: "TEMPLATE" },
      "🔴 일반 견적서는 엑셀이 붙어 있어도 예전 그대로 앱 양식이다"
    );
  });
});

// ─────────────────────────────────────────────────── 첨부 지우기 · 되살리기 · 내려받기

describe("첨부 지우기 · 되살리기 — 견적서 행을 잠근다", () => {
  test("지운 결재 PDF 는 되살아난다 — 그 칸이 비어 있을 때만(SLOT_OCCUPIED)", async () => {
    const quote = await createTestQuote(quoteFields("TRASH-RESTORE"));
    const first = await addFile(quote.id, "SIGNED_QUOTE_PDF");

    const removed = await softDeleteAttachment({ attachmentId: first, actorUserId, reason: "잘못 붙임" });
    assert.equal(removed.ok, true, JSON.stringify(removed));
    const [deleteAudit] = await attachmentAudits(first, "FILE_DELETE");
    const deleteValue = deleteAudit.newValue as Record<string, unknown>;
    assert.equal(deleteValue.ownerType, "QUOTE");
    assert.equal(deleteValue.quoteId, quote.id);
    assert.equal(deleteValue.quoteNumber, `${QUOTE_NUMBER_PREFIX}TRASH-RESTORE`, "사람이 읽는 발행번호도 싣는다");

    const restored = await restoreAttachment({ attachmentId: first, actorUserId });
    assert.equal(restored.ok, true, JSON.stringify(restored));
    assert.equal((await readAttachment(first)).isDeleted, false);

    // 새 파일로 바꾼 뒤 옛 파일을 되살리려 하면 — 칸마다 하나라 거절한다.
    const second = await addFile(quote.id, "SIGNED_QUOTE_PDF");
    const refused = await restoreAttachment({ attachmentId: first, actorUserId });
    assert.equal(refused.ok === false && refused.code, "SLOT_OCCUPIED");
    assert.equal(refused.ok === false && refused.message, QUOTE_ATTACHMENT_SLOT_OCCUPIED_MESSAGE);
    assert.equal((await readAttachment(first)).isDeleted, true, "거절된 되살리기는 표시를 바꾸지 않는다");
    assert.deepEqual(await liveInSlot(quote.id, "SIGNED_QUOTE_PDF"), [second]);

    // 대조 — 지금 파일을 지우면 자리가 나서 되살아난다(막힌 이유가 칸이었다).
    await softDeleteAttachment({ attachmentId: second, actorUserId, reason: null });
    const nowRestored = await restoreAttachment({ attachmentId: first, actorUserId });
    assert.equal(nowRestored.ok, true, JSON.stringify(nowRestored));
  });

  test("휴지통 견적서의 파일은 따로 되살리지 못한다 — QUOTE_IN_TRASH", async () => {
    const quote = await createTestQuote(quoteFields("TRASHED-OWNER"));
    const file = await addFile(quote.id, "QUOTE_EXCEL");
    await trashQuote(quote.id);

    const refused = await restoreAttachment({ attachmentId: file, actorUserId });
    assert.equal(refused.ok === false && refused.code, "QUOTE_IN_TRASH");
    assert.equal((await readAttachment(file)).isDeleted, true);
  });
});

describe("내려받기 — 조회 · 판정 · 보기 권한", () => {
  test("조회가 견적서 주인을 싣고 판정이 통과시킨다 — 보기 권한은 견적서 칸만 본다(라우트는 404)", async () => {
    const quote = await createTestQuote(quoteFields("DOWNLOAD"));
    const found = await getAttachmentForDownload(await addFile(quote.id, "SIGNED_QUOTE_PDF"));
    assert.ok(found);
    assert.equal(found.quoteId, quote.id);
    assert.equal(found.quoteInTrash, false);
    assert.equal(found.repairCaseId, null);
    assert.equal(decideAttachmentDownload(found).allowed, true, "견적서 주인은 주인 없음(DETACHED)이 아니다");

    assert.equal(
      isAttachmentOwnerAccessAllowed(found, { REPAIR_CASE: false, PRODUCT_MODEL: false, IMPROVEMENT_REQUEST: false, QUOTE: true }),
      true
    );
    assert.equal(
      isAttachmentOwnerAccessAllowed(found, { REPAIR_CASE: true, PRODUCT_MODEL: true, IMPROVEMENT_REQUEST: true, QUOTE: false }),
      false,
      "🔴 다른 주인의 파일 권한으로 견적서 파일이 열리면 안 된다"
    );
  });

  test("🔴 휴지통 견적서의 파일은 내려받기 거절 — 파일 표시가 어긋나 있어도 주인의 휴지통을 본다", async () => {
    const quote = await createTestQuote(quoteFields("DOWNLOAD-TRASHED"));
    const file = await addFile(quote.id, "QUOTE_EXCEL");
    await trashQuote(quote.id);

    const trashed = await getAttachmentForDownload(file);
    assert.ok(trashed);
    assert.equal(trashed.quoteInTrash, true);
    assert.equal(trashed.isDeleted, true, "견적서와 함께 첨부 휴지통으로 갔다");
    const decision = decideAttachmentDownload(trashed);
    assert.equal(decision.allowed === false && decision.reason, "QUOTE_IN_TRASH");

    // 파일 표시만 살아 있는 어긋난 행(이 스위트가 만든 행만 손으로 바꾼다) — 그래도 새지 않는다.
    await db.update(attachments).set({ isDeleted: false, deletedAt: null, deletedBy: null, deleteReason: null }).where(eq(attachments.id, file));
    const skewed = await getAttachmentForDownload(file);
    assert.ok(skewed);
    const skewedDecision = decideAttachmentDownload(skewed);
    assert.equal(skewedDecision.allowed === false && skewedDecision.reason, "QUOTE_IN_TRASH");
  });
});

// ─────────────────────────────────────────────────── 5. 견적서 휴지통 ↔ 첨부 휴지통

describe("견적서 휴지통 ↔ 첨부 휴지통 — 같은 트랜잭션", () => {
  test("🔴 보내면 살아 있는 첨부가 함께 가고, 되살리면 **함께 간 것만** 돌아온다", async () => {
    const quote = await createTestQuote(quoteFields("CASCADE"));
    const replacedPdf = await addFile(quote.id, "SIGNED_QUOTE_PDF");
    const pdf = await addFile(quote.id, "SIGNED_QUOTE_PDF"); // replacedPdf 는 교체로 휴지통
    const manualExcel = await addFile(quote.id, "QUOTE_EXCEL");
    // 사람이 따로 지운 파일 — 사유 글자를 일부러 고정 문구와 똑같이 적는다. 삭제 시각이
    // 달라서 되살리기가 가려낸다(attachment-trash.ts 의 QUOTE_DELETED_ATTACHMENT_REASON 주석).
    await softDeleteAttachment({ attachmentId: manualExcel, actorUserId, reason: QUOTE_DELETED_ATTACHMENT_REASON });
    await new Promise((resolve) => setTimeout(resolve, 5));
    const excel = await addFile(quote.id, "QUOTE_EXCEL");

    await trashQuote(quote.id);
    const quoteRow = await readQuote(quote.id);
    assert.ok(quoteRow.deletedAt);

    for (const id of [pdf, excel]) {
      const row = await readAttachment(id);
      assert.equal(row.isDeleted, true, "살아 있던 첨부는 견적서와 함께 휴지통으로 간다");
      assert.equal(row.deleteReason, QUOTE_DELETED_ATTACHMENT_REASON);
      assert.equal(row.deletedAt?.getTime(), quoteRow.deletedAt.getTime(), "견적서와 같은 삭제 시각");
      const audits = await attachmentAudits(id, "FILE_DELETE");
      assert.equal(audits.length, 1);
      assert.equal((audits[0].newValue as Record<string, unknown>).ownerType, "QUOTE");
    }
    assert.equal((await readAttachment(replacedPdf)).deleteReason, QUOTE_ATTACHMENT_REPLACED_REASON, "옛 기록을 덮어쓰지 않는다");
    const softDelete = await quoteAudit(quote.id, "SOFT_DELETE");
    assert.deepEqual((softDelete.newValue as Record<string, unknown>).trashedAttachmentIds, [pdf, excel]);

    const restored = await restoreQuote({ quoteId: quote.id, expectedVersion: quoteRow.version, actorUserId });
    assert.equal(restored.ok, true, JSON.stringify(restored));

    for (const id of [pdf, excel]) {
      const row = await readAttachment(id);
      assert.equal(row.isDeleted, false, "견적서와 함께 간 첨부는 함께 돌아온다");
      assert.equal(row.deleteReason, null);
      const [restoreAudit] = await attachmentAudits(id, "RESTORE");
      assert.equal((restoreAudit.newValue as Record<string, unknown>).restoredWithQuote, true);
    }
    assert.equal((await readAttachment(replacedPdf)).isDeleted, true, "🔴 칸 교체로 간 옛 파일은 돌아오지 않는다");
    assert.equal((await readAttachment(manualExcel)).isDeleted, true, "🔴 사람이 따로 지운 파일은 돌아오지 않는다");
    const restoreAudit = await quoteAudit(quote.id, "RESTORE");
    assert.deepEqual((restoreAudit.newValue as Record<string, unknown>).restoredAttachmentIds, [pdf, excel]);

    // 칸마다 하나 — 되살린 뒤에도 그대로다.
    assert.deepEqual(await liveInSlot(quote.id, "SIGNED_QUOTE_PDF"), [pdf]);
    assert.deepEqual(await liveInSlot(quote.id, "QUOTE_EXCEL"), [excel]);
  });

  test("낡은 version 의 휴지통 보내기는 CONFLICT — 첨부도 그대로 살아 있다(한 트랜잭션)", async () => {
    const quote = await createTestQuote(quoteFields("CASCADE-STALE"));
    const file = await addFile(quote.id, "SIGNED_QUOTE_PDF");
    const result = await softDeleteQuote({ quoteId: quote.id, expectedVersion: quote.version + 7, actorUserId, reason: null });
    assert.equal(result.ok === false && result.code, "CONFLICT");
    assert.equal((await readAttachment(file)).isDeleted, false);
  });
});

// ─────────────────────────────────────────────────── 6. 영구 삭제 · 15일 정리

describe("영구 삭제 · 15일 정리 — PURGE 스냅숏에 첨부 id, 첨부 행 · 실물은 남는다", () => {
  test("permanentlyDeleteQuote — 붙었던 첨부 전부(교체로 간 옛 파일 포함)의 id, 연결만 풀린다", async () => {
    const quote = await createTestQuote(excelOnlyFields("PURGE-MANUAL"));

    const written = await storage.writeTemp(streamOf(PDF_BYTES), { maxBytes: MAX_ATTACHMENT_SIZE_BYTES });
    const firstInput = quoteFileInput(quote.id, "SIGNED_QUOTE_PDF");
    await storage.commit(written.tempPath, firstInput.storedPath);
    const first = (await createAttachmentRecord(firstInput)).id;
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = await addFile(quote.id, "SIGNED_QUOTE_PDF");
    const excel = await addFile(quote.id, "QUOTE_EXCEL");

    const version = await trashQuote(quote.id);
    const result = await permanentlyDeleteQuote({ quoteId: quote.id, expectedVersion: version, actorUserId, reason: "시험 완전 삭제" });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(await readQuote(quote.id), undefined);

    const purge = await quoteAudit(quote.id, "PURGE");
    const snapshot = purge.previousValue as Record<string, unknown>;
    assert.deepEqual(snapshot.unlinkedAttachmentIds, [first, second, excel], "올린 차례대로, 휴지통 것도 함께");
    // 금액 한 곳 — 엑셀 전용 장의 스냅숏 금액은 손으로 적은 공급가액이다.
    assert.equal(snapshot.supplyAmount, "3456789.50");
    assert.equal(snapshot.isExcelOnly, true);
    assert.equal(snapshot.manualSupplyAmount, "3456789.50");
    assert.equal(JSON.stringify(snapshot).includes(".pdf"), false, "파일 이름 · 경로는 싣지 않는다");

    for (const id of [first, second, excel]) {
      const row = await readAttachment(id);
      assert.ok(row, "첨부 행은 남는다");
      assert.equal(row.quoteId, null, "FK(ON DELETE SET NULL)가 연결만 푼다");
    }
    // ★ 디스크 실물도 그 자리에 있다.
    assert.equal(await existsOnDisk(resolveAttachmentAbsolutePath(storageRoot, firstInput.storedPath)), true);
    // 연결이 풀린 파일은 이제 「주인 없음」이다 — 기존 동작 그대로(다른 주인과 같다).
    const detached = await getAttachmentForDownload(first);
    assert.ok(detached);
    assert.equal(decideAttachmentDownload(detached).allowed === false, true);
  });

  test("purgeExpiredQuote(15일 정리 CLI) — 같은 스냅숏: 첨부 id · 수기 공급가액", async () => {
    const quote = await createTestQuote(excelOnlyFields("PURGE-SWEEP", { manualSupplyAmount: "1200000" }));
    const file = await addFile(quote.id, "QUOTE_EXCEL");
    await trashQuote(quote.id);
    await db
      .update(quotes)
      .set({ deletedAt: new Date(Date.now() - (MASTER_DATA_TRASH_RETENTION_DAYS + 1) * MS_PER_DAY) })
      .where(eq(quotes.id, quote.id));

    assert.equal(await purgeExpiredQuote(quote.id), "PURGED");
    const purge = await quoteAudit(quote.id, "PURGE");
    assert.equal(purge.actorUserId, null, "자동 정리는 사람이 한 일이 아니다");
    const snapshot = purge.previousValue as Record<string, unknown>;
    assert.deepEqual(snapshot.unlinkedAttachmentIds, [file]);
    assert.equal(snapshot.supplyAmount, "1200000.00");
    assert.equal((await readAttachment(file)).quoteId, null);
  });

  test("일반 견적서의 PURGE 스냅숏 금액은 예전 셈법 그대로다 — 첨부가 없으면 빈 목록", async () => {
    const quote = await createTestQuote(
      quoteFields("PURGE-REGULAR", {
        workCost: "1200000.00",
        items: [{ partId: null, isOverhaulPart: false, partNameText: "냉각 팬", quantity: 2, unitPrice: "45000.00" }],
      })
    );
    const version = await trashQuote(quote.id);
    const result = await permanentlyDeleteQuote({ quoteId: quote.id, expectedVersion: version, actorUserId, reason: "대조" });
    assert.equal(result.ok, true, JSON.stringify(result));
    const snapshot = (await quoteAudit(quote.id, "PURGE")).previousValue as Record<string, unknown>;
    assert.equal(snapshot.supplyAmount, "1290000.00");
    assert.deepEqual(snapshot.unlinkedAttachmentIds, []);
  });
});

// ─────────────────────────────────────────────────── 7. 엑셀 전용 저장

describe("엑셀 전용 견적서 저장", () => {
  test("엑셀 전용 + 공급가액이면 저장되고, 수정 화면 조회가 두 칸을 싣는다", async () => {
    const quote = await createTestQuote(excelOnlyFields("SAVE"));
    const row = await readQuote(quote.id);
    assert.equal(row.isExcelOnly, true);
    assert.equal(row.manualSupplyAmount, "3456789.50");
    const edit = await getQuoteForEdit(quote.id);
    assert.equal(edit?.isExcelOnly, true);
    assert.equal(edit?.manualSupplyAmount, "3456789.50");
    assert.deepEqual(edit?.items, []);

    // 서버 액션이 타는 길 그대로 — 검증을 거친 값이 저장된다(콤마 허용).
    const validated = validateQuoteFields({
      quoteNumber: `${QUOTE_NUMBER_PREFIX}SAVE-VALIDATED`,
      quoteDate: "2096-05-11",
      customerNameText: "시험 공급처",
      subject: "시험 견적",
      isExcelOnly: true,
      manualSupplyAmount: "2,000,000",
    });
    assert.equal(validated.ok, true, JSON.stringify(validated));
    if (!validated.ok) return;
    const saved = await createTestQuote(validated.data);
    assert.equal((await readQuote(saved.id)).manualSupplyAmount, "2000000.00");
  });

  test("🔴 줄이 있으면 거절한다 — 검증을 거치지 않은 호출도 mutation 이 막고, 아무것도 쓰지 않는다", async () => {
    const withItems = await createQuote({
      fields: excelOnlyFields("SAVE-ITEMS", {
        items: [{ partId: null, isOverhaulPart: false, partNameText: "냉각 팬", quantity: 1, unitPrice: "1000" }],
      }),
      actorUserId,
    });
    assert.equal(withItems.ok === false && withItems.code, "VALIDATION_ERROR");
    assert.ok(withItems.ok === false && withItems.fieldErrors?.items);
    const [leftover] = await db
      .select({ id: quotes.id })
      .from(quotes)
      .where(eq(quotes.quoteNumber, `${QUOTE_NUMBER_PREFIX}SAVE-ITEMS`));
    assert.equal(leftover, undefined, "거절된 저장은 행을 남기지 않는다");

    const existing = await createTestQuote(excelOnlyFields("UPDATE-LINES"));
    for (const extra of [
      { workScopeLines: [{ section: "INVESTIGATION" as const, text: "외관 검사" }] },
      { repairTasks: [{ taskId: null, taskName: "바리콘 교환", hours: 3, hourlyRate: "100000" }] },
    ]) {
      const refused = await updateQuote({
        id: existing.id,
        expectedVersion: existing.version,
        fields: excelOnlyFields("UPDATE-LINES", extra),
        actorUserId,
      });
      assert.equal(refused.ok === false && refused.code, "VALIDATION_ERROR", JSON.stringify(extra));
    }
    assert.equal((await readQuote(existing.id)).version, existing.version, "거절된 수정은 version 도 그대로다");
  });

  test("금액이 비면 거절 · 일반 견적서에 수기 금액은 거절 — DB CHECK 에 닿기 전에 막는다", async () => {
    const missingAmount = await createQuote({
      fields: excelOnlyFields("SAVE-NO-AMOUNT", { manualSupplyAmount: null }),
      actorUserId,
    });
    assert.equal(missingAmount.ok === false && missingAmount.code, "VALIDATION_ERROR");
    assert.ok(missingAmount.ok === false && missingAmount.fieldErrors?.manualSupplyAmount);

    const regularWithAmount = await createQuote({
      fields: quoteFields("SAVE-REGULAR-AMOUNT", { manualSupplyAmount: "1000" }),
      actorUserId,
    });
    assert.equal(regularWithAmount.ok === false && regularWithAmount.code, "VALIDATION_ERROR");
    assert.match(regularWithAmount.ok === false ? regularWithAmount.message : "", /엑셀 전용/);
  });

  test("엑셀 전용 ↔ 일반 견적서 — 되돌릴 때는 수기 금액을 비우고, 줄을 다시 넣을 수 있다", async () => {
    const quote = await createTestQuote(excelOnlyFields("TOGGLE"));
    const back = await updateQuote({
      id: quote.id,
      expectedVersion: quote.version,
      fields: quoteFields("TOGGLE", {
        workCost: "500000",
        items: [{ partId: null, isOverhaulPart: false, partNameText: "냉각 팬", quantity: 1, unitPrice: "1000" }],
      }),
      actorUserId,
    });
    assert.equal(back.ok, true, JSON.stringify(back));
    const row = await readQuote(quote.id);
    assert.equal(row.isExcelOnly, false);
    assert.equal(row.manualSupplyAmount, null);
  });
});

// ─────────────────────────────────────────────────── 8. 금액 한 곳 · 목록 표시

describe("금액 한 곳 — 목록 · 수리 건 탭 · 내자 정리 연결 금액", () => {
  test("목록의 공급가 — 엑셀 전용 장은 손으로 적은 금액, hasSignedPdf · hasExcel 은 살아 있는 칸만", async () => {
    const excelOnly = await createTestQuote(excelOnlyFields("LIST-EXCEL"));
    const regular = await createTestQuote(
      quoteFields("LIST-REGULAR", {
        workCost: "1200000.00",
        items: [{ partId: null, isOverhaulPart: false, partNameText: "냉각 팬", quantity: 2, unitPrice: "45000.00" }],
      })
    );

    const find = async (id: string) => {
      const item = (await listQuotes()).find((row) => row.id === id);
      assert.ok(item, "목록에 없다");
      return item;
    };

    let listed = await find(excelOnly.id);
    assert.equal(listed.isExcelOnly, true);
    assert.equal(listed.supplyAmount, 3_456_789.5);
    assert.equal(listed.itemCount, 0);
    assert.equal(listed.hasExcel, false, "엑셀 전용인데 엑셀이 없다 — 화면이 이것으로 알린다");
    assert.equal(listed.hasSignedPdf, false);

    await addFile(excelOnly.id, "QUOTE_EXCEL");
    const pdf = await addFile(excelOnly.id, "SIGNED_QUOTE_PDF");
    listed = await find(excelOnly.id);
    assert.equal(listed.hasExcel, true);
    assert.equal(listed.hasSignedPdf, true);
    // 휴지통의 파일은 세지 않는다.
    await softDeleteAttachment({ attachmentId: pdf, actorUserId, reason: null });
    assert.equal((await find(excelOnly.id)).hasSignedPdf, false);

    const regularListed = await find(regular.id);
    assert.equal(regularListed.isExcelOnly, false);
    assert.equal(regularListed.supplyAmount, 1_290_000, "일반 견적서는 예전 셈법 그대로");
    assert.equal(regularListed.hasExcel, false);

    // 수리 건의 견적서 탭도 같은 몸통이다 — 수리 건이 없는 장이라 여기서는 빈 목록만 본다.
    assert.deepEqual(await listQuotesForRepairCase("not-a-uuid"), []);

    // 🔴 엑셀 전용인데 금액이 비어 있는 옛 행(검증을 거치지 않았다 — 이 스위트의 행만 손으로
    // 바꾼다)은 null — 0 으로 접지 않는다(화면이 「—」로 그린다).
    await db.update(quotes).set({ manualSupplyAmount: null }).where(eq(quotes.id, excelOnly.id));
    assert.equal((await find(excelOnly.id)).supplyAmount, null);
  });

  test("🔴 내자 정리 연결 금액 — 엑셀 전용 견적서가 연결된 줄은 수기 공급가액을 그린다(0.00 이 가리지 않는다)", async () => {
    const quote = await createTestQuote(excelOnlyFields("DOMESTIC"));
    const order = await createDomesticOrder({
      fields: domesticFields("DOMESTIC", {
        quoteId: quote.id,
        quoteNumber: "손으로 적은 견적서번호",
        amountExcludingVat: "777000.00",
      }),
      actorUserId,
    });
    assert.equal(order.ok, true, JSON.stringify(order));
    if (!order.ok) return;

    const find = async () => {
      const item = (await listDomesticOrders()).find((row) => row.id === order.id);
      assert.ok(item, "내자 줄이 목록에 없다");
      return item;
    };
    let item = await find();
    assert.equal(item.displayAmountExcludingVat, "3456789.50", "연결된 견적서의 공급가(수기)가 이긴다");
    assert.equal(item.amountExcludingVat, "777000.00", "원본 칸은 손 값 그대로 — 덮지 않는다");
    assert.equal(item.displayQuoteNumber, `${QUOTE_NUMBER_PREFIX}DOMESTIC`);

    // 금액을 알 수 없는 엑셀 전용 장(손으로 비운 옛 행)은 싣지 않는다 — 손으로 적은 금액이 보인다.
    await db.update(quotes).set({ manualSupplyAmount: null }).where(eq(quotes.id, quote.id));
    item = await find();
    assert.equal(item.displayAmountExcludingVat, "777000.00");
  });
});
