"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";

import {
  MasterDataPermanentDeleteDialog,
  MasterDataRestoreDialog,
} from "@/components/common/master-data-trash-dialogs";
import {
  permanentlyDeleteServiceReportAction,
  restoreServiceReportAction,
} from "@/lib/server/actions/service-reports";

/**
 * ============================================================================
 * 「보고서」 탭 — 사용중 / 휴지통
 * ============================================================================
 * 지운 보고서를 되살리고, 되살릴 생각이 없는 장을 아예 없애는 자리다. 견적서
 * 목록이 하는 일과 같아서 생김새도 그쪽을 그대로 옮겼다 — ⚠️ 그 화면은
 * 2026-10-07 부터 **공용 묶음의 것**이다
 * (`vendor/dss-core/src/ui/quotes/QuoteListScreen.tsx`).
 *
 * ── 🔴 「완전 삭제」 는 2026-10-28 에 생겼다 ───────────────────────────
 * 🔴 **먼저 왜 없었는지부터.** 여기에는 이렇게 적혀 있었다: 두 문서는 정책도
 * 같고, 보고서에는 **소프트 삭제만 있고 영구 삭제도 자동 만료도 없으므로**
 * 「완전 삭제」 단추도 「N일 뒤 사라집니다」 문구도 없다. 그 근거는
 * `mutations/service-reports.ts` 가 "보고서만 따로 영구 삭제하는 경로를 **미리
 * 만들어 둘 이유가 없다**"고 적어 둔 것이었다.
 *
 * 🔴 그 말은 「금지」가 아니라 「아직 쓸 데가 없다」였고, 2026-10-28 에 사용자가
 * 필요하다고 정해 뒤집혔다. 지금은 **[되살리기] 옆에 [완전 삭제] 가 선다.**
 * 바뀐 것과 **그대로인 것**을 가려 둔다:
 *   · 바뀜  — 사람이 눌러서 한 장을 아예 없애는 길이 생겼다.
 *   · 그대로 — **자동 만료는 여전히 없다.** 「N일 뒤 사라집니다」 문구를 여기에
 *     들이지 마라. 휴지통에 둔 장은 누가 누르기 전까지 그대로 있다.
 *
 * 🔴 **단추가 아무에게나 보이지 않는다** — 개발자 모드 관문을 넘은 사람에게만
 * 그린다(`canPermanentlyDelete`, 페이지가 `mayEnterDeveloperMode` 로 정해
 * 넘긴다). 되돌릴 수 없는 데다 법인 직인이 찍혀 고객사로 나간 문서라 그렇게
 * 정했다. 화면은 경계가 아니다 — 서버 액션이 같은 관문을 다시 지난다.
 *
 * ⚠️ **견적서도 완전 삭제가 있다**(`mutations/quote-trash.ts` 의
 * `permanentlyDeleteQuote` — 2026-10-28 실측). 그래서 "두 문서는 정책이 같다"는
 * 위 옛 문장은 지금도 거의 맞는다. 다른 것은 **문턱**이다: 견적서는 quotes
 * MANAGE 면 누르고, 보고서는 거기에 개발자 모드 관문이 하나 더 붙는다.
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
  /**
   * 줄의 이름 — `모델명_L/N_S/N`. 🔴 **「사용중」 목록과 같은 규칙, 같은
   * 함수**다(`domain/service-report-list.ts`) — 두 탭이 한 장을 다른 이름으로
   * 부르면 방금 지운 것을 못 찾는다. 빈 글자로 오지 않는다.
   */
  name: string;
  /**
   * `No. [앞]-[중간]-[뒤]` 를 이은 것. 세 칸을 다 비워 두고도 저장되므로 빈
   * 글자일 수 있고, 그때는 그리지 않는다.
   */
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

