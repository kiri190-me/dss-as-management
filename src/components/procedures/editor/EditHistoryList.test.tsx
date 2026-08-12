import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import EditHistoryList from "./EditHistoryList";
import type { TemplateHistoryView, HistoryGroupView, HistoryEntryRow } from "@/lib/db/queries/procedure-template-history";

function entryRow(overrides: Partial<HistoryEntryRow> & Pick<HistoryEntryRow, "id" | "actionType">): HistoryEntryRow {
  return {
    nodeId: null,
    edgeId: null,
    beforeState: null,
    afterState: null,
    reason: null,
    actorName: "홍길동",
    sequenceNumber: 1,
    createdAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

function group(overrides: Partial<HistoryGroupView> & Pick<HistoryGroupView, "changeGroupId" | "origin" | "rows">): HistoryGroupView {
  return {
    sourceGroupId: null,
    restoreTargetGroupId: null,
    sequenceNumber: 1,
    createdAt: "2026-08-01T00:00:00.000Z",
    isRestoreEligible: false,
    isCurrentTop: false,
    ...overrides,
  };
}

function render(historyView: TemplateHistoryView, canManage = true): string {
  return renderToStaticMarkup(<EditHistoryList historyView={historyView} canManage={canManage} restoringGroupId={null} onRestoreClick={() => {}} />);
}

describe("EditHistoryList", () => {
  test("empty history shows the empty-state message", () => {
    const html = render({ groups: [], canUndo: false, canRedo: false });
    assert.ok(html.includes("아직 편집 이력이 없습니다."));
  });

  test("groups render as one logical entry per change_group_id, not one row per underlying DB write", () => {
    const g = group({
      changeGroupId: "g1",
      origin: "USER_EDIT",
      rows: [entryRow({ id: "r1", actionType: "CREATE_NODE" }), entryRow({ id: "r2", actionType: "RETARGET_EDGE" }), entryRow({ id: "r3", actionType: "CREATE_EDGE" })],
    });
    const html = render({ groups: [g], canUndo: false, canRedo: false });
    assert.ok(html.includes("분기 중간에 노드 삽입"), "the compound split must show ONE semantic label");
    assert.ok(!html.includes("CREATE_NODE"), "must never expose raw DB action-type names when collapsed");
    assert.ok(html.includes("세부 내역 보기 (3건)"));
  });

  test("origin badge and current-state marker render correctly", () => {
    const html = render(
      { groups: [group({ changeGroupId: "g1", origin: "USER_EDIT", rows: [entryRow({ id: "r1", actionType: "UPDATE_NODE" })], isCurrentTop: true })], canUndo: true, canRedo: false },
      true
    );
    assert.ok(html.includes("일반 작업"));
    assert.ok(html.includes("현재"));
  });

  test("a restore-eligible group shows the restore button when canManage is true", () => {
    const html = render(
      { groups: [group({ changeGroupId: "g1", origin: "USER_EDIT", rows: [entryRow({ id: "r1", actionType: "CREATE_NODE" })], isRestoreEligible: true })], canUndo: false, canRedo: false },
      true
    );
    assert.ok(html.includes("이 상태로 복원"));
  });

  test("an UNDO-origin group (not restore-eligible) never shows the restore button", () => {
    const html = render(
      { groups: [group({ changeGroupId: "g1", origin: "UNDO", rows: [entryRow({ id: "r1", actionType: "DELETE_NODE" })], isRestoreEligible: false })], canUndo: false, canRedo: true },
      true
    );
    assert.ok(html.includes("이전 작업 취소"), "UNDO groups still show their own label");
    assert.ok(!html.includes("이 상태로 복원"), "an UNDO group must never be selectable as a restore target");
  });

  test("no restore button renders for anyone when canManage is false, even for an eligible group", () => {
    const html = render(
      { groups: [group({ changeGroupId: "g1", origin: "USER_EDIT", rows: [entryRow({ id: "r1", actionType: "CREATE_NODE" })], isRestoreEligible: true })], canUndo: false, canRedo: false },
      false
    );
    assert.ok(!html.includes("이 상태로 복원"), "FULL_SERVICE/unauthorized viewers must get no restore control regardless of eligibility");
  });

  test("REDO and RESTORE origin badges/labels render correctly", () => {
    const redoHtml = render({ groups: [group({ changeGroupId: "g1", origin: "REDO", rows: [entryRow({ id: "r1", actionType: "CREATE_NODE" })] })], canUndo: true, canRedo: false });
    assert.ok(redoHtml.includes("앞으로"));
    assert.ok(redoHtml.includes("작업 다시 적용"));

    const restoreHtml = render({ groups: [group({ changeGroupId: "g1", origin: "RESTORE", rows: [entryRow({ id: "r1", actionType: "UPDATE_NODE" })] })], canUndo: true, canRedo: false });
    assert.ok(restoreHtml.includes("복원"));
    assert.ok(restoreHtml.includes("과거 상태로 복원"));
  });

  test("a group's restoringGroupId disables only its own restore button", () => {
    const groups = [
      group({ changeGroupId: "g1", origin: "USER_EDIT", rows: [entryRow({ id: "r1", actionType: "CREATE_NODE" })], isRestoreEligible: true, sequenceNumber: 2 }),
      group({ changeGroupId: "g2", origin: "USER_EDIT", rows: [entryRow({ id: "r2", actionType: "DELETE_NODE" })], isRestoreEligible: true, sequenceNumber: 1 }),
    ];
    const html = renderToStaticMarkup(<EditHistoryList historyView={{ groups, canUndo: false, canRedo: false }} canManage={true} restoringGroupId="g1" onRestoreClick={() => {}} />);
    assert.ok(html.includes("복원 중..."), "the in-flight group shows its own loading label");
  });
});
