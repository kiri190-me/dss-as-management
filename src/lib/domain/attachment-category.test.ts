import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ATTACHMENT_CATEGORY_CODES,
  ATTACHMENT_OWNER_KINDS,
  DEFAULT_MALWARE_SCAN_STATUS,
  MALWARE_SCAN_STATUS_CODES,
  PRODUCT_MODEL_ONLY_CATEGORIES,
  QUOTE_ATTACHMENT_FILES_PER_SLOT,
  QUOTE_ATTACHMENT_SLOT_CATEGORIES,
  attachmentCategoriesForOwner,
  attachmentCategoryLabels,
  isAttachmentCategory,
  isAttachmentCategoryAllowedForOwner,
  isMalwareScanStatus,
  isProductModelOnlyCategory,
  isQuoteAttachmentSlotCategory,
  liveQuoteAttachmentInSlot,
  malwareScanStatusLabels,
  quoteAttachmentIdsDisplacedBy,
} from "./attachment-category";
import {
  ATTACHMENT_CATEGORY_CODES as DEMO_CATEGORY_CODES,
  attachmentCategoryLabels as demoCategoryLabels,
} from "./local/attachments/attachment-types";
import { attachmentCategoryEnum, malwareScanStatusEnum } from "@/lib/db/schema";

/**
 * ============================================================================
 * 이 파일이 지키려는 것 — 같은 목록이 세 곳에 있고, 어긋나면 조용히 깨진다
 * ============================================================================
 * 첨부 분류는 지금 세 군데에 적혀 있다.
 *
 *   1. 데모 화면    src/lib/domain/local/attachments/attachment-types.ts
 *   2. 도메인 기준  src/lib/domain/attachment-category.ts   (이 테스트의 대상)
 *   3. DB enum      src/lib/db/schema/attachments.ts
 *
 * 스키마 레이어는 도메인 레이어를 import 하지 않는 것이 이 저장소의 규칙이라
 * (repair-cases.ts의 billingTypeEnum 주석) 3번은 값을 복제해서 들고 있고,
 * 1번은 데모가 걷힐 때까지 그대로 남는다. 즉 **어느 한 곳만 고치는 일이
 * 실제로 가능하다.**
 *
 * 한 곳만 고쳐지면 무슨 일이 나는가: 화면이 새 분류로 업로드를 시도하는데
 * DB enum에 그 값이 없어 INSERT가 터지거나, 반대로 DB에는 있는데 화면에
 * 라벨이 없어 코드가 그대로 노출된다. 둘 다 배포하고 나서야 알게 되는 종류의
 * 고장이다. 그래서 여기서 세 목록을 **순서까지** 맞춰 본다.
 * ============================================================================
 */

// ─────────────────────────────────────────── 데모 화면 목록과 어긋나지 않는가

// SCREENSHOT(개선 요청 스크린샷, 2026-09-13)과 견적서 두 칸 SIGNED_QUOTE_PDF ·
// QUOTE_EXCEL(2026-09-15), 그리고 제품 모델 전용 셋 PARAMETER · POWER_TEST ·
// CHECKLIST(2026-09-30)는 정본과 DB enum 에만 있고 데모에는 없다 — 데모 계층은
// 손대지 않는다(attachment-category.ts 헤더의 '데모 파일과의 관계'). 그래서 아래 두
// 대조는 「정본에서 그 여섯을 뺀 것 = 데모」를 본다. 빼는 것은 그 여섯 값뿐이라, 다른
// 한 줄이라도 어긋나면 여전히 걸린다.
const DEMO_ABSENT_CATEGORIES: readonly string[] = [
  "SCREENSHOT",
  "SIGNED_QUOTE_PDF",
  "QUOTE_EXCEL",
  "PARAMETER",
  "POWER_TEST",
  "CHECKLIST",
];

