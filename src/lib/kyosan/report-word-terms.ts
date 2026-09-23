import { KYOSAN_FREE_TEXT_TERMS } from "./report-free-text-terms";
import { KYOSAN_FORM_TERMS, hasJapaneseCharacter, translateKyosanTerm } from "./report-terms";

/**
 * ============================================================================
 * 문장 속 **낱말**을 갈아 끼운다 — 사전에 통째로 없는 줄을 위해 (2026-09-23)
 * ============================================================================
 * 사전 둘(`report-terms.ts` 15 · `report-free-text-terms.ts` 192)은 **글자 통째로**
 * 만 맞는다. 그래서 아래 같은 줄이 문서에 일본어 그대로 나갔다 —
 * 🔴 **사용자가 엑셀 미리보기에서 실제로 잡아낸 줄이다(2026-09-23).**
 *
 *     ‐終段AMP入力保護ヒューズの故障確認(右側内4) ‐終段AMPデバイス基板の…
 *
 * 부품 이름은 거의 사전에 있는데 한 글자가 달라 안 걸린다:
 *
 *     사전에 있는 것                    연락서에 적힌 것              왜 안 걸리나
 *     終段AMP入力保護用ヒューズ         終段AMP入力保護ヒューズ       `用` 한 글자
 *     終段AMPコンデンサ基板（AMP-DEH用） 終段AMPコンデンサ基板         괄호 부분이 없음
 *     (없음)                            終段AMPデバイス基板           사전에 없는 부품
 *
 * 게다가 뒤에 `の故障確認` · `(右側内4)` 가 붙고 세 항목이 한 줄에 이어져 **41자를
 * 넘는다.** 그래서 실측 고정 표(`report-free-text-lines.fixture.ts`)에서도 걸러져
 * 사전이 그 줄을 본 적이 없다.
 *
 * ── 🔴 앞 세션이 낱말 방식을 한 번 기각했다 — 그 기각은 사실이었다 ──────
 * `report-terms.ts` 머리말에 「낱말 사전 방식은 실측으로 기각 — 긴 서술에 대면
 * **반쪽만 바뀌는 것이 44.5%**」가 적혀 있다. 🔴 **그 문구를 지우지 마라.** 그때의
 * 실측은 사실이었고, 사전이 **25개**일 때의 이야기다. 지금은 **207개**(15+192)에
 * 아래 낱말까지 더해진다.
 *
 * ── 🔴 이번에 반쪽 번역을 어떻게 막았나 — 둘이다 ────────────────────
 *  1. **긴 것부터 맞춘다(최장 일치)** — 후보를 길이 내림차순으로 훑는다.
 *     `終段AMP入力保護用ヒューズ` 가 `ヒューズ` 보다 **먼저** 걸리므로, 부품 이름
 *     속의 `ヒューズ` 만 바뀌어 `終段AMP入力保護用퓨즈` 가 되는 일이 **구조적으로
 *     없다.**
 *  2. 🔴 **전부 바뀔 때만 바꾼다(all-or-nothing)** — 바꾼 결과에 일본어가 한
 *     글자라도 남으면 **원문을 그대로 돌려준다**(`null`). 흉한 반쪽이 문서로
 *     나가는 길 자체를 막는다. 44.5%가 무서웠던 까닭이 바로 그 반쪽이었다.
 *
 * ── 🔴 누르는 방식 — NFKC 만 쓴다(공백은 지우지 않는다) ─────────────
 * 사전 셋은 `kyosanCauseKey`(NFKC + **공백 제거**)로 누른 열쇠를 쓴다. **문장 속
 * 치환에는 그 열쇠를 쓸 수 없다.** 공백을 지우면 글자 자리가 어긋나 「어디를
 * 바꿨는지」를 원문에 되돌려 놓을 수 없고, 낱말 사이 공백이 사라진 글자가 나간다.
 *
 * 그래서 **NFKC 만** 쓴다 — 찾는 쪽(후보 열쇠)과 받는 쪽(문장)에 **똑같이** 건다.
 *   · 얻는 것: 반각 가타카나(`ﾋｭｰｽﾞ`)와 전각 괄호(`（）`)가 사전의 꼴로 모인다 —
 *     연락서가 판본마다 이 둘을 섞어 쓴다.
 *   · 치르는 값: 일본어가 아닌 자리(전각 괄호·전각 숫자)도 반각으로 바뀐다.
 *     🔴 그래도 되는 까닭은 **전부 한글이 됐을 때만 이 글자가 나가기** 때문이다
 *     (all-or-nothing). 한 글자라도 일본어가 남으면 원문이 그대로 나가므로,
 *     NFKC 가 원문을 몰래 고쳐 두는 일은 없다.
 *   · 남는 것: 후보 열쇠 안의 공백(`REF 発生`)은 문장에도 같은 자리에 있어야
 *     맞는다. 못 맞으면 그 줄은 일본어가 남아 원문 그대로 나갈 뿐이라 잃는 것이
 *     없다.
 *
 * ── 이 파일이 사전을 고치지 않는다 ──────────────────────────────────
 * 위 두 사전의 내용은 **한 글자도 건드리지 않는다.** 여기 표는 그 둘이 못 가진
 * **변형 꼴 · 부위 · 서술 조각**만 담는다.
 * ============================================================================
 */

