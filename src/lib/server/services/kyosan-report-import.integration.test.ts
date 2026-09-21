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
  customers,
  products,
  repairCaseIntakeSequences,
  repairCaseUsedParts,
  repairCases,
  serviceReportCauses,
  serviceReportLines,
  serviceReports,
  statusChangeHistories,
  users,
} from "@/lib/db/schema";
import { createRepairCase } from "@/lib/db/mutations/repair-cases";
import { createServiceReportInTx } from "@/lib/db/mutations/service-reports";
import { readKyosanReport, type KyosanReport } from "@/lib/kyosan/kyosan-report";
import {
  KYOSAN_REPORT_TRACE_REASON,
  importKyosanReport,
  listImportedKyosanSourceHashes,
  lockAndReconfirm,
} from "./kyosan-report-import";
import { readKyosanIdentity } from "@/lib/kyosan/report-match";
import { createLocalFileSystemStorageAdapter } from "@/lib/storage/local-fs-adapter";
import type { StorageAdapter } from "@/lib/storage/storage-adapter";
import { writeZip, type ZipEntryInput } from "@/lib/xlsx/zip-writer";
import type { ValidatedCreateRepairCaseInput } from "@/lib/validation/repair-case-input";

/**
 * ============================================================================
 * 🔴 연락서를 **이미 등록된 수리 건에** 넣는다 — 저장 (조각 S3b)
 * ============================================================================
 * 이 조각은 **DB 에 쓴다.** 잘못되면 남의 수리 건에 남의 자료가 들어간다. 그래서
 * 이 시험이 못 박는 것은 「잘 들어가는가」보다 **「안 들어가야 할 때 안 들어가는가」**
 * 쪽이 더 많다.
 *
 *  1. 짝이 하나로 정해졌을 때만 들어간다 — `unmatched` · `ambiguous` · 휴지통은
 *     한 줄도 남기지 않는다.
 *  2. 🔴 같은 원본 파일(`sourceSha256`)을 두 번 넣지 않는다.
 *  3. 🔴 **저장 직전에 다시 판정한다** — 미리보기 뒤에 모델도 S/N 도 바뀌었으면
 *     잠금 안에서 잡아낸다.
 *  4. 🔴 **한 트랜잭션이다** — 중간에 실패하면 보고서도 남지 않는다.
 *  5. 원인이 대응 없는 값이면 「기타」로 들어가고, 원문은 보고서 줄에 그대로 남는다.
 *  6. 원본 `.xlsm` 이 첨부로 남는다 — 허용목록을 넓히지 않고.
 *  7. 🔴 **수리 건을 새로 만들지 않는다.**
 *
 * ── 🔴 시험용 연락서는 전부 손으로 지은 가짜다 ───────────────────────
 * `kyosan/kyosan-report.test.ts` 와 같은 규율이다 — 실제 연락서에는 고객명 ·
 * 모델 · S/N · 고장 내용이 그대로 들어 있어 고정 시험 파일로 한 장도 넣지
 * 않는다. 라벨(양식의 글자)만 실측에서 가져오고 값 자리에는 `값-…` 을 넣는다.
 *
 * ── 격리 규약 ────────────────────────────────────────────────────────
 * 이 스위트만 쓰는 접수 월 "9609", 고객사 접두사 "AS-TEST-KYIMP-", 제품 모델
 * 접두사 "KYIMP-TEST-". 저장소는 OS 임시 폴더이고 끝나면 지운다.
 *
 * `after()` 는 FK 차례대로 지운다. 🔴 `audit_logs` 는 지우지 않는다
 * (`test-cleanup-static-safety.test.ts` 가 금지한다).
 * ============================================================================
 */

const TEST_CUSTOMER_NAME_PREFIX = "AS-TEST-KYIMP-";
const TEST_MODEL_PREFIX = "KYIMP-TEST-";
const TEST_YEAR_MONTH = "9609";
const TEST_RECEIVED_AT = "2096-09-05";
const TODAY = "2096-09-20";

