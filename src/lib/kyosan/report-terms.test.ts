import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  SERVICE_REPORT_CAUSE_LABELS,
  SERVICE_REPORT_DISPOSITION_LABELS,
} from "@/lib/xlsx/service-report-template";

import { mapKyosanCauses, knownKyosanCauseMarks } from "./report-causes";
import {
  KYOSAN_FORM_TERMS,
  hasJapaneseCharacter,
  knownKyosanFormTerms,
  translateKyosanFormTerm,
  viewKyosanText,
} from "./report-terms";

/**
 * ============================================================================
 * 연락서 고정 보기 → 한글 (조각 S5)
 * ============================================================================
 * 못 박는 것은 넷이다.
 *  1. 🔴 **우리 양식의 한글 이름과 어긋나지 않는다.** 사전을 베껴 적어 둔 것이
 *     아니라 `service-report-template.ts` 의 같은 칸을 가리킨다는 증거다.
 *  2. 🔴 **글자 통째로만 맞는다** — 문장 속 조각은 바꾸지 않는다(반쪽 번역 금지).
 *  3. 🔴 **원문을 버리지 않는다** — `viewKyosanText` 는 언제나 원문을 돌려준다.
 *  4. 사전에 없는 일본어는 「일본어 원문」으로 표시된다.
 * ============================================================================
 */

describe("연락서 고정 보기 사전", () => {
  test("열넷이다 — 原因 열 · 処置 넷 · 상태값 하나", () => {
    assert.equal(knownKyosanFormTerms().length, 15);
  });

  test("🔴 原因 열 가지가 우리 양식의 한글 이름과 한 글자도 다르지 않다", () => {
    // 연락서 글자 → (report-causes 가 정한) 우리 원인 → 우리 양식의 한글 이름.
    // 세 곳이 한 줄로 이어지므로 어느 하나가 바뀌면 여기서 깨진다.
    for (const mark of knownKyosanCauseMarks()) {
      const mapped = mapKyosanCauses([mark]);
      assert.equal(mapped.unmapped.length, 0, `${mark} 가 원인 사전에서 빠졌다`);
      const cause = mapped.causes[0];
      assert.equal(
        translateKyosanFormTerm(mark),
        SERVICE_REPORT_CAUSE_LABELS[cause],
        `${mark} 의 한글 이름이 우리 양식과 다르다`
      );
    }
  });

  test("🔴 処置 네 가지가 우리 양식의 조치 네 칸과 짝이 맞는다", () => {
    assert.deepEqual(
      {
        現地修理: translateKyosanFormTerm("現地修理"),
        現品引取: translateKyosanFormTerm("現品引取"),
        代品納入: translateKyosanFormTerm("代品納入"),
        処置完了: translateKyosanFormTerm("処置完了"),
      },
      {
        現地修理: SERVICE_REPORT_DISPOSITION_LABELS.onSiteRepair,
        現品引取: SERVICE_REPORT_DISPOSITION_LABELS.goodsReceipt,
        代品納入: SERVICE_REPORT_DISPOSITION_LABELS.replacementDelivery,
        処置完了: SERVICE_REPORT_DISPOSITION_LABELS.completion,
      }
    );
  });

  test("교체 부품 칸의 상태값 — 부품 이름이 아니라 「교체 없음」이다", () => {
    assert.equal(translateKyosanFormTerm("交換無し"), "교체 없음");
  });

  test("전각/반각·공백이 달라도 같은 보기로 맞는다(원인 쪽과 같은 눌림)", () => {
    assert.equal(translateKyosanFormTerm("検査ﾐｽ"), "검사 미스");
    assert.equal(translateKyosanFormTerm("その 他"), "기타");
    assert.equal(translateKyosanFormTerm(" 現品引取 "), "현품 인수");
  });

  test("🔴 문장 속 조각은 바꾸지 않는다 — 통째로 같을 때만 맞는다", () => {
    // 「반쪽 번역」을 막는 자리다. 자유 기술에 `その他` 가 섞여 있어도 손대지 않는다.
    assert.equal(translateKyosanFormTerm("その他の不具合"), null);
    assert.equal(translateKyosanFormTerm("部品不良により交換"), null);
    assert.equal(translateKyosanFormTerm("交換無しで返却"), null);
  });

  test("사전에 없는 글자는 null — 지우지도 비슷한 것으로 바꾸지도 않는다", () => {
    assert.equal(translateKyosanFormTerm("焼損・煙・異臭発生"), null);
    assert.equal(translateKyosanFormTerm(""), null);
  });
});

describe("화면 한 줄이 보여 줄 것", () => {
  test("🔴 고정 보기 — 한글과 원문을 둘 다 준다(원문을 버리지 않는다)", () => {
    assert.deepEqual(viewKyosanText("現品引取"), {
      original: "現品引取",
      korean: "현품 인수",
      isJapaneseOriginal: false,
    });
  });

  test("🔴 일본어 자유 기술 — 원문 그대로 두고 「일본어 원문」으로 표시한다", () => {
    assert.deepEqual(viewKyosanText("焼損・煙・異臭発生"), {
      original: "焼損・煙・異臭発生",
      korean: null,
      isJapaneseOriginal: true,
    });
  });

  test("가나가 없고 한자만 있는 줄도 일본어로 본다(実測: 出力異常 같은 꼴이 흔하다)", () => {
    assert.equal(viewKyosanText("出力異常").isJapaneseOriginal, true);
  });

  test("영문·숫자만인 줄은 원문 표시를 붙이지 않는다", () => {
    assert.deepEqual(viewKyosanText("AMP IMBALANCE"), {
      original: "AMP IMBALANCE",
      korean: null,
      isJapaneseOriginal: false,
    });
    assert.equal(hasJapaneseCharacter("FWD DROP"), false);
  });

  test("이미 한글인 줄도 그대로 둔다", () => {
    assert.deepEqual(viewKyosanText("교체 없음"), {
      original: "교체 없음",
      korean: null,
      isJapaneseOriginal: false,
    });
  });

  test("사전의 값은 모두 한글이다 — 일본어가 남은 줄이 없다", () => {
    for (const [japanese, korean] of Object.entries(KYOSAN_FORM_TERMS)) {
      assert.equal(hasJapaneseCharacter(korean), false, `${japanese} → ${korean} 에 일본어가 남았다`);
    }
  });
});
