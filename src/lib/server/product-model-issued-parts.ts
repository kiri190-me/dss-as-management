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
 *   ① **건수가 아니라 시간으로 끊는다**(2026-10-29 사용자 결정 — 아래 예산 상수).
 *      몇 건이든 다 묻되, 정해 둔 전체 시간이 지나면 **거기까지만 세고 멈춘다.**
 *   ② **한 건이 실패해도 그 건만 빠진다** — 나머지는 그대로 센다. 한 건의 시간 초과로
 *      그래프가 통째로 비면 안 된다.
 *   ③ **못 센 건 수를 세어 화면까지 나른다.** 이것이 제일 중요하다 — 조용히 적은 수를
 *      보여 주면 「이 모델은 이 부품이 적게 고장난다」는 **틀린 결론**이 나온다.
 *      🔴 **두 가지를 갈라서** 나른다: 「시간이 모자라 못 물어봤다」와 「물어봤는데 못
 *      받아 왔다」는 **고칠 자리가 다르다**(앞은 저쪽이 느린 것, 뒤는 저쪽이 답을 못 준
 *      것이다). 섞으면 신고를 받아도 어디를 볼지 모른다.
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
 * 🔴 **반출 부품을 묻는 데 쓸 수 있는 전체 시간.** 이 시간이 지나면 남은 건을 **더 묻지
 *    않고 거기까지만 센다**(그리고 못 센 수를 화면이 적는다).
 *
 * ── 🔴 2026-10-29: **건수 상한을 이 예산으로 갈아 끼웠다**(사용자 결정) ──
 * 전에는 `ISSUED_PART_LOOKUP_CASE_LIMIT = 40` 이 있어 수리 건이 40을 넘는 모델은 반출
 * 부품을 **한 건도** 안 셌다. 그 40은 **운영에서 모델별 수리 건 수를 재 보지 못한 채
 * 짐작으로** 잡은 수였고, 2026-10-29 운영에서 **69건짜리 모델**이 그 안내를 띄웠다.
 * 사용자 말: 「상한 없이 불러올 수 있도록 해줘.」 그래서 **건수는 더 이상 보지 않는다.**
 * 🔵 건수로 끊는 자와 시간으로 끊는 자의 차이: 건수는 **실제로 느린지와 상관없이** 막지만
 *    (저쪽이 멀쩡한 날에도 69건을 통째로 버렸다), 시간은 **느린 날에만** 걸린다. 애초에
 *    지키려던 것은 건수가 아니라 「화면이 몇 분 동안 안 뜨는 일」이었다.
 *
 * ── 🔴 왜 5초인가 — 조건 둘을 **동시에** 만족하는 값이다 ────────────────
 * ① **보통 때는 절대 안 걸린다.** 재고 관리는 한 건에 0.2초쯤에 답하고 아래 동시 호출
 *    수가 12 이므로, 보통 때 5초면 `(5000/200) × 12 = 300건`까지 다 묻는다 — 운영에서
 *    본 가장 큰 모델(69건)의 네 배가 넘는다. 🔵 69건이면 6바퀴라 **1.2초**면 끝난다.
 * ② **저쪽이 죽어도 페이지가 이 시간 안에 뜬다.** 아래는 **못 박은 벽시계**다 — 예산이
 *    끝나면 이미 날아간 호출이 돌아오기를 기다리지 않고 **바로** 돌아간다. 이 조회는
 *    page.tsx 의 `Promise.all` 안에서 도는데 거기엔 이미 5초짜리 통로가 있어
 *    (`fetchInventoryParts` — `inventory-gateway.ts` 의 `READ_TIMEOUT_MS`), 이 조각 때문에
 *    페이지가 **더 늦어지는 일이 없다.** 🔴 갈아 끼우기 전 최악은 `ceil(40/8) × 5초 = 25초`
 *    였다(건수 상한은 그 25초를 막아 주지 못했다 — 막은 것은 41건째부터였다).
 * 🔴 **한 호출의 시간 제한(5초)과 숫자가 같지만 다른 수다.** 저쪽 제한을 1초로 줄여도 이
 *    값은 5초다 — 이것은 호출 하나가 아니라 **이 화면이 반출을 묻는 데 쓸 전체 시간**이다.
 */
