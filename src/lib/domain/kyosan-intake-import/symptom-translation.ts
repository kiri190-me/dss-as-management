/**
 * ============================================================================
 * 신고증상(L열 `客先返却理由`)의 일본어 낱말을 한글로 — 사전 하나로 (2026-09-17)
 * ============================================================================
 * 교산 인수품 리스트의 신고증상은 긴 문장이 아니라 **짧은 기술 용어**다. 실제로 들어온
 * 것은 `FWDノイズ` · `Reflect発生` — 영문 용어에 일본어 낱말이 붙은 꼴이라 **낱말 사전**으로
 * 푼다.
 *
 * 🔴 번역 API 를 부르지 않는다. 신고증상은 고객사가 적어 보낸 자료라 바깥으로 내보내지
 *    않는다(CLAUDE.md 보안 규칙). 여기 있는 것은 네트워크도 시계도 난수도 쓰지 않는
 *    **순수 함수**다 — 미리보기와 실행이 같은 파일에서 반드시 같은 값을 내야 하기
 *    때문이다(server/services/kyosan-intake-import.ts 머리말: "미리보기가 무엇을 보여
 *    줬든, 실행은 매번 올린 파일을 다시 읽고 다시 대조한다").
 *
 * 🔴 번역하는 칸은 **신고증상 하나뿐이다.**
 *    · 고객사·END-USER 는 고유명사다. 회사 이름을 번역하면 안 된다.
 *    · 종류(`種別`)는 rules.ts 의 mapKind 가 **대조 열쇠**로 쓴다 — 바꾸면 매칭이 깨진다.
 *    · 모델·L/N·S/N·인수번호·보고서 번호는 코드·번호다.
 *    · 상태·유/무상은 이미 우리 값으로 옮겨지고 원문이 metadata 에 증거로 남는다.
 *    이 함수를 부르는 자리는 서비스에 **한 곳뿐이다**(symptom-translation.test.ts 가 센다).
 *
 * ── 사전에 낱말을 더하는 법 ───────────────────────────────────────────────
 *  1. **실제로 들어온 자료에서 본 낱말만** 넣는다. 짐작으로 넣지 않는다 — 틀린 번역이
 *     고객 기록에 남는 것은 안 바꾸느니만 못하다.
 *  2. DICTIONARY 에 한 줄 더하고 그 옆에 **어디서 봤는지**를 적는다. 근거 없는 줄은 뺀다.
 *  3. 같은 자리에서 여럿이 맞으면 **긴 낱말이 이긴다**(길이 내림차순). `異常なし` 를 넣으면
 *     `異常` 보다 먼저 맞는다.
 *  4. 🔴 부정이 붙는 꼴(`〜なし` · `〜ない`)을 앞 낱말만 넣어 두지 마라. `異常なし` 가
 *     `이상なし` 가 되면 뜻이 뒤집혀 보인다. 그래서 `なし` 자체를 사전에 두었고, 새 부정
 *     꼴이 나오면 **통째로 한 줄**로 넣는다.
 *
 * ── 사전에 없는 글자는 그대로 둔다 ────────────────────────────────────────
 * 억지로 바꾸거나 지우지 않는다. 일본어가 남아 있으면 사람이 보고 사전에 더하면 된다 —
 * 조용히 뭉개는 쪽이 훨씬 나쁘다.
 * ============================================================================
 */

/**
 * 일본어 낱말 → 한국어. 줄마다 **근거**를 적는다(위 「더하는 법」 2).
 *
 * 지금 씨앗은 ① 실제로 가져온 자료에서 본 두 낱말과 ② 같은 한자를 그대로 읽는, 뜻이
 * 흔들리지 않는 기술 낱말 몇 개다. `異常` 처럼 한국어 쪽이 동음이의(異常/以上)라 짧은
 * 조각에서 헷갈릴 수 있는 낱말은 **일부러 넣지 않았다** — 사람이 보고 넣는 편이 낫다.
 */
