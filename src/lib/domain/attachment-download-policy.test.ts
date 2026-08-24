import { test } from "node:test";
import assert from "node:assert/strict";

import { MALWARE_SCAN_STATUS_CODES, type MalwareScanStatus } from "./attachment-category";
import {
  decideAttachmentDownload,
  isDetachedAttachment,
  type AttachmentDownloadSubject,
} from "./attachment-download-policy";

/**
 * ============================================================================
 * 이 파일이 지키려는 것 — 조용히 전부 잠기거나, 조용히 새어 나가는 고장
 * ============================================================================
 * 다운로드 허용 판정은 두 방향으로 틀릴 수 있고, 둘 다 겉으로는 조용하다.
 *
 *   ▶ **너무 조이면** 아무 파일도 내려받지 못한다. 지금 DB의 모든 첨부가
 *     NOT_SCANNED 이므로(검사 엔진이 아직 없다) 그 한 값을 막는 것만으로
 *     기능 전체가 죽는다. 화면은 멀쩡해 보이고 버튼도 눌리는데 늘 거부된다.
 *   ▶ **너무 풀면** 감염이 확인된 파일이나 휴지통에 있는 파일이 나간다.
 *
 * 그래서 다섯 상태를 하나씩 못박는다. 표에서 값 하나를 뒤집으면 그 자리에서
 * 이 테스트가 알려 준다 — 뒤집는 것이 의도된 변경이라면 이 테스트를 함께
 * 고치게 되고, 그때 "왜 뒤집는가"를 한 번 더 생각하게 된다.
 * ============================================================================
 */

/** 판정에 걸리지 않는, 아무 문제 없는 첨부. 각 테스트가 여기서 한 칸만 바꾼다. */
function healthySubject(overrides: Partial<AttachmentDownloadSubject> = {}): AttachmentDownloadSubject {
  return {
    repairCaseId: "d1f5c0a2-0000-4000-8000-000000000001",
    isDeleted: false,
    malwareScanStatus: "CLEAN",
    ...overrides,
  };
}

// ─────────────────────────────────────────── 검사 상태 다섯 가지

test("NOT_SCANNED 는 허용이다 — 이 값을 막으면 아무 파일도 내려받지 못한다", () => {
  // 검사 엔진이 아직 없어서 지금 DB의 모든 첨부가 이 상태다. NOT_SCANNED 는
  // "검사해서 깨끗했다"가 아니라 "아직 검사 체계가 없다"는 사실의 기록이다.
  // 검사기를 붙이는 날 이 단언을 함께 고치게 되는데, 그때 기존 행을 검사 큐에
  // 태우는 절차(NOT_SCANNED → PENDING → CLEAN)가 준비돼 있어야 한다.
  const decision = decideAttachmentDownload(healthySubject({ malwareScanStatus: "NOT_SCANNED" }));
  assert.equal(decision.allowed, true, "지금 이 값을 막으면 기능이 있는 척만 하는 상태가 된다");
});

test("CLEAN 은 허용이다", () => {
  assert.equal(decideAttachmentDownload(healthySubject({ malwareScanStatus: "CLEAN" })).allowed, true);
});

test("PENDING 은 막는다 — 검사 결과가 나오기 전에 내보내면 검사를 두는 의미가 없다", () => {
  const decision = decideAttachmentDownload(healthySubject({ malwareScanStatus: "PENDING" }));
  assert.equal(decision.allowed, false);
  assert.equal(decision.allowed === false && decision.reason, "SCAN_BLOCKED");
});

test("INFECTED 는 막는다", () => {
  const decision = decideAttachmentDownload(healthySubject({ malwareScanStatus: "INFECTED" }));
  assert.equal(decision.allowed, false);
  assert.equal(decision.allowed === false && decision.reason, "SCAN_BLOCKED");
});

test("FAILED 는 막는다 — '모른다'는 '괜찮다'가 아니다", () => {
  const decision = decideAttachmentDownload(healthySubject({ malwareScanStatus: "FAILED" }));
  assert.equal(decision.allowed, false);
  assert.equal(decision.allowed === false && decision.reason, "SCAN_BLOCKED");
});

test("정의된 다섯 상태가 모두 판정에서 다뤄진다 — 상태가 늘면 이 테스트가 먼저 깨진다", () => {
  // enum 에 값을 더하고 판정 표를 잊으면 그 값은 막히는 쪽으로 떨어진다(닫히는
  // 쪽 실패라 안전하다). 다만 그 사실을 모르고 지나가지 않도록 개수를 못박는다.
  assert.equal(MALWARE_SCAN_STATUS_CODES.length, 5);
  for (const status of MALWARE_SCAN_STATUS_CODES) {
    const decision = decideAttachmentDownload(healthySubject({ malwareScanStatus: status }));
    // allowed 가 true 든 false 든, 판정이 값을 돌려주기만 하면 된다.
    assert.equal(typeof decision.allowed, "boolean", `${status} 가 판정되지 않았다`);
  }
});

