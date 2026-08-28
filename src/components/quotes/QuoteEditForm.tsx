"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  editErrorClass,
  editInputClass,
  editLabelClass,
} from "@/components/repair-cases/detail/edit/EditSectionActions";
import { generateClientUuid } from "@/lib/client-uuid";
import { stockOwnerLabelOrUnspecified } from "@/lib/domain/inventory-types";
import { sumQuoteSupplyAmount } from "@/lib/domain/quote-list";
import { sumQuoteLaborCost } from "@/lib/domain/quote-labor-cost";
import { buildQuoteSubject } from "@/lib/domain/quote-subject";
import {
  MAX_QUOTE_ITEMS,
  QUOTE_KINDS,
  quoteKindLabels,
  type QuoteKind,
} from "@/lib/validation/quote-input";
import OverhaulBadge from "@/components/common/OverhaulBadge";
import type { QuoteEditData, QuoteIntakeLookup } from "@/lib/db/queries/quotes";
import {
  createQuoteAction,
  lookupIntakeForQuoteAction,
  updateQuoteAction,
} from "@/lib/server/actions/quotes";

/**
 * ============================================================================
 * 견적서 작성·수정 폼 (4단계)
 * ============================================================================
 * 만들기와 고치기가 **같은 컴포넌트**다. 칸도 규칙도 같으므로 두 벌로 나누면
 * 한쪽만 고쳐지는 날이 오고, 그때 증상은 "새로 만들면 들어가는데 고치면 안
 * 들어가는 칸"이다(mutations/quotes.ts 의 toColumnValues 와 같은 판단).
 *
 * ── 인수번호로 불러온다 ─────────────────────────────────────────────────
 * 접수 건 하나로 고객사·모델명·L/N·S/N·신고증상이 따라온다. **덮어쓰기는
 * 사람이 누른 뒤에만** 일어난다 — 타이핑하는 동안 자동으로 채우면, 손으로
 * 고쳐 둔 값이 글자를 하나 더 칠 때마다 되돌아간다.
 *
 * 불러온 값은 **그대로 저장된다**(스냅샷). 나중에 접수 건의 S/N 이 정정돼도 이미
 * 보낸 견적서는 바뀌지 않는다 — schema/quotes.ts 의 '스냅샷이다' 항목.
 *
 * ── 사용한 부품은 참고일 뿐이다 ─────────────────────────────────────────
 * 그 접수 건에 실제로 **출고된** 부품을 옆에 늘어놓기만 하고, 부품 줄에 자동으로
 * 넣지 않는다. 재고에서 나간 것과 고객사에 청구하는 것이 늘 같지는 않다(무상
 * 교체, 내부 소모, 반품). 담을지는 사람이 정한다.
 *
 * 담으면 **그 소유구분에 정해 둔 단가가 따라온다**(재고 관리 › 부품 상세의
 * 소유 구분별 단가). 소유구분마다 값이 다를 수 있어서 목록도 (부품, 소유구분)
 * 짝으로 나온다 — 같은 부품이 두 줄로 보이면 실제로 두 소유구분에서 나간 것이다.
 * 정해 두지 않은 부품은 **빈칸**으로 들어온다: 0 으로 채우면 정하지 않은 것을
 * 0원으로 청구하게 된다(schema/part-unit-prices.ts 의 그 구분).
 *
 * ── 다섯 줄을 넘으면 알려 준다 ──────────────────────────────────────────
 * 막지 않는다. 상세는 시스템에 다 남고, xlsx 로 나갈 때만 한 줄로 합산된다
 * (quote-template.ts 의 PARTS_ROLLUP_LABEL). 다만 그 사실을 화면에서 미리
 * 말해 주지 않으면, 받아 본 견적서에 줄이 하나뿐인 것을 보고 저장이 실패한 줄
 * 안다.
 *
 * ── 합계는 미리 보여 주기만 한다 ────────────────────────────────────────
 * 여기서 셈한 값을 저장하지 않는다. 저장되는 것은 수량과 단가뿐이고, 합계는
 * 조회가 다시 셈하며 실제 문서에서는 양식의 수식이 계산한다. 세 곳이 각자
 * 저장하면 어긋날 자리가 생긴다(schema/quotes.ts 의 '합계 금액을 담지 않는다').
 * ============================================================================
 */

