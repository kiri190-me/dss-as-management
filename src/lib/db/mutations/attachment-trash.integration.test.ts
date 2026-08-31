import "../../../../scripts/load-env";

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { and, eq, inArray, like } from "drizzle-orm";

import { db, pgClient } from "../connection";
import {
  attachments,
  auditLogs,
  customers,
  productModels,
  products,
  repairCaseIntakeSequences,
  repairCases,
  users,
} from "../schema";
import { createRepairCase } from "./repair-cases";
import { createAttachmentRecord } from "./attachments";
import {
  recordAttachmentDownload,
  restoreAttachment,
  softDeleteAttachment,
} from "./attachment-trash";
import { getAttachmentForDownload } from "../queries/attachment-download";
import { listAttachmentsForRepairCase } from "../queries/attachments";
import {
  buildAttachmentStoredPath,
  buildProductModelAttachmentStoredPath,
  resolveAttachmentAbsolutePath,
} from "@/lib/domain/attachment-path";
import { MAX_ATTACHMENT_SIZE_BYTES } from "@/lib/domain/attachment-allowlist";
import { decideAttachmentDownload } from "@/lib/domain/attachment-download-policy";
import { createLocalFileSystemStorageAdapter } from "@/lib/storage/local-fs-adapter";
import type { StorageAdapter } from "@/lib/storage/storage-adapter";
import type { ValidatedCreateRepairCaseInput } from "@/lib/validation/repair-case-input";

/**
 * ============================================================================
 * 첨부 휴지통 — 지워도 실물은 남는가, 되살리면 다시 받아지는가
 * ============================================================================
 * 이 스위트가 붙잡는 성질은 하나로 요약된다: **휴지통은 표시일 뿐이고 파일은
 * 남는다.** 이것이 깨지면 복원 버튼은 남아 있는데 눌러도 빈 기록만 되살아나고,
 * 그건 되돌릴 수 없는 손실이다. 그래서 지운 뒤 **디스크를 실제로 stat()** 해서
 * 파일이 그 자리에 있는지 본다 — DB만 보면 이 사고를 절대 잡지 못한다.
 *
 * 확인하는 것:
 *  1. 소프트 삭제가 네 칸을 채우고 FILE_DELETE 감사를 남기는가
 *  2. **디스크 파일이 그대로 있는가** ← 이 스위트의 핵심
 *  3. 지운 뒤 다운로드 판정이 막는가, 복원하면 다시 허용하는가
 *  4. 목록 조회에서 빠지고, 다운로드 조회에서는 여전히 찾아지는가
 *     (없는 것과 휴지통에 있는 것을 구분해야 한다)
 *  5. 두 번 지우기·두 번 복원하기를 조용히 성공시키지 않는가
 *  6. 잠긴 접수 건의 첨부는 지우지도 되살리지도 못하는가
 *  7. **감사 기록에 파일의 주인이 남는가** — 접수 건이든 모델이든, 주인이
 *     아무도 없든. 감사 기록은 나중에 소급해서 채울 수 없으므로 이것이 빠진
 *     기간은 영영 불완전해진다.
 *  8. **내려받기 기록(FILE_DOWNLOAD)의 모양** — 이 파일에 함께 사는
 *     recordAttachmentDownload가 남기는 줄. 같은 이유로 여기서 붙잡는다.
 *
 * ── 디스크는 임시 폴더에 쓴다 ────────────────────────────────────────────
 * 실제 저장 루트(UPLOADS_DIR)를 건드리지 않는다. 어댑터를 임시 루트로 직접
 * 만들어 after()에서 폴더째 지운다.
 *
 * ── 격리 규약 ────────────────────────────────────────────────────────────
 * 접수 월 **"9707"** — 9705(결재 대기)·9706(첨부 저장)과 겹치지 않는 달을 쓴다.
 * 제품 모델 접두사 "ATTRASH-TEST-". 감사 로그는 지우지 않는다 — append-only이고
 * 테스트가 그 표를 건드리지 못하게 하는 것이 test-cleanup-static-safety의
 * 규칙이다. 대신 targetRecordId 로 이 스위트가 만든 행만 세어 확인한다.
 * ============================================================================
 */

const TEST_RECEIVED_AT = "2097-07-10";
const TEST_SHIPMENT_DATE = "2097-07-20";
const TEST_MODEL_PREFIX = "ATTRASH-TEST-";
/**
 * product_models 행의 이름 접두사. 위 TEST_MODEL_PREFIX(products 표의 model_name)
 * 와 **다른 표**를 가리키므로 접두사도 따로 둔다 — attachments.integration.test
 * 와 같은 규약이다.
 */
const TEST_PRODUCT_MODEL_PREFIX = "ATTRASH-TEST-PMODEL-";
const TEST_YEAR_MONTH = "9707";

