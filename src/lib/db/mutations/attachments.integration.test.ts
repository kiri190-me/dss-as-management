import "../../../../scripts/load-env";

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, stat, utimes, writeFile } from "node:fs/promises";
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
  getAttachmentUploadTarget,
  getProductModelAttachmentUploadTarget,
  listAttachmentsForRepairCase,
} from "../queries/attachments";
import {
  buildAttachmentStoredPath,
  buildProductModelAttachmentStoredPath,
} from "@/lib/domain/attachment-path";
import { MAX_ATTACHMENT_SIZE_BYTES } from "@/lib/domain/attachment-allowlist";
import { createLocalFileSystemStorageAdapter } from "@/lib/storage/local-fs-adapter";
import { AttachmentTooLargeError, type StorageAdapter } from "@/lib/storage/storage-adapter";
import type { ValidatedCreateRepairCaseInput } from "@/lib/validation/repair-case-input";

/**
 * ============================================================================
 * 첨부 저장 — 파일이 실제로 디스크에 놓이고, 그 기록이 DB에 남는가
 * ============================================================================
 * 확인하는 것은 네 축이다.
 *
 *  1. **저장소 어댑터가 스트림을 제대로 다루는가** — 흘려보내며 센 크기와
 *     SHA-256이 실제 파일과 맞는가, 상한을 넘으면 끊고 임시 파일을 버리는가,
 *     commit이 최종 자리로 옮기는가.
 *  2. **DB에 적히는 stored_path가 NAS로 옮길 수 있는 값인가** — `/` 구분자,
 *     소문자, 상대 경로. 이 셋은 Windows에서는 아무 문제 없이 돌아가다가
 *     Linux 컨테이너로 옮긴 뒤에야 터진다. 단위 테스트
 *     (attachment-path.test.ts)가 만들어지는 쪽을 잡고, 여기서는 **실제로
 *     표에 들어간 값**을 다시 확인한다.
 *  3. **행과 감사 로그가 같은 트랜잭션에서 함께 남는가** — FILE_UPLOAD.
 *  4. **목록 조회가 휴지통과 남의 건을 빼는가.**
 *
 * ── 디스크는 임시 폴더에 쓴다 ────────────────────────────────────────────
 * 운영/개발의 실제 저장 루트(UPLOADS_DIR)를 건드리지 않는다. 어댑터를
 * createLocalFileSystemStorageAdapter(임시 루트)로 직접 만들어, 이 스위트가
 * 만든 파일은 after()에서 폴더째 사라진다.
 *
 * ── 격리 규약 ────────────────────────────────────────────────────────────
 * 이 디렉터리의 다른 통합 테스트와 같다 — 접수 월 "9706"(다른 어떤 스위트도
 * 쓰지 않는 달), 제품 모델 접두사 "ATTACH-TEST-". after()가 이 스위트가 만든
 * 행만 FK 순서대로 지운다. 감사 로그는 지우지 않는다 — audit_logs는
 * append-only이고, 테스트가 그 표를 건드리지 못하게 하는 것이
 * test-cleanup-static-safety.test.ts의 규칙이다.
 * ============================================================================
 */

const TEST_RECEIVED_AT = "2097-06-10";
const TEST_SHIPMENT_DATE = "2097-06-20";
const TEST_MODEL_PREFIX = "ATTACH-TEST-";
/**
 * product_models 행의 이름 접두사. 위 TEST_MODEL_PREFIX(products 표의 model_name)
 * 와 **다른 표**를 가리키므로 접두사도 따로 둔다 — 같은 값을 쓰면 after()의
 * 두 삭제가 서로의 범위를 읽는 것처럼 보여 나중에 읽는 사람을 헷갈리게 한다.
 */
const TEST_PRODUCT_MODEL_PREFIX = "ATTACH-TEST-PMODEL-";
const TEST_YEAR_MONTH = "9706";

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

async function createTestCase(): Promise<string> {
  const created = await createRepairCase(baseCreateInput());
  assert.equal(created.ok, true, `setup create failed: ${JSON.stringify(created)}`);
  if (!created.ok) throw new Error("unreachable");
  createdCaseIds.push(created.id);
  return created.id;
}

