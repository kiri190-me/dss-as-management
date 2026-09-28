/**
 * ============================================================================
 * 연락서 이식 되돌리기 — DB 와 디스크에 실제로 닿는 쪽 (조각 S5-B)
 * ============================================================================
 * 고르는 규칙은 여기 없다. `kyosan-import-revert-plan.ts` 의 **순수 함수**가
 * 정하고, 이 파일은 그 함수에 먹일 값을 읽어 오고 그 함수가 고른 id 만 지운다.
 * 명령줄 껍데기는 `scripts/revert-kyosan-import.ts` 다.
 *
 * ── 🔴 안전장치 (하나도 빼지 않는다) ────────────────────────────────────
 *  1. **`--apply` 가 없으면 한 글자도 쓰지 않는다.** 계획을 읽는 것도
 *     트랜잭션 안에서 하지만 SELECT 뿐이다(`loadKyosanRevertPlan`).
 *  2. **파일은 지우지 않고 치워 둔다.** `--apply` 라도 `unlink` 하지 않는다 —
 *     격리 폴더로 **옮긴다**(`quarantineAttachmentFiles`). 원래 상대 경로
 *     구조를 그대로 살려 두므로 되돌려 놓을 때 그 폴더를 저장 루트에 덮어
 *     복사하면 된다. 🔴 잘못 지우면 되돌릴 길이 없지만, 옮기면 있다.
 *  3. **개수가 어긋나면 그 흔적을 건너뛴다.** 판정은 순수 함수 쪽에 있다.
 *  4. **못 맞춘 줄은 한 줄도 지우지 않는다.** 같은 곳.
 *  5. **DB 는 한 트랜잭션.** 그리고 🔴 **파일 옮기기는 그 트랜잭션이 커밋된
 *     뒤에** 한다 — 먼저 옮기고 DB 가 되돌아가면 「행은 있는데 파일이 없는」
 *     상태가 된다. 그것은 화면에서 눌러도 아무것도 안 나오는 고장이다.
 *  6. **주인 없는 흔적은 제외**(순수 함수 쪽).
 *  7. **되돌린 내역을 JSON 으로 남긴다** — 부르는 쪽(CLI)이 쓴다.
 *  8. 🔴 **`service_reports` · `quotes` 를 한 줄도 건드리지 않는다.** 이 파일에
 *     그 표를 부르는 줄이 하나도 없다(개발 DB 의 `D260403` 에는 이식 다음 날
 *     다른 경로로 생긴 보고서가 1장 있다 — 그것이 사라지면 안 된다).
 *  9. **`repair_cases.version` 과 `updated_at` 은 되돌리지 않는다.** 낙관적
 *     잠금 번호를 거꾸로 돌리면 화면이 열어 둔 폼이 옛 번호로 저장에 성공해
 *     버린다. 되돌릴 때도 `version` 은 **올린다**.
 * 10. **감사 기록을 남긴다** — 되돌리기도 사람이 한 일이다.
 *
 * ── 🔴 `--apply` 는 트랜잭션 안에서 계획을 **다시 잰다** ─────────────────
 * 사람이 계획을 본 순간과 지우는 순간 사이에 자료가 바뀔 수 있다. 그래서
 * 수리 건 행을 `FOR UPDATE` 로 잠근 뒤 같은 조회를 한 번 더 돌리고,
 * `revertFingerprint` 가 글자까지 같지 않으면 **아무것도 지우지 않고 되돌린다.**
 *
 * ── 왜 `StorageAdapter` 를 쓰지 않는가 ──────────────────────────────────
 * 그 인터페이스에는 「옮기기」가 없다(읽기·쓰기·지우기뿐이다). 지우면 안 되는
 * 것이 이 조각의 요점이라 `node:fs` 로 직접 옮긴다 — 백업 스크립트
 * (`scripts/backup-attachments.ts`)가 같은 이유로 같은 자리에서 fs 를 쓴다.
 * 저장 루트 기준 상대 경로를 절대 경로로 바꾸는 일은 앱과 **같은 함수**
 * (`resolveAttachmentAbsolutePath`)로 한다 — 루트 밖을 가리키면 거기서 던진다.
 *
 * ⚠️ 격리 폴더가 저장 루트 안(`<UPLOADS_DIR>/_reverted`)이면 `npm run
 * backup:attachments` 가 그 파일들도 함께 백업한다(제외 목록은 `.tmp-uploads`
 * 하나뿐이다). 백업이 하나 더 생기는 것이므로 그대로 둔다.
 * ============================================================================
 */