test("분류 코드가 데모 파일 목록과 순서까지 정확히 같다 — 주인 전용 분류 셋만 빼고", () => {
  assert.deepEqual(
    ATTACHMENT_CATEGORY_CODES.filter((code) => !DEMO_ABSENT_CATEGORIES.includes(code)),
    [...DEMO_CATEGORY_CODES]
  );
  for (const code of DEMO_ABSENT_CATEGORIES) {
    assert.equal(
      (DEMO_CATEGORY_CODES as readonly string[]).includes(code),
      false,
      `데모에 ${code} 가 생겼다면 이 예외를 거둘 때다`
    );
  }
});

test("분류 라벨이 데모 파일과 글자까지 같다 — 주인 전용 분류 셋만 빼고", () => {
  // 코드만 맞추고 라벨이 갈리면 같은 파일이 화면마다 다른 이름으로 보인다.
  const labelsWithoutOwnerOnly = Object.fromEntries(
    Object.entries(attachmentCategoryLabels).filter(([code]) => !DEMO_ABSENT_CATEGORIES.includes(code))
  );
  assert.deepEqual(labelsWithoutOwnerOnly, demoCategoryLabels);
});

test("교산 문서 분류는 남아 있다", () => {
  // 폐기된 것은 '교산 승인 증빙을 첨부 대상으로 삼는 일'이지 교산과 주고받는
  // 문서 분류가 아니다. 워크플로의 교산 단계도 그대로 살아 있다 — 이 분류가
  // 사라지면 그 단계에서 받은 문서를 넣을 칸이 없어진다.
  assert.ok(ATTACHMENT_CATEGORY_CODES.includes("KYOSAN_DOCUMENT"));
  assert.equal(attachmentCategoryLabels.KYOSAN_DOCUMENT, "교산 문서");
});

// ──────────────────────────────────────────────── DB enum과 어긋나지 않는가

test("DB의 attachment_category enum이 이 목록과 순서까지 같다", () => {
  assert.deepEqual([...attachmentCategoryEnum.enumValues], [...ATTACHMENT_CATEGORY_CODES]);
});

test("DB의 attachment_malware_scan_status enum이 이 목록과 순서까지 같다", () => {
  assert.deepEqual([...malwareScanStatusEnum.enumValues], [...MALWARE_SCAN_STATUS_CODES]);
});

test("검사 상태 기본값은 DB enum에 실재하는 값이다", () => {
  assert.ok(malwareScanStatusEnum.enumValues.includes(DEFAULT_MALWARE_SCAN_STATUS));
  assert.equal(DEFAULT_MALWARE_SCAN_STATUS, "NOT_SCANNED");
});

// ───────────────────────────────────────────────────── 목록 자체의 무결성

test("분류 코드는 21종이고 중복이 없다", () => {
  // 개수를 적어 두는 이유는 **DB enum과 함께 움직이기 때문**이다. 코드에만
  // 더하고 마이그레이션을 잊으면 화면에서는 고를 수 있는데 저장할 때 서버가
  // 거절한다 — 그 어긋남이 이 줄에서 먼저 걸린다.
  //
  // 11 → 14: 수리 중·수리 후·출하 사진을 더했다(마이그레이션 0047).
  // 14 → 15: 견적서를 더했다(마이그레이션 0083).
  // 15 → 16: 스크린샷을 더했다(마이그레이션 0097 — 개선 요청 글의 화면 사진).
  // 16 → 18: 결재 견적서 PDF · 수기 견적서 엑셀을 더했다(마이그레이션 0099 — 견적서 첨부).
  // 18 → 21: 파라미터 · 통전검사 · 점검표를 더했다(2026-09-30 — 제품 모델 전용 기본 자료).
  assert.equal(ATTACHMENT_CATEGORY_CODES.length, 21);
  assert.equal(new Set(ATTACHMENT_CATEGORY_CODES).size, 21);
});

