/**
 * ============================================================================
 * 연락서 이식을 되돌릴 때 **무엇을 고를지** 정하는 순수 함수 (조각 S5-B)
 * ============================================================================
 * DB 도 디스크도 건드리지 않는다. 받은 값으로 「이 흔적을 되돌려도 되는가 ·
 * 되돌린다면 어느 줄을 지우는가」만 판정하고 돌려준다. 그래서 DB 없이 값으로
 * 시험할 수 있고(`kyosan-import-revert-plan.test.ts`), 실제로 지우는 쪽
 * (`kyosan-import-revert.ts`)은 여기가 고른 id 만 지운다.
 *
 * ── 🔴 왜 순수 함수로 갈라 두는가 ───────────────────────────────────────
 * 이 판정이 틀리면 **남의 줄이 지워진다.** 개발 DB 실측에서 이미 걸린 것이
 * 있다: `category = 'KYOSAN_DOCUMENT'` 인 첨부 가운데 **사람이 올린 1건**이
 * 섞여 있었다(`description` 이 NULL, 접수번호 D260891). 분류만 보고 고르면
 * 그 파일이 함께 사라진다. 그래서 고르는 규칙이 값 시험으로 못 박혀 있어야
 * 한다.
 *
 * ── 이식이 만드는 것 여섯 ───────────────────────────────────────────────
 *   1. `repair_case_work_records`   작업 기록 N줄
 *   2. `repair_case_used_parts`     사용 부품 N줄
 *   3. `attachments`                원본 `.xlsm` 1 + 사진 N
 *   4. `repair_cases.reported_symptom`  **비어 있었을 때만** 채워진다
 *   5. `status_change_histories`    이식 흔적 1줄
 *   6. 디스크                        첨부 파일 실물
 *
 * ── 🔴 흔적이 두 가지다 — 새 흔적과 옛 흔적 ─────────────────────────────
 * 조각 S5-A(커밋 `99b860d`) 부터 이식 흔적에 `usedPartIds` · `attachmentIds` ·
 * `importBatchId` 가 실린다. 그 **새 흔적**은 id 로 정확히 고를 수 있다.
 *
 * 그 전에 들어간 **옛 흔적**에는 id 가 없다(개발 DB 실측: 8행 전부). 그때는
 * 남은 단서로 고른다:
 *   · 사용 부품 — `audit_logs` 의 이식 스냅숏과 `(lineNo, partNameText,
 *     quantity)` 가 **정확히** 맞는 줄만. 품명 한 칸만은 **번역 대조**도 받는다
 *     (바로 아래 문단 — `line_no` 와 `quantity` 는 느슨해지지 않는다)
 *   · 첨부 원본 — `description = '교산 연락서 원본'` **그리고**
 *     `checksum_sha256 = 흔적의 sourceSha256`
 *   · 첨부 사진 — `description = '교산 연락서에서 꺼낸 사진'` **그리고**
 *     `original_file_name` 이 `연락서-<sha 앞 8자>-사진…`
 * 🔴 어느 쪽도 `category` 만으로 고르지 않는다(위 문단의 사람 업로드 1건).
 *
 * ── 🔴 옛 흔적의 품명은 「번역 대조」도 받는다 (조각 S5-B2, 2026-09-28) ──
 * 이식은 **2026-09-22** 에 돌면서 품명을 **일본어 그대로** 넣었다. 그 다음 날
 * **2026-09-23** 에 `scripts/backfill-used-parts-korean.ts` 가 이미 들어간 품명을
 * **한글로 바꿨다.** 감사 스냅숏은 그때의 일본어를 그대로 들고 있으므로, 글자
 * 통째로 견주면 개발 DB 의 `D210102`(1줄) · `D260403`(5줄)이 **한 줄도 못 맞아**
 * 통째로 건너뛰어졌다(실측 2026-09-28):
 *
 *     감사 스냅숏 (9/22)                 지금 값 (9/23 백필 뒤)
 *     終段AMP基板（AMP-DEH基板）      ↔  종단 AMP 기판(AMP-DEH 기판)
 *     終段AMP入力保護用ヒューズ        ↔  종단 AMP 입력 보호용 퓨즈
 *     通信基板                         ↔  통신 기판
 *
 * 🔴 **느슨하게 만드는 것이 아니다 — 백필이 쓴 바로 그 함수를 되짚는 것이다.**
 * 백필(`backfill-used-parts-korean.ts:8`)도 이식기
 * (`server/services/kyosan-report-import.ts:61 · :893`)도 같은
 * `translateKyosanSentence` 를 지난다. 즉 **지금 DB 에 들어 있는 한글을 만든
 * 함수가 바로 그것**이라, 스냅숏 이름을 그 함수에 한 번 통과시킨 글자가 지금
 * 값과 같으면 그 줄은 **같은 줄이다.**
 *
 * 그 함수는 all-or-nothing 이라 사전이 모르면 `null` 을 돌려준다 — 그때는 원문
 * 그대로 견주고, 그래도 다르면 **안 맞은 것**이다. 그리고 🔴 **`line_no` 와
 * `quantity` 는 지금처럼 정확히 맞아야 한다** — 느슨해지는 칸은 품명 하나뿐이다.
 *
 * ── 🔴 개수가 어긋나면 지우지 않는다 ────────────────────────────────────
 * 흔적이 말하는 `usedPartCount` · `attachmentCount` · `photoCount` 와 실제로
 * 찾은 수가 다르면 **그 흔적을 통째로 건너뛴다.** 「대충 맞으니 지운다」로 가지
 * 않는다 — 어긋났다는 것은 우리가 모르는 일이 그 사이에 있었다는 뜻이고,
 * 그때 지우면 무엇을 지웠는지 아무도 모른다.
 *
 * ── 🔴 보고서·견적서·청구서는 한 줄도 건드리지 않는다 ───────────────────
 * 이식은 `service_reports` 를 만들지 않는다(`kyosan-report-import.ts` 머리말).
 * 그래서 이 파일에는 그 표를 고르는 줄이 하나도 없다. 다만 **아주 옛 판**의
 * 흔적에는 `serviceReportId` 가 실려 있다 — 그런 흔적을 만나면 지우지 않고
 * **알림만 남긴다**(사람이 따로 판단할 일이다).
 * ============================================================================
 */

