import { collapseWhitespace, normalizeKey, type GridLike } from "./card-grid";

/**
 * ============================================================================
 * 교산 연락서 판독기 — 「推定修理内容」 블록 (2026-09-22)
 * ============================================================================
 * 🔴 **사람이 손으로 적은 부품 이름**이 여기에 있다. `交換部品詳細` 시트의 이름은
 * 교산 부품 대장에서 드롭다운으로 고른 것이라 실제로 적은 글자와 다르다 —
 * 사용자가 화면을 보고 두 번 짚었다:
 *
 *     대장 이름  `終段AMP基板（AMP-DEH基板）`   ←  지금 들어가던 것
 *     손글씨     `終段AMPデバイス基板`          ←  연락서에 적혀 있는 것
 *     대장 이름  `終段AMP入力保護用ヒューズ`
 *     손글씨     `終段AMP入力保護ヒューズ`
 *
 * 이 파일은 `parts-detail-sheet.ts` 와 나란한 자리다 — `SheetGrid` 위에서 순수하게
 * 판독만 한다. DB 도 `server-only` 도 React 도 부르지 않는다.
 *
 * ── 실측 (2026-09-22, 연락서 469장) ────────────────────────────────────
 * 라벨 `推定修理内容` 은 **469/469 장에 있고 언제나 A열**이며 장마다 **정확히
 * 하나**다(공백 제거 후 완전일치). 수식이 아니라 사람이 친 글자다.
 * 시트 이름은 두 갈래이고 한 장이 둘을 함께 가진 경우는 **0장**이다:
 *  · `進捗状況連絡書`      — 247장
 *  · `Progress_Information` — 222장
 *
 * ── 🔴 블록의 끝 — 다음 **구역 라벨**에서 끊는다 ──────────────────────
 * 지시서는 「끝은 `処置内容` 이다」라고 적었지만 실측은 **그렇지 않다**:
 * 라벨 뒤 첫 구역 라벨이 `処置内容` 인 장은 **143장**뿐이고 나머지 **326장**은
 * 곧바로 `必須事項` 이 온다. `処置内容` 만 보고 끊으면 그 326장에서 블록이
 * 시트 끝까지 흘러 뒤 구역(필수사항 점검표·실시일·희망납기)을 통째로 삼킨다.
 * 그래서 **세 라벨 가운데 먼저 나오는 것**에서 끊는다 —
 * `処置内容` · `必須事項` · `客先希望納期`. 빈 줄 수로 끊는 규칙은 쓰지 않는다
 * (앞 조사 실측으로 그 규칙은 77장에서 142줄을 뒤 구역에서 새어 들어오게 한다 —
 * 이 값은 우리가 쓰지 않는 규칙의 것이라 다시 재지 않았다).
 *
 * ── ⚠️ 한 칸 안에 여러 줄이 들어 있다 ─────────────────────────────────
 * A열 칸 하나가 `\r\n` 으로 여러 줄을 품는다. 칸 글자를 **줄바꿈으로 쪼개야**
 * 항목 줄 수가 맞는다. 값은 A열에만 있다(블록 구역의 B·AI 열에도 글자가 있지만
 * 그것은 옆 상자다 — 실측 수치가 A열만 읽을 때 맞는다).
 *
 * 실측: 블록에 글자가 있는 장 **379** · 머리글 줄 **608** · 항목 줄 **1,653**
 * (불릿만 있는 빈 줄 455줄은 글자로 세지 않는다). 항목 줄 가운데 이름이 나오는
 * 줄은 **1,573줄(95.2%)** 이고 고유 이름은 **164가지**다. 나머지 80줄은
 * 낱말 걸개로 버린 78줄과 이름을 못 뽑은 2줄이다(아래 두 절).
 *
 * ── 🔴 머리글은 `以下`/`下記` 로 잡는다 ────────────────────────────────
 * 머리글의 **꼬리가 13가지로 흔들린다**(`お勧めます` `お勧めします`
 * `おすすめます` `お進めます` `勧めます` `押すすえっます`(오타) `推奨します`
 * `推奨致します` `実施します` `実施致します` `行いました` `確認しました`
 * `実施予定です`). 꼬리로 잡으면 새 오타가 나올 때마다 머리글 하나가 항목 줄로
 * 떨어진다.
 *
 * 앞머리도 흔들린다. 지시서는 `〜として` + (`以下`|`下記`) 를 쓰라고 했지만
 * 실측에 `として` 가 없는 머리글이 **4줄** 있다 — `客先要請にて以下…` ·
 * `客先対応にて下記…` · `客先依頼の通り以下…` · `REV変更によって以下…`.
 * 그래서 **`以下` 또는 `下記` 를 품은 줄**을 머리글로 본다. 실측 469장에서
 * 그 규칙이 잡는 줄은 정확히 608줄이고, **항목 줄에 `以下`·`下記` 가 들어간
 * 경우는 0줄**이다(항목 줄은 부품 이름 + 수량뿐이다).
 *
 * ── 🔴 서법 판정 — 동사로 가른다 ──────────────────────────────────────
 * 꼬리로 가르면 안 된다 — `お勧めました` 는 과거형이지만 「권한다」다. 그래서
 * **권유 동사를 먼저 본다**. 실측에서 `推定修理内容` 의 수량 합 4,069 가운데
 * 「권한다」가 3,635(89.3%) · 「했다」는 55(1.4%) 다.
 *
 * ── 🔴 O/H 권유는 수량에 넣지 않는다 (사용자 결정 2026-09-22) ──────────
 * 「O/H 로 권한 부품이 실제로 교체됐습니까」에 사용자가 **「건마다 다르다」**로
 * 답했다. 그래서 갈래가 O/H 이고 서법이 「권한다」인 줄은 **부품 줄로 만들지
 * 않고** 원문 문구를 그대로 들고 나간다(부르는 쪽이 작업 이력 메모로 보낸다).
 * O/H 이면서 「한다」(37줄)·「했다」(13줄)인 것은 **예방분**으로 넣는다.
 *
 * 근거: 두 출처는 이름이 83% 짝지을 수 없는데도(앞 조사) O/H 권유만 빼면 수량
 * 합이 **2,874 ↔ 추정수리내용을 안 쓰던 때의 2,990** 으로 맞아떨어진다.
 * ⚠️ 「권한다」를 **전부** 빼면 과잉이다 — 앞 조사 실측으로 양쪽에 다 있는
 * 274장 중 173장(63%)은 권유형인데도 수량이 실제 기록과 정확히 같았다.
 *
 * ── 🔴 갈래를 늘리지 않는다 ───────────────────────────────────────────
 * 돌려주는 `kind` 는 `fault` · `preventive` 둘뿐이다(`KyosanPreviewPart` 와 같다).
 * O/H 는 **갈래가 아니라 덩어리의 성격**이므로 `group` 으로 따로 들고 다니고,
 * 화면과 저장에 나가는 갈래는 둘로 눌러 준다. 갈래를 늘리면 화면 React 열쇠
 * (`${kind}-${text}`)와 `KYOSAN_PART_KIND_LABEL` 과 `report-detail-values.ts` 의
 * 못 박힌 배열까지 전부 움직인다.
 *
 * ── 🔴 고객 정보 ───────────────────────────────────────────────────────
 * 돌려주는 값에는 교산 쪽 부품 이름·형식번호가 그대로 들어 있다. 부르는 쪽은
 * 결과를 저장소 안 파일이나 바깥 서비스로 내보내지 않는다.
 * ============================================================================
 */

