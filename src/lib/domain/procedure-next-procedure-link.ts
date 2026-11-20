import { procedureNodeTypeLabels, type ProcedureNodeType, type ProcedureTemplateStatus } from "./procedure-template-types";

/**
 * ============================================================================
 * 노드에서 **다른 절차로 이어가기** — 가리키는 규칙과 푸는 규칙 (2026-11-04)
 * ============================================================================
 * 줄기 B ④. 한 절차가 끝나면 다음 절차가 이어지는 경우가 실제로 있다
 * (예: 통전 검사가 끝나면 수리로). 그전까지는 사람이 목록으로 되돌아가
 * 다음 절차를 손으로 찾아 열어야 했다.
 *
 * 🔵 2026-11-20 에 **[작업]·[검사]·[조치] 노드에도 열었다**(같은 날 두 번에 나눠
 * 넓혔다 — 먼저 [작업], 그다음 [검사]·[조치]). 달 수 있는 자리가 늘었을 뿐
 * 아래 규칙은 한 줄도 안 바뀌었다 — 까닭과 뒤따르는 것은
 * `NEXT_PROCEDURE_LINK_NODE_TYPES` 바로 위에 적었다.
 *
 * ── 🔴 노드 종류를 늘리지 않았다 ────────────────────────────────────────
 * `procedure_template_node_type` 은 **닫힌 9값**이고, 스키마 주석이 「일부러
 * 닫았다」고 적고 있다. 열 번째 값을 더하면 「아홉·일곱·넷」이라는 갈래 수가
 * 코드·주석·시험 네 군데에 박혀 있어 전부 따라 고쳐야 한다. 그래서 대신
 * **END 노드에 칸 하나**(`next_procedure_template_id`)를 더했다. 비어 있으면
 * 지금까지와 한 치도 다르지 않게 동작한다 — 기존 END 는 한 행도 안 바뀐다.
 *
 * ── 🔴 가리키는 것은 「판」인데 푸는 것은 「계열」이다 (사용자 결정) ────
 * 칸에 담기는 값은 `procedure_templates.id` — 즉 **판 하나**다. FK 가 걸려야
 * 없는 절차를 가리키거나 오타가 들어가는 일을 DB 가 막아 주기 때문이다.
 * 그런데 **실행할 때는 그 값을 그대로 열지 않는다.** 그 행의 `code`(계열)를
 * 읽어 **그 계열의 지금 게시본**을 연다.
 *
 * 까닭: 절차는 계속 개정된다. 판을 콕 집어 두면 그 판이 [만료됨]으로 내려가는
 * 날 실행이 막히고, 그 절차를 가리키는 **모든 END 를 손으로 다시 지정**해야
 * 한다. 그날은 반드시 온다. 계열로 풀면 개정이 저절로 따라온다.
 *
 * 🔵 2026-11-04 에 게시가 같은 계열의 옛 게시본을 같은 트랜잭션에서 내리게
 * 됐다(procedure-template-publish-policy.ts). 그래서 **게시본이 둘인 계열은
 * 더 이상 새로 생기지 않는다.** 그래도 아래 resolve 는 둘 이상을 견딘다 —
 * 그 규칙이 생기기 전의 줄기가 운영에 남아 있고, 없는 셈 치면 그 계열에서만
 * 조용히 엉뚱한 판이 열린다.
 *
 * ── 🔴 「게시본 0개」는 **조용히 넘어가지 않는다** ──────────────────────
 * 전부 만료됐거나 초안만 있는 계열을 가리킬 수 있다. 그때 아무 일도 안 하고
 * 넘어가면, 사람은 **다음 절차가 원래 없는 줄 안다.** 가리켜 놨는데 안 열린
 * 것과 애초에 안 가리킨 것은 화면에서 구별되지 않는다. 그래서 푸는 쪽이
 * `reason` 을 돌려주고, 부르는 쪽이 그것을 사람에게 보인다.
 * ============================================================================
 */

