import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { ROLE_CODES } from "@/lib/domain/types";
import { canManageExcelImports } from "./excel-import-authorization";

describe("canManageExcelImports", () => {
  test("allows only SUPER_ADMIN and ADMIN", () => {
    assert.deepEqual(
      ROLE_CODES.filter(canManageExcelImports),
      ["SUPER_ADMIN", "ADMIN"]
    );
  });
});