/**
 * 🔴 **이 파일이 들여오는 것은 이것 하나뿐이다.** 순수 함수 파일이므로 DB 도
 * 환경변수도 `server-only` 도 끌지 않는 사슬이어야 한다 — 확인했다:
 * `report-word-terms` → `report-free-text-terms` · `report-terms` →
 * `report-causes`, 그 끝의 `@/lib/xlsx/service-report-template` 은 **`import
 * type`** 이라 컴파일에서 지워진다. 표(사전)와 순수 함수뿐이다.
 *
 * 🔴 **왜 되돌리기가 번역 함수를 부르나** — 이식기와 백필이 쓴 **바로 그 함수**라
 * 서다(파일 머리말 「번역 대조」 문단). 여기서 따로 사전을 베끼면 한쪽만 바뀌는
 * 날이 오고, 그날 되돌리기는 **남의 줄을 지우거나 제 줄을 못 지운다.**
 */
import { translateKyosanSentence } from "../../src/lib/kyosan/report-word-terms";

/** 이식 흔적을 가르는 표시. `db/queries/kyosan-report-link.ts` 의 같은 값이다. */
export const KYOSAN_REPORT_SOURCE = "KYOSAN_REPORT";

/**
 * 연락서 첨부의 분류. 🔴 **이것만으로 고르면 안 된다** — 사람이 올리는 통로에도
 * 열려 있는 칸이다(파일 머리말). 아래 두 설명과 **함께** 걸 때만 쓴다.
 */
export const KYOSAN_ATTACHMENT_CATEGORY = "KYOSAN_DOCUMENT";

/**
 * 🔴 `server/services/kyosan-report-import.ts` 의 `SOURCE_DESCRIPTION` ·
 * `PHOTO_DESCRIPTION` 과 **글자 하나까지 같아야 한다.** 그쪽은 모듈 안에만 있는
 * 상수라 불러올 수 없어(그 파일은 이번 조각에서 고치지 않는다) 여기 다시 적는다.
 * 대신 시험(`kyosan-import-revert-plan.test.ts`)이 **그 파일의 글자를 읽어**
 * 이 값과 같은지 본다 — 한쪽만 바뀌면 시험이 깨진다.
 */
export const KYOSAN_SOURCE_ATTACHMENT_DESCRIPTION = "교산 연락서 원본";
export const KYOSAN_PHOTO_ATTACHMENT_DESCRIPTION = "교산 연락서에서 꺼낸 사진";

/**
 * 이식이 사진 첨부에 붙이는 이름의 앞머리. 이식기는
 * `연락서-${sourceSha256.slice(0,8)}-사진${번호}.${확장자}` 로 짓는다 —
 * 🔴 고객 내용이 들어가지 않게 원본 해시 앞머리로 가르는 이름이다.
 */
export function kyosanPhotoNamePrefix(sourceSha256: string): string {
  return `연락서-${sourceSha256.slice(0, 8)}-사진`;
}

// ─────────────────────────────────────────────── 흔적 metadata 읽기

