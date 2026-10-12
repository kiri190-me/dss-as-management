import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { pickQuoteArchiveExcelEntry } from "./quote-archive-excel-open";
import { filterQuoteArchiveEntriesByQuoteNumber } from "./quote-archive-folder-number-filter";

/**
 * ============================================================================
 * 결재 탭의 공유폴더 구역 — **보고 있는 견적서 번호의 파일만** (2026-10-12)
 * ============================================================================
 * 폴더는 **본 번호** 단위라 `DSS 2026-089` 와 `DSS 2026-089-1` 이 한 폴더를 쓴다. 그래서
 * 거르지 않으면 가지 번호 견적서를 열어도 본 번호의 파일까지 보인다 — 사용자가 고쳐
 * 달라고 한 것이 이것이다.
 *
 * 🔴 **견주는 규칙은 [Excel 보기]와 한 벌이다**(domain/quote-archive-file-number.ts 의
 * quoteArchiveNumberKey · quoteNumberFromArchiveFileName). 그 규칙 자체(무엇을 접고 무엇을
 * 안 받는가)는 그쪽 시험이 본다 — 여기서는 **거르기가 그 규칙을 쓰는가**와 숨긴 개수다.
 * 아래 마지막 describe 가 두 화면의 판단이 어긋나지 않는 것을 직접 견준다.
 *
 * 🔴 공급처 · 모델 · L/N · S/N 은 **가짜**다(저장소가 공개다). 이름의 **모양**은 2026-10-06
 * 실측(2026 연도 폴더 파일 342 개)에 있던 것 그대로다 — 하이픈 · 소문자 · 개정본 · 번호 뒤
 * 오타까지.
 * 🔴 파일시스템을 보지 않는다 — 값만 넣고 값만 받는다.
 * ============================================================================
 */

/** 줄 하나. 이 모듈은 이름만 본다 — 폴더인지 파일인지도 보지 않는다. */
const row = (name: string) => ({ name });

const names = (entries: readonly { name: string }[]) => entries.map((entry) => entry.name);

/** 실제 폴더 하나의 모양(실측 예를 본뜬 가짜 이름). 본 번호 · 결재본 · 가지 번호 · 손으로 넣은 것. */
const FOLDER = [
  row("DSS 2026-089 가나상사 MODEL-X1 L123 S456 전원 불량.xls"),
  row("DSS 2026-089 가나상사 MODEL-X1 L123 S456 전원 불량 - 有印.pdf"),
  row("DSS 2026-089-1 가나상사 MODEL-X1 L123 S456 전원 불량(OH포함).xls"),
  row("참고자료.pdf"),
];

describe("견적서 번호로 거르기 — 폴더는 본 번호 단위라 가지 번호가 섞여 있다", () => {
  test("🔴 본 번호를 보고 있으면 **가지 번호 파일이 숨는다**", () => {
    const result = filterQuoteArchiveEntriesByQuoteNumber(FOLDER, "DSS 2026-089");
    assert.deepEqual(names(result.entries), [
      "DSS 2026-089 가나상사 MODEL-X1 L123 S456 전원 불량.xls",
      "DSS 2026-089 가나상사 MODEL-X1 L123 S456 전원 불량 - 有印.pdf",
    ]);
    // 가지 번호 한 장 + 번호 없는 한 장.
    assert.equal(result.hiddenCount, 2);
  });

  test("🔴 가지 번호를 보고 있으면 **본 번호 파일이 숨는다**", () => {
    const result = filterQuoteArchiveEntriesByQuoteNumber(FOLDER, "DSS 2026-089-1");
    assert.deepEqual(names(result.entries), ["DSS 2026-089-1 가나상사 MODEL-X1 L123 S456 전원 불량(OH포함).xls"]);
    assert.equal(result.hiddenCount, 3);
  });

  test("🔴 결재본 PDF(`- 有印`)는 **보인다** — 같은 번호다", () => {
    const result = filterQuoteArchiveEntriesByQuoteNumber(
      [row("DSS 2026-089 가나상사 MODEL-X1 L123 S456 전원 불량 - 有印.pdf")],
      "DSS 2026-089"
    );
    assert.equal(result.entries.length, 1);
    assert.equal(result.hiddenCount, 0);
  });

  test("🔴 번호를 못 뽑는 파일은 숨고 **숨긴 개수에 센다** — 사람이 손으로 넣은 것이다", () => {
    const result = filterQuoteArchiveEntriesByQuoteNumber(
      [row("참고자료.pdf"), row("단가기재 참고용.XLS"), row("DSS 2026-089 가나상사.xls")],
      "DSS 2026-089"
    );
    assert.deepEqual(names(result.entries), ["DSS 2026-089 가나상사.xls"]);
    assert.equal(result.hiddenCount, 2);
  });

  test("🔴 **본 번호로 깎지 않는다** — 가지 번호를 보고 있을 때 본 번호 것이 따라오면 안 된다", () => {
    // quoteArchiveBaseNumber 를 태웠다면 `DSS 2026-089-1` 이 `DSS 2026-089` 가 되어 전부 보인다.
    const result = filterQuoteArchiveEntriesByQuoteNumber(FOLDER, "DSS 2026-089-12");
    assert.deepEqual(names(result.entries), []);
    assert.equal(result.hiddenCount, 4);
  });
});

