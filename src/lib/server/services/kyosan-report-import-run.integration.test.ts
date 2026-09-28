import "../../../../scripts/load-env";

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
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

/**
 * ============================================================================
 * 🔴 연락서 **일괄 이식 러너** — 503장을 한 회차로 돈다 (조각 S5-C)
 * ============================================================================
 * 러너는 **실 자료를 대량으로 쓰는 도구**다. 그래서 이 시험이 못 박는 것은
 * 「많이 넣는가」가 아니라 **「넣지 말아야 할 때 한 줄도 안 넣는가」**와
 * **「넣은 것을 되돌릴 수 있는가」**다.
 *
 *  1. 🔴 **`--apply` 없이 돌리면 DB 가 한 줄도 안 바뀐다** ← 가장 중요하다.
 *     디스크(저장소 루트)에도 파일 하나 생기지 않는다.
 *  2. 🔴 **회차 번호가 넣은 모든 흔적에 같은 값으로** 들어간다 — 그래야
 *     `revert-kyosan-import.ts --batch <번호>` 로 한 번에 되돌릴 수 있다.
 *     그 되돌리기 도구가 실제로 그 회차를 **전부 찾아내는지**까지 본다.
 *  3. 🔴 **한 장이 실패해도 나머지가 계속된다** — 그리고 문서가 아닌 파일
 *     (165바이트 엑셀 잠금 파일)은 **실패가 아니라 「문서 아님」**으로 세어진다.
 *  4. **이미 넣은 장은 `ALREADY_IMPORTED`** 로 세어진다.
 *  5. 🔴 **내용이 같은 파일**(sha256)을 알린다 — 이름이 아니라 내용으로 가른다.
 *
 * ── 🔴 시험용 연락서는 전부 손으로 지은 가짜다 ───────────────────────
 * `kyosan-report-import.integration.test.ts` · `kyosan-import-revert.integration
 * .test.ts` 와 같은 규율이다 — 실제 연락서에는 고객명 · 모델 · S/N 이 그대로 들어
 * 있어 고정 시험 파일로 한 장도 넣지 않는다.
 *
 * ── 격리 규약 ────────────────────────────────────────────────────────
 * 🔴 이 시험 DB(`dss_as_test`)는 **PO 저장소와 함께 쓴다.** 이 스위트만 쓰는
 * 접수 월 **"9412"**, 고객사 접두사 **"AS-TEST-KYRUN-"**, 제품 모델 접두사
 * **"KYRUN-TEST-"** — 어느 것도 다른 스위트와 겹치지 않는다(A/S 의
 * `AS-TEST-KYIMP-`/월 9609 · `AS-TEST-KYREV-`/월 9312 · `QUOTE-ATTACH-TEST-` ·
 * `ATTRASH-TEST-` · `AS-TEST-QUOTE-LOOKUP-`/월 9603, PO 의 `PO-…`/월 9503·9506).
 * 🔴 **저장 루트를 건드리지 않는다** — 어댑터를 OS 임시 폴더로 직접 만들어 넘긴다.
 *
 * `after()` 는 FK 차례대로 지운다. 🔴 `audit_logs` 는 지우지 않는다
 * (`test-cleanup-static-safety.test.ts` 가 금지한다).
 * ============================================================================
 */

const TEST_CUSTOMER_NAME_PREFIX = "AS-TEST-KYRUN-";
const TEST_MODEL_PREFIX = "KYRUN-TEST-";
const TEST_YEAR_MONTH = "9412";
const TEST_RECEIVED_AT = "2094-12-05";
const TODAY = "2094-12-20";
const DATABASE_NAME = "dss_as_test";

let actorUserId: string;
let customerId: string;
let storageRoot: string;
let storage: StorageAdapter;
let inboxRoot: string;

const createdCaseIds: string[] = [];

// ─────────────────────────────────────────────── 가짜 연락서 한 장

const MAIN_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const PKG_REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships";

type FakeSheet = { name: string; cells?: Record<string, string>; images?: string[] };

