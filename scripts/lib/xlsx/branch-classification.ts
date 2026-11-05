import {
  procedureBranchTypeLabels,
  type ProcedureBranchType,
} from "@/lib/domain/procedure-template-types";

/**
 * Deterministic branch-label → branch_type mapping, matching exactly the
 * vocabulary found across the workbook's shape-graph sheets (Phase 1
 * report §5): NG (red label box) is by far the most common; YES/NO appear
 * on literal yes/no decision nodes; 정상/OK/O.K. appear rarely as an
 * explicit positive label where the source didn't leave it implicit. No
 * label at all is the default/continue path. Anything else found near an
 * edge is CUSTOM, not guessed at.
 */
export function classifyBranchLabel(labelText: string | null): {
  branchType: ProcedureBranchType;
  branchLabel: string | null;
} {
  if (!labelText) return { branchType: "DEFAULT", branchLabel: null };
  const t = labelText.trim();
  if (/^N\.?\s*G\.?$/i.test(t)) return { branchType: "NG", branchLabel: t };
  if (/^YES$/i.test(t)) return { branchType: "YES", branchLabel: t };
  if (/^NO$/i.test(t)) return { branchType: "NO", branchLabel: t };
  if (/^(정상|OK|O\.\s*K\.?)$/i.test(t)) return { branchType: "NORMAL", branchLabel: t };
  return { branchType: "CUSTOM", branchLabel: t };
}

/**
 * ============================================================================
 * 🔴 판단에서 갈라지는 분기의 이름을 **「정상」과 「NG」 둘로** 통일한다 (2026-11-05)
 * ============================================================================
 * 사용자 결정: 「판단에서 분기가 되는 연결선은 [정상] 혹은 [NG]를 사용하도록 해줘.」
 *
 * 위 `classifyBranchLabel` 은 **엑셀이 뭐라고 적었는지**를 그대로 돌려준다. 그래서
 * 들여온 결과에 같은 뜻이 `YES`·`O.K.` 로, `NG`·`N.G.`·`NO` 로 갈려 들어갔다
 * (실측: NG 92 · YES 5 · NO 4 · O.K. 1 · N.G. 1). 화면에서는 그 다섯이 **서로 다른
 * 갈래**로 보인다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 🔴 **이름만이 아니라 갈래(branch_type)도 함께 바꾼다**
 * ──────────────────────────────────────────────────────────────────────
 * 이름만 바꾸면 `procedure-visual-language.ts` 의 `EDGE_VISUAL_CONFIG` 가 갈래로
 * 색을 고르기 때문에 **「정상」이라 적힌 파란 선**(YES)과 **초록 선**(NORMAL)이,
 * **「NG」라 적힌 회색 점선**(NO)과 **빨간 점선**(NG)이 한 그림에 나란히 선다.
 * 절차 화면의 범례가 「빨강=NG, 파랑=YES, 초록=정상」이라고 적고 있어서, 글자만
 * 통일하면 **범례와 그림이 서로를 부정하는** 상태가 된다.
 *
 * 🔵 갈래를 바꿔도 갈래를 **읽는** 곳들은 그대로다(2026-11-05 실측):
 *   · `procedure-auto-layout.ts` 의 `procedureBranchContinuesMainFlow`
 *     — 참인 집합이 {DEFAULT, NORMAL, YES} 라 YES→NORMAL 은 참 그대로, NO→NG 는 거짓 그대로.
 *   · `procedure-edge-routing.ts` 의 `decisionBranchSourceHandle`
 *     — 왼쪽으로 나가는 집합이 {NO, NG} 라 NO→NG 는 왼쪽 그대로, YES→NORMAL 은 오른쪽 그대로.
 *   · `procedure-graph-structural-validation.ts` 의 `DECISION_ONLY_BRANCH_TYPES`
 *     ({YES,NO,NG,NORMAL}) · `DECISION_CONTINUE_BRANCH_TYPES` ({DEFAULT,NORMAL,YES})
 *     — 둘 다 이 바꿈에 **닫혀 있다**(안에 있던 것은 안에, 밖에 있던 것은 밖에).
 *
 * ──────────────────────────────────────────────────────────────────────
 * 🔴 왜 `classifyBranchLabel` 을 고치지 않고 **따로** 두는가
 * ──────────────────────────────────────────────────────────────────────
 * 그 함수는 **기존 FULL_SERVICE 들여오기**(`extract-shape-graph.ts`)도 함께 쓴다.
 * 그쪽에는 「YES 와 NO 가 **둘 다** 나가는 판단 노드는 정상 진행 경로가 이미 갖춰진
 * 것으로 본다」는 규칙이 있고(`hasCompleteYesNo`), `node-classification.ts` 도 YES·NO
 * 를 따로 센다. 거기서 YES→NORMAL·NO→NG 로 뭉개면 그 규칙이 **영영 한 번도 안
 * 걸리게** 되고, 오류 없이 경고만 늘어난다. 통일은 기술 작업 절차 쪽에서만 한다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 🔴 손대지 않는 둘 — **①에는 예외가 하나 있다**
 * ──────────────────────────────────────────────────────────────────────
 * ① **이 함수는 DEFAULT(이름 없는 분기)에 이름을 안 붙인다.** 글자 하나만 보고
 *    「정상」이라 적으면 엑셀에 없던 글자를 지어내는 일이 되고, TASK·INSPECTION·
 *    START 에서 **그냥 다음 단계로 가는** 선 113개가 통째로 「정상」이 된다.
 *
 *    🔴 **그러나 판단에서 NG 와 짝지어 갈라지는 자리는 예외다** — 사용자 원문이
 *    「**판단에서 분기가 되는 연결선은** [정상]혹은 [NG]를 사용하도록 해줘」이고,
 *    그 자리(실측 90곳)는 지금 빨간 NG 선 하나와 **아무 글자도 없는 회색 선** 하나가
 *    나간다. 그 회색 선이 사용자가 없애 달라고 한 바로 그것이다.
 *
 *    🔵 **그 예외는 여기서 못 정한다.** 이 함수는 글자 하나만 받으므로 「같은
 *    도형에서 NG 가 함께 나가는가」를 알 수 없다 — 형제 분기를 다 아는 자리,
 *    `extract-technical-task-graph.ts` 의 **5-3 절**이 조건 넷으로 가린다.
 *    원칙(①)은 여기 그대로 살아 있고, 예외는 거기 한 곳에만 있다.
 * ② **CUSTOM 은 그대로 둔다.** 「유상」·「무상」처럼 정상/NG 로 뭉갤 수 없는 진짜
 *    갈림이다. 🔵 다만 기술 작업 들여오기에서는 CUSTOM 이 **구조적으로 안 나온다** —
 *    어떤 도형을 분기 이름으로 볼지 고르는 `isBranchLabelText` 가 CUSTOM 을 분기
 *    어휘로 치지 않기 때문이다(글자 하나짜리 진짜 작업 상자를 이름으로 먹지 않으려고
 *    일부러 그렇게 뒀다). 그래도 이 갈래를 비워 두지 않는 까닭은, 나중에 그 문이
 *    열렸을 때 「전부 정상/NG 로 뭉개기」가 되지 않게 하려는 것이다.
 *
 * 🔵 통일된 글자는 `procedureBranchTypeLabels` 에서 가져온다 — 갈래의 이름을 두 벌로
 * 적어 두면 한쪽만 고치는 날이 오고, 타입이 같아 컴파일러는 아무 말도 하지 않는다.
 * 그 글자가 바뀌면 시험이 빨개지고 사람이 판단한다(branch-classification.test.ts).
 */
