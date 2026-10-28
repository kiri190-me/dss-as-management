import "../../../../scripts/load-env";

import {
  INVENTORY_STUB_NO_REQUESTS,
  installInventoryFetchStub,
  setInventoryStubAnswer,
} from "../../../../scripts/test-inventory-fetch-stub";

import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { and, asc, eq, inArray, like, sql } from "drizzle-orm";

import { db, pgClient } from "@/lib/db/connection";
import {
  attachments,
  customers,
  products,
  repairCaseIntakeSequences,
  repairCaseUsedParts,
  repairCaseWorkRecords,
  repairCases,
  statusChangeHistories,
  users,
} from "@/lib/db/schema";
import { createRepairCase } from "@/lib/db/mutations/repair-cases";
import { readKyosanReport } from "@/lib/kyosan/kyosan-report";
import { createLocalFileSystemStorageAdapter } from "@/lib/storage/local-fs-adapter";
import type { StorageAdapter } from "@/lib/storage/storage-adapter";
import { writeZip, type ZipEntryInput } from "@/lib/xlsx/zip-writer";
import type { ValidatedCreateRepairCaseInput } from "@/lib/validation/repair-case-input";
import {
  collectKyosanWorkbookPaths,
  runKyosanReportImport,
} from "../../../../scripts/lib/kyosan-import-run";
import { readKyosanRevertPlan } from "../../../../scripts/lib/kyosan-import-revert";
import { runKyosanUsedPartsBackfill } from "../../../../scripts/lib/kyosan-used-parts-backfill";
import { importKyosanReport } from "./kyosan-report-import";

/**
 * ============================================================================
 * 🔴 연락서 **사용 부품 백필** — 이미 이식된 건의 부품만 다시 적는다 (2026-10-28)
 * ============================================================================
 * 이 도구는 **운영 자료를 대량으로 고치는 도구**다. 그래서 이 시험이 못 박는 것은
 * 「많이 바꾸는가」가 아니라 **「바꾸지 말아야 할 것을 한 줄도 안 바꾸는가」**와
 * **「바꾼 뒤에도 되돌릴 수 있는가」**다.
 *
 *  1. 🔴 **`--apply` 없이는 DB 가 한 줄도 안 바뀐다** ← 가장 중요하다.
 *  2. 🔴 **작업 기록도 첨부도 늘지 않는다** — 이 도구가 존재하는 까닭이 그것이다
 *     (연락서를 다시 「넣으면」 둘 다 한 벌 더 생긴다).
 *  3. 🔴 **이식 흔적이 새로 안 생긴다.** 기존 흔적의 `usedPartIds` 가 **새 줄**을
 *     가리키도록 갈아 끼운다.
 *  4. 🔴 **되돌리기가 그대로 말이 된다** — 백필 뒤에도
 *     `revert-kyosan-import.ts --batch <원래 회차>` 가 그 흔적을 「되돌릴 것」으로
 *     고르고, 지울 줄로 **새 줄**을 집는다.
 *  5. 🔴 **멱등 장치(`ALREADY_IMPORTED`)가 글자 하나 같게 산다** — 백필은 그 길로
 *     가지 않으므로, 같은 연락서를 다시 넣으려 하면 지금과 똑같이 거절해야 한다.
 *  6. 🔴 **사람이 그 뒤에 고친 칸 · 옛 흔적 · 한 건에 여러 장 · 부품 요청이 있는
 *     건 · 재고 관리에 못 물어본 건**은 전부 **한 줄도 안 바꾸고** 갈래로 찍힌다.
 *
 * ── 🔴 시험용 연락서는 전부 손으로 지은 가짜다 ───────────────────────
 * 이웃 스위트와 같은 규율이다 — 실제 연락서에는 고객명 · 모델 · S/N 이 그대로 들어
 * 있어 고정 시험 파일로 한 장도 넣지 않는다.
 *
 * ── 격리 규약 ────────────────────────────────────────────────────────
 * 🔴 이 시험 DB(`dss_as_test`)는 **PO 저장소와 함께 쓴다.** 이 스위트만 쓰는
 * 접수 월 **"9409"**, 고객사 접두사 **"AS-TEST-KYBF-"**, 제품 모델 접두사
 * **"KYBF-TEST-"** — 어느 것도 다른 스위트와 겹치지 않는다(A/S 의
 * `AS-TEST-KYRUN-`/9412 · `AS-TEST-KYIMP-`/9609 · `AS-TEST-KYREV-`/9312 ·
 * 목록 정렬 9410 · 목록 칸 9411 · `AS-TEST-QUOTE-LOOKUP-`/9603, PO 의 9503·9506).
 * 🔴 **저장 루트를 건드리지 않는다** — 어댑터를 OS 임시 폴더로 직접 만들어 넘긴다.
 *
 * `after()` 는 FK 차례대로 지운다. 🔴 `audit_logs` 는 지우지 않는다
 * (`test-cleanup-static-safety.test.ts` 가 금지한다).
 * ============================================================================
 */

