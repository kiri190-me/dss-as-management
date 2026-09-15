import "../../../../scripts/load-env";

import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { and, eq, inArray, like } from "drizzle-orm";

import { db, pgClient } from "../../db/connection";
import { attachments, auditLogs, quotes, users } from "../../db/schema";
import { QUOTE_ATTACHMENT_REPLACED_REASON, createAttachmentRecord } from "../../db/mutations/attachments";
import { createQuote, updateQuote } from "../../db/mutations/quotes";
import { softDeleteQuote } from "../../db/mutations/quote-trash";
import { getQuoteForEdit } from "../../db/queries/quotes";
import { QUOTE_EXCEL_MISSING_MESSAGE } from "@/app/api/quotes/[id]/xlsx/download-source";
import { PERMISSION_LEVELS, findPermissionArea } from "@/lib/auth/permission-areas";
import { MAX_ATTACHMENT_SIZE_BYTES, canonicalMimeTypeForExtension } from "@/lib/domain/attachment-allowlist";
import { buildQuoteAttachmentStoredPath } from "@/lib/domain/attachment-path";
import {
  numberedQuoteArchiveName,
  quoteArchiveFileName,
  quoteArchiveFolderName,
  quoteArchiveSignedPdfFileName,
  quoteArchiveYearFolderName,
  type QuoteArchiveNamingInput,
} from "@/lib/domain/quote-archive-naming";
import { buildQuoteFileName } from "@/lib/domain/quote-file-name";
import { QUOTE_ISSUE_RESULT_HEADER } from "@/lib/domain/quote-issue-result";
import { createLocalFileSystemStorageAdapter } from "@/lib/storage/local-fs-adapter";
import type { StorageAdapter } from "@/lib/storage/storage-adapter";
import type { QuoteFields } from "@/lib/validation/quote-input";
import { archiveSignedQuotePdf, issueQuoteFile, type IssueQuoteFileOutcome } from "./quote-issue";
import { renderQuoteWorkbook } from "./quote-workbook";

/**
 * ============================================================================
 * 수정 권한자의 [견적서 받기] · 결재 PDF 복사 — 시험 DB 에서 중심 함수를 그대로 부른다 (B1b)
 * ============================================================================
 * 이 저장소의 관례대로 라우트를 직접 부르지 않는다 — 라우트가 부르는 함수(issueQuoteFile ·
 * archiveSignedQuotePdf)를 부른다. 라우트의 문지기 순서 · 권한 · 헤더 이름은 맨 아래 묶음이
 * **소스를 읽어** 지킨다(service-report-authorization.test.ts 와 같은 장치).
 *
 * 🔴 실제 공유폴더 · 실제 첨부 저장소에 닿지 않는다. 공유폴더 루트와 첨부 저장소는 전부
 * OS 임시 폴더(mkdtemp)이고 끝나면 지운다. 부르는 쪽이 루트를 직접 넘기므로
 * resolveQuoteArchiveRoot()(QUOTE_ARCHIVE_DIR)는 한 번도 부르지 않는다.
 *
 * 채우기는 **실제 양식 파일**로 한다 — test:db 도 .env.local 의 양식 경로를 읽는다
 * (scripts/load-env.ts). 양식 경로가 없는 환경(NAS · CI)에서는 채우기가 필요한 시험만
 * 건너뛴다(xlsx 양식 시험들과 같은 규칙).
 *
 * ── 격리 규약 ────────────────────────────────────────────────────────────
 * 발행번호는 `QI-TEST-{토큰}-` 로 시작한다(실행마다 다른 토큰). after() 는 이 스위트의
 * 견적서에 붙은 첨부 → 견적서 쪽 감사 로그((엔티티, 대상 id) 쌍) → 견적서(접두어) 순으로
 * 지운다. 첨부의 감사 로그는 지우지 않는다 — 첨부 시험들과 같은 규칙이다. 공급처 · 모델은
 * 가짜 이름이다(저장소가 공개다).
 * ============================================================================
 */

const RUN = randomUUID().slice(0, 8);
const QUOTE_NUMBER_PREFIX = `QI-TEST-${RUN}-`;
const QUOTE_DATE = "2096-05-10";
const YEAR_FOLDER = quoteArchiveYearFolderName(2096);
const XLSX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const templatesReady = Boolean(process.env.QUOTE_TEMPLATE_PATH?.trim() && process.env.OH_QUOTE_TEMPLATE_PATH?.trim());
const skipRender = templatesReady ? false : "QUOTE_TEMPLATE_PATH · OH_QUOTE_TEMPLATE_PATH 가 설정되지 않았습니다";

const repoUrl = new URL("../../../../", import.meta.url);
const readSource = (relativePath: string) =>
  readFileSync(new URL(relativePath, repoUrl), "utf8").replace(/\r\n/g, "\n");

let actorUserId: string;
let storageRoot: string;
let storage: StorageAdapter;
const tempRoots: string[] = [];
const touchedQuoteIds: string[] = [];

type QuoteRef = { id: string; version: number };

