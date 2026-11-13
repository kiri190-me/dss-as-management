import type { ReactNode } from "react";
import Link from "next/link";

import {
  dash,
  formatAmount,
  NO_ORDER_DATE_LABEL,
  paymentLabel,
} from "@/lib/domain/domestic-order-display";
import { DOMESTIC_ORDER_DELIVERED_DATE_NOTE } from "@/lib/domain/delivered-date-link";
import {
  DeliveredByCellContent,
  DeliveredDateCellContent,
} from "@/components/domestic-orders/delivered-cell-content";
import FinalShipmentApprovedBadge from "@/components/approvals/FinalShipmentApprovedBadge";
import { resolveDomesticOrderModelLink } from "@/lib/domain/domestic-order-detail-link";
import type { MiscCaseStatus } from "@/lib/domain/misc-case-status";
import MiscCaseStatusBadge from "./MiscCaseStatusBadge";

/**
 * ============================================================================
 * 「기타건 현황」의 칸 — **표와 카드가 나눠 쓰는 한 벌** (2026-11-06)
 * ============================================================================
 * 이 화면은 같은 줄을 두 모양으로 그린다(표 / 카드 — components/common/
 * responsive-list.tsx 가 폭을 재서 고른다). 칸의 **이름표와 값**을 양쪽에 각각
 * 적으면 한쪽만 고쳐져, 같은 자료가 **화면 폭에 따라 다른 글자**로 보인다 — 내자
 * 정리가 이미 겪고 적어 둔 함정이라(그 파일의 표/카드 원칙) 여기서는 처음부터
 * 한 벌로 둔다.
 *
 * 🔴 **값 만들기는 전부 중립 함수**다(domain/domestic-order-display.ts 의 dash ·
 * formatAmount · paymentLabel · NO_ORDER_DATE_LABEL). 내자 정리 · 기타건 상세가
 * 쓰는 바로 그 함수들이라, 같은 줄이 세 화면에서 같은 글자로 보인다.
 *
 * ⚠️ **갈라지는 것은 「접는 방식」 하나뿐이다.** 표는 폭이 좁아 `현황` 을 두 줄에서
 * 자르고(잘린 것은 … , 전체는 title), 카드는 세로로 서므로 적은 그대로 여러 줄로
 * 그린다. 값 자체는 같은 함수가 만든 같은 글자다 — 내자 정리의 표/카드도 같은
 * 방식으로 갈라져 있다.
 * ============================================================================
 */

/**
 * 이 화면이 **실제로 들여다보는 칸만** 요구한다 — 조회의 전체 행 타입
 * (DomesticOrderListItem, 칸 마흔 남짓)을 끌어오지 않는다. 이 저장소의 도메인
 * 파일들이 쓰는 규칙 그대로이고(domain/domestic-order-list.ts 의 타입들), 값이
 * 셋이다: 무엇을 그리는지가 이 타입에서 바로 보이고, 시험이 줄 하나를 손으로
 * 만들 수 있으며, 조회가 칸을 하나 더 실어 온다고 이 화면이 따라 흔들리지 않는다.
 *
 * 🔵 `DomesticOrderListItem` 이 이 모양을 **그대로 만족한다**(구조적 타입) —
 * 페이지는 조회 결과를 그대로 넘긴다.
 */
