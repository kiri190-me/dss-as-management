import type { ServiceReportCause, ServiceReportKind } from "@/lib/xlsx/service-report-template";

/**
 * ============================================================================
 * 검사·수리 보고서 폼의 셈 — 화면 밖에 두는 순수 계산
 * ============================================================================
 * 화면(`components/repair-cases/report/service-report/*`)은 이 파일이 만든 값을
 * 그리고, 사람이 고친 값을 다시 이 파일에 넘겨 요청 본문으로 바꾼다. 컴포넌트
 * 안에 이 셈을 두면 시험이 붙지 않고, 시험이 없으면 **화면과 서버가 어긋난 것을
 * 아무도 모르는 상태**가 된다 — 어긋난 요청은 400 으로 돌아오는데, 그 400 을
 * 보는 사람은 자기가 뭘 잘못 적었는지 알 수 없다.
 *
 * ── 🔴 이 파일은 브라우저에서도 돈다 ────────────────────────────────────
 * 그래서 `@/lib/xlsx/*` 와 `@/lib/validation/service-report-input` 를 **값으로
 * 가져오지 않는다.** 채우개는 `zip-reader.ts` 를 거쳐 `node:fs`·`node:zlib` 를
 * 끌고 오고, 검증 모듈은 그 채우개를 끌고 온다. 클라이언트 번들에 그것이
 * 들어가면 빌드가 깨진다. 타입만 가져오는 것은 안전하다(컴파일에서 지워진다).
 *
 * 그럼 상수는 어디서 오는가 — **서버 페이지가 넘겨준다**(`ServiceReportFormLimits`
 * 와 `findingsIntro`, 드롭다운 목록, 그리고 **원인 열 가지의 한글 이름**).
 * 300 과 4 를 여기 베껴 두면 양식이 늘어난 날 화면만 뒤처지고, 그 증상은
 * "왜 안 되는지 모르겠는 400"이다.
 *
 * 🔴 원인 라벨도 마찬가지다. 예전에는 이 파일이 사본을 들고 있었는데, 그러면
 * 양식의 라벨이 바뀐 날 채우개만 고쳐지고 **화면과 문서가 서로 다른 이름을
 * 부른다** — 아무 오류도 안 나서 아무도 모른다. 이제 하나뿐이고
 * (`xlsx/service-report-template.ts` 의 `SERVICE_REPORT_CAUSE_LABELS`, 그것도
 * `CAUSE_CELLS` 에서 뽑아낸 것이다), 여기는 그것을 **받아서** 쓴다.
 *
 * ── 🔴 「안 줌」과 「비움」 ──────────────────────────────────────────────
 * `body.findingsIntro` 는 **늘 보낸다.** 화면이 기본 문구를 미리 채워 두므로,
 * 사람이 그 칸을 지웠다는 것은 "이 문장을 넣지 마시오"라는 뜻이다. 그때 키를
 * 빼 버리면(=안 줌) 서버가 기본 문구를 되살려 **지운 문장이 문서에 찍혀 나간다.**
 * 그래서 빈 칸은 `""` 로 나간다.
 * ============================================================================
 */

/** 「발생 년월일」을 날짜로 적을지 글자로 적을지. 양식이 `―――` 를 적어 두었다. */
export type ServiceReportOccurredOnMode = "DATE" | "TEXT";

/**
 * 화면이 들고 있는 값 전부. **전부 문자열·불리언**이라 서버 컴포넌트에서
 * 클라이언트로 그대로 넘길 수 있다(직렬화되지 않는 값이 없다).
 *
 * 여러 줄 칸(`findings`·`actions`·`summary`·`remark`·`situationDetail`)은 줄
 * 목록이 아니라 `<textarea>` 의 글자 그대로 둔다 — 나누는 규칙은 보낼 때 한 번만
 * 적용한다(`serviceReportLines`).
 */
