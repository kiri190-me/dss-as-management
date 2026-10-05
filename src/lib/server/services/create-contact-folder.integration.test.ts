import "../../../../scripts/load-env";

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { and, eq, inArray, like } from "drizzle-orm";

import { db, pgClient } from "../../db/connection";
import {
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
import type { IntakeSubmissionInput } from "@/lib/domain/local/submit-intake";
import { createContactFolderForIntake } from "./create-contact-folder";
import { createRepairCaseWithIdempotency, type RepairCaseCreator } from "./create-repair-case";

/**
 * ============================================================================
 * 접수하면 그 자리에서 연락서 폴더가 생긴다 — 시험 DB + mkdtemp (연락서 조각 7)
 * ============================================================================
 * 🔴 **실제 공유폴더에 닿지 않는다.** 폴더가 필요한 시험은 OS 임시 폴더(mkdtemp)를
 * `CONTACT_FOLDER_ARCHIVE_DIR` 에 **직접** 넣고, 끝나면 통째로 지운다. 시험 환경에서는
 * 그 설정이 애초에 비어 있다(scripts/load-env.ts · load-test-env.ts 가 지운다) — 그
 * 사실부터 아래 첫 시험이 못 박는다.
 *
 * 못 박는 것:
 *  · 🔴 **EXCEL_IMPORT 에서는 안 만든다** — 이관 한 번에 폴더가 수백 개 생기면 안 된다
 *  · 🔴 **폴더를 못 만들어도 접수는 성공이다**
 *  · 🔴 **로그에 경로 · 루트 · 폴더 이름이 안 찍힌다**(console.error 를 받아 본다)
 *  · 🔴 **S/N 이 같은 폴더가 있어도 새 인수번호면 만든다**(조각 8 — S/N 훑기를 걷어냈다)
 *  · 🔴 **인수번호가 같은 폴더가 이미 있으면 만들지 않는다** — 유일한 안전장치다
 *  · 설정이 비면 아무 일도 안 한다 · 감사 기록을 남긴다
 *
 * 끼운 자리(트랜잭션 바깥 · 메일과 따로)는 create-contact-folder-source.test.ts 가
 * 원본을 글자로 본다.
 *
 * 격리: 인수 달 "9404"(저장소의 다른 스위트는 9401 · 9402 · 9403 · 9412 를 쓴다) ·
 * 이름 접두어 `AS-TEST-CF7-`. 고객사 · 모델 · S/N 은 전부 가짜다.
 * ============================================================================
 */

const RUN = randomUUID().slice(0, 8);
const PREFIX = "AS-TEST-CF7-";
const MONTH = "9404";
const RECEIVED_AT = "2094-04-05";
const CUSTOMER = `${PREFIX}CUST-${RUN}`;
const MODEL = `${PREFIX}MODEL-${RUN}`;

let actor: RepairCaseCreator;
let customerId: string;
let productModelId: string;
const createdRoots: string[] = [];
const trackedKeys: string[] = [];

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "intake-contact-folder-test-"));
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

async function folderNames(root: string): Promise<string[]> {
  return (await readdir(root)).sort();
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
  await pgClient.end({ timeout: 5 });
});

