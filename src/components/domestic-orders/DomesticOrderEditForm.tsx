"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import EditSectionActions, {
  editErrorClass,
  editInputClass,
  editLabelClass,
} from "@/components/repair-cases/detail/edit/EditSectionActions";
import type { SectionEditConflictError } from "@/components/repair-cases/detail/edit/useSectionEditSubmit";
import { buildDraftText } from "@/lib/domain/edit-draft-text";
import { foldBlankToNull } from "@/lib/domain/domestic-order-list";
import type {
  CustomerOption,
  DomesticOrderListItem,
  RepairCaseLinkOption,
} from "@/lib/db/queries/domestic-orders";
import {
  createDomesticOrderAction,
  updateDomesticOrderAction,
} from "@/lib/server/actions/domestic-orders";

/**
 * ============================================================================
 * 내자 정리 — 한 줄을 통째로 고치는 폼
 * ============================================================================
 * 칸 하나씩 고치는 방식이 아니다. 한 줄의 값 23개를 한 화면에서 고치고 한 번에
 * 저장한다 — 이 시트는 원래 한 줄이 한 건의 이야기(발주 → 견적 → 납품 →
 * 세금계산서 → 입금)라서, 칸 단위로 저장하면 "견적은 들어갔는데 현황은 아직
 * 옛날 값"인 중간 상태가 표에 남는다.
 *
 * ── 고객사·형식·L/N·S/N·고장내역은 비워 두는 것이 기본이다 ──────────────
 * 그 다섯에는 입력칸이 있다. **수리 건 연결이 없는 줄**에는 그 칸이 값을 적을
 * 유일한 자리이기 때문이다(schema/domestic-orders.ts 의 '여기에도 있다').
 *
 * 연결이 있는 줄에서는 **수리 건의 값을 회색 힌트로 보여만 주고 입력칸은
 * 비워 둔다.** 미리 채워 넣지 않는 것이 이 폼에서 가장 중요한 규칙이다:
 * 채워 넣으면 사용자가 아무것도 고치지 않고 저장만 해도 그 값이 이 행에
 * 복사되고, 그때부터 "일부러 다르게 적었다"와 "그냥 안 건드렸다"를 구분할 수
 * 없게 된다. 그 뒤로 수리 건 쪽에서 모델명 오타를 고쳐도 이 줄은 따라가지
 * 않는다 — 화면에는 아무 흔적도 남지 않은 채로.
 *
 * 그래서 비어 있음이 곧 "수리 건을 따른다"는 뜻이고, 적는 것은 **일부러 다르게
 * 적을 때뿐**이다(발주서의 형식이 수리 건의 형식과 다른 경우 — 그때 청구 근거는
 * 발주서 쪽이다).
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
 * 날짜 다섯과 고르는 값 둘(수리 건 연결 · 고객사 — 둘 다 UUID), 입금완료 체크는
 * 뺐다 — 다시 고르는 데 몇 초면 되고, UUID 는 사람이 읽을 수 없어 보여 주면
 * 오히려 방해다(edit-draft-text.ts 의 '왜 자유 입력만인가'). 금액은 뺄 수 없다:
 * 손으로 친 값이고, 잘못 다시 적으면 합계가 세금계산서와 어긋난다. 형식·L/N·
 * S/N·고장내역도 손으로 친 값이라 함께 붙잡는다 — 특히 이 넷은 **일부러 수리
 * 건과 다르게 적은 값**이라 다시 불러온 화면 어디에도 남아 있지 않다.
 */
