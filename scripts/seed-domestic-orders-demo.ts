import "./load-env";

import { createHash } from "node:crypto";
import { asc, eq, sql } from "drizzle-orm";
import { db, pgClient } from "../src/lib/db/connection";
import { customers, domesticOrders, repairCases } from "../src/lib/db/schema";

/**
 * ============================================================================
 * 내자 정리 — 개발 전용 더미 데이터 (DEMO)
 * ============================================================================
 * `npm run seed:domestic-orders`
 *
 * 화면이 실제 자료로 어떻게 보이는지 확인하기 위한 것이다. seed-realistic-demo.ts
 * 와 같은 규칙을 따른다:
 *
 *  - **`import "./load-env";` 가 첫 줄이다.** tsx 는 import 를 전부 위로 끌어
 *    올리므로, 환경변수를 읽는 일이 connection.ts 보다 먼저 일어나려면 그
 *    부수효과가 첫 import 안에 들어 있어야 한다(load-env.ts 주석).
 *  - **dss_as_dev 가 아니면 아무것도 쓰지 않고 멈춘다.** 개발 DB 이름을 직접
 *    확인한다 — DATABASE_URL 을 잘못 가리킨 채 더미를 심는 사고는 되돌릴 수 없다.
 *  - **고정 id + onConflictDoNothing.** 몇 번을 돌려도 행이 늘어나지 않는다.
 *    id 를 defaultRandom 에 맡기면 두 번째 실행이 12건을 또 만든다.
 *
 * ── domestic_orders 외의 표에는 쓰지 않는다 ─────────────────────────────
 * 수리 건도 고객사도 **읽기만 한다.** 지금 개발 DB 에는 손으로 확인해 둔
 * 접수 건과 첨부가 들어 있고, 그것을 흔들지 않는 것이 이 스크립트의 전제다.
 * 그래서 연결할 수리 건은 새로 만들지 않고 **이미 있는 것 중에서 고른다** —
 * 인수번호 순으로 앞에서부터 고르므로 매번 같은 건에 붙는다.
 *
 * ── 일부러 섞어 두는 것들 ───────────────────────────────────────────────
 * 화면은 값이 다 찬 줄보다 **비어 있는 줄에서 먼저 깨진다.** 그래서
 *  - 수리 건 연결이 없는 줄을 2건 넣는다(하나는 고객사만 있고, 하나는 그것도
 *    없다 — 인수번호가 글자로만 남아 있는 줄이다).
 *  - 발주발행일·견적발행일·납품일·금액을 골고루 찬 줄과 빈 줄로 섞는다.
 *  - 입금완료 여부도 섞는다.
 * ============================================================================
 */

const DEV_DATABASE_NAME = "dss_as_dev";

/** 고정 UUID v4. 같은 key 는 언제나 같은 id 를 낸다(seed-realistic-demo.ts 와 같은 방식). */
const id = (key: string) => {
  const h = createHash("sha256")
    .update(`dss-as-seed-dev:domestic-orders-demo:${key}`)
    .digest("hex")
    .slice(0, 32)
    .split("");
  h[12] = "4";
  h[16] = ((parseInt(h[16], 16) & 3) | 8).toString(16);
  const s = h.join("");
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
};

type SeedRow = {
  /** 몇 번째 수리 건에 붙을지. null 이면 연결 없는 줄이다. */
  caseIndex: number | null;
  /** 연결 없는 줄에만 쓴다 — 시트에 적혀 있던 인수번호를 글자로. */
  intakeNumberText?: string;
  /** 연결 없는 줄에서 고객사를 직접 가리킬지. */
  useCustomer?: boolean;
  purchaseOrderNumber: string | null;
  projectName: string | null;
  orderIssuedDate: string | null;
  requestedDueDate: string | null;
  quoteIssuedDate: string | null;
  quoteNumber: string | null;
  progressNote: string | null;
  deliveredDate: string | null;
  deliveredBy: string | null;
  taxInvoiceDate: string | null;
  amountExcludingVat: string | null;
  paymentCompleted: boolean;
  japanRemittanceNote: string | null;
  historyNote: string | null;
  etcNote: string | null;
};

/**
 * 12줄. 발주만 있는 줄부터 입금까지 끝난 줄까지, 시트에서 실제로 보이는
 * 단계들을 한 번씩 지나가게 짰다.
 */