/** 이 블록이 있는 시트 이름들. `normalizeKey` 로 누른 뒤 **완전일치**로 견준다. */
const ESTIMATED_SHEET_KEYS: ReadonlySet<string> = new Set([
  normalizeKey("進捗状況連絡書"),
  normalizeKey("Progress_Information"),
]);

/**
 * 「推定修理内容」 블록이 있는 시트 이름인가. 앞머리 일치를 쓰지 않는다 —
 * 실측 통합문서에는 `進捗状況連絡書` 로 시작하는 딴 시트가 없고, 앞머리로
 * 느슨하게 잡으면 남의 시트를 집었을 때 조용히 엉뚱한 부품이 들어온다.
 */
export function isEstimatedRepairSheetName(sheetName: string): boolean {
  return ESTIMATED_SHEET_KEYS.has(normalizeKey(sheetName));
}

/** 통합문서의 시트 이름들 중 이 시트들만, 적힌 차례 그대로. */
export function pickEstimatedRepairSheetNames(sheetNames: readonly string[]): string[] {
  return sheetNames.filter(isEstimatedRepairSheetName);
}

/** 라벨·값이 앉는 열. 실측에서 언제나 A열이다(위 머리말). */
const BLOCK_COLUMN = "A";

/** 블록을 여는 라벨. */
const BLOCK_LABEL_KEY = normalizeKey("推定修理内容");

