"use client";

import { useEffect, useRef, useState } from "react";

import NoticePopup from "@/components/common/NoticePopup";
import {
  planNameplateFill,
  summarizeNameplateFill,
  type NameplateFields,
} from "@/lib/qr/nameplate-code";
import {
  createZxingNameplateDecoder,
  readNameplateFromFile,
  type NameplateDecoder,
} from "@/lib/qr/nameplate-scan";

/**
 * ============================================================================
 * 명판 사진을 골라 **`Model` · `L/N` · `S/N` 세 칸을 채운다**
 * ============================================================================
 * 교산 장비 명판의 QR 은 `TYPE,L/N,S/N` 을 쉼표로 이은 글이라 접수폼의 필수
 * 칸 셋과 1:1 로 맞는다. 사람이 세 줄을 눈으로 옮겨 적는 일을 없앤다.
 *
 * ── 🔴 이 단추가 **하지 않는** 일 ──────────────────────────────────────
 *  · **사진을 저장하지 않는다.** 메모리에서만 읽고 버린다 — 첨부로 올리지도
 *    않는다. 접수 전 단계라 올릴 자리도 아직 없다.
 *  · **접수를 제출하지 않는다.** 칸을 채우기만 한다. 제출은 사람이 누른다.
 *  · **이미 적힌 칸을 덮지 않는다** — 칸마다 따로 본다(`planNameplateFill`).
 *  · **새 모델을 만들지 않는다.** 모델명이 등록된 목록에 없으면 칸만 채우고,
 *    기존 「새 모델로 등록」 안내가 그대로 뜨게 둔다.
 *
 * ── 알림 ───────────────────────────────────────────────────────────────
 * 성공은 **한 줄**로만 말한다(팝업을 띄우지 않는다 — 칸이 채워지는 것이 이미
 * 보인다). 🔴 실패는 `NoticePopup` 이다. `showSavePopup` 으로 바꿔 끼우면
 * 아무 오류 없이 0.5초 만에 사라져 사람이 글을 못 읽는다.
 *
 * ── 왜 「흐릿합니다」인가 ─────────────────────────────────────────────
 * 실측에서 못 읽은 여덟 장은 둘로 나뉜다 — 2013년 구 양식(QR 이 인쇄돼 있지
 * 않다)과, QR 은 있으나 사진이 작아 안 풀리는 것(읽힌 것 중 가장 작은 QR 이
 * 65px 이었다). 화면이 그 둘을 가릴 방법은 없고, 사람이 할 수 있는 일은 둘 다
 * 「가까이서 다시 찍기」뿐이라 한 문장으로 말한다.
 * ============================================================================
 */

/** 못 읽었을 때 띄우는 글. 지시서에 적힌 문장 그대로다. */
const BLURRY_MESSAGE = "사진이 흐릿합니다. 다시 찍어주세요.";

type Phase =
  | { kind: "IDLE" }
  | { kind: "READING" }
  | { kind: "DONE"; line: string }
  | { kind: "NOTICE"; title: string; lines: string[] };

export default function NameplateQrPicker({
  fields,
  onFill,
  disabled = false,
}: {
  /** 지금 칸에 적혀 있는 값. 비어 있는 칸만 채우기 위해 본다. */
  fields: NameplateFields;
  /** 채울 칸만 담은 조각. 비어 있으면 부르지 않는다. */
  onFill: (patch: Partial<NameplateFields>) => void;
  disabled?: boolean;
}) {
  const [phase, setPhase] = useState<Phase>({ kind: "IDLE" });
  const inputRef = useRef<HTMLInputElement>(null);
  /** 해독기는 한 번만 만든다 — 꾸러미를 다시 내려받지 않게. */
  const decoderRef = useRef<Promise<NameplateDecoder> | null>(null);
  /** 두 번 누르기 방어. 상태가 그려지기 전에 들어온 클릭도 여기서 막힌다. */
  const busyRef = useRef(false);

  /**
   * 🔴 **읽기가 끝난 그 순간의 칸 값**을 본다.
   *
   * 사진을 읽는 데 길면 4초가 걸린다. 그 사이에 사람이 L/N 을 손으로 치고
   * 있을 수 있는데, 단추를 누를 때 받아 둔 값으로 판단하면 **방금 적은 것을
   * 덮는다** — 「이미 적힌 칸은 건드리지 않는다」가 바로 그 자리에서 깨진다.
   */
  const latestRef = useRef({ fields, onFill });
  useEffect(() => {
    latestRef.current = { fields, onFill };
  });

  async function handlePicked(file: File | undefined) {
    // 같은 사진을 다시 고를 수 있게 비워 둔다(값이 같으면 change 가 안 온다).
    if (inputRef.current) inputRef.current.value = "";
    if (!file || busyRef.current) return;

    busyRef.current = true;
    setPhase({ kind: "READING" });
    try {
      decoderRef.current ??= createZxingNameplateDecoder();
      const decode = await decoderRef.current;
      const outcome = await readNameplateFromFile(file, decode);

      if (outcome.status === "READ") {
        const now = latestRef.current;
        const patch = planNameplateFill(outcome.code, now.fields);
        if (Object.keys(patch).length > 0) now.onFill(patch);
        setPhase({ kind: "DONE", line: summarizeNameplateFill(patch) });
        return;
      }
      if (outcome.status === "UNREAD") {
        setPhase({
          kind: "NOTICE",
          title: "QR 을 읽지 못했습니다",
          lines: [BLURRY_MESSAGE, "명판의 QR 이 사진에 크게 담기도록 가까이서 찍어주세요."],
        });
        return;
      }
      setPhase({
        kind: "NOTICE",
        title: "사진을 열지 못했습니다",
        lines: ["사진 파일을 여는 중 문제가 생겼습니다.", outcome.message],
      });
    } catch (error) {
      // 해독기를 못 불러온 경우(네트워크 등). 다음 시도가 다시 받을 수 있게 비운다.
      decoderRef.current = null;
      setPhase({
        kind: "NOTICE",
        title: "QR 읽기를 준비하지 못했습니다",
        lines: [
          "잠시 후 다시 시도해 주세요.",
          error instanceof Error ? error.message : String(error),
        ],
      });
    } finally {
      busyRef.current = false;
    }
  }

  const reading = phase.kind === "READING";

  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
      <input
        ref={inputRef}
        id="nameplateQrPhoto"
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => void handlePicked(e.target.files?.[0])}
      />
      <button
        type="button"
        disabled={disabled || reading}
        onClick={() => inputRef.current?.click()}
        className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-800 hover:border-zinc-900 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:border-zinc-300"
      >
        {reading ? "QR 읽는 중…" : "명판 사진에서 QR 읽기"}
      </button>
      <p aria-live="polite" className="text-xs text-zinc-500 dark:text-zinc-400">
        {reading
          ? "사진을 읽고 있습니다. 잠시만 기다려 주세요."
          : phase.kind === "DONE"
            ? phase.line
            : "명판 사진을 고르면 Model · L/N · S/N 의 빈칸을 채웁니다. 사진은 저장되지 않습니다."}
      </p>
      {phase.kind === "NOTICE" && (
        <NoticePopup
          title={phase.title}
          lines={phase.lines}
          onClose={() => setPhase({ kind: "IDLE" })}
        />
      )}
    </div>
  );
}
