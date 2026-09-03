import type {
  ServiceReportFormValues,
  ServiceReportOccurredOnMode,
} from "@/lib/domain/service-report-form";
import type { ServiceReportCause, ServiceReportKind } from "@/lib/xlsx/service-report-template";

/**
 * ============================================================================
 * 저장 서버 액션이 받은 것을 믿을 수 있는 폼 값으로 — 경계에서 한 번만
 * ============================================================================
 * 서버 액션의 인자는 **브라우저에서 온 JSON** 이다. 타입 선언은 컴파일에서
 * 지워지므로, `values: ServiceReportFormValues` 라고 적어 두어도 실제로 오는 것이
 * 그 모양이라는 보장은 하나도 없다. 그대로 흘려보내면:
 *
 *   · `kind: "무엇이든"` → Postgres 의 enum 이 22P02 로 튕기고, 사람은 "일시적으로
 *     저장할 수 없습니다"라는 엉뚱한 말을 본다.
 *   · `findings: 123`   → `serviceReportLines(text)` 가 `text.replace` 를 부르다
 *     TypeError 로 죽는다(500).
 *
 * 그래서 **액션에 들어오는 자리에서 한 번** 걸러 낸다. `weekly-report-goals` 액션이
 * `fields: Record<string, unknown>` 를 받아 `validateWeeklyReportGoalFields` 에
 * 넘기는 것과 같은 자리, 같은 순서다.
 *
 * ── 🔴 없는 칸을 지어내지 않는다(임시보관과 반대다) ────────────────────
 * `domain/service-report-draft.ts` 는 모양이 틀린 칸을 **자동 채움 값으로
 * 떨어뜨린다** — 되살리기는 "화면이 죽지 않는 것"이 먼저이기 때문이다. 여기는
 * 반대다. 저장은 **고객사로 나가는 문서를 남기는 일**이라, 사람이 보낸 적 없는
 * 값을 서버가 채워 넣으면 그 사람이 확인하지 않은 문장이 저장되고 다음 사람이
 * 그것을 그대로 뽑아 간다. 그래서 모자라거나 틀린 칸은 **거절**한다.
 *
 * 실제로 이 거절을 보는 것은 브라우저가 아닌 다른 것이 부를 때뿐이다(화면은 늘
 * 온전한 폼 값을 보낸다). 그래도 칸 이름을 담아 돌려주는 까닭은, 폼에 칸이 하나
 * 늘었는데 여기를 안 고친 날 그 사실이 **조용한 데이터 손실이 아니라 오류**로
 * 드러나게 하기 위해서다.
 *
 * ── 🔴 다듬지 않는다 ────────────────────────────────────────────────────
 * 어느 글자 칸도 `trim()` 하지 않는다 — 「상황」의 앞 공백은 글머리표이고 본문의
 * 들여쓰기는 사람이 뜻을 담아 넣은 것이다(`validation/service-report-save-input.ts`
 * 의 같은 항목). 이 파일은 **모양만** 본다. 값의 규칙(날짜 모양·숫자 칸)은 그
 * 사전이 이미 본다.
 * ============================================================================
 */

export type ServiceReportActionInputResult =
  | { ok: true; values: ServiceReportFormValues }
  | { ok: false; fieldErrors: Record<string, string> };

const SHAPE_ERROR = "값의 모양이 올바르지 않습니다.";

/** 글자 칸. 폼이 언제나 글자를 보내므로, 글자가 아니면 화면에서 온 것이 아니다. */
const TEXT_FIELDS = [
  "customerName",
  "issuedOn",
  "reportNumberPrefix",
  "reportNumberMiddle",
  "reportNumberTail",
  "customer",
  "receivedOn",
  "occurrencePlace",
  "occurrencePlaceDetail",
  "occurredOnDate",
  "occurredOnText",
  "productName",
  "productCategory",
  "modelName",
  "manufacturedYear",
  "manufacturedMonth",
  "lotNumber",
  "serialNumber",
  "usedYears",
  "usedMonths",
  "situationRequest",
  "situationDetail",
  "goodsReceiptOn",
  "goodsReceiptNumber",
  "completionOn",
  "repairNumber",
  "findingsIntro",
  "findings",
  "actions",
  "summary",
  "remark",
] as const satisfies readonly (keyof ServiceReportFormValues)[];

/** 체크 칸. */
const FLAG_FIELDS = [
  "onSiteRepair",
  "replacementDelivery",
  "goodsReceiptChecked",
  "completionChecked",
] as const satisfies readonly (keyof ServiceReportFormValues)[];

const KINDS: Record<ServiceReportKind, true> = { REPAIR: true, INSPECTION: true };
const OCCURRED_ON_MODES: Record<ServiceReportOccurredOnMode, true> = { DATE: true, TEXT: true };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 받은 것을 폼 값으로. 하나라도 모양이 틀리면 **아무것도 저장하지 않는다.**
 *
 * 🔴 인정할 원인 코드를 **인자로 받는다.** 열 가지 목록을 여기 베껴 두면 양식에
 * 원인이 하나 늘어난 날 이 파일만 뒤처지고, 그 증상은 "체크가 조용히 사라진다"이다
 * (`domain/service-report-draft.ts` 의 `pickCauses` 와 같은 규칙). 부르는 쪽은
 * 서버라 채우개의 `SERVICE_REPORT_CAUSES` 를 그대로 넘길 수 있다.
 */