export type KyosanTraceMetadata = {
  /** `metadata.source` 가 `KYOSAN_REPORT` 인가 — 아니면 이 도구의 대상이 아니다. */
  isKyosanReportTrace: boolean;
  sourceSha256: string | null;
  workRecordIds: readonly string[];
  /**
   * 🔴 `null` 은 **「흔적이 말하지 않는다」**이지 「안 채웠다」가 아니다. 아주 옛
   * 판의 흔적에는 이 칸이 없고, 그때는 신고 증상을 되돌려야 하는지 알 길이
   * 없으므로 되돌리지 않고 건너뛴다.
   */
  reportedSymptomFilled: boolean | null;
  usedPartCount: number | null;
  /** 🔴 새 흔적(S5-A 이후)에만 있다. 없으면 `null` — 옛 흔적이다. */
  usedPartIds: readonly string[] | null;
  attachmentCount: number | null;
  /** 🔴 새 흔적에만 있다. 없으면 `null` — 옛 흔적이다. */
  attachmentIds: readonly string[] | null;
  photoCount: number | null;
  importBatchId: string | null;
  /** 🔴 보고서를 만들던 아주 옛 판의 흔적. 되돌리기는 보고서를 건드리지 않는다. */
  legacyServiceReportId: string | null;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asStringArray(value: unknown): readonly string[] | null {
  if (!Array.isArray(value)) return null;
  if (!value.every((item) => typeof item === "string" && item.length > 0)) return null;
  return value as readonly string[];
}

function asCount(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) return null;
  return value;
}

export function readKyosanTraceMetadata(raw: unknown): KyosanTraceMetadata {
  const metadata = asRecord(raw);
  if (metadata === null) {
    return {
      isKyosanReportTrace: false,
      sourceSha256: null,
      workRecordIds: [],
      reportedSymptomFilled: null,
      usedPartCount: null,
      usedPartIds: null,
      attachmentCount: null,
      attachmentIds: null,
      photoCount: null,
      importBatchId: null,
      legacyServiceReportId: null,
    };
  }

  return {
    isKyosanReportTrace: metadata.source === KYOSAN_REPORT_SOURCE,
    sourceSha256: typeof metadata.sourceSha256 === "string" && metadata.sourceSha256.length > 0 ? metadata.sourceSha256 : null,
    workRecordIds: asStringArray(metadata.workRecordIds) ?? [],
    reportedSymptomFilled: typeof metadata.reportedSymptomFilled === "boolean" ? metadata.reportedSymptomFilled : null,
    usedPartCount: asCount(metadata.usedPartCount),
    // 🔴 칸이 아예 없으면 `null`(옛 흔적), 있는데 모양이 틀리면 그것도 `null` 이다 —
    //    모양이 틀린 값으로 id 를 고르면 엉뚱한 줄이 지워진다.
    usedPartIds: "usedPartIds" in metadata ? asStringArray(metadata.usedPartIds) : null,
    attachmentCount: asCount(metadata.attachmentCount),
    attachmentIds: "attachmentIds" in metadata ? asStringArray(metadata.attachmentIds) : null,
    photoCount: asCount(metadata.photoCount),
    importBatchId: typeof metadata.importBatchId === "string" ? metadata.importBatchId : null,
    legacyServiceReportId: typeof metadata.serviceReportId === "string" ? metadata.serviceReportId : null,
  };
}

// ─────────────────────────────────────────────── 옛 흔적의 사용 부품 대조

/** `audit_logs` 스냅숏 한 줄. 🔴 **행 id 가 없다** — 그래서 값으로 맞춰야 한다. */
export type AuditUsedPartLine = {
  lineNo: number;
  partNameText: string;
  quantity: number;
};

export type UsedPartRowSnapshot = {
  id: string;
  lineNo: number;
  partNameText: string;
  quantity: number;
};

function readAuditLines(value: unknown): AuditUsedPartLine[] | null {
  const holder = asRecord(value);
  if (holder === null) return null;
  const lines = holder.lines;
  if (!Array.isArray(lines)) return null;

  const parsed: AuditUsedPartLine[] = [];
  for (const entry of lines) {
    const line = asRecord(entry);
    if (line === null) return null;
    if (typeof line.lineNo !== "number" || !Number.isInteger(line.lineNo)) return null;
    if (typeof line.partNameText !== "string") return null;
    if (typeof line.quantity !== "number" || !Number.isInteger(line.quantity)) return null;
    parsed.push({ lineNo: line.lineNo, partNameText: line.partNameText, quantity: line.quantity });
  }
  return parsed;
}

/**
 * 이식이 **그때 새로 넣은 줄**만 뽑는다.
 *
 * 🔴 감사 스냅숏의 `new_value.lines` 는 **이미 있던 줄 + 새로 넣은 줄**이다
 * (`appendUsedParts` 가 그렇게 적는다). `previous_value.lines` 가 「이미 있던
 * 줄」이므로, 그 `lineNo` 를 빼면 남는 것이 이식이 넣은 줄이다. 빼지 않으면
 * **사람이 먼저 적어 둔 줄까지 되돌리기 대상이 된다.**
 *
 * 모양이 조금이라도 다르면 `null` 을 돌려준다 — 그때는 되돌리지 않는다.
 */
