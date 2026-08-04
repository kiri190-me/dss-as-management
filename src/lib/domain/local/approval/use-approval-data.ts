"use client";

import { useSyncExternalStore } from "react";
import {
  getApprovalStoreSnapshot,
  getServerApprovalStoreSnapshot,
  subscribeApprovalStore,
  type ApprovalStoreSnapshot,
} from "./approval-storage";
import {
  getDelegationsSnapshot,
  getServerDelegationsSnapshot,
  subscribeDelegations,
  type DelegationStoreSnapshot,
} from "./delegation-storage";
import { useIsHydrated } from "../use-is-hydrated";

export type UseApprovalStoreResult = ApprovalStoreSnapshot & { isHydrated: boolean };
export type UseDelegationsResult = DelegationStoreSnapshot & { isHydrated: boolean };

export function useApprovalStore(): UseApprovalStoreResult {
  const snapshot = useSyncExternalStore(
    subscribeApprovalStore,
    getApprovalStoreSnapshot,
    getServerApprovalStoreSnapshot
  );
  const isHydrated = useIsHydrated();
  return { ...snapshot, isHydrated };
}

export function useShipmentDelegations(): UseDelegationsResult {
  const snapshot = useSyncExternalStore(
    subscribeDelegations,
    getDelegationsSnapshot,
    getServerDelegationsSnapshot
  );
  const isHydrated = useIsHydrated();
  return { ...snapshot, isHydrated };
}
