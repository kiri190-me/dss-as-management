import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  countSheetHeadingChars,
  DEFAULT_DOMESTIC_ORDER_SHEET_GREETING,
  DEFAULT_DOMESTIC_ORDER_SHEET_HEADING,
  DEFAULT_DOMESTIC_ORDER_SHEET_MEMO,
  DOMESTIC_ORDER_SHEET_AS_OF_DATE_PLACEHOLDER,
  DOMESTIC_ORDER_SHEET_GREETING_MAX_CHARS,
  DOMESTIC_ORDER_SHEET_MEMO_MAX_CHARS,
  fillSheetAsOfDate,
  isDefaultDomesticOrderSheetHeading,
  normalizeSheetHeadingText,
  resolveSheetGreetingLines,
  resolveSheetInternalMemo,
  sheetIndentLevelOf,
  validateDomesticOrderSheetHeadingInput,
} from "./domestic-order-sheet-heading";

/**
 * ============================================================================
 * 내자 정리 머리말 — 기본 문구 · 자리 표시 · 들여쓰기 · 검증 (순수 함수)
 * ============================================================================
 * 🔴 가장 중요한 약속은 첫 묶음이다: **설정 표에 행이 없으면 화면이 이 기능 전과
 * 한 글자도 다르지 않다.** 아래 ORIGINAL_* 는 이 기능 전 SheetHeading 의 JSX 에서
 * 글자를 그대로 옮겨 적은 것이다(커밋 28ebf8f 의 DomesticOrderListScreen.tsx) —
 * 도메인 상수에서 복사해 오지 않았다. 복사해 오면 상수가 틀려도 시험이 따라 틀린다.
 * ============================================================================
 */

const AS_OF = "2026. 09. 11.";

/** 전각 공백. 소스에 글자 그대로 두면 반각 공백과 구별되지 않아 코드 값으로 만든다. */
const IDEO = String.fromCharCode(0x3000);

/**
 * 이 기능 전의 <ol> 네 줄. `{asOfDate}` 자리에 AS_OF 를 넣은 결과이고, pl-4 가
 * 붙어 있던 줄은 indentLevel 1 이다.
 */
const ORIGINAL_GREETING_LINES = [
  { text: `1. 귀사의 일익 번창하심을 기원합니다.`, indentLevel: 0 },
  { text: `2. 납품 및 수리 관련하여 ${AS_OF}자 진행 상황입니다.`, indentLevel: 0 },
  {
    text: `2) 수리품 반입/반출 및 기타 변동이 있을 경우 김유진 과장에게 전달해 주세요.`,
    indentLevel: 1,
  },
  { text: `3) 본 내용 변경을 요하거나 의견 있으면 주세요.`, indentLevel: 1 },
];

/** 이 기능 전 메모 상자의 글 전체(이름표 포함). */
const ORIGINAL_MEMO_BOX_TEXT =
  "내부 메모 — 발주 받으면 인사회신 잊지말기 (회신 前 수리소완성일 확인 必!) · 2023.08.23";

/** 화면이 메모 앞에 붙이는 이름표(DomesticOrderListScreen 의 SheetHeading). */
const MEMO_LABEL = "내부 메모 — ";