import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

import { and, asc, eq, inArray, sql } from "drizzle-orm";

import { db } from "../../src/lib/db/connection";
import {
  attachments,
  auditLogs,
  repairCaseUsedParts,
  repairCaseWorkRecords,
  repairCases,
  statusChangeHistories,
} from "../../src/lib/db/schema";
import { insertAuditLog } from "../../src/lib/db/mutations/audit-logs";
import { resolveAttachmentAbsolutePath } from "../../src/lib/domain/attachment-path";
import {
  KYOSAN_REPORT_SOURCE,
  countQuarantineFiles,
  countQuarantinePreviewFiles,
  decideTraceRevert,
  legacyUsedPartLinesFromAudit,
  readKyosanTraceMetadata,
  revertFingerprint,
  type AttachmentRowSnapshot,
  type AuditUsedPartLine,
  type SymptomAuditSnapshot,
  type TraceRevertDecision,
  type UsedPartRowSnapshot,
} from "./kyosan-import-revert-plan";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type RevertSelector =
  /** 흔적 한 줄만. */
  | { kind: "trace"; traceId: string }
  /** 일괄 이식 한 회차 전체(S5-A 가 흔적에 실은 `importBatchId`). */
  | { kind: "batch"; importBatchId: string }
  /** 그 수리 건의 연락서 이식 전부. */
  | { kind: "case"; intakeNumber: string };

export type KyosanRevertPlan = {
  selector: RevertSelector;
  decisions: readonly TraceRevertDecision[];
};

export function describeSelector(selector: RevertSelector): string {
  switch (selector.kind) {
    case "trace":
      return `--trace ${selector.traceId}`;
    case "batch":
      return `--batch ${selector.importBatchId}`;
    case "case":
      return `--case ${selector.intakeNumber}`;
  }
}

/** 격리 폴더 · 기록 파일 이름에 쓰는 짧은 이름. 파일명에 쓸 수 있는 글자만 남긴다. */
export function selectorLabel(selector: RevertSelector): string {
  const raw =
    selector.kind === "trace"
      ? `trace-${selector.traceId}`
      : selector.kind === "batch"
        ? `batch-${selector.importBatchId}`
        : `case-${selector.intakeNumber}`;
  return raw.replace(/[^0-9A-Za-z_-]/g, "_");
}

// ─────────────────────────────────────────────── 계획 읽기 (SELECT 뿐이다)

function selectorCondition(selector: RevertSelector) {
  switch (selector.kind) {
    case "trace":
      return eq(statusChangeHistories.id, selector.traceId);
    case "batch":
      return sql`${statusChangeHistories.metadata} ->> 'importBatchId' = ${selector.importBatchId}`;
    case "case":
      return eq(repairCases.intakeNumber, selector.intakeNumber);
  }
}

/**
 * 🔴 **읽기만 한다.** 계획 출력(dry-run)과 `--apply` 안의 재측정이 **같은 이
 * 함수**를 쓴다 — 두 벌로 두면 한쪽만 고쳐지는 날이 온다.
 */
