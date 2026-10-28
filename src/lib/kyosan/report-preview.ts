import { CARD_FIELDS, CARD_LISTS, type CardFieldKey, type CardListKey } from "./card-fields";
import type { KyosanEstimatedRepairBlock } from "./estimated-repair-block";
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

/**
 * 🔴 **곁 칸을 더하지 않았다** (2026-10-28). `交換部品詳細` 시트가 이제
 * `model`(`型式`) · `partName`(`部品名`) · `spec`(`仕様書番号`)을 날것으로 실어
 * 오지만(`KyosanDetailPart`), 그 가운데 **이름으로 고른 글자 하나만** 여기로
 * 넘어온다. 까닭 셋:
 *
 *  1. 이 타입의 줄은 `mergeKyosanPartsForUsedParts` 가 **표기를 눌러 묶는다.**
 *     두 줄이 한 줄로 합쳐질 때 곁 칸 가운데 어느 쪽을 남길지가 정해져 있지
 *     않다 — 재지도, 사용자에게 묻지도 않은 결정이라 지어내지 않는다.
 *  2. 장의 **76%** 는 부품 이름이 이 시트가 아니라 `推定修理内容` 블록에서
 *     온다(실측 278장 대 85장, `buildKyosanPreviewParts`). 그쪽에는 `型式` 도
 *     `部品名` 도 **없다.** 곁 칸을 열쇠로 더해도 네 줄 가운데 한 줄만 차는
 *     값이라 화면이 그것을 믿을 수 없다.
 *  3. 받는 표(`repair_case_used_parts`)에 그 칸이 없다. 곁 칸을 여기까지
 *     흘려보내면 넣는 쪽이 **버리는 코드**를 한 벌 더 갖게 된다.
 *
 * 되짚을 길은 `KyosanDetailPart` 에 날것으로 남아 있다 — 「이름이 이상하다」는
 * 신고는 판독기까지 내려가서 보면 된다.
 */
export type KyosanPreviewPart = {
  kind: "fault" | "preventive";
  /** 🔴 `交換部品詳細` 에서 온 줄이면 **`型式` 칸 글자**다(2026-10-28). */
  text: string;
  /**
   * 🔴 `交換部品詳細` 시트의 `数量` 칸에서 읽은 수. **연락서에 수량이 적혀
   * 있을 때만** 값이 있다 — 없으면 이 열쇠가 아예 없고, 넣는 쪽이 1 로 본다
   * (`kyosan-report-import.ts` 의 `replaceUsedParts`). Card 시트에만 있는 부품은
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

/**
 * 🔴 **O/H 로 「권한다」고 적은 줄**의 `origin`. 이 줄들은 **부품 줄로 넣지
 * 않는다** — 사용자에게 「O/H 로 권한 부품이 실제로 교체됐습니까」를 물었고 답이
 * **「건마다 다르다」**였다(2026-09-22). 그러니 수량에 넣으면 청구 금액이
 * 부풀고, 버리면 연락서가 무엇을 권했는지가 사라진다. 그래서 **원문을 작업
 * 이력에 남긴다** — 「처치 ○」를 `WORK_RECORD_GENERAL` 로 보낸 통로 그대로다
 * (`report-detail-values.ts`).
 *
 * 근거: 두 출처는 이름이 83% 짝지을 수 없는데도(앞 조사) O/H 권유만 빼면 수량
 * 합이 **2,874 ↔ 추정수리내용을 안 쓰던 때의 2,990** 으로 맞아떨어진다.
 * ⚠️ 「권한다」를 **전부** 빼면 과잉이다 — 앞 조사 실측으로 양쪽에 다 있는
 * 274장 중 173장은 권유형인데도 수량이 실제 기록과 같았다.
 */
export const KYOSAN_OVERHAUL_RECOMMENDATION_ORIGIN = "추정 수리 내용(O/H 권유)";

/**
 * 교체 부품 줄의 겹침 열쇠 — 🔴 **갈래가 들어간다.** 같은 부품이 고장분에도
 * 예방분에도 있으면 두 줄로 남아야 하고, 수량도 갈래별로 짝지어야 한다
 * (`buildKyosanPreviewParts` 의 머리말). `\u0000` 은 부품 이름에 나올 수 없는
 * 글자라 갈래와 이름이 섞이지 않는다.
 */
function partKey(kind: KyosanPreviewPart["kind"], text: string): string {
  return `${kind}\u0000${text}`;
}

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
  // 🔴 O/H 권유는 **부품 줄이 아니라 작업 이력**으로 간다(위 origin 머리말).
  for (const text of report.estimatedRepair?.overhaulRecommendations ?? []) {
    push("ACTIONS", KYOSAN_OVERHAUL_RECOMMENDATION_ORIGIN, text);
  }

  return lines;
}

