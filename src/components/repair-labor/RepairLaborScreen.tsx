"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  editErrorClass,
  editInputClass,
  editLabelClass,
} from "@/components/repair-cases/detail/edit/EditSectionActions";
import { generateClientUuid } from "@/lib/client-uuid";
import { workflowKindLabels, type WorkflowKind } from "@/lib/domain/workflow-kind";
import { saveRepairLaborAction } from "@/lib/server/actions/repair-labor";
import type { RepairLaborKindRow } from "@/lib/db/queries/repair-labor";

/**
 * ============================================================================
 * 수리 작업 비용 — 화면
 * ============================================================================
 * 견적서의 **작업비**가 여기서 나온다. 작업비는 부품이 아니라 **수리 작업**마다
 * 붙고, 값은 `공수시간 × 시간당 단가`다(2026-08-31 사용자 정정).
 *
 * ── 장비 종류를 탭으로 가른다 ───────────────────────────────────────────
 * 목록이 종류마다 통째로 다르다(제너레이터 20건 · 매쳐 16건). 한 화면에 다 펴
 * 놓으면 스무 줄 넘는 표가 셋이 되어 무엇을 보는지 흐려진다.
 *
 * ── 비용은 보여 주되 저장하지 않는다 ────────────────────────────────────
 * 줄마다의 비용은 `공수시간 × 시간당 단가`로 그 자리에서 셈해 보여 준다. 저장해
 * 두면 단가가 오르는 날 예전 금액이 그대로 남아 화면이 거짓말을 한다 — 이
 * 저장소가 내자 정리에서 한 번 겪고 규칙으로 굳힌 자리다.
 * ============================================================================
 */

const AMOUNT_FORMAT = new Intl.NumberFormat("ko-KR");

type TaskRow = {
  key: string;
  /** 이미 저장된 줄이면 그 id, 새로 더한 줄이면 null. */
  id: string | null;
  taskName: string;
  hours: string;
  /**
   * 오버홀 작업인가. 견적서에서 종류를 O/H 로 고르면 **이 표시가 된 줄이 자동으로
   * 체크된다.** 이름으로 맞히지 않는 이유는 schema/repair-labor.ts 에 있다 —
   * 제너레이터는 `OH`, 매쳐는 `O/H(스위칭전원,휴즈 교환) 작업` 이라 글자가 다르다.
   */
  isOverhaul: boolean;
};

/** numeric 이 달고 오는 `"100000.00"` 을 사람이 친 모양으로 되돌린다. */
function toFieldValue(amount: string | null): string {
  if (amount === null) return "";
  const parsed = Number(amount);
  return Number.isFinite(parsed) ? String(parsed) : "";
}

export default function RepairLaborScreen({
  kinds,
  canEdit,
}: {
  kinds: RepairLaborKindRow[];
  canEdit: boolean;
}) {
  const [activeKind, setActiveKind] = useState<WorkflowKind>(kinds[0]?.equipmentKind ?? "GENERATOR");
  const [message, setMessage] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">수리 작업 비용</h2>
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          견적서의 <b>작업비</b>가 여기서 나옵니다. 작업 하나의 비용은{" "}
          <b>공수시간 × 시간당 작업비</b>이고, 견적서에서는 여기에 <b>기본 작업비</b>가 더해집니다.
        </p>
      </div>

      {/* 장비 종류 탭. 목록이 종류마다 통째로 달라서 한 번에 하나만 본다. */}
      <div className="flex flex-wrap gap-1 border-b border-zinc-200 dark:border-zinc-800">
        {kinds.map((kind) => (
          <button
            key={kind.equipmentKind}
            type="button"
            onClick={() => {
              setActiveKind(kind.equipmentKind);
              setMessage(null);
            }}
            className={`-mb-px rounded-t-md border-b-2 px-3 py-1.5 text-sm ${
              activeKind === kind.equipmentKind
                ? "border-zinc-900 font-medium text-zinc-900 dark:border-zinc-100 dark:text-zinc-50"
                : "border-transparent text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
            }`}
          >
            {workflowKindLabels[kind.equipmentKind]}
            <span className="ml-1.5 text-xs font-normal text-zinc-400">{kind.tasks.length}</span>
          </button>
        ))}
      </div>

      {message && (
        <p className="rounded-md bg-zinc-100 px-3 py-2 text-sm text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">
          {message}
        </p>
      )}

      {kinds
        .filter((kind) => kind.equipmentKind === activeKind)
        .map((kind) => (
          // key 에 종류를 넣어 **탭을 바꾸면 편집 상태가 새로 시작하게** 한다.
          // 안 그러면 제너레이터에서 고치던 값이 매쳐 탭에 그대로 남는다.
          <KindEditor key={kind.equipmentKind} kind={kind} canEdit={canEdit} onMessage={setMessage} />
        ))}
    </div>
  );
}