export async function loadKyosanRevertPlan(
  tx: Tx,
  selector: RevertSelector
): Promise<KyosanRevertPlan> {
  const traces = await tx
    .select({
      id: statusChangeHistories.id,
      repairCaseId: statusChangeHistories.repairCaseId,
      /**
       * 🔴 **글자로 읽는다.** `created_at` 은 마이크로초까지 있는데 자바스크립트
       * `Date` 는 밀리초까지밖에 못 담는다 — `Date` 로 받아 다시 비교하면
       * `…439682` 가 `…439000` 이 되어 **같은 트랜잭션의 감사 기록을 못 찾는다**
       * (실측으로 걸렸다). 글자 그대로 받아 `::timestamptz` 로 되돌려 견준다.
       */
      createdAtText: sql<string>`${statusChangeHistories.createdAt}::text`,
      metadata: statusChangeHistories.metadata,
      intakeNumber: repairCases.intakeNumber,
      reportedSymptom: repairCases.reportedSymptom,
    })
    .from(statusChangeHistories)
    // 🔴 leftJoin 이다 — 주인 없는 흔적(`repair_case_id IS NULL`)도 **보여는 준다.**
    //    대상에서 빼는 것은 판정 함수의 일이고, 안 보이면 사람이 왜 빠졌는지 모른다.
    .leftJoin(repairCases, eq(repairCases.id, statusChangeHistories.repairCaseId))
    .where(
      and(
        sql`${statusChangeHistories.metadata} ->> 'source' = ${KYOSAN_REPORT_SOURCE}`,
        selectorCondition(selector)
      )
    )
    .orderBy(asc(statusChangeHistories.createdAt), asc(statusChangeHistories.id));

  // 한 수리 건에 흔적이 여럿일 수 있다 — 건마다 한 번만 읽는다.
  const usedPartCache = new Map<string, UsedPartRowSnapshot[]>();
  const attachmentCache = new Map<string, AttachmentRowSnapshot[]>();

  const decisions: TraceRevertDecision[] = [];

  for (const trace of traces) {
    const metadata = readKyosanTraceMetadata(trace.metadata);
    const repairCaseId = trace.repairCaseId;

    if (repairCaseId === null) {
      decisions.push(
        decideTraceRevert({
          traceId: trace.id,
          repairCaseId: null,
          intakeNumber: null,
          metadata: trace.metadata,
          foundWorkRecordIds: [],
          usedPartRows: [],
          attachmentRows: [],
          legacyUsedPartLines: null,
          symptomAudit: null,
          currentReportedSymptom: null,
        })
      );
      continue;
    }

    if (!usedPartCache.has(repairCaseId)) {
      usedPartCache.set(
        repairCaseId,
        await tx
          .select({
            id: repairCaseUsedParts.id,
            lineNo: repairCaseUsedParts.lineNo,
            partNameText: repairCaseUsedParts.partNameText,
            quantity: repairCaseUsedParts.quantity,
          })
          .from(repairCaseUsedParts)
          .where(eq(repairCaseUsedParts.repairCaseId, repairCaseId))
          .orderBy(asc(repairCaseUsedParts.lineNo))
      );
    }
    if (!attachmentCache.has(repairCaseId)) {
      attachmentCache.set(
        repairCaseId,
        await tx
          .select({
            id: attachments.id,
            category: attachments.category,
            description: attachments.description,
            originalFileName: attachments.originalFileName,
            checksumSha256: attachments.checksumSha256,
            storedPath: attachments.storedPath,
            previewPath: attachments.previewPath,
            isDeleted: attachments.isDeleted,
          })
          .from(attachments)
          .where(eq(attachments.repairCaseId, repairCaseId))
          .orderBy(asc(attachments.uploadedAt), asc(attachments.storedPath))
      );
    }

    const foundWorkRecordIds =
      metadata.workRecordIds.length === 0
        ? []
        : (
            await tx
              .select({ id: repairCaseWorkRecords.id })
              .from(repairCaseWorkRecords)
              .where(
                and(
                  eq(repairCaseWorkRecords.repairCaseId, repairCaseId),
                  inArray(repairCaseWorkRecords.id, [...metadata.workRecordIds])
                )
              )
          ).map((row) => row.id);

    // 🔴 옛 흔적일 때만 감사 스냅숏을 찾는다. 흔적과 감사는 **같은 트랜잭션**에서
    //    쓰였으므로 `created_at` 이 글자까지 같다(Postgres 의 `now()` 는 트랜잭션
    //    안에서 한 값이다). 그것이 「이 흔적의 감사」를 가르는 열쇠다 — 한 건에
    //    연락서를 여러 장 넣었을 때 남의 스냅숏을 집지 않는다.
    let legacyUsedPartLines: AuditUsedPartLine[] | null = null;
    if (metadata.usedPartIds === null && (metadata.usedPartCount ?? 0) > 0) {
      const auditRows = await tx
        .select({ previousValue: auditLogs.previousValue, newValue: auditLogs.newValue })
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.targetEntity, "repair_case_used_parts"),
            eq(auditLogs.targetRecordId, repairCaseId),
            sql`${auditLogs.createdAt} = ${trace.createdAtText}::timestamptz`,
            sql`${auditLogs.newValue} ->> 'source' = ${KYOSAN_REPORT_SOURCE}`
          )
        );
      // 🔴 하나가 아니면 `null` — 어느 것인지 모르는 채로 지우지 않는다.
      legacyUsedPartLines =
        auditRows.length === 1
          ? legacyUsedPartLinesFromAudit({
              previousValue: auditRows[0].previousValue,
              newValue: auditRows[0].newValue,
            })
          : null;
    }

    let symptomAudit: SymptomAuditSnapshot | null = null;
    if (metadata.reportedSymptomFilled === true) {
      const auditRows = await tx
        .select({ previousValue: auditLogs.previousValue, newValue: auditLogs.newValue })
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.targetEntity, "repair_cases"),
            eq(auditLogs.targetRecordId, repairCaseId),
            sql`${auditLogs.createdAt} = ${trace.createdAtText}::timestamptz`,
            sql`${auditLogs.newValue} ->> 'source' = ${KYOSAN_REPORT_SOURCE}`
          )
        );
      if (auditRows.length === 1) {
        const previous = auditRows[0].previousValue as { reportedSymptom?: unknown } | null;
        const next = auditRows[0].newValue as { reportedSymptom?: unknown } | null;
        symptomAudit = {
          previousValue: typeof previous?.reportedSymptom === "string" ? previous.reportedSymptom : null,
          importedValue: typeof next?.reportedSymptom === "string" ? next.reportedSymptom : null,
        };
      }
    }

    decisions.push(
      decideTraceRevert({
        traceId: trace.id,
        repairCaseId,
        intakeNumber: trace.intakeNumber,
        metadata: trace.metadata,
        foundWorkRecordIds,
        usedPartRows: usedPartCache.get(repairCaseId) ?? [],
        attachmentRows: attachmentCache.get(repairCaseId) ?? [],
        legacyUsedPartLines,
        symptomAudit,
        currentReportedSymptom: trace.reportedSymptom,
      })
    );
  }

  return { selector, decisions };
}