const TEST_CUSTOMER_NAME_PREFIX = "AS-TEST-KYBF-";
const TEST_MODEL_PREFIX = "KYBF-TEST-";
const TEST_YEAR_MONTH = "9409";
const TEST_RECEIVED_AT = "2094-09-05";
const TODAY = "2094-09-20";
const DATABASE_NAME = "dss_as_test";

/** 🔴 연락서에 적히는 일본어 품명과, 이식·백필이 저장하는 한글. */
const PART_JAPANESE = "終段AMP基板";
const PART_KOREAN = "종단 AMP 기판";

let actorUserId: string;
let customerId: string;
let storageRoot: string;
let storage: StorageAdapter;
let inboxRoot: string;

const createdCaseIds: string[] = [];

// ─────────────────────────────────────────────── 가짜 연락서 한 장

/**
 * 🔴 **사진도 그림도 없는 가장 작은 연락서**다. 이 스위트가 재는 것은 사용 부품
 * 한 칸이라 Card 시트의 몇 칸이면 된다(사진이 있는 장은 러너 스위트가 잰다).
 * 짓는 방식은 `kyosan-report-import-run.integration.test.ts` 의 것을 줄인 것이다.
 */
const MAIN_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const PKG_REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships";

type FakeSheet = { name: string; cells?: Record<string, string> };

