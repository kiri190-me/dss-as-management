"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { showSavePopup } from "@/components/common/SavePopup";
import EditSectionActions, {
  editErrorClass,
  editInputClass,
  editLabelClass,
} from "./edit/EditSectionActions";
import { saveRepairCaseDomesticOrderIssueDatesAction } from "@/lib/server/actions/domestic-orders";
import {
  DOMESTIC_ORDER_ISSUE_DATE_QUOTE_LOCK_MESSAGE,
  resolveDomesticOrderIssueDateEditPlan,
  type RepairCaseDomesticOrderIssueDateRow,
} from "@/lib/domain/domestic-order-issue-date-edit";
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

/** 저장이 끝났을 때의 알림. 🔴 **성공 전용**이고 0.5초 뒤 저절로 닫힌다. */
const SAVED_MESSAGE = "내자 정리 발행일을 저장했습니다.";
/** 그 자리에서 줄을 만든 경우. 사람이 「줄이 생겼다」를 알아야 다음 화면이 안 놀랍다. */
const CREATED_MESSAGE = "내자 정리에 줄을 만들었습니다.";

/**
 * ============================================================================
 * 「기본 정보」 — 내자 정리 발행일 (보기 + 고치기)
 * ============================================================================
 * 그 수리 건에 연결된 내자 정리 줄의 **견적서 발행일 · PO 발행일**을 보여 주고,
 * 고칠 수 있는 사람에게는 그 자리에서 고치게 한다. 이름은 주간보고 상세표와
 * 같은 글자다(domain/repair-case-domestic-order-dates.ts 의 두 상수).
 *
 * 🔴 **줄이 아직 없으면 저장이 그 자리에서 하나 만든다**(2026-09-29 사용자
 * 결정). 두 날짜가 둘 다 비어 있으면 만들지 않는다 — 서버가 거절한다.
 *
 * ── 🔴 왜 칸마다가 아니라 구역 폼인가 ──────────────────────────────────
 * 상단 카드의 칸 편집(edit/EngineerEditCell · ReportNumberEditCell)은 칸 하나에
 * 저장 한 번이다. 여기서는 그럴 수 없다:
 *
 *   1. 두 칸이 **같은 내자 줄 하나**를 고치고, 낙관적 잠금 토큰도 그 줄의 것
 *      하나다. 칸마다 따로 저장하면 첫 저장에서 version 이 오르는 순간 **옆
 *      칸이 곧바로 낡은 version 을 들고 있게 된다** — 아무도 끼어들지 않았는데
 *      두 번째 저장이 충돌로 막힌다.
 *   2. 줄이 없을 때의 저장은 **줄을 만드는 일**이다. 칸마다 저장하면 첫 칸이
 *      줄을 만들고 둘째 칸이 그 줄을 고치는, 한 동작이 두 기록이 되는 모양이
 *      된다.
 *
 * 그래서 두 날짜를 함께 열고 함께 보낸다. 손놀림(수정 단추 → 입력칸 → 저장·취소,
 * 충돌이면 얼리고 다시 불러오기)은 위 두 칸 편집과 **같은 것**을 쓴다
 * (edit/EditSectionActions).
 *
 * ── 🔴 여럿을 하나로 접는 일을 이 화면이 하지 않는다 ────────────────────
 * 줄이 여럿일 수 있고(분할 발주), 어느 줄을 그릴지는 도메인이 주간보고와 같은
 * 함수로 정한다. 그래서 이 파일에는 sort 도 filter 도 없고, 받은 줄을 그대로
 * 넘긴다 — 화면이 제 손으로 고르면 그 규칙이 두 벌이 되고, 그날 두 화면이 같은
 * 자료를 다른 날짜로 보여 준다(IntakeInfoSection 이 납기일에서 쓰는 방법과 같다).
 *
 * 🔴 **줄이 여럿이면 수정 단추가 없다.** 접어서 보여 준 값이 어느 줄의 것인지
 * 화면이 말할 수 없는데 저장을 받으면, 다른 줄의 날짜가 이 줄에 복사되어
 * 굳는다. 판정은 domain/domestic-order-issue-date-edit.ts 가 하고 **서버도 같은
 * 함수로 한 번 더 한다** — 화면이 감춘 것은 경계가 아니다.
 *
 * 🔴 **이 구역이 보이는가 자체가 인가**다. 내자 자료를 볼 수 없는 사람에게는
 * 부모가 아예 그리지 않는다 — 판정은 [id]/page.tsx 가 하고(내자 정리 목록 화면과
 * 같은 열쇠), 그 사람에게는 조회조차 돌지 않는다. **고치기는 그와 다른 축**이라
 * 따로 묻는다(domesticOrders WRITE — 같은 파일의 canWriteDomesticOrders).
 * ============================================================================
 */
