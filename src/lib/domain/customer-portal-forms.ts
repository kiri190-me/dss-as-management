import { normalizeEntityName } from "./entity-name-match";
import { classifyRfProductByModelName } from "./rf-product-kind";

/**
 * ============================================================================
 * 고객사 양식 — 「고객 안내 현황」이 고객사마다 다른 표를 그리는 근거
 * ============================================================================
 * 고객사들은 저마다 자기 엑셀 현황표를 쓴다. 열 이름도, 차례도, 아예 우리
 * 시스템에 없는 열도 회사마다 다르다. 사용자 요청(2026-09-30)은 그 표를
 * 「고객 안내 현황」 화면 안에 그대로 만들어 달라는 것이다.
 *
 * ── 왜 DB 가 아니라 코드에 적는가 ───────────────────────────────────────
 * 이 저장소가 화면 토큰(ui-theme-tokens.ts)에서 이미 쓰는 방식이다 — **목록은
 * 코드에, 값만 DB 에.** 열 구성은 관리자가 화면에서 고치는 값이 아니라 그
 * 회사와 우리가 합의한 양식이고, 코드에 있어야 시험이 붙는다. DB 에 두면
 * "지금 ICD 표에 열이 몇 개인가"를 시험이 물어볼 수 없다.
 *
 * ── 고객사를 **이름**으로 가린다 ────────────────────────────────────────
 * 🔴 `customers` 표에는 코드 칸이 없다. 남은 후보는 `id`(uuid)와 `name` 둘뿐인데
 * uuid 는 개발 DB 와 운영(NAS) DB 가 서로 다르다 — 코드에 박으면 한쪽에서만
 * 동작한다. 그래서 이름으로 가리되, 회사 하나가 여러 이름으로 등록돼 있을 수
 * 있으므로(실측: `INVENIA` 와 `INVENIA Co.,Ltd` 가 둘 다 살아 있다) 양식마다
 * **이름 목록**을 둔다. 비교는 DB 의 유일 색인과 같은 정규화를 쓴다
 * (normalizeEntityName — 앞뒤 공백 제거 · 연속 공백 하나로 · 소문자).
 *
 * 이름이 바뀌면 그 고객사는 양식을 잃고 기본 9열 표로 떨어진다. 값이 지워지는
 * 것은 아니고(값은 접수 건에 붙어 있다) 이 목록에 이름을 한 줄 더하면 돌아온다.
 *
 * ── 열 하나가 아는 것 ───────────────────────────────────────────────────
 * 키(영문, 안정적) · 화면에 보일 이름 · 차례(배열 순서) · **어디서 오는가**.
 * 어디서 오는가가 여섯 갈래다:
 *
 *   ROW_NUMBER  값이 아니다. 표를 그릴 때 위에서부터 매긴다.
 *   SYSTEM      시스템이 이미 아는 값. 사람이 여기서 못 고친다.
 *   DERIVED     시스템이 아는 값에서 **계산해 내는** 값(Parts 명).
 *   STATUS      고객 안내 상태(드롭다운). 이미 있던 칸이다.
 *   NOTE        비고. 이미 있던 칸이다.
 *   MANUAL      🔴 시스템에 없어 **이 화면에서 줄마다 손으로 적는** 값.
 *
 * STATUS · NOTE · MANUAL 셋이 "사람이 줄마다 적는 값"이다. 셋을 한 갈래로
 * 묶지 않는 이유는 **저장되는 자리가 다르기** 때문이다 — 앞의 둘은 예전부터
 * 있던 칸(status_option_id · note)이고, MANUAL 만 새 jsonb 칸으로 간다.
 *
 * ── ⚠️ 「반출일」은 이 저장소의 「반출」이 아니다 ────────────────────────
 * 🔴 고객사 엑셀의 **반출일은 그 물건이 우리에게 들어온 날**이다(사용자 확인
 * 2026-09-30 — 「반출일은 우리에게 들어온 날이야. 단어는 반출일로 그대로
 * 사용해」). 즉 `repair_cases.received_at`, 우리 화면에서 「인수일」이라
 * 부르는 그 값이다.
 *
 * 이 저장소에서 「반출」은 **창고에서 부품을 내주는 일**
 * (inventory_part_issue_requests)을 가리킨다. 이름이 같고 뜻이 반대다. 그래서
 * 열 키를 `receivedAt` 으로 두고 **보이는 이름만** 「반출일」로 둔다 — 고객사가
 * 쓰는 낱말이라 화면의 글자는 바꾸지 않는다. 키까지 `releaseDate` 로 지으면
 * 다음 사람이 출고 쪽 코드를 뒤진다.
 * ============================================================================
 */

