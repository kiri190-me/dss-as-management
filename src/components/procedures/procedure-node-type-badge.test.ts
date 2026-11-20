import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  PROCEDURE_NODE_TYPE_CODES,
  procedureNodeTypeLabels,
} from "@/lib/domain/procedure-template-types";
import { NODE_VISUAL_CONFIG, getSemanticNodeVisualType } from "@/lib/domain/procedure-visual-language";

/**
 * ============================================================================
 * **고른 노드의 유형 딱지** — 속성 패널 맨 위 (2026-11-20)
 * ============================================================================
 * 🔴 **무엇이 아팠는가**(쓰는 분이 겪은 그대로): [작업] 노드에 「다음 절차」를 열어
 * 준 날, 쓰는 분이 **「작업 노드인 줄 알고」** 기존 노드를 골랐는데 그 칸이 안 떴다.
 * 고른 것이 [검사]·[조치]였다. 그때까지 노드의 유형을 **글자로** 알 길은 속성 패널
 * 아래쪽 드롭다운을 열어 보는 것뿐이었고, 캔버스의 상자는 색과 모양으로만 갈랐다.
 *
 * 🔴 그 혼동이 색으로 안 풀리는 까닭이 ②절에 **값으로** 적혀 있다 —
 * [작업]·[검사]·[조치]는 그림 언어에서 **같은 색 식구**다. 색을 아무리 맞춰 와도
 * 셋은 똑같이 보인다. 그래서 **글자가 본체**이고, 색은 캔버스와 눈으로 잇는 거들기다.
 *
 * ── 왜 렌더가 아니라 원본을 읽는가 ──────────────────────────────────────
 * NodePropertyPanel 은 서버 액션을 직접 import 하는 클라이언트 컴포넌트라 사슬 끝에
 * `server-only` 가 있다 — 어느 목록에서도 import 자체가 던진다. 이웃
 * procedure-next-procedure-picker.test.ts 가 같은 사정에서 쓴 방법 그대로다.
 * 🔵 그 대신 **값으로 잴 수 있는 것은 값으로 잰다**(②·③절은 원본 글자를 안 본다).
 *
 * ── 🔴 주석을 걷어내고 센다 ─────────────────────────────────────────────
 * 이 자리에도 「왜 이렇게 했는지」가 길게 적혀 있고, 거기에 재려는 글자가 그대로 들어
 * 있다. 안 걷으면 「있어야 한다」 쪽이 주석만으로 영영 통과한다. ①절 첫 단언이
 * 걷어내기가 실제로 일을 하고 있다는 증거다.
 * ============================================================================
 */

const repoUrl = new URL("../../../", import.meta.url);
const read = (relativePath: string) => readFileSync(new URL(relativePath, repoUrl), "utf8");

