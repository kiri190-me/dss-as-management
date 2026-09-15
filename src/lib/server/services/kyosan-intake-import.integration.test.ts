import "../../../../scripts/load-env";

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { and, count, eq, inArray, like, or } from "drizzle-orm";
import { db, pgClient } from "../../db/connection";
import {
  auditLogs,
  customers,
  endUsers,
  productModels,
  products,
  repairCaseIdempotencyKeys,
  repairCaseIntakeSequences,
  repairCases,
  statusChangeHistories,
  users,
  workflowSteps,
  workflowTemplates,
  workflowVersions,
} from "../../db/schema";
import { resolveRepairCaseBillingDecision } from "../../db/mutations/repair-case-billing-decision";
import { listImportedCasesNeedingBillingReview, loadImportLookups } from "../../db/queries/kyosan-intake-import";
import { parseKyosanIntakeWorkbook } from "@/lib/domain/kyosan-intake-import/parse";
import type { IntakeSubmissionInput } from "@/lib/domain/local/submit-intake";
import { writeZip, type ZipEntryInput } from "@/lib/xlsx/zip-writer";
import { createRepairCaseWithIdempotency } from "./create-repair-case";
import {
  buildKyosanImportPreview,
  classifyKyosanRowsForImport,
  executeKyosanImportChunk,
  kyosanIdempotencyKey,
  looksLikeDifferentCase,
  type KyosanChunkRowResult,
  type KyosanImportActor,
  type KyosanPreviewResult,
  type KyosanPreviewRow,
} from "./kyosan-intake-import";

/**
 * 과거 인수품 가져오기 S2 — 시험 DB 에서 서비스(미리보기 · 조각 실행)를 그대로 부른다.
 *
 * 🔴 실제 인수품 리스트는 열지 않는다. 통합문서는 전부 zip-writer 로 만든 **가짜**이고, 이름은
 * 전부 `AS-TEST-KYOSAN-` 접두어 + 실행마다 다른 토큰이다.
 *
 * 격리: 인수 달 "9401"(본 가져오기) · "9402"(순번 GREATEST) · "9403"(대화형 수기 번호).
 * 🔴 D97xx 는 열두 달이 전부 다른 스위트가 쓰고 있어(2026-09-15 확인) 94 년을 쓴다 — 저장소
 * 전체에서 "94MM" 을 쓰는 곳이 없다. 앞뒤 정리는 이 세 달의 인수번호와 이름 접두어로만 한다.
 *
 * 인수일이 2094 년이라 출하일(2094-02-01)이 「오늘보다 뒤」에 걸리지 않게 today 를 2099-12-31
 * 로 넘긴다(서비스는 today 를 인자로 받는다 — 액션이 한국 날짜를 넣는다).
 */

const RUN = randomUUID().slice(0, 8);
const PREFIX = "AS-TEST-KYOSAN-";
const MAIN_MONTH = "9401";
const SEQ_MONTH = "9402";
const INTERACTIVE_MONTH = "9403";
const TEST_MONTHS = [MAIN_MONTH, SEQ_MONTH, INTERACTIVE_MONTH];
const TODAY = "2099-12-31";
const FILE_NAME = "引取品リスト.xlsx";

function toFullWidth(text: string): string {
  return Array.from(text)
    .map((char) => {
      const code = char.charCodeAt(0);
      return code >= 0x21 && code <= 0x7e ? String.fromCharCode(code + 0xfee0) : char;
    })
    .join("");
}

const FULL_WIDTH_PREFIX = toFullWidth(PREFIX);

const CUSTOMER_A = `${PREFIX}CUST-A-${RUN}`;
/** 새 고객사 — A 와 한 글자 달라 비슷한 이름 제안에 A 가 나와야 한다. */
const CUSTOMER_B_NEW = `${PREFIX}CUST-B-${RUN}`;
const CUSTOMER_OTHER = `${PREFIX}CUST-OTHER-${RUN}`;
const CUSTOMER_DUP = `${PREFIX}DUP-${RUN}`;
const END_USER_NEW = `${PREFIX}EU-${RUN}`;
/** 기존 모델, kind 없음. */
const MODEL_PLAIN = `${PREFIX}MODEL-RF-${RUN}`;
/** 기존 모델, kind = MATCHER. 파일은 RF(제너레이터)로 적는다 — 경고만, 모델은 안 바뀐다. */
const MODEL_MATCHER = `${PREFIX}MODEL-MB-OLD-${RUN}`;
/** 파일에만 있는 새 모델(MB). */
const MODEL_NEW_MB = `${PREFIX}MODEL-MB-NEW-${RUN}`;
const MODEL_UNKNOWN = `${PREFIX}MODEL-UNKNOWN-${RUN}`;

const PAID_NOTE_REVIEW_PREFIX = "[과거 인수품 가져오기] 유/무상 확인 필요 (원본 費用: ";
const PARTIAL_PAID_NOTE = "[과거 인수품 가져오기] 원본 費用 無償 · 状態 中断：客先待ち → 일부 유상으로 가져옴";

let adminId: string;
let salesId: string;
let admin: KyosanImportActor;
let customerAId: string;
let customerOtherId: string;
let modelPlainId: string;
let modelMatcherId: string;
let liveExistingId: string;
let trashedExistingId: string;
/** 멱등 키 — 정리할 때 repair_case_id 가 없는(실패한) 줄까지 지우려고 모은다. */
const trackedIdempotencyKeys: string[] = [];

// ── 가짜 통합문서 ─────────────────────────────────────────────────────────

const MAIN_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const PKG_REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships";
const CONTENT_TYPES_NS = "http://schemas.openxmlformats.org/package/2006/content-types";

type Cells = Record<string, string | number | null>;

function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function columnNumber(letters: string): number {
  let result = 0;
  for (const letter of letters) result = result * 26 + (letter.charCodeAt(0) - 64);
  return result;
}

