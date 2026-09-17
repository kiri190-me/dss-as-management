import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  buildPartOwnerStockRows,
  type PartOwnerStockBalance,
} from "@/lib/domain/part-owner-stock-rows";
import { STOCK_OWNER_CODES, type StockOwner } from "@/lib/domain/inventory-types";
import { parseMinimumQuantityValue } from "@/lib/validation/part-minimum-quantity-input";

/**
 * ============================================================================
 * 부품 상세 — 「재고 보유」와 「단가 · 한계수량」을 **한 표로** 합쳤다
 * ============================================================================
 * 2026-09-17 사용자 요청. 칸은
 * `소유 구분 / 위치 / 현재 수량 / 한계수량 / (부족) / (동작)` 하나뿐이다.
 *
 * 못 박는 것:
 *   ① 소유구분 **넷이 모두** 줄로 나온다 — 재고 행이 하나도 없어도.
 *   ② 🔴 현재 수량은 그 소유의 **위치 합계**다 — 위치별로 줄을 쪼개지 않는다.
 *   ③ 위치가 여럿이면 「위치」 칸에 나열한다.
 *   ④ 부족 배지 판정은 그대로다(저장된 한계수량 기준, `현재 < 한계`).
 *   ⑤ 저장은 단추 하나 · 요청 하나 · 트랜잭션 하나다.
 *   ⑥ 단가는 표 **밖**에 있다(부품마다 하나이지 소유구분별이 아니다).
 *   ⑦ 한계수량을 비우면 0 이 아니라 **행이 지워진다**.
 *
 * ── 왜 렌더하지 않고 원본을 읽는가 ──────────────────────────────────────
 * PartBalanceGrid · PartMinimumQuantitySection 은 서버 액션을 직접 import 하는
 * 클라이언트 컴포넌트라, 그 사슬 끝의 `server-only` 때문에 react-server 조건 없이
 * 도는 test:components 에서는 import 자체가 던진다. 이웃 시험
 * (part-issue-approval-screen.test.tsx)과 같은 방법을 쓴다 — 줄 만들기 규칙만
 * 순수 함수로 꺼내 실제로 돌리고(①②③), 화면 쪽은 원본을 글자로 읽는다.
 * ============================================================================
 */

const repoUrl = new URL("../../../", import.meta.url);
const read = (relativePath: string) => readFileSync(new URL(relativePath, repoUrl), "utf8");

/** 줄바꿈·들여쓰기 차이로 시험이 깨지지 않도록 공백을 하나로 접는다. */
const flat = (source: string) => source.replace(/\s+/g, " ");

/**
 * 주석을 걷어낸 원본. "이 글자가 **없어야** 한다"를 볼 때만 쓴다 — 머리말이
 * 「단가는 이 표 밖이다」처럼 금지어를 설명하고 있어서, 그대로 세면 설명글에
 * 걸린다.
 */
const withoutComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|\s)\/\/[^\n]*/g, "$1");

const gridSource = read("src/components/inventory/PartBalanceGrid.tsx");
const sectionSource = read("src/components/inventory/PartMinimumQuantitySection.tsx");
const detailScreenSource = read("src/components/inventory/InventoryPartDetailScreen.tsx");
const mutationSource = read("src/lib/db/mutations/part-minimum-quantities.ts");
const actionSource = read("src/lib/server/actions/part-minimum-quantities.ts");

type Balance = PartOwnerStockBalance & { id: string; location: string };
const balance = (id: string, owner: StockOwner, location: string, currentQuantity: number): Balance => ({
  id,
  owner,
  location,
  currentQuantity,
});

