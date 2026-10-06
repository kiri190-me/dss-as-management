import "../../../../scripts/load-env";

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { and, eq, inArray, like } from "drizzle-orm";

import { db, pgClient } from "../../db/connection";
import {
  attachments,
  auditLogs,
  customers,
  productModels,
  products,
  repairCaseIdempotencyKeys,
  repairCaseIntakeSequences,
  repairCases,
  statusChangeHistories,
  users,
} from "../../db/schema";
import { CONTACT_FOLDER_AUDIT_ENTITY } from "../../db/mutations/contact-folders";
import { buildProductModelKindAttachmentStoredPath } from "@/lib/domain/attachment-path";
import { CONTACT_FOLDER_COMMON_FOLDER_NAME } from "@/lib/domain/contact-folder-naming";
import type { IntakeSubmissionInput } from "@/lib/domain/local/submit-intake";
import type { ProductModelKind } from "@/lib/domain/product-model-kind";
import { createRepairCaseWithIdempotency, type RepairCaseCreator } from "./create-repair-case";

/**
 * ============================================================================
 * 접수하면 그 종류의 **공통 서류**가 연락서 폴더 `공통/` 에 들어간다 (2026-10-06)
 * ============================================================================
 * 🔴 **실제 공유폴더에 닿지 않는다.** 폴더가 필요한 시험은 OS 임시 폴더(mkdtemp)를
 * `CONTACT_FOLDER_ARCHIVE_DIR` 에 **직접** 넣고, 끝나면 통째로 지운다. 시험 환경에서는
 * 그 설정이 애초에 비어 있다(scripts/load-env.ts · load-test-env.ts 가 지운다) — 그
 * 사실부터 아래 첫 시험이 못 박는다. 이웃 create-contact-folder.integration.test.ts 와
 * 같은 규약이다.
 *
 * 🔴 **시스템 창고(UPLOADS_DIR)도 임시 폴더로 바꾼다.** 서류의 바이트는 디스크에서
 * 읽으므로, 바꾸지 않으면 개발 창고를 들여다보게 된다. 바꾸고 나면 **이 시험이 쓴 파일만
 * 읽히므로**, 개발 DB 에 이미 들어 있는 종류 서류는 읽기에서 실패해 공유폴더에 들어오지
 * 않는다 — 그래서 아래 「정확히 이 이름들」 비교가 남의 자료에 흔들리지 않는다.
 *
 * 못 박는 것(완료 기준 ①~⑥):
 *  · ① 🔴 **종류가 맞는 서류만** 들어간다 — 다른 종류 것이 안 섞인다
 *  · ② 🔴 서류가 0 장이면 **`공통/` 폴더가 안 생긴다**
 *  · ③ 🔴 복사가 실패해도 **접수는 성공한다**
 *  · ④ 🔴 폴더 결과가 `disabled` · `multiple` 이면 **아무것도 하지 않는다**
 *  · ⑤ 🔴 같은 서류를 두 번 꽂으면 **두 번째는 안 쓴다** — 파일이 하나뿐이다
 *  · ⑥ 🔴 `EXCEL_IMPORT` 접수에는 **꽂지 않는다**
 *  · 🔴 꽂은 것만 감사 기록이 남는다(FILE_DOWNLOAD · repair_case_contact_folder)
 *  · 🔴 휴지통에 든 종류 서류는 들어가지 않는다
 *
 * 끼운 자리(트랜잭션 바깥 · 폴더 만들기와 따로 · 로그에 이름 없음)는
 * create-contact-folder-source.test.ts 가 원본을 글자로 본다. 꽂기 자체(덮어쓰지 않기 ·
 * NFC/NFD · 번호 비켜 가기)는 lib/storage/contact-folder-common-copy.test.ts 가 본다.
 *
 * 격리: 인수 달 "9405"(저장소의 다른 스위트는 9401 · 9402 · 9403 · 9404 · 9412 를 쓴다) ·
 * 이름 접두어 `AS-TEST-CFC-`. 고객사 · 모델 · S/N 은 전부 가짜다. 종류 서류 행은 이
 * 시험이 넣은 것만 id 로 지운다.
 * ============================================================================
 */

const RUN = randomUUID().slice(0, 8);
const PREFIX = "AS-TEST-CFC-";
const MONTH = "9405";
const RECEIVED_AT = "2094-05-06";
const CUSTOMER = `${PREFIX}CUST-${RUN}`;
const MODEL = `${PREFIX}MODEL-${RUN}`;
const COMMON = CONTACT_FOLDER_COMMON_FOLDER_NAME;

