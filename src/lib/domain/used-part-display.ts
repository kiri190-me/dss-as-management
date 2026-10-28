import { partFieldValue, type PartPickerRow } from "@dss/core/ui/inventory/part-picker-rows";
import { normalizeKey } from "@/lib/kyosan/card-grid";
import { kyosanUsedPartKey } from "@/lib/kyosan/report-preview";
import type { InventoryResult } from "./inventory-gateway";

/**
 * ============================================================================
 * 사용 부품을 **「고객사 품명 (품번)」** 으로 보인다 — 합치는 규칙 한 벌 (2026-10-28)
 * ============================================================================
 * 저장되는 글자는 **품번 하나**다. 2026-10-28 에 연락서 이식이 `型式` → `仕様書番号`
 * → `部品名` 차례로 **품번 칸**을 먼저 읽게 바뀌었고(`kyosan/parts-detail-sheet.ts`
 * 머리말), 그래서 `repair_case_used_parts.part_name_text` 에는 `SCV-255P110` 같은
 * 품번이 들어간다. 🔴 **그 글자는 바꾸지 않는다** — 합치는 일은 **보여 줄 때만** 한다.
 *
 * ── 🔴 왜 이름을 재고 관리에서 가져오는가 (사용자 결정 2026-10-28) ──────
 * 품번만 보이면 사람이 무슨 부품인지 모른다. 그렇다고 A/S 가 이름을 따로 적어 두면
 * 재고 관리에서 이름이 바뀐 날 A/S 만 옛말을 한다. 운영 실측에서 A/S 사용 부품
 * 이름과 재고 관리 부품명의 겹침이 **4.2%** 였던 것도 그런 「따로 적어 둔 이름」이
 * 서로 갈라져서다(「퓨즈 / 휴즈」, 일본어 / 한글).
 *
 * 🔵 그래서 **이름을 맞추지 않고 재고 관리에서 가져온다.** 나중에 재고 관리에서
 *    고객사 품명을 채우면 A/S 는 **아무것도 안 고쳐도 저절로 바뀐다** — 이것이
 *    이 설계를 고른 까닭이다.
 *
 * ── 🔴 갈래는 둘뿐이다 — 「이름을 얻었나」 ──────────────────────────────
 *     얻었으면  →  `고객사 품명 (품번)`
 *     못 얻었으면 →  `품번`
 *
 * 못 얻는 길은 넷이다. **넷 다 품번**이다:
 *   ㉠ 재고 관리에 그 품번이 **없다**
 *   ㉡ 있는데 **고객사 품명이 비어 있다**(🔴 `-` 만 적힌 칸도 빈 칸이다)
 *   ㉢ 재고 관리에 **못 물어봤다**(주소 없음 · 늦음 · 401 · 본문을 못 읽음)
 *   ㉣ **한 칸 안에서** 그 품번에 **서로 다른 고객사 품명**이 걸리고 뒤 칸에도 짝이 없다
 *      (아래 `indexCustomerNames`. 🔴 **칸끼리** 다른 것은 엇갈림이 아니다 — 아래
 *      「칸이 다르면 엇갈림이 아니다」 절)
 *
 * 🔴 **㉢ 에서 빈 칸이나 「불러오지 못했습니다」를 보이지 않는다.** 사용 부품은 이미
 *    저장된 **사실**이고, 재고 관리가 멈췄다고 그 사실이 화면에서 사라지면 안 된다.
 *    🔴 이 자리는 `inventory-gateway.ts` 머리말의 「못 받아 왔다 ≠ 하나도 없다」를
 *    **일부러 같게 다루는 유일한 자리**다 — 거기서 둘을 가르는 까닭은 「재고에 부품이
 *    하나도 없다」는 거짓말을 막으려는 것인데, 여기서 하는 말은 「이 건에 이 품번이
 *    나갔다」뿐이라 재고 관리의 형편과 상관없이 참이다. 갈라 봐야 할 말이 같다.
 *
 * ── 🔴 어느 칸으로 맞추는가 — **도번 → 교산 품번 → 품명2 → 품명** (2026-10-29) ──
 * 저장된 글자는 연락서의 `型式`·`仕様書番号` 에서 온 **품번**이다. 재고 관리에서 그것과
 * 맞을 수 있는 칸을 **넷** 본다. 차례를 정한 것은 뜻이 아니라 **운영에서 잰 수**다 —
 * 품번 백필이 끝난 뒤 `npm run check:part-name-overlap` 을 돌린 2026-10-29 실측이고,
 * 분모는 사용 부품 1,222줄에 적힌 **서로 다른 이름 267가지**, 맞댄 쪽은 재고 관리 부품
 * 319줄, 눌림은 아래와 같은 「더 눌러서(+장음·붙임표)」 단계다:
 *
 *   차례  칸                                  값이 있는 줄   267가지 중 겹침
 *    1   **도번**(`drawingNo`)                     257      **81 · 30.3%**
 *    2   교산 품번(`kyosanPartNo`)                   62         1 ·  0.4%
 *    3   품명2(`partSpec` — 재고 관리의 `name2`)     163        39 · 14.6%
 *    4   품명(`partName`)                           109         8 ·  3.0%
 *        (열쇠로 **안 쓰는** 고객사 품명)              27         6 ·  2.2%
 *        아무 칸이나 — 합                              —        98 · 36.7%
 *
 * 🔴 **연락서에서 읽어 저장한 품번이 들어 있는 칸은 「도번」이다.** 재고 관리 화면의 한
 *    부품이 그대로 보여 준다 — 굵은 제목이 고객사 품명(`종단 AMP 게이트 기판`), 그 아래
 *    `품명 AMP-DEH-G(13M)-PLS`, `도번 WR10775AA321F`. 사람이 품번이라 부르며 연락서에
 *    적는 글자가 **도번 칸**에 있다.
 *
 * 🔴 그래서 2026-10-28 에 이 자리에 적혀 있던 근거는 **틀렸다.** 지우지 않고 인용으로
 *    남긴다 — 다음 사람이 수를 다시 재지 않고 「뜻으로 보면 교산 품번 하나면 되지」로
 *    되돌아가지 않게:
 *
 *      > 1. **교산 품번**(`kyosanPartNo`) — 뜻으로 보아 품번이 들어갈 자리는 여기 하나다.
 *      > 🔴 **일부러 안 보는 칸 셋**: … · **도번** — 도면 번호는 품번과 다른 체계다.
 *      > 🔵 칸을 늘리면 겹침은 올라가고 **틀린 이름이 뜰 확률도 함께** 올라간다.
 *
 *    🔵 그때 교산 품번을 두고 「0% 지만 **재 보기 전에 빼지 않는다**」고 한 판단 자체는
 *       옳았다. 이제 재었고 **0.4%** 다. 뜻으로는 여전히 품번 자리라 **빼지 않고 둘째**에
 *       둔다(뜻이 맞는 칸이 우연히 맞은 칸보다 앞이어야 한다는 아래 규칙 그대로다).
 * 🔵 **품명2 는 무슨 칸인지 뜻이 확실치 않다** — 규격(`AC100V` 따위)이 적힌 줄이 있어
 *    2026-10-28 에는 「맞으면 우연」이라고 보고 뺐는데, 실측은 14.6% 로 둘째다. 수는
 *    높지만 뜻을 모르므로 **품번인 칸 둘 뒤**에 둔다. 품명은 3.0% 짜리 **비상구**다.
 * 🔴 **고객사 품명은 끝까지 열쇠가 아니다** — 이 규칙이 **내놓는 값**이다. 열쇠로도 쓰면
 *    `휴즈 (휴즈)` 가 된다(2.2% 는 그래서 표에만 적어 둔 수다).
 *
 * ── 🔵 이 고침으로 이름이 붙는 줄은 **30.3% 보다 훨씬 적다** ─────────────
 * 재고 관리 319줄 중 **고객사 품명이 적힌 줄이 27개뿐**이다. 도번으로 부품을 찾아내도
 * 그 줄의 고객사 품명이 비어 있으면 위 ㉡ 로 떨어져 **품번 그대로** 보인다. 🔴 그러니
 * 「겹친다는데 왜 이름이 안 붙나」는 **결함이 아니다** — 재고 관리에서 고객사 품명을
 * 채우는 것만으로 저절로 붙는다(이 설계를 고른 까닭 그대로다).
 *
 * ── 🔴 **칸이 다르면 엇갈림이 아니다 — 차례가 이긴다** (2026-10-29) ───────
 * 엇갈림(㉣)은 **한 칸 안에서만** 센다. 도번에서 찾은 이름과 품명에서 찾은 이름이 서로
 * 달라도 **차례가 앞인 도번 쪽을 보인다.** 칸이 둘이던 2026-10-28 에도 그랬고(교산 품번이
 * 품명을 이긴다), 넷이 된 지금도 같다.
 * 🔴 까닭 둘:
 *   · 칸을 늘리는 고침이 **찾던 것을 잃게 하면 안 된다.** 칸끼리도 엇갈림으로 세면
 *     3.0% 짜리 비상구 한 칸을 더한 탓에 30.3% 로 찾아낸 이름이 지워진다 — 넓히려던
 *     고침이 거꾸로 좁힌다.
 *   · 두 경우는 **뜻이 다르다.** 한 칸 안의 엇갈림은 「어느 줄이 이 부품인지 **모른다**」라
 *     가릴 근거가 없고, 칸끼리의 엇갈림은 「어느 칸을 믿을지 **이미 정했다**」(위 실측 차례).
 * 🔵 칸이 넷이 되어 **우연히 맞은 줄이 남의 이름을 다는 일**은 늘어난다. 그 값을 치르고
 *    도번을 넣기로 한 것이고, 뜻이 맞는 칸을 앞에 두는 차례가 그 위험을 줄인다.
 *
 * ── 🔴 맞추는 자는 **이미 있는 것을 빌린다** ───────────────────────────
 * `partFieldValue`(🔴 `-` 만 적힌 칸은 없는 칸) + `normalizeKey`(NFKC · 공백 **전부**
 * 제거 · 소문자) + `kyosanUsedPartKey`(장음·붙임표 제거). 겹침 점검 도구가
 * `merge` 라고 부르는 바로 그 세 겹이다(`scripts/lib/part-name-overlap.ts` 의
 * `squeezeName`). 🔴 **그 함수를 import 하지 않고 같은 셋을 다시 엮는 까닭**은 저쪽이
 * `scripts/` 라 앱이 물면 안 되기 때문이고, 바닥 함수 셋은 **같은 것**이라 자는 한 벌이다.
 *
 * 🔵 가장 너그러운 `merge` 를 고른 까닭이 둘이다 —
 *   · **A/S 가 사용 부품 줄을 「같은 부품」으로 묶을 때 쓰는 열쇠가 그것**이다
 *     (`report-preview.ts` 의 `mergeKyosanPartsForUsedParts`). 보여 줄 때만 더 깐깐한
 *     자를 대면, 이미 한 줄로 묶인 부품이 재고 관리와는 안 묶이는 일이 생긴다.
 *   · 점검 도구가 적어 둔 그대로 **품번을 맞댈 때는 겹치는 쪽으로 넉넉하게** 기운다
 *     (`ABC-123` 과 `ABC123`).
 * 🔴 넉넉한 탓에 **서로 다른 부품이 한 열쇠**가 될 수 있는데, 그 위험은 위 ㉣ —
 *    「엇갈리면 품번으로 떨어뜨린다」가 막는다.
 *
 * ── 🔵 부를 자리가 둘이다 ───────────────────────────────────────────────
 *   · 수리 건 상세 → [사용부품] 칸 (`repair-cases/[id]/page.tsx` 가 서버에서 합친다)
 *   · 제품 모델 상세 → [A/S 이력] → [고장 부품] 그래프 (**다음 조각**)
 * 🔴 한 벌로 두는 까닭: 두 곳에 적으면 한쪽만 고쳐지는 날이 오고, 같은 부품이 화면마다
 *    다른 이름으로 보인다.
 *
 * ── 🔴 여기에 DB 도 망도 react 도 없다 ─────────────────────────────────
 * 받은 목록을 맞대어 글자를 만들 뿐이라 값으로 시험된다(`used-part-display.test.ts`).
 * 재고 관리에 실제로 묻는 일은 `server/inventory-gateway.ts` 의 `fetchInventoryParts`
 * 가 하고, 화면 한 장에 **한 번**만 묻는다(수리 건 상세는 [부품 요청] 칸이 이미
 * 받아 온 목록을 그대로 쓴다 — `[id]/page.tsx`).
 * ============================================================================
 */