describe("표의 줄 만들기 — 소유구분 넷 고정, 현재 수량은 위치 합계", () => {
  test("① 재고 행이 하나도 없어도 소유구분 넷이 모두 줄로 나온다", () => {
    const rows = buildPartOwnerStockRows<Balance>([], new Map());
    assert.deepEqual(
      rows.map((row) => row.owner),
      [...STOCK_OWNER_CODES]
    );
    for (const row of rows) {
      assert.deepEqual(row.balances, [], row.owner);
      assert.equal(row.currentQuantity, 0, row.owner);
      // 🔴 "정하지 않음"은 null 이다 — 0(바닥나면 알려 달라)이 아니다.
      assert.equal(row.minimumQuantity, null, row.owner);
    }
  });

  test("① 재고가 없는 소유구분에도 한계수량을 걸 수 있다 — 값이 줄에 실린다", () => {
    const rows = buildPartOwnerStockRows<Balance>([], new Map([["TEST", 2]]));
    const testRow = rows.find((row) => row.owner === "TEST");
    assert.ok(testRow);
    assert.equal(testRow.balances.length, 0);
    assert.equal(testRow.currentQuantity, 0);
    assert.equal(testRow.minimumQuantity, 2);
  });

  test("🔴 ② 한 소유에 위치가 셋이어도 줄은 하나이고, 현재 수량은 그 합계다", () => {
    const rows = buildPartOwnerStockRows<Balance>(
      [
        balance("b-1", "DSS", "A-1", 3),
        balance("b-2", "DSS", "B-2", 4),
        balance("b-3", "DSS", "C-3", 5),
        balance("b-4", "KYOSAN", "A-1", 7),
      ],
      new Map()
    );

    // 위치별로 쪼갰다면 여섯 줄이 되었을 것이다.
    assert.equal(rows.length, STOCK_OWNER_CODES.length);
    const dss = rows.find((row) => row.owner === "DSS");
    assert.ok(dss);
    assert.equal(dss.currentQuantity, 12);
    assert.deepEqual(
      dss.balances.map((b) => b.location),
      ["A-1", "B-2", "C-3"]
    );
    const kyosan = rows.find((row) => row.owner === "KYOSAN");
    assert.equal(kyosan?.currentQuantity, 7);
  });

  test("🔴 ② 부족 판정은 위치 합계로 한다 — 위치마다 보면 부족이 아닌데 합치면 부족이다", () => {
    // 한계 10, 위치 둘에 4 + 4 = 8. 쪼개 보면 "4 는 한계 10 미만"이 위치마다 두 번
    // 뜨고, 합쳐 보면 부족 한 건이다. DB 의 부족 조회(소유별 SUM)와 같은 답이어야 한다.
    const rows = buildPartOwnerStockRows<Balance>(
      [balance("b-1", "DSS", "A-1", 4), balance("b-2", "DSS", "B-2", 4)],
      new Map([["DSS", 10]])
    );
    const dss = rows.find((row) => row.owner === "DSS");
    assert.ok(dss);
    assert.equal(dss.currentQuantity, 8);
    assert.equal(dss.minimumQuantity !== null && dss.currentQuantity < dss.minimumQuantity, true);

    // 같은 수량에 한계가 8 이면 부족이 아니다(같으면 부족이 아니다 — `<` 이다).
    const notShort = buildPartOwnerStockRows<Balance>(
      [balance("b-1", "DSS", "A-1", 4), balance("b-2", "DSS", "B-2", 4)],
      new Map([["DSS", 8]])
    );
    const dssNotShort = notShort.find((row) => row.owner === "DSS");
    assert.ok(dssNotShort);
    assert.equal(dssNotShort.minimumQuantity !== null && dssNotShort.currentQuantity < dssNotShort.minimumQuantity, false);
  });

  test("한계수량 0 은 null 로 뭉개지지 않는다", () => {
    const rows = buildPartOwnerStockRows<Balance>([], new Map([["DSS", 0]]));
    assert.equal(rows.find((row) => row.owner === "DSS")?.minimumQuantity, 0);
    assert.equal(rows.find((row) => row.owner === "KYOSAN")?.minimumQuantity, null);
  });
});

