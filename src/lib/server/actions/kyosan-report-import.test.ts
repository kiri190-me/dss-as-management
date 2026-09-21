import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * ============================================================================
 * 🔴 연락서 한 장 넣기 — **액션이 스스로 권한을 본다 · 화면이 보내는 것은 둘뿐이다**
 * ============================================================================
 * 이 시험은 원본을 **글자로 읽는다**. 액션은 "use server" 파일이고 그 사슬 끝에
 * `server-only` 가 있어 여기서 부를 수 없기 때문이다
 * (`auth/repair-case-used-parts-authorization.test.ts` 와 같은 방식).
 *
 * 못 박는 것 넷:
 *  1. 🔴 두 액션 모두 **세션부터 다시 읽고 권한을 다시 판정한다** — 화면 가드는
 *     화면을 그릴 때만 돈다.
 *  2. 🔴 권한은 **이미 있는 판정을 그대로 쓴다**(`kyosanIntakeImport` 관리) —
 *     흉내 낸 검사를 새로 적지 않았다.
 *  3. 🔴 액션이 FormData 에서 읽는 것은 `file` · `repairCaseId` ·
 *     `chosenRepairCaseId` **뿐**이다 — 화면이 계산한 미리보기(plan)를 받지 않는다.
 *  4. 🔴 **자물쇠와 고르기는 서로 다른 통로다**(조각 S4b) — `expectedRepairCaseId`
 *     에 고르기의 뜻을 겹쳐 싣지 않는다.
 *  5. 🔴 수리 건을 새로 만드는 길이 없다.
 * ============================================================================
 */

const ROOT = process.cwd();
const ACTION_PATH = join(ROOT, "src/lib/server/actions/kyosan-report-import.ts");
const SCREEN_PATH = join(ROOT, "src/components/excel-imports/KyosanReportImportScreen.tsx");
const PAGE_PATH = join(ROOT, "src/app/(app)/excel-imports/kyosan-report/page.tsx");
const PREVIEW_SERVICE_PATH = join(ROOT, "src/lib/server/services/kyosan-report-preview.ts");

const actionCode = readFileSync(ACTION_PATH, "utf8");
const screenCode = readFileSync(SCREEN_PATH, "utf8");
const pageCode = readFileSync(PAGE_PATH, "utf8");
const previewServiceCode = readFileSync(PREVIEW_SERVICE_PATH, "utf8");

/** 내보낸 async 함수 하나의 본문(다음 `export` 전까지). */
function exportedBody(code: string, name: string): string {
  const start = code.indexOf(`export async function ${name}(`);
  assert.notEqual(start, -1, `${name} 을 찾지 못했다`);
  const next = code.indexOf("\nexport ", start + 1);
  return code.slice(start, next === -1 ? code.length : next);
}

describe("🔴 액션이 권한을 다시 판정한다", () => {
  for (const name of ["previewKyosanReportAction", "importKyosanReportAction"]) {
    test(`${name} 은 첫 줄에서 관문을 부른다`, () => {
      const body = exportedBody(actionCode, name);
      assert.match(body, /const auth = await resolveReportImportActor\(\);/);
      assert.match(body, /if \(!auth\.ok\) return auth;/);
      // 🔴 파일보다 권한이 먼저다 — 권한 없는 요청이 어떤 파일이 통과하는지 알 수 없게.
      assert.ok(
        body.indexOf("resolveReportImportActor") < body.indexOf("readReportFile"),
        `${name}: 권한을 파일보다 먼저 봐야 한다`
      );
    });
  }

  test("관문은 세션 · 승인 · 실효 권한(MANAGE)을 본다", () => {
    assert.match(actionCode, /const session = await readSession\(\);/);
    assert.match(actionCode, /session\.approvalStatus !== "APPROVED"/);
    assert.match(
      actionCode,
      /hasPermission\(actor, KYOSAN_IMPORT_PERMISSION_AREA, "MANAGE"\)/,
      "실효 권한을 관리 수준으로 봐야 한다"
    );
  });

  test("🔴 권한 판정을 새로 적지 않았다 — 과거 인수품 가져오기의 것을 그대로 쓴다", () => {
    assert.match(
      actionCode,
      /import \{\s*KYOSAN_IMPORT_PERMISSION_AREA,[\s\S]*?\} from "@\/lib\/server\/services\/kyosan-intake-import";/
    );
    // 역할 목록을 여기서 다시 적으면 관리자 설정(role_permissions)이 무시된다.
    assert.ok(
      !/SUPER_ADMIN|"ADMIN"/.test(actionCode),
      "액션이 역할 이름을 직접 적으면 안 된다(권한 판정을 흉내 낸 것이다)"
    );
  });

  test("화면 가드도 같은 영역 · 같은 수준이다", () => {
    assert.match(
      pageCode,
      /requireAreaAccessForCurrentUser\(KYOSAN_IMPORT_PERMISSION_AREA, "MANAGE"\)/
    );
  });
});