/**
 * 품번을 맞대는 **열쇠**. 빈 글자는 「맞댈 수 없는 값」이다(🔴 `-` 만 적힌 칸).
 *
 * 🔴 이 값은 **견주는 데만** 쓴다 — 화면에 적히는 글자는 언제나 원형이다.
 */
export function usedPartMatchKey(text: string): string {
  const value = partFieldValue(text);
  if (value === "") return "";
  return normalizeKey(kyosanUsedPartKey(value));
}

/**
 * 품번 열쇠 → **고객사 품명**. 🔴 지도에 **없는 열쇠**와 **빈 이름**은 같은 뜻이다
 * (둘 다 「못 얻었다」 = 품번을 보인다) — 그래서 빈 이름은 아예 담지 않는다.
 *
 * 지도가 **칸마다 하나씩 넷**인 까닭: 칸에 **차례**가 있다(머리말 — 도번이 먼저다).
 * 한 지도에 섞어 담으면 늦게 담긴 칸이 이른 칸을 덮거나 **엇갈림으로 지워 버린다** —
 * 🔴 그러면 머리말이 못 박은 「칸이 다르면 엇갈림이 아니다」가 통째로 뒤집힌다.
 * 지도를 갈라 두는 것이 그 규칙을 **구조로** 지키는 방법이다.
 */
