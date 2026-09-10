import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./users";

/**
 * ============================================================================
 * 승인 절차(결재선) — 한 판(version)씩 쌓는 표 둘
 * ============================================================================
 * 단계적 승인이 필요한 곳에서 **여러 사람에게 순서대로** 결재를 받기 위한
 * 절차다. 처음에는 최종 출하 승인
 * (repair_case_approvals.approval_type = 'FINAL_SHIPMENT') 하나만을 위한 것이었고,
 * 그 승인은 「출하 대표」(users.is_shipment_representative)나 위임
 * (shipment_approval_delegations)을 받은 사람이면 **아무나** 처리할 수 있었다 —
 * 「누구에게 보낸다」는 개념 자체가 없었다. 이 표는 그 순서를 담는다.
 *
 * ── 🔴 표 이름은 옛것이고, 지금은 scope 칸이 뜻을 정한다 ────────────────
 * 이름에 남은 `shipment` 는 **처음 쓰임새의 흔적일 뿐이다**(2026-09-10). 지금 이
 * 표는 출하 전용이 아니고, 어느 절차인지는 `scope` 칸 하나가 정한다 —
 * 'FINAL_SHIPMENT'(최종 출하 승인) · 'PART_ISSUE'(부품 불출 승인). 표·코드 이름을
 * 바꾸지 않은 것은 의도다: 표 이름 바꾸기는 db:preflight 가 보지 못하는 종류의
 * 위험한 변경이고(자료가 사라지지는 않지만 적용 도중 끊기면 앱이 통째로 멈춘다),
 * 지금 얻을 것보다 잃을 것이 크다. **다음 사람은 이름이 아니라 scope 를 보고
 * 판단할 것.**
 *
 * 설계 결정(2026-09-09, 사용자 승인):
 *  · 한 용도에 절차는 **하나**뿐이다. 고객사별·금액별 분기는 없다.
 *  · 절차가 「출하 대표」를 **대신한다**. 대표 지정은 절차를 아직 만들지 않았을
 *    때의 기본값으로만 남는다.
 *  · 순서는 **일렬**이다 — 갈래도 병렬 승인도 없다.
 *  · 반려되면 처음 단계부터 다시 요청한다.
 *
 * ── 🔴 왜 판(version)으로 쌓는가 ────────────────────────────────────────
 * 이 저장소는 물리적 삭제를 원칙적으로 금지한다(DATABASE_DESIGN.md #8). 그래서
 * 절차를 고칠 때 기존 줄을 지우고 다시 쓰지 않는다 — **새 판을 하나 더 얹는다.**
 * 이 모양을 고른 이유가 셋이다:
 *
 *  1. **지운 기록이 남는다.** 「누가 언제 결재선을 바꿨나」가 표 자체에 남는다.
 *     인가에 관계된 설정이라 별도의 이력 표(representative_change_history 같은
 *     것)를 두지 않고도 추적이 끊기지 않는다.
 *  2. **진행 중인 건이 흔들리지 않는다.** 나중 조각에서 승인 요청에 「몇 번째
 *     판으로 요청했는지」만 적어 두면, 관리자가 절차를 바꿔도 이미 요청된 건은
 *     옛 판을 그대로 따라간다. 요청 시점의 결재선을 복사해 굳히는 표가 따로
 *     필요 없다(repair_case_approvals.repair_case_version_at_request 가 접수 건
 *     상태에 대해 하는 것과 같은 종류의 고정이다).
 *  3. **순서 바꾸기가 안전하다.** 줄을 위아래로 옮길 때 step_order 가 잠깐
 *     겹치는 문제(유니크 위반)가 원천적으로 없다 — 새 판을 통째로 새로 쓰기
 *     때문이다. 「임시로 999 를 넣었다가 되돌린다」 같은 우회가 필요 없다.
 *
 * ── 🔴 「현재 절차」 = **그 용도 안에서** version 이 가장 큰 판 ────────────
 * is_current 같은 칸을 두지 않는다. 같은 사실이 두 곳(정렬 순서와 깃발)에 적히면
 * 언젠가 갈라지고, 그때 「현재」가 둘이 되거나 0개가 된다. 현재 판은 언제나
 * `WHERE scope = ? ORDER BY version DESC LIMIT 1` 하나로 정해진다
 * (queries/shipment-approval-routes.ts).
 *
 * 판 번호도 **용도 안에서** 센다 — 출하 3판과 불출 1판이 함께 있는 것이 정상이다.
 * 유니크가 (scope, version) 인 이유가 그것이다.
 *
 * ── 🔴 이 표가 비어 있으면 앱은 이 기능이 없던 때와 완전히 같이 동작한다 ──
 * 판이 하나도 없는 것이 정상 초기 상태다. 그때는 지금까지처럼 「출하 대표」·위임
 * 방식으로 최종 출하 승인이 돌아간다. 단계 0개인 판도 마찬가지다 — 「절차를 쓰지
 * 않겠다」는 뜻이므로 대표 방식으로 되돌아간다(빈 판과 판 없음을 굳이 구분하지
 * 않는다).
 * ============================================================================
 */

/**
 * 이 절차가 **무엇을 결재하는가**.
 *
 * 🔴 값 목록은 domain/shipment-approval-route.ts 의
 * SHIPMENT_APPROVAL_ROUTE_SCOPES 와 **글자 그대로 같아야 한다**. 여기서 다시
 * 적는 이유는 이 저장소의 스키마 파일이 도메인 층을 가져오지 않기 때문이고
 * (repair_case_approval_type 이 APPROVAL_TYPE_CODES 를 다시 적는 것과 같다),
 * 두 벌이 갈라지지 않도록 domain/shipment-approval-route.test.ts 가 둘을 맞춰
 * 본다.
 *
 * 'PART_ISSUE' 는 **아직 쓰는 코드가 없다** — 부품 불출 승인이 다음 조각에서
 * 이 절차를 탄다. enum 값은 나중에 뺄 수 없으므로 미리 넣어 두는 것이 값을
 * 두 번 더하는 마이그레이션보다 낫다.
 */