/**
 * 이 칸을 달 수 있는 노드 종류.
 *
 * ── 2026-11-04 ~ 11-19 에는 **END 하나뿐**이었다 ────────────────────────
 * 그때 적어 둔 까닭을 그대로 옮긴다: 「🔴 END 하나뿐인 것이 알맹이다 — 중간
 * 노드에 달면 **「여기서 갈라져 나간다」**는 뜻이 되어 실행 순서가 통째로
 * 달라진다. 그건 이 조각이 하려는 일이 아니다(절차가 **끝난 뒤** 이어가기).」
 *
 * ── 🔵 2026-11-20 에 **[작업](TASK)도 연다**(사용자 요청) ───────────────
 * 뒤집은 까닭은 **실행 순서가 실제로는 안 달라지기 때문**이다. 이어가기는 이
 * 절차의 간선을 하나도 안 건드린다 — 다음 절차의 **실행을 따로 하나 더** 열 뿐이고
 * (completeAndStartNextProcedureAction 은 끝내기를 부르지 않는다), 이 절차의
 * 작업은 평소대로 완료되어 다음 단계로 간다. 그래서 「갈라져 나간다」는 걱정은
 * 뜻이 헷갈린다는 것이었지 동작이 달라진다는 것이 아니었다.
 *
 * 그리고 **작업을 하다 다른 절차서를 따라야 하는 경우가 실제로 있다** — 그 절차서가
 * 따로 있는데도 지금은 목록으로 되돌아가 손으로 찾아 열어야 한다. 그때 원래 절차는
 * 그대로 이어진다. 이것이 END 때와 똑같은 모양이라 창의 글자([완료하고 이어서
 * 시작])도 그대로 쓴다.
 *
 * ── 🔵 같은 날 **[검사]·[조치]까지 넓혔다**(사용자 요청) ────────────────
 * 쓰는 분이 위 [작업]이 열린 뒤 **「작업 노드인 줄 알고」** 기존 노드를 골랐는데
 * 「다음 절차」 칸이 안 떴다. 그 노드들이 [검사]·[조치]였다. 운영 실측으로
 * [조치] 420개 가운데 **33개는 제목에 「작업」이라는 말이 들어 있다**(사람이
 * 적은 제목이다 — [검사]는 0개). 그때까지 노드의 유형을 **글자로** 보여 주는
 * 자리가 캔버스에도 속성 패널 맨 위에도 없어서, 색과 모양만으로는 가려지지
 * 않았다. 그래서 같은 날 NodePropertyPanel 맨 위에 유형 딱지를 함께 세웠다.
 *
 * 🔴 **유형을 없애거나 [작업]에 합치는 길은 버렸다**(사용자 결정) — 운영 노드
 * 587개를 되돌릴 수 없게 바꾸고, 두 유형을 따로 다루는 코드와 엑셀 들여오기
 * 분류기가 함께 흔들린다. 대신 **허용 목록만 넓혔다.** 셋은 「한 단계를
 * 마치면서 다른 절차를 연다」는 **같은 뜻**이고, [작업]에서 참이던 말이
 * ([검사]·[조치]에서도) 한 글자도 안 바뀐다 — 간선을 하나도 안 건드리고,
 * 그 절차의 실행을 따로 하나 더 열 뿐이며, 이 절차는 다음 단계로 그대로 간다.
 * 실행 화면도 유형을 안 가린다([판단]만 [완료] 단추 자체가 없다).
 *
 * 🔴 **고리는 이것 때문에 훨씬 쉬워진다.** 절차 하나에 [작업]·[검사]·[조치]는
 * 여럿이라 A 의 한 단계가 B 를, B 의 한 단계가 A 를 가리키는 모양이 손쉽게
 * 생긴다. 그래서 아래 검증의 고리 찾기(reachesBack)와 그 밑자락을 모으는 쪽
 * (mutations/procedure-next-procedure-link-context.ts)이 **노드 종류를 안 가리고**
 * 돌아야 한다 — 그쪽은 `next_procedure_template_id IS NOT NULL` 만 보고 모은다.
 * 유형으로 안 거르는 것이 거기서는 **일부러 그런 것**이다.
 *
 * ── 🔵 남아서 막히는 것은 **다섯**이다 ─────────────────────────────────
 * [시작]·[판단]·[체크리스트]·[고장 진단표]·[문서 참조]. 까닭이 한 가지가 아니다:
 *  · [판단] — 갈래를 고르는 단추와 이어가기를 묻는 창이 **한 자리에 겹친다**.
 *    CurrentTaskCard 는 `!isDecision` 일 때만 [완료]를 그리므로(갈래 고르기가 곧
 *    완료다) 물을 자리 자체가 없다.
 *  · [시작] — 아직 아무 일도 안 한 자리다. 실행을 만들 때 시스템이 바로 완료로
 *    차고 사람이 시작·완료할 수 없다(isSystemEntryNodeType).
 *  · [문서 참조] — 실행 행이 **아예 안 생긴다**(isExecutableNodeType 이 유일하게
 *    뺀 값). 완료라는 사건이 없으니 그때 물을 수도 없다.
 *  · [체크리스트]·[고장 진단표] — 위 셋과 달리 **막아야 할 까닭이 있어서가
 *    아니다.** 둘은 실행 행도 생기고 [완료] 단추도 그려진다. 다만 열어 달라는
 *    요청이 없었고, 속 내용이 딴 표에 사는 그릇이라 편집기가 새로 만드는 것조차
 *    막고 있다(MANUAL_TECHNICAL_NODE_TYPE_CODES). 필요해지면 이 목록에 더하는
 *    것으로 끝난다 — 아래 규칙은 그대로다.
 */