/**
 * 🔴 블록을 닫는 구역 라벨들 — **먼저 나오는 것**에서 끊는다(위 머리말).
 * 실측: `必須事項` 326장 · `処置内容` 143장. `客先希望納期` 는 그 뒤에 온다.
 */
const BLOCK_END_LABEL_KEYS: ReadonlySet<string> = new Set([
  normalizeKey("処置内容"),
  normalizeKey("必須事項"),
  normalizeKey("客先希望納期"),
]);

/** 항목 줄 앞의 불릿. 실측에 나오는 전부다. 뗀 뒤 빈 줄은 **글자로 세지 않는다**. */
const LEADING_BULLETS = /^[・･‐\-●○※\s]+/;

/** 머리글임을 알리는 글자(위 머리말 「머리글은 `以下`/`下記` 로 잡는다」). */
const HEADING_MARKERS: readonly string[] = ["以下", "下記"];

/**
 * 🔴 **부품이 아닌 줄**을 걸러내는 낱말들. 실측 78줄(서로 다른 글자 41가지)이
 * 여기 걸리고, 78줄 전부를 눈으로 확인했다 — 한 줄도 부품이 아니다 —
 * `型式の変更　変更前`(9) · `ROMの変更　変更前`(7) · `VPP、VDCの再調整`(7) ·
 * `出力パラCの改造作業`(5) · `内部板金の清掃` 따위. 「무엇을 갈았나」가 아니라
 * 「무슨 일을 했나」라서 사용 부품 칸에 들어갈 물건이 없다.
 *
 * ⚠️ 이 걸개가 `〜の取り付け：N枚`(수량이 붙어 있다)도 버린다. **그대로
 * 버린다** — 판단이 갈리는 자리이고 사용자 결정이 없다.
 * ⚠️ 거꾸로 `内部ホースの交換` 처럼 **수량이 없는 부품 줄 25줄**은 걸개에 안
 * 걸린다. 남긴다(수량 없음 = 1개로 센다).
 */
const NON_PART_WORDS =
  /変更|調整|改造|清掃|掃除|確認|取り外し|実施|進行|作業|補修|追加|貼り付け|洗浄|補充|取り付け/;

/** 🔴 이름과 수량을 가르는 첫 자리. 실측 항목 줄의 **86.2%(1,425줄)** 가 이 꼴이다. */
const REPLACEMENT_MARK = "の交換";

/**
 * 🔴 `を交換` · `の取替` · `の取り替` 는 실측에 **한 줄도 없다.** 넣어 두면
 * 「있을 법한 표기」를 지키는 것처럼 보이지만 실제로는 검증되지 않은 분기가
 * 하나 늘 뿐이다 — 새 표기가 나오면 그때 실측으로 확인하고 넣는다.
 */
const REPLACEMENT_WORD = "交換";

/**
 * 이름과 수량 사이의 구분자. **가장 왼쪽에 나온 것**에서 가른다.
 *
 * 실측: 이 갈래로 갈린 **143줄**의 구분자 빈도는 `…`(134) · `：`(5) ·
 * `･･･`(2) · `...`(1) · `・・・`(1) 이다. 🔴 구분자를 품은 줄 자체는 훨씬 많지만
 * 대부분 `の交換` 갈래에서 먼저 갈리므로 여기까지 오지 않는다 — 이 수는
 * **「여기까지 온 줄」** 의 수다.
 */
