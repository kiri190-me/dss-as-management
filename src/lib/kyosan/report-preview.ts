import { CARD_FIELDS, CARD_LISTS, type CardFieldKey, type CardListKey } from "./card-fields";
import type { KyosanReport } from "./kyosan-report";
import type { KyosanMatch } from "./report-match";
import { splitKyosanPhotos } from "./report-photo-filter";

/**
 * ============================================================================
 * 연락서를 수리 건에 넣으면 **무엇이 들어가는가** — 미리보기 (2026-09-21, S3a)
 * ============================================================================
 * 🔴 이 조각은 **아무것도 저장하지 않는다.** 여기서 만드는 것은 「넣으면 이렇게
 * 된다」는 그림뿐이고, 실제로 넣는 일은 S3b 다. 그래서 이 모듈도 순수 함수다 —
 * DB 도 `server-only` 도 모른다.
 *
 * ── 🔴 짝이 하나가 아니면 넣을 것이 없다 ─────────────────────────────
 * 사용자 정책(2026-09-21)이 「이미 수리건이 등록된 경우에만 이식한다」이다.
 * 그러므로 `plan` 은 **짝이 하나로 정해졌을 때만** 값이 있고, 그 밖에는 언제나
 * `null` 이다. 「짝이 없는데 내용은 준비해 두었다」는 상태를 타입에서 없앴다 —
 * 그런 값이 있으면 다음 조각이 실수로 저장할 수 있다.
 *
 * ── 막는 것(blockers)과 알리는 것(warnings) ──────────────────────────
 * **막는 것** — 넣으면 안 되는 까닭이다. 하나라도 있으면 `plan` 이 `null` 이다.
 *   · 짝이 없다 / 짝이 여럿이다(사람이 골라야 한다)
 *   · 짝이 **휴지통**의 건이다
 *   · 🔴 **이미 넣은 연락서다** — 원본 파일 해시(`sourceSha256`)가 그 건에 이미
 *     있다. S1 실측에서 469장의 원본 해시가 전부 서로 달랐으므로, 같은 해시는
 *     「같은 파일을 두 번 넣는 것」이라는 뜻이 된다.
 *
 * **알리는 것** — 넣을 수는 있지만 사람이 알아야 하는 것이다.
 *   · 🔴 **신고 증상 칸에 이미 값이 있다** — 덮지 않고 작업 기록으로 보낸다
 *     (`report-detail-values.ts` 의 덮어쓰기 정책).
 *   · 모델 · S/N · L/N · 고객사가 수리 건과 다르다(`report-match.ts`)
 *   · 넣을 내용이 하나도 없다
 *
 * 🔴 문구에 **값을 담지 않는다**(항목 이름과 개수만). 이 글자가 그대로 화면과
 * 보고서에 실리는데, 거기에 고객 내용이 섞이면 걷어내기 어렵다.
 * ============================================================================
 */

/** `service_report_lines.section` 과 같은 이름이다(vendor/dss-core 의 스키마). */
export type KyosanPreviewSection = "FINDINGS" | "ACTIONS" | "SUMMARY" | "REMARK";

export type KyosanPreviewLine = {
  section: KyosanPreviewSection;
  /** 연락서에서 그대로 옮긴 글자. */
  text: string;
  /** 연락서의 어느 항목에서 왔는가(양식의 항목 이름). 화면이 근거를 보여 준다. */
  origin: string;
};

export type KyosanPreviewPart = {
  kind: "fault" | "preventive";
  text: string;
  /**
   * 🔴 `交換部品詳細` 시트의 `数量` 칸에서 읽은 수. **연락서에 수량이 적혀
   * 있을 때만** 값이 있다 — 없으면 이 열쇠가 아예 없고, 넣는 쪽이 1 로 본다
   * (`kyosan-report-import.ts` 의 `appendUsedParts`). Card 시트에만 있는 부품은
   * 수량 칸이 없는 자리라 언제나 열쇠가 없다.
   */
  quantity?: number;
};