/** 계획을 읽기 전용 트랜잭션 안에서 한 번 읽는다(dry-run 이 부르는 자리). */
export function readKyosanRevertPlan(selector: RevertSelector): Promise<KyosanRevertPlan> {
  return db.transaction((tx) => loadKyosanRevertPlan(tx, selector));
}

// ─────────────────────────────────────────────── 계획을 사람이 읽는 글로

/**
 * 한글은 화면에서 두 칸을 먹는다. `padEnd` 는 글자 수로 세므로 한글과 영문이
 * 섞인 칸이 어긋난다 — 여기서 **화면 폭**으로 센다. 계획 출력은 사람이 세로로
 * 훑어 읽는 표라 줄이 맞아야 한다.
 */
function padLabel(label: string, columns: number): string {
  let width = 0;
  for (const character of label) width += /[ᄀ-ᇿ⺀-꓏가-힣豈-﫿︰-﹏]/u.test(character) ? 2 : 1;
  return label + " ".repeat(Math.max(0, columns - width));
}

function formatCount(label: string, value: number, suffix: string): string {
  return `      ${padLabel(label, 13)}${String(value).padStart(3, " ")}${suffix}`;
}

export function formatRevertPlan(plan: KyosanRevertPlan): string {
  const reverts = plan.decisions.filter(
    (decision): decision is Extract<TraceRevertDecision, { kind: "revert" }> => decision.kind === "revert"
  );
  const skips = plan.decisions.filter(
    (decision): decision is Extract<TraceRevertDecision, { kind: "skip" }> => decision.kind === "skip"
  );

  const lines: string[] = [];
  lines.push(`=== 되돌릴 흔적 ${reverts.length}건 ===`);
  if (reverts.length === 0) lines.push("  (없음)");

  reverts.forEach((decision, index) => {
    const photos = decision.photoAttachmentIds.length;
    const sources = decision.attachmentIds.length - photos;
    lines.push(
      `  [${index + 1}] ${decision.intakeNumber ?? "(접수번호 없음)"}  흔적 ${decision.traceId}`
    );
    lines.push(
      `      회차 ${decision.importBatchId ?? "(없음)"} · 단서 ${
        decision.basis === "id" ? "새 흔적(id 로 고름)" : "옛 흔적(개수·체크섬·이름으로 맞춤)"
      }`
    );
    lines.push(formatCount("작업 기록", decision.workRecordIds.length, "줄"));
    lines.push(formatCount("사용 부품", decision.usedPartIds.length, "줄"));
    lines.push(
      formatCount("첨부", decision.attachmentIds.length, `장 (원본 ${sources} · 사진 ${photos})`)
    );
    lines.push(
      `      ${padLabel("신고 증상", 13)}${
        decision.reportedSymptom === null
          ? "건드리지 않는다"
          : `되돌린다 → ${decision.reportedSymptom.restoreTo === null ? "빈 칸" : `${decision.reportedSymptom.restoreTo.length}자`}`
      }`
    );
    // 🔴 **행 수가 아니라 실물 수**다 — 미리보기(썸네일)가 있는 첨부는 파일이 둘이다
    //    (`countQuarantineFiles` 머리말의 2026-09-28 실측: 계획 19 ↔ 실제 37).
    const previewFiles = countQuarantinePreviewFiles(decision.files);
    lines.push(
      formatCount(
        "디스크 파일",
        countQuarantineFiles(decision.files),
        "개를 격리 폴더로 옮긴다" +
          (previewFiles > 0 ? ` (첨부 ${decision.files.length}행 + 미리보기 ${previewFiles}개)` : "")
      )
    );
    lines.push(formatCount("이식 흔적", 1, "줄"));
    for (const note of decision.notes) lines.push(`      ⚠ ${note}`);
  });

  lines.push("");
  lines.push(`=== 건너뛸 흔적 ${skips.length}건 ===`);
  if (skips.length === 0) lines.push("  (없음)");
  skips.forEach((decision, index) => {
    lines.push(
      `  [${index + 1}] ${decision.intakeNumber ?? "(접수번호 없음)"}  흔적 ${decision.traceId}`
    );
    for (const reason of decision.reasons) lines.push(`      ✗ ${reason}`);
    for (const note of decision.notes) lines.push(`      ⚠ ${note}`);
  });

  lines.push("");
  lines.push("=== 합계 ===");
  const total = (label: string, value: number, suffix: string) =>
    lines.push(`  ${padLabel(label, 15)}${String(value).padStart(3, " ")}${suffix}`);
  total("이식 흔적", reverts.length, `줄 (건너뜀 ${skips.length})`);
  total("작업 기록", reverts.reduce((sum, d) => sum + d.workRecordIds.length, 0), "줄");
  total("사용 부품", reverts.reduce((sum, d) => sum + d.usedPartIds.length, 0), "줄");
  total("첨부 행", reverts.reduce((sum, d) => sum + d.attachmentIds.length, 0), "장");
  total("신고 증상", reverts.filter((d) => d.reportedSymptom !== null).length, "건");
  // 🔴 여기도 실물 수다. 합계가 「실제로 옮길 개수」와 같아야 사람이 그 수를 보고
  //    승인할 수 있다.
  const totalPreviewFiles = reverts.reduce((sum, d) => sum + countQuarantinePreviewFiles(d.files), 0);
  total(
    "디스크 파일",
    reverts.reduce((sum, d) => sum + countQuarantineFiles(d.files), 0),
    "개 (지우지 않고 격리 폴더로 옮긴다" +
      (totalPreviewFiles > 0
        ? ` — 첨부 ${reverts.reduce((sum, d) => sum + d.files.length, 0)}행 + 미리보기 ${totalPreviewFiles}개)`
        : ")")
  );
  lines.push("  🔴 service_reports · quotes 는 한 줄도 건드리지 않는다.");

  return lines.join("\n");
}

