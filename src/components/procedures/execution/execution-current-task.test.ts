import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * 「지금 할 일」 큰 카드와, 그것을 세우는 실행 화면의 🔴 불변식.
 *
 * ── 왜 렌더가 아니라 원본을 읽는가 ──────────────────────────────────────
 * CurrentTaskCard 는 **서버 액션을 직접 import 하는 클라이언트 컴포넌트**다
 * (@/lib/server/actions/procedure-case-execution → server-only). 그 사슬 때문에
 * react-server 조건 없이 도는 test:components 에서는 import 자체가 던진다.
 * ProcedureExecutionScreen 은 아예 서버 컴포넌트이고 DB 조회 타입을 끌고 온다.
 * 그래서 이웃 시험(procedure-publish-flow.test.tsx)이 같은 사정에서 쓴 방법을
 * 그대로 쓴다 — 판정이 적혀 있는 자리를 원본에서 직접 확인한다.
 *
 * 서버 쪽 동작(완료하면 다음이 선다 · 끝난 것을 안 되살린다 · 남의 진행 중을
 * 안 끈다)은 통합 시험이 덮는다 — procedure-case-execution.integration.test.ts
 * 의 30~38번. 고르는 규칙 자체는 procedure-execution-focus.test.ts 가 덮는다.
 *
 * ── 🔴 주석을 걷어내고 센다 ─────────────────────────────────────────────
 * 이 저장소는 「왜」를 길게 적는다. 주석에 낱말이 적혀 있다는 이유로 「있어야
 * 한다」가 영영 통과한 적이 있고, 반대로 「없어야 한다」가 주석 때문에 틀리게
 * 깨진 적도 있다. 그래서 모든 판정은 **주석을 걷어낸 글자**로만 한다.
 */

const repoUrl = new URL("../../../../", import.meta.url);
const read = (relativePath: string) => readFileSync(new URL(relativePath, repoUrl), "utf8");