let actorUserId: string;
let engineerId: string;
let customerId: string;
let storageRoot: string;
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
  intakeNumber?: string | null;
  model?: string | null;
  serialNumber?: string | null;
  customer?: string | null;
  faultPart?: string | null;
  /** 원인 보기 셋 가운데 어느 것에 ○ 를 찍는가. */
  causeMark?: "部品不良" | "謎の原因" | null;
  withPhoto?: boolean;
  /** 같은 내용이라도 바이트를 다르게 만들어 sourceSha256 을 가른다. */
  salt?: string;
};

/** 가짜 연락서 바이트를 짓고 판독기로 읽어 돌려준다. */
function fakeReport(options: FakeReportOptions = {}): { bytes: Buffer; report: KyosanReport } {
  const card: Record<string, string> = {
    A11: "引取No.(Receiving_No.)",
    A25: "客先(Customer)",
    A34: "型式(MODEL)",
    A36: "S/N",
    B71: "故障①/⑥",
    A88: "詳細(Details/Comments)",
  };
  if (options.intakeNumber != null) card.C11 = options.intakeNumber;
  if (options.customer != null) card.C25 = options.customer;
  if (options.model != null) card.C34 = options.model;
  if (options.serialNumber != null) card.C36 = options.serialNumber;
  if (options.faultPart != null) card.C71 = options.faultPart;
  if (options.salt != null) card.C88 = options.salt;

  // 원인 — 보기의 **왼쪽** 칸에 ○ 가 있다(`report-marks.ts`).
  const report: Record<string, string> = {
    C30: "原　因",
    J30: "製作不良",
    R30: "部品不良",
    Z30: "謎の原因",
    C64: "備　考",
  };
  if (options.causeMark === "部品不良") report.P30 = "○";
  if (options.causeMark === "謎の原因") report.X30 = "○";

  const media: Record<string, Buffer> = {};
  const images: string[] = [];
  if (options.withPhoto) {
    media["xl/media/image1.png"] = fakePng(options.salt ?? "photo");
    images.push("xl/media/image1.png");
  }

  const bytes = workbookOf(
    [
      { name: "List" },
      { name: "Card", cells: card, images },
      { name: "Repair_Report", cells: report },
    ],
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
    assignedEngineerId: engineerId,
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

function importOf(
  fake: { bytes: Buffer; report: KyosanReport },
  overrides: Partial<Parameters<typeof importKyosanReport>[0]> = {}
) {
  return importKyosanReport({
    report: fake.report,
    sourceFileName: "연락서.xlsm",
    sourceBytes: fake.bytes,
    actorUserId,
    storage,
    today: TODAY,
    ...overrides,
  });
}

async function readReports(repairCaseId: string) {
  return db.select().from(serviceReports).where(eq(serviceReports.repairCaseId, repairCaseId));
}

async function readAttachments(repairCaseId: string) {
  return db
    .select()
    .from(attachments)
    .where(eq(attachments.repairCaseId, repairCaseId))
    .orderBy(asc(attachments.uploadedAt), asc(attachments.storedPath));
}

async function readTrace(repairCaseId: string) {
  return db
    .select({ id: statusChangeHistories.id, reason: statusChangeHistories.reason, metadata: statusChangeHistories.metadata })
    .from(statusChangeHistories)
    .where(
      and(
        eq(statusChangeHistories.repairCaseId, repairCaseId),
        sql`${statusChangeHistories.metadata} ->> 'source' = 'KYOSAN_REPORT'`
      )
    );
}

/** 🔴 「아무것도 안 남았다」 — 보고서 · 첨부 · 흔적 · 사용 부품 넷 다 본다. */
async function assertNothingSaved(repairCaseId: string, label: string) {
  assert.equal((await readReports(repairCaseId)).length, 0, `${label}: 보고서가 남았다`);
  assert.equal((await readAttachments(repairCaseId)).length, 0, `${label}: 첨부가 남았다`);
  assert.equal((await readTrace(repairCaseId)).length, 0, `${label}: 이식 흔적이 남았다`);
  const parts = await db
    .select({ id: repairCaseUsedParts.id })
    .from(repairCaseUsedParts)
    .where(eq(repairCaseUsedParts.repairCaseId, repairCaseId));
  assert.equal(parts.length, 0, `${label}: 사용 부품이 남았다`);
}

before(async () => {
  const [engineer] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.role, "AS_ENGINEER"), eq(users.approvalStatus, "APPROVED"), eq(users.isDeleted, false)))
    .limit(1);
  assert.ok(engineer, "시험 DB 에 승인된 AS_ENGINEER 가 한 명은 있어야 한다");
  engineerId = engineer.id;
  actorUserId = engineer.id;

  const [customer] = await db
    .insert(customers)
    .values({ name: `${TEST_CUSTOMER_NAME_PREFIX}${randomUUID().slice(0, 8)}` })
    .returning({ id: customers.id });
  customerId = customer.id;

  storageRoot = await mkdtemp(path.join(tmpdir(), "dss-kyimp-"));
  storage = createLocalFileSystemStorageAdapter(storageRoot);
});