/**
 * 교체 부품 — 고장분 · 예방분. **같은 갈래 안에서** 같은 글자는 한 번만.
 *
 * ── 🔴 두 시트에서 모은다 ──────────────────────────────────────────────
 * 연락서 양식이 「주원인 부품만 Card 에 고르고 **나머지는 `交換部品詳細` 시트에**
 * 적으라」고 지시한다. 그래서 Card 시트만 읽으면 부품이 절반 이상 빠진다 —
 * 실측 472장에서 Card 쪽이 1,129건, 詳細 쪽이 1,128건이고, **45장은 Card 가
 * 텅 비었는데 詳細에만 부품이 있었다**(그 장들은 지금까지 부품이 하나도 안 들어갔다).
 *
 * ── 🔴 겹침 열쇠에 **갈래**가 들어간다 (2026-09-22) ────────────────────
 * 두 시트에 **같은 부품을 둘 다 적는 일이 흔하다** — 실측 472장 중 281장이
 * 그렇고 겹친 짝이 929건이다. 가리지 않으면 그만큼 두 번 들어간다. 그래서
 * 겹침을 가리는 것 자체는 그대로 둔다. 문제는 **무엇을 겹침으로 볼 것인가**였다.
 *
 * 열쇠가 부품 이름뿐이던 동안, **같은 부품이 고장분에도 예방분에도 정당하게
 * 적힌 장**에서 먼저 넣은 갈래가 자리를 차지해 나머지 갈래가 통째로 사라졌다.
 * 사용자가 화면에서 그것을 짚었다(`kyosan-xlsm/0357.xlsm` — 고장 3枚 · 예방 7枚
 * 인 부품 셋이 고장분으로만 남고 예방분 세 줄이 없어졌다).
 *
 * 🔴 실측(2026-09-22, 연락서 469장): 같은 이름이 고장·예방 양쪽에 있는 장이
 * **84장**, 그렇게 삼켜진 줄이 **164줄**이다(`交換無し` 를 뺀 실물 부품만 센 수).
 * 그래서 열쇠를 `갈래 + 이름` 으로 바꾼다 — **같은 글자가 양쪽에 있으면 두 줄로
 * 남는다.**
 *
 * ⚠️ **같은 갈래 안의 겹침은 그대로 한 번만** 넣는다(실측 예: `終段AMPゲート基板`
 * 이 `予防③`·`予防⑩` 두 줄). 화면이 `` `${kind}-${text}` `` 를 React key 로 쓰므로
 * (`KyosanReportImportParts.tsx`) 같은 갈래에서 두 줄을 내면 열쇠가 부딪친다.
 *
 * 🔴 **그런데 수량은 더한다** (2026-10-29). 2026-09-22 부터 이 자리는 묶이는 줄의
 * **처음 줄 수량만** 쓰고 나머지를 버렸다. **그 규칙의 근거는 한 번도 적힌 적이
 * 없다** — 위 문단이 대는 까닭은 「줄을 하나로 묶는다」(React 열쇠)뿐이고,
 * 수량까지 버려야 할 까닭은 아니었다. `予防③` 과 `予防⑩` 은 **두 번의 서로 다른
 * 교체**라 적힌 수를 둘 다 세어야 한다. 바로 아래 「추정수리내용 쪽은 같은 이름의
 * 수량을 더한다」 절이 같은 말을 이미 하고 있었고, 두 경로가 서로 다른 규칙으로
 * 돌고 있었다.
 *
 * 🔵 이름이 **품번**이 된 뒤로 이 자리는 더 분명해졌다 — 같은 갈래에 같은 품번이
 * 두 줄이면 **정말로 같은 부품 두 줄**이다. (설명 글자로 묶던 때에는 이름이 같아도
 * 다른 부품일 수 있었고, 2026-10-29 운영 실측에서 그 꼴이 실제로 터졌다:
 * `部品名` 이 같고 품번이 다른 별개 부품 둘이 한 줄로 뭉개져 수량이 2 대신 1 이
 * 됐다. 그쪽은 `parts-detail-sheet.ts` 의 차례를 고쳐 애초에 안 묶이게 했다.)
 *
 * ⚠️ 그래서 이 파일 아래에 적힌 **실측 수량 합계(2,874)는 옛 규칙에서 센 수**다.
 * 버려지던 수량이 살아나므로 지금 코드로 다시 재면 그보다 크다 — 다시 재지
 * 못했다(연락서 원본이 저장소에 없다). 🔴 그 수를 「지금 이렇다」로 읽지 마라.
 *
 * 열쇠 글자는 **이름 글자 그대로**다. `normalizeKey` 로 눌러 견주어도 실측에서
 * 한 건도 더 잡히지 않아 기존 규칙을 바꾸지 않았다.
 *
 * ── 🔴 수량도 갈래별로 짝짓는다 ────────────────────────────────────────
 * 수량 칸은 `交換部品詳細` 시트에만 있고, 그 시트는 `措置` 칸(`故障①`/`予防④`)으로
 * 갈래를 알려 준다(`parts-detail-sheet.ts` 의 `toPartKind`). 열쇠가 이름뿐이던
 * 동안에는 **첫 줄의 수량**이 갈래와 상관없이 쓰여, 고장 3개짜리 줄의 수량이
 * 예방 7개짜리 줄에 붙거나 그 반대가 됐다. 이제 수량 지도도 `갈래 + 이름` 으로
 * 열쇠를 잡는다 — 갈래가 같은 줄의 수량만 붙는다.
 *
 * 차례는 **Card 시트가 먼저**다(지금까지 나온 차례를 흩지 않는다). 다만 같은
 * 갈래·같은 이름이 詳細 시트에도 있으면 **수량만 그쪽에서 가져온다**. 詳細에만
 * 있는 (갈래, 이름)은 뒤에 이어 붙인다.
 *
 * ── 🔴 세 번째 출처 · **장 단위로 갈아탄다** (2026-09-22) ─────────────
 * 위의 두 출처는 이름이 **부품 대장에서 고른 것**이다. 사용자가 화면을 보고
 * 두 번 짚었다 — 「`終段AMPデバイス基板` 이라고 적혀 있어야 해」. 사람이 손으로
 * 적은 이름은 `推定修理内容` 블록에만 있다(`estimated-repair-block.ts`).
 *
 * 🔴 **한 장에서 두 출처를 섞지 않는다.** 이름 계통이 달라서
 * (`終段AMP基板（AMP-DEH基板）` 대 `終段AMPデバイス基板`) 한 목록에 섞이면 같은
 * 물건이 두 줄로 보이고 수량도 두 번 들어간다. 그래서 **장 단위로 고른다**:
 *
 *   `推定修理内容` 이 **부품 줄을 냈으면** → 추정수리내용만 쓴다 (실측 278장)
 *   내지 못했으면                       → Card + `交換部品詳細` 를 그대로 (85장)
 *
 * 🔴 「냈으면」은 **O/H 권유를 뺀 뒤**를 뜻한다. 지시서의 글은 「O/H 권유만
 * 적힌 장은 빈 장으로 떨어진다」였는데, 그러면 그 19장에서 `交換部品詳細` 에
 * 적혀 있는 부품이 **통째로 사라진다**(그중 16장에 부품이 있다). 실측 기대값
 * 「부품 0건 장 106」도 되돌리는 쪽에서만 맞는다 — 떨어뜨리면 122장이 된다.
 * 그래서 **되돌린다**.
 *
 * ⚠️ 되돌린 장에서는 사용 부품 칸이 대장 이름이고 작업 이력의 O/H 권유 원문은
 * 손글씨 이름이다. **부품 목록 안에서는 계통이 섞이지 않으므로** 괜찮다 —
 * 섞이면 안 되는 것은 한 목록 안의 이름들이다.
 *
 * ⚠️ 그래서 `交換部品詳細`·Card 판독은 **지우지 않는다** — 추정수리내용이 부품을
 * 내지 못한 장에서 계속 쓰인다.
 *
 * ── 🔴 추정수리내용 쪽은 **같은 이름의 수량을 더한다** ────────────────
 * 두 출처를 섞던 겹침 규칙(먼저 나온 줄의 수량만 쓴다)을 여기 그대로 쓰면 안
 * 된다. 저쪽의 겹침은 **같은 사실을 두 시트에 두 번 적은 것**이지만, 추정수리
 * 내용의 두 줄은 **서로 다른 두 번의 기술**이다(`…3枚(右側内4，5)` 과
 * `…1枚(左側外1)`). 먼저 나온 줄만 남기면 뒤 줄의 수량이 사라진다. 그래서
 * 같은 갈래·같은 이름이면 **수량을 더한다** — 화면 React 열쇠
 * (`${kind}-${text}`)도 그대로 하나만 남는다.
 *
 * ── 🔴 **이기는 쪽이 뒤집혔다** (2026-10-28) ──────────────────────────
 * 바로 위 절이 2026-09-22 부터 이렇게 적고 있었다 — **인용해 남긴다**:
 *
 *     「`推定修理内容` 이 **부품 줄을 냈으면** → 추정수리내용만 쓴다 (실측 278장)
 *       내지 못했으면 → Card + `交換部品詳細` 를 그대로 (85장)」
 *
 * 🔵 사용자가 **실물 연락서 두 장을 열어 보여 주었다.** 재고관리 시스템의
 * 부품명과 같은 글자(**품번**)는 `交換部品詳細` 시트에만 있다 — `型式` 또는
 * `仕様書番号` 칸이고, 어느 쪽이 차는지는 장마다 다르다
 * (`parts-detail-sheet.ts` 의 머리말 「이름은 품번 칸에서 온다」).
 * `推定修理内容` 은 사람이 손으로 적은 **설명**이라 품번이 아니다. 그런데 위
 * 차례 때문에 **보여 준 두 장 다 품번이 멀쩡히 있는데도 손글씨 이름을 쓰고
 * 있었다.**
 *
 * 🔴 그래서 **차례만** 뒤집는다(사용자 결정 2026-10-28):
 *
 *   `交換部品詳細` 가 **부품 줄을 냈으면** → Card + `交換部品詳細`(지금까지의 길)
 *   내지 못했으면                        → `推定修理内容`(그 길은 그대로 산다)
 *   둘 다 못 내면                        → Card 만(바뀌지 않는다)
 *
 * ⚠️ **「한 장에서 두 출처를 섞지 않는다」는 그대로다.** 바뀐 것은 **어느 쪽이
 * 이기는가** 하나뿐이고, 섞지 않는 규칙도 `推定修理内容` 판독기도 Card 시트
 * 경로도 O/H 권유 빼기도 전부 산다.
 *
 * ⚠️ 위의 **278장 대 85장은 옛 차례에서 센 수**다. 새 차례에서는 `交換部品詳細`
 * 가 부품을 낸 장이 먼저 가져가므로 두 수가 뒤바뀐다 — 다시 재지 않았다(연락서
 * 원본이 저장소에 없다). 🔴 그 수를 「지금 이렇다」로 읽지 마라.
 *
 * ── 🔴 **Card 는 그 장에서 빠진다** (2026-10-28, 같은 날 두 번째 고침) ──
 * 위 뒤집기를 넣은 날, 이 자리에 **경고만 적고 고치지 않은 줄**이 있었다 —
 * **인용해 남긴다**:
 *
 *     「⚠️ 🔴 **Card 시트의 이름은 품번이 아니다.** 되살아난 이 길에서
 *       `legacyPreviewParts` 는 Card 의 **대장 이름**과 `交換部品詳細` 의
 *       **품번**을 한 목록에 담는다 — 한 장 안에 이름 계통이 둘이 된다.」
 *
 * 🔵 그 경고가 **그날 바로 실물에서 터졌다.** 사용자가 연락서를 넣고 [사용 부품]을
 * 열었더니 `交換部品詳細` 에 부품이 **2줄**인데 **4건**이 들어가 있었다:
 *
 *     (설명 A 의 한글 번역)  1   ← Card 쪽에서 온 일본어 이름이 한글로 번역된 것
 *     (설명 B 의 한글 번역)  1      (`report-terms.ts` 의 「사용 부품 칸은 예외다」)
 *     (품번 A)              1   ← `交換部品詳細` 의 `型式`
 *     (품번 B)              1
 *
 * 🔴 사용자 결정: **「`型式`(품번)만 나오는 것이 맞다.」** 그래서 `交換部品詳細` 가
 * 부품 줄을 낸 장에서는 **그 줄만** 담는다(`"detail-only"`).
 *
 * 🔴 **Card 시트를 걷어낸 것이 아니다.** `交換部品詳細` 도 `推定修理内容` 도 부품을
 * 못 내는 장에서는 Card 가 **여전히 유일한 출처**이고 그 길은 그대로 산다. 바뀐
 * 것은 **둘이 함께 담기던 한 갈래**뿐이다 — 그 갈래만 이 파일이 스스로 적어 둔
 * 「한 장에서 두 출처를 섞지 않는다」를 어기고 있었다. 고쳐서 규칙과 코드가 다시
 * 맞는다.
 *
 * ⚠️ 🔴 **잃는 것이 있다 — 몰래 넘어가지 않게 적어 둔다.** `交換部品詳細` 가 부품을
 * 낸 장에서 **Card 에만 있고 詳細에는 없는 부품**은 이제 들어가지 않는다. 사용자가
 * 「품번만」을 골랐으므로 **받아들인 손해**다. 🔴 그런 부품이 몇 건인지는 **재지
 * 못했다**(연락서 원본이 저장소에 없다). 기록으로 남은 이웃 수치는 「Card 쪽
 * 1,129건 · 詳細 쪽 1,128건 · Card 가 텅 비고 詳細에만 있던 장 45장」뿐이고,
 * **그 수는 이 손해를 말해 주지 않는다.**
 */