let customerId: string;
let engineerId: string;
let adminId: string;
let storageRoot: string;
let storage: StorageAdapter;
const createdCaseIds: string[] = [];
const createdAttachmentIds: string[] = [];

function baseCreateInput(): ValidatedCreateRepairCaseInput {
  const suffix = randomUUID().slice(0, 8);
  return {
    workflowType: "PAID_MATCHER",
    billingType: "PAID",
    customerId,
    endUserId: null,
    assignedEngineerId: engineerId,
    receivedAt: TEST_RECEIVED_AT,
    customerRequestedDueDate: null,
    internalTargetShipmentDate: TEST_SHIPMENT_DATE,
    modelName: `${TEST_MODEL_PREFIX}${suffix}`,
    lotNumber: `LOT-${suffix}`,
    serialNumber: `SN-${suffix}`,
    partNumber: null,
    accessoryList: null,
    externalConditionSummary: null,
    reasonForRemoval: null,
    reportedSymptom: null,
    intakeInspectionResult: null,
    currentDiagnosisSummary: null,
    nextPlannedAction: null,
    notes: null,
    contactName: null,
    contactPhone: null,
    contactEmail: null,
  };
}

async function createTestCase(): Promise<string> {
  const created = await createRepairCase(baseCreateInput());
  assert.equal(created.ok, true, `setup create failed: ${JSON.stringify(created)}`);
  if (!created.ok) throw new Error("unreachable");
  createdCaseIds.push(created.id);
  return created.id;
}

function streamOf(bytes: Uint8Array): ReadableStream<Uint8Array> {
  let offset = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.byteLength) {
        controller.close();
        return;
      }
      controller.enqueue(bytes.slice(offset, offset + 8));
      offset += 8;
    },
  });
}

/** 실제 파일을 임시 저장 루트에 놓고 그 기록을 DB에 만든다. */
async function storedAttachment(repairCaseId: string): Promise<{
  attachmentId: string;
  storedPath: string;
  absolutePath: string;
}> {
  const bytes = new Uint8Array(Buffer.from(`휴지통 시험 ${randomUUID()}\n`, "utf8"));
  const written = await storage.writeTemp(streamOf(bytes), { maxBytes: MAX_ATTACHMENT_SIZE_BYTES });
  const attachmentId = randomUUID().toLowerCase();
  const storedPath = buildAttachmentStoredPath({ repairCaseId, attachmentId, extension: "txt" });
  await storage.commit(written.tempPath, storedPath);

  const created = await createAttachmentRecord({
    id: attachmentId,
    owner: { kind: "REPAIR_CASE", repairCaseId },
    category: "INTAKE_PHOTO",
    originalFileName: "인수 사진.txt",
    storedPath,
    mimeType: "text/plain",
    fileSize: written.size,
    checksumSha256: written.sha256,
    description: null,
    uploadedBy: engineerId,
  });
  createdAttachmentIds.push(created.id);

  return {
    attachmentId,
    storedPath,
    absolutePath: resolveAttachmentAbsolutePath(storageRoot, storedPath),
  };
}

/** 모델 첨부가 붙을 제품 모델 마스터 행. after()가 접두사로 지운다. */
async function createTestProductModel(): Promise<{ id: string; modelName: string }> {
  const modelName = `${TEST_PRODUCT_MODEL_PREFIX}${randomUUID().slice(0, 8)}`;
  const [row] = await db
    .insert(productModels)
    .values({ modelName })
    .returning({ id: productModels.id });
  return { id: row.id, modelName };
}

/** 실제 파일을 놓고 **제품 모델이 주인인** 첨부 기록을 만든다. */
async function storedModelAttachment(productModelId: string): Promise<{ attachmentId: string }> {
  const bytes = new Uint8Array(Buffer.from(`모델 회로도 시험 ${randomUUID()}\n`, "utf8"));
  const written = await storage.writeTemp(streamOf(bytes), { maxBytes: MAX_ATTACHMENT_SIZE_BYTES });
  const attachmentId = randomUUID().toLowerCase();
  const storedPath = buildProductModelAttachmentStoredPath({
    productModelId,
    attachmentId,
    extension: "txt",
  });
  await storage.commit(written.tempPath, storedPath);

  const created = await createAttachmentRecord({
    id: attachmentId,
    owner: { kind: "PRODUCT_MODEL", productModelId },
    category: "CIRCUIT_DIAGRAM",
    originalFileName: "회로도.txt",
    storedPath,
    mimeType: "text/plain",
    fileSize: written.size,
    checksumSha256: written.sha256,
    description: null,
    uploadedBy: engineerId,
  });
  createdAttachmentIds.push(created.id);

  return { attachmentId };
}