function quoteFields(suffix: string, overrides: Partial<QuoteFields> = {}): QuoteFields {
  return {
    quoteNumber: `${QUOTE_NUMBER_PREFIX}${suffix}`,
    kind: "DOMESTIC",
    quoteDate: QUOTE_DATE,
    repairCaseId: null,
    intakeNumberText: null,
    customerId: null,
    customerNameText: "시험 공급처",
    modelNameText: "MODEL-T1",
    lotNumberText: null,
    serialNumberText: null,
    faultDescriptionText: null,
    subject: "시험 견적",
    validity: null,
    delivery: null,
    payment: null,
    workCost: "120000.00",
    laborEquipmentKind: null,
    laborBaseCost: null,
    investigationExcluded: false,
    powerTestExcluded: false,
    laborPowerTestDeduction: null,
    isExcelOnly: false,
    manualSupplyAmount: null,
    repairTasks: [],
    workScopeLines: [],
    items: [{ partId: null, isOverhaulPart: false, partNameText: "냉각 팬", quantity: 2, unitPrice: "45000.00" }],
    ...overrides,
  };
}

function excelOnlyFields(suffix: string): QuoteFields {
  return quoteFields(suffix, { isExcelOnly: true, manualSupplyAmount: "3456789.50", items: [], workCost: "0" });
}

function namingOf(fields: QuoteFields): QuoteArchiveNamingInput {
  return {
    quoteNumber: fields.quoteNumber,
    kind: fields.kind,
    customerName: fields.customerNameText,
    modelName: fields.modelNameText,
    lotNumber: fields.lotNumberText,
    serialNumber: fields.serialNumberText,
  };
}

async function createTestQuote(fields: QuoteFields): Promise<QuoteRef> {
  const result = await createQuote({ fields, actorUserId });
  assert.equal(result.ok, true, `setup create quote failed: ${JSON.stringify(result)}`);
  if (!result.ok) throw new Error("unreachable");
  touchedQuoteIds.push(result.id);
  return { id: result.id, version: result.version };
}

async function makeTempRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), prefix));
  tempRoots.push(root);
  return root;
}

function issue(quoteId: string, archiveRoot: string | null, storageOverride: StorageAdapter = storage) {
  return issueQuoteFile({ quoteId, actorUserId, archiveRoot, storage: storageOverride });
}

function expectIssued(outcome: IssueQuoteFileOutcome): Extract<IssueQuoteFileOutcome, { ok: true }> {
  assert.equal(outcome.ok, true, outcome.ok ? "" : `${outcome.code}: ${outcome.message}`);
  if (!outcome.ok) throw new Error("unreachable");
  return outcome;
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function streamOf(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

async function readStored(storedPath: string): Promise<Buffer> {
  const chunks: Uint8Array[] = [];
  const reader = (await storage.read(storedPath)).getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  return Buffer.concat(chunks);
}

function absoluteIn(root: string, relativePath: string): string {
  return path.join(root, ...relativePath.split("/"));
}

async function filesIn(root: string, relativeDirectory: string): Promise<string[]> {
  try {
    return (await readdir(absoluteIn(root, relativeDirectory))).sort();
  } catch {
    return [];
  }
}

async function exists(target: string): Promise<boolean> {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

async function quoteAttachmentRows(quoteId: string) {
  return db
    .select({
      id: attachments.id,
      category: attachments.category,
      isDeleted: attachments.isDeleted,
      deleteReason: attachments.deleteReason,
      originalFileName: attachments.originalFileName,
      storedPath: attachments.storedPath,
      mimeType: attachments.mimeType,
      fileSize: attachments.fileSize,
      checksumSha256: attachments.checksumSha256,
      uploadedBy: attachments.uploadedBy,
    })
    .from(attachments)
    .where(eq(attachments.quoteId, quoteId));
}

async function liveExcel(quoteId: string) {
  return (await quoteAttachmentRows(quoteId)).filter((row) => row.category === "QUOTE_EXCEL" && !row.isDeleted);
}

async function exportAuditCount(quoteId: string): Promise<number> {
  const rows = await db
    .select({ actorUserId: auditLogs.actorUserId })
    .from(auditLogs)
    .where(
      and(
        eq(auditLogs.targetEntity, "quotes"),
        eq(auditLogs.targetRecordId, quoteId),
        eq(auditLogs.actionType, "EXCEL_EXPORT")
      )
    );
  for (const row of rows) assert.equal(row.actorUserId, actorUserId);
  return rows.length;
}

/** 저장소에 실물을 놓고(선택) 견적서 칸에 기록한다 — 올리기 통로와 같은 차례. */
async function attachStoredFile(
  quoteId: string,
  category: "QUOTE_EXCEL" | "SIGNED_QUOTE_PDF",
  content: Uint8Array,
  extension: "xlsx" | "xls" | "pdf",
  options: { placeFile?: boolean } = {}
): Promise<{ id: string; storedPath: string }> {
  const id = randomUUID().toLowerCase();
  const storedPath = buildQuoteAttachmentStoredPath({ quoteId, attachmentId: id, extension });
  if (options.placeFile !== false) {
    const written = await storage.writeTemp(streamOf(content), { maxBytes: MAX_ATTACHMENT_SIZE_BYTES });
    await storage.commit(written.tempPath, storedPath);
  }
  await createAttachmentRecord({
    id,
    owner: { kind: "QUOTE", quoteId },
    category,
    originalFileName: `손으로 만든 파일.${extension}`,
    storedPath,
    mimeType: canonicalMimeTypeForExtension(extension) ?? "application/octet-stream",
    fileSize: content.byteLength,
    checksumSha256: sha256(content),
    description: null,
    uploadedBy: actorUserId,
  });
  // 올린 차례(uploaded_at)로 칸의 파일을 고른다 — 같은 순간에 찍히지 않게 한 틈을 둔다.
  await new Promise((resolve) => setTimeout(resolve, 5));
  return { id, storedPath };
}

/** console.error 를 잠시 붙잡는다 — 로그에 경로 · 입력값이 새지 않는지 본다. */
async function captureConsoleError<T>(run: () => Promise<T>): Promise<{ value: T; logged: string }> {
  const original = console.error;
  const calls: unknown[][] = [];
  console.error = (...args: unknown[]) => {
    calls.push(args);
  };
  try {
    const value = await run();
    return { value, logged: JSON.stringify(calls) };
  } finally {
    console.error = original;
  }
}

before(async () => {
  const [anyone] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.approvalStatus, "APPROVED"), eq(users.isDeleted, false)))
    .limit(1);
  // 행위자는 uploaded_by · 감사 로그의 actor 로만 쓰인다. 역할 판정은 라우트의 몫이다.
  assert.ok(anyone, "expected at least one approved user in the test DB");
  actorUserId = anyone.id;

  storageRoot = await makeTempRoot("dss-qi-store-");
  storage = createLocalFileSystemStorageAdapter(storageRoot);
});

