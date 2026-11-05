import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * ============================================================================
 * `--replace` 는 **휴지통으로 보낸다** — 물리 삭제가 아니다 (2026-11-05)
 * ============================================================================
 * 들여오기를 다시 돌릴 때 옛 초안을 치우는 길이다. 두 번 막혔고, 두 번째 까닭이
 * 이것이었다:
 *
 * ── 🔴 실측한 결함 ──────────────────────────────────────────────────────
 * `replaceDraftProcedureTemplates` 는 행을 **물리적으로 지우는데**,
 * `procedure_templates` 를 가리키는 외래키 가운데 **편집 이력**
 * (`procedure_template_edit_history`)을 **안 지운다.** 그래서 편집 이력이 한 줄이라도
 * 있는 초안은 그 함수로 **영영 못 지운다**:
 * ```
 * Error: Failed query: delete from "procedure_templates" where "id" = $1
 * ```
 *
 * 🔵 그 빠짐은 **의도된 것이었다** — `purgeProcedureTemplateContent` 의 주석이
 * 「그쪽은 갓 가져온 초안만 지우므로 그 두 표에 행이 있을 수 없었다」고 적고 있다.
 * 🔴 **그 전제를 우리가 깨뜨렸다**: 잇기 단계와 끊기 단계가 `updateProcedureTemplateNode`
 * 로 편집 이력을 남긴다. 갓 가져온 초안에도 이제 이력이 생긴다.
 *
 * ── 🔴 왜 소스를 글자로 읽는가 ──────────────────────────────────────────
 * 이 성질은 **DB 에 붙어야** 값으로 재진다(편집 이력이 있는 초안을 만들고 지워 봐야
 * 한다). 그 시험은 `test:db` 목록의 일이고, 이 조각에서는 그것을 돌릴 수 없다.
 * 그래서 **되돌아가는 것만이라도** 막는다 — 누군가 다시 물리 삭제 함수로 바꾸면
 * 여기서 빨개진다. 이웃(procedures/node-chip-shape-id-hidden.test.ts)과 같은 방법이다.
 *
 * 🔴 **주석을 세면 안 된다.** 걷어낸 까닭을 주석에 길게 적어 두었고 그 안에
 * `replaceDraftProcedureTemplates` 가 그대로 들어 있다. 걸러내기가 일하고 있다는
 * 증거는 ②절에 값으로 둔다.
 * ============================================================================
 */

const repoUrl = new URL("../../../", import.meta.url);
const read = (relativePath: string) => readFileSync(new URL(relativePath, repoUrl), "utf8");

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split(/\r?\n/)
    .filter((line) => !/^\s*\/\//.test(line))
    .join("\n");
}

const IMPORT_SCRIPT = "scripts/import-technical-task-procedures.ts";

describe("--replace 는 휴지통으로 보낸다", () => {
  // ── ① 쓰는 함수 ────────────────────────────────────────────────────
  test("🔴 화면의 [초안 버리기]와 같은 길을 쓴다 — requireStatus 는 DRAFT", () => {
    const source = stripComments(read(IMPORT_SCRIPT));
    assert.match(source, /softDeleteProcedureTemplate\(\{/);
    assert.match(source, /requireStatus: "DRAFT"/);
  });

  test("🔴 **물리 삭제 함수를 안 부른다** — 편집 이력이 있으면 그 함수는 못 지운다", () => {
    const source = stripComments(read(IMPORT_SCRIPT));
    assert.equal(
      /replaceDraftProcedureTemplates\s*\(/.test(source),
      false,
      "물리 삭제 함수로 되돌아갔다 — 편집 이력이 있는 초안에서 다시 막힌다"
    );
  });

  // ── ② 걸러내기가 실제로 일한다 ─────────────────────────────────────
  test("🔴 주석 걸러내기가 돈다 — 안 돌면 ①이 제 주석에 걸려 빨개진다", () => {
    const raw = read(IMPORT_SCRIPT);
    assert.equal(
      raw.includes("replaceDraftProcedureTemplates"),
      true,
      "주석에서도 사라졌다 — ②가 공짜로 통과한다"
    );
    assert.equal(stripComments(raw).includes("replaceDraftProcedureTemplates"), false);
  });

  // ── ③ 끊기 단계는 그대로 필요하다 ──────────────────────────────────
  test("🔴 치우기 **전에** 이어가기를 끊는다 — 휴지통으로 보내는 길도 참조를 세어 막는다", () => {
    // `softDeleteProcedureTemplate` 은 countProcedureTemplateReferences 로
    // `pointedByEnd`(이어가기)를 세어 거절한다. 끊기를 빼면 다시 막힌다.
    const source = stripComments(read(IMPORT_SCRIPT));
    const unlinkAt = source.indexOf("planNextProcedureUnlinks");
    const deleteAt = source.indexOf("softDeleteProcedureTemplate({");
    assert.ok(unlinkAt > 0, "끊기 단계가 사라졌다");
    assert.ok(deleteAt > 0);
    assert.ok(unlinkAt < deleteAt, "끊기가 치우기보다 뒤에 있다 — 그러면 참조에 막힌다");
  });
});
