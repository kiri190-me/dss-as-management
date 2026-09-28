import "./load-env";

import fs from "node:fs/promises";
import path from "node:path";

import { and, eq, sql } from "drizzle-orm";

import { db, pgClient } from "../src/lib/db/connection";
import { users } from "../src/lib/db/schema";
import {
  RevertPlanChangedError,
  applyKyosanRevert,
  describeSelector,
  formatRevertPlan,
  readKyosanRevertPlan,
  selectorLabel,
  type KyosanRevertPlan,
  type RevertSelector,
} from "./lib/kyosan-import-revert";

/**
 * ============================================================================
 * 교산 연락서 이식을 되돌린다 (조각 S5-B, 2026-09-28)
 * ============================================================================
 *
 *   npx tsx scripts/revert-kyosan-import.ts --case D210101              ← 계획만 (기본)
 *   npx tsx scripts/revert-kyosan-import.ts --trace <흔적 id>
 *   npx tsx scripts/revert-kyosan-import.ts --batch <회차 id>
 *   npx tsx scripts/revert-kyosan-import.ts --case D210101 --apply      ← 실제로 되돌린다
 *   … [--quarantine-dir <경로>] [--out <기록 JSON 경로>]
 *
 * ── 🔴 왜 이 도구가 있는가 ──────────────────────────────────────────────
 * 과거 연락서 469장을 한꺼번에 들여오기(S5) 전에 있어야 한다. 이 저장소의
 * 규칙은 **「되돌리기 없이는 운영 자료에 손대지 않는다」**이다. 이식 한 장이
 * 만드는 것은 여섯 가지다 — 작업 기록 · 사용 부품 · 첨부 행 · 신고 증상 ·
 * 이식 흔적 · 디스크의 파일 실물. 그 여섯을 한 번에 되짚는 것이 이 도구다.
 *
 * ── 🔴 `--apply` 가 없으면 한 글자도 쓰지 않는다 ────────────────────────
 * 기본은 **계획 출력**이다. 무엇을 몇 개 지울지 표로 보여 주고 끝낸다. 실제로
 * 지우는 것은 사람이 그 계획을 읽고 `--apply` 를 붙였을 때뿐이다.
 *
 * ── 🔴 파일은 지우지 않는다 ─────────────────────────────────────────────
 * `--apply` 라도 디스크 파일을 `unlink` 하지 않는다. 격리 폴더
 * (`<UPLOADS_DIR>/_reverted/<회차 이름>/<흔적 id>/…`)로 **옮긴다.** 원래 상대
 * 경로 구조를 그대로 살려 두므로, 되돌려 놓을 일이 생기면 그 방의 내용을 저장
 * 루트에 그대로 덮어 복사하면 된다. 잘못 지우면 되돌릴 길이 없지만 옮기면 있다.
 *
 * ── 🔴 건드리지 않는 것 ─────────────────────────────────────────────────
 * `service_reports` · `quotes` · 청구서는 **한 줄도** 건드리지 않는다. 이식은
 * 보고서를 만들지 않으므로(`server/services/kyosan-report-import.ts` 머리말)
 * 거기에 있는 것은 다른 경로에서 온 것이다 — 실제로 개발 DB 의 `D260403` 에
 * 이식 다음 날 생긴 보고서가 1장 있다.
 * 사람이 올린 첨부도 건드리지 않는다. 🔴 `category = 'KYOSAN_DOCUMENT'` 만으로
 * 고르지 않고 `description` 을 **함께** 거는 까닭이 그것이다 — 그 분류는 사람이
 * 올리는 통로에도 열려 있고, 개발 DB 에 그런 행이 실제로 1건 있다.
 *
 * ── 고르는 규칙과 지우는 일이 갈라져 있다 ───────────────────────────────
 *   · `scripts/lib/kyosan-import-revert-plan.ts`  — 순수 함수(고르는 규칙)
 *   · `scripts/lib/kyosan-import-revert.ts`       — DB · 디스크
 *   · 이 파일                                      — 명령줄 껍데기
 * ============================================================================
 */

type Options = {
  selector: RevertSelector;
  apply: boolean;
  quarantineRoot: string | null;
  outPath: string | null;
};

