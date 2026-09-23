import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { kyosanCauseKey } from "./report-causes";
import {
  KYOSAN_FREE_TEXT_TERMS,
  knownKyosanFreeTextTerms,
  translateKyosanFreeTextTerm,
} from "./report-free-text-terms";
import {
  KYOSAN_FREE_TEXT_LINE_COUNTS,
  kyosanFreeTextTotalLines,
} from "./report-free-text-lines.fixture";
import {
  hasJapaneseCharacter,
  knownKyosanFormTerms,
  koreanKyosanDocumentText,
  translateKyosanFormTerm,
  translateKyosanTerm,
} from "./report-terms";

/**
 * ============================================================================
 * 자유 기술 사전 — **열린 목록**이고 근거는 실측 빈도다
 * ============================================================================
 * `report-terms.test.ts` 는 「우리 양식의 칸과 짝이 맞는가」를 본다. 여기서 보는
 * 것은 다르다 — **얼마나 덮었나**와 **무엇을 넣지 않기로 했나**다.
 *
 * 못 박는 것은 다섯이다.
 *  1. 🔴 두 사전이 **겹치지 않는다**(같은 글자가 두 쪽에 있으면 양식 쪽이 이긴다).
 *  2. 🔴 넣은 글자가 **40자를 넘지 않는다.** ⚠️ 2026-09-22 판은 여기에 「넣은 것은
 *     **부품·부위 이름**뿐이다」라고 적어 두었지만 **사용자 결정으로 뒤집혔다**
 *     (2026-09-23) — 문서에 일본어가 한 줄도 안 보이게 하려고 서술 문장까지 전부
 *     넣었다(사전 파일 머리말의 '위 1번과 2번이 뒤집혔다'). 남은 울타리는 **40자**
 *     하나뿐이고, 그것이 고객사명·모델명이 박힌 긴 문장을 막는다.
 *  3. 🔴 여전히 **글자 통째로**만 맞는다(반쪽 번역 금지).
 *  4. 🔴 값은 모두 한글이다 — 옮기다 만 줄이 없다.
 *  5. 🔴 **덮는 비율에 하한선이 있다.** 조각마다 이 숫자만 올린다.
 * ============================================================================
 */