/**
 * 시스템이 이미 아는 값의 이름. 🔴 배열이 아니라 이 합집합 타입으로 적어 두면
 * 화면이 없는 칸을 가리킬 때 tsc 가 막는다.
 *
 * `orderIssuedDate` 는 내자 정리의 **발주발행일**(domestic_orders.order_issued_date)
 * 이다 — 엑셀의 「ICD PO 발행일」 · 「P.O 발행 일」이 가리키는 것이 이것이다.
 */
export type PortalSystemField =
  | "intakeNumber"
  | "endUserName"
  | "modelName"
  | "lotNumber"
  | "serialNumber"
  | "receivedAt"
  | "quoteNumber"
  | "quoteIssuedDate"
  | "orderIssuedDate";

/**
 * 계산해서 내는 값의 이름.
 *
 * `partsName` 은 모델명 앞 세 글자로 제너레이터인지 매쳐인지 가린 것이다
 * (partsNameFromModelName). 🔴 모르는 모델명은 **빈칸**이다.
 */
export type PortalDerivedField = "partsName";

/**
 * 시스템이 아는 값인데 **한 칸에 여러 줄**일 수 있는 것.
 *
 * `deliveryRequestDates` 는 내자 정리의 납기요청일이다(사용자 결정 2026-09-30 —
 * 「납품 요청일은 수리건 상세의 내자 납기 요청일을 가져오면 돼」). 분할 발주 ·
 * 분할 납품이라 한 접수에 날짜가 여럿일 수 있고, 🔴 그 여럿을 **접지 않고 아래로
 * 늘린다** — 내자 정리 목록이 이미 그렇게 그린다
 * (domain/domestic-order-list.ts 의 formatDomesticOrderDueDateLines, 그 함수
 * 주석에 "옆이 아니라 아래로"의 까닭이 있다). 주성 엑셀에도 한 칸에 여러 줄을
 * 적은 자리가 실제로 있다.
 */
export type PortalSystemLinesField = "deliveryRequestDates";

/** 손으로 적는 칸이 받는 것. 날짜 칸은 화면이 날짜 고르개를 준다. */
export type PortalManualValueKind = "text" | "date";

/**
 * 비었을 때 칸을 어떻게 보일 것인가.
 *
 * `SLASH` 는 **빗금**이다(사용자 요청 2026-09-30 — 「중국 재수출 마감일은
 * 내용이 없으면 빗금이 쳐져 있으면 돼」). ⚠️ 지금은 **그 칸 하나에만** 붙는다.
 * 빈 칸 전부에 넓힐지는 사용자가 화면을 보고 정할 일이라, 기본값은 없음이고
 * 나머지 빈 칸은 예전 그대로다.
 */
export type PortalEmptyMark = "SLASH";

export type PortalFormColumn =
  | { key: string; label: string; kind: "ROW_NUMBER" }
  | { key: string; label: string; kind: "SYSTEM"; field: PortalSystemField }
  | { key: string; label: string; kind: "SYSTEM_LINES"; field: PortalSystemLinesField }
  | { key: string; label: string; kind: "DERIVED"; derived: PortalDerivedField }
  | { key: string; label: string; kind: "STATUS" }
  | { key: string; label: string; kind: "NOTE" }
  | {
      key: string;
      label: string;
      kind: "MANUAL";
      valueKind: PortalManualValueKind;
      emptyMark?: PortalEmptyMark;
    };

