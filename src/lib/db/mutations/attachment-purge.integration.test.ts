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
import { softDeleteAttachment } from "./attachment-trash";
import { purgeAttachment } from "./attachment-purge";
import {
  buildAttachmentPreviewPath,
  buildAttachmentStoredPath,
  buildProductModelAttachmentStoredPath,
  buildProductModelKindAttachmentStoredPath,
  resolveAttachmentAbsolutePath,
} from "@/lib/domain/attachment-path";
import { MAX_ATTACHMENT_SIZE_BYTES } from "@/lib/domain/attachment-allowlist";
import { createLocalFileSystemStorageAdapter } from "@/lib/storage/local-fs-adapter";
import type { StorageAdapter } from "@/lib/storage/storage-adapter";
import type { ValidatedCreateRepairCaseInput } from "@/lib/validation/repair-case-input";

/**
 * ============================================================================
 * 첨부 영구 삭제 — 행도 파일도 진짜 사라지는가, 남겨야 할 것은 남는가
 * ============================================================================
 * 이웃(attachment-trash.integration.test.ts)이 붙잡는 성질은 「지워도 실물은
 * 남는다」였다. 이 스위트는 **정반대**를 붙잡는다 — 행이 DELETE 되고 디스크의
 * 파일까지 사라진다. 되돌릴 수 없는 길이라, 틀린 것을 지우지 않는 울타리 쪽을 더
 * 많이 본다.
 *
 * 확인하는 것:
 *  1. 🔴 **휴지통에 있는 것만** 지운다 — 살아 있는 행은 거절하고, 그때 행도 파일도
 *     그대로다(화면이 단추를 안 그려도 서버가 다시 본다)
 *  2. 🔴 행이 **실제로 사라진다**(SELECT 로 확인)
 *  3. 🔴 디스크 파일과 **미리보기 파일**이 사라진다 — stat() 으로 실측한다. DB 만
 *     보면 이 사고를 절대 잡지 못한다
 *  4. 🔴 같은 자리를 쓰는 **다른 행**이 있으면 파일을 남긴다(남의 파일을 지우지
 *     않는다) — 행만 지우고, 그 사실을 감사에 적는다
 *  5. 🔴 PURGE 감사 **한 줄**로 무엇이 사라졌는지 알 수 있다 — 행이 없어지므로
 *     그 줄이 유일한 흔적이다. 주인 셋(접수 건 · 모델 · 종류)을 모두 본다
 *  6. 모양이 아닌 id · 없는 id 를 가린다
 *
 * ── 🔴 디스크는 임시 폴더에 쓴다 ─────────────────────────────────────────
 * 실제 저장 루트(UPLOADS_DIR)를 **건드리지 않는다.** 이 스위트가 부르는
 * purgeAttachment 는 StorageAdapter 를 **인자로** 받으므로(그 파일 머리말의 🔴
 * 항목), 여기서 임시 루트로 만든 어댑터를 넘기면 진짜 폴더에는 손이 닿을 길이
 * 없다. 이웃 휴지통 스위트와 같은 방식이고, after() 에서 폴더째 지운다.
 *
 * ── 권한은 여기서 보지 않는다 ────────────────────────────────────────────
 * purgeAttachment 에는 권한 판정이 **없다** — 휴지통과 같은 문(resolveWriteActor)을
 * 서버 액션이 지킨다(server/actions/attachments.ts). 그 문을 영구 삭제도 그대로
 * 쓴다는 사실은 components 목록의 attachment-purge-ui.test.tsx 가 못 박는다.
 *
 * ── 격리 규약 ────────────────────────────────────────────────────────────
 * 접수 월 **"9209"** — 어느 스위트도 쓰지 않는 달이다. 제품 모델 접두사
 * "ATPURGE-TEST-". 감사 로그는 지우지 않는다(append-only) — targetRecordId 로 이
 * 스위트가 만든 줄만 세어 확인한다.
 * ============================================================================
 */

