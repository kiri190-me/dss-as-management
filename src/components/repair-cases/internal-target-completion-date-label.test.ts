import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

import { INTERNAL_TARGET_SHIPMENT_REQUEST_MESSAGE } from "@/lib/domain/notifications";
import { NOTIFICATION_KIND_META } from "@/lib/domain/notification-settings";
import { DUE_DATE_INVERSION_REASON_NOTE } from "@/lib/domain/due-date-inversion";

/**
 * ============================================================================
 * 「사내 목표 출하일」 → 「사내 목표 완료일」 — 화면 글자가 **전부** 바뀌었는가 (2026-11-03)
 * ============================================================================
 * 사용자 결정: 「사내 목표 출하일을 사내 목표 완료일로 바꾸고…」.
 *
 * 🔴 **칸 이름은 그대로다.** DB 의 `internal_target_shipment_date` 도 코드의
 * `internalTargetShipmentDate` 도 손대지 않았다(domain/types.ts 의 그 칸 주석).
 * 바꾼 것은 사람이 읽는 글자뿐이라, 그 글자가 **한 자리라도 남으면** 같은 칸이
 * 화면마다 다른 이름으로 불린다 — 그 어긋남은 오류를 내지 않는다.
 *
 * ── 🔴 왜 렌더하지 않고 원본을 글자로 읽는가 ───────────────────────────────
 * 이 자리들은 그려 볼 수 없다. 접수 폼도 인수 정보 편집 폼도 서버 액션 →
 * `server-only` 로 이어져 test:components 에서는 import 자체가 던지고, unit 쪽은
 * react-server 조건이라 react-dom/server 가 막힌다. 이웃 셋이 같은 자리에서 같은
 * 방법을 쓴다(due-date-inversion-note.test.ts · domestic-order-dates-section.test.ts ·
 * detail-header-placement.test.ts).
 *
 * 🔴 **주석을 걷어 낸 코드만 센다.** 이 저장소의 조각들은 주석에 규칙을 글자로
 * 적어 두므로, 날것으로 세면 「옛 이름이 없다」가 **주석 때문에 틀리고**
 * 「새 이름이 있다」가 **주석만으로 영영 통과한다.** 둘 다 실제로 겪은 함정이다.
 * ============================================================================
 */

const repoUrl = new URL("../../../", import.meta.url);

/** 주석을 걷어 낸 원본. 블록 주석과 줄 주석을 둘 다 뗀다(이웃 시험과 같은 방식). */
function codeOf(path: string): string {
  const raw = readFileSync(new URL(path, repoUrl), "utf8").replace(/\r\n/g, "\n");
  return raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const OLD_LABEL = "사내 목표 출하일";
const NEW_LABEL = "사내 목표 완료일";

/**
 * 그 칸의 이름을 **글자로 적는 자리 전부**. 화면 다섯과, 화면이 그대로 띄우는
 * 입력 오류 문구 셋이다. 🔴 새 자리가 생기면 여기에 더한다 — 목록이 비면 아래
 * 시험이 아무것도 재지 않으므로, 맨 앞에서 표본이 비지 않았는지부터 본다.
 */
const SOURCES: readonly { path: string; what: string }[] = [
  { path: "src/components/repair-cases/detail/IntakeInfoSection.tsx", what: "상세 — 인수 정보" },
  {
    path: "src/components/repair-cases/detail/edit/IntakeInfoEditForm.tsx",
    what: "상세 — 인수 정보 편집",
  },
  { path: "src/components/repair-cases/new/IntakeFormInner.tsx", what: "신규 접수 폼" },
  { path: "src/components/repair-cases/mine/MyActiveWorkCardList.tsx", what: "내 작업 카드" },
  {
    path: "src/components/repair-cases/approval/DatabaseFinalShipmentCard.tsx",
    what: "최종 출하 승인 카드",
  },
  {
    path: "src/components/repair-cases/approval/ApprovalActionDialog.tsx",
    what: "승인 확인 창",
  },
  { path: "src/lib/validation/repair-case-input.ts", what: "접수 입력 검증 문구" },
  { path: "src/lib/validation/repair-case-update-input.ts", what: "수정 입력 검증 문구" },
  { path: "src/lib/db/mutations/repair-cases.ts", what: "저장 경로 오류 문구" },
];

describe("사내 목표 완료일 — 화면 글자", () => {
  test("표본 점검 — 아홉 자리 모두에서 그 이름이 **코드로** 잡힌다", () => {
    assert.ok(SOURCES.length > 0, "볼 자리가 하나도 없다 — 이 시험이 아무것도 재지 않는다");
    for (const source of SOURCES) {
      const code = codeOf(source.path);
      assert.ok(
        code.includes(NEW_LABEL),
        `${source.what}(${source.path}) 에서 「${NEW_LABEL}」 를 못 찾았다 — 주석을 걷어 내면 사라지는 자리다`
      );
    }
  });

  test("🔴 옛 이름이 한 자리도 남아 있지 않다", () => {
    for (const source of SOURCES) {
      const code = codeOf(source.path);
      assert.ok(
        !code.includes(OLD_LABEL),
        `${source.what}(${source.path}) 에 「${OLD_LABEL}」 가 남아 있다`
      );
    }
  });

  test("🔴 내 작업 표의 짧은 이름도 함께 바뀌었다 — 「목표 출하일」이 아니라 「목표 완료일」", () => {
    const code = codeOf("src/components/repair-cases/mine/MyActiveWorkTable.tsx");
    assert.ok(code.includes('label="목표 완료일"'), "내 작업 표의 머리글이 안 바뀌었다");
    assert.ok(!code.includes("목표 출하일"), "내 작업 표에 옛 이름이 남아 있다");
    // 🔴 칸 이름은 그대로여야 한다 — 바꾸면 정렬이 조용히 끊긴다.
    assert.ok(
      code.includes('column="internalTargetShipmentDate"'),
      "정렬이 보는 칸 이름까지 함께 바꿨다"
    );
  });

  test("🔴 알림 글도 같은 이름을 쓴다 — 눌러서 간 화면과 다른 말을 하지 않는다", () => {
    assert.equal(INTERNAL_TARGET_SHIPMENT_REQUEST_MESSAGE, `${NEW_LABEL}을 등록해 주세요`);
    assert.equal(
      NOTIFICATION_KIND_META.REPAIR_CASE_TARGET_SHIPMENT_MISSING.label,
      `${NEW_LABEL} 미등록`
    );
    assert.ok(
      DUE_DATE_INVERSION_REASON_NOTE.includes(NEW_LABEL),
      `납기 역전 까닭 문장이 옛 이름을 쓴다: ${DUE_DATE_INVERSION_REASON_NOTE}`
    );
  });
});
