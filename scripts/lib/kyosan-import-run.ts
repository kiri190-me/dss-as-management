/**
 * ============================================================================
 * 연락서 **일괄 이식 러너** — DB 와 디스크에 닿는 쪽 (조각 S5-C, 2026-09-28)
 * ============================================================================
 * 폴더(또는 파일 목록)를 받아 **한 장씩** `importKyosanReport` 를 부른다. 고르는
 * 규칙·세는 규칙은 여기 없다 — `kyosan-import-run-plan.ts` 의 **순수 함수**가
 * 정한다. 명령줄 껍데기는 `scripts/import-kyosan-reports.ts` 다.
 * (되돌리기 도구 S5-B 와 **같은 세 겹**이다.)
 *
 * ── 🔴 안전장치 (하나도 빼지 않는다) ────────────────────────────────────
 *  1. **`--apply` 가 없으면 DB 에도 디스크에도 한 글자도 쓰지 않는다.** 계획
 *     단계가 부르는 것은 `loadKyosanReportLinkTargets`(select 뿐) 하나이고,
 *     저장소 어댑터는 **만들지도 않는다**(`getAttachmentStorage()` 는 apply
 *     에서만 부른다). 🔴 그리고 계획은 이식기가 저장 직전에 도는 **바로 그 읽기
 *     경로**를 그대로 간다 — `readKyosanIdentity` →
 *     `loadKyosanReportLinkTargets` → `matchKyosanReport` →
 *     `buildKyosanReportPreview`. 별도의 판정 규칙을 짓지 않는다(짓는 순간
 *     계획이 거짓말을 한다).
 *  2. **한 회차에 번호 하나.** 실행할 때 `randomUUID()` 로 `importBatchId` 를
 *     하나 만들어 **모든 장에 같은 값**을 넘긴다(S5-A 가 `KyosanReportImportInput`
 *     에 그 칸을 더해 두었다). 🔴 그래야
 *     `revert-kyosan-import.ts --batch <그 번호>` 로 한 번에 되돌릴 수 있다.
 *  3. **한 장이 실패해도 멈추지 않는다.** 던지는 것까지 받아 세고 다음 장으로
 *     간다 — 이식기는 한 장을 한 트랜잭션으로 처리하므로 실패한 장은 DB 에
 *     아무것도 남기지 않는다.
 *  4. 🔴 **부품 건너뛰기 경고를 센다.** 출하가 잠긴 건·반출 이력이 있는 건에서는
 *     사용 부품이 **말없이 건너뛰어진다** — 이식이 실패하지 않고 경고만 남는다
 *     (`kyosan-report-import.ts` 의 `appendUsedParts`). 안 세면 나중에 「부품이
 *     왜 안 들어왔지」가 터진다.
 *  5. **못 읽는 파일을 오류가 아니라 「문서 아님」으로 센다**(순수 함수 쪽의
 *     `isKyosanNonDocumentFile` — 165바이트 엑셀 잠금 파일 31장 실측).
 *  6. **결과를 갈래별로 센다** — 넣음 / 이미 있음 / 짝 없음 / 문서 아님 /
 *     못 읽음 / 그 밖 실패. 합계가 훑은 장수와 같아야 한다.
 *  7. **기록 JSON 을 남긴다**(부르는 쪽인 CLI 가 쓴다) — 회차 번호 · 장별 결과 ·
 *     합계. 🔴 **고객 글자를 싣지 않는다**: 담는 것은 우리 표의 id, 개수, 해시,
 *     그리고 이식기·미리보기가 만든 문장(값이 아니라 항목 이름과 개수만 담는
 *     문장들)이다.
 *     ⚠️ 원본 **파일 이름**은 싣는다 — 503장 가운데 어느 장이었는지 사람이
 *     짚을 유일한 손잡이이기 때문이다. 연락서 파일 이름에는 모델·S/N 이 섞일 수
 *     있으므로 🔴 기록 파일은 **저장소 밖**에만 쓰게 막아 두었다(CLI 의
 *     `--out` 검사). 이식 **흔적**(DB)에는 지금도 파일 이름이 들어가지 않는다.
 *  8. **진행 상황을 찍는다** — 503장은 오래 걸린다. 몇 장째인지 보이게 한다.
 *  9. 🔴 **수리 건을 만들지 않는다.** 이 파일에는 `repair_cases` 에 INSERT 하는
 *     줄이 하나도 없고, 이식기도 짝이 없으면 넣지 않는다. 러너가 그 규칙을
 *     우회하는 길을 만들지 않는다(시험이 이 파일의 **글자를 읽어** 확인한다).
 * 10. **같은 파일을 두 번 세지 않는다.** 같은 절대 경로는 한 번만 담고, **내용이
 *     같은 것**(sha256)은 계획에서 알린다. 🔴 이름으로 가르지 않는다 — 백업된 두
 *     폴더는 이름이 겹치지만 내용은 전부 다르다.
 *
 * ── 🔴 이 파일이 DB 에 쓰는 줄은 **하나도 없다** ────────────────────────
 * 쓰는 일은 전부 `importKyosanReport` 안에서 한 트랜잭션으로 일어난다. 여기서
 * 도는 질의는 `select` 둘뿐이다 — 짝 후보 읽기와, 넣은 뒤 이식 흔적 id 되찾기.
 * ============================================================================
 */