const SEED_ROWS: SeedRow[] = [
  // 1) 전부 찬 줄 — 입금까지 끝났다.
  {
    caseIndex: 0,
    purchaseOrderNumber: "DEMO-PO-2026-001",
    projectName: "DEMO P1 라인 증설",
    orderIssuedDate: "2026-03-04",
    requestedDueDate: "2026-03-25",
    quoteIssuedDate: "2026-03-02",
    quoteNumber: "DEMO-QT-2026-001",
    progressNote: "DEMO 납품 완료, 입금 확인",
    deliveredDate: "2026-03-20",
    deliveredBy: "DEMO 김유진",
    taxInvoiceDate: "2026-03-21",
    amountExcludingVat: "12500000.00",
    paymentCompleted: true,
    japanRemittanceNote: "DEMO 송금 완료",
    historyNote: "DEMO 2026-03-20 납품",
    etcNote: null,
  },
  // 2) 납품·계산서까지 갔는데 입금 전.
  {
    caseIndex: 1,
    purchaseOrderNumber: "DEMO-PO-2026-002",
    projectName: "DEMO P2 정기 수리",
    orderIssuedDate: "2026-03-11",
    requestedDueDate: "2026-04-01",
    quoteIssuedDate: "2026-03-09",
    quoteNumber: "DEMO-QT-2026-002",
    progressNote: "DEMO 입금 대기",
    deliveredDate: "2026-03-28",
    deliveredBy: "DEMO 박서진",
    taxInvoiceDate: "2026-03-30",
    amountExcludingVat: "4300000.00",
    paymentCompleted: false,
    japanRemittanceNote: null,
    historyNote: "DEMO 세금계산서 발행",
    etcNote: "DEMO 결제 조건 60일",
  },
  // 3) 견적만 나가고 발주 전 — 발주 관련 칸이 통째로 비어 있다.
  {
    caseIndex: 2,
    purchaseOrderNumber: null,
    projectName: "DEMO P1 예비품",
    orderIssuedDate: null,
    requestedDueDate: null,
    quoteIssuedDate: "2026-04-06",
    quoteNumber: "DEMO-QT-2026-003",
    progressNote: "DEMO 견적 검토 중",
    deliveredDate: null,
    deliveredBy: null,
    taxInvoiceDate: null,
    amountExcludingVat: "2750000.00",
    paymentCompleted: false,
    japanRemittanceNote: null,
    historyNote: null,
    etcNote: null,
  },
  // 4) 발주는 받았는데 견적·금액이 아직 없다.
  {
    caseIndex: 3,
    purchaseOrderNumber: "DEMO-PO-2026-004",
    projectName: null,
    orderIssuedDate: "2026-04-13",
    requestedDueDate: "2026-05-08",
    quoteIssuedDate: null,
    quoteNumber: null,
    progressNote: "DEMO 수리 진행 중",
    deliveredDate: null,
    deliveredBy: null,
    taxInvoiceDate: null,
    amountExcludingVat: null,
    paymentCompleted: false,
    japanRemittanceNote: null,
    historyNote: null,
    etcNote: "DEMO 부품 입고 대기",
  },
  // 5) 금액이 소수점을 갖는 줄 — 합계가 원 단위로 맞는지 보려는 것이다.
  {
    caseIndex: 4,
    purchaseOrderNumber: "DEMO-PO-2026-005",
    projectName: "DEMO 계측기 교체",
    orderIssuedDate: "2026-04-20",
    requestedDueDate: "2026-05-15",
    quoteIssuedDate: "2026-04-17",
    quoteNumber: "DEMO-QT-2026-005",
    progressNote: "DEMO 납품 완료",
    deliveredDate: "2026-05-11",
    deliveredBy: "DEMO 김유진",
    taxInvoiceDate: "2026-05-12",
    amountExcludingVat: "1999999.99",
    paymentCompleted: true,
    japanRemittanceNote: null,
    historyNote: "DEMO 부분 납품 후 잔여 출하",
    etcNote: null,
  },
  // 6) 메모 칸이 전부 비어 있는 줄.
  {
    caseIndex: 5,
    purchaseOrderNumber: "DEMO-PO-2026-006",
    projectName: "DEMO P3 신규",
    orderIssuedDate: "2026-05-04",
    requestedDueDate: "2026-05-29",
    quoteIssuedDate: "2026-05-01",
    quoteNumber: "DEMO-QT-2026-006",
    progressNote: null,
    deliveredDate: null,
    deliveredBy: null,
    taxInvoiceDate: null,
    amountExcludingVat: "8800000.00",
    paymentCompleted: false,
    japanRemittanceNote: null,
    historyNote: null,
    etcNote: null,
  },
  // 7) 일본 송금까지 있는 줄.
  {
    caseIndex: 6,
    purchaseOrderNumber: "DEMO-PO-2026-007",
    projectName: "DEMO 본사 수리 의뢰",
    orderIssuedDate: "2026-05-12",
    requestedDueDate: "2026-06-19",
    quoteIssuedDate: "2026-05-08",
    quoteNumber: "DEMO-QT-2026-007",
    progressNote: "DEMO 본사 수리 후 반입",
    deliveredDate: "2026-06-15",
    deliveredBy: "DEMO 이도현",
    taxInvoiceDate: "2026-06-16",
    amountExcludingVat: "23400000.00",
    paymentCompleted: true,
    japanRemittanceNote: "DEMO 2026-06-25 송금 예정",
    historyNote: "DEMO 본사 이관 → 반입 완료",
    etcNote: null,
  },
  // 8) 납품은 했는데 계산서 전.
  {
    caseIndex: 7,
    purchaseOrderNumber: "DEMO-PO-2026-008",
    projectName: null,
    orderIssuedDate: "2026-06-02",
    requestedDueDate: "2026-06-26",
    quoteIssuedDate: "2026-05-29",
    quoteNumber: "DEMO-QT-2026-008",
    progressNote: "DEMO 계산서 발행 예정",
    deliveredDate: "2026-06-23",
    deliveredBy: "DEMO 박서진",
    taxInvoiceDate: null,
    amountExcludingVat: "5600000.00",
    paymentCompleted: false,
    japanRemittanceNote: null,
    historyNote: null,
    etcNote: null,
  },
  // 9) 순번은 있는데 거의 다 빈 줄 — 방금 적기 시작한 줄이다.
  {
    caseIndex: 8,
    purchaseOrderNumber: null,
    projectName: null,
    orderIssuedDate: null,
    requestedDueDate: null,
    quoteIssuedDate: null,
    quoteNumber: null,
    progressNote: "DEMO 접수만 됨",
    deliveredDate: null,
    deliveredBy: null,
    taxInvoiceDate: null,
    amountExcludingVat: null,
    paymentCompleted: false,
    japanRemittanceNote: null,
    historyNote: null,
    etcNote: null,
  },
  // 10) 금액이 큰 줄 — 자릿수 정렬을 눈으로 확인하기 위한 것이다.
  {
    caseIndex: 9,
    purchaseOrderNumber: "DEMO-PO-2026-010",
    projectName: "DEMO 연간 계약",
    orderIssuedDate: "2026-06-15",
    requestedDueDate: "2026-07-31",
    quoteIssuedDate: "2026-06-10",
    quoteNumber: "DEMO-QT-2026-010",
    progressNote: "DEMO 분할 납품 진행",
    deliveredDate: "2026-07-24",
    deliveredBy: "DEMO 김유진",
    taxInvoiceDate: "2026-07-25",
    amountExcludingVat: "157000000.00",
    paymentCompleted: true,
    japanRemittanceNote: null,
    historyNote: "DEMO 1차/2차 분할",
    etcNote: "DEMO 연간 단가 적용",
  },
  // 11) **수리 건 연결 없음** — 고객사만 있다. 수리 없이 납품만 있는 줄.
  {
    caseIndex: null,
    intakeNumberText: "DEMO-미연결-2601",
    useCustomer: true,
    purchaseOrderNumber: "DEMO-PO-2026-011",
    projectName: "DEMO 소모품 납품",
    orderIssuedDate: "2026-07-06",
    requestedDueDate: "2026-07-20",
    quoteIssuedDate: "2026-07-02",
    quoteNumber: "DEMO-QT-2026-011",
    progressNote: "DEMO 수리 없이 납품만",
    deliveredDate: "2026-07-17",
    deliveredBy: "DEMO 이도현",
    taxInvoiceDate: "2026-07-18",
    amountExcludingVat: "980000.00",
    paymentCompleted: true,
    japanRemittanceNote: null,
    historyNote: null,
    etcNote: "DEMO 접수 건 없음",
  },
  // 12) **수리 건도 고객사도 없음** — 인수번호가 글자로만 남아 있는 줄.
  //     화면에서 고객사가 "-"로 나오는지 확인하는 자리다.
  {
    caseIndex: null,
    intakeNumberText: "DEMO-미연결-2602",
    useCustomer: false,
    purchaseOrderNumber: null,
    projectName: null,
    orderIssuedDate: "2026-07-27",
    requestedDueDate: null,
    quoteIssuedDate: null,
    quoteNumber: null,
    progressNote: "DEMO 인수번호만 확인됨 — 접수 건 확인 필요",
    deliveredDate: null,
    deliveredBy: null,
    taxInvoiceDate: null,
    amountExcludingVat: null,
    paymentCompleted: false,
    japanRemittanceNote: null,
    historyNote: null,
    etcNote: null,
  },
];

