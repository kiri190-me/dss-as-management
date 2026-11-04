import "server-only";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { procedureTemplateNodes, procedureTemplates } from "../schema";
import type { Tx } from "./procedure-templates";
import type { NextProcedureLinkValidationContext } from "@/lib/domain/procedure-next-procedure-link";

/**
 * ============================================================================
 * [종료]의 「다음 절차」 검증에 필요한 **바깥 사실** 모으기 (2026-11-04, 줄기 B ④ 조각 ③)
 * ============================================================================
 * 🔴 **왜 제 파일로 떼어 놓았나** — 부르는 곳이 **둘**이고, 그 둘이 서로를
 * import 할 수 없다:
 *   · 편집기의 [검증](procedure-template-editor.ts 의 runStructuralValidation)
 *   · **게시 관문**(procedure-templates.ts 의 publishProcedureTemplate)
 * 편집기 쪽이 이미 procedure-templates.ts 에서 resolveEligibleActor 를 가져다
 * 쓰므로, 거꾸로 가져가면 고리가 된다. 한쪽에만 두면 **게시가 검증을 맥락 없이
 * 부르게 되고**, 그러면 ERROR 를 내 놓고도 게시가 그냥 통과한다 — 실제로 이
 * 조각을 만들다 그 상태를 한 번 거쳤다.
 *
 * 🔴 **고리를 찾으려면 계열 전부를 봐야 한다.** 이 절차에서 나가는 것만 모으면
 * A→B→A 를 못 본다 — B→A 는 B 의 노드에 적혀 있기 때문이다.
 *
 * 🔵 비용은 작다. 이 칸은 거의 모든 행에서 비어 있고(실측 2026-11-04: 노드
 * 666행 중 0행), 그 조건에 부분 인덱스가 걸려 있다(마이그레이션 0123).
 * 지정이 하나도 없으면 바깥 조회를 **아예 안 한다**.
 * ============================================================================
 */
export async function loadNextProcedureLinkContext(
  tx: Tx,
  templateId: string,
  nodes: readonly { nextProcedureTemplateId: string | null }[]
): Promise<NextProcedureLinkValidationContext | undefined> {
  const pointedIds = [
    ...new Set(nodes.map((n) => n.nextProcedureTemplateId).filter((id): id is string => id !== null)),
  ];
  // 🔵 `undefined` 는 「문제 없음」이 아니라 **「볼 것이 없음」**이다. 지정이
  //    하나도 없으면 이 갈래의 어떤 규칙도 성립할 수 없으므로 같은 뜻이 된다.
  if (pointedIds.length === 0) return undefined;

  const [thisTemplate] = await tx
    .select({ code: procedureTemplates.code })
    .from(procedureTemplates)
    .where(eq(procedureTemplates.id, templateId));
  if (!thisTemplate) return undefined;

  // 가리켜진 판들 — 계열(code)과 이름을 읽는다.
  const pointedRows = await tx
    .select({ id: procedureTemplates.id, code: procedureTemplates.code, name: procedureTemplates.name })
    .from(procedureTemplates)
    .where(inArray(procedureTemplates.id, pointedIds));

  // 그 계열들에 지금 게시본이 있는가.
  // 🔴 휴지통 행은 세지 않는다 — 실행이 실제로 여는 길과 **같은 잣대**여야 한다.
  //    여기서만 세면 "검증은 괜찮다는데 실행은 막히는" 절차가 나온다.
  const pointedCodes = [...new Set(pointedRows.map((r) => r.code))];
  const publishedRows =
    pointedCodes.length === 0
      ? []
      : await tx
          .select({ code: procedureTemplates.code })
          .from(procedureTemplates)
          .where(
            and(
              inArray(procedureTemplates.code, pointedCodes),
              eq(procedureTemplates.status, "PUBLISHED"),
              eq(procedureTemplates.isDeleted, false)
            )
          );
  const codesWithPublished = new Set(publishedRows.map((r) => r.code));

  const targets = new Map(
    pointedRows.map((r) => [
      r.id,
      { code: r.code, name: r.name, hasPublishedVersion: codesWithPublished.has(r.code) },
    ])
  );

  // 계열 사이의 이어가기 전부 — 고리 찾기에만 쓴다.
  const owner = alias(procedureTemplates, "link_owner");
  const target = alias(procedureTemplates, "link_target");
  const seriesLinks = await tx
    .select({ fromCode: owner.code, toCode: target.code })
    .from(procedureTemplateNodes)
    .innerJoin(owner, eq(procedureTemplateNodes.procedureTemplateId, owner.id))
    .innerJoin(target, eq(procedureTemplateNodes.nextProcedureTemplateId, target.id))
    .where(isNotNull(procedureTemplateNodes.nextProcedureTemplateId));

  return { thisCode: thisTemplate.code, targets, seriesLinks };
}
