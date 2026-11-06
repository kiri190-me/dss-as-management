import "server-only";

import { and, eq } from "drizzle-orm";
import { db } from "../client";
import { domesticOrders, quotes } from "../schema";
import {
  resolveQuoteDomesticOrderLine,
  type QuoteDomesticOrderLineSkipReason,
} from "@/lib/domain/quote-domestic-order-line";

/**
 * ============================================================================
 * 🔴 기타 견적서를 만들면 내자 정리에 줄이 하나 — **만드는 일** (2026-11-06)
 * ============================================================================
 * 무엇을 보고 무엇을 적을지는 여기 없다. 판정은 domain/quote-domestic-order-line.ts
 * 한 곳이고(「CABLE 만」 · 「휴지통은 안 센다」 · 「어느 칸에 무엇이」), 이 파일은
 * 재료를 **잠근 채** 읽어 넘기고 돌아온 값을 그대로 넣는다.
 *
 * ── 🔴 **같은 트랜잭션 안이다** ─────────────────────────────────────────
 * `tx` 를 받는 것이 그 못이다. 견적서 저장이 뒤에서 되돌아가면(번호 중복 23505 등)
 * 이 줄도 함께 없던 일이 되어야 한다 — 견적서는 사라졌는데 그 번호를 적은 내자
 * 줄만 남으면, 화면은 어디에도 없는 견적서를 가리키는 줄을 그린다.
 *
 * 🔵 **공유폴더 만들기(createQuoteArchiveFolder)의 결을 따라가지 않았다.** 그쪽은
 * 일부러 트랜잭션 **바깥**이고 실패해도 저장이 그대로다(server/actions/quotes.ts).
 * 까닭은 그것이 **디스크**이기 때문이다 — 파일시스템 작업은 롤백되지 않으니 안에
 * 둘 수가 없고, 창고가 꺼져 있다고 사람이 적은 견적서가 사라지면 안 된다. 이쪽은
 * **같은 DB 의 행**이라 되돌아갈 수 있고, 되돌아가야 한다.
 *
 * ── 🔴 잠그는 것은 **견적서 행**이다 ────────────────────────────────────
 * `domestic_orders.quote_id` 에는 유일 제약이 없다(domain 쪽 머리말 — 내자 정리
 * 수정 폼이 기존 줄을 견적서에 이어 붙일 수 있어, 운영에 같은 견적서를 가리키는
 * 줄이 둘 있으면 제약을 거는 마이그레이션이 그 자리에서 터진다). 그러니 DB 가
 * 둘째 줄을 막아 주지 않는다 — 막는 것은 아래 차례다:
 *
 *   ① 견적서 행을 `FOR UPDATE` 로 잠근다.
 *   ② **그다음에** 그 견적서를 가리키는 살아 있는 줄을 센다.
 *   ③ 없을 때만 넣는다.
 *
 * 🔴 **차례가 곧 보장이다.** 둘이 동시에 들어오면 뒤에 온 쪽이 ① 에서 멈춰 서고,
 * 앞선 쪽이 커밋한 뒤에야 ② 를 센다 — 그 셈은 새 문장이라 새 스냅숏을 쓰므로
 * (READ COMMITTED) 방금 커밋된 줄이 보인다. 먼저 세고 나중에 잠그면 둘 다 「없다」를
 * 보고 각자 넣어 줄이 둘이 된다. 수리 건 상세의 발행일 저장이 **수리 건**을 같은
 * 까닭으로 잠그는 것과 같은 자리다(mutations/domestic-order-issue-dates.ts 의
 * 「만들기와 고치기가 한 번의 저장 안에서 갈린다」). 거기서는 아직 없는 줄을 잠글
 * 수 없어 수리 건을 잡았고, 여기서는 **한 견적서에 줄 하나**가 지키려는 것이므로
 * 견적서를 잡는다.
 *
 * 🔵 `createQuote` 에서 부를 때 그 행은 **방금 이 트랜잭션이 넣은 행**이라 잠금이
 * 곧바로 잡힌다(제 행이다). 그래도 적어 두는 까닭: 이 함수는 혼자 서야 한다 —
 * 두 번 불려도 줄이 하나여야 하고, 그 보장이 부르는 자리마다 달라지면 안 된다.
 *
 * ── 인가를 보지 않는다 — **까닭을 적어 둔다** ───────────────────────────
 * 🔴 `domesticOrders` 권한을 **묻지 않는다.** 재어 본 결과와 판단은 이렇다:
 *
 *  · 기본 정책에서 두 집합이 **글자 그대로 같다.** `canEditQuotes` → `canViewQuotes`
 *    → `canViewDomesticOrders` 이고, `canEditDomesticOrders` → `canViewDomesticOrders`
 *    다 — 같은 함수 하나로 모인다(auth/quote-authorization.ts ·
 *    auth/domestic-order-authorization.ts). 즉 이 길로 **새로 열리는 권한이 하나도
 *    없다.** 2026-11-06 의 공급처→고객사 마스터 조각이 `customers` 를 안 본 것과
 *    같은 셈이다.
 *  · 묻는다면 답이 둘뿐인데 둘 다 더 나쁘다. 거절하면 **견적서 저장 자체가 실패**하고
 *    (견적서는 쓸 수 있는 사람인데 못 쓰게 된다), 건너뛰면 사람은 같은 단추를 눌러도
 *    어떤 날은 줄이 생기고 어떤 날은 안 생기는 화면을 보게 된다. 둘 다 사람에게
 *    설명할 수 없다.
 *  · 🔵 이웃 mutations/domestic-order-issue-dates.ts 는 **묻는다.** 거기와 다른 것은
 *    사람이 무엇을 하려고 왔는가다 — 그쪽은 「이 내자 줄의 날짜를 고쳐 달라」가
 *    요청 자체라 FORBIDDEN 이 그 요청에 대한 **정확한 답**이다. 이쪽의 요청은
 *    「견적서를 만들어 달라」이고, 줄은 그 요구에 딸려 오는 결과다. 같은 표를
 *    건드린다고 같은 관문을 붙이면 안 되는 자리다.
 *  · 결재 자동 반려(mutations/quote-approval-auto-reject.ts)가 결재 자격을 묻지 않는
 *    것과 같은 결이다 — 저장에 딸린 일은 **저장의 관문**을 쓴다. 그 관문은
 *    server/actions/quotes.ts 의 `hasPermission(actingUser, "quotes", "WRITE")` 다.
 * ============================================================================
 */

