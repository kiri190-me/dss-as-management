"use client";

import Link from "next/link";

import { LIST_CARD_GRID } from "@/components/common/responsive-list";
import { domesticOrderDetailHrefs } from "@/lib/domain/domestic-order-detail-tabs";
import { MISC_CASE_FIELDS, type MiscCaseField, type MiscCaseRow } from "./misc-case-fields";

/**
 * ============================================================================
 * 「기타건 현황」의 카드 — 좁은 화면 (2026-11-06)
 * ============================================================================
 * 표가 안 들어가는 폭에서 ResponsiveList 가 이것을 그린다. 생김새는 내자 정리의
 * 카드에서 가져왔다(이름표 작은 회색 글자 + 값, 두 칸 격자).
 *
 * 🔴 **칸의 이름표와 값은 표와 한 벌에서 온다**(misc-case-fields.tsx). 좁은 화면이라고
 * 보이던 값이 사라지거나 다른 글자가 되면, 같은 자료가 **화면 폭에 따라 다르게**
 * 읽힌다 — 내자 정리가 적어 둔 표/카드 원칙 그대로다.
 *
 * ⚠️ **표와 일부러 다른 점 둘.**
 *  ① 표는 칸 아홉을 주/보조로 포개지만 카드는 **세로로 다 편다** — 카드는 폭이 아니라
 *    길이가 넉넉한 자리라 포갤 까닭이 없고, 포개면 어느 값이 어느 이름표의 것인지
 *    이름표 하나에 값 둘이 붙는다.
 *  ② `현황` 을 두 줄에서 자르지 않는다. 카드는 칸들이 세로로 서므로 길어져도 옆줄이
 *    밀리지 않는다(내자 정리가 납기요청일 칸에서 같은 판단을 했다 — 2026-10-30).
 *    사람이 줄바꿈을 섞어 적는 칸이라 적은 그대로 여러 줄로 그린다.
 * ============================================================================
 */

/** 카드에서 세로로 펴는 차례. 표의 포갠 짝과 **같은 짝끼리 붙여** 둔다. */
const CARD_FIELD_KEYS: readonly (keyof typeof MISC_CASE_FIELDS)[] = [
  "status",
  "customerName",
  "quoteNumber",
  "quoteIssuedDate",
  "purchaseOrderNumber",
  "orderIssuedDate",
  "projectName",
  "progressNote",
  "amount",
  "paymentCompleted",
  "deliveredDate",
];

/** 사람이 줄바꿈을 섞어 적는 칸 — 적은 그대로 여러 줄로(위 ②). */
const MULTILINE_KEYS: ReadonlySet<string> = new Set(["progressNote"]);

export default function MiscCaseCardList({ rows }: { rows: readonly MiscCaseRow[] }) {
  return (
    <div className={LIST_CARD_GRID}>
      {rows.map((row) => (
        <div
          key={row.id}
          className="flex flex-col gap-2 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
        >
          {/* 카드의 머리 — 표의 첫 칸과 같은 값(품명 링크)이다. 누르면 기타건 상세로
              가고, 그 판정은 표와 **같은 조각**이 한다. */}
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="font-semibold break-words text-zinc-900 dark:text-zinc-50">
              {MISC_CASE_FIELDS.modelName.of(row)}
            </span>
            <Link
              href={domesticOrderDetailHrefs(row.id).root}
              className="text-sm text-zinc-600 underline-offset-2 hover:underline dark:text-zinc-400"
            >
              상세
            </Link>
          </div>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm text-zinc-600 dark:text-zinc-400">
            {CARD_FIELD_KEYS.map((key) => {
              const field: MiscCaseField = MISC_CASE_FIELDS[key];
              return (
                <div key={key}>
                  <dt className="text-xs text-zinc-500 dark:text-zinc-500" title={field.hint}>
                    {field.label}
                  </dt>
                  <dd
                    className={
                      MULTILINE_KEYS.has(key)
                        ? "break-words whitespace-pre-line"
                        : "break-words"
                    }
                  >
                    {field.of(row)}
                  </dd>
                </div>
              );
            })}
          </dl>
        </div>
      ))}
    </div>
  );
}
