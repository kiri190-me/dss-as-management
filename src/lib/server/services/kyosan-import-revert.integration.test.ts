import "../../../../scripts/load-env";

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { and, asc, eq, inArray, like, sql } from "drizzle-orm";

import { db, pgClient } from "@/lib/db/connection";
import {
  attachments,
  auditLogs,
  customers,
  products,
  repairCaseIntakeSequences,
  repairCaseUsedParts,
  repairCaseWorkRecords,
  repairCases,
  serviceReports,
  statusChangeHistories,
  users,
} from "@/lib/db/schema";
import { createAttachmentRecord } from "@/lib/db/mutations/attachments";
import { createRepairCase } from "@/lib/db/mutations/repair-cases";
import { createWorkRecord } from "@/lib/db/mutations/repair-case-work-records";
import { buildAttachmentStoredPath } from "@/lib/domain/attachment-path";
import { readKyosanReport, type KyosanReport } from "@/lib/kyosan/kyosan-report";
import { createLocalFileSystemStorageAdapter } from "@/lib/storage/local-fs-adapter";
import type { StorageAdapter } from "@/lib/storage/storage-adapter";
import { writeZip, type ZipEntryInput } from "@/lib/xlsx/zip-writer";
import type { ValidatedCreateRepairCaseInput } from "@/lib/validation/repair-case-input";
import { importKyosanReport } from "./kyosan-report-import";
import {
  applyKyosanRevert,
  loadKyosanRevertPlan,
  readKyosanRevertPlan,
  type KyosanRevertPlan,
  type RevertSelector,
} from "../../../../scripts/lib/kyosan-import-revert";

/**
 * ============================================================================
 * 🔴 연락서 이식을 **되돌린다** — 넣고 · 되돌리고 · 남은 것을 센다 (조각 S5-B)
 * ============================================================================
 * 되돌리기는 **파괴적**이다. 잘못 고르면 사람이 적은 줄과 사람이 올린 파일이
 * 사라진다. 그래서 이 시험이 못 박는 것은 「잘 지우는가」보다
 * **「지우면 안 될 것을 안 지우는가」** 쪽이 더 많다.
 *
 *  1. 🔴 `--apply` 없이 계획만 읽으면 **DB 가 한 줄도 안 바뀐다** ← 가장 중요하다
 *  2. 되돌리면 여섯 가지가 다 사라진다 — 작업 기록 · 사용 부품 · 첨부 행 ·
 *     신고 증상 · 이식 흔적 · 디스크 파일(격리 폴더로 **옮겨진다**)
 *  3. 🔴 같은 건의 **다른 자료는 그대로다** — `service_reports` · 사람이 올린
 *     첨부(설명 없음) · 사람이 적은 사용 부품 줄 · 사람이 적은 작업 기록
 *  4. 🔴 **옛 흔적**(id 가 없는 흔적)도 되돌린다 — 감사 스냅숏 · 체크섬 ·
 *     사진 이름으로 맞춘다
 *  5. 🔴 **주인 없는 흔적**은 대상에서 빠진다
 *  6. 🔴 개수가 어긋나면 **그 흔적을 통째로 건너뛴다**
 *
 * ── 🔴 시험용 연락서는 전부 손으로 지은 가짜다 ───────────────────────
 * `kyosan-report-import.integration.test.ts` 와 같은 규율이다 — 실제 연락서에는
 * 고객명 · 모델 · S/N 이 그대로 들어 있어 고정 시험 파일로 한 장도 넣지 않는다.
 * 라벨(양식의 글자)만 실측에서 가져오고 값 자리에는 `값-…` 을 넣는다.
 *
 * ── 격리 규약 ────────────────────────────────────────────────────────
 * 🔴 이 시험 DB(`dss_as_test`)는 **PO 저장소와 함께 쓴다.** 이 스위트만 쓰는
 * 접수 월 **"9312"**, 고객사 접두사 **"AS-TEST-KYREV-"**, 제품 모델 접두사
 * **"KYREV-TEST-"** — 어느 것도 다른 스위트와 겹치지 않는다(A/S 의
 * `AS-TEST-KYIMP-`/월 9609 · `QUOTE-ATTACH-TEST-` · `ATTRASH-TEST-` ·
 * `AS-TEST-QUOTE-LOOKUP-`/월 9603, PO 의 `PO-…`/월 9503·9506).
 * 저장소와 격리 폴더는 OS 임시 폴더이고 끝나면 지운다.
 *
 * `after()` 는 FK 차례대로 지운다. 🔴 `audit_logs` 는 지우지 않는다
 * (`test-cleanup-static-safety.test.ts` 가 금지한다).
 * ============================================================================
 */

