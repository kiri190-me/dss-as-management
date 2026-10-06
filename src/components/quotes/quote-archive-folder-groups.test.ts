import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { quoteArchiveBaseNumber } from "@/lib/domain/quote-archive-naming";
import { groupQuotesByArchiveBaseNumber } from "./quote-archive-folder-groups";

/**
 * ============================================================================
 * 한 수리 건의 견적서를 **공유폴더 하나씩**으로 묶는다 (2026-10-06)
 * ============================================================================
 * 수리 건 상세 「견적서」 탭이 공유폴더 구역을 **장 수가 아니라 폴더 수**만큼 그리게 하는
 * 순수 함수다. 폴더를 가르는 규칙(본 번호) 자체는 domain/quote-archive-naming.test.ts 가
 * 본다 — 여기서는 **묶는 일**만 본다.
 *
 * 🔴 공급처 · 모델 · L/N · S/N 은 쓰지 않는다(저장소가 공개다). 번호와 날짜뿐이다.
 * ============================================================================
 */

const source = readFileSync(new URL("./quote-archive-folder-groups.ts", import.meta.url), "utf8").replace(
  /\r\n/g,
  "\n"
);

const row = (id: string, quoteNumber: string, quoteDate: string) => ({ id, quoteNumber, quoteDate });

describe("본 번호로 묶는다 — 폴더 수만큼", () => {
  test("🔴 본 번호가 같은 여러 장이 **한 묶음**이다 — 가지 번호는 폴더를 가르지 않는다", () => {
    // 목록은 발행일자 내림차순이다(최근이 위).
    const groups = groupQuotesByArchiveBaseNumber([
      row("q-3", "DSS 2026-078-3", "2026-09-20"),
      row("q-2", "DSS 2026-078-1", "2026-09-10"),
      row("q-1", "DSS 2026-078", "2026-09-01"),
    ]);

    assert.equal(groups.length, 1, JSON.stringify(groups));
    assert.equal(groups[0].baseNumber, "DSS 2026-078");
    // 🔴 대표는 **발행일자가 가장 이른 장**이다 — 폴더는 보통 원본을 처음 받을 때 선다.
    assert.equal(groups[0].quoteId, "q-1");
  });

  test("🔴 본 번호가 다르면 묶음이 여럿이고, 차례는 **목록에 처음 나온 차례** 그대로다", () => {
    const groups = groupQuotesByArchiveBaseNumber([
      row("q-9", "DSS 2026-120", "2026-10-02"),
      row("q-3", "DSS 2026-078-3", "2026-09-20"),
      row("q-1", "DSS 2026-078", "2026-09-01"),
      row("q-5", "DSS 2025-004", "2025-03-11"),
    ]);

    assert.deepEqual(groups, [
      { baseNumber: "DSS 2026-120", quoteId: "q-9" },
      { baseNumber: "DSS 2026-078", quoteId: "q-1" },
      { baseNumber: "DSS 2025-004", quoteId: "q-5" },
    ]);
  });

  test("🔴 견적서가 한 장도 없으면 빈 배열이다 — 부르는 쪽은 구역을 안 그린다", () => {
    assert.deepEqual(groupQuotesByArchiveBaseNumber([]), []);
  });

  test("🔴 번호가 비었거나 id 가 없는 줄은 묶음에서 빠진다 — 어느 폴더와도 맞지 않는다", () => {
    const groups = groupQuotesByArchiveBaseNumber([
      row("q-0", "   ", "2026-09-20"),
      row("", "DSS 2026-078", "2026-09-10"),
      row("q-1", "DSS 2026-078", "2026-09-01"),
    ]);

    assert.deepEqual(groups, [{ baseNumber: "DSS 2026-078", quoteId: "q-1" }]);
  });

  test("발행일자가 같으면 목록의 앞쪽이 대표다 — 묶음이 흔들리지 않는다", () => {
    const groups = groupQuotesByArchiveBaseNumber([
      row("q-2", "DSS 2026-078-1", "2026-09-01"),
      row("q-1", "DSS 2026-078", "2026-09-01"),
    ]);

    assert.deepEqual(groups, [{ baseNumber: "DSS 2026-078", quoteId: "q-2" }]);
  });

  test("발행일자가 비어 있어도 묶인다 — 날짜가 있는 쪽이 대표가 된다", () => {
    const groups = groupQuotesByArchiveBaseNumber([
      row("q-2", "DSS 2026-078-1", ""),
      row("q-1", "DSS 2026-078", "2026-09-01"),
    ]);

    assert.deepEqual(groups, [{ baseNumber: "DSS 2026-078", quoteId: "q-1" }]);
  });

  test("🔴 가지 번호가 아닌 꼬리는 떼지 않는다 — 그 번호들은 각자 폴더다", () => {
    // 규칙 자체는 domain 시험이 본다. 여기서는 그 결과가 **묶음을 가른다**는 것만 본다.
    assert.equal(quoteArchiveBaseNumber("Q-2026-0001"), "Q-2026-0001");
    const groups = groupQuotesByArchiveBaseNumber([
      row("q-2", "Q-2026-0002", "2026-09-02"),
      row("q-1", "Q-2026-0001", "2026-09-01"),
    ]);
    assert.equal(groups.length, 2, JSON.stringify(groups));
  });

  test("🔴 본 번호를 **새로 짓지 않는다** — 폴더를 찾는 쪽과 같은 함수 하나다", () => {
    assert.ok(source.includes('import { quoteArchiveBaseNumber } from "@/lib/domain/quote-archive-naming";'));
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    // 번호를 제 손으로 쪼개거나 자르지 않는다.
    for (const forbidden of [/\bsplit\(/, /\bslice\(/, /RegExp\(/, /\/\^/, /lastIndexOf\(/]) {
      assert.equal(forbidden.test(code), false, `번호 규칙을 다시 짰다: ${forbidden}`);
    }
    // 🔴 파일시스템 · 통로를 보지 않는다 — 순수하다.
    for (const forbidden of ["node:fs", "fetch(", "server-only", "process.env", "@/lib/storage/"]) {
      assert.equal(code.includes(forbidden), false, `순수하지 않다: ${forbidden}`);
    }
  });
});
