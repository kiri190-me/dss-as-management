import {
  PROCEDURE_BRANCH_TYPE_CODES,
  PROCEDURE_EQUIPMENT_TYPE_CODES,
  PROCEDURE_NODE_TYPE_CODES,
  PROCEDURE_TEMPLATE_CATEGORY_CODES,
  PROCEDURE_TEMPLATE_SOURCE_TYPE_CODES,
  PROCEDURE_VALIDATION_RESOLUTION_STATUS_CODES,
  PROCEDURE_VALIDATION_SEVERITY_CODES,
  type ProcedureBranchType,
  type ProcedureEquipmentType,
  type ProcedureNodeType,
  type ProcedureTemplateCategory,
  type ProcedureTemplateSourceType,
  type ProcedureValidationResolutionStatus,
  type ProcedureValidationSeverity,
} from "@/lib/domain/procedure-template-types";

/**
 * ============================================================================
 * 절차를 **개발에서 떠서 운영에 넣는** 길의 머리 — DB 에 안 붙는 순수 함수들
 * ============================================================================
 * 쓰는 쪽은 둘이다. `scripts/export-procedure-bundle.ts`(개발에서 뜬다)와
 * `scripts/import-procedure-bundle.ts`(🔴 **운영에서 넣는다**). 둘이 같은 모양을
 * 읽고 쓰게 하려고 글 모양·검사·계획 세우기를 전부 여기 한 곳에 둔다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 🔴 왜 이 길이 필요한가 — 절차는 **코드가 아니라 자료**다
 * ──────────────────────────────────────────────────────────────────────
 * 엑셀 흐름도에서 들여온 기술 작업 절차 스물다섯은 **개발 DB 안에만** 있다. 배포를
 * 해도 따라가지 않는다. 그리고 들여오기 스크립트
 * (`import-technical-task-procedures.ts`)에는 **개발 DB 에서만 돌게 하는 자물쇠**가
 * 달려 있어(`dev-database-write-guard.ts`) 운영에서 엑셀을 다시 읽을 수도 없다.
 *
 * 🔴 **그 자물쇠를 푸는 길은 고르지 않았다**(2026-11-06 사용자 결정). 운영에서
 * 엑셀을 다시 읽게 만들면 ① 원본 워크북을 NAS 로 올려야 하고 ② 자물쇠가 풀린
 * 스크립트가 영영 남는다. 대신 **개발에서 만든 결과를 그대로 떠서 옮긴다.**
 *
 * ──────────────────────────────────────────────────────────────────────
 * 🔴 사용자 칸은 **짐에 싣지 않는다** — 바꿔치기보다 강한 보증
 * ──────────────────────────────────────────────────────────────────────
 * `procedure_templates` 에는 사용자를 가리키는 칸이 넷 있다(`created_by_user_id`
 * `published_by_user_id` `archived_by_user_id` `deleted_by`). **개발 DB 의 사용자
 * id 는 운영에 없을 수 있다** — 그대로 넣으면 외래키가 거절한다.
 *
 * 그래서 아래 짐 타입(`BundleTemplate`)에는 **그 네 칸이 아예 없다.** 「넣을 때
 * 바꿔치기한다」가 아니라 **애초에 실리지 않는다**. 까닭:
 *   - 바꿔치기는 **빠뜨릴 수 있다.** 칸이 하나 늘어난 날 한 군데만 고치면 개발
 *     사용자 id 가 운영으로 샌다. 타입에 없으면 컴파일러가 그 실수를 막는다.
 *   - 뜬 파일이 이 PC 를 떠난다. 사내 사용자 id 가 적힌 파일을 만들 까닭이 없다.
 *   - 「누가 만들었나」는 **옮긴 사람**이 맞다. 개발 DB 의 SUPER_ADMIN 이 아니다.
 *
 * 그래서 넣는 쪽은 `--actor <운영 사용자 uuid>` 를 **반드시** 받아 그것을
 * `created_by_user_id` 에 넣고, 나머지 셋은 **비운다**(DRAFT 는 게시·보관·삭제를
 * 겪은 적이 없으므로 원래 비어 있다 — 뜨는 쪽이 그것을 재서 확인한다).
 * 검증 메모의 `resolved_by_user_id` 도 같은 까닭으로 안 싣는다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 🔵 id 는 **그대로 가져간다**
 * ──────────────────────────────────────────────────────────────────────
 * 절차·노드·분기·메모의 UUID 를 새로 짓지 않고 개발에서 쓰던 것을 그대로 넣는다.
 * 그래야 ① 분기가 가리키는 노드, 노드가 가리키는 다음 절차를 **짐 안에서** 풀 수
 * 있고 ② 나중에 양쪽을 맞대어 「같은 것인가」를 id 로 셀 수 있다. 🔴 대신 넣기 전에
 * **그 id 들이 운영에 이미 있는지 반드시 센다**(아래 `planProcedureBundleInsert`).
 */

export const PROCEDURE_BUNDLE_FORMAT = "dss-as/procedure-template-bundle";

/**
 * 모양이 바뀌면 올린다. 🔴 넣는 쪽은 **아는 판만** 받는다 — 모르는 판을 「아마
 * 비슷하겠지」로 읽으면 칸 하나가 조용히 비어서 들어간다.
 */
export const PROCEDURE_BUNDLE_FORMAT_VERSION = 1;