describe("자유 기술 사전", () => {
  /**
   * 192 = 앞의 열(2026-09-22, 부품·부위 이름 무리의 빈도 상위) + 182
   * (2026-09-23, 고정 표의 나머지 전부).
   *
   * 🔴 고정 표는 196문장이고 그 가운데 넷(`交換無し` · `その他` · `再現せず` ·
   * `取扱不備`)은 **양식 사전**에 있어 여기 넣지 않았다 — 196 − 4 = 192 다.
   */
  test("192줄이다 — 고정 표 196문장에서 양식 사전과 겹치는 넷을 뺀 수", () => {
    assert.equal(knownKyosanFreeTextTerms().length, 192);
  });

  test("🔴 양식 사전과 한 글자도 겹치지 않는다 — `交換無し` 를 두 번 적지 않았다", () => {
    const formKeys = new Set(knownKyosanFormTerms().map(kyosanCauseKey));
    for (const term of knownKyosanFreeTextTerms()) {
      assert.equal(
        formKeys.has(kyosanCauseKey(term)),
        false,
        `${term} 가 양식 사전에도 있다 — 둘 중 하나를 지워야 한다`
      );
    }
  });

  test("🔴 겹치더라도 양식 사전이 이긴다 — 찾는 차례가 뜻을 갖는다", () => {
    // `交換無し` 는 양식 쪽에 있다. 합친 문이 그 값을 돌려줘야 한다.
    assert.equal(translateKyosanFormTerm("交換無し"), "교체 없음");
    assert.equal(translateKyosanFreeTextTerm("交換無し"), null);
    assert.equal(translateKyosanTerm("交換無し"), "교체 없음");
  });

  /**
   * ⚠️ 이 시험의 이름은 2026-09-22 에 「긴 서술 문장이 섞여 있지 않다」였다.
   * **사용자 결정으로 뒤집혔다**(2026-09-23) — 서술 문장은 이제 **일부러** 넣는다
   * (`焼損・煙・異臭発生` · `引取点検にて問題無い事を確認しました。`).
   *
   * 🔴 그래도 **단언은 그대로 남긴다.** 재는 것이 「서술이냐 아니냐」에서
   * 「41자를 넘느냐」로 좁아졌을 뿐이고, 41자 이상 무리에는 고객사명 · 모델명 ·
   * 기계번호가 박혀 있어 저장소에 들어오면 안 된다. 고정 표
   * (`report-free-text-lines.fixture.ts`)도 같은 40자로 걸러져 있으니, 거기서
   * 옮겨 담는 한 이 시험은 통과한다 — 깨지는 날은 **손으로 긴 줄을 더한 날**이다.
   */
  test("🔴 40자를 넘는 줄이 없다 — 고객사명·모델명이 박힌 무리를 막는 울타리다", () => {
    for (const term of knownKyosanFreeTextTerms()) {
      assert.ok(term.length <= 40, `${term} 가 ${term.length}자다 — 41자 이상은 넣지 않는다`);
    }
  });

  test("🔴 값은 모두 한글이다 — 일본어가 남은 줄이 없다", () => {
    for (const [japanese, korean] of Object.entries(KYOSAN_FREE_TEXT_TERMS)) {
      assert.equal(
        hasJapaneseCharacter(korean),
        false,
        `${japanese} → ${korean} 에 가나·한자가 남았다`
      );
    }
  });

  test("표기 변이는 눌린 열쇠로 모인다 — 전각/반각 괄호·반각 가타카나·영문 뒤 공백", () => {
    // 🔴 사전에는 한 꼴만 적혀 있다. 아래 네 꼴이 전부 같은 값으로 맞아야 한다.
    assert.equal(translateKyosanFreeTextTerm("終段AMP基板（AMP-DEH基板）"), "종단 AMP 기판(AMP-DEH 기판)");
    assert.equal(translateKyosanFreeTextTerm("終段AMP基板(AMP-DEH基板)"), "종단 AMP 기판(AMP-DEH 기판)");
    assert.equal(translateKyosanFreeTextTerm("終段AMP入力保護用ﾋｭｰｽﾞ"), "종단 AMP 입력 보호용 퓨즈");
    assert.equal(translateKyosanFreeTextTerm("TUNE バリコン"), "TUNE 바리콘");
  });

  test("🔴 문장 속 조각은 바꾸지 않는다 — `ヒューズ` 가 긴 부품 이름을 반쪽으로 만들지 않는다", () => {
    // 둘 다 사전에 있고 한쪽이 다른 쪽의 뒤 조각이다. 통째로 견주므로 서로 간섭이 없다.
    assert.equal(translateKyosanFreeTextTerm("ヒューズ"), "퓨즈");
    assert.equal(
      translateKyosanFreeTextTerm("終段AMP入力保護用ヒューズ"),
      "종단 AMP 입력 보호용 퓨즈"
    );
    // 사전에 없는 조합은 손대지 않는다 — 「반쪽 번역」이 되지 않는다.
    assert.equal(translateKyosanFreeTextTerm("中段AMP入力保護用ヒューズ"), null);
    assert.equal(translateKyosanFreeTextTerm("ヒューズ交換"), null);
  });

  test("🔴 문서에도 한글만 나간다 — 화면과 같은 사전을 본다", () => {
    assert.equal(koreanKyosanDocumentText("TUNEバリコン"), "TUNE 바리콘");
    assert.equal(
      koreanKyosanDocumentText("終段AMP基板（AMP-DEH基板）\nスプリッタ基板\n中段AMP基板"),
      "종단 AMP 기판(AMP-DEH 기판)\n스플리터 기판\n中段AMP基板"
    );
  });
});

/**
 * ============================================================================
 * 🔴 사전이 덮는 비율 — **올라가기만 하는 자**
 * ============================================================================
 * 분모는 저장소 안의 고정 표(`report-free-text-lines.fixture.ts`)다. 연락서 469장의
 * 자유 기술 줄에서 **고객 정보 칸을 빼고**, **파일 2장 이상**에 나온 문장만 남긴
 * 것이다. 그 표를 손으로 고치지 않는 한 이 비율은 **사전이 늘 때만** 올라간다.
 *
 * 🔴 하한선을 **올려 적는 것이 이 조각의 마무리**다. 다음 사람이 사전을 늘리면
 * 여기 숫자도 함께 올린다 — 안 올리면 다음 조각이 아무것도 안 해도 통과한다.
 * ============================================================================
 */
