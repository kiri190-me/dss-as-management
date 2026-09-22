import { CARD_FIELDS, CARD_LISTS, type CardFieldKey, type CardListKey } from "./card-fields";
import {
  KYOSAN_ACTION_MARK_ORIGIN,
  KYOSAN_CAUSE_MARK_ORIGIN,
  KYOSAN_OVERHAUL_RECOMMENDATION_ORIGIN,
  type KyosanImportPlan,
  type KyosanPreviewLine,
} from "./report-preview";
import type { WorkRecordKind } from "@/lib/domain/types";

/**
 * ============================================================================
 * 미리보기 그림 → **수리 건 상세의 제자리 칸** (2026-09-21, 조각 S5)
 * ============================================================================
 * 🔴 **사용자 지시(2026-09-21)**: 「확인내용이나 조치를 보고서에다가 넣지 말고,
 * 상세 페이지 곳곳에 알맞는 칸들이 있을 거야 거기에다가 넣어줘.」 이어서
 * 「보고서 안 만들어도 돼」로 확정했다.
 *
 * 그래서 이 파일이 `report-save-values.ts`(보고서 한 장을 짓던 것)를 대신한다.
 * 그쪽 파일은 **지우지 않고 남겨 두었다** — 되돌릴 수 있어야 하기 때문이다
 * (그 파일 머리말의 「쓰이지 않는다」 칸을 보라).
 *
 * ── 🔴 상세에 「확인내용」·「조치」라는 칸은 없다 ─────────────────────
 * 그 이름은 보고서 작성 화면의 것이다. 상세에서 여러 줄 자유 기술을 받는 자리는
 * 넷뿐이고, 그중 이 통로가 쓰는 것은 둘이다:
 *
 *   신고 증상       `repair_cases.reported_symptom`     단일 값 · 덮어쓰기
 *   작업 기록 본문  `repair_case_work_records.memo`     🔴 덧붙이기 · 생성 후 불변
 *
 * (`notes` · `external_condition_summary` 는 **아예 건드리지 않는다.**)
 *
 * ── 🔴 진짜 자리는 「작업 기록」이다 ─────────────────────────────────
 * 작업 기록의 `record_kind` 가 기본 정보 탭의 요약 칸을 **결정한다**(파생 —
 * `db/queries/repair-case-work-records.ts` 의 `getDerivedServiceSummaryForCase`):
 *
 *   GENERAL                   「일반」          → 작업 이력에만
 *   INTAKE_INSPECTION_RESULT  「인수점검 결과」 → 기본 정보 > 인수점검 결과
 *   DIAGNOSIS_REPAIR_SUMMARY  「진단/조치」     → 기본 정보 > 현재 진단/조치 요약
 *   NEXT_PLANNED_ACTION       「다음 예정 작업」→ 기본 정보 > 다음 예정 작업
 *
 * 🔴 레거시 칸 함정: `repair_cases.intake_inspection_result` ·
 * `current_diagnosis_summary` · `next_planned_action` 은 스키마에 **살아 있지만
 * 화면이 더 이상 읽지 않는다.** 거기에 쓰면 오류 없이 화면에 안 나온다 —
 * 이 파일은 그 셋을 한 번도 가리키지 않는다.
 *
 * ── 대응표 ───────────────────────────────────────────────────────────
 *   고객 고장 상황                         → 신고 증상(🔴 비어 있을 때만)
 *                                            못 넣으면 작업 기록 GENERAL
 *   사내 확인 결과 · 고장 부위 ·           → 작업 기록 INTAKE_INSPECTION_RESULT
 *   불량 현상 상세 · 반품 사유 상세
 *   원인 상세 · 교체 부품 요약             → 작업 기록 DIAGNOSIS_REPAIR_SUMMARY
 *   처치 ○ · 원인 ○                        → 작업 기록 GENERAL(🔴 아래)
 *   비고                                   → 🔴 넣지 않는다(아래)
 *
 * ── 🔴 처치 ○ · 원인 ○ 를 「현재 진단/조치 요약」에서 뺀 까닭 ────────────
 * 사용자 지시(2026-09-22): 「현품인수, 조치 완료 등은 내용으로 넣지 않아도 돼」.
 * 실측이 그것을 뒷받침한다 — 처치 ○ 는 **469장 전부가 `現品引取`** 이고
 * **466장이 `処置完了`** 다. 원인 ○ 도 **88%가 `その他`**(기타)다. 요약 칸에
 * 그것만 뜨면 사람이 「현재 진단/조치」를 보러 와서 정보량 0 인 문장을 읽는다.
 *
 * 🔴 그렇다고 **버리지는 않는다**(`NOT_IMPORTED` 를 쓰지 않는다). 정보량이
 * 적어도 그것은 **이식했다는 사실의 기록**이고, 한 번 버리면 되돌릴 수 없다.
 * `GENERAL` 로 보내면 「작업 이력」 탭에서는 계속 읽히고, 나중에 필요해지면
 * 거기서 찾을 수 있다.
 *
 * 🔴 **비고를 넣지 않는 까닭**(사용자 결정): 실측 469장 중 **0장**에만 값이 있다.
 * 받을 만한 단일 값 칸은 `repair_cases.notes` 뿐인데 그 칸은 사람이 쓰는 자리라
 * 덮으면 안 되고, 0장짜리 항목 때문에 작업 기록을 하나 더 쌓을 이유도 없다.
 * 🔴 값이 들어 있는 드문 한 장이 나와도 **잃지는 않는다** — 연락서 원본 `.xlsm`
 * 이 그대로 첨부로 남고, 미리보기가 그 줄을 「넣지 않음」으로 **표시해서 보여
 * 준다**(preview-view.ts 의 `KYOSAN_DESTINATION_LABEL`). 조용히 사라지지 않는다.
 *
 * ── 🔴 원문을 고치지 않는다 ─────────────────────────────────────────
 * `report-save-values.ts` 와 같은 규율이다 — 일본어 자유 기술은 번역하지도
 * 다듬지도 않고, 어디서 온 줄인지는 **머리글 줄**을 따로 끼워 알린다:
 *
 *     [교산 연락서]              ← 사람이 적은 기록과 구별하는 표시
 *
 *     [사내 확인 결과]           ← 연락서의 항목 이름
 *     不具合内容 …               ← 🔴 연락서 원문 그대로
 *
 * ── 🔴 DB 도 `server-only` 도 모른다 ────────────────────────────────
 * 「무엇이 어느 칸으로 가는가」는 DB 없이 시험이 붙어야 하는 종류의 앎이다.
 * 지금 건에 무엇이 적혀 있는지는 저장 쪽이 **잠금 안에서 읽어** 넘겨준다.
 * ============================================================================
 */