test("스크린샷은 회로도 뒤에 있고 이름표는 「스크린샷」이다", () => {
  // 새 분류를 끝에 붙이지 않는다(아래 '기타는 언제나 목록의 맨 끝이다'). DB enum
  // 과 같은 차례인지는 위 enum 대조가 따로 본다. 스크린샷 바로 뒤는 이제 기타가
  // 아니라 견적서 두 칸이다(아래 시험).
  assert.equal(attachmentCategoryLabels.SCREENSHOT, "스크린샷");
  const index = ATTACHMENT_CATEGORY_CODES.indexOf("SCREENSHOT");
  assert.equal(ATTACHMENT_CATEGORY_CODES[index - 1], "CIRCUIT_DIAGRAM");
  assert.equal(ATTACHMENT_CATEGORY_CODES[index + 1], "SIGNED_QUOTE_PDF");
  assert.ok(attachmentCategoryEnum.enumValues.includes("SCREENSHOT"));
});

test("견적서 두 칸은 스크린샷 뒤에 결재 PDF · 엑셀 차례로 있다", () => {
  // 0099 가 둘 다 `ADD VALUE ... BEFORE 'OTHER'` 로 더한다 — DB enum 과 같은 차례인지는
  // 위 enum 대조가 따로 본다. 엑셀 바로 뒤는 이제 기타가 아니라 모델 전용 셋이다
  // (아래 시험) — 기타는 여전히 맨 끝이다.
  assert.equal(attachmentCategoryLabels.SIGNED_QUOTE_PDF, "결재 견적서 PDF");
  assert.equal(attachmentCategoryLabels.QUOTE_EXCEL, "수기 견적서 엑셀");
  const index = ATTACHMENT_CATEGORY_CODES.indexOf("SIGNED_QUOTE_PDF");
  assert.equal(ATTACHMENT_CATEGORY_CODES[index - 1], "SCREENSHOT");
  assert.equal(ATTACHMENT_CATEGORY_CODES[index + 1], "QUOTE_EXCEL");
  assert.ok(attachmentCategoryEnum.enumValues.includes("SIGNED_QUOTE_PDF"));
  assert.ok(attachmentCategoryEnum.enumValues.includes("QUOTE_EXCEL"));
});

// ─────────────────────── 모델 기본 자료 셋 (2026-09-30)

test("모델 기본 자료 셋은 수기 견적서 엑셀 뒤·기타 앞에 파라미터 · 통전검사 · 점검표 차례로 있다", () => {
  // 사용자가 말한 차례 그대로다(파라미터 · 통전검사 · 점검표). 화면의 고르는 차례가
  // 이 배열 순서이므로 자리가 곧 사람이 보는 목록의 자리다. DB enum 과 같은 차례인지는
  // 위 enum 대조가 따로 본다 — `ADD VALUE ... BEFORE 'OTHER'` 셋으로 들어간다.
  assert.equal(attachmentCategoryLabels.PARAMETER, "파라미터");
  assert.equal(attachmentCategoryLabels.POWER_TEST, "통전검사");
  assert.equal(attachmentCategoryLabels.CHECKLIST, "점검표");
  const index = ATTACHMENT_CATEGORY_CODES.indexOf("PARAMETER");
  assert.equal(ATTACHMENT_CATEGORY_CODES[index - 1], "QUOTE_EXCEL");
  assert.equal(ATTACHMENT_CATEGORY_CODES[index + 1], "POWER_TEST");
  assert.equal(ATTACHMENT_CATEGORY_CODES[index + 2], "CHECKLIST");
  assert.equal(ATTACHMENT_CATEGORY_CODES[index + 3], "OTHER");
  // 자리는 셋이 나란하다 — 주인이 갈리는 것과 목록의 차례는 다른 이야기다.
  for (const code of ["PARAMETER", "POWER_TEST", "CHECKLIST"] as const) {
    assert.ok(attachmentCategoryEnum.enumValues.includes(code), `DB enum 에 ${code} 가 없다`);
  }
});