const TEST_RECEIVED_AT = "2092-09-10";
const TEST_SHIPMENT_DATE = "2092-09-20";
const TEST_MODEL_PREFIX = "ATPURGE-TEST-";
/** product_models 행의 이름 접두사 — 위 TEST_MODEL_PREFIX 와 **다른 표**다. */
const TEST_PRODUCT_MODEL_PREFIX = "ATPURGE-TEST-PMODEL-";
const TEST_YEAR_MONTH = "9209";
const TEST_KIND = "GENERATOR" as const;

let customerId: string;
let engineerId: string;
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

async function createTestCase(): Promise<{ id: string; intakeNumber: string }> {
  const created = await createRepairCase(baseCreateInput());
  assert.equal(created.ok, true, `setup create failed: ${JSON.stringify(created)}`);
  if (!created.ok) throw new Error("unreachable");
  createdCaseIds.push(created.id);
  const [row] = await db
    .select({ intakeNumber: repairCases.intakeNumber })
    .from(repairCases)
    .where(eq(repairCases.id, created.id));
  return { id: created.id, intakeNumber: row.intakeNumber };
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

/** 임시 저장 루트의 `relPath` 자리에 실제 바이트를 놓는다. */
async function placeFile(relPath: string): Promise<{ size: number; sha256: string }> {
  const bytes = new Uint8Array(Buffer.from(`영구삭제 시험 ${randomUUID()}\n`, "utf8"));
  const written = await storage.writeTemp(streamOf(bytes), { maxBytes: MAX_ATTACHMENT_SIZE_BYTES });
  await storage.commit(written.tempPath, relPath);
  return { size: written.size, sha256: written.sha256 };
}

/** 접수 건이 주인인 첨부 — 파일을 놓고 기록을 만든다. */
async function storedCaseAttachment(repairCaseId: string): Promise<{
  attachmentId: string;
  storedPath: string;
  absolutePath: string;
  fileSize: number;
  checksum: string;
}> {
  const attachmentId = randomUUID().toLowerCase();
  const storedPath = buildAttachmentStoredPath({ repairCaseId, attachmentId, extension: "txt" });
  const written = await placeFile(storedPath);

  const created = await createAttachmentRecord({
    id: attachmentId,
    owner: { kind: "REPAIR_CASE", repairCaseId },
    category: "INTAKE_PHOTO",
    originalFileName: "인수 사진.txt",
    storedPath,
    mimeType: "text/plain",
    fileSize: written.size,
    checksumSha256: written.sha256,
    description: "영구 삭제 시험용",
    uploadedBy: engineerId,
  });
  createdAttachmentIds.push(created.id);

  return {
    attachmentId,
    storedPath,
    absolutePath: resolveAttachmentAbsolutePath(storageRoot, storedPath),
    fileSize: written.size,
    checksum: written.sha256,
  };
}

/** 제품 모델이 주인인 첨부. */
async function storedModelAttachment(productModelId: string): Promise<{ attachmentId: string; storedPath: string }> {
  const attachmentId = randomUUID().toLowerCase();
  const storedPath = buildProductModelAttachmentStoredPath({
    productModelId,
    attachmentId,
    extension: "txt",
  });
  const written = await placeFile(storedPath);

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
  return { attachmentId, storedPath };
}

/** 제품 **종류**가 주인인 공통 서류 — 주인이 행이 아니라 enum 값이다. */
async function storedKindAttachment(): Promise<{ attachmentId: string; storedPath: string }> {
  const attachmentId = randomUUID().toLowerCase();
  const storedPath = buildProductModelKindAttachmentStoredPath({
    kind: TEST_KIND,
    attachmentId,
    extension: "txt",
  });
  const written = await placeFile(storedPath);

  const created = await createAttachmentRecord({
    id: attachmentId,
    owner: { kind: "PRODUCT_MODEL_KIND", productModelKind: TEST_KIND },
    category: "CHECKLIST",
    originalFileName: "공통 점검표.txt",
    storedPath,
    mimeType: "text/plain",
    fileSize: written.size,
    checksumSha256: written.sha256,
    description: null,
    uploadedBy: engineerId,
  });
  createdAttachmentIds.push(created.id);
  return { attachmentId, storedPath };
}

async function createTestProductModel(): Promise<{ id: string; modelName: string }> {
  const modelName = `${TEST_PRODUCT_MODEL_PREFIX}${randomUUID().slice(0, 8)}`;
  const [row] = await db.insert(productModels).values({ modelName }).returning({ id: productModels.id });
  return { id: row.id, modelName };
}

/** 휴지통으로 보낸다 — 영구 삭제의 전제다. */
async function trash(attachmentId: string, reason: string): Promise<void> {
  const result = await softDeleteAttachment({ attachmentId, actorUserId: engineerId, reason });
  assert.equal(result.ok, true, `시험 준비 단계의 휴지통 이동이 실패했다: ${JSON.stringify(result)}`);
}

async function rowExists(attachmentId: string): Promise<boolean> {
  const rows = await db.select({ id: attachments.id }).from(attachments).where(eq(attachments.id, attachmentId));
  return rows.length > 0;
}

async function existsOnDisk(absolutePath: string): Promise<boolean> {
  try {
    const info = await stat(absolutePath);
    return info.isFile();
  } catch {
    return false;
  }
}

/** 이 첨부의 PURGE 감사 줄 하나를 통째로 꺼낸다. 정확히 하나여야 한다. */
async function purgeAuditRow(attachmentId: string): Promise<{
  actorUserId: string | null;
  targetEntity: string;
  previousValue: Record<string, unknown>;
  newValue: unknown;
}> {
  const rows = await db
    .select({
      actorUserId: auditLogs.actorUserId,
      actionType: auditLogs.actionType,
      targetEntity: auditLogs.targetEntity,
      previousValue: auditLogs.previousValue,
      newValue: auditLogs.newValue,
    })
    .from(auditLogs)
    .where(eq(auditLogs.targetRecordId, attachmentId));

  const purges = rows.filter((row) => row.actionType === "PURGE");
  assert.equal(purges.length, 1, "PURGE 감사 줄이 정확히 하나여야 한다");
  return {
    actorUserId: purges[0].actorUserId,
    targetEntity: purges[0].targetEntity,
    previousValue: purges[0].previousValue as Record<string, unknown>,
    newValue: purges[0].newValue,
  };
}

async function purgeAuditCount(attachmentId: string): Promise<number> {
  const rows = await db
    .select({ actionType: auditLogs.actionType })
    .from(auditLogs)
    .where(and(eq(auditLogs.targetEntity, "attachments"), eq(auditLogs.targetRecordId, attachmentId)));
  return rows.filter((row) => row.actionType === "PURGE").length;
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

  storageRoot = await mkdtemp(path.join(tmpdir(), "dss-attach-purge-test-"));
  storage = createLocalFileSystemStorageAdapter(storageRoot);
});