/** 짝지은 수리 건이 지금 어떤 상태인가. 질의가 읽어서 넣어 준다. */
export type KyosanCaseState = {
  repairCaseId: string;
  /**
   * 지워지지 않은 보고서 수. 🔴 **이식은 보고서를 만들지 않는다**(2026-09-21
   * 사용자 결정) — 그래서 이 수는 더 이상 경고를 만들지 않고, 화면이 「이 건에는
   * 보고서가 이만큼 있다」는 사실을 곁들여 보여 주는 데만 쓴다.
   */
  serviceReportCount: number;
  /**
   * 🔴 `repair_cases.reported_symptom` 에 이미 사람이 적은 글자가 있는가.
   * 있으면 이식은 그 칸을 **덮지 않고** 고객 고장 상황을 작업 기록으로 보낸다
   * (`report-detail-values.ts`). 화면이 그 사실을 미리 말한다.
   */
  hasReportedSymptom: boolean;
  /** 이 건에 이미 들어간 연락서 원본 해시들. */
  importedSourceSha256: readonly string[];
};

export type KyosanImportPlan = {
  repairCaseId: string;
  intakeNumber: string;
  /** 보고서 줄로 들어갈 것들. 빈 줄은 만들지 않는다. */
  lines: readonly KyosanPreviewLine[];
  /** 교체 부품 — 고장분과 예방분. */
  parts: readonly KyosanPreviewPart[];
  /** 수리보고서 시트에서 ○ 가 찍힌 원인 보기들(양식의 글자). */
  causeMarks: readonly string[];
  /** ○ 가 찍힌 처치 보기들. */
  actionMarks: readonly string[];
  /** 🔴 양식 아이콘·도장을 걸러 낸 **실제 사진** 수(`report-photo-filter.ts`). */
  photoCount: number;
  /** 걸러 낸 양식 자산 수. 사람이 「왜 30장이 6장이 됐나」를 알 수 있게 함께 센다. */
  formAssetCount: number;
};

export type KyosanReportPreview = {
  sourceSha256: string;
  match: KyosanMatch;
  /** 🔴 짝이 하나이고 막는 것이 없을 때만 값이 있다. 그 밖에는 언제나 null. */
  plan: KyosanImportPlan | null;
  blockers: readonly string[];
  warnings: readonly string[];
};

const FIELD_CAPTION = new Map<string, string>(CARD_FIELDS.map((spec) => [spec.key, spec.caption]));
const LIST_CAPTION = new Map<string, string>(CARD_LISTS.map((spec) => [spec.key, spec.caption]));

/** 목록 항목 → 어느 구역으로 가는가. 차례가 곧 보고서에 적히는 차례다. */
const LIST_SECTIONS: readonly { key: CardListKey; section: KyosanPreviewSection }[] = [
  { key: "customerFaults", section: "FINDINGS" },
  { key: "internalFindings", section: "FINDINGS" },
  { key: "brokenPoints", section: "FINDINGS" },
];

/** 홑 항목 → 어느 구역으로 가는가. */
const FIELD_SECTIONS: readonly { key: CardFieldKey; section: KyosanPreviewSection }[] = [
  { key: "requirementDetail", section: "FINDINGS" },
  { key: "situationDetail", section: "FINDINGS" },
  { key: "causeDetail", section: "FINDINGS" },
  { key: "notes", section: "REMARK" },
];

function caption(map: Map<string, string>, key: string): string {
  return map.get(key) ?? key;
}

/**
 * ○ 가 찍힌 보기 줄의 `origin`. 🔴 **글자를 여기 한 벌만 둔다** — 어느 칸으로
 * 갈지를 정하는 `report-detail-values.ts` 가 이 값으로 줄을 가르기 때문에, 두
 * 벌로 적으면 한쪽만 고쳐지는 날 내용이 조용히 엉뚱한 칸으로 간다.
 */
export const KYOSAN_CAUSE_MARK_ORIGIN = "원인(○ 표시)";
export const KYOSAN_ACTION_MARK_ORIGIN = "처치(○ 표시)";