/** 이 첨부의 해당 종류 감사 행 하나를 꺼내 newValue를 돌려준다. */
async function auditNewValue(
  attachmentId: string,
  actionType: "FILE_DELETE" | "RESTORE"
): Promise<Record<string, unknown>> {
  const rows = await db
    .select({ newValue: auditLogs.newValue })
    .from(auditLogs)
    .where(
      and(
        eq(auditLogs.targetEntity, "attachments"),
        eq(auditLogs.targetRecordId, attachmentId),
        eq(auditLogs.actionType, actionType)
      )
    );
  assert.equal(rows.length, 1, `${actionType} 감사 행이 정확히 하나여야 한다`);
  return rows[0].newValue as Record<string, unknown>;
}

/** 이 첨부에 대해 남은 감사 행을 종류별로 센다. */
async function auditCounts(attachmentId: string): Promise<Record<string, number>> {
  const rows = await db
    .select({ actionType: auditLogs.actionType })
    .from(auditLogs)
    .where(and(eq(auditLogs.targetEntity, "attachments"), eq(auditLogs.targetRecordId, attachmentId)));
  const counts: Record<string, number> = {};
  for (const row of rows) {
    counts[row.actionType] = (counts[row.actionType] ?? 0) + 1;
  }
  return counts;
}

/**
 * 이 첨부의 **내려받기** 감사 행을 통째로 꺼낸다.
 *
 * auditNewValue와 달리 actionType·targetEntity로 거르지 않고 targetRecordId로만
 * 찾는다 — 걸러 낸 값을 다시 단언하면 아무것도 지키지 못한다. 업로드가 남긴
 * FILE_UPLOAD가 같은 ID로 함께 있으므로, 그중 내려받기 줄이 정확히 하나인지도
 * 여기서 함께 본다.
 */
async function downloadAuditRow(attachmentId: string): Promise<{
  actorUserId: string | null;
  actionType: string;
  targetEntity: string;
  targetRecordId: string;
  previousValue: unknown;
  newValue: Record<string, unknown>;
}> {
  const rows = await db
    .select({
      actorUserId: auditLogs.actorUserId,
      actionType: auditLogs.actionType,
      targetEntity: auditLogs.targetEntity,
      targetRecordId: auditLogs.targetRecordId,
      previousValue: auditLogs.previousValue,
      newValue: auditLogs.newValue,
    })
    .from(auditLogs)
    .where(eq(auditLogs.targetRecordId, attachmentId));

  const downloads = rows.filter((row) => row.actionType === "FILE_DOWNLOAD");
  assert.equal(downloads.length, 1, "FILE_DOWNLOAD 감사 행이 정확히 하나여야 한다");
  return { ...downloads[0], newValue: downloads[0].newValue as Record<string, unknown> };
}

/**
 * 다운로드 라우트가 하는 것과 같은 자리에서 내려받기 기록을 남긴다.
 *
 * 라우트(api/attachments/[id]/download)는 getAttachmentForDownload가 읽어 둔
 * 값을 그대로 넘긴다 — 여기서도 같은 조회를 쓴다. 시험이 손으로 지어낸 값을
 * 넘기면 실제로 실리는 값이 무엇인지는 지켜지지 않는다.
 * 넘긴 값을 그대로 단언할 수 있도록 그 조회 결과를 돌려준다.
 */
async function recordDownloadOf(attachmentId: string, actorUserId: string) {
  const attachment = await getAttachmentForDownload(attachmentId);
  assert.ok(attachment, "시험 준비 단계에서 첨부를 찾지 못했다");
  await recordAttachmentDownload({
    attachmentId: attachment!.id,
    actorUserId,
    owner: {
      repairCaseId: attachment!.repairCaseId,
      productModelId: attachment!.productModelId,
    },
    originalFileName: attachment!.originalFileName,
    fileSize: attachment!.fileSize,
  });
  return attachment!;
}

async function existsOnDisk(absolutePath: string): Promise<boolean> {
  try {
    const info = await stat(absolutePath);
    return info.isFile();
  } catch {
    return false;
  }
}

before(async () => {
  const [customer] = await db
    .select({ id: customers.id })
    .from(customers)
    .where(eq(customers.isDeleted, false))
    .limit(1);
  assert.ok(customer, "expected at least one non-deleted customer in the test DB");
  customerId = customer.id;

  const [engineer] = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        eq(users.role, "AS_ENGINEER"),
        eq(users.approvalStatus, "APPROVED"),
        eq(users.isDeleted, false),
        eq(users.isActive, true)
      )
    )
    .limit(1);
  assert.ok(engineer, "expected an approved AS_ENGINEER in the test DB");
  engineerId = engineer.id;

  const [admin] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.role, "SUPER_ADMIN"), eq(users.isDeleted, false)))
    .limit(1);
  assert.ok(admin, "expected a SUPER_ADMIN in the test DB");
  adminId = admin.id;

  storageRoot = await mkdtemp(path.join(tmpdir(), "dss-attach-trash-test-"));
  storage = createLocalFileSystemStorageAdapter(storageRoot);
});

