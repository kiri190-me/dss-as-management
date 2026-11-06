import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

import {
  DOMESTIC_ORDER_QUOTE_ARCHIVE_NO_NUMBER_TEXT,
  domesticOrderQuoteArchiveNoDateText,
  domesticOrderQuoteArchiveOnlyText,
  resolveDomesticOrderQuoteArchiveLookup,
  type DomesticOrderQuoteArchiveLookup,
} from "./domestic-order-quote-archive";
import { quoteArchiveYearFromDate } from "./quote-archive-naming";

/**
 * ============================================================================
 * 기타건의 견적서 공유폴더를 **무엇으로 찾는가** (2026-11-06)
 * ============================================================================
 * 시스템 견적서가 없는 내자 줄에서, 공유폴더를 찾을 재료 둘(번호 · 연도 폴더를 정할
 * 날짜)을 꺼내는 순수 함수. 실제로 폴더를 찾는 일은 storage/quote-archive.ts 가 하고
 * (lib/storage/quote-archive.test.ts 가 임시 폴더에서 본다), 통로 쪽 규율은
 * app/api/domestic-orders/[id]/quote-archive-folder/entries/route-source.test.ts 가 본다.
 *
 * 여기서 못 박는 것은 넷이다:
 *  · 🔴 **견적발행일이 먼저**이고, 비었을 때만 번호의 연도로 때운다
 *  · 🔴 때운 날짜도 **기존 규칙(quoteArchiveYearFromDate)에 통과한 값**이다 — 연도 범위
 *    판정을 이 파일이 다시 적지 않았다
 *  · 🔴 못 찾을 줄은 **번호가 없다**와 **연도를 못 정한다**로 갈린다(둘의 안내가 다르다)
 *  · 🔴 **폴더를 찾는 규칙(폴더 이름 견주기)을 이 조각이 베끼지 않았다** — 마지막
 *    describe 가 저장소 전체를 훑어 그 함수를 부르는 파일 목록을 못 박는다
 *
 * 🔴 고객사 · 번호는 **가짜**다(이 저장소는 공개다). 모양만 실측과 같게 맞췄다.
 * ============================================================================
 */

const row = (
  displayQuoteNumber: string | null,
  displayQuoteIssuedDate: string | null
): { displayQuoteNumber: string | null; displayQuoteIssuedDate: string | null } => ({
  displayQuoteNumber,
  displayQuoteIssuedDate,
});

/** `ready` 인 결과만 꺼낸다 — 아니면 그 자리에서 실패시킨다(표본이 비어 공짜로 통과하지 않게). */
function ready(lookup: DomesticOrderQuoteArchiveLookup): { quoteNumber: string; quoteDate: string } {
  assert.equal(lookup.status, "ready", `찾아볼 수 없다고 답했다: ${JSON.stringify(lookup)}`);
  const found = lookup as Extract<DomesticOrderQuoteArchiveLookup, { status: "ready" }>;
  return { quoteNumber: found.quoteNumber, quoteDate: found.quoteDate };
}

describe("① 견적발행일이 있으면 그것이 연도 폴더를 정한다", () => {
  test("적힌 날짜를 그대로 쓴다 — 번호는 앞뒤 공백만 턴다", () => {
    const found = ready(resolveDomesticOrderQuoteArchiveLookup(row("  DSS 2026-089  ", "2026-09-30")));
    assert.deepEqual(found, { quoteNumber: "DSS 2026-089", quoteDate: "2026-09-30" });
  });

  test("🔴 해를 넘겨 발행한 건 — **발행일이 번호의 연도를 이긴다**", () => {
    // 번호는 작년 것인데 올해 발행했다. 저장 쪽도 연도 폴더를 **발행일자**로 고르므로
    // (storage/quote-archive.ts 의 save), 폴더는 발행일 쪽 연도에 서 있다.
    const found = ready(resolveDomesticOrderQuoteArchiveLookup(row("DSS 2025-144", "2026-01-05")));
    assert.equal(found.quoteDate, "2026-01-05");
  });

  test("날짜 모양이 아니면 적혀 있어도 쓰지 않는다 — 번호의 연도로 내려간다", () => {
    for (const bad of ["미정", "2026-13-01", "2026-02-30", "2026/09/30", "26-09-30", "   "]) {
      const found = ready(resolveDomesticOrderQuoteArchiveLookup(row("DSS 2026-089", bad)));
      assert.equal(found.quoteDate, "2026-01-01", `'${bad}' 를 날짜로 받아들였다`);
    }
  });
});

