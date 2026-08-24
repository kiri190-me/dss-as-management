import { mockRepairCases } from "../mock-data";
import { dedupeLocalRepairCases, validateLocalRepairCase } from "./validation";
import { LOCAL_CASE_STORAGE_KEY, type LocalRepairCase } from "./local-types";

// 같은 탭 안의 쓰기는 storage 이벤트를 발생시키지 않기 때문에 함께 듣던
// 커스텀 이벤트다. 이 저장소에 쓰던 경로(로컬 데모 접수)가 사라져 지금은
// 발생시키는 쪽이 없지만, 구독은 그대로 둔다 — 읽기 경로의 동작을 바꾸지
// 않기 위해서다.
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
