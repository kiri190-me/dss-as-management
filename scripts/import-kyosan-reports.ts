import "./load-env";

import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { sql } from "drizzle-orm";

import { db, pgClient } from "../src/lib/db/connection";
import {
  collectKyosanWorkbookPaths,
  formatKyosanRunSummary,
  resolveKyosanImportActorUserId,
  runKyosanReportImport,
} from "./lib/kyosan-import-run";

/**
 * ============================================================================
 * 교산 연락서를 **한 회차로 몰아 넣는다** (조각 S5-C, 2026-09-28)
 * ============================================================================
 *
 *   node --conditions=react-server --import tsx scripts/import-kyosan-reports.ts \
 *     --dir "<폴더>" [--dir "<폴더>"] [--file "<파일>"] [--limit 10] \
 *     [--out "<저장소 밖 기록 JSON>"] [--actor <사용자 id>] [--today 2026-09-28]
 *
 *   … 그리고 사람이 계획을 읽고 승인한 뒤에만:
 *
 *   node --conditions=react-server --import tsx scripts/import-kyosan-reports.ts \
 *     --dir "<폴더>" --apply --out "<저장소 밖 기록 JSON>"
 *
 * (`--conditions=react-server` 가 있어야 이식기 쪽 `server-only` 가 풀린다 —
 *  `scripts/match-kyosan-reports.ts` 와 같다.)
 *
 * ── 🔴 `--apply` 가 없으면 한 글자도 쓰지 않는다 ────────────────────────
 * 기본은 **계획 출력**이다. 한 장씩 「넣을 수 있음 / 이미 있음 / 짝 없음 / 문서
 * 아님 / 못 읽음」을 찍고 갈래별로 세어 끝낸다. 실제로 넣는 것은 사람이 그 표를
 * 읽고 `--apply` 를 붙였을 때뿐이다.
 *
 * ── 🔴 되돌릴 수 있어야 넣는다 ──────────────────────────────────────────
 * `--apply` 는 회차 번호(`importBatchId`)를 하나 만들어 **모든 장에 같은 값**으로
 * 싣는다. 그 번호 하나로 회차 전체를 되짚는다:
 *
 *   npx tsx scripts/revert-kyosan-import.ts --batch <회차 번호>          ← 계획만
 *   npx tsx scripts/revert-kyosan-import.ts --batch <회차 번호> --apply
 *
 * 그래서 회차 번호를 **맨 처음과 맨 끝에** 찍는다 — 사람이 받아 적어야 한다.
 *
 * ── 🔴 수리 건을 만들지 않는다 ──────────────────────────────────────────
 * 사용자 정책(2026-09-21): 「이미 수리 건이 등록된 경우에만 이식한다」. 짝이 없는
 * 연락서는 **건너뛴다** — 그것이 정상이고 실패가 아니다. 개발 DB 에는 503장이
 * 가리키는 과거 수리 건이 거의 없어 대부분이 「짝 없음」으로 떨어진다.
 *
 * ── 🔴 기록 JSON 은 저장소 밖에만 ───────────────────────────────────────
 * 기록에는 원본 **파일 이름**이 들어간다(503장 가운데 어느 장이었는지 짚을 유일한
 * 손잡이다). 연락서 파일 이름에는 모델·S/N 이 섞일 수 있으므로 `--out` 이 저장소
 * 안을 가리키면 거부한다(`scripts/match-kyosan-reports.ts` 와 같은 규칙).
 *
 * ── 고르는 규칙과 도는 일이 갈라져 있다 ─────────────────────────────────
 *   · `scripts/lib/kyosan-import-run-plan.ts` — 순수 함수(가려내는·세는 규칙)
 *   · `scripts/lib/kyosan-import-run.ts`      — DB · 디스크 · 이식기 부르기
 *   · 이 파일                                  — 명령줄 껍데기
 * ============================================================================
 */

type Options = {
  dirs: string[];
  files: string[];
  apply: boolean;
  limit: number | null;
  outPath: string | null;
  actorUserId: string | null;
  today: string | null;
};

const USAGE = [
  "쓰는 법:",
  '  node --conditions=react-server --import tsx scripts/import-kyosan-reports.ts \\',
  '    --dir "<폴더>" [--dir "<폴더>"] [--file "<파일>"] [--limit <수>] \\',
  '    [--out "<저장소 밖 기록 JSON>"] [--actor <사용자 id>] [--today YYYY-MM-DD] [--apply]',
  "",
  "  --apply 가 없으면 계획만 출력하고 DB 에도 디스크에도 한 글자도 쓰지 않습니다.",
].join("\n");

