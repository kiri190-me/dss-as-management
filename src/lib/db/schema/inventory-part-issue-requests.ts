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
import { partStockBalances } from "./inventory";
import { inventoryPartRequestItems, inventoryPartRequests } from "./inventory-part-requests";
import { procedureCaseExecutionNodes } from "./procedure-case-execution";
import { repairCases } from "./repair-cases";
import { shipmentApprovalRoutes } from "./shipment-approval-routes";
import { users } from "./users";

/**
 * ============================================================================
 * 부품 불출 승인 — 표 셋 (신청 · 신청 항목 · 단계별 승인)
 * ============================================================================
 * 재고 담당자가 [불출]·[사용]을 눌렀을 때 **그 자리에서 재고를 빼는 대신** 먼저
 * 결재를 받는 길이다. 결재선은 새로 만들지 않고 출하 승인이 쓰는 그 표를 그대로
 * 쓴다 — shipment_approval_routes 의 `scope = 'PART_ISSUE'` 판이다.
 *
 * ── 🔴 승인이 끝나도 재고는 자동으로 빠지지 않는다 ──────────────────────
 * 이 표들이 담는 것은 「빼도 된다」까지이고, **실제로 빼는 것은 재고 담당자가
 * 따로 누른다.** 그래서 상태에 `APPROVED` 와 `EXECUTED` 가 **따로** 있다 —
 * 「결재는 끝났는데 아직 안 나갔다」가 실재하는 상태다.
 *
 * 승인 트랜잭션 안에서 재고까지 빼지 않는 이유가 둘이다:
 *  1. 재고를 빼는 로직(수량 검사·잔량 갱신·이력·중복 방지)은 이미 검증돼 있다
 *     (mutations/inventory.ts 의 consumeStock, mutations/inventory-part-requests.ts
 *     의 issuePartRequest). 그것을 승인 트랜잭션 안으로 끌어들이면 두 위험이 한
 *     곳에서 만난다.
 *  2. 신청 시점과 마지막 승인 시점의 재고가 다르다. 승인이 곧 불출이면
 *     **마지막 결재자가 「재고 부족」으로 막힌다** — 결재자는 재고를 어찌할 수
 *     없는 사람이다.
 *
 * ── 🔴 안전장치: 「부품 불출」 판이 하나도 없으면 이 기능은 없는 것과 같다 ──
 * `shipment_approval_routes` 에 `scope = 'PART_ISSUE'` 판이 하나도 없거나 단계가
 * 0개인 판뿐이면, **재고 담당자는 지금까지처럼 그 자리에서 바로 불출한다.**
 * 이 표들에는 행이 한 줄도 생기지 않는다.
 *
 * 이 약속이 없으면 기능을 올리는 순간 **관리자가 절차를 만들기 전까지 재고가
 * 통째로 잠긴다** — 아무도 결재할 수 없는 신청만 쌓이고 부품은 나가지 못한다.
 * 판이 비어 있는 것이 정상 초기 상태라는 것은 결재선 표의 규약과 같다
 * (schema/shipment-approval-routes.ts 머리말).
 *
 * 🔴 **이 조각(2026-09-10)에서는 이 표들을 쓰는 코드가 아직 없다.** 표와 읽는
 * 길과 순수 규칙까지만 만들고, `issuePartRequest` · `consumeStock` 은 한 줄도
 * 건드리지 않았다 — 문을 다는 것은 다음 조각이고, 그 조각이 위의 안전장치를
 * 구현한다. 그때까지 이 표 셋은 0행으로 남는 것이 정상이다.
 *
 * ── 이름에 대하여 ───────────────────────────────────────────────────────
 * `inventory_part_issue_*` — 재고 영역의 `inventory_` 접두사에 결재선 용도 값
 * `PART_ISSUE` 를 그대로 붙였다. 이미 있는 `inventory_part_requests`(엔지니어가
 * 올리는 **부품 요청**)와 `inventory_part_request_issues`(실제로 나간 **불출
 * 사건**)와는 다른 것이다. 셋의 관계는 이렇다:
 *
 *   inventory_part_requests          엔지니어: "이 부품 주세요"
 *     └ inventory_part_issue_requests  재고 담당자: "빼도 될까요"   ← 이 파일
 *         └ inventory_part_request_issues  실제로 뺐다 (재고가 줄어든 순간)
 *
 * 가운데 칸만 이번에 생겼고, 위아래 둘은 손대지 않았다.
 * ============================================================================
 */

