import { DELEGATION_STORAGE_KEY, type LocalShipmentDelegation } from "./delegation-types";
import { buildSeedDelegations } from "./seed-data";
import { dedupeDelegations, validateDelegation } from "./validation";

const CHANGE_EVENT = "dss-as-delegation-storage-changed";

function isBrowser(): boolean {
  return typeof window !== "undefined";
}

export type DelegationStoreSnapshot = {
  delegations: LocalShipmentDelegation[];
  /** true면 저장된 데이터를 해석할 수 없어(손상/버전 불일치) 빈 상태로 표시 중임을 뜻한다. */
  isMalformed: boolean;
};

const EMPTY_SNAPSHOT: DelegationStoreSnapshot = { delegations: [], isMalformed: false };

let cachedRaw: string | null | undefined = undefined;
let cachedSnapshot: DelegationStoreSnapshot = EMPTY_SNAPSHOT;

function parseStructural(raw: string): { records: unknown[] } | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const envelope = parsed as Record<string, unknown>;
  if (envelope.version !== 1) return null;
  if (!Array.isArray(envelope.delegations)) return null;
  return { records: envelope.delegations };
}

export function getDelegationsSnapshot(): DelegationStoreSnapshot {
  if (!isBrowser()) return EMPTY_SNAPSHOT;

  const raw = window.localStorage.getItem(DELEGATION_STORAGE_KEY);
  if (raw === cachedRaw) return cachedSnapshot;

  if (raw === null) {
    // 완전히 처음 방문한 경우에만 시드를 만들어 쓴다. 빈 배열이 저장돼
    // 있거나(사용자가 지운 경우) 손상된 데이터가 있는 경우에는 절대
    // 재시드하지 않는다.
    const seeded = buildSeedDelegations();
    const envelope = { version: 1 as const, delegations: seeded };
    window.localStorage.setItem(DELEGATION_STORAGE_KEY, JSON.stringify(envelope));
    cachedRaw = JSON.stringify(envelope);
    cachedSnapshot = { delegations: seeded, isMalformed: false };
    return cachedSnapshot;
  }

  const structural = parseStructural(raw);
  if (!structural) {
    // 손상되었거나 버전을 지원하지 않는 데이터 — 덮어쓰지 않고 빈 결과만
    // 반환한다. UI가 이 isMalformed 플래그를 보고 한국어 경고를 보여준다.
    cachedRaw = raw;
    cachedSnapshot = { delegations: [], isMalformed: true };
    return cachedSnapshot;
  }

  const validated = structural.records
    .map((d) => validateDelegation(d))
    .filter((d): d is LocalShipmentDelegation => d !== null);
  const deduped = dedupeDelegations(validated);

  cachedRaw = raw;
  cachedSnapshot = { delegations: deduped, isMalformed: false };
  return cachedSnapshot;
}

export function getServerDelegationsSnapshot(): DelegationStoreSnapshot {
  return EMPTY_SNAPSHOT;
}

export function subscribeDelegations(onStoreChange: () => void): () => void {
  if (!isBrowser()) return () => {};
  window.addEventListener("storage", onStoreChange);
  window.addEventListener(CHANGE_EVENT, onStoreChange);
  return () => {
    window.removeEventListener("storage", onStoreChange);
    window.removeEventListener(CHANGE_EVENT, onStoreChange);
  };
}
