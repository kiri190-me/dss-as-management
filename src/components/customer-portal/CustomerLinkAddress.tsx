"use client";

import { useEffect, useState } from "react";
import { revealCustomerLinkUrlAction } from "@/lib/server/actions/customer-portal";

/**
 * ============================================================================
 * 고른 고객사의 **지금 살아 있는 전용 주소** — 보여 주고 복사한다
 * ============================================================================
 *
 * ■ 고객사를 고른 뒤에 따로 불러온다
 *
 * 링크 목록에 주소를 실어 두면 화면을 연 것만으로 **모든 고객사의 주소가
 * HTML 에 실려** 브라우저까지 내려간다. 한 번에 한 곳만, 고른 순간에
 * 가져온다.
 *
 * ■ 복사가 두 갈래인 이유 — NAS 는 https 가 아니다
 *
 * `navigator.clipboard` 는 보안 컨텍스트(https 또는 localhost)에서만 있다.
 * 이 시스템은 사내 NAS 에 http 로 올라가므로 **거기서는 그 API 자체가
 * 없다.** 그래서 옛 방식(execCommand)을 둘째 갈래로 두고, 둘 다 실패하면
 * "직접 긁어서 복사하세요"까지 말한다 — 주소는 어차피 화면에 그대로 보인다.
 * ============================================================================
 */

type RevealResult = Awaited<ReturnType<typeof revealCustomerLinkUrlAction>>;

/** 두 갈래로 복사한다. 성공하면 true. */
async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // https 가 아니거나 권한이 막힌 경우 — 아래 옛 방식으로 넘어간다.
  }

  try {
    const area = document.createElement("textarea");
    area.value = text;
    // 화면 밖에 두되 focus 가 가야 하므로 display:none 은 쓸 수 없다.
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}

export default function CustomerLinkAddress({
  linkId,
  customerName,
}: {
  linkId: string;
  customerName: string;
}) {
  /**
   * 어느 링크의 답인지 함께 담는다 — 고객사를 바꾸면 새 답이 오기 전까지
   * 이전 고객사의 주소가 남는데, 주소를 잘못 전달하는 사고가 정확히 그
   * 순간에 난다.
   */
  const [answer, setAnswer] = useState<{ linkId: string; result: RevealResult } | null>(null);
  /**
   * 복사 안내도 어느 링크의 것인지 함께 담는다 — 고객사를 바꿨는데
   * "복사했습니다"가 남아 있으면 방금 것을 복사한 줄 안다.
   */
  const [copy, setCopy] = useState<{ linkId: string; state: "copied" | "failed" } | null>(
    null
  );

  useEffect(() => {
    let cancelled = false;
    void revealCustomerLinkUrlAction({ linkId }).then((result) => {
      if (!cancelled) setAnswer({ linkId, result });
    });
    return () => {
      cancelled = true;
    };
  }, [linkId]);

  const result = answer && answer.linkId === linkId ? answer.result : null;
  const copyState = copy && copy.linkId === linkId ? copy.state : "idle";

  if (!result) {
    return (
      <p className="rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-500">
        전용 주소를 불러오는 중입니다…
      </p>
    );
  }

  if (!result.ok) {
    // 권한이 없으면 아무것도 그리지 않는다 — 볼 수 없는 것을 자리만 차지하게
    // 두면 "고장난 화면"으로 읽힌다.
    if (result.reason === "FORBIDDEN") return null;

    return (
      <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3">
        <p className="text-sm font-semibold text-amber-900">
          {customerName} 의 전용 주소를 표시할 수 없습니다
        </p>
        <p className="mt-1 text-xs text-amber-800">{result.message}</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-zinc-300 bg-white px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold text-zinc-700">
          {customerName} 전용 주소 (지금 접속 가능)
        </span>
        <div className="ml-auto flex gap-2">
          <button
            type="button"
            onClick={async () => {
              const ok = await copyText(result.url);
              setCopy({ linkId, state: ok ? "copied" : "failed" });
            }}
            className="rounded-lg bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90"
          >
            {copyState === "copied" ? "복사했습니다" : "주소 복사"}
          </button>
          {/* 고객이 보는 화면을 그대로 열어 본다. noreferrer 로 이쪽 주소가
              공개 사이트에 넘어가지 않게 한다. */}
          <a
            href={result.url}
            target="_blank"
            rel="noreferrer"
            className="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs text-zinc-700 hover:border-zinc-900"
          >
            새 창에서 열기
          </a>
        </div>
      </div>
      {/* 복사가 막힌 환경에서도 긁어서 가져갈 수 있게 통째로 보여 준다. */}
      <p className="mt-2 rounded border border-zinc-200 bg-zinc-50 px-3 py-2 font-mono text-xs break-all text-zinc-800 select-all">
        {result.url}
      </p>
      {copyState === "failed" ? (
        <p className="mt-2 text-xs text-red-600">
          이 브라우저에서는 자동 복사가 막혀 있습니다. 위 주소를 직접 긁어서
          복사해 주세요.
        </p>
      ) : (
        <p className="mt-2 text-xs text-zinc-500">
          이 주소를 아는 사람은 {customerName} 의 A/S 현황을 전부 볼 수
          있습니다. 전달 대상을 확인하세요.
        </p>
      )}
    </div>
  );
}
