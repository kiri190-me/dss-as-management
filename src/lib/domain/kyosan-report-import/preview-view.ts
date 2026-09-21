import { MAX_ATTACHMENT_SIZE_BYTES } from "@/lib/domain/attachment-allowlist";
import type { KyosanFormFamily } from "@/lib/kyosan/kyosan-report";
import type {
  KyosanAgreement,
  KyosanIdentityCheck,
  KyosanIntakeNumberStatus,
  KyosanMatch,
} from "@/lib/kyosan/report-match";
import {
  kyosanLineDestination,
  kyosanPartDestination,
  type KyosanDetailDestination,
} from "@/lib/kyosan/report-detail-values";
import type {
  KyosanCaseState,
  KyosanPreviewLine,
  KyosanPreviewPart,
} from "@/lib/kyosan/report-preview";
import type { KyosanReportImportFailureCode } from "@/lib/server/services/kyosan-report-import";

/**
 * ============================================================================
 * 연락서 한 장 넣기 — 화면이 쓰는 모양과 판단 (2026-09-21, 조각 S4)
 * ============================================================================
 * 🔴 **순수 함수만 있다.** DB 도 `server-only` 도 React 도 모른다. 서버(미리보기
 * 서비스)와 화면(클라이언트 묶음)이 **같은 타입 한 벌**을 쓰기 위한 자리이고,
 * 저장 단추를 열지 말지를 정하는 판단이 여기에 있어 Node 시험으로 돌아간다.
 *
 * ── 🔴 「무엇이 어디로 가는가」는 저장과 **같은 함수**로 말한다 (S5) ──
 * 이식은 보고서를 만들지 않는다(사용자 결정 2026-09-21). 줄마다 상세의 어느
 * 칸으로 가는지는 `kyosan/report-detail-values.ts` 의 `kyosanLineDestination`
 * 하나가 정하고, **저장도 화면도 그것을 부른다** — 화면에만 있는 이름표를 따로
 * 적으면 「보여 준 자리」와 「들어간 자리」가 갈라진다.
 *
 * ── 🔴 여기에 plan 을 만들지 않는다 ──────────────────────────────────
 * 저장 함수(`server/services/kyosan-report-import.ts`)는 **미리보기 결과를 받지
 * 않는다.** 화면이 서버로 보내는 것은 `파일`과 `사람이 고른 수리 건 id` 뿐이고,
 * 짝짓기 · 미리보기 · 무엇을 넣을지는 저장 함수가 처음부터 다시 돌린다. 이
 * 파일이 만드는 것은 **사람에게 보여 줄 그림**일 뿐이다 — 그림을 서버로
 * 되돌려 보내면 「사람이 본 것」과 「들어간 것」이 갈라진다.
 *
 * ── 🔴 저장 단추를 여는 규칙 (`kyosanReportSaveOffer`) ────────────────
 * 사용자 정책(2026-09-21)이 「**이미 수리 건이 등록된 경우에만** 이식한다」이다.
 *   · `none`    — 짝이 없다 / 막는 것이 있다(휴지통 · 이미 넣은 연락서 · 상태를
 *                 못 읽음). **단추를 그리지 않는다.** 수리 건을 새로 만드는 길도
 *                 만들지 않는다.
 *   · `confirm` — 접수번호로 짝이 하나로 확정됐다. 그 건을 보여 주고 확인받는다.
 *   · `choose`  — 후보가 있지만 **사람이 골라야 한다**. 고르기 전에는 저장할 수
 *                 없다(`canImportKyosanReport` 가 `false`).
 * ============================================================================
 */

/** 올릴 수 있는 연락서 확장자. 🔴 `.xlsm` 은 매크로가 든 원본 양식이다. */
export const KYOSAN_REPORT_EXTENSIONS = [".xlsm", ".xlsx"] as const;

/**
 * 올릴 수 있는 크기. 원본 파일이 그대로 첨부로 남으므로 첨부 상한과 같아야
 * 한다 — 상수를 그대로 가져와 두 값이 갈라질 수 없게 한다.
 */
