import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  buildDomesticOrderDueDateNearNotification,
  isDomesticOrderDueDateRowConfirmed,
  isDomesticOrderDueDateRowNear,
  isMiscCaseDueDateNear,
  isRepairCaseDueDateWithinNotificationWindow,
} from "./notifications";

/**
 * ============================================================================
 * 기타건 「납기 임박」 — **종 알림과 배지는 어디까지 같고 어디서 갈리는가** (2026-11-25)
 * ============================================================================
 * 사용자 요구 둘이 하루에 겹쳤다. 먼저 「기타건 목록과 상세에 [납기 임박] 배지가 뜨도록
 * 해 줘」, 그다음 「[납기일 확정] 버튼을 누르면 포털의 알림 중에 **[납기 임박] 알림이
 * 뜨지 않도록** 해 줘」.
 *
 * 🔴 **그래서 이 파일이 지키는 선이 2026-11-25 에 한 번 바뀌었다.** 처음에는 「종과
 * 배지가 **언제나** 같은 건을 가리킨다」였고, 그것이 판정이 두 벌로 갈라지는 것을 막는
 * 보호 장치였다. 확정이 들어오면서 그 전제는 **일부러** 깨졌다 —
 *
 *   · 확정하기 **전**에는 여전히 둘이 글자 그대로 같은 건을 가리킨다(아래 ③-나).
 *   · 확정하면 **종에서만 빠지고 배지는 그대로 선다**(③-다). 날짜가 다가온다는 사실
 *     자체는 확정으로 변하지 않기 때문이다 — 끄는 것은 종뿐이라는 사용자 결정이다.
 *
 * 🔴 **시험을 지우지 않고 갈랐다.** 「언제나 같다」를 지우면 판정이 두 벌이 되는 것을
 * 아무도 안 막고, 그대로 두면 확정이 들어올 수 없다. 그래서 **확정을 뺀 표본에서는
 * 예전 그대로 맞대고**, 확정된 회차에서만 갈리는 것을 **값으로** 못 박는다.
 *
 * 🔴 **어긋나면 시험이 아니라 사람 눈에만 띈다.** 종에는 없는데 표에만 배지가 서면
 * (또는 그 반대) 양쪽 단위 시험은 둘 다 초록이다 — 둘을 **한 표본으로 함께 돌려** 보는
 * 자리가 여기밖에 없다.
 *
 * 못 박는 것 일곱
 *  ① 회차 하나의 판정 — 끝남 둘(완료 · 납품일)과 창. 🔴 **완료와 납품일을 둘 다** 본다.
 *    🔴 그리고 **확정은 안 본다** — 이 판정이 곧 배지다.
 *  ② 건 단위로 접는 규칙 — 「임박인 회차가 **하나라도** 있으면 참」. 확정해도 선다.
 *  ③ 🔴 같은 표본에서 알림과 배지를 함께 돌린다 — **확정 전에는 같고, 확정하면 종만
 *    빠진다.** 손으로 적은 정답과도 맞대어 본다(둘이 같은 창 함수를 타므로, 그것만으로는
 *    「둘 다 틀린 채로 같다」를 못 가른다).
 *  ④ 🔵 그래도 **세는 단위는 다르다** — 알림은 회차마다 한 줄, 배지는 건마다 하나.
 *    표본에 회차가 둘 임박인 줄과 **그중 하나만 확정인 줄**을 함께 섞어 값으로 보인다.
 *  ⑤ 🔴 **판정을 화면이 하지 않는다** — 서버 두 자리(목록 페이지 · 상세 레이아웃)가
 *    그 함수를 부르고, 「오늘」도 거기서 만든다.
 *  ⑥ 🔴 **상세는 기타건일 때만 세운다** — 수리 건이 붙은 내자 줄에서는 안 선다.
 *  ⑦ 🔴 **확정 거르기가 배지 쪽 판정 안으로 들어오지 않는다** — 들어오는 순간 배지가
 *    함께 꺼진다. 글자로도 막는다(값만으로는 「언젠가 옮겨 적는 손」을 못 막는다).
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

type Row = {
  dueDate: string | null;
  deliveredDate: string | null;
  completedAt: Date | string | null;
  /** 🔴 [납기일 확정] 시각(2026-11-25). 차면 **종만** 꺼진다. */
  confirmedAt: Date | string | null;
};

