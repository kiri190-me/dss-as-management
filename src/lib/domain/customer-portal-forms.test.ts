import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  CUSTOMER_PORTAL_FORMS,
  PORTAL_MANUAL_VALUE_MAX_LENGTH,
  comparePortalRowsByReceivedAt,
  findPortalFormById,
  findPortalFormForCustomerName,
  groupCustomersByPortalForm,
  isEnteredPerRow,
  manualColumnsOf,
  partsNameFromModelName,
  readManualValues,
  sanitizeManualValues,
  sortPortalRowsByReceivedAt,
  type CustomerPortalForm,
  type PortalRowOrderKey,
} from "./customer-portal-forms";

/**
 * ============================================================================
 * 고객사 양식 — 「고객 안내 현황」의 고객사별 표
 * ============================================================================
 * 사용자 요청(2026-09-30): 고객사마다 쓰는 엑셀 현황표의 열 구성 그대로 표를
 * 만든다. 열 구성이 DB 가 아니라 **코드**에 있는 까닭이 바로 이 시험이다 —
 * DB 에 있으면 "지금 ICD 표에 열이 몇 개인가"를 물어볼 방법이 없다.
 *
 * 이 시험이 못 박는 것 넷:
 *
 *  1. 🔴 세 고객사의 **열 이름과 차례가 엑셀 그대로**다. 열 하나가 조용히
 *     빠지거나 자리를 바꾸면 담당자가 다른 칸에 값을 적는다.
 *  2. 🔴 **정의가 없는 고객사는 null** 이다 — 2026-10-04 부터 그런 고객사는
 *     「고객 안내 현황」에 아예 나오지 않는다. 부분 일치로 남의 양식이 걸리지
 *     않는 것까지 본다.
 *  3. 🔴 **모르는 키는 저장되지 않는다.** 오류를 내지 않고 조용히 버린다.
 *  4. 🔴 **모르는 모델명의 Parts 명은 빈칸**이다 — 짐작해 채우면 고객사 표에
 *     거짓이 적힌다.
 *
 * 🔴 unit 에 적은 이유: 순수 함수라 DB 도 환경변수도 필요 없다.
 * ============================================================================
 */

function labelsOf(form: CustomerPortalForm): string[] {
  return form.columns.map((column) => column.label);
}

function keysOf(form: CustomerPortalForm): string[] {
  return form.columns.map((column) => column.key);
}

function formOf(id: string): CustomerPortalForm {
  const form = findPortalFormById(id);
  assert.ok(form, `${id} 양식이 없다`);
  return form;
}

describe("🔴 세 고객사의 열 구성 — 엑셀 그대로", () => {
  test("ICD — 열 열두 개, 차례까지", () => {
    assert.deepEqual(labelsOf(formOf("ICD")), [
      "NO.",
      "Site 명",
      "Parts 명",
      "Model",
      "Lot No.",
      "Serial No.",
      "반출일",
      "ICD PO 발행일",
      "현황",
      "견적서 No.",
      "비고",
      "중국 재 수출 마감 일자 (LGD CO 만)",
    ]);
  });

  test("INVENIA — 열 열 개, 차례까지", () => {
    assert.deepEqual(labelsOf(formOf("INVENIA")), [
      "No.",
      "Site명",
      "Model",
      "L/N",
      "S/N",
      "반출일",
      "P.O 발행 일",
      "현 진행 상황",
      "견적서 번호",
      "비고",
    ]);
  });

  test("JUSUNG — 열 열세 개, 차례까지", () => {
    assert.deepEqual(labelsOf(formOf("JUSUNG")), [
      "No.",
      "Site명",
      "PRV No.",
      "Q코드",
      "Q4.Level",
      "Model",
      "탈착품 S/N",
      "통문번호",
      "반출일",
      "납품 요청일",
      "수리 요청일",
      "현 진행 상황",
      "비고",
    ]);
  });

  test("양식마다 키가 겹치지 않는다 — 겹치면 한 칸이 다른 칸을 덮는다", () => {
    for (const form of CUSTOMER_PORTAL_FORMS) {
      const keys = keysOf(form);
      assert.equal(new Set(keys).size, keys.length, `${form.id} 에 같은 키가 둘 있다`);
    }
  });

  test("양식마다 번호·상태·비고는 **한 번씩만**", () => {
    for (const form of CUSTOMER_PORTAL_FORMS) {
      for (const kind of ["ROW_NUMBER", "STATUS", "NOTE"] as const) {
        const count = form.columns.filter((column) => column.kind === kind).length;
        assert.equal(count, 1, `${form.id} 의 ${kind} 가 ${count} 개다`);
      }
    }
  });
});

