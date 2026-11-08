import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * ============================================================================
 * [형식] 링크 — **세 자리가 한 벌로 구는가** (2026-11-06)
 * ============================================================================
 * 「어떤 줄에 링크가 서는가」는 도메인 시험이 값으로 잰다
 * (lib/domain/domestic-order-detail-link.test.ts). 여기서 재는 것은 **자리**다 —
 * 규칙이 아무리 옳아도 부르는 자리가 빠지면 그 화면만 예전 그대로 굴러간다.
 *
 * 내자 정리에서 [형식]이 그려지는 자리는 **넷**이다(실측 2026-11-06):
 *   ① 목록의 표       — `<td>` 본문
 *   ② 목록의 카드     — CARD_FIELD_GROUPS 의 `제품` 묶음
 *   ③ 휴지통의 표     — DomesticOrderTrashPanel
 *   ④ 휴지통의 카드   — 같은 조각의 좁은 화면 쪽
 * ①②는 **같은 조각**(ModelNameLink)을 쓰고, ③④는 **일부러 안 쓴다** — 지운 줄은
 * 상세 조회가 읽지 않아 전부 404 가 되고, 휴지통이 받는 행에는 `repairCaseId` 가
 * 아예 없어 「수리 건이 붙었는가」를 가를 재료도 없다(그 화면의 주석).
 *
 * ── 왜 렌더하지 않고 원본을 읽는가 ──────────────────────────────────────
 * DomesticOrderListScreen 은 서버 액션을 직접 import 하는 클라이언트 컴포넌트라,
 * 그 사슬 끝의 `server-only` 때문에 react-server 조건 없이 도는 test:components 에서는
 * import 자체가 던진다. 이웃 시험(domestic-order-inline-cells.test.ts)과 같은 방법이다.
 *
 * 🔴 **주석을 걷어낸 뒤에 센다.** 이 파일의 주석에 `ModelNameLink` 라는 낱말이 여러
 * 번 적혀 있어, 주석째 세면 「쓰는 곳이 둘이다」가 넷·다섯으로 셈이 틀린다. 반대로
 * 「있어야 한다」 쪽은 **주석만으로 영영 통과한다.**
 * ============================================================================
 */

const repoUrl = new URL("../../../", import.meta.url);
const read = (relativePath: string) =>
  readFileSync(new URL(relativePath, repoUrl), "utf8").replace(/\r\n/g, "\n");

/** 줄 주석(`//`)과 블록 주석(`/* … *\/`)을 걷어낸다. */
const stripComments = (source: string) =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^[ \t]*\/\/[^\n]*$/gm, " ")
    .replace(/\/\/[^\n]*$/gm, " ");

/** 줄바꿈·들여쓰기 차이로 시험이 깨지지 않도록 공백을 하나로 접는다. */
const flat = (source: string) => source.replace(/\s+/g, " ");

