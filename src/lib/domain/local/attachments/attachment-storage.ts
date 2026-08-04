import { LOCAL_ATTACHMENT_STORAGE_KEY, type LocalAttachmentEvent, type LocalAttachmentMetadata } from "./attachment-types";
import { buildSeedAttachmentEnvelope } from "./seed-data";
import {
  dedupeAttachmentEvents,
  dedupeAttachmentRecords,
  validateAttachmentEvent,
  validateAttachmentRecord,
} from "./validation";

const CHANGE_EVENT = "dss-as-attachment-storage-changed";

function isBrowser(): boolean {
  return typeof window !== "undefined";
}

export type AttachmentStoreSnapshot = {
  records: LocalAttachmentMetadata[];
  events: LocalAttachmentEvent[];
  isMalformed: boolean;
};

const EMPTY_SNAPSHOT: AttachmentStoreSnapshot = { records: [], events: [], isMalformed: false };

let cachedRaw: string | null | undefined = undefined;
let cachedSnapshot: AttachmentStoreSnapshot = EMPTY_SNAPSHOT;

/**
 * 구조 검증만 담당한다(JSON 파싱, version === 1, records/events 배열 여부).
 * version이 1이 아니거나 구조가 어긋나면 null을 반환하며, 호출부는 이 경우
 * 절대 storage를 덮어쓰지 않고 안전한 빈 결과 + isMalformed:true만 반환한다
 * (버전이 지원되지 않거나 손상된 데이터를 조용히 새 시드로 대체하지 않는다).
 */
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

function validateEnvelope(records: unknown[], events: unknown[]): AttachmentStoreSnapshot {
  const validatedRecords = records
    .map((r) => validateAttachmentRecord(r))
    .filter((r): r is LocalAttachmentMetadata => r !== null);
  const dedupedRecords = dedupeAttachmentRecords(validatedRecords);
  const recordsById = new Map(dedupedRecords.map((r) => [r.id, r]));

  const validatedEvents = events
    .map((e) => validateAttachmentEvent(e, { recordsById }))
    .filter((e): e is LocalAttachmentEvent => e !== null);
  const dedupedEvents = dedupeAttachmentEvents(validatedEvents);

  return { records: dedupedRecords, events: dedupedEvents, isMalformed: false };
}

/**
 * storage 키가 "완전히 없을 때"만 mockAttachments 기반 시드를 생성해 쓴다.
 * 키가 존재하지만 파싱/버전이 어긋나거나(malformed) records가 빈 배열이거나
 * (사용자가 지운 경우) 검증에서 전부 걸러졌다면, 그 상태를 그대로 존중하고
 * 절대 재시드하지 않는다.
 */
export function getAttachmentStoreSnapshot(): AttachmentStoreSnapshot {
  if (!isBrowser()) return EMPTY_SNAPSHOT;

  const raw = window.localStorage.getItem(LOCAL_ATTACHMENT_STORAGE_KEY);
  if (raw === cachedRaw) return cachedSnapshot;

  if (raw === null) {
    const seeded = buildSeedAttachmentEnvelope();
    // mockAttachments 어댑터 변환에 실패한 레코드는 조용히 버리지 않고
    // 콘솔에 사유를 남긴다 — 시드 데이터셋이 바뀌었을 때 눈에 띄지 않게
    // 사라지는 레코드가 없도록 하기 위함이다(데모 전용, UI 노출은 하지 않음).
    if (seeded.failures.length > 0) {
      console.warn(
        `[attachments] mockAttachments 변환 실패 ${seeded.failures.length}건:`,
        seeded.failures
      );
    }
    const envelope = { version: 1 as const, records: seeded.records, events: seeded.events };
    const serialized = JSON.stringify(envelope);
    window.localStorage.setItem(LOCAL_ATTACHMENT_STORAGE_KEY, serialized);
    cachedRaw = serialized;
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

export function getServerAttachmentStoreSnapshot(): AttachmentStoreSnapshot {
  return EMPTY_SNAPSHOT;
}

export function subscribeAttachmentStore(onStoreChange: () => void): () => void {
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
export function writeAttachmentEnvelope(records: LocalAttachmentMetadata[], events: LocalAttachmentEvent[]): void {
  const envelope = { version: 1 as const, records, events };
  window.localStorage.setItem(LOCAL_ATTACHMENT_STORAGE_KEY, JSON.stringify(envelope));
  cachedRaw = undefined;
  window.dispatchEvent(new Event(CHANGE_EVENT));
}