export type UsedPartNameIndex = {
  readonly byDrawingNo: ReadonlyMap<string, string>;
  readonly byKyosanPartNo: ReadonlyMap<string, string>;
  /** 재고 관리의 `name2`(「품명2」). 🔵 줄의 칸 이름은 `partSpec` 이다. */
  readonly byPartSpec: ReadonlyMap<string, string>;
  readonly byPartName: ReadonlyMap<string, string>;
};

/** 🔴 **못 물어봤을 때의 지도**(머리말 ㉢). 비어 있으므로 모든 줄이 품번으로 떨어진다. */
const EMPTY_INDEX: UsedPartNameIndex = {
  byDrawingNo: new Map(),
  byKyosanPartNo: new Map(),
  byPartSpec: new Map(),
  byPartName: new Map(),
};

/**
 * 한 칸을 열쇠로 삼아 **고객사 품명**을 모은다.
 *
 * 🔴 **엇갈리면 담지 않는다**(머리말 ㉣). 같은 열쇠에 서로 다른 이름이 걸리면 어느
 *    것이 이 건의 부품인지 **알 수 없고**, 둘 중 하나를 고르면 절반은 **남의 이름**을
 *    보여 준다. 재고 관리에는 같은 품명인 부품이 16묶음 있고(저쪽 API.md 2절) 위
 *    열쇠가 붙임표까지 지우므로, 이것은 가정이 아니라 일어나는 일이다.
 * 🔴 **그 엇갈림은 이 함수가 받은 한 칸 안에서만 센다.** 부르는 쪽이 칸마다 따로
 *    부르므로, 다른 칸에서 찾은 이름은 애초에 여기 들어오지 않는다 — 칸끼리 다른 것은
 *    엇갈림이 아니라 **차례로 가린다**(머리말 「칸이 다르면 엇갈림이 아니다」).
 * 🔵 **같은 이름이 여러 줄에 걸리는 것은 엇갈림이 아니다** — 소유가 다른 같은 부품이
 *    여러 번호로 서 있는 흔한 모양이고, 보여 줄 글자는 어느 줄에서 와도 같다.
 * 🔵 고객사 품명이 **빈 줄은 담지 않는다** — 담아 봐야 「못 얻었다」와 같은 값이고,
 *    담으면 그 줄이 이름 있는 줄과 엇갈린 것으로 세어져 **있는 이름까지 지운다.**
 */