export default function ServiceReportTabs({
  savedCount,
  trashRows,
  canPermanentlyDelete,
  children,
}: {
  /** 「사용중 (N)」 의 N. children 을 세어 볼 수는 없으므로 페이지가 알려 준다. */
  savedCount: number;
  trashRows: readonly DeletedServiceReportListRow[];
  /**
   * 🔴 휴지통 줄에 [완전 삭제] 를 그릴 것인가. 페이지가 개발자 모드 관문으로
   * 정해 넘긴다 — 위 머리말의 '단추가 아무에게나 보이지 않는다'.
   *
   * 🔴 **이 값은 편의일 뿐 경계가 아니다.** `false` 로 와도 서버 액션은 스스로
   * 같은 관문을 다시 지나고, 거기서 거절한다.
   */
  canPermanentlyDelete: boolean;
  /** 저장된 목록. 서버가 그려서 넘긴다 — 위 머리말의 '「사용중」 은 children 이다'. */
  children: ReactNode;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<"active" | "trash">("active");

  /**
   * 확인 창은 이 저장소의 표준 창을 쓴다(`common/master-data-trash-dialogs`).
   * 고객사·제품 모델·견적서가 쓰는 바로 그 창이라, 되살리는 일과 없애는 일의
   * 생김새가 화면마다 달라지지 않는다.
   *
   * 창은 자기 상태를 갖지 않는다 — 열림 여부·사유·전송 중·오류는 전부 여기가
   * 소유한다(그 파일의 원칙 그대로).
   *
   * 🔴 **오류 상태를 두 창이 함께 쓴다**(`trashError`). 두 창은 동시에 열리지
   * 않고(`openRestore`·`openPurge` 가 서로의 대상을 비운다), 열 때마다 비운다 —
   * 견적서 목록 화면이 하는 그대로다.
   */
  const [restoreTarget, setRestoreTarget] = useState<DeletedServiceReportListRow | null>(null);
  const [purgeTarget, setPurgeTarget] = useState<DeletedServiceReportListRow | null>(null);
  const [purgeReason, setPurgeReason] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [trashError, setTrashError] = useState<string | null>(null);

  function openRestore(row: DeletedServiceReportListRow) {
    setRestoreTarget(row);
    setPurgeTarget(null);
    setTrashError(null);
  }

  function openPurge(row: DeletedServiceReportListRow) {
    setPurgeTarget(row);
    setRestoreTarget(null);
    // 🔴 사유는 **열 때마다** 비운다. 앞서 다른 장에 적어 둔 글이 남아 있으면
    //    사람은 빈칸으로 알고 [완전 삭제] 를 누르는데, 감사에는 엉뚱한 장의
    //    이유가 적힌다.
    setPurgeReason("");
    setTrashError(null);
  }

  async function confirmRestore() {
    if (!restoreTarget || busyId) return;
    setBusyId(restoreTarget.id);
    setTrashError(null);
    const result = await restoreServiceReportAction({
      serviceReportId: restoreTarget.id,
      expectedVersion: restoreTarget.version,
    });
    setBusyId(null);
    if (!result.ok) {
      // 🔴 창을 닫지 않는다. 실패 문장은 **창 안에** 뜨고(`submitError`), 사람은
      //    그 자리에서 다시 누르거나 취소한다 — 목록 위에 띄우면 창에 가린다.
      setTrashError(result.message);
      return;
    }
    setRestoreTarget(null);
    // 되살린 장은 「사용중」 목록에 다시 나타나야 한다. 그 목록은 서버가 그리므로
    // 여기서 손으로 옮기지 않고 서버에 다시 묻는다.
    router.refresh();
  }

  async function confirmPurge() {
    /**
     * 🔴 **두 번 누르기를 여기서 막는다.** `busyId` 가 비어 있지 않으면 이미 한
     * 번 보냈다는 뜻이다 — 되돌릴 수 없는 조작이라 두 번째 요청은 첫 번째가 이미
     * 지운 행을 다시 지우려 들고, 사람은 NOT_FOUND 를 보고 "실패했나" 하고 또
     * 누른다. 사유가 비어 있으면 창의 단추가 이미 꺼져 있지만, 서버도 다시 막는다
     * (`readServiceReportPurgeReason`).
     */
    if (!purgeTarget || busyId || purgeReason.trim() === "") return;
    setBusyId(purgeTarget.id);
    setTrashError(null);
    const result = await permanentlyDeleteServiceReportAction({
      serviceReportId: purgeTarget.id,
      expectedVersion: purgeTarget.version,
      reason: purgeReason.trim(),
    });
    setBusyId(null);
    if (!result.ok) {
      setTrashError(result.message);
      return;
    }
    setPurgeTarget(null);
    setPurgeReason("");
    // 지운 장은 휴지통 목록에서도 사라져야 한다 — 그 목록도 서버가 읽어 넘긴 것이다.
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
        <ServiceReportTrashList
          rows={trashRows}
          busyId={busyId}
          // 🔴 어느 단추에 「…중」 을 붙일지 가른다. 둘 다 같은 `busyId` 를 쓰므로
          //    이 값이 없으면 [완전 삭제] 를 눌렀는데 [되살리는 중…] 이 뜬다.
          busyAction={busyId === null ? null : purgeTarget?.id === busyId ? "purge" : "restore"}
          canPermanentlyDelete={canPermanentlyDelete}
          onRestore={openRestore}
          onPermanentDelete={openPurge}
        />
      ) : (
        children
      )}

      <MasterDataRestoreDialog
        isOpen={restoreTarget !== null}
        entityLabel="보고서"
        // 창에 적는 이름도 목록에 보이던 그 이름이다 — 되살릴 것을 고른 사람이
        // 창에서 다른 글자를 보면 같은 장인지 확신할 수 없다.
        names={restoreTarget ? [`${restoreTarget.kindLabel} ${restoreTarget.name}`] : []}
        // cascadeNote 를 넘기지 않는다 — 딸려 오는 것도, 되살리기를 막는 겹침도
        // 없다(문서번호에 유일성을 걸지 않았다 — mutation 머리말).
        isSubmitting={busyId !== null}
        submitError={trashError}
        onConfirm={() => void confirmRestore()}
        onCancel={() => setRestoreTarget(null)}
      />

      {/* 🔴 완전 삭제 확인 — **새로 만들지 않고** 이 저장소의 표준 창을 그대로
          쓴다(고객사·제품 모델·견적서가 쓰는 그 창). 그 창은 사유를 필수로 받고
          [완전 삭제] 를 붉게 그리며 "되돌릴 수 없습니다" 를 스스로 말한다 —
          되돌릴 수 없는 조작의 문구가 화면마다 달라지면 안 된다. */}
      <MasterDataPermanentDeleteDialog
        isOpen={purgeTarget !== null}
        entityLabel="보고서"
        names={purgeTarget ? [`${purgeTarget.kindLabel} ${purgeTarget.name}`] : []}
        cascadeNote={
          <>
            적어 둔 <strong className="font-medium text-zinc-800 dark:text-zinc-200">확인내용 · 조치 ·
            정리 · 비고와 고른 원인</strong>도 함께 사라집니다. 접수 건과 그 건의 다른 보고서는 그대로
            남습니다.
          </>
        }
        reason={purgeReason}
        isSubmitting={busyId !== null}
        submitError={trashError}
        onReasonChange={setPurgeReason}
        onConfirm={() => void confirmPurge()}
        onCancel={() => setPurgeTarget(null)}
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
 * 휴지통. 줄마다 [되살리기] 가 서고, 개발자 모드 관문을 넘은 사람에게는
 * [완전 삭제] 가 하나 더 선다(2026-10-28 — 위 머리말의 '「완전 삭제」 는
 * 2026-10-28 에 생겼다').
 *
 * ⚠️ **접수 건이 영구 삭제될 때 함께 사라지는 길(CASCADE)은 그대로다**
 * (`schema/service-reports.ts` 의 «판단 1»). 이 단추는 그 길과 **별개로** 보고서
 * 한 장만 따로 없애는 길이다 — 접수 건은 남는다.
 *
 * 한 줄을 눌러도 아무 데도 가지 않는다. 지워진 장은 id 로도 열리지 않으므로
 * (`queries/service-reports.ts`) 링크를 걸면 반드시 깨진다.
 */
function ServiceReportTrashList({
  rows,
  busyId,
  busyAction,
  canPermanentlyDelete,
  onRestore,
  onPermanentDelete,
}: {
  rows: readonly DeletedServiceReportListRow[];
  busyId: string | null;
  /** 지금 도는 것이 되살리기인가 완전 삭제인가. 한가하면 null. */
  busyAction: "restore" | "purge" | null;
  canPermanentlyDelete: boolean;
  onRestore: (row: DeletedServiceReportListRow) => void;
  onPermanentDelete: (row: DeletedServiceReportListRow) => void;
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
                <span className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
                  {row.name}
                </span>
                <span className="text-xs text-zinc-500 dark:text-zinc-400">
                  발행일 {row.issuedOn}
                </span>
                {/* 목록 조각과 같은 자리, 같은 규칙 — 적혀 있을 때만 그린다. */}
                {row.reportNumber !== "" && (
                  <span className="text-xs text-zinc-500 dark:text-zinc-400">
                    No. {row.reportNumber}
                  </span>
                )}
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

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => onRestore(row)}
                // 되살리는 동안에는 다른 줄의 단추도 잠근다 — 두 장을 겹쳐 보내면
                // 어느 것이 실패했는지 창 하나로는 말할 수 없다(견적서와 같은 방식).
                // 🔴 완전 삭제가 도는 동안에도 같은 값이 잠근다. 되돌릴 수 없는
                //    조작이 도는 중에 그 장을 되살리는 요청이 겹쳐 나가면 안 된다.
                disabled={busyId !== null}
                className="rounded-md border border-zinc-300 px-3 py-1 text-xs disabled:opacity-50 dark:border-zinc-700"
              >
                {busyId === row.id && busyAction === "restore" ? "되살리는 중…" : "되살리기"}
              </button>

              {/* 🔴 권한이 없으면 **단추 자체가 없다** — 꺼진 단추로 두지 않는다.
                  꺼진 단추는 "나도 누를 수 있어야 하는데 왜 안 되지"를 묻게 만들고,
                  평소에는 이 길이 있다는 사실조차 보일 이유가 없다. */}
              {canPermanentlyDelete && (
                <button
                  type="button"
                  onClick={() => onPermanentDelete(row)}
                  disabled={busyId !== null}
                  className="rounded-md border border-red-300 px-3 py-1 text-xs text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950"
                >
                  {busyId === row.id && busyAction === "purge" ? "완전 삭제 중…" : "완전 삭제"}
                </button>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
