import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

import { sumQuoteLaborCost, type BaseLaborHours, type SelectedRepairTask } from "./quote-labor-cost";
// 같은 파일에 둔다: 견적서가 얼마를 청구하는가를 정하는 규칙 둘(작업비 합계 ·
// 부품 단가 넣기)이라 함께 읽히는 편이 낫고, package.json 의 시험 목록을 건드리지
// 않아도 이 파일은 이미 등록돼 있다(두 세션이 같은 저장소를 쓰는 동안 그 줄을
// 건드리면 서로 섞인다).
import { isPriceUnset, toPriceFieldValue } from "./quote-part-price";
// 이것도 같은 파일에 둔다: 「통전작업 제외」가 **작업비**에 하는 일(위 차감)과
// **문서의 작업 내역**에 하는 일(③ 을 뺀다)이라 한 신호의 두 얼굴이다. 그리고
// 🔴 package.json 의 `test` 줄이 Windows 명령줄 한도(cmd.exe 8191자)에 닿아, 파일을
// 하나만 더 적어도 `npm test` 가 「명령줄이 너무 깁니다」로 아예 돌지 않는다
// (2026-09-11 확인 — 그 줄은 8113자였다).
import {
  isInvestigationScopeEmptied,
  isRepairSectionDropped,
  isWorkScopeSectionSuppressed,
} from "./quote-work-scope-suppression";
import { quoteTemplateKey } from "./quote-template-variant";
import { QUOTE_WORK_SCOPE_SECTIONS, type QuoteWorkScopeSection } from "@/lib/validation/quote-input";
import {
  NO_WORK_SCOPE_EXCLUSIONS,
  WORK_SCOPE_SECTIONS,
  dropExcludedWorkScopeLines,
  type WorkScopeExclusions,
  type WorkScopeLines,
} from "@/lib/xlsx/quote-sheet-layout";
import { ZipArchive } from "@/lib/xlsx/zip-reader";
import { resolveSheetPart } from "@/lib/xlsx/workbook-parts";
import { fillQuoteWorkbook, QUOTE_SHEET_NAME, type GeneratorQuoteInput } from "@/lib/xlsx/quote-template";
import { fillOhQuoteWorkbook, OH_QUOTE_SHEET_NAME } from "@/lib/xlsx/oh-quote-template";
import { fillMatcherQuoteWorkbook, MATCHER_QUOTE_SHEET_NAME } from "@/lib/xlsx/matcher-quote-template";

/**
 * ============================================================================
 * 작업비 = 기본 작업비 + Σ(공수시간 × 시간당 단가)
 * ============================================================================
 * 기본 작업비는 **(조사h + 통전h + 서류h) × 시간당 단가**다(2026-09-16 사용자
 * 결정). 실제 값으로 못 박는다 — 제너레이터는 조사 21h + 통전 14h = 350만원이고
 * `OH` 가 24시간이므로 O/H 한 건만 골랐을 때 **590만원**이 나와야 한다
 * (2026-08-31 사용자 자료).
 * ============================================================================
 */

function task(patch: Partial<SelectedRepairTask> = {}): SelectedRepairTask {
  return { taskName: "OH", hours: 24, hourlyRate: "100000", ...patch };
}

/**
 * 🔴 **개발 DB 의 지금 값 그대로**(2026-09-16 이행 직후). 새 셈법이 옛 `base_cost`
 * 와 같은 금액을 내놓는지는 이 셋으로만 증명된다 — 하나라도 고치면 그 증명이 사라진다.
 *
 * | 장비 | 시간당 단가 | 조사h | 통전h | 서류h | (옛) base_cost |
 * |---|---|---|---|---|---|
 * | GENERATOR        | 100000 | 21 | 14   | NULL | 3500000 |
 * | MATCHER          | 100000 | 21 | 14   | NULL | 3500000 |
 * | TOTAL_CONTROLLER | 100000 | 22 | NULL | NULL | 2200000 |
 */
const GENERATOR: BaseLaborHours = {
  hourlyRate: "100000",
  investigationHours: 21,
  powerTestHours: 14,
  documentHours: null,
};
const MATCHER: BaseLaborHours = {
  hourlyRate: "100000",
  investigationHours: 21,
  powerTestHours: 14,
  documentHours: null,
};
const TOTAL_CONTROLLER: BaseLaborHours = {
  hourlyRate: "100000",
  investigationHours: 22,
  powerTestHours: null,
  documentHours: null,
};

/** 셋 다 정하지 않은 장비 — 기본 작업비가 `null` 이다. */
const NOTHING_SET: BaseLaborHours = {
  hourlyRate: "100000",
  investigationHours: null,
  powerTestHours: null,
  documentHours: null,
};

