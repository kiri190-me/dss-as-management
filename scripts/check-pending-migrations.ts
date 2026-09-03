import "./load-env";

import fs from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import { db, pgClient } from "../src/lib/db/connection";
import { findDestructiveOperations, describeOperation, type DestructiveOperation } from "../src/lib/db/migration-safety";
import {
  classifyDbConnectionFailure,
  describeDbConnectionFailure,
} from "./lib/db-connection-failure";

/**
 * ============================================================================
 * 적용 전 점검 — 이 DB에 무엇이 적용될 예정이고, 그중 무엇이 자료를 지우는가
 * ============================================================================
 * `npm run db:migrate`를 누르기 **전에** 돌린다. DATABASE_URL이 가리키는 DB를
 * 그대로 본다(운영에 배포한다면 그 DB를 가리킨 채 이걸 먼저 돌리면 된다).
 *
 * 하는 일은 셋이다.
 *  1. 아직 적용되지 않은 마이그레이션이 무엇인지 센다.
 *  2. 그중 자료를 지우는 문장을 찾는다(표 삭제·열 삭제·TRUNCATE·DELETE).
 *  3. 그 대상에 **지금 자료가 몇 줄 들어 있는지** 실제로 세어 보여 준다.
 *
 * 자료가 걸려 있으면 종료 코드 1로 끝난다 — CI나 배포 스크립트에 물리면 사람이
 * 보기 전에는 넘어가지 않는다.
 *
 * ── 세기 전에 접속부터 확인한다 ─────────────────────────────────────────
 * 2026-09-02에 이 스크립트가 "처음 적용하는 DB로 보입니다 / 적용 대기 80건"이라고
 * 보고했다. 실제로는 80건이 전부 적용된 DB였고, 개발 DB 컨테이너가 꺼져 있었을
 * 뿐이다. 적용 기록을 읽는 질의를 try/catch로 감싸 두고 **"기록 표가 없다"와
 * "접속조차 못 했다"를 같은 답(null)으로 뭉갠** 탓이었다. 이 오보를 믿고
 * 마이그레이션을 다시 부으면 운영 자료가 위험하다.
 *
 * 그래서 이제 세 가지 일에 앞서 `select 1`로 접속을 확인한다. 여기서 실패하면
 * 개수를 세지 않고 안내 문구만 내고 **종료 코드 2**로 멈춘다. "기록 표가 없다"는
 * 판단은 오류를 삼켜서가 아니라 to_regclass로 표의 유무를 직접 물어서 내린다.
 *
 * ── 왜 만들었나 ─────────────────────────────────────────────────────────
 * 2026-08-19에 Excel 이관 기능을 걷어내며 표 3개를 지웠다. 그때는 "이 표에
 * 자료가 얼마나 있나"를 사람이 손으로 확인했고, 다음 사람이 그 절차를 기억하고
 * 있으리라는 보장이 없었다. 기억 대신 도구에 맡긴 것이 이 파일이다.
 *
 * ── 읽기만 한다 ─────────────────────────────────────────────────────────
 * 세는 것 말고는 아무것도 하지 않는다. DATABASE_URL은 출력하지 않는다.
 * ============================================================================
 */

type JournalEntry = { idx: number; when: number; tag: string };

const DRIZZLE_DIR = path.join(process.cwd(), "drizzle");

function readJournal(): JournalEntry[] {
  const raw = fs.readFileSync(path.join(DRIZZLE_DIR, "meta", "_journal.json"), "utf8");
  const parsed = JSON.parse(raw) as { entries: JournalEntry[] };
  return parsed.entries;
}

/**
 * 접속이 되는지만 확인한다. 아무 표에도 기대지 않는 가장 가벼운 질의라,
 * 실패했다면 그것은 "DB의 상태"가 아니라 "DB에 닿지 못했다"는 뜻이다.
 * 이 구분이 이 스크립트 전체의 전제다.
 */
async function ensureConnected(): Promise<void> {
  await db.execute(sql`select 1`);
}

/**
 * 적용 기록 표가 이 DB에 있는가.
 *
 * to_regclass는 **없는 스키마·표에 대해 오류 대신 NULL을 돌려준다.** 그래서
 * 표의 유무를 오류를 삼키지 않고 값으로 물을 수 있다. 예전처럼 select를 던져
 * 보고 catch로 판단하면, 접속 실패·권한 오류·연결 끊김까지 전부 "표가 없다"로
 * 뭉개진다.
 */
async function migrationsTableExists(): Promise<boolean> {
  const rows = await db.execute<{ present: boolean }>(
    sql`select to_regclass('drizzle.__drizzle_migrations') is not null as present`
  );
  return [...rows][0]?.present === true;
}

/**
 * 이미 적용된 마이그레이션의 시각들. 표가 없으면 null — 그때만 "아직 한 번도
 * 마이그레이션되지 않은 DB"다.
 *
 * 표가 있는데 읽다가 나는 오류는 **삼키지 않고 그대로 위로 올린다.** 여기서
 * 조용히 null을 돌려주면 다시 그 옛 오보("적용 대기 80건")로 돌아간다.
 */
async function readAppliedTimestamps(): Promise<Set<number> | null> {
  if (!(await migrationsTableExists())) return null;

  const rows = await db.execute<{ created_at: string | number }>(
    sql`select created_at from drizzle."__drizzle_migrations"`
  );
  return new Set([...rows].map((row) => Number(row.created_at)));
}