export type ServiceReportFormValues = {
  kind: ServiceReportKind;

  // ── 머리 ──
  customerName: string;
  /** "YYYY-MM-DD" */
  issuedOn: string;
  /** `No. [앞] - [중간] - [뒤]` — 양식이 세 칸이라 화면도 세 칸이다. */
  reportNumberPrefix: string;
  reportNumberMiddle: string;
  reportNumberTail: string;
  customer: string;
  /** "YYYY-MM-DD" */
  receivedOn: string;
  occurrencePlace: string;
  occurrencePlaceDetail: string;
  occurredOnMode: ServiceReportOccurredOnMode;
  /** "YYYY-MM-DD" */
  occurredOnDate: string;
  /** 날짜를 모를 때 적는 글자(양식의 견본은 `―――`). */
  occurredOnText: string;
  /** 양식의 드롭다운에서 고른 값. 앞 공백이 글머리표라 다듬지 않는다. */
  productName: string;
  productCategory: string;
  modelName: string;
  manufacturedYear: string;
  manufacturedMonth: string;
  lotNumber: string;
  serialNumber: string;
  usedYears: string;
  usedMonths: string;
  /** 양식의 드롭다운에서 고른 값. 다듬지 않는다. */
  situationRequest: string;
  situationDetail: string;

  // ── 조치·원인 ──
  onSiteRepair: boolean;
  replacementDelivery: boolean;
  /** 🔴 체크만 되어 있으면 날짜가 비어도 문서에는 체크가 찍힌다. */
  goodsReceiptChecked: boolean;
  goodsReceiptOn: string;
  goodsReceiptNumber: string;
  /** 🔴 수리 보고서에만. 검사로 바꾸면 보내지 않는다(서버가 거부한다). */
  completionChecked: boolean;
  completionOn: string;
  repairNumber: string;
  causes: readonly ServiceReportCause[];

  // ── 본문 ──
  findingsIntro: string;
  findings: string;
  actions: string;
  /** 🔴 수리 보고서에만. */
  summary: string;

  // ── 비고 ──
  remark: string;
};

/**
 * 줄 수의 상한. **서버 페이지가 상수에서 읽어 넘긴다** — 위 '이 파일은
 * 브라우저에서도 돈다' 참조.
 */
export type ServiceReportFormLimits = {
  /** `SERVICE_REPORT_MAX_BODY_ROWS` */
  maxBodyRows: number;
  /** `SERVICE_REPORT_MAX_REMARK_ROWS` */
  maxRemarkRows: number;
};

/**
 * 접수 건에서 옮겨 오는 값만 추린 모양. `ResolvedRepairCase` 를 통째로 받지
 * 않는 것은, 그 타입이 mock 자료를 끌고 오는 모듈에 살아서다(타입만 쓰면
 * 지워지지만, 무엇을 옮기는지 이 자리에서 보이는 편이 낫다).
 */
export type ServiceReportRepairCaseSeed = {
  customerName: string | null;
  modelName: string | null;
  lotNumber: string | null;
  serialNumber: string | null;
  /** "YYYY-MM-DD" 또는 그것으로 시작하는 글자. */
  receivedAt: string | null;
  /** 품명 둘째 줄(`H20`). */
  productCategory: string | null;
  /** 「상황」 아랫칸(`H23`). */
  reportedSymptom: string | null;
};

export type ServiceReportFormSeed = {
  repairCase?: ServiceReportRepairCaseSeed | null;
  /** 발행일의 기본값. "YYYY-MM-DD"(서버가 `toKstDateOnly(new Date())` 로 만든다). */
  today: string;
  /** `SERVICE_REPORT_FINDINGS_INTRO`. 미리 채워 두고 사람이 지울 수 있다. */
  findingsIntro: string;
  /**
   * 「품명」 드롭다운의 목록(`choices.productNames`). 형식에서 뽑은 값을 **이
   * 목록 안에서만** 고르므로, 목록을 못 읽었으면 빈 배열로 두면 된다 — 그러면
   * 아무것도 안 고른다(`serviceReportProductNameFromModel`).
   */
  productNames?: readonly string[];
  /** 처음 고를 종류. 기본은 수리다(현장에서 더 자주 쓴다). */
  kind?: ServiceReportKind;
};

