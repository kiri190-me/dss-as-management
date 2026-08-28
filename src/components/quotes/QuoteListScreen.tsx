"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LIST_CARD_GRID, ResponsiveList } from "@/components/common/responsive-list";
import {
  MasterDataDeleteDialog,
  MasterDataRestoreDialog,
} from "@/components/common/master-data-trash-dialogs";
import { deleteQuoteAction, restoreQuoteAction } from "@/lib/server/actions/quotes";
import type { DeletedQuoteRow, QuoteListItem } from "@/lib/db/queries/quotes";
import { quoteKindLabels } from "@/lib/validation/quote-input";

/**
 * ============================================================================
 * 견적서 목록 — /quotes (3단계)
 * ============================================================================
 * 한 줄이 견적서 한 장이다. 같은 모델에서 여러 장이 나오므로(재견적·항목 조정)
 * 번호만으로도 모델명만으로도 어느 것인지 알 수 없고, 그래서 목록의 첫 칸이
 * **여섯을 붙인 한 줄**이다:
 *
 *     DSS 2026-077 ICD CFK300FH-IC2 WU8042 1612027 Bias Fwd Drop 발생
 *
 * 그 문자열은 여기서 만들지 않는다 — 서버가 조회하면서 만들어 내려보낸다
 * (domain/quote-list.ts 의 buildQuoteSummaryLine). 검색을 붙이면 그 대상도 같은
 * 문자열이어야 하고, 표와 카드가 각자 join 하면 언젠가 한 곳만 순서가 달라진다.
 * ⚠️ 그 순서에서 **L/N 이 S/N 보다 앞**이다. 값 모양으로 짐작하지 말 것.
 *
 * 표/카드 전환은 ResponsiveList 가 정한다 — 폭을 실제로 재서 고르고, 사람이 한
 * 번이라도 고르면 그 선택이 이긴다. 여기서 브레이크포인트를 따로 두지 않는다
 * (responsive-list.tsx 헤더).
 *
 * `stickyHeader` 는 넘기지 않는다(기본 꺼짐). 켜려면 부르는 쪽이 확정 높이를
 * 가진 세로 flex 상자여야 하는데 이 화면은 아니다 — 내자 정리만 그 조건을
 * 만족한다.
 *
 * ── 검색은 요약 줄 하나로 한다 ──────────────────────────────────────────
 * 칸별 필터를 두지 않았다. 사람이 찾는 방식이 "WU8042 짜리 그거"이지 "L/N 칸에
 * WU8042"가 아니고, 요약 줄에 이미 여섯이 다 들어 있다. 품명(subject)까지 함께
 * 훑는 것은 그것이 목록에 보이는 값이기 때문이다 — 보이는데 안 걸리면 검색이
 * 고장난 것으로 읽힌다.
 * ============================================================================
 */

const AMOUNT_FORMAT = new Intl.NumberFormat("ko-KR");

function formatAmount(value: number): string {
  return `₩${AMOUNT_FORMAT.format(Math.round(value))}`;
}

function formatDate(isoDate: string): string {
  // quote_date 는 date 칼럼이라 "2026-08-28" 꼴로 온다. new Date 로 돌리면
  // 시간대에 따라 하루가 밀리므로 글자를 그대로 나눈다.
  const [year, month, day] = isoDate.split("-");
  if (!year || !month || !day) return isoDate;
  return `${year}. ${month}. ${day}.`;
}

