import type { LocalAttachmentMetadata } from "@/lib/domain/local/attachments/attachment-types";

export type AttachmentRowActions = {
  onRename: (record: LocalAttachmentMetadata) => void;
  onEditDescription: (record: LocalAttachmentMetadata) => void;
  onPreview: (record: LocalAttachmentMetadata) => void;
  onDownload: (record: LocalAttachmentMetadata) => void;
  onDelete: (record: LocalAttachmentMetadata) => void;
  onRestore: (record: LocalAttachmentMetadata) => void;
};
