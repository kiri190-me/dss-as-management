import "server-only";

import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "../client";
import { domesticOrderDueDates, domesticOrders } from "../schema";
import { domesticOrderDueDateRowLabel } from "@/lib/domain/domestic-order-due-date-label";
import { resolveDomesticOrderValue } from "@/lib/domain/domestic-order-list";
import { isDomesticOrderDueDateRowNear } from "@/lib/domain/notifications";

/**
 * ============================================================================
 * 기타건 납기 임박 — 종 알림 「기타건 납기 임박」의 원본 (2026-11-25)
 * ============================================================================
 * **SELECT 만 있다.** 이 파일은 아무것도 쓰지 않고, 쓸 표도 만들지 않는다 —
 * 알림은 저장되지 않고 매 요청마다 업무 데이터에서 다시 계산된다
 * (domain/notifications.ts 머리말). 그래서 그 회차에 납품일이 적히거나 [완료 처리]되면
 * 다음 조회에서 저절로 빠지고, 되돌리면 저절로 돌아온다.
 *
 * ── 🔴 「납기 임박」 조회를 넓힐 수 없었다 ──────────────────────────────
 * queries/repair-case-due-date-notifications.ts 는 `repair_cases` 에서 시작해
 * `workflow_steps` 를 **innerJoin** 한다. 🔴 **기타건에는 `repair_cases` 행도 워크플로도
 * 없다** — 정의상 수리 건이 안 붙은 내자 줄이라, 그 조회에 조건을 더하는 것으로는
 * 한 줄도 나올 수 없다. 그래서 나란히 새로 세운다(기타건 결재 대기가 접수 건 결재
 * 조회를 안 넓힌 것과 같은 자리·같은 까닭).
 *
 * ── 🔴 그래도 **판정은 베껴 적지 않는다** ───────────────────────────────
 * 뜰지 말지를 정하는 한 줄은 도메인 함수다(domain/notifications.ts 의
 * isDomesticOrderDueDateRowNear — 끝난 회차를 빼고, 「납기 임박」이 쓰는 그 창에
 * 묻는다: 오늘 ≤ 날짜 ≤ 오늘+7, 한국 달력). 베껴 적으면 「임박」의 뜻이 둘로 갈려,
 * 수리 건 쪽 창이 바뀌는 날 기타건만 옛 창으로 남는다. 🔴 **SQL 로 날짜를 재지 않는
 * 것**이 그 규율의 가장 단단한 표현이다 — 행을 읽어 도메인에 묻는다(그 까닭은
 * repair-case-due-date-notifications.ts 머리말에 있다).
 * 🔴 **2026-11-25 늦게 그 함수가 생겼다.** 그 전까지는 이 파일이 조건 셋을 손으로
 * 펴 쓰고 창만 도메인에 물었는데, 같은 판정을 화면 배지 둘이 함께 쓰게 되면서
 * (기타건 현황 목록 · 기타건 상세 머리 카드) 조건이 세 벌이 될 자리였다 — 그러면
 * **종에는 없는 배지가 표에만 서는** 어긋남이 생기고, 각 자리의 시험은 둘 다 초록이다.
 *
 * ── 🔴 가르는 자리는 `repair_case_id IS NULL` 하나다 ────────────────────
 * 「기타건」의 뜻이 그것이다(domain/domestic-order-approval-rules.ts 와 같은 잣대).
 * 🔴 **안 걸면 수리 건이 붙은 줄이 알림을 두 번 받는다** — 그 줄의 납기요청일은 이미
 * 「납기 임박」이 **빌려 와서** 재고 있어서(resolveRepairCaseRequestedDueDate), 여기서
 * 또 세우면 같은 날짜가 종에 두 줄로 선다.
 *
 * ── 빼는 것 셋 ──────────────────────────────────────────────────────────
 *  · 휴지통에 든 줄(`domestic_orders.is_deleted`) — 상세가 열리지 않으므로(queries/
 *    domestic-orders.ts 의 getDomesticOrderDetail) 누르면 갈 화면이 없는 알림을 세우지
 *    않는다. 종 알림 전부가 같은 조건을 건다.
 *  · 🔴 **끝난 회차** — 그 행에 `completed_at`(회차 [완료 처리]) 또는 `delivered_date`
 *    (납품일)가 있으면 뺀다. 둘 중 하나만 보면 안 된다는 까닭은 위 도메인 함수의
 *    주석에 있다(완료와 납품일은 적히는 길이 달라 한쪽만 찬 행이 실제로 있다).
 *    🔵 **줄 전체의 완료는 따로 볼 필요가 없다** — 줄을 [완료 처리]하면 저장 통로가
 *    **모든 회차 행에** `completed_at` 을 찍는다(mutations/domestic-orders.ts 의
 *    「회차 행도 줄과 같은 방향으로 움직인다」). 회차 한 칸만 보면 공짜로 따라온다.
 *  · 창 밖 — 오늘보다 이른(이미 지난) 날짜와 오늘 + 7일보다 늦은 날짜. 🔴 **지난 납기는
 *    이 알림의 범위가 아니다**(2026-11-25 사용자 요청에 「지연」은 없다 — 기타건에는
 *    지연 알림을 만들지 않았다).
 * 🔵 **승인 상태는 보지 않는다.** 승인은 「보낼 수 있다」이지 「보냈다」가 아니다 —
 *    승인만 받고 안 보낸 회차야말로 납기가 다가오면 챙겨야 하는 줄이다.
 *
 * ── 🔴 회차 번호는 **자리**로 센다 — `display_order` 를 그대로 쓰지 않는다 ──
 * 화면이 「N차」를 붙이는 방법이 그것이다: (`display_order`, `due_date`) 로 세운 목록에서
 * **자리 + 1**(내자 정리 표의 그 줄 · [승인] 탭의 domesticOrderDueDateUnits). 그 칸은
 * NULL 을 허용하므로(옮겨 온 값에 차례가 없을 수 있다 — 그 표의 주석) 칸을 그대로 쓰면
 * 화면이 「2차」라 부르는 회차를 알림만 다른 번호로 부르게 된다. 🔴 그 번호가 알림 id 를
 * 가르고 승인 행이 회차를 가리키는 값(`repair_case_approvals.due_date_row_order`)과 같은
 * 번호라, 어긋나면 사람이 두 줄을 짝지을 수 없다.
 *
 * 🔴 **그래서 번호는 거르기 *전*에 매긴다.** 끝난 회차를 먼저 빼고 세면 1차가 납품된
 * 줄에서 2차가 「1차」로 불린다 — 종에 뜬 회차와 화면의 회차가 달라지는 가장 조용한
 * 방식이다. 그 때문에 끝남 거르기가 SQL 이 아니라 아래 고리 안에 있다.
 *
 * ── 조인하지 않고 한 번에 읽고 **묶는다** ───────────────────────────────
 * 한 기타건 줄에 납기요청일이 여럿이다(분할 납품). 여기서는 그것이 복제가 아니라
 * **단위**다 — 회차마다 한 줄이 떠야 한다(기타건 결재 대기가 2026-11-08 에 같은 결론에
 * 닿았다). 그래서 줄을 접지 않고, 번호를 매기려고 줄 단위로 묶기만 한다.
 *
 * ── 🔴 이 조회는 **모든 화면의 머리말**에서 돈다 ────────────────────────
 * 레지스트리는 각 load 를 try/catch 로 감싸지 않는다(queries/notifications.ts 의
 * listMyNotifications — Promise.all 그대로다). 여기서 던지면 종이 비는 것이 아니라
 * **그 화면이 통째로 못 그려진다.** 그래서 읽는 칸을 알림 한 줄에 필요한 것으로만
 * 묶고(줄 id · 품명 · 납기요청일 · 메모 · 차례 · 끝남 두 칸), 던질 수 있는 계산을
 * 하지 않는다.
 *
 * ── 누구에게 가는가 — 모두에게 ──────────────────────────────────────────
 * 🔴 역할을 보지 않는다(2026-11-25). 「납기 임박」과 같은 답이고, 그 결정은 이 조회가
 * 아니라 알림 설정의 역할 기본값이 담는다(domain/notification-settings.ts 의
 * defaultRoleReceivesNotification — 그 case 에 까닭). 그래서 이 조회는 사용자 id 도
 * 역할도 받지 않고, 사람마다 결과가 달라지지도 않는다.
 *
 * ── PII ────────────────────────────────────────────────────────────────
 * 줄 id · 품명 · 날짜 · 회차 메모만 읽는다. 🔵 회차 메모(`note`)는 사람이 자유롭게 적는
 * 칸이라 담당자 이름이 섞일 수 있지만(그 표의 PII 항목), 그 글자는 **이미 내자 정리
 * 표와 [승인] 탭에 그대로 보이는 값**이고 알림은 같은 사람에게 같은 화면의 값을 다시
 * 보여 줄 뿐이다. 고객사도 연락처도 나오지 않는다.
 * ============================================================================
 */