after(async () => {
  if (createdAttachmentIds.length > 0) {
    await db.delete(attachments).where(inArray(attachments.id, createdAttachmentIds));
  }
  await db.delete(repairCases).where(like(repairCases.intakeNumber, `D${TEST_YEAR_MONTH}%`));
  await db.delete(products).where(like(products.modelName, `${TEST_MODEL_PREFIX}%`));
  // 첨부 행을 먼저 지운 뒤다 — 남아 있으면 ON DELETE SET NULL 로 주인만 끊긴 채
  // 이 스위트의 행이 표에 남는다.
  await db.delete(productModels).where(like(productModels.modelName, `${TEST_PRODUCT_MODEL_PREFIX}%`));
  await db
    .delete(repairCaseIntakeSequences)
    .where(eq(repairCaseIntakeSequences.yearMonth, TEST_YEAR_MONTH));

  if (storageRoot) {
    await rm(storageRoot, { recursive: true, force: true });
  }
  await pgClient.end({ timeout: 5 });
});

describe("① 🔴 휴지통에 있는 것만 지운다 — 살아 있는 행은 거절", () => {
  test("살아 있는 첨부에 걸면 NOT_IN_TRASH 이고, 행도 파일도 그대로다", async () => {
    const testCase = await createTestCase();
    const file = await storedCaseAttachment(testCase.id);

    const result = await purgeAttachment(storage, {
      attachmentId: file.attachmentId,
      actorUserId: engineerId,
    });

    assert.equal(result.ok, false);
    if (result.ok) throw new Error("unreachable");
    assert.equal(result.code, "NOT_IN_TRASH");
    // 무엇을 먼저 해야 하는지까지 말한다 — 「안 됩니다」로 끝내지 않는다.
    assert.match(result.message, /휴지통/);

    assert.equal(await rowExists(file.attachmentId), true, "거절했는데 행이 사라졌다");
    assert.equal(await existsOnDisk(file.absolutePath), true, "거절했는데 파일이 사라졌다");
    assert.equal(await purgeAuditCount(file.attachmentId), 0, "거절했는데 PURGE 줄이 남았다");
  });

  test("휴지통으로 보낸 **뒤에는** 같은 첨부가 지워진다 — 울타리는 상태 하나다", async () => {
    const testCase = await createTestCase();
    const file = await storedCaseAttachment(testCase.id);

    const rejected = await purgeAttachment(storage, {
      attachmentId: file.attachmentId,
      actorUserId: engineerId,
    });
    assert.equal(rejected.ok, false);

    await trash(file.attachmentId, "시험 — 잘못 올림");
    const accepted = await purgeAttachment(storage, {
      attachmentId: file.attachmentId,
      actorUserId: engineerId,
    });
    assert.equal(accepted.ok, true, JSON.stringify(accepted));
  });
});

