"use client";

import { useIsBadgeVisible } from "@/components/providers/BadgeVisibilityProvider";
import type { BadgePlaceKey } from "@/lib/domain/badge-visibility";
import { dash, NO_ORDER_DATE_LABEL } from "@/lib/domain/domestic-order-display";
import {
  DOMESTIC_ORDER_DUE_DATE_LINK_NOTE,
  DUE_DATE_FROM_REPAIR_CASE_LABEL,
} from "@/lib/domain/requested-due-date-link";
import { borrowedBadgeClass } from "./delivered-cell-content";

/**
 * ============================================================================
 * 내자 정리 목록에 서는 작은 표식 넷 — **제 파일로 떼어냈다** (2026-11-13, 조각 4)
 * ============================================================================
 * 넷 다 2026-11-13 까지 `DomesticOrderListScreen.tsx` **안의 비공개 함수**였다
 * (CompletedBadge · DueDateRowCompletedBadge · OrderIssuedDateContent 의 알약 ·
 * 납기요청일 칸의 꼬리표). 모양도 글자도 한 글자 안 바꾸고 자리만 옮겼다.
 *
 * ── 🔴 왜 떼어냈나 — 설정 화면이 **모양을 보여 줄 수 없었다** ────────────
 * [시스템 설정] → [배지 표시]는 이름 옆에 그 배지의 **실제 모양**을 함께 세운다.
 * 「완료」·「발주일 미정」이라는 글자만으로는 화면의 어느 표식인지 모르기 때문이다
 * (settings/badge-samples.tsx 머리말 — 사용자 요구). 그런데 넷이 3,300줄짜리 화면
 * 파일 안의 비공개 함수라 **가져다 쓸 수가 없었고**, 그래서 조각 2는 그 다섯 줄을
 * 이름과 설명만 세운 채로 두었다.
 *
 * 🔴 **모양을 설정 화면에 베껴 적는 길은 일부러 닫았다.** 베낀 사본은 색이 바뀌는
 * 날 설정 화면만 옛 모양으로 남고 **오류가 안 나서 아무도 모른다** — 「끄기 전에
 * 무엇을 끄는지 보여 준다」는 그 보기 배지의 목적이 조용히 거짓이 된다. 그래서
 * 베끼는 대신 **이 파일을 양쪽이 함께 쓴다**(내자 정리 화면 · 설정 화면의 보기).
 *
 * ── 🔴 `placeKey` — 「이 배지가 지금 어느 자리에 서는가」 ────────────────
 * repair-cases/badges.tsx 가 조각 3에서 세운 규약을 **그대로** 따른다:
 *  · 받으면 저장된 배지 표시 설정을 보고 **스스로 안 그린다.**
 *  · 🔴 **안 받으면 지금까지와 글자 하나 다르지 않게 그린다.** 설정 화면의 보기
 *    배지가 자리를 한 글자도 안 넘기는 것이 이 성질에 기대고 있다 — 넘기게 되면
 *    「완료」를 끈 순간 설정 화면의 그 줄이 비고, 끈 사람은 무엇을 껐는지 볼 수도
 *    다시 켤 수도 없다.
 * 🔴 판단을 **부르는 쪽**이 아니라 배지 안에 두는 까닭도 그 파일과 같다: 부르는
 * 자리가 여섯인데 거기마다 `{보일까 && <배지/>}` 를 적으면, 한 곳을 빠뜨린 것이
 * 아무 오류 없이 지나가 「한 화면에서만 안 꺼지는」 모양이 된다.
 *
 * ── 🔴 `"use client"` 인 까닭 ───────────────────────────────────────────
 * 판정을 훅(useIsBadgeVisible)으로 한다. 이 넷을 그리는 자리는 전부 클라이언트
 * 컴포넌트이고(DomesticOrderListScreen · settings/badge-samples), 서버 쪽에서 이
 * 넷을 그리는 화면은 하나도 없다 — 그래서 훅을 써도 경계가 깨지지 않는다.
 * 🔵 서버에서도 그려지는 배지 둘(approvals/FinalShipmentApprovedBadge ·
 * misc-cases/MiscCaseStatusBadge)은 같은 판정을 **훅이 아니라 BadgeVisibilityGate
 * 를 그려서** 한다 — 그쪽 파일에 훅을 넣으면 기타건 상세의 머리 카드(서버)가 그
 * 배지를 그리는 순간 화면이 통째로 죽는다.
 *
 * 🔴 **치수와 색을 여기서 새로 정하지 않았다.** 아래 네 조각의 className 은 옮겨
 * 오기 전 글자 그대로다 — 「완료」와 「N차 완료 ✓」가 같은 치수여야 한다는 규율
 * (그 둘은 같은 칸에 나란히 선다)과, 「발주일 미정」이 빌려 온 값의 꼬리표와 **일부러
 * 다른 색**이라는 규율(저쪽은 주의, 이쪽은 출처)이 그 글자 안에 들어 있다.
 * ============================================================================
 */