/**
 * 원인 열 가지의 한글 이름. **서버 페이지가 채우개에서 읽어 넘긴다** —
 * `xlsx/service-report-template.ts` 의 `SERVICE_REPORT_CAUSE_LABELS`.
 *
 * `Record<ServiceReportCause, string>` 이라 코드가 하나라도 빠지거나 늘면 tsc 가
 * 잡는다.
 */
export type ServiceReportCauseLabels = Record<ServiceReportCause, string>;

/**
 * 체크박스를 그릴 순서대로. 양식의 배치(29·30행)와 같다 — 채우개가 그 순서로
 * 표를 만들고, 그 순서가 `SERVICE_REPORT_CAUSES` 와 같은지는 시험이 못 박는다.
 */
export function serviceReportCauseOptions(labels: ServiceReportCauseLabels): readonly {
  value: ServiceReportCause;
  label: string;
}[] {
  return (Object.keys(labels) as ServiceReportCause[]).map((value) => ({
    value,
    label: labels[value],
  }));
}

/**
 * 목록·상세 화면이 값이 없을 때 쓰는 표시 글자. 이것을 그대로 문서에 옮기면
 * 고객사로 나가는 보고서의 형식란에 `-` 가 찍힌다 — 빈 칸이 낫다
 * (`db/mappers/repair-case.ts` 의 `row.lotNumber ?? "-"`).
 */
const PLACEHOLDER_TEXT = "-";

function seedText(value: string | null | undefined): string {
  if (value === null || value === undefined) return "";
  const trimmed = value.trim();
  return trimmed === PLACEHOLDER_TEXT ? "" : value;
}

// ── 형식(모델명) → 품명 첫째 줄 ──────────────────────────────────────────

/**
 * 형식 앞 3글자가 정하는 **주파수**. 실제 등록된 형식 77개를 조사해 확인한
 * 규칙이다.
 *
 *   `RFK` RFG Source · `CFK` RFG Bias · `KFK` RFG Bias
 *   `MBK` MB  Source · `CMK` MB  Bias · `KMK` MB  Bias
 *
 * 이 표에 없는 앞글자(`T2CCONT-IC1`·`T2RCONT-AD1` 같은 T/C 계열, `TG-100`~
 * `TG-350`)는 형식만으로 주파수를 알 수 없다 — 그때는 아무것도 고르지 않는다.
 */
const MODEL_PREFIX_FREQUENCIES: Record<string, string> = {
  RFK: "13.56MHz",
  CFK: "4MHz",
  KFK: "3.39MHz",
  MBK: "13.56MHz",
  CMK: "4MHz",
  KMK: "3.39MHz",
};

/**
 * 앞 3글자 **바로 뒤의 숫자**가 정하는 **출력**.
 *
 * ⚠️ `600`(60kW)은 **양식의 품명 드롭다운에 없다.** 그래도 여기 적어 두는 것은
 * `MBK600M-IC1`·`CMK600M-IC2`·`KMK600M-AD1` 같은 형식이 실제로 있어서다 —
 * 목록에 없으면 아래에서 걸러져 빈 값이 되고, 양식에 60kW 가 생기는 날 저절로
 * 따라간다.
 */
const MODEL_NUMBER_POWERS: Record<string, string> = {
  "150": "15kW",
  "200": "20kW",
  "300": "30kW",
  "600": "60kW",
};

/** 표기의 사소한 차이(공백·대소문자)로 목록을 놓치지 않게. */
function normalizeProductName(value: string): string {
  return value.replace(/\s+/gu, "").toUpperCase();
}

