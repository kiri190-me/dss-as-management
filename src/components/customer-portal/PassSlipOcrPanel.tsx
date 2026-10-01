"use client";

import { useEffect, useRef, useState } from "react";

import type { CustomerPortalItem } from "@/lib/db/queries/customer-portal";
import {
  readManualValues,
  type CustomerPortalForm,
  type PortalFormColumn,
} from "@/lib/domain/customer-portal-forms";
import { createPassSlipReader, type PassSlipReader } from "@/lib/ocr/pass-slip-reader";

/**
 * ============================================================================
 * [통문증에서 통문번호 읽기] — 고객사 양식 표 위의 단추 하나
 * ============================================================================
 * 주성 양식 표의 「통문번호」는 지금까지 줄마다 손으로 적었다. 그 값은 수리 건
 * 파일 관리에 **「통문증」 분류로 올라간 사진**에 적혀 있다. 그 사진을 받아
 * 브라우저에서 읽어 **칸을 채워 준다.**
 *
 * ── 🔴 채우기만 한다. 저장하지 않는다 ───────────────────────────────────
 * 읽은 값을 그대로 DB 에 넣지 않는다. 칸이 채워지면 그 줄의 [저장] 단추가 저절로
 * 나타나고, **사람이 보고 누른다.** 글자 인식은 틀릴 수 있고, 틀린 값이 조용히
 * 저장되면 그 표는 고객사와 주고받는 자리에서 쓰인다.
 *
 * ── 🔴 이미 적힌 줄은 건드리지 않는다 ───────────────────────────────────
 * 사람이 적어 둔 값이 기계가 읽은 값보다 믿을 만하다. 덮어쓰면 "언제 바뀌었는지"
 * 아무도 모른 채 바뀐다. 접수 전 의뢰(REQUEST)도 건너뛴다 — 그 줄은 입력 칸
 * 자체가 없다.
 *
 * ── 🔴 색만으로 알리지 않는다 ───────────────────────────────────────────
 * 초록·노랑·회색 옆에 **반드시 글자**가 함께 간다. 색을 구별하기 어려운 사람이
 * 색만 보고는 「확인해야 하는 줄」을 가려낼 수 없다.
 * ============================================================================
 */

/**
 * 「통문번호」 칸의 키. 🔴 양식 쪽(domain/customer-portal-forms.ts)의 JUSUNG 표에
 * 적힌 그 키다. 양식에서 이 키가 사라지면 단추도 사라진다 — 그 어긋남은 아래
 * passSlipColumnOf 가 null 을 내는 것으로 **조용히** 드러나므로, 시험
 * (pass-slip-form-column.test.ts)이 두 쪽이 같은 키를 쓰는지 못 박는다.
 */
export const PASS_SLIP_COLUMN_KEY = "passNumber";

/** 이 양식의 「통문번호」 칸. 없으면 null(= 단추를 그리지 않는다). */
export function passSlipColumnOf(
  form: CustomerPortalForm
): Extract<PortalFormColumn, { kind: "MANUAL" }> | null {
  for (const column of form.columns) {
    if (column.kind === "MANUAL" && column.key === PASS_SLIP_COLUMN_KEY) return column;
  }
  return null;
}

/** 표의 한 줄을 가리키는 열쇠. 화면이 key 로 쓰는 것과 같은 꼴이다. */
export function portalRowKey(item: CustomerPortalItem): string {
  return `${item.sourceKind}:${item.sourceId}`;
}

/** 줄 하나의 읽기 결과. 색과 글자가 **언제나 함께** 간다. */
export type PassSlipRowOutcome = {
  /** ok=초록(믿을 만하다) · warn=노랑(꼭 확인) · none=회색(손으로 적어야 한다) */
  tone: "ok" | "warn" | "none";
  /** 색을 못 보는 사람에게도 같은 뜻을 전하는 글자. */
  text: string;
  /** 칸에 채워 넣을 값. 없으면 채우지 않는다. */
  value?: string;
};

const TONE_CLASS: Record<PassSlipRowOutcome["tone"], string> = {
  ok: "text-emerald-700",
  warn: "text-amber-700",
  none: "text-zinc-500",
};

/** 줄 옆에 붙는 작은 알림. 색과 글자를 함께 낸다. */
export function PassSlipRowNotice({ outcome }: { outcome: PassSlipRowOutcome }) {
  return (
    <p className={`mt-1 text-[11px] leading-tight ${TONE_CLASS[outcome.tone]}`}>{outcome.text}</p>
  );
}

type Phase =
  | { kind: "IDLE" }
  | { kind: "PREPARING" }
  | { kind: "RUNNING"; done: number; total: number }
  | { kind: "DONE"; filled: number; warned: number; missed: number }
  | { kind: "ERROR"; message: string };

/**
 * 이 줄을 읽어 볼 것인가.
 *
 * 🔴 접수 전 의뢰는 건너뛴다(입력 칸이 없다). 🔴 이미 적힌 줄도 건너뛴다.
 */
function isTargetRow(form: CustomerPortalForm, item: CustomerPortalItem): boolean {
  if (item.sourceKind !== "CASE") return false;
  const written = readManualValues(form, item.formValues)[PASS_SLIP_COLUMN_KEY] ?? "";
  return written.trim() === "";
}

