import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { getHistoryGroupLabel, getOriginBadgeLabel } from "./procedure-template-history-labels";

describe("getOriginBadgeLabel", () => {
  test("maps each origin to its badge text", () => {
    assert.equal(getOriginBadgeLabel("USER_EDIT"), "일반 작업");
    assert.equal(getOriginBadgeLabel("UNDO"), "이전");
    assert.equal(getOriginBadgeLabel("REDO"), "앞으로");
    assert.equal(getOriginBadgeLabel("RESTORE"), "복원");
  });
});

describe("getHistoryGroupLabel", () => {
  test("UNDO/REDO/RESTORE origin overrides the label regardless of underlying action types", () => {
    assert.equal(getHistoryGroupLabel({ origin: "UNDO", actionTypes: ["DELETE_NODE"] }), "이전 작업 취소");
    assert.equal(getHistoryGroupLabel({ origin: "REDO", actionTypes: ["CREATE_NODE"] }), "작업 다시 적용");
    assert.equal(getHistoryGroupLabel({ origin: "RESTORE", actionTypes: ["CREATE_NODE", "DELETE_EDGE", "UPDATE_NODE"] }), "과거 상태로 복원");
  });

  test("USER_EDIT single-action groups map to their concise label", () => {
    assert.equal(getHistoryGroupLabel({ origin: "USER_EDIT", actionTypes: ["CREATE_NODE"] }), "노드 추가");
    assert.equal(getHistoryGroupLabel({ origin: "USER_EDIT", actionTypes: ["DELETE_NODE"] }), "노드 삭제");
    assert.equal(getHistoryGroupLabel({ origin: "USER_EDIT", actionTypes: ["UPDATE_NODE"] }), "노드 내용 수정");
    assert.equal(getHistoryGroupLabel({ origin: "USER_EDIT", actionTypes: ["CHANGE_NODE_TYPE"] }), "노드 유형 변경");
    assert.equal(getHistoryGroupLabel({ origin: "USER_EDIT", actionTypes: ["CREATE_EDGE"] }), "연결 추가");
    assert.equal(getHistoryGroupLabel({ origin: "USER_EDIT", actionTypes: ["DELETE_EDGE"] }), "연결 삭제");
    assert.equal(getHistoryGroupLabel({ origin: "USER_EDIT", actionTypes: ["UPDATE_EDGE"] }), "연결 수정");
    assert.equal(getHistoryGroupLabel({ origin: "USER_EDIT", actionTypes: ["RETARGET_EDGE"] }), "연결 대상 변경");
    assert.equal(getHistoryGroupLabel({ origin: "USER_EDIT", actionTypes: ["SAVE_LAYOUT"] }), "노드 위치 변경");
    assert.equal(getHistoryGroupLabel({ origin: "USER_EDIT", actionTypes: ["SAVE_EDGE_ROUTE"] }), "연결 경로 변경");
    assert.equal(getHistoryGroupLabel({ origin: "USER_EDIT", actionTypes: ["UPDATE_TEMPLATE_METADATA"] }), "기술 절차 이름 변경");
  });

  test("the compound route-point-insertion shape (CREATE_NODE+RETARGET_EDGE+CREATE_EDGE) gets one semantic label, never three raw action names", () => {
    const label = getHistoryGroupLabel({ origin: "USER_EDIT", actionTypes: ["CREATE_NODE", "RETARGET_EDGE", "CREATE_EDGE"] });
    assert.equal(label, "분기 중간에 노드 삽입");
  });

  test("a combined layout+route save gets a single combined label", () => {
    const label = getHistoryGroupLabel({ origin: "USER_EDIT", actionTypes: ["SAVE_LAYOUT", "SAVE_EDGE_ROUTE"] });
    assert.equal(label, "노드 위치 및 연결 경로 변경");
  });

  test("an order-sensitive near-miss of the compound shape does not falsely match", () => {
    const label = getHistoryGroupLabel({ origin: "USER_EDIT", actionTypes: ["RETARGET_EDGE", "CREATE_NODE", "CREATE_EDGE"] });
    assert.notEqual(label, "분기 중간에 노드 삽입");
  });
});