after(async () => {
  if (createdAttachmentIds.length > 0) {
    await db.delete(attachments).where(inArray(attachments.id, createdAttachmentIds));
  }
  await db.delete(repairCases).where(like(repairCases.intakeNumber, `D${TEST_YEAR_MONTH}%`));
  await db.delete(products).where(like(products.modelName, `${TEST_MODEL_PREFIX}%`));
  // 첨부 행을 먼저 지운 뒤다 — 남아 있으면 ON DELETE SET NULL 로 주인만 끊긴
  // 채 이 스위트의 행이 표에 남는다.
  await db.delete(productModels).where(like(productModels.modelName, `${TEST_PRODUCT_MODEL_PREFIX}%`));
  await db.delete(repairCaseIntakeSequences).where(eq(repairCaseIntakeSequences.yearMonth, TEST_YEAR_MONTH));

  if (storageRoot) {
    await rm(storageRoot, { recursive: true, force: true });
  }
  await pgClient.end({ timeout: 5 });
});

// ─────────────────────────────────────── 1. 지워도 실물은 남는다

describe("attachment 휴지통: 표시만 하고 파일은 남긴다", () => {
  test("소프트 삭제가 네 칸을 채우고 FILE_DELETE 감사를 남긴다", async () => {
    const caseId = await createTestCase();
    const { attachmentId } = await storedAttachment(caseId);

    const result = await softDeleteAttachment({
      attachmentId,
      actorUserId: adminId,
      reason: "잘못 올림",
    });
    assert.equal(result.ok, true, JSON.stringify(result));

    const [row] = await db
      .select({
        isDeleted: attachments.isDeleted,
        deletedAt: attachments.deletedAt,
        deletedBy: attachments.deletedBy,
        deleteReason: attachments.deleteReason,
      })
      .from(attachments)
      .where(eq(attachments.id, attachmentId));

    assert.equal(row.isDeleted, true);
    assert.ok(row.deletedAt, "deleted_at이 비어 있다");
    assert.equal(row.deletedBy, adminId);
    assert.equal(row.deleteReason, "잘못 올림");

    const counts = await auditCounts(attachmentId);
    assert.equal(counts.FILE_DELETE, 1, "FILE_DELETE 감사가 남아야 한다");
  });

  test("★ 지운 뒤에도 디스크 파일이 그대로 있다 — 이것이 깨지면 복원이 불가능해진다", async () => {
    const caseId = await createTestCase();
    const { attachmentId, absolutePath } = await storedAttachment(caseId);

    assert.equal(await existsOnDisk(absolutePath), true, "시험 준비 단계에서 파일이 없다");

    const result = await softDeleteAttachment({ attachmentId, actorUserId: adminId, reason: null });
    assert.equal(result.ok, true, JSON.stringify(result));

    assert.equal(
      await existsOnDisk(absolutePath),
      true,
      "휴지통으로 옮겼는데 디스크 파일이 사라졌다 — 복원해도 빈 기록만 돌아온다"
    );
  });

  test("복원하면 네 칸이 비고 RESTORE 감사가 남는다. 파일도 그대로다", async () => {
    const caseId = await createTestCase();
    const { attachmentId, absolutePath } = await storedAttachment(caseId);

    await softDeleteAttachment({ attachmentId, actorUserId: adminId, reason: "실수" });
    const restored = await restoreAttachment({ attachmentId, actorUserId: adminId });
    assert.equal(restored.ok, true, JSON.stringify(restored));

    const [row] = await db
      .select({
        isDeleted: attachments.isDeleted,
        deletedAt: attachments.deletedAt,
        deletedBy: attachments.deletedBy,
        deleteReason: attachments.deleteReason,
      })
      .from(attachments)
      .where(eq(attachments.id, attachmentId));

    assert.equal(row.isDeleted, false);
    assert.equal(row.deletedAt, null);
    assert.equal(row.deletedBy, null);
    assert.equal(row.deleteReason, null, "삭제 사유가 남아 있으면 다음 삭제 기록과 섞인다");

    const counts = await auditCounts(attachmentId);
    assert.equal(counts.FILE_DELETE, 1);
    assert.equal(counts.RESTORE, 1);

    assert.equal(await existsOnDisk(absolutePath), true);
  });
});

// ─────────────────────────────────── 2. 다운로드 판정과 맞물리는가

