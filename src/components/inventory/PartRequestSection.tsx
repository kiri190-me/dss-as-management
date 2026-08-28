"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createPartRequestAction, cancelPartRequestAction } from "@/lib/server/actions/inventory-part-requests";
import type { PartListRow } from "@/lib/db/queries/inventory";
import type { OwnPartRequestRow } from "@/lib/db/queries/inventory-part-requests";
import {
  inventoryPartRequestStatusLabels,
  ownerScopedAvailability,
  STOCK_OWNER_CODES,
  stockOwnerLabels,
  stockOwnerLabelOrUnspecified,
  type StockOwner,
} from "@/lib/domain/inventory-types";
import { applyCartLinePatch, type CartLine } from "@/lib/domain/inventory-part-request-cart";
import type { OhTemplateRow } from "@/lib/db/queries/oh-part-templates";
import { generateClientUuid } from "@/lib/client-uuid";

/**
 * 부품 요청 칸. 수리 건 상세에 들어간다 —
 * Parts Request permission checkpoint: 담당자가 아니어도 그 건에 요청을 올릴
 * 수 있다. **누구에게 그려지는가는 역할이 아니라 설정이 정한다** — [id]/page.tsx
 * 의 partRequestData 게이트가 부품 요청 쓰기 권한(inventory.requests WRITE)을
 * 본다. 기본값으로는 AS_ENGINEER 와 최고관리자가 갖고, 나머지 역할은 역할별
 * 접근 권한 화면에서 열어 준다. Submitting never reserves or
 * deducts stock (plan §12) — availability shown here is informational only.
 * The server independently re-checks role/authorization regardless of what
 * this section renders — a disabled/hidden form here is a UX convenience
 * only.
 *
 * Shipment-lock removal policy: this section no longer takes an
 * isCaseLocked prop and always shows the create form — a shipped case's
 * part requests stay fully creatable, matching canCreatePartRequest
 * (inventory-authorization.ts), which the server independently enforces
 * regardless.
 */
