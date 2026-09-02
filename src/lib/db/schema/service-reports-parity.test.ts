import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import type { ServiceReportFormValues } from "@/lib/domain/service-report-form";
import type { ServiceReportOccurredOnMode } from "@/lib/domain/service-report-form";
import {
  SERVICE_REPORT_CAUSES,
  SERVICE_REPORT_TITLES,
  type ServiceReportInput,
} from "@/lib/xlsx/service-report-template";

import { findDestructiveOperations } from "../migration-safety";
import {
  serviceReportCauseEnum,
  serviceReportKindEnum,
  serviceReportLineSectionEnum,
  serviceReportOccurredOnModeEnum,
  serviceReports,
  serviceReportLines,
} from "./service-reports";

/**
 * ============================================================================
 * 보고서 표의 enum 이 코드와 갈라지는 것을 막는다
 * ============================================================================
 * 0037·0038·0039 시험이 세운 선례를 따른다 — 스키마 쪽 결정 가운데 **어긋나도
 * 아무 오류가 안 나는 것**만 골라 파일 내용으로 못 박아 둔다.
 *
 * ── 🔴 값을 여기 베껴 적지 않는다 ───────────────────────────────────────
 * `schema/service-reports.ts` 는 원인 열 가지를 **사본으로** 들고 있다. 원본
 * (`xlsx/service-report-template.ts`)을 값으로 가져올 수 없기 때문이다 — 그 모듈이
 * `zip-reader.ts` 를 거쳐 `node:fs` 를 끌고 오고, 스키마는 drizzle-kit 과 서버
 * 양쪽에서 읽힌다.
 *
 * 사본이 있으면 갈라질 자리도 있다. 그 자리를 여기서 막는데, **시험에도 값을
 * 베껴 적으면 아무 소용이 없다** — 세 곳이 되면 두 곳만 고쳐졌을 때 시험이 오히려
 * 틀린 쪽 편을 든다. 그래서 이 파일은 값을 적지 않고 **스키마와 코드 상수를 서로
 * 견주기만** 한다.
 *
 * 값이 아니라 **이름**을 적어야 하는 자리(구역 ↔ 요청 본문의 칸 이름)는 `Record`
 * 의 키·값 타입을 양쪽에 묶어 tsc 가 견주게 했다. 어느 한쪽이 바뀌면 컴파일이
 * 깨진다.
 * ============================================================================
 */

// ── 원인 열 가지 ─────────────────────────────────────────────────────────

test("service_report_cause 는 SERVICE_REPORT_CAUSES 와 개수도 값도 순서도 같다", () => {
  // 순서까지 보는 것은 일부러다. 양식의 체크박스는 29·30행에 다섯씩 놓여 있고
  // (`CAUSE_CELLS`), 화면의 체크박스도 그 차례로 그린다. enum 의 차례가 어긋나면
  // 자료는 멀쩡한데 사람이 보는 순서만 달라져 알아채기 어렵다.
  assert.deepEqual([...serviceReportCauseEnum.enumValues], [...SERVICE_REPORT_CAUSES]);
});

// ── 보고서 종류 ──────────────────────────────────────────────────────────

test("service_report_kind 는 ServiceReportKind 와 같다", () => {
  // `ServiceReportKind` 는 타입이라 실행 중에 견줄 수 없다. `SERVICE_REPORT_TITLES`
  // 가 `Record<ServiceReportKind, string>` 이므로 그 키가 곧 종류 전부다 —
  // 종류가 늘면 tsc 가 그쪽 표를 먼저 막는다.
  assert.deepEqual([...serviceReportKindEnum.enumValues], Object.keys(SERVICE_REPORT_TITLES));
});

// ── 발생 년월일의 두 갈래 ────────────────────────────────────────────────

/**
 * `Record<ServiceReportOccurredOnMode, true>` 라, 화면 쪽 union 에 갈래가 늘거나
 * 줄면 **이 표에서 tsc 가 먼저 깨진다.** 아래 시험은 그 키를 스키마 enum 과 견준다.
 */
const OCCURRED_ON_MODES: Record<ServiceReportOccurredOnMode, true> = {
  DATE: true,
  TEXT: true,
};

test("service_report_occurred_on_mode 는 화면의 ServiceReportOccurredOnMode 와 같다", () => {
  assert.deepEqual([...serviceReportOccurredOnModeEnum.enumValues], Object.keys(OCCURRED_ON_MODES));
});

// ── 본문 구역 ────────────────────────────────────────────────────────────

type ServiceReportLineSection = (typeof serviceReportLineSectionEnum.enumValues)[number];

type RepairServiceReportInput = Extract<ServiceReportInput, { kind: "REPAIR" }>;

/**
 * 요청 본문에서 **줄 목록으로** 오는 칸들. `findingsIntro` 는 줄 목록이 아니라
 * 한 줄짜리 머리글이라 뺀다(그 칸은 `service_reports.findings_intro` 에 있다).
 */
type ServiceReportLineFieldKey =
  | Exclude<keyof RepairServiceReportInput["body"], "findingsIntro">
  | Extract<keyof RepairServiceReportInput, "remark">;

