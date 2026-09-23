import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  hasJapaneseCharacter,
  koreanKyosanDocumentText,
  translateKyosanTerm,
  viewKyosanText,
} from "./report-terms";
import {
  KYOSAN_WORD_TERMS,
  knownKyosanWordTerms,
  kyosanSentenceCandidateCount,
  translateKyosanSentence,
} from "./report-word-terms";

/**
 * ============================================================================
 * 문장 속 낱말 바꿔치기 (2026-09-23)
 * ============================================================================
 * 못 박는 것은 여섯이다.
 *  1. 🔴 **사용자가 잡아낸 줄**에 일본어가 한 글자도 안 남는다.
 *  2. 🔴 **반쪽이 안 나온다** — 일본어가 남으면 `null`(원문 그대로)이다.
 *  3. 🔴 **긴 것이 먼저 걸린다** — `ヒューズ` 가 긴 부품 이름을 반쪽으로 못 만든다.
 *  4. 🔴 **글자 통째로가 이긴다** — 사전에 문장으로 있는 것은 낱말 조립이 아니라
 *     그 문장 번역이 나온다.
 *  5. 🔴 낱말 사전 값이 **전부 한글**이다.
 *  6. 🔴 빈 글자·공백만 있는 글자를 줘도 **던지지 않는다.**
 * ============================================================================
 */

/**
 * 🔴 2026-09-23 사용자가 엑셀 수리 보고서 **미리보기에서 실제로 잡아낸 줄**이다.
 * 세 항목이 한 줄에 이어져 41자를 넘어 실측 고정 표에서 걸러졌고, 그래서 사전이
 * 이 줄을 본 적이 없다.
 *
 * 🔴 **이 줄에는 고객사 이름이 없다** — 순수 기술 문장이라 저장소에 둘 수 있다.
 * 사전이 자라도 이 줄은 **통째로는** 사전에 들어갈 수 없으니(41자 넘음) 낡지
 * 않는다 — 낱말 바꿔치기가 죽으면 곧바로 여기서 깨진다.
 */
const 사용자가_잡아낸_줄 =
  "‐終段AMP入力保護ヒューズの故障確認(右側内4) ‐終段AMPデバイス基板の故障確認(右側内4) ‐終段AMPコンデンサ基板の故障確認(右側内4)";

/** 위 줄이 바뀌어야 하는 글자. 🔴 부품 이름·부위·서술이 모두 한글이다. */
const 사용자가_잡아낸_줄의_한글 =
  "‐종단 AMP 입력 보호 퓨즈 고장 확인(우측 내부4) ‐종단 AMP 디바이스 기판 고장 확인(우측 내부4) ‐종단 AMP 콘덴서 기판 고장 확인(우측 내부4)";

/**
 * 🔴 사전 **어디에도 없어야** 하는 가짜 글자. `report-terms.test.ts` 와 **같은
 * 글자**를 쓴다 — 파일마다 따로 지으면 다음에 또 여기저기서 깨진다.
 *
 * ⚠️ `故障`(고장)은 낱말 사전에 **있다.** 그래서 이 글자는 낱말 바꿔치기가
 * `試験用ダミー고장` 이라는 **반쪽**을 만드는 자리이고, 그것이 `null` 로 떨어지는지가
 * 이 파일에서 가장 중요한 시험이다.
 */
const 사전에_없는_일본어 = "試験用ダミー故障";

describe("🔴 시험용 가짜 글자 — 낱말 사전에도 없어야 한다", () => {
  test("가짜 글자가 낱말 사전 밖에 있다 — 들어갔으면 다른 글자로 바꿔라", () => {
    for (const term of knownKyosanWordTerms()) {
      assert.equal(
        사전에_없는_일본어.includes(term) && term.length >= 3,
        false,
        `${term} 가 가짜 글자를 덮는다 — 시험이 재려던 것을 못 잰다`
      );
    }
    assert.equal(KYOSAN_WORD_TERMS["試験用ダミー故障"], undefined);
    assert.equal(KYOSAN_WORD_TERMS["試験用漢字列"], undefined);
  });
});

describe("🔴 사용자가 잡아낸 줄", () => {
  test("🔴 통째로 바뀌고 일본어가 한 글자도 안 남는다", () => {
    const 바뀐것 = translateKyosanSentence(사용자가_잡아낸_줄);
    assert.notEqual(바뀐것, null, "통째로 못 바꿨다 — 낱말이 모자라다");
    assert.equal(hasJapaneseCharacter(바뀐것!), false);
  });

  test("🔴 바뀐 글자가 무엇인지 못 박는다", () => {
    assert.equal(translateKyosanSentence(사용자가_잡아낸_줄), 사용자가_잡아낸_줄의_한글);
  });

  test("🔴 이 줄은 글자 통째로는 사전에 없다 — 낱말 바꿔치기가 한 일이 맞다", () => {
    assert.equal(translateKyosanTerm(사용자가_잡아낸_줄), null);
  });

  test("🔴 화면도 같은 한글을 보여 준다 — 원문은 그대로 남는다", () => {
    assert.deepEqual(viewKyosanText(사용자가_잡아낸_줄), {
      original: 사용자가_잡아낸_줄,
      korean: 사용자가_잡아낸_줄의_한글,
      isJapaneseOriginal: false,
    });
  });

  test("🔴 문서에도 한글이 찍힌다 — 화면과 문서가 같은 판정을 본다", () => {
    assert.equal(koreanKyosanDocumentText(사용자가_잡아낸_줄), 사용자가_잡아낸_줄의_한글);
  });
});