/** 모델 첨부가 붙을 제품 모델 마스터 행. after()가 접두사로 지운다. */
async function createTestProductModel(): Promise<string> {
  const [row] = await db
    .insert(productModels)
    .values({ modelName: `${TEST_PRODUCT_MODEL_PREFIX}${randomUUID().slice(0, 8)}` })
    .returning({ id: productModels.id });
  return row.id;
}

function streamOf(bytes: Uint8Array, chunkSize = 8): ReadableStream<Uint8Array> {
  let offset = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.byteLength) {
        controller.close();
        return;
      }
      controller.enqueue(bytes.slice(offset, offset + chunkSize));
      offset += chunkSize;
    },
  });
}

async function storeFile(params: {
  repairCaseId: string;
  bytes: Uint8Array;
  extension: string;
}): Promise<{ attachmentId: string; storedPath: string; size: number; sha256: string }> {
  const written = await storage.writeTemp(streamOf(params.bytes), { maxBytes: MAX_ATTACHMENT_SIZE_BYTES });
  const attachmentId = randomUUID().toLowerCase();
  const storedPath = buildAttachmentStoredPath({
    repairCaseId: params.repairCaseId,
    attachmentId,
    extension: params.extension,
  });
  await storage.commit(written.tempPath, storedPath);
  return { attachmentId, storedPath, size: written.size, sha256: written.sha256 };
}

async function insertRecord(params: {
  repairCaseId: string;
  attachmentId: string;
  storedPath: string;
  size: number;
  sha256: string;
  originalFileName?: string;
  description?: string | null;
}) {
  const result = await createAttachmentRecord({
    id: params.attachmentId,
    owner: { kind: "REPAIR_CASE", repairCaseId: params.repairCaseId },
    category: "INTAKE_PHOTO",
    originalFileName: params.originalFileName ?? "인수 사진.txt",
    storedPath: params.storedPath,
    mimeType: "text/plain",
    fileSize: params.size,
    checksumSha256: params.sha256,
    description: params.description ?? null,
    uploadedBy: engineerId,
  });
  createdAttachmentIds.push(result.id);
  return result;
}