const SEPARATORS: readonly string[] = ["…", "・・・", "･･･", "...", "：", ":"];

/**
 * 「수 + 단위」 한 짝. 🔴 `m` 뒤에 영숫자가 오면 수량이 아니라 형식번호다
 * (실측: 부품 줄 1,573줄 가운데 **857줄**이 괄호로 끝나고, 그 안에 위치
 * (`右側内4，5`)나 형식번호(`ZWS240BP-48`)가 들어 있다).
 *
 * 🔴 **글자를 한 벌만 둔다.** 아래 두 정규식이 이 글자를 함께 쓴다 — 두 벌로
 * 적으면 단위를 하나 더하는 날 한쪽만 고쳐진다. 둘 다 `NFKC` 를 지난 글자에
 * 대고 견준다(전각 `６`·`ｍ` 가 반각으로 내려온 뒤다).
 */
const QUANTITY_SOURCE = "([0-9]+|[一二三四五六七八九十]+)\\s*(?:セット|箇所|個|枚|本|台|式|組|m)(?![0-9A-Za-z])";

/** 이름 뒤 글자 **어디서든** 「수 + 단위」를 찾는다(가장 왼쪽 짝). */
const QUANTITY_PATTERN = new RegExp(QUANTITY_SOURCE);

/** 🔴 **바로 그 자리에서** 「수 + 단위」가 시작하는가 — 아래 네 번째 갈래가 쓴다. */
const QUANTITY_AT_START = new RegExp(`^${QUANTITY_SOURCE}`);

/** 한자 숫자 한 글자 → 값. 실측에 `十` 을 넘는 한자 수는 없다. */
const KANJI_DIGITS: ReadonlyMap<string, number> = new Map([
  ["一", 1],
  ["二", 2],
  ["三", 3],
  ["四", 4],
  ["五", 5],
  ["六", 6],
  ["七", 7],
  ["八", 8],
  ["九", 9],
]);

/** 부품 이름으로 치기에 너무 긴 글자. 판독이 어긋났을 때의 멈춤막이다. */
const MAX_NAME_LENGTH = 80;

/** 머리글이 선언한 덩어리의 성격. 🔴 갈래(`kind`)가 아니다(위 머리말). */
export type KyosanEstimatedGroup = "fault" | "preventive" | "overhaul";

/** 머리글의 **서법** — 권한다 / 한다 / 했다. 동사로 가른다(위 머리말). */
export type KyosanEstimatedMood = "recommend" | "will" | "did";

/** 「推定修理内容」 블록에서 읽은 부품 한 줄. */
export type KyosanEstimatedPart = {
  /** 🔴 연락서에 **사람이 적은** 부품 이름. 괄호를 떼지 않는다(아래 머리말). */
  name: string;
  /** 화면·저장에 나가는 갈래. O/H 는 예방분으로 눌러 준다. */
  kind: "fault" | "preventive";
  /** 🔴 수량이 안 적힌 줄은 **null** 이다 — 부르는 쪽이 1로 센다. */
  quantity: number | null;
  /** 머리글이 선언한 덩어리(`overhaul` 이 살아 있어야 왜 뺐는지 말할 수 있다). */
  group: KyosanEstimatedGroup;
  mood: KyosanEstimatedMood;
  /** 어느 시트에서 왔는가. */
  sheetName: string;
  /** `A132` 꼴. 보고와 시험에서 어디를 읽었는지 말하려고 들고 있다. */
  address: string;
  /** 연락서 원문 줄 그대로(불릿까지). 🔴 다듬지 않는다. */
  sourceLine: string;
};

