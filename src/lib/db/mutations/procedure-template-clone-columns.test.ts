import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getTableColumns } from "drizzle-orm";

import { procedureTemplateNodes, procedureTemplateEdges } from "@/lib/db/schema";

/**
 * 새 DRAFT 버전이 **부모의 칸을 하나도 안 흘리는가** (2026-11-03, 줄기 B-⑤).
 *
 * ── 왜 이 시험이 있는가 ─────────────────────────────────────────────────
 * createNewDraftVersion 은 노드·연결선을 **칸을 손으로 하나씩 적어** 복제한다.
 * 그래서 나중에 칸이 하나 늘면 복제 목록에 적는 것을 잊기 쉽고, 잊어도
 * **아무 오류가 안 난다** — 그 칸만 기본값(대개 null)으로 조용히 떨어진다.
 *
 * 실제로 그렇게 됐다. Phase 4A/4B 가 더한 배치 세 칸(노드의 user_position_x/y,
 * 연결선의 user_route_points)이 복제 목록에 없어서, 게시된 절차로 새 초안을
 * 만들면 **사람이 끌어 놓은 배치가 통째로 사라졌다.** 개발 DB 실측: 「기본 통전
 * 검사 (3상 입력)」 v1(PUBLISHED)은 28/28 노드에 자리 값이 있는데, 거기서 나온
 * v2(DRAFT)는 0/28 이었다.
 *
 * ── 무엇을 재는가 ───────────────────────────────────────────────────────
 * 「배치 칸이 들어갔나」만 재면 다음 칸이 생기는 날 또 같은 일이 난다. 그래서
 * **스키마의 칸 목록 전체**와 복제 목록을 맞댄다 — 칸이 늘면 이 시험이 먼저
 * 깨지고, 깨진 사람은 복제할지 말지를 **정해서** 아래 목록에 적게 된다.
 *
 * 🔴 일부러 안 복제하는 칸은 여기 이름으로 적는다. 그래야 「빠뜨린 것」과
 * 「안 하기로 한 것」이 갈린다.
 *
 * ── 🔵 이것은 진짜 복제를 돌려 보는 시험이 아니다 ──────────────────────
 * 실제 INSERT 결과를 보는 시험은 DB 목록에 있다
 * (procedure-templates.integration.test.ts · procedure-template-editor
 * .integration.test.ts 32번). 이 파일은 DB 없이 `npm test` 에서 도는 값싼
 * 그물이다 — 칸이 늘어나는 순간을 잡는 데는 그쪽보다 이쪽이 낫다. 그쪽은
 * 「이 값이 따라왔나」를 재고, 이쪽은 「적는 것을 잊지 않았나」를 잰다.
 */

const sourcePath = new URL("./procedure-templates.ts", import.meta.url);
const source = readFileSync(sourcePath, "utf8");

/**
 * 복제 목록은 주석이 길다(까닭을 그 자리에 적는 저장소다). 주석을 안 걷으면
 * 주석에 적힌 칸 이름이 「적혀 있다」로 세어져 시험이 공짜로 통과한다.
 */
function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split(/\r?\n/)
    .filter((line) => !/^\s*\/\//.test(line))
    .join("\n");
}

/**
 * `anchor` 로 시작하는 객체 리터럴 하나를 통째로 떼어 낸다 — 중괄호를 세어
 * 끝을 찾으므로, 안쪽에 중첩 객체가 생겨도 엉뚱한 곳에서 안 끊긴다.
 *
 * `nestedAnchor` 는 **블록 몸통 안의 `return { … }`** 을 집을 때 쓴다(가져오기
 * 쪽 연결선이 그 모양이다). 없으면 anchor 바로 뒤의 중괄호를 집는다.
 */
function objectLiteralAfter(anchor: string, nestedAnchor?: string): string {
  const start = source.indexOf(anchor);
  assert.notEqual(start, -1, `복제 목록의 시작(${anchor})을 못 찾았다 — 경로나 모양이 바뀌었다`);
  const from = nestedAnchor ? source.indexOf(nestedAnchor, start) : start + anchor.length - 1;
  assert.notEqual(from, -1, `${anchor} 안에서 ${nestedAnchor} 를 못 찾았다`);
  const openBrace = source.indexOf("{", from);
  assert.notEqual(openBrace, -1, `${anchor} 뒤에 객체가 없다`);

  let depth = 0;
  for (let i = openBrace; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(openBrace, i + 1);
    }
  }
  throw new Error(`${anchor} 의 객체가 안 닫혔다`);
}

/** 떼어 낸 리터럴에서 **맨 바깥 단계의 키 이름**만 모은다. */
function topLevelKeys(literal: string): Set<string> {
  const body = stripComments(literal);
  const keys = new Set<string>();
  let depth = 0;
  for (const line of body.split(/\r?\n/)) {
    const match = depth === 1 ? /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:/.exec(line) : null;
    if (match) keys.add(match[1]);
    for (const ch of line) {
      if (ch === "{" || ch === "[" || ch === "(") depth += 1;
      else if (ch === "}" || ch === "]" || ch === ")") depth -= 1;
    }
  }
  return keys;
}

const NODE_CLONE_ANCHOR = "oldNodes.map((n) => ({";
const EDGE_CLONE_ANCHOR = "oldEdges.map((e) => ({";

/**
 * 복제하지 **않는** 것이 맞는 칸.
 *  - id: 새 행이니 새로 받는다(노드는 node_code, 연결선은 cloned_from_edge_id
 *    로 부모와의 짝이 따로 남는다).
 *  - createdAt/updatedAt: 이 행이 만들어진 때이지 부모가 만들어진 때가 아니다.
 * procedureTemplateId 는 여기 없다 — 복제 목록이 **새 초안의 id 로 바꿔** 적는다.
 */
