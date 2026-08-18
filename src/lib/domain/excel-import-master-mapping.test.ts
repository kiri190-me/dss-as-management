import assert from "node:assert/strict";
import test from "node:test";
import { excelImportMappingGroupKey, excelImportMappingSourceFromColumns } from "./excel-import-master-mapping";

function source(values: Partial<Record<string, string | null>>) {
  return excelImportMappingSourceFromColumns(Object.fromEntries(
    Object.entries(values).map(([column, value]) => [column, { value: value ?? null }])
  ));
}

test("Product Model identity uses normalized G only while retaining F source text", () => {
  const generator = source({ F: "Generator", G: "  Model X  " });
  const matcher = source({ F: "Matcher", G: "model   x" });
  assert.equal(generator.product, "Generator");
  assert.equal(matcher.product, "Matcher");
  assert.equal(
    excelImportMappingGroupKey("PRODUCT_MODEL", generator),
    excelImportMappingGroupKey("PRODUCT_MODEL", matcher)
  );
});

test("End-User identity includes its customer plan identity", () => {
  const first = source({ D: "Customer A", E: "Main Site" });
  const second = source({ D: "Customer B", E: "Main Site" });
  assert.notEqual(
    excelImportMappingGroupKey("END_USER", first),
    excelImportMappingGroupKey("END_USER", second)
  );
  assert.equal(excelImportMappingGroupKey("END_USER", source({ E: "Main Site" })), null);
});
