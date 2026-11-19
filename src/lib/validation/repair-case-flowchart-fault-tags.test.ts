import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeFlowchartFaultTag,
  validateFlowchartFaultTags,
  addFlowchartFaultTag,
  availableFaultTagSuggestions,
  filterFaultTagOptions,
  faultTagsEqual,
} from "./repair-case-flowchart-input";

/**
 * 진단 Flowchart 의 **고장 개소 태그** — 태그 하나를 다듬고, 더하고, 저장
 * 통로에서 다시 재는 규칙 전부를 값으로 본다.
 *
 * ── 🔴 적는 방식이 뒤집혔다(2026-11-19) ─────────────────────────────────
 * 처음에는 한 칸에 길게 적고 **쉼표·줄바꿈·대괄호로 쪼갰다.** 같은 날 사용자가
 * **A/S 접수의 고객사 칸과 같은 방식**으로 바꿨다 — 드롭다운에서 고르거나 적어서
 * **하나씩** 더한다. 그래서 쪼개는 규칙은 함수째로 사라졌고, 이 시험 파일에서도
 * 쪼개기·되돌리기를 재던 묶음을 들어냈다.
 *
 * 🔴 **뒤집힌 결정은 「안 쪼개진다」로 못 박는다**(아래 첫 묶음). 통과하는 시험의
 * 이름에 옛 규칙이 남아 있으면, 초록 ✔ 옆의 글을 믿고 다음 사람이 다시 쪼개는
 * 코드를 넣는다.
 *
 * ── 무엇을 노리는가 ─────────────────────────────────────────────────────
 * 다듬는 규칙이 **한 곳**인 것이 이 파일의 존재 이유다: 화면(더하는 자리)과
 * 서버(저장하는 자리)가 각자 다듬으면 화면에 선 알약과 저장된 값이 어긋나고, 그
 * 어긋남은 오류 없이 조용하다.
 *
 * 🔵 상한 둘은 일부러 **숫자를 손으로 적어** 잰다 — 모듈의 상수를 가져다 쓰면
 * 상한을 몇으로 바꾸든 시험이 영영 통과한다(「30자가 상한이다」가 아니라 「상한이
 * 상한이다」를 재게 된다).
 */

describe("🔴 쉼표·줄바꿈·대괄호는 아무 뜻이 없다 — 뒤집힌 결정", () => {
  test("🔵 먼저 표본 확인 — 쉼표가 든 글이 **태그 하나**다(앞 방식에서는 둘이었다)", () => {
    assert.equal(normalizeFlowchartFaultTag("코일, 변색"), "코일, 변색");
    const result = validateFlowchartFaultTags(["코일, 변색"]);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.tags, ["코일, 변색"], "쉼표로 쪼개는 규칙이 되살아났다");
  });

  test("🔴 대괄호도 경계가 아니다 — 적은 괄호가 **이름에 그대로 남는다**", () => {
    const result = validateFlowchartFaultTags(["[우내]"]);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.tags, ["[우내]"], "괄호를 벗기는 규칙이 되살아났다");
  });

  test("🔴 줄바꿈도 경계가 아니다 — 가운데 공백으로 눌려 한 태그로 남는다", () => {
    const result = validateFlowchartFaultTags(["우내\n우외"]);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.tags, ["우내 우외"], "줄바꿈으로 쪼개는 규칙이 되살아났다");
  });

  test("🔴 더할 때도 안 쪼개진다 — 한 번 더하면 알약도 하나다", () => {
    const result = addFlowchartFaultTag([], "코일, 변색");
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.tags, ["코일, 변색"]);
  });

  test("🔴 글자 하나를 통째로 보내면 **거절한다** — 쪼개질 것으로 믿고 보낸 값이다", () => {
    const result = validateFlowchartFaultTags("우내, 우외");
    assert.equal(result.ok, false, "글자를 받아 한 태그로 만들면 보낸 쪽의 뜻과 다른 값이 조용히 저장된다");
    if (result.ok) return;
    assert.match(result.error, /고장 개소/);
  });
});