let actor: RepairCaseCreator;
let uploaderId: string;
let customerId: string;
let productModelId: string;
const createdRoots: string[] = [];
const trackedKeys: string[] = [];
const createdAttachmentIds: string[] = [];

async function makeRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix));
  createdRoots.push(root);
  return root;
}

/** 공유폴더 설정을 이 호출 동안만 바꾼다. 🔴 끝나면 반드시 되돌린다. */
async function withArchiveRoot<T>(root: string | null, run: () => Promise<T>): Promise<T> {
  const original = process.env.CONTACT_FOLDER_ARCHIVE_DIR;
  if (root === null) delete process.env.CONTACT_FOLDER_ARCHIVE_DIR;
  else process.env.CONTACT_FOLDER_ARCHIVE_DIR = root;
  try {
    return await run();
  } finally {
    if (original === undefined) delete process.env.CONTACT_FOLDER_ARCHIVE_DIR;
    else process.env.CONTACT_FOLDER_ARCHIVE_DIR = original;
  }
}

/** 시스템 창고를 임시 폴더로 바꾼다 — 🔴 개발 창고를 읽지도 쓰지도 않는다. */
let uploadsRoot: string;
/** 바꾸기 전의 값. after() 에서 그대로 돌려놓는다. */
let originalUploadsDir: string | undefined;

/** console.error 를 받아 둔다 — 로그에 무엇이 실리는지 보기 위해서다. */
async function captureErrors<T>(run: () => Promise<T>): Promise<{ value: T; logs: string[] }> {
  const original = console.error;
  const logs: string[] = [];
  console.error = (...args: unknown[]) => {
    logs.push(args.map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg))).join(" "));
  };
  try {
    return { value: await run(), logs };
  } finally {
    console.error = original;
  }
}

type KindDoc = {
  kind: ProductModelKind;
  originalFileName: string;
  /** 디스크에 쓸 내용. `null` 이면 **파일을 만들지 않는다**(읽기 실패를 만드는 자리다). */
  content: string | null;
  trashed?: boolean;
};

/**
 * 종류 서류 행을 넣고 그 바이트를 임시 창고에 쓴다. 🔴 **주인 칸은 종류 하나뿐**이라
 * 나머지 셋은 건드리지 않는다(attachments_kind_owner_alone CHECK).
 */
async function addKindDoc(doc: KindDoc): Promise<{ id: string; size: number }> {
  const attachmentId = randomUUID().toLowerCase();
  const extension = doc.originalFileName.includes(".")
    ? doc.originalFileName.slice(doc.originalFileName.lastIndexOf(".") + 1).toLowerCase()
    : "pdf";
  const storedPath = buildProductModelKindAttachmentStoredPath({
    kind: doc.kind,
    attachmentId,
    extension,
  });
  const bytes = doc.content === null ? Buffer.alloc(0) : Buffer.from(doc.content, "utf8");

  await db.insert(attachments).values({
    id: attachmentId,
    productModelKind: doc.kind,
    category: "CHECKLIST",
    originalFileName: doc.originalFileName,
    storedPath,
    mimeType: "application/pdf",
    fileSize: bytes.byteLength,
    checksumSha256: "0".repeat(64),
    uploadedBy: uploaderId,
    ...(doc.trashed
      ? { isDeleted: true, deletedAt: new Date(), deletedBy: uploaderId, deleteReason: "시험 — 휴지통" }
      : {}),
  });
  createdAttachmentIds.push(attachmentId);

  if (doc.content !== null) {
    const target = path.join(uploadsRoot, ...storedPath.split("/"));
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, bytes);
  }

  return { id: attachmentId, size: bytes.byteLength };
}

/** 이 시험이 넣은 종류 서류만 치운다 — 시험끼리 서로의 서류를 보지 않게. */
async function clearKindDocs(): Promise<void> {
  if (createdAttachmentIds.length === 0) return;
  await db.delete(attachments).where(inArray(attachments.id, createdAttachmentIds));
  createdAttachmentIds.length = 0;
}