before(async () => {
  const [customer] = await db.select({ id: customers.id }).from(customers).where(eq(customers.isDeleted, false)).limit(1);
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

  storageRoot = await mkdtemp(path.join(tmpdir(), "dss-attachments-test-"));
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

// ─────────────────────────────────────────── 1. 저장소 어댑터 (실제 디스크)

describe("StorageAdapter (로컬 디스크): 스트림으로 받아 크기·체크섬을 함께 센다", () => {
  test("writeTemp가 센 크기와 SHA-256이 실제 바이트와 일치한다", async () => {
    const bytes = new Uint8Array(Buffer.from("시각,전압\n0.000,1.230\n", "utf8"));
    const written = await storage.writeTemp(streamOf(bytes), { maxBytes: MAX_ATTACHMENT_SIZE_BYTES });

    assert.equal(written.size, bytes.byteLength);
    assert.equal(written.sha256, createHash("sha256").update(bytes).digest("hex"));
    assert.match(written.sha256, /^[0-9a-f]{64}$/, "소문자 hex여야 한다");

    // 임시 파일에 실제로 그 바이트가 들어 있다.
    const onDisk = await readFile(written.tempPath);
    assert.deepEqual(new Uint8Array(onDisk), bytes);

    await storage.discard(written.tempPath);
  });

  test("앞머리 바이트를 붙들어 둔다 — 내용 대조에 임시 파일을 다시 열지 않는다", async () => {
    const bytes = new Uint8Array(Buffer.from("%PDF-1.7\nrest of the document", "utf8"));
    const written = await storage.writeTemp(streamOf(bytes, 3), { maxBytes: MAX_ATTACHMENT_SIZE_BYTES });

    assert.deepEqual(written.header.slice(0, 5), bytes.slice(0, 5), "조각이 잘게 나뉘어도 앞머리가 온전하다");
    await storage.discard(written.tempPath);
  });

  test("상한을 넘으면 끊고 임시 파일을 남기지 않는다", async () => {
    const before = await countTempFiles();
    const bytes = new Uint8Array(64).fill(0x41);

    await assert.rejects(
      () => storage.writeTemp(streamOf(bytes), { maxBytes: 16 }),
      AttachmentTooLargeError
    );
    assert.equal(await countTempFiles(), before, "버려야 할 임시 파일이 남았다");
  });

  test("commit이 저장 루트 아래 stored_path 자리에 파일을 놓는다", async () => {
    const repairCaseId = await createTestCase();
    const bytes = new Uint8Array(Buffer.from("commit-target", "utf8"));
    const stored = await storeFile({ repairCaseId, bytes, extension: "txt" });

    const absolute = path.join(storageRoot, "repair-cases", repairCaseId, `${stored.attachmentId}.txt`);
    const info = await stat(absolute);
    assert.ok(info.isFile(), "최종 자리에 실제 파일이 있어야 한다");
    assert.equal(info.size, bytes.byteLength);
    assert.equal(await storage.exists(stored.storedPath), true);

    // 임시 파일은 옮겨졌으므로 더 이상 없다.
    assert.equal(await countTempFiles(), 0);
  });

  test("read가 저장된 바이트를 그대로 돌려주고, delete가 지운다", async () => {
    const repairCaseId = await createTestCase();
    const bytes = new Uint8Array(Buffer.from("read-me-back", "utf8"));
    const stored = await storeFile({ repairCaseId, bytes, extension: "txt" });

    const chunks: Uint8Array[] = [];
    const reader = (await storage.read(stored.storedPath)).getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) chunks.push(value);
    }
    assert.deepEqual(new Uint8Array(Buffer.concat(chunks.map((c) => Buffer.from(c)))), bytes);

    await storage.delete(stored.storedPath);
    assert.equal(await storage.exists(stored.storedPath), false);
    // 없는 파일을 지우는 것은 오류가 아니다.
    await storage.delete(stored.storedPath);
  });

  test("저장 루트 밖을 가리키는 경로는 어떤 조작으로도 열리지 않는다", async () => {
    for (const evil of ["repair-cases/../../secrets.txt", "/etc/passwd", "repair-cases\\x\\y.jpg"]) {
      await assert.rejects(() => storage.exists(evil), /저장 경로|저장 루트/, evil);
      await assert.rejects(() => storage.delete(evil), /저장 경로|저장 루트/, evil);
    }
  });

  test("sweepTemp가 오래된 임시 파일만 치운다", async () => {
    const stale = path.join(storageRoot, ".tmp-uploads", `${randomUUID().toLowerCase()}.part`);
    const fresh = await storage.writeTemp(streamOf(new Uint8Array([1, 2, 3])), {
      maxBytes: MAX_ATTACHMENT_SIZE_BYTES,
    });
    await writeFile(stale, "stale");
    const longAgo = new Date(Date.now() - 48 * 60 * 60 * 1000);
    await utimes(stale, longAgo, longAgo);

    const removed = await storage.sweepTemp(24 * 60 * 60 * 1000);
    assert.equal(removed, 1, "24시간이 지난 찌꺼기 하나만 치워야 한다");
    assert.ok(await fileExists(fresh.tempPath), "진행 중인 업로드를 건드리면 안 된다");

    await storage.discard(fresh.tempPath);
  });
});

// ───────────────────────────── 2·3. 행 + 감사 로그, 그리고 표에 들어간 경로