/*
 * ============================================================================
 * 🔴 실측에 있던 이름 모양 (2026-10-06, 2026 연도 폴더 342 개)
 * ============================================================================
 * 번호는 **자유 입력 칸**이라 사람마다 다르게 적혀 들어왔다. 글자 앞머리만 보면(한때 그렇게
 * 만들었다) 아래 셋이 전부 숨어, [Excel 보기]는 찾아 여는 파일을 바로 옆 구역은 숨기는
 * 상태가 된다.
 * ============================================================================
 */
describe("🔴 실측 변종 — 하이픈 · 소문자 · 개정본", () => {
  test("`DSS-2026-099 …`(하이픈)이 `DSS 2026-099` 견적서에서 **보인다**", () => {
    const result = filterQuoteArchiveEntriesByQuoteNumber(
      [row("DSS-2026-089 가나상사 MODEL-X1 수리 견적서.xlsx")],
      "DSS 2026-089"
    );
    assert.deepEqual(names(result.entries), ["DSS-2026-089 가나상사 MODEL-X1 수리 견적서.xlsx"]);
    assert.equal(result.hiddenCount, 0);
  });

  test("`dss 2026-001 …`(소문자)이 **보인다**", () => {
    const result = filterQuoteArchiveEntriesByQuoteNumber(
      [row("dss 2026-089 가나상사 MODEL-X1 수리 견적서.xlsx")],
      "DSS 2026-089"
    );
    assert.deepEqual(names(result.entries), ["dss 2026-089 가나상사 MODEL-X1 수리 견적서.xlsx"]);
    assert.equal(result.hiddenCount, 0);
  });

  test("🔴 개정본 `DSS 2026-004R1 …` — 제 견적서에서는 보이고, `DSS 2026-004` 에서는 **숨는다**", () => {
    const folder = [
      row("DSS 2026-004 가나상사 MODEL-X1 수리 견적서.xlsx"),
      row("DSS 2026-004R1 가나상사 MODEL-X1 수리 견적서.xlsx"),
    ];
    const atRevision = filterQuoteArchiveEntriesByQuoteNumber(folder, "DSS 2026-004R1");
    assert.deepEqual(names(atRevision.entries), ["DSS 2026-004R1 가나상사 MODEL-X1 수리 견적서.xlsx"]);
    assert.equal(atRevision.hiddenCount, 1);

    const atOriginal = filterQuoteArchiveEntriesByQuoteNumber(folder, "DSS 2026-004");
    assert.deepEqual(names(atOriginal.entries), ["DSS 2026-004 가나상사 MODEL-X1 수리 견적서.xlsx"]);
    assert.equal(atOriginal.hiddenCount, 1);
  });

  test("개정본의 대소문자도 접힌다 — `dss 2026-004r1 …` 이 `DSS 2026-004R1` 에서 보인다", () => {
    const result = filterQuoteArchiveEntriesByQuoteNumber(
      [row("dss 2026-004r1 가나상사 MODEL-X1.pdf")],
      "DSS 2026-004R1"
    );
    assert.equal(result.entries.length, 1);
    assert.equal(result.hiddenCount, 0);
  });

  test("이름의 연속 공백은 견줄 때만 다듬는다 — 두 칸 띄어 적힌 파일도 보인다", () => {
    const result = filterQuoteArchiveEntriesByQuoteNumber([row("DSS 2026-089  가나상사.xls")], "DSS 2026-089");
    assert.equal(result.entries.length, 1);
    // 🔴 돌려주는 것은 **디스크의 실제 이름**이다 — 다듬은 이름으로 바꿔치지 않는다.
    assert.equal(result.entries[0]?.name, "DSS 2026-089  가나상사.xls");
  });

  test("발행번호 쪽의 앞뒤 공백 · 연속 공백 · 소문자도 같은 규칙에 태운다", () => {
    for (const number of ["  DSS  2026-089 ", "dss 2026-089", "DSS-2026-089"]) {
      const result = filterQuoteArchiveEntriesByQuoteNumber([row("DSS 2026-089 가나상사.xls")], number);
      assert.equal(result.entries.length, 1, number);
      assert.equal(result.hiddenCount, 0, number);
    }
  });
});

