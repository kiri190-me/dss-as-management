import type { ServiceReportCause } from "@/lib/xlsx/service-report-template";

/**
 * ============================================================================
 * 연락서의 ○ 원인 → 우리 보고서의 원인 열 가지 (2026-09-21, 조각 S3b)
 * ============================================================================
 * 🔴 **타입만 가져온다.** `SERVICE_REPORT_CAUSES` 가 있는 모듈
 * (`xlsx/service-report-template.ts`)은 `node:fs` 를 끌고 온다. 이 파일은 DB 도
 * 파일도 모르는 순수 함수라야 시험이 붙으므로, 값이 아니라 타입만 들여온다 —
 * 아래 표를 `Record<ServiceReportCause, string | null>` 로 적었으므로 원인이
 * 하나 늘어나는 날 tsc 가 빠진 칸을 잡아 준다(값을 가져오는 것과 같은 보호다).
 *
 * ── 🔴 왜 그대로 옮겨지는가 ───────────────────────────────────────────
 * 교산 연락서의 `原　因` 보기 열 가지와 우리 보고서 양식의 원인 열 가지는
 * **같은 양식에서 나온 같은 목록**이다. 칸 자리(J·R·Z·AH·AP 두 줄)도 차례도
 * 같다:
 *
 *   製作不良 제작불량 · 部品不良 부품불량 · 経年劣化 노후화 · 輸送不良 운송불량 ·
 *   保管不良 보관불량 · 仕様不備 사양미비 · 検査ミス 검사 미스 ·
 *   取扱不備 취급불비 · 再現せず 재현 안됨 · その他 기타
 *
 * 그래서 이 사전은 「비슷한 말 찾기」가 아니라 **같은 칸끼리 이어 붙인 것**이다.
 *
 * ── 🔴 그래도 모르는 글자는 「기타」로 간다 (2026-09-21 사용자 결정 1) ──
 * 판본이 469장이고 양식이 조금씩 다르다. 보기 글자가 한 자라도 다르면
 * (`経年劣化` ↔ `劣化`, 판본이 늘린 보기 등) 이 사전에 없는 값이 들어온다.
 * 그때 **행을 만들지 않고 넘기면 원인이 통째로 사라진다** — 사람이 ○ 를 찍어
 * 둔 사실이 없던 일이 된다. 그래서 대응이 없으면 `OTHER`(기타) 로 넣고,
 * **원래 글자는 보고서 줄에 원문 그대로** 남는다
 * (`report-preview.ts` 의 `buildKyosanPreviewLines` 가 ○ 표시를 FINDINGS 줄로
 * 이미 옮긴다). 그러므로 이 사전이 틀려도 **잃는 것은 없고**, 원인 체크가
 * 「기타」로 뭉쳐질 뿐이다 — 틀리는 방향이 안전한 쪽이다.
 *
 * 🔴 일본어를 **번역하지 않는다.** 자유 기술(`詳細`·`不具合現象の詳細` …)은
 * 손대지 않고 원문 그대로 줄이 된다. 제대로 된 원인 사전은 S2 의 일이다.
 *
 * ── 견줌은 눌러서 ────────────────────────────────────────────────────
 * NFKC(전각/반각 · 탁점) + 공백 제거. `検査ミス` 와 `検査ﾐｽ`, `その 他` 가 같은
 * 값이 된다. 양식 글자는 판본마다 공백이 섞여 들어온다(우리 양식의 `노후화 `
 * 처럼).
 * ============================================================================
 */

/**
 * 우리 원인 → 그 원인이 연락서에서 갖는 보기 글자. `null` 은 「연락서 양식에
 * 같은 칸이 없다」는 뜻이다(지금은 하나도 없다 — 열 칸이 그대로 맞물린다).
 *
 * 🔴 판정에 쓰는 것은 아래 `CAUSE_BY_KEY` 하나뿐이고, 그것을 **이 표에서
 * 만든다.** 두 벌로 적으면 한쪽만 고쳐지는 날이 온다.
 */
const KYOSAN_MARK_BY_CAUSE: Readonly<Record<ServiceReportCause, string | null>> = {
  MANUFACTURING_DEFECT: "製作不良",
  PART_DEFECT: "部品不良",
  AGING: "経年劣化",
  TRANSPORT_DAMAGE: "輸送不良",
  STORAGE_DAMAGE: "保管不良",
  SPEC_SHORTFALL: "仕様不備",
  INSPECTION_MISS: "検査ミス",
  MISHANDLING: "取扱不備",
  NOT_REPRODUCED: "再現せず",
  OTHER: "その他",
};

/** 대응이 없을 때 넣는 값. 2026-09-21 사용자 결정 1. */
export const KYOSAN_FALLBACK_CAUSE: ServiceReportCause = "OTHER";

/** 견줌 열쇠 — NFKC · 공백 제거. `report-match.ts` 의 식별자 열쇠와 같은 눌림이다. */
export function kyosanCauseKey(value: string): string {
  return value.normalize("NFKC").replace(/\s+/g, "");
}

const CAUSE_BY_KEY: ReadonlyMap<string, ServiceReportCause> = new Map(
  Object.entries(KYOSAN_MARK_BY_CAUSE)
    .filter((entry): entry is [ServiceReportCause, string] => entry[1] !== null)
    .map(([cause, mark]) => [kyosanCauseKey(mark), cause])
);

export type KyosanCauseMapping = {
  /** 보고서에 체크할 원인들. 같은 값은 한 번만, 처음 나온 차례 그대로. */
  causes: readonly ServiceReportCause[];
  /**
   * 사전에 없어서 「기타」로 넣은 보기 글자들. 양식의 글자라 고객 정보가 아니고,
   * 사전을 고칠 사람에게는 글자가 필요하므로 그대로 돌려준다.
   */
  unmapped: readonly string[];
};

/**
 * ○ 가 찍힌 보기들을 우리 원인으로 옮긴다.
 *
 * 🔴 **○ 가 하나도 없으면 원인도 하나도 넣지 않는다.** 「기타」를 대신 넣지
 * 않는다 — 「아무것도 안 골랐다」와 「기타를 골랐다」는 다른 말이고, 뒤쪽은
 * 사람이 실제로 ○ 를 찍었을 때만 참이다.
 */
export function mapKyosanCauses(marked: readonly string[]): KyosanCauseMapping {
  const causes: ServiceReportCause[] = [];
  const unmapped: string[] = [];
  const seenCause = new Set<ServiceReportCause>();
  const seenUnmapped = new Set<string>();

  for (const mark of marked) {
    const key = kyosanCauseKey(mark);
    if (key === "") continue;

    const mapped = CAUSE_BY_KEY.get(key);
    if (mapped === undefined && !seenUnmapped.has(key)) {
      seenUnmapped.add(key);
      unmapped.push(mark);
    }

    const cause = mapped ?? KYOSAN_FALLBACK_CAUSE;
    if (seenCause.has(cause)) continue;
    seenCause.add(cause);
    causes.push(cause);
  }

  return { causes, unmapped };
}

/** 사전이 아는 보기 글자 전부. 시험이 열 칸이 다 물렸는지 못 박는 데 쓴다. */
export function knownKyosanCauseMarks(): readonly string[] {
  return [...CAUSE_BY_KEY.keys()];
}
