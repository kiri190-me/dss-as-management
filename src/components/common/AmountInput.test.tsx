import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import AmountInput from "./AmountInput";

test("🔴 콤마 없는 값을 받아 칸에는 세 자리마다 콤마를 붙여 보여 준다", () => {
  const html = renderToStaticMarkup(<AmountInput value="3500000" onValueChange={() => {}} />);
  assert.match(html, /value="3,500,000"/);
  assert.match(html, /inputmode="decimal"/i);
  assert.match(html, /type="text"/);
});

test("넘겨준 속성(라벨 · 자리 표시 · 막힘)은 칸에 그대로 간다", () => {
  const html = renderToStaticMarkup(
    <AmountInput value="" onValueChange={() => {}} aria-label="1번째 부품 단가" placeholder="단가" disabled />
  );
  assert.match(html, /aria-label="1번째 부품 단가"/);
  assert.match(html, /placeholder="단가"/);
  assert.match(html, /disabled=""/);
  assert.match(html, /value=""/);
});

test("🔴 견적서 수정 화면의 금액 칸(부품 단가 · 작업비)이 이 부품을 쓴다", () => {
  const form = readFileSync("src/components/quotes/QuoteEditForm.tsx", "utf8").replace(/\s+/g, " ");
  assert.ok(form.includes('import AmountInput from "@/components/common/AmountInput";'));
  assert.ok(
    form.includes("<AmountInput value={row.unitPrice} onValueChange={(raw) => updateItem(row.key, { unitPrice: raw })}"),
    "부품 단가 칸이 콤마 칸이 아니다"
  );
  assert.ok(form.includes("<AmountInput value={workCost} onValueChange={setWorkCost}"), "작업비 칸이 콤마 칸이 아니다");
  // 콤마 없이 날것을 보여 주던 칸이 남아 있으면 안 된다.
  assert.ok(!form.includes("value={row.unitPrice} onChange="), "부품 단가의 옛 칸이 남았다");
  assert.ok(!form.includes("value={workCost} onChange="), "작업비의 옛 칸이 남았다");
});

test("🔴 작업 비용 화면의 시간당 작업비 칸이 이 부품을 쓴다", () => {
  const screen = readFileSync("src/components/repair-labor/RepairLaborScreen.tsx", "utf8").replace(/\s+/g, " ");
  assert.ok(screen.includes('import AmountInput from "@/components/common/AmountInput";'));
  assert.ok(screen.includes("<AmountInput value={hourlyRate} onValueChange={setHourlyRate}"), "시간당 작업비 칸이 콤마 칸이 아니다");
  assert.ok(!screen.includes("value={hourlyRate} onChange="), "시간당 작업비의 옛 칸이 남았다");
  // 🔴 기본 작업비는 **2026-09-16 부터 적는 칸이 아니다** — 세 공수시간의 합이라 적을
  // 것이 없다(schema/repair-labor.ts · domain/quote-labor-cost.ts). 칸이 되살아나면
  // 사람이 고쳐도 견적서 금액이 안 바뀌던 그 자리가 돌아온다. 읽기 전용 표시가
  // 제대로 서 있는지는 repair-labor/repair-labor-screen-source.test.ts 가 본다.
  assert.ok(!screen.includes("setBaseCost"), "🔴 기본 작업비를 적는 칸이 되살아났다");
});

test("🔴 금액 칸의 「정하지 않음(빈 칸)」과 0 은 부품을 지나도 갈린다", () => {
  assert.match(renderToStaticMarkup(<AmountInput value="" onValueChange={() => {}} />), /value=""/);
  assert.match(renderToStaticMarkup(<AmountInput value="0" onValueChange={() => {}} />), /value="0"/);
});