export type CustomerPortalForm = {
  /** 안정적인 영문 식별자. 화면이 기억해 두는 값이 아니라 시험과 로그가 부르는 이름이다. */
  id: string;
  /** 전환 단추와 표 머리에 보일 이름. */
  label: string;
  /**
   * 이 양식을 쓰는 고객사 이름들. 정규화해서 견준다(normalizeEntityName).
   * 한 회사가 여러 이름으로 등록돼 있을 수 있어 목록이다.
   */
  customerNames: readonly string[];
  columns: readonly PortalFormColumn[];
};

/**
 * 손으로 적는 칸 하나의 길이 상한.
 *
 * 비고가 1000자인 것과 견주면 짧은데, 그것이 맞다 — 비고는 문장이 들어가는
 * 칸이고 이쪽은 표의 좁은 한 칸이다(PRV 번호 · 통문번호 · 날짜). 1000자를
 * 허용하면 한 번의 저장으로 표가 통째로 무너지고, 열이 열 개를 넘는 표에서는
 * 그것이 곧 화면 전체가 옆으로 밀리는 일이 된다.
 */
export const PORTAL_MANUAL_VALUE_MAX_LENGTH = 200;

/**
 * 「반출일」 열. 🔴 **값은 인수일**(`receivedAt`)이고 이름만 「반출일」이다 —
 * 까닭은 이 파일 맨 위 주석에 있다. 세 양식이 같은 열을 쓰므로 한 곳에서
 * 만든다(따로 적어 두면 한쪽만 고쳐지는 날이 온다).
 */
const RECEIVED_AT_COLUMN: PortalFormColumn = {
  key: "receivedAt",
  label: "반출일",
  kind: "SYSTEM",
  field: "receivedAt",
};

/**
 * ICD — 머리글 5행, 표는 B열부터 시작하는 엑셀.
 *
 * 마지막 열 「중국 재 수출 마감 일자」는 괄호까지 포함해 엑셀 글자를 그대로
 * 쓴다. 조건을 우리가 판정하지 않고 적는 사람이 판단하는 칸이라, 이름을
 * 다듬으면 그 조건이 화면에서 사라진다.
 */
const ICD_FORM: CustomerPortalForm = {
  id: "ICD",
  label: "ICD 양식",
  customerNames: ["ICD Co.,Ltd.", "ICD"],
  columns: [
    { key: "no", label: "NO.", kind: "ROW_NUMBER" },
    { key: "siteName", label: "Site 명", kind: "SYSTEM", field: "endUserName" },
    { key: "partsName", label: "Parts 명", kind: "DERIVED", derived: "partsName" },
    { key: "model", label: "Model", kind: "SYSTEM", field: "modelName" },
    { key: "lotNumber", label: "Lot No.", kind: "SYSTEM", field: "lotNumber" },
    { key: "serialNumber", label: "Serial No.", kind: "SYSTEM", field: "serialNumber" },
    RECEIVED_AT_COLUMN,
    {
      key: "poIssuedDate",
      label: "ICD PO 발행일",
      kind: "SYSTEM",
      field: "orderIssuedDate",
    },
    { key: "progress", label: "현황", kind: "STATUS" },
    { key: "quoteNumber", label: "견적서 No.", kind: "SYSTEM", field: "quoteNumber" },
    { key: "note", label: "비고", kind: "NOTE" },
    {
      key: "chinaReExportDeadline",
      label: "중국 재 수출 마감 일자 (LGD CO 만)",
      kind: "MANUAL",
      valueKind: "date",
      // 🔴 비면 빗금이다(사용자 요청 2026-09-30). 지금 이 표시가 붙은 칸은
      //    이것 하나뿐이다 — PortalEmptyMark 주석 참조.
      emptyMark: "SLASH",
    },
  ],
};

