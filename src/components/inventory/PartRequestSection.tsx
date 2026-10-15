"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import NoticePopup from "@/components/common/NoticePopup";
import { showSavePopup } from "@/components/common/SavePopup";
import { createInventoryStockRequestAction } from "@/lib/server/actions/inventory-stock-requests";
import {
  CHARGE_TYPES,
  CHARGE_TYPE_LABELS,
  STOCK_REQUEST_CANCEL_NOTICE,
  filterInventoryParts,
  inventoryPartNoteFirstLine,
  inventoryUnreachableMessage,
  type ChargeType,
  type InventoryOhTemplate,
  type InventoryPart,
  type InventoryResult,
  type InventoryStockRequest,
} from "@/lib/domain/inventory-gateway";
import {
  addStockRequestCartLine,
  applyStockRequestCartPatch,
  getOrCreateRequestKey,
  removeStockRequestCartLine,
  resetRequestKey,
  validateStockRequestCart,
  type StockRequestCartLine,
} from "@/lib/domain/inventory-stock-request-cart";
import { generateClientUuid } from "@/lib/client-uuid";

/**
 * ============================================================================
 * 부품 요청 칸 — 🔴 **재고 관리를 본다** (2026-10-15)
 * ============================================================================
 * 이 칸은 더 이상 A/S 제 표를 읽지도 쓰지도 않는다. 부품 목록 · O/H 템플릿 · 올린 신청의
 * 지금 상태가 전부 **재고 관리**에서 오고, 요청도 그리로 올라간다(사용자 결정: 「A/S 의
 * 부품 요청은 운영에서 전혀 안 쓰고 있다. 재고 관리가 생기기를 기다리는 중이었다」).
 * 부르는 자리는 `src/lib/server/inventory-gateway.ts` 한 곳이고, 이 화면은 서버 컴포넌트가
 * 건네준 결과만 그린다.
 *
 * ── 🔴 「못 받아 왔다」를 「없다」로 그리지 않는다 ───────────────────────
 * 받는 값이 전부 `InventoryResult` 인 까닭이다. 빈 목록으로 뭉개면 화면이 **「재고에 부품이
 * 하나도 없다」**고 거짓말하고, 사람은 그 말을 믿는다. 그래서 못 받아 왔을 때는 목록 자리에
 * **까닭을 적고**, 올리기 단추를 잠근다(고를 수 없는데 올릴 수는 없다).
 *
 * ── 🔴 소유는 고르는 값이 아니다 ────────────────────────────────────────
 * 재고 관리에서는 소유가 다르면 부품 번호가 다르다. 번호를 고르는 순간 소유가 정해지므로
 * **보여 주기만** 한다. 대신 **유상/무상**을 줄마다 고르고 🔴 **기본값을 두지 않는다** —
 * 청구에 걸리는 값이라 저쪽 통로도 빠지면 400 으로 거절한다.
 *
 * ── 🔴 [요청 취소] 단추를 그리지 않는다 ────────────────────────────────
 * 저쪽은 A/S 에서 온 신청을 재고 관리 화면에서 못 거두게 막아 두었고(「거두는 것은 낸 쪽의
 * 몫이다」), 낸 쪽이 거둘 통로는 **아직 없다.** 누르면 아무 일도 못 하는 단추를 두는 대신
 * 어디로 가야 하는지 적는다(`STOCK_REQUEST_CANCEL_NOTICE`). 통로가 열리는 날 여기부터 고친다.
 *
 * ── 권한 ────────────────────────────────────────────────────────────────
 * 누구에게 그려지는가는 역할이 아니라 설정이 정한다 — [id]/page.tsx 의 partRequestData
 * 게이트가 `inventory.requests` 쓰기를 본다. 그려진다고 올릴 수 있는 것은 아니다:
 * 서버 액션이 같은 축으로 **다시** 묻는다(화면 검사는 편의이지 울타리가 아니다).
 * ============================================================================
 */
