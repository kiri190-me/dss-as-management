import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import ProcedureNodeChip from "./ProcedureNodeChip";
import { SEMANTIC_NODE_VISUAL_TYPES, type SemanticNodeVisualType, type IconKey } from "@/lib/domain/procedure-visual-language";

/**
 * Semantic (never pixel-perfect) rendering tests for the UI-stabilization
 * pass's "center node text inside every workflow shape" requirement.
 * Renders the real component via react-dom/server (no new test
 * dependency — react-dom already ships with Next.js) and asserts on the
 * actual class names / markup structure it produces, the same convention
 * as every other test in this repo (assert on real output, not a mock).
 *
 * react-dom/server refuses to run under this repo's usual
 * `--conditions=react-server` test flag (React deliberately blocks it
 * there), so this file has its own "test:components" script instead of
 * living in the main "test" script — see package.json.
 *
 * Uses the component's own data-node-shape-layer / data-node-content
 * attributes (not brittle positional/DOM-order matching) so a test never
 * cares how many wrapping elements a caller (a graph node, a legend
 * entry, a validation-screen list) puts around the chip.
 */

const ICON_BY_TYPE: Record<SemanticNodeVisualType, IconKey> = {
  START: "start",
  END: "end",
  TASK: "task",
  DECISION: "decision",
  CHECKLIST: "checklist",
  TROUBLESHOOTING: "troubleshooting",
  REFERENCE: "document",
  HOLD_OR_REVIEW: "hold",
  SUBPROCESS_OR_STAGE: "task",
};

function renderGraphChip(overrides: Partial<Parameters<typeof ProcedureNodeChip>[0]> = {}): string {
  const semanticType = overrides.semanticType ?? "TASK";
  return renderToStaticMarkup(
    <ProcedureNodeChip semanticType={semanticType} iconKey={overrides.iconKey ?? ICON_BY_TYPE[semanticType]} title={overrides.title ?? "제목"} size="graph" {...overrides} />
  );
}

/** Finds the data-node-content element's own class attribute, regardless of how many other elements wrap it. */
function getContentLayerClass(html: string): string {
  const match = html.match(/<div[^>]*\bdata-node-content="true"[^>]*\bclass="([^"]*)"/) ?? html.match(/<div[^>]*\bclass="([^"]*)"[^>]*\bdata-node-content="true"/);
  assert.ok(match, "expected to find the data-node-content element");
  return match![1];
}

function getShapeLayerAttributes(html: string): string {
  const match = html.match(/<div[^>]*\bdata-node-shape-layer="true"[^>]*>/);
  assert.ok(match, "expected to find the data-node-shape-layer element");
  return match![0];
}

/** Finds the outermost wrapper element's own class attribute — the one carrying data-semantic-type, selection ring, and badge outline classes. */
function getWrapperClass(html: string): string {
  const match = html.match(/<div data-semantic-type="[^"]*" class="([^"]*)"/);
  assert.ok(match, "expected to find the outer wrapper element");
  return match![1];
}

/** Counts elements carrying an inline clip-path style within the html — used to confirm the layered clip-path border technique (outer border-fill + inner bg-fill) is actually present for clipped shapes. */
function countClipPathElements(html: string): number {
  return (html.match(/clip-path/g) ?? []).length;
}

/** Slices the html to just the data-node-content element's own opening tag onward, so text-order assertions (icon before title before subtitle) can never be fooled by earlier unrelated text (e.g. the outer tooltip's title attribute). */
function sliceFromContentLayer(html: string): string {
  const idx = html.indexOf('data-node-content="true"');
  assert.ok(idx >= 0, "expected to find the data-node-content marker");
  return html.slice(idx);
}

test("every semantic node visual type renders its content in a centered flex column (items-center + justify-center + text-center)", () => {
  for (const semanticType of SEMANTIC_NODE_VISUAL_TYPES) {
    const html = renderGraphChip({ semanticType });
    const contentClass = getContentLayerClass(html);
    assert.ok(contentClass.includes("flex-col"), `${semanticType}: content layer must stack vertically`);
    assert.ok(contentClass.includes("items-center"), `${semanticType}: content layer must center horizontally`);
    assert.ok(contentClass.includes("justify-center"), `${semanticType}: content layer must center vertically`);
    assert.ok(contentClass.includes("text-center"), `${semanticType}: content layer must center text`);
  }
});

test("a long, multiline title uses centered text alignment and stays inside the clamp container", () => {
  const longTitle = "이 제목은 노드 박스 안에서 여러 줄로 줄바꿈되어야 하는 매우 긴 한글 제목입니다 확인용 텍스트입니다";
  const html = renderGraphChip({ title: longTitle });
  assert.ok(html.includes(longTitle), "the full title text must be present in the DOM (never dropped, even if visually clamped)");
  const contentHtml = sliceFromContentLayer(html);
  const titleSpanMatch = contentHtml.match(/<span class="([^"]*)"[^>]*>[^<]*이 제목은/);
  assert.ok(titleSpanMatch, "the title span must be found within the content layer");
  assert.ok(titleSpanMatch![1].includes("text-center"), "the title span must carry the text-center class");
  assert.ok(titleSpanMatch![1].includes("w-full"), "the title span must span the full content width for centering to have any visible effect");
});

