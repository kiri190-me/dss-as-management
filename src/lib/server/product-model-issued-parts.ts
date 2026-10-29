import "server-only";
import { issuedPartRowsOf } from "@/lib/domain/product-model-fault-parts";
import type { FaultPartIssuedLookup, IssuedPartRow } from "@/lib/domain/product-model-breakdown";
import { fetchInventoryStockRequestsByIntake } from "./inventory-gateway";

/**
 * ============================================================================
 * [고장 부품] 그래프의 셋째 입력을 모은다 — **인수번호마다 한 번씩** (2026-10-29)
 * ============================================================================
 * 🔴 **지금 올리는 반출 요청이 그래프에 안 들어오고 있었다.** 2026-10-16 부터 요청이
 *    재고 관리로 올라가 A/S 옛 표(`inventory_part_requests`)에는 한 줄도 안 쌓인다
 *    (운영 코드에 `insert` 하는 길이 없다). 그 구멍을 메우는 것이 이 모듈이다.
 *
 * ── 🔴 왜 건마다 묻는가 — **모델 단위로 묻는 통로가 없다** ──────────────
 * 재고 관리가 내준 읽기 통로는 `GET /api/v1/stock-requests?intake=…` 하나이고
 * **인수번호 하나씩**이다(저쪽 API.md 4-7절, 이쪽 `fetchInventoryStockRequestsByIntake`).
 * 묶어서 묻는 통로를 새로 내는 일은 **두 시스템의 배포 순서가 생기는 일**이라 이 조각
 * 밖으로 두었다. 🔵 묻는 데 필요한 인수번호는 **이미 화면이 들고 있다** —
 * `listRepairCasesByProductModelId` 가 건마다 `intakeNumber` 를 준다(새 DB 조회가 없다).
 *
 * ── 🔴 안전장치 셋 ──────────────────────────────────────────────────────
 *   ① **건수 상한을 넘으면 아예 안 부른다**(아래 상수).
 *   ② **한 건이 실패해도 그 건만 빠진다** — 나머지는 그대로 센다. 한 건의 시간 초과로
 *      그래프가 통째로 비면 안 된다.
 *   ③ **못 센 건 수를 세어 화면까지 나른다.** 이것이 제일 중요하다 — 조용히 적은 수를
 *      보여 주면 「이 모델은 이 부품이 적게 고장난다」는 **틀린 결론**이 나온다.
 *      (「못 받아 왔다」와 「없다」를 가르는 규칙 — `domain/inventory-gateway.ts` 머리말.)
 *
 * ── 🔴 돌려주는 줄의 차례는 **건 차례**로 못 박는다 ─────────────────────
 * 아래는 여러 건을 **동시에** 부르므로 먼저 끝난 건이 먼저 돌아온다. 그대로 이어 붙이면
 * 같은 입력에 매번 다른 배열이 나온다 — 조각의 차례는 건수와 이름이 정하지만(`pie-slices`),
 * **같은 화면을 두 번 열어 다른 배열이 나오는 일**은 디버깅을 못 하게 만든다. 그래서
 * 받은 차례가 아니라 **건 차례의 칸에 담아** 두고 마지막에 이어 붙인다.
 * ============================================================================
 */

/**
 * 🔴 **이 수를 넘는 모델은 반출 부품을 아예 안 센다**(그리고 화면이 그 사실을 적는다).
 *
 * ── 왜 상한이 있어야 하는가 ─────────────────────────────────────────────
 * 호출 하나에 **5초** 시간 제한이 걸려 있다(`inventory-gateway.ts` 의 `READ_TIMEOUT_MS`).
 * 상한이 없으면 수리 건이 200건인 모델에서 저쪽이 느린 날 이 화면이 **몇 분** 동안 안
 * 뜬다. 조금 적게 보여 주는 것보다 안 뜨는 것이 훨씬 나쁘다.
 *
 * ── 🔴 왜 하필 40 인가 — **최악이 몇 초인지로 정했다** ──────────────────
 * 아래 동시 호출 수가 8 이므로 한 모델에 길어야 `ceil(40/8) = 5` 바퀴다:
 *   · 보통(저쪽이 0.2초에 답함) — 5 × 0.2초 ≈ **1초**
 *   · 최악(전부 시간 초과)      — 5 × 5초  = **25초**
 * 🔵 **운영에서 한 모델에 수리 건이 몇 개인지 모르는 채로 잡은 수다**(개발 DB 에는 과거
 *    건이 없어 재 볼 수도 없다). 그래서 **보수적으로** 잡았다 — 넘치면 화면이 「세지
 *    않았습니다」라고 **눈에 보이게** 말하므로, 쓰는 분이 그것을 보고 올려 달라고 하면
 *    이 상수 하나만 고치면 된다. 🔴 올릴 때는 **위 두 줄의 곱을 다시 계산해 보라** —
 *    상한만 올리면 최악이 그대로 길어진다.
 */
export const ISSUED_PART_LOOKUP_CASE_LIMIT = 40;