describe("기본 문구 — 행이 없으면 이 기능 전과 똑같다", () => {
  test("🔴 기본 인사문을 그리면 전과 같은 네 줄 · 같은 들여쓰기 · 같은 날짜", () => {
    assert.deepEqual(resolveSheetGreetingLines(DEFAULT_DOMESTIC_ORDER_SHEET_GREETING, AS_OF), ORIGINAL_GREETING_LINES);
  });

  test("🔴 기본 메모에 화면의 이름표를 붙이면 전의 메모 상자 글과 같다", () => {
    const memo = resolveSheetInternalMemo(DEFAULT_DOMESTIC_ORDER_SHEET_MEMO, AS_OF);
    assert.equal(`${MEMO_LABEL}${memo}`, ORIGINAL_MEMO_BOX_TEXT);
  });

  test("기본 인사문의 날짜 자리는 {기준일} 이다 — 둘째 줄에 한 번", () => {
    assert.equal(DOMESTIC_ORDER_SHEET_AS_OF_DATE_PLACEHOLDER, "{기준일}");
    assert.equal(DEFAULT_DOMESTIC_ORDER_SHEET_GREETING.split("{기준일}").length - 1, 1);
    assert.equal(DEFAULT_DOMESTIC_ORDER_SHEET_GREETING.split("\n")[1].includes("{기준일}"), true);
  });

  test("기본 문구는 정규화를 지나도 그대로다 — 기본값 판정이 스스로 어긋나지 않는다", () => {
    assert.equal(normalizeSheetHeadingText(DEFAULT_DOMESTIC_ORDER_SHEET_GREETING), DEFAULT_DOMESTIC_ORDER_SHEET_GREETING);
    assert.equal(normalizeSheetHeadingText(DEFAULT_DOMESTIC_ORDER_SHEET_MEMO), DEFAULT_DOMESTIC_ORDER_SHEET_MEMO);
    assert.equal(isDefaultDomesticOrderSheetHeading(DEFAULT_DOMESTIC_ORDER_SHEET_HEADING), true);
  });

  test("기본 문구는 검증을 통과하고, 통과한 값이 기본 문구 그대로다", () => {
    const result = validateDomesticOrderSheetHeadingInput(DEFAULT_DOMESTIC_ORDER_SHEET_HEADING);
    assert.equal(result.ok, true);
    if (result.ok) assert.deepEqual(result.data, DEFAULT_DOMESTIC_ORDER_SHEET_HEADING);
  });
});

describe("{기준일} 자리 표시", () => {
  test("있는 자리를 전부 바꾼다 — 인사문에서도 메모에서도", () => {
    assert.equal(fillSheetAsOfDate("{기준일} 기준 · {기준일}까지", AS_OF), `${AS_OF} 기준 · ${AS_OF}까지`);
    assert.deepEqual(resolveSheetGreetingLines("오늘은 {기준일}", AS_OF), [{ text: `오늘은 ${AS_OF}`, indentLevel: 0 }]);
    assert.equal(resolveSheetInternalMemo("{기준일} 확인", AS_OF), `${AS_OF} 확인`);
  });

  test("자리 표시가 없으면 글이 그대로다", () => {
    assert.equal(fillSheetAsOfDate("날짜 없음", AS_OF), "날짜 없음");
  });

  test("날짜 글자에 $ 가 섞여도 치환 규칙으로 읽히지 않는다", () => {
    // String.replace 의 "$&" 같은 치환 문법에 걸리면 엉뚱한 글이 들어간다.
    assert.equal(fillSheetAsOfDate("[{기준일}]", "$&$1"), "[$&$1]");
  });

  test("비슷하지만 다른 표기는 바꾸지 않는다", () => {
    assert.equal(fillSheetAsOfDate("{ 기준일 } {기준 일} {{기준일}}", AS_OF), `{ 기준일 } {기준 일} {${AS_OF}}`);
  });
});

describe("들여쓰기 — 줄 앞 공백 두 칸마다 한 단, 세 단까지", () => {
  test("반각 공백의 폭", () => {
    assert.equal(sheetIndentLevelOf("글"), 0);
    assert.equal(sheetIndentLevelOf(" 글"), 0, "한 칸은 들여쓰지 않는다 — 실수로 들어간 공백");
    assert.equal(sheetIndentLevelOf("  글"), 1);
    assert.equal(sheetIndentLevelOf("   글"), 1);
    assert.equal(sheetIndentLevelOf("    글"), 2);
    assert.equal(sheetIndentLevelOf("      글"), 3);
    assert.equal(sheetIndentLevelOf("          글"), 3, "세 단을 넘지 않는다");
  });

  test("탭과 전각 공백은 폭 2 — 한 글자로 한 단", () => {
    assert.equal(sheetIndentLevelOf("\t글"), 1);
    assert.equal(sheetIndentLevelOf(`${IDEO}글`), 1);
    assert.equal(sheetIndentLevelOf(`${IDEO} \t글`), 2);
  });

  test("그릴 때 줄 앞 공백은 걷는다 — 들여쓰기는 단 수로만 그린다", () => {
    assert.deepEqual(resolveSheetGreetingLines(`  가\n\t나\n${IDEO}다\n 라`, AS_OF), [
      { text: "가", indentLevel: 1 },
      { text: "나", indentLevel: 1 },
      { text: "다", indentLevel: 1 },
      { text: "라", indentLevel: 0 },
    ]);
  });

  test("가운데 빈 줄은 빈 줄로 남는다 — 한 줄 = 문서 한 줄", () => {
    assert.deepEqual(resolveSheetGreetingLines("가\n\n나", AS_OF), [
      { text: "가", indentLevel: 0 },
      { text: "", indentLevel: 0 },
      { text: "나", indentLevel: 0 },
    ]);
  });
});