describe("attachment 휴지통: 다운로드가 막히고 복원하면 다시 열린다", () => {
  test("지우면 판정이 DELETED로 막고, 복원하면 다시 허용한다", async () => {
    const caseId = await createTestCase();
    const { attachmentId } = await storedAttachment(caseId);

    const before = await getAttachmentForDownload(attachmentId);
    assert.ok(before);
    assert.equal(decideAttachmentDownload(before!).allowed, true);

    await softDeleteAttachment({ attachmentId, actorUserId: adminId, reason: null });

    const during = await getAttachmentForDownload(attachmentId);
    assert.ok(during, "휴지통에 있어도 조회는 찾아내야 한다 — 없는 것과 구분해야 하기 때문이다");
    const blocked = decideAttachmentDownload(during!);
    assert.equal(blocked.allowed, false);
    assert.equal(blocked.allowed === false && blocked.reason, "DELETED");

    await restoreAttachment({ attachmentId, actorUserId: adminId });

    const afterRestore = await getAttachmentForDownload(attachmentId);
    assert.ok(afterRestore);
    assert.equal(decideAttachmentDownload(afterRestore!).allowed, true);
  });

  test("목록 조회에서는 빠지지만 다운로드 조회에서는 찾아진다", async () => {
    const caseId = await createTestCase();
    const { attachmentId } = await storedAttachment(caseId);

    const listedBefore = await listAttachmentsForRepairCase(caseId);
    assert.equal(listedBefore.some((item) => item.id === attachmentId), true);

    await softDeleteAttachment({ attachmentId, actorUserId: adminId, reason: null });

    const listedAfter = await listAttachmentsForRepairCase(caseId);
    assert.equal(
      listedAfter.some((item) => item.id === attachmentId),
      false,
      "목록은 휴지통 항목을 보이지 않는다"
    );
    // 그런데 다운로드 조회는 여전히 찾아야 한다 — 그래야 "없음(404)"과
    // "휴지통에 있음(복원하면 됨)"을 다른 답으로 돌려줄 수 있다.
    assert.ok(await getAttachmentForDownload(attachmentId));
  });
});

// ─────────────────────────────────── 3. 같은 동작을 두 번

describe("attachment 휴지통: 두 번 눌러도 조용히 성공하지 않는다", () => {
  test("이미 휴지통에 있는 것을 또 지우면 거절한다", async () => {
    const caseId = await createTestCase();
    const { attachmentId } = await storedAttachment(caseId);

    await softDeleteAttachment({ attachmentId, actorUserId: adminId, reason: null });
    const second = await softDeleteAttachment({ attachmentId, actorUserId: adminId, reason: null });

    assert.equal(second.ok, false);
    assert.equal(second.ok === false && second.code, "ALREADY_IN_STATE");

    // 감사 행이 두 번 남지 않았다 — 거절된 시도는 기록을 만들지 않는다.
    const counts = await auditCounts(attachmentId);
    assert.equal(counts.FILE_DELETE, 1);
  });

  test("휴지통에 없는 것을 복원하면 거절한다", async () => {
    const caseId = await createTestCase();
    const { attachmentId } = await storedAttachment(caseId);

    const result = await restoreAttachment({ attachmentId, actorUserId: adminId });
    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.code, "ALREADY_IN_STATE");

    const counts = await auditCounts(attachmentId);
    assert.equal(counts.RESTORE, undefined, "거절된 복원이 감사를 남겼다");
  });

  test("없는 첨부는 NOT_FOUND, 형식이 아닌 id는 INVALID_ID", async () => {
    const missing = await softDeleteAttachment({
      attachmentId: randomUUID().toLowerCase(),
      actorUserId: adminId,
      reason: null,
    });
    assert.equal(missing.ok, false);
    assert.equal(missing.ok === false && missing.code, "NOT_FOUND");

    const malformed = await restoreAttachment({ attachmentId: "not-a-uuid", actorUserId: adminId });
    assert.equal(malformed.ok, false);
    assert.equal(malformed.ok === false && malformed.code, "INVALID_ID");
  });
});

// ─────────────────────────────────── 4. 잠긴 접수 건

