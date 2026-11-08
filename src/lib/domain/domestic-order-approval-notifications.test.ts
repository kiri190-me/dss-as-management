import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  DOMESTIC_ORDER_APPROVAL_LABEL,
  DOMESTIC_ORDER_APPROVAL_TYPE,
} from "./domestic-order-approval-rules";
import { DOMESTIC_ORDER_NO_MODEL_LINK_LABEL } from "./domestic-order-detail-link";
import { domesticOrderDetailHrefs } from "./domestic-order-detail-tabs";
import { ACKNOWLEDGEABLE_NOTIFICATION_KINDS } from "./notification-acknowledgement";
import { canDismissNotification } from "./notification-dismissal";
import {
  NOTIFICATION_KIND_META,
  NO_NOTIFICATION_SETTINGS,
  defaultNotificationKindEnabled,
  defaultRoleReceivesNotification,
  deliversNotification,
} from "./notification-settings";
import {
  NOTIFICATION_KINDS,
  buildApprovalGrantedNotification,
  buildApprovalNotification,
  buildApprovalRejectedNotification,
  buildDomesticOrderApprovalNotification,
  buildQuoteApprovalNotification,
  countNotificationTargetsByKind,
  domesticOrderApprovalSubject,
} from "./notifications";
import { repairCaseDetailHrefs } from "./repair-case-detail-tabs";
import { ROLE_CODES } from "./types";
import { REPAIR_CASE_APPROVAL_TYPES } from "@/lib/validation/repair-case-approval-input";

/**
 * ============================================================================
 * 기타건 결재 알림 — 종 한 줄 · 결과 두 줄 · **주소가 어디로 가는가**
 * ============================================================================
 * 2026-11-06. 기타건 최종 출하 승인(수리 건이 안 붙은 내자 줄의 결재)을 종 ·
 * 통합 승인함 · 결재 메일에 띄우는 조각의 **순수 계산 몫**이다. DB 도 React 도
 * 타지 않는다.
 *
 * ── 🔴 여기서 가장 중요한 것 — 주소 ──────────────────────────────────────
 * 기타건 결재 행은 접수 건 결재와 **같은 표**(`repair_case_approvals`)에 쌓인다.
 * 그래서 `repairCaseDetailHrefs` 를 그대로 베끼기 쉬운데, 베끼면
 * `/repair-cases/{내자줄 uuid}/approval` 로 나가 **404** 다. 🔴 **그 실패는 포털
 * 화면에서만 보인다** — A/S 안에서는 그 주소를 아무도 쓰지 않아 화면도 시험도
 * 조용하다. 그래서 주소를 만드는 자리를 여기서 **직접** 잰다: 기타건은
 * `/domestic-orders/` 로 가고 접수 건은 `/repair-cases/` 그대로다.
 *
 * ── 🔴 「안 섞인다」는 섞일 뻔한 줄이 있을 때만 뜻이 있다 ────────────────
 * 접수 건 승인 종류 목록을 넓히지 않았다는 단언은, 그 목록에 **실제로 값이 둘
 * 있고** 기타건 갈래가 **실제로 존재할 때**만 무엇인가를 지킨다. 그래서 먼저
 * 표본을 못 박은 뒤에 말한다.
 *
 * 🔴 실제 고객사 · 사람 이름 · L/N · S/N 을 적지 않는다 — 전부 가짜 값이다.
 * ============================================================================
 */

const ORDER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CASE_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const QUOTE_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const APPROVAL_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const KIND = "DOMESTIC_ORDER_APPROVAL_PENDING";

function pending(overrides: Partial<Parameters<typeof buildDomesticOrderApprovalNotification>[0]> = {}) {
  return buildDomesticOrderApprovalNotification({
    domesticOrderId: ORDER_ID,
    modelName: "시험용 품명",
    routeStepOrder: 1,
    requestedByName: "김결재",
    // 🔴 2026-11-08 — 승인의 단위가 **회차**로 내려왔다. 기본 표본은 **회차가
    //    하나뿐인 기타건**이다(그때 이름표는 null 이고, 줄은 2026-11-07 과 같아야 한다).
    dueDateRowOrder: 1,
    dueDateRowLabel: null,
    ...overrides,
  });
}