describe("createAttachmentRecord: 행과 감사 로그가 함께 남는다", () => {
  test("첨부 행이 생기고 FILE_UPLOAD 감사 로그가 같이 남는다", async () => {
    const repairCaseId = await createTestCase();
    const bytes = new Uint8Array(Buffer.from("audit-me", "utf8"));
    const stored = await storeFile({ repairCaseId, bytes, extension: "txt" });

    const created = await insertRecord({ repairCaseId, ...stored, description: "인수 시 외관" });

    const [row] = await db.select().from(attachments).where(eq(attachments.id, created.id));
    assert.ok(row, "첨부 행이 있어야 한다");
    assert.equal(row.repairCaseId, repairCaseId);
    assert.equal(row.category, "INTAKE_PHOTO");
    assert.equal(row.fileSize, bytes.byteLength);
    assert.equal(row.checksumSha256, stored.sha256);
    assert.equal(row.malwareScanStatus, "NOT_SCANNED", "검사 엔진이 없으므로 '미검사'가 사실이다");
    assert.equal(row.previewPath, null, "미리보기 생성기는 아직 없다");
    assert.equal(row.isDeleted, false);
    assert.equal(row.description, "인수 시 외관");

    const auditRows = await db
      .select({ actionType: auditLogs.actionType, actorUserId: auditLogs.actorUserId, targetEntity: auditLogs.targetEntity })
      .from(auditLogs)
      .where(and(eq(auditLogs.targetRecordId, created.id), eq(auditLogs.actionType, "FILE_UPLOAD")));
    assert.equal(auditRows.length, 1, "FILE_UPLOAD 감사 로그가 정확히 하나 남아야 한다");
    assert.equal(auditRows[0].targetEntity, "attachments");
    assert.equal(auditRows[0].actorUserId, engineerId);
  });

  test("표에 들어간 stored_path는 '/' 구분자·소문자·상대 경로다 (NAS 이식 3규칙)", async () => {
    const repairCaseId = await createTestCase();
    const bytes = new Uint8Array(Buffer.from("portable-path", "utf8"));
    const stored = await storeFile({ repairCaseId, bytes, extension: "txt" });
    const created = await insertRecord({ repairCaseId, ...stored });

    const [row] = await db
      .select({ storedPath: attachments.storedPath })
      .from(attachments)
      .where(eq(attachments.id, created.id));

    assert.equal(row.storedPath.includes("\\"), false, "역슬래시는 Linux에서 파일명의 일부가 된다");
    assert.equal(row.storedPath, row.storedPath.toLowerCase(), "대소문자가 섞이면 옮긴 뒤 일부만 안 열린다");
    assert.equal(row.storedPath.startsWith("/"), false);
    assert.equal(/^[a-zA-Z]:/.test(row.storedPath), false, "C: 는 컨테이너 안에 없다");
    assert.equal(row.storedPath.includes(storageRoot), false, "저장 루트가 행에 새어 들어가면 안 된다");
    assert.equal(row.storedPath, `repair-cases/${repairCaseId}/${created.id}.txt`);
  });

  test("옮길 수 없는 경로는 표에 들어가지 못한다", async () => {
    const repairCaseId = await createTestCase();
    const attachmentId = randomUUID().toLowerCase();

    for (const evil of [
      `repair-cases\\${repairCaseId}\\${attachmentId}.txt`,
      `C:/DSS-AS-DATA/uploads/repair-cases/${repairCaseId}/${attachmentId}.txt`,
      `repair-cases/${repairCaseId}/${attachmentId.toUpperCase()}.TXT`,
      "repair-cases/../../escape.txt",
    ]) {
      await assert.rejects(
        () =>
          createAttachmentRecord({
            id: randomUUID().toLowerCase(),
            owner: { kind: "REPAIR_CASE", repairCaseId },
            category: "OTHER",
            originalFileName: "x.txt",
            storedPath: evil,
            mimeType: "text/plain",
            fileSize: 1,
            checksumSha256: "0".repeat(64),
            description: null,
            uploadedBy: engineerId,
          }),
        /저장 경로/,
        evil
      );
    }

    // 대조 — 거부된 이유가 경로였다는 증거. 같은 조건에서 정상 경로는 들어간다.
    const rows = await db.select({ id: attachments.id }).from(attachments).where(eq(attachments.repairCaseId, repairCaseId));
    assert.equal(rows.length, 0, "거부된 시도는 행을 남기지 않는다");
  });
});

// ─────────────────────────── 2·3(모델). 주인이 제품 모델인 첨부

