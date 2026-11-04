"use client";

import { useState } from "react";
import { procedureNodeTypeLabels } from "@/lib/domain/procedure-template-types";
import {
  adoptedFieldSteps,
  pendingFieldSteps,
  summarizeFieldStepAdoption,
  type FieldAddedStep,
} from "@/lib/domain/procedure-field-added-steps";
import { adoptFieldAddedStepAction } from "@/lib/server/actions/procedure-template-editor";

/**
 * ============================================================================
 * 「현장 단계」 패널 — 수리 건에서 더한 작업을 **절차에 넣을까요?**
 * ============================================================================
 * 사용자 결정(2026-11-02): 「원본 절차를 편집할 때, 이번에 만들었던 단계를
 * 희미하게 표시해주고, 적용할 것인지 묻도록 하자」.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 🔴 **창(모달)으로 띄우지 않는다** — 이것이 이 부품의 가장 중요한 제약이다
 * ──────────────────────────────────────────────────────────────────────
 * 「안 넣기로 했다」를 **기억하지 않기로** 했다(2026-11-03 사용자 결정 — 새 표를
 * 만들지 않는다). 그래서 안 넣은 단계는 **편집기를 열 때마다 그대로 남는다.**
 * 여기서 창을 띄우면 절차를 고치러 들어올 때마다 같은 질문이 가로막는다 — 그것이
 * 바로 「두 번 묻는」 것이다. 탭의 숫자 딱지와 이 패널만으로 알린다: 사람이 보고
 * 싶을 때 와서 보고, 넣고 싶을 때 넣는다.
 *
 * 🔵 「이미 넣은 것」은 **접어서** 아래에 둔다. 할 일이 아니기 때문이다 — 다만
 * 아예 안 보이면 「내가 저걸 넣었던가?」를 확인할 길이 없어진다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 🔴 넣는 단추가 보내는 것은 **id 둘뿐**이다
 * ──────────────────────────────────────────────────────────────────────
 * 제목·갈래·자리는 한 글자도 안 보낸다. 서버가 실행 쪽 행에서 제 손으로 읽는다 —
 * 화면이 보낸 제목을 쓰면 「현장이 적은 것」이 아니라 「누군가 화면에서 고쳐 보낸
 * 것」이 절차에 들어간다.
 * ============================================================================
 */