/** 한 줄이 상세의 어느 자리로 가는가. 화면이 이 값을 그대로 이름표로 바꾼다. */
export type KyosanDetailDestination =
  /** `repair_cases.reported_symptom` — 🔴 비어 있을 때만. */
  | "REPORTED_SYMPTOM"
  /** 작업 기록 — 기본 정보의 「인수점검 결과」로 파생된다. */
  | "INTAKE_INSPECTION_RESULT"
  /** 작업 기록 — 기본 정보의 「현재 진단/조치 요약」으로 파생된다. */
  | "DIAGNOSIS_REPAIR_SUMMARY"
  /** 작업 기록 「일반」 — 작업 이력에만 보인다. */
  | "WORK_RECORD_GENERAL"
  /** 🔴 넣지 않는다. 원본 첨부에만 남는다. */
  | "NOT_IMPORTED";

const FIELD_CAPTION = new Map<string, string>(CARD_FIELDS.map((spec) => [spec.key, spec.caption]));
const LIST_CAPTION = new Map<string, string>(CARD_LISTS.map((spec) => [spec.key, spec.caption]));

function fieldCaption(key: CardFieldKey): string {
  return FIELD_CAPTION.get(key) ?? key;
}

function listCaption(key: CardListKey): string {
  return LIST_CAPTION.get(key) ?? key;
}

/** 교체 부품 줄의 머리글. 🔴 `repair_case_used_parts` 와 **둘 다** 간다. */
export const KYOSAN_FAULT_PARTS_ORIGIN = listCaption("faultParts");
export const KYOSAN_PREVENTIVE_PARTS_ORIGIN = listCaption("preventiveParts");

/**
 * 🔴 줄을 가르는 유일한 근거는 `origin`(연락서 항목 이름)이다. 구역
 * (`section`)은 **보고서 양식의 칸 이름**이라 상세에는 짝이 없다 — 그것으로
 * 가르면 「확인 내용」이라는 없는 칸을 가리키게 된다.
 */
