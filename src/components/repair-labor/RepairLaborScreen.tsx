"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { showSavePopup } from "@/components/common/SavePopup";
import AmountInput from "@/components/common/AmountInput";
import {
  editErrorClass,
  editInputClass,
  editLabelClass,
} from "@/components/repair-cases/detail/edit/EditSectionActions";
import { describeBaseCost } from "./base-cost-display";
import { generateClientUuid } from "@/lib/client-uuid";
import { workflowKindLabels, type WorkflowKind } from "@/lib/domain/workflow-kind";
import { saveRepairLaborAction } from "@/lib/server/actions/repair-labor";
import {
  parseRepairLaborHours,
  REPAIR_LABOR_HOURS_FIELDS,
  REPAIR_LABOR_SCOPES,
  REPAIR_LABOR_TASKS_FIELDS,
  repairLaborScopeLabels,
  type RepairLaborScope,
} from "@/lib/validation/repair-task-input";
import type { RepairLaborKindRow } from "@/lib/db/queries/repair-labor";

/**
 * ============================================================================
 * 작업 비용 — 화면
 * ============================================================================
 * 견적서의 **작업비**가 여기서 나온다. 작업비는 부품이 아니라 **수리 작업**마다
 * 붙고, 값은 `공수시간 × 시간당 단가`다(2026-08-31 사용자 정정).
 *
 * ── 탭이 두 겹이다 ──────────────────────────────────────────────────────
 * 바깥이 **무엇의 비용인가**(수리 작업 · 조사 · 통전 · 서류), 안쪽이 **어느 장비인가**다.
 * 네 탭이 같은 `KindEditor` 하나를 나눠 쓰고, 바깥 탭은 그 안에서 어느 몸통을
 * 그릴지만 고른다.
 *
 * 🔴 조사 · 통전 · 서류 셋은 **같은 몸통 하나**(`scopeBody`)를 갈래만 달리해 그린다.
 * 같은 화면을 세 벌 복사하면 한 곳을 고칠 때 세 곳을 고쳐야 하고, 언젠가 한 벌만
 * 고쳐진다.
 *
 * 🔴 그래서 **저장은 어느 탭에서 눌러도 그 장비 한 벌 전부**가 간다 — 시간당
 * 작업비·세 갈래 공수시간·수리 작업 목록·세 갈래 작업 목록이 한 상태에 함께 산다.
 * 조사 탭에서 조사 것만 보내면 나머지가 지워진다(mutations/repair-labor.ts 가 종류
 * 하나를 갈래마다 통째로 바꾸기 때문이다).
 *
 * ── 장비 종류를 탭으로 가른다 ───────────────────────────────────────────
 * 목록이 종류마다 통째로 다르다(제너레이터 20건 · 매쳐 16건). 한 화면에 다 펴
 * 놓으면 스무 줄 넘는 표가 셋이 되어 무엇을 보는지 흐려진다.
 *
 * ── 비용은 보여 주되 저장하지 않는다 ────────────────────────────────────
 * 줄마다의 비용은 `공수시간 × 시간당 단가`로 그 자리에서 셈해 보여 준다. 저장해
 * 두면 단가가 오르는 날 예전 금액이 그대로 남아 화면이 거짓말을 한다 — 이
 * 저장소가 내자 정리에서 한 번 겪고 규칙으로 굳힌 자리다.
 *
 * ── 🔴 기본 작업비는 **읽기 전용**이다 (2026-09-16) ─────────────────────
 * 예전에는 사람이 적는 칸이었다. 이제 `조사 몫 + 통전 몫 + 서류 몫` 이라 적을 것이
 * 없다 — 세 탭의 공수시간을 고치면 금액이 따라 나온다. 셈은 견적서와 **같은 한
 * 곳**에서 온다(base-cost-display.ts → domain/quote-labor-cost.ts).
 *
 * 🔴 DB 의 `base_cost` 칸은 그대로 남아 있다. 화면에서 못 고칠 뿐이고, 저장도 그
 * 칸을 건드리지 않는다 — 넘어오기 전의 금액을 되짚을 유일한 근거다
 * (schema/repair-labor.ts · mutations/repair-labor.ts 의 그 주석).
 * ============================================================================
 */

