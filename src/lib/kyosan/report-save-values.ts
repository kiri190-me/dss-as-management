import { mapKyosanCauses } from "./report-causes";
import type { KyosanImportPlan, KyosanPreviewSection } from "./report-preview";
import type { CardFields } from "./card-fields";
import type { ServiceReportSaveValues } from "@/lib/validation/service-report-save-input";

/**
 * ============================================================================
 * 🔴 **지금은 쓰이지 않는다** (2026-09-21, 조각 S5)
 * ============================================================================
 * 사용자 결정으로 **연락서 이식이 보고서를 만들지 않게** 되었다:
 *
 *   「확인내용이나 조치를 보고서에다가 넣지 말고, 상세 페이지 곳곳에 알맞는
 *    칸들이 있을 거야 거기에다가 넣어줘.」 … 「보고서 안 만들어도 돼」
 *
 * 이식이 쓰는 것은 이제 **`report-detail-values.ts`** 다(신고 증상 · 작업 기록).
 * 이 파일을 부르는 곳은 자기 시험(`report-save-values.test.ts`) 하나뿐이다.
 *
 * 🔴 **그래도 지우지 않는다.** 되돌릴 수 있어야 하기 때문이다 — 「연락서로
 * 서비스 보고서 한 장을 만든다」는 판단은 사용자가 다시 뒤집을 수 있는 종류이고,
 * 그때 이 함수가 남아 있으면 부르는 줄 하나로 돌아온다. 469장을 읽어 「무엇이
 * 어느 보고서 칸에 들어가는가」를 정한 실측이 이 파일에 들어 있어, 지우면 그
 * 실측을 다시 해야 한다. 시험도 함께 남긴다 — 돌아왔을 때 맞는지 물을 수
 * 있어야 한다.
 *
 * ⚠️ 새 기능을 여기에 얹지 말 것. 상세 칸으로 가는 길은 위 새 파일이다.
 * ============================================================================
 *
 * ============================================================================
 * 미리보기 그림 → 보고서 한 장의 저장값 (2026-09-21, 조각 S3b)
 * ============================================================================
 * `report-preview.ts` 가 만든 `KyosanImportPlan` 을 `createServiceReport` 가
 * 받는 모양(`ServiceReportSaveValues`)으로 옮긴다. **DB 도 `server-only` 도
 * 모르는 순수 함수**다 — 「무엇이 어느 칸으로 가는가」는 DB 없이 시험이 붙어야
 * 하는 종류의 앎이다(`validation/service-report-save-input.ts` 머리말과 같은
 * 판단).
 *
 * ── 🔴 미리보기가 보여 준 것과 **같은 것**이 들어간다 ────────────────
 * 줄도 부품도 원인도 전부 `plan` 에서만 온다. 여기서 연락서를 다시 읽지
 * 않는다 — 다시 읽으면 「사람이 본 그림」과 「실제로 들어간 것」이 갈라질 길이
 * 생긴다. `card` 를 함께 받는 것은 **머리 칸**(고객사 · 모델 · S/N · 날짜)
 * 때문뿐이고, 그 칸들은 미리보기가 다루지 않는다.
 *
 * ── 🔴 원문을 고치지 않는다 ──────────────────────────────────────────
 * 일본어 자유 기술은 번역하지도 다듬지도 않는다(사용자 결정 1). 대신 어디서 온
 * 줄인지 알 수 있도록 **머리글 줄**을 따로 끼운다:
 *
 *     [고객 고장 상황]          ← 이 파일이 만든 머리글
 *     불具合内容 …               ← 🔴 연락서 원문 그대로
 *
 * 줄 앞에 라벨을 붙이는 방식(`고객 고장 상황: …`)을 일부러 피했다 — 그러면
 * **모든 줄이 원문이 아니게 된다.** 머리글을 따로 두면 내용 줄은 한 글자도
 * 달라지지 않고, 사람이 보고서를 열었을 때 근거가 그대로 읽힌다.
 *
 * ── 🔴 지어내지 않는다 ───────────────────────────────────────────────
 * 연락서에서 읽지 못한 칸은 **비워 둔다.** 특히 숫자 칸(제조 년월 · 사용 년수)은
 * 연락서가 `11年3ヶ月` 같은 자유 글자로 적어 두는 자리라 그대로 넣으면 저장이
 * VALIDATION_ERROR 로 막힌다. 날짜도 `YYYY-MM-DD` 꼴일 때만 싣는다.
 *
 * ── 🔴 「처치」 ○ 는 체크칸으로 옮기지 않는다 ────────────────────────
 * 연락서의 `処置` 보기 넷(`現地修理`·`現品引取`·`代品納入`·`処置完了`)은 우리
 * 양식의 조치 체크칸 넷과 같은 자리로 **보인다.** 그래도 이번 조각에서는
 * 체크하지 않고 ACTIONS 줄로만 남긴다 — 그 넷은 체크가 찍히면 문서에 「조치
 * 완료」로 나가는 칸이고, 짝이 맞는지는 실측으로 확인된 바가 없다. 잘못 찍으면
 * 고객사로 나가는 문서가 사실과 달라진다. 줄로 남겨 두면 사람이 보고 고른다.
 * (S4 화면에서 사람이 고르게 하는 쪽이 맞다고 보인다 — 보고에 적어 둔다.)
 * ============================================================================
 */

