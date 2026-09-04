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
 * 작업 비용 — 화면
 * ============================================================================
 * 견적서의 **작업비**가 여기서 나온다. 작업비는 부품이 아니라 **수리 작업**마다
 * 붙고, 값은 `공수시간 × 시간당 단가`다(2026-08-31 사용자 정정).
 *
 * ── 탭이 두 겹이다 ──────────────────────────────────────────────────────
 * 바깥이 **무엇의 비용인가**(수리 작업 · 통전 작업), 안쪽이 **어느 장비인가**다.
 * 두 탭이 같은 `KindEditor` 하나를 나눠 쓰고, 바깥 탭은 그 안에서 어느 몸통을
 * 그릴지만 고른다.
 *
 * 🔴 그래서 **저장은 어느 탭에서 눌러도 그 장비 한 벌 전부**가 간다 — 시간당
 * 작업비·기본 작업비·수리 작업 목록·통전작업 시간·통전 작업 목록이 한 상태에 함께
 * 산다. 통전 탭에서 통전 시간만 보내면 나머지가 지워진다(mutations/repair-labor.ts
 * 가 종류 하나를 통째로 바꾸기 때문이다).
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

/** 바깥 탭 — 무엇의 비용을 보고 있는가. */
type LaborSection = "tasks" | "powerTest";

const SECTION_TABS: readonly { key: LaborSection; label: string }[] = [
  { key: "tasks", label: "수리 작업 비용" },
  { key: "powerTest", label: "통전 작업 비용" },
];

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

/**
 * 통전 작업 한 줄. **공수시간 칸이 없다** — 통전작업의 금액은 목록이 아니라 위의
 * `통전작업 공수시간` 하나가 정한다(schema/repair-labor.ts 의 power_test_tasks).
 * 줄마다 시간을 두면 두 숫자가 같은 금액을 주장하게 되고, 사용자가 그 배분은
 * 필요 없다고 정했다(2026-09-04).
 */
