"use client";

import { Fragment, useState } from "react";
import { useRouter } from "next/navigation";
import { useUiText } from "@/components/providers/UiTextProvider";
import { PART_ISSUE_REQUEST_BUTTON_LABEL } from "@/components/inventory/part-issue-approval-texts";
import { saveShipmentApprovalRouteAction } from "@/lib/server/actions/shipment-approval-routes";
import {
  isSameRouteStepList,
  isShipmentApprovalRouteScope,
  MAX_SHIPMENT_APPROVAL_ROUTE_STEPS,
  moveRouteStepDown,
  moveRouteStepUp,
  removeRouteStep,
  SHIPMENT_APPROVAL_ROUTE_EMPTY_NOTICES,
  SHIPMENT_APPROVAL_ROUTE_SCOPE_LABELS,
  SHIPMENT_APPROVAL_ROUTE_SCOPES,
  stepOrderFromIndex,
  validateShipmentApprovalRouteSteps,
  type ShipmentApprovalRouteScope,
} from "@/lib/domain/shipment-approval-route";
import {
  isPartIssueApprovalRouteInForce,
  PART_ISSUE_APPROVAL_ROUTE_SCOPE,
} from "@/lib/domain/inventory-part-issue-rules";
import type { Role } from "@/lib/domain/types";
import type {
  SelectableApproverCandidate,
  ShipmentApprovalRouteStepView,
  ShipmentApprovalRouteView,
} from "@/lib/db/queries/shipment-approval-routes";

/**
 * 승인 절차(결재선) 편집 — 용도 고르기 + 순서 목록 + 미리보기.
 *
 * 그래프 편집기가 아니다. 순서는 **일렬**이고(갈래도 병렬 승인도 없다), 자리를
 * 바꾸는 일은 [▲][▼] 로 배열 원소를 옮기는 것이 전부다. 그 배열 조작과 「바뀐 게
 * 있는가」 판정은 순수 함수로 domain/shipment-approval-route.ts 에 있다 — 이
 * 화면은 서버 액션을 물고 있어(그 사슬 끝에 server-only 가 있다) 렌더 시험이
 * 붙지 않으므로, 실수가 나기 쉬운 부분을 시험이 붙는 자리로 내려 두었다.
 *
 * ── 🔴 용도(scope)마다 판이 따로 쌓인다 ─────────────────────────────────
 * 「최종 출하 승인」과 「부품 불출」은 같은 표를 쓰지만 **서로 다른 절차**다. 판
 * 번호도 「현재 절차」도 용도 안에서 정해지므로, 한쪽을 고쳐도 다른 쪽은 흔들리지
 * 않는다(db/mutations·queries 의 scope 조건).
 *
 * 🔴 **그래서 편집 중이던 목록도 용도별로 갈라 둔다**(`draftByScope`). 목록을
 * 하나만 두고 용도만 갈아 끼우면, 출하 결재선을 짜다가 용도를 바꾸고 [저장]을
 * 누른 순간 **그 사람들이 부품 불출 절차로 저장된다.** 불출 절차는 만들어지는
 * 순간 재고의 [불출]·[사용]을 잠그므로(isPartIssueApprovalRouteInForce), 그
 * 실수는 조용하지 않고 즉시 업무를 멈춘다. 용도별로 갈라 두면 그 길 자체가
 * 없어지고, 덤으로 편집하던 것이 사라지지도 않는다.
 *
 * ── 🔴 단계 0개로 저장하는 길을 막지 않는다 ─────────────────────────────
 * 판은 지우지 않으므로(append-only) **0개짜리 판을 얹는 것이 절차를 끄는 유일한
 * 출구다.** 저장 단추를 「단계가 1개 이상일 때만」으로 잠그면 한 번 켠 절차를
 * 되돌릴 방법이 영영 없어진다 — 부품 불출에서는 그것이 곧 재고가 잠긴 채로
 * 남는다는 뜻이다.
 *
 * ── 🔴 자격을 잃은 사람을 조용히 빼지 않는다 ────────────────────────────
 * 결재선에 올라간 뒤 계정이 잠기거나 지워지는 일은 실제로 일어나고, 그때 결재는
 * 그 단계에서 멈춘다. 줄은 그대로 두고 왜 안 되는지를 그 자리에 적는다 — 조용히
 * 빼면 절차가 짧아진 것처럼 보이고, 「왜 결재가 안 넘어가지」를 아무도 답할 수
 * 없다.
 */

