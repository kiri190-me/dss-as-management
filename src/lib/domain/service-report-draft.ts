import type { ServiceReportFormValues } from "./service-report-form";

/**
 * ============================================================================
 * 🔴 **브라우저 임시보관을 걷어냈다** (2026-10-19) — 남은 것은 둘뿐이다
 * ============================================================================
 * 2026-09-02 까지 이 파일은 «적던 내용을 그 브라우저(localStorage)에 보관했다가
 * 다시 들어오면 되살리는» 장치의 본체였다. 사용자 요구로 그것을 없앴다:
 *
 *     「보고서에서 적은 내용이 지금은 브라우저에 임시보관 되고 있는데 그러지 말고
 *      새로고침 하거나 나갔다오면 저장했던 내용으로 뜨도록 해줘.
 *      (임시보관과 진짜 저장된 내용간이 구분하기 힘들어서 브라우저와 실제 파일이
 *      차이가 생길 것 같아.)」
 *
 * 🔴 **요구보다 까닭이 중요하다.** 걱정한 것은 «화면에 보이는 것»과 «실제 저장된
 * 것»이 말없이 어긋나는 일이다. 그래서 목표는 「지우기」가 아니라 **「화면이 늘
 * 저장된 것을 보여 준다」**이다. 지금 보고서 화면은 서버가 넘긴 값(새 장이면 자동
 * 채움, 저장된 장이면 DB 의 값) 하나로만 시작하고, 브라우저에 남는 자리가 없다.
 *
 * ── 임시보관이 메우던 자리는 무엇이 메우는가 ────────────────────────────
 * 임시보관은 「저장 못 하고 나갔을 때 글을 지켜 주는」 장치였다. 없앴으므로 **실수로
 * 나가면 날아간다.** 그 자리를 셋이 나눠 메운다:
 *
 *   1. **[취소]를 누르면 묻는다** — 고친 것이 있을 때만, 「나가면 적은 내용이
 *      사라집니다」를 글자 그대로 적어서(`ServiceReportLeaveConfirmDialog`).
 *   2. **저장 충돌로 얼릴 때 글을 붙잡아 둔다** — 예전부터 있던 길이다
 *      (`ServiceReportConflictNotice`, `domain/edit-draft-text.ts`).
 *   3. **저장하려던 장이 지워져 있으면 새 장으로 되돌린다** — 적은 글을 그대로
 *      들고 「만들기」로 돌아간다(`ServiceReportForm` 의 `NOT_FOUND` 갈래).
 *
 * ⚠️ 브라우저가 통째로 꺼지는 사고(탭 닫기·전원)는 이제 막지 않는다. 그것이
 * 사용자가 고른 쪽이다 — 어긋난 사본을 보고 문서를 내보내는 쪽이 더 나쁘다.
 *
 * ── 🔴 왜 파일 이름이 그대로인가 ────────────────────────────────────────
 * `formatServiceReportKstDateTime` 을 **보고서 밖의 두 곳이 더 쓴다**(「보고서」 탭
 * 목록의 「마지막 수정」, 흐름도 서버 액션). 파일을 옮기거나 이름을 바꾸면 그 둘을
 * 함께 고쳐야 하는데, 지금 그 자리는 다른 조각이 붙들고 있다. 이름만 남겨 두고
 * 속을 비웠다 — 이 머리말이 그 사정이다.
 * ============================================================================
 */

// ────────────────────────────────────────────── 고친 것이 있는가

/**
 * 폼 값의 **모든 칸 이름**.
 *
 * 🔴 `Record<keyof ServiceReportFormValues, true>` 라 **칸이 하나 늘면 tsc 가 여기를
 * 잡는다.** 배열로 적어 두면 새 칸이 조용히 비교에서 빠지고, 그 증상은 「고쳤는데도
 * 묻지 않고 나가 버린다」 — 즉 **적은 글이 말없이 사라지는 것**이다.
 */