/** 트랜잭션 핸들. 🔴 이 함수는 **반드시** 부르는 쪽의 트랜잭션 안에서만 돈다. */
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type QuoteDomesticOrderLineOutcome =
  | { created: true; domesticOrderId: string }
  | { created: false; reason: QuoteDomesticOrderLineSkipReason };

/**
 * 이 견적서에 딸린 내자 줄을 **없으면 하나** 만든다.
 *
 * 🔴 **던지지 않는다 · 아무것도 거절하지 않는다.** 돌려주는 것은 「만들었다」 또는
 * 「안 만들었고 까닭은 이것이다」뿐이다 — 부르는 쪽(createQuote)은 이 값을 보고
 * 저장을 되돌리지 않는다. 되돌려야 할 일(DB 가 거절하는 값)은 애초에 여기까지
 * 오지 않는다: 넣는 값은 전부 그 견적서 행에서 나온 것이고, 가리키는 두 곳
 * (quotes · customers)은 그 행이 이미 지난 관문이다.
 */
export async function createDomesticOrderLineForQuote(
  tx: Tx,
  params: { quoteId: string; actorUserId: string }
): Promise<QuoteDomesticOrderLineOutcome> {
  // ── ① 견적서를 잠근 채 읽는다 — 둘째 줄을 막는 자리가 여기다(머리말) ──
  const [quote] = await tx
    .select({
      id: quotes.id,
      kind: quotes.kind,
      isDeleted: quotes.isDeleted,
      subject: quotes.subject,
      quoteNumber: quotes.quoteNumber,
      quoteDate: quotes.quoteDate,
      customerId: quotes.customerId,
    })
    .from(quotes)
    .where(eq(quotes.id, params.quoteId))
    .limit(1)
    .for("update");

  // ── ② 그다음에 센다. 🔴 **살아 있는 줄만** — 휴지통은 세지 않는다(domain 머리말) ──
  const [liveLine] = await tx
    .select({ id: domesticOrders.id })
    .from(domesticOrders)
    .where(and(eq(domesticOrders.quoteId, params.quoteId), eq(domesticOrders.isDeleted, false)))
    .limit(1);

  const plan = resolveQuoteDomesticOrderLine({
    quote: quote ?? null,
    hasLiveLine: Boolean(liveLine),
  });
  if (plan.kind === "SKIP") return { created: false, reason: plan.reason };

  // ── ③ 넣는다. 🔴 판정이 준 칸 + 기록용 둘뿐이다 ───────────────────────
  // 순번(display_order)을 여기서 짓지 않는다 — 사람이 매긴 표시 순서라 기계가
  // 끼어들 자리가 아니고, 기존 두 길도 짓지 않는다(domain 머리말의 마지막 항목).
  const [inserted] = await tx
    .insert(domesticOrders)
    .values({
      ...plan.values,
      createdBy: params.actorUserId,
      // 만든 사람이 곧 마지막으로 고친 사람이다 — 기존 두 길과 같다
      // (createDomesticOrder · saveRepairCaseDomesticOrderIssueDates).
      updatedBy: params.actorUserId,
    })
    .returning({ id: domesticOrders.id });

  return { created: true, domesticOrderId: inserted.id };
}