/**
 * 짐에 실리는 절차 한 줄.
 *
 * 🔴 **사용자 칸 넷이 없다**(위 머리말). `status` 는 싣는다 — 넣는 쪽이 DRAFT 가
 * 맞는지 **재서** 확인해야 해서다(안 실으면 「DRAFT 로 넣었다」가 검사 없는 주장이
 * 된다). `is_deleted`·`deleted_at`·`published_at`·`archived_at` 도 안 싣는다:
 * 뜨는 쪽이 비어 있음을 확인하고 거른 것만 담는다.
 */
export type BundleTemplate = {
  id: string;
  code: string;
  name: string;
  equipmentType: ProcedureEquipmentType;
  category: ProcedureTemplateCategory;
  description: string | null;
  status: "DRAFT";
  isReferenceOnly: boolean;
  version: number;
  sourceType: ProcedureTemplateSourceType;
  sourceFileName: string | null;
  sourceFileHash: string | null;
  /** 판 사슬. 지금 스물다섯은 전부 null 이지만 모양은 그대로 나른다. */
  supersedesTemplateId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type BundleNode = {
  id: string;
  procedureTemplateId: string;
  nodeCode: string;
  nodeType: ProcedureNodeType;
  title: string;
  description: string | null;
  objective: string | null;
  preparation: string | null;
  toolsAndEquipment: string | null;
  safetyCaution: string | null;
  instructions: string | null;
  expectedNormalResult: string | null;
  ngSymptoms: string | null;
  recommendedCorrectiveAction: string | null;
  acceptanceCriteria: string | null;
  workerMayAddNextTask: boolean;
  /** 🔴 **다른 절차**를 가리킨다. 넣는 차례 때문에 깨지지 않게 나중에 채운다. */
  nextProcedureTemplateId: string | null;
  positionX: number;
  positionY: number;
  userPositionX: number | null;
  userPositionY: number | null;
  sortOrder: number;
  sourceWorksheet: string | null;
  sourceShapeId: string | null;
  sourceCellRange: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type BundleEdge = {
  id: string;
  procedureTemplateId: string;
  fromNodeId: string;
  toNodeId: string;
  branchType: ProcedureBranchType;
  branchLabel: string | null;
  conditionDefinition: unknown;
  sortOrder: number;
  sourceConnectorId: string | null;
  /** 같은 표의 다른 줄을 가리킨다 — 이것도 나중에 채운다. */
  clonedFromEdgeId: string | null;
  userRoutePoints: { x: number; y: number }[] | null;
};

/**
 * 들여오기가 남긴 메모. 🔴 **함께 옮긴다** — 「왜 원본과 달라졌나」가 적힌 줄이고,
 * 그것이 없으면 운영에서 절차를 보는 사람은 달라진 자리를 결함으로 읽는다.
 */
export type BundleIssue = {
  id: string;
  procedureTemplateId: string;
  severity: ProcedureValidationSeverity;
  issueType: string;
  message: string;
  sourceWorksheet: string | null;
  sourceReference: string | null;
  rawEvidence: unknown;
  resolutionStatus: ProcedureValidationResolutionStatus;
  createdAt: string;
};

export type ProcedureBundle = {
  format: typeof PROCEDURE_BUNDLE_FORMAT;
  formatVersion: number;
  exportedAt: string;
  /** 🔴 `호스트:포트/DB이름` 까지다 — 비밀번호도 사용자명도 안 담는다. */
  exportedFrom: string;
  /** 무엇을 골랐는지 사람이 읽을 한 줄. */
  selection: string;
  counts: { templates: number; nodes: number; edges: number; issues: number };
  templates: BundleTemplate[];
  nodes: BundleNode[];
  edges: BundleEdge[];
  issues: BundleIssue[];
};

/** 멈추는 까닭. 갈래를 코드로 나눠 두면 시험이 「무엇 때문에 멈췄나」를 잴 수 있다. */
export type BundleBlockerCode =
  | "BAD_FORMAT"
  | "EMPTY_BUNDLE"
  | "COUNT_MISMATCH"
  | "INTERNAL_INCONSISTENT"
  | "NOT_DRAFT"
  | "ACTOR_MISSING"
  | "TEMPLATE_ID_EXISTS"
  | "NODE_ID_EXISTS"
  | "EDGE_ID_EXISTS"
  | "ISSUE_ID_EXISTS"
  | "CODE_VERSION_EXISTS"
  | "NAME_EXISTS";

export type BundleBlocker = { code: BundleBlockerCode; message: string };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * ============================================================================
 * 1. 파일을 **읽어 들이는** 자리 — 모양이 안 맞으면 여기서 끝난다
 * ============================================================================
 * 🔴 **빈 짐은 통과시키지 않는다.** 절차가 0개인 파일을 「넣을 것이 없으니 성공」으로
 * 읽으면, 뜨는 쪽이 아무것도 못 떠 온 날에도 넣는 쪽이 초록으로 끝난다. 그 모양은
 * 시험에서도 똑같이 위험하다 — 표본이 비어서 공짜로 통과하는 자리가 된다.
 * 그래서 `templates` 가 비면 **그 자체가 멈출 까닭**이다.
 *
 * 🔵 `counts` 를 따로 싣고 배열 길이와 맞대어 보는 까닭도 같다. 파일이 중간에
 * 잘렸거나 누가 손으로 몇 줄을 지웠으면 길이만으로는 알 수 없다.
 */
export type BundleParseResult =
  | { ok: true; bundle: ProcedureBundle }
  | { ok: false; blockers: BundleBlocker[] };

export function parseProcedureBundle(raw: unknown): BundleParseResult {
  const blockers: BundleBlocker[] = [];
  const bad = (code: BundleBlockerCode, message: string): void => {
    blockers.push({ code, message });
  };

  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, blockers: [{ code: "BAD_FORMAT", message: "JSON 의 맨 바깥이 객체가 아닙니다." }] };
  }
  const root = raw as Record<string, unknown>;
  if (root.format !== PROCEDURE_BUNDLE_FORMAT) {
    bad("BAD_FORMAT", `format 이 "${PROCEDURE_BUNDLE_FORMAT}" 가 아닙니다 — 본 것: ${JSON.stringify(root.format)}`);
  }
  if (root.formatVersion !== PROCEDURE_BUNDLE_FORMAT_VERSION) {
    bad(
      "BAD_FORMAT",
      `formatVersion 이 ${PROCEDURE_BUNDLE_FORMAT_VERSION} 이 아닙니다 — 본 것: ${JSON.stringify(root.formatVersion)}. ` +
        "모르는 판은 읽지 않습니다."
    );
  }
  for (const key of ["exportedAt", "exportedFrom", "selection"]) {
    if (typeof root[key] !== "string" || (root[key] as string).length === 0) {
      bad("BAD_FORMAT", `${key} 가 비었거나 글자가 아닙니다.`);
    }
  }
  for (const key of ["templates", "nodes", "edges", "issues"]) {
    if (!Array.isArray(root[key])) bad("BAD_FORMAT", `${key} 가 배열이 아닙니다.`);
  }
  if (blockers.length > 0) return { ok: false, blockers };

  const templates = root.templates as unknown[];
  const nodes = root.nodes as unknown[];
  const edges = root.edges as unknown[];
  const issues = root.issues as unknown[];

  // 🔴 「넣을 것이 없다」를 성공으로 읽지 않는다(위 머리말).
  if (templates.length === 0) {
    bad("EMPTY_BUNDLE", "절차가 한 개도 없습니다 — 뜨는 쪽이 아무것도 못 떠 왔을 때의 모양입니다.");
  }

  const counts = root.counts;
  if (typeof counts !== "object" || counts === null) {
    bad("COUNT_MISMATCH", "counts 가 없습니다 — 파일이 잘렸는지 가릴 수 없습니다.");
  } else {
    const c = counts as Record<string, unknown>;
    const pairs: [string, number, number][] = [
      ["templates", Number(c.templates), templates.length],
      ["nodes", Number(c.nodes), nodes.length],
      ["edges", Number(c.edges), edges.length],
      ["issues", Number(c.issues), issues.length],
    ];
    for (const [key, declared, actual] of pairs) {
      if (declared !== actual) {
        bad("COUNT_MISMATCH", `counts.${key} 는 ${c[key]} 인데 실제 줄은 ${actual} 개입니다 — 파일이 잘렸을 수 있습니다.`);
      }
    }
  }

  templates.forEach((row, index) => checkTemplateRow(row, index, bad));
  nodes.forEach((row, index) => checkNodeRow(row, index, bad));
  edges.forEach((row, index) => checkEdgeRow(row, index, bad));
  issues.forEach((row, index) => checkIssueRow(row, index, bad));

  if (blockers.length > 0) return { ok: false, blockers };
  return { ok: true, bundle: root as unknown as ProcedureBundle };
}