export function buildKyosanPreviewParts(report: KyosanReport): KyosanPreviewPart[] {
  // 🔴 `交換部品詳細` 가 부품 줄을 냈으면 **그 줄만** 쓴다(위 머리말). 품번이
  //    거기에만 있고, Card 의 일본어 이름을 함께 담으면 같은 물건이 두 번 들어간다.
  if (hasDetailPartLine(report)) return legacyPreviewParts(report, "detail-only");
  const estimated = report.estimatedRepair;
  if (estimated !== null) {
    const parts = estimatedPreviewParts(estimated);
    if (parts.length > 0) return parts;
  }
  // 🔴 둘 다 못 낸 장 — 여기서는 Card 가 **유일한 출처**다. 그 길은 그대로 산다.
  return legacyPreviewParts(report, "card-and-detail");
}

/**
 * `交換部品詳細` 시트가 **부품 줄을 냈는가.**
 *
 * 🔴 `legacyPreviewParts` 가 빈 이름을 버리므로 여기서도 **같은 잣대**로 센다 —
 * 두 곳이 다른 잣대를 쓰면 「`交換部品詳細` 가 이겼는데 그 줄이 하나도 없다」는
 * 장이 생기고, 그 장은 `推定修理内容` 에 적힌 부품을 통째로 잃는다.
 */
