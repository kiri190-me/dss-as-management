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
  koreanKyosanDocumentText,
  translateKyosanFormTerm,
  translateKyosanTerm,
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

/**
 * ============================================================================
 * 🔴 「사전에 없는 일본어」 본보기 — **가짜 글자를 쓴다**
 * ============================================================================
 * 2026-09-23 에 이 자리 때문에 시험 **여덟 개가 한꺼번에 깨졌다.** 본보기로
 * `焼損・煙・異臭発生`(실측 139줄) 과 `出力異常`(18줄) 이라는 **실제 연락서 문장**을
 * 써 두었는데, 자유 기술 사전이 192줄로 자라면서 그 둘이 **사전 안으로 들어왔기**
 * 때문이다. 제품이 망가진 것이 아니라 본보기가 낡은 것이었다.
 *
 * 🔴 그래서 **실제 연락서 문장을 본보기로 쓰지 않는다.** 사전은 앞으로도 자란다.
 * 41자 넘는 실제 문장을 가져다 쓰는 것도 안 된다 — 그 무리에는 고객사명·모델명이
 * 박혀 있어 저장소에 둘 수 없다(`report-free-text-lines.fixture.ts` 머리말).
 * 남는 길은 **시험용임이 글자에서 드러나는 가짜 일본어**뿐이다.
 *
 * ⚠️ 세 파일이 **같은 글자**를 쓴다 — 여기와 `xlsx/service-report-template.test.ts`,
 * `components/excel-imports/KyosanReportImportParts.test.tsx`. 파일마다 따로 지으면
 * 다음에 또 여기저기서 깨진다.
 * ============================================================================
 */

/** 🔴 사전에 **없어야** 하는 본보기. 가나(`ダミー`)와 한자가 섞인 보통 꼴이다. */
const 사전에_없는_일본어 = "試験用ダミー故障";

/**
 * 🔴 사전에 **없어야** 하는 본보기 가운데 **가나가 한 글자도 없는** 것.
 *
 * 위 `사전에_없는_일본어` 를 이 자리에 쓸 수 없다 — `ダミー` 가 가나라서
 * 「가나 없이 한자만 있는 줄도 일본어로 본다」는 시험이 **재려던 것을 못 재게**
 * 된다. 그 시험은 한자만 있는 줄(`出力異常` 같은 꼴)이 일본어 표시를 받는지를
 * 보는 자리이고, 가나가 섞이면 가나 덕에 통과해 버린다.
 */
const 사전에_없는_한자만_일본어 = "試験用漢字列";

describe("🔴 시험용 본보기 — 사전 밖에 있어야 한다", () => {
  /**
   * 🔴 **이 지킴이가 이 파일의 본보기 여덟 자리를 대신 지킨다.** 다음 사람이 이
   * 글자를 사전에 넣는 날 **여기 한 곳에서** 잡힌다 — 여덟 군데가 한꺼번에
   * 깨지는 대신이다. 깨지면 사전을 되돌리지 말고 **본보기 글자를 바꿔라.**
   *
   * ⚠️ `translateKyosanTerm` 으로 본다 — 사전 **둘 다**(양식 · 자유 기술)를
   * 지나는 문이다. 한쪽만 보면 다른 쪽에 들어갔을 때 놓친다.
   */
  test("본보기가 아직 사전 밖에 있다 — 들어갔으면 다른 글자로 바꿔라", () => {
    assert.equal(translateKyosanTerm(사전에_없는_일본어), null);
    assert.equal(translateKyosanTerm(사전에_없는_한자만_일본어), null);
  });

  test("본보기가 일본어로 보인다 — 「일본어 원문」 표시를 받을 수 있어야 한다", () => {
    assert.equal(hasJapaneseCharacter(사전에_없는_일본어), true);
    assert.equal(hasJapaneseCharacter(사전에_없는_한자만_일본어), true);
  });

  test("🔴 한자만인 본보기에는 가나가 한 글자도 없다 — 그래야 재려던 것을 잰다", () => {
    assert.equal(/[぀-ゟ゠-ヿ]/u.test(사전에_없는_한자만_일본어), false);
  });
});