const VAT_RATE = 0.1;
const AMOUNT_FORMAT = new Intl.NumberFormat("ko-KR");

/**
 * 서버 액션 자체가 끊긴 경우. 액션이 돌려주는 오류(권한·검증·충돌)는 각자
 * 제 문장을 갖고 있고, 이 문구는 **대답이 아예 오지 않은** 자리에만 쓴다.
 */
const SAVE_FAILED_MESSAGE =
  "저장 요청이 끝나지 못했습니다. 잠시 후 다시 시도해 주세요. 계속 그러면 화면을 새로고침해 주세요.";

type ItemRow = {
  key: string;
  partId: string | null;
  /**
   * 이 줄에 붙는 작업비(원) — 수량과 무관하다. 재고에서 담아 온 줄에만 있다 —
   * 손으로 적은 줄은 어느 부품인지 알 수 없어 null 이다. 저장되지 않고
   * **작업비 합계를 제안하는 데만** 쓴다.
   */
  laborCost: string | null;
  /** `2) OH 부품 비용` 칸으로 갈 줄인가. OH 견적서에만 그 칸이 있다. */
  isOverhaulPart: boolean;
  partNameText: string;
  quantity: string;
  unitPrice: string;
};

function emptyItem(): ItemRow {
  return {
    key: generateClientUuid(),
    partId: null,
    laborCost: null,
    isOverhaulPart: false,
    partNameText: "",
    quantity: "1",
    unitPrice: "",
  };
}

function formatAmount(value: number): string {
  return `₩${AMOUNT_FORMAT.format(Math.round(value))}`;
}

/** 오늘(한국 표준시). 새 견적서의 발행일자 기본값이다. */
function todayInSeoul(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());
}

