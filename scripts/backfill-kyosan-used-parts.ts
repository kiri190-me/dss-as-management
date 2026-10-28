import "./load-env";

import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { sql } from "drizzle-orm";

import { db, pgClient } from "../src/lib/db/connection";
import { collectKyosanWorkbookPaths, resolveKyosanImportActorUserId } from "./lib/kyosan-import-run";
import {
  formatKyosanUsedPartsBackfillSummary,
  runKyosanUsedPartsBackfill,
} from "./lib/kyosan-used-parts-backfill";

/**
 * ============================================================================
 * 이미 이식된 연락서의 **사용 부품만 다시 적는다** (2026-10-28 사용자 결정)
 * ============================================================================
 *
 *   node --conditions=react-server --import tsx scripts/backfill-kyosan-used-parts.ts \
 *     --dir "<폴더>" [--dir "<폴더>"] [--file "<파일>"] [--limit 10] \
 *     [--out "<저장소 밖 기록 JSON>"] [--actor <사용자 id>]
 *
 *   … 그리고 사람이 계획을 읽고 승인한 뒤에만:
 *
 *   node --conditions=react-server --import tsx scripts/backfill-kyosan-used-parts.ts \
 *     --dir "<폴더>" --apply --out "<저장소 밖 기록 JSON>"
 *
 * (`--conditions=react-server` 가 있어야 재고 관리 통로·조회 쪽의 `server-only` 가
 *  풀린다 — `scripts/import-kyosan-reports.ts` 와 같다.)
 *
 * ── 🔴 왜 「연락서를 다시 넣기」가 아닌가 ────────────────────────────────
 * 2026-10-28 에 연락서 부품을 **품번**으로 읽게 바꿨고, 그 전에 들어간 줄들은 옛
 * 방식(손글씨 이름)으로 저장되어 있다. 그런데 **연락서를 다시 넣으면** 사용 부품만
 * 바뀌는 것이 아니라 **작업 기록과 첨부가 한 벌 더 쌓이고**, 그 상태는 되돌리기
 * 도구로 치울 수 없다(까닭 전문은 `scripts/lib/kyosan-used-parts-backfill-plan.ts`
 * 머리말). 그래서 사용자가 **「사용 부품만 다시 적는다」**를 골랐다.
 *
 * 이 도구가 건드리는 것: `repair_case_used_parts`(그 건의 줄) ·
 * `repair_cases.version`·`updated_at` · 이식 흔적의 `metadata` 한 칸 ·
 * `audit_logs` 한 줄. 🔴 **작업 기록 · 첨부 · 신고 증상 · 보고서는 한 줄도.**
 *
 * ── 🔴 `--apply` 가 없으면 한 글자도 쓰지 않는다 ────────────────────────
 * 기본은 **계획 출력**이다. 건마다 「바꿀 수 있음 / 이미 같음 / 왜 못 바꾸는가」를
 * 찍고 갈래별로 세어 끝낸다. 그리고 **「N줄 → M줄」**을 합계로 보여 준다 — 사람이
 * 그 수를 보고 승인한다.
 *
 * ── 🔴 되돌리기는 **그대로** 듣는다 ─────────────────────────────────────
 * 이 도구는 이식 흔적을 새로 만들지 않고 **기존 흔적의 `usedPartIds` 를 갈아
 * 끼운다.** 그래서 백필 뒤에도
 *
 *   npx tsx scripts/revert-kyosan-import.ts --batch <원래 이식 회차>
 *   npx tsx scripts/revert-kyosan-import.ts --case <접수번호>
 *
 * 가 고치지 않아도 그대로 돈다(`importBatchId` 를 건드리지 않는다).
 * ⚠️ 되돌리면 사용 부품은 **이식 전 줄로 돌아가지 않고 없어진다** — 2026-10-28 의
 * 「덮어쓴다」 결정이 이미 받아들인 값이다. 백필 **전**의 줄은 이 도구가 남기는
 * 감사 이력(`audit_logs` 의 `previousValue.lines`)에 통째로 들어 있다.
 *
 * ── 🔴 기록 JSON 은 저장소 밖에만 ───────────────────────────────────────
 * 기록에는 원본 **파일 이름**이 들어간다. 연락서 파일 이름에는 모델·S/N 이 섞일 수
 * 있으므로 `--out` 이 저장소 안을 가리키면 거부한다(`import-kyosan-reports.ts` 와
 * 같은 규칙).
 *
 * ── 고르는 규칙과 도는 일이 갈라져 있다 ─────────────────────────────────
 *   · `scripts/lib/kyosan-used-parts-backfill-plan.ts` — 순수 함수(가려내는·세는 규칙)
 *   · `scripts/lib/kyosan-used-parts-backfill.ts`      — DB · 디스크
 *   · 이 파일                                           — 명령줄 껍데기
 * ============================================================================
 */

type Options = {
  dirs: string[];
  files: string[];
  apply: boolean;
  limit: number | null;
  outPath: string | null;
  actorUserId: string | null;
};

