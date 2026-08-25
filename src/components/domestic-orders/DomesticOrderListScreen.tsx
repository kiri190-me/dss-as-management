"use client";

import { useMemo, useState, type MouseEvent } from "react";
import { useRouter } from "next/navigation";
import { LIST_CARD_GRID, ResponsiveList } from "@/components/common/responsive-list";
import type { DomesticOrderListItem, RepairCaseLinkOption } from "@/lib/db/queries/domestic-orders";
import {
  collectDomesticOrderYears,
  countDomesticOrdersWithoutOrderYear,
  filterDomesticOrdersByYear,
  groupDomesticOrdersByCustomer,
  isDomesticOrderCompleted,
  resolveInitialDomesticOrderYear,
} from "@/lib/domain/domestic-order-list";
import { setDomesticOrderCompletionAction } from "@/lib/server/actions/domestic-orders";
import DomesticOrderEditForm from "./DomesticOrderEditForm";

/**
 * ============================================================================
 * 내자 정리 — 목록과 한 줄 편집 (2단계) + 년도 · 완료 · 고객사 묶기 (3단계)
 * ============================================================================
 * 손으로 관리하던 `내자 시트`를 그대로 옮겨 놓은 화면이다. 표의 22칼럼·머리말·
 * 합계는 1단계 그대로이고, 그 위에 **행 추가**와 **줄 수정**(2단계),
 * **발주 년도 고르기 · 완료 처리 · 고객사 묶기**(3단계)를 얹었다.
 * 삭제·휴지통은 아직 없다.
 *
 * ── 무엇을 보여 줄지 정하는 규칙은 여기 없다 ────────────────────────────
 * 년도 후보를 뽑고, 년도로 거르고, 고객사로 묶고, 완료인지 판정하는 일은
 * domain/domestic-order-list.ts 가 한다. 이 파일은 그 결과를 그릴 뿐이다 —
 * 규칙을 화면 안에 두면 "발주일 없는 줄이 왜 안 사라지는가" 같은 것을 시험할
 * 방법이 브라우저를 띄우는 것밖에 없어진다.
 *
 * ── 발주일 없는 줄은 어느 년도에서도 함께 보인다 ────────────────────────
 * 그 줄은 아직 발주가 나지 않았다는 뜻이라 가장 챙겨야 하는 줄이다. 년도로
 * 감추면 어느 해를 골라도 나오지 않아 잊힌다. 그래서 년도 칸 옆에 몇 건인지
 * 적고, 그 줄의 **발주발행일 칸에 `발주일 미정`을 띄운다** — "-"로만 두면
 * 왜 2026년을 골랐는데 이 줄이 함께 있는지 알 길이 없다.
 *
 * ── 완료는 감추는 것이 아니라 회색으로 두는 것이다 ──────────────────────
 * 완료된 줄도 자리를 지킨다. 아래로 내리거나 접지 않는다 — 이 표에는 사람이
 * 매긴 순번이 있어서, 순서를 흔들면 순번 칸과 눈에 보이는 차례가 어긋난다.
 * 회색이지만 글자는 흐리게 하지 않고 여전히 눌러서 고칠 수 있다. 회색이
 * "못 누른다"로 읽히면 완료된 줄의 입금 사실을 나중에 적을 수 없게 된다.
 *
 * ── 고칠 수 없는 사람에게는 1단계와 똑같이 보인다 ───────────────────────
 * canEdit 이 거짓이면 추가 버튼도, 누를 수 있는 줄도 없다. 그것은 편의일 뿐
 * 경계가 아니라서, 서버 액션은 화면이 무엇을 그렸든 매번 다시 검사한다
 * (server/actions/domestic-orders.ts).
 *
 * ── 표 22칼럼, 가로 스크롤은 표 안에서만 ────────────────────────────────
 * 시트의 22칼럼을 순서 그대로 둔다. 이 표는 웬만한 화면 폭에 들어가지 않는데,
 * 스크롤 래퍼를 여기서 따로 두르지 않는다 — ResponsiveList 가 표 껍데기를
 * 소유하고(그 파일의 '표 껍데기는 여기가 소유한다'), overflow-x-auto 도 거기
 * 있다. 여기서 한 겹 더 감싸면 넘침이 안쪽에서 흡수돼 바깥은 영원히
 * "들어간다"고 답하고, 그러면 표/카드 자동 전환이 고장 난다. 스크롤이 표
 * 컨테이너 안에서만 일어나므로 화면 전체(body)는 좌우로 밀리지 않는다.
 *
 * 표/카드 전환을 여기서 분기하지 않는 것도 같은 이유다 — 서비스 전체에서
 * 목록의 기준은 responsive-list.tsx 하나뿐이다.
 *
 * ── 빈 값은 "-" ────────────────────────────────────────────────────────
 * 시트에는 아직 안 정해진 칸이 많다(견적은 냈는데 납품 전, 납품은 했는데 입금
 * 전). 빈 칸을 그냥 비워 두면 표가 어디까지가 한 줄인지 읽히지 않아서, 이
 * 저장소의 다른 목록과 같이 "-"로 채운다. 자료를 "-"로 바꾸는 일은 화면에서만
 * 한다 — 질의 쪽은 null 을 null 그대로 내려보낸다(queries/domestic-orders.ts).
 *
 * ── 금액은 문자열로 받아 정수로 더한다 ──────────────────────────────────
 * numeric 컬럼이라 문자열로 온다. 소수점이 있는 채로 더하면 합계가
 * 세금계산서와 1원씩 어긋나기 시작하므로(부동소수 오차), **소수점을 없앤
 * 정수**로 바꿔 더하고 다시 문자열로 되돌린다(toMinorUnits 주석). 표시는
 * tabular-nums 로 자릿수를 맞춰 오른쪽 정렬한다 — 금액은 자릿수를 세로로 훑어
 * 읽는 값이다.
 * ============================================================================
 */

