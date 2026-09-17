import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  QUOTE_EXCEL_LEGACY_XLS_TEXT,
  QUOTE_EXCEL_PARSE_URL,
  createLatestQuoteExcelReader,
  parseQuoteExcelFields,
  parseQuoteExcelSheets,
  quoteExcelParseUrl,
  readHandwrittenQuoteExcel,
  type QuoteExcelParseFetch,
  type QuoteExcelParseResult,
  type QuoteExcelReadFields,
} from "./quote-excel-parse";

/**
 * ============================================================================
 * 수기 견적서 엑셀 읽기 클라이언트 — 응답을 읽는 법 · 마지막 파일만 (견적서 ①b)
 * ============================================================================
 * fetch 를 흉내 내어 읽기 통로(api/quotes/parse-excel/route.ts)의 응답 모양을 그대로 돌려준다.
 * 네트워크도 DB 도 실제 고객 파일도 없다 — 파일은 몇 바이트짜리 가짜다.
 * ============================================================================
 */

type Call = { url: string; method: string; body: Blob };
type FakeReply = { status: number; json: unknown } | { status: number; notJson: true } | "THROW" | "THROW_IN_JSON";

function fakeFetch(replies: FakeReply[]): { fetchImpl: QuoteExcelParseFetch; calls: Call[] } {
  const calls: Call[] = [];
  let index = 0;
  const fetchImpl: QuoteExcelParseFetch = async (url, init) => {
    calls.push({ url, method: init.method, body: init.body });
    const next = replies[index];
    index += 1;
    if (next === undefined) throw new Error("준비한 응답보다 많이 불렀다");
    if (next === "THROW") throw new TypeError("Failed to fetch");
    if (next === "THROW_IN_JSON") {
      return {
        ok: true,
        status: 200,
        json: () => {
          throw new SyntaxError("동기로 던지는 json");
        },
      };
    }
    if ("notJson" in next) {
      return {
        ok: next.status >= 200 && next.status < 300,
        status: next.status,
        json: async () => {
          throw new SyntaxError("Unexpected token < in JSON");
        },
      };
    }
    return { ok: next.status >= 200 && next.status < 300, status: next.status, json: async () => next.json };
  };
  return { fetchImpl, calls };
}

function xlsx(name = "수기 견적.xlsx"): File {
  return new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00])], name);
}

const ALL_NULL: QuoteExcelReadFields = {
  kind: null,
  quoteNumber: null,
  quoteDate: null,
  customerNameText: null,
  subject: null,
  modelNameText: null,
  lotNumberText: null,
  serialNumberText: null,
  validity: null,
  delivery: null,
  payment: null,
  manualSupplyAmount: null,
};

const READ_FIELDS: QuoteExcelReadFields = {
  kind: "OVERHAUL",
  quoteNumber: "DSS 2026-077",
  quoteDate: "2026-09-10",
  customerNameText: "가나 테크",
  subject: "RFK300 수리 件",
  modelNameText: "RFK300FH-AD1",
  lotNumberText: "L-12",
  serialNumberText: "S-2201",
  validity: "발행일로부터 4주",
  delivery: "발주일로부터 3주 이내",
  payment: "귀사 결제 조건",
  manualSupplyAmount: "3500000",
};

describe("성공 — 본문은 파일 그대로, 칸과 경고를 돌려준다", () => {
  test("통로 주소로 POST 하고 본문은 파일 바이트 그대로다(multipart 아님)", async () => {
    const { fetchImpl, calls } = fakeFetch([
      { status: 200, json: { sheet: "GENERATOR_OH", fields: READ_FIELDS, warnings: ["경고 한 줄"] } },
    ]);
    const file = xlsx();
    const result = await readHandwrittenQuoteExcel(file, fetchImpl);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, QUOTE_EXCEL_PARSE_URL);
    assert.equal(calls[0].url, "/api/quotes/parse-excel");
    assert.equal(calls[0].method, "POST");
    assert.equal(calls[0].body, file);
    assert.deepEqual(result, {
      ok: true,
      fields: READ_FIELDS,
      warnings: ["경고 한 줄"],
      sheet: "GENERATOR_OH",
      sheetIndex: null,
      sheets: [],
    });
  });

  test("칸이 모두 null 이어도 성공이다 — 채울 것이 없을 뿐", async () => {
    const { fetchImpl } = fakeFetch([{ status: 200, json: { sheet: "MATCHER", fields: ALL_NULL, warnings: [] } }]);
    assert.deepEqual(await readHandwrittenQuoteExcel(xlsx(), fetchImpl), {
      ok: true,
      fields: ALL_NULL,
      warnings: [],
      sheet: "MATCHER",
      sheetIndex: null,
      sheets: [],
    });
  });
});