/** 열려 있는(아직 안 끝났고 확정도 안 된) 회차 하나. */
function openRow(dueDate: string | null): Row {
  return { dueDate, deliveredDate: null, completedAt: null, confirmedAt: null };
}

/** 그 회차의 납기일을 [납기일 확정]한 모양. 끝난 것이 아니다 — 날짜만 잠겼다. */
function confirmedRow(dueDate: string | null): Row {
  return { ...openRow(dueDate), confirmedAt: "2094-10-20T00:00:00.000Z" };
}

test("🔵 못 — 창이 실제로 이 날짜들에서 갈린다(표본이 창 밖에 통째로 있지 않다)", () => {
  // 이 줄이 없으면 아래 전부가 「무엇을 넣어도 거짓」인 표본으로 공짜로 통과한다.
  assert.equal(isRepairCaseDueDateWithinNotificationWindow(TODAY, NOW), true);
  assert.equal(isRepairCaseDueDateWithinNotificationWindow(LAST_DAY, NOW), true);
  assert.equal(isRepairCaseDueDateWithinNotificationWindow(YESTERDAY, NOW), false);
  assert.equal(isRepairCaseDueDateWithinNotificationWindow(TOO_FAR, NOW), false);
});

describe("① 회차 하나 — 끝남 둘과 창, 그리고 확정은 안 본다", () => {
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

  test("🔴 **확정해도 이 판정은 참 그대로다** — 이 함수가 곧 화면의 배지다", () => {
    // 🔴 확정을 여기에 넣으면 배지와 붉은 날짜가 함께 사라진다. 사용자 결정은 **종만**
    //    끄는 것이다(domain/notifications.ts 의 그 절 머리말).
    // 🔵 못 — 표본이 실제로 확정이다(아니면 아래 줄이 그냥 열린 회차를 재고 끝난다).
    assert.equal(isDomesticOrderDueDateRowConfirmed(confirmedRow(TODAY)), true);
    assert.equal(
      isDomesticOrderDueDateRowNear(confirmedRow(TODAY), NOW),
      true,
      "확정했다고 배지 판정이 꺼졌다 — 붉은 날짜까지 함께 사라진다"
    );
    // 확정 시각도 완료와 같이 Date · ISO 글자 둘 다로 들어온다.
    assert.equal(
      isDomesticOrderDueDateRowConfirmed({ ...openRow(TODAY), confirmedAt: new Date() }),
      true
    );
    assert.equal(isDomesticOrderDueDateRowConfirmed(openRow(TODAY)), false);
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

  test("🔴 **[납기일 확정]은 배지를 끄지 않는다** — 같은 표본에서 완료와 갈린다", () => {
    // 🔴 끝남과 확정은 뜻이 다르다: 끝남은 「보냈다」이고 확정은 「이 날짜가 더 이상 안
    //    바뀐다」이다. 날짜는 여전히 다가오고 있으므로 배지는 그대로 서야 한다.
    const confirmed = [openRow(YESTERDAY), confirmedRow(LAST_DAY), openRow(TOO_FAR)];
    assert.equal(isMiscCaseDueDateNear(confirmed, NOW), true, "확정하자 배지가 꺼졌다");
    // 같은 자리에 완료를 넣으면 꺼진다 — 두 표시가 섞여 쓰이고 있지 않다는 대조다.
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
 * 🔴 **표본 여덟 줄.** 손으로 적은 정답 둘(EXPECTED_BADGE · EXPECTED_BELL)과 맞대고,
 * 그다음 알림 쪽 묶음과 배지 쪽 묶음을 서로 맞댄다. 손 정답이 없으면 「둘 다 같은
 * 함수를 타니 당연히 같다」가 되어 아무것도 못 재고, 손 정답만 있으면 둘 중 한쪽만 재는
 * 셈이 된다.
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
  // ⑦ 🔴 **창 안인데 [납기일 확정]됐다** — 종에서는 빠지고 **배지는 선다**(③-다).
  { id: "misc-7", dueDates: [confirmedRow(TODAY)] },
  // ⑧ 🔴 회차 둘이 함께 창 안인데 **1차만 확정** — 종은 2차 하나, 배지는 하나(④).
  { id: "misc-8", dueDates: [confirmedRow(TODAY), openRow(LAST_DAY)] },
];

/** 🔴 손으로 적은 정답 — **배지**. 확정은 배지를 끄지 않으므로 ⑦⑧ 이 들어 있다. */
const EXPECTED_BADGE = ["misc-1", "misc-2", "misc-3", "misc-7", "misc-8"];
/** 🔴 손으로 적은 정답 — **종**. ⑦ 은 확정이라 빠지고, ⑧ 은 2차가 남아 있다. */
const EXPECTED_BELL = ["misc-1", "misc-2", "misc-3", "misc-8"];

type Sample = readonly { id: string; dueDates: Row[] }[];

/** 배지가 서는 건 — 화면 둘(목록 · 상세)이 부르는 바로 그 함수로 센다. */
function badgedOrderIds(sample: Sample = SAMPLE): string[] {
  return sample
    .filter((order) => isMiscCaseDueDateNear(order.dueDates, NOW))
    .map((order) => order.id);
}

/**
 * 종에 뜨는 건 — **알림 한 줄을 실제로 만들어** 그 `targetKey` 를 모은다.
 *
 * 🔴 조회(db/queries/…)는 server-only 와 DB 를 끌고 들어와 여기서 부를 수 없다. 그래서
 * 조회가 하는 일 가운데 **DB 가 아닌 부분**을 그대로 되밟는다: 회차마다 판정 → **확정된
 * 회차 빼기** → 통과한 회차마다 알림 한 줄. 🔵 그 세 단계가 조회의 글자와 같다는 사실은
 * 이웃 파일이 원본을 읽어 못 박는다(domestic-order-due-date-near-notification.test.ts).
 */
function notifiedOrderIds(sample: Sample = SAMPLE): string[] {
  const ids: string[] = [];
  for (const order of sample) {
    for (const [index, row] of order.dueDates.entries()) {
      if (!isDomesticOrderDueDateRowNear(row, NOW)) continue;
      // 🔴 조회가 이 자리에서 확정을 거른다(배지 쪽 판정 안이 아니다 — ⑦).
      if (isDomesticOrderDueDateRowConfirmed(row)) continue;
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

/** 같은 표본에서 **확정 표시만 걷어낸 것** — 「확정 전에는 둘이 같다」를 재는 자리. */
function withoutConfirmation(sample: Sample): Sample {
  return sample.map((order) => ({
    ...order,
    dueDates: order.dueDates.map((row) => ({ ...row, confirmedAt: null })),
  }));
}

describe("③ 🔴 알림과 배지 — 확정 전에는 같고, 확정하면 종만 빠진다", () => {
  test("🔵 못 — 표본이 양쪽으로 갈려 있고, 확정된 회차가 실제로 들어 있다", () => {
    assert.equal(SAMPLE.length, 8);
    assert.ok(
      EXPECTED_BADGE.length > 0 && EXPECTED_BADGE.length < SAMPLE.length,
      "표본이 한쪽으로 쏠렸다"
    );
    const confirmedRows = SAMPLE.flatMap((order) => order.dueDates).filter((row) =>
      isDomesticOrderDueDateRowConfirmed(row)
    );
    assert.equal(confirmedRows.length, 2, "확정된 회차가 표본에 없다 — 아래가 전부 뜻을 잃는다");
    // 🔴 그 확정된 회차가 **창 안**이어야 한다. 창 밖이면 확정과 상관없이 안 뜬다.
    for (const row of confirmedRows) {
      assert.equal(isDomesticOrderDueDateRowNear(row, NOW), true, "확정 표본이 창 밖이다");
    }
  });

  test("🔴 가 — 배지가 서는 건이 손으로 적은 정답과 같다(확정된 줄도 선다)", () => {
    assert.deepEqual(badgedOrderIds(), EXPECTED_BADGE);
  });

  test("🔴 가 — 종에 뜨는 건이 손으로 적은 정답과 같다(확정된 줄은 빠진다)", () => {
    assert.deepEqual([...new Set(notifiedOrderIds())], EXPECTED_BELL);
  });

  test("🔴 나 — **확정이 없으면 둘은 글자 그대로 같다**(옛 보호 장치 그대로)", () => {
    // 🔴 2026-11-25 에 확정이 들어오기 전까지 이 파일이 지키던 선이다. 지우지 않았다 —
    //    확정을 걷어낸 표본에서는 지금도 **어느 한쪽만 고쳐지면 여기서 멈춘다.**
    const plain = withoutConfirmation(SAMPLE);
    // 🔵 못 — 걷어낸 표본에 확정이 하나도 안 남았는가.
    assert.equal(
      plain.flatMap((order) => order.dueDates).filter((row) => isDomesticOrderDueDateRowConfirmed(row))
        .length,
      0
    );
    assert.deepEqual(
      badgedOrderIds(plain),
      [...new Set(notifiedOrderIds(plain))],
      "종에는 없는 배지가 표에만 서거나 그 반대다 — 판정이 두 벌이 됐다"
    );
    // 그리고 그때의 답은 배지 쪽 정답과 같다(⑦ 이 확정 때문에만 갈렸다는 뜻이다).
    assert.deepEqual(badgedOrderIds(plain), EXPECTED_BADGE);
  });

  test("🔴 다 — **확정하면 종에서만 빠진다.** 갈리는 줄은 확정된 그 줄 하나뿐이다", () => {
    const badged = badgedOrderIds();
    const notified = new Set(notifiedOrderIds());
    const badgeOnly = badged.filter((id) => !notified.has(id));
    assert.deepEqual(badgeOnly, ["misc-7"], "확정과 상관없는 줄에서 종과 배지가 갈렸다");
    // 🔴 반대 방향은 **없어야 한다** — 종에 뜨는데 배지가 없는 건은 어느 경우에도 틀렸다.
    const bellOnly = [...notified].filter((id) => !badged.includes(id));
    assert.deepEqual(bellOnly, [], "종에는 떴는데 표에 배지가 없다 — 사람이 까닭을 알 수 없다");
  });
});

describe("④ 🔵 그래도 세는 단위는 다르다 — 알림은 회차마다, 배지는 건마다", () => {
  test("회차 둘이 함께 임박한 줄에서 알림은 두 줄, 배지는 하나다", () => {
    const rows = notifiedOrderIds().filter((id) => id === "misc-3");
    assert.equal(rows.length, 2, "표본이 달라졌다 — 회차 둘이 함께 임박한 줄이 없다");
    assert.equal(badgedOrderIds().filter((id) => id === "misc-3").length, 1);
  });

  test("🔴 **회차 하나만 확정한 줄** — 종은 한 줄로 줄고, 배지는 그대로 하나다", () => {
    // 🔵 끄는 단위가 **회차**라는 사실이 여기서만 값으로 보인다. 줄 단위로 끄는 구현은
    //    misc-8 의 종을 0 줄로 만들어 여기서 걸린다.
    assert.equal(
      notifiedOrderIds().filter((id) => id === "misc-8").length,
      1,
      "1차를 확정했더니 2차의 종까지 꺼졌다(또는 1차가 아직 운다)"
    );
    assert.equal(badgedOrderIds().filter((id) => id === "misc-8").length, 1);
    // 확정 전에는 두 줄이었다 — 줄어든 것이 확정 때문임을 못 박는다.
    assert.equal(notifiedOrderIds(withoutConfirmation(SAMPLE)).filter((id) => id === "misc-8").length, 2);
  });

  test("🔴 그래서 알림 줄 수가 건 수보다 많다 — 같아지면 위 ③이 뜻을 잃는다", () => {
    // 🔴 「배지 수보다 많다」로 적으면 안 된다 — 확정된 줄(⑦)이 배지 쪽에만 남아
    //    두 수가 우연히 같아지고, 그러면 이 시험은 아무것도 안 재면서 초록이 된다.
    //    묻는 것은 애초에 **한 건이 종에 여러 줄로 서는가**다.
    const notified = notifiedOrderIds();
    assert.ok(
      notified.length > new Set(notified).size,
      "표본에 회차가 여럿 임박한 줄이 없다 — 접는 규칙을 아무것도 안 재고 있다"
    );
    // 확정을 걷어낸 표본에서는 줄 수가 배지 수보다도 많다(옛 모양 그대로).
    const plain = withoutConfirmation(SAMPLE);
    assert.ok(notifiedOrderIds(plain).length > badgedOrderIds(plain).length);
  });
});

/* ═══════════════ ⑤⑥⑦ 판정하는 자리 — 서버 둘, 기타건만, 그리고 확정이 안 섞인다 */

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

/**
 * 🔴 **배지 쪽 판정 **본문**만 잘라 낸다.** 이웃 함수의 주석이 섞이면(그 주석에 확정
 * 이야기가 길게 적혀 있다) 아래 「확정이라는 말이 없다」가 영영 거짓이 된다. 그래서
 * `export function …` 부터 그 함수의 닫는 괄호까지만 본다.
 */
const DOMAIN_SOURCE = read("src/lib/domain/notifications.ts");
function functionBody(name: string): string {
  const start = DOMAIN_SOURCE.indexOf(`export function ${name}`);
  assert.ok(start >= 0, `${name} 을 원본에서 못 찾았다 — 이름이 바뀌었다`);
  const end = DOMAIN_SOURCE.indexOf("\n}\n", start);
  assert.ok(end > start, `${name} 의 본문 끝을 못 찾았다`);
  return DOMAIN_SOURCE.slice(start, end);
}

describe("⑦ 🔴 확정 거르기가 **배지 쪽 판정 안으로 들어오지 않는다**", () => {
  test("🔵 못 — 잘라 낸 본문이 실제로 그 함수다(비면 아래가 전부 공짜다)", () => {
    for (const name of ["isDomesticOrderDueDateRowNear", "isMiscCaseDueDateNear"]) {
      const body = functionBody(name);
      assert.ok(body.length > 50, `${name} 본문이 너무 짧다(${body.length})`);
      assert.ok(body.includes("return"), `${name} 본문에 return 이 없다 — 엉뚱한 자리를 잘랐다`);
    }
  });

  test("🔴 두 판정 어디에도 `confirmed` 라는 글자가 없다 — 있으면 배지가 함께 꺼진다", () => {
    for (const name of ["isDomesticOrderDueDateRowNear", "isMiscCaseDueDateNear"]) {
      assert.equal(
        /confirmed/i.test(functionBody(name)),
        false,
        `${name} 가 확정을 본다 — 확정하면 배지와 붉은 날짜까지 사라진다(사용자 결정은 종만)`
      );
    }
  });

  test("🔴 그 대신 **알림 조회**가 확정을 거른다 — 아무 데서도 안 걸러지면 안 된다", () => {
    // 🔵 「배지가 안 본다」만 재면 **아무도 안 보는** 구현(=종이 안 꺼지는 구현)이 통과한다.
    const query = read("src/lib/db/queries/domestic-order-due-date-near-notifications.ts");
    assert.ok(
      query.includes("isDomesticOrderDueDateRowConfirmed("),
      "기타건 종 알림 조회가 확정을 안 거른다 — 확정해도 종이 그대로 운다"
    );
    assert.match(
      query,
      /import \{[^}]*\bisDomesticOrderDueDateRowConfirmed\b[^}]*\} from "@\/lib\/domain\/notifications"/,
      "확정 판정을 제 파일에 또 만들어 두었다"
    );
    assert.equal(
      query.includes("confirmedAt !== null"),
      false,
      "조회가 확정 판정을 손으로 다시 적고 있다 — 규칙이 두 벌이 됐다"
    );
  });
});