after(async () => {
  if (createdCaseIds.length > 0) {
    await db.delete(attachments).where(inArray(attachments.repairCaseId, createdCaseIds));
    await db.delete(serviceReports).where(inArray(serviceReports.repairCaseId, createdCaseIds));
    await db.delete(repairCaseUsedParts).where(inArray(repairCaseUsedParts.repairCaseId, createdCaseIds));
    await db.delete(statusChangeHistories).where(inArray(statusChangeHistories.repairCaseId, createdCaseIds));
  }
  await db.delete(repairCases).where(like(repairCases.intakeNumber, `D${TEST_YEAR_MONTH}%`));
  await db.delete(products).where(like(products.modelName, `${TEST_MODEL_PREFIX}%`));
  await db.delete(repairCaseIntakeSequences).where(eq(repairCaseIntakeSequences.yearMonth, TEST_YEAR_MONTH));
  await db.delete(customers).where(like(customers.name, `${TEST_CUSTOMER_NAME_PREFIX}%`));
  await rm(storageRoot, { recursive: true, force: true });
  await pgClient.end({ timeout: 5 });
});

// ══════════════════════════════════════════════ 들어가야 할 때

describe("짝이 하나로 정해지면 들어간다", () => {
  test("🔴 보고서 · 줄 · 원인 · 원본 첨부 · 이식 흔적이 한 번에 남는다", async () => {
    const target = await seedCase();
    const fake = fakeReport({
      intakeNumber: target.intakeNumber,
      model: target.modelName,
      serialNumber: target.serialNumber,
      customer: "값-고객사",
      causeMark: "部品不良",
      salt: "기본",
    });

    const result = await importOf(fake);
    assert.equal(result.ok, true, JSON.stringify(result));
    if (!result.ok) return;

    assert.equal(result.repairCaseId, target.id);
    assert.equal(result.intakeNumber, target.intakeNumber);

    const reports = await readReports(target.id);
    assert.equal(reports.length, 1);
    assert.equal(reports[0].id, result.serviceReportId);
    assert.equal(reports[0].kind, "REPAIR");
    assert.equal(reports[0].createdBy, actorUserId);
    assert.equal(reports[0].isDeleted, false);

    // 원인 — ○ 가 찍힌 `部品不良` 하나.
    const causes = await db
      .select({ cause: serviceReportCauses.cause })
      .from(serviceReportCauses)
      .where(eq(serviceReportCauses.serviceReportId, result.serviceReportId));
    assert.deepEqual(
      causes.map((row) => row.cause),
      ["PART_DEFECT"]
    );

    // 🔴 원문이 줄에 그대로 남는다 — 번역하지 않는다.
    const lines = await db
      .select({ section: serviceReportLines.section, text: serviceReportLines.text })
      .from(serviceReportLines)
      .where(eq(serviceReportLines.serviceReportId, result.serviceReportId));
    assert.ok(
      lines.some((line) => line.section === "FINDINGS" && line.text === "部品不良"),
      "○ 가 찍힌 보기의 원문이 보고서 줄에 있어야 한다"
    );

    // 🔴 원본 `.xlsm` 이 첨부로 남는다 — 허용목록을 넓히지 않고.
    const files = await readAttachments(target.id);
    assert.equal(files.length, 1);
    assert.equal(files[0].category, "KYOSAN_DOCUMENT");
    assert.equal(files[0].originalFileName, "연락서.xlsm");
    assert.ok(files[0].storedPath.endsWith(".xlsm"), files[0].storedPath);
    assert.ok(files[0].storedPath.startsWith(`repair-cases/${target.id}/`), files[0].storedPath);
    assert.equal(files[0].mimeType, "application/vnd.ms-excel.sheet.macroEnabled.12");
    assert.equal(files[0].fileSize, fake.bytes.byteLength);
    // 실물이 실제로 있어야 한다 — 행만 있고 파일이 없으면 눌러도 아무것도 안 나온다.
    const stats = await stat(path.join(storageRoot, ...files[0].storedPath.split("/")));
    assert.equal(stats.size, fake.bytes.byteLength);

    // 🔴 이식 흔적 — S3a 의 조회가 읽는 바로 그 모양.
    const trace = await readTrace(target.id);
    assert.equal(trace.length, 1);
    assert.equal(trace[0].reason, KYOSAN_REPORT_TRACE_REASON);
    const metadata = trace[0].metadata as Record<string, unknown>;
    assert.equal(metadata.source, "KYOSAN_REPORT");
    assert.equal(metadata.sourceSha256, fake.report.sourceSha256);
    assert.equal(metadata.serviceReportId, result.serviceReportId);
    // 🔴 파일 이름은 흔적에 담지 않는다 — 고객사명·모델이 섞인다.
    assert.equal("sourceFileName" in metadata, false);
    // 🔴 과거 인수품 가져오기의 표시를 달지 않는다.
    assert.equal("billingReview" in metadata, false);

    assert.deepEqual(await listImportedKyosanSourceHashes(target.id), [fake.report.sourceSha256]);
  });

  test("🔴 교체 부품은 보고서 줄과 `repair_case_used_parts` 둘 다에 들어간다", async () => {
    const target = await seedCase();
    const fake = fakeReport({
      intakeNumber: target.intakeNumber,
      model: target.modelName,
      serialNumber: target.serialNumber,
      faultPart: "값-부품1",
      salt: "부품",
    });

    const result = await importOf(fake);
    assert.equal(result.ok, true, JSON.stringify(result));
    if (!result.ok) return;
    assert.equal(result.usedPartCount, 1);

    const used = await db
      .select({ lineNo: repairCaseUsedParts.lineNo, partId: repairCaseUsedParts.partId, partNameText: repairCaseUsedParts.partNameText, quantity: repairCaseUsedParts.quantity })
      .from(repairCaseUsedParts)
      .where(eq(repairCaseUsedParts.repairCaseId, target.id));
    assert.deepEqual(used, [{ lineNo: 1, partId: null, partNameText: "값-부품1", quantity: 1 }]);

    const lines = await db
      .select({ section: serviceReportLines.section, text: serviceReportLines.text })
      .from(serviceReportLines)
      .where(eq(serviceReportLines.serviceReportId, result.serviceReportId));
    assert.ok(
      lines.some((line) => line.section === "ACTIONS" && line.text === "값-부품1"),
      "교체 부품이 보고서 줄에도 있어야 한다"
    );
  });

  test("사진은 미리보기가 걸러 준 것만 첨부로 들어간다", async () => {
    const target = await seedCase();
    const fake = fakeReport({
      intakeNumber: target.intakeNumber,
      model: target.modelName,
      serialNumber: target.serialNumber,
      withPhoto: true,
      salt: "사진",
    });

    const result = await importOf(fake);
    assert.equal(result.ok, true, JSON.stringify(result));
    if (!result.ok) return;
    assert.equal(result.photoCount, 1);

    const files = await readAttachments(target.id);
    assert.equal(files.length, 2, "원본 한 장 + 사진 한 장");
    const photo = files.find((file) => file.storedPath.endsWith(".png"));
    assert.ok(photo, "사진이 첨부로 남아야 한다");
    assert.equal(photo.category, "KYOSAN_DOCUMENT");
    assert.equal(photo.mimeType, "image/png");
    // 🔴 파일 이름에 고객 내용을 담지 않는다.
    assert.ok(photo.originalFileName.startsWith("연락서-"), photo.originalFileName);
  });

  test("🔴 대응 없는 원인은 「기타」로 들어가고 원문은 줄에 그대로 남는다", async () => {
    const target = await seedCase();
    const fake = fakeReport({
      intakeNumber: target.intakeNumber,
      model: target.modelName,
      serialNumber: target.serialNumber,
      causeMark: "謎の原因",
      salt: "기타원인",
    });

    const result = await importOf(fake);
    assert.equal(result.ok, true, JSON.stringify(result));
    if (!result.ok) return;

    const causes = await db
      .select({ cause: serviceReportCauses.cause })
      .from(serviceReportCauses)
      .where(eq(serviceReportCauses.serviceReportId, result.serviceReportId));
    assert.deepEqual(
      causes.map((row) => row.cause),
      ["OTHER"]
    );

    const lines = await db
      .select({ text: serviceReportLines.text })
      .from(serviceReportLines)
      .where(eq(serviceReportLines.serviceReportId, result.serviceReportId));
    assert.ok(
      lines.some((line) => line.text === "謎の原因"),
      "🔴 사전에 없어도 원문은 줄에 남아야 한다 — 잃는 것이 없어야 한다"
    );
    assert.ok(
      result.warnings.some((warning) => warning.includes("「기타」")),
      `경고가 있어야 한다: ${JSON.stringify(result.warnings)}`
    );
  });

  test("한 건에 연락서가 여러 장이면 보고서를 여러 장 쌓는다 — 합치지 않는다", async () => {
    const target = await seedCase();
    const identityOf = { intakeNumber: target.intakeNumber, model: target.modelName, serialNumber: target.serialNumber };

    const first = await importOf(fakeReport({ ...identityOf, salt: "첫장" }));
    const second = await importOf(fakeReport({ ...identityOf, salt: "둘째장" }));
    assert.equal(first.ok, true, JSON.stringify(first));
    assert.equal(second.ok, true, JSON.stringify(second));
    if (!first.ok || !second.ok) return;

    assert.notEqual(first.serviceReportId, second.serviceReportId);
    assert.equal((await readReports(target.id)).length, 2);
    assert.equal((await readTrace(target.id)).length, 2);
    assert.ok(
      second.warnings.some((warning) => warning.includes("이미 보고서가")),
      `둘째 장은 「이미 보고서가 있다」를 알려야 한다: ${JSON.stringify(second.warnings)}`
    );
  });
});