/** INVENIA — 머리글 3행. */
const INVENIA_FORM: CustomerPortalForm = {
  id: "INVENIA",
  label: "INVENIA 양식",
  // 실측(2026-09-30): 지워지지 않은 고객사로 `INVENIA` 와 `INVENIA Co.,Ltd` 가
  // 둘 다 있고 양쪽 모두 접수 건을 갖고 있다. 어느 쪽을 골라도 다른 쪽이 빈손이
  // 되므로 둘 다 적는다.
  customerNames: ["INVENIA", "INVENIA Co.,Ltd", "INVENIA Co.,Ltd."],
  columns: [
    { key: "no", label: "No.", kind: "ROW_NUMBER" },
    { key: "siteName", label: "Site명", kind: "SYSTEM", field: "endUserName" },
    { key: "model", label: "Model", kind: "SYSTEM", field: "modelName" },
    { key: "lotNumber", label: "L/N", kind: "SYSTEM", field: "lotNumber" },
    { key: "serialNumber", label: "S/N", kind: "SYSTEM", field: "serialNumber" },
    RECEIVED_AT_COLUMN,
    {
      key: "poIssuedDate",
      label: "P.O 발행 일",
      kind: "SYSTEM",
      field: "orderIssuedDate",
    },
    { key: "progress", label: "현 진행 상황", kind: "STATUS" },
    { key: "quoteNumber", label: "견적서 번호", kind: "SYSTEM", field: "quoteNumber" },
    { key: "note", label: "비고", kind: "NOTE" },
  ],
};

/**
 * JUSUNG — 머리글 4행. 열이 열세 개로 셋 중 가장 넓고, 그중 다섯이 손으로 적는
 * 칸이다(PRV No. · Q코드 · Q4.Level · 통문번호 · 수리 요청일).
 *
 * 「수리 요청일」은 손으로 적는다(사용자 결정 2026-09-30 — 「수리 요청일은
 * 수기입으로 놔두자」). 접수 건의 「고객 요청 납기일」과 같은 것이 아니고,
 * 바로 위의 「납품 요청일」(내자 납기요청일)과도 다른 값이다.
 *
 * ⚠️ 고객사 마스터에 `JUSUNG` 과 `주성 엔지니어링` 이 **따로** 있다(실측
 * 2026-09-30, 양쪽 다 접수 건이 있고 지워지지 않았다). 같은 회사의 영문·국문
 * 등록으로 보여 둘 다 적어 둔다 — 아니라면 이 줄에서 한 이름을 빼면 된다.
 */
const JUSUNG_FORM: CustomerPortalForm = {
  id: "JUSUNG",
  label: "JUSUNG 양식",
  customerNames: ["JUSUNG", "주성 엔지니어링", "주성엔지니어링"],
  columns: [
    { key: "no", label: "No.", kind: "ROW_NUMBER" },
    { key: "siteName", label: "Site명", kind: "SYSTEM", field: "endUserName" },
    { key: "prvNumber", label: "PRV No.", kind: "MANUAL", valueKind: "text" },
    { key: "qCode", label: "Q코드", kind: "MANUAL", valueKind: "text" },
    { key: "qLevel", label: "Q4.Level", kind: "MANUAL", valueKind: "text" },
    { key: "model", label: "Model", kind: "SYSTEM", field: "modelName" },
    {
      key: "serialNumber",
      label: "탈착품 S/N",
      kind: "SYSTEM",
      field: "serialNumber",
    },
    { key: "passNumber", label: "통문번호", kind: "MANUAL", valueKind: "text" },
    RECEIVED_AT_COLUMN,
    {
      key: "deliveryRequestDate",
      label: "납품 요청일",
      kind: "SYSTEM_LINES",
      field: "deliveryRequestDates",
    },
    {
      key: "repairRequestDate",
      label: "수리 요청일",
      kind: "MANUAL",
      valueKind: "date",
    },
    { key: "progress", label: "현 진행 상황", kind: "STATUS" },
    { key: "note", label: "비고", kind: "NOTE" },
  ],
};

/**
 * 지금 정의된 양식 전부. 🔴 여기 없는 고객사는 **기존 9열 표**를 그대로 쓴다 —
 * 그것이 기본값이고, 양식이 생긴다는 것은 기본값에 더해 고를 것이 하나 는다는
 * 뜻이지 기본값이 사라진다는 뜻이 아니다.
 */