type Reporter = (code: BundleBlockerCode, message: string) => void;

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && !Number.isNaN(Date.parse(value));
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isNullableFiniteNumber(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isFinite(value));
}

function checkTemplateRow(row: unknown, index: number, bad: Reporter): void {
  const where = `templates[${index}]`;
  if (typeof row !== "object" || row === null) return bad("BAD_FORMAT", `${where} 가 객체가 아닙니다.`);
  const t = row as Record<string, unknown>;
  if (!isUuid(t.id)) bad("BAD_FORMAT", `${where}.id 가 UUID 가 아닙니다.`);
  if (typeof t.code !== "string" || t.code.length === 0) bad("BAD_FORMAT", `${where}.code 가 비었습니다.`);
  if (typeof t.name !== "string" || t.name.length === 0) bad("BAD_FORMAT", `${where}.name 이 비었습니다.`);
  if (!PROCEDURE_EQUIPMENT_TYPE_CODES.includes(t.equipmentType as ProcedureEquipmentType)) {
    bad("BAD_FORMAT", `${where}.equipmentType 이 아는 값이 아닙니다 — ${JSON.stringify(t.equipmentType)}`);
  }
  if (!PROCEDURE_TEMPLATE_CATEGORY_CODES.includes(t.category as ProcedureTemplateCategory)) {
    bad("BAD_FORMAT", `${where}.category 가 아는 값이 아닙니다 — ${JSON.stringify(t.category)}`);
  }
  if (!PROCEDURE_TEMPLATE_SOURCE_TYPE_CODES.includes(t.sourceType as ProcedureTemplateSourceType)) {
    bad("BAD_FORMAT", `${where}.sourceType 이 아는 값이 아닙니다 — ${JSON.stringify(t.sourceType)}`);
  }
  if (!isNullableString(t.description)) bad("BAD_FORMAT", `${where}.description 이 글자도 null 도 아닙니다.`);
  if (typeof t.isReferenceOnly !== "boolean") bad("BAD_FORMAT", `${where}.isReferenceOnly 가 불리언이 아닙니다.`);
  if (!Number.isInteger(t.version)) bad("BAD_FORMAT", `${where}.version 이 정수가 아닙니다.`);
  if (!isNullableString(t.sourceFileName)) bad("BAD_FORMAT", `${where}.sourceFileName 이 글자도 null 도 아닙니다.`);
  if (!isNullableString(t.sourceFileHash)) bad("BAD_FORMAT", `${where}.sourceFileHash 가 글자도 null 도 아닙니다.`);
  if (t.supersedesTemplateId !== null && !isUuid(t.supersedesTemplateId)) {
    bad("BAD_FORMAT", `${where}.supersedesTemplateId 가 UUID 도 null 도 아닙니다.`);
  }
  if (!isIsoTimestamp(t.createdAt)) bad("BAD_FORMAT", `${where}.createdAt 를 날짜로 읽을 수 없습니다.`);
  if (!isIsoTimestamp(t.updatedAt)) bad("BAD_FORMAT", `${where}.updatedAt 를 날짜로 읽을 수 없습니다.`);
  // 🔴 상태는 여기서 모양만 본다. 「DRAFT 여야 한다」는 아래 계획 세우기가 멈출
  //    까닭(NOT_DRAFT)으로 따로 낸다 — 파일이 깨진 것과 내용이 다른 것은 다른 일이다.
  if (typeof t.status !== "string") bad("BAD_FORMAT", `${where}.status 가 글자가 아닙니다.`);
  // 🔴 실리면 안 되는 칸이 실려 있으면 **그 자체가 결함**이다. 뜨는 쪽이 바뀌었거나
  //    누가 손으로 더한 것이고, 둘 다 개발 사용자 id 가 운영으로 새는 길이다.
  for (const forbidden of ["createdByUserId", "publishedByUserId", "archivedByUserId", "deletedBy"]) {
    if (forbidden in t) {
      bad("BAD_FORMAT", `${where} 에 ${forbidden} 가 실려 있습니다 — 사용자 칸은 짐에 싣지 않습니다.`);
    }
  }
}