const AMOUNT_FORMAT = new Intl.NumberFormat("ko-KR");

/** 바깥 탭 — 무엇의 비용을 보고 있는가. 갈래 셋은 `repair_labor_scope` 그대로다. */
type LaborSection = "tasks" | RepairLaborScope;

const SECTION_TABS: readonly { key: LaborSection; label: string }[] = [
  { key: "tasks", label: "수리 작업 비용" },
  ...REPAIR_LABOR_SCOPES.map((scope) => ({
    key: scope as LaborSection,
    label: `${repairLaborScopeLabels[scope]} 작업 비용`,
  })),
];

/** 그 탭이 갈래 탭인가. `tasks` 와 갈래 셋을 가르는 자리는 여기 하나다. */
function scopeOf(section: LaborSection): RepairLaborScope | null {
  return section === "tasks" ? null : section;
}

/**
 * 갈래 탭 머리말. 셋이 같은 모양이지만 **서류만 `0` 을 받는다**는 한 마디가 다르다
 * (schema/repair-labor.ts 의 document_hours — 「서류작업이 없는 장비」는 정하지 않은
 * 것이 아니라 정해진 답이다).
 */
const SCOPE_INTRO: Record<RepairLaborScope, string> = {
  INVESTIGATION: "아직 모르는 장비는 비워 두세요 — 0시간과 다릅니다.",
  POWER_TEST: "아직 모르는 장비는 비워 두세요 — 0시간과 다릅니다.",
  DOCUMENT:
    "서류작업이 없는 장비는 0 을 적고, 아직 모르는 장비는 비워 두세요 — 0시간과 빈 칸은 다릅니다.",
};

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
 * 갈래 목록의 한 줄. **공수시간 칸이 없다** — 갈래의 금액은 목록이 아니라 위의
 * `공수시간` 하나가 정한다(schema/repair-labor.ts 의 power_test_tasks). 줄마다
 * 시간을 두면 두 숫자가 같은 금액을 주장하게 되고, 사용자가 그 배분은 필요 없다고
 * 정했다(2026-09-04, 2026-09-16 에 조사·서류도 같은 모양으로).
 */