export const KYOSAN_REPORT_UPLOAD_MAX_BYTES = MAX_ATTACHMENT_SIZE_BYTES;

const MAX_MB = Math.floor(KYOSAN_REPORT_UPLOAD_MAX_BYTES / (1024 * 1024));

/** 고른 파일을 서버에 보내기 전에 화면에서 먼저 본다. 괜찮으면 null. */
export function checkKyosanReportFile(file: { name: string; size: number }): string | null {
  if (!/\.(xlsm|xlsx)$/i.test(file.name)) return ".xlsm 또는 .xlsx 연락서 파일만 올릴 수 있습니다.";
  if (file.size === 0) return "빈 파일입니다.";
  if (file.size > KYOSAN_REPORT_UPLOAD_MAX_BYTES) {
    return `${MAX_MB}MB 이하의 연락서 파일만 올릴 수 있습니다.`;
  }
  return null;
}

// ─────────────────────────────────────────────── 미리보기가 돌려주는 모양

/** 후보 한 건 — 화면이 「무엇이 맞고 무엇이 다른지」를 그리는 데 필요한 전부. */
export type KyosanReportTarget = {
  repairCaseId: string;
  intakeNumber: string;
  /** 🔴 휴지통의 건도 접수번호를 차지한다. 넣을 수는 없고 보여 주기만 한다. */
  isDeleted: boolean;
  customerName: string | null;
  modelName: string | null;
  serialNumber: string | null;
  lotNumber: string | null;
  /** 항목마다 `agree` · `differ` · `unknown`(S3a 의 `checkKyosanIdentity`). */
  identity: KyosanIdentityCheck;
  /**
   * 이 건에 이미 있는(지워지지 않은) 보고서 수. 🔴 **이식은 보고서를 만들지
   * 않는다** — 이 수는 건의 사실을 곁들이는 것일 뿐, 이식이 한 장을 더한다는
   * 뜻이 아니다.
   */
  serviceReportCount: number;
  /**
   * 🔴 이 건의 신고 증상 칸에 이미 값이 있는가. 있으면 이식은 그 칸을 **덮지
   * 않고** 고객 고장 상황을 작업 기록으로 보낸다.
   */
  hasReportedSymptom: boolean;
  /** 🔴 이 연락서(같은 원본 파일)를 이 건에 이미 넣었는가. */
  alreadyImported: boolean;
};

/** 연락서 한 장에서 나온 내용 — **어느 건에 붙든 같다**(순수 함수의 결과다). */
export type KyosanReportContent = {
  lines: readonly KyosanPreviewLine[];
  parts: readonly KyosanPreviewPart[];
  causeMarks: readonly string[];
  actionMarks: readonly string[];
  /** 양식 아이콘 · 도장을 걸러 낸 실제 사진 수. */
  photoCount: number;
  /** 걸러 낸 양식 자산 수 — 「왜 30장이 6장이 됐나」를 사람이 알 수 있게. */
  formAssetCount: number;
};

/** 연락서에 적혀 있는 신원. 사람이 후보와 눈으로 견주는 근거다. */
export type KyosanReportIdentityView = {
  rawIntakeNumber: string | null;
  intakeNumber: string | null;
  model: string | null;
  serialNumber: string | null;
  lotNumber: string | null;
  customer: string | null;
};

export type KyosanReportMatchView =
  | { kind: "matched" }
  | { kind: "ambiguous"; reason: "identity-conflict" | "identity-candidates" }
  | {
      kind: "unmatched";
      reason: "intake-number-missing" | "intake-number-malformed" | "intake-number-not-found";
    };

