import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  buildPortalExportRow,
  buildPortalExportRows,
  CUSTOMER_PORTAL_EXPORT_SPECS,
  findPortalExportSpec,
  matchesPortalExportPrefix,
  nextPortalExportFileName,
  normalizePortalExportHeader,
  numberedPortalExportFileName,
  parsePortalExportFileName,
  pickLatestPortalExportFile,
  portalExportStamp,
  type PortalExportCell,
  type PortalExportItem,
} from "./customer-portal-export";
import { CUSTOMER_PORTAL_FORMS, findPortalFormById } from "./customer-portal-forms";

/*
 * 🔴 실제 고객 자료를 쓰지 않는다. 파일 이름의 **모양**만 실측(2026-09-30, 공유폴더)에서
 * 가져왔다 — 그 모양을 못 읽으면 직전 파일을 영영 못 찾기 때문이다.
 */

const REAL_FILE_NAMES = {
  ICD: "ICD 수리 품목 현황 관련 정리 자료_260928.xlsx",
  INVENIA: "INVENIA_RF Gen Matcher 수리 현황_260929.xlsx",
  JUSUNG: "JUSUNG_LGD RF Gen Matcher 수리 현황_260929.xlsx",
} as const;

function item(overrides: Partial<PortalExportItem> = {}): PortalExportItem {
  return {
    intakeNumber: "AS-2026-0001",
    endUserName: "가상 사이트",
    modelName: "MBK300M-AD2",
    lotNumber: "WU0001",
    serialNumber: "0016020",
    receivedAt: "2026-09-15",
    quoteNumber: "DSS2026-001",
    quoteIssuedDate: "2026-09-18",
    orderIssuedDate: "2026-09-20",
    customerRequestedDueDate: "2026-10-10",
    statusLabel: "수리 진행 중",
    statusNote: "비고 한 줄",
    formValues: {},
    ...overrides,
  };
}

describe("내보내기 규칙 — 양식마다 하나씩", () => {
  test("세 양식 모두 규칙이 있고, 화면 양식 목록과 짝이 맞는다", () => {
    assert.equal(CUSTOMER_PORTAL_EXPORT_SPECS.length, CUSTOMER_PORTAL_FORMS.length);
    for (const form of CUSTOMER_PORTAL_FORMS) {
      assert.notEqual(findPortalExportSpec(form.id), null, `${form.id} 규칙이 없다`);
    }
  });

  test("탭 다루기는 양식마다 다르다 — JUSUNG 만 탭을 더한다", () => {
    assert.equal(findPortalExportSpec("ICD")?.placement.kind, "REPLACE");
    assert.equal(findPortalExportSpec("INVENIA")?.placement.kind, "REPLACE_AND_RENAME");
    assert.equal(findPortalExportSpec("JUSUNG")?.placement.kind, "PREPEND_COPY");
  });

  test("머리글 줄과 시작 열은 실측 그대로다", () => {
    assert.deepEqual(
      CUSTOMER_PORTAL_EXPORT_SPECS.map((spec) => [spec.formId, spec.headerRow, spec.firstColumn]),
      [
        ["ICD", 5, "B"],
        ["INVENIA", 3, "B"],
        ["JUSUNG", 4, "B"],
      ]
    );
  });

  test("그 주의 날짜를 적는 칸은 JUSUNG 의 N1 뿐이다", () => {
    assert.equal(findPortalExportSpec("JUSUNG")?.dateCell, "N1");
    assert.equal(findPortalExportSpec("ICD")?.dateCell, undefined);
    assert.equal(findPortalExportSpec("INVENIA")?.dateCell, undefined);
  });
});

describe("만든 날짜", () => {
  test("YYMMDD — 그 지역의 달력 날짜다", () => {
    assert.equal(portalExportStamp(new Date(2026, 8, 30)), "260930");
    assert.equal(portalExportStamp(new Date(2026, 0, 1)), "260101");
    assert.equal(portalExportStamp(new Date(2030, 11, 31)), "301231");
  });

  test("자정 직후에도 그날 날짜다(UTC 로 미끄러지지 않는다)", () => {
    assert.equal(portalExportStamp(new Date(2026, 8, 30, 0, 5)), "260930");
  });
});

