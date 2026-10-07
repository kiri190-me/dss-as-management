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
    // 번호는 **받아서** 쓴다 — 그 값의 모양만 인자로 선언한다.
    assert.ok(flat.includes("quoteInfo: Map<string, { quoteNumber: string | null }>"));
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
      flat.includes("const ordered = orderedQuoteNumber(quoteNumber); if (ordered !== null) return [ordered];"),
      "내자 정리 값이 있어도 공유폴더 번호가 섞인다"
    );
    assert.ok(
      flat.includes(
        ".filter((row) => orderedQuoteNumber(quoteInfo.get(row.id)?.quoteNumber ?? null) === null)"
      ),
      "번호가 이미 있는 건까지 공유폴더를 본다 — NAS 왕복이 그만큼 는다"
    );
    // 공백만 적힌 칸은 없는 것으로 본다.
    assert.ok(flat.includes('return text === "" ? null : text;'));
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
