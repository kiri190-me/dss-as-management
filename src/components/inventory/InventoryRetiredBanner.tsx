/**
 * ============================================================================
 * 「여기가 아니라 저기」 안내 띠 — 재고 화면 **다섯이 함께 쓴다** (2026-10-16)
 * ============================================================================
 * 재고 기능이 재고 관리 시스템(dss-inventory)으로 옮겨 갔다. A/S 에 남은 재고 화면을
 * 걷어내는 일은 배포 뒤로 미뤘으므로, 그때까지 두 시스템이 함께 살아 있다.
 * 메뉴에서는 감췄지만(lib/navigation.ts 의 hiddenFromMenu) **북마크한 사람은 그대로
 * 들어와 입고·사용을 적는다** — 그러면 같은 일의 기록이 두 곳으로 갈린다. 이 조각이
 * 막으려는 것은 그것 하나다.
 *
 * ── 🔴 반드시 들어가는 말 ────────────────────────────────────────────────
 * 「여기에 적은 것은 재고 관리에 들어가지 않습니다」. 이 말이 없으면 사람은
 * 「옮겨 갔구나」까지만 읽고 **쓰던 대로 쓴다** — 옮겨 간 것과 안 넘어가는 것은 다른
 * 말이고, 행동을 바꾸는 쪽은 뒤엣것이다. 시험이 이 문장을 글자로 못 박는다.
 *
 * ── 🔴 한 곳에 둔 까닭 ───────────────────────────────────────────────────
 * 다섯 화면에 따로 적으면 문구가 갈린다. 색도 이 저장소에 이미 있는 주의 색
 * (amber, QuoteSavePdfNotice 와 같은 한 벌)을 그대로 쓴다.
 *
 * ── 🔴 이 조각은 아무것도 잠그지 않는다 ──────────────────────────────────
 * 단추도 칸도 그대로다. 운영에서 급한 일을 처리하던 사람을 막지 않는다 — 화면을
 * 걷어내는 일은 따로 한다.
 *
 * ── 주소는 **설정에서** 온다 ─────────────────────────────────────────────
 * 코드에 박지 않는다. 부르는 쪽(각 페이지)이 server/inventory-gateway.ts 의
 * `inventorySiteUrl()` 을 넘긴다. 🔴 설정이 없으면 `null` 이고, 그때는 **링크 없이
 * 글만** 선다 — 없는 주소로 보내면 사람은 「재고 관리가 고장났다」로 읽는다.
 * (이 파일이 환경변수를 직접 읽지 않는 까닭이기도 하다: 그 설정을 읽는 자리는
 * inventory-gateway.ts 한 곳이고, 여기는 그 값을 받아 그리기만 한다.)
 * ============================================================================
 */

export const INVENTORY_RETIRED_TITLE = "이 화면은 더 이상 쓰지 않습니다";

export const INVENTORY_RETIRED_WHERE_TEXT =
  "재고 일은 재고 관리 시스템에서 합니다 — 입고 · 사용 · 부품 요청 모두 그쪽에서 적습니다.";

/** 🔴 행동을 바꾸는 문장. 빼지 말 것(머리말). */
export const INVENTORY_RETIRED_NOT_SYNCED_TEXT =
  "여기에 적은 것은 재고 관리에 들어가지 않습니다 — 기록이 두 곳으로 갈립니다.";

export const INVENTORY_RETIRED_LINK_LABEL = "재고 관리 시스템 열기";

export default function InventoryRetiredBanner({ href }: { href: string | null }) {
  return (
    <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
      <p className="font-semibold">{INVENTORY_RETIRED_TITLE}</p>
      <p className="mt-1">{INVENTORY_RETIRED_WHERE_TEXT}</p>
      <p className="mt-1 font-semibold">{INVENTORY_RETIRED_NOT_SYNCED_TEXT}</p>
      {/*
        🔵 **새 탭으로 연다.** 여기까지 온 사람은 무언가 하던 중이라, 이 창을 저쪽으로
        갈아 끼우면 하던 화면을 잃는다. rel 은 이 저장소의 다른 바깥 링크와 같은 한 벌이다.
      */}
      {href !== null && (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 inline-block rounded-md border border-amber-400 px-2 py-1 text-xs dark:border-amber-700"
        >
          {INVENTORY_RETIRED_LINK_LABEL} ↗
        </a>
      )}
    </div>
  );
}
