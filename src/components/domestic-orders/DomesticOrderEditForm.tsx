"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import EditSectionActions, {
  editErrorClass,
  editInputClass,
  editLabelClass,
} from "@/components/repair-cases/detail/edit/EditSectionActions";
import type { SectionEditConflictError } from "@/components/repair-cases/detail/edit/useSectionEditSubmit";
import { buildDraftText } from "@/lib/domain/edit-draft-text";
import type { DomesticOrderListItem, RepairCaseLinkOption } from "@/lib/db/queries/domestic-orders";
import {
  createDomesticOrderAction,
  updateDomesticOrderAction,
} from "@/lib/server/actions/domestic-orders";

/**
 * ============================================================================
 * 내자 정리 — 한 줄을 통째로 고치는 폼 (2단계)
 * ============================================================================
 * 칸 하나씩 고치는 방식이 아니다. 한 줄의 값 18개를 한 화면에서 고치고 한 번에
 * 저장한다 — 이 시트는 원래 한 줄이 한 건의 이야기(발주 → 견적 → 납품 →
 * 세금계산서 → 입금)라서, 칸 단위로 저장하면 "견적은 들어갔는데 현황은 아직
 * 옛날 값"인 중간 상태가 표에 남는다.
 *
 * ── 고객사·형식·L/N·S/N·고장내역은 이 폼에 없다 ─────────────────────────
 * 그 다섯은 domestic_orders 의 칸이 아니라 수리 건에서 조인해 따라오는 값이다
 * (schema/domestic-orders.ts 헤더). 여기에 입력칸을 두면 같은 값이 두 곳에
 * 생기고, 그 순간부터 둘이 어긋나기 시작한다. 고치려면 수리 건 쪽에서 고친다.
 *
 * ── 충돌하면 얼린다 ─────────────────────────────────────────────────────
 * 저장이 CONFLICT 로 돌아오면 이 폼은 더 이상 저장하지 않는다. 낡은 값을 그대로
 * 덮어쓰면 남이 방금 적은 입금 사실이 조용히 사라진다. 얼리는 방식도, "최신
 * 정보 다시 불러오기" 하나만 남는 것도 접수 건 구간 편집과 같다
 * (EditSectionActions) — 이 시스템에서 충돌은 늘 같은 모양으로 보여야 한다.
 *
 * ── 다시 불러올 때 적어 둔 값을 잃지 않는다 ─────────────────────────────
 * 다시 불러오면 이 폼은 언마운트되고 손으로 친 글이 통째로 사라진다. 그래서
 * 얼리기 직전에 저장하려던 값에서 **사람이 직접 친 글만** 뽑아 붙잡아 둔다
 * (buildDraftText + 아래 DRAFT_LABELS). 상자는 읽기 전용 textarea 라 사내망
 * http 환경처럼 navigator.clipboard 가 아예 없는 브라우저에서도 길게 눌러
 * 선택할 수 있다 — 그 판단은 EditSectionActions 가 이미 하고 있다.
 * ============================================================================
 */

/**
 * 충돌 상자에 보여 줄 항목과 이름표. **여기 없는 항목은 보여 주지 않는다.**
 *
 * 날짜 다섯과 수리 건 연결(UUID), 입금완료 체크는 뺐다 — 다시 고르는 데 몇 초면
 * 되고, UUID 는 사람이 읽을 수 없어 보여 주면 오히려 방해다(edit-draft-text.ts
 * 의 '왜 자유 입력만인가'). 금액은 뺄 수 없다: 손으로 친 값이고, 잘못 다시
 * 적으면 합계가 세금계산서와 어긋난다.
 */
const DRAFT_LABELS: Readonly<Record<string, string>> = {
  intakeNumberText: "인수번호(직접 입력)",
  purchaseOrderNumber: "발주서번호",
  projectName: "PJT",
  quoteNumber: "견적서번호",
  progressNote: "현황",
  deliveredBy: "납품자",
  amountExcludingVat: "금액(VAT별도)",
  japanRemittanceNote: "일본 송금",
  historyNote: "이력",
  etcNote: "기타",
};

const textAreaClass = `${editInputClass} min-h-20 resize-y`;