// ─────────────────────────────────────────────── 실제로 되돌린다 (`--apply`)

/** 되돌리기가 옮긴 파일 하나. 🔴 지운 것이 아니라 옮긴 것이다. */
export type QuarantinedFile = {
  attachmentId: string;
  /** 저장 루트 기준 상대 경로(DB 의 `stored_path` · `preview_path`). */
  relPath: string;
  /** 격리 폴더 기준 상대 경로. 되돌려 놓을 때 저장 루트에 이 구조 그대로 덮는다. */
  quarantineRelPath: string;
  state: "moved" | "missing" | "failed";
  reason?: string;
};

export type RevertedTraceRecord = {
  traceId: string;
  repairCaseId: string;
  intakeNumber: string | null;
  sourceSha256: string;
  importBatchId: string | null;
  basis: "id" | "legacy";
  deletedWorkRecordIds: readonly string[];
  deletedUsedPartIds: readonly string[];
  deletedAttachmentIds: readonly string[];
  /**
   * 🔴 되돌린 신고 증상의 **글자는 싣지 않는다** — 고객 내용이다. 되돌렸는가와
   * 길이만 남긴다(값 자체는 DB 로 되돌아가 있으므로 잃는 것이 없다).
   */
  reportedSymptom: { restored: true; restoredToEmpty: boolean; restoredLength: number } | null;
  files: readonly QuarantinedFile[];
  notes: readonly string[];
};

