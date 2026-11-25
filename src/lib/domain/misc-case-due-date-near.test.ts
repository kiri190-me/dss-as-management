import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  buildDomesticOrderDueDateNearNotification,
  isDomesticOrderDueDateRowNear,
  isMiscCaseDueDateNear,
  isRepairCaseDueDateWithinNotificationWindow,
} from "./notifications";

/**
 * ============================================================================
 * 기타건 「납기 임박」 — **종 알림과 배지가 같은 건을 가리키는가** (2026-11-25)
 * ============================================================================
 * 사용자 요구: 「기타건 목록과 상세에 [납기 임박] 배지가 뜨도록 해 줘」. 같은 사실을
 * 종 알림이 그날 아침부터 말하고 있어서(커밋 3731fcf7), 이 파일이 지키는 것은 **그
 * 둘이 같은 줄을 가리키는가**가 먼저다.
 *
 * 🔴 **어긋나면 시험이 아니라 사람 눈에만 띈다.** 종에는 없는데 표에만 배지가 서면
 * (또는 그 반대) 양쪽 단위 시험은 둘 다 초록이다 — 둘을 **한 표본으로 함께 돌려** 보는
 * 자리가 여기밖에 없다.
 *
 * 못 박는 것 여섯
 *  ① 회차 하나의 판정 — 끝남 둘(완료 · 납품일)과 창. 🔴 **완료와 납품일을 둘 다** 본다.
 *  ② 건 단위로 접는 규칙 — 「임박인 회차가 **하나라도** 있으면 참」.
 *  ③ 🔴 **같은 표본에서 알림과 배지가 같은 건 묶음을 낸다.** 손으로 적은 정답과도
 *    맞대어 본다(둘이 같은 함수를 타므로, 그것만으로는 「둘 다 틀린 채로 같다」를
 *    못 가른다).
 *  ④ 🔵 그래도 **세는 단위는 다르다** — 알림은 회차마다 한 줄, 배지는 건마다 하나.
 *    표본에 회차가 둘 임박인 줄을 섞어 그 차이를 값으로 보여 둔다.
 *  ⑤ 🔴 **판정을 화면이 하지 않는다** — 서버 두 자리(목록 페이지 · 상세 레이아웃)가
 *    그 함수를 부르고, 「오늘」도 거기서 만든다.
 *  ⑥ 🔴 **상세는 기타건일 때만 세운다** — 수리 건이 붙은 내자 줄에서는 안 선다.
 *
 * 🔴 값은 전부 지어낸 것이다(공개 저장소). 날짜도 2094년을 쓴다 — 「오늘」이 언제든
 * 결과가 달라지지 않게 `now` 를 박아 넣는다.
 * ============================================================================
 */

/** 한국 시각 2094-10-22 14:00(= UTC 05:00). 창은 2094-10-22 … 2094-10-29 다. */
const NOW = new Date("2094-10-22T05:00:00.000Z");
const TODAY = "2094-10-22";
const LAST_DAY = "2094-10-29";
const YESTERDAY = "2094-10-21";
const TOO_FAR = "2094-10-30";

type Row = { dueDate: string | null; deliveredDate: string | null; completedAt: Date | string | null };

/** 열려 있는(아직 안 끝난) 회차 하나. */
function openRow(dueDate: string | null): Row {
  return { dueDate, deliveredDate: null, completedAt: null };
}

test("🔵 못 — 창이 실제로 이 날짜들에서 갈린다(표본이 창 밖에 통째로 있지 않다)", () => {
  // 이 줄이 없으면 아래 전부가 「무엇을 넣어도 거짓」인 표본으로 공짜로 통과한다.
  assert.equal(isRepairCaseDueDateWithinNotificationWindow(TODAY, NOW), true);
  assert.equal(isRepairCaseDueDateWithinNotificationWindow(LAST_DAY, NOW), true);
  assert.equal(isRepairCaseDueDateWithinNotificationWindow(YESTERDAY, NOW), false);
  assert.equal(isRepairCaseDueDateWithinNotificationWindow(TOO_FAR, NOW), false);
});