/**
 * 신청 한 건이 지나가는 상태.
 *
 * 🔴 `APPROVED` 와 `EXECUTED` 는 **다른 상태다.** 결재가 끝난 것과 부품이 나간
 * 것은 다른 사건이고, 그 사이의 시간이 이 설계의 핵심이다(파일 머리말 참조).
 * 둘을 하나로 뭉개면 「승인은 났는데 아직 안 나갔다」를 표현할 방법이 사라지고,
 * 재고 담당자는 무엇을 실행해야 하는지 목록으로 볼 수 없게 된다.
 *
 * 나아가는 길:
 *   PENDING_APPROVAL → APPROVED → EXECUTED
 *   PENDING_APPROVAL → REJECTED | CANCELLED
 *   APPROVED         → CANCELLED   (아직 안 나갔으므로 물릴 수 있다)
 *   EXECUTED         → (끝)        **이미 나간 것은 되돌릴 수 없다**
 *
 * 🔴 그 판정이 적힌 곳은 순수 규칙 하나뿐이다 —
 * domain/inventory-part-issue-rules.ts 의 canTransitionPartIssueRequestStatus.
 * 값 목록도 그 파일과 **글자 그대로 같아야 한다**(스키마 파일이 도메인 층을
 * 가져오지 않는 이 저장소의 관례다 — repair_case_approval_type ↔
 * REPAIR_CASE_APPROVAL_TYPES 와 같은 자리). 갈라지지 않도록 그 파일의 시험이
 * 둘을 맞춰 본다.
 */
export const inventoryPartIssueRequestStatusEnum = pgEnum("inventory_part_issue_request_status", [
  "PENDING_APPROVAL",
  "APPROVED",
  "EXECUTED",
  "REJECTED",
  "CANCELLED",
]);

/**
 * 단계별 승인 행의 상태. `repair_case_approvals` 의 세 값과 같은 뜻이다.
 *
 * 🔴 그 표의 enum(`repair_case_approval_status`)을 **빌려 쓰지 않는다.** 이름이
 * 접수 건 승인의 것이라 재고 표에 붙으면 읽는 사람이 잘못된 관계를 상상하게
 * 되고, 무엇보다 한쪽이 값을 하나 더할 때 다른 쪽이 조용히 함께 바뀐다. 이
 * 저장소는 영역마다 자기 enum 을 두는 쪽이다(inventory_part_request_status 가
 * 그렇다).
 */
export const inventoryPartIssueApprovalStatusEnum = pgEnum("inventory_part_issue_approval_status", [
  "REQUESTED",
  "APPROVED",
  "REJECTED",
]);

/**
 * 불출 신청 — 헤더. 「이 재고를 이만큼 빼겠다」 한 건.
 *
 * 두 길이 여기로 모인다:
 *  · **요청 기반 불출** — `part_request_id` 가 있다. 엔지니어가 올린 부품 요청에
 *    대해 재고 담당자가 빼 주는 길(지금의 issuePartRequest). 접수 건·사용처는
 *    그 요청이 이미 가리키고 있으므로 여기 다시 적지 않는다.
 *  · **직접 사용** — `part_request_id` 가 NULL 이다. 요청 없이 바로 빼는 길
 *    (지금의 consumeStock). 그래서 접수 건·사용처·절차 작업을 **여기가** 들고
 *    있어야 한다 — 실행할 때 consumeStock 에 그대로 넘길 값들이다.
 *
 * 🔴 두 길을 한 표에 담는 이유: 결재선도, 「내가 결재할 목록」도, 「승인은 났는데
 * 아직 안 나간 것」도 두 길에서 완전히 같다. 표를 둘로 나누면 그 셋이 전부 두 벌이
 * 된다.
 *
 * 소프트삭제 네 칸을 두지 않는다 — 신청을 무르는 길은 `CANCELLED` 상태이지 삭제가
 * 아니다. 결재 이력이 딸린 신청이 휴지통으로 사라지면 「누가 무엇을 승인했나」가
 * 끊긴다.
 */
