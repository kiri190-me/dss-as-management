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

function closed(selected: string[], extra: { shortcut?: typeof SHORTCUT } = {}) {
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

function buttonsIn(node: ReactNode): ButtonProps[] {
  if (Array.isArray(node)) return node.flatMap((child) => buttonsIn(child as ReactNode));
  if (!isValidElement(node)) return [];
  const props = node.props as { children?: ReactNode };
  const inner = buttonsIn(props.children);
  return node.type === "button" ? [props as ButtonProps, ...inner] : inner;
}

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