function baseIntake(overrides: Partial<IntakeSubmissionInput>): IntakeSubmissionInput {
  return {
    workflowType: "PAID_GENERATOR",
    billingType: "PAID",
    customerId,
    endUserId: null,
    assignedEngineerId: null,
    priority: "NORMAL",
    receivedAt: RECEIVED_AT,
    customerRequestedDueDate: null,
    internalTargetShipmentDate: null,
    internalTargetInspectionCompletionDate: null,
    intakeNumber: null,
    modelName: MODEL,
    productModelId,
    newProductModelName: null,
    lotNumber: `LN-${RUN}`,
    serialNumber: `SN-${RUN}`,
    partNumber: null,
    accessoryList: null,
    externalConditionSummary: null,
    reasonForRemoval: null,
    reportedSymptom: "점검요청",
    notes: null,
    contactName: null,
    contactPhone: null,
    contactEmail: null,
    ...overrides,
  };
}

async function intake(
  logContext: "INTERACTIVE" | "EXCEL_IMPORT",
  overrides: Partial<IntakeSubmissionInput> = {}
): Promise<{ id: string; intakeNumber: string }> {
  const idempotencyKey = randomUUID();
  trackedKeys.push(idempotencyKey);
  const result = await createRepairCaseWithIdempotency({
    actor,
    intake: baseIntake(overrides),
    idempotencyKey,
    logContext,
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) throw new Error("접수를 만들지 못했다");
  return { id: result.id, intakeNumber: result.intakeNumber };
}

/** 그 건의 연락서 폴더 이름(하나여야 한다). */
async function folderOf(root: string, intakeNumber: string): Promise<string> {
  const names = (await readdir(root)).filter((name) => name.startsWith(`${intakeNumber} `));
  assert.equal(names.length, 1, `연락서 폴더가 하나가 아니다: ${JSON.stringify(names)}`);
  return names[0];
}

/** 그 건의 `공통` 안에 들어간 이름들. 폴더가 아예 없으면 `null`. */
async function commonNames(root: string, intakeNumber: string): Promise<string[] | null> {
  const folder = await folderOf(root, intakeNumber);
  const top = await readdir(path.join(root, folder));
  if (!top.includes(COMMON)) return null;
  return (await readdir(path.join(root, folder, COMMON))).sort();
}

/** 그 건에 남은 **연락서 폴더** 감사 기록. */
async function folderAuditRows(repairCaseId: string) {
  return db
    .select({
      actorUserId: auditLogs.actorUserId,
      actionType: auditLogs.actionType,
      newValue: auditLogs.newValue,
    })
    .from(auditLogs)
    .where(
      and(eq(auditLogs.targetEntity, CONTACT_FOLDER_AUDIT_ENTITY), eq(auditLogs.targetRecordId, repairCaseId))
    );
}

/** 이 파일이 만든 것만 지운다 — 인수 달 하나와 이름 접두어로 범위를 잡는다. */
async function cleanup(): Promise<void> {
  const caseRows = await db
    .select({ id: repairCases.id })
    .from(repairCases)
    .where(like(repairCases.intakeNumber, `D${MONTH}%`));
  const caseIds = caseRows.map((row) => row.id);

  if (caseIds.length > 0) {
    // 🔴 감사 기록은 id 를 먼저 골라서 지운다(db/test-cleanup-static-safety.test.ts).
    const auditRows = await db
      .select({ id: auditLogs.id })
      .from(auditLogs)
      .where(
        and(
          inArray(auditLogs.targetEntity, ["repair_cases", CONTACT_FOLDER_AUDIT_ENTITY]),
          inArray(auditLogs.targetRecordId, caseIds)
        )
      );
    if (auditRows.length > 0) {
      await db.delete(auditLogs).where(
        inArray(
          auditLogs.id,
          auditRows.map((row) => row.id)
        )
      );
    }
    await db.delete(statusChangeHistories).where(inArray(statusChangeHistories.repairCaseId, caseIds));
    await db.delete(repairCaseIdempotencyKeys).where(inArray(repairCaseIdempotencyKeys.repairCaseId, caseIds));
  }
  if (trackedKeys.length > 0) {
    await db
      .delete(repairCaseIdempotencyKeys)
      .where(inArray(repairCaseIdempotencyKeys.idempotencyKey, [...new Set(trackedKeys)]));
  }
  if (caseIds.length > 0) await db.delete(repairCases).where(inArray(repairCases.id, caseIds));

  await clearKindDocs();
  await db.delete(products).where(like(products.modelName, `${PREFIX}%`));
  await db.delete(productModels).where(like(productModels.modelName, `${PREFIX}%`));
  await db.delete(customers).where(like(customers.name, `${PREFIX}%`));
  await db.delete(repairCaseIntakeSequences).where(eq(repairCaseIntakeSequences.yearMonth, MONTH));
}

before(async () => {
  const [superAdmin] = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        eq(users.role, "SUPER_ADMIN"),
        eq(users.approvalStatus, "APPROVED"),
        eq(users.isActive, true),
        eq(users.isDeleted, false)
      )
    )
    .limit(1);
  assert.ok(superAdmin, "시험 DB 에 승인된 최고관리자 계정이 있어야 한다");
  actor = { userId: superAdmin.id, role: "SUPER_ADMIN", approvalStatus: "APPROVED", isDeveloper: false };
  uploaderId = superAdmin.id;

  // 🔴 시스템 창고를 임시 폴더로 바꾼다 — 개발 창고를 읽지도 쓰지도 않는다.
  uploadsRoot = await makeRoot("intake-common-uploads-");
  originalUploadsDir = process.env.UPLOADS_DIR;
  process.env.UPLOADS_DIR = uploadsRoot;

  // 지난 실행이 중간에 죽어 남긴 것이 있으면 먼저 치운다(범위는 cleanup 과 같다).
  await cleanup();

  const [customer] = await db.insert(customers).values({ name: CUSTOMER }).returning({ id: customers.id });
  const [model] = await db.insert(productModels).values({ modelName: MODEL }).returning({ id: productModels.id });
  customerId = customer.id;
  productModelId = model.id;
});

