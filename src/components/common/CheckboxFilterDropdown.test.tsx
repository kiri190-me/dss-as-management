import { test } from "node:test";
import assert from "node:assert/strict";
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