describe("파일 이름 — 실측한 세 모양을 읽는다", () => {
  test("셋 다 `…_YYMMDD.xlsx` 로 읽힌다", () => {
    for (const [formId, fileName] of Object.entries(REAL_FILE_NAMES)) {
      const parsed = parsePortalExportFileName(fileName);
      assert.notEqual(parsed, null, `${formId} 이름을 못 읽었다`);
      assert.equal(parsed?.copyNumber, 1);
      assert.match(parsed?.stamp ?? "", /^\d{6}$/);
    }
    assert.equal(parsePortalExportFileName(REAL_FILE_NAMES.ICD)?.stamp, "260928");
    assert.equal(parsePortalExportFileName(REAL_FILE_NAMES.JUSUNG)?.stamp, "260929");
  });

  test("같은 날 두 번 저장해 붙은 ` (2)` 도 읽는다", () => {
    const parsed = parsePortalExportFileName("INVENIA_RF Gen Matcher 수리 현황_260929 (2).xlsx");
    assert.equal(parsed?.stamp, "260929");
    assert.equal(parsed?.copyNumber, 2);
    assert.equal(parsed?.base, "INVENIA_RF Gen Matcher 수리 현황");
  });

  test("엑셀이 아니거나 날짜가 없으면 읽지 않는다", () => {
    assert.equal(parsePortalExportFileName("INVENIA 현황.xlsx"), null);
    assert.equal(parsePortalExportFileName("INVENIA_현황_260929.xls"), null);
    assert.equal(parsePortalExportFileName("INVENIA_현황_26092.xlsx"), null);
    // 엑셀이 열어 둔 파일의 잠금 파일.
    assert.equal(parsePortalExportFileName("~$INVENIA_현황_260929.xlsx"), null);
  });

  test("🔴 새 이름은 만든 날짜만 갈아 끼운다 — 제목은 물려받는다", () => {
    const stamp = "260930";
    for (const fileName of Object.values(REAL_FILE_NAMES)) {
      const parsed = parsePortalExportFileName(fileName);
      assert.notEqual(parsed, null);
      const next = nextPortalExportFileName(parsed!, stamp);
      assert.ok(next.endsWith(`_${stamp}.xlsx`), `${next} 에 오늘 날짜가 없다`);
      assert.equal(next, fileName.replace(/_\d{6}\.xlsx$/, `_${stamp}.xlsx`));
    }
  });

  test("` (2)` 는 제목의 일부가 아니라 떼어낸다", () => {
    const parsed = parsePortalExportFileName("ICD 정리 자료_260928 (3).xlsx");
    assert.equal(nextPortalExportFileName(parsed!, "260930"), "ICD 정리 자료_260930.xlsx");
  });

  test("같은 이름이 있을 때의 다음 후보", () => {
    assert.equal(numberedPortalExportFileName("가_260930.xlsx", 1), "가_260930.xlsx");
    assert.equal(numberedPortalExportFileName("가_260930.xlsx", 2), "가_260930 (2).xlsx");
    // 그 이름도 다시 읽혀야 다음 날 직전 파일로 뽑힌다.
    assert.equal(parsePortalExportFileName("가_260930 (2).xlsx")?.copyNumber, 2);
  });
});

describe("어느 파일이 그 고객사의 것인가", () => {
  test("앞머리 뒤가 공백 · 밑줄 · 붙임표여야 한다", () => {
    const icd = findPortalExportSpec("ICD")!;
    assert.equal(matchesPortalExportPrefix(icd, REAL_FILE_NAMES.ICD), true);
    assert.equal(matchesPortalExportPrefix(icd, "icd 소문자_260929.xlsx"), true);
    assert.equal(matchesPortalExportPrefix(icd, "ICD2 다른 회사_260929.xlsx"), false);
    assert.equal(matchesPortalExportPrefix(icd, "구 ICD 자료_260929.xlsx"), false);
  });

  test("양식끼리 서로의 파일을 가져가지 않는다", () => {
    for (const spec of CUSTOMER_PORTAL_EXPORT_SPECS) {
      for (const [formId, fileName] of Object.entries(REAL_FILE_NAMES)) {
        assert.equal(
          matchesPortalExportPrefix(spec, fileName),
          spec.formId === formId,
          `${spec.formId} 가 ${fileName} 을 ${spec.formId === formId ? "못" : "잘못"} 집었다`
        );
      }
    }
  });
});

