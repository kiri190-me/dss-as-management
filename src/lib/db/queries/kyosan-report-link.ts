import "server-only";
import { and, count, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db } from "../client";
import { customers, products, repairCases, serviceReports, statusChangeHistories } from "../schema";
import { loadExistingCasesByIntakeNumber } from "./kyosan-intake-import";
import type { KyosanCaseCandidate } from "@/lib/kyosan/report-match";
import type { KyosanCaseState } from "@/lib/kyosan/report-preview";

/**
 * ============================================================================
 * 연락서 짝짓기 — 조회 (🔴 읽기만 한다)
 * ============================================================================
 * `src/lib/kyosan/report-match.ts` 가 DB 를 모르는 순수 함수라, 그 함수에 줄
 * 후보를 여기서 읽어 온다. **이 파일에는 쓰기가 한 줄도 없다** — 조각 S3a 는
 * 미리보기까지이고, 저장은 S3b 다.
 *
 * ── 접수번호로 찾는 일은 이미 있는 것을 쓴다 ─────────────────────────
 * `loadExistingCasesByIntakeNumber`(queries/kyosan-intake-import.ts)를 그대로
 * 부른다. 인수번호 유니크가 **휴지통까지 포함**이라는 것을 그쪽이 이미 알고
 * 있고, 화면이 「다른 건으로 보임」을 칠할 수 있도록 고객사명 · 모델 · S/N 을
 * 함께 돌려준다 — 짝짓기 검증에 필요한 것이 정확히 그 셋이다. L/N 만 그쪽에
 * 없어서 접수번호로 찾은 건은 L/N 견줌이 `unknown` 이 된다(순수 함수 쪽 규칙).
 *
 * ── S/N 후보는 왜 따로 읽는가 ────────────────────────────────────────
 * 접수번호를 못 읽은 연락서가 실측 469장에 10장 있다. 그때는 S/N 으로 후보만
 * 보여 주고 **사람이 고른다**(report-match.ts 머리말). 여기서 쓰는 견줌은
 * 「공백을 지우고 대문자로」까지다 — 전각/반각까지 누르는 NFKC 는 Postgres 에서
 * 할 수 없다. 그래서 표기가 크게 다르면 후보를 **못 찾는다**. 못 찾으면 답은
 * 「짝 없음 = 넣지 않는다」이므로 틀리는 방향이 안전한 쪽이다.
 *
 * ── 🔴 「이미 넣은 연락서」를 어디서 보는가 ──────────────────────────
 * 아직 연락서 원본 해시를 담는 칸이 **없다**(이번 조각은 스키마를 건드리지
 * 않는다). 그래서 과거 인수품 가져오기가 쓰는 것과 같은 자리를 본다 —
 * `status_change_histories.metadata` 의 `source` 가 `KYOSAN_REPORT` 이고
 * `sourceSha256` 이 적힌 줄이다. 지금은 그런 줄이 하나도 없으므로 언제나 빈
 * 답이 온다. 🔴 **S3b 는 저장할 때 이 모양으로 흔적을 남겨야 한다** — 남기지
 * 않으면 같은 연락서를 두 번 넣는 것을 아무도 못 막는다.
 * ============================================================================
 */

/** 흔적 metadata 의 `source` 값. 🔴 S3b 가 남길 값이고, 여기서는 읽기만 한다. */
export const KYOSAN_REPORT_SOURCE = "KYOSAN_REPORT" as const;

export type KyosanReportLinkTargets = {
  /** 접수번호 → 그 번호의 건(휴지통 포함). 유니크라 번호마다 0 또는 1개다. */
  casesByIntakeNumber: ReadonlyMap<string, KyosanCaseCandidate>;
  /** S/N 열쇠(공백 제거 · 대문자) → 그 S/N 을 단 건들. 여럿일 수 있다. */
  casesBySerialKey: ReadonlyMap<string, readonly KyosanCaseCandidate[]>;
  /** 위에서 나온 건들의 현재 상태(보고서 수 · 이미 넣은 연락서 해시). */
  caseStates: ReadonlyMap<string, KyosanCaseState>;
};

/** S/N · L/N 견줌 열쇠. `report-match.ts` 의 `identifierKey` 와 같은 규칙이다. */
export function serialLookupKey(value: string | null): string | null {
  if (value === null) return null;
  const key = value.normalize("NFKC").replace(/\s+/g, "").toUpperCase();
  return key === "" ? null : key;
}

