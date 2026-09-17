import { test } from "node:test";
import assert from "node:assert/strict";

import { ATTACHMENT_OWNER_KINDS, MALWARE_SCAN_STATUS_CODES, type MalwareScanStatus } from "./attachment-category";
import {
  ATTACHMENT_OWNER_PERMISSIONS,
  attachmentOwnerKindOf,
  decideAttachmentDownload,
  hasAnyAttachmentOwnerAccess,
  isAttachmentOwnerAccessAllowed,
  isDetachedAttachment,
  resolveAttachmentOwnerAccess,
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
    quoteId: null,
    isDeleted: false,
    quoteInTrash: false,
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
    quoteId: null,
    isDeleted: false,
    quoteInTrash: false,
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
  const none = { quoteId: null };
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

// ─────────────────────────────────────────── 견적서가 주인인 첨부 (셋째 주인, 2026-09-15 Q2)

const QUOTE_ID = "e2b61d09-0000-4000-8000-000000000004";

/** 판정에 걸리지 않는, 아무 문제 없는 **견적서** 첨부(결재 PDF · 수기 엑셀). */
function healthyQuoteSubject(overrides: Partial<AttachmentDownloadSubject> = {}): AttachmentDownloadSubject {
  return {
    repairCaseId: null,
    productModelId: null,
    quoteId: QUOTE_ID,
    isDeleted: false,
    quoteInTrash: false,
    malwareScanStatus: "CLEAN",
    ...overrides,
  };
}

test("isDetachedAttachment — 견적서만 주인이면 주인이 있다(Q1 까지는 「주인 없음」으로 막혔다)", () => {
  // 🔴 견적서 첨부는 앞의 두 칸이 원래 NULL 이다. 여기서 참이 되면 결재 PDF · 수기 엑셀이
  // 전부 DETACHED 로 막힌다 — Q1 에서 타입으로만 막아 두었던 바로 그 상태다.
  assert.equal(
    isDetachedAttachment({ repairCaseId: null, productModelId: null, quoteId: QUOTE_ID }),
    false
  );
  // 런타임에 견적서 칸이 빠져 와도 NULL 과 같이 본다(닫히는 쪽) · 빈 문자열은 NULL 이 아니다.
  assert.equal(
    isDetachedAttachment({ repairCaseId: null, productModelId: null } as AttachmentOwnerRef),
    true
  );
  assert.equal(
    isDetachedAttachment({ repairCaseId: null, productModelId: null, quoteId: "" }),
    false
  );
});

test("견적서가 주인이면 통과한다 — 파일 휴지통 · 검사 규칙은 다른 주인과 같은 답이다", () => {
  assert.equal(decideAttachmentDownload(healthyQuoteSubject()).allowed, true);

  const deleted = decideAttachmentDownload(healthyQuoteSubject({ isDeleted: true }));
  assert.equal(deleted.allowed === false && deleted.reason, "DELETED");

  for (const status of MALWARE_SCAN_STATUS_CODES) {
    const caseDecision = decideAttachmentDownload(healthySubject({ malwareScanStatus: status }));
    const quoteDecision = decideAttachmentDownload(healthyQuoteSubject({ malwareScanStatus: status }));
    assert.equal(quoteDecision.allowed, caseDecision.allowed, `${status} 의 답이 주인에 따라 갈렸다`);
  }
});

test("🔴 휴지통에 있는 견적서의 파일은 내려받지 못한다 — 파일이 살아 있어도 QUOTE_IN_TRASH", () => {
  // 견적서를 휴지통에 넣으면 그 파일도 첨부 휴지통으로 가지만, 판정은 파일 표시가 아니라
  // **주인의 휴지통**을 따로 본다 — 어떤 까닭으로든 표시가 어긋난 파일도 새지 않는다.
  const decision = decideAttachmentDownload(healthyQuoteSubject({ quoteInTrash: true }));
  assert.equal(decision.allowed, false);
  if (decision.allowed === false) {
    assert.equal(decision.reason, "QUOTE_IN_TRASH");
    // 무엇을 하면 되는지 — 파일이 아니라 견적서를 되살린다.
    assert.ok(decision.message.includes("견적서를 되살린"), decision.message);
    assert.ok(!decision.message.includes("quotes/"), "내부 경로가 담겼다");
  }
});

test("견적서 휴지통은 파일 휴지통보다 앞이다 — 둘이 겹칠 때 「파일을 복원하라」는 틀린 길이다", () => {
  const decision = decideAttachmentDownload(
    healthyQuoteSubject({ quoteInTrash: true, isDeleted: true, malwareScanStatus: "INFECTED" })
  );
  assert.equal(decision.allowed === false && decision.reason, "QUOTE_IN_TRASH");
  // 주인 없음은 여전히 맨 앞이다.
  const detached = decideAttachmentDownload(healthyQuoteSubject({ quoteId: null, quoteInTrash: true }));
  assert.equal(detached.allowed === false && detached.reason, "DETACHED");
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
    quoteId: null,
    isDeleted: true,
    quoteInTrash: false,
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
    quoteId: null,
    isDeleted: true,
    quoteInTrash: false,
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
    healthyQuoteSubject({ quoteInTrash: true }),
    healthyQuoteSubject({ isDeleted: true }),
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
  // 이 문장이 나가는 때는 FK 가 모두 NULL 인 때다. 그때는 이 파일이 어디에 붙어
  // 있었는지를 알 방법이 남아 있지 않다(모두 ON DELETE SET NULL). "접수 건이 없어져"
  // 라고 적으면 모델 회로도를 열려던 사람에게 사실이 아닌 안내가 나간다.
  const decision = decideAttachmentDownload(
    healthySubject({ repairCaseId: null, productModelId: null })
  );
  assert.equal(decision.allowed, false);
  if (decision.allowed === false) {
    assert.equal(decision.reason, "DETACHED");
    assert.ok(!decision.message.includes("접수 건"), "주인이 접수 건이라고 단정하고 있다");
    assert.ok(!decision.message.includes("모델"), "주인이 모델이라고 단정하고 있다");
    // 셋째 주인(견적서)이 생긴 뒤에도 같은 원칙이다.
    assert.ok(!decision.message.includes("개선 요청"), "주인이 개선 요청이라고 단정하고 있다");
    assert.ok(!decision.message.includes("견적서"), "주인이 견적서라고 단정하고 있다");
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

// ─────────────────────────────────────────── 주인 종류 → 물을 권한 (2026-09-13 · 견적서 2026-09-15 Q2)
//
// 내려받기 · 미리보기 PUT · 지우기 액션이 모두 이 두 함수로 권한을 고른다. 여기서
// 못박는 것: 넓은 문턱은 셋 중 하나라도 있으면 넘고, 주인별 판정은 **그 주인의**
// 권한만 본다(다른 주인의 권한으로 새지 않는다). 주인 없는 첨부는 예전처럼 접수 건
// 권한으로 본다.

const ALL_ACCESS: AttachmentOwnerAccess = {
  REPAIR_CASE: true,
  PRODUCT_MODEL: true,
  QUOTE: true,
};
const NO_ACCESS: AttachmentOwnerAccess = {
  REPAIR_CASE: false,
  PRODUCT_MODEL: false,
  QUOTE: false,
};

const OWNERS: Record<"REPAIR_CASE" | "PRODUCT_MODEL" | "QUOTE", AttachmentOwnerRef> = {
  REPAIR_CASE: { repairCaseId: CASE_ID, productModelId: null, quoteId: null },
  PRODUCT_MODEL: { repairCaseId: null, productModelId: MODEL_ID, quoteId: null },
  QUOTE: { repairCaseId: null, productModelId: null, quoteId: QUOTE_ID },
};
const DETACHED_OWNER: AttachmentOwnerRef = {
  repairCaseId: null,
  productModelId: null,
  quoteId: null,
};

test("attachmentOwnerKindOf — 채워진 칸이 주인 종류다. 모두 비면 null", () => {
  for (const [kind, owner] of Object.entries(OWNERS)) {
    assert.equal(attachmentOwnerKindOf(owner), kind);
  }
  assert.equal(attachmentOwnerKindOf(DETACHED_OWNER), null);
  // 표가 주인 종류 전부를 덮는다 — 주인이 늘면 이 줄이 먼저 깨진다.
  assert.deepEqual(Object.keys(OWNERS).sort(), [...ATTACHMENT_OWNER_KINDS].sort());
});

test("넓은 문턱 — 셋 중 하나라도 있으면 넘고, 하나도 없으면 막힌다", () => {
  assert.equal(hasAnyAttachmentOwnerAccess(NO_ACCESS), false);
  for (const kind of ATTACHMENT_OWNER_KINDS) {
    assert.equal(hasAnyAttachmentOwnerAccess({ ...NO_ACCESS, [kind]: true }), true, kind);
  }
});

test("주인별 판정 — 그 주인의 권한만 본다. 다른 주인의 권한으로는 열리지 않는다(404 쪽)", () => {
  for (const [kind, owner] of Object.entries(OWNERS) as Array<[keyof typeof OWNERS, AttachmentOwnerRef]>) {
    assert.equal(isAttachmentOwnerAccessAllowed(owner, { ...NO_ACCESS, [kind]: true }), true, `${kind} 권한으로 ${kind}`);
    // 🔴 이 주인의 권한만 빼면 나머지가 다 있어도 막힌다 — 모델 회로도나
    // 견적서 파일이 접수 건 파일 권한으로 열리거나 지워지면 안 된다.
    assert.equal(isAttachmentOwnerAccessAllowed(owner, { ...ALL_ACCESS, [kind]: false }), false, `${kind} 권한 없이 ${kind}`);
  }
});

test("주인 없는 첨부는 예전처럼 접수 건 권한으로 본다 — 그 뒤 판정이 DETACHED 로 막는다", () => {
  assert.equal(isAttachmentOwnerAccessAllowed(DETACHED_OWNER, { ...NO_ACCESS, REPAIR_CASE: true }), true);
  assert.equal(isAttachmentOwnerAccessAllowed(DETACHED_OWNER, { ...ALL_ACCESS, REPAIR_CASE: false }), false);
});

// ─────────────────────────────────────────── 물을 권한의 표 (2026-09-15 Q2)

test("🔴 견적서 파일 — 내려받기는 quotes READ, 바꾸기(미리보기 · 지우기 · 되살리기 · 올리기)는 quotes WRITE", () => {
  assert.deepEqual(ATTACHMENT_OWNER_PERMISSIONS.VIEW.QUOTE, { areaKey: "quotes", level: "READ" });
  assert.deepEqual(ATTACHMENT_OWNER_PERMISSIONS.CHANGE.QUOTE, { areaKey: "quotes", level: "WRITE" });
});

test("다른 주인의 권한은 표로 옮기기 전과 한 글자도 같다 — 모델을 **보는** 것은 files 가 아니라 view", () => {
  // 예전에는 라우트 · 액션마다 hasPermission 을 한 줄씩 적었다. 그 값을 그대로 옮긴 표다.
  assert.deepEqual(ATTACHMENT_OWNER_PERMISSIONS, {
    VIEW: {
      REPAIR_CASE: { areaKey: "repairCases.files", level: "READ" },
      PRODUCT_MODEL: { areaKey: "productModels.view", level: "READ" },
      QUOTE: { areaKey: "quotes", level: "READ" },
    },
    CHANGE: {
      REPAIR_CASE: { areaKey: "repairCases.files", level: "WRITE" },
      PRODUCT_MODEL: { areaKey: "productModels.files", level: "WRITE" },
      QUOTE: { areaKey: "quotes", level: "WRITE" },
    },
  });
});

test("resolveAttachmentOwnerAccess — 표대로 묻고, 답을 그 주인의 칸에 채운다", async () => {
  const asked: string[] = [];
  // 견적서 READ 만 가진 사람 — 견적서를 볼 수만 있는 역할.
  const granted = new Set(["quotes:READ"]);
  const check = async (areaKey: string, level: "READ" | "WRITE") => {
    asked.push(`${areaKey}:${level}`);
    return granted.has(`${areaKey}:${level}`);
  };

  const view = await resolveAttachmentOwnerAccess("VIEW", check);
  assert.deepEqual(view, { REPAIR_CASE: false, PRODUCT_MODEL: false, QUOTE: true });
  // 넓은 문턱은 넘고, 견적서 파일만 열린다.
  assert.equal(hasAnyAttachmentOwnerAccess(view), true);
  assert.equal(isAttachmentOwnerAccessAllowed(OWNERS.QUOTE, view), true);
  assert.equal(isAttachmentOwnerAccessAllowed(OWNERS.REPAIR_CASE, view), false);

  // 🔴 같은 사람은 견적서 파일을 지우거나 되살리지 못한다 — 바꾸기는 WRITE 다.
  const change = await resolveAttachmentOwnerAccess("CHANGE", check);
  assert.deepEqual(change, NO_ACCESS);
  assert.equal(hasAnyAttachmentOwnerAccess(change), false);

  // 주인 종류마다 한 번씩, 그 차례대로 물었다.
  assert.deepEqual(asked, [
    "repairCases.files:READ",
    "productModels.view:READ",
    "quotes:READ",
    "repairCases.files:WRITE",
    "productModels.files:WRITE",
    "quotes:WRITE",
  ]);
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
