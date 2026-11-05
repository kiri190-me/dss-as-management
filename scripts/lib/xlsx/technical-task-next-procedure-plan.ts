import type { ProcedureNodeType, ProcedureTemplateStatus } from "@/lib/domain/procedure-template-types";
import { isNextProcedureLinkAllowedOn } from "@/lib/domain/procedure-next-procedure-link";
import type { SheetExclusion, TechnicalTaskProcedurePlan } from "./technical-task-sheet-plan";

/**
 * ============================================================================
 * 잇기 단계의 **머리** — 무엇을 어디에 이을지 정하는 순수 함수들
 * ============================================================================
 * DB 에 안 붙는다. 들어오는 것은 ① 엑셀에서 읽은 「이 노드는 몇 번 절차를 가리킨다」
 * 와 ② DB 에서 읽어 온 사실(어떤 절차가 있고, 그 안에 어떤 노드가 있는가)뿐이고,
 * 나오는 것은 **한 줄씩의 판정**이다. 그래서 시험이 지어낸 값으로 전부 잴 수 있다.
 *
 * 🔴 **못 이은 것을 「없는 것」으로 만들지 않는다.** 모든 요청이 반드시 한 줄의
 * 판정으로 나온다(이음 · 이미 이어짐 · 건너뜀 + 까닭). 하나를 못 이었다고 멈추면
 * 나머지가 다 막히고, 조용히 빠뜨리면 「원래 안 이어지는 절차」와 구별되지 않는다.
 */

/** 엑셀이 말하는 「이 노드는 저 절차로 이어진다」 한 건. */
export type NextProcedureLinkRequest = {
  /** 이 노드가 들어 있는 절차의 이름. DB 에서 절차를 되찾는 열쇠다. */
  templateName: string;
  sourceWorksheet: string;
  /** `procedure_template_nodes` 의 (템플릿, 노드코드) 유일키 가운데 뒤쪽. */
  nodeCode: string;
  nodeTitle: string;
  /** 도형 글자의 `(번호)`. */
  stageNumber: string;
  /** 그 번호가 가리키는 절차의 이름. 계획에 그 번호가 없으면 null. */
  targetTemplateName: string | null;
  /** 가리키는 절차가 **만들지 않기로 한** 시트에서 나온 것인가. */
  targetExclusion: SheetExclusion | null;
};

type BuiltLike = {
  plan: Pick<TechnicalTaskProcedurePlan, "name" | "sourceWorksheet" | "excluded">;
  nodes: readonly { nodeCode: string; title: string; nextProcedureStageNumber: string | null }[];
};

/**
 * 엑셀에서 읽은 그래프들을 훑어 **이을 것 목록**을 만든다.
 *
 * 🔵 만들지 않기로 한 절차(`plan.excluded`)의 노드는 애초에 요청이 되지 않는다 —
 * 그 절차 자체가 DB 에 없다.
 */
export function planNextProcedureLinks(input: {
  built: readonly BuiltLike[];
  stageIndex: ReadonlyMap<string, TechnicalTaskProcedurePlan>;
}): NextProcedureLinkRequest[] {
  const requests: NextProcedureLinkRequest[] = [];
  for (const item of input.built) {
    if (item.plan.excluded) continue;
    for (const node of item.nodes) {
      if (node.nextProcedureStageNumber === null) continue;
      const target = input.stageIndex.get(node.nextProcedureStageNumber) ?? null;
      requests.push({
        templateName: item.plan.name,
        sourceWorksheet: item.plan.sourceWorksheet,
        nodeCode: node.nodeCode,
        nodeTitle: node.title,
        stageNumber: node.nextProcedureStageNumber,
        targetTemplateName: target?.name ?? null,
        targetExclusion: target?.excluded ?? null,
      });
    }
  }
  return requests;
}

/** DB 에서 읽어 온 절차 한 줄 — 잇는 데 필요한 것만. */
export type DbTemplateFact = {
  id: string;
  name: string;
  status: ProcedureTemplateStatus;
  /** 낙관적 동시성용. `updateProcedureTemplateNode` 가 그대로 받는다. */
  updatedAt: string;
};

/** DB 에서 읽어 온 노드 한 줄. */
export type DbNodeFact = {
  id: string;
  nodeCode: string;
  nodeType: ProcedureNodeType;
  nextProcedureTemplateId: string | null;
};

export type NextProcedureLinkStatus = "LINK" | "ALREADY_LINKED" | "SKIPPED";

export type NextProcedureLinkOutcome = {
  request: NextProcedureLinkRequest;
  status: NextProcedureLinkStatus;
  /** 사람이 읽을 까닭. 세 갈래 모두에 있다 — 「왜 이었나」도 적힌다. */
  reason: string;
  /** `status === "LINK"` 일 때만. 쓰기 쪽은 이 값만 보고 움직인다. */
  action: {
    nodeId: string;
    templateId: string;
    targetTemplateId: string;
    expectedTemplateUpdatedAt: string;
  } | null;
};