export const ISSUED_PART_LOOKUP_BUDGET_MS = 5000;

/**
 * 한 번에 열어 두는 호출 수. 🔴 **재고 관리에 순간 부하를 몰지 않으려는 자**다.
 *
 * 🔵 이 저장소에 「동시 호출을 제한하는」 이미 있는 꼴이 없어서(2026-10-29 실측) 가장
 *    단순한 모양으로 적었다 — 일꾼 몇을 세워 두고 **다음 번호를 하나씩 집어 가게** 한다.
 *    라이브러리를 들이지 않는다.
 *
 * ── 🔴 2026-10-29: 8 → 12 로 올렸다 ─────────────────────────────────────
 * 건수 상한이 없어지면서 **바퀴 수가 곧 걸리는 시간**이 되었다. 69건이면 8로는 9바퀴
 * (보통 1.8초), 12면 6바퀴(보통 1.2초)다. 🔴 **더 올리지 않은 까닭**: 저쪽은 한 앱이고
 * 같은 순간에 사람도 쓰고 있다. 모델 상세 한 장을 여는 사람 **하나**가 저쪽에 동시 요청
 * 열둘을 던지는 것이 이미 작지 않고, 두 사람이 같은 순간에 열면 스물넷이다. 🔵 16·20으로
 * 올려 봐야 69건에서 줄어드는 바퀴는 하나뿐이라(6→5) 얻는 것이 0.2초다.
 * 🔴 **위 예산과 짝으로 읽어야 한다** — 보통 때 다 묻는 건수는 `(예산 / 0.2초) × 이 수`다.
 * 🔴 **순차(1)로 두지 않은 까닭**: 69건이면 보통 때만도 14초라 예산 안에 절반도 못 묻는다.
 */
export const ISSUED_PART_LOOKUP_CONCURRENCY = 12;