/**
 * 구역 이름 ↔ 그 줄들이 오는 칸 이름.
 *
 * 🔴 이 표 하나가 세 곳을 함께 묶는다:
 *   · 키   = 스키마 enum 의 값 전부(빠지거나 늘면 tsc 가 깨진다)
 *   · 값   = 검증이 받는 `ServiceReportInput` 의 칸 이름이면서
 *            동시에 화면이 들고 있는 `ServiceReportFormValues` 의 칸 이름
 *
 * 그래서 어느 쪽 이름이 바뀌어도 컴파일 단계에서 걸린다.
 */
const SECTION_FIELD: Record<
  ServiceReportLineSection,
  ServiceReportLineFieldKey & keyof ServiceReportFormValues
> = {
  FINDINGS: "findings",
  ACTIONS: "actions",
  SUMMARY: "summary",
  REMARK: "remark",
};

test("service_report_line_section 은 화면·검증이 쓰는 구역 이름과 짝이 맞는다", () => {
  assert.deepEqual([...serviceReportLineSectionEnum.enumValues], Object.keys(SECTION_FIELD));

  // 이름 짓는 규칙까지 못 박는다 — 구역 이름을 소문자로 내리면 그 칸 이름이다.
  // (`FINDINGS`·`ACTIONS`·`SUMMARY` 는 `body.*`, `REMARK` 만 본문 바깥의 `remark`.)
  for (const section of serviceReportLineSectionEnum.enumValues) {
    assert.equal(SECTION_FIELD[section], section.toLowerCase());
  }
});

// ── 🔴 findings_intro — 「안 줌」과 「일부러 비움」 ───────────────────────

test("findings_intro 는 NOT NULL 도 기본값도 없다", () => {
  /**
   * 채우개가 `body.findingsIntro ?? SERVICE_REPORT_FINDINGS_INTRO` 로 판정한다.
   * `NULL` 은 "안 줌"이라 정형 문구가 들어가고, `''` 는 "일부러 비움"이라 아무것도
   * 안 들어간다. NOT NULL 이나 DEFAULT 를 걸면 그 둘을 나눌 수 없어져 **사람이
   * 지운 문장이 다시 열었을 때 되살아난다** — 오류도 경고도 없이.
   */
  assert.equal(serviceReports.findingsIntro.notNull, false);
  assert.equal(serviceReports.findingsIntro.hasDefault, false);
});

test("본문 줄의 text 는 NOT NULL 이되 기본값이 없다", () => {
  // 빈 글자(`''`)가 정상 값이다 — 문서에서 한 줄 띄우라는 뜻이라 걸러내면 문단
  // 나누기가 사라진다. 기본값을 걸면 "안 준 줄"이 조용히 빈 줄로 바뀐다.
  assert.equal(serviceReportLines.text.notNull, true);
  assert.equal(serviceReportLines.text.hasDefault, false);
});

// ── 0077 이 무엇을 하는가 ────────────────────────────────────────────────

const MIGRATION_PATH = "drizzle/0077_hard_rhino.sql";
const migration = readFileSync(MIGRATION_PATH, "utf8").trim();

test("0077 은 만들기만 한다 — 지우거나 바꾸는 문장이 하나도 없다", () => {
  assert.deepEqual(findDestructiveOperations(migration), []);

  // 위 검사는 DROP/TRUNCATE/DELETE 를 찾는다. 여기서는 반대로 **허용하는 모양만
  // 통과**시킨다 — 새 표를 만드는 마이그레이션에 다른 종류의 문장이 섞여 들어오면
  // (기존 표의 열을 고치는 ALTER 같은 것) 그 자체가 사고다.
  const statements = migration
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter((statement) => statement !== "");
  assert.ok(statements.length > 0);
  for (const statement of statements) {
    assert.match(
      statement,
      /^(?:CREATE TYPE|CREATE TABLE|CREATE INDEX|CREATE UNIQUE INDEX|ALTER TABLE "service_report(?:s|_lines|_causes)" ADD CONSTRAINT)\b/,
      `0077 에 만들기 아닌 문장이 있다: ${statement.slice(0, 80)}`
    );
  }
});

test("0077 이 만드는 표는 보고서 셋뿐이다", () => {
  const created = [...migration.matchAll(/CREATE TABLE "([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(created.sort(), [
    "service_report_causes",
    "service_report_lines",
    "service_reports",
  ]);
});

test("0077 의 원인 enum 은 코드 상수와 같은 순서로 적혀 있다", () => {
  // 스키마와 코드가 맞아도 **SQL 을 손으로 고치면** 갈라진다. 적용되는 것은 이
  // 파일이므로 여기까지 견준다.
  const line = /CREATE TYPE "public"\."service_report_cause" AS ENUM\(([^)]*)\);/.exec(migration);
  assert.ok(line, "0077 에 service_report_cause 를 만드는 문장이 없다");
  const values = line[1].split(",").map((value) => value.trim().replace(/^'|'$/g, ""));
  assert.deepEqual(values, [...SERVICE_REPORT_CAUSES]);
});

test("0077 의 findings_intro 는 NOT NULL 도 DEFAULT 도 달고 있지 않다", () => {
  assert.match(migration, /^\t"findings_intro" text,$/m);
});
