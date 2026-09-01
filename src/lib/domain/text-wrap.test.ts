import assert from "node:assert/strict";
import { test } from "node:test";

import { charDisplayWidth, textDisplayWidth, wrapTextToWidth } from "./text-wrap";

/**
 * ============================================================================
 * 글자 폭 · 줄 나누기
 * ============================================================================
 * 이 모듈이 틀리면 증상은 **인쇄된 보고서에서만** 보인다(칸 밖으로 흘러나간
 * 글, 잘린 마지막 글자). 그래서 여기서 눈으로 볼 수 있게 못 박는다.
 * ============================================================================
 */

test("전각은 2칸, 반각은 1칸", () => {
  assert.equal(charDisplayWidth("가"), 2);
  assert.equal(charDisplayWidth("漢"), 2);
  assert.equal(charDisplayWidth("ア"), 2);
  assert.equal(charDisplayWidth("　"), 2, "전각 공백");
  assert.equal(charDisplayWidth("～"), 2, "전각 물결표 U+FF5E");
  assert.equal(charDisplayWidth("A"), 1);
  assert.equal(charDisplayWidth(" "), 1);
  assert.equal(charDisplayWidth("."), 1);
});

test("글 전체의 폭은 글자 폭의 합", () => {
  assert.equal(textDisplayWidth(""), 0);
  assert.equal(textDisplayWidth("abc"), 3);
  assert.equal(textDisplayWidth("퓨즈"), 4);
  assert.equal(textDisplayWidth("퓨즈 교체"), 9);
  // 「～이　상～」 = 전각 다섯 = 10칸.
  assert.equal(textDisplayWidth("～이　상～"), 10);
});

test("폭 안에 들어가는 줄은 손대지 않는다", () => {
  assert.deepEqual(wrapTextToWidth("퓨즈 교체", 75), ["퓨즈 교체"]);
  assert.deepEqual(wrapTextToWidth("", 75), [""]);
  assert.deepEqual(wrapTextToWidth("   ", 75), ["   "], "빈 줄은 그대로 한 줄");
});

test("🔴 낱말 가운데를 자르지 않는다 — 한글", () => {
  // 폭 10 = 한글 다섯 자.
  const lines = wrapTextToWidth("전원부 퓨즈 단선 확인", 10);
  // 「전원부 퓨즈」는 11칸이라 한 줄에 못 들어간다 — 낱말을 쪼개는 대신 넘긴다.
  assert.deepEqual(lines, ["전원부", "퓨즈 단선", "확인"]);
  for (const line of lines) assert.ok(textDisplayWidth(line) <= 10, `${line} 이 폭을 넘는다`);
});

test("🔴 낱말 가운데를 자르지 않는다 — 영문", () => {
  const lines = wrapTextToWidth("replaced the input power fuse", 12);
  assert.deepEqual(lines, ["replaced the", "input power", "fuse"]);
  for (const line of lines) assert.ok(textDisplayWidth(line) <= 12);
});

test("한글과 영문이 섞여도 낱말 경계에서 끊는다", () => {
  const lines = wrapTextToWidth("RF Generator 출력 30kW 확인", 14);
  assert.deepEqual(lines, ["RF Generator", "출력 30kW 확인"]);
  for (const line of lines) assert.ok(textDisplayWidth(line) <= 14);
});

test("낱말 하나가 한 줄보다 길면 문장부호 다음에서 끊는다", () => {
  // 공백이 하나도 없는 긴 글. `/` 다음이 끊기 좋은 자리다.
  const lines = wrapTextToWidth("AAAAAA/BBBBBBBBBBBB", 10);
  assert.deepEqual(lines, ["AAAAAA/", "BBBBBBBBBB", "BB"]);
});

test("끊을 자리가 없으면 글자 단위로 자른다 — 그래도 폭을 넘지 않는다", () => {
  const lines = wrapTextToWidth("가나다라마바사아자차", 6);
  assert.deepEqual(lines, ["가나다", "라마바", "사아자", "차"]);
  for (const line of lines) assert.ok(textDisplayWidth(line) <= 6);
});

test("맨 앞 공백(글머리표 들여쓰기)은 살리고, 넘어가는 자리의 공백은 버린다", () => {
  const lines = wrapTextToWidth(" ・출력이 나오지 않는다", 12);
  assert.equal(lines[0], " ・출력이", "앞 공백이 사라졌다");
  assert.deepEqual(lines, [" ・출력이", "나오지", "않는다"]);
  for (const line of lines) assert.ok(textDisplayWidth(line) <= 12);
});

test("줄 폭이 2보다 작으면 짐작하지 않고 던진다", () => {
  assert.throws(() => wrapTextToWidth("가", 1), /줄 폭은 2 이상/);
  assert.throws(() => wrapTextToWidth("가", Number.NaN), /줄 폭은 2 이상/);
});

test("어떤 글을 넣어도 폭을 넘는 줄은 나오지 않는다", () => {
  const samples = [
    "퓨즈를 교체하고 정격 출력에서 30분 통전시험을 하여 이상 없음을 확인하였습니다.",
    "Replaced RF power module (P/N: RFK300FH-JS1) and verified 30kW output.",
    "13.56MHz 30kW 제네레이터의 정합기 연결부 접촉 불량으로 판단됩니다",
    "가나다라마바사아자차카타파하가나다라마바사아자차카타파하가나다라마바사아자차카타파하",
    " ・수리의뢰",
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  ];
  for (const width of [8, 20, 40, 75]) {
    for (const sample of samples) {
      const lines = wrapTextToWidth(sample, width);
      for (const line of lines) {
        assert.ok(
          textDisplayWidth(line) <= width,
          `폭 ${width} 에서 "${line}"(${textDisplayWidth(line)}칸)이 넘쳤다`
        );
      }
      // 글자를 잃어버리지 않는다(공백만 정리된다).
      assert.equal(
        lines.join("").replace(/\s/gu, ""),
        sample.replace(/\s/gu, ""),
        `폭 ${width} 에서 글자가 사라졌다: ${sample}`
      );
    }
  }
});