export type KyosanEstimatedRepairBlock = {
  sheetName: string;
  /** `A130` 꼴. */
  labelAddress: string;
  /** 블록을 닫은 구역 라벨 주소. 못 찾았으면 null(시트 끝까지 읽었다). */
  endAddress: string | null;
  /** 🔴 O/H 권유를 **뺀** 부품 줄들. */
  parts: readonly KyosanEstimatedPart[];
  /**
   * 🔴 O/H 권유 원문 — 머리글 줄과 그 아래 항목 줄들이 적힌 차례 그대로다.
   * 부르는 쪽이 **작업 이력 메모**로 보낸다(수량에는 넣지 않는다).
   */
  overhaulRecommendations: readonly string[];
};

/** 불릿과 앞뒤 공백을 뗀 글자. 전부 불릿이면 빈 글자다(= 양식이 그려 둔 빈 줄). */
function stripBullets(text: string): string {
  return text.replace(LEADING_BULLETS, "").trim();
}

/** 머리글 줄인가 — `以下` 또는 `下記` 를 품었는가(위 머리말). */
export function isEstimatedHeadingLine(text: string): boolean {
  return HEADING_MARKERS.some((marker) => text.includes(marker));
}

/**
 * 머리글이 선언한 덩어리. `予防` 를 먼저 본다 —
 * `客先依頼の通り以下の予防交換作業を実施します。` 처럼 앞머리가 `〜として` 가
 * 아닌 줄이 있어서 「`として` 앞을 본다」는 규칙으로는 못 잡는다.
 *
 * 🔴 그 밖은 **고장분**이다(`REV変更として` · `VDC改造作業として` ·
 * `改善作業として` · `電流強化対策として` · `依頼として` · `客先対応にて` ·
 * `客先要請にて` 따위). 머리글이 **하나도 없는 30장(항목 줄 40줄)** 도
 * 고장분이다 — 양식의 첫 덩어리가 `修理として` 이고 예방은 언제나 머리글로
 * 선언된다(실측 장수: 고장분 **326장** 대 예방분 **105장**).
 *
 * ⚠️ 첫 머리글보다 **앞에** 놓인 항목 줄은 전부 50줄이다 — 그 가운데 40줄이
 * 위의 30장 것이고, 남은 10줄은 아래쪽에 머리글이 있는 장의 앞머리 줄이다.
 */
export function estimatedHeadingGroup(text: string): KyosanEstimatedGroup {
  const key = normalizeKey(text);
  if (key.includes(normalizeKey("予防"))) return "preventive";
  // `O/H` · `OH` · `O/H/` · `オーバーホール` · `オーバホール` 를 한 줄로 잡는다.
  if (/o\/?h/.test(key) || key.includes("オーバーホール") || key.includes("オーバホール")) {
    return "overhaul";
  }
  return "fault";
}

/**
 * 머리글의 서법. 🔴 **권유 동사를 먼저 본다** — `お勧めました` 는 과거형이지만
 * 「권한다」다(꼬리로 가르면 이것이 「했다」가 되어 O/H 권유가 수량에 들어간다).
 */
export function estimatedHeadingMood(text: string): KyosanEstimatedMood {
  const key = normalizeKey(text);
  if (/勧め|すすめ|お進め|押すすえ|推奨/.test(key)) return "recommend";
  if (key.includes("ました")) return "did";
  // `します` · `致します` · `予定です` 가 여기로 온다. 실측에서 셋 밖의 꼬리는
  // 없었지만, 새 꼬리가 나와도 「한다」로 두는 쪽이 안전하다 — O/H 에서
  // 「한다」는 **예방분으로 넣는다**는 뜻이고, 그것이 지금까지의 동작이다.
  return "will";
}

/** 한자 숫자 → 값. `十`=10 · `十二`=12 · `二十`=20 · `三十五`=35. 모르면 null. */
function parseKanjiNumber(text: string): number | null {
  const at = text.indexOf("十");
  if (at < 0) {
    let value = 0;
    for (const character of text) {
      const digit = KANJI_DIGITS.get(character);
      if (digit === undefined) return null;
      value = value * 10 + digit;
    }
    return value === 0 ? null : value;
  }
  const tensText = text.slice(0, at);
  const onesText = text.slice(at + 1);
  const tens = tensText === "" ? 1 : (KANJI_DIGITS.get(tensText) ?? null);
  const ones = onesText === "" ? 0 : (KANJI_DIGITS.get(onesText) ?? null);
  if (tens === null || ones === null) return null;
  return tens * 10 + ones;
}