describe("🔴 화면이 보내는 것은 파일 · 자물쇠 · 고르기 뿐이다", () => {
  // 🔴 셋째(`chosenRepairCaseId`)는 조각 S4b 에서 늘었다 — 사람이 고른 것을
  //    나르는 **새 통로**다. 자물쇠(`repairCaseId`)에 뜻을 겹쳐 싣지 않기 위해서다.
  const ALLOWED_FIELDS = ["chosenRepairCaseId", "file", "repairCaseId"];

  test("액션이 FormData 에서 읽는 이름은 이 셋뿐이다", () => {
    const names = [...actionCode.matchAll(/formData\.get\("([^"]+)"\)/g)].map((match) => match[1]);
    assert.deepEqual([...new Set(names)].sort(), ALLOWED_FIELDS);
  });

  test("화면이 FormData 에 담는 이름도 이 셋뿐이다", () => {
    const names = [...screenCode.matchAll(/formData\.append\("([^"]+)"/g)].map((match) => match[1]);
    assert.deepEqual([...new Set(names)].sort(), ALLOWED_FIELDS);
  });

  test("🔴 고르기는 사람이 실제로 고른 경우에만 실린다(`choose`)", () => {
    assert.match(
      screenCode,
      /if \(saveOffer === "choose"\) formData\.append\("chosenRepairCaseId"/,
      "접수번호로 확정된 짝을 「골랐다」고 보내면 저장 직전 검사의 갈래가 뒤바뀐다"
    );
  });

  test("🔴 화면이 미리보기 결과(plan · 줄 · 부품)를 서버로 되돌려 보내지 않는다", () => {
    for (const forbidden of ["plan", "lines", "parts", "preview", "content", "targets", "sourceSha256"]) {
      assert.ok(
        !new RegExp(`formData\\.append\\("${forbidden}"`).test(screenCode),
        `화면이 ${forbidden} 을 서버로 보내면 「사람이 본 것」과 「들어간 것」이 갈라진다`
      );
    }
  });

  test("액션은 화면이 보여 준 건을 저장 함수의 `expectedRepairCaseId`(자물쇠)로 넘긴다", () => {
    const body = exportedBody(actionCode, "importKyosanReportAction");
    assert.match(body, /expectedRepairCaseId: repairCaseId,/);
    // 미리보기 결과를 저장 함수에 넘기는 줄이 있으면 안 된다.
    assert.ok(!/plan:/.test(body), "저장 함수에 plan 을 넘기면 안 된다");
  });

  test("🔴 고르기는 자물쇠와 **다른 매개변수**로 넘어간다", () => {
    const body = exportedBody(actionCode, "importKyosanReportAction");
    assert.match(body, /const chosenRepairCaseId = formData\.get\("chosenRepairCaseId"\);/);
    assert.match(body, /chosenRepairCaseId,/, "고르기를 저장 함수까지 이어야 한다");
    assert.ok(
      !/chosenRepairCaseId: repairCaseId|expectedRepairCaseId: chosenRepairCaseId/.test(body),
      "🔴 자물쇠와 고르기의 뜻을 겹치면 자물쇠가 자물쇠 구실을 못 한다"
    );
  });

  test("실려 온 고르기는 자물쇠와 같은 건이어야 한다", () => {
    const body = exportedBody(actionCode, "importKyosanReportAction");
    assert.match(body, /chosenRepairCaseId !== null && chosenRepairCaseId !== repairCaseId/);
  });

  test("id 가 UUID 꼴이 아니면 문 앞에서 막는다", () => {
    assert.match(actionCode, /UUID_PATTERN\.test\(repairCaseId\)/);
  });
});

describe("🔴 수리 건을 새로 만들지 않는다", () => {
  for (const [label, code] of [
    ["액션", actionCode],
    ["미리보기 서비스", previewServiceCode],
    ["화면", screenCode],
  ] as const) {
    test(`${label} 에 수리 건을 만드는 줄이 없다`, () => {
      assert.ok(
        !/createRepairCase|createRepairCaseWithIdempotency/.test(code),
        `${label}: 사용자 정책(2026-09-21) — 이미 등록된 수리 건에만 이식한다`
      );
    });
  }

  test("🔴 미리보기 서비스는 DB 에 쓰지 않는다", () => {
    assert.ok(
      !/db\.insert|db\.update|db\.delete|\.transaction\(/.test(previewServiceCode),
      "미리보기는 읽기 전용이다"
    );
  });
});

describe("🔴 한 장씩이다 — 일괄 처리를 만들지 않았다", () => {
  test("파일 칸이 여러 장을 받지 않는다", () => {
    const partsCode = readFileSync(
      join(ROOT, "src/components/excel-imports/KyosanReportImportParts.tsx"),
      "utf8"
    );
    assert.match(partsCode, /multiple=\{false\}/, "끌어다 놓는 자리도 한 장만 받아야 한다");

    const at = partsCode.indexOf('id="kyosan-report-file"');
    assert.notEqual(at, -1, "고르기 칸을 찾지 못했다");
    const inputTag = partsCode.slice(at, partsCode.indexOf("/>", at));
    assert.ok(!/\bmultiple\b/.test(inputTag), "고르기 칸이 여러 장을 받으면 안 된다");
  });
});
