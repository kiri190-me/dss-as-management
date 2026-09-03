"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";

import { MasterDataRestoreDialog } from "@/components/common/master-data-trash-dialogs";
import { restoreServiceReportAction } from "@/lib/server/actions/service-reports";

/**
 * ============================================================================
 * 「보고서」 탭 — 사용중 / 휴지통
 * ============================================================================
 * 지운 보고서를 되살리는 자리다. 견적서 목록(`quotes/QuoteListScreen.tsx`)이
 * 하는 일과 같아서 생김새도 그쪽을 그대로 옮겼다 — 두 문서는 정책도 같다:
 * 고객사로 나가는 문서이고, **소프트 삭제만 있고 영구 삭제도 자동 만료도 없다**
 * (`mutations/service-reports.ts` 의 '영구 삭제는 없다'). 그래서 이 조각에도
 * 「완전 삭제」 단추가 없고, 「N일 뒤 사라집니다」 같은 문구도 없다.
 *
 * ── ⚠️ 여기가 이 화면에서 유일한 "use client" 다 ────────────────────────
 * 탭은 브라우저 상태라 클라이언트여야 한다. 그런데 종류 이름
 * (「검사보고서」·「수리보고서」)은 채우개의 `SERVICE_REPORT_TITLES` 에서 오고,
 * 그 모듈은 `node:fs`·`node:zlib` 를 끌고 온다.
 *
 * 🔴 그래서 **다 만들어진 글자만 받는다.** `@/lib/xlsx/*` 를 값으로 가져오면
 * 클라이언트 번들이 `node:fs` 를 끌어와 빌드가 깨진다(형제 조각 둘이 같은 이유로
 * 같은 규칙을 지킨다 — `ReportKindChoice`·`ServiceReportList`).
 *
 * ── 「사용중」 은 children 이다 ─────────────────────────────────────────
 * 저장된 목록(`ServiceReportList`)은 **서버 컴포넌트로 남는다.** 여기서 import
 * 하면 그 조각까지 클라이언트로 딸려 오는데, 그럴 이유가 없다 — 링크 목록일
 * 뿐이고 브라우저에서 할 일이 없다. 그래서 페이지가 그려서 `children` 으로
 * 넘긴다. 한 장도 없으면 `null` 이 오고, 그때 「사용중」 탭은 빈 채로 남는다
 * (페이지의 '빈 상자를 억지로 그리지 않는다').
 *
 * ── 🔴 권한이 없으면 이 조각이 아예 없다 ───────────────────────────────
 * 휴지통은 지울 수 있는 사람만 여는 자리다. 그 판단은 **페이지가** 하고, 권한이
 * 없으면 휴지통을 읽지도 props 로 내려보내지도 않는다(`quotes/page.tsx` 의 '쓰지
 * 않을 값을 클라이언트로 실어 보내지 않는다'). 그러니 이 조각이 그려졌다는 것은
 * 이미 그 문턱을 넘었다는 뜻이고, 여기서 다시 감추는 코드를 두지 않는다.
 *
 * 물론 그것은 화면일 뿐 경계가 아니다 — 되살리기는 서버 액션이 세션부터 다시
 * 확인한다(`actions/service-reports.ts` 의 '화면이 감춘 것은 경계가 아니다').
 * ============================================================================
 */

export type DeletedServiceReportListRow = {
  id: string;
  /** 되살릴 때 되돌려 보낼 낙관적 잠금 토큰. 그리지는 않는다. */
  version: number;
  /** 「검사보고서」·「수리보고서」 — 양식의 제목에서 온다. 페이지가 만들어 넘긴다. */
  kindLabel: string;
  /** `No. [앞]-[중간]-[뒤]` 를 이은 것. 세 칸을 다 비워 두고도 저장되므로 빈 글자일 수 있다. */
  reportNumber: string;
  /** "YYYY-MM-DD" */
  issuedOn: string;
  /** 지운 때(`2026-09-02 14:33`). 읽을 수 없으면 null. */
  deletedAtLabel: string | null;
  /** 지운 사람의 이름. 계정이 지워졌으면 null. */
  deletedByName: string | null;
  /** 지울 때 적어 둔 사유. 안 적었으면 null. */
  deleteReason: string | null;
};

/** 목록 조각과 같은 자리, 같은 문구 — 번호 세 칸을 다 비운 채로도 저장된다. */
function rowTitle(row: DeletedServiceReportListRow): string {
  return row.reportNumber === "" ? "문서번호 없음" : row.reportNumber;
}

