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
  /* 🔵 꾸밈 상수가 **도메인 쪽**에 사는 까닭은 그 자리 머리말에 있다 — 이 화면은 여기서
     그려 볼 수 없어서, 꾸밈을 화면에 흩으면 「색 말고도 갈리는가」를 아무도 못 돌려 본다. */
  STOCK_REQUEST_LINE_BLOCK_CLASS,
  STOCK_REQUEST_QUANTITY_LABEL_CLASS,
  STOCK_REQUEST_QUANTITY_VALUE_CLASS,
  canCancelStockRequest,
  customerNameAlreadySetLines,
  filterInventoryParts,
  inventoryPartCustomerName,
  inventoryPartIdLabels,
  inventoryPartNoteFirstLine,
  inventoryPartSpec,
  inventoryStockText,
  inventoryUnreachableMessage,
  resolveInventoryPartRequestTrace,
  stockRequestDecisionLabel,
  stockRequestLineChargeTag,
  stockRequestLineCustomerName,
  stockRequestLineDetails,
  stockRequestLineOwnerTag,
  stockRequestOhTag,
  stockRequestStatusBadge,
  type ChargeType,
  type InventoryOhTemplate,
  type InventoryPart,
  type InventoryResult,
  type InventoryStockRequestForScreen,
  type InventoryStockRequestLine,
  type StockRequestLineTag,
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
/* 🔴 칸 이름표는 **한 곳**에서 온다(요청 ③) — 「고객사 품명」을 화면에서 다시 쳐 두면
   그 말이 바뀌는 날 이 줄만 옛말을 한다(@dss/core 의 part-picker-rows.ts). */
import { PART_FIELD_LABELS } from "@dss/core/ui/inventory/part-picker-rows";

/**
 * 비고에 적을 수 있는 글자 수 — 🔴 **이 수는 저쪽(재고 관리) 코드에서 왔다.**
 *
 * 받는 자리가 `dss-inventory` 의 `src/lib/api/stock-requests.ts` 이고, 거기서 비고를
 * `text(body.note, 1000)` 으로 받는다 — 넘치면 **거절하지 않고 조용히 잘라** 저장한다.
 * 여기서 같은 수로 막지 않으면 길게 쓴 글이 **아무 말 없이** 사라지고, 쓴 사람은 다 갔다고
 * 믿는다. 🔴 저쪽이 이 수를 고치면 **여기도 함께 고쳐야 한다** — 두 저장소에 나뉘어 있어
 * 어느 쪽도 혼자서는 어긋난 것을 알지 못한다.
 */
