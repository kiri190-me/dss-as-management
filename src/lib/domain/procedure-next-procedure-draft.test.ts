import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  isProcedureNodeFieldDraftDirty,
  mergeProcedureNodeForRender,
  type ProcedureNodeFieldDraft,
  type ProcedureServerNodeSnapshot,
} from "./procedure-editor-save-state";
import { computeUnsavedNodeIds, type EditableNodeFields } from "./procedure-editor-client-state";

/**
 * ============================================================================
 * 「다음 절차」가 **저장될 때까지 살아 있는가** (줄기 B ④ 조각 ②)
 * ============================================================================
 * 이 편집기는 고치는 즉시 저장하지 않는다 — 초안을 들고 있다가 화면 위의
 * [저장]이 한꺼번에 보낸다. 그래서 새 칸 하나를 더할 때 **세 곳**을 같이
 * 고쳐야 하고, 하나라도 빠지면 **오류 없이 조용히 사라진다**:
 *
 *  ① 「저장 안 됨」 세기 — 빠지면 고르고 나가도 안 묻고 날아간다.
 *  ② 화면에 그리기 — 빠지면 고른 값이 저장 전까지 화면에 안 보인다.
 *  ③ 「바뀌었나」 판정 — 빠지면 [저장]이 이 노드를 건너뛰고도 성공이라 말한다.
 *
 * 셋 다 타입은 통과한다(전부 string | null 이다). 그래서 값으로 잰다.
 * ============================================================================
 */

const 서버노드: ProcedureServerNodeSnapshot = {
  id: "n1",
  title: "종료",
  description: null,
  instructions: null,
  sortOrder: 0,
  isActive: true,
  nextProcedureTemplateId: null,
  positionX: 0,
  positionY: 0,
};

function 초안(over: Partial<ProcedureNodeFieldDraft> = {}): ProcedureNodeFieldDraft {
  return {
    title: 서버노드.title,
    description: "",
    instructions: "",
    sortOrder: 서버노드.sortOrder,
    isActive: 서버노드.isActive,
    nextProcedureTemplateId: 서버노드.nextProcedureTemplateId,
    ...over,
  };
}

function 노드칸(over: Partial<EditableNodeFields> = {}): EditableNodeFields {
  return {
    title: "종료",
    description: null,
    instructions: null,
    sortOrder: 0,
    isActive: true,
    nodeType: "END",
    nextProcedureTemplateId: null,
    ...over,
  };
}

describe("다음 절차 — ① 「저장 안 됨」으로 세어진다", () => {
  test("🔴 이것만 고쳐도 저장 안 된 노드로 잡힌다 — 안 잡히면 묻지도 않고 날아간다", () => {
    const 저장됨 = new Map([["n1", 노드칸()]]);
    const 고치는중 = new Map([["n1", 노드칸({ nextProcedureTemplateId: "t-9" })]]);
    assert.deepEqual([...computeUnsavedNodeIds(저장됨, 고치는중)], ["n1"]);
  });

  test("🔴 지우는 것도 바뀐 것이다 — null 로 되돌리는 쪽도 세어져야 한다", () => {
    const 저장됨 = new Map([["n1", 노드칸({ nextProcedureTemplateId: "t-9" })]]);
    const 고치는중 = new Map([["n1", 노드칸({ nextProcedureTemplateId: null })]]);
    assert.deepEqual([...computeUnsavedNodeIds(저장됨, 고치는중)], ["n1"]);
  });

  test("🔵 안 건드리면 안 잡힌다 — 공짜 통과가 아닌지 확인한다", () => {
    const 저장됨 = new Map([["n1", 노드칸({ nextProcedureTemplateId: "t-9" })]]);
    const 고치는중 = new Map([["n1", 노드칸({ nextProcedureTemplateId: "t-9" })]]);
    assert.deepEqual([...computeUnsavedNodeIds(저장됨, 고치는중)], []);
  });
});

describe("다음 절차 — ② 저장 전에도 화면이 고른 값을 그린다", () => {
  test("고른 값이 서버 값을 덮는다", () => {
    const 그려진것 = mergeProcedureNodeForRender(서버노드, 초안({ nextProcedureTemplateId: "t-9" }), undefined);
    assert.equal(그려진것.nextProcedureTemplateId, "t-9");
  });

  test("🔴 **지운 것도 덮는다** — `??` 로 합치면 지우기가 화면에 안 보인다", () => {
    const 서버에값있음 = { ...서버노드, nextProcedureTemplateId: "t-9" };
    const 그려진것 = mergeProcedureNodeForRender(
      서버에값있음,
      초안({ nextProcedureTemplateId: null }),
      undefined
    );
    assert.equal(
      그려진것.nextProcedureTemplateId,
      null,
      "지정을 지웠는데 화면이 옛 값을 그리면, 사람은 지워지지 않았다고 읽는다"
    );
  });

  test("🔵 초안 자체가 없으면 서버 값 그대로 — 「초안 없음」과 「null 로 지움」은 다르다", () => {
    const 서버에값있음 = { ...서버노드, nextProcedureTemplateId: "t-9" };
    const 그려진것 = mergeProcedureNodeForRender(서버에값있음, undefined, undefined);
    assert.equal(그려진것.nextProcedureTemplateId, "t-9");
  });
});

describe("다음 절차 — ③ [저장]이 이 노드를 집어 든다", () => {
  test("🔴 이것만 바뀌어도 「바뀜」이다 — 아니면 [저장]이 건너뛰고 성공이라 말한다", () => {
    assert.equal(isProcedureNodeFieldDraftDirty(초안({ nextProcedureTemplateId: "t-9" }), 서버노드), true);
  });

  test("🔴 지우는 쪽도 「바뀜」이다", () => {
    const 서버에값있음 = { ...서버노드, nextProcedureTemplateId: "t-9" };
    assert.equal(isProcedureNodeFieldDraftDirty(초안({ nextProcedureTemplateId: null }), 서버에값있음), true);
  });

  test("🔵 같으면 안 바뀐 것이다 — 늘 참을 돌려주는 것이 아닌지 확인한다", () => {
    const 서버에값있음 = { ...서버노드, nextProcedureTemplateId: "t-9" };
    assert.equal(isProcedureNodeFieldDraftDirty(초안({ nextProcedureTemplateId: "t-9" }), 서버에값있음), false);
  });
});