export function legacyUsedPartLinesFromAudit(params: {
  previousValue: unknown;
  newValue: unknown;
}): AuditUsedPartLine[] | null {
  const next = readAuditLines(params.newValue);
  if (next === null) return null;
  const previous = params.previousValue === null || params.previousValue === undefined
    ? []
    : readAuditLines(params.previousValue);
  if (previous === null) return null;

  const previousLineNos = new Set(previous.map((line) => line.lineNo));
  return next.filter((line) => !previousLineNos.has(line.lineNo));
}

export type LegacyUsedPartMismatch = {
  line: AuditUsedPartLine;
  /**
   * 같은 `line_no` 에 **지금** 들어 있는 줄(있으면). 왜 안 맞는지 사람이 바로
   * 보라고 함께 싣는다 — 번역 대조까지 거쳤는데도 다른 글자라는 뜻이므로,
   * 사람이 그 자리를 직접 보고 판단해야 한다.
   */
  rowAtSameLineNo: UsedPartRowSnapshot | null;
};

/**
 * 어떻게 맞췄는가. `exact` = 스냅숏 글자 그대로 · `translated` = 스냅숏의 일본어를
 * **이식기·백필과 같은 함수**(`translateKyosanSentence`)로 옮긴 글자가 지금 값과
 * 같다(파일 머리말 「번역 대조」 문단). 계획 출력이 이것을 사람에게 알린다.
 */
export type LegacyUsedPartMatchBasis = "exact" | "translated";

export type LegacyUsedPartMatch = {
  matched: readonly { line: AuditUsedPartLine; row: UsedPartRowSnapshot; via: LegacyUsedPartMatchBasis }[];
  /** 🔴 스냅숏에는 있는데 지금 표에서 **똑같은 줄을 못 찾은** 것. 있으면 건너뛴다. */
  unmatched: readonly LegacyUsedPartMismatch[];
};

/**
 * 🔴 `(lineNo, quantity)` 는 **정확히** 맞아야 하고, 품명은 **글자 그대로거나
 * 번역 대조로** 맞아야 한다.
 *
 * 품명 한 칸만 두 갈래인 까닭은 파일 머리말의 「번역 대조」 문단에 있다 —
 * 스냅숏은 이식하던 2026-09-22 의 **일본어**, 지금 표는 백필이 2026-09-23 에
 * 넣은 **한글**이고, 그 한글을 만든 함수가 `translateKyosanSentence` 다.
 * 🔴 `line_no` 와 `quantity` 는 **한 칸도 느슨해지지 않는다.**
 *
 * 하나라도 못 맞추면 그 줄을 `unmatched` 에 담아 돌려준다 — 부르는 쪽은 그때
 * **아무 줄도 지우지 않는다**(안전장치 4). 값이 달라졌다는 것은 사람이 고쳤거나
 * 다른 일이 있었다는 뜻이고, 그 상태에서 지우면 사람의 손길이 사라진다.
 *
 * 한 스냅숏 줄이 두 개 이상의 행에 맞는 일은 표의 유니크 인덱스(건 + line_no)
 * 때문에 일어나지 않지만, 그래도 **한 행은 한 번만** 쓰이게 소모한다.
 */
export function matchLegacyUsedPartRows(
  expected: readonly AuditUsedPartLine[],
  rows: readonly UsedPartRowSnapshot[]
): LegacyUsedPartMatch {
  const remaining = [...rows];
  const matched: { line: AuditUsedPartLine; row: UsedPartRowSnapshot; via: LegacyUsedPartMatchBasis }[] = [];
  const unmatched: LegacyUsedPartMismatch[] = [];

  for (const line of expected) {
    // 🔴 자리와 수량은 그대로 정확히 — 여기가 느슨해지면 남의 줄이 지워진다.
    const sameSlot = (row: UsedPartRowSnapshot) =>
      row.lineNo === line.lineNo && row.quantity === line.quantity;

    let index = remaining.findIndex((row) => sameSlot(row) && row.partNameText === line.partNameText);
    let via: LegacyUsedPartMatchBasis = "exact";

    if (index === -1) {
      // 🔴 사전이 모르면 `null` 이다(all-or-nothing) — 그때는 위에서 이미 원문으로
      //    견줬으므로 더 볼 것이 없다. 반쪽짜리 글자가 여기로 들어올 길은 없다.
      const translated = translateKyosanSentence(line.partNameText);
      if (translated !== null) {
        index = remaining.findIndex((row) => sameSlot(row) && row.partNameText === translated);
        if (index !== -1) via = "translated";
      }
    }

    if (index === -1) {
      unmatched.push({
        line,
        rowAtSameLineNo: rows.find((row) => row.lineNo === line.lineNo) ?? null,
      });
      continue;
    }
    matched.push({ line, row: remaining[index], via });
    remaining.splice(index, 1);
  }

  return { matched, unmatched };
}

