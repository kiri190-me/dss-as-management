/**
 * Pure name-matching/ranking helpers shared by the intake form's customer/
 * End-User comboboxes (client), the local-mode resolvers, and the DB
 * lookup-or-create mutations (server) — kept in one place so "is this an
 * exact match" means the same thing everywhere, matching the DB's own
 * normalized unique index expression exactly:
 *   lower(regexp_replace(btrim(name), '\s+', ' ', 'g'))
 * (migration 0022 — customers_normalized_name_unique /
 * end_users_customer_normalized_name_unique).
 */
export function normalizeEntityName(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

export function isExactNormalizedMatch(a: string, b: string): boolean {
  return normalizeEntityName(a) === normalizeEntityName(b);
}

export type NameSuggestable = { name: string };

/**
 * Simple, dependency-free similar-name ranking — no fuzzy-search library.
 * Tiered: normalized-exact match first, then prefix match, then substring
 * match. Candidates that don't even contain the (normalized) query anywhere
 * are excluded — without a fuzzy/edit-distance dependency there's no
 * principled way to rank those as "similar" instead of just noise. Within a
 * tier, shorter normalized names sort first (a simple, deterministic
 * secondary ordering — the closest-length match reads as the closest
 * suggestion). When the query is empty, every candidate is returned,
 * alphabetically, so the field still offers a full "browse" list.
 */
export function rankSimilarNames<T extends NameSuggestable>(
  query: string,
  candidates: readonly T[]
): T[] {
  const q = normalizeEntityName(query);
  if (!q) {
    return [...candidates].sort((a, b) => a.name.localeCompare(b.name));
  }

  function tier(name: string): number {
    const n = normalizeEntityName(name);
    if (n === q) return 0;
    if (n.startsWith(q)) return 1;
    return 2;
  }

  return candidates
    .filter((c) => normalizeEntityName(c.name).includes(q))
    .sort((a, b) => {
      const tierDiff = tier(a.name) - tier(b.name);
      if (tierDiff !== 0) return tierDiff;
      return normalizeEntityName(a.name).length - normalizeEntityName(b.name).length;
    });
}