/** 시트 `リスト` 하나짜리 통합문서. 글자 칸은 인라인 문자열, 숫자 칸은 숫자. */
function buildWorkbook(rows: Record<number, Cells>): Buffer {
  const rowsXml = Object.keys(rows)
    .map(Number)
    .sort((a, b) => a - b)
    .map((rowNumber) => {
      const cells = Object.entries(rows[rowNumber])
        .filter((entry): entry is [string, string | number] => entry[1] !== null)
        .sort(([a], [b]) => columnNumber(a) - columnNumber(b))
        .map(([column, value]) =>
          typeof value === "number"
            ? `<c r="${column}${rowNumber}"><v>${value}</v></c>`
            : `<c r="${column}${rowNumber}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`
        )
        .join("");
      return `<row r="${rowNumber}">${cells}</row>`;
    })
    .join("");

  const entries: ZipEntryInput[] = [
    {
      name: "[Content_Types].xml",
      data: Buffer.from(
        `<Types xmlns="${CONTENT_TYPES_NS}">` +
          `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
          `<Default Extension="xml" ContentType="application/xml"/>` +
          `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
          `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
          `<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>` +
          `</Types>`,
        "utf8"
      ),
    },
    {
      name: "_rels/.rels",
      data: Buffer.from(
        `<Relationships xmlns="${PKG_REL_NS}"><Relationship Id="rId1" Type="${REL_NS}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
        "utf8"
      ),
    },
    {
      name: "xl/workbook.xml",
      data: Buffer.from(
        `<workbook xmlns="${MAIN_NS}" xmlns:r="${REL_NS}"><workbookPr defaultThemeVersion="164011"/>` +
          `<sheets><sheet name="リスト" sheetId="1" r:id="rId1"/></sheets></workbook>`,
        "utf8"
      ),
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      data: Buffer.from(
        `<Relationships xmlns="${PKG_REL_NS}">` +
          `<Relationship Id="rId1" Type="${REL_NS}/worksheet" Target="worksheets/sheet1.xml"/>` +
          `<Relationship Id="rId2" Type="${REL_NS}/sharedStrings" Target="sharedStrings.xml"/>` +
          `</Relationships>`,
        "utf8"
      ),
    },
    {
      name: "xl/worksheets/sheet1.xml",
      data: Buffer.from(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="${MAIN_NS}"><sheetData>${rowsXml}</sheetData></worksheet>`,
        "utf8"
      ),
    },
    {
      name: "xl/sharedStrings.xml",
      data: Buffer.from(`<sst xmlns="${MAIN_NS}" count="0" uniqueCount="0"></sst>`, "utf8"),
    },
  ];
  return writeZip(entries);
}

/** 머리글 — 일본어⏎한국어 두 줄(첫 줄만 대조한다). 원본처럼 17행에 둔다. */
const HEADER: Cells = {
  B: "No.",
  C: "引取番号\n인수번호",
  D: "引取日\n인수일",
  F: "型式\n모델",
  G: "種別\n종류",
  H: "L/N\nL/N",
  I: "S/N\nS/N",
  J: "客先名称\n고객사",
  K: "End-User\nEND-USER",
  L: "客先返却理由\n신고증상",
  O: "状態\n상태",
  S: "出荷日\n출하일",
  V: "報告書番号\n보고서 번호",
  Y: "費用\n유/무상",
};
const HEADER_ROW = 17;

/** 자료 줄은 18행부터 — `data[i]` 가 `18 + i` 행이 된다. */
function kyosanWorkbook(data: readonly Cells[]): Buffer {
  const rows: Record<number, Cells> = { 1: { B: "引取品リスト" }, [HEADER_ROW]: HEADER };
  data.forEach((cells, index) => {
    rows[HEADER_ROW + 1 + index] = cells;
  });
  return buildWorkbook(rows);
}

/** 문제 없는 줄 — 인수일은 인수번호의 연월 5일, S/N 은 인수번호로 갈린다. */
function dataRow(intakeNumber: string, overrides: Cells = {}): Cells {
  return {
    C: intakeNumber,
    D: `20${intakeNumber.slice(1, 3)}-${intakeNumber.slice(3, 5)}-05`,
    F: MODEL_PLAIN,
    G: "RF(FH)",
    H: `LN-${RUN}`,
    I: `SN-${RUN}-${intakeNumber}`,
    J: CUSTOMER_A,
    K: null,
    L: "출력이 나오지 않음",
    O: "受付",
    S: null,
    V: null,
    Y: "有償",
    ...overrides,
  };
}

// 본 가져오기 — 18행부터 30행까지 13줄.
const MAIN_DATA: readonly Cells[] = [
  // 18: 전각 고객사명(기존 A 에 붙어야 한다) · 새 End-User · 受付 → 인수점검(from = to 흔적)
  dataRow("D940101", { J: toFullWidth(CUSTOMER_A), K: END_USER_NEW, V: `RPT-${RUN}-01` }),
  // 19: 새 고객사 · 새 모델(MB) · 無償 · 出荷済み → 무상 매쳐 출하 완료(잠김)
  dataRow("D940102", { F: MODEL_NEW_MB, G: "MB", J: CUSTOMER_B_NEW, O: "出荷済み", S: "2094-02-01", Y: "無償" }),
  // 20: 제너레이터 出荷待ち → shipment_approved · End-User 를 전각으로(18행이 만든 것에 붙어야 한다)
  dataRow("D940103", { O: "出荷待ち", K: toFullWidth(END_USER_NEW) }),
  // 21: 中断：指示待ち → 교산 회신 대기 · 모델을 전각으로(19행이 만든 새 모델에 붙어야 한다)
  dataRow("D940104", { F: toFullWidth(MODEL_NEW_MB), G: "MB", O: "中断：指示待ち" }),
  // 22: 無償 + 中断：客先待ち → 일부 유상 · 유상 절차 · PO 대기 · 메모 한 줄
  dataRow("D940105", { G: "RF(TP)", O: "中断：客先待ち", Y: "無償" }),
  // 23: 費用 調整中 → 유상 + 유/무상 확인 필요
  dataRow("D940106", { Y: "調整中" }),
  // 24: 費用 빈칸 → 유상 + 유/무상 확인 필요(비어 있음)
  dataRow("D940107", { Y: null }),
  // 25: 이미 있음(살아 있음) — 고객사 · 모델 · S/N 이 다르다
  dataRow("D940108"),
  // 26: 이미 있음(휴지통) — 같은 물건
  dataRow("D940109"),
  // 27 · 28: 파일 안 중복
  dataRow("D940110"),
  dataRow("D940110", { I: `SN-${RUN}-D940110-B` }),
  // 29: TTB/DUO → 제외. 모델 이름을 따로 둔다 — 같은 모델이 파일 안에서 제너레이터와 제외로
  // 갈리면 S1 이 그 모델의 줄을 전부 확인 필요로 돌린다(rules.ts 의 addModelKindConflictReasons).
  dataRow("D940112", { F: `${PREFIX}MODEL-TTB-${RUN}`, G: "TTB/DUO" }),
  // 30: 기존 모델(kind MATCHER)을 제너레이터로 적었다 → 경고, 모델은 안 바뀐다
  dataRow("D940113", { F: MODEL_MATCHER }),
];

const MAIN_BYTES = kyosanWorkbook(MAIN_DATA);
const MAIN_ROW_NUMBERS = MAIN_DATA.map((_cells, index) => HEADER_ROW + 1 + index);

// ── DB 도움 ───────────────────────────────────────────────────────────────

async function countOurRows() {
  const [[cases], [customerRows], [endUserRows], [modelRows], [sequenceRows]] = await Promise.all([
    db.select({ n: count() }).from(repairCases).where(like(repairCases.intakeNumber, `D${MAIN_MONTH}%`)),
    db
      .select({ n: count() })
      .from(customers)
      .where(or(like(customers.name, `${PREFIX}%`), like(customers.name, `${FULL_WIDTH_PREFIX}%`))),
    db
      .select({ n: count() })
      .from(endUsers)
      .where(or(like(endUsers.name, `${PREFIX}%`), like(endUsers.name, `${FULL_WIDTH_PREFIX}%`))),
    db.select({ n: count() }).from(productModels).where(like(productModels.modelName, `${PREFIX}%`)),
    db.select({ n: count() }).from(repairCaseIntakeSequences).where(eq(repairCaseIntakeSequences.yearMonth, MAIN_MONTH)),
  ]);
  return {
    cases: cases.n,
    customers: customerRows.n,
    endUsers: endUserRows.n,
    productModels: modelRows.n,
    sequences: sequenceRows.n,
  };
}

async function caseState(id: string) {
  const [row] = await db
    .select({
      customerId: repairCases.customerId,
      endUserId: repairCases.endUserId,
      billingType: repairCases.billingType,
      isLocked: repairCases.isLocked,
      isDeleted: repairCases.isDeleted,
      actualShipmentDate: repairCases.actualShipmentDate,
      notes: repairCases.notes,
      legacyReportNumber: repairCases.legacyReportNumber,
      workflowType: workflowTemplates.code,
      stepKey: workflowSteps.key,
      productModelId: products.productModelId,
    })
    .from(repairCases)
    .innerJoin(workflowVersions, eq(workflowVersions.id, repairCases.workflowVersionId))
    .innerJoin(workflowTemplates, eq(workflowTemplates.id, workflowVersions.workflowTemplateId))
    .innerJoin(workflowSteps, eq(workflowSteps.id, repairCases.currentWorkflowStepId))
    .innerJoin(products, eq(products.id, repairCases.productId))
    .where(eq(repairCases.id, id));
  assert.ok(row, `수리 건 ${id} 을(를) 찾지 못했다`);
  return row;
}

async function histories(repairCaseId: string) {
  return db
    .select({
      actionType: statusChangeHistories.actionType,
      fromStepId: statusChangeHistories.fromStepId,
      toStepId: statusChangeHistories.toStepId,
      metadata: statusChangeHistories.metadata,
    })
    .from(statusChangeHistories)
    .where(eq(statusChangeHistories.repairCaseId, repairCaseId));
}

async function sequenceOf(yearMonth: string): Promise<number | null> {
  const [row] = await db
    .select({ lastSequence: repairCaseIntakeSequences.lastSequence })
    .from(repairCaseIntakeSequences)
    .where(eq(repairCaseIntakeSequences.yearMonth, yearMonth));
  return row?.lastSequence ?? null;
}

function trackKeys(batchId: string, fileSha256: string, bytes: Buffer): void {
  const parsed = parseKyosanIntakeWorkbook(bytes, FILE_NAME, { today: TODAY });
  if (!parsed.ok) return;
  for (const row of parsed.rows) {
    if (row.raw.intakeNumber !== null) {
      trackedIdempotencyKeys.push(kyosanIdempotencyKey(batchId, fileSha256, row.raw.rowNumber, row.raw.intakeNumber));
    }
  }
}

function baseIntake(overrides: Partial<IntakeSubmissionInput>): IntakeSubmissionInput {
  return {
    workflowType: "PAID_GENERATOR",
    billingType: "PAID",
    customerId: customerAId,
    endUserId: null,
    assignedEngineerId: null,
    priority: "NORMAL",
    receivedAt: "2094-01-05",
    customerRequestedDueDate: null,
    internalTargetShipmentDate: null,
    internalTargetInspectionCompletionDate: null,
    intakeNumber: null,
    modelName: MODEL_PLAIN,
    productModelId: modelPlainId,
    newProductModelName: null,
    lotNumber: `LN-${RUN}`,
    serialNumber: `SN-${RUN}-seed`,
    partNumber: null,
    accessoryList: null,
    externalConditionSummary: null,
    reasonForRemoval: null,
    reportedSymptom: null,
    notes: null,
    contactName: null,
    contactPhone: null,
    contactEmail: null,
    ...overrides,
  };
}

/** 기존 건을 깔아 둔다 — 예전 Excel 이관 창구 그대로(과거 상태 없이, 메일 없음). */
async function seedExistingCase(overrides: Partial<IntakeSubmissionInput>): Promise<string> {
  const key = randomUUID();
  trackedIdempotencyKeys.push(key);
  const result = await createRepairCaseWithIdempotency({
    actor: admin,
    intake: baseIntake(overrides),
    idempotencyKey: key,
    logContext: "EXCEL_IMPORT",
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) throw new Error("기존 건을 깔지 못했다");
  return result.id;
}

/** 이 파일이 만든 것만 지운다 — 세 달의 인수번호와 이름 접두어로 범위를 잡는다. */
async function cleanup(): Promise<void> {
  const caseRows = await db
    .select({ id: repairCases.id })
    .from(repairCases)
    .where(or(...TEST_MONTHS.map((month) => like(repairCases.intakeNumber, `D${month}%`))));
  const caseIds = caseRows.map((row) => row.id);

  if (caseIds.length > 0) {
    const auditRows = await db
      .select({ id: auditLogs.id })
      .from(auditLogs)
      .where(and(eq(auditLogs.targetEntity, "repair_cases"), inArray(auditLogs.targetRecordId, caseIds)));
    if (auditRows.length > 0) {
      await db.delete(auditLogs).where(inArray(auditLogs.id, auditRows.map((row) => row.id)));
    }
    await db.delete(statusChangeHistories).where(inArray(statusChangeHistories.repairCaseId, caseIds));
    await db.delete(repairCaseIdempotencyKeys).where(inArray(repairCaseIdempotencyKeys.repairCaseId, caseIds));
  }
  if (trackedIdempotencyKeys.length > 0) {
    await db
      .delete(repairCaseIdempotencyKeys)
      .where(inArray(repairCaseIdempotencyKeys.idempotencyKey, [...new Set(trackedIdempotencyKeys)]));
  }
  if (caseIds.length > 0) await db.delete(repairCases).where(inArray(repairCases.id, caseIds));

  await db.delete(products).where(like(products.modelName, `${PREFIX}%`));
  await db.delete(productModels).where(like(productModels.modelName, `${PREFIX}%`));
  await db
    .delete(endUsers)
    .where(or(like(endUsers.name, `${PREFIX}%`), like(endUsers.name, `${FULL_WIDTH_PREFIX}%`)));
  await db
    .delete(customers)
    .where(or(like(customers.name, `${PREFIX}%`), like(customers.name, `${FULL_WIDTH_PREFIX}%`)));
  await db.delete(repairCaseIntakeSequences).where(inArray(repairCaseIntakeSequences.yearMonth, TEST_MONTHS));
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
  const [sales] = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(eq(users.role, "SALES"), eq(users.approvalStatus, "APPROVED"), eq(users.isActive, true), eq(users.isDeleted, false))
    )
    .limit(1);
  assert.ok(superAdmin && sales, "시험 DB 에 승인된 최고관리자 · 영업 계정이 있어야 한다");
  adminId = superAdmin.id;
  salesId = sales.id;
  admin = { userId: adminId, role: "SUPER_ADMIN", approvalStatus: "APPROVED", isDeveloper: false };

  // 지난 실행이 중간에 죽어 남긴 것이 있으면 먼저 치운다(범위는 cleanup 과 같다).
  await cleanup();

  const [customerA] = await db.insert(customers).values({ name: CUSTOMER_A }).returning({ id: customers.id });
  const [customerOther] = await db.insert(customers).values({ name: CUSTOMER_OTHER }).returning({ id: customers.id });
  customerAId = customerA.id;
  customerOtherId = customerOther.id;
  const [plain] = await db.insert(productModels).values({ modelName: MODEL_PLAIN }).returning({ id: productModels.id });
  const [matcher] = await db
    .insert(productModels)
    .values({ modelName: MODEL_MATCHER, kind: "MATCHER" })
    .returning({ id: productModels.id });
  modelPlainId = plain.id;
  modelMatcherId = matcher.id;

  liveExistingId = await seedExistingCase({
    workflowType: "PAID_MATCHER",
    customerId: customerOtherId,
    intakeNumber: "D940108",
    modelName: MODEL_MATCHER,
    productModelId: modelMatcherId,
    lotNumber: "LN-OTHER",
    serialNumber: `SN-OTHER-${RUN}`,
  });
  trashedExistingId = await seedExistingCase({
    intakeNumber: "D940109",
    serialNumber: `SN-${RUN}-D940109`,
  });
  await db
    .update(repairCases)
    .set({ isDeleted: true, deletedAt: new Date(), deletedBy: adminId, deleteReason: "시험 — 휴지통" })
    .where(eq(repairCases.id, trashedExistingId));
});

after(async () => {
  await cleanup();
  await pgClient.end({ timeout: 5 });
});

function rowOf(preview: KyosanPreviewResult, rowNumber: number): KyosanPreviewRow {
  assert.equal(preview.ok, true);
  if (!preview.ok) throw new Error("미리보기 실패");
  const row = preview.rows.find((candidate) => candidate.rowNumber === rowNumber);
  assert.ok(row, `${rowNumber}행이 미리보기에 없다`);
  return row;
}

function resultOf(results: readonly KyosanChunkRowResult[], rowNumber: number): KyosanChunkRowResult {
  const row = results.find((candidate) => candidate.rowNumber === rowNumber);
  assert.ok(row, `${rowNumber}행 결과가 없다`);
  return row;
}

function createdId(results: readonly KyosanChunkRowResult[], rowNumber: number): string {
  const row = resultOf(results, rowNumber);
  assert.equal(row.outcome, "CREATED", `${rowNumber}행: ${JSON.stringify(row)}`);
  assert.ok(row.repairCaseId);
  return row.repairCaseId;
}

describe("과거 인수품 가져오기 — 미리보기 · 조각 실행", () => {
  let mainPreview: KyosanPreviewResult;
  let mainBatchId: string;
  let mainSha: string;
  let mainResults: KyosanChunkRowResult[];

  test("미리보기는 DB 에 쓰지 않고 줄마다 최종 분류를 낸다", async () => {
    const before1 = await countOurRows();
    mainPreview = await buildKyosanImportPreview({ bytes: MAIN_BYTES, fileName: FILE_NAME, actor: admin, today: TODAY });
    assert.equal(mainPreview.ok, true, JSON.stringify(mainPreview));
    if (!mainPreview.ok) return;
    mainBatchId = mainPreview.batchId;
    mainSha = mainPreview.fileSha256;
    trackKeys(mainBatchId, mainSha, MAIN_BYTES);

    assert.deepEqual(await countOurRows(), before1, "미리보기가 DB 에 무언가를 썼다");

    assert.deepEqual(
      { ...mainPreview.counts },
      { total: 13, IMPORTABLE: 8, ALREADY_EXISTS: 1, ALREADY_EXISTS_TRASHED: 1, EXCLUDED: 1, NEEDS_REVIEW: 2 }
    );

    const fullWidth = rowOf(mainPreview, 18);
    assert.equal(fullWidth.status, "IMPORTABLE");
    assert.deepEqual(fullWidth.plan?.customer, { kind: "EXISTING", id: customerAId, name: CUSTOMER_A });
    assert.deepEqual(fullWidth.plan?.endUser, { kind: "NEW", name: END_USER_NEW });
    assert.deepEqual(fullWidth.plan?.productModel, { kind: "EXISTING", id: modelPlainId, name: MODEL_PLAIN });
    assert.equal(fullWidth.plan?.workflowType, "PAID_GENERATOR");
    assert.equal(fullWidth.plan?.targetStepKey, "intake_inspection");

    const shipped = rowOf(mainPreview, 19);
    assert.equal(shipped.plan?.workflowType, "WARRANTY_MATCHER");
    assert.equal(shipped.plan?.targetStepKey, "shipment_completed");
    assert.equal(shipped.plan?.actualShipmentDate, "2094-02-01");
    assert.deepEqual(shipped.plan?.customer, { kind: "NEW", name: CUSTOMER_B_NEW });
    assert.deepEqual(shipped.plan?.productModel, { kind: "NEW", name: MODEL_NEW_MB });

    assert.equal(rowOf(mainPreview, 20).plan?.targetStepKey, "shipment_approved");
    assert.equal(rowOf(mainPreview, 21).plan?.targetStepKey, "waiting_kyosan_reply");

    const partial = rowOf(mainPreview, 22);
    assert.equal(partial.plan?.billingType, "PARTIAL_PAID");
    assert.equal(partial.plan?.workflowType, "PAID_GENERATOR");
    assert.equal(partial.plan?.targetStepKey, "waiting_po");
    assert.equal(partial.plan?.billingAdjustment, "WARRANTY_PO_TO_PARTIAL_PAID");

    assert.equal(rowOf(mainPreview, 23).plan?.billingReview, true);
    assert.equal(rowOf(mainPreview, 24).plan?.billingReview, true);

    const live = rowOf(mainPreview, 25);
    assert.equal(live.status, "ALREADY_EXISTS");
    assert.equal(live.existing?.repairCaseId, liveExistingId);
    assert.equal(live.existing?.trashed, false);
    assert.equal(live.existing?.customerName, CUSTOMER_OTHER);
    assert.equal(live.existing?.modelName, MODEL_MATCHER);
    assert.equal(live.existing?.serialNumber, `SN-OTHER-${RUN}`);
    assert.equal(live.existing?.looksDifferent, true);

    const trashed = rowOf(mainPreview, 26);
    assert.equal(trashed.status, "ALREADY_EXISTS_TRASHED");
    assert.equal(trashed.existing?.repairCaseId, trashedExistingId);
    assert.equal(trashed.existing?.trashed, true);
    assert.equal(trashed.existing?.looksDifferent, false);

    for (const rowNumber of [27, 28]) {
      const duplicate = rowOf(mainPreview, rowNumber);
      assert.equal(duplicate.status, "NEEDS_REVIEW");
      assert.ok(duplicate.reasons.some((reason) => reason.includes("여러 번")), JSON.stringify(duplicate.reasons));
    }
    assert.equal(rowOf(mainPreview, 29).status, "EXCLUDED");

    const kindMismatch = rowOf(mainPreview, 30);
    assert.equal(kindMismatch.status, "IMPORTABLE");
    assert.ok(
      kindMismatch.warnings.some((warning) => warning.includes("모델의 종류는 바꾸지 않습니다")),
      JSON.stringify(kindMismatch.warnings)
    );

    // 새로 생길 이름 — 같은 키끼리 묶이고, 비슷한 기존 이름이 붙는다.
    assert.equal(mainPreview.newNames.customers.length, 1);
    assert.equal(mainPreview.newNames.customers[0].name, CUSTOMER_B_NEW);
    assert.deepEqual(mainPreview.newNames.customers[0].rowNumbers, [19]);
    assert.ok(mainPreview.newNames.customers[0].suggestions.some((s) => s.id === customerAId));
    assert.equal(mainPreview.newNames.endUsers.length, 1);
    assert.deepEqual(mainPreview.newNames.endUsers[0].rowNumbers, [18, 20]);
    assert.equal(mainPreview.newNames.endUsers[0].customerId, customerAId);
    assert.equal(mainPreview.newNames.productModels.length, 1);
    assert.equal(mainPreview.newNames.productModels[0].kind, "MATCHER");
    assert.deepEqual(mainPreview.newNames.productModels[0].rowNumbers, [19, 21]);
  });

  test("권한 없는 행위자는 미리보기도 실행도 못 한다", async () => {
    const salesActor: KyosanImportActor = { userId: salesId, role: "SALES", approvalStatus: "APPROVED", isDeveloper: false };
    const pending: KyosanImportActor = { ...admin, approvalStatus: "PENDING" };
    for (const actor of [salesActor, pending]) {
      const preview = await buildKyosanImportPreview({ bytes: MAIN_BYTES, fileName: FILE_NAME, actor, today: TODAY });
      assert.equal(preview.ok, false);
      if (!preview.ok) assert.equal(preview.code, "FORBIDDEN");
      const chunk = await executeKyosanImportChunk({
        bytes: MAIN_BYTES,
        fileName: FILE_NAME,
        batchId: mainBatchId,
        fileSha256: mainSha,
        rowNumbers: [18],
        actor,
        today: TODAY,
      });
      assert.equal(chunk.ok, false);
      if (!chunk.ok) assert.equal(chunk.code, "FORBIDDEN");
    }
    assert.equal((await countOurRows()).cases, 2, "거절된 실행이 건을 만들었다");
  });

  test("파일 sha 가 다르면 · 50줄을 넘으면 실행을 거절한다", async () => {
    const changed = await executeKyosanImportChunk({
      bytes: MAIN_BYTES,
      fileName: FILE_NAME,
      batchId: mainBatchId,
      fileSha256: "0".repeat(64),
      rowNumbers: [18],
      actor: admin,
      today: TODAY,
    });
    assert.equal(changed.ok, false);
    if (!changed.ok) assert.equal(changed.code, "FILE_CHANGED");

    const tooMany = await executeKyosanImportChunk({
      bytes: MAIN_BYTES,
      fileName: FILE_NAME,
      batchId: mainBatchId,
      fileSha256: mainSha,
      rowNumbers: Array.from({ length: 51 }, (_unused, index) => 18 + index),
      actor: admin,
      today: TODAY,
    });
    assert.equal(tooMany.ok, false);
    if (!tooMany.ok) assert.equal(tooMany.code, "TOO_MANY_ROWS");

    const badBatch = await executeKyosanImportChunk({
      bytes: MAIN_BYTES,
      fileName: FILE_NAME,
      batchId: "not-a-uuid",
      fileSha256: mainSha,
      rowNumbers: [18],
      actor: admin,
      today: TODAY,
    });
    assert.equal(badBatch.ok, false);
    if (!badBatch.ok) assert.equal(badBatch.code, "VALIDATION_ERROR");

    assert.equal((await countOurRows()).cases, 2, "거절된 실행이 건을 만들었다");
  });

  test("조각 실행 — 줄마다 차례로 만들고, 이미 있는 번호는 건드리지 않는다", async () => {
    const chunk = await executeKyosanImportChunk({
      bytes: MAIN_BYTES,
      fileName: FILE_NAME,
      batchId: mainBatchId,
      fileSha256: mainSha,
      rowNumbers: MAIN_ROW_NUMBERS,
      actor: admin,
      today: TODAY,
    });
    assert.equal(chunk.ok, true, JSON.stringify(chunk));
    if (!chunk.ok) return;
    mainResults = chunk.results;
    assert.deepEqual(
      mainResults.map((row) => [row.rowNumber, row.outcome]),
      [
        [18, "CREATED"],
        [19, "CREATED"],
        [20, "CREATED"],
        [21, "CREATED"],
        [22, "CREATED"],
        [23, "CREATED"],
        [24, "CREATED"],
        [25, "ALREADY_EXISTS"],
        [26, "ALREADY_EXISTS"],
        [27, "SKIPPED"],
        [28, "SKIPPED"],
        [29, "SKIPPED"],
        [30, "CREATED"],
      ]
    );

    // 18: 인수점검 — from = to 흔적 한 줄 · metadata(개인정보 없음) · 전각 고객사명이 기존 A 에 붙음
    const intake = await caseState(createdId(mainResults, 18));
    assert.equal(intake.customerId, customerAId);
    assert.equal(intake.stepKey, "intake_inspection");
    assert.equal(intake.workflowType, "PAID_GENERATOR");
    assert.equal(intake.billingType, "PAID");
    assert.equal(intake.isLocked, false);
    assert.equal(intake.legacyReportNumber, `RPT-${RUN}-01`);
    assert.equal(intake.notes, null);
    assert.equal(intake.productModelId, modelPlainId);
    const intakeHistory = await histories(createdId(mainResults, 18));
    assert.equal(intakeHistory.length, 1);
    assert.equal(intakeHistory[0].actionType, "LEGACY_IMPORT_STATE_SET");
    assert.equal(intakeHistory[0].fromStepId, intakeHistory[0].toStepId, "인수점검에 놓인 줄은 from = to 흔적이다");
    assert.deepEqual(intakeHistory[0].metadata, {
      importBatchId: mainBatchId,
      sourceRowNumber: 18,
      source: "KYOSAN_INTAKE_LIST",
      fileSha256: mainSha,
      billingReview: false,
      billingAdjustment: null,
      sourceStatus: "受付",
      sourceBilling: "有償",
    });
    const customerARows = await db.select({ id: customers.id }).from(customers).where(eq(customers.name, CUSTOMER_A));
    assert.equal(customerARows.length, 1);
    const [fullWidthCustomers] = await db
      .select({ n: count() })
      .from(customers)
      .where(like(customers.name, `${FULL_WIDTH_PREFIX}%`));
    assert.equal(fullWidthCustomers.n, 0, "전각 이름으로 새 고객사가 생겼다");
    assert.ok(intake.endUserId);
    const [endUser] = await db.select().from(endUsers).where(eq(endUsers.id, intake.endUserId));
    assert.equal(endUser.name, END_USER_NEW);
    assert.equal(endUser.customerId, customerAId);

    // 19: 출하 완료 = 잠김 + 출하일 · 새 고객사 · 새 모델에 kind
    const shipped = await caseState(createdId(mainResults, 19));
    assert.equal(shipped.workflowType, "WARRANTY_MATCHER");
    assert.equal(shipped.billingType, "WARRANTY");
    assert.equal(shipped.stepKey, "shipment_completed");
    assert.equal(shipped.isLocked, true);
    assert.equal(shipped.actualShipmentDate, "2094-02-01");
    const [customerB] = await db.select().from(customers).where(eq(customers.id, shipped.customerId));
    assert.equal(customerB.name, CUSTOMER_B_NEW);
    assert.ok(shipped.productModelId);
    const [newModel] = await db.select().from(productModels).where(eq(productModels.id, shipped.productModelId));
    assert.equal(newModel.modelName, MODEL_NEW_MB);
    assert.equal(newModel.kind, "MATCHER", "새 모델에는 파일의 종류가 들어간다");
    const shippedHistory = await histories(createdId(mainResults, 19));
    assert.equal(shippedHistory.length, 1);
    assert.notEqual(shippedHistory[0].fromStepId, shippedHistory[0].toStepId);

    // 20: 제너레이터 出荷待ち → shipment_approved · 전각 End-User 가 18행이 만든 것에 붙음
    const approved = await caseState(createdId(mainResults, 20));
    assert.equal(approved.workflowType, "PAID_GENERATOR");
    assert.equal(approved.stepKey, "shipment_approved");
    assert.equal(approved.isLocked, false);
    assert.equal(approved.endUserId, intake.endUserId);

    // 21: 교산 회신 대기 · 전각 모델명이 19행이 만든 새 모델에 붙음
    const waitingReply = await caseState(createdId(mainResults, 21));
    assert.equal(waitingReply.workflowType, "PAID_MATCHER");
    assert.equal(waitingReply.stepKey, "waiting_kyosan_reply");
    assert.equal(waitingReply.productModelId, shipped.productModelId);

    // 22: 無償 + 客先待ち → 일부 유상 · PAID_* · waiting_po · 메모 한 줄
    const partialId = createdId(mainResults, 22);
    const partial = await caseState(partialId);
    assert.equal(partial.billingType, "PARTIAL_PAID");
    assert.equal(partial.workflowType, "PAID_GENERATOR");
    assert.equal(partial.stepKey, "waiting_po");
    assert.equal(partial.notes, PARTIAL_PAID_NOTE);
    const [partialHistory] = await histories(partialId);
    assert.deepEqual(partialHistory.metadata, {
      importBatchId: mainBatchId,
      sourceRowNumber: 22,
      source: "KYOSAN_INTAKE_LIST",
      fileSha256: mainSha,
      billingReview: false,
      billingAdjustment: "WARRANTY_PO_TO_PARTIAL_PAID",
      sourceStatus: "中断：客先待ち",
      sourceBilling: "無償",
    });

    // 23 · 24: 유/무상 확인 필요 — 메모 + metadata
    const reviewId = createdId(mainResults, 23);
    const review = await caseState(reviewId);
    assert.equal(review.billingType, "PAID");
    assert.equal(review.notes, `${PAID_NOTE_REVIEW_PREFIX}調整中)`);
    const [reviewHistory] = await histories(reviewId);
    assert.equal((reviewHistory.metadata as Record<string, unknown>).billingReview, true);
    assert.equal((reviewHistory.metadata as Record<string, unknown>).sourceBilling, "調整中");
    const blankId = createdId(mainResults, 24);
    assert.equal((await caseState(blankId)).notes, `${PAID_NOTE_REVIEW_PREFIX}비어 있음)`);
    const [blankHistory] = await histories(blankId);
    assert.equal((blankHistory.metadata as Record<string, unknown>).sourceBilling, null);

    // 25 · 26: 이미 있음 — 덮어쓰지 않는다
    assert.equal(resultOf(mainResults, 25).repairCaseId, liveExistingId);
    assert.equal(resultOf(mainResults, 26).repairCaseId, trashedExistingId);
    const live = await caseState(liveExistingId);
    assert.equal(live.customerId, customerOtherId);
    assert.equal(live.workflowType, "PAID_MATCHER");
    assert.deepEqual(await histories(liveExistingId), [], "기존 건에 가져오기 흔적이 붙었다");
    assert.equal((await caseState(trashedExistingId)).isDeleted, true);

    // 30: 기존 모델의 kind 는 바뀌지 않는다(파일은 제너레이터로 적었다)
    const kindKept = await caseState(createdId(mainResults, 30));
    assert.equal(kindKept.productModelId, modelMatcherId);
    const [matcherModel] = await db.select().from(productModels).where(eq(productModels.id, modelMatcherId));
    assert.equal(matcherModel.kind, "MATCHER");
    const [plainModel] = await db.select().from(productModels).where(eq(productModels.id, modelPlainId));
    assert.equal(plainModel.kind, null, "기존 모델(kind 없음)에 kind 가 들어갔다");

    // 순번 — 가져온 번호 가운데 가장 큰 순번(13)까지 올라간다
    assert.equal(await sequenceOf(MAIN_MONTH), 13);
  });

  test("유/무상 확인 필요 목록 — 가져온 뒤 유무상을 정하면 빠진다", async () => {
    const reviewId = createdId(mainResults, 23);
    const blankId = createdId(mainResults, 24);
    const listed = new Set((await listImportedCasesNeedingBillingReview()).map((row) => row.repairCaseId));
    assert.ok(listed.has(reviewId));
    assert.ok(listed.has(blankId));
    assert.equal(listed.has(createdId(mainResults, 18)), false);
    assert.equal(listed.has(createdId(mainResults, 22)), false, "일부 유상으로 바꾼 줄은 확인 필요가 아니다");

    const decided = await resolveRepairCaseBillingDecision({
      repairCaseId: reviewId,
      expectedVersion: 1,
      nextBillingType: "WARRANTY",
      actorUserId: adminId,
    });
    assert.equal(decided.ok, true, JSON.stringify(decided));

    const after1 = new Set((await listImportedCasesNeedingBillingReview()).map((row) => row.repairCaseId));
    assert.equal(after1.has(reviewId), false);
    assert.ok(after1.has(blankId));
  });

  test("같은 조각을 다시 실행하면 같은 건이 돌아온다 — 새로 만들지 않는다", async () => {
    const before1 = await countOurRows();
    const again = await executeKyosanImportChunk({
      bytes: MAIN_BYTES,
      fileName: FILE_NAME,
      batchId: mainBatchId,
      fileSha256: mainSha,
      rowNumbers: MAIN_ROW_NUMBERS,
      actor: admin,
      today: TODAY,
    });
    assert.equal(again.ok, true, JSON.stringify(again));
    if (!again.ok) return;
    assert.deepEqual(
      again.results.map((row) => [row.rowNumber, row.outcome, row.repairCaseId ?? null]),
      mainResults.map((row) => [row.rowNumber, row.outcome, row.repairCaseId ?? null])
    );
    assert.deepEqual(await countOurRows(), before1);

    // 새 미리보기(새 batchId)로 같은 파일을 다시 가져오면 전부 「이미 있음」이다.
    const secondPreview = await buildKyosanImportPreview({ bytes: MAIN_BYTES, fileName: FILE_NAME, actor: admin, today: TODAY });
    assert.equal(secondPreview.ok, true);
    if (!secondPreview.ok) return;
    assert.notEqual(secondPreview.batchId, mainBatchId);
    assert.equal(secondPreview.counts.IMPORTABLE, 0);
    assert.equal(secondPreview.counts.ALREADY_EXISTS, 9);
  });
});

describe("과거 인수품 가져오기 — 대조 규칙", () => {
  test("현재 판에 없는 단계 · 새 모델 권한 없음 · 같은 이름의 고객사가 여럿이면 확인 필요", async () => {
    await db.insert(customers).values([{ name: CUSTOMER_DUP }, { name: toFullWidth(CUSTOMER_DUP) }]);
    const bytes = kyosanWorkbook([
      dataRow("D940120", { F: MODEL_UNKNOWN }),
      dataRow("D940121", { J: CUSTOMER_DUP }),
      dataRow("D940122", { O: "出荷待ち" }),
    ]);
    const parsed = parseKyosanIntakeWorkbook(bytes, FILE_NAME, { today: TODAY });
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;

    const lookups = await loadImportLookups([]);
    for (const [workflowType, stepKey] of [
      ["PAID_GENERATOR", "shipment_approved"],
      ["PAID_GENERATOR", "intake_inspection"],
      ["PAID_MATCHER", "waiting_kyosan_reply"],
      ["PAID_GENERATOR", "waiting_po"],
      ["WARRANTY_MATCHER", "shipment_completed"],
    ] as const) {
      assert.ok(lookups.stepKeysByWorkflowType.get(workflowType)?.has(stepKey), `${workflowType}/${stepKey}`);
    }

    const withoutModelRights = classifyKyosanRowsForImport(parsed.rows, lookups, { canCreateProductModels: false });
    assert.equal(withoutModelRights[0].status, "NEEDS_REVIEW");
    assert.ok(withoutModelRights[0].reasons.some((reason) => reason.includes("새 모델을 만들 권한이 없습니다")));
    assert.equal(withoutModelRights[1].status, "NEEDS_REVIEW");
    assert.ok(withoutModelRights[1].reasons.some((reason) => reason.includes("여럿")), JSON.stringify(withoutModelRights[1].reasons));
    assert.equal(withoutModelRights[2].status, "IMPORTABLE");

    const withModelRights = classifyKyosanRowsForImport(parsed.rows, lookups, { canCreateProductModels: true });
    assert.equal(withModelRights[0].status, "IMPORTABLE");
    assert.deepEqual(withModelRights[0].plan?.productModel, { kind: "NEW", name: MODEL_UNKNOWN });

    const trimmed = new Map([...lookups.stepKeysByWorkflowType].map(([key, value]) => [key, new Set(value)]));
    trimmed.get("PAID_GENERATOR")?.delete("shipment_approved");
    const missingStep = classifyKyosanRowsForImport(
      parsed.rows,
      { ...lookups, stepKeysByWorkflowType: trimmed },
      { canCreateProductModels: true }
    );
    assert.equal(missingStep[2].status, "NEEDS_REVIEW");
    assert.ok(
      missingStep[2].reasons.some((reason) => reason.includes("현재 절차") && reason.includes("shipment_approved")),
      JSON.stringify(missingStep[2].reasons)
    );
  });

  test("다른 건으로 보임 · 멱등 키는 순수 함수다", () => {
    const fileRow = { customerName: toFullWidth("ACME Corp"), modelName: "RF-3000", serialNumber: "１２３" };
    assert.equal(looksLikeDifferentCase(fileRow, { customerName: "acme  corp", modelName: "rf-3000", serialNumber: "123" }), false);
    assert.equal(looksLikeDifferentCase(fileRow, { customerName: "ACME Corp", modelName: "RF-3000", serialNumber: "124" }), true);
    assert.equal(looksLikeDifferentCase(fileRow, { customerName: "OTHER", modelName: "RF-3000", serialNumber: "123" }), true);

    const batchId = randomUUID();
    const key = kyosanIdempotencyKey(batchId, "a".repeat(64), 18, "D940101");
    assert.equal(key, kyosanIdempotencyKey(batchId, "a".repeat(64), 18, "D940101"));
    assert.notEqual(key, kyosanIdempotencyKey(batchId, "a".repeat(64), 19, "D940101"));
    assert.match(key, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  test("가져오기 흔적 metadata 는 정해진 칸만 받는다 — 개인정보 칸이 끼면 거절", async () => {
    const legacy = {
      targetStepKey: "intake_inspection",
      actualShipmentDate: null,
      batchId: randomUUID(),
      sourceRowNumber: 18,
    };
    const goodMetadata = {
      source: "KYOSAN_INTAKE_LIST" as const,
      fileSha256: "b".repeat(64),
      billingReview: false,
      billingAdjustment: null,
      sourceStatus: "受付",
      sourceBilling: "有償",
    };
    const bad = [
      { ...goodMetadata, customerName: CUSTOMER_A },
      { ...goodMetadata, fileSha256: "not-a-sha" },
      { ...goodMetadata, sourceStatus: "x".repeat(51) },
    ];
    for (const metadata of bad) {
      const key = randomUUID();
      trackedIdempotencyKeys.push(key);
      const result = await createRepairCaseWithIdempotency({
        actor: admin,
        intake: baseIntake({ intakeNumber: "D940130", serialNumber: `SN-${RUN}-meta` }),
        idempotencyKey: key,
        logContext: "EXCEL_IMPORT",
        legacyImportState: { ...legacy, metadata: metadata as typeof goodMetadata },
      });
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.code, "VALIDATION_ERROR");
    }
    const [created] = await db.select({ n: count() }).from(repairCases).where(eq(repairCases.intakeNumber, "D940130"));
    assert.equal(created.n, 0);
  });
});

describe("인수번호 순번 · 대화형 접수 회귀", () => {
  test("순번 GREATEST — 큰 번호를 가져오면 오르고, 작은 번호로는 내려가지 않는다", async () => {
    await db.insert(repairCaseIntakeSequences).values({ yearMonth: SEQ_MONTH, lastSequence: 5 });
    const bytes = kyosanWorkbook([dataRow("D940209"), dataRow("D940203")]);
    const preview = await buildKyosanImportPreview({ bytes, fileName: FILE_NAME, actor: admin, today: TODAY });
    assert.equal(preview.ok, true, JSON.stringify(preview));
    if (!preview.ok) return;
    trackKeys(preview.batchId, preview.fileSha256, bytes);

    const first = await executeKyosanImportChunk({
      bytes,
      fileName: FILE_NAME,
      batchId: preview.batchId,
      fileSha256: preview.fileSha256,
      rowNumbers: [18],
      actor: admin,
      today: TODAY,
    });
    assert.equal(first.ok && first.results[0].outcome, "CREATED", JSON.stringify(first));
    assert.equal(await sequenceOf(SEQ_MONTH), 9, "5 → 9 로 올라야 한다");

    const second = await executeKyosanImportChunk({
      bytes,
      fileName: FILE_NAME,
      batchId: preview.batchId,
      fileSha256: preview.fileSha256,
      rowNumbers: [19],
      actor: admin,
      today: TODAY,
    });
    assert.equal(second.ok && second.results[0].outcome, "CREATED", JSON.stringify(second));
    assert.equal(await sequenceOf(SEQ_MONTH), 9, "작은 번호(03)로 내려가면 안 된다");
  });

  test("대화형 접수(INTERACTIVE)는 흔적 · 순번 동작이 그대로다", async () => {
    // 수기 번호 — 가져오기 흔적이 없고, 그 달 순번 행을 만들지도 올리지도 않는다(예전 그대로).
    const manualKey = randomUUID();
    trackedIdempotencyKeys.push(manualKey);
    const manual = await createRepairCaseWithIdempotency({
      actor: admin,
      intake: baseIntake({ intakeNumber: "D940350", receivedAt: "2094-03-05", serialNumber: `SN-${RUN}-D940350` }),
      idempotencyKey: manualKey,
      logContext: "INTERACTIVE",
    });
    assert.equal(manual.ok, true, JSON.stringify(manual));
    if (!manual.ok) return;
    assert.deepEqual(await histories(manual.id), []);
    assert.equal(await sequenceOf(INTERACTIVE_MONTH), null, "대화형 수기 번호가 순번을 건드렸다");
    assert.equal((await caseState(manual.id)).stepKey, "intake_inspection");

    // 자동 번호 — 할당기가 지금 순번 + 1 을 준다(가져오기가 올려 둔 순번을 이어받는다).
    const current = await sequenceOf(SEQ_MONTH);
    assert.ok(current !== null);
    const autoKey = randomUUID();
    trackedIdempotencyKeys.push(autoKey);
    const auto = await createRepairCaseWithIdempotency({
      actor: admin,
      intake: baseIntake({ receivedAt: "2094-02-10", serialNumber: `SN-${RUN}-auto` }),
      idempotencyKey: autoKey,
      logContext: "INTERACTIVE",
    });
    assert.equal(auto.ok, true, JSON.stringify(auto));
    if (!auto.ok) return;
    assert.equal(auto.intakeNumber, `D${SEQ_MONTH}${String(current + 1).padStart(2, "0")}`);
    assert.deepEqual(await histories(auto.id), []);
    assert.equal(await sequenceOf(SEQ_MONTH), current + 1);
  });
});