// ─────────────────────────────────────────────── 옛 흔적의 첨부 고르기

export type AttachmentRowSnapshot = {
  id: string;
  category: string;
  /** 🔴 사람이 올린 파일은 여기가 `null` 일 수 있다 — 그것이 가르는 열쇠다. */
  description: string | null;
  originalFileName: string;
  checksumSha256: string;
  storedPath: string;
  previewPath: string | null;
  isDeleted: boolean;
};

export type LegacyAttachmentSelection = {
  sourceRows: readonly AttachmentRowSnapshot[];
  photoRows: readonly AttachmentRowSnapshot[];
};

/**
 * 🔴 옛 흔적의 첨부를 고른다 — **분류만으로 고르지 않는다.**
 *
 *  · 원본 — 분류 + `description` + `checksum_sha256` 이 흔적의 `sourceSha256` 과
 *    같은 것. 해시가 곧 「그 연락서인가」이므로 다른 연락서의 원본이 걸릴 수 없다.
 *  · 사진 — 분류 + `description` + 이름이 `연락서-<sha 앞 8자>-사진…` 인 것.
 *
 * 설명이 `null` 인 사람 업로드는 두 갈래 어디에도 들어오지 않는다(실측: 개발 DB
 * 에 그런 행이 1건 있다).
 */
export function selectLegacyKyosanAttachments(
  rows: readonly AttachmentRowSnapshot[],
  sourceSha256: string
): LegacyAttachmentSelection {
  const photoPrefix = kyosanPhotoNamePrefix(sourceSha256);
  const sourceRows: AttachmentRowSnapshot[] = [];
  const photoRows: AttachmentRowSnapshot[] = [];

  for (const row of rows) {
    if (row.category !== KYOSAN_ATTACHMENT_CATEGORY) continue;
    if (row.description === KYOSAN_SOURCE_ATTACHMENT_DESCRIPTION) {
      if (row.checksumSha256.trim().toLowerCase() === sourceSha256.trim().toLowerCase()) {
        sourceRows.push(row);
      }
      continue;
    }
    if (row.description === KYOSAN_PHOTO_ATTACHMENT_DESCRIPTION) {
      if (row.originalFileName.startsWith(photoPrefix)) photoRows.push(row);
    }
  }

  return { sourceRows, photoRows };
}

// ─────────────────────────────────────────────── 흔적 하나의 판정

export type SymptomAuditSnapshot = {
  /** 이식 **전**의 값 — 되돌릴 값이다(대개 `null`). */
  previousValue: string | null;
  /** 이식이 **넣은** 값. 지금 칸이 이것과 다르면 그 사이에 사람이 고친 것이다. */
  importedValue: string | null;
};

export type TraceRevertInput = {
  traceId: string;
  /** 🔴 `null` 이면 수리 건이 이미 지워진 **주인 없는 흔적**이다 — 건드리지 않는다. */
  repairCaseId: string | null;
  intakeNumber: string | null;
  metadata: unknown;
  /** 흔적이 말한 id 가운데 **그 건에 실제로 살아 있는** 작업 기록 id. */
  foundWorkRecordIds: readonly string[];
  /** 그 건의 사용 부품 **전부**(이식 것과 사람이 적은 것이 섞여 있다). */
  usedPartRows: readonly UsedPartRowSnapshot[];
  /** 그 건의 첨부 **전부**(사람이 올린 것이 섞여 있다). */
  attachmentRows: readonly AttachmentRowSnapshot[];
  /**
   * 옛 흔적의 사용 부품 스냅숏 — 이식이 그때 **새로 넣은 줄**만.
   * `null` 은 「못 찾았다」다(0건이었다면 빈 배열이다).
   */
  legacyUsedPartLines: readonly AuditUsedPartLine[] | null;
  /** 신고 증상 감사 스냅숏. 못 찾았으면 `null`. */
  symptomAudit: SymptomAuditSnapshot | null;
  /** 지금 칸에 들어 있는 값. */
  currentReportedSymptom: string | null;
};

export type QuarantineFileTarget = {
  attachmentId: string;
  storedPath: string;
  previewPath: string | null;
};