export default function QuoteEditForm({
  quote,
  defaultQuoteDate,
}: {
  /** 수정이면 기존 값, 새로 만들기면 null. */
  quote: QuoteEditData | null;
  /** 서버가 정한 오늘 날짜. 클라이언트에서 만들면 hydration 이 어긋난다. */
  defaultQuoteDate: string;
}) {
  const router = useRouter();

  const [quoteNumber, setQuoteNumber] = useState(quote?.quoteNumber ?? "");
  const [kind, setKind] = useState<QuoteKind>(quote?.kind ?? "DOMESTIC");
  const [quoteDate, setQuoteDate] = useState(quote?.quoteDate ?? defaultQuoteDate ?? todayInSeoul());
  const [intakeNumberText, setIntakeNumberText] = useState(quote?.intakeNumberText ?? "");
  const [repairCaseId, setRepairCaseId] = useState<string | null>(quote?.repairCaseId ?? null);
  const [customerId, setCustomerId] = useState<string | null>(quote?.customerId ?? null);
  const [customerNameText, setCustomerNameText] = useState(quote?.customerNameText ?? "");
  const [modelNameText, setModelNameText] = useState(quote?.modelNameText ?? "");
  const [lotNumberText, setLotNumberText] = useState(quote?.lotNumberText ?? "");
  const [serialNumberText, setSerialNumberText] = useState(quote?.serialNumberText ?? "");
  const [faultDescriptionText, setFaultDescriptionText] = useState(quote?.faultDescriptionText ?? "");
  const [subject, setSubject] = useState(quote?.subject ?? "");
  const [validity, setValidity] = useState(quote?.validity ?? "");
  const [delivery, setDelivery] = useState(quote?.delivery ?? "");
  const [payment, setPayment] = useState(quote?.payment ?? "");
  const [workCost, setWorkCost] = useState(quote?.workCost ?? "0");
  const [items, setItems] = useState<ItemRow[]>(
    quote?.items.length
      ? quote.items.map((item) => ({
          key: generateClientUuid(),
          partId: item.partId,
          // 저장된 줄에는 작업비를 싣지 않는다 — 그 값은 부품 마스터의 지금 값이고,
          // 이미 정해진 작업비를 다시 제안할 이유가 없다.
          laborCost: null,
          isOverhaulPart: item.isOverhaulPart,
          partNameText: item.partNameText,
          quantity: String(item.quantity),
          unitPrice: item.unitPrice,
        }))
      : [emptyItem()]
  );

  const [usedParts, setUsedParts] = useState<QuoteIntakeLookup["usedParts"]>([]);
  const [lookupMessage, setLookupMessage] = useState<string | null>(null);
  const [isLookingUp, setIsLookingUp] = useState(false);

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isConflict, setIsConflict] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const supplyAmount = useMemo(
    () =>
      sumQuoteSupplyAmount(
        items.map((item) => ({ quantity: Number(item.quantity) || 0, unitPrice: item.unitPrice })),
        workCost
      ),
    [items, workCost]
  );
  const vat = supplyAmount * VAT_RATE;

  /**
   * 모델명·신고증상·종류로 지은 품명. 지금 적힌 것과 같으면 아래 단추를
   * 그리지 않는다 — 눌러도 아무 일도 일어나지 않는 단추는 두지 않는다.
   *
   * 작업비와 같은 방식이다: **자동으로 덮지 않고 제안만 한다.** 글자를 칠
   * 때마다 덮으면 손으로 다듬어 둔 품명이 사라진다.
   */
  const suggestedSubject = useMemo(
    () =>
      buildQuoteSubject({
        modelName: modelNameText,
        faultDescription: faultDescriptionText,
        kind,
      }),
    [modelNameText, faultDescriptionText, kind]
  );

  /**
   * 담긴 부품들의 작업비 합계. 규칙과 그 이유는 domain/quote-labor-cost.ts 에
   * 있다 — **수량을 곱하지 않는다.**
   *
   * 자동으로 채우지 않고 **제안만 한다.** 사람이 적어 둔 값을 글자를 칠
   * 때마다 덮으면 손으로 조정한 금액이 사라진다. 누르면 그때 들어간다.
   */
  const laborSuggestion = useMemo(() => sumQuoteLaborCost(items), [items]);

  async function handleLookup() {
    const intakeNumber = intakeNumberText.trim();
    if (intakeNumber === "") {
      setLookupMessage("인수번호를 입력한 뒤 눌러 주세요.");
      return;
    }
    setIsLookingUp(true);
    setLookupMessage(null);
    try {
      const result = await lookupIntakeForQuoteAction({ intakeNumber });
      if (!result.ok) {
        setLookupMessage(result.message);
        return;
      }
      if (!result.found) {
        // 오류가 아니다 — 아직 접수 전인 건으로 먼저 견적을 내는 일이 있다.
        setLookupMessage(`${intakeNumber} 로 접수된 건을 찾지 못했습니다. 아래 칸을 직접 입력해 주세요.`);
        setUsedParts([]);
        return;
      }

      const found = result.found;
      setRepairCaseId(found.repairCaseId);
      setCustomerId(found.customerId);
      if (found.customerName) setCustomerNameText(found.customerName);
      setModelNameText(found.modelName ?? "");
      setLotNumberText(found.lotNumber ?? "");
      setSerialNumberText(found.serialNumber ?? "");
      setFaultDescriptionText(found.faultDescription ?? "");

      // 품명은 **비어 있을 때만** 지어 준다. 인수번호를 고쳐 다시 불러올
      // 때마다 손으로 다듬어 둔 품명이 사라지면 안 된다 — 다시 짓고 싶으면
      // 품명 칸 아래의 단추를 누른다.
      if (subject.trim() === "") {
        setSubject(
          buildQuoteSubject({
            modelName: found.modelName,
            faultDescription: found.faultDescription,
            kind,
          })
        );
      }
      setUsedParts(found.usedParts);
      setLookupMessage(
        found.usedParts.length > 0
          ? `불러왔습니다. 이 건에 출고된 부품 ${found.usedParts.length}종이 아래 참고 목록에 있습니다.`
          : "불러왔습니다. 이 건에 출고된 부품 기록은 없습니다."
      );
    } finally {
      setIsLookingUp(false);
    }
  }

  function addUsedPart(part: QuoteIntakeLookup["usedParts"][number]) {
    setItems((prev) => {
      // 빈 첫 줄이 남아 있으면 그 자리를 쓴다 — 담을 때마다 빈 줄이 밀려
      // 내려가면 저장할 때 "품명을 입력해 주세요"가 뜬다.
      const next = prev.filter(
        (row) => !(row.partNameText.trim() === "" && row.unitPrice.trim() === "")
      );
      return [
        ...next,
        {
          key: generateClientUuid(),
          partId: part.partId,
          laborCost: part.laborCost,
          isOverhaulPart: false,
          partNameText: part.partSpec ? `${part.partName} (${part.partSpec})` : part.partName,
          quantity: String(part.quantity),
          // 재고에 정해 둔 그 소유구분의 단가. **null 이면 빈칸으로 둔다** —
          // 0 으로 채우면 정하지 않은 부품을 0원으로 청구하게 된다. "0"은
          // 무상 부품이라는 뜻이라 그대로 채운다(schema/part-unit-prices.ts).
          unitPrice: part.unitPrice === null ? "" : String(Number(part.unitPrice)),
        },
      ];
    });
  }

  function updateItem(key: string, patch: Partial<ItemRow>) {
    setItems((prev) => prev.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  function removeItem(key: string) {
    setItems((prev) => (prev.length === 1 ? [emptyItem()] : prev.filter((row) => row.key !== key)));
  }

  function collectFields() {
    return {
      quoteNumber,
      kind,
      quoteDate,
      repairCaseId,
      intakeNumberText,
      customerId,
      customerNameText,
      modelNameText,
      lotNumberText,
      serialNumberText,
      faultDescriptionText,
      subject,
      validity,
      delivery,
      payment,
      workCost,
      // 통째로 빈 줄은 보내지 않는다 — 사람이 `+ 부품 추가`를 눌러 두고 안 채운
      // 줄이 저장을 막으면, 어디가 문제인지 찾느라 폼을 다시 훑게 된다.
      items: items
        .filter((row) => row.partNameText.trim() !== "" || row.unitPrice.trim() !== "")
        .map((row) => ({
          partId: row.partId,
          // 내자 견적서에는 OH 칸이 없다 — 종류를 바꿔 저장하면 그 표시를 지운다.
          isOverhaulPart: kind === "OVERHAUL" ? row.isOverhaulPart : false,
          partNameText: row.partNameText,
          quantity: Number(row.quantity),
          unitPrice: row.unitPrice,
        })),
    };
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (isSubmitting || isConflict) return;
    setIsSubmitting(true);
    setSubmitError(null);
    setFieldErrors({});

    // 새 장을 만든 뒤에는 화면을 옮기는 중이다. 그 사이에 단추를 되살리면
    // 사람이 한 번 더 눌러 같은 견적서가 두 장 만들어진다 — 아래 finally 가
    // 이 깃발을 보고 `저장 중…` 그대로 둔다.
    let leaving = false;
    try {
      const fields = collectFields();
      const result = quote
        ? await updateQuoteAction({ id: quote.id, expectedVersion: quote.version, fields })
        : await createQuoteAction({ fields });

      if (!result.ok) {
        if (result.code === "CONFLICT") {
          // 낡은 값을 그대로 다시 밀어 넣지 못하게 폼을 얼린다.
          setIsConflict(true);
          setSubmitError(result.message);
          return;
        }
        setFieldErrors(result.fieldErrors ?? {});
        setSubmitError(result.message);
        return;
      }

      if (quote) {
        // 고치기는 이미 이 주소에 있다. 옮길 곳이 없으니 다시 읽기만 한다.
        router.refresh();
        return;
      }

      /**
       * 🔴 만들기는 **옮기기만 한다 — 뒤에 refresh 를 붙이지 않는다.**
       *
       * `router.push()` 바로 뒤에 `router.refresh()` 를 부르면, 아직 끝나지
       * 않은 이동을 새로고침이 덮어쓴다. 새로고침이 다시 그리는 것은 **지금
       * 있는 주소**(/quotes/new)라서, 서버는 새 견적서 화면을 통째로 다시
       * 그리느라 시간을 쓰고 화면은 폼에 그대로 남는다 — 저장은 됐는데 아무
       * 일도 일어나지 않은 것처럼 보인다(2026-08-28 사용자 신고 — "시간이 많이
       * 걸리면서 넘어가지 않는다". 근거는 next/dist 의 refresh-reducer.js 다:
       * "A refresh is modeled as a navigation to the current URL", navigateType
       * = 'replace').
       *
       * 옮겨 간 곳은 force-dynamic 이라 어차피 서버가 새로 그린다 —
       * 새로고침이 할 일이 애초에 없다. 접수 등록(IntakeFormInner)도 저장 뒤
       * push 하나뿐이고, 이 화면만 달랐다.
       */
      leaving = true;
      router.push(`/quotes/${result.id}`);
    } catch (err) {
      // 액션이 대답을 못 하고 끊긴 자리(서버 재시작·네트워크 끊김). 아무 말도
      // 없이 단추만 되살아나면, 저장이 된 건지 만 건지 알 수 없다.
      console.error("견적서 저장 실패", err);
      setSubmitError(SAVE_FAILED_MESSAGE);
    } finally {
      if (!leaving) setIsSubmitting(false);
    }
  }

  const disabled = isSubmitting || isConflict;

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6">
      <div className="flex flex-wrap items-baseline justify-between gap-4">
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
          {quote ? "견적서 수정" : "새 견적서"}
        </h1>
        <div className="flex gap-2">
          {/* 저장된 장에서만 보인다 — 아직 없는 견적서를 받을 수는 없다.
              고친 뒤 저장하지 않고 누르면 **저장된 값**이 나간다. 화면의 값이
              아니라 DB 의 값을 그리는 것이 이 통로의 일이다. */}
          {quote && (
            <a
              href={`/quotes/${quote.id}/print`}
              className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700"
            >
              미리보기 · PDF
            </a>
          )}
          {quote && (
            <a
              href={`/api/quotes/${quote.id}/xlsx`}
              className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700"
            >
              견적서 받기
            </a>
          )}
          <button
            type="button"
            onClick={() => router.push("/quotes")}
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700"
          >
            취소
          </button>
          <button
            type="submit"
            disabled={disabled}
            className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
          >
            {isSubmitting ? "저장 중…" : "저장"}
          </button>
        </div>
      </div>

      {submitError && (
        <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          <p>{submitError}</p>
          {isConflict && (
            <button
              type="button"
              onClick={() => router.refresh()}
              className="mt-2 rounded-md border border-red-300 px-2 py-1 text-xs dark:border-red-800"
            >
              다시 불러오기
            </button>
          )}
        </div>
      )}

      {/* ── 인수번호로 불러오기 ─────────────────────────────────────────── */}
      <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="text-sm font-medium text-zinc-900 dark:text-zinc-50">인수번호로 불러오기</h2>
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          접수 건의 고객사 · 모델명 · L/N · S/N · 신고증상을 아래 칸에 채우고, 그 건에 출고된 부품을
          참고용으로 보여 줍니다. 누르기 전에는 아무것도 바뀌지 않습니다.
        </p>
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1">
            <span className={editLabelClass}>인수번호</span>
            <input
              value={intakeNumberText}
              onChange={(e) => setIntakeNumberText(e.target.value)}
              placeholder="D260706"
              className={editInputClass}
              disabled={disabled}
            />
          </label>
          <button
            type="button"
            onClick={handleLookup}
            disabled={disabled || isLookingUp}
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm disabled:opacity-50 dark:border-zinc-700"
          >
            {isLookingUp ? "불러오는 중…" : "불러오기"}
          </button>
        </div>
        {fieldErrors.intakeNumberText && <p className={editErrorClass}>{fieldErrors.intakeNumberText}</p>}
        {lookupMessage && (
          <p className="mt-2 text-xs text-zinc-600 dark:text-zinc-300">{lookupMessage}</p>
        )}
        {repairCaseId && (
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            접수 건에 연결되어 있습니다. 아래 값을 고쳐도 그 접수 건은 바뀌지 않습니다.
          </p>
        )}
      </section>

      {/* ── 상단 정보 ───────────────────────────────────────────────────── */}
      <section className="grid gap-4 rounded-lg border border-zinc-200 bg-white p-4 sm:grid-cols-2 dark:border-zinc-800 dark:bg-zinc-900">
        {/* 종류가 첫 칸이다 — 무엇을 만드는지 정하고 나머지를 채운다.
            **O/H 대상 판정과는 별개다**: 대상품이어도 일반 견적서와 OH 견적서를
            모두 발행하므로(사용자 확인), 아래 배지는 알려 주기만 하고 이 칸을
            자동으로 바꾸지 않는다. */}
        <Field label="견적서 종류" error={fieldErrors.kind} required>
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as QuoteKind)}
            className={editInputClass}
            disabled={disabled}
          >
            {QUOTE_KINDS.map((value) => (
              <option key={value} value={value}>
                {quoteKindLabels[value]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="발행번호" error={fieldErrors.quoteNumber} required>
          <input
            value={quoteNumber}
            onChange={(e) => setQuoteNumber(e.target.value)}
            placeholder="DSS 2026-077"
            className={editInputClass}
            disabled={disabled}
          />
        </Field>
        <Field label="발행일자" error={fieldErrors.quoteDate} required>
          <input
            type="date"
            value={quoteDate}
            onChange={(e) => setQuoteDate(e.target.value)}
            className={editInputClass}
            disabled={disabled}
          />
        </Field>
        <Field label="공급처" error={fieldErrors.customerNameText} required>
          <input
            value={customerNameText}
            onChange={(e) => {
              setCustomerNameText(e.target.value);
              // 이름을 손으로 고치면 고객사 연결은 끊는다 — 이름과 id 가 서로
              // 다른 곳을 가리키는 상태를 만들지 않는다.
              setCustomerId(null);
            }}
            placeholder="ICD Co.,Ltd"
            className={editInputClass}
            disabled={disabled}
          />
        </Field>
        <Field label="품명(건명)" error={fieldErrors.subject} required>
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="RFK300FH-AD1 Bias Fwd Drop 수리 件"
            className={editInputClass}
            disabled={disabled}
          />
          {/* 종류를 OH 로 바꾸거나 모델명·신고증상을 고친 뒤 다시 지을 수
              있다. 불러오기 때 지어 준 값은 그 시점의 종류 기준이다. */}
          {suggestedSubject !== "" && suggestedSubject !== subject && (
            <div className="mt-1 text-xs text-zinc-600 dark:text-zinc-300">
              <button
                type="button"
                onClick={() => setSubject(suggestedSubject)}
                disabled={disabled}
                className="rounded border border-zinc-300 px-2 py-0.5 text-xs disabled:opacity-50 dark:border-zinc-700"
              >
                자동으로 채우기
              </button>{" "}
              <span className="break-all">{suggestedSubject}</span>
            </div>
          )}
        </Field>
        <Field label="모델명" error={fieldErrors.modelNameText}>
          <input value={modelNameText} onChange={(e) => setModelNameText(e.target.value)} className={editInputClass} disabled={disabled} />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="L/N" error={fieldErrors.lotNumberText}>
            <input value={lotNumberText} onChange={(e) => setLotNumberText(e.target.value)} className={editInputClass} disabled={disabled} />
          </Field>
          <Field label="S/N" error={fieldErrors.serialNumberText}>
            <input value={serialNumberText} onChange={(e) => setSerialNumberText(e.target.value)} className={editInputClass} disabled={disabled} />
          </Field>
        </div>
        <div className="sm:col-span-2">
          {/* S/N 에 생산 연월이 들어 있어 O/H 4년 기준을 볼 수 있다.
              형식이 다른 S/N 이면 아무것도 그리지 않는다(domain/overhaul.ts). */}
          <OverhaulBadge serialNumber={serialNumberText} referenceDate={new Date()} />
        </div>
        <div className="sm:col-span-2">
          <Field label="신고증상" error={fieldErrors.faultDescriptionText}>
            <textarea
              value={faultDescriptionText}
              onChange={(e) => setFaultDescriptionText(e.target.value)}
              className={`${editInputClass} min-h-20 resize-y`}
              disabled={disabled}
            />
          </Field>
        </div>
        <Field label="유효기간" error={fieldErrors.validity} hint="비우면 양식 문구(발행일로부터 4주)">
          <input value={validity} onChange={(e) => setValidity(e.target.value)} className={editInputClass} disabled={disabled} />
        </Field>
        <Field label="납기" error={fieldErrors.delivery} hint="비우면 양식 문구(발주일로부터 3주 이내)">
          <input value={delivery} onChange={(e) => setDelivery(e.target.value)} className={editInputClass} disabled={disabled} />
        </Field>
        <Field label="결재조건" error={fieldErrors.payment} hint="비우면 양식 문구(귀사 결제 조건)">
          <input value={payment} onChange={(e) => setPayment(e.target.value)} className={editInputClass} disabled={disabled} />
        </Field>
      </section>

      {/* ── 사용한 부품 (참고) ──────────────────────────────────────────── */}
      {usedParts.length > 0 && (
        <section className="rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950/40">
          <h2 className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
            이 접수 건에 출고된 부품 <span className="font-normal text-zinc-500 dark:text-zinc-400">(참고용)</span>
          </h2>
          <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-300">
            재고에서 나간 것과 청구하는 것이 늘 같지는 않습니다. 담을 것만 골라 주세요. 단가는 재고 관리에
            소유구분별로 적어 둔 값이 따라오고, 정해 두지 않았으면 빈칸으로 들어옵니다.
          </p>
          <ul className="mt-3 flex flex-col gap-1">
            {usedParts.map((part) => (
              <li key={`${part.partId}|${part.owner ?? ""}`} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="text-zinc-800 dark:text-zinc-200">{part.partName}</span>
                {part.partSpec && (
                  <span className="text-xs text-zinc-500 dark:text-zinc-400">{part.partSpec}</span>
                )}
                <span className="text-xs text-zinc-500 dark:text-zinc-400">
                  {stockOwnerLabelOrUnspecified(part.owner)} · {part.quantity}개 출고
                </span>
                <span className="text-xs text-zinc-500 dark:text-zinc-400">
                  {part.unitPrice === null ? (
                    <span className="text-amber-700 dark:text-amber-400">단가 미정</span>
                  ) : (
                    `단가 ₩${AMOUNT_FORMAT.format(Number(part.unitPrice))}`
                  )}
                </span>
                <button
                  type="button"
                  onClick={() => addUsedPart(part)}
                  disabled={disabled}
                  className="rounded border border-zinc-300 px-2 py-0.5 text-xs disabled:opacity-50 dark:border-zinc-700"
                >
                  부품 줄에 담기
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ── 부품 줄 ─────────────────────────────────────────────────────── */}
      <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-medium text-zinc-900 dark:text-zinc-50">부품 비용</h2>
          <button
            type="button"
            onClick={() => setItems((prev) => [...prev, emptyItem()])}
            disabled={disabled || items.length >= MAX_QUOTE_ITEMS}
            className="rounded-md border border-zinc-300 px-2 py-1 text-xs disabled:opacity-50 dark:border-zinc-700"
          >
            + 부품 추가
          </button>
        </div>

        {kind === "OVERHAUL" && (
          <p className="mt-2 text-xs text-zinc-600 dark:text-zinc-300">
            <b>OH</b> 를 체크한 줄은 양식의 <b>2) OH 부품 비용</b> 칸(13줄)으로 갑니다. 체크하지 않은 줄은
            <b> 1) 부품 비용</b> 칸(5줄)입니다.
          </p>
        )}
        {items.length > 5 && (
          <p className="mt-2 rounded-md bg-amber-100 p-2 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-200">
            부품이 {items.length}줄입니다. 양식의 부품 칸은 다섯 줄이라, 견적서 파일에는{" "}
            <b>&ldquo;부품 비용 일괄&rdquo; 한 줄로 합산되어</b> 나갑니다. 상세 목록은 이 화면에 그대로
            남습니다.
          </p>
        )}

        <div className="mt-3 flex flex-col gap-2">
          {items.map((row, index) => (
            <div key={row.key} className={`grid grid-cols-1 gap-2 ${kind === "OVERHAUL" ? "sm:grid-cols-[1fr_5rem_8rem_auto_auto]" : "sm:grid-cols-[1fr_5rem_8rem_auto]"}`}>
              <div>
                <input
                  value={row.partNameText}
                  onChange={(e) => updateItem(row.key, { partNameText: e.target.value, partId: null })}
                  placeholder={`${index + 1}번째 부품 품명`}
                  className={editInputClass}
                  disabled={disabled}
                />
                {fieldErrors[`items.${index}.partNameText`] && (
                  <p className={editErrorClass}>{fieldErrors[`items.${index}.partNameText`]}</p>
                )}
              </div>
              <div>
                <input
                  value={row.quantity}
                  onChange={(e) => updateItem(row.key, { quantity: e.target.value })}
                  inputMode="numeric"
                  aria-label={`${index + 1}번째 부품 수량`}
                  className={editInputClass}
                  disabled={disabled}
                />
                {fieldErrors[`items.${index}.quantity`] && (
                  <p className={editErrorClass}>{fieldErrors[`items.${index}.quantity`]}</p>
                )}
              </div>
              <div>
                <input
                  value={row.unitPrice}
                  onChange={(e) => updateItem(row.key, { unitPrice: e.target.value })}
                  inputMode="decimal"
                  placeholder="단가"
                  aria-label={`${index + 1}번째 부품 단가`}
                  className={editInputClass}
                  disabled={disabled}
                />
                {fieldErrors[`items.${index}.unitPrice`] && (
                  <p className={editErrorClass}>{fieldErrors[`items.${index}.unitPrice`]}</p>
                )}
              </div>
              {kind === "OVERHAUL" && (
                <label className="flex items-center gap-1 whitespace-nowrap text-xs text-zinc-600 dark:text-zinc-300">
                  <input
                    type="checkbox"
                    checked={row.isOverhaulPart}
                    onChange={(e) => updateItem(row.key, { isOverhaulPart: e.target.checked })}
                    disabled={disabled}
                  />
                  OH
                </label>
              )}
              <button
                type="button"
                onClick={() => removeItem(row.key)}
                disabled={disabled}
                aria-label={`${index + 1}번째 부품 줄 지우기`}
                className="rounded-md border border-zinc-300 px-2 text-sm text-zinc-500 disabled:opacity-50 dark:border-zinc-700"
              >
                ×
              </button>
            </div>
          ))}
        </div>
        {fieldErrors.items && <p className={editErrorClass}>{fieldErrors.items}</p>}

        <div className="mt-4 max-w-md">
          <Field label="작업비" error={fieldErrors.workCost} hint="부품 작업비의 합">
            <input
              value={workCost}
              onChange={(e) => setWorkCost(e.target.value)}
              inputMode="decimal"
              className={editInputClass}
              disabled={disabled}
            />
          </Field>
          {(laborSuggestion.total > 0 || laborSuggestion.unknown.length > 0) && (
            <div className="mt-2 text-xs text-zinc-600 dark:text-zinc-300">
              부품 작업비 합계{" "}
              <b className="tabular-nums">{formatAmount(laborSuggestion.total)}</b>
              <button
                type="button"
                onClick={() => setWorkCost(String(laborSuggestion.total))}
                disabled={disabled}
                className="ml-2 rounded border border-zinc-300 px-2 py-0.5 text-xs disabled:opacity-50 dark:border-zinc-700"
              >
                작업비에 적용
              </button>
              {laborSuggestion.unknown.length > 0 && (
                <p className="mt-1 text-amber-700 dark:text-amber-400">
                  작업비를 정하지 않은 부품이 있어 합계에서 빠졌습니다:{" "}
                  {laborSuggestion.unknown.join(", ")} — 재고 관리에서 그 부품의 작업비를 적어 주세요.
                </p>
              )}
            </div>
          )}
        </div>
      </section>

      {/* ── 합계 미리보기 ───────────────────────────────────────────────── */}
      <section className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 text-sm dark:border-zinc-800 dark:bg-zinc-900">
        <dl className="flex flex-wrap justify-end gap-x-8 gap-y-1 tabular-nums">
          <div className="flex gap-3">
            <dt className="text-zinc-500 dark:text-zinc-400">공 급 가</dt>
            <dd className="text-zinc-900 dark:text-zinc-50">{formatAmount(supplyAmount)}</dd>
          </div>
          <div className="flex gap-3">
            <dt className="text-zinc-500 dark:text-zinc-400">부 가 세</dt>
            <dd className="text-zinc-900 dark:text-zinc-50">{formatAmount(vat)}</dd>
          </div>
          <div className="flex gap-3 font-medium">
            <dt className="text-zinc-500 dark:text-zinc-400">합　　계</dt>
            <dd className="text-zinc-900 dark:text-zinc-50">{formatAmount(supplyAmount + vat)}</dd>
          </div>
        </dl>
        <p className="mt-2 text-right text-xs text-zinc-500 dark:text-zinc-400">
          미리보기입니다. 저장되는 값은 수량과 단가뿐이고, 견적서 파일에서는 양식의 수식이 계산합니다.
        </p>
      </section>
    </form>
  );
}

function Field({
  label,
  error,
  hint,
  required,
  children,
}: {
  label: string;
  error?: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className={editLabelClass}>
        {label}
        {required && <span className="ml-0.5 text-red-500">*</span>}
        {hint && <span className="ml-2 font-normal text-zinc-400 dark:text-zinc-500">{hint}</span>}
      </span>
      {children}
      {error && <p className={editErrorClass}>{error}</p>}
    </label>
  );
}