describe("🔴 「반출일」은 인수일이다 — 부품 출고가 아니다", () => {
  test("세 양식 모두 시스템이 아는 receivedAt 을 쓴다(손으로 적지 않는다)", () => {
    for (const form of CUSTOMER_PORTAL_FORMS) {
      const column = form.columns.find((c) => c.label === "반출일");
      assert.ok(column, `${form.id} 에 반출일이 없다`);
      assert.equal(column.kind, "SYSTEM", `${form.id} 의 반출일이 시스템 값이 아니다`);
      assert.equal(
        column.kind === "SYSTEM" ? column.field : null,
        "receivedAt",
        `${form.id} 의 반출일이 인수일이 아니다`
      );
    }
  });

  test("키 이름에 출고를 뜻하는 낱말이 없다 — 다음 사람이 출고 쪽을 뒤지지 않게", () => {
    for (const form of CUSTOMER_PORTAL_FORMS) {
      for (const key of keysOf(form)) {
        assert.ok(
          !/release|issueDate|partIssue/i.test(key),
          `${form.id} 의 키 ${key} 가 출고로 읽힌다`
        );
      }
    }
  });
});

describe("🔴 손으로 적는 칸은 확정된 여섯뿐이다", () => {
  test("ICD — 중국 재 수출 마감 일자 하나", () => {
    assert.deepEqual(
      manualColumnsOf(formOf("ICD")).map((c) => c.label),
      ["중국 재 수출 마감 일자 (LGD CO 만)"]
    );
  });

  test("INVENIA — 하나도 없다(전부 시스템이 채운다)", () => {
    assert.deepEqual(manualColumnsOf(formOf("INVENIA")), []);
  });

  test("JUSUNG — 다섯", () => {
    assert.deepEqual(
      manualColumnsOf(formOf("JUSUNG")).map((c) => c.label),
      ["PRV No.", "Q코드", "Q4.Level", "통문번호", "수리 요청일"]
    );
  });

  test("🔴 「납품 요청일」은 접수 건의 **고객 요청 납기일**이다 — 내자 납기요청일이 아니다", () => {
    const column = formOf("JUSUNG").columns.find((c) => c.label === "납품 요청일");
    assert.ok(column);
    assert.equal(column.kind, "SYSTEM", "손으로 적거나 여러 줄로 그리는 칸이 아니다");
    assert.equal(
      column.kind === "SYSTEM" ? column.field : null,
      "customerRequestedDueDate",
      "내자 정리의 납기요청일로 되돌아갔다 — 2026-09-30 사용자 확인을 먼저 읽을 것"
    );
  });

  test("「Parts 명」은 모델명에서 계산한다 — 손으로 적지 않는다", () => {
    const column = formOf("ICD").columns.find((c) => c.label === "Parts 명");
    assert.ok(column);
    assert.equal(column.kind, "DERIVED");
  });

  test("빈칸에 빗금을 치는 칸은 **중국 재 수출 마감 일자 하나뿐**이다", () => {
    const marked: string[] = [];
    for (const form of CUSTOMER_PORTAL_FORMS) {
      for (const column of manualColumnsOf(form)) {
        if (column.emptyMark) marked.push(`${form.id}:${column.label}`);
      }
    }
    assert.deepEqual(marked, ["ICD:중국 재 수출 마감 일자 (LGD CO 만)"]);
  });

  test("사람이 줄마다 적는 칸은 상태 · 비고 · 손 입력 셋뿐이다", () => {
    const entered = formOf("JUSUNG").columns.filter(isEnteredPerRow).map((c) => c.label);
    assert.deepEqual(entered, [
      "PRV No.",
      "Q코드",
      "Q4.Level",
      "통문번호",
      "수리 요청일",
      "현 진행 상황",
      "비고",
    ]);
  });
});

