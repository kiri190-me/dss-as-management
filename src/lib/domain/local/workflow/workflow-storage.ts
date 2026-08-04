import { LOCAL_WORKFLOW_STORAGE_KEY, type LocalWorkflowEvent, type LocalWorkflowState } from "./workflow-types";
import {
  dedupeWorkflowEvents,
  dedupeWorkflowStates,
  validateWorkflowEvent,
  validateWorkflowState,
} from "./validation";

const CHANGE_EVENT = "dss-as-workflow-storage-changed";

function isBrowser(): boolean {
  return typeof window !== "undefined";
}

export type WorkflowStoreSnapshot = {
  states: LocalWorkflowState[];
  events: LocalWorkflowEvent[];
  isMalformed: boolean;
};

const EMPTY_SNAPSHOT: WorkflowStoreSnapshot = { states: [], events: [], isMalformed: false };

let cachedRaw: string | null | undefined = undefined;
let cachedSnapshot: WorkflowStoreSnapshot = EMPTY_SNAPSHOT;

function parseStructural(raw: string): { states: unknown[]; events: unknown[] } | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const envelope = parsed as Record<string, unknown>;
  if (envelope.version !== 1) return null;
  if (!Array.isArray(envelope.states) || !Array.isArray(envelope.events)) return null;
  return { states: envelope.states, events: envelope.events };
}

function validateEnvelope(states: unknown[], events: unknown[]): WorkflowStoreSnapshot {
  const validatedStates = states.map((s) => validateWorkflowState(s)).filter((s): s is LocalWorkflowState => s !== null);
  const dedupedStates = dedupeWorkflowStates(validatedStates);
  const statesById = new Map(dedupedStates.map((s) => [s.id, s]));

  const validatedEvents = events
    .map((e) => validateWorkflowEvent(e, { statesById }))
    .filter((e): e is LocalWorkflowEvent => e !== null);
  const dedupedEvents = dedupeWorkflowEvents(validatedEvents);

  return { states: dedupedStates, events: dedupedEvents, isMalformed: false };
}

/**
 * D-2/D-1과 달리 이 스토어는 절대 시드를 생성하지 않는다 — 키가 없는 것이
 * 곧 "모든 접수 건이 아직 로컬 재정의 없음"이라는 유효한 초기 상태다.
 * 키가 있지만 파싱/버전이 어긋나면 malformed로만 처리하고 절대 덮어쓰지
 * 않는다(D-2 attachment-storage.ts와 동일한 원칙).
 */
export function getWorkflowStoreSnapshot(): WorkflowStoreSnapshot {
  if (!isBrowser()) return EMPTY_SNAPSHOT;

  const raw = window.localStorage.getItem(LOCAL_WORKFLOW_STORAGE_KEY);
  if (raw === cachedRaw) return cachedSnapshot;

  if (raw === null) {
    cachedRaw = raw;
    cachedSnapshot = EMPTY_SNAPSHOT;
    return cachedSnapshot;
  }

  const structural = parseStructural(raw);
  if (!structural) {
    cachedRaw = raw;
    cachedSnapshot = { states: [], events: [], isMalformed: true };
    return cachedSnapshot;
  }

  cachedRaw = raw;
  cachedSnapshot = validateEnvelope(structural.states, structural.events);
  return cachedSnapshot;
}

export function getServerWorkflowStoreSnapshot(): WorkflowStoreSnapshot {
  return EMPTY_SNAPSHOT;
}

export function subscribeWorkflowStore(onStoreChange: () => void): () => void {
  if (!isBrowser()) return () => {};
  window.addEventListener("storage", onStoreChange);
  window.addEventListener(CHANGE_EVENT, onStoreChange);
  return () => {
    window.removeEventListener("storage", onStoreChange);
    window.removeEventListener(CHANGE_EVENT, onStoreChange);
  };
}

export function writeWorkflowEnvelope(states: LocalWorkflowState[], events: LocalWorkflowEvent[]): void {
  const envelope = { version: 1 as const, states, events };
  window.localStorage.setItem(LOCAL_WORKFLOW_STORAGE_KEY, JSON.stringify(envelope));
  cachedRaw = undefined;
  window.dispatchEvent(new Event(CHANGE_EVENT));
}