const SELECT_CLASS =
  "w-full min-w-0 rounded-md border border-zinc-200 px-2 py-1.5 text-sm text-zinc-900 disabled:cursor-not-allowed disabled:bg-zinc-50 disabled:text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:disabled:bg-zinc-800";

const ICON_BUTTON_CLASS =
  "rounded-md border border-zinc-300 px-2 py-1 text-xs leading-none text-zinc-700 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800";

/**
 * 용도별 현재 판. **모든 용도가 키로 있어야 한다** — 서버 페이지가 용도 목록을
 * 돌며 읽어 채우므로, 용도를 하나 더하면 그 자리가 컴파일러에 바로 보인다.
 * 값이 null 인 것은 그 용도의 판이 아직 하나도 없다는 뜻이다(정상이다).
 */
export type ShipmentApprovalRoutesByScope = Record<
  ShipmentApprovalRouteScope,
  ShipmentApprovalRouteView | null
>;

/**
 * 화면을 처음 열었을 때 보이는 용도. 「최종 출하 승인」이 먼저인 이유는 이 탭이
 * 원래 그 절차 하나만 다루던 자리이고, 지금도 실제로 쓰이는 것이 그쪽이기
 * 때문이다. 사람에게 보이는 이름은 여기서 정하지 않는다(이름표는 도메인에 있다).
 */
const DEFAULT_SCOPE: ShipmentApprovalRouteScope = "FINAL_SHIPMENT";

/**
 * 이 사람이 지금 결재선에 올라 있을 수 없는 이유. 올릴 수 있으면 null.
 *
 * 판정 순서와 말투를 RepresentativeListSection 의 eligibilityBlockReason 과
 * 맞춘다 — 같은 자격을 두 탭이 다른 말로 설명하면 관리자는 둘이 다른 규칙인 줄
 * 안다. 삭제를 먼저 보는 것만 다르다(그 탭의 목록에는 삭제된 계정이 아예 없다).
 */
function stepBlockReason(step: ShipmentApprovalRouteStepView): string {
  if (step.approverIsDeleted) return "삭제된 계정입니다. 이 단계에서 결재가 멈춥니다.";
  if (step.approverApprovalStatus !== "APPROVED") {
    return "승인되지 않은 계정입니다. 이 단계에서 결재가 멈춥니다.";
  }
  if (!step.approverIsActive) return "비활성화된 계정입니다. 이 단계에서 결재가 멈춥니다.";
  if (step.approverLockedAt !== null) return "잠긴 계정입니다. 이 단계에서 결재가 멈춥니다.";
  return "지금은 승인 단계에 올릴 수 없는 계정입니다.";
}

