import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

import { sumQuoteLaborCost, type SelectedRepairTask } from "./quote-labor-cost";
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
import { isWorkScopeSectionSuppressed } from "./quote-work-scope-suppression";
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
 * 실제 값으로 못 박는다 — 제너레이터는 기본 350만원이고 `OH` 가 24시간이므로
 * O/H 한 건만 골랐을 때 **590만원**이 나와야 한다(2026-08-31 사용자 자료).
 * ============================================================================
 */

function task(patch: Partial<SelectedRepairTask> = {}): SelectedRepairTask {
  return { taskName: "OH", hours: 24, hourlyRate: "100000", ...patch };
}

test("🔴 실제 값 — 제너레이터에서 OH 하나를 고르면 350만 + 240만 = 590만원", () => {
  const result = sumQuoteLaborCost([task()], "3500000");
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
    "3500000"
  );
  assert.equal(result.tasksTotal, 3800000, "(24+2+12)시간 × 10만원");
  assert.equal(result.total, 7300000);
});

test("아무것도 안 고르면 기본 작업비만 남는다", () => {
  const result = sumQuoteLaborCost([], "3500000");
  assert.equal(result.tasksTotal, 0);
  assert.equal(result.total, 3500000);
});

test("🔴 정하지 않은 기본 작업비(null)를 0 으로 접지 않는다 — 접으면 정하지 않은 사실이 사라진다", () => {
  const result = sumQuoteLaborCost([task({ hours: 8 })], null);
  assert.equal(result.baseCost, null, "더하지 않았다는 사실이 남아야 화면이 알린다");
  assert.equal(result.total, 800000);
});

