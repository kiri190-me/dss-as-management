import "./load-env";

import { loadMailConfig, describeMailConfig } from "../src/lib/server/mail/config";
import { checkMailConnection } from "../src/lib/server/mail/transport";

/**
 * ============================================================================
 * 사내 메일 서버에 로그인이 되는지만 확인한다 — 메일은 보내지 않는다
 * ============================================================================
 *   npm run mail:check
 *   npm run mail:check -- --user=chm        ← .env 를 고치지 않고 다른 계정으로
 *
 * SMTP 로 EHLO → STARTTLS → AUTH → QUIT 까지만 간다. **한 통도 나가지
 * 않으므로** 누구의 메일함에도 아무것도 남지 않는다.
 *
 * 🔴 비밀번호는 어디에도 찍지 않는다. 설정을 보여 줄 때도 길이만 적는다
 * (describeMailConfig) — 이 출력을 그대로 붙여 넣어 물어보게 될 것이기 때문이다.
 * ============================================================================
 */

function parseUserOverride(argv: string[]): string | undefined {
  const flag = argv.find((a) => a.startsWith("--user="));
  const value = flag?.slice("--user=".length).trim();
  return value ? value : undefined;
}

async function main() {
  const overrideUser = parseUserOverride(process.argv.slice(2));

  const loaded = loadMailConfig();
  if (!loaded.ok) {
    console.error("설정을 읽지 못했습니다.");
    console.error("  " + loaded.message);
    process.exitCode = 1;
    return;
  }

  const shown = overrideUser ? { ...loaded.config, user: overrideUser } : loaded.config;
  console.log("설정:", describeMailConfig(shown));
  if (overrideUser) {
    console.log(`       (계정을 "${overrideUser}" 로 바꿔 시험합니다 — .env.local 은 그대로입니다)`);
  }
  console.log("연결 중… 메일은 보내지 않습니다.\n");

  const result = await checkMailConnection({ overrideUser });

  if (result.ok) {
    console.log("✅ 로그인까지 성공했습니다.");
    console.log("   " + result.description);
    if (overrideUser) {
      console.log(`\n   이 계정이 맞습니다 — .env.local 의 MAIL_SMTP_USER 를 "${overrideUser}" 로 고쳐 주세요.`);
    }
    return;
  }

  console.error(result.stage === "CONFIG" ? "❌ 설정 문제입니다." : "❌ 연결/로그인에 실패했습니다.");
  console.error("   서버가 준 말: " + result.message);
  if (result.hint) console.error("\n   → " + result.hint);
  process.exitCode = 1;
}

main().catch((error) => {
  console.error("예상치 못한 오류:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
