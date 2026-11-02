import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import ExecutionMemoFieldView from "./ExecutionMemoFieldView";
import { beginMemoEdit, memoFieldForNode, typeMemoDraft } from "@/lib/domain/procedure-execution-memo-field";

/**
 * 작업 메모 칸이 **그려지는 모습**(2026-11-03, 조각 12 — 사용자 결정: 「…
 * [수정]버튼을 누르고서 수정할 수 있도록 해줘」).
 *
 * 그려서 잰다 — 보이는 묶음(ExecutionMemoFieldView)은 상태도 서버 액션도 안 물게
 * 갈라 두었다. 상태를 들고 서버를 부르는 쪽(ExecutionMemoField)은 서버 액션을
 * 직접 import 하는 클라이언트 부품이라 여기서 못 그린다 — 그쪽의 불변식은 원본
 * 글자로 확인한다(아래 마지막 묶음).
 */

const SAVED = "FH-CONT 전압 23.4V\n규격 하한";

function render(options: {
  savedMemo?: string | null;
  editing?: boolean;
  draft?: string;
  eligible?: boolean;
  errorMessage?: string | null;
} = {}): string {
  const savedMemo = options.savedMemo === undefined ? SAVED : options.savedMemo;
  const base = memoFieldForNode({ executionNodeId: "e1", savedMemo });
  const field = options.editing
    ? typeMemoDraft(beginMemoEdit(base, { executionNodeId: "e1", savedMemo }), options.draft ?? savedMemo ?? "")
    : base;
  return renderToStaticMarkup(
    <ExecutionMemoFieldView
      fieldId="execution-node-memo-e1"
      field={field}
      savedMemo={savedMemo}
      eligible={options.eligible ?? true}
      isSubmitting={false}
      errorMessage={options.errorMessage ?? null}
      onEdit={() => {}}
      onDraftChange={() => {}}
      onSave={() => {}}
      onCancel={() => {}}
    />
  );
}

describe("🔵 먼저 — 칸이 실제로 그려지고 있다", () => {
  test("이름표와 저장된 글이 보인다", () => {
    const html = render();
    assert.ok(html.includes("작업 메모"), "이름표가 없으면 아래 판정이 전부 뜻을 잃는다");
    assert.ok(html.includes("FH-CONT 전압 23.4V"));
    assert.ok(html.includes("data-memo-field"));
  });
});

describe("🔴 평소에는 **글자**다 — [수정]을 눌러야 칸이 된다", () => {
  test("칸(textarea)이 아예 안 그려진다", () => {
    const html = render();
    assert.ok(!html.includes("<textarea"), "칸이 늘 열려 있으면 아무 때나 고쳐진다 — 이 조각이 고친 그것이다");
    assert.ok(html.includes("data-memo-view"));
    assert.ok(html.includes("data-memo-edit"), "[수정]이 없으면 고칠 길이 아예 없어진다");
    assert.ok(html.includes(">수정</button>"));
  });

  test("🔴 [저장]·[취소]는 **고치는 중에만** 뜬다", () => {
    const html = render();
    assert.ok(!html.includes("data-memo-save"));
    assert.ok(!html.includes("data-memo-cancel"));
  });

  test("[수정]을 누른 뒤에는 칸과 [저장]·[취소]가 서고, [수정]은 사라진다", () => {
    const html = render({ editing: true });
    assert.ok(html.includes("<textarea"));
    assert.ok(html.includes("data-memo-save") && html.includes("data-memo-cancel"));
    assert.ok(!html.includes("data-memo-edit"), "고치는 중에 [수정]이 또 있으면 무엇을 누를지 알 수 없다");
    assert.ok(html.includes("FH-CONT 전압 23.4V"), "칸에 저장된 글이 들어와 있어야 이어서 고친다");
  });

  test("칸에 적던 글이 그대로 그려진다", () => {
    assert.ok(render({ editing: true, draft: "새로 적는 글" }).includes("새로 적는 글"));
  });
});

describe("🔴 못 고치는 사람에게는 [수정]이 없다 — 글자는 보인다", () => {
  test("단추만 빠지고 메모는 그대로 읽힌다", () => {
    const html = render({ eligible: false });
    assert.ok(!html.includes("data-memo-edit"), "못 고치는 사람에게 단추를 그리면 눌러도 거절만 당한다");
    assert.ok(html.includes("FH-CONT 전압 23.4V"), "메모를 가리면 그 사람에게는 작업 메모가 아예 없는 화면이 된다");
  });
});