const USAGE = [
  "쓰는 법:",
  "  npx tsx scripts/revert-kyosan-import.ts (--trace <흔적id> | --batch <회차id> | --case <접수번호>)",
  "                                          [--apply] [--quarantine-dir <경로>] [--out <기록 JSON>]",
  "",
  "  --apply 가 없으면 계획만 출력하고 DB 에 한 글자도 쓰지 않습니다.",
].join("\n");

function parseArgs(argv: readonly string[]): Options {
  let selector: RevertSelector | null = null;
  let apply = false;
  let quarantineRoot: string | null = null;
  let outPath: string | null = null;

  const setSelector = (next: RevertSelector) => {
    if (selector !== null) {
      throw new Error("--trace · --batch · --case 는 **하나만** 줄 수 있습니다.");
    }
    selector = next;
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

    if (arg === "--apply") apply = true;
    else if (arg === "--trace" || arg.startsWith("--trace=")) setSelector({ kind: "trace", traceId: valueOf("--trace") });
    else if (arg === "--batch" || arg.startsWith("--batch="))
      setSelector({ kind: "batch", importBatchId: valueOf("--batch") });
    else if (arg === "--case" || arg.startsWith("--case="))
      setSelector({ kind: "case", intakeNumber: valueOf("--case") });
    else if (arg === "--quarantine-dir" || arg.startsWith("--quarantine-dir="))
      quarantineRoot = valueOf("--quarantine-dir");
    else if (arg === "--out" || arg.startsWith("--out=")) outPath = valueOf("--out");
    else throw new Error(`알 수 없는 인자입니다: ${arg}`);
  }

  if (selector === null) {
    throw new Error("--trace · --batch · --case 가운데 하나를 반드시 주어야 합니다.");
  }
  return { selector, apply, quarantineRoot, outPath };
}

/** `20260928-153012` — 격리 폴더 이름의 앞머리. 파일 이름에 쓸 수 있는 글자만. */
function timestampLabel(now: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return (
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  );
}

async function currentDatabaseName(): Promise<string> {
  const rows = await db.execute(sql`select current_database() as name`);
  return String((rows[0] as { name?: string } | undefined)?.name ?? "(알 수 없음)");
}

/**
 * 되돌리기를 기록에 남길 사람. 🔴 `actorUserId: null`(시스템)로 적지 않는다 —
 * 되돌리기는 보관기간 만료 같은 자동 절차가 아니라 사람이 결정해서 하는 일이다.
 * 고르는 방식은 `scripts/fix-stranded-intake-steps.ts` 와 같다.
 */
async function resolveActorUserId(): Promise<string> {
  const [actor] = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(eq(users.role, "SUPER_ADMIN"), eq(users.approvalStatus, "APPROVED"), eq(users.isDeleted, false))
    )
    .limit(1);
  if (!actor) throw new Error("승인된 SUPER_ADMIN 사용자가 필요합니다(감사 기록에 남길 사람).");
  return actor.id;
}

function resolveQuarantineRoot(explicit: string | null): string {
  if (explicit !== null && explicit.trim().length > 0) return path.resolve(explicit.trim());
  const uploadsRoot = process.env.UPLOADS_DIR?.trim();
  if (!uploadsRoot) {
    throw new Error(
      "UPLOADS_DIR 이 설정돼 있지 않습니다. .env.local 을 확인하거나 --quarantine-dir 를 주세요."
    );
  }
  // 🔴 이름이 밑줄로 시작하므로 `stored_path` 의 첫 마디(repair-cases · product-models ·
  //    quotes)와 절대 겹치지 않는다.
  return path.join(path.resolve(uploadsRoot), "_reverted");
}

function resolveUploadsRootOrThrow(): string {
  const uploadsRoot = process.env.UPLOADS_DIR?.trim();
  if (!uploadsRoot) {
    throw new Error("UPLOADS_DIR 이 설정돼 있지 않습니다. .env.local 을 확인하세요(.env.example 참고).");
  }
  return path.resolve(uploadsRoot);
}

function hasAnythingToDo(plan: KyosanRevertPlan): boolean {
  return plan.decisions.some((decision) => decision.kind === "revert");
}