/**
 * 수량. 🔴 **이름 뒤 글자에서만** 찾는다 — 줄 끝 괄호에 위치(`右側内4，5`)와
 * 형식번호(`SHV14 8A`)가 붙지만 그것들은 수량 **뒤**에 오므로 가장 왼쪽 짝을
 * 잡으면 저절로 피해진다. 못 찾으면 null(부르는 쪽이 1로 센다).
 *
 * ⚠️ 구분자가 깨진 줄이 있다(`..4.枚` · 구분자 없는 `交換1枚` — 앞 조사가 센
 * 것은 3줄이다). 억지로 맞추지 않는다. 실측으로 부품 줄 **1,573줄 가운데 수량이
 * 뽑히는 것이 1,548줄(98.4%)** 이고, 남은 **25줄은 수량 없음**으로 떨어져 1로
 * 센다.
 *
 * 🔴 전각 숫자(`６`)와 한자 숫자(`一二三…十`)가 섞인다 — `NFKC` 로 전각을 펴고
 * 한자는 표로 푼다.
 */
export function readEstimatedQuantity(tail: string): number | null {
  const matched = QUANTITY_PATTERN.exec(tail.normalize("NFKC"));
  if (!matched) return null;
  const digits = matched[1];
  const value = /^[0-9]+$/.test(digits) ? Number(digits) : parseKanjiNumber(digits);
  if (value === null || !Number.isInteger(value) || value < 1) return null;
  return value;
}

/** 이름과 그 뒤 글자로 가른 결과. */
type SplitLine = { name: string; tail: string };

/**
 * 항목 줄을 **이름**과 **그 뒤 글자**로 가른다.
 *
 * 실측 1,573줄이 네 갈래로 갈린다(2026-09-22):
 *  1. `の交換` 앞 — **1,425줄(86.2%)**
 *  2. 없으면 **구분자 앞** — **143줄**
 *  3. `交換` 이 딴 자리에 있는 줄은 `交換` 바로 앞 — **2줄**
 *  4. 그것도 없으면 **「수 + 단위」 바로 앞의 `の`** — **3줄**(`splitBeforeQuantity`)
 *
 * 🔴 **괄호를 떼지 마라.** 이름의 일부인 것이 많다 —
 * `フィルムコンデンサ(S-CONT 基板用)` · `フィルムコンデンサ(スナバコンデンサ)` ·
 * `TUNEバリコン(SCV-1015P110W)`(앞 조사 실측으로 각각 26 · 21 · 3줄). 무조건
 * 떼면 **서로 다른 부품이 한 이름으로 뭉친다.** 줄 끝 괄호(위치·형식번호)는
 * 구분자 뒤라 애초에 이름에 들어오지 않는다.
 *
 * 🔴 이름 끝에 `の` 가 남는 경우는 실측 **0건**이다 — 그래서 떼지 않는다.
 * 떼는 코드를 넣으면 `〜のケーブル` 같은 진짜 이름을 깎을 위험만 생긴다.
 */
export function splitEstimatedItemLine(text: string): SplitLine | null {
  const replacement = text.indexOf(REPLACEMENT_MARK);
  if (replacement > 0) {
    return {
      name: text.slice(0, replacement),
      tail: text.slice(replacement + REPLACEMENT_MARK.length),
    };
  }

  let cut = -1;
  let cutLength = 0;
  for (const separator of SEPARATORS) {
    const at = text.indexOf(separator);
    if (at <= 0) continue;
    if (cut < 0 || at < cut) {
      cut = at;
      cutLength = separator.length;
    }
  }
  if (cut > 0) return { name: text.slice(0, cut), tail: text.slice(cut + cutLength) };

  const word = text.indexOf(REPLACEMENT_WORD);
  if (word > 0) {
    return { name: text.slice(0, word), tail: text.slice(word + REPLACEMENT_WORD.length) };
  }
  return splitBeforeQuantity(text);
}