describe("① 회차 하나 — 끝남 둘과 창", () => {
  test("열려 있고 창 안이면 참 — 오늘도 +7일도 안이다", () => {
    assert.equal(isDomesticOrderDueDateRowNear(openRow(TODAY), NOW), true);
    assert.equal(isDomesticOrderDueDateRowNear(openRow(LAST_DAY), NOW), true);
  });

  test("창 밖이면 거짓 — 지난 납기도, 여드레 뒤도 이 경보가 아니다", () => {
    // 🔴 「지났다」는 기타건에 없다(2026-11-25 요청에 「지연」이 없었다).
    assert.equal(isDomesticOrderDueDateRowNear(openRow(YESTERDAY), NOW), false);
    assert.equal(isDomesticOrderDueDateRowNear(openRow(TOO_FAR), NOW), false);
  });

  test("날짜가 없으면 거짓 — 납기요청일이 안 적힌 회차에는 경보가 없다", () => {
    assert.equal(isDomesticOrderDueDateRowNear(openRow(null), NOW), false);
  });

  test("🔴 끝난 회차는 **둘 다** 본다 — 완료만 봐도, 납품일만 봐도 안 된다", () => {
    // 완료는 승인을 거쳐야 찍히고 납품일은 편집칸에서 바로 적히는 값이라, 실제로
    // 한쪽만 찬 행이 있다. 하나만 보면 그 행에서 경보가 안 꺼진다.
    assert.equal(
      isDomesticOrderDueDateRowNear({ ...openRow(TODAY), deliveredDate: TODAY }, NOW),
      false,
      "납품한 회차에 경보가 남는다"
    );
    assert.equal(
      isDomesticOrderDueDateRowNear(
        { ...openRow(TODAY), completedAt: new Date("2094-10-20T00:00:00.000Z") },
        NOW
      ),
      false,
      "[완료 처리]한 회차에 경보가 남는다"
    );
  });

  test("🔵 완료 시각은 `Date` 로도 ISO 글자로도 들어온다 — 조회와 화면이 모양이 다르다", () => {
    // 종 알림 조회는 DB 에서 온 Date 를 그대로 들고 있고, 화면 쪽 줄은 서버 컴포넌트
    // 경계를 넘느라 ISO 문자열이다. 묻는 것이 「들어 있는가」 하나라 답이 같아야 한다.
    const asDate = { ...openRow(TODAY), completedAt: new Date("2094-10-20T00:00:00.000Z") };
    const asText = { ...openRow(TODAY), completedAt: "2094-10-20T00:00:00.000Z" };
    assert.equal(isDomesticOrderDueDateRowNear(asDate, NOW), false);
    assert.equal(isDomesticOrderDueDateRowNear(asText, NOW), false);
  });
});

describe("② 건 단위 — 하나라도 임박이면 배지가 선다", () => {
  test("🔴 회차가 여럿일 때 **하나만** 임박이어도 참이다", () => {
    const dueDates = [openRow(YESTERDAY), openRow(LAST_DAY), openRow(TOO_FAR)];
    // 🔵 못 — 표본이 실제로 「하나만」인가(셋 다 참이면 이 줄은 아무것도 안 잰다).
    assert.equal(dueDates.filter((row) => isDomesticOrderDueDateRowNear(row, NOW)).length, 1);
    assert.equal(isMiscCaseDueDateNear(dueDates, NOW), true);
  });

  test("🔴 임박이던 그 회차가 납품되면 배지가 사라진다 — 다른 회차는 창 밖이다", () => {
    const delivered = [
      openRow(YESTERDAY),
      { ...openRow(LAST_DAY), deliveredDate: TODAY },
      openRow(TOO_FAR),
    ];
    assert.equal(isMiscCaseDueDateNear(delivered, NOW), false);
  });

  test("🔴 [완료 처리]해도 마찬가지다", () => {
    const completed = [
      openRow(YESTERDAY),
      { ...openRow(LAST_DAY), completedAt: "2094-10-22T01:00:00.000Z" },
      openRow(TOO_FAR),
    ];
    assert.equal(isMiscCaseDueDateNear(completed, NOW), false);
  });

  test("회차가 하나도 없는 줄은 거짓 — 날짜가 안 달린 기타건이 흔하다", () => {
    assert.equal(isMiscCaseDueDateNear([], NOW), false);
  });
});

/* ═══════════════ ③④ 같은 표본으로 알림과 배지를 함께 돌린다 */

/**
 * 🔴 **표본 여섯 줄.** 손으로 적은 정답(EXPECTED)과 맞대고, 그다음 알림 쪽 묶음과
 * 배지 쪽 묶음을 서로 맞댄다. 손 정답이 없으면 「둘 다 같은 함수를 타니 당연히 같다」
 * 가 되어 아무것도 못 재고, 손 정답만 있으면 둘 중 한쪽만 재는 셈이 된다.
 */