export default function DomesticOrderEditForm({
  row,
  repairCaseOptions,
  onDone,
}: {
  /** 고칠 줄. null 이면 새 줄을 추가하는 중이다. */
  row: DomesticOrderListItem | null;
  repairCaseOptions: RepairCaseLinkOption[];
  onDone: () => void;
}) {
  const router = useRouter();

  const [repairCaseId, setRepairCaseId] = useState(row?.repairCaseId ?? "");
  const [intakeNumberText, setIntakeNumberText] = useState(row?.intakeNumberText ?? "");
  const [displayOrder, setDisplayOrder] = useState(
    row?.displayOrder === null || row?.displayOrder === undefined ? "" : String(row.displayOrder)
  );
  const [purchaseOrderNumber, setPurchaseOrderNumber] = useState(row?.purchaseOrderNumber ?? "");
  const [projectName, setProjectName] = useState(row?.projectName ?? "");
  const [orderIssuedDate, setOrderIssuedDate] = useState(row?.orderIssuedDate ?? "");
  const [requestedDueDate, setRequestedDueDate] = useState(row?.requestedDueDate ?? "");
  const [quoteIssuedDate, setQuoteIssuedDate] = useState(row?.quoteIssuedDate ?? "");
  const [quoteNumber, setQuoteNumber] = useState(row?.quoteNumber ?? "");
  const [progressNote, setProgressNote] = useState(row?.progressNote ?? "");
  const [deliveredDate, setDeliveredDate] = useState(row?.deliveredDate ?? "");
  const [deliveredBy, setDeliveredBy] = useState(row?.deliveredBy ?? "");
  const [taxInvoiceDate, setTaxInvoiceDate] = useState(row?.taxInvoiceDate ?? "");
  const [amountExcludingVat, setAmountExcludingVat] = useState(row?.amountExcludingVat ?? "");
  const [paymentCompleted, setPaymentCompleted] = useState(row?.paymentCompleted ?? false);
  const [japanRemittanceNote, setJapanRemittanceNote] = useState(row?.japanRemittanceNote ?? "");
  const [historyNote, setHistoryNote] = useState(row?.historyNote ?? "");
  const [etcNote, setEtcNote] = useState(row?.etcNote ?? "");

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | SectionEditConflictError | null>(null);
  const [isConflict, setIsConflict] = useState(false);

  const disabled = isSubmitting || isConflict;

  function collectFields(): Record<string, unknown> {
    return {
      repairCaseId: repairCaseId || null,
      intakeNumberText,
      displayOrder,
      purchaseOrderNumber,
      projectName,
      orderIssuedDate,
      requestedDueDate,
      quoteIssuedDate,
      quoteNumber,
      progressNote,
      deliveredDate,
      deliveredBy,
      taxInvoiceDate,
      amountExcludingVat,
      paymentCompleted,
      japanRemittanceNote,
      historyNote,
      etcNote,
    };
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (disabled) return;
    setIsSubmitting(true);
    setSubmitError(null);
    setFieldErrors({});
    const fields = collectFields();
    try {
      const result = row
        ? await updateDomesticOrderAction({ id: row.id, expectedVersion: row.version, fields })
        : await createDomesticOrderAction({ fields });

      if (!result.ok) {
        if (result.code === "CONFLICT") {
          // 얼리기 **전에** 적어 둔 글을 붙잡는다 — 곧 폼이 사라지기 때문이다.
          setIsConflict(true);
          setSubmitError({ message: result.message, draftText: buildDraftText(fields, DRAFT_LABELS) });
          return;
        }
        setFieldErrors(result.fieldErrors ?? {});
        setSubmitError(result.message);
        return;
      }

      router.refresh();
      onDone();
    } finally {
      setIsSubmitting(false);
    }
  }

  function reloadAfterConflict() {
    router.refresh();
    onDone();
  }

  function renderText(
    key: string,
    label: string,
    value: string,
    onChange: (next: string) => void,
    options: { type?: string; long?: boolean; inputMode?: "numeric" | "decimal" } = {}
  ) {
    return (
      <div className={options.long ? "sm:col-span-2 lg:col-span-3" : undefined}>
        <label className={editLabelClass} htmlFor={`domestic-order-${key}`}>
          {label}
        </label>
        {options.long ? (
          <textarea
            id={`domestic-order-${key}`}
            className={textAreaClass}
            value={value}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value)}
          />
        ) : (
          <input
            id={`domestic-order-${key}`}
            type={options.type ?? "text"}
            inputMode={options.inputMode}
            className={editInputClass}
            value={value}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value)}
          />
        )}
        {fieldErrors[key] && <p className={editErrorClass}>{fieldErrors[key]}</p>}
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      className="rounded-lg border border-zinc-300 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-900"
    >
      <h2 className="mb-3 text-sm font-semibold text-zinc-900 dark:text-zinc-50">
        {row ? "줄 수정" : "행 추가"}
      </h2>

      {/* 고객사·형식·L/N·S/N·고장내역이 없는 것은 빠뜨린 것이 아니다 —
          수리 건에서 따라오는 값이라 여기서 고치지 않는다(파일 헤더). */}
      <p className="mb-3 text-xs text-zinc-500 dark:text-zinc-400">
        고객사 · 형식 · L/N · S/N · 고장내역은 연결된 수리 건에서 따라오는 값이라 이 폼에서 고치지
        않습니다.
      </p>

      <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
        {renderText("displayOrder", "순번", displayOrder, setDisplayOrder, { inputMode: "numeric" })}

        <div>
          <label className={editLabelClass} htmlFor="domestic-order-repairCaseId">
            수리 건 연결
          </label>
          <select
            id="domestic-order-repairCaseId"
            className={editInputClass}
            value={repairCaseId}
            disabled={disabled}
            onChange={(e) => setRepairCaseId(e.target.value)}
          >
            {/* 연결 없는 줄이 정상이다 — 수리 없이 납품만 있는 줄, 발주는
                받았지만 아직 접수 전인 줄이 실제로 있다(schema 헤더). */}
            <option value="">연결 없음</option>
            {repairCaseOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {[option.intakeNumber, option.customerName, option.modelName]
                  .filter((part): part is string => Boolean(part))
                  .join(" · ")}
              </option>
            ))}
          </select>
          {fieldErrors.repairCaseId && <p className={editErrorClass}>{fieldErrors.repairCaseId}</p>}
        </div>

        {renderText("intakeNumberText", "인수번호(직접 입력)", intakeNumberText, setIntakeNumberText)}
        {renderText("purchaseOrderNumber", "발주서번호", purchaseOrderNumber, setPurchaseOrderNumber)}
        {renderText("projectName", "PJT", projectName, setProjectName)}
        {renderText("orderIssuedDate", "발주발행일", orderIssuedDate, setOrderIssuedDate, { type: "date" })}
        {renderText("requestedDueDate", "납기요청일", requestedDueDate, setRequestedDueDate, { type: "date" })}
        {renderText("quoteIssuedDate", "견적발행일", quoteIssuedDate, setQuoteIssuedDate, { type: "date" })}
        {renderText("quoteNumber", "견적서번호", quoteNumber, setQuoteNumber)}
        {renderText("deliveredDate", "납품일", deliveredDate, setDeliveredDate, { type: "date" })}
        {renderText("deliveredBy", "납품자", deliveredBy, setDeliveredBy)}
        {renderText("taxInvoiceDate", "세금계산서발행일", taxInvoiceDate, setTaxInvoiceDate, { type: "date" })}
        {/* type="number" 를 쓰지 않는다 — 목록이 1,234,567 처럼 끊어 보여 주므로
            사용자가 그 모양 그대로 붙여 넣는 일이 실제로 있고, number 입력은
            그런 값을 조용히 빈칸으로 만든다. 쉼표는 검증 쪽이 걷어 낸다. */}
        {renderText("amountExcludingVat", "금액(VAT별도)", amountExcludingVat, setAmountExcludingVat, {
          inputMode: "decimal",
        })}
        {renderText("japanRemittanceNote", "일본 송금", japanRemittanceNote, setJapanRemittanceNote)}

        <div className="flex items-end">
          <label className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
            <input
              type="checkbox"
              checked={paymentCompleted}
              disabled={disabled}
              onChange={(e) => setPaymentCompleted(e.target.checked)}
            />
            입금완료
          </label>
          {fieldErrors.paymentCompleted && (
            <p className={editErrorClass}>{fieldErrors.paymentCompleted}</p>
          )}
        </div>

        {renderText("progressNote", "현황", progressNote, setProgressNote, { long: true })}
        {renderText("historyNote", "이력", historyNote, setHistoryNote, { long: true })}
        {renderText("etcNote", "기타", etcNote, setEtcNote, { long: true })}
      </div>

      <EditSectionActions
        isSubmitting={isSubmitting}
        isConflict={isConflict}
        submitError={submitError}
        onCancel={onDone}
        onReloadAfterConflict={reloadAfterConflict}
      />
    </form>
  );
}