export function readServiceReportActionValues(
  raw: unknown,
  causeCodes: readonly string[]
): ServiceReportActionInputResult {
  if (!isRecord(raw)) {
    return { ok: false, fieldErrors: { values: "보고서 내용을 읽을 수 없습니다." } };
  }

  const fieldErrors: Record<string, string> = {};
  // 칸을 하나씩 담는다. 아래에서 전부 채운 뒤에만 폼 값으로 못 박는다 — 도중에
  // 부분적으로 채워진 것을 내보내면 그것이 곧 "서버가 지어낸 값"이 된다.
  const picked: Record<string, unknown> = {};

  for (const field of TEXT_FIELDS) {
    const value = raw[field];
    if (typeof value !== "string") {
      fieldErrors[field] = SHAPE_ERROR;
      continue;
    }
    picked[field] = value;
  }

  for (const field of FLAG_FIELDS) {
    const value = raw[field];
    if (typeof value !== "boolean") {
      fieldErrors[field] = SHAPE_ERROR;
      continue;
    }
    picked[field] = value;
  }

  if (typeof raw.kind !== "string" || !Object.prototype.hasOwnProperty.call(KINDS, raw.kind)) {
    fieldErrors.kind = "보고서 종류를 확인할 수 없습니다.";
  } else {
    picked.kind = raw.kind;
  }

  if (
    typeof raw.occurredOnMode !== "string" ||
    !Object.prototype.hasOwnProperty.call(OCCURRED_ON_MODES, raw.occurredOnMode)
  ) {
    fieldErrors.occurredOnMode = "발생 년월일 입력 방식을 확인할 수 없습니다.";
  } else {
    picked.occurredOnMode = raw.occurredOnMode;
  }

  picked.causes = readCauses(raw.causes, causeCodes, fieldErrors);

  if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors };

  return { ok: true, values: picked as unknown as ServiceReportFormValues };
}

/**
 * 고른 원인.
 *
 * 🔴 **모르는 코드는 조용히 버리지 않고 거절한다.** 임시보관 되살리기는 걸러
 * 냈지만(그쪽은 옛 브라우저에 남은 값을 상대한다), 저장은 사람이 방금 체크한
 * 것을 담는 일이라 한 칸이 말없이 빠지면 **원인이 하나 적힌 보고서**가 고객사로
 * 나간다.
 *
 * 중복은 거절하지 않는다 — 체크는 하나뿐이라 두 행은 뜻이 없고, 사전이 이미
 * 하나로 접는다(`dedupeCauses`).
 */
function readCauses(
  value: unknown,
  causeCodes: readonly string[],
  fieldErrors: Record<string, string>
): readonly ServiceReportCause[] {
  if (!Array.isArray(value)) {
    fieldErrors.causes = SHAPE_ERROR;
    return [];
  }

  const allowed = new Set(causeCodes);
  const picked: ServiceReportCause[] = [];
  for (const item of value) {
    if (typeof item !== "string" || !allowed.has(item)) {
      fieldErrors.causes = "고른 원인 중에 알 수 없는 값이 있습니다.";
      return [];
    }
    picked.push(item as ServiceReportCause);
  }
  return picked;
}

/**
 * ============================================================================
 * 삭제 사유 — 지우기 확인 창의 「삭제 사유 (선택)」 칸
 * ============================================================================
 * 폼 값과 같은 파일에 두는 까닭은 이 모듈이 **액션에 들어오는 값을 읽는 일**을
 * 맡고 있기 때문이고, 액션 파일에 두지 못하는 까닭은 그쪽이 `"use server"` 라
 * **내보내는 것이 전부 async 함수여야** 하기 때문이다(그 파일의
 * `validateReportIdentity` 주석). 순수 함수라 시험이 붙는다.
 *
 * 🔴 **여기서는 다듬는다** — 이 파일 머리말의 '다듬지 않는다'와 어긋나 보이지만
 * 다른 종류의 값이다. 폼 값은 고객사로 나가는 문서의 본문이라 앞 공백이
 * 글머리표이고 빈 줄이 문단 나누기지만, 삭제 사유는 **왜 지웠는지를 표에 남기는
 * 한 줄 메모**다. 공백만 두들긴 사유를 «사유가 있다»고 기록하면, 나중에 그 행을
 * 보는 사람이 이유가 적혀 있는 줄 알고 열어 본다. 견적서가 같은 자리에서 같은
 * 판단을 한다(`actions/quotes.ts` 의 `deleteQuoteAction`).
 * ============================================================================
 */

/**
 * 길이 상한. 이 저장소의 다른 휴지통 액션(고객사·제품 모델·재고·작업지시 서식)이
 * 전부 2000자에서 거절하므로 같은 값을 쓴다 — **같은 확인 창을 쓰는 화면들**이
 * 사유 길이만 서로 다르면 어느 쪽이 규칙인지 알 수 없게 된다.
 */
export const SERVICE_REPORT_DELETE_REASON_MAX_LENGTH = 2000;

const DELETE_REASON_TOO_LONG_MESSAGE = "삭제 사유가 너무 깁니다.";

export type ServiceReportDeleteReasonResult =
  | { ok: true; reason: string | null }
  | { ok: false; message: string };

/**
 * 받은 삭제 사유를 표에 담을 값으로. **글자가 아니거나 다듬어서 빈 글자면
 * `null`** — 「사유 없음」과 「공백만 적어 보냄」을 표에서 가르지 않는다.
 */
export function readServiceReportDeleteReason(raw: unknown): ServiceReportDeleteReasonResult {
  const trimmed = typeof raw === "string" ? raw.trim() : "";
  if (trimmed.length > SERVICE_REPORT_DELETE_REASON_MAX_LENGTH) {
    return { ok: false, message: DELETE_REASON_TOO_LONG_MESSAGE };
  }
  return { ok: true, reason: trimmed === "" ? null : trimmed };
}