after(async () => {
  if (touchedQuoteIds.length > 0) {
    // 칸 교체로 휴지통에 간 것까지 — 이 스위트 견적서의 첨부 전부.
    await db.delete(attachments).where(inArray(attachments.quoteId, touchedQuoteIds));
    await db
      .delete(auditLogs)
      .where(and(eq(auditLogs.targetEntity, "quotes"), inArray(auditLogs.targetRecordId, touchedQuoteIds)));
  }
  await db.delete(quotes).where(like(quotes.quoteNumber, `${QUOTE_NUMBER_PREFIX}%`));
  for (const root of tempRoots) {
    await rm(root, { recursive: true, force: true });
  }
  await pgClient.end({ timeout: 5 });
});

// ─────────────────────────────────────────────────── 전제 — 같은 입력이면 같은 바이트

describe("전제 — 같은 견적서를 두 번 채우면 같은 바이트다(추가 결정 4)", { skip: skipRender }, () => {
  test("일반 · OH 견적서 모두 — 따로 읽은 두 조회로 두 번 채워도 한 바이트도 다르지 않다", async () => {
    for (const fields of [
      quoteFields("SAME-BYTES"),
      quoteFields("SAME-BYTES-OH", {
        kind: "OVERHAUL",
        items: [
          { partId: null, isOverhaulPart: false, partNameText: "냉각 팬", quantity: 1, unitPrice: "45000.00" },
          { partId: null, isOverhaulPart: true, partNameText: "베어링 세트", quantity: 1, unitPrice: "88000.00" },
        ],
      }),
    ]) {
      const quote = await createTestQuote(fields);
      const firstRead = await getQuoteForEdit(quote.id);
      const secondRead = await getQuoteForEdit(quote.id);
      assert.ok(firstRead && secondRead);
      const first = await renderQuoteWorkbook(firstRead);
      await new Promise((resolve) => setTimeout(resolve, 1100)); // 초가 바뀐 뒤에 한 번 더
      const second = await renderQuoteWorkbook(secondRead);
      assert.ok(first.byteLength > 0);
      assert.equal(sha256(first), sha256(second), `${fields.kind}: 두 번 채운 바이트가 다르다`);
    }
  });
});

// ─────────────────────────────────────────────────── 일반 견적서