/** 종 알림 「기타건 납기 임박」 한 줄의 원본. */
export type DomesticOrderDueDateNearRow = {
  domesticOrderId: string;
  /** 그 줄의 품명. 🔴 `null` 일 수 있다 — 메우는 자리는 알림 빌더 하나다. */
  modelName: string | null;
  /** 화면에 보이는 그 납기요청일("YYYY-MM-DD"). 창 안이라고 이미 가려진 값이다. */
  dueDate: string;
  /** 🔴 몇 번째 회차인가(1부터). 화면이 「N차」라 부르는 바로 그 번호다. */
  dueDateRowOrder: number;
  /** 🔵 회차가 하나뿐인 줄에서는 `null` — 붙일 말이 없다(파일 머리말). */
  dueDateRowLabel: string | null;
};

type DueDateNearOptions = {
  /** 창을 잴 기준 시각. 시험이 창의 경계를 박아 넣는다. 기본은 지금이다. */
  now?: Date;
};

/**
 * 납기요청일이 **오늘부터 7일 안으로** 다가온 기타건 회차 전부 — 날짜가 이른 것부터.
 *
 * `now` 를 옵션으로 받는 이유는 「납기 임박」·「납기 지연」 조회와 같다 — 시험이 창의
 * 경계를 박아 넣어야 「오늘이 언제인가」에 따라 결과가 달라지지 않는다. 운영에서는
 * 넘기지 않으며, 그때 「오늘」은 **서버의 한국 날짜**다(domain/date-only.ts).
 *
 * 🔵 차례를 **날짜 오름차순**으로 세운다 — 이웃 넷이 인수번호로 세우는 자리인데,
 * 기타건에는 인수번호가 없다(그래서 알림이 품명을 굵게 둔다). 가장 급한 회차가 맨 위에
 * 오는 것이 이 경보가 말하려는 바이고, 같은 날짜면 줄 id·회차로 동점을 깨 **실행마다
 * 차례가 흔들리지 않게** 한다(흔들리면 새로고침할 때마다 종 패널의 줄이 자리를 바꾼다).
 */