/** 미리보기 한 번에 필요한 것을 한꺼번에 읽는다. 🔴 읽기 전용. */
export async function loadKyosanReportLinkTargets(input: {
  intakeNumbers: readonly string[];
  serialNumbers: readonly string[];
}): Promise<KyosanReportLinkTargets> {
  const serialKeys = [
    ...new Set(input.serialNumbers.map(serialLookupKey).filter((key): key is string => key !== null)),
  ];

  const [existing, bySerial] = await Promise.all([
    loadExistingCasesByIntakeNumber(input.intakeNumbers),
    loadCasesBySerialKey(serialKeys),
  ]);

  const casesByIntakeNumber = new Map<string, KyosanCaseCandidate>();
  for (const [intakeNumber, row] of existing) {
    casesByIntakeNumber.set(intakeNumber, {
      repairCaseId: row.repairCaseId,
      intakeNumber: row.intakeNumber,
      isDeleted: row.isDeleted,
      customerName: row.customerName,
      modelName: row.modelName,
      serialNumber: row.serialNumber,
      // 🔴 loadExistingCasesByIntakeNumber 는 L/N 을 돌려주지 않는다(머리말).
      lotNumber: null,
    });
  }

  const repairCaseIds = new Set<string>();
  for (const candidate of casesByIntakeNumber.values()) repairCaseIds.add(candidate.repairCaseId);
  for (const candidates of bySerial.values()) {
    for (const candidate of candidates) repairCaseIds.add(candidate.repairCaseId);
  }

  return {
    casesByIntakeNumber,
    casesBySerialKey: bySerial,
    caseStates: await loadKyosanCaseStates([...repairCaseIds]),
  };
}

/** S/N 으로 건을 찾는다 — 휴지통의 건도 돌려준다(사람이 보고 판단한다). */
export async function loadCasesBySerialKey(
  serialKeys: readonly string[]
): Promise<Map<string, KyosanCaseCandidate[]>> {
  const result = new Map<string, KyosanCaseCandidate[]>();
  const unique = [...new Set(serialKeys)];
  if (unique.length === 0) return result;

  const serialKeyExpression = sql<string>`upper(regexp_replace(${products.serialNumber}, '\s', '', 'g'))`;

  const rows = await db
    .select({
      repairCaseId: repairCases.id,
      intakeNumber: repairCases.intakeNumber,
      isDeleted: repairCases.isDeleted,
      customerName: customers.name,
      modelName: products.modelName,
      serialNumber: products.serialNumber,
      lotNumber: products.lotNumber,
      serialKey: serialKeyExpression,
    })
    .from(repairCases)
    .innerJoin(products, eq(products.id, repairCases.productId))
    .leftJoin(customers, eq(customers.id, repairCases.customerId))
    .where(and(isNotNull(products.serialNumber), inArray(serialKeyExpression, unique)));

  for (const row of rows) {
    const entry = result.get(row.serialKey) ?? [];
    entry.push({
      repairCaseId: row.repairCaseId,
      intakeNumber: row.intakeNumber,
      isDeleted: row.isDeleted,
      customerName: row.customerName,
      modelName: row.modelName,
      serialNumber: row.serialNumber,
      lotNumber: row.lotNumber,
    });
    result.set(row.serialKey, entry);
  }
  return result;
}

/** 건마다 「보고서가 몇 장인가 · 어떤 연락서를 이미 넣었는가」. */
export async function loadKyosanCaseStates(
  repairCaseIds: readonly string[]
): Promise<Map<string, KyosanCaseState>> {
  const unique = [...new Set(repairCaseIds)];
  const result = new Map<string, KyosanCaseState>();
  if (unique.length === 0) return result;

  for (const repairCaseId of unique) {
    result.set(repairCaseId, { repairCaseId, serviceReportCount: 0, importedSourceSha256: [] });
  }

  const [reportRows, importedRows] = await Promise.all([
    db
      .select({ repairCaseId: serviceReports.repairCaseId, reports: count() })
      .from(serviceReports)
      .where(and(inArray(serviceReports.repairCaseId, unique), eq(serviceReports.isDeleted, false)))
      .groupBy(serviceReports.repairCaseId),
    db
      .select({
        repairCaseId: statusChangeHistories.repairCaseId,
        sourceSha256: sql<string>`${statusChangeHistories.metadata} ->> 'sourceSha256'`,
      })
      .from(statusChangeHistories)
      .where(
        and(
          inArray(statusChangeHistories.repairCaseId, unique),
          sql`${statusChangeHistories.metadata} ->> 'source' = ${KYOSAN_REPORT_SOURCE}`,
          sql`${statusChangeHistories.metadata} ->> 'sourceSha256' is not null`
        )
      ),
  ]);

  for (const row of reportRows) {
    const state = result.get(row.repairCaseId);
    if (state) result.set(row.repairCaseId, { ...state, serviceReportCount: row.reports });
  }
  for (const row of importedRows) {
    if (row.repairCaseId === null) continue;
    const state = result.get(row.repairCaseId);
    if (!state) continue;
    result.set(row.repairCaseId, {
      ...state,
      importedSourceSha256: [...state.importedSourceSha256, row.sourceSha256],
    });
  }

  return result;
}