// ─────────────────────────────────── 어떤 견적서가 들어 있나 · 어느 시트를 읽나

describe("시트 목록 · 시트 지정", () => {
  const SHEETS = [
    { index: 0, name: "내자견적서", form: "GENERATOR_DOMESTIC", recognizedBy: "header", filled: true },
    { index: 1, name: "OH견적서", form: "GENERATOR_OH", recognizedBy: "header", filled: true },
  ];

  test("응답의 sheets · sheetIndex 를 그대로 돌려준다", async () => {
    const { fetchImpl } = fakeFetch([
      {
        status: 200,
        json: { sheet: "GENERATOR_DOMESTIC", sheetIndex: 0, sheets: SHEETS, fields: ALL_NULL, warnings: [] },
      },
    ]);
    const result = await readHandwrittenQuoteExcel(xlsx(), fetchImpl);
    assert.equal(result.ok && result.sheetIndex, 0);
    assert.deepEqual(result.ok && result.sheets, SHEETS);
  });

  test("🔴 시트를 지정하면 주소에 ?sheet= 가 붙는다 — 지정이 없으면 지금까지와 같은 주소", async () => {
    const { fetchImpl, calls } = fakeFetch([
      { status: 200, json: { sheet: "GENERATOR_OH", sheetIndex: 1, sheets: SHEETS, fields: ALL_NULL, warnings: [] } },
      { status: 200, json: { sheet: "GENERATOR_DOMESTIC", sheetIndex: 0, sheets: SHEETS, fields: ALL_NULL, warnings: [] } },
    ]);
    await readHandwrittenQuoteExcel(xlsx(), fetchImpl, { sheetIndex: 1 });
    await readHandwrittenQuoteExcel(xlsx(), fetchImpl);
    assert.deepEqual(
      calls.map((call) => call.url),
      ["/api/quotes/parse-excel?sheet=1", "/api/quotes/parse-excel"]
    );
    assert.equal(quoteExcelParseUrl(0), "/api/quotes/parse-excel?sheet=0");
    assert.equal(quoteExcelParseUrl(), QUOTE_EXCEL_PARSE_URL);
  });

  test("모양이 이상한 줄만 버린다 — 나머지는 남는다", () => {
    assert.deepEqual(
      parseQuoteExcelSheets([
        SHEETS[0],
        { index: 1, name: "OH견적서", form: "OH", recognizedBy: "header", filled: true }, // 모르는 양식
        { index: -1, name: "내자견적서", form: "MATCHER", recognizedBy: "name", filled: true }, // 차례가 음수
        { index: 2, name: "  ", form: "MATCHER", recognizedBy: "name", filled: false }, // 이름이 빈 글자
        { index: 3, name: "견적서", form: "MATCHER", recognizedBy: "짐작", filled: false }, // 모르는 근거
        { index: 4, name: "견적서", form: "MATCHER", recognizedBy: "name" }, // filled 가 없다
        SHEETS[1],
      ]),
      [SHEETS[0], SHEETS[1]]
    );
  });

  test("sheets 가 배열이 아니거나 없으면 빈 목록이다", async () => {
    assert.deepEqual(parseQuoteExcelSheets(undefined), []);
    assert.deepEqual(parseQuoteExcelSheets({ 0: SHEETS[0] }), []);
    const { fetchImpl } = fakeFetch([
      { status: 200, json: { sheet: "MATCHER", sheetIndex: "첫째", sheets: "내자견적서", fields: ALL_NULL, warnings: [] } },
    ]);
    const result = await readHandwrittenQuoteExcel(xlsx(), fetchImpl);
    assert.deepEqual(result.ok && result.sheets, []);
    assert.equal(result.ok && result.sheetIndex, null);
  });

  test("🔴 고른 시트가 없으면 통로의 까닭을 그대로 보인다(조용히 딴 시트를 읽지 않는다)", async () => {
    const { fetchImpl } = fakeFetch([
      {
        status: 422,
        json: { error: "고르신 시트를 엑셀에서 찾지 못했습니다. …", code: "SHEET_NOT_FOUND" },
      },
    ]);
    const result = await readHandwrittenQuoteExcel(xlsx(), fetchImpl, { sheetIndex: 9 });
    assert.deepEqual(result, {
      ok: false,
      reason: "고르신 시트를 엑셀에서 찾지 못했습니다. …",
      status: 422,
      code: "SHEET_NOT_FOUND",
    });
  });

  test("마지막에 고른 것만 돌려주는 읽개도 시트 지정을 넘긴다", async () => {
    const seen: (number | undefined)[] = [];
    const reader = createLatestQuoteExcelReader(async (_file, options) => {
      seen.push(options?.sheetIndex);
      return { ok: true, fields: ALL_NULL, warnings: [], sheet: null, sheetIndex: null, sheets: [] };
    });
    await reader.read(xlsx());
    await reader.read(xlsx(), { sheetIndex: 1 });
    assert.deepEqual(seen, [undefined, 1]);
  });
});