function checkNodeRow(row: unknown, index: number, bad: Reporter): void {
  const where = `nodes[${index}]`;
  if (typeof row !== "object" || row === null) return bad("BAD_FORMAT", `${where} 가 객체가 아닙니다.`);
  const n = row as Record<string, unknown>;
  if (!isUuid(n.id)) bad("BAD_FORMAT", `${where}.id 가 UUID 가 아닙니다.`);
  if (!isUuid(n.procedureTemplateId)) bad("BAD_FORMAT", `${where}.procedureTemplateId 가 UUID 가 아닙니다.`);
  if (typeof n.nodeCode !== "string" || n.nodeCode.length === 0) bad("BAD_FORMAT", `${where}.nodeCode 가 비었습니다.`);
  if (!PROCEDURE_NODE_TYPE_CODES.includes(n.nodeType as ProcedureNodeType)) {
    bad("BAD_FORMAT", `${where}.nodeType 이 아는 값이 아닙니다 — ${JSON.stringify(n.nodeType)}`);
  }
  if (typeof n.title !== "string" || n.title.length === 0) bad("BAD_FORMAT", `${where}.title 이 비었습니다.`);
  for (const key of [
    "description",
    "objective",
    "preparation",
    "toolsAndEquipment",
    "safetyCaution",
    "instructions",
    "expectedNormalResult",
    "ngSymptoms",
    "recommendedCorrectiveAction",
    "acceptanceCriteria",
    "sourceWorksheet",
    "sourceShapeId",
    "sourceCellRange",
  ]) {
    if (!isNullableString(n[key])) bad("BAD_FORMAT", `${where}.${key} 가 글자도 null 도 아닙니다.`);
  }
  if (typeof n.workerMayAddNextTask !== "boolean") bad("BAD_FORMAT", `${where}.workerMayAddNextTask 가 불리언이 아닙니다.`);
  if (typeof n.isActive !== "boolean") bad("BAD_FORMAT", `${where}.isActive 가 불리언이 아닙니다.`);
  if (n.nextProcedureTemplateId !== null && !isUuid(n.nextProcedureTemplateId)) {
    bad("BAD_FORMAT", `${where}.nextProcedureTemplateId 가 UUID 도 null 도 아닙니다.`);
  }
  if (typeof n.positionX !== "number" || !Number.isFinite(n.positionX)) bad("BAD_FORMAT", `${where}.positionX 가 수가 아닙니다.`);
  if (typeof n.positionY !== "number" || !Number.isFinite(n.positionY)) bad("BAD_FORMAT", `${where}.positionY 가 수가 아닙니다.`);
  if (!isNullableFiniteNumber(n.userPositionX)) bad("BAD_FORMAT", `${where}.userPositionX 가 수도 null 도 아닙니다.`);
  if (!isNullableFiniteNumber(n.userPositionY)) bad("BAD_FORMAT", `${where}.userPositionY 가 수도 null 도 아닙니다.`);
  if (!Number.isInteger(n.sortOrder)) bad("BAD_FORMAT", `${where}.sortOrder 가 정수가 아닙니다.`);
  if (!isIsoTimestamp(n.createdAt)) bad("BAD_FORMAT", `${where}.createdAt 를 날짜로 읽을 수 없습니다.`);
  if (!isIsoTimestamp(n.updatedAt)) bad("BAD_FORMAT", `${where}.updatedAt 를 날짜로 읽을 수 없습니다.`);
}