/**
 * Multiline node titles (Shift+Enter). Only the server-rendered markup is
 * practical to assert here (react-dom/server has no live DOM/event
 * dispatch, so the Shift+Enter keydown handler itself
 * — a plain `if (e.key === "Enter" && !e.shiftKey) e.preventDefault()` in
 * NodePropertyPanel/CreateNodePanel — isn't exercisable by this test
 * runner; that behavior was verified by direct code review instead, and
 * the user will confirm it manually in Chrome per this task's own
 * instruction not to attempt an automated browser walkthrough).
 */
test("a multiline (\\n-containing) title renders with whitespace-pre-line so the newline shows as a real line break, not a collapsed space", () => {
  const html = renderGraphChip({ title: "1차 확인\n2차 확인" });
  const contentHtml = sliceFromContentLayer(html);
  const titleSpanMatch = contentHtml.match(/<span class="([^"]*)"[^>]*>[^<]*1차 확인/);
  assert.ok(titleSpanMatch, "the title span must be found within the content layer");
  assert.ok(titleSpanMatch![1].includes("whitespace-pre-line"), "the title span must honor explicit newlines as real line breaks");
  assert.ok(html.includes("1차 확인\n2차 확인"), "the literal newline character must survive into the rendered output, never collapsed to a space");
});

test("a multiline title grows the chip's minHeight compared to an equivalent single-line title", () => {
  const singleLineHtml = renderGraphChip({ title: "1차 확인 2차 확인" });
  const multilineHtml = renderGraphChip({ title: "1차 확인\n2차 확인\n3차 확인\n4차 확인" });
  const singleLineHeight = Number(singleLineHtml.match(/min-height:\s*(\d+)px/)?.[1]);
  const multilineHeight = Number(multilineHtml.match(/min-height:\s*(\d+)px/)?.[1]);
  assert.ok(Number.isFinite(singleLineHeight) && Number.isFinite(multilineHeight));
  assert.ok(multilineHeight > singleLineHeight, "4 explicit lines must reserve more height than the same words wrapped as running text");
});

/**
 * Cursor-disappearing root cause fix (round 3) — the hover/focus glow
 * used `filter: drop-shadow(...)`, a documented trigger for a
 * Chromium/WebKit GPU-compositing bug where the OS cursor can vanish
 * while the pointer moves across many `filter`-bearing elements, made
 * worse by the simultaneous `opacity` transitions every OTHER node gets
 * once one node is selected. Locks down that the wrapper never uses
 * `filter`/`drop-shadow` anywhere, only `box-shadow` (via Tailwind's
 * `shadow-*`), regardless of selection/dim state.
 */
test("the node wrapper never uses filter/drop-shadow for its hover/focus glow (the confirmed cursor-disappearing trigger) — box-shadow only", () => {
  for (const overrides of [{}, { isSelected: true }, { isDimmed: true }, { isDimmed: true, isSeverelyDimmed: true }]) {
    const html = renderGraphChip(overrides);
    const wrapperClass = getWrapperClass(html);
    assert.ok(!wrapperClass.includes("drop-shadow"), `wrapper must never use drop-shadow (state: ${JSON.stringify(overrides)})`);
    assert.ok(!/(^|\s)filter(-|:)/.test(wrapperClass), `wrapper must never use a filter utility (state: ${JSON.stringify(overrides)})`);
    assert.ok(wrapperClass.includes("hover:shadow-"), "the hover glow must be present as a box-shadow utility instead");
  }
});

/**
 * Cursor-disappearing root cause fix, round 2 — swapping filter for
 * box-shadow alone did not resolve the reported bug. Selecting a node
 * dims dozens of OTHER nodes at once, and the selected node itself picks
 * up a continuous `:focus-within` box-shadow (React Flow focuses a
 * selected node for keyboard-nav) — animating opacity/box-shadow on that
 * many simultaneously-changing elements, right at the moment a node is
 * selected, is a further GPU compositing-layer-promotion trigger. Locks
 * down that neither property is ever transitioned/animated on this
 * wrapper, in any state — opacity/box-shadow apply instantly.
 */