function hasDetailPartLine(report: KyosanReport): boolean {
  return report.detailParts.some((part) => part.name.trim() !== "");
}

/**
 * `推定修理内容` 블록의 부품 줄 → 미리보기 줄. 같은 갈래·같은 이름은 한 줄로
 * 묶고 **수량을 더한다**(위 머리말). 수량이 한 줄도 안 적혀 있으면 열쇠 자체를
 * 두지 않는다 — 넣는 쪽이 1로 센다(`kyosan-report-import.ts`).
 */
function estimatedPreviewParts(block: KyosanEstimatedRepairBlock): KyosanPreviewPart[] {
  const parts: KyosanPreviewPart[] = [];
  const byKey = new Map<string, KyosanPreviewPart>();
  for (const part of block.parts) {
    const text = part.name.trim();
    if (text === "") continue;
    const key = partKey(part.kind, text);
    const found = byKey.get(key);
    if (found === undefined) {
      const fresh: KyosanPreviewPart =
        part.quantity === null
          ? { kind: part.kind, text }
          : { kind: part.kind, text, quantity: part.quantity };
      byKey.set(key, fresh);
      parts.push(fresh);
      continue;
    }
    // 🔴 수량을 더한다. 안 적힌 줄은 1로 센다 — 넣는 쪽의 `?? 1` 과 같은 규칙이다.
    found.quantity = (found.quantity ?? 1) + (part.quantity ?? 1);
  }
  return parts;
}