export type TraceRevertDecision =
  | {
      kind: "skip";
      traceId: string;
      repairCaseId: string | null;
      intakeNumber: string | null;
      /** 🔴 왜 건너뛰는가 — 사람이 읽고 판단할 문장들. */
      reasons: readonly string[];
      notes: readonly string[];
    }
  | {
      kind: "revert";
      traceId: string;
      repairCaseId: string;
      intakeNumber: string | null;
      sourceSha256: string;
      importBatchId: string | null;
      /** `id` = 새 흔적의 id 로 골랐다 · `legacy` = 옛 흔적을 단서로 맞췄다. */
      basis: "id" | "legacy";
      workRecordIds: readonly string[];
      usedPartIds: readonly string[];
      attachmentIds: readonly string[];
      /** 그 가운데 사진(원본 `.xlsm` 을 뺀 것) — 계획 출력이 나눠 보여 준다. */
      photoAttachmentIds: readonly string[];
      files: readonly QuarantineFileTarget[];
      /** 되돌릴 신고 증상. `null` 이면 칸을 건드리지 않는다. */
      reportedSymptom: { restoreTo: string | null; expectNow: string | null } | null;
      notes: readonly string[];
    };

/**
 * 🔴 흔적 하나를 되돌려도 되는가. **막는 쪽으로 기운 판정이다** — 조금이라도
 * 어긋나면 `skip` 을 돌려주고, 부르는 쪽은 그 흔적에 손대지 않는다.
 */