describe("메모가 비었을 때", () => {
  test("빈 네모 대신 그렇다고 적는다", () => {
    const html = render({ savedMemo: null });
    assert.ok(html.includes("작성된 작업 메모가 없습니다"));
    assert.ok(!html.includes("<textarea"));
  });

  test("여러 줄 메모는 줄바꿈을 지켜 그린다", () => {
    assert.match(render(), /whitespace-pre-wrap/);
  });
});

describe("서버가 거절하면 그 말을 칸 아래에 적는다", () => {
  test("오류 글이 그려진다", () => {
    assert.ok(render({ errorMessage: "다른 사용자가 이 작업을 먼저 변경했습니다." }).includes("다른 사용자가"));
  });
});

/**
 * 🔴 **상태를 들고 서버를 부르는 쪽의 불변식** — 원본 글자로.
 *
 * 특히 ㉠(「메모를 저장한 후에 다른 노드로 이동하게 되면 [작업 메모]가 비어있도록
 * 해줘」)의 고침이 **실제로 걸려 있는지**를 여기서 못 박는다. 규칙 자체는
 * procedure-execution-memo-field.test.ts 가 값으로 재지만, 컴포넌트가 그 함수를
 * 안 부르면 화면에서는 옛 결함 그대로다.
 */
describe("🔴 메모 칸의 상태를 다루는 쪽 — 원본 글자로", () => {
  const stripComments = (source: string) =>
    source
      .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, " ")
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .split(/\r?\n/)
      .filter((line) => !/^\s*\/\//.test(line))
      .join("\n");

  const raw = readFileSync(new URL("./ExecutionMemoField.tsx", import.meta.url), "utf8");
  const field = stripComments(raw);
  const flat = field.replace(/\s+/g, " ");

  test("🔵 주석 걷어내기가 실제로 돌고 있다", () => {
    assert.ok(raw.includes("🔴"));
    assert.ok(!field.includes("🔴"), "주석이 남으면 아래 「없어야 한다」가 주석만 보고 깨진다");
  });

  test("🔴 **노드가 바뀌면 칸을 다시 세운다** — 그리는 중에 맞춘다(효과로 미루면 옛 글자가 한 번 그려진다)", () => {
    assert.match(flat, /const reconciled = nextMemoFieldState\(field, \{ executionNodeId, savedMemo \}\);/);
    assert.match(flat, /if \(reconciled !== field\) \{ setField\(reconciled\); setErrorMessage\(null\); \}/);
  });

  test("🔴 규칙을 컴포넌트가 **다시 적지 않는다** — 도메인 함수가 정한 그대로 쓴다", () => {
    for (const fn of ["memoFieldForNode", "nextMemoFieldState", "beginMemoEdit", "cancelMemoEdit", "typeMemoDraft", "memoSavePayload"]) {
      assert.ok(field.includes(fn), `${fn} 을 써야 한다`);
    }
    assert.ok(!/useEffect/.test(field), "효과로 맞추면 한 번은 앞 노드의 글자가 그려진다");
    assert.ok(!/isMemoDirty/.test(field), "「고쳤는가」로 단추를 띄우던 옛 방식이 남아 있다");
  });

  test("🔴 저장은 **전과 같은 통로**이고, 그 줄의 version 을 싣는다", () => {
    assert.match(flat, /updateExecutionNodeMemoAction\(\{ executionNodeId, expectedVersion: executionNodeVersion, memo: memoSavePayload\(reconciled\), \}\)/);
  });

  test("저장하면 보기로 돌아가고, 화면을 다시 읽고, 저장 팝업을 띄운다", () => {
    assert.match(flat, /setField\(\{ \.\.\.reconciled, isEditing: false \}\); router\.refresh\(\); showSavePopup\(\{ message: "메모를 저장했습니다\.", redirectTo: null \}\);/);
  });

  test("🔴 칸을 쓰는 **세 자리가 같은 부품**을 쓴다 — 두 벌로 두면 한쪽만 고치는 날이 온다", () => {
    for (const path of ["./CurrentTaskCard.tsx", "./ExecutionNodeCard.tsx", "./ProcedureExecutionScreen.tsx"]) {
      const source = stripComments(readFileSync(new URL(path, import.meta.url), "utf8"));
      assert.ok(source.includes("<ExecutionMemoField"), `${path} 이 칸을 제 손으로 만들고 있다`);
      assert.ok(!/<textarea[\s\S]*작업 메모|작업 메모[\s\S]{0,200}<textarea/.test(source), `${path} 에 옛 메모 칸이 남아 있다`);
      assert.ok(!source.includes("updateExecutionNodeMemoAction"), `${path} 이 메모 통로를 따로 부른다`);
    }
  });
});