type ScopeTaskRow = {
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
  const activeScope = scopeOf(activeSection);

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
          {SECTION_TABS.find((tab) => tab.key === activeSection)?.label}
        </h2>
        {activeScope === null ? (
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            견적서의 <b>작업비</b>가 여기서 나옵니다. 작업 하나의 비용은{" "}
            <b>공수시간 × 시간당 작업비</b>이고, 견적서에서는 여기에 <b>기본 작업비</b>가
            더해집니다.
          </p>
        ) : (
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            <b>기본 작업비 안에 {repairLaborScopeLabels[activeScope]}작업이 이미 들어 있습니다.</b>{" "}
            여기 적는 공수시간이 그 몫이고, 비용은 <b>공수시간 × 시간당 작업비</b>입니다.{" "}
            {SCOPE_INTRO[activeScope]} 아래 <b>{repairLaborScopeLabels[activeScope]} 작업 목록</b>은
            그 시간 안에서 무슨 일을 하는지 적는 곳이라 줄마다의 시간이 없습니다.
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
                있으니 각자의 건수를 센다. 🔴 갈래 셋도 **제 갈래의 목록**을 센다 —
                한 표(power_test_tasks)에 셋이 같이 살아서 안 가르면 셋 다 같은
                숫자가 뜬다. */}
            <span className="ml-1.5 text-xs font-normal text-zinc-400">
              {activeScope === null ? kind.tasks.length : kind.scopeTasks[activeScope].length}
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
          // 바깥 탭은 key 에 넣지 않는다 — 넣으면 탭을 오갈 때마다 같은 장비의
          // 편집 상태가 버려지고, 저장이 한 벌 전부를 보내는 구조라 방금 고치던
          // 값이 되돌려진 채로 저장된다. 🔴 갈래가 셋으로 늘어 더 중요해졌다:
          // 조사 탭에서 줄을 더하고 통전 탭으로 갔다가 저장하면, 편집 상태가
          // 버려졌을 때 **조사 목록이 저장 전 상태로 되돌아간 채로** 실려 간다.
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
  /** 바깥 탭이 고른 몸통. 상태는 넷이 함께 쓴다(파일 머리말). */
  section: LaborSection;
  canEdit: boolean;
  onMessage: (message: string | null) => void;
}) {
  const router = useRouter();
  const [hourlyRate, setHourlyRate] = useState(toFieldValue(kind.hourlyRate));
  // 비어 있음이 "아직 정하지 않음"이다 — `0` 으로 채우지 않는다.
  // 🔴 서류만 `0` 이 실제 값이다(「서류작업이 없는 장비」) — 그래서 빈 칸과 "0" 이
  // 눈으로도 값으로도 갈려야 한다(validation/repair-task-input.ts 의 그 잣대).
  const [scopeHours, setScopeHours] = useState<Record<RepairLaborScope, string>>({
    INVESTIGATION: kind.investigationHours === null ? "" : String(kind.investigationHours),
    POWER_TEST: kind.powerTestHours === null ? "" : String(kind.powerTestHours),
    DOCUMENT: kind.documentHours === null ? "" : String(kind.documentHours),
  });
  const [tasks, setTasks] = useState<TaskRow[]>(
    kind.tasks.map((task) => ({
      key: generateClientUuid(),
      id: task.id,
      taskName: task.taskName,
      hours: String(task.hours),
      isOverhaul: task.isOverhaul,
    }))
  );
  // 🔴 세 목록이 **한 상태에 함께** 산다. 저장이 셋을 함께 실어야 하므로, 보고 있지
  // 않은 갈래의 목록도 언제나 손에 쥐고 있어야 한다(파일 머리말).
  const [scopeTasks, setScopeTasks] = useState<Record<RepairLaborScope, ScopeTaskRow[]>>(() => {
    const initial = {} as Record<RepairLaborScope, ScopeTaskRow[]>;
    for (const scope of REPAIR_LABOR_SCOPES) {
      initial[scope] = kind.scopeTasks[scope].map((task) => ({
        key: generateClientUuid(),
        id: task.id,
        taskName: task.taskName,
      }));
    }
    return initial;
  });
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const rate = Number(hourlyRate.replace(/,/g, ""));
  // 단가가 0이면 costOf 는 ₩0 을 내놓는데, 그건 "무상"이 아니라 "아직 셈이 서지
  // 않는다"는 뜻이다. 갈래 탭이 금액 대신 안내를 보일지 가르는 값.
  const rateIsUsable = Number.isFinite(rate) && rate > 0;
  const totalHours = tasks.reduce((sum, task) => sum + (Number(task.hours) || 0), 0);

  /**
   * 🔴 공수시간 칸을 **화면에서 먼저** 본다 — 서버와 **같은 함수**로.
   *
   * 조사에 0, 서류에 음수 같은 값은 DB CHECK 가 막지만, 거기까지 가면 사람은
   * "일시적으로 처리할 수 없습니다"를 듣고 되지 않는 일을 다시 누른다. 잣대를 여기
   * 따로 적지 않는 것도 같은 이유다 — 두 잣대가 갈리면 화면에서 통과한 값이
   * 서버에서 터진다(validation/repair-task-input.ts 의 parseRepairLaborHours).
   */
  const hoursErrors = {} as Record<RepairLaborScope, string | null>;
  const hoursValues = {} as Record<RepairLaborScope, number | null>;
  for (const scope of REPAIR_LABOR_SCOPES) {
    const parsed = parseRepairLaborHours(scope, scopeHours[scope]);
    hoursErrors[scope] = parsed.ok ? null : parsed.message;
    hoursValues[scope] = parsed.ok ? parsed.value : null;
  }

  /**
   * 기본 작업비 = 조사 몫 + 통전 몫 + 서류 몫. **셈은 견적서와 같은 한 곳에서 온다**
   * (base-cost-display.ts → domain/quote-labor-cost.ts). 사람이 칸을 고치는 대로
   * 따라 움직이도록 저장된 값이 아니라 **지금 화면의 값**을 넘긴다.
   */
  const baseCost = describeBaseCost({
    hourlyRate: hourlyRate.replace(/,/g, ""),
    investigationHours: hoursValues.INVESTIGATION,
    powerTestHours: hoursValues.POWER_TEST,
    documentHours: hoursValues.DOCUMENT,
  });

  function costOf(hours: string): string {
    const value = Number(hours) * rate;
    return Number.isFinite(value) ? `₩${AMOUNT_FORMAT.format(Math.round(value))}` : "—";
  }

  function updateScopeTasks(
    scope: RepairLaborScope,
    update: (rows: ScopeTaskRow[]) => ScopeTaskRow[]
  ) {
    setScopeTasks((prev) => ({ ...prev, [scope]: update(prev[scope]) }));
  }

  /**
   * 갈래 목록의 한 줄을 한 칸 옮긴다.
   *
   * 화면에 늘어놓은 순서가 그대로 `displayOrder` 가 된다 — 저장하는 쪽이 1부터
   * 다시 매긴다(mutations/repair-labor.ts). 순서대로 하는 일이라 차례가 뜻을
   * 갖는다. 단추 모양은 WorkflowDraftEditor 의 ↑/↓ 를 그대로 쓴다 — 이 저장소에
   * 이미 있는 방식이다.
   */
  function moveScopeTask(scope: RepairLaborScope, index: number, delta: number) {
    updateScopeTasks(scope, (prev) => {
      const next = index + delta;
      if (next < 0 || next >= prev.length) return prev;
      const rows = [...prev];
      [rows[index], rows[next]] = [rows[next], rows[index]];
      return rows;
    });
  }

  /** 빈 줄은 걸러 낸다 — 막 더하고 아직 안 적은 줄이다. */
  const filledScopeTasks = (scope: RepairLaborScope) =>
    scopeTasks[scope].filter((task) => task.taskName.trim() !== "");

  async function save() {
    if (busy) return;

    // 🔴 잘못된 공수시간은 **보내지 않는다.** 서버도 막고 DB CHECK 도 막지만, 거기서
    // 걸리면 사람이 듣는 말이 "칸을 고쳐 주세요"가 아니게 된다.
    const badHours = REPAIR_LABOR_SCOPES.filter((scope) => hoursErrors[scope] !== null);
    if (badHours.length > 0) {
      const errors: Record<string, string> = {};
      for (const scope of badHours) {
        errors[REPAIR_LABOR_HOURS_FIELDS[scope]] = hoursErrors[scope] as string;
      }
      setFieldErrors(errors);
      onMessage(
        `${badHours
          .map((scope) => `${repairLaborScopeLabels[scope]} 작업 비용`)
          .join(" · ")} 탭의 공수시간을 고쳐 주세요.`
      );
      return;
    }

    setBusy(true);
    setFieldErrors({});
    onMessage(null);
    const result = await saveRepairLaborAction({
      fields: {
        // 🔴 어느 탭에서 눌렀든 **한 벌 전부**를 보낸다. 저장은 장비 종류 하나를
        // 갈래마다 통째로 바꾸므로, 조사 탭에서 조사 것만 보내면 통전·서류 목록이
        // 지워진다. 세 목록과 세 시간이 여기 다 있어야 한다.
        //
        // 🔴 `baseCost` 는 보내지 않는다 — 화면에서 고칠 수 없는 값이고, 저장도 그
        // 칸을 건드리지 않는다(파일 머리말 · mutations/repair-labor.ts).
        equipmentKind: kind.equipmentKind,
        hourlyRate,
        investigationHours: scopeHours.INVESTIGATION,
        powerTestHours: scopeHours.POWER_TEST,
        documentHours: scopeHours.DOCUMENT,
        tasks: tasks
          .filter((task) => task.taskName.trim() !== "")
          .map((task) => ({
            id: task.id,
            taskName: task.taskName,
            hours: Number(task.hours),
            isOverhaul: task.isOverhaul,
          })),
        // 갈래 목록 셋도 한 벌에 함께 간다. 건명만 보낸다 — 이 목록들에는 시간이 없다.
        investigationTasks: filledScopeTasks("INVESTIGATION").map((task) => ({
          id: task.id,
          taskName: task.taskName,
        })),
        powerTestTasks: filledScopeTasks("POWER_TEST").map((task) => ({
          id: task.id,
          taskName: task.taskName,
        })),
        documentTasks: filledScopeTasks("DOCUMENT").map((task) => ({
          id: task.id,
          taskName: task.taskName,
        })),
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
    // 🔴 갈래 탭은 `result.changedCount` 를 쓰지 않는다 — 그 숫자는 **수리 작업
    // 건수**다(mutations/repair-labor.ts). 갈래 탭에 그걸 붙이면 사람이 보고 있는
    // 목록의 줄 수와 어긋난 숫자가 뜬다. 자기 목록은 자기가 센다.
    const scope = scopeOf(section);
    const savedMessage =
      scope === null
        ? `${workflowKindLabels[kind.equipmentKind]} 작업 ${result.changedCount}건을 저장했습니다.`
        : `${workflowKindLabels[kind.equipmentKind]} ${repairLaborScopeLabels[scope]}작업 공수시간 ${
            scopeHours[scope].trim() === "" ? "'정하지 않음'" : `${scopeHours[scope].trim()}시간`
          } · ${repairLaborScopeLabels[scope]} 작업 ${
            filledScopeTasks(scope).length
          }건을 저장했습니다.`;
    router.refresh();
    // 성공은 저장 팝업으로 알린다(common/SavePopup.tsx) — 이 화면이 곧 목록이라 머문다.
    // 서버가 거절한 이유는 지금처럼 위의 문구 칸에(onMessage).
    showSavePopup({ message: savedMessage, redirectTo: null });
  }

  const disabled = busy || !canEdit;

  /**
   * 수리 작업 비용 탭의 몸통.
   *
   * 몸통을 값으로 뽑아 둔 것은 들여쓰기를 흔들지 않기 위해서다 — 갈래 탭을 얹느라
   * 이 안을 한 겹 더 감쌌다면 고친 것 없는 줄까지 전부 변경으로 잡히고, 그러면
   * 나중에 "이 탭에서 무엇이 달라졌나"를 diff 로 답할 수 없다.
   */
  const tasksBody = (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className={editLabelClass}>시간당 작업비 (원)</span>
          {/* 세 자리마다 콤마를 붙여 보여 준다 — 들고 있는 값은 콤마 없는 그대로다
              (common/AmountInput.tsx). 받는 모양은 저장 검증과 같다(소수 둘째 자리까지). */}
          <AmountInput value={hourlyRate} onValueChange={setHourlyRate} className={editInputClass} disabled={disabled} />
          {fieldErrors.hourlyRate && <p className={editErrorClass}>{fieldErrors.hourlyRate}</p>}
        </label>
        {/* 🔴 **적는 칸이 아니다.** 세 갈래 공수시간의 합이라 적을 것이 없다 —
            고치려면 조사 · 통전 · 서류 탭의 공수시간을 고친다(파일 머리말). */}
        <div className="flex flex-col gap-1">
          <span className={editLabelClass}>기본 작업비 (조사 + 통전 + 서류)</span>
          <span className="pt-2 text-sm tabular-nums text-zinc-600 dark:text-zinc-300">
            {baseCost.amountText}
          </span>
          <div className="flex flex-col gap-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">
            {baseCost.shares.map((share) => (
              <span key={share.scope}>
                {/* 칸의 값 자체가 잘못됐으면 "정하지 않았습니다"가 아니라 그 사실을
                    말한다 — 0 을 적어 둔 사람에게 "안 적었다"고 하면 안 된다. */}
                {hoursErrors[share.scope] !== null
                  ? `${repairLaborScopeLabels[share.scope]} — 공수시간 칸의 값이 올바르지 않습니다`
                  : share.text}
              </span>
            ))}
          </div>
          {baseCost.unsetNote && (
            <span className="text-[11px] text-amber-700 dark:text-amber-400">
              {baseCost.unsetNote}
            </span>
          )}
          <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
            견적서에서 고른 작업의 합에 이 값이 더해집니다. 고치려면 각 탭의 공수시간을
            고쳐 주세요 — 이 칸은 적는 자리가 아닙니다.
          </span>
        </div>
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
   * 조사 · 통전 · 서류 탭의 몸통. **금액 한 벌 + 작업 목록**이다. 갈래만 달리해
   * **셋이 이 하나를 나눠 쓴다** — 세 벌로 베끼면 한 곳을 고칠 때 세 곳을 고쳐야 한다.
   *
   * 시간당 작업비와 기본 작업비는 수리 작업 탭에서 본다 — 여기 한 번 더 두면 같은
   * 값을 보는 자리가 넷이 되고, 사람은 어느 쪽이 진짜인지 묻게 된다.
   *
   * ── 🔴 위의 공수시간과 아래의 목록은 겹치는 숫자가 아니다 ──────────────
   * 위 칸은 **얼마인가**(금액의 근거)이고, 아래 목록은 **무엇을 하는가**(문서에
   * 적히는 글)다. 그래서 목록에는 시간 칸이 없다 — 줄마다 시간을 두면 "줄들의 합"과
   * "위 칸"이라는 두 숫자가 같은 금액을 주장하게 되고, 어긋나는 날 어느 쪽이
   * 참인지 답할 수 없다. 사용자가 줄별 시간 배분은 필요 없다고 정했다(2026-09-04).
   */
  function scopeBody(scope: RepairLaborScope) {
    const label = repairLaborScopeLabels[scope];
    const rows = scopeTasks[scope];
    const hoursText = scopeHours[scope];
    const hoursField = REPAIR_LABOR_HOURS_FIELDS[scope];
    const tasksField = REPAIR_LABOR_TASKS_FIELDS[scope];
    const share = baseCost.shares.find((line) => line.scope === scope);

    return (
      <>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className={editLabelClass}>{label}작업 공수시간</span>
            <input
              value={hoursText}
              onChange={(e) => setScopeHours((prev) => ({ ...prev, [scope]: e.target.value }))}
              inputMode="numeric"
              placeholder="비워 두면 정하지 않음"
              aria-label={`${label}작업 공수시간`}
              className={editInputClass}
              disabled={disabled}
            />
            {/* 🔴 "정하지 않음"과 "0"이 눈으로 갈라져야 한다. 조사·통전은 0 자체를
                받지 않는다: 0시간짜리 조사·통전작업이라는 것은 없고, 그 상태를 뜻하는
                말이 바로 빈 칸이다. 서류만 0 이 실제 값이다(「서류작업이 없는 장비」). */}
            <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
              {hoursText.trim() === ""
                ? "아직 정하지 않음 — 기본 작업비에서 덜어 낼 몫을 셈할 수 없습니다."
                : scope === "DOCUMENT" && hoursText.trim() === "0"
                  ? "0시간 — 서류작업이 없는 장비입니다. 「서류작업 제외」로 뺄 금액이 0원입니다."
                  : `기본 작업비 안에 이미 들어 있는 ${label}작업의 몫입니다.`}
            </span>
            {/* 🔴 서버에 보내기 전에 화면이 먼저 막는다 — 위 hoursErrors 의 그 까닭. */}
            {(hoursErrors[scope] ?? fieldErrors[hoursField]) && (
              <p className={editErrorClass}>{hoursErrors[scope] ?? fieldErrors[hoursField]}</p>
            )}
          </label>
          <div className="flex flex-col gap-1">
            <span className={editLabelClass}>{label}작업 비용 (공수시간 × 시간당 작업비)</span>
            {/* 계산해서 보여 줄 뿐 저장하지 않는다(파일 머리말). 🔴 기본 작업비와
                **같은 셈**에서 온다(base-cost-display.ts) — 두 곳이 갈리면 몫들의 합이
                위의 기본 작업비와 어긋난다. */}
            <span className="pt-2 text-sm tabular-nums text-zinc-600 dark:text-zinc-300">
              {hoursErrors[scope] !== null
                ? "공수시간 칸의 값을 고쳐 주세요"
                : hoursText.trim() === ""
                  ? // 🔴 0원으로 보이면 안 된다 — "무상"과 "모른다"는 다른 말이다.
                    "아직 정하지 않았습니다"
                  : (share?.text ?? "—")}
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

        {/* ── 갈래 작업 목록 ─────────────────────────────────────────────────
            수리 작업 탭의 목록과 **같은 조작법**이다: `+ 작업 추가`로 줄을 더하고
            `×` 로 지운다. 다른 점은 시간 칸이 없다는 것과, 차례를 ↑/↓ 로 옮길 수
            있다는 것뿐이다 — 순서대로 하는 일이라 차례가 뜻을 갖는다. */}
        <div className="mt-4 flex items-baseline justify-between">
          <span className={editLabelClass}>
            {label} 작업 목록 ({rows.length}건)
          </span>
          {/* canEdit 이 아니면 단추 자체를 그리지 않는다 — 볼 권한만 있는 사람에게
              누를 수 없는 단추를 보이면 "왜 안 눌리지"를 묻게 된다. */}
          {canEdit && (
            <button
              type="button"
              onClick={() =>
                updateScopeTasks(scope, (prev) => [
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
        {fieldErrors[tasksField] && <p className={editErrorClass}>{fieldErrors[tasksField]}</p>}

        <div className="mt-2 flex flex-col gap-2">
          {rows.length > 0 && (
            <div className="grid grid-cols-[1fr_auto] gap-2 text-[11px] text-zinc-500 dark:text-zinc-400">
              <span>건명</span>
              <span aria-hidden />
            </div>
          )}
          {rows.map((task, index) => (
            <div key={task.key} className="grid grid-cols-[1fr_auto] items-start gap-2">
              <div>
                <input
                  value={task.taskName}
                  onChange={(e) =>
                    updateScopeTasks(scope, (prev) =>
                      prev.map((row) =>
                        row.key === task.key ? { ...row, taskName: e.target.value } : row
                      )
                    )
                  }
                  placeholder={`${index + 1}번째 ${label} 작업 건명`}
                  aria-label={`${index + 1}번째 ${label} 작업 건명`}
                  className={editInputClass}
                  disabled={disabled}
                />
                {fieldErrors[`${tasksField}.${index}.taskName`] && (
                  <p className={editErrorClass}>{fieldErrors[`${tasksField}.${index}.taskName`]}</p>
                )}
              </div>
              {canEdit && (
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => moveScopeTask(scope, index, -1)}
                    disabled={disabled || index === 0}
                    aria-label={`${index + 1}번째 ${label} 작업 위로`}
                    className="rounded-md border border-zinc-300 px-2 py-1.5 text-sm disabled:opacity-30 dark:border-zinc-700"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    onClick={() => moveScopeTask(scope, index, 1)}
                    disabled={disabled || index === rows.length - 1}
                    aria-label={`${index + 1}번째 ${label} 작업 아래로`}
                    className="rounded-md border border-zinc-300 px-2 py-1.5 text-sm disabled:opacity-30 dark:border-zinc-700"
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      updateScopeTasks(scope, (prev) => prev.filter((row) => row.key !== task.key))
                    }
                    disabled={disabled}
                    aria-label={`${index + 1}번째 ${label} 작업 지우기`}
                    className="rounded-md border border-zinc-300 px-2 py-1.5 text-sm text-zinc-500 disabled:opacity-50 dark:border-zinc-700"
                  >
                    ×
                  </button>
                </div>
              )}
            </div>
          ))}
          {rows.length === 0 && (
            // 🔴 수리 작업 목록과 달리 **경고 색이 아니다.** 갈래 목록이 비어 있는
            // 것은 정상이다 — 조사·서류는 아직 하나도 없고, 없어도 견적서 금액은 위
            // 칸이 그대로 정한다. 빈 목록을 고장처럼 보이게 하면 없는 문제를 만든다.
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              이 장비의 {label} 작업 목록이 아직 없습니다 — `+ 작업 추가`로 건명을 넣어
              주세요. 비어 있어도 {label}작업 비용은 위 공수시간이 그대로 정합니다.
            </p>
          )}
        </div>
      </>
    );
  }

  const activeScope = scopeOf(section);

  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      {activeScope === null ? tasksBody : scopeBody(activeScope)}

      {canEdit && (
        <div className="mt-4 flex justify-end">
          <button
            type="button"
            onClick={() => void save()}
            disabled={busy}
            className="rounded-md bg-primary-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50 dark:bg-primary-50 dark:text-zinc-900"
          >
            {busy ? "저장 중…" : "저장"}
          </button>
        </div>
      )}
    </section>
  );
}
