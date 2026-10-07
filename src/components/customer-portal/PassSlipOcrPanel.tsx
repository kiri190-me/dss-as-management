"use client";

import { useEffect, useRef, useState } from "react";

import type { CustomerPortalItem } from "@/lib/db/queries/customer-portal";
import {
  readManualValues,
  type CustomerPortalForm,
  type PortalFormColumn,
} from "@/lib/domain/customer-portal-forms";
import NoticePopup from "@/components/common/NoticePopup";
import { toKnownQCodeSet } from "@/lib/ocr/pass-slip-goods";
import { createPassSlipReader, type PassSlipReader } from "@/lib/ocr/pass-slip-reader";
import {
  buildPassSlipRow,
  passSlipMismatchMessage,
  type PassSlipFieldOutcome,
  type PassSlipMismatchRow,
  type PassSlipRowCounts,
  type PassSlipRowOutcome,
} from "./pass-slip-suggestions";

// 칸 결과의 모양과 「무엇을 칸에 쓸 것인가」는 pass-slip-suggestions.ts 가 갖는다 —
// 거기 있으면 갈래마다 시험으로 못 박을 수 있다.
export type { PassSlipFieldOutcome, PassSlipRowOutcome };

/**
 * ============================================================================
 * [통문증에서 읽기] — 고객사 양식 표 위의 단추 하나
 * ============================================================================
 * 주성 양식 표의 「통문번호」· 「PRV No.」· 「Q코드」는 지금까지 줄마다 손으로
 * 적었다. 그 값들은 수리 건 파일 관리에 **「통문증」 분류로 올라간 사진**에 적혀
 * 있다. 그 사진을 받아 브라우저에서 읽어 **칸을 채워 준다.**
 *
 * 🔴 **「Q4.Level」은 읽지 않는다.** 통문증에 아예 없는 값이라 자동으로 알 길이
 * 없다 — 손 입력 그대로 둔다.
 *
 * ── 🔴 채우기만 한다. 저장하지 않는다 ───────────────────────────────────
 * 읽은 값을 그대로 DB 에 넣지 않는다. 칸이 채워지면 그 줄이 화면 아래 저장 줄의
 * 「고친 줄」 수에 들어가고, **사람이 보고 [저장]을 누른다**(2026-10-07 전에는 그
 * 줄의 [저장] 단추가 저절로 나타났다 — 단추가 화면에 하나로 합쳐졌다). 글자
 * 인식은 틀릴 수 있고, 틀린 값이 조용히 저장되면 그 표는 고객사와 주고받는
 * 자리에서 쓰인다.
 *
 * ── 🔴 빈 칸만 채운다. **칸마다 따로** 판단한다 ─────────────────────────
 * 사람이 적어 둔 값이 기계가 읽은 값보다 믿을 만하다. 통문번호는 적혀 있고 PRV 는
 * 비었으면 **PRV 만** 읽어 채운다 — 줄 단위로 건너뛰면 한 칸 때문에 나머지 두 칸을
 * 손으로 적게 된다. 접수 전 의뢰(REQUEST)는 줄째 건너뛴다(입력 칸 자체가 없다).
 *
 * ── 🔴 「서류에 없음」과 「못 읽음」을 **다르게** 보인다 ─────────────────
 * 구미 통문증에는 PRV No. 가 아예 없는 건이 있다. 그 둘을 똑같이 빈칸으로 두면
 * 사람은 모든 빈칸마다 원본을 열어 봐야 하고, 그러면 이 기능이 아낀 시간이 그대로
 * 사라진다. 「없음」은 **채우지 않아도 되는 칸**이라는 뜻이다.
 *
 * ── 🔴 **서류의 S/N 이 이 건과 다르면 한 칸도 쓰지 않는다** ─────────────
 * 항번이 하나뿐인 통문증은 S/N 짝을 따지지 않고 읽는다(그것이 측정에서 14/14 를
 * 낸 규칙이다). 그래서 통문증을 **엉뚱한 건에 올리면** 남의 PRV No. · Q코드가
 * 아무 말 없이 들어갈 수 있다. 그런 줄은 **값을 불러오지 않고**, 읽기가 **다 끝난
 * 뒤 한 번** 팝업으로 어느 줄이 왜 그런지 알린다(사용자 결정 2026-10-01).
 * 「못 읽음(UNREAD)」은 다르다 — 그때는 채우고 노란 글로 짚어만 둔다.
 *
 * ── 🔴 색만으로 알리지 않는다 ───────────────────────────────────────────
 * 초록·노랑·파랑·회색 옆에 **반드시 글자**가 함께 간다. 칸 밑에 붙는 글은 짧게
 * 두고(열이 열셋인 표다), 까닭은 그 글에 마우스를 올리면 보이는 풀이로 미룬다.
 * ============================================================================
 */

