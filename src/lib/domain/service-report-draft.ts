import type { ServiceReportCause, ServiceReportKind } from "@/lib/xlsx/service-report-template";

import type {
  ServiceReportFormValues,
  ServiceReportOccurredOnMode,
} from "./service-report-form";

/**
 * ============================================================================
 * 검사·수리 보고서 — 적던 내용을 그 브라우저에 임시로 보관한다
 * ============================================================================
 * 사람이 본문에 열 줄 스무 줄 적어 둔 뒤 실수로 새로고침하면 통째로 날아간다.
 * 그래서 적는 대로 그 브라우저에 적어 두었다가 다시 들어오면 되살린다.
 *
 * ── 🔴 DB 저장이 생긴 뒤의 자리 (2026-09-02 재판단) ─────────────────────
 * 이제 보고서를 `service_reports` 에 저장한다. 그래서 이 임시보관은 **더 이상
 * 유일한 사본이 아니고**, 뜻이 하나로 좁혀졌다:
 *
 *     «아직 저장하지 못한 것» — 저장을 누르기 전, 저장이 실패한 뒤,
 *     저장하려다 창을 닫은 뒤에 남는 것.
 *
 * 그래서 **저장에 성공하면 그 장의 임시보관을 지운다**(화면이 그렇게 부른다 —
 * `ServiceReportForm.tsx` 의 같은 항목). 남겨 두면 다음에 열었을 때 저장된 값
 * 대신 그것이 되살아나, 사람은 «저장된 내용»을 보고 있다고 믿으면서 실제로는
 * 다른 글을 보게 된다. 반대로 저장 전에는 그대로 둔다 — 그때는 여전히 이것이
 * 유일한 사본이다.
 *
 * ⚠️ **내려받기는 저장이 아니다.** 파일을 뽑아 갔다고 지우지 않는다(그 판단은
 * 그대로다 — 뽑아 본 뒤 고칠 것을 발견하는 것이 이 화면의 보통 쓰임이다).
 *
 * 이 파일은 그 **판단과 모양**만 한다 — `window` 도 `localStorage` 도 여기
 * 들어오지 않고, 시계도 부르지 않는다(적어 둔 시각은 부르는 쪽이 넘긴다). 실물을
 * 두드리는 자리는 components/repair-cases/report/service-report/ServiceReportForm.tsx
 * 하나뿐이고, 그래서 아래 규칙들이 Node 단위 시험으로 그대로 돌아간다.
 *
 * ── 🔴 저장소는 손대는 것 자체가 던진다 ─────────────────────────────────
 * 사생활 보호 창이나 「사이트 데이터 차단」을 켠 브라우저에서는 `localStorage` 를
 * **꺼내 오는 것부터** 터진다. 렌더 도중에 던지면 그 화면이 통째로 죽는다 — 이
 * 저장소가 실제로 겪은 사고다(커밋 8454a2a, 목록 화면 26개). 그래서
 *
 *   · 저장소를 **모양(ServiceReportDraftStore)으로 받는다.** 실물을 직접 부르지
 *     않으므로 시험에서 던지는 저장소를 그대로 흉내 낼 수 있다
 *     (notification-toast.ts 의 SeenKeyStore, attachment-gallery-zoom.ts 의
 *     GalleryZoomStore 와 같은 장치다).
 *   · 읽기·적기·지우기 **어느 것도 던지지 않는다.** 적을 곳이 없다고 보고서를
 *     못 쓰게 되는 일은 없어야 한다.
 *
 * ── 🔴 적혀 있던 것을 그대로 믿지 않는다 ────────────────────────────────
 * 되살릴 때 칸 하나하나를 확인하고, 없거나 모양이 틀린 칸은 **지금 화면이 만든
 * 자동 채움 값**으로 떨어뜨린다. 두 가지를 막는 장치다:
 *
 *   1. 폼에 칸이 늘어나면 옛 임시보관에는 그 칸이 없다. `undefined` 가 그대로
 *      화면 상태로 들어가면 입력 칸이 통제 불능(uncontrolled)이 되어 React 가
 *      경고를 뱉고 값이 사라진다.
 *   2. 남이 개발자 도구로 넣어 둔 엉뚱한 값이 곧바로 화면의 상태가 되어서는 안
 *      된다(responsive-list 의 useStoredChoice 주석과 같은 규칙).
 * ============================================================================
 */