function indexCustomerNames(
  rows: readonly PartPickerRow[],
  keyFieldOf: (row: PartPickerRow) => string | null | undefined
): ReadonlyMap<string, string> {
  const found = new Map<string, string>();
  const conflicted = new Set<string>();
  for (const row of rows) {
    const key = usedPartMatchKey(keyFieldOf(row) ?? "");
    if (key === "") continue;
    const customerName = partFieldValue(row.customerPartName);
    if (customerName === "") continue;
    if (conflicted.has(key)) continue;
    const already = found.get(key);
    if (already === undefined) {
      found.set(key, customerName);
      continue;
    }
    if (already === customerName) continue;
    found.delete(key);
    conflicted.add(key);
  }
  return found;
}

/**
 * 받아 온 부품 목록 → 맞대기 지도.
 *
 * 🔴 **못 받아 온 것은 빈 지도**다(머리말 ㉢). 여기가 「모른다」를 「없다」로 눕히는
 *    자리인데, 그래도 되는 까닭을 머리말에 적어 두었다 — 🔴 이 함수를 **다른 화면에서
 *    빌려 쓰기 전에 그 문단을 읽어라.** 「재고에 무엇이 있나」를 묻는 자리에서는
 *    이 눕힘이 곧 거짓말이 된다.
 */
