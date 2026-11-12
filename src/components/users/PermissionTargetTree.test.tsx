import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";

import PermissionTargetTree from "./PermissionTargetTree";
import { PERMISSION_AREAS } from "@/lib/auth/permission-areas";
import { featuresOfArea, hasFeatures } from "@/lib/auth/permission-features";

/**
 * ============================================================================
 * 역할별 접근 권한 화면의 왼쪽 목록 — **그려지는 것**을 본다
 * ============================================================================
 * 묶음과 차례의 규칙은 lib/auth/permission-area-groups.test.ts 가 값으로 본다.
 * 여기서 못 박는 것은 그 규칙이 **마크업까지 왔는가**다. 둘을 가른 까닭은
 * 2026-11-12 의 이 판에서 가장 큰 위험이 「규칙은 맞는데 한 줄이 안 그려졌다」
 * 이기 때문이다 — 그때 오류는 나지 않고, 그 영역의 저장된 값을 되돌릴 길만
 * 조용히 사라진다.
 *
 * 정적 렌더로 충분한 까닭: 이 조각은 상태를 들고 있지 않다. 고름·펼침은 부모가
 * 들고 prop 으로 내려오므로, 그 값을 바꿔 가며 그린 마크업이 곧 계약의 전부다.
 * ============================================================================
 */

/** 펼침 상태를 받아 그린 마크업. 역할 수 배지는 자리만 채운다. */
function render(expandedKeys: Set<string>, selectedKey = "dashboard"): string {
  return renderToStaticMarkup(
    <PermissionTargetTree
      selectedKey={selectedKey}
      onSelect={() => {}}
      expandedKeys={expandedKeys}
      onToggleExpanded={() => {}}
      openRoleCount={() => 3}
    />
  );
}

/** 모든 영역을 펼친 상태 — 잎까지 한 번에 세려고. */
function allExpanded(): Set<string> {
  return new Set(PERMISSION_AREAS.filter((area) => hasFeatures(area.key)).map((area) => area.key));
}

function count(html: string, needle: string): number {
  return html.split(needle).length - 1;
}

test("🔴 영역 21개가 한 줄도 빠짐없이 그려진다", () => {
  const html = render(allExpanded());

  // 🔵 먼저 「무엇을 재는가」를 못 박는다 — 영역이 0개면 아래 비교가 공짜로 통과한다.
  assert.equal(PERMISSION_AREAS.length, 21);
  assert.equal(
    count(html, "data-permission-area=\""),
    PERMISSION_AREAS.length,
    "그려진 영역 줄 수가 권한 영역 수와 다르다"
  );
  for (const area of PERMISSION_AREAS) {
    assert.ok(
      html.includes(`data-permission-area="${area.key}"`),
      `${area.key}(${area.label}) 줄이 화면에서 사라졌다`
    );
    assert.ok(html.includes(area.label), `${area.key} 의 이름표가 안 보인다`);
  }
});

test("🔴 하위 기능(잎)도 한 줄도 빠짐없이 그려진다", () => {
  const html = render(allExpanded());
  const leafKeys = PERMISSION_AREAS.flatMap((area) =>
    featuresOfArea(area.key).map((feature) => feature.key)
  );

  // 🔵 표본 못 — 잎이 실제로 여럿 있어야 아래 비교에 뜻이 있다.
  assert.ok(leafKeys.length > 20, `잎이 ${leafKeys.length}개뿐이다`);
  assert.equal(count(html, "data-permission-leaf=\""), leafKeys.length);
  for (const key of leafKeys) {
    assert.ok(html.includes(`data-permission-leaf="${key}"`), `${key} 잎이 사라졌다`);
  }
});

test("🔴 접힘(▾)이 그대로 듣는다 — 접으면 잎만 사라지고 영역은 21줄 그대로다", () => {
  const html = render(new Set<string>());
  assert.equal(count(html, "data-permission-leaf=\""), 0, "접었는데 잎이 그려진다");
  assert.equal(count(html, "data-permission-area=\""), PERMISSION_AREAS.length);
  // 접기/펼치기 단추의 말도 상태를 따라간다.
  assert.ok(html.includes("전체 A/S 현황 펼치기"));
  assert.ok(render(allExpanded()).includes("전체 A/S 현황 접기"));
});