async function main(): Promise<number> {
  const options = parseArgs(process.argv.slice(2));
  const databaseName = await currentDatabaseName();
  const runLabel = `${timestampLabel(new Date())}-${selectorLabel(options.selector)}`;
  const quarantineRoot = resolveQuarantineRoot(options.quarantineRoot);
  const quarantineDir = path.join(quarantineRoot, runLabel);

  console.log("연락서 이식 되돌리기");
  console.log(`  대상 DB:    ${databaseName}`);
  console.log(`  고르기:     ${describeSelector(options.selector)}`);
  console.log(`  모드:       ${options.apply ? "APPLY (실제로 지웁니다)" : "DRY RUN (읽기 전용)"}`);
  console.log(`  격리 폴더:  ${quarantineDir}`);
  if (!options.apply) {
    console.log("  🔴 `--apply` 를 주지 않았으므로 DB 에 한 글자도 쓰지 않습니다.");
  }
  console.log("");

  const plan = await readKyosanRevertPlan(options.selector);
  if (plan.decisions.length === 0) {
    console.log("고른 조건에 맞는 연락서 이식 흔적이 없습니다.");
    return 0;
  }

  console.log(formatRevertPlan(plan));
  console.log("");

  if (!options.apply) {
    console.log("DRY RUN 이므로 여기서 멈춥니다. 실제로 되돌리려면 `--apply` 를 주세요.");
    return 0;
  }

  if (!hasAnythingToDo(plan)) {
    console.log("되돌릴 흔적이 하나도 없습니다 — 아무것도 하지 않았습니다.");
    return 0;
  }

  const uploadsRoot = resolveUploadsRootOrThrow();
  const actorUserId = await resolveActorUserId();

  const record = await applyKyosanRevert({
    plan,
    actorUserId,
    uploadsRoot,
    quarantineRoot,
    runLabel,
    databaseName,
  });

  // 🔴 안전장치 7 — 무엇을 지웠는지 파일로 남긴다. 옮긴 파일과 같은 방에 둔다.
  const outPath = options.outPath ? path.resolve(options.outPath) : path.join(quarantineDir, "revert-record.json");
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, `${JSON.stringify(record, null, 2)}\n`, "utf8");

  const movedFiles = record.reverted.flatMap((trace) => trace.files);
  const failed = movedFiles.filter((file) => file.state === "failed");
  const missing = movedFiles.filter((file) => file.state === "missing");

  console.log("=== 결과 ===");
  console.log(`  되돌린 흔적:  ${record.reverted.length}건 (건너뜀 ${record.skipped.length})`);
  console.log(`  작업 기록:    ${record.reverted.reduce((sum, t) => sum + t.deletedWorkRecordIds.length, 0)}줄`);
  console.log(`  사용 부품:    ${record.reverted.reduce((sum, t) => sum + t.deletedUsedPartIds.length, 0)}줄`);
  console.log(`  첨부 행:      ${record.reverted.reduce((sum, t) => sum + t.deletedAttachmentIds.length, 0)}장`);
  console.log(`  신고 증상:    ${record.reverted.filter((t) => t.reportedSymptom !== null).length}건 되돌림`);
  console.log(
    `  옮긴 파일:    ${movedFiles.filter((file) => file.state === "moved").length}개` +
      (missing.length > 0 ? ` / 실물 없음 ${missing.length}개` : "") +
      (failed.length > 0 ? ` / 🔴 못 옮김 ${failed.length}개` : "")
  );
  console.log(`  기록:         ${outPath}`);

  if (failed.length > 0) {
    console.error("");
    console.error("🔴 옮기지 못한 파일이 있습니다 — DB 행은 이미 지워졌습니다. 손으로 옮겨 주세요:");
    for (const file of failed) console.error(`  ✗ ${file.relPath} — ${file.reason ?? "(사유 없음)"}`);
    return 1;
  }
  return 0;
}

main()
  .then(async (exitCode) => {
    await pgClient.end({ timeout: 5 });
    process.exit(exitCode);
  })
  .catch(async (error) => {
    if (error instanceof RevertPlanChangedError) {
      console.error(`되돌리지 않았습니다: ${error.message}`);
    } else {
      console.error(`되돌리기에 실패했습니다: ${error instanceof Error ? error.message : String(error)}`);
      console.error(USAGE);
    }
    await pgClient.end({ timeout: 5 });
    process.exit(1);
  });