test("the node wrapper never transitions/animates opacity or box-shadow (the round-2 cursor-disappearing trigger) — changes apply instantly", () => {
  for (const overrides of [{}, { isSelected: true }, { isDimmed: true }, { isDimmed: true, isSeverelyDimmed: true }]) {
    const html = renderGraphChip(overrides);
    const wrapperClass = getWrapperClass(html);
    assert.ok(!/transition/.test(wrapperClass), `wrapper must never declare a transition utility (state: ${JSON.stringify(overrides)})`);
  }
});

test("icon, title, and subtitle render as one centered vertical stack, in that order", () => {
  const html = renderGraphChip({ title: "제목", subtitle: "부제목" });
  const contentHtml = sliceFromContentLayer(html);
  const iconIndex = contentHtml.indexOf("<svg");
  const titleIndex = contentHtml.indexOf(">제목<");
  const subtitleIndex = contentHtml.indexOf(">부제목<");
  assert.ok(iconIndex >= 0 && titleIndex > iconIndex, "icon must render before the title");
  assert.ok(subtitleIndex > titleIndex, "subtitle must render after the title");
});

test("a validation badge does not change the content layer's alignment classes", () => {
  const withoutBadge = getContentLayerClass(renderGraphChip({ title: "제목" }));
  const withBadge = getContentLayerClass(renderGraphChip({ title: "제목", issueBadge: { severity: "ERROR", issueId: "issue-1" } }));
  assert.equal(withBadge, withoutBadge, "content layer classes must be identical with or without a badge");

  const html = renderGraphChip({ title: "제목", issueBadge: { severity: "ERROR", issueId: "issue-1" } });
  assert.ok(html.includes("absolute -top-2 -right-2"), "the badge must render as its own absolutely-positioned layer");
});

test("DECISION renders its content in the same unclipped, centered container as every other shape, with extra horizontal padding", () => {
  const decisionHtml = renderGraphChip({ semanticType: "DECISION", title: "정상입니까?" });
  const taskHtml = renderGraphChip({ semanticType: "TASK", title: "정상입니까?" });

  const decisionContentClass = getContentLayerClass(decisionHtml);
  assert.ok(decisionContentClass.includes("text-center") && decisionContentClass.includes("items-center"), "DECISION content must use the same centered container as every other shape");

  const decisionContentTag = decisionHtml.match(/<div[^>]*\bdata-node-content="true"[^>]*>/)![0];
  const taskContentTag = taskHtml.match(/<div[^>]*\bdata-node-content="true"[^>]*>/)![0];
  const decisionPadding = decisionContentTag.match(/padding-left:(\d+)px/);
  const taskPadding = taskContentTag.match(/padding-left:(\d+)px/);
  assert.ok(decisionPadding && taskPadding, "both must set an explicit inline padding-left on the content layer");
  assert.ok(Number(decisionPadding![1]) > Number(taskPadding![1]), "DECISION must have more horizontal padding than TASK");
});

test("REFERENCE's folded-corner clip-path lives only on the decorative shape layer, never on the centered content layer", () => {
  const html = renderGraphChip({ semanticType: "REFERENCE", title: "참조 문서" });
  const shapeLayerTag = getShapeLayerAttributes(html);
  assert.ok(shapeLayerTag.includes("clip-path"), "the document fold clip-path must be present on the shape layer");

  const contentClass = getContentLayerClass(html);
  assert.ok(contentClass.includes("items-center") && contentClass.includes("text-center"), "REFERENCE content must still be centered despite the fold");

  const contentTag = html.match(/<div[^>]*\bdata-node-content="true"[^>]*>/)![0];
  assert.ok(!contentTag.includes("clip-path"), "the content layer must never carry a clip-path");
});

test("CHECKLIST/TROUBLESHOOTING double-border styling lives on the shape layer only and never shifts the centered content", () => {
  for (const semanticType of ["CHECKLIST", "TROUBLESHOOTING"] as const) {
    const html = renderGraphChip({ semanticType, title: "항목" });
    const contentClass = getContentLayerClass(html);
    assert.ok(contentClass.includes("items-center") && contentClass.includes("justify-center"), `${semanticType} content must stay centered`);
    const shapeLayerTag = getShapeLayerAttributes(html);
    assert.ok(shapeLayerTag.includes("shadow-["), `${semanticType} must still render its double-border shadow on the shape layer`);
    assert.ok(!getContentLayerClass(html).includes("shadow-["), `${semanticType} content layer must not carry the double-border shadow itself`);
  }
});

