"use client";

import { useState } from "react";
import Link from "next/link";
import RejectRequestDialog from "./RejectRequestDialog";

/**
 * 고객이 보낸 수리 의뢰 목록 — 접수로 만들거나 반려하는 곳.
 *
 * ■ 이 화면이 접수를 만들지 않는다
 *
 * 「접수 만들기」는 기존 A/S 접수 화면으로 넘길 뿐이다
 * (`/repair-cases/new?fromRequestId=…`). 접수를 만드는 길이 둘이 되면 그
 * 950줄짜리 폼의 검증과 idempotency 를 한 벌 더 갖게 되고, 언젠가 한쪽만
 * 고쳐진다. 여기서는 **아는 값을 들고 그 화면으로 데려다줄 뿐**이다.
 *
 * ■ 반려는 지우지 않는다
 *
 * 사유와 함께 남긴다. 고객은 자기가 보낸 것이 어떻게 됐는지 볼 수 없으므로,
 * 사내에 기록이 없으면 "그런 의뢰 받은 적 없다"가 되어 버린다.
 */

export type RequestListItem = {
  id: string;
  customerName: string;
  companyName: string;
  contactName: string;
  contactPhone: string;
  productModelName: string;
  lotNumber: string;
  serialNumber: string;
  endUser: string;
  symptomDescription: string;
  alarmName: string | null;
  submittedAt: string;
  status: string;
  convertedRepairCaseId: string | null;
};

export default function CustomerRequestListScreen({
  requests,
  canConvert,
}: {
  requests: RequestListItem[];
  canConvert: boolean;
}) {
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  /** 반려 대화상자를 띄운 의뢰. null이면 닫힌 상태다. */
  const [rejecting, setRejecting] = useState<RequestListItem | null>(null);

  const waiting = requests.filter((r) => r.status === "NEW" || r.status === "CONVERTING");
  const done = requests.filter((r) => r.status !== "NEW" && r.status !== "CONVERTING");

  return (
    <div className="flex flex-col gap-6 p-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
        <h1 className="text-2xl font-bold text-zinc-900">수리 의뢰</h1>
        <p className="mt-2 text-sm text-zinc-600">
          고객사가 전용 주소에서 보낸 의뢰입니다. 내용을 확인하고 접수로
          만들거나 반려합니다 — <strong className="text-zinc-900">유·무상과
          제품 모델은 접수 화면에서 담당자가 정합니다.</strong>
        </p>
        </div>
        <Link
          href="/customer-portal"
          className="shrink-0 rounded-lg border border-zinc-300 px-4 py-2 text-sm font-semibold text-zinc-700 hover:border-zinc-900"
        >
          ← 고객 안내 현황
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

      <section>
        <h2 className="text-sm font-bold text-zinc-900">
          처리 대기 {waiting.length > 0 ? `(${waiting.length})` : ""}
        </h2>
        {waiting.length === 0 ? (
          <p className="mt-3 rounded-lg border border-zinc-200 bg-zinc-50 px-6 py-10 text-center text-sm text-zinc-500">
            처리할 의뢰가 없습니다.
          </p>
        ) : (
          <ul className="mt-3 flex flex-col gap-3">
            {waiting.map((request) => (
              <li
                key={request.id}
                className="rounded-lg border border-zinc-200 bg-white p-5"
              >
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-base font-bold text-zinc-900">
                      {request.customerName}
                      {request.companyName !== request.customerName ? (
                        // 링크가 가리키는 고객사와 고객이 적은 회사명이 다르면
                        // 장치업체가 대신 넣었을 수 있다. 담당자가 알아야 한다.
                        <span className="ml-2 text-xs font-normal text-amber-700">
                          (적어 보낸 회사명: {request.companyName})
                        </span>
                      ) : null}
                    </p>
                    <p className="mt-1 text-sm text-zinc-700">
                      {request.productModelName} · L/N {request.lotNumber} · S/N{" "}
                      {request.serialNumber}
                    </p>
                    <p className="mt-0.5 text-xs text-zinc-500">
                      END USER {request.endUser} · {request.contactName}{" "}
                      {request.contactPhone} · {request.submittedAt} 접수
                    </p>
                  </div>

                  <div className="flex shrink-0 gap-2">
                    {canConvert ? (
                      <>
                        <Link
                          href={`/repair-cases/new?fromRequestId=${request.id}`}
                          className="rounded-lg bg-zinc-900 px-4 py-2 text-xs font-semibold text-white hover:opacity-90"
                        >
                          접수 만들기
                        </Link>
                        <button
                          type="button"
                          onClick={() => setRejecting(request)}
                          className="rounded-lg border border-red-300 px-4 py-2 text-xs text-red-700 hover:border-red-600"
                        >
                          반려
                        </button>
                      </>
                    ) : null}
                  </div>
                </div>

                {request.alarmName ? (
                  <p className="mt-3 text-sm text-zinc-700">
                    <span className="text-zinc-500">Alarm</span> {request.alarmName}
                  </p>
                ) : null}
                <p className="mt-2 whitespace-pre-wrap rounded bg-zinc-50 px-3 py-2 text-sm leading-relaxed text-zinc-700">
                  {request.symptomDescription}
                </p>

                {request.status === "CONVERTING" ? (
                  <p className="mt-2 text-xs text-amber-700">
                    누군가 지금 접수로 만들고 있습니다.
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      {done.length > 0 ? (
        <section>
          <h2 className="text-sm font-bold text-zinc-900">처리됨</h2>
          <ul className="mt-3 flex flex-col gap-2">
            {done.map((request) => (
              <li
                key={request.id}
                className="flex flex-wrap items-center gap-3 rounded border border-zinc-200 px-4 py-2 text-sm text-zinc-600"
              >
                <span className="font-semibold text-zinc-800">
                  {request.customerName}
                </span>
                <span>
                  {request.productModelName} · S/N {request.serialNumber}
                </span>
                <span
                  className={`ml-auto rounded px-2 py-0.5 text-xs ${
                    request.status === "CONVERTED"
                      ? "bg-emerald-100 text-emerald-800"
                      : "bg-zinc-200 text-zinc-700"
                  }`}
                >
                  {request.status === "CONVERTED" ? "접수됨" : "반려"}
                </span>
                {request.convertedRepairCaseId ? (
                  <Link
                    href={`/repair-cases/${request.convertedRepairCaseId}`}
                    className="text-xs text-zinc-500 underline underline-offset-2 hover:text-zinc-900"
                  >
                    접수 건 보기
                  </Link>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {rejecting ? (
        <RejectRequestDialog
          isOpen
          requestId={rejecting.id}
          customerName={rejecting.customerName}
          productModelName={rejecting.productModelName}
          onClose={() => setRejecting(null)}
          onDone={(text) => setMessage({ ok: true, text })}
        />
      ) : null}
    </div>
  );
}