/**
 * 완료된 줄에 붙는 표. 회색 배경만으로는 "왜 회색인지"를 말하지 못한다 —
 * 색을 구분하기 어려운 사람에게는 이 글자가 유일한 단서다.
 *
 * 🔵 「이 줄이 완료인가」를 여기서 보지 않는다 — 부르는 쪽이 `completed` 일 때만
 * 그린다. 옮기면서 그 분기를 끌고 오지 않은 까닭은, 그 판정이 줄 색·줄 배경과
 * 함께 쓰이는 값이라 화면 쪽에 한 벌로 있어야 하기 때문이다.
 */
export function DomesticOrderCompletedBadge({
  placeKey,
}: {
  /** 지금 서는 자리. 안 주면 설정과 상관없이 늘 그린다(파일 머리말). */
  placeKey?: BadgePlaceKey;
}) {
  const visible = useIsBadgeVisible("domesticOrderCompleted", placeKey);
  if (!visible) return null;
  return (
    <span className="rounded bg-zinc-700 px-1.5 py-0.5 text-[11px] leading-none font-medium text-white dark:bg-zinc-300 dark:text-zinc-900">
      완료
    </span>
  );
}

/**
 * 🔴 **회차 하나가 완료 처리되었다는 표** (2026-11-08).
 *
 * ── 왜 생겼나 ───────────────────────────────────────────────────────────
 * 사용자 지적 그대로다: 「**[1차 완료]가 되었다는게 내자정리에서 시각적으로 한눈에
 * 파악이 안되는 것** 같아.」 그 전까지 1차를 완료했다는 사실이 화면에 남긴 흔적은
 * **단추 글자 한 자**뿐이었다 — 「1차 완료」가 「1차 해제」로 바뀌는 것. 11px 짜리
 * 같은 모양·같은 색 단추에서 글자 두 자가 바뀌는 것을 22칼럼짜리 표에서 알아보라는
 * 것은 무리다.
 *
 * ── 🔴 왜 **줄 단위 완료 표와 같은 모양**인가 ───────────────────────────
 * 바로 위 DomesticOrderCompletedBadge 가 같은 칸에서 「완료」를 말하고 있다. 회차
 * 완료도 **같은 종류의 사실**이므로 같은 치수·같은 색(채운 진한 회색)을 쓴다 — 한
 * 칸 안에 같은 뜻의 표가 두 모양이면 사람은 다른 뜻으로 읽는다. 🔵 색만으로 말하지
 * 않는 까닭도 그 조각에 적혀 있다: 색을 구분하기 어려운 사람에게는 **글자가 유일한
 * 단서**다.
 *
 * ── 🔴 **단추 글자와 헷갈리지 않아야 한다** ─────────────────────────────
 * 가장 조심한 자리다. 완료된 1차 옆에 이 표가 「1차 완료」라고 서면, 바로 옆에서
 * 아직 완료 안 된 2차의 **단추**가 똑같이 「2차 완료」라고 적혀 있다(그 단추는
 * 「눌러서 완료해라」라는 뜻이다). 글자만 보면 둘 다 완료로 읽힌다.
 *
 * 그래서 가르는 것을 **둘** 둔다:
 *  · **채운 진한 바탕** — 단추는 흰 바탕에 테두리뿐이다(rowActionButtonClass).
 *  · 🔴 **✓** — 색을 못 가리는 화면·사람에게도 남는 단서다. 이 저장소가 「끝났다」를
 *    말할 때 쓰는 그 글자다(첨부 고르기의 `담김 ✓` · 저장 팝업의 ✓).
 *
 * 🔵 긴 회차 이름은 `title` 에 둔다 — 단추가 같은 까닭으로 같은 일을 한다(표 칸이
 * 좁다). 글자를 지어내지 않고 **그 한 줄**을 그대로 받는다
 * (domain/domestic-order-due-date-label.ts).
 */
