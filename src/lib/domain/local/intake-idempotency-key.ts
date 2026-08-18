const IDEMPOTENCY_KEY_STORAGE_KEY = "dss-as-intake-idempotency-key-v1";

function isBrowser(): boolean {
  return typeof window !== "undefined";
}

/**
 * `crypto.randomUUID()` requires a "secure context" per the Web Crypto API
 * spec — available on `https://` and on `http://localhost`, but NOT on a
 * plain-HTTP LAN address like `http://192.168.1.132:3000` (confirmed root
 * cause of a live mobile crash: "TypeError: crypto.randomUUID is not a
 * function", desktop-via-localhost unaffected, LAN-via-phone crashing on
 * every call). `crypto.getRandomValues()` has no such secure-context
 * restriction and is available on effectively every real browser this app
 * targets, so it's the fallback here — a hand-built RFC 4122 v4 UUID from
 * its random bytes, standards-compatible and just as unguessable/collision-
 * resistant as `randomUUID()` itself. No Math.random() fallback: this
 * project has no existing precedent for one (grepped, none found), and the
 * `getRandomValues()` tier already covers every realistic case
 * `randomUUID()` itself doesn't.
 */
function generateUuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
    bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10xx
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0"));
    return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10, 16).join("")}`;
  }
  throw new Error("No secure random UUID source available in this browser.");
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
