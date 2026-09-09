"use client";

import { Fragment, useState } from "react";
import { useRouter } from "next/navigation";
import { useUiText } from "@/components/providers/UiTextProvider";
import { saveShipmentApprovalRouteAction } from "@/lib/server/actions/shipment-approval-routes";
import {
  isSameRouteStepList,
  MAX_SHIPMENT_APPROVAL_ROUTE_STEPS,
  moveRouteStepDown,
  moveRouteStepUp,
  removeRouteStep,
  stepOrderFromIndex,
  validateShipmentApprovalRouteSteps,
} from "@/lib/domain/shipment-approval-route";
import type { Role } from "@/lib/domain/types";
import type {
  SelectableApproverCandidate,
  ShipmentApprovalRouteStepView,
  ShipmentApprovalRouteView,
} from "@/lib/db/queries/shipment-approval-routes";

/**
 * 출하 승인 절차(결재선) 편집 — 순서 목록 + 미리보기.
 *
 * 🔴 **이 조각에서는 만들어 둔 절차를 아직 쓰지 않는다.** 최종 출하 승인은
 * 여전히 「출하 대표」·위임 방식으로 처리된다. 그래서 단계가 0개일 때 그 사실을
 * 화면에 적어 준다 — 빈 화면만 두면 관리자는 기능이 고장 난 줄 안다.
 *
 * 그래프 편집기가 아니다. 순서는 **일렬**이고(갈래도 병렬 승인도 없다), 자리를
 * 바꾸는 일은 [▲][▼] 로 배열 원소를 옮기는 것이 전부다. 그 배열 조작과 「바뀐 게
 * 있는가」 판정은 순수 함수로 domain/shipment-approval-route.ts 에 있다 — 이
 * 화면은 서버 액션을 물고 있어(그 사슬 끝에 server-only 가 있다) 렌더 시험이
 * 붙지 않으므로, 실수가 나기 쉬운 부분을 시험이 붙는 자리로 내려 두었다.
 *
 * 🔴 **자격을 잃은 사람을 조용히 빼지 않는다.** 결재선에 올라간 뒤 계정이
 * 잠기거나 지워지는 일은 실제로 일어나고, 그때 결재는 그 단계에서 멈춘다.
 * 줄은 그대로 두고 왜 안 되는지를 그 자리에 적는다 — 조용히 빼면 절차가 짧아진
 * 것처럼 보이고, 「왜 결재가 안 넘어가지」를 아무도 답할 수 없다.
 */

const SELECT_CLASS =
  "w-full min-w-0 rounded-md border border-zinc-200 px-2 py-1.5 text-sm text-zinc-900 disabled:cursor-not-allowed disabled:bg-zinc-50 disabled:text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:disabled:bg-zinc-800";

const ICON_BUTTON_CLASS =
  "rounded-md border border-zinc-300 px-2 py-1 text-xs leading-none text-zinc-700 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800";

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
  route,
  candidates,
  canManageRepresentatives,
}: {
  /** 현재 절차(version 이 가장 큰 판). 판이 하나도 없으면 null 이다. */
  route: ShipmentApprovalRouteView | null;
  /** 단계에 올릴 수 있는 사용자. 「출하 대표」로 지정할 수 있는 조건과 같다. */
  candidates: SelectableApproverCandidate[];
  /**
   * 🔴 서버와 **같은 판정**이다 — hasPermission(actor,
   * "users.shipmentRepresentatives", "MANAGE"). 서버 페이지가 계산해 내려보내고,
   * 서버 액션과 mutation 이 같은 열쇠·같은 수준으로 다시 본다. 거짓이면 목록을
   * 읽기 전용으로 보여 준다 — 탭 자체는 감추지 않는다(무엇이 정해져 있는지는
   * 볼 수 있어야 한다).
   */
  canManageRepresentatives: boolean;
}) {
  const router = useRouter();
  const uiText = useUiText();

  const savedApproverIds = (route?.steps ?? []).map((step) => step.approverUserId);
  const savedKey = savedApproverIds.join("|");

  const [steps, setSteps] = useState<string[]>(savedApproverIds);
  const [syncedKey, setSyncedKey] = useState(savedKey);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // 저장 뒤 router.refresh() 로 새 자료가 내려오면 편집 중이던 목록을 그것에
  // 맞춘다. 다른 관리자가 먼저 바꾼 경우에도 화면이 옛 값을 붙들고 있지 않게
  // 하는 자리다(렌더 중 setState — 자료가 바뀐 그 렌더에서 바로 반영된다).
  if (syncedKey !== savedKey) {
    setSyncedKey(savedKey);
    setSteps(savedApproverIds);
  }

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
    setSteps(next);
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
    const result = await saveShipmentApprovalRouteAction({ approverUserIds: steps });
    setIsSaving(false);
    setMessage(result.message);
    if (result.ok) router.refresh();
  }

  const atStepLimit = steps.length >= MAX_SHIPMENT_APPROVAL_ROUTE_STEPS;
  const hasUnsavedChange = !isSameRouteStepList(savedApproverIds, steps);

  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">출하 승인 절차</h2>
      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
        {canManageRepresentatives
          ? "최종 출하 승인을 여러 사람이 순서대로 결재하도록 지정합니다. 위에서부터 차례로 승인합니다."
          : "출하 대표 지정을 관리할 권한이 있는 사용자만 승인 절차를 변경할 수 있습니다."}
      </p>

      {route && (
        <p className="mt-1 text-[11px] text-zinc-400 dark:text-zinc-500">
          현재 {route.version}번째 판 · {route.createdByName} 님이 저장
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
        // 일어나고 있는지를 적어 준다.
        <p className="mt-4 rounded-lg border border-zinc-200 px-3 py-6 text-center text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
          아직 승인 절차가 없습니다. 지금은 <strong className="font-medium">출하 대표</strong>로 지정된
          사용자가 최종 출하 승인을 처리합니다.
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