describe("🔴 기본 작업비 = 세 공수시간의 합 × 시간당 단가", () => {
  test("🔴 실제 값 — 개발 DB 의 공수시간으로 셈한 기본 작업비가 옛 base_cost 그대로다", () => {
    // 이 셋이 어긋나면 새 구조로 갈아 끼우면서 **청구 금액이 바뀐 것**이다.
    assert.equal(sumQuoteLaborCost([], GENERATOR).baseCost, 3500000, "제너레이터 (21+14)×10만");
    assert.equal(sumQuoteLaborCost([], MATCHER).baseCost, 3500000, "매쳐 (21+14)×10만");
    assert.equal(sumQuoteLaborCost([], TOTAL_CONTROLLER).baseCost, 2200000, "T/C 22×10만");
  });

  test("🔴 정하지 않은 몫(null)은 합계에 들어가지 않는다 — 0 으로 접지 않는다", () => {
    // T/C 는 통전·서류가 NULL 이다. 0 으로 접어도 금액은 같지만, 접는 순간 「정하지
    // 않았다」와 「0시간이다」가 한 값이 되어 화면이 그 둘을 가를 수 없다.
    assert.equal(sumQuoteLaborCost([], { ...GENERATOR, powerTestHours: null }).baseCost, 2100000, "조사 21h 만");
    assert.equal(sumQuoteLaborCost([], { ...GENERATOR, investigationHours: null }).baseCost, 1400000, "통전 14h 만");
  });

  test("🔴 셋 다 정하지 않았으면 기본 작업비는 null 이다 — 0 이 아니다", () => {
    const result = sumQuoteLaborCost([task({ hours: 8 })], NOTHING_SET);
    assert.equal(result.baseCost, null, "더하지 않았다는 사실이 남아야 화면이 알린다");
    assert.equal(result.total, 800000);
  });

  test("장비 종류를 아직 안 골랐으면(null) 기본 작업비도 없다", () => {
    const result = sumQuoteLaborCost([task({ hours: 8 })], null);
    assert.equal(result.baseCost, null);
    assert.equal(result.total, 800000);
  });

  test("🔴 서류 0시간은 '정하지 않음'이 아니라 '더했는데 0원'이다", () => {
    // 🔴 셋 중 서류만 0 을 받는다(schema/repair-labor.ts 의 그 CHECK) — 「서류작업이
    // 없는 장비」는 사람이 확인해서 내린 답이고, 그 답이 있으면 기본 작업비는 null 이
    // 아니다.
    const zero = sumQuoteLaborCost([], { ...NOTHING_SET, documentHours: 0 });
    assert.equal(zero.baseCost, 0, "0 은 '더했는데 0원'이다");
    assert.equal(sumQuoteLaborCost([], NOTHING_SET).baseCost, null, "null 은 '아예 안 더했다'이다");
  });

  test("시간당 단가를 숫자로 읽을 수 없으면 어느 몫도 셀 수 없다 — 기본 작업비가 null", () => {
    for (const hourlyRate of ["abc", ""]) {
      const result = sumQuoteLaborCost([task({ hours: 8 })], { ...GENERATOR, hourlyRate });
      assert.equal(result.baseCost, null, `"${hourlyRate}" 로 기본 작업비를 셈했다`);
      assert.equal(result.total, 800000);
    }
  });
});

describe("고른 작업 — 기본 작업비에 더한다", () => {
  test("🔴 실제 값 — 제너레이터에서 OH 하나를 고르면 350만 + 240만 = 590만원", () => {
    const result = sumQuoteLaborCost([task()], GENERATOR);
    assert.equal(result.tasksTotal, 2400000);
    assert.equal(result.baseCost, 3500000);
    assert.equal(result.total, 5900000);
  });

  test("여러 작업은 각각 공수시간 × 단가로 더해진다", () => {
    const result = sumQuoteLaborCost(
      [
        task({ taskName: "OH", hours: 24 }),
        task({ taskName: "FAN 교환", hours: 2 }),
        task({ taskName: "MCU 기판 교환 작업", hours: 12 }),
      ],
      GENERATOR
    );
    assert.equal(result.tasksTotal, 3800000, "(24+2+12)시간 × 10만원");
    assert.equal(result.total, 7300000);
  });

  test("아무것도 안 고르면 기본 작업비만 남는다", () => {
    const result = sumQuoteLaborCost([], GENERATOR);
    assert.equal(result.tasksTotal, 0);
    assert.equal(result.total, 3500000);
  });

  test("줄마다의 시간당 단가를 그대로 쓴다 — 옛 견적서가 지금 단가로 다시 셈되지 않는다", () => {
    // 단가가 오르기 전에 저장된 줄과 오른 뒤의 줄이 한 견적서에 섞일 수 있다.
    const result = sumQuoteLaborCost(
      [task({ taskName: "옛 줄", hours: 10, hourlyRate: "80000" }), task({ taskName: "새 줄", hours: 10 })],
      null
    );
    assert.equal(result.tasksTotal, 1800000, "80만 + 100만");
  });

  test("숫자로 안 읽히는 값은 합계를 NaN 으로 만들지 않고, 무엇이 빠졌는지 알린다", () => {
    const result = sumQuoteLaborCost(
      [task({ taskName: "정상", hours: 2 }), task({ taskName: "망가진 단가", hourlyRate: "abc" })],
      GENERATOR
    );
    assert.equal(result.tasksTotal, 200000);
    assert.deepEqual(result.unknown, ["망가진 단가"], "조용히 빼면 사람은 합계가 맞는 줄 안다");
    assert.equal(Number.isFinite(result.total), true);
  });

  test("빈 목록에 기본 작업비도 없으면 0 이다", () => {
    assert.deepEqual(sumQuoteLaborCost([], null), {
      total: 0,
      tasksTotal: 0,
      baseCost: null,
      unknown: [],
    });
  });
});

