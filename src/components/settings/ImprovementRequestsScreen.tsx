"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toKstDateOnly } from "@/lib/domain/date-only";
import {
  arrangeImprovementRequestList,
  canDeleteImprovementRequest,
  canEditImprovementRequestBody,
  countImprovementRequestBodyChars,
  IMPROVEMENT_REQUEST_BODY_MAX_CHARS,
  IMPROVEMENT_REQUEST_STATUS_LABELS,
  IMPROVEMENT_REQUEST_STATUSES,
  isImprovementRequestStatus,
  type ImprovementRequestStatus,
} from "@/lib/domain/improvement-request";
import type { ImprovementRequestListItem } from "@/lib/db/queries/improvement-requests";
import {
  changeImprovementRequestStatusAction,
  createImprovementRequestAction,
  deleteImprovementRequestAction,
  updateImprovementRequestAction,
  type ImprovementRequestActionResult,
} from "@/lib/server/actions/improvement-requests";

/**
 * ============================================================================
 * 설정 › 개선 요청 — 적고, 보고, 옮긴다
 * ============================================================================
 *
 * ■ 화면은 규칙을 따로 적지 않는다
 *
 * 누가 어느 글을 고치고 지울 수 있는가는 domain/improvement-request.ts 의
 * canEditImprovementRequestBody · canDeleteImprovementRequest 를 줄마다 그대로
 * 부른다 — 저장(mutation)이 잠근 행으로 부르는 바로 그 함수다. 여기에 조건을 따로
 * 적으면 화면은 단추를 열어 주는데 저장이 거절하는(또는 그 반대의) 날이 온다.
 * 목록 차례(진행중 → 접수 → 해결)도 같은 파일의 arrangeImprovementRequestList 다.
 *
 * ■ 권한 두 개는 페이지가 넘긴다
 *
 * canWrite(WRITE) · canManage(MANAGE)는 페이지가 서버 액션과 **같은 영역 · 같은
 * 수준**으로 구해 넘긴다. 단추를 감추는 것은 편의이고, 막는 것은 액션이다.
 *
 * ■ 버전 충돌은 덮어쓰지 않는다
 *
 * 그 사이 누가 글을 고치거나 상태를 옮겼으면 서버가 CONFLICT 로 돌려준다. 그때는
 * 다시 보내지 않고 안내한 뒤 새로 불러온다 — 낡은 화면에서 누른 조작이 방금 바뀐
 * 글에 닿으면 안 된다. 이미 지워진 글(NOT_FOUND)도 같은 길로 보낸다 — 그 줄은
 * 새로 불러오면 사라진다.
 *
 * ■ 날짜는 KST 달력 날짜
 *
 * toKstDateOnly 는 시간대를 못 박아 둔 포매터라 서버와 브라우저가 같은 글자를
 * 그린다(하이드레이션 어긋남이 없다).
 *
 * 🔴 본문은 자유 입력이다(schema 헤더의 PII). 화면에 그리는 것 말고는 어디로도
 * 내보내지 않는다 — console 에도 싣지 않는다. [복사]는 누른 사람의 클립보드로만
 * 간다(보는 권한만 있어도 쓴다 — 이미 화면에 보이는 글이다).
 * ============================================================================
 */

const CONFLICT_NOTICE = "다른 사람이 먼저 바꿨습니다. 새로 불러옵니다.";
const NOT_FOUND_NOTICE = "이미 지워진 개선 요청입니다. 새로 불러옵니다.";

const STATUS_BADGE_CLASS: Record<ImprovementRequestStatus, string> = {
  OPEN: "border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-900 dark:bg-sky-950 dark:text-sky-300",
  IN_PROGRESS:
    "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300",
  RESOLVED:
    "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300",
};

const TEXTAREA_CLASS =
  "w-full rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50";
const PRIMARY_BUTTON_CLASS =
  "rounded-lg bg-primary-900 px-5 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50 dark:bg-primary-100 dark:text-zinc-900";
const SMALL_BUTTON_CLASS =
  "rounded-md border border-zinc-300 px-2 py-1 text-xs text-zinc-700 hover:border-zinc-900 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300";
const SMALL_DANGER_BUTTON_CLASS =
  "rounded-md border border-red-300 px-2 py-1 text-xs text-red-700 hover:border-red-600 disabled:opacity-50 dark:border-red-800 dark:text-red-400";
const FIELD_ERROR_CLASS = "text-xs text-red-600 dark:text-red-400";

const COPY_DONE_MS = 2000;
const COPY_FAILED_TEXT = "복사하지 못했습니다 — 글을 길게 눌러 직접 복사해 주세요";