export default function FieldAddedStepsPanel({
  templateId,
  steps,
  canEdit,
  ghostsVisible,
  onGhostsVisibleChange,
  expectedTemplateUpdatedAt,
  onAdopted,
}: {
  templateId: string;
  steps: readonly FieldAddedStep[];
  /**
   * 🔴 기본값을 안 둔다 — 넘기는 것을 잊으면 컴파일이 멈춘다. 이 패널은 쓰기
   * 단추를 갖고 있어서, 권한을 「안 넘기면 열림」으로 두면 읽기 전용 화면에
   * 조용히 쓰기 단추가 선다.
   */
  canEdit: boolean;
  /**
   * 지금 그림에 유령 칸이 **그려지고 있는가**(2026-11-04).
   *
   * 🔴 받는 까닭 둘. ① 아래 안내가 「그림에 희미한 점선으로 그려집니다」라고
   * 말한다 — 꺼 둔 사람에게 그 문장은 **거짓말**이고, 그 거짓말을 읽은 사람은 안
   * 보이는 까닭을 엉뚱한 데서 찾는다. 상태가 둘이면 할 말도 둘이어야 한다.
   * ② 끄고 켜는 **체크표시가 이 패널 안**에 있다(사용자 결정 — 「[현장단계]안에
   * 체크표시가 있도록 해줘」). 처음에는 그림 바로 위에 있었다.
   *
   * 🔵 넣는 단추는 이 값과 **상관없이** 선다. 숨기는 것은 그림이지 할 일이 아니다.
   */
  ghostsVisible: boolean;
  /**
   * 체크표시를 누르면 부르는 쪽에 알린다. 🔴 이 패널은 상태를 제 안에 들고 있지
   * 않는다 — 그림에 무엇을 넘길지 정하는 쪽이 같은 값을 봐야 하고, 끈 상태는 이
   * 브라우저에 남는다(use-field-step-ghost-visibility).
   */
  onGhostsVisibleChange: (visible: boolean) => void;
  expectedTemplateUpdatedAt: string;
  /** 성공하면 편집기가 되돌리기 한 걸음을 쌓고 새로 읽는다(handleStructuralSaved). */
  onAdopted: (newUpdatedAt: string) => void;
}) {
  const [adoptingId, setAdoptingId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [lastResultMessage, setLastResultMessage] = useState<string | null>(null);
  const [showAdopted, setShowAdopted] = useState(false);

  const pending = pendingFieldSteps(steps);
  const adopted = adoptedFieldSteps(steps);

  async function handleAdopt(step: FieldAddedStep) {
    // 🔴 돌고 있는 동안 둘째 호출을 막는다. 이 저장소에서 「두 번 누르기」가 실제로
    //    났다 — 여기서는 둘째가 FIELD_STEP_ALREADY_ADOPTED 로 막히지만, 사람에게는
    //    까닭 없는 빨간 글씨로만 보인다.
    if (adoptingId !== null) return;
    setAdoptingId(step.executionNodeId);
    setErrorMessage(null);
    setLastResultMessage(null);
    const result = await adoptFieldAddedStepAction({
      templateId,
      executionNodeId: step.executionNodeId,
      expectedTemplateUpdatedAt,
    });
    setAdoptingId(null);
    if (!result.ok) {
      setErrorMessage(result.message);
      return;
    }
    setLastResultMessage(
      result.skippedEdgeCount > 0
        ? `절차에 넣었습니다 — 연결 ${result.createdEdgeCount}개를 함께 그었고, ${result.skippedEdgeCount}개는 이 초안에 상대가 없어 못 그었습니다.`
        : `절차에 넣었습니다 — 연결 ${result.createdEdgeCount}개를 함께 그었습니다.`
    );
    onAdopted(result.updatedAt);
  }

  return (
    <div className="flex flex-col gap-3 text-xs">
      <div>
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">현장에서 더한 단계</h3>
        <p className="mt-1 text-zinc-500 dark:text-zinc-400">
          수리 건을 진행하다 그 자리에서 더한 작업입니다. 지금은 그 건에만 있고 원본 절차에는 없습니다 —{" "}
          {ghostsVisible
            ? "그림에 희미한 점선으로 그려집니다."
            : "지금은 그림에서 숨겨 두었습니다. 숨겨 두어도 아래에서 그대로 넣을 수 있습니다."}
        </p>
      </div>

      {/*
        「현장 단계 표시」 — 그림의 유령 칸·점선을 한 번에 끄고 켠다.

        🔴 **긴 설명을 안 붙인다**(2026-11-04 사용자 결정 — 「설명은 필요없다」).
        바로 위 안내가 지금 상태를 이미 말하고 있어서, 체크표시 옆에 또 적으면 같은
        말이 한 화면에 두 번 선다.

        🔴 **아직 안 넣은 것이 있을 때만** 선다(pending). 다 넣고 나면 끌 유령이
        없는데 스위치만 남아 「껐는데 왜 그대로지」가 된다. 탭 자체는 그래도 남는다 —
        그쪽은 「이미 넣은 단계」를 확인하는 길이다.
      */}
      {pending.length > 0 && (
        <label className="flex w-fit items-center gap-1.5 text-zinc-600 dark:text-zinc-400">
          <input
            type="checkbox"
            checked={ghostsVisible}
            onChange={(e) => onGhostsVisibleChange(e.target.checked)}
            className="h-3.5 w-3.5 rounded border-zinc-300 dark:border-zinc-700"
          />
          현장 단계 표시
        </label>
      )}

      {lastResultMessage && <p className="rounded-md bg-emerald-50 px-2 py-1.5 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">{lastResultMessage}</p>}
      {errorMessage && <p className="text-red-600 dark:text-red-400">{errorMessage}</p>}

      {pending.length === 0 ? (
        <p className="text-zinc-400 dark:text-zinc-600">아직 넣지 않은 현장 단계가 없습니다.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {pending.map((step) => {
            const summary = summarizeFieldStepAdoption(step, steps);
            return (
              <li key={step.executionNodeId} className="flex flex-col gap-1.5 rounded-md border border-zinc-200 p-2 dark:border-zinc-800">
                <div className="flex items-start gap-1.5">
                  <span className="min-w-0 flex-1 font-medium text-zinc-900 dark:text-zinc-100">{step.title}</span>
                  <span className="shrink-0 rounded bg-zinc-100 px-1 py-0.5 text-[10px] whitespace-nowrap text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                    {procedureNodeTypeLabels[step.nodeType]}
                  </span>
                </div>
                {step.instructions && <p className="whitespace-pre-wrap text-zinc-600 dark:text-zinc-400">{step.instructions}</p>}
                {/*
                  🔵 어느 건·어느 판본에서 나왔는지를 적는다. 고객 이름은 안 싣는다 —
                  절차를 고치는 자리라 거기에 고객이 보일 까닭이 없다(접수 번호는
                  사내 번호라 그 자체로 사람을 가리키지 않는다).
                */}
                <p className="text-zinc-500 dark:text-zinc-500">
                  {step.intakeNumber ? `${step.intakeNumber} · ` : ""}v{step.sourceTemplateVersion} 실행 중 · {step.addedAt.slice(0, 10)}
                  {step.addedByName ? ` · ${step.addedByName}` : ""}
                </p>
                <p className="text-zinc-500 dark:text-zinc-500">
                  넣으면 연결 {summary.connectableEdgeCount}개가 함께 생깁니다.
                  {summary.waitingOnOtherFieldStepCount > 0 &&
                    ` 연결 ${summary.waitingOnOtherFieldStepCount}개는 아직 안 넣은 다른 현장 단계로 가는 선이라, 그쪽을 먼저 넣으면 이어집니다.`}
                  {summary.danglingEdgeCount > 0 &&
                    ` 연결 ${summary.danglingEdgeCount}개는 상대 작업이 이 초안에 없어 못 긋습니다 — 작업만 들어옵니다.`}
                </p>
                {canEdit ? (
                  <button
                    type="button"
                    onClick={() => void handleAdopt(step)}
                    disabled={adoptingId !== null}
                    className="self-start rounded-md bg-primary-900 px-2.5 py-1 text-xs font-medium text-white hover:bg-primary-800 disabled:opacity-50 dark:bg-primary-50 dark:text-zinc-900"
                  >
                    {adoptingId === step.executionNodeId ? "넣는 중..." : "절차에 넣기"}
                  </button>
                ) : (
                  <span className="text-zinc-400 dark:text-zinc-600">이 초안을 편집할 권한이 없어 넣을 수 없습니다.</span>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {adopted.length > 0 && (
        <div className="border-t border-zinc-200 pt-2 dark:border-zinc-800">
          <button
            type="button"
            onClick={() => setShowAdopted((v) => !v)}
            aria-expanded={showAdopted}
            className="text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
          >
            {showAdopted ? "▾" : "▸"} 이미 넣은 단계 {adopted.length}개
          </button>
          {showAdopted && (
            <ul className="mt-1 flex flex-col gap-1">
              {adopted.map((step) => (
                <li key={step.executionNodeId} className="rounded border border-zinc-100 p-1.5 text-zinc-500 dark:border-zinc-800 dark:text-zinc-500">
                  {step.title}
                  {step.intakeNumber ? ` · ${step.intakeNumber}` : ""}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
