import "./load-env";

import { asc, eq, sql } from "drizzle-orm";

import { db, pgClient } from "../src/lib/db/connection";
import { repairCaseUsedParts, repairCases } from "../src/lib/db/schema";
import { hasJapaneseCharacter } from "../src/lib/kyosan/report-terms";
import { translateKyosanSentence } from "../src/lib/kyosan/report-word-terms";

/**
 * ============================================================================
 * 이미 들어간 사용 부품 품명을 한글로 되돌린다 (2026-09-23 사용자 결정)
 * ============================================================================
 * 연락서 이식이 `repair_case_used_parts.part_name_text` 에 **일본어를 그대로** 넣어
 * 왔다(사용자가 수리 건 상세의 「사용 부품」 표에서 잡아냈다). 넣는 쪽은 고쳤다 —
 * `server/services/kyosan-report-import.ts` 의 `appendUsedParts` 가 이제
 * `translateKyosanSentence` 를 지나 저장한다. 이 스크립트는 **그 고침 이전에 들어간
 * 줄**을 같은 규칙으로 맞춘다.
 *
 * ── 🔴 `--apply` 없이는 DB 에 한 글자도 쓰지 않는다 ─────────────────────
 * 기본 동작은 **읽기 전용(dry-run)** 이다. 「전: … → 후: …」 목록과 세어 본 수만
 * 찍는다. `UPDATE` 는 **`--apply` 를 주었을 때만** 돈다.
 *
 *     npx tsx scripts/backfill-used-parts-korean.ts            ← 읽기만 (기본)
 *     npx tsx scripts/backfill-used-parts-korean.ts --apply    ← 실제로 고친다
 *
 * ── 🔴 백업 ─────────────────────────────────────────────────────────────
 * 이 표의 백업이 `C:\Users\희만\Desktop\_백업\2026-09-23-사용부품\` 에 있다
 * (SQL 7줄 + CSV 7줄, 2026-09-23 실측 시점). 되돌려야 하면 거기서 꺼낸다.
 *
 * ── 무엇을 고치고 무엇을 안 고치나 ──────────────────────────────────────
 *   · 고친다 — `translateKyosanSentence` 가 **한글을 내놓는** 줄만.
 *   · 안 고친다 — 사전이 모르는 일본어 줄(`null` 이 온다). `translateKyosanSentence`
 *     는 **all-or-nothing** 이라 바꾼 결과에 일본어가 한 글자라도 남으면 `null` 을
 *     돌려준다. 그래서 반쪽짜리 글자가 고객 기록에 들어갈 길이 없다.
 *   · 안 고친다 — 이미 한글인 줄, 사람이 손으로 적은 줄. 일본어가 없으면 그 함수가
 *     `null` 을 돌려주므로 자동으로 걸러진다.
 *
 * 🔴 **`part_name_text` 말고 다른 칸은 건드리지 않는다.** `part_id` · `line_no` ·
 * `quantity` · `created_at` · `updated_at` 은 그대로다 — 이것은 자료를 옮기는 일이
 * 아니라 **같은 부품의 표기를 맞추는 일**이라 「언제 고쳤나」를 남길 자리가 아니다
 * (남길 자리는 이 스크립트의 출력과 위 백업이다).
 *
 * 🔴 `--apply` 는 **한 트랜잭션**이다. 중간에 한 줄이라도 실패하면 전부 되돌아간다 —
 * 절반만 한글이 된 표가 남지 않는다.
 *
 * 멱등하다. 두 번 돌려도 두 번째는 고칠 줄이 없다(한글이 된 줄은 일본어가 없어
 * `null` 로 떨어진다).
 * ============================================================================
 */

const APPLY = process.argv.includes("--apply");

type UsedPartRow = {
  id: string;
  intakeNumber: string | null;
  lineNo: number;
  partNameText: string;
};

