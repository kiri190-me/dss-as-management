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
  isKyosanHeadingLine,
  knownKyosanFormTerms,
  translateKyosanFormTerm,
  viewKyosanMemoLines,
  viewKyosanText,
  type KyosanMemoLine,
} from "./report-terms";
import {
  KYOSAN_IMPORT_MARK,
  buildKyosanDetailValues,
  kyosanOriginHeading,
} from "./report-detail-values";
import type { KyosanImportPlan } from "./report-preview";

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

// ══════════════════════════════════════════════ 여러 줄 덩어리 (2026-09-22)

/**
 * ============================================================================
 * 작업 기록 `memo` 한 덩어리를 줄로 갈라 보기 (상세 화면)
 * ============================================================================
 * 이식은 연락서 여러 항목을 **한 덩어리**로 묶어 작업 기록에 넣는다. 상세 화면은
 * 그 덩어리를 그린다 — 통째로 사전에 태우면 언제나 `korean === null` 이라
 * 아무것도 한글이 되지 않는다. 못 박는 것은 다섯이다.
 *
 *  1. 🔴 머리글 줄(`[교산 연락서]` · `[사내 확인 결과]`)은 **번역되지 않는다.**
 *  2. 고정 보기 줄은 한글과 원문이 **둘 다** 나온다.
 *  3. 사전에 없는 일본어 줄은 **원문 그대로** + 「일본어 원문」 표시.
 *  4. 🔴 앞뒤 공백과 빈 줄이 **살아 있다.**
 *  5. 🔴 이어 붙이면 저장된 글자와 **한 글자도 다르지 않다.**
 * ============================================================================
 */

/** 줄들을 도로 이어 붙인다 — 「한 글자도 바꾸지 않는다」를 재는 자다. */
function rejoin(lines: readonly KyosanMemoLine[]): string {
  return lines
    .map((line) => {
      if (line.kind === "blank") return "";
      return line.kind === "heading" ? line.text : line.view.original;
    })
    .join("\n");
}

describe("작업 기록 덩어리를 줄로 갈라 보기", () => {
  const MEMO = [
    KYOSAN_IMPORT_MARK,
    "",
    kyosanOriginHeading("사내 확인 결과"),
    "不具合内容 その１",
    "  前置きの空白も残す  ",
    "",
    kyosanOriginHeading("처치(○ 표시)"),
    "現品引取",
    "출력이 나오지 않습니다",
  ].join("\n");

  const lines = viewKyosanMemoLines(MEMO);

  test("줄 수가 그대로다 — 잃거나 합쳐진 줄이 없다", () => {
    assert.equal(lines.length, 9);
  });

  test("🔴 머리글 줄은 번역되지 않는다 — 우리가 붙인 한글 이름이지 연락서 원문이 아니다", () => {
    assert.deepEqual(lines[0], { kind: "heading", text: KYOSAN_IMPORT_MARK });
    assert.deepEqual(lines[2], { kind: "heading", text: "[사내 확인 결과]" });
    assert.deepEqual(lines[6], { kind: "heading", text: "[처치(○ 표시)]" });
  });

  test("고정 보기 줄은 한글과 원문이 둘 다 나온다", () => {
    assert.deepEqual(lines[7], {
      kind: "text",
      view: { original: "現品引取", korean: "현품 인수", isJapaneseOriginal: false },
    });
  });

  test("🔴 사전에 없는 일본어 줄은 원문 그대로 + 「일본어 원문」 표시", () => {
    assert.deepEqual(lines[3], {
      kind: "text",
      view: { original: "不具合内容 その１", korean: null, isJapaneseOriginal: true },
    });
  });

  test("한국어 줄에는 아무 표시도 붙지 않는다", () => {
    assert.deepEqual(lines[8], {
      kind: "text",
      view: { original: "출력이 나오지 않습니다", korean: null, isJapaneseOriginal: false },
    });
  });

  test("🔴 앞뒤 공백이 살아 있다 — 저장 쪽이 일부러 남긴 것이다", () => {
    const padded = lines[4];
    assert.equal(padded.kind, "text");
    assert.equal(padded.kind === "text" ? padded.view.original : null, "  前置きの空白も残す  ");
  });

  test("🔴 빈 줄이 살아 있다 — 덩어리 사이 간격이 사라지면 안 된다", () => {
    assert.deepEqual(lines[1], { kind: "blank" });
    assert.deepEqual(lines[5], { kind: "blank" });
  });

  test("🔴 이어 붙이면 저장된 글자와 한 글자도 다르지 않다", () => {
    assert.equal(rejoin(lines), MEMO);
  });

  test("조각으로 나뉜 덩어리의 이어짐 머리글도 머리글로 본다", () => {
    // `report-detail-values.ts` 가 4000자를 넘을 때 만드는 첫 줄이다.
    // ⚠️ 대괄호로 **끝나지 않는다** — 지시서의 「대괄호로 시작하고 끝나는 줄」과 다르다.
    assert.equal(isKyosanHeadingLine(`${KYOSAN_IMPORT_MARK} (1/3)`), true);
    assert.equal(isKyosanHeadingLine(`${KYOSAN_IMPORT_MARK} (2/3) 이어짐`), true);
    assert.deepEqual(viewKyosanMemoLines(`${KYOSAN_IMPORT_MARK} (2/3) 이어짐`), [
      { kind: "heading", text: `${KYOSAN_IMPORT_MARK} (2/3) 이어짐` },
    ]);
  });

  test("사람이 손으로 적은 `[불량] 出力異常` 은 머리글이 아니다 — 일본어 표시를 잃지 않는다", () => {
    assert.equal(isKyosanHeadingLine("[불량] 出力異常"), false);
    assert.deepEqual(viewKyosanMemoLines("[불량] 出力異常"), [
      { kind: "text", view: { original: "[불량] 出力異常", korean: null, isJapaneseOriginal: true } },
    ]);
  });

  test("연락서와 상관없는 보통 기록은 아무것도 달라지지 않는다", () => {
    assert.deepEqual(viewKyosanMemoLines("점검 완료\n이상 없음"), [
      { kind: "text", view: { original: "점검 완료", korean: null, isJapaneseOriginal: false } },
      { kind: "text", view: { original: "이상 없음", korean: null, isJapaneseOriginal: false } },
    ]);
  });
});