// ─────────────────────────────────────────── 거부 사유 세 가지

test("휴지통에 있으면 막고, 복원하면 받을 수 있다고 알려 준다", () => {
  const decision = decideAttachmentDownload(healthySubject({ isDeleted: true }));
  assert.equal(decision.allowed, false);
  assert.equal(decision.allowed === false && decision.reason, "DELETED");
});

test("접수 건 연결이 끊긴 첨부는 막는다 — 권한을 물을 대상 자체가 없다", () => {
  const decision = decideAttachmentDownload(healthySubject({ repairCaseId: null }));
  assert.equal(decision.allowed, false);
  assert.equal(decision.allowed === false && decision.reason, "DETACHED");
});

test("isDetachedAttachment 는 repair_case_id 가 NULL 인 경우만 참이다", () => {
  assert.equal(isDetachedAttachment(null), true);
  assert.equal(isDetachedAttachment("d1f5c0a2-0000-4000-8000-000000000001"), false);
  // 빈 문자열은 NULL 이 아니다 — DB 제약상 나올 수 없는 값이지만, 판정이
  // "NULL 인가"만 본다는 성질을 고정한다.
  assert.equal(isDetachedAttachment(""), false);
});

// ─────────────────────────────────────────── 판정 순서

test("세 조건이 겹치면 DETACHED 가 먼저다 — 권한을 물을 수 없는 것이 가장 앞선 사실이다", () => {
  const decision = decideAttachmentDownload({
    repairCaseId: null,
    isDeleted: true,
    malwareScanStatus: "INFECTED",
  });
  assert.equal(decision.allowed, false);
  assert.equal(decision.allowed === false && decision.reason, "DETACHED");
});

test("휴지통과 검사 차단이 겹치면 DELETED 가 먼저다", () => {
  const decision = decideAttachmentDownload(
    healthySubject({ isDeleted: true, malwareScanStatus: "INFECTED" })
  );
  assert.equal(decision.allowed, false);
  assert.equal(decision.allowed === false && decision.reason, "DELETED");
});

// ─────────────────────────────────────────── 사용자에게 보이는 문장

test("막을 때는 이유 문장이 항상 비어 있지 않다 — 빈 오류는 고장으로 읽힌다", () => {
  const blocked: AttachmentDownloadSubject[] = [
    healthySubject({ repairCaseId: null }),
    healthySubject({ isDeleted: true }),
    healthySubject({ malwareScanStatus: "PENDING" }),
    healthySubject({ malwareScanStatus: "INFECTED" }),
    healthySubject({ malwareScanStatus: "FAILED" }),
  ];
  for (const subject of blocked) {
    const decision = decideAttachmentDownload(subject);
    assert.equal(decision.allowed, false);
    if (decision.allowed === false) {
      assert.ok(decision.message.trim().length > 0, "거부 사유 문장이 비어 있다");
    }
  }
});

test("이유 문장에 내부 저장 경로가 담기지 않는다", () => {
  // 화면에 그대로 보여 주는 문장이다. 저장 구조를 흘릴 이유가 없다.
  const decision = decideAttachmentDownload(healthySubject({ malwareScanStatus: "INFECTED" }));
  assert.equal(decision.allowed, false);
  if (decision.allowed === false) {
    assert.ok(!decision.message.includes("repair-cases/"));
    assert.ok(!decision.message.includes("uploads"));
    assert.ok(!/[A-Za-z]:\\/.test(decision.message));
  }
});

// ─────────────────────────────────────────── 목록 밖 값

test("판정 표에 없는 상태값이 올라와도 막히는 쪽으로 떨어진다", () => {
  // 옛 코드나 손으로 넣은 SQL 로 목록 밖 값이 들어오는 경우. 열리는 쪽으로
  // 떨어지면 그것이 곧 유출이므로, 닫히는 쪽이어야 한다.
  const decision = decideAttachmentDownload(
    healthySubject({ malwareScanStatus: "SOMETHING_ELSE" as MalwareScanStatus })
  );
  assert.equal(decision.allowed, false);
  if (decision.allowed === false) {
    assert.equal(decision.reason, "SCAN_BLOCKED");
    assert.ok(decision.message.trim().length > 0, "빈 문장이면 화면이 빈 오류를 보인다");
  }
});