function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function sheetXml(cells: Record<string, string>, hasDrawing: boolean): string {
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
  return (
    `<worksheet xmlns="${MAIN_NS}" xmlns:r="${REL_NS}"><sheetData>${rowsXml}</sheetData>` +
    `${hasDrawing ? '<drawing r:id="rIdD1"/>' : ""}</worksheet>`
  );
}

function workbookOf(sheets: readonly FakeSheet[], media: Record<string, Buffer> = {}): Buffer {
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
    const number = index + 1;
    const images = sheet.images ?? [];
    entries.push({
      name: `xl/worksheets/sheet${number}.xml`,
      data: Buffer.from(sheetXml(sheet.cells ?? {}, images.length > 0), "utf8"),
    });
    if (images.length === 0) return;
    entries.push({
      name: `xl/worksheets/_rels/sheet${number}.xml.rels`,
      data: Buffer.from(
        `<Relationships xmlns="${PKG_REL_NS}"><Relationship Id="rIdD1" Type="${REL_NS}/drawing" ` +
          `Target="../drawings/drawing${number}.xml"/></Relationships>`,
        "utf8"
      ),
    });
    entries.push({
      name: `xl/drawings/drawing${number}.xml`,
      data: Buffer.from(
        `<xdr:wsDr xmlns:xdr="x" xmlns:a="y" xmlns:r="${REL_NS}">${images
          .map((_part, imageIndex) => `<xdr:pic><a:blip r:embed="rIdI${imageIndex + 1}"/></xdr:pic>`)
          .join("")}</xdr:wsDr>`,
        "utf8"
      ),
    });
    entries.push({
      name: `xl/drawings/_rels/drawing${number}.xml.rels`,
      data: Buffer.from(
        `<Relationships xmlns="${PKG_REL_NS}">${images
          .map(
            (part, imageIndex) =>
              `<Relationship Id="rIdI${imageIndex + 1}" Type="${REL_NS}/image" ` +
              `Target="../${part.replace(/^xl\//, "")}"/>`
          )
          .join("")}</Relationships>`,
        "utf8"
      ),
    });
  });

  for (const [part, bytes] of Object.entries(media)) entries.push({ name: part, data: bytes });
  return writeZip(entries);
}

/** 사진으로 세어지려면 10KB 이상이어야 한다(`report-photo-filter.ts` 의 실측 규칙). */
function fakePng(seed: string): Buffer {
  const magic = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const body = Buffer.alloc(12 * 1024, 0x41);
  body.write(seed, 0, "utf8");
  return Buffer.concat([magic, body]);
}

type FakeReportOptions = {
  intakeNumber: string;
  model: string;
  serialNumber: string;
  customerFault?: string | null;
  faultPart?: string | null;
  withPhoto?: boolean;
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
    C88: options.salt,
  };
  if (options.customerFault != null) card.C45 = options.customerFault;
  if (options.faultPart != null) card.C71 = options.faultPart;

  const report: Record<string, string> = {
    C30: "原　因",
    J30: "製作不良",
    R30: "部品不良",
    Z30: "謎の原因",
    C64: "備　考",
  };

  const media: Record<string, Buffer> = {};
  const images: string[] = [];
  if (options.withPhoto) {
    media["xl/media/image1.png"] = fakePng(options.salt);
    images.push("xl/media/image1.png");
  }

  const bytes = workbookOf(
    [{ name: "List" }, { name: "Card", cells: card, images }, { name: "Repair_Report", cells: report }],
    media
  );
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

type SeededCase = { id: string; intakeNumber: string; modelName: string; serialNumber: string };

async function seedCase(): Promise<SeededCase> {
  const suffix = randomUUID().slice(0, 8);
  const created = await createRepairCase(baseCreateRepairCaseInput(suffix));
  assert.equal(created.ok, true, `접수 건 준비 실패: ${JSON.stringify(created)}`);
  assert.ok(created.ok);
  createdCaseIds.push(created.id);
  return {
    id: created.id,
    intakeNumber: created.intakeNumber,
    modelName: `${TEST_MODEL_PREFIX}${suffix}`,
    serialNumber: `SN-${suffix}`,
  };
}