test("🔴 파라미터 · 통전검사는 제품 모델에만 붙는다 — 수리 건 「파일관리」에는 나오지 않는다", () => {
  // 사용자가 명시적으로 가른 것이다(2026-09-30): "이건 각 모델들에 따른 기본 자료고,
  // [파일관리]에 입력되는 자료가 아니야." 화면의 선택지도 올리기 통로의 거절도
  // createAttachmentRecord 의 마지막 방어선도 전부 이 함수 하나를 본다.
  //
  // 🔴 **둘이다 — 점검표는 여기 없다.** 같은 날 사용자가 점검표만 정정해 수리 건에도
  // 열었다(아래 시험). 셋으로 되돌리면 수리 건 파일 탭에서 점검표가 사라진다.
  assert.deepEqual([...PRODUCT_MODEL_ONLY_CATEGORIES], ["PARAMETER", "POWER_TEST"]);
  for (const code of PRODUCT_MODEL_ONLY_CATEGORIES) {
    assert.equal(isProductModelOnlyCategory(code), true, code);
    assert.equal(isAttachmentCategoryAllowedForOwner(code, "PRODUCT_MODEL"), true, code);
    assert.equal(isAttachmentCategoryAllowedForOwner(code, "REPAIR_CASE"), false, `${code} 가 수리 건에 열렸다`);
    assert.equal(isAttachmentCategoryAllowedForOwner(code, "QUOTE"), false, `${code} 가 견적서에 열렸다`);
  }
  assert.equal(isProductModelOnlyCategory("CHECKLIST"), false, "점검표가 모델 전용으로 되돌아갔다");

  // 화면이 그대로 map 하는 목록에서도 갈린다 — 한쪽에만 있으면 화면과 서버가 갈라진다.
  const repairCaseChoices = attachmentCategoriesForOwner("REPAIR_CASE");
  const productModelChoices = attachmentCategoriesForOwner("PRODUCT_MODEL");
  for (const code of PRODUCT_MODEL_ONLY_CATEGORIES) {
    assert.equal(repairCaseChoices.includes(code), false, `수리 건 선택지에 ${code} 가 있다`);
    assert.equal(productModelChoices.includes(code), true, `모델 선택지에 ${code} 가 없다`);
  }
  // 다른 분류는 하나도 안 움직였다 — 두 목록의 차이가 정확히 이 **둘**뿐이어야 한다.
  assert.deepEqual(
    productModelChoices.filter((code) => !repairCaseChoices.includes(code)),
    ["PARAMETER", "POWER_TEST"]
  );
  assert.deepEqual(repairCaseChoices.filter((code) => !productModelChoices.includes(code)), []);
});

test("🔴 점검표는 두 주인 모두에 붙는다 — 모델은 빈 양식, 수리 건은 채워 인쇄한 기록", () => {
  // 2026-09-30 사용자 정정: "수리건 상세의 [파일관리]에도 점검표 항목은 있었으면
  // 좋겠어. 이건 실제로 인쇄한 점검표를 기록차원에서 올려놓는 자리야."
  //
  // 🔴 이 시험이 그 뜻을 지킨다. 앞선 시험이 「모델 전용 셋」을 못박고 있었으므로,
  // 그것만 고치고 이것을 안 두면 다음 사람이 점검표를 도로 모델 전용으로 옮겨도
  // 아무 시험도 깨지지 않는다.
  assert.equal(attachmentCategoryLabels.CHECKLIST, "점검표");
  assert.equal(isAttachmentCategoryAllowedForOwner("CHECKLIST", "PRODUCT_MODEL"), true);
  assert.equal(isAttachmentCategoryAllowedForOwner("CHECKLIST", "REPAIR_CASE"), true);
  // 견적서에는 여전히 안 붙는다 — 거기 붙는 것은 결재 PDF · 수기 엑셀 두 칸뿐이다.
  assert.equal(isAttachmentCategoryAllowedForOwner("CHECKLIST", "QUOTE"), false);

  // 두 화면의 선택지에 **모두** 나온다 — 화면은 이 목록을 그대로 map 한다.
  assert.ok(attachmentCategoriesForOwner("REPAIR_CASE").includes("CHECKLIST"), "수리 건 선택지에 점검표가 없다");
  assert.ok(attachmentCategoriesForOwner("PRODUCT_MODEL").includes("CHECKLIST"), "모델 선택지에 점검표가 없다");
  // 두 목록에서 자리(차례)도 같다 — 기타 바로 앞이다.
  for (const owner of ["REPAIR_CASE", "PRODUCT_MODEL"] as const) {
    const choices = attachmentCategoriesForOwner(owner);
    assert.equal(choices[choices.indexOf("CHECKLIST") + 1], "OTHER", owner);
  }
});