export type MiscCaseRow = {
  id: string;
  /**
   * 🔴 이 목록에서는 **언제나 null** 이다(기타건의 정의 — queries 의
   * listMiscDomesticOrders). 그래도 칸을 요구하는 까닭은 아래 링크 규칙이 이 값으로
   * 판정하기 때문이다. 빼면 「늘 링크가 선다」를 이 화면이 스스로 정하는 셈이 된다.
   */
  repairCaseId: string | null;
  modelName: string | null;
  customerName: string | null;
  /**
   * 🔴 **서버가 정해 보낸 상태**(2026-11-06). 「완료인가」와 「승인이 어디까지
   * 왔나」를 한 값으로 접은 것이고, 접는 일은 도메인 하나가 한다
   * (domain/misc-case-status.ts 의 resolveMiscCaseStatus).
   *
   * 화면이 스스로 판정하지 못하는 까닭: 승인 상태는 이 줄의 칸이 아니라 **다른 표의
   * 최신 결재 행 + 이 줄의 판 번호**로 나오는 파생값이다(queries/
   * domestic-order-approvals.ts). 전체 A/S 현황이 「장기 PO 미발행」· 「납기 임박」을
   * 서버에서 계산해 내려보내는 것과 같은 모양이다.
   */
  status: MiscCaseStatus;
  /**
   * 🔴 **[최종 출하 승인 완료] 배지를 붙이는가**(2026-11-08 사용자 요구). 위
   * `status` 와 **같은 자리에서 서버가 정해 보낸다**(페이지가 같은 승인 조회
   * 하나의 결과로 둘을 함께 만든다).
   *
   * 🔴 **`status` 로는 대신할 수 없다.** 그 배지는 「완료」가 찍힌 줄에서
   * COMPLETED 로 덮이기 때문이다(domain/misc-case-status.ts 의 보는 차례 ①) —
   * 끝난 기타건에서 승인 사실이 통째로 사라진다. 사용자가 두 배지를 **함께**
   * 요구한 자리가 바로 거기다.
   *
   * 🔵 어느 상태에 붙는지는 도메인 하나가 정한다(isFinalShipmentApproved) —
   * `STALE` 에는 안 붙는다. 까닭은 그 파일 머리말에 있다.
   */
  finalShipmentApproved: boolean;
  displayQuoteNumber: string | null;
  displayQuoteIssuedDate: string | null;
  purchaseOrderNumber: string | null;
  orderIssuedDate: string | null;
  projectName: string | null;
  progressNote: string | null;
  /** numeric — 문자열이다(schema/domestic-orders.ts 의 '금액은 numeric 이다'). */
  displayAmountExcludingVat: string | null;
  paymentCompleted: boolean;
  /**
   * 🔴 **납기요청일 행마다 하나씩**이다(2026-11-08). 두 목록은 길이가 같고 자리가
   * 맞는다 — 그리는 일은 내자 정리와 **같은 부품**이 한다
   * (components/domestic-orders/delivered-cell-content.tsx).
   *
   * 🔵 이 목록의 줄은 전부 수리 건이 안 붙은 줄이라 `deliveredDateBorrowed` 는
   * 언제나 거짓이다(빌려 올 수리 건이 없다). 그래도 칸을 요구하는 것은 **같은
   * 부품에 같은 모양을 넘기기 위해서**다 — 여기서 빼면 그 부품이 두 화면에서 다른
   * 타입을 받게 되고, 그 순간 둘이 갈라질 자리가 생긴다.
   */
  deliveredDateLines: (string | null)[];
  deliveredByLines: (string | null)[];
  deliveredDateBorrowed: boolean;
};

/**
 * 「품명」 칸 — 누르면 **기타건 상세**로 간다.
 *
 * 🔴 **어떤 줄에 링크가 서는지 여기서 정하지 않는다.** 내자 정리의 [형식] 칸과
 * **같은 도메인 함수**를 부른다(domain/domestic-order-detail-link.ts). 이 화면의
 * 줄은 전부 수리 건이 안 붙은 줄이라 늘 링크가 서지만, 그 사실을 여기서 다시 적으면
 * 규칙이 두 곳에 생긴다 — 그리고 두 화면이 **같은 줄을 다르게** 다루기 시작한다.
 *
 * 🔴 **빈 값의 글자도 그 함수의 것을 그대로 쓴다**(`(형식 없음)`). 이 화면의
 * 이름표는 상세의 말을 따라 「품명」인데(기타건 상세 머리 카드의 넷 — 2026-11-06
 * 사용자 지정) 빈 값 글자는 「형식」이라, 한 줄 안에서 말이 어긋나 보인다. 그래도
 * 새 글자를 짓지 않는다: **같은 줄이 내자 정리에서는 `(형식 없음)` 으로 보이기**
 * 때문이다. 두 화면을 오가는 사람에게는 칸 이름이 다른 것보다 **같은 칸이 다른 말로
 * 비어 있는 것**이 더 헷갈린다.
 *
 * ⚠️ `stopPropagation` 이 없다 — 내자 정리와 **일부러 다르다.** 저쪽에는 (2026-11-06
 * 전까지) 줄 전체를 누르는 동작이 있었고 지금도 그 자리를 남겨 두었지만, 이 화면의
 * 줄에는 누르는 동작이 링크 둘뿐이다(품명 · 상세). 없는 동작을 막는 코드를 베껴 두면
 * 나중에 읽는 사람이 「여기도 줄 전체가 눌린다」고 읽는다.
 *
 * ── 🔴 **파란 밑줄이 아니다** (2026-11-06 사용자 지정) ──────────────────
 * 「기타건 현황의 표에서 [품명]을 하이퍼링크처럼 파란색에 밑줄로 표시하지 말고
 * a/s 현황의 인수번호가 표에 표시되는 것처럼 해줘」.
 *
 * 그래서 전체 A/S 현황의 인수번호 칸과 **같은 클래스**를 쓴다
 * (components/repair-cases/RepairCaseTable.tsx 의 그 `<Link>`): 본문과 같은 글자색에
 * `font-medium` 으로만 무게를 주고, 밑줄은 **마우스를 올렸을 때만** 나온다. 누르면
 * 상세로 가는 것은 그대로다 — 바뀐 것은 모양뿐이다.
 *
 * ⚠️ 한 가지만 다르다: 저쪽의 `whitespace-nowrap` 을 **가져오지 않았다.** 인수번호는
 * `D2611-07` 처럼 길이가 고정이지만 품명은 「케이블 교체 일식」 같은 문장이 들어오는
 * 칸이라, 안 접으면 그 칸 하나가 표를 옆으로 늘린다. 접는 방식은 부르는 쪽(`<td>`
 * 또는 카드의 머리)이 정한다.
 */