describe("🔴 직전 파일 고르기 — 이름의 날짜가 먼저", () => {
  const spec = findPortalExportSpec("JUSUNG")!;

  test("이름의 날짜가 가장 늦은 것을 고른다", () => {
    const picked = pickLatestPortalExportFile(spec, [
      { fileName: "JUSUNG_현황_260901.xlsx", modifiedAtMs: 100 },
      { fileName: "JUSUNG_현황_260929.xlsx", modifiedAtMs: 50 },
      { fileName: "JUSUNG_현황_260915.xlsx", modifiedAtMs: 200 },
    ]);
    assert.equal(picked?.entry.fileName, "JUSUNG_현황_260929.xlsx");
  });

  test("🔴 수정 시각이 새로워도 옛 날짜 파일을 고르지 않는다(복사만 해도 시각이 바뀐다)", () => {
    const picked = pickLatestPortalExportFile(spec, [
      { fileName: "JUSUNG_현황_260929.xlsx", modifiedAtMs: 1 },
      { fileName: "JUSUNG_현황_250101.xlsx", modifiedAtMs: 9_999_999 },
    ]);
    assert.equal(picked?.entry.fileName, "JUSUNG_현황_260929.xlsx");
  });

  test("같은 날짜면 번호가 큰 쪽 — 그날 나중에 저장한 것이다", () => {
    const picked = pickLatestPortalExportFile(spec, [
      { fileName: "JUSUNG_현황_260929.xlsx", modifiedAtMs: 500 },
      { fileName: "JUSUNG_현황_260929 (2).xlsx", modifiedAtMs: 100 },
    ]);
    assert.equal(picked?.entry.fileName, "JUSUNG_현황_260929 (2).xlsx");
  });

  test("날짜도 번호도 같으면 수정 시각이 새로운 쪽", () => {
    const picked = pickLatestPortalExportFile(spec, [
      { fileName: "JUSUNG_가_260929.xlsx", modifiedAtMs: 100 },
      { fileName: "JUSUNG_나_260929.xlsx", modifiedAtMs: 900 },
    ]);
    assert.equal(picked?.entry.fileName, "JUSUNG_나_260929.xlsx");
  });

  test("🔴 사람이 손으로 만든 이름은 아예 보지 않는다", () => {
    assert.equal(
      pickLatestPortalExportFile(spec, [
        { fileName: "JUSUNG 임시본.xlsx", modifiedAtMs: 900 },
        { fileName: "메모.txt", modifiedAtMs: 900 },
      ]),
      null
    );
  });

  test("남의 고객사 파일만 있으면 없는 것이다", () => {
    assert.equal(
      pickLatestPortalExportFile(spec, [{ fileName: REAL_FILE_NAMES.ICD, modifiedAtMs: 900 }]),
      null
    );
  });
});

describe("머리글 대조 — 첫 줄만, 공백은 뗀다", () => {
  test("🔴 ICD 처럼 한 칸에 여러 줄이어도 첫 줄이 같으면 같다", () => {
    const excel =
      "중국 재 수출 마감 일자 (LGD CO 만)\r\n* 수리 시, 하기 날짜 참고 부탁드립니다.\r\n* 마감 일자는 해당 일자 전, 반드시 출하되어야 합니다.";
    const label = findPortalFormById("ICD")!.columns[11].label;
    assert.equal(normalizePortalExportHeader(excel), normalizePortalExportHeader(label));
  });

  test("띄어쓰기가 달라도 같다", () => {
    assert.equal(normalizePortalExportHeader("Site 명"), normalizePortalExportHeader("Site명"));
  });

  test("낱말이 다르면 다르다", () => {
    assert.notEqual(normalizePortalExportHeader("납품 요청일"), normalizePortalExportHeader("수리 예정일"));
  });

  test("빈 칸은 빈 글자다", () => {
    assert.equal(normalizePortalExportHeader(null), "");
    assert.equal(normalizePortalExportHeader("   "), "");
  });
});