async function main() {
  const identity = await db.execute(sql`select current_database() as name`);
  const dbName = (identity[0] as { name?: string } | undefined)?.name;
  console.log(`대상 DB: ${String(dbName)} / 모드: ${APPLY ? "APPLY (쓰기)" : "DRY RUN (읽기 전용)"}`);
  if (!APPLY) {
    console.log("🔴 `--apply` 를 주지 않았으므로 DB 에 한 글자도 쓰지 않습니다.");
  }
  console.log("");

  const rows: UsedPartRow[] = await db
    .select({
      id: repairCaseUsedParts.id,
      intakeNumber: repairCases.intakeNumber,
      lineNo: repairCaseUsedParts.lineNo,
      partNameText: repairCaseUsedParts.partNameText,
    })
    .from(repairCaseUsedParts)
    .leftJoin(repairCases, eq(repairCases.id, repairCaseUsedParts.repairCaseId))
    .orderBy(asc(repairCases.intakeNumber), asc(repairCaseUsedParts.lineNo));

  const changes: { row: UsedPartRow; next: string }[] = [];
  const untouchedJapanese: UsedPartRow[] = [];
  const untouchedOther: UsedPartRow[] = [];

  for (const row of rows) {
    const next = translateKyosanSentence(row.partNameText);
    if (next !== null && next !== row.partNameText) {
      changes.push({ row, next });
      continue;
    }
    // 🔴 안 바뀌는 줄도 **왜** 안 바뀌는지 갈라 센다 — 사전에 무엇이 모자란지가 여기서 보인다.
    if (hasJapaneseCharacter(row.partNameText)) untouchedJapanese.push(row);
    else untouchedOther.push(row);
  }

  console.log(`전체 ${rows.length}줄`);
  console.log(`  · 바꿀 줄            ${changes.length}`);
  console.log(`  · 사전이 모르는 일본어 ${untouchedJapanese.length}  ← 원문 그대로 둔다(all-or-nothing)`);
  console.log(`  · 이미 한글·그 밖    ${untouchedOther.length}`);
  console.log("");

  if (changes.length > 0) {
    console.log("=== 바꿀 줄 ===");
    for (const { row, next } of changes) {
      const 자리 = `${row.intakeNumber ?? "(건 없음)"} #${row.lineNo}`;
      console.log(`  ${자리}`);
      console.log(`    전: ${row.partNameText}`);
      console.log(`    후: ${next}`);
    }
    console.log("");
  }

  if (untouchedJapanese.length > 0) {
    console.log("=== 그대로 두는 일본어 줄 (사전에 없다) ===");
    for (const row of untouchedJapanese) {
      console.log(`  ${row.intakeNumber ?? "(건 없음)"} #${row.lineNo}  ${row.partNameText}`);
    }
    console.log("");
  }

  if (!APPLY) {
    console.log("DRY RUN 이므로 여기서 멈춥니다. 실제로 고치려면 `--apply` 를 주세요.");
    await pgClient.end({ timeout: 5 });
    return;
  }

  if (changes.length === 0) {
    console.log("고칠 줄이 없습니다.");
    await pgClient.end({ timeout: 5 });
    return;
  }

  // 🔴 한 트랜잭션. 한 줄이라도 실패하면 전부 되돌아간다.
  let updated = 0;
  await db.transaction(async (tx) => {
    for (const { row, next } of changes) {
      // 🔴 `part_name_text` 한 칸만 바꾼다.
      const result = await tx
        .update(repairCaseUsedParts)
        .set({ partNameText: next })
        .where(eq(repairCaseUsedParts.id, row.id))
        .returning({ id: repairCaseUsedParts.id });
      if (result.length !== 1) {
        throw new Error(`줄 ${row.id} 을 못 찾았습니다 — 트랜잭션을 되돌립니다.`);
      }
      updated += 1;
    }
  });

  console.log(`=== 결과 ===`);
  console.log(`${updated}줄을 한글로 바꿨습니다.`);

  const left = await db
    .select({ partNameText: repairCaseUsedParts.partNameText })
    .from(repairCaseUsedParts);
  const stillJapanese = left.filter((row) => hasJapaneseCharacter(row.partNameText)).length;
  console.log(`남은 일본어 줄: ${stillJapanese} (사전이 모르는 것만 남아야 합니다)`);

  await pgClient.end({ timeout: 5 });
}

main();