export default function PassSlipOcrPanel({
  form,
  items,
  columnLabel,
  onResults,
}: {
  form: CustomerPortalForm;
  items: CustomerPortalItem[];
  columnLabel: string;
  onResults: (results: Record<string, PassSlipRowOutcome>) => void;
}) {
  const [phase, setPhase] = useState<Phase>({ kind: "IDLE" });
  const readerRef = useRef<PassSlipReader | null>(null);
  /** 돌고 있는 중인가. 두 번 누르기를 막는다(단추 비활성만으로는 샌다). */
  const runningRef = useRef(false);

  // 화면을 떠나면 워커 둘을 정리한다. 안 끄면 탭이 살아 있는 동안 남는다.
  useEffect(() => {
    return () => {
      readerRef.current?.dispose();
      readerRef.current = null;
    };
  }, []);

  const targets = items.filter((item) => isTargetRow(form, item));
  const withPhoto = targets.filter((item) => item.passSlipAttachmentIds.length > 0);

  async function run() {
    if (runningRef.current) return;
    runningRef.current = true;

    const results: Record<string, PassSlipRowOutcome> = {};
    // 사진이 아예 없는 줄은 읽어 볼 것이 없다 — 먼저 회색으로 알려 둔다.
    for (const item of targets) {
      if (item.passSlipAttachmentIds.length === 0) {
        results[portalRowKey(item)] = {
          tone: "none",
          text: "통문증 사진이 없습니다 — 손으로 적어 주세요.",
        };
      }
    }
    onResults({ ...results });

    if (withPhoto.length === 0) {
      setPhase({ kind: "DONE", filled: 0, warned: 0, missed: targets.length });
      runningRef.current = false;
      return;
    }

    setPhase({ kind: "PREPARING" });
    const reader = readerRef.current ?? createPassSlipReader();
    readerRef.current = reader;

    try {
      await reader.prepare();
    } catch (error) {
      setPhase({
        kind: "ERROR",
        message: error instanceof Error ? error.message : String(error),
      });
      runningRef.current = false;
      return;
    }

    let filled = 0;
    let warned = 0;
    let missed = targets.length - withPhoto.length;

    for (let index = 0; index < withPhoto.length; index += 1) {
      const item = withPhoto[index];
      setPhase({ kind: "RUNNING", done: index, total: withPhoto.length });
      // 🔴 가장 나중에 올린 통문증 한 장만 읽는다. 여러 장을 돌리면 한 줄에
      //    몇 초가 더 들고, 어느 사진의 값인지도 흐려진다.
      const outcome = await reader.read(item.passSlipAttachmentIds[0]);
      if (outcome.status === "VERIFIED") {
        filled += 1;
        results[portalRowKey(item)] = {
          tone: "ok",
          text: `읽었습니다 · 통문작성일과 날짜가 맞습니다 (${outcome.passNumber})`,
          value: outcome.passNumber,
        };
      } else if (outcome.status === "UNVERIFIED") {
        warned += 1;
        results[portalRowKey(item)] = {
          tone: "warn",
          text:
            `읽었지만 통문작성일과 날짜가 맞지 않습니다 — 꼭 확인하세요 (${outcome.passNumber}` +
            `${outcome.writtenDates.length > 0 ? ` · 작성일 ${outcome.writtenDates.join(", ")}` : ""})`,
          value: outcome.passNumber,
        };
      } else {
        missed += 1;
        results[portalRowKey(item)] = { tone: "none", text: `${outcome.message}` };
      }
      onResults({ ...results });
    }

    setPhase({ kind: "DONE", filled, warned, missed });
    runningRef.current = false;
  }

  const busy = phase.kind === "PREPARING" || phase.kind === "RUNNING";

  return (
    <section className="rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-3">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={busy || targets.length === 0}
          onClick={() => {
            void run();
          }}
          className="rounded-lg border border-zinc-300 bg-white px-4 py-2 text-xs font-semibold text-zinc-800 hover:border-zinc-900 disabled:opacity-50"
        >
          통문증에서 {columnLabel} 읽기
        </button>
        <p className="text-xs text-zinc-600">
          {targets.length === 0 ? (
            <>모든 줄에 {columnLabel}가 이미 적혀 있습니다.</>
          ) : (
            <>
              빈 줄 <strong className="text-zinc-900">{targets.length}개</strong> 가운데 통문증
              사진이 있는 <strong className="text-zinc-900">{withPhoto.length}개</strong>를
              읽습니다. 이미 적힌 줄은 건드리지 않고, <strong className="text-zinc-900">
                저장은 사람이
              </strong>{" "}
              줄마다 [저장]을 눌러서 합니다.
            </>
          )}
        </p>
      </div>

      {/* 어디까지 왔는지 · 어떻게 끝났는지. 읽어 주는 기기에도 전해지도록 alive 로 둔다. */}
      <p role="status" aria-live="polite" className="mt-2 text-xs text-zinc-700">
        {phase.kind === "PREPARING" ? (
          <>글자 인식기를 준비하는 중입니다 — 이 PC 에서 처음 쓸 때만 몇 초 걸립니다.</>
        ) : phase.kind === "RUNNING" ? (
          <>
            {phase.total}장 중 {phase.done + 1}장째 읽는 중입니다.
          </>
        ) : phase.kind === "DONE" ? (
          <>
            끝났습니다 — 채움 {phase.filled}줄 · 확인 필요 {phase.warned}줄 · 못 읽음{" "}
            {phase.missed}줄. 채워진 줄의 [저장]을 눌러 주세요.
          </>
        ) : phase.kind === "ERROR" ? (
          <span className="text-red-700">읽지 못했습니다 — {phase.message}</span>
        ) : (
          <>
            사진은 이 PC 안에서만 읽습니다 — 밖으로 나가지 않습니다. 날짜가 맞지 않는 줄은
            노란 글자로 따로 알려 드립니다.
          </>
        )}
      </p>
    </section>
  );
}
