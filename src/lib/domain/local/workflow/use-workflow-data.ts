"use client";

import { useSyncExternalStore } from "react";
import {
  getServerWorkflowStoreSnapshot,
  getWorkflowStoreSnapshot,
  subscribeWorkflowStore,
  type WorkflowStoreSnapshot,
} from "./workflow-storage";
import { useIsHydrated } from "../use-is-hydrated";

export type UseWorkflowStoreResult = WorkflowStoreSnapshot & { isHydrated: boolean };

export function useWorkflowStore(): UseWorkflowStoreResult {
  const snapshot = useSyncExternalStore(
    subscribeWorkflowStore,
    getWorkflowStoreSnapshot,
    getServerWorkflowStoreSnapshot
  );
  const isHydrated = useIsHydrated();
  return { ...snapshot, isHydrated };
}
