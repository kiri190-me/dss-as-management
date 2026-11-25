import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  canEditDomesticOrderWhenCompleted,
  DOMESTIC_ORDER_COMPLETED_READ_ONLY_HINT,
  DOMESTIC_ORDER_COMPLETED_READ_ONLY_LABEL,
  showDomesticOrderCompletedReadOnlyNote,
  showDomesticOrderDueDateConfirmControls,
  type DomesticOrderEditAccess,
} from "./domestic-order-completed-edit-access";

/**
 * ============================================================================
 * 🔴 완료된 줄에서 **고치는 길을 그릴 것인가** (2026-11-19, 조각 2)
 * ============================================================================
 * 사용자 지시: 「[완료시 수정]권한이 없으면 [완료]건에 대해서 [수정], [완료해제]버튼이
 * **보이지 않도록** 해줘.」
 *
 * 🔴 **이 파일이 재는 것은 규칙 자체다.** 화면이 그 규칙을 표와 카드 **양쪽에서**
 * 부르는지는 components/domestic-orders/domestic-order-completed-row-readonly.test.ts
 * 가 원본 글자로 본다(그 화면은 서버 액션을 import 해서 여기서 그릴 수 없다).
 *
 * 🔴 **가장 중요한 못은 「막지 않는다」 쪽이다.** 새 권한이 완료 **안 된** 줄까지
 * 막으면 그날부터 영업·엔지니어는 내자 정리를 못 쓴다 — 아래 2×2×2 표가 여덟 칸을
 * 전부 적어 두는 까닭이다. 한 칸만 재면 「전부 거짓을 돌려주는」 구현도 통과한다.
 * ============================================================================
 */

/** 완료된 줄. 시각 자체는 쓰이지 않지만 실제 조회가 주는 모양 그대로 적는다. */
const completedRow = { completedAt: "2026-11-19T01:00:00.000Z" };
const openRow = { completedAt: null };

const access = (canEdit: boolean, canEditCompleted: boolean): DomesticOrderEditAccess => ({
  canEdit,
  canEditCompleted,
});

describe("canEditDomesticOrderWhenCompleted — 여덟 칸을 전부 적어 둔다", () => {
  /**
   * 🔴 **표를 먼저 적고 그 표를 돈다.** 「권한 있음 + 완료」 한 칸만 재면
   * `return true` 도 통과하고, 「권한 없음 + 완료」 한 칸만 재면 `return false` 도
   * 통과한다. 여덟 칸이 전부 적혀 있어야 둘 다 걸린다.
   */
  const cases: Array<{
    canEdit: boolean;
    canEditCompleted: boolean;
    completed: boolean;
    expected: boolean;
    why: string;
  }> = [
    // ── 고칠 권한이 아예 없는 사람 — 이 변경 전과 한 픽셀도 다르지 않아야 한다 ──
    { canEdit: false, canEditCompleted: false, completed: false, expected: false, why: "원래 못 고친다" },
    { canEdit: false, canEditCompleted: false, completed: true, expected: false, why: "원래 못 고친다" },
    {
      canEdit: false,
      canEditCompleted: true,
      completed: false,
      expected: false,
      why: "🔴 앞뒤 안 맞는 설정(수정은 접근 불가인데 완료 시 수정은 쓰기)이 힘을 가지면 안 된다",
    },
    {
      canEdit: false,
      canEditCompleted: true,
      completed: true,
      expected: false,
      why: "🔴 그 설정으로 완료된 줄만 열리는 문이 생기면 안 된다(서버의 AND 와 같은 답)",
    },
    // ── 🔴 평소 일 — 새 권한이 **없어도** 완료 안 된 줄은 그대로 고친다 ──────
    { canEdit: true, canEditCompleted: false, completed: false, expected: true, why: "🔴 평소 일을 막으면 안 된다" },
    { canEdit: true, canEditCompleted: true, completed: false, expected: true, why: "평소 일" },
    // ── 🔴 이 조각이 바꾼 단 한 칸 ──────────────────────────────────────────
    {
      canEdit: true,
      canEditCompleted: false,
      completed: true,
      expected: false,
      why: "🔴 이 조각이 바꾼 칸 — 완료된 줄에서 고치는 길이 사라진다",
    },
    { canEdit: true, canEditCompleted: true, completed: true, expected: true, why: "권한이 있으면 그대로다" },
  ];

  // 🔵 표가 비면 아래 for 가 한 번도 안 돌아 **공짜로 통과**한다 — 먼저 센다.
  test("표본이 여덟 칸이다", () => {
    assert.equal(cases.length, 8);
    assert.equal(cases.filter((row) => row.expected).length, 3, "참이 되는 칸이 셋이 아니다");
  });

  for (const { canEdit, canEditCompleted, completed, expected, why } of cases) {
    test(`canEdit=${canEdit} · canEditCompleted=${canEditCompleted} · 완료=${completed} → ${expected} (${why})`, () => {
      assert.equal(
        canEditDomesticOrderWhenCompleted(
          completed ? completedRow : openRow,
          access(canEdit, canEditCompleted)
        ),
        expected
      );
    });
  }
});

