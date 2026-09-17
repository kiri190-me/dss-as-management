import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

import { KYOSAN_SYMPTOM_DICTIONARY, translateReportedSymptom } from "./symptom-translation";

/**
 * ============================================================================
 * 신고증상의 일본어 낱말을 한글로 — 여기서 못 박는 것 (2026-09-17)
 * ============================================================================
 *  1. 같은 입력이면 늘 같은 결과다. 미리보기와 실행이 갈리면 안 된다
 *     (server/services/kyosan-intake-import.ts 머리말).
 *  2. 사전에 있는 낱말이 바뀐다 — `FWDノイズ` → `FWD 노이즈`.
 *  3. 🔴 사전에 없는 일본어는 **그대로 남는다.** 지우지도, 비슷한 것으로 바꾸지도 않는다.
 *  4. 🔴 번역이 지나는 칸은 신고증상 하나뿐이다 — 고객사·END-USER 는 고유명사고 종류(種別)는
 *     대조 열쇠다. 서비스 원본을 글자로 읽어 **부르는 자리가 한 곳뿐인지**를 센다.
 *  5. 일본어가 없는 신고증상은 한 글자도 달라지지 않는다.
 * ============================================================================
 */

const repoUrl = new URL("../../../../", import.meta.url);

/** 주석은 지우고 본다 — 주석이 함수 이름을 적어 두고 있어서 그냥 세면 거기 걸린다. */
function codeOf(path: string): string {
  return readFileSync(new URL(path, repoUrl), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");
}

describe("신고증상 번역 — 사전에 있는 낱말", () => {
  test("실제로 들어온 자료가 한글이 된다", () => {
    assert.equal(translateReportedSymptom("FWDノイズ"), "FWD 노이즈");
    assert.equal(translateReportedSymptom("Reflect発生"), "Reflect 발생");
    assert.equal(translateReportedSymptom("FWDノイズ発生"), "FWD 노이즈 발생");
  });

  test("낱말 사이에만 공백 한 칸 — 문장부호와 이미 있는 공백에는 넣지 않는다", () => {
    assert.equal(translateReportedSymptom("ノイズ発生"), "노이즈 발생");
    assert.equal(translateReportedSymptom("(発生)"), "(발생)");
    assert.equal(translateReportedSymptom("ノイズ・発生"), "노이즈・발생");
    assert.equal(translateReportedSymptom("発生 中"), "발생 中");
    assert.equal(translateReportedSymptom("ノイズノイズ"), "노이즈 노이즈");
    assert.equal(translateReportedSymptom("出力低下"), "출력 저하");
  });

  test("부정 꼴이 반쪽만 바뀌어 뜻이 뒤집히지 않는다", () => {
    assert.equal(translateReportedSymptom("発生なし"), "발생 없음");
    assert.equal(translateReportedSymptom("不良無し"), "불량 없음");
  });

  test("🔴 異常 은 「이상」 · 異常なし 는 반쪽이 아니라 「이상 없음」(2026-09-17 사용자 결정)", () => {
    assert.equal(translateReportedSymptom("異常"), "이상");
    assert.equal(translateReportedSymptom("異常発生"), "이상 발생");
    assert.equal(translateReportedSymptom("Reflect異常"), "Reflect 이상");
    // 🔴 여기가 반쪽으로 남으면 뜻이 뒤집힌다 — 「이상なし」는 「이상」으로 읽힌다.
    assert.equal(translateReportedSymptom("異常なし"), "이상 없음");
    assert.equal(translateReportedSymptom("異常無し"), "이상 없음");
    for (const negated of ["異常なし", "異常無し"]) {
      const translated = translateReportedSymptom(negated) ?? "";
      assert.ok(!/[ぁ-ゖァ-ヺ㐀-䶿一-鿿]/.test(translated), `일본어가 남았다: ${translated}`);
    }
  });
});

describe("신고증상 번역 — 건드리지 않는 것", () => {
  test("🔴 사전에 없는 일본어는 그대로 남는다 — 지우지 않는다", () => {
    // 사전에 한 낱말도 없는 글자는 통째로 그대로다.
    for (const untouched of ["マッチャー調整中", "中断：客先待ち", "客先返却理由"]) {
      assert.equal(translateReportedSymptom(untouched), untouched);
    }
    // 아는 낱말만 바뀌고 모르는 낱말(調整)은 일본어로 남아 사람 눈에 띈다.
    const mixed = translateReportedSymptom("Reflect調整発生");
    assert.equal(mixed, "Reflect調整 발생");
    assert.ok(mixed !== null && mixed.includes("調整"), "모르는 일본어가 조용히 사라졌다");
    // 긍정 꼴 `〜あり` 는 아직 사전에 없다 — 앞 낱말만 바뀌지만 뜻은 뒤집히지 않는다.
    assert.equal(translateReportedSymptom("異常あり"), "이상 あり");
  });

  test("일본어가 없는 신고증상은 한 글자도 안 달라진다", () => {
    for (const korean of [
      "출력이 나오지 않음",
      "Bias Fwd Drop 발생",
      "매칭 불량 · 반사파 증가",
      "전원 불량\n팬 소음",
      "RF-3000 S/N 123",
      "",
      "  앞뒤 공백  ",
    ]) {
      assert.equal(translateReportedSymptom(korean), korean);
    }
  });

  test("null 은 null", () => {
    assert.equal(translateReportedSymptom(null), null);
  });
});

describe("신고증상 번역 — 늘 같은 결과", () => {
  const SAMPLES = ["FWDノイズ", "Reflect発生", "ノイズ発生なし", "出力低下", "출력이 나오지 않음", "", "電源不良", "異常なし"];

  test("같은 입력이면 늘 같은 결과다 — 미리보기와 실행이 갈리지 않는다", () => {
    for (const sample of SAMPLES) {
      const once = translateReportedSymptom(sample);
      assert.equal(translateReportedSymptom(sample), once);
      assert.equal(translateReportedSymptom(sample), once, "세 번째도 같아야 한다");
    }
  });

  test("이미 바꾼 글자를 다시 넣어도 그대로다", () => {
    for (const sample of SAMPLES) {
      const once = translateReportedSymptom(sample);
      assert.equal(translateReportedSymptom(once), once);
    }
    // 사전의 한국어 쪽에 일본어가 섞여 있으면 위 성질이 깨진다 — 줄마다 확인한다.
    for (const korean of Object.values(KYOSAN_SYMPTOM_DICTIONARY)) {
      assert.notEqual(korean, "");
      assert.equal(translateReportedSymptom(korean), korean);
    }
  });
});

describe("신고증상 번역 — 지나는 칸은 하나뿐", () => {
  const service = codeOf("src/lib/server/services/kyosan-intake-import.ts");

  test("🔴 번역을 부르는 자리는 한 곳, 넘기는 값은 신고증상뿐이다", () => {
    const calls = service.match(/translateReportedSymptom\(/g) ?? [];
    assert.equal(calls.length, 1, "두 곳에서 따로 부르면 한쪽만 고쳐지는 날이 온다(미리보기 ≠ 실행)");
    assert.match(service, /translateReportedSymptom\(raw\.reportedSymptom\)/);
    // 고객사·END-USER·종류·모델·상태·유무상이 번역을 지나가면 안 된다.
    for (const field of ["customerName", "endUserName", "kindText", "modelName", "statusText", "billingText"]) {
      assert.doesNotMatch(
        service,
        new RegExp(`translateReportedSymptom\\([^)]*${field}`),
        `${field} 은(는) 번역하면 안 되는 칸이다`
      );
    }
  });

  test("계획 하나를 미리보기와 실행이 함께 쓴다 · 원문은 metadata 에 남는다", () => {
    assert.match(service, /reportedSymptom: plan\.reportedSymptom/, "실행은 계획에 담긴 번역 결과를 써야 한다");
    assert.match(service, /sourceReportedSymptom: truncateSourceText\(raw\.reportedSymptom\)/);
  });

  test("🔴 미리보기 화면은 따로 번역하지 않는다 — 계획에 담겨 온 값을 읽기만 한다", () => {
    for (const path of [
      "src/components/excel-imports/KyosanImportPreviewParts.tsx",
      "src/components/excel-imports/kyosan-import-view-model.ts",
      "src/components/excel-imports/KyosanIntakeImportScreen.tsx",
    ]) {
      assert.ok(!codeOf(path).includes("symptom-translation"), `${path} 가 번역을 따로 불렀다 — 미리보기 ≠ 실행`);
    }
  });

  test("🔴 종류 대조(mapKind)가 사는 곳은 번역을 모른다", () => {
    for (const path of [
      "src/lib/domain/kyosan-intake-import/rules.ts",
      "src/lib/domain/kyosan-intake-import/parse.ts",
      "src/lib/domain/kyosan-intake-import/columns.ts",
    ]) {
      assert.ok(!codeOf(path).includes("symptom-translation"), `${path} 가 번역을 물었다 — 대조 열쇠가 흔들린다`);
    }
  });
});