describe("attachment 휴지통: 출하 완료로 잠긴 건", () => {
  test("잠긴 건의 첨부는 지울 수 없다 — 파일도 그대로 남는다", async () => {
    const caseId = await createTestCase();
    const { attachmentId, absolutePath } = await storedAttachment(caseId);

    await db.update(repairCases).set({ isLocked: true }).where(eq(repairCases.id, caseId));

    const result = await softDeleteAttachment({ attachmentId, actorUserId: adminId, reason: null });
    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.code, "CASE_LOCKED");

    const [row] = await db
      .select({ isDeleted: attachments.isDeleted })
      .from(attachments)
      .where(eq(attachments.id, attachmentId));
    assert.equal(row.isDeleted, false, "거절됐는데 표시가 바뀌었다");
    assert.equal(await existsOnDisk(absolutePath), true);

    // 대조 — 잠금을 풀면 같은 요청이 통한다(막힌 이유가 잠금이었다).
    await db.update(repairCases).set({ isLocked: false }).where(eq(repairCases.id, caseId));
    const retry = await softDeleteAttachment({ attachmentId, actorUserId: adminId, reason: null });
    assert.equal(retry.ok, true, "잠금을 풀었는데도 막혔다 — 다른 이유로 막히고 있다");
  });

  test("잠긴 건의 첨부는 되살릴 수도 없다", async () => {
    const caseId = await createTestCase();
    const { attachmentId } = await storedAttachment(caseId);

    await softDeleteAttachment({ attachmentId, actorUserId: adminId, reason: null });
    await db.update(repairCases).set({ isLocked: true }).where(eq(repairCases.id, caseId));

    const result = await restoreAttachment({ attachmentId, actorUserId: adminId });
    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.code, "CASE_LOCKED");

    // 대조
    await db.update(repairCases).set({ isLocked: false }).where(eq(repairCases.id, caseId));
    const retry = await restoreAttachment({ attachmentId, actorUserId: adminId });
    assert.equal(retry.ok, true);
  });
});

// ─────────────────────────── 5. 감사 기록에 파일의 주인이 남는가

/**
 * 감사 기록은 **나중에 소급해서 채울 수 없다.** 여기서 빠지면 그 기간의 기록이
 * 영영 불완전해지고, 3년 보관하는 로그에서 그 줄들만 "무슨 파일이었는지 알 수
 * 없는 줄"로 남는다. 그래서 세 가지를 나란히 못박는다 — 모델일 때, 접수 건일 때,
 * 주인이 아무도 없을 때.
 */