export default function ServiceReportTabs({
  savedCount,
  trashRows,
  children,
}: {
  /** 「사용중 (N)」 의 N. children 을 세어 볼 수는 없으므로 페이지가 알려 준다. */
  savedCount: number;
  trashRows: readonly DeletedServiceReportListRow[];
  /** 저장된 목록. 서버가 그려서 넘긴다 — 위 머리말의 '「사용중」 은 children 이다'. */
  children: ReactNode;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<"active" | "trash">("active");

  /**
   * 확인 창은 이 저장소의 표준 창을 쓴다(`common/master-data-trash-dialogs`).
   * 고객사·제품 모델·견적서가 쓰는 바로 그 창이라, 되살리는 일의 생김새가 화면마다
   * 달라지지 않는다.
   *
   * 창은 자기 상태를 갖지 않는다 — 열림 여부·전송 중·오류는 전부 여기가 소유한다
   * (그 파일의 원칙 그대로).
   */
  const [restoreTarget, setRestoreTarget] = useState<DeletedServiceReportListRow | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [restoreError, setRestoreError] = useState<string | null>(null);

  function openRestore(row: DeletedServiceReportListRow) {
    setRestoreTarget(row);
    setRestoreError(null);
  }

  async function confirmRestore() {
    if (!restoreTarget || busyId) return;
    setBusyId(restoreTarget.id);
    setRestoreError(null);
    const result = await restoreServiceReportAction({
      serviceReportId: restoreTarget.id,
      expectedVersion: restoreTarget.version,
    });
    setBusyId(null);
    if (!result.ok) {
      // 🔴 창을 닫지 않는다. 실패 문장은 **창 안에** 뜨고(`submitError`), 사람은
      //    그 자리에서 다시 누르거나 취소한다 — 목록 위에 띄우면 창에 가린다.
      setRestoreError(result.message);
      return;
    }
    setRestoreTarget(null);
    // 되살린 장은 「사용중」 목록에 다시 나타나야 한다. 그 목록은 서버가 그리므로
    // 여기서 손으로 옮기지 않고 서버에 다시 묻는다.
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-1 border-b border-zinc-200 dark:border-zinc-800">
        <TabButton isActive={tab === "active"} onClick={() => setTab("active")}>
          사용중 ({savedCount})
        </TabButton>
        <TabButton isActive={tab === "trash"} onClick={() => setTab("trash")}>
          휴지통 ({trashRows.length})
        </TabButton>
      </div>

      {tab === "trash" ? (
        <ServiceReportTrashList rows={trashRows} busyId={busyId} onRestore={openRestore} />
      ) : (
        children
      )}

      <MasterDataRestoreDialog
        isOpen={restoreTarget !== null}
        entityLabel="보고서"
        names={restoreTarget ? [`${restoreTarget.kindLabel} ${rowTitle(restoreTarget)}`] : []}
        // cascadeNote 를 넘기지 않는다 — 딸려 오는 것도, 되살리기를 막는 겹침도
        // 없다(문서번호에 유일성을 걸지 않았다 — mutation 머리말).
        isSubmitting={busyId !== null}
        submitError={restoreError}
        onConfirm={() => void confirmRestore()}
        onCancel={() => setRestoreTarget(null)}
      />
    </div>
  );
}

function TabButton({
  isActive,
  onClick,
  children,
}: {
  isActive: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={isActive ? "true" : undefined}
      className={
        isActive
          ? "-mb-px border-b-2 border-zinc-900 px-3 py-1.5 text-sm font-medium text-zinc-900 dark:border-zinc-100 dark:text-zinc-50"
          : "-mb-px border-b-2 border-transparent px-3 py-1.5 text-sm text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
      }
    >
      {children}
    </button>
  );
}

/**
 * 휴지통. 되살리기만 있고 **영구 삭제는 없다** — 보고서는 접수 건이 영구
 * 삭제될 때 함께 사라진다(CASCADE, `schema/service-reports.ts` 의 «판단 1»).
 *
 * 한 줄을 눌러도 아무 데도 가지 않는다. 지워진 장은 id 로도 열리지 않으므로
 * (`queries/service-reports.ts`) 링크를 걸면 반드시 깨진다.
 */
function ServiceReportTrashList({
  rows,
  busyId,
  onRestore,
}: {
  rows: readonly DeletedServiceReportListRow[];
  busyId: string | null;
  onRestore: (row: DeletedServiceReportListRow) => void;
}) {
  if (rows.length === 0) {
    return (
      <p className="rounded-lg border border-zinc-200 bg-white p-6 text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
        휴지통이 비어 있습니다.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-2">
      {rows.map((row) => {
        const title = rowTitle(row);
        return (
          <li
            key={row.id}
            className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-lg border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900"
          >
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="rounded border border-zinc-300 px-1.5 py-0.5 text-[11px] font-medium text-zinc-700 dark:border-zinc-700 dark:text-zinc-300">
                  {row.kindLabel}
                </span>
                <span className="text-sm font-medium text-zinc-900 dark:text-zinc-50">{title}</span>
                <span className="text-xs text-zinc-500 dark:text-zinc-400">
                  발행일 {row.issuedOn}
                </span>
              </div>
              <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                {/* 시각도 사람도 못 읽을 수 있다(옛 자료·지워진 계정). 그때는
                    지어내지 않고 아는 것만 적는다. */}
                {row.deletedAtLabel !== null && `${row.deletedAtLabel} 삭제`}
                {row.deletedByName !== null &&
                  `${row.deletedAtLabel !== null ? " · " : ""}${row.deletedByName}`}
                {row.deleteReason !== null && ` · 사유: ${row.deleteReason}`}
              </p>
            </div>

            <button
              type="button"
              onClick={() => onRestore(row)}
              // 되살리는 동안에는 다른 줄의 단추도 잠근다 — 두 장을 겹쳐 보내면
              // 어느 것이 실패했는지 창 하나로는 말할 수 없다(견적서와 같은 방식).
              disabled={busyId !== null}
              className="rounded-md border border-zinc-300 px-3 py-1 text-xs disabled:opacity-50 dark:border-zinc-700"
            >
              {busyId === row.id ? "되살리는 중…" : "되살리기"}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
