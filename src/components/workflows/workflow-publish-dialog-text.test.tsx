import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import WorkflowDraftConfirmDialog from "./WorkflowDraftConfirmDialog";

/**
 * 발행 확인 창이 **사실을 말하는가**(2026-09-30).
 *
 * 🔴 이 창은 2026-09-30까지 정반대를 말하고 있었다: "진행 중인 접수 건은 접수
 * 당시 버전을 그대로 따라가므로 영향을 받지 않습니다". 그런데 같은 날 발행이
 * 진행 중인 건을 새 버전으로 **함께 옮기기** 시작했고(mutations/workflow-drafts.ts
 * 의 migrateInFlightCasesToVersion), 그 뒤로 이 문장은 거짓이었다. 되돌릴 수 없는
 * 조작 직전에 읽는 마지막 설명이 거짓이면, 그 말을 믿고 누른 사람은 수십 건이
 * 움직이는 것을 예상하지 못한다.
 *
 * 그래서 못박는 것이 둘이다:
 *   · 창이 지금의 이관 규칙을 그대로 말하는가 — 옛 문장이 되살아나지 못하게 한다.
 *   · 🔴 **그 규칙이 정말 그러한가** — 발행이 migrateInFlightCasesToVersion 을
 *     부르는지 원본으로 본다. 이관을 떼어내면 이 시험이 깨지고, 그때 창 문구도
 *     함께 고치게 된다. 문구만 검사하면 정책이 바뀌어도 조용히 통과한다.
 *
 * 폐기 쪽 문구는 그대로다 — 초안은 발행 전까지 어디에도 적용되지 않으므로 그
 * 설명은 여전히 사실이다. 그 문장이 딸려 바뀌지 않았는지도 함께 본다.
 *
 * 🔴 같은 거짓이 **자리 둘**에 있었다. 확인 창과, 초안 편집 화면 제목 아래의 한
 * 줄 설명(app/(app)/workflows/[code]/draft/page.tsx)이다. 한쪽만 지키면 다음에
 * 또 한쪽만 고쳐져 같은 화면에서 두 글이 반대말을 한다 — 그래서 두 자리를 이
 * 파일 하나가 함께 본다. 화면 쪽은 서버 컴포넌트 + server-only 라 그려 볼 수
 * 없어 원본을 글자로 읽는다.
 */

function textOf(kind: "publish" | "discard"): string {
  const markup = renderToStaticMarkup(
    <WorkflowDraftConfirmDialog
      isOpen
      kind={kind}
      versionNumber={7}
      isSubmitting={false}
      onConfirm={() => {}}
      onCancel={() => {}}
    />
  );
  // <strong> 이 문장 가운데를 가르므로 태그를 걷어내고 글자만 본다.
  return markup.replace(/<[^>]+>/g, "");
}

test("🔴 발행 창이 '진행 중인 건도 옮겨진다'고 말한다", () => {
  const text = textOf("publish");
  assert.match(text, /진행 중인 접수 건도 이 구성으로 옮겨집니다/);
  assert.match(text, /같은 단계/, "어느 단계에 서게 되는지를 말해야 한다");
  assert.match(text, /단계가 앞으로 가거나 뒤로 가지 않습니다/);
});

test("🔴 옮기지 않는 것도 말한다 — 출하 완료 · 갈 곳 없는 건", () => {
  const text = textOf("publish");
  assert.match(text, /출하 완료된 건은 움직이지 않/);
  assert.match(text, /현재 단계가 새 버전에 없는 건은 이전 버전에 남습니다/);
});

test("몇 건이 옮겨졌는지는 도착 화면이 알려 준다고 적는다", () => {
  assert.match(textOf("publish"), /도착 화면이 알려 줍니다/);
});

test("🔴 옛 거짓 문장이 되살아나지 않는다", () => {
  const text = textOf("publish");
  assert.doesNotMatch(text, /이후 접수되는 건부터/, "옛 문장의 앞머리다");
  assert.doesNotMatch(text, /접수 당시\s*버전을 그대로 따라/);
  assert.doesNotMatch(text, /영향을 받지 않습니다/);
});

test("둘째 문단은 그대로다 — 지금 발행본은 보관됨으로 내려간다", () => {
  const text = textOf("publish");
  assert.match(text, /보관됨/);
  assert.match(text, /한 번에 되돌리는 기능은 아직 없습니다/);
});

