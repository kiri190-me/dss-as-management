import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { approvalTypeEnum, shipmentApprovalRouteScopeEnum } from "@/lib/db/schema";
import { findDestructiveOperations } from "../migration-safety";
import {
  DOMESTIC_ORDER_APPROVAL_ROUTE_SCOPE,
  DOMESTIC_ORDER_APPROVAL_TYPE,
} from "@/lib/domain/domestic-order-approval-rules";
import { REPAIR_CASE_APPROVAL_TYPES } from "@/lib/validation/repair-case-approval-input";

/**
 * ============================================================================
 * 기타건 최종 출하 승인 — 표 바꾸기가 **안전한가** (2026-11-06, 0124)
 * ============================================================================
 * db/schema/quote-approvals-safety.test.ts 와 같은 자리다. DB 에 붙지 않고
 * **마이그레이션 글자와 스키마 모듈**만 읽는다 — 그래서 unit 목록에서 돈다.
 *
 * 여기서 못 박는 것 넷:
 *  1. 0124 는 **더하기만 한다** — 사라지는 자료가 없다.
 *  2. 🔴 **CHECK 이 `::text` 로 견준다.** 이것이 깨지면 마이그레이션이 **적용 자체가
 *     안 된다** — 아래 그 시험의 주석에 전문이 있다.
 *  3. 새 enum 값은 **맨 끝**에 붙는다(ALTER TYPE ... ADD VALUE 는 언제나 뒤다).
 *  4. 🔴 기타건 승인 종류는 **`RepairCaseApprovalType` 이 아니다** — 두 벌로 갈라
 *     두는 것이 접수 건 조회가 기타건 행을 집어 들지 않게 하는 두 번째 겹이다.
 * ============================================================================
 */

const migration = readFileSync(
  new URL("../../../../drizzle/0124_deep_masked_marvel.sql", import.meta.url),
  "utf8"
).replace(/\r\n/g, "\n");

const statements = migration
  .split("--> statement-breakpoint")
  .map((part) => part.trim())
  .filter((part) => part.length > 0);

