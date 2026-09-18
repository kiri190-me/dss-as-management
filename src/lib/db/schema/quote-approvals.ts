import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { quotes } from "./quotes";
import { shipmentApprovalRoutes } from "./shipment-approval-routes";
import { users } from "./users";

/**
 * ============================================================================
 * 견적서 결재 — 「누가 언제 승인했나」를 남기는 표
 * ============================================================================
 * repair_case_approvals 와 **같은 결**로 짠다(append-only · 결정은 딱 한 번 ·
 * 소프트삭제 없음 · 요청 시점 version 스냅샷). 그 표를 그대로 쓸 수 없는 것은
 * FK 가 repair_cases 이기 때문이고, 그것 말고는 다를 이유가 없다.
 *
 * ── 🔴 이 표는 문을 잠그지 않는다 ───────────────────────────────────────
 * **결재가 끝나기 전에도 견적서를 발행할 수 있다**(2026-09-18 사용자 결정).
 * 최종 출하 승인·부품 불출은 절차가 켜져 있으면 그 문이 닫히지만, 견적서는 그렇지
 * 않다. 여기 쌓이는 것은 **기록**이다 — 「그 장을 누가 언제 승인했나」.
 *
 * 다음 사람에게: 이 표를 보고 발행을 막는 코드를 쓰지 말 것. 그것은 빠뜨린 것이
 * 아니라 **정해진 것**이다. 막아야 할 필요가 생기면 사용자에게 먼저 묻는다.
 *
 * ── 🔴 승인 뒤에 견적서가 바뀌면 그 승인은 무효다 ────────────────────────
 * `quote_version_at_request` 가 그 장치다. 요청한 순간의 `quotes.version` 을 여기
 * 박아 두고, 읽는 쪽이 그 장의 지금 version 과 견준다 — 다르면 그 APPROVED 는
 * 「지금 이 내용에 대한 승인」이 아니다. 이 칸이 없으면 승인을 받은 뒤 금액을
 * 고쳐도 승인이 그대로 살아 있다. repair_case_approvals.
 * repair_case_version_at_request 가 접수 건에 대해 하는 것과 같은 자리이고,
 * 견주는 일은 **읽는 쪽**의 몫이다(다음 조각).
 *
 * ── 🔴 quotes 표에는 칸을 더하지 않는다 ─────────────────────────────────
 * 「이 견적서가 결재 중인가」는 **여기서 읽는다.** quotes 에 상태 칸을 두면 같은
 * 사실이 두 곳에 적히고(그 표의 version·is_deleted 와 달리 이쪽은 파생값이다)
 * 언젠가 갈라진다. 게다가 이 저장소는 `select()` 전체 조회가 새 칸을 곧바로
 * 싣기 때문에, 칸을 더하면 마이그레이션을 적용하기 전까지 개발 서버가 깨진다.
 *
 * ── 딸린 것 ────────────────────────────────────────────────────────────
 * 고객 개인정보를 담지 않는다 — 사람 id 와, 내부 사용자가 그 견적서에 대해 적은
 * 사유 글뿐이다.
 * ============================================================================
 */

/**
 * 결재 한 건의 상태. **셋뿐이다.**
 *
 * 🔴 `CHANGES_REQUESTED` 와 `CANCELLED` 를 일부러 넣지 않는다 —
 * repair_case_approvals 가 같은 판단을 이미 내렸고(그 파일의 approvalStatusEnum
 * 주석), 그 판단을 여기서 뒤집을 이유가 없다. **반려된 건은 새 줄로 다시
 * 요청하면 되므로** 「고쳐서 다시 올려라」라는 필요는 REJECTED 하나가 덮는다.
 * 상태를 늘리면 「어느 상태가 살아 있는 요청인가」를 보는 곳이 전부 늘어나고,
 * enum 값은 나중에 뺄 수 없다.
 *
 * 🔴 값 목록은 repair_case_approval_status 와 **글자 그대로 같아야 한다** —
 * schema/quote-approvals-safety.test.ts 가 둘을 맞대어 본다. 두 결재가 다른
 * 상태 집합을 쓰기 시작하면 화면·알림이 결재 종류마다 다른 규칙을 갖게 된다.
 */
