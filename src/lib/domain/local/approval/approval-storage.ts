import {
  APPROVAL_STORAGE_KEY,
  type LocalApprovalEvent,
  type LocalApprovalRecord,
} from "./approval-types";
import { getDelegationsSnapshot } from "./delegation-storage";
import { buildSeedApprovalEnvelope } from "./seed-data";
import {
  dedupeApprovalEvents,
  dedupeApprovalRecords,
  validateApprovalEvent,
  validateApprovalRecord,
} from "./validation";

const CHANGE_EVENT = "dss-as-approval-storage-changed";

function isBrowser(): boolean {
  return typeof window !== "undefined";
}

export type ApprovalStoreSnapshot = {
  records: LocalApprovalRecord[];
  events: LocalApprovalEvent[];
  isMalformed: boolean;
};

const EMPTY_SNAPSHOT: ApprovalStoreSnapshot = { records: [], events: [], isMalformed: false };

let cachedRaw: string | null | undefined = undefined;
let cachedSnapshot: ApprovalStoreSnapshot = EMPTY_SNAPSHOT;

function parseStructural(raw: string): { records: unknown[]; events: unknown[] } | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const envelope = parsed as Record<string, unknown>;
  if (envelope.version !== 1) return null;
  if (!Array.isArray(envelope.records) || !Array.isArray(envelope.events)) return null;
  return { records: envelope.records, events: envelope.events };
}

/**
 * records/events를 함께 검증한다. 이벤트 검증은 반드시 "이미 검증을 통과한
 * 레코드 목록"과 "이미 검증을 통과한 위임 ID 목록"을 기준으로 수행한다.
 */
function validateEnvelope(records: unknown[], events: unknown[]): ApprovalStoreSnapshot {
  const { delegations } = getDelegationsSnapshot();
  const validDelegationIds = new Set(delegations.map((d) => d.id));

  const validatedRecords = records
    .map((r) => validateApprovalRecord(r, { validDelegationIds }))
    .filter((r): r is LocalApprovalRecord => r !== null);
  const dedupedRecords = dedupeApprovalRecords(validatedRecords);
  const recordsById = new Map(dedupedRecords.map((r) => [r.id, r]));

  const validatedEvents = events
    .map((e) => validateApprovalEvent(e, { recordsById, validDelegationIds }))
    .filter((e): e is LocalApprovalEvent => e !== null);
  const dedupedEvents = dedupeApprovalEvents(validatedEvents);

  return { records: dedupedRecords, events: dedupedEvents, isMalformed: false };
}

export function getApprovalStoreSnapshot(): ApprovalStoreSnapshot {
  if (!isBrowser()) return EMPTY_SNAPSHOT;

  const raw = window.localStorage.getItem(APPROVAL_STORAGE_KEY);
  if (raw === cachedRaw) return cachedSnapshot;

  if (raw === null) {
    const seeded = buildSeedApprovalEnvelope();
    const envelope = { version: 1 as const, records: seeded.records, events: seeded.events };
    window.localStorage.setItem(APPROVAL_STORAGE_KEY, JSON.stringify(envelope));
    cachedRaw = JSON.stringify(envelope);
    cachedSnapshot = { records: seeded.records, events: seeded.events, isMalformed: false };
    return cachedSnapshot;
  }

  const structural = parseStructural(raw);
  if (!structural) {
    cachedRaw = raw;
    cachedSnapshot = { records: [], events: [], isMalformed: true };
    return cachedSnapshot;
  }

  cachedRaw = raw;
  cachedSnapshot = validateEnvelope(structural.records, structural.events);
  return cachedSnapshot;
}

export function getServerApprovalStoreSnapshot(): ApprovalStoreSnapshot {
  return EMPTY_SNAPSHOT;
}

export function subscribeApprovalStore(onStoreChange: () => void): () => void {
  if (!isBrowser()) return () => {};
  window.addEventListener("storage", onStoreChange);
  window.addEventListener(CHANGE_EVENT, onStoreChange);
  return () => {
    window.removeEventListener("storage", onStoreChange);
    window.removeEventListener(CHANGE_EVENT, onStoreChange);
  };
}

/**
 * records와 events를 하나의 setItem 호출로 함께 쓴다(원자성 확보). 같은 탭의
 * 구독자에게는 커스텀 이벤트로, 다른 탭에는 표준 storage 이벤트로 알린다.
 */
export function writeApprovalEnvelope(records: LocalApprovalRecord[], events: LocalApprovalEvent[]): void {
  const envelope = { version: 1 as const, records, events };
  window.localStorage.setItem(APPROVAL_STORAGE_KEY, JSON.stringify(envelope));
  cachedRaw = undefined;
  window.dispatchEvent(new Event(CHANGE_EVENT));
}
