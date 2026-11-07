import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { describe, test } from "node:test";

/**
 * ============================================================================
 * 세는 도구들은 **한 글자도 바꾸지 않는다** — 원본 글자로 지킨다 (2026-11-07)
 * ============================================================================
 * `scripts/check-*.ts` 는 운영 DB 에 붙어서 돈다. 그 자리에 쓰는 문장이 한 줄 들어오면
 * **운영 자료가 바뀐다.** 머리말에 「읽기만 한다」고 적어 두는 것만으로는 지켜지지
 * 않는다 — 뒤 조각에서 누군가 `--apply` 한 줄을 들이면 그 머리말은 거짓말이 되고,
 * 아무도 다시 읽지 않는다. 그래서 **동작이 아니라 원본 글자**를 본다
 * (`src/lib/storage/quote-archive-entries-source.test.ts` 와 같은 규율).
 *
 * ── 🔴 목록을 손으로 적지 않는다 ────────────────────────────────────────
 * 폴더를 읽어 `check-*.ts` 를 **전부** 본다. 손으로 적은 목록이면 다음에 생기는 도구가
 * 조용히 빠지고, 빠진 것은 아무도 눈치채지 못한다. 대신 **쓸 수 있는 도구**만 아래
 * 허용 목록에 적는다 — 새로 쓰는 도구를 만들려면 이 목록을 일부러 고쳐야 한다.
 *
 * ── 🔴 주석을 먼저 걷어낸다 ─────────────────────────────────────────────
 * 이 저장소의 머리말들은 「`INSERT`·`UPDATE`·`DELETE` 가 한 줄도 없다」고 **그 낱말을
 * 적어 가며** 설명한다. 안 걷고 세면 멀쩡한 도구가 전부 빨개진다. 거꾸로 코드에는
 * `isDeleted` · `caseDeleted` 같은 칸 이름이 있어서, 낱말 하나로 찾으면 읽기 전용
 * 도구가 걸린다 — 그래서 `.delete(` 처럼 **부르는 꼴**로 본다.
 * ============================================================================
 */

const SCRIPTS_DIR = new URL("./", import.meta.url);

/**
 * 🔴 **DB 를 바꿀 수 있는 도구.** 여기 적힌 것만 쓰기 문장을 가질 수 있다.
 *
 * `check-sso-provision.ts` 는 재는 도구가 아니라 **더듬어 보는 도구**다 — 가짜 SSO
 * 사용자를 만들어 보고 그 흔적을 지운다(그 파일 머리말). 운영에서 돌리는 물건이
 * 아니고, 지우는 대상도 자기가 방금 만든 행뿐이다.
 */
const TOOLS_ALLOWED_TO_WRITE = ["check-sso-provision.ts"];

/** 이 조각이 만든 도구 — 아래에서 한 번 더 깐깐하게 본다. */
const THIS_TOOL = "check-delivered-date-sync.ts";

/**
 * 🔵 「세는 도구」로 이미 서 있는 것들. 목록이 비거나 글롭이 깨졌을 때 **공짜로
 * 통과하지 않게** 하는 못이다 — 이 다섯이 안 보이면 폴더를 잘못 읽은 것이다.
 */
const KNOWN_COUNTING_TOOLS = [
  "check-part-name-overlap.ts",
  "check-target-shipment-missing.ts",
  "check-due-date-inverted.ts",
  "check-requested-due-date-sync.ts",
  THIS_TOOL,
];

function readSource(fileName: string): string {
  return readFileSync(new URL(fileName, SCRIPTS_DIR), "utf8").replace(/\r\n/g, "\n");
}

/** 주석을 뺀 코드 — 머리말이 까닭을 설명하느라 적은 낱말에 걸리지 않게(파일 머리말). */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

const CHECK_TOOLS = readdirSync(SCRIPTS_DIR)
  .filter((name) => name.startsWith("check-") && name.endsWith(".ts") && !name.endsWith(".test.ts"))
  .sort();

