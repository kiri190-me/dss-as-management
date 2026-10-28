/**
 * ============================================================================
 * 연락서 **사용 부품 백필** — DB 와 디스크에 닿는 쪽 (2026-10-28)
 * ============================================================================
 * 이미 들어간 연락서 이식 흔적을 읽어, 그 연락서를 **다시 읽어** 사용 부품 칸만
 * 다시 적는다. 고르는 규칙·세는 규칙은 여기 없다 —
 * `kyosan-used-parts-backfill-plan.ts` 의 **순수 함수**가 정한다. 명령줄 껍데기는
 * `scripts/backfill-kyosan-used-parts.ts` 다. (일괄 이식 러너 S5-C · 되돌리기
 * 도구 S5-B 와 **같은 세 겹**이다.)
 *
 * 🔴 **왜 「연락서를 다시 넣는」 길로 가지 않는가**는 순수 함수 쪽 머리말에 길게
 * 적었다. 요약: 다시 넣으면 작업 기록과 첨부가 한 벌 더 생기고, 그 상태는
 * 되돌리기 도구로 치울 수 없다.
 *
 * ── 🔴 안전장치 (하나도 빼지 않는다) ────────────────────────────────────
 *  1. **`--apply` 가 없으면 DB 에도 디스크에도 한 글자도 쓰지 않는다.** 계획
 *     단계가 도는 질의는 전부 `select` 다.
 *  2. 🔴 **이 파일이 건드리는 표는 둘뿐이다** — `repair_case_used_parts`(그 건의
 *     줄을 다시 적는다)와 `repair_cases`(`version`·`updated_at` 만 올린다).
 *     그리고 흔적의 **`metadata` 한 칸**(아래 4)과 `audit_logs` 한 줄.
 *     **작업 기록 · 첨부 · 신고 증상 · 보고서 · 견적서에는 이 파일에 질의가 하나도
 *     없다.** 그것이 이 도구가 존재하는 까닭이다.
 *  3. 🔴 **짝짓기를 다시 돌리지 않는다.** 흔적이 이미 「이 건에 이 파일을 넣었다」는
 *     사실이다 — `(repair_case_id, metadata->>'sourceSha256')` 로 디스크의 파일과
 *     해시로 짝짓는다. S3a 의 오짝 위험(접수번호만 믿으면 469장 중 12장이 엉뚱한
 *     건에 붙었을 것)이 **아예 없다.**
 *  4. 🔴 **흔적을 새로 만들지 않고 기존 흔적의 `usedPartIds`·`usedPartCount` 를
 *     갈아 끼운다.** 그래야 되돌리기가 고치지 않아도 그대로 말이 된다(순수 함수
 *     쪽 머리말). `importBatchId` · `workRecordIds` · `attachmentIds` ·
 *     `reportedSymptomFilled` · `created_at` 은 **한 글자도 건드리지 않는다.**
 *  5. 🔴 **지금 줄이 흔적이 말한 그 줄이 아니면 한 줄도 안 건드린다**
 *     (`backfillRowsMatchTrace`). 사람이 그 뒤에 고친 칸을 지우지 않는다.
 *  6. **판정을 두 벌로 만들지 않는다.** 게이트(`resolveUsedPartsWriteGate`) ·
 *     probe 둘(`hasLivePartRequest` · `isImportedFromKyosanIntake`) · 재고 관리
 *     묻기(`probeInventoryPartRequestTrace`) · 묶기(`mergeKyosanPartsForUsedParts`)
 *     · 번역(`translateKyosanSentence`) — 전부 이식기가 부르는 **그 함수 그대로**다.
 *  7. 🔴 **재고 관리에 못 물어보면 그 건은 건너뛴다.** 「모른다」를 「없다」로 눕히면
 *     이미 부품을 받아 간 건의 사용 부품이 덮어써진다(이식기와 같은 판단).
 *  8. **한 건이 실패해도 멈추지 않는다.** 던지는 것까지 받아 세고 다음으로 간다.
 *  9. 🔴 **`--apply` 는 한 건을 한 트랜잭션으로** 처리하고, 그 안에서 **잠그고 다시
 *     잰다.** 계획을 찍은 순간과 쓰는 순간 사이에 바뀐 건은 `changed` 로 건너뛴다.
 * 10. **결과를 갈래별로 센다.** 합계가 훑은 흔적 수와 같아야 한다.
 * 11. **기록 JSON 을 남긴다**(부르는 쪽인 CLI 가 쓴다). 🔴 **고객 글자를 싣지
 *     않는다** — 우리 표의 id, 접수번호, 개수, 해시, 그리고 파일 이름뿐이다.
 *     ⚠️ 파일 이름에는 모델·S/N 이 섞일 수 있어 기록 파일은 **저장소 밖**에만 쓴다
 *     (CLI 의 `--out` 검사 — 일괄 이식 러너와 같은 규칙).
 *
 * ── 🔴 감사 이력이 되돌리기와 부딪히지 않는다 ───────────────────────────
 * 되돌리기 도구는 **옛 흔적**(`usedPartIds` 칸이 없는 것)을 다룰 때 `audit_logs`
 * 에서 「흔적과 `created_at` 이 글자까지 같고 `newValue->>'source'` 가
 * `KYOSAN_REPORT` 인 줄」을 찾는다. 이 백필이 남기는 감사 줄의 `created_at` 은
 * **지금 시각**이고 흔적의 `created_at` 은 이식하던 때 그대로라 **겹칠 수 없다.**
 * 게다가 백필이 손대는 흔적은 `usedPartIds` 가 있는 새 흔적뿐이라 그 경로를 애초에
 * 타지 않는다(안전장치 5 의 `legacy-trace` 갈래).
 *
 * ── ⚠️ `status_change_histories` 를 UPDATE 하는 **첫 자리**다 ─────────────
 * 그 표의 스키마 주석은 「Immutable/append-only: no update path anywhere in the
 * mutation layer」라고 적고 있고, 실제로 앱의 mutation 층에는 UPDATE 가 하나도
 * 없다(실측 2026-10-28: 저장소 전체에서 `update(statusChangeHistories)` 는 되돌리기
 * 시험 둘뿐이다). 그래도 여기서 한 칸을 고치는 까닭:
 *   · 이 파일은 **앱이 아니라 사람이 승인해서 돌리는 도구**다. 같은 자리에서
 *     되돌리기 도구는 그 표의 **행을 지우기까지** 한다(`applyKyosanRevert`).
 *   · 고치는 것은 `metadata` **한 칸**이고, 그 칸의 뜻은 「이 이식이 만든 줄이
 *     무엇인가」다 — 줄이 바뀌었으니 그 칸이 따라가야 **사실**이 된다. 안 고치면
 *     흔적이 없어진 줄을 가리키고, 그 순간 되돌리기가 그 흔적을 영영 건너뛴다.
 *   · `action_type` · `from/to_step_id` · `actor_user_id` · `reason` ·
 *     `created_at` 은 건드리지 않는다 — **무슨 일이 있었나**는 그대로다.
 * ============================================================================
 */