test("「통전검사」 코드는 이 저장소가 이미 쓰는 말이다 — POWER_TEST", () => {
  // 새 말을 만들지 않았다. xlsx/oh-quote-template.ts 가 POWER_TEST 의 이름표를
  // 「통전검사」로 적고, quote_work_scope_section · repair_labor_scope 두 DB enum 도
  // 통전을 POWER_TEST 로 적는다. 여기만 다른 낱말을 쓰면 같은 것을 두 이름으로
  // 부르는 저장소가 된다.
  assert.ok((ATTACHMENT_CATEGORY_CODES as readonly string[]).includes("POWER_TEST"));
  assert.equal(attachmentCategoryLabels.POWER_TEST, "통전검사");
});

test("업무 순서대로 늘어놓는다 — 화면의 고르는 차례가 이 순서다", () => {
  // 인수 → 외관 → 수리 중 → 수리 후 → 출하. 현장에서 사진을 찍는 순서와 같아야
  // 목록에서 찾을 때 헤매지 않는다.
  const photos = ATTACHMENT_CATEGORY_CODES.filter((code) =>
    ["INTAKE_PHOTO", "EXTERNAL_CONDITION", "IN_REPAIR", "AFTER_REPAIR", "SHIPMENT_PHOTO"].includes(code)
  );
  assert.deepEqual(photos, [
    "INTAKE_PHOTO",
    "EXTERNAL_CONDITION",
    "IN_REPAIR",
    "AFTER_REPAIR",
    "SHIPMENT_PHOTO",
  ]);
});

test("검사 보고서는 이름표만 바뀌었다 — 코드는 여전히 INSPECTION_REPORT다", () => {
  // 이름표가 '점검 보고서'에서 '검사 보고서'로 바뀌었다. 바뀐 것은 사람이 보는
  // 글자뿐이고, **코드를 함께 바꾸면 이미 올라간 파일들이 깨진다** — attachments
  // 표의 category 컬럼에 'INSPECTION_REPORT' 가 그대로 적혀 있고, DB enum 에서
  // 그 값을 없애는 순간 그 행들은 어느 분류에도 속하지 않게 된다. 이름표를
  // 고치려다 코드까지 손대는 일을 이 줄이 막는다.
  assert.ok(ATTACHMENT_CATEGORY_CODES.includes("INSPECTION_REPORT"));
  assert.ok(attachmentCategoryEnum.enumValues.includes("INSPECTION_REPORT"));
  assert.equal(attachmentCategoryLabels.INSPECTION_REPORT, "검사 보고서");
});

test("견적서는 수리 보고서 뒤·교산 문서 앞에 있다", () => {
  // 우리가 만들어 고객에게 보내는 문서끼리 모은 자리다. 화면의 고르는 차례가
  // 이 배열 순서 그대로라(AttachmentFilters·ProductModelFilesSection 이 map 한다),
  // 자리가 곧 사용자가 보는 목록의 자리다.
  assert.ok(ATTACHMENT_CATEGORY_CODES.includes("QUOTE"));
  assert.equal(attachmentCategoryLabels.QUOTE, "견적서");
  const quoteIndex = ATTACHMENT_CATEGORY_CODES.indexOf("QUOTE");
  assert.equal(ATTACHMENT_CATEGORY_CODES[quoteIndex - 1], "REPAIR_REPORT");
  assert.equal(ATTACHMENT_CATEGORY_CODES[quoteIndex + 1], "KYOSAN_DOCUMENT");
});