/**
 * 발주일이 아직 없는 줄의 발주발행일 칸에 적는 말. "-"(그냥 빈 값)와 구분한다 —
 * 이 줄이 년도와 상관없이 늘 보이는 이유가 바로 이 칸이기 때문이다.
 */
const NO_ORDER_DATE_LABEL = "발주일 미정";

/** 표의 칼럼 수. 고객사 소제목 줄이 표 전체 폭을 덮는 데 쓴다. */
const TABLE_COLUMN_COUNT = 22;

/** 빈 값의 표시. 이 화면의 모든 칸이 같은 글자를 쓴다. */
function dash(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "-";
  if (typeof value === "number") return String(value);
  return value.trim() === "" ? "-" : value;
}

/**
 * "1234567.00" → 123456700(전 단위 정수). 형식이 어긋나면 null 이고, 그 행은
 * 합계에서 조용히 빠지는 대신 화면에 원문 그대로 보인다 — 잘못된 값을 0으로
 * 세면 합계가 맞는 것처럼 보이기만 한다.
 *
 * BigInt 를 쓰지 않는 이유는 tsconfig 의 target 이 ES2017 이라 BigInt 리터럴이
 * 컴파일되지 않아서다. 대신 **정수만 다룬다** — 소수점을 없애 놓고 더하므로
 * 0.1 + 0.2 류의 오차가 애초에 생기지 않는다. 자바스크립트의 number 는
 * 2^53-1(약 90조 전 = 9000억 원)까지 정수를 정확히 담으므로 이 표의 금액에는
 * 남는다. 그 위로 넘어가면 정확성을 보장할 수 없으므로 null 로 돌려보내
 * 합계에서 빼고 화면에는 원문을 보여 준다.
 */
function toMinorUnits(value: string): number | null {
  const matched = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!matched) return null;
  const sign = matched[1] === "-" ? -1 : 1;
  const whole = Number(matched[2]);
  const fraction = Number((matched[3] ?? "0").padEnd(2, "0"));
  const minor = sign * (whole * 100 + fraction);
  return Number.isSafeInteger(minor) ? minor : null;
}