import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { and, asc, eq, sql } from "drizzle-orm";

import { db } from "../../src/lib/db/connection";
import { repairCaseUsedParts, repairCases, statusChangeHistories } from "../../src/lib/db/schema";
import { insertAuditLog } from "../../src/lib/db/mutations/audit-logs";
import { KYOSAN_REPORT_SOURCE } from "../../src/lib/db/queries/kyosan-report-link";
import {
  hasLivePartRequest,
  isImportedFromKyosanIntake,
} from "../../src/lib/db/queries/repair-case-used-parts";
import { resolveUsedPartsWriteGate } from "../../src/lib/auth/repair-case-used-parts-authorization";
import type { InventoryPartRequestTrace } from "../../src/lib/domain/inventory-gateway";
import { probeInventoryPartRequestTrace } from "../../src/lib/server/inventory-gateway";
import { readKyosanReport } from "../../src/lib/kyosan/kyosan-report";
import { buildKyosanPreviewParts } from "../../src/lib/kyosan/report-preview";
import { isKyosanNonDocumentFile } from "./kyosan-import-run-plan";
import { readKyosanTraceMetadata } from "./kyosan-import-revert-plan";
import {
  KYOSAN_BACKFILL_OUTCOME_LABEL,
  KYOSAN_BACKFILL_OUTCOME_ORDER,
  KYOSAN_BACKFILL_RETRYABLE_OUTCOMES,
  backfillLinesAreIdentical,
  backfillQuantityTotal,
  backfillRowsMatchTrace,
  backfillTallyTotal,
  buildBackfillNextLines,
  classifyBackfillTraceShape,
  tallyBackfillOutcomes,
  type BackfillNextLine,
  type BackfillUsedPartRow,
  type KyosanBackfillTally,
  type KyosanUsedPartsBackfillOutcome,
} from "./kyosan-used-parts-backfill-plan";

// ─────────────────────────────────────────────── 파일을 해시로 세운다

export type KyosanWorkbookByHash = {
  /** sha256 → 그 내용을 가진 **첫 번째** 파일(경로 차례). */
  byHash: Map<string, { filePath: string; fileName: string }>;
  /** 🔴 내용이 같은 파일 묶음(둘 이상). 알리기만 한다 — 어느 쪽을 읽어도 같다. */
  duplicateGroups: { sha256: string; fileNames: string[] }[];
  scannedFileCount: number;
};

/**
 * 훑은 파일을 **내용(sha256)으로** 세운다. 🔴 이름으로 가르지 않는다 — 백업된 두
 * 폴더는 파일 이름이 겹치지만 내용은 전부 다르다(일괄 이식 러너의 같은 실측).
 *
 * 내용이 같은 파일이 둘이면 **먼저 나온 한 장**만 읽는다. 바이트가 같으니 어느
 * 쪽을 읽어도 결과가 같고, 그래도 사람에게는 알린다.
 */
export async function indexKyosanWorkbooksByHash(
  filePaths: readonly string[]
): Promise<KyosanWorkbookByHash> {
  const byHash = new Map<string, { filePath: string; fileName: string }>();
  const names = new Map<string, string[]>();

  for (const filePath of filePaths) {
    const bytes = await fs.readFile(filePath);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const fileName = path.basename(filePath);
    names.set(sha256, [...(names.get(sha256) ?? []), fileName]);
    if (!byHash.has(sha256)) byHash.set(sha256, { filePath, fileName });
  }

  const duplicateGroups: { sha256: string; fileNames: string[] }[] = [];
  for (const [sha256, fileNames] of names) {
    if (fileNames.length > 1) duplicateGroups.push({ sha256, fileNames });
  }
  return { byHash, duplicateGroups, scannedFileCount: filePaths.length };
}

// ─────────────────────────────────────────────── 흔적 읽기

export type KyosanBackfillTraceRow = {
  traceId: string;
  repairCaseId: string | null;
  intakeNumber: string | null;
  isDeleted: boolean | null;
  isLocked: boolean | null;
  sourceSha256: string | null;
  usedPartIds: readonly string[] | null;
  usedPartCount: number | null;
  /** 그 수리 건에 달린 연락서 이식 흔적의 수(자기 자신 포함). */
  traceCountForCase: number;
};

/**
 * 🔴 **연락서 이식 흔적을 전부 읽는다** — 일괄 이식 러너가 넣은 것도, 화면에서 한
 * 장씩 넣은 것도 같은 모양이라 함께 잡힌다.
 *
 * `leftJoin` 인 까닭: 주인 없는 흔적(`repair_case_id IS NULL`)도 **보여는 준다.**
 * 대상에서 빼는 것은 순수 함수의 일이고, 안 보이면 사람이 왜 빠졌는지 모른다
 * (되돌리기 도구의 같은 규율).
 */