describe("② 견적발행일이 비면 번호에 박힌 연도로 때운다", () => {
  test("실측 변종들이 전부 그 해 연도 폴더를 가리킨다", () => {
    const cases: ReadonlyArray<readonly [string, string]> = [
      ["DSS 2026-089", "2026-01-01"],
      // 사람이 공백을 빠뜨린 번호 — 개발 DB 에 실제로 있는 모양이다.
      ["DSS2026-089", "2026-01-01"],
      // 가지 번호가 붙어도 연도는 같다(본 번호를 떼는 일은 폴더 찾기 쪽의 몫이다).
      ["DSS 2026-089-1", "2026-01-01"],
      ["QT-2024-115", "2024-01-01"],
      ["Q-2026-0001", "2026-01-01"],
      ["DEMO-QT-2026-001", "2026-01-01"],
    ];
    for (const [quoteNumber, expected] of cases) {
      const found = ready(resolveDomesticOrderQuoteArchiveLookup(row(quoteNumber, null)));
      assert.deepEqual(found, { quoteNumber, quoteDate: expected }, quoteNumber);
    }
  });

  test("🔴 때운 날짜도 **기존 규칙이 받는 값**이다 — 연도 판정을 베껴 적지 않았다", () => {
    for (const quoteNumber of ["DSS 2026-089", "QT-2024-115", "Q-2026-0001"]) {
      const found = ready(resolveDomesticOrderQuoteArchiveLookup(row(quoteNumber, null)));
      assert.notEqual(
        quoteArchiveYearFromDate(found.quoteDate),
        null,
        `공유폴더 쪽 규칙이 안 받는 날짜를 만들었다: ${found.quoteDate}`
      );
    }
  });

  test("🔴 연도 범위 밖(2006 미만)은 **못 정한 것**이다 — 범위 판정이 한 벌이라서", () => {
    const lookup = resolveDomesticOrderQuoteArchiveLookup(row("DSS 1999-001", null));
    assert.deepEqual(lookup, { status: "no-quote-date", quoteNumber: "DSS 1999-001" });
    // 못 박는 근거: 같은 해를 날짜로 줘도 공유폴더 규칙이 받지 않는다.
    assert.equal(quoteArchiveYearFromDate("1999-01-01"), null);
  });
});

describe("③ 찾아볼 수 없는 줄 — 둘을 갈라 답한다", () => {
  test("번호가 없다", () => {
    for (const empty of [null, "", "   "]) {
      assert.deepEqual(resolveDomesticOrderQuoteArchiveLookup(row(empty, "2026-09-30")), {
        status: "no-quote-number",
      });
    }
  });

  test("🔴 번호는 있는데 연도를 못 정한다 — 번호를 함께 돌려준다(안내에 적는다)", () => {
    // 개발 DB 에 실제로 있는 모양이다. 날짜도 없으면 연도 폴더를 고를 길이 없다.
    assert.deepEqual(resolveDomesticOrderQuoteArchiveLookup(row("Q-7", null)), {
      status: "no-quote-date",
      quoteNumber: "Q-7",
    });
    // 🔴 같은 번호라도 날짜가 적혀 있으면 찾아본다 — 「못 정한다」는 번호 탓만이 아니다.
    assert.equal(ready(resolveDomesticOrderQuoteArchiveLookup(row("Q-7", "2026-03-02"))).quoteDate, "2026-03-02");
  });

  test("던지지 않는다 — 칸이 통째로 없는 줄도 값으로 답한다", () => {
    const empty = {} as { displayQuoteNumber: string | null; displayQuoteIssuedDate: string | null };
    assert.deepEqual(resolveDomesticOrderQuoteArchiveLookup(empty), { status: "no-quote-number" });
  });
});

describe("④ 안내 문장 — 번호가 그대로 들어가고, 셋이 서로 다르다", () => {
  test("번호를 적어 준다", () => {
    assert.ok(domesticOrderQuoteArchiveOnlyText("DSS 2026-089").includes("DSS 2026-089"));
    assert.ok(domesticOrderQuoteArchiveNoDateText("Q-7").includes("Q-7"));
    // 🔴 「없다」가 아니라 **아직 못 찾는다**는 말이어야 한다 — 공유폴더를 보지도 않았다.
    assert.ok(domesticOrderQuoteArchiveNoDateText("Q-7").includes("견적발행일"));
    assert.ok(DOMESTIC_ORDER_QUOTE_ARCHIVE_NO_NUMBER_TEXT.includes("견적서번호"));
  });

  test("셋이 같은 글자가 아니다 — 상황을 가려 말한다", () => {
    const texts = [
      domesticOrderQuoteArchiveOnlyText("DSS 2026-089"),
      domesticOrderQuoteArchiveNoDateText("DSS 2026-089"),
      DOMESTIC_ORDER_QUOTE_ARCHIVE_NO_NUMBER_TEXT,
    ];
    assert.equal(new Set(texts).size, 3, texts.join(" / "));
    for (const text of texts) assert.ok(text.length > 20, text);
  });
});

