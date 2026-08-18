import { createHash } from "node:crypto";
import { normalizeEntityName } from "./entity-name-match";

export const EXCEL_IMPORT_MASTER_MAPPING_PARSER_VERSION = "repair-case-list-parser-v6";

export type ExcelImportMasterMappingType =
  | "CUSTOMER"
  | "END_USER"
  | "PRODUCT_MODEL"
  | "ASSIGNEE";

export type ExcelImportMasterMappingSource = {
  customer: string | null;
  endUser: string | null;
  product: string | null;
  model: string | null;
  assignee: string | null;
};

function text(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed || null;
}

export function excelImportMappingSourceFromColumns(
  columns: Record<string, { value: string | null }>
): ExcelImportMasterMappingSource {
  return {
    customer: text(columns.D?.value),
    endUser: text(columns.E?.value),
    product: text(columns.F?.value),
    model: text(columns.G?.value),
    assignee: text(columns.X?.value),
  };
}

export function excelImportMappingGroupKey(
  type: ExcelImportMasterMappingType,
  source: ExcelImportMasterMappingSource
): string | null {
  let normalized: string | null = null;
  if (type === "CUSTOMER" && source.customer) normalized = normalizeEntityName(source.customer);
  // End-User identity is customer-scoped in the normal intake flow and DB
  // constraint. A customer plan identity (the normalized D value) is used
  // before a real customerId exists; after confirmation both resolve to the
  // same relationship group.
  if (type === "END_USER" && source.customer && source.endUser) {
    normalized = `${normalizeEntityName(source.customer)}\u0000${normalizeEntityName(source.endUser)}`;
  }
  if (type === "ASSIGNEE" && source.assignee) normalized = normalizeEntityName(source.assignee);
  // Product Model is a global master keyed only by G (Model). F is retained
  // in the source payload for future workflow-kind resolution, never used
  // for Product Model identity or kind inference.
  if (type === "PRODUCT_MODEL" && source.model) normalized = normalizeEntityName(source.model);
  if (normalized === null) return null;
  return createHash("sha256").update(`${type}:${normalized}`, "utf8").digest("hex");
}