describe("정규화", () => {
  test("줄바꿈 통일 · 줄 끝 공백 · 앞뒤 빈 줄을 걷고, 줄 앞 공백과 가운데 빈 줄은 남긴다", () => {
    assert.equal(normalizeSheetHeadingText("\r\n\n  가  \r\n\r\n\t나\t\r\n\n"), "  가\n\n\t나");
    assert.equal(normalizeSheetHeadingText("가\r나"), "가\n나");
  });

  test("여러 번 불러도 결과가 같다", () => {
    const once = normalizeSheetHeadingText("  가 \n\n 나 \n");
    assert.equal(normalizeSheetHeadingText(once), once);
  });

  test("공백뿐인 글은 빈 문자열이 된다", () => {
    assert.equal(normalizeSheetHeadingText(`   \n \t \n${IDEO}`), "");
  });

  test("기본 문구에 줄 끝 공백 · 끝의 빈 줄 · \\r\\n 이 섞여도 기본값으로 판정한다", () => {
    const noisy = {
      greetingText: `${DEFAULT_DOMESTIC_ORDER_SHEET_GREETING.split("\n").join("   \r\n")}\r\n\r\n`,
      internalMemo: `\n${DEFAULT_DOMESTIC_ORDER_SHEET_MEMO}  `,
    };
    assert.equal(isDefaultDomesticOrderSheetHeading(noisy), true);
  });

  test("한 글자라도 다르면 기본값이 아니다", () => {
    assert.equal(
      isDefaultDomesticOrderSheetHeading({ ...DEFAULT_DOMESTIC_ORDER_SHEET_HEADING, internalMemo: "" }),
      false
    );
    assert.equal(
      isDefaultDomesticOrderSheetHeading({
        ...DEFAULT_DOMESTIC_ORDER_SHEET_HEADING,
        greetingText: DEFAULT_DOMESTIC_ORDER_SHEET_GREETING.replace("  2)", "    2)"),
      }),
      false,
      "들여쓰기만 달라도 다르다"
    );
  });
});

describe("빈 메모면 메모 상자가 없다", () => {
  test("빈 문자열 · 공백뿐인 메모는 null", () => {
    assert.equal(resolveSheetInternalMemo("", AS_OF), null);
    assert.equal(resolveSheetInternalMemo("  \n\t ", AS_OF), null);
  });

  test("여러 줄 메모는 줄바꿈을 그대로 둔다", () => {
    assert.equal(resolveSheetInternalMemo("가\n나", AS_OF), "가\n나");
  });

  test("빈 인사문은 그릴 줄이 없다", () => {
    assert.deepEqual(resolveSheetGreetingLines("", AS_OF), []);
  });
});