const TEST_CUSTOMER_NAME_PREFIX = "AS-TEST-KYREV-";
const TEST_MODEL_PREFIX = "KYREV-TEST-";
const TEST_YEAR_MONTH = "9312";
const TEST_RECEIVED_AT = "2093-12-05";
const TODAY = "2093-12-20";

let actorUserId: string;
let customerId: string;
let storageRoot: string;
let quarantineRoot: string;
let storage: StorageAdapter;

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

function fakeReport(options: FakeReportOptions): { bytes: Buffer; report: KyosanReport } {
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
  assert.ok(read.ok);
  return { bytes, report: read.report };
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

function streamOf(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

/**
 * 🔴 **사람이 올린 첨부** — 개발 DB 에 실제로 있는 모양 그대로다: 분류는
 * `KYOSAN_DOCUMENT` 인데 `description` 이 NULL. 되돌리기가 분류만 보고 고르면
 * 이 파일이 함께 사라진다.
 */
async function placeHumanAttachment(repairCaseId: string): Promise<{ id: string; storedPath: string }> {
  const attachmentId = randomUUID().toLowerCase();
  const storedPath = buildAttachmentStoredPath({ repairCaseId, attachmentId, extension: "jpg" });
  const bytes = Buffer.from(`사람이-올린-파일-${attachmentId}`, "utf8");
  const written = await storage.writeTemp(streamOf(bytes), { maxBytes: 1_000_000 });
  await storage.commit(written.tempPath, storedPath);
  await createAttachmentRecord({
    id: attachmentId,
    owner: { kind: "REPAIR_CASE", repairCaseId },
    category: "KYOSAN_DOCUMENT",
    originalFileName: "촬영-1.jpg",
    storedPath,
    mimeType: "image/jpeg",
    fileSize: written.size,
    checksumSha256: written.sha256,
    // 🔴 여기가 열쇠다 — 사람이 올린 파일에는 이 설명이 없다.
    description: null,
    uploadedBy: actorUserId,
  });
  return { id: attachmentId, storedPath };
}

/** 🔴 이식은 보고서를 만들지 않는다 — 다른 경로로 온 보고서가 살아남아야 한다. */
async function placeServiceReport(repairCaseId: string): Promise<string> {
  const [row] = await db
    .insert(serviceReports)
    .values({
      repairCaseId,
      kind: "REPAIR",
      reportNumberMiddle: TEST_YEAR_MONTH,
      reportNumberTail: randomUUID().slice(0, 8),
      issuedOn: TODAY,
      customerNameText: "값-고객사",
    })
    .returning({ id: serviceReports.id });
  return row.id;
}

async function readTrace(repairCaseId: string) {
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
    .select({
      reportedSymptom: repairCases.reportedSymptom,
      version: repairCases.version,
    })
    .from(repairCases)
    .where(eq(repairCases.id, repairCaseId));
  const workRecords = await db
    .select({ id: repairCaseWorkRecords.id })
    .from(repairCaseWorkRecords)
    .where(eq(repairCaseWorkRecords.repairCaseId, repairCaseId))
    .orderBy(asc(repairCaseWorkRecords.id));
  const usedParts = await db
    .select({
      id: repairCaseUsedParts.id,
      lineNo: repairCaseUsedParts.lineNo,
      partNameText: repairCaseUsedParts.partNameText,
      quantity: repairCaseUsedParts.quantity,
    })
    .from(repairCaseUsedParts)
    .where(eq(repairCaseUsedParts.repairCaseId, repairCaseId))
    .orderBy(asc(repairCaseUsedParts.lineNo));
  const files = await db
    .select({ id: attachments.id, storedPath: attachments.storedPath })
    .from(attachments)
    .where(eq(attachments.repairCaseId, repairCaseId))
    .orderBy(asc(attachments.id));
  const reports = await db
    .select({ id: serviceReports.id })
    .from(serviceReports)
    .where(eq(serviceReports.repairCaseId, repairCaseId))
    .orderBy(asc(serviceReports.id));
  const traces = await readTrace(repairCaseId);
  return {
    caseRow,
    workRecords,
    usedParts,
    files,
    reports,
    traceIds: traces.map((trace) => trace.id).sort(),
  };
}

async function exists(absolutePath: string): Promise<boolean> {
  try {
    await stat(absolutePath);
    return true;
  } catch {
    return false;
  }
}

function inRoot(root: string, relPath: string): string {
  return path.join(root, ...relPath.split("/"));
}

async function applyPlan(plan: KyosanRevertPlan, runLabel: string) {
  return applyKyosanRevert({
    plan,
    actorUserId,
    uploadsRoot: storageRoot,
    quarantineRoot,
    runLabel,
    databaseName: "dss_as_test",
  });
}

/**
 * 🔴 새 흔적을 **옛 흔적으로 되돌린다** — id 칸 셋을 뺀다. 조각 S5-A 이전에
 * 들어간 흔적 8행이 실제로 이 모양이고, 되돌리기 도구는 그것도 다룰 수 있어야
 * 한다. (시험용 조작이다 — 업무 코드에는 이런 길이 없다.)
 */
async function makeTraceLookLegacy(traceId: string): Promise<void> {
  await db
    .update(statusChangeHistories)
    .set({
      metadata: sql`${statusChangeHistories.metadata} - 'usedPartIds' - 'attachmentIds' - 'importBatchId'`,
    })
    .where(eq(statusChangeHistories.id, traceId));
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

  storageRoot = await mkdtemp(path.join(tmpdir(), "dss-kyrev-"));
  quarantineRoot = path.join(storageRoot, "_reverted");
  storage = createLocalFileSystemStorageAdapter(storageRoot);
});

after(async () => {
  if (createdCaseIds.length > 0) {
    await db.delete(attachments).where(inArray(attachments.repairCaseId, createdCaseIds));
    await db.delete(serviceReports).where(inArray(serviceReports.repairCaseId, createdCaseIds));
    await db.delete(repairCaseUsedParts).where(inArray(repairCaseUsedParts.repairCaseId, createdCaseIds));
    // 🔴 작업 기록은 건을 지워도 `ON DELETE SET NULL` 로 살아남는다.
    await db.delete(repairCaseWorkRecords).where(inArray(repairCaseWorkRecords.repairCaseId, createdCaseIds));
    await db.delete(statusChangeHistories).where(inArray(statusChangeHistories.repairCaseId, createdCaseIds));
  }
  // 🔴 주인 없는 흔적을 만든 시험이 있다 — 그 줄은 위 조건에 안 걸린다.
  await db
    .delete(statusChangeHistories)
    .where(
      and(
        sql`${statusChangeHistories.repairCaseId} is null`,
        sql`${statusChangeHistories.metadata} ->> 'source' = 'KYOSAN_REPORT'`,
        sql`${statusChangeHistories.metadata} ->> 'testSuite' = 'AS-TEST-KYREV'`
      )
    );
  await db.delete(repairCases).where(like(repairCases.intakeNumber, `D${TEST_YEAR_MONTH}%`));
  await db.delete(products).where(like(products.modelName, `${TEST_MODEL_PREFIX}%`));
  await db.delete(repairCaseIntakeSequences).where(eq(repairCaseIntakeSequences.yearMonth, TEST_YEAR_MONTH));
  await db.delete(customers).where(like(customers.name, `${TEST_CUSTOMER_NAME_PREFIX}%`));
  await rm(storageRoot, { recursive: true, force: true });
  await pgClient.end({ timeout: 5 });
});

// ══════════════════════════════════════════════ 🔴 계획만 읽으면 아무것도 안 바뀐다

describe("🔴 `--apply` 없이 계획만 읽으면 DB 가 한 줄도 안 바뀐다", () => {
  test("계획 전후의 스냅숏이 글자까지 같다 — 그리고 되돌릴 것을 제대로 세고 있다", async () => {
    const target = await seedCase();
    const fake = fakeReport({
      intakeNumber: target.intakeNumber,
      model: target.modelName,
      serialNumber: target.serialNumber,
      customerFault: "값-고객이-말한-증상",
      faultPart: "값-부품",
      withPhoto: true,
      salt: "계획만",
    });
    const imported = await importKyosanReport({
      report: fake.report,
      sourceFileName: "연락서.xlsm",
      sourceBytes: fake.bytes,
      actorUserId,
      storage,
      today: TODAY,
    });
    assert.equal(imported.ok, true, JSON.stringify(imported));

    const before = await snapshotCase(target.id);
    const plan = await readKyosanRevertPlan({ kind: "case", intakeNumber: target.intakeNumber });
    const after = await snapshotCase(target.id);

    assert.deepEqual(after, before, "🔴 계획을 읽었을 뿐인데 DB 가 바뀌었다");

    // 계획은 제대로 세고 있어야 한다 — 「안 바뀌었다」가 「아무것도 못 찾았다」여서는 안 된다.
    assert.equal(plan.decisions.length, 1);
    const decision = plan.decisions[0];
    assert.equal(decision.kind, "revert", JSON.stringify(decision));
    assert.ok(decision.kind === "revert");
    assert.equal(decision.basis, "id");
    assert.equal(decision.workRecordIds.length > 0, true);
    assert.equal(decision.usedPartIds.length, 1);
    assert.equal(decision.attachmentIds.length, 2, "원본 1 + 사진 1");
    assert.equal(decision.photoAttachmentIds.length, 1);
    assert.notEqual(decision.reportedSymptom, null, "이식이 신고 증상을 채웠으니 되돌릴 것이 있다");

    // 🔴 디스크도 그대로다.
    for (const file of before.files) {
      assert.equal(await exists(inRoot(storageRoot, file.storedPath)), true, file.storedPath);
    }
  });
});

// ══════════════════════════════════════════════ 🔴 되돌리면 여섯이 사라진다

describe("🔴 되돌리면 이식이 만든 여섯이 사라지고 남의 것은 그대로다", () => {
  test("새 흔적(id 로 고름) — 넣기 → 되돌리기", async () => {
    const target = await seedCase();

    // ── 사람의 자료를 **먼저** 둔다 — 이식보다 앞선 줄이 살아남아야 한다 ──
    const humanPart = await db
      .insert(repairCaseUsedParts)
      .values({ repairCaseId: target.id, lineNo: 1, partId: null, partNameText: "사람이-적은-부품", quantity: 7 })
      .returning({ id: repairCaseUsedParts.id });
    const humanRecord = await createWorkRecord({
      repairCaseId: target.id,
      actorUserId,
      memo: "사람이-먼저-적은-기록",
      recordKind: "GENERAL",
      relatedProcedureExecutionNodeId: null,
      clientRequestId: randomUUID().toLowerCase(),
    });
    assert.equal(humanRecord.ok, true, JSON.stringify(humanRecord));
    assert.ok(humanRecord.ok);
    const humanFile = await placeHumanAttachment(target.id);
    const reportId = await placeServiceReport(target.id);

    const fake = fakeReport({
      intakeNumber: target.intakeNumber,
      model: target.modelName,
      serialNumber: target.serialNumber,
      customerFault: "값-고객이-말한-증상",
      faultPart: "값-이식한-부품",
      withPhoto: true,
      salt: "새흔적",
    });
    const importBatchId = randomUUID();
    const imported = await importKyosanReport({
      report: fake.report,
      sourceFileName: "연락서.xlsm",
      sourceBytes: fake.bytes,
      actorUserId,
      storage,
      today: TODAY,
      importBatchId,
    });
    assert.equal(imported.ok, true, JSON.stringify(imported));
    assert.ok(imported.ok);
    assert.equal(imported.reportedSymptomFilled, true);

    const importedFiles = await db
      .select({ id: attachments.id, storedPath: attachments.storedPath })
      .from(attachments)
      .where(inArray(attachments.id, [...imported.attachmentIds]));
    assert.equal(importedFiles.length, 2);

    // ── 🔴 회차 번호로 골라 되돌린다 ──
    const selector: RevertSelector = { kind: "batch", importBatchId };
    const plan = await readKyosanRevertPlan(selector);
    assert.equal(plan.decisions.length, 1);
    const runLabel = `kyrev-${randomUUID().slice(0, 8)}`;
    const record = await applyPlan(plan, runLabel);

    assert.equal(record.reverted.length, 1);
    assert.equal(record.skipped.length, 0);
    const reverted = record.reverted[0];

    // 1. 작업 기록 — 이식 것만 사라지고 사람 것은 남는다.
    const recordsLeft = await db
      .select({ id: repairCaseWorkRecords.id })
      .from(repairCaseWorkRecords)
      .where(eq(repairCaseWorkRecords.repairCaseId, target.id));
    assert.deepEqual(recordsLeft.map((row) => row.id), [humanRecord.id]);
    assert.equal(reverted.deletedWorkRecordIds.length, imported.workRecordIds.length);

    // 2. 사용 부품 — 이식 줄만 사라진다.
    const partsLeft = await db
      .select({ id: repairCaseUsedParts.id, partNameText: repairCaseUsedParts.partNameText })
      .from(repairCaseUsedParts)
      .where(eq(repairCaseUsedParts.repairCaseId, target.id));
    assert.deepEqual(partsLeft, [{ id: humanPart[0].id, partNameText: "사람이-적은-부품" }]);

    // 3. 첨부 — 이식 두 장만 사라지고 사람이 올린 것은 남는다.
    const filesLeft = await db
      .select({ id: attachments.id })
      .from(attachments)
      .where(eq(attachments.repairCaseId, target.id));
    assert.deepEqual(filesLeft.map((row) => row.id), [humanFile.id]);

    // 4. 신고 증상 — 이식 전(비어 있었다)으로 돌아간다.
    const [caseRow] = await db
      .select({ reportedSymptom: repairCases.reportedSymptom, version: repairCases.version })
      .from(repairCases)
      .where(eq(repairCases.id, target.id));
    assert.equal(caseRow.reportedSymptom, null);
    assert.deepEqual(reverted.reportedSymptom, { restored: true, restoredToEmpty: true, restoredLength: 0 });
    // 🔴 낙관적 잠금 번호는 **올라간다** — 거꾸로 돌리지 않는다(안전장치 9).
    assert.ok(caseRow.version >= 2, `version 이 줄었다: ${caseRow.version}`);

    // 5. 이식 흔적 — 사라진다.
    assert.deepEqual(await readTrace(target.id), []);

    // 6. 🔴 디스크 파일 — **지워진 것이 아니라 옮겨졌다.**
    for (const file of importedFiles) {
      assert.equal(
        await exists(inRoot(storageRoot, file.storedPath)),
        false,
        `원래 자리에 아직 있다: ${file.storedPath}`
      );
      assert.equal(
        await exists(path.join(quarantineRoot, runLabel, reverted.traceId, ...file.storedPath.split("/"))),
        true,
        `격리 폴더에 없다: ${file.storedPath}`
      );
    }
    assert.equal(
      reverted.files.every((file) => file.state === "moved"),
      true,
      JSON.stringify(reverted.files)
    );

    // 🔴 사람이 올린 파일의 실물은 그대로다.
    assert.equal(await exists(inRoot(storageRoot, humanFile.storedPath)), true);

    // 🔴 보고서는 한 장도 건드리지 않는다(이식 다음에 다른 경로로 온 것이다).
    const reportsLeft = await db
      .select({ id: serviceReports.id })
      .from(serviceReports)
      .where(eq(serviceReports.repairCaseId, target.id));
    assert.deepEqual(reportsLeft.map((row) => row.id), [reportId]);

    // 🔴 되돌리기도 사람이 한 일이다 — 감사 기록이 남는다.
    const audits = await db
      .select({ actionType: auditLogs.actionType, newValue: auditLogs.newValue })
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.targetEntity, "status_change_histories"),
          eq(auditLogs.targetRecordId, reverted.traceId)
        )
      );
    assert.equal(audits.length, 1, "되돌리기 감사 기록이 한 줄 있어야 한다");
    assert.equal(audits[0].actionType, "PURGE");
    assert.equal(
      (audits[0].newValue as { revertedKyosanReportImport?: unknown }).revertedKyosanReportImport,
      true
    );
  });

  test("🔴 옛 흔적(id 가 없는 흔적)도 되돌린다 — 스냅숏·체크섬·사진 이름으로 맞춘다", async () => {
    const target = await seedCase();
    const humanFile = await placeHumanAttachment(target.id);

    const fake = fakeReport({
      intakeNumber: target.intakeNumber,
      model: target.modelName,
      serialNumber: target.serialNumber,
      customerFault: "값-고객이-말한-증상",
      faultPart: "값-옛흔적부품",
      withPhoto: true,
      salt: "옛흔적",
    });
    const imported = await importKyosanReport({
      report: fake.report,
      sourceFileName: "연락서.xlsm",
      sourceBytes: fake.bytes,
      actorUserId,
      storage,
      today: TODAY,
    });
    assert.equal(imported.ok, true, JSON.stringify(imported));
    assert.ok(imported.ok);

    const [trace] = await readTrace(target.id);
    await makeTraceLookLegacy(trace.id);

    const plan = await readKyosanRevertPlan({ kind: "trace", traceId: trace.id });
    assert.equal(plan.decisions.length, 1);
    const decision = plan.decisions[0];
    assert.equal(decision.kind, "revert", JSON.stringify(decision));
    assert.ok(decision.kind === "revert");
    // 🔴 id 가 없으니 **옛 흔적 규칙**으로 골랐어야 한다.
    assert.equal(decision.basis, "legacy");
    assert.deepEqual([...decision.attachmentIds].sort(), [...imported.attachmentIds].sort());
    assert.deepEqual(decision.usedPartIds.length, 1);
    // 🔴 사람이 올린 파일은 고르지 않았다.
    assert.equal(decision.attachmentIds.includes(humanFile.id), false);

    const runLabel = `kyrev-legacy-${randomUUID().slice(0, 8)}`;
    const record = await applyPlan(plan, runLabel);
    assert.equal(record.reverted.length, 1);

    assert.deepEqual(await readTrace(target.id), []);
    const filesLeft = await db
      .select({ id: attachments.id })
      .from(attachments)
      .where(eq(attachments.repairCaseId, target.id));
    assert.deepEqual(filesLeft.map((row) => row.id), [humanFile.id]);
    const partsLeft = await db
      .select({ id: repairCaseUsedParts.id })
      .from(repairCaseUsedParts)
      .where(eq(repairCaseUsedParts.repairCaseId, target.id));
    assert.deepEqual(partsLeft, []);
    const [caseRow] = await db
      .select({ reportedSymptom: repairCases.reportedSymptom })
      .from(repairCases)
      .where(eq(repairCases.id, target.id));
    assert.equal(caseRow.reportedSymptom, null);
    assert.equal(await exists(inRoot(storageRoot, humanFile.storedPath)), true);
  });
});

