import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ATTACHMENT_CATEGORY_CODES,
  ATTACHMENT_OWNER_KINDS,
  DEFAULT_MALWARE_SCAN_STATUS,
  IMPROVEMENT_REQUEST_ATTACHMENT_CATEGORY,
  MALWARE_SCAN_STATUS_CODES,
  QUOTE_ATTACHMENT_FILES_PER_SLOT,
  QUOTE_ATTACHMENT_SLOT_CATEGORIES,
  attachmentCategoriesForOwner,
  attachmentCategoryLabels,
  isAttachmentCategory,
  isAttachmentCategoryAllowedForOwner,
  isMalwareScanStatus,
  isQuoteAttachmentSlotCategory,
  malwareScanStatusLabels,
  quoteAttachmentIdsDisplacedBy,
} from "./attachment-category";
import {
  ATTACHMENT_CATEGORY_CODES as DEMO_CATEGORY_CODES,
  attachmentCategoryLabels as demoCategoryLabels,
} from "./local/attachments/attachment-types";
import { attachmentCategoryEnum, malwareScanStatusEnum } from "@/lib/db/schema/attachments";

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
// QUOTE_EXCEL(2026-09-15)은 정본과 DB enum 에만 있고 데모에는 없다 — 데모 계층은
// 손대지 않는다(attachment-category.ts 헤더의 '데모 파일과의 관계'). 그래서 아래 두
// 대조는 「정본에서 그 셋을 뺀 것 = 데모」를 본다. 빼는 것은 그 세 값뿐이라, 다른
// 한 줄이라도 어긋나면 여전히 걸린다.
const DEMO_ABSENT_CATEGORIES: readonly string[] = ["SCREENSHOT", "SIGNED_QUOTE_PDF", "QUOTE_EXCEL"];

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