/**
 * 「통문번호」 칸의 키. 🔴 양식 쪽(domain/customer-portal-forms.ts)의 JUSUNG 표에
 * 적힌 그 키다. 양식에서 이 키가 사라지면 그 칸은 읽기 대상에서 조용히 빠진다 —
 * 그 어긋남은 아무 오류도 내지 않으므로, 시험(pass-slip-portal-wiring.test.ts)이
 * 두 쪽이 같은 키를 쓰는지 못 박는다.
 */
export const PASS_SLIP_COLUMN_KEY = "passNumber";
/** 「PRV No.」 칸의 키. */
export const PASS_SLIP_PRV_COLUMN_KEY = "prvNumber";
/** 「Q코드」 칸의 키. */
export const PASS_SLIP_Q_COLUMN_KEY = "qCode";

/**
 * 통문증에서 읽어 채울 수 있는 칸들. 🔴 **「Q4.Level」(`qLevel`)은 여기 없다.**
 */
export const PASS_SLIP_COLUMN_KEYS = [
  PASS_SLIP_COLUMN_KEY,
  PASS_SLIP_PRV_COLUMN_KEY,
  PASS_SLIP_Q_COLUMN_KEY,
] as const;

type ManualColumn = Extract<PortalFormColumn, { kind: "MANUAL" }>;

/**
 * 이 양식에서 읽어 채울 수 있는 칸들 — **표의 열 차례 그대로.**
 * 하나도 없으면 빈 배열이고, 그때는 단추를 그리지 않는다.
 */
export function passSlipColumnsOf(form: CustomerPortalForm): ManualColumn[] {
  const keys: readonly string[] = PASS_SLIP_COLUMN_KEYS;
  return form.columns.filter(
    (column): column is ManualColumn => column.kind === "MANUAL" && keys.includes(column.key)
  );
}

/** 표의 한 줄을 가리키는 열쇠. 화면이 key 로 쓰는 것과 같은 꼴이다. */
export function portalRowKey(item: CustomerPortalItem): string {
  return `${item.sourceKind}:${item.sourceId}`;
}

/**
 * 이 줄에서 **읽어 볼 칸들**. 🔴 이미 적힌 칸은 빠진다 · 접수 전 의뢰는 빈 배열.
 */
export function passSlipTargetKeys(
  form: CustomerPortalForm,
  item: CustomerPortalItem
): string[] {
  if (item.sourceKind !== "CASE") return [];
  const written = readManualValues(form, item.formValues);
  return passSlipColumnsOf(form)
    .filter((column) => (written[column.key] ?? "").trim() === "")
    .map((column) => column.key);
}

const TONE_CLASS: Record<PassSlipFieldOutcome["tone"], string> = {
  ok: "text-emerald-700",
  warn: "text-amber-700",
  absent: "text-sky-700",
  none: "text-zinc-500",
};

/**
 * 칸 밑에 붙는 작은 알림. 색과 글자를 함께 낸다.
 *
 * 🔴 폭을 묶어 두는 까닭: 열이 열셋인 표라 긴 글 한 줄이 들어오면 그 열이 통째로
 * 늘어나고, 밀린 폭을 **마지막 열([저장])이 뒤집어쓴다** — 「저장」 두 글자가
 * 세로로 쪼개져 보였다(사용자 지적 2026-10-01). 글 자체를 짧게 적고(위
 * PassSlipFieldOutcome.text 주석), 그래도 길면 여기서 접는다.
 */