export async function loadKyosanReportTraces(): Promise<KyosanBackfillTraceRow[]> {
  const rows = await db
    .select({
      traceId: statusChangeHistories.id,
      repairCaseId: statusChangeHistories.repairCaseId,
      metadata: statusChangeHistories.metadata,
      intakeNumber: repairCases.intakeNumber,
      isDeleted: repairCases.isDeleted,
      isLocked: repairCases.isLocked,
    })
    .from(statusChangeHistories)
    .leftJoin(repairCases, eq(repairCases.id, statusChangeHistories.repairCaseId))
    .where(sql`${statusChangeHistories.metadata} ->> 'source' = ${KYOSAN_REPORT_SOURCE}`)
    // 사람이 세로로 훑어 읽는 표라 접수번호 차례로. 같은 건 안에서는 넣은 차례로.
    .orderBy(
      asc(repairCases.intakeNumber),
      asc(statusChangeHistories.createdAt),
      asc(statusChangeHistories.id)
    );

  const countByCase = new Map<string, number>();
  for (const row of rows) {
    if (row.repairCaseId === null) continue;
    countByCase.set(row.repairCaseId, (countByCase.get(row.repairCaseId) ?? 0) + 1);
  }

  return rows.map((row) => {
    // 🔴 흔적 metadata 를 읽는 자는 하나다 — 되돌리기 도구의 그 함수를 그대로 쓴다.
    const metadata = readKyosanTraceMetadata(row.metadata);
    return {
      traceId: row.traceId,
      repairCaseId: row.repairCaseId,
      intakeNumber: row.intakeNumber,
      isDeleted: row.isDeleted,
      isLocked: row.isLocked,
      sourceSha256: metadata.sourceSha256,
      usedPartIds: metadata.usedPartIds,
      usedPartCount: metadata.usedPartCount,
      traceCountForCase: row.repairCaseId === null ? 0 : (countByCase.get(row.repairCaseId) ?? 0),
    };
  });
}

// ─────────────────────────────────────────────── 기록의 모양

export type KyosanBackfillTraceRecord = {
  /** 1부터. 진행 표시와 같은 수다. */
  index: number;
  traceId: string;
  repairCaseId: string | null;
  intakeNumber: string | null;
  sourceSha256: string;
  /** 해시로 짝지은 연락서 파일 이름. ⚠️ 기록 파일은 저장소 밖에만(머리말 11). */
  fileName: string;
  outcome: KyosanUsedPartsBackfillOutcome;
  /** 바꾸기 전 줄 수(= 흔적이 말한 이식 줄 수). */
  previousLineCount: number;
  /** 바꾼(또는 바꿀) 줄 수. 안 바꾸는 갈래에서는 0. */
  nextLineCount: number;
  previousQuantityTotal: number;
  nextQuantityTotal: number;
  /** 🔴 사람이 읽을 한 문장. 값(부품 이름)은 담지 않는다 — 개수와 까닭뿐이다. */
  message: string | null;
};

export type KyosanUsedPartsBackfillRecord = {
  ranAt: string;
  databaseName: string;
  mode: "dry-run" | "apply";
  /** 🔴 한 회차를 묶는 번호. 계획에서는 `null` — 아무것도 안 바꿨다. */
  backfillRunId: string | null;
  actorUserId: string | null;
  /** 폴더·파일에서 찾은 연락서 장수. */
  scannedFileCount: number;
  /** DB 에 있는 연락서 이식 흔적 수(짝을 못 지은 것까지 전부). */
  traceCount: number;
  /** 🔴 해시가 짝지지 않은 흔적 — 그 연락서 파일이 훑은 자리에 없다. */
  unmatchedTraceIntakeNumbers: readonly string[];
  /** 흔적이 없는 연락서 파일 수(= 아직 한 번도 이식되지 않은 장). */
  orphanFileCount: number;
  tally: KyosanBackfillTally;
  /** 🔴 **바뀌는 건만** 더한 줄 수 — 「N줄 → M줄」의 그 수다. */
  changedPreviousLineTotal: number;
  changedNextLineTotal: number;
  /** 🔴 수량 합계. 묶기가 수량을 더하므로 **전후가 같아야** 정상이다. */
  changedPreviousQuantityTotal: number;
  changedNextQuantityTotal: number;
  duplicateHashGroups: readonly { sha256: string; fileNames: readonly string[] }[];
  traces: readonly KyosanBackfillTraceRecord[];
};

export type KyosanUsedPartsBackfillOptions = {
  /** 절대 경로. `collectKyosanWorkbookPaths` 가 만든 차례 그대로. */
  workbookPaths: readonly string[];
  /** 🔴 `false` 면 DB 에 한 글자도 쓰지 않는다. */
  apply: boolean;
  databaseName: string;
  /** apply 일 때 감사 이력에 남길 사람. 없으면 부르는 쪽이 찾아 넘긴다. */
  actorUserId?: string;
  /** apply 일 때 한 번 만들어 모든 흔적에 같은 값을 적는다. 시험이 값을 지정한다. */
  backfillRunId?: string;
  /**
   * 🔴 **짝지은 흔적** 앞 N건만. 짝을 못 지은 흔적은 이 수에 들지 않는다 —
   * 「표본 열 건」이 늘 열 건이 되게 하려는 것이다.
   */
  limit?: number | null;
  /** 진행 한 줄. 없으면 아무것도 찍지 않는다(시험이 조용히 돌 수 있게). */
  onProgress?: (line: string) => void;
};

// ─────────────────────────────────────────────── 한 건