export const NEXT_PROCEDURE_LINK_NODE_TYPES = [
  "END",
  "TASK",
  "INSPECTION",
  "CORRECTIVE_ACTION",
] as const satisfies readonly ProcedureNodeType[];

export function isNextProcedureLinkAllowedOn(nodeType: ProcedureNodeType): boolean {
  return (NEXT_PROCEDURE_LINK_NODE_TYPES as readonly ProcedureNodeType[]).includes(nodeType);
}

/**
 * 「여기엔 못 단다」고 사람에게 하는 말. 🔴 **글자를 박지 않고 위 상수에서 짓는다** —
 * 전에는 "[종료] 노드에만" 이 세 군데(여기 · 저장 거절 · 잇기 스크립트)에 따로
 * 박혀 있었고, 노드 종류를 하나 열자 **세 곳이 전부 거짓말이 됐다.**
 */
export const NEXT_PROCEDURE_LINK_NOT_ALLOWED_MESSAGE = `「다음 절차」는 ${NEXT_PROCEDURE_LINK_NODE_TYPES.map(
  (t) => `[${procedureNodeTypeLabels[t]}]`
).join("·")} 노드에만 지정할 수 있습니다.`;

export type ProcedureNodeNextLink = {
  nodeCode: string;
  nodeType: ProcedureNodeType;
  /** 비어 있으면 「이어갈 절차 없음」 — 지금까지의 END 와 똑같다. */
  nextProcedureTemplateId: string | null;
};

/**
 * 달 수 없는 유형인데 값이 들어 있는 노드들. 🔵 **빈 배열이 정상**이다.
 *
 * DB 는 이것을 막지 못한다 — 「END 일 때만 NOT NULL 이 아니다」는 CHECK 로
 * 적을 수야 있지만, 이 저장소에서 drizzle 의 sql 템플릿에 상수를 넣으면
 * 바인딩 자리($1)로 구워져 **돌릴 수 없는 마이그레이션**이 나온 적이 있다.
 * 그래서 막는 자리를 코드로 가져왔다. 쓰는 쪽은 둘이다 — 저장할 때(쓰기를
 * 거절)와 검증할 때(사람에게 보임).
 */
export function findMisplacedNextProcedureLinks<T extends ProcedureNodeNextLink>(
  nodes: readonly T[]
): T[] {
  return nodes.filter(
    (node) => node.nextProcedureTemplateId !== null && !isNextProcedureLinkAllowedOn(node.nodeType)
  );
}

/** 계열을 풀 때 필요한 만큼만. 조회가 넘기는 행이 이보다 클 수 있다. */
export type ProcedureSeriesCandidate = {
  id: string;
  code: string;
  version: number;
  status: ProcedureTemplateStatus;
};

export type NextProcedureResolution =
  | { ok: true; templateId: string; version: number }
  | { ok: false; reason: string };

/**
 * 가리킨 계열에서 **지금 열어야 할 판**을 고른다.
 *
 * `candidates` 는 **그 계열(code)의 살아 있는 판 전부**다. 지워진 행(휴지통)은
 * 부르는 쪽이 이미 걸러서 넘긴다 — 여기서 다시 거르지 않는다. 🔴 거르는 잣대가
 * 둘이 되면, 화면은 열린다고 하고 조회는 빈손으로 오는 날이 온다.
 */