export type KyosanRevertRecord = {
  revertedAt: string;
  databaseName: string;
  selector: RevertSelector;
  runLabel: string;
  actorUserId: string;
  quarantineDir: string;
  reverted: readonly RevertedTraceRecord[];
  skipped: readonly { traceId: string; intakeNumber: string | null; reasons: readonly string[] }[];
};

export class RevertPlanChangedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RevertPlanChangedError";
  }
}

/**
 * 🔴 **DB 를 한 트랜잭션으로 되돌리고, 커밋이 끝난 뒤에 파일을 옮긴다.**
 *
 * 트랜잭션 안에서 하는 일의 차례:
 *   1. 수리 건 행을 `FOR UPDATE` 로 잠근다(id 순서로 — 엇갈려 잠그지 않는다).
 *   2. **계획을 다시 잰다.** 글자까지 같지 않으면 던져서 전부 되돌린다.
 *   3. 작업 기록 · 사용 부품 · 첨부 행 · 신고 증상 · 이식 흔적을 지운다.
 *   4. 감사 기록을 남긴다.
 */
export async function applyKyosanRevert(params: {
  plan: KyosanRevertPlan;
  actorUserId: string;
  /** 저장 루트(`UPLOADS_DIR`). 시험은 임시 폴더를 넘긴다. */
  uploadsRoot: string;
  /** 격리 폴더의 뿌리. 그 아래에 `<runLabel>/<흔적id>/<원래 상대 경로>` 로 옮긴다. */
  quarantineRoot: string;
  runLabel: string;
  databaseName: string;
}): Promise<KyosanRevertRecord> {
  const targets = params.plan.decisions.filter(
    (decision): decision is Extract<TraceRevertDecision, { kind: "revert" }> => decision.kind === "revert"
  );
  const skipped = params.plan.decisions
    .filter((decision): decision is Extract<TraceRevertDecision, { kind: "skip" }> => decision.kind === "skip")
    .map((decision) => ({
      traceId: decision.traceId,
      intakeNumber: decision.intakeNumber,
      reasons: decision.reasons,
    }));

  const quarantineDir = path.join(path.resolve(params.quarantineRoot), params.runLabel);

  if (targets.length === 0) {
    return {
      revertedAt: new Date().toISOString(),
      databaseName: params.databaseName,
      selector: params.plan.selector,
      runLabel: params.runLabel,
      actorUserId: params.actorUserId,
      quarantineDir,
      reverted: [],
      skipped,
    };
  }

  await db.transaction(async (tx) => {
    // ── 1. 잠근다 ──
    const caseIds = [...new Set(targets.map((decision) => decision.repairCaseId))].sort();
    for (const caseId of caseIds) {
      const [locked] = await tx
        .select({ id: repairCases.id })
        .from(repairCases)
        .where(eq(repairCases.id, caseId))
        .limit(1)
        .for("update");
      if (!locked) {
        throw new RevertPlanChangedError(`수리 건 ${caseId} 이(가) 그 사이에 사라졌습니다 — 되돌리지 않았습니다.`);
      }
    }

    // ── 2. 🔴 계획을 다시 잰다 ──
    const fresh = await loadKyosanRevertPlan(tx, params.plan.selector);
    const before = params.plan.decisions.map(revertFingerprint).sort().join("\n");
    const after = fresh.decisions.map(revertFingerprint).sort().join("\n");
    if (before !== after) {
      throw new RevertPlanChangedError(
        "계획을 찍은 뒤에 자료가 바뀌었습니다 — 한 줄도 지우지 않고 되돌렸습니다. 계획을 다시 보고 실행해 주세요."
      );
    }

    // ── 3. 지운다 ──
    for (const decision of targets) {
      if (decision.workRecordIds.length > 0) {
        await tx
          .delete(repairCaseWorkRecords)
          .where(
            and(
              eq(repairCaseWorkRecords.repairCaseId, decision.repairCaseId),
              inArray(repairCaseWorkRecords.id, [...decision.workRecordIds])
            )
          );
      }
      if (decision.usedPartIds.length > 0) {
        await tx
          .delete(repairCaseUsedParts)
          .where(
            and(
              eq(repairCaseUsedParts.repairCaseId, decision.repairCaseId),
              inArray(repairCaseUsedParts.id, [...decision.usedPartIds])
            )
          );
      }
      if (decision.attachmentIds.length > 0) {
        await tx
          .delete(attachments)
          .where(
            and(
              eq(attachments.repairCaseId, decision.repairCaseId),
              inArray(attachments.id, [...decision.attachmentIds])
            )
          );
      }

      if (decision.reportedSymptom !== null) {
        // 🔴 WHERE 에 「지금도 이식이 넣은 그 값인가」를 한 번 더 적는다. 잠금이
        //    있어도 이 칸은 잘못 쓰면 사람의 글자가 사라지는 자리다.
        // 🔴 `version` 은 **올린다**(안전장치 9) — 거꾸로 돌리지 않는다.
        const restored = await tx
          .update(repairCases)
          .set({
            reportedSymptom: decision.reportedSymptom.restoreTo,
            version: sql`${repairCases.version} + 1`,
            updatedAt: sql`now()`,
          })
          .where(
            and(
              eq(repairCases.id, decision.repairCaseId),
              decision.reportedSymptom.expectNow === null
                ? sql`${repairCases.reportedSymptom} is null`
                : eq(repairCases.reportedSymptom, decision.reportedSymptom.expectNow)
            )
          )
          .returning({ id: repairCases.id });
        if (restored.length !== 1) {
          throw new RevertPlanChangedError(
            `수리 건 ${decision.repairCaseId} 의 신고 증상이 그 사이에 바뀌었습니다 — 되돌리지 않았습니다.`
          );
        }
      }

      const removedTrace = await tx
        .delete(statusChangeHistories)
        .where(eq(statusChangeHistories.id, decision.traceId))
        .returning({ id: statusChangeHistories.id });
      if (removedTrace.length !== 1) {
        throw new RevertPlanChangedError(`이식 흔적 ${decision.traceId} 을(를) 지우지 못했습니다.`);
      }

      // ── 4. 감사 기록 ──
      // 🔴 행을 실제로 지우는 일이라 `PURGE` 다(소프트 삭제가 아니다). 담는 것은
      //    우리 표의 id 와 개수뿐 — 고객 내용은 싣지 않는다(이식 흔적과 같은 규율).
      await insertAuditLog(tx, {
        actorUserId: params.actorUserId,
        actionType: "PURGE",
        targetEntity: "status_change_histories",
        targetRecordId: decision.traceId,
        previousValue: {
          source: KYOSAN_REPORT_SOURCE,
          sourceSha256: decision.sourceSha256,
          importBatchId: decision.importBatchId,
          repairCaseId: decision.repairCaseId,
        },
        newValue: {
          revertedKyosanReportImport: true,
          basis: decision.basis,
          workRecordIds: decision.workRecordIds,
          usedPartIds: decision.usedPartIds,
          attachmentIds: decision.attachmentIds,
          reportedSymptomRestored: decision.reportedSymptom !== null,
          quarantineDir,
        },
      });
    }
  });

  // ── 5. 🔴 커밋이 끝난 뒤에야 파일을 옮긴다 ──
  const reverted: RevertedTraceRecord[] = [];
  for (const decision of targets) {
    const files = await quarantineAttachmentFiles({
      decision,
      uploadsRoot: params.uploadsRoot,
      quarantineDir,
    });
    reverted.push({
      traceId: decision.traceId,
      repairCaseId: decision.repairCaseId,
      intakeNumber: decision.intakeNumber,
      sourceSha256: decision.sourceSha256,
      importBatchId: decision.importBatchId,
      basis: decision.basis,
      deletedWorkRecordIds: decision.workRecordIds,
      deletedUsedPartIds: decision.usedPartIds,
      deletedAttachmentIds: decision.attachmentIds,
      reportedSymptom:
        decision.reportedSymptom === null
          ? null
          : {
              restored: true,
              restoredToEmpty: decision.reportedSymptom.restoreTo === null,
              restoredLength: decision.reportedSymptom.restoreTo?.length ?? 0,
            },
      files,
      notes: decision.notes,
    });
  }

  return {
    revertedAt: new Date().toISOString(),
    databaseName: params.databaseName,
    selector: params.plan.selector,
    runLabel: params.runLabel,
    actorUserId: params.actorUserId,
    quarantineDir,
    reverted,
    skipped,
  };
}