async function main() {
  const identity = await db.execute(sql`select current_database() as name`);
  if (identity[0]?.name !== DEV_DATABASE_NAME) {
    throw new Error(`DEV safety gate failed: database is not ${DEV_DATABASE_NAME}`);
  }

  // 읽기만 한다. 인수번호 순으로 앞에서부터 골라야 매번 같은 건에 붙는다.
  const linkTargets = await db
    .select({ id: repairCases.id, intakeNumber: repairCases.intakeNumber })
    .from(repairCases)
    .where(eq(repairCases.isDeleted, false))
    .orderBy(asc(repairCases.intakeNumber))
    .limit(10);

  const neededCases = SEED_ROWS.filter((row) => row.caseIndex !== null).length;
  if (linkTargets.length < neededCases) {
    throw new Error(
      `연결할 접수 건이 모자랍니다: ${neededCases}건 필요, ${linkTargets.length}건 존재. 아무것도 쓰지 않았습니다.`
    );
  }

  const [fallbackCustomer] = await db
    .select({ id: customers.id, name: customers.name })
    .from(customers)
    .where(eq(customers.isDeleted, false))
    .orderBy(asc(customers.name))
    .limit(1);

  if (!fallbackCustomer) {
    throw new Error("활성 고객사가 하나도 없습니다. 아무것도 쓰지 않았습니다.");
  }

  const rows = SEED_ROWS.map((row, index) => ({
    id: id(`row:${index + 1}`),
    repairCaseId: row.caseIndex === null ? null : linkTargets[row.caseIndex].id,
    intakeNumberText: row.intakeNumberText ?? null,
    // 연결이 있는 줄은 customer_id 를 비워 둔다 — 조회가 수리 건의 고객사를
    // 따라가므로(queries/domestic-orders.ts 의 coalesce), 여기 또 적으면 두
    // 벌이 생겨 어긋날 수 있다.
    customerId: row.useCustomer ? fallbackCustomer.id : null,
    displayOrder: index + 1,
    purchaseOrderNumber: row.purchaseOrderNumber,
    projectName: row.projectName,
    orderIssuedDate: row.orderIssuedDate,
    requestedDueDate: row.requestedDueDate,
    quoteIssuedDate: row.quoteIssuedDate,
    quoteNumber: row.quoteNumber,
    progressNote: row.progressNote,
    deliveredDate: row.deliveredDate,
    deliveredBy: row.deliveredBy,
    taxInvoiceDate: row.taxInvoiceDate,
    amountExcludingVat: row.amountExcludingVat,
    paymentCompleted: row.paymentCompleted,
    japanRemittanceNote: row.japanRemittanceNote,
    historyNote: row.historyNote,
    etcNote: row.etcNote,
  }));

  // 고정 id + onConflictDoNothing — 다시 돌려도 12건 그대로다.
  // domestic_orders 말고는 어떤 표에도 쓰지 않는다.
  await db.insert(domesticOrders).values(rows).onConflictDoNothing();

  const verification = await db.execute(sql`
    select
      (select count(*)::int from domestic_orders) as total_rows,
      (select count(*)::int from domestic_orders where repair_case_id is null) as unlinked_rows,
      (select count(*)::int from domestic_orders where payment_completed) as paid_rows,
      (select count(*)::int from domestic_orders where amount_excluding_vat is null) as rows_without_amount,
      (select count(*)::int from domestic_orders where order_issued_date is null) as rows_without_order_date
  `);

  console.log(`내자 정리 DEMO seed: ${rows.length}건 (연결 ${neededCases}건 / 미연결 ${rows.length - neededCases}건)`);
  console.log("연결한 접수 건:", linkTargets.slice(0, neededCases).map((target) => target.intakeNumber).join(", "));
  console.log("DEMO verification:", JSON.stringify(verification[0]));
}

main()
  .then(async () => {
    await pgClient.end({ timeout: 5 });
    process.exit(0);
  })
  .catch(async (error) => {
    console.error("내자 정리 DEMO seed 실패:", error instanceof Error ? error.message : String(error));
    await pgClient.end({ timeout: 5 });
    process.exit(1);
  });