describe("일반 견적서 — 채우기 → 공유폴더 → 첨부 칸 → 감사", { skip: skipRender }, () => {
  test("공유폴더 파일 + QUOTE_EXCEL 첨부(원래 이름 = 공유폴더 파일 이름) — 돌려준 바이트 = 공유폴더 = 첨부", async () => {
    const fields = quoteFields("REGULAR");
    const quote = await createTestQuote(fields);
    const archiveRoot = await makeTempRoot("dss-qi-arc-");
    const naming = namingOf(fields);
    const folder = `${YEAR_FOLDER}/${quoteArchiveFolderName(naming)}`;
    const fileName = quoteArchiveFileName(naming, { extension: "xlsx" });

    const issued = expectIssued(await issue(quote.id, archiveRoot));

    assert.deepEqual(issued.result, {
      archive: { status: "saved", relativePath: `${folder}/${fileName}`, multipleFolderMatches: false },
      attachment: { status: "replaced", displacedCount: 0 },
    });
    assert.equal(issued.contentType, XLSX_CONTENT_TYPE);
    assert.equal(
      issued.fileName,
      buildQuoteFileName({ quoteNumber: fields.quoteNumber, customerName: fields.customerNameText }),
      "내려받는 파일 이름은 기존 규칙 그대로"
    );

    // 🔴 GET 과 같은 함수로 채운 바이트다.
    const edit = await getQuoteForEdit(quote.id);
    assert.ok(edit);
    assert.ok(issued.bytes.equals(await renderQuoteWorkbook(edit)), "GET 의 채우기와 다른 바이트");

    const archived = await readFile(absoluteIn(archiveRoot, `${folder}/${fileName}`));
    assert.ok(issued.bytes.equals(archived), "공유폴더 파일이 돌려준 바이트와 다르다");

    const [row, ...rest] = await liveExcel(quote.id);
    assert.equal(rest.length, 0);
    assert.equal(row.originalFileName, fileName, "원래 이름은 공유폴더에 쓴 파일 이름");
    assert.equal(row.mimeType, canonicalMimeTypeForExtension("xlsx"));
    assert.equal(row.fileSize, issued.bytes.byteLength);
    assert.equal(row.checksumSha256, sha256(issued.bytes));
    assert.equal(row.uploadedBy, actorUserId);
    assert.equal(row.storedPath, `quotes/${quote.id}/${row.id}.xlsx`);
    assert.ok(issued.bytes.equals(await readStored(row.storedPath)), "첨부 파일이 돌려준 바이트와 다르다");

    assert.equal(await exportAuditCount(quote.id), 1, "EXCEL_EXPORT 감사가 남는다");
  });

  test("🔴 두 번 받기 — 공유폴더 파일 하나 · 첨부 교체 없음(휴지통이 늘지 않음) · 둘 다 unchanged", async () => {
    const fields = quoteFields("TWICE");
    const quote = await createTestQuote(fields);
    const archiveRoot = await makeTempRoot("dss-qi-arc-");
    const naming = namingOf(fields);
    const folder = `${YEAR_FOLDER}/${quoteArchiveFolderName(naming)}`;
    const fileName = quoteArchiveFileName(naming, { extension: "xlsx" });

    const first = expectIssued(await issue(quote.id, archiveRoot));
    const [firstRow] = await liveExcel(quote.id);
    const second = expectIssued(await issue(quote.id, archiveRoot));

    assert.deepEqual(second.result, {
      archive: { status: "unchanged", relativePath: `${folder}/${fileName}`, multipleFolderMatches: false },
      attachment: { status: "unchanged" },
    });
    assert.ok(second.bytes.equals(first.bytes));
    assert.deepEqual(await filesIn(archiveRoot, folder), [fileName], "공유폴더 파일은 하나");

    const rows = await quoteAttachmentRows(quote.id);
    assert.equal(rows.length, 1, "첨부 행이 늘지 않는다");
    assert.equal(rows.filter((row) => row.isDeleted).length, 0, "휴지통이 늘지 않는다");
    assert.equal(rows[0].id, firstRow.id, "칸의 파일은 처음 올린 그것");

    assert.equal(await exportAuditCount(quote.id), 2, "내려받기는 두 번이라 감사도 두 줄");
  });

  test("내용을 바꿔 받기 — 공유폴더 ` (2)` · replaced 1 · 옛 첨부는 휴지통, 같은 내용이면 다시 unchanged", async () => {
    const fields = quoteFields("CHANGED");
    const quote = await createTestQuote(fields);
    const archiveRoot = await makeTempRoot("dss-qi-arc-");
    const naming = namingOf(fields);
    const folder = `${YEAR_FOLDER}/${quoteArchiveFolderName(naming)}`;
    const fileName = quoteArchiveFileName(naming, { extension: "xlsx" });
    const secondName = numberedQuoteArchiveName(fileName, 2);

    const first = expectIssued(await issue(quote.id, archiveRoot));
    const [oldRow] = await liveExcel(quote.id);

    const updated = await updateQuote({
      id: quote.id,
      expectedVersion: quote.version,
      fields: quoteFields("CHANGED", { workCost: "150000.00" }),
      actorUserId,
    });
    assert.equal(updated.ok, true, JSON.stringify(updated));

    const second = expectIssued(await issue(quote.id, archiveRoot));
    assert.equal(second.bytes.equals(first.bytes), false, "내용을 바꿨으니 바이트가 달라야 한다");
    assert.deepEqual(second.result, {
      archive: { status: "saved", relativePath: `${folder}/${secondName}`, multipleFolderMatches: false },
      attachment: { status: "replaced", displacedCount: 1 },
    });
    assert.deepEqual(await filesIn(archiveRoot, folder), [fileName, secondName].sort());
    assert.ok((await readFile(absoluteIn(archiveRoot, `${folder}/${fileName}`))).equals(first.bytes), "앞의 파일은 그대로");
    assert.ok((await readFile(absoluteIn(archiveRoot, `${folder}/${secondName}`))).equals(second.bytes));

    const rows = await quoteAttachmentRows(quote.id);
    const old = rows.find((row) => row.id === oldRow.id);
    assert.equal(old?.isDeleted, true, "옛 첨부는 첨부 휴지통으로");
    assert.equal(old?.deleteReason, QUOTE_ATTACHMENT_REPLACED_REASON);
    const [live, ...more] = await liveExcel(quote.id);
    assert.equal(more.length, 0);
    assert.equal(live.originalFileName, secondName);
    assert.ok(second.bytes.equals(await readStored(live.storedPath)));

    // 바꾼 내용 그대로 한 번 더 — ` (2)` 를 가리키고 칸도 그대로다.
    const third = expectIssued(await issue(quote.id, archiveRoot));
    assert.deepEqual(third.result, {
      archive: { status: "unchanged", relativePath: `${folder}/${secondName}`, multipleFolderMatches: false },
      attachment: { status: "unchanged" },
    });
    assert.equal((await quoteAttachmentRows(quote.id)).length, 2);
  });

  test("OH 견적서 — 공유폴더 · 첨부 이름에 `(OH포함)`", async () => {
    const fields = quoteFields("OH", {
      kind: "OVERHAUL",
      items: [{ partId: null, isOverhaulPart: true, partNameText: "베어링 세트", quantity: 1, unitPrice: "88000.00" }],
    });
    const quote = await createTestQuote(fields);
    const archiveRoot = await makeTempRoot("dss-qi-arc-");

    const issued = expectIssued(await issue(quote.id, archiveRoot));

    assert.equal(issued.result.archive.status, "saved");
    const relativePath = issued.result.archive.status === "saved" ? issued.result.archive.relativePath : "";
    assert.ok(relativePath.endsWith("수리 견적서(OH포함).xlsx"), relativePath);
    const [row] = await liveExcel(quote.id);
    assert.ok(row.originalFileName.includes("(OH포함)"), row.originalFileName);
  });

  test("공유폴더가 꺼져 있으면(null) disabled — 첨부 · 바이트는 그대로, 원래 이름은 번호 없는 이름 규칙 값", async () => {
    const fields = quoteFields("DISABLED");
    const quote = await createTestQuote(fields);

    const issued = expectIssued(await issue(quote.id, null));

    assert.deepEqual(issued.result, { archive: { status: "disabled" }, attachment: { status: "replaced", displacedCount: 0 } });
    const [row] = await liveExcel(quote.id);
    assert.equal(row.originalFileName, quoteArchiveFileName(namingOf(fields), { extension: "xlsx" }));
    assert.ok(issued.bytes.equals(await readStored(row.storedPath)));
    assert.equal(await exportAuditCount(quote.id), 1);
  });

  test("루트가 없는 경로면 failed — 첨부 · 바이트는 그대로, 루트가 생기지 않고 사유에 경로가 없다", async () => {
    const fields = quoteFields("NO-ROOT");
    const quote = await createTestQuote(fields);
    const parent = await makeTempRoot("dss-qi-arc-");
    const missingRoot = path.join(parent, "연결-안-된-공유폴더");

    const { value: outcome, logged } = await captureConsoleError(() => issue(quote.id, missingRoot));
    const issued = expectIssued(outcome);

    assert.equal(issued.result.archive.status, "failed");
    const reason = issued.result.archive.status === "failed" ? issued.result.archive.reason : "";
    assert.ok(reason.length > 0);
    assert.ok(!reason.includes(parent) && !/[\\/]/.test(reason), `사유에 경로가 섞였다: ${reason}`);
    assert.ok(!logged.includes(path.basename(parent)), "로그에 경로가 섞였다");
    assert.equal(await exists(missingRoot), false, "루트가 생겼다");
    assert.deepEqual(issued.result.attachment, { status: "replaced", displacedCount: 0 });
    const [row] = await liveExcel(quote.id);
    assert.equal(row.originalFileName, quoteArchiveFileName(namingOf(fields), { extension: "xlsx" }));
    assert.ok(issued.bytes.equals(await readStored(row.storedPath)));
    assert.equal(await exportAuditCount(quote.id), 1);
  });

  test("🔴 첨부 칸이 실패해도 내려받기 · 공유폴더 · 감사는 그대로 — 사유 · 로그에 경로 · 오류 문장이 없다", async () => {
    const fields = quoteFields("SLOT-FAIL");
    const quote = await createTestQuote(fields);
    const archiveRoot = await makeTempRoot("dss-qi-arc-");
    const secret = "C:/비밀-경로/uploads/.tmp-uploads/x.part";
    // 임시 쓰기만 깨진 저장소 — 나머지는 시험 저장소에 그대로 맡긴다(클래스라 펼치기로는 메서드가 안 온다).
    const brokenStorage: StorageAdapter = {
      writeTemp: async () => {
        throw Object.assign(new Error(`디스크 오류 ${secret}`), { code: "EIO" });
      },
      commit: (tempPath, relPath) => storage.commit(tempPath, relPath),
      discard: (tempPath) => storage.discard(tempPath),
      read: (relPath) => storage.read(relPath),
      delete: (relPath) => storage.delete(relPath),
      exists: (relPath) => storage.exists(relPath),
      sweepTemp: (olderThanMs) => storage.sweepTemp(olderThanMs),
    };

    const { value: outcome, logged } = await captureConsoleError(() => issue(quote.id, archiveRoot, brokenStorage));
    const issued = expectIssued(outcome);

    assert.equal(issued.result.attachment.status, "failed");
    const reason = issued.result.attachment.status === "failed" ? issued.result.attachment.reason : "";
    assert.ok(!reason.includes("비밀") && !reason.includes("디스크 오류"), reason);
    assert.ok(!logged.includes("비밀"), `로그에 오류 문장(경로)이 섞였다: ${logged}`);
    assert.ok(logged.includes("EIO"), "로그에는 오류 코드가 남는다");
    assert.ok(logged.includes(quote.id), "로그에는 견적서 id 가 남는다");
    assert.equal(issued.result.archive.status, "saved");
    assert.equal((await quoteAttachmentRows(quote.id)).length, 0, "첨부 행이 생기지 않았다");
    assert.ok(issued.bytes.byteLength > 0);
    assert.equal(await exportAuditCount(quote.id), 1);
  });
});