export const quoteApprovalStatusEnum = pgEnum("quote_approval_status", [
  "REQUESTED",
  "APPROVED",
  "REJECTED",
]);

/**
 * 요청 한 건이 한 줄이다. **줄을 고쳐 쓰지 않는다**(append 계열) — 결재(승인·반려)는
 * 그 줄의 결정 칸을 **딱 한 번** 채우고, 그 뒤로는 역사적 사실이라 고치지도 지우지도
 * 않는다. 그래서 소프트삭제 네 칸(is_deleted·deleted_at·deleted_by·delete_reason)을
 * 두지 않는다(status_change_histories · repair_case_approvals 와 같은 규약).
 *
 * 다단계 결재선은 **줄을 이어 만드는 것**으로 푼다 — 1단계가 승인되면 그 줄은
 * APPROVED 로 닫히고, 같은 판의 다음 단계 요청 줄이 하나 새로 생긴다.
 * repair_case_approvals 가 최종 출하 승인에서 쓰는 그 구조 그대로다.
 *
 * 승인 종류 칸(repair_case_approvals.approval_type 같은 것)은 두지 않는다 —
 * 견적서에 붙는 결재는 한 가지뿐이라 가를 것이 없다.
 */
export const quoteApprovals = pgTable(
  "quote_approvals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /**
     * 🔴 **nullable · ON DELETE SET NULL 이다.** 견적서는 휴지통에서 완전 삭제될
     * 수 있고(mutations/quote-trash.ts), 보관기간이 지나면 자동으로도 지워진다
     * (mutations/master-data-purge.ts). NOT NULL·RESTRICT 로 두면 그 두 길이
     * DB 에서 막힌다.
     *
     * 이 표는 그 장보다 오래 남는 결재 이력이다 — 연결이 풀려도 줄 자신의
     * 상태·결정 칸이 「누가 언제 무엇을 결정했나」를 그대로 지킨다.
     * repair_case_approvals.repair_case_id 가 같은 이유로 같은 모양이다.
     */
    quoteId: uuid("quote_id").references(() => quotes.id, { onDelete: "set null" }),
    status: quoteApprovalStatusEnum("status").notNull().default("REQUESTED"),
    requestedByUserId: uuid("requested_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
    /** 요청하며 적은 말. 안 적어도 된다. */
    requestReason: text("request_reason"),
    /**
     * 「이 요청을 누가 처리할지」. 🔴 **NULL 이 정상값이고 뜻이 있다: 「지정 없음」**
     * — repair_case_approvals.assigned_approver_user_id 와 같은 규약이다.
     * 결재선을 타는 요청이면 그 단계의 승인자가 여기 적히고, 그 사람만 처리할 수
     * 있다(+ 최고관리자는 언제나 — 자리를 비워 영영 막히는 것을 막는다).
     *
     * ON DELETE RESTRICT — 다른 사람 참조 칸들과 같다. 지정된 사람이 지워지면서
     * 이 이력이 조용히 뭉개지지 않게 한다.
     */
    assignedApproverUserId: uuid("assigned_approver_user_id").references(() => users.id, {
      onDelete: "restrict",
    }),
    /**
     * 「이 요청이 결재선(판)의 몇 번째 단계인가」 — 아래 route_step_order 와 한 쌍이다.
     *
     * 🔴 **판을 그때 그 판으로 붙잡아 두는 칸이다.** 관리자가 절차를 바꾸면 새 판이
     * 얹히지만(shipment_approval_routes 는 append-only), 이미 요청된 건은 여기 적힌
     * 옛 판을 끝까지 따라간다. 다음 단계는 (route_id, route_step_order + 1) 로 찾는다.
     *
     * 🔴 **NULL 이 정상값이다: 「결재선을 타지 않는 요청」** — 그 용도의 판이 아직
     * 없거나 단계 0개인 판일 때다(빈 판은 「절차를 쓰지 않겠다」는 정상적인 뜻이다).
     *
     * 이 표가 보는 판은 scope = 'QUOTE' 인 판이다. 그 좁힘은 DB 로 표현할 수 없어
     * (다른 표의 칸이다) 저장 경로가 자기 트랜잭션 안에서 지킨다 —
     * repair_case_approvals 가 route_only_for_final_shipment CHECK 로 하던 일을
     * 여기서는 CHECK 로 옮길 자리가 없다(이 표에는 승인 종류 칸이 없다).
     */
    routeId: uuid("route_id").references(() => shipmentApprovalRoutes.id, {
      onDelete: "restrict",
    }),
    /** 그 판 안에서 몇 번째 단계인가(1부터). route_id 와 함께 있거나 함께 없다. */
    routeStepOrder: integer("route_step_order"),
    decidedByUserId: uuid("decided_by_user_id").references(() => users.id, {
      onDelete: "restrict",
    }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decisionReason: text("decision_reason"),
    /**
     * 🔴 **요청한 순간의 `quotes.version`.** 이것이 「승인 뒤 내용이 바뀌면 그 승인은
     * 무효」를 만드는 장치다 — 이 파일 머리말 참조. 요청할 때 반드시 정해지므로
     * NOT NULL 이고, 기본값은 두지 않는다(기본값이 있으면 version 을 싣지 않은
     * 요청이 조용히 「1판에 대한 승인」이 된다).
     */
    quoteVersionAtRequest: integer("quote_version_at_request").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // 한 견적서에 **살아 있는(아직 REQUESTED 인) 요청은 하나**뿐이다. 저장 경로의
    // 트랜잭션 안 재확인이 앞단이고, 이 부분 유니크가 DB 쪽 최종 방어선이다 —
    // 없으면 두 사람이 같은 순간에 요청을 올렸을 때 결재선이 둘로 갈라진다.
    // (repair_case_approvals_one_active_request 와 같은 모양. 그쪽은 승인 종류까지
    // 묶지만 이 표에는 종류가 하나뿐이라 견적서만으로 충분하다.)
    uniqueIndex("quote_approvals_one_active_request")
      .on(table.quoteId)
      .where(sql`status = 'REQUESTED'`),
    index("quote_approvals_quote_id_idx").on(table.quoteId),
    index("quote_approvals_requested_by_user_id_idx").on(table.requestedByUserId),
    // 알림 종·배지가 「내게 지정된 결재」를 찾는 길.
    index("quote_approvals_assigned_approver_user_id_idx").on(table.assignedApproverUserId),
    // 결정은 딱 한 번, 그리고 상태와 결정 칸이 언제나 아귀가 맞는다.
    // 반려에만 사유를 강제하는 것은 의도다 — 승인은 말이 없어도 뜻이 분명하지만,
    // 반려는 무엇을 고쳐야 하는지 적히지 않으면 받은 사람이 할 수 있는 일이 없다.
    check(
      "quote_approvals_decision_metadata",
      sql`
        (status = 'REQUESTED' AND decided_by_user_id IS NULL AND decided_at IS NULL AND decision_reason IS NULL)
        OR
        (status = 'APPROVED' AND decided_by_user_id IS NOT NULL AND decided_at IS NOT NULL)
        OR
        (status = 'REJECTED' AND decided_by_user_id IS NOT NULL AND decided_at IS NOT NULL AND decision_reason IS NOT NULL)
      `
    ),
    // 결재선 두 칸은 한 쌍이다. 하나만 채워진 줄은 「어느 판인지는 아는데 몇 번째인지
    // 모른다」(또는 그 반대)라서 다음 단계를 이을 수도, 지난 단계를 설명할 수도 없다.
    check(
      "quote_approvals_route_columns_together",
      sql`(route_id IS NULL AND route_step_order IS NULL) OR (route_id IS NOT NULL AND route_step_order IS NOT NULL)`
    ),
    // 순서 번호는 1부터다 — shipment_approval_route_steps 의 같은 CHECK 와 짝이고,
    // domain/shipment-approval-route.ts 의 stepOrderFromIndex 가 그 규칙이 적힌 곳이다.
    check(
      "quote_approvals_route_step_order_positive",
      sql`route_step_order IS NULL OR route_step_order >= 1`
    ),
    // 요청 시점의 판 번호는 1부터다(quotes.version 의 기본값이 1).
    check("quote_approvals_quote_version_positive", sql`quote_version_at_request >= 1`),
  ]
);