test("기타는 언제나 목록의 맨 끝이다", () => {
  // 사람이 목록을 훑을 때의 관례다 — '기타'가 가운데 있으면 그 뒤의 분류들은
  // 사실상 읽히지 않는다. 새 분류를 더할 때 끝에 붙이지 않도록 못 박는다.
  assert.equal(ATTACHMENT_CATEGORY_CODES[ATTACHMENT_CATEGORY_CODES.length - 1], "OTHER");
});

test("모든 분류에 한국어 라벨이 있다", () => {
  for (const code of ATTACHMENT_CATEGORY_CODES) {
    assert.ok(attachmentCategoryLabels[code]?.trim().length > 0, `${code}에 라벨이 없다`);
  }
  assert.equal(Object.keys(attachmentCategoryLabels).length, ATTACHMENT_CATEGORY_CODES.length);
});

test("모든 검사 상태에 한국어 라벨이 있다", () => {
  for (const code of MALWARE_SCAN_STATUS_CODES) {
    assert.ok(malwareScanStatusLabels[code]?.trim().length > 0, `${code}에 라벨이 없다`);
  }
  assert.equal(Object.keys(malwareScanStatusLabels).length, MALWARE_SCAN_STATUS_CODES.length);
});

// ─────────────────────────────────────────────────────────── 좁히기 함수

test("목록에 없는 값은 분류로 인정되지 않는다", () => {
  assert.equal(isAttachmentCategory("INTAKE_PHOTO"), true);
  assert.equal(isAttachmentCategory("SHIPMENT_APPROVAL_EVIDENCE"), false);
  assert.equal(isAttachmentCategory("intake_photo"), false);
  assert.equal(isAttachmentCategory(""), false);
});

// ─────────────────────────────────── 분류와 주인의 짝 (2026-09-13)

test("주인 종류는 셋이다 — 첨부 표의 세 주인 칸(접수 건 · 제품 모델 · 견적서)", () => {
  assert.deepEqual([...ATTACHMENT_OWNER_KINDS], ["REPAIR_CASE", "PRODUCT_MODEL", "QUOTE"]);
});

test("스크린샷은 어느 주인에도 붙지 않는다 — 값은 남기고 새로 들어올 길만 막는다", () => {
  // 값을 목록에서 빼지 않는 것은 DB enum(attachment_category)과 이미 그 값으로
  // 저장된 행 때문이다(attachment-category.ts 의 OWNERLESS_ATTACHMENT_CATEGORIES).
  assert.ok((ATTACHMENT_CATEGORY_CODES as readonly string[]).includes("SCREENSHOT"));
  for (const owner of ATTACHMENT_OWNER_KINDS) {
    assert.equal(isAttachmentCategoryAllowedForOwner("SCREENSHOT", owner), false, owner);
  }
});

test("접수 건 · 제품 모델의 선택지는 정해진 것만 빠진 목록이다 — 차례는 그대로", () => {
  // 화면(FilesScreen · ProductModelFilesSection)이 이 목록을 그대로 map 한다. 차례가
  // 바뀌면 사람이 보는 고르는 차례가 바뀐다.
  //
  // 빼는 것은 주인 없는 스크린샷과 견적서 두 칸 — 그리고 접수 건에서는 모델 전용
  // 셋이 더 빠진다(2026-09-30). 제품 모델 쪽에서 빠지는 것은 여전히 셋뿐이다.
  const ownerless = ["SCREENSHOT", "SIGNED_QUOTE_PDF", "QUOTE_EXCEL"];
  // 🔴 **둘이다** — 점검표는 수리 건에도 붙으므로 여기 없다(2026-09-30 정정).
  const modelOnly = ["PARAMETER", "POWER_TEST"];

  const productModelExpected = ATTACHMENT_CATEGORY_CODES.filter((code) => !ownerless.includes(code));
  const repairCaseExpected = productModelExpected.filter((code) => !modelOnly.includes(code));
  assert.equal(productModelExpected.length, ATTACHMENT_CATEGORY_CODES.length - 3);
  assert.equal(repairCaseExpected.length, ATTACHMENT_CATEGORY_CODES.length - 5);
  assert.deepEqual(attachmentCategoriesForOwner("REPAIR_CASE"), repairCaseExpected);
  assert.deepEqual(attachmentCategoriesForOwner("PRODUCT_MODEL"), productModelExpected);
  // 수리 건 파일 탭의 「견적서」(QUOTE) 분류는 그대로 남는다 — 견적서 주인 전용 두 칸과 다른 것이다.
  assert.ok(attachmentCategoriesForOwner("REPAIR_CASE").includes("QUOTE"));
  assert.ok(attachmentCategoriesForOwner("PRODUCT_MODEL").includes("QUOTE"));
  // 기타는 여전히 맨 끝이다.
  assert.equal(attachmentCategoriesForOwner("REPAIR_CASE").at(-1), "OTHER");
});

