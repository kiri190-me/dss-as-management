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

test("분류 코드는 11종이고 중복이 없다", () => {
  assert.equal(ATTACHMENT_CATEGORY_CODES.length, 11);
  assert.equal(new Set(ATTACHMENT_CATEGORY_CODES).size, 11);
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