describe("접수하면 연락서 폴더가 생긴다", () => {
  test("🔴 시험 환경에는 실제 공유폴더 설정이 없다 — 사내 서류함에 닿을 길이 없다", () => {
    assert.equal(
      process.env.CONTACT_FOLDER_ARCHIVE_DIR,
      undefined,
      "🔴 시험이 실제 공유폴더를 가리키고 있다(scripts/load-env.ts 의 보호가 깨졌다)"
    );
  });

  test("🔴 EXCEL_IMPORT 에서는 만들지 않는다 — 이관 한 번에 폴더가 수백 개 생기면 안 된다", async () => {
    const root = await makeRoot();

    const created = await withArchiveRoot(root, () => intake("EXCEL_IMPORT", { serialNumber: `SN-${RUN}-EXCEL` }));

    assert.deepEqual(await folderNames(root), [], "🔴 이관인데 폴더가 생겼다");
    assert.deepEqual(await folderAuditRows(created.id), [], "이관인데 감사 기록이 남았다");
  });

  test("대화형 접수는 그 자리에서 폴더를 만들고 감사 기록을 남긴다", async () => {
    const root = await makeRoot();

    const created = await withArchiveRoot(root, () => intake("INTERACTIVE", { serialNumber: `SN-${RUN}-OK` }));

    const names = await folderNames(root);
    assert.equal(names.length, 1, `폴더가 하나가 아니다: ${JSON.stringify(names)}`);
    assert.ok(names[0].startsWith(`${created.intakeNumber} `), `이름이 인수번호로 시작하지 않는다: ${names[0]}`);
    assert.ok(names[0].includes(`SN-${RUN}-OK`), `이름에 S/N 이 없다: ${names[0]}`);

    const audit = await folderAuditRows(created.id);
    assert.equal(audit.length, 1, "감사 기록이 하나가 아니다");
    assert.equal(audit[0].actionType, "CREATE");
    assert.equal(audit[0].actorUserId, actor.userId);
    assert.deepEqual(audit[0].newValue, { folderName: names[0] });
  });

  test("🔴 폴더를 못 만들어도 접수는 성공이다 — 로그에 경로 · 루트가 안 찍힌다", async () => {
    const parent = await makeRoot();
    // 연결이 빠진 공유폴더 — 루트가 없으면 만들지 않고 실패한다(storage 의 규율).
    const missingRoot = path.join(parent, "연결-안-된-공유폴더");

    const { value: created, logs } = await captureErrors(() =>
      withArchiveRoot(missingRoot, () => intake("INTERACTIVE", { serialNumber: `SN-${RUN}-BROKEN` }))
    );

    // 🔴 접수는 그대로다 — 행이 살아 있다.
    const [row] = await db
      .select({ intakeNumber: repairCases.intakeNumber })
      .from(repairCases)
      .where(eq(repairCases.id, created.id));
    assert.ok(row, "폴더가 실패하자 접수까지 되돌아갔다");
    assert.equal(row.intakeNumber, created.intakeNumber);

    assert.deepEqual(await folderNames(parent), [], "🔴 루트가 없는데 무엇인가 생겼다");
    assert.deepEqual(await folderAuditRows(created.id), [], "만들지 못했는데 기록이 남았다");

    // 🔴 실패를 알리되, 운영 로그에 사내 폴더 구조를 적지 않는다.
    const joined = logs.join("\n");
    assert.ok(logs.length > 0, "실패를 아무도 모르게 지나갔다");
    assert.ok(joined.includes(created.id), "어느 수리 건인지 적지 않았다");
    assert.equal(joined.includes(missingRoot), false, `로그에 루트가 들어 있다: ${joined}`);
    assert.equal(joined.includes(parent), false, `로그에 경로가 들어 있다: ${joined}`);
    assert.equal(joined.includes(os.tmpdir()), false, `로그에 임시 폴더 경로가 들어 있다: ${joined}`);
    assert.equal(joined.includes("연결-안-된-공유폴더"), false, `로그에 폴더 이름이 들어 있다: ${joined}`);
    assert.equal(joined.includes(CUSTOMER), false, `로그에 고객사 이름이 들어 있다: ${joined}`);
  });

  test("🔴 S/N 이 같은 폴더가 이미 있어도 **새 인수번호면 만든다** (조각 8)", async () => {
    const root = await makeRoot();
    const serialNumber = `SN-${RUN}-AGAIN`;
    // 같은 장비가 다시 수리를 온 모양 — 이름의 나머지 조각이 전부 같은 폴더가 둘 있다.
    //  (가) 사람이 인수번호 없이 만들어 둔 폴더  (나) 지난번 수리 건의 폴더
    const noNumber = `${CUSTOMER} ${MODEL} ${serialNumber} 점검요청`;
    const lastTime = `D250101 ${CUSTOMER} ${MODEL} ${serialNumber} 점검요청`;
    await mkdir(path.join(root, noNumber));
    await mkdir(path.join(root, lastTime));

    const created = await withArchiveRoot(root, () => intake("INTERACTIVE", { serialNumber }));

    // 🔴 조각 5 는 여기서 멈췄다(S/N 훑기). 2026-10-05 그 장치를 걷어냈다.
    const names = await folderNames(root);
    assert.equal(names.length, 3, `새 폴더가 생기지 않았다: ${JSON.stringify(names)}`);
    const mine = names.filter((name) => name.startsWith(`${created.intakeNumber} `));
    assert.equal(mine.length, 1, `새 인수번호의 폴더가 하나가 아니다: ${JSON.stringify(names)}`);
    // 🔴 옆 폴더는 한 글자도 건드리지 않았다.
    assert.ok(names.includes(noNumber), "사람이 만들어 둔 폴더가 사라졌다");
    assert.ok(names.includes(lastTime), "지난번 수리 건의 폴더가 사라졌다");

    const audit = await folderAuditRows(created.id);
    assert.equal(audit.length, 1, "만들었는데 기록이 없다");
    assert.deepEqual(audit[0].newValue, { folderName: mine[0] });
  });

  test("🔴 인수번호가 같은 폴더가 있으면 만들지 않는다 — 소문자로 적혀 있어도", async () => {
    const root = await makeRoot();
    const created = await intake("EXCEL_IMPORT", { serialNumber: `SN-${RUN}-EXIST` });
    // 🔴 사람이 소문자로 적어 두었다. 리눅스(NAS)에서는 다른 이름이라, 접어 보지 않으면
    //    폴더가 둘이 된다. 이름의 나머지 조각은 이 건과 한 글자도 겹치지 않는다.
    const human = `${created.intakeNumber.toLocaleLowerCase("en-US")}  사람이 먼저 만든 폴더`;
    await mkdir(path.join(root, human));

    const result = await withArchiveRoot(root, () =>
      createContactFolderForIntake({ repairCaseId: created.id, actorUserId: actor.userId })
    );

    assert.deepEqual(result, { status: "found" });
    assert.deepEqual(await folderNames(root), [human], "이미 있는데 또 만들었다");
    assert.deepEqual(await folderAuditRows(created.id), [], "우리가 만든 것이 아닌데 기록이 남았다");
  });

  test("🔴 설정이 비면 아무 일도 하지 않는다 — 디스크를 건드리지 않는다", async () => {
    const root = await makeRoot();
    const created = await intake("EXCEL_IMPORT", { serialNumber: `SN-${RUN}-OFF` });

    const result = await withArchiveRoot(null, () =>
      createContactFolderForIntake({ repairCaseId: created.id, actorUserId: actor.userId })
    );

    assert.deepEqual(result, { status: "disabled" });
    assert.deepEqual(await folderNames(root), [], "꺼져 있는데 무엇인가 생겼다");
    assert.deepEqual(await folderAuditRows(created.id), [], "꺼져 있는데 기록이 남았다");
  });

  test("휴지통에 간 건은 만들지 않는다 — 조각 5 와 같은 조회를 쓴다", async () => {
    const root = await makeRoot();
    const created = await intake("EXCEL_IMPORT", { serialNumber: `SN-${RUN}-TRASH` });
    await db
      .update(repairCases)
      .set({ isDeleted: true, deletedAt: new Date(), deletedBy: actor.userId, deleteReason: "시험 — 휴지통" })
      .where(eq(repairCases.id, created.id));

    const result = await withArchiveRoot(root, () =>
      createContactFolderForIntake({ repairCaseId: created.id, actorUserId: actor.userId })
    );

    assert.equal(result.status, "failed", JSON.stringify(result));
    assert.deepEqual(await folderNames(root), [], "휴지통 건인데 폴더가 생겼다");
  });
});