describe("경계 — 번호 뒤가 공백이어야 번호다", () => {
  test("🔴 `DSS 2026-0891 …` 은 `DSS 2026-089` 의 것이 아니다", () => {
    const result = filterQuoteArchiveEntriesByQuoteNumber(
      [row("DSS 2026-0891 다른상사 MODEL-Y 수리 견적서.xls")],
      "DSS 2026-089"
    );
    assert.deepEqual(names(result.entries), []);
    assert.equal(result.hiddenCount, 1);
  });

  test("🔴 `DSS 2026-046- ICD …`(번호 뒤가 공백이 아닌 오타, 실측에 있다)는 **숨는다**", () => {
    // 사람이 적지 않은 번호를 지어내지 않는다 — 뽑는 함수가 null 을 준다.
    const result = filterQuoteArchiveEntriesByQuoteNumber(
      [row("DSS 2026-046- ICD MODEL-X1 수리 견적서.xlsx"), row("DSS 2026-046 가나상사 수리 견적서.xlsx")],
      "DSS 2026-046"
    );
    assert.deepEqual(names(result.entries), ["DSS 2026-046 가나상사 수리 견적서.xlsx"]);
    assert.equal(result.hiddenCount, 1);
  });

  test("🔴 이름이 번호에서 끝나면 숨는다 — 같은 까닭이다(`DSS 2026-089.xlsx`)", () => {
    const result = filterQuoteArchiveEntriesByQuoteNumber([row("DSS 2026-089.xlsx")], "DSS 2026-089");
    assert.deepEqual(names(result.entries), []);
    assert.equal(result.hiddenCount, 1);
  });
});

describe("🔴 키를 못 뽑으면 거르지 않는다 — 파일이 통째로 사라지면 안 된다", () => {
  test("빈 글자면 **전부 보인다**", () => {
    const result = filterQuoteArchiveEntriesByQuoteNumber(FOLDER, "");
    assert.equal(result.entries.length, FOLDER.length);
    assert.equal(result.hiddenCount, 0);
    // 받은 배열을 그대로 돌려준다 — 새 배열을 만들지 않는다.
    assert.equal(result.entries, FOLDER);
  });

  test("🔴 사내 모양이 아닌 번호도 **전부 보인다** — 개발 DB 에 실제로 있는 모양들이다", () => {
    // `Q-7` · `DSS2026-089`(공백 빠뜨림) 처럼 번호를 못 뽑는 것들. 「맞는 것이 없다」로 보면
    // 결재 탭의 파일이 통째로 사라진다.
    for (const number of ["   ", "\t", "...", "Q-7", "QT-2024-115", "DSS2026-089", "2026-078", "견적서"]) {
      const result = filterQuoteArchiveEntriesByQuoteNumber(FOLDER, number);
      assert.equal(result.entries.length, FOLDER.length, number);
      assert.equal(result.hiddenCount, 0, number);
      assert.equal(result.entries, FOLDER, number);
    }
  });
});

