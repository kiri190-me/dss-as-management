import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ATTACHMENT_CATEGORY_CODES,
  DEFAULT_MALWARE_SCAN_STATUS,
  MALWARE_SCAN_STATUS_CODES,
  attachmentCategoryLabels,
  isAttachmentCategory,
  isMalwareScanStatus,
  malwareScanStatusLabels,
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

test("분류 코드가 데모 파일 목록과 순서까지 정확히 같다", () => {
  assert.deepEqual([...ATTACHMENT_CATEGORY_CODES], [...DEMO_CATEGORY_CODES]);
});

test("분류 라벨이 데모 파일과 글자까지 같다", () => {
  // 코드만 맞추고 라벨이 갈리면 같은 파일이 화면마다 다른 이름으로 보인다.
  assert.deepEqual(attachmentCategoryLabels, demoCategoryLabels);
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

test("분류 코드는 14종이고 중복이 없다", () => {
  // 개수를 적어 두는 이유는 **DB enum과 함께 움직이기 때문**이다. 코드에만
  // 더하고 마이그레이션을 잊으면 화면에서는 고를 수 있는데 저장할 때 서버가
  // 거절한다 — 그 어긋남이 이 줄에서 먼저 걸린다.
  //
  // 11 → 14: 수리 중·수리 후·출하 사진을 더했다(마이그레이션 0047).
  assert.equal(ATTACHMENT_CATEGORY_CODES.length, 14);
  assert.equal(new Set(ATTACHMENT_CATEGORY_CODES).size, 14);
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

test("목록에 없는 값은 검사 상태로 인정되지 않는다", () => {
  assert.equal(isMalwareScanStatus("CLEAN"), true);
  // 데모 파일 쪽 값이다. 두 목록을 섞어 쓰면 안 된다.
  assert.equal(isMalwareScanStatus("BLOCKED"), false);
  assert.equal(isMalwareScanStatus("ERROR"), false);
});