function groupDigits(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** 전 단위 정수를 사람이 읽는 금액으로. 소수점 이하가 0이면 적지 않는다. */
function formatMinorUnits(minor: number): string {
  const isNegative = minor < 0;
  const absolute = Math.abs(minor);
  const whole = Math.floor(absolute / 100);
  const fraction = absolute % 100;
  const body =
    fraction === 0
      ? groupDigits(String(whole))
      : `${groupDigits(String(whole))}.${String(fraction).padStart(2, "0")}`;
  return isNegative ? `-${body}` : body;
}

function formatAmount(value: string | null): string {
  if (value === null) return "-";
  const minor = toMinorUnits(value);
  // 파싱에 실패하면 원문을 그대로 보여 준다. 숨기면 이상한 값이 들어와 있다는
  // 사실 자체가 화면에서 사라진다.
  return minor === null ? value : formatMinorUnits(minor);
}

function sumAmounts(rows: DomesticOrderListItem[]): { total: string; skipped: number } {
  let total = 0;
  let skipped = 0;
  for (const row of rows) {
    if (row.amountExcludingVat === null) continue;
    const minor = toMinorUnits(row.amountExcludingVat);
    // 합계 자체가 안전 정수 범위를 넘으면 그 뒤의 값은 믿을 수 없다 — 더하지
    // 않고 뺀 건수로 센다.
    if (minor === null || !Number.isSafeInteger(total + minor)) {
      skipped += 1;
      continue;
    }
    total += minor;
  }
  return { total: formatMinorUnits(total), skipped };
}

/** 입금완료 여부 — boolean 을 시트의 말로 되돌린다. */
function paymentLabel(completed: boolean): string {
  return completed ? "완료" : "미완료";
}

/**
 * 시트 머리말. 원본 2~8행을 그대로 옮긴다.
 *
 * 이 화면은 목록이기 전에 **고객사에 보내는 문서**다. 인사문과 연락 안내가
 * 빠지면 표만 남고, 그러면 이 자료가 무엇을 위한 것인지가 사라진다. 날짜는
 * 서버가 정해 내려보낸다 — 클라이언트에서 new Date() 를 부르면 서버가 그린
 * 것과 달라져 hydration 이 어긋난다.
 */
function SheetHeading({ asOfDate }: { asOfDate: string }) {
  return (
    <section className="flex flex-col gap-2 rounded-lg border border-zinc-200 bg-white p-4 text-sm text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">내자 정리</h1>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">{asOfDate} 기준</p>
      </div>
      <ol className="flex list-none flex-col gap-1">
        <li>1. 귀사의 일익 번창하심을 기원합니다.</li>
        <li>2. 납품 및 수리 관련하여 {asOfDate}자 진행 상황입니다.</li>
        <li className="pl-4">
          2) 수리품 반입/반출 및 기타 변동이 있을 경우 김유진 과장에게 전달해 주세요.
        </li>
        <li className="pl-4">3) 본 내용 변경을 요하거나 의견 있으면 주세요.</li>
      </ol>
      {/* 시트 머리말에 함께 적혀 있던 내부 메모다. 고객사에 보내는 문장이
          아니라 우리 쪽 확인 사항이라 따로 떼어 둔다 — 위 인사문과 같은 줄에
          두면 문서에 그대로 실려 나갈 말처럼 읽힌다. */}
      <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-200">
        내부 메모 — 발주 받으면 인사회신 잊지말기 (회신 前 수리소완성일 확인 必!) · 2023.08.23
      </p>
    </section>
  );
}