export function PassSlipRowNotice({ outcome }: { outcome: PassSlipFieldOutcome }) {
  return (
    <p
      className={`mt-1 max-w-[13rem] text-[11px] leading-tight whitespace-normal ${TONE_CLASS[outcome.tone]}`}
      title={outcome.detail}
    >
      {outcome.text}
    </p>
  );
}

type Phase =
  | { kind: "IDLE" }
  | { kind: "PREPARING" }
  | { kind: "RUNNING"; done: number; total: number }
  | ({ kind: "DONE" } & PassSlipRowCounts)
  | { kind: "ERROR"; message: string };

/** 읽어 채우는 세 칸의 키 묶음. 칸을 쓰는 쪽(pass-slip-suggestions)에 넘긴다. */
const COLUMN_KEYS = {
  passNumber: PASS_SLIP_COLUMN_KEY,
  prvNumber: PASS_SLIP_PRV_COLUMN_KEY,
  qCode: PASS_SLIP_Q_COLUMN_KEY,
};

export default function PassSlipOcrPanel({
  form,
  items,
  onResults,
}: {
  form: CustomerPortalForm;
  items: CustomerPortalItem[];
  onResults: (results: Record<string, PassSlipRowOutcome>) => void;
}) {
  const [phase, setPhase] = useState<Phase>({ kind: "IDLE" });
  /**
   * 🔴 S/N 이 맞지 않아 **불러오지 않은** 줄들. 읽기가 다 끝난 뒤 팝업으로 한 번만
   * 알린다(사람이 닫아야 닫힌다 — NoticePopup).
   */
  const [mismatch, setMismatch] = useState<PassSlipMismatchRow[] | null>(null);
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

  const columns = passSlipColumnsOf(form);
  const columnLabels = columns.map((column) => column.label);
  /** 읽어 볼 줄들 — 세 칸 가운데 **하나라도** 빈 줄. */
  const targets = items
    .map((item) => ({ item, keys: passSlipTargetKeys(form, item) }))
    .filter((row) => row.keys.length > 0);
  const withPhoto = targets.filter((row) => row.item.passSlipAttachmentIds.length > 0);
  const emptyCells = targets.reduce((sum, row) => sum + row.keys.length, 0);

  async function run() {
    if (runningRef.current) return;
    runningRef.current = true;

    const results: Record<string, PassSlipRowOutcome> = {};
    // 사진이 아예 없는 줄은 읽어 볼 것이 없다 — 먼저 회색으로 알려 둔다.
    // 🔴 알림은 **그 줄에서 가장 왼쪽의 빈 칸 하나**에만 붙인다. 같은 말을 세 칸에
    //    되풀이하면 열이 열셋인 표가 글자로 막힌다.
    for (const row of targets) {
      if (row.item.passSlipAttachmentIds.length === 0) {
        results[portalRowKey(row.item)] = {
          [row.keys[0]]: { tone: "none", text: "통문증 사진이 없습니다" },
        };
      }
    }
    onResults({ ...results });
    setMismatch(null);

    if (withPhoto.length === 0) {
      setPhase({
        kind: "DONE",
        filled: 0,
        warned: 0,
        absent: 0,
        missed: emptyCells,
        skipped: 0,
      });
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

    // 🔴 그 고객사에 **이미 저장된** Q코드들. 비어 있어도 기능은 그대로 선다 —
    //    아는 값이면 초록, 처음 보는 값이면 노랑일 뿐이다(채우기는 한다).
    const knownQCodes = toKnownQCodeSet(items.flatMap((item) => item.knownQCodes));

    let filled = 0;
    let warned = 0;
    let absent = 0;
    let skipped = 0;
    // 사진이 없어 못 읽는 칸을 먼저 센다.
    let missed = emptyCells - withPhoto.reduce((sum, row) => sum + row.keys.length, 0);
    /** 🔴 S/N 이 맞지 않아 아무것도 불러오지 않은 줄들. 끝나고 한 번에 알린다. */
    const mismatchRows: PassSlipMismatchRow[] = [];

    for (let index = 0; index < withPhoto.length; index += 1) {
      const { item, keys } = withPhoto[index];
      setPhase({ kind: "RUNNING", done: index, total: withPhoto.length });
      // 🔴 가장 나중에 올린 통문증 한 장만 읽는다. 여러 장을 돌리면 한 줄에
      //    몇 초가 더 들고, 어느 사진의 값인지도 흐려진다.
      const outcome = await reader.read({
        attachmentId: item.passSlipAttachmentIds[0],
        // 🔴 PRV 가 **어느 항번 줄의 것인가**를 이 S/N 으로 가른다.
        serialNumber: item.serialNumber,
        knownQCodes,
        wanted: {
          passNumber: keys.includes(PASS_SLIP_COLUMN_KEY),
          prvNumber: keys.includes(PASS_SLIP_PRV_COLUMN_KEY),
          qCode: keys.includes(PASS_SLIP_Q_COLUMN_KEY),
        },
      });

      const built = buildPassSlipRow({ outcome, keys: COLUMN_KEYS, targetKeys: keys });
      filled += built.counts.filled;
      warned += built.counts.warned;
      absent += built.counts.absent;
      missed += built.counts.missed;
      skipped += built.counts.skipped;
      if (built.mismatch) {
        // 🔴 읽기가 **다 끝난 뒤** 한 번에 보여 준다. 줄마다 띄우면 여러 번 닫아야 한다.
        mismatchRows.push({
          rowNumber: items.indexOf(item) + 1,
          intakeNumber: item.intakeNumber,
          caseSerial: item.serialNumber,
          documentSerial: built.mismatch.documentSerial,
        });
      }

      results[portalRowKey(item)] = built.outcome;
      onResults({ ...results });
    }

    setPhase({ kind: "DONE", filled, warned, absent, missed, skipped });
    if (mismatchRows.length > 0) setMismatch(mismatchRows);
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
          통문증에서 {columnLabels.join(" · ")} 읽기
        </button>
        <p className="text-xs text-zinc-600">
          {targets.length === 0 ? (
            <>모든 줄에 {columnLabels.join(" · ")}가 이미 적혀 있습니다.</>
          ) : (
            <>
              빈 칸 <strong className="text-zinc-900">{emptyCells}개</strong>가 있는{" "}
              <strong className="text-zinc-900">{targets.length}줄</strong> 가운데 통문증 사진이
              있는 <strong className="text-zinc-900">{withPhoto.length}줄</strong>을 읽습니다
              (한 줄에 2초쯤). 이미 적힌 칸은 건드리지 않고,{" "}
              <strong className="text-zinc-900">저장은 사람이</strong> 화면 아래 [저장]을 눌러서
              합니다.
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
            끝났습니다 — 채움 {phase.filled}칸 · 확인 필요 {phase.warned}칸 · 서류에 없음{" "}
            {phase.absent}칸 · 못 읽음 {phase.missed}칸. 화면 아래 [저장]을 눌러 주세요.{" "}
            <span className="text-sky-700">「서류에 없음」은 빈칸으로 두시면 됩니다.</span>
            {/* 🔴 불러오지 않은 줄은 여기서도 한 번 더 말한다 — 팝업을 닫고 나면
                무엇이 어떻게 됐는지 남는 글이 이것뿐이다. */}
            {phase.skipped > 0 ? (
              <span className="text-amber-700">
                {" "}
                🔴 통문증의 S/N 이 맞지 않아 {phase.skipped}칸은 불러오지 않았습니다.
              </span>
            ) : null}
          </>
        ) : phase.kind === "ERROR" ? (
          <span className="text-red-700">읽지 못했습니다 — {phase.message}</span>
        ) : (
          <>
            사진은 이 PC 안에서만 읽습니다 — 밖으로 나가지 않습니다. 칸마다 결과를 색과 글자로
            함께 알려 드립니다. 「Q4.Level」은 통문증에 없는 값이라 읽지 않습니다.
          </>
        )}
      </p>

      {/* 🔴 읽기가 **다 끝난 뒤 한 번만.** 사람이 닫아야 닫힌다(저장 팝업은 0.5초 뒤
          저절로 닫혀 이런 경고에 쓸 수 없다). 여러 줄이면 한 팝업에 모여 나온다. */}
      {mismatch && mismatch.length > 0 ? (
        <NoticePopup
          title={passSlipMismatchMessage(mismatch).title}
          lines={passSlipMismatchMessage(mismatch).lines}
          onClose={() => setMismatch(null)}
        />
      ) : null}
    </section>
  );
}