describe("🔴 옛 .xls — 파일은 붙되 칸은 못 채운다는 문장", () => {
  test("통로가 415 XLS_LEGACY 를 주면 사용자가 정한 문장으로 바꾼다", async () => {
    const { fetchImpl } = fakeFetch([
      {
        status: 415,
        json: { error: "옛 엑셀 형식(.xls)입니다 — 엑셀에서 [다른 이름으로 저장] …", code: "XLS_LEGACY" },
      },
    ]);
    const result = await readHandwrittenQuoteExcel(xlsx("속은 옛 형식.xlsx"), fetchImpl);
    assert.deepEqual(result, { ok: false, reason: QUOTE_EXCEL_LEGACY_XLS_TEXT, status: 415, code: "XLS_LEGACY" });
    assert.equal(
      QUOTE_EXCEL_LEGACY_XLS_TEXT,
      "옛 엑셀 형식이라 칸을 채우지 못했습니다 — 엑셀에서 xlsx 로 다시 저장해 올리면 채워집니다"
    );
  });

  test("이름이 .xls 면 보내지도 않는다 — 대소문자 무관", async () => {
    for (const name of ["옛 견적.xls", "OLD.XLS", "old.Xls "]) {
      const { fetchImpl, calls } = fakeFetch([]);
      const result = await readHandwrittenQuoteExcel(xlsx(name), fetchImpl);
      assert.equal(calls.length, 0, `${name} 를 보냈다`);
      assert.deepEqual(result, { ok: false, reason: QUOTE_EXCEL_LEGACY_XLS_TEXT, status: null, code: "XLS_LEGACY" });
    }
  });

  test(".xlsx 는 .xls 로 보지 않는다", async () => {
    const { fetchImpl, calls } = fakeFetch([{ status: 200, json: { fields: ALL_NULL, warnings: [] } }]);
    await readHandwrittenQuoteExcel(xlsx("견적.XLSX"), fetchImpl);
    assert.equal(calls.length, 1);
  });
});

