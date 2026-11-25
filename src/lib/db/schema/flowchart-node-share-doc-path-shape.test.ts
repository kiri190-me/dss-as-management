import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { getTableColumns } from "drizzle-orm";
import { PgDialect, getTableConfig } from "drizzle-orm/pg-core";

import {
  procedureTemplateNodes,
  productModelShareDocs,
  repairCaseFlowchartNodes,
} from "@/lib/db/schema";

/**
 * ============================================================================
 * 노드의 「파일 위치」 칸 — **베껴 온 제약이 원본과 같은가** (2026-11-22, 조각 E1)
 * ============================================================================
 * 흐름도 노드 둘(기술 절차 · 수리 건)에 `share_doc_relative_path` 가 생겼다. 그
 * 칸의 CHECK 는 운영에서 이미 도는 `product_model_share_docs_relative_path_shape`
 * 를 **글자 그대로 베껴 온 것**이다.
 *
 * ── 🔴 왜 시험이 필요한가 ───────────────────────────────────────────────
 * 「원본에서 베껴 왔다」는 주석으로만 적혀 있으면 **아무도 안 지킨다.** 셋 중
 * 하나만 고치는 날 tsc 도 lint 도 db:generate 도 한 마디 안 한다 — 셋 다 문법이
 * 맞는 CHECK 이기 때문이다. 어긋난 것은 한참 뒤, 한쪽에서만 막히는 경로가
 * 들어왔을 때 드러난다(그때는 이미 운영 DB 에 굳어 있다).
 *
 * ── 🔴 둘째로 재는 것: 상수가 바인딩 자리로 구워지지 않았는가 ───────────
 * drizzle 의 `sql` 템플릿은 **값을 끼워 넣으면** 그것을 `$1` 자리표시로 굽는다.
 * 그렇게 나온 마이그레이션은 **생성은 조용히 성공하고 적용할 때 깨진다.** 이
 * 저장소에 그 전례가 있어서 `procedure-template-nodes.ts` 의
 * next_procedure_template_id 칸 주석이 「CHECK 로 적지 않은 까닭」으로 그것을
 * 적어 두었다. 여기서는 `sqlToQuery(...).params` 가 **비어 있는지**를
 * 직접 재므로, 나중에 누가 이 CHECK 에 값을 끼워 넣으면 db:generate 를 돌리기
 * 전에 이 시험이 먼저 운다.
 *
 * ── 🔵 DB 없이 돈다 ─────────────────────────────────────────────────────
 * 실제로 그 CHECK 가 값을 막는지(= `../..` 를 넣으면 거부되는지)를 보는 시험은
 * DB 가 있어야 하고 다음 조각의 몫이다. 이 파일은 `npm test` 에서 도는 값싼
 * 그물이다 — 「세 벌이 어긋나는 순간」을 잡는 데는 그쪽보다 이쪽이 낫다.
 * ============================================================================
 */

const dialect = new PgDialect();

/** 그 표의 CHECK 가운데 이름이 `name` 인 것 하나를 SQL 글자로 푼다. */
function renderCheck(
  table: Parameters<typeof getTableConfig>[0],
  name: string
): { sql: string; params: unknown[] } {
  const found = getTableConfig(table).checks.find((c) => c.name === name);
  assert.ok(found, `CHECK "${name}" 을 못 찾았다 — 이름이 바뀌었거나 제약이 사라졌다`);
  const query = dialect.sqlToQuery(found.value);
  return { sql: query.sql, params: query.params as unknown[] };
}

/**
 * 표·칸 이름만 다르고 나머지가 같은지 보려고, **그 칸을 가리키는 모든 모양**을
 * 한 글자(`@`)로 바꾸고 공백을 한 칸으로 접는다. drizzle 은 칸을
 * `"표"."칸"` 으로 완전히 적어 내므로 표마다 글자가 다를 수밖에 없다 —
 * 그 차이만 걷어 내고 **식 자체**를 맞댄다.
 */
function foldColumnRefs(sql: string, tableName: string, columnName: string): string {
  return sql
    .split(`"${tableName}"."${columnName}"`)
    .join("@")
    .replace(/\s+/g, " ")
    .trim();
}

const PRODUCT_MODEL_CHECK = "product_model_share_docs_relative_path_shape";
const PROCEDURE_CHECK = "procedure_template_nodes_share_doc_relative_path_shape";
const FLOWCHART_CHECK = "repair_case_flowchart_nodes_share_doc_relative_path_shape";