/**
 * 형식(모델명)에서 「품명」 첫째 줄(`H19`)을 골라 준다.
 *
 * 예: `RFK300FH-AD1` → `13.56MHz 30kW`. 하이픈이 빠지거나 글자가 섞인 형식
 * (`CFK150FHIC1`·`RFK300FHJS1`·`CFK150JFH-IC1`)도 **앞 3글자와 뒤따르는
 * 숫자**만 보므로 그대로 맞는다.
 *
 * 🔴 **드롭다운 목록에 정확히 있는 값일 때만 고른다.** 없으면 손대지 않고 빈
 * 값을 돌려준다 — 사람이 드롭다운에서 고르면 된다. 잘못 채운 문서가 고객사로
 * 나가는 것보다 낫다. 60kW 형식, T/C 계열, `TG-…` 가 전부 이 길로 빠진다.
 *
 * 🔴 **목록 값을 코드에 베끼지 않는다.** 목록은 양식에서 읽혀 화면까지 props 로
 * 오고(`choices.productNames`), 이 함수는 그것을 **인자로 받아** 그 안에서
 * 고른다. 양식의 주파수·출력 표기가 바뀌어도 코드가 따라간다.
 */
export function serviceReportProductNameFromModel(
  modelName: string,
  productNames: readonly string[]
): string {
  const match = /^([A-Za-z]{3})(\d+)/.exec(modelName.trim());
  if (!match) return "";

  const frequency = MODEL_PREFIX_FREQUENCIES[match[1].toUpperCase()];
  const power = MODEL_NUMBER_POWERS[match[2]];
  if (frequency === undefined || power === undefined) return "";

  const wanted = normalizeProductName(`${frequency} ${power}`);
  // 고르는 값은 **목록에 있던 글자 그대로**다 — 우리가 만든 글자가 아니다.
  return productNames.find((name) => normalizeProductName(name) === wanted) ?? "";
}

// ── S/N → 제조년월 ───────────────────────────────────────────────────────

/**
 * S/N 에서 제조년월을 읽는다. 7자리일 때 `YYMMNNN` 이다 —
 * `1502021` = **2015년 2월**의 21번째 생산품.
 *
 * 🔴 **정확히 7자리 숫자이고 월이 01~12 일 때만** 읽는다. 아니면 `null` 이고,
 * 그때는 아무것도 채우지 않는다. 양식이 S/N 을 7자리로 보는 것
 * (`BC24 = IF(LEN(AO23)=7,"○","×")`)과 이 규칙은 **같은 뿌리**다 — 7자리가
 * 아닌 S/N 은 이 규칙이 통하는 번호가 아니라는 뜻이므로, 앞 넉 자를 억지로
 * 년월로 읽으면 없는 제조년월이 고객사로 나간다.
 */
export function serviceReportManufacturedFromSerialNumber(
  serialNumber: string
): { year: string; month: string } | null {
  const digits = serialNumber.trim();
  if (!/^\d{7}$/u.test(digits)) return null;

  const month = Number(digits.slice(2, 4));
  if (month < 1 || month > 12) return null;

  return { year: String(2000 + Number(digits.slice(0, 2))), month: String(month) };
}

/**
 * S/N 에서 읽은 제조년월을 **빈 칸에만** 채워 넣을 조각.
 *
 * 🔴 사람이 적어 둔 값은 덮지 않는다. S/N 규칙이 안 맞는 물건이 실제로 있고,
 * 그때 사람이 명판을 보고 적은 값이 옳다. 화면을 처음 열 때도, 사람이 S/N 칸을
 * 고쳤을 때도 같은 규칙으로 부른다.
 */
export function serviceReportManufacturedPatch(
  serialNumber: string,
  current: { manufacturedYear: string; manufacturedMonth: string }
): { manufacturedYear?: string; manufacturedMonth?: string } {
  const manufactured = serviceReportManufacturedFromSerialNumber(serialNumber);
  if (manufactured === null) return {};

  const patch: { manufacturedYear?: string; manufacturedMonth?: string } = {};
  if (current.manufacturedYear.trim() === "") patch.manufacturedYear = manufactured.year;
  if (current.manufacturedMonth.trim() === "") patch.manufacturedMonth = manufactured.month;
  return patch;
}