export const CUSTOMER_PORTAL_FORMS: readonly CustomerPortalForm[] = [
  ICD_FORM,
  INVENIA_FORM,
  JUSUNG_FORM,
];

/** 양식 하나를 id 로 꺼낸다. 없으면 null. */
export function findPortalFormById(id: string | null | undefined): CustomerPortalForm | null {
  if (typeof id !== "string" || !id) return null;
  return CUSTOMER_PORTAL_FORMS.find((form) => form.id === id) ?? null;
}

/**
 * 고객사 이름으로 양식을 찾는다. 없으면 null(= 기본 9열 표).
 *
 * 🔴 부분 일치로 찾지 않는다. `INVENIA` 가 `INVENIA Co.,Ltd` 의 부분 문자열이라
 * 부분 일치를 허용하면 어느 쪽이 먼저 걸리느냐로 답이 달라지고, 더 나쁘게는
 * 이름에 그 글자가 우연히 든 다른 회사가 남의 양식을 쓰게 된다.
 */
export function findPortalFormForCustomerName(
  customerName: string | null | undefined
): CustomerPortalForm | null {
  if (typeof customerName !== "string") return null;
  const target = normalizeEntityName(customerName);
  if (!target) return null;
  return (
    CUSTOMER_PORTAL_FORMS.find((form) =>
      form.customerNames.some((name) => normalizeEntityName(name) === target)
    ) ?? null
  );
}

/**
 * ICD 표의 「Parts 명」 — 모델명에서 계산한다. 모르는 모델명은 null(빈칸).
 *
 * ■ 🔴 엑셀에 실제로 적힌 글자를 그대로 쓴다
 *
 * ICD 현황표의 그 칸에는 「RF Gen. (B/S)」·「RF Matching Box (B/S)」가 적혀
 * 있다(실측). 모델명 앞 세 글자가 말해 주는 것은 **제너레이터인가 매쳐인가**
 * 까지고(rf-product-kind.ts), 뒤의 `(B/S)` 는 엑셀에 붙어 있는 글자 그대로다.
 *
 * 접두사는 Source 인지 Bias 인지까지 알려 주지만 **그 정보로 `(B/S)` 를
 * `(S)`·`(B)` 로 바꾸지 않는다.** 엑셀이 실제로 그렇게 적는지 확인된 바가 없고,
 * 여기서 짐작하면 고객사 표에 우리가 지어낸 글자가 적힌다. 확인되면 이 함수
 * 한 곳만 고치면 된다 — 분류 자체는 이미 band 까지 갖고 있다.
 */
export function partsNameFromModelName(modelName: string | null | undefined): string | null {
  const classified = classifyRfProductByModelName(modelName);
  if (!classified) return null;
  return classified.kind === "RFG" ? "RF Gen. (B/S)" : "RF Matching Box (B/S)";
}

/** 이 양식에서 손으로 적는 칸들. 차례는 열 차례 그대로다. */
export function manualColumnsOf(
  form: CustomerPortalForm
): Extract<PortalFormColumn, { kind: "MANUAL" }>[] {
  return form.columns.filter(
    (column): column is Extract<PortalFormColumn, { kind: "MANUAL" }> =>
      column.kind === "MANUAL"
  );
}

/** 사람이 줄마다 적는 칸인가(상태 · 비고 · 손으로 적는 칸). */
export function isEnteredPerRow(column: PortalFormColumn): boolean {
  return column.kind === "STATUS" || column.kind === "NOTE" || column.kind === "MANUAL";
}

export type SanitizeManualValuesResult =
  | { ok: true; values: Record<string, string> }
  | { ok: false; message: string };

