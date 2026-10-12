import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  hideSupersededArchiveFileNumbers,
  latestArchiveFileNumber,
  quoteArchiveNumberKey,
  quoteNumberFromArchiveFileName,
  quoteNumbersFromArchiveFileNames,
} from "./quote-archive-file-number";

/*
 * ============================================================================
 * 파일 이름 → 발행번호 (2026-10-06)
 * ============================================================================
 * 사내 공유폴더의 2026 연도 폴더 파일 342 개를 실측해 모양 셋(본 번호 · 가지 · 개정)과
 * 못 뽑는 셋을 그대로 가져왔다. 🔴 **고객사명 · L/N · S/N 은 가짜다**(저장소가 공개다) —
 * 번호와 확장자 모양만 실제와 같다.
 * ============================================================================
 */

describe("한 이름에서 번호 뽑기", () => {
  test("모양 셋 — 본 번호 · 가지 · 개정", () => {
    assert.equal(quoteNumberFromArchiveFileName("DSS 2026-001 가나상사 MODEL-X1 수리 견적서.xlsx"), "2026-001");
    assert.equal(quoteNumberFromArchiveFileName("DSS 2026-001-1 가나상사 MODEL-X1(OH포함).xls"), "2026-001-1");
    assert.equal(quoteNumberFromArchiveFileName("DSS 2026-004R1 가나상사 MODEL-X1 - 有印.pdf"), "2026-004R1");
  });

  test("🔴 `DSS` 뒤가 공백이 아니어도 받는다 — 번호가 자유 입력이라 하이픈이 온다", () => {
    assert.equal(quoteNumberFromArchiveFileName("DSS-2026-099 가나상사 MODEL-X1 수리 견적서.xlsx"), "2026-099");
    assert.equal(quoteNumberFromArchiveFileName("DSS-2026-099-2 가나상사 MODEL-X1.xls"), "2026-099-2");
  });

  test("🔴 번호 뒤에 **공백**이 와야 한다 — 실측의 오타는 못 뽑는 것이 맞다", () => {
    // `DSS 2026-046- ICD …` — 번호 뒤에 공백 대신 `-` 를 찍은 이름이 실제로 있었다.
    assert.equal(quoteNumberFromArchiveFileName("DSS 2026-046- ICD MODEL-X1 수리 견적서.xlsx"), null);
    // 번호 바로 뒤가 확장자여도 못 뽑는다(사람이 적지 않은 번호를 지어내지 않는다).
    assert.equal(quoteNumberFromArchiveFileName("DSS 2026-001.xlsx"), null);
  });

  test("번호가 아닌 파일은 null", () => {
    assert.equal(quoteNumberFromArchiveFileName("단가기재 참고용.XLS"), null);
    // 🔴 머리가 번호가 아닌 이름 — 가운데 숫자 뭉치를 번호로 둔갑시키지 않는다.
    assert.equal(quoteNumberFromArchiveFileName("RFK300FH-AD1_AB1234_1234567 검사보고서.pdf"), null);
    assert.equal(quoteNumberFromArchiveFileName("Thumbs.db"), null);
    assert.equal(quoteNumberFromArchiveFileName(""), null);
    // 모양이 글자가 아니면 던지지 않고 null 이다.
    assert.equal(quoteNumberFromArchiveFileName(undefined as unknown as string), null);
  });

  test("사람이 적은 이름의 흔들림 — 공백 두 칸 · 소문자", () => {
    assert.equal(quoteNumberFromArchiveFileName("DSS  2026-007  가나상사.xlsx"), "2026-007");
    assert.equal(quoteNumberFromArchiveFileName(" DSS 2026-007 가나상사.xlsx"), "2026-007");
    // 대소문자를 접어 보고, 돌려줄 때는 대문자로 맞춘다(같은 번호가 둘로 세어지지 않게).
    assert.equal(quoteNumberFromArchiveFileName("dss 2026-004r1 가나상사.pdf"), "2026-004R1");
  });

  test("🔴 본 번호로 깎지 않는다 — 가지 번호가 있다는 사실이 사라지면 안 된다", () => {
    assert.equal(quoteNumberFromArchiveFileName("DSS 2026-001-1 가나상사.xls"), "2026-001-1");
    assert.notEqual(quoteNumberFromArchiveFileName("DSS 2026-001-1 가나상사.xls"), "2026-001");
  });
});