export function MiscCaseModelLink({ row }: { row: MiscCaseRow }) {
  const link = resolveDomesticOrderModelLink(row);
  // 수리 건이 붙은 줄은 이 목록에 들어오지 않는다(queries 의 listMiscDomesticOrders).
  // 그래도 분기를 남겨 두는 까닭: 조회가 바뀌어 섞여 들어오는 날, 링크를 억지로
  // 세우면 「인수번호는 수리 건으로, 품명은 기타건으로」 가는 줄이 생긴다.
  if (link.kind === "TEXT") return <>{link.label}</>;
  return (
    <Link
      href={link.href}
      className="font-medium text-zinc-900 underline-offset-2 hover:underline dark:text-zinc-50"
    >
      {link.label}
    </Link>
  );
}

/** 표와 카드가 함께 쓰는 칸 하나. `of` 가 만드는 것이 그 칸에 보이는 전부다. */
export type MiscCaseField = {
  label: string;
  of: (row: MiscCaseRow) => ReactNode;
  /** 이름표에 마우스를 올렸을 때의 설명. 칸의 뜻이 이름만으로 안 서는 칸에만 붙인다. */
  hint?: string;
};

/**
 * 🔴 **이 화면이 보여 주는 칸 전부.** 표의 열도 카드의 줄도 여기서 나온다.
 *
 * ── 왜 이 칸들인가 (개발 DB 실측 2026-11-06, 기타건 13건) ────────────────
 * 기타건 상세의 머리 카드가 **품명 · 공급처 · 발행일자 · 발행번호**이고
 * (2026-11-04 사용자 지정), 목록도 그 넷이 뼈대다 — 사람이 상세에서 보던 네 값으로
 * 줄을 찾는다. 거기에 **발주 · 돈 · 납품**을 더한다: 이 표는 A/S 진행 상태가 아니라
 * 발주 → 견적 → 납품 → 입금의 흐름을 따라가는 장부이기 때문이다
 * (schema/domestic-orders.ts 머리말).
 *
 * ⚠️ **채워진 줄 수로 고르지 않았다.** 실측은 품명 2/13 · 공급처 3/13 로 낮고
 * 발주발행일 12/13 · 견적발행일 11/13 이 높지만, 13건 중 9건이 **데모 씨앗**이고
 * (scripts/seed-domestic-orders-demo.ts) 기타 견적서에서 태어난 줄은 2건뿐이다 —
 * 즉 지금의 채움률은 사람이 쓴 결과가 아니라 씨앗 스크립트가 정한 값이다. 그래서
 * **칸의 쓰임**(어느 화면이 그 칸을 적고 읽는가)으로 골랐고, 낮은 채움률은 빈 값
 * 표시("-" · `발주일 미정` · `(형식 없음)`)로 감당한다.
 *
 * ⚠️ **L/N · S/N · 고장내역은 넣지 않았다.** 기타건에는 장비가 없다 — 수리 건이
 * 붙지 않은 줄이라 그 셋은 조인해 올 곳이 없고, 손으로 적은 값도 개발 DB 에서
 * **0/13** 이다. 칸을 두면 모든 줄에서 "-" 만 보이는 열이 셋 생긴다.
 *
 * ⚠️ **순번 · 납기요청일도 넣지 않았다.** 순번은 내자 정리 시트에서 사람이 매긴
 * 표시 순서라 이 화면의 차례와 뜻이 다르고(이 화면은 발행일자로 선다), 납기요청일은
 * 기타건 13건 중 **1건**만 달려 있는 데다 그 칸의 「납기 역전」 경보는 연결된 수리
 * 건의 사내 목표 완료일로 재는 값이라 기타건에서는 영영 뜨지 않는다
 * (domain/due-date-inversion.ts).
 */
