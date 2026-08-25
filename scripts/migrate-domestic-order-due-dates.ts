import "./load-env";

import { inArray, isNotNull } from "drizzle-orm";
import { db, pgClient } from "../src/lib/db/connection";
import { domesticOrderDueDates, domesticOrders } from "../src/lib/db/schema";

/**
 * ============================================================================
 * 내자 정리 — 납기요청일을 딸린 표로 옮긴다 (한 번만 돌리는 스크립트)
 * ============================================================================
 * domestic_orders.requested_due_date 에 들어 있는 날짜 하나를
 * domestic_order_due_dates 의 행 하나로 옮긴다. 새 표가 생긴 이유와 CASCADE 를
 * 고른 이유는 schema/domestic-order-due-dates.ts 헤더에 있다.
 *
 * ── 이 스크립트가 하지 않는 일 ──────────────────────────────────────────
 * 1. **domestic_orders 를 고치지 않는다.** requested_due_date 를 비우지 않는다 —
 *    옮긴 값의 원본이 남아 있어야, 옮기다 놓친 줄이 있어도 대조할 곳이 있다.
 *    그 칸을 지우는 일은 새 표를 실제로 써 보고 난 뒤의 별도 단계다.
 * 2. **domestic_order_due_dates 말고는 어떤 표에도 쓰지 않는다.**
 *
 * ── 여러 번 돌려도 안 늘어난다 ──────────────────────────────────────────
 * 그 줄에 날짜가 **하나라도** 있으면 건너뛴다. "requested_due_date 와 같은
 * 날짜가 있는가"로 보지 않는 이유: 옮긴 뒤에 사람이 그 날짜를 고쳤을 수 있고,
 * 그때 같은 값이 없다고 다시 넣으면 사람이 고친 목록에 옛 날짜가 되살아난다.
 * 이미 손댄 줄은 건드리지 않는 것이 맞다.
 *
 * ── 지워진 줄도 함께 옮긴다 ─────────────────────────────────────────────
 * is_deleted 로 거르지 않는다. 소프트 삭제는 자료를 지우는 것이 아니라 감추는
 * 것이라, 되살렸을 때 날짜만 없는 줄이 되면 안 된다.
 *
 * ── 돌리는 법 ───────────────────────────────────────────────────────────
 *   npm run migrate:due-dates -- --dry-run   무엇을 만들지 세어 보기만 한다
 *   npm run migrate:due-dates                실제로 옮긴다
 *
 * 한 트랜잭션 안에서 "이미 있는가"를 보고 넣는다 — 나눠 놓으면 그 사이에 누가
 * 저장한 날짜를 못 보고 한 번 더 넣게 된다.
 * ============================================================================
 */

type Summary = {
  /** requested_due_date 에 값이 있는 줄. */
  candidates: number;
  /** 실제로 만든(또는 dry-run 에서 만들 예정인) 행. */
  created: number;
  /** 이미 날짜가 있어 건너뛴 줄. */
  skippedExisting: number;
};

const isDryRun = process.argv.includes("--dry-run");

async function main(): Promise<Summary> {
  return db.transaction(async (tx): Promise<Summary> => {
    // 1. 옮길 후보 — requested_due_date 에 값이 있는 모든 줄.
    const candidates = await tx
      .select({ id: domesticOrders.id, requestedDueDate: domesticOrders.requestedDueDate })
      .from(domesticOrders)
      .where(isNotNull(domesticOrders.requestedDueDate));

    if (candidates.length === 0) {
      return { candidates: 0, created: 0, skippedExisting: 0 };
    }

    // 2. 그중 이미 날짜가 하나라도 있는 줄 — 건너뛸 대상이다.
    const existing = await tx
      .select({ domesticOrderId: domesticOrderDueDates.domesticOrderId })
      .from(domesticOrderDueDates)
      .where(
        inArray(
          domesticOrderDueDates.domesticOrderId,
          candidates.map((row) => row.id)
        )
      );
    const alreadyHasDueDate = new Set(existing.map((row) => row.domesticOrderId));

    const toCreate = candidates.filter((row) => !alreadyHasDueDate.has(row.id));
    const skippedExisting = candidates.length - toCreate.length;

    console.log(`  옮길 줄: ${toCreate.length}개 (requested_due_date 있는 줄 ${candidates.length}개)`);
    console.log(`  이미 있어 건너뜀: ${skippedExisting}개`);

    if (isDryRun) {
      console.log("  --dry-run — 아무것도 쓰지 않았습니다.");
      return { candidates: candidates.length, created: toCreate.length, skippedExisting };
    }

    if (toCreate.length === 0) {
      return { candidates: candidates.length, created: 0, skippedExisting };
    }

    const inserted = await tx
      .insert(domesticOrderDueDates)
      .values(
        toCreate.map((row) => ({
          domesticOrderId: row.id,
          // requested_due_date 가 NOT NULL 인 줄만 골라 왔으므로 여기서
          // null 이 될 수 없다. 타입만 좁힌다.
          dueDate: row.requestedDueDate as string,
          // 옮긴 날짜는 그 줄의 첫 번째 납기일이다.
          displayOrder: 1,
        }))
      )
      .returning({ id: domesticOrderDueDates.id });

    return { candidates: candidates.length, created: inserted.length, skippedExisting };
  });
}

main()
  .then(async (summary) => {
    console.log(
      `  결과 — 옮길 줄 ${summary.candidates - summary.skippedExisting}개 / ` +
        `만든 행 ${summary.created}개 / 이미 있어 건너뜀 ${summary.skippedExisting}개`
    );
    await pgClient.end({ timeout: 5 });

    // 세어 본 수와 실제로 만든 수가 다르면 조용히 넘기지 않는다 — 옮기다 만
    // 상태를 성공으로 보고하면 아무도 다시 보지 않는다.
    const expected = summary.candidates - summary.skippedExisting;
    if (summary.created !== expected) {
      console.error(`  어긋남: ${expected}개를 만들어야 하는데 ${summary.created}개를 만들었습니다.`);
      process.exit(1);
    }
    process.exit(0);
  })
  .catch(async (err) => {
    // 값은 담지 않는다 — note 에 담당자 이름이 섞일 수 있다(스키마의 PII 항목).
    console.error("옮기기 실패:", err instanceof Error ? err.message : String(err));
    await pgClient.end({ timeout: 5 });
    process.exit(1);
  });
