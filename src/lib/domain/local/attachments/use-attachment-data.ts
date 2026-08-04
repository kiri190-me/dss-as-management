"use client";

import { useSyncExternalStore } from "react";
import {
  getAttachmentStoreSnapshot,
  getServerAttachmentStoreSnapshot,
  subscribeAttachmentStore,
  type AttachmentStoreSnapshot,
} from "./attachment-storage";
import { useIsHydrated } from "../use-is-hydrated";

export type UseAttachmentStoreResult = AttachmentStoreSnapshot & { isHydrated: boolean };

export function useAttachmentStore(): UseAttachmentStoreResult {
  const snapshot = useSyncExternalStore(
    subscribeAttachmentStore,
    getAttachmentStoreSnapshot,
    getServerAttachmentStoreSnapshot
  );
  const isHydrated = useIsHydrated();
  return { ...snapshot, isHydrated };
}