/**
 * 트랜잭션을 되돌리면서 갈래를 밖으로 나르는 통. 🔴 던져야 롤백이 된다
 * (이식기의 `ImportAbort` 와 같은 모양).
 */
class BackfillAbort extends Error {
  constructor(
    readonly outcome: KyosanUsedPartsBackfillOutcome,
    message: string
  ) {
    super(message);
    this.name = "BackfillAbort";
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 그 건의 사용 부품 줄 전부(차례대로). 계획도 `--apply` 도 **같은 이 함수**를 쓴다. */
async function readUsedPartRows(
  executor: Pick<typeof db, "select">,
  repairCaseId: string
): Promise<BackfillUsedPartRow[]> {
  return executor
    .select({
      id: repairCaseUsedParts.id,
      lineNo: repairCaseUsedParts.lineNo,
      partId: repairCaseUsedParts.partId,
      partNameText: repairCaseUsedParts.partNameText,
      quantity: repairCaseUsedParts.quantity,
    })
    .from(repairCaseUsedParts)
    .where(eq(repairCaseUsedParts.repairCaseId, repairCaseId))
    .orderBy(asc(repairCaseUsedParts.lineNo));
}

type Evaluated =
  | { kind: "stop"; outcome: KyosanUsedPartsBackfillOutcome; message: string | null }
  | {
      kind: "go";
      repairCaseId: string;
      intakeNumber: string;
      previousRows: BackfillUsedPartRow[];
      nextLines: BackfillNextLine[];
    };

/**
 * 🔴 **읽기만 한다.** 계획(dry-run)이 그대로 쓰고, `--apply` 도 이 판정을 먼저
 * 거친 뒤에야 트랜잭션을 연다.
 *
 * 차례에 뜻이 있다 — **이식기가 저장 직전에 보는 차례 그대로**다:
 *   교체 부품 0건이면 칸을 안 비운다 → 「모른다」면 막는다 → 게이트 → 부품 요청
 *   흔적이 있으면 안 넣는다 (`kyosan-report-import.ts` 의 1-2 묶음 +
 *   `replaceUsedParts` 의 맨 앞 네 갈래).
 * 🔴 갈라지면 백필이 이식과 다른 답을 낸다.
 *
 * 🔵 그 사이에 **백필만의 검사가 둘** 끼어 있다 — 「지금 줄이 흔적이 말한 그
 *    줄인가」(안전장치 5)와 「이미 같은가」다. 둘 다 **더 막는 쪽**이라 이식기보다
 *    느슨해지는 자리가 없다. 「이미 같은가」를 재고 관리에 묻기 **전에** 두는 까닭:
 *    바꿀 것이 없는데 저쪽을 두드릴 까닭이 없고(두 번째 실행에서 수백 번이다),
 *    저쪽이 멈춰 있다고 「이미 끝난 건」이 `inventory-unknown` 으로 찍히면 사람이
 *    다시 돌릴 거리로 오해한다.
 */
async function evaluateTrace(
  trace: KyosanBackfillTraceRow,
  file: { filePath: string; fileName: string }
): Promise<Evaluated> {
  const shape = classifyBackfillTraceShape({
    caseAlive: trace.repairCaseId !== null && trace.isDeleted === false,
    traceCountForCase: trace.traceCountForCase,
    usedPartIds: trace.usedPartIds,
    usedPartCount: trace.usedPartCount,
  });
  if (shape !== null) {
    return { kind: "stop", outcome: shape, message: backfillShapeMessage(shape, trace) };
  }
  // 🔴 위 판정을 지났으면 셋 다 값이 있다 — 타입을 좁히는 자리다.
  const repairCaseId = trace.repairCaseId;
  const intakeNumber = trace.intakeNumber;
  const usedPartIds = trace.usedPartIds;
  if (repairCaseId === null || intakeNumber === null || usedPartIds === null) {
    return { kind: "stop", outcome: "case-missing", message: "수리 건을 읽지 못했습니다." };
  }

  const bytes = await fs.readFile(file.filePath);
  if (isKyosanNonDocumentFile(bytes)) {
    return {
      kind: "stop",
      outcome: "non-document",
      message: `${bytes.length}바이트 · 통합문서(ZIP)가 아닙니다 — 엑셀 잠금 파일·자리표시자입니다.`,
    };
  }
  const read = readKyosanReport(bytes);
  if (!read.ok) return { kind: "stop", outcome: "unreadable", message: read.detail };

  // 🔴 미리보기와 **같은 함수**로 교체 부품을 뽑는다. 품번으로 읽는 2026-10-28 의
  //    고침이 여기로 그대로 들어온다 — 이 백필이 하려는 일이 바로 그것이다.
  const parts = buildKyosanPreviewParts(read.report);
  if (parts.length === 0) {
    return {
      kind: "stop",
      outcome: "no-parts-in-report",
      message: "이 연락서에는 교체 부품이 없습니다 — 칸을 비우지 않습니다.",
    };
  }

  const previousRows = await readUsedPartRows(db, repairCaseId);
  if (!backfillRowsMatchTrace(previousRows, usedPartIds)) {
    return {
      kind: "stop",
      outcome: "row-mismatch",
      message:
        `흔적은 이식이 ${usedPartIds.length}줄을 넣었다고 말하는데 지금 칸에는 ` +
        `${previousRows.length}줄이 있고 그 줄이 같지 않습니다 — 사람이 그 뒤에 고쳤습니다. 손대지 않습니다.`,
    };
  }

  const nextLines = buildBackfillNextLines(parts);
  if (backfillLinesAreIdentical(previousRows, nextLines)) {
    return {
      kind: "stop",
      outcome: "unchanged",
      message: `${nextLines.length}줄이 이미 같습니다 — 한 글자도 쓰지 않았습니다.`,
    };
  }

  // 🔴 **「모른다」를 「없다」로 바꾸지 않는다**(이식기 1-2 묶음과 같은 판단).
  const partRequestTrace: InventoryPartRequestTrace =
    await probeInventoryPartRequestTrace(intakeNumber);
  if (partRequestTrace.kind === "unknown") {
    return {
      kind: "stop",
      outcome: "inventory-unknown",
      message:
        "재고 관리에 이 건의 부품 요청 이력을 물어보지 못했습니다 — 사용 부품을 덮어쓰지 않았습니다. " +
        "저쪽이 돌아온 뒤 그대로 다시 돌리면 들어갑니다.",
    };
  }

  const gate = await resolveGate(db, { repairCaseId, isShipmentLocked: trace.isLocked === true });
  if (!gate.ok) return { kind: "stop", outcome: "gate-blocked", message: gate.message };

  if (partRequestTrace.kind === "present") {
    return {
      kind: "stop",
      outcome: "part-request-present",
      message:
        `이 건에는 재고 관리에 올라간 부품 요청(반출) 신청이 ${partRequestTrace.count}건 있습니다. ` +
        "그 요청에서 잡히므로 덮어쓰지 않았습니다.",
    };
  }

  return { kind: "go", repairCaseId, intakeNumber, previousRows, nextLines };
}

/** 🔴 사용 부품 칸의 규칙 셋 — **그 판정 함수와 probe 둘을 그대로** 부른다. */
async function resolveGate(
  executor: Pick<typeof db, "select">,
  params: { repairCaseId: string; isShipmentLocked: boolean }
) {
  return resolveUsedPartsWriteGate({
    // 🔴 권한은 보지 않는다 — 이 통로는 화면 칸이 아니라 사람이 승인해 돌리는
    //    서버 도구다(이식기의 `replaceUsedParts` 가 같은 자리에 `true` 를 넣는다).
    canWriteUsedParts: true,
    hasPartRequestHistory: await hasLivePartRequest(executor, params.repairCaseId),
    isShipmentLocked: params.isShipmentLocked,
    isLegacyImportedCase: await isImportedFromKyosanIntake(executor, params.repairCaseId),
  });
}

function backfillShapeMessage(
  outcome: KyosanUsedPartsBackfillOutcome,
  trace: KyosanBackfillTraceRow
): string {
  switch (outcome) {
    case "case-missing":
      return "흔적의 주인 수리 건이 없거나 휴지통에 있습니다.";
    case "multi-trace":
      return (
        `이 수리 건에는 연락서 이식 흔적이 ${trace.traceCountForCase}개 있습니다 — ` +
        "어느 장의 부품이 남아야 하는지 도구가 정할 수 없어 손대지 않습니다."
      );
    case "legacy-trace":
      return (
        "흔적에 `usedPartIds` 가 없습니다(2026-09-28 이전의 옛 흔적) — " +
        "갈아 끼울 칸이 없어 손대지 않습니다. 사람이 따로 정해야 합니다."
      );
    case "trace-inconsistent":
      return (
        `흔적 안에서 개수가 어긋납니다 — usedPartCount ${String(trace.usedPartCount)} · ` +
        `usedPartIds ${String(trace.usedPartIds?.length)}개.`
      );
    case "no-imported-parts":
      return "그 이식은 사용 부품을 한 줄도 넣지 않았습니다 — 백필이 새로 넣지 않습니다.";
    default:
      return "";
  }
}

/**
 * 🔴 **`--apply` 한 건.** 잠그고 · 다시 재고 · 갈아 끼운다. 계획을 찍은 순간과
 * 지금 사이에 하나라도 달라졌으면 **한 글자도 안 쓰고** `changed` 로 돌아간다.
 */
async function applyOneTrace(params: {
  trace: KyosanBackfillTraceRow;
  repairCaseId: string;
  intakeNumber: string;
  nextLines: readonly BackfillNextLine[];
  actorUserId: string;
  backfillRunId: string;
}): Promise<{ outcome: KyosanUsedPartsBackfillOutcome; message: string | null; insertedIds: string[] }> {
  try {
    return await db.transaction(async (tx) => {
      const [locked] = await tx
        .select({
          id: repairCases.id,
          intakeNumber: repairCases.intakeNumber,
          isDeleted: repairCases.isDeleted,
          isLocked: repairCases.isLocked,
        })
        .from(repairCases)
        .where(eq(repairCases.id, params.repairCaseId))
        .limit(1)
        .for("update");
      if (!locked || locked.isDeleted) {
        throw new BackfillAbort("changed", "수리 건이 그 사이에 사라졌거나 휴지통으로 갔습니다.");
      }
      // 🔴 재고 관리에 물은 열쇠가 **접수번호**다 — 그 번호가 바뀌었으면 그 답을 쓸 수 없다.
      if (locked.intakeNumber !== params.intakeNumber) {
        throw new BackfillAbort("changed", "수리 건의 접수번호가 그 사이에 바뀌었습니다.");
      }

      // ── 흔적을 다시 읽는다. 🔴 여전히 **하나**여야 하고 같은 흔적이어야 한다 ──
      const freshTraces = await tx
        .select({ id: statusChangeHistories.id, metadata: statusChangeHistories.metadata })
        .from(statusChangeHistories)
        .where(
          and(
            eq(statusChangeHistories.repairCaseId, params.repairCaseId),
            sql`${statusChangeHistories.metadata} ->> 'source' = ${KYOSAN_REPORT_SOURCE}`
          )
        );
      if (freshTraces.length !== 1 || freshTraces[0].id !== params.trace.traceId) {
        throw new BackfillAbort(
          "changed",
          `그 사이에 이 건의 연락서 흔적이 ${freshTraces.length}개가 되었습니다.`
        );
      }
      const freshMetadata = readKyosanTraceMetadata(freshTraces[0].metadata);
      if (freshMetadata.usedPartIds === null) {
        throw new BackfillAbort("changed", "그 사이에 흔적의 usedPartIds 가 사라졌습니다.");
      }

      // ── 줄도 다시 읽는다. 🔴 사람이 그 사이에 고쳤으면 한 줄도 안 건드린다 ──
      const freshRows = await readUsedPartRows(tx, params.repairCaseId);
      if (!backfillRowsMatchTrace(freshRows, freshMetadata.usedPartIds)) {
        throw new BackfillAbort("changed", "그 사이에 사용 부품 줄이 바뀌었습니다.");
      }
      if (backfillLinesAreIdentical(freshRows, params.nextLines)) {
        throw new BackfillAbort("unchanged", "그 사이에 이미 같은 값이 되었습니다.");
      }

      // ── 게이트를 **잠금 안에서** 다시 본다(그 사이에 반출 신청이 설 수 있다) ──
      const gate = await resolveGate(tx, {
        repairCaseId: params.repairCaseId,
        isShipmentLocked: locked.isLocked,
      });
      if (!gate.ok) throw new BackfillAbort("gate-blocked", gate.message);

      // ⚠️ **반드시 `repair_case_id` 로 좁힌다.** 조건 없는 delete 는 이 표를 통째로
      //    비운다(`mutations/repair-case-used-parts.ts` · `replaceUsedParts` 의 같은 경고).
      await tx
        .delete(repairCaseUsedParts)
        .where(eq(repairCaseUsedParts.repairCaseId, params.repairCaseId));

      const insertedRows = await tx
        .insert(repairCaseUsedParts)
        .values(
          params.nextLines.map((line) => ({
            repairCaseId: params.repairCaseId,
            lineNo: line.lineNo,
            // 🔴 부품 대장과 이어 붙이지 않는다 — 이식이 넣는 줄과 같은 모양이다.
            partId: null,
            partNameText: line.partNameText,
            quantity: line.quantity,
          }))
        )
        .returning({ id: repairCaseUsedParts.id });
      const insertedIds = insertedRows.map((row) => row.id);

      // 건의 version 을 올린다 — 사용 부품 저장이 쓰는 바로 그 번호다. 화면이 열어 둔
      // 폼은 다음 저장에서 CONFLICT 를 받고 다시 불러온다(그것이 맞는 신호다).
      await tx
        .update(repairCases)
        .set({ version: sql`${repairCases.version} + 1`, updatedAt: sql`now()` })
        .where(eq(repairCases.id, params.repairCaseId));

      // 🔴 **사라진 줄을 되짚을 유일한 자리**다(되돌리기 도구는 못 되살린다 —
      //    `replaceUsedParts` 머리말의 「무엇을 잃는가」와 같은 규율).
      await insertAuditLog(tx, {
        actorUserId: params.actorUserId,
        actionType: "UPDATE",
        targetEntity: "repair_case_used_parts",
        targetRecordId: params.repairCaseId,
        previousValue: {
          lines: freshRows.map((row) => ({
            lineNo: row.lineNo,
            partId: row.partId,
            partNameText: row.partNameText,
            quantity: row.quantity,
          })),
        },
        newValue: {
          lines: params.nextLines.map((line) => ({
            lineNo: line.lineNo,
            partId: null,
            partNameText: line.partNameText,
            quantity: line.quantity,
          })),
          source: KYOSAN_REPORT_SOURCE,
          // 🔴 어느 회차가 고친 줄인지 — 기록 JSON 과 이 줄이 이 번호로 이어진다.
          usedPartsBackfillRunId: params.backfillRunId,
        },
      });

      // ── 🔴 흔적의 `metadata` 한 칸을 갈아 끼운다(머리말 안전장치 4) ──
      const base = asRecord(freshTraces[0].metadata) ?? {};
      const history = Array.isArray(base.usedPartsBackfills) ? base.usedPartsBackfills : [];
      await tx
        .update(statusChangeHistories)
        .set({
          metadata: {
            ...base,
            usedPartCount: insertedIds.length,
            usedPartIds: insertedIds,
            // 🔴 담는 것은 **우리 표의 id 와 개수와 시각**뿐이다 — 부품 이름도 파일
            //    이름도 싣지 않는다(이식 흔적과 같은 규율).
            usedPartsBackfills: [
              ...history,
              {
                runId: params.backfillRunId,
                at: new Date().toISOString(),
                previousUsedPartCount: freshMetadata.usedPartCount,
                previousUsedPartIds: freshMetadata.usedPartIds,
              },
            ],
          },
        })
        .where(eq(statusChangeHistories.id, params.trace.traceId));

      return {
        outcome: "updated" as const,
        message: `${freshRows.length}줄 → ${insertedIds.length}줄`,
        insertedIds,
      };
    });
  } catch (error) {
    if (error instanceof BackfillAbort) {
      return { outcome: error.outcome, message: error.message, insertedIds: [] };
    }
    throw error;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

// ─────────────────────────────────────────────── 한 회차

function blankRecord(
  index: number,
  trace: KyosanBackfillTraceRow,
  fileName: string
): KyosanBackfillTraceRecord {
  return {
    index,
    traceId: trace.traceId,
    repairCaseId: trace.repairCaseId,
    intakeNumber: trace.intakeNumber,
    sourceSha256: trace.sourceSha256 ?? "",
    fileName,
    outcome: "failed",
    previousLineCount: trace.usedPartCount ?? 0,
    nextLineCount: 0,
    previousQuantityTotal: 0,
    nextQuantityTotal: 0,
    message: null,
  };
}

function progressLine(record: KyosanBackfillTraceRecord, total: number): string {
  const counter = `[${String(record.index).padStart(String(total).length, " ")}/${total}]`;
  const where = record.intakeNumber ?? "(접수번호 없음)";
  const delta =
    record.outcome === "updated" || record.outcome === "updatable"
      ? `  ${record.previousLineCount}줄 → ${record.nextLineCount}줄`
      : "";
  return `${counter} ${where}  ${KYOSAN_BACKFILL_OUTCOME_LABEL[record.outcome]}${delta}`;
}

/**
 * 🔴 한 회차. `apply` 가 아니면 **DB 에 한 글자도 쓰지 않는다.**
 */
export async function runKyosanUsedPartsBackfill(
  options: KyosanUsedPartsBackfillOptions
): Promise<KyosanUsedPartsBackfillRecord> {
  const backfillRunId = options.apply ? (options.backfillRunId ?? randomUUID()) : null;
  const actorUserId = options.apply ? (options.actorUserId ?? null) : null;
  if (options.apply && actorUserId === null) {
    throw new Error("`--apply` 인데 기록에 남길 사람이 없습니다.");
  }

  const indexed = await indexKyosanWorkbooksByHash(options.workbookPaths);
  const allTraces = await loadKyosanReportTraces();

  // 🔴 **해시로 짝짓는다** — 짝짓기를 다시 돌리지 않는다(안전장치 3).
  const matched: { trace: KyosanBackfillTraceRow; file: { filePath: string; fileName: string } }[] = [];
  const unmatchedTraceIntakeNumbers: string[] = [];
  const usedHashes = new Set<string>();
  for (const trace of allTraces) {
    const file = trace.sourceSha256 === null ? undefined : indexed.byHash.get(trace.sourceSha256);
    if (file === undefined) {
      unmatchedTraceIntakeNumbers.push(trace.intakeNumber ?? "(접수번호 없음)");
      continue;
    }
    if (trace.sourceSha256 !== null) usedHashes.add(trace.sourceSha256);
    matched.push({ trace, file });
  }

  const considered =
    options.limit === null || options.limit === undefined ? matched : matched.slice(0, options.limit);

  const traces: KyosanBackfillTraceRecord[] = [];
  const total = considered.length;

  for (const [offset, target] of considered.entries()) {
    const index = offset + 1;
    let record = blankRecord(index, target.trace, target.file.fileName);
    try {
      const evaluated = await evaluateTrace(target.trace, target.file);
      if (evaluated.kind === "stop") {
        record = { ...record, outcome: evaluated.outcome, message: evaluated.message };
      } else {
        const previousQuantityTotal = backfillQuantityTotal(evaluated.previousRows);
        const nextQuantityTotal = backfillQuantityTotal(evaluated.nextLines);
        if (!options.apply) {
          record = {
            ...record,
            outcome: "updatable",
            previousLineCount: evaluated.previousRows.length,
            nextLineCount: evaluated.nextLines.length,
            previousQuantityTotal,
            nextQuantityTotal,
            message: `${evaluated.previousRows.length}줄 → ${evaluated.nextLines.length}줄`,
          };
        } else {
          const applied = await applyOneTrace({
            trace: target.trace,
            repairCaseId: evaluated.repairCaseId,
            intakeNumber: evaluated.intakeNumber,
            nextLines: evaluated.nextLines,
            actorUserId: actorUserId as string,
            backfillRunId: backfillRunId as string,
          });
          const wrote = applied.outcome === "updated";
          record = {
            ...record,
            outcome: applied.outcome,
            previousLineCount: evaluated.previousRows.length,
            nextLineCount: wrote ? evaluated.nextLines.length : 0,
            previousQuantityTotal,
            nextQuantityTotal: wrote ? nextQuantityTotal : 0,
            message: applied.message,
          };
        }
      }
    } catch (error) {
      // 🔴 안전장치 8 — 한 건이 무슨 일을 당해도 나머지가 계속된다.
      record = { ...record, outcome: "failed", message: describeError(error) };
    }
    traces.push(record);
    options.onProgress?.(progressLine(record, total));
  }

  const changed = traces.filter(
    (record) => record.outcome === "updated" || record.outcome === "updatable"
  );

  return {
    ranAt: new Date().toISOString(),
    databaseName: options.databaseName,
    mode: options.apply ? "apply" : "dry-run",
    backfillRunId,
    actorUserId,
    scannedFileCount: indexed.scannedFileCount,
    traceCount: allTraces.length,
    unmatchedTraceIntakeNumbers,
    orphanFileCount: indexed.byHash.size - usedHashes.size,
    tally: tallyBackfillOutcomes(traces.map((record) => record.outcome)),
    changedPreviousLineTotal: changed.reduce((sum, record) => sum + record.previousLineCount, 0),
    changedNextLineTotal: changed.reduce((sum, record) => sum + record.nextLineCount, 0),
    changedPreviousQuantityTotal: changed.reduce(
      (sum, record) => sum + record.previousQuantityTotal,
      0
    ),
    changedNextQuantityTotal: changed.reduce((sum, record) => sum + record.nextQuantityTotal, 0),
    duplicateHashGroups: indexed.duplicateGroups,
    traces,
  };
}

// ─────────────────────────────────────────────── 사람이 읽는 표

/**
 * 한글은 화면에서 두 칸을 먹는다 — `padEnd` 는 글자 수로 세므로 섞인 칸이
 * 어긋난다(일괄 이식 러너·되돌리기 도구의 같은 함수).
 */
function padLabel(label: string, columns: number): string {
  let width = 0;
  for (const character of label) width += /[ᄀ-ᇿ⺀-꓏가-힣豈-﫿︰-﹏]/u.test(character) ? 2 : 1;
  return label + " ".repeat(Math.max(0, columns - width));
}

export function formatKyosanUsedPartsBackfillSummary(
  record: KyosanUsedPartsBackfillRecord
): string {
  const lines: string[] = [];

  lines.push("=== 갈래별 합계 ===");
  for (const outcome of KYOSAN_BACKFILL_OUTCOME_ORDER) {
    const count = record.tally[outcome];
    // 계획에는 `updated` 가, `--apply` 에는 `updatable` 이 있을 수 없다 — 그 칸은 감춘다.
    if (count === 0 && (outcome === "updated" || outcome === "updatable")) continue;
    lines.push(
      `  ${padLabel(KYOSAN_BACKFILL_OUTCOME_LABEL[outcome], 30)}${String(count).padStart(4, " ")}건`
    );
  }
  lines.push(`  ${padLabel("(합계)", 30)}${String(backfillTallyTotal(record.tally)).padStart(4, " ")}건`);
  lines.push("");

  // 🔴 「몇 줄이 바뀌는가」 — 사람이 승인하려면 이 수를 봐야 한다.
  const label = record.mode === "apply" ? "바꾼" : "바꿀";
  lines.push(`=== 🔴 ${label} 줄 수 ===`);
  lines.push(
    `  사용 부품   ${record.changedPreviousLineTotal}줄 → ${record.changedNextLineTotal}줄`
  );
  lines.push(
    `  수량 합계   ${record.changedPreviousQuantityTotal} → ${record.changedNextQuantityTotal}` +
      (record.changedPreviousQuantityTotal === record.changedNextQuantityTotal
        ? "  (같다 — 정상)"
        : "  ⚠ 달라졌다. 연락서 쪽에서 수량을 다시 읽은 결과다 — 표본을 눈으로 볼 것")
  );
  lines.push("");

  lines.push("=== 훑은 자리 ===");
  lines.push(`  연락서 파일            ${record.scannedFileCount}장`);
  lines.push(`  연락서 이식 흔적       ${record.traceCount}건 (DB 전체)`);
  lines.push(`  🔴 해시가 짝지지 않은 흔적  ${record.unmatchedTraceIntakeNumbers.length}건`);
  if (record.unmatchedTraceIntakeNumbers.length > 0) {
    lines.push(
      "     (그 연락서 파일이 훑은 자리에 없다 — 폴더를 덜 주었거나 원본이 사라졌다. 아래 접수번호)"
    );
    for (const intakeNumber of record.unmatchedTraceIntakeNumbers) lines.push(`     ${intakeNumber}`);
  }
  lines.push(`  흔적이 없는 연락서 파일  ${record.orphanFileCount}장 (아직 한 번도 이식되지 않은 장)`);
  lines.push("");

  /**
   * 🔴 **그대로 다시 돌리면 들어가는 건은 접수번호를 전부 찍는다.**
   * 사람이 알아야 하는 것이 「몇 건」이 아니라 **「어느 건」**이기 때문이다 — 수만
   * 찍으면 그 몇 건을 다시 찾는 길이 기록 JSON 을 손으로 뒤지는 것뿐이다
   * (일괄 이식 러너의 `inventory-unknown` 표와 같은 자리).
   */
  const retryable = record.traces.filter((trace) =>
    KYOSAN_BACKFILL_RETRYABLE_OUTCOMES.includes(trace.outcome)
  );
  lines.push(`=== 🔴 그대로 다시 돌리면 되는 건: ${retryable.length}건 ===`);
  if (retryable.length === 0) {
    lines.push("  (없음)");
  } else {
    for (const trace of retryable) {
      lines.push(
        `  ${trace.intakeNumber ?? "(접수번호 없음)"}  ${KYOSAN_BACKFILL_OUTCOME_LABEL[trace.outcome]}`
      );
    }
    lines.push("  🔴 **실패가 아니다** — 재고 관리가 멈췄거나 그 사이에 자료가 바뀐 것이고,");
    lines.push("     아무것도 쓰지 않았다. 나중에 같은 명령을 그대로 다시 돌리면 된다.");
  }
  lines.push("");

  // 🔴 사람이 **봐야 하는** 건 — 조용히 지나가면 안 되는 갈래들.
  const needsHuman = record.traces.filter(
    (trace) =>
      trace.outcome === "legacy-trace" ||
      trace.outcome === "trace-inconsistent" ||
      trace.outcome === "multi-trace" ||
      trace.outcome === "row-mismatch" ||
      trace.outcome === "gate-blocked" ||
      trace.outcome === "case-missing" ||
      trace.outcome === "unreadable" ||
      trace.outcome === "failed"
  );
  lines.push(`=== 🔴 사람이 따로 정해야 하는 건: ${needsHuman.length}건 ===`);
  if (needsHuman.length === 0) {
    lines.push("  (없음)");
  } else {
    for (const trace of needsHuman) {
      lines.push(
        `  ${trace.intakeNumber ?? "(접수번호 없음)"}  ${KYOSAN_BACKFILL_OUTCOME_LABEL[trace.outcome]}` +
          (trace.message === null ? "" : `\n     ${trace.message}`)
      );
    }
  }
  lines.push("");

  lines.push(`=== 내용이 같은 파일(sha256) — ${record.duplicateHashGroups.length}묶음 ===`);
  if (record.duplicateHashGroups.length === 0) {
    lines.push("  (없음 — 훑은 파일의 내용이 전부 다르다)");
  }
  for (const group of record.duplicateHashGroups) {
    lines.push(`  ${group.sha256.slice(0, 12)}…  ${group.fileNames.join(" · ")}`);
  }
  lines.push("  (바이트가 같으니 어느 장을 읽어도 결과가 같다 — 먼저 나온 한 장만 읽는다.)");
  lines.push("");
  lines.push("  🔴 이 도구는 작업 기록 · 첨부 · 신고 증상 · 보고서를 한 줄도 건드리지 않는다.");
  lines.push("  🔴 이식 흔적을 새로 만들지 않는다 — 기존 흔적의 사용 부품 id 만 갈아 끼운다.");

  return lines.join("\n");
}