function parseArgs(argv: readonly string[]): Options {
  const options: Options = {
    dirs: [],
    files: [],
    apply: false,
    limit: null,
    outPath: null,
    actorUserId: null,
    today: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const valueOf = (name: string): string => {
      const inline = arg.startsWith(`${name}=`) ? arg.slice(name.length + 1) : null;
      if (inline !== null) {
        if (inline.length === 0) throw new Error(`${name} 뒤에 값이 없습니다.`);
        return inline;
      }
      const next = argv[index + 1];
      if (next === undefined || next.startsWith("--")) throw new Error(`${name} 뒤에 값이 없습니다.`);
      index += 1;
      return next;
    };

    if (arg === "--apply") options.apply = true;
    else if (arg === "--dir" || arg.startsWith("--dir=")) options.dirs.push(valueOf("--dir"));
    else if (arg === "--file" || arg.startsWith("--file=")) options.files.push(valueOf("--file"));
    else if (arg === "--out" || arg.startsWith("--out=")) options.outPath = valueOf("--out");
    else if (arg === "--actor" || arg.startsWith("--actor=")) options.actorUserId = valueOf("--actor");
    else if (arg === "--today" || arg.startsWith("--today=")) options.today = valueOf("--today");
    else if (arg === "--limit" || arg.startsWith("--limit=")) {
      const raw = valueOf("--limit");
      const parsed = Number(raw);
      if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`--limit 은 1 이상의 정수여야 합니다: ${raw}`);
      options.limit = parsed;
    } else throw new Error(`알 수 없는 인자입니다: ${arg}`);
  }

  if (options.dirs.length === 0 && options.files.length === 0) {
    throw new Error("--dir 또는 --file 을 하나 이상 주어야 합니다.");
  }
  return options;
}

/** 🔴 기록 파일이 저장소 안으로 들어오면 안 된다(머리말). */
function isInsideRepo(outPath: string): boolean {
  const relative = path.relative(process.cwd(), path.resolve(outPath));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function currentDatabaseName(): Promise<string> {
  const rows = await db.execute(sql`select current_database() as name`);
  return String((rows[0] as { name?: string } | undefined)?.name ?? "(알 수 없음)");
}

function banner(label: string, value: string): string[] {
  const bar = "═".repeat(60);
  return [bar, `  ${label}  ${value}`, bar];
}

async function main(): Promise<number> {
  const options = parseArgs(process.argv.slice(2));
  if (options.outPath !== null && isInsideRepo(options.outPath)) {
    console.error("--out 이 저장소 안을 가리킵니다. 저장소 밖 경로를 쓰세요(기록에 원본 파일 이름이 들어갑니다).");
    return 1;
  }

  const files = collectKyosanWorkbookPaths({
    dirs: options.dirs,
    files: options.files,
    limit: options.limit,
  });
  if (files.length === 0) {
    console.error("훑은 자리에서 연락서(.xlsm · .xlsx)를 한 장도 찾지 못했습니다.");
    return 1;
  }

  const databaseName = await currentDatabaseName();
  // 🔴 사람은 apply 일 때만 찾는다 — 계획 단계는 읽을 것만 읽는다.
  const actorUserId = options.apply
    ? (options.actorUserId ?? (await resolveKyosanImportActorUserId()))
    : null;

  console.log("교산 연락서 일괄 이식");
  console.log(`  대상 DB:    ${databaseName}`);
  console.log(`  모드:       ${options.apply ? "APPLY (실제로 넣습니다)" : "DRY RUN (읽기 전용)"}`);
  console.log(`  훑은 자리:  --dir ${options.dirs.length}곳 · --file ${options.files.length}장`);
  console.log(`  돌릴 장수:  ${files.length}장${options.limit === null ? "" : ` (--limit ${options.limit})`}`);
  if (!options.apply) {
    console.log("  🔴 `--apply` 를 주지 않았으므로 DB 에도 디스크에도 한 글자도 쓰지 않습니다.");
  }
  console.log("");

  // 🔴 회차 번호는 러너가 만든다 — 여기서는 apply 일 때만 미리 만들어 **맨 처음에** 찍는다.
  const importBatchId = options.apply ? randomUUID() : null;
  if (importBatchId !== null) {
    for (const line of banner("🔴 회차 번호(importBatchId):", importBatchId)) console.log(line);
    console.log("  되돌리기: npx tsx scripts/revert-kyosan-import.ts --batch " + importBatchId);
    console.log("");
  }

  const record = await runKyosanReportImport({
    files,
    apply: options.apply,
    databaseName,
    actorUserId: actorUserId ?? undefined,
    importBatchId: importBatchId ?? undefined,
    today: options.today ?? undefined,
    onProgress: (line) => console.log(line),
  });

  console.log("");
  console.log(formatKyosanRunSummary(record));
  console.log("");

  if (options.outPath !== null) {
    const outPath = path.resolve(options.outPath);
    await fs.mkdir(path.dirname(outPath), { recursive: true });
    await fs.writeFile(outPath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
    console.log(`기록: ${outPath}`);
  } else if (options.apply) {
    console.log("⚠ `--out` 을 주지 않아 기록 JSON 을 남기지 않았습니다.");
  }

  if (!options.apply) {
    console.log("");
    console.log("DRY RUN 이므로 여기서 멈춥니다. 실제로 넣으려면 사람이 이 표를 읽고 `--apply` 를 주세요.");
    return 0;
  }

  console.log("");
  for (const line of banner("🔴 회차 번호(importBatchId):", record.importBatchId ?? "(없음)")) {
    console.log(line);
  }
  console.log("  되돌리기: npx tsx scripts/revert-kyosan-import.ts --batch " + (record.importBatchId ?? ""));

  // 🔴 실패가 한 장이라도 있으면 종료 코드로 알린다 — 「짝 없음」은 실패가 아니다.
  return record.tally.failed > 0 ? 1 : 0;
}

main()
  .then(async (exitCode) => {
    await pgClient.end({ timeout: 5 });
    process.exit(exitCode);
  })
  .catch(async (error) => {
    console.error(`일괄 이식에 실패했습니다: ${error instanceof Error ? error.message : String(error)}`);
    console.error(USAGE);
    await pgClient.end({ timeout: 5 });
    process.exit(1);
  });