const SAMPLE: readonly { id: string; dueDates: Row[] }[] = [
  // ① 회차 하나가 오늘 — 선다.
  { id: "misc-1", dueDates: [openRow(TODAY)] },
  // ② 1차는 지났고(창 밖) 2차가 창 안 — **선다**. 눈 확인용 실제 줄과 같은 모양이다.
  { id: "misc-2", dueDates: [openRow(YESTERDAY), openRow(LAST_DAY)] },
  // ③ 회차 **둘이 함께** 창 안 — 선다. 🔵 알림은 두 줄, 배지는 하나다(④).
  { id: "misc-3", dueDates: [openRow(TODAY), openRow(LAST_DAY)] },
  // ④ 창 안이지만 1차는 납품됐고 2차는 완료 — **안 선다**.
  {
    id: "misc-4",
    dueDates: [
      { ...openRow(TODAY), deliveredDate: TODAY },
      { ...openRow(LAST_DAY), completedAt: "2094-10-21T00:00:00.000Z" },
    ],
  },
  // ⑤ 전부 창 밖 — 안 선다.
  { id: "misc-5", dueDates: [openRow(YESTERDAY), openRow(TOO_FAR)] },
  // ⑥ 날짜가 하나도 없는 줄 — 안 선다.
  { id: "misc-6", dueDates: [] },
];

/** 🔴 손으로 적은 정답. 코드에서 뽑지 않는다 — 뽑으면 맞대기가 제 꼬리를 문다. */
const EXPECTED = ["misc-1", "misc-2", "misc-3"];

/** 배지가 서는 건 — 화면 둘(목록 · 상세)이 부르는 바로 그 함수로 센다. */
function badgedOrderIds(): string[] {
  return SAMPLE.filter((order) => isMiscCaseDueDateNear(order.dueDates, NOW)).map(
    (order) => order.id
  );
}

/**
 * 종에 뜨는 건 — **알림 한 줄을 실제로 만들어** 그 `targetKey` 를 모은다.
 *
 * 🔴 조회(db/queries/…)는 server-only 와 DB 를 끌고 들어와 여기서 부를 수 없다. 그래서
 * 조회가 하는 일 가운데 **DB 가 아닌 부분**을 그대로 되밟는다: 회차마다 판정 → 통과한
 * 회차마다 알림 한 줄. 🔵 그 두 단계가 조회의 글자와 같다는 사실은 이웃 파일이 원본을
 * 읽어 못 박는다(domestic-order-due-date-near-notification.test.ts).
 */
function notifiedOrderIds(): string[] {
  const ids: string[] = [];
  for (const order of SAMPLE) {
    for (const [index, row] of order.dueDates.entries()) {
      if (!isDomesticOrderDueDateRowNear(row, NOW)) continue;
      const item = buildDomesticOrderDueDateNearNotification({
        domesticOrderId: order.id,
        modelName: "시험용 품명",
        dueDate: row.dueDate as string,
        dueDateRowOrder: index + 1,
        dueDateRowLabel: null,
      });
      ids.push(item.targetKey);
    }
  }
  return ids;
}

describe("③ 🔴 알림과 배지가 **같은 건**을 가리킨다", () => {
  test("🔵 못 — 표본이 양쪽으로 갈려 있다(전부 참도, 전부 거짓도 아니다)", () => {
    assert.equal(SAMPLE.length, 6);
    assert.ok(EXPECTED.length > 0 && EXPECTED.length < SAMPLE.length, "표본이 한쪽으로 쏠렸다");
  });

  test("🔴 배지가 서는 건이 손으로 적은 정답과 같다", () => {
    assert.deepEqual(badgedOrderIds(), EXPECTED);
  });

  test("🔴 종에 뜨는 건이 손으로 적은 정답과 같다", () => {
    assert.deepEqual([...new Set(notifiedOrderIds())], EXPECTED);
  });

  test("🔴 **둘을 직접 맞댄다** — 어느 한쪽만 고쳐지는 날 여기서 멈춘다", () => {
    assert.deepEqual(
      badgedOrderIds(),
      [...new Set(notifiedOrderIds())],
      "종에는 없는 배지가 표에만 서거나 그 반대다 — 판정이 두 벌이 됐다"
    );
  });
});

describe("④ 🔵 그래도 세는 단위는 다르다 — 알림은 회차마다, 배지는 건마다", () => {
  test("회차 둘이 함께 임박한 줄에서 알림은 두 줄, 배지는 하나다", () => {
    const rows = notifiedOrderIds().filter((id) => id === "misc-3");
    assert.equal(rows.length, 2, "표본이 달라졌다 — 회차 둘이 함께 임박한 줄이 없다");
    assert.equal(badgedOrderIds().filter((id) => id === "misc-3").length, 1);
  });

  test("🔴 그래서 알림 줄 수는 배지 수보다 많다 — 같아지면 위 ③이 뜻을 잃는다", () => {
    assert.ok(
      notifiedOrderIds().length > badgedOrderIds().length,
      "표본에 회차가 여럿 임박한 줄이 없다 — 접는 규칙을 아무것도 안 재고 있다"
    );
  });
});

/* ═══════════════ ⑤⑥ 판정하는 자리 — 서버 둘, 그리고 기타건만 */

const ROOT = new URL("../../../", import.meta.url);
const read = (relativePath: string) =>
  readFileSync(new URL(relativePath, ROOT), "utf8").replace(/\r\n/g, "\n");