// ══════════════════════════════════════════════ 들어가면 안 될 때

describe("🔴 짝이 하나로 정해지지 않으면 한 줄도 남기지 않는다", () => {
  test("접수번호를 못 읽으면 `unmatched` — 수리 건을 새로 만들지도 않는다", async () => {
    const before = await db.select({ count: sql<number>`count(*)::int` }).from(repairCases);
    const result = await importOf(fakeReport({ model: "값-모델", serialNumber: "값-없는시리얼", salt: "짝없음" }));

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "NOT_IMPORTABLE");
    assert.ok(result.blockers && result.blockers.length > 0);

    const after = await db.select({ count: sql<number>`count(*)::int` }).from(repairCases);
    assert.equal(after[0].count, before[0].count, "🔴 수리 건을 새로 만들면 안 된다");
  });

  test("그 접수번호의 건이 없으면 `unmatched`", async () => {
    const result = await importOf(fakeReport({ intakeNumber: "D960999", model: "값-모델", salt: "번호없음" }));
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "NOT_IMPORTABLE");
  });

  test("🔴 `ambiguous`(S/N 후보만 있음)는 저장하지 않는다 — 사람이 골라야 한다", async () => {
    const target = await seedCase();
    // 접수번호를 아예 안 적고 S/N 만 맞춘다 → 후보가 보이지만 사람이 고른다.
    const result = await importOf(fakeReport({ serialNumber: target.serialNumber, salt: "모호" }));

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "NOT_IMPORTABLE");
    await assertNothingSaved(target.id, "ambiguous");
  });

  test("🔴 접수번호는 맞는데 모델도 S/N 도 다르면 저장하지 않는다 — 남의 건에 남의 자료", async () => {
    const target = await seedCase();
    const result = await importOf(
      fakeReport({
        intakeNumber: target.intakeNumber,
        model: "값-전혀다른모델",
        serialNumber: "값-전혀다른시리얼",
        salt: "신원충돌",
      })
    );

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "NOT_IMPORTABLE");
    await assertNothingSaved(target.id, "identity-conflict");
  });

  test("휴지통에 있는 수리 건에는 넣지 않는다", async () => {
    const target = await seedCase();
    await db.update(repairCases).set({ isDeleted: true, deletedAt: new Date() }).where(eq(repairCases.id, target.id));

    const result = await importOf(
      fakeReport({
        intakeNumber: target.intakeNumber,
        model: target.modelName,
        serialNumber: target.serialNumber,
        salt: "휴지통",
      })
    );
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "NOT_IMPORTABLE");
    await assertNothingSaved(target.id, "휴지통");

    await db.update(repairCases).set({ isDeleted: false, deletedAt: null }).where(eq(repairCases.id, target.id));
  });
});

