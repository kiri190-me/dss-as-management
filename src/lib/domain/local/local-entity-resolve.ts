import { isExactNormalizedMatch } from "../entity-name-match";
import type { Customer, EndUser } from "../types";
import { localCustomerId, localEndUserId, type LocalRepairCase } from "./local-types";

export type ResolvedLocalEntity = { id: string; name: string };

/**
 * Local-mode "lookup-or-create" for a manually typed customer name — pure
 * function, no localStorage access, so it's directly unit-testable (unlike
 * submitNewLocalCase itself, which touches window.localStorage).
 *
 * Reuse order: an existing mock customer (normalized-name match) first,
 * then a customer already created by an earlier local intake (found by
 * scanning existing local cases' own snapshots — local mode has no separate
 * customers table), and only then synthesizes a new deterministic ID. Since
 * that ID is itself a pure function of the normalized name, two submissions
 * typing "the same" new customer name always converge on the identical ID
 * without needing any additional dedupe step.
 */
export function resolveOrCreateLocalCustomer(
  name: string,
  mockCustomers: readonly Customer[],
  localCases: readonly LocalRepairCase[]
): ResolvedLocalEntity {
  const trimmed = name.trim();

  const mockMatch = mockCustomers.find((c) => isExactNormalizedMatch(c.name, trimmed));
  if (mockMatch) return { id: mockMatch.id, name: mockMatch.name };

  const localMatch = localCases.find((c) => isExactNormalizedMatch(c.customerNameSnapshot, trimmed));
  if (localMatch) return { id: localMatch.customerId, name: localMatch.customerNameSnapshot };

  return { id: localCustomerId(trimmed), name: trimmed };
}

/**
 * Same principle, scoped to a resolved customerId — mirrors
 * resolveOrCreateLocalCustomer exactly, just additionally filtered so an
 * End-User can never resolve/attach to the wrong customer.
 */
export function resolveOrCreateLocalEndUser(
  name: string,
  customerId: string,
  mockEndUsers: readonly EndUser[],
  localCases: readonly LocalRepairCase[]
): ResolvedLocalEntity {
  const trimmed = name.trim();

  const mockMatch = mockEndUsers.find(
    (e) => e.customerId === customerId && isExactNormalizedMatch(e.name, trimmed)
  );
  if (mockMatch) return { id: mockMatch.id, name: mockMatch.name };

  const localMatch = localCases.find(
    (c) =>
      c.customerId === customerId &&
      c.endUserNameSnapshot !== null &&
      c.endUserId !== null &&
      isExactNormalizedMatch(c.endUserNameSnapshot, trimmed)
  );
  if (localMatch) return { id: localMatch.endUserId as string, name: localMatch.endUserNameSnapshot as string };

  return { id: localEndUserId(customerId, trimmed), name: trimmed };
}