describe("폴더 하나의 번호들", () => {
  test("중복을 없애고 차례대로", () => {
    assert.deepEqual(
      quoteNumbersFromArchiveFileNames([
        "DSS 2026-001-1 가나상사 MODEL-X1(OH포함).xls",
        "DSS 2026-001 가나상사 MODEL-X1 - 有印.pdf",
        "DSS 2026-001 가나상사 MODEL-X1 수리 견적서.xlsx",
        "Thumbs.db",
        "단가기재 참고용.XLS",
      ]),
      ["2026-001", "2026-001-1"]
    );
  });

  test("번호가 하나도 없으면 빈 배열", () => {
    assert.deepEqual(quoteNumbersFromArchiveFileNames(["단가기재 참고용.XLS", "메모.txt"]), []);
    assert.deepEqual(quoteNumbersFromArchiveFileNames([]), []);
  });

  test("차례는 연도 · 일련번호 순이다", () => {
    assert.deepEqual(
      quoteNumbersFromArchiveFileNames([
        "DSS 2026-010 가나상사.xlsx",
        "DSS 2024-027 가나상사.xlsx",
        "DSS 2026-009 가나상사.xlsx",
        "DSS 2024-027-1 가나상사.xlsx",
      ]),
      ["2024-027", "2024-027-1", "2026-009", "2026-010"]
    );
  });
});

/*
 * ============================================================================
 * 🔴 **최신 폴더 하나** · **개정본이 원본을 가린다** (사용자 요구 2026-10-12)
 * ============================================================================
 * [고객 안내 현황]과 [주간보고]의 견적서 번호 칸이 쓴다. 그전에는 그 장비에 맞는 폴더를
 * **전부** 열어 번호를 합쳐서, 몇 해 전 번호까지 한 칸에 쌓였다.
 * 공유폴더를 읽는 쪽(storage/quote-archive-case-numbers.ts)이 이 둘을 부른다 — 셈 자체는
 * 디스크를 모르는 순수한 일이라 번호를 다루는 이 모듈에 있다.
 * ============================================================================
 */
describe("번호 여럿 가운데 최신 하나", () => {
  test("가장 큰 번호 — 연도가 달라도 일련번호가 달라도", () => {
    assert.equal(latestArchiveFileNumber(["2026-100", "2026-104", "2026-009"]), "2026-104");
    assert.equal(latestArchiveFileNumber(["2023-018", "2026-100", "2024-027"]), "2026-100");
    assert.equal(latestArchiveFileNumber(["2026-100"]), "2026-100");
  });

  test("🔴 개정본이 원본보다 뒤다 — 같은 번호면 꼬리가 붙은 쪽이 크다", () => {
    assert.equal(latestArchiveFileNumber(["2026-104", "2026-104R1"]), "2026-104R1");
    assert.equal(latestArchiveFileNumber(["2026-104R1", "2026-104R2"]), "2026-104R2");
    assert.equal(latestArchiveFileNumber(["2026-104", "2026-104-1"]), "2026-104-1");
  });

  test("🔴 못 뽑은 자리(null)는 빼고 본다 — 섞여 있어도 뽑힌 것들 가운데서 고른다", () => {
    assert.equal(latestArchiveFileNumber([null, "2026-100", null, "2026-104"]), "2026-104");
    assert.equal(latestArchiveFileNumber(["2026-100", null]), "2026-100");
  });

  test("🔴 하나도 못 뽑으면 null — 부르는 쪽이 「전부 읽는다」로 갈라설 수 있게", () => {
    assert.equal(latestArchiveFileNumber([null, null]), null);
    assert.equal(latestArchiveFileNumber([]), null);
  });

  test("차례는 폴더 하나의 번호 차례와 **같은 규칙**이다 — 두 쪽이 갈라지면 여기서 깨진다", () => {
    const numbers = quoteNumbersFromArchiveFileNames([
      "DSS 2024-027 가나상사.xlsx",
      "DSS 2026-010 가나상사.xlsx",
      "DSS 2026-009 가나상사.xlsx",
    ]);
    assert.equal(latestArchiveFileNumber(numbers), numbers[numbers.length - 1]);
  });
});