export function buildUsedPartNameIndex(
  result: InventoryResult<readonly PartPickerRow[]>
): UsedPartNameIndex {
  if (result.status !== "ok") return EMPTY_INDEX;
  // 🔵 **여기 적힌 차례는 뜻이 없다** — 지도가 갈려 있어 서로 덮지 않는다. 어느 칸이
  //    이기는지는 아래 `usedPartCustomerName` 의 찾는 차례 한 곳이 정한다.
  return {
    byDrawingNo: indexCustomerNames(result.value, (row) => row.drawingNo),
    byKyosanPartNo: indexCustomerNames(result.value, (row) => row.kyosanPartNo),
    byPartSpec: indexCustomerNames(result.value, (row) => row.partSpec),
    byPartName: indexCustomerNames(result.value, (row) => row.partName),
  };
}

/**
 * 그 품번의 **고객사 품명**. 못 얻었으면 빈 글자다(머리말의 네 길 전부).
 *
 * 🔴 **어느 칸이 이기는지를 정하는 자리는 이 줄 하나다**(머리말의 실측 차례 — 도번 →
 *    교산 품번 → 품명2 → 품명). 앞 칸에서 걸리면 뒤 지도는 **보지도 않는다.**
 * 🔴 앞 칸에서 찾은 이름과 뒤 칸에서 찾은 이름이 **달라도 앞 칸이 이긴다** — 칸끼리는
 *    엇갈림으로 세지 않는다(머리말). 뜻이 맞는 칸이 앞이어야, 뒤 칸에 우연히 같은
 *    글자가 있는 부품이 진짜 짝을 밀어내지 않는다.
 * 🔵 앞 칸이 **엇갈려서**(㉣) 비면 뒤 칸으로 내려간다. 그 칸이 「모른다」고 할 뿐이고,
 *    뒤 칸이 들고 있는 근거까지 함께 틀린 것은 아니다.
 */
export function usedPartCustomerName(partNameText: string, index: UsedPartNameIndex): string {
  const key = usedPartMatchKey(partNameText);
  if (key === "") return "";
  return (
    index.byDrawingNo.get(key) ??
    index.byKyosanPartNo.get(key) ??
    index.byPartSpec.get(key) ??
    index.byPartName.get(key) ??
    ""
  );
}

/**
 * 화면에 보이는 글자 — 🔴 **합치는 규칙은 여기 한 줄뿐이다.**
 *
 * 🔴 괄호 안은 **저장된 글자 그대로**다(다듬지도 눌러 적지도 않는다). 사람이 재고
 *    관리나 연락서에서 그 글자로 다시 찾을 수 있어야 하고, 「이름이 이상하다」는
 *    신고가 왔을 때 되짚을 단서도 그 글자다.
 */
export function usedPartDisplayName(partNameText: string, index: UsedPartNameIndex): string {
  const customerName = usedPartCustomerName(partNameText, index);
  return customerName === "" ? partNameText : `${customerName} (${partNameText})`;
}

/**
 * [사용부품] 칸이 쓰는 모양 — 줄 id → 보일 글자.
 *
 * 🔵 서버가 미리 만들어 내려보낸다. 줄마다 글자를 만드는 일은 가벼운데, 그러려고
 *    연락서 판독기를 브라우저 묶음으로 보낼 까닭이 없다 — 위 두 모듈
 *    (`kyosan/card-grid` · `kyosan/report-preview`)을 **런타임으로 무는 화면 쪽 파일이
 *    지금 하나도 없고**(2026-10-28 실측. `components/` 에서 `kyosan/` 을 런타임으로 무는
 *    것은 `KyosanText.tsx` → `report-terms` 하나뿐이다), `card-grid` 는 그 아래로
 *    엑셀 격자 판독기(`xlsx/sheet-grid` → zip 읽개까지)를 통째로 달고 있다.
 * 🔴 **id 로 적는다**(차례가 아니라). 배열로 나란히 두면 화면이 줄을 다시 정렬하거나
 *    거르는 날 글자가 **한 칸씩 밀려** 남의 이름이 붙는데, 오류가 나지 않는다.
 */
export function usedPartDisplayNamesById(
  rows: readonly { id: string; partNameText: string }[],
  index: UsedPartNameIndex
): Record<string, string> {
  const names: Record<string, string> = {};
  for (const row of rows) names[row.id] = usedPartDisplayName(row.partNameText, index);
  return names;
}