describe("createAttachmentRecord: 주인이 제품 모델일 때", () => {
  test("product_model_id 가 채워지고 repair_case_id 는 NULL 이다", async () => {
    const productModelId = await createTestProductModel();
    const bytes = new Uint8Array(Buffer.from("model-owned", "utf8"));
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
      description: "모델 회로도",
      uploadedBy: engineerId,
    });
    createdAttachmentIds.push(created.id);

    const [row] = await db.select().from(attachments).where(eq(attachments.id, created.id));
    assert.ok(row, "첨부 행이 있어야 한다");
    assert.equal(row.productModelId, productModelId);
    // 🔴 주인이 아닌 쪽은 NULL 이어야 한다. 여기에 값이 들어가면 그 행은 어느
    // 폴더에 사는 파일인지가 정해지지 않는다.
    assert.equal(row.repairCaseId, null, "모델 첨부에 접수 건이 함께 실리면 안 된다");
    assert.equal(row.category, "CIRCUIT_DIAGRAM");
    assert.equal(row.checksumSha256, written.sha256);
    assert.equal(row.malwareScanStatus, "NOT_SCANNED");
    assert.equal(row.isDeleted, false);
    // 접수 건 쪽과 같은 NAS 이식 3규칙 — 다른 것은 첫 마디뿐이다.
    assert.equal(row.storedPath, `product-models/${productModelId}/${created.id}.txt`);
    assert.equal(row.storedPath.includes("\\"), false);
    assert.equal(row.storedPath, row.storedPath.toLowerCase());
  });

  test("감사 로그가 함께 남고, 어느 주인인지가 그 기록만으로 읽힌다", async () => {
    const productModelId = await createTestProductModel();
    const bytes = new Uint8Array(Buffer.from("model-audit", "utf8"));
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
      originalFileName: "회로도-감사.txt",
      storedPath,
      mimeType: "text/plain",
      fileSize: written.size,
      checksumSha256: written.sha256,
      description: null,
      uploadedBy: engineerId,
    });
    createdAttachmentIds.push(created.id);

    const auditRows = await db
      .select({ actionType: auditLogs.actionType, actorUserId: auditLogs.actorUserId, newValue: auditLogs.newValue })
      .from(auditLogs)
      .where(and(eq(auditLogs.targetRecordId, created.id), eq(auditLogs.actionType, "FILE_UPLOAD")));
    assert.equal(auditRows.length, 1, "FILE_UPLOAD 감사 로그가 정확히 하나 남아야 한다");
    assert.equal(auditRows[0].actorUserId, engineerId);

    const newValue = auditRows[0].newValue as Record<string, unknown>;
    // 이 줄만 읽고도 무슨 파일인지 알 수 있어야 한다. 예전처럼 repairCaseId 만
    // 싣던 모양이면 모델 첨부의 기록에 `repairCaseId: null` 만 남는다.
    assert.equal(newValue.ownerType, "PRODUCT_MODEL");
    assert.equal(newValue.productModelId, productModelId);
    assert.equal("repairCaseId" in newValue, false, "주인이 아닌 쪽 키는 아예 싣지 않는다");
    assert.equal(newValue.originalFileName, "회로도-감사.txt");
  });

  test("접수 건 첨부의 감사 기록에도 주인이 드러난다 — 예전 키는 그대로 남는다", async () => {
    const repairCaseId = await createTestCase();
    const bytes = new Uint8Array(Buffer.from("case-audit-owner", "utf8"));
    const stored = await storeFile({ repairCaseId, bytes, extension: "txt" });
    const created = await insertRecord({ repairCaseId, ...stored });

    const [auditRow] = await db
      .select({ newValue: auditLogs.newValue })
      .from(auditLogs)
      .where(and(eq(auditLogs.targetRecordId, created.id), eq(auditLogs.actionType, "FILE_UPLOAD")));

    const newValue = auditRow.newValue as Record<string, unknown>;
    assert.equal(newValue.ownerType, "REPAIR_CASE");
    // 예전부터 실리던 키다. 이것이 사라지면 옛 감사 기록과 새 기록의 모양이
    // 달라져 한 질의로 함께 읽을 수 없게 된다.
    assert.equal(newValue.repairCaseId, repairCaseId);
    assert.equal("productModelId" in newValue, false);
  });

  test("🔴 두 주인을 동시에 채운 INSERT 는 DB 가 거부한다", async () => {
    // 타입으로 막아 둔 것은 **앱 안에서만**이다. 손으로 쓴 SQL, 이관 스크립트,
    // 나중에 생길 다른 경로는 그 타입을 지나지 않는다. 그것까지 막는 것은
    // attachments_owner_not_both CHECK 하나뿐이고, 이 시험이 그 제약이 실제로
    // 살아 있다는 유일한 증거다. 그래서 일부러 createAttachmentRecord 를
    // 거치지 않고 표에 직접 넣는다.
    const repairCaseId = await createTestCase();
    const productModelId = await createTestProductModel();
    const attachmentId = randomUUID().toLowerCase();

    await assert.rejects(
      () =>
        db.insert(attachments).values({
          id: attachmentId,
          repairCaseId,
          productModelId,
          category: "OTHER",
          originalFileName: "두-주인.txt",
          storedPath: `repair-cases/${repairCaseId}/${attachmentId}.txt`,
          mimeType: "text/plain",
          fileSize: 1,
          checksumSha256: "0".repeat(64),
          uploadedBy: engineerId,
        }),
      // Drizzle 이 "Failed query: ..." 로 한 겹 감싸므로 제약 이름은 cause 에
      // 들어 있다. 겉 message 만 보면 어떤 오류든 통과해 버려서 — 예를 들어
      // 오타로 컬럼 이름이 틀려도 "거부됐다"가 되어 — 이 시험이 증거 구실을
      // 못 한다. **23514(check_violation)와 제약 이름을 둘 다** 확인한다.
      (error: unknown) => {
        const cause = (error as { cause?: unknown }).cause;
        assert.ok(cause instanceof Error, "PostgresError 가 cause 로 실려 있어야 한다");
        assert.equal(
          (cause as { code?: string }).code,
          "23514",
          "CHECK 위반(23514)이 아니라 다른 이유로 거부됐다"
        );
        assert.match(
          cause.message,
          /attachments_owner_not_both/,
          "CHECK 제약이 사라졌거나 마이그레이션 0056 이 적용되지 않았다"
        );
        return true;
      }
    );

    // 대조 — 거부된 이유가 '두 주인'이었다는 증거. 같은 조건에서 한쪽만 채우면
    // 들어간다.
    const [okRow] = await db
      .insert(attachments)
      .values({
        id: attachmentId,
        productModelId,
        category: "OTHER",
        originalFileName: "한-주인.txt",
        storedPath: `product-models/${productModelId}/${attachmentId}.txt`,
        mimeType: "text/plain",
        fileSize: 1,
        checksumSha256: "0".repeat(64),
        uploadedBy: engineerId,
      })
      .returning({ id: attachments.id });
    createdAttachmentIds.push(okRow.id);
    assert.equal(okRow.id, attachmentId);
  });
});