describe("attachment 휴지통: 감사 기록만 읽어도 어느 파일이었는지 안다", () => {
  test("모델 첨부를 지우면 모델 ID와 모델 이름이 남고, 접수 건 키는 실리지 않는다", async () => {
    const model = await createTestProductModel();
    const { attachmentId } = await storedModelAttachment(model.id);

    const result = await softDeleteAttachment({
      attachmentId,
      actorUserId: adminId,
      reason: "잘못 올린 회로도",
    });
    assert.equal(result.ok, true, JSON.stringify(result));

    const newValue = await auditNewValue(attachmentId, "FILE_DELETE");
    assert.equal(newValue.ownerType, "PRODUCT_MODEL");
    assert.equal(newValue.productModelId, model.id);
    // 🔴 UUID 만 있으면 이 줄을 읽는 사람이 무슨 모델인지 알 수 없다. 접수 건이
    // 접수번호를 함께 남기는 것과 같은 대접이다.
    assert.equal(newValue.modelName, model.modelName);
    // 🔴 주인이 아닌 쪽 키는 아예 싣지 않는다. `repairCaseId: null` 이 남으면
    // 그 줄만 읽는 사람은 접수 건이 지워진 첨부와 구분할 수 없다.
    assert.equal("repairCaseId" in newValue, false, "주인이 아닌 쪽 키가 실렸다");
    assert.equal("intakeNumber" in newValue, false, "주인이 아닌 쪽 이름이 실렸다");
    // 주인과 무관하게 남던 값은 그대로다.
    assert.equal(newValue.category, "CIRCUIT_DIAGRAM");
    assert.equal(newValue.storedFileRetained, true);
    assert.equal(newValue.deleteReason, "잘못 올린 회로도");
  });

  test("모델 첨부를 되살려도 같은 모양으로 남는다", async () => {
    const model = await createTestProductModel();
    const { attachmentId } = await storedModelAttachment(model.id);

    await softDeleteAttachment({ attachmentId, actorUserId: adminId, reason: null });
    const restored = await restoreAttachment({ attachmentId, actorUserId: adminId });
    assert.equal(restored.ok, true, JSON.stringify(restored));

    const newValue = await auditNewValue(attachmentId, "RESTORE");
    assert.equal(newValue.ownerType, "PRODUCT_MODEL");
    assert.equal(newValue.productModelId, model.id);
    assert.equal(newValue.modelName, model.modelName);
    assert.equal("repairCaseId" in newValue, false);
    assert.equal(newValue.category, "CIRCUIT_DIAGRAM");
  });

  test("접수 건 첨부에는 예전 키가 그대로 남는다 — 옛 기록과 모양이 갈라지지 않았다", async () => {
    const caseId = await createTestCase();
    const { attachmentId } = await storedAttachment(caseId);

    const [caseRow] = await db
      .select({ intakeNumber: repairCases.intakeNumber })
      .from(repairCases)
      .where(eq(repairCases.id, caseId));

    await softDeleteAttachment({ attachmentId, actorUserId: adminId, reason: null });
    const deleted = await auditNewValue(attachmentId, "FILE_DELETE");
    assert.equal(deleted.ownerType, "REPAIR_CASE");
    // 🔴 이 두 키가 사라지면 옛 감사 기록과 새 기록을 한 질의로 읽을 수 없다.
    // 이번 변경은 **더하기만** 한다.
    assert.equal(deleted.repairCaseId, caseId);
    assert.equal(deleted.intakeNumber, caseRow.intakeNumber);
    assert.equal(deleted.category, "INTAKE_PHOTO");
    assert.equal(deleted.storedFileRetained, true);
    assert.equal("productModelId" in deleted, false, "주인이 아닌 쪽 키가 실렸다");
    assert.equal("modelName" in deleted, false);

    await restoreAttachment({ attachmentId, actorUserId: adminId });
    const restored = await auditNewValue(attachmentId, "RESTORE");
    assert.equal(restored.ownerType, "REPAIR_CASE");
    assert.equal(restored.repairCaseId, caseId);
    assert.equal(restored.intakeNumber, caseRow.intakeNumber);
    assert.equal(restored.category, "INTAKE_PHOTO");
    assert.equal("productModelId" in restored, false);
  });

  test("주인이 아무도 없는 첨부를 지워도 터지지 않고 NONE 이 남는다", async () => {
    const caseId = await createTestCase();
    const { attachmentId, absolutePath } = await storedAttachment(caseId);

    // 접수 건이 영구 삭제된 뒤의 모습을 그대로 만든다(FK가 ON DELETE SET NULL
    // 이라 두 컬럼이 함께 NULL 이 된다). CHECK 가 막는 것은 "둘 다 찬" 행이지
    // "둘 다 빈" 행이 아니므로 이것은 정상 상태다.
    await db.update(attachments).set({ repairCaseId: null }).where(eq(attachments.id, attachmentId));

    const result = await softDeleteAttachment({ attachmentId, actorUserId: adminId, reason: null });
    assert.equal(result.ok, true, `주인 없는 첨부를 지우지 못했다: ${JSON.stringify(result)}`);

    const newValue = await auditNewValue(attachmentId, "FILE_DELETE");
    // 🔴 "주인이 없었다"와 "기록이 빠졌다"는 다른 사실이다. 키를 아예 빼면 이
    // 코드가 생기기 전의 옛 기록과 구분되지 않는다.
    assert.equal(newValue.ownerType, "NONE");
    assert.equal("repairCaseId" in newValue, false);
    assert.equal("productModelId" in newValue, false);
    assert.equal(newValue.category, "INTAKE_PHOTO");

    // 이 파일의 가장 중요한 성질은 여기서도 그대로다.
    assert.equal(await existsOnDisk(absolutePath), true);
  });
});

// ───────────────────── 6. 내려받기 기록 — 누가 무엇을 받아 갔는가

/**
 * FILE_DOWNLOAD는 **파일 자체보다 오래 남아야 하는 기록**이다(감사 로그 3년
 * 보관). 그런데 이 줄의 모양을 붙잡는 시험이 지금까지 하나도 없었다 — 누가
 * 깨뜨려도 알려 줄 것이 없는 상태였다.
 *
 * 여기서 못박는 것:
 *  1. 한 번 받아 가면 FILE_DOWNLOAD가 attachments · 그 첨부 ID로 **한 줄**
 *  2. 무엇을 받아 갔는지(originalFileName · fileSize)가 넘긴 그대로 남는가
 *  3. 주인이 갈라 적히는가 — 모델 첨부의 기록에 접수 건 칸이 실리면 그 줄은
 *     거짓말을 한다(ownerAuditFields)
 *  4. previousValue가 비어 있는가 — 내려받기는 상태를 바꾸지 않는다
 */