const NEVER_CLONED = new Set(["id", "createdAt", "updatedAt"]);

describe("줄기 B-⑤ — ① 먼저 표본 확인", () => {
  test("🔵 복제 목록 둘을 실제로 떼어 냈고, 비어 있지 않다", () => {
    const nodeKeys = topLevelKeys(objectLiteralAfter(NODE_CLONE_ANCHOR));
    const edgeKeys = topLevelKeys(objectLiteralAfter(EDGE_CLONE_ANCHOR));
    assert.ok(nodeKeys.size > 10, `노드 복제 목록이 ${nodeKeys.size}칸뿐이다 — 떼어 내기가 틀렸다`);
    assert.ok(edgeKeys.size > 5, `연결선 복제 목록이 ${edgeKeys.size}칸뿐이다 — 떼어 내기가 틀렸다`);
    // 가져오기(import) 쪽 목록을 잘못 집으면 아래가 전부 거짓말이 된다 —
    // 그쪽에는 clonedFromEdgeId 가 없고, 노드 쪽에는 isActive 가 없다.
    assert.ok(edgeKeys.has("clonedFromEdgeId"), "연결선 목록을 복제가 아니라 가져오기 쪽에서 집었다");
    assert.ok(nodeKeys.has("isActive"), "노드 목록을 복제가 아니라 가져오기 쪽에서 집었다");
  });

  test("🔴 주석 걷어내기가 실제로 일을 한다 — 날것에는 코드에 없는 글자가 주석으로 적혀 있다", () => {
    const rawNodeLiteral = objectLiteralAfter(NODE_CLONE_ANCHOR);
    assert.ok(rawNodeLiteral.includes("28/28"), "복제 목록 주석에 실측 숫자가 적혀 있어야 한다");
    assert.ok(!stripComments(rawNodeLiteral).includes("28/28"), "걷어내기가 일을 안 하고 있다");
  });
});

describe("줄기 B-⑤ 가 — 새 DRAFT 가 부모의 칸을 하나도 안 흘린다", () => {
  test("🔴 노드: 스키마의 칸과 복제 목록이 **정확히 같다**(일부러 뺀 셋 말고는)", () => {
    const schemaColumns = Object.keys(getTableColumns(procedureTemplateNodes));
    assert.ok(schemaColumns.includes("userPositionX"), "표본 확인 — 스키마에 자리 칸이 있어야 이 시험에 뜻이 있다");

    const expected = schemaColumns.filter((c) => !NEVER_CLONED.has(c)).sort();
    const actual = [...topLevelKeys(objectLiteralAfter(NODE_CLONE_ANCHOR))].sort();
    assert.deepEqual(
      actual,
      expected,
      "노드 복제 목록이 스키마와 어긋났다 — 칸을 새로 더했다면 복제할지 말지를 정해서 목록이나 NEVER_CLONED 에 적어라"
    );
  });

  test("🔴 연결선: 같은 잣대", () => {
    const schemaColumns = Object.keys(getTableColumns(procedureTemplateEdges));
    assert.ok(schemaColumns.includes("userRoutePoints"), "표본 확인 — 스키마에 경로점 칸이 있어야 한다");

    const expected = schemaColumns.filter((c) => !NEVER_CLONED.has(c)).sort();
    const actual = [...topLevelKeys(objectLiteralAfter(EDGE_CLONE_ANCHOR))].sort();
    assert.deepEqual(actual, expected, "연결선 복제 목록이 스키마와 어긋났다");
  });

  test("🔴 배치 세 칸은 **복제 목록에 적힌 값 그대로** 실린다 — 뭔가로 바꿔 쓰지 않는다", () => {
    // null 을 0 이나 position_x 로 바꿔 쓰면, 한 번도 안 옮긴 노드에 자리가
    // 생겨 버린다(그 다음부터는 원본 좌표·자동 배치로 떨어질 길이 막힌다).
    const nodeLiteral = stripComments(objectLiteralAfter(NODE_CLONE_ANCHOR));
    assert.match(nodeLiteral, /userPositionX:\s*n\.userPositionX,/);
    assert.match(nodeLiteral, /userPositionY:\s*n\.userPositionY,/);
    const edgeLiteral = stripComments(objectLiteralAfter(EDGE_CLONE_ANCHOR));
    assert.match(edgeLiteral, /userRoutePoints:\s*e\.userRoutePoints,/);
  });

  test("🟢 가져오기(Excel) 쪽 목록은 건드리지 않았다 — 거기엔 물려받을 배치가 없다", () => {
    const importedNodeKeys = topLevelKeys(objectLiteralAfter("extracted.nodes.map((n) => ({"));
    assert.ok(importedNodeKeys.has("positionX"), "표본 확인 — 가져오기 목록을 집은 것이 맞다");
    assert.equal(importedNodeKeys.has("userPositionX"), false, "처음 가져오는 절차에는 사람이 끌어 놓은 자리가 있을 수 없다");
    assert.equal(importedNodeKeys.has("userPositionY"), false);
    // 가져오기 쪽 연결선만 `.map((e) => { … return { … }; })` 모양이다 —
    // 한 줄에 안 붙어 있어서 앵커를 둘로 나눠 집는다.
    const importedEdgeKeys = topLevelKeys(objectLiteralAfter("const edgeRows = extracted.edges", "return {"));
    assert.ok(importedEdgeKeys.has("sourceConnectorId"), "표본 확인 — 비어 있으면 아래가 공짜로 통과한다");
    assert.equal(importedEdgeKeys.has("userRoutePoints"), false);
  });
});
