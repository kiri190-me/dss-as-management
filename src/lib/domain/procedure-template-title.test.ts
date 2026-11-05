import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { formatProcedureTemplateTitle } from "./procedure-template-title";

/**
 * 절차의 한 줄 이름(2026-11-02, 조각 6). 재는 것은 둘이다 — 함수가 무엇을
 * 돌려주는가, 그리고 **쓰는 자리가 제 손으로 다시 조립하지 않는가.**
 *
 * 뒤엣것을 같이 재는 까닭: 둘 다 string 이라 한쪽이 옛 모양으로 돌아가도
 * 컴파일러가 아무 말을 안 한다. 글자만 이상해지는 종류라 시험이 없으면 영영
 * 안 걸린다.
 *
 * ── 🔴 2026-11-05 — 이 파일의 앞 절반이 **뒤집혔다** ─────────────────────
 * 전에는 「코드가 이름과 다르면 괄호로 붙인다」가 이 함수의 규칙이었고, 그 아래
 * 「🔵 코드를 아예 숨기지 않는다 — 이름이 같은 절차가 둘일 때 가를 수단이 그것
 * 뿐이다」가 **초록으로 통과하고 있었다.** 사용자 결정으로 코드를 화면에서 걷으면서
 * 그 단언이 그대로 **거짓말**이 됐다(단언 자체는 여전히 맞게 고칠 수 있지만, 그러면
 * 초록 ✔ 옆에 지금 쓰지 않는 규칙이 적혀 있게 된다).
 *
 * 🔴 지우지 않고 **반대 방향으로 고쳤다.** 이제 재는 것은 「코드를 붙이는가」가
 * 아니라 **「어떤 코드를 줘도 이름만 나오는가」**다. 옛 모양이 조용히 돌아오는 것을
 * 막는 몫은 아래 ③절(쓰는 자리가 손으로 이어 붙이지 않는가)이 그대로 들고 있다.
 */

/** 실측 2026-11-02 — 코드 칸에 이름이 그대로 들어간 절차가 개발 DB 에 있다. */
const MEASURED_SAME = "기본 통전 검사 (3상 입력)";

describe("🔴 어떤 코드를 줘도 **이름만** 나온다 (2026-11-05 결정)", () => {
  test("코드가 이름과 **달라도** 안 붙는다 — 전에는 「이름 (코드)」였다", () => {
    const title = formatProcedureTemplateTitle("원복 검사 및 개선 작업 (3상 입력)", "7");
    assert.equal(title, "원복 검사 및 개선 작업 (3상 입력)");
    // 🔵 표본 확인 — 옛 모양이면 이렇게 떴다. 이 줄이 터지면 결정이 되돌아간 것이다.
    assert.notEqual(title, "원복 검사 및 개선 작업 (3상 입력) (7)");
  });

  test("서버가 지은 코드도 안 새어 나온다 — 사람에게 아무 뜻이 없는 글자다", () => {
    // 새 절차의 코드는 이제 TECH-YYYYMMDD-XXXXXX 꼴이다(procedure-template-code.ts).
    const title = formatProcedureTemplateTitle("새 기술 절차", "TECH-20261105-K7M2QX");
    assert.equal(title, "새 기술 절차");
    assert.ok(!title.includes("TECH-"), "지어진 코드가 화면 글자에 섞였다");
  });

  test("🔴 이름이 같으면 **둘이 같은 글자가 된다** — 이것이 뒤집힌 결정의 값이다", () => {
    // 전에는 여기서 notEqual 을 쟀다("가를 수단이 코드뿐이다"). 지금은 반대다:
    // 이름이 겹치는 계열이 0건이라(실측 2026-11-05) 가를 일이 없다고 본 결정이고,
    // 겹치는 날이 오면 **이 단언이 그 사실을 말해 주는 자리**가 된다.
    assert.equal(
      formatProcedureTemplateTitle("기본 통전 검사", "RFG-01"),
      formatProcedureTemplateTitle("기본 통전 검사", "RFG-02")
    );
  });

  test("코드 칸에 이름이 들어간 실측 절차에서도 「이름 (이름)」이 안 나온다", () => {
    assert.equal(formatProcedureTemplateTitle(MEASURED_SAME, MEASURED_SAME), MEASURED_SAME);
    assert.notEqual(formatProcedureTemplateTitle(MEASURED_SAME, MEASURED_SAME), `${MEASURED_SAME} (${MEASURED_SAME})`);
  });

  test("코드가 비었거나 없어도 그대로 이름만 — 넘기는 쪽이 무엇을 줘도 한 모양이다", () => {
    assert.equal(formatProcedureTemplateTitle("이름만 있는 절차", ""), "이름만 있는 절차");
    assert.equal(formatProcedureTemplateTitle("이름만 있는 절차", "   "), "이름만 있는 절차");
    assert.equal(formatProcedureTemplateTitle("이름만 있는 절차", null), "이름만 있는 절차");
    assert.equal(formatProcedureTemplateTitle("이름만 있는 절차", undefined), "이름만 있는 절차");
  });
});

describe("🔴 쓰는 자리가 **제 손으로 다시 조립하지 않는다**", () => {
  const read = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");
  // 2026-11-02(조각 7) — 불러오기 드롭다운이 ExecutionStartCard 에서
  // ProcedureStartPickerPanel 로 옮겨 갔다(창이 넓어지면서 절차 드롭다운·노드
  // 검색·플로우차트가 한 묶음이 됐다). 드롭다운을 **따라간다** — 글자를 만드는
  // 자리가 거기다. 검색 결과 줄(절차 이름이 앞에 붙는 그 줄)도 같은 파일이 쓴다.
  const places = [
    ["실행 요약 카드", "src/components/procedures/execution/ProcedureExecutionScreen.tsx"],
    ["불러오기 드롭다운·검색 결과", "src/components/procedures/execution/ProcedureStartPickerPanel.tsx"],
    ["불러오기 검색 판정", "src/lib/domain/procedure-start-picker.ts"],
    ["지나간 절차 줄", "src/lib/domain/procedure-execution-past-runs.ts"],
  ] as const;

  test("🔵 먼저 — 네 자리가 모두 이 함수를 부른다", () => {
    for (const [label, path] of places) {
      assert.match(read(path), /formatProcedureTemplateTitle/, `${label}(${path})이 이 함수를 안 쓴다`);
    }
  });

  test("🔴 「이름 (코드)」를 손으로 이어 붙인 자리가 남아 있지 않다", () => {
    // 옛 모양: `{detail.templateName} ({detail.templateCode})` · `{t.name} ({t.code})`
    //
    // 🔵 옮기기 전의 자리(ExecutionStartCard)도 **계속 본다.** 거기에 드롭다운이
    // 다시 생기는 날 옛 모양으로 돌아갈 수 있고, 그러면 위 「부른다」 검사는 그
    // 파일을 안 보므로 아무도 못 잡는다.
    const negativeOnly = ["src/components/procedures/execution/ExecutionStartCard.tsx"] as const;
    for (const [label, path] of [...places, ...negativeOnly.map((p) => ["옛 불러오기 창", p] as const)]) {
      const source = read(path).replace(/\s+/g, " ");
      assert.ok(!/\{[^}]*[Nn]ame\} \(\{[^}]*[Cc]ode\}\)/.test(source), `${label}에 옛 모양이 남아 있다`);
    }
  });
});