/** 🔴 DB 를 바꾸는 꼴. 낱말이 아니라 **부르는 꼴**로 본다(파일 머리말). */
const WRITE_CALLS: readonly RegExp[] = [
  /\.insert\s*\(/,
  /\.update\s*\(/,
  /\.delete\s*\(/,
  /\.transaction\s*\(/,
  /\binsert\s+into\b/i,
  /\bupdate\s+[\w".]+\s+set\b/i,
  /\bdelete\s+from\b/i,
  /\btruncate\b/i,
  /\bdrop\s+(table|column|schema|database)\b/i,
  /\balter\s+table\b/i,
  /\bcreate\s+(table|index)\b/i,
];

describe("세는 도구들 — 원본에 쓰는 문장이 0줄이다", () => {
  test("🔴 무엇을 재고 있는가 — 알고 있는 세는 도구 다섯이 전부 목록에 있다", () => {
    for (const tool of KNOWN_COUNTING_TOOLS) {
      assert.ok(CHECK_TOOLS.includes(tool), `${tool} 을 못 찾았다 — 폴더를 잘못 읽었다`);
    }
    // 허용 목록에 적힌 것이 실제로 있어야 한다. 없으면 그 줄은 아무것도 안 풀어 주면서
    // 「쓰는 도구가 있다」는 오해만 남긴다.
    for (const tool of TOOLS_ALLOWED_TO_WRITE) {
      assert.ok(CHECK_TOOLS.includes(tool), `허용 목록이 낡았다: ${tool}`);
    }
  });

  test("🔴 허용 목록에 없는 도구에는 쓰는 문장이 한 줄도 없다", () => {
    for (const tool of CHECK_TOOLS) {
      if (TOOLS_ALLOWED_TO_WRITE.includes(tool)) continue;
      const code = stripComments(readSource(tool));
      for (const forbidden of WRITE_CALLS) {
        assert.equal(forbidden.test(code), false, `${tool} 에 쓰는 문장이 있다: ${forbidden}`);
      }
    }
  });

  test("🔴 이 시험이 실제로 무는가 — 쓰는 꼴을 넣은 가짜 원본은 걸린다", () => {
    // 🔵 가짜 원본으로 잣대 자체를 확인한다. 머리말에만 그 낱말이 있는 쪽은 통과해야
    //    하고(주석을 걷으니까), 코드에 있는 쪽은 걸려야 한다.
    const onlyInComment = stripComments(
      '/** INSERT · UPDATE · DELETE 가 한 줄도 없다. */\nconst rows = await db.select();\n'
    );
    const inCode = stripComments('await db.delete(users);\n');
    assert.equal(
      WRITE_CALLS.some((pattern) => pattern.test(onlyInComment)),
      false
    );
    assert.equal(
      WRITE_CALLS.some((pattern) => pattern.test(inCode)),
      true
    );
  });

  test("🔴 칸 이름 때문에 멀쩡한 도구가 걸리지 않는다 — `isDeleted` 는 쓰는 문장이 아니다", () => {
    const columnNames = stripComments(
      "const rows = await db.select({ caseDeleted: repairCases.isDeleted })\n" +
        "  .where(eq(domesticOrders.isDeleted, false));\n"
    );
    assert.equal(
      WRITE_CALLS.some((pattern) => pattern.test(columnNames)),
      false
    );
  });
});

describe(`🔴 ${THIS_TOOL} — 재는 것 말고는 아무 길도 없다`, () => {
  const source = readSource(THIS_TOOL);
  const code = stripComments(source);

  test("쓰는 문장이 없다(위 묶음이 통째로 보지만, 이 도구는 콕 집어 다시 본다)", () => {
    for (const forbidden of WRITE_CALLS) {
      assert.equal(forbidden.test(code), false, `쓰는 문장이 있다: ${forbidden}`);
    }
  });

  test("🔴 `--apply` 같은 깃발이 없다 — 재는 도구에 쓰는 길을 내 두지 않는다", () => {
    for (const forbidden of ["--apply", "--fix", "--write", "process.argv", "readline"]) {
      assert.equal(code.includes(forbidden), false, `깃발·입력 흔적: ${forbidden}`);
    }
  });

  test("🔴 파일에도 쓰지 않는다 — 보고는 화면으로만 나간다", () => {
    for (const forbidden of ["node:fs", "fs/promises", "writeFile", "createWriteStream", "child_process"]) {
      assert.equal(code.includes(forbidden), false, `바깥에 쓰는 흔적: ${forbidden}`);
    }
  });

  test("🔴 세는 일을 제 손으로 하지 않는다 — 순수 함수 둘을 부른다", () => {
    assert.equal(code.match(/summarizeDeliveredDateSync\(/g)?.length, 1);
    assert.equal(code.match(/deliveredDateSurveyMismatch\(/g)?.length, 1);
    // 검산이 **찍기보다 앞**에 서야 한다 — 샌 수를 먼저 보여 주고 나서 멈추면 늦는다.
    assert.ok(
      code.indexOf("deliveredDateSurveyMismatch(") < code.indexOf("─ 범위"),
      "검산보다 보고가 먼저 찍힌다"
    );
    assert.ok(code.includes("process.exitCode = 1"), "어긋나도 성공으로 끝난다");
  });

  test("🔴 PII 를 글자로 꺼내지 않는다 — 납품자·비고는 **있나 없나**로만 받는다", () => {
    // 조회가 그 칸의 값을 실어 오지 않는다(`is not null` 로 접어서 받는다).
    assert.match(code, /hasDeliveredBy:\s*sql<boolean>/);
    assert.match(code, /hasNote:\s*sql<boolean>/);
    // 그 칸 이름이 나오는 자리는 각각 그 한 줄뿐이다.
    assert.equal(code.match(/domesticOrders\.deliveredBy/g)?.length, 2);
    assert.equal(code.match(/domesticOrderDueDates\.note/g)?.length, 2);
    // 고객사·형식·L/N·S/N 은 애초에 조회에 없다.
    for (const forbidden of ["customerId", "customers", "modelNameText", "lotNumberText", "serialNumberText", "intakeNumberText"]) {
      assert.equal(code.includes(forbidden), false, `PII 로 가는 칸을 읽는다: ${forbidden}`);
    }
  });

  test("🔴 갈래는 `repair_case_id` 하나로 가른다 — 기타건 현황과 같은 자", () => {
    assert.match(code, /linkedToRepairCase:\s*sql<boolean>`\$\{domesticOrders\.repairCaseId\} is not null`/);
    // 🔴 수리 건 쪽을 innerJoin 으로 바꾸면 기타건이 통째로 사라진다.
    assert.equal(code.includes("innerJoin"), false, "innerJoin 이 생겼다 — 기타건이 사라진다");
    assert.equal(code.match(/leftJoin\(/g)?.length, 3);
    // 거르는 조건은 내자 줄의 휴지통 하나뿐이다(수리 건의 휴지통으로 거르지 않는다).
    assert.equal(code.includes("eq(repairCases.isDeleted, true)"), false);
  });

  test("🔵 머리말이 「읽기만 한다」와 운영에서 부르는 꼴을 적고 있다", () => {
    assert.ok(source.includes("npm run check:delivered-date-sync"));
    assert.ok(source.includes("tools-as"), "운영에서 부르는 꼴이 없다");
    assert.ok(source.includes("개발 DB 로는 규모를 못 잽니다"), "어디서 잰 수인지 안 적는다");
  });
});