/**
 * 문장 속에서만 쓰는 낱말 사전. 🔴 **줄마다 왜 넣었는지 적는다.**
 *
 * 🔴 여기 값은 **통째 번역에 쓰이지 않는다** — `translateKyosanTerm` 은 이 표를
 * 보지 않는다. 그래서 「연락서 한 칸이 이 낱말과 통째로 같을 때」가 아니라
 * 「긴 문장 속에 이 조각이 있을 때」만 쓰인다.
 */
export const KYOSAN_WORD_TERMS: Readonly<Record<string, string>> = Object.freeze({
  // ── (가) 부품 이름의 **변형** — 사전의 것과 한두 글자 다른 꼴 ─────────────
  /**
   * 🔴 사용자가 잡아낸 줄에 있던 꼴. 자유 기술 사전에는 `用` 이 든
   * `終段AMP入力保護用ヒューズ` 만 있어 **한 글자 차이로** 안 걸렸다.
   */
  "終段AMP入力保護ヒューズ": "종단 AMP 입력 보호 퓨즈",
  /** 🔴 사용자가 잡아낸 줄에 있던 부품. 두 사전 어디에도 없었다. */
  "終段AMPデバイス基板": "종단 AMP 디바이스 기판",
  /**
   * 🔴 사용자가 잡아낸 줄에 있던 꼴. 자유 기술 사전에는 `（AMP-DEH用）` 가 붙은
   * 긴 꼴만 있어 안 걸렸다.
   * ⚠️ 자유 기술의 `終段AMPｺﾝﾃﾞﾝｻ基板`(반각)이 NFKC 로 이 글자와 같아진다 —
   * 후보를 모을 때 먼저 든 쪽(자유 기술)이 남고, 한글 값은 둘이 같다.
   */
  "終段AMPコンデンサ基板": "종단 AMP 콘덴서 기판",
  /** 위 디바이스 기판의 **중단** 짝. 연락서는 종단/중단을 같은 꼴로 적는다. */
  "中段AMPデバイス基板": "중단 AMP 디바이스 기판",
  /** 앞에 종단/중단이 안 붙고 홀로 적히는 짧은 꼴. 위 둘보다 짧아 나중에 걸린다. */
  "デバイス基板": "디바이스 기판",

  // ── (나) 부위·위치 ───────────────────────────────────────────────────────
  /** 🔴 사용자가 잡아낸 줄의 `(右側内4)`. `右側` 보다 길어 먼저 걸린다. */
  "右側内": "우측 내부",
  /** 위의 왼쪽 짝. */
  "左側内": "좌측 내부",
  /** 안쪽/바깥쪽을 나누어 적는 연락서 꼴. */
  "右側外": "우측 바깥",
  /** 위의 왼쪽 짝. */
  "左側外": "좌측 바깥",
  /** 안/바깥이 안 붙는 짧은 꼴. */
  "右側": "우측",
  /** 위의 왼쪽 짝. */
  "左側": "좌측",
  /** 자유 기술 사전의 `内部焼損` · `内部板金` 처럼 뒤에 무엇이든 붙는 자리다. */
  "内部": "내부",
  /** 위의 짝. */
  "外部": "외부",
  /** 장치의 앞뒤·위아래를 가리키는 네 낱말. 부위 칸에 자주 붙는다. */
  "前面": "전면",
  "背面": "후면",
  "上部": "상부",
  "下部": "하부",

  // ── (다) 서술 — 🔴 `の` 가 붙은 긴 꼴을 **먼저** 적는다 ───────────────────
  // `の` 는 「~의」라 한글에서 사라진다. 그래서 값 앞에 **공백 하나**를 두어
  // 앞의 부품 이름과 붙지 않게 한다(`퓨즈 고장 확인`).
  /** `の` 꼴이 `の` 없는 꼴보다 길어 먼저 걸린다 — 그래서 위에 적는다. */
  "の絶縁抵抗値不良": " 절연 저항값 불량",
  /** 🔴 사용자가 잡아낸 줄에 **세 번** 나온 조각이다. */
  "の故障確認": " 고장 확인",
  "の耐圧不良": " 내압 불량",
  "の容量不良": " 용량 불량",
  "の動作確認": " 동작 확인",
  "の故障": " 고장",
  "の異常": " 이상",
  "の破損": " 파손",
  "の交換": " 교체",
  "の点検": " 점검",
  /** 여기부터는 `の` 없이 부품 이름에 바로 붙는 꼴이다. */
  "絶縁抵抗値不良": "절연 저항값 불량",
  "故障確認": "고장 확인",
  "動作確認": "동작 확인",
  "耐圧不良": "내압 불량",
  "容量不良": "용량 불량",
  /** 자유 기술 사전의 `TUNEバリコン軸抜け` 와 같은 말이다. */
  "軸抜け": "축 빠짐",
  // ── 한 낱말짜리 서술. 🔴 위의 긴 꼴이 전부 먼저 걸린 뒤에 남는 것만 맞는다 ──
  "故障": "고장",
  "確認": "확인",
  "発生": "발생",
  "異常": "이상",
  "破損": "파손",
  "焼損": "소손",
  "変色": "변색",
  "発熱": "발열",
  "漏水": "누수",
  "腐食": "부식",
  "電食": "전식",
  "交換": "교체",
  "点検": "점검",
  "要請": "요청",
  "依頼": "의뢰",
  "修理": "수리",
  "検査": "검사",
  "調査": "조사",
  "基板": "기판",
  "部品": "부품",
  "問題": "문제",
  /** `問題無し` 처럼 붙어 나온다. `無い` 와 함께 두 꼴을 다 적는다. */
  "無し": "없음",
  "無い": "없음",
});