const DRAFT_LABELS: Readonly<Record<string, string>> = {
  intakeNumberText: "인수번호(직접 입력)",
  modelNameText: "형식",
  lotNumberText: "L/N",
  serialNumberText: "S/N",
  faultDescriptionText: "고장내역",
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

const hintClass = "mt-1 text-xs text-zinc-500 dark:text-zinc-400";

export default function DomesticOrderEditForm({
  row,
  repairCaseOptions,
  customerOptions,
  onDone,
}: {
  /** 고칠 줄. null 이면 새 줄을 추가하는 중이다. */
  row: DomesticOrderListItem | null;
  repairCaseOptions: RepairCaseLinkOption[];
  customerOptions: CustomerOption[];
  onDone: () => void;
}) {
  const router = useRouter();

  const [repairCaseId, setRepairCaseId] = useState(row?.repairCaseId ?? "");
  const [intakeNumberText, setIntakeNumberText] = useState(row?.intakeNumberText ?? "");
  /**
   * 이 다섯은 **이 행에 적힌 값만** 담는다(row.customerId · row.modelNameText …).
   * 화면 표가 그리는 row.customerName · row.modelName 은 이미 수리 건 값이 섞여
   * 정해진 값이라, 그것을 초기값으로 쓰면 저장하는 순간 수리 건의 값이 이 행에
   * 복사된다(파일 헤더).
   */
  const [customerId, setCustomerId] = useState(row?.customerId ?? "");
  const [modelNameText, setModelNameText] = useState(row?.modelNameText ?? "");
  const [lotNumberText, setLotNumberText] = useState(row?.lotNumberText ?? "");
  const [serialNumberText, setSerialNumberText] = useState(row?.serialNumberText ?? "");
  const [faultDescriptionText, setFaultDescriptionText] = useState(
    row?.faultDescriptionText ?? ""
  );
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

  /**
   * 회색 힌트를 보여 줄 수 있는가. **저장돼 있는 연결을 그대로 두고 있을
   * 때만**이다.
   *
   * 드롭다운에서 다른 수리 건을 고르면 이 화면에는 그 건의 형식·L/N·S/N·
   * 고장내역이 없다(목록 조회가 실어 온 것은 지금 연결된 건의 값뿐이다).
   * 그때도 옛 힌트를 계속 띄우면, 사용자는 방금 고른 건의 값이라고 읽는다 —
   * 틀린 값을 보여 주느니 아무것도 보여 주지 않는 편이 낫다.
   */
  const savedRepairCaseId = row?.repairCaseId ?? "";
  const showRepairCaseHints = repairCaseId !== "" && repairCaseId === savedRepairCaseId;

  /** 힌트 한 줄. 연결이 바뀌었거나 수리 건 쪽도 비어 있으면 아무것도 그리지 않는다. */
  function repairCaseHint(value: string | null | undefined) {
    if (!showRepairCaseHints) return null;
    const hint = foldBlankToNull(value);
    if (hint === null) return null;
    return (
      <p className={hintClass}>
        연결된 수리 건{row?.intakeNumber ? ` ${row.intakeNumber}` : ""}: {hint}
        <br />
        비워 두면 이 값이 그대로 보입니다.
      </p>
    );
  }

  function collectFields(): Record<string, unknown> {
    return {
      repairCaseId: repairCaseId || null,
      intakeNumberText,
      customerId: customerId || null,
      modelNameText,
      lotNumberText,
      serialNumberText,
      faultDescriptionText,
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
    options: {
      type?: string;
      long?: boolean;
      inputMode?: "numeric" | "decimal";
      /** 입력칸 아래 회색으로 붙는 안내. 값은 건드리지 않는다(파일 헤더). */
      hint?: ReactNode;
    } = {}
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
        {options.hint}
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

      {/* 비워 두는 것이 기본이라는 사실을 폼 맨 위에 적는다 — 입력칸만 보면
          "채워야 하는 칸"으로 읽히고, 그렇게 채운 값은 수리 건 쪽이 바뀌어도
          따라가지 않는다(파일 헤더). */}
      <p className="mb-3 text-xs text-zinc-500 dark:text-zinc-400">
        고객사 · 형식 · L/N · S/N · 고장내역은 <strong className="font-semibold">비워 두면</strong>{" "}
        연결된 수리 건의 값을 그대로 따라갑니다. 발주서에 다르게 적힌 경우에만 직접 입력하세요.
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

        <div>
          <label className={editLabelClass} htmlFor="domestic-order-customerId">
            고객사
          </label>
          <select
            id="domestic-order-customerId"
            className={editInputClass}
            value={customerId}
            disabled={disabled}
            onChange={(e) => setCustomerId(e.target.value)}
          >
            {/* '연결 없음'이 기본값이다 — 고르지 않으면 연결된 수리 건의
                고객사를 따르고, 연결도 없으면 목록에서 '(고객사 미지정)'
                묶음에 들어간다. 값을 지울 길이 없으면 한 번 잘못 고른 고객사를
                되돌릴 방법이 없어진다. */}
            <option value="">연결 없음</option>
            {customerOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </select>
          {fieldErrors.customerId && <p className={editErrorClass}>{fieldErrors.customerId}</p>}
          {repairCaseHint(row?.repairCaseCustomerName)}
        </div>

        {renderText("intakeNumberText", "인수번호(직접 입력)", intakeNumberText, setIntakeNumberText)}
        {renderText("modelNameText", "형식", modelNameText, setModelNameText, {
          hint: repairCaseHint(row?.repairCaseModelName),
        })}
        {renderText("lotNumberText", "L/N", lotNumberText, setLotNumberText, {
          hint: repairCaseHint(row?.repairCaseLotNumber),
        })}
        {renderText("serialNumberText", "S/N", serialNumberText, setSerialNumberText, {
          hint: repairCaseHint(row?.repairCaseSerialNumber),
        })}
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

        {renderText(
          "faultDescriptionText",
          "고장내역",
          faultDescriptionText,
          setFaultDescriptionText,
          { long: true, hint: repairCaseHint(row?.repairCaseReportedSymptom) }
        )}
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
