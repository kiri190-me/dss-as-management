"use client";

import { useState } from "react";
import type { PartPickerRow } from "@/lib/db/queries/inventory";
import type { RepairCaseUsedPartRow } from "@/lib/db/queries/repair-case-used-parts";
import type { UsedPartsWriteGate } from "@/lib/auth/repair-case-used-parts-authorization";
import UsedPartsEditForm from "@/components/repair-cases/detail/edit/UsedPartsEditForm";

/**
 * ============================================================================
 * 「사용 부품」 칸 — 이 건에서 무엇을 갈았나
 * ============================================================================
 * 왜 있는 칸인지는 schema/repair-case-used-parts.ts 와
 * queries/repair-case-used-parts.ts 머리말에 있다. 화면 쪽 규칙만 여기 적는다.
 *
 * ── 🔴 적을 수 있는지는 **화면이 정하지 않는다** (B-2 · B-3) ────────────────
 * 서버가 내린 판정(`writeGate`)만 보고 입력 칸을 그릴지 정한다. 화면이 스스로
 * 「반출 이력이 있나」 「잠겼나」 「내 역할이 되나」를 따지면 판정이 두 벌이 되고,
 * 그러면 화면이 여는 조건과 서버가 받아 주는 조건이 어긋난다. 그 판정은
 * auth/repair-case-used-parts-authorization.ts 한 곳에 있고, 저장을 받는
 * mutation 도 같은 함수를 부른다 — 주소로 직접 부른 요청도 같은 거절을 받는다.
 *
 * 그래서 이 파일에는 **역할 이름이 한 글자도 없다.** 역할 목록은 위 인가 모듈의
 * USED_PARTS_WRITE_ROLES 한 곳에만 있다.
 *
 * 그래서 이 파일에는 `hasPartRequestHistory` 로 **잠그는** 줄이 없다. 그 값은
 * 아래 안내 문구를 고르는 데만 쓴다(무엇이 막았는지 사람에게 말해 주려고).
 *
 * ── 이력과 손글씨가 겹친 건 ─────────────────────────────────────────────
 * 요청서를 **나중에** 내면 이미 적어 둔 줄이 남을 수 있다(DB 가 막지 않는다 —
 * 스키마 머리말). 그때 줄을 감추면 두 번 세어질 자료가 화면에서 사라져 아무도
 * 고칠 수 없게 되므로, 안내와 함께 **그대로 보여 주고 확인을 청한다.** 적을
 * 자리는 여전히 그리지 않는다(서버가 이미 거절하는 건이다).
 * ============================================================================
 */
export default function UsedPartsSection({
  repairCaseId,
  version,
  rows,
  hasPartRequestHistory,
  writeGate,
  partOptions,
}: {
  repairCaseId: string;
  /** 접수 건의 version — 저장할 때 그대로 되돌려 보내 동시 편집을 막는다. */
  version: number;
  /** `line_no` 차례대로 온다 — 여기서 다시 정렬하지 않는다(정렬은 조회 몫). */
  rows: readonly RepairCaseUsedPartRow[];
  hasPartRequestHistory: boolean;
  /** 🔴 서버가 내린 판정. 화면은 이것만 본다(위 머리말). */
  writeGate: UsedPartsWriteGate;
  /** 부품 마스터 — 품명 칸에서 찾아 고르는 데 쓴다. 적을 수 없는 건에는 빈 목록이 온다. */
  partOptions: readonly PartPickerRow[];
}) {
  const [isEditing, setIsEditing] = useState(false);
  const hasRows = rows.length > 0;
  const canEdit = writeGate.ok;

  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">사용 부품</h2>
        <div className="flex items-center gap-3">
          {hasRows && (
            <span className="text-xs text-zinc-500 dark:text-zinc-400">{rows.length}건</span>
          )}
          {canEdit && !isEditing && (
            <button
              type="button"
              onClick={() => setIsEditing(true)}
              className="text-xs font-medium text-zinc-600 hover:underline dark:text-zinc-400"
            >
              수정
            </button>
          )}
        </div>
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

      {/* 왜 「수정」이 없는지 말해 준다 — 「잠긴 건이라」(CASE_LOCKED) ·
          「권한이 없어서」(ROLE_NOT_ALLOWED). 셋째 까닭인 반출 이력은 위에서 이미
          안내했으므로 겹쳐 적지 않는다. 코드를 하나씩 세지 않고 그 하나만 빼는
          것은, 까닭이 늘 때 안내가 조용히 사라지는 쪽으로 기울지 않게 하려는
          것이다(새 코드는 기본으로 보인다). */}
      {!writeGate.ok && writeGate.code !== "PART_REQUEST_HISTORY_EXISTS" && (
        <p className="mt-2 text-xs text-zinc-600 dark:text-zinc-400">{writeGate.message}</p>
      )}

      {!hasPartRequestHistory && !hasRows && !isEditing && (
        <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">아직 적힌 것이 없습니다.</p>
      )}

      {hasRows && !isEditing && (
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

      {canEdit && isEditing && (
        <UsedPartsEditForm
          repairCaseId={repairCaseId}
          version={version}
          rows={rows}
          partOptions={partOptions}
          onDone={() => setIsEditing(false)}
        />
      )}
    </section>
  );
}
