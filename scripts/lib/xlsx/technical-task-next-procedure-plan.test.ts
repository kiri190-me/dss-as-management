import { test } from "node:test";
import assert from "node:assert/strict";
import {
  planNextProcedureLinks,
  resolveNextProcedureLinks,
  summarizeNextProcedureLinks,
  type DbNodeFact,
  type DbTemplateFact,
  type NextProcedureLinkRequest,
} from "./technical-task-next-procedure-plan";
import { planProceduresForSheet } from "./technical-task-sheet-plan";

/**
 * 🔴 **지어낸 값만 쓴다.** 시트 이름도 도형 글자도 가짜다 — 베끼는 것은 구조뿐이다
 * (이 저장소는 공개이고 원본은 사내 업무 자료다).
 *
 * 여기서 재는 것은 **두 단계로 나눈 들여오기**다: 만들 때는 이어가기를 비워 두고,
 * 다 만든 뒤 이 판정으로 채운다. 절차끼리 가리키는 관계가 순환해서 한 번에 못 한다.
 */

const HEALTHY = { shapeCount: 8, connectorCount: 5 };

/** `(RFG) (N)…` 한 장의 계획 하나. */
function plan(stage: string, label: string, drawing = HEALTHY) {
  const plans = planProceduresForSheet(`(RFG) (${stage})${label}`, null, drawing);
  return plans[0];
}

function node(nodeCode: string, title: string, stage: string | null) {
  return { nodeCode, title, nextProcedureStageNumber: stage };
}

function template(id: string, name: string, overrides: Partial<DbTemplateFact> = {}): DbTemplateFact {
  return { id, name, status: "DRAFT", updatedAt: "2026-11-05T00:00:00.000Z", ...overrides };
}

function dbNode(id: string, nodeCode: string, overrides: Partial<DbNodeFact> = {}): DbNodeFact {
  return { id, nodeCode, nodeType: "END", nextProcedureTemplateId: null, ...overrides };
}

// ── ㉠ 만들기 쪽: 무엇이 「이을 것」으로 잡히는가 ──────────────────────────

test("🔴 `(번호)` 를 가리키는 노드만 이을 것이 된다 — 나머지는 요청조차 안 생긴다", () => {
  const source = plan("8", "가나다 연락");
  const target = plan("11", "라마바 준비");
  const requests = planNextProcedureLinks({
    built: [
      {
        plan: source,
        nodes: [node("rfg8-1", "사아자 작업", null), node("rfg8-9", "(11)라마바 준비", "11")],
      },
    ],
    stageIndex: new Map([["11", target]]),
  });

  assert.equal(requests.length, 1);
  assert.equal(requests[0].nodeCode, "rfg8-9");
  assert.equal(requests[0].templateName, "[RFG] 가나다 연락");
  assert.equal(requests[0].targetTemplateName, "[RFG] 라마바 준비");
  assert.equal(requests[0].targetExclusion, null);
});

test("가리키는 번호가 계획에 없으면 대상 이름이 비어 온다 — 그래도 요청은 남는다", () => {
  const requests = planNextProcedureLinks({
    built: [{ plan: plan("8", "가나다 연락"), nodes: [node("rfg8-9", "(99)없는 절차", "99")] }],
    stageIndex: new Map(),
  });
  assert.equal(requests.length, 1, "조용히 사라졌다 — 그러면 못 이은 것을 셀 수 없다");
  assert.equal(requests[0].targetTemplateName, null);
});

test("만들지 않기로 한 절차의 노드는 이을 것이 아니다 — 그 절차 자체가 DB 에 없다", () => {
  const excluded = plan("8", "가나다 연락", { shapeCount: 4, connectorCount: 0 });
  assert.ok(excluded.excluded, "본보기가 제외된 계획이 아니다 — 시험이 무뎌졌다");
  const requests = planNextProcedureLinks({
    built: [{ plan: excluded, nodes: [node("rfg8-9", "(11)라마바", "11")] }],
    stageIndex: new Map([["11", plan("11", "라마바 준비")]]),
  });
  assert.deepEqual(requests, []);
});

test("가리키는 쪽이 제외된 절차면 그 사실이 함께 실린다", () => {
  const target = plan("11", "라마바 준비", { shapeCount: 6, connectorCount: 0 });
  const requests = planNextProcedureLinks({
    built: [{ plan: plan("8", "가나다 연락"), nodes: [node("rfg8-9", "(11)라마바", "11")] }],
    stageIndex: new Map([["11", target]]),
  });
  assert.equal(requests[0].targetExclusion?.category, "NO_FLOWCHART");
});

// ── ㉡ 잇기 쪽: 판정 ──────────────────────────────────────────────────────

const SOURCE = template("t-source", "[RFG] 가나다 연락");
const TARGET = template("t-target", "[RFG] 라마바 준비");
const REQUEST: NextProcedureLinkRequest = {
  templateName: "[RFG] 가나다 연락",
  sourceWorksheet: "(RFG) (8)가나다 연락",
  nodeCode: "rfg8-9",
  nodeTitle: "(11)라마바 준비",
  stageNumber: "11",
  targetTemplateName: "[RFG] 라마바 준비",
  targetExclusion: null,
};

function resolveOne(
  overrides: {
    request?: Partial<NextProcedureLinkRequest>;
    templates?: DbTemplateFact[];
    nodes?: DbNodeFact[];
  } = {}
) {
  const templates = overrides.templates ?? [SOURCE, TARGET];
  const nodes = overrides.nodes ?? [dbNode("n-1", "rfg8-9")];
  const [outcome] = resolveNextProcedureLinks({
    requests: [{ ...REQUEST, ...overrides.request }],
    templatesByName: new Map(templates.map((t) => [t.name, t])),
    nodesByTemplateId: new Map([[SOURCE.id, nodes]]),
  });
  return outcome;
}

