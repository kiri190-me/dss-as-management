import "./load-test-env";

import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, pgClient } from "../src/lib/db/connection";
import { procedureTemplates, productModels, products, users } from "../src/lib/db/schema";
import { mockProducts } from "../src/lib/domain/mock-data";

// The test database uses the same deterministic fictional reference fixtures
// as local development, but the test-only loader guarantees they can never be
// written to the development database. No development rows are copied.
process.env.DSS_SEED_TEST_WRAPPER = "1";

function deterministicUuid(key: string): string {
  const hex = createHash("sha256").update(`dss-as-seed-test:${key}`).digest("hex").slice(0, 32).split("");
  hex[12] = "4";
  hex[16] = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  const joined = hex.join("");
  return `${joined.slice(0, 8)}-${joined.slice(8, 12)}-${joined.slice(12, 16)}-${joined.slice(16, 20)}-${joined.slice(20, 32)}`;
}

async function main() {
  const { seedDevelopmentFixtures } = await import("./seed-dev-db");
  await seedDevelopmentFixtures();

  const modelNames = [...new Set(mockProducts.map((product) => product.modelName))];
  for (const modelName of modelNames) {
    const productModelId = deterministicUuid(`product-model:${modelName}`);
    await db.insert(productModels).values({ id: productModelId, modelName }).onConflictDoUpdate({
      target: productModels.id,
      set: { modelName },
    });
    await db.update(products).set({ productModelId }).where(eq(products.modelName, modelName));
  }
  console.log(`  productModels: ${modelNames.length}`);

  const [seedOwner] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.role, "SUPER_ADMIN"))
    .limit(1);
  if (!seedOwner) throw new Error("TEST_SEED_SUPER_ADMIN_MISSING");

  const baselineProcedureTemplates = [
    { code: "rfg-full-lifecycle", name: "Test RFG lifecycle", equipmentType: "RFG", category: "FULL_SERVICE", isReferenceOnly: false },
    { code: "mb-full-lifecycle", name: "Test MB lifecycle", equipmentType: "MB", category: "FULL_SERVICE", isReferenceOnly: false },
    { code: "main-page-index", name: "Test main index", equipmentType: "COMMON", category: "REFERENCE", isReferenceOnly: true },
    { code: "qc-common-operations", name: "Test QC reference", equipmentType: "COMMON", category: "REFERENCE", isReferenceOnly: true },
  ] as const;

  for (const template of baselineProcedureTemplates) {
    await db
      .insert(procedureTemplates)
      .values({
        id: deterministicUuid(`procedure-template:${template.code}`),
        ...template,
        status: "PUBLISHED",
        version: 1,
        sourceType: "MANUAL",
        createdByUserId: seedOwner.id,
        publishedByUserId: seedOwner.id,
        publishedAt: new Date("2026-01-01T00:00:00.000Z"),
      })
      .onConflictDoNothing();
  }
  console.log(`  procedureTemplates: ${baselineProcedureTemplates.length}`);
}

main()
  .then(async () => {
    await pgClient.end({ timeout: 5 });
    process.exit(0);
  })
  .catch(async (error) => {
    console.error("Test seed failed:", error instanceof Error ? error.message : String(error));
    await pgClient.end({ timeout: 5 });
    process.exit(1);
  });