import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import { readdirSync, statSync } from "node:fs";
import path from "node:path";

import { and, eq, sql } from "drizzle-orm";

import { db } from "../../src/lib/db/connection";
import { statusChangeHistories, users } from "../../src/lib/db/schema";
import { loadKyosanReportLinkTargets, serialLookupKey } from "../../src/lib/db/queries/kyosan-report-link";
import { readKyosanReport, type KyosanReport } from "../../src/lib/kyosan/kyosan-report";
import {
  matchKyosanReport,
  readKyosanIdentity,
  type KyosanMatchOutcome,
} from "../../src/lib/kyosan/report-match";
import { buildKyosanReportPreview } from "../../src/lib/kyosan/report-preview";
import { getAttachmentStorage } from "../../src/lib/storage/local-fs-adapter";
import type { StorageAdapter } from "../../src/lib/storage/storage-adapter";
import { importKyosanReport } from "../../src/lib/server/services/kyosan-report-import";
import {
  KYOSAN_RUN_OUTCOME_LABEL,
  KYOSAN_RUN_OUTCOME_ORDER,
  classifyPlanOutcome,
  countUsedPartsSkippedFiles,
  findDuplicateHashGroups,
  isKyosanNonDocumentFile,
  isUsedPartsSkippedWarning,
  outcomeForFailureCode,
  runTallyTotal,
  tallyMessageKinds,
  tallyRunOutcomes,
  type KyosanDuplicateHashGroup,
  type KyosanMessageTallyRow,
  type KyosanRunOutcome,
  type KyosanRunTally,
} from "./kyosan-import-run-plan";

/** 이식 흔적을 가르는 표시. `db/queries/kyosan-report-link.ts` 의 같은 값이다. */
const KYOSAN_REPORT_SOURCE = "KYOSAN_REPORT";

/** 러너가 훑는 통합문서 확장자. `scripts/match-kyosan-reports.ts` 와 같다. */
const WORKBOOK_EXTENSIONS = new Set([".xlsm", ".xlsx"]);

// ─────────────────────────────────────────────── 파일 모으기

/**
 * 폴더를 (하위까지) 훑어 통합문서만 모은다. 🔴 심볼릭 링크는 따라가지 않는다 —
 * 같은 파일을 두 번 세는 가장 쉬운 길이다.
 */