/** `"2026-09-02"` 도 `"2026-09-02T00:00:00.000Z"` 도 `<input type="date">` 가 받는 모양으로. */
function seedDate(value: string | null | undefined): string {
  if (!value) return "";
  const head = value.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(head) ? head : "";
}

/**
 * 빈 폼 + 접수 건 자료.
 *
 * 🔴 옮겨 넣은 값은 **초기값일 뿐 잠그지 않는다.** 접수 때 적은 모델명이 정정될
 * 수 있고, 문서에 적을 고객사 이름이 접수 건의 이름과 다를 수도 있다.
 */
export function createServiceReportFormValues(seed: ServiceReportFormSeed): ServiceReportFormValues {
  const repairCase = seed.repairCase ?? null;

  // 🔴 둘 다 **미리 골라 주는 것**이지 잠그는 것이 아니다. 규칙이 안 맞으면
  //    빈 칸으로 남고, 맞아도 사람이 고칠 수 있다.
  const modelName = seedText(repairCase?.modelName);
  const serialNumber = seedText(repairCase?.serialNumber);
  const manufactured = serviceReportManufacturedFromSerialNumber(serialNumber);

  return {
    kind: seed.kind ?? "REPAIR",

    customerName: seedText(repairCase?.customerName),
    issuedOn: seed.today,
    reportNumberPrefix: "",
    reportNumberMiddle: "",
    reportNumberTail: "",
    customer: "",
    receivedOn: seedDate(repairCase?.receivedAt),
    occurrencePlace: "",
    occurrencePlaceDetail: "",
    occurredOnMode: "DATE",
    occurredOnDate: "",
    occurredOnText: "",
    productName: serviceReportProductNameFromModel(modelName, seed.productNames ?? []),
    productCategory: seedText(repairCase?.productCategory),
    modelName,
    manufacturedYear: manufactured?.year ?? "",
    manufacturedMonth: manufactured?.month ?? "",
    lotNumber: seedText(repairCase?.lotNumber),
    serialNumber,
    usedYears: "",
    usedMonths: "",
    situationRequest: "",
    situationDetail: seedText(repairCase?.reportedSymptom),

    onSiteRepair: false,
    replacementDelivery: false,
    goodsReceiptChecked: false,
    goodsReceiptOn: "",
    goodsReceiptNumber: "",
    completionChecked: false,
    completionOn: "",
    repairNumber: "",
    causes: [],

    findingsIntro: seed.findingsIntro,
    findings: "",
    actions: "",
    summary: "",

    remark: "",
  };
}

/**
 * `<textarea>` 글자 → 줄 목록.
 *
 * 규칙은 둘이다:
 *
 *   · **가운데 빈 줄은 살린다.** 채우개가 "줄 사이를 띄우고 싶으면 빈 문자열을
 *     한 줄 넣는다"로 정해 두었다 — 사람이 Enter 를 두 번 친 것은 문서에서도
 *     한 줄 띄우라는 뜻이다.
 *   · **끝의 빈 줄만 버린다.** 마지막에 Enter 를 한 번 치는 것은 버릇이지 뜻이
 *     아니고, 그것까지 세면 300줄 상한이 눈에 안 보이는 이유로 깎인다.
 *
 * 줄 안의 공백은 다듬지 않는다 — 들여쓰기는 사람이 뜻을 담아 넣은 것이다
 * (`validation/service-report-input.ts` 의 '앞 공백을 다듬지 않는 칸이 있다').
 */
export function serviceReportLines(text: string): string[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  while (lines.length > 0 && lines[lines.length - 1].trim() === "") lines.pop();
  return lines;
}