describe("개정본이 원본을 가린다", () => {
  test("🔴 원본은 개정 0 이다 — R1 이 있으면 원본이 사라진다", () => {
    assert.deepEqual(hideSupersededArchiveFileNumbers(["2026-104", "2026-104R1"]), ["2026-104R1"]);
  });

  test("🔴 개정끼리는 큰 쪽만 — R1 과 R2 면 R2", () => {
    assert.deepEqual(hideSupersededArchiveFileNumbers(["2026-104R1", "2026-104R2"]), ["2026-104R2"]);
    assert.deepEqual(hideSupersededArchiveFileNumbers(["2026-104", "2026-104R1", "2026-104R2"]), [
      "2026-104R2",
    ]);
    // 두 자리 개정도 숫자로 센다 — 글자로 견주면 `R10` 이 `R9` 보다 작아진다.
    assert.deepEqual(hideSupersededArchiveFileNumbers(["2026-104R9", "2026-104R10"]), ["2026-104R10"]);
  });

  test("🔴 가지 번호(`-1`)는 가려지지 않는다 — 별도로 나간 견적서다 (사용자 결정 2026-10-12)", () => {
    assert.deepEqual(hideSupersededArchiveFileNumbers(["2026-104", "2026-104-1"]), [
      "2026-104",
      "2026-104-1",
    ]);
    assert.deepEqual(hideSupersededArchiveFileNumbers(["2026-104R1", "2026-104-1"]), [
      "2026-104R1",
      "2026-104-1",
    ]);
    // 가지의 원본은 가지 자신이다 — 본 번호의 개정본이 가지를 지우지 않는다.
    assert.deepEqual(
      hideSupersededArchiveFileNumbers(["2026-104", "2026-104R1", "2026-104-1", "2026-104-2"]),
      ["2026-104R1", "2026-104-1", "2026-104-2"]
    );
  });

  test("줄기가 다르면 서로를 가리지 않는다", () => {
    assert.deepEqual(hideSupersededArchiveFileNumbers(["2026-100", "2026-104R1"]), [
      "2026-100",
      "2026-104R1",
    ]);
    // 해가 다른 같은 일련번호도 남이다.
    assert.deepEqual(hideSupersededArchiveFileNumbers(["2024-104", "2026-104R1"]), [
      "2024-104",
      "2026-104R1",
    ]);
  });

  test("들어온 차례를 지킨다 · 가릴 것이 없으면 그대로", () => {
    const numbers = quoteNumbersFromArchiveFileNames([
      "DSS 2026-104R1 가나상사.pdf",
      "DSS 2026-100 가나상사.xls",
      "DSS 2026-104 가나상사.xls",
      "DSS 2026-100-1 가나상사.xls",
    ]);
    assert.deepEqual(numbers, ["2026-100", "2026-100-1", "2026-104", "2026-104R1"]);
    assert.deepEqual(hideSupersededArchiveFileNumbers(numbers), [
      "2026-100",
      "2026-100-1",
      "2026-104R1",
    ]);
    assert.deepEqual(hideSupersededArchiveFileNumbers(["2026-100"]), ["2026-100"]);
    assert.deepEqual(hideSupersededArchiveFileNumbers([]), []);
  });
});

/*
 * ============================================================================
 * 🔴 발행번호 → 키 — **파일 이름 쪽과 같은 규칙**에 태운다 (2026-10-12 에 여기로 올렸다)
 * ============================================================================
 * 한때 [Excel 보기](components/quotes/quote-archive-excel-open.ts) 안에만 있었고 이름도
 * Excel 에 묶여 있었다. 결재 탭의 공유폴더 거르기가 둘째 쓰는 곳이 되면서 도메인으로
 * 올렸다 — 두 벌이 되면 **같은 화면 안에서 두 규칙이 싸운다.**
 * 🔴 `quoteArchiveExcelNumberKey` 는 **이름만 남아 이 함수를 그대로 부른다**(그쪽 시험이
 * 동작이 안 바뀐 것을 본다).
 * ============================================================================
 */
describe("발행번호에서 키 뽑기", () => {
  test("모양 셋 — 본 번호 · 가지 · 개정", () => {
    assert.equal(quoteArchiveNumberKey("DSS 2026-078"), "2026-078");
    assert.equal(quoteArchiveNumberKey("DSS 2026-078-3"), "2026-078-3");
    assert.equal(quoteArchiveNumberKey("DSS 2026-004R1"), "2026-004R1");
  });

  test("🔴 파일 이름 쪽과 **같은 키**가 나온다 — 두 쪽이 갈라지면 여기서 깨진다", () => {
    for (const [number, fileName] of [
      ["DSS 2026-078", "DSS 2026-078 가나상사 MODEL-X1 수리 견적서.xlsx"],
      ["DSS-2026-099", "DSS-2026-099 가나상사 MODEL-X1.xls"],
      ["dss 2026-001", "dss 2026-001 가나상사 MODEL-X1.pdf"],
      ["DSS 2026-004r1", "DSS 2026-004R1 가나상사 MODEL-X1 - 有印.pdf"],
      ["DSS  2026-007  ", "DSS  2026-007  가나상사.xlsx"],
    ] as const) {
      const key = quoteArchiveNumberKey(number);
      assert.ok(key !== null, number);
      assert.equal(quoteNumberFromArchiveFileName(fileName), key, `${number} ↔ ${fileName}`);
    }
  });

  test("🔴 못 뽑으면 null — 지어내지 않는다", () => {
    // `Q-7` · `DSS2026-089`(공백 빠뜨림)는 개발 DB 에 실제로 있는 모양이다.
    for (const odd of ["", "   ", "Q-7", "QT-2024-115", "DSS2026-089", "2026-078", "견적서", null, undefined, 7]) {
      assert.equal(quoteArchiveNumberKey(odd), null, String(odd));
    }
  });
});
