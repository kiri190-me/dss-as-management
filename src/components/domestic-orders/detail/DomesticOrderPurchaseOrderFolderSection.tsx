"use client";

import { useEffect, useState } from "react";

import ContactFolderEntryOpenButton from "@/components/repair-cases/files/ContactFolderEntryOpenButton";
import ContactFolderPlaceOpenButton from "@/components/repair-cases/files/ContactFolderPlaceOpenButton";
import {
  PURCHASE_ORDER_FOLDER_SECTION_EMPTY_TEXT,
  PURCHASE_ORDER_FOLDER_SECTION_FAILED_TEXT,
  PURCHASE_ORDER_FOLDER_SECTION_LOADING_TEXT,
  PURCHASE_ORDER_FOLDER_SECTION_TITLE,
  canOpenPurchaseOrderFolderEntry,
  purchaseOrderFolderEntryMeta,
  purchaseOrderFolderOpenPath,
  purchaseOrderFolderTruncatedText,
  readPurchaseOrderFolderEntriesAnswer,
  type PurchaseOrderFolderEntryView,
  type PurchaseOrderFolderSectionState,
} from "@/components/repair-cases/purchase-orders/PurchaseOrderFolderSection";
import { DOMESTIC_ORDER_PURCHASE_ORDER_ARCHIVE_NO_NUMBER_TEXT } from "@/lib/domain/domestic-order-purchase-order-archive";
import {
  SHARE_FOLDER_ENTRY_ACTIONS_CLASS,
  SHARE_FOLDER_ENTRY_META_MODIFIED_CLASS,
  SHARE_FOLDER_ENTRY_META_SIZE_CLASS,
  SHARE_FOLDER_ENTRY_NAME_GROW_CLASS,
  SHARE_FOLDER_ENTRY_ROW_CLASS,
} from "@/lib/domain/share-folder-entry-meta";