/**
 * 🔴 **네 번째 갈래** — 「이름 + `の` + 수 + 단위」 (2026-09-22).
 *
 * ── 왜 **마지막**인가 ──────────────────────────────────────────────────
 * 앞의 세 갈래가 **모두 못 잡는 꼴**이라서다. `の交換` 도 없고, 구분자(`…` `：`
 * `...`)도 없고, `交換` 이라는 낱말 자체가 없다 — 사람이 「〜의 1개」라고만 적고
 * 「교환」을 생략한 줄이다. 그래서 앞 갈래들의 뒤에 둔다: 앞 갈래가 잡을 수
 * 있는 줄을 이 갈래가 먼저 가로채면, 이름 안에 들어 있는 `の`(예:
 * `フィルターボックスのVFC`) 때문에 이름이 잘릴 수 있다.
 *
 * ── 실측으로 걸리는 줄은 **3줄**이다 ──────────────────────────────────
 *     フィルターボックスのVFCの1個                  → 1개
 *     終段AMPコンデンサ基板の1枚（右側内4）          → 1장
 *     終段AMPコンデンサ基板の9枚（右側内1，2，3，5…） → 9장
 * 전부 **진짜 부품**이고, 앞 갈래만 쓰던 동안 세 줄이 통째로 빠지고 있었다
 * (수량 11개분). 🔴 앞 조사가 낸 수량 기대값 2,868 은 이 3줄을 못 뽑은 값이라,
 * 넣으면 **2,874** 가 된다 — 그쪽이 사실에 가깝다(사용자 검수 승인 2026-09-22).
 *
 * ⚠️ 셋이 **한 장(`kyosan-xlsm/0286.xlsm`)에 모여 있다.** 그래서 「교체 부품」은
 * 3줄 늘지만(1,232 → 1,235), 사용 부품 칸은 뒤의 두 줄이 **같은 이름**
 * (`終段AMPコンデンサ基板`, 고장 1 + 예방 9)이라 한 줄(수량 10)로 묶여 **2줄만**
 * 는다(1,083 → 1,085). 수량은 **+11 그대로 보존**된다 — 「3줄이니 사용 부품도
 * 3줄 늘어야 한다」고 고치지 마라.
 *
 * ── ⚠️ 부품이 **아닌** 2줄이 왜 안 걸리는가 ──────────────────────────
 * 같은 자리에 오는 이 둘은 계속 빠져야 하고, `の` 뒤에 「수 + 단위」를 **요구**
 * 하는 것이 그 둘을 막는다:
 *   · `REV148->148Bのため`  — `の` 는 있지만 뒤가 `ため` 다(수도 단위도 없다)
 *   · `WR10775AA321D→故障基板、予防措置基板にRev.Fにする。` — `の` 가 **아예 없다**
 * 그래서 「`の` 가 있으면 앞이 이름」이 아니라 **「`の` 다음이 곧 수량이면」** 으로
 * 좁혔다. 시험이 이 둘을 글자 그대로 못 박는다.
 *
 * ── 어느 `の` 인가 ────────────────────────────────────────────────────
 * **오른쪽부터** 찾는다. `フィルターボックスのVFCの1個` 의 첫 `の` 는 이름의
 * 일부라서, 왼쪽부터 찾으면 이름이 `フィルターボックス` 로 깎인다. 뒤가 수량인
 * `の` 만 맞으므로 실측 3줄에서는 어느 쪽이어도 같지만, 앞으로 `2mのケーブルの3本`
 * 꼴이 들어와도 오른쪽 규칙이 맞는 이름을 준다.
 */
function splitBeforeQuantity(text: string): SplitLine | null {
  for (let at = text.lastIndexOf("の"); at > 0; at = text.lastIndexOf("の", at - 1)) {
    const tail = text.slice(at + "の".length);
    // 🔴 `NFKC` 를 지난 글자에 대고 견준다 — 전각 `１個` 도 같이 잡힌다.
    if (QUANTITY_AT_START.test(tail.normalize("NFKC"))) return { name: text.slice(0, at), tail };
  }
  return null;
}