/**
 * 이 장에서 **어느 출처를 담는가**. 🔴 이름 계통이 섞이지 않게 **장마다 하나만**
 * 고른다(`buildKyosanPreviewParts` 의 머리말 「한 장에서 두 출처를 섞지 않는다」).
 *
 *   `"detail-only"`     — `交換部品詳細` 의 **품번만**. 그 시트가 부품을 낸 장.
 *   `"card-and-detail"` — Card 시트의 대장 이름까지. 🔴 `交換部品詳細` 도
 *                         `推定修理内容` 도 부품을 못 낸 장에서만 쓴다. 그 장에서는
 *                         Card 가 **유일한 출처**이고, `detailParts` 는 어차피 비어
 *                         있으므로 섞일 것이 없다.
 */
type KyosanLegacyPartSources = "detail-only" | "card-and-detail";

/** Card 시트 + `交換部品詳細` — 고른 출처만 담는다(위 `KyosanLegacyPartSources`). */
function legacyPreviewParts(
  report: KyosanReport,
  sources: KyosanLegacyPartSources
): KyosanPreviewPart[] {
  // 🔴 같은 갈래·같은 이름이 詳細 시트에 여러 줄이면 **한 줄로 묶되 수량을 더한다**
  //    (2026-10-29 — 위 머리말 「같은 갈래 안의 겹침」 절). 줄을 하나로 묶는 것은
  //    그대로이고, 바뀐 것은 **뒤 줄의 수량을 버리지 않는다**는 것 하나다.
  // 🔵 `undefined` 는 「그 줄들에 수량이 한 번도 안 적혔다」는 뜻이고, 그때는 열쇠
  //    자체를 비워 둔다 — 넣는 쪽이 1 로 센다(`kyosan-report-import.ts` 의 `?? 1`).
  //    `has` 로 보아야 한다: `get` 은 「없다」와 「비었다」를 못 가른다.
  const quantityByKindAndText = new Map<string, number | undefined>();
  for (const part of report.detailParts) {
    const text = part.name.trim();
    if (text === "") continue;
    const key = partKey(part.kind, text);
    if (!quantityByKindAndText.has(key)) {
      quantityByKindAndText.set(key, part.quantity ?? undefined);
      continue;
    }
    // 🔴 안 적힌 줄은 1 로 세어 더한다 — `estimatedPreviewParts` 와 같은 규칙이다.
    quantityByKindAndText.set(
      key,
      (quantityByKindAndText.get(key) ?? 1) + (part.quantity ?? 1)
    );
  }

  const parts: KyosanPreviewPart[] = [];
  const seen = new Set<string>();
  const push = (kind: KyosanPreviewPart["kind"], text: string): void => {
    if (text === "") return;
    const key = partKey(kind, text);
    if (seen.has(key)) return;
    seen.add(key);
    const quantity = quantityByKindAndText.get(key);
    parts.push(quantity === undefined ? { kind, text } : { kind, text, quantity });
  };

  // 🔴 Card 시트의 이름은 **품번이 아니다**(교산 부품 대장에서 드롭다운으로 고른
  //    일본어 이름이다). `交換部品詳細` 가 품번을 낸 장에서는 담지 않는다 — 담으면
  //    같은 물건이 품번 한 줄과 일본어 한 줄로 **두 번** 들어간다(위 머리말).
  if (sources === "card-and-detail") {
    for (const [key, kind] of [
      ["faultParts", "fault"],
      ["preventiveParts", "preventive"],
    ] as const) {
      for (const value of report.card.lists[key].values) push(kind, value.trim());
    }
  }
  for (const part of report.detailParts) push(part.kind, part.name.trim());

  return parts;
}