describe("0124 — 더하기만 한다", () => {
  test("사라지는 자료가 없다", () => {
    // 🔵 `DROP CONSTRAINT` 가 둘 있지만 그것은 **같은 파일에서 다시 세우는** CHECK 이다
    //    (식을 넓히려면 drizzle 이 지웠다 다시 만든다). migration-safety 는 그것을
    //    「자료가 사라지는 문장」으로 세지 않는다 — db:preflight 의 「살펴볼 문장」으로만
    //    보고된다.
    assert.deepEqual(findDestructiveOperations(migration), []);
  });

  test("🔴 건드리는 표는 repair_case_approvals 하나다", () => {
    const touched = [...migration.matchAll(/ALTER TABLE "([^"]+)"/g)].map((match) => match[1]);
    assert.ok(touched.length > 0, "표를 하나도 건드리지 않는다 — 이 시험이 아무것도 재지 못한다");
    assert.deepEqual([...new Set(touched)], ["repair_case_approvals"]);
    // 🔴 `domestic_orders` 를 건드리지 않는다. 이 저장소는 select() 전체 조회가 새 칸을
    //    곧바로 싣는다 — 그 표에 칸이 더해지면 적용 전까지 개발 서버가 깨진다.
    assert.doesNotMatch(migration, /ALTER TABLE "domestic_orders"/);
  });

  test("더하는 칸은 domestic_order_id 하나다", () => {
    const added = [...migration.matchAll(/ADD COLUMN "([^"]+)"/g)].map((match) => match[1]);
    assert.deepEqual(added, ["domestic_order_id"]);
    // NULL 을 허용한다 — 이미 쌓여 있는 76행이 그대로 통과해야 한다(NOT NULL 이면
    // 적용 자체가 실패한다).
    assert.match(migration, /ADD COLUMN "domestic_order_id" uuid;/);
    assert.ok(!/ADD COLUMN "domestic_order_id" uuid NOT NULL/.test(migration));
  });

  test("새 enum 값은 둘이고 글자가 같다", () => {
    const added = [...migration.matchAll(/ADD VALUE '([^']+)'/g)].map((match) => match[1]);
    assert.deepEqual(added, ["DOMESTIC_ORDER_FINAL_SHIPMENT", "DOMESTIC_ORDER_FINAL_SHIPMENT"]);
    // 🔴 `BEFORE` 로 끼워 넣지 않는다 — 가운데에 넣으면 코드 배열의 순서와 실제 DB 가
    //    어긋나고, 다음 db:generate 가 있지도 않은 차이를 만든다.
    assert.ok(!/ADD VALUE '[^']+' BEFORE/.test(migration));
  });

  test("🔴 기타건 결재도 「한 번에 하나」가 DB 에서 보증된다", () => {
    assert.match(
      migration,
      /CREATE UNIQUE INDEX "repair_case_approvals_one_active_domestic_request"[\s\S]*?WHERE status = 'REQUESTED'/
    );
    // 🔴 접수 건 쪽 색인은 **건드리지 않는다** — 새 색인이 그것을 대신한 것이 아니다.
    assert.ok(!/DROP INDEX "repair_case_approvals_one_active_request"/.test(migration));
  });

  /**
   * ============================================================================
   * 🔴 CHECK 은 enum 리터럴이 아니라 `::text` 로 견준다
   * ============================================================================
   * drizzle 의 migrate 는 **밀린 마이그레이션 전부를 트랜잭션 하나**에 넣는다. 그 안에서
   * `ALTER TYPE … ADD VALUE` 로 갓 더한 값을 enum 리터럴로 쓰면 Postgres 가 거절한다:
   *
   *   ERROR: unsafe use of new value "DOMESTIC_ORDER_FINAL_SHIPMENT" of enum type
   *
   * 2026-11-06 에 실제로 이 오류로 멈췄고, **파일을 둘로 쪼개도 소용이 없었다**(트랜잭션이
   * 하나다). 🔴 개발 PC 에서만 나는 문제가 아니다 — 운영 배포도 같은 명령을 쓰므로 거기서도
   * 똑같이 멈춘다. 그래서 글자로 못 박는다.
   * ============================================================================
   */
  test("🔴 CHECK 은 `approval_type::text` 로 견준다 — 리터럴로 되돌아가면 적용 자체가 안 된다", () => {
    const checkStatements = statements.filter((statement) =>
      /ADD CONSTRAINT "repair_case_approvals_[a-z_]+" CHECK/.test(statement)
    );
    assert.equal(checkStatements.length, 4, `CHECK 문장 수가 달라졌다: ${checkStatements.length}`);
    for (const statement of checkStatements) {
      assert.match(statement, /approval_type::text/, `enum 리터럴로 되돌아갔다: ${statement}`);
      assert.ok(
        !/approval_type (=|<>|IN) ?\('?[A-Z]/.test(statement.replace(/approval_type::text/g, "")),
        `enum 리터럴 비교가 남아 있다: ${statement}`
      );
    }
  });

  test("🔴 주체 칸 둘을 묶는 CHECK 이 서고, XOR 가 아니다", () => {
    assert.match(
      migration,
      /ADD CONSTRAINT "repair_case_approvals_domestic_order_only_for_domestic_type" CHECK \(domestic_order_id IS NULL OR approval_type::text = 'DOMESTIC_ORDER_FINAL_SHIPMENT'\)/
    );
    assert.match(
      migration,
      /ADD CONSTRAINT "repair_case_approvals_domestic_type_has_no_repair_case" CHECK \(approval_type::text <> 'DOMESTIC_ORDER_FINAL_SHIPMENT' OR repair_case_id IS NULL\)/
    );
    // 🔴 **「둘 중 정확히 하나」로 적지 않는다.** repair_case_id 는 접수 건을 영구
    //    삭제하면 NULL 이 되므로 **둘 다 NULL 인 행이 이미 있다**(2026-11-06 개발 DB
    //    실측 76행 중 18행). XOR 를 걸면 그 18행 때문에 적용 자체가 실패한다.
    assert.ok(
      !/repair_case_id IS NOT NULL\) <> \(domestic_order_id IS NOT NULL/.test(migration),
      "XOR 로 적혔다 — 이미 있는 행이 거절된다"
    );
  });
});

describe("승인 종류 · 결재선 용도의 enum", () => {
  test("🔴 승인 종류는 셋이고 새 값은 맨 끝이다", () => {
    const values = [...approvalTypeEnum.enumValues];
    assert.deepEqual(values, [
      "REPAIR_INSPECTION",
      "FINAL_SHIPMENT",
      "DOMESTIC_ORDER_FINAL_SHIPMENT",
    ]);
    assert.equal(values.at(-1), DOMESTIC_ORDER_APPROVAL_TYPE);
  });

  test("🔴 결재선 용도의 새 값도 맨 끝이다", () => {
    const values = [...shipmentApprovalRouteScopeEnum.enumValues];
    assert.equal(values.at(-1), DOMESTIC_ORDER_APPROVAL_ROUTE_SCOPE);
    assert.equal(values.filter((value) => value === DOMESTIC_ORDER_APPROVAL_ROUTE_SCOPE).length, 1);
  });

  /**
   * 🔴 **갈래 글자가 두 enum 에 각각 있다.** 한쪽은 `repair_case_approval_type`,
   * 다른 쪽은 `shipment_approval_route_scope` 다. 글자가 같다고 한 상수로 묶으면
   * 둘 중 하나만 바뀌어야 하는 날 함께 끌려간다.
   */
  test("갈래 글자는 같지만 서로 다른 enum 의 값이다", () => {
    assert.equal(DOMESTIC_ORDER_APPROVAL_TYPE, DOMESTIC_ORDER_APPROVAL_ROUTE_SCOPE);
    assert.ok((approvalTypeEnum.enumValues as readonly string[]).includes(DOMESTIC_ORDER_APPROVAL_TYPE));
    assert.ok(
      (shipmentApprovalRouteScopeEnum.enumValues as readonly string[]).includes(
        DOMESTIC_ORDER_APPROVAL_ROUTE_SCOPE
      )
    );
  });

  /**
   * ============================================================================
   * 🔴 기타건 승인 종류는 `RepairCaseApprovalType` 이 **아니다**
   * ============================================================================
   * 이것이 「접수 건 승인이 한 톨도 안 바뀐다」의 두 번째 겹이다. 접수 건 쪽 조회·화면·
   * 통합 승인함은 전부 그 타입으로 좁혀 있어서, 기타건 값을 그 목록에 넣는 순간 **열려
   * 있던 기타건 결재가 접수 건 종·배지·승인함에 조용히 섞인다.** 첫 번째 겹은
   * `repair_case_id` 가 언제나 NULL 인 것이다(표의 CHECK).
   *
   * 🔵 그래서 지금은 기타건 결재가 종에도 통합 승인함에도 뜨지 않는다 — 알림은 다음
   *    조각이다(2026-11-06 지시). 넓히려면 그때 **의도해서** 넓혀야 한다.
   * ============================================================================
   */
  test("🔴 접수 건 승인 종류 목록에는 기타건이 없다", () => {
    assert.deepEqual([...REPAIR_CASE_APPROVAL_TYPES], ["REPAIR_INSPECTION", "FINAL_SHIPMENT"]);
    assert.ok(
      !(REPAIR_CASE_APPROVAL_TYPES as readonly string[]).includes(DOMESTIC_ORDER_APPROVAL_TYPE),
      "기타건 결재가 접수 건 승인 종류로 들어갔다 — 종·배지·승인함에 섞인다"
    );
    // 🔵 재는 것이 비어 있지 않은지 — 접수 건 종류는 **실제로 표의 enum 의 부분집합**이다.
    for (const type of REPAIR_CASE_APPROVAL_TYPES) {
      assert.ok((approvalTypeEnum.enumValues as readonly string[]).includes(type));
    }
    assert.ok(approvalTypeEnum.enumValues.length > REPAIR_CASE_APPROVAL_TYPES.length);
  });
});