after(async () => {
  await cleanup();
  for (const root of createdRoots) {
    await rm(root, { recursive: true, force: true });
  }
  if (originalUploadsDir === undefined) delete process.env.UPLOADS_DIR;
  else process.env.UPLOADS_DIR = originalUploadsDir;
  await pgClient.end({ timeout: 5 });
});

describe("접수하면 그 종류의 공통 서류가 `공통` 에 들어간다", () => {
  test("🔴 시험 환경에는 실제 공유폴더 설정이 없다 — 사내 서류함에 닿을 길이 없다", () => {
    assert.equal(
      process.env.CONTACT_FOLDER_ARCHIVE_DIR,
      undefined,
      "🔴 시험이 실제 공유폴더를 가리키고 있다(scripts/load-env.ts 의 보호가 깨졌다)"
    );
    // 🔴 시스템 창고도 임시 폴더다 — 개발 창고의 파일을 읽어 공유폴더로 나르지 않는다.
    assert.equal(process.env.UPLOADS_DIR, uploadsRoot);
    assert.ok(uploadsRoot.startsWith(os.tmpdir()), "창고가 임시 폴더가 아니다");
  });

  test("① 🔴 종류가 맞는 서류만 들어간다 — 다른 종류 것이 안 섞인다", async () => {
    const root = await makeRoot("intake-common-archive-");
    const mine = await addKindDoc({
      kind: "GENERATOR",
      originalFileName: "제너레이터-기본파라미터.pdf",
      content: "제너레이터 전용",
    });
    await addKindDoc({ kind: "MATCHER", originalFileName: "매쳐-점검표.pdf", content: "매쳐 전용" });
    await addKindDoc({
      kind: "TOTAL_CONTROLLER",
      originalFileName: "티씨-점검표.pdf",
      content: "T/C 전용",
    });
    // 🔴 휴지통에 든 서류는 들어가지 않는다 — 조회가 is_deleted = false 를 건다.
    await addKindDoc({
      kind: "GENERATOR",
      originalFileName: "제너레이터-옛날표.pdf",
      content: "버린 것",
      trashed: true,
    });

    const created = await withArchiveRoot(root, () =>
      intake("INTERACTIVE", { workflowType: "PAID_GENERATOR", serialNumber: `SN-${RUN}-KIND` })
    );

    assert.deepEqual(await commonNames(root, created.intakeNumber), ["제너레이터-기본파라미터.pdf"]);
    const folder = await folderOf(root, created.intakeNumber);
    assert.equal(
      (await readFile(path.join(root, folder, COMMON, "제너레이터-기본파라미터.pdf"))).toString("utf8"),
      "제너레이터 전용"
    );

    // 🔴 꽂은 서류마다 감사 기록이 남는다 — 폴더 만들기(CREATE) 한 줄과 함께 둘이다.
    const audit = await folderAuditRows(created.id);
    const saved = audit.filter((row) => row.actionType === "FILE_DOWNLOAD");
    assert.equal(saved.length, 1, `꽂은 서류의 기록이 하나가 아니다: ${JSON.stringify(audit)}`);
    assert.equal(saved[0].actorUserId, actor.userId, "접수한 사람이 아닌 사람으로 적혔다");
    assert.deepEqual(saved[0].newValue, {
      attachmentId: mine.id,
      fileName: "제너레이터-기본파라미터.pdf",
      fileSize: mine.size,
    });

    await clearKindDocs();
  });

  test("② 🔴 서류가 0 장이면 `공통` 폴더가 안 생긴다 — 빈 폴더를 세우지 않는다", async () => {
    const root = await makeRoot("intake-common-archive-");
    // 그 종류에는 아무 서류도 넣지 않는다(다른 종류에만 둔다 — 그래도 안 들어와야 한다).
    await addKindDoc({ kind: "GENERATOR", originalFileName: "제너레이터-표.pdf", content: "제너레이터" });

    const created = await withArchiveRoot(root, () =>
      intake("INTERACTIVE", {
        workflowType: "PAID_TOTAL_CONTROLLER",
        serialNumber: `SN-${RUN}-EMPTY`,
      })
    );

    // 폴더는 생겼지만(접수 때 늘 만든다) 그 안에 `공통` 은 없다.
    assert.equal(await commonNames(root, created.intakeNumber), null, "🔴 빈 `공통` 폴더가 섰다");
    assert.deepEqual(await folderAuditRows(created.id).then((rows) => rows.map((row) => row.actionType)), [
      "CREATE",
    ]);

    await clearKindDocs();
  });

  test("③ 🔴 복사가 실패해도 접수는 성공한다 — 나머지 서류는 계속 들어간다", async () => {
    const root = await makeRoot("intake-common-archive-");
    // 🔴 창고에 파일이 없는 서류 — 읽기에서 실패한다.
    await addKindDoc({ kind: "GENERATOR", originalFileName: "사라진-서류.pdf", content: null });
    await addKindDoc({ kind: "GENERATOR", originalFileName: "멀쩡한-서류.pdf", content: "멀쩡" });

    const { value: created, logs } = await captureErrors(() =>
      withArchiveRoot(root, () =>
        intake("INTERACTIVE", { workflowType: "PAID_GENERATOR", serialNumber: `SN-${RUN}-BROKEN` })
      )
    );

    // 🔴 접수는 그대로다 — 행이 살아 있다.
    const [row] = await db
      .select({ intakeNumber: repairCases.intakeNumber })
      .from(repairCases)
      .where(eq(repairCases.id, created.id));
    assert.ok(row, "서류를 못 넣자 접수까지 되돌아갔다");
    assert.equal(row.intakeNumber, created.intakeNumber);

    // 🔴 한 장이 실패해도 나머지는 들어갔다.
    assert.deepEqual(await commonNames(root, created.intakeNumber), ["멀쩡한-서류.pdf"]);

    // 🔴 실패를 알리되, 운영 로그에 파일 이름 · 폴더 이름 · 경로를 적지 않는다.
    const joined = logs.join("\n");
    assert.ok(logs.length > 0, "실패를 아무도 모르게 지나갔다");
    assert.ok(joined.includes(created.id), "어느 수리 건인지 적지 않았다");
    for (const secret of [root, uploadsRoot, os.tmpdir(), CUSTOMER, "사라진-서류", `SN-${RUN}-BROKEN`]) {
      assert.equal(joined.includes(secret), false, `로그에 ${secret} 가 들어 있다: ${joined}`);
    }

    await clearKindDocs();
  });

  test("④ 🔴 인수번호가 같은 폴더가 여럿이면 아무것도 하지 않는다", async () => {
    const root = await makeRoot("intake-common-archive-");
    const intakeNumber = `D${MONTH}41`;
    // 사람이 같은 번호로 폴더를 둘 만들어 두었다 — 앱은 어느 쪽인지 고르지 않는다.
    await mkdir(path.join(root, `${intakeNumber} 먼저 만든 폴더`));
    await mkdir(path.join(root, `${intakeNumber} 나중에 또 만든 폴더`));
    await addKindDoc({ kind: "GENERATOR", originalFileName: "제너레이터-표.pdf", content: "제너레이터" });

    const created = await captureErrors(() =>
      withArchiveRoot(root, () =>
        intake("INTERACTIVE", { intakeNumber, workflowType: "PAID_GENERATOR", serialNumber: `SN-${RUN}-MULTI` })
      )
    );

    // 🔴 두 폴더 어느 쪽에도 아무것도 넣지 않았다.
    assert.deepEqual(await readdir(path.join(root, `${intakeNumber} 먼저 만든 폴더`)), []);
    assert.deepEqual(await readdir(path.join(root, `${intakeNumber} 나중에 또 만든 폴더`)), []);
    assert.deepEqual(await folderAuditRows(created.value.id), [], "넣지 않았는데 기록이 남았다");

    await clearKindDocs();
  });

  test("④ 🔴 공유폴더 설정이 비면 아무것도 하지 않는다 — 디스크를 건드리지 않는다", async () => {
    const root = await makeRoot("intake-common-archive-");
    await addKindDoc({ kind: "GENERATOR", originalFileName: "제너레이터-표.pdf", content: "제너레이터" });

    const created = await withArchiveRoot(null, () =>
      intake("INTERACTIVE", { workflowType: "PAID_GENERATOR", serialNumber: `SN-${RUN}-OFF` })
    );

    assert.deepEqual(await readdir(root), [], "꺼져 있는데 무엇인가 생겼다");
    assert.deepEqual(await folderAuditRows(created.id), [], "꺼져 있는데 기록이 남았다");

    await clearKindDocs();
  });

  test("⑤ 🔴 같은 서류를 두 번 꽂으면 두 번째는 안 쓴다 — 번호가 쌓이지 않는다", async () => {
    const root = await makeRoot("intake-common-archive-");
    // 같은 이름 · 같은 내용의 서류가 그 종류에 둘 올라와 있다 — 둘째가 두 번째 꽂기다.
    await addKindDoc({ kind: "GENERATOR", originalFileName: "제너레이터-점검표.pdf", content: "똑같은 바이트" });
    await addKindDoc({ kind: "GENERATOR", originalFileName: "제너레이터-점검표.pdf", content: "똑같은 바이트" });

    const created = await withArchiveRoot(root, () =>
      intake("INTERACTIVE", { workflowType: "PAID_GENERATOR", serialNumber: `SN-${RUN}-TWICE` })
    );

    // 🔴 ` (2)` 가 생기지 않는다 — 내용이 같으면 쓰지 않는다(`unchanged`).
    assert.deepEqual(await commonNames(root, created.intakeNumber), ["제너레이터-점검표.pdf"]);
    // 🔴 쓰지 않은 쪽은 감사 기록도 남지 않는다 — 공유폴더에 새로 생긴 것이 없다.
    const saved = (await folderAuditRows(created.id)).filter((row) => row.actionType === "FILE_DOWNLOAD");
    assert.equal(saved.length, 1, `쓰지 않은 서류까지 기록했다: ${JSON.stringify(saved)}`);

    await clearKindDocs();
  });

  test("⑥ 🔴 EXCEL_IMPORT 접수에는 꽂지 않는다 — 폴더도 서류도 생기지 않는다", async () => {
    const root = await makeRoot("intake-common-archive-");
    await addKindDoc({ kind: "GENERATOR", originalFileName: "제너레이터-표.pdf", content: "제너레이터" });

    const created = await withArchiveRoot(root, () =>
      intake("EXCEL_IMPORT", { workflowType: "PAID_GENERATOR", serialNumber: `SN-${RUN}-EXCEL` })
    );

    assert.deepEqual(await readdir(root), [], "🔴 이관인데 공유폴더에 무엇인가 생겼다");
    assert.deepEqual(await folderAuditRows(created.id), [], "이관인데 기록이 남았다");

    await clearKindDocs();
  });

  test("🔴 매쳐로 접수하면 매쳐 서류가 들어간다 — 종류 축이 바뀌어도 같은 길이다", async () => {
    const root = await makeRoot("intake-common-archive-");
    await addKindDoc({ kind: "GENERATOR", originalFileName: "제너레이터-표.pdf", content: "제너레이터" });
    await addKindDoc({ kind: "MATCHER", originalFileName: "매쳐-표.pdf", content: "매쳐" });

    const created = await withArchiveRoot(root, () =>
      intake("INTERACTIVE", {
        workflowType: "PAID_MATCHER",
        serialNumber: `SN-${RUN}-MATCHER`,
      })
    );

    assert.deepEqual(await commonNames(root, created.intakeNumber), ["매쳐-표.pdf"]);

    await clearKindDocs();
  });
});
