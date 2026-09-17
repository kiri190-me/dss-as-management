import type { RepairCaseUsedPartRow } from "@/lib/db/queries/repair-case-used-parts";

/**
 * ============================================================================
 * 「사용 부품」 칸 — 이 건에서 무엇을 갈았나
 * ============================================================================
 * 왜 있는 칸인지는 schema/repair-case-used-parts.ts 와
 * queries/repair-case-used-parts.ts 머리말에 있다. 화면 쪽 규칙만 여기 적는다.
 *
 * ── 🔴 적을 자리는 한 건에 하나뿐이다 (사용자 확정 규칙) ────────────────
 * 그 건에 살아 있는 부품 요청(반출) 줄이 있으면 **적을 자리를 그리지 않고**
 * 안내 한 줄만 낸다. 요청서와 손글씨가 같은 건에 함께 있으면 통계가 같은 부품을
 * 두 번 세기 때문이다.
 *
 * ── 🔴 이 조각에는 적는 길이 없다 ───────────────────────────────────────
 * 읽기까지다. 입력 칸 · 단추 · 서버 액션이 하나도 없고, 그래서 "use client" 도
 * 필요 없다(부모 RepairCaseDetailView 가 이미 클라이언트 경계 안이라 거기 얹혀
 * 그려진다). 적고 저장하는 길은 다음 조각(B-2)이 낸다.
 *
 * ── 이력과 손글씨가 겹친 건 ─────────────────────────────────────────────
 * 요청서를 **나중에** 내면 이미 적어 둔 줄이 남을 수 있다(DB 가 막지 않는다 —
 * 스키마 머리말). 그때 줄을 감추면 두 번 세어질 자료가 화면에서 사라져 아무도
 * 고칠 수 없게 되므로, 안내와 함께 **그대로 보여 주고 확인을 청한다.** 적을
 * 자리는 여전히 그리지 않는다.
 * ============================================================================
 */
export default function UsedPartsSection({
  rows,
  hasPartRequestHistory,
}: {
  /** `line_no` 차례대로 온다 — 여기서 다시 정렬하지 않는다(정렬은 조회 몫). */
  rows: readonly RepairCaseUsedPartRow[];
  hasPartRequestHistory: boolean;
}) {
  const hasRows = rows.length > 0;

  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">사용 부품</h2>
        {hasRows && (
          <span className="text-xs text-zinc-500 dark:text-zinc-400">{rows.length}건</span>
        )}
      </div>

      {hasPartRequestHistory && (
        <p className="mt-2 text-xs text-zinc-600 dark:text-zinc-400">
          이 건의 부품은 아래 <span className="font-medium">부품 요청(반출) 이력</span>에서 잡힙니다. 같은
          부품이 두 번 세어지지 않도록 여기에는 따로 적지 않습니다.
        </p>
      )}

      {hasPartRequestHistory && hasRows && (
        <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
          아래 줄은 반출 이력이 생기기 전에 손으로 적어 둔 것입니다. 같은 부품이 두 번 세어질 수 있으니
          확인이 필요합니다.
        </p>
      )}

      {!hasPartRequestHistory && !hasRows && (
        <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">아직 적힌 것이 없습니다.</p>
      )}

      {hasRows && (
        <div className="mt-3 overflow-hidden rounded-md border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-xs">
            <thead className="bg-zinc-50 text-left text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
              <tr>
                <th className="px-2 py-1 font-medium">품명</th>
                <th className="w-24 px-2 py-1 text-right font-medium">수량</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-t border-zinc-100 dark:border-zinc-800">
                  <td className="px-2 py-1 text-zinc-900 dark:text-zinc-100">{row.partNameText}</td>
                  <td className="px-2 py-1 text-right tabular-nums text-zinc-900 dark:text-zinc-100">
                    {row.quantity}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
