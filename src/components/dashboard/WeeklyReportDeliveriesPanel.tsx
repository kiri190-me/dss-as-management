"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import WeeklyReportDeliveryDeleteDialog from "./WeeklyReportDeliveryDeleteDialog";
import type { RepairCaseLinkOption } from "@/lib/db/queries/domestic-orders";
import type { WeeklyReportDeliveryRow } from "@/lib/db/queries/weekly-report-deliveries";
import {
  filterRepairCaseLinkOptions,
  keepSelectedRepairCaseOption,
} from "@/lib/domain/repair-case-link-search";
import { WEEKLY_REPORT_KINDS, type WeeklyReportKind } from "@/lib/domain/weekly-report";
import { buildGoalPrefix } from "@/lib/domain/weekly-report-goal";
import {
  createWeeklyReportDeliveryAction,
  deleteWeeklyReportDeliveryAction,
  updateWeeklyReportDeliveryAction,
} from "@/lib/server/actions/weekly-report-deliveries";

/**
 * ============================================================================
 * 주간보고 — `RFG 납입 예정 건` · `MB 납입 예정 건` 표
 * ============================================================================
 * 원본 엑셀에서 금주 목표 아래에 있던 표다. 이번 주에 어느 장비를 언제 내보낼
 * 예정인지를 여덟 칸으로 적는다:
 *
 *     인수 번호 | 형식 | S/N | L/N | 고객사 | 납입 예정 | 입고 요청일 | 비고
 *
 * ── 여덟 칸 중 사람이 치는 것은 `비고` 하나다 ───────────────────────────
 * 나머지 일곱은 **저장된 값이 아니다.** 조회가 수리 건에서 그대로 실어 오고
 * (queries/weekly-report-deliveries.ts 헤더), 이 화면은 그것을 그리기만 한다.
 * 여기서 다시 이어 붙이거나 접으면, 나중에 수리 건의 형식·S/N·목표 출하일이
 * 고쳐졌을 때 이 표만 옛 값으로 남는다. 그래서 저장할 때 실어 보내는 것도
 * **어느 수리 건인가와 비고**뿐이다.
 *
 * ── 주는 위 상자가 정한다. 여기에 주 이동 줄을 두지 않는다 ──────────────
 * 두 상자가 **같은 주 고르개를 쓴다**(승인된 결정 — domain/weekly-report-delivery.ts
 * 헤더). 여기 `◀ 지난주 | 다음주 ▶` 를 또 두면 한 화면에 주 고르개가 둘이 되어,
 * 사람은 두 표가 서로 다른 주를 가리킬 수 있다고 읽는다. 지난 주를 보고 있다는
 * 안내도 금주 목표 상자에 **한 번만** 나온다. 이 파일은 page.tsx 가 정한
 * weekStart 를 받아 그 주의 줄을 그릴 뿐이다.
 *
 * ── 이 화면에서 두 번째로 누를 것이 있는 자리다 ─────────────────────────
 * WeeklyReportScreen 은 서버 컴포넌트 그대로 남고(그 파일 헤더 — 고객사 블록
 * 58개를 브라우저로 실어 나르지 않는다), 이 표를 놓을 자리만 준다.
 *
 * ── 적을 수 있는 사람에게만 입력칸이 보인다 ─────────────────────────────
 * canEdit 은 **그리기 위한 값일 뿐 관문이 아니다.** 저장은 서버 액션이 세션부터
 * 다시 확인하고 역할·설정 두 관문을 매번 다시 본다
 * (server/actions/weekly-report-deliveries.ts 헤더).
 *
 * ── 줄을 고치는 것은 비고뿐이다 ─────────────────────────────────────────
 * 수리 건을 잘못 골랐으면 지우고 다시 넣는다 — 금주 목표 상자와 같은 판단이고
 * 이유도 같다(WeeklyReportGoalsPanel 헤더). 다만 저장할 때는 주·수리 건·차례를
 * **원래 값 그대로 다시 실어 보낸다**: 검증이 네 칸을 한 벌로 받기 때문이고
 * (validation/weekly-report-delivery-input.ts), 빠뜨리면 차례가 조용히 지워진다.
 *
 * ── ⚠️ 표 래퍼에 flex-1 을 주지 말 것 ───────────────────────────────────
 * 8칼럼 표 둘이 나란히 서면 반드시 좁아 가로 스크롤이 필요하다. 그런데
 * `overflow-x: auto` 는 **나머지 축의 `visible` 을 `auto` 로 바꾼다**(CSS 규칙).
 * 거기에 flex-1 이 붙으면 flex-col 안에서 남은 높이를 확정 높이로 받아, 표가
 * 그보다 길면 **그 상자 안에서 세로 스크롤이 생긴다.** 이 화면이 실제로 겪은
 * 고장이고 경위는 WeeklyReportScreen.tsx 파일 헤더에 그대로 적혀 있다.
 * 격자 칸의 min-w-0 도 같은 이유로 장식이 아니다 — 없으면 표가 칸을 밀어 넓혀
 * 화면 전체가 좌우로 밀린다.
 * ============================================================================
 */