export async function listDomesticOrdersWithDueDateNear(
  options: DueDateNearOptions = {}
): Promise<DomesticOrderDueDateNearRow[]> {
  const now = options.now ?? new Date();

  const rows = await db
    .select({
      domesticOrderId: domesticOrders.id,
      modelNameText: domesticOrders.modelNameText,
      dueDate: domesticOrderDueDates.dueDate,
      note: domesticOrderDueDates.note,
      completedAt: domesticOrderDueDates.completedAt,
      deliveredDate: domesticOrderDueDates.deliveredDate,
    })
    .from(domesticOrderDueDates)
    .innerJoin(domesticOrders, eq(domesticOrders.id, domesticOrderDueDates.domesticOrderId))
    .where(
      and(
        eq(domesticOrders.isDeleted, false),
        // 🔴 이 한 줄이 「기타건만」이다(파일 머리말). 빼면 수리 건이 붙은 줄이
        //    「납기 임박」과 함께 두 번 뜬다.
        isNull(domesticOrders.repairCaseId)
      )
    )
    // 🔴 화면이 회차를 세우는 차례와 **글자 그대로 같다**(queries/domestic-orders.ts 의
    //    납기요청일 읽기). 자리가 곧 번호라 이 차례가 달라지면 번호가 달라진다.
    //    줄 id 를 맨 앞에 두는 것은 아래에서 줄 단위로 묶기 위해서다.
    .orderBy(
      asc(domesticOrders.id),
      asc(domesticOrderDueDates.displayOrder),
      asc(domesticOrderDueDates.dueDate)
    );

  // 줄 단위로 묶는다 — 번호를 매기려면 그 줄의 회차가 **몇 개인지**와 **몇 번째인지**를
  // 함께 알아야 한다. 위 정렬이 같은 줄을 잇달아 내놓으므로 차례대로 담기만 한다.
  const byOrderId = new Map<string, typeof rows>();
  for (const row of rows) {
    const bucket = byOrderId.get(row.domesticOrderId);
    if (bucket) bucket.push(row);
    else byOrderId.set(row.domesticOrderId, [row]);
  }

  const items: DomesticOrderDueDateNearRow[] = [];
  for (const [domesticOrderId, orderRows] of byOrderId) {
    // 🔵 회차가 둘 이상일 때만 이름표를 붙인다 — 기타건 결재 대기가 쓰는 그 갈림이다.
    //    세는 것은 **거르기 전** 전체 회차 수다(끝난 회차를 빼고 세면 2차만 남은 줄이
    //    「회차가 하나뿐」으로 보여 이름표가 사라진다).
    const multipleRows = orderRows.length > 1;
    for (const [index, row] of orderRows.entries()) {
      // 🔴 번호를 먼저 매기고 그다음에 거른다(파일 머리말).
      const dueDateRowOrder = index + 1;
      // 🔴 끝남 둘과 창을 **한 함수에** 묻는다 — 화면의 배지가 같은 함수를 부른다
      //    (domain/notifications.ts 의 isDomesticOrderDueDateRowNear). 여기서 세 줄로
      //    펴 쓰면 「임박」의 뜻이 종과 표에서 갈릴 수 있다.
      if (!isDomesticOrderDueDateRowNear(row, now)) continue;

      items.push({
        domesticOrderId,
        // 「이 줄에 적힌 값이 먼저, 없으면 연결된 수리 건의 값」 — 기타건은 정의상
        // 수리 건이 안 붙은 줄이라 오른쪽이 늘 비어 있지만, 규칙을 여기서 바꾸면
        // 종에 뜬 글자와 눌러서 들어간 화면의 글자가 달라질 수 있다
        // (queries/domestic-order-approvals-pending.ts 의 같은 판단).
        modelName: resolveDomesticOrderValue(row.modelNameText, null),
        dueDate: row.dueDate,
        dueDateRowOrder,
        // 🔴 글자를 지어내지 않는다 — [승인] 탭의 회차 머리·드롭다운·회차별 [완료 처리]
        //    단추·내자 정리 표가 쓰는 그 한 줄이다.
        dueDateRowLabel: multipleRows
          ? domesticOrderDueDateRowLabel(dueDateRowOrder, { dueDate: row.dueDate, note: row.note })
          : null,
      });
    }
  }

  // 가장 급한 회차가 맨 위다(위 머리말). 동점은 줄 id · 회차로 깬다.
  return items.sort(
    (left, right) =>
      left.dueDate.localeCompare(right.dueDate) ||
      left.domesticOrderId.localeCompare(right.domesticOrderId) ||
      left.dueDateRowOrder - right.dueDateRowOrder
  );
}