describe("조각 E1 — ① 먼저 표본 확인", () => {
  test("🔵 셋을 실제로 떼어 냈고, 비어 있지 않고, 서로 다른 글자다", () => {
    const base = renderCheck(productModelShareDocs, PRODUCT_MODEL_CHECK);
    const procedure = renderCheck(procedureTemplateNodes, PROCEDURE_CHECK);
    const flowchart = renderCheck(repairCaseFlowchartNodes, FLOWCHART_CHECK);

    // 비어 있으면 아래 맞대기가 전부 공짜로 통과한다.
    assert.ok(base.sql.length > 200, `원본 CHECK 가 ${base.sql.length}자뿐이다 — 떼어 내기가 틀렸다`);
    assert.ok(procedure.sql.length > 200, "기술 절차 CHECK 를 못 떼어 냈다");
    assert.ok(flowchart.sql.length > 200, "수리 건 흐름도 CHECK 를 못 떼어 냈다");

    // 접기 전에는 표 이름 때문에 셋이 서로 달라야 한다. 같다면 세 번 모두
    // 같은 것을 떼어 낸 것이고, 그러면 아래가 자기 자신과 비교하게 된다.
    assert.notEqual(base.sql, procedure.sql);
    assert.notEqual(procedure.sql, flowchart.sql);

    // 접기가 실제로 일을 하는가 — 칸 이름이 한 글자도 안 남아야 한다.
    const folded = foldColumnRefs(procedure.sql, "procedure_template_nodes", "share_doc_relative_path");
    assert.equal(folded.includes("procedure_template_nodes"), false, "접기가 일을 안 하고 있다");
    assert.ok(folded.includes("@"), "접기 뒤에 칸 자리가 남아 있어야 한다");
  });

  test("🔵 재는 대상이 맞는가 — 두 노드 표에 그 칸이 있고 **NULL 을 받는다**", () => {
    for (const [label, table] of [
      ["기술 절차", procedureTemplateNodes],
      ["수리 건 흐름도", repairCaseFlowchartNodes],
    ] as const) {
      const column = getTableColumns(table).shareDocRelativePath;
      assert.ok(column, `${label} 노드에 shareDocRelativePath 칸이 없다`);
      assert.equal(column.name, "share_doc_relative_path", `${label}: DB 칸 이름이 다르다`);
      assert.equal(column.dataType, "string", `${label}: text 칸이어야 한다`);
      // 🔴 안 가리킨 노드가 기본이다. NOT NULL 로 바뀌면 지금 있는 모든 행이
      //    값을 가져야 하고, 그 순간 마이그레이션이 적용되지 않는다.
      assert.equal(column.notNull, false, `${label}: 이 칸은 NULL 을 받아야 한다`);
      assert.equal(column.hasDefault, false, `${label}: 기본값을 두면 「안 가리킴」이 사라진다`);
    }
  });
});

describe("조각 E1 — 베껴 온 경로 모양 제약이 원본과 어긋나지 않는다", () => {
  test("🔴 상수가 바인딩 자리로 구워지지 않았다 — 셋 모두 params 가 비어 있다", () => {
    for (const [label, rendered] of [
      ["제품 모델(원본)", renderCheck(productModelShareDocs, PRODUCT_MODEL_CHECK)],
      ["기술 절차 노드", renderCheck(procedureTemplateNodes, PROCEDURE_CHECK)],
      ["수리 건 흐름도 노드", renderCheck(repairCaseFlowchartNodes, FLOWCHART_CHECK)],
    ] as const) {
      assert.deepEqual(
        rendered.params,
        [],
        `${label}: CHECK 에 값을 끼워 넣었다 — 그대로 db:generate 하면 $1 이 박힌 채 생성되고 적용할 때 깨진다`
      );
      assert.equal(
        /\$\d/.test(rendered.sql),
        false,
        `${label}: 생성될 SQL 에 자리표시($1)가 남아 있다`
      );
    }
  });

  test("🔴 두 노드 표의 식은 원본에 `IS NULL OR (…)` 한 겹만 두른 것이다", () => {
    const base = foldColumnRefs(
      renderCheck(productModelShareDocs, PRODUCT_MODEL_CHECK).sql,
      "product_model_share_docs",
      "relative_path"
    );
    // 🔵 원본이 NOT NULL 칸이라 저쪽에는 이 한 겹이 없다. 노드 쪽은 안 가리킨
    //    것이 기본이므로 값이 있을 때만 재야 한다.
    const expected = `@ IS NULL OR ( ${base} )`;

    assert.equal(
      foldColumnRefs(
        renderCheck(procedureTemplateNodes, PROCEDURE_CHECK).sql,
        "procedure_template_nodes",
        "share_doc_relative_path"
      ),
      expected,
      "기술 절차 노드의 경로 모양 제약이 제품 모델 쪽 원본과 어긋났다 — 셋을 함께 고쳐라"
    );
    assert.equal(
      foldColumnRefs(
        renderCheck(repairCaseFlowchartNodes, FLOWCHART_CHECK).sql,
        "repair_case_flowchart_nodes",
        "share_doc_relative_path"
      ),
      expected,
      "수리 건 흐름도 노드의 경로 모양 제약이 제품 모델 쪽 원본과 어긋났다 — 셋을 함께 고쳐라"
    );
  });

  test("🔴 막기로 한 것 일곱이 식에 하나도 안 빠졌다", () => {
    // 위 맞대기만 있으면 **셋을 한꺼번에 약하게 고치는 날** 조용히 통과한다
    // (셋이 여전히 같기 때문이다). 그래서 무엇을 막는지를 여기 따로 못 박는다.
    const folded = foldColumnRefs(
      renderCheck(procedureTemplateNodes, PROCEDURE_CHECK).sql,
      "procedure_template_nodes",
      "share_doc_relative_path"
    );
    const mustHave: Array<[string, string]> = [
      ["길이 1..400", "char_length(@) between 1 and 400"],
      ["앞뒤 공백", "@ = btrim(@)"],
      ["역슬래시", "strpos(@, chr(92)) = 0"],
      ["윈도우 금지 글자(: 포함 — C:/ 를 막는다)", `@ !~ '[|<>"?*:]'`],
      ["제어문자", "@ !~ '[[:cntrl:]]'"],
      ["앞뒤 슬래시·빈 마디", "@ !~ '(^/)|(/$)|(//)'"],
      ["점 마디(거슬러 오르기)", "@ !~ '(^|/)[.]{1,2}(/|$)'"],
    ];
    const haystack = folded.toLowerCase();
    for (const [label, needle] of mustHave) {
      assert.ok(
        haystack.includes(needle.toLowerCase()),
        `경로 모양 제약에서 「${label}」 가 빠졌다`
      );
    }
  });
});