export const inventoryPartIssueRequests = pgTable(
  "inventory_part_issue_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /**
     * 요청 기반 불출이면 그 부품 요청. **직접 사용이면 NULL 이고 그것이 정상값**
     * 이다.
     *
     * ON DELETE RESTRICT — `inventory_part_requests` 를 참조하는 다른 표들
     * (items · issues · history)과 같다. 부품 요청은 물리적으로 지우지 않으므로
     * 실제로 걸릴 일은 없고, 이력이 조용히 끊기지 않게 하는 방어선이다.
     */
    partRequestId: uuid("part_request_id").references(() => inventoryPartRequests.id, {
      onDelete: "restrict",
    }),
    /**
     * 직접 사용이 접수 건을 가리킬 때. 요청 기반이면 **언제나 NULL 이다** — 그때는
     * 부품 요청이 이미 접수 건을 가리키고 있고, 같은 사실을 두 곳에 적으면
     * 언젠가 갈라진다(아래 CHECK 가 그것을 막는다).
     *
     * ON DELETE SET NULL — 접수 건 영구 삭제에 대비한 이 영역의 관례다
     * (inventory_part_requests.repair_case_id · stock_transactions.repair_case_id
     * 와 같다). 재고 관련 기록은 접수 건의 하드 삭제보다 오래 살아남아야 한다.
     */
    repairCaseId: uuid("repair_case_id").references(() => repairCases.id, {
      onDelete: "set null",
    }),
    status: inventoryPartIssueRequestStatusEnum("status").notNull().default("PENDING_APPROVAL"),
    requestedByUserId: uuid("requested_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
    /** 왜 이만큼 빼야 하는가. 결재자가 읽을 글이다. */
    requestReason: text("request_reason"),
    /**
     * 직접 사용의 사용처(예: "상해수리소"). 접수 건에 매이지 않는 불출이 실제로
     * 있어서 consumeStock 이 이 값을 받는다 — 실행할 때 그대로 넘긴다.
     *
     * 🔴 **직접 사용에서 접수 건과 사용처 중 적어도 하나는 있어야 한다**(아래
     * CHECK). consumeStock 이 같은 것을 요구하고, stock_transactions 의
     * `use_has_destination` CHECK 이 최종 방어선이다. 여기서 미리 막지 않으면
     * 결재를 다 받고 나서 실행 순간에야 「사용처를 입력해 주세요」로 거절된다.
     */
    destinationNote: text("destination_note"),
    /**
     * 직접 사용이 절차 작업 화면에서 시작됐을 때 그 작업. 실행할 때 consumeStock
     * 에 그대로 넘겨 stock_transactions 에 남긴다 — 부품에서 접수 건·절차 작업으로
     * 거꾸로 짚어 가는 길이 이 칸 하나에 걸려 있다. 여기 담아 두지 않으면 승인을
     * 거쳐 나간 불출만 그 연결이 끊긴다.
     *
     * ON DELETE RESTRICT — stock_transactions.procedure_execution_node_id 와 같다.
     */
    procedureExecutionNodeId: uuid("procedure_execution_node_id").references(
      () => procedureCaseExecutionNodes.id,
      { onDelete: "restrict" }
    ),
    /**
     * 실행 기록 — **누가 실제로 뺐는가.** 실행은 다음다음 조각의 일이지만 칸은
     * 지금 만들어 둔다(나중에 칸을 더하는 마이그레이션을 한 번 덜 한다).
     *
     * 🔴 상태가 EXECUTED 인 것과 이 두 칸이 채워진 것은 **같은 말이어야 한다**
     * (아래 CHECK). 「실행됨인데 실행한 사람이 없다」도, 「실행 기록은 있는데
     * 상태는 승인됨」도 실재해서는 안 된다.
     */
    executedByUserId: uuid("executed_by_user_id").references(() => users.id, {
      onDelete: "restrict",
    }),
    executedAt: timestamp("executed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("inventory_part_issue_requests_part_request_id_idx").on(table.partRequestId),
    index("inventory_part_issue_requests_repair_case_id_idx").on(table.repairCaseId),
    index("inventory_part_issue_requests_requested_by_user_id_idx").on(table.requestedByUserId),
    // 「승인은 났는데 아직 안 나간 것」·「결재 대기」 목록이 상태로 훑는다.
    index("inventory_part_issue_requests_status_idx").on(table.status),
    // 실행 기록과 상태는 같은 말이다 — repair_case_approvals_decision_metadata 와
    // 같은 모양의 짝 검사다.
    check(
      "inventory_part_issue_requests_execution_metadata",
      sql`
        (status <> 'EXECUTED' AND executed_by_user_id IS NULL AND executed_at IS NULL)
        OR
        (status = 'EXECUTED' AND executed_by_user_id IS NOT NULL AND executed_at IS NOT NULL)
      `
    ),
    // 직접 사용의 칸들은 **직접 사용에만** 있다. 요청 기반 불출이 접수 건을
    // 여기 또 적으면 부품 요청 쪽 값과 갈라질 수 있고, 그때 어느 쪽이 참인지
    // 아무도 답할 수 없다. repair_case_approvals 의
    // `delegation_only_for_final_shipment` 와 같은 모양의 방어선이다.
    //
    // ⚠️ **이 이름은 표에 적힌 그대로 들어가지 않는다.** 64자라서 Postgres 가
    // 식별자 상한(63바이트)에 맞춰 마지막 한 글자를 잘라 낸다 — 실제 제약 이름은
    // `inventory_part_issue_requests_direct_use_columns_only_when_dire` 다
    // (마이그레이션 적용 때 NOTICE 로 알려 주고, 오류 메시지에도 잘린 이름이
    // 나온다). 자르기는 언제나 같은 결과라 개발·시험·운영이 어긋나지는 않지만,
    // **오류를 제약 이름으로 가려내는 코드는 잘린 쪽을 봐야 한다.** 이 저장소에는
    // 외래키 이름이 같은 이유로 잘린 자리가 이미 여럿 있다(0086 의
    // shipment_approval_route_steps 두 개가 그렇다).
    check(
      "inventory_part_issue_requests_direct_use_columns_only_when_direct",
      sql`part_request_id IS NULL OR (repair_case_id IS NULL AND destination_note IS NULL AND procedure_execution_node_id IS NULL)`
    ),
    // 직접 사용은 **어디로 나가는지** 말해야 한다 — consumeStock 과 같은 요구다.
    // 요청 기반 불출은 부품 요청이 이미 그것을 들고 있으므로 면제된다.
    check(
      "inventory_part_issue_requests_direct_use_has_destination",
      sql`part_request_id IS NOT NULL OR repair_case_id IS NOT NULL OR destination_note IS NOT NULL`
    ),
  ]
);

/**
 * 신청 항목 — 무엇을 얼마나.
 *
 * 🔴 **왜 항목을 저장하는가.** 승인은 「해도 된다」이고 실행은 나중이다. 무엇을
 * 승인했는지 못 박아 두지 않으면 **「승인받은 것과 다른 수량이 나갔다」**가 되고,
 * 그것을 나중에 밝혀낼 방법이 없다. 이 표가 그 증거다 — 실행 단계는 여기 적힌
 * 잔량 행과 수량으로만 재고를 뺄 수 있어야 한다.
 *
 * 신청이 사라지면 함께 사라진다(CASCADE) — 항목은 신청에 딸린 것이고 혼자서는
 * 아무 뜻도 없다. 실제로는 신청을 지우지 않으므로(무르는 길은 CANCELLED 상태다)
 * 고아 행을 만들지 않기 위한 방어선이지, 쓰라고 열어 둔 길이 아니다
 * (shipment_approval_route_steps 와 같은 자리다).
 */
export const inventoryPartIssueRequestItems = pgTable(
  "inventory_part_issue_request_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    issueRequestId: uuid("issue_request_id")
      .notNull()
      .references(() => inventoryPartIssueRequests.id, { onDelete: "cascade" }),
    /**
     * 요청 기반 불출일 때 어느 요청 줄에 대한 것인가. **직접 사용이면 NULL** 이다.
     *
     * 헤더의 `part_request_id` 와 짝이 맞아야 하지만 그 짝을 DB 로 강제하지 않는다
     * — 강제하려면 이 표가 헤더의 값을 복사해 들고 있어야 하고(합성 외래키),
     * 그 복사본이 갈라지는 쪽이 더 위험하다. 짝은 신청을 만드는 mutation 이
     * 자기 트랜잭션 안에서 맞춘다(다음 조각).
     */
    requestItemId: uuid("request_item_id").references(() => inventoryPartRequestItems.id, {
      onDelete: "restrict",
    }),
    /**
     * 어느 부품의 어느 잔량에서 빼는가. 부품이 아니라 **잔량 행**을 가리키는
     * 것이 중요하다 — 소유구분·보관 위치까지 정해져야 실제로 뺄 수 있고,
     * 승인받은 것과 다른 자리에서 빼는 일이 없어야 한다.
     */
    partStockBalanceId: uuid("part_stock_balance_id")
      .notNull()
      .references(() => partStockBalances.id, { onDelete: "restrict" }),
    quantity: integer("quantity").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("inventory_part_issue_request_items_quantity_positive", sql`quantity >= 1`),
    // 한 신청 안에서 같은 잔량 행이 두 줄로 나뉘지 않는다.
    //
    // 🔴 잔량 행 하나로 충분한 이유: 잔량 행은 부품 하나에 속하고, 한 부품 요청에
    // 같은 부품 줄은 하나뿐이다(inventory_part_request_items_request_part_unique).
    // 그래서 서로 다른 요청 줄이 같은 잔량 행을 가리키는 일은 생길 수 없고,
    // (신청, 잔량 행) 만으로 (신청, 요청 줄, 잔량 행) 과 같은 것을 막는다 —
    // 게다가 이쪽은 request_item_id 가 NULL 인 직접 사용에도 그대로 걸린다
    // (NULL 이 섞인 유니크는 아무것도 막지 못한다).
    //
    // 앞단은 이미 있는 순수 규칙이다 — domain/inventory-part-request-rules.ts 의
    // mergeDuplicateAllocations 가 같은 짝을 하나로 합친다. 이 유니크는 그것이
    // 빠진 길로 들어온 값을 막는 최종 방어선이다.
    uniqueIndex("inventory_part_issue_request_items_balance_unique").on(
      table.issueRequestId,
      table.partStockBalanceId
    ),
    index("inventory_part_issue_request_items_issue_request_id_idx").on(table.issueRequestId),
    index("inventory_part_issue_request_items_request_item_id_idx").on(table.requestItemId),
    index("inventory_part_issue_request_items_part_stock_balance_id_idx").on(
      table.partStockBalanceId
    ),
  ]
);

