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
  products,
  repairCaseIntakeSequences,
  repairCases,
  users,
} from "../schema";
import { createRepairCase } from "./repair-cases";
import { createAttachmentRecord } from "./attachments";
import { restoreAttachment, softDeleteAttachment } from "./attachment-trash";
import { getAttachmentForDownload } from "../queries/attachment-download";
import { listAttachmentsForRepairCase } from "../queries/attachments";
import { buildAttachmentStoredPath, resolveAttachmentAbsolutePath } from "@/lib/domain/attachment-path";
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