function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function sheetXml(cells: Record<string, string>): string {
  const byRow = new Map<number, { column: string; xml: string }[]>();
  for (const [address, value] of Object.entries(cells)) {
    const matched = /^([A-Z]+)(\d+)$/.exec(address);
    assert.ok(matched, `칸 주소가 아니다: ${address}`);
    const row = Number(matched[2]);
    byRow.set(row, [
      ...(byRow.get(row) ?? []),
      { column: matched[1], xml: `<c r="${address}" t="inlineStr"><is><t>${escapeXml(value)}</t></is></c>` },
    ]);
  }
  const rowsXml = [...byRow.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(
      ([row, entries]) =>
        `<row r="${row}">${entries
          .sort((a, b) => a.column.length - b.column.length || (a.column < b.column ? -1 : 1))
          .map((entry) => entry.xml)
          .join("")}</row>`
    )
    .join("");
  return `<worksheet xmlns="${MAIN_NS}" xmlns:r="${REL_NS}"><sheetData>${rowsXml}</sheetData></worksheet>`;
}

function workbookOf(sheets: readonly FakeSheet[]): Buffer {
  const entries: ZipEntryInput[] = [];
  const sheetTags = sheets
    .map((sheet, index) => `<sheet name="${escapeXml(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`)
    .join("");
  entries.push({
    name: "xl/workbook.xml",
    data: Buffer.from(
      `<workbook xmlns="${MAIN_NS}" xmlns:r="${REL_NS}"><workbookPr/><sheets>${sheetTags}</sheets></workbook>`,
      "utf8"
    ),
  });
  entries.push({
    name: "xl/_rels/workbook.xml.rels",
    data: Buffer.from(
      `<Relationships xmlns="${PKG_REL_NS}">${sheets
        .map(
          (_sheet, index) =>
            `<Relationship Id="rId${index + 1}" Type="${REL_NS}/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`
        )
        .join("")}</Relationships>`,
      "utf8"
    ),
  });
  sheets.forEach((sheet, index) => {
    entries.push({
      name: `xl/worksheets/sheet${index + 1}.xml`,
      data: Buffer.from(sheetXml(sheet.cells ?? {}), "utf8"),
    });
  });
  return writeZip(entries);
}

type FakeReportOptions = {
  intakeNumber: string;
  model: string;
  serialNumber: string;
  faultPart: string;
  /** 같은 내용이라도 바이트를 다르게 만들어 sourceSha256 을 가른다. */
  salt: string;
};

function fakeReportBytes(options: FakeReportOptions): Buffer {
  const card: Record<string, string> = {
    A11: "引取No.(Receiving_No.)",
    A25: "客先(Customer)",
    A34: "型式(MODEL)",
    A36: "S/N",
    A45: "客先故障状況①",
    A50: "社内確認結果①",
    A55: "備考(Notes)",
    B71: "故障①/⑥",
    A88: "詳細(Details/Comments)",
    C11: options.intakeNumber,
    C25: "값-고객사",
    C34: options.model,
    C36: options.serialNumber,
    C45: "값-고객이-말한-증상",
    C71: options.faultPart,
    C88: options.salt,
  };
  const report: Record<string, string> = {
    C30: "原　因",
    J30: "製作不良",
    C64: "備　考",
  };
  const bytes = workbookOf([
    { name: "List" },
    { name: "Card", cells: card },
    { name: "Repair_Report", cells: report },
  ]);
  const read = readKyosanReport(bytes);
  assert.equal(read.ok, true, `가짜 연락서를 못 읽었다: ${JSON.stringify(read)}`);
  return bytes;
}

// ─────────────────────────────────────────────── 거들이

function baseCreateRepairCaseInput(suffix: string): ValidatedCreateRepairCaseInput {
  return {
    workflowType: "PAID_MATCHER",
    billingType: "PAID",
    customerId,
    endUserId: null,
    assignedEngineerId: actorUserId,
    receivedAt: TEST_RECEIVED_AT,
    customerRequestedDueDate: null,
    internalTargetShipmentDate: null,
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

type ImportedCase = {
  repairCaseId: string;
  intakeNumber: string;
  filePath: string;
  bytes: Buffer;
  importBatchId: string;
  traceId: string;
  /** 이식이 넣은 사용 부품 줄의 id. */
  importedRowIds: string[];
};

async function readTraces(repairCaseId: string) {
  return db
    .select({ id: statusChangeHistories.id, metadata: statusChangeHistories.metadata })
    .from(statusChangeHistories)
    .where(
      and(
        eq(statusChangeHistories.repairCaseId, repairCaseId),
        sql`${statusChangeHistories.metadata} ->> 'source' = 'KYOSAN_REPORT'`
      )
    )
    .orderBy(asc(statusChangeHistories.createdAt));
}

async function readRows(repairCaseId: string) {
  return db
    .select({
      id: repairCaseUsedParts.id,
      lineNo: repairCaseUsedParts.lineNo,
      partId: repairCaseUsedParts.partId,
      partNameText: repairCaseUsedParts.partNameText,
      quantity: repairCaseUsedParts.quantity,
    })
    .from(repairCaseUsedParts)
    .where(eq(repairCaseUsedParts.repairCaseId, repairCaseId))
    .orderBy(asc(repairCaseUsedParts.lineNo));
}

/** 지금 이 건의 상태를 통째로 찍는다 — 「한 줄도 안 바뀌었다」를 재는 자다. */
async function snapshotCase(repairCaseId: string) {
  const [caseRow] = await db
    .select({ reportedSymptom: repairCases.reportedSymptom, version: repairCases.version })
    .from(repairCases)
    .where(eq(repairCases.id, repairCaseId));
  const workRecords = await db
    .select({ id: repairCaseWorkRecords.id, memo: repairCaseWorkRecords.memo })
    .from(repairCaseWorkRecords)
    .where(eq(repairCaseWorkRecords.repairCaseId, repairCaseId))
    .orderBy(asc(repairCaseWorkRecords.id));
  const files = await db
    .select({ id: attachments.id, storedPath: attachments.storedPath })
    .from(attachments)
    .where(eq(attachments.repairCaseId, repairCaseId))
    .orderBy(asc(attachments.id));
  const traces = await readTraces(repairCaseId);
  return {
    caseRow,
    workRecords,
    files,
    usedParts: await readRows(repairCaseId),
    traces: traces.map((trace) => ({ id: trace.id, metadata: trace.metadata })),
  };
}

/**
 * 🔴 **진짜 이식을 한 번 돌려** 흔적과 사용 부품 줄을 만든다. 손으로 흔적을 지어
 * 넣으면 「이식이 실제로 만드는 모양」과 갈라져, 백필이 운영에서 만날 모양을 못
 * 잰다.
 */
async function seedImportedCase(label: string): Promise<ImportedCase> {
  const suffix = randomUUID().slice(0, 8);
  const created = await createRepairCase(baseCreateRepairCaseInput(suffix));
  assert.equal(created.ok, true, `접수 건 준비 실패: ${JSON.stringify(created)}`);
  assert.ok(created.ok);
  createdCaseIds.push(created.id);

  const dir = path.join(inboxRoot, `${label}-${randomUUID().slice(0, 8)}`);
  await mkdir(dir, { recursive: true });
  const filePath = path.join(dir, "0001.xlsm");
  const bytes = fakeReportBytes({
    intakeNumber: created.intakeNumber,
    model: `${TEST_MODEL_PREFIX}${suffix}`,
    serialNumber: `SN-${suffix}`,
    faultPart: PART_JAPANESE,
    salt: `${label}-${suffix}`,
  });
  await writeFile(filePath, bytes);

  const importBatchId = randomUUID();
  const record = await runKyosanReportImport({
    files: collectKyosanWorkbookPaths({ dirs: [], files: [filePath], limit: null }),
    apply: true,
    databaseName: DATABASE_NAME,
    actorUserId,
    importBatchId,
    storage,
    today: TODAY,
  });
  assert.equal(record.tally.imported, 1, `이식 준비 실패: ${JSON.stringify(record.files[0])}`);

  const traces = await readTraces(created.id);
  assert.equal(traces.length, 1, "준비 단계에서 흔적은 하나여야 한다");
  const rows = await readRows(created.id);
  assert.equal(rows.length, 1, "준비 단계에서 사용 부품은 한 줄이어야 한다");
  assert.equal(rows[0].partNameText, PART_KOREAN, "이식은 한글로 넣는다");

  return {
    repairCaseId: created.id,
    intakeNumber: created.intakeNumber,
    filePath,
    bytes,
    importBatchId,
    traceId: traces[0].id,
    importedRowIds: rows.map((row) => row.id),
  };
}

/**
 * 🔴 **운영의 모습을 흉내 낸다** — 「옛 방식으로 저장된 줄」. 줄의 **id 는 그대로**
 * 두고 글자만 일본어로 돌린다(사람이 손댄 것이 아니라, 넣던 규칙이 달랐을 뿐이라
 * 흔적의 `usedPartIds` 는 여전히 이 줄을 가리킨다).
 */
async function makeRowsLookOld(repairCaseId: string): Promise<void> {
  await db
    .update(repairCaseUsedParts)
    .set({ partNameText: PART_JAPANESE })
    .where(eq(repairCaseUsedParts.repairCaseId, repairCaseId));
}

async function backfill(target: ImportedCase, apply: boolean) {
  return runKyosanUsedPartsBackfill({
    workbookPaths: [target.filePath],
    apply,
    databaseName: DATABASE_NAME,
    actorUserId,
    backfillRunId: apply ? randomUUID() : undefined,
    limit: null,
  });
}

// ─────────────────────────────────────────────── 밑자락

let restoreInventoryStub: (() => void) | null = null;

before(() => {
  restoreInventoryStub = installInventoryFetchStub();
});

beforeEach(() => {
  // 🔴 시험마다 「신청 없음」으로 되돌린다 — 앞 시험이 세운 답이 남으면 뒤 시험이
  //    남의 설정으로 통과한다.
  setInventoryStubAnswer(INVENTORY_STUB_NO_REQUESTS);
});

before(async () => {
  const [engineer] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.role, "AS_ENGINEER"), eq(users.approvalStatus, "APPROVED"), eq(users.isDeleted, false)))
    .limit(1);
  assert.ok(engineer, "시험 DB 에 승인된 AS_ENGINEER 가 한 명은 있어야 한다");
  actorUserId = engineer.id;

  const [customer] = await db
    .insert(customers)
    .values({ name: `${TEST_CUSTOMER_NAME_PREFIX}${randomUUID().slice(0, 8)}` })
    .returning({ id: customers.id });
  customerId = customer.id;

  // 🔴 저장 루트를 건드리지 않는다 — 어댑터를 임시 폴더로 직접 만든다.
  storageRoot = await mkdtemp(path.join(tmpdir(), "dss-kybf-store-"));
  storage = createLocalFileSystemStorageAdapter(storageRoot);
  inboxRoot = await mkdtemp(path.join(tmpdir(), "dss-kybf-inbox-"));
});

after(async () => {
  restoreInventoryStub?.();
  restoreInventoryStub = null;
  if (createdCaseIds.length > 0) {
    await db.delete(attachments).where(inArray(attachments.repairCaseId, createdCaseIds));
    await db.delete(repairCaseUsedParts).where(inArray(repairCaseUsedParts.repairCaseId, createdCaseIds));
    // 🔴 작업 기록은 건을 지워도 `ON DELETE SET NULL` 로 살아남는다.
    await db.delete(repairCaseWorkRecords).where(inArray(repairCaseWorkRecords.repairCaseId, createdCaseIds));
    await db.delete(statusChangeHistories).where(inArray(statusChangeHistories.repairCaseId, createdCaseIds));
  }
  await db.delete(repairCases).where(like(repairCases.intakeNumber, `D${TEST_YEAR_MONTH}%`));
  await db.delete(products).where(like(products.modelName, `${TEST_MODEL_PREFIX}%`));
  await db.delete(repairCaseIntakeSequences).where(eq(repairCaseIntakeSequences.yearMonth, TEST_YEAR_MONTH));
  await db.delete(customers).where(like(customers.name, `${TEST_CUSTOMER_NAME_PREFIX}%`));
  await rm(storageRoot, { recursive: true, force: true });
  await rm(inboxRoot, { recursive: true, force: true });
  await pgClient.end({ timeout: 5 });
});

// ══════════════════════════════════════════════ 🔴 1. `--apply` 없이는 한 글자도

describe("🔴 `--apply` 없이 돌리면 DB 가 한 줄도 안 바뀐다", () => {
  test("계획 전후의 스냅숏이 글자까지 같다 — 그리고 바꿀 건을 제대로 세고 있다", async () => {
    const target = await seedImportedCase("plan");
    await makeRowsLookOld(target.repairCaseId);

    const before = await snapshotCase(target.repairCaseId);
    const record = await backfill(target, false);
    const after = await snapshotCase(target.repairCaseId);

    assert.deepEqual(after, before, "🔴 계획을 읽었을 뿐인데 DB 가 바뀌었다");

    // 「안 바뀌었다」가 「아무것도 못 찾았다」여서는 안 된다.
    assert.equal(record.mode, "dry-run");
    assert.equal(record.backfillRunId, null, "🔴 계획에서는 회차 번호를 만들지 않는다");
    assert.equal(record.tally.updatable, 1, JSON.stringify(record.tally));
    assert.equal(record.tally.updated, 0);
    assert.equal(record.traces.length, 1, "내 파일과 짝지은 흔적만 돈다");
    assert.equal(record.traces[0].traceId, target.traceId);
    assert.equal(record.traces[0].intakeNumber, target.intakeNumber);
    assert.equal(record.changedPreviousLineTotal, 1);
    assert.equal(record.changedNextLineTotal, 1);
    assert.equal(
      record.changedPreviousQuantityTotal,
      record.changedNextQuantityTotal,
      "🔴 묶기는 수량을 더하므로 전후 합계가 같아야 한다"
    );
  });
});

// ══════════════════════════════════════════════ 🔴 2. 바꾸고 나서도 되돌릴 수 있다

describe("🔴 `--apply` — 사용 부품만 갈아 끼운다", () => {
  test("줄은 바뀌고, 🔴 작업 기록·첨부·신고 증상·흔적 수는 한 줄도 안 는다", async () => {
    const target = await seedImportedCase("apply");
    await makeRowsLookOld(target.repairCaseId);
    const before = await snapshotCase(target.repairCaseId);
    assert.equal(before.usedParts[0].partNameText, PART_JAPANESE, "준비: 옛 글자가 들어 있다");

    const record = await backfill(target, true);
    assert.equal(record.tally.updated, 1, JSON.stringify(record.tally));
    const after = await snapshotCase(target.repairCaseId);

    // ── 바뀐 것: 사용 부품 한 줄 ──
    assert.equal(after.usedParts.length, 1);
    assert.equal(after.usedParts[0].partNameText, PART_KOREAN, "🔴 품명이 다시 읽혀 들어갔다");
    assert.equal(after.usedParts[0].lineNo, 1, "차례는 1번부터 다시 매긴다");
    assert.equal(after.usedParts[0].partId, null, "부품 대장과 이어 붙이지 않는다");
    assert.notEqual(
      after.usedParts[0].id,
      before.usedParts[0].id,
      "지우고 다시 넣었으므로 줄 id 가 새것이다"
    );

    // ── 🔴 안 바뀐 것 ──
    assert.deepEqual(after.workRecords, before.workRecords, "🔴 작업 기록이 늘었다");
    assert.deepEqual(after.files, before.files, "🔴 첨부가 늘었다");
    assert.equal(
      after.caseRow.reportedSymptom,
      before.caseRow.reportedSymptom,
      "🔴 신고 증상을 건드렸다"
    );
    assert.equal(after.traces.length, 1, "🔴 이식 흔적이 새로 생겼다");
    assert.equal(after.traces[0].id, target.traceId, "🔴 흔적 id 가 바뀌었다");
    assert.ok(
      after.caseRow.version > before.caseRow.version,
      "사용 부품 저장과 같이 version 은 올린다"
    );
  });

  test("🔴 기존 흔적의 usedPartIds 가 **새 줄**을 가리킨다", async () => {
    const target = await seedImportedCase("trace");
    await makeRowsLookOld(target.repairCaseId);
    await backfill(target, true);

    const rows = await readRows(target.repairCaseId);
    const traces = await readTraces(target.repairCaseId);
    assert.equal(traces.length, 1);
    const metadata = traces[0].metadata as {
      usedPartIds?: string[];
      usedPartCount?: number;
      importBatchId?: string;
      attachmentIds?: string[];
      workRecordIds?: string[];
      usedPartsBackfills?: { previousUsedPartCount?: number }[];
    };
    assert.deepEqual(metadata.usedPartIds, rows.map((row) => row.id), "🔴 흔적이 옛 줄을 가리킨다");
    assert.equal(metadata.usedPartCount, rows.length);
    assert.equal(
      metadata.importBatchId,
      target.importBatchId,
      "🔴 회차 번호를 건드리면 --batch 되돌리기가 그 건을 못 찾는다"
    );
    assert.ok(Array.isArray(metadata.attachmentIds), "첨부 id 목록을 그대로 둔다");
    assert.ok(Array.isArray(metadata.workRecordIds), "작업 기록 id 목록을 그대로 둔다");
    assert.equal(metadata.usedPartsBackfills?.length, 1, "백필 자국을 한 줄 남긴다");
    assert.equal(metadata.usedPartsBackfills?.[0].previousUsedPartCount, 1);
  });

  test("🔴 되돌리기가 그대로 말이 된다 — `--batch` 가 그 흔적을 **새 줄**과 함께 고른다", async () => {
    const target = await seedImportedCase("revert");
    await makeRowsLookOld(target.repairCaseId);
    await backfill(target, true);
    const rows = await readRows(target.repairCaseId);

    const plan = await readKyosanRevertPlan({ kind: "batch", importBatchId: target.importBatchId });
    assert.equal(plan.decisions.length, 1, "🔴 그 회차의 흔적을 못 찾았다");
    const decision = plan.decisions[0];
    assert.equal(
      decision.kind,
      "revert",
      `🔴 되돌리기가 이 흔적을 건너뛴다: ${JSON.stringify(decision)}`
    );
    assert.ok(decision.kind === "revert");
    assert.equal(decision.basis, "id", "🔴 id 로 고르는 길이어야 한다");
    assert.deepEqual(
      [...decision.usedPartIds].sort(),
      rows.map((row) => row.id).sort(),
      "🔴 되돌리기가 지울 줄이 백필이 넣은 줄과 다르다"
    );
    assert.ok(decision.attachmentIds.length > 0, "첨부도 그대로 되돌릴 수 있다");
  });

  test("🔴 멱등 장치는 그대로다 — 백필 뒤에도 같은 연락서는 다시 안 들어간다", async () => {
    const target = await seedImportedCase("already");
    await makeRowsLookOld(target.repairCaseId);
    await backfill(target, true);
    const before = await snapshotCase(target.repairCaseId);

    const read = readKyosanReport(target.bytes);
    assert.ok(read.ok);
    const result = await importKyosanReport({
      report: read.report,
      sourceFileName: "0001.xlsm",
      sourceBytes: target.bytes,
      actorUserId,
      storage,
      today: TODAY,
    });
    assert.equal(result.ok, false);
    assert.ok(!result.ok);
    assert.equal(result.code, "ALREADY_IMPORTED");
    // 🔴 **글자 하나 같게** — 사람이 보는 문장이 백필 때문에 달라지면 안 된다.
    assert.equal(
      result.message,
      "이미 넣은 연락서입니다(원본 파일이 같습니다) — 다시 넣지 않습니다."
    );
    assert.deepEqual(await snapshotCase(target.repairCaseId), before, "거절했는데 뭔가 바뀌었다");
  });

  test("🔵 두 번 돌리면 둘째는 `unchanged` — 한 글자도 안 쓴다", async () => {
    const target = await seedImportedCase("twice");
    await makeRowsLookOld(target.repairCaseId);
    const first = await backfill(target, true);
    assert.equal(first.tally.updated, 1);
    const before = await snapshotCase(target.repairCaseId);

    const second = await backfill(target, true);
    assert.equal(second.tally.unchanged, 1, JSON.stringify(second.tally));
    assert.equal(second.tally.updated, 0);
    assert.deepEqual(await snapshotCase(target.repairCaseId), before, "🔴 같은데도 다시 썼다");
  });
});

// ══════════════════════════════════════════════ 🔴 3. 바꾸지 말아야 할 때

describe("🔴 손대면 안 되는 건은 한 줄도 안 바꾼다", () => {
  test("사람이 그 뒤에 한 줄을 더 적었으면 `row-mismatch`", async () => {
    const target = await seedImportedCase("mismatch");
    await makeRowsLookOld(target.repairCaseId);
    await db.insert(repairCaseUsedParts).values({
      repairCaseId: target.repairCaseId,
      lineNo: 2,
      partId: null,
      partNameText: "값-사람이-손으로-적은-줄",
      quantity: 1,
    });
    const before = await snapshotCase(target.repairCaseId);

    const record = await backfill(target, true);
    assert.equal(record.tally["row-mismatch"], 1, JSON.stringify(record.tally));
    assert.deepEqual(await snapshotCase(target.repairCaseId), before, "🔴 사람의 줄이 사라졌다");
  });

  test("🔴 옛 흔적(usedPartIds 가 없다)은 `legacy-trace` — 갈아 끼울 칸이 없다", async () => {
    const target = await seedImportedCase("legacy");
    await makeRowsLookOld(target.repairCaseId);
    const [trace] = await readTraces(target.repairCaseId);
    const metadata = { ...(trace.metadata as Record<string, unknown>) };
    delete metadata.usedPartIds;
    await db
      .update(statusChangeHistories)
      .set({ metadata })
      .where(eq(statusChangeHistories.id, trace.id));
    const before = await snapshotCase(target.repairCaseId);

    const record = await backfill(target, true);
    assert.equal(record.tally["legacy-trace"], 1, JSON.stringify(record.tally));
    assert.deepEqual(await snapshotCase(target.repairCaseId), before);
  });

  test("🔴 한 건에 연락서 흔적이 둘이면 `multi-trace`", async () => {
    const target = await seedImportedCase("multi");
    await makeRowsLookOld(target.repairCaseId);
    const [caseRow] = await db
      .select({
        workflowVersionId: repairCases.workflowVersionId,
        currentWorkflowStepId: repairCases.currentWorkflowStepId,
      })
      .from(repairCases)
      .where(eq(repairCases.id, target.repairCaseId));
    await db.insert(statusChangeHistories).values({
      repairCaseId: target.repairCaseId,
      workflowVersionId: caseRow.workflowVersionId,
      fromStepId: caseRow.currentWorkflowStepId,
      toStepId: caseRow.currentWorkflowStepId,
      actionType: "LEGACY_IMPORT_STATE_SET",
      actorUserId,
      reason: "값-다른-연락서-이식",
      metadata: {
        source: "KYOSAN_REPORT",
        sourceSha256: "0".repeat(64),
        usedPartIds: [],
        usedPartCount: 0,
        attachmentIds: [],
        attachmentCount: 0,
        photoCount: 0,
        workRecordIds: [],
        reportedSymptomFilled: false,
        importBatchId: null,
      },
    });
    const before = await snapshotCase(target.repairCaseId);

    const record = await backfill(target, true);
    assert.equal(record.tally["multi-trace"], 1, JSON.stringify(record.tally));
    assert.deepEqual(await snapshotCase(target.repairCaseId), before);
  });

  test("🔴 재고 관리에 못 물어보면 `inventory-unknown` — 「없다」로 눕히지 않는다", async () => {
    const target = await seedImportedCase("unreachable");
    await makeRowsLookOld(target.repairCaseId);
    const before = await snapshotCase(target.repairCaseId);

    setInventoryStubAnswer({ kind: "down", httpStatus: 503 });
    const record = await backfill(target, true);
    assert.equal(record.tally["inventory-unknown"], 1, JSON.stringify(record.tally));
    assert.deepEqual(await snapshotCase(target.repairCaseId), before);
  });

  test("부품 요청(반출) 흔적이 있으면 `part-request-present` — 설계대로 안 넣는다", async () => {
    const target = await seedImportedCase("requested");
    await makeRowsLookOld(target.repairCaseId);
    const before = await snapshotCase(target.repairCaseId);

    setInventoryStubAnswer({ kind: "requests", count: 2 });
    const record = await backfill(target, true);
    assert.equal(record.tally["part-request-present"], 1, JSON.stringify(record.tally));
    assert.deepEqual(await snapshotCase(target.repairCaseId), before);
  });
});