function checkEdgeRow(row: unknown, index: number, bad: Reporter): void {
  const where = `edges[${index}]`;
  if (typeof row !== "object" || row === null) return bad("BAD_FORMAT", `${where} 가 객체가 아닙니다.`);
  const e = row as Record<string, unknown>;
  for (const key of ["id", "procedureTemplateId", "fromNodeId", "toNodeId"]) {
    if (!isUuid(e[key])) bad("BAD_FORMAT", `${where}.${key} 가 UUID 가 아닙니다.`);
  }
  if (!PROCEDURE_BRANCH_TYPE_CODES.includes(e.branchType as ProcedureBranchType)) {
    bad("BAD_FORMAT", `${where}.branchType 이 아는 값이 아닙니다 — ${JSON.stringify(e.branchType)}`);
  }
  if (!isNullableString(e.branchLabel)) bad("BAD_FORMAT", `${where}.branchLabel 이 글자도 null 도 아닙니다.`);
  if (!isNullableString(e.sourceConnectorId)) bad("BAD_FORMAT", `${where}.sourceConnectorId 가 글자도 null 도 아닙니다.`);
  if (!Number.isInteger(e.sortOrder)) bad("BAD_FORMAT", `${where}.sortOrder 가 정수가 아닙니다.`);
  if (e.clonedFromEdgeId !== null && !isUuid(e.clonedFromEdgeId)) {
    bad("BAD_FORMAT", `${where}.clonedFromEdgeId 가 UUID 도 null 도 아닙니다.`);
  }
  if (!("conditionDefinition" in e)) bad("BAD_FORMAT", `${where}.conditionDefinition 칸이 없습니다.`);
  if (e.userRoutePoints !== null && !Array.isArray(e.userRoutePoints)) {
    bad("BAD_FORMAT", `${where}.userRoutePoints 가 배열도 null 도 아닙니다.`);
  }
}

function checkIssueRow(row: unknown, index: number, bad: Reporter): void {
  const where = `issues[${index}]`;
  if (typeof row !== "object" || row === null) return bad("BAD_FORMAT", `${where} 가 객체가 아닙니다.`);
  const i = row as Record<string, unknown>;
  if (!isUuid(i.id)) bad("BAD_FORMAT", `${where}.id 가 UUID 가 아닙니다.`);
  if (!isUuid(i.procedureTemplateId)) bad("BAD_FORMAT", `${where}.procedureTemplateId 가 UUID 가 아닙니다.`);
  if (!PROCEDURE_VALIDATION_SEVERITY_CODES.includes(i.severity as ProcedureValidationSeverity)) {
    bad("BAD_FORMAT", `${where}.severity 가 아는 값이 아닙니다 — ${JSON.stringify(i.severity)}`);
  }
  if (
    !PROCEDURE_VALIDATION_RESOLUTION_STATUS_CODES.includes(
      i.resolutionStatus as ProcedureValidationResolutionStatus
    )
  ) {
    bad("BAD_FORMAT", `${where}.resolutionStatus 가 아는 값이 아닙니다 — ${JSON.stringify(i.resolutionStatus)}`);
  }
  if (typeof i.issueType !== "string" || i.issueType.length === 0) bad("BAD_FORMAT", `${where}.issueType 이 비었습니다.`);
  if (typeof i.message !== "string") bad("BAD_FORMAT", `${where}.message 가 글자가 아닙니다.`);
  if (!isNullableString(i.sourceWorksheet)) bad("BAD_FORMAT", `${where}.sourceWorksheet 이 글자도 null 도 아닙니다.`);
  if (!isNullableString(i.sourceReference)) bad("BAD_FORMAT", `${where}.sourceReference 가 글자도 null 도 아닙니다.`);
  if (!("rawEvidence" in i)) bad("BAD_FORMAT", `${where}.rawEvidence 칸이 없습니다.`);
  if (!isIsoTimestamp(i.createdAt)) bad("BAD_FORMAT", `${where}.createdAt 를 날짜로 읽을 수 없습니다.`);
  if ("resolvedByUserId" in i) {
    bad("BAD_FORMAT", `${where} 에 resolvedByUserId 가 실려 있습니다 — 사용자 칸은 짐에 싣지 않습니다.`);
  }
}

/**
 * ============================================================================
 * 2. 짐이 **스스로 앞뒤가 맞는가** — DB 에 묻지 않고 알 수 있는 것들
 * ============================================================================
 * 운영에 한 글자도 쓰기 전에 여기서 거른다. 🔴 여기서 잡히는 것은 **뜨는 쪽의
 * 결함**이거나 **누가 파일을 손댄 것**이지 운영의 문제가 아니다.
 */
