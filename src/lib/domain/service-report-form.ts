import { productCategoryLabels, type WorkflowType } from "@/lib/domain/types";
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
 * ⚠️ `@/lib/domain/types` 는 **값으로 가져와도 된다.** 그 파일이 끌고 오는 것은
 * `date-only.ts` 하나뿐이고 그것도 순수 계산이라, 클라이언트 번들에 들어가도
 * 되는 도메인 상수다(화면 컴포넌트들이 이미 그것을 그대로 쓰고 있다).
 *
 * 그럼 상수는 어디서 오는가 — **서버 페이지가 넘겨준다**(`ServiceReportFormLimits`
 * 와 정형 문구 셋(`findingsIntro`·`actionsIntro`·`summaryIntro`), 드롭다운 목록,
 * 그리고 **원인 열 가지의 한글 이름**).
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
  /**
   * 본문 줄 수를 세는 데 드는 문서 쪽 상수들. 상한과 **같은 길로** 온다 —
   * `ServiceReportBodyRowLayout` 참조.
   */
  bodyLayout: ServiceReportBodyRowLayout;
};

/**
 * 본문이 문서에서 먹는 줄을 세는 데 필요한 **문서 쪽 상수들.**
 *
 * 전부 채우개(`xlsx/service-report-template.ts`)의 값이고, 여기서는
 * **받아서만** 쓴다 — 이 파일은 브라우저에서도 돌아서 그 모듈을 값으로 가져올
 * 수 없다(머리말의 '이 파일은 브라우저에서도 돈다'). 상한 300·4 를 여기 베끼지
 * 않는 것과 똑같은 이유다.
 *
 * 한 벌뿐이다: 서버는 `validation/service-report-input.ts` 의
 * `SERVICE_REPORT_BODY_ROW_LAYOUT` 을 쓰고, 화면은 서버 페이지가 그것을 props 로
 * 넘겨 준다.
 */
export type ServiceReportBodyRowLayout = {
  /** `SERVICE_REPORT_SECTION_GAP_ROWS` — 구역과 구역 **사이**의 빈 줄. */
  sectionGapRows: number;
  /** `SERVICE_REPORT_CLOSING_GAP_ROWS` — 맺음 표시 **위**의 여백. */
  closingGapRows: number;
  /** `SERVICE_REPORT_CLOSING_TRAILING_ROWS` — 맺음 표시 **아래**로 남는 줄. */
  closingTrailingRows: number;
  /**
   * `SERVICE_REPORT_BODY_LABELS` 의 구역별 라벨 줄 수.
   *
   * 🔴 「확인내용」 라벨만 두 줄(`확　내`/`인　용`)이라, 확인내용이 한 줄뿐이어도
   * 문서에서는 **두 줄**을 먹는다(채우개의 `sectionRowCount` — 라벨이 반쪽으로
   * 찍히지 않게 라벨 쪽이 이긴다).
   */
  labelRows: {
    findings: number;
    actions: number;
    summary: number;
  };
};

/**
 * 「조치」 첫 줄의 정형 문구 — **보고서 종류마다 하나씩.**
 *
 * 🔴 문장은 여기 없다. 채우개 옆의 `SERVICE_REPORT_ACTIONS_INTRO` 하나뿐이고
 * (`xlsx/service-report-template.ts`), 서버 페이지가 그것을 읽어 씨앗과 폼에
 * props 로 넘긴다 — 위 '이 파일은 브라우저에서도 돈다' 참조. 여기 베껴 두면 두
 * 벌이 되고, 문구가 바뀐 날 한쪽만 고쳐진다.
 *
 * `Record<ServiceReportKind, string>` 이라 종류가 늘면 tsc 가 빠진 칸을 잡는다.
 */
export type ServiceReportActionsIntro = Record<ServiceReportKind, string>;

/**
 * 접수 건에서 옮겨 오는 값만 추린 모양. `ResolvedRepairCase` 를 통째로 받지
 * 않는 것은, 그 타입이 mock 자료를 끌고 오는 모듈에 살아서다(타입만 쓰면
 * 지워지지만, 무엇을 옮기는지 이 자리에서 보이는 편이 낫다).
 *
 * ── 🔴 인수번호는 **여기 없다** ────────────────────────────────────────
 * 「현품 인수」 번호로 들어갈 값이지만 씨앗에 두지 않았다. 까닭이 둘이다:
 *
 *   · 이 씨앗은 **폼을 처음 만들 때만** 쓰인다
 *     (`createServiceReportFormValues`). 그런데 인수번호가 필요한 순간은
 *     «사람이 「현품 인수」를 체크할 때»라 폼이 이미 만들어진 뒤다. 저장된 장을
 *     열 때는 이 함수가 아예 불리지도 않는다(서버 페이지가
 *     `serviceReportFormValues` 로 저장값을 붓는다) — 씨앗에 넣으면 **저장된
 *     장에서는 자동 채움이 안 되는** 반쪽이 된다.
 *   · 담아 둘 자리도 없다. `ServiceReportFormValues` 는 저장·요청·임시보관에
 *     그대로 실려 나가는 모양이라, 문서에 안 쓰이는 칸을 하나 더하면 세 곳이
 *     함께 흔들린다.
 *
 * 그래서 인수번호는 **서버 페이지 → `ServiceReportForm` prop** 이라는 이미 있는
 * 길로 온다(그 prop 은 화면 위쪽 안내에 이미 쓰이고 있었다). 판정은 그래도
 * 화면이 아니라 여기 있다 — `serviceReportGoodsReceiptPatch`.
 */