export default function QuoteListScreen({
  rows,
  trashRows,
  canEdit,
  canDelete,
}: {
  rows: QuoteListItem[];
  /** 휴지통. 지울 수 없는 사람에게는 빈 배열이 온다 — 못 여는 탭의 내용을 실어 보내지 않는다. */
  trashRows: DeletedQuoteRow[];
  canEdit: boolean;
  canDelete: boolean;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<"active" | "trash">("active");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [trashError, setTrashError] = useState<string | null>(null);

  /**
   * 확인 창은 이 저장소의 표준 창을 쓴다(components/common/master-data-trash-dialogs).
   * 고객사·제품 모델이 쓰는 바로 그 창이라, 지우는 일의 생김새가 화면마다 달라지지
   * 않는다. **보관 문구만 우리 것을 넘긴다** — 견적서에는 자동 만료도 영구 삭제도
   * 없어서 기본 문장(15일 뒤 완전 삭제)이 사실이 아니다.
   *
   * 창은 자기 상태를 갖지 않는다. 열림 여부·사유·전송 중·오류는 전부 여기가
   * 소유한다(그 파일의 원칙 그대로).
   */
  const [deleteTarget, setDeleteTarget] = useState<QuoteListItem | null>(null);
  const [restoreTarget, setRestoreTarget] = useState<DeletedQuoteRow | null>(null);
  const [reason, setReason] = useState("");

  function openDelete(row: QuoteListItem) {
    setDeleteTarget(row);
    setReason("");
    setTrashError(null);
  }

  async function confirmDelete() {
    if (!deleteTarget || busyId) return;
    setBusyId(deleteTarget.id);
    setTrashError(null);
    const result = await deleteQuoteAction({
      id: deleteTarget.id,
      expectedVersion: deleteTarget.version,
      reason: reason.trim() === "" ? null : reason.trim(),
    });
    setBusyId(null);
    if (!result.ok) {
      setTrashError(result.message);
      return;
    }
    setDeleteTarget(null);
    router.refresh();
  }

  async function confirmRestore() {
    if (!restoreTarget || busyId) return;
    setBusyId(restoreTarget.id);
    setTrashError(null);
    const result = await restoreQuoteAction({
      id: restoreTarget.id,
      expectedVersion: restoreTarget.version,
    });
    setBusyId(null);
    if (!result.ok) {
      setTrashError(result.message);
      return;
    }
    setRestoreTarget(null);
    router.refresh();
  }

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle === "") return rows;
    return rows.filter(
      (row) =>
        row.summaryLine.toLowerCase().includes(needle) ||
        row.subject.toLowerCase().includes(needle)
    );
  }, [rows, query]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-4">
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">견적서</h1>
        {canEdit && (
          <Link
            href="/quotes/new"
            className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            새 견적서
          </Link>
        )}
      </div>

      {/* 탭 자체가 삭제 권한이 있는 세션에만 그려진다 — 볼 수 없는 휴지통의
          존재를 알릴 이유가 없다(고객사 관리와 같은 판단). */}
      {canDelete && (
        <div className="flex gap-1 border-b border-zinc-200 dark:border-zinc-800">
          <button
            type="button"
            onClick={() => setTab("active")}
            className={
              tab === "active"
                ? "-mb-px border-b-2 border-zinc-900 px-3 py-1.5 text-sm font-medium text-zinc-900 dark:border-zinc-100 dark:text-zinc-50"
                : "-mb-px border-b-2 border-transparent px-3 py-1.5 text-sm text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
            }
          >
            사용중 ({rows.length})
          </button>
          <button
            type="button"
            onClick={() => setTab("trash")}
            className={
              tab === "trash"
                ? "-mb-px border-b-2 border-zinc-900 px-3 py-1.5 text-sm font-medium text-zinc-900 dark:border-zinc-100 dark:text-zinc-50"
                : "-mb-px border-b-2 border-transparent px-3 py-1.5 text-sm text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
            }
          >
            휴지통 ({trashRows.length})
          </button>
        </div>
      )}

      {trashError && (
        <p className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {trashError}
        </p>
      )}

      {tab === "trash" ? (
        <QuoteTrashList rows={trashRows} busyId={busyId} onRestore={setRestoreTarget} />
      ) : (
      <>
      <label className="flex flex-col gap-1 text-xs">
        <span className="sr-only">견적서 검색</span>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="견적서번호 · 고객사 · 모델명 · L/N · S/N · 신고증상 · 품명"
          className="w-full max-w-xl rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        />
      </label>

      {rows.length === 0 ? (
        <p className="rounded-lg border border-zinc-200 bg-white p-6 text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
          아직 만든 견적서가 없습니다.
        </p>
      ) : filtered.length === 0 ? (
        <p className="rounded-lg border border-zinc-200 bg-white p-6 text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
          검색과 일치하는 견적서가 없습니다.
        </p>
      ) : (
        <ResponsiveList
          listId="quotes"
          meta={
            <span className="mr-auto text-xs text-zinc-500 dark:text-zinc-400">
              {filtered.length}건{filtered.length !== rows.length && ` / 전체 ${rows.length}건`}
            </span>
          }
          measureKey={[filtered.length, canEdit]}
          table={<QuoteTable rows={filtered} canDelete={canDelete} busyId={busyId} onDelete={openDelete} />}
          cards={<QuoteCardList rows={filtered} canDelete={canDelete} busyId={busyId} onDelete={openDelete} />}
        />
      )}
      </>
      )}

      <MasterDataDeleteDialog
        isOpen={deleteTarget !== null}
        entityLabel="견적서"
        names={deleteTarget ? [deleteTarget.summaryLine] : []}
        retentionNote={
          <>
            휴지통에 있는 동안에는 목록에서 보이지 않고 견적서 파일도 나오지 않지만,
            <strong className="font-medium text-zinc-800 dark:text-zinc-200">
              {" "}
              언제든 되살릴 수 있습니다
            </strong>
            . 견적서는 자동으로 완전히 삭제되지 않습니다.
          </>
        }
        cascadeNote={
          <>부품 줄과 금액은 그대로 남고, 되살리면 함께 돌아옵니다.</>
        }
        reason={reason}
        isSubmitting={busyId !== null}
        submitError={trashError}
        onReasonChange={setReason}
        onConfirm={() => void confirmDelete()}
        onCancel={() => setDeleteTarget(null)}
      />

      <MasterDataRestoreDialog
        isOpen={restoreTarget !== null}
        entityLabel="견적서"
        names={restoreTarget ? [restoreTarget.summaryLine] : []}
        cascadeNote={
          <>같은 발행번호의 견적서가 이미 있으면 되살릴 수 없습니다.</>
        }
        isSubmitting={busyId !== null}
        submitError={trashError}
        onConfirm={() => void confirmRestore()}
        onCancel={() => setRestoreTarget(null)}
      />
    </div>
  );
}