/* ───────────────────────────────────────────────── 등록 — 빠뜨리면 조용히 안 뜬다 */

describe("갈래 등록", () => {
  test("🔴 등록된 종류 목록에 있다 — 없으면 조회를 만들어도 종에 한 줄도 안 뜬다", () => {
    assert.ok((NOTIFICATION_KINDS as readonly string[]).includes(KIND));
    assert.equal(pending().kind, KIND);
  });

  test("🔴 기본값이 **켜짐**이고 다섯 역할 전부 받는다 — case 를 빠뜨리면 여기서 걸린다", () => {
    // `defaultNotificationKindEnabled`·`defaultRoleReceivesNotification` 의 case 를
    // 빠뜨리면 `default: return false` 로 떨어져 **등록해 두고 한 줄도 안 뜨는**
    // 갈래가 된다. 그 실패는 화면에 아무 표시도 남기지 않는다.
    assert.equal(defaultNotificationKindEnabled(KIND), true);
    assert.ok(ROLE_CODES.length >= 5, "역할 표본이 비었다 — 아래 고리가 공짜로 통과한다");
    for (const role of ROLE_CODES) {
      assert.equal(defaultRoleReceivesNotification(KIND, role), true, role);
      assert.equal(deliversNotification(KIND, role, NO_NOTIFICATION_SETTINGS), true, role);
    }
  });

  test("이름표 · 설명 · 색이 채워져 있고, 남의 색을 쓰지 않는다", () => {
    const meta = NOTIFICATION_KIND_META[KIND];
    assert.equal(meta.label, "기타건 결재 대기");
    // 관리자가 이 설명만 읽고 무엇을 끄는지 알아야 한다 — 무엇으로 뜨는가 · 누가
    // 받는가 · 절차가 없을 때 · 누르면 어디로 가는가.
    assert.ok(meta.description.includes("기타건"), meta.description);
    assert.ok(meta.description.includes("지정된"), meta.description);
    assert.ok(meta.description.includes("최고관리자"), meta.description);
    assert.ok(meta.description.includes("절차"), meta.description);
    assert.ok(meta.description.includes("[승인] 탭"), meta.description);

    // 색상 이름이 남은 일곱 어느 것과도 겹치지 않는다(전체 유일성은
    // notification-settings.test.ts 가 본다 — 여기서는 이 갈래만).
    const hueOf = (tone: string) => tone.match(/^text-([a-z]+)-/)?.[1];
    const others = NOTIFICATION_KINDS.filter((kind) => kind !== KIND).map((kind) =>
      hueOf(NOTIFICATION_KIND_META[kind].toneClassName)
    );
    assert.ok(others.length > 0, "견줄 종류가 없다 — 이 시험이 아무것도 안 본다");
    assert.ok(!others.includes(hueOf(meta.toneClassName)), `남의 색을 쓴다: ${meta.toneClassName}`);
  });

  test("🔴 눌러서 확인하는 갈래가 **아니다** — 결재하면 저절로 빠지는 할 일이다", () => {
    // 확인 단추를 달면 결재를 안 해도 종에서 사라진다. 할 일 알림은 처리해야 빠진다.
    assert.deepEqual([...ACKNOWLEDGEABLE_NOTIFICATION_KINDS], ["APPROVAL_GRANTED", "APPROVAL_REJECTED"]);
    assert.ok(!(ACKNOWLEDGEABLE_NOTIFICATION_KINDS as readonly string[]).includes(KIND));
    // 🔵 ✕(지우기)는 그것과 다른 것이고 종류를 가리지 않는다(2026-10-20 결정).
    assert.equal(canDismissNotification(pending()), true);
  });
});

/* ──────────────────────────────────────────────────── 종 한 줄 — 주소와 굵은 글자 */