const sliceBetween = (source: string, startMarker: string, endMarker: string) => {
  const start = source.indexOf(startMarker);
  assert.ok(start >= 0, `원본에서 '${startMarker}' 를 찾지 못했다`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(end > start, `원본에서 '${endMarker}' 를 찾지 못했다`);
  return source.slice(start, end);
};

const count = (source: string, needle: string) => source.split(needle).length - 1;

const raw = read("src/components/domestic-orders/DomesticOrderListScreen.tsx");
const screen = flat(stripComments(raw));

/** ① 목록의 표 본문. ② 목록의 카드 칸 목록. ③④ 휴지통 한 덩어리. */
const tableBody = sliceBetween(screen, "{group.rows.map((row) => {", "cards={");
const cardGroups = sliceBetween(screen, 'label: "발주",', "function CompletedBadge");
const trashPanel = sliceBetween(screen, "function DomesticOrderTrashPanel(", "function trashTarget(");

test("🔵 못 — 주석을 걷어낸 원본이 비어 있지 않고, 걷어내기가 실제로 문다", () => {
  assert.ok(screen.length > 40_000, `원본이 너무 짧다(${screen.length})`);
  for (const slice of [tableBody, cardGroups, trashPanel]) {
    assert.ok(slice.length > 200, `잘라 낸 자리가 너무 짧다(${slice.length})`);
  }
  // 걷어내기가 안 물면 아래 「쓰는 곳이 둘이다」가 주석 때문에 틀린 수로 센다.
  assert.equal(count(stripComments("/* ModelNameLink */ const a = 1;"), "ModelNameLink"), 0);
  assert.equal(count(stripComments("  // ModelNameLink\nconst a = 1;"), "ModelNameLink"), 0);
  assert.equal(count(stripComments("<ModelNameLink row={row} />"), "ModelNameLink"), 1);
});

describe("🔴 목록 — 표와 카드가 **같은 조각**을 쓴다", () => {
  test("① 표의 형식 칸이 ModelNameLink 다(글자를 직접 그리지 않는다)", () => {
    assert.match(tableBody, /<td className="px-3 py-2"> <ModelNameLink row=\{row\} \/> <\/td>/);
    assert.equal(
      tableBody.includes("{dash(row.modelName)}"),
      false,
      "표가 아직 형식 글자를 직접 그린다 — 링크가 안 선다"
    );
  });

  test("② 카드의 형식 칸도 같은 조각이다 — 좁은 화면이라고 눌리던 칸이 글자가 되지 않는다", () => {
    assert.match(cardGroups, /\{ label: "형식", of: \(row\) => <ModelNameLink row=\{row\} \/> \}/);
    assert.equal(
      cardGroups.includes('label: "형식", of: (row) => dash(row.modelName)'),
      false,
      "카드가 아직 형식 글자를 직접 그린다"
    );
  });

  test("🔴 마디를 돌려주는 칸에 multiline 을 켜지 않았다 — 접는 방식이 <dd> 와 갈린다", () => {
    const entry = sliceBetween(cardGroups, 'label: "형식"', 'label: "고장내역"');
    assert.equal(entry.includes("multiline: true"), false, entry);
  });
});

describe("🔴 휴지통 — 여기만은 링크가 서지 않는다", () => {
  test("③④ 휴지통의 표와 카드는 ModelNameLink 를 쓰지 않는다(전부 404 가 된다)", () => {
    assert.equal(
      count(trashPanel, "ModelNameLink"),
      0,
      "휴지통에 링크가 섰다 — 지운 줄은 상세 조회가 읽지 않아 404 로 간다"
    );
  });

  test("휴지통의 형식 칸은 예전 글자 그대로다 — 표와 카드 둘 다", () => {
    assert.equal(
      count(trashPanel, "{dash(row.modelName)}"),
      2,
      "휴지통의 형식 칸이 둘이 아니다 — 표/카드 중 하나가 바뀌었다"
    );
  });
});

describe("🔴 링크를 쓰는 곳은 정확히 둘 — 규칙은 화면이 아니라 도메인이 쥔다", () => {
  /**
   * 🔴 **끝 표시를 바로 다음 함수로 둔다**(2026-11-08). 전에는 `export default
   * function` 까지 잘랐는데, 그러면 **그 사이에 있는 남의 함수**까지 이 시험이 읽는다 —
   * 2026-11-08 에 회차별 완료 단추가 그 사이에 서면서(그 함수는 `row.repairCaseId ===
   * null` 로 기타건을 가린다) 멀쩡한 코드가 아래 단언에 걸렸다. 재려는 것은
   * **ModelNameLink 의 본문**뿐이다.
   */
  const modelNameLinkBody = () =>
    sliceBetween(screen, "function ModelNameLink(", "function CompletionToggle(");

  test("ModelNameLink 를 그리는 자리가 둘(표 · 카드)이고, 선언이 하나다", () => {
    // 선언 1 + 표 1 + 카드 1 = 3. 늘면 어딘가에 넷째 자리가 생긴 것이고,
    // 줄면 한 화면이 조용히 예전 글자로 돌아간 것이다.
    assert.equal(count(screen, "ModelNameLink"), 3, screen.slice(0, 0));
    assert.equal(count(screen, "function ModelNameLink("), 1);
  });

  test("🔴 화면이 repairCaseId 로 직접 가르지 않는다 — 도메인 함수 하나에 묻는다", () => {
    const component = modelNameLinkBody();
    assert.ok(component.includes("const link = resolveDomesticOrderModelLink(row);"), component);
    assert.equal(
      component.includes("row.repairCaseId"),
      false,
      "화면이 링크 조건을 다시 적었다 — 목록과 도메인의 규칙이 갈라진다"
    );
    assert.equal(count(screen, "resolveDomesticOrderModelLink("), 1, "규칙을 부르는 곳이 둘이다");
  });

  test("🔴 줄(카드) 전체의 누르기로 새지 않는다 — 안 막으면 넘어가면서 수정 폼도 열린다", () => {
    const component = modelNameLinkBody();
    assert.ok(component.includes("onClick={(event) => event.stopPropagation()}"), component);
  });

  test("⚠️ sr-only 는 relative 가 있는 링크 안에만 — 떼면 페이지가 표 아래로 굴러간다", () => {
    const component = modelNameLinkBody();
    assert.ok(component.includes('className="relative text-blue-700'), component);
    assert.equal(count(component, 'className="sr-only"'), 1, component);
  });
});