export default function PartRequestSection({
  repairCaseId,
  ohTemplate,
  availableParts,
  ownerAvailabilityByPartId,
  ownRequests,
}: {
  repairCaseId: string;
  /**
   * 이 장비의 제품 모델에 이어진 O/H 부품 템플릿. **null 이 정상이다** —
   * 모델을 이어 두지 않았거나 O/H 템플릿이 없는 기종이면 없다
   * (queries/oh-part-templates.ts 의 findOhTemplateForRepairCase).
   */
  ohTemplate: OhTemplateRow | null;
  availableParts: PartListRow[];
  /** 소유구분-scoped 가용 수량 checkpoint — a missing (partId, owner) entry means 0, never "unknown". */
  ownerAvailabilityByPartId: Record<string, Partial<Record<StockOwner, number>>>;
  ownRequests: OwnPartRequestRow[];
}) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [ohMessage, setOhMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [cancelingId, setCancelingId] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const idempotencyKeyRef = useRef<string | null>(null);

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
    setCart((prev) => [...prev, { partId: part.id, partName: part.partName, quantity: "1", owner: "", note: "" }]);
  }

  /**
   * O/H 템플릿의 부품을 **한 번에** 장바구니에 담는다.
   *
   * ── 🔴 재고에 연결되지 않은 줄은 담기지 않는다 ──────────────────────
   * 부품 요청은 재고 마스터의 부품(part_id)에만 걸 수 있다. 템플릿에는
   * 마스터에 없는 이름이 섞여 있어서(양식에서 옮겨 온 그대로), 그런 줄은
   * 담기지 않는다. **조용히 빼면 안 된다** — 담은 줄만 보고 다 담겼다고
   * 믿으면 정작 필요한 부품을 빠뜨린 채 요청이 나간다. 그래서 무엇이 빠졌는지
   * 이름을 그대로 알려 준다.
   *
   * 이미 담긴 부품은 건너뛴다(장바구니가 part_id 하나당 한 줄이다).
   * 수량은 템플릿의 값을 그대로 쓰고, 사람이 담긴 뒤 고칠 수 있다.
   */
  function addOhTemplateToCart() {
    if (!ohTemplate) return;

    const availableIds = new Set(availableParts.map((part) => part.id));
    const added: CartLine[] = [];
    const skippedNoPart: string[] = [];
    const skippedAlready: string[] = [];

    for (const item of ohTemplate.items) {
      if (item.partId === null || !availableIds.has(item.partId)) {
        skippedNoPart.push(item.partNameText);
        continue;
      }
      if (cart.some((line) => line.partId === item.partId)) {
        skippedAlready.push(item.partNameText);
        continue;
      }
      const part = availableParts.find((candidate) => candidate.id === item.partId);
      added.push({
        partId: item.partId,
        partName: part?.partName ?? item.partNameText,
        quantity: String(item.quantity),
        owner: "",
        note: "",
      });
    }

    if (added.length > 0) setCart((prev) => [...prev, ...added]);

    const notes: string[] = [`${added.length}종을 담았습니다.`];
    if (skippedAlready.length > 0) notes.push(`이미 담겨 있음: ${skippedAlready.join(', ')}`);
    if (skippedNoPart.length > 0) {
      notes.push(`재고에 없어 담지 못함(직접 찾아 담아 주세요): ${skippedNoPart.join(', ')}`);
    }
    setOhMessage(notes.join(" · "));
  }

  function removeFromCart(partId: string) {
    setCart((prev) => prev.filter((line) => line.partId !== partId));
  }

  function updateCartLine(partId: string, patch: Partial<CartLine>) {
    setCart((prev) => applyCartLinePatch(prev, partId, patch));
  }

  function getOrCreateIdempotencyKey(): string {
    if (!idempotencyKeyRef.current) idempotencyKeyRef.current = generateClientUuid();
    return idempotencyKeyRef.current;
  }

  async function handleSubmit() {
    if (cart.length === 0) {
      setErrorMessage("요청할 부품을 1개 이상 추가해 주세요.");
      return;
    }
    const items: { partId: string; quantity: number; owner: StockOwner; note?: string | null }[] = [];
    for (const line of cart) {
      const quantity = Number(line.quantity);
      if (!Number.isInteger(quantity) || quantity <= 0) {
        setErrorMessage(`${line.partName}의 수량은 1 이상의 정수여야 합니다.`);
        return;
      }
      if (!line.owner) {
        setErrorMessage(`${line.partName}의 소유구분을 선택해 주세요.`);
        return;
      }
      items.push({ partId: line.partId, quantity, owner: line.owner, note: line.note || null });
    }

    setIsSubmitting(true);
    setErrorMessage(null);
    const result = await createPartRequestAction({
      repairCaseId,
      items,
      note: null,
      idempotencyKey: getOrCreateIdempotencyKey(),
    });
    setIsSubmitting(false);
    if (!result.ok) {
      setErrorMessage(result.message);
      return;
    }
    idempotencyKeyRef.current = null;
    setCart([]);
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
    const result = await cancelPartRequestAction({ requestId, reason: cancelReason, idempotencyKey: generateClientUuid() });
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

      {/* O/H 템플릿 일괄 담기. 제품 모델에 템플릿이 이어져 있을 때만 그린다 —
          이을 것이 없으면 담을 것도 없다(queries 의 findOhTemplateForRepairCase).
          O/H 대상 여부로 감추지 **않는다**: 대상이 아니어도 부품을 담아야 할
          때가 있고, 대상 판정은 알려 주는 것이지 막는 것이 아니다. */}
      {ohTemplate && (
        <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/40">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-zinc-700 dark:text-zinc-300">
              이 장비의 <b>O/H 부품 템플릿</b> — 기종 {ohTemplate.code} · 부품 {ohTemplate.items.length}종
            </p>
            <button
              type="button"
              onClick={addOhTemplateToCart}
              className="rounded-md border border-zinc-300 bg-white px-3 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-900"
            >
              O/H 부품 한 번에 담기
            </button>
          </div>
          {ohMessage && (
            <p className="mt-2 text-xs text-zinc-700 dark:text-zinc-300">{ohMessage}</p>
          )}
        </div>
      )}

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
                    <th className="px-2 py-1">소유구분 *</th>
                    <th className="px-2 py-1">가용</th>
                    <th className="px-2 py-1">항목 메모</th>
                    <th className="px-2 py-1" />
                  </tr>
                </thead>
                <tbody>
                  {cart.map((line) => {
                    const availability = ownerScopedAvailability(ownerAvailabilityByPartId, line.partId, line.owner);
                    return (
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
                        <select
                          value={line.owner}
                          onChange={(e) => updateCartLine(line.partId, { owner: e.target.value as StockOwner | "" })}
                          className="rounded-md border border-zinc-200 bg-white px-1.5 py-0.5 text-xs dark:border-zinc-700 dark:bg-zinc-900"
                        >
                          <option value="">선택</option>
                          {STOCK_OWNER_CODES.map((code) => (
                            <option key={code} value={code}>
                              {stockOwnerLabels[code]}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-2 py-1 whitespace-nowrap">
                        {availability === null ? (
                          <span className="text-zinc-400 dark:text-zinc-500">소유구분을 선택해 주세요</span>
                        ) : (
                          <span>가용 {availability}개</span>
                        )}
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
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

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
                {/* 보류 사유 — 관리자가 왜 멈춰 뒀는지 요청자가 여기서 본다.
                    이걸 보여 주지 않으면 같은 요청을 다시 올리거나 담당자를
                    찾아다니게 된다. */}
                {request.hold && (
                  <div className="mt-1 rounded-md bg-violet-50 px-2 py-1.5 dark:bg-violet-950/40">
                    <p className="font-medium text-violet-900 dark:text-violet-200">보류 사유</p>
                    <p className="mt-0.5 text-violet-900 dark:text-violet-200">{request.hold.reason}</p>
                    <p className="mt-0.5 text-[11px] text-violet-700/70 dark:text-violet-300/70">
                      {request.hold.heldByName} · {new Date(request.hold.heldAt).toLocaleString("ko-KR")}
                    </p>
                  </div>
                )}

                <ul className="mt-1 flex flex-col gap-0.5 text-zinc-600 dark:text-zinc-300">
                  {request.items.map((item) => (
                    <li key={item.id}>
                      {item.partName} ({stockOwnerLabelOrUnspecified(item.owner)}) — 요청 {item.requestedQuantity} / 불출 {item.issuedQuantity}
                      <span className="block text-zinc-500 dark:text-zinc-400">항목 메모: {item.note ?? "-"}</span>
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