test("폐기 쪽 문구는 건드리지 않았다 — 초안은 아직 어디에도 적용되지 않는다", () => {
  const text = textOf("discard");
  assert.match(text, /편집한 내용이 모두 사라집니다/);
  assert.match(text, /현재 발행본과 진행 중인 접수 건에는 영향이 없습니다/);
  assert.doesNotMatch(text, /옮겨집니다/, "폐기는 접수 건을 옮기지 않는다");
});

test("문구만 바꿨다 — 창의 동작은 그대로다", () => {
  const source = readFileSync(join(process.cwd(), "src/components/workflows/WorkflowDraftConfirmDialog.tsx"), "utf8");
  assert.match(source, /export type WorkflowDraftConfirmKind = "publish" \| "discard";/);
  assert.match(source, /dialog\.showModal\(\)/);
  assert.match(source, /dialog\.close\(\)/);
  assert.match(source, /onClick=\{onConfirm\}/);
  assert.match(source, /onClick=\{onCancel\}/);
  // 두 조작의 단추 문구도 그대로.
  const publishText = textOf("publish");
  assert.match(publishText, /발행/);
  assert.match(publishText, /취소/);
});

const DRAFT_PAGE = readFileSync(
  join(process.cwd(), "src/app/(app)/workflows/[code]/draft/page.tsx"),
  "utf8"
);

test("🔴 초안 편집 화면의 한 줄 설명도 같은 말을 한다", () => {
  // 앞 문장은 여전히 사실이라 살려 둔다 — 초안은 발행 전까지 아무 데도 안 닿는다.
  assert.match(DRAFT_PAGE, /발행하기 전까지는 어떤 접수 건에도 영향이 없습니다/);
  assert.match(DRAFT_PAGE, /진행 중인 접수 건도<\/strong> 이 구성으로 옮겨집니다/);
  assert.match(DRAFT_PAGE, /같은\s+단계에 섭니다/, "어느 단계에 서는지까지 말해야 한다");
});

test("🔴 그 화면에서도 옛 거짓 문장이 되살아나지 않는다", () => {
  // 🔴 줄바꿈으로 빠져나가지 못하게 낱말 사이를 \s+ 로 읽는다. 주석에 옛 문장을
  // 그대로 적어 두면(한때 그랬다) 줄이 접히면서 이 검사가 무뎌진다 — 그래서 두
  // 파일 모두 옛 문장을 옮겨 적지 않고 뜻만 적는다.
  assert.doesNotMatch(DRAFT_PAGE, /이후\s+접수되는\s+건부터/);
  assert.doesNotMatch(DRAFT_PAGE, /접수\s+당시\s+버전을\s+그대로\s+따라/);
  // 확인 창 쪽 원본도 같은 잣대로 본다(그려 본 글자만 보면 주석은 안 잡힌다).
  const dialog = readFileSync(
    join(process.cwd(), "src/components/workflows/WorkflowDraftConfirmDialog.tsx"),
    "utf8"
  );
  assert.doesNotMatch(dialog, /이후\s+접수되는\s+건부터/);
  assert.doesNotMatch(dialog, /접수\s+당시\s+버전을\s+그대로\s+따라/);
});

test("제목 아래 설명은 확인 창보다 짧다 — 자세한 것은 누를 때 다시 말한다", () => {
  // 확인 창의 둘째 문단을 여기 옮겨 오면 제목 아래가 안내문으로 뒤덮인다.
  assert.doesNotMatch(DRAFT_PAGE, /출하 완료된 건은 움직이지 않/);
  assert.doesNotMatch(DRAFT_PAGE, /도착 화면이 알려 줍니다/);
});

test("🔴 창이 말하는 규칙이 실제 규칙과 같다 — 발행이 이관을 부른다", () => {
  const mutation = readFileSync(join(process.cwd(), "src/lib/db/mutations/workflow-drafts.ts"), "utf8");
  // 발행 함수 안에서 이관을 부르는지 본다. 이관을 떼어내면 여기서 걸리고,
  // 그때 위 문구도 함께 고쳐야 한다.
  assert.match(
    mutation,
    /export async function publishWorkflowDraft[\s\S]*?await migrateInFlightCasesToVersion\(tx, \{/,
    "발행이 진행 중인 건을 옮기지 않게 되면 창의 설명이 거짓이 된다"
  );
});