/**
 * 본문이 문서에서 차지할 줄 수.
 *
 * 🔴 **검증 모듈과 같은 셈이어야 한다**(`service-report-input.ts` 의 `bodyRows`):
 * 확인내용 + 정형 문구 한 줄 + 조치 + 정리 + 맺음 표시(`～이　상～`) 한 줄.
 * 어긋나면 화면은 "아직 여유가 있다"고 말하는데 서버가 400 을 돌려준다.
 *
 * ⚠️ 이것은 **나누기 전의** 줄 수다. 한 줄이 칸의 가로폭을 넘으면 채우개가 다시
 * 나누므로 문서의 실제 줄 수는 더 클 수 있다. 마지막 방어선은 채우개다.
 */
export function countServiceReportBodyRows(values: ServiceReportFormValues): number {
  const findings = serviceReportLines(values.findings);
  const actions = serviceReportLines(values.actions);
  const summary = values.kind === "REPAIR" ? serviceReportLines(values.summary) : [];
  const introRows = findings.length === 0 || values.findingsIntro === "" ? 0 : 1;
  return findings.length + introRows + actions.length + summary.length + 1;
}

export function countServiceReportRemarkRows(values: ServiceReportFormValues): number {
  return serviceReportLines(values.remark).length;
}

/**
 * 보내기 전에 화면에서 막을 것들. 넘고 나서 400 을 받는 것보다 적는 동안 아는
 * 편이 낫다 — 남은 줄 수는 화면이 늘 보여 준다.
 */
export function serviceReportRowLimitErrors(
  values: ServiceReportFormValues,
  limits: ServiceReportFormLimits
): { body?: string; remark?: string } {
  const errors: { body?: string; remark?: string } = {};

  const bodyRows = countServiceReportBodyRows(values);
  if (bodyRows > limits.maxBodyRows) {
    errors.body = `본문이 ${bodyRows}줄입니다. 한 보고서에 ${limits.maxBodyRows}줄까지만 담을 수 있습니다. 줄을 줄이거나 보고서를 나눠 주세요.`;
  }

  const remarkRows = countServiceReportRemarkRows(values);
  if (remarkRows > limits.maxRemarkRows) {
    errors.remark = `비고는 ${limits.maxRemarkRows}줄까지만 적을 수 있습니다. 지금 ${remarkRows}줄입니다.`;
  }

  return errors;
}

/** 본문이 한 줄도 없으면 서버가 거부한다(맺음 표시만 남은 문서를 내보내지 않는다). */
export function isServiceReportBodyEmpty(values: ServiceReportFormValues): boolean {
  const summary = values.kind === "REPAIR" ? serviceReportLines(values.summary) : [];
  return (
    serviceReportLines(values.findings).length === 0 &&
    serviceReportLines(values.actions).length === 0 &&
    summary.length === 0
  );
}

/**
 * S/N 이 7자리가 아닐 때의 알림 — **막지 않는다.**
 *
 * 양식은 S/N 을 7자리로 보지만(`BC24`) 그 판정 칸은 인쇄 영역 밖이라 문서에는
 * 나오지 않는다. 7자리가 아닌 S/N 이 실제로 들어오는데 그걸로 발행을 막으면,
 * 사람은 없는 숫자를 지어내게 된다.
 */
export function serviceReportSerialNumberWarning(values: ServiceReportFormValues): string | null {
  const serialNumber = values.serialNumber.trim();
  if (serialNumber === "" || serialNumber.length === 7) return null;
  return `S/N 이 ${serialNumber.length}자리입니다. 양식은 7자리를 전제로 합니다 — 확인해 주세요(그대로 발행할 수 있습니다).`;
}

/**
 * 서버가 돌려준 `fieldErrors` 에서 한 칸의 말을 꺼낸다.
 *
 * 줄 목록 칸은 `body.findings.3` 처럼 **줄 번호가 붙은 키**로도 온다. 그 키를
 * 붙일 자리가 화면에 따로 없으므로(칸 하나에 여러 줄이 들어 있다) 그 칸의 말에
 * 함께 붙인다 — 안 그러면 오류가 있는데 화면 어디에도 안 보인다.
 */