/**
 * ============================================================================
 * 기타건 「발주서」 탭의 **공유폴더 구역** — 내자 정리에 적힌 번호의 폴더 (2026-11-06)
 * ============================================================================
 * 사용자 결정 2026-11-06: 「[발주서]는 내자정리에 적힌 **[발주서 번호]**를 통해서
 * 발주서들을 찾도록 해줘(수리건의 발주서 위치와 동일 … **같은 발주서 번호를 가진 폴더와
 * 연결**)」. 서류함은 수리 건 「발주서」 탭이 보는 **그 한 곳**이고, 다른 것은 **무엇으로
 * 찾는가** 하나다 — 그쪽은 장비(L/N · S/N), 여기는 번호다(기타건에는 L/N 도 S/N 도 없다).
 *
 * ── 🔴 **가져다 쓴 것과 여기 있는 것** ───────────────────────────────────
 *  · 🔴 **줄 읽기 · 줄 모양 · 공용 문장 넷**은 수리 건 쪽 구역의 것을 그대로 부른다
 *    (readPurchaseOrderFolderEntriesAnswer · purchaseOrderFolderEntryMeta ·
 *    canOpenPurchaseOrderFolderEntry · purchaseOrderFolderOpenPath · 제목 · 불러오는 중 ·
 *    빈 폴더 · 읽지 못했습니다 · 잘림 곁말). 같은 서류함의 같은 줄이라 두 벌을 두면 같은
 *    폴더가 창마다 다르게 보인다. 표의 칸 생김새 · 날짜 모양도 공용 한 벌이다
 *    (domain/share-folder-entry-meta.ts) — **열을 더하지 않는다.**
 *  · 🔴 줄의 [열기] · 맨 아래 [폴더 열기]는 연락서 쪽 단추 두 벌을 **한 글자도 고치지 않고**
 *    쓴다. 설치되는 도우미는 **PC 당 한 벌**이라 베끼면 반드시 한쪽만 고쳐진다. 그 단추가
 *    함께 내는 안내(「열리지 않으면 [설치 명령 복사]로 …」)도 그대로 따라오고 **끄지 않는다.**
 *  · 🔴 **여기 있는 것은 문장 셋과 그리는 틀이다.** 수리 건 쪽 구역을 통째로 가져다 쓰지
 *    **않은** 까닭이 그 셋이다 — 저쪽 문장은 「이 **장비**의 … 폴더」 · 「같은 **날짜**의
 *    폴더가 여럿」 · 「이 장비(L/N · S/N)의 가장 최근 …」이라, 장비도 날짜도 쓰지 않는 이
 *    화면에 걸면 **화면이 거짓말을 한다.** 글자만 바꿔 끼울 칸이 저쪽에 없다.
 *
 * ── 🔴 통로가 받는 것은 **내자 줄의 id** 다 ───────────────────────────────
 * 발주서번호를 화면에서 실어 보내지 않는다 — 그러면 내자 정리를 볼 수 있는 사람이 아무
 * 번호나 넣어 **남의 발주 건 폴더**(다른 고객사의 발주서 · 금액)를 들여다볼 수 있다. 번호는
 * 서버가 그 줄에서 꺼낸다(api/domestic-orders/[id]/purchase-order-folder/entries ·
 * domain/domestic-order-purchase-order-archive.ts). 🔴 아래 `label` 은 **머리에 적는 글자일
 * 뿐** 찾기에 쓰이지 않는다(바꿔도 다른 폴더가 열리지 않는다).
 *
 * ── 🔴 **번호로 줄을 거르지 않는다** ──────────────────────────────────────
 * 폴더 **전체**가 보인다 — 그 폴더가 이미 그 번호의 발주 건이고, 사람이 손으로 넣어 둔 서류
 * (메일 출력 · 신용장)가 숨으면 「파일이 없어졌다」로 읽힌다. 거르는 길은 견적서 결재 탭의
 * 것이다(수리 건 발주서 구역도 거르지 않는다).
 *
 * ── 🔴 이 구역에만 있는 상태 하나 ─────────────────────────────────────────
 *  · `no-po-number` — 줄에 쓸 수 있는 발주서번호가 없다(빈 칸 · `-` 한 글자)
 * **공유폴더를 보지 않았다**는 뜻이라 「없습니다」가 아니라 **차분한 한 줄**이다. 🔴 글자는
 * 탭 페이지가 쓰는 것과 **같은 한 벌**이다(domain/domestic-order-purchase-order-archive.ts).
 * 🔴 **정상 경로에서는 오지 않는다** — 탭 페이지가 같은 순수 함수로 미리 가려 그때는 구역
 * 대신 안내 상자를 세운다. 그래도 받는 까닭은 통로가 그 상태를 낼 수 있기 때문이다(화면이
 * 뜬 뒤 그 줄의 번호가 지워지면 실제로 온다).
 *
 * ── 🔵 `issuedDate` 칸은 여기서 **늘 빈 글자**다 ──────────────────────────
 * 통로가 폴더 이름의 **날짜를 읽지 않는다**(번호가 곧 그 발주 건이라 가릴 것이 없고, 읽으려면
 * 날짜 문법을 두 벌째 적어야 한다 — storage/purchase-order-number-archive.ts 머리말). 그래서
 * 머리에 날짜를 적지 않는다. 칸이 남아 있는 것은 **줄 읽기를 수리 건 쪽 한 벌에 맡겼기**
 * 때문이고, 그 한 벌이 내는 모양을 여기서 깎으면 읽기가 두 벌이 된다.
 *
 * ── 🔴 서버 컴포넌트에서 읽지 않는다 ─────────────────────────────────────
 * 탭이 뜰 때 공유폴더를 읽으면 **NAS 가 느리거나 꺼진 날 탭 자체가 안 뜬다.** 화면이 뜬 뒤
 * 여기서 따로 통로를 부른다 — 이 구역만 「불러오는 중…」 → 「읽지 못했습니다」가 된다.
 *
 * ── 🔴 읽기만 한다 · 인쇄에 안 찍힌다 ────────────────────────────────────
 * 폴더를 만들지도, 파일을 올리지도, 지우지도 않는다. 공유폴더는 그때그때 달라지는 바깥
 * 사정이라 종이에 남길 것이 아니다.
 *
 * ── 던지지 않는다 · 바꿔 끼울 수 있다 ──────────────────────────────────────
 * fetch 를 부르는 쪽이 바꿔 끼울 수 있다 — 네트워크 없이 값으로 시험한다
 * (domestic-order-purchase-order-tab-screens.test.tsx).
 * ============================================================================
 */

