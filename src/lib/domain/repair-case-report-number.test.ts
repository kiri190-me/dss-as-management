import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  REPORT_NUMBER_MAX_SEQUENCE,
  nextReportNumber,
  reportNumberYearDigit,
} from "./repair-case-report-number";

/**
 * 🔴 번호 체계라 틀리면 아무 오류 없이 조용히 어긋난다 — 몇 달 뒤 번호가
 * 겹치거나 건너뛴 모양으로만 드러난다. 그래서 여기서는 **맞으면 되는가**와
 * **틀리면 안 되는가**를 짝으로 본다.
 */

describe("보고서번호 앞자리", () => {
  test("연도 − 2020 이다", () => {
    assert.equal(reportNumberYearDigit("2021-01-01"), "1");
    assert.equal(reportNumberYearDigit("2026-10-18"), "6");
    assert.equal(reportNumberYearDigit("2029-12-31"), "9");
  });

  test("🔴 2030년부터는 앞자리가 없다 — 아직 정하지 않았다", () => {
    assert.equal(reportNumberYearDigit("2030-01-01"), null);
    assert.equal(reportNumberYearDigit("2031-06-15"), null);
  });

  test("2021년 이전도 없다 — 앞자리가 한 자리로 떨어지지 않는다", () => {
    assert.equal(reportNumberYearDigit("2020-12-31"), null);
    assert.equal(reportNumberYearDigit("2019-01-01"), null);
  });

  test("날짜로 읽을 수 없는 글자는 없는 것으로 본다", () => {
    assert.equal(reportNumberYearDigit(""), null);
    assert.equal(reportNumberYearDigit("오늘"), null);
    assert.equal(reportNumberYearDigit("26-10-18"), null);
  });
});

describe("다음 보고서번호", () => {
  test("올해 번호가 하나도 없으면 {앞자리}001", () => {
    assert.deepEqual(nextReportNumber([], "2026-10-18"), { ok: true, reportNumber: "6001" });
  });

  test("올해 6076 이 있으면 6077", () => {
    assert.deepEqual(nextReportNumber(["6076"], "2026-10-18"), { ok: true, reportNumber: "6077" });
  });

  test("가장 큰 것 + 1 이다 — 넣은 차례와 상관없다", () => {
    assert.deepEqual(nextReportNumber(["6010", "6003", "6007"], "2026-10-18"), {
      ok: true,
      reportNumber: "6011",
    });
  });

  test("가운데가 비어 있어도 가장 큰 것을 넘어선다 — 개수 + 1 이 아니다", () => {
    // 사람이 6002 를 지웠거나 건너뛴 모양. 이미 나간 6050 을 다시 쓰면 안 된다.
    assert.deepEqual(nextReportNumber(["6001", "6050"], "2026-10-18"), {
      ok: true,
      reportNumber: "6051",
    });
  });

  test("🔴 해가 바뀌면 001 부터 다시 시작한다 — 2026년에 6076 까지 갔어도 2027년 첫 건은 7001", () => {
    assert.deepEqual(nextReportNumber(["6076"], "2027-01-02"), { ok: true, reportNumber: "7001" });
  });

  test("🔴 작년 번호는 올해 셈에 섞이지 않는다 — 올해 것만 세고 그 안에서 가장 큰 것을 본다", () => {
    const result = nextReportNumber(["6999", "7003", "5120", "7001"], "2027-03-09");
    assert.deepEqual(result, { ok: true, reportNumber: "7004" });
  });

  test("올해 것이 하나도 없고 지난 해 번호만 쌓여 있어도 001 이다", () => {
    assert.deepEqual(nextReportNumber(["1001", "1003", "4087", "6028"], "2027-01-02"), {
      ok: true,
      reportNumber: "7001",
    });
  });

  describe("셈에서 빼는 값들 — 섞여 있어도 흔들리지 않는다", () => {
    test("숫자가 아닌 옛 값은 세지 않는다", () => {
      assert.deepEqual(nextReportNumber(["R-2026-018", "D260601", "6012", "６０５０"], "2026-10-18"), {
        ok: true,
        reportNumber: "6013",
      });
    });

    test("네 자리가 아닌 값은 세지 않는다 — 세 자리도 다섯 자리도", () => {
      assert.deepEqual(nextReportNumber(["501", "60761", "6012"], "2026-10-18"), {
        ok: true,
        reportNumber: "6013",
      });
    });

    test("비어 있는 값은 세지 않는다", () => {
      assert.deepEqual(nextReportNumber([null, undefined, "", "   ", "6012"], "2026-10-18"), {
        ok: true,
        reportNumber: "6013",
      });
    });

    test("셀 수 있는 값이 하나도 없으면 001 로 돌아간다", () => {
      assert.deepEqual(nextReportNumber(["R-2026-018", "501", null, ""], "2026-10-18"), {
        ok: true,
        reportNumber: "6001",
      });
    });

    test("앞뒤 공백만 낀 네 자리는 센다 — 옛 값에 공백이 붙어 있어도 번호가 겹치면 안 된다", () => {
      assert.deepEqual(nextReportNumber([" 6050 "], "2026-10-18"), {
        ok: true,
        reportNumber: "6051",
      });
    });
  });

  describe("🔴 번호를 못 매기는 자리 — 지어내지 않고 비운다", () => {
    test("2030년이면 매기지 않는다", () => {
      assert.deepEqual(nextReportNumber(["6076"], "2030-01-02"), {
        ok: false,
        reason: "YEAR_OUT_OF_RANGE",
      });
    });

    test("2029년까지는 매긴다 — 경계를 한 해 당겨 막지 않는다", () => {
      assert.deepEqual(nextReportNumber([], "2029-12-31"), { ok: true, reportNumber: "9001" });
    });

    test("999 를 넘기면 매기지 않는다", () => {
      assert.deepEqual(nextReportNumber(["6999"], "2026-10-18"), {
        ok: false,
        reason: "SEQUENCE_EXHAUSTED",
      });
    });

    test("999 번째까지는 매긴다 — 경계를 한 건 당겨 막지 않는다", () => {
      assert.deepEqual(nextReportNumber(["6998"], "2026-10-18"), {
        ok: true,
        reportNumber: `6${REPORT_NUMBER_MAX_SEQUENCE}`,
      });
    });

    test("999 를 넘긴 해가 지나면 다음 해에는 다시 매긴다", () => {
      assert.deepEqual(nextReportNumber(["6999"], "2027-01-01"), {
        ok: true,
        reportNumber: "7001",
      });
    });
  });
});