const DESTINATION_BY_ORIGIN = new Map<string, KyosanDetailDestination>([
  [listCaption("customerFaults"), "REPORTED_SYMPTOM"],

  [listCaption("internalFindings"), "INTAKE_INSPECTION_RESULT"],
  [listCaption("brokenPoints"), "INTAKE_INSPECTION_RESULT"],
  [fieldCaption("situationDetail"), "INTAKE_INSPECTION_RESULT"],
  [fieldCaption("requirementDetail"), "INTAKE_INSPECTION_RESULT"],

  // 🔴 **요약 칸으로 보내지 않는다** — 정보량이 0 이다(머리말의 실측: 처치 ○ 는
  //    469장 전부 `現品引取`, 466장 `処置完了`, 원인 ○ 는 88%가 `その他`).
  //    그래도 `NOT_IMPORTED` 로 버리지 않고 `WORK_RECORD_GENERAL` 로 남긴다:
  //    **이식했다는 사실의 기록**이고 버리면 되돌릴 수 없으므로, 작업 이력에서
  //    계속 읽히는 쪽을 고른다(사용자 지시 2026-09-22).
  [KYOSAN_ACTION_MARK_ORIGIN, "WORK_RECORD_GENERAL"],
  [KYOSAN_CAUSE_MARK_ORIGIN, "WORK_RECORD_GENERAL"],
  // 🔴 **O/H 로 「권한다」고 적은 줄** — 수량에 넣지 않고 원문만 남긴다
  //    (사용자 결정 2026-09-22: 「건마다 다르다」). 「처치 ○」와 **같은 통로**다.
  //    `NOT_IMPORTED` 로 버리면 연락서가 무엇을 권했는지가 사라진다.
  [KYOSAN_OVERHAUL_RECOMMENDATION_ORIGIN, "WORK_RECORD_GENERAL"],
  // 🔴 469장 중 값이 있는 것이 1장뿐이라 빠뜨리기 쉬운데, 빠뜨리면 그 한 장의
  //    내용이 **아무 칸에도 안 들어간다.** 보기(○)와 달리 이것은 사람이 손으로
  //    적은 자유 기술이라 정보량이 있다 — 요약 칸에 남긴다.
  [fieldCaption("causeDetail"), "DIAGNOSIS_REPAIR_SUMMARY"],

  // 🔴 머리말의 「비고를 넣지 않는 까닭」.
  [fieldCaption("notes"), "NOT_IMPORTED"],
]);

/**
 * 줄 하나가 어디로 가는가. 🔴 모르는 항목은 **버리지 않고** 「일반」 작업
 * 기록으로 보낸다 — 연락서 양식에 항목이 하나 늘었을 때 조용히 사라지는 쪽보다
 * 작업 이력에 남는 쪽이 낫다.
 */
export function kyosanLineDestination(line: KyosanPreviewLine): KyosanDetailDestination {
  return DESTINATION_BY_ORIGIN.get(line.origin) ?? "WORK_RECORD_GENERAL";
}

/** 교체 부품 줄은 언제나 「진단/조치」 기록으로 요약된다(사용 부품 칸과 둘 다). */
export function kyosanPartDestination(): KyosanDetailDestination {
  return "DIAGNOSIS_REPAIR_SUMMARY";
}

// ─────────────────────────────────────────────── 글자 짓기

/** 사람이 적은 기록과 구별하는 표시. 대괄호는 연락서 원문에 나오지 않는 글자다. */
export const KYOSAN_IMPORT_MARK = "[교산 연락서]";

/** 머리글 줄. `report-save-values.ts` 의 `kyosanOriginHeading` 과 같은 모양이다. */
export function kyosanOriginHeading(origin: string): string {
  return `[${origin}]`;
}

/**
 * 🔴 `repair_case_work_records.memo` 의 상한이다
 * (`validation/repair-case-work-record-input.ts` 의 `MAX_MEMO_LENGTH`). 같은 값을
 * 두 벌 적는 것은 이 저장소의 규약이다(그 파일 주석) — 다만 **넘으면 어떻게 할
 * 것인가**는 여기서 정한다.
 */
export const KYOSAN_MEMO_LIMIT = 4000;

/**
 * 🔴 `repair_cases.reported_symptom` 의 상한. `validation/repair-case-input.ts`
 * 의 `MAX_LONG_TEXT` 와 같은 값이다.
 */
export const KYOSAN_REPORTED_SYMPTOM_LIMIT = 4000;

/**
 * 머리글이 차지할 자리. 이어짐 표시(`[교산 연락서] (10/10) 이어짐`)까지 넉넉히
 * 잡는다 — 조각을 나눈 뒤에야 전체 수를 알 수 있어서, 먼저 자리를 비워 둔다.
 */
const HEADER_RESERVE = 48;

type OriginGroup = { origin: string; texts: string[] };