function findWorkbooksIn(rootDir: string): string[] {
  const found: string[] = [];
  function walk(dir: string): void {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const child = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(child);
      else if (entry.isFile() && WORKBOOK_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        found.push(child);
      }
    }
  }
  walk(rootDir);
  return found.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * 🔴 안전장치 10 의 앞쪽 — **같은 절대 경로는 한 번만.** (`--dir A --dir A` 처럼
 * 같은 폴더를 두 번 줘도 그 안의 파일이 두 번 돌지 않는다.) **내용이 같은 것**을
 * 알리는 일은 계획 쪽에서 따로 한다.
 */
export function collectKyosanWorkbookPaths(params: {
  dirs: readonly string[];
  files: readonly string[];
  /** 앞의 N 장만. `null` 이면 전부. */
  limit: number | null;
}): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  const push = (filePath: string) => {
    const absolute = path.resolve(filePath);
    if (seen.has(absolute)) return;
    seen.add(absolute);
    ordered.push(absolute);
  };

  for (const dir of params.dirs) {
    const rootDir = path.resolve(dir);
    if (!statSync(rootDir).isDirectory()) throw new Error(`--dir 가 폴더가 아닙니다: ${dir}`);
    for (const filePath of findWorkbooksIn(rootDir)) push(filePath);
  }
  for (const filePath of params.files) {
    const absolute = path.resolve(filePath);
    if (!statSync(absolute).isFile()) throw new Error(`--file 이 파일이 아닙니다: ${filePath}`);
    push(absolute);
  }

  return params.limit === null ? ordered : ordered.slice(0, params.limit);
}

// ─────────────────────────────────────────────── 기록의 모양

export type KyosanRunFileRecord = {
  /** 1부터. 진행 표시와 같은 수다. */
  index: number;
  /**
   * 원본 파일 이름(폴더 경로는 싣지 않는다). 🔴 위 머리말 안전장치 7 의 ⚠️ 를
   * 읽고 나서 다룰 것 — 기록 파일은 저장소 밖에만 쓴다.
   */
  fileName: string;
  /** 원본 바이트의 SHA-256. 이식 흔적이 쓰는 것과 같은 열쇠다. */
  sha256: string;
  sizeBytes: number;
  outcome: KyosanRunOutcome;
  /** 넣었거나(apply) 넣을 수 있을(계획) 때의 짝. */
  repairCaseId: string | null;
  intakeNumber: string | null;
  /** 🔴 `--apply` 로 실제로 넣었을 때의 이식 흔적 id — 한 장만 되돌릴 때 쓴다. */
  traceId: string | null;
  workRecordCount: number;
  usedPartCount: number;
  attachmentCount: number;
  photoCount: number;
  reportedSymptomFilled: boolean | null;
  /** 실패 코드(`KyosanReportImportFailureCode`) 또는 판독 실패 사유. */
  failureCode: string | null;
  /** 🔴 이식기·미리보기가 만든 문장. 값이 아니라 항목 이름·개수만 담는 문장이다. */
  message: string | null;
  warnings: readonly string[];
  blockers: readonly string[];
  /** 계획 때의 짝짓기 결과(`matched` · `ambiguous:<까닭>` · `unmatched:<까닭>`). */
  matchOutcome: string | null;
};

export type KyosanImportRunRecord = {
  ranAt: string;
  databaseName: string;
  mode: "dry-run" | "apply";
  /** 🔴 한 회차를 묶는 번호. 계획(dry-run)에서는 `null` — 아무것도 안 넣었다. */
  importBatchId: string | null;
  actorUserId: string | null;
  scannedFileCount: number;
  tally: KyosanRunTally;
  /** 🔴 사용 부품이 말없이 건너뛰어진 장수. */
  usedPartsSkippedFiles: number;
  warningKinds: readonly KyosanMessageTallyRow[];
  blockerKinds: readonly KyosanMessageTallyRow[];
  duplicateHashGroups: readonly KyosanDuplicateHashGroup[];
  files: readonly KyosanRunFileRecord[];
};