describe("실패 — 사유 한 줄, 던지지 않는다", () => {
  test("422 알아볼 시트 없음 — 서버 문장 · 상태 · 코드를 돌려준다", async () => {
    const { fetchImpl } = fakeFetch([
      { status: 422, json: { error: "견적서 시트(내자견적서 · OH견적서 · 견적서)를 찾지 못했습니다.", code: "NO_QUOTE_SHEET" } },
    ]);
    assert.deepEqual(await readHandwrittenQuoteExcel(xlsx(), fetchImpl), {
      ok: false,
      reason: "견적서 시트(내자견적서 · OH견적서 · 견적서)를 찾지 못했습니다.",
      status: 422,
      code: "NO_QUOTE_SHEET",
    });
  });

  test("🔴 네트워크가 끊겨도 던지지 않는다", async () => {
    const { fetchImpl } = fakeFetch(["THROW"]);
    const result = await readHandwrittenQuoteExcel(xlsx(), fetchImpl);
    assert.equal(result.ok, false);
    assert.equal(result.ok ? "x" : result.status, null);
    assert.match(result.ok ? "" : result.reason, /네트워크/);
  });

  test("JSON 이 아닌 실패(게이트웨이 HTML) — HTTP 상태를 담은 기본 문장", async () => {
    const { fetchImpl } = fakeFetch([{ status: 502, notJson: true }]);
    const result = await readHandwrittenQuoteExcel(xlsx(), fetchImpl);
    assert.deepEqual(result, { ok: false, reason: "서버가 요청을 처리하지 못했습니다(HTTP 502)", status: 502, code: null });
  });

  test("🔴 200 인데 JSON 이 아니다 — 읽지 못한 것으로, 칸은 채우지 않는다", async () => {
    for (const reply of [{ status: 200, notJson: true } as const, "THROW_IN_JSON" as const]) {
      const { fetchImpl } = fakeFetch([reply]);
      const result = await readHandwrittenQuoteExcel(xlsx(), fetchImpl);
      assert.equal(result.ok, false, JSON.stringify(reply));
      assert.match(result.ok ? "" : result.reason, /알아보지 못했습니다/);
    }
  });

  test("🔴 fields 가 객체가 아니면 읽지 못한 것이다", async () => {
    for (const fields of [null, undefined, "DSS", 42, [READ_FIELDS]]) {
      const { fetchImpl } = fakeFetch([{ status: 200, json: { fields, warnings: [] } }]);
      const result = await readHandwrittenQuoteExcel(xlsx(), fetchImpl);
      assert.equal(result.ok, false, JSON.stringify(fields));
    }
  });
});

describe("🔴 이상한 칸 모양은 그 칸만 버린다", () => {
  test("글자가 아닌 칸 · 모르는 종류 · 달력에 없는 날 · 콤마 · 음수 · 셋째 소수 자리", () => {
    const fields = parseQuoteExcelFields({
      kind: "MATCHER",
      quoteNumber: 2026077,
      quoteDate: "2026-02-30",
      customerNameText: { name: "가나" },
      subject: "  앞뒤 공백  ",
      modelNameText: "   ",
      lotNumberText: null,
      serialNumberText: ["S-1"],
      validity: true,
      delivery: "3주",
      payment: undefined,
      manualSupplyAmount: "3,500,000",
    });
    assert.deepEqual(fields, {
      ...ALL_NULL,
      subject: "앞뒤 공백",
      delivery: "3주",
    });
    for (const amount of ["-1", "abc", "1.234", "12345678901234", "₩3500000", "3500000원"]) {
      assert.equal(parseQuoteExcelFields({ manualSupplyAmount: amount })?.manualSupplyAmount, null, amount);
    }
    for (const amount of ["0", "3500000", "1234.5", "1234.05"]) {
      assert.equal(parseQuoteExcelFields({ manualSupplyAmount: amount })?.manualSupplyAmount, amount, amount);
    }
    for (const date of ["2026/09/16", "2026-9-16", "20260916", "2026-13-01"]) {
      assert.equal(parseQuoteExcelFields({ quoteDate: date })?.quoteDate, null, date);
    }
    assert.equal(parseQuoteExcelFields({ quoteDate: "2028-02-29" })?.quoteDate, "2028-02-29");
    assert.equal(parseQuoteExcelFields({ kind: "DOMESTIC" })?.kind, "DOMESTIC");
    assert.equal(parseQuoteExcelFields({ kind: "domestic" })?.kind, null);
  });

  test("모르는 칸은 싣지 않는다 — 신고증상도", () => {
    const fields = parseQuoteExcelFields({ ...READ_FIELDS, faultDescriptionText: "고장", extra: "x" });
    assert.deepEqual(fields, READ_FIELDS);
  });

  test("warnings 가 배열이 아니면 빈 배열, 글자가 아닌 줄은 버린다", async () => {
    const { fetchImpl } = fakeFetch([
      { status: 200, json: { fields: ALL_NULL, warnings: ["남는 줄", 3, null, "  ", { t: 1 }] } },
      { status: 200, json: { fields: ALL_NULL, warnings: "한 줄" } },
    ]);
    const first = await readHandwrittenQuoteExcel(xlsx(), fetchImpl);
    assert.deepEqual(first.ok && first.warnings, ["남는 줄"]);
    const second = await readHandwrittenQuoteExcel(xlsx(), fetchImpl);
    assert.deepEqual(second.ok && second.warnings, []);
  });
});