/**
 * 빈 값의 표시. **이 화면의 상세표와 같은 글자다**(WeeklyReportScreen 의 dash).
 * 그 함수를 불러 쓰지 않는 것은 그 파일이 서버 컴포넌트라서다 — 여기서 import 하면
 * 고객사 블록 58개짜리 모듈이 클라이언트 번들로 딸려 온다. 내자 정리 화면도 같은
 * 이유로 제 화면에 같은 두 줄을 두고 있다(DomesticOrderListScreen).
 */
function dash(value: string | null | undefined): string {
  if (value === null || value === undefined) return "-";
  return value.trim() === "" ? "-" : value;
}

/**
 * 표 머리글 줄의 색 — 상세표와 **같은 주황**이다(WeeklyReportScreen 의
 * HEADER_ROW_TONE). 한 화면 안에서 표 머리글이 자리마다 다른 색이면 사람은 그
 * 차이를 뜻으로 읽는다. 위 dash 와 같은 이유로 값만 옮겨 적는다.
 */
const HEADER_ROW_TONE = "bg-orange-100 dark:bg-orange-950/50";

/**
 * 상자 소제목의 색. 금주 목표(하늘) · 총합과 PO 발행 현황(자홍) · 총합 집계(연두)와
 * 마찬가지로 **고객사가 아니라 자리에 붙은 색**이라 팔레트가 아니라 화면 코드에
 * 둔다. 짙기는 이 화면의 다른 자리 색과 같다(밝은 쪽 -100, 어두운 쪽 -950/50).
 */
const DELIVERY_HEADING_TONE = "bg-teal-100 dark:bg-teal-950/50";

/** 여덟 칸. 줄이 없는 상자의 "해당 없음" 한 줄이 표 폭을 덮는 데 쓴다. */
const TABLE_COLUMN_COUNT = 8;

const inputClass =
  "w-full rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50";
const labelClass = "text-[11px] text-zinc-500 dark:text-zinc-400";
const errorClass = "mt-1 text-[11px] text-red-600 dark:text-red-400";
const smallButtonClass =
  "rounded-md border border-zinc-300 px-2 py-0.5 text-[11px] font-medium text-zinc-700 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800";
const primaryButtonClass =
  "rounded-md bg-zinc-900 px-3 py-1 text-xs font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200";

/**
 * `인수 번호` 한 칸 — 그 수리 건 상세로 가는 링크.
 *
 * 내자 정리의 인수번호 칸(DomesticOrderListScreen 의 IntakeNumberLink) · 금주 목표
 * 상자와 **같은 경로 · 같은 모양**이다.
 *
 * ⚠️ relative 를 떼지 말 것 — 안의 sr-only 는 position:absolute 다(Tailwind 의
 * sr-only 가 그렇다). 기준이 되는 조상이 없으면 그 span 이 AppShell <main> 의
 * 자르기를 빠져나가 문서 바닥에 자리를 주장하고, 세로 스크롤바가 둘로 보인다 —
 * 이 저장소가 실제로 겪은 고장이다(WeeklyReportScreen 의 고객사 줄 주석).
 */