/** 🔴 주석을 걷어낸다 — 이 변경의 주석에 함수 이름이 그대로 들어 있어, 안 걷으면 공짜다. */
const codeOnly = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");

const LIST_PAGE = codeOnly(read("src/app/(app)/misc-cases/page.tsx"));
const DETAIL_LAYOUT = codeOnly(read("src/app/(app)/domestic-orders/[id]/layout.tsx"));

describe("⑤ 🔴 판정은 **서버**가 한다 — 화면은 불리언만 받는다", () => {
  test("🔵 못 — 주석을 걷어낸 원본이 비어 있지 않다", () => {
    for (const [name, source] of [
      ["목록 페이지", LIST_PAGE],
      ["상세 레이아웃", DETAIL_LAYOUT],
    ] as const) {
      assert.ok(source.length > 300, `${name} 원본이 너무 짧다(${source.length})`);
    }
  });

  test("🔴 서버 두 자리가 **같은 함수**를 부른다 — 조건을 제 손으로 적지 않는다", () => {
    for (const [name, source] of [
      ["목록 페이지", LIST_PAGE],
      ["상세 레이아웃", DETAIL_LAYOUT],
    ] as const) {
      assert.ok(source.includes("isMiscCaseDueDateNear("), `${name} 가 공용 판정을 안 부른다`);
      assert.ok(
        source.includes('from "@/lib/domain/notifications"'),
        `${name} 가 종 알림과 같은 자리에서 판정을 가져오지 않는다`
      );
      // 🔴 조건을 펴 쓰면 종과 두 말이 된다. 끝남 거르기의 글자가 보이면 그 모양이다.
      assert.equal(
        source.includes("deliveredDate !== null"),
        false,
        `${name} 가 끝남 거르기를 또 적고 있다`
      );
    }
  });

  test("🔴 「오늘」을 서버가 만든다 — 그리는 조각 넷은 만들지 않는다(hydration)", () => {
    for (const [name, source] of [
      ["목록 페이지", LIST_PAGE],
      ["상세 레이아웃", DETAIL_LAYOUT],
    ] as const) {
      assert.ok(source.includes("new Date()"), `${name} 가 「오늘」을 안 만든다 — 누가 만드나`);
    }
    for (const file of [
      "src/components/misc-cases/misc-case-fields.tsx",
      "src/components/misc-cases/MiscCaseTable.tsx",
      "src/components/misc-cases/MiscCaseCardList.tsx",
      "src/components/domestic-orders/detail/DomesticOrderDetailHeader.tsx",
    ]) {
      assert.equal(
        codeOnly(read(file)).includes("new Date("),
        false,
        `${file} 가 스스로 「오늘」을 만든다 — 서버가 그린 것과 어긋난다`
      );
    }
  });

  test("🔵 화면에서 종 알림 **조회**를 부르지 않는다 — 같은 표를 두 번 훑는다", () => {
    for (const source of [LIST_PAGE, DETAIL_LAYOUT]) {
      assert.equal(source.includes("listDomesticOrdersWithDueDateNear"), false);
    }
  });
});

describe("⑥ 🔴 상세 머리말은 **기타건일 때만** 세운다", () => {
  test("수리 건이 붙은 줄에서는 거짓을 넘긴다 — 안 가르면 배지가 두 벌 선다", () => {
    // 그 줄의 납기요청일은 수리 건 쪽 「납기 임박」이 이미 빌려 와서 재고 있다
    // (resolveRepairCaseRequestedDueDate). 이 주소는 기타건이 아닌 줄에도 열린다.
    assert.ok(
      DETAIL_LAYOUT.includes("row.repairCaseId === null && isMiscCaseDueDateNear("),
      "상세 레이아웃이 기타건인지 안 가른다 — 수리 건이 붙은 줄에도 배지가 선다"
    );
    assert.ok(
      DETAIL_LAYOUT.includes("isDueDateNear={isDueDateNear}"),
      "레이아웃이 판정을 머리 카드에 안 넘긴다 — 배지는 영영 안 뜬다"
    );
  });

  test("🔵 목록은 가르지 않아도 된다 — 조회가 이미 기타건만 싣는다", () => {
    // listMiscDomesticOrders 가 `repair_case_id IS NULL` 로 좁혀 온다. 화면에서 또
    // 가르면 같은 규칙이 두 곳에 생긴다(그 조회의 머리말).
    assert.ok(LIST_PAGE.includes("listMiscDomesticOrders()"), "목록이 그 조회를 안 쓴다");
    assert.equal(
      LIST_PAGE.includes("repairCaseId === null"),
      false,
      "목록이 기타건 가름을 한 번 더 적고 있다"
    );
  });
});