/**
 * 두 갈래로 복사한다. 성공하면 true. customer-portal/CustomerLinkAddress.tsx 의
 * copyText 와 같은 모양이다 — NAS 는 http 라 `navigator.clipboard` 가 아예 없어서
 * 옛 방식(숨긴 textarea + execCommand)을 둘째 갈래로 둔다.
 */
async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // https 가 아니거나 권한이 막힌 경우 — 아래 옛 방식으로 넘어간다.
  }

  try {
    const area = document.createElement("textarea");
    area.value = text;
    // 화면 밖에 두되 focus 가 가야 하므로 display:none 은 쓸 수 없다.
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : toKstDateOnly(date);
}

/** 서버가 준 실패를 한 문장으로 — 칸 오류가 있으면 그것이 더 구체적이다. */
function failureText(result: Extract<ImprovementRequestActionResult, { ok: false }>): string {
  const fieldErrors = result.fieldErrors ?? {};
  return fieldErrors.body ?? fieldErrors.to ?? fieldErrors.id ?? fieldErrors.expectedVersion ?? result.message;
}

export default function ImprovementRequestsScreen({
  items,
  actingUserId,
  canWrite,
  canManage,
}: {
  items: ImprovementRequestListItem[];
  actingUserId: string;
  /** hasPermission("improvementRequests", "WRITE") — 페이지가 구해 넘긴다. */
  canWrite: boolean;
  /** hasPermission("improvementRequests", "MANAGE") — 페이지가 구해 넘긴다. */
  canManage: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  /** 지금 서버에 가 있는 조작 — 단추 글자를 「…중」으로 바꿀 자리를 고른다. */
  const [pendingKey, setPendingKey] = useState<string | null>(null);

  const [draft, setDraft] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");

  /** 줄 옆에 붙이는 실패 문구(권한 거절 · 검증 오류 등) — 글 id 로 찾는다. */
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  /** 화면 맨 위 안내 — 충돌해서 새로 불러올 때. */
  const [notice, setNotice] = useState<string | null>(null);

  const [showResolved, setShowResolved] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<ImprovementRequestListItem | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  /**
   * 마지막으로 누른 [복사]의 결과 — 어느 글의 것인지 함께 담는다. 「복사했습니다」는
   * 잠깐 뒤 걷고, 실패 안내는 다음 복사까지 남긴다(읽고 직접 복사해야 하므로).
   */
  const [copyResult, setCopyResult] = useState<{ id: string; state: "copied" | "failed" } | null>(
    null
  );

  // 걷는 타이머는 결과가 바뀌거나 화면이 사라질 때 이 정리 함수가 치운다.
  useEffect(() => {
    if (copyResult?.state !== "copied") return;
    const timer = setTimeout(() => setCopyResult(null), COPY_DONE_MS);
    return () => clearTimeout(timer);
  }, [copyResult]);

  const { rows, resolvedCount, hiddenResolvedCount } = arrangeImprovementRequestList(items, { showResolved });

  function setRowError(id: string, message: string | null) {
    setRowErrors((prev) => {
      const next = { ...prev };
      if (message === null) delete next[id];
      else next[id] = message;
      return next;
    });
  }

  /**
   * 조작 하나를 보내고 결과를 셋으로 가른다 — 성공(새로 그린다) · 새로 불러와야
   * 하는 실패(충돌 · 이미 지워짐) · 그 자리에 적을 실패.
   */
  function run(
    key: string,
    send: () => Promise<ImprovementRequestActionResult>,
    handlers: { onOk: () => void; onFailure: (text: string) => void }
  ) {
    setNotice(null);
    setPendingKey(key);
    startTransition(async () => {
      const result = await send();
      setPendingKey(null);
      if (result.ok) {
        handlers.onOk();
        router.refresh();
        return;
      }
      if (result.code === "CONFLICT" || result.code === "NOT_FOUND") {
        setNotice(result.code === "CONFLICT" ? CONFLICT_NOTICE : NOT_FOUND_NOTICE);
        setEditingId(null);
        setDeleteTarget(null);
        router.refresh();
        return;
      }
      handlers.onFailure(failureText(result));
    });
  }

  function submitNew() {
    setCreateError(null);
    run("create", () => createImprovementRequestAction({ fields: { body: draft } }), {
      onOk: () => setDraft(""),
      onFailure: setCreateError,
    });
  }

  function startEdit(item: ImprovementRequestListItem) {
    setEditingId(item.id);
    setEditDraft(item.body);
    setRowError(item.id, null);
  }

  function saveEdit(item: ImprovementRequestListItem) {
    setRowError(item.id, null);
    run(
      `edit:${item.id}`,
      () =>
        updateImprovementRequestAction({
          id: item.id,
          expectedVersion: item.version,
          fields: { body: editDraft },
        }),
      {
        onOk: () => setEditingId(null),
        onFailure: (text) => setRowError(item.id, text),
      }
    );
  }

  function changeStatus(item: ImprovementRequestListItem, to: string) {
    if (!isImprovementRequestStatus(to) || to === item.status) return;
    setRowError(item.id, null);
    run(
      `status:${item.id}`,
      () => changeImprovementRequestStatusAction({ id: item.id, expectedVersion: item.version, to }),
      {
        onOk: () => {},
        onFailure: (text) => setRowError(item.id, text),
      }
    );
  }

  /** 고치는 중이어도 저장된 본문을 복사한다 — 초안은 아직 이 글이 아니다. */
  async function copyBody(item: ImprovementRequestListItem) {
    const ok = await copyText(item.body);
    setCopyResult({ id: item.id, state: ok ? "copied" : "failed" });
  }

  function openDelete(item: ImprovementRequestListItem) {
    setDeleteError(null);
    setDeleteTarget(item);
  }

  function confirmDelete() {
    const item = deleteTarget;
    if (!item) return;
    setDeleteError(null);
    run(
      `delete:${item.id}`,
      () => deleteImprovementRequestAction({ id: item.id, expectedVersion: item.version }),
      {
        onOk: () => setDeleteTarget(null),
        onFailure: setDeleteError,
      }
    );
  }

  const draftCount = countImprovementRequestBodyChars(draft);
  const draftOver = draftCount > IMPROVEMENT_REQUEST_BODY_MAX_CHARS;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">개선 요청</h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          이 시스템을 쓰다가 불편했던 점, 바뀌었으면 하는 점을 적어 주세요. 관리자·개발자가 접수 →
          진행중 → 해결로 옮깁니다. 진행중이 되면 적은 사람도 내용을 고칠 수 없습니다.
        </p>
      </div>

      {notice ? (
        <p
          role="status"
          className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300"
        >
          {notice}
        </p>
      ) : null}

      {/* ───── 등록 ───── */}
      {canWrite ? (
        <section className="flex flex-col gap-2 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <label
            htmlFor="improvement-request-new-body"
            className="text-sm font-bold text-zinc-900 dark:text-zinc-50"
          >
            새 개선 요청
          </label>
          <textarea
            id="improvement-request-new-body"
            rows={4}
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
              if (createError) setCreateError(null);
            }}
            aria-invalid={createError || draftOver ? true : undefined}
            aria-describedby="improvement-request-new-body-count"
            placeholder="예: 전체 A/S 현황에서 고객사로 거를 때 이름 일부만 쳐도 찾아지면 좋겠습니다."
            className={TEXTAREA_CLASS}
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <BodyCounter id="improvement-request-new-body-count" count={draftCount} />
            <button
              type="button"
              onClick={submitNew}
              disabled={isPending || draft.trim() === "" || draftOver}
              aria-busy={pendingKey === "create"}
              className={PRIMARY_BUTTON_CLASS}
            >
              {pendingKey === "create" ? "등록 중…" : "등록"}
            </button>
          </div>
          {createError ? (
            <p role="alert" className={FIELD_ERROR_CLASS}>
              {createError}
            </p>
          ) : null}
        </section>
      ) : (
        <p className="rounded-md bg-zinc-50 px-3 py-2 text-xs text-zinc-500 dark:bg-zinc-800/60 dark:text-zinc-400">
          읽기 권한만 있어 새 개선 요청을 적을 수 없습니다.
        </p>
      )}

      {/* ───── 목록 ───── */}
      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-bold text-zinc-900 dark:text-zinc-50">
            목록 <span className="font-normal text-zinc-500 dark:text-zinc-400">({rows.length}건)</span>
          </h2>
          <label className="flex items-center gap-2 text-xs text-zinc-700 dark:text-zinc-300">
            <input
              type="checkbox"
              checked={showResolved}
              onChange={(event) => setShowResolved(event.target.checked)}
              className="h-4 w-4"
            />
            해결된 것도 보기
            {hiddenResolvedCount > 0 ? (
              <span className="text-zinc-500 dark:text-zinc-400">({hiddenResolvedCount}건 숨김)</span>
            ) : null}
          </label>
        </div>

        {rows.length === 0 ? (
          <p className="rounded-md bg-zinc-50 px-3 py-4 text-center text-xs text-zinc-500 dark:bg-zinc-800/60 dark:text-zinc-400">
            {resolvedCount > 0 && !showResolved
              ? `지금 열려 있는 개선 요청이 없습니다. 해결된 ${resolvedCount}건은 「해결된 것도 보기」로 볼 수 있습니다.`
              : "아직 적힌 개선 요청이 없습니다."}
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {rows.map((item) => {
              const mayEdit =
                canWrite &&
                canEditImprovementRequestBody({
                  status: item.status,
                  createdBy: item.createdByUserId,
                  actorUserId: actingUserId,
                });
              const mayDelete =
                canWrite &&
                canDeleteImprovementRequest({
                  status: item.status,
                  createdBy: item.createdByUserId,
                  actorUserId: actingUserId,
                  canManage,
                });
              const isEditing = editingId === item.id;
              const editCount = countImprovementRequestBodyChars(editDraft);
              const editOver = editCount > IMPROVEMENT_REQUEST_BODY_MAX_CHARS;
              const rowError = rowErrors[item.id];
              const copyState = copyResult?.id === item.id ? copyResult.state : null;

              return (
                <li
                  key={item.id}
                  className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded border px-1.5 py-0.5 text-xs font-semibold ${STATUS_BADGE_CLASS[item.status]}`}
                    >
                      {IMPROVEMENT_REQUEST_STATUS_LABELS[item.status]}
                    </span>
                    <span className="text-xs text-zinc-500 dark:text-zinc-400">
                      {item.createdByName} · {formatDate(item.createdAt)}
                    </span>
                  </div>

                  {isEditing ? (
                    <div className="mt-2 flex flex-col gap-2">
                      <label htmlFor={`improvement-request-edit-${item.id}`} className="sr-only">
                        개선 요청 내용 고치기
                      </label>
                      <textarea
                        id={`improvement-request-edit-${item.id}`}
                        rows={4}
                        value={editDraft}
                        onChange={(event) => {
                          setEditDraft(event.target.value);
                          if (rowError) setRowError(item.id, null);
                        }}
                        aria-invalid={rowError || editOver ? true : undefined}
                        aria-describedby={`improvement-request-edit-${item.id}-count`}
                        className={TEXTAREA_CLASS}
                      />
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <BodyCounter id={`improvement-request-edit-${item.id}-count`} count={editCount} />
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setEditingId(null);
                              setRowError(item.id, null);
                            }}
                            disabled={isPending}
                            className={SMALL_BUTTON_CLASS}
                          >
                            취소
                          </button>
                          <button
                            type="button"
                            onClick={() => saveEdit(item)}
                            disabled={isPending || editDraft.trim() === "" || editOver}
                            aria-busy={pendingKey === `edit:${item.id}`}
                            className={SMALL_BUTTON_CLASS}
                          >
                            {pendingKey === `edit:${item.id}` ? "저장 중…" : "저장"}
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <p className="mt-2 text-sm break-words whitespace-pre-wrap text-zinc-900 dark:text-zinc-50">
                      {item.body}
                    </p>
                  )}

                  {item.inProgressAt || item.resolvedAt ? (
                    <div className="mt-2 flex flex-col gap-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                      {item.inProgressAt ? (
                        <span>
                          진행중 — {item.inProgressByName ?? "알 수 없음"} · {formatDate(item.inProgressAt)}
                        </span>
                      ) : null}
                      {item.resolvedAt ? (
                        <span>
                          해결 — {item.resolvedByName ?? "알 수 없음"} · {formatDate(item.resolvedAt)}
                        </span>
                      ) : null}
                    </div>
                  ) : null}

                  {/* 단추 줄은 늘 그린다 — [복사]는 보는 권한만 있어도 쓴다. 나머지는 각자 조건. */}
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {canManage ? (
                      <label className="flex items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-400">
                        상태
                        <select
                          value={item.status}
                          onChange={(event) => changeStatus(item, event.target.value)}
                          disabled={isPending}
                          aria-busy={pendingKey === `status:${item.id}`}
                          className="rounded-md border border-zinc-300 px-2 py-1 text-xs text-zinc-900 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
                        >
                          {IMPROVEMENT_REQUEST_STATUSES.map((status) => (
                            <option key={status} value={status}>
                              {IMPROVEMENT_REQUEST_STATUS_LABELS[status]}
                            </option>
                          ))}
                        </select>
                        {pendingKey === `status:${item.id}` ? <span>옮기는 중…</span> : null}
                      </label>
                    ) : null}
                    <div className="ml-auto flex flex-wrap justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => void copyBody(item)}
                        className={SMALL_BUTTON_CLASS}
                      >
                        {copyState === "copied" ? "복사했습니다" : "복사"}
                      </button>
                      {mayEdit && !isEditing ? (
                        <button
                          type="button"
                          onClick={() => startEdit(item)}
                          disabled={isPending}
                          className={SMALL_BUTTON_CLASS}
                        >
                          고치기
                        </button>
                      ) : null}
                      {mayDelete ? (
                        <button
                          type="button"
                          onClick={() => openDelete(item)}
                          disabled={isPending}
                          className={SMALL_DANGER_BUTTON_CLASS}
                        >
                          지우기
                        </button>
                      ) : null}
                    </div>
                  </div>

                  {copyState === "failed" ? (
                    <p role="alert" className={`mt-2 ${FIELD_ERROR_CLASS}`}>
                      {COPY_FAILED_TEXT}
                    </p>
                  ) : null}

                  {rowError ? (
                    <p role="alert" className={`mt-2 ${FIELD_ERROR_CLASS}`}>
                      {rowError}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <DeleteImprovementRequestDialog
        target={deleteTarget}
        isSubmitting={deleteTarget !== null && pendingKey === `delete:${deleteTarget.id}`}
        errorMessage={deleteError}
        onConfirm={confirmDelete}
        onCancel={() => {
          setDeleteTarget(null);
          setDeleteError(null);
        }}
      />
    </div>
  );
}

function BodyCounter({ id, count }: { id: string; count: number }) {
  const over = count > IMPROVEMENT_REQUEST_BODY_MAX_CHARS;
  return (
    <span
      id={id}
      className={`text-xs tabular-nums ${over ? "text-red-600 dark:text-red-400" : "text-zinc-500 dark:text-zinc-400"}`}
    >
      {count} / {IMPROVEMENT_REQUEST_BODY_MAX_CHARS}
      {over ? " — 너무 깁니다" : ""}
    </span>
  );
}

/**
 * 지우기 확인창. 이 앱의 확인창은 전부 native `<dialog>` + `showModal()` 이다
 * (globals.css 의 dialog 주석, WeeklyReportGoalDeleteDialog 를 본보기로 삼았다).
 * 브라우저 기본 `confirm()` 은 어두운 화면·모바일에서 이 앱의 다른 확인창과 전혀
 * 다른 물건이 뜬다.
 *
 * 휴지통이 없어 바로 지워진다(mutations 헤더). 그래서 무엇이 사라지는지 본문을
 * 그대로 보여 준다 — 비슷한 요청이 여럿일 수 있다.
 */
function DeleteImprovementRequestDialog({
  target,
  isSubmitting,
  errorMessage,
  onConfirm,
  onCancel,
}: {
  target: ImprovementRequestListItem | null;
  isSubmitting: boolean;
  errorMessage: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const isOpen = target !== null;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (isOpen && !dialog.open) {
      dialog.showModal();
    } else if (!isOpen && dialog.open) {
      dialog.close();
    }
  }, [isOpen]);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="improvement-request-delete-title"
      onCancel={(event) => {
        // Esc 로 닫는 길을 브라우저에 맡기지 않는다 — 부모의 열림 상태와
        // 엇갈리면 다음에 열 때 showModal 이 불리지 않는다.
        event.preventDefault();
        if (isSubmitting) return;
        onCancel();
      }}
      className="w-full max-w-md rounded-lg border border-zinc-200 bg-white p-4 text-zinc-900 backdrop:bg-black/40 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50"
    >
      <h2 id="improvement-request-delete-title" className="text-sm font-semibold">
        이 개선 요청을 지우시겠습니까?
      </h2>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        휴지통이 없어 되돌릴 수 없습니다. 잘못 지웠다면 다시 적어야 합니다.
      </p>
      {target ? (
        <p className="mt-2 max-h-40 overflow-y-auto rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1.5 text-xs break-words whitespace-pre-wrap text-zinc-700 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300">
          {target.body}
        </p>
      ) : null}

      {errorMessage ? (
        <p
          role="alert"
          className="mt-3 rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-400"
        >
          {errorMessage}
        </p>
      ) : null}

      <div className="mt-4 flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={isSubmitting}
          className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          취소
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={isSubmitting}
          aria-busy={isSubmitting}
          className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isSubmitting ? "지우는 중..." : "지우기"}
        </button>
      </div>
    </dialog>
  );
}