/** 같은 `origin` 이 이어지는 동안 머리글을 한 번만 끼운다(미리보기의 차례 그대로). */
function groupByOrigin(entries: readonly { origin: string; text: string }[]): OriginGroup[] {
  const groups: OriginGroup[] = [];
  for (const entry of entries) {
    const last = groups[groups.length - 1];
    if (last !== undefined && last.origin === entry.origin) last.texts.push(entry.text);
    else groups.push({ origin: entry.origin, texts: [entry.text] });
  }
  return groups;
}

/** 머리글 줄과 내용 줄을 늘어놓는다(맨 앞의 `[교산 연락서]` 는 아직 붙이지 않는다). */
function bodyLines(groups: readonly OriginGroup[]): string[] {
  const out: string[] = [];
  for (const group of groups) {
    if (out.length > 0) out.push("");
    out.push(kyosanOriginHeading(group.origin));
    out.push(...group.texts);
  }
  return out;
}

/**
 * 🔴 **말없이 자르지 않는다.** 4000자를 넘으면 조각으로 나누고, 조각마다 몇
 * 번째인지 적는다. 잃는 글자가 한 자도 없다.
 *
 * ── 🔴 왜 조각 둘째부터는 「일반」인가 ───────────────────────────────
 * 기본 정보의 요약 칸은 그 종류의 **가장 최근 한 줄**만 읽는다
 * (`getDerivedServiceSummaryForCase` 의 DISTINCT ON). 그런데 한 트랜잭션에서
 * 넣은 행들은 `created_at` 이 **전부 같다**(Postgres 의 `now()` 는 트랜잭션 시작
 * 시각이다). 같은 종류로 두 줄을 넣으면 둘 중 어느 것이 요약 칸에 뜰지 **id 의
 * 임의 순서**가 정한다 — 뽑기가 된다. 그래서 종류를 단 조각은 **언제나 하나**로
 * 두고, 넘치는 뒷조각은 요약에 끼어들지 않는 GENERAL 로 보낸다. 요약 칸은
 * 첫 조각을 확정적으로 보여 주고, 나머지는 작업 이력에서 이어 읽는다.
 */
function splitMemo(kind: WorkRecordKind, groups: readonly OriginGroup[]): KyosanWorkRecordDraft[] {
  const body = bodyLines(groups);
  if (body.length === 0) return [];

  const whole = `${KYOSAN_IMPORT_MARK}\n\n${body.join("\n")}`;
  if (whole.length <= KYOSAN_MEMO_LIMIT) return [{ recordKind: kind, memo: whole }];

  const room = KYOSAN_MEMO_LIMIT - HEADER_RESERVE;
  const chunks: string[][] = [];
  let current: string[] = [];
  let used = 0;

  const place = (line: string): void => {
    const cost = current.length === 0 ? line.length : line.length + 1;
    if (current.length > 0 && used + cost > room) {
      chunks.push(current);
      current = [line];
      used = line.length;
      return;
    }
    current.push(line);
    used += cost;
  };

  for (const line of body) {
    // 🔴 한 줄만으로 방 하나를 넘기면 그 줄 자체를 글자 수로 쪼갠다. 버리지 않는다.
    if (line.length <= room) {
      place(line);
      continue;
    }
    for (let at = 0; at < line.length; at += room) place(line.slice(at, at + room));
  }
  if (current.length > 0) chunks.push(current);

  return chunks.map((lines, index) => {
    const mark =
      index === 0
        ? `${KYOSAN_IMPORT_MARK} (1/${chunks.length})`
        : `${KYOSAN_IMPORT_MARK} (${index + 1}/${chunks.length}) 이어짐`;
    return {
      // 🔴 종류를 단 조각은 첫 조각 하나뿐이다(위 머리말).
      recordKind: index === 0 ? kind : "GENERAL",
      memo: `${mark}\n\n${lines.join("\n")}`,
    };
  });
}

// ─────────────────────────────────────────────── 결과

export type KyosanWorkRecordDraft = {
  recordKind: WorkRecordKind;
  /** 🔴 이미 4000자 안으로 맞춰져 있다. 부르는 쪽이 자르지 않는다. */
  memo: string;
};

