import type { AttachmentCategory, LocalAttachmentMetadata } from "./attachment-types";

export type AttachmentFilters = {
  query: string;
  category: AttachmentCategory | "ALL";
  extension: string | "ALL";
  uploaderId: string | "ALL";
  includeDeleted: boolean;
};

export const DEFAULT_ATTACHMENT_FILTERS: AttachmentFilters = {
  query: "",
  category: "ALL",
  extension: "ALL",
  uploaderId: "ALL",
  includeDeleted: false,
};

export function applyAttachmentFilters(
  records: readonly LocalAttachmentMetadata[],
  filters: AttachmentFilters
): LocalAttachmentMetadata[] {
  const query = filters.query.trim().toLowerCase();
  return records.filter((r) => {
    if (!filters.includeDeleted && r.isDeleted) return false;
    if (filters.category !== "ALL" && r.category !== filters.category) return false;
    if (filters.extension !== "ALL" && r.fileExtension !== filters.extension) return false;
    if (filters.uploaderId !== "ALL" && r.uploadedByUserId !== filters.uploaderId) return false;
    if (query.length > 0) {
      const haystack = `${r.displayName} ${r.originalFileName}`.toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    return true;
  });
}

export type AttachmentSummary = {
  activeCount: number;
  activeSizeBytes: number;
  deletedCount: number;
  categoryDistribution: { category: AttachmentCategory; count: number }[];
};

export function summarizeAttachments(records: readonly LocalAttachmentMetadata[]): AttachmentSummary {
  const active = records.filter((r) => !r.isDeleted);
  const deleted = records.filter((r) => r.isDeleted);

  const distributionMap = new Map<AttachmentCategory, number>();
  for (const record of active) {
    distributionMap.set(record.category, (distributionMap.get(record.category) ?? 0) + 1);
  }
  const categoryDistribution = Array.from(distributionMap.entries())
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count);

  return {
    activeCount: active.length,
    activeSizeBytes: active.reduce((sum, record) => sum + record.fileSizeBytes, 0),
    deletedCount: deleted.length,
    categoryDistribution,
  };
}

export function sortRecordsNewestFirst(records: readonly LocalAttachmentMetadata[]): LocalAttachmentMetadata[] {
  return [...records].sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
}

export function distinctExtensions(records: readonly LocalAttachmentMetadata[]): string[] {
  return Array.from(new Set(records.map((r) => r.fileExtension))).sort();
}

export function distinctUploaderIds(records: readonly LocalAttachmentMetadata[]): string[] {
  return Array.from(new Set(records.map((r) => r.uploadedByUserId)));
}