function KindEditor({
  kind,
  canEdit,
  onMessage,
}: {
  kind: RepairLaborKindRow;
  canEdit: boolean;
  onMessage: (message: string | null) => void;
}) {
  const router = useRouter();
  const [hourlyRate, setHourlyRate] = useState(toFieldValue(kind.hourlyRate));
  const [baseCost, setBaseCost] = useState(toFieldValue(kind.baseCost));
  const [tasks, setTasks] = useState<TaskRow[]>(
    kind.tasks.map((task) => ({
      key: generateClientUuid(),
      id: task.id,
      taskName: task.taskName,
      hours: String(task.hours),
      isOverhaul: task.isOverhaul,
    }))
  );
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const rate = Number(hourlyRate.replace(/,/g, ""));
  const totalHours = tasks.reduce((sum, task) => sum + (Number(task.hours) || 0), 0);

  function costOf(hours: string): string {
    const value = Number(hours) * rate;
    return Number.isFinite(value) ? `₩${AMOUNT_FORMAT.format(Math.round(value))}` : "—";
  }

  async function save() {
    if (busy) return;
    setBusy(true);
    setFieldErrors({});
    onMessage(null);
    const result = await saveRepairLaborAction({
      fields: {
        equipmentKind: kind.equipmentKind,
        hourlyRate,
        baseCost,
        tasks: tasks
          .filter((task) => task.taskName.trim() !== "")
          .map((task) => ({
            id: task.id,
            taskName: task.taskName,
            hours: Number(task.hours),
            isOverhaul: task.isOverhaul,
          })),
      },
    });
    setBusy(false);
    if (!result.ok) {
      if ("fieldErrors" in result && result.fieldErrors) setFieldErrors(result.fieldErrors);
      onMessage(result.message);
      return;
    }
    onMessage(`${workflowKindLabels[kind.equipmentKind]} 작업 ${result.changedCount}건을 저장했습니다.`);
    router.refresh();
  }

  const disabled = busy || !canEdit;

  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className={editLabelClass}>시간당 작업비 (원)</span>
          <input
            value={hourlyRate}
            onChange={(e) => setHourlyRate(e.target.value)}
            inputMode="numeric"
            className={editInputClass}
            disabled={disabled}
          />
          {fieldErrors.hourlyRate && <p className={editErrorClass}>{fieldErrors.hourlyRate}</p>}
        </label>
        <label className="flex flex-col gap-1">
          <span className={editLabelClass}>기본 작업비 (원)</span>
          <input
            value={baseCost}
            onChange={(e) => setBaseCost(e.target.value)}
            inputMode="numeric"
            placeholder="비워 두면 정하지 않음"
            className={editInputClass}
            disabled={disabled}
          />
          {/* 🔴 "정하지 않음"과 "0"이 눈으로 갈라져야 한다. 둘 다 칸이 비슷해
              보이지만 견적서에서 하는 일이 다르다. */}
          <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
            {baseCost.trim() === ""
              ? "아직 정하지 않음 — 견적서 작업비에 더해지지 않습니다."
              : Number(baseCost.replace(/,/g, "")) === 0
                ? "0원 — 기본 작업비 없이 고른 작업만 셉니다."
                : "견적서에서 고른 작업의 합에 이 값이 더해집니다."}
          </span>
          {fieldErrors.baseCost && <p className={editErrorClass}>{fieldErrors.baseCost}</p>}
        </label>
      </div>

      <div className="mt-4 flex items-baseline justify-between">
        <span className={editLabelClass}>
          작업 목록 ({tasks.length}건 · 합계 {totalHours}시간)
        </span>
        <button
          type="button"
          onClick={() =>
            setTasks((prev) => [
              ...prev,
              { key: generateClientUuid(), id: null, taskName: "", hours: "1", isOverhaul: false },
            ])
          }
          disabled={disabled}
          className="rounded-md border border-zinc-300 px-2 py-1 text-xs disabled:opacity-50 dark:border-zinc-700"
        >
          + 작업 추가
        </button>
      </div>
      {fieldErrors.tasks && <p className={editErrorClass}>{fieldErrors.tasks}</p>}

      <div className="mt-2 flex flex-col gap-2">
        {tasks.length > 0 && (
          <div className="grid grid-cols-[1fr_5rem_7rem_3rem_2rem] gap-2 text-[11px] text-zinc-500 dark:text-zinc-400">
            <span>건명</span>
            <span>공수시간</span>
            <span>비용</span>
            {/* 견적서에서 종류를 O/H 로 고르면 이 표시가 된 줄이 자동으로 체크된다. */}
            <span title="견적서 종류가 O/H 면 자동으로 체크되는 줄">O/H</span>
            <span aria-hidden />
          </div>
        )}
        {tasks.map((task, index) => (
          <div key={task.key} className="grid grid-cols-[1fr_5rem_7rem_3rem_2rem] items-start gap-2">
            <div>
              <input
                value={task.taskName}
                onChange={(e) =>
                  setTasks((prev) =>
                    prev.map((row) => (row.key === task.key ? { ...row, taskName: e.target.value } : row))
                  )
                }
                placeholder={`${index + 1}번째 작업 건명`}
                aria-label={`${index + 1}번째 작업 건명`}
                className={editInputClass}
                disabled={disabled}
              />
              {fieldErrors[`tasks.${index}.taskName`] && (
                <p className={editErrorClass}>{fieldErrors[`tasks.${index}.taskName`]}</p>
              )}
            </div>
            <div>
              <input
                value={task.hours}
                onChange={(e) =>
                  setTasks((prev) =>
                    prev.map((row) => (row.key === task.key ? { ...row, hours: e.target.value } : row))
                  )
                }
                inputMode="numeric"
                aria-label={`${index + 1}번째 작업 공수시간`}
                className={editInputClass}
                disabled={disabled}
              />
              {fieldErrors[`tasks.${index}.hours`] && (
                <p className={editErrorClass}>{fieldErrors[`tasks.${index}.hours`]}</p>
              )}
            </div>
            {/* 계산해서 보여 줄 뿐 저장하지 않는다(파일 머리말). */}
            <span className="pt-2 text-sm tabular-nums text-zinc-600 dark:text-zinc-300">
              {costOf(task.hours)}
            </span>
            <span className="pt-2">
              <input
                type="checkbox"
                checked={task.isOverhaul}
                onChange={(e) =>
                  setTasks((prev) =>
                    prev.map((row) =>
                      row.key === task.key ? { ...row, isOverhaul: e.target.checked } : row
                    )
                  )
                }
                disabled={disabled}
                aria-label={`${index + 1}번째 작업이 오버홀 작업인가`}
                className="h-4 w-4"
              />
            </span>
            <button
              type="button"
              onClick={() => setTasks((prev) => prev.filter((row) => row.key !== task.key))}
              disabled={disabled}
              aria-label={`${index + 1}번째 작업 지우기`}
              className="rounded-md border border-zinc-300 py-1.5 text-sm text-zinc-500 disabled:opacity-50 dark:border-zinc-700"
            >
              ×
            </button>
          </div>
        ))}
        {tasks.length === 0 && (
          <p className="text-xs text-amber-700 dark:text-amber-400">
            이 장비의 작업 목록이 아직 없습니다 — `+ 작업 추가`로 건명과 공수시간을 넣어 주세요.
          </p>
        )}
      </div>

      {canEdit && (
        <div className="mt-4 flex justify-end">
          <button
            type="button"
            onClick={() => void save()}
            disabled={busy}
            className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900"
          >
            {busy ? "저장 중…" : "저장"}
          </button>
        </div>
      )}
    </section>
  );
}
