import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * ============================================================================
 * 🔴 「틀린 토큰이면 401」 검사용 가짜 토큰은 반드시 ASCII 다 (2026-10-22)
 * ============================================================================
 * `scripts/check-inventory-contract.ts` 의 `checkLive()` 안에서 한때 **한글** 가짜
 * 토큰("이건-틀린-토큰")을 썼다. HTTP 머리말은 Latin-1(바이트 0~255)만 실을 수 있어서,
 * 한글처럼 255 를 넘는 문자가 `Authorization` 머리말에 들어가면 `fetch` 가 요청을 보내기도
 * 전에 던진다 —
 *
 *   Cannot convert argument to a ByteString because the character at index 7
 *   has a value of 51060 which is greater than 255.
 *
 * `ask()` 가 그 예외를 삼켜 `status: 0` 을 돌려주므로 "토큰이 틀리면 401" 검사는
 * **언제나 ✗** 였다 — 마치 재고 관리가 틀린 토큰을 받아 주는 것처럼 보였지만 실은 이
 * 도구 자신의 탓이었다(실측: 영문 가짜 토큰을 보내면 401 이 온다 — 서버는 멀쩡하다).
 *
 * 🔴 이 도구는 **서버가 있어야 도는 코드**라 평소 시험에서는 돌려 볼 수 없다. 그래서
 *    여기서는 **소스를 글자로 읽어**, 그 자리에 쓰는 가짜 토큰 값이 ASCII 인지만 잰다 —
 *    서버 없이도 "한글을 다시 넣으면 이 시험이 깨지는가"를 재는 것이 이 시험의 전부다.
 * 🔵 서버 없이 도는 코드를 소스로 재는 선례가 이 저장소에 이미 여럿이다
 *    (`src/components/inventory/part-request-section-wiring.test.ts`,
 *    `src/app/api/v1/route-source.test.ts`). 같은 결을 따른다.
 * ============================================================================
 */

const SOURCE_PATH = "scripts/check-inventory-contract.ts";
const source = readFileSync(join(process.cwd(), SOURCE_PATH), "utf8");

/** "토큰이 틀리면 401" 검사에 실제로 보내는 토큰 문자열 리터럴만 떼어 온다. */
function badTokenLiteral(): string {
  const match = source.match(/badToken = await ask\(`\$\{base\}\/api\/v1\/parts`,\s*"([^"]*)"\)/);
  assert.ok(match, "틀린 토큰을 보내는 자리를 찾지 못했다 — scripts/check-inventory-contract.ts 가 바뀌었다");
  return match![1];
}

test("🔴 「토큰이 틀리면 401」 검사의 가짜 토큰이 ASCII 다 — 한글이면 fetch 가 보내기 전에 던진다", () => {
  const token = badTokenLiteral();

  // 🔴 헛도는 단언을 막는다 — 잘라 낸 토막이 빈 문자열이면 아래 ASCII 검사가 늘 통과해
  //    아무것도 안 잰 것과 같다(이 저장소에 그런 반쯤 죽은 시험이 실제로 있었다 —
  //    src/components/inventory/part-request-section-wiring.test.ts 385행 근처).
  assert.notEqual(token, "", "틀린 토큰 값이 비어 있다 — 자리를 잘못 잘랐을 수 있다");

  // 🔴 HTTP 머리말은 ASCII(실제로는 Latin-1, 0~255)만 싣는다. 한글은 255 를 넘어 fetch 가
  //    요청을 보내기도 전에 던진다 — 이 값이 ASCII 를 벗어나면 같은 사고가 되풀이된다.
  assert.ok(
    /^[\x00-\x7F]+$/.test(token),
    `틀린 토큰에 ASCII 가 아닌 글자가 있다 — HTTP 머리말에 실을 수 없다: "${token}"`
  );
});