export type KyosanImportRunOptions = {
  /** 절대 경로. `collectKyosanWorkbookPaths` 가 만든 차례 그대로. */
  files: readonly string[];
  /** 🔴 `false` 면 DB 에도 디스크에도 한 글자도 쓰지 않는다. */
  apply: boolean;
  databaseName: string;
  /** apply 일 때 필요. 없으면 승인된 SUPER_ADMIN 을 찾아 쓴다. */
  actorUserId?: string;
  /** apply 일 때 하나 만들어 모든 장에 같은 값을 넘긴다. 시험이 값을 지정한다. */
  importBatchId?: string;
  /** apply 일 때의 저장소. 없으면 `UPLOADS_DIR`. 🔴 시험은 임시 루트를 넘긴다. */
  storage?: StorageAdapter;
  /** 발행일을 하나도 못 읽었을 때 쓸 날짜(이식기에 그대로 넘긴다). */
  today?: string;
  /** 진행 한 줄. 없으면 아무것도 찍지 않는다(시험이 조용히 돌 수 있게). */
  onProgress?: (line: string) => void;
};

// ─────────────────────────────────────────────── 계획 단계의 읽기 경로

/**
 * 🔴 **이식기가 저장 직전에 도는 그 읽기 경로 그대로**
 * (`src/lib/server/services/kyosan-report-import.ts` 의 「1. 짝짓기를 처음부터
 * 다시 돌린다」 묶음). select 뿐이라 계획 단계에서 불러도 한 글자도 쓰지 않는다.
 *
 * 🔴 한 장씩 부른다 — 503장을 모아 한 번에 읽으면 빠르지만, 그러는 순간
 * 「이식기와 같은 경로」가 아니게 된다.
 */
async function previewOneReport(report: KyosanReport) {
  const identity = readKyosanIdentity(report.card);
  const targets = await loadKyosanReportLinkTargets({
    intakeNumbers: identity.intakeNumber === null ? [] : [identity.intakeNumber],
    serialNumbers: identity.serialNumber === null ? [] : [identity.serialNumber],
  });

  const serialKey = serialLookupKey(identity.serialNumber);
  const match = matchKyosanReport({
    identity,
    caseByIntakeNumber:
      identity.intakeNumber === null
        ? null
        : (targets.casesByIntakeNumber.get(identity.intakeNumber) ?? null),
    identityCandidates: serialKey === null ? [] : (targets.casesBySerialKey.get(serialKey) ?? []),
  });

  const matched = match.outcome.kind === "matched" ? match.outcome : null;
  const caseState =
    matched === null ? null : (targets.caseStates.get(matched.candidate.repairCaseId) ?? null);
  const preview = buildKyosanReportPreview(report, match, caseState);

  return { match, matched, caseState, preview };
}

/** `matched` · `ambiguous:identity-candidates` 처럼 한 낱말로 — 갈래와 까닭만이다. */
function describeMatchOutcome(outcome: KyosanMatchOutcome): string {
  return outcome.kind === "matched" ? outcome.kind : `${outcome.kind}:${outcome.reason}`;
}

/**
 * 🔴 넣은 뒤 **이식 흔적의 id** 를 되찾는다. `importKyosanReport` 는 그 id 를
 * 돌려주지 않는다(흔적을 남기는 것은 그 함수의 마지막 INSERT 다). 한 회차를
 * 통째로 되돌리는 데에는 `--batch` 만 있으면 되지만, **한 장만** 되돌려야 할 때
 * (`--trace`) 사람이 이 기록에서 그 id 를 꺼낸다. select 한 줄이다.
 */
async function findTraceId(repairCaseId: string, sourceSha256: string): Promise<string | null> {
  const [trace] = await db
    .select({ id: statusChangeHistories.id })
    .from(statusChangeHistories)
    .where(
      and(
        eq(statusChangeHistories.repairCaseId, repairCaseId),
        sql`${statusChangeHistories.metadata} ->> 'source' = ${KYOSAN_REPORT_SOURCE}`,
        sql`${statusChangeHistories.metadata} ->> 'sourceSha256' = ${sourceSha256}`
      )
    )
    .limit(1);
  return trace?.id ?? null;
}