/**
 * 🔴 **옮긴다. 지우지 않는다.** 격리 폴더 아래에 흔적 id 로 방을 하나 만들고,
 * 그 안에 **원래 상대 경로 구조 그대로** 둔다 — 되돌려 놓을 일이 생기면 그
 * 방의 내용을 저장 루트에 그대로 덮어 복사하면 된다.
 *
 * 실물이 없으면(이미 누가 치웠다) 실패로 세지 않고 `missing` 으로 적어 둔다 —
 * DB 는 이미 커밋됐고, 파일 하나 때문에 여기서 던지면 기록이 남지 않는다.
 */
async function quarantineAttachmentFiles(params: {
  decision: Extract<TraceRevertDecision, { kind: "revert" }>;
  uploadsRoot: string;
  quarantineDir: string;
}): Promise<QuarantinedFile[]> {
  const room = path.join(params.quarantineDir, params.decision.traceId);
  const moved: QuarantinedFile[] = [];

  for (const file of params.decision.files) {
    for (const relPath of [file.storedPath, file.previewPath]) {
      if (relPath === null) continue;
      moved.push(
        await moveOneFile({
          attachmentId: file.attachmentId,
          relPath,
          uploadsRoot: params.uploadsRoot,
          room,
          traceId: params.decision.traceId,
        })
      );
    }
  }

  return moved;
}