export default function DomesticOrderDatesSection({
  repairCaseId,
  rows,
  canEdit,
}: {
  /** 저장이 가리킬 수리 건. 줄이 없을 때 새로 만드는 줄이 이 건에 붙는다. */
  repairCaseId: string;
  /**
   * 이 건에 연결된 내자 줄들(지워지지 않은 줄만) — 그릴 두 날짜와, 고칠 대상을
   * 가리키는 셋(id · version · quoteId). 없는 것이 정상이라 빈 배열이 기본이고,
   * 그때 구역은 안내 한 줄을 그린다.
   */
  rows: readonly RepairCaseDomesticOrderIssueDateRow[];
  /**
   * 내자 정리를 고칠 수 있는 사람인가(domesticOrders WRITE). 거짓이면 **보이기만**
   * 한다. 편의일 뿐이고 저장은 서버 액션과 mutation 이 처음부터 다시 검사한다.
   */
  canEdit: boolean;
}) {
  const dates = resolveRepairCaseDomesticOrderDates(rows);
  // 🔴 서버가 트랜잭션 안에서 부르는 그 함수다. 규칙을 화면에 베껴 적지 않는다.
  const plan = resolveDomesticOrderIssueDateEditPlan(rows);

  const router = useRouter();
  const [isEditing, setIsEditing] = useState(false);
  const [quoteValue, setQuoteValue] = useState("");
  const [orderValue, setOrderValue] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isConflict, setIsConflict] = useState(false);

  // 줄이 여럿이면 고칠 수 없다 — 단추 자체를 내지 않는다(파일 헤더).
  const editable = canEdit && plan.kind !== "BLOCKED_MULTIPLE";
  // 견적서가 연결된 줄에서는 그 칸의 입력칸을 열지 않는다. 판정은 도메인 몫이다.
  const quoteLocked = plan.kind === "UPDATE" && plan.quoteIssuedDateLocked;
  const disabled = isSubmitting || isConflict;

  function startEdit() {
    // 지금 보이는 값 그대로 연다. 🔴 줄이 여럿일 때는 이 길로 들어올 수 없으므로
    // (위 editable), 여기 채워지는 값은 언제나 **저장할 바로 그 줄**의 값이다.
    setQuoteValue(dates.quoteIssuedDate ?? "");
    setOrderValue(dates.orderIssuedDate ?? "");
    setFieldErrors({});
    setSubmitError(null);
    setIsConflict(false);
    setIsEditing(true);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (disabled || plan.kind === "BLOCKED_MULTIPLE") return;
    setIsSubmitting(true);
    setSubmitError(null);
    setFieldErrors({});
    try {
      const result = await saveRepairCaseDomesticOrderIssueDatesAction({
        repairCaseId,
        // 🔴 **내자 줄의 version** 이다. 줄이 없다고 본 화면은 null 을 보내고, 그
        // 사이에 줄이 생겼으면 서버가 충돌로 막는다.
        expectedVersion: plan.kind === "UPDATE" ? plan.version : null,
        // 잠긴 칸은 입력칸이 없으므로 지금 값을 그대로 되실어 보낸다 — 서버는
        // "바꾸려 했는가"로 판정하므로 같은 값이면 통과한다.
        quoteIssuedDate: quoteLocked ? (dates.quoteIssuedDate ?? "") : quoteValue,
        orderIssuedDate: orderValue,
      });

      if (!result.ok) {
        if (result.code === "CONFLICT") {
          // 낡은 폼에서 다시 저장이 나가는 길을 막는다(EditSectionActions 가
          // 저장·취소를 「최신 정보 다시 불러오기」 하나로 바꾼다).
          setIsConflict(true);
          setSubmitError(result.message);
          return;
        }
        setFieldErrors(result.fieldErrors ?? {});
        setSubmitError(result.message);
        return;
      }

      router.refresh();
      setIsEditing(false);
      // 🔴 성공 전용 팝업이다. 읽어야 하는 말(충돌 · 거절)은 위 분기에서 폼 안에
      // 남는다 — 0.5초 뒤 사라지는 상자에 담으면 읽을 수 없다.
      showSavePopup({
        message: result.created ? CREATED_MESSAGE : SAVED_MESSAGE,
        redirectTo: null,
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-start justify-between gap-2">
        <h2
          className="text-sm font-semibold text-zinc-900 dark:text-zinc-50"
          title={DOMESTIC_ORDER_DATES_SECTION_NOTE}
        >
          {DOMESTIC_ORDER_DATES_SECTION_TITLE}
        </h2>
        {editable && !isEditing && (
          <button
            type="button"
            onClick={startEdit}
            className="text-xs font-medium text-zinc-600 hover:underline dark:text-zinc-400"
          >
            수정
          </button>
        )}
      </div>

      {isEditing ? (
        <form onSubmit={handleSubmit} noValidate className="mt-3 flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-x-4 gap-y-3">
            <div>
              <label className={editLabelClass} htmlFor="domestic-order-quote-issued-date">
                {DOMESTIC_ORDER_QUOTE_ISSUED_DATE_LABEL}
              </label>
              {quoteLocked ? (
                // 🔴 연결된 견적서를 따르는 값이라 입력칸을 열지 않는다. 열어 두면
                // 저장은 되는데 목록은 계속 견적서 값을 그려 「저장했는데 안
                // 바뀐다」가 된다(domain/domestic-order-cell-edit.ts 의 같은 규칙).
                <>
                  <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                    {dates.quoteIssuedDate ?? "-"}
                  </p>
                  <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                    {DOMESTIC_ORDER_ISSUE_DATE_QUOTE_LOCK_MESSAGE}
                  </p>
                </>
              ) : (
                <input
                  id="domestic-order-quote-issued-date"
                  type="date"
                  className={`mt-1 ${editInputClass}`}
                  value={quoteValue}
                  disabled={disabled}
                  onChange={(e) => setQuoteValue(e.target.value)}
                />
              )}
              {fieldErrors.quoteIssuedDate && (
                <p className={editErrorClass}>{fieldErrors.quoteIssuedDate}</p>
              )}
            </div>
            <div>
              <label className={editLabelClass} htmlFor="domestic-order-po-issued-date">
                {DOMESTIC_ORDER_PO_ISSUED_DATE_LABEL}
              </label>
              <input
                id="domestic-order-po-issued-date"
                type="date"
                className={`mt-1 ${editInputClass}`}
                value={orderValue}
                disabled={disabled}
                onChange={(e) => setOrderValue(e.target.value)}
              />
              {fieldErrors.orderIssuedDate && (
                <p className={editErrorClass}>{fieldErrors.orderIssuedDate}</p>
              )}
            </div>
          </div>

          {/* 비워서 저장하면 지워진다 — 잘못 적은 날짜를 여기서 못 지우면 사람은
              내자 정리까지 가야 한다. 줄이 없을 때 둘 다 비우면 줄을 만들지
              않는다는 것도 함께 적는다(서버가 거절한다). */}
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            {plan.kind === "CREATE"
              ? "저장하면 내자 정리에 이 건의 줄이 하나 생깁니다. 두 날짜가 모두 비어 있으면 만들지 않습니다."
              : "비운 채로 저장하면 그 날짜가 지워집니다."}
          </p>

          <EditSectionActions
            isSubmitting={isSubmitting}
            isConflict={isConflict}
            submitError={submitError}
            onCancel={() => setIsEditing(false)}
            onReloadAfterConflict={() => {
              router.refresh();
              setIsEditing(false);
            }}
          />
        </form>
      ) : (
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3">
          <Field
            label={DOMESTIC_ORDER_QUOTE_ISSUED_DATE_LABEL}
            value={dates.quoteIssuedDate}
          />
          <Field label={DOMESTIC_ORDER_PO_ISSUED_DATE_LABEL} value={dates.orderIssuedDate} />
        </dl>
      )}

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