// ─────────────────────────────────── 견적서 주인 (2026-09-15)

test("견적서에는 결재 PDF · 엑셀 두 칸만 붙는다 — 다른 분류는 모두 거절", () => {
  assert.deepEqual([...QUOTE_ATTACHMENT_SLOT_CATEGORIES], ["SIGNED_QUOTE_PDF", "QUOTE_EXCEL"]);
  assert.deepEqual(attachmentCategoriesForOwner("QUOTE"), ["SIGNED_QUOTE_PDF", "QUOTE_EXCEL"]);
  for (const code of ATTACHMENT_CATEGORY_CODES) {
    const expected = code === "SIGNED_QUOTE_PDF" || code === "QUOTE_EXCEL";
    assert.equal(isAttachmentCategoryAllowedForOwner(code, "QUOTE"), expected, code);
  }
  // 수리 건 파일 탭의 「견적서」(QUOTE) 분류도 견적서 주인에는 붙지 않는다 — 이름만 비슷하다.
  assert.equal(isAttachmentCategoryAllowedForOwner("QUOTE", "QUOTE"), false);
  // 「기타」도 없다 — 견적서에는 정해진 두 칸뿐이다.
  assert.equal(isAttachmentCategoryAllowedForOwner("OTHER", "QUOTE"), false);
});

test("견적서 두 칸은 견적서 전용이다 — 접수 건 · 제품 모델에는 쓸 수 없다", () => {
  for (const code of QUOTE_ATTACHMENT_SLOT_CATEGORIES) {
    assert.equal(isQuoteAttachmentSlotCategory(code), true, code);
    assert.equal(isAttachmentCategoryAllowedForOwner(code, "QUOTE"), true, code);
    for (const owner of ["REPAIR_CASE", "PRODUCT_MODEL"] as const) {
      assert.equal(isAttachmentCategoryAllowedForOwner(code, owner), false, `${code} → ${owner}`);
    }
  }
  assert.equal(isQuoteAttachmentSlotCategory("QUOTE"), false);
  assert.equal(isQuoteAttachmentSlotCategory("SCREENSHOT"), false);
  assert.equal(isQuoteAttachmentSlotCategory("OTHER"), false);
});

test("주인 없는 분류는 스크린샷 하나뿐이다 — 나머지는 모두 붙을 자리가 있다", () => {
  // 예전에는 「모든 분류는 적어도 한 주인에 붙는다」였다. 스크린샷을 쓰던 기능이
  // 걷히면서 그 분류만 주인을 잃었고, 값은 DB enum·기존 행 때문에 남겨 둔다.
  // 목록으로 못박아 두면 **다른** 분류가 주인을 잃는 날 여기서 걸린다.
  const ownerless = ATTACHMENT_CATEGORY_CODES.filter(
    (code) => !ATTACHMENT_OWNER_KINDS.some((owner) => isAttachmentCategoryAllowedForOwner(code, owner))
  );
  assert.deepEqual(ownerless, ["SCREENSHOT"]);
});