describe("합친 표 — 칸과 줄", () => {
  test("표는 하나다 — 두 <table> 로 갈라져 있지 않다", () => {
    assert.equal(gridSource.match(/<table/g)?.length, 1);
    assert.equal(sectionSource.match(/<table/g)?.length, undefined);
  });

  test("칸 머리글이 소유 구분 · 위치 · 현재 수량 · 한계수량 순이다", () => {
    assert.match(
      flat(gridSource),
      /<th className="px-3 py-2">소유 구분<\/th> <th className="px-3 py-2">위치<\/th> <th className="px-3 py-2 text-right">현재 수량<\/th> <th className="px-3 py-2 text-right">한계수량<\/th>/
    );
  });

  test("🔴 ② 줄은 소유구분마다 하나다 — <tr> 은 머리글 하나 + 몸통 하나뿐이다", () => {
    // 위치별로 줄을 만들었다면 이 수가 늘어난다(머리글 하나 + 몸통 하나).
    assert.equal(withoutComments(gridSource).match(/<tr[ >]/g)?.length, 2);
    assert.match(flat(gridSource), /\{rows\.map\(\(row\) => \{/);
    assert.match(flat(gridSource), /<tr key=\{row\.owner\}/);
    // 현재 수량 칸은 줄의 **합계**를 그린다(재고 행 하나의 수량이 아니다).
    assert.match(flat(gridSource), /\{row\.currentQuantity\} <\/td>/);
    assert.ok(
      !/\{balance\.currentQuantity\}/.test(gridSource),
      "재고 행 하나의 수량을 그대로 그리면 합계가 아니다"
    );
  });

  test("③ 위치가 여럿이면 그 칸에 나열하고, 없으면 -", () => {
    assert.match(flat(gridSource), /\{row\.balances\.length === 0 \? \( "-" \) : \(/);
    assert.match(flat(gridSource), /\{row\.balances\.map\(\(balance\) => \( <span key=\{balance\.id\}[^>]*> \{balance\.location\}/);
    // 사용·반환은 재고 행(위치) 하나를 집어 부르므로 위치마다 한 벌이다.
    assert.match(flat(gridSource), /setSelected\(\{ balanceId: balance\.id, action: "CONSUME" \}\)/);
    assert.match(flat(gridSource), /setSelected\(\{ balanceId: balance\.id, action: "RETURN" \}\)/);
    // 위치가 둘 이상일 때만 동작 칸에 위치를 덧붙인다 — 어느 위치의 단추인지 갈라야 한다.
    assert.match(flat(gridSource), /const showLocationTag = row\.balances\.length > 1;/);
  });

  test("🔴 ④ 부족 배지 판정은 저장된 한계수량 기준 그대로다", () => {
    assert.match(
      flat(gridSource),
      /const isShort = row\.minimumQuantity !== null && row\.currentQuantity < row\.minimumQuantity;/
    );
    assert.match(flat(gridSource), /\{isShort && \( <span[^>]*> 부족 <\/span> \)\}/);
    // 아직 저장하지 않은 입력값(edits)은 이 판정에 닿지 않는다 — 표는 그것을 모른다.
    assert.ok(!/edits/.test(gridSource), "저장 전 입력값으로 부족을 판정하면 종 알림과 다른 말을 한다");
  });

  test("🔴 ⑥ 단가는 표 밖이다 — 표에는 단가 칸이 없고, 입력칸이 표보다 위에 있다", () => {
    assert.ok(!/단가|unitPrice/.test(withoutComments(gridSource)), "단가가 표 안으로 돌아왔다");
    const priceAt = sectionSource.indexOf('id="part-unit-price"');
    const tableAt = sectionSource.indexOf("<PartBalanceGrid");
    assert.ok(priceAt >= 0 && tableAt >= 0);
    assert.ok(priceAt < tableAt, "단가 입력칸이 표 아래로 내려갔다");
    assert.match(flat(sectionSource), /소유 구분과 무관하게 이 부품 하나의 값입니다\./);
  });

  test("한계수량 칸은 폼이 그린다 — 표는 자리만 내준다", () => {
    assert.match(flat(gridSource), /renderMinimumQuantityCell: \(owner: StockOwner\) => ReactNode;/);
    assert.match(flat(gridSource), /<td className="px-3 py-2 text-right align-top">\{renderMinimumQuantityCell\(row\.owner\)\}<\/td>/);
    assert.match(flat(sectionSource), /renderMinimumQuantityCell=\{\(owner\) => \{/);
    assert.match(flat(sectionSource), /aria-label=\{`\$\{stockOwnerLabels\[owner\]\} 한계수량`\}/);
  });

  test("읽기 전용이면 입력칸도 저장 단추도 그리지 않고 값만 보인다", () => {
    assert.match(flat(sectionSource), /\{canEdit \? \( <input type="text" inputMode="numeric"/);
    assert.match(flat(sectionSource), /\{savedMinimum === null \? "-" : savedMinimum\}/);
    assert.match(flat(sectionSource), /\{canEdit && \( <div className="mt-3 flex justify-end">/);
    // [사용]·[반환]은 다른 판정이다(inventory.stock) — 한계수량 쓰기 권한과 묶이지 않는다.
    assert.match(flat(gridSource), /const showUseButton = capabilities\.stock;/);
    assert.ok(!/canEdit/.test(gridSource), "표가 한계수량 쓰기 권한을 다시 판정한다");
  });
});

describe("저장 — 단추 하나 · 요청 하나 · 트랜잭션 하나", () => {
  test("⑤ 화면에 저장 단추는 하나뿐이고 액션도 한 번 부른다", () => {
    assert.equal(sectionSource.match(/\{isSubmitting \? "저장 중\.\.\." : "저장"\}/g)?.length, 1);
    assert.equal(sectionSource.match(/savePartMinimumQuantitiesAction\(/g)?.length, 1);
    // 넷 모두를 한 요청에 싣는다 — 고친 칸만 보내면 서버가 나머지를 "건드리지 말라"로 읽는다.
    assert.match(
      flat(sectionSource),
      /entries: STOCK_OWNER_CODES\.map\(\(owner\) => \(\{ owner, minimumQuantity: valueOf\(owner\) \}\)\)/
    );
    // 🔴 단가는 빈 문자열이라도 언제나 실어 보낸다(보내지 않으면 지우기가 무시된다).
    assert.match(flat(sectionSource), /unitPrice: priceValue,/);
  });

  test("⑤ 액션은 한 mutation 으로 가고, 그 mutation 은 트랜잭션 하나다", () => {
    assert.match(flat(actionSource), /savePartOwnerSettings\(\{ partId: input\.partId, entries: input\.entries, unitPrice: input\.unitPrice,/);
    assert.equal(mutationSource.match(/await db\.transaction\(/g)?.length, 1);
    // 권한 판정도 그 트랜잭션 안에서 한 번뿐이다.
    assert.equal(mutationSource.match(/hasPermission\(actor, "inventory\.parts", "WRITE"\)/g)?.length, 1);
  });

  test("🔴 ⑦ 한계수량을 비우면 0 이 아니라 행이 지워진다", () => {
    // 빈 칸은 null 로 읽힌다 — 0 이 아니다.
    assert.deepEqual(parseMinimumQuantityValue(""), { ok: true, value: null });
    assert.deepEqual(parseMinimumQuantityValue("   "), { ok: true, value: null });
    assert.deepEqual(parseMinimumQuantityValue("0"), { ok: true, value: 0 });
    // 그리고 그 null 은 행을 지운다.
    assert.match(
      flat(mutationSource),
      /if \(minimumQuantity === null\) \{ if \(!previous\) return 0; await tx\.delete\(partMinimumQuantities\)/
    );
    // 단가도 같다 — 비우면 행을 지운다(0 은 무상이라 다른 뜻이다).
    assert.match(
      flat(read("src/lib/db/mutations/part-unit-prices.ts")),
      /if \(unitPrice === null\) \{ if \(!previous\) return 0; await tx\.delete\(partUnitPrices\)/
    );
  });
});

describe("부품 상세 화면 — 구역이 하나로 합쳐졌다", () => {
  test("옛 「재고 보유 (소유 × 위치)」 구역과 그 표는 사라졌다", () => {
    assert.ok(!/재고 보유 \(소유 × 위치\)/.test(detailScreenSource));
    assert.ok(
      !/<PartBalanceGrid/.test(detailScreenSource),
      "표를 두 자리에서 그리면 다시 둘로 갈라진다 — 이제 폼 안에서만 그린다"
    );
    assert.equal(detailScreenSource.match(/<PartMinimumQuantitySection/g)?.length, 1);
  });

  test("줄 만들기는 순수 함수 하나를 쓴다 — 화면이 다시 세지 않는다", () => {
    assert.match(
      flat(detailScreenSource),
      /const ownerStockRows = buildPartOwnerStockRows\(part\.balances, minimumByOwner\);/
    );
    assert.ok(
      !/quantityByOwner/.test(detailScreenSource),
      "합계를 화면에서 한 벌 더 세고 있다"
    );
  });
});