/**
 * 사용 부품 칸에 들어갈 한 줄. `repair_case_used_parts` 의 세 칸 중 이식이 정하는
 * 둘뿐이다 — `part_id` 는 언제나 `null` 이고(부품 대장과 이어 붙이지 않는다),
 * `line_no` 는 있는 줄 뒤에 이어 붙이는 쪽이 매긴다.
 *
 * 🔴 **갈래(`kind`)가 없다.** 없는 것이 이 타입의 요점이다 — 아래 머리말.
 */
export type KyosanUsedPartLine = {
  text: string;
  /** 🔴 언제나 값이 있다. 수량이 안 적힌 줄은 **1로 세어** 더했다. */
  quantity: number;
};

/**
 * 「교체 부품」 줄들을 **사용 부품 칸에 넣을 줄**로 묶는다 (2026-09-22).
 *
 * ── 🔴 자리마다 담는 모양이 다르다 ─────────────────────────────────────
 * 사용자가 화면을 보고 정했다: 「교체 부품이 고장분과 예방분이 잘 나눠졌는데
 * **사용부품 칸에 내용을 넣을 때는 그 구분 없이 부품명대로 수량을 넣어 줘.**」
 *
 *   「교체 부품」 미리보기 · 작업 기록 메모 → **갈래별로 그대로**(두 줄)
 *   🔴 `repair_case_used_parts`            → **이름으로 묶고 수량을 더한다**(한 줄)
 *
 * 그래서 이 함수는 `buildKyosanPreviewParts` 가 갈라 놓은 것을 **되돌리지
 * 않는다.** 갈라 놓은 목록은 그대로 두고, 그것을 원본으로 삼아 **사용 부품 칸
 * 몫만** 따로 만든다. 두 규칙이 한 파일에 나란히 있어야 어느 날 겹침 열쇠를
 * 고치는 사람이 **양쪽을 함께** 보게 된다 — 그래서 여기 둔다.
 *
 * ── 🔴 열쇠는 **눌러 묶는다** (2026-09-22, 사용자 승인) ─────────────────
 * 손으로 적은 이름은 같은 물건이 표기만 달라지는 일이 흔하다. 그래서 열쇠로
 * `NFKC` + **공백 제거** + **장음류 제거**(`ー` `―` `‐` `−` `-`)한 값을 쓴다.
 * 붙는 묶음은 실측 전수 **11개**이고, **서로 다른 부품이 잘못 붙는 경우는 0건**이다:
 *   `終段AMPコンデンサ基板`/`終段AMPコンデンサー基板`/`終段AMPｺﾝﾃﾞﾝｻ基板` ·
 *   `終段AMPゲート基板`/`終段AMPｹﾞｰﾄ基板` · `スプリッタ基板`/`スプリッター基板`/
 *   `スプリッタ―基板` · `真空コンデンサ(フィルターボックス内)`/`内）` ·
 *   `オーバホール部品(一式)`/`オーバーホール部品（一式）` ·
 *   `RF コントロール パネル`/`RFコントロールパネル` · `出力バー（B）`/`出力バー(B)` 등.
 *
 * 🔴 **보이는 이름은 그 묶음에서 가장 많이 쓰인 표기**다(열쇠는 누른 값, 표시는
 * 원형). 누른 값을 그대로 보여 주면 `RFコントロルパネル` 처럼 **연락서에 없는
 * 글자**가 사용 부품 칸에 적힌다.
 *
 * ⚠️ 이 눌림으로 실제로 줄어드는 것은 **1줄뿐**이다 — 변이가 **한 장 안에서**
 * 만나야 줄어들고, 실측 469장에서 그런 짝은 `スプリッタ―基板`/`スプリッター基板`
 * 하나뿐이었다. 그래도 넣는다 — 앞으로 들어올 연락서에서 같은 물건이 갈라지지
 * 않게.
 *
 * ── 차례 · 수량 ────────────────────────────────────────────────────────
 * · **차례는 먼저 나온 자리를 지킨다.** 고장분이 앞에 오므로 「교체 부품」에
 *   보이는 차례와 같은 차례가 되고, 예방분에만 있는 부품이 그 뒤에 붙는다.
 *   `Map` 이 넣은 차례를 지키므로 따로 정렬하지 않는다.
 * · **수량을 더한다. 수량이 안 적힌 줄은 1** 이다 — 넣는 쪽이 `?? 1` 로 그렇게
 *   다뤄 왔고(`kyosan-report-import.ts` 의 `replaceUsedParts`), 그 규칙을 여기로
 *   옮겨만 왔다. 🔴 **그러므로 수량 합계가 달라지지 않는다** — 줄 수만 줄어든다.
 *
 * 🔴 곁 값을 고를 일이 없다. 미리보기 줄이 가진 것은 `kind` · `text` ·
 * `quantity` 뿐이고, `交換部品詳細` 시트의 곁 칸들은 미리보기가 이미 버린다
 * (`KyosanPreviewPart`). 받는 표에도 그 칸이 없다. 묶을 때 **버리는 것은
 * `kind` 하나**이고, 그것이 사용자가 버리라고 한 값이다.
 *
 * ⚠️ 2026-10-28 전에는 이 자리에 「`交換部品詳細` 시트의 `spec`(형식번호)은
 * 미리보기가 이미 버린다」라고 적혀 있었다. **그 문장은 이제 반만 맞다** —
 * `型式` 은 더 이상 형식번호가 아니라 **이름**이고(`parts-detail-sheet.ts` 의
 * 머리말), `text` 로 들어온다. 버려지는 곁 칸은 `partName`(`部品名`)과
 * `spec`(`仕様書番号`) 둘이다.
 *
 * 🔴 실측(2026-09-22, 연락서 469장, `推定修理内容` 을 세 번째 출처로 들인 뒤):
 * 「교체 부품」 **1,235줄** → 사용 부품 **1,085줄**(-150줄). **수량 합계 2,874 는
 * 전후가 같다.** 사례의 `0357.xlsm` 은 10줄 → **7줄**이고, 고장 3 · 예방 7 이던
 * 부품 셋이 각각 **수량 10 한 줄**이 된다.
 * (`推定修理内容` 을 들이기 전의 같은 실측은 1,327줄 → 1,163줄 · 수량 2,990 이었고,
 * 추정 블록을 떼고 재면 지금 코드로도 그 값이 그대로 나온다.)
 */
