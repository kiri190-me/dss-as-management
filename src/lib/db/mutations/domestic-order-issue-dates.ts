import "server-only";

import { and, eq, sql } from "drizzle-orm";
import { db } from "../client";
import { domesticOrders, repairCases, users } from "../schema";
import { hasPermission } from "@/lib/auth/permission-resolver";
import {
  DOMESTIC_ORDER_ISSUE_DATE_BOTH_EMPTY_MESSAGE,
  DOMESTIC_ORDER_ISSUE_DATE_MULTIPLE_ROWS_MESSAGE,
  DOMESTIC_ORDER_ISSUE_DATE_QUOTE_LOCK_MESSAGE,
  resolveDomesticOrderIssueDateEditPlan,
} from "@/lib/domain/domestic-order-issue-date-edit";
import { VERSION_CONFLICT_MESSAGE } from "./domestic-orders";

/**
 * ============================================================================
 * 수리 건 상세 「내자 정리 발행일」 — **두 칸만** 고치는 경로 (2026-09-29)
 * ============================================================================
 * 고치는 것은 `domestic_orders` 의 **quote_issued_date · order_issued_date** 둘
 * 뿐이고, 그 줄에 아직 내자 줄이 없으면 **그 자리에서 하나 만든다.**
 *
 * ── 🔴 왜 updateDomesticOrder 를 쓰지 않는가 ────────────────────────────
 * **그 함수는 줄 전체(스물넉 칸)를 통째로 SET 한다.** 검증(normalizeText ·
 * normalizeDate)이 키 없음을 null 로 접고, mutations/domestic-orders.ts 의
 * toColumnValues 가 그 결과를 모든 칼럼에 쓴다 — 그래서
 * `{ quoteIssuedDate: "..." }` 하나만 보내면 **그 줄의 금액 · 입금 · 납품일 ·
 * 세금계산서발행일 · 견적서 연결이 전부 지워진다**
 * (domain/domestic-order-cell-edit.ts 파일 헤더의 같은 경고). 내자 정리 화면은
 * 그 스물넉 칸을 전부 들고 있어서 되실어 보낼 수 있지만, **수리 건 상세는 그
 * 값을 하나도 들고 있지 않다.** 여기서 그 경로를 쓰면 다른 화면에서 적어 둔
 * 정산 기록이 날짜 하나 고치는 저장에 사라진다.
 *
 * 🔴 **그러니 이 함수를 updateDomesticOrder 와 합치지 마라.** 중복처럼 보이는
 * 것은 트랜잭션 · 잠금 · version 대조의 모양뿐이고, SET 절에 무엇이 들어가는지가
 * 정반대다. 합치는 순간 위 사고가 돌아온다.
 *
 * ── 서버가 화면과 **같은 판정을 독립적으로** 한다 ───────────────────────
 * 줄이 둘 이상인가(분할 발주), 견적서가 붙어 견적발행일이 잠겼는가는 화면도
 * 보지만, 화면이 감춘 것은 경계가 아니다 — 액션을 직접 부르면 그만이다. 그래서
 * **트랜잭션 안에서 다시 읽은 줄**로 domain/domestic-order-issue-date-edit.ts 의
 * 같은 함수를 부른다. 규칙은 그 파일 하나에만 적혀 있다.
 *
 * ── 인가도 여기서 한 번 더 본다 ─────────────────────────────────────────
 * 서버 액션이 이미 보지만, 이 함수를 액션을 거치지 않고 부를 수 있다
 * (mutations/domestic-order-sheet-settings.ts 와 같은 판단). 관문은 내자 정리의
 * 행 추가·수정과 **같다** — hasPermission("domesticOrders", "WRITE"). 🔴 역할
 * 이름을 비교하지 않는다. 설정 축 하나만 묻는다.
 *
 * ── 낙관적 잠금은 **내자 줄의 version** 이다 ────────────────────────────
 * repair_cases.version 이 아니다 — 고치는 대상이 내자 줄이다. ⚠️ PO
 * 시스템(dss-po)이 **같은 표를 같은 DB 에서** 고치므로, 다른 사이트에서 동시에
 * 고치는 일이 실제로 일어난다. 대조 방식과 응답 모양은 updateDomesticOrder 를
 * 그대로 따른다(같은 문장 — 위 import 의 VERSION_CONFLICT_MESSAGE).
 *
 * ── 만들기와 고치기가 **한 번의 저장 안에서** 갈린다 ────────────────────
 * 사람은 「저장」을 누를 뿐이다. 그래서 갈림은 트랜잭션 **안에서** 일어나고,
 * 그 전에 수리 건 행을 `FOR UPDATE` 로 잠근다 — 두 사람이 동시에 첫 저장을
 * 누르면 둘 다 "줄이 없다"를 보고 각자 만들어 줄이 둘이 되기 때문이다
 * (repair_case_id 에 유일 제약이 없어 DB 가 막아 주지 않는다). 잠그는 것이
 * 내자 줄이 아니라 수리 건인 이유: 아직 없는 줄은 잠글 수 없다.
 *
 * 그 사이에 **내자 정리 화면에서** 줄이 생겼거나 사라졌으면 화면이 들고 온
 * expectedVersion 과 어긋나므로 CONFLICT 다(아래 두 갈래의 첫 줄) — 없던 줄에
 * 덮어쓰지도, 있는 줄 옆에 하나를 더 만들지도 않는다.
 *
 * ── 새 줄은 세 칸만 채운다 ──────────────────────────────────────────────
 * {repair_case_id, quote_issued_date, order_issued_date} 뿐이다. 고객사 ·
 * 인수번호 · 형식 · L/N · S/N · 고장내역 · 순번은 **비운다** — 비어 있으면
 * 연결된 수리 건의 값을 따라가는 것이 이 표의 기본이고(schema 헤더의 '비어
 * 있는 것이 기본'), 옮겨 적으면 그 줄에 박제되어 수리 건 쪽을 고쳐도 따라오지
 * 않는다.
 *
 * createDomesticOrder 를 쓰지 않은 까닭: 그 함수는 스물넉 칸짜리
 * DomesticOrderFields 한 벌을 요구하고 딸린 표(납기요청일)까지 함께 비워 쓴다
 * (replaceDueDates). 여기서 빈 값 스물한 개를 지어내 넘기면, 나중에 그 타입에
 * 칸이 하나 늘 때마다 **이 화면이 무엇을 보내고 있는지 아무도 모르는 상태**가
 * 된다. 세 칸만 쓰는 INSERT 는 그 자체로 무엇을 만드는지 말한다.
 *
 * ── 감사 로그 ───────────────────────────────────────────────────────────
 * 남기지 않는다 — 이 표의 행 추가·수정·완료도 남기지 않는다
 * (mutations/domestic-orders.ts). 여기서만 남기면 같은 표의 같은 칸이 어느
 * 화면에서 고쳤느냐에 따라 기록이 있기도 없기도 하다.
 * ============================================================================
 */