describe("입력 검증", () => {
  const valid = (greetingText: string, internalMemo = "") =>
    validateDomesticOrderSheetHeadingInput({ greetingText, internalMemo });

  test("인사문 상한은 2000자, 메모 상한은 500자 — 경계값", () => {
    assert.equal(DOMESTIC_ORDER_SHEET_GREETING_MAX_CHARS, 2000);
    assert.equal(DOMESTIC_ORDER_SHEET_MEMO_MAX_CHARS, 500);

    assert.equal(valid("가".repeat(2000)).ok, true);
    const tooLong = valid("가".repeat(2001));
    assert.equal(tooLong.ok, false);
    if (!tooLong.ok) assert.match(tooLong.fieldErrors.greetingText ?? "", /2000자/);

    assert.equal(valid("인사", "나".repeat(500)).ok, true);
    const memoTooLong = valid("인사", "나".repeat(501));
    assert.equal(memoTooLong.ok, false);
    if (!memoTooLong.ok) {
      assert.match(memoTooLong.fieldErrors.internalMemo ?? "", /500자/);
      assert.equal(memoTooLong.fieldErrors.greetingText, undefined, "인사문은 멀쩡하다");
    }
  });

  test("길이는 코드 포인트로 센다 — DB 의 char_length 와 같은 잣대", () => {
    const emoji = "😀"; // UTF-16 으로는 2단위
    assert.equal(emoji.length, 2);
    assert.equal(countSheetHeadingChars(emoji.repeat(3)), 3);
    assert.equal(valid(emoji.repeat(2000)).ok, true, "2000자인데 막혔다 — String.length 로 셌다");
    assert.equal(valid(emoji.repeat(2001)).ok, false);
  });

  test("길이는 정규화 뒤에 센다 — 줄 끝 공백은 글자 수에 들지 않는다", () => {
    assert.equal(valid(`${"가".repeat(2000)}      \n\n`).ok, true);
  });

  test("인사문은 비울 수 없다 — 공백뿐이어도 빈 것이다", () => {
    for (const blank of ["", "   ", "\n\n", ` \t${IDEO} `]) {
      const result = valid(blank, "메모");
      assert.equal(result.ok, false, JSON.stringify(blank));
      if (!result.ok) assert.ok(result.fieldErrors.greetingText);
    }
  });

  test("메모는 비워도 된다", () => {
    const result = valid("인사", "");
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.data.internalMemo, "");
  });

  test("통과한 값은 정규화된 값이다", () => {
    const result = valid("\r\n  가  \r\n나\r\n\r\n", "  메모  \n");
    assert.equal(result.ok, true);
    if (result.ok) assert.deepEqual(result.data, { greetingText: "  가\n나", internalMemo: "  메모" });
  });

  test("글자가 아닌 값 · 객체가 아닌 입력은 거절한다", () => {
    assert.equal(validateDomesticOrderSheetHeadingInput(null).ok, false);
    assert.equal(validateDomesticOrderSheetHeadingInput("인사").ok, false);
    const noMemo = validateDomesticOrderSheetHeadingInput({ greetingText: "인사" });
    assert.equal(noMemo.ok, false);
    if (!noMemo.ok) assert.ok(noMemo.fieldErrors.internalMemo);
    const numberGreeting = validateDomesticOrderSheetHeadingInput({ greetingText: 1, internalMemo: "" });
    assert.equal(numberGreeting.ok, false);
    if (!numberGreeting.ok) assert.ok(numberGreeting.fieldErrors.greetingText);
  });

  test("제어 문자는 거절하고, 탭은 받는다", () => {
    const nul = valid(`인사${String.fromCharCode(0)}`);
    assert.equal(nul.ok, false, "NUL 은 Postgres text 가 받지 않는다");
    const bell = valid("인사", `메모${String.fromCharCode(7)}`);
    assert.equal(bell.ok, false);
    if (!bell.ok) assert.ok(bell.fieldErrors.internalMemo);
    assert.equal(valid("\t인사", "메\t모").ok, true);
  });
});

describe("DB CHECK 와 검증이 같은 수를 쓴다", () => {
  test("스키마의 char_length 상한이 도메인 상수와 같다", () => {
    // 스키마 파일은 drizzle-kit 이 따로 읽어 `@/` 를 import 하지 않으므로 숫자를
    // 글자로 적어 둔다 — 한쪽만 바뀌면 여기서 걸린다.
    const schemaSource = readFileSync(
      new URL("../db/schema/domestic-order-sheet-settings.ts", import.meta.url),
      "utf8"
    );
    assert.ok(
      schemaSource.includes(`char_length(\${table.greetingText}) <= ${DOMESTIC_ORDER_SHEET_GREETING_MAX_CHARS}`),
      "인사문 CHECK 상한이 검증과 다르다"
    );
    assert.ok(
      schemaSource.includes(`char_length(\${table.internalMemo}) <= ${DOMESTIC_ORDER_SHEET_MEMO_MAX_CHARS}`),
      "메모 CHECK 상한이 검증과 다르다"
    );
  });
});