/**
 * 단계별 승인 — `repair_case_approvals` 와 **같은 모양**이다.
 *
 * 단계마다 요청 행이 하나 생기고, 앞 행을 APPROVED 로 바꾼 **뒤에** 다음 행을
 * 넣는다. 「한 번에 한 단계」는 아래 부분 유니크 인덱스가 보증한다 — mutation 의
 * 트랜잭션 안 재확인이 1차 방어선이고, 이 인덱스는 경쟁 조건을 「드물다」가 아니라
 * 「불가능하다」로 만드는 최종 방어선이다.
 *
 * 요청·결정이 함께 쌓이는 append 계열 표다(status_change_histories ·
 * repair_case_approvals 와 같은 규약). 결정은 그 행의 결정 칸을 **한 번** 채우는
 * 것으로 끝나고, 그 뒤로는 고치지 않는다.
 *
 * 🔴 다음에 결재할 단계를 고르는 규칙을 이 표가 다시 적지 않는다 —
 * domain/shipment-approval-route.ts 의 `findNextRouteStepToApprove` 하나가 쥐고
 * 있고(요청자 본인 단계는 건너뛴다), 이 표는 그 함수가 고른 단계를 적어 둘 뿐이다.
 */
export const inventoryPartIssueApprovals = pgTable(
  "inventory_part_issue_approvals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /**
     * ON DELETE RESTRICT — 항목(CASCADE)과 **일부러 다르다.** 항목은 신청이
     * 없으면 뜻이 없는 부속이지만, 이쪽은 「누가 언제 무엇을 승인했나」라는
     * 사실이다. 신청과 함께 조용히 사라지면 결재 기록이 통째로 없어진다
     * (inventory_part_request_history 가 부품 요청을 RESTRICT 로 참조하는 것과
     * 같은 이유다).
     */
    issueRequestId: uuid("issue_request_id")
      .notNull()
      .references(() => inventoryPartIssueRequests.id, { onDelete: "restrict" }),
    status: inventoryPartIssueApprovalStatusEnum("status").notNull().default("REQUESTED"),
    /**
     * 이 요청이 결재선(판)의 몇 번째 단계인가 — **두 칸이 한 쌍이다**(아래 CHECK).
     *
     * 🔴 판을 **그때 그 판으로 붙잡아 두는** 칸이다. 관리자가 절차를 바꾸면 새
     * 판이 얹히지만(shipment_approval_routes 는 append-only), 이미 요청된 신청은
     * 여기 적힌 옛 판을 끝까지 따라간다. 요청 시점의 결재선을 복사해 굳히는 표가
     * 따로 필요 없는 이유다.
     *
     * NULL 도 문법상 허용한다 — `repair_case_approvals` 와 같은 모양을 지키기
     * 위해서다. 다만 부품 불출에서는 **판이 없으면 신청 자체가 만들어지지 않으므로**
     * (파일 머리말의 안전장치) 실제로 NULL 인 행은 생기지 않는다. 그 판정을 표가
     * 아니라 mutation 이 쥐는 것은 의도다 — 판정을 두 곳에 적으면 갈라진다.
     *
     * ON DELETE RESTRICT — 판이 지워지면서 「몇 번째 단계였는지 알 수 없는 행」이
     * 남지 않게 한다(판은 실제로 지우지 않으므로 방어선이다).
     */
    routeId: uuid("route_id").references(() => shipmentApprovalRoutes.id, {
      onDelete: "restrict",
    }),
    /** 그 판 안에서 몇 번째 단계인가(1부터). route_id 와 함께 있거나 함께 없다. */
    routeStepOrder: integer("route_step_order"),
    /**
     * 그 단계의 승인자. 판정은 출하 쪽과 **같은 함수 하나**를 본다 —
     * auth/approval-assignment.ts 의 mayDecideAssignedApproval(지정된 사람, 또는
     * 최고관리자). 여기서 새로 적으면 화면과 서버가 다른 답을 내게 된다.
     *
     * ON DELETE RESTRICT — 다른 사람 참조 칸들과 같다.
     */
    assignedApproverUserId: uuid("assigned_approver_user_id").references(() => users.id, {
      onDelete: "restrict",
    }),
    /**
     * 요청자 · 요청 시각 · 요청 사유는 사슬을 따라 **물려받는다** — 2단계 행의
     * 요청자는 1단계를 승인한 사람이 아니라 신청을 올린 사람이다. 요청자 본인
     * 단계를 건너뛰는 규칙이 사슬 내내 같은 사람을 봐야 하기 때문이다.
     */
    requestedByUserId: uuid("requested_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
    requestReason: text("request_reason"),
    decidedByUserId: uuid("decided_by_user_id").references(() => users.id, {
      onDelete: "restrict",
    }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decisionReason: text("decision_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // 🔴 한 신청에 아직 결정되지 않은(REQUESTED) 행은 **하나뿐이다.**
    // repair_case_approvals_one_active_request 를 그대로 본떴다 — 「한 번에 한
    // 단계」가 이 인덱스 하나에 걸려 있다. 이것이 없으면 두 단계가 동시에 열려
    // 순차 승인이라는 말 자체가 성립하지 않는다.
    uniqueIndex("inventory_part_issue_approvals_one_active_request")
      .on(table.issueRequestId)
      .where(sql`status = 'REQUESTED'`),
    index("inventory_part_issue_approvals_issue_request_id_idx").on(table.issueRequestId),
    index("inventory_part_issue_approvals_requested_by_user_id_idx").on(table.requestedByUserId),
    // 「내가 지금 결재해야 할 불출 신청」이 이 사람으로 들어온다.
    index("inventory_part_issue_approvals_assigned_approver_user_id_idx").on(
      table.assignedApproverUserId
    ),
    // 결정 정보의 짝 — repair_case_approvals_decision_metadata 와 같다.
    // REQUESTED 면 결정 칸이 전부 비어 있고, 반려는 사유가 필수다(사유 없는
    // 반려는 요청자가 무엇을 고쳐야 할지 알 수 없다).
    check(
      "inventory_part_issue_approvals_decision_metadata",
      sql`
        (status = 'REQUESTED' AND decided_by_user_id IS NULL AND decided_at IS NULL AND decision_reason IS NULL)
        OR
        (status = 'APPROVED' AND decided_by_user_id IS NOT NULL AND decided_at IS NOT NULL)
        OR
        (status = 'REJECTED' AND decided_by_user_id IS NOT NULL AND decided_at IS NOT NULL AND decision_reason IS NOT NULL)
      `
    ),
    // 결재선 두 칸은 한 쌍이다. 하나만 채워진 행은 「어느 판인지는 아는데 몇
    // 번째인지 모른다」(또는 그 반대)라서 다음 단계를 이을 수도, 지난 단계를
    // 설명할 수도 없다.
    check(
      "inventory_part_issue_approvals_route_columns_together",
      sql`(route_id IS NULL AND route_step_order IS NULL) OR (route_id IS NOT NULL AND route_step_order IS NOT NULL)`
    ),
    // 단계 번호는 1부터다 — shipment_approval_route_steps_step_order_positive 와
    // 짝이다. 0이나 음수가 들어오면 그 판의 어느 단계와도 짝지어지지 않는다.
    check(
      "inventory_part_issue_approvals_route_step_order_positive",
      sql`route_step_order IS NULL OR route_step_order >= 1`
    ),
  ]
);