describe("🔴 고객사를 이름으로 가린다", () => {
  test("실제로 등록된 이름들이 걸린다(2026-09-30 실측)", () => {
    assert.equal(findPortalFormForCustomerName("ICD Co.,Ltd.")?.id, "ICD");
    assert.equal(findPortalFormForCustomerName("INVENIA")?.id, "INVENIA");
    assert.equal(findPortalFormForCustomerName("INVENIA Co.,Ltd")?.id, "INVENIA");
    assert.equal(findPortalFormForCustomerName("JUSUNG")?.id, "JUSUNG");
    assert.equal(findPortalFormForCustomerName("주성 엔지니어링")?.id, "JUSUNG");
  });

  test("DB 의 유일 색인과 같은 정규화 — 앞뒤 공백 · 연속 공백 · 대소문자", () => {
    assert.equal(findPortalFormForCustomerName("  jusung  ")?.id, "JUSUNG");
    assert.equal(findPortalFormForCustomerName("주성   엔지니어링")?.id, "JUSUNG");
    assert.equal(findPortalFormForCustomerName("invenia co.,ltd")?.id, "INVENIA");
  });

  test("🔴 정의가 없는 고객사는 null — 그 고객사는 화면에 나오지 않는다", () => {
    for (const name of [
      "대성RF시스템",
      "동해정밀",
      "WONIK",
      "DEMO 고객사 01",
      "",
      "   ",
      null,
      undefined,
      123 as unknown as string,
    ]) {
      assert.equal(findPortalFormForCustomerName(name), null, `${String(name)} 이 걸렸다`);
    }
  });

  test("🔴 부분 일치로 남의 양식이 걸리지 않는다", () => {
    // INVENIA 는 INVENIA Co.,Ltd 의 부분 문자열이다. 부분 일치를 허용하면
    // 이름에 그 글자가 우연히 든 회사가 남의 표를 쓰게 된다.
    assert.equal(findPortalFormForCustomerName("INVENIA Corporation"), null);
    assert.equal(findPortalFormForCustomerName("New ICD Co.,Ltd."), null);
    assert.equal(findPortalFormForCustomerName("JUSUNG2"), null);
  });

  test("id 로 꺼내기도 모르는 값에 null 이다", () => {
    assert.equal(findPortalFormById("NOPE"), null);
    assert.equal(findPortalFormById(""), null);
    assert.equal(findPortalFormById(null), null);
    assert.equal(findPortalFormById("constructor"), null);
  });
});

describe("🔴 모르는 키는 저장되지 않는다", () => {
  const jusung = formOf("JUSUNG");

  test("양식에 없는 키는 조용히 버린다 — 오류가 아니다", () => {
    const result = sanitizeManualValues(jusung, {
      prvNumber: "PRV-1",
      chinaReExportDeadline: "2026-12-31", // ICD 칸이다
      whateverElse: "x",
      statusOptionId: "훔쳐 쓰려는 값",
      note: "훔쳐 쓰려는 값",
    });
    assert.equal(result.ok, true);
    assert.deepEqual(result.ok && result.values, { prvNumber: "PRV-1" });
  });

  test("프로토타입 이름도 같은 길로 버려진다", () => {
    const result = sanitizeManualValues(jusung, {
      ["__proto__"]: "x",
      constructor: "x",
      toString: "x",
    });
    assert.equal(result.ok, true);
    assert.deepEqual(result.ok && result.values, {});
  });

  test("손 입력 칸이 하나도 없는 양식은 무엇을 보내도 빈 것이 된다", () => {
    const result = sanitizeManualValues(formOf("INVENIA"), { prvNumber: "PRV-1" });
    assert.equal(result.ok, true);
    assert.deepEqual(result.ok && result.values, {});
  });
});

describe("🔴 빈 값은 키째로 지운다", () => {
  const jusung = formOf("JUSUNG");

  test("빈 글자 · 공백뿐인 값은 담기지 않는다", () => {
    const result = sanitizeManualValues(jusung, {
      prvNumber: "",
      qCode: "   ",
      qLevel: "\t\n",
      passNumber: "TX-9",
    });
    assert.equal(result.ok, true);
    assert.deepEqual(result.ok && result.values, { passNumber: "TX-9" });
  });

  test("앞뒤 공백은 지우고 담는다", () => {
    const result = sanitizeManualValues(jusung, { prvNumber: "  PRV-7  " });
    assert.deepEqual(result.ok && result.values, { prvNumber: "PRV-7" });
  });

  test("글자가 아닌 값은 무시한다", () => {
    const result = sanitizeManualValues(jusung, {
      prvNumber: 7 as unknown as string,
      qCode: null as unknown as string,
      qLevel: { a: 1 } as unknown as string,
      passNumber: "TX-9",
    });
    assert.deepEqual(result.ok && result.values, { passNumber: "TX-9" });
  });

  test("모양 자체가 다르면 빈 것으로 읽는다 — 저장을 막지 않는다", () => {
    for (const raw of [null, undefined, [], "글자", 7]) {
      const result = sanitizeManualValues(jusung, raw);
      assert.equal(result.ok, true, `${JSON.stringify(raw)} 에서 거절됐다`);
      assert.deepEqual(result.ok && result.values, {});
    }
  });
});