export type SaveRepairCaseDomesticOrderIssueDatesCode =
  | "NOT_FOUND"
  | "CONFLICT"
  | "FORBIDDEN"
  | "MULTIPLE_ROWS"
  | "QUOTE_LOCKED"
  | "EMPTY";

export type SaveRepairCaseDomesticOrderIssueDatesResult =
  | {
      ok: true;
      /** 고치거나 새로 만든 **내자 줄**의 id. 수리 건 id 가 아니다. */
      id: string;
      /** 저장 뒤의 내자 줄 version. 화면은 새로 불러오므로 참고값이다. */
      version: number;
      /** 그 자리에서 줄을 만들었는가. 거짓이면 있던 줄을 고쳤다. */
      created: boolean;
    }
  | { ok: false; code: SaveRepairCaseDomesticOrderIssueDatesCode; message: string };

const NOT_FOUND_MESSAGE = "해당 수리 건을 찾을 수 없습니다.";
const FORBIDDEN_MESSAGE = "내자 정리를 고칠 수 있는 사람만 이 날짜를 바꿀 수 있습니다.";
const ACTOR_UNKNOWN_MESSAGE = "사용자 정보를 확인할 수 없습니다.";

export async function saveRepairCaseDomesticOrderIssueDates(params: {
  repairCaseId: string;
  /** "YYYY-MM-DD" 또는 null(지웠다). 검증은 부르는 쪽이 이미 지났다. */
  quoteIssuedDate: string | null;
  orderIssuedDate: string | null;
  /**
   * 화면이 보고 있던 **내자 줄의 version**. 줄이 없다고 본 화면은 null 을 보낸다 —
   * 그 null 자체가 "만들려고 왔다"는 신호라, 그 사이에 줄이 생겼으면 CONFLICT 다.
   */
  expectedVersion: number | null;
  actorUserId: string;
}): Promise<SaveRepairCaseDomesticOrderIssueDatesResult> {
  return db.transaction(async (tx): Promise<SaveRepairCaseDomesticOrderIssueDatesResult> => {
    // ── ① 행위자 — 트랜잭션 안에서 살아 있는 계정을 다시 읽는다 ───────────
    // 세션을 읽은 뒤 강등·정지된 계정이 그 사이에 저장하는 구멍을 막는다.
    const [actor] = await tx
      .select({
        id: users.id,
        role: users.role,
        approvalStatus: users.approvalStatus,
        isDeveloper: users.isDeveloper,
      })
      .from(users)
      .where(and(eq(users.id, params.actorUserId), eq(users.isDeleted, false)));
    if (!actor || actor.approvalStatus !== "APPROVED") {
      return { ok: false, code: "FORBIDDEN", message: ACTOR_UNKNOWN_MESSAGE };
    }
    if (!(await hasPermission(actor, "domesticOrders", "WRITE"))) {
      return { ok: false, code: "FORBIDDEN", message: FORBIDDEN_MESSAGE };
    }

    // ── ② 수리 건을 잠근다 — 같은 건에 줄이 두 번 생기지 않도록 ───────────
    // is_deleted 를 보지 않는 것은 updateDomesticOrder 의 repairCaseExists 와
    // 같은 판단이다 — 휴지통에 있는 건에 대한 정산 기록도 남아야 하고, 화면에
    // 보이는 연결을 저장할 수 없는 상태를 만들지 않는다.
    const [target] = await tx
      .select({ id: repairCases.id })
      .from(repairCases)
      .where(eq(repairCases.id, params.repairCaseId))
      .for("update");
    if (!target) {
      return { ok: false, code: "NOT_FOUND", message: NOT_FOUND_MESSAGE };
    }

    // ── ③ 이 건의 살아 있는 내자 줄 전부를 잠가 읽는다 ────────────────────
    // 지워진 줄은 세지 않는다 — 화면에서 지운 줄이 "여럿이라 막힘"을 만들면,
    // 어디에도 안 보이는 줄이 이 화면을 잠그는 셈이 된다(조회와 같은 규칙).
    const rows = await tx
      .select({
        id: domesticOrders.id,
        version: domesticOrders.version,
        quoteId: domesticOrders.quoteId,
        quoteIssuedDate: domesticOrders.quoteIssuedDate,
      })
      .from(domesticOrders)
      .where(
        and(
          eq(domesticOrders.repairCaseId, params.repairCaseId),
          eq(domesticOrders.isDeleted, false)
        )
      )
      .for("update");

    // 🔴 화면이 쓰는 그 함수다. 규칙을 여기서 새로 적지 않는다(파일 헤더).
    const plan = resolveDomesticOrderIssueDateEditPlan(rows);

    // ── 줄이 둘 이상 — 어느 줄을 고치라는 뜻인지 말할 수 없다 ─────────────
    if (plan.kind === "BLOCKED_MULTIPLE") {
      return {
        ok: false,
        code: "MULTIPLE_ROWS",
        message: DOMESTIC_ORDER_ISSUE_DATE_MULTIPLE_ROWS_MESSAGE,
      };
    }

    // ── 줄이 없다 — 그 자리에서 만든다 ────────────────────────────────────
    if (plan.kind === "CREATE") {
      // 화면은 줄이 하나라고 보고 version 을 실어 왔는데 지금은 없다 — 그 사이에
      // 누가 그 줄을 휴지통으로 보냈다. 새로 만들면 지운 사람의 판단을 뒤집는
      // 셈이라 만들지 않는다.
      if (params.expectedVersion !== null) {
        return { ok: false, code: "CONFLICT", message: VERSION_CONFLICT_MESSAGE };
      }
      if (params.quoteIssuedDate === null && params.orderIssuedDate === null) {
        return { ok: false, code: "EMPTY", message: DOMESTIC_ORDER_ISSUE_DATE_BOTH_EMPTY_MESSAGE };
      }
      const [inserted] = await tx
        .insert(domesticOrders)
        .values({
          repairCaseId: params.repairCaseId,
          quoteIssuedDate: params.quoteIssuedDate,
          orderIssuedDate: params.orderIssuedDate,
          createdBy: params.actorUserId,
          // 만든 사람이 곧 마지막으로 고친 사람이다(createDomesticOrder 와 같다).
          updatedBy: params.actorUserId,
        })
        .returning({ id: domesticOrders.id, version: domesticOrders.version });
      return { ok: true, id: inserted.id, version: inserted.version, created: true };
    }

    // ── 줄이 하나 — 그 줄의 두 칸만 고친다 ────────────────────────────────
    // 화면은 줄이 없다고 보고 왔는데 지금은 있다 — 그 사이에 내자 정리(또는 PO
    // 시스템)에서 줄이 생겼다. 화면이 보지 못한 줄을 덮어쓰지 않는다.
    if (params.expectedVersion === null || params.expectedVersion !== plan.version) {
      return { ok: false, code: "CONFLICT", message: VERSION_CONFLICT_MESSAGE };
    }

    // plan.kind === "UPDATE" 는 줄이 정확히 하나라는 뜻이다(같은 함수가 낸 판정).
    const current = rows[0];
    // 🔴 견적서가 붙은 줄의 견적발행일은 견적서를 따른다. **바꾸려 할 때만**
    // 막는다 — 지금 값을 그대로 되실어 보낸 저장(발주발행일만 고치는 저장)까지
    // 막으면 이 줄에서는 PO 발행일도 고칠 수 없게 된다.
    if (plan.quoteIssuedDateLocked && params.quoteIssuedDate !== current.quoteIssuedDate) {
      return {
        ok: false,
        code: "QUOTE_LOCKED",
        message: DOMESTIC_ORDER_ISSUE_DATE_QUOTE_LOCK_MESSAGE,
      };
    }

    const [updated] = await tx
      .update(domesticOrders)
      // 🔴 **SET 은 이 둘과 기록용 셋뿐이다.** 다른 칸을 여기 더하는 순간 이
      // 화면이 들고 있지도 않은 값을 덮어쓰게 된다(파일 헤더).
      .set({
        quoteIssuedDate: params.quoteIssuedDate,
        orderIssuedDate: params.orderIssuedDate,
        version: sql`${domesticOrders.version} + 1`,
        updatedAt: new Date(),
        updatedBy: params.actorUserId,
      })
      // 잠금을 쥐고 있어 version 조건 없이도 안전하지만 한 번 더 적는다 —
      // updateDomesticOrder 가 0행 갱신을 마지막 안전망으로 쓰는 방식과 같다.
      .where(and(eq(domesticOrders.id, plan.id), eq(domesticOrders.version, plan.version)))
      .returning({ id: domesticOrders.id, version: domesticOrders.version });

    if (!updated) {
      return { ok: false, code: "CONFLICT", message: VERSION_CONFLICT_MESSAGE };
    }

    return { ok: true, id: updated.id, version: updated.version, created: false };
  });
}