describe("normalizeFlowchartFaultTag — 태그 하나 다듬기", () => {
  test("🔵 먼저 표본 확인 — 다듬을 것이 없는 글자는 그대로다", () => {
    assert.equal(normalizeFlowchartFaultTag("우내"), "우내");
  });

  test("앞뒤 공백을 걷는다", () => {
    assert.equal(normalizeFlowchartFaultTag("   우측 내부   "), "우측 내부");
  });

  test("🔴 가운데 공백이 여러 칸이면 한 칸으로 줄인다 — 눈으로 구분 안 되는 중복이 안 생긴다", () => {
    assert.equal(normalizeFlowchartFaultTag("우측  내부"), "우측 내부");
    assert.equal(normalizeFlowchartFaultTag("우측\t내부"), "우측 내부");
  });

  test("🔵 맨 앞의 `#` 는 떼고 받는다 — 사람이 습관으로 칠 수 있다", () => {
    assert.equal(normalizeFlowchartFaultTag("#우내"), "우내");
    assert.equal(normalizeFlowchartFaultTag("##우내"), "우내");
    assert.equal(normalizeFlowchartFaultTag("# 우내"), "우내");
  });

  test("가운데·끝의 `#` 는 이름의 일부다 — 맨 앞의 것만 뗀다", () => {
    assert.equal(normalizeFlowchartFaultTag("우#내"), "우#내");
    assert.equal(normalizeFlowchartFaultTag("우내#"), "우내#");
  });

  test("더할 것이 없으면 빈 글자다 — `#` 만 적었거나 공백뿐", () => {
    assert.equal(normalizeFlowchartFaultTag(""), "");
    assert.equal(normalizeFlowchartFaultTag("   "), "");
    assert.equal(normalizeFlowchartFaultTag("#"), "");
    assert.equal(normalizeFlowchartFaultTag("## "), "");
  });
});

describe("addFlowchartFaultTag — 하나씩 더하기", () => {
  test("🔵 먼저 표본 확인 — 더하면 **뒤에** 붙고, 쥐고 있던 배열은 안 바뀐다", () => {
    const before = ["우내"];
    const result = addFlowchartFaultTag(before, "우외");
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.tags, ["우내", "우외"]);
    assert.deepEqual(before, ["우내"], "원래 배열을 고쳐 돌려주면 React 가 바뀐 줄 모른다");
    assert.notEqual(result.tags, before);
  });

  test("더할 때도 같은 규칙으로 다듬는다 — `#` 와 공백", () => {
    const result = addFlowchartFaultTag([], "  #우측  내부 ");
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.tags, ["우측 내부"]);
  });

  test("🔴 빈 것은 **아무 말 없이** 안 더한다 — 빈 칸에서 Enter 를 눌렀을 뿐이다", () => {
    for (const blank of ["", "   ", "#", "##  "]) {
      const result = addFlowchartFaultTag(["우내"], blank);
      assert.equal(result.ok, true, `${JSON.stringify(blank)} 가 오류가 됐다`);
      if (!result.ok) return;
      assert.deepEqual(result.tags, ["우내"], `${JSON.stringify(blank)}`);
    }
  });

  test("🔴 이미 있는 태그는 **까닭을 말하고** 안 더한다 — 아무 일도 안 일어나면 왜인지 알 길이 없다", () => {
    const result = addFlowchartFaultTag(["우내", "우외"], "#우내");
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.error, /이미/);
    assert.match(result.error, /우내/, "어느 태그가 겹쳤는지 글에 있어야 한다");
  });

  test("태그 하나는 30자까지 받는다", () => {
    const thirty = "가".repeat(30);
    const result = addFlowchartFaultTag([], thirty);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.tags, [thirty]);
  });

  test("🔴 31자는 조용히 자르지 않고 거절한다", () => {
    const result = addFlowchartFaultTag([], "가".repeat(31));
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.error, /30자/);
  });

  test("🔵 `#` 를 떼고 30자면 받는다 — 세는 것은 **저장될 글자**다", () => {
    const result = addFlowchartFaultTag([], `#${"가".repeat(30)}`);
    assert.equal(result.ok, true, "적은 글자 수로 세면 `#` 때문에 멀쩡한 태그가 막힌다");
  });

  test("한 Flowchart 에 20개까지 받는다", () => {
    const nineteen = Array.from({ length: 19 }, (_, i) => `개소${i}`);
    const result = addFlowchartFaultTag(nineteen, "스무번째");
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.tags.length, 20);
  });

  test("🔴 21개째는 거절한다 — 조용히 안 더해지지 않는다", () => {
    const twenty = Array.from({ length: 20 }, (_, i) => `개소${i}`);
    const result = addFlowchartFaultTag(twenty, "스물한번째");
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.error, /20개/);
  });

  test("🔵 꽉 찼어도 **이미 있는 것**은 상한이 아니라 중복으로 걸린다 — 까닭이 맞아야 고칠 수 있다", () => {
    const twenty = Array.from({ length: 20 }, (_, i) => `개소${i}`);
    const result = addFlowchartFaultTag(twenty, "개소3");
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.error, /이미/);
  });
});