export type KyosanReportPreviewReady = {
  ok: true;
  sourceSha256: string;
  formFamily: KyosanFormFamily;
  intakeNumberStatus: KyosanIntakeNumberStatus;
  reportIdentity: KyosanReportIdentityView;
  match: KyosanReportMatchView;
  /** 짝 후보들. `unmatched` 면 비어 있다. */
  targets: readonly KyosanReportTarget[];
  /**
   * 🔴 저장 함수가 지금 이 순간 넣겠다고 판정한 건. `matched` 이고 막는 것이
   * 없을 때만 값이 있다. 화면은 이것을 **기본 선택**으로만 쓰고, 서버로는
   * 사람이 고른 id 를 보낸다(서버가 다시 판정한다).
   */
  confirmedRepairCaseId: string | null;
  content: KyosanReportContent;
  /** 넣으면 안 되는 까닭(S3a 의 문구 그대로). 🔴 고객 내용이 없다. */
  blockers: readonly string[];
  /** 넣을 수는 있지만 사람이 알아야 하는 것. */
  warnings: readonly string[];
  /** 판독기가 읽다가 만난 문제들. */
  problems: readonly string[];
};

export type KyosanReportPreviewFailureCode = "UNREADABLE";

export type KyosanReportPreviewOutcome =
  | KyosanReportPreviewReady
  | { ok: false; code: KyosanReportPreviewFailureCode; message: string };

// ─────────────────────────────────────────────── 후보 목록 만들기 (순수)

/**
 * 짝짓기 결과와 건들의 현재 상태를 합쳐 화면이 쓸 후보 목록을 만든다.
 * 🔴 여기서 고르지 않는다 — 고르는 것은 사람이다.
 */
export function buildKyosanReportTargets(
  match: KyosanMatch,
  caseStates: readonly KyosanCaseState[],
  sourceSha256: string
): KyosanReportTarget[] {
  const stateById = new Map(caseStates.map((state) => [state.repairCaseId, state]));
  const views =
    match.outcome.kind === "matched"
      ? [{ candidate: match.outcome.candidate, identity: match.outcome.identity }]
      : match.outcome.kind === "ambiguous"
        ? match.outcome.candidates
        : [];

  return views.map((view) => {
    const state = stateById.get(view.candidate.repairCaseId) ?? null;
    return {
      repairCaseId: view.candidate.repairCaseId,
      intakeNumber: view.candidate.intakeNumber,
      isDeleted: view.candidate.isDeleted,
      customerName: view.candidate.customerName,
      modelName: view.candidate.modelName,
      serialNumber: view.candidate.serialNumber,
      lotNumber: view.candidate.lotNumber ?? null,
      identity: view.identity,
      serviceReportCount: state?.serviceReportCount ?? 0,
      hasReportedSymptom: state?.hasReportedSymptom ?? false,
      alreadyImported: state?.importedSourceSha256.includes(sourceSha256) ?? false,
    };
  });
}

// ─────────────────────────────────────────────── 저장 단추를 여는 규칙

export type KyosanReportSaveOffer = "none" | "confirm" | "choose";

/**
 * 🔴 저장 단추를 어떻게 낼 것인가. 머리말의 세 갈래다.
 *
 * `matched` 인데 `confirmedRepairCaseId` 가 없다면 막는 것이 있다는 뜻이다
 * (휴지통 · 이미 넣은 연락서 · 상태를 못 읽음) — 단추를 아예 그리지 않는다.
 * 눌러도 저장 함수가 거절할 단추를 그리면 사람이 까닭을 두 번 읽어야 한다.
 */
export function kyosanReportSaveOffer(preview: KyosanReportPreviewReady): KyosanReportSaveOffer {
  if (preview.match.kind === "unmatched") return "none";
  if (preview.match.kind === "ambiguous") {
    // 고를 수 있는 후보가 하나도 없으면(전부 휴지통) 고르게 할 것이 없다.
    return preview.targets.some((target) => !target.isDeleted) ? "choose" : "none";
  }
  return preview.confirmedRepairCaseId === null ? "none" : "confirm";
}