// ─────────────────────────────────────────────────── 엑셀 전용 견적서

describe("엑셀 전용 견적서 — 붙인 엑셀을 공유폴더에 복사만", () => {
  test("붙인 엑셀이 없으면 EXCEL_NOT_ATTACHED(404 뜻) — 공유폴더 · 감사 없음", async () => {
    const quote = await createTestQuote(excelOnlyFields("EXCEL-MISSING"));
    const archiveRoot = await makeTempRoot("dss-qi-arc-");

    const outcome = await issue(quote.id, archiveRoot);

    assert.deepEqual(outcome, { ok: false, code: "EXCEL_NOT_ATTACHED", message: QUOTE_EXCEL_MISSING_MESSAGE });
    assert.deepEqual(await readdir(archiveRoot), []);
    assert.equal(await exportAuditCount(quote.id), 0);
  });

  test("붙인 파일과 같은 바이트 · 확장자(xls) — 첨부 개수 그대로 · skipped, 두 번째는 unchanged", async () => {
    const fields = excelOnlyFields("EXCEL-ONLY");
    const quote = await createTestQuote(fields);
    const archiveRoot = await makeTempRoot("dss-qi-arc-");
    const content = new Uint8Array(Buffer.from("손으로 만든 xls 견적서 바이트", "utf8"));
    await attachStoredFile(quote.id, "SIGNED_QUOTE_PDF", new Uint8Array(Buffer.from("%PDF 결재본")), "pdf");
    await attachStoredFile(quote.id, "QUOTE_EXCEL", content, "xls");
    const before = await quoteAttachmentRows(quote.id);

    const issued = expectIssued(await issue(quote.id, archiveRoot));

    const naming = namingOf(fields);
    const folder = `${YEAR_FOLDER}/${quoteArchiveFolderName(naming)}`;
    const fileName = quoteArchiveFileName(naming, { extension: "xls" });
    assert.deepEqual(issued.result, {
      archive: { status: "saved", relativePath: `${folder}/${fileName}`, multipleFolderMatches: false },
      attachment: { status: "skipped" },
    });
    assert.ok(issued.bytes.equals(content), "돌려준 바이트는 붙인 파일 그대로");
    assert.ok((await readFile(absoluteIn(archiveRoot, `${folder}/${fileName}`))).equals(content));
    assert.equal(issued.contentType, canonicalMimeTypeForExtension("xls"));
    assert.equal(
      issued.fileName,
      buildQuoteFileName({ quoteNumber: fields.quoteNumber, customerName: fields.customerNameText, extension: "xls" })
    );
    assert.deepEqual(
      (await quoteAttachmentRows(quote.id)).map((row) => [row.id, row.isDeleted]).sort(),
      before.map((row) => [row.id, row.isDeleted]).sort(),
      "칸은 건드리지 않는다"
    );
    assert.equal(await exportAuditCount(quote.id), 1);

    const again = expectIssued(await issue(quote.id, archiveRoot));
    assert.deepEqual(again.result, {
      archive: { status: "unchanged", relativePath: `${folder}/${fileName}`, multipleFolderMatches: false },
      attachment: { status: "skipped" },
    });
    assert.deepEqual(await filesIn(archiveRoot, folder), [fileName]);
  });

  test("검사에 막힌 엑셀이면 SCAN_BLOCKED(403 뜻) · 실물이 없으면 NOT_FOUND — 둘 다 공유폴더 · 감사 없음", async () => {
    const blocked = await createTestQuote(excelOnlyFields("EXCEL-BLOCKED"));
    const file = await attachStoredFile(blocked.id, "QUOTE_EXCEL", new Uint8Array(Buffer.from("막힌 파일")), "xlsx");
    // 이 스위트가 만든 행만 손으로 바꾼다.
    await db.update(attachments).set({ malwareScanStatus: "INFECTED" }).where(eq(attachments.id, file.id));
    const archiveRoot = await makeTempRoot("dss-qi-arc-");

    const blockedOutcome = await issue(blocked.id, archiveRoot);
    assert.equal(blockedOutcome.ok === false && blockedOutcome.code, "SCAN_BLOCKED");

    const missing = await createTestQuote(excelOnlyFields("EXCEL-NO-FILE"));
    await attachStoredFile(missing.id, "QUOTE_EXCEL", new Uint8Array(Buffer.from("놓지 않은 파일")), "xlsx", { placeFile: false });
    const { value: missingOutcome } = await captureConsoleError(() => issue(missing.id, archiveRoot));
    assert.equal(missingOutcome.ok === false && missingOutcome.code, "NOT_FOUND");

    assert.deepEqual(await readdir(archiveRoot), []);
    assert.equal(await exportAuditCount(blocked.id), 0);
    assert.equal(await exportAuditCount(missing.id), 0);
  });
});