const NOTE_MAX_LENGTH = 1000;

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
 *  ① **고객사 품명** 한 줄. 🔴 이 칸만 따로 떼어 놓은 까닭은 **견적서가 이 이름으로 나가고**,
 *     비어 있으면 거기서 그 부품을 못 고르기 때문이다 — 그래서 비었을 때 그 자리에 채워
 *     넣는 길(아래 E)이 함께 선다.
 *  ② `No. · 품명 · 품명2` — 사람이 눈으로 훑는 줄.
 *  ③ 나머지(교산 품번 · 도번 · 소유 · 재고)를 작은 글씨 한 줄로.
 * 🔴 **차례가 ①②③ 인 까닭은 요청 ③ 이다**(2026-10-16): 「어디서든 부품 검색 결과는 **고객사
 *    품명 · 품명 · 품명2 · 교산 품번 · 도번** 순서로.」 그 차례를 적어 둔 자리는 저장소 밖의
 *    한 곳이다 — `@dss/core` 의 `PART_FIELD_ORDER`. 부품 고르개(견적서 · 사용 부품)도 같은
 *    목록을 보고 그린다. 여기서 또 적으면 언젠가 두 화면이 다른 차례로 갈린다.
 * 🔴 **값이 있는 것만 그린다** — 이 자료는 엑셀에서 넘어와 빈칸 대신 `-` 가 적힌 줄이 많고,
 *    「없음」을 줄줄이 적으면 정작 있는 값이 묻힌다. 재는 자는 도메인 쪽 한 곳이다
 *    (`inventoryPartIdLabels` · `inventoryPartCustomerName` — `-` 도 없는 것으로 센다).
 *
 * ── 🔴 담은 줄에도 **재고**를 보인다 (2026-10-16 요청 ④) ──────────────────
 * 찾은 줄에만 있던 수를 담은 줄에도 적는다 — 수량을 치는 자리가 그쪽이라, 거기서 안 보이면
 * 위로 눈을 올려 찾아야 한다. 값은 **번호로 되짚은 그 부품**에서 그대로 나온다(아래
 * `partByNo`). 🔴 그 수가 **「지금」이 아니라는 것**을 숫자 옆에 적는다 — 까닭은 도메인 쪽
 * `inventoryStockText` 머리말에 있다.
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
  /**
   * 🔴 **요청 하나에 비고 하나**다(2026-10-22 쓰는 분 결정) — 부품 줄마다가 아니다. 그래서
   * 장바구니 줄(`StockRequestCartLine`)이 아니라 **이 칸이** 들고 있다.
   * 🔵 **안 적어도 된다** — 빈 채로 두면 올릴 때 `null` 로 나간다(아래 `handleSubmit`).
   */
  const [note, setNote] = useState("");
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
  /**
   * 🔴 **이 칸이 「있다·없다·모른다」를 가르는 자는 이제 이름이 있다**(2026-10-28).
   *
   * 여기 인라인으로 적혀 있던 `status === "ok" && value.length === 0` 을 도메인 쪽
   * `resolveInventoryPartRequestTrace` 로 옮겼다 — 연락서 이식이 **그 판정으로** 사용 부품을
   * 덮어쓸지 말지를 가리기 때문이다(`services/kyosan-report-import.ts`). 자가 두 벌이면
   * 사람이 이 칸에서 신청을 보고 있는데 서버는 「요청한 적 없다」로 읽는 날이 온다.
   * 🔵 그리는 모양은 한 글자도 바뀌지 않았다 — 셋으로 갈리는 자리만 같은 함수를 지난다.
   */
  const partRequestTrace = resolveInventoryPartRequestTrace(requests);
  /** 🔵 못 받아 왔으면 빈 목록이다 — 그릴 일이 없다(위 갈래가 먼저 막는다). 바로 위
      `partList` 와 같은 관행이다. */
  const stockRequests = requests.status === "ok" ? requests.value : [];
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
        /* 🔴 **손으로 담은 줄은 O/H 가 아니다** (2026-10-22). 같은 부품이 템플릿에 들어 있어도
           그렇다 — 쓰는 분의 말이 「**[O/H 부품 한 번에 담기]를 하면**」이고, 여기서 템플릿을
           들여다보기 시작하면 「담은 자리」가 아니라 「지금 템플릿」이 딱지를 정하게 된다. */
        fromOhTemplate: false,
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
   *
   * ── 🔴 **여기서 담긴 줄에만 O/H 표시를 찍는다** (2026-10-22, 쓰는 분 요청) ──
   * 「O/H 부품이라는 표시를 부품을 요청하는 모든 과정에 부품마다」. 그 표시가 **이 함수 안에서
   * 태어나고**, 그 뒤로는 손대지 않은 채 재고 관리의 세 화면까지 실려 간다.
   * 🔴 **이미 담겨 있던 줄은 고치지 않는다.** 손으로 담아 둔 줄을 [한 번에 담기]가 나중에
   *    O/H 로 바꿔 버리면, 사람이 본 적 없는 표시가 제 요청에 붙는다 — 그 줄은 「이미 담겨
   *    있음」으로 건너뛰고 **그대로 둔다**(건너뛴다는 말은 예전부터 그대로 알려 주고 있다).
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
        // 🔴 O/H 표시가 태어나는 **유일한 자리**다(머리말).
        fromOhTemplate: true,
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
      /* 🔴 **안 적었으면 `null`**이다 — 빈 글자(`""`)를 보내면 「적었는데 비어 있다」와
         「안 적었다」가 저쪽에서 구별되지 않는다.
         🔵 적었으면 **다듬지 않고 그대로** 보낸다 — 앞뒤 공백을 떼는 자리는 서버 액션 한
         곳이고(`inventory-stock-requests.ts`), 여기서 또 떼면 자가 두 벌이 된다. */
      note: note.trim() === "" ? null : note,
    });
    setIsSubmitting(false);

    if (!result.ok) {
      // 🔴 못 올렸으면 **올린 것처럼 보이지 않게** 한다. 장바구니도 요청 번호도 그대로 두어
      //    다시 누르면 **같은 요청**이 간다(두 줄로 서지 않는다).
      // 🔴 **비고도 그대로 둔다** — 사람이 쓴 글이라 지우면 다시 칠 수가 없다.
      setErrorMessage(result.message);
      return;
    }

    resetRequestKey(requestKeyRef);
    setCart([]);
    // 🔴 장바구니를 비우는 **그 자리에서 함께** 비운다 — 안 그러면 다음 요청에 지난 비고가
    //    그대로 따라붙고, 쓴 사람은 비어 있는 줄 안다.
    setNote("");
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
        <span className="block text-zinc-500 dark:text-zinc-400">
          {PART_FIELD_LABELS.customerPartName} · {customerName}
        </span>
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

  /**
   * 값을 눈에 띄게 하는 색 (2026-10-19 사용자 결정) — 🔴 **값에만** 입힌다.
   * 이름표(「도번」 · 「재고」)는 **회색 그대로**다: 색이 이름표까지 번지면 눈이 어디에 멎어야
   * 하는지가 다시 흐려진다. 🔵 이 저장소가 값을 강조할 때 쓰는 그 파란색이고, **다크 짝이
   * 붙어 있다** — 밝은 쪽만 적으면 어두운 화면에서 글자가 배경에 잠긴다.
   */
  const VALUE_HIGHLIGHT = "text-blue-700 dark:text-blue-400";

  /**
   * 교산 품번 · 도번 — 🔴 **값이 있는 것만** 이름표를 달아 잇는다(`-` 는 값이 아니다).
   *
   * 🔴 **도번은 값에만 색을 입힌다**(2026-10-19) — 교산 품번은 회색 그대로다. 어느 것이
   *    도번인지는 글자를 짐작해 견주지 않고 **그 이름표를 지은 한 곳**에 물어본다
   *    (`PART_FIELD_LABELS.drawingNo`). 「도번」을 여기 박아 두면 그 말이 바뀌는 날 오류 없이
   *    **색만 조용히 빠진다**.
   */
  function renderIdLabels(part: InventoryPart) {
    const labels = inventoryPartIdLabels(part);
    if (labels.length === 0) return null;
    return (
      <>
        {labels.map((item, index) => (
          <span key={item.label}>
            {index > 0 && " · "}
            {item.label}{" "}
            {item.label === PART_FIELD_LABELS.drawingNo ? (
              <span className={VALUE_HIGHLIGHT}>{item.value}</span>
            ) : (
              item.value
            )}
          </span>
        ))}
      </>
    );
  }

  /**
   * 재고 한 덩어리를 **그릴 때만** 세 토막으로 가른다 — 앞(이름표) · 수 · 뒤(언제 잰 값인지).
   * 🔴 **수에만** 색이 들어간다(2026-10-19): 「재고」와 「(불러온 때 기준)」은 회색 그대로다.
   *
   * 🔴 **글자를 여기서 다시 짓지 않는다.** 그 말은 도메인 한 곳(`inventoryStockText`)이 쥐고
   *    있고 **다른 화면도 그 함수를 쓴다** — 반환값을 건드리면 여기서 색을 입히자고 저쪽
   *    글자까지 바꾸는 일이 된다. 그래서 받은 글자를 그대로 두고 **그리는 자리에서만** 가른다.
   * 🔵 못 가르면(글자 모양이 바뀌면) **색 없이 통째로** 그린다 — 색이 빠지는 것은 아쉬운
   *    일이지만, 수가 사라지거나 꼬리말이 떨어지는 것은 사람이 수량을 잘못 정하는 일이다.
   */
  function renderStockText(text: string) {
    const parts = /^(\D*)(\d[^(]*)(.*)$/.exec(text);
    if (!parts) return text;
    return (
      <>
        {parts[1]}
        <span className={VALUE_HIGHLIGHT}>{parts[2]}</span>
        {parts[3]}
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
                    {/* ① 🔴 고객사 품명이 **맨 위**다(요청 ③ 의 차례). 견적서가 이 이름으로
                        나가고, 비면 거기서 못 고른다 — 비어 있으면 여기서 바로 채운다(머리말 E). */}
                    {renderCustomerNameLine(part, { canFill: requesterGate.ok })}
                    {/* ② 줄의 머리 — No. · 품명 · 품명2 */}
                    <span className="block">
                      <span className="text-zinc-500">No. {part.no}</span> {part.name}
                      {spec !== "" && <span className="text-zinc-500"> · {spec}</span>}
                    </span>
                    {/* ③ 나머지 — 🔴 소유와 비고는 같은 품명이 여럿일 때 가르는 단서다. */}
                    <span className="block text-zinc-500">
                      {renderIdLabels(part)}
                      {hasIdLabels && " · "}
                      {part.owner.label || part.owner.code} · {renderStockText(inventoryStockText(part))}
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
                      {/* 🔴 찾은 줄과 **같은 차례**다(요청 ③) — 고객사 품명 · 품명 · 품명2 ·
                          교산 품번 · 도번. 한쪽만 바꾸면 같은 부품이 두 줄에서 다르게 읽힌다.
                          🔵 담은 줄에는 **채우는 단추를 두지 않는다** — 그 자리는 수량과 유상/무상을
                          고르는 표이고, 채우는 길은 바로 위 찾은 줄에 있다(머리말 E). */}
                      {part && renderCustomerNameLine(part, { canFill: false })}
                      <span className="block">
                        {line.name}
                        {part && inventoryPartSpec(part) !== "" && (
                          <span className="text-zinc-500"> · {inventoryPartSpec(part)}</span>
                        )}
                      </span>
                      {/* 🔴 **O/H 딱지** (2026-10-22 쓰는 분 요청) — [O/H 부품 한 번에 담기]로 담긴
                          줄에만 선다. 🔴 **아닌 줄에는 아무것도 안 그린다**: 「일반」 같은 딱지를
                          달면 표가 시끄러워지고, 그 말이 맞는지 확인한 적도 없다.
                          🔴 **글자도 꾸밈도 여기 적지 않는다** — 올린 뒤의 줄(아래
                          `StockRequestLineDetails`)과 **같은 함수·같은 조각**을 쓴다. 두 벌로 적으면
                          담는 중과 올린 뒤의 딱지가 다르게 보이는 날이 온다.
                          🔵 자리가 ① 고객사 품명 ② 딱지 ③ 품번·재고인 것도 그 줄과 같다. */}
                      <LineTags tags={[stockRequestOhTag(line)]} />
                      {part && (
                        <span className="block text-zinc-500">
                          {renderIdLabels(part)}
                          {inventoryPartIdLabels(part).length > 0 && " · "}
                          {/* 🔴 담은 줄에도 재고를 보인다(요청 ④) — 수량을 치는 자리가 여기다.
                              그 수가 **「지금」이 아니라는 것**이 숫자에 붙어 있다. */}
                          {renderStockText(inventoryStockText(part))}
                        </span>
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

        {/* 🔴 **비고** (2026-10-22 쓰는 분 요청) — 담은 줄 **아래**, 올리는 단추 **위**다.
            적은 글은 재고 관리의 [부품 요청]·[승인요청건]·[기록내역] 세 화면에 그대로 뜬다.
            🔵 **요청 하나에 하나**이고 **안 적어도 된다** — 그래서 이름표에 「선택」을 붙여
               비워 두어도 되는 칸이라는 것을 먼저 말한다(단추가 잠기는 칸이 아니다).
            🔵 담은 줄이 있을 때만 그린다 — 담은 것이 없으면 올릴 수도 없어서(단추가 잠긴다)
               적을 자리만 덩그러니 서면 무엇에 붙는 글인지 알 수 없다. 🔴 **친 글자는 그대로
               남는다** — 줄을 다 지웠다가 다시 담아도 쓰던 글이 돌아온다(상태가 이 칸의 것이다). */}
        {cart.length > 0 && (
          <div>
            <label htmlFor="stock-request-note" className="block text-xs text-zinc-600 dark:text-zinc-400">
              비고 <span className="text-zinc-400 dark:text-zinc-500">(선택)</span>
            </label>
            <textarea
              id="stock-request-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              disabled={isSubmitting}
              rows={2}
              /* 🔴 상한이 **저쪽에서 온 수**인 까닭은 그 상수의 머리말에 있다 — 여기서 막지
                 않으면 저쪽이 조용히 잘라 저장한다. */
              maxLength={NOTE_MAX_LENGTH}
              placeholder="재고 담당자가 알아야 할 것을 적어 주세요 — 예: 분해 후 추가 부품이 더 필요할 수 있습니다 / 출장 일정이 있어 금요일 오전까지 받아야 합니다"
              className="mt-1 w-full rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-xs text-zinc-900 disabled:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
            />
            {/* 🔵 센 수는 **적었을 때만** 보인다 — 빈 칸 밑의 「0 / 1000」은 아무 말도 안 한다.
                🔴 상한에 닿는 순간 글자가 더 안 쳐지는데, 이 수가 없으면 자판이 고장 난 줄 안다. */}
            {note.length > 0 && (
              <p className="mt-0.5 text-right text-[11px] text-zinc-400 dark:text-zinc-500">
                {note.length} / {NOTE_MAX_LENGTH}자
              </p>
            )}
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
        {partRequestTrace.kind === "unknown" ? (
          <p className="mt-1 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
            재고 관리에서 신청 목록을 불러오지 못했습니다 — {inventoryUnreachableMessage(partRequestTrace.reason)} 요청이
            없는 것이 아니라 <b>확인하지 못한 것</b>입니다.
          </p>
        ) : partRequestTrace.kind === "absent" ? (
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">이 건에 올라간 반출 신청이 없습니다.</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-2">
            {stockRequests.map((request) => (
              <li key={request.id} className="rounded-md border border-zinc-200 p-2 text-xs dark:border-zinc-800">
                <div className="flex flex-wrap items-center justify-between gap-1">
                  {/* 🔴 **상태 배지** (2026-10-21 요청 ③) — 「대기」·「반려」·「마감」이 그냥 굵은
                      글씨라 안 띄었다. 🔴 **꾸밈을 고르는 자리는 도메인 한 곳**이고(이 화면은
                      여기서 그려 볼 수 없다), 여기서 색을 덧칠하지 않는다 — 덧칠하기 시작하면
                      「색 말고도 갈리는가」를 재는 자리가 둘로 쪼개진다.
                      🔵 색조는 **재고 관리와 맞췄고**, 마감이면 `closed` 를 보고 색까지 함께
                      바뀐다(그 함수 머리말) — 안 그러면 「마감」이라 쓰인 배지가 확인됨의
                      초록으로 뜬다. */}
                  <span className={stockRequestStatusBadge(request)}>
                    {/* 🔴 저쪽이 준 글자를 그대로 쓴다 — 손으로 다시 적지도, **뒤에 덧붙이지도**
                        않는다.
                        🔴 **마감이면 저쪽이 `label` 자체를 「마감」으로 바꿔 보낸다**(상태 코드는
                        `CONFIRMED` 그대로다 — 마감은 상태값이 아니라 `closed` 칸이라서). 그래서
                        여기서 `closed` 를 보고 꼬리를 붙이면 **「마감 (마감)」**이 된다 —
                        2026-10-21 에 실제로 그렇게 보이고 있었고, 두 저장소를 맞대어 보고서야
                        드러났다(어느 쪽도 혼자서는 틀린 데가 없었다).
                        🔵 `closed` 칸 자체는 계속 쓴다 — 사유 상자의 머리글과 [요청 취소] 판정이
                        그 칸으로 갈린다(`stockRequestDecisionLabel` · `canCancelStockRequest`). */}
                    {request.status.label || request.status.code}
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

                {/* 🔴 **요청 비고 — 올릴 때 적은 말을 되읽는다** (2026-10-22 쓰는 분 요청).
                    적어 보내기만 하고 다시 볼 길이 없었다. 「무슨 까닭으로 이 부품을 달라고
                    했더라」를 확인하는 자리가 여기다.
                    🔴 **바로 아래 상자들과 적은 사람이 다르다** — 이것은 **요청한 사람**의 말이고,
                    아래 둘은 **재고 담당자**의 말이다(보류 · 결정). 셋이 한 카드에 나란히 설 수
                    있어서 **제목으로 가른다** — 이 화면이 이미 쓰고 있는 길이고, 재고 관리도 같은
                    까닭으로 제 화면에 누구 말인지를 덧붙여 적는다.
                    🔵 **차례가 맨 위인 까닭**: 요청할 때 적은 말이 먼저고, 그 뒤에 담당자가 답한
                    말이 온다 — 읽는 차례가 곧 일이 일어난 차례다.
                    🔴 **비면 아예 안 그린다** — 안 적은 신청과 재고 관리에서 직접 올린 신청은 늘
                    비어 있어서, 빈 상자가 모든 카드에 붙으면 화면만 길어진다.
                    🔴 **잘라서 숨기지 않는다** — 읽으라고 적은 글이고 1000자까지 온다.
                    `whitespace-pre-wrap` 으로 적은 사람의 줄바꿈을 살리고, `break-words` 로 띄어쓰기
                    없는 긴 글이 카드를 밀어내지 않게만 한다. */}
                {request.note !== "" && (
                  <div className="mt-1 rounded-md bg-zinc-50 px-2 py-1.5 dark:bg-zinc-800/60">
                    <p className="font-medium text-zinc-800 dark:text-zinc-200">
                      요청 비고{" "}
                      {/* 🔵 누구 말인지는 옅고 가는 글씨로 덧붙인다 — 제목이 길어지되 굵은 글자는
                          「요청 비고」 넉 자 그대로라, 훑는 눈에는 여전히 그 말만 걸린다. */}
                      <span className="font-normal text-zinc-500 dark:text-zinc-400">(신청한 사람이 적은 말)</span>
                    </p>
                    <p className="mt-0.5 break-words whitespace-pre-wrap text-zinc-700 dark:text-zinc-300">
                      {request.note}
                    </p>
                  </div>
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
                    {/* 🔴 사유가 있을 때만 제목을 단다 — 글이 없는데 제목만 떠 있으면 사유를
                        못 받아 온 것처럼 읽힌다. 셋으로 가르는 규칙(마감 · 반려 · 그 밖)과
                        그 차례는 도메인 함수 한 곳에 있고 **재고 관리와 같다**(그 머리말).
                        🔵 글자를 여기 적지 않는 까닭도 그것이다 — 적으면 말이 두 벌이 된다. */}
                    {request.decision.note && (
                      <p className="font-medium text-zinc-800 dark:text-zinc-200">
                        {stockRequestDecisionLabel(request)}
                      </p>
                    )}
                    <p className="text-zinc-700 dark:text-zinc-300">
                      {request.decision.byName} · {new Date(request.decision.at).toLocaleString("ko-KR")}
                    </p>
                    {request.decision.note && (
                      <p className="mt-0.5 text-zinc-700 dark:text-zinc-300">{request.decision.note}</p>
                    )}
                  </div>
                )}

                {/* 🔵 줄 사이를 벌린 까닭: 2026-10-21 에 줄 하나가 석 줄까지 늘었다(아래
                    `StockRequestLineDetails`). 예전 간격(gap-0.5)으로는 어느 토막이 어느 부품의
                    것인지 눈으로 못 가른다.
                    🔴 **간격만으로는 모자랐다**(같은 날 쓰는 분 요청 ①) — 간격을 한 칸 더 벌리고
                    줄마다 **왼쪽 세로 선**으로 묶는다. 선을 고르는 자리와 「왜 상자가 아닌가」는
                    도메인 쪽 `STOCK_REQUEST_LINE_BLOCK_CLASS` 머리말에 있다. */}
                <ul className="mt-1 flex flex-col gap-2 text-zinc-600 dark:text-zinc-300">
                  {request.lines.map((line, index) => (
                    <li key={`${request.id}-${line.no ?? "deleted"}-${index}`} className={STOCK_REQUEST_LINE_BLOCK_CLASS}>
                      {/* 🔵 **머리줄의 글자는 한 자도 안 바뀌었다** — 「요청」·「불출」도, 사이의
                          `/` 도, 앞의 `—` 도 그대로다. 바뀐 것은 **숫자가 어떻게 보이는가**뿐이다
                          (요청 ②: 그 줄의 요점이 숫자인데 이름에 묻혀 있었다).
                          🔵 `whitespace-nowrap` 인 까닭: 좁은 칸이라 「요청 2 / 불출 0」이 가운데서
                          끊기면 한 덩이로 안 읽힌다 — 통째로 다음 줄로 넘어가는 편이 낫다. */}
                      <span className="block">
                        {line.no !== null && <span className="text-zinc-400">No. {line.no} </span>}
                        {line.name}{" "}
                        <span className="whitespace-nowrap">
                          <span className={STOCK_REQUEST_QUANTITY_LABEL_CLASS}>— 요청 </span>
                          <span className={STOCK_REQUEST_QUANTITY_VALUE_CLASS}>{line.quantity}</span>
                          <span className={STOCK_REQUEST_QUANTITY_LABEL_CLASS}> / 불출 </span>
                          <span className={STOCK_REQUEST_QUANTITY_VALUE_CLASS}>{line.issued}</span>
                        </span>
                      </span>
                      <StockRequestLineDetails line={line} />
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
 * 반출 신청 줄 **아래**에 붙는 작은 글씨 (2026-10-21 쓰는 분 요청)
 * ============================================================================
 * 「No. 165 AMP-… — 요청 2 / 불출 0」만으로는 **어느 부품인지 가릴 수 없었다** — 같은 품명인
 * 부품 묶음이 16개 있다(재고 관리 API.md 2절). 재고 관리의 [부품 요청]·[승인 요청건]이 같은
 * 날 같은 자리를 그렇게 바꿨고, 이 줄도 **같은 규칙**을 따른다.
 *
 * ── 🔴 **규칙은 여기 적지 않는다** ──────────────────────────────────────
 * 무엇을 어떤 차례로 보일지(`stockRequestLineDetails`), 앞세울 값(`stockRequestLineCustomerName`),
 * 딱지의 글자와 꾸밈(`stockRequestLineOwnerTag` · `stockRequestLineChargeTag`)이 전부 순수
 * 모듈 쪽이고 **여기는 받은 것을 그리기만** 한다. 🔵 이 화면은 서버 액션을 부르는 클라이언트
 * 컴포넌트라 이 환경에서 그려 볼 수 없어서(이 파일 짝 시험의 머리말), 규칙을 여기 적으면
 * **아무도 돌려 보지 못한다.**
 *
 * ── 차례는 ① 고객사 품명 ② 딱지 둘 ③ 나머지 글자 ───────────────────────
 * 🔴 **고객사 품명이 앞선다** — 고객사와 말을 주고받을 때 쓰는 이름이라 **눈으로 훑어 찾는 값**이
 *    이것이다. **색만으로 가르지 않는다**: ⓐ 제 줄을 갖고 ⓑ 맨 위에 서고 ⓒ 굵고 ⓓ 한 치수 크다.
 *    색은 그 위에 얹는 것이고, 색을 빼도 넷이 남는다.
 * 🔴 **딱지가 앞자리를 빼앗지도, 맨 뒤로 밀리지도 않는다.** 유상/무상은 **돈이 걸린 값**이라
 *    (틀리면 비용이 잘못 간다) 품번·도번 뒤에 흘려 적으면 놓친다. 가운데에서 **상자 모양**으로
 *    서는 자리가 「훑을 값 하나」와 「놓치면 안 되는 값」을 둘 다 지킨다.
 * 🔴 **값이 없으면 그 줄이 통째로 안 선다** — 빈 자리도, 「없음」 같은 글자도 만들지 않는다.
 * 🔵 `span`(display:block)인 까닭: 부르는 자리가 `li` 안이라 글 흐름을 끊지 않게.
 * ============================================================================
 */
/**
 * ============================================================================
 * 딱지 줄 하나 — 🔴 **이 칸에서 딱지를 그리는 자리는 여기 하나다** (2026-10-22)
 * ============================================================================
 * 전에는 올린 뒤의 줄(`StockRequestLineDetails`) 안에만 있던 markup 인데, 같은 날 **담는 중인
 * 장바구니 줄**에도 딱지가 서게 되면서 떼어 냈다. 재고 관리가 세 화면을 위해 `RequestItemDetails`
 * 하나로 모아 둔 것과 **같은 까닭·같은 처방**이다.
 *
 * 🔴 **두 벌로 적으면 담는 중과 올린 뒤의 딱지가 다르게 보인다** — 같은 요청의 같은 부품인데
 *    테두리·여백·글자 크기가 갈리고, 이 환경에서는 그려 볼 수 없어 아무도 못 본다.
 * 🔴 **글자도 꾸밈도 여기서 고르지 않는다** — 받은 것을 그리기만 한다(도메인 쪽 `*Tag` 함수들).
 * 🔵 **하나도 없으면 `null`** 이라 상자도 여백도 안 선다. 그래서 부르는 쪽이 「딱지가 있나」를
 *    따로 묻지 않는다 — 장바구니 줄은 대부분 비어 있다(손으로 담은 줄).
 * 🔵 `span`(display:flex)인 까닭: 부르는 자리 둘이 `td` 와 `li` 안이라 글 흐름을 끊지 않게.
 * 🔵 `flex-wrap` 인 까닭: 수리 건 상세의 이 칸은 좁아서 딱지들이 한 줄에 못 설 수 있다.
 */
function LineTags({ tags }: { tags: ReadonlyArray<StockRequestLineTag | null> }) {
  const shown = tags.filter((tag): tag is StockRequestLineTag => tag !== null);
  if (shown.length === 0) return null;
  return (
    <span className="mt-1 flex flex-wrap items-center gap-1">
      {shown.map((tag) => (
        <span
          key={tag.key}
          className={`inline-flex items-center gap-1 rounded border px-1.5 py-px text-[11px] leading-tight ${tag.className}`}
        >
          {/* 🔵 이름표가 있는 딱지만 이름표를 그린다 — 「유상」·「무상」·「O/H」는 값 자체가 말이 된다(도메인 쪽 주석). */}
          {tag.label !== "" && <span className="font-normal text-zinc-400 dark:text-zinc-500">{tag.label}</span>}
          {tag.value}
        </span>
      ))}
    </span>
  );
}

function StockRequestLineDetails({ line }: { line: InventoryStockRequestLine }) {
  const customerName = stockRequestLineCustomerName(line);
  const rest = stockRequestLineDetails(line);
  /**
   * 🔴 **두 번 따로 묻는다.** 받는 칸이 갈려 있어(부품의 소유 ↔ 그 줄의 유상/무상) 이 두 줄이 곧
   *    「성격이 다르다」는 말이고, 한 함수로 합치면 그 가름이 사라진다(도메인 쪽 머리말).
   * 🔵 차례는 소유 → 유상/무상이다 — 재고 관리 화면과 같다.
   */
  /**
   * 🔴 **O/H 딱지가 셋째다** (2026-10-22, 쓰는 분 요청). **앞의 둘 자리를 건드리지 않는다** —
   *    소유와 유상/무상은 이미 눈이 익은 자리이고, 새 딱지가 사이로 끼어들면 그 둘이 통째로 밀린다.
   * 🔵 **같은 차례를 재고 관리도 쓴다**(저쪽 `RequestItemDetails`): 소유 → 유상/무상 → O/H.
   * 🔵 담는 중인 장바구니 줄도 **같은 함수**(`stockRequestOhTag`)를 부른다 — 위 표의 그 줄.
   */
  const tags: StockRequestLineTag[] = [
    stockRequestLineOwnerTag(line),
    stockRequestLineChargeTag(line),
    stockRequestOhTag(line),
  ].filter((tag): tag is StockRequestLineTag => tag !== null);
  if (customerName === "" && tags.length === 0 && rest.length === 0) return null;
  return (
    <>
      {/* 🔴 앞세우는 줄 — 굵기·크기·자리로 가른다(색만으로 가르지 않는다, 위 머리말). */}
      {customerName !== "" && (
        <span className="mt-0.5 block text-xs leading-snug font-medium text-zinc-900 dark:text-zinc-100">
          {/* 🔵 이름표는 값보다 옅고 가늘게 — 굵은 것이 둘이면 어느 쪽을 훑어야 하는지 알 수 없다.
              🔴 글자는 **정해 둔 한 곳**에서 온다(요청 ③) — 여기 쳐 두면 그 말이 바뀌는 날 이 줄만 옛말을 한다. */}
          <span className="font-normal text-zinc-400 dark:text-zinc-500">{PART_FIELD_LABELS.customerPartName} </span>
          {customerName}
        </span>
      )}
      <LineTags tags={tags} />
      {rest.length > 0 && (
        <span className="mt-0.5 block text-[11px] leading-snug text-zinc-500 dark:text-zinc-400">
          {rest.map((detail, index) => (
            <span key={detail.key}>
              {/* 🔵 이름표는 더 옅게, 값은 읽히게 — 훑는 것은 값이고 이름표는 「무슨 칸인지」만 알려 주면 된다. */}
              {index > 0 && <span className="text-zinc-300 dark:text-zinc-600"> · </span>}
              <span className="text-zinc-400 dark:text-zinc-500">{detail.label} </span>
              {detail.value}
            </span>
          ))}
        </span>
      )}
    </>
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