describe("validateFlowchartFaultTags — 저장 통로가 받는 묶음", () => {
  test("🔵 먼저 표본 확인 — 화면이 보낸 모양 그대로 통과한다", () => {
    const result = validateFlowchartFaultTags(["우내", "우측 내부"]);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.tags, ["우내", "우측 내부"]);
  });

  test("🔴 화면을 믿지 않는다 — 다듬지 않은 값이 와도 여기서 다시 다듬는다", () => {
    const result = validateFlowchartFaultTags([" #우내 ", "우측  내부"]);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.tags, ["우내", "우측 내부"]);
  });

  test("🔵 중복은 **조용히** 하나로 합치고, 남는 것은 먼저 온 차례다", () => {
    const result = validateFlowchartFaultTags(["우외", "우내", "#우외", "좌내"]);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.tags, ["우외", "우내", "좌내"]);
  });

  test("빈 것은 버린다 — 오류가 아니다", () => {
    const result = validateFlowchartFaultTags(["우내", "   ", "#", "우외"]);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.tags, ["우내", "우외"]);
  });

  test("🔴 빈 묶음·없음은 태그 0개 — 선택 칸이다", () => {
    for (const empty of [[], null, undefined]) {
      const result = validateFlowchartFaultTags(empty);
      assert.equal(result.ok, true, `${JSON.stringify(empty)} 가 오류가 됐다`);
      if (!result.ok) return;
      assert.deepEqual(result.tags, []);
    }
  });

  test("배열이 아니거나 글자가 아닌 원소가 섞이면 거절한다 — 까닭이 글로 온다", () => {
    for (const bad of [123, {}, true, ["우내", 7], "우내"]) {
      const result = validateFlowchartFaultTags(bad);
      assert.equal(result.ok, false, `${JSON.stringify(bad)} 가 통과했다`);
      if (result.ok) return;
      assert.match(result.error, /고장 개소/);
    }
  });

  test("🔴 31자짜리가 섞이면 거절한다 — 조용히 자르지 않는다", () => {
    const result = validateFlowchartFaultTags(["우내", "가".repeat(31)]);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.error, /30자/);
  });

  test("20개까지 받고, 21개째는 거절한다", () => {
    const twenty = Array.from({ length: 20 }, (_, i) => `개소${i}`);
    const ok = validateFlowchartFaultTags(twenty);
    assert.equal(ok.ok, true);
    if (!ok.ok) return;
    assert.equal(ok.tags.length, 20);

    const tooMany = validateFlowchartFaultTags([...twenty, "개소20"]);
    assert.equal(tooMany.ok, false);
    if (tooMany.ok) return;
    assert.match(tooMany.error, /20개/);
  });

  test("🔴 개수 상한은 **중복을 합친 뒤에** 센다 — 같은 말을 21번 보낸 것은 태그 하나다", () => {
    const result = validateFlowchartFaultTags(Array.from({ length: 21 }, () => "우내"));
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.tags, ["우내"]);
  });
});

describe("availableFaultTagSuggestions — 고를 목록에서 이미 단 것을 뺀다", () => {
  test("🔵 먼저 표본 확인 — 아무것도 안 달았으면 받은 목록 그대로다(차례까지)", () => {
    const suggestions = ["우내", "우외", "좌내"];
    assert.deepEqual(availableFaultTagSuggestions(suggestions, []), suggestions);
  });

  test("🔴 이미 단 태그는 빠진다 — 고를 수 있는데 안 더해지면 고장으로 보인다", () => {
    assert.deepEqual(availableFaultTagSuggestions(["우내", "우외", "좌내"], ["우외"]), ["우내", "좌내"]);
  });

  test("🔴 다듬은 뒤에 견준다 — `#우외` 를 달고 있어도 목록의 `우외` 가 빠진다", () => {
    assert.deepEqual(availableFaultTagSuggestions(["우내", "우외"], ["#우외"]), ["우내"]);
  });

  test("목록 쪽 중복은 한 줄로 합친다 — 같은 글자가 두 줄 보이면 고른 쪽이 다른 것처럼 읽힌다", () => {
    assert.deepEqual(availableFaultTagSuggestions(["우내", "#우내", "우외"], []), ["우내", "우외"]);
  });

  test("빈 줄은 목록에 안 선다", () => {
    assert.deepEqual(availableFaultTagSuggestions(["", "   ", "우내"], []), ["우내"]);
  });

  test("🔵 많이 쓰인 순으로 받은 차례를 **다시 섞지 않는다** — 섞으면 그 차례가 뜻을 잃는다", () => {
    // 조회가 「많이 쓰인 순」으로 주므로 가나다순이 아니다. 그 모양 그대로 둔다.
    assert.deepEqual(availableFaultTagSuggestions(["제어반", "우내", "가변축"], ["우내"]), ["제어반", "가변축"]);
  });
});