/**
 * 한 번에 열어 두는 호출 수. 🔴 **재고 관리에 순간 부하를 몰지 않으려는 자**다.
 *
 * 🔵 이 저장소에 「동시 호출을 제한하는」 이미 있는 꼴이 없어서(2026-10-29 실측) 가장
 *    단순한 모양으로 적었다 — 일꾼 몇을 세워 두고 **다음 번호를 하나씩 집어 가게** 한다.
 *    라이브러리를 들이지 않는다.
 * 🔴 **순차(1)로 두지 않은 까닭**: 상한 40건이면 최악 200초가 되어 상한이 지켜 주는
 *    것이 없어진다. 반대로 40을 한꺼번에 쏟지 않는 까닭은 저쪽이 한 앱이고 같은 순간에
 *    사람도 쓰고 있기 때문이다. 8 은 그 사이에서 고른 수이고, 위 상수와 **짝으로** 읽어야
 *    한다(최악 시간은 둘의 비로 정해진다).
 */
export const ISSUED_PART_LOOKUP_CONCURRENCY = 8;

/** 모은 결과 — 줄과, **못 센 것이 얼마인지**. 뒤엣것이 화면까지 간다. */
export type IssuedPartLookupResult = FaultPartIssuedLookup & {
  rows: IssuedPartRow[];
};

/** 🔴 한 건도 못 셌을 때가 아니라 **셀 것이 없을 때**의 답(건이 0 이면 경고도 없다). */
const NOTHING_TO_ASK: IssuedPartLookupResult = {
  rows: [],
  uncountedCaseCount: 0,
  skippedCaseCount: 0,
  caseLimit: ISSUED_PART_LOOKUP_CASE_LIMIT,
};

/**
 * 이 모델의 수리 건들에 **반출 확인된 부품** 줄을 모은다.
 *
 * 🔴 **인수번호로 묻고 건 id 를 붙여 돌려준다** — 응답에는 `repairCaseId` 가 없다. 그
 *    짝은 **묻는 쪽**이 이미 알고 있고(그 번호로 물었으니까), 저쪽이 알 길이 없다.
 * 🔵 인수번호가 빈 건은 **묻지 않고 그냥 뺀다**(못 센 건으로도 세지 않는다) — 물어볼
 *    열쇠가 없는 것이지 재고 관리가 못 답한 것이 아니다. 🔴 번호 **모양이 틀린** 건은
 *    다르다: 그때는 통로가 「못 받아 왔다」를 돌려주고, 그대로 **못 센 건으로 센다**
 *    (그런 건에 반출이 없다고 말할 근거가 없다 — `fetchInventoryStockRequestsByIntake`).
 */
export async function fetchIssuedFaultPartRows(
  cases: readonly { id: string; intakeNumber: string }[]
): Promise<IssuedPartLookupResult> {
  const targets = cases.filter((row) => row.intakeNumber.trim() !== "");
  if (targets.length === 0) return NOTHING_TO_ASK;

  if (targets.length > ISSUED_PART_LOOKUP_CASE_LIMIT) {
    // 🔴 **한 건도 안 부른다.** 절반만 세어 보여 주는 것은 틀린 수를 맞는 수처럼
    //    보이게 하는 일이고, 어느 절반인지도 사람이 알 수 없다.
    return {
      rows: [],
      uncountedCaseCount: 0,
      skippedCaseCount: targets.length,
      caseLimit: ISSUED_PART_LOOKUP_CASE_LIMIT,
    };
  }

  /** 🔴 건 차례의 칸. 받은 차례가 아니라 이 칸에 담아야 배열이 결정적이다(머리말). */
  const perCase: IssuedPartRow[][] = targets.map(() => []);
  let uncountedCaseCount = 0;
  let next = 0;

  async function worker(): Promise<void> {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= targets.length) return;
      const target = targets[index];
      try {
        const result = await fetchInventoryStockRequestsByIntake(target.intakeNumber);
        if (result.status !== "ok") {
          // 🔴 **「없다」로 눕히지 않는다** — 못 받아 온 건은 세어서 화면이 말하게 한다.
          uncountedCaseCount += 1;
          continue;
        }
        perCase[index] = issuedPartRowsOf(target.id, result.value);
      } catch (e) {
        /**
         * 🔴 **여기서 던지면 그래프가 통째로 빈다.** 통로 쪽이 이미 모든 실패를 결과값으로
         * 바꾸지만(`callInventory` 의 try/catch), 그 울타리가 언젠가 새면 `Promise.all` 이
         * 거절되어 **페이지 전체가 500** 이 된다. 한 건의 사고가 화면 한 장을 내리는 것은
         * 이 조각이 막으려던 바로 그 일이라, 같은 울타리를 한 겹 더 친다.
         */
        console.error("[inventory] 반출 기록을 읽는 중 예외:", e instanceof Error ? e.message : e);
        uncountedCaseCount += 1;
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(ISSUED_PART_LOOKUP_CONCURRENCY, targets.length) }, () => worker())
  );

  return {
    rows: perCase.flat(),
    uncountedCaseCount,
    skippedCaseCount: 0,
    caseLimit: ISSUED_PART_LOOKUP_CASE_LIMIT,
  };
}