/**
 * 요청들을 DB 사실과 맞대어 **한 줄씩 판정**한다.
 *
 * `nodesByTemplateId` 는 절차 id → 그 절차의 노드들. 노드 코드는 절차 **안에서만**
 * 유일하므로(`procedure_template_nodes_template_code_unique`) 반드시 절차를 먼저
 * 고른 뒤 코드로 찾아야 한다 — 코드만으로 전역에서 찾으면 복제 절차끼리 섞인다.
 */
export function resolveNextProcedureLinks(input: {
  requests: readonly NextProcedureLinkRequest[];
  templatesByName: ReadonlyMap<string, DbTemplateFact>;
  nodesByTemplateId: ReadonlyMap<string, readonly DbNodeFact[]>;
}): NextProcedureLinkOutcome[] {
  const skip = (request: NextProcedureLinkRequest, reason: string): NextProcedureLinkOutcome => ({
    request,
    status: "SKIPPED",
    reason,
    action: null,
  });

  return input.requests.map((request) => {
    if (!request.targetTemplateName) {
      return skip(request, `(${request.stageNumber})번 절차가 계획에 없습니다 — 그 번호의 시트를 못 찾았습니다.`);
    }
    if (request.targetExclusion) {
      return skip(
        request,
        `가리키는 (${request.stageNumber})번 "${request.targetTemplateName}" 은(는) 만들지 않기로 한 절차입니다.`
      );
    }

    const template = input.templatesByName.get(request.templateName);
    if (!template) {
      return skip(request, `이 절차("${request.templateName}")가 아직 DB 에 없습니다 — 먼저 만들어야 합니다.`);
    }
    const target = input.templatesByName.get(request.targetTemplateName);
    if (!target) {
      return skip(
        request,
        `가리킬 절차("${request.targetTemplateName}")가 아직 DB 에 없습니다 — 그 시트를 먼저 만들어야 합니다.`
      );
    }
    // 🔴 자기 자신으로 잇지 않는다. 끝나자마자 같은 절차가 다시 열려 사람이
    //    빠져나올 자리가 없다. FK 는 이것을 막지 않는다.
    if (target.id === template.id) {
      return skip(request, "자기 자신을 가리킵니다 — 끝나자마자 같은 절차가 다시 열립니다.");
    }
    // 편집은 초안에서만 된다(assertEditableDraft). 게시본은 손대지 않는다.
    if (template.status !== "DRAFT") {
      return skip(request, `이 절차가 초안(DRAFT)이 아닙니다 — 지금 상태는 ${template.status} 입니다.`);
    }

    const node = (input.nodesByTemplateId.get(template.id) ?? []).find((n) => n.nodeCode === request.nodeCode);
    if (!node) {
      return skip(request, `노드 코드 "${request.nodeCode}" 를 이 절차에서 못 찾았습니다 — 엑셀이 바뀌었을 수 있습니다.`);
    }
    if (!isNextProcedureLinkAllowedOn(node.nodeType)) {
      return skip(request, `노드가 [종료]가 아닙니다(${node.nodeType}) — 이어가기는 종료 노드에만 답니다.`);
    }

    // 🔵 여러 번 돌려도 같은 결과여야 한다. 이미 같은 값이면 아무 일도 안 한다.
    if (node.nextProcedureTemplateId === target.id) {
      return { request, status: "ALREADY_LINKED", reason: `이미 "${target.name}" 로 이어져 있습니다.`, action: null };
    }
    // 🔴 **다른** 값이 들어 있으면 덮어쓰지 않는다. 사람이 편집기에서 손수 바꿔
    //    놓았을 수 있고, 그것을 말없이 되돌리면 아무 데도 안 남는다.
    if (node.nextProcedureTemplateId !== null) {
      return skip(
        request,
        `이미 다른 절차로 이어져 있습니다 — 덮어쓰지 않습니다(사람이 바꾼 값일 수 있습니다).`
      );
    }

    return {
      request,
      status: "LINK",
      reason: `(${request.stageNumber})번 "${target.name}" 로 잇습니다.`,
      action: {
        nodeId: node.id,
        templateId: template.id,
        targetTemplateId: target.id,
        expectedTemplateUpdatedAt: template.updatedAt,
      },
    };
  });
}

/** 세어서 찍기 — 「다 했다」와 「0건을 했다」가 구별돼야 한다. */
export function summarizeNextProcedureLinks(outcomes: readonly NextProcedureLinkOutcome[]): {
  total: number;
  toLink: number;
  alreadyLinked: number;
  skipped: number;
} {
  return {
    total: outcomes.length,
    toLink: outcomes.filter((o) => o.status === "LINK").length,
    alreadyLinked: outcomes.filter((o) => o.status === "ALREADY_LINKED").length,
    skipped: outcomes.filter((o) => o.status === "SKIPPED").length,
  };
}
