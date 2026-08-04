import { mockRepairCases } from "../mock-data";
import { dedupeLocalRepairCases, validateLocalRepairCase } from "./validation";
import { LOCAL_CASE_STORAGE_KEY, type LocalCaseEnvelope, type LocalRepairCase } from "./local-types";

const CHANGE_EVENT = "dss-as-local-case-storage-changed";

function isBrowser(): boolean {
  return typeof window !== "undefined";
}

function getMockIntakeNumbers(): Set<string> {
  return new Set(mockRepairCases.map((c) => c.intakeNumber));
}

/**
 * localStorage 원문을 안전하게 파싱한다. JSON 파싱 실패, version !== 1,
 * cases가 배열이 아닌 경우 모두 "읽을 수 없는 데이터"로 취급하고 빈 배열로
 * 대체한다(애플리케이션을 절대 크래시시키지 않는다).
 */
function parseEnvelope(raw: string | null): unknown[] {
  if (raw === null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (typeof parsed !== "object" || parsed === null) return [];
  const envelope = parsed as Record<string, unknown>;
  if (envelope.version !== 1) return [];
  if (!Array.isArray(envelope.cases)) return [];
  return envelope.cases;
}

let cachedRaw: string | null | undefined = undefined;
let cachedCases: LocalRepairCase[] = [];

/**
 * 검증 + 역직렬화된 로컬 접수 목록을 반환한다. useSyncExternalStore의
 * getSnapshot으로 사용되므로, 원문 문자열이 바뀌지 않았다면 동일한 배열
 * 참조를 반환해 불필요한 리렌더를 막는다.
 */
export function getLocalCasesSnapshot(): LocalRepairCase[] {
  if (!isBrowser()) return cachedCases;

  const raw = window.localStorage.getItem(LOCAL_CASE_STORAGE_KEY);
  if (raw === cachedRaw) {
    return cachedCases;
  }

  const rawRecords = parseEnvelope(raw);
  const validated = rawRecords
    .map((record) => validateLocalRepairCase(record))
    .filter((c): c is LocalRepairCase => c !== null);
  const deduped = dedupeLocalRepairCases(validated, getMockIntakeNumbers());

  cachedRaw = raw;
  cachedCases = deduped;
  return cachedCases;
}

// useSyncExternalStore는 getServerSnapshot이 매번 동일한(참조 동등) 값을
// 반환하기를 요구한다 — 호출마다 새 배열을 만들면 "should be cached to avoid
// an infinite loop" 경고와 함께 불필요한 재계산이 발생한다.
const EMPTY_SERVER_CASES: LocalRepairCase[] = [];

export function getServerCasesSnapshot(): LocalRepairCase[] {
  return EMPTY_SERVER_CASES;
}

export function subscribeLocalCases(onStoreChange: () => void): () => void {
  if (!isBrowser()) return () => {};
  window.addEventListener("storage", onStoreChange);
  window.addEventListener(CHANGE_EVENT, onStoreChange);
  return () => {
    window.removeEventListener("storage", onStoreChange);
    window.removeEventListener(CHANGE_EVENT, onStoreChange);
  };
}

function notifyChange() {
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/**
 * 검증을 통과한 최신 로컬 접수 목록을 그대로 덮어쓴다. 쓰기 직후 캐시를
 * 무효화하고 구독자에게 알린다(같은 탭 내 변경은 storage 이벤트가 발생하지
 * 않으므로 커스텀 이벤트를 함께 사용한다).
 */
function writeLocalCases(cases: LocalRepairCase[]): void {
  const envelope: LocalCaseEnvelope = { version: 1, cases };
  window.localStorage.setItem(LOCAL_CASE_STORAGE_KEY, JSON.stringify(envelope));
  cachedRaw = undefined;
  notifyChange();
}

export type AppendLocalCaseResult =
  | { ok: true; cases: LocalRepairCase[] }
  | { ok: false; reason: "DUPLICATE_ID" | "DUPLICATE_INTAKE_NUMBER" };

/**
 * 최신 localStorage 상태를 다시 읽은 뒤(re-read) 새 레코드를 추가한다.
 * 추가 직전에 다시 한번 ID/인수번호 중복을 확인한다 — 동시성 안전을
 * 완전히 보장하지는 못하지만(같은 브라우저의 여러 탭이 동시에 쓰는 경우
 * 경쟁 상태가 이론적으로 남는다), 쓰기 시점 기준 최신 데이터로 재검증한다.
 * 실제 운영에서는 이 채번/중복확인/저장 절차가 DB 트랜잭션으로 수행되어야 한다.
 */
export function appendLocalCase(newCase: LocalRepairCase): AppendLocalCaseResult {
  const current = getLocalCasesSnapshot();
  if (current.some((c) => c.id === newCase.id)) {
    return { ok: false, reason: "DUPLICATE_ID" };
  }
  if (
    current.some((c) => c.intakeNumber === newCase.intakeNumber) ||
    getMockIntakeNumbers().has(newCase.intakeNumber)
  ) {
    return { ok: false, reason: "DUPLICATE_INTAKE_NUMBER" };
  }
  const next = [...current, newCase];
  writeLocalCases(next);
  return { ok: true, cases: next };
}