export type KyosanDetailValues = {
  /**
   * 🔴 `repair_cases.reported_symptom` 에 **새로 쓸 글자**. `null` 이면 쓰지
   * 않는다 — 이미 값이 있거나, 연락서에 고객 고장 상황이 없거나, 너무 길어
   * 작업 기록으로 보냈다는 뜻이다.
   */
  reportedSymptom: string | null;
  /** 넣을 차례 그대로의 작업 기록들. 비어 있을 수 있다. */
  workRecords: readonly KyosanWorkRecordDraft[];
  /** 신고 증상 칸을 못 써서 작업 기록으로 돌린 까닭. 없으면 `null`. */
  symptomDivertedReason: "이미 값이 있음" | "4000자를 넘음" | null;
  /** 길이 때문에 조각으로 나눈 기록이 있는가 — 사람에게 알린다. */
  didSplitForLength: boolean;
  /** 🔴 넣지 않은 연락서 항목 **이름**들. 값은 담지 않는다. */
  skippedOrigins: readonly string[];
};

/**
 * 상세 칸에 넣을 값 한 벌을 만든다.
 *
 * `currentReportedSymptom` 은 🔴 **잠금 안에서 방금 읽은** 지금 값이다. 미리보기
 * 때 읽은 값을 쓰면 그 사이에 사람이 적은 글자를 덮을 수 있다.
 */
export function buildKyosanDetailValues(input: {
  plan: KyosanImportPlan;
  currentReportedSymptom: string | null;
}): KyosanDetailValues {
  const byDestination = new Map<KyosanDetailDestination, { origin: string; text: string }[]>();
  const skippedOrigins: string[] = [];

  for (const line of input.plan.lines) {
    const destination = kyosanLineDestination(line);
    if (destination === "NOT_IMPORTED") {
      if (!skippedOrigins.includes(line.origin)) skippedOrigins.push(line.origin);
      continue;
    }
    const bucket = byDestination.get(destination) ?? [];
    bucket.push({ origin: line.origin, text: line.text });
    byDestination.set(destination, bucket);
  }

  // 교체 부품 요약 — `repair_case_used_parts` 와 **둘 다** 간다(요약을 읽는
  // 사람이 「무엇을 갈았나」를 진단/조치 칸에서 바로 볼 수 있어야 한다).
  const partsDestination = kyosanPartDestination();
  const partsBucket = byDestination.get(partsDestination) ?? [];
  for (const kind of ["fault", "preventive"] as const) {
    const origin = kind === "fault" ? KYOSAN_FAULT_PARTS_ORIGIN : KYOSAN_PREVENTIVE_PARTS_ORIGIN;
    for (const part of input.plan.parts) {
      if (part.kind === kind) partsBucket.push({ origin, text: part.text });
    }
  }
  if (partsBucket.length > 0) byDestination.set(partsDestination, partsBucket);

  // ── 신고 증상 — 🔴 비어 있을 때만 쓴다 ──
  const symptomEntries = byDestination.get("REPORTED_SYMPTOM") ?? [];
  const symptomText =
    symptomEntries.length === 0
      ? null
      : `${KYOSAN_IMPORT_MARK}\n\n${symptomEntries.map((entry) => entry.text).join("\n")}`;
  const occupied = (input.currentReportedSymptom ?? "").trim() !== "";

  let reportedSymptom: string | null = null;
  let symptomDivertedReason: KyosanDetailValues["symptomDivertedReason"] = null;
  if (symptomText !== null) {
    if (occupied) symptomDivertedReason = "이미 값이 있음";
    else if (symptomText.length > KYOSAN_REPORTED_SYMPTOM_LIMIT) symptomDivertedReason = "4000자를 넘음";
    else reportedSymptom = symptomText;
  }

  // 🔴 칸에 못 넣은 고객 고장 상황은 **잃지 않는다** — 작업 기록으로 간다.
  //    종류는 GENERAL 이다: 고객이 말한 증상을 「인수점검 결과」로 이름 붙이면
  //    우리가 점검해서 찾아낸 것이 되어 사실과 달라진다.
  const generalEntries = [...(byDestination.get("WORK_RECORD_GENERAL") ?? [])];
  if (symptomDivertedReason !== null) generalEntries.unshift(...symptomEntries);

  const drafts: KyosanWorkRecordDraft[] = [
    ...splitMemo("GENERAL", groupByOrigin(generalEntries)),
    ...splitMemo("INTAKE_INSPECTION_RESULT", groupByOrigin(byDestination.get("INTAKE_INSPECTION_RESULT") ?? [])),
    ...splitMemo("DIAGNOSIS_REPAIR_SUMMARY", groupByOrigin(byDestination.get("DIAGNOSIS_REPAIR_SUMMARY") ?? [])),
  ];

  return {
    reportedSymptom,
    workRecords: drafts,
    symptomDivertedReason,
    didSplitForLength: drafts.some((draft) => draft.memo.startsWith(`${KYOSAN_IMPORT_MARK} (`)),
    skippedOrigins,
  };
}