export type ServiceReportRepairCaseSeed = {
  customerName: string | null;
  modelName: string | null;
  lotNumber: string | null;
  serialNumber: string | null;
  /** "YYYY-MM-DD" 또는 그것으로 시작하는 글자. */
  receivedAt: string | null;
  /**
   * 품명 둘째 줄(`H20`). 화면 표기(`productCategoryLabels` 의 「Generator」 …)가
   * 그대로 오고, 문서 표기로 옮기는 것은 이 파일이 한다
   * (`serviceReportProductCategoryText`).
   */
  productCategory: string | null;
  /** 「상황」 아랫칸(`H23`). */
  reportedSymptom: string | null;
  /**
   * 접수 건에 적혀 있는 **「보고서번호」**(`repair_cases.legacy_report_number`) —
   * 문서번호 **마지막 칸**의 초기값이다. 접수 폼과 접수 건 상세 상단 카드에서
   * 사람이 적는 그 값이다(`ReportNumberEditCell`).
   *
   * ⚠️ **없어도 된다.** 서버 페이지는 `ResolvedRepairCase` 를 통째로 넘기므로
   * 늘 들어 있지만, 씨앗을 손으로 짓는 자리(시험·형제 화면)에서는 이 칸이 없어도
   * 뜻이 통한다 — 안 준 것과 비어 있는 것이 같은 뜻이기 때문이다: 둘 다 **빈
   * 칸**이 된다(아래 `createServiceReportFormValues` 의 '지어내지 않는다').
   */
  legacyReportNumber?: string | null;
};