/**
 * ────────────────────────────────────────────────────────────────────────────
 * 🔴 폴더를 찾는 규칙은 **한 벌이다** — 이 조각이 베끼지 않았다
 * ────────────────────────────────────────────────────────────────────────────
 * 폴더 이름을 견주는 두 함수(matchesQuoteArchiveFolder · isQuoteArchiveYearFolder)를
 * 화면 · 통로 쪽이 제 손으로 부르기 시작하면, 「저장이 쓰는 폴더」와 「화면이 찾는 폴더」가
 * 갈라지는 날이 온다. 부르는 자리는 **저장소 모듈뿐**이어야 한다.
 *
 * 🔴 **주석을 걷어낸 뒤에 센다** — 이 저장소의 파일들은 까닭을 길게 적고 그 글에 함수
 * 이름이 그대로 들어 있다(이번에 더한 통로 · 순수 함수 둘 다 그렇다). 걷어내지 않으면
 * 「베끼지 않았다」가 주석 때문에 빨개진다.
 */
const srcDir = fileURLToPath(new URL("../../", import.meta.url));

function walkSources(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkSources(full, found);
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) found.push(full);
  }
  return found;
}

const withoutComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^[ \t]*\/\/.*$/gm, " ");

const relativeToSrc = (file: string) => path.relative(srcDir, file).split(path.sep).join("/");

describe("🔴 폴더 찾는 규칙을 부르는 자리", () => {
  const sources = walkSources(srcDir);

  test("🔵 못 — 걷기가 조용히 망가지지 않았다 · 주석 걷어내기가 실제로 문다", () => {
    assert.ok(sources.length > 300, `원본을 ${sources.length}개밖에 못 찾았다`);
    assert.equal(withoutComments("/* matchesQuoteArchiveFolder */ const a = 1;").includes("matchesQuote"), false);
    assert.equal(withoutComments("  // isQuoteArchiveYearFolder\nconst a = 1;").includes("isQuoteArchive"), false);
    assert.ok(withoutComments("matchesQuoteArchiveFolder(name, n);").includes("matchesQuoteArchiveFolder"));
  });

  test("🔴 두 함수를 **코드에서** 부르는 파일은 이름 규칙과 저장소 모듈뿐이다", () => {
    const callers = sources
      .filter((file) =>
        /\b(matchesQuoteArchiveFolder|isQuoteArchiveYearFolder)\b/.test(withoutComments(readFileSync(file, "utf8")))
      )
      .map(relativeToSrc)
      .sort();
    assert.deepEqual(callers, [
      // 규칙을 **정의**하는 파일.
      "lib/domain/quote-archive-naming.ts",
      // 가져다 쓰는 자리 — 전부 저장소(공유폴더를 실제로 읽는) 모듈이다.
      // 🔵 purchase-order-archive.ts 는 **주석에만** 그 이름이 있어 여기 없다(발주서 폴더는
      //    이름 규칙이 달라 제 판정을 쓴다) — 주석 걷어내기가 실제로 물고 있다는 증거다.
      "lib/storage/quote-archive-case-numbers.ts",
      "lib/storage/quote-archive-product-folders.ts",
      "lib/storage/quote-archive.ts",
      "lib/storage/quote-number-suggestion.ts",
    ]);
  });

  test("🔴 이번에 더한 셋은 그 목록에 없다 — 재료만 꺼내고 찾기는 맡긴다", () => {
    for (const file of [
      "lib/domain/domestic-order-quote-archive.ts",
      "app/api/domestic-orders/[id]/quote-archive-folder/entries/route.ts",
      "components/domestic-orders/detail/DomesticOrderQuoteArchiveFolderSection.tsx",
    ]) {
      const source = withoutComments(readFileSync(path.join(srcDir, ...file.split("/")), "utf8"));
      assert.equal(
        /\b(matchesQuoteArchiveFolder|isQuoteArchiveYearFolder|quoteArchiveBaseNumber)\b/.test(source),
        false,
        `${file} 가 폴더 찾는 규칙을 제 손으로 쓴다`
      );
    }
  });
});