/**
 * 손으로 적은 값들을 **그 양식이 아는 칸만** 남기고 다듬는다.
 *
 * ■ 🔴 모르는 키는 조용히 버린다
 *
 * 오류로 돌려주지 않는 이유: 이 값은 화면이 만들어 보내는 것이고, 양식이 바뀌어
 * 열이 하나 빠진 뒤에 옛 화면이 열려 있던 사람이 저장을 누르면 없어진 키가
 * 실려 온다. 그때 저장을 통째로 막으면 그 사람은 **무엇이 문제인지 알 수 없는
 * 채로** 아무것도 저장하지 못한다. 버리면 나머지는 저장되고 다음 새로고침에서
 * 화면이 맞춰진다. 대신 "버렸다"는 사실을 시험이 못 박는다.
 *
 * `__proto__` 같은 이름도 같은 길로 버려진다 — 남기는 키를 양식에서 뽑아
 * **화이트리스트로** 돌기 때문에 원리상 통과할 수 없다.
 *
 * ■ 🔴 빈 값은 키를 지운다
 *
 * 빈 문자열과 "안 적음"을 구별할 필요가 없다 — 표의 한 칸이고, 둘 다 화면에
 * 빈칸으로 그려진다. 구별하지 않으면 지운 칸이 jsonb 에 `""` 로 남아 줄마다
 * 열 개씩 쌓인다. 지워서 넣으면 안 적은 표는 값이 통째로 `{}` 이고, 그것이
 * "아무것도 안 적었다"의 정확한 표현이다.
 *
 * ■ 길이는 막는다(버리지 않는다)
 *
 * 너무 긴 값은 조용히 자르지 않고 거절한다. 자르면 적은 사람은 저장됐다고
 * 믿는데 화면에는 잘린 글자가 남는다.
 */
export function sanitizeManualValues(
  form: CustomerPortalForm,
  raw: unknown
): SanitizeManualValuesResult {
  const values: Record<string, string> = {};
  if (raw === null || raw === undefined) return { ok: true, values };
  if (typeof raw !== "object" || Array.isArray(raw)) {
    // 모양 자체가 다르면 적을 것이 없다는 뜻으로 읽는다 — 화면이 보내는 값이라
    // 여기까지 올 일은 없고, 왔다면 저장을 막을 이유가 아니라 무시할 이유다.
    return { ok: true, values };
  }

  const source = raw as Record<string, unknown>;
  for (const column of manualColumnsOf(form)) {
    // 🔴 `key in source` 로 묻지 않는다 — 그러면 프로토타입에 있는 이름이 통과한다.
    if (!Object.prototype.hasOwnProperty.call(source, column.key)) continue;
    const value = source[column.key];
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (!trimmed) continue;
    if (trimmed.length > PORTAL_MANUAL_VALUE_MAX_LENGTH) {
      return {
        ok: false,
        message: `「${column.label}」은(는) ${PORTAL_MANUAL_VALUE_MAX_LENGTH}자까지 적을 수 있습니다.`,
      };
    }
    values[column.key] = trimmed;
  }

  return { ok: true, values };
}

/**
 * DB 에서 읽은 jsonb 를 화면이 쓸 수 있는 모양으로 되돌린다.
 *
 * 저장할 때 걸렀더라도 읽을 때 한 번 더 거른다 — 그 사이에 양식에서 열이 빠질
 * 수 있고, 그때 남아 있던 옛 값이 화면에 들어오면 **어느 칸에도 속하지 않는
 * 값**이 된다. 읽는 쪽에서 거르면 화면은 언제나 "지금 양식"만 본다.
 *
 * 🔴 여기서는 길이로 거절하지 않는다. 읽기는 거절할 자리가 아니다 — 상한을
 * 넘는 값이 어쩌다 들어가 있으면 그 줄의 **다른 칸까지 화면에서 사라진다.**
 * 상한은 넣는 길(sanitizeManualValues)에서만 막는다.
 */
export function readManualValues(
  form: CustomerPortalForm,
  stored: unknown
): Record<string, string> {
  const values: Record<string, string> = {};
  if (stored === null || typeof stored !== "object" || Array.isArray(stored)) {
    return values;
  }
  const source = stored as Record<string, unknown>;
  for (const column of manualColumnsOf(form)) {
    if (!Object.prototype.hasOwnProperty.call(source, column.key)) continue;
    const value = source[column.key];
    if (typeof value !== "string" || !value) continue;
    values[column.key] = value;
  }
  return values;
}
