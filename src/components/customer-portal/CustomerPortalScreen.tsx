"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { showSavePopup } from "@/components/common/SavePopup";
import { setStoredChoice, useStoredChoice } from "@/components/common/responsive-list";
import type { CustomerLinkInfo, CustomerPortalItem } from "@/lib/db/queries/customer-portal";
import {
  findPortalFormForCustomerName,
  manualColumnsOf,
  partsNameFromModelName,
  readManualValues,
  PORTAL_MANUAL_VALUE_MAX_LENGTH,
  type CustomerPortalForm,
  type PortalSystemField,
} from "@/lib/domain/customer-portal-forms";
import CustomerFormExportPanel from "./CustomerFormExportPanel";
import CustomerLinkAddress from "./CustomerLinkAddress";
import {
  issueCustomerLinkAction,
  revokeCustomerLinkAction,
  setCustomerStatusAction,
  syncNowAction,
} from "@/lib/server/actions/customer-portal";

/**
 * 고객 안내 현황 — 담당자가 실제로 일하는 화면.
 *
 * ■ 이 화면이 미리보기를 겸한다
 *
 * 여기 보이는 목록은 **고객이 보게 될 것과 같은 함수**에서 나온다
 * (listPortalItemsForCustomer). 각자 조회를 가지면 담당자가 본 것과 고객이
 * 보는 것이 갈리고, 그 어긋남은 아무도 눈치채지 못한 채 굳는다.
 *
 * ■ 저장과 내보내기를 나눈 이유
 *
 * 저장은 사내 기록이고 내보내기는 회사 밖으로 나가는 조작이다. 저장할 때마다
 * 자동으로 나가게 하면, 여러 건을 고치는 동안 **반쯤 고친 상태가 고객 화면에
 * 계속 비친다.** 다 고치고 한 번 누르게 한다.
 *
 * ■ 보기가 둘이다 — 기본 보기 / 고객사 양식
 *
 * 고객사들은 저마다 자기 엑셀 현황표를 쓴다(사용자 요청 2026-09-30). 그 열
 * 구성대로 그린 표를 **기본 9열 표 옆에 두지 않고 갈아 끼운다.** 위아래로
 * 쌓으면 같은 건이 두 번 나와 어느 쪽을 봐야 하는지 헷갈리고, 열이 열 개를
 * 넘는 표가 둘이면 화면이 통째로 길어진다.
 *
 * 🔴 **기본 9열 표는 그대로 있다.** 그것이 고객에게 나가는 것과 같은 모양이고,
 * 이 화면이 미리보기를 겸한다는 성질은 그 표가 가지고 있다. 고객사 양식은
 * 담당자가 그 회사와 주고받을 때 쓰는 **사내용 표**다 — 여기 더 보이는 칸들은
 * 밖으로 나가지 않는다(queries/customer-portal.ts 의 CustomerPortalItem 주석).
 */
/**
 * 고른 보기를 적어 두는 자리. 키 꼴은 common/responsive-list.tsx 의
 * 「무엇:어디」 관례를 따른다 — 키만 보고 무엇을 기억한 값인지 알 수 있게.
 */
const PORTAL_VIEW_STORAGE_KEY = "portal-table-view:customer-portal";
const PORTAL_VIEW_DEFAULT = "DEFAULT";
const PORTAL_VIEW_FORM = "FORM";