export function decideTraceRevert(input: TraceRevertInput): TraceRevertDecision {
  const reasons: string[] = [];
  const notes: string[] = [];
  const metadata = readKyosanTraceMetadata(input.metadata);

  const skip = (): TraceRevertDecision => ({
    kind: "skip",
    traceId: input.traceId,
    repairCaseId: input.repairCaseId,
    intakeNumber: input.intakeNumber,
    reasons,
    notes,
  });

  // ── 안전장치 6 — 주인 없는 흔적은 건드리지 않는다 ──
  if (input.repairCaseId === null) {
    reasons.push("주인 없는 흔적입니다(수리 건이 이미 지워졌습니다) — 대상에서 제외합니다.");
    return skip();
  }
  if (!metadata.isKyosanReportTrace) {
    reasons.push("연락서 이식 흔적이 아닙니다(metadata.source 가 KYOSAN_REPORT 가 아닙니다).");
    return skip();
  }
  if (metadata.sourceSha256 === null) {
    reasons.push("흔적에 원본 해시(sourceSha256)가 없습니다 — 무엇을 넣은 흔적인지 알 수 없습니다.");
    return skip();
  }
  if (metadata.legacyServiceReportId !== null) {
    notes.push(
      "🔴 이 옛 흔적은 서비스 보고서도 만들었습니다(serviceReportId). " +
        "되돌리기는 보고서를 한 줄도 건드리지 않습니다 — 사람이 따로 판단해야 합니다."
    );
  }

  // ── 1. 작업 기록 — id 가 정확하므로 「적게 찾은 것」은 위험이 아니다 ──
  const claimedWorkRecordIds = metadata.workRecordIds;
  const foundWorkRecordIds = new Set(input.foundWorkRecordIds);
  const workRecordIds = claimedWorkRecordIds.filter((id) => foundWorkRecordIds.has(id));
  if (workRecordIds.length !== claimedWorkRecordIds.length) {
    // 🔴 지울 것이 줄어들 뿐 남의 줄이 지워지지는 않는다 — 막지 않고 알린다.
    notes.push(
      `작업 기록 ${claimedWorkRecordIds.length}줄 가운데 ${workRecordIds.length}줄만 남아 있습니다 ` +
        "(나머지는 이미 사라졌습니다) — 남아 있는 것만 지웁니다."
    );
  }

  // ── 2. 사용 부품 ──
  let usedPartIds: readonly string[] = [];
  let basis: "id" | "legacy" = "legacy";

  if (metadata.usedPartCount === null) {
    reasons.push("흔적에 사용 부품 개수(usedPartCount)가 없습니다 — 무엇을 넣었는지 알 수 없습니다.");
    return skip();
  }

  if (metadata.usedPartIds !== null) {
    // ── 새 흔적: id 로 고른다 ──
    basis = "id";
    if (metadata.usedPartIds.length !== metadata.usedPartCount) {
      reasons.push(
        `흔적 안에서 사용 부품 개수가 어긋납니다 — usedPartCount ${metadata.usedPartCount} · ` +
          `usedPartIds ${metadata.usedPartIds.length}개.`
      );
      return skip();
    }
    const byId = new Map(input.usedPartRows.map((row) => [row.id, row]));
    const present = metadata.usedPartIds.filter((id) => byId.has(id));
    if (present.length !== metadata.usedPartCount) {
      reasons.push(
        `사용 부품 ${metadata.usedPartCount}줄을 찾아야 하는데 ${present.length}줄만 있습니다 — ` +
          "그 사이에 줄이 사라졌습니다."
      );
      return skip();
    }
    usedPartIds = present;
  } else if (metadata.usedPartCount === 0) {
    // 옛 흔적인데 넣은 줄이 0 이다 — 대조할 것이 없다.
    usedPartIds = [];
  } else {
    // ── 옛 흔적: 감사 스냅숏과 값으로 맞춘다 ──
    if (input.legacyUsedPartLines === null) {
      reasons.push(
        "옛 흔적인데 사용 부품 감사 스냅숏(audit_logs)을 하나로 못 찾았습니다 — " +
          `어느 ${metadata.usedPartCount}줄이 이식에서 왔는지 가릴 단서가 없습니다.`
      );
      return skip();
    }
    if (input.legacyUsedPartLines.length !== metadata.usedPartCount) {
      reasons.push(
        `감사 스냅숏이 말하는 줄 수(${input.legacyUsedPartLines.length})와 흔적의 ` +
          `usedPartCount(${metadata.usedPartCount})가 다릅니다.`
      );
      return skip();
    }
    const match = matchLegacyUsedPartRows(input.legacyUsedPartLines, input.usedPartRows);
    if (match.unmatched.length > 0) {
      // 🔴 안전장치 4 — 못 맞춘 줄이 있으면 **한 줄도 지우지 않는다.**
      reasons.push(
        `사용 부품 ${match.unmatched.length}줄을 (line_no · 품명 · 수량)으로 못 맞췄습니다 — ` +
          "한 줄도 지우지 않습니다."
      );
      for (const mismatch of match.unmatched) {
        reasons.push(
          `    #${mismatch.line.lineNo}  스냅숏: 「${mismatch.line.partNameText}」×${mismatch.line.quantity}` +
            `  ↔  지금: ${
              mismatch.rowAtSameLineNo === null
                ? "(그 자리에 줄이 없다)"
                : `「${mismatch.rowAtSameLineNo.partNameText}」×${mismatch.rowAtSameLineNo.quantity}`
            }`
        );
      }
      return skip();
    }
    // 🔴 무엇으로 맞췄는지 사람에게 알린다 — 「번역 대조」로 맞은 줄은 스냅숏의
    //    글자와 지금 값이 **눈으로는 다르다.** 계획을 읽는 사람이 그 사실을
    //    모르면 목록이 틀린 줄 안다(`formatRevertPlan` 이 `⚠` 로 찍는다).
    const translatedMatches = match.matched.filter((item) => item.via === "translated");
    if (translatedMatches.length > 0) {
      notes.push(
        `사용 부품 ${translatedMatches.length}줄은 **번역 대조**로 맞췄습니다 — 감사 스냅숏의 일본어를 ` +
          "이식기·백필과 같은 함수(translateKyosanSentence)로 옮긴 글자가 지금 값과 같습니다 " +
          "(2026-09-23 backfill-used-parts-korean.ts 가 한글로 바꿔 놓은 자리입니다)."
      );
      for (const item of translatedMatches) {
        notes.push(
          `    #${item.line.lineNo}  스냅숏: 「${item.line.partNameText}」×${item.line.quantity}` +
            `  →번역→  지금: 「${item.row.partNameText}」×${item.row.quantity}`
        );
      }
    }
    usedPartIds = match.matched.map((item) => item.row.id);
  }

  // ── 3. 첨부 ──
  if (metadata.attachmentCount === null) {
    reasons.push("흔적에 첨부 개수(attachmentCount)가 없습니다.");
    return skip();
  }
  if (metadata.photoCount === null) {
    reasons.push("흔적에 사진 개수(photoCount)가 없습니다.");
    return skip();
  }

  const attachmentById = new Map(input.attachmentRows.map((row) => [row.id, row]));
  let attachmentRows: readonly AttachmentRowSnapshot[];
  let photoIds: readonly string[];

  if (metadata.attachmentIds !== null) {
    // ── 새 흔적: id 로 고른다 ──
    if (metadata.attachmentIds.length !== metadata.attachmentCount) {
      reasons.push(
        `흔적 안에서 첨부 개수가 어긋납니다 — attachmentCount ${metadata.attachmentCount} · ` +
          `attachmentIds ${metadata.attachmentIds.length}개.`
      );
      return skip();
    }
    const present = metadata.attachmentIds.flatMap((id) => {
      const row = attachmentById.get(id);
      return row === undefined ? [] : [row];
    });
    if (present.length !== metadata.attachmentCount) {
      reasons.push(
        `첨부 ${metadata.attachmentCount}장을 찾아야 하는데 ${present.length}장만 있습니다 — ` +
          "그 사이에 행이 사라졌습니다."
      );
      return skip();
    }
    attachmentRows = present;
    photoIds = present
      .filter((row) => row.description === KYOSAN_PHOTO_ATTACHMENT_DESCRIPTION)
      .map((row) => row.id);
    if (photoIds.length !== metadata.photoCount) {
      // 🔴 여기서는 **막지 않는다.** id 로 골랐으므로 남의 행이 섞일 길이 없고,
      //    흔적의 `photoCount` 는 「미리보기가 센 사진 수」라 첨부로 받을 수 없는
      //    그림이 섞여 있으면 실제로 넣은 사진 수보다 클 수 있다(이식기의
      //    `placePhotos` 가 그런 장을 건너뛴다). 대신 반드시 알린다.
      notes.push(
        `흔적의 photoCount(${metadata.photoCount})와 실제 사진 첨부 수(${photoIds.length})가 다릅니다 ` +
          "— id 로 골랐으므로 지우는 것은 흔적이 말한 그 행들뿐입니다."
      );
    }
  } else {
    // ── 옛 흔적: 설명 + 해시 + 이름으로 고른다 ──
    const selected = selectLegacyKyosanAttachments(input.attachmentRows, metadata.sourceSha256);
    if (selected.sourceRows.length !== 1) {
      reasons.push(
        `원본 첨부를 1장 찾아야 하는데 ${selected.sourceRows.length}장을 찾았습니다 ` +
          "(설명 = '교산 연락서 원본' 이면서 체크섬이 흔적의 sourceSha256 과 같은 것)."
      );
      return skip();
    }
    if (selected.photoRows.length !== metadata.photoCount) {
      reasons.push(
        `사진 첨부를 ${metadata.photoCount}장 찾아야 하는데 ${selected.photoRows.length}장을 찾았습니다.`
      );
      return skip();
    }
    if (1 + metadata.photoCount !== metadata.attachmentCount) {
      reasons.push(
        `흔적 안에서 첨부 개수가 어긋납니다 — attachmentCount ${metadata.attachmentCount} · ` +
          `원본 1 + photoCount ${metadata.photoCount}.`
      );
      return skip();
    }
    attachmentRows = [...selected.sourceRows, ...selected.photoRows];
    photoIds = selected.photoRows.map((row) => row.id);
  }

  const trashed = attachmentRows.filter((row) => row.isDeleted);
  if (trashed.length > 0) {
    notes.push(`첨부 ${trashed.length}장은 이미 첨부 휴지통에 있습니다 — 함께 지우고 파일도 함께 옮깁니다.`);
  }

  // ── 4. 신고 증상 ──
  let reportedSymptom: { restoreTo: string | null; expectNow: string | null } | null = null;
  if (metadata.reportedSymptomFilled === null) {
    reasons.push(
      "흔적이 신고 증상을 채웠는지 말해 주지 않습니다(reportedSymptomFilled 칸이 없습니다) — " +
        "덮어썼는지 알 수 없어 되돌리지 않습니다."
    );
    return skip();
  }
  if (metadata.reportedSymptomFilled) {
    if (input.symptomAudit === null) {
      reasons.push(
        "신고 증상을 채운 흔적인데 그 감사 기록(audit_logs)을 하나로 못 찾았습니다 — " +
          "무슨 값으로 되돌릴지 알 수 없습니다."
      );
      return skip();
    }
    if (input.currentReportedSymptom !== input.symptomAudit.importedValue) {
      reasons.push(
        "신고 증상 칸이 이식이 넣은 값과 다릅니다 — 그 사이에 사람이 고쳤습니다. 덮어쓰지 않습니다."
      );
      return skip();
    }
    reportedSymptom = {
      restoreTo: input.symptomAudit.previousValue,
      expectNow: input.symptomAudit.importedValue,
    };
  }

  const attachmentIds = attachmentRows.map((row) => row.id);
  return {
    kind: "revert",
    traceId: input.traceId,
    repairCaseId: input.repairCaseId,
    intakeNumber: input.intakeNumber,
    sourceSha256: metadata.sourceSha256,
    importBatchId: metadata.importBatchId,
    basis,
    workRecordIds,
    usedPartIds,
    attachmentIds,
    photoAttachmentIds: photoIds,
    files: attachmentRows.map((row) => ({
      attachmentId: row.id,
      storedPath: row.storedPath,
      previewPath: row.previewPath,
    })),
    reportedSymptom,
    notes,
  };
}

/**
 * 계획을 다시 재었을 때 **같은 계획인가**. `--apply` 는 트랜잭션 안에서 한 번 더
 * 재고 이 글자를 견준다 — 계획을 찍은 순간과 지우는 순간 사이에 자료가 바뀌면
 * 아무것도 지우지 않는다.
 */
export function revertFingerprint(decision: TraceRevertDecision): string {
  if (decision.kind === "skip") return `skip:${decision.traceId}`;
  return [
    "revert",
    decision.traceId,
    decision.repairCaseId,
    decision.basis,
    [...decision.workRecordIds].sort().join(","),
    [...decision.usedPartIds].sort().join(","),
    [...decision.attachmentIds].sort().join(","),
    decision.reportedSymptom === null ? "symptom:keep" : `symptom:${decision.reportedSymptom.restoreTo ?? "<null>"}`,
  ].join("|");
}