describe("② 🔴 행이 사라지고 디스크 파일·미리보기 파일도 사라진다", () => {
  test("DELETE 다 — 플래그가 아니라 행 자체가 없다", async () => {
    const testCase = await createTestCase();
    const file = await storedCaseAttachment(testCase.id);
    await trash(file.attachmentId, "시험 — 영구 삭제 대상");

    const result = await purgeAttachment(storage, {
      attachmentId: file.attachmentId,
      actorUserId: engineerId,
    });
    assert.equal(result.ok, true, JSON.stringify(result));

    assert.equal(await rowExists(file.attachmentId), false, "행이 남았다");
    assert.equal(await existsOnDisk(file.absolutePath), false, "디스크 파일이 남았다");
  });

  test("🔴 미리보기 파일도 함께 지운다 — 남으면 지운 파일의 그림이 계속 보인다", async () => {
    const testCase = await createTestCase();
    const file = await storedCaseAttachment(testCase.id);

    // 미리보기는 브라우저가 따로 만들어 보낸다(api/attachments/[id]/preview) —
    // 행이 생기는 순간에는 늘 NULL 이라, 시험에서는 그 뒤 상태를 직접 만든다.
    const previewPath = buildAttachmentPreviewPath({
      repairCaseId: testCase.id,
      attachmentId: file.attachmentId,
    });
    await placeFile(previewPath);
    await db
      .update(attachments)
      .set({ previewPath })
      .where(eq(attachments.id, file.attachmentId));
    const previewAbsolute = resolveAttachmentAbsolutePath(storageRoot, previewPath);
    assert.equal(await existsOnDisk(previewAbsolute), true, "시험 준비가 미리보기를 못 놓았다");

    await trash(file.attachmentId, "시험 — 미리보기까지");
    const result = await purgeAttachment(storage, {
      attachmentId: file.attachmentId,
      actorUserId: engineerId,
    });

    assert.equal(result.ok, true, JSON.stringify(result));
    if (!result.ok) throw new Error("unreachable");
    assert.deepEqual([...result.removedPaths].sort(), [file.storedPath, previewPath].sort());
    assert.deepEqual(result.retainedPaths, []);
    assert.deepEqual(result.failedPaths, []);

    assert.equal(await existsOnDisk(file.absolutePath), false, "원본이 남았다");
    assert.equal(await existsOnDisk(previewAbsolute), false, "썸네일이 남았다");

    const audit = await purgeAuditRow(file.attachmentId);
    assert.equal(audit.previousValue.previewPath, previewPath);
    assert.equal(audit.previousValue.storedFileRetained, false);
  });
});