describe("🔴 두 번 고르면 마지막에 고른 파일의 결과만", () => {
  /** 부르는 쪽이 끝낼 때를 정하는 가짜 읽기 — 앞 요청의 응답을 뒤보다 늦게 오게 할 수 있다. */
  function deferredReads() {
    const pending = new Map<string, (result: QuoteExcelParseResult) => void>();
    const started: string[] = [];
    const readImpl = (file: File) =>
      new Promise<QuoteExcelParseResult>((resolve) => {
        started.push(file.name);
        pending.set(file.name, resolve);
      });
    const finish = (name: string, quoteNumber: string) =>
      pending.get(name)?.({
        ok: true,
        fields: { ...ALL_NULL, quoteNumber },
        warnings: [],
        sheet: null,
        sheetIndex: null,
        sheets: [],
      });
    return { readImpl, finish, started };
  }

  test("앞 요청이 늦게 와도 뒤를 덮지 않는다 — 앞은 null(버린다)", async () => {
    const { readImpl, finish, started } = deferredReads();
    const reader = createLatestQuoteExcelReader(readImpl);
    const first = reader.read(xlsx("첫째.xlsx"));
    const second = reader.read(xlsx("둘째.xlsx"));
    assert.deepEqual(started, ["첫째.xlsx", "둘째.xlsx"]);
    finish("둘째.xlsx", "둘째");
    finish("첫째.xlsx", "첫째");
    const [late, latest] = await Promise.all([first, second]);
    assert.equal(late, null, "늦게 온 앞 요청의 결과를 버리지 않았다");
    assert.equal(latest?.ok && latest.fields.quoteNumber, "둘째");
  });

  test("앞 요청이 먼저 와도 이미 새로 골랐으면 버린다", async () => {
    const { readImpl, finish } = deferredReads();
    const reader = createLatestQuoteExcelReader(readImpl);
    const first = reader.read(xlsx("첫째.xlsx"));
    const second = reader.read(xlsx("둘째.xlsx"));
    finish("첫째.xlsx", "첫째");
    assert.equal(await first, null);
    finish("둘째.xlsx", "둘째");
    assert.equal((await second)?.ok, true);
  });

  test("한 번만 골랐으면 그 결과를 그대로 돌려준다", async () => {
    const { readImpl, finish } = deferredReads();
    const reader = createLatestQuoteExcelReader(readImpl);
    const only = reader.read(xlsx("하나.xlsx"));
    finish("하나.xlsx", "하나");
    const result = await only;
    assert.equal(result?.ok && result.fields.quoteNumber, "하나");
  });

  test("cancel(엑셀 전용을 껐다) 뒤에 온 결과도 버린다", async () => {
    const { readImpl, finish } = deferredReads();
    const reader = createLatestQuoteExcelReader(readImpl);
    const pending = reader.read(xlsx("하나.xlsx"));
    reader.cancel();
    finish("하나.xlsx", "하나");
    assert.equal(await pending, null);
  });

  test("기본 읽기는 통로 클라이언트다 — 실패도 결과로 돌려준다(던지지 않는다)", async () => {
    const reader = createLatestQuoteExcelReader((file) => readHandwrittenQuoteExcel(file, fakeFetch(["THROW"]).fetchImpl));
    const result = await reader.read(xlsx());
    assert.equal(result?.ok, false);
  });
});