export type ServiceReportFormSeed = {
  repairCase?: ServiceReportRepairCaseSeed | null;
  /** 발행일의 기본값. "YYYY-MM-DD"(서버가 `toKstDateOnly(new Date())` 로 만든다). */
  today: string;
  /** `SERVICE_REPORT_FINDINGS_INTRO`. 미리 채워 두고 사람이 지울 수 있다. */
  findingsIntro: string;
  /**
   * `SERVICE_REPORT_ACTIONS_INTRO` — 「조치」 칸의 **첫 줄**로 미리 채운다.
   *
   * 🔴 `findingsIntro` 와 달리 **그냥 본문 글자**다. 서버에도 채우개에도 이런
   * 이름의 칸이 없고, 「안 줌」과 「비움」을 가를 것도 없다 — 사람이 지우면
   * 지워진 채로 나가고, 두 번 쓰고 싶으면 두 번 쓴다(실제 발행본이 그렇다).
   *
   * 🔴 **종류마다 다르다**(시제 — 검사는 앞으로 할 일, 수리는 이미 한 일). 한
   * 문장이 아니라 두 벌을 통째로 받는 까닭은, 화면 안에서 종류를 바꿀 때
   * **바뀌기 전 종류의 기본 문구**와 견줘야 하기 때문이다
   * (`serviceReportKindChangePatch`).
   */
  actionsIntro: ServiceReportActionsIntro;
  /**
   * `SERVICE_REPORT_SUMMARY_INTRO` — 「정리」 칸의 첫 줄.
   * ⚠️ **수리 보고서에만** 쓴다. 검사 보고서에는 「정리」 구역 자체가 없다.
   */
  summaryIntro: string;
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

// ── 접수 건의 제품 구분 → 품명 둘째 줄 ──────────────────────────────────

/**
 * 품명 둘째 줄(`H20`)에 적을 **문서 표기**. 화면에서 쓰는 영어 표기를 고객사로
 * 나가는 문서에서는 한글로 옮겨 적는다(**2026-09-02 사용자 결정**).
 *
 * ── 🔴 `productCategoryLabels` 를 고치지 않는다 ─────────────────────────
 * 그 표(`domain/types.ts`)의 값은 목록·필터·대시보드가 **그 글자 그대로 비교**해
 * 쓴다(`repair-case-filters.ts` · `my-active-work-filter.ts` 의 주석 참조). 거기서
 * 「Generator」를 「RF제너레이터」로 바꾸면 화면 여러 곳이 함께 바뀌고, 그것은
 * 이번 요청 밖의 변화다. 그래서 **옮겨 적는 표를 보고서 쪽에만** 둔다.
 *
 * ── 🔴 표의 열쇠는 워크플로 유형이다 ────────────────────────────────────
 * `Record<WorkflowType, …>` 이라 **제품 종류가 하나 늘면 tsc 가 여기를 잡는다**
 * (원인 라벨의 `Record<ServiceReportCause, string>` 과 같은 장치다). 영어 표기를
 * 열쇠로 삼으면 종류가 늘어도 아무도 모르는 채로 영어가 문서에 찍힌다.
 *
 * 영어 표기는 여기 **한 글자도 베끼지 않는다** — 아래 `PRODUCT_CATEGORY_TEXTS`
 * 가 `productCategoryLabels` 에서 짝을 지어 만든다. 그래서 화면 표기가 바뀌어도
 * 이 옮겨 적기가 따라간다(품명 첫째 줄이 목록을 인자로 받는 것과 같은 판단).
 *
 * ── 🔴 `Total Controller` 도 「RF제너레이터」다 — 베낀 것이 아니다 ───────
 * 제품 종류는 셋인데 문서 표기는 둘뿐이다. **셋 중 둘이 같은 글자로 가는 것은
 * 우연도 복사 실수도 아니라 사용자 결정이다(2026-09-02).** 「Total Controller 인데
 * 왜 제너레이터냐」 싶어도 **고치지 말 것** — 고객사로 나가는 문서에 그렇게 적기로
 * 정해진 것이다.
 *
 * ⚠️ 철자는 **`RF제너레이터`** 다. 양식의 견본에는 `RF제네레이터` 로 적혀 있지만,
 * 사용자가 적어 준 쪽(`제너`)을 쓴다(2026-09-02).
 */
const PRODUCT_CATEGORY_DOCUMENT_TEXTS: Record<WorkflowType, string> = {
  PAID_MATCHER: "M-BOX",
  WARRANTY_MATCHER: "M-BOX",
  PENDING_MATCHER: "M-BOX",
  PAID_GENERATOR: "RF제너레이터",
  WARRANTY_GENERATOR: "RF제너레이터",
  PENDING_GENERATOR: "RF제너레이터",
  // 🔴 제너레이터와 같은 글자다 — 위 주석 참조. 고치지 말 것.
  PAID_TOTAL_CONTROLLER: "RF제너레이터",
  WARRANTY_TOTAL_CONTROLLER: "RF제너레이터",
  PENDING_TOTAL_CONTROLLER: "RF제너레이터",
};

/**
 * 「화면 표기 → 문서 표기」. 위 표와 `productCategoryLabels` 를 짝지어 만든다 —
 * 영어 글자가 이 파일에 한 벌 더 생기지 않게. 두 표가 같은 열쇠(`WorkflowType`)를
 * 쓰므로 화면 표기가 바뀌어도 짝이 어긋나지 않는다.
 *
 * ⚠️ 여러 워크플로 유형이 같은 화면 표기를 나눠 쓴다(유상·무상·추후결정 셋이 다
 * 「Generator」다). 그래서 같은 열쇠가 세 번씩 들어온다 — 셋의 문서 표기가 같으면
 * 뒤엣것이 앞엣것을 **같은 값으로** 덮을 뿐이라 아무 일도 없지만, 서로 다르게
 * 적어 두면 조용히 한쪽이 이긴다. tsc 는 그것을 못 잡으므로 **시험이 잡는다**
 * (`service-report-form.test.ts` — 「같은 화면 표기는 같은 문서 표기로 간다」).
 */
const PRODUCT_CATEGORY_TEXTS = new Map<string, string>(
  (Object.keys(PRODUCT_CATEGORY_DOCUMENT_TEXTS) as WorkflowType[]).map((code) => [
    productCategoryLabels[code],
    PRODUCT_CATEGORY_DOCUMENT_TEXTS[code],
  ])
);

/**
 * 접수 건에서 온 제품 구분을 **문서에 적을 글자**로 옮긴다.
 *
 * 🔴 **모르는 글자는 그대로 돌려준다.** 옮길 짝이 없는 것(사람이 손으로 적어 둔
 * 글자, 매퍼가 라벨을 못 찾아 넣은 `-`, 옛 접수 자료에 남은 표기)을 여기서
 * 손대면, 화면에 보이던 글자가 문서에서 말없이 사라진다.
 *
 * 🔴 **새 폼을 만들 때만 지나간다.** 저장된 장을 열 때는 서버 페이지가 이 함수를
 * 부르지 않고 저장된 값을 그대로 붓는다(`serviceReportFormValues`) — 그래야 사람이
 * 고쳐 둔 표기가 다음에 열 때 되돌려지지 않는다.
 */
export function serviceReportProductCategoryText(productCategory: string): string {
  return PRODUCT_CATEGORY_TEXTS.get(productCategory) ?? productCategory;
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

// ── 「현품 인수」를 체크하면 날짜와 번호가 따라온다 ──────────────────────

/**
 * 「현품 인수」 체크를 켜고 끌 때 함께 얹을 조각.
 *
 * ── 🔴 근거는 양식에 있다 ──────────────────────────────────────────────
 * 「현품 인수」 날짜 칸(`AF27`)에는 원래 **접수일을 받아 오는 수식 `=AK14`** 이
 * 들어 있었다(`xlsx/service-report-template.ts` 의 `ServiceReportGoodsReceipt`).
 * `AK14` 는 접수일 칸이다. 즉 «현품 인수 날짜 = 접수일»은 우리가 지어낸 규칙이
 * 아니라 **양식을 만든 사람의 설계**다. 번호도 같은 줄의 짝(`AQ27`)이고, 그
 * 자리에 적히는 것은 그 접수 건의 **인수번호**다.
 *
 * ── 🔴 빈 칸에만 채운다 ────────────────────────────────────────────────
 * `serviceReportManufacturedPatch`·`serviceReportUsedPeriodPatch` 와 **같은
 * 규칙, 같은 뿌리**다 — 사람이 적어 둔 값을 말없이 덮지 않는다. 현품을 접수일과
 * 다른 날 받는 일이 실제로 있고(대품납입 뒤에 회수하는 건), 그때 사람이 적은
 * 날짜가 옳다.
 *
 * ── 🔴 체크를 풀었다 다시 체크하면? ────────────────────────────────────
 * **아무 일도 안 일어난다.** 체크를 풀 때 날짜·번호를 지우지 않기 때문이다
 * (아래 `checked === false` 갈래가 체크 상태만 바꾼다). 그래서 다시 체크할 때는
 * 칸이 이미 차 있고, 위의 「빈 칸에만」 규칙에 걸려 그대로 남는다.
 *
 * 그렇게 정한 까닭은 하나다 — **사람이 적어 둔 글을 말없이 버리지 않는다.**
 * 체크를 풀 때 지우는 길을 택하면, 실수로 한 번 껐다 켜는 것만으로 손으로 적은
 * 날짜가 사라지고 접수일이 대신 들어앉는다. 그 편이 «자동 채움이 다시 도는»
 * 것보다 훨씬 나쁘다. 자동 채움을 다시 받고 싶으면 칸을 비우고 다시 체크하면
 * 된다 — 그때는 빈 칸이므로 규칙대로 채워진다.
 *
 * ⚠️ 체크만 되어 있고 날짜가 비어도 문서에는 체크가 찍힌다(기존 동작). 그래서
 * 접수일이나 인수번호가 없으면 **아무것도 안 채우고 체크만 켠다** — "날짜는
 * 모르지만 현품은 받았다"가 실제로 있다(`buildServiceReportRequestBody`).
 *
 * 🔴 인수번호에도 `-` 규칙(`PLACEHOLDER_TEXT`)을 건다. 지금 접수 건 매퍼는
 * 인수번호에 `-` 를 넣지 않지만(`db/mappers/repair-case.ts` 는 `row.intakeNumber`
 * 를 그대로 쓴다), 목록 화면의 표시값이 이 길로 흘러들면 고객사로 나가는 문서의
 * 「현품 인수 No.」 에 `-` 가 찍힌다. 씨앗의 다른 칸들과 같은 문(`seedText`)을
 * 지나가게 두는 편이 싸고 안전하다.
 */
export function serviceReportGoodsReceiptPatch(
  checked: boolean,
  current: {
    /** 폼의 접수일 칸. 씨앗이 접수 건에서 옮겨 오지만 사람이 고칠 수 있다. */
    receivedOn: string;
    goodsReceiptOn: string;
    goodsReceiptNumber: string;
  },
  /** 그 접수 건의 인수번호. 없으면 빈 글자를 준다. */
  intakeNumber: string | null | undefined
): Partial<ServiceReportFormValues> {
  const patch: Partial<ServiceReportFormValues> = { goodsReceiptChecked: checked };
  // 체크를 풀 때는 손대지 않는다 — 위 '체크를 풀었다 다시 체크하면?' 참조.
  if (!checked) return patch;

  const receivedOn = current.receivedOn.trim();
  if (current.goodsReceiptOn.trim() === "" && receivedOn !== "") {
    patch.goodsReceiptOn = receivedOn;
  }

  const number = seedText(intakeNumber).trim();
  if (current.goodsReceiptNumber.trim() === "" && number !== "") {
    patch.goodsReceiptNumber = number;
  }

  return patch;
}

// ── 제조년월 + 접수일 → 사용 년수·개월 ──────────────────────────────────

/** 숫자만 든 칸을 수로. 공백만 남았거나 글자가 섞였으면 `null` 이다. */
function positiveInteger(value: string): number | null {
  const digits = value.trim();
  return /^\d+$/u.test(digits) ? Number(digits) : null;
}

/**
 * 「사용 년수 / 개월」 — 제조년월부터 **접수일**까지.
 *
 * ── 🔴 기준일이 접수일인 근거 ──────────────────────────────────────────
 * 양식 파일은 실제로 발행된 보고서의 사본이고, 그 값이 남아 있다:
 *
 *   `AK19`/`AP19` 제조 년월일 = 2021년 3월
 *   `AK14`        접수일      = 2024-03-21
 *   `AK25`/`AP25` 사용 년수   = 3 / `-`
 *
 * 2021년 3월에서 2024년 3월이 딱 3년이다. **발행일로 셌다면 3년이 아니었다** —
 * 그러니 이 기준을 발행일로 바꾸지 말 것.
 *
 * ── 날의 일(day)은 보지 않는다 ─────────────────────────────────────────
 * 제조는 년·월까지만 알고, 원본도 그렇게 셌다(2021-03 → 2024-03-21 을 3년 0개월).
 * 그래서 셈은 **달 수의 뺄셈**이다.
 *
 * ── 🔴 개월이 0이면 빈 값 ──────────────────────────────────────────────
 * 원본은 그 자리에 `-` 를 적었다. `0` 이라고 찍는 것보다 비워 두는 편이 발행본에
 * 가깝다(**2026-09-02 사용자 결정**).
 *
 * 셀 수 없으면 `null` 이다 — 제조년월이나 접수일이 없거나, 숫자가 아니거나,
 * **제조가 접수보다 미래**일 때. 마지막 것은 사용 기간이 아니라 자료가 틀린
 * 것이므로, 음수를 문서에 찍는 대신 아무것도 채우지 않는다.
 */
export function serviceReportUsedPeriod(
  manufactured: { year: string; month: string },
  receivedOn: string
): { years: string; months: string } | null {
  const year = positiveInteger(manufactured.year);
  const month = positiveInteger(manufactured.month);
  if (year === null || month === null || month < 1 || month > 12) return null;

  const received = /^(\d{4})-(\d{2})-\d{2}$/u.exec(receivedOn.trim());
  if (received === null) return null;
  const receivedMonth = Number(received[2]);
  if (receivedMonth < 1 || receivedMonth > 12) return null;

  const months = Number(received[1]) * 12 + receivedMonth - (year * 12 + month);
  if (months < 0) return null;

  const remainder = months % 12;
  return {
    years: String(Math.floor(months / 12)),
    // 🔴 0개월은 빈 칸이다 — 위 '개월이 0이면 빈 값' 참조.
    months: remainder === 0 ? "" : String(remainder),
  };
}

/**
 * 센 사용 기간을 **빈 칸에만** 채워 넣을 조각.
 *
 * 🔴 `serviceReportManufacturedPatch` 와 **같은 규칙**이다 — 사람이 적어 둔 값은
 * 덮지 않는다. 제조년월을 명판에서 고쳐 적었는데 사용 기간까지 덮이면, 사람은
 * 자기가 적은 값이 왜 사라졌는지 알 수 없다.
 *
 * 화면을 처음 열 때(`createServiceReportFormValues`)와, 사람이 **S/N · 제조 년 ·
 * 제조 월 · 접수일** 중 하나를 고쳤을 때 부른다. S/N 을 고치면 제조년월 조각을
 * 먼저 얹은 폼으로 이것을 불러 **한 번의 입력으로 두 단계가 이어진다**.
 */
export function serviceReportUsedPeriodPatch(current: {
  manufacturedYear: string;
  manufacturedMonth: string;
  receivedOn: string;
  usedYears: string;
  usedMonths: string;
}): { usedYears?: string; usedMonths?: string } {
  const period = serviceReportUsedPeriod(
    { year: current.manufacturedYear, month: current.manufacturedMonth },
    current.receivedOn
  );
  if (period === null) return {};

  const patch: { usedYears?: string; usedMonths?: string } = {};
  if (current.usedYears.trim() === "") patch.usedYears = period.years;
  if (current.usedMonths.trim() === "") patch.usedMonths = period.months;
  return patch;
}

/** `"2026-09-02"` 도 `"2026-09-02T00:00:00.000Z"` 도 `<input type="date">` 가 받는 모양으로. */
function seedDate(value: string | null | undefined): string {
  if (!value) return "";
  const head = value.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(head) ? head : "";
}

/**
 * 문서번호 앞 두 칸의 기본값 — `No. Z494 - P33A7 - [접수 건의 보고서번호]`.
 *
 * ── 🔴 검사든 수리든 **늘 같다** ───────────────────────────────────────
 * 종류에 따라 갈리지 않는다(**2026-09-03 사용자 확인**). 그래서
 * `Record<ServiceReportKind, …>` 가 아니라 값 하나다 — 다음 사람이 "종류별로
 * 갈라야 하나" 하고 다시 묻지 않도록 여기 적어 둔다.
 *
 * ── 마지막 칸은 여기 없다 ──────────────────────────────────────────────
 * 그 자리에는 **접수 건에 적혀 있는 「보고서번호」**가 온다
 * (`ServiceReportRepairCaseSeed.legacyReportNumber`). 건마다 다른 값이라 상수가
 * 될 수 없고, 접수 건에 안 적혀 있으면 **빈 채로 둔다** — 지어내지 않는다.
 *
 * 🔴 두 글자를 화면·시험에 흩어 적지 않는다. 한 자리에 두고 여기서만 읽는다
 * (정형 문구·상한을 한 벌로 두는 것과 같은 규칙 — 머리말 참조).
 */
const SERVICE_REPORT_NUMBER_DEFAULTS = {
  prefix: "Z494",
  middle: "P33A7",
} as const;

/**
 * 빈 폼 + 접수 건 자료.
 *
 * 🔴 옮겨 넣은 값은 **초기값일 뿐 잠그지 않는다.** 접수 때 적은 모델명이 정정될
 * 수 있고, 문서에 적을 고객사 이름이 접수 건의 이름과 다를 수도 있다. 문서번호
 * 세 칸도 마찬가지다 — **미리 채워 줄 뿐 읽기 전용이 아니다.**
 */
export function createServiceReportFormValues(seed: ServiceReportFormSeed): ServiceReportFormValues {
  const repairCase = seed.repairCase ?? null;

  // 🔴 둘 다 **미리 골라 주는 것**이지 잠그는 것이 아니다. 규칙이 안 맞으면
  //    빈 칸으로 남고, 맞아도 사람이 고칠 수 있다.
  const modelName = seedText(repairCase?.modelName);
  const serialNumber = seedText(repairCase?.serialNumber);
  const manufactured = serviceReportManufacturedFromSerialNumber(serialNumber);

  // 🔴 사슬의 셋째 고리다: S/N → 제조년월 → 사용 기간. 앞 고리가 끊기면
  //    (S/N 이 7자리가 아니거나 접수일이 없으면) 여기도 빈 칸으로 남는다.
  const receivedOn = seedDate(repairCase?.receivedAt);
  const used =
    manufactured === null ? null : serviceReportUsedPeriod(manufactured, receivedOn);

  const kind = seed.kind ?? "REPAIR";

  return {
    kind,

    customerName: seedText(repairCase?.customerName),
    issuedOn: seed.today,
    // 🔴 앞 두 칸은 종류와 상관없이 늘 같고, 마지막 칸은 접수 건이 준다 —
    //    위 `SERVICE_REPORT_NUMBER_DEFAULTS` 참조. 셋 다 사람이 고칠 수 있다.
    reportNumberPrefix: SERVICE_REPORT_NUMBER_DEFAULTS.prefix,
    reportNumberMiddle: SERVICE_REPORT_NUMBER_DEFAULTS.middle,
    // 🔴 접수 건에 안 적혀 있으면 빈 칸이다. 다른 씨앗 칸들과 같은 문을 지난다
    //    (`seedText` — 목록의 빈 값 표시 `-` 는 문서에 옮길 값이 아니다).
    reportNumberTail: seedText(repairCase?.legacyReportNumber).trim(),
    customer: "",
    receivedOn,
    occurrencePlace: "",
    occurrencePlaceDetail: "",
    occurredOnMode: "DATE",
    occurredOnDate: "",
    occurredOnText: "",
    productName: serviceReportProductNameFromModel(modelName, seed.productNames ?? []),
    // 🔴 `seedText` 를 먼저 지난다 — 빈 값 표시 `-` 는 옮겨 적을 것이 아니라
    //    문서에서 비워야 할 값이다(`PLACEHOLDER_TEXT`). 그다음 한글 표기로 옮긴다.
    productCategory: serviceReportProductCategoryText(seedText(repairCase?.productCategory)),
    modelName,
    manufacturedYear: manufactured?.year ?? "",
    manufacturedMonth: manufactured?.month ?? "",
    lotNumber: seedText(repairCase?.lotNumber),
    serialNumber,
    usedYears: used?.years ?? "",
    usedMonths: used?.months ?? "",
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
    /**
     * 🔴 정형 문구를 **본문의 첫 줄로** 미리 적어 둔다. 사람이 그 아래에 항목을
     * 이어 적고, 필요 없으면 지운다 — 여느 본문 글자와 똑같다.
     *
     * 🔴 **새 폼일 때만이다.** 저장된 장을 열 때는 이 함수를 부르지 않고
     * `serviceReportFormValues(saved.values, …)` 로 저장된 값을 그대로 붓는다
     * (서버 페이지 참조). 그래야 사람이 지운 문구가 되살아나지 않는다.
     */
    // 🔴 종류에 맞는 문구다 — 검사는 「…실시합니다.」, 수리는 「…실시하였습니다.」
    //    (시제. `SERVICE_REPORT_ACTIONS_INTRO` 참조).
    actions: seed.actionsIntro[kind],
    // ⚠️ 검사 보고서에는 「정리」 구역이 없다 — 그때는 미리 채우지 않는다.
    summary: kind === "REPAIR" ? seed.summaryIntro : "",

    remark: "",
  };
}

/**
 * 화면에서 **보고서 종류를 바꿀 때** 함께 얹을 조각.
 *
 * ── 🔴 손대지 않은 기본 문구만 따라 바꾼다 ─────────────────────────────
 * 조치 문구는 종류마다 시제가 다르다(검사 「…실시합니다.」 / 수리
 * 「…실시하였습니다.」). 그런데 화면 안에서 종류를 바꿀 수 있으므로, 이미 조치
 * 칸에 들어 있는 글을 어떻게 할지 정해야 한다:
 *
 *   · 칸의 내용이 **바뀌기 전 종류의 기본 문구 그대로**이면 → 새 종류의 것으로 바꾼다
 *   · 한 글자라도 다르면 → **그대로 둔다**
 *
 * 🔴 까닭은 이 화면의 규칙 하나다 — **사람이 적어 둔 글을 말없이 버리지
 * 않는다.** 제조년월·사용 기간을 「빈 칸에만 채운다」로 정한 것과 같은 뿌리다
 * (`serviceReportManufacturedPatch`). 손대지 않은 기본 문구는 잃을 것이 없으니
 * 바꿔 주는 편이 낫고, 한 글자라도 고쳤으면 그것은 사람의 글이다.
 *
 * ⚠️ **칸 전체를 견준다**(첫 줄만 보지 않는다). 첫 줄이 기본 문구인 채로 아래에
 * 사람이 항목을 이어 적은 것이 이 화면의 보통 모습인데, 첫 줄만 보고 갈아 끼우면
 * 그 아래 줄들과 시제가 어긋나거나 — 더 나쁘게는 — 통째로 덮을 길이 열린다.
 * 여기서는 «한 글자라도 다르면 사람의 글»이므로 그런 칸은 손대지 않는다.
 *
 * ⚠️ 「정리」는 건드리지 않는다. 그 구역은 수리 보고서에만 있고, 검사로 바꿔도
 * 적어 둔 글은 남는다 — 다시 수리로 돌렸을 때 그대로 있어야 한다
 * (`buildServiceReportRequestBody` 의 같은 판단).
 */
export function serviceReportKindChangePatch(
  values: ServiceReportFormValues,
  nextKind: ServiceReportKind,
  actionsIntro: ServiceReportActionsIntro
): Partial<ServiceReportFormValues> {
  const patch: Partial<ServiceReportFormValues> = { kind: nextKind };
  if (values.actions === actionsIntro[values.kind]) patch.actions = actionsIntro[nextKind];
  return patch;
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
 * 셈에 필요한 만큼만 좁힌 본문.
 *
 * 🔴 **화면과 서버가 같은 함수를 부를 수 있는 유일한 모양**이다. 화면은
 * `<textarea>` 의 글자를 들고 있고 서버는 이미 나뉜 줄 목록을 들고 있어서, 폼
 * 값(`ServiceReportFormValues`)을 받는 함수로는 서버가 쓸 수 없다.
 */
export type ServiceReportBodyLines = {
  findings: readonly string[];
  /**
   * 🔴 「안 줌(`undefined`)」과 「비움(`""`)」은 다른 뜻이다 — 안 주면 채우개가
   * 정형 문구를 넣으므로 **한 줄이 들고**, 비우면 안 든다
   * (`xlsx/service-report-template.ts` 의 `findingsLines`).
   */
  findingsIntro: string | undefined;
  actions: readonly string[];
  /** 「정리」는 수리 보고서에만 있다 — 검사 보고서에서는 빈 목록이다. */
  summary: readonly string[];
};

/**
 * 폼 값 → 셈에 쓸 줄 목록.
 *
 * ⚠️ 「정리」는 **수리 보고서일 때만** 센다. 검사로 바꿔도 화면은 적어 둔 글을
 * 지우지 않으므로(다시 수리로 돌렸을 때 그대로 있어야 한다) 값은 남아 있는데,
 * 그 글은 검사 보고서의 문서에 들어가지 않는다
 * (`buildServiceReportRequestBody` 의 같은 판단).
 */
export function serviceReportBodyLines(values: ServiceReportFormValues): ServiceReportBodyLines {
  return {
    findings: serviceReportLines(values.findings),
    findingsIntro: values.findingsIntro,
    actions: serviceReportLines(values.actions),
    summary: values.kind === "REPAIR" ? serviceReportLines(values.summary) : [],
  };
}

/**
 * 한 구역이 먹는 줄 수. 채우개의 `sectionRowCount` 를 그대로 옮긴 것이다 —
 * 줄이 없는 구역은 통째로 건너뛰므로 0이고, **라벨이 내용보다 길면 라벨이
 * 이긴다.**
 */
function sectionRowCount(lineCount: number, labelRows: number): number {
  return lineCount === 0 ? 0 : Math.max(lineCount, labelRows);
}

/**
 * 본문이 문서에서 차지할 줄 수.
 *
 * ── 🔴 이것은 여전히 **어림값**이다 ─────────────────────────────────────
 * 문서의 진짜 줄 수는 **양식 파일의 행 배치**에 달려 있다. 채우개의
 * `planBodyLayout` 은 구역마다 «양식이 정해 둔 시작 행»(`startRows`)과 그
 * 사이의 배정 칸수(`allotted`)를 읽어, 내용이 짧아도 다음 구역을 제자리에
 * 앉힌다. 그 값은 양식 파일 안에 있고 **파일은 서버에만 있다** — 브라우저에서는
 * 셀 수 없다.
 *
 * 그래서 여기 셈은 구역을 위에서부터 **붙여 쌓은** 모양이고, 채우개가 실제로
 * 쓰는 줄 수는 **늘 이 값보다 크거나 같다**(`startRow = max(startRows, cursor)`
 * 와 `rowCount = max(allotted, lines)` 둘 다 늘리기만 한다). 즉 이 함수는
 * **밑에서 받치는 값**이지 문서와 일치하는 값이 아니다.
 *
 * 🔴 그러니 나중에 이 자리를 보고 "채우개와 안 맞네, 버그다" 하며 맞추려 들지
 * 말 것. **일부러 어림값이고, 어림값을 진짜 값 쪽으로 당겨 둔 것**이다
 * (예전에는 구역 사이 빈 줄·맺음 표시 위아래 여백·두 줄짜리 라벨을 아예 세지
 * 않아, 화면이 "아직 여유가 있다"고 말하는데 내려받기가 실패했다).
 * 마지막 방어선은 여전히 채우개다.
 *
 * ⚠️ **나누기 전의** 줄 수이기도 하다. 한 줄이 칸의 가로폭을 넘으면 채우개가
 * 다시 나누므로 그쪽이 또 커진다.
 *
 * ── 셈 (전부 채우개에서 옮겨 온 것이다) ─────────────────────────────────
 *   구역별 줄 수                 `sectionRowCount`
 *     · 확인내용에는 정형 문구 한 줄이 포함된다   `findingsLines`
 *   + 구역 사이 빈 줄 × (내용이 있는 구역 수 - 1) `planBodyLayout` 의 `cursor`
 *     🔴 **마지막 구역 뒤에는 안 붙는다** — 그 뒤의 여백은 맺음 표시의 것이다.
 *   + 맺음 표시 위의 여백                          `closingRow`
 *   + 맺음 표시(`～이　상～`) 한 줄
 *   + 맺음 표시 아래로 남기는 줄                   `fillSheet` 의 `neededRows`
 *
 * 🔴 **검증 모듈이 이 함수를 그대로 가져다 쓴다**(`service-report-input.ts`).
 * 예전에는 같은 식을 두 벌로 들고 있었고, 그러면 한쪽만 고쳐지는 날 화면은
 * "여유가 있다"고 말하는데 서버가 400 을 돌려준다.
 */
export function countServiceReportBodyRows(
  body: ServiceReportBodyLines,
  layout: ServiceReportBodyRowLayout
): number {
  /**
   * 채우개의 `findingsLines` — 확인내용이 비면 정형 문구도 안 들어가고(구역이
   * 통째로 빈다), 머리글을 비우면 본문만 들어간다.
   */
  const findings =
    body.findings.length === 0
      ? 0
      : body.findings.length + (body.findingsIntro === "" ? 0 : 1);

  const sections = [
    sectionRowCount(findings, layout.labelRows.findings),
    sectionRowCount(body.actions.length, layout.labelRows.actions),
    sectionRowCount(body.summary.length, layout.labelRows.summary),
  ].filter((rows) => rows > 0);

  const content = sections.reduce((sum, rows) => sum + rows, 0);
  // 🔴 마지막으로 내용이 있는 구역 뒤에는 빈 줄이 없다(`planBodyLayout`).
  const gaps = layout.sectionGapRows * Math.max(0, sections.length - 1);

  return content + gaps + layout.closingGapRows + 1 + layout.closingTrailingRows;
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

  const bodyRows = countServiceReportBodyRows(serviceReportBodyLines(values), limits.bodyLayout);
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
  const body = serviceReportBodyLines(values);
  return body.findings.length === 0 && body.actions.length === 0 && body.summary.length === 0;
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