// ─────────────────────────────────── 업로드가 향할 제품 모델

describe("getProductModelAttachmentUploadTarget", () => {
  test("살아 있는 모델은 찾아진다 — 잠금 개념은 없다", async () => {
    const productModelId = await createTestProductModel();
    const target = await getProductModelAttachmentUploadTarget(productModelId);
    assert.ok(target);
    assert.equal(target!.id, productModelId);
    // 접수 건 쪽과 달리 isLocked 가 **없다.** 없는 개념을 false 로 흉내 내면
    // 라우트에 영영 죽어 있는 분기가 생긴다.
    assert.equal("isLocked" in target!, false);
  });

  test("휴지통에 있는 모델은 없는 것으로 본다", async () => {
    const productModelId = await createTestProductModel();
    assert.ok(await getProductModelAttachmentUploadTarget(productModelId), "삭제 전에는 찾아져야 대조가 성립한다");

    await db
      .update(productModels)
      .set({ isDeleted: true, deletedAt: new Date(), deletedBy: engineerId, deleteReason: "테스트 삭제" })
      .where(eq(productModels.id, productModelId));

    assert.equal(await getProductModelAttachmentUploadTarget(productModelId), null);
  });

  test("UUID가 아닌 값은 DB를 읽지 않고 null이다", async () => {
    assert.equal(await getProductModelAttachmentUploadTarget("local-demo-1"), null);
    assert.equal(await getProductModelAttachmentUploadTarget(""), null);
    assert.equal(await getProductModelAttachmentUploadTarget("'; drop table attachments; --"), null);
  });
});

// ───────────────────────────────────────────────── 4. 목록 조회