async function moveOneFile(params: {
  attachmentId: string;
  relPath: string;
  uploadsRoot: string;
  room: string;
  traceId: string;
}): Promise<QuarantinedFile> {
  const quarantineRelPath = `${params.traceId}/${params.relPath}`;
  const base: Omit<QuarantinedFile, "state"> = {
    attachmentId: params.attachmentId,
    relPath: params.relPath,
    quarantineRelPath,
  };

  let fromAbs: string;
  try {
    // 🔴 앱과 같은 함수로 절대 경로를 만든다 — 루트 밖을 가리키면 여기서 던진다.
    fromAbs = resolveAttachmentAbsolutePath(params.uploadsRoot, params.relPath);
  } catch (error) {
    return { ...base, state: "failed", reason: describeError(error) };
  }

  const toAbs = path.join(params.room, ...params.relPath.split("/"));

  try {
    await fs.mkdir(path.dirname(toAbs), { recursive: true });
    await fs.rename(fromAbs, toAbs);
    return { ...base, state: "moved" };
  } catch (error) {
    if (isNotFound(error)) return { ...base, state: "missing", reason: "저장된 실물이 없었습니다." };
    if (!isCrossDevice(error)) return { ...base, state: "failed", reason: describeError(error) };
  }

  // 다른 볼륨이면 rename 이 EXDEV 로 실패한다 — 복사가 **끝난 뒤에만** 원본을 치운다.
  try {
    await fs.copyFile(fromAbs, toAbs, fsConstants.COPYFILE_EXCL);
    await fs.unlink(fromAbs);
    return { ...base, state: "moved" };
  } catch (error) {
    return { ...base, state: "failed", reason: describeError(error) };
  }
}

function isNotFound(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === "ENOENT";
}

function isCrossDevice(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === "EXDEV";
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
