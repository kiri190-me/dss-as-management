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
 */

/** 실측 2026-11-02 — 코드 칸에 이름이 그대로 들어간 절차가 개발 DB 에 있다. */
const MEASURED_SAME = "기본 통전 검사 (3상 입력)";

describe("코드가 이름과 다르면 괄호로 붙인다", () => {
  test("평범한 절차 — 「이름 (코드)」", () => {
    assert.equal(formatProcedureTemplateTitle("원복 검사 및 개선 작업 (3상 입력)", "7"), "원복 검사 및 개선 작업 (3상 입력) (7)");
  });

  test("🔵 코드를 아예 숨기지 않는다 — 이름이 같은 절차가 둘일 때 가를 수단이 그것뿐이다", () => {
    assert.notEqual(
      formatProcedureTemplateTitle("기본 통전 검사", "RFG-01"),
      formatProcedureTemplateTitle("기본 통전 검사", "RFG-02")
    );
  });
});

describe("🔴 코드가 이름과 같으면 **안 붙인다**", () => {
  test("실측 절차에서 「이름 (이름)」이 안 나온다", () => {
    assert.equal(formatProcedureTemplateTitle(MEASURED_SAME, MEASURED_SAME), MEASURED_SAME);
    // 🔵 표본 확인 — 옛 모양이면 이렇게 떴다.
    assert.notEqual(formatProcedureTemplateTitle(MEASURED_SAME, MEASURED_SAME), `${MEASURED_SAME} (${MEASURED_SAME})`);
  });

  test("앞뒤 공백만 다른 것도 같은 것으로 본다 — 들여온 자료에 흔하다", () => {
    assert.equal(formatProcedureTemplateTitle(MEASURED_SAME, `  ${MEASURED_SAME} `), MEASURED_SAME);
  });

  test("코드가 비었거나 없으면 이름만", () => {
    assert.equal(formatProcedureTemplateTitle("이름만 있는 절차", ""), "이름만 있는 절차");
    assert.equal(formatProcedureTemplateTitle("이름만 있는 절차", "   "), "이름만 있는 절차");
    assert.equal(formatProcedureTemplateTitle("이름만 있는 절차", null), "이름만 있는 절차");
  });
});

describe("🔴 쓰는 자리가 **제 손으로 다시 조립하지 않는다**", () => {
  const read = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");
  const places = [
    ["실행 요약 카드", "src/components/procedures/execution/ProcedureExecutionScreen.tsx"],
    ["불러오기 드롭다운", "src/components/procedures/execution/ExecutionStartCard.tsx"],
    ["지나간 절차 줄", "src/lib/domain/procedure-execution-past-runs.ts"],
  ] as const;

  test("🔵 먼저 — 세 자리가 모두 이 함수를 부른다", () => {
    for (const [label, path] of places) {
      assert.match(read(path), /formatProcedureTemplateTitle/, `${label}(${path})이 이 함수를 안 쓴다`);
    }
  });

  test("🔴 「이름 (코드)」를 손으로 이어 붙인 자리가 남아 있지 않다", () => {
    // 옛 모양: `{detail.templateName} ({detail.templateCode})` · `{t.name} ({t.code})`
    for (const [label, path] of places) {
      const source = read(path).replace(/\s+/g, " ");
      assert.ok(!/\{[^}]*[Nn]ame\} \(\{[^}]*[Cc]ode\}\)/.test(source), `${label}에 옛 모양이 남아 있다`);
    }
  });
});