/**
 * 휴지통. 되살리기만 있고 **영구 삭제는 없다** — 견적서는 고객사에 나간
 * 문서라 무엇을 얼마에 불렀는지가 남아야 한다(mutations/quote-trash.ts).
 */
function QuoteTrashList({
  rows,
  busyId,
  onRestore,
}: {
  rows: DeletedQuoteRow[];
  busyId: string | null;
  onRestore: (row: DeletedQuoteRow) => void;
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
      {rows.map((row) => (
        <li
          key={row.id}
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-zinc-200 bg-white p-3 text-sm dark:border-zinc-800 dark:bg-zinc-900"
        >
          <div className="min-w-0">
            <p className="text-zinc-900 dark:text-zinc-50">{row.summaryLine}</p>
            <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
              {row.subject}
              {row.deletedAt && ` · ${formatDeletedAt(row.deletedAt)} 삭제`}
              {row.deleteReason && ` · 사유: ${row.deleteReason}`}
            </p>
          </div>
          <button
            type="button"
            onClick={() => onRestore(row)}
            disabled={busyId !== null}
            className="rounded-md border border-zinc-300 px-3 py-1 text-xs disabled:opacity-50 dark:border-zinc-700"
          >
            {busyId === row.id ? "되살리는 중…" : "되살리기"}
          </button>
        </li>
      ))}
    </ul>
  );
}

function formatDeletedAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit" });
}

type RowActionProps = {
  canDelete: boolean;
  busyId: string | null;
  onDelete: (row: QuoteListItem) => void;
};