describe("줄 자료 — 열 차례는 양식이 정한 그대로", () => {
  test("칸 수가 열 수와 같다(세 양식 모두)", () => {
    for (const form of CUSTOMER_PORTAL_FORMS) {
      const [row] = buildPortalExportRows(form, [item()]);
      assert.equal(row.length, form.columns.length, `${form.id} 칸 수가 다르다`);
    }
  });

  test("첫 칸은 줄 번호이고 1부터 센다", () => {
    const form = findPortalFormById("JUSUNG")!;
    const rows = buildPortalExportRows(form, [item(), item(), item()]);
    assert.deepEqual(
      rows.map((row) => row[0]),
      [
        { kind: "number", value: 1 },
        { kind: "number", value: 2 },
        { kind: "number", value: 3 },
      ]
    );
  });

  test("시스템 칸은 접수 건의 같은 이름 칸을 그대로 읽는다", () => {
    const form = findPortalFormById("INVENIA")!;
    const [row] = buildPortalExportRows(form, [item({ modelName: "RFG-1", lotNumber: "LOT-9" })]);
    const at = (key: string) => row[form.columns.findIndex((column) => column.key === key)];
    assert.deepEqual(at("model"), { kind: "text", text: "RFG-1" });
    assert.deepEqual(at("lotNumber"), { kind: "text", text: "LOT-9" });
  });

  test("날짜처럼 생긴 값은 날짜로 알린다 — 어떤 칸이 될지는 통합문서가 정한다", () => {
    const form = findPortalFormById("INVENIA")!;
    const [row] = buildPortalExportRows(form, [item({ receivedAt: "2026-09-15" })]);
    const index = form.columns.findIndex((column) => column.key === "receivedAt");
    assert.deepEqual(row[index], { kind: "date", iso: "2026-09-15" });
  });

  test("🔴 8) 손으로 적은 값이 제자리 열에 들어간다", () => {
    const form = findPortalFormById("JUSUNG")!;
    const row = buildPortalExportRow(
      form,
      item({
        formValues: {
          prvNumber: "R2405-2246391",
          qCode: "Q1",
          qLevel: "L2",
          passNumber: "EP2406030019",
          repairRequestDate: "2026-09-22",
        },
      }),
      1
    );
    const at = (key: string) => row[form.columns.findIndex((column) => column.key === key)];
    assert.deepEqual(at("prvNumber"), { kind: "text", text: "R2405-2246391" });
    assert.deepEqual(at("qCode"), { kind: "text", text: "Q1" });
    assert.deepEqual(at("qLevel"), { kind: "text", text: "L2" });
    assert.deepEqual(at("passNumber"), { kind: "text", text: "EP2406030019" });
    assert.deepEqual(at("repairRequestDate"), { kind: "date", iso: "2026-09-22" });
  });

  test("🔴 그 양식이 모르는 손 입력 키는 어느 칸에도 들어가지 않는다", () => {
    const form = findPortalFormById("INVENIA")!;
    // INVENIA 에는 손으로 적는 칸이 없다 — JUSUNG 의 값이 섞여 들어와도 버려진다.
    const row = buildPortalExportRow(form, item({ formValues: { prvNumber: "몰래", qCode: "몰래" } }), 1);
    assert.equal(
      row.some((cell: PortalExportCell) => cell.kind === "text" && cell.text === "몰래"),
      false
    );
  });

  test("상태 · 비고는 그 자리에, 빈 값은 빈칸", () => {
    const form = findPortalFormById("ICD")!;
    const row = buildPortalExportRow(form, item({ statusLabel: "입고 대기", statusNote: null }), 1);
    const at = (key: string) => row[form.columns.findIndex((column) => column.key === key)];
    assert.deepEqual(at("progress"), { kind: "text", text: "입고 대기" });
    assert.deepEqual(at("note"), { kind: "empty" });
  });

  test("모르는 모델명의 Parts 명은 빈칸이다 — 짐작해 채우지 않는다", () => {
    const form = findPortalFormById("ICD")!;
    const row = buildPortalExportRow(form, item({ modelName: "ZZZ-없는모델" }), 1);
    assert.deepEqual(row[form.columns.findIndex((column) => column.key === "partsName")], { kind: "empty" });
  });
});