export default function ShipmentApprovalRouteSection({
  routes,
  candidates,
  canManageRepresentatives,
}: {
  /** 용도별 현재 절차(그 용도 안에서 version 이 가장 큰 판). 판이 없으면 null 이다. */
  routes: ShipmentApprovalRoutesByScope;
  /** 단계에 올릴 수 있는 사용자. 「출하 대표」로 지정할 수 있는 조건과 같다. */
  candidates: SelectableApproverCandidate[];
  /**
   * 🔴 서버와 **같은 판정**이다 — 「출하 대표 지정」과 같은 영역 열쇠·같은 수준.
   * 서버 페이지가 계산해 내려보내고, 서버 액션과 mutation 이 같은 열쇠·같은
   * 수준으로 다시 본다. 거짓이면 목록을 읽기 전용으로 보여 준다 — 탭 자체는
   * 감추지 않는다(무엇이 정해져 있는지는 볼 수 있어야 한다).
   *
   * 🔴 **용도가 늘어도 이 값 하나다.** 「절차를 정하는 권한」을 용도로 쪼개면
   * 이미 저장된 역할별 권한 설정이 새 영역만 빈 채로 남는다.
   */
  canManageRepresentatives: boolean;
}) {
  const router = useRouter();
  const uiText = useUiText();

  // 용도별 「저장돼 있는 목록」과 그 지문. 지문이 달라지면 그 용도만 다시 맞춘다.
  const savedByScope = {} as Record<ShipmentApprovalRouteScope, string[]>;
  const savedKeyByScope = {} as Record<ShipmentApprovalRouteScope, string>;
  for (const routeScope of SHIPMENT_APPROVAL_ROUTE_SCOPES) {
    savedByScope[routeScope] = (routes[routeScope]?.steps ?? []).map((step) => step.approverUserId);
    savedKeyByScope[routeScope] = savedByScope[routeScope].join("|");
  }

  const [scope, setScope] = useState<ShipmentApprovalRouteScope>(DEFAULT_SCOPE);
  const [draftByScope, setDraftByScope] =
    useState<Record<ShipmentApprovalRouteScope, string[]>>(savedByScope);
  const [syncedKeyByScope, setSyncedKeyByScope] =
    useState<Record<ShipmentApprovalRouteScope, string>>(savedKeyByScope);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // 저장 뒤 router.refresh() 로 새 자료가 내려오면 편집 중이던 목록을 그것에
  // 맞춘다. 다른 관리자가 먼저 바꾼 경우에도 화면이 옛 값을 붙들고 있지 않게
  // 하는 자리다(렌더 중 setState — 자료가 바뀐 그 렌더에서 바로 반영된다).
  //
  // 🔴 **바뀐 용도만 맞춘다.** 한 용도를 저장했다고 다른 용도의 편집 중이던
  // 목록까지 되돌리면, 사람은 자기가 짜던 것이 왜 사라졌는지 알 수 없다.
  const staleScopes = SHIPMENT_APPROVAL_ROUTE_SCOPES.filter(
    (routeScope) => syncedKeyByScope[routeScope] !== savedKeyByScope[routeScope]
  );
  if (staleScopes.length > 0) {
    setSyncedKeyByScope(savedKeyByScope);
    setDraftByScope((previous) => {
      const next = { ...previous };
      for (const routeScope of staleScopes) next[routeScope] = savedByScope[routeScope];
      return next;
    });
  }

  const route = routes[scope];
  const savedApproverIds = savedByScope[scope];
  // 🔴 저장할 목록은 **고른 용도의 것**이다. 이 한 줄이 「다른 용도로 잘못
  // 저장되는 길」을 없앤다 — 목록과 용도가 같은 열쇠에서 나온다.
  const steps = draftByScope[scope];

  const candidateById = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const savedStepById = new Map((route?.steps ?? []).map((step) => [step.approverUserId, step]));

  function roleLabel(role: Role): string {
    // 알 수 없는 역할 코드면 코드 그대로 보여 준다 — 이름표가 사라지는 것보다 낫다.
    return uiText.role[role] ?? role;
  }

  /** 그 줄에 보일 이름. 후보에 없으면 저장돼 있던 이름으로 버틴다. */
  function approverLabel(approverUserId: string): string {
    const candidate = candidateById.get(approverUserId);
    if (candidate) return `${candidate.name} (${roleLabel(candidate.role)})`;
    const saved = savedStepById.get(approverUserId);
    if (saved) return `${saved.approverName} (${roleLabel(saved.approverRole)})`;
    return "알 수 없는 사용자";
  }

  /** 그 줄에 달 경고. 없으면 null. */
  function warningFor(approverUserId: string): string | null {
    if (approverUserId === "") return null; // 아직 안 고른 자리는 저장할 때 말해 준다.
    if (candidateById.has(approverUserId)) return null;
    const saved = savedStepById.get(approverUserId);
    return saved ? stepBlockReason(saved) : "지금은 승인 단계에 올릴 수 없는 계정입니다.";
  }

  function update(next: string[]) {
    setDraftByScope((previous) => ({ ...previous, [scope]: next }));
    setMessage(null);
  }

  function changeScope(next: ShipmentApprovalRouteScope) {
    if (next === scope) return;
    setScope(next);
    // 🔴 결과 문구는 방금까지 보던 용도의 것이다. 데리고 가면 새 용도에 대한
    // 말처럼 읽힌다(「비웠습니다」가 엉뚱한 절차 아래에 붙는다).
    setMessage(null);
  }

  async function handleSave() {
    // 화면과 서버가 **같은 함수**를 본다. 여기서 먼저 보는 이유는 왕복 한 번을
    // 아끼기 위해서일 뿐, 최종 판정은 서버가 다시 한다.
    const checked = validateShipmentApprovalRouteSteps(steps);
    if (!checked.ok) {
      setMessage(checked.message);
      return;
    }

    setIsSaving(true);
    setMessage(null);
    // 🔴 용도와 목록이 **같은 렌더의 같은 열쇠**에서 나온다. 서버는 기본값으로
    // 채워 주지 않으므로 여기서 반드시 적어야 하고, 적는 값은 지금 보고 있는
    // 그 용도여야 한다.
    const result = await saveShipmentApprovalRouteAction({
      scope,
      approverUserIds: steps,
    });
    setIsSaving(false);
    setMessage(result.message);
    if (result.ok) router.refresh();
  }

  const scopeLabel = SHIPMENT_APPROVAL_ROUTE_SCOPE_LABELS[scope];
  const atStepLimit = steps.length >= MAX_SHIPMENT_APPROVAL_ROUTE_STEPS;
  const hasUnsavedChange = !isSameRouteStepList(savedApproverIds, steps);
  // 다른 용도에 손대다 만 것이 있는가. 갈라 두었기 때문에 사라지지는 않지만,
  // 말해 주지 않으면 사람은 저장된 줄 알고 화면을 닫는다.
  const otherUnsavedScopes = SHIPMENT_APPROVAL_ROUTE_SCOPES.filter(
    (routeScope) =>
      routeScope !== scope &&
      !isSameRouteStepList(savedByScope[routeScope], draftByScope[routeScope])
  );
  // 🔴 「부품 불출」이 **지금 켜져 있는가** — 서버가 [불출]·[사용]에 문을 달 때
  // 보는 그 판정이다(같은 순수 함수). 편집 중인 목록이 아니라 **저장된 판**을
  // 본다: 아직 저장하지 않은 편집으로 「지금 이렇습니다」를 말하면 거짓말이 된다.
  const partIssueInForce = isPartIssueApprovalRouteInForce(routes[PART_ISSUE_APPROVAL_ROUTE_SCOPE]);

  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">승인 절차</h2>
      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
        {canManageRepresentatives
          ? `${scopeLabel}을 여러 사람이 순서대로 결재하도록 지정합니다. 위에서부터 차례로 승인합니다.`
          : "출하 대표 지정을 관리할 권한이 있는 사용자만 승인 절차를 변경할 수 있습니다."}
      </p>

      {/* 🔴 용도 고르기. 용도마다 판이 따로 쌓이고, 편집 중이던 목록도 따로 산다 —
          여기서 고른 값 하나가 「무엇을 보여 줄지」와 「어디에 저장할지」를 함께
          정한다. 저장하는 동안은 잠근다: 요청이 도는 중에 용도를 바꾸면 돌아온
          결과 문구가 엉뚱한 절차 아래에 붙는다. */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <label
          htmlFor="shipment-approval-route-scope"
          className="text-xs font-medium text-zinc-700 dark:text-zinc-300"
        >
          어떤 승인
        </label>
        <select
          id="shipment-approval-route-scope"
          value={scope}
          disabled={isSaving}
          onChange={(event) => {
            const next = event.target.value;
            // 고른 값을 그대로 믿지 않는다 — 도메인의 같은 판정으로 좁힌다
            // (형변환을 손으로 적으면 목록에 없는 값도 타입만 통과한다).
            if (isShipmentApprovalRouteScope(next)) changeScope(next);
          }}
          className="min-w-0 rounded-md border border-zinc-200 px-2 py-1.5 text-sm text-zinc-900 disabled:cursor-not-allowed disabled:bg-zinc-50 disabled:text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:disabled:bg-zinc-800"
        >
          {SHIPMENT_APPROVAL_ROUTE_SCOPES.map((routeScope) => (
            <option key={routeScope} value={routeScope}>
              {SHIPMENT_APPROVAL_ROUTE_SCOPE_LABELS[routeScope]}
            </option>
          ))}
        </select>
        {route && (
          <span className="text-[11px] text-zinc-400 dark:text-zinc-500">
            현재 {route.version}번째 판 · {route.createdByName} 님이 저장
          </span>
        )}
      </div>

      {/* 🔴 이 용도에서 절차를 만들면 **다른 화면이 달라진다.** 그것을 미리 말해
          주지 않으면 관리자는 결재선 하나를 저장한 것이 재고 담당자의 단추를
          바꾼다는 사실을 모른 채 저장한다. 반대로 켜 둔 것을 끄는 길(단계를 모두
          지우고 저장)도 여기서 말해 준다 — 판은 지우지 않으므로 그것이 유일한
          출구다. */}
      {scope === PART_ISSUE_APPROVAL_ROUTE_SCOPE && (
        <p className="mt-2 rounded-md border border-zinc-200 bg-zinc-50 p-2 text-[11px] text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400">
          {partIssueInForce
            ? `지금 재고 화면의 [불출]·[사용]이 [${PART_ISSUE_REQUEST_BUTTON_LABEL}]으로 바뀌어 있습니다. 단계를 모두 지우고 저장하면 절차가 꺼지고 예전처럼 그 자리에서 바로 불출합니다.`
            : `승인 절차를 만들면 재고 화면의 [불출]·[사용]이 [${PART_ISSUE_REQUEST_BUTTON_LABEL}]으로 바뀌고, 결재가 끝난 뒤 [승인 요청건] 탭에서 실행하게 됩니다.`}
        </p>
      )}

      {/* 🔴 결과 문구는 이 카드 **안**에 둔다. 카드 밖 형제로 두면 부모가 격자일
          때 이 문단이 칸 하나를 먹어 배치가 깨진다(이 저장소에서 실제로 있었다). */}
      {message && (
        <p className="mt-3 rounded-md border border-zinc-200 bg-zinc-50 p-2 text-xs text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
          {message}
        </p>
      )}

      {steps.length === 0 ? (
        // 🔴 빈 화면만 두면 관리자는 기능이 고장 난 줄 안다. 지금 무엇이
        // 일어나고 있는지를 적어 준다 — 그 한 문장은 **용도마다 다르다.**
        // 저장돼 있던 절차를 방금 비운 중이라면 「아직 없습니다」가 아니라
        // 「저장하면 꺼집니다」다: 그것이 절차를 끄는 유일한 출구이기도 하다.
        <p className="mt-4 rounded-lg border border-zinc-200 px-3 py-6 text-center text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
          {savedApproverIds.length === 0
            ? `아직 승인 절차가 없습니다. ${SHIPMENT_APPROVAL_ROUTE_EMPTY_NOTICES[scope]}`
            : `단계를 모두 지웠습니다. 이대로 저장하면 승인 절차가 꺼집니다 — ${SHIPMENT_APPROVAL_ROUTE_EMPTY_NOTICES[scope]}`}
        </p>
      ) : (
        <ul className="mt-4 flex flex-col gap-2">
          {steps.map((approverUserId, index) => {
            const warning = warningFor(approverUserId);
            const isOrphan = approverUserId !== "" && !candidateById.has(approverUserId);
            return (
              <li
                key={index}
                className="flex flex-col gap-1 rounded-md border border-zinc-100 p-2 dark:border-zinc-800"
              >
                <div className="flex items-center gap-2">
                  <span className="w-10 shrink-0 text-xs font-medium text-zinc-500 dark:text-zinc-400">
                    {stepOrderFromIndex(index)}단계
                  </span>
                  <select
                    value={approverUserId}
                    disabled={!canManageRepresentatives}
                    onChange={(event) => {
                      const next = [...steps];
                      next[index] = event.target.value;
                      update(next);
                    }}
                    className={SELECT_CLASS}
                  >
                    <option value="">선택하세요</option>
                    {/* 자격을 잃어 후보 목록에 없는 사람도 자리를 지키게 한다 —
                        옵션이 없으면 고른 값이 화면에서 조용히 사라진다. */}
                    {isOrphan && (
                      <option value={approverUserId}>{approverLabel(approverUserId)}</option>
                    )}
                    {candidates.map((candidate) => (
                      <option key={candidate.id} value={candidate.id}>
                        {candidate.name} ({roleLabel(candidate.role)})
                      </option>
                    ))}
                  </select>
                  <div className="flex shrink-0 gap-1">
                    <button
                      type="button"
                      aria-label={`${stepOrderFromIndex(index)}단계를 위로`}
                      disabled={!canManageRepresentatives || index === 0}
                      onClick={() => update(moveRouteStepUp(steps, index))}
                      className={ICON_BUTTON_CLASS}
                    >
                      ▲
                    </button>
                    <button
                      type="button"
                      aria-label={`${stepOrderFromIndex(index)}단계를 아래로`}
                      disabled={!canManageRepresentatives || index === steps.length - 1}
                      onClick={() => update(moveRouteStepDown(steps, index))}
                      className={ICON_BUTTON_CLASS}
                    >
                      ▼
                    </button>
                    <button
                      type="button"
                      aria-label={`${stepOrderFromIndex(index)}단계를 삭제`}
                      disabled={!canManageRepresentatives}
                      onClick={() => update(removeRouteStep(steps, index))}
                      className={ICON_BUTTON_CLASS}
                    >
                      ✕
                    </button>
                  </div>
                </div>
                {warning && (
                  <p className="pl-12 text-[11px] text-amber-700 dark:text-amber-400">{warning}</p>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {canManageRepresentatives ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={atStepLimit}
            onClick={() => update([...steps, ""])}
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            + 단계 추가
          </button>
          {atStepLimit && (
            <span className="text-[11px] text-zinc-400 dark:text-zinc-500">
              승인 단계는 최대 {MAX_SHIPMENT_APPROVAL_ROUTE_STEPS}개까지 둘 수 있습니다.
            </span>
          )}
          {/* 🔴 잠그는 조건은 「저장 중인가」 하나다. 단계 수를 보고 잠그면 0개짜리
              판을 얹을 수 없게 되고, 그 순간 한 번 켠 절차를 끌 방법이 사라진다. */}
          <button
            type="button"
            disabled={isSaving}
            onClick={() => void handleSave()}
            className="ml-auto rounded-md bg-primary-900 px-3 py-1.5 text-sm font-medium text-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-primary-50 dark:text-zinc-900"
          >
            {isSaving ? "저장 중..." : "저장"}
          </button>
          {hasUnsavedChange && !isSaving && (
            <span className="w-full text-[11px] text-amber-700 dark:text-amber-400">
              저장하지 않은 변경이 있습니다.
            </span>
          )}
          {otherUnsavedScopes.length > 0 && (
            <span className="w-full text-[11px] text-amber-700 dark:text-amber-400">
              {otherUnsavedScopes
                .map((routeScope) => SHIPMENT_APPROVAL_ROUTE_SCOPE_LABELS[routeScope])
                .join(" · ")}
              에도 저장하지 않은 변경이 있습니다. 그 승인을 골라 따로 저장해 주세요.
            </span>
          )}
        </div>
      ) : (
        <p className="mt-3 rounded-md border border-zinc-200 bg-zinc-50 p-3 text-xs text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400">
          {/* 문구에 역할 이름을 박지 않는다 — 이 값은 서버와 같은 판정이고,
              개발자 표시가 켜진 계정도 통과한다. 역할로 적으면 막힌 사람에게
              잘못된 이유를 알려 주게 된다(RepresentativeListSection 과 같다). */}
          출하 대표 지정을 관리할 권한이 있는 사용자만 승인 절차를 변경할 수 있습니다.
        </p>
      )}

      {steps.length > 0 && (
        <div className="mt-5 border-t border-zinc-100 pt-4 dark:border-zinc-800">
          <h3 className="text-xs font-medium text-zinc-500 dark:text-zinc-400">미리보기</h3>
          {/* 🔴 가로로 길어지면 이 상자 안에서만 밀린다 — 화면 전체가 옆으로
              밀리면 다른 설정까지 못 쓰게 된다. 그래프 라이브러리는 쓰지 않는다:
              일렬이라 상자와 화살표 글자로 충분하다. */}
          <div className="mt-2 overflow-x-auto pb-1">
            <div className="flex min-w-max items-start gap-2">
              {steps.map((approverUserId, index) => (
                <Fragment key={index}>
                  {index > 0 && (
                    <span
                      aria-hidden
                      className="self-center text-sm text-zinc-400 dark:text-zinc-500"
                    >
                      ▶
                    </span>
                  )}
                  <div className="flex flex-col items-center gap-1">
                    <span
                      className={`whitespace-nowrap rounded-md border px-3 py-2 text-xs ${
                        warningFor(approverUserId)
                          ? "border-amber-300 text-amber-700 dark:border-amber-800 dark:text-amber-400"
                          : "border-zinc-300 text-zinc-900 dark:border-zinc-700 dark:text-zinc-50"
                      }`}
                    >
                      {approverUserId === "" ? "미지정" : approverLabel(approverUserId)}
                    </span>
                    <span className="text-[11px] text-zinc-400 dark:text-zinc-500">
                      {stepOrderFromIndex(index)}단계
                    </span>
                  </div>
                </Fragment>
              ))}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