const USAGE = [
  "쓰는 법:",
  '  node --conditions=react-server --import tsx scripts/backfill-kyosan-used-parts.ts \\',
  '    --dir "<폴더>" [--dir "<폴더>"] [--file "<파일>"] [--limit <수>] \\',
  '    [--out "<저장소 밖 기록 JSON>"] [--actor <사용자 id>] [--apply]',
  "",
  "  --apply 가 없으면 계획만 출력하고 DB 에 한 글자도 쓰지 않습니다.",
].join("\n");

function parseArgs(argv: readonly string[]): Options {
  const options: Options = {
    dirs: [],
    files: [],
    apply: false,
    limit: null,
    outPath: null,
    actorUserId: null,
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

  // 🔴 파일 모으는 규칙은 일괄 이식 러너의 **그 함수 그대로**다 — 같은 폴더를 두 번
  //    줘도 한 번만 담고, 심볼릭 링크는 따라가지 않는다.
  const workbookPaths = collectKyosanWorkbookPaths({
    dirs: options.dirs,
    files: options.files,
    // 🔴 `--limit` 은 **파일**이 아니라 **짝지은 흔적**에 건다(러너와 다른 자리다).
    //    파일을 자르면 그 안에 이식된 장이 몇 개나 있는지 알 수 없어 표본이 들쭉날쭉해진다.
    limit: null,
  });
  if (workbookPaths.length === 0) {
    console.error("훑은 자리에서 연락서(.xlsm · .xlsx)를 한 장도 찾지 못했습니다.");
    return 1;
  }

  const databaseName = await currentDatabaseName();
  // 🔴 사람은 apply 일 때만 찾는다 — 계획 단계는 읽을 것만 읽는다.
  const actorUserId = options.apply
    ? (options.actorUserId ?? (await resolveKyosanImportActorUserId()))
    : null;
  const backfillRunId = options.apply ? randomUUID() : null;

  console.log("교산 연락서 — 사용 부품만 다시 적기");
  console.log(`  대상 DB:    ${databaseName}`);
  console.log(`  모드:       ${options.apply ? "APPLY (실제로 바꿉니다)" : "DRY RUN (읽기 전용)"}`);
  console.log(`  훑은 자리:  --dir ${options.dirs.length}곳 · --file ${options.files.length}장`);
  // 🔵 여기 수는 **찌꺼기를 포함한** 수다 — `~$…` 잠금 파일을 몇 장 뺐는지는 아래 요약이
  //    따로 찍는다(조용히 빠지면 수가 달라진 까닭을 아무도 모른다).
  console.log(`  훑은 파일:  ${workbookPaths.length}장${options.limit === null ? "" : ` (--limit ${options.limit}건까지)`}`);
  console.log("  🔴 작업 기록 · 첨부 · 신고 증상 · 보고서는 한 줄도 건드리지 않습니다.");
  if (!options.apply) {
    console.log("  🔴 `--apply` 를 주지 않았으므로 DB 에 한 글자도 쓰지 않습니다.");
  }
  console.log("");

  if (backfillRunId !== null) {
    for (const line of banner("🔴 회차 번호(backfillRunId):", backfillRunId)) console.log(line);
    console.log("  (감사 이력과 흔적 metadata 에 이 번호가 함께 적힙니다 — 받아 적으세요.)");
    console.log("");
  }

  const record = await runKyosanUsedPartsBackfill({
    workbookPaths,
    apply: options.apply,
    databaseName,
    actorUserId: actorUserId ?? undefined,
    backfillRunId: backfillRunId ?? undefined,
    limit: options.limit,
    onProgress: (line) => console.log(line),
  });

  console.log("");
  console.log(formatKyosanUsedPartsBackfillSummary(record));
  console.log("");

  if (options.outPath !== null) {
    const outPath = path.resolve(options.outPath);
    await fs.mkdir(path.dirname(outPath), { recursive: true });
    await fs.writeFile(outPath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
    console.log(`기록: ${outPath}`);
  } else {
    // 🔴 **이름은 화면에 안 찍는다**(요약 쪽 머리말) — 그래서 `--out` 이 없으면 어느
    //    파일이었는지 볼 길이 아예 없다. 그 사실을 여기서 한 줄로 말해 준다.
    console.log(
      "⚠ `--out` 을 주지 않아 기록 JSON 을 남기지 않았습니다 — 연락서 **파일 이름**은 그 기록으로만 볼 수 있습니다" +
        (options.apply ? "." : "(화면에는 접수번호만 찍습니다).")
    );
  }

  if (!options.apply) {
    console.log("");
    console.log("DRY RUN 이므로 여기서 멈춥니다. 실제로 바꾸려면 사람이 이 표를 읽고 `--apply` 를 주세요.");
    return 0;
  }

  console.log("");
  for (const line of banner("🔴 회차 번호(backfillRunId):", record.backfillRunId ?? "(없음)")) {
    console.log(line);
  }

  // 🔴 실패가 한 건이라도 있으면 종료 코드로 알린다 — 「다시 돌리면 되는 건」은 실패가 아니다.
  return record.tally.failed > 0 ? 1 : 0;
}

main()
  .then(async (exitCode) => {
    await pgClient.end({ timeout: 5 });
    process.exit(exitCode);
  })
  .catch(async (error) => {
    console.error(`사용 부품 백필에 실패했습니다: ${error instanceof Error ? error.message : String(error)}`);
    console.error(USAGE);
    await pgClient.end({ timeout: 5 });
    process.exit(1);
  });