/**
 * 기록에 남길 사람. 🔴 되돌리기 도구(`scripts/revert-kyosan-import.ts`)와 같은
 * 방식이다 — 일괄 이식도 자동 절차가 아니라 사람이 결정해서 하는 일이다.
 */
export async function resolveKyosanImportActorUserId(): Promise<string> {
  const [actor] = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(eq(users.role, "SUPER_ADMIN"), eq(users.approvalStatus, "APPROVED"), eq(users.isDeleted, false))
    )
    .limit(1);
  if (!actor) throw new Error("승인된 SUPER_ADMIN 사용자가 필요합니다(기록에 남길 사람).");
  return actor.id;
}

// ─────────────────────────────────────────────── 한 회차를 돈다

function blankRecord(index: number, fileName: string): KyosanRunFileRecord {
  return {
    index,
    fileName,
    sha256: "",
    sizeBytes: 0,
    outcome: "failed",
    repairCaseId: null,
    intakeNumber: null,
    traceId: null,
    workRecordCount: 0,
    usedPartCount: 0,
    attachmentCount: 0,
    photoCount: 0,
    reportedSymptomFilled: null,
    failureCode: null,
    message: null,
    warnings: [],
    blockers: [],
    matchOutcome: null,
  };
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * 🔴 한 장. 던지면 부르는 쪽이 받아 「실패」로 세고 **다음 장으로 간다**
 * (안전장치 3).
 */
async function runOneFile(params: {
  index: number;
  filePath: string;
  options: KyosanImportRunOptions;
  actorUserId: string | null;
  importBatchId: string | null;
  storage: StorageAdapter | null;
}): Promise<KyosanRunFileRecord> {
  const fileName = path.basename(params.filePath);
  const record = blankRecord(params.index, fileName);

  const bytes = await fs.readFile(params.filePath);
  record.sha256 = createHash("sha256").update(bytes).digest("hex");
  record.sizeBytes = bytes.length;

  // ── 🔴 안전장치 5 — 문서가 아닌 파일은 고장이 아니다 ──
  if (isKyosanNonDocumentFile(bytes)) {
    return {
      ...record,
      outcome: "non-document",
      message: `${bytes.length}바이트 · 통합문서(ZIP)가 아닙니다 — 엑셀 잠금 파일·자리표시자입니다.`,
    };
  }

  const read = readKyosanReport(bytes);
  if (!read.ok) {
    return { ...record, outcome: "unreadable", failureCode: read.reason, message: read.detail };
  }

  // ── 🔴 안전장치 1 — 계획 단계는 select 뿐이다 ──
  if (!params.options.apply) {
    const previewed = await previewOneReport(read.report);
    const outcome = classifyPlanOutcome({
      hasMatch: previewed.matched !== null,
      hasPlan: previewed.preview.plan !== null,
      caseAlreadyHasSourceHash:
        previewed.caseState?.importedSourceSha256.includes(read.report.sourceSha256) ?? false,
    });
    const plan = previewed.preview.plan;
    return {
      ...record,
      outcome,
      repairCaseId: plan?.repairCaseId ?? previewed.matched?.candidate.repairCaseId ?? null,
      intakeNumber: plan?.intakeNumber ?? previewed.matched?.candidate.intakeNumber ?? null,
      usedPartCount: plan?.parts.length ?? 0,
      photoCount: plan?.photoCount ?? 0,
      warnings: previewed.preview.warnings,
      blockers: previewed.preview.blockers,
      matchOutcome: describeMatchOutcome(previewed.match.outcome),
    };
  }

  // ── `--apply` — 이식기 한 번. 🔴 회차 번호를 그대로 넘긴다(안전장치 2) ──
  if (params.actorUserId === null || params.storage === null) {
    throw new Error("`--apply` 인데 사람 또는 저장소가 준비되지 않았습니다.");
  }
  const result = await importKyosanReport({
    report: read.report,
    sourceFileName: fileName,
    sourceBytes: bytes,
    actorUserId: params.actorUserId,
    storage: params.storage,
    today: params.options.today,
    importBatchId: params.importBatchId ?? undefined,
  });

  if (!result.ok) {
    return {
      ...record,
      outcome: outcomeForFailureCode(result.code),
      failureCode: result.code,
      message: result.message,
      blockers: result.blockers ?? [],
    };
  }

  return {
    ...record,
    outcome: "imported",
    repairCaseId: result.repairCaseId,
    intakeNumber: result.intakeNumber,
    traceId: await findTraceId(result.repairCaseId, read.report.sourceSha256),
    workRecordCount: result.workRecordIds.length,
    usedPartCount: result.usedPartCount,
    attachmentCount: result.attachmentIds.length,
    photoCount: result.photoCount,
    reportedSymptomFilled: result.reportedSymptomFilled,
    warnings: result.warnings,
  };
}

function progressLine(record: KyosanRunFileRecord, total: number): string {
  const counter = `[${String(record.index).padStart(String(total).length, " ")}/${total}]`;
  const where = record.intakeNumber === null ? "" : `  ${record.intakeNumber}`;
  // 🔴 판정은 순수 함수 쪽 한 곳이다 — 여기에 글자를 다시 적으면 한쪽만 고쳐지는 날이 온다.
  const skipped = record.warnings.some(isUsedPartsSkippedWarning) ? "  ⚠ 부품 건너뜀" : "";
  return `${counter} ${record.fileName}  ${KYOSAN_RUN_OUTCOME_LABEL[record.outcome]}${where}${skipped}`;
}

/**
 * 🔴 한 회차. `apply` 가 아니면 **DB 에도 디스크에도 한 글자도 쓰지 않는다.**
 */
export async function runKyosanReportImport(
  options: KyosanImportRunOptions
): Promise<KyosanImportRunRecord> {
  // 🔴 안전장치 2 — 회차 번호는 apply 에서만, **한 번만** 만든다.
  const importBatchId = options.apply ? (options.importBatchId ?? randomUUID()) : null;
  const actorUserId = options.apply
    ? (options.actorUserId ?? (await resolveKyosanImportActorUserId()))
    : null;
  // 🔴 저장소 어댑터를 계획 단계에서는 **만들지도 않는다**(UPLOADS_DIR 을 읽지도 않는다).
  const storage = options.apply ? (options.storage ?? getAttachmentStorage()) : null;

  const files: KyosanRunFileRecord[] = [];
  const total = options.files.length;

  for (const [offset, filePath] of options.files.entries()) {
    const index = offset + 1;
    let record: KyosanRunFileRecord;
    try {
      record = await runOneFile({ index, filePath, options, actorUserId, importBatchId, storage });
    } catch (error) {
      // 🔴 안전장치 3 — 한 장이 무슨 일을 당해도 나머지가 계속된다.
      record = {
        ...blankRecord(index, path.basename(filePath)),
        outcome: "failed",
        failureCode: "RUNNER_ERROR",
        message: describeError(error),
      };
    }
    files.push(record);
    options.onProgress?.(progressLine(record, total));
  }

  const perFileWarnings = files.map((file) => file.warnings);
  return {
    ranAt: new Date().toISOString(),
    databaseName: options.databaseName,
    mode: options.apply ? "apply" : "dry-run",
    importBatchId,
    actorUserId,
    scannedFileCount: total,
    tally: tallyRunOutcomes(files.map((file) => file.outcome)),
    usedPartsSkippedFiles: countUsedPartsSkippedFiles(perFileWarnings),
    warningKinds: tallyMessageKinds(perFileWarnings),
    blockerKinds: tallyMessageKinds(files.map((file) => file.blockers)),
    duplicateHashGroups: findDuplicateHashGroups(
      files
        .filter((file) => file.sha256 !== "")
        .map((file) => ({ fileName: file.fileName, sha256: file.sha256 }))
    ),
    files,
  };
}

// ─────────────────────────────────────────────── 사람이 읽는 표

/**
 * 한글은 화면에서 두 칸을 먹는다 — `padEnd` 는 글자 수로 세므로 섞인 칸이
 * 어긋난다(`kyosan-import-revert.ts` 의 같은 함수).
 */
function padLabel(label: string, columns: number): string {
  let width = 0;
  for (const character of label) width += /[ᄀ-ᇿ⺀-꓏가-힣豈-﫿︰-﹏]/u.test(character) ? 2 : 1;
  return label + " ".repeat(Math.max(0, columns - width));
}

export function formatKyosanRunSummary(record: KyosanImportRunRecord): string {
  const lines: string[] = [];

  lines.push("=== 갈래별 합계 ===");
  for (const outcome of KYOSAN_RUN_OUTCOME_ORDER) {
    const count = record.tally[outcome];
    // 계획에는 `imported` 가, `--apply` 에는 `importable` 이 있을 수 없다 — 그 칸은 감춘다.
    if (count === 0 && (outcome === "imported" || outcome === "importable")) continue;
    lines.push(`  ${padLabel(KYOSAN_RUN_OUTCOME_LABEL[outcome], 26)}${String(count).padStart(4, " ")}장`);
  }
  lines.push(`  ${padLabel("(합계)", 26)}${String(runTallyTotal(record.tally)).padStart(4, " ")}장`);
  lines.push("");
  lines.push(
    "  🔴 「짝 없음·막힘」은 **실패가 아니다** — 그 연락서가 가리키는 수리 건이 이 DB 에 없다는 뜻이고,"
  );
  lines.push(
    "     이식기는 사용자 정책대로 **수리 건을 만들지 않는다**. 개발 DB 에서는 대부분이 여기로 떨어지는 것이 정상이다."
  );
  lines.push(
    "  🔴 「문서 아님」도 실패가 아니다 — 165바이트 엑셀 잠금 파일(`~$…`)이 원본에 섞여 있다(실측 31장)."
  );
  lines.push("");

  lines.push(`=== 🔴 사용 부품이 건너뛰어진 장: ${record.usedPartsSkippedFiles}장 ===`);
  lines.push(
    "  (출하가 잠긴 건·반출 이력이 있는 건이다. 이식은 실패하지 않고 경고만 남기므로 이 수를 꼭 봐야 한다.)"
  );
  lines.push("");

  lines.push("=== 막은 까닭(blocker) — 종류별 장수 ===");
  if (record.blockerKinds.length === 0) lines.push("  (없음)");
  for (const row of record.blockerKinds) lines.push(`  ${String(row.files).padStart(4, " ")}장  ${row.kind}`);
  lines.push("");

  lines.push("=== 알린 것(warning) — 종류별 장수 ===");
  if (record.warningKinds.length === 0) lines.push("  (없음)");
  for (const row of record.warningKinds) lines.push(`  ${String(row.files).padStart(4, " ")}장  ${row.kind}`);
  lines.push("");

  lines.push(`=== 🔴 내용이 같은 파일(sha256) — ${record.duplicateHashGroups.length}묶음 ===`);
  if (record.duplicateHashGroups.length === 0) {
    lines.push("  (없음 — 훑은 파일의 내용이 전부 다르다)");
  }
  for (const group of record.duplicateHashGroups) {
    lines.push(`  ${group.sha256.slice(0, 12)}…  ${group.fileNames.join(" · ")}`);
  }
  lines.push(
    "  (먼저 들어간 한 장만 남고 나머지는 이식기가 `ALREADY_IMPORTED` 로 막는다 — 러너가 말없이 건너뛰지 않는다.)"
  );

  return lines.join("\n");
}