/**
 * `localStorage` 처럼 생긴 것. 위 머리 주석의 '저장소는 손대는 것 자체가 던진다'
 * 참조 — 실물을 직접 부르지 않는 이유가 거기 있다.
 *
 * 앞의 두 본보기와 달리 `removeItem` 이 함께 있다. 「새로 시작」 이 임시보관을
 * 지워야 하기 때문이다.
 */
export type ServiceReportDraftStore = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

/**
 * 새로 만드는 보고서가 쓰는 칸 이름. 저장된 장은 **자기 id** 가 칸 이름이다.
 *
 * 글자를 고른 것은 uuid 와 절대 겹치지 않기 위해서다 — 겹치면 「새로 만들기」와
 * 어떤 저장된 장이 같은 열쇠를 나눠 쓰게 된다.
 */
const NEW_SERVICE_REPORT_SLOT = "new";

/**
 * 적어 두는 열쇠.
 *
 * ── `v1` ────────────────────────────────────────────────────────────────
 * 나중에 적어 두는 모양이 바뀌었을 때 옛 값을 잘못 읽지 않기 위한 판 번호다 —
 * 그때는 v2 로 올리면 옛 값이 조용히 무시된다(notification-toast.ts 의 같은 규칙).
 *
 * 🔴 **칸이 하나 늘었다고 v2 로 올리지 않았다.** 판 번호를 올리면 옛 열쇠로 적힌
 * 임시보관이 **말없이 버려진다** — 적어 둔 글을 그렇게 버리지 않는다. 대신 아래
 * `serviceReportDraftStorageKeys` 가 옛 열쇠를 함께 본다.
 *
 * ── 사람마다 갈라 적는다 ────────────────────────────────────────────────
 * 사무실 공용 PC 를 여럿이 나눠 쓴다. 사람 id 가 열쇠에 없으면 앞사람이 적던
 * 보고서가 뒷사람 화면에 되살아난다 — 고객사로 나가는 문서에서 그것은 사고다.
 *
 * ── 접수 건마다 갈라 적는다 ─────────────────────────────────────────────
 * 한 사람이 여러 접수 건의 보고서를 동시에 붙들고 있는 일이 실제로 있다(탭을
 * 여럿 띄워 둔다). 접수 건 id 가 없으면 서로 덮어쓴다.
 *
 * ── 🔴 보고서 **장마다** 갈라 적는다 ────────────────────────────────────
 * 한 접수 건에 여러 장이 붙는다(검사 한 장 + 수리 한 장이 실제로 있다). 장을
 * 가르지 않으면 검사 보고서를 고치다 만 글이 수리 보고서를 열었을 때 되살아나,
 * **다른 장의 확인내용이 이 장에 찍힌 채 고객사로 나간다.**
 *
 * `serviceReportId` 가 `null` 이면 「아직 저장하지 않은 새 장」이다.
 */
export function serviceReportDraftStorageKey(
  userKey: string,
  repairCaseId: string,
  serviceReportId: string | null
): string {
  const slot = serviceReportId ?? NEW_SERVICE_REPORT_SLOT;
  return `dss.service-report.draft.v1.${userKey}.${repairCaseId}.${slot}`;
}

/**
 * 보고서가 한 장뿐이던 때의 열쇠 — 칸 이름이 없다.
 *
 * DB 저장이 생기기 전에는 한 접수 건에 임시보관이 하나뿐이었다. 그 열쇠로 적어
 * 둔 값이 실제 브라우저에 남아 있으므로, **읽을 때만** 함께 본다. 새로 적는 일은
 * 없다(아래 `serviceReportDraftStorageKeys` 가 언제나 새 열쇠를 맨 앞에 둔다).
 */
