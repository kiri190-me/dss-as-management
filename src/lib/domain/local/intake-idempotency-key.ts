import { generateClientUuid } from "@/lib/client-uuid";

const IDEMPOTENCY_KEY_STORAGE_KEY = "dss-as-intake-idempotency-key-v1";

function isBrowser(): boolean {
  return typeof window !== "undefined";
}

/**
 * generateUuid의 실제 구현은 src/lib/client-uuid.ts로 옮겼다. 원래 이 파일
 * 안에만 있던 private 함수였는데, 같은 secure-context 문제로 작업내용 탭이
 * 또 죽으면서(WorkRecordForm) "한 곳만 고치고 나머지 호출부는 남겨 둔" 것이
 * 재발 원인이었음이 드러났다. 이제 브라우저 UUID 생성은 전부 그 모듈을 거친다.
 * 이 별칭은 아래 기존 호출부와 테스트를 그대로 두기 위한 것이다.
 */
const generateUuid = generateClientUuid;

/**
 * Client-side half of server-side idempotency protection for repair-case
 * creation (src/lib/db/mutations/idempotency-keys.ts). Kept in its own
 * localStorage entry rather than inside the draft envelope
 * (draft-storage.ts) so that module's tested v1 shape stays untouched.
 *
 * Lifecycle deliberately mirrors the draft's own: lazily created the first
 * time a draft is read with no key yet stored (i.e. "a new intake draft
 * starts"), reused verbatim across reloads/retries of that same draft, and
 * reset only via resetIntakeIdempotencyKey() — called by useIntakeDraft()
 * on both successful submission and explicit draft clear. Never derived
 * from customer/model/serial/date or any other business field — always an
 * opaque generateUuid() (crypto.randomUUID(), or the getRandomValues()
 * fallback above when randomUUID isn't available).
 */
export function getOrCreateIntakeIdempotencyKey(): string {
  if (!isBrowser()) {
    // SSR-safe fallback only — never persisted, never actually submitted
    // (this form only renders/submits client-side; see IntakeForm.tsx's
    // hydration gate).
    return generateUuid();
  }

  const existing = window.localStorage.getItem(IDEMPOTENCY_KEY_STORAGE_KEY);
  if (existing) return existing;

  const key = generateUuid();
  window.localStorage.setItem(IDEMPOTENCY_KEY_STORAGE_KEY, key);
  return key;
}

export function resetIntakeIdempotencyKey(): void {
  if (isBrowser()) {
    window.localStorage.removeItem(IDEMPOTENCY_KEY_STORAGE_KEY);
  }
}