const SERVICE_REPORT_VALUE_KEYS: Record<keyof ServiceReportFormValues, true> = {
  kind: true,

  customerName: true,
  issuedOn: true,
  reportNumberPrefix: true,
  reportNumberMiddle: true,
  reportNumberTail: true,
  customer: true,
  receivedOn: true,
  occurrencePlace: true,
  occurrencePlaceDetail: true,
  occurredOnMode: true,
  occurredOnDate: true,
  occurredOnText: true,
  productName: true,
  productCategory: true,
  modelName: true,
  manufacturedYear: true,
  manufacturedMonth: true,
  lotNumber: true,
  serialNumber: true,
  usedYears: true,
  usedMonths: true,
  situationRequest: true,
  situationDetail: true,

  onSiteRepair: true,
  replacementDelivery: true,
  goodsReceiptChecked: true,
  goodsReceiptOn: true,
  goodsReceiptNumber: true,
  completionChecked: true,
  completionOn: true,
  repairNumber: true,
  causes: true,

  findingsIntro: true,
  findings: true,
  actions: true,
  summary: true,

  remark: true,
};

/** 고른 원인은 **차례가 뜻을 갖지 않는다** — 체크를 풀었다 다시 켠 것은 고친 것이 아니다. */
function causesChanged(
  before: readonly string[],
  after: readonly string[]
): boolean {
  if (before.length !== after.length) return true;
  const seen = new Set(before);
  return after.some((code) => !seen.has(code));
}

/**
 * **사람이 고친 것이 있는가** — [취소]가 물을지 말지를 가르는 단 하나의 판단.
 *
 * 🔴 «아무것도 안 고쳤으면 묻지 않는다»가 이 함수의 값어치다. 늘 물으면 사람은
 * 읽지 않고 누르는 손을 배우고, 그러면 정작 글이 사라질 때도 그냥 넘긴다.
 *
 * 기준선(`before`)은 **지금 화면이 저장된 것으로 믿는 값**이다 — 서버가 넘긴
 * 초기값이거나, 이 화면에서 저장에 성공한 값이다(`ServiceReportForm`).
 */
export function serviceReportValuesChanged(
  before: ServiceReportFormValues,
  after: ServiceReportFormValues
): boolean {
  for (const key of Object.keys(SERVICE_REPORT_VALUE_KEYS) as (keyof ServiceReportFormValues)[]) {
    if (key === "causes") {
      if (causesChanged(before.causes, after.causes)) return true;
      continue;
    }
    if (before[key] !== after[key]) return true;
  }
  return false;
}

// ─────────────────────────────────────────────────── 시각 한 줄

/**
 * 시각을 KST 로 못 박아 만든다.
 *
 * `toLocaleString()` 을 그냥 쓰면 브라우저 언어 설정에 따라 모양이 제각각이고
 * (`9/2/2026, 2:33 PM`), 기기 시간대가 KST 가 아니면 다른 시각이 찍힌다.
 * date-only.ts 가 KST 로 못 박은 것과 같은 판단이다.
 */
const KST_DATE_TIME_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/**
 * 보고서 쪽이 시각을 적는 단 하나의 모양 — `2026-09-02 14:33`.
 *
 * 읽을 수 없으면 `null` 이다(모르는 시각을 지어내지 않는다). 그때 부르는 쪽은
 * 시각 없이 말한다.
 *
 * 🔴 조각을 뽑아 직접 이어 붙인다. `format()` 의 결과 문자열은 같은 로케일이라도
 * ICU 판에 따라 구분자가 달라진다(`2026-09-02, 14:33` / `2026-09-02 14:33`).
 *
 * 「보고서」 탭 목록의 **「마지막 수정」·「지운 때」**와 흐름도 서버 액션이 같은
 * 함수를 쓴다 — 각자 Intl 을 만들면 한쪽만 고쳐지는 날 같은 화면 안에서 시각
 * 모양이 서로 달라진다.
 */
export function formatServiceReportKstDateTime(at: Date): string | null {
  if (Number.isNaN(at.getTime())) return null;

  const parts = KST_DATE_TIME_FORMATTER.formatToParts(at);
  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((candidate) => candidate.type === type)?.value ?? "";

  const pieces = [part("year"), part("month"), part("day"), part("hour"), part("minute")];
  // 조각이 하나라도 비면 반쪽짜리 시각(`2026-- 14:`)을 적느니 아무것도 안 적는다.
  if (pieces.some((piece) => piece === "")) return null;

  return `${pieces[0]}-${pieces[1]}-${pieces[2]} ${pieces[3]}:${pieces[4]}`;
}