describe("던지지 않는다 · 차례를 흔들지 않는다", () => {
  test("남은 줄의 차례는 받은 그대로다", () => {
    const rows = [row("DSS 2026-089 ㄴ.xls"), row("참고.pdf"), row("DSS 2026-089 ㄱ.xls")];
    assert.deepEqual(names(filterQuoteArchiveEntriesByQuoteNumber(rows, "DSS 2026-089").entries), [
      "DSS 2026-089 ㄴ.xls",
      "DSS 2026-089 ㄱ.xls",
    ]);
  });

  test("이름이 글자가 아닌 줄이 섞여 있어도 던지지 않는다 — 맞지 않는 것으로 센다", () => {
    const rows = [{ name: 7 as unknown as string }, row("DSS 2026-089 가나상사.xls")];
    const result = filterQuoteArchiveEntriesByQuoteNumber(rows, "DSS 2026-089");
    assert.deepEqual(names(result.entries), ["DSS 2026-089 가나상사.xls"]);
    assert.equal(result.hiddenCount, 1);
  });

  test("빈 목록 — 숨긴 것도 0 이다", () => {
    const result = filterQuoteArchiveEntriesByQuoteNumber([], "DSS 2026-089");
    assert.deepEqual(names(result.entries), []);
    assert.equal(result.hiddenCount, 0);
  });

  test("🔴 폴더 줄인지 파일 줄인지 보지 않는다 — 이름만 본다", () => {
    const rows = [
      { name: "DSS 2026-089 사진", isDirectory: true },
      { name: "지난자료", isDirectory: true },
    ];
    const result = filterQuoteArchiveEntriesByQuoteNumber(rows, "DSS 2026-089");
    assert.deepEqual(names(result.entries), ["DSS 2026-089 사진"]);
    assert.equal(result.hiddenCount, 1);
  });
});

/*
 * ============================================================================
 * 🔴 [Excel 보기]와 **같은 판단**인가 — 한 화면 안에서 둘이 싸우면 안 된다
 * ============================================================================
 * 견적서 목록 줄의 [Excel 보기](quote-archive-excel-open.ts)는 **번호가 맞는 엑셀**을 찾아
 * 연다. 그 단추가 여는 파일을 바로 옆 공유폴더 구역이 숨기면, 쓰는 분은 「없는 파일이
 * 열린다」로 읽는다. 두 모듈이 같은 번호 규칙을 쓰는지를 **값으로** 견준다.
 * ============================================================================
 */
describe("🔴 [Excel 보기]가 고르는 파일은 반드시 보인다", () => {
  test("실측 변종까지 — 고른 파일이 거른 뒤에도 남아 있다", () => {
    const folder = [
      { name: "DSS-2026-089 가나상사 수리 견적서.xlsx", isDirectory: false, sizeBytes: 10 },
      { name: "dss 2026-004r1 가나상사 수리 견적서.xlsx", isDirectory: false, sizeBytes: 10 },
      { name: "DSS 2026-089-1 가나상사 수리 견적서(OH포함).xlsx", isDirectory: false, sizeBytes: 10 },
      { name: "참고자료.pdf", isDirectory: false, sizeBytes: 10 },
    ];
    for (const quoteNumber of ["DSS 2026-089", "DSS 2026-004R1", "DSS 2026-089-1"]) {
      const picked = pickQuoteArchiveExcelEntry(folder, quoteNumber);
      assert.ok(picked !== null, `${quoteNumber}: [Excel 보기]가 아무것도 못 골랐다`);
      const shown = names(filterQuoteArchiveEntriesByQuoteNumber(folder, quoteNumber).entries);
      assert.ok(shown.includes(picked.name), `${quoteNumber}: 여는 파일을 구역이 숨긴다 — ${shown.join(" · ")}`);
    }
  });

  test("[Excel 보기]가 아무것도 못 고르는 번호에서는 거르기도 그 파일을 안 남긴다", () => {
    const folder = [{ name: "DSS 2026-046- ICD MODEL-X1 수리 견적서.xlsx", isDirectory: false, sizeBytes: 10 }];
    assert.equal(pickQuoteArchiveExcelEntry(folder, "DSS 2026-046"), null);
    assert.deepEqual(names(filterQuoteArchiveEntriesByQuoteNumber(folder, "DSS 2026-046").entries), []);
  });
});
