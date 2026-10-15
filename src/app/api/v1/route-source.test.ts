import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * ============================================================================
 * 다른 사내 시스템이 읽어 가는 통로 셋 — **소스로** 지킨다
 * ============================================================================
 * 이 라우트들은 직접 부를 수 없다(DB 를 읽는다 — `lib/db/connection.ts` 는
 * DATABASE_URL 이 없으면 불러오는 순간 던진다). 이 저장소가 그런 라우트를 지키는
 * 방식대로(api/integration/route-source.test.ts) 소스를 읽어 못 박는다. 판정
 * 자체는 실제로 돌려 본다 — `lib/api/shared-token.test.ts`(문지기)와
 * `lib/api/intake-lookup.test.ts`(모양 검사 · 응답 만들기).
 *
 * 🔴 이 시험 파일을 `[number]` 폴더 안에 두지 않는다. node --test 가 목록의 경로를
 * 글롭 문자클래스로 읽어 `tests 0` 으로 조용히 지나간다.
 *
 * 여기서 지키는 것:
 *  1. 문지기가 **맨 먼저** 오고, 막히면 DB 에 닿지 않는다.
 *  2. 🔴 토큰을 **쿼리 문자열로 받지 않는다.**
 *  3. 🔴 **읽기뿐이다** — POST·PATCH·PUT·DELETE 가 없다.
 *  4. 인수번호 통로는 휴지통을 거르는 **새 질의**를 쓴다.
 *  5. 사람 명부는 자격 규칙을 베끼지 않고 기존 함수를 부르며, 칸 다섯만 내보낸다
 *     — 그중 포털 번호(`ssoSubject`)는 **빠져도 안 되고 `null` 을 감춰도 안 된다.**
 *  6. 모든 응답이 `cache-control: no-store`.
 * ============================================================================
 */

function source(relative: string): string {
  return readFileSync(join(process.cwd(), relative), "utf8").replace(/\r\n/g, "\n");
}

const ROUTES = {
  인수번호: source("src/app/api/v1/intakes/[number]/route.ts"),
  사람명부: source("src/app/api/v1/users/route.ts"),
  제품모델: source("src/app/api/v1/product-models/route.ts"),
} as const;

describe("통로 셋 공통", () => {
  test("🔴 문지기가 먼저다 — 막히면 조회에 닿지 않는다", () => {
    for (const [name, body] of Object.entries(ROUTES)) {
      const checkAt = body.indexOf("checkSharedApiToken(request)");
      const rejectAt = body.indexOf("if (denied) return denied;");
      const awaitAt = body.indexOf("await ", rejectAt > 0 ? rejectAt : 0);
      assert.ok(checkAt > 0, `${name}: 문지기를 부르는 자리를 찾지 못했다`);
      assert.ok(rejectAt > checkAt, `${name}: 문지기 결과를 확인하지 않는다`);
      assert.ok(awaitAt > rejectAt, `${name}: 거절하기 전에 일을 시작한다`);
    }
  });

  test("🔴 토큰을 쿼리 문자열에서 읽지 않는다 — 쿼리는 접근 로그에 남는다", () => {
    for (const [name, body] of Object.entries(ROUTES)) {
      for (const forbidden of ["searchParams", "nextUrl.query", "?token="]) {
        assert.ok(!body.includes(forbidden), `${name}: 쿼리에서 토큰을 읽는 자리가 있다 — ${forbidden}`);
      }
    }
  });

  test("🔴 읽기 전용이다 — 쓰는 메서드가 없다", () => {
    for (const [name, body] of Object.entries(ROUTES)) {
      for (const method of ["POST", "PATCH", "PUT", "DELETE"]) {
        assert.ok(
          !body.includes(`export async function ${method}`),
          `${name}: 쓰는 통로가 생겼다 — ${method}`
        );
      }
      assert.match(body, /export async function GET/, `${name}: GET 이 없다`);
    }
  });

  test("응답이 캐시되지 않는다 — NO_STORE 를 쓴다", () => {
    for (const [name, body] of Object.entries(ROUTES)) {
      assert.match(body, /headers: NO_STORE/, `${name}: no-store 가 붙지 않은 응답이 있다`);
      assert.match(body, /from "@\/lib\/api\/shared-token"/, `${name}: 문지기를 안 쓴다`);
    }
  });

  test("🔴 포털 토큰으로 가르지 않는다 — 부르는 쪽은 포털이 아니라 서버 하나다", () => {
    for (const [name, body] of Object.entries(ROUTES)) {
      assert.ok(
        !body.includes("verifyPortalServiceToken"),
        `${name}: 포털이 서명한 토큰을 요구한다 — 재고 관리는 그런 토큰을 구울 수 없다`
      );
      assert.ok(!body.includes("readSession"), `${name}: 사람의 세션을 요구한다`);
    }
  });
});