/** `"YYYY-MM-DD"` 이고 실제 달력에 있는 날인가. 저장 쪽 검사와 같은 규칙이다. */
function calendarDateOrEmpty(value: string | null): string {
  if (value === null || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return "";
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  const same =
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  return same ? value : "";
}

function textOrEmpty(value: string | null): string {
  return value ?? "";
}

/** 머리글 줄. 대괄호는 연락서 원문에 나오지 않는 글자라 내용과 섞이지 않는다. */
export function kyosanOriginHeading(origin: string): string {
  return `[${origin}]`;
}

/**
 * 한 구역의 줄들을 여러 줄 글자 하나로 잇는다. 같은 `origin` 이 이어지는 동안은
 * 머리글을 한 번만 끼운다 — 미리보기의 차례가 곧 이 차례다.
 */
function joinSection(
  lines: readonly { section: KyosanPreviewSection; text: string; origin: string }[],
  section: KyosanPreviewSection
): string[] {
  const out: string[] = [];
  let lastOrigin: string | null = null;
  for (const line of lines) {
    if (line.section !== section) continue;
    if (line.origin !== lastOrigin) {
      if (out.length > 0) out.push("");
      out.push(kyosanOriginHeading(line.origin));
      lastOrigin = line.origin;
    }
    out.push(line.text);
  }
  return out;
}

/** 교체 부품 줄 — 고장분 · 예방분. 🔴 `repair_case_used_parts` 와 **둘 다** 간다. */
export const KYOSAN_FAULT_PARTS_HEADING = "교체 부품(고장)";
export const KYOSAN_PREVENTIVE_PARTS_HEADING = "교체 부품(예방)";

function partLines(parts: KyosanImportPlan["parts"]): string[] {
  const out: string[] = [];
  for (const [kind, heading] of [
    ["fault", KYOSAN_FAULT_PARTS_HEADING],
    ["preventive", KYOSAN_PREVENTIVE_PARTS_HEADING],
  ] as const) {
    const picked = parts.filter((part) => part.kind === kind);
    if (picked.length === 0) continue;
    if (out.length > 0) out.push("");
    out.push(kyosanOriginHeading(heading));
    for (const part of picked) out.push(part.text);
  }
  return out;
}

export type KyosanServiceReportValuesResult = {
  values: ServiceReportSaveValues;
  /** 사전에 없어 「기타」로 들어간 원인 보기 글자들(`report-causes.ts`). */
  unmappedCauseMarks: readonly string[];
  /** 발행일을 어디서 가져왔는가. 화면·보고가 사람에게 알려 준다. */
  issuedOnOrigin: "기입일" | "수리 완료일" | "조사 완료일" | "오늘";
};

/**
 * 저장값 한 벌을 만든다.
 *
 * `today` 는 연락서에서 날짜를 하나도 읽지 못했을 때 쓰는 발행일이다
 * (`issued_on` 은 NOT NULL 이라 비울 수 없다). 서버가 `toKstDateOnly(new Date())`
 * 로 만든 값을 넘긴다 — 이 파일이 `new Date()` 를 부르지 않는 까닭은 시험이
 * 오늘 날짜에 흔들리지 않게 하기 위해서다.
 */
export function buildKyosanServiceReportValues(input: {
  plan: KyosanImportPlan;
  card: CardFields;
  causeMarks: readonly string[];
  today: string;
}): KyosanServiceReportValuesResult {
  const { plan, card } = input;
  const fields = card.fields;

  const filled = calendarDateOrEmpty(fields.filledDate.value);
  const repairEnd = calendarDateOrEmpty(fields.repairEndDate.value);
  const investigationEnd = calendarDateOrEmpty(fields.investigationEndDate.value);
  const issued = filled || repairEnd || investigationEnd || input.today;
  const issuedOnOrigin: KyosanServiceReportValuesResult["issuedOnOrigin"] =
    filled !== "" ? "기입일" : repairEnd !== "" ? "수리 완료일" : investigationEnd !== "" ? "조사 완료일" : "오늘";

  const cause = mapKyosanCauses(input.causeMarks);

  const actions = [...joinSection(plan.lines, "ACTIONS")];
  const parts = partLines(plan.parts);
  if (parts.length > 0) {
    if (actions.length > 0) actions.push("");
    actions.push(...parts);
  }

  const values: ServiceReportSaveValues = {
    // 연락서는 수리 연락서다. 검사 보고서에는 「정리」·「조치 완료」 구역이 없다.
    kind: "REPAIR",

    // ── 머리 ──
    customerName: textOrEmpty(fields.customer.value),
    issuedOn: issued,
    // 🔴 문서번호는 지어내지 않는다. 연락서의 `修理報告書番号` 는 교산 쪽 번호라
    //    우리 발행번호 자리에 넣으면 우리가 발행한 척이 된다 — 사람이 적는다.
    reportNumberPrefix: "",
    reportNumberMiddle: "",
    reportNumberTail: "",
    customer: textOrEmpty(fields.customerContact.value),
    receivedOn: calendarDateOrEmpty(fields.receivedDate.value),
    occurrencePlace: "",
    occurrencePlaceDetail: "",
    // 날짜도 글자도 비어 있으므로 저장 쪽에서 mode 가 NULL 이 된다 —
    // 「발생 년월일을 아예 안 적음」이다(service-report-save-input.ts).
    occurredOnMode: "DATE",
    occurredOnDate: "",
    occurredOnText: "",
    productName: "",
    productCategory: "",
    modelName: textOrEmpty(fields.model.value),
    // 🔴 제조 년월 · 사용 년수는 연락서가 자유 글자로 적는 자리다. 숫자가
    //    아니면 저장이 막히므로 아예 싣지 않는다(위 '지어내지 않는다').
    manufacturedYear: "",
    manufacturedMonth: "",
    lotNumber: textOrEmpty(fields.lotNumber.value),
    serialNumber: textOrEmpty(fields.serialNumber.value),
    usedYears: "",
    usedMonths: "",
    // 「상황」 두 칸은 본문 줄로 이미 간다(미리보기의 FINDINGS) — 두 번 싣지 않는다.
    situationRequest: "",
    situationDetail: "",

    // ── 조치·원인 ──
    // 🔴 위 머리말의 '「처치」 ○ 는 체크칸으로 옮기지 않는다'.
    onSiteRepair: false,
    replacementDelivery: false,
    goodsReceiptChecked: false,
    goodsReceiptOn: "",
    goodsReceiptNumber: "",
    completionChecked: false,
    completionOn: "",
    repairNumber: "",
    causes: cause.causes,

    // ── 본문 ──
    // `null` = 「안 줌」 — 채우개가 정형 문구를 넣는다. 사람이 일부러 지운
    // 빈 글자(`''`)와 다른 값이다(service-report-save-input.ts).
    findingsIntro: null,
    findings: joinSection(plan.lines, "FINDINGS").join("\n"),
    actions: actions.join("\n"),
    summary: joinSection(plan.lines, "SUMMARY").join("\n"),

    remark: joinSection(plan.lines, "REMARK").join("\n"),
  };

  return { values, unmappedCauseMarks: cause.unmapped, issuedOnOrigin };
}
