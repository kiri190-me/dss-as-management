const IDEMPOTENCY_KEY_STORAGE_KEY = "dss-as-intake-idempotency-key-v1";

function isBrowser(): boolean {
  return typeof window !== "undefined";
}

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
 * opaque crypto.randomUUID().
 */
export function getOrCreateIntakeIdempotencyKey(): string {
  if (!isBrowser()) {
    // SSR-safe fallback only — never persisted, never actually submitted
    // (this form only renders/submits client-side; see IntakeForm.tsx's
    // hydration gate).
    return crypto.randomUUID();
  }

  const existing = window.localStorage.getItem(IDEMPOTENCY_KEY_STORAGE_KEY);
  if (existing) return existing;

  const key = crypto.randomUUID();
  window.localStorage.setItem(IDEMPOTENCY_KEY_STORAGE_KEY, key);
  return key;
}

export function resetIntakeIdempotencyKey(): void {
  if (isBrowser()) {
    window.localStorage.removeItem(IDEMPOTENCY_KEY_STORAGE_KEY);
  }
}