describe("③ 🔴 같은 자리를 다른 행이 쓰고 있으면 파일을 남긴다", () => {
  test("행만 지우고 디스크는 그대로 — 남의 파일을 지우지 않는다", async () => {
    const testCase = await createTestCase();
    const file = await storedCaseAttachment(testCase.id);

    // 같은 stored_path 를 가리키는 **다른** 행. stored_path 에 고유 제약이 없어
    // 만들어진다(지금 코드가 이렇게 쓰지 않을 뿐이다).
    const twinId = randomUUID().toLowerCase();
    const twin = await createAttachmentRecord({
      id: twinId,
      owner: { kind: "REPAIR_CASE", repairCaseId: testCase.id },
      category: "INTAKE_PHOTO",
      originalFileName: "같은 자리를 가리키는 다른 기록.txt",
      storedPath: file.storedPath,
      mimeType: "text/plain",
      fileSize: file.fileSize,
      checksumSha256: file.checksum,
      description: null,
      uploadedBy: engineerId,
    });
    createdAttachmentIds.push(twin.id);

    await trash(file.attachmentId, "시험 — 자리를 나눠 쓴다");
    const result = await purgeAttachment(storage, {
      attachmentId: file.attachmentId,
      actorUserId: engineerId,
    });

    assert.equal(result.ok, true, JSON.stringify(result));
    if (!result.ok) throw new Error("unreachable");
    assert.deepEqual(result.removedPaths, []);
    assert.deepEqual(result.retainedPaths, [file.storedPath]);

    assert.equal(await rowExists(file.attachmentId), false, "행이 남았다");
    assert.equal(await rowExists(twin.id), true, "남의 행까지 지웠다");
    assert.equal(await existsOnDisk(file.absolutePath), true, "🔴 남의 파일을 지웠다");

    // 🔴 그 사실이 감사에 적혀야 한다 — 행이 없어졌으므로 이 줄 말고는 알 길이 없다.
    const audit = await purgeAuditRow(file.attachmentId);
    assert.equal(audit.previousValue.storedFileRetained, true);
    assert.deepEqual(audit.previousValue.retainedFilePaths, [file.storedPath]);
    assert.deepEqual(audit.previousValue.purgedFilePaths, []);
  });
});

