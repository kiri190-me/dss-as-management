import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

/**
 * ============================================================================
 * 수리 건의 견적서 번호 — **두 화면이 같은 함수를 쓴다**(원본 글자로 지킨다)
 * ============================================================================
 * 2026-10-07 오후에 이 모듈이 생겼다. 그전에는 같은 규칙이 queries/customer-portal.ts
 * 안의 private 함수였는데, 같은 날 **주간보고 상세표**도 줄마다 견적서 번호를 보여 주게
 * 되면서(견적서 발행일 옆 역삼각) 두 화면이 같은 규칙을 써야 했다.
 *
 * 🔴 **규칙을 베껴 적으면 언젠가 한쪽만 고쳐진다.** 그리고 두 화면이 서로 다른 견적서
 * 번호를 보이는 날, 사람은 어느 쪽도 믿지 않게 된다. 그래서 동작이 아니라 **원본 글자**로
 * 지킨다 — 이웃 storage/quote-archive-case-numbers-source.test.ts 와 같은 규율이다.
 *
 * 여기서 못 박는 것 넷:
 *  · 🔴 **훑기 캐시가 이 한 자리뿐**이다. 화면마다 제 cache() 를 두면 한 요청에서 연도
 *    폴더를 두 번 훑는다(실측 851ms × 2).
 *  · 🔴 **DB 를 모른다.** 내자 정리의 번호를 읽는 일(완료된 줄 제외까지)은
 *    queries/domestic-orders.ts 하나가 쥔다 — 여기서 표를 읽으면 조건이 두 벌이 된다.
 *  · 🔴 **파일시스템을 직접 만지지 않는다.** 읽기는 storage 모듈 하나를 거친다.
 *  · 🔴 **던지지 않는다.** 공유폴더가 꺼져 있거나 못 읽으면 내자 정리 값만 보인다.
 *
 * 두 화면이 실제로 이 함수들을 **부르고 있는지**는 각 화면 쪽 시험이 본다
 * (components/customer-portal/customer-portal-form-view.test.ts 의 「11.」 ·
 * components/dashboard/weekly-report-quote-numbers.test.ts).
 * ============================================================================
 */

const source = readFileSync(
  new URL("./repair-case-quote-numbers.ts", import.meta.url),
  "utf8"
).replace(/\r\n/g, "\n");

/** 주석을 뺀 코드 — 머리말이 까닭을 설명하느라 적은 낱말에 걸리지 않게. */
const code = source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, "");
/** 줄바꿈·들여쓰기 차이로 깨지지 않게 공백을 하나로 접는다. */
const flat = code.replace(/\s+/g, " ");

function importedFrom(text: string): string[] {
  return [...text.matchAll(/\bfrom "([^"]+)";/g)].map((match) => match[1]).sort();
}