/** 한 시험만 쓰는 받은 편지함 폴더. 🔴 저장 루트와 아무 관계가 없다. */
async function makeInbox(label: string): Promise<string> {
  const dir = path.join(inboxRoot, `${label}-${randomUUID().slice(0, 8)}`);
  await mkdir(dir, { recursive: true });
  return dir;
}

async function putReport(dir: string, fileName: string, options: FakeReportOptions): Promise<string> {
  const filePath = path.join(dir, fileName);
  await writeFile(filePath, fakeReportBytes(options));
  return filePath;
}

async function readTraces(repairCaseId: string) {
  return db
    .select({ id: statusChangeHistories.id, metadata: statusChangeHistories.metadata })
    .from(statusChangeHistories)
    .where(
      and(
        eq(statusChangeHistories.repairCaseId, repairCaseId),
        sql`${statusChangeHistories.metadata} ->> 'source' = 'KYOSAN_REPORT'`
      )
    );
}

/** 지금 이 건의 상태를 통째로 찍는다 — 「한 줄도 안 바뀌었다」를 재는 자다. */
async function snapshotCase(repairCaseId: string) {
  const [caseRow] = await db
    .select({ reportedSymptom: repairCases.reportedSymptom, version: repairCases.version })
    .from(repairCases)
    .where(eq(repairCases.id, repairCaseId));
  const workRecords = await db
    .select({ id: repairCaseWorkRecords.id })
    .from(repairCaseWorkRecords)
    .where(eq(repairCaseWorkRecords.repairCaseId, repairCaseId))
    .orderBy(asc(repairCaseWorkRecords.id));
  const usedParts = await db
    .select({ id: repairCaseUsedParts.id, lineNo: repairCaseUsedParts.lineNo })
    .from(repairCaseUsedParts)
    .where(eq(repairCaseUsedParts.repairCaseId, repairCaseId))
    .orderBy(asc(repairCaseUsedParts.lineNo));
  const files = await db
    .select({ id: attachments.id, storedPath: attachments.storedPath })
    .from(attachments)
    .where(eq(attachments.repairCaseId, repairCaseId))
    .orderBy(asc(attachments.id));
  const traces = await readTraces(repairCaseId);
  return {
    caseRow,
    workRecords,
    usedParts,
    files,
    traceIds: traces.map((trace) => trace.id).sort(),
  };
}

async function isEmptyDir(dir: string): Promise<boolean> {
  try {
    return (await readdir(dir)).length === 0;
  } catch {
    // 아예 만들어지지도 않았으면 그것도 「한 글자도 안 썼다」다.
    return true;
  }
}

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
  storageRoot = await mkdtemp(path.join(tmpdir(), "dss-kyrun-store-"));
  storage = createLocalFileSystemStorageAdapter(storageRoot);
  inboxRoot = await mkdtemp(path.join(tmpdir(), "dss-kyrun-inbox-"));
});

after(async () => {
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
  test("계획 전후의 스냅숏이 글자까지 같다 — 그리고 넣을 수 있는 장을 제대로 세고 있다", async () => {
    const target = await seedCase();
    const dir = await makeInbox("plan");
    await putReport(dir, "0001.xlsm", {
      intakeNumber: target.intakeNumber,
      model: target.modelName,
      serialNumber: target.serialNumber,
      customerFault: "값-고객이-말한-증상",
      faultPart: "값-부품",
      withPhoto: true,
      salt: "계획만",
    });

    const before = await snapshotCase(target.id);
    const record = await runKyosanReportImport({
      files: collectKyosanWorkbookPaths({ dirs: [dir], files: [], limit: null }),
      apply: false,
      databaseName: DATABASE_NAME,
      today: TODAY,
    });
    const after = await snapshotCase(target.id);

    assert.deepEqual(after, before, "🔴 계획을 읽었을 뿐인데 DB 가 바뀌었다");

    // 「안 바뀌었다」가 「아무것도 못 찾았다」여서는 안 된다.
    assert.equal(record.mode, "dry-run");
    assert.equal(record.importBatchId, null, "🔴 계획에서는 회차 번호를 만들지 않는다");
    assert.equal(record.actorUserId, null, "🔴 계획에서는 사람도 찾지 않는다");
    assert.equal(record.tally.importable, 1, JSON.stringify(record.tally));
    assert.equal(record.tally.imported, 0);
    assert.equal(record.files[0].outcome, "importable");
    assert.equal(record.files[0].intakeNumber, target.intakeNumber);
    assert.equal(record.files[0].traceId, null);
    assert.equal(record.files[0].matchOutcome, "matched");

    // 🔴 디스크에도 아무것도 안 놓는다.
    assert.equal(await isEmptyDir(storageRoot), true, "🔴 계획인데 저장 루트에 파일이 생겼다");
  });
});