// ─────────────────────────────────────────────────── 없는 견적서 · 휴지통

describe("없는 견적서 · 휴지통 견적서 — NOT_FOUND(404 뜻), 아무것도 쓰지 않는다", () => {
  test("휴지통 견적서", async () => {
    const quote = await createTestQuote(quoteFields("TRASHED"));
    const trashed = await softDeleteQuote({ quoteId: quote.id, expectedVersion: quote.version, actorUserId, reason: "시험" });
    assert.equal(trashed.ok, true, JSON.stringify(trashed));
    const archiveRoot = await makeTempRoot("dss-qi-arc-");

    const outcome = await issue(quote.id, archiveRoot);

    assert.equal(outcome.ok === false && outcome.code, "NOT_FOUND");
    assert.deepEqual(await readdir(archiveRoot), []);
    assert.equal((await quoteAttachmentRows(quote.id)).length, 0);
    assert.equal(await exportAuditCount(quote.id), 0);
  });

  test("없는 id · 형식이 틀린 id", async () => {
    for (const quoteId of [randomUUID().toLowerCase(), "not-a-uuid", ""]) {
      const outcome = await issue(quoteId, null);
      assert.equal(outcome.ok === false && outcome.code, "NOT_FOUND", quoteId);
    }
  });
});

// ─────────────────────────────────────────────────── 결재 PDF 복사