/**
 * 🔴 지금 [이식] 을 누를 수 있는가. **고른 건이 없으면 언제나 false** 다.
 * 고른 건은 미리보기가 보여 준 후보 가운데 하나여야 하고, 휴지통의 건은 못 고른다.
 */
export function canImportKyosanReport(
  preview: KyosanReportPreviewReady,
  selectedRepairCaseId: string | null
): boolean {
  if (kyosanReportSaveOffer(preview) === "none") return false;
  if (selectedRepairCaseId === null) return false;
  const target = preview.targets.find((item) => item.repairCaseId === selectedRepairCaseId);
  return target !== undefined && !target.isDeleted && !target.alreadyImported;
}

/**
 * 짝이 하나로 확정됐을 때만 미리 골라 둔다. 🔴 **후보가 여럿이면 null** 이다 —
 * 하나를 미리 골라 두면 사람이 고르지 않고 그냥 누른다.
 */
export function defaultKyosanReportSelection(preview: KyosanReportPreviewReady): string | null {
  return kyosanReportSaveOffer(preview) === "confirm" ? preview.confirmedRepairCaseId : null;
}

// ─────────────────────────────────────────────── 화면 글자

export const KYOSAN_AGREEMENT_LABEL: Readonly<Record<KyosanAgreement, string>> = {
  agree: "같음",
  differ: "다름",
  unknown: "모름",
};

/** 짝이 없을 때 — 까닭을 갈라 보여 준다(사용자 정책: 새로 만들지 않는다). */
export const KYOSAN_UNMATCHED_TEXT: Readonly<
  Record<Extract<KyosanReportMatchView, { kind: "unmatched" }>["reason"], string>
> = {
  "intake-number-missing": "연락서에서 접수번호를 읽지 못했습니다.",
  "intake-number-malformed": "접수번호가 번호 꼴(D + 연월 4자리 + 순번 2자리)이 아닙니다.",
  "intake-number-not-found": "그 접수번호로 등록된 수리 건이 없습니다.",
};

/** 후보가 여럿일 때 — 왜 사람이 골라야 하는가. */
export const KYOSAN_AMBIGUOUS_TEXT: Readonly<
  Record<Extract<KyosanReportMatchView, { kind: "ambiguous" }>["reason"], string>
> = {
  "identity-conflict":
    "접수번호로 찾은 수리 건과 모델도 S/N 도 다릅니다 — 번호를 잘못 읽었거나 잘못 적힌 것일 수 있습니다.",
  "identity-candidates":
    "접수번호로 짝을 정하지 못해 S/N 으로 후보를 찾았습니다 — 같은 장비가 여러 번 수리를 오므로 사람이 골라야 합니다.",
};

/**
 * 🔴 고르면 어떻게 되는지를 **미리** 말한다. 두 갈래의 답이 다르다(조각 S4b).
 *
 *  · `identity-candidates` — 사용자 결정(2026-09-21)에 따라 **사람이 고르면
 *    저장까지 받아들인다.** 다만 저장 직전에 서버가 고른 건의 모델·S/N 을
 *    연락서와 다시 대조하고, 맞지 않으면 넣지 않는다.
 *  · `identity-conflict`  — 골라도 저장되지 않는다. 접수번호로 찾은 건과 모델도
 *    S/N 도 달라 「번호가 틀렸다」는 뜻이고, 그것은 사람이 자료를 고쳐야 한다.
 *    화면은 그 사실을 **숨기지 않고 미리 말한다.**
 */
export const KYOSAN_CHOICE_CAUTION: Readonly<
  Record<Extract<KyosanReportMatchView, { kind: "ambiguous" }>["reason"], string>
> = {
  "identity-conflict":
    "이 경우에는 후보를 골라 [이식]을 눌러도 저장되지 않습니다 — " +
    "수리 건 또는 연락서의 접수번호를 먼저 바로잡아 주세요.",
  "identity-candidates":
    "고른 수리 건에 저장합니다. 저장 직전에 서버가 고른 건의 모델·S/N 을 연락서와 다시 " +
    "대조하고, 맞지 않으면 넣지 않습니다 — 고르기 전에 아래 표를 눈으로 확인해 주세요.",
};

