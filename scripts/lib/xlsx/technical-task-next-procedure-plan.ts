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

/**
 * ============================================================================
 * 🔴 지우기 전에 **끊어야 하는 이어가기**를 가린다 (2026-11-05)
 * ============================================================================
 * `--replace` 로 옛 초안을 지우려 했더니 외래키가 막았다(실측):
 * ```
 * 실패: Failed query: delete from "procedure_templates" where "id" = $1
 * ```
 * `[RFG] 고객 연락` 의 종료 노드가 `next_procedure_template_id` 로 `[RFG] 출하 준비`
 * 를 가리키고 있었고, 그 칸은 `onDelete: "restrict"` 다.
 *
 * 🔵 **그 막음은 결함이 아니라 의도된 보호**다(2026-11-04). 조용히 지워졌다면 그
 * 참조가 깨진 채로 남는다. 🔴 **지우는 차례를 바꾸는 것으로는 못 푼다** — 둘이
 * 서로를 가리키는 모양이 생기고, 나중에는 순환까지 생긴다((8)→(9)→(8)).
 *
 * 그래서 **지우기 전에 참조를 끊는다.** 다만 두 가지를 반드시 가른다:
 *   - 가리키는 노드가 **이번에 함께 지울 절차 안**에 있다 → 끊어도 된다
 *     (어차피 같이 지워지고 다시 만들어진다)
 *   - 🔴 **지울 목록 밖**에 있다(사람이 손으로 만든 절차 · 게시본 · 다른 묶음)
 *     → **끊으면 안 된다.** 조용히 끊으면 남의 절차가 망가지고, 그 사람은 자기가
 *     이어 둔 것이 왜 사라졌는지 영영 모른다.
 */

/** 「누가 누구를 가리키는가」 한 줄 — DB 에서 읽어 넘긴다. */
export type NextProcedureReference = {
  nodeId: string;
  nodeCode: string;
  /** 그 노드가 **들어 있는** 절차. */
  ownerTemplateId: string;
  ownerTemplateName: string;
  /** 그 노드가 **가리키는** 절차(= 지우려는 것). */
  targetTemplateId: string;
  targetTemplateName: string;
};

export type NextProcedureUnlinkPlan = {
  /** 끊어도 되는 것 — 가리키는 쪽도 이번에 함께 지워진다. */
  toUnlink: NextProcedureReference[];
  /** 🔴 끊으면 안 되는 것 — 하나라도 있으면 **지우지 말고 멈춰야** 한다. */
  blocking: NextProcedureReference[];
};

export function planNextProcedureUnlinks(input: {
  references: readonly NextProcedureReference[];
  /** 이번에 지울 절차의 id 들. */
  victimTemplateIds: readonly string[];
}): NextProcedureUnlinkPlan {
  const victims = new Set(input.victimTemplateIds);
  const toUnlink: NextProcedureReference[] = [];
  const blocking: NextProcedureReference[] = [];
  for (const reference of input.references) {
    // 🔵 가리켜지는 쪽이 지울 목록에 없으면 애초에 막을 일이 없다 — 지나간다.
    if (!victims.has(reference.targetTemplateId)) continue;
    if (victims.has(reference.ownerTemplateId)) toUnlink.push(reference);
    else blocking.push(reference);
  }
  return { toUnlink, blocking };
}

/** 멈출 때 사람에게 보여 줄 글 — **무엇이 무엇을 가리키는지 이름으로**. */
export function formatBlockingReferences(blocking: readonly NextProcedureReference[]): string {
  return [
    `🔴 지울 수 없습니다 — 지울 목록 **밖**의 절차가 ${blocking.length}곳에서 가리키고 있습니다.`,
    ...blocking.map(
      (b) =>
        `   "${b.ownerTemplateName}" 의 노드 ${b.nodeCode} → "${b.targetTemplateName}"`
    ),
    "   그 이어가기를 말없이 끊으면 남의 절차가 망가집니다. 화면에서 먼저 푸시거나,",
    "   가리키는 절차까지 함께 지울 대상에 넣으세요.",
  ].join("\n");
}

/**
 * ============================================================================
 * 🔴 이은 뒤 **거짓이 된 메모**를 고른다 (2026-11-05)
 * ============================================================================
 * 만들기 단계는 「이어갈 절차를 아직 비워 두었습니다」를
 * `procedure_template_validation_issues` 한 줄로 남긴다. 🔴 **잇기가 그 참조를
 * 채우면 그 줄은 거짓이 된다.** 사용자가 [검증 이슈] 화면에서 발견했다 — 이미
 * 이어져 있는데 「아직 비워 뒀다」가 떠 있었다.
 *
 * 🔴 **같은 노드에 달린 다른 메모는 남겨야 한다.** 같은 갈래
 * (`INVALID_NEXT_PROCEDURE_LINK`)라도 「대괄호 안에 번호가 둘이라 첫 번째를 썼다」는
 * **영구히 참**이고, 「나가는 분기를 버렸다」는 `connector#…` 를 가리켜 아예 다른
 * 자리다. 뜻이 다른 것을 한 번에 쓸어 담으면 **원본과 달라진 까닭이 사라진다.**
 */

/**
 * 이 판정에서 **메모를 치워야 하는가.**
 *
 * 🔴 「이미 이어져 있었음」도 치운다 — 중간에 끊겼다 다시 이은 경우 참조는 채워져
 * 있고 메모만 남아 있다. 「방금 이은 것」만 치우면 샌다.
 * 🔵 **못 이은 건은 안 치운다.** 그 메모는 아직 참이다.
 */
export function outcomeNeedsPendingMemoCleanup(outcome: NextProcedureLinkOutcome): boolean {
  if (outcome.status === "ALREADY_LINKED") return true;
  return outcome.status === "LINK" && outcome.action !== null;
}

/** DB 에서 읽어 온 검증 메모 한 줄 — 고르는 데 필요한 것만. */
export type TemplateValidationMemo = {
  id: string;
  issueType: string;
  sourceReference: string | null;
  message: string;
};

/**
 * 이 노드의 **「아직 비워 뒀다」 메모**만 골라 그 id 를 돌려준다.
 *
 * 세 가지가 **모두** 맞아야 고른다 — 갈래 · 그 노드를 가리킴 · 표식이 든 글.
 */
export function selectStalePendingLinkMemoIds(input: {
  memos: readonly TemplateValidationMemo[];
  nodeCode: string;
  /** `extract-technical-task-graph.ts` 의 `PENDING_NEXT_PROCEDURE_MEMO_MARKER`. */
  pendingMarker: string;
}): string[] {
  const reference = `node:${input.nodeCode}`;
  return input.memos
    .filter(
      (memo) =>
        memo.issueType === "INVALID_NEXT_PROCEDURE_LINK" &&
        memo.sourceReference === reference &&
        memo.message.includes(input.pendingMarker)
    )
    .map((memo) => memo.id);
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