function IntakeNumberLink({ row }: { row: WeeklyReportDeliveryRow }) {
  const label = dash(row.intakeNumber);
  return (
    <Link
      href={`/repair-cases/${row.repairCaseId}`}
      className="relative text-blue-700 underline underline-offset-2 hover:text-blue-900 dark:text-blue-400 dark:hover:text-blue-300"
    >
      {label}
      <span className="sr-only"> 수리 건 상세로 이동</span>
    </Link>
  );
}

/**
 * 줄 하나. 고칠 수 없는 사람에게는 여덟 칸만 보인다.
 *
 * 수정은 **제자리에서** 비고만 바꾼다 — 고칠 값이 하나뿐이라 폼을 따로 띄우지
 * 않고, 그래서 이 상태(열림 · 입력값 · 오류 · 충돌)는 전부 줄 안에 산다. 위로
 * 올리면 상자 하나가 모든 줄의 편집 상태를 들고 있게 된다.
 */
function DeliveryLine({
  row,
  canEdit,
  onRequestDelete,
}: {
  row: WeeklyReportDeliveryRow;
  canEdit: boolean;
  onRequestDelete: (row: WeeklyReportDeliveryRow) => void;
}) {
  const router = useRouter();
  const [isEditing, setIsEditing] = useState(false);
  const [note, setNote] = useState(row.note ?? "");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isConflict, setIsConflict] = useState(false);

  function openEditor() {
    // 열 때마다 지금 저장돼 있는 값에서 시작한다 — 남이 고친 뒤 새로 그려진 줄을
    // 열었는데 예전 입력이 남아 있으면, 저장하는 순간 그 값이 되살아난다.
    setNote(row.note ?? "");
    setErrorMessage(null);
    setIsConflict(false);
    setIsEditing(true);
  }

  async function save() {
    if (isSubmitting || isConflict) return;
    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      const result = await updateWeeklyReportDeliveryAction({
        id: row.id,
        expectedVersion: row.version,
        // 주 · 수리 건 · 차례는 원래 값 그대로다(파일 헤더) — 여기서 바꾸는 것은
        // 비고 하나뿐이다.
        fields: {
          weekStartDate: row.weekStartDate,
          repairCaseId: row.repairCaseId,
          note,
          displayOrder: row.displayOrder,
        },
      });

      if (!result.ok) {
        if (result.code === "CONFLICT") {
          // 낡은 폼에서 다시 저장이 나가는 길을 막는다 — 덮어쓰지 않고 다시
          // 불러오게 한다(EditSectionActions 와 같은 규칙).
          setIsConflict(true);
          setErrorMessage(result.message);
          return;
        }
        setErrorMessage(result.fieldErrors?.note ?? result.message);
        return;
      }

      router.refresh();
      setIsEditing(false);
    } finally {
      setIsSubmitting(false);
    }
  }

  function reloadAfterConflict() {
    router.refresh();
    setIsConflict(false);
    setIsEditing(false);
    setErrorMessage(null);
  }

  return (
    <tr className="border-b border-zinc-100 whitespace-nowrap last:border-0 dark:border-zinc-800">
      <td className="px-1.5 py-1 font-medium text-zinc-900 dark:text-zinc-50">
        <IntakeNumberLink row={row} />
      </td>
      <td className="px-1.5 py-1">{dash(row.modelName)}</td>
      <td className="px-1.5 py-1">{dash(row.serialNumber)}</td>
      <td className="px-1.5 py-1">{dash(row.lotNumber)}</td>
      <td className="px-1.5 py-1">{dash(row.customerName)}</td>
      {/* 두 날짜 모두 조회가 실어 온 값이다 — 저장돼 있지 않다(파일 헤더). */}
      <td className="px-1.5 py-1 tabular-nums">{dash(row.internalTargetShipmentDate)}</td>
      <td className="px-1.5 py-1 tabular-nums">{dash(row.earliestRequestedDueDate)}</td>
      <td className="px-1.5 py-1 whitespace-pre-line">
        {canEdit && isEditing ? (
          <div className="flex min-w-40 flex-col gap-1">
            <input
              type="text"
              className={inputClass}
              value={note}
              disabled={isSubmitting || isConflict}
              aria-label="비고"
              autoComplete="off"
              onChange={(event) => setNote(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void save();
                }
              }}
            />
            {errorMessage && (
              <p role="alert" className={errorClass}>
                {errorMessage}
              </p>
            )}
          </div>
        ) : (
          dash(row.note)
        )}
      </td>
      {canEdit && (
        <td className="px-1.5 py-1 text-right">
          {isEditing ? (
            <span className="inline-flex gap-1">
              {isConflict ? (
                <button type="button" className={smallButtonClass} onClick={reloadAfterConflict}>
                  최신 정보 다시 불러오기
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    className={smallButtonClass}
                    disabled={isSubmitting}
                    onClick={() => {
                      setIsEditing(false);
                      setErrorMessage(null);
                    }}
                  >
                    취소
                  </button>
                  <button
                    type="button"
                    className={primaryButtonClass}
                    disabled={isSubmitting}
                    aria-busy={isSubmitting}
                    onClick={() => void save()}
                  >
                    {isSubmitting ? "저장 중..." : "저장"}
                  </button>
                </>
              )}
            </span>
          ) : (
            <span className="inline-flex gap-1">
              <button type="button" className={smallButtonClass} onClick={openEditor}>
                수정
              </button>
              <button
                type="button"
                className={smallButtonClass}
                onClick={() => onRequestDelete(row)}
              >
                삭제
              </button>
            </span>
          )}
        </td>
      )}
    </tr>
  );
}