/** 목록 통로의 주소. 🔴 **번호를 싣는 칸이 없다** — 받는 것은 내자 줄의 id 하나다. */
export function domesticOrderPurchaseOrderFolderEntriesUrl(domesticOrderId: string): string {
  return `/api/domestic-orders/${encodeURIComponent(domesticOrderId)}/purchase-order-folder/entries`;
}

// ── 문장 — 🔴 **이 화면에서만 다른 셋** ───────────────────────────────────

/**
 * 머리 — 🔴 **어느 번호의 폴더를 보고 있는지** 적는다. 번호를 안 적으면 폴더 경로의 긴
 * 이름만 남아, 이 상자가 이 줄의 발주 건인지 한눈에 알 수 없다.
 */
export function domesticOrderPurchaseOrderFolderSectionTitle(label: string): string {
  return label === "" ? PURCHASE_ORDER_FOLDER_SECTION_TITLE : `${PURCHASE_ORDER_FOLDER_SECTION_TITLE} — ${label}`;
}

/**
 * 🔴 폴더를 세우는 일은 앱이 하지 않는다 — 공유폴더는 사람이 만든다. 수리 건 쪽 문장과
 * **다른 까닭**으로 다른 글자다: 저쪽은 「이 장비의」이고 여기는 「이 번호의」다.
 */
export const DOMESTIC_ORDER_PURCHASE_ORDER_FOLDER_NOT_FOUND_TEXT =
  "아직 공유폴더에서 이 발주서번호의 발주 건 폴더를 찾지 못했습니다";

/** 🔴 목록을 내지 않는다 — 번호가 같다고 같은 발주 건이라는 보장이 없다(사람이 정리한다). */
export const DOMESTIC_ORDER_PURCHASE_ORDER_FOLDER_MULTIPLE_TEXT =
  "같은 발주서번호의 폴더가 여럿입니다 — 공유폴더에서 하나로 정리해 주세요";

/**
 * 🔴 **무엇만 보이는지 미리 적는다.** 그 말이 없으면 「다른 발주서가 없어졌다」로 읽힌다 —
 * 이 구역은 **그 번호의 폴더 하나**이고, 그 폴더 안의 것만 보여 준다.
 */
export const DOMESTIC_ORDER_PURCHASE_ORDER_FOLDER_SCOPE_TEXT =
  "내자 정리에 적힌 발주서번호와 같은 번호의 발주 건 폴더 하나만 보입니다 — 폴더 밖은 [폴더 열기]로 보세요.";

const NETWORK_FAILED_REASON = "서버에 닿지 못했습니다(네트워크 상태를 확인해 주세요)";
const UNREADABLE_RESPONSE_REASON = "서버 응답을 읽지 못했습니다";

function rejectedReason(status: number): string {
  return `서버가 요청을 처리하지 못했습니다(HTTP ${status})`;
}

// ── 값 ───────────────────────────────────────────────────────────────────

/**
 * 🔴 수리 건 쪽 상태에서 **`no-order-date` 를 뺀** 것 + 이 구역의 상태 하나.
 * 뺀 까닭: 이 통로는 **발주발행일로 문을 열지 않아** 그 상태를 내지 않는다(머리말). 타입에
 * 남겨 두면 그릴 자리를 만들게 되고, 그 자리에는 이 화면에 없는 조건을 설명하는 글이 들어간다.
 */