/** 문장 속에서 찾을 후보 하나. `japanese` 는 **NFKC 로 누른** 꼴이다. */
type KyosanWordCandidate = {
  japanese: string;
  korean: string;
};

/**
 * 후보를 **첫 글자로 묶은** 표. 묶음 안은 **길이 내림차순**이라 먼저 맞는 것이
 * 곧 가장 긴 것이다(최장 일치).
 *
 * 🔴 **한 번만 만들고 다시 쓴다.** 부를 때마다 정렬하면 줄마다 200여 개를 다시
 * 줄 세우게 된다.
 *
 * 🔴 **모듈을 읽을 때 만들지 않고 처음 부를 때 만든다.** `report-terms.ts` 가 이
 * 파일을 들여오고 이 파일이 다시 `report-terms.ts` 를 들여오는 **고리**라, 모듈
 * 몸통에서 `KYOSAN_FORM_TERMS` 를 건드리면 아직 만들어지지 않은 값에 닿는다.
 * 함수 안에서 닿으면 그때는 두 모듈이 다 만들어져 있다.
 */
let CANDIDATE_BUCKETS: ReadonlyMap<string, readonly KyosanWordCandidate[]> | null = null;

function candidateBuckets(): ReadonlyMap<string, readonly KyosanWordCandidate[]> {
  if (CANDIDATE_BUCKETS !== null) return CANDIDATE_BUCKETS;

  // 🔴 차례가 뜻을 갖는다 — 양식 사전 → 자유 기술 사전 → 낱말 사전.
  //    NFKC 로 누른 뒤 같은 글자가 되는 줄이 있으면 **먼저 든 쪽**이 남는다
  //    (`translateKyosanTerm` 의 찾는 차례와 같다).
  const entries: [string, string][] = [
    ...Object.entries(KYOSAN_FORM_TERMS),
    ...Object.entries(KYOSAN_FREE_TEXT_TERMS),
    ...Object.entries(KYOSAN_WORD_TERMS),
  ];

  const byJapanese = new Map<string, string>();
  for (const [japanese, korean] of entries) {
    const key = japanese.normalize("NFKC");
    if (key === "" || byJapanese.has(key)) continue;
    byJapanese.set(key, korean);
  }

  const sorted: KyosanWordCandidate[] = [...byJapanese]
    .map(([japanese, korean]) => ({ japanese, korean }))
    // 🔴 길이 내림차순. 같은 길이는 차례를 건드리지 않는다(겹칠 일이 없다).
    .sort((left, right) => right.japanese.length - left.japanese.length);

  const buckets = new Map<string, KyosanWordCandidate[]>();
  for (const candidate of sorted) {
    const head = candidate.japanese[0];
    const bucket = buckets.get(head);
    if (bucket === undefined) buckets.set(head, [candidate]);
    else bucket.push(candidate);
  }

  CANDIDATE_BUCKETS = buckets;
  return buckets;
}

/** 시험이 후보 수를 재는 데 쓴다. 눌러서 겹친 줄은 한 번만 센다. */
export function kyosanSentenceCandidateCount(): number {
  let count = 0;
  for (const bucket of candidateBuckets().values()) count += bucket.length;
  return count;
}