describe("🔴 같은 연락서를 두 번 넣지 않는다", () => {
  test("같은 `sourceSha256` 두 번째는 거절되고, 보고서는 한 장 그대로다", async () => {
    const target = await seedCase();
    const fake = fakeReport({
      intakeNumber: target.intakeNumber,
      model: target.modelName,
      serialNumber: target.serialNumber,
      salt: "중복",
    });

    const first = await importOf(fake);
    assert.equal(first.ok, true, JSON.stringify(first));

    const again = await importOf(fake);
    assert.equal(again.ok, false);
    if (again.ok) return;
    assert.equal(again.code, "ALREADY_IMPORTED");

    assert.equal((await readReports(target.id)).length, 1, "🔴 두 번째가 한 장을 더 쌓으면 안 된다");
    assert.equal((await readAttachments(target.id)).length, 1);
    assert.equal((await readTrace(target.id)).length, 1);
  });
});

describe("🔴 저장 직전에 다시 판정한다", () => {
  test("사람이 고른 건과 다시 판정한 건이 다르면 `TARGET_CHANGED`", async () => {
    const target = await seedCase();
    const other = await seedCase();
    const fake = fakeReport({
      intakeNumber: target.intakeNumber,
      model: target.modelName,
      serialNumber: target.serialNumber,
      salt: "대상바뀜",
    });

    const result = await importOf(fake, { expectedRepairCaseId: other.id });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "TARGET_CHANGED");
    await assertNothingSaved(target.id, "expected 불일치(대상)");
    await assertNothingSaved(other.id, "expected 불일치(다른 건)");
  });

  test("🔴 잠금 안의 재판정이 모델도 S/N 도 바뀐 것을 잡아낸다", async () => {
    const target = await seedCase();
    const fake = fakeReport({
      intakeNumber: target.intakeNumber,
      model: target.modelName,
      serialNumber: target.serialNumber,
      salt: "재판정",
    });
    const identity = readKyosanIdentity(fake.report.card);

    // 미리보기를 만든 뒤에 제품 자료가 바뀌었다고 치자.
    const [row] = await db.select({ productId: repairCases.productId }).from(repairCases).where(eq(repairCases.id, target.id));
    await db
      .update(products)
      .set({ modelName: `${TEST_MODEL_PREFIX}CHANGED`, serialNumber: "SN-CHANGED" })
      .where(eq(products.id, row.productId));

    await assert.rejects(
      db.transaction((tx) =>
        lockAndReconfirm(tx, { repairCaseId: target.id, identity, sourceSha256: fake.report.sourceSha256 })
      ),
      /모델도 S\/N 도/u
    );

    // 바뀌지 않았으면 통과한다 — 판정이 늘 막기만 하는 것이 아니라는 증거.
    await db
      .update(products)
      .set({ modelName: target.modelName, serialNumber: target.serialNumber })
      .where(eq(products.id, row.productId));
    const confirmed = await db.transaction((tx) =>
      lockAndReconfirm(tx, { repairCaseId: target.id, identity, sourceSha256: fake.report.sourceSha256 })
    );
    assert.equal(confirmed.repairCaseId, target.id);
    assert.equal(confirmed.intakeNumber, target.intakeNumber);
  });

  test("접수번호가 그 사이 바뀌었으면 잡아낸다", async () => {
    const target = await seedCase();
    const fake = fakeReport({
      intakeNumber: target.intakeNumber,
      model: target.modelName,
      serialNumber: target.serialNumber,
      salt: "번호바뀜",
    });
    const identity = readKyosanIdentity(fake.report.card);

    await db
      .update(repairCases)
      .set({ intakeNumber: `D${TEST_YEAR_MONTH}99` })
      .where(eq(repairCases.id, target.id));

    await assert.rejects(
      db.transaction((tx) =>
        lockAndReconfirm(tx, { repairCaseId: target.id, identity, sourceSha256: fake.report.sourceSha256 })
      ),
      /접수번호가 그 사이에 바뀌었습니다/u
    );

    await db.update(repairCases).set({ intakeNumber: target.intakeNumber }).where(eq(repairCases.id, target.id));
  });

  test("휴지통으로 간 건은 잠금 안에서도 잡아낸다", async () => {
    const target = await seedCase();
    const fake = fakeReport({
      intakeNumber: target.intakeNumber,
      model: target.modelName,
      serialNumber: target.serialNumber,
      salt: "잠금휴지통",
    });
    const identity = readKyosanIdentity(fake.report.card);

    await db.update(repairCases).set({ isDeleted: true, deletedAt: new Date() }).where(eq(repairCases.id, target.id));
    await assert.rejects(
      db.transaction((tx) =>
        lockAndReconfirm(tx, { repairCaseId: target.id, identity, sourceSha256: fake.report.sourceSha256 })
      ),
      /사라졌거나 휴지통/u
    );
    await db.update(repairCases).set({ isDeleted: false, deletedAt: null }).where(eq(repairCases.id, target.id));
  });
});