/**
 * 🔴 **저장 쪽이 실제로 만든 글자**를 그대로 태운다. 손으로 적은 흉내가 아니라
 * `buildKyosanDetailValues` 의 출력이므로, 저장 쪽 머리글 모양이 바뀌면 여기서
 * 깨진다 — 화면이 조용히 머리글을 번역하기 시작하는 날을 막는다.
 */
describe("🔴 저장 쪽이 만든 덩어리와 화면이 어긋나지 않는다", () => {
  const plan: KyosanImportPlan = {
    repairCaseId: "11111111-1111-4111-8111-111111111111",
    intakeNumber: "D250101",
    lines: [
      { section: "FINDINGS", text: "不具合内容 その１", origin: "사내 확인 결과" },
      { section: "FINDINGS", text: "電源基板", origin: "고장 부위" },
      { section: "ACTIONS", text: "現品引取", origin: "처치(○ 표시)" },
    ],
    parts: [],
    causeMarks: [],
    actionMarks: [],
    photoCount: 0,
    formAssetCount: 0,
  };

  const memos = buildKyosanDetailValues({ plan, currentReportedSymptom: null }).workRecords.map(
    (draft) => draft.memo
  );

  test("실제로 저장되는 덩어리가 하나 이상 나온다(시험 자료가 비어 있지 않다)", () => {
    assert.ok(memos.length > 0);
    assert.ok(memos.some((memo) => memo.startsWith(KYOSAN_IMPORT_MARK)));
  });

  test("🔴 대괄호 줄은 하나도 번역되지 않고, 일본어 표시도 받지 않는다", () => {
    for (const memo of memos) {
      for (const line of viewKyosanMemoLines(memo)) {
        if (line.kind !== "text") continue;
        assert.equal(
          line.view.original.startsWith("["),
          false,
          `머리글 줄이 보통 줄로 떨어졌다: ${line.view.original}`
        );
      }
    }
  });

  test("🔴 이어 붙이면 저장된 덩어리와 한 글자도 다르지 않다", () => {
    for (const memo of memos) {
      assert.equal(rejoin(viewKyosanMemoLines(memo)), memo);
    }
  });

  test("덩어리 안의 고정 보기 줄은 한글이 붙는다 — 통째로 태우면 못 하던 일이다", () => {
    const whole = memos.join("\n");
    assert.equal(viewKyosanText(whole).korean, null, "통째로는 언제나 null 이다");

    const koreans = memos
      .flatMap((memo) => viewKyosanMemoLines(memo))
      .flatMap((line) => (line.kind === "text" && line.view.korean !== null ? [line.view.korean] : []));
    assert.deepEqual(koreans, ["현품 인수"]);
  });
});