describe("listAttachmentsForRepairCase", () => {
  test("그 건의 안 지워진 첨부만, 최근 것부터 나온다", async () => {
    const repairCaseId = await createTestCase();
    const otherCaseId = await createTestCase();

    const first = await storeFile({
      repairCaseId,
      bytes: new Uint8Array(Buffer.from("first", "utf8")),
      extension: "txt",
    });
    await insertRecord({ repairCaseId, ...first, originalFileName: "먼저.txt" });
    // uploaded_at 기본값이 now()라 같은 밀리초에 두 행이 들어가면 순서가 흔들린다.
    await new Promise((resolve) => setTimeout(resolve, 10));
    const second = await storeFile({
      repairCaseId,
      bytes: new Uint8Array(Buffer.from("second", "utf8")),
      extension: "txt",
    });
    await insertRecord({ repairCaseId, ...second, originalFileName: "나중.txt" });

    const otherFile = await storeFile({
      repairCaseId: otherCaseId,
      bytes: new Uint8Array(Buffer.from("other", "utf8")),
      extension: "txt",
    });
    await insertRecord({ repairCaseId: otherCaseId, ...otherFile, originalFileName: "남의건.txt" });

    const items = await listAttachmentsForRepairCase(repairCaseId);
    assert.deepEqual(
      items.map((item) => item.originalFileName),
      ["나중.txt", "먼저.txt"],
      "최근 것부터, 남의 건은 섞이지 않는다"
    );
    assert.equal(items[0].uploadedByName.length > 0, true, "업로더 이름은 조인으로 채운다");
    assert.equal(items[0].malwareScanStatus, "NOT_SCANNED");
  });

  test("휴지통으로 보낸 첨부는 목록에서 빠진다", async () => {
    const repairCaseId = await createTestCase();
    const stored = await storeFile({
      repairCaseId,
      bytes: new Uint8Array(Buffer.from("trash-me", "utf8")),
      extension: "txt",
    });
    const created = await insertRecord({ repairCaseId, ...stored });
    assert.equal((await listAttachmentsForRepairCase(repairCaseId)).length, 1, "삭제 전에는 보여야 대조가 성립한다");

    await db
      .update(attachments)
      .set({ isDeleted: true, deletedAt: new Date(), deletedBy: engineerId, deleteReason: "테스트 삭제" })
      .where(eq(attachments.id, created.id));

    assert.deepEqual(await listAttachmentsForRepairCase(repairCaseId), []);
  });

  test("UUID가 아닌 값으로 물으면 빈 목록이다 — DB를 읽지 않는다", async () => {
    assert.deepEqual(await listAttachmentsForRepairCase("local-demo-1"), []);
    assert.deepEqual(await listAttachmentsForRepairCase("'; drop table attachments; --"), []);
  });
});

// ───────────────────────────────────────────── 업로드가 향할 접수 건

describe("getAttachmentUploadTarget", () => {
  test("살아 있는 건은 잠금 여부와 함께 나온다", async () => {
    const repairCaseId = await createTestCase();
    const target = await getAttachmentUploadTarget(repairCaseId);
    assert.ok(target);
    assert.equal(target!.id, repairCaseId);
    assert.equal(target!.isLocked, false);

    await db.update(repairCases).set({ isLocked: true }).where(eq(repairCases.id, repairCaseId));
    const locked = await getAttachmentUploadTarget(repairCaseId);
    assert.equal(locked!.isLocked, true, "출하 완료로 잠긴 건은 라우트가 여기서 막는다");
  });

  test("휴지통에 있는 건은 없는 것으로 본다", async () => {
    const repairCaseId = await createTestCase();
    assert.ok(await getAttachmentUploadTarget(repairCaseId), "삭제 전에는 찾아져야 대조가 성립한다");

    await db
      .update(repairCases)
      .set({ isDeleted: true, deletedAt: new Date(), deletedBy: engineerId, deleteReason: "테스트 삭제" })
      .where(eq(repairCases.id, repairCaseId));

    assert.equal(await getAttachmentUploadTarget(repairCaseId), null);
  });

  test("UUID가 아닌 값은 DB를 읽지 않고 null이다", async () => {
    assert.equal(await getAttachmentUploadTarget("local-demo-1"), null);
    assert.equal(await getAttachmentUploadTarget(""), null);
  });
});

async function countTempFiles(): Promise<number> {
  try {
    const entries = await readdir(path.join(storageRoot, ".tmp-uploads"));
    return entries.filter((entry) => entry.endsWith(".part")).length;
  } catch {
    return 0;
  }
}

async function fileExists(absolutePath: string): Promise<boolean> {
  try {
    await stat(absolutePath);
    return true;
  } catch {
    return false;
  }
}
