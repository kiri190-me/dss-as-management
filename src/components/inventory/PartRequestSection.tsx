"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createPartRequestAction, cancelPartRequestAction } from "@/lib/server/actions/inventory-part-requests";
import type { PartListRow } from "@/lib/db/queries/inventory";
import type { OwnPartRequestRow } from "@/lib/db/queries/inventory-part-requests";
import { inventoryPartRequestStatusLabels } from "@/lib/domain/inventory-types";

type CartLine = { partId: string; partName: string; quantity: string; note: string };

/**
 * AS_ENGINEER's 부품 요청 section, embedded in their assigned repair-case
 * detail page. Submitting never reserves or deducts stock (plan §12) —
 * availability shown here is informational only. The server independently
 * re-checks assignment/lock/authorization regardless of what this section
 * renders — a disabled/hidden form here is a UX convenience only.
 */
export default function PartRequestSection({
  repairCaseId,
  isCaseLocked,
  isAssignedToCase,
  availableParts,
  ownRequests,
}: {
  repairCaseId: string;
  isCaseLocked: boolean;
  isAssignedToCase: boolean;
  availableParts: PartListRow[];
  ownRequests: OwnPartRequestRow[];
}) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [requestNote, setRequestNote] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [cancelingId, setCancelingId] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const idempotencyKeyRef = useRef<string | null>(null);

  const canCreate = isAssignedToCase && !isCaseLocked;

  const filteredParts = availableParts.filter((p) => {
    if (!search.trim()) return false;
    const term = search.trim().toLowerCase();
    return (
      p.partName.toLowerCase().includes(term) ||
      (p.partSpec ?? "").toLowerCase().includes(term) ||
      (p.drawingNo ?? "").toLowerCase().includes(term) ||
      (p.kyosanPartNo ?? "").toLowerCase().includes(term)
    );
  });

  function addToCart(part: PartListRow) {
    if (cart.some((line) => line.partId === part.id)) return;
    setCart((prev) => [...prev, { partId: part.id, partName: part.partName, quantity: "1", note: "" }]);
  }

  function removeFromCart(partId: string) {
    setCart((prev) => prev.filter((line) => line.partId !== partId));
  }

  function updateCartLine(partId: string, patch: Partial<CartLine>) {
    setCart((prev) => prev.map((line) => (line.partId === partId ? { ...line, ...patch } : line)));
  }

  function getOrCreateIdempotencyKey(): string {
    if (!idempotencyKeyRef.current) idempotencyKeyRef.current = crypto.randomUUID();
    return idempotencyKeyRef.current;
  }

  async function handleSubmit() {
    if (cart.length === 0) {
      setErrorMessage("요청할 부품을 1개 이상 추가해 주세요.");
      return;
    }
    const items: { partId: string; quantity: number; note?: string | null }[] = [];
    for (const line of cart) {
      const quantity = Number(line.quantity);
      if (!Number.isInteger(quantity) || quantity <= 0) {
        setErrorMessage(`${line.partName}의 수량은 1 이상의 정수여야 합니다.`);
        return;
      }
      items.push({ partId: line.partId, quantity, note: line.note || null });
    }

    setIsSubmitting(true);
    setErrorMessage(null);
    const result = await createPartRequestAction({
      repairCaseId,
      items,
      note: requestNote || null,
      idempotencyKey: getOrCreateIdempotencyKey(),
    });
    setIsSubmitting(false);
    if (!result.ok) {
      setErrorMessage(result.message);
      return;
    }
    idempotencyKeyRef.current = null;
    setCart([]);
    setRequestNote("");
    setSearch("");
    router.refresh();
  }

  async function handleCancel(requestId: string) {
    if (!cancelReason.trim()) {
      setErrorMessage("취소 사유를 입력해 주세요.");
      return;
    }
    setIsSubmitting(true);
    setErrorMessage(null);
    const result = await cancelPartRequestAction({ requestId, reason: cancelReason, idempotencyKey: crypto.randomUUID() });
    setIsSubmitting(false);
    if (!result.ok) {
      setErrorMessage(result.message);
      return;
    }
    setCancelingId(null);
    setCancelReason("");
    router.refresh();
  }

  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">부품 요청</h2>

      {isCaseLocked && (
        <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
          이 수리 건이 잠금되어 새 부품 요청을 생성할 수 없습니다. 기존 요청의 취소는 계속 가능합니다.
        </p>
      )}
      {!isAssignedToCase && !isCaseLocked && (
        <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">이 수리 건에 배정된 담당자만 부품을 요청할 수 있습니다.</p>
      )}

      {canCreate && (
        <div className="mt-3 flex flex-col gap-2">
          <input
            type="text"
            placeholder="재고 조회: 품명 / 품명2 / 도번 / 교산 품번 검색"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
          />
          {filteredParts.length > 0 && (
            <ul className="max-h-40 overflow-y-auto rounded-md border border-zinc-200 dark:border-zinc-800">
              {filteredParts.map((part) => (
                <li key={part.id} className="flex items-center justify-between border-b border-zinc-100 px-3 py-1.5 text-xs last:border-0 dark:border-zinc-800">
                  <span>
                    {part.partName} {part.partSpec && <span className="text-zinc-500">· {part.partSpec}</span>}
                    <span className="ml-2 text-zinc-500">가용 {part.totalQuantity}개</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => addToCart(part)}
                    disabled={cart.some((line) => line.partId === part.id)}
                    className="rounded-md border border-zinc-300 px-2 py-0.5 text-xs text-zinc-700 hover:bg-zinc-100 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                  >
                    추가
                  </button>
                </li>
              ))}
            </ul>
          )}

          {cart.length > 0 && (
            <div className="rounded-md border border-zinc-200 dark:border-zinc-800">
              <table className="w-full text-xs">
                <thead className="bg-zinc-50 text-left text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
                  <tr>
                    <th className="px-2 py-1">부품</th>
                    <th className="px-2 py-1">요청 수량</th>
                    <th className="px-2 py-1">항목 메모</th>
                    <th className="px-2 py-1" />
                  </tr>
                </thead>
                <tbody>
                  {cart.map((line) => (
                    <tr key={line.partId} className="border-t border-zinc-100 dark:border-zinc-800">
                      <td className="px-2 py-1">{line.partName}</td>
                      <td className="px-2 py-1">
                        <input
                          type="number"
                          min={1}
                          step={1}
                          value={line.quantity}
                          onChange={(e) => updateCartLine(line.partId, { quantity: e.target.value })}
                          className="w-16 rounded-md border border-zinc-200 bg-white px-1.5 py-0.5 text-xs dark:border-zinc-700 dark:bg-zinc-900"
                        />
                      </td>
                      <td className="px-2 py-1">
                        <input
                          type="text"
                          value={line.note}
                          onChange={(e) => updateCartLine(line.partId, { note: e.target.value })}
                          className="w-full rounded-md border border-zinc-200 bg-white px-1.5 py-0.5 text-xs dark:border-zinc-700 dark:bg-zinc-900"
                        />
                      </td>
                      <td className="px-2 py-1 text-right">
                        <button type="button" onClick={() => removeFromCart(line.partId)} className="text-zinc-400 hover:text-red-600">
                          삭제
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <textarea
            placeholder="요청 메모 (선택)"
            rows={2}
            value={requestNote}
            onChange={(e) => setRequestNote(e.target.value)}
            className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
          />

          <div>
            <button
              type="button"
              onClick={() => void handleSubmit()}
              disabled={isSubmitting || cart.length === 0}
              className="rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
            >
              {isSubmitting ? "제출 중..." : "부품 인수 요청"}
            </button>
          </div>
        </div>
      )}

      {errorMessage && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{errorMessage}</p>}

      <div className="mt-4">
        <h3 className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">내 요청</h3>
        {ownRequests.length === 0 ? (
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">아직 제출한 요청이 없습니다.</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-2">
            {ownRequests.map((request) => (
              <li key={request.id} className="rounded-md border border-zinc-200 p-2 text-xs dark:border-zinc-800">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-zinc-800 dark:text-zinc-200">{inventoryPartRequestStatusLabels[request.status]}</span>
                  <span className="text-zinc-500 dark:text-zinc-400">{new Date(request.createdAt).toLocaleString("ko-KR")}</span>
                </div>
                <ul className="mt-1 flex flex-col gap-0.5 text-zinc-600 dark:text-zinc-300">
                  {request.items.map((item) => (
                    <li key={item.id}>
                      {item.partName} — 요청 {item.requestedQuantity} / 불출 {item.issuedQuantity}
                    </li>
                  ))}
                </ul>
                {request.status === "PENDING" && (
                  <div className="mt-1">
                    {cancelingId === request.id ? (
                      <div className="flex flex-wrap items-center gap-1">
                        <input
                          type="text"
                          placeholder="취소 사유"
                          value={cancelReason}
                          onChange={(e) => setCancelReason(e.target.value)}
                          className="rounded-md border border-zinc-200 bg-white px-1.5 py-0.5 text-xs dark:border-zinc-700 dark:bg-zinc-900"
                        />
                        <button
                          type="button"
                          onClick={() => void handleCancel(request.id)}
                          disabled={isSubmitting}
                          className="rounded-md border border-red-300 px-2 py-0.5 text-xs text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950"
                        >
                          취소 확정
                        </button>
                        <button type="button" onClick={() => setCancelingId(null)} className="text-zinc-400 hover:text-zinc-600">
                          닫기
                        </button>
                      </div>
                    ) : (
                      <button type="button" onClick={() => setCancelingId(request.id)} className="text-red-600 hover:underline dark:text-red-400">
                        요청 취소
                      </button>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