export function resolveNextProcedureTarget(input: {
  /** 칸에 담긴 값이 가리키는 판. 그 판 자체를 여는 것이 아니라 **계열을 읽는 데** 쓴다. */
  pointedTemplate: ProcedureSeriesCandidate | null;
  candidates: readonly ProcedureSeriesCandidate[];
}): NextProcedureResolution {
  if (!input.pointedTemplate) {
    // FK 가 있으니 보통은 안 생긴다. 그래도 조회가 휴지통 행을 걸러 내면
    // 가리킨 판만 쏙 빠질 수 있다 — 그때 조용히 넘어가지 않는다.
    return { ok: false, reason: "이어갈 절차를 찾을 수 없습니다 — 가리킨 절차가 삭제되었을 수 있습니다." };
  }

  const series = input.candidates.filter((row) => row.code === input.pointedTemplate!.code);
  const published = series.filter((row) => row.status === "PUBLISHED");

  if (published.length === 0) {
    return {
      ok: false,
      reason:
        "이어갈 절차에 게시본이 없습니다 — 그 절차를 게시한 뒤에 이어집니다. (초안만 있거나 모든 판이 만료되었습니다)",
    };
  }

  // 🔵 둘 이상은 이제 새로 안 생긴다(머리말). 남아 있는 옛 줄기에서는 **판
  //    번호가 가장 큰 것**을 고른다 — 목록·상세가 「최신 판」을 말할 때 쓰는
  //    기준과 같다. 여기서만 다른 기준을 쓰면 화면과 실행이 어긋난다.
  const chosen = published.reduce((best, row) => (row.version > best.version ? row : best));
  return { ok: true, templateId: chosen.id, version: chosen.version };
}

/**
 * ============================================================================
 * 이어가기 **검증** (2026-11-04, 줄기 B ④ 조각 ③)
 * ============================================================================
 * 여기서 내는 결과는 편집기의 [검증]과 게시 관문이 쓴다. 규칙을 위 resolve 와
 * **같은 파일**에 두는 까닭은, 「실행할 때 무엇이 막히는가」와 「게시 전에 무엇을
 * 알려 주는가」가 어긋나면 안 되기 때문이다 — 막히는데 안 알려 주거나, 안 막히는데
 * 막는다고 적는 일이 생긴다.
 *
 * ── 🔴 무엇이 ERROR 이고 무엇이 WARNING 인가 ───────────────────────────
 * **ERROR(게시를 막는다)** — 사람이 고칠 길이 이 절차 안에 있고, 그냥 두면 실행이
 * 반드시 깨지는 것:
 *   · 달 수 없는 유형의 노드에 지정이 남아 있다(화면에 고치는 칸이 안 그려지는 상태).
 *   · 가리킨 판이 사라졌다.
 *   · 자기 계열을 가리킨다 — 같은 절차가 또 열려 빠져나올 수 없다.
 *
 * **WARNING(알리되 막지 않는다)** — 지금 이 절차만으로는 고칠 수 없는 것:
 *   · 가리킨 계열에 게시본이 없다.
 *   · 다른 절차를 거쳐 이 절차로 **돌아오는 고리**가 있다(A→B→A).
 *
 * 🔴 **둘을 ERROR 로 올리면 안 된다.** A 의 END 가 B 를, B 의 END 가 A 를
 * 가리키고 둘 다 아직 초안이면, 「가리킨 쪽에 게시본이 있어야 한다」가 ERROR 일 때
 * **어느 쪽도 먼저 게시할 수 없다.** 서로를 기다리며 영영 막힌다. 고리도 마찬가지로
 * 서버가 무한 반복에 빠지는 종류가 아니다 — 사람이 매번 작업을 진행해야 다음
 * 실행이 생긴다. 다만 되풀이하면 실행 행이 쌓이므로 알리기는 한다.
 * ============================================================================
 */

/** 가리킨 판 하나에 대해 검증이 알아야 하는 것. 조회가 채워서 넘긴다. */
export type NextProcedureTargetInfo = {
  /** 그 판이 속한 계열. 자기 계열인지 · 고리인지를 이 값으로 가른다. */
  code: string;
  /** 사람에게 보일 이름. 「어느 절차가 문제인지」를 글에 적는다. */
  name: string;
  /** 그 계열에 지금 게시본이 있는가. 없으면 실행이 그 자리에서 막힌다. */
  hasPublishedVersion: boolean;
};

export type NextProcedureLinkValidationContext = {
  /** 지금 검증하는 절차의 계열 코드. */
  thisCode: string;
  /** key 는 노드에 담긴 next_procedure_template_id 값 그대로. */
  targets: Map<string, NextProcedureTargetInfo>;
  /**
   * 계열과 계열 사이의 이어가기 **전부**. 고리를 찾는 데만 쓴다.
   * 🔵 이 절차에서 나가는 것만 넘기면 A→B→A 를 못 본다 — B→A 는 B 의 노드에
   * 적혀 있기 때문이다. 그래서 조회가 전부를 모아 넘긴다.
   *
   * 🔴 **노드 종류로 거르지 않은 것을 넘겨야 한다**(2026-11-20). [작업]·[검사]·
   * [조치]에도 칸이 열리면서 한 절차가 여러 곳에서 나갈 수 있게 됐다 — 모으는 쪽이
   * END 만 훑으면 중간 노드로 돌아오는 고리를 통째로 못 본다. 지금 모으는 쪽은
   * `next_procedure_template_id IS NOT NULL` 만 본다.
   */
  seriesLinks: readonly { fromCode: string; toCode: string }[];
};