test("기본 작업비 '0' 은 실제 0원이라 더해지고, 정하지 않은 것과 구별된다", () => {
  const zero = sumQuoteLaborCost([task({ hours: 8 })], "0");
  assert.equal(zero.baseCost, 0, "0 은 '더했는데 0원'이다");
  assert.equal(zero.total, 800000);

  const unset = sumQuoteLaborCost([task({ hours: 8 })], null);
  assert.equal(unset.baseCost, null, "null 은 '아예 안 더했다'이다");
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
    "3500000"
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

/**
 * ============================================================================
 * 통전작업 제외 — 기본 작업비 안에 이미 들어 있는 몫을 뺀다
 * ============================================================================
 * 실제 값으로 못 박는다(2026-09-04 사용자): 제너레이터·매쳐의 기본 작업비
 * 350만원 안에 **통전작업 14시간 = 140만원**이 들어 있다. 통전작업을 하지 않는
 * 견적서는 350만 − 140만 = **210만원**이 되어야 한다.
 *
 * 🔴 이 묶음이 지키는 것은 금액 하나가 아니라 **"못 뺐으면 못 뺐다고 말한다"**
 * 이다. 조용히 0 을 빼면 합계는 350만원인데 사람은 210만원이 나온 줄 안다.
 * ============================================================================
 */
describe("통전작업 제외", () => {
  /** 제너레이터의 실제 값. 14시간 × 10만원 = 140만원. */
  const GENERATOR = { excluded: true, hours: 14, hourlyRate: "100000" };

  test("🔴 실제 값 — 제너레이터에서 통전작업을 빼면 350만 − 140만 = 210만원", () => {
    const result = sumQuoteLaborCost([], "3500000", GENERATOR);
    assert.equal(result.powerTestDeduction, 1400000);
    assert.equal(result.powerTestNotice, null, "그대로 뺐으면 할 말이 없다");
    assert.equal(result.total, 2100000);
    assert.equal(result.baseCost, 3500000, "기본 작업비는 그때 값 그대로 남는다");
  });

  test("고른 작업은 차감에 걸리지 않는다 — 뺀 몫은 기본 작업비에서만 나간다", () => {
    const result = sumQuoteLaborCost([task()], "3500000", GENERATOR);
    assert.equal(result.tasksTotal, 2400000, "OH 24시간은 그대로 청구한다");
    assert.equal(result.total, 4500000, "(350만 − 140만) + 240만");
  });

  test("🔴 T/C — 통전 공수시간을 정하지 않았으면 빼지 않고, 왜 못 뺐는지 말한다", () => {
    // 조용히 0 을 빼면 합계는 220만원 그대로인데 사람은 뺀 줄 안다.
    const result = sumQuoteLaborCost([], "2200000", {
      excluded: true,
      hours: null,
      hourlyRate: "100000",
    });
    assert.equal(result.powerTestDeduction, null, "0 을 빼지 않는다");
    assert.equal(result.powerTestNotice, "NO_POWER_TEST_HOURS");
    assert.equal(result.total, 2200000, "합계는 뺀 적 없는 값 그대로다");
  });

  test("기본 작업비를 정하지 않았으면 뺄 바탕이 없다 — 지금 동작 그대로 둔다", () => {
    const result = sumQuoteLaborCost([task({ hours: 8 })], null, GENERATOR);
    assert.equal(result.baseCost, null);
    assert.equal(result.powerTestDeduction, null);
    assert.equal(result.powerTestNotice, "NO_BASE_COST");
    assert.equal(result.total, 800000, "고른 작업의 합만 남는다");
  });

  test("🔴 뺄 금액이 기본 작업비보다 크면 0 에서 멈춘다 — 음수 청구는 없다", () => {
    const result = sumQuoteLaborCost([], "1000000", {
      excluded: true,
      hours: 14,
      hourlyRate: "100000",
    });
    assert.equal(result.powerTestDeduction, 1000000, "실제로 뺀 금액은 기본 작업비까지다");
    assert.equal(result.powerTestNotice, "CLAMPED_TO_ZERO", "멈췄다는 사실을 화면이 알린다");
    assert.equal(result.total, 0);
    assert.ok(result.total >= 0, "합계가 음수가 되면 안 된다");
  });

  test("시간당 작업비를 숫자로 읽을 수 없으면 빼지 않고 알린다", () => {
    for (const hourlyRate of ["abc", ""]) {
      const result = sumQuoteLaborCost([], "3500000", { excluded: true, hours: 14, hourlyRate });
      assert.equal(result.powerTestDeduction, null, `"${hourlyRate}" 로 0 을 뺐다`);
      assert.equal(result.powerTestNotice, "UNKNOWN_HOURLY_RATE");
      assert.equal(result.total, 3500000);
    }
  });

  test("체크를 켜지 않으면 통전 시간이 있어도 빼지 않는다 — 사람의 결정이다", () => {
    const result = sumQuoteLaborCost([], "3500000", { ...GENERATOR, excluded: false });
    assert.equal(result.total, 3500000);
    assert.equal(result.powerTestDeduction, undefined, "부탁하지 않았으니 키도 없다");
  });

  test("🔴 옛 견적서 — 차감을 주지 않으면 결과 객체가 통째로 예전 그대로다", () => {
    // power_test_excluded 는 옛 행에서 전부 false 다. 그 장을 다시 열어도
    // 화면이 셈하는 값이 한 글자도 달라지지 않아야 한다.
    assert.deepEqual(sumQuoteLaborCost([task()], "3500000"), {
      total: 5900000,
      tasksTotal: 2400000,
      baseCost: 3500000,
      unknown: [],
    });
    assert.deepEqual(sumQuoteLaborCost([task()], "3500000", { ...GENERATOR, excluded: false }), {
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
 * 수정 화면은 이 함수로 「3) 통전작업」 칸을 감춘다(QuoteEditForm). 문서 쪽은
 * xlsx 생성기 셋이 각자 `POWER_TEST: input.powerTestExcluded === true` 로 적는다.
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

describe("작업 내역 감춤 — 판정", () => {
  test("🔴 제외 켜짐 → 통전작업만 감춘다, 조사·수리는 그대로 둔다", () => {
    const options = { powerTestExcluded: true };
    assert.equal(isWorkScopeSectionSuppressed("POWER_TEST", options), true);
    assert.equal(isWorkScopeSectionSuppressed("INVESTIGATION", options), false);
    assert.equal(isWorkScopeSectionSuppressed("REPAIR", options), false);
  });

  test("🔴 제외 꺼짐 → 아무것도 감추지 않는다", () => {
    for (const section of QUOTE_WORK_SCOPE_SECTIONS) {
      assert.equal(isWorkScopeSectionSuppressed(section, { powerTestExcluded: false }), false, section);
    }
  });
});

// ── 문서 쪽 규칙과 같은 답 ─────────────────────────────────────────────

const repoUrl = new URL("../../../", import.meta.url);
/** CRLF 로 받아 둔 저장소에서도 같게 보이도록 줄바꿈을 맞추고 공백을 하나로 접는다. */
const readFlat = (relativePath: string) =>
  readFileSync(new URL(relativePath, repoUrl), "utf8").replace(/\s+/g, " ");

const GENERATOR_SOURCES = [
  "src/lib/xlsx/quote-template.ts",
  "src/lib/xlsx/matcher-quote-template.ts",
  "src/lib/xlsx/oh-quote-template.ts",
] as const;

/** 생성기 셋이 적어 둔 판정 줄. 셋 다 이 모양이어야 아래 셈이 그 셋의 답이 된다. */
const XLSX_EXCLUSION_LITERAL =
  "const excluded: WorkScopeExclusions = { ...NO_WORK_SCOPE_EXCLUSIONS, POWER_TEST: input.powerTestExcluded === true, };";

/** 위 줄을 그대로 옮긴 셈 — 생성기가 `input.powerTestExcluded` 로 받는 값에 대해. */
function xlsxExclusions(powerTestExcluded: boolean): WorkScopeExclusions {
  return { ...NO_WORK_SCOPE_EXCLUSIONS, POWER_TEST: powerTestExcluded === true };
}

describe("작업 내역 감춤 — xlsx 생성기 셋과 같은 답", () => {
  test("묶음 축이 같다 — 저장 쪽 키와 xlsx 쪽 키", () => {
    assert.deepEqual([...WORK_SCOPE_SECTIONS], [...QUOTE_WORK_SCOPE_SECTIONS]);
  });

  test("🔴 생성기 셋이 모두 같은 판정 줄을 쓴다 — 하나라도 달라지면 여기서 멈춘다", () => {
    for (const path of GENERATOR_SOURCES) {
      const source = readFlat(path);
      assert.ok(source.includes(XLSX_EXCLUSION_LITERAL), `${path} 의 판정 줄이 달라졌다`);
      // 판정 줄이 둘이면 어느 쪽이 쓰이는지 원본만으로 알 수 없다.
      assert.equal(
        source.split("const excluded: WorkScopeExclusions").length - 1,
        1,
        `${path} 에 판정 줄이 하나가 아니다`
      );
    }
  });

  test("기본값은 셋 다 꺼짐이다 — 켤 수 있는 것은 통전작업 하나뿐", () => {
    for (const section of WORK_SCOPE_SECTIONS) {
      assert.equal(NO_WORK_SCOPE_EXCLUSIONS[section], false, section);
    }
  });

  test("🔴 켜짐·꺼짐 모두 묶음마다 화면 판정 = 문서 판정", () => {
    for (const flag of FLAGS) {
      const excluded = xlsxExclusions(flag);
      for (const section of QUOTE_WORK_SCOPE_SECTIONS) {
        assert.equal(
          isWorkScopeSectionSuppressed(section, { powerTestExcluded: flag }),
          excluded[section],
          `제외 ${flag ? "켜짐" : "꺼짐"} · ${section}`
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
    for (const flag of FLAGS) {
      const kept = dropExcludedWorkScopeLines(lines, xlsxExclusions(flag));
      for (const section of QUOTE_WORK_SCOPE_SECTIONS) {
        assert.equal(
          kept[section].length === 0,
          isWorkScopeSectionSuppressed(section, { powerTestExcluded: flag }),
          `제외 ${flag ? "켜짐" : "꺼짐"} · ${section}`
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
  fill: (template: Buffer, powerTestExcluded: boolean) => Buffer;
};

const TEMPLATE_CASES: readonly TemplateCase[] = [
  {
    name: "제너레이터 내자",
    envKey: "QUOTE_TEMPLATE_PATH",
    sheetName: QUOTE_SHEET_NAME,
    fill: (template, powerTestExcluded) =>
      fillQuoteWorkbook(template, { ...GENERATOR_BASE, workScope: MARKED_SCOPE, powerTestExcluded }),
  },
  {
    name: "제너레이터 O/H",
    envKey: "OH_QUOTE_TEMPLATE_PATH",
    sheetName: OH_QUOTE_SHEET_NAME,
    fill: (template, powerTestExcluded) =>
      fillOhQuoteWorkbook(template, {
        ...GENERATOR_BASE,
        overhaulParts: [],
        workScope: MARKED_SCOPE,
        powerTestExcluded,
      }),
  },
  {
    name: "매쳐 내자",
    envKey: "MATCHER_QUOTE_TEMPLATE_PATH",
    sheetName: MATCHER_QUOTE_SHEET_NAME,
    fill: (template, powerTestExcluded) =>
      fillMatcherQuoteWorkbook(template, { ...GENERATOR_BASE, workScope: MARKED_SCOPE, powerTestExcluded }),
  },
];

describe("작업 내역 감춤 — 실제 양식: 문서에 남은 묶음 = 화면에서 보이는 묶음", () => {
  for (const templateCase of TEMPLATE_CASES) {
    const path = process.env[templateCase.envKey];
    const skip = path ? false : `${templateCase.envKey} 가 설정되지 않았습니다`;

    test(`🔴 ${templateCase.name}: 켜짐·꺼짐 모두 묶음마다 같은 답`, { skip }, () => {
      const template = readFileSync(path as string);
      for (const flag of FLAGS) {
        const archive = ZipArchive.fromBuffer(templateCase.fill(template, flag));
        const sheetXml = archive.readText(resolveSheetPart(archive, templateCase.sheetName));
        for (const section of QUOTE_WORK_SCOPE_SECTIONS) {
          assert.equal(
            sheetXml.includes(MARKERS[section]),
            !isWorkScopeSectionSuppressed(section, { powerTestExcluded: flag }),
            `${templateCase.name} · 제외 ${flag ? "켜짐" : "꺼짐"} · ${section}`
          );
        }
      }
    });
  }
});