// ══════════════════════════════════════════════ 🔴 2. 회차 번호 하나

describe("🔴 한 회차에 번호 하나 — 되돌리기가 그 회차를 통째로 찾아낸다", () => {
  test("넣은 흔적 전부에 같은 importBatchId 가 들어가고, --batch 로 전부 골라진다", async () => {
    const targets = [await seedCase(), await seedCase(), await seedCase()];
    const dir = await makeInbox("batch");
    for (const [index, target] of targets.entries()) {
      await putReport(dir, `00${index + 1}.xlsm`, {
        intakeNumber: target.intakeNumber,
        model: target.modelName,
        serialNumber: target.serialNumber,
        customerFault: `값-증상-${index}`,
        faultPart: `값-부품-${index}`,
        salt: `회차-${index}`,
      });
    }

    const importBatchId = randomUUID();
    const record = await runKyosanReportImport({
      files: collectKyosanWorkbookPaths({ dirs: [dir], files: [], limit: null }),
      apply: true,
      databaseName: DATABASE_NAME,
      actorUserId,
      importBatchId,
      storage,
      today: TODAY,
    });

    assert.equal(record.mode, "apply");
    assert.equal(record.importBatchId, importBatchId);
    assert.equal(record.tally.imported, 3, JSON.stringify(record.tally));
    assert.equal(record.tally.failed, 0);

    // 🔴 흔적 셋에 **같은 번호**가 들어갔다.
    for (const target of targets) {
      const traces = await readTraces(target.id);
      assert.equal(traces.length, 1, target.intakeNumber);
      assert.equal(
        (traces[0].metadata as { importBatchId?: unknown }).importBatchId,
        importBatchId,
        `${target.intakeNumber} 의 흔적에 회차 번호가 다르다`
      );
    }

    // 🔴 기록의 흔적 id 가 실제 흔적과 같다 — 한 장만 되돌릴 때 사람이 이것을 쓴다.
    for (const file of record.files) {
      assert.notEqual(file.traceId, null, file.fileName);
      const [row] = await db
        .select({ id: statusChangeHistories.id })
        .from(statusChangeHistories)
        .where(eq(statusChangeHistories.id, file.traceId as string));
      assert.ok(row, `기록의 흔적 id 가 DB 에 없다: ${file.fileName}`);
    }

    // 🔴 그리고 되돌리기 도구가 그 회차를 **셋 다** 골라낸다(계획만 읽는다).
    const plan = await readKyosanRevertPlan({ kind: "batch", importBatchId });
    assert.equal(plan.decisions.length, 3, JSON.stringify(plan.decisions.map((d) => d.kind)));
    assert.equal(
      plan.decisions.every((decision) => decision.kind === "revert"),
      true,
      JSON.stringify(plan.decisions)
    );
  });
});

// ══════════════════════════════════════════════ 🔴 3. 한 장이 실패해도 멈추지 않는다