export function DueDateRowCompletedBadge({
  rowOrder,
  label,
  placeKey,
}: {
  rowOrder: number;
  label: string;
  /** 지금 서는 자리. 안 주면 설정과 상관없이 늘 그린다(파일 머리말). */
  placeKey?: BadgePlaceKey;
}) {
  const visible = useIsBadgeVisible("dueDateRowCompleted", placeKey);
  if (!visible) return null;
  return (
    <span
      title={`${label} — 완료 처리됨`}
      className="inline-flex items-center rounded bg-zinc-700 px-1.5 py-0.5 text-[11px] leading-none font-medium whitespace-nowrap text-white dark:bg-zinc-300 dark:text-zinc-900"
    >
      {rowOrder}차 완료 ✓
    </span>
  );
}

/**
 * 표의 `발주발행일` 칸에서 날짜 대신 서는 알약. **이 칸만 빈 값이 "-" 가 아니다** —
 * 발주일이 없는 줄이 어느 년도에서도 함께 보이는 근거가 이 표식이다
 * (DomesticOrderListScreen 머리말의 '발주일 없는 줄은 어느 년도에서도 함께 보인다').
 *
 * ── 🔴 **끄면 알약 대신 "-" 가 남는다 — 칸이 비지 않는다** (2026-11-13) ──
 * 다른 배지들은 꺼지면 아무것도 안 그리는데 이것만 다르다. 까닭이 둘이다:
 *  ① 🔴 **이 칸은 눌러서 고치는 단추의 내용**이다(DomesticOrderTextCell 의
 *    displayText — 글자가 아니라 마디를 넘긴다). 내용이 아예 없으면 그 단추가
 *    **폭 0 이 되어 누를 수 없다** — 표시 설정을 껐을 뿐인데 발주발행일을 고치는
 *    길이 그 줄에서 사라진다. 오류가 아니라 「아무것도 없음」이라 아무도 신고하지
 *    않는다.
 *  ② 22칼럼을 옆으로 밀어 보는 표에서 빈 칸은 어디까지가 한 줄인지를 지운다. 그래서
 *    이 저장소의 목록은 빈 값을 전부 "-" 로 채운다(domain 의 dash).
 * 🔵 그래도 **끄는 뜻은 그대로 산다**: 꺼진 자리에서는 「아직 발주가 나지 않았다」는
 * 주의(amber)가 사라지고 다른 빈 칸과 똑같은 "-" 가 된다.
 */
export function OrderIssuedDateMissingBadge({
  placeKey,
}: {
  /** 지금 서는 자리. 안 주면 설정과 상관없이 늘 그린다(파일 머리말). */
  placeKey?: BadgePlaceKey;
}) {
  const visible = useIsBadgeVisible("orderIssuedDateMissing", placeKey);
  // 🔴 글자를 여기서 짓지 않는다 — 빈 값 표시는 도메인 한 벌이다(위 ②).
  if (!visible) return <>{dash(null)}</>;
  return (
    <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] leading-none text-amber-900 dark:bg-amber-950 dark:text-amber-200">
      {NO_ORDER_DATE_LABEL}
    </span>
  );
}