describe("종 한 줄", () => {
  test("🔴 주소가 `/domestic-orders/` 로 간다 — 접수 건 헬퍼를 베끼면 404 다", () => {
    assert.equal(pending().href, `/domestic-orders/${ORDER_ID}/approval`);
    assert.equal(pending().href, domesticOrderDetailHrefs(ORDER_ID).approval);
    assert.ok(!pending().href.includes("/repair-cases/"));
  });

  test("🔴 접수 건 결재 주소는 `/repair-cases/` 그대로다 — 둘 다 재야 뜻이 있다", () => {
    const repairCase = buildApprovalNotification({
      repairCaseId: CASE_ID,
      intakeNumber: "D9705-012",
      approvalType: "FINAL_SHIPMENT",
    });
    assert.equal(repairCase.href, `/repair-cases/${CASE_ID}/approval`);
    assert.equal(repairCase.href, repairCaseDetailHrefs(CASE_ID).approval);
    assert.ok(!repairCase.href.includes("/domestic-orders/"));
    // 같은 번호를 넣어도 두 빌더가 **다른 주소**를 만든다 — 표가 같다고 주소가 같지 않다.
    assert.notEqual(
      buildApprovalNotification({
        repairCaseId: ORDER_ID,
        intakeNumber: "D9705-012",
        approvalType: "FINAL_SHIPMENT",
      }).href,
      pending().href
    );
  });

  test("굵은 글자는 품명 · 보탬은 결재선 단계와 요청자", () => {
    assert.equal(pending().subject, "시험용 품명");
    assert.equal(pending().detail, "결재선 1단계 · 요청자 김결재");
    assert.equal(pending({ routeStepOrder: 2 }).detail, "결재선 2단계 · 요청자 김결재");
    // 결재선을 타지 않는 행(저장 경로상 생길 수 없지만 타입이 막지 못한다).
    assert.equal(pending({ routeStepOrder: null }).detail, "요청자 김결재");
  });

  test("🔴 품명이 비면 `(형식 없음)` 으로 메운다 — 빈 제목은 승인함에서 줄을 통째로 날린다", () => {
    // 🔵 표본이 뜻을 갖는지 먼저 — **적혀 있으면 그 글자**다.
    assert.equal(domesticOrderApprovalSubject("시험용 품명"), "시험용 품명");

    for (const empty of [null, "", "   ", "\t\n"]) {
      assert.equal(domesticOrderApprovalSubject(empty), DOMESTIC_ORDER_NO_MODEL_LINK_LABEL);
      assert.equal(pending({ modelName: empty }).subject, DOMESTIC_ORDER_NO_MODEL_LINK_LABEL);
      assert.ok(pending({ modelName: empty }).subject.trim().length > 0);
    }
    // 🔴 메우는 글자를 새로 짓지 않았다 — 내자 정리의 [형식] 칸과 기타건 현황의
    //    [품명] 칸이 쓰는 그 글자 그대로다.
    assert.equal(DOMESTIC_ORDER_NO_MODEL_LINK_LABEL, "(형식 없음)");
  });

  /**
   * 🔴 **2026-11-08 에 이 시험이 뒤집혔다.** 전에는 「열쇠는 **줄 하나에** 하나」였다 —
   * 그때는 한 기타건에 열린 요청이 언제나 하나였기 때문이다. 사용자 결정 12 로 승인의
   * 단위가 **납기요청일 회차**로 내려오면서 1차와 2차가 동시에 열릴 수 있게 되었고,
   * 그 둘이 같은 열쇠를 가지면 **종에서 하나로 뭉개진다.**
   *
   * 🔴 그래서 단언을 **약하게 만들지 않고 방향을 바꿨다**: 「언제나 같다」가 아니라
   * 「**단계가 넘어가도 같고, 회차가 다르면 다르다**」를 잰다.
   */
  test("열쇠는 회차 하나에 하나다 — 단계가 넘어가도 같고, 회차가 다르면 다르다", () => {
    assert.equal(pending().id, `DOMESTIC_ORDER_APPROVAL_PENDING:${ORDER_ID}:1`);
    assert.equal(pending({ routeStepOrder: 3 }).id, pending().id);
    // 🔴 **회차가 다르면 열쇠도 다르다** — 이것이 뒤집힌 쪽이다.
    assert.notEqual(pending({ dueDateRowOrder: 2 }).id, pending().id);
    // 🔵 **targetKey 는 그대로 줄 id 다.** 그 값을 세는 자리는 「처리할 건이 몇인가」를
    //    말한다(countNotificationTargets 의 머리말 — 한 건에 결재가 둘이어도 1).
    assert.equal(pending().targetKey, ORDER_ID);
    assert.equal(pending({ dueDateRowOrder: 2 }).targetKey, ORDER_ID);
    // 🔴 접수 건·견적서 결재와 열쇠가 겹치지 않는다 — 겹치면 포털이 둘을 한 줄로 접는다.
    const quote = buildQuoteApprovalNotification({
      quoteId: ORDER_ID,
      quoteNumber: "Q-9705-001",
      routeStepOrder: 1,
      requestedByName: "김결재",
    });
    const repairCase = buildApprovalNotification({
      repairCaseId: ORDER_ID,
      intakeNumber: "D9705-012",
      approvalType: "FINAL_SHIPMENT",
    });
    assert.equal(new Set([pending().id, quote.id, repairCase.id]).size, 3);
  });

  test("🔴 사이드바의 접수 건 결재 배지가 안 늘어난다 — 갈래를 가른 까닭 하나", () => {
    // (app)/layout.tsx 는 `countNotificationTargetsByKind(...).REPAIR_CASE_APPROVAL`
    // 하나로 그 숫자를 뽑는다. 같은 갈래로 섞었다면 이 숫자가 2 가 됐을 것이다.
    const counts = countNotificationTargetsByKind([
      buildApprovalNotification({
        repairCaseId: CASE_ID,
        intakeNumber: "D9705-012",
        approvalType: "FINAL_SHIPMENT",
      }),
      pending(),
    ]);
    assert.equal(counts.REPAIR_CASE_APPROVAL, 1, "기타건이 접수 건 배지에 섞였다");
    assert.equal(counts.DOMESTIC_ORDER_APPROVAL_PENDING, 1);
  });
});

