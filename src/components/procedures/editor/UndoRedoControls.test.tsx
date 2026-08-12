import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import UndoRedoControls from "./UndoRedoControls";

function render(overrides: Partial<Parameters<typeof UndoRedoControls>[0]> = {}): string {
  return renderToStaticMarkup(
    <UndoRedoControls
      canUndo={overrides.canUndo ?? true}
      canRedo={overrides.canRedo ?? true}
      isUndoing={overrides.isUndoing ?? false}
      isRedoing={overrides.isRedoing ?? false}
      onUndo={overrides.onUndo ?? (() => {})}
      onRedo={overrides.onRedo ?? (() => {})}
    />
  );
}

// The rendered className itself contains the literal Tailwind utility
// "disabled:opacity-50" — a bare `.includes("disabled")` would false-match
// on every button regardless of actual state, so this checks for the real
// `disabled=""` HTML attribute specifically.
function hasDisabledAttribute(buttonHtml: string): boolean {
  return /\sdisabled=""/.test(buttonHtml);
}

describe("UndoRedoControls", () => {
  test("both buttons render enabled when canUndo/canRedo are true and nothing is in flight", () => {
    const html = render({ canUndo: true, canRedo: true });
    assert.ok(html.includes(">이전<"));
    assert.ok(html.includes(">앞으로<"));
    assert.ok(!hasDisabledAttribute(html));
  });

  test("Undo button is disabled when canUndo is false", () => {
    const html = render({ canUndo: false, canRedo: true });
    // Two buttons in the static markup; assert the first (Undo) carries disabled and the second (Redo) does not.
    const [undoButton, redoButton] = html.split("</button>");
    assert.ok(hasDisabledAttribute(undoButton));
    assert.ok(!hasDisabledAttribute(redoButton));
  });

  test("Redo button is disabled when canRedo is false", () => {
    const html = render({ canUndo: true, canRedo: false });
    const [undoButton, redoButton] = html.split("</button>");
    assert.ok(!hasDisabledAttribute(undoButton));
    assert.ok(hasDisabledAttribute(redoButton));
  });

  test("both buttons are disabled while a request is in flight, even when canUndo/canRedo are true", () => {
    const undoing = render({ canUndo: true, canRedo: true, isUndoing: true });
    assert.ok(undoing.includes("되돌리는 중..."));
    const [undoButton1, redoButton1] = undoing.split("</button>");
    assert.ok(hasDisabledAttribute(undoButton1));
    assert.ok(hasDisabledAttribute(redoButton1), "Redo must also be disabled while Undo is in flight");

    const redoing = render({ canUndo: true, canRedo: true, isRedoing: true });
    assert.ok(redoing.includes("다시 적용 중..."));
    const [undoButton2, redoButton2] = redoing.split("</button>");
    assert.ok(hasDisabledAttribute(undoButton2), "Undo must also be disabled while Redo is in flight");
    assert.ok(hasDisabledAttribute(redoButton2));
  });
});