export function checkBundleInternalConsistency(bundle: ProcedureBundle): BundleBlocker[] {
  const blockers: BundleBlocker[] = [];
  const bad = (code: BundleBlockerCode, message: string): void => {
    blockers.push({ code, message });
  };

  const templateIds = new Set<string>();
  for (const template of bundle.templates) {
    if (templateIds.has(template.id)) bad("INTERNAL_INCONSISTENT", `절차 id 가 짐 안에서 겹칩니다 — ${template.id}`);
    templateIds.add(template.id);
  }

  // 🔴 (code, version) 은 DB 의 유일키다(`procedure_templates_code_version_unique`).
  //    짐 안에서 겹치면 **두 번째 줄에서 트랜잭션이 통째로 되돌아간다** — 운영에서
  //    그 꼴을 보기 전에 여기서 말한다.
  const codeVersions = new Set<string>();
  for (const template of bundle.templates) {
    const key = `${template.code}@${template.version}`;
    if (codeVersions.has(key)) {
      bad("INTERNAL_INCONSISTENT", `(code, version) 이 짐 안에서 겹칩니다 — ${template.code} 판 ${template.version}`);
    }
    codeVersions.add(key);
  }

  for (const template of bundle.templates) {
    if (template.supersedesTemplateId !== null && !templateIds.has(template.supersedesTemplateId)) {
      bad(
        "INTERNAL_INCONSISTENT",
        `"${template.name}" 의 supersedes_template_id 가 짐 밖을 가리킵니다 — ${template.supersedesTemplateId}`
      );
    }
  }

  const nodeIds = new Set<string>();
  const nodeCodesPerTemplate = new Set<string>();
  for (const node of bundle.nodes) {
    if (nodeIds.has(node.id)) bad("INTERNAL_INCONSISTENT", `노드 id 가 짐 안에서 겹칩니다 — ${node.id}`);
    nodeIds.add(node.id);
    if (!templateIds.has(node.procedureTemplateId)) {
      bad("INTERNAL_INCONSISTENT", `노드 ${node.nodeCode} 가 짐에 없는 절차를 가리킵니다 — ${node.procedureTemplateId}`);
    }
    const key = `${node.procedureTemplateId}/${node.nodeCode}`;
    if (nodeCodesPerTemplate.has(key)) {
      bad("INTERNAL_INCONSISTENT", `한 절차 안에서 노드 코드가 겹칩니다 — ${key}`);
    }
    nodeCodesPerTemplate.add(key);
    // 🔴 **이어가기는 짐 안을 가리켜야 한다.** 밖을 가리키면 운영에 그 절차가 없고,
    //    비워 두면 사람이 만들어 둔 연결이 조용히 사라진다. 그래서 멈춘다.
    if (node.nextProcedureTemplateId !== null && !templateIds.has(node.nextProcedureTemplateId)) {
      bad(
        "INTERNAL_INCONSISTENT",
        `노드 ${node.nodeCode} 의 이어가기가 짐 밖을 가리킵니다 — ${node.nextProcedureTemplateId}. ` +
          "가리키는 절차까지 함께 떠 오세요."
      );
    }
  }

  const edgeIds = new Set<string>();
  for (const edge of bundle.edges) {
    if (edgeIds.has(edge.id)) bad("INTERNAL_INCONSISTENT", `분기 id 가 짐 안에서 겹칩니다 — ${edge.id}`);
    edgeIds.add(edge.id);
    if (!templateIds.has(edge.procedureTemplateId)) {
      bad("INTERNAL_INCONSISTENT", `분기 ${edge.id} 가 짐에 없는 절차를 가리킵니다 — ${edge.procedureTemplateId}`);
    }
    if (!nodeIds.has(edge.fromNodeId)) bad("INTERNAL_INCONSISTENT", `분기 ${edge.id} 의 from 노드가 짐에 없습니다.`);
    if (!nodeIds.has(edge.toNodeId)) bad("INTERNAL_INCONSISTENT", `분기 ${edge.id} 의 to 노드가 짐에 없습니다.`);
  }
  for (const edge of bundle.edges) {
    if (edge.clonedFromEdgeId !== null && !edgeIds.has(edge.clonedFromEdgeId)) {
      bad("INTERNAL_INCONSISTENT", `분기 ${edge.id} 의 cloned_from_edge_id 가 짐 밖을 가리킵니다.`);
    }
  }

  const issueIds = new Set<string>();
  for (const issue of bundle.issues) {
    if (issueIds.has(issue.id)) bad("INTERNAL_INCONSISTENT", `메모 id 가 짐 안에서 겹칩니다 — ${issue.id}`);
    issueIds.add(issue.id);
    if (!templateIds.has(issue.procedureTemplateId)) {
      bad("INTERNAL_INCONSISTENT", `메모 ${issue.id} 가 짐에 없는 절차를 가리킵니다 — ${issue.procedureTemplateId}`);
    }
  }

  return blockers;
}

/**
 * ============================================================================
 * 3. 운영에서 읽어 온 사실과 맞대어 **넣을 계획**을 세운다
 * ============================================================================
 * 🔴 이 함수도 DB 에 안 붙는다. 넣는 스크립트가 **먼저 읽어서** 여기 넘기고, 여기서
 * 나온 `blockers` 가 하나라도 있으면 **트랜잭션을 열지도 않는다.**
 */