test("분류 코드는 18종이고 중복이 없다", () => {
  // 개수를 적어 두는 이유는 **DB enum과 함께 움직이기 때문**이다. 코드에만
  // 더하고 마이그레이션을 잊으면 화면에서는 고를 수 있는데 저장할 때 서버가
  // 거절한다 — 그 어긋남이 이 줄에서 먼저 걸린다.
  //
  // 11 → 14: 수리 중·수리 후·출하 사진을 더했다(마이그레이션 0047).
  // 14 → 15: 견적서를 더했다(마이그레이션 0083).
  // 15 → 16: 스크린샷을 더했다(마이그레이션 0097 — 개선 요청 글의 화면 사진).
  // 16 → 18: 결재 견적서 PDF · 수기 견적서 엑셀을 더했다(마이그레이션 0099 — 견적서 첨부).
  assert.equal(ATTACHMENT_CATEGORY_CODES.length, 18);
  assert.equal(new Set(ATTACHMENT_CATEGORY_CODES).size, 18);
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

test("견적서 두 칸은 스크린샷 뒤·기타 앞에 결재 PDF · 엑셀 차례로 있다", () => {
  // 0099 가 둘 다 `ADD VALUE ... BEFORE 'OTHER'` 로 더한다 — DB enum 과 같은 차례인지는
  // 위 enum 대조가 따로 본다.
  assert.equal(attachmentCategoryLabels.SIGNED_QUOTE_PDF, "결재 견적서 PDF");
  assert.equal(attachmentCategoryLabels.QUOTE_EXCEL, "수기 견적서 엑셀");
  const index = ATTACHMENT_CATEGORY_CODES.indexOf("SIGNED_QUOTE_PDF");
  assert.equal(ATTACHMENT_CATEGORY_CODES[index - 1], "SCREENSHOT");
  assert.equal(ATTACHMENT_CATEGORY_CODES[index + 1], "QUOTE_EXCEL");
  assert.equal(ATTACHMENT_CATEGORY_CODES[index + 2], "OTHER");
  assert.ok(attachmentCategoryEnum.enumValues.includes("SIGNED_QUOTE_PDF"));
  assert.ok(attachmentCategoryEnum.enumValues.includes("QUOTE_EXCEL"));
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

test("주인 종류는 넷이다 — 첨부 표의 네 주인 칸(접수 건 · 제품 모델 · 개선 요청 · 견적서)", () => {
  assert.deepEqual([...ATTACHMENT_OWNER_KINDS], ["REPAIR_CASE", "PRODUCT_MODEL", "IMPROVEMENT_REQUEST", "QUOTE"]);
});

test("스크린샷은 개선 요청 전용이다 — 접수 건 · 제품 모델 · 견적서에는 쓸 수 없다", () => {
  assert.equal(IMPROVEMENT_REQUEST_ATTACHMENT_CATEGORY, "SCREENSHOT");
  assert.equal(isAttachmentCategoryAllowedForOwner("SCREENSHOT", "IMPROVEMENT_REQUEST"), true);
  assert.equal(isAttachmentCategoryAllowedForOwner("SCREENSHOT", "REPAIR_CASE"), false);
  assert.equal(isAttachmentCategoryAllowedForOwner("SCREENSHOT", "PRODUCT_MODEL"), false);
  assert.equal(isAttachmentCategoryAllowedForOwner("SCREENSHOT", "QUOTE"), false);
});

test("개선 요청에는 스크린샷만 붙는다 — 다른 분류는 모두 거절", () => {
  assert.deepEqual(attachmentCategoriesForOwner("IMPROVEMENT_REQUEST"), ["SCREENSHOT"]);
  for (const code of ATTACHMENT_CATEGORY_CODES) {
    assert.equal(isAttachmentCategoryAllowedForOwner(code, "IMPROVEMENT_REQUEST"), code === "SCREENSHOT", code);
  }
});

test("접수 건 · 제품 모델의 선택지는 주인 전용 분류 셋만 빠진 목록이다 — 차례는 그대로", () => {
  // 화면(FilesScreen · ProductModelFilesSection)이 이 목록을 그대로 map 한다. 차례가
  // 바뀌면 사람이 보는 고르는 차례가 바뀐다 — 빼는 것은 스크린샷과 견적서 두 칸뿐이어야 한다.
  const withoutOwnerOnly = ATTACHMENT_CATEGORY_CODES.filter(
    (code) => !["SCREENSHOT", "SIGNED_QUOTE_PDF", "QUOTE_EXCEL"].includes(code)
  );
  assert.equal(withoutOwnerOnly.length, ATTACHMENT_CATEGORY_CODES.length - 3);
  assert.deepEqual(attachmentCategoriesForOwner("REPAIR_CASE"), withoutOwnerOnly);
  assert.deepEqual(attachmentCategoriesForOwner("PRODUCT_MODEL"), withoutOwnerOnly);
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

test("견적서 두 칸은 견적서 전용이다 — 접수 건 · 제품 모델 · 개선 요청에는 쓸 수 없다", () => {
  for (const code of QUOTE_ATTACHMENT_SLOT_CATEGORIES) {
    assert.equal(isQuoteAttachmentSlotCategory(code), true, code);
    assert.equal(isAttachmentCategoryAllowedForOwner(code, "QUOTE"), true, code);
    for (const owner of ["REPAIR_CASE", "PRODUCT_MODEL", "IMPROVEMENT_REQUEST"] as const) {
      assert.equal(isAttachmentCategoryAllowedForOwner(code, owner), false, `${code} → ${owner}`);
    }
  }
  assert.equal(isQuoteAttachmentSlotCategory("QUOTE"), false);
  assert.equal(isQuoteAttachmentSlotCategory("SCREENSHOT"), false);
  assert.equal(isQuoteAttachmentSlotCategory("OTHER"), false);
});

test("모든 분류는 적어도 한 주인에 붙는다 — 쓸 곳 없는 분류가 생기지 않는다", () => {
  for (const code of ATTACHMENT_CATEGORY_CODES) {
    const owners = ATTACHMENT_OWNER_KINDS.filter((owner) => isAttachmentCategoryAllowedForOwner(code, owner));
    assert.ok(owners.length > 0, `${code} 는 어느 주인에도 붙지 않는다`);
  }
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

test("목록에 없는 값은 검사 상태로 인정되지 않는다", () => {
  assert.equal(isMalwareScanStatus("CLEAN"), true);
  // 데모 파일 쪽 값이다. 두 목록을 섞어 쓰면 안 된다.
  assert.equal(isMalwareScanStatus("BLOCKED"), false);
  assert.equal(isMalwareScanStatus("ERROR"), false);
});
