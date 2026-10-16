"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import NoticePopup from "@/components/common/NoticePopup";
import { showSavePopup } from "@/components/common/SavePopup";
import {
  cancelInventoryStockRequestAction,
  createInventoryStockRequestAction,
  fillInventoryPartCustomerNameAction,
} from "@/lib/server/actions/inventory-stock-requests";
import {
  CHARGE_TYPES,
  CHARGE_TYPE_LABELS,
  CUSTOMER_NAME_EMPTY_NOTICE,
  STOCK_REQUEST_CANCEL_NOTICE,
  canCancelStockRequest,
  customerNameAlreadySetLines,
  filterInventoryParts,
  inventoryPartCustomerName,
  inventoryPartIdLabels,
  inventoryPartNoteFirstLine,
  inventoryPartSpec,
  inventoryUnreachableMessage,
  type ChargeType,
  type InventoryOhTemplate,
  type InventoryPart,
  type InventoryResult,
  type InventoryStockRequestForScreen,
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
 * ── 🔴 [요청 취소]는 **거둘 수 있는 줄에만** 그린다 (2026-10-16) ────────
 * 거두는 통로가 열렸다. 단추를 그리는 조건 넷은 `canCancelStockRequest` 한 곳에 있다 —
 * **내가 올린 것** · **A/S 에서 올린 것**(`requestKey !== null`) · **아직 대기** · **마감 아님**.
 * 🔴 **이 조건은 편의일 뿐 울타리가 아니다.** 막는 자리는 둘이다: 서버 액션(세션의 포털
 * 번호로 묻고, 그 열쇠가 **이 수리 건**의 것인지 다시 확인한다)과 재고 관리 통로(없는 신청 ·
 * 본인 아님 · 대기 아님을 **각각 다른 말**로 거절한다). 화면이 실수로 단추를 그려도 아무 일도
 * 일어나지 않고, 거절 문구가 **그대로** 떠야 한다.
 * 🔵 「담당자에게 말씀하세요」 안내(`STOCK_REQUEST_CANCEL_NOTICE`)는 **지우지 않았다** —
 *    거둘 수 없는 줄(이미 처리가 시작됐거나 · 남이 올렸거나 · 재고 관리에서 직접 올린 신청)은
 *    여전히 이 화면에서 못 거둔다. 까닭 없이 단추만 없으면 사람은 화면이 고장 난 줄 안다.
 *
 * ── 부품 줄에 **그 부품의 모든 것**을 보인다 (2026-10-16 사용자 요청 B·C) ──
 * 찾은 줄과 담은 줄 **둘 다** 고객사 품명 · 품명 · 품명2 · 교산 품번 · 도번을 보인다. 길어져
 * 안 읽히는 쪽으로 망가지지 않게 **석 줄로 나눠** 그린다 —
 *  ① `No. · 품명 · 품명2` — 줄의 머리. 사람이 눈으로 훑는 줄이라 예전 그대로 둔다.
 *  ② **고객사 품명** 한 줄. 🔴 이 칸만 따로 떼어 놓은 까닭은 **견적서가 이 이름으로 나가고**,
 *     비어 있으면 거기서 그 부품을 못 고르기 때문이다 — 그래서 비었을 때 그 자리에 채워
 *     넣는 길(아래 E)이 함께 선다.
 *  ③ 나머지(교산 품번 · 도번 · 소유 · 재고)를 작은 글씨 한 줄로.
 * 🔴 **값이 있는 것만 그린다** — 이 자료는 엑셀에서 넘어와 빈칸 대신 `-` 가 적힌 줄이 많고,
 *    「없음」을 줄줄이 적으면 정작 있는 값이 묻힌다. 재는 자는 도메인 쪽 한 곳이다
 *    (`inventoryPartIdLabels` · `inventoryPartCustomerName` — `-` 도 없는 것으로 센다).
 *
 * ── 🔴 고객사 품명을 **그 자리에서 채운다** (2026-10-16 사용자 요청 E) ────
 * 비어 있으면 **찾은 줄**에 [고객사 품명 채우기]가 선다(담은 줄이 아니다 — 담은 줄은 수량과
 * 유상/무상을 고르는 표이고, 아직 담지 않은 부품도 채울 수 있어야 하기 때문이다. 애초에
 * 「견적서에서 막혀서」 들어온 사람은 담을 생각이 없다).
 * 🔴 **채우기만 한다 — 덮어쓰지 않는다.** 이미 값이 있으면 저쪽이 오류가 아니라 「안 바꿨다 +
 *    지금 값」을 돌려주고, 화면은 그것을 **거절과 다른 말**로 말한다(읽는 알림). 거절(빈 값 ·
 *    `-` 만 · 길이 초과 · 없는 번호 · 숨긴 부품)은 **저쪽 문구를 그대로** 창 안에 띄운다.
 * 🔴 **성공하면 그 자리에서 값이 보인다** — 저쪽이 돌려준 지금 값을 들고 있다가 그 줄에
 *    그린다(다시 검색하지 않아도 된다). 서버가 가진 목록도 따라오도록 화면을 다시 읽는다.
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
  /**
   * 🔵 **누가 올렸든** 이 건의 반출 신청 전부(재고 관리에서 직접 올린 것까지). 최근 것이 위.
   * 🔴 포털 번호는 들어 있지 않다 — 서버가 「내가 올린 줄인가」(`mine`)만 재어 보낸다.
   */
  requests: InventoryResult<InventoryStockRequestForScreen[]>;
  /** 올릴 수 있는 사람인가. 🔴 포털 번호가 없으면 막고 **까닭을 말한다**(서버도 다시 막는다). */
  requesterGate: { ok: true } | { ok: false; message: string };
}) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [cart, setCart] = useState<StockRequestCartLine[]>([]);
  const [ohMessage, setOhMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  /** 읽어야 하는 알림(올리기·거두기 둘 다 쓴다). 제목이 둘로 갈려 함께 들고 다닌다. */
  const [notice, setNotice] = useState<{ title: string; lines: string[] } | null>(null);
  /**
   * 거두려고 고른 신청. 🔴 **되돌릴 수 없는 일이라 한 번 더 묻는다** — 이 값이 있으면
   * 확인 창이 떠 있다(이 저장소의 확인 창 관행: `<dialog>` + `showModal()`, 브라우저 기본
   * `confirm()` 이 아니다 — `common/NoticePopup.tsx` 머리말).
   */
  const [cancelTarget, setCancelTarget] = useState<{ requestKey: string; statusLabel: string } | null>(null);
  const [isCancelling, setIsCancelling] = useState(false);
  /** 🔴 저쪽이 거절한 **그 문구**. 확인 창을 닫지 않고 그 안에 그대로 보여 준다. */
  const [cancelError, setCancelError] = useState<string | null>(null);
  /**
   * 🔴 **요청 번호.** 같은 장바구니를 두 번 눌러도 **같은 값**이어야 한다 — 저쪽은 같은
   * 열쇠면 신청을 새로 만들지 않고 처음 신청을 돌려준다(그때 「이미 올라갔습니다」로
   * 말한다). `useRef` 라 다시 그려도 값이 살아 있고, **성공한 뒤에만** 비운다.
   */
  const requestKeyRef = useRef<string | null>(null);
  /**
   * 🔴 **방금 채운 고객사 품명.** 저쪽이 돌려준 **지금 값**만 담는다(우리가 친 글자가 아니다) —
   * 서버가 가진 부품 목록은 `router.refresh()` 가 따라잡을 때까지 옛 값이라, 이것이 없으면
   * 「채웠습니다」를 띄우고도 그 줄은 여전히 「고객사 품명 없음」을 그린다.
   */
  const [filledCustomerNames, setFilledCustomerNames] = useState<Record<number, string>>({});
  /** 채우려고 고른 부품. 있으면 창이 떠 있다(거두기 확인 창과 같은 관행). */
  const [fillTarget, setFillTarget] = useState<InventoryPart | null>(null);
  /**
   * 창에 치고 있는 글자. 🔴 **창이 아니라 여기가 주인**인 까닭은 **여는 자리에서 비우기**
   * 위해서다 — 앞 부품에 치던 글자가 남아 있으면 그대로 눌러 엉뚱한 이름이 박히고, 고객사에
   * 나가는 이름이라 되돌릴 수 없다.
   */
  const [fillValue, setFillValue] = useState("");
  const [isFilling, setIsFilling] = useState(false);
  /** 🔴 저쪽이 거절한 **그 문구**. 창을 닫지 않고 그 안에 그대로 보여 준다. */
  const [fillError, setFillError] = useState<string | null>(null);

  const partList = parts.status === "ok" ? parts.value : [];
  const filteredParts = filterInventoryParts(partList, search);
  const template = ohTemplate.status === "ok" ? ohTemplate.value : null;
  const canSubmit = parts.status === "ok" && requesterGate.ok;
  /** 담은 줄에 **그 부품의 모든 것**을 그리려고 번호로 되짚는다. 🔵 장바구니에 베껴 담지 않는
      까닭: 베끼면 고객사 품명을 채운 뒤에도 담은 줄만 옛 값으로 남는다. */
  const partByNo = new Map(partList.map((part) => [part.no, part]));

  /**
   * 그 부품의 **지금** 고객사 품명. 🔴 방금 채운 값이 있으면 그것이 먼저다 — 서버 목록이
   * 따라잡기 전까지 그 줄이 거짓말하지 않게.
   */
  function customerNameOf(part: InventoryPart): string {
    return filledCustomerNames[part.no] ?? inventoryPartCustomerName(part);
  }

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
      setNotice({
        title: "이미 올라간 요청입니다",
        lines: [
          "이 요청은 이미 재고 관리에 올라가 있습니다.",
          "같은 요청이 두 번 서지는 않았습니다. 아래 목록에서 지금 상태를 확인해 주세요.",
        ],
      });
      return;
    }
    // 수리 건 안에 딸린 요청이라 목록으로 넘기지 않는다(common/SavePopup.tsx).
    showSavePopup({ message: "재고 관리에 부품을 요청했습니다.", redirectTo: null });
  }

  /**
   * 올린 신청을 거둔다 — **확인 창에서 한 번 더 누른 뒤**에만 여기 온다.
   *
   * 🔴 **실패를 삼키지 않는다.** 저쪽이 거절한 문구(없는 신청 · 본인 아님 · 대기 아님)를
   *    **그대로** 확인 창 안에 띄우고 창을 닫지 않는다 — 창이 닫히면 사람은 거둬진 줄 안다.
   * 🔵 통로가 아직 안 열렸거나 저쪽이 꺼져 있으면 「못 받아 왔다」가 같은 자리에 뜬다.
   */
  async function handleCancelConfirm() {
    if (!cancelTarget) return;
    setIsCancelling(true);
    setCancelError(null);
    const result = await cancelInventoryStockRequestAction({
      repairCaseId,
      requestKey: cancelTarget.requestKey,
    });
    setIsCancelling(false);

    if (!result.ok) {
      setCancelError(result.message);
      return;
    }

    setCancelTarget(null);
    // 🔴 목록을 다시 읽어 **저쪽이 적어 둔 지금 상태**(「취소」)가 그 자리에 보이게 한다.
    router.refresh();

    if (!result.cancelled) {
      // 🔵 이미 거둬져 있었다 — 오류가 아니다. 읽어야 하는 알림이라 저절로 닫히는 저장
      //    팝업을 쓰지 않는다(NoticePopup 머리말).
      setNotice({
        title: "이미 거둬진 요청입니다",
        lines: [
          "이 요청은 이미 거둬져 있었습니다.",
          "두 번 거둬지지는 않았습니다. 아래 목록에서 지금 상태를 확인해 주세요.",
        ],
      });
      return;
    }
    showSavePopup({ message: "요청을 취소했습니다.", redirectTo: null });
  }

  /**
   * 비어 있는 고객사 품명을 채운다 — **창에서 한 번 더 누른 뒤**에만 여기 온다.
   *
   * 🔴 **실패를 삼키지 않는다.** 저쪽이 거절한 문구(빈 값 · `-` 만 · 200자 초과 · 없는 번호 ·
   *    숨긴 부품)를 **그대로** 창 안에 띄우고 창을 닫지 않는다 — 창이 닫히면 사람은 채워진 줄
   *    안다. 🔴 「이미 있습니다」는 **거절이 아니라서** 창을 닫고 읽는 알림으로 말한다.
   * 🔴 보내는 글자를 **다듬지 않는다** — 빈 값이든 `-` 든 저쪽이 각각 다른 말로 거절하고, 그
   *    말이 사람에게 닿아야 무엇을 고칠지 안다(여기서 미리 막으면 자가 두 벌이 된다).
   */
  async function handleFillConfirm(customerName: string) {
    if (!fillTarget) return;
    setIsFilling(true);
    setFillError(null);
    const result = await fillInventoryPartCustomerNameAction({
      no: fillTarget.no,
      customerName,
    });
    setIsFilling(false);

    if (!result.ok) {
      setFillError(result.message);
      return;
    }

    // 🔴 **저쪽이 돌려준 지금 값**을 그 줄에 그린다(보낸 값이 아니다 — 안 바꿨을 때 둘은 다르다).
    setFilledCustomerNames((prev) => ({ ...prev, [result.no]: result.customerName }));
    setFillTarget(null);
    // 서버가 가진 부품 목록도 따라오게 한다 — 위 값은 이 화면이 열려 있는 동안만 산다.
    router.refresh();

    if (!result.filled) {
      // 🔵 이미 적혀 있었다 — 오류가 아니다. 읽어야 하는 알림이라 저절로 닫히는 저장 팝업을
      //    쓰지 않는다(NoticePopup 머리말). 🔴 거절과 **다른 말**이다.
      setNotice({
        title: "이미 적혀 있는 고객사 품명입니다",
        lines: customerNameAlreadySetLines({
          no: result.no,
          name: result.partName,
          customerName: result.customerName,
        }),
      });
      return;
    }
    showSavePopup({ message: "고객사 품명을 채웠습니다.", redirectTo: null });
  }

  /** 부품 한 줄의 **고객사 품명 줄** — 있으면 값을, 없으면 까닭과 채워 넣을 길을. */
  function renderCustomerNameLine(part: InventoryPart, options: { canFill: boolean }) {
    const customerName = customerNameOf(part);
    if (customerName !== "") {
      return (
        <span className="block text-zinc-500 dark:text-zinc-400">고객사 품명 · {customerName}</span>
      );
    }
    return (
      <span className="mt-0.5 flex flex-wrap items-center gap-1">
        {/* 🔴 「없음」으로 끝내지 않는다 — 견적서에서 이 부품이 막히는 까닭이 이 칸이다. */}
        <span className="text-amber-700 dark:text-amber-400">{CUSTOMER_NAME_EMPTY_NOTICE}</span>
        {options.canFill && (
          <button
            type="button"
            onClick={() => {
              setFillError(null);
              // 🔴 **여는 자리에서 비운다** — 앞 부품에 치던 글자가 남은 채 눌리면 되돌릴 수 없다.
              setFillValue("");
              setFillTarget(part);
            }}
            className="shrink-0 rounded-md border border-amber-400 px-1.5 py-0.5 text-[11px] text-amber-800 hover:bg-amber-50 dark:border-amber-700 dark:text-amber-300 dark:hover:bg-amber-950/40"
          >
            고객사 품명 채우기
          </button>
        )}
      </span>
    );
  }

  /** 교산 품번 · 도번 — 🔴 **값이 있는 것만** 이름표를 달아 잇는다(`-` 는 값이 아니다). */
  function renderIdLabels(part: InventoryPart) {
    const labels = inventoryPartIdLabels(part);
    if (labels.length === 0) return null;
    return (
      <>
        {labels.map((item, index) => (
          <span key={item.label}>
            {index > 0 && " · "}
            {item.label} {item.value}
          </span>
        ))}
      </>
    );
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
        {/* 🔵 2026-10-16 에 한 줄이 넉 줄까지 늘어(품명 · 고객사 품명 · 품번들 · 비고) 예전
            높이(max-h-40)로는 후보가 **두 개밖에** 안 보였다. 창을 조금 키워 네댓 줄이 보이게
            한다 — 고르는 칸이 화면을 다 먹지 않을 만큼만. */}
        {filteredParts.length > 0 && (
          <ul className="max-h-64 overflow-y-auto rounded-md border border-zinc-200 dark:border-zinc-800">
            {filteredParts.map((part) => {
              const noteLine = inventoryPartNoteFirstLine(part);
              const spec = inventoryPartSpec(part);
              const hasIdLabels = inventoryPartIdLabels(part).length > 0;
              return (
                <li
                  key={part.no}
                  className="flex items-start justify-between gap-2 border-b border-zinc-100 px-3 py-1.5 text-xs last:border-0 dark:border-zinc-800"
                >
                  <span>
                    {/* ① 줄의 머리 — No. · 품명 · 품명2 */}
                    <span className="text-zinc-500">No. {part.no}</span> {part.name}
                    {spec !== "" && <span className="text-zinc-500"> · {spec}</span>}
                    {/* ② 🔴 고객사 품명은 제 줄에 — 견적서가 이 이름으로 나가고, 비면 거기서
                        못 고른다. 비어 있으면 여기서 바로 채운다(머리말 E). */}
                    {renderCustomerNameLine(part, { canFill: requesterGate.ok })}
                    {/* ③ 나머지 — 🔴 소유와 비고는 같은 품명이 여럿일 때 가르는 단서다. */}
                    <span className="block text-zinc-500">
                      {renderIdLabels(part)}
                      {hasIdLabels && " · "}
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
                {cart.map((line) => {
                  /* 🔴 담은 줄에도 **그 부품의 모든 것**을 보인다(사용자 요청 B). 장바구니에
                     베껴 담지 않고 번호로 되짚는 까닭은, 베끼면 고객사 품명을 채운 뒤에도 이
                     줄만 옛 값으로 남기 때문이다. 🔵 못 되짚으면(목록을 못 받아 온 뒤에 담은
                     줄이 남아 있는 경우) 담을 때 적어 둔 이름만 그린다 — 지어내지 않는다. */
                  const part = partByNo.get(line.no);
                  return (
                  <tr key={line.no} className="border-t border-zinc-100 dark:border-zinc-800">
                    <td className="px-2 py-1 align-top text-zinc-500">{line.no}</td>
                    <td className="px-2 py-1 align-top">
                      {line.name}
                      {part && inventoryPartSpec(part) !== "" && (
                        <span className="text-zinc-500"> · {inventoryPartSpec(part)}</span>
                      )}
                      {/* 🔵 담은 줄에는 **채우는 단추를 두지 않는다** — 그 자리는 수량과 유상/무상을
                          고르는 표이고, 채우는 길은 바로 위 찾은 줄에 있다(머리말 E). */}
                      {part && renderCustomerNameLine(part, { canFill: false })}
                      {part && inventoryPartIdLabels(part).length > 0 && (
                        <span className="block text-zinc-500">{renderIdLabels(part)}</span>
                      )}
                    </td>
                    {/* 🔴 고르는 칸이 아니다 — 번호를 고르는 순간 정해진 값이다. */}
                    <td className="px-2 py-1 whitespace-nowrap align-top text-zinc-500">{line.ownerLabel || "-"}</td>
                    <td className="px-2 py-1 align-top">
                      <input
                        type="number"
                        min={1}
                        step={1}
                        value={line.quantity}
                        onChange={(e) => updateCartLine(line.no, { quantity: e.target.value })}
                        className="w-16 rounded-md border border-zinc-200 bg-white px-1.5 py-0.5 text-xs dark:border-zinc-700 dark:bg-zinc-900"
                      />
                    </td>
                    <td className="px-2 py-1 align-top">
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
                    <td className="px-2 py-1 text-right align-top">
                      <button
                        type="button"
                        onClick={() => setCart((prev) => removeStockRequestCartLine(prev, line.no))}
                        className="text-zinc-400 hover:text-red-600"
                      >
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
                  <span className="flex items-center gap-2">
                    <span className="text-zinc-500 dark:text-zinc-400">
                      {request.requestedAt ? new Date(request.requestedAt).toLocaleString("ko-KR") : ""}
                    </span>
                    {/* 🔴 **거둘 수 있는 줄에만** 그린다(조건 넷은 도메인 함수 한 곳에 있다).
                        이 조건은 **편의**일 뿐이고, 막는 자리는 서버 액션과 저쪽 통로다 —
                        단추가 잘못 그려져도 거기서 거절당하고 그 문구가 그대로 뜬다. */}
                    {canCancelStockRequest(request) && request.requestKey !== null && (
                      <button
                        type="button"
                        onClick={() => {
                          setCancelError(null);
                          setCancelTarget({
                            requestKey: request.requestKey as string,
                            statusLabel: request.status.label || request.status.code,
                          });
                        }}
                        className="shrink-0 rounded-md border border-zinc-300 px-2 py-0.5 text-[11px] text-zinc-700 hover:border-red-400 hover:text-red-600 dark:border-zinc-700 dark:text-zinc-300"
                      >
                        요청 취소
                      </button>
                    )}
                  </span>
                </div>

                {/* 🔵 A/S 에서 올린 것이 아니다. 가려 내지 않고, 그 사실이 보이게 적는다. */}
                {request.requestKey === null && (
                  <p className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">재고 관리에서 직접 올린 신청</p>
                )}

                {/* 🔵 남이 올린 줄에는 단추가 없다 — **누가 올렸는지**를 적어 까닭이 보이게 한다. */}
                {request.requestKey !== null && !request.mine && request.requesterName !== "" && (
                  <p className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">
                    {request.requesterName} 님이 올린 신청
                  </p>
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

      {notice && <NoticePopup title={notice.title} lines={notice.lines} onClose={() => setNotice(null)} />}

      <CancelStockRequestDialog
        target={cancelTarget}
        isSubmitting={isCancelling}
        errorMessage={cancelError}
        onConfirm={() => void handleCancelConfirm()}
        onCancel={() => {
          setCancelTarget(null);
          setCancelError(null);
        }}
      />

      {/* 🔴 **표 밖에, 이 칸의 맨 끝에 둔다.** 팝업은 DOM 부모의 CSS 를 물려받아서, 담은 줄의
          표 칸 안에서 태어나면 `whitespace-nowrap` · 가운데 정렬 따위가 따라와 글이 넘친다. */}
      <FillCustomerNameDialog
        part={fillTarget}
        value={fillValue}
        onValueChange={setFillValue}
        isSubmitting={isFilling}
        errorMessage={fillError}
        onConfirm={(value) => void handleFillConfirm(value)}
        onCancel={() => {
          setFillTarget(null);
          setFillError(null);
        }}
      />
    </div>
  );
}

/**
 * ============================================================================
 * [요청 취소] 확인 창 — **되돌릴 수 없다는 것을 분명히 말한다**
 * ============================================================================
 * 이 저장소의 확인 창 관행 그대로다(`files/SaveRotationDialog.tsx` 와 같은 `<dialog>` +
 * `showModal()`). 🔴 **`window.confirm` 을 쓰지 않는다** — 글자를 꾸밀 수 없어 「되돌릴 수
 * 없습니다」가 파묻히고, 처리 중 상태와 **저쪽이 거절한 문구**를 보여 줄 자리가 없다
 * (`common/NoticePopup.tsx` 머리말).
 *
 * 🔴 **막혔으면 창을 닫지 않는다.** 거절 문구를 이 안에 그대로 띄운다 — 창이 닫히면 사람은
 * 거둬진 줄 알고 넘어간다.
 * ============================================================================
 */
function CancelStockRequestDialog({
  target,
  isSubmitting,
  errorMessage,
  onConfirm,
  onCancel,
}: {
  /** `null` 이면 닫혀 있다 — 열림 여부의 주인은 React 상태다. */
  target: { requestKey: string; statusLabel: string } | null;
  isSubmitting: boolean;
  errorMessage: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const isOpen = target !== null;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (isOpen && !dialog.open) dialog.showModal();
    else if (!isOpen && dialog.open) dialog.close();
  }, [isOpen]);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="cancel-stock-request-title"
      onCancel={(event) => {
        // 보내는 중에 Esc 로 닫히면 거둬졌는지 알 수 없게 된다.
        event.preventDefault();
        if (!isSubmitting) onCancel();
      }}
      className="m-auto w-full max-w-md rounded-lg border border-zinc-200 bg-white p-4 text-zinc-900 backdrop:bg-black/40 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50"
    >
      <h2 id="cancel-stock-request-title" className="text-sm font-semibold">
        반출 신청 거두기
      </h2>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        지금 상태: <span className="font-medium text-zinc-900 dark:text-zinc-50">{target?.statusLabel ?? ""}</span>
      </p>
      <p className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
        <strong className="font-semibold">거둔 요청은 되돌릴 수 없습니다.</strong>
        <br />
        같은 부품이 다시 필요하면 새 요청으로 올려야 합니다.
      </p>

      {errorMessage && (
        <p
          role="alert"
          className="mt-2 rounded-md border border-red-200 bg-white px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-zinc-900 dark:text-red-400"
        >
          {/* 🔴 재고 관리가 적어 준 까닭을 **그대로** 보여 준다 — 손으로 다시 적지 않는다. */}
          {errorMessage}
        </p>
      )}

      <div className="mt-4 flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={isSubmitting}
          className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          닫기
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={isSubmitting}
          className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
        >
          {isSubmitting ? "거두는 중..." : "요청 거두기"}
        </button>
      </div>
    </dialog>
  );
}

/**
 * ============================================================================
 * 고객사 품명 채우기 창 (2026-10-16 사용자 요청 E)
 * ============================================================================
 * 🔴 **채우기만 한다 — 지우거나 덮어쓰는 길이 아니다.** 저쪽은 **비어 있을 때만** 받고, 이미
 *    값이 있으면 덮지 않고 지금 값을 돌려준다(저쪽 API.md 7절). 그래서 이 창은 **빈 칸에만**
 *    열리고, 열려 있는 동안에도 「덮어쓰지 않는다」를 적어 둔다 — 그래야 「고치려고」 여는
 *    사람이 헛걸음하지 않는다.
 * 🔴 **고객사에 나가는 이름이다.** 한 번 채우면 이 화면에서는 못 고치므로(재고 담당자만 고친다)
 *    그 사실을 누르기 전에 말한다.
 * 🔴 **보낸 글자를 여기서 미리 재지 않는다.** 빈 값 · `-` 만 · 200자 초과를 저쪽이 각각 다른
 *    말로 거절하고 그 문구를 그대로 띄운다 — 자가 두 벌이면 저쪽이 규칙을 고치는 날 어긋난다.
 *    🔵 [채우기]를 **빈 칸일 때 잠그는 것**만 한다(누르나 마나 한 왕복을 아끼는 일이다).
 * 🔴 **막혔으면 창을 닫지 않는다** — 닫히면 사람은 채워진 줄 알고 넘어간다(거두기 창과 같다).
 * ============================================================================
 */
function FillCustomerNameDialog({
  part,
  value,
  onValueChange,
  isSubmitting,
  errorMessage,
  onConfirm,
  onCancel,
}: {
  /** `null` 이면 닫혀 있다 — 열림 여부의 주인은 React 상태다. */
  part: InventoryPart | null;
  /**
   * 🔴 **친 글자의 주인이 바깥인 까닭**: 다른 부품으로 다시 열 때 앞 부품에 치던 글자가 남아
   * 있으면 그대로 눌러 **엉뚱한 이름이 박힌다** — 고객사에 나가는 이름이라 되돌릴 수 없다.
   * 창을 **여는 자리**에서 비우면 그 일이 아예 생기지 않는다(창이 제 안에서 뒤늦게 비우면
   * 그 한 번 그리는 사이에 눌릴 수 있다).
   */
  value: string;
  onValueChange: (value: string) => void;
  isSubmitting: boolean;
  errorMessage: string | null;
  onConfirm: (customerName: string) => void;
  onCancel: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const isOpen = part !== null;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (isOpen && !dialog.open) dialog.showModal();
    else if (!isOpen && dialog.open) dialog.close();
  }, [isOpen]);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="fill-customer-name-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!isSubmitting) onCancel();
      }}
      className="m-auto w-full max-w-md rounded-lg border border-zinc-200 bg-white p-4 text-zinc-900 backdrop:bg-black/40 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50"
    >
      <h2 id="fill-customer-name-title" className="text-sm font-semibold">
        고객사 품명 채우기
      </h2>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        <span className="text-zinc-500">No. {part?.no ?? ""}</span>{" "}
        <span className="font-medium text-zinc-900 dark:text-zinc-50">{part?.name ?? ""}</span>
      </p>
      <p className="mt-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
        <strong className="font-semibold">고객사에 나가는 서류(견적서 등)에 찍히는 이름</strong>입니다.
        <br />
        재고 관리의 부품 자료가 바뀌고, <strong className="font-semibold">비어 있을 때만 채워집니다</strong> —
        이미 적혀 있으면 덮어쓰지 않습니다. 채운 뒤에 고치려면 재고 관리 담당자에게 말씀해 주세요.
      </p>

      <label className="mt-3 block text-xs text-zinc-600 dark:text-zinc-400" htmlFor="fill-customer-name-input">
        고객사 품명
      </label>
      <input
        id="fill-customer-name-input"
        type="text"
        value={value}
        onChange={(e) => onValueChange(e.target.value)}
        disabled={isSubmitting}
        autoComplete="off"
        className="mt-1 w-full rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-sm text-zinc-900 disabled:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
      />

      {errorMessage && (
        <p
          role="alert"
          className="mt-2 rounded-md border border-red-200 bg-white px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-zinc-900 dark:text-red-400"
        >
          {/* 🔴 재고 관리가 적어 준 까닭을 **그대로** 보여 준다 — 손으로 다시 적지 않는다. */}
          {errorMessage}
        </p>
      )}

      <div className="mt-4 flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={isSubmitting}
          className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          닫기
        </button>
        <button
          type="button"
          onClick={() => onConfirm(value)}
          disabled={isSubmitting || value.trim() === ""}
          className="rounded-md bg-primary-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-800 disabled:opacity-50 dark:bg-primary-50 dark:text-zinc-900 dark:hover:bg-primary-200"
        >
          {isSubmitting ? "채우는 중..." : "채우기"}
        </button>
      </div>
    </dialog>
  );
}