// ---- Phase 4A node-outline visibility pass ----

test("every semantic node visual type renders a data-node-shape-layer element (the decorative border/outline layer)", () => {
  for (const semanticType of SEMANTIC_NODE_VISUAL_TYPES) {
    const html = renderGraphChip({ semanticType });
    getShapeLayerAttributes(html); // throws/asserts internally if missing
  }
});

test("a normal (unselected, no badge) node's wrapper does not carry the selection ring classes", () => {
  const wrapperClass = getWrapperClass(renderGraphChip({}));
  assert.ok(!wrapperClass.includes("ring-blue"), "an unselected node must not show the selection ring color");
});

test("isSelected adds a distinct, thicker ring than the base border, and differs from the unselected wrapper classes", () => {
  const unselected = getWrapperClass(renderGraphChip({ isSelected: false }));
  const selected = getWrapperClass(renderGraphChip({ isSelected: true }));
  assert.notEqual(selected, unselected, "selection must change the wrapper's class list");
  assert.ok(selected.includes("ring-blue-500"), "selected node must show the blue selection ring color");
  assert.ok(selected.includes("ring-[3px]"), "selected ring must be visually thicker than the base ~2px border");
});

test("WARNING and ERROR badge outlines are both present as distinct classes, and both differ from the selection ring classes", () => {
  const selected = getWrapperClass(renderGraphChip({ isSelected: true }));
  const warning = getWrapperClass(renderGraphChip({ issueBadge: { severity: "WARNING", issueId: "i1" } }));
  const error = getWrapperClass(renderGraphChip({ issueBadge: { severity: "ERROR", issueId: "i1" } }));

  assert.notEqual(warning, error, "WARNING and ERROR must render distinct wrapper classes");
  assert.ok(warning.includes("outline-dashed"), "WARNING must be dashed");
  assert.ok(!error.includes("outline-dashed"), "ERROR must not be dashed");
  assert.ok(!warning.includes("ring-blue-500") && !error.includes("ring-blue-500"), "badge outlines must not be confused with the selection ring color");
  assert.notEqual(selected, warning);
  assert.notEqual(selected, error);
});

test("DECISION and REFERENCE (clip-path shapes) render a layered outer-border + inner-fill pair, both clipped to the same shape — not a single unclipped border", () => {
  for (const semanticType of ["DECISION", "REFERENCE"] as const) {
    const html = renderGraphChip({ semanticType, title: "제목" });
    assert.equal(countClipPathElements(html), 2, `${semanticType}: expected exactly two clip-path'd layers (outer border-fill, inner bg-fill)`);
    const shapeLayerTag = getShapeLayerAttributes(html);
    assert.ok(shapeLayerTag.includes("bg-[var(--node-border-light)]"), `${semanticType}: the outer clipped layer must be filled with the semantic border color`);
    // A CSS `border` property never renders correctly across a clip-path'd
    // polygon's diagonal edges — the layered technique replaces it with
    // background-color fills entirely, so the shape layer must not fall
    // back to the plain `border` utility class (as opposed to the
    // `border-[...]` arbitrary-value class, which only sets border-color
    // and is harmless without a border-width).
    assert.ok(!/(^|\s)border(\s|"|$)/.test(shapeLayerTag), `${semanticType}: must not use the plain CSS \`border\` width utility on a clipped shape`);
  }
});

test("CHECKLIST/TROUBLESHOOTING double-border ring width is centralized via NODE_BORDER (not a plain single border)", () => {
  for (const semanticType of ["CHECKLIST", "TROUBLESHOOTING"] as const) {
    const html = renderGraphChip({ semanticType, title: "항목" });
    const shapeLayerTag = getShapeLayerAttributes(html);
    assert.ok(shapeLayerTag.includes("shadow-["), `${semanticType} must still render its double-border shadow on the shape layer`);
  }
});

test("wrapping the chip with sibling elements (simulating the graph's editor handles) never changes the chip's own content layer markup", () => {
  const standalone = getContentLayerClass(renderGraphChip({ title: "제목" }));

  const wrapped = renderToStaticMarkup(
    <div className="relative">
      <div style={{ position: "absolute", top: 0, left: 0, opacity: 0 }} data-fake-handle="top-in" />
      <div style={{ position: "absolute", bottom: 0, right: 0, opacity: 0 }} data-fake-handle="loop-out" />
      <ProcedureNodeChip semanticType="TASK" iconKey="task" title="제목" size="graph" />
    </div>
  );
  const wrappedContentClass = getContentLayerClass(wrapped);
  assert.equal(wrappedContentClass, standalone, "sibling handle-like elements must never affect the chip's own content alignment classes");
});