export default function CustomerPortalScreen({
  links,
  itemsByCustomer,
  statusOptions,
  customersWithoutLink,
  canManageLinks,
  canEdit,
}: {
  links: CustomerLinkInfo[];
  itemsByCustomer: Record<string, CustomerPortalItem[]>;
  statusOptions: { id: string; label: string }[];
  customersWithoutLink: { id: string; name: string }[];
  canManageLinks: boolean;
  canEdit: boolean;
}) {
  /**
   * 고른 고객사를 **링크 id 가 아니라 고객사 id 로** 기억한다.
   *
   * 재발급은 옛 링크를 회수하고 새 행을 만든다 — 링크 id 로 기억하면 재발급
   * 직후 그 id 가 살아 있는 목록에서 사라져 방금 발급한 고객사의 화면이 통째로
   * 닫힌다. 주소를 확인하러 재발급한 사람 눈앞에서 그 주소가 사라지는 셈이다.
   */
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(
    links[0]?.customerId ?? null
  );
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  /** 방금 발급한 주소. 전달까지가 한 흐름이라 그 자리에서 바로 보여 준다 —
   *  나중에도 아래 CustomerLinkAddress 로 다시 볼 수 있다. */
  const [issuedUrl, setIssuedUrl] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const selected = links.find((l) => l.customerId === selectedCustomerId) ?? null;
  const items = selected ? (itemsByCustomer[selected.customerId] ?? []) : [];

  /**
   * 고른 고객사에 정해진 양식. 없으면 null 이고 그때는 전환 단추 자체가 없다 —
   * 고를 것이 하나뿐인 단추는 무엇을 고르는 단추인지 알려 주지 못한다.
   */
  const form = findPortalFormForCustomerName(selected?.customerName);
  /**
   * 고른 보기를 **localStorage** 에 기억한다.
   *
   * 이 저장소가 목록의 표·카드 선택에 쓰는 바로 그 장치다(common/responsive-list.tsx
   * 의 useStoredChoice — 저장소가 막힌 브라우저에서도 죽지 않고, 서버 렌더와
   * 어긋나지 않게 useSyncExternalStore 로 읽는다). 키 이름도 그 파일이 정해 둔
   * 「무엇:어디」 꼴을 따른다.
   *
   * 주소 쿼리를 쓰지 않은 까닭: 바로 옆의 「어느 고객사를 보는가」가 이미
   * 주소가 아니라 화면 안의 값이다. 보기만 주소로 나르면 고객사를 바꿀 때마다
   * 주소가 반쯤만 맞는 상태가 되고, 이 페이지는 force-dynamic 이라 주소가
   * 바뀔 때마다 서버를 한 번 더 다녀온다.
   *
   * 고객사마다 따로 기억하지 않는다 — 이것은 "나는 고객사 양식으로 본다"는
   * **사람의 습관**이지 고객사의 성질이 아니다. 양식이 없는 고객사를 고르면
   * 기억한 값과 무관하게 기본 보기가 나온다(아래 showForm).
   */
  const storedView = useStoredChoice(PORTAL_VIEW_STORAGE_KEY);
  const showForm = form !== null && storedView === PORTAL_VIEW_FORM;

  function run(action: () => Promise<{ ok: boolean; message: string; url?: string }>) {
    startTransition(async () => {
      const result = await action();
      if (result.url) setIssuedUrl(result.url);
      if (!result.ok) {
        setMessage({ ok: false, text: result.message });
        return;
      }
      // 성공은 저장 팝업으로 알린다(common/SavePopup.tsx) — 이 화면이 곧 목록이라 머문다.
      setMessage(null);
      router.refresh();
      showSavePopup({ message: result.message, redirectTo: null });
    });
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
        <h1 className="text-2xl font-bold text-zinc-900">고객 안내 현황</h1>
        <p className="mt-2 text-sm text-zinc-600">
          고객사가 전용 주소로 들어왔을 때 보게 되는 화면입니다. 여기서 정한
          상태와 비고가 그대로 나갑니다 —{" "}
          <strong className="text-zinc-900">실제 작업 진행과는 별개</strong>이고,
          출하 완료된 건은 목록에서 빠집니다.
        </p>
        </div>
        {/* 메뉴가 하나뿐이라 두 화면은 서로를 통해 오간다. */}
        <Link
          href="/customer-portal/requests"
          className="shrink-0 rounded-lg border border-zinc-300 px-4 py-2 text-sm font-semibold text-zinc-700 hover:border-zinc-900"
        >
          고객이 보낸 수리 의뢰 →
        </Link>
      </header>

      {message ? (
        <p
          role="alert"
          className={`rounded-lg border px-4 py-3 text-sm ${
            message.ok
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border-red-200 bg-red-50 text-red-700"
          }`}
        >
          {message.text}
        </p>
      ) : null}

      {issuedUrl ? (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3">
          <p className="text-sm font-semibold text-amber-900">
            새 주소를 발급했습니다. 복사해서 고객사에 전달하세요.
          </p>
          <p className="mt-2 rounded border border-amber-200 bg-white px-3 py-2 font-mono text-xs break-all text-zinc-800">
            {issuedUrl}
          </p>
          <p className="mt-2 text-xs text-amber-800">
            옛 주소는 자동으로 회수됐습니다. 이 알림을 닫아도 아래
            「전용 주소」에서 언제든 다시 볼 수 있습니다.
          </p>
          <button
            type="button"
            onClick={() => setIssuedUrl(null)}
            className="mt-2 text-xs text-amber-900 underline underline-offset-2"
          >
            확인했습니다
          </button>
        </div>
      ) : null}

      {/* ───── 고객사 고르기 ───── */}
      <section className="flex flex-wrap items-center gap-2">
        {links.length === 0 ? (
          <p className="text-sm text-zinc-500">아직 발급된 주소가 없습니다.</p>
        ) : (
          links.map((link) => (
            <button
              key={link.id}
              type="button"
              onClick={() => setSelectedCustomerId(link.customerId)}
              className={`rounded-lg border px-4 py-2 text-sm font-semibold transition-colors ${
                link.customerId === selectedCustomerId
                  ? "border-primary-900 bg-primary-900 text-white"
                  : "border-zinc-300 text-zinc-700 hover:border-zinc-500"
              }`}
            >
              {link.customerName}
            </button>
          ))
        )}
      </section>

      {/* ───── 주소 발급 ───── */}
      {canManageLinks && customersWithoutLink.length > 0 ? (
        <section className="rounded-lg border border-zinc-200 bg-zinc-50 p-4">
          <h2 className="text-sm font-bold text-zinc-900">전용 주소 발급</h2>
          <p className="mt-1 text-xs text-zinc-600">
            주소를 아는 사람은 그 고객사의 A/S 현황을 전부 볼 수 있습니다.
            전달 대상을 확인하고 발급하세요.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {customersWithoutLink.map((customer) => (
              <button
                key={customer.id}
                type="button"
                disabled={pending}
                onClick={() =>
                  run(() =>
                    issueCustomerLinkAction({
                      customerId: customer.id,
                      customerName: customer.name,
                      label: null,
                    })
                  )
                }
                className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-xs text-zinc-700 hover:border-zinc-900 disabled:opacity-50"
              >
                + {customer.name}
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {selected ? (
        <>
          {/* ───── 지금 접속 가능한 전용 주소 ─────
              고객사를 고르면 그 주소를 보여 준다. 관리자 이상만 보이고
              (액션이 판정한다), 볼 수 없으면 아무것도 그리지 않는다. */}
          <CustomerLinkAddress linkId={selected.id} customerName={selected.customerName} />

          {/* ───── 고른 고객사의 링크 살림 ───── */}
          <section className="flex flex-wrap items-center gap-3 rounded-lg border border-zinc-200 px-4 py-3 text-sm">
            <span className="font-semibold text-zinc-900">{selected.customerName}</span>
            <span className="text-zinc-500">
              마지막 내보냄:{" "}
              {selected.lastSyncedAt
                ? `${new Date(selected.lastSyncedAt).toLocaleString("ko-KR")} (${selected.lastSyncedCount}건)`
                : "아직 없음"}
            </span>
            <div className="ml-auto flex gap-2">
              <button
                type="button"
                disabled={pending || !canEdit}
                onClick={() => run(() => syncNowAction({ linkId: selected.id }))}
                className="rounded-lg bg-primary-900 px-4 py-2 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"
              >
                지금 내보내기
              </button>
              {canManageLinks ? (
                <>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() =>
                      run(() =>
                        issueCustomerLinkAction({
                          customerId: selected.customerId,
                          customerName: selected.customerName,
                          label: null,
                        })
                      )
                    }
                    className="rounded-lg border border-zinc-300 px-4 py-2 text-xs text-zinc-700 hover:border-zinc-900 disabled:opacity-50"
                  >
                    주소 재발급
                  </button>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => run(() => revokeCustomerLinkAction({ linkId: selected.id }))}
                    className="rounded-lg border border-red-300 px-4 py-2 text-xs text-red-700 hover:border-red-600 disabled:opacity-50"
                  >
                    주소 회수
                  </button>
                </>
              ) : null}
            </div>
          </section>

          {/* ───── 보기 고르기 ─────
              양식이 정해진 고객사에서만 보인다. 없으면 고를 것이 없으므로
              단추도 없고, 아래는 언제나 기본 보기다. */}
          {form ? (
            <section className="flex flex-wrap items-center gap-3">
              <div className="flex gap-1 rounded-lg border border-zinc-300 p-1">
                <button
                  type="button"
                  aria-pressed={!showForm}
                  onClick={() =>
                    setStoredChoice(PORTAL_VIEW_STORAGE_KEY, PORTAL_VIEW_DEFAULT)
                  }
                  className={`rounded px-3 py-1.5 text-xs font-semibold transition-colors ${
                    showForm ? "text-zinc-600 hover:text-zinc-900" : "bg-primary-900 text-white"
                  }`}
                >
                  기본 보기
                </button>
                <button
                  type="button"
                  aria-pressed={showForm}
                  onClick={() => setStoredChoice(PORTAL_VIEW_STORAGE_KEY, PORTAL_VIEW_FORM)}
                  className={`rounded px-3 py-1.5 text-xs font-semibold transition-colors ${
                    showForm ? "bg-primary-900 text-white" : "text-zinc-600 hover:text-zinc-900"
                  }`}
                >
                  {form.label}
                </button>
              </div>
              {/* 어느 보기를 보고 있는지 글자로 분명히 말한다 — 두 표는 열이
                  달라 언뜻 보면 "자료가 바뀐 것"으로 읽힌다. */}
              <p className="text-xs text-zinc-600">
                {showForm ? (
                  <>
                    지금 <strong className="text-zinc-900">{form.label}</strong>으로 보고
                    있습니다. 이 표에만 있는 칸은 고객 화면으로 나가지 않습니다.
                  </>
                ) : (
                  <>
                    지금 <strong className="text-zinc-900">기본 보기</strong>로 보고
                    있습니다 — 고객이 보게 되는 그대로입니다.
                  </>
                )}
              </p>
            </section>
          ) : null}

          {/* ───── 고객사 양식 엑셀 내보내기 ─────
              양식 보기에서만 보인다. 기본 보기는 «고객이 보는 그대로»의 화면이고,
              내보내는 것은 고객사 양식 표라서 그 보기에 붙는 것이 맞다. */}
          {showForm && form && selected ? (
            <CustomerFormExportPanel
              customerId={selected.customerId}
              formLabel={form.label}
              canSave={canEdit}
            />
          ) : null}

          {/* ───── 고객이 보는 목록 ───── */}
          {items.length === 0 ? (
            <p className="rounded-lg border border-zinc-200 bg-zinc-50 px-6 py-12 text-center text-sm text-zinc-500">
              이 고객사에 진행 중인 건이 없습니다. 고객 화면도 비어 있습니다.
            </p>
          ) : showForm && form ? (
            <CustomerFormTable
              form={form}
              items={items}
              statusOptions={statusOptions}
              canEdit={canEdit}
              onSave={run}
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[64rem] border-collapse text-sm">
                <thead>
                  <tr className="border-b-2 border-zinc-800 text-left text-xs text-zinc-500">
                    <th className="px-3 py-2">접수번호</th>
                    <th className="px-3 py-2">Model</th>
                    <th className="px-3 py-2">L/N</th>
                    <th className="px-3 py-2">S/N</th>
                    <th className="px-3 py-2">접수일</th>
                    <th className="px-3 py-2">현재 상태</th>
                    <th className="px-3 py-2">비고</th>
                    <th className="px-3 py-2">견적서번호</th>
                    <th className="px-3 py-2">견적발행일</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <ItemRow
                      key={`${item.sourceKind}:${item.sourceId}`}
                      item={item}
                      statusOptions={statusOptions}
                      canEdit={canEdit}
                      onSave={run}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}

function ItemRow({
  item,
  statusOptions,
  canEdit,
  onSave,
}: {
  item: CustomerPortalItem;
  statusOptions: { id: string; label: string }[];
  canEdit: boolean;
  onSave: (action: () => Promise<{ ok: boolean; message: string }>) => void;
}) {
  const currentOption = statusOptions.find((o) => o.label === item.statusLabel);
  const [optionId, setOptionId] = useState(currentOption?.id ?? "");
  const [note, setNote] = useState(item.statusNote ?? "");

  // 접수 전 의뢰는 아직 접수가 아니라 상태를 붙일 자리가 없다. 고객 화면에도
  // 「접수 전」으로만 나간다.
  const pending = item.sourceKind === "REQUEST";
  const dirty =
    !pending && (optionId !== (currentOption?.id ?? "") || note !== (item.statusNote ?? ""));

  return (
    <tr className="border-b border-zinc-200">
      <td className="px-3 py-2 font-semibold whitespace-nowrap text-zinc-900">
        {pending ? (
          <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-800">
            접수 전
          </span>
        ) : (
          item.intakeNumber
        )}
      </td>
      <Cell value={item.modelName} />
      <Cell value={item.lotNumber} />
      <Cell value={item.serialNumber} />
      <Cell value={item.receivedAt} />
      <td className="px-3 py-2">
        {pending ? (
          <span className="text-zinc-400">-</span>
        ) : (
          <select
            value={optionId}
            disabled={!canEdit}
            onChange={(e) => setOptionId(e.target.value)}
            className="h-9 w-36 rounded border border-zinc-300 px-2 text-sm disabled:bg-zinc-100"
          >
            <option value="">- 정하지 않음</option>
            {statusOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        )}
      </td>
      <td className="px-3 py-2">
        {pending ? (
          <span className="text-zinc-400">-</span>
        ) : (
          <div className="flex items-center gap-2">
            <input
              value={note}
              disabled={!canEdit}
              maxLength={1000}
              onChange={(e) => setNote(e.target.value)}
              placeholder="고객에게 보일 한 줄"
              className="h-9 w-56 rounded border border-zinc-300 px-2 text-sm disabled:bg-zinc-100"
            />
            {dirty && canEdit ? (
              <button
                type="button"
                onClick={() =>
                  onSave(() =>
                    setCustomerStatusAction({
                      repairCaseId: item.sourceId,
                      statusOptionId: optionId || null,
                      note: note || null,
                      expectedVersion: item.statusVersion,
                    })
                  )
                }
                className="shrink-0 rounded bg-primary-900 px-3 py-1.5 text-xs font-semibold text-white"
              >
                저장
              </button>
            ) : null}
          </div>
        )}
      </td>
      <Cell value={item.quoteNumber} />
      <Cell value={item.quoteIssuedDate} />
    </tr>
  );
}

function Cell({ value }: { value: string | null }) {
  return (
    <td className="px-3 py-2 whitespace-nowrap text-zinc-700">
      {value ? value : <span className="text-zinc-400">-</span>}
    </td>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
 * 고객사 양식 표
 * ══════════════════════════════════════════════════════════════════════════
 * 열 구성은 여기 적지 않는다 — domain/customer-portal-forms.ts 가 갖는다. 이
 * 표가 하는 일은 그 목록을 차례대로 그리는 것뿐이라, 열이 늘거나 이름이 바뀔 때
 * 고칠 곳이 한 군데다.
 *
 * ⚠️ 가로 스크롤은 **표를 감싼 상자가 소유한다**(아래 overflow 상자). 표 자체에
 * 넘침을 맡기면 넘친 폭이 페이지로 퍼져 화면 전체가 옆으로 밀린다 — 이 저장소에
 * 그 고장이 있었다. 열이 열셋인 양식이 있어 최소 폭을 넉넉히 준다.
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * 빈 칸에 치는 **빗금**. 클래스가 아니라 인라인 스타일인 까닭 둘 —
 * 이 한 칸에만 쓰는 모양이라 유틸리티 클래스로 만들 값이 아니고, 대각선
 * 그라디언트를 클래스 이름으로 적으면 글자가 길어 무엇을 그리는지 읽히지 않는다.
 */
const EMPTY_SLASH_STYLE = {
  backgroundImage:
    "linear-gradient(to top right, transparent calc(50% - 0.5px), #a1a1aa calc(50% - 0.5px), #a1a1aa calc(50% + 0.5px), transparent calc(50% + 0.5px))",
} as const;

function CustomerFormTable({
  form,
  items,
  statusOptions,
  canEdit,
  onSave,
}: {
  form: CustomerPortalForm;
  items: CustomerPortalItem[];
  statusOptions: { id: string; label: string }[];
  canEdit: boolean;
  onSave: (action: () => Promise<{ ok: boolean; message: string }>) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[80rem] border-collapse text-sm">
        <thead>
          <tr className="border-b-2 border-zinc-800 text-left text-xs text-zinc-500">
            {form.columns.map((column) => (
              <th key={column.key} scope="col" className="px-3 py-2">
                {column.label}
              </th>
            ))}
            {/* 엑셀에는 없는 칸이다. 적은 것을 저장하는 단추 자리 — 열이 열 개를
                넘어 비고 옆에 끼워 넣으면 어느 줄의 단추인지 알기 어렵다. */}
            {canEdit ? (
              <th scope="col" className="px-3 py-2">
                저장
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {items.map((item, index) => (
            <FormItemRow
              key={`${item.sourceKind}:${item.sourceId}`}
              form={form}
              item={item}
              rowNumber={index + 1}
              statusOptions={statusOptions}
              canEdit={canEdit}
              onSave={onSave}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** 시스템이 아는 값 하나를 꺼낸다. 🔴 여기 빠진 이름이 있으면 tsc 가 막는다. */
function systemValueOf(item: CustomerPortalItem, field: PortalSystemField): string | null {
  switch (field) {
    case "intakeNumber":
      return item.intakeNumber;
    case "endUserName":
      return item.endUserName;
    case "modelName":
      return item.modelName;
    case "lotNumber":
      return item.lotNumber;
    case "serialNumber":
      return item.serialNumber;
    case "receivedAt":
      return item.receivedAt;
    case "quoteNumber":
      return item.quoteNumber;
    case "quoteIssuedDate":
      return item.quoteIssuedDate;
    case "orderIssuedDate":
      return item.orderIssuedDate;
    case "customerRequestedDueDate":
      return item.customerRequestedDueDate;
  }
}

function FormItemRow({
  form,
  item,
  rowNumber,
  statusOptions,
  canEdit,
  onSave,
}: {
  form: CustomerPortalForm;
  item: CustomerPortalItem;
  rowNumber: number;
  statusOptions: { id: string; label: string }[];
  canEdit: boolean;
  onSave: (action: () => Promise<{ ok: boolean; message: string }>) => void;
}) {
  const currentOption = statusOptions.find((o) => o.label === item.statusLabel);
  const [optionId, setOptionId] = useState(currentOption?.id ?? "");
  const [note, setNote] = useState(item.statusNote ?? "");
  /**
   * 손으로 적은 값들. 🔴 저장된 것을 **지금 양식으로 걸러** 담는다 — 양식에서
   * 열이 빠진 뒤에 남아 있던 옛 값이 그대로 들어오면, 어느 칸에도 안 보이는
   * 값을 다음 저장이 그대로 다시 써 넣는다.
   */
  const initialValues = readManualValues(form, item.formValues);
  const [values, setValues] = useState<Record<string, string>>(initialValues);

  // 접수 전 의뢰는 아직 접수가 아니라 값을 붙일 자리가 없다(기본 보기와 같다).
  const pending = item.sourceKind === "REQUEST";
  const valuesChanged = manualValuesDiffer(form, initialValues, values);
  const dirty =
    !pending &&
    (optionId !== (currentOption?.id ?? "") ||
      note !== (item.statusNote ?? "") ||
      valuesChanged);

  function setValue(key: string, next: string) {
    setValues((previous) => ({ ...previous, [key]: next }));
  }

  return (
    <tr className="border-b border-zinc-200 align-top">
      {form.columns.map((column) => {
        switch (column.kind) {
          case "ROW_NUMBER":
            return (
              <td
                key={column.key}
                className="px-3 py-2 whitespace-nowrap text-zinc-500 tabular-nums"
              >
                {rowNumber}
              </td>
            );
          case "SYSTEM":
            return <Cell key={column.key} value={systemValueOf(item, column.field)} />;
          case "DERIVED":
            // 지금 이 갈래의 칸은 ICD 의 「Parts 명」 하나다. 모르는 모델명은 빈칸.
            return <Cell key={column.key} value={partsNameFromModelName(item.modelName)} />;
          case "STATUS":
            return (
              <td key={column.key} className="px-3 py-2">
                {pending ? (
                  <span className="text-zinc-400">-</span>
                ) : (
                  <select
                    value={optionId}
                    disabled={!canEdit}
                    aria-label={column.label}
                    onChange={(e) => setOptionId(e.target.value)}
                    className="h-9 w-32 rounded border border-zinc-300 px-2 text-sm disabled:bg-zinc-100"
                  >
                    <option value="">- 정하지 않음</option>
                    {statusOptions.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                )}
              </td>
            );
          case "NOTE":
            return (
              <td key={column.key} className="px-3 py-2">
                {pending ? (
                  <span className="text-zinc-400">-</span>
                ) : (
                  <input
                    value={note}
                    disabled={!canEdit}
                    maxLength={1000}
                    aria-label={column.label}
                    onChange={(e) => setNote(e.target.value)}
                    className="h-9 w-48 rounded border border-zinc-300 px-2 text-sm disabled:bg-zinc-100"
                  />
                )}
              </td>
            );
          case "MANUAL": {
            const value = values[column.key] ?? "";
            const slashWhenEmpty = column.emptyMark === "SLASH" && !value;
            return (
              <td key={column.key} className="px-3 py-2">
                {pending ? (
                  <span className="text-zinc-400">-</span>
                ) : (
                  <input
                    type={column.valueKind === "date" ? "date" : "text"}
                    value={value}
                    disabled={!canEdit}
                    maxLength={PORTAL_MANUAL_VALUE_MAX_LENGTH}
                    aria-label={column.label}
                    style={slashWhenEmpty ? EMPTY_SLASH_STYLE : undefined}
                    onChange={(e) => setValue(column.key, e.target.value)}
                    className="h-9 w-32 rounded border border-zinc-300 px-2 text-sm disabled:bg-zinc-100"
                  />
                )}
              </td>
            );
          }
        }
      })}
      {canEdit ? (
        <td className="px-3 py-2">
          {dirty ? (
            <button
              type="button"
              onClick={() =>
                onSave(() =>
                  setCustomerStatusAction({
                    repairCaseId: item.sourceId,
                    statusOptionId: optionId || null,
                    note: note || null,
                    // 🔴 상태·비고와 **한 번에** 보낸다. 나눠 보내면 저장이 둘이
                    //    되고, 첫 저장이 올린 version 때문에 둘째가 충돌로 막힌다.
                    formValues: values,
                    expectedVersion: item.statusVersion,
                  })
                )
              }
              className="rounded bg-primary-900 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
            >
              저장
            </button>
          ) : (
            <span className="text-xs text-zinc-400">—</span>
          )}
        </td>
      ) : null}
    </tr>
  );
}

/**
 * 손으로 적은 값이 처음과 달라졌는가. 🔴 **그 양식의 칸만** 견준다 — 양식에
 * 없는 키가 양쪽에 남아 있어도 "고쳤다"가 되지 않게.
 */
function manualValuesDiffer(
  form: CustomerPortalForm,
  before: Record<string, string>,
  after: Record<string, string>
): boolean {
  return manualColumnsOf(form).some(
    (column) => (before[column.key] ?? "") !== (after[column.key] ?? "")
  );
}