export function legacyServiceReportDraftStorageKey(
  userKey: string,
  repairCaseId: string
): string {
  return `dss.service-report.draft.v1.${userKey}.${repairCaseId}`;
}

/**
 * 읽고 지울 열쇠들. **맨 앞이 적는 열쇠**다.
 *
 * 🔴 옛 열쇠는 **새 장을 만들 때만** 함께 본다. 옛 임시보관은 「이 접수 건의
 * 보고서를 새로 적던 중」에 남은 것이지 어느 저장된 장의 것이 아니다 — 저장된
 * 장을 열 때 그것을 부어 넣으면 **남이 저장해 둔 보고서가 엉뚱한 글로 덮인다.**
 *
 * 지우기도 이 목록 전부를 지운다. 새 열쇠만 지우면 「새로 시작」을 누른 다음에도
 * 옛 열쇠에 남은 것이 그대로 되살아난다.
 */
export function serviceReportDraftStorageKeys(
  userKey: string,
  repairCaseId: string,
  serviceReportId: string | null
): readonly string[] {
  const key = serviceReportDraftStorageKey(userKey, repairCaseId, serviceReportId);
  return serviceReportId === null
    ? [key, legacyServiceReportDraftStorageKey(userKey, repairCaseId)]
    : [key];
}

/**
 * 되살린 임시보관 한 벌.
 *
 * `savedAt` 이 `null` 인 것은 **적어 둔 시각을 알 수 없다**는 뜻이다(손으로 고친
 * 값, 판이 어긋난 값). 그때도 값은 되살린다 — 지금은 이 임시보관이 **유일한
 * 사본**이라, 시각 한 줄을 못 읽었다고 사람이 적어 둔 글을 버릴 수는 없다.
 */
export type ServiceReportDraft = {
  values: ServiceReportFormValues;
  /** 적어 둔 시각(ISO 8601). 모르면 null. */
  savedAt: string | null;
};

/**
 * 글자를 치는 동안 얼마나 묶어서 적을 것인가 — **0.5초**.
 *
 * 글자마다 적으면 한 글자에 한 번씩 폼 전체를 JSON 으로 만들어 저장소를 때린다.
 * 본문이 수백 줄까지 가는 화면이라 그 한 번이 가볍지 않고, `localStorage` 쓰기는
 * 동기라 그대로 입력의 끊김으로 나타난다.
 *
 * 0.5초로 잡은 까닭:
 * - **손을 떼는 순간과 거의 같다.** 사람이 한 문장을 치고 다음 문장을 생각하는
 *   틈이 대개 그보다 길어서, 실제로는 문장마다 한 번씩 적히는 셈이 된다.
 * - **잃을 것이 적다.** 창이 갑자기 닫혀도 못 적은 것은 마지막 0.5초뿐이다.
 *   그보다 길게 잡으면(2~3초) 이 기능이 막으려던 사고가 다시 열린다.
 */
export const SERVICE_REPORT_DRAFT_SAVE_DEBOUNCE_MS = 500;