export const KYOSAN_SYMPTOM_DICTIONARY: Readonly<Record<string, string>> = Object.freeze({
  // ── 실제로 들어온 신고증상에서 확인 ────────────────────────────────────
  /** `FWDノイズ` — 2026-09-17 개발 DB 에 들어와 있던 가져오기 건. */
  "ノイズ": "노이즈",
  /** `Reflect発生` — 같은 자료. 저장소의 한국어 신고증상도 같은 꼴이다("Bias Fwd Drop 발생", domain/intake-mail-body.ts). */
  "発生": "발생",

  // ── 같은 한자를 그대로 읽는 낱말. 한국어 쪽은 이 저장소의 신고증상에 이미 쓰인다 ──
  /** 不良 = 불량. "전원 불량"(kyosan-intake-import/parse.test.ts) · "연결 불량 신고"(domain/mock-data.ts). */
  "不良": "불량",
  /** 故障 = 고장. "긴급 고장 신고"(domain/mock-data.ts). */
  "故障": "고장",
  /** 電源 = 전원. "전원 인가 불가"(domain/product-model-breakdown.test.ts) · "전원 불량". */
  "電源": "전원",
  /** 出力 = 출력. "출력 저하"(domain/product-model-breakdown.test.ts) · 가져오기 시험 자료의 L열 "출력이 나오지 않음". */
  "出力": "출력",
  /** 低下 = 저하. "출력 저하" · "성능 저하 신고"(domain/mock-data.ts). */
  "低下": "저하",

  // ── 부정 꼴이 반쪽만 번역되는 것을 막는 낱말(위 「더하는 법」 4) ─────────
  /** `発生なし` 가 `발생なし` 로 남지 않게. なし = 없음. */
  "なし": "없음",
  /** 같은 말의 한자 표기. */
  "無し": "없음",
});

/**
 * 사전을 훑는 순서 — **긴 낱말 먼저**. 길이가 같으면 코드포인트 순으로 못 박는다(로캘에
 * 기대면 서버마다 순서가 달라진다). 같은 입력에 늘 같은 결과를 내려면 이 순서가 고정이어야
 * 한다.
 */
const ENTRIES: readonly (readonly [string, string])[] = Object.entries(KYOSAN_SYMPTOM_DICTIONARY)
  .sort(([a], [b]) => b.length - a.length || (a < b ? -1 : a > b ? 1 : 0));

/**
 * 한국어 낱말과 맞붙으면 읽기 힘든 글자 — 영문·숫자(전각 포함) · 한글 · 가나 · 한자.
 * 이런 글자가 바로 옆에 있으면 사이에 공백 한 칸을 넣는다: `FWDノイズ` → `FWD 노이즈`.
 * 괄호·쉼표·마침표 같은 문장부호와 이미 있는 공백에는 넣지 않는다(`(発生)` → `(발생)`).
 * 가나 범위에서 `・`(U+30FB)는 구분 기호라 뺐다.
 */
const WORD_CHARACTER =
  /[0-9A-Za-z０-９Ａ-Ｚａ-ｚ가-힣ぁ-ゖァ-ヺーｦ-ﾝ㐀-䶿一-鿿]/;

function needsSpace(char: string | undefined): boolean {
  return char !== undefined && WORD_CHARACTER.test(char);
}

/**
 * 신고증상의 일본어 낱말을 한글로 바꾼다. **사전에 없는 글자는 손대지 않는다** — 지우지도,
 * 비슷한 것으로 바꾸지도 않는다.
 *
 * 같은 입력이면 늘 같은 결과다(미리보기 = 실행). 이미 바꾼 글자를 다시 넣어도 그대로다 —
 * 한 번 바뀐 자리에는 일본어가 남지 않기 때문이다.
 *
 * null 은 null, 빈 글자는 빈 글자. 앞뒤 공백을 다듬지 않는다(그건 읽개가 이미 했다).
 */
export function translateReportedSymptom(value: string | null): string | null {
  if (value === null) return null;

  let result = "";
  let index = 0;
  while (index < value.length) {
    const entry = matchAt(value, index);
    if (entry === null) {
      result += value[index];
      index += 1;
      continue;
    }
    const [japanese, korean] = entry;
    if (needsSpace(result[result.length - 1])) result += " ";
    result += korean;
    index += japanese.length;
    if (needsSpace(value[index])) result += " ";
  }
  return result;
}

/** 이 자리에서 시작하는 가장 긴 사전 낱말. 없으면 null. */
function matchAt(value: string, index: number): (readonly [string, string]) | null {
  for (const entry of ENTRIES) {
    if (value.startsWith(entry[0], index)) return entry;
  }
  return null;
}
