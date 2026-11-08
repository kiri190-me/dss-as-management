import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { toKstDateOnly } from "@/lib/domain/date-only";

/**
 * ============================================================================
 * 🔴 **자동으로 찍히는 날짜는 한국 달력 날짜여야 한다** (2026-11-08 고침)
 * ============================================================================
 * 두 자리가 `new Date().toISOString().slice(0, 10)` 으로 「오늘」을 만들고 있었다:
 *
 *  · 출하 완료 전이가 찍는 **실제 출하일**(mutations/workflow-transitions.ts).
 *  · 회차 [완료 처리]가 찍는 **납품일**(mutations/domestic-orders.ts).
 *
 * 그 식은 **UTC 날짜**다. 한국은 UTC+9 이므로 **한국 시간 00:00~09:00 사이**에 그
 * 단추를 누르면 **어제 날짜**가 찍혔다. 오류도 경고도 나지 않고 날짜만 하루
 * 어긋나므로 아무도 신고하지 않는다 — 나중에 그 줄을 보는 사람은 그냥 잘못 적힌
 * 값으로 읽는다.
 *
 * ── 🔴 왜 **둘을 한 번에** 고쳐야 했나 ─────────────────────────────────
 * 그 둘은 같은 사실(「이 건이 오늘 나갔다」)을 두 표에 적는다 — 출하 완료 전이는 수리
 * 건의 실제 출하일을 찍으면서 연결된 내자 줄의 납품일에도 같은 값을 흘려보낸다
 * (사용자 결정 6). 한쪽만 고치면 **같은 날 찍힌 두 값이 하루 어긋난다.**
 *
 * ── 재는 것 둘 ─────────────────────────────────────────────────────────
 *  ① **값** — UTC 로 밤 시각을 넣었을 때 KST 날짜가 나오는가. 🔵 그리고 **옛 식이
 *     실제로 다른 답을 낸다**는 것을 같은 자리에서 확인한다. 안 그러면 이 시험은
 *     「두 식이 같아도 통과하는」 시험이 된다(표본이 비어 공짜로 통과하는 자리다).
 *  ② **자리** — 그 두 파일이 정말 `toKstDateOnly` 를 쓰는가. 시계를 바꿔 끼울 수 없는
 *     자리라(mutation 이 `new Date()` 를 직접 만든다) 원본 글자로 읽는다 — 이 저장소의
 *     선례 그대로다(components/.../report-number-preview-wiring.test.ts).
 *     🔴 **주석을 걷어낸 뒤에 센다** — 고친 자리의 주석이 옛 식을 글자 그대로 적고
 *     있어서, 안 걷으면 「아직 UTC 를 쓴다」로 읽힌다.
 * ============================================================================
 */

/** 🔴 한국 시간 **00:00~09:00** 에 해당하는 UTC 시각 — 날짜가 갈리는 그 구간이다. */
const KST_EARLY_MORNING = [
  // KST 2026-11-09 00:00 (UTC 2026-11-08 15:00)
  { utc: "2026-11-08T15:00:00.000Z", kstDate: "2026-11-09" },
  // KST 2026-11-09 08:59 (UTC 2026-11-08 23:59)
  { utc: "2026-11-08T23:59:59.000Z", kstDate: "2026-11-09" },
  // 🔵 달이 넘어가는 자리도 함께 — 1일 새벽은 UTC 로 아직 지난 달이다.
  { utc: "2026-11-30T16:30:00.000Z", kstDate: "2026-12-01" },
  // 🔵 해가 넘어가는 자리.
  { utc: "2026-12-31T18:00:00.000Z", kstDate: "2027-01-01" },
] as const;

/** 고친 **옛 식** 그대로 — 이 시험이 무엇과 견주는지 눈에 보이게 적어 둔다. */
function oldUtcDateOnly(instant: Date): string {
  return instant.toISOString().slice(0, 10);
}

describe("① 값 — 밤 시각을 넣으면 한국 날짜가 나온다", () => {
  for (const sample of KST_EARLY_MORNING) {
    test(`🔴 ${sample.utc} → ${sample.kstDate}`, () => {
      assert.equal(toKstDateOnly(new Date(sample.utc)), sample.kstDate);
    });

    test(`🔵 **못** — 옛 식은 같은 시각에 다른 날을 내놓는다 (${sample.utc})`, () => {
      // 이 단언이 깨지면 위 시험이 아무것도 안 재고 있다는 뜻이다 — 두 식이 같은
      // 답을 내는 표본으로는 「고쳤다」를 말할 수 없다.
      assert.notEqual(
        oldUtcDateOnly(new Date(sample.utc)),
        sample.kstDate,
        "표본이 UTC/KST 가 갈리는 구간이 아니다"
      );
    });
  }

  test("🔵 낮 시각은 두 식이 같다 — 그래서 이 결함이 하루의 대부분에서 안 보였다", () => {
    const noon = new Date("2026-11-08T03:00:00.000Z"); // KST 정오
    assert.equal(toKstDateOnly(noon), "2026-11-08");
    assert.equal(oldUtcDateOnly(noon), "2026-11-08");
  });
});

/** 주석을 걷어낸다 — 고친 자리의 주석이 옛 식을 글자 그대로 적고 있다(머리말). */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split(/\r?\n/)
    .filter((line) => !/^\s*\/\//.test(line))
    .join("\n");
}

function read(path: string): string {
  return stripComments(readFileSync(path, "utf8"));
}

const workflowTransitions = read("src/lib/db/mutations/workflow-transitions.ts");
const domesticOrders = read("src/lib/db/mutations/domestic-orders.ts");

describe("② 자리 — 자동 기록 둘이 같은 함수로 오늘을 만든다", () => {
  test("🔵 **못** — 주석을 걷어낸 원본에 재는 자리가 남아 있다", () => {
    assert.ok(
      workflowTransitions.includes("setValues.actualShipmentDate = shippedOn"),
      "출하 완료가 실제 출하일을 찍는 자리를 못 찾았다 — 아래 단언이 공짜로 통과한다"
    );
    assert.ok(
      domesticOrders.includes("resolveDueDateRowCompletionDeliveredPlan"),
      "회차 완료가 납품일을 찍는 자리를 못 찾았다 — 아래 단언이 공짜로 통과한다"
    );
  });

  test("🔴 출하 완료 전이의 `shippedOn` 이 toKstDateOnly 다", () => {
    assert.ok(
      /const shippedOn = toKstDateOnly\(new Date\(\)\);/.test(workflowTransitions),
      "출하 완료가 UTC 날짜로 실제 출하일을 찍고 있다"
    );
  });

  test("🔴 회차 [완료 처리]가 찍는 납품일도 toKstDateOnly 다", () => {
    assert.ok(
      /today: toKstDateOnly\(new Date\(\)\)/.test(domesticOrders),
      "회차 완료가 UTC 날짜로 납품일을 찍고 있다"
    );
  });

  test("🔴 두 파일 어디에도 `toISOString().slice(0, 10)` 이 남아 있지 않다", () => {
    for (const [name, source] of [
      ["workflow-transitions.ts", workflowTransitions],
      ["domestic-orders.ts", domesticOrders],
    ] as const) {
      assert.ok(
        !/toISOString\(\)\s*\.slice\(0,\s*10\)/.test(source),
        `${name} 에 UTC 날짜를 만드는 식이 남아 있다`
      );
    }
  });
});