describe("🔴 한 장이 막혀도 나머지가 계속된다", () => {
  test("문서 아님 · 못 읽음 · 짝 없음 이 섞여 있어도 넣을 수 있는 장은 들어간다", async () => {
    const target = await seedCase();
    const dir = await makeInbox("mixed");

    // ① 넣을 수 있는 장
    await putReport(dir, "0001.xlsm", {
      intakeNumber: target.intakeNumber,
      model: target.modelName,
      serialNumber: target.serialNumber,
      customerFault: "값-증상",
      faultPart: "값-부품",
      salt: "섞임-정상",
    });
    // ② 🔴 165바이트 엑셀 잠금 파일 — 실측 31장이 이 모양이다(고장이 아니다)
    const lock = Buffer.alloc(165, 0x00);
    lock.set([0x06, 0xc1, 0xa4, 0xbf, 0xb5, 0xba, 0xf3], 0);
    await writeFile(path.join(dir, "0002.xlsm"), lock);
    // ③ ZIP 이기는 한데 통합문서가 아니다 — 판독 실패
    await writeFile(path.join(dir, "0003.xlsm"), writeZip([{ name: "hello.txt", data: Buffer.from("hi") }]));
    // ④ 이 DB 에 없는 접수번호 — 🔴 짝 없음(실패가 아니다). 수리 건을 만들지 않는다.
    await putReport(dir, "0004.xlsm", {
      intakeNumber: `D${TEST_YEAR_MONTH}99`,
      model: `${TEST_MODEL_PREFIX}NOBODY`,
      serialNumber: "SN-NOBODY",
      salt: "섞임-짝없음",
    });

    const caseCountBefore = await db
      .select({ value: sql<number>`count(*)::int` })
      .from(repairCases)
      .where(like(repairCases.intakeNumber, `D${TEST_YEAR_MONTH}%`));

    const record = await runKyosanReportImport({
      files: collectKyosanWorkbookPaths({ dirs: [dir], files: [], limit: null }),
      apply: true,
      databaseName: DATABASE_NAME,
      actorUserId,
      storage,
      today: TODAY,
    });

    assert.equal(record.scannedFileCount, 4);
    assert.equal(record.tally.imported, 1, JSON.stringify(record.tally));
    assert.equal(record.tally["non-document"], 1, "🔴 잠금 파일은 실패가 아니라 「문서 아님」이다");
    assert.equal(record.tally.unreadable, 1);
    assert.equal(record.tally["not-importable"], 1);
    assert.equal(record.tally.failed, 0, "🔴 위 셋 가운데 실패로 세어진 것이 있다");

    // 🔴 수리 건이 한 건도 늘지 않았다 — 짝이 없으면 만들지 않는다.
    const caseCountAfter = await db
      .select({ value: sql<number>`count(*)::int` })
      .from(repairCases)
      .where(like(repairCases.intakeNumber, `D${TEST_YEAR_MONTH}%`));
    assert.equal(caseCountAfter[0].value, caseCountBefore[0].value);

    // 그리고 정상인 한 장은 실제로 들어갔다.
    const traces = await readTraces(target.id);
    assert.equal(traces.length, 1);
  });
});

// ══════════════════════════════════════════════ 🔴 4. 두 번 넣지 않는다

describe("🔴 이미 넣은 장은 `ALREADY_IMPORTED` 로 세어진다", () => {
  test("같은 폴더를 두 번 돌려도 두 번째는 한 줄도 더 넣지 않는다", async () => {
    const target = await seedCase();
    const dir = await makeInbox("twice");
    await putReport(dir, "0001.xlsm", {
      intakeNumber: target.intakeNumber,
      model: target.modelName,
      serialNumber: target.serialNumber,
      customerFault: "값-증상",
      faultPart: "값-부품",
      salt: "두번",
    });
    const files = collectKyosanWorkbookPaths({ dirs: [dir], files: [], limit: null });

    const first = await runKyosanReportImport({
      files,
      apply: true,
      databaseName: DATABASE_NAME,
      actorUserId,
      storage,
      today: TODAY,
    });
    assert.equal(first.tally.imported, 1);

    const snapshot = await snapshotCase(target.id);

    const second = await runKyosanReportImport({
      files,
      apply: true,
      databaseName: DATABASE_NAME,
      actorUserId,
      storage,
      today: TODAY,
    });
    assert.equal(second.tally.imported, 0, JSON.stringify(second.tally));
    assert.equal(second.tally["already-imported"], 1, JSON.stringify(second.tally));
    assert.equal(second.files[0].failureCode, "ALREADY_IMPORTED");
    assert.deepEqual(await snapshotCase(target.id), snapshot, "🔴 두 번째 회차가 뭔가를 더 넣었다");

    // 계획으로 물어도 같은 답이다 — 🔴 이식기와 갈라지지 않았다.
    const planned = await runKyosanReportImport({
      files,
      apply: false,
      databaseName: DATABASE_NAME,
      today: TODAY,
    });
    assert.equal(planned.tally["already-imported"], 1, JSON.stringify(planned.tally));
  });
});

