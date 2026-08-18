const APPROVED_TEST_DATABASE_SUFFIX = "_test";

export type TestDatabaseSafetyInput = {
  developmentDatabaseUrl: string | undefined;
  testDatabaseUrl: string | undefined;
};

function parseDatabaseName(databaseUrl: string): string | null {
  try {
    const parsed = new URL(databaseUrl);
    const databaseName = decodeURIComponent(parsed.pathname.replace(/^\/+/, ""));
    return databaseName || null;
  } catch {
    return null;
  }
}

function normalizedConnectionIdentity(databaseUrl: string): string | null {
  try {
    const parsed = new URL(databaseUrl);
    return [
      parsed.protocol.toLowerCase(),
      parsed.username,
      parsed.password,
      parsed.hostname.toLowerCase(),
      parsed.port || "5432",
      decodeURIComponent(parsed.pathname.replace(/^\/+/, "")),
    ].join("\u0000");
  } catch {
    return null;
  }
}

/**
 * Fails closed without ever including a connection URL or credential in the
 * error. The returned URL is safe to assign to DATABASE_URL only after all
 * checks pass.
 */
export function requireSafeTestDatabaseUrl(input: TestDatabaseSafetyInput): string {
  if (!input.testDatabaseUrl) {
    throw new Error("TEST_DATABASE_URL is required for database integration tests.");
  }

  const testIdentity = normalizedConnectionIdentity(input.testDatabaseUrl);
  if (!testIdentity) {
    throw new Error("TEST_DATABASE_URL is invalid.");
  }

  if (input.developmentDatabaseUrl) {
    const developmentIdentity = normalizedConnectionIdentity(input.developmentDatabaseUrl);
    if (!developmentIdentity) {
      throw new Error("DATABASE_URL is invalid; test database isolation cannot be verified.");
    }
    if (developmentIdentity === testIdentity) {
      throw new Error("The test database must be different from the development database.");
    }
  }

  const testDatabaseName = parseDatabaseName(input.testDatabaseUrl);
  if (!testDatabaseName || !testDatabaseName.toLowerCase().endsWith(APPROVED_TEST_DATABASE_SUFFIX)) {
    throw new Error("Database integration tests require an approved database name ending in _test.");
  }

  return input.testDatabaseUrl;
}

export function requireActiveTestDatabase(databaseUrl: string | undefined): void {
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not set for the database integration test.");
  }
  const databaseName = parseDatabaseName(databaseUrl);
  if (!databaseName || !databaseName.toLowerCase().endsWith(APPROVED_TEST_DATABASE_SUFFIX)) {
    throw new Error("Database integration test connection blocked: database name must end in _test.");
  }
}