describe("filterFaultTagOptions — 적는 대로 후보를 좁힌다", () => {
  const options = ["우내", "우외", "좌내", "제어반 상부", "RF출력"];

  test("🔵 먼저 표본 확인 — 빈 칸이면 받은 것이 그대로 보인다(골라 넣는 칸이다)", () => {
    assert.deepEqual(filterFaultTagOptions(options, ""), options);
    assert.deepEqual(filterFaultTagOptions(options, "   "), options);
  });

  test("🔴 적는 글로 좁혀진다 — 사용자가 말한 「바로바로 검색」", () => {
    assert.deepEqual(filterFaultTagOptions(options, "우"), ["우내", "우외"]);
    assert.deepEqual(filterFaultTagOptions(options, "내"), ["우내", "좌내"]);
    assert.deepEqual(filterFaultTagOptions(options, "제어"), ["제어반 상부"]);
  });

  test("가운데 글자로도 걸린다 — 앞에서부터 맞을 필요가 없다", () => {
    assert.deepEqual(filterFaultTagOptions(options, "반 상"), ["제어반 상부"]);
  });

  test("🔴 찾는 글도 같은 규칙으로 다듬는다 — `#우` 로도 나온다", () => {
    assert.deepEqual(filterFaultTagOptions(options, "#우"), ["우내", "우외"]);
    assert.deepEqual(filterFaultTagOptions(options, "  우내 "), ["우내"]);
  });

  test("대소문자는 가리지 않는다 — 영문 약어로 적은 개소", () => {
    assert.deepEqual(filterFaultTagOptions(options, "rf"), ["RF출력"]);
  });

  test("맞는 것이 없으면 빈 목록 — 그러면 화면은 아무것도 안 그린다", () => {
    assert.deepEqual(filterFaultTagOptions(options, "없는개소"), []);
  });

  test("🔴 한 번에 여덟까지만 — 다 뿌리면 칸 밑의 것들을 가린다", () => {
    const many = Array.from({ length: 30 }, (_, i) => `개소${i}`);
    assert.equal(filterFaultTagOptions(many, "").length, 8);
    assert.equal(filterFaultTagOptions(many, "개소").length, 8);
    // 자르는 것은 **앞에서부터**다 — 받은 차례(많이 쓰인 순)가 그대로 살아 있다.
    assert.deepEqual(filterFaultTagOptions(many, "").slice(0, 2), ["개소0", "개소1"]);
  });

  test("🔴 거르는 쪽은 받은 차례를 안 섞는다 — 많이 쓰인 순 그대로다", () => {
    assert.deepEqual(filterFaultTagOptions(["제어반", "우내", "가변축"], ""), ["제어반", "우내", "가변축"]);
  });
});

describe("faultTagsEqual — 차례까지 본다", () => {
  test("같은 값·같은 차례면 같다", () => {
    assert.equal(faultTagsEqual([], []), true);
    assert.equal(faultTagsEqual(["우내", "우외"], ["우내", "우외"]), true);
  });

  test("🔴 차례만 다른 것도 **다르다** — 알약 서는 차례가 곧 값이다", () => {
    assert.equal(faultTagsEqual(["우내", "우외"], ["우외", "우내"]), false);
  });

  test("개수가 다르면 다르다 — 앞이 같아도 뒤가 늘면 바뀐 것이다", () => {
    assert.equal(faultTagsEqual(["우내"], ["우내", "우외"]), false);
    assert.equal(faultTagsEqual(["우내", "우외"], ["우내"]), false);
    assert.equal(faultTagsEqual([], ["우내"]), false);
  });
});