// ────────────────────────────────────────────────── 적혀 있던 것을 걸러 낸다

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pickText(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function pickFlag(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

/**
 * 정해진 값 중 하나일 때만 받는다.
 *
 * 🔴 인정하는 값을 `Record<T, true>` 로 적어 둔다 — 그냥 배열로 두면 종류가 하나
 * 늘어도 tsc 가 아무 말을 안 하고, 그때 새 종류가 조용히 기본값으로 떨어진다.
 */
function pickOneOf<T extends string>(value: unknown, allowed: Record<T, true>, fallback: T): T {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(allowed, value)
    ? (value as T)
    : fallback;
}

const SERVICE_REPORT_KINDS: Record<ServiceReportKind, true> = { REPAIR: true, INSPECTION: true };

const OCCURRED_ON_MODES: Record<ServiceReportOccurredOnMode, true> = { DATE: true, TEXT: true };

/**
 * 체크해 둔 원인.
 *
 * 🔴 **인정할 코드를 인자로 받는다.** 열 가지 목록을 여기 베껴 두면 양식에 원인이
 * 하나 늘어난 날 이 파일만 뒤처지고, 그 증상은 "체크가 조용히 풀린다"이다. 화면은
 * 그 목록을 이미 들고 있다(`causeLabels` — 채우개의 표에서 온다).
 *
 * 배열이 아니면 기본값으로 떨어지지만, **배열이면 걸러 낸 결과가 답이다.** 빈
 * 배열은 "아무것도 안 골랐다"라는 뜻이 있는 값이라 기본값으로 되돌리지 않는다.
 */
function pickCauses(
  value: unknown,
  causeCodes: readonly string[],
  fallback: readonly ServiceReportCause[]
): readonly ServiceReportCause[] {
  if (!Array.isArray(value)) return fallback;

  const allowed = new Set(causeCodes);
  const picked: ServiceReportCause[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string" || !allowed.has(item) || seen.has(item)) continue;
    seen.add(item);
    picked.push(item as ServiceReportCause);
  }
  return picked;
}

/**
 * 적혀 있던 것 + 지금 화면이 만든 자동 채움 값 → 화면에 그대로 넣을 폼 값.
 *
 * 🔴 **칸을 하나하나 적는다.** 통째로 `{ ...fallback, ...stored }` 로 덮으면
 * 저장소에 있던 엉뚱한 타입(숫자·객체·null)이 그대로 화면 상태가 되고, 옛
 * 임시보관에 없던 칸은 `undefined` 로 들어간다. 돌려주는 값이
 * `ServiceReportFormValues` 로 못 박혀 있어 **칸이 하나 늘면 tsc 가 여기를 잡는다**
 * — 그것이 이 지루한 나열의 값어치다.
 */
function mergeServiceReportDraftValues(
  stored: Record<string, unknown>,
  fallback: ServiceReportFormValues,
  causeCodes: readonly string[]
): ServiceReportFormValues {
  return {
    kind: pickOneOf(stored.kind, SERVICE_REPORT_KINDS, fallback.kind),

    customerName: pickText(stored.customerName, fallback.customerName),
    issuedOn: pickText(stored.issuedOn, fallback.issuedOn),
    reportNumberPrefix: pickText(stored.reportNumberPrefix, fallback.reportNumberPrefix),
    reportNumberMiddle: pickText(stored.reportNumberMiddle, fallback.reportNumberMiddle),
    reportNumberTail: pickText(stored.reportNumberTail, fallback.reportNumberTail),
    customer: pickText(stored.customer, fallback.customer),
    receivedOn: pickText(stored.receivedOn, fallback.receivedOn),
    occurrencePlace: pickText(stored.occurrencePlace, fallback.occurrencePlace),
    occurrencePlaceDetail: pickText(stored.occurrencePlaceDetail, fallback.occurrencePlaceDetail),
    occurredOnMode: pickOneOf(stored.occurredOnMode, OCCURRED_ON_MODES, fallback.occurredOnMode),
    occurredOnDate: pickText(stored.occurredOnDate, fallback.occurredOnDate),
    occurredOnText: pickText(stored.occurredOnText, fallback.occurredOnText),
    productName: pickText(stored.productName, fallback.productName),
    productCategory: pickText(stored.productCategory, fallback.productCategory),
    modelName: pickText(stored.modelName, fallback.modelName),
    manufacturedYear: pickText(stored.manufacturedYear, fallback.manufacturedYear),
    manufacturedMonth: pickText(stored.manufacturedMonth, fallback.manufacturedMonth),
    lotNumber: pickText(stored.lotNumber, fallback.lotNumber),
    serialNumber: pickText(stored.serialNumber, fallback.serialNumber),
    usedYears: pickText(stored.usedYears, fallback.usedYears),
    usedMonths: pickText(stored.usedMonths, fallback.usedMonths),
    situationRequest: pickText(stored.situationRequest, fallback.situationRequest),
    situationDetail: pickText(stored.situationDetail, fallback.situationDetail),

    onSiteRepair: pickFlag(stored.onSiteRepair, fallback.onSiteRepair),
    replacementDelivery: pickFlag(stored.replacementDelivery, fallback.replacementDelivery),
    goodsReceiptChecked: pickFlag(stored.goodsReceiptChecked, fallback.goodsReceiptChecked),
    goodsReceiptOn: pickText(stored.goodsReceiptOn, fallback.goodsReceiptOn),
    goodsReceiptNumber: pickText(stored.goodsReceiptNumber, fallback.goodsReceiptNumber),
    completionChecked: pickFlag(stored.completionChecked, fallback.completionChecked),
    completionOn: pickText(stored.completionOn, fallback.completionOn),
    repairNumber: pickText(stored.repairNumber, fallback.repairNumber),
    causes: pickCauses(stored.causes, causeCodes, fallback.causes),

    findingsIntro: pickText(stored.findingsIntro, fallback.findingsIntro),
    findings: pickText(stored.findings, fallback.findings),
    actions: pickText(stored.actions, fallback.actions),
    summary: pickText(stored.summary, fallback.summary),

    remark: pickText(stored.remark, fallback.remark),
  };
}

// ──────────────────────────────────────────────── 읽기 · 적기 · 지우기

/** 열쇠 하나를 읽어 본다. 되살릴 것이 없으면 `null`. */
function readOneDraft(
  store: ServiceReportDraftStore,
  storageKey: string,
  fallback: ServiceReportFormValues,
  causeCodes: readonly string[]
): ServiceReportDraft | null {
  let raw: string | null;
  try {
    raw = store.getItem(storageKey);
  } catch {
    return null;
  }
  if (raw === null || raw.trim() === "") return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;

  // 값이 없으면 되살릴 것이 없다. 시각만 있는 봉투는 임시보관이 아니다.
  if (!isRecord(parsed.values)) return null;

  return {
    values: mergeServiceReportDraftValues(parsed.values, fallback, causeCodes),
    savedAt: typeof parsed.savedAt === "string" ? parsed.savedAt : null,
  };
}

/**
 * 적어 둔 임시보관을 읽는다. **어떤 경우에도 던지지 않는다.**
 *
 * 되살릴 것이 없으면 `null` 이다 — 저장소가 없거나 막혀 있을 때, 적어 둔 적이
 * 없을 때, 적혀 있던 것이 깨졌을 때(JSON 이 아님·배열·숫자·`null`) 전부 같은
 * 답이다. 그때 화면은 지금까지처럼 자동 채움된 값으로 시작한다.
 *
 * 🔴 **열쇠를 여럿 받아 앞에서부터 본다**(`serviceReportDraftStorageKeys`). 뒤의
 * 것은 옛 열쇠라, 새 열쇠에 적어 둔 것이 있으면 그것이 이긴다 — 옛 값이 새 값을
 * 덮는 일은 없다.
 *
 * `fallback` 은 **지금 화면이 만든 자동 채움 값**이다. 없거나 모양이 틀린 칸이
 * 그리로 떨어진다 — 위 머리 주석의 '적혀 있던 것을 그대로 믿지 않는다' 참조.
 */
export function readServiceReportDraft(
  store: ServiceReportDraftStore | null,
  storageKeys: readonly string[],
  fallback: ServiceReportFormValues,
  causeCodes: readonly string[]
): ServiceReportDraft | null {
  if (!store) return null;

  for (const storageKey of storageKeys) {
    const draft = readOneDraft(store, storageKey, fallback, causeCodes);
    if (draft !== null) return draft;
  }
  return null;
}

/**
 * 적어 둔다. 읽기와 같은 이유로 **어떤 경우에도 던지지 않는다**(저장 공간이 꽉
 * 찬 경우 포함). 적어 두지 못하면 예전처럼 새로고침에 날아갈 뿐이다 — 적을 곳이
 * 없다고 보고서를 못 쓰게 되는 쪽이 훨씬 나쁘다.
 *
 * 🔴 지금 시각을 **인자로 받는다.** 안에서 `new Date()` 를 부르면 이 파일이
 * 시계에 매여 시험할 수 없다(notification-toast.ts 의 `now` 와 같은 규칙).
 */
export function writeServiceReportDraft(
  store: ServiceReportDraftStore | null,
  storageKey: string,
  values: ServiceReportFormValues,
  savedAt: string
): void {
  if (!store) return;
  try {
    store.setItem(storageKey, JSON.stringify({ savedAt, values }));
  } catch {
    // 위 주석 참조 — 못 적은 대가는 다음에 열 때 자동 채움 값으로 시작하는 것뿐이다.
  }
}

/**
 * 지운다(「새로 시작」, 그리고 **저장에 성공한 뒤**). 읽기·적기와 같은 이유로
 * **던지지 않는다.**
 *
 * 🔴 **받은 열쇠를 전부** 지운다. 새 열쇠만 지우면 옛 열쇠에 남은 것이 다음에
 * 열 때 되살아나, 「새로 시작」을 누른 사람이 버린 글을 다시 보게 된다.
 */
export function clearServiceReportDraft(
  store: ServiceReportDraftStore | null,
  storageKeys: readonly string[]
): void {
  if (!store) return;
  for (const storageKey of storageKeys) {
    try {
      store.removeItem(storageKey);
    } catch {
      // 지우지 못했으면 다음에 열 때 또 되살아난다. 「새로 시작」을 한 번 더
      // 누르면 될 일이라, 화면을 죽이면서까지 알릴 값어치는 없다.
    }
  }
}

// ─────────────────────────────────────────────────── 언제 적어 둔 것인가

/**
 * 시각을 KST 로 못 박아 만든다.
 *
 * `toLocaleString()` 을 그냥 쓰면 브라우저 언어 설정에 따라 모양이 제각각이고
 * (`9/2/2026, 2:33 PM`), 기기 시간대가 KST 가 아니면 다른 시각이 찍힌다.
 * date-only.ts 가 KST 로 못 박은 것과 같은 판단이다.
 */
const KST_DATE_TIME_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/**
 * 보고서 화면이 시각을 적는 단 하나의 모양 — `2026-09-02 14:33`.
 *
 * 읽을 수 없으면 `null` 이다(모르는 시각을 지어내지 않는다). 그때 부르는 쪽은
 * 시각 없이 말한다.
 *
 * 🔴 조각을 뽑아 직접 이어 붙인다. `format()` 의 결과 문자열은 같은 로케일이라도
 * ICU 판에 따라 구분자가 달라진다(`2026-09-02, 14:33` / `2026-09-02 14:33`).
 *
 * 임시보관 안내와 **저장된 보고서 목록의 「마지막 수정」이 같은 함수를 쓴다** —
 * 두 곳이 각자 Intl 을 만들면 한쪽만 고쳐지는 날 같은 화면 안에서 시각 모양이
 * 서로 달라진다.
 */
export function formatServiceReportKstDateTime(at: Date): string | null {
  if (Number.isNaN(at.getTime())) return null;

  const parts = KST_DATE_TIME_FORMATTER.formatToParts(at);
  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((candidate) => candidate.type === type)?.value ?? "";

  const pieces = [part("year"), part("month"), part("day"), part("hour"), part("minute")];
  // 조각이 하나라도 비면 반쪽짜리 시각(`2026-- 14:`)을 적느니 아무것도 안 적는다.
  if (pieces.some((piece) => piece === "")) return null;

  return `${pieces[0]}-${pieces[1]}-${pieces[2]} ${pieces[3]}:${pieces[4]}`;
}

/**
 * 임시보관 안내에 적을 시각. ISO 8601 글자를 받는다 — 적어 둔 봉투에 그 모양으로
 * 들어 있다.
 *
 * 읽을 수 없으면 `null` 이다. 그때 안내는 시각 없이 "되살렸습니다"만 말한다.
 */
export function formatServiceReportDraftSavedAt(savedAt: string | null): string | null {
  if (savedAt === null) return null;
  return formatServiceReportKstDateTime(new Date(savedAt));
}
