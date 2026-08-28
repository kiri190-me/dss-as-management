"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { CustomerLinkInfo, CustomerPortalItem } from "@/lib/db/queries/customer-portal";
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
 */
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
  const [selectedId, setSelectedId] = useState<string | null>(links[0]?.id ?? null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  /** 발급 직후 한 번만 보이는 주소. 새로고침하면 사라진다 — 저장하지 않으므로. */
  const [issuedUrl, setIssuedUrl] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const selected = links.find((l) => l.id === selectedId) ?? null;
  const items = selected ? (itemsByCustomer[selected.customerId] ?? []) : [];

  function run(action: () => Promise<{ ok: boolean; message: string; url?: string }>) {
    startTransition(async () => {
      const result = await action();
      setMessage({ ok: result.ok, text: result.message });
      if (result.url) setIssuedUrl(result.url);
      if (result.ok) router.refresh();
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
            이 주소는 지금 한 번만 보입니다. 복사해서 고객사에 전달하세요.
          </p>
          <p className="mt-2 rounded border border-amber-200 bg-white px-3 py-2 font-mono text-xs break-all text-zinc-800">
            {issuedUrl}
          </p>
          <p className="mt-2 text-xs text-amber-800">
            저장해 두지 않으므로 새로고침하면 사라집니다. 잃어버리면 다시
            발급해야 하고, 그때 옛 주소는 자동으로 회수됩니다.
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
              onClick={() => setSelectedId(link.id)}
              className={`rounded-lg border px-4 py-2 text-sm font-semibold transition-colors ${
                link.id === selectedId
                  ? "border-zinc-900 bg-zinc-900 text-white"
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
                className="rounded-lg bg-zinc-900 px-4 py-2 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"
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

          {/* ───── 고객이 보는 목록 ───── */}
          {items.length === 0 ? (
            <p className="rounded-lg border border-zinc-200 bg-zinc-50 px-6 py-12 text-center text-sm text-zinc-500">
              이 고객사에 진행 중인 건이 없습니다. 고객 화면도 비어 있습니다.
            </p>
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
                className="shrink-0 rounded bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-white"
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