describe("연락서 고정 보기 사전", () => {
  // ⚠️ 제목이 「열넷」이었다 — 상태값(`交換無し`)이 늘었을 때 단언만 15로 고쳐지고
  //    제목은 그대로 남아 있었다(2026-09-22 고침).
  test("열다섯이다 — 原因 열 · 処置 넷 · 상태값 하나", () => {
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
    assert.equal(translateKyosanFormTerm(사전에_없는_일본어), null);
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
    assert.deepEqual(viewKyosanText(사전에_없는_일본어), {
      original: 사전에_없는_일본어,
      korean: null,
      isJapaneseOriginal: true,
    });
  });

  /**
   * 🔴 본보기에 **가나가 없어야** 이 시험이 뜻을 갖는다 — 가나가 섞이면 한자
   * 범위를 안 봐도 통과해 버린다. 위 `사전에_없는_한자만_일본어` 의 주석 참조.
   * 실측에서도 `出力異常` 처럼 가나 없이 한자만인 자유 기술이 흔하다.
   */
  test("가나가 없고 한자만 있는 줄도 일본어로 본다(実測: 出力異常 같은 꼴이 흔하다)", () => {
    assert.equal(viewKyosanText(사전에_없는_한자만_일본어).isJapaneseOriginal, true);
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

  /**
   * ⚠️ 이 시험의 이름은 2026-09-23 까지 「…일본어 표시를 잃지 않는다」였고, 기대값이
   * `korean: null` · `isJapaneseOriginal: true` 였다. **같은 날 낱말 바꿔치기가
   * 들어오면서 바뀌었다**(`report-word-terms.ts`) — 사전에 든 `出力異常`(실측
   * 18줄)을 품은 줄은 이제 **낱말 단위로** 한글이 된다. 사용자가 「문서에 일본어가
   * 하나도 안 남게」로 정한 결과이고, 반쪽이 될 줄은 여전히 원문 그대로 나간다
   * (all-or-nothing).
   *
   * 🔴 **이 시험이 재던 것은 그대로다** — `[불량]` 으로 시작하는 줄이 **머리글로
   * 잘못 읽히지 않는다**는 것이다. 그쪽 단언(`isKyosanHeadingLine`)은 한 글자도
   * 안 바뀌었다. 바뀐 것은 「보통 줄로 떨어진 뒤 무엇이 되는가」뿐이라, 기대값을
   * 흐리게 적지 않고 **바뀐 글자를 그대로** 못 박는다.
   */
  test("사람이 손으로 적은 `[불량] 出力異常` 은 머리글이 아니다 — 보통 줄로 떨어진다", () => {
    assert.equal(isKyosanHeadingLine("[불량] 出力異常"), false);
    assert.deepEqual(viewKyosanMemoLines("[불량] 出力異常"), [
      {
        kind: "text",
        view: {
          original: "[불량] 出力異常",
          korean: "[불량] 출력 이상",
          isJapaneseOriginal: false,
        },
      },
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

// ══════════════════════════════════════ 문서에 찍히는 글자 (2026-09-22)

/**
 * ============================================================================
 * 🔴 문서는 **한글만** — 병기하지 않는다 (사용자 결정 2026-09-22)
 * ============================================================================
 * 화면(`KyosanText`)과 문서(`xlsx/service-report-template.ts` 의 채우개)가 **같은
 * 사전 · 같은 줄 가름**을 쓰면서 결과만 다르다. 화면은 원문을 옆에 남기고, 문서는
 * 한글만 찍는다 — 고객사로 나가는 종이에 두 나라 말이 섞이면 안 된다.
 *
 * 못 박는 것은 다섯이다.
 *  1. 🔴 사전에 있는 줄은 **한글만** 나온다(원문이 따라붙지 않는다).
 *  2. 🔴 사전에 없는 줄은 **원문 그대로** 나간다 — 채우거나 비우지 않는다.
 *  3. 🔴 대괄호 머리글은 손대지 않는다(우리가 붙인 한글 이름이다).
 *  4. 🔴 빈 줄 · 줄 수 · 줄바꿈 글자(`\r\n`)가 그대로다.
 *  5. 🔴 손대지 않은 줄은 **한 글자도** 달라지지 않는다(앞뒤 공백 포함).
 * ============================================================================
 */
describe("문서에 찍히는 글자 — 한글만", () => {
  test("🔴 고정 보기는 한글만 나온다 — 원문을 괄호로 붙이지 않는다", () => {
    assert.equal(koreanKyosanDocumentText("現品引取"), "현품 인수");
    assert.equal(koreanKyosanDocumentText("その他"), "기타");
    assert.equal(koreanKyosanDocumentText("交換無し"), "교체 없음");
  });

  test("🔴 사전에 없는 일본어는 원문 그대로 나간다 — 빈 칸으로 만들지 않는다", () => {
    assert.equal(koreanKyosanDocumentText(사전에_없는_일본어), 사전에_없는_일본어);
    assert.equal(koreanKyosanDocumentText("その他の不具合"), "その他の不具合");
  });

  test("한글·영문·빈 글자는 아무것도 달라지지 않는다", () => {
    assert.equal(koreanKyosanDocumentText("전원부 퓨즈 단선 확인"), "전원부 퓨즈 단선 확인");
    assert.equal(koreanKyosanDocumentText("AMP IMBALANCE"), "AMP IMBALANCE");
    assert.equal(koreanKyosanDocumentText(""), "");
  });

  test("🔴 여러 줄 덩어리 — 머리글·빈 줄·앞뒤 공백이 그대로이고 줄 수도 그대로다", () => {
    const memo = [
      KYOSAN_IMPORT_MARK,
      "",
      kyosanOriginHeading("처치(○ 표시)"),
      "現品引取",
      "  交換無し  ",
      사전에_없는_일본어,
    ].join("\n");

    assert.equal(
      koreanKyosanDocumentText(memo),
      [
        KYOSAN_IMPORT_MARK,
        "",
        "[처치(○ 표시)]",
        "현품 인수",
        // ⚠️ 사전이 맞은 줄은 눌린 열쇠로 맞은 것이라 앞뒤 공백이 함께 사라진다 —
        //    들어가는 값이 우리 양식의 한글 이름이고 그것은 공백이 안 붙은 낱말이다.
        "교체 없음",
        사전에_없는_일본어,
      ].join("\n")
    );
    assert.equal(
      koreanKyosanDocumentText(memo).split("\n").length,
      memo.split("\n").length,
      "줄 수가 달라졌다"
    );
  });

  test("🔴 사전이 맞지 않는 줄의 앞뒤 공백은 살아 있다", () => {
    assert.equal(koreanKyosanDocumentText("  前置きの空白も残す  "), "  前置きの空白も残す  ");
  });

  test("🔴 CRLF 줄바꿈을 LF 로 고치지 않는다 — 번역이 아니라 글자 바꾸기다", () => {
    assert.equal(koreanKyosanDocumentText("現品引取\r\nその他"), "현품 인수\r\n기타");
    assert.equal(koreanKyosanDocumentText("한글\r\n\r\n한글"), "한글\r\n\r\n한글");
  });

  /**
   * ⚠️ 2026-09-23 까지 이 자리의 본보기는 `[불량] 出力異常` 이었다. 「사전에 든
   * 낱말(`出力異常`, 실측 18줄)을 품고도 **통째로는** 사전에 없으니 한 글자도 안
   * 바뀐다」를 재려던 것이었는데, **같은 날 낱말 바꿔치기가 들어오면서 그 줄은
   * 이제 바뀐다**(`report-word-terms.ts` — 바로 아래 시험이 그 새 동작을 잰다).
   *
   * 🔴 **재려던 것은 그대로 둔다.** 단언(`koreanKyosanDocumentText(memo) === memo`)은
   * 한 글자도 손대지 않았고, **전제가 깨진 본보기만** 가짜 글자로 갈았다 —
   * `試験用漢字列` 은 세 사전 260개 후보 가운데 **하나도 걸리지 않는다**(2026-09-23
   * 확인). 그래서 「사전에 하나도 안 걸리는 덩어리」라는 말이 다시 참이 된다.
   * 🔴 가짜 글자를 쓰는 까닭은 이 파일 머리말의 '시험용 본보기' 칸에 있다 —
   * 사전은 앞으로도 자라고, 실제 연락서 문장을 본보기로 두면 또 여기저기서 깨진다.
   */
  test("🔴 사전에 하나도 안 걸리는 덩어리는 한 글자도 달라지지 않는다", () => {
    const memo = `점검 완료\r\n\r\n  ${사전에_없는_일본어}  \n[불량] ${사전에_없는_한자만_일본어}`;
    assert.equal(koreanKyosanDocumentText(memo), memo);
  });

  /**
   * 🔴 **위 시험이 놓아준 자리를 이어받는 새 시험이다**(2026-09-23). 위가 「안
   * 바뀐다」를 재고, 여기가 **「사전 낱말을 품은 줄은 바뀐다」**를 잰다 — 잃은 것
   * 없이 하나가 는 셈이다.
   *
   * `[불량] 出力異常` 은 **통째로는** 사전에 없다(`[불량]` 은 사람이 적은 한글
   * 머리표라 연락서 원문에 나오지 않는다). 그런데도 한글이 되는 것은 문장 속
   * 낱말 `出力異常` 을 갈아 끼웠기 때문이고, 남는 일본어가 없어 내보낼 수 있다
   * (all-or-nothing). 🔴 `[불량]` 머리표와 그 뒤 공백은 **그대로 살아 있다.**
   */
  test("🔴 사전 낱말을 품은 줄은 낱말 단위로 한글이 된다 — 반쪽이 아니라 통째로", () => {
    assert.equal(koreanKyosanDocumentText("[불량] 出力異常"), "[불량] 출력 이상");
    // 🔴 반쪽이 될 줄은 여전히 원문 그대로다 — 바뀌는 줄과 안 바뀌는 줄이 한 덩어리에 있어도 섞이지 않는다.
    const memo = `[불량] 出力異常\r\n  ${사전에_없는_일본어}  `;
    assert.equal(koreanKyosanDocumentText(memo), `[불량] 출력 이상\r\n  ${사전에_없는_일본어}  `);
  });

  test("🔴 저장 쪽이 실제로 만든 덩어리에서 한글이 나온다", () => {
    // 위 「저장 쪽이 만든 덩어리」 시험과 같은 자료 — 손으로 적은 흉내가 아니다.
    const plan: KyosanImportPlan = {
      repairCaseId: "22222222-2222-4222-8222-222222222222",
      intakeNumber: "D250102",
      lines: [
        { section: "FINDINGS", text: "不具合内容 その１", origin: "사내 확인 결과" },
        { section: "ACTIONS", text: "現品引取", origin: "처치(○ 표시)" },
        { section: "ACTIONS", text: "処置完了", origin: "처치(○ 표시)" },
      ],
      parts: [],
      causeMarks: [],
      actionMarks: [],
      photoCount: 0,
      formAssetCount: 0,
    };

    const drafts = buildKyosanDetailValues({ plan, currentReportedSymptom: null }).workRecords;
    // ⚠️ 덩어리가 종류별로 갈라져 나온다(처치 ○ 는 GENERAL, 사내 확인 결과는
    //    INTAKE_INSPECTION_RESULT) — 줄 검사는 덩어리마다, 글자 검사는 통째로.
    for (const draft of drafts) {
      assert.equal(
        koreanKyosanDocumentText(draft.memo).split("\n").length,
        draft.memo.split("\n").length,
        "줄 수가 달라졌다"
      );
    }

    const document = drafts.map((draft) => koreanKyosanDocumentText(draft.memo)).join("\n");
    // 🔴 문서에는 한글이 들어가고 원문은 따라붙지 않는다.
    assert.equal(document.includes("현품 인수"), true, "한글이 안 들어갔다");
    assert.equal(document.includes("조치 완료"), true, "한글이 안 들어갔다");
    assert.equal(document.includes("現品引取"), false, "원문이 남았다");
    // 🔴 사전에 없는 줄은 그대로 남는다 — 억지로 채우거나 비우지 않는다.
    assert.equal(document.includes("不具合内容 その１"), true, "사전에 없는 줄이 사라졌다");
    // 🔴 머리글은 손대지 않는다.
    assert.equal(document.includes(KYOSAN_IMPORT_MARK), true, "머리글이 바뀌었다");
  });
});