describe("attachment 내려받기: 감사 기록만 읽어도 누가 무엇을 받아 갔는지 안다", () => {
  test("수리 건 첨부를 받아 가면 FILE_DOWNLOAD가 attachments · 그 첨부 ID로 한 줄 남는다", async () => {
    const caseId = await createTestCase();
    const { attachmentId } = await storedAttachment(caseId);

    await recordDownloadOf(attachmentId, adminId);

    const row = await downloadAuditRow(attachmentId);
    assert.equal(row.actionType, "FILE_DOWNLOAD");
    // 🔴 이 두 칸이 어긋나면 나중에 "이 파일을 누가 받아 갔나"를 물을 때
    // 그 줄을 찾을 수 없다 — 감사 로그는 targetEntity + targetRecordId로 찾는다.
    assert.equal(row.targetEntity, "attachments");
    assert.equal(row.targetRecordId, attachmentId);
    assert.equal(row.actorUserId, adminId, "받아 간 사람이 남지 않으면 기록의 뜻이 없다");

    // 업로드가 남긴 FILE_UPLOAD와 섞이지 않는다 — 내려받기 한 번은 한 줄이다.
    const counts = await auditCounts(attachmentId);
    assert.equal(counts.FILE_DOWNLOAD, 1);
    assert.equal(counts.FILE_UPLOAD, 1, "업로드 기록까지 함께 늘었다");
  });

  test("내려받기 기록에 원본 파일명과 파일 크기가 넘긴 그대로 남는다", async () => {
    const caseId = await createTestCase();
    const { attachmentId } = await storedAttachment(caseId);

    const attachment = await recordDownloadOf(attachmentId, adminId);

    const { newValue } = await downloadAuditRow(attachmentId);
    // 🔴 무엇을 받아 갔는지 알 수 없으면 기록의 뜻이 없다. 파일이 3년 뒤
    // 사라져도 이 두 값이 남아 있으면 그 줄은 여전히 답을 한다.
    assert.equal(newValue.originalFileName, attachment.originalFileName);
    assert.equal(newValue.originalFileName, "인수 사진.txt", "저장 경로 같은 다른 값이 실렸다");
    assert.equal(newValue.fileSize, attachment.fileSize);
    assert.equal(typeof newValue.fileSize, "number", "크기가 숫자로 남지 않으면 나중에 합계를 낼 수 없다");
  });

  test("모델 첨부의 내려받기 기록은 모델 쪽에 적힌다 — 접수 건 칸에 값이 실리지 않는다", async () => {
    const model = await createTestProductModel();
    const { attachmentId } = await storedModelAttachment(model.id);

    await recordDownloadOf(attachmentId, adminId);

    const { newValue } = await downloadAuditRow(attachmentId);
    assert.equal(newValue.ownerType, "PRODUCT_MODEL");
    assert.equal(newValue.productModelId, model.id);
    // 🔴 주인이 아닌 쪽 키는 아예 싣지 않는다. `repairCaseId: null`이 남으면
    // 그 줄만 읽는 사람은 접수 건이 지워진 첨부와 구분할 수 없다.
    assert.equal("repairCaseId" in newValue, false, "모델 첨부의 기록에 접수 건 칸이 실렸다");
    assert.equal(newValue.originalFileName, "회로도.txt");
  });

  test("수리 건 첨부의 내려받기 기록에는 접수 건 키만 실린다 — 모델 칸이 섞이지 않는다", async () => {
    const caseId = await createTestCase();
    const { attachmentId } = await storedAttachment(caseId);

    await recordDownloadOf(attachmentId, adminId);

    const { newValue } = await downloadAuditRow(attachmentId);
    assert.equal(newValue.ownerType, "REPAIR_CASE");
    assert.equal(newValue.repairCaseId, caseId);
    assert.equal("productModelId" in newValue, false, "주인이 아닌 쪽 키가 실렸다");
    // 사람이 읽는 이름(접수번호 · 모델명)은 내려받기 기록에만 **일부러** 싣지
    // 않는다 — 그 값을 위해 모든 내려받기가 조인 둘을 더 치를 수는 없다
    // (recordAttachmentDownload 주석). 삭제·복원 기록과 다른 점이라 여기 못박는다.
    assert.equal("intakeNumber" in newValue, false);
    assert.equal("modelName" in newValue, false);
  });

  test("내려받기는 상태를 바꾸지 않으므로 previousValue가 비어 있고 첨부 행도 그대로다", async () => {
    const caseId = await createTestCase();
    const { attachmentId, absolutePath } = await storedAttachment(caseId);

    await recordDownloadOf(attachmentId, adminId);

    const { previousValue } = await downloadAuditRow(attachmentId);
    // 🔴 바꾼 상태가 없는데 이전 값이 실리면, 그 줄을 읽는 사람은 내려받기가
    // 무언가를 바꾼 줄로 읽는다.
    assert.equal(previousValue, null);

    const [row] = await db
      .select({
        isDeleted: attachments.isDeleted,
        deletedAt: attachments.deletedAt,
        deletedBy: attachments.deletedBy,
        deleteReason: attachments.deleteReason,
      })
      .from(attachments)
      .where(eq(attachments.id, attachmentId));
    assert.equal(row.isDeleted, false, "받아 갔을 뿐인데 첨부의 상태가 바뀌었다");
    assert.equal(row.deletedAt, null);
    assert.equal(row.deletedBy, null);
    assert.equal(row.deleteReason, null);

    assert.equal(await existsOnDisk(absolutePath), true);
  });
});
