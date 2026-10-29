import { partRowDisplayName, usedPartDisplayName, type UsedPartNameIndex } from "./used-part-display";
import type { InventoryStockRequest } from "./inventory-gateway";
import type {
  FaultPartRow,
  IssuedPartRow,
  RequestedPartRow,
  UsedPartRow,
} from "./product-model-breakdown";

/**
 * ============================================================================
 * [고장 부품] 그래프의 줄을 **서버에서** 만든다 — 세 입력을 한 글자로 (2026-10-29)
 * ============================================================================
 * 사용자 요청: 「[고장 부품] 그래프를 만들 때, **리페어 리포트에서 읽어들인 것들과
 * [a/s시스템]에서 부품요청 한 부품들을 포함해서** 보여주도록 해줘.」 그리고 「그래프
 * 쪽도 같은 표기로 해줘」(= 「고객사 품명 (품번)」). 같은 날 셋째로 **반출 확인된
 * 부품**이 들어왔다 — 🔴 **지금 올리는 반출 요청이 그래프에 안 들어오고 있었다.**
 * 2026-10-16 부터 요청이 재고 관리로 올라가 A/S 옛 표(`inventory_part_requests`)에는
 * 한 줄도 안 쌓이기 때문이고, 그 구멍을 메우는 것이 셋째 입력이다.
 *
 * ── 🔴 **더하는 일이지 갈아 끼우는 일이 아니다** ────────────────────────
 * 부품 요청 쪽 조회도, 취소·반려를 빼는 규칙도 그대로다. 사용 부품 줄과 반출 줄이
 * **옆에 붙는다.**
 *
 * ── 🔴 왜 서버인가 ──────────────────────────────────────────────────────
 * 글자를 만드는 규칙(`./used-part-display.ts`)이 연락서 판독기(`lib/kyosan/card-grid` →
 * 엑셀 격자 → zip 읽개)를 물고 있고, 그래프 컴포넌트는 `"use client"` 다. 화면에서
 * 합치면 그 판독기가 통째로 브라우저 묶음에 실린다 — 수리 건 상세가 같은 까닭으로 같은
 * 자리에서 합친다(`repair-cases/[id]/page.tsx`).
 * 🔵 그래서 그래프 쪽(`./product-model-breakdown.ts`)은 **이미 글자가 된 줄**만 받는다.
 *
 * ── 🔴 어떻게 같은 부품을 한 조각으로 묶는가 — **완성된 글자**로 ──────────
 * 세 입력의 글자 체계가 다르다:
 *   · 부품 요청 → A/S 부품 표(`parts`)의 칸들(품명 · 품명2 · 교산 품번 · 도번)
 *   · 사용 부품 → 연락서에서 읽어 저장한 **품번 글자 하나**
 *   · 반출 확인 → 재고 관리 신청 줄의 칸들(`name` · `name2` · `kyosanPartNo` · `drawingNo`)
 * 그래서 **셋 다 「고객사 품명 (품번)」으로 만든 뒤 그 글자로 묶는다.** 같은 부품이면
 * 같은 글자가 나온다 — 이름은 둘 다 재고 관리에서 같은 지도로 찾고(도번 → 교산 품번 →
 * 품명2 → 품명), 괄호 안은 둘 다 **그 줄을 가리키는 한 글자**다(`partIdentityText`).
 * 🔴 **합성 규칙은 한 벌뿐이다** — 요청 쪽은 `partRowDisplayName`, 사용 쪽은
 *    `usedPartDisplayName` 을 부르는데, 앞의 것이 뒤의 것을 부른다. 두 벌로 적으면
 *    한쪽만 고쳐지는 날이 오고, 그날부터 같은 부품이 조각 둘로 갈린다.
 *
 * 🔵 **이름을 못 얻으면 품번 그대로**다(`used-part-display.ts` 머리말의 네 길). 그것도
 *    열쇠가 된다 — 두 입력이 같은 품번을 들고 있으면 이름 없이도 한 조각이다.
 * 🔴 **재고 관리가 멈춰도 그래프는 선다.** 지도가 통째로 비어 모든 줄이 품번으로 떨어질
 *    뿐이다(`buildUsedPartNameIndex` 가 `unreachable` 을 빈 지도로 눕힌다). 여기서
 *    「불러오지 못했습니다」를 그리지 않는 까닭은 저 파일 머리말과 같다 — 이 그래프가 하는
 *    말은 「이 모델에서 이 부품이 나왔다」뿐이라 재고 관리의 형편과 상관없이 참이다.
 *
 * ── 🔴 겹치면 **다 센다** ───────────────────────────────────────────────
 * 같은 건에서 같은 부품이 **두 입력에 다 있으면 2 로 센다.** 지우지 않는다. 까닭 둘:
 *   ① 줄들은 **각각 일어난 일**이다 — 요청해서 받아 간 것, 연락서에 적힌 것, 창고에서
 *      실제로 나간 것은 서로를 증명하지 않는다. 한 줄을 버리면 어느 쪽을 버렸는지 아무도
 *      모르게 된다.
 *   ② 이 그래프의 셈법이 처음부터 「**줄 하나가 한 개**」다(요청 쪽도 같은 부품이 두 요청에
 *      걸리면 2 로 센다). 출처가 다르다고 그 셈법을 뒤집으면 한 그래프에 자가 둘이 된다.
 *
 * 🔴 **셋째 입력이 들어오면서 겹침이 실제로 생긴다**(2026-10-29). 2026-10-29 전에 적어
 *    두었던 「지금 실질적으로 겹치지 않는다」는 **요청 줄과 사용 줄 사이**의 이야기였고,
 *    그 근거는 화면이 한 건의 부품 출처를 둘로 쪼개지 않는다는 것이었다 — 반출 이력이
 *    있는 건에는 사용 부품을 적을 자리를 아예 그리지 않는다
 *    (`db/queries/repair-case-used-parts.ts` 머리말. 운영 실측 2026-10-29 로 백필 대상
 *    463건 중 「부품 요청 있음」 **0건**).
 *    🔴 **그 울타리가 반출 입력에는 안 걸린다.** 그 판정이 보는 표가 A/S 옛 표
 *    (`inventory_part_requests`)인데, 2026-10-16 뒤의 요청은 그 표에 한 줄도 안 쌓인다 —
 *    그래서 **요즘 건은 사용 부품 칸이 열려 있고 재고 관리에는 반출 기록이 있다.** 같은
 *    부품이 두 입력에 다 잡히는 일이 앞으로 흔해진다.
 * 🔵 그래도 지우지 않는 까닭은 위 ①② 그대로다. 🔴 **알고 감수하는 자리**라 글로 적고
 *    시험으로 못 박아 둔다 — 조용히 한쪽을 지우는 코드가 들어오면 그 시험이 깨진다.
 *    (언젠가 「한 건 안에서 같은 부품은 한 번만」으로 바꾸기로 정하면, 그 결정은 세
 *    입력 전부에 같이 걸려야 한다. 반출 쪽만 지우면 한 원에 자가 셋이 된다.)
 * ============================================================================
 */