/** 모은 결과 — 줄과, **못 센 것이 얼마인지**. 뒤엣것이 화면까지 간다. */
export type IssuedPartLookupResult = FaultPartIssuedLookup & {
  rows: IssuedPartRow[];
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
 *
 * 🔵 `options.budgetMs` 는 **시험이 열어 둔 문**이다 — 예산 가지를 밟아 보려고 진짜 5초를
 *    기다릴 수는 없다. 운영 코드(page.tsx)는 넘기지 않고 위 상수를 그대로 쓴다.
 */
export async function fetchIssuedFaultPartRows(
  cases: readonly { id: string; intakeNumber: string }[],
  options?: { budgetMs?: number }
): Promise<IssuedPartLookupResult> {
  const budgetMs = options?.budgetMs ?? ISSUED_PART_LOOKUP_BUDGET_MS;
  const targets = cases.filter((row) => row.intakeNumber.trim() !== "");
  // 🔴 한 건도 못 셌을 때가 아니라 **셀 것이 없을 때**다(물어볼 건이 0 이면 할 말도 없다).
  if (targets.length === 0) {
    return { rows: [], uncountedCaseCount: 0, timedOutCaseCount: 0, timeBudgetMs: budgetMs };
  }

  /** 🔴 건 차례의 칸. 받은 차례가 아니라 이 칸에 담아야 배열이 결정적이다(머리말). */
  const perCase: IssuedPartRow[][] = targets.map(() => []);
  let uncountedCaseCount = 0;
  /**
   * 🔴 **답이 끝난 건 수**(받아 온 것 · 못 받아 온 것 **둘 다**). 못 물어본 건 수를 따로
   * 세지 않고 `전체 - 이 수`로 구한다 — 따로 세면 「아직 날아가 있는 호출」을 어느 쪽에
   * 넣을지가 자리마다 갈려서, 셋을 더해도 전체가 안 되는 날이 온다.
   */
  let settledCaseCount = 0;
  let next = 0;
  /**
   * 🔴 예산이 끝났다는 깃발. 일꾼은 이것을 보고 **새 건을 집지 않는다.** 이미 날아간
   * 호출은 여기서 끊지 못하지만(통로에 `AbortSignal` 을 넘기는 길이 없다) 저쪽 시간
   * 제한이 5초에 끊어 준다 — 그 호출들은 **아무도 안 읽는 답**이 되어 버려진다.
   */
  let outOfTime = false;

  async function worker(): Promise<void> {
    for (;;) {
      if (outOfTime) return;
      const index = next;
      next += 1;
      if (index >= targets.length) return;
      const target = targets[index];
      try {
        const result = await fetchInventoryStockRequestsByIntake(target.intakeNumber);
        if (result.status !== "ok") {
          // 🔴 **「없다」로 눕히지 않는다** — 못 받아 온 건은 세어서 화면이 말하게 한다.
          uncountedCaseCount += 1;
        } else {
          perCase[index] = issuedPartRowsOf(target.id, result.value);
        }
      } catch (e) {
        /**
         * 🔴 **여기서 던지면 일꾼 하나가 통째로 죽는다.** 통로 쪽이 이미 모든 실패를
         * 결과값으로 바꾸지만(`callInventory` 의 try/catch), 그 울타리가 언젠가 새면 이
         * 일꾼이 집어 둔 건이 **아무 셈에도 안 들어간 채** 사라지고 동시 호출 수도 하나
         * 줄어든다. 한 건의 사고가 그래프를 흔드는 것은 이 조각이 막으려던 바로 그 일이라,
         * 같은 울타리를 한 겹 더 친다.
         */
        console.error("[inventory] 반출 기록을 읽는 중 예외:", e instanceof Error ? e.message : e);
        uncountedCaseCount += 1;
      }
      settledCaseCount += 1;
    }
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  const budgetOver = new Promise<void>((resolve) => {
    timer = setTimeout(() => {
      outOfTime = true;
      resolve();
    }, budgetMs);
  });

  /**
   * 🔴 **거절을 여기서 먹어 둔다.** 아래 `race` 에서 예산이 먼저 이기면 이 약속은 우리가
   * 돌아간 **뒤에** 끝난다 — 그때 거절이 올라오면 받아 줄 사람이 없어 **처리되지 않은
   * 거절**이 되고, Node 는 그것으로 프로세스를 내릴 수 있다. 일꾼이 이미 전부 try/catch
   * 라 올 일이 없지만, 「올 일이 없다」에 기대는 자리가 아니다.
   */
  const everyone = Promise.all(
    Array.from({ length: Math.min(ISSUED_PART_LOOKUP_CONCURRENCY, targets.length) }, () => worker())
  ).then(
    () => undefined,
    (e: unknown) => {
      console.error("[inventory] 반출 기록 모으기가 멈췄습니다:", e instanceof Error ? e.message : e);
    }
  );

  /**
   * 🔴 **예산이 이기면 기다리지 않고 바로 돌아간다.** 날아가 있는 호출이 끝나기를 기다리면
   * 벽시계가 `예산 + 5초`가 되어, 「저쪽이 죽어도 페이지가 5초 안에 뜬다」는 약속이 깨진다.
   * 🔵 그 호출들이 뒤늦게 `perCase` 에 값을 써도 해롭지 않다 — 아래에서 **이미 이어 붙인**
   *    배열을 돌려주므로 우리가 돌려준 값은 바뀌지 않는다(셈도 바로 아래에서 굳힌다).
   */
  await Promise.race([everyone, budgetOver]);
  clearTimeout(timer);

  return {
    rows: perCase.flat(),
    uncountedCaseCount,
    // 🔴 **못 물어본 건** = 아직 안 집은 건 + 답을 기다리다 예산이 끝난 건. 둘 다 「그 건에
    //    반출이 없다」고 말할 근거가 없기는 마찬가지다.
    timedOutCaseCount: targets.length - settledCaseCount,
    timeBudgetMs: budgetMs,
  };
}