const CARD_FIELD_GROUPS: { label: string; fields: { label: string; of: (row: DomesticOrderListItem) => string }[] }[] = [
  {
    label: "발주",
    fields: [
      { label: "발주서번호", of: (row) => dash(row.purchaseOrderNumber) },
      { label: "PJT", of: (row) => dash(row.projectName) },
      // 표와 같은 말을 쓴다 — 카드로 보고 있어도 이 줄이 왜 늘 보이는지 알 수
      // 있어야 한다.
      {
        label: "발주발행일",
        of: (row) => (row.orderIssuedDate === null ? NO_ORDER_DATE_LABEL : row.orderIssuedDate),
      },
      { label: "납기요청일", of: (row) => dash(row.requestedDueDate) },
    ],
  },
  {
    label: "제품",
    fields: [
      { label: "형식", of: (row) => dash(row.modelName) },
      { label: "L/N", of: (row) => dash(row.lotNumber) },
      { label: "S/N", of: (row) => dash(row.serialNumber) },
      { label: "고장내역", of: (row) => dash(row.reportedSymptom) },
    ],
  },
  {
    label: "견적 · 납품",
    fields: [
      { label: "견적발행일", of: (row) => dash(row.quoteIssuedDate) },
      { label: "견적서번호", of: (row) => dash(row.quoteNumber) },
      { label: "현황", of: (row) => dash(row.progressNote) },
      { label: "납품일", of: (row) => dash(row.deliveredDate) },
      { label: "납품자", of: (row) => dash(row.deliveredBy) },
    ],
  },
  {
    label: "정산",
    fields: [
      { label: "세금계산서발행일", of: (row) => dash(row.taxInvoiceDate) },
      { label: "금액(VAT별도)", of: (row) => formatAmount(row.amountExcludingVat) },
      { label: "입금완료 여부", of: (row) => paymentLabel(row.paymentCompleted) },
      { label: "일본 송금", of: (row) => dash(row.japanRemittanceNote) },
    ],
  },
  {
    label: "기타",
    fields: [
      { label: "이력", of: (row) => dash(row.historyNote) },
      { label: "기타", of: (row) => dash(row.etcNote) },
    ],
  },
];

/**
 * 완료된 줄에 붙는 표. 회색 배경만으로는 "왜 회색인지"를 말하지 못한다 —
 * 색을 구분하기 어려운 사람에게는 이 글자가 유일한 단서다.
 */
function CompletedBadge() {
  return (
    <span className="rounded bg-zinc-700 px-1.5 py-0.5 text-[11px] leading-none font-medium text-white dark:bg-zinc-300 dark:text-zinc-900">
      완료
    </span>
  );
}

/**
 * 완료 처리 · 완료 해제 버튼. 고칠 수 있는 사람에게만 그려지지만, 그것은
 * 편의일 뿐 경계가 아니다 — 서버 액션이 매번 다시 검사한다.
 *
 * 줄 전체가 '수정 폼 열기' 버튼이라 여기서 stopPropagation 을 한다. 하지
 * 않으면 완료를 누르는 순간 폼이 함께 열려, 방금 바뀐 값이 아니라 낡은 값을
 * 담은 폼이 뜬다.
 *
 * 실패는 조용히 넘기지 않고 부르는 쪽에 올린다. 특히 CONFLICT 는 그 사이 남이
 * 이 줄을 고쳤다는 뜻이라, 아무 일도 없었던 것처럼 두면 사람은 완료가 된 줄
 * 안다.
 */
function CompletionToggle({
  row,
  onError,
}: {
  row: DomesticOrderListItem;
  onError: (message: string | null) => void;
}) {
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);
  const completed = isDomesticOrderCompleted(row);

  async function toggle(event: MouseEvent<HTMLButtonElement>) {
    event.stopPropagation();
    if (isPending) return;
    setIsPending(true);
    onError(null);
    try {
      const result = await setDomesticOrderCompletionAction({
        id: row.id,
        expectedVersion: row.version,
        completed: !completed,
      });
      if (!result.ok) {
        onError(result.message);
        return;
      }
      router.refresh();
    } finally {
      setIsPending(false);
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={isPending}
      className="rounded border border-zinc-300 bg-white px-1.5 py-0.5 text-[11px] leading-none text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-700"
    >
      {completed ? "완료 해제" : "완료 처리"}
    </button>
  );
}

/**
 * 지금 무엇을 편집하고 있는가. null 이면 편집 중이 아니고, "new" 는 행 추가,
 * 그 밖의 값은 그 id 의 줄을 고치는 중이다.
 *
 * 하나의 상태로 묶어 둔 이유: "추가 중"과 "수정 중"을 각각 두면 둘 다 참인
 * 상태가 만들어질 수 있고, 그러면 화면에 폼이 두 개 뜬다.
 */
type EditTarget = { kind: "new" } | { kind: "row"; id: string } | null;