/**
 * ============================================================================
 * 🔴 한 수리 건의 반출 신청 → **실제로 나간 줄만** (2026-10-29 사용자 결정)
 * ============================================================================
 * 재고 관리의 신청 상태는 여덟이다(`domain/inventory-gateway.ts` 의
 * `STOCK_REQUEST_STATUS_CODES`). 🔴 **그 상태로 거르지 않는다.** 줄의 불출 수량
 * (`issued`)이 **1 이상인 줄만** 센다.
 *
 * 🔵 까닭: 「반출 확인된」은 **물건이 실제로 나갔다**는 뜻이다. 상태가 `PARTIAL`(일부
 *    나감)인 **한 신청 안에서도 나간 줄과 안 나간 줄이 섞여 있어**, 신청 단위로 가리면
 *    둘 중 한쪽을 반드시 틀린다. 줄 단위로 보면 정확히 갈린다.
 * 🔵 `REJECTED`·`CANCELLED` 는 **자동으로 빠진다**(나간 것이 없다). 그 둘을 따로 적어
 *    빼지 않는 까닭이다 — 목록을 두 벌로 두면 저쪽이 상태를 더하는 날 어긋난다.
 * 🔴 **수량은 쓰지 않는다.** `issued` 는 **거르는 자**일 뿐이고, 5개가 나간 줄도 1개가
 *    나간 줄도 그래프에서는 **한 개**다(`product-model-breakdown.ts` 의 세 줄 타입이
 *    전부 같은 셈법이다).
 * 🔴 **`repairCaseId` 가 응답에 없다.** 저쪽은 인수번호만 돌려주고, 그 인수번호로 물은
 *    쪽이 이미 짝을 안다 — 그래서 부르는 쪽이 건 id 를 넘겨 붙인다.
 * ============================================================================
 */