export function serviceReportFieldError(
  fieldErrors: Record<string, string> | null | undefined,
  key: string
): string | null {
  if (!fieldErrors) return null;
  const prefix = `${key}.`;
  const messages = Object.entries(fieldErrors)
    .filter(([errorKey]) => errorKey === key || errorKey.startsWith(prefix))
    .map(([, message]) => message);
  return messages.length > 0 ? messages.join(" ") : null;
}

/**
 * 폼 값 → `POST /api/repair-cases/{id}/service-report/xlsx` 의 본문.
 *
 * 🔴 **검사 보고서에는 「정리」와 「조치 완료」 키를 아예 넣지 않는다.** 서버는
 * "키가 있는가"로 판정하므로(`hasSummary`·`hasCompletion`), 빈 배열이나 `null`
 * 을 보내면 "검사 보고서에는 정리 구역이 없습니다"로 거절당한다. 종류를 수리에서
 * 검사로 바꿔도 화면은 적어 둔 글을 지우지 않는다 — 다시 수리로 돌리면 그대로
 * 있어야 한다.
 *
 * 숫자 칸만 `trim()` 한다. `Number("  ")` 는 0 이라, 공백만 남은 칸을 그대로
 * 보내면 제조 년이 0 으로 찍힌다. 나머지 글자 칸은 서버가 다듬거나(짧은 칸)
 * 일부러 그대로 두므로(「상황」·본문) 여기서 손대지 않는다.
 */
export function buildServiceReportRequestBody(
  values: ServiceReportFormValues
): Record<string, unknown> {
  const findings = serviceReportLines(values.findings);
  const actions = serviceReportLines(values.actions);

  const body: Record<string, unknown> = {
    findings,
    // 🔴 늘 보낸다. 지운 칸은 `""` 로 나가야 정형 문구가 되살아나지 않는다.
    findingsIntro: values.findingsIntro,
    actions,
  };
  if (values.kind === "REPAIR") {
    body.summary = serviceReportLines(values.summary);
  }

  const disposition: Record<string, unknown> = {
    onSiteRepair: values.onSiteRepair,
    replacementDelivery: values.replacementDelivery,
  };
  if (values.goodsReceiptChecked) {
    // 🔴 빈 객체라도 보낸다 — "날짜는 모르지만 현품은 받았다"가 실제로 있다.
    disposition.goodsReceipt = {
      on: values.goodsReceiptOn,
      number: values.goodsReceiptNumber,
    };
  }
  if (values.kind === "REPAIR" && values.completionChecked) {
    disposition.completion = { on: values.completionOn };
  }

  return {
    kind: values.kind,
    customerName: values.customerName,
    issuedOn: values.issuedOn,
    reportNumber: {
      prefix: values.reportNumberPrefix,
      middle: values.reportNumberMiddle,
      tail: values.reportNumberTail,
    },
    customer: values.customer,
    receivedOn: values.receivedOn,
    occurrencePlace: values.occurrencePlace,
    occurrencePlaceDetail: values.occurrencePlaceDetail,
    occurredOn:
      values.occurredOnMode === "DATE" ? values.occurredOnDate : values.occurredOnText,
    productName: values.productName,
    productCategory: values.productCategory,
    modelName: values.modelName,
    manufacturedYear: values.manufacturedYear.trim(),
    manufacturedMonth: values.manufacturedMonth.trim(),
    lotNumber: values.lotNumber,
    serialNumber: values.serialNumber,
    usedYears: values.usedYears.trim(),
    usedMonths: values.usedMonths.trim(),
    situation: { request: values.situationRequest, detail: values.situationDetail },
    causes: [...values.causes],
    repairNumber: values.repairNumber,
    remark: serviceReportLines(values.remark),
    disposition,
    body,
  };
}