/** 낱말 사전이 아는 글자 전부. 시험이 값이 한글인지 재는 데 쓴다. */
export function knownKyosanWordTerms(): readonly string[] {
  return Object.keys(KYOSAN_WORD_TERMS);
}

/**
 * 문장을 **왼쪽에서 오른쪽으로 한 번** 훑으며 갈아 끼운다.
 *
 * 🔴 **차례대로 전부 바꾸기(`replaceAll` 을 후보마다)를 쓰지 않는다.** 그렇게 하면
 * 앞서 넣은 한글 속에서 뒤 후보가 또 맞을 수 있다. 한 번 훑으면 바꾼 자리를
 * **건너뛰므로** 그런 일이 없다.
 */
function replaceKyosanWords(text: string): { replaced: string; changed: boolean } {
  const buckets = candidateBuckets();
  let replaced = "";
  let changed = false;
  let index = 0;

  while (index < text.length) {
    const bucket = buckets.get(text[index]);
    let matched: KyosanWordCandidate | null = null;
    if (bucket !== undefined) {
      for (const candidate of bucket) {
        // 묶음이 길이 내림차순이므로 **처음 맞는 것이 가장 긴 것**이다.
        if (text.startsWith(candidate.japanese, index)) {
          matched = candidate;
          break;
        }
      }
    }

    if (matched === null) {
      replaced += text[index];
      index += 1;
      continue;
    }

    replaced += matched.korean;
    index += matched.japanese.length;
    changed = true;
  }

  return { replaced, changed };
}

/**
 * ────────────────────────────────────────────────────────────────────────────
 * 문장 한 줄을 한글로. 못 하면 `null` — 그러면 **원문이 그대로 나간다.**
 * ────────────────────────────────────────────────────────────────────────────
 * 🔴 네 단계다.
 *
 *  1. **먼저 글자 통째로** — `translateKyosanTerm`(양식 사전 → 자유 기술 사전)이
 *     답을 주면 **그것을 그대로 돌려준다.** 사람이 짝지어 둔 정확한 문장 번역이
 *     낱말 조립보다 언제나 낫다. 눌린 열쇠(NFKC + 공백 제거)로 맞는 자리라
 *     앞뒤 공백·반각 가타카나도 여기서 걸린다.
 *  2. 없으면 **낱말 바꿔치기** — 후보는 세 사전(양식 15 + 자유 기술 192 + 낱말)
 *     전부이고, **길이 내림차순**으로 훑어 가장 긴 것이 먼저 걸린다.
 *  3. 🔴 **all-or-nothing** — 바꾼 결과에 일본어가 한 글자라도 남으면 `null` 이다.
 *     왜 있는가: 낱말 방식이 예전에 기각된 까닭이 **반쪽만 바뀐 줄 44.5%** 였다
 *     (`report-terms.ts` 머리말). 반쪽은 일본어보다 나쁘다 — 고객사로 나가는
 *     문서에 「終段AMP 기판의 소손」 같은 글자가 찍히고, 사람이 그것을 고칠
 *     자리도 없다. 그래서 **전부 한글이 됐을 때만** 내보내고, 아니면 원문을
 *     그대로 둔다(사용자가 2026-09-22 에 고른 「사전에 없는 줄은 원문 그대로」).
 *  4. 전부 바뀌었으면 그 글자를 돌려준다.
 *     🔴 단, **한 자리도 안 바뀌었으면 `null`** 이다. 한글·영문뿐인 줄(`교체 없음`
 *     · `AMP IMBALANCE`)은 일본어가 없어 3번을 그냥 지나가는데, 여기서 글자를
 *     돌려주면 화면이 그 줄을 「번역된 줄」로 보고 **같은 글자를 두 번**
 *     보여 준다(`KyosanText` 가 한글 옆에 원문을 붙인다). 빈 글자·공백만 있는
 *     줄도 여기서 `null` 로 떨어진다 — 던지지 않는다.
 */
export function translateKyosanSentence(value: string): string | null {
  // 1. 글자 통째로가 언제나 이긴다.
  const whole = translateKyosanTerm(value);
  if (whole !== null) return whole;

  // 2. 낱말 바꿔치기. 🔴 찾는 쪽과 받는 쪽에 **같은 NFKC** 를 건다(머리말 참조).
  const { replaced, changed } = replaceKyosanWords(value.normalize("NFKC"));

  // 3·4. 반쪽이면 원문, 아무것도 안 바뀌었어도 원문.
  if (!changed) return null;
  if (hasJapaneseCharacter(replaced)) return null;
  return replaced;
}