describe("길이 상한은 자르지 않고 거절한다", () => {
  const jusung = formOf("JUSUNG");

  test(`${PORTAL_MANUAL_VALUE_MAX_LENGTH}자까지는 들어간다`, () => {
    const exact = "가".repeat(PORTAL_MANUAL_VALUE_MAX_LENGTH);
    const result = sanitizeManualValues(jusung, { prvNumber: exact });
    assert.deepEqual(result.ok && result.values, { prvNumber: exact });
  });

  test("한 글자만 넘어도 거절하고, 칸 이름을 말한다", () => {
    const result = sanitizeManualValues(jusung, {
      prvNumber: "가".repeat(PORTAL_MANUAL_VALUE_MAX_LENGTH + 1),
    });
    assert.equal(result.ok, false);
    assert.ok(!result.ok && result.message.includes("PRV No."));
  });

  test("🔴 조용히 자르지 않는다 — 자르면 적은 사람은 저장됐다고 믿는다", () => {
    const result = sanitizeManualValues(jusung, {
      prvNumber: "가".repeat(PORTAL_MANUAL_VALUE_MAX_LENGTH + 1),
    });
    assert.equal(result.ok, false);
  });

  test("비고(1000자)보다 짧다 — 표의 좁은 한 칸이다", () => {
    assert.ok(PORTAL_MANUAL_VALUE_MAX_LENGTH < 1000);
  });
});

describe("읽을 때도 지금 양식만 본다", () => {
  const jusung = formOf("JUSUNG");

  test("양식 밖의 옛 키는 화면에 들어오지 않는다", () => {
    assert.deepEqual(
      readManualValues(jusung, { prvNumber: "PRV-1", 사라진칸: "옛 값" }),
      { prvNumber: "PRV-1" }
    );
  });

  test("🔴 상한을 넘는 값이 섞여 있어도 그 줄의 다른 칸이 살아 있다", () => {
    const tooLong = "가".repeat(PORTAL_MANUAL_VALUE_MAX_LENGTH + 50);
    assert.deepEqual(readManualValues(jusung, { prvNumber: tooLong, qCode: "Q1" }), {
      prvNumber: tooLong,
      qCode: "Q1",
    });
  });

  test("모양이 다르면 빈 것으로 읽는다", () => {
    for (const raw of [null, undefined, [], "글자", 7]) {
      assert.deepEqual(readManualValues(jusung, raw), {});
    }
  });
});

describe("🔴 Parts 명 — 네 갈래, 모르는 모델명은 빈칸", () => {
  /**
   * 사용자가 준 표기 그대로다(2026-09-30). 🔴 여섯 접두사를 **각각** 값으로
   * 못박는다 — 「RF 로 시작한다」 같은 느슨한 단언으로 바꾸면 소스와 바이어스가
   * 뒤집혀도 시험이 통과한다.
   */
  const EXPECTED: Record<string, string> = {
    "RFK500FH-JS": "RF Gen. (S)",
    "CFK300FH-IC": "RF Gen. (B)",
    "KFK120M-AD": "RF Gen. (B)",
    "MBK500M-JS": "RF Matching Box (S)",
    "CMK300M-IC": "RF Matching Box (B)",
    "KMK120M-AD": "RF Matching Box (B)",
  };

  for (const [model, expected] of Object.entries(EXPECTED)) {
    test(`${model} → ${expected}`, () => {
      assert.equal(partsNameFromModelName(model), expected);
    });
  }

  test("🔴 소스와 바이어스가 실제로 갈린다 — 네 가지가 모두 나온다", () => {
    assert.deepEqual(new Set(Object.values(EXPECTED)).size, 4);
  });

  test("모르는 모델명은 null — 짐작해 채우지 않는다", () => {
    for (const model of [null, undefined, "", "XYZ-1", "제너레이터"]) {
      assert.equal(partsNameFromModelName(model), null);
    }
  });
});

