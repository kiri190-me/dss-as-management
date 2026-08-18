import { spawnSync } from "node:child_process";

const npmCliPath = process.env.npm_execpath;
if (!npmCliPath) {
  throw new Error("TEST_DB_PREPARE_NPM_CLI_UNAVAILABLE");
}

for (const script of ["db:test:migrate", "db:test:seed"]) {
  const result = spawnSync(process.execPath, [npmCliPath, "run", script], {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
  });
  if (result.error) {
    console.error("TEST_DB_PREPARE_SUBPROCESS_FAILED", {
      script,
      code: (result.error as NodeJS.ErrnoException).code ?? "UNKNOWN",
    });
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}