/* ────────────────────────────────────────── 결과 두 줄 — 승인 완료 · 반려됨 */

describe("결과 알림", () => {
  const target = {
    source: "DOMESTIC_ORDER" as const,
    approvalId: APPROVAL_ID,
    domesticOrderId: ORDER_ID,
    modelName: "시험용 품명",
  };

  test("🔴 승인 완료도 `/domestic-orders/` 로 간다", () => {
    const item = buildApprovalGrantedNotification({ ...target, decidedByName: "이승인" });
    assert.equal(item.kind, "APPROVAL_GRANTED");
    assert.equal(item.subject, "시험용 품명");
    // 결재 이름을 글자로 새로 적지 않는다 — 결재선 용도 이름표 한 곳에서 온다.
    assert.equal(item.detail, `${DOMESTIC_ORDER_APPROVAL_LABEL} · 이승인`);
    assert.equal(item.href, `/domestic-orders/${ORDER_ID}/approval`);
    assert.ok(!item.href.includes("/repair-cases/"));
  });

  test("🔴 반려됨도 `/domestic-orders/` 로 가고, 사유 앞부분이 실린다", () => {
    const item = buildApprovalRejectedNotification({ ...target, decisionReason: "금액 확인 필요" });
    assert.equal(item.kind, "APPROVAL_REJECTED");
    assert.equal(item.detail, `${DOMESTIC_ORDER_APPROVAL_LABEL} · 사유: 금액 확인 필요`);
    assert.equal(item.href, `/domestic-orders/${ORDER_ID}/approval`);
    // 사유가 비면 결재 이름만.
    assert.equal(
      buildApprovalRejectedNotification({ ...target, decisionReason: "   " }).detail,
      DOMESTIC_ORDER_APPROVAL_LABEL
    );
  });

  test("🔴 결과 알림의 제목도 비지 않는다 — 품명이 없는 줄이 흔하다", () => {
    assert.equal(
      buildApprovalGrantedNotification({ ...target, modelName: null, decidedByName: "이승인" })
        .subject,
      DOMESTIC_ORDER_NO_MODEL_LINK_LABEL
    );
    assert.equal(
      buildApprovalRejectedNotification({ ...target, modelName: "", decisionReason: "사유" })
        .subject,
      DOMESTIC_ORDER_NO_MODEL_LINK_LABEL
    );
  });

  test("🔴 확인 기록의 열쇠가 접수 건·견적서와 겹치지 않는다 — 딱지가 `doa` 다", () => {
    const granted = buildApprovalGrantedNotification({ ...target, decidedByName: "이승인" });
    assert.equal(granted.id, `APPROVAL_GRANTED:doa:${APPROVAL_ID}`);
    assert.equal(granted.targetKey, granted.id);
    assert.equal(
      buildApprovalRejectedNotification({ ...target, decisionReason: "사유" }).id,
      `APPROVAL_REJECTED:doa:${APPROVAL_ID}`
    );

    // **같은 행 id** 를 접수 건 갈래로 만들면 열쇠가 다르다 — 남이 눌러 둔 확인
    // 기록이 엉뚱한 알림을 미리 지우지 않게 하는 보증이다.
    const asRepairCase = buildApprovalGrantedNotification({
      source: "REPAIR_CASE",
      approvalId: APPROVAL_ID,
      repairCaseId: CASE_ID,
      intakeNumber: "D9705-012",
      approvalType: "FINAL_SHIPMENT",
      decidedByName: "이승인",
    });
    assert.notEqual(granted.id, asRepairCase.id);
    // 🔴 빠진 `pia`(불출 결재) 자리를 물려받지 않았다 — 운영에 그 글자로 적힌 과거
    //    확인 기록이 남아 있을 수 있다.
    assert.ok(!granted.id.includes(":pia:"));
  });

  test("견적서 결과 줄은 한 글자도 안 바뀐다 — 갈래를 더해도 옆이 흔들리지 않는다", () => {
    const quote = buildApprovalGrantedNotification({
      source: "QUOTE",
      approvalId: APPROVAL_ID,
      quoteId: QUOTE_ID,
      quoteNumber: "Q-9705-001",
      decidedByName: "이승인",
    });
    assert.equal(quote.id, `APPROVAL_GRANTED:qa:${APPROVAL_ID}`);
    assert.equal(quote.subject, "Q-9705-001");
    assert.equal(quote.href, `/quotes/${QUOTE_ID}?tab=approval`);
  });
});