function QuoteTable({ rows, canDelete, busyId, onDelete }: { rows: QuoteListItem[] } & RowActionProps) {
  return (
    <table className="w-full min-w-[56rem] border-collapse text-sm">
      <thead className="bg-zinc-50 text-left text-xs text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
        <tr>
          <th className="px-3 py-2 font-medium">발행일자</th>
          <th className="px-3 py-2 font-medium">견적서</th>
          <th className="px-3 py-2 font-medium">품명</th>
          <th className="px-3 py-2 font-medium">인수번호</th>
          <th className="px-3 py-2 text-right font-medium">공급가</th>
          <th className="px-3 py-2 font-medium"><span className="sr-only">견적서 파일</span></th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr
            key={row.id}
            className="border-t border-zinc-200 align-top dark:border-zinc-800"
          >
            <td className="whitespace-nowrap px-3 py-2 text-zinc-500 dark:text-zinc-400">
              {formatDate(row.quoteDate)}
            </td>
            <td className="px-3 py-2">
              <span className="flex flex-wrap items-center gap-1.5">
                <KindTag kind={row.kind} />
                <Link
                  href={`/quotes/${row.id}`}
                  className="font-medium text-zinc-900 underline-offset-2 hover:underline dark:text-zinc-50"
                >
                  {row.summaryLine}
                </Link>
              </span>
            </td>
            <td className="px-3 py-2 text-zinc-600 dark:text-zinc-300">{row.subject}</td>
            <td className="whitespace-nowrap px-3 py-2 text-zinc-600 dark:text-zinc-300">
              <IntakeLink row={row} />
            </td>
            <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-zinc-900 dark:text-zinc-50">
              {formatAmount(row.supplyAmount)}
              <span className="ml-1 text-xs text-zinc-400 dark:text-zinc-500">
                ({row.itemCount}품목)
              </span>
            </td>
            <td className="whitespace-nowrap px-3 py-2">
              <div className="flex gap-1">
                <PreviewLink id={row.id} />
                <DownloadLink row={row} />
                {canDelete && <DeleteButton row={row} busyId={busyId} onDelete={onDelete} />}
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function QuoteCardList({ rows, canDelete, busyId, onDelete }: { rows: QuoteListItem[] } & RowActionProps) {
  return (
    <div className={LIST_CARD_GRID}>
      {rows.map((row) => (
        <div
          key={row.id}
          className="flex flex-col gap-2 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
        >
          <span className="flex flex-wrap items-center gap-1.5">
            <KindTag kind={row.kind} />
            <Link
              href={`/quotes/${row.id}`}
              className="text-sm font-medium text-zinc-900 underline-offset-2 hover:underline dark:text-zinc-50"
            >
              {row.summaryLine}
            </Link>
          </span>
          <p className="text-sm text-zinc-600 dark:text-zinc-300">{row.subject}</p>
          <dl className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500 dark:text-zinc-400">
            <div className="flex gap-1">
              <dt>발행일자</dt>
              <dd className="text-zinc-700 dark:text-zinc-300">{formatDate(row.quoteDate)}</dd>
            </div>
            <div className="flex gap-1">
              <dt>인수번호</dt>
              <dd className="text-zinc-700 dark:text-zinc-300">
                <IntakeLink row={row} />
              </dd>
            </div>
          </dl>
          <p className="text-sm tabular-nums text-zinc-900 dark:text-zinc-50">
            {formatAmount(row.supplyAmount)}
            <span className="ml-1 text-xs text-zinc-400 dark:text-zinc-500">
              ({row.itemCount}품목 · 부가세 별도)
            </span>
          </p>
          <div className="flex gap-1">
            <PreviewLink id={row.id} />
            <DownloadLink row={row} />
            {canDelete && <DeleteButton row={row} busyId={busyId} onDelete={onDelete} />}
          </div>
        </div>
      ))}
    </div>
  );
}

/** 미리보기 · PDF. 브라우저 인쇄에서 "PDF로 저장"을 고르면 파일이 된다. */
function PreviewLink({ id }: { id: string }) {
  return (
    <Link
      href={`/quotes/${id}/print`}
      className="inline-block rounded-md border border-zinc-300 px-2 py-1 text-xs text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
    >
      미리보기 · PDF
    </Link>
  );
}

function DeleteButton({
  row,
  busyId,
  onDelete,
}: {
  row: QuoteListItem;
  busyId: string | null;
  onDelete: (row: QuoteListItem) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onDelete(row)}
      disabled={busyId !== null}
      className="rounded-md border border-red-300 px-2 py-1 text-xs text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950"
    >
      {busyId === row.id ? "지우는 중…" : "삭제"}
    </button>
  );
}

/** 내자인지 OH인지. 목록에서 두 종류가 섞여 보이므로 한눈에 갈려야 한다. */
function KindTag({ kind }: { kind: QuoteListItem["kind"] }) {
  const isOverhaul = kind === "OVERHAUL";
  return (
    <span
      className={
        isOverhaul
          ? "rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200"
          : "rounded border border-zinc-300 px-1.5 py-0.5 text-[11px] text-zinc-600 dark:border-zinc-700 dark:text-zinc-400"
      }
    >
      {quoteKindLabels[kind]}
    </span>
  );
}

/**
 * 견적서 xlsx 를 받는 링크. `<a download>` 가 아니라 그냥 링크다 — 파일 이름은
 * 서버가 Content-Disposition 으로 정한다(domain/quote-file-name.ts). 클라이언트가
 * 이름을 정하면 목록과 상세에서 서로 다른 이름으로 저장되는 날이 온다.
 *
 * 이 주소는 화면이 감추든 말든 스스로 세션·권한을 다시 확인하고, 나갈 때마다
 * 감사 기록(EXCEL_EXPORT)을 남긴다 — 직인이 찍힌 문서다.
 */
function DownloadLink({ row }: { row: QuoteListItem }) {
  return (
    <a
      href={`/api/quotes/${row.id}/xlsx`}
      className="inline-block rounded-md border border-zinc-300 px-2 py-1 text-xs text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
    >
      견적서 받기
    </a>
  );
}

/**
 * 연결이 살아 있으면 접수 건으로 건너가는 링크, 아니면 글자만. 연결이 끊긴
 * 장(접수 건을 영구 삭제한 경우)은 quotes.intake_number_text 에 남은 번호를
 * 보여 준다 — 사람이 보고 다시 이어 붙일 수 있는 유일한 단서다.
 */
function IntakeLink({ row }: { row: QuoteListItem }) {
  if (!row.intakeNumber) {
    return <span className="text-zinc-400 dark:text-zinc-500">—</span>;
  }
  if (!row.repairCaseId) {
    return <span title="연결된 접수 건이 없습니다">{row.intakeNumber}</span>;
  }
  return (
    <Link
      href={`/repair-cases/${row.repairCaseId}`}
      className="underline-offset-2 hover:underline"
    >
      {row.intakeNumber}
    </Link>
  );
}