/**
 * ============================================================================
 * 세 가지 제외 — 조사 · 통전 · 서류
 * ============================================================================
 * 각 몫은 **자기 공수시간 × 시간당 단가**이고 서로를 보지 않는다. 실제 값
 * (제너레이터 조사 21h · 통전 14h · 10만원, 기본 350만원)으로:
 *   · 조사작업 제외만 → 조사 몫 210만원을 뺀다 → 고른 작업 + 140만원
 *   · 통전작업 제외만 → 통전 몫 140만원을 뺀다 → 고른 작업 + 210만원
 *   · 둘 다          → 두 몫을 다 뺀다 → 고른 작업만
 *   · 서류작업 제외  → 서류 시간이 NULL 이라 **뺄 금액을 몰라 못 뺀다**
 *
 * 🔴 이 묶음이 지키는 것은 금액 하나가 아니라 **"못 뺐으면 못 뺐다고 말한다"** 이다.
 * 조용히 0 을 빼면 합계는 350만원인데 사람은 210만원이 나온 줄 안다.
 * ============================================================================
 */
describe("세 가지 제외", () => {
  /** 서류 공수시간까지 정해진 장비 — 셋을 함께 켜는 갈래를 보려면 필요하다. */
  const ALL_THREE: BaseLaborHours = { ...GENERATOR, documentHours: 5 };

  test("🔴 실제 값 — 조사작업 제외만: 350만 − 조사 몫 210만 → 고른 작업 + 140만원", () => {
    assert.deepEqual(sumQuoteLaborCost([task()], GENERATOR, { investigation: true }), {
      total: 3800000,
      tasksTotal: 2400000,
      baseCost: 3500000,
      unknown: [],
      investigationDeduction: 2100000,
      investigationNotice: null,
    });
  });

  test("🔴 실제 값 — 통전작업 제외만: 350만 − 통전 몫 140만 → 고른 작업 + 210만원", () => {
    assert.deepEqual(sumQuoteLaborCost([task()], GENERATOR, { powerTest: true }), {
      total: 4500000,
      tasksTotal: 2400000,
      baseCost: 3500000,
      unknown: [],
      powerTestDeduction: 1400000,
      powerTestNotice: null,
    });
  });

  test("🔴 서류작업 제외만 — 서류 5시간이면 50만원이 빠진다", () => {
    const result = sumQuoteLaborCost([], ALL_THREE, { document: true });
    assert.equal(result.baseCost, 4000000, "(21+14+5)×10만");
    assert.equal(result.documentDeduction, 500000);
    assert.equal(result.documentNotice, null, "그대로 뺐으면 할 말이 없다");
    assert.equal(result.total, 3500000);
  });

  test("🔴 조사 + 통전 — 두 몫을 다 빼면 고른 작업만 남는다", () => {
    assert.deepEqual(sumQuoteLaborCost([task()], GENERATOR, { investigation: true, powerTest: true }), {
      total: 2400000,
      tasksTotal: 2400000,
      baseCost: 3500000,
      unknown: [],
      investigationDeduction: 2100000,
      investigationNotice: null,
      powerTestDeduction: 1400000,
      powerTestNotice: null,
    });
  });

  test("🔴 셋 다 — 기본 작업비가 남김없이 빠져 고른 작업만 남는다", () => {
    const result = sumQuoteLaborCost([task()], ALL_THREE, {
      investigation: true,
      powerTest: true,
      document: true,
    });
    assert.equal(result.baseCost, 4000000);
    assert.equal(result.investigationDeduction, 2100000);
    assert.equal(result.powerTestDeduction, 1400000);
    assert.equal(result.documentDeduction, 500000);
    assert.equal(result.total, 2400000, "고른 작업만");
  });

  test("🔴 세 몫의 합이 곧 기본 작업비다 — 따로따로 뺀 금액을 더하면 400만원", () => {
    const one = (exclusions: Parameters<typeof sumQuoteLaborCost>[2]) =>
      sumQuoteLaborCost([], ALL_THREE, exclusions);
    const sum =
      (one({ investigation: true }).investigationDeduction ?? 0) +
      (one({ powerTest: true }).powerTestDeduction ?? 0) +
      (one({ document: true }).documentDeduction ?? 0);
    assert.equal(sum, 4000000);
  });

  test("고른 작업은 차감에 걸리지 않는다 — 뺀 몫은 기본 작업비에서만 나간다", () => {
    const result = sumQuoteLaborCost([task()], GENERATOR, { powerTest: true });
    assert.equal(result.tasksTotal, 2400000, "OH 24시간은 그대로 청구한다");
    assert.equal(result.total, 4500000, "(350만 − 140만) + 240만");
  });

  test("🔴 셋 다 켜고 작업을 하나도 안 고르면 0원 — 음수가 아니다", () => {
    const result = sumQuoteLaborCost([], ALL_THREE, {
      investigation: true,
      powerTest: true,
      document: true,
    });
    assert.equal(result.total, 0);
  });

  test("체크를 켜지 않으면 시간이 있어도 빼지 않는다 — 사람의 결정이다", () => {
    const result = sumQuoteLaborCost([], GENERATOR, { investigation: false, powerTest: false });
    assert.equal(result.total, 3500000);
    assert.equal(result.powerTestDeduction, undefined, "부탁하지 않았으니 키도 없다");
    assert.equal(result.investigationDeduction, undefined);
  });

  describe("🔴 못 빼면 빼지 않고 까닭을 돌려준다", () => {
    test("🔴 서류 — 지금 세 장비 모두 서류 시간이 NULL 이라 이 경로가 실제로 쓰인다", () => {
      const result = sumQuoteLaborCost([task({ hours: 2 })], GENERATOR, { document: true });
      assert.equal(result.documentDeduction, null, "0 을 빼지 않는다");
      assert.equal(result.documentNotice, "NO_HOURS");
      assert.equal(result.total, 3700000, "합계는 뺀 적 없는 값 그대로다 — 350만 + 20만");
    });

    test("🔴 통전 — T/C 는 통전 공수시간을 정하지 않았다", () => {
      // 조용히 0 을 빼면 합계는 220만원 그대로인데 사람은 뺀 줄 안다.
      const result = sumQuoteLaborCost([], TOTAL_CONTROLLER, { powerTest: true });
      assert.equal(result.powerTestDeduction, null, "0 을 빼지 않는다");
      assert.equal(result.powerTestNotice, "NO_HOURS");
      assert.equal(result.total, 2200000, "합계는 뺀 적 없는 값 그대로다");
    });

    test("🔴 조사 — 조사 공수시간을 정하지 않은 장비", () => {
      const result = sumQuoteLaborCost([], { ...GENERATOR, investigationHours: null }, { investigation: true });
      assert.equal(result.investigationDeduction, null);
      assert.equal(result.investigationNotice, "NO_HOURS");
      assert.equal(result.total, 1400000, "통전 몫 140만원은 그대로 남는다");
    });

    test("🔴 한 갈래를 못 빼도 다른 갈래는 그대로 뺀다 — 서로를 보지 않는다", () => {
      const result = sumQuoteLaborCost([], GENERATOR, {
        investigation: true,
        powerTest: true,
        document: true,
      });
      assert.equal(result.investigationDeduction, 2100000, "조사는 뺐다");
      assert.equal(result.powerTestDeduction, 1400000, "통전도 뺐다");
      assert.equal(result.documentDeduction, null, "서류만 못 뺐다");
      assert.equal(result.documentNotice, "NO_HOURS");
      assert.equal(result.total, 0);
    });

    test("🔴 장비 종류를 안 골랐으면(base 가 null) 어느 몫도 셀 수 없다", () => {
      const result = sumQuoteLaborCost([task({ hours: 8 })], null, {
        investigation: true,
        powerTest: true,
        document: true,
      });
      assert.equal(result.baseCost, null, "null 을 0 으로 접지 않는다");
      for (const notice of [result.investigationNotice, result.powerTestNotice, result.documentNotice]) {
        assert.equal(notice, "NO_HOURS");
      }
      assert.equal(result.total, 800000, "고른 작업의 합만");
    });

    test("시간당 작업비를 숫자로 읽을 수 없으면 셋 다 못 뺀다", () => {
      for (const hourlyRate of ["abc", ""]) {
        const result = sumQuoteLaborCost([], { ...GENERATOR, hourlyRate }, {
          investigation: true,
          powerTest: true,
          document: true,
        });
        assert.equal(result.investigationDeduction, null, `"${hourlyRate}" 로 조사 몫을 뺐다`);
        assert.equal(result.investigationNotice, "UNKNOWN_HOURLY_RATE");
        assert.equal(result.powerTestNotice, "UNKNOWN_HOURLY_RATE");
        // 서류는 시간부터 모른다 — 단가를 보기 전에 답이 난다.
        assert.equal(result.documentNotice, "NO_HOURS");
        assert.equal(result.total, 0, "기본 작업비도 셀 수 없으니 더한 것이 없다");
      }
    });
  });

  test("🔴 어떤 값이 와도 합계는 고른 작업의 합 이상, 고른 작업 + 기본 작업비 이하다 — 음수 없음", () => {
    const taskSets: SelectedRepairTask[][] = [[], [task()], [task({ hours: 2 }), task({ taskName: "FAN", hours: 1 })]];
    const flags = [true, false];
    for (const investigationHours of [21, 0, null]) {
      for (const powerTestHours of [14, 0, null]) {
        for (const documentHours of [5, 0, null]) {
          for (const hourlyRate of ["100000", "abc"]) {
            const base: BaseLaborHours = { hourlyRate, investigationHours, powerTestHours, documentHours };
            for (const investigation of flags) {
              for (const powerTest of flags) {
                for (const documentOff of flags) {
                  for (const tasks of taskSets) {
                    const result = sumQuoteLaborCost(tasks, base, {
                      investigation,
                      powerTest,
                      document: documentOff,
                    });
                    const label = `${JSON.stringify(base)} · 제외 ${investigation}/${powerTest}/${documentOff} · 작업 ${tasks.length}줄`;
                    assert.ok(result.total >= result.tasksTotal, label);
                    assert.ok(result.total <= result.tasksTotal + (result.baseCost ?? 0), label);
                    // 켰으니 키가 있다 — 없으면 화면이 까닭을 못 말한다.
                    if (investigation) assert.ok(result.investigationDeduction !== undefined, label);
                    if (powerTest) assert.ok(result.powerTestDeduction !== undefined, label);
                    if (documentOff) assert.ok(result.documentDeduction !== undefined, label);
                    // 셋 다 켜고 셋 다 뺐으면 기본 작업비는 남김없이 빠진다.
                    if (
                      investigation &&
                      powerTest &&
                      documentOff &&
                      result.investigationDeduction != null &&
                      result.powerTestDeduction != null &&
                      result.documentDeduction != null
                    ) {
                      assert.equal(result.total, result.tasksTotal, label);
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  });

  test("값을 읽지 못한 작업은 여전히 이름으로 알린다", () => {
    const result = sumQuoteLaborCost(
      [task({ taskName: "정상", hours: 2 }), task({ taskName: "망가진 단가", hourlyRate: "abc" })],
      GENERATOR,
      { investigation: true }
    );
    assert.equal(result.total, 200000 + 1400000);
    assert.deepEqual(result.unknown, ["망가진 단가"]);
  });

  test("🔴 세 몫을 셈하는 곳은 한 곳이다 — 갈래마다 같은 셈을 따로 적지 않는다", () => {
    const source = readFileSync(new URL("./quote-labor-cost.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n");
    const count = (text: string) => source.split(text).length - 1;
    assert.equal(count("function resolveShare("), 1);
    assert.equal(count("resolveShare("), 4, "정의 하나 + 조사 · 통전 · 서류 셋이 불러야 한다");
  });

  test("🔴 조사 몫이 「나머지」이던 시절의 알림 종류는 값으로 남아 있지 않다", () => {
    // 남겨 두면 다음 사람이 「아직 기본 작업비에서 빼서 셈하는구나」로 읽는다. 왜
    // 사라졌는지는 머리말의 「사라진 예외들」이 말한다 — 거기 적힌 이름은 따옴표에
    // 담긴 **값**이 아니라 설명이므로 이 시험에 걸리지 않는다.
    const source = readFileSync(new URL("./quote-labor-cost.ts", import.meta.url), "utf8");
    for (const gone of ['"NO_BASE_COST"', '"CLAMPED_TO_ZERO"', '"NO_POWER_TEST_HOURS"', "resolvePowerTestShare"]) {
      assert.equal(source.split(gone).length - 1, 0, `${gone} 가 아직 남아 있다`);
    }
    assert.ok(source.includes("사라진 예외들"), "왜 사라졌는지를 적어 두지 않았다");
  });

  test("🔴 제외를 주지 않거나 꺼 두면 결과 객체가 통째로 예전 그대로다 — 키도 없다", () => {
    const cases: [SelectedRepairTask[], BaseLaborHours | null][] = [
      [[task()], GENERATOR],
      [[task()], TOTAL_CONTROLLER],
      [[task({ hours: 8 })], NOTHING_SET],
      [[], null],
    ];
    for (const [tasks, base] of cases) {
      const before = sumQuoteLaborCost(tasks, base);
      const label = `기본 ${JSON.stringify(base)}`;
      assert.deepEqual(sumQuoteLaborCost(tasks, base, undefined), before, label);
      const off = sumQuoteLaborCost(tasks, base, { investigation: false, powerTest: false, document: false });
      assert.deepEqual(off, before, label);
      for (const key of [
        "investigationDeduction",
        "investigationNotice",
        "powerTestDeduction",
        "powerTestNotice",
        "documentDeduction",
        "documentNotice",
      ]) {
        assert.ok(!(key in off), `꺼 두었는데 ${key} 키가 생겼다 — ${label}`);
      }
    }
    // 위 비교는 둘 다 함께 달라지면 못 잡는다 — 값으로도 못 박는다.
    assert.deepEqual(sumQuoteLaborCost([task()], GENERATOR), {
      total: 5900000,
      tasksTotal: 2400000,
      baseCost: 3500000,
      unknown: [],
    });
  });
});
/**
 * ============================================================================
 * 단가를 화면 칸에 넣기 — "정하지 않음"과 "0"을 가르는 자리
 * ============================================================================
 * 어느 단가를 따르는지는 **줄의 출처**가 정한다(2026-08-31 사용자 결정):
 * 출고에서 담은 줄은 부품 상세의 일반 단가, O/H 템플릿에서 불러온 줄은 템플릿의
 * O/H 단가. 남은 규칙이 이것이다 — **null 을 0 으로 접지 않는 것.**
 * ============================================================================
 */
describe("단가를 화면 칸에 넣기", () => {
  test("🔴 정하지 않은 단가(null)는 빈칸이다 — 0 으로 채우면 0원으로 청구된다", () => {
    assert.equal(toPriceFieldValue(null), "");
    assert.equal(isPriceUnset(null), true);
  });

  test("🔴 '0' 은 '무상'이라는 실제 값이라 0 으로 남는다 — 빈칸과 다르다", () => {
    assert.equal(toPriceFieldValue("0"), "0");
    assert.equal(isPriceUnset("0"), false, "0 은 정하지 않은 것이 아니다");
  });

  test("numeric 이 달고 오는 소수점을 지운다 — 사람이 적지도 않은 '.00' 을 보여 주지 않는다", () => {
    assert.equal(toPriceFieldValue("160000.00"), "160000");
    assert.equal(toPriceFieldValue("2000.00"), "2000");
  });

  test("실제로 값이 있는 소수는 남긴다", () => {
    assert.equal(toPriceFieldValue("1500.50"), "1500.5");
  });

  test("숫자로 안 읽히는 값은 NaN 을 칸에 박지 않고 빈칸으로 둔다", () => {
    assert.equal(toPriceFieldValue("abc"), "", "'NaN' 이 칸에 보이면 사람이 지우는 수밖에 없다");
  });
});

/**
 * ============================================================================
 * 작업 내역의 어느 묶음이 문서에서 빠지는가 — 화면 판정과 문서 판정이 같은 답인가
 * ============================================================================
 * 수정 화면은 이 함수로 「3) 통전작업」·「2) 수리 작업」 칸을 감춘다(QuoteEditForm).
 * 문서 쪽은 xlsx 생성기 셋이 각자 판정 줄을 적는다 — 제너레이터 둘은
 * `REPAIR: input.repairSectionDropped === true` 까지, 매쳐는 통전작업만.
 * 둘이 어긋나면 "화면에서는 사라졌는데 문서에는 찍혀 나가는" 칸이 생긴다 — 이
 * 시험이 그 자리를 붙잡는다. 두 겹으로 본다:
 *
 *   1. **늘 도는 것** — 생성기 셋의 판정 줄을 원본에서 읽어 모양을 못 박고, 그 모양
 *      그대로(`NO_WORK_SCOPE_EXCLUSIONS` + 그 줄) 셈한 답과 이 함수의 답을 견준다.
 *   2. **양식이 있을 때만 도는 것** — 실제 양식을 채워, 묶음마다 넣은 표지 글자가
 *      문서에 남는지로 판정을 거꾸로 읽는다(양식은 저장소에 두지 않는다 —
 *      xlsx/quote-template.test.ts 머리말).
 * ============================================================================
 */

const FLAGS = [true, false] as const;

type SuppressionFlags = {
  investigationExcluded: boolean;
  repairSectionDropped: boolean;
  powerTestExcluded: boolean;
};

/** 세 신호의 모든 조합(8가지). */
const COMBOS: readonly SuppressionFlags[] = FLAGS.flatMap((investigationExcluded) =>
  FLAGS.flatMap((repairSectionDropped) =>
    FLAGS.map((powerTestExcluded) => ({ investigationExcluded, repairSectionDropped, powerTestExcluded }))
  )
);

const comboLabel = (flags: SuppressionFlags) =>
  `조사 뺌 ${flags.investigationExcluded} · 수리 빠짐 ${flags.repairSectionDropped} · 통전 제외 ${flags.powerTestExcluded}`;

describe("작업 내역 감춤 — 판정", () => {
  test("🔴 신호마다 제 묶음 하나만 감춘다", () => {
    const cases = [
      ["investigationExcluded", "INVESTIGATION"],
      ["repairSectionDropped", "REPAIR"],
      ["powerTestExcluded", "POWER_TEST"],
    ] as const;
    for (const [flag, section] of cases) {
      const flags: SuppressionFlags = {
        investigationExcluded: false,
        repairSectionDropped: false,
        powerTestExcluded: false,
        [flag]: true,
      };
      for (const other of QUOTE_WORK_SCOPE_SECTIONS) {
        assert.equal(isWorkScopeSectionSuppressed(other, flags), other === section, `${flag} · ${other}`);
      }
    }
  });

  test("🔴 셋 다 꺼짐 → 아무것도 감추지 않는다", () => {
    for (const section of QUOTE_WORK_SCOPE_SECTIONS) {
      assert.equal(
        isWorkScopeSectionSuppressed(section, {
          investigationExcluded: false,
          powerTestExcluded: false,
          repairSectionDropped: false,
        }),
        false,
        section
      );
    }
  });
});

describe("「① 조사작업」을 빼는가 — 손대서 비웠을 때만", () => {
  test("🔴 손대서 비웠으면 뺀다 — 공백뿐인 줄은 없는 줄이다", () => {
    assert.equal(isInvestigationScopeEmptied({ touched: true, texts: [] }), true);
    assert.equal(isInvestigationScopeEmptied({ touched: true, texts: ["", "   "] }), true);
  });

  test("🔴 손대지 않은 빈 칸은 빼지 않는다 — 옛 견적서 · 장비 종류를 안 고른 새 견적서", () => {
    assert.equal(isInvestigationScopeEmptied({ touched: false, texts: [] }), false);
  });

  test("줄이 하나라도 있으면 빼지 않는다", () => {
    assert.equal(isInvestigationScopeEmptied({ touched: true, texts: ["외관검사"] }), false);
    assert.equal(isInvestigationScopeEmptied({ touched: true, texts: ["", "외관검사"] }), false);
  });
});

describe("「② 수리 작업」이 빠지는가 — 제너레이터에서 수리 작업을 하나도 안 골랐을 때", () => {
  test("🔴 제너레이터: 0개면 빠지고, 하나라도 골랐으면 남는다", () => {
    assert.equal(isRepairSectionDropped({ equipmentKind: "GENERATOR", chosenRepairTaskCount: 0 }), true);
    assert.equal(isRepairSectionDropped({ equipmentKind: "GENERATOR", chosenRepairTaskCount: 1 }), false);
    assert.equal(isRepairSectionDropped({ equipmentKind: "GENERATOR", chosenRepairTaskCount: 5 }), false);
  });

  test("장비 종류가 없으면 제너레이터 양식이 쓰이므로 같은 규칙이다", () => {
    assert.equal(isRepairSectionDropped({ equipmentKind: null, chosenRepairTaskCount: 0 }), true);
    assert.equal(isRepairSectionDropped({ equipmentKind: null, chosenRepairTaskCount: 1 }), false);
  });

  test("🔴 매쳐는 하나도 안 골라도 빠지지 않는다 — 양식에 수리작업 기본 목록이 있다", () => {
    for (const chosenRepairTaskCount of [0, 1]) {
      assert.equal(isRepairSectionDropped({ equipmentKind: "MATCHER", chosenRepairTaskCount }), false);
    }
  });

  test("🔴 제너레이터·매쳐를 가르는 판단이 양식 고르기(quoteTemplateKey)와 같다", () => {
    for (const equipmentKind of ["GENERATOR", "MATCHER", null] as const) {
      for (const quoteKind of ["DOMESTIC", "OVERHAUL"] as const) {
        assert.equal(
          isRepairSectionDropped({ equipmentKind, chosenRepairTaskCount: 0 }),
          quoteTemplateKey(equipmentKind, quoteKind).startsWith("GENERATOR:"),
          `${equipmentKind} · ${quoteKind}`
        );
      }
    }
  });
});

// ── 문서 쪽 규칙과 같은 답 ─────────────────────────────────────────────

const repoUrl = new URL("../../../", import.meta.url);
/** CRLF 로 받아 둔 저장소에서도 같게 보이도록 줄바꿈을 맞추고 공백을 하나로 접는다. */
const readFlat = (relativePath: string) =>
  readFileSync(new URL(relativePath, repoUrl), "utf8").replace(/\s+/g, " ");

/** 제너레이터 둘(내자·O/H)이 적어 둔 판정 줄 — 셋 다 없앨 수 있다. */
const GENERATOR_EXCLUSION_LITERAL =
  "const excluded: WorkScopeExclusions = { ...NO_WORK_SCOPE_EXCLUSIONS, INVESTIGATION: input.investigationExcluded === true, REPAIR: input.repairSectionDropped === true, POWER_TEST: input.powerTestExcluded === true, };";

/**
 * 매쳐가 적어 둔 판정 줄 — 조사작업·통전작업을 없앨 수 있다. 수리작업에는 양식 기본
 * 목록이 있어 빠질 일이 없고, 도메인(isRepairSectionDropped)도 매쳐에는 늘 거짓을 준다.
 */
const MATCHER_EXCLUSION_LITERAL =
  "const excluded: WorkScopeExclusions = { ...NO_WORK_SCOPE_EXCLUSIONS, INVESTIGATION: input.investigationExcluded === true, POWER_TEST: input.powerTestExcluded === true, };";

/** 생성기마다 적혀 있어야 하는 판정 줄. 이 모양이어야 아래 셈이 그 생성기의 답이 된다. */
const EXCLUSION_LITERALS: readonly (readonly [string, string])[] = [
  ["src/lib/xlsx/quote-template.ts", GENERATOR_EXCLUSION_LITERAL],
  ["src/lib/xlsx/oh-quote-template.ts", GENERATOR_EXCLUSION_LITERAL],
  ["src/lib/xlsx/matcher-quote-template.ts", MATCHER_EXCLUSION_LITERAL],
];

/** 제너레이터의 판정 줄을 그대로 옮긴 셈 — 생성기가 받는 세 값에 대해. */
function xlsxExclusions(flags: SuppressionFlags): WorkScopeExclusions {
  return {
    ...NO_WORK_SCOPE_EXCLUSIONS,
    INVESTIGATION: flags.investigationExcluded === true,
    REPAIR: flags.repairSectionDropped === true,
    POWER_TEST: flags.powerTestExcluded === true,
  };
}

describe("작업 내역 감춤 — xlsx 생성기 셋과 같은 답", () => {
  test("묶음 축이 같다 — 저장 쪽 키와 xlsx 쪽 키", () => {
    assert.deepEqual([...WORK_SCOPE_SECTIONS], [...QUOTE_WORK_SCOPE_SECTIONS]);
  });

  test("🔴 생성기 셋이 제 판정 줄을 쓴다 — 하나라도 달라지면 여기서 멈춘다", () => {
    for (const [path, literal] of EXCLUSION_LITERALS) {
      const source = readFlat(path);
      assert.ok(source.includes(literal), `${path} 의 판정 줄이 달라졌다`);
      // 판정 줄이 둘이면 어느 쪽이 쓰이는지 원본만으로 알 수 없다.
      assert.equal(
        source.split("const excluded: WorkScopeExclusions").length - 1,
        1,
        `${path} 에 판정 줄이 하나가 아니다`
      );
    }
  });

  test("기본값은 셋 다 꺼짐이다 — 신호를 주지 않으면 하나도 없애지 않는다", () => {
    for (const section of WORK_SCOPE_SECTIONS) {
      assert.equal(NO_WORK_SCOPE_EXCLUSIONS[section], false, section);
    }
  });

  test("🔴 세 신호의 모든 조합에서 묶음마다 화면 판정 = 문서 판정", () => {
    for (const flags of COMBOS) {
      const excluded = xlsxExclusions(flags);
      for (const section of QUOTE_WORK_SCOPE_SECTIONS) {
        assert.equal(
          isWorkScopeSectionSuppressed(section, flags),
          excluded[section],
          `${comboLabel(flags)} · ${section}`
        );
      }
    }
  });

  test("문서에서 줄이 비워지는 묶음 = 화면에서 감추는 묶음", () => {
    // 생성기는 판정을 들고 dropExcludedWorkScopeLines 로 그 묶음의 줄을 비운다.
    // 셋 다 줄이 있는 입력을 넣어, 비워진 묶음이 곧 감추는 묶음인지 본다.
    const lines: WorkScopeLines = {
      INVESTIGATION: ["조사 하나"],
      REPAIR: ["수리 하나"],
      POWER_TEST: ["통전 하나"],
    };
    for (const flags of COMBOS) {
      const kept = dropExcludedWorkScopeLines(lines, xlsxExclusions(flags));
      for (const section of QUOTE_WORK_SCOPE_SECTIONS) {
        assert.equal(
          kept[section].length === 0,
          isWorkScopeSectionSuppressed(section, flags),
          `${comboLabel(flags)} · ${section}`
        );
      }
    }
  });
});

// ── 실제 양식으로 거꾸로 읽기 ──────────────────────────────────────────

/** 묶음마다 다른 표지. 문서에 남았는지를 시트 원본에서 글자로 찾는다. */
const MARKERS: Record<QuoteWorkScopeSection, string> = {
  INVESTIGATION: "SUPPRESSION-MARK-INVESTIGATION",
  REPAIR: "SUPPRESSION-MARK-REPAIR",
  POWER_TEST: "SUPPRESSION-MARK-POWER_TEST",
};

const MARKED_SCOPE: WorkScopeLines = {
  INVESTIGATION: [MARKERS.INVESTIGATION],
  REPAIR: [MARKERS.REPAIR],
  POWER_TEST: [MARKERS.POWER_TEST],
};

const GENERATOR_BASE: GeneratorQuoteInput = {
  quoteNumber: "DSS 2026-TEST",
  quoteDate: new Date(2026, 8, 11),
  customerName: "테스트 고객사",
  subject: "통전작업 제외 판정 시험",
  modelName: "TEST-MODEL",
  serialNumber: "TEST-SN",
  lotNumber: "TEST-LN",
  parts: [],
  workCost: 1_000_000,
};

type TemplateCase = {
  name: string;
  envKey: string;
  sheetName: string;
  /**
   * 「수리 작업 빠짐」을 받는 생성기인가. 매쳐는 받지 않는다 — 도메인이 매쳐에는
   * 늘 거짓을 주므로, 그 경우만 시험한다.
   */
  takesRepairDrop: boolean;
  fill: (template: Buffer, flags: SuppressionFlags) => Buffer;
};

const TEMPLATE_CASES: readonly TemplateCase[] = [
  {
    name: "제너레이터 내자",
    envKey: "QUOTE_TEMPLATE_PATH",
    sheetName: QUOTE_SHEET_NAME,
    takesRepairDrop: true,
    fill: (template, flags) => fillQuoteWorkbook(template, { ...GENERATOR_BASE, workScope: MARKED_SCOPE, ...flags }),
  },
  {
    name: "제너레이터 O/H",
    envKey: "OH_QUOTE_TEMPLATE_PATH",
    sheetName: OH_QUOTE_SHEET_NAME,
    takesRepairDrop: true,
    fill: (template, flags) =>
      fillOhQuoteWorkbook(template, { ...GENERATOR_BASE, overhaulParts: [], workScope: MARKED_SCOPE, ...flags }),
  },
  {
    name: "매쳐 내자",
    envKey: "MATCHER_QUOTE_TEMPLATE_PATH",
    sheetName: MATCHER_QUOTE_SHEET_NAME,
    takesRepairDrop: false,
    fill: (template, { investigationExcluded, powerTestExcluded }) =>
      fillMatcherQuoteWorkbook(template, {
        ...GENERATOR_BASE,
        workScope: MARKED_SCOPE,
        investigationExcluded,
        powerTestExcluded,
      }),
  },
];

describe("작업 내역 감춤 — 실제 양식: 문서에 남은 묶음 = 화면에서 보이는 묶음", () => {
  for (const templateCase of TEMPLATE_CASES) {
    const path = process.env[templateCase.envKey];
    const skip = path ? false : `${templateCase.envKey} 가 설정되지 않았습니다`;

    test(`🔴 ${templateCase.name}: 신호의 모든 조합에서 묶음마다 같은 답`, { skip }, () => {
      const template = readFileSync(path as string);
      const combos = templateCase.takesRepairDrop ? COMBOS : COMBOS.filter((flags) => !flags.repairSectionDropped);
      for (const flags of combos) {
        const archive = ZipArchive.fromBuffer(templateCase.fill(template, flags));
        const sheetXml = archive.readText(resolveSheetPart(archive, templateCase.sheetName));
        for (const section of QUOTE_WORK_SCOPE_SECTIONS) {
          assert.equal(
            sheetXml.includes(MARKERS[section]),
            !isWorkScopeSectionSuppressed(section, flags),
            `${templateCase.name} · ${comboLabel(flags)} · ${section}`
          );
        }
      }
    });
  }
});
