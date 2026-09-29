import Link from "next/link";
import {
  DOMESTIC_ORDER_DATES_NONE_NOTE,
  DOMESTIC_ORDER_DATES_SECTION_NOTE,
  DOMESTIC_ORDER_DATES_SECTION_TITLE,
  DOMESTIC_ORDER_LIST_HREF,
  DOMESTIC_ORDER_LIST_LINK_TEXT,
  DOMESTIC_ORDER_PO_ISSUED_DATE_LABEL,
  DOMESTIC_ORDER_QUOTE_ISSUED_DATE_LABEL,
  formatMultipleDomesticOrderRowsNotice,
  resolveRepairCaseDomesticOrderDates,
  type RepairCaseDomesticOrderRow,
} from "@/lib/domain/repair-case-domestic-order-dates";

/**
 * 인수 정보의 Field 와 같은 모양이다(IntakeInfoSection.tsx). 빌려 온 값 표시
 * (borrowedLabel)는 없다 — 이 구역은 **모든 값이 내자에서 온다.** 칸마다 표시를
 * 붙이면 구역 제목이 이미 말한 것을 두 번 적는 셈이다.
 */
function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="text-xs text-zinc-500 dark:text-zinc-400">{label}</dt>
      <dd className="text-sm text-zinc-900 dark:text-zinc-50">{value ?? "-"}</dd>
    </div>
  );
}

/**
 * ============================================================================
 * 「기본 정보」 — 내자 정리 발행일 (읽기 전용)
 * ============================================================================
 * 그 수리 건에 연결된 내자 정리 줄의 **견적서 발행일 · PO 발행일**을 보여
 * 준다. 이름은 주간보고 상세표와 같은 글자다
 * (domain/repair-case-domestic-order-dates.ts 의 두 상수).
 *
 * 🔴 **여기서는 고칠 수 없다.** 수정 단추도, 폼도, 입력칸도 없다 — 두 날짜의
 * 집은 `domestic_orders` 이고 고치는 자리는 내자 정리 화면이다. 이 구역이 그리는
 * 값은 어떤 저장 payload 에도 들어가지 않는다(그 도메인 파일 헤더의 ⚠️ 항목).
 *
 * 🔴 **여럿을 하나로 접는 일을 이 화면이 하지 않는다.** 줄이 여럿일 수 있고
 * (분할 발주), 어느 줄을 그릴지는 도메인이 주간보고와 같은 함수로 정한다. 그래서
 * 이 파일에는 sort 도 filter 도 없고, 받은 줄을 그대로 넘긴다 — 화면이 제 손으로
 * 고르면 그 규칙이 두 벌이 되고, 그날 두 화면이 같은 자료를 다른 날짜로 보여
 * 준다(IntakeInfoSection 이 납기일에서 쓰는 방법과 같다).
 *
 * 🔴 **이 구역이 보이는가 자체가 인가**다. 내자 자료를 볼 수 없는 사람에게는
 * 부모가 아예 그리지 않는다 — 판정은 [id]/page.tsx 가 하고(내자 정리 목록 화면과
 * 같은 열쇠), 그 사람에게는 조회조차 돌지 않는다.
 * ============================================================================
 */
export default function DomesticOrderDatesSection({
  rows,
}: {
  /**
   * 이 건에 연결된 내자 줄들의 두 날짜(지워지지 않은 줄만). 없는 것이 정상이라
   * 빈 배열이 기본이고, 그때 구역은 안내 한 줄을 그린다.
   */
  rows: readonly RepairCaseDomesticOrderRow[];
}) {
  const dates = resolveRepairCaseDomesticOrderDates(rows);

  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <h2
        className="text-sm font-semibold text-zinc-900 dark:text-zinc-50"
        title={DOMESTIC_ORDER_DATES_SECTION_NOTE}
      >
        {DOMESTIC_ORDER_DATES_SECTION_TITLE}
      </h2>

      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3">
        <Field
          label={DOMESTIC_ORDER_QUOTE_ISSUED_DATE_LABEL}
          value={dates.quoteIssuedDate}
        />
        <Field label={DOMESTIC_ORDER_PO_ISSUED_DATE_LABEL} value={dates.orderIssuedDate} />
      </dl>

      {dates.kind === "NONE" && (
        <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
          {DOMESTIC_ORDER_DATES_NONE_NOTE}
        </p>
      )}

      {dates.kind === "MULTIPLE" && (
        <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
          {formatMultipleDomesticOrderRowsNotice(dates.rowCount)}
          <Link
            href={DOMESTIC_ORDER_LIST_HREF}
            className="font-medium text-zinc-700 underline dark:text-zinc-300"
          >
            {DOMESTIC_ORDER_LIST_LINK_TEXT}
          </Link>
        </p>
      )}
    </section>
  );
}
