import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  ATTACHMENT_CATEGORY_CODES,
  attachmentCategoryLabels,
  type AttachmentCategory,
} from "./attachment-category";
import { CONTACT_FOLDER_COMMON_FOLDER_NAME, contactFolderCategoryFolderName } from "./contact-folder-naming";
import {
  CONTACT_FOLDER_SAVE_TARGET_CATEGORIES,
  CONTACT_FOLDER_SAVE_TARGET_COMMON_VALUE,
  CONTACT_FOLDER_SAVE_TARGET_OPTIONS,
  contactFolderSaveTargetLabel,
  isContactFolderSaveTargetCategory,
  readContactFolderSaveTarget,
} from "./contact-folder-save-targets";

/**
 * ============================================================================
 * [연락서 폴더에 저장] — 고를 거리와 **서버의 울타리** (2026-11-18)
 * ============================================================================
 * 사용자가 세 안 중 「공통 + 서류 분류만」을 골랐다. 여기서 못 박는 것:
 *
 *  · 🔴 고를 거리는 **열둘**이고 **그 차례**다 — 사진 다섯 · 데이터류 넷 · 스크린샷 ·
 *    통전검사는 **없다**(목록을 세기만 하는 시험이 아니라 **무엇이 없는지**도 잰다)
 *  · 🔴 차례가 전체 분류 목록의 차례와 같다 — 「기타는 언제나 맨 끝」이 여기서도 산다
 *  · 🔴 보일 글자를 **베껴 적지 않았다** — 이름표 표와 글자가 같다
 *  · 🔴 창의 글자와 **서버가 만드는 폴더 이름**이 같다(둘을 맞대어 잰다)
 *  · 🔴 안 고르면 `공통` · 목록 밖은 **거절**(「모르면 공통」으로 삼키지 않는다)
 * ============================================================================
 */

/** 사용자가 고른 열둘 — 🔴 **글자로 다시 적는다.** 모듈을 그대로 베끼면 둘 다 틀려도 통과한다. */
const EXPECTED_CATEGORIES = [
  "INSPECTION_REPORT",
  "REPAIR_REPORT",
  "QUOTE",
  "KYOSAN_DOCUMENT",
  "CUSTOMER_DOCUMENT",
  "CIRCUIT_DIAGRAM",
  "SIGNED_QUOTE_PDF",
  "QUOTE_EXCEL",
  "CHECKLIST",
  "PASS_SLIP",
  "REPAIR_REQUEST",
  "OTHER",
];

/** 🔴 **일부러 뺀 것들**(2026-11-18 결정) — 하나라도 돌아오면 여기서 걸린다. */
const EXPECTED_ABSENT = [
  "INTAKE_PHOTO",
  "EXTERNAL_CONDITION",
  "IN_REPAIR",
  "AFTER_REPAIR",
  "SHIPMENT_PHOTO",
  "OSCILLOSCOPE_DATA",
  "LOG_FILE",
  "FIRMWARE",
  "SCREENSHOT",
  "PARAMETER",
  "POWER_TEST",
];

describe("① 고를 거리 — 서류 분류 열둘, 그 차례 그대로", () => {
  test("🔴 열둘이고 차례가 사용자가 정한 그대로다", () => {
    assert.deepEqual([...CONTACT_FOLDER_SAVE_TARGET_CATEGORIES], EXPECTED_CATEGORIES);
    assert.equal(CONTACT_FOLDER_SAVE_TARGET_CATEGORIES.length, 12);
  });

  test("🔴 뺀 것들이 **정말로 없다** — 사진 다섯 · 데이터류 넷 · 스크린샷 · 통전검사", () => {
    // 표본이 비어 공짜로 통과하지 않게, 먼저 「무엇을 재는가」를 못 박는다.
    assert.equal(EXPECTED_ABSENT.length, 11);
    assert.equal(
      EXPECTED_ABSENT.length + EXPECTED_CATEGORIES.length,
      ATTACHMENT_CATEGORY_CODES.length,
      "분류가 늘거나 줄었다 — 이 조각에 내놓을지 사람이 정해야 한다"
    );
    for (const code of EXPECTED_ABSENT) {
      assert.equal(isContactFolderSaveTargetCategory(code), false, `${code} 가 고를 거리에 들어왔다`);
    }
  });

  test("🔴 차례가 **전체 분류 목록의 차례**와 같다 — 기타는 맨 끝이다", () => {
    const inListOrder = ATTACHMENT_CATEGORY_CODES.filter((code) => isContactFolderSaveTargetCategory(code));
    assert.deepEqual(inListOrder, EXPECTED_CATEGORIES);
    assert.equal(EXPECTED_CATEGORIES[EXPECTED_CATEGORIES.length - 1], "OTHER", "기타가 맨 끝이 아니다");
  });

  test("열둘이 모두 **실제로 있는 분류**다 — 없는 코드를 지어내지 않았다", () => {
    for (const code of CONTACT_FOLDER_SAVE_TARGET_CATEGORIES) {
      assert.ok(
        (ATTACHMENT_CATEGORY_CODES as readonly string[]).includes(code),
        `${code} 는 분류 목록에 없는 코드다`
      );
    }
  });
});