/** 연락서 한 장에서 보고서 줄을 뽑는다. 같은 구역 안에서 같은 글자는 한 번만. */
export function buildKyosanPreviewLines(report: KyosanReport): KyosanPreviewLine[] {
  const lines: KyosanPreviewLine[] = [];
  const seen = new Set<string>();

  const push = (section: KyosanPreviewSection, origin: string, text: string): void => {
    const trimmed = text.trim();
    if (trimmed === "") return;
    const key = `${section}\u0000${trimmed}`;
    if (seen.has(key)) return;
    seen.add(key);
    lines.push({ section, text: trimmed, origin });
  };

  for (const { key, section } of LIST_SECTIONS) {
    const origin = caption(LIST_CAPTION, key);
    for (const value of report.card.lists[key].values) push(section, origin, value);
  }
  for (const { key, section } of FIELD_SECTIONS) {
    const value = report.card.fields[key].value;
    if (value !== null) push(section, caption(FIELD_CAPTION, key), value);
  }
  for (const marked of report.cause.marked) push("FINDINGS", KYOSAN_CAUSE_MARK_ORIGIN, marked);
  for (const marked of report.action.marked) push("ACTIONS", KYOSAN_ACTION_MARK_ORIGIN, marked);

  return lines;
}

/**
 * 교체 부품 — 고장분 · 예방분. 같은 글자는 한 번만.
 *
 * ── 🔴 두 시트에서 모은다 ──────────────────────────────────────────────
 * 연락서 양식이 「주원인 부품만 Card 에 고르고 **나머지는 `交換部品詳細` 시트에**
 * 적으라」고 지시한다. 그래서 Card 시트만 읽으면 부품이 절반 이상 빠진다 —
 * 실측 472장에서 Card 쪽이 1,129건, 詳細 쪽이 1,128건이고, **45장은 Card 가
 * 텅 비었는데 詳細에만 부품이 있었다**(그 장들은 지금까지 부품이 하나도 안 들어갔다).
 *
 * ── 🔴 겹침을 어떻게 가리는가 ──────────────────────────────────────────
 * 두 시트에 **같은 부품을 둘 다 적는 일이 흔하다** — 실측 472장 중 281장이
 * 그렇고, 겹친 짝이 929건이다. 가리지 않으면 그만큼 두 번 들어간다.
 * 가리는 열쇠는 **부품 이름 글자 그대로**다(기존 규칙과 같다). `normalizeKey` 로
 * 눌러 견주어도 실측에서 **한 건도 더 잡히지 않아**(929 → 929) 기존 규칙을
 * 바꾸지 않았다.
 *
 * 차례는 **Card 시트가 먼저**다(지금까지 나온 차례를 흩지 않는다). 다만 같은
 * 이름이 詳細 시트에도 있으면 **수량만 그쪽에서 가져온다** — 수량 칸은 詳細
 * 시트에만 있기 때문이다. 詳細에만 있는 이름은 뒤에 이어 붙인다.
 */
export function buildKyosanPreviewParts(report: KyosanReport): KyosanPreviewPart[] {
  // 같은 이름이 詳細 시트에 여러 줄이면 **처음 줄**의 수량을 쓴다(뒤 줄은 겹침이다).
  const quantityByText = new Map<string, number>();
  for (const part of report.detailParts) {
    const text = part.name.trim();
    if (text === "" || part.quantity === null || quantityByText.has(text)) continue;
    quantityByText.set(text, part.quantity);
  }

  const parts: KyosanPreviewPart[] = [];
  const seen = new Set<string>();
  const push = (kind: KyosanPreviewPart["kind"], text: string): void => {
    if (text === "" || seen.has(text)) return;
    seen.add(text);
    const quantity = quantityByText.get(text);
    parts.push(quantity === undefined ? { kind, text } : { kind, text, quantity });
  };

  for (const [key, kind] of [
    ["faultParts", "fault"],
    ["preventiveParts", "preventive"],
  ] as const) {
    for (const value of report.card.lists[key].values) push(kind, value.trim());
  }
  for (const part of report.detailParts) push(part.kind, part.name.trim());

  return parts;
}