export type NextProcedureLinkIssue = {
  severity: "ERROR" | "WARNING";
  nodeId: string;
  message: string;
};

/**
 * 이 절차에서 나가는 계열을 따라가, **이 절차로 돌아오는지** 본다.
 * 🔵 이미 본 계열을 다시 안 밟으므로 고리가 있어도 멈춘다.
 */
function reachesBack(
  fromCode: string,
  thisCode: string,
  seriesLinks: readonly { fromCode: string; toCode: string }[]
): boolean {
  const seen = new Set<string>([fromCode]);
  const queue: string[] = [fromCode];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const link of seriesLinks) {
      if (link.fromCode !== current) continue;
      if (link.toCode === thisCode) return true;
      if (seen.has(link.toCode)) continue;
      seen.add(link.toCode);
      queue.push(link.toCode);
    }
  }
  return false;
}

/**
 * 검증이 노드에서 보는 것 — **id · 유형 · 지정** 셋뿐이다.
 * 🔵 `nodeCode` 를 요구하지 않는다: 구조 검증이 읽는 노드 행에는 그 칸이 없고,
 * 있어야 할 까닭도 없다(문제를 짚을 때 쓰는 것은 id 다).
 */
export type NextProcedureLinkValidationNode = {
  id: string;
  nodeType: ProcedureNodeType;
  nextProcedureTemplateId: string | null;
};

export function validateNextProcedureLinks<T extends NextProcedureLinkValidationNode>(
  nodes: readonly T[],
  context: NextProcedureLinkValidationContext
): NextProcedureLinkIssue[] {
  const issues: NextProcedureLinkIssue[] = [];

  for (const node of nodes) {
    const targetId = node.nextProcedureTemplateId;
    if (targetId === null) continue;

    if (!isNextProcedureLinkAllowedOn(node.nodeType)) {
      issues.push({
        severity: "ERROR",
        nodeId: node.id,
        message: `${NEXT_PROCEDURE_LINK_NOT_ALLOWED_MESSAGE} 이 노드의 유형을 그중 하나로 되돌리거나, 지정을 지우세요.`,
      });
      continue;
    }

    const target = context.targets.get(targetId);
    if (!target) {
      issues.push({
        severity: "ERROR",
        nodeId: node.id,
        message: "「다음 절차」로 지정된 절차를 찾을 수 없습니다 — 삭제되었을 수 있습니다. 다시 지정하세요.",
      });
      continue;
    }

    if (target.code === context.thisCode) {
      issues.push({
        severity: "ERROR",
        nodeId: node.id,
        // 🔵 [작업]에도 달 수 있게 된 뒤로 「끝나자마자」가 늘 참은 아니다 —
        //    작업 노드에서는 절차 한가운데서 같은 절차가 또 열린다. 그래서
        //    일어나는 자리를 안 박고 **무슨 일이 생기는지**만 적는다.
        message:
          "「다음 절차」가 이 절차 자신을 가리킵니다. 같은 절차가 또 열려 빠져나올 수 없습니다.",
      });
      continue;
    }

    if (!target.hasPublishedVersion) {
      issues.push({
        severity: "WARNING",
        nodeId: node.id,
        message: `「다음 절차」로 지정한 "${target.name}"에 게시본이 없습니다 — 그 절차를 게시하기 전까지는 여기서 이어지지 않습니다.`,
      });
    }

    if (reachesBack(target.code, context.thisCode, context.seriesLinks)) {
      issues.push({
        severity: "WARNING",
        nodeId: node.id,
        // 🔵 사람이 읽는 글이다 — 별표 같은 꾸밈 글자를 넣지 않는다. 이 글은
        //    화면에 그대로 찍히므로 별표가 별표로 보인다.
        message: `"${target.name}"을(를) 따라가면 이 절차로 되돌아옵니다. 되풀이해도 저절로 멈추지는 않습니다 — 사람이 매번 진행해야 다음이 열립니다.`,
      });
    }
  }

  return issues;
}