const UNIFIED_BRANCH_TYPE: Partial<Record<ProcedureBranchType, ProcedureBranchType>> = {
  YES: "NORMAL",
  NO: "NG",
};

export function classifyUnifiedBranchLabel(labelText: string | null): {
  branchType: ProcedureBranchType;
  branchLabel: string | null;
} {
  const raw = classifyBranchLabel(labelText);
  const branchType = UNIFIED_BRANCH_TYPE[raw.branchType] ?? raw.branchType;
  // 🔵 이 둘만 이름을 갈아 끼운다. DEFAULT·CUSTOM 은 위 「손대지 않는 둘」이고,
  //    RETRY·LOOP_BACK 은 애초에 `classifyBranchLabel` 이 돌려주지 않는다.
  if (branchType === "NORMAL" || branchType === "NG") return unifiedBranch(branchType);
  return raw;
}

/**
 * 통일된 이름을 단 갈래 한 벌.
 *
 * 🔵 **밖으로 꺼내 둔 까닭**: 이름 없던 선을 NG 의 짝으로 올리는 쪽
 * (`extract-technical-task-graph.ts` 5-3 절)은 **엑셀 글자가 아예 없는** 선을 다루므로
 * `classifyUnifiedBranchLabel` 을 부를 수가 없다. 그쪽이 「정상」을 제 손으로 적으면
 * 글자가 두 벌이 되고, 한쪽만 고치는 날 **한 그림 안에서** 이름이 갈린다.
 */
export function unifiedBranch(branchType: "NORMAL" | "NG"): {
  branchType: ProcedureBranchType;
  branchLabel: string;
} {
  return { branchType, branchLabel: procedureBranchTypeLabels[branchType] };
}

/**
 * Matches the two verified cross-stage restart references found in the
 * workbook (Phase 1 report §2): "(4)기본 정전 검사 과정부터 재진행 실시"
 * (stage 7's aging-test-failure loop-back) and "(4) 기본 정전 검사 재실시"
 * (stage 11's shipment-prep staleness loop-back). Both name the target
 * stage by its parenthesized number and end in 재진행/재실시 — this regex
 * matches that shared shape rather than either exact string, so it
 * generalizes to either wording without being so loose it fires on
 * unrelated text.
 */
const STAGE_RESTART_RE = /\((\d+)\)\s*([^\n]*?)\s*(?:과정부터\s*)?재(?:진행|실시)/;

export function matchStageRestartReference(
  text: string
): { stageNumber: string; stageLabelFragment: string } | null {
  const m = text.match(STAGE_RESTART_RE);
  if (!m) return null;
  return { stageNumber: m[1], stageLabelFragment: m[2].trim() };
}