describe("🔴 반쪽이 안 나온다 (all-or-nothing)", () => {
  test("🔴 일본어가 남는 문장은 `null` — 원문이 그대로 나간다", () => {
    // `故障` 만 바뀌어 `試験用ダミー고장` 이 되는 자리다. 그 반쪽을 내보내지 않는다.
    assert.equal(translateKyosanSentence(사전에_없는_일본어), null);
    assert.equal(koreanKyosanDocumentText(사전에_없는_일본어), 사전에_없는_일본어);
  });

  test("🔴 반쪽이 될 줄은 화면에서 「일본어 원문」 표시를 그대로 받는다", () => {
    assert.deepEqual(viewKyosanText(사전에_없는_일본어), {
      original: 사전에_없는_일본어,
      korean: null,
      isJapaneseOriginal: true,
    });
  });

  test("한 글자라도 남으면 `null` 이다 — 낱말 하나가 모자란 문장", () => {
    // `の故障確認` 은 사전에 있지만 `試験用ダミー` 가 남는다.
    assert.equal(translateKyosanSentence("試験用ダミーの故障確認"), null);
  });

  test("🔴 아무것도 안 바뀐 줄도 `null` 이다 — 한글·영문 줄이 두 번 보이면 안 된다", () => {
    assert.equal(translateKyosanSentence("교체 없음"), null);
    assert.equal(translateKyosanSentence("AMP IMBALANCE"), null);
    assert.equal(translateKyosanSentence("전원부 퓨즈 단선 확인"), null);
  });
});

describe("🔴 긴 것이 먼저 걸린다 (최장 일치)", () => {
  test("🔴 `ヒューズ` 만 바뀐 반쪽이 나오지 않는다", () => {
    const 바뀐것 = translateKyosanSentence("終段AMP入力保護用ヒューズの故障確認");
    assert.equal(바뀐것, "종단 AMP 입력 보호용 퓨즈 고장 확인");
    assert.equal(바뀐것?.includes("終段AMP入力保護用"), false, "앞 조각이 일본어로 남았다");
    assert.notEqual(바뀐것, "終段AMP入力保護用퓨즈 고장 확인");
  });

  test("`用` 이 없는 꼴도 통째로 바뀐다 — 사전과 한 글자 다른 그 자리다", () => {
    assert.equal(translateKyosanSentence("終段AMP入力保護ヒューズの故障確認"), "종단 AMP 입력 보호 퓨즈 고장 확인");
  });

  test("부위도 긴 꼴이 먼저다 — `右側内` 가 `右側` 보다 먼저 걸린다", () => {
    assert.equal(translateKyosanSentence("終段AMPデバイス基板の破損(右側内2)"), "종단 AMP 디바이스 기판 파손(우측 내부2)");
    assert.equal(translateKyosanSentence("終段AMPデバイス基板の破損(右側2)"), "종단 AMP 디바이스 기판 파손(우측2)");
  });

  test("🔴 `の` 가 붙은 서술은 앞말과 붙지 않는다 — 값 앞에 공백 하나가 있다", () => {
    assert.equal(translateKyosanSentence("デバイス基板の絶縁抵抗値不良"), "디바이스 기판 절연 저항값 불량");
  });
});

describe("🔴 글자 통째로가 이긴다", () => {
  test("사전에 문장으로 있는 줄은 그 문장 번역이 나온다", () => {
    assert.equal(translateKyosanSentence("交換無し"), "교체 없음");
    assert.equal(translateKyosanSentence("終段AMP基板（AMP-DEH基板）"), "종단 AMP 기판(AMP-DEH 기판)");
    assert.equal(translateKyosanSentence("TUNEバリコンの故障確認"), "TUNE 바리콘 고장 확인");
  });

  test("🔴 낱말 조립과 **다른** 답이 나오는 줄에서 통째로가 이긴다", () => {
    /**
     * 자유 기술 사전의 `左側外の終段AMPデバイス基板基板故障確認` 은 **원문 오타**
     * (`基板基板`)를 한글에서 한 번만 적는다. 낱말 조립은 그 오타를 그대로 옮기고
     * (`기판기판`), 게다가 `の` 를 못 바꿔 **`null`** 이 된다.
     * 통째로가 먼저 걸리므로 사람이 손본 답이 나온다.
     */
    assert.equal(
      translateKyosanSentence("左側外の終段AMPデバイス基板基板故障確認"),
      "좌측 바깥 종단 AMP 디바이스 기판 고장 확인"
    );
  });

  test("눌린 열쇠(NFKC + 공백 제거)로 맞는 자리도 통째로가 먼저다", () => {
    // 앞뒤 공백이 붙어도 통째로 맞는다 — 낱말 바꿔치기에 내려오지 않는다.
    assert.equal(translateKyosanSentence(" 現品引取 "), "현품 인수");
    assert.equal(translateKyosanSentence("終段AMP入力保護用ﾋｭｰｽﾞ"), "종단 AMP 입력 보호용 퓨즈");
  });
});