/**
 * 🔴 **회차도 같은 함수로 잰다** — 서버가 줄 해제와 회차 해제를 같은 열쇠로 막기
 * 때문이다(mutations/domestic-orders.ts). 회차가 둘 이상인 기타건에서 「1차만 끝나고
 * 줄은 아직 완료가 아닌」 상태가 가장 흔한데, **그때 줄로 재면 틀린다** — 이 묶음이
 * 그 한 자리를 못 박는다.
 */
describe("회차 — 줄의 완료 여부가 아니라 그 회차의 완료 여부로 가른다", () => {
  const partially = {
    row: { completedAt: null },
    dueDates: [{ completedAt: "2026-11-19T01:00:00.000Z" }, { completedAt: null }],
  };
  const noPermission = access(true, false);

  test("줄은 아직 완료가 아니다 — 줄의 [수정]과 칸 편집은 그대로 열린다", () => {
    assert.equal(canEditDomesticOrderWhenCompleted(partially.row, noPermission), true);
  });

  test("🔴 그런데 **끝난 1차의 [1차 해제]는 닫힌다** — 서버가 거절하는 자리다", () => {
    assert.equal(canEditDomesticOrderWhenCompleted(partially.dueDates[0], noPermission), false);
  });

  test("🔴 아직인 2차의 [2차 완료]는 열린다 — 완료 처리 쪽은 막지 않는다", () => {
    assert.equal(canEditDomesticOrderWhenCompleted(partially.dueDates[1], noPermission), true);
  });

  test("권한이 있으면 회차 둘 다 열린다", () => {
    const allowed = access(true, true);
    assert.deepEqual(
      partially.dueDates.map((dueDate) => canEditDomesticOrderWhenCompleted(dueDate, allowed)),
      [true, true]
    );
  });
});

describe("showDomesticOrderCompletedReadOnlyNote — 「읽기 전용」을 적을 자리", () => {
  test("🔴 고칠 수 있는 사람의 **완료된 줄에만** 적는다", () => {
    assert.equal(showDomesticOrderCompletedReadOnlyNote(completedRow, access(true, false)), true);
  });

  test("🔴 완료 안 된 줄에는 안 적는다 — 그 줄은 고칠 수 있다", () => {
    assert.equal(showDomesticOrderCompletedReadOnlyNote(openRow, access(true, false)), false);
  });

  test("🔴 권한이 있으면 안 적는다 — 읽기 전용이 아니다", () => {
    assert.equal(showDomesticOrderCompletedReadOnlyNote(completedRow, access(true, true)), false);
  });

  test("🔴 원래 못 고치는 사람에게는 안 적는다 — 그 화면에는 바뀐 것이 없다", () => {
    for (const completedEdit of [false, true]) {
      assert.equal(
        showDomesticOrderCompletedReadOnlyNote(completedRow, access(false, completedEdit)),
        false,
        `canEdit=false · canEditCompleted=${completedEdit} 인데 글자가 늘었다`
      );
      assert.equal(showDomesticOrderCompletedReadOnlyNote(openRow, access(false, completedEdit)), false);
    }
  });

  test("🔵 적는 자리와 못 적는 자리가 **둘 다 있다** — 늘 참·늘 거짓이 아니다", () => {
    const answers = [
      showDomesticOrderCompletedReadOnlyNote(completedRow, access(true, false)),
      showDomesticOrderCompletedReadOnlyNote(completedRow, access(true, true)),
    ];
    assert.deepEqual(answers, [true, false]);
  });
});

/**
 * ============================================================================
 * 🔴 **완료된 건에는 [납기일 확정] 묶음이 안 뜬다** (2026-11-25, 조각 4)
 * ============================================================================
 * 사용자 지시: 「이미 **완료처리가 된 건**은 [내자관리]에서 **[납기일 확정], [확정],
 * [확정 해제] 등이 뜨지 않도록** 해줘.」
 *
 * 🔴 **가장 중요한 못은 여기서도 「안 막는다」 쪽이다.** 완료 **안 된** 줄까지 가리면
 * 어제까지 쓰던 단추가 통째로 사라진다 — 오늘 운영에 나간 기능이라 그 줄이 거의
 * 전부다. 아래 네 칸이 **참이 되는 칸 하나**를 함께 적어 두는 까닭이고, 그 칸이 없으면
 * `return false` 한 줄도 통과한다.
 *
 * 🔴 화면이 이 규칙을 **표와 카드 양쪽에서** 부르는지는 원본 글자로 본다
 * (components/domestic-orders/domestic-order-due-date-confirm-screens.test.ts).
 * ============================================================================
 */