/**
 * 상자 하나 — `RFG 납입 예정 건` 또는 `MB 납입 예정 건`.
 *
 * 어느 상자로 갈지는 **수리 건의 종류가 정한다**(조회가 접어 준 kind). 사람이
 * 고르는 값이 아니라서 상자마다 '줄 추가'를 두지 않는다 — 그러면 RFG 상자에서
 * MB 건을 고를 수 있게 되고, 추가한 줄이 옆 상자에 나타난다. 추가는 표 위에
 * 하나뿐이다(금주 목표 상자와 같은 이유, 같은 모양).
 */
function DeliveryBox({
  kind,
  rows,
  canEdit,
  onRequestDelete,
}: {
  kind: WeeklyReportKind;
  rows: WeeklyReportDeliveryRow[];
  canEdit: boolean;
  onRequestDelete: (row: WeeklyReportDeliveryRow) => void;
}) {
  // 고칠 수 있는 사람에게는 버튼 칸이 하나 더 붙는다 — "해당 없음" 한 줄이
  // 덮어야 할 폭도 그만큼 늘어난다.
  const columnCount = canEdit ? TABLE_COLUMN_COUNT + 1 : TABLE_COLUMN_COUNT;

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div
        className={`flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 rounded border border-zinc-200 px-2 py-1 dark:border-zinc-800 ${DELIVERY_HEADING_TONE}`}
      >
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
          {kind} 납입 예정 건
        </h3>
        <p className="text-[11px] whitespace-nowrap text-zinc-600 dark:text-zinc-400">
          <span className="text-xs font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">
            {rows.length}
          </span>
          줄
        </p>
      </div>
      {/* 가로 스크롤은 이 래퍼 안에서만 일어난다. **flex-1 을 주지 말 것** —
          overflow-x 가 세로 축까지 스크롤 상자로 만들기 때문에, 여기에 확정
          높이가 붙으면 이 안에서 세로 스크롤이 생겨 스크롤바가 둘로 보인다.
          좌우 두 칸의 높이는 격자가 맞춘다(파일 헤더). */}
      <div className="min-h-16 overflow-x-auto rounded border border-zinc-200 dark:border-zinc-800">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr
              className={`border-b border-zinc-200 text-left text-[11px] font-semibold whitespace-nowrap text-zinc-700 dark:border-zinc-800 dark:text-zinc-300 ${HEADER_ROW_TONE}`}
            >
              <th className="px-1.5 py-1">인수 번호</th>
              <th className="px-1.5 py-1">형식</th>
              <th className="px-1.5 py-1">S/N</th>
              <th className="px-1.5 py-1">L/N</th>
              <th className="px-1.5 py-1">고객사</th>
              <th className="px-1.5 py-1">납입 예정</th>
              <th className="px-1.5 py-1">입고 요청일</th>
              <th className="px-1.5 py-1">비고</th>
              {canEdit && (
                // ⚠️ relative 를 떼지 말 것 — 안의 sr-only 는 position:absolute 다.
                // 기준이 되는 조상이 없으면 그 span 이 AppShell <main> 의 자르기를
                // 빠져나가 문서 바닥에 자리를 주장하고, 세로 스크롤바가 둘로 보인다
                // (WeeklyReportScreen 의 고객사 줄 주석 — 실측까지 적혀 있다).
                <th className="relative px-1.5 py-1 text-right">
                  <span className="sr-only">줄 수정 · 삭제</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {/* 줄이 없어도 상자는 자리를 지킨다 — 지우면 좌우가 어긋나 RFG 와
                MB 를 견줄 수 없다(이 화면의 다른 줄과 같은 규칙). 그 자리에
                무엇이 없는지 한 줄로 적는다. */}
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={columnCount}
                  className="px-1.5 py-3 text-center text-[11px] text-zinc-500 dark:text-zinc-400"
                >
                  해당 없음
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <DeliveryLine
                  key={row.id}
                  row={row}
                  canEdit={canEdit}
                  onRequestDelete={onRequestDelete}
                />
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * 줄 추가 — 인수번호로 수리 건을 찾고, 비고는 **비워 둘 수 있다**.
 *
 * 고르개의 방식은 금주 목표 상자·내자 정리 수정 폼과 **같다**: 검색 칸이 먼저
 * 있고 그 아래 `<select>` 에 걸린 것만 남는다. 거르는 규칙 자체는 화면에 적지
 * 않고 domain 의 filterRepairCaseLinkOptions 를 부른다 — 같은 글자가 화면마다
 * 다르게 걸리면 안 된다.
 *
 * 비고가 선택인 근거는 검증 쪽에 있다(validation/weekly-report-delivery-input.ts):
 * 이 표의 줄은 **"이 건이 이번 주 납입 예정 목록에 있다"** 는 사실 자체가
 * 내용이고, 비고는 덧붙이는 말이다. 실제 원본 엑셀에서도 대부분 비어 있다.
 *
 * 차례(display_order)는 칸을 두지 않는다. 적지 않으면 null 이고 그 줄은 뒤로
 * 가는데, 매주 새로 적는 표라 적은 차례가 곧 사람이 뜻한 차례다.
 */
function DeliveryAddForm({
  weekStart,
  repairCaseOptions,
}: {
  weekStart: string;
  repairCaseOptions: RepairCaseLinkOption[];
}) {
  const router = useRouter();
  const [repairCaseId, setRepairCaseId] = useState("");
  /** 검색어. **저장되는 값이 아니다** — 아래 목록에 무엇이 남는지만 정한다. */
  const [query, setQuery] = useState("");
  const [note, setNote] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const matched = useMemo(
    () => filterRepairCaseLinkOptions(repairCaseOptions, query),
    [repairCaseOptions, query]
  );
  // 지금 고른 건은 검색어에 걸리지 않아도 목록에 남아야 한다 — 안 남기면 select 가
  // 첫 항목을 보여 주면서 state 에는 그 건이 남아 화면이 거짓말을 한다
  // (domain/repair-case-link-search.ts 의 keepSelectedRepairCaseOption).
  const visible = useMemo(
    () => keepSelectedRepairCaseOption(repairCaseOptions, matched, repairCaseId),
    [repairCaseOptions, matched, repairCaseId]
  );

  async function submit() {
    if (isSubmitting) return;
    setIsSubmitting(true);
    setFieldErrors({});
    setErrorMessage(null);
    try {
      const result = await createWeeklyReportDeliveryAction({
        fields: { weekStartDate: weekStart, repairCaseId, note, displayOrder: null },
      });

      if (!result.ok) {
        setFieldErrors(result.fieldErrors ?? {});
        setErrorMessage(result.message);
        return;
      }

      // 다음 줄을 이어 적는 자리다 — 검색어까지 지우면 같은 고객사의 다음 건을
      // 찾으려고 매번 다시 쳐야 한다. 고른 건과 비고만 비운다.
      setRepairCaseId("");
      setNote("");
      router.refresh();
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form
      className="flex flex-col gap-2 rounded-md border border-zinc-200 bg-zinc-50 p-2 dark:border-zinc-800 dark:bg-zinc-950"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div>
          <label className={labelClass} htmlFor="weekly-report-delivery-repairCaseId">
            수리 건
          </label>
          {/* 검색 칸이 먼저다. 여기서 무엇을 치든 저장되는 값은 아니다. */}
          <input
            type="search"
            className={`${inputClass} mb-1`}
            value={query}
            disabled={isSubmitting}
            placeholder="인수번호로 검색 (고객사 · 형식도 됩니다)"
            aria-label="납입 예정 수리 건 검색"
            aria-controls="weekly-report-delivery-repairCaseId"
            autoComplete="off"
            onChange={(event) => setQuery(event.target.value)}
          />
          <select
            id="weekly-report-delivery-repairCaseId"
            className={inputClass}
            value={repairCaseId}
            disabled={isSubmitting}
            onChange={(event) => setRepairCaseId(event.target.value)}
          >
            <option value="">수리 건 선택</option>
            {visible.map((option) => (
              <option key={option.id} value={option.id}>
                {[option.intakeNumber, option.customerName, option.modelName]
                  .filter((part): part is string => Boolean(part))
                  .join(" · ")}
              </option>
            ))}
          </select>
          {/* 아무것도 안 걸렸다는 사실을 말해 준다 — 이 말이 없으면 빈 목록이
              "고를 수 있는 건이 없다"로 읽힌다. */}
          {matched.length === 0 && (
            <p className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
              검색어에 맞는 수리 건이 없습니다.
            </p>
          )}
          {fieldErrors.repairCaseId && <p className={errorClass}>{fieldErrors.repairCaseId}</p>}
        </div>

        <div>
          <label className={labelClass} htmlFor="weekly-report-delivery-note">
            비고 (선택)
          </label>
          <input
            id="weekly-report-delivery-note"
            type="text"
            className={inputClass}
            value={note}
            disabled={isSubmitting}
            placeholder="예: 고객사 요청으로 연기"
            autoComplete="off"
            onChange={(event) => setNote(event.target.value)}
          />
          {fieldErrors.note && <p className={errorClass}>{fieldErrors.note}</p>}
        </div>
      </div>

      {/* 어느 표로 갈지는 사람이 고르지 않는다는 사실을 적어 둔다 — 안 적으면
          "RFG 인데 왜 MB 에 생겼나"로 읽힌다. */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
          RFG · MB 는 고르지 않습니다 — 고른 수리 건의 종류가 정합니다. 비고는 비워 두어도 됩니다.
        </p>
        <button
          type="submit"
          className={primaryButtonClass}
          disabled={isSubmitting}
          aria-busy={isSubmitting}
        >
          {isSubmitting ? "추가 중..." : "줄 추가"}
        </button>
      </div>

      {errorMessage && (
        <p role="alert" className={errorClass}>
          {errorMessage}
        </p>
      )}
    </form>
  );
}

export default function WeeklyReportDeliveriesPanel({
  weekStart,
  deliveries,
  canEdit,
  repairCaseOptions,
  gridClass,
}: {
  /**
   * 지금 보고 있는 주의 월요일 — 주소의 `?week=` 이 이미 접힌 값이고, **위 금주
   * 목표 상자와 같은 값이다**(파일 헤더). 주를 바꾸는 링크는 그 상자에만 있다.
   */
  weekStart: string;
  /** 그 주의 납입 예정 줄 전부. 차례는 조회가 이미 정했다(display_order, created_at). */
  deliveries: WeeklyReportDeliveryRow[];
  /** 적을 수 있는가. 거짓이면 입력칸도 버튼도 그리지 않는다(파일 헤더). */
  canEdit: boolean;
  /** '줄 추가'의 수리 건 고르개 목록. 못 고치는 사람에게는 빈 배열이다. */
  repairCaseOptions: RepairCaseLinkOption[];
  /**
   * 좌우 배치(왼쪽 RFG · 오른쪽 MB). WeeklyReportScreen 의 SIDE_BY_SIDE_GRID 를
   * 그대로 받는다 — 이 화면의 모든 줄이 **같은 폭에서 같이** 갈려야 하므로 값을
   * 한 곳에 둔다(그 상수 주석). 여기 따로 적으면 한쪽만 고쳐진다.
   */
  gridClass: string;
}) {
  const router = useRouter();
  const [deleteTarget, setDeleteTarget] = useState<WeeklyReportDeliveryRow | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isDeleteConflict, setIsDeleteConflict] = useState(false);

  // 종류별로 가른다. 어느 상자로 갈지는 조회가 이미 접어 준 kind 가 정한다 —
  // 여기서 워크플로 종류를 다시 접지 않는다(queries 헤더).
  const rowsByKind = useMemo(() => {
    const buckets = new Map<WeeklyReportKind, WeeklyReportDeliveryRow[]>(
      WEEKLY_REPORT_KINDS.map((kind) => [kind, [] as WeeklyReportDeliveryRow[]])
    );
    for (const row of deliveries) buckets.get(row.kind)?.push(row);
    return buckets;
  }, [deliveries]);

  function requestDelete(row: WeeklyReportDeliveryRow) {
    setDeleteTarget(row);
    setDeleteError(null);
    setIsDeleteConflict(false);
  }

  function closeDeleteDialog() {
    if (isDeleting) return;
    setDeleteTarget(null);
    setDeleteError(null);
    setIsDeleteConflict(false);
  }

  async function confirmDelete() {
    if (deleteTarget === null || isDeleting || isDeleteConflict) return;
    setIsDeleting(true);
    setDeleteError(null);
    try {
      const result = await deleteWeeklyReportDeliveryAction({
        id: deleteTarget.id,
        expectedVersion: deleteTarget.version,
      });

      if (!result.ok) {
        if (result.code === "CONFLICT") {
          setIsDeleteConflict(true);
          setDeleteError(result.message);
          return;
        }
        setDeleteError(result.message);
        return;
      }

      setDeleteTarget(null);
      router.refresh();
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        {/* 이 구역의 제목이다 — 화면의 다른 구역(종류별 총합 · PO 발행 현황)과
            같은 h2 자리다. 표 둘의 소제목이 그 아래 h3 로 이어진다. */}
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">납입 예정 건</h2>
        {/* 주 고르개가 여기 없는 이유를 한 줄로 말해 준다(파일 헤더). 지난 주를
            보고 있다는 안내는 위 상자에 한 번만 나오므로 여기서 되풀이하지 않는다. */}
        <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
          위 금주 목표와 같은 주를 봅니다. 비고 말고는 모두 수리 건에서 따라옵니다.
        </p>
      </div>

      {canEdit && (
        <DeliveryAddForm weekStart={weekStart} repairCaseOptions={repairCaseOptions} />
      )}

      <div className={gridClass}>
        {WEEKLY_REPORT_KINDS.map((kind) => (
          <DeliveryBox
            key={kind}
            kind={kind}
            rows={rowsByKind.get(kind) ?? []}
            canEdit={canEdit}
            onRequestDelete={requestDelete}
          />
        ))}
      </div>

      {/* 확인창은 상자마다가 아니라 여기 하나다 — 줄마다 두면 표 하나에
          <dialog> 가 줄 수만큼 생긴다. */}
      <WeeklyReportDeliveryDeleteDialog
        isOpen={deleteTarget !== null}
        // 어느 건인지 가리키는 한 줄은 금주 목표 상자와 **같은 함수**가 만든다
        // (domain 의 buildGoalPrefix — `[INVENIA] D260706_..._WT7351`). 여기서
        // 다시 이어 붙이면 빈 조각을 건너뛰는 규칙이 두 곳에 생기고, 한쪽만
        // 고쳐지는 날이 온다. 한 화면 안에서 같은 수리 건이 두 확인창에 서로
        // 다른 글자로 적히는 것도 막는다.
        line={deleteTarget === null ? "" : buildGoalPrefix(deleteTarget)}
        note={deleteTarget?.note ?? null}
        isSubmitting={isDeleting}
        errorMessage={deleteError}
        isConflict={isDeleteConflict}
        onConfirm={() => void confirmDelete()}
        onCancel={closeDeleteDialog}
        onReloadAfterConflict={() => {
          setDeleteTarget(null);
          setDeleteError(null);
          setIsDeleteConflict(false);
          router.refresh();
        }}
      />
    </section>
  );
}