/** 블록 안의 한 줄 — 원문과 그 줄이 앉은 행. */
type BlockLine = { row: number; text: string };

/**
 * A열에서 라벨과 끝을 찾아 그 사이의 줄들을 모은다. 🔴 칸 하나를 `\r\n` 으로
 * **쪼갠다**(위 머리말). 라벨이 없으면 null.
 */
function readBlockLines(
  grid: GridLike
): { labelRow: number; endRow: number | null; lines: BlockLine[] } | null {
  let labelRow: number | null = null;
  let endRow: number | null = null;

  for (const row of grid.rowNumbers) {
    const cell = grid.cells(row).get(BLOCK_COLUMN);
    if (!cell || cell.kind !== "text") continue;
    const key = normalizeKey(cell.text);
    if (labelRow === null) {
      if (key === BLOCK_LABEL_KEY) labelRow = row;
      continue;
    }
    if (endRow === null && BLOCK_END_LABEL_KEYS.has(key)) endRow = row;
  }
  if (labelRow === null) return null;

  const lines: BlockLine[] = [];
  for (const row of grid.rowNumbers) {
    if (row <= labelRow) continue;
    if (endRow !== null && row >= endRow) break;
    const cell = grid.cells(row).get(BLOCK_COLUMN);
    if (!cell || cell.kind !== "text") continue;
    for (const piece of cell.text.split(/\r\n|\r|\n/)) {
      const text = collapseWhitespace(piece);
      if (text !== "") lines.push({ row, text });
    }
  }
  return { labelRow, endRow, lines };
}

/**
 * 시트 하나에서 「推定修理内容」 블록을 읽는다. 라벨을 못 찾으면 **null** —
 * 던지지 않는다(469장을 한 번에 돌리는 쪽이 한 장 때문에 멈추면 안 된다).
 */
export function readEstimatedRepairBlock(
  grid: GridLike,
  sheetName: string
): KyosanEstimatedRepairBlock | null {
  const block = readBlockLines(grid);
  if (block === null) return null;

  const parts: KyosanEstimatedPart[] = [];
  const overhaulRecommendations: string[] = [];

  // 🔴 머리글이 없는 장은 **고장분 · 한다**로 둔다(위 `estimatedHeadingGroup`).
  let group: KyosanEstimatedGroup = "fault";
  let mood: KyosanEstimatedMood = "will";
  let headingLine: string | null = null;
  let headingWritten = false;

  for (const { row, text } of block.lines) {
    const line = stripBullets(text);
    // 불릿만 있는 줄은 양식이 그려 둔 빈 줄이다(실측 455줄).
    if (line === "") continue;

    if (isEstimatedHeadingLine(line)) {
      group = estimatedHeadingGroup(line);
      mood = estimatedHeadingMood(line);
      headingLine = text;
      headingWritten = false;
      continue;
    }

    // 「무엇을 갈았나」가 아닌 줄은 버린다(위 `NON_PART_WORDS`).
    if (NON_PART_WORDS.test(line)) continue;

    const split = splitEstimatedItemLine(line);
    if (split === null) continue;
    const name = split.name.trim();
    if (name === "" || name.length > MAX_NAME_LENGTH) continue;

    if (group === "overhaul" && mood === "recommend") {
      if (!headingWritten && headingLine !== null) {
        overhaulRecommendations.push(headingLine);
        headingWritten = true;
      }
      overhaulRecommendations.push(text);
      continue;
    }

    parts.push({
      name,
      // 🔴 갈래는 둘뿐이다 — O/H 의 「한다/했다」는 예방분으로 눌러 준다.
      kind: group === "fault" ? "fault" : "preventive",
      quantity: readEstimatedQuantity(split.tail),
      group,
      mood,
      sheetName,
      address: `${BLOCK_COLUMN}${row}`,
      sourceLine: text,
    });
  }

  return {
    sheetName,
    labelAddress: `${BLOCK_COLUMN}${block.labelRow}`,
    endAddress: block.endRow === null ? null : `${BLOCK_COLUMN}${block.endRow}`,
    parts,
    overhaulRecommendations,
  };
}