// ══════════════════════════════════════════════ 🔴 5. 내용이 같은 파일

describe("🔴 내용이 같은 파일을 알린다 — 이름이 아니라 내용(sha256)으로", () => {
  test("이름이 다른 같은 바이트는 한 묶음으로 알리고, 이름이 같고 내용이 다르면 알리지 않는다", async () => {
    const target = await seedCase();
    const other = await seedCase();
    const left = await makeInbox("dup-left");
    const right = await makeInbox("dup-right");

    const sameBytes = fakeReportBytes({
      intakeNumber: target.intakeNumber,
      model: target.modelName,
      serialNumber: target.serialNumber,
      faultPart: "값-부품",
      salt: "중복",
    });
    // 🔴 이름은 다르고 바이트는 같다 → 한 묶음으로 알려야 한다.
    await writeFile(path.join(left, "0001.xlsm"), sameBytes);
    await writeFile(path.join(right, "D210101.xlsx"), sameBytes);
    // 🔴 이름은 같고 바이트는 다르다 → 알리지 않아야 한다(백업된 두 폴더가 그 모양이다).
    await putReport(left, "0002.xlsm", {
      intakeNumber: other.intakeNumber,
      model: other.modelName,
      serialNumber: other.serialNumber,
      salt: "왼쪽",
    });
    await putReport(right, "0002.xlsm", {
      intakeNumber: other.intakeNumber,
      model: other.modelName,
      serialNumber: other.serialNumber,
      salt: "오른쪽",
    });

    const record = await runKyosanReportImport({
      files: collectKyosanWorkbookPaths({ dirs: [left, right], files: [], limit: null }),
      apply: false,
      databaseName: DATABASE_NAME,
      today: TODAY,
    });

    assert.equal(record.scannedFileCount, 4);
    assert.equal(record.duplicateHashGroups.length, 1, JSON.stringify(record.duplicateHashGroups));
    assert.deepEqual(
      [...record.duplicateHashGroups[0].fileNames].sort(),
      ["0001.xlsm", "D210101.xlsx"]
    );
  });

  test("같은 폴더를 두 번 줘도 파일이 두 번 돌지 않는다", async () => {
    const target = await seedCase();
    const dir = await makeInbox("same-dir");
    await putReport(dir, "0001.xlsm", {
      intakeNumber: target.intakeNumber,
      model: target.modelName,
      serialNumber: target.serialNumber,
      salt: "같은폴더",
    });
    const files = collectKyosanWorkbookPaths({ dirs: [dir, dir], files: [], limit: null });
    assert.equal(files.length, 1, "🔴 같은 절대 경로가 두 번 담겼다");
  });

  test("--limit 은 앞의 N 장만 담는다", async () => {
    const dir = await makeInbox("limit");
    for (const index of [1, 2, 3]) {
      const target = await seedCase();
      await putReport(dir, `000${index}.xlsm`, {
        intakeNumber: target.intakeNumber,
        model: target.modelName,
        serialNumber: target.serialNumber,
        salt: `제한-${index}`,
      });
    }
    assert.equal(collectKyosanWorkbookPaths({ dirs: [dir], files: [], limit: 2 }).length, 2);
    assert.equal(collectKyosanWorkbookPaths({ dirs: [dir], files: [], limit: null }).length, 3);
  });
});