/**
 * ============================================================================
 * 🔴 양식으로 고객사를 묶는다 — 「고객 안내 현황」의 단추가 서는 근거
 * ============================================================================
 * 2026-10-04 전에는 **전용 주소가 발급된 고객사**가 단추였다. 그 기능을 화면에서
 * 걷어내면서 근거가 양식으로 옮겨 왔다(사용자 요청 — 「각사별 양식만 남겨줘」).
 *
 * 🔴 여기서 못 박는 것은 **합치기**다. 고객사 마스터에 같은 회사가 여러 이름으로
 * 등록돼 있다(실측 2026-09-30: `INVENIA` 와 `INVENIA Co.,Ltd` 가 둘 다 살아 있고
 * 양쪽 다 접수 건이 있다). 합치지 않으면 같은 회사의 표가 둘로 갈리는데, 빠진
 * 쪽은 아무 오류 없이 영영 안 보인다.
 * ============================================================================
 */
describe("🔴 양식으로 고객사 묶기", () => {
  const CUSTOMERS = [
    { id: "c-icd", name: "ICD Co.,Ltd." },
    { id: "c-inv-1", name: "INVENIA" },
    { id: "c-inv-2", name: "INVENIA Co.,Ltd" },
    { id: "c-jusung-1", name: "JUSUNG" },
    { id: "c-jusung-2", name: "주성 엔지니어링" },
    { id: "c-other", name: "이름 없는 어느 회사" },
  ];

  test("🔴 여러 이름으로 등록된 한 회사가 **한 묶음**이 된다", () => {
    const groups = groupCustomersByPortalForm(CUSTOMERS);
    const invenia = groups.find((group) => group.form.id === "INVENIA");
    assert.deepEqual(invenia?.customerIds, ["c-inv-1", "c-inv-2"]);
    const jusung = groups.find((group) => group.form.id === "JUSUNG");
    assert.deepEqual(jusung?.customerIds, ["c-jusung-1", "c-jusung-2"]);
  });

  test("양식이 없는 고객사는 어느 묶음에도 들어가지 않는다", () => {
    const groups = groupCustomersByPortalForm(CUSTOMERS);
    for (const group of groups) {
      assert.ok(!group.customerIds.includes("c-other"), "양식 없는 고객사가 끼었다");
    }
  });

  test("🔴 묶인 고객사가 하나도 없는 양식은 목록에서 빠진다 — 빈 단추를 그리지 않는다", () => {
    const groups = groupCustomersByPortalForm([{ id: "c-icd", name: "ICD" }]);
    assert.deepEqual(
      groups.map((group) => group.form.id),
      ["ICD"]
    );
  });

  test("차례는 CUSTOMER_PORTAL_FORMS 그대로다 — 고객사 이름 차례가 아니다", () => {
    // 일부러 거꾸로 넣어 본다.
    const groups = groupCustomersByPortalForm([
      { id: "c-jusung", name: "JUSUNG" },
      { id: "c-inv", name: "INVENIA" },
      { id: "c-icd", name: "ICD Co.,Ltd." },
    ]);
    assert.deepEqual(
      groups.map((group) => group.form.id),
      CUSTOMER_PORTAL_FORMS.map((form) => form.id)
    );
  });

  test("하나도 안 묶이면 빈 목록이다", () => {
    assert.deepEqual(groupCustomersByPortalForm([]), []);
    assert.deepEqual(groupCustomersByPortalForm([{ id: "x", name: "어디 회사" }]), []);
  });
});

/**
 * ============================================================================
 * 🔴 「반출일」 오름차순 — 오래된 것이 위, 값이 없으면 맨 뒤
 * ============================================================================
 * 사용자 요청(2026-10-04): 「반출일을 기준으로 오름차순으로 표가 정렬되게 해줘.」
 *
 * 🔴 「반출일」은 **우리에게 들어온 날**(`receivedAt`)이다 — 이름만 반출일이다
 * (customer-portal-forms.ts 머리말). 🔴 값이 없는 줄을 맨 뒤로 보내는 것이 이
 * 시험의 핵심이다: 빈 값은 글자 비교에서 어느 날짜보다 앞서므로, 그냥 두면 날짜를
 * 아직 못 적은 줄이 표 맨 위에 조용히 모인다.
 * ============================================================================
 */