type PowerTestTaskRow = {
  key: string;
  /** 이미 저장된 줄이면 그 id, 새로 더한 줄이면 null. */
  id: string | null;
  taskName: string;
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
  const [activeSection, setActiveSection] = useState<LaborSection>("tasks");
  const [message, setMessage] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-4">
      {/* 바깥 탭. 무엇의 비용을 보는가 — 안쪽 장비 종류 탭과 축이 다르다. */}
      <div className="flex flex-wrap gap-1 border-b border-zinc-200 dark:border-zinc-800">
        {SECTION_TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => {
              setActiveSection(tab.key);
              setMessage(null);
            }}
            className={`-mb-px rounded-t-md border-b-2 px-3 py-1.5 text-sm ${
              activeSection === tab.key
                ? "border-zinc-900 font-medium text-zinc-900 dark:border-zinc-100 dark:text-zinc-50"
                : "border-transparent text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div>
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
          {activeSection === "tasks" ? "수리 작업 비용" : "통전 작업 비용"}
        </h2>
        {activeSection === "tasks" ? (
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            견적서의 <b>작업비</b>가 여기서 나옵니다. 작업 하나의 비용은{" "}
            <b>공수시간 × 시간당 작업비</b>이고, 견적서에서는 여기에 <b>기본 작업비</b>가
            더해집니다.
          </p>
        ) : (
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            <b>기본 작업비 안에 통전작업이 이미 들어 있습니다.</b> 여기 적는 공수시간이 그
            몫이고, 비용은 <b>공수시간 × 시간당 작업비</b>입니다. 아직 모르는 장비는 비워 두세요
            — 0시간과 다릅니다. 아래 <b>통전 작업 목록</b>은 그 시간 안에서 무슨 일을 하는지
            적는 곳이라 줄마다의 시간이 없습니다.
          </p>
        )}
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
            {/* 보고 있는 탭의 목록 건수다. 예전에는 수리 탭에서만 보였다 — 통전
                탭에는 셀 목록이 없어서, 수리 건수를 그대로 두면 그 숫자가
                통전작업을 세는 것처럼 읽혔기 때문이다. 이제 탭마다 자기 목록이
                있으니 각자의 건수를 센다. */}
            <span className="ml-1.5 text-xs font-normal text-zinc-400">
              {activeSection === "tasks" ? kind.tasks.length : kind.powerTestTasks.length}
            </span>
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
          //
          // 바깥 탭은 key 에 넣지 않는다 — 넣으면 수리↔통전을 오갈 때마다 같은
          // 장비의 편집 상태가 버려지고, 저장이 한 벌 전부를 보내는 구조라 방금
          // 고치던 값이 되돌려진 채로 저장된다.
          <KindEditor
            key={kind.equipmentKind}
            kind={kind}
            section={activeSection}
            canEdit={canEdit}
            onMessage={setMessage}
          />
        ))}
    </div>
  );
}

function KindEditor({
  kind,
  section,
  canEdit,
  onMessage,
}: {
  kind: RepairLaborKindRow;
  /** 바깥 탭이 고른 몸통. 상태는 둘이 함께 쓴다(파일 머리말). */
  section: LaborSection;
  canEdit: boolean;
  onMessage: (message: string | null) => void;
}) {
  const router = useRouter();
  const [hourlyRate, setHourlyRate] = useState(toFieldValue(kind.hourlyRate));
  const [baseCost, setBaseCost] = useState(toFieldValue(kind.baseCost));
  // 비어 있음이 "아직 정하지 않음"이다 — `0` 으로 채우지 않는다(T/C).
  const [powerTestHours, setPowerTestHours] = useState(
    kind.powerTestHours === null ? "" : String(kind.powerTestHours)
  );
  const [tasks, setTasks] = useState<TaskRow[]>(
    kind.tasks.map((task) => ({
      key: generateClientUuid(),
      id: task.id,
      taskName: task.taskName,
      hours: String(task.hours),
      isOverhaul: task.isOverhaul,
    }))
  );
  const [powerTestTasks, setPowerTestTasks] = useState<PowerTestTaskRow[]>(
    kind.powerTestTasks.map((task) => ({
      key: generateClientUuid(),
      id: task.id,
      taskName: task.taskName,
    }))
  );
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const rate = Number(hourlyRate.replace(/,/g, ""));
  // 통전 탭이 금액 대신 안내를 보일지 가르는 값. 단가가 0이면 costOf 는 ₩0 을
  // 내놓는데, 그건 "통전작업이 무상"이 아니라 "아직 셈이 서지 않는다"는 뜻이다.
  const rateIsUsable = Number.isFinite(rate) && rate > 0;
  const totalHours = tasks.reduce((sum, task) => sum + (Number(task.hours) || 0), 0);

  function costOf(hours: string): string {
    const value = Number(hours) * rate;
    return Number.isFinite(value) ? `₩${AMOUNT_FORMAT.format(Math.round(value))}` : "—";
  }

  /**
   * 통전 작업 줄의 차례를 한 칸 옮긴다.
   *
   * 화면에 늘어놓은 순서가 그대로 `displayOrder` 가 된다 — 저장하는 쪽이 1부터
   * 다시 매긴다(mutations/repair-labor.ts). 통전작업은 순서대로 하는 일이라
   * 차례가 뜻을 갖는다. 단추 모양은 WorkflowDraftEditor 의 ↑/↓ 를 그대로 쓴다 —
   * 이 저장소에 이미 있는 방식이다.
   */
  function movePowerTestTask(index: number, delta: number) {
    setPowerTestTasks((prev) => {
      const next = index + delta;
      if (next < 0 || next >= prev.length) return prev;
      const rows = [...prev];
      [rows[index], rows[next]] = [rows[next], rows[index]];
      return rows;
    });
  }

  async function save() {
    if (busy) return;
    setBusy(true);
    setFieldErrors({});
    onMessage(null);
    const result = await saveRepairLaborAction({
      fields: {
        // 🔴 어느 탭에서 눌렀든 **한 벌 전부**를 보낸다. 저장은 장비 종류 하나를
        // 통째로 바꾸므로, 통전 탭에서 통전 시간만 보내면 나머지가 지워진다.
        equipmentKind: kind.equipmentKind,
        hourlyRate,
        baseCost,
        powerTestHours,
        tasks: tasks
          .filter((task) => task.taskName.trim() !== "")
          .map((task) => ({
            id: task.id,
            taskName: task.taskName,
            hours: Number(task.hours),
            isOverhaul: task.isOverhaul,
          })),
        // 통전 목록도 한 벌에 함께 간다. 건명만 보낸다 — 이 목록에는 시간이 없다.
        // 빈 줄은 작업 목록과 같이 걸러 낸다(막 더하고 아직 안 적은 줄이다).
        powerTestTasks: powerTestTasks
          .filter((task) => task.taskName.trim() !== "")
          .map((task) => ({ id: task.id, taskName: task.taskName })),
      },
    });
    setBusy(false);
    if (!result.ok) {
      if ("fieldErrors" in result && result.fieldErrors) setFieldErrors(result.fieldErrors);
      onMessage(result.message);
      return;
    }
    // 무엇을 저장했다고 말할지는 **보고 있던 탭**을 따른다. 실제로 간 것은 한 벌
    // 전부지만, 통전 탭에서 "작업 20건을 저장했습니다"가 뜨면 사람은 자기가 건드린
    // 적 없는 목록이 바뀐 줄 안다.
    //
    // 🔴 통전 탭은 `result.changedCount` 를 쓰지 않는다 — 그 숫자는 **수리 작업
    // 건수**다(mutations/repair-labor.ts). 통전 탭에 그걸 붙이면 사람이 보고 있는
    // 통전 목록의 줄 수와 어긋난 숫자가 뜬다. 자기 목록은 자기가 센다.
    const savedPowerTestCount = powerTestTasks.filter(
      (task) => task.taskName.trim() !== ""
    ).length;
    onMessage(
      section === "tasks"
        ? `${workflowKindLabels[kind.equipmentKind]} 작업 ${result.changedCount}건을 저장했습니다.`
        : `${workflowKindLabels[kind.equipmentKind]} 통전작업 공수시간 ${
            powerTestHours.trim() === "" ? "'정하지 않음'" : `${powerTestHours.trim()}시간`
          } · 통전 작업 ${savedPowerTestCount}건을 저장했습니다.`
    );
    router.refresh();
  }

  const disabled = busy || !canEdit;

  /**
   * 수리 작업 비용 탭의 몸통. **지금까지의 화면 그대로다.**
   *
   * 몸통을 값으로 뽑아 둔 것은 들여쓰기를 흔들지 않기 위해서다 — 통전 탭을 얹느라
   * 이 안을 한 겹 더 감쌌다면 고친 것 없는 줄까지 전부 변경으로 잡히고, 그러면
   * 나중에 "이 탭에서 무엇이 달라졌나"를 diff 로 답할 수 없다.
   */
  const tasksBody = (
    <>
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
    </>
  );

  /**
   * 통전 작업 비용 탭의 몸통. **금액 한 벌 + 작업 목록**이다.
   *
   * 시간당 작업비와 기본 작업비는 수리 작업 탭에서 정한다 — 여기 한 번 더 두면
   * 같은 값을 고치는 자리가 둘이 되고, 사람은 어느 쪽이 진짜인지 묻게 된다.
   *
   * ── 🔴 위의 공수시간과 아래의 목록은 겹치는 숫자가 아니다 ──────────────
   * 위 칸은 **얼마인가**(금액의 근거)이고, 아래 목록은 **무엇을 하는가**(문서에
   * 적히는 글)다. 그래서 목록에는 시간 칸이 없다 — 줄마다 시간을 두면 "줄들의 합"과
   * "위 칸"이라는 두 숫자가 같은 금액을 주장하게 되고, 어긋나는 날 어느 쪽이
   * 참인지 답할 수 없다. 사용자가 줄별 시간 배분은 필요 없다고 정했다(2026-09-04).
   */
  const powerTestBody = (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className={editLabelClass}>통전작업 공수시간</span>
          <input
            value={powerTestHours}
            onChange={(e) => setPowerTestHours(e.target.value)}
            inputMode="numeric"
            placeholder="비워 두면 정하지 않음"
            aria-label="통전작업 공수시간"
            className={editInputClass}
            disabled={disabled}
          />
          {/* 🔴 "정하지 않음"과 "0"이 눈으로 갈라져야 한다 — 기본 작업비 칸과 같은
              이유다. 다만 여기서는 0 자체를 받지 않는다: 0시간짜리 통전작업이라는
              것은 없고, 그 상태를 뜻하는 말이 바로 빈 칸이다. */}
          <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
            {powerTestHours.trim() === ""
              ? "아직 정하지 않음 — 기본 작업비에서 덜어 낼 몫을 셈할 수 없습니다."
              : "기본 작업비 안에 이미 들어 있는 통전작업의 몫입니다."}
          </span>
          {fieldErrors.powerTestHours && (
            <p className={editErrorClass}>{fieldErrors.powerTestHours}</p>
          )}
        </label>
        <div className="flex flex-col gap-1">
          <span className={editLabelClass}>통전작업 비용 (공수시간 × 시간당 작업비)</span>
          {/* 계산해서 보여 줄 뿐 저장하지 않는다(파일 머리말). 작업 목록의 비용 칸과
              같은 costOf 를 쓴다 — 두 곳이 갈리면 같은 시간이 다른 금액으로 보인다. */}
          <span className="pt-2 text-sm tabular-nums text-zinc-600 dark:text-zinc-300">
            {powerTestHours.trim() === ""
              ? // 🔴 0원으로 보이면 안 된다 — "무상"과 "모른다"는 다른 말이다.
                "아직 정하지 않았습니다"
              : rateIsUsable
                ? `${powerTestHours.trim()}시간 → ${costOf(powerTestHours)}`
                : `${powerTestHours.trim()}시간 → —`}
          </span>
          {!rateIsUsable ? (
            <span className="text-[11px] text-amber-700 dark:text-amber-400">
              시간당 작업비가 아직 없어 금액을 셀 수 없습니다 — `수리 작업 비용` 탭에서 먼저
              정해 주세요.
            </span>
          ) : (
            <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
              시간당 {costOf("1")} 기준으로 셈합니다.
            </span>
          )}
        </div>
      </div>

      {/* ── 통전 작업 목록 ─────────────────────────────────────────────────
          수리 작업 탭의 목록과 **같은 조작법**이다: `+ 작업 추가`로 줄을 더하고
          `×` 로 지운다. 다른 점은 시간 칸이 없다는 것과, 차례를 ↑/↓ 로 옮길 수
          있다는 것뿐이다 — 통전작업은 순서대로 하는 일이라 차례가 뜻을 갖는다. */}
      <div className="mt-4 flex items-baseline justify-between">
        <span className={editLabelClass}>통전 작업 목록 ({powerTestTasks.length}건)</span>
        {/* canEdit 이 아니면 단추 자체를 그리지 않는다 — 볼 권한만 있는 사람에게
            누를 수 없는 단추를 보이면 "왜 안 눌리지"를 묻게 된다. */}
        {canEdit && (
          <button
            type="button"
            onClick={() =>
              setPowerTestTasks((prev) => [
                ...prev,
                { key: generateClientUuid(), id: null, taskName: "" },
              ])
            }
            disabled={disabled}
            className="rounded-md border border-zinc-300 px-2 py-1 text-xs disabled:opacity-50 dark:border-zinc-700"
          >
            + 작업 추가
          </button>
        )}
      </div>
      {fieldErrors.powerTestTasks && <p className={editErrorClass}>{fieldErrors.powerTestTasks}</p>}

      <div className="mt-2 flex flex-col gap-2">
        {powerTestTasks.length > 0 && (
          <div className="grid grid-cols-[1fr_auto] gap-2 text-[11px] text-zinc-500 dark:text-zinc-400">
            <span>건명</span>
            <span aria-hidden />
          </div>
        )}
        {powerTestTasks.map((task, index) => (
          <div key={task.key} className="grid grid-cols-[1fr_auto] items-start gap-2">
            <div>
              <input
                value={task.taskName}
                onChange={(e) =>
                  setPowerTestTasks((prev) =>
                    prev.map((row) =>
                      row.key === task.key ? { ...row, taskName: e.target.value } : row
                    )
                  )
                }
                placeholder={`${index + 1}번째 통전 작업 건명`}
                aria-label={`${index + 1}번째 통전 작업 건명`}
                className={editInputClass}
                disabled={disabled}
              />
              {fieldErrors[`powerTestTasks.${index}.taskName`] && (
                <p className={editErrorClass}>{fieldErrors[`powerTestTasks.${index}.taskName`]}</p>
              )}
            </div>
            {canEdit && (
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => movePowerTestTask(index, -1)}
                  disabled={disabled || index === 0}
                  aria-label={`${index + 1}번째 통전 작업 위로`}
                  className="rounded-md border border-zinc-300 px-2 py-1.5 text-sm disabled:opacity-30 dark:border-zinc-700"
                >
                  ↑
                </button>
                <button
                  type="button"
                  onClick={() => movePowerTestTask(index, 1)}
                  disabled={disabled || index === powerTestTasks.length - 1}
                  aria-label={`${index + 1}번째 통전 작업 아래로`}
                  className="rounded-md border border-zinc-300 px-2 py-1.5 text-sm disabled:opacity-30 dark:border-zinc-700"
                >
                  ↓
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setPowerTestTasks((prev) => prev.filter((row) => row.key !== task.key))
                  }
                  disabled={disabled}
                  aria-label={`${index + 1}번째 통전 작업 지우기`}
                  className="rounded-md border border-zinc-300 px-2 py-1.5 text-sm text-zinc-500 disabled:opacity-50 dark:border-zinc-700"
                >
                  ×
                </button>
              </div>
            )}
          </div>
        ))}
        {powerTestTasks.length === 0 && (
          // 🔴 수리 작업 목록과 달리 **경고 색이 아니다.** 통전 목록이 비어 있는
          // 것은 정상이다 — T/C 는 아직 하나도 없고, 없어도 견적서 금액은 위 칸이
          // 그대로 정한다. 빈 목록을 고장처럼 보이게 하면 없는 문제를 만든다.
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            이 장비의 통전 작업 목록이 아직 없습니다 — `+ 작업 추가`로 건명을 넣어 주세요.
            비어 있어도 통전작업 비용은 위 공수시간이 그대로 정합니다.
          </p>
        )}
      </div>
    </>
  );

  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      {section === "tasks" ? tasksBody : powerTestBody}

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
