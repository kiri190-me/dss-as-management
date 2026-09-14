import { test } from "node:test";
import assert from "node:assert/strict";

import { MALWARE_SCAN_STATUS_CODES, type MalwareScanStatus } from "./attachment-category";
import {
  attachmentOwnerKindOf,
  decideAttachmentDownload,
  hasAnyAttachmentOwnerAccess,
  isAttachmentOwnerAccessAllowed,
  isDetachedAttachment,
  type AttachmentDownloadSubject,
  type AttachmentOwnerAccess,
  type AttachmentOwnerRef,
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

const CASE_ID = "d1f5c0a2-0000-4000-8000-000000000001";
const MODEL_ID = "b7c93e14-0000-4000-8000-000000000002";

/** 판정에 걸리지 않는, 아무 문제 없는 **접수 건** 첨부. 각 테스트가 한 칸만 바꾼다. */
function healthySubject(overrides: Partial<AttachmentDownloadSubject> = {}): AttachmentDownloadSubject {
  return {
    repairCaseId: CASE_ID,
    productModelId: null,
    improvementRequestId: null,
    isDeleted: false,
    malwareScanStatus: "CLEAN",
    ...overrides,
  };
}

/**
 * 판정에 걸리지 않는, 아무 문제 없는 **제품 모델** 첨부.
 *
 * 접수 건 쪽과 대칭으로 둔다 — 두 벌이 있어야 "모델 첨부에만 다르게 적용되는
 * 규칙"이 생기는 순간 그 자리에서 드러난다. 실제로 이 판정 함수에 그런 규칙은
 * 하나도 없어야 한다(주인에 따라 갈리는 것은 물을 권한뿐이고, 그것은 라우트의
 * 일이다).
 */
function healthyModelSubject(
  overrides: Partial<AttachmentDownloadSubject> = {}
): AttachmentDownloadSubject {
  return {
    repairCaseId: null,
    productModelId: MODEL_ID,
    improvementRequestId: null,
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

test("주인이 아무도 없는 첨부는 막는다 — 권한을 물을 대상 자체가 없다", () => {
  const decision = decideAttachmentDownload(
    healthySubject({ repairCaseId: null, productModelId: null })
  );
  assert.equal(decision.allowed, false);
  assert.equal(decision.allowed === false && decision.reason, "DETACHED");
});

test("isDetachedAttachment 는 주인 칸이 모두 NULL 인 경우만 참이다", () => {
  const none = { improvementRequestId: null };
  assert.equal(isDetachedAttachment({ repairCaseId: null, productModelId: null, ...none }), true);
  assert.equal(isDetachedAttachment({ repairCaseId: CASE_ID, productModelId: null, ...none }), false);
  // 🔴 모델 첨부는 repair_case_id 가 원래 NULL 이다. 여기서 참이 되면 정상적인
  // 모델 회로도가 전부 DETACHED 로 막힌다.
  assert.equal(isDetachedAttachment({ repairCaseId: null, productModelId: MODEL_ID, ...none }), false);
  // 빈 문자열은 NULL 이 아니다 — DB 제약상 나올 수 없는 값이지만, 판정이
  // "NULL 인가"만 본다는 성질을 고정한다.
  assert.equal(isDetachedAttachment({ repairCaseId: "", productModelId: null, ...none }), false);
  assert.equal(isDetachedAttachment({ repairCaseId: null, productModelId: "", ...none }), false);
});

// ─────────────────────────────────────────── 개선 요청이 주인인 첨부 (셋째 주인)

const IMPROVEMENT_REQUEST_ID = "c4a81f07-0000-4000-8000-000000000003";

test("isDetachedAttachment — 개선 요청만 주인이면 주인이 있다", () => {
  // 🔴 개선 요청 스크린샷은 앞의 두 칸이 원래 NULL 이다. 여기서 참이 되면 정상적인
  // 스크린샷이 전부 DETACHED 로 막힌다(모델 회로도 때와 같은 함정).
  assert.equal(
    isDetachedAttachment({
      repairCaseId: null,
      productModelId: null,
      improvementRequestId: IMPROVEMENT_REQUEST_ID,
    }),
    false
  );
});

test("isDetachedAttachment — 세 주인이 모두 NULL 이면 주인이 없다", () => {
  assert.equal(
    isDetachedAttachment({ repairCaseId: null, productModelId: null, improvementRequestId: null }),
    true
  );
});

test("isDetachedAttachment — 런타임에 개선 요청 칸이 빠져 와도 NULL 과 같이 본다(닫히는 쪽)", () => {
  // 타입으로는 필수 칸이다(S2). 그래도 타입을 거치지 않은 값이 칸 없이 오면 "없음"
  // 으로 본다 — 앞의 두 칸이 NULL 이면 주인 없음(DETACHED)으로 막히는 쪽이다.
  const cases: Array<{ repairCaseId: string | null; productModelId: string | null }> = [
    { repairCaseId: null, productModelId: null },
    { repairCaseId: CASE_ID, productModelId: null },
    { repairCaseId: null, productModelId: MODEL_ID },
  ];
  for (const owner of cases) {
    assert.equal(
      isDetachedAttachment(owner as AttachmentOwnerRef),
      isDetachedAttachment({ ...owner, improvementRequestId: null }),
      JSON.stringify(owner)
    );
  }
  assert.equal(isDetachedAttachment({ repairCaseId: null, productModelId: null } as AttachmentOwnerRef), true);
  // 기존 두 칸과 같은 성질 — 빈 문자열은 NULL 이 아니다.
  assert.equal(
    isDetachedAttachment({ repairCaseId: null, productModelId: null, improvementRequestId: "" }),
    false
  );
});

test("개선 요청이 주인이면 통과한다 — 휴지통·검사 규칙은 그대로 적용된다", () => {
  const subject: AttachmentDownloadSubject = {
    repairCaseId: null,
    productModelId: null,
    improvementRequestId: IMPROVEMENT_REQUEST_ID,
    isDeleted: false,
    malwareScanStatus: "CLEAN",
  };
  assert.equal(decideAttachmentDownload(subject).allowed, true);

  const deleted = decideAttachmentDownload({ ...subject, isDeleted: true });
  assert.equal(deleted.allowed === false && deleted.reason, "DELETED");

  for (const status of MALWARE_SCAN_STATUS_CODES) {
    const caseDecision = decideAttachmentDownload(healthySubject({ malwareScanStatus: status }));
    const improvementDecision = decideAttachmentDownload({ ...subject, malwareScanStatus: status });
    assert.equal(
      improvementDecision.allowed,
      caseDecision.allowed,
      `${status} 의 답이 주인에 따라 갈렸다`
    );
  }
});

test("세 주인 칸이 모두 NULL 이면 DETACHED 로 막힌다 — 개선 요청이 지워져 연결이 끊긴 스크린샷", () => {
  // 개선 요청 글을 지우면 FK(ON DELETE SET NULL)가 이 칸을 비운다. 그 스크린샷은
  // 휴지통으로 가지만(개선 요청 삭제 mutation), 휴지통보다 먼저 주인 없음이 걸린다.
  const decision = decideAttachmentDownload({
    repairCaseId: null,
    productModelId: null,
    improvementRequestId: null,
    isDeleted: false,
    malwareScanStatus: "CLEAN",
  });
  assert.equal(decision.allowed === false && decision.reason, "DETACHED");
});

// ─────────────────────────────────────────── 제품 모델이 주인인 첨부

test("모델이 주인이면 통과한다 — 접수 건이 없다는 이유로 막히지 않는다", () => {
  // 이 단언이 이 파일에서 가장 중요한 한 줄이다. 판정이 예전처럼 repair_case_id
  // 하나만 본다면 모델 회로도는 **단 한 장도** 내려받히지 않는다.
  assert.equal(decideAttachmentDownload(healthyModelSubject()).allowed, true);
});

test("휴지통 규칙이 모델 첨부에도 그대로 적용된다", () => {
  const decision = decideAttachmentDownload(healthyModelSubject({ isDeleted: true }));
  assert.equal(decision.allowed, false);
  assert.equal(decision.allowed === false && decision.reason, "DELETED");
});

test("악성코드 검사 규칙이 모델 첨부에도 그대로 적용된다 — 다섯 상태가 같은 답을 낸다", () => {
  // 주인이 달라도 판정 표는 하나여야 한다. 한쪽에만 예외를 두는 순간 그 종류의
  // 파일만 조용히 다르게 동작하고, 그 사실은 어느 화면에도 드러나지 않는다.
  for (const status of MALWARE_SCAN_STATUS_CODES) {
    const caseDecision = decideAttachmentDownload(healthySubject({ malwareScanStatus: status }));
    const modelDecision = decideAttachmentDownload(healthyModelSubject({ malwareScanStatus: status }));
    assert.equal(modelDecision.allowed, caseDecision.allowed, `${status} 의 답이 주인에 따라 갈렸다`);
  }
});

test("모델 첨부도 세 조건이 겹치면 DETACHED 가 먼저다", () => {
  const decision = decideAttachmentDownload({
    repairCaseId: null,
    productModelId: null,
    improvementRequestId: null,
    isDeleted: true,
    malwareScanStatus: "INFECTED",
  });
  assert.equal(decision.allowed, false);
  assert.equal(decision.allowed === false && decision.reason, "DETACHED");
});

// ─────────────────────────────────────────── 판정 순서

test("세 조건이 겹치면 DETACHED 가 먼저다 — 권한을 물을 수 없는 것이 가장 앞선 사실이다", () => {
  const decision = decideAttachmentDownload({
    repairCaseId: null,
    productModelId: null,
    improvementRequestId: null,
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
    healthySubject({ repairCaseId: null, productModelId: null }),
    healthySubject({ isDeleted: true }),
    healthySubject({ malwareScanStatus: "PENDING" }),
    healthySubject({ malwareScanStatus: "INFECTED" }),
    healthySubject({ malwareScanStatus: "FAILED" }),
    healthyModelSubject({ isDeleted: true }),
    healthyModelSubject({ malwareScanStatus: "INFECTED" }),
  ];
  for (const subject of blocked) {
    const decision = decideAttachmentDownload(subject);
    assert.equal(decision.allowed, false);
    if (decision.allowed === false) {
      assert.ok(decision.message.trim().length > 0, "거부 사유 문장이 비어 있다");
    }
  }
});

test("DETACHED 문장이 주인의 종류를 단정하지 않는다 — 접수 건인지 모델인지 알 수 없는 상태다", () => {
  // 이 문장이 나가는 때는 두 FK 가 모두 NULL 인 때다. 그때는 이 파일이 접수 건에
  // 붙어 있었는지 모델에 붙어 있었는지를 알 방법이 남아 있지 않다(둘 다 ON DELETE
  // SET NULL). "접수 건이 없어져"라고 적으면 모델 회로도를 열려던 사람에게 사실이
  // 아닌 안내가 나간다.
  const decision = decideAttachmentDownload(
    healthySubject({ repairCaseId: null, productModelId: null })
  );
  assert.equal(decision.allowed, false);
  if (decision.allowed === false) {
    assert.equal(decision.reason, "DETACHED");
    assert.ok(!decision.message.includes("접수 건"), "주인이 접수 건이라고 단정하고 있다");
    assert.ok(!decision.message.includes("모델"), "주인이 모델이라고 단정하고 있다");
    // 셋째 주인(개선 요청)이 생긴 뒤에도 같은 원칙이다.
    assert.ok(!decision.message.includes("개선 요청"), "주인이 개선 요청이라고 단정하고 있다");
    // 무엇을 해야 하는지는 그대로 알려 준다 — 사실만 고치고 안내는 남긴다.
    assert.ok(decision.message.includes("관리자에게 문의"), "안내가 사라졌다");
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

// ─────────────────────────────────────────── 주인 종류 → 물을 권한 (2026-09-13)
//
// 내려받기 · 미리보기 PUT · 지우기 액션이 모두 이 두 함수로 권한을 고른다. 여기서
// 못박는 것: 넓은 문턱은 셋 중 하나라도 있으면 넘고, 주인별 판정은 **그 주인의**
// 권한만 본다(다른 주인의 권한으로 새지 않는다). 주인 없는 첨부는 예전처럼 접수 건
// 권한으로 본다.

const ALL_ACCESS: AttachmentOwnerAccess = { REPAIR_CASE: true, PRODUCT_MODEL: true, IMPROVEMENT_REQUEST: true };
const NO_ACCESS: AttachmentOwnerAccess = { REPAIR_CASE: false, PRODUCT_MODEL: false, IMPROVEMENT_REQUEST: false };

const OWNERS: Record<"REPAIR_CASE" | "PRODUCT_MODEL" | "IMPROVEMENT_REQUEST", AttachmentOwnerRef> = {
  REPAIR_CASE: { repairCaseId: CASE_ID, productModelId: null, improvementRequestId: null },
  PRODUCT_MODEL: { repairCaseId: null, productModelId: MODEL_ID, improvementRequestId: null },
  IMPROVEMENT_REQUEST: { repairCaseId: null, productModelId: null, improvementRequestId: IMPROVEMENT_REQUEST_ID },
};
const DETACHED_OWNER: AttachmentOwnerRef = { repairCaseId: null, productModelId: null, improvementRequestId: null };

test("attachmentOwnerKindOf — 채워진 칸이 주인 종류다. 모두 비면 null", () => {
  for (const [kind, owner] of Object.entries(OWNERS)) {
    assert.equal(attachmentOwnerKindOf(owner), kind);
  }
  assert.equal(attachmentOwnerKindOf(DETACHED_OWNER), null);
});

test("넓은 문턱 — 셋 중 하나라도 있으면 넘고, 하나도 없으면 막힌다", () => {
  assert.equal(hasAnyAttachmentOwnerAccess(NO_ACCESS), false);
  for (const kind of ["REPAIR_CASE", "PRODUCT_MODEL", "IMPROVEMENT_REQUEST"] as const) {
    assert.equal(hasAnyAttachmentOwnerAccess({ ...NO_ACCESS, [kind]: true }), true, kind);
  }
});

test("주인별 판정 — 그 주인의 권한만 본다. 다른 주인의 권한으로는 열리지 않는다(404 쪽)", () => {
  for (const [kind, owner] of Object.entries(OWNERS) as Array<[keyof typeof OWNERS, AttachmentOwnerRef]>) {
    assert.equal(isAttachmentOwnerAccessAllowed(owner, { ...NO_ACCESS, [kind]: true }), true, `${kind} 권한으로 ${kind}`);
    // 🔴 이 주인의 권한만 빼면 나머지 둘이 다 있어도 막힌다 — 개선 요청 스크린샷이
    // 접수 건 파일 권한으로 열리거나 지워지면 안 된다(S1 까지는 그랬다).
    assert.equal(isAttachmentOwnerAccessAllowed(owner, { ...ALL_ACCESS, [kind]: false }), false, `${kind} 권한 없이 ${kind}`);
  }
});

test("주인 없는 첨부는 예전처럼 접수 건 권한으로 본다 — 그 뒤 판정이 DETACHED 로 막는다", () => {
  assert.equal(isAttachmentOwnerAccessAllowed(DETACHED_OWNER, { ...NO_ACCESS, REPAIR_CASE: true }), true);
  assert.equal(isAttachmentOwnerAccessAllowed(DETACHED_OWNER, { ...ALL_ACCESS, REPAIR_CASE: false }), false);
});

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