describe("showDomesticOrderDueDateConfirmControls — 완료 둘을 다 보고, 권한은 안 본다", () => {
  const completedUnit = { completedAt: "2026-11-25T02:00:00.000Z" };
  const openUnit = { completedAt: null };

  /** 🔴 네 칸을 전부 적는다 — 한 칸만 재면 늘 참·늘 거짓인 구현이 통과한다. */
  const cases: Array<{
    rowCompleted: boolean;
    unitCompleted: boolean;
    expected: boolean;
    why: string;
  }> = [
    {
      rowCompleted: false,
      unitCompleted: false,
      expected: true,
      why: "🔵 **짝** — 평소 줄에서는 어제와 똑같이 그린다",
    },
    {
      rowCompleted: true,
      unitCompleted: false,
      expected: false,
      why: "🔴 사용자가 말한 그 자리 — 완료 처리된 건(줄)",
    },
    {
      rowCompleted: false,
      unitCompleted: true,
      expected: false,
      why: "🔴 끝난 회차 — 확정해도 끌 종이 없다(그 회차는 「납기 임박」에서 이미 빠진다)",
    },
    {
      rowCompleted: true,
      unitCompleted: true,
      expected: false,
      why: "기타건의 줄을 완료하면 회차 칸도 함께 찍힌다 — 두 판정이 겹치는 자리",
    },
  ];

  // 🔵 표가 비면 아래 for 가 한 번도 안 돌아 **공짜로 통과**한다 — 먼저 센다.
  test("표본이 네 칸이고, 그리는 칸이 **하나는 있다**", () => {
    assert.equal(cases.length, 4);
    assert.equal(
      cases.filter((row) => row.expected).length,
      1,
      "참이 되는 칸이 없으면 '전부 숨김'이 통과한다"
    );
  });

  for (const { rowCompleted, unitCompleted, expected, why } of cases) {
    test(`줄 완료=${rowCompleted} · 회차 완료=${unitCompleted} → ${expected} (${why})`, () => {
      assert.equal(
        showDomesticOrderDueDateConfirmControls(
          rowCompleted ? completedRow : openRow,
          unitCompleted ? completedUnit : openUnit
        ),
        expected
      );
    });
  }

  test("🔴 **권한을 안 본다** — 「완료 시 수정」을 가진 사람에게도 사라진다", () => {
    // 🔴 이 두 줄이 이 조각의 전부다: 위 판정은 그 사람에게 **참**을 주는데(어제까지
    //    단추가 보이던 까닭), 아래 판정이 **거짓**으로 덮는다. 둘이 같은 답을 주기
    //    시작하면 지시가 조용히 풀린 것이다.
    assert.equal(canEditDomesticOrderWhenCompleted(completedRow, access(true, true)), true);
    assert.equal(showDomesticOrderDueDateConfirmControls(completedRow, openUnit), false);
  });

  test("🔵 빌려 그리는 날짜 — 행이 없으니 완료일 수 없다, 줄만 본다", () => {
    // 적어 둔 회차가 없는 줄은 수리 건의 날짜를 대신 그린다(화면). 그 덩이는 언제나
    // `{ completedAt: null }` 로 물어보므로, 가르는 것은 줄의 완료 하나다.
    assert.equal(showDomesticOrderDueDateConfirmControls(openRow, { completedAt: null }), true);
    assert.equal(showDomesticOrderDueDateConfirmControls(completedRow, { completedAt: null }), false);
  });
});

describe("글자 — 받아야 할 권한의 이름을 말한다", () => {
  test("보이는 글자는 짧다(표의 순번 칸에 줄마다 선다)", () => {
    assert.equal(DOMESTIC_ORDER_COMPLETED_READ_ONLY_LABEL, "읽기 전용");
  });

  test("🔴 까닭 한 줄은 권한 화면의 칸 이름을 그대로 적는다 — 「권한이 없습니다」로 끝내지 않는다", () => {
    assert.match(DOMESTIC_ORDER_COMPLETED_READ_ONLY_HINT, /「완료 시 수정」/);
    assert.match(DOMESTIC_ORDER_COMPLETED_READ_ONLY_HINT, /완료를 해제/);
  });
});