export const shipmentApprovalRouteScopeEnum = pgEnum("shipment_approval_route_scope", [
  "FINAL_SHIPMENT",
  "PART_ISSUE",
]);

/**
 * 절차 한 판. **한 번 쓰면 바뀌지 않는다**(append-only).
 *
 * 그래서 updated_at 도, 소프트삭제 네 칸(is_deleted·deleted_at·deleted_by·
 * delete_reason)도 두지 않는다 — 고치는 길이 없으니 「마지막으로 고친 시각」이
 * 가리킬 것이 없고, 판을 지우는 대신 새 판을 얹으므로 휴지통에서 되살릴 일도
 * 없다. status_change_histories · repair_case_approvals 와 같은 append 계열
 * 규약이다.
 *
 * 절차 이름 칸은 두지 않는다 — 절차가 하나뿐이라 이름이 구별할 것이 없다.
 * 여러 절차(고객사별 등)가 필요해지면 그때 칸을 늘린다.
 */
export const shipmentApprovalRoutes = pgTable(
  "shipment_approval_routes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /**
     * 어느 절차인가. 🔴 **기본값을 두지 않는다.** 기본값을 남겨 두면 용도를 적지
     * 않은 판이 조용히 출하 절차로 들어가고, 그러면 다음 사람이 「불출 절차를
     * 저장했는데 출하가 바뀌었다」를 만나게 된다. 뜻을 숨기는 기본값을 두지
     * 않는 것은 이 표의 관례다(repair_case_approvals.assigned_approver_user_id
     * 가 nullable·기본값 없음인 것과 같은 이유).
     */
    scope: shipmentApprovalRouteScopeEnum("scope").notNull(),
    /** 1 부터. **그 용도 안에서** 가장 큰 값이 곧 「현재 절차」다. */
    version: integer("version").notNull(),
    /**
     * 이 판을 만든 사람. RESTRICT 는 이 저장소의 사람 참조 관례다 — 사용자는
     * 소프트삭제만 하므로 행이 사라지는 일이 없고, 실수로라도 하드 삭제가
     * 시도되면 여기서 막힌다.
     */
    createdByUserId: uuid("created_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // 판 번호는 **한 용도 안에서** 겹치지 않는다 — 「현재 절차」의 정의가 그
    // 용도의 가장 큰 version 에 걸려 있으므로, 겹치는 순간 현재가 둘이 된다.
    //
    // 🔴 반대로 **다른 용도끼리는 같은 번호를 써도 된다.** 출하 1판과 불출 1판이
    // 함께 있는 것이 정상이다 — 사람이 읽는 번호는 「이 절차의 몇 번째 판인가」이지
    // 표 전체의 일련번호가 아니다. 2026-09-10 이전에는 version 하나에만 걸려
    // 있었고, 용도가 늘면서 (scope, version) 으로 옮겼다.
    uniqueIndex("shipment_approval_routes_scope_version_unique").on(table.scope, table.version),
  ]
);

/**
 * 그 판의 단계들. 위에서부터 순서대로 결재한다.
 *
 * **단계 0개인 판도 정상이다** — 「절차를 쓰지 않겠다」는 뜻이다. 그래서 여기에는
 * 「최소 한 줄」 제약을 두지 않는다(DB 로는 표현할 수도 없고, 표현할 이유도 없다).
 * 상한(10단계)은 순수 로직 쪽에 있다 — domain/shipment-approval-route.ts 의
 * MAX_SHIPMENT_APPROVAL_ROUTE_STEPS.
 */
export const shipmentApprovalRouteSteps = pgTable(
  "shipment_approval_route_steps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /**
     * 단계는 판에 딸린 것이라 판이 사라지면 함께 사라진다 — 여기만 CASCADE 다.
     * 실제로는 판을 지우지 않으므로(append-only) 이것은 고아 행을 만들지 않기
     * 위한 방어선이지, 쓰이라고 열어 둔 길이 아니다.
     */
    routeId: uuid("route_id")
      .notNull()
      .references(() => shipmentApprovalRoutes.id, { onDelete: "cascade" }),
    /** 1 부터. 배열의 자리(index + 1)로 매긴다 — domain 쪽 주석 참조. */
    stepOrder: integer("step_order").notNull(),
    approverUserId: uuid("approver_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // 한 판 안에서 순서가 겹치지 않는다.
    uniqueIndex("shipment_approval_route_steps_order_unique").on(
      table.routeId,
      table.stepOrder
    ),
    // 한 판 안에서 같은 사람이 두 번 나오지 않는다. 사람에게 이유를 말해 주는
    // 앞단은 validateShipmentApprovalRouteSteps 이고, 이 유니크가 최종 방어선이다
    // — 같은 사람이 두 번 나오면 「내 차례인가」가 한 건에 대해 두 번 참이 되어
    // 순차 승인이라는 말 자체가 성립하지 않는다.
    uniqueIndex("shipment_approval_route_steps_approver_unique").on(
      table.routeId,
      table.approverUserId
    ),
    // 나중 조각의 「지금 내 차례인가」 조회가 이 사람으로 들어온다.
    index("shipment_approval_route_steps_approver_user_id_idx").on(table.approverUserId),
    check("shipment_approval_route_steps_step_order_positive", sql`step_order >= 1`),
  ]
);