describe("사전이 덮는 비율", () => {
  /** 사전이 아는 문장이 차지하는 줄 수. 🔴 셈은 시험이 그때그때 한다. */
  function coveredLines(): number {
    return KYOSAN_FREE_TEXT_LINE_COUNTS.filter(([text]) => translateKyosanTerm(text) !== null).reduce(
      (sum, [, lines]) => sum + lines,
      0
    );
  }

  test("고정 표가 비어 있지 않다 — 분모가 0이면 비율이 뜻을 잃는다", () => {
    assert.ok(KYOSAN_FREE_TEXT_LINE_COUNTS.length >= 100, "표가 너무 작다");
    assert.equal(kyosanFreeTextTotalLines(), 3227);
  });

  test("🔴 같은 문장이 표에 두 번 들어 있지 않다 — 들어 있으면 분모가 부풀려진다", () => {
    const keys = KYOSAN_FREE_TEXT_LINE_COUNTS.map(([text]) => kyosanCauseKey(text));
    assert.equal(new Set(keys).size, keys.length, "눌린 열쇠가 겹치는 줄이 있다");
  });

  test("🔴 줄 수는 모두 2 이상이다 — 파일 2장 이상만 남겼다는 증거", () => {
    for (const [, lines] of KYOSAN_FREE_TEXT_LINE_COUNTS) assert.ok(lines >= 2, `${lines}줄이 있다`);
  });

  /**
   * 🔴 **하한선이 천장에 닿았다.** 2026-09-22 판은 47.54%(3,227줄 중 1,534줄)에
   * 45% 하한선이었다. 2026-09-23 에 사전을 192줄로 늘려 고정 표를 **전부** 덮었다
   * — 3,227줄 중 3,227줄, **100%** 다.
   *
   * ⚠️ 그래서 단언을 `>= 하한선` 에서 **`=== 1`** 로 바꿨다. 약하게 만든 것이
   * 아니라 **가장 센 자리로 못 박은 것**이다 — 한 줄이라도 사전에서 빠지면 곧바로
   * 깨진다. 2026-09-22 판에는 「1.0 이 되는 것은 표가 망가졌다는 뜻」이라는 단언이
   * 있었는데, 그것은 「사전은 표의 일부만 덮는다」를 전제한 말이라 이번 결정으로
   * 전제가 사라졌다.
   *
   * 🔴 **100% 가 「연락서에 일본어가 안 남는다」는 뜻은 아니다.** 분모는 고정
   * 표이고, 그 표는 40자 이하 · 파일 2장 이상으로 걸러져 있다. 41자를 넘는 긴
   * 문장(실측 약 265가지)은 아직 아무도 덮지 않았다 — 사전 파일 머리말의
   * '아직 닿지 않는 곳이 남아 있다'.
   *
   * ── 고정 표를 다시 읽는 날 ──────────────────────────────────────────
   * 연락서를 다시 읽어 표에 새 문장이 들어오면 이 시험이 깨진다. **그때는 이
   * 숫자를 낮추지 말고 사전에 그 문장을 더해라.** 낮추는 순간 「전부 덮는다」는
   * 약속이 조용히 사라진다.
   */
  test("🔴 고정 표를 100% 덮는다 — 한 줄도 일본어로 나가지 않는다", () => {
    const coverage = coveredLines() / kyosanFreeTextTotalLines();
    assert.equal(
      coverage,
      1,
      `덮는 비율이 ${(coverage * 100).toFixed(2)}% 다 — 사전에 없는 문장이 표에 남아 있다`
    );
    assert.equal(coveredLines(), 3227);
  });

  test("🔴 자유 기술 사전 192줄이 실제로 비율을 올렸다 — 양식 사전만으로는 274줄뿐이다", () => {
    const formOnly = KYOSAN_FREE_TEXT_LINE_COUNTS.filter(
      ([text]) => translateKyosanFormTerm(text) !== null
    ).reduce((sum, [, lines]) => sum + lines, 0);
    const both = coveredLines();
    assert.ok(
      both > formOnly,
      "자유 기술 사전이 덮는 줄이 하나도 없다 — 사전이 표와 어긋났다"
    );
    /**
     * 자유 기술 사전 **192줄**이 이 표에서 덮는 줄은 **2,953줄**이다
     * (3,227 − 274). 2026-09-22 판은 열 줄로 1,260줄이었다.
     *
     * 🔴 빠진 274줄은 **양식 사전**의 몫이다 — 고정 표 196문장 가운데 넷이
     * 그쪽에 있다: `交換無し` 214 · `その他` 38 · `再現せず` 20 · `取扱不備` 2.
     * 두 사전이 겹치지 않는다는 위 시험과 짝이 맞는 수다.
     *
     * ⚠️ 사전 파일 머리말의 줄 수와 이 표의 줄 수가 다른 자리가 있다 — 이 표는
     * 「파일 2장 이상」으로 한 번 더 걸러져 있기 때문이다.
     * `スイッチング電源(+24V)` 가 고장 칸·부위 칸에 각각 **한 장씩만** 나와서 그
     * 두 줄이 표에 들어오지 않았다(63 → 61). 어긋남이 아니라 **걸름이 하나 더
     * 걸려 있다는 뜻**이다.
     */
    assert.equal(formOnly, 274);
    assert.equal(both - formOnly, 2953);
  });
});