export default function DomesticOrderListScreen({
  rows,
  asOfDate,
  currentYear,
  canEdit,
  repairCaseOptions,
}: {
  rows: DomesticOrderListItem[];
  /** 서버가 정한 "오늘". 머리말의 진행 상황 날짜다. */
  asOfDate: string;
  /**
   * 서버가 한국 표준시로 정한 "올해"("YYYY"). 발주 년도 칸의 기본값이다 —
   * 클라이언트에서 정하면 서버가 그린 것과 달라진다(page.tsx 주석).
   */
  currentYear: string;
  /** 행을 추가·수정할 수 있는가. 거짓이면 1단계와 똑같이 보인다. */
  canEdit: boolean;
  /** 수정 폼의 '수리 건 연결' 목록. 고칠 수 없는 역할에게는 빈 배열이다. */
  repairCaseOptions: RepairCaseLinkOption[];
}) {
  const [editTarget, setEditTarget] = useState<EditTarget>(null);
  const [selectedYear, setSelectedYear] = useState<string | null>(null);
  const [completionError, setCompletionError] = useState<string | null>(null);

  const years = useMemo(() => collectDomesticOrderYears(rows), [rows]);
  /**
   * 아직 고른 적이 없으면(selectedYear === null) 올해가 기본값이고, 골라 둔
   * 해가 목록에서 사라졌으면(그 해의 마지막 줄에서 발주일을 지운 경우) 다시
   * 기본값으로 내려온다. effect 로 되돌리지 않고 매번 계산하는 이유는, 그 사이
   * 한 프레임 동안 없는 해가 골라진 화면이 스쳐 지나가지 않게 하기 위해서다.
   */
  const activeYear =
    selectedYear !== null && years.includes(selectedYear)
      ? selectedYear
      : resolveInitialDomesticOrderYear(years, currentYear);

  const visibleRows = useMemo(
    () => filterDomesticOrdersByYear(rows, activeYear),
    [rows, activeYear]
  );
  const groups = useMemo(() => groupDomesticOrdersByCustomer(visibleRows), [visibleRows]);
  const alwaysVisibleCount = useMemo(() => countDomesticOrdersWithoutOrderYear(rows), [rows]);

  // 합계는 1단계와 같은 함수다. 다만 **지금 보이는 줄**을 더한다 — 화면에 없는
  // 해의 금액이 합계에 섞이면, 표를 세로로 훑어 더한 값과 맞지 않는다.
  const { total, skipped } = sumAmounts(visibleRows);

  const editingRow =
    editTarget?.kind === "row" ? (rows.find((row) => row.id === editTarget.id) ?? null) : null;
  // 고치려던 줄이 목록에서 사라졌으면(남이 지웠다) 폼을 열지 않는다 — 없는
  // 줄에 대고 저장해 봐야 NOT_FOUND 만 돌아온다.
  const isFormOpen = editTarget?.kind === "new" || editingRow !== null;

  function openRow(id: string) {
    if (!canEdit) return;
    setEditTarget({ kind: "row", id });
  }

  return (
    <div className="flex flex-col gap-4">
      <SheetHeading asOfDate={asOfDate} />

      {isFormOpen && (
        <DomesticOrderEditForm
          // 다른 줄을 누르면 폼 전체를 새로 만든다. key 가 없으면 이전 줄의
          // 입력 상태가 그대로 남아 다른 줄에 저장된다.
          key={editTarget?.kind === "new" ? "new" : editingRow?.id}
          row={editingRow}
          repairCaseOptions={repairCaseOptions}
          onDone={() => setEditTarget(null)}
        />
      )}

      {years.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <label
            className="text-sm font-medium text-zinc-700 dark:text-zinc-300"
            htmlFor="domestic-order-year"
          >
            발주 년도
          </label>
          <select
            id="domestic-order-year"
            value={activeYear ?? ""}
            onChange={(e) => setSelectedYear(e.target.value)}
            className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
          >
            {/* 자료에 있는 해만 낸다 — 없는 해를 고르면 빈 표가 나오고, 그것이
                자료가 없다는 뜻인지 해가 없다는 뜻인지 구분되지 않는다. */}
            {years.map((year) => (
              <option key={year} value={year}>
                {year}년
              </option>
            ))}
          </select>
          {alwaysVisibleCount > 0 && (
            <p className="text-xs text-amber-800 dark:text-amber-300">
              {NO_ORDER_DATE_LABEL} {alwaysVisibleCount}건은 어느 년도를 골라도 함께 보입니다.
            </p>
          )}
        </div>
      )}

      {completionError && (
        <p
          role="status"
          className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
        >
          {completionError}
        </p>
      )}

      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <p aria-live="polite" className="text-sm text-zinc-600 dark:text-zinc-400">
            {activeYear !== null && `${activeYear}년 `}
            {visibleRows.length}건
            {visibleRows.length !== rows.length && (
              <span className="ml-1 text-xs text-zinc-500 dark:text-zinc-500">
                (전체 {rows.length}건)
              </span>
            )}
          </p>
          {canEdit && !isFormOpen && (
            <button
              type="button"
              onClick={() => setEditTarget({ kind: "new" })}
              className="rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
            >
              행 추가
            </button>
          )}
        </div>
        <p className="text-sm text-zinc-700 dark:text-zinc-300">
          합계 <span className="font-semibold tabular-nums">{total}</span>{" "}
          <span className="text-xs text-zinc-500 dark:text-zinc-400">(부가세미포함)</span>
          {skipped > 0 && (
            <span className="ml-2 text-xs text-red-600 dark:text-red-400">
              금액을 읽을 수 없는 {skipped}건은 합계에서 빠졌습니다
            </span>
          )}
        </p>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-zinc-200 bg-white p-8 text-center text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
          등록된 내자 정리 항목이 없습니다.
        </div>
      ) : (
        <ResponsiveList
          listId="domestic-orders"
          // 년도를 바꾸면 줄 수가, 완료 버튼이 붙고 떨어지면 순번 칸의 폭이
          // 달라진다 — 표가 지금 폭에 들어가는지 다시 재야 하는 조건들이다.
          measureKey={[visibleRows.length, groups.length, canEdit]}
          table={
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-zinc-200 bg-white text-left text-xs font-semibold whitespace-nowrap text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
                  <th className="px-3 py-2">순번</th>
                  <th className="px-3 py-2">고객사</th>
                  <th className="px-3 py-2">발주서번호</th>
                  <th className="px-3 py-2">PJT</th>
                  <th className="px-3 py-2">발주발행일</th>
                  <th className="px-3 py-2">납기요청일</th>
                  <th className="px-3 py-2">인수번호</th>
                  <th className="px-3 py-2">형식</th>
                  <th className="px-3 py-2">L/N</th>
                  <th className="px-3 py-2">S/N</th>
                  <th className="px-3 py-2">고장내역</th>
                  <th className="px-3 py-2">견적발행일</th>
                  <th className="px-3 py-2">견적서번호</th>
                  <th className="px-3 py-2">현황</th>
                  <th className="px-3 py-2">납품일</th>
                  <th className="px-3 py-2">납품자</th>
                  <th className="px-3 py-2">세금계산서발행일</th>
                  <th className="px-3 py-2 text-right">금액(VAT별도)</th>
                  <th className="px-3 py-2">입금완료 여부</th>
                  <th className="px-3 py-2">일본 송금</th>
                  <th className="px-3 py-2">이력</th>
                  <th className="px-3 py-2">기타</th>
                </tr>
              </thead>
              {/* 고객사마다 <tbody> 를 하나씩 둔다. 한 표 안에 tbody 가 여럿인
                  것은 표준 그대로이고, 소제목 줄이 그 묶음에 속한다는 사실이
                  구조로 드러난다. */}
              {groups.map((group) => (
                <tbody key={group.customerName ?? "__unassigned__"}>
                  <tr className="border-y border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-800/60">
                    <th
                      colSpan={TABLE_COLUMN_COUNT}
                      // 이 머리글은 뒤따르는 줄 묶음 전체에 걸린다 — colgroup 이
                      // 아니라 rowgroup 이다. 화면 낭독기가 각 줄을 읽을 때
                      // 어느 고객사의 줄인지 함께 말해 준다.
                      scope="rowgroup"
                      className="px-3 py-1.5 text-left text-xs font-semibold whitespace-nowrap text-zinc-700 dark:text-zinc-200"
                    >
                      {/* 22칼럼짜리 표라 옆으로 밀어 보는 일이 많다. 소제목만
                          왼쪽에 붙여 두면 어느 고객사의 줄을 보고 있는지
                          스크롤 중에도 놓치지 않는다. */}
                      <span className="sticky left-0 inline-flex items-baseline gap-2">
                        {group.label}
                        <span className="font-normal text-zinc-500 dark:text-zinc-400">
                          {group.rows.length}건
                        </span>
                      </span>
                    </th>
                  </tr>
                  {group.rows.map((row) => {
                    const completed = isDomesticOrderCompleted(row);
                    return (
                      <tr
                        key={row.id}
                        // 줄 아무 데나 눌러도 열린다. 다만 이것만으로는 키보드로
                        // 닿을 수 없으므로, 인수번호 칸에 진짜 <button>을 둔다
                        // (아래) — 칼럼을 하나 더 만들지 않고 22칼럼을 지키면서
                        // 포커스 가능한 조작을 주는 방법이다. 완료 버튼도 같은
                        // 이유로 순번 칸 안에 있다.
                        onClick={canEdit ? () => openRow(row.id) : undefined}
                        className={`border-b border-zinc-100 whitespace-nowrap last:border-0 dark:border-zinc-800 ${
                          // 완료된 줄은 회색이지만 **글자를 흐리게 하지 않는다** —
                          // 흐리게 하면 못 누르는 줄로 읽힌다. hover 도 그대로
                          // 살아 있어서 여전히 누를 수 있다는 것이 보인다.
                          completed
                            ? "bg-zinc-200 hover:bg-zinc-300 dark:bg-zinc-800 dark:hover:bg-zinc-700"
                            : "hover:bg-zinc-50 dark:hover:bg-zinc-800/60"
                        } ${canEdit ? "cursor-pointer" : ""}`}
                      >
                        <td className="px-3 py-2">
                          <span className="flex items-center gap-2">
                            <span className="tabular-nums">{dash(row.displayOrder)}</span>
                            {completed && <CompletedBadge />}
                            {canEdit && <CompletionToggle row={row} onError={setCompletionError} />}
                          </span>
                        </td>
                        <td className="px-3 py-2">{dash(row.customerName)}</td>
                        <td className="px-3 py-2">{dash(row.purchaseOrderNumber)}</td>
                        <td className="px-3 py-2">{dash(row.projectName)}</td>
                        {/* 발주일이 없는 줄은 "-" 대신 이유를 적는다 — 이 줄이
                            년도와 상관없이 늘 보이는 근거가 이 칸이다. */}
                        <td className="px-3 py-2 tabular-nums">
                          {row.orderIssuedDate === null ? (
                            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] leading-none text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                              {NO_ORDER_DATE_LABEL}
                            </span>
                          ) : (
                            row.orderIssuedDate
                          )}
                        </td>
                        <td className="px-3 py-2 tabular-nums">{dash(row.requestedDueDate)}</td>
                        {/* 연결이 없는 줄은 시트에 적혀 있던 글자를 그대로 보여 준다
                            (queries 의 displayIntakeNumber). 빈 줄로 두면 이어 붙일
                            단서가 화면에서 사라진다. */}
                        <td className="px-3 py-2 font-medium text-zinc-900 dark:text-zinc-50">
                          {canEdit ? (
                            <button
                              type="button"
                              onClick={() => openRow(row.id)}
                              className="underline decoration-dotted underline-offset-2 hover:decoration-solid"
                            >
                              {dash(row.displayIntakeNumber)}
                              <span className="sr-only"> 줄 수정</span>
                            </button>
                          ) : (
                            dash(row.displayIntakeNumber)
                          )}
                        </td>
                        <td className="px-3 py-2">{dash(row.modelName)}</td>
                        <td className="px-3 py-2">{dash(row.lotNumber)}</td>
                        <td className="px-3 py-2">{dash(row.serialNumber)}</td>
                        <td className="px-3 py-2">{dash(row.reportedSymptom)}</td>
                        <td className="px-3 py-2 tabular-nums">{dash(row.quoteIssuedDate)}</td>
                        <td className="px-3 py-2">{dash(row.quoteNumber)}</td>
                        <td className="px-3 py-2">{dash(row.progressNote)}</td>
                        <td className="px-3 py-2 tabular-nums">{dash(row.deliveredDate)}</td>
                        <td className="px-3 py-2">{dash(row.deliveredBy)}</td>
                        <td className="px-3 py-2 tabular-nums">{dash(row.taxInvoiceDate)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {formatAmount(row.amountExcludingVat)}
                        </td>
                        <td className="px-3 py-2">{paymentLabel(row.paymentCompleted)}</td>
                        <td className="px-3 py-2">{dash(row.japanRemittanceNote)}</td>
                        <td className="px-3 py-2">{dash(row.historyNote)}</td>
                        <td className="px-3 py-2">{dash(row.etcNote)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              ))}
            </table>
          }
          cards={
            // 카드에서도 같은 묶음이 보여야 한다 — 표에서 보던 것과 다른 순서로
            // 읽히면 좁은 화면으로 옮긴 순간 다른 자료처럼 보인다.
            <div className="flex flex-col gap-5">
              {groups.map((group) => (
                <section key={group.customerName ?? "__unassigned__"} className="flex flex-col gap-2">
                  <h2 className="flex items-baseline gap-2 text-sm font-semibold text-zinc-800 dark:text-zinc-100">
                    {group.label}
                    <span className="text-xs font-normal text-zinc-500 dark:text-zinc-400">
                      {group.rows.length}건
                    </span>
                  </h2>
                  <div className={LIST_CARD_GRID}>
                    {group.rows.map((row) => {
                      const completed = isDomesticOrderCompleted(row);
                      return (
                        <div
                          key={row.id}
                          onClick={canEdit ? () => openRow(row.id) : undefined}
                          className={`flex flex-col gap-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800 ${
                            completed
                              ? "bg-zinc-200 dark:bg-zinc-800"
                              : "bg-white dark:bg-zinc-900"
                          } ${canEdit ? "cursor-pointer" : ""}`}
                        >
                          <div className="flex flex-wrap items-baseline justify-between gap-2">
                            {canEdit ? (
                              <button
                                type="button"
                                onClick={() => openRow(row.id)}
                                className="font-semibold text-zinc-900 underline decoration-dotted underline-offset-2 hover:decoration-solid dark:text-zinc-50"
                              >
                                {dash(row.displayIntakeNumber)}
                                <span className="sr-only"> 줄 수정</span>
                              </button>
                            ) : (
                              <span className="font-semibold text-zinc-900 dark:text-zinc-50">
                                {dash(row.displayIntakeNumber)}
                              </span>
                            )}
                            <span className="flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
                              순번 {dash(row.displayOrder)}
                              {completed && <CompletedBadge />}
                              {canEdit && (
                                <CompletionToggle row={row} onError={setCompletionError} />
                              )}
                            </span>
                          </div>
                          <p className="text-sm text-zinc-700 dark:text-zinc-300">
                            {dash(row.customerName)}
                          </p>
                          {CARD_FIELD_GROUPS.map((fieldGroup) => (
                            <div key={fieldGroup.label} className="flex flex-col gap-1">
                              <p className="text-xs font-semibold text-zinc-500 dark:text-zinc-500">
                                {fieldGroup.label}
                              </p>
                              <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm text-zinc-600 dark:text-zinc-400">
                                {fieldGroup.fields.map((field) => (
                                  <div key={field.label}>
                                    <dt className="text-xs text-zinc-500 dark:text-zinc-500">
                                      {field.label}
                                    </dt>
                                    <dd className="break-words">{field.of(row)}</dd>
                                  </div>
                                ))}
                              </dl>
                            </div>
                          ))}
                        </div>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          }
        />
      )}
    </div>
  );
}