export type ExistingInTarget = {
  /** 짐의 id 가운데 운영에 **이미 있는** 것들. */
  templateIds: readonly string[];
  nodeIds: readonly string[];
  edgeIds: readonly string[];
  issueIds: readonly string[];
  /** 짐의 이름과 **같은 이름**인 운영의 절차들(지워진 것도 포함해서 넘긴다). */
  nameMatches: readonly { id: string; name: string; code: string; status: string; isDeleted: boolean }[];
  /** 짐의 (code, version) 과 겹치는 운영의 줄들. */
  codeVersionMatches: readonly { id: string; code: string; version: number }[];
  /** `--actor` 로 받은 운영 사용자. 못 찾았으면 null. */
  actor: { id: string; name: string } | null;
};

/** 1단계에 넣을 절차 줄. 🔴 사용자 칸과 이어 걸리는 칸이 **여기서 정해진다.** */
export type TemplateInsertRow = {
  id: string;
  code: string;
  name: string;
  equipmentType: ProcedureEquipmentType;
  category: ProcedureTemplateCategory;
  description: string | null;
  /** 🔴 언제나 "DRAFT". 게시는 사람이 운영 화면에서 눈으로 보고 따로 한다. */
  status: "DRAFT";
  isReferenceOnly: boolean;
  version: number;
  sourceType: ProcedureTemplateSourceType;
  sourceFileName: string | null;
  sourceFileHash: string | null;
  /** 🔴 1단계에서는 비운다 — 가리킬 줄이 아직 없을 수 있다. 2단계가 채운다. */
  supersedesTemplateId: null;
  /** 🔴 `--actor` 로 받은 **운영** 사용자. 개발 id 는 여기까지 올 길이 없다. */
  createdByUserId: string;
  createdAt: Date;
  updatedAt: Date;
};

export type NodeInsertRow = Omit<
  BundleNode,
  "nextProcedureTemplateId" | "createdAt" | "updatedAt"
> & {
  /** 🔴 1단계에서는 비운다. 2단계가 채운다. */
  nextProcedureTemplateId: null;
  createdAt: Date;
  updatedAt: Date;
};

export type EdgeInsertRow = Omit<BundleEdge, "clonedFromEdgeId"> & { clonedFromEdgeId: null };

export type IssueInsertRow = Omit<BundleIssue, "createdAt"> & { createdAt: Date };

export type BundleInsertPlan = {
  blockers: BundleBlocker[];
  templateRows: TemplateInsertRow[];
  nodeRows: NodeInsertRow[];
  edgeRows: EdgeInsertRow[];
  issueRows: IssueInsertRow[];
  /** 2단계 — 전부 넣은 뒤에 채운다. */
  deferredTemplateSupersedes: { id: string; supersedesTemplateId: string }[];
  deferredNodeNextProcedure: { id: string; nodeCode: string; nextProcedureTemplateId: string }[];
  deferredEdgeClonedFrom: { id: string; clonedFromEdgeId: string }[];
};