export const MISC_CASE_FIELDS = {
  modelName: { label: "품명", of: (row) => <MiscCaseModelLink row={row} /> },
  // 🔴 **배지 모양**이다(2026-11-06 사용자 지정: 「상태를 베찌 모양으로 해주고」).
  // 글자도 색도 여기서 정하지 않는다 — 말은 domain/misc-case-status.ts, 색은
  // MiscCaseStatusBadge 한 곳이고, 기타건 상세의 머리 카드가 같은 배지를 그린다.
  //
  // 🔴 **2026-11-08 — [최종 출하 승인 완료]가 같은 칸에 함께 선다**(사용자 요구).
  // 칸을 새로 만들지 않고 여기 붙인 까닭 둘:
  //  · 이 배지는 **상태의 한 갈래가 아니라 상태 위에 얹히는 사실**이라, 둘이 한
  //    자리에 나란히 서야 「완료 + 승인도 끝남」이 한눈에 읽힌다. 칸을 늘리면 표가
  //    열 칸이 되고 카드에도 줄이 하나 더 는다.
  //  · 🔵 **표와 카드가 함께 따라온다** — 이 한 벌이 두 화면을 먹이므로, 여기
  //    붙이면 좁은 화면에서만 배지가 사라지는 일이 생기지 않는다(이 파일의 요점).
  //
  // ⚠️ 감싸개가 `flex-wrap` 인 것이 중요하다 — 부르는 쪽(표의 보조 줄)이
  // `whitespace-nowrap` 이라 두 배지가 한 줄에 묶이면 그 칼럼만 옆으로 늘어난다.
  // flex 상자의 **칸끼리는** 그 설정과 무관하게 접힌다.
  //
  // 🔴 **둘 다 자리를 받는다**(2026-11-13) — [시스템 설정] → [배지 표시]의
  // 「기타건 현황 — 목록」에서 체크를 풀면 그 배지가 여기서 사라진다. 자리 글자를
  // 이 한 벌에 적는 것이 요점이다: **표와 카드가 이 파일 하나를 먹으므로** 한쪽만
  // 안 꺼지는 일이 생기지 않는다(이 파일의 요점 그대로다). 🔵 자리를 아는 것은
  // 이 한 줄뿐이고, 숨길지 말지는 배지 조각이 제 손으로 정한다 — 여기에
  // `{보일까 && <배지/>}` 를 적지 않는 까닭은 repair-cases/badges.tsx 머리말에 있다.
  status: {
    label: "상태",
    of: (row) => (
      <span className="inline-flex flex-wrap items-center gap-1">
        <MiscCaseStatusBadge status={row.status} placeKey="miscCaseList" />
        <FinalShipmentApprovedBadge
          approved={row.finalShipmentApproved}
          placeKey="miscCaseList"
        />
      </span>
    ),
  },
  customerName: { label: "공급처", of: (row) => dash(row.customerName) },
  quoteNumber: { label: "발행번호", of: (row) => dash(row.displayQuoteNumber) },
  quoteIssuedDate: { label: "발행일자", of: (row) => dash(row.displayQuoteIssuedDate) },
  purchaseOrderNumber: { label: "발주서번호", of: (row) => dash(row.purchaseOrderNumber) },
  // 내자 정리와 **같은 글자**다 — "-"(그냥 빈 값)와 「아직 발주가 나지 않았다」는
  // 다른 사실이고, 그 구분을 한 화면에서만 하면 같은 줄이 두 화면에서 다르게 읽힌다.
  orderIssuedDate: {
    label: "발주발행일",
    of: (row) => (row.orderIssuedDate === null ? NO_ORDER_DATE_LABEL : row.orderIssuedDate),
  },
  projectName: { label: "PJT", of: (row) => dash(row.projectName) },
  progressNote: { label: "현황", of: (row) => dash(row.progressNote) },
  amount: { label: "금액(VAT별도)", of: (row) => formatAmount(row.displayAmountExcludingVat) },
  paymentCompleted: { label: "입금완료 여부", of: (row) => paymentLabel(row.paymentCompleted) },
  // 이 칸이 어디서 오는지는 이름만으로 서지 않는다 — 내자 정리 · 기타건 상세와
  // **같은 한 글자**를 설명으로 단다.
  //
  // 🔴 **값이 여러 줄이 될 수 있다**(2026-11-08 — 납기요청일 행마다 하나). 분할
  // 납품은 기타건에서만 생기므로(사용자 결정 9) 여러 줄이 실제로 서는 곳은 바로
  // 이 화면이다. 그리는 일은 내자 정리와 같은 부품이 한다.
  deliveredDate: {
    label: "납품일",
    of: (row) => <DeliveredDateCellContent row={row} />,
    hint: DOMESTIC_ORDER_DELIVERED_DATE_NOTE,
  },
  // 🔴 **새로 생긴 칸이다**(2026-11-08). 납품자가 행에 달리면서 「누가 보냈는가」가
  // 비로소 이 화면에서 뜻을 갖게 됐다 — 바로 위 납품일과 **같은 차례·같은 줄 수**라
  // 두 칸을 나란히 읽으면 회차별로 짝이 맞는다.
  deliveredBy: {
    label: "납품자",
    of: (row) => <DeliveredByCellContent row={row} />,
    hint: DOMESTIC_ORDER_DELIVERED_DATE_NOTE,
  },
} satisfies Record<string, MiscCaseField>;