test("견적서의 한 칸에는 파일 하나 — 같은 칸의 살아 있는 파일만 밀려난다", () => {
  assert.equal(QUOTE_ATTACHMENT_FILES_PER_SLOT, 1);
  const existing = [
    { id: "pdf-old", category: "SIGNED_QUOTE_PDF", isDeleted: false },
    { id: "pdf-trashed", category: "SIGNED_QUOTE_PDF", isDeleted: true },
    { id: "excel-old", category: "QUOTE_EXCEL", isDeleted: false },
  ] as const;
  assert.deepEqual(quoteAttachmentIdsDisplacedBy(existing, "SIGNED_QUOTE_PDF"), ["pdf-old"]);
  assert.deepEqual(quoteAttachmentIdsDisplacedBy(existing, "QUOTE_EXCEL"), ["excel-old"]);
  // 빈 칸에 처음 올리면 밀려나는 것이 없다.
  assert.deepEqual(quoteAttachmentIdsDisplacedBy([], "QUOTE_EXCEL"), []);
  assert.deepEqual(
    quoteAttachmentIdsDisplacedBy([{ id: "excel-trashed", category: "QUOTE_EXCEL", isDeleted: true }], "QUOTE_EXCEL"),
    []
  );
});

test("견적서의 한 칸에 지금 붙어 있는 파일 — 살아 있는 그 칸의 것, 겹치면 가장 나중에 올린 것", () => {
  const existing = [
    { id: "pdf-trashed", category: "SIGNED_QUOTE_PDF", isDeleted: true, uploadedAt: "2026-09-15T03:00:00.000Z" },
    { id: "pdf-live", category: "SIGNED_QUOTE_PDF", isDeleted: false, uploadedAt: "2026-09-15T01:00:00.000Z" },
    { id: "excel-live", category: "QUOTE_EXCEL", isDeleted: false, uploadedAt: new Date("2026-09-15T02:00:00.000Z") },
  ] as const;
  // 🔴 휴지통의 것은 더 나중에 올렸어도 칸의 파일이 아니다(교체로 밀려난 옛 파일).
  assert.equal(liveQuoteAttachmentInSlot(existing, "SIGNED_QUOTE_PDF")?.id, "pdf-live");
  assert.equal(liveQuoteAttachmentInSlot(existing, "QUOTE_EXCEL")?.id, "excel-live");
  assert.equal(liveQuoteAttachmentInSlot([], "QUOTE_EXCEL"), null);
  assert.equal(liveQuoteAttachmentInSlot(existing.slice(0, 2), "QUOTE_EXCEL"), null, "다른 칸의 파일은 고르지 않는다");

  // 규칙을 거치지 않은 행이 겹쳐 있으면 가장 나중에 올린 것 — 시각이 같으면 id 로 가른다.
  const overlapped = [
    { id: "b-old", category: "QUOTE_EXCEL", isDeleted: false, uploadedAt: "2026-09-15T01:00:00.000Z" },
    { id: "c-new", category: "QUOTE_EXCEL", isDeleted: false, uploadedAt: "2026-09-15T05:00:00.000Z" },
    { id: "a-new", category: "QUOTE_EXCEL", isDeleted: false, uploadedAt: "2026-09-15T05:00:00.000Z" },
  ] as const;
  assert.equal(liveQuoteAttachmentInSlot(overlapped, "QUOTE_EXCEL")?.id, "c-new");
  assert.equal(liveQuoteAttachmentInSlot([...overlapped].reverse(), "QUOTE_EXCEL")?.id, "c-new", "넘긴 차례와 무관하다");
});

test("목록에 없는 값은 검사 상태로 인정되지 않는다", () => {
  assert.equal(isMalwareScanStatus("CLEAN"), true);
  // 데모 파일 쪽 값이다. 두 목록을 섞어 쓰면 안 된다.
  assert.equal(isMalwareScanStatus("BLOCKED"), false);
  assert.equal(isMalwareScanStatus("ERROR"), false);
});