/** 저장이 실패했을 때 사람에게 보일 첫 문장. 자세한 것은 서버 문구가 잇는다. */
export const KYOSAN_IMPORT_FAILURE_TEXT: Readonly<Record<KyosanReportImportFailureCode, string>> = {
  NOT_IMPORTABLE: "넣지 않았습니다.",
  ALREADY_IMPORTED: "이미 넣은 연락서입니다.",
  TARGET_CHANGED: "고른 수리 건이 그 사이에 바뀌었습니다.",
  SOURCE_REJECTED: "원본 파일을 첨부로 받을 수 없습니다.",
  SOURCE_TOO_LARGE: "원본 파일이 첨부 상한을 넘습니다.",
  STORAGE_FAILED: "파일을 저장하지 못했습니다.",
  SAVE_REJECTED: "저장하지 못했습니다.",
};

/**
 * 🔴 **줄이 실제로 들어갈 자리의 이름표** (2026-09-21, 조각 S5).
 *
 * 예전에는 보고서 양식의 구역 이름(`확인 내용` · `조치 내용` · `요약` · `비고`)을
 * 보여 주었다. 이식이 보고서를 만들지 않게 된 지금 그 이름들은 **상세에 없는
 * 칸**이라, 그대로 두면 화면이 거짓말을 한다. 이름표는 상세의 진짜 자리를
 * 가리키고, 그 자리를 정하는 함수는 저장이 쓰는 것과 **같은 순수 함수**다
 * (`kyosan/report-detail-values.ts` 의 `kyosanLineDestination`).
 */
export const KYOSAN_DESTINATION_LABEL: Readonly<Record<KyosanDetailDestination, string>> = {
  REPORTED_SYMPTOM: "신고 증상",
  INTAKE_INSPECTION_RESULT: "작업 기록 · 인수점검 결과",
  DIAGNOSIS_REPAIR_SUMMARY: "작업 기록 · 진단/조치",
  WORK_RECORD_GENERAL: "작업 기록 · 일반",
  NOT_IMPORTED: "넣지 않음",
};

/** 이름표만으로는 모자란 자리에 곁들이는 한 마디. 없으면 `null`. */
export const KYOSAN_DESTINATION_NOTE: Readonly<Record<KyosanDetailDestination, string | null>> = {
  REPORTED_SYMPTOM: "비어 있을 때만 — 값이 있으면 덮지 않고 작업 기록으로",
  INTAKE_INSPECTION_RESULT: "기본 정보의 「인수점검 결과」로 보입니다",
  DIAGNOSIS_REPAIR_SUMMARY: "기본 정보의 「현재 진단/조치 요약」으로 보입니다",
  WORK_RECORD_GENERAL: "작업 이력에만 남습니다",
  NOT_IMPORTED: "원본 첨부에만 남습니다",
};

/**
 * 줄 하나가 어디로 가는가. 🔴 **저장이 쓰는 함수를 그대로 다시 쓴다** — 화면이
 * 따로 계산하면 「보여 준 자리」와 「들어간 자리」가 갈라진다.
 */
export function kyosanReportLineDestination(line: KyosanPreviewLine): KyosanDetailDestination {
  return kyosanLineDestination(line);
}

/** 교체 부품 줄의 자리. 사용 부품 칸과 **둘 다** 간다. */
export function kyosanReportPartDestination(): KyosanDetailDestination {
  return kyosanPartDestination();
}

export const KYOSAN_PART_KIND_LABEL: Readonly<Record<KyosanPreviewPart["kind"], string>> = {
  fault: "고장분",
  preventive: "예방분",
};

/** 수리 건 상세 주소. */
export function kyosanRepairCaseHref(repairCaseId: string): string {
  return `/repair-cases/${repairCaseId}`;
}
