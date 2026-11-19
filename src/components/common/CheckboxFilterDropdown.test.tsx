import { test } from "node:test";
import assert from "node:assert/strict";
import { isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import CheckboxFilterDropdown, { CheckboxFilterPanel } from "./CheckboxFilterDropdown";
import type { CheckboxFilterOption } from "./checkbox-filter-dropdown";

/**
 * 한 종류 안에서 여럿 고르는 필터 칸(2026-11-11). **그리는 쪽**만 본다 —
 * 누르고 난 뒤의 값과 접기 규칙은 checkbox-filter-dropdown.test.ts 가 본다.
 *
 * 정적 렌더라 효과도 누르기도 안 돈다. 그래서 펼친 모습은 본체가 아니라
 * CheckboxFilterPanel 을 바로 그려서 본다(그 조각을 따로 내보낸 까닭이다).
 */

const OPTIONS: CheckboxFilterOption[] = [
  { value: "RECEIVED", label: "접수" },
  { value: "REPAIRING", label: "수리 중" },
  { value: "INSPECTING", label: "검사 중" },
  { value: "WAITING_SHIPMENT", label: "출하 대기" },
  { value: "SHIPPED", label: "출하 완료" },
];

const SHORTCUT = {
  label: "입고품 전체",
  values: ["RECEIVED", "REPAIRING", "INSPECTING", "WAITING_SHIPMENT"],
};

function closed(
  selected: string[],
  extra: {
    shortcut?: typeof SHORTCUT;
    labelPlacement?: "top" | "inline";
    selectionMode?: "multi" | "single";
  } = {}
) {
  return renderToStaticMarkup(
    <CheckboxFilterDropdown
      label="현재 상태"
      options={OPTIONS}
      selected={selected}
      onChange={() => {}}
      {...extra}
    />
  );
}

// ─────────────────────────────────────────────── 닫힌 칸

test("🔴 처음에는 접혀 있고, 칸 이름과 「전체」가 보인다", () => {
  const html = closed([]);
  assert.ok(html.includes("현재 상태"), "칸 이름이 안 보인다");
  assert.ok(html.includes("전체"), "아무것도 안 고른 칸은 「전체」라고 말해야 한다");
  assert.ok(html.includes('aria-expanded="false"'), "처음은 접힌 상태다");
  // 접혀 있으면 목록은 아예 없다 — 숨기는 것이 아니라 안 그린다.
  assert.ok(!html.includes('type="checkbox"'), "접힌 칸에 체크박스가 그려졌다");
  assert.ok(!html.includes("입고품 전체"), "단축 단추를 안 넘겼는데 그려졌다");
});

test("🔴 닫힌 칸이 고른 것을 말한다 — 하나면 이름, 여럿이면 「외 N개」", () => {
  assert.ok(closed(["REPAIRING"]).includes("수리 중"));
  assert.ok(
    closed(["RECEIVED", "REPAIRING", "INSPECTING", "WAITING_SHIPMENT"]).includes("접수 외 3개")
  );
  // 「전체」가 남아 있으면 걸러진 채로 안 걸린 것처럼 보인다.
  assert.ok(!closed(["REPAIRING"]).includes(">전체<"));
});

test("🔴 여는 단추는 type=\"button\" 이다 — 폼 안에서 제출이 되면 안 된다", () => {
  // 이 칸은 필터 카드 안에 있고, 그 카드가 언젠가 <form> 안에 들어갈 수 있다.
  // 기본값은 submit 이라 적지 않으면 누를 때마다 화면이 통째로 새로 뜬다.
  const html = closed([]);
  const buttons = html.match(/<button[^>]*>/g) ?? [];
  assert.ok(buttons.length > 0, "단추를 하나도 못 찾았다 — 아래 단언이 공짜로 통과한다");
  for (const button of buttons) {
    assert.match(button, /type="button"/, `type 이 빠진 단추가 있다: ${button}`);
  }
});

test("id 를 주면 여는 단추에 붙는다 — 화면에서 이 칸을 집어 가리키는 자리가 있다", () => {
  const html = renderToStaticMarkup(
    <CheckboxFilterDropdown
      id="repair-case-status"
      label="현재 상태"
      options={OPTIONS}
      selected={[]}
      onChange={() => {}}
    />
  );
  assert.ok(html.includes('id="repair-case-status"'));
});

test("칸 이름이 <label for> 가 아니다 — 누르면 목록이 펼쳐졌다 바로 접힌다", () => {
  // <label for> 로 두면 누르는 순간 단추가 눌리고, 그 click 이 또 단추로 올라가
  // 두 번 눌린 것이 된다. 대신 aria-labelledby 로 이름을 붙인다.
  const html = closed([]);
  assert.ok(!html.includes("<label"), "칸 이름이 <label> 로 그려졌다");
  assert.ok(html.includes("aria-labelledby="), "이름을 붙이는 길이 아예 없다");
});

// ── 이름표 자리 두 모양 (2026-11-18 — 「전부 옆으로」) ─────────────────────
//
// 🔴 **여기서 가장 중요한 것은 「안 넘기면 예전 그대로인가」**다. 이 부품을 쓰는
//    아홉 자리 가운데 일곱([전체 A/S 현황] 다섯 · [기타건 현황] 둘)은 이 prop 을
//    넘기지 않으므로, 기본값이 바뀌면 그 일곱이 한꺼번에 모양을 바꾼다 — 오류는
//    한 줄도 안 나고 화면에서만 드러난다.

/** 바깥 상자와 이름표 <span> 의 class 를 뽑는다. */
function shape(html: string) {
  const outer = (html.match(/^<div class="([^"]*)"/) ?? [])[1];
  assert.ok(outer, `바깥 상자의 class 를 못 찾았다 — 아래 단언이 공짜로 통과한다: ${html.slice(0, 120)}`);
  const labelClass = (html.match(/<span[^>]*class="([^"]*)"/) ?? [])[1];
  assert.ok(labelClass, "이름표 <span> 의 class 를 못 찾았다 — 아래 단언이 공짜로 통과한다");
  return { outer, labelClass };
}

test("🔴 안 넘기면 이름표가 칸 **위**다 — 일곱 칸이 기대고 있는 기본값", () => {
  const html = closed([]);
  const { outer, labelClass } = shape(html);
  assert.match(outer, /flex-col/, `바깥 상자가 세로로 쌓지 않는다: ${outer}`);
  assert.match(labelClass, /text-xs/, `이름표 글자 크기가 달라졌다: ${labelClass}`);
  // 🔴 **안 넘긴 것과 "top" 을 넘긴 것이 한 글자도 다르지 않아야** 한다. 기본값이
  //    바뀌면 이 줄에서 깨진다.
  assert.equal(html, closed([], { labelPlacement: "top" }));
});

test("🔴 inline 을 넘기면 이름표가 칸 **옆**이다 — 줄이 한 줄치 낮아진다", () => {
  const html = closed([], { labelPlacement: "inline" });
  const { outer, labelClass } = shape(html);
  assert.ok(!outer.includes("flex-col"), `옆 모양인데 아직 세로로 쌓는다: ${outer}`);
  assert.match(outer, /items-center/, `이름표와 칸의 높이가 안 맞는다: ${outer}`);
  // 이름표는 옆에 선 다른 이름표(<label>)와 같은 크기·같은 색이라야 한 종류의
  // 조작으로 읽힌다. 그리고 줄어드는 것은 이름표가 아니라 칸이어야 한다.
  assert.match(labelClass, /text-sm/, `옆 이름표가 작은 글씨 그대로다: ${labelClass}`);
  assert.match(labelClass, /shrink-0/, `좁아지면 이름표가 먼저 잘린다: ${labelClass}`);
  // 🔴 칸 쪽이 줄어들려면 min-w-0 이 있어야 한다 — flex 칸의 기본값은
  //    min-width:auto 라, 없으면 「완료됨 외 1개」가 이름표를 밀어낸다.
  const field = (html.match(/<div class="([^"]*relative[^"]*)"/) ?? [])[1];
  assert.ok(field, "펼친 목록이 기대는 relative 상자를 못 찾았다");
  assert.match(field, /min-w-0/, `칸이 줄어들 수 없다: ${field}`);
  assert.match(field, /flex-1/, `칸이 남은 자리를 안 채운다: ${field}`);
});

test("🔵 두 모양은 **겉모습만** 다르다 — 이름도 고른 것도 접힘도 그대로다", () => {
  const top = closed(["RECEIVED", "REPAIRING"]);
  const inline = closed(["RECEIVED", "REPAIRING"], { labelPlacement: "inline" });
  assert.notEqual(top, inline, "두 모양이 같은 HTML 이다 — 아래 단언이 공짜로 통과한다");
  for (const html of [top, inline]) {
    assert.ok(html.includes("현재 상태"), "칸 이름이 사라졌다");
    assert.ok(html.includes("접수 외 1개"), "닫힌 칸이 고른 것을 말하지 않는다");
    assert.ok(html.includes('aria-expanded="false"'), "처음은 접힌 상태다");
    assert.ok(html.includes("aria-labelledby="), "이름을 붙이는 길이 없다");
    assert.ok(!html.includes("<label"), "칸 이름이 <label> 로 그려졌다");
  }
});

// ─────────────────────────────────────────────── 펼친 목록

function panel(selected: string[], shortcut?: typeof SHORTCUT) {
  return renderToStaticMarkup(
    <CheckboxFilterPanel
      panelId="panel"
      labelId="label"
      options={OPTIONS}
      selected={selected}
      onChange={() => {}}
      shortcut={shortcut}
    />
  );
}

test("🔴 펼치면 선택지가 전부 체크박스로 나온다", () => {
  const html = panel([]);
  assert.equal((html.match(/type="checkbox"/g) ?? []).length, OPTIONS.length);
  for (const option of OPTIONS) {
    assert.ok(html.includes(option.label), `${option.label} 이 안 보인다`);
  }
  assert.equal((html.match(/checked=""/g) ?? []).length, 0, "아무것도 안 골랐는데 체크가 있다");
});

test("🔴 고른 것만 체크돼 있다", () => {
  const html = panel(["REPAIRING", "INSPECTING"]);
  assert.equal((html.match(/checked=""/g) ?? []).length, 2);
  // 체크가 어느 줄에 붙었는지까지 본다 — 수만 맞고 엉뚱한 줄이면 더 나쁘다.
  const rows = html.split("<label").slice(1);
  assert.equal(rows.length, OPTIONS.length);
  const checkedLabels = rows.filter((row) => row.includes("checked=\"\""));
  assert.deepEqual(
    checkedLabels.map((row) => (row.match(/<span[^>]*>([^<]*)<\/span>/) ?? [])[1]),
    ["수리 중", "검사 중"]
  );
});

test("🔴 단축 단추는 목록 맨 위다 — 체크박스가 아니다", () => {
  const html = panel([], SHORTCUT);
  assert.ok(html.includes("입고품 전체"));
  assert.ok(
    html.indexOf("입고품 전체") < html.indexOf('type="checkbox"'),
    "단축 단추가 체크박스 아래로 내려갔다"
  );
  // 체크박스 수는 선택지 수 그대로 — 단축 단추가 한 줄을 더하지 않는다.
  assert.equal((html.match(/type="checkbox"/g) ?? []).length, OPTIONS.length);
  assert.ok(!html.includes('value="IN_HOUSE"'), "단축이 고르는 값이 되었다");
});

test("🔴 단축 단추가 없어도 그려진다 — 뒤 조각의 여섯 중 다섯은 없다", () => {
  const html = panel(["REPAIRING"]);
  assert.ok(html.includes("수리 중"), "단축 단추가 없으면 목록까지 안 그려졌다");
  assert.equal((html.match(/type="checkbox"/g) ?? []).length, OPTIONS.length);
  assert.equal((html.match(/<button/g) ?? []).length, 0, "없는 단축 단추가 그려졌다");
  // 단축이 없는 필터는 이 조각(토글)에 아무 영향도 받지 않는다.
  assert.ok(!html.includes("aria-pressed"), "단축 단추가 없는데 눌림 표시가 그려졌다");
});

// ── 단축 단추가 **눌린 모습**인가 (2026-11-11 사용자 추가 요청) ─────────────
//
// 눌렸는지는 지금 고른 값으로만 판정한다(값 쪽 시험이 그 규칙을 본다). 여기서는
// **그 판정이 화면에 실제로 나타나는가**를 본다 — 읽어 주는 프로그램에는
// aria-pressed 로, 눈에는 색으로.

/** 펼친 목록에서 단축 단추의 여는 태그와 그 class 를 뽑는다. */
function shortcutButton(html: string) {
  const tag = (html.match(/<button[^>]*>/) ?? [])[0];
  assert.ok(tag, "단축 단추를 못 찾았다 — 아래 단언이 공짜로 통과한다");
  const className = (tag.match(/class="([^"]*)"/) ?? [])[1];
  assert.ok(className, `단축 단추에 class 가 아예 없다: ${tag}`);
  return { tag, className };
}

test("🔴 고른 것이 단축 값과 꼭 같으면 눌린 모습이다 — 손으로 하나씩 체크해도 마찬가지", () => {
  const { tag } = shortcutButton(panel([...SHORTCUT.values], SHORTCUT));
  assert.match(tag, /aria-pressed="true"/);
  // 차례를 섞어도 같다 — 집합으로 견주는지는 값 쪽 시험이 더 자세히 본다.
  const shuffled = [...SHORTCUT.values].reverse();
  assert.match(shortcutButton(panel(shuffled, SHORTCUT)).tag, /aria-pressed="true"/);
});

test("🔴 하나 빠지거나 하나 더 있으면 안 눌린 모습이다", () => {
  assert.match(shortcutButton(panel([], SHORTCUT)).tag, /aria-pressed="false"/);
  assert.match(shortcutButton(panel(["RECEIVED"], SHORTCUT)).tag, /aria-pressed="false"/);
  assert.match(
    shortcutButton(panel([...SHORTCUT.values, "SHIPPED"], SHORTCUT)).tag,
    /aria-pressed="false"/
  );
});

test("🔴 눌린 모습과 안 눌린 모습은 **색이 다르다** — aria-pressed 만 바뀌면 눈으로는 못 본다", () => {
  const pressed = shortcutButton(panel([...SHORTCUT.values], SHORTCUT)).className;
  const idle = shortcutButton(panel([], SHORTCUT)).className;
  assert.notEqual(pressed, idle, "두 모습의 class 가 같다 — 화면을 보는 사람은 토글인 줄 모른다");

  // 🔵 「다르기만」 하면 글자 굵기처럼 눈에 잘 안 띄는 차이로도 통과한다. 눌린
  //    쪽에는 **마우스를 얹지 않아도 보이는** 바탕색이 있어야 한다 — 평상시
  //    바탕색만 세려고 hover 쪽 낱말을 먼저 걷어낸다.
  const restingBackgrounds = (className: string) =>
    className
      .split(/\s+/)
      .filter((token) => !token.includes("hover:"))
      .filter((token) => /(^|:)bg-/.test(token));
  assert.ok(restingBackgrounds(pressed).length > 0, `눌린 쪽에 바탕색이 없다: ${pressed}`);
  assert.equal(
    restingBackgrounds(idle).length,
    0,
    `안 눌린 쪽에 평상시 바탕색이 붙었다 — 둘이 안 갈린다: ${idle}`
  );
});

// ── 단축 단추를 **눌렀을 때** 무엇이 넘어가는가 ────────────────────────────
//
// 정적 렌더(renderToStaticMarkup)는 글자만 뱉고 누르기를 돌리지 못한다. 값 쪽
// 시험이 toggleShortcut 의 규칙을 보지만, **화면이 그 함수를 실제로 부르는가**는
// 거기서 못 본다 — 옛 코드(늘 단축 값으로 갈아 끼우기)로 되돌려도 위 시험은
// aria-pressed 만 보므로 전부 통과한다. 그래서 여기서는 컴포넌트 함수를 그냥
// **불러서** 돌아온 element 나무에서 단추를 찾아 onClick 을 직접 부른다
// (CheckboxFilterPanel 은 훅을 하나도 안 쓰므로 이렇게 부를 수 있다).

type ButtonProps = { onClick?: () => void; children?: ReactNode };

/** 나무에서 그 태그의 props 를 **그려지는 차례대로** 모은다. */
function elementsIn<P>(node: ReactNode, tag: string): P[] {
  if (Array.isArray(node)) return node.flatMap((child) => elementsIn<P>(child as ReactNode, tag));
  if (!isValidElement(node)) return [];
  const props = node.props as { children?: ReactNode };
  const inner = elementsIn<P>(props.children, tag);
  return node.type === tag ? [props as P, ...inner] : inner;
}

const buttonsIn = (node: ReactNode) => elementsIn<ButtonProps>(node, "button");

/** 단축 단추를 누른 뒤 onChange 에 넘어온 값들. */
function pressShortcut(selected: string[]): string[][] {
  const given: string[][] = [];
  const tree = CheckboxFilterPanel({
    panelId: "p",
    labelId: "l",
    options: OPTIONS,
    selected,
    onChange: (next) => given.push(next),
    shortcut: SHORTCUT,
  });
  const buttons = buttonsIn(tree);
  assert.equal(buttons.length, 1, "단축 단추 하나를 못 찾았다 — 아래 단언이 공짜로 통과한다");
  assert.ok(buttons[0].onClick, "단축 단추에 누르기 동작이 아예 없다");
  buttons[0].onClick?.();
  return given;
}

test("🔴 눌린 단추를 또 누르면 체크가 다 풀린다 — 빈 배열(= 전체)이 넘어간다", () => {
  assert.deepEqual(pressShortcut([...SHORTCUT.values]), [[]]);
  // 손으로 차례를 뒤섞어 체크해 눌린 모습이 된 사람도 마찬가지다.
  assert.deepEqual(pressShortcut([...SHORTCUT.values].reverse()), [[]]);
});

test("🔴 안 눌린 단추를 누르면 단축 값들로 갈아 끼운다 — 전과 같다", () => {
  assert.deepEqual(pressShortcut([]), [SHORTCUT.values]);
  assert.deepEqual(pressShortcut(["SHIPPED"]), [SHORTCUT.values]);
  assert.deepEqual(pressShortcut([...SHORTCUT.values, "SHIPPED"]), [SHORTCUT.values]);
});

test("🔴 눌려도 글자는 그대로 「입고품 전체」다 — 사용자가 지정한 이름이 사라지면 안 된다", () => {
  const html = panel([...SHORTCUT.values], SHORTCUT);
  assert.ok(html.includes("입고품 전체"));
  assert.ok(!html.includes("해제"), "눌렸다고 글자를 바꿨다");
  // 눌린 뒤에도 체크박스 수는 선택지 수 그대로 — 단축 단추가 한 줄을 더하지 않는다.
  assert.equal((html.match(/type="checkbox"/g) ?? []).length, OPTIONS.length);
  assert.equal((html.match(/checked=""/g) ?? []).length, SHORTCUT.values.length);
});

test("🔴 단축 단추도 type=\"button\" 이다", () => {
  const html = panel([], SHORTCUT);
  const buttons = html.match(/<button[^>]*>/g) ?? [];
  assert.equal(buttons.length, 1);
  assert.match(buttons[0], /type="button"/);
});

test("선택지가 비어도 터지지 않는다 — 고객사가 한 곳도 없는 화면이 있다", () => {
  const html = renderToStaticMarkup(
    <CheckboxFilterPanel panelId="p" labelId="l" options={[]} selected={[]} onChange={() => {}} />
  );
  assert.ok(!html.includes('type="checkbox"'));
});

// ── 🔴 단독 선택(selectionMode="single") — 2026-11-19 ───────────────────────
//
// 사용자 결정: [내자 정리]의 [상태] **한 칸만** 단독 선택이 된다. 되돌아가는 길은
// **둘 다** 둔다 — (가) 목록 맨 위의 「전체」 항목, (나) 고른 것을 다시 누르면 꺼짐.
//
// 🔴 **여기서 가장 중요한 것은 「안 넘기면 예전 그대로인가」**다(이름표 자리의 그
//    시험과 같은 까닭). 이 부품을 쓰는 아홉 칸 가운데 **여덟**이 이 prop 을 안
//    넘기므로, 기본값이 바뀌면 여덟 칸이 한꺼번에 단독 선택이 된다 — 오류는 한 줄도
//    안 나고, [전체 A/S 현황]에서 상태 둘을 함께 보던 사람만 알아챈다.

/** 단독 선택으로 펼친 목록을 글자로. */
function singlePanel(selected: string[], shortcut?: typeof SHORTCUT) {
  return renderToStaticMarkup(
    <CheckboxFilterPanel
      panelId="panel"
      labelId="label"
      options={OPTIONS}
      selected={selected}
      onChange={() => {}}
      shortcut={shortcut}
      selectionMode="single"
    />
  );
}

type RadioProps = { type?: string; name?: string; checked?: boolean; onClick?: () => void };

/**
 * 단독 선택 목록의 **동그라미들**. 맨 앞이 「전체」, 그 뒤가 선택지 차례다.
 * 돌려주는 `given` 에는 누른 뒤 onChange 로 넘어온 값이 쌓인다.
 */
function singleRadios(selected: string[], shortcut?: typeof SHORTCUT) {
  const given: string[][] = [];
  const tree = CheckboxFilterPanel({
    panelId: "p",
    labelId: "l",
    options: OPTIONS,
    selected,
    onChange: (next) => given.push(next),
    shortcut,
    selectionMode: "single",
  });
  const radios = elementsIn<RadioProps>(tree, "input");
  assert.equal(
    radios.length,
    OPTIONS.length + 1,
    "🔴 동그라미 수가 「전체」 한 줄 + 선택지 수가 아니다 — 아래 단언이 엉뚱한 줄을 누른다"
  );
  for (const radio of radios) {
    assert.equal(radio.type, "radio", "체크박스가 섞여 있다 — 한 개만 고르는 칸이 아니다");
    assert.ok(radio.onClick, "동그라미에 누르기 동작이 아예 없다");
  }
  // 🔴 한 묶음으로 묶여야 둘이 동시에 켜지지 않는다. 이름이 비면 브라우저가 묶지
  //    못하고, 다른 칸과 같으면 그 칸의 동그라미까지 꺼진다.
  const names = new Set(radios.map((radio) => radio.name));
  assert.equal(names.size, 1, `동그라미들의 name 이 갈렸다: ${[...names].join(" / ")}`);
  assert.ok([...names][0], "동그라미에 name 이 없다 — 브라우저가 한 묶음으로 안 본다");
  return { radios, given };
}

test("🔴 단독 선택이면 체크 대신 동그라미이고, 목록 **맨 위에 「전체」**가 선다", () => {
  const html = singlePanel([]);
  assert.equal((html.match(/type="radio"/g) ?? []).length, OPTIONS.length + 1);
  assert.ok(!html.includes('type="checkbox"'), "체크박스가 남아 있다");
  assert.ok(html.includes("전체"), "「전체」로 되돌아가는 길 (가)가 없다");
  assert.ok(
    html.indexOf("전체") < html.indexOf(OPTIONS[0].label),
    "「전체」가 선택지 아래로 내려갔다 — 맨 위여야 눈에 띈다"
  );
  for (const option of OPTIONS) {
    assert.ok(html.includes(option.label), `${option.label} 이 안 보인다`);
  }
});

test("🔴 아무것도 안 골랐으면 **「전체」가 켜져 있다** — 빈 목록처럼 보이면 안 된다", () => {
  const { radios } = singleRadios([]);
  assert.equal(radios[0].checked, true, "「전체」가 안 켜져 있다");
  assert.deepEqual(
    radios.slice(1).map((radio) => radio.checked),
    OPTIONS.map(() => false),
    "아무것도 안 골랐는데 선택지 쪽에 동그라미가 켜져 있다"
  );
});

test("🔴 고른 줄 하나만 켜지고 「전체」는 꺼진다", () => {
  const { radios } = singleRadios(["INSPECTING"]);
  assert.equal(radios[0].checked, false, "고른 것이 있는데 「전체」가 켜져 있다");
  assert.deepEqual(
    radios.slice(1).map((radio) => radio.checked),
    OPTIONS.map((option) => option.value === "INSPECTING"),
    "켜진 동그라미가 고른 줄이 아니다"
  );
});

test("🔴 다른 줄을 누르면 **그 값 하나**가 넘어간다 — 배열 길이 1", () => {
  const { radios, given } = singleRadios(["INSPECTING"]);
  radios[1].onClick?.(); // 선택지 첫 줄(접수)
  assert.deepEqual(given, [["RECEIVED"]]);
  assert.equal(given[0].length, 1, "단독 선택인데 값이 둘 이상 넘어갔다");
});

test("🔴 (나) 이미 고른 줄을 **다시 누르면 꺼진다** — 빈 배열(= 전체)이 넘어간다", () => {
  // 🔴 라디오가 거저 주는 동작이 아니다. `onChange` 로 받으면 이미 켜진 줄에서는
  //    사건 자체가 안 나서 **아무 일도 안 일어난다** — 그래서 부품이 click 으로 받고,
  //    이 시험이 그 규칙을 지킨다.
  const { radios, given } = singleRadios(["INSPECTING"]);
  radios[3].onClick?.(); // 선택지 셋째 줄(검사 중) = 지금 고른 줄
  assert.deepEqual(given, [[]]);
});

test("🔴 (가) 「전체」를 누르면 빈 배열이 넘어간다 — 골라 둔 것이 있든 없든", () => {
  const picked = singleRadios(["SHIPPED"]);
  picked.radios[0].onClick?.();
  assert.deepEqual(picked.given, [[]]);

  // 아무것도 안 고른 채로 눌러도 같은 값이다(아무 일도 안 일어난 것과 같다).
  const empty = singleRadios([]);
  empty.radios[0].onClick?.();
  assert.deepEqual(empty.given, [[]]);
});

test("🔴 값이 **둘 이상** 들어오면 선택지 차례의 첫 값만 켜고, 닫힌 칸과 같은 이름이다", () => {
  // 🔴 화면은 길이 0 또는 1 만 넘기지만, 주소줄이나 되돌리는 변경으로 둘이 들어올 수
  //    있다. 그때 무엇을 켜 보일지 **정해 두지 않으면** 다음 사람이 깨진 화면을 본다.
  //    정한 답: **선택지에 적힌 차례의 첫 값**(orderSelection) — 닫힌 칸이 말하는
  //    바로 그 이름이라, 칸과 목록이 서로 다른 것을 가리키지 않는다.
  const { radios } = singleRadios(["SHIPPED", "REPAIRING"]);
  assert.deepEqual(
    radios.slice(1).map((radio) => radio.checked),
    OPTIONS.map((option) => option.value === "REPAIRING"),
    "선택지 차례의 첫 값(수리 중)이 아닌 것이 켜졌다"
  );
  assert.equal(radios[0].checked, false, "고른 것이 있는데 「전체」가 켜졌다");
  // 🔴 닫힌 칸은 「수리 중 외 1개」라고 적는다 — 둘이 어긋나면 칸과 목록이 다른
  //    말을 하게 된다.
  assert.ok(
    closed(["SHIPPED", "REPAIRING"], { selectionMode: "single" }).includes("수리 중 외 1개"),
    "닫힌 칸이 가리키는 이름과 켜진 동그라미가 어긋난다"
  );
});

test("🔴 단독 선택에서는 단축 단추를 **넘겨도 안 그린다** — 여럿을 채우는 장치다", () => {
  const html = singlePanel([], SHORTCUT);
  assert.ok(!html.includes("입고품 전체"), "단독 선택인데 단축 단추가 그려졌다");
  assert.equal((html.match(/<button/g) ?? []).length, 0, "단독 선택 목록에 단추가 섰다");
  // 넘겨도 목록은 멀쩡히 그려진다 — 조용히 통째로 비면 그게 더 나쁘다.
  assert.equal((html.match(/type="radio"/g) ?? []).length, OPTIONS.length + 1);
  // 🔵 `"multi"` 쪽은 그대로 그린다 — 「안 그린다」가 단독 선택에서만인지 못 박는다.
  assert.ok(panel([], SHORTCUT).includes("입고품 전체"), "복수 선택에서도 단축이 사라졌다");
});

test("🔴 안 넘기면 **지금 그대로 복수 선택**이다 — 여덟 칸이 기대고 있는 기본값", () => {
  // 🔴 `"multi"` 를 적은 것과 **한 글자도 다르지 않아야** 한다. 기본값이 바뀌면
  //    여기서 깨진다(이름표 자리의 같은 모양 단언).
  const implicit = panel(["REPAIRING"]);
  assert.equal(
    implicit,
    renderToStaticMarkup(
      <CheckboxFilterPanel
        panelId="panel"
        labelId="label"
        options={OPTIONS}
        selected={["REPAIRING"]}
        onChange={() => {}}
        selectionMode="multi"
      />
    )
  );
  // 그리고 그 기본값이 **체크박스**다 — 동그라미도, 「전체」 한 줄도 없다.
  assert.equal((implicit.match(/type="checkbox"/g) ?? []).length, OPTIONS.length);
  assert.ok(!implicit.includes('type="radio"'), "기본값이 동그라미가 됐다");
  assert.ok(!implicit.includes(">전체<"), "복수 선택 목록에 「전체」 한 줄이 생겼다");
});

test("🔵 **닫힌 칸은 두 방식이 한 글자도 다르지 않다** — 다른 것은 펼친 목록뿐이다", () => {
  for (const selected of [[], ["REPAIRING"], ["RECEIVED", "REPAIRING"]]) {
    assert.equal(
      closed(selected, { selectionMode: "single" }),
      closed(selected),
      `닫힌 칸이 고르는 방식에 따라 달라졌다: ${JSON.stringify(selected)}`
    );
  }
});

test("🔵 단독 선택 목록은 읽어 주는 프로그램에 **radiogroup** 으로 전해진다", () => {
  // 「여럿 고를 수 있는 묶음」으로 전해지면 둘을 켜려고 시도하게 된다.
  assert.ok(singlePanel([]).includes('role="radiogroup"'));
  assert.ok(panel([]).includes('role="group"'), "복수 선택 쪽 role 이 함께 바뀌었다");
});