export default function PartRequestSection({
  repairCaseId,
  parts,
  ohTemplate,
  requests,
  requesterGate,
}: {
  repairCaseId: string;
  /** 재고 관리의 부품 전부. 🔴 못 받아 왔으면 **빈 목록이 아니라** 그 사실이 온다. */
  parts: InventoryResult<InventoryPart[]>;
  /**
   * 이 장비의 제품 모델에 이어진 O/H 부품 템플릿. 🔵 **`value: null` 이 정상이다** —
   * 모델을 이어 두지 않았거나 O/H 템플릿이 없는 기종이면 없다. 「없다」와 「못 받아 왔다」는
   * 다른 값이고, 화면도 다르게 그린다.
   */
  ohTemplate: InventoryResult<InventoryOhTemplate | null>;
  /** 🔵 **누가 올렸든** 이 건의 반출 신청 전부(재고 관리에서 직접 올린 것까지). 최근 것이 위. */
  requests: InventoryResult<InventoryStockRequest[]>;
  /** 올릴 수 있는 사람인가. 🔴 포털 번호가 없으면 막고 **까닭을 말한다**(서버도 다시 막는다). */
  requesterGate: { ok: true } | { ok: false; message: string };
}) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [cart, setCart] = useState<StockRequestCartLine[]>([]);
  const [ohMessage, setOhMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [noticeLines, setNoticeLines] = useState<string[] | null>(null);
  /**
   * 🔴 **요청 번호.** 같은 장바구니를 두 번 눌러도 **같은 값**이어야 한다 — 저쪽은 같은
   * 열쇠면 신청을 새로 만들지 않고 처음 신청을 돌려준다(그때 「이미 올라갔습니다」로
   * 말한다). `useRef` 라 다시 그려도 값이 살아 있고, **성공한 뒤에만** 비운다.
   */
  const requestKeyRef = useRef<string | null>(null);

  const partList = parts.status === "ok" ? parts.value : [];
  const filteredParts = filterInventoryParts(partList, search);
  const template = ohTemplate.status === "ok" ? ohTemplate.value : null;
  const canSubmit = parts.status === "ok" && requesterGate.ok;

  function addToCart(part: InventoryPart) {
    setCart((prev) =>
      addStockRequestCartLine(prev, {
        no: part.no,
        name: part.name,
        ownerLabel: part.owner.label || part.owner.code,
        quantity: "1",
        // 🔴 기본값을 두지 않는다. 사람이 고르기 전에는 올라가지 않는다.
        chargeType: "",
      })
    );
  }

  /**
   * O/H 템플릿의 부품을 **한 번에** 담는다.
   *
   * ── 🔴 재고에 이어지지 않은 줄은 담기지 않는다 ─────────────────────
   * 반출 신청은 재고 마스터의 부품 번호에만 걸 수 있다. 템플릿에는 마스터에 없는 이름이
   * 섞여 있어서(양식에서 옮겨 온 그대로, `linked: false`) 그런 줄은 담기지 않는다.
   * **조용히 빼면 안 된다** — 담은 줄만 보고 다 담겼다고 믿으면 정작 필요한 부품을 빠뜨린
   * 채 요청이 나간다. 그래서 무엇이 빠졌는지 이름을 그대로 알려 준다(예전부터 하던 말 그대로).
   *
   * 이미 담긴 부품은 건너뛴다. 수량은 템플릿의 값을 그대로 쓰고 사람이 고칠 수 있다.
   * 🔴 **유상/무상은 담아 주지 않는다** — 그 값은 사람이 줄마다 골라야 한다.
   */
  function addOhTemplateToCart() {
    if (!template) return;

    const inStock = new Map(partList.map((part) => [part.no, part]));
    const added: StockRequestCartLine[] = [];
    const skippedNoPart: string[] = [];
    const skippedAlready: string[] = [];

    for (const item of template.items) {
      const part = item.linked && item.no !== null ? inStock.get(item.no) : undefined;
      if (!part) {
        skippedNoPart.push(item.name);
        continue;
      }
      if (cart.some((line) => line.no === part.no) || added.some((line) => line.no === part.no)) {
        skippedAlready.push(item.name);
        continue;
      }
      added.push({
        no: part.no,
        name: part.name,
        ownerLabel: part.owner.label || part.owner.code,
        quantity: String(item.quantity),
        chargeType: "",
      });
    }

    if (added.length > 0) setCart((prev) => [...prev, ...added]);

    const notes: string[] = [`${added.length}종을 담았습니다.`];
    if (skippedAlready.length > 0) notes.push(`이미 담겨 있음: ${skippedAlready.join(", ")}`);
    if (skippedNoPart.length > 0) {
      notes.push(`재고에 없어 담지 못함(직접 찾아 담아 주세요): ${skippedNoPart.join(", ")}`);
    }
    setOhMessage(notes.join(" · "));
  }

  function updateCartLine(no: number, patch: Partial<StockRequestCartLine>) {
    setCart((prev) => applyStockRequestCartPatch(prev, no, patch));
  }

  async function handleSubmit() {
    if (!requesterGate.ok) {
      setErrorMessage(requesterGate.message);
      return;
    }
    const validated = validateStockRequestCart(cart);
    if (!validated.ok) {
      setErrorMessage(validated.message);
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);
    const result = await createInventoryStockRequestAction({
      repairCaseId,
      // 🔴 두 번 눌러도 같은 값이 나간다(위 ref 의 머리말).
      requestKey: getOrCreateRequestKey(requestKeyRef, generateClientUuid),
      lines: validated.lines,
      note: null,
    });
    setIsSubmitting(false);

    if (!result.ok) {
      // 🔴 못 올렸으면 **올린 것처럼 보이지 않게** 한다. 장바구니도 요청 번호도 그대로 두어
      //    다시 누르면 **같은 요청**이 간다(두 줄로 서지 않는다).
      setErrorMessage(result.message);
      return;
    }

    resetRequestKey(requestKeyRef);
    setCart([]);
    setSearch("");
    setOhMessage(null);
    router.refresh();

    if (!result.created) {
      // 🔵 같은 요청 번호가 이미 올라가 있었다 — 두 번 선 것이 아니다. 읽어야 하는 알림이라
      //    저절로 닫히는 저장 팝업을 쓰지 않는다(NoticePopup 머리말).
      setNoticeLines([
        "이 요청은 이미 재고 관리에 올라가 있습니다.",
        "같은 요청이 두 번 서지는 않았습니다. 아래 목록에서 지금 상태를 확인해 주세요.",
      ]);
      return;
    }
    // 수리 건 안에 딸린 요청이라 목록으로 넘기지 않는다(common/SavePopup.tsx).
    showSavePopup({ message: "재고 관리에 부품을 요청했습니다.", redirectTo: null });
  }

  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">부품 요청</h2>
        <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
          재고 관리에 「확인 대기」 신청이 섭니다 — 재고 담당자가 확인해야 부품이 나갑니다.
        </p>
      </div>

      {/* 🔴 못 받아 왔을 때. 목록을 빈 채로 그리면 「재고에 아무것도 없다」가 된다. */}
      {parts.status !== "ok" && (
        <p className="mt-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          재고 관리의 부품 목록을 불러오지 못했습니다 — {inventoryUnreachableMessage(parts.reason)} 목록이
          비어 보이는 것이 아니라 <b>확인하지 못한 것</b>입니다. 잠시 뒤 새로고침해 주세요.
        </p>
      )}

      {!requesterGate.ok && (
        <p className="mt-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          {requesterGate.message}
        </p>
      )}

      {/* O/H 템플릿 일괄 담기. 이어 둔 템플릿이 있을 때만 그린다 — 이을 것이 없으면 담을
          것도 없다. O/H 대상 여부로 감추지 **않는다**: 대상이 아니어도 부품을 담아야 할
          때가 있고, 대상 판정은 알려 주는 것이지 막는 것이 아니다. */}
      {ohTemplate.status !== "ok" ? (
        <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
          O/H 부품 템플릿을 불러오지 못했습니다 — {inventoryUnreachableMessage(ohTemplate.reason)}
        </p>
      ) : (
        template && (
          <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/40">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-zinc-700 dark:text-zinc-300">
                이 장비의 <b>O/H 부품 템플릿</b> — {template.name || "이름 없음"} · 부품 {template.items.length}종
              </p>
              <button
                type="button"
                onClick={addOhTemplateToCart}
                disabled={!canSubmit}
                className="rounded-md border border-zinc-300 bg-white px-3 py-1 text-xs disabled:opacity-40 dark:border-zinc-700 dark:bg-zinc-900"
              >
                O/H 부품 한 번에 담기
              </button>
            </div>
            {ohMessage && <p className="mt-2 text-xs text-zinc-700 dark:text-zinc-300">{ohMessage}</p>}
          </div>
        )
      )}

      <div className="mt-3 flex flex-col gap-2">
        <input
          type="text"
          placeholder="재고 관리에서 찾기: 품명 / 품명2 / 고객사 품명 / 교산 품번 / 도번"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          disabled={parts.status !== "ok"}
          className="rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-sm text-zinc-900 disabled:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
        />
        {parts.status === "ok" && search.trim() !== "" && filteredParts.length === 0 && (
          <p className="text-xs text-zinc-500 dark:text-zinc-400">찾는 부품이 재고 관리에 없습니다.</p>
        )}
        {filteredParts.length > 0 && (
          <ul className="max-h-40 overflow-y-auto rounded-md border border-zinc-200 dark:border-zinc-800">
            {filteredParts.map((part) => {
              const noteLine = inventoryPartNoteFirstLine(part);
              return (
                <li
                  key={part.no}
                  className="flex items-center justify-between gap-2 border-b border-zinc-100 px-3 py-1.5 text-xs last:border-0 dark:border-zinc-800"
                >
                  <span>
                    <span className="text-zinc-500">No. {part.no}</span> {part.name}
                    {part.name2 && <span className="text-zinc-500"> · {part.name2}</span>}
                    {/* 🔴 소유와 비고를 함께 보여 준다 — 같은 품명이 여럿이라 이 둘이 가르는 단서다. */}
                    <span className="ml-2 text-zinc-500">
                      {part.owner.label || part.owner.code} · 재고 {part.quantity}개
                    </span>
                    {noteLine && <span className="block text-zinc-400">{noteLine}</span>}
                  </span>
                  <button
                    type="button"
                    onClick={() => addToCart(part)}
                    disabled={cart.some((line) => line.no === part.no)}
                    className="shrink-0 rounded-md border border-zinc-300 px-2 py-0.5 text-xs text-zinc-700 hover:bg-zinc-100 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                  >
                    추가
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {cart.length > 0 && (
          <div className="rounded-md border border-zinc-200 dark:border-zinc-800">
            <table className="w-full text-xs">
              <thead className="bg-zinc-50 text-left text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
                <tr>
                  <th className="px-2 py-1">No.</th>
                  <th className="px-2 py-1">부품</th>
                  <th className="px-2 py-1">소유</th>
                  <th className="px-2 py-1">요청 수량</th>
                  <th className="px-2 py-1">유상/무상 *</th>
                  <th className="px-2 py-1" />
                </tr>
              </thead>
              <tbody>
                {cart.map((line) => (
                  <tr key={line.no} className="border-t border-zinc-100 dark:border-zinc-800">
                    <td className="px-2 py-1 text-zinc-500">{line.no}</td>
                    <td className="px-2 py-1">{line.name}</td>
                    {/* 🔴 고르는 칸이 아니다 — 번호를 고르는 순간 정해진 값이다. */}
                    <td className="px-2 py-1 whitespace-nowrap text-zinc-500">{line.ownerLabel || "-"}</td>
                    <td className="px-2 py-1">
                      <input
                        type="number"
                        min={1}
                        step={1}
                        value={line.quantity}
                        onChange={(e) => updateCartLine(line.no, { quantity: e.target.value })}
                        className="w-16 rounded-md border border-zinc-200 bg-white px-1.5 py-0.5 text-xs dark:border-zinc-700 dark:bg-zinc-900"
                      />
                    </td>
                    <td className="px-2 py-1">
                      <select
                        value={line.chargeType}
                        onChange={(e) => updateCartLine(line.no, { chargeType: e.target.value as ChargeType | "" })}
                        className="rounded-md border border-zinc-200 bg-white px-1.5 py-0.5 text-xs dark:border-zinc-700 dark:bg-zinc-900"
                      >
                        <option value="">선택</option>
                        {CHARGE_TYPES.map((code) => (
                          <option key={code} value={code}>
                            {CHARGE_TYPE_LABELS[code]}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-2 py-1 text-right">
                      <button
                        type="button"
                        onClick={() => setCart((prev) => removeStockRequestCartLine(prev, line.no))}
                        className="text-zinc-400 hover:text-red-600"
                      >
                        삭제
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div>
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={isSubmitting || cart.length === 0 || !canSubmit}
            className="rounded-md bg-primary-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-800 disabled:opacity-50 dark:bg-primary-50 dark:text-zinc-900 dark:hover:bg-primary-200"
          >
            {isSubmitting ? "올리는 중..." : "재고 관리에 요청"}
          </button>
        </div>
      </div>

      {errorMessage && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{errorMessage}</p>}

      <div className="mt-4">
        <h3 className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">이 수리 건의 반출 신청</h3>
        {requests.status !== "ok" ? (
          <p className="mt-1 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
            재고 관리에서 신청 목록을 불러오지 못했습니다 — {inventoryUnreachableMessage(requests.reason)} 요청이
            없는 것이 아니라 <b>확인하지 못한 것</b>입니다.
          </p>
        ) : requests.value.length === 0 ? (
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">이 건에 올라간 반출 신청이 없습니다.</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-2">
            {requests.value.map((request) => (
              <li key={request.id} className="rounded-md border border-zinc-200 p-2 text-xs dark:border-zinc-800">
                <div className="flex flex-wrap items-center justify-between gap-1">
                  <span className="font-medium text-zinc-800 dark:text-zinc-200">
                    {/* 🔴 저쪽이 준 글자를 그대로 쓴다 — 손으로 다시 적지 않는다. */}
                    {request.status.label || request.status.code}
                    {request.closed && <span className="ml-1 text-zinc-500">(마감)</span>}
                  </span>
                  <span className="text-zinc-500 dark:text-zinc-400">
                    {request.requestedAt ? new Date(request.requestedAt).toLocaleString("ko-KR") : ""}
                  </span>
                </div>

                {/* 🔵 A/S 에서 올린 것이 아니다. 가려 내지 않고, 그 사실이 보이게 적는다. */}
                {request.requestKey === null && (
                  <p className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">재고 관리에서 직접 올린 신청</p>
                )}

                {/* 보류 사유 — 왜 멈춰 뒀는지 요청자가 여기서 본다. 보여 주지 않으면 같은
                    요청을 다시 올리거나 담당자를 찾아다니게 된다. */}
                {request.hold && (
                  <div className="mt-1 rounded-md bg-violet-50 px-2 py-1.5 dark:bg-violet-950/40">
                    <p className="font-medium text-violet-900 dark:text-violet-200">보류 사유</p>
                    <p className="mt-0.5 text-violet-900 dark:text-violet-200">{request.hold.reason}</p>
                    <p className="mt-0.5 text-[11px] text-violet-700/70 dark:text-violet-300/70">
                      {request.hold.byName} · {new Date(request.hold.at).toLocaleString("ko-KR")}
                    </p>
                  </div>
                )}

                {request.decision && (
                  <div className="mt-1 rounded-md bg-zinc-50 px-2 py-1.5 dark:bg-zinc-800/60">
                    <p className="text-zinc-700 dark:text-zinc-300">
                      {request.decision.byName} · {new Date(request.decision.at).toLocaleString("ko-KR")}
                    </p>
                    {request.decision.note && (
                      <p className="mt-0.5 text-zinc-700 dark:text-zinc-300">{request.decision.note}</p>
                    )}
                  </div>
                )}

                <ul className="mt-1 flex flex-col gap-0.5 text-zinc-600 dark:text-zinc-300">
                  {request.lines.map((line, index) => (
                    <li key={`${request.id}-${line.no ?? "deleted"}-${index}`}>
                      {line.no !== null && <span className="text-zinc-400">No. {line.no} </span>}
                      {line.name} — 요청 {line.quantity} / 불출 {line.issued}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}

        {/* 🔴 [요청 취소] 단추를 그리지 않는다(머리말). 대신 어디로 가야 하는지 적는다. */}
        <p className="mt-2 text-[11px] text-zinc-500 dark:text-zinc-400">{STOCK_REQUEST_CANCEL_NOTICE}</p>
      </div>

      {noticeLines && (
        <NoticePopup title="이미 올라간 요청입니다" lines={noticeLines} onClose={() => setNoticeLines(null)} />
      )}
    </div>
  );
}