// ══════════════════════════════════════════════ 🔴 건너뛰어야 할 때

describe("🔴 어긋나면 건너뛴다", () => {
  test("개수가 어긋나면 그 흔적은 한 줄도 안 지운다", async () => {
    const target = await seedCase();
    const fake = fakeReport({
      intakeNumber: target.intakeNumber,
      model: target.modelName,
      serialNumber: target.serialNumber,
      faultPart: "값-개수어긋남",
      withPhoto: true,
      salt: "개수어긋남",
    });
    const imported = await importKyosanReport({
      report: fake.report,
      sourceFileName: "연락서.xlsm",
      sourceBytes: fake.bytes,
      actorUserId,
      storage,
      today: TODAY,
    });
    assert.equal(imported.ok, true, JSON.stringify(imported));
    assert.ok(imported.ok);

    // 흔적이 말하는 개수를 하나 늘려 어긋나게 만든다(자료가 그 사이에 사라진 모양).
    const [trace] = await readTrace(target.id);
    await db
      .update(statusChangeHistories)
      .set({ metadata: sql`jsonb_set(${statusChangeHistories.metadata}, '{usedPartCount}', '9'::jsonb)` })
      .where(eq(statusChangeHistories.id, trace.id));

    const before = await snapshotCase(target.id);
    const plan = await readKyosanRevertPlan({ kind: "trace", traceId: trace.id });
    assert.equal(plan.decisions[0].kind, "skip");

    const record = await applyPlan(plan, `kyrev-skip-${randomUUID().slice(0, 8)}`);
    assert.equal(record.reverted.length, 0);
    assert.equal(record.skipped.length, 1);
    assert.deepEqual(await snapshotCase(target.id), before, "🔴 건너뛴다고 해 놓고 뭔가 바뀌었다");
  });

  test("🔴 주인 없는 흔적은 대상에서 빠진다", async () => {
    // `workflow_version_id` 는 NOT NULL 이라 살아 있는 값을 하나 빌려 온다.
    const donor = await seedCase();
    const [donorCase] = await db
      .select({ workflowVersionId: repairCases.workflowVersionId })
      .from(repairCases)
      .where(eq(repairCases.id, donor.id));

    const [orphan] = await db
      .insert(statusChangeHistories)
      .values({
        repairCaseId: null,
        workflowVersionId: donorCase.workflowVersionId,
        fromStepId: null,
        toStepId: null,
        actionType: "LEGACY_IMPORT_STATE_SET",
        actorUserId,
        reason: "AS-TEST-KYREV 주인 없는 흔적",
        metadata: {
          source: "KYOSAN_REPORT",
          testSuite: "AS-TEST-KYREV",
          sourceSha256: "0".repeat(64),
          usedPartCount: 0,
          attachmentCount: 1,
          photoCount: 0,
          reportedSymptomFilled: false,
        },
      })
      .returning({ id: statusChangeHistories.id });

    const plan = await readKyosanRevertPlan({ kind: "trace", traceId: orphan.id });
    assert.equal(plan.decisions.length, 1);
    const decision = plan.decisions[0];
    assert.equal(decision.kind, "skip");
    assert.ok(decision.kind === "skip");
    assert.ok(
      decision.reasons.some((reason) => reason.includes("주인 없는 흔적")),
      decision.reasons.join(" / ")
    );

    // 🔴 그리고 `--apply` 로도 그 줄은 남는다.
    await applyPlan(plan, `kyrev-orphan-${randomUUID().slice(0, 8)}`);
    const still = await db
      .select({ id: statusChangeHistories.id })
      .from(statusChangeHistories)
      .where(eq(statusChangeHistories.id, orphan.id));
    assert.equal(still.length, 1, "🔴 주인 없는 흔적을 지웠다");
  });

  test("🔴 계획을 찍은 뒤 자료가 바뀌면 한 줄도 지우지 않는다", async () => {
    const target = await seedCase();
    const fake = fakeReport({
      intakeNumber: target.intakeNumber,
      model: target.modelName,
      serialNumber: target.serialNumber,
      faultPart: "값-중간변경",
      salt: "중간변경",
    });
    const imported = await importKyosanReport({
      report: fake.report,
      sourceFileName: "연락서.xlsm",
      sourceBytes: fake.bytes,
      actorUserId,
      storage,
      today: TODAY,
    });
    assert.equal(imported.ok, true, JSON.stringify(imported));

    const plan = await readKyosanRevertPlan({ kind: "case", intakeNumber: target.intakeNumber });
    assert.equal(plan.decisions[0].kind, "revert");

    // 계획을 본 뒤에 사람이 사용 부품 줄을 지웠다 — 이제 개수가 어긋난다.
    await db.delete(repairCaseUsedParts).where(eq(repairCaseUsedParts.repairCaseId, target.id));

    const before = await snapshotCase(target.id);
    await assert.rejects(
      () => applyPlan(plan, `kyrev-changed-${randomUUID().slice(0, 8)}`),
      /자료가 바뀌었습니다/
    );
    assert.deepEqual(await snapshotCase(target.id), before, "🔴 되돌렸다면서 뭔가 지웠다");
  });
});

// ══════════════════════════════════════════════ 트랜잭션 안에서 읽어도 같은 답

describe("계획은 트랜잭션 안에서 읽어도 같다", () => {
  test("loadKyosanRevertPlan 을 직접 불러도 readKyosanRevertPlan 과 같은 판정이다", async () => {
    const target = await seedCase();
    const fake = fakeReport({
      intakeNumber: target.intakeNumber,
      model: target.modelName,
      serialNumber: target.serialNumber,
      salt: "트랜잭션",
    });
    const imported = await importKyosanReport({
      report: fake.report,
      sourceFileName: "연락서.xlsm",
      sourceBytes: fake.bytes,
      actorUserId,
      storage,
      today: TODAY,
    });
    assert.equal(imported.ok, true, JSON.stringify(imported));

    const selector: RevertSelector = { kind: "case", intakeNumber: target.intakeNumber };
    const outside = await readKyosanRevertPlan(selector);
    const inside = await db.transaction((tx) => loadKyosanRevertPlan(tx, selector));
    assert.deepEqual(inside.decisions, outside.decisions);
  });
});