describe("수리 건 견적서 번호 — 원본으로 지킨다", () => {
  test("🔴 서버에서만 도는 모듈이다", () => {
    assert.ok(source.startsWith('import "server-only";'), "server-only 가 맨 앞에 없다");
  });

  test("🔴 가져오는 곳은 둘뿐이다 — 요청 수명 캐시와 공유폴더 읽기", () => {
    assert.deepEqual(importedFrom(source), ["../../storage/quote-archive-case-numbers", "react"].sort());
  });

  test("🔴 DB 를 모른다 — 내자 정리를 읽는 일은 domestic-orders 조회가 쥔다", () => {
    for (const forbidden of ["drizzle", "db/client", "../client", "domesticOrders", "db.select"]) {
      assert.equal(code.includes(forbidden), false, `조회가 내려왔다: ${forbidden}`);
    }
    // 번호도 발행일도 **받아서** 쓴다 — 그 값의 모양만 인자로 선언한다.
    assert.ok(flat.includes("quoteInfo: Map<string, QuoteNumberInfo>"));
    assert.ok(
      flat.includes("export type QuoteNumberInfo = { quoteNumber: string | null; quoteIssuedDate: string | null; };"),
      "내자 정리에서 받는 값의 모양이 바뀌었다"
    );
  });

  test("🔴 파일시스템을 직접 만지지 않는다 — 읽기는 storage 모듈 하나를 거친다", () => {
    for (const forbidden of ["node:fs", "fs/promises", "node:path", "readdir", "require(", "console."]) {
      assert.equal(code.includes(forbidden), false, `흔적: ${forbidden}`);
    }
  });

  test("🔴 훑기 캐시는 이 한 자리뿐이다 — 요청 하나에 훑기 한 번", () => {
    assert.ok(code.includes('import { cache } from "react";'));
    assert.equal(code.match(/cache\(/g)?.length, 1, "캐시가 둘이거나 없다");
    assert.ok(flat.includes("const loadQuoteArchiveFolders = cache(async ()"));
    // 🔴 캐시 바깥으로 내보내지 않는다 — 부르는 쪽이 제 손으로 훑으면 뜻이 사라진다.
    assert.ok(!code.includes("export const loadQuoteArchiveFolders"));
  });

  test("🔴 내자 정리에 번호가 있으면 **그것만**이다 — 공유폴더를 보지도 않는다", () => {
    assert.ok(
      flat.includes("const ordered = filledText(info?.quoteNumber); if (ordered !== null) return [ordered];"),
      "내자 정리 값이 있어도 공유폴더 번호가 섞인다"
    );
    assert.ok(
      flat.includes(".filter((row) => readsArchive(quoteInfo.get(row.id)))"),
      "공유폴더를 볼 건을 고르는 자리가 바뀌었다 — NAS 왕복이 그만큼 는다"
    );
    // 공백만 적힌 칸은 없는 것으로 본다 — 번호도 발행일도 같은 잣대다.
    assert.ok(flat.includes('return text === "" ? null : text;'));
  });

  /**
   * 🔴 2026-10-12 사용자 요구 — 「견적발행일이 **적혀 있을 때만**」 공유폴더를 본다.
   *
   * 🔴 **판정은 한 함수(readsArchive)이고, 그것을 두 자리에서 부른다** — 훑는 목록을 고를 때와
   * 줄마다 번호를 꺼낼 때다. 둘째가 필요한 까닭은 결과 표의 열쇠가 **건이 아니라 장비**라서,
   * 같은 L/N·S/N 을 쓰는 옆 건이 읽어 온 번호를 발행일 없는 건이 그 열쇠로 꺼내 갈 수 있기
   * 때문이다(실측 2026-10-12). 🔴 **조건을 베껴 적으면** 언젠가 한쪽만 고쳐지고, 그때 증상은
   * 「목록에는 번호가 뜨는데 훑지는 않는다」(또는 그 반대)라 아무도 못 찾는다.
   */
  test("🔴 번호가 없고 **발행일이 적혀 있을 때만** 공유폴더를 본다 (2026-10-12)", () => {
    assert.ok(
      flat.includes(
        "function readsArchive(info: QuoteNumberInfo | undefined): boolean { return filledText(info?.quoteNumber) === null && filledText(info?.quoteIssuedDate) !== null; }"
      ),
      "발행일 조건이 사라졌거나 번호 조건과 짝이 어긋났다"
    );
    // 🔴 발행일을 **글자로** 보는 자리는 그 함수와 그 값의 모양 선언뿐이다 — 조건을 베껴 적으면
    //    이 셈이 늘어 여기서 드러난다.
    assert.equal(flat.match(/quoteIssuedDate/g)?.length, 2, "발행일 조건을 베껴 적은 자리가 생겼다");
    // 🔴 판정을 **부르는** 자리는 둘이다 — 훑는 목록 고르기 · 줄마다 번호 꺼내기.
    assert.equal(flat.match(/readsArchive\(/g)?.length, 3, "판정을 부르는 자리가 늘거나 줄었다");
  });

  /**
   * 🔴 줄마다 번호를 꺼낼 때도 **같은 판정**을 지난다 (2026-10-12).
   *
   * `archiveNumbers` 의 열쇠는 건이 아니라 **장비**(L/N + S/N)다. 훑는 목록에서 뺀 건이라도
   * 같은 장비의 옆 건이 읽어 둔 번호가 그 열쇠에 들어 있으면 꺼내 가게 된다 — 그 샘을
   * 여기서 막는다.
   *
   * 🔴 **부르는 차례가 규칙이다.** 적어 둔 번호가 **먼저**다. readsArchive 를 앞에 두면 번호가
   * 적힌 건이 거기서 걸러져(그 함수는 번호가 있으면 false) 2026-10-07 규칙이 깨진다.
   */
  test("🔴 줄마다도 같은 함수로 묻는다 — 적어 둔 번호가 **먼저**다 (2026-10-12)", () => {
    assert.ok(
      flat.includes(
        "const ordered = filledText(info?.quoteNumber); if (ordered !== null) return [ordered]; if (!readsArchive(info)) return [];"
      ),
      "줄마다의 판정이 사라졌거나, 적어 둔 번호보다 앞에 섰다"
    );
    // 🔴 번호와 발행일을 **값 하나**로 받는다 — 인자 둘로 가르면 다른 줄의 값이 짝지어질 수 있다.
    assert.ok(
      flat.includes("repairCaseQuoteNumbers( info: QuoteNumberInfo | undefined, archiveNumbers"),
      "번호와 발행일이 갈려 들어온다"
    );
  });

  test("🔴 열쇠를 손으로 잇지 않는다 — 저장소 모듈의 함수로 만든다", () => {
    assert.ok(code.includes("quoteArchiveProductKey(lotNumber, serialNumber)"));
    assert.equal(code.includes("${lotKey}|${serialKey}"), false, "열쇠 모양을 베꼈다");
  });

  test("🔴 던지지 않는다 — 꺼져 있거나 실패하면 빈 목록이다", () => {
    assert.ok(code.includes('return scanned.status === "found" ? scanned.folders : [];'));
    assert.ok(code.includes('return read.status === "found" ? read.numbersByProduct : new Map();'));
    assert.equal(/\bthrow\b/.test(code), false, "던지는 자리가 생겼다");
  });

  test("🔴 내보내는 함수는 셋뿐이다 — 규칙이 늘면 여기서 드러난다", () => {
    const exported = [...source.matchAll(/^export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm)]
      .map((match) => match[1])
      .sort();
    assert.deepEqual(exported, ["joinQuoteNumbers", "listArchiveQuoteNumbers", "repairCaseQuoteNumbers"]);
  });
});