describe("② 보일 글자 — 이름표 표에서 온다(베껴 적지 않았다)", () => {
  test("🔴 열셋: 맨 위가 `공통`(기본 선택), 그 뒤가 이름표 그대로다", () => {
    assert.equal(CONTACT_FOLDER_SAVE_TARGET_OPTIONS.length, 13);

    const [first, ...rest] = CONTACT_FOLDER_SAVE_TARGET_OPTIONS;
    assert.equal(first.category, null, "맨 위가 `공통` 이 아니다");
    assert.equal(first.label, CONTACT_FOLDER_COMMON_FOLDER_NAME);
    assert.equal(first.value, CONTACT_FOLDER_SAVE_TARGET_COMMON_VALUE);

    assert.deepEqual(
      rest.map((option) => option.category),
      EXPECTED_CATEGORIES
    );
    for (const option of rest) {
      // 🔴 이름표 표가 짓는 글자 그대로다 — 손으로 적은 글자가 섞이면 여기서 걸린다.
      assert.equal(option.label, attachmentCategoryLabels[option.category as AttachmentCategory]);
      assert.equal(option.value, option.category);
    }
    // 사람이 실제로 볼 글자 몇 개 — 이름표가 통째로 빈 문자열이어도 통과하지 않게.
    assert.deepEqual(
      CONTACT_FOLDER_SAVE_TARGET_OPTIONS.slice(0, 4).map((option) => option.label),
      ["공통", "검사 보고서", "수리 보고서", "견적서"]
    );
  });

  test("🔴 `공통` 의 값은 **분류 코드가 아니다** — 겹치면 하나가 다른 하나를 가린다", () => {
    assert.equal(
      (ATTACHMENT_CATEGORY_CODES as readonly string[]).includes(CONTACT_FOLDER_SAVE_TARGET_COMMON_VALUE),
      false
    );
    assert.equal(isContactFolderSaveTargetCategory(CONTACT_FOLDER_SAVE_TARGET_COMMON_VALUE), false);
    // 라디오의 값은 서로 달라야 한다 — 같으면 한 칸을 고를 수 없다.
    assert.equal(new Set(CONTACT_FOLDER_SAVE_TARGET_OPTIONS.map((option) => option.value)).size, 13);
  });

  test("🔴 창의 글자와 **서버가 만드는 폴더 이름**이 같다 — 둘을 맞대어 잰다", () => {
    for (const option of CONTACT_FOLDER_SAVE_TARGET_OPTIONS) {
      if (option.category === null) continue;
      // 서버는 이름표를 다듬어 폴더를 만든다(contactFolderCategoryFolderName). 다듬기에
      // 글자가 걸리는 이름표가 생기면 화면만 옛 이름을 말하게 되므로 여기서 막는다.
      assert.equal(
        contactFolderCategoryFolderName(option.category),
        option.label,
        `${option.category}: 창의 글자와 폴더 이름이 다르다`
      );
    }
  });

  test("고른 자리의 이름 — 분류면 이름표, 안 고르면 `공통`", () => {
    assert.equal(contactFolderSaveTargetLabel(null), CONTACT_FOLDER_COMMON_FOLDER_NAME);
    assert.equal(contactFolderSaveTargetLabel("QUOTE"), "견적서");
    assert.equal(contactFolderSaveTargetLabel("PASS_SLIP"), "통문증");
  });
});

describe("③ 🔴 서버의 울타리 — 화면이 보낸 값을 **제 손으로** 가른다", () => {
  test("🔴 안 고르면 `공통` — 칸이 없거나 비면 2026-10-08 과 같은 일이다", () => {
    assert.deepEqual(readContactFolderSaveTarget(null), { kind: "common" });
    assert.deepEqual(readContactFolderSaveTarget(undefined), { kind: "common" });
    assert.deepEqual(readContactFolderSaveTarget(""), { kind: "common" });
    assert.deepEqual(readContactFolderSaveTarget("   "), { kind: "common" });
    // 창이 쓰는 값으로 명시적으로 보내도 같은 자리다.
    assert.deepEqual(readContactFolderSaveTarget(CONTACT_FOLDER_SAVE_TARGET_COMMON_VALUE), { kind: "common" });
  });

  test("고른 분류 열둘은 **그대로** 통과한다", () => {
    for (const category of CONTACT_FOLDER_SAVE_TARGET_CATEGORIES) {
      assert.deepEqual(readContactFolderSaveTarget(category), { kind: "category", category });
    }
  });

  test("🔴 목록 밖은 **거절**이다 — 「모르면 공통」으로 삼키지 않는다", () => {
    const rejected = [
      // 분류이긴 하지만 이 창에 내놓지 않은 것들 — 통로도 받지 않는다.
      "INTAKE_PHOTO",
      "OSCILLOSCOPE_DATA",
      "PARAMETER",
      "SCREENSHOT",
      // 아예 없는 코드 · 대소문자 · 폴더 이름 · 경로를 섞어 보낸 것.
      "NOT_A_CATEGORY",
      "quote",
      "견적서",
      "공통",
      "DATA",
      "../../etc",
    ];
    for (const value of rejected) {
      assert.equal(readContactFolderSaveTarget(value), null, `${value} 를 받아 주었다`);
    }
  });
});