const UNMATCHED_BLOCKER: Readonly<Record<string, string>> = {
  "intake-number-missing":
    "짝이 없습니다 — 연락서에서 접수번호를 읽지 못했습니다. 넣지 않습니다(수리 건을 새로 만들지 않습니다).",
  "intake-number-malformed":
    "짝이 없습니다 — 접수번호가 번호 꼴(D + 연월 4자리 + 순번 2자리)이 아닙니다. 넣지 않습니다.",
  "intake-number-not-found":
    "짝이 없습니다 — 그 접수번호로 등록된 수리 건이 없습니다. 넣지 않습니다(수리 건을 새로 만들지 않습니다).",
};

/**
 * 연락서 한 장의 미리보기를 만든다.
 *
 * `caseState` 는 짝지은 건의 현재 상태다. 짝이 없으면 `null` 을 준다. 짝이
 * 있는데도 `null` 이면 「그 건의 상태를 못 읽었다」는 뜻이라 막는다 — 모르는 채로
 * 넣으면 중복 확인이 통째로 빠진다.
 */
export function buildKyosanReportPreview(
  report: KyosanReport,
  match: KyosanMatch,
  caseState: KyosanCaseState | null
): KyosanReportPreview {
  const blockers: string[] = [];
  const warnings: string[] = [];

  if (match.outcome.kind === "unmatched") {
    blockers.push(UNMATCHED_BLOCKER[match.outcome.reason] ?? "짝이 없습니다 — 넣지 않습니다.");
    return { sourceSha256: report.sourceSha256, match, plan: null, blockers, warnings };
  }

  if (match.outcome.kind === "ambiguous") {
    const count = match.outcome.candidates.length;
    blockers.push(
      match.outcome.reason === "identity-conflict"
        ? `접수번호로 찾은 수리 건과 모델도 S/N 도 다릅니다(후보 ${count}건) — 사람이 골라야 합니다.`
        : `접수번호로 짝을 못 정했습니다. S/N 으로 찾은 후보가 ${count}건 있습니다 — 사람이 골라야 합니다.`
    );
    return { sourceSha256: report.sourceSha256, match, plan: null, blockers, warnings };
  }

  const candidate = match.outcome.candidate;
  warnings.push(...match.outcome.warnings);

  if (candidate.isDeleted) {
    blockers.push("짝지은 수리 건이 휴지통에 있습니다 — 넣지 않습니다.");
  }
  if (caseState === null) {
    blockers.push("수리 건의 현재 상태를 읽지 못했습니다 — 중복을 확인할 수 없어 넣지 않습니다.");
  } else {
    if (caseState.importedSourceSha256.includes(report.sourceSha256)) {
      blockers.push("이미 넣은 연락서입니다(원본 파일이 같습니다) — 다시 넣지 않습니다.");
    }
    // 🔴 예전에는 「이 건에 보고서가 N장 있다 — 한 장이 더 쌓인다」를 알렸다.
    //    이식이 보고서를 만들지 않게 된 뒤로 그 문장은 **거짓말**이라 걷어냈다.
    //    대신 이 통로가 실제로 건드리는 단일 값 칸 하나를 알린다.
    if (caseState.hasReportedSymptom) {
      warnings.push(
        "이 수리 건의 신고 증상 칸에 이미 값이 있습니다 — 덮지 않고, 고객 고장 상황을 작업 기록으로 넣습니다."
      );
    }
  }

  const lines = buildKyosanPreviewLines(report);
  const parts = buildKyosanPreviewParts(report);
  const split = splitKyosanPhotos(report.photos);
  if (lines.length === 0 && parts.length === 0 && split.photos.length === 0) {
    warnings.push("이 연락서에서 넣을 내용을 하나도 뽑지 못했습니다.");
  }

  const plan: KyosanImportPlan | null =
    blockers.length > 0
      ? null
      : {
          repairCaseId: candidate.repairCaseId,
          intakeNumber: candidate.intakeNumber,
          lines,
          parts,
          causeMarks: [...report.cause.marked],
          actionMarks: [...report.action.marked],
          photoCount: split.photos.length,
          formAssetCount: split.formAssets.length,
        };

  return { sourceSha256: report.sourceSha256, match, plan, blockers, warnings };
}