describe("인수번호 조회 통로", () => {
  const body = ROUTES.인수번호;

  test("🔴 휴지통을 거르는 새 질의를 쓴다 — 가져오기용 함수를 그대로 쓰지 않는다", () => {
    assert.match(body, /from "@\/lib\/db\/queries\/external-intake-lookup"/);
    assert.match(body, /findIntakeForExternalLookup/);
    // 🔴 이 모듈의 loadExistingCasesByIntakeNumber 는 휴지통을 **일부러 포함**한다.
    assert.ok(
      !body.includes('from "@/lib/db/queries/kyosan-intake-import"'),
      "휴지통을 포함하는 가져오기용 질의를 끌어다 쓴다"
    );
  });

  test("모양이 아니면 400, 없으면 404", () => {
    assert.match(body, /isValidIntakeNumber/);
    assert.match(body, /status: 400/);
    assert.match(body, /"not_found"/);
    assert.match(body, /status: 404/);
  });

  test("모양 검사가 조회보다 먼저다", () => {
    const checkAt = body.indexOf("isValidIntakeNumber");
    const queryAt = body.indexOf("await findIntakeForExternalLookup");
    assert.ok(checkAt > 0 && queryAt > checkAt, "모양도 안 보고 DB 를 두드린다");
  });

  test("응답 만들기를 라우트가 흉내 내지 않는다", () => {
    assert.match(body, /buildIntakeLookupResponse\(row\)/);
  });
});

describe("사람 명부 통로", () => {
  const body = ROUTES.사람명부;

  test("🔴 자격 규칙을 베끼지 않고 기존 함수를 부른다", () => {
    assert.match(body, /from "@\/lib\/db\/queries\/shipment-approval-routes"/);
    assert.match(body, /await listSelectableApproverCandidates\(\)/);
    // 라우트가 스키마나 drizzle 을 직접 잡으면 자격 조건을 여기서 다시 쓴다는 뜻이다.
    for (const forbidden of ['from "drizzle-orm"', "db/schema", "db()", "users.approvalStatus"]) {
      assert.ok(!body.includes(forbidden), `라우트가 자격을 직접 판정한다 — ${forbidden}`);
    }
  });

  test("🔴 칸 다섯만 내보낸다 — 개인정보가 넓게 나가지 않는다", () => {
    assert.match(body, /id: user\.id/);
    assert.match(body, /name: user\.name/);
    assert.match(body, /email: user\.email/);
    assert.match(body, /role: user\.role/);
    for (const forbidden of ["phone", "department", "password", "passwordHash"]) {
      assert.ok(!body.includes(forbidden), `내보내면 안 되는 칸이 있다 — ${forbidden}`);
    }
  });

  test("🔴 포털 번호를 함께 내보낸다 — 받는 쪽이 사람을 알아보는 유일한 열쇠다", () => {
    // 여기 id 는 A/S 안에서만 쓰는 번호라 재고 관리의 사람 번호와 맞지 않는다.
    // 이어 주는 칸은 sso_subject 하나뿐이고, 이 칸이 빠지면 받는 쪽은 목록을
    // 받고도 누가 누구인지 가릴 수 없다.
    assert.match(body, /ssoSubject: user\.ssoSubject/);
  });

  test("🔴 안 이어진 사람의 null 을 감추지 않는다 — 빈 글자로 바꾸거나 거르지 않는다", () => {
    // 포털로 한 번도 로그인한 적 없는 계정은 sso_subject 가 비어 있다. 그것을
    // 빈 글자로 덮으면 받는 쪽은 「안 이어진 사람」과 「이어졌는데 번호가 빈
    // 사람」을 구별하지 못하고, 목록에서 빼 버리면 왜 안 보이는지도 알 수 없다.
    for (const forbidden of [
      "user.ssoSubject ??",
      "user.ssoSubject ||",
      "ssoSubject: user.ssoSubject ?",
      "filter((user)",
      ".filter(",
    ]) {
      assert.ok(!body.includes(forbidden), `null 을 감추거나 사람을 거르는 자리가 있다 — ${forbidden}`);
    }
  });
});

describe("제품 모델 통로", () => {
  const body = ROUTES.제품모델;

  test("🔴 안 이어진 모델만 거르는 함수를 쓰지 않는다 — 쓰임이 다르다", () => {
    assert.match(body, /from "@\/lib\/db\/queries\/external-product-models"/);
    assert.match(body, /await listProductModelsForExternalLookup\(\)/);
    // listUnlinkedProductModels 는 **아직 안 이어진 모델만** 준다(O/H 템플릿 고르개용).
    assert.ok(
      !body.includes('from "@/lib/db/queries/oh-part-templates"'),
      "O/H 템플릿용 질의를 끌어다 쓴다"
    );
  });

  test("세는 쪽을 라우트가 직접 만든다 — generatedAt · count · models", () => {
    assert.match(body, /generatedAt: new Date\(\)\.toISOString\(\)/);
    assert.match(body, /count: models\.length/);
  });
});
