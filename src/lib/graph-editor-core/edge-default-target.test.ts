import { test } from "node:test";
import assert from "node:assert/strict";
import { pickDefaultTargetNodeId } from "./edge-default-target";

test("가장 최근에 추가된(마지막) 노드를 기본 대상으로 고른다", () => {
  assert.equal(pickDefaultTargetNodeId([{ id: "a" }, { id: "b" }, { id: "c" }], "a"), "c");
});

test("가장 최근 노드가 시작 노드면 그 다음으로 최근인 노드를 고른다", () => {
  assert.equal(pickDefaultTargetNodeId([{ id: "a" }, { id: "b" }, { id: "c" }], "c"), "b");
});

test("후보가 없으면 빈 값이다 — 임의의 노드를 끼워 넣지 않는다", () => {
  assert.equal(pickDefaultTargetNodeId([], "a"), "");
  assert.equal(pickDefaultTargetNodeId([{ id: "a" }], "a"), "");
});

test("시작 노드가 아직 없으면(null) 그냥 가장 최근 노드다", () => {
  assert.equal(pickDefaultTargetNodeId([{ id: "a" }, { id: "b" }], null), "b");
});
