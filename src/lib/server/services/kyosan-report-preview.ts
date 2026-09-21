import "server-only";

import {
  loadKyosanReportLinkTargets,
  serialLookupKey,
} from "@/lib/db/queries/kyosan-report-link";
import {
  buildKyosanReportTargets,
  type KyosanReportContent,
  type KyosanReportMatchView,
  type KyosanReportPreviewOutcome,
} from "@/lib/domain/kyosan-report-import/preview-view";
import { readKyosanReport, type KyosanReadFailure, type KyosanReport } from "@/lib/kyosan/kyosan-report";
import { matchKyosanReport, readKyosanIdentity } from "@/lib/kyosan/report-match";
import { splitKyosanPhotos } from "@/lib/kyosan/report-photo-filter";
import {
  buildKyosanPreviewLines,
  buildKyosanPreviewParts,
  buildKyosanReportPreview,
} from "@/lib/kyosan/report-preview";

/**
 * ============================================================================
 * 연락서 한 장 — **넣기 전에 보여 줄 것** (2026-09-21, 조각 S4)
 * ============================================================================
 * 🔴 **이 파일은 DB 에 한 줄도 쓰지 않는다.** 읽기만 한다. 사람이 파일을 올리면
 * 「어느 수리 건에 붙는가 · 무엇이 들어가는가 · 무엇이 어긋나는가」를 만들어
 * 돌려주고, 실제로 넣는 일은 `kyosan-report-import.ts`(S3b)가 한다.
 *
 * ── 🔴 이 결과는 저장 함수로 되돌아가지 않는다 ───────────────────────
 * 저장 함수는 미리보기 결과를 **받지 않는다**. 화면은 여기서 본 것을 근거로
 * 사람에게 확인만 받고, 서버로는 `파일` 과 `고른 수리 건 id` 만 보낸다. 짝짓기와
 * 미리보기는 저장 함수가 처음부터 다시 돌린다 — 그래야 「사람이 본 것」과
 * 「들어간 것」이 갈라지지 않는다.
 *
 * ── 왜 `content` 를 따로 세는가 ──────────────────────────────────────
 * S3a 의 `buildKyosanReportPreview` 는 **짝이 하나로 확정됐을 때만** `plan` 을
 * 준다(짝이 없는데 내용만 준비된 상태를 타입에서 없앴다). 그런데 이 화면은 짝이
 * 여럿일 때도 「이 연락서에 무엇이 들어 있는가」를 보여 줘야 사람이 고를 수
 * 있다. 연락서에서 뽑히는 내용은 **어느 건에 붙든 같으므로**, 같은 순수 함수
 * (`buildKyosanPreviewLines` · `buildKyosanPreviewParts` · `splitKyosanPhotos`)를
 * 그대로 불러 따로 센다. 🔴 새로 만든 규칙이 하나도 없다 — S3a 가 쓰는 함수 그대로다.
 * ============================================================================
 */

const READ_FAILURE_TEXT: Readonly<Record<KyosanReadFailure, string>> = {
  "not-a-workbook": "엑셀 통합문서로 열리지 않습니다. 연락서 원본 파일이 맞는지 확인해 주세요.",
  "no-card-sheet": "연락서의 Card 시트를 찾지 못했습니다. 연락서 양식이 맞는지 확인해 주세요.",
  "unreadable-card-sheet": "연락서의 Card 시트를 읽지 못했습니다.",
};

export type BuildKyosanReportPreviewInput = {
  /** 올린 파일의 바이트 그대로. */
  bytes: Buffer;
};

/** 연락서 한 장의 미리보기. 🔴 읽기 전용. */
export async function buildKyosanReportImportPreview(
  input: BuildKyosanReportPreviewInput
): Promise<KyosanReportPreviewOutcome> {
  const read = readKyosanReport(input.bytes);
  if (!read.ok) {
    return { ok: false, code: "UNREADABLE", message: READ_FAILURE_TEXT[read.reason] };
  }
  return await previewForReport(read.report);
}

/** 판독된 연락서 하나의 미리보기. 시험이 가짜 연락서로 곧장 부를 수 있게 갈라 둔다. */
export async function previewForReport(report: KyosanReport): Promise<KyosanReportPreviewOutcome> {
  // 🔴 저장 함수(S3b)가 하는 것과 **같은 차례** — 같은 신원 · 같은 조회 · 같은 판정.
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

  const caseState =
    match.outcome.kind === "matched"
      ? (targets.caseStates.get(match.outcome.candidate.repairCaseId) ?? null)
      : null;
  const preview = buildKyosanReportPreview(report, match, caseState);

  const split = splitKyosanPhotos(report.photos);
  const content: KyosanReportContent = {
    lines: buildKyosanPreviewLines(report),
    parts: buildKyosanPreviewParts(report),
    causeMarks: [...report.cause.marked],
    actionMarks: [...report.action.marked],
    photoCount: split.photos.length,
    formAssetCount: split.formAssets.length,
  };

  const matchView: KyosanReportMatchView =
    match.outcome.kind === "matched"
      ? { kind: "matched" }
      : match.outcome.kind === "ambiguous"
        ? { kind: "ambiguous", reason: match.outcome.reason }
        : { kind: "unmatched", reason: match.outcome.reason };

  return {
    ok: true,
    sourceSha256: report.sourceSha256,
    formFamily: report.formFamily,
    intakeNumberStatus: match.intakeNumberStatus,
    reportIdentity: {
      rawIntakeNumber: identity.rawIntakeNumber,
      intakeNumber: identity.intakeNumber,
      model: identity.model,
      serialNumber: identity.serialNumber,
      lotNumber: identity.lotNumber,
      customer: identity.customer,
    },
    match: matchView,
    targets: buildKyosanReportTargets(match, [...targets.caseStates.values()], report.sourceSha256),
    // 🔴 S3b 가 지금 넣겠다고 판정한 건. 화면은 기본 선택으로만 쓴다.
    confirmedRepairCaseId: preview.plan?.repairCaseId ?? null,
    content,
    blockers: preview.blockers,
    warnings: preview.warnings,
    problems: report.problems,
  };
}