/**
 * 🔴 2026-09-23 **사용 부품 표 실측**에서 나온 줄. 이식된 7줄 가운데 사전이 못 읽던
 * 유일한 줄이 `通信基板`(접수 `D210102`)이었고, 그래서 `通信基板` 과 낱말 `通信` 을
 * 함께 더했다. 이 시험은 그 둘 중 하나가 빠지는 날 곧바로 깨진다.
 */
describe("🔴 사용 부품 표에서 나온 줄 (2026-09-23 실측)", () => {
  /**
   * 🔴 `通信` 만 있으면 `통신` + `기판` 이 조립되어 **`통신기판`**(붙음)이 나온다.
   * 띄어쓰기를 맞추려고 긴 짝 `通信基板` 을 함께 두었고, 후보가 길이 내림차순이라
   * 4자인 그것이 2자인 `通信` 보다 먼저 걸린다. 여기가 그 최장 일치를 재는 자리다.
   */
  test("🔴 `通信基板` → `통신 기판` — 긴 짝이 낱말보다 먼저 걸린다", () => {
    assert.equal(translateKyosanSentence("通信基板"), "통신 기판");
    assert.notEqual(translateKyosanSentence("通信基板"), "통신기판", "낱말 조립이 긴 짝을 이겼다");
  });

  test("🔴 `通信` 홀로는 `통신` — 꼬리 공백이 붙지 않는다", () => {
    // 낱말 값에 공백을 두지 않는 까닭이다. 사용 부품 칸의 글자가 통계의 묶는 열쇠라
    // `"통신 "` 과 `"통신"` 이 갈리면 같은 부품이 두 조각이 된다.
    assert.equal(translateKyosanSentence("通信"), "통신");
  });

  test("🔴 통째 사전의 `通信異常` 은 그대로다 — 긴 것이 먼저 걸린다", () => {
    // 낱말 `通信` 이 `通信異常` 을 반쪽(`통신異常`)으로 만들지 않는다.
    assert.equal(translateKyosanSentence("通信異常"), "통신 이상");
  });

  test("사용 부품 표의 나머지 다섯 줄은 예전부터 사전이 알던 것이다", () => {
    assert.equal(translateKyosanSentence("終段AMP入力保護用ヒューズ"), "종단 AMP 입력 보호용 퓨즈");
    assert.equal(translateKyosanSentence("終段AMP基板（AMP-DEH基板）"), "종단 AMP 기판(AMP-DEH 기판)");
    assert.equal(translateKyosanSentence("終段AMPコンデンサ基板（AMP-DEH用）"), "종단 AMP 콘덴서 기판(AMP-DEH용)");
    assert.equal(translateKyosanSentence("終段AMPゲート基板(AMP-DEH-G基板)"), "종단 AMP 게이트 기판(AMP-DEH-G 기판)");
    assert.equal(translateKyosanSentence("スプリッタ基板"), "스플리터 기판");
  });
});

describe("🔴 낱말 사전 자체", () => {
  test("🔴 값이 모두 한글이다 — 옮기다 만 줄이 없다", () => {
    for (const [japanese, korean] of Object.entries(KYOSAN_WORD_TERMS)) {
      assert.equal(
        hasJapaneseCharacter(korean),
        false,
        `${japanese} → ${korean} 에 가나·한자가 남았다`
      );
      assert.ok(korean.trim().length > 0, `${japanese} 의 값이 비어 있다`);
    }
  });

  test("열쇠가 비어 있지 않다", () => {
    for (const term of knownKyosanWordTerms()) assert.ok(term.length > 0);
  });

  test("🔴 후보는 세 사전을 합친 것이다 — 낱말 사전만 보지 않는다", () => {
    // 양식 15 + 자유 기술 192 + 낱말 사전. 눌러서 겹친 줄은 한 번만 센다.
    assert.ok(
      kyosanSentenceCandidateCount() > knownKyosanWordTerms().length + 190,
      `후보가 ${kyosanSentenceCandidateCount()}개뿐이다 — 사전 하나가 빠졌다`
    );
  });
});

describe("🔴 빈 글자·공백만 있는 글자", () => {
  test("던지지 않는다 — `null` 로 떨어진다", () => {
    assert.equal(translateKyosanSentence(""), null);
    assert.equal(translateKyosanSentence(" "), null);
    assert.equal(translateKyosanSentence("   \t "), null);
  });

  test("문서 쪽도 그대로 지나간다", () => {
    assert.equal(koreanKyosanDocumentText(""), "");
    assert.equal(koreanKyosanDocumentText("   "), "   ");
  });
});