test("🔴 묶음 머리말 다섯이 메뉴와 같은 글자로 보인다", () => {
  const html = render(allExpanded());
  for (const label of ["A/S 업무", "기술 / 자원", "PO / 내자", "관리", "설정"]) {
    assert.ok(html.includes(`>${label}</h3>`), `묶음 머리말 「${label}」 이 안 보인다`);
  }
  // 🔴 스크롤에 묻히지 않는다 — 머리말이 붙어 있지 않으면 묶음을 만든 뜻이
  //    스크롤 한 번에 사라진다. 바탕이 불투명이어야 아래 줄이 안 비친다.
  assert.ok(html.includes("sticky top-0"), "묶음 머리말이 스크롤에 함께 밀려난다");
  assert.ok(html.includes("bg-zinc-100"), "머리말 바탕이 비어 있어 글자가 겹친다");
});

test("🔴 주간보고는 대시보드의 **하위메뉴**로, 하위 기능과 눈으로 갈리게 그려진다", () => {
  const html = render(allExpanded());

  // 대시보드에 딸린 칸 안에 들어 있다.
  const start = html.indexOf('data-permission-submenu-of="dashboard"');
  assert.notEqual(start, -1, "주간보고가 대시보드의 하위메뉴 칸에 들어 있지 않다");
  assert.ok(
    html.slice(start, start + 600).includes('data-permission-area="weeklyReport"'),
    "그 칸 안에 주간보고가 없다"
  );

  // 🔴 하위 기능(같은 화면 안의 조작)과 **다른 모양**이다 — 하위메뉴 칸에만
  //    세로 선을 긋는다. 같은 모양으로 그리면 읽는 사람이 주간보고를
  //    「대시보드 화면 안의 기능」으로 읽는다.
  const submenuTag = html.slice(Math.max(0, start - 120), start + 200);
  assert.ok(submenuTag.includes("border-l"), "하위메뉴에 세로 선이 없다");
  assert.equal(
    count(html, "border-l"),
    count(html, "data-permission-submenu-of=\""),
    "세로 선이 하위메뉴 칸 말고 다른 데도 그어져 있다 — 두 들여쓰기가 섞여 읽힌다"
  );
});

test("🔴 메뉴에 없는 항목(재고 관리)이 따로 묶이고, 그 사실이 화면에 드러난다", () => {
  const html = render(allExpanded());

  assert.ok(html.includes(">메뉴에 없는 항목</h3>"), "묶음 머리말이 없다");
  assert.ok(html.includes("메뉴에 없음"), "줄 쪽 꼬리표가 없다");
  assert.ok(
    html.includes("사이드바 메뉴에 나오지 않는 항목입니다"),
    "무엇이 달라지는지 알려 주는 안내가 없다"
  );

  // 🔴 꼬리표가 **그 줄에** 붙어 있다. 묶음 머리말을 지나쳐 읽는 사람에게는
  //    이것이 유일한 신호다.
  const inventoryAt = html.indexOf('data-permission-area="inventory"');
  assert.notEqual(inventoryAt, -1, "재고 관리가 화면에서 사라졌다");
  assert.ok(html.slice(inventoryAt, inventoryAt + 400).includes("메뉴에 없음"));

  // 🔵 꼬리표가 아무 줄에나 붙지 않는다 — 그러면 아무 뜻도 없는 글자가 된다.
  assert.equal(count(html, "메뉴에 없음"), 1);

  // 맨 아래다 — 메뉴에 있는 줄들보다 뒤에 온다.
  assert.ok(inventoryAt > html.indexOf('data-permission-area="settings"'));
});

test("🔴 개발자 모드는 이 화면에 줄을 만들지 않는다 — 일부러 없는 것이다", () => {
  const html = render(allExpanded());
  assert.equal(html.includes("개발자 모드"), false);
  assert.equal(html.includes('data-permission-area="developerMode"'), false);
});

test("고른 줄은 잎에서도 영역에서도 그대로 표시된다 — 고름이 묶음 때문에 어긋나지 않는다", () => {
  const leaf = render(allExpanded(), "repairCases.workRecords");
  assert.ok(leaf.includes('data-permission-leaf="repairCases.workRecords"'), "잎 단추가 없다");
  assert.equal(count(leaf, 'aria-current="true"'), 1, "고른 줄이 하나가 아니다");

  const area = render(allExpanded(), "inventory");
  assert.equal(count(area, 'aria-current="true"'), 1);
  const at = area.indexOf('data-permission-area="inventory"');
  assert.ok(area.slice(at, at + 200).includes('aria-current="true"'), "메뉴에 없는 줄은 고를 수 없다");
});
