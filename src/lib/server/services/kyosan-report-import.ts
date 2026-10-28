import "server-only";

import { randomUUID } from "node:crypto";

import { and, asc, desc, eq, sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import {
  customers,
  products,
  repairCaseUsedParts,
  repairCases,
  statusChangeHistories,
} from "@/lib/db/schema";
import { createAttachmentRecordInTx } from "@/lib/db/mutations/attachments";
import { insertAuditLog } from "@/lib/db/mutations/audit-logs";
import {
  CreateWorkRecordMutationError,
  createWorkRecordInTx,
} from "@/lib/db/mutations/repair-case-work-records";
import {
  KYOSAN_REPORT_SOURCE,
  loadKyosanReportLinkTargets,
  serialLookupKey,
} from "@/lib/db/queries/kyosan-report-link";
import { hasLivePartRequest, isImportedFromKyosanIntake } from "@/lib/db/queries/repair-case-used-parts";
import { resolveUsedPartsWriteGate } from "@/lib/auth/repair-case-used-parts-authorization";
import type { InventoryPartRequestTrace } from "@/lib/domain/inventory-gateway";
import { probeInventoryPartRequestTrace } from "@/lib/server/inventory-gateway";
import {
  MAX_ATTACHMENT_SIZE_BYTES,
  canonicalMimeTypeForExtension,
  isAllowedExtension,
  isContentCompatibleWithExtension,
  isExtensionAllowedForCategory,
  isServerOriginContentCompatible,
  isServerOriginExtension,
  normalizeFileExtension,
  serverOriginMimeTypeForExtension,
} from "@/lib/domain/attachment-allowlist";
import {
  AttachmentPathError,
  buildAttachmentStoredPath,
  buildServerOriginAttachmentStoredPath,
} from "@/lib/domain/attachment-path";
import type { WorkRecordKind } from "@/lib/domain/types";
import type { KyosanReport } from "@/lib/kyosan/kyosan-report";
import {
  checkKyosanIdentity,
  matchKyosanReport,
  readKyosanIdentity,
  type KyosanCaseCandidate,
  type KyosanMatchBasis,
  type KyosanReportIdentity,
} from "@/lib/kyosan/report-match";
import { splitKyosanPhotos } from "@/lib/kyosan/report-photo-filter";
import { buildKyosanDetailValues } from "@/lib/kyosan/report-detail-values";
import {
  buildKyosanReportPreview,
  mergeKyosanPartsForUsedParts,
  type KyosanImportPlan,
} from "@/lib/kyosan/report-preview";
import { translateKyosanSentence } from "@/lib/kyosan/report-word-terms";
import { AttachmentTooLargeError, type StorageAdapter } from "@/lib/storage/storage-adapter";
import { ZipArchive } from "@/lib/xlsx/zip-reader";

/**
 * ============================================================================
 * 연락서 한 장을 **이미 등록된 수리 건에 넣는다** (2026-09-21, 조각 S3b)
 * ============================================================================
 * 🔴 **사용자 정책(2026-09-21)**: 「이미 수리 건이 등록된 경우에만 연락서의
 * 내용을 시스템에 이식한다.」 그러므로 이 파일에는 **수리 건을 만드는 줄이
 * 하나도 없다.** 짝이 없으면 답은 「넣지 않는다」이고, 왜 안 넣었는지만 돌려준다.
 *
 * ── 🔴 보고서를 만들지 않는다 (2026-09-21 사용자 결정, 조각 S5) ──────
 * 「확인내용이나 조치를 보고서에다가 넣지 말고, 상세 페이지 곳곳에 알맞는 칸들이
 * 있을 거야 거기에다가 넣어줘.」 … 「보고서 안 만들어도 돼」
 *
 * 그래서 이 파일에는 **`service_reports` 를 만드는 줄이 하나도 없다.** 내용은
 * 수리 건 상세의 제자리 칸으로 간다:
 *
 *   고객 고장 상황                  → `repair_cases.reported_symptom`
 *                                     🔴 **비어 있을 때만.** 값이 있으면 덮지
 *                                     않고 작업 기록으로 보낸다
 *   사내 확인 결과 · 고장 부위 ·    → 작업 기록 `INTAKE_INSPECTION_RESULT`
 *   불량 현상 상세 · 반품 사유 상세    (기본 정보 > 인수점검 결과로 파생)
 *   원인 상세 · 교체 부품 요약      → 작업 기록 `DIAGNOSIS_REPAIR_SUMMARY`
 *                                     (기본 정보 > 현재 진단/조치 요약으로 파생)
 *   처치 ○ · 원인 ○                 → 작업 기록 `GENERAL` (작업 이력에만)
 *                                     🔴 2026-09-22 사용자 지시. 정보량이 0 이라
 *                                     요약 칸을 차지하지 않는다 — 실측으로 처치 ○
 *                                     는 469장 전부 `現品引取` 다. 그래도 버리지
 *                                     않는다(`report-detail-values.ts` 머리말)
 *   교체 부품                       → `repair_case_used_parts`
 *                                     🔴 2026-09-22 사용자 지시. **이 칸에만**
 *                                     갈래(고장분/예방분)를 버리고 **부품 이름으로
 *                                     묶어 수량을 더한다**(`replaceUsedParts` 머리말).
 *                                     미리보기와 작업 기록은 갈래별로 그대로다
 *                                     🔴 2026-10-28 사용자 결정으로 **덮어쓴다** —
 *                                     있던 줄을 지우고 다시 적는다(그 머리말의
 *                                     「무엇을 잃는가」). 단, **부품 요청(반출)
 *                                     흔적이 있으면 한 줄도 넣지 않고**, 재고
 *                                     관리에 물어보지 못하면 **이식 자체를 막는다**
 *   사진 · 원본 `.xlsm`             → `attachments` (지금 그대로)
 *   비고                            → 🔴 넣지 않는다(`report-detail-values.ts`)
 *
 * 어느 줄이 어디로 가는가는 **순수 함수**(`kyosan/report-detail-values.ts`)가
 * 정하고, 미리보기 화면이 그 **같은 함수**로 사람에게 미리 보여 준다 — 화면이
 * 말한 자리와 실제로 들어간 자리가 갈라질 길이 없다.
 *
 * 🔴 보고서를 짓던 `kyosan/report-save-values.ts` 는 **지우지 않고** 남겨 두었다
 * (되돌릴 수 있어야 한다 — 그 파일 머리말).
 *
 * ── 무엇을 다시 쓰는가 (복제하지 않는다) ─────────────────────────────
 *  · 짝짓기 · 미리보기  `kyosan/report-match.ts` · `report-preview.ts` (S3a)
 *  · 사진 거르기        `kyosan/report-photo-filter.ts` (S3a)
 *  · 작업 기록 한 줄    `db/mutations/repair-case-work-records.ts` 의 `…InTx`
 *  · 첨부 한 줄         `db/mutations/attachments.ts` 의 `…InTx`
 *  · 사용 부품 규칙     `auth/repair-case-used-parts-authorization.ts` 의 판정
 *                       + `db/queries/repair-case-used-parts.ts` 의 두 probe
 *  · 첨부 파일 차례     `server/services/quote-issue.ts` 의 4단계
 *
 * ── 🔴 저장 직전에 **다시 판정한다** ─────────────────────────────────
 * 미리보기를 만든 순간과 저장하는 순간 사이에 자료가 바뀔 수 있다. S3a 실측에서
 * 접수번호만 믿으면 12장이 엉뚱한 건에 붙었을 것이 드러났다. 그래서 이 함수는
 * **미리보기 결과를 받지 않는다** — 연락서와 「사람이 고른 건 id」만 받고,
 * 짝짓기 · 미리보기를 여기서 **처음부터 다시** 돌린다. 그리고 트랜잭션 안에서
 * 접수 건 행을 잠근 뒤 **한 번 더** 본다:
 *
 *   1. 그 건이 아직 있는가 · 휴지통이 아닌가
 *   2. 🔴 **짝이 정해진 방식에 맞는 검사**(아래 갈래)
 *   3. 모델도 S/N 도 어긋나지 않는가(`checkKyosanIdentity` — 둘 다 어긋나면 깬다)
 *   4. 같은 `sourceSha256` 이 이미 들어 있지 않은가
 *
 * 잠금이 이것들을 줄 세운다 — 같은 연락서를 두 번 동시에 올려도 뒤쪽은 앞쪽이
 * 남긴 흔적을 보고 거절된다.
 *
 * ── 🔴 저장 직전 검사는 두 갈래다 (2026-09-21, 조각 S4b) ─────────────
 * 사용자 결정: 「짝이 여럿일 때 사람이 고르면 저장까지 받아들이되, 저장 직전
 * 검사를 「접수번호가 같은가」 → 「고른 건의 모델·S/N 이 연락서와 맞는가」로
 * 바꾼다.」 **안전장치를 없앤 것이 아니라 갈래를 나눈 것이다**:
 *   · `basis: "intake-number"`(자동으로 정해진 짝) → 지금까지와 똑같이
 *     **접수번호 동일성**을 본다. 실측에서 이 검사가 없었다면 469장 중 12장이
 *     엉뚱한 건에 붙었을 것이다.
 *   · `basis: "human-choice"`(사람이 후보에서 고른 짝) → 연락서에 접수번호가
 *     없거나 그 번호의 건이 없어 견줄 것이 없다. 대신 **잠금 안에서 다시 읽은
 *     제품 행의 모델·S/N** 을 연락서와 대조한다 — 후보가 될 때 쓴 바로 그 규칙
 *     (S/N 이 같고 모델이 어긋나지 않는다)을 저장 직전에 한 번 더 확인한다.
 * 🔴 어느 쪽도 무검사로 통과하지 않는다.
 *
 * ── 🔴 `matched` 가 아니면 저장하지 않는다 ───────────────────────────
 * `ambiguous`(사람이 골라야 한다)도 저장 금지다. 사람이 고른 것은
 * `chosenRepairCaseId` 로 들어와 **이 함수가 다시 돌린 짝짓기 안에서** 후보
 * 목록에 있을 때만 `matched` 가 된다 — 화면이 「골랐다」고 말한 것을 그대로
 * 믿는 것이 아니라, 서버가 다시 만든 후보 목록으로 확인한다.
 *
 * ── 한 트랜잭션 · 그리고 파일 ────────────────────────────────────────
 * 신고 증상 + 작업 기록 + 사용 부품 + 첨부 행 + 이식 흔적이 **한 트랜잭션**이다.
 * 중간에 실패하면 DB 에는 아무것도 남지 않는다.
 *
 * ⚠️ **디스크의 파일은 트랜잭션에 들어가지 않는다.** 그래서 올리기 통로 ·
 * 견적서 발행과 **같은 차례**를 쓴다: 파일을 먼저 놓고 → DB 를 쓰고 → DB 가
 * 실패하면 방금 놓은 파일을 치운다. 주인 없는 파일은 나중에 치울 수 있지만,
 * 실물 없는 DB 행은 화면에서 눌러도 아무것도 안 나오는 고장이기 때문이다.
 *
 * ── 🔴 원본 `.xlsm` (2026-09-18 사용자 결정) ─────────────────────────
 * 허용목록(`ATTACHMENT_EXTENSION_RULES`)에 `xlsm` 이 없고, **넣지 않았다** —
 * 넣으면 사람이 올리는 통로에서 제한 없는 분류 전부에 매크로 엑셀이 열린다.
 * 대신 `SERVER_ORIGIN_EXTENSION_RULES` 라는 **서버 출처 전용 목록**을 따로 두고
 * (`domain/attachment-allowlist.ts`), 그 목록만 보는 경로 함수
 * (`buildServerOriginAttachmentStoredPath`)로 저장한다. 앞머리 바이트 대조는
 * 그대로 요구한다(ZIP 서명). **느슨해진 검사가 하나도 없다.**
 *
 * ── 🔴 이식 흔적을 어디에 남기는가 (2026-09-21 결정 3) ───────────────
 * S3a 의 조회(`queries/kyosan-report-link.ts`)가 읽는 바로 그 자리 —
 * `status_change_histories.metadata` 의 `source='KYOSAN_REPORT'` +
 * `sourceSha256` 이다. 스키마를 건드리지 않았다.
 *
 * ⚠️ 그 표는 `action_type` 이 NOT NULL enum 인데 「연락서 이식」에 맞는 값이
 * 없다. 새 enum 값을 더하는 것은 스키마 변경이라 이번 조각에서 금지되어 있어,
 * `LEGACY_IMPORT_STATE_SET` 을 쓰고 `metadata.source` 로 가른다. **기존 판정 둘은
 * 흔들리지 않는다** — `queries/repair-case-used-parts.ts` 의
 * `importedFromKyosanIntakeCondition` 과 `queries/kyosan-intake-import.ts` 의
 * `listImportedCasesNeedingBillingReview` 가 둘 다 `source = KYOSAN_INTAKE_LIST`
 * 를 **함께** 요구하기 때문이다. 다만 진행 이력 화면
 * (`queries/workflow-history.ts`)에는 이 줄이 「가져오기」로 보인다 — 그래서
 * `reason` 에 무슨 일이었는지 한 문장을 적어 둔다.
 *
 * ── 🔴 흔적에 고객 내용을 담지 않는다 ────────────────────────────────
 * metadata 에는 해시 · 개수 · 우리 표의 id 만 싣는다. **원본 파일 이름은 싣지
 * 않는다** — 연락서 파일 이름에는 고객사명 · 모델이 섞인다. 그 이름이 남을
 * 자리는 첨부 행(`attachments.original_file_name`)과 그 FILE_UPLOAD 감사 한
 * 곳뿐이다(`mutations/attachments.ts` 의 같은 항목).
 * ============================================================================
 */

/** 이식 흔적의 `action_type`. 위 머리말의 ⚠️ 를 읽고 나서 바꿀 것. */
const KYOSAN_REPORT_TRACE_ACTION = "LEGACY_IMPORT_STATE_SET" as const;

/** 진행 이력 화면에 그대로 보이는 한 문장. 🔴 고객 내용을 담지 않는다. */
export const KYOSAN_REPORT_TRACE_REASON =
  "교산 연락서를 이 수리 건에 이식했습니다(단계는 바뀌지 않았습니다).";

/** 첨부 분류 — 새 enum 이 필요 없다. 연락서 원본도 그 안의 사진도 같은 칸이다. */
const KYOSAN_ATTACHMENT_CATEGORY = "KYOSAN_DOCUMENT" as const;

export type KyosanReportImportFailureCode =
  /** 짝이 없거나 · 사람이 골라야 하거나 · 미리보기가 막았다. */
  | "NOT_IMPORTABLE"
  /** 같은 원본 파일이 이 건에 이미 들어 있다. */
  | "ALREADY_IMPORTED"
  /** 사람이 고른 건과 다시 판정한 건이 다르다 — 그 사이 자료가 바뀌었다. */
  | "TARGET_CHANGED"
  /** 원본 파일의 확장자·내용이 첨부로 받을 수 있는 것이 아니다. */
  | "SOURCE_REJECTED"
  /** 원본 파일이 첨부 상한(20MB)을 넘는다. */
  | "SOURCE_TOO_LARGE"
  /** 파일을 저장소에 놓지 못했다. */
  | "STORAGE_FAILED"
  /** 상세 칸에 넣지 못했다(자료 규칙 · 작업 기록 규칙). */
  | "SAVE_REJECTED"
  /**
   * 🔴 **재고 관리에 「이 건에 부품 요청 흔적이 있나」를 물어보지 못했다** (2026-10-28).
   *
   * 다른 실패 코드와 결이 다르다 — 우리 쪽에도 연락서에도 잘못이 없고, **잠시 뒤 같은
   * 파일을 그대로 다시 올리면 들어간다.** 그런데도 실패로 돌려주는 까닭은 「모른다」를
   * 「요청 없음」으로 눕히면 **이미 부품을 받아 간 건의 사용 부품이 덮어써지기** 때문이다
   * (`replaceUsedParts` 머리말). 반쯤 넣고 부품만 빼면 더 나쁘다 — 같은 파일을 다시 올려도
   * `ALREADY_IMPORTED` 로 막혀 **그 건의 부품은 영영 안 들어간다.**
   */
  | "INVENTORY_UNREACHABLE";

export type KyosanReportImportResult =
  | {
      ok: true;
      repairCaseId: string;
      intakeNumber: string;
      /** 🔴 **보고서는 만들지 않는다.** 새로 남긴 작업 기록의 id 들이다. */
      workRecordIds: readonly string[];
      /** 🔴 신고 증상 칸을 실제로 채웠는가(비어 있었을 때만 참). */
      reportedSymptomFilled: boolean;
      /** 연락서에서 뽑아 어딘가에 넣은 줄 수. */
      lineCount: number;
      /** `repair_case_used_parts` 에 **새로 붙인** 줄 수. 0 이면 아래 사유가 있다. */
      usedPartCount: number;
      attachmentIds: readonly string[];
      photoCount: number;
      /** 사람이 알아야 하는 것들. 🔴 값은 담지 않는다(항목 이름·개수만). */
      warnings: readonly string[];
    }
  | {
      ok: false;
      code: KyosanReportImportFailureCode;
      message: string;
      /** 미리보기가 만든 문장들(`NOT_IMPORTABLE` 일 때). */
      blockers?: readonly string[];
    };

export type KyosanReportImportInput = {
  /** S1 판독기(`readKyosanReport`)가 돌려준 것 그대로. */
  report: KyosanReport;
  /** 올린 사람이 준 원본 파일 이름. 확장자를 여기서 뽑는다. */
  sourceFileName: string;
  /** 🔴 판독기에 넘긴 것과 **같은 바이트**. 첨부로 남기고 사진도 여기서 꺼낸다. */
  sourceBytes: Buffer;
  /**
   * 🔴 **자물쇠다.** 화면이 보여 준 건과 저장 직전에 다시 판정한 건이 같은지
   * 확인하고, 다르면 `TARGET_CHANGED` 로 거절한다 — 미리보기와 저장 사이에
   * 자료가 바뀐 것을 잡아내는 자리다.
   *
   * ⚠️ 「사람이 고른 것」을 나르는 통로가 **아니다.** 그 통로는 아래
   * `chosenRepairCaseId` 이고, 둘을 겹쳐 쓰면 자물쇠가 제 구실을 못 한다.
   */
  expectedRepairCaseId?: string | null;
  /**
   * 🔴 후보가 여럿(`identity-candidates`)일 때 **사람이 화면에서 고른** 수리 건
   * (조각 S4b). 이 함수가 **다시 돌린** 짝짓기의 후보 목록 안에 있을 때만 짝으로
   * 올라가고(`basis: "human-choice"`), 목록 밖이면 그냥 무시되어 `ambiguous` 로
   * 남는다 — 화면이 보여 준 적 없는 건에는 넣지 않는다.
   */
  chosenRepairCaseId?: string | null;
  actorUserId: string;
  storage: StorageAdapter;
  /** 발행일을 하나도 못 읽었을 때 쓸 날짜. 시험이 오늘에 흔들리지 않게 받는다. */
  today?: string;
  /**
   * 🔴 **한 회차의 일괄 이식을 묶는 번호**(S5). 화면에서 사람이 한 장씩 넣을 때는
   * 주지 않는다 — 그때는 이식 흔적에 `null` 로 들어간다. 여러 장을 한 번에 도는
   * 러너가 같은 값을 주면, 그 회차가 만든 흔적만 골라 한 번에 되짚을 수 있다.
   *
   * 🔴 우리가 만든 번호다 — 연락서에서 읽은 글자가 아니다(고객 내용이 아니다).
   */
  importBatchId?: string;
};

/** 트랜잭션 핸들 — `db.transaction` 이 넘겨주는 것과 같은 타입. */
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** 트랜잭션을 되돌리면서 사유를 밖으로 나르는 통. 🔴 던져야 롤백이 된다. */
class ImportAbort extends Error {
  constructor(
    readonly code: KyosanReportImportFailureCode,
    message: string,
    readonly blockers?: readonly string[]
  ) {
    super(message);
    this.name = "ImportAbort";
  }
}

/** 디스크에 놓은 파일 하나. DB 가 실패하면 이 목록을 치운다. */
type PlacedFile = {
  attachmentId: string;
  storedPath: string;
  originalFileName: string;
  mimeType: string;
  fileSize: number;
  checksumSha256: string;
  /** 첨부 행의 설명 칸 — 연락서 원본인지 그 안의 사진인지. */
  description: string;
};

export async function importKyosanReport(
  input: KyosanReportImportInput
): Promise<KyosanReportImportResult> {
  const { report } = input;
  const warnings: string[] = [];

  // ── 1. 🔴 짝짓기를 **처음부터 다시** 돌린다 (미리보기 결과를 받지 않는다) ──
  const identity = readKyosanIdentity(report.card);
  const targets = await loadKyosanReportLinkTargets({
    intakeNumbers: identity.intakeNumber === null ? [] : [identity.intakeNumber],
    serialNumbers: identity.serialNumber === null ? [] : [identity.serialNumber],
  });

  const serialKey = serialLookupKey(identity.serialNumber);
  const match = matchKyosanReport({
    identity,
    caseByIntakeNumber:
      identity.intakeNumber === null ? null : (targets.casesByIntakeNumber.get(identity.intakeNumber) ?? null),
    identityCandidates: serialKey === null ? [] : (targets.casesBySerialKey.get(serialKey) ?? []),
    // 🔴 사람이 고른 것은 **여기서 다시 만든 후보 목록** 안에 있을 때만 쓰인다.
    chosenRepairCaseId: input.chosenRepairCaseId ?? null,
  });

  // 🔴 `matched` 가 아니면 여기서 끝난다. `ambiguous` 도 저장 금지다.
  const matched = match.outcome.kind === "matched" ? match.outcome : null;
  const caseState =
    matched === null ? null : (targets.caseStates.get(matched.candidate.repairCaseId) ?? null);
  const preview = buildKyosanReportPreview(report, match, caseState);

  if (preview.plan === null || matched === null) {
    const alreadyImported =
      matched !== null && (caseState?.importedSourceSha256.includes(report.sourceSha256) ?? false);
    return {
      ok: false,
      code: alreadyImported ? "ALREADY_IMPORTED" : "NOT_IMPORTABLE",
      message: preview.blockers[0] ?? "이 연락서는 넣을 수 없습니다.",
      blockers: preview.blockers,
    };
  }

  const plan: KyosanImportPlan = preview.plan;
  warnings.push(...preview.warnings);

  // 🔴 사람이 고른 건과 다시 판정한 건이 다르면 멈춘다 — 그 사이에 자료가 바뀌었다.
  if (
    typeof input.expectedRepairCaseId === "string" &&
    input.expectedRepairCaseId !== plan.repairCaseId
  ) {
    return {
      ok: false,
      code: "TARGET_CHANGED",
      message:
        "고른 수리 건과 지금 다시 판정한 수리 건이 다릅니다. 그 사이에 자료가 바뀌었습니다 — 다시 확인해 주세요.",
    };
  }

  // ── 1-2. 🔴 재고 관리에 **「이 건에 부품 요청 흔적이 있나」**를 묻는다 (2026-10-28) ──
  //
  // 🔴 **트랜잭션 밖이다.** 저쪽을 두드리는 데 최대 5초가 걸리는데, 그동안 접수 건 행을
  //    `FOR UPDATE` 로 잡고 있으면 그 건의 다른 저장이 전부 선다(일괄 이식에서는 503장이
  //    차례로 그 시간을 문다). 그 대신 묻는 순간과 쓰는 순간 사이가 벌어지는데, 그 사이에
  //    새 반출 신청이 설 수는 있어도 **있던 신청이 사라지지는 않는다**(취소도 흔적으로
  //    남는다) — 틀리는 쪽이 「덮어쓰지 말아야 할 것을 덮어쓴다」가 아니라 「한 번 더 사람이
  //    확인한다」 쪽이다.
  // 🔴 **열쇠는 접수번호**다. 재고 관리는 수리 건 id 를 모른다(`inventory-gateway.ts`).
  //    잠금 안에서 다시 읽는 번호(`locked.intakeNumber`)와 여기 번호가 어긋날 자리는
  //    `basis: "intake-number"` 에서 `lockAndReconfirm` 이 막는다.
  // 🔵 **넣을 교체 부품이 없으면 묻지 않는다**(`null`). 쓸 것이 없어 판정이 아무것도 가르지
  //    않고, 그때까지 저쪽이 멈췄다고 연락서 이식을 막으면 **아무 쓸모 없이** 막는 것이다.
  const partRequestTrace: InventoryPartRequestTrace | null =
    plan.parts.length === 0 ? null : await probeInventoryPartRequestTrace(plan.intakeNumber);

  // 🔴 **「모른다」를 「없다」로 바꾸지 않는다** — 여기서 눕히면 이미 부품을 받아 간 건의
  //    사용 부품이 연락서 내용으로 덮어써진다. 사람이 잠시 뒤 같은 파일을 다시 올리면 된다
  //    (아직 한 글자도 안 썼고 파일도 안 놓았다 — 되돌릴 것이 없다).
  if (partRequestTrace !== null && partRequestTrace.kind === "unknown") {
    return {
      ok: false,
      code: "INVENTORY_UNREACHABLE",
      message: INVENTORY_UNREACHABLE_MESSAGE,
    };
  }

  // ── 2. 🔴 상세 칸 값은 **트랜잭션 안에서** 만든다 ──
  //    「신고 증상이 비어 있는가」는 잠금 안에서 방금 읽은 값으로 물어야 한다 —
  //    여기서 미리 정하면 그 사이에 사람이 적은 글자를 덮을 수 있다.

  // ── 3. 파일을 먼저 디스크에 놓는다 (DB 보다 먼저 — 위 머리말의 ⚠️) ──
  const placed: PlacedFile[] = [];
  try {
    placed.push(await placeSourceFile(plan.repairCaseId, input));
    const photos = await placePhotos(plan.repairCaseId, input, warnings);
    placed.push(...photos);
  } catch (error) {
    await discardPlaced(input.storage, placed);
    if (error instanceof ImportAbort) {
      return { ok: false, code: error.code, message: error.message };
    }
    logImportFailure(plan.repairCaseId, "storage", error);
    return { ok: false, code: "STORAGE_FAILED", message: STORAGE_FAILED_MESSAGE };
  }

  // ── 4. 🔴 한 트랜잭션 — 잠그고 · 다시 판정하고 · 전부 쓴다 ──
  try {
    return await db.transaction(async (tx) => {
      const locked = await lockAndReconfirm(tx, {
        repairCaseId: plan.repairCaseId,
        identity,
        sourceSha256: report.sourceSha256,
        // 🔴 화면이 보낸 말이 아니라 **방금 다시 돌린 짝짓기**가 내놓은 근거다.
        basis: matched.basis,
      });

      // 🔴 여기서 비로소 「무엇을 어느 칸에 넣을지」가 정해진다 — 잠금 안에서
      //    방금 읽은 신고 증상을 보고 덮을지 말지를 가른다.
      const detail = buildKyosanDetailValues({
        plan,
        currentReportedSymptom: locked.reportedSymptom,
      });

      const reportedSymptomFilled = await fillReportedSymptom(tx, {
        repairCaseId: plan.repairCaseId,
        value: detail.reportedSymptom,
        actorUserId: input.actorUserId,
      });
      if (detail.symptomDivertedReason !== null) {
        warnings.push(
          `고객 고장 상황을 신고 증상 칸에 넣지 않았습니다(${detail.symptomDivertedReason}) — ` +
            "덮어쓰지 않고 작업 기록으로 남겼습니다."
        );
      }
      if (detail.didSplitForLength) {
        warnings.push(
          "내용이 작업 기록 한 건의 상한(4000자)을 넘어 여러 건으로 나눠 넣었습니다 — 잘라낸 글자는 없습니다."
        );
      }
      if (detail.skippedOrigins.length > 0) {
        warnings.push(
          `연락서의 ${detail.skippedOrigins.join(" · ")} 항목은 넣지 않았습니다 — 원본 첨부에 그대로 남습니다.`
        );
      }

      const workRecordIds = await appendWorkRecords(tx, {
        repairCaseId: plan.repairCaseId,
        drafts: detail.workRecords,
        actorUserId: input.actorUserId,
      });

      const usedParts = await replaceUsedParts(tx, {
        repairCaseId: plan.repairCaseId,
        parts: plan.parts,
        actorUserId: input.actorUserId,
        isShipmentLocked: locked.isLocked,
        // 🔴 위에서 트랜잭션 **밖**에서 물어 온 답. 여기서 다시 묻지 않는다(망을 잠금 안으로
        //    끌어들이지 않는다 — 1-2 의 머리말).
        partRequestTrace,
      });
      if (usedParts.skippedReason !== null) warnings.push(usedParts.skippedReason);

      const attachmentIds: string[] = [];
      for (const file of placed) {
        const record = await createAttachmentRecordInTx(tx, {
          id: file.attachmentId,
          owner: { kind: "REPAIR_CASE", repairCaseId: plan.repairCaseId },
          category: KYOSAN_ATTACHMENT_CATEGORY,
          originalFileName: file.originalFileName,
          storedPath: file.storedPath,
          mimeType: file.mimeType,
          fileSize: file.fileSize,
          checksumSha256: file.checksumSha256,
          description: file.description,
          uploadedBy: input.actorUserId,
        });
        attachmentIds.push(record.id);
      }

      // 🔴 이식 흔적 — S3a 의 조회가 읽는 바로 그 모양. 없으면 두 번 넣는 것을
      //    아무도 못 막는다.
      await tx.insert(statusChangeHistories).values({
        repairCaseId: plan.repairCaseId,
        workflowVersionId: locked.workflowVersionId,
        // 단계는 움직이지 않는다 — from 과 to 가 같다(HOLD_* 줄과 같은 모양).
        fromStepId: locked.currentWorkflowStepId,
        toStepId: locked.currentWorkflowStepId,
        actionType: KYOSAN_REPORT_TRACE_ACTION,
        actorUserId: input.actorUserId,
        reason: KYOSAN_REPORT_TRACE_REASON,
        metadata: {
          source: KYOSAN_REPORT_SOURCE,
          sourceSha256: report.sourceSha256,
          // 🔴 우리 표의 id 와 개수만. 파일 이름·부품 이름·고객 내용은 담지 않는다(머리말).
          workRecordIds,
          reportedSymptomFilled,
          lineCount: plan.lines.length,
          // 🔴 **개수 칸을 지우지 않는다.** 이 칸이 생기기 전에 들어간 흔적에는 id
          //    칸이 없고, 그때 무엇이 들어갔는지 아는 단서가 개수뿐이다 — 되돌리기
          //    도구가 「id 가 없는 옛 흔적」도 다룰 수 있어야 한다. 새 흔적에서는
          //    `usedPartCount === usedPartIds.length` 가 언제나 참이다.
          usedPartCount: usedParts.insertedCount,
          // 🔴 이식이 **새로 붙인** 사용 부품 줄의 id. `repair_case_used_parts` 에는
          //    이식에서 온 줄임을 알려 주는 칸이 없고(`part_id` 가 null 인 것은 사람이
          //    손으로 적은 줄도 같다) 이 목록이 되돌릴 수 있는 유일한 단서다.
          usedPartIds: usedParts.insertedIds,
          attachmentCount: attachmentIds.length,
          // 🔴 이식이 새로 만든 첨부 행의 id(원본 한 장 + 꺼낸 사진들).
          attachmentIds,
          photoCount: plan.photoCount,
          formFamily: report.formFamily,
          // 🔴 일괄 이식 한 회차를 묶는 번호. 화면에서 한 장씩 넣으면 `null` 이다.
          importBatchId: input.importBatchId ?? null,
        },
      });

      return {
        ok: true as const,
        repairCaseId: plan.repairCaseId,
        intakeNumber: plan.intakeNumber,
        workRecordIds,
        reportedSymptomFilled,
        lineCount: plan.lines.length,
        usedPartCount: usedParts.insertedCount,
        attachmentIds,
        photoCount: attachmentIds.length - 1,
        warnings,
      };
    });
  } catch (error) {
    // DB 가 되돌아갔으므로 방금 놓은 파일은 주인이 없다 — 치운다(올리기 통로와 같다).
    await discardPlaced(input.storage, placed);
    if (error instanceof ImportAbort) {
      return { ok: false, code: error.code, message: error.message, blockers: error.blockers };
    }
    logImportFailure(plan.repairCaseId, "transaction", error);
    return { ok: false, code: "SAVE_REJECTED", message: SAVE_FAILED_MESSAGE };
  }
}

// ─────────────────────────────────────────────── 저장 직전 재판정 (잠금 안에서)

const STORAGE_FAILED_MESSAGE = "연락서 파일을 저장하지 못했습니다. 관리자에게 문의해 주세요.";
const SAVE_FAILED_MESSAGE = "연락서를 저장하지 못했습니다. 관리자에게 문의해 주세요.";
/**
 * 🔴 **「관리자에게 문의해 주세요」로 끝내지 않는다** — 위 둘과 다른 말이어야 한다.
 * 이것은 사람이 **스스로 풀 수 있는** 막힘이다(잠시 뒤 같은 파일을 다시 올리면 된다).
 * 「문의해 주세요」로 적으면 멀쩡히 다시 누르면 될 일에 전화가 걸려 오고, 반대로 까닭을
 * 안 적으면 「왜 됐다 안 됐다 하지」가 된다.
 */
export const INVENTORY_UNREACHABLE_MESSAGE =
  "재고 관리에 이 건의 부품 요청 이력을 물어보지 못했습니다 — 잠시 뒤 다시 올려 주세요. " +
  "요청이 없는 것이 아니라 확인하지 못한 것이라, 사용 부품을 덮어쓰지 않았습니다.";

export type KyosanLockedCase = {
  repairCaseId: string;
  intakeNumber: string;
  isLocked: boolean;
  workflowVersionId: string;
  currentWorkflowStepId: string;
  /**
   * 🔴 잠금 안에서 방금 읽은 신고 증상. **덮어쓰기를 막는 근거**다 — 미리보기
   * 때 읽은 값이 아니라 이 값으로 「비어 있는가」를 묻는다.
   */
  reportedSymptom: string | null;
};

/**
 * 🔴 접수 건 행을 `FOR UPDATE` 로 잠그고 **네 가지를 다시 본다**(머리말).
 * 막히면 던진다 — 트랜잭션이 통째로 되돌아가야 하기 때문이다.
 *
 * ── 🔴 `basis` 가 둘째 검사를 가른다 (조각 S4b) ──────────────────────
 *  · `intake-number` — **접수번호가 그대로인가**(지금까지의 검사 그대로).
 *  · `human-choice`  — 접수번호로 정해진 짝이 아니라 견줄 번호가 없다. 대신
 *    **잠금 안에서 다시 읽은 제품 행의 모델·S/N** 을 연락서와 대조한다:
 *    S/N 이 `agree` 여야 하고 모델이 `differ` 이면 안 된다(후보가 될 때 쓴 규칙).
 * 🔴 어느 쪽도 그냥 통과시키지 않는다.
 *
 * ⚠️ 잠금은 `repair_cases` 한 표에만 건다. 고객사는 LEFT JOIN 이라 함께 잠그면
 * Postgres 가 「바깥 조인의 nullable 쪽은 잠글 수 없다」로 거절한다.
 */
export async function lockAndReconfirm(
  tx: Tx,
  params: {
    repairCaseId: string;
    identity: KyosanReportIdentity;
    sourceSha256: string;
    /** 🔴 짝이 어떻게 정해졌는가 — 짝짓기가 내놓은 값을 그대로 넘긴다. */
    basis: KyosanMatchBasis;
  }
): Promise<KyosanLockedCase> {
  const [current] = await tx
    .select({
      id: repairCases.id,
      intakeNumber: repairCases.intakeNumber,
      isDeleted: repairCases.isDeleted,
      isLocked: repairCases.isLocked,
      productId: repairCases.productId,
      customerId: repairCases.customerId,
      workflowVersionId: repairCases.workflowVersionId,
      currentWorkflowStepId: repairCases.currentWorkflowStepId,
      reportedSymptom: repairCases.reportedSymptom,
    })
    .from(repairCases)
    .where(eq(repairCases.id, params.repairCaseId))
    .limit(1)
    .for("update");

  if (!current || current.isDeleted) {
    throw new ImportAbort(
      "TARGET_CHANGED",
      "짝지은 수리 건이 사라졌거나 휴지통으로 갔습니다 — 넣지 않았습니다."
    );
  }
  // 🔴 자동으로 정해진 짝만 접수번호를 견준다. 사람이 고른 짝은 애초에 그 번호로
  //    정해진 것이 아니라 견줄 것이 없고, 대신 아래에서 모델·S/N 을 대조한다.
  if (params.basis === "intake-number" && current.intakeNumber !== params.identity.intakeNumber) {
    throw new ImportAbort(
      "TARGET_CHANGED",
      "짝지은 수리 건의 접수번호가 그 사이에 바뀌었습니다 — 넣지 않았습니다."
    );
  }

  // 🔴 같은 해시가 이미 있는가 — 잠금 안에서 본다. 밖에서 본 것은 미리보기였고,
  //    그 사이에 다른 요청이 먼저 넣었을 수 있다.
  const [duplicate] = await tx
    .select({ id: statusChangeHistories.id })
    .from(statusChangeHistories)
    .where(
      and(
        eq(statusChangeHistories.repairCaseId, params.repairCaseId),
        sql`${statusChangeHistories.metadata} ->> 'source' = ${KYOSAN_REPORT_SOURCE}`,
        sql`${statusChangeHistories.metadata} ->> 'sourceSha256' = ${params.sourceSha256}`
      )
    )
    .limit(1);
  if (duplicate) {
    throw new ImportAbort(
      "ALREADY_IMPORTED",
      "이미 넣은 연락서입니다(원본 파일이 같습니다) — 다시 넣지 않았습니다."
    );
  }

  // 신원 — 모델도 S/N 도 **둘 다** 어긋나면 그 짝은 믿지 않는다(S3a 의 규칙).
  const [product] = await tx
    .select({
      modelName: products.modelName,
      serialNumber: products.serialNumber,
      lotNumber: products.lotNumber,
    })
    .from(products)
    .where(eq(products.id, current.productId))
    .limit(1);
  const [customer] = current.customerId
    ? await tx.select({ name: customers.name }).from(customers).where(eq(customers.id, current.customerId)).limit(1)
    : [undefined];

  const candidate: KyosanCaseCandidate = {
    repairCaseId: current.id,
    intakeNumber: current.intakeNumber,
    isDeleted: current.isDeleted,
    customerName: customer?.name ?? null,
    modelName: product?.modelName ?? null,
    serialNumber: product?.serialNumber ?? null,
    lotNumber: product?.lotNumber ?? null,
  };
  const check = checkKyosanIdentity(params.identity, candidate);
  if (check.model === "differ" && check.serialNumber === "differ") {
    throw new ImportAbort(
      "TARGET_CHANGED",
      "짝지은 수리 건의 모델도 S/N 도 연락서와 다릅니다 — 사람이 확인해야 합니다. 넣지 않았습니다."
    );
  }

  // 🔴 사람이 고른 짝은 여기가 접수번호 검사를 대신한다 — 후보가 될 때 쓴 규칙
  //    (S/N 이 같고 모델이 어긋나지 않는다)을 **잠금 안에서 다시 읽은 값**으로
  //    한 번 더 본다. 모델·S/N 이 그 사이에 바뀌었으면 여기서 막힌다.
  if (params.basis === "human-choice" && (check.serialNumber !== "agree" || check.model === "differ")) {
    throw new ImportAbort(
      "TARGET_CHANGED",
      "고른 수리 건의 모델·S/N 이 연락서와 맞지 않습니다 — 사람이 확인해야 합니다. 넣지 않았습니다."
    );
  }

  return {
    repairCaseId: current.id,
    intakeNumber: current.intakeNumber,
    isLocked: current.isLocked,
    workflowVersionId: current.workflowVersionId,
    currentWorkflowStepId: current.currentWorkflowStepId,
    reportedSymptom: current.reportedSymptom,
  };
}

// ─────────────────────────────────────────────── 신고 증상 (🔴 비어 있을 때만)

/**
 * 🔴 **사람이 적은 글자를 지우지 않는다.** DB 실측에서 217건 중 213건에 이미
 * 값이 있었다 — 그냥 쓰면 그 글자가 말없이 사라진다.
 *
 * `value` 가 `null` 이면 아무것도 하지 않는다(순수 함수가 이미 「쓰면 안 된다」고
 * 판정했다 — 값이 있거나, 뽑을 것이 없거나, 4000자를 넘었다).
 *
 * 🔴 UPDATE 의 WHERE 에 **「지금도 비어 있는가」를 한 번 더 적는다.** 위에서
 * `FOR UPDATE` 로 잠갔으니 사이에 끼어들 수는 없지만, 이 칸은 잘못 쓰면 남의
 * 글자가 사라지는 자리라 조건을 SQL 에도 남긴다. 0줄이 바뀌면 **던진다** —
 * 조용히 넘어가면 「썼다고 말했는데 안 썼다」가 된다.
 */
async function fillReportedSymptom(
  tx: Tx,
  params: { repairCaseId: string; value: string | null; actorUserId: string }
): Promise<boolean> {
  if (params.value === null) return false;

  const updated = await tx
    .update(repairCases)
    .set({
      reportedSymptom: params.value,
      // 사용 부품 이식과 같은 번호를 올린다 — 화면이 열어 둔 폼은 다음 저장에서
      // CONFLICT 를 받고 다시 불러온다(그것이 맞는 신호다).
      version: sql`${repairCases.version} + 1`,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(repairCases.id, params.repairCaseId),
        sql`coalesce(btrim(${repairCases.reportedSymptom}), '') = ''`
      )
    )
    .returning({ id: repairCases.id });

  if (updated.length === 0) {
    throw new ImportAbort(
      "SAVE_REJECTED",
      "신고 증상 칸에 그 사이 값이 생겨 넣지 않았습니다 — 다시 확인해 주세요."
    );
  }

  await insertAuditLog(tx, {
    actorUserId: params.actorUserId,
    actionType: "UPDATE",
    targetEntity: "repair_cases",
    targetRecordId: params.repairCaseId,
    previousValue: { reportedSymptom: null },
    newValue: { reportedSymptom: params.value, source: KYOSAN_REPORT_SOURCE },
  });

  return true;
}

// ─────────────────────────────────────────────── 작업 기록 (덧붙인다)

/**
 * 작업 기록을 **덧붙인다**. 🔴 `createWorkRecordInTx` 를 그대로 부른다 — 이
 * 파일에 INSERT 를 다시 적지 않는다(적으면 멱등 판정 · 절차 항목 검사 · 살아
 * 있는 계정 확인이 두 벌이 되고, 한쪽만 고쳐지는 날이 온다).
 *
 * 🔴 `origin: "server-import"` 는 **역할 권한과 담당 여부 둘만** 건너뛴다. 이
 * 통로는 화면 칸이 아니라 서버가 도는 이식이고, 누가 이식할 수 있는지는 액션이
 * 더 무거운 권한(`kyosanIntakeImport` MANAGE)으로 이미 판정했다. 나머지 검사는
 * 그대로 받는다 — 유·무상이 확정되지 않은 건이면 **이식 전체가 막힌다**(그때는
 * 사람이 유·무상을 정한 뒤에 다시 넣는다).
 *
 * 🔴 막히면 **되돌린다** — 사용 부품과 다르다. 부품은 보고서 줄로도 들어가 잃는
 * 것이 없었지만, 작업 기록은 이제 연락서 본문이 갈 **유일한 자리**다. 반쪽만
 * 들어가면 첨부만 남고 내용은 없는 건이 된다.
 */
async function appendWorkRecords(
  tx: Tx,
  params: {
    repairCaseId: string;
    drafts: readonly { recordKind: WorkRecordKind; memo: string }[];
    actorUserId: string;
  }
): Promise<string[]> {
  const ids: string[] = [];
  for (const draft of params.drafts) {
    try {
      const created = await createWorkRecordInTx(tx, {
        repairCaseId: params.repairCaseId,
        actorUserId: params.actorUserId,
        memo: draft.memo,
        recordKind: draft.recordKind,
        relatedProcedureExecutionNodeId: null,
        // 이식마다 새 열쇠다 — 같은 연락서를 두 번 넣는 것은 `sourceSha256`
        // 흔적이 막고, 이쪽은 한 이식 안의 줄들이 서로 부딪히지 않게만 한다.
        clientRequestId: randomUUID().toLowerCase(),
        origin: "server-import",
      });
      ids.push(created.id);
    } catch (error) {
      if (error instanceof CreateWorkRecordMutationError) {
        throw new ImportAbort("SAVE_REJECTED", error.result.message);
      }
      throw error;
    }
  }
  return ids;
}

// ─────────────────────────────────────────────── 사용 부품 (🔴 덮어쓴다 — 2026-10-28)

/**
 * ============================================================================
 * 🔴 2026-10-28 — 「붙인다」에서 **「덮어쓴다」**로 뒤집혔다 (사용자 결정)
 * ============================================================================
 * 쓰는 분의 말 그대로다: 「읽어와서 [수리건 상세]의 [사용부품]에 저장해줘. (기존에
 * 적어두었던 내용들 위에 **덮어씌워줘**.)」 **무엇을 잃는지 알고 고른 결정**이다.
 *
 * ── 🔴 **지워 둔 2026-09-18 의 판단을 그대로 인용해 남긴다** ─────────────
 * 그때 이 자리에 적혀 있던 말:
 *
 *     「`saveRepairCaseUsedParts` 를 그대로 부르지 않는 까닭은 **뜻이 다르기
 *      때문**이다. 그 함수는 화면이 보낸 목록으로 이 건의 부품을 **통째로 다시
 *      그린다**(전부 지우고 다시 넣는다). 연락서 이식은 그 반대다 — 사람이 이미
 *      적어 둔 줄도, 먼저 넣은 다른 연락서의 줄도 **그대로 두고 뒤에 붙여야** 한다.
 *      그것을 그 함수로 하면 첫 연락서의 부품이 둘째 연락서를 넣는 순간 사라진다.」
 *
 * ── 🔴 **그래서 무엇을 잃는가** (뒤집은 쪽이 지는 값) ────────────────────
 *  · **사람이 손으로 적어 둔 줄이 사라진다.** 이식이 그 자리를 통째로 다시 적는다.
 *  · **먼저 넣은 다른 연락서의 줄이 사라진다.** 한 수리 건에 연락서가 여러 장이면
 *    **마지막에 넣은 한 장**의 교체 부품만 남는다 — 2026-09-18 이 막으려던 바로 그
 *    일이고, 쓰는 분이 그 사실을 알고 「그래도 덮어쓴다」를 골랐다(2026-10-28).
 *  · **되돌리기(`revert-kyosan-import.ts`)가 되살려 주지 못한다.** 그 도구는 흔적에
 *    적힌 `usedPartIds` 를 **지우기만** 한다 — 이 이식이 지운 옛 줄은 그 목록에 없다.
 *    지워진 줄을 되짚을 자리는 감사 이력(`audit_logs` 의 `previousValue.lines`)뿐이다.
 *
 * ── 🔵 **그래도 `saveRepairCaseUsedParts` 를 부르지 않는다** (까닭이 바뀌었다) ──
 * 이제 둘 다 「전부 지우고 다시 넣는다」지만, 그 함수는 **이 자리에서 부를 수 없다**:
 *  ① **제 트랜잭션을 연다**(`db.transaction`, `tx` 를 받지 않는다). 이식은 신고 증상 ·
 *     작업 기록 · 사용 부품 · 첨부 · 흔적이 **한 트랜잭션**이어야 한다(파일 머리말) —
 *     그 함수를 부르면 사용 부품만 **따로 커밋**되어, 뒤가 실패해도 남는다.
 *  ② **`expectedVersion` 과 `PermissionActor` 를 요구한다.** 이식에는 화면이 들고 있던
 *     version 이 없고(있다면 여기서 지어내는 값이다), 권한은 액션이 이미 더 무거운
 *     판정(`kyosanIntakeImport` MANAGE)으로 보았다 — 그 함수가 다시 묻는 것은
 *     `repairCases.usedParts` 쓰기라 **이식을 할 수 있는 사람이 부품만 못 넣는** 일이
 *     생긴다.
 *  ③ 감사 이력의 `newValue` 에 `source: KYOSAN_REPORT` 가 붙지 않는다 — 어느 줄이
 *     이식에서 왔는지 되짚을 단서가 그 칸과 흔적의 `usedPartIds` 둘뿐이다.
 * 그래서 **덮어쓰는 방식만** 이 함수가 그 함수를 본떠 가져온다(아래 delete → insert).
 * ============================================================================
 */

/**
 * 교체 부품으로 `repair_case_used_parts` 를 **다시 적는다**(이 건의 줄을 전부 지우고
 * 연락서의 줄을 1번부터 넣는다).
 *
 * 🔴 **규칙은 그대로 다시 본다.** 판정 함수도(`resolveUsedPartsWriteGate`)
 * probe 둘도(`hasLivePartRequest` · `isImportedFromKyosanIntake`) 그 파일들이
 * 가진 것을 그대로 부른다.
 *
 * 🔴 막히면 **이식 전체를 실패시키지 않는다.** 교체 부품 글자는 「진단/조치」
 * 작업 기록에도 함께 들어가(`report-detail-values.ts`) 잃는 내용이 없고, 반출
 * 이력이 있는 건은 흔해서 막을 경우 그 건의 연락서를 영영 못 넣게 된다. 대신
 * 사유를 경고로 올린다.
 *
 * 권한은 보지 않는다 — 이 통로는 사람이 칸에 적는 화면이 아니라 서버가 도는
 * 이식이고, 누가 이식을 할 수 있는지는 부르는 쪽(S4 의 화면·라우트)이 본다.
 * 그래서 `canWriteUsedParts` 자리에는 `true` 를 넣고, **나머지 두 규칙만** 본다.
 *
 * ── 🔴 **부품 요청을 했던 건에는 한 줄도 넣지 않는다** (2026-10-28) ──────
 * 쓰는 분의 판정: 「[부품 요청] 칸에 **반출신청된 어떤 흔적이라도** 있으면 부품요청을
 * 했었다고 판단한다.」 그 답을 재는 자는 `resolveInventoryPartRequestTrace` 하나이고
 * (`domain/inventory-gateway.ts` — 조각 D 의 백필도 같은 자를 쓴다), 묻는 일은 부르는
 * 쪽이 **트랜잭션 밖에서** 미리 해 둔다(이 파일 1-2 묶음).
 *
 * 🔴 **게이트의 `hasPartRequestHistory` 규칙으로 바꾸지 않았다.** 그 규칙이 보는
 *    `inventory_part_requests` 표는 **운영에서 0행**이라(조각 13 으로 재고가 걷힌 뒤)
 *    지금 아무것도 막고 있지 않다 — 죽어 있는 글자다. 그런데도 손대지 않은 까닭은 그
 *    게이트를 **사람이 손으로 적는 화면**(`mutations/repair-case-used-parts.ts`)이 함께
 *    쓰기 때문이다. 거기까지 바꾸면 「손으로 적는 칸이 재고 관리의 신청으로 잠긴다」는
 *    **다른 결정**이 되고, 이 조각이 정할 일이 아니다(2026-10-28 지시). 그래서 이 규칙은
 *    **연락서 이식 경로에만** 건다.
 *
 * 🔴 **「모른다」는 여기까지 오지 않는다** — 부르는 쪽이 이미 `INVENTORY_UNREACHABLE` 로
 *    막는다. 그래도 아래에서 한 번 더 던지는 까닭: 이 함수를 나중에 다른 자리에서 부르는
 *    사람이 트레이스를 `null` 로 넘기면 **조용히 덮어쓰게** 되기 때문이다. 울타리는 둘이다.
 *
 * ── 🔴 여기서만 갈래를 버리고 이름으로 묶는다 (2026-09-22) ──────────────
 * 받는 `params.parts` 는 **갈래별로 갈라진** 목록이다(고장분·예방분이 따로 줄을
 * 이룬다). 그 모양이 미리보기 화면과 작업 기록 메모가 쓰는 모양이고, 그 둘은
 * 그대로 둔다. 🔴 **사용 부품 칸만** 사용자 지시대로 「구분 없이 부품명대로
 * 수량을」 담는다 — 묶는 규칙은 `mergeKyosanPartsForUsedParts` 한 곳에 있다
 * (값으로 시험이 붙는 순수 함수다 — 이 수가 청구 금액에 닿는다).
 *
 * 그래서 **줄 수가 `params.parts.length` 보다 적을 수 있다**(실측 469장에서
 * 1,235줄 → 1,085줄 · 수량 합계 2,874). 🔴 **수량 합계는 그대로다** — 더해 담기
 * 때문이다.
 * 되돌려 주는 `insertedCount` 는 **실제로 넣은 줄 수**라 묶은 뒤의 수다
 * (화면이 「사용 부품 N줄」로 보여 주고, 이식 흔적의 `usedPartCount` 도 그 수다).
 *
 * ── 🔴 교체 부품이 **하나도 없는 연락서는 칸을 비우지 않는다** ───────────
 * 맨 앞의 빠른 반환이 그것이다. 덮어쓰기는 「연락서에서 읽은 부품을 그 칸에 적는 일」이지
 * 「칸을 연락서에 맞추는 일」이 아니다 — 교체 부품 항목이 비어 있는 연락서(수리 없이 반송된
 * 건 따위)에 적혀 있던 줄을 지우면 **얻는 것 없이 잃기만 한다.** 그래서 그때는 묻지도 않고
 * (부르는 쪽이 재고 관리를 두드리지도 않는다) 한 줄도 건드리지 않는다.
 *
 * ── 🔴 넣은 줄의 id 를 함께 돌려준다 (되돌리기를 위해) ──────────────────
 * `repair_case_used_parts` 에는 **어느 줄이 이식에서 왔는지 알려 주는 칸이
 * 없다.** `part_id IS NULL` 로도 못 가른다 — 사람이 손으로 적는 줄도 비어
 * 있기 때문이다. 그래서 넣은 줄의 id 를 이식 흔적에 실어 두는 것이 **한 회차를
 * 되돌릴 수 있는 유일한 단서**다(`usedPartIds`).
 *
 * 🔴 `insertedCount` 는 `insertedIds.length` 로만 센다 — 세는 길을 둘로 두면
 * 한쪽만 고쳐지는 날이 온다. 안 넣고 건너뛰는 갈래에서는 둘 다 빈 값이다.
 */
async function replaceUsedParts(
  tx: Tx,
  params: {
    repairCaseId: string;
    parts: KyosanImportPlan["parts"];
    actorUserId: string;
    isShipmentLocked: boolean;
    /**
     * 🔴 이 건에 **부품 요청(반출) 흔적**이 있는가 — 부르는 쪽이 트랜잭션 밖에서 재고
     * 관리에 물어 온 답. `null` 은 「묻지 않았다」이고 **교체 부품이 0건일 때만** 그렇다.
     */
    partRequestTrace: InventoryPartRequestTrace | null;
  }
): Promise<{ insertedCount: number; insertedIds: string[]; skippedReason: string | null }> {
  // 🔴 교체 부품이 없는 연락서는 **칸을 비우지 않는다**(위 머리말). 지우기 전에 선다.
  if (params.parts.length === 0) return { insertedCount: 0, insertedIds: [], skippedReason: null };

  // 🔴 **둘째 울타리** — 「모른다」로도, 「안 물어봤다」로도 덮어쓰지 않는다. 부르는 쪽이
  //    이미 막고 있어 평소에는 여기 닿지 않지만, 닿는 날은 조용히 남의 기록이 사라지는
  //    날이라 값싼 검사를 하나 더 둔다.
  const trace = params.partRequestTrace;
  if (trace === null || trace.kind === "unknown") {
    throw new ImportAbort("INVENTORY_UNREACHABLE", INVENTORY_UNREACHABLE_MESSAGE);
  }

  const hasPartRequestHistory = await hasLivePartRequest(tx, params.repairCaseId);
  const isLegacyImportedCase = await isImportedFromKyosanIntake(tx, params.repairCaseId);
  const gate = resolveUsedPartsWriteGate({
    canWriteUsedParts: true,
    // 🔴 **A/S 제 표(`inventory_part_requests`)를 보는 규칙이다 — 지금 0행이라 죽어 있다**
    //    (위 머리말). 새 판정으로 갈아 끼우지 않고 그대로 넘긴다.
    hasPartRequestHistory,
    isShipmentLocked: params.isShipmentLocked,
    isLegacyImportedCase,
  });
  if (!gate.ok) {
    return {
      insertedCount: 0,
      // 🔴 한 줄도 넣지 않은 갈래다 — id 도 없다(빈 배열이어야 한다).
      insertedIds: [],
      // 🔴 세는 것은 **묶기 전 「교체 부품」 건수**다(묶은 줄 수가 아니다). 이 문장을
      //    읽는 사람은 바로 위 미리보기에서 그 수를 세고 있고, 못 들어간 것은 그
      //    목록 전체이기 때문이다.
      skippedReason: `교체 부품 ${params.parts.length}건을 사용 부품 칸에 적지 않았습니다 — ${gate.message}`,
    };
  }

  // 🔴 **부품 요청을 했던 건에는 한 줄도 넣지 않는다**(2026-10-28 쓰는 분 결정).
  //    🔵 **지우지도 않는다** — 건너뛰기는 「이 칸을 건드리지 않는다」는 뜻이다. 여기서
  //       지우면 요청 이력이 있는 건의 사용 부품이 **아무 대체물 없이** 사라진다.
  if (trace.kind === "present") {
    return {
      insertedCount: 0,
      insertedIds: [],
      // 🔴 앞머리 글자는 게이트 쪽과 **같다** — 러너가 「부품 건너뜀」을 그 글자로 센다
      //    (`scripts/lib/kyosan-import-run-plan.ts` 의 `USED_PARTS_SKIPPED_WARNING_MARK`).
      //    🔴 값은 담지 않는다 — 건수뿐이다(이 파일 머리말).
      skippedReason:
        `교체 부품 ${params.parts.length}건을 사용 부품 칸에 적지 않았습니다 — ` +
        `이 건에는 재고 관리에 올라간 부품 요청(반출) 신청이 ${trace.count}건 있습니다. ` +
        "그 요청에서 잡히므로 덮어쓰지 않았습니다.",
    };
  }

  // 🔴 **지우기 전에 읽어 둔다** — 감사 이력의 `previousValue` 다. 덮어쓰기로 바뀐 뒤로는
  //    이 줄이 **사라진 기록을 되짚는 유일한 자리**다(되돌리기 도구는 못 되살린다 —
  //    위 머리말의 「무엇을 잃는가」).
  const previousLines = await tx
    .select({
      lineNo: repairCaseUsedParts.lineNo,
      partId: repairCaseUsedParts.partId,
      partNameText: repairCaseUsedParts.partNameText,
      quantity: repairCaseUsedParts.quantity,
    })
    .from(repairCaseUsedParts)
    .where(eq(repairCaseUsedParts.repairCaseId, params.repairCaseId))
    .orderBy(asc(repairCaseUsedParts.lineNo));

  // 🔴 **갈래를 버리고 부품 이름으로 묶는다**(사용자 지시 2026-09-22 — 위 머리말).
  //    수량이 안 적힌 줄을 1 로 세어 더하는 것도 그 함수 안이다. 그래서 여기서는
  //    `?? 1` 을 다시 하지 않는다 — 두 곳에 두면 한쪽만 고쳐지는 날이 온다.
  const usedPartLines = mergeKyosanPartsForUsedParts(params.parts);

  // ⚠️ **반드시 `repair_case_id` 로 좁힌다.** 조건 없는 delete 는 이 표를 통째로 비운다
  //    (`mutations/repair-case-used-parts.ts` 의 같은 자리에 붙은 같은 경고다).
  //    🔴 여기가 2026-10-28 에 「붙인다」가 「덮어쓴다」로 뒤집힌 **그 한 줄**이다.
  await tx.delete(repairCaseUsedParts).where(eq(repairCaseUsedParts.repairCaseId, params.repairCaseId));

  // 🔴 차례는 **1번부터 다시** 매긴다 — 앞의 줄을 지웠으니 이어 붙일 자리가 없다.
  //    (유니크 인덱스가 건 + line_no 라 빈 번호를 남겨 둘 까닭도 없다.)
  let nextLineNo = 0;
  const nextLines = usedPartLines.map((line) => ({
    repairCaseId: params.repairCaseId,
    lineNo: (nextLineNo += 1),
    // 🔴 부품 대장과 이어 붙이지 않는다 — 연락서의 글자는 교산 쪽 품명이라
    //    우리 `parts` 와 같은 물건인지 확인된 바가 없다. 손으로 적은 줄과 같은
    //    모양(`part_id` 가 null)으로 넣는다.
    partId: null,
    // ── 🔴 사용 부품 칸만 **저장할 때** 한글로 바꾼다 (2026-09-23 사용자 결정) ──
    //    까닭 셋:
    //     1. **사람이 고칠 수 있는 칸이다.** `UsedPartsEditForm` 이 이 글자를 그대로
    //        입력칸에 넣는다. 보여 줄 때만 바꾸면 표엔 한글, 「수정」을 누르면 일본어가
    //        떠서, 그대로 저장하면 일본어가 되돌아온다.
    //     2. **통계의 축이다.** `part_id` 가 거의 다 null 이라(바로 위 주석) 같은
    //        부품인지 가르는 열쇠가 사실상 이 글자다. 일본어 표기와 한글 표기가 섞이면
    //        같은 부품이 두 조각으로 갈라진다.
    //     3. **미리보기가 이미 한글을 보여 준다**(`KyosanReportImportParts`). 지금까지는
    //        미리보기가 한글을 보여 주고 일본어를 넣고 있었다 — 여기서 바꿔야 미리보기와
    //        실제가 맞는다.
    //
    //    🔴 **묶은 뒤에 건다**(`mergeKyosanPartsForUsedParts` 안이 아니다). 묶는 열쇠는
    //    연락서 표기여야 하고, `report-preview.test.ts` 가 묶은 결과의 글자를
    //    `終段AMP基板` · `スプリッタ基板` 같은 **일본어 그대로** 못 박고 있다. 묶는 함수
    //    안에서 바꾸면 그 단언들이 깨진다.
    //
    //    🔴 `translateKyosanSentence` 는 **all-or-nothing** 이다 — 바꾼 결과에 일본어가
    //    한 글자라도 남으면 `null` 이라 `?? line.text` 로 원문이 그대로 들어간다. 그래서
    //    고객 기록에 **완전한 한글이거나 원문 그대로**만 남고, 반쪽이 생기지 않는다.
    //
    //    🔴 **일본어 원문은 이 표에 남지 않는다**(원문 칸을 새로 만들지 않는 것이 사용자
    //    결정이다). 그래도 잃는 내용이 없다 — 같은 이식이 만드는 작업 기록 메모
    //    (`report-detail-values.ts`)에 교체 부품 글자가 **원문 그대로** 들어가고, 연락서
    //    원본 `.xlsm` 도 같은 건의 첨부로 남는다. 되짚을 자리가 둘 있다.
    partNameText: translateKyosanSentence(line.text) ?? line.text,
    // 🔴 수량은 연락서의 `交換部品詳細` 시트 `数量` 칸에서 온다(`parts-detail-sheet.ts`).
    //    (예전 주석은 「연락서에 수량이 적히는 자리가 없다」였는데 **거짓이었다** —
    //    Card 시트에는 없지만 그 시트에는 있다. 실측 1,315줄 중 1,285줄에 수가 적혀
    //    있었고, 30줄이 비어 있었다.) 적히지 않은 줄과 Card 시트에만 있는 부품은
    //    1 로 센다 — 표의 CHECK 가 0 이하를 막는다. 같은 이름이 고장분·예방분에
    //    둘 다 있으면 **그 둘을 더한 수**가 여기 들어간다.
    quantity: line.quantity,
  }));

  // 🔴 넣은 줄의 id 를 **같은 트랜잭션 안에서** 받아 온다 — 이식 흔적에 실어야
  //    나중에 그 회차만 골라 되돌릴 수 있다(위 머리말).
  const insertedRows = await tx
    .insert(repairCaseUsedParts)
    .values(nextLines)
    .returning({ id: repairCaseUsedParts.id });
  const insertedIds = insertedRows.map((row) => row.id);

  // 건의 version 을 올린다 — 사용 부품 저장이 쓰는 바로 그 번호다. 화면이 열어 둔
  // 폼은 다음 저장에서 CONFLICT 를 받고 다시 불러온다(그것이 맞는 신호다).
  await tx
    .update(repairCases)
    .set({ version: sql`${repairCases.version} + 1`, updatedAt: sql`now()` })
    .where(eq(repairCases.id, params.repairCaseId));

  await insertAuditLog(tx, {
    actorUserId: params.actorUserId,
    actionType: "UPDATE",
    targetEntity: "repair_case_used_parts",
    targetRecordId: params.repairCaseId,
    previousValue: { lines: previousLines },
    // 🔴 **앞의 줄을 여기 더하지 않는다**(2026-10-28). 덮어쓰기로 바뀌었으므로 저장 뒤의
    //    목록은 **이식이 넣은 줄 그것뿐**이다 — 옛 줄까지 적으면 감사 이력이 「남아 있다」고
    //    거짓말한다. 사라진 줄은 바로 위 `previousValue` 에 통째로 들어 있다.
    newValue: {
      lines: [
        ...nextLines.map((line) => ({
          lineNo: line.lineNo,
          partId: line.partId,
          partNameText: line.partNameText,
          quantity: line.quantity,
        })),
      ],
      source: KYOSAN_REPORT_SOURCE,
    },
  });

  // 🔴 세는 길은 하나다 — `insertedIds.length`. 넣은 줄 수와 id 개수가 어긋날
  //    길을 남기지 않는다(`nextLines.length` 와 같은 수다).
  return { insertedCount: insertedIds.length, insertedIds, skippedReason: null };
}

// ─────────────────────────────────────────────── 파일 (원본 · 사진)

const SOURCE_DESCRIPTION = "교산 연락서 원본";
const PHOTO_DESCRIPTION = "교산 연락서에서 꺼낸 사진";

/**
 * 원본 파일 한 장. 🔴 확장자가 `xlsm` 이면 **서버 출처 전용** 길로, 허용목록의
 * 확장자(`xlsx`·`xls`)면 평소 길로 간다. 둘 다 앞머리 바이트 대조를 거친다.
 */
async function placeSourceFile(
  repairCaseId: string,
  input: KyosanReportImportInput
): Promise<PlacedFile> {
  const extension = normalizeFileExtension(input.sourceFileName);
  if (extension === null) {
    throw new ImportAbort("SOURCE_REJECTED", "원본 파일의 확장자를 확인할 수 없습니다.");
  }

  const serverOrigin = !isAllowedExtension(extension) && isServerOriginExtension(extension);
  if (!serverOrigin && !isAllowedExtension(extension)) {
    throw new ImportAbort("SOURCE_REJECTED", "이 확장자의 파일은 첨부로 받을 수 없습니다.");
  }
  if (!serverOrigin && !isExtensionAllowedForCategory(extension, KYOSAN_ATTACHMENT_CATEGORY)) {
    throw new ImportAbort("SOURCE_REJECTED", "이 확장자의 파일은 연락서 칸에 받을 수 없습니다.");
  }

  const attachmentId = randomUUID().toLowerCase();
  let storedPath: string;
  try {
    storedPath = serverOrigin
      ? buildServerOriginAttachmentStoredPath({ repairCaseId, attachmentId, extension })
      : buildAttachmentStoredPath({ repairCaseId, attachmentId, extension });
  } catch (error) {
    if (error instanceof AttachmentPathError) {
      throw new ImportAbort("SOURCE_REJECTED", "원본 파일의 저장 경로를 만들지 못했습니다.");
    }
    throw error;
  }

  const written = await writeTemp(input.storage, input.sourceBytes, () => {
    throw new ImportAbort(
      "SOURCE_TOO_LARGE",
      `연락서 원본이 첨부 상한(${Math.floor(MAX_ATTACHMENT_SIZE_BYTES / (1024 * 1024))}MB)을 넘어 넣지 못했습니다.`
    );
  });

  const compatible = serverOrigin
    ? isServerOriginContentCompatible(extension, written.header)
    : isContentCompatibleWithExtension(extension, written.header);
  if (!compatible) {
    await input.storage.discard(written.tempPath).catch(() => undefined);
    throw new ImportAbort("SOURCE_REJECTED", "원본 파일의 내용이 확장자와 맞지 않습니다.");
  }

  await input.storage.commit(written.tempPath, storedPath);

  const mimeType = serverOrigin
    ? serverOriginMimeTypeForExtension(extension)
    : canonicalMimeTypeForExtension(extension);
  return {
    attachmentId,
    storedPath,
    originalFileName: input.sourceFileName,
    mimeType: mimeType ?? "application/octet-stream",
    fileSize: written.size,
    checksumSha256: written.sha256,
    description: SOURCE_DESCRIPTION,
  };
}

/**
 * 미리보기가 걸러 준 사진들(2026-09-21 결정 4). 🔴 **막지 않는다** — 한 장이
 * 상한을 넘거나 그림 형식이 아니면 그 한 장만 건너뛰고 경고를 남긴다. 사진은
 * 덧붙는 자료이고, 그것 때문에 보고서 본문을 통째로 못 넣게 할 이유가 없다.
 */
async function placePhotos(
  repairCaseId: string,
  input: KyosanReportImportInput,
  warnings: string[]
): Promise<PlacedFile[]> {
  const split = splitKyosanPhotos(input.report.photos);
  if (split.photos.length === 0) return [];

  let archive: ZipArchive;
  try {
    archive = ZipArchive.fromBuffer(input.sourceBytes);
  } catch {
    warnings.push(`사진 ${split.photos.length}장을 원본에서 꺼내지 못했습니다(통합문서를 다시 열지 못했습니다).`);
    return [];
  }

  const placed: PlacedFile[] = [];
  let skipped = 0;
  let index = 0;

  for (const photo of split.photos) {
    index += 1;
    const part = photo.parts[0];
    const extension = part === undefined ? null : normalizeFileExtension(part);
    if (
      extension === null ||
      !isAllowedExtension(extension) ||
      !isExtensionAllowedForCategory(extension, KYOSAN_ATTACHMENT_CATEGORY)
    ) {
      // `.emf`·`.wmf` 처럼 허용목록에 없는 그림이 통합문서에 섞여 있다.
      skipped += 1;
      continue;
    }

    const bytes = part === undefined ? null : archive.readEntry(part);
    if (bytes === null) {
      skipped += 1;
      continue;
    }

    const attachmentId = randomUUID().toLowerCase();
    let storedPath: string;
    try {
      storedPath = buildAttachmentStoredPath({ repairCaseId, attachmentId, extension });
    } catch {
      skipped += 1;
      continue;
    }

    let written;
    try {
      written = await writeTemp(input.storage, bytes, () => {
        throw new ImportAbort("STORAGE_FAILED", "사진 한 장이 첨부 상한을 넘습니다.");
      });
    } catch {
      skipped += 1;
      continue;
    }

    if (!isContentCompatibleWithExtension(extension, written.header)) {
      await input.storage.discard(written.tempPath).catch(() => undefined);
      skipped += 1;
      continue;
    }

    await input.storage.commit(written.tempPath, storedPath);
    placed.push({
      attachmentId,
      storedPath,
      // 🔴 이름에 고객 내용을 담지 않는다 — 연락서 원본 해시 앞머리로 가른다.
      originalFileName: `연락서-${input.report.sourceSha256.slice(0, 8)}-사진${index}.${extension}`,
      mimeType: canonicalMimeTypeForExtension(extension) ?? "application/octet-stream",
      fileSize: written.size,
      checksumSha256: written.sha256,
      description: PHOTO_DESCRIPTION,
    });
  }

  if (skipped > 0) {
    warnings.push(`사진 ${skipped}장은 첨부로 받을 수 있는 그림이 아니라 건너뛰었습니다.`);
  }
  return placed;
}

/** 올리기 통로와 같은 상한으로 임시 자리에 흘려보낸다. */
async function writeTemp(storage: StorageAdapter, bytes: Uint8Array, onTooLarge: () => never) {
  try {
    return await storage.writeTemp(streamOf(bytes), { maxBytes: MAX_ATTACHMENT_SIZE_BYTES });
  } catch (error) {
    if (error instanceof AttachmentTooLargeError) onTooLarge();
    throw error;
  }
}

/** 주인 없이 남은 파일을 치운다. 실패해도 삼킨다 — 응답을 바꿀 일이 아니다. */
async function discardPlaced(storage: StorageAdapter, placed: readonly PlacedFile[]): Promise<void> {
  for (const file of placed) {
    await storage.delete(file.storedPath).catch(() => undefined);
  }
}

function streamOf(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

/** 🔴 오류 객체를 통째로 남기지 않는다 — message 에 경로·입력값이 섞인다. */
function logImportFailure(repairCaseId: string, step: "storage" | "transaction", error: unknown): void {
  console.error("[kyosan-report-import] 연락서를 넣지 못했다", {
    repairCaseId,
    step,
    code:
      typeof error === "object" && error !== null && typeof (error as { code?: unknown }).code === "string"
        ? (error as { code: string }).code
        : error instanceof Error
          ? error.name
          : typeof error,
  });
}

/** 이 건에 이미 들어간 연락서 해시들 — 시험·화면이 「두 번 넣었나」를 물을 때. */
export async function listImportedKyosanSourceHashes(repairCaseId: string): Promise<string[]> {
  const rows = await db
    .select({ sourceSha256: sql<string>`${statusChangeHistories.metadata} ->> 'sourceSha256'` })
    .from(statusChangeHistories)
    .where(
      and(
        eq(statusChangeHistories.repairCaseId, repairCaseId),
        sql`${statusChangeHistories.metadata} ->> 'source' = ${KYOSAN_REPORT_SOURCE}`,
        sql`${statusChangeHistories.metadata} ->> 'sourceSha256' is not null`
      )
    )
    .orderBy(desc(statusChangeHistories.createdAt));
  return rows.map((row) => row.sourceSha256);
}