describe("🔴 반출일 오름차순", () => {
  const row = (
    receivedAt: string | null,
    intakeNumber: string | null,
    sourceId = `id-${intakeNumber ?? receivedAt ?? "x"}`
  ): PortalRowOrderKey => ({ receivedAt, intakeNumber, sourceId });

  test("오래된 것이 위로 온다", () => {
    const sorted = sortPortalRowsByReceivedAt([
      row("2026-09-30", "AS-3"),
      row("2026-01-02", "AS-1"),
      row("2026-05-15", "AS-2"),
    ]);
    assert.deepEqual(
      sorted.map((item) => item.intakeNumber),
      ["AS-1", "AS-2", "AS-3"]
    );
  });

  test("🔴 반출일이 없는 줄은 **맨 뒤**다 — 조용히 맨 앞에 오면 표가 이상해진다", () => {
    const sorted = sortPortalRowsByReceivedAt([
      row(null, "AS-없음1"),
      row("2026-03-01", "AS-2"),
      row("", "AS-없음2"),
      row("2026-01-01", "AS-1"),
    ]);
    assert.deepEqual(
      sorted.map((item) => item.intakeNumber),
      ["AS-1", "AS-2", "AS-없음1", "AS-없음2"]
    );
  });

  test("같은 날짜끼리는 접수번호로 못 박는다 — 차례가 흔들리지 않게", () => {
    const sorted = sortPortalRowsByReceivedAt([
      row("2026-02-02", "AS-0003"),
      row("2026-02-02", "AS-0001"),
      row("2026-02-02", "AS-0002"),
    ]);
    assert.deepEqual(
      sorted.map((item) => item.intakeNumber),
      ["AS-0001", "AS-0002", "AS-0003"]
    );
  });

  test("날짜도 접수번호도 같으면 줄 id 로 가른다", () => {
    const sorted = sortPortalRowsByReceivedAt([
      row("2026-02-02", null, "id-b"),
      row("2026-02-02", null, "id-a"),
    ]);
    assert.deepEqual(
      sorted.map((item) => item.sourceId),
      ["id-a", "id-b"]
    );
  });

  test("받은 배열을 건드리지 않는다", () => {
    const original = [row("2026-09-30", "AS-2"), row("2026-01-02", "AS-1")];
    const copy = [...original];
    sortPortalRowsByReceivedAt(original);
    assert.deepEqual(original, copy);
  });

  test("🔴 여러 고객사에서 모은 줄이 **한 표**로 세워진다", () => {
    // 양식 하나에 고객사 둘(INVENIA · INVENIA Co.,Ltd)이 묶인 꼴.
    const fromInvenia = [row("2026-04-01", "AS-INV-1"), row("2026-01-10", "AS-INV-2")];
    const fromInveniaCoLtd = [row("2026-02-20", "AS-CO-1"), row("2026-06-05", "AS-CO-2")];
    const sorted = sortPortalRowsByReceivedAt([...fromInvenia, ...fromInveniaCoLtd]);
    assert.deepEqual(
      sorted.map((item) => item.intakeNumber),
      ["AS-INV-2", "AS-CO-1", "AS-INV-1", "AS-CO-2"],
      "두 고객사의 줄이 한 표에서 날짜 차례로 섞이지 않는다"
    );
  });

  test("견주는 함수 자체가 -1 · 0 · 1 을 낸다", () => {
    assert.equal(comparePortalRowsByReceivedAt(row("2026-01-01", "A"), row("2026-02-01", "B")), -1);
    assert.equal(comparePortalRowsByReceivedAt(row("2026-02-01", "B"), row("2026-01-01", "A")), 1);
    assert.equal(comparePortalRowsByReceivedAt(row("2026-01-01", "A"), row("2026-01-01", "A")), 0);
    assert.equal(comparePortalRowsByReceivedAt(row(null, "A"), row("2026-01-01", "B")), 1);
    assert.equal(comparePortalRowsByReceivedAt(row("2026-01-01", "B"), row(null, "A")), -1);
  });
});
