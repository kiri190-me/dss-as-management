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

/**
 * ============================================================================
 * 🔴 어쩔 수 없이 자를 때의 네 규칙 (2026-10-15)
 * ============================================================================
 * 「줄바꿈이 자연스럽지 않다」를 받고 실측한 자리들이다. 넷 다 **공백이 없는
 * 글**에서만 나온다 — 공백이 있으면 낱말째 넘기므로 애초에 해당이 없다.
 * 아래 시험은 규칙을 **하나씩** 못 박는다. 하나를 꺼도 나머지는 그대로 통과해야
 * 어느 규칙이 깨졌는지 시험만 보고 알 수 있다.
 *
 * 🔴 글은 전부 지어낸 것이다 — 실제 고객사·모델·S/N 이 아니다.
 * ============================================================================
 */

test("🔴 규칙 1 — 낱말 가운데를 자르지 않는다(양식의 실제 폭 75칸)", () => {
  const lines = wrapTextToWidth(
    "전원부 입력 퓨즈가 단선되어 있었고, 정류 다이오드 두 개가 쇼트된 상태였으며, 냉각팬 베어링에서 소음이 발생하여, 해당 부품을 모두 교체하였습니다.",
    75
  );
  assert.deepEqual(lines, [
    "전원부 입력 퓨즈가 단선되어 있었고, 정류 다이오드 두 개가 쇼트된",
    "상태였으며, 냉각팬 베어링에서 소음이 발생하여, 해당 부품을 모두",
    "교체하였습니다.",
  ]);
  // 나뉜 줄을 공백으로 다시 이으면 원래 문장이다 — 낱말이 쪼개졌다면 안 맞는다.
  assert.equal(
    lines.join(" "),
    "전원부 입력 퓨즈가 단선되어 있었고, 정류 다이오드 두 개가 쇼트된 상태였으며, 냉각팬 베어링에서 소음이 발생하여, 해당 부품을 모두 교체하였습니다."
  );
});

test("🔴 규칙 2 — 쉼표·마침표는 그 뒤에서 끊는다(다음 줄 머리에 두지 않는다)", () => {
  // 공백이 없어 어쩔 수 없이 자르는 글. 폭 10칸이면 「가나다라마」까지가 꽉 찬
  // 자리인데, 바로 다음 글자가 쉼표다 — 그대로 두면 둘째 줄이 `,` 로 시작한다.
  const lines = wrapTextToWidth("가나다라마,바사아자차카타", 10);
  assert.deepEqual(lines, ["가나다라", "마,바사아", "자차카타"]);
  for (const line of lines) {
    assert.equal(/^[,.;:!?)\]}>、。，．：；！？）］｝〉》」』…·・]/u.test(line), false, `"${line}" 이 부호로 시작한다`);
    assert.ok(textDisplayWidth(line) <= 10);
  }

  // 마침표·닫는 괄호도 같다.
  for (const mark of [".", ")", "，"]) {
    for (const line of wrapTextToWidth(`가나다라마${mark}바사아자차카타`, 10).slice(1)) {
      assert.equal(line.startsWith(mark), false, `"${line}" 이 ${mark} 로 시작한다`);
    }
  }
});

test("🔴 규칙 3 — 꼬리만 남기지 않는다(「니다」·「고,」 같은 토막)", () => {
  // 폭 10칸에 한글 여섯 자. 꽉 채우면 마지막 줄에 「바」 한 자만 남는다.
  assert.deepEqual(wrapTextToWidth("가나다라마바", 10), ["가나다", "라마바"]);
  // 두 자(4칸)도 토막이다 — 「니다」가 4칸이다.
  assert.deepEqual(wrapTextToWidth("가나다라마바사", 10), ["가나다라", "마바사"]);
  // 세 자(6칸)부터는 토막이 아니므로 앞줄을 꽉 채운 그대로 둔다.
  assert.deepEqual(wrapTextToWidth("가나다라마바사아", 10), ["가나다라마", "바사아"]);
});

test("🔴 규칙 4 — 영문·숫자 덩어리 가운데를 자르지 않는다", () => {
  // `13.56MHz` 의 점은 문장부호가 아니라 수의 일부다. 예전에는 여기서 끊어
  // 「13.」 / 「56MHz」 가 됐다.
  assert.deepEqual(wrapTextToWidth("출력은13.56MHz이다", 12), ["출력은", "13.56MHz이다"]);
  // 모델명의 붙임표도 같다 — 「RF-」 / 「3000B」 가 되면 다른 물건으로 읽힌다.
  assert.deepEqual(wrapTextToWidth("형식은RF-3000B이다", 12), ["형식은", "RF-3000B이다"]);
  // 치수도 가운데가 갈라지지 않는다.
  for (const line of wrapTextToWidth("정격은250V10A이고정상이다", 12)) {
    assert.equal(/\d$/u.test(line) && line.endsWith("250V1"), false, `"${line}"`);
    assert.ok(textDisplayWidth(line) <= 12);
  }
});

test("🔴 덩어리가 한 줄보다 길면 어쩔 수 없이 쪼갠다 — 그때는 붙임표 다음을 쓴다", () => {
  /**
   * 규칙 4를 **지킬 수 없는** 경우다. 이 덩어리는 줄보다 길어 어차피 쪼개진다 —
   * 그런데도 「안을 끊지 마라」로 묶으면 끊을 자리가 통째로 사라져 마지막 줄에
   * 글자 하나만 남는다(`…REPLACEMEN` / `T`). 그래서 쪼갤 수밖에 없는 덩어리는
   * 안의 붙임표를 다시 끊을 자리로 쓴다.
   */
  const lines = wrapTextToWidth(
    "POWER-MODULE-ASSY-RFK300FH-JS1-REV2/CONNECTOR-KIT-AB-1200-SERIES-REPLACEMENT",
    75
  );
  assert.deepEqual(lines, [
    "POWER-MODULE-ASSY-RFK300FH-JS1-REV2/CONNECTOR-KIT-AB-1200-SERIES-",
    "REPLACEMENT",
  ]);
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