describe("🔴 한 트랜잭션 — 중간에 실패하면 아무것도 안 남는다", () => {
  test("보고서를 넣은 뒤 바깥이 던지면 보고서도 함께 사라진다 (`createServiceReportInTx`)", async () => {
    const target = await seedCase();

    await assert.rejects(
      db.transaction(async (tx) => {
        const created = await createServiceReportInTx(tx, {
          repairCaseId: target.id,
          values: {
            kind: "REPAIR",
            customerName: "값-고객사",
            issuedOn: TODAY,
            reportNumberPrefix: "",
            reportNumberMiddle: "",
            reportNumberTail: "",
            customer: "",
            receivedOn: "",
            occurrencePlace: "",
            occurrencePlaceDetail: "",
            occurredOnMode: "DATE",
            occurredOnDate: "",
            occurredOnText: "",
            productName: "",
            productCategory: "",
            modelName: "",
            manufacturedYear: "",
            manufacturedMonth: "",
            lotNumber: "",
            serialNumber: "",
            usedYears: "",
            usedMonths: "",
            situationRequest: "",
            situationDetail: "",
            onSiteRepair: false,
            replacementDelivery: false,
            goodsReceiptChecked: false,
            goodsReceiptOn: "",
            goodsReceiptNumber: "",
            completionChecked: false,
            completionOn: "",
            repairNumber: "",
            causes: [],
            findingsIntro: null,
            findings: "중간에 실패할 장",
            actions: "",
            summary: "",
            remark: "",
          },
          actorUserId,
        });
        assert.equal(created.ok, true, JSON.stringify(created));
        // 🔴 여기서 던지면 방금 넣은 장도 함께 없던 일이 되어야 한다.
        throw new Error("일부러 낸 실패");
      }),
      /일부러 낸 실패/u
    );

    await assertNothingSaved(target.id, "트랜잭션 롤백");
  });

  test("첨부 파일을 놓다 실패하면 DB 도 디스크도 그대로다", async () => {
    const target = await seedCase();
    const fake = fakeReport({
      intakeNumber: target.intakeNumber,
      model: target.modelName,
      serialNumber: target.serialNumber,
      withPhoto: true,
      salt: "저장소실패",
    });

    // 원본은 놓이고 사진에서 실패한다 — 먼저 놓은 원본도 치워져야 한다.
    let committed = 0;
    const placedPaths: string[] = [];
    const brokenStorage: StorageAdapter = {
      writeTemp: (streamValue, options) => storage.writeTemp(streamValue, options),
      commit: async (tempPath, relPath) => {
        committed += 1;
        if (committed > 1) throw new Error("일부러 낸 저장소 실패");
        placedPaths.push(relPath);
        return storage.commit(tempPath, relPath);
      },
      discard: (tempPath) => storage.discard(tempPath),
      read: (relPath) => storage.read(relPath),
      delete: (relPath) => storage.delete(relPath),
      exists: (relPath) => storage.exists(relPath),
      sweepTemp: (olderThanMs) => storage.sweepTemp(olderThanMs),
    };

    const result = await importOf(fake, { storage: brokenStorage });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "STORAGE_FAILED");

    await assertNothingSaved(target.id, "저장소 실패");
    assert.equal(placedPaths.length, 1, "원본 한 장은 놓였어야 한다");
    assert.equal(await storage.exists(placedPaths[0]), false, "🔴 주인 없는 파일이 남으면 안 된다");
  });
});

describe("첨부 검사는 느슨해지지 않는다", () => {
  test("허용목록에도 서버 출처 목록에도 없는 확장자는 거절한다", async () => {
    const target = await seedCase();
    const fake = fakeReport({
      intakeNumber: target.intakeNumber,
      model: target.modelName,
      serialNumber: target.serialNumber,
      salt: "확장자",
    });

    const result = await importOf(fake, { sourceFileName: "연락서.exe" });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "SOURCE_REJECTED");
    await assertNothingSaved(target.id, "확장자 거절");
  });

  test("확장자가 말하는 것과 앞머리 바이트가 다르면 거절한다", async () => {
    const target = await seedCase();
    const fake = fakeReport({
      intakeNumber: target.intakeNumber,
      model: target.modelName,
      serialNumber: target.serialNumber,
      salt: "내용대조",
    });

    // 판독은 진짜 통합문서로 하고, 첨부로 넘기는 바이트만 ZIP 이 아닌 것으로 바꾼다.
    const result = await importOf(fake, { sourceBytes: Buffer.from("PK 가 아닌 바이트", "utf8") });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "SOURCE_REJECTED");
    await assertNothingSaved(target.id, "내용 대조");
  });
});
