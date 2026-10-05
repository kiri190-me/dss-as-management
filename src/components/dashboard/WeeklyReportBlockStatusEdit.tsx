"use client";

import {
  createContext,
  useContext,
  useState,
  type ChangeEvent,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { showSavePopup } from "@/components/common/SavePopup";
import { setWeeklyReportStatusAction } from "@/lib/server/actions/set-weekly-report-status";
import {
  isWeeklyReportRowStatus,
  type WeeklyReportRowStatus,
} from "@/lib/domain/weekly-report-row-status";

/**
 * ============================================================================
 * 주간보고 고객사 블록의 `현 상태` 를 **블록 단위로 한 번에** 고친다
 * ============================================================================
 * 블록 머리줄의 `수정` 버튼 하나가 그 블록 상세표의 `현 상태` 칸을 **전부** 연다.
 * `취소`·`저장` 짝도 거기 하나뿐이고, `저장` 한 번에 **바뀐 줄만** 나간다.
 *
 * ── 🔴 왜 줄마다 있던 `수정` 을 걷어냈는가 (2026-10-05 사용자 요청) ───────
 * 몇 시간 전까지는 줄마다 `수정`·`취소`·`저장` 이 붙어 있었다(같은 날 오전의
 * 결정이다). 사용자가 **「하나하나 눌러야 해서 번거롭다」**고 해서 블록 단위로
 * 바꾼 것이다. 바로 앞 결정을 되돌린 자리라 경위를 여기 남긴다 —
 * 모르고 보면 "칸마다 버튼이 있어야 쓰기 좋다"며 되돌리기 쉽다.
 *
 * 되돌리지 **않은** 것도 함께 적어 둔다: 고르는 즉시 보내던 맨 처음 방식은
 * 그대로 폐기다. 250줄짜리 표를 훑어 내려가다 고르개에 손이 닿으면 **확인할 틈
 * 없이 워크플로 단계가 옮겨지고 이력이 남는다.** `저장` 을 한 번 더 누르게 하는
 * 뜻이 거기 있고, 그 한 번이 줄마다에서 블록마다로 옮겨 갔을 뿐이다.
 *
 * ── 왜 Context 인가 — 블록을 클라이언트로 옮기지 않기 위해서다 ────────────
 * 머리줄의 버튼과 각 줄의 고르개는 **같은 상태**를 본다. 그렇다고 블록
 * (WeeklyReportScreen 의 ReportBlock)을 통째로 `"use client"` 로 만들면 상세표
 * 250여 줄이 통째로 브라우저로 실려 간다 — 이 화면이 서버 컴포넌트인 까닭
 * 그대로다(WeeklyReportScreen 파일 헤더).
 *
 * 그래서 이 Provider 가 `<section>` 안쪽을 **children 으로 받아** 감싼다. 서버에서
 * 렌더된 자식을 클라이언트 컴포넌트의 children 으로 넘기는 구조라, 자식은 서버
 * 컴포넌트로 남고 그 사이에 끼어 있는 클라이언트 조각(머리줄 버튼 ·
 * WeeklyReportStatusCell)만 이 context 를 구독한다.
 *
 * 🔴 **이 Provider 는 DOM 을 만들지 않는다.** `<section>` 이 flex 상자라, 여기서
 * `<div>` 하나라도 두르면 머리줄·집계·상세표가 한 칸에 눌려 들어가 배치가
 * 무너진다.
 *
 * ── 🔴 블록마다 독립이다 ────────────────────────────────────────────────
 * 고객사 블록 하나에 Provider 하나다. 왼쪽 블록을 고치는 중에 오른쪽 블록은
 * 그대로다 — 상태가 Provider 안에만 있으므로 저절로 그렇게 된다.
 *
 * ── 🔴 `expectedVersion` 은 state 에 복사하지 않는다 ─────────────────────
 * 보내는 version 은 **props 로 내려온 `rows` 의 값**이다. `router.refresh()` 가
 * 돌면 서버가 새 version 을 그려 내려보내는데, 열 때 state 로 복사해 두면 그
 * 낡은 값으로 보내게 되어 두 번째 저장이 낙관적 잠금에 걸린다.
 *
 * 같은 이유로 **고른 값도 바뀐 줄만 들고 있는다**(selectedById). 손대지 않은 줄은
 * 늘 `rows` 의 값을 그대로 읽으므로, 새로 그려진 값이 곧바로 따라온다.
 *
 * ── 저장 — 바뀐 줄만, 🔴 한 줄씩 차례로 ─────────────────────────────────
 * 한 번 누를 때 여러 건의 **워크플로 단계 이동과 이력 쓰기**가 일어난다.
 * `Promise.all` 로 몰아 보내지 **않는다** — 같은 수리 건을 건드리는 트랜잭션이
 * 한꺼번에 들어가면 서로 기다리다 엉키고, 실패한 줄이 어느 것인지도 흐려진다.
 * 일괄 저장용 서버 액션을 새로 만들지 않고 기존 액션을 여러 번 부르는 까닭도
 * 같다 — 서버 쪽 규칙(세션·역할·보류·잠금·버전)은 한 글자도 바뀌지 않는다.
 *
 * ── 🔴 하나라도 실패하면 닫지 않고, 성공 팝업도 띄우지 않는다 ────────────
 * 실패한 줄 아래에 그 줄의 message 를 남기고 편집을 **연 채로 둔다.** 고른 값도
 * 되돌리지 않는다 — 되돌리면 무엇을 고르던 중이었는지가 사라진다. 되돌리는 일은
 * `취소` 하나가 맡는다.
 *
 * 성공한 줄이 하나라도 있으면 `router.refresh()` 는 **부른다.** 이미 저장된
 * 것이므로 화면이 사실과 달라지면 안 된다. 그 refresh 뒤 성공한 줄은 서버 값과
 * 같아져 "바뀐 줄"에서 저절로 빠지므로, `저장` 을 다시 누르면 **아직 안 된 줄만**
 * 다시 나간다.
 *
 * 그때 성공 팝업은 띄우지 않는다 — SavePopup 은 0.5초 뒤 저절로 닫히는 **성공
 * 전용** 알림이라(common/SavePopup), 오류 상자와 함께 뜨면 섞여 읽힌다.
 *
 * ── 🔴 버튼 셋은 종이에 찍히지 않는다(`print:hidden`) ────────────────────
 * 이 화면은 그대로 인쇄해 쓰는 종이다. 종이에 남는 것은 지금까지와 똑같이
 * **상태 이름 글자 하나**여야 한다.
 *
 * ── 낭독기용 이름은 `aria-label` 로 준다 ────────────────────────────────
 * 한 화면에 고객사 블록이 수십 개라, 이름이 `수정` 뿐이면 어느 블록의 버튼인지
 * 알 수 없다. 그래서 고객사명을 앞에 붙인다(`ICD 현 상태 수정`).
 *
 * `sr-only` 조각을 쓰지 않는 까닭: 이 저장소의 `sr-only` 는 `position: absolute`
 * 라, 위치 기준이 될 조상이 없으면 그 조각이 문서 바닥에 자리를 주장해 **창
 * 스크롤이 하나 더 생긴다**(경위는 common/inline-edit-cell-button.ts 의
 * `relative` 경고). 버튼 안에 든 글자가 `수정`·`취소`·`저장` 뿐이라 aria-label 로
 * 덮어도 잃을 값이 없다.
 * ============================================================================
 */

/**
 * 버튼 셋의 옷. 겉모습은 구간 편집의 취소·저장 짝을 본떴다
 * (repair-cases/detail/edit/EditSectionActions.tsx) — 이 서비스에서 `취소`는
 * 테두리만, `저장`은 `bg-primary-900` 이다.
 *
 * 여백과 글자는 이 화면의 값으로 줄였다(`text-wr-meta` — 주간보고 전용 보조 글자
 * 크기다. 전역 `text-xs` 를 쓰면 이 줄만 머리줄의 다른 글자와 어긋난다).
 *
 * 🔴 셋 다 `print:hidden` 이다 — 까닭은 파일 머리말에 있다.
 *
 * `shrink-0` 이 셋 다에 있는 것도 장식이 아니다. 이 버튼들은 머리줄의
 * `<h3>`(inline-flex) 안에 선다. flex 항목은 기본이 shrink 라, 두지 않으면 줄이
 * 좁아질 때 버튼 글자가 스스로 접힌다(BlockHeading 의 `shrink-0` 주석과 같은 짝).
 */
const EDIT_BUTTON_CLASS =
  "shrink-0 rounded border border-zinc-300 px-1 py-0 text-wr-meta font-medium text-zinc-600 hover:bg-zinc-100 print:hidden dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800";
const CANCEL_BUTTON_CLASS =
  "shrink-0 rounded border border-zinc-300 px-1 py-0 text-wr-meta font-medium text-zinc-700 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 print:hidden dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800";
const SAVE_BUTTON_CLASS =
  "shrink-0 rounded bg-primary-900 px-1 py-0 text-wr-meta font-medium text-white hover:bg-primary-800 disabled:cursor-not-allowed disabled:opacity-50 print:hidden dark:bg-primary-50 dark:text-zinc-900 dark:hover:bg-primary-200";

/**
 * `취소`·`저장` 을 묶는 상자. 이 상자에도 `print:hidden` 이 있어야 한다 —
 * 안의 버튼만 숨기면 **빈 상자가 flex 항목으로 남아** 머리줄의 `gap-x-2` 가
 * 종이에서도 그만큼 자리를 차지한다(`display:none` 인 항목은 gap 에서 빠진다).
 */
const ACTIONS_GROUP_CLASS = "inline-flex shrink-0 items-baseline gap-1 print:hidden";

/**
 * 블록이 들고 있는 줄 하나. 🔴 **고르개를 그리는 데 필요한 값이 전부 여기 있다** —
 * 그래서 각 칸(WeeklyReportStatusCell)은 자기를 가리키는 id 하나만 받는다.
 */
export type WeeklyReportBlockStatusRow = {
  /** repair_cases.id — 서버 액션의 repairCaseId 이자 이 블록 안의 열쇠다. */
  id: string;
  /** repair_cases.version — 낙관적 잠금 값. 🔴 state 에 복사하지 않는다(파일 헤더). */
  version: number;
  /**
   * 서버가 방금 계산해 그려 준 이 줄의 칸(7칸 중 하나 —
   * classifyWeeklyReportRowStatus). **null 이면 분류 안 됨**이고 그 줄도 고칠 수
   * 있다 — 오히려 고쳐야 할 줄이다. 빨간 딱지는 부르는 쪽이 그린다
   * (WeeklyReportScreen 의 StatusCell).
   */
  rowStatus: WeeklyReportRowStatus | null;
};

type BlockStatusEditValue = {
  /** 낭독기용 이름에 넣는 블록 이름(고객사명). */
  blockLabel: string;
  isEditing: boolean;
  isSubmitting: boolean;
  rowById: ReadonlyMap<string, WeeklyReportBlockStatusRow>;
  /** 🔴 **손댄 줄만** 들어 있다. 없는 줄은 늘 props 의 rowStatus 를 읽는다(파일 헤더). */
  selectedById: ReadonlyMap<string, WeeklyReportRowStatus | "">;
  errorById: ReadonlyMap<string, string>;
  openEditor: () => void;
  cancelEditor: () => void;
  saveBlock: () => Promise<void>;
  selectStatus: (repairCaseId: string, next: string) => void;
};

const WeeklyReportBlockStatusContext = createContext<BlockStatusEditValue | null>(null);

/**
 * context 가 없으면 **던진다.** 이웃 UiTextProvider 가 기본값으로 버티는 것과
 * 일부러 다르다 — 저쪽이 없을 때 모자라는 것은 이름표 글자뿐이지만, 이쪽이 없으면
 * 칸이 자기 줄의 상태도 version 도 모른다. 조용히 빈 칸으로 그리면 **사람이 그
 * 줄을 '분류 안 됨'으로 읽는다.**
 *
 * 부르는 자리는 하나뿐이고(ReportBlock 이 canEditStatus 일 때만 감싼다) 이 화면을
 * 열면 곧바로 드러나므로, 조용히 틀리는 쪽보다 깨지는 쪽이 낫다.
 */
function useBlockStatusEdit(): BlockStatusEditValue {
  const value = useContext(WeeklyReportBlockStatusContext);
  if (value === null) {
    throw new Error("WeeklyReportBlockStatusProvider 안에서만 쓸 수 있습니다.");
  }
  return value;
}

/**
 * 줄 하나가 그리는 데 필요한 것만 추려 준다(WeeklyReportStatusCell 이 쓴다).
 *
 * `selected` 는 **손댔으면 고른 값, 아니면 서버가 그려 준 값**이다. 빈 문자열은
 * 분류 안 된 줄의 `선택` 자리이고, 그대로 두면 보낼 값이 없는 상태로 남는다.
 */
export function useWeeklyReportBlockStatusRow(repairCaseId: string): {
  isEditing: boolean;
  isSubmitting: boolean;
  rowStatus: WeeklyReportRowStatus | null;
  selected: WeeklyReportRowStatus | "";
  error: string | null;
  onChange: (event: ChangeEvent<HTMLSelectElement>) => void;
} {
  const value = useBlockStatusEdit();
  const row = value.rowById.get(repairCaseId);
  if (row === undefined) {
    throw new Error(`주간보고 블록이 들고 있지 않은 줄입니다 — ${repairCaseId}`);
  }
  return {
    isEditing: value.isEditing,
    isSubmitting: value.isSubmitting,
    rowStatus: row.rowStatus,
    selected: value.selectedById.get(repairCaseId) ?? row.rowStatus ?? "",
    error: value.errorById.get(repairCaseId) ?? null,
    onChange: (event: ChangeEvent<HTMLSelectElement>) =>
      value.selectStatus(repairCaseId, event.target.value),
  };
}

/**
 * 머리줄에 서는 버튼 묶음 — 평소 `수정`, 고치는 중에는 `취소`·`저장`.
 *
 * 🔴 **고객사 블록 머리줄에만 넘긴다.** PO 발행 현황과 종류별 총합도 같은
 * BlockHeading 을 쓰지만 그 둘에는 고칠 줄이 없다 — BlockHeading 의 `actions` 를
 * 안 넘기면 아무것도 그려지지 않는다.
 */
export function WeeklyReportBlockStatusActions() {
  const { blockLabel, isEditing, isSubmitting, openEditor, cancelEditor, saveBlock } =
    useBlockStatusEdit();

  if (!isEditing) {
    return (
      <button
        type="button"
        onClick={openEditor}
        aria-label={`${blockLabel} 현 상태 수정`}
        className={EDIT_BUTTON_CLASS}
      >
        수정
      </button>
    );
  }

  return (
    <span className={ACTIONS_GROUP_CLASS}>
      <button
        type="button"
        onClick={cancelEditor}
        disabled={isSubmitting}
        aria-label={`${blockLabel} 현 상태 수정 취소`}
        className={CANCEL_BUTTON_CLASS}
      >
        취소
      </button>
      <button
        type="button"
        onClick={() => void saveBlock()}
        disabled={isSubmitting}
        aria-busy={isSubmitting}
        aria-label={`${blockLabel} 현 상태 저장`}
        className={SAVE_BUTTON_CLASS}
      >
        {isSubmitting ? "저장 중..." : "저장"}
      </button>
    </span>
  );
}

/**
 * 블록 하나의 편집 상태를 통째로 들고 있는 자리.
 *
 * 🔴 **DOM 을 만들지 않는다**(파일 헤더). children 은 서버에서 렌더된 머리줄 ·
 * 집계 · 상세표 그대로이고, 그 사이의 클라이언트 조각만 이 값을 구독한다.
 */
export function WeeklyReportBlockStatusProvider({
  blockLabel,
  rows,
  children,
}: {
  /** 낭독기용 이름에 들어가는 고객사명. */
  blockLabel: string;
  /** 🔴 서버가 방금 그려 준 값이다 — 매 렌더 새로 내려온다(파일 헤더). */
  rows: WeeklyReportBlockStatusRow[];
  children: ReactNode;
}) {
  const router = useRouter();
  const [isEditing, setIsEditing] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedById, setSelectedById] = useState<ReadonlyMap<string, WeeklyReportRowStatus | "">>(
    new Map()
  );
  const [errorById, setErrorById] = useState<ReadonlyMap<string, string>>(new Map());

  const rowById = new Map(rows.map((row) => [row.id, row] as const));

  /**
   * 닫으면서 **고른 값과 오류를 전부 버린다.** 버리는 것이 곧 서버 값으로
   * 되돌리는 일이다 — 손댄 줄만 들고 있으므로, 비우면 모든 칸이 다시 props 의
   * rowStatus 를 읽는다(파일 헤더).
   */
  function closeEditor() {
    setSelectedById(new Map());
    setErrorById(new Map());
    setIsEditing(false);
  }

  function openEditor() {
    // 열 때마다 **서버가 방금 그려 준 값**에서 다시 시작한다 — 닫고 다시 여는
    // 사이에 화면이 새로 그려졌을 수 있다.
    setSelectedById(new Map());
    setErrorById(new Map());
    setIsEditing(true);
  }

  function cancelEditor() {
    // 되돌리는 일은 이 버튼 하나가 맡는다(파일 헤더 — 실패는 되돌리지 않는다).
    closeEditor();
  }

  function selectStatus(repairCaseId: string, next: string) {
    // 분류 안 된 줄은 빈 자리(고르개의 `선택`)를 도로 고를 수 있다. 그때는 보낼
    // 값이 없는 상태로 돌아갈 뿐이고, 판정은 저장할 때 한 번에 한다.
    setSelectedById((previous) => {
      const updated = new Map(previous);
      updated.set(repairCaseId, isWeeklyReportRowStatus(next) ? next : "");
      return updated;
    });
  }

  async function saveBlock() {
    if (isSubmitting) return;

    // 🔴 보낼 줄을 먼저 추린다 — 고른 값이 빈 자리가 아니고, **서버가 방금 그려 준
    // 값과 다른** 줄만이다. 비교 상대가 화면 상태가 아닌 까닭: 저장이 실패한 뒤
    // 다시 `저장` 을 누르면 그 사람은 **재시도**를 누른 것이므로 다시 나가야 한다.
    const changed: { id: string; version: number; status: WeeklyReportRowStatus }[] = [];
    for (const row of rows) {
      const selected = selectedById.get(row.id) ?? row.rowStatus ?? "";
      if (!isWeeklyReportRowStatus(selected) || selected === row.rowStatus) continue;
      changed.push({ id: row.id, version: row.version, status: selected });
    }
    if (changed.length === 0) {
      closeEditor();
      return;
    }

    setErrorById(new Map());
    setIsSubmitting(true);
    try {
      // 🔴 한 줄씩 차례로다. 몰아 보내지 말 것 — 까닭은 파일 머리말에 있다.
      const failures = new Map<string, string>();
      let savedCount = 0;
      for (const target of changed) {
        const result = await setWeeklyReportStatusAction({
          repairCaseId: target.id,
          expectedVersion: target.version,
          status: target.status,
        });
        if (!result.ok) {
          failures.set(target.id, result.message);
          continue;
        }
        savedCount += 1;
      }

      setErrorById(failures);
      // 하나라도 저장됐으면 화면을 새로 받는다 — 일부만 성공했어도 마찬가지다.
      if (savedCount > 0) router.refresh();
      if (failures.size > 0) {
        // 🔴 닫지 않는다. 고른 값도 되돌리지 않는다. 성공 팝업도 띄우지 않는다.
        return;
      }
      showSavePopup({ message: `현 상태 ${savedCount}건을 변경했습니다.`, redirectTo: null });
      closeEditor();
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <WeeklyReportBlockStatusContext.Provider
      value={{
        blockLabel,
        isEditing,
        isSubmitting,
        rowById,
        selectedById,
        errorById,
        openEditor,
        cancelEditor,
        saveBlock,
        selectStatus,
      }}
    >
      {children}
    </WeeklyReportBlockStatusContext.Provider>
  );
}