/* ──────────────────────────── 접수 건 승인 종류 목록을 **넓히지 않았다** */

describe("접수 건 결재와 섞이지 않는다", () => {
  test("🔴 접수 건 승인 종류 목록은 여전히 둘이고 기타건이 없다", () => {
    // 🔵 「안 섞인다」를 말하려면 **섞일 뻔한 값이 실제로 있어야** 한다 — 기타건
    //    갈래가 실재하는지 먼저 못 박는다.
    assert.equal(DOMESTIC_ORDER_APPROVAL_TYPE, "DOMESTIC_ORDER_FINAL_SHIPMENT");
    assert.ok(DOMESTIC_ORDER_APPROVAL_LABEL.length > 0);

    assert.deepEqual([...REPAIR_CASE_APPROVAL_TYPES], ["REPAIR_INSPECTION", "FINAL_SHIPMENT"]);
    assert.ok(
      !(REPAIR_CASE_APPROVAL_TYPES as readonly string[]).includes(DOMESTIC_ORDER_APPROVAL_TYPE),
      "기타건 결재가 접수 건 승인 종류로 들어갔다 — 종·배지·승인함에 섞인다"
    );
  });

  test("🔴 종 갈래 이름이 접수 건·견적서와 갈린다", () => {
    const labels = [
      NOTIFICATION_KIND_META.REPAIR_CASE_APPROVAL.label,
      NOTIFICATION_KIND_META.QUOTE_APPROVAL_PENDING.label,
      NOTIFICATION_KIND_META[KIND].label,
    ];
    assert.equal(new Set(labels).size, 3, `이름이 겹친다: ${labels.join(" / ")}`);
  });
});