export function mergeKyosanPartsForUsedParts(
  parts: readonly KyosanPreviewPart[]
): KyosanUsedPartLine[] {
  type Bucket = { line: KyosanUsedPartLine; spellings: Map<string, number> };
  const byKey = new Map<string, Bucket>();
  for (const part of parts) {
    const key = kyosanUsedPartKey(part.text);
    // 🔴 `?? 1` — 수량이 안 적힌 줄을 1로 센다. 넣는 쪽의 규칙 그대로다.
    const quantity = part.quantity ?? 1;
    const found = byKey.get(key);
    if (found === undefined) {
      byKey.set(key, {
        line: { text: part.text, quantity },
        spellings: new Map([[part.text, 1]]),
      });
      continue;
    }
    found.line.quantity += quantity;
    found.spellings.set(part.text, (found.spellings.get(part.text) ?? 0) + 1);
  }

  return [...byKey.values()].map((bucket) => ({
    // 🔴 가장 많이 쓰인 표기를 보여 준다. 같은 수면 **먼저 나온 것**이 남는다
    //    (`Map` 이 넣은 차례를 지키므로 따로 정렬하지 않는다).
    text: mostUsedSpelling(bucket.spellings),
    quantity: bucket.line.quantity,
  }));
}

/**
 * 🔴 **장음류** — 같은 물건이 표기만 달라지는 자리다. `NFKC` 를 지난 뒤의
 * 글자들로 적는다: `ー`(U+30FC) · `―`(U+2015) · `‐`(U+2010) · `−`(U+2212) ·
 * `-`(U+002D, 전각 `－` 가 NFKC 로 여기 내려온다). 반각 `ｰ`(U+FF70)는 NFKC 가
 * `ー` 로 옮겨 주므로 따로 적지 않는다.
 */
const LONG_VOWEL_MARKS = /[ー―‐−-]/g;

/**
 * 사용 부품 칸에서 **같은 부품으로 볼 것인가**를 정하는 열쇠(위 머리말).
 * 🔴 이 값은 **견주는 데만** 쓴다 — 화면과 DB 에 적히는 글자는 원형이다.
 */
export function kyosanUsedPartKey(text: string): string {
  return text.normalize("NFKC").replace(/\s+/g, "").replace(LONG_VOWEL_MARKS, "");
}

/** 묶음 안에서 가장 많이 쓰인 표기. 같은 수면 먼저 나온 것. */
function mostUsedSpelling(spellings: ReadonlyMap<string, number>): string {
  let best: string | null = null;
  let bestCount = 0;
  for (const [text, count] of spellings) {
    if (best === null || count > bestCount) {
      best = text;
      bestCount = count;
    }
  }
  return best ?? "";
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