/** 식별자에 코드가 섞여 들어오지 못하게 한다 — 이름은 SQL로 조립되기 때문이다. */
function isSafeIdentifier(name: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name);
}

async function tableExists(table: string): Promise<boolean> {
  const rows = await db.execute<{ n: number }>(
    sql`select count(*)::int as n from information_schema.tables
        where table_schema = 'public' and table_name = ${table}`
  );
  return Number([...rows][0]?.n ?? 0) > 0;
}

async function countRows(table: string): Promise<number> {
  const rows = await db.execute<{ n: number }>(sql.raw(`select count(*)::int as n from "${table}"`));
  return Number([...rows][0]?.n ?? 0);
}

async function countNonNull(table: string, column: string): Promise<number> {
  const rows = await db.execute<{ n: number }>(
    sql.raw(`select count("${column}")::int as n from "${table}"`)
  );
  return Number([...rows][0]?.n ?? 0);
}

/** 이 조작으로 실제로 사라질 자료의 양. 대상이 이미 없으면 null. */
async function measure(op: DestructiveOperation): Promise<number | null> {
  if (op.kind === "DROP_SCHEMA") return null;

  const table = op.kind === "DROP_COLUMN" ? op.table : op.table;
  if (!isSafeIdentifier(table)) return null;
  if (!(await tableExists(table))) return null;

  if (op.kind === "DROP_COLUMN") {
    if (!isSafeIdentifier(op.column)) return null;
    return countNonNull(op.table, op.column);
  }
  return countRows(table);
}

async function main() {
  // 개수를 세기 전에 접속부터 확인한다. 닿지 못한 DB를 "비어 있다"고 잘못
  // 보고하지 않기 위해서다(파일 머리말 참조).
  try {
    await ensureConnected();
  } catch (error) {
    console.error(describeDbConnectionFailure(error));
    console.error(
      "\n접속하지 못했으므로 마이그레이션 개수는 세지 않았습니다." +
        "\n이 상태를 '처음 적용하는 DB'로 읽어 마이그레이션을 다시 부으면 안 됩니다."
    );
    return 2;
  }

  const journal = readJournal();
  const applied = await readAppliedTimestamps();

  if (applied === null) {
    console.log("이 DB에는 마이그레이션 기록이 없습니다 — 처음 적용하는 DB로 보입니다.");
  }

  const pending = applied === null ? journal : journal.filter((entry) => !applied.has(entry.when));

  console.log(`전체 마이그레이션 ${journal.length}건 · 적용 대기 ${pending.length}건`);

  if (pending.length === 0) {
    console.log("\n적용할 것이 없습니다. 이 DB는 최신입니다.");
    return 0;
  }

  let atRisk = 0;

  for (const entry of pending) {
    const file = path.join(DRIZZLE_DIR, `${entry.tag}.sql`);
    if (!fs.existsSync(file)) {
      console.log(`\n[${entry.tag}] SQL 파일을 찾을 수 없습니다 — 확인이 필요합니다.`);
      atRisk += 1;
      continue;
    }

    const operations = findDestructiveOperations(fs.readFileSync(file, "utf8"));
    if (operations.length === 0) {
      console.log(`\n[${entry.tag}] 더하기만 합니다 — 사라지는 자료 없음`);
      continue;
    }

    console.log(`\n[${entry.tag}] 지우는 문장 ${operations.length}건`);
    for (const op of operations) {
      const amount = await measure(op);
      if (amount === null) {
        console.log(`  · ${describeOperation(op)} — 대상이 이 DB에 없음(사라질 자료 없음)`);
      } else if (amount === 0) {
        console.log(`  · ${describeOperation(op)} — 비어 있음`);
      } else {
        console.log(`  · ${describeOperation(op)} — ⚠ ${amount.toLocaleString("ko-KR")}건이 사라집니다`);
        atRisk += 1;
      }
    }
  }

  if (atRisk > 0) {
    console.log(
      `\n⚠ 사라질 자료가 있는 항목 ${atRisk}건입니다.` +
        `\n   적용하기 전에 백업하거나, 지워도 되는 자료인지 확인하세요.` +
        `\n   백업 예: docker exec <컨테이너> pg_dump -U <사용자> -d <DB> -t <표이름> > backup.sql`
    );
    return 1;
  }

  console.log("\n사라지는 자료 없이 적용할 수 있습니다.");
  return 0;
}

main()
  .then(async (code) => {
    await pgClient.end({ timeout: 5 });
    process.exit(code);
  })
  .catch(async (err) => {
    // 점검 도중(예: 적용 기록을 읽다가) 연결이 끊긴 경우에도 접속 문제라고
    // 말해 준다. 접속 문제로 알아보지 못한 오류만 message를 그대로 보여 준다
    // — 접속 오류의 message에는 접속 문자열이 섞여 나올 수 있어서다.
    if (classifyDbConnectionFailure(err) === "UNKNOWN") {
      console.error("점검에 실패했습니다:", err instanceof Error ? err.message : err);
    } else {
      console.error("점검에 실패했습니다.");
      console.error(describeDbConnectionFailure(err));
    }
    await pgClient.end({ timeout: 5 }).catch(() => {});
    process.exit(2);
  });