/**
 * 🔴 **카드(좁은 화면)의 같은 칸** — 알약이 아니라 **글자**다 (2026-11-13).
 *
 * 내자 정리의 표와 카드는 이 칸 하나에서 **일부러 생김새가 다르다**: 표는 amber
 * 알약을, 카드는 같은 말을 글자로만 적는다(「원래부터 다른 자리이고, 눌러서 고칠 수
 * 있게 되었다는 이유로 한쪽 생김새를 다른 쪽에 맞추지 않는다」 —
 * DomesticOrderListScreen 의 CARD_FIELD_GROUPS). 그 결정은 그대로 둔다.
 *
 * 🔴 **그래도 끄는 설정은 양쪽에 함께 들어야 한다.** 사람이 끄는 것은 「그 모양」이
 * 아니라 **「발주일 미정」이라는 표식**이고, 자리도 같은 한 자리다(내자 정리 — 목록).
 * 표에서만 들으면 폰으로 보는 사람에게는 **꺼지지 않은 것**이 되고, 그 어긋남은 오류
 * 없이 화면 폭에 따라서만 드러난다.
 *
 * 🔵 켜져 있을 때 나오는 글자는 **예전과 한 글자도 다르지 않다** — 알약을 입히지
 * 않는다. 꺼지면 바로 위 알약과 **같은 "-"** 가 남는다(그 조각의 ①②가 그대로다 —
 * 이 칸도 눌러서 고치는 단추의 내용이다).
 */
export function OrderIssuedDateMissingText({
  placeKey,
}: {
  /** 지금 서는 자리. 안 주면 설정과 상관없이 늘 그린다(파일 머리말). */
  placeKey?: BadgePlaceKey;
}) {
  const visible = useIsBadgeVisible("orderIssuedDateMissing", placeKey);
  return <>{visible ? NO_ORDER_DATE_LABEL : dash(null)}</>;
}

/**
 * 「수리 건 요청일」 — 납기요청일 칸에서 **빌려 온 날짜 뒤에** 붙는 꼬리표.
 *
 * 이 줄에 납기요청일이 하나도 없으면 연결된 수리 건의 고객 요청 납기일이 대신
 * 보인다. 그냥 날짜만 그리면 "이 줄에 내가 적어 둔 값"으로 읽히고, 나중에 수리 건
 * 쪽이 바뀌면 영문 모를 변화가 된다 — 그래서 이 꼬리표를 함께 그린다.
 *
 * 🔴 **모양은 납품일 꼬리표와 한 벌이다**(borrowedBadgeClass — delivered-cell-content).
 * 한 줄 안에 생김새가 다른 꼬리표가 둘 있으면 다른 뜻으로 읽힌다.
 * 🔴 `발주일 미정` 과 **일부러 다른 색**이다: 저쪽은 "챙겨야 하는 줄"이라는 주의
 * 표시(amber)이고, 이것은 값의 출처를 알리는 중립적인 꼬리표다.
 * 🔴 **납기 역전이어도 함께 붉어지지 않는다** — 경보가 아니라 어디서 온 값인지를
 * 말하는 표시다(수리 건 상세가 같은 자리에서 같은 선을 긋는다).
 *
 * ── 🔴 **꼬리표만 끈다 — 날짜는 못 끈다** (2026-11-13) ──────────────────
 * 끄면 이 조각 전체가 사라지고 **날짜는 그 자리에 그대로 남는다.** 날짜는 배지가
 * 아니라 그 칸의 **값**이다 — 배지 설정으로 자료가 사라지면 그것은 표시 설정이
 * 아니라 자료를 가리는 설정이 된다.
 * 🔵 날짜와 꼬리표 **사이의 빈칸도 이 조각 안**이다(borrowedBadgeClass 의 `ml-1.5`).
 * 바깥에 두면 꼬리표를 끈 자리에 날짜 뒤 빈칸 하나가 남아 줄 끝에서 줄바꿈을
 * 일으킨다 — 수리 건 쪽의 「(내자)」가 같은 까닭으로 같은 처리를 했다
 * (repair-cases/RequestedDueDateValue.tsx).
 */
export function DueDateFromRepairCaseBadge({
  placeKey,
}: {
  /** 지금 서는 자리. 안 주면 설정과 상관없이 늘 그린다(파일 머리말). */
  placeKey?: BadgePlaceKey;
}) {
  const visible = useIsBadgeVisible("dueDateFromRepairCase", placeKey);
  if (!visible) return null;
  return (
    <span className={borrowedBadgeClass} title={DOMESTIC_ORDER_DUE_DATE_LINK_NOTE}>
      {DUE_DATE_FROM_REPAIR_CASE_LABEL}
    </span>
  );
}