describe("결재 PDF 복사 — archiveSignedQuotePdf", () => {
  test("같은 견적서 폴더에 `… - 有印.pdf` · 같은 PDF 두 번이면 파일 하나 · 다른 PDF 면 ` (2)`", async () => {
    const fields = quoteFields("SIGNED");
    const quote = await createTestQuote(fields);
    const archiveRoot = await makeTempRoot("dss-qi-arc-");
    const naming = namingOf(fields);
    const folder = `${YEAR_FOLDER}/${quoteArchiveFolderName(naming)}`;
    const pdfName = quoteArchiveSignedPdfFileName(naming);
    const pdfBytes = new Uint8Array(Buffer.from("%PDF-1.4 결재 견적서 시험"));
    const pdf = await attachStoredFile(quote.id, "SIGNED_QUOTE_PDF", pdfBytes, "pdf");

    const first = await archiveSignedQuotePdf({ quoteId: quote.id, storedPath: pdf.storedPath, archiveRoot, storage });
    assert.deepEqual(first, { status: "saved", relativePath: `${folder}/${pdfName}`, multipleFolderMatches: false });
    assert.ok(pdfName.endsWith(" - 有印.pdf"), pdfName);
    assert.ok((await readFile(absoluteIn(archiveRoot, `${folder}/${pdfName}`))).equals(pdfBytes));

    const again = await archiveSignedQuotePdf({ quoteId: quote.id, storedPath: pdf.storedPath, archiveRoot, storage });
    assert.deepEqual(again, { status: "unchanged", relativePath: `${folder}/${pdfName}`, multipleFolderMatches: false });
    assert.deepEqual(await filesIn(archiveRoot, folder), [pdfName], "같은 PDF 두 번 → 공유폴더 파일 하나");

    const otherPdf = await attachStoredFile(quote.id, "SIGNED_QUOTE_PDF", new Uint8Array(Buffer.from("%PDF-1.4 다시 받은 결재본")), "pdf");
    const other = await archiveSignedQuotePdf({ quoteId: quote.id, storedPath: otherPdf.storedPath, archiveRoot, storage });
    assert.deepEqual(other, {
      status: "saved",
      relativePath: `${folder}/${numberedQuoteArchiveName(pdfName, 2)}`,
      multipleFolderMatches: false,
    });

    if (templatesReady) {
      // 받은 견적서도 같은 폴더로 간다.
      const issued = expectIssued(await issue(quote.id, archiveRoot));
      assert.equal(issued.result.archive.status, "saved");
      const relativePath = issued.result.archive.status === "saved" ? issued.result.archive.relativePath : "";
      assert.ok(relativePath.startsWith(`${folder}/`), relativePath);
      assert.equal((await filesIn(archiveRoot, YEAR_FOLDER)).length, 1, "견적서 폴더는 하나");
    }
  });

  test("null 루트면 disabled · 실물이 없거나 견적서가 없으면 failed — 던지지 않는다", async () => {
    const quote = await createTestQuote(quoteFields("SIGNED-EDGE"));
    const pdf = await attachStoredFile(quote.id, "SIGNED_QUOTE_PDF", new Uint8Array(Buffer.from("%PDF 없는 실물")), "pdf", {
      placeFile: false,
    });
    const archiveRoot = await makeTempRoot("dss-qi-arc-");

    assert.deepEqual(
      await archiveSignedQuotePdf({ quoteId: quote.id, storedPath: pdf.storedPath, archiveRoot: null, storage }),
      { status: "disabled" }
    );

    const { value: noFile } = await captureConsoleError(() =>
      archiveSignedQuotePdf({ quoteId: quote.id, storedPath: pdf.storedPath, archiveRoot, storage })
    );
    assert.equal(noFile.status, "failed");

    const { value: noQuote } = await captureConsoleError(() =>
      archiveSignedQuotePdf({ quoteId: randomUUID().toLowerCase(), storedPath: pdf.storedPath, archiveRoot, storage })
    );
    assert.equal(noQuote.status, "failed");
    assert.deepEqual(await readdir(archiveRoot), []);
  });
});

// ─────────────────────────────────────────────────── 라우트 — 소스로 지킨다