export function issuedPartRowsOf(
  repairCaseId: string,
  requests: readonly InventoryStockRequest[]
): IssuedPartRow[] {
  const rows: IssuedPartRow[] = [];
  for (const request of requests) {
    for (const line of request.lines) {
      if (!(line.issued >= 1)) continue;
      rows.push({
        repairCaseId,
        // 🔴 칸 이름만 옮긴다 — 어느 칸이 품번인지는 `partIdentityText` 한 곳이 정한다.
        drawingNo: line.drawingNo,
        kyosanPartNo: line.kyosanPartNo,
        partSpec: line.name2,
        partName: line.name,
      });
    }
  }
  return rows;
}

/**
 * 세 입력 → 그래프가 셀 줄. **요청 줄이 먼저, 사용 줄이 가운데, 반출 줄이 뒤**다.
 *
 * 🔵 차례에는 뜻이 없다 — 조각의 차례는 건수와 이름이 정한다(`pie-slices.ts`). 그래도
 *    같은 입력에 같은 배열이 나오도록 못 박아 둔다.
 * 🔵 지도(`index`)는 **한 번만** 만들어 넘긴다. 줄마다 재고 관리를 다시 부르는 일은
 *    없다 — 부르는 자리는 화면 한 장에 한 번이다(`product-models/[id]/page.tsx`).
 * 🔴 **셋 다 받는 것이 필수다**(`issued?:` 로 두지 않았다). 입력이 늘어난 날 부르는 쪽이
 *    한 칸을 빠뜨리면 그 입력은 **오류 없이 조용히 사라진다** — 셋째가 생긴 까닭 자체가
 *    「들어오는 줄 알았는데 한 줄도 안 들어오고 있었다」라, 같은 사고를 타입으로 막는다.
 */
export function toFaultPartRows(
  input: {
    requested: readonly RequestedPartRow[];
    used: readonly UsedPartRow[];
    issued: readonly IssuedPartRow[];
  },
  index: UsedPartNameIndex
): FaultPartRow[] {
  const rows: FaultPartRow[] = [];
  for (const row of input.requested) {
    rows.push({
      repairCaseId: row.repairCaseId,
      // 🔴 네 칸을 그대로 넘긴다 — 어느 칸이 품번인지는 저쪽 한 곳이 정한다.
      displayName: partRowDisplayName(row, index),
    });
  }
  for (const row of input.used) {
    rows.push({
      repairCaseId: row.repairCaseId,
      // 🔴 저장된 글자는 **품번**이다(그 칸 이름이 partNameText 일 뿐이다).
      displayName: usedPartDisplayName(row.partNameText, index),
    });
  }
  for (const row of input.issued) {
    rows.push({
      repairCaseId: row.repairCaseId,
      // 🔴 요청 줄과 **같은 함수**다 — 칸 이름을 맞춰 둔 까닭이 이것이다. 같은 부품이면
      //    출처가 달라도 같은 글자가 나와 한 조각으로 모인다.
      displayName: partRowDisplayName(row, index),
    });
  }
  return rows;
}