test("🔴 이을 수 있으면 **무엇을 어디에** 쓸지까지 돌려준다", () => {
  const outcome = resolveOne();
  assert.equal(outcome.status, "LINK");
  assert.deepEqual(outcome.action, {
    nodeId: "n-1",
    templateId: "t-source",
    targetTemplateId: "t-target",
    expectedTemplateUpdatedAt: "2026-11-05T00:00:00.000Z",
  });
});

test("🔵 여러 번 돌려도 같다 — 이미 같은 값이면 아무 일도 안 한다", () => {
  const outcome = resolveOne({ nodes: [dbNode("n-1", "rfg8-9", { nextProcedureTemplateId: "t-target" })] });
  assert.equal(outcome.status, "ALREADY_LINKED");
  assert.equal(outcome.action, null);
});

test("🔴 **다른** 절차로 이어져 있으면 덮어쓰지 않는다 — 사람이 바꾼 값일 수 있다", () => {
  const outcome = resolveOne({ nodes: [dbNode("n-1", "rfg8-9", { nextProcedureTemplateId: "t-남의것" })] });
  assert.equal(outcome.status, "SKIPPED");
  assert.ok(outcome.reason.includes("덮어쓰지 않습니다"));
});

test("🔴 못 이을 까닭이 갈래마다 **다른 말**로 나온다 — 그래야 무엇을 고칠지 안다", () => {
  const cases: [string, ReturnType<typeof resolveOne>][] = [
    ["대상 번호가 계획에 없음", resolveOne({ request: { targetTemplateName: null } })],
    [
      "대상이 제외된 절차",
      resolveOne({
        request: { targetExclusion: { category: "USER_EXCLUDED", detail: "사람이 뺐다" } },
      }),
    ],
    ["내 절차가 DB 에 없음", resolveOne({ templates: [TARGET] })],
    ["대상 절차가 DB 에 없음", resolveOne({ templates: [SOURCE] })],
    ["노드를 못 찾음", resolveOne({ nodes: [dbNode("n-1", "rfg8-다른코드")] })],
    ["노드가 종료가 아님", resolveOne({ nodes: [dbNode("n-1", "rfg8-9", { nodeType: "TASK" })] })],
    [
      "초안이 아님",
      resolveOne({ templates: [template("t-source", "[RFG] 가나다 연락", { status: "PUBLISHED" }), TARGET] }),
    ],
    [
      "자기 자신",
      resolveOne({ templates: [SOURCE, template("t-source", "[RFG] 라마바 준비")] }),
    ],
  ];

  for (const [label, outcome] of cases) {
    assert.equal(outcome.status, "SKIPPED", `${label}: 건너뛰어야 하는데 안 건너뛰었다`);
    assert.equal(outcome.action, null, `${label}: 건너뛰는데 쓸 거리를 돌려줬다`);
    assert.ok(outcome.reason.length > 0, `${label}: 까닭이 비었다`);
  }
  // 🔴 여덟 갈래의 까닭이 서로 달라야 한다. 한 낱말로 뭉치면 무엇을 고칠지 모른다.
  const reasons = cases.map(([, o]) => o.reason);
  assert.equal(new Set(reasons).size, reasons.length, `까닭이 겹친다:\n${reasons.join("\n")}`);
});

test("🔴 **모든 요청이 한 줄씩 나온다** — 조용히 빠지는 것이 없다", () => {
  const requests: NextProcedureLinkRequest[] = [
    REQUEST,
    { ...REQUEST, nodeCode: "rfg8-10", targetTemplateName: null },
    { ...REQUEST, nodeCode: "rfg8-11", templateName: "[RFG] 없는 절차" },
  ];
  const outcomes = resolveNextProcedureLinks({
    requests,
    templatesByName: new Map([SOURCE, TARGET].map((t) => [t.name, t])),
    nodesByTemplateId: new Map([[SOURCE.id, [dbNode("n-1", "rfg8-9"), dbNode("n-2", "rfg8-10")]]]),
  });

  assert.equal(outcomes.length, requests.length);
  assert.deepEqual(outcomes.map((o) => o.request.nodeCode), ["rfg8-9", "rfg8-10", "rfg8-11"]);
});

test("🔴 세어서 찍는다 — 「다 했다」와 「0건을 했다」가 구별된다", () => {
  const outcomes = resolveNextProcedureLinks({
    requests: [REQUEST, { ...REQUEST, nodeCode: "rfg8-10" }, { ...REQUEST, nodeCode: "rfg8-11" }],
    templatesByName: new Map([SOURCE, TARGET].map((t) => [t.name, t])),
    nodesByTemplateId: new Map([
      [
        SOURCE.id,
        [
          dbNode("n-1", "rfg8-9"),
          dbNode("n-2", "rfg8-10", { nextProcedureTemplateId: "t-target" }),
          dbNode("n-3", "rfg8-11", { nodeType: "TASK" }),
        ],
      ],
    ]),
  });

  assert.deepEqual(summarizeNextProcedureLinks(outcomes), {
    total: 3,
    toLink: 1,
    alreadyLinked: 1,
    skipped: 1,
  });
  // 아무것도 없을 때와 모양이 달라야 한다.
  assert.deepEqual(summarizeNextProcedureLinks([]), {
    total: 0,
    toLink: 0,
    alreadyLinked: 0,
    skipped: 0,
  });
});