describe("라우트 — 문지기 순서 · 권한 · 이름 · 헤더를 소스로 지킨다", () => {
  const ISSUE_ROUTE = "src/app/api/quotes/[id]/issue/route.ts";
  const GET_ROUTE = "src/app/api/quotes/[id]/xlsx/route.ts";
  const UPLOAD_ROUTE = "src/app/api/quotes/[id]/attachments/route.ts";
  const GLOBAL_HEADERS = [
    "X-Frame-Options",
    "Content-Security-Policy",
    "X-Content-Type-Options",
    "Referrer-Policy",
    "Permissions-Policy",
    "Strict-Transport-Security",
  ];

  function exportedNames(source: string): string[] {
    const names: string[] = [];
    for (const match of source.matchAll(
      /^export\s+(?:async\s+)?(?:function|const|let|var|class|type|interface|enum)\s+([A-Za-z_$][\w$]*)/gm
    )) {
      names.push(match[1]);
    }
    return names.sort();
  }

  test("🔴 [견적서 받기] 통로는 Next 가 정한 이름만 export 한다 — POST 뿐, GET 은 없다", () => {
    const route = readSource(ISSUE_ROUTE);
    assert.deepEqual(exportedNames(route), ["POST", "dynamic", "runtime"]);
    assert.equal(/^export\s*(?:\{|default|\*)/m.test(route), false);
  });

  test("🔴 순서: 출처 → 저장 모드 → 세션 → 살아 있는 계정 · 승인 → quotes WRITE → id → 중심 함수", () => {
    const route = readSource(ISSUE_ROUTE);
    const body = route.slice(route.indexOf("export async function POST"));
    const marks = [
      "isTrustedOrigin(request)",
      'getAuthSource() !== "database"',
      "await readSession()",
      "resolveActingUserForSession(session)",
      'actingUser.approvalStatus !== "APPROVED"',
      'hasPermission(actingUser, "quotes", "WRITE")',
      "isValidQuoteId(id)",
      "getAttachmentStorage()",
      "issueQuoteFile({",
      "resolveQuoteArchiveRoot()",
    ];
    let previous = -1;
    for (const mark of marks) {
      const at = body.indexOf(mark);
      assert.ok(at >= 0, `없다: ${mark}`);
      assert.ok(at > previous, `순서가 어긋났다: ${mark}`);
      previous = at;
    }
    assert.equal(body.includes('"READ"'), false, "🔴 보기 권한(READ)으로 들어오는 길이 없어야 한다");
  });

  test("quotes 영역은 설정 화면에 있고 WRITE 를 고를 수 있다 — 아무도 못 들어오는 통로가 아니다", () => {
    const area = findPermissionArea("quotes");
    assert.ok(area, "설정 화면에 없는 영역");
    assert.ok(
      PERMISSION_LEVELS.indexOf(area.maxMeaningfulLevel) >= PERMISSION_LEVELS.indexOf("WRITE"),
      `상한이 ${area.maxMeaningfulLevel}`
    );
  });

  test("결과 헤더는 새 이름이고 전역 보안 헤더의 이름을 라우트가 붙이지 않는다", () => {
    const route = readSource(ISSUE_ROUTE);
    assert.ok(route.includes("[QUOTE_ISSUE_RESULT_HEADER]: encodeQuoteIssueResult(outcome.result)"));
    assert.ok(route.includes('"Cache-Control": "no-store, must-revalidate"'));
    for (const name of GLOBAL_HEADERS) {
      assert.equal(route.includes(`"${name}"`), false, `전역 헤더와 같은 이름: ${name}`);
    }
    const nextConfig = readSource("next.config.ts");
    assert.equal(nextConfig.toLowerCase().includes(QUOTE_ISSUE_RESULT_HEADER.toLowerCase()), false);
  });

  test("🔴 GET 받기는 그대로 — READ 권한 · 같은 채우기 함수, 부작용(공유폴더 · 첨부)이 없다", () => {
    const route = readSource(GET_ROUTE);
    assert.ok(route.includes('hasPermission(actingUser, "quotes", "READ")'));
    assert.ok(route.includes("workbook = await renderQuoteWorkbook(quote);"));
    for (const sideEffect of ["saveToQuoteArchive", "createAttachmentRecord", "issueQuoteFile", "archiveSignedQuotePdf"]) {
      assert.equal(route.includes(sideEffect), false, `GET 에 부작용이 섞였다: ${sideEffect}`);
    }
    // 채우기는 한 곳 — GET 이 양식 채우개를 따로 부르지 않는다.
    for (const filler of ["fillQuoteWorkbook(", "fillOhQuoteWorkbook(", "fillMatcherQuoteWorkbook("]) {
      assert.equal(route.includes(filler), false, filler);
    }
    assert.deepEqual(exportedNames(route), ["GET", "dynamic", "runtime"]);
  });

  test("올리기 통로 — 결재 PDF 복사는 기록이 성공한 뒤, 결재 PDF 칸일 때만 · 응답 코드는 201 그대로", () => {
    const route = readSource(UPLOAD_ROUTE);
    const recordAt = route.indexOf("created = await createAttachmentRecord({");
    const archiveAt = route.indexOf("archiveSignedQuotePdf({");
    assert.ok(recordAt >= 0 && archiveAt > recordAt, "복사가 기록보다 앞이다");
    const between = route.slice(recordAt, archiveAt);
    assert.ok(between.includes('category === "SIGNED_QUOTE_PDF"'), "결재 PDF 칸일 때만 불러야 한다");
    assert.ok(route.slice(archiveAt).includes("{ status: 201 }"));
    assert.ok(route.includes("displacedAttachmentIds: created.displacedAttachmentIds,"), "기존 칸은 그대로");
  });
});