function stripComments(source: string): string {
  return source
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, " ") // JSX 주석 {/* ... */}
    .replace(/\/\*[\s\S]*?\*\//g, " ") // 블록 주석
    .split(/\r?\n/)
    .filter((line) => !/^\s*\/\//.test(line)) // 줄 주석
    .join("\n");
}

const flat = (source: string) => source.replace(/\s+/g, " ");

const PANEL_PATH = "src/components/procedures/editor/NodePropertyPanel.tsx";
const CHIP_PATH = "src/components/procedures/visual/ProcedureNodeChip.tsx";

const panelRaw = read(PANEL_PATH);
const panel = flat(stripComments(panelRaw));
const chip = flat(stripComments(read(CHIP_PATH)));

/**
 * 🔴 **딱지 하나만 떼어 낸다.** 패널 전체에서 `procedureNodeTypeLabels[node.nodeType]`
 * 를 찾으면 **유형 변경 확인 창**이 같은 글자를 쓰고 있어 공짜로 통과한다 — 딱지를
 * 통째로 지워 놓고 돌려 보니 이 단언만 초록이었다(2026-11-20 실측). 그래서 표식
 * (`data-node-type`)에서 그 요소가 닫힐 때까지만 잘라서 본다.
 * 🔵 표식부터 자르므로 속성 순서가 바뀌어도 견딘다.
 */
const 딱지 = (() => {
  const marker = panel.indexOf("data-node-type={node.nodeType}");
  if (marker < 0) return null;
  const end = panel.indexOf("</span>", marker);
  return end < 0 ? null : panel.slice(marker, end);
})();

/** 패널 머리 — 제목 칸 앞까지. 확인 창·아래 칸들이 여기 섞이지 않는다. */
const 머리 = panel.slice(0, panel.indexOf("제목 (Shift+Enter로 줄바꿈)"));

describe("노드 유형 딱지 — ① 고르면 유형이 **글자로** 선다", () => {
  test("🔵 먼저 표본 — 주석 걷어내기가 실제로 일을 한다", () => {
    assert.ok(
      flat(panelRaw).includes("색만으로 가르지 않는다"),
      "표본이 되려면 패널 주석에 이 글이 실제로 있어야 한다"
    );
    assert.ok(!panel.includes("색만으로 가르지 않는다"), "걷어내기가 일을 안 하고 있다");
  });

  test("🔴 유형 **이름표를 그린다** — 색·모양만으로는 색약인 사람에게 같아 보인다", () => {
    assert.ok(딱지 !== null, "딱지 요소(data-node-type)를 아예 못 찾았다");
    assert.ok(
      딱지!.includes("{procedureNodeTypeLabels[node.nodeType]}"),
      "딱지가 글자를 안 그리면 색칠한 빈 상자가 되고, 이 조각이 푼 문제가 그대로 남는다"
    );
  });

  test("🔴 **제목 칸·유형 드롭다운보다 앞**에 선다 — 패널을 열자마자 눈에 들어와야 한다", () => {
    const 딱지자리 = panel.indexOf("data-node-type={node.nodeType}");
    const 제목칸 = panel.indexOf("제목 (Shift+Enter로 줄바꿈)");
    const 유형드롭다운 = panel.indexOf("노드 유형{isChangingType");
    assert.ok(딱지자리 >= 0 && 제목칸 >= 0 && 유형드롭다운 >= 0, "셋 다 찾아야 자리를 견줄 수 있다");
    assert.ok(딱지자리 < 제목칸, "제목 칸보다 뒤에 있으면 스크롤해야 보이는 자리다");
    assert.ok(
      딱지자리 < 유형드롭다운,
      "드롭다운을 열어 봐야 아는 것이 원래 문제였다 — 딱지가 그 아래 있으면 아무것도 안 바뀐다"
    );
  });

  test("🔴 **저장된 유형**(`node.nodeType`)을 그린다 — 고르는 중인 값이 아니다", () => {
    assert.ok(머리.includes("{procedureNodeTypeLabels[node.nodeType]}"));
    assert.ok(
      !머리.includes("procedureNodeTypeLabels[newNodeType]"),
      "`newNodeType` 은 아직 서버에 안 간 값이다 — 그것으로 그리면 적용 안 된 유형을 적용된 것처럼 보여 준다"
    );
  });
});

describe("노드 유형 딱지 — ② 색으로는 애초에 못 가른다 (값으로 잰다)", () => {
  test("🔴 [작업]·[검사]·[조치]는 그림 언어에서 **같은 색**이다 — 그래서 글자가 본체다", () => {
    const 작업 = NODE_VISUAL_CONFIG[getSemanticNodeVisualType("TASK")];
    const 검사 = NODE_VISUAL_CONFIG[getSemanticNodeVisualType("INSPECTION")];
    const 조치 = NODE_VISUAL_CONFIG[getSemanticNodeVisualType("CORRECTIVE_ACTION")];
    assert.equal(검사.bgLight, 작업.bgLight);
    assert.equal(조치.bgLight, 작업.bgLight);
    assert.equal(검사.borderLight, 작업.borderLight);
    assert.equal(조치.borderLight, 작업.borderLight);
    assert.equal(검사.shape, 작업.shape);
    assert.equal(조치.shape, 작업.shape);
  });

  test("🔵 그래도 색 자체는 **뜻이 있다** — 아홉 유형이 한 색이면 ②절이 공짜가 된다", () => {
    const 색들 = new Set(PROCEDURE_NODE_TYPE_CODES.map((t) => NODE_VISUAL_CONFIG[getSemanticNodeVisualType(t)].bgLight));
    assert.ok(색들.size > 1, `아홉 유형이 전부 같은 색이면 색을 가져올 까닭이 없다 — 지금 ${색들.size}가지`);
  });
});

describe("노드 유형 딱지 — ③ 유형마다 **다른 글자**가 뜬다 (값으로 잰다)", () => {
  test("🔵 먼저 표본 — 아홉 유형이 그 enum 의 전부다", () => {
    assert.equal(PROCEDURE_NODE_TYPE_CODES.length, 9);
  });

  test("🔴 아홉 이름이 **서로 다르고 비어 있지 않다** — 같은 글자면 딱지가 아무것도 안 알려 준다", () => {
    const 이름들 = PROCEDURE_NODE_TYPE_CODES.map((t) => procedureNodeTypeLabels[t]);
    for (const [i, t] of PROCEDURE_NODE_TYPE_CODES.entries()) {
      assert.ok(이름들[i].trim().length > 0, `${t} 의 이름이 비어 있다`);
    }
    assert.equal(new Set(이름들).size, 9, `이름이 겹친다: ${이름들.join(" · ")}`);
  });

  test("🔴 혼동의 당사자 셋이 서로 다른 글자다 — [작업]·[검사]·[조치]", () => {
    assert.equal(procedureNodeTypeLabels.TASK, "작업");
    assert.equal(procedureNodeTypeLabels.INSPECTION, "검사");
    assert.equal(procedureNodeTypeLabels.CORRECTIVE_ACTION, "조치");
  });
});

describe("노드 유형 딱지 — ④ 색은 **캔버스와 같은 곳**에서 온다", () => {
  test("🔴 그림 언어를 불러 쓴다 — 패널이 제 색을 새로 지으면 캔버스와 어긋난다", () => {
    assert.ok(
      panel.includes('from "@/lib/domain/procedure-visual-language"'),
      "색을 여기서 새로 지으면 같은 유형이 캔버스와 패널에서 다른 색이 되어 오히려 더 헷갈린다"
    );
    assert.ok(panel.includes("NODE_VISUAL_CONFIG[getSemanticNodeVisualType(node.nodeType)]"));
  });

  test("🔴 딱지 자리에 **hex 색을 박지 않는다** — 박으면 그림 언어가 바뀌어도 안 따라온다", () => {
    assert.equal(
      머리.match(/#[0-9a-fA-F]{6}\b/g),
      null,
      "패널 머리에 색 값이 글자로 적혀 있다 — NODE_VISUAL_CONFIG 에서 꺼내 써야 한다"
    );
  });

  test("🔵 밝은/어두운 두 벌을 **캔버스 칩과 같은 변수 이름**으로 나른다", () => {
    for (const 변수 of ["--node-bg-light", "--node-bg-dark", "--node-text-light", "--node-text-dark"]) {
      assert.ok(panel.includes(변수), `패널에 ${변수} 가 없다`);
      assert.ok(chip.includes(변수), `칩에 ${변수} 가 없다 — 이름이 갈리면 두 곳을 따로 고치게 된다`);
    }
  });
});

describe("노드 유형 딱지 — ⑤ 캔버스 노드 상자에는 **안 넣었다** (사용자 결정)", () => {
  /**
   * 🔵 2026-11-20 사용자 결정: 노드가 수백 개라 상자마다 유형 한 줄을 더하면 그림이
   * 빽빽해지고, 이번에 푸는 문제는 「지금 **고른** 노드가 무엇인가」다. 결정이
   * 코드에 안 적혀 있으면 다음 사람이 「딱지를 상자에도」로 읽는다.
   */
  test("🔴 칩이 유형 이름을 안 그린다 — 넣기로 바뀌면 이 시험부터 고치고 들어온다", () => {
    assert.ok(
      !chip.includes("procedureNodeTypeLabels"),
      "상자에 유형 글자를 넣기로 했다면 그 결정을 여기(와 패널 주석)에 먼저 적어야 한다"
    );
  });

  test("🔴 **안 넣은 까닭이 주석에 남아 있다** — 까닭 없는 빈자리는 실수로 읽힌다", () => {
    assert.ok(
      flat(panelRaw).includes("캔버스의 노드 상자에는 유형 글자를 안 넣었다"),
      "결정을 적어 둔 줄이 사라졌다 — 다음 사람이 빠뜨린 일로 읽고 상자에 넣는다"
    );
  });
});