export type DomesticOrderPurchaseOrderFolderSectionState =
  | Exclude<PurchaseOrderFolderSectionState, { kind: "no-order-date" }>
  /** 🔴 줄에 쓸 수 있는 발주서번호가 없다 — 공유폴더를 **보지 않았다**. */
  | { kind: "no-po-number" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 🔴 **이 통로에만 있는 상태를 먼저 보고**, 나머지는 수리 건 쪽 읽기에 그대로 맡긴다 —
 * 줄 · 경로 · 잘림을 읽는 규칙을 두 벌로 두지 않는다. 모양이 다르면 null 이다.
 *
 * 🔴 `no-order-date` 가 오면 **모르는 모양으로 다룬다**(null → 「읽지 못했습니다」). 이
 * 통로는 그 상태를 내지 않으므로, 왔다면 다른 통로의 답을 받은 것이다 — 그 글자를 그리면
 * 이 화면에 없는 조건을 사람에게 설명하게 된다.
 */
export function readDomesticOrderPurchaseOrderFolderAnswer(
  payload: unknown
): DomesticOrderPurchaseOrderFolderSectionState | null {
  if (isRecord(payload) && payload.status === "no-po-number") return { kind: "no-po-number" };
  const answer = readPurchaseOrderFolderEntriesAnswer(payload);
  if (answer === null || answer.kind === "no-order-date") return null;
  return answer;
}

type EntriesResponse = {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
};

export type DomesticOrderPurchaseOrderFolderEntriesFetch = (url: string) => Promise<EntriesResponse>;

/** 실패 응답 `{ error, code }` 의 문장 — 서버 문장 그대로다. */
async function failureReason(response: EntriesResponse): Promise<string> {
  const payload = await response.json().catch(() => null);
  const error = isRecord(payload) && typeof payload.error === "string" ? payload.error.trim() : "";
  return error !== "" ? error : rejectedReason(response.status);
}

/**
 * 통로를 한 번 부른다. **던지지 않는다** — 무슨 일이 나도 `failed` 한 상태로 끝난다.
 * 이 구역이 실패해도 같은 화면의 다른 것은 아무 영향을 받지 않는다.
 */
export async function loadDomesticOrderPurchaseOrderFolderEntries(
  domesticOrderId: string,
  fetchImpl: DomesticOrderPurchaseOrderFolderEntriesFetch = (url) => fetch(url)
): Promise<DomesticOrderPurchaseOrderFolderSectionState> {
  let response: EntriesResponse;
  try {
    response = await fetchImpl(domesticOrderPurchaseOrderFolderEntriesUrl(domesticOrderId));
  } catch {
    return { kind: "failed", reason: NETWORK_FAILED_REASON };
  }
  if (!response.ok) return { kind: "failed", reason: await failureReason(response) };
  const answer = readDomesticOrderPurchaseOrderFolderAnswer(await response.json().catch(() => null));
  return answer ?? { kind: "failed", reason: UNREADABLE_RESPONSE_REASON };
}

// ── 그리기 ───────────────────────────────────────────────────────────────

const ENTRY_NAME_CLASS = `min-w-0 ${SHARE_FOLDER_ENTRY_NAME_GROW_CLASS} break-all text-left text-sm text-zinc-700 dark:text-zinc-300`;
const MUTED_CLASS = "text-sm text-zinc-500 dark:text-zinc-400";
const WARNING_CLASS = "text-sm font-medium text-amber-700 dark:text-amber-400";
/** 목록 아래에 붙는 **차분한** 곁말 — 잘림 곁말(amber)과 달리 경고가 아니다. */
const NOTE_CLASS = "text-xs text-zinc-500 dark:text-zinc-400";

/**
 * 🔴 **열 수 있는 폴더 경로** — 찾았을 때만 글자가 있고, 아니면 빈 글자다. 줄의 [열기]와
 * 맨 아래 [폴더 열기]가 이 하나를 함께 본다. 판정은 수리 건 쪽 함수 한 벌이고, 이 구역에만
 * 있는 상태(`no-po-number`)는 그보다 앞에서 **열 자리가 없다**로 끝난다.
 */
export function domesticOrderPurchaseOrderFolderOpenPath(
  state: DomesticOrderPurchaseOrderFolderSectionState
): string {
  return state.kind === "no-po-number" ? "" : purchaseOrderFolderOpenPath(state);
}

function EntryList({
  entries,
  relativePath,
}: {
  entries: readonly PurchaseOrderFolderEntryView[];
  /** 🔴 루트 아래의 폴더 경로. 비어 있으면 [열기]를 아무 줄에도 안 그린다(주소를 지어내지 않는다). */
  relativePath: string;
}) {
  return (
    <ul className="flex flex-col divide-y divide-zinc-200 dark:divide-zinc-800">
      {entries.map((entry) => {
        const openable = relativePath !== "" && canOpenPurchaseOrderFolderEntry(entry);
        const meta = purchaseOrderFolderEntryMeta(entry);
        return (
          <li
            key={`${entry.isDirectory ? "d" : "f"}:${entry.name}`}
            data-domestic-order-purchase-order-folder-entry-openable={openable ? "" : undefined}
            className={SHARE_FOLDER_ENTRY_ROW_CLASS}
          >
            <span className={ENTRY_NAME_CLASS}>
              {entry.isDirectory ? "📁 " : ""}
              {entry.name}
            </span>
            {/* 🔴 수정시각이 없어도 **칸은 그대로** 그린다 — 빼면 그 줄만 열이 어긋난다. */}
            <span className={SHARE_FOLDER_ENTRY_META_MODIFIED_CLASS}>{meta.modifiedText}</span>
            <span className={SHARE_FOLDER_ENTRY_META_SIZE_CLASS}>{meta.sizeText}</span>
            {/* 🔴 동작 칸은 **비어도 그린다** — 칸까지 빼면 그 줄만 날짜·크기가 어긋난다. */}
            <span className={SHARE_FOLDER_ENTRY_ACTIONS_CLASS}>
              {openable && <ContactFolderEntryOpenButton folderName={relativePath} fileName={entry.name} />}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * 상태 하나를 그린다. 🔴 `disabled` 면 **아무것도 그리지 않는다**(null) — 설정이 없는 개발
 * PC 에서 빈 상자가 늘지 않게. 상태를 직접 넣어 그려 볼 수 있게 따로 두었다(통로 · 네트워크
 * 없이 시험한다).
 */
export function DomesticOrderPurchaseOrderFolderSectionView({
  state,
  label = "",
}: {
  state: DomesticOrderPurchaseOrderFolderSectionState;
  /** 🔴 머리에 적는 **내자 정리의 발주서번호**. 찾기에는 쓰이지 않는다(머리말). */
  label?: string;
}) {
  if (state.kind === "disabled") return null;

  // 🔴 줄의 [열기]와 맨 아래 [폴더 열기]가 **같은 하나**를 본다. 빈 글자면 둘 다 안 그린다.
  const relativePath = domesticOrderPurchaseOrderFolderOpenPath(state);
  const title = domesticOrderPurchaseOrderFolderSectionTitle(label);

  return (
    <section
      // 🔴 `aria-labelledby` 가 아니라 `aria-label` 이다 — 이웃 구역들과 같은 규율(한 화면에
      //    공유폴더 상자가 둘 이상 설 수 있어 같은 id 를 여러 번 내지 않는다).
      aria-label={title}
      data-domestic-order-purchase-order-folder-section=""
      className="print:hidden flex flex-col gap-2 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">{title}</h2>
        {/* 🔴 찾았을 때만 — 그 폴더의 루트 기준 경로다(절대 경로가 아니다). */}
        {state.kind === "found" && state.relativePath !== "" && (
          <span className="min-w-0 break-all text-xs text-zinc-500 dark:text-zinc-400">{state.relativePath}</span>
        )}
      </div>

      {state.kind === "loading" && (
        <p aria-live="polite" className={MUTED_CLASS}>
          {PURCHASE_ORDER_FOLDER_SECTION_LOADING_TEXT}
        </p>
      )}

      {/* 🔴 공유폴더를 **보지 않았다** — 고장이 아니라 아직 그때가 아니라는 차분한 한 줄. */}
      {state.kind === "no-po-number" && (
        <p className={MUTED_CLASS}>{DOMESTIC_ORDER_PURCHASE_ORDER_ARCHIVE_NO_NUMBER_TEXT}</p>
      )}

      {state.kind === "not-found" && (
        <p className={MUTED_CLASS}>{DOMESTIC_ORDER_PURCHASE_ORDER_FOLDER_NOT_FOUND_TEXT}</p>
      )}

      {/* 🔴 목록을 내지 않는다 — 어느 폴더인지 모르는 채로 내용을 보이면 안 된다. */}
      {state.kind === "multiple" && (
        <p className={WARNING_CLASS}>{DOMESTIC_ORDER_PURCHASE_ORDER_FOLDER_MULTIPLE_TEXT}</p>
      )}

      {state.kind === "failed" && (
        <div className="flex flex-col gap-0.5">
          <p className={WARNING_CLASS}>{PURCHASE_ORDER_FOLDER_SECTION_FAILED_TEXT}</p>
          <p className="break-all text-xs text-zinc-500 dark:text-zinc-400">{state.reason}</p>
        </div>
      )}

      {state.kind === "found" &&
        (state.entries.length === 0 ? (
          <p className={MUTED_CLASS}>{PURCHASE_ORDER_FOLDER_SECTION_EMPTY_TEXT}</p>
        ) : (
          <div className="flex flex-col gap-1">
            <EntryList entries={state.entries} relativePath={relativePath} />
            {state.truncated && (
              <p className="text-xs text-amber-700 dark:text-amber-400">
                {purchaseOrderFolderTruncatedText(state.entries.length, state.totalCount)}
              </p>
            )}
          </div>
        ))}

      {/* 🔴 무엇만 보이는지 — 찾았을 때만 적는다(못 찾은 화면에서는 할 말이 아니다). */}
      {state.kind === "found" && <p className={NOTE_CLASS}>{DOMESTIC_ORDER_PURCHASE_ORDER_FOLDER_SCOPE_TEXT}</p>}

      {/*
        🔴 **폴더를 찾았을 때만** 선다 — 못 찾았거나(not-found) 여럿이거나(multiple) 번호가
        없거나(no-po-number) 설정이 꺼져 있거나(disabled) 읽다 실패했으면 **열 자리가 없다.**
        빈 폴더에는 그대로 선다(폴더는 있다).
        🔴 여는 장치는 연락서 쪽 자리 열기 단추 한 벌이다 — Windows 가 아니면 스스로 아무것도
        그리지 않고, 도우미 재설치 안내도 그 단추가 제 결과 줄로 함께 낸다. 여기서 끄지 않는다.
      */}
      {relativePath !== "" && <ContactFolderPlaceOpenButton relativePath={relativePath} />}
    </section>
  );
}

/**
 * 화면이 뜬 **뒤에** 따로 통로를 부른다. 떠난 뒤에 답이 와도 상태를 건드리지 않는다.
 *
 * 받은 답은 **어느 줄의 것인지와 함께** 든다 — 그래야 다른 줄로 넘어갔을 때 지난 폴더의
 * 목록이 잠깐 비치지 않는다(이웃 구역들과 같은 모양이다).
 */
export default function DomesticOrderPurchaseOrderFolderSection({
  domesticOrderId,
  label = "",
}: {
  domesticOrderId: string;
  label?: string;
}) {
  const [answer, setAnswer] = useState<{
    domesticOrderId: string;
    state: DomesticOrderPurchaseOrderFolderSectionState;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadDomesticOrderPurchaseOrderFolderEntries(domesticOrderId).then((state) => {
      if (!cancelled) setAnswer({ domesticOrderId, state });
    });
    return () => {
      cancelled = true;
    };
  }, [domesticOrderId]);

  const state: DomesticOrderPurchaseOrderFolderSectionState =
    answer !== null && answer.domesticOrderId === domesticOrderId ? answer.state : { kind: "loading" };

  return <DomesticOrderPurchaseOrderFolderSectionView state={state} label={label} />;
}