function stripComments(source: string): string {
  return source
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, " ") // JSX 주석 {/* ... */}
    .replace(/\/\*[\s\S]*?\*\//g, " ") // 블록 주석
    .split(/\r?\n/)
    .filter((line) => !/^\s*\/\//.test(line)) // 줄 주석
    .join("\n");
}

/** 줄바꿈·들여쓰기 차이로 시험이 깨지지 않도록 공백을 하나로 접는다. */
const flat = (source: string) => source.replace(/\s+/g, " ");

const cardRaw = read("src/components/procedures/execution/CurrentTaskCard.tsx");
const screenRaw = read("src/components/procedures/execution/ProcedureExecutionScreen.tsx");
const smallCardRaw = read("src/components/procedures/execution/ExecutionNodeCard.tsx");
const card = stripComments(cardRaw);
const screen = stripComments(screenRaw);
const smallCard = stripComments(smallCardRaw);

describe("🔵 먼저 — 주석 걷어내기가 실제로 돌고 있다", () => {
  test("걷어낸 글자가 원본보다 짧고, 주석에만 쓰는 표시(🔴)가 남지 않는다", () => {
    for (const [name, raw, stripped] of [
      ["CurrentTaskCard", cardRaw, card],
      ["ProcedureExecutionScreen", screenRaw, screen],
    ] as const) {
      assert.ok(raw.includes("🔴"), `${name} 원본에 🔴 주석이 있어야 이 확인이 뜻을 가진다`);
      assert.ok(stripped.length < raw.length, `${name}: 걷어낸 것이 없다 — 스트리퍼가 안 듣는다`);
      assert.ok(!stripped.includes("🔴"), `${name}: 주석이 남아 있으면 아래 판정이 주석만 보고 통과한다`);
    }
  });
});

describe("지금 할 일 큰 카드", () => {
  test("🔴 지시문(instructions)을 펼쳐서 그린다 — 줄바꿈을 살려서", () => {
    // 이 화면의 가장 큰 결핍이 「제목만 있고 무엇을 어떻게 하는지가 없다」였다.
    assert.match(
      flat(card),
      /whitespace-pre-wrap[^>]*>\s*\{node\.instructions\}/,
      "지시문을 whitespace-pre-wrap 으로 그려야 절차에 적힌 줄바꿈이 남는다"
    );
    assert.ok(!/<details/.test(card), "지시문을 접어 두면 또 안 읽힌다");
  });

  test("지시문이 없는 작업에는 빈자리 대신 까닭을 적는다", () => {
    assert.match(flat(card), /\{node\.instructions \? \(/);
    assert.match(card, /절차에 적힌 지시문이 없습니다/);
  });

  test("번호(orderIndex)와 노드 갈래 딱지와 제목이 모두 있다", () => {
    assert.match(flat(card), /\{node\.orderIndex > 0 &&/, "번호가 안 매겨진 줄(0)은 자리를 비운다");
    assert.match(flat(card), /\{node\.orderIndex\}/);
    assert.match(flat(card), /procedureNodeTypeLabels\[node\.nodeType\]/);
    assert.match(flat(card), /\{node\.title\}/);
  });

  test("🔴 판단 갈래 단추가 **창 없이** 처음부터 보인다", () => {
    // 전에는 [완료]를 눌러야 DecisionCompleteDialog 가 떴다. 큰 카드에서는
    // 갈래가 곧 단추이고, 고르는 것이 곧 완료다.
    assert.ok(
      !/DecisionCompleteDialog/.test(card),
      "큰 카드가 완료 창을 띄우면 갈래가 또 한 번 가려진다"
    );
    assert.match(flat(card), /\{node\.outgoingEdgeOptions\.map\(\(edge\) => \(/);
    assert.match(flat(card), /onClick=\{\(\) => handleBranchComplete\(edge\.edgeId\)\}/);
  });

  test("🔴 갈래 단추에 **갈래 이름과 갈 노드 제목**이 함께 보인다", () => {
    // 「NG」만 적혀 있으면 그것이 무엇으로 이어지는지 모른 채 고르게 된다.
    assert.match(flat(card), /\{formatBranchChoiceLabel\(edge\)\}/);
    assert.match(flat(card), /→ \{edge\.toNodeTitle\}/);
  });

  test("🔴 갈래가 하나도 안 그려진 판단 노드에는 눌리지 않을 [완료]를 그리지 않는다", () => {
    // 게시된 절차 하나가 노드 23개에 간선 8개뿐인 「그리다 만」 상태다.
    assert.match(flat(card), /const decisionHasNoBranch = isDecision && node\.outgoingEdgeOptions\.length === 0;/);
    assert.match(flat(card), /\{!isDecision && \( <button/, "판단 노드에는 맨 [완료] 단추를 그리지 않는다");
    assert.match(card, /갈래가 그려져 있지 않아 완료할 수 없습니다/);
  });

  test("🔴 단추는 작은 카드와 **같은 서버 액션**을 부른다 — 새 통로를 만들지 않았다", () => {
    // 🔵 2026-11-03(조각 12): 메모 통로(updateExecutionNodeMemoAction)가 이 목록에서
    //    빠졌다 — **칸이 제 부품으로 갈라져**(ExecutionMemoField) 두 카드가 그것을
    //    함께 쓴다. 통로는 여전히 하나이고, 「세 자리가 같은 부품을 쓰는가」는
    //    execution-memo-field.test.tsx 가 본다.
    for (const action of [
      "startExecutionNodeAction",
      "completeExecutionNodeAction",
      "skipExecutionNodeAction",
      "blockExecutionNodeAction",
    ]) {
      assert.ok(card.includes(action), `${action} 을 써야 한다`);
      assert.ok(smallCard.includes(action), `표본 확인 — 작은 카드도 ${action} 을 쓴다`);
    }
    assert.match(
      flat(card),
      /completeExecutionNodeAction\(\{ executionNodeId: node\.id, expectedVersion: node\.version, selectedOutgoingEdgeId \}\)/,
      "갈래는 기존 완료 액션의 인자로 실어 보낸다"
    );
  });

  test("작업 메모 칸이 있고, **[수정]을 눌러야** 고쳐진다", () => {
    // 🔵 2026-11-03(조각 12 — 사용자 결정: 「[수정]버튼을 누르고서 수정할 수
    //    있도록 해줘」). 전에는 이 카드가 제 textarea 를 늘 열어 두고 「고쳤는가」
    //    (isMemoDirty)로 저장 단추를 띄웠다. 지금은 칸이 한 벌로 갈라져 나갔고,
    //    평소에는 글자만 보인다. 단언을 지우지 않고 **새 자리에서** 같은 것을
    //    재도록 옮겼다 — 칸이 이 카드에 **있는가**와 **아무 때나 안 열리는가**.
    assert.match(flat(card), /<ExecutionMemoField/);
    assert.ok(!/<textarea/.test(card), "카드가 제 칸을 다시 만들면 두 벌이 된다");
    assert.ok(!/isMemoDirty/.test(card), "「고쳤는가」로 단추를 띄우던 옛 방식이 남아 있다");
    assert.match(flat(card), /savedMemo=\{node\.workMemo\}/, "저장된 메모를 안 넘기면 칸이 빈 채로 선다");
  });

  test("🔴 권한 판정은 작은 카드와 **한 곳**에서 나온다", () => {
    // 두 벌로 두면 한쪽만 고치는 날이 오고, 타입이 같아 컴파일러는 말이 없다.
    assert.match(card, /isOrdinaryActionEligible\(actingUser, node\.effectiveAssigneeId\)/);
    assert.match(smallCard, /isOrdinaryActionEligible\(actingUser, node\.effectiveAssigneeId\)/);
    assert.ok(
      !/role === "SUPER_ADMIN"/.test(card) && !/role === "SUPER_ADMIN"/.test(smallCard),
      "역할 비교가 카드 안에 되살아나면 두 벌이 된다"
    );
  });
});

describe("실행 화면 — 어느 하나를 세우고, 아래 목록을 어떻게 두는가", () => {
  test("🔴 「지금 할 일」은 추천이 아니라 절차 차례로 고른다", () => {
    // isSuggestedNext 는 들어오는 간선이 없으면 켜진다 — 그리다 만 절차에서는
    // 거의 전부가 추천이라 「고른 것」이 되지 않는다.
    // 🔵 2026-11-02(조각 5): 둘째 인자로 「마친 실행인가」가 붙었다. 재는 것은
    // 그대로 — **원본 배열**을 넘기는가이고, 거기에 「마쳤으면 아무것도 안
    // 고른다」가 더해졌다.
    assert.match(flat(screen), /const currentTask = pickCurrentTask\(executionDetail\.nodes, \{ isExecutionFinished \}\);/);
    assert.ok(
      !/pickCurrentTask\(pendingNodes\)/.test(screen),
      "pendingNodes 는 추천을 앞으로 끌어올린 배열이고 진행 중이 빠져 있다"
    );
  });

  test("큰 카드는 요약과 아래 구역 **사이**에 서고, 흐름 띠 바로 아래다", () => {
    // 🔵 2026-11-02(조각 3): 전에는 「요약 **바로** 아래」였다. 그 사이에 작은
    // 흐름 띠(ExecutionFlowStrip)가 한 줄 들어왔으므로, 재는 것을 「무엇과
    // 무엇 사이인가」로 바꾼다. 단언을 약하게 한 것이 아니라 **차례를 셋으로**
    // 늘렸다 — 띠가 큰 카드 아래로 내려가면 여기서 깨진다.
    //
    // 🔵 2026-11-02(조각 10): 아래 첫 구역이 「실행 가능」에서 「차단됨」으로
    // 바뀌었다(앞의 둘은 팝업으로 옮겨 갔다). 🔴 표지를 안 고치면 indexOf 가
    // -1 이 되어 **화면 끝까지**를 자르고도 조용히 통과한다.
    const firstSectionAt = flat(screen).indexOf('<NodeSection title="차단됨"');
    assert.ok(firstSectionAt > 0, "아래 첫 구역을 못 찾았다 — 자르는 자리가 없으면 아래가 아무것도 안 잰다");
    const between = flat(screen).slice(flat(screen).indexOf("<ProgressSummary"), firstSectionAt);
    assert.ok(between.length > 0, "요약 카드와 첫 구역 사이를 찾지 못했다");
    assert.match(between, /<CurrentTaskCard node=\{currentTask\.node\}/);
    assert.match(between, /<NoCurrentTaskCard reason=\{currentTask\.reason\}/);
    assert.ok(
      between.indexOf("<ExecutionFlowStrip") >= 0 &&
        between.indexOf("<ExecutionFlowStrip") < between.indexOf("<CurrentTaskCard"),
      "흐름 띠는 큰 카드 **위**다 — 아래로 내려가면 큰 카드가 띠에 밀려 내려간다"
    );
  });

  test("🔴 아래 목록에서 같은 카드를 두 번 그리지 않는다 — 자리는 남기고 위를 가리킨다", () => {
    assert.match(
      flat(screen),
      /node\.id === currentTaskNodeId \? \(/,
      "위에 선 노드는 목록에서 전체 카드로 다시 그리지 않는다"
    );
    assert.match(screen, /맨 위 「지금 할 일」에 있습니다/);
    // 목록에서 통째로 빼면 「방금 보던 카드가 사라졌다」가 또 된다 — 자리는 남긴다.
    assert.ok(
      !/filter\(\(n\) => n\.id !== currentTaskNodeId\)/.test(screen),
      "목록에서 걸러내면 카드가 사라진 것처럼 보인다"
    );
  });

  test("🔴 구역 머릿수는 위로 올라간 한 장까지 센다 — 「진행 중 (0)」인데 하나 있는 화면이 되면 안 된다", () => {
    assert.match(flat(screen), /\{title\} \(\{nodes\.length\}\)/);
  });

  test("남은 구역이 어느 노드가 위에 올라갔는지 전달받는다", () => {
    // 🔵 2026-11-02(조각 10): 넷에서 둘로 줄었다 — 「실행 가능」·「진행 중」은
    //    「전체 단계 보기」 팝업이 맡는다. 🔵 2026-11-03(조각 12): 둘에서 **하나**가
    //    됐다 — 「완료 / 건너뜀」 카드 구역이 「실행 이력」의 시간순 줄로 바뀌었다
    //    (노드 행은 하나뿐이라 다시 밟은 기록을 적을 자리가 없었다).
    //    재는 뜻은 그대로다: **카드를 그리는 구역**은 위로 올라간 한 장을 알아야
    //    같은 카드를 두 번 그리지 않는다.
    const sections = flat(screen).match(/<NodeSection[\s\S]*?\/>/g) ?? [];
    assert.equal(sections.length, 1, "남은 카드 구역은 「차단됨」 하나다");
    for (const section of sections) {
      assert.match(section, /currentTaskNodeId=\{currentTaskNodeId\}/);
    }
  });

  test("🔴 할 일이 없을 때 까닭을 갈라 말한다 — 「다 끝났다」와 「전부 차단됐다」는 다음 행동이 반대다", () => {
    assert.match(screen, /모든 작업이 끝났습니다/);
    assert.match(screen, /남은 작업이 모두 차단돼 있습니다/);
    assert.match(flat(screen), /reason === "ALL_FINISHED"/);
    assert.match(flat(screen), /reason === "ALL_BLOCKED"/);
  });

  test("남은 구역 목록과 작은 카드는 그대로다", () => {
    // 🔵 2026-11-02(조각 10): 「실행 가능」·「진행 중」이 팝업으로 옮겨 갔다.
    //    🔵 2026-11-03(조각 12): 「완료 / 건너뜀」이 「실행 이력」의 시간순 줄로
    //    갔다. 그 구역을 재던 단언은 지우지 않고 **새 자리에서** 재도록 옮겼다 —
    //    끝난 작업의 [재개(되돌림)]가 그 줄에 붙는지는 아래에서 본다.
    //    🔴 「차단됨」은 **남는다** — 팝업은 차단된 칸으로 못 옮기므로(사유 없이
    //    푸는 길을 안 낸다), 걷으면 막힌 절차를 다시 흐르게 할 방법이 화면
    //    어디에도 안 남는다.
    assert.ok(screen.includes('title="차단됨"'), "차단됨 구역이 사라지면 안 된다");
    assert.ok(!screen.includes('title="완료 / 건너뜀"'), "노드 번호 차례의 카드 구역이 되살아났다");
    assert.match(screen, /<ExecutionNodeCard key=\{node\.id\}/, "작은 카드는 계속 쓴다");
    // 🔴 「차단됨」 카드에 [재개(되돌림)]가 실제로 붙는지는 작은 카드 쪽에서 본다 —
    //    그 단추가 BLOCKED 에 안 붙으면 위 구역이 남아도 아무 소용이 없다.
    assert.match(smallCard, /node\.status === "BLOCKED"/);
    assert.match(smallCard, /<ExecutionNodeReopenButton/);
    // 🔴 끝난 작업 쪽은 **실행 이력의 줄**에 붙는다(조각 12). 화면에서 그 단추가
    //    통째로 사라지면 끝난 것을 되돌릴 길이 아무 데도 안 남는다.
    assert.match(flat(screen), /<ExecutionNodeReopenButton executionNodeId=\{node\.id\}/);
    assert.match(flat(screen), /isReopenEligible\(actingUser, node\.status, node\.effectiveAssigneeId\)/);
  });
});