describe("④ 🔴 PURGE 감사 한 줄로 무엇이 사라졌는지 안다", () => {
  test("접수 건 첨부 — 주인 · 접수번호 · 경로 · 체크섬 · 휴지통 사유까지", async () => {
    const testCase = await createTestCase();
    const file = await storedCaseAttachment(testCase.id);
    await trash(file.attachmentId, "시험 — 감사 줄 확인");

    const result = await purgeAttachment(storage, {
      attachmentId: file.attachmentId,
      actorUserId: engineerId,
    });
    assert.equal(result.ok, true, JSON.stringify(result));

    const audit = await purgeAuditRow(file.attachmentId);
    assert.equal(audit.actorUserId, engineerId);
    assert.equal(audit.targetEntity, "attachments");
    // 🔴 newValue 는 null 이다 — 뒤에 남은 상태가 없다.
    assert.equal(audit.newValue, null);

    const previous = audit.previousValue;
    assert.equal(previous.ownerType, "REPAIR_CASE");
    assert.equal(previous.repairCaseId, testCase.id);
    assert.equal(previous.intakeNumber, testCase.intakeNumber);
    // 주인이 아닌 키는 아예 싣지 않는다(ownerAuditFields 관례).
    assert.equal("productModelId" in previous, false);
    assert.equal("quoteId" in previous, false);
    assert.equal("productModelKind" in previous, false);

    assert.equal(previous.category, "INTAKE_PHOTO");
    assert.equal(previous.originalFileName, "인수 사진.txt");
    assert.equal(previous.storedPath, file.storedPath);
    assert.equal(previous.previewPath, null);
    assert.equal(previous.mimeType, "text/plain");
    assert.equal(previous.fileSize, file.fileSize);
    assert.equal(previous.checksumSha256, file.checksum);
    assert.equal(previous.malwareScanStatus, "NOT_SCANNED");
    assert.equal(previous.description, "영구 삭제 시험용");
    assert.equal(previous.uploadedBy, engineerId);
    assert.equal(typeof previous.uploadedAt, "string");

    // 🔴 휴지통에 넣을 때 받은 사유가 여기 함께 실린다 — 그래서 영구 삭제
    // 확인 창은 사유를 다시 받지 않는다.
    assert.equal(previous.isDeleted, true);
    assert.equal(previous.deletedBy, engineerId);
    assert.equal(previous.deleteReason, "시험 — 감사 줄 확인");
    assert.equal(typeof previous.deletedAt, "string");

    assert.deepEqual(previous.purgedFilePaths, [file.storedPath]);
    assert.equal(previous.storedFileRetained, false);
  });

  test("모델 첨부 — 모델명이 함께 실린다(UUID 만 남으면 읽을 수 없다)", async () => {
    const model = await createTestProductModel();
    const file = await storedModelAttachment(model.id);
    await trash(file.attachmentId, "시험 — 모델 첨부");

    const result = await purgeAttachment(storage, {
      attachmentId: file.attachmentId,
      actorUserId: engineerId,
    });
    assert.equal(result.ok, true, JSON.stringify(result));

    const previous = (await purgeAuditRow(file.attachmentId)).previousValue;
    assert.equal(previous.ownerType, "PRODUCT_MODEL");
    assert.equal(previous.productModelId, model.id);
    assert.equal(previous.modelName, model.modelName);
    assert.equal("repairCaseId" in previous, false);
    assert.equal(previous.storedPath, file.storedPath);
    assert.equal(await rowExists(file.attachmentId), false);
  });

  test("종류 공통 서류 — 주인이 행이 아니라 분류다(코드 자체가 이름이다)", async () => {
    const file = await storedKindAttachment();
    await trash(file.attachmentId, "시험 — 종류 서류");

    const result = await purgeAttachment(storage, {
      attachmentId: file.attachmentId,
      actorUserId: engineerId,
    });
    assert.equal(result.ok, true, JSON.stringify(result));

    const previous = (await purgeAuditRow(file.attachmentId)).previousValue;
    assert.equal(previous.ownerType, "PRODUCT_MODEL_KIND");
    assert.equal(previous.productModelKind, TEST_KIND);
    assert.equal(previous.category, "CHECKLIST");
    assert.equal(await rowExists(file.attachmentId), false);
    assert.equal(
      await existsOnDisk(resolveAttachmentAbsolutePath(storageRoot, file.storedPath)),
      false
    );
  });
});

describe("⑤ 모양이 아닌 id · 없는 id", () => {
  test("UUID 모양이 아니면 DB 를 보기 전에 거절한다", async () => {
    const result = await purgeAttachment(storage, {
      attachmentId: "not-a-uuid",
      actorUserId: engineerId,
    });
    assert.equal(result.ok, false);
    if (result.ok) throw new Error("unreachable");
    assert.equal(result.code, "INVALID_ID");
  });

  test("없는 첨부는 NOT_FOUND 다", async () => {
    const result = await purgeAttachment(storage, {
      attachmentId: randomUUID().toLowerCase(),
      actorUserId: engineerId,
    });
    assert.equal(result.ok, false);
    if (result.ok) throw new Error("unreachable");
    assert.equal(result.code, "NOT_FOUND");
  });

  test("두 번째 영구 삭제는 NOT_FOUND 다 — 조용히 성공하지 않는다", async () => {
    const testCase = await createTestCase();
    const file = await storedCaseAttachment(testCase.id);
    await trash(file.attachmentId, "시험 — 두 번 누르기");

    const first = await purgeAttachment(storage, {
      attachmentId: file.attachmentId,
      actorUserId: engineerId,
    });
    assert.equal(first.ok, true, JSON.stringify(first));

    const second = await purgeAttachment(storage, {
      attachmentId: file.attachmentId,
      actorUserId: engineerId,
    });
    assert.equal(second.ok, false);
    if (second.ok) throw new Error("unreachable");
    assert.equal(second.code, "NOT_FOUND");
    // 🔴 감사 줄이 두 번 생기지 않는다.
    assert.equal(await purgeAuditCount(file.attachmentId), 1);
  });
});