export function planProcedureBundleInsert(input: {
  bundle: ProcedureBundle;
  actorUserId: string;
  existing: ExistingInTarget;
}): BundleInsertPlan {
  const { bundle, actorUserId, existing } = input;
  const blockers: BundleBlocker[] = [...checkBundleInternalConsistency(bundle)];
  const bad = (code: BundleBlockerCode, message: string): void => {
    blockers.push({ code, message });
  };

  /**
   * 🔴 **DRAFT 가 아닌 줄은 넣지 않는다**(2026-11-06 사용자 결정). 게시는 사람이
   * 운영 화면에서 눈으로 보고 따로 한다. 여기서 재는 까닭은, 아래에서 `status:
   * "DRAFT"` 를 **박아 넣기** 때문이다 — 재지 않으면 PUBLISHED 짐을 말없이 DRAFT 로
   * 떨어뜨리고 `published_at` 만 남은 반쪽짜리 줄이 생긴다.
   */
  for (const template of bundle.templates) {
    if (template.status !== "DRAFT") {
      bad("NOT_DRAFT", `"${template.name}" 의 상태가 DRAFT 가 아닙니다 — ${template.status}. 이 도구는 초안만 옮깁니다.`);
    }
  }

  if (!existing.actor) {
    bad(
      "ACTOR_MISSING",
      `--actor 로 받은 사용자 ${actorUserId} 를 운영에서 못 찾았습니다(또는 쓸 수 없는 계정입니다). ` +
        "created_by_user_id 는 NOT NULL 이고 외래키가 걸려 있어 그대로는 한 줄도 못 넣습니다."
    );
  }

  // 🔴 id 충돌 — 하나라도 있으면 멈춘다. 「있는 것만 건너뛴다」로 풀지 않는다:
  //    그러면 반쯤 들어간 절차가 생기고, 어느 쪽이 맞는지 아무도 모르게 된다.
  if (existing.templateIds.length > 0) {
    bad(
      "TEMPLATE_ID_EXISTS",
      `운영에 같은 id 의 절차가 이미 ${existing.templateIds.length}개 있습니다 — ${existing.templateIds.slice(0, 5).join(", ")}` +
        (existing.templateIds.length > 5 ? " …" : "")
    );
  }
  if (existing.nodeIds.length > 0) {
    bad("NODE_ID_EXISTS", `운영에 같은 id 의 노드가 이미 ${existing.nodeIds.length}개 있습니다.`);
  }
  if (existing.edgeIds.length > 0) {
    bad("EDGE_ID_EXISTS", `운영에 같은 id 의 분기가 이미 ${existing.edgeIds.length}개 있습니다.`);
  }
  if (existing.issueIds.length > 0) {
    bad("ISSUE_ID_EXISTS", `운영에 같은 id 의 메모가 이미 ${existing.issueIds.length}개 있습니다.`);
  }

  // 🔴 (code, version) 은 유일키다 — 겹치면 INSERT 가 거절당한다.
  for (const match of existing.codeVersionMatches) {
    bad("CODE_VERSION_EXISTS", `운영에 code "${match.code}" 판 ${match.version} 이 이미 있습니다 (id=${match.id}).`);
  }

  /**
   * 🔴 **이름이 겹치면 지워진 줄이라도 멈춘다.** `name` 에는 유일 제약이 없어서 DB 는
   * 막아 주지 않고, 겹친 채로 들어가면 목록에 같은 이름이 둘 떠서 **사람이 어느 쪽을
   * 열었는지 모른다.** 휴지통에 있는 줄까지 세는 까닭은, 그것이 15일 안에 복원될 수
   * 있어서다 — 복원되는 순간 똑같은 일이 벌어진다.
   */
  for (const match of existing.nameMatches) {
    bad(
      "NAME_EXISTS",
      `운영에 같은 이름의 절차가 이미 있습니다 — "${match.name}" (code=${match.code}, ${match.status}` +
        `${match.isDeleted ? ", 🔴 휴지통에 있음" : ""}, id=${match.id})`
    );
  }

  const templateRows: TemplateInsertRow[] = bundle.templates.map((template) => ({
    id: template.id,
    code: template.code,
    name: template.name,
    equipmentType: template.equipmentType,
    category: template.category,
    description: template.description,
    status: "DRAFT",
    isReferenceOnly: template.isReferenceOnly,
    version: template.version,
    sourceType: template.sourceType,
    sourceFileName: template.sourceFileName,
    sourceFileHash: template.sourceFileHash,
    supersedesTemplateId: null,
    createdByUserId: actorUserId,
    createdAt: new Date(template.createdAt),
    updatedAt: new Date(template.updatedAt),
  }));

  const nodeRows: NodeInsertRow[] = bundle.nodes.map((node) => ({
    ...node,
    nextProcedureTemplateId: null,
    createdAt: new Date(node.createdAt),
    updatedAt: new Date(node.updatedAt),
  }));

  const edgeRows: EdgeInsertRow[] = bundle.edges.map((edge) => ({ ...edge, clonedFromEdgeId: null }));

  const issueRows: IssueInsertRow[] = bundle.issues.map((issue) => ({
    ...issue,
    createdAt: new Date(issue.createdAt),
  }));

  /**
   * 🔴 **나중에 채우는 것들.** `next_procedure_template_id` 는 다른 절차를 가리키고,
   * 그 관계는 **순환한다**((8)→(9)→(8) 가 실제로 있다). 그래서 「가리켜지는 것부터
   * 넣는다」는 차례가 **존재하지 않는다** — 넣는 차례로는 못 푼다. 전부 넣고 나서
   * 같은 트랜잭션 안에서 UPDATE 로 채운다.
   */
  const deferredTemplateSupersedes = bundle.templates
    .filter((t) => t.supersedesTemplateId !== null)
    .map((t) => ({ id: t.id, supersedesTemplateId: t.supersedesTemplateId as string }));
  const deferredNodeNextProcedure = bundle.nodes
    .filter((n) => n.nextProcedureTemplateId !== null)
    .map((n) => ({
      id: n.id,
      nodeCode: n.nodeCode,
      nextProcedureTemplateId: n.nextProcedureTemplateId as string,
    }));
  const deferredEdgeClonedFrom = bundle.edges
    .filter((e) => e.clonedFromEdgeId !== null)
    .map((e) => ({ id: e.id, clonedFromEdgeId: e.clonedFromEdgeId as string }));

  return {
    blockers,
    templateRows,
    nodeRows,
    edgeRows,
    issueRows,
    deferredTemplateSupersedes,
    deferredNodeNextProcedure,
    deferredEdgeClonedFrom,
  };
}

/**
 * 결과 한 줄. 🔴 들여오기 스크립트의 `결과: 만듦 N · …` 와 **같은 결**이다 —
 * 사람이 `tail` 로 잘라 봐도 마지막 줄이 결과를 말해야 한다.
 */
export type BundleApplySummary = {
  templates: number;
  nodes: number;
  edges: number;
  issues: number;
  linkedNextProcedure: number;
  linkedSupersedes: number;
  linkedClonedFrom: number;
};

export function formatBundleApplySummary(summary: BundleApplySummary): string {
  return (
    `결과: 절차 ${summary.templates} · 노드 ${summary.nodes} · 분기 ${summary.edges} · ` +
    `메모 ${summary.issues} · 이어가기 ${summary.linkedNextProcedure} · ` +
    `상위판 ${summary.linkedSupersedes} · 복제원본 ${summary.linkedClonedFrom}`
  );
}

/** 멈출 때 보여 줄 글. 🔴 **무엇을 보고 멈췄는지**가 한 줄씩 다 들어간다. */
export function formatBundleBlockers(blockers: readonly BundleBlocker[]): string {
  return [
    `🔴 넣지 않고 멈췄습니다 — 걸린 것이 ${blockers.length}건입니다 (DB 를 한 글자도 안 바꿨습니다).`,
    ...blockers.map((blocker) => `   [${blocker.code}] ${blocker.message}`),
  ].join("\n");
}
