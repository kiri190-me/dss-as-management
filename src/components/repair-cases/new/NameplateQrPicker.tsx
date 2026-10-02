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

import type { RegisteredProduct } from "@/lib/ocr/nameplate-text";

import NameplateRegionPicker from "./NameplateRegionPicker";

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
 * ── 🔴 QR 이 안 읽히면 **곧바로 네모 치기 창을 연다** ──────────────────
 * 전에는 ①「사진이 흐릿합니다」 팝업 → ②닫기 → ③「글자로 읽어 보기」 누르기,
 * 세 번을 거쳤다. 사용자가 그것을 **「너무 번거롭다」**고 했다(2026-10-02).
 *
 * 멈춰 세울 까닭이 없었다 — **QR 이 안 읽히면 할 일은 하나뿐**이다. 2013년
 * 구 양식 장비가 실제로 많이 들어오는데 그 명판에는 QR 이 **아예 없어** 다시
 * 찍어도 영영 안 읽힌다. 고를 것이 없는 자리에서 팝업을 띄우는 것은 손만
 * 더 가게 한다. 그래서 그 자리에서 `NameplateRegionPicker` 를 바로 띄우고,
 * **왜 열렸는지는 창 머리에 한 줄로** 적는다.
 *
 * 🔴 **QR 로 읽은 값과 글자로 읽은 값을 화면에서 가른다.** QR 은 회색 한 줄,
 * 글자는 **노랑 바탕 + 「확인 필요」**다. QR 에는 오류 검출 부호가 있어 읽혔으면
 * 맞지만 글자 인식에는 그런 장치가 없다 — 둘이 같은 모양으로 보이면 사람이
 * 어느 쪽을 검산해야 하는지 알 수 없다.
 * ============================================================================
 */

type Phase =
  | { kind: "IDLE" }
  | { kind: "READING" }
  | { kind: "DONE"; line: string }
  | { kind: "NOTICE"; title: string; lines: string[] }
  /** 글자로 읽어 채운 뒤. 🔴 QR 성공(`DONE`)과 **다르게** 보여야 한다. */
  | { kind: "TEXT"; line: string };

export default function NameplateQrPicker({
  fields,
  models,
  lookupBySerial,
  onFill,
  disabled = false,
}: {
  /** 지금 칸에 적혀 있는 값. 비어 있는 칸만 채우기 위해 본다. */
  fields: NameplateFields;
  /**
   * 등록된 Model 이름들. 글자로 읽을 때 **대조에만** 쓴다 — 글자 인식이 틀리게
   * 읽은 모델명을 등록된 이름으로 바로잡기 위한 것이고, 새 모델을 만들지 않는다.
   */
  models: readonly string[];
  /** S/N 으로 등록된 장비를 찾아 주는 길. 그대로 아래로 넘긴다. */
  lookupBySerial?: (serial: string) => Promise<RegisteredProduct[]>;
  /** 채울 칸만 담은 조각. 비어 있으면 부르지 않는다. */
  onFill: (patch: Partial<NameplateFields>) => void;
  disabled?: boolean;
}) {
  const [phase, setPhase] = useState<Phase>({ kind: "IDLE" });
  /** QR 이 실패한 사진. 🔴 저장하지 않는다 — 글자로 다시 읽기 위해 메모리에만 둔다. */
  const [fallbackFile, setFallbackFile] = useState<File | null>(null);
  const [regionOpen, setRegionOpen] = useState(false);
  /**
   * 🔴 **QR 이 채운 칸들.** 글자 인식이 다시 읽어도 이 칸은 덮지 않는다 —
   * QR 에는 오류 정정 부호가 있어 읽혔으면 맞고, 글자 인식에는 그런 장치가
   * 없다. 확실한 것을 불확실한 것으로 덮는 것은 어느 쪽으로도 득이 없다.
   */
  const [filledByQr, setFilledByQr] = useState<(keyof NameplateFields)[]>([]);
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
        setFilledByQr(Object.keys(patch) as (keyof NameplateFields)[]);
        setFallbackFile(null);
        setPhase({ kind: "DONE", line: summarizeNameplateFill(patch) });
        return;
      }
      if (outcome.status === "UNREAD") {
        /*
         * 🔴 **팝업을 띄우지 않고 곧바로 네모 치기 창을 연다**(2026-10-02
         * 사용자 요청: 「너무 번거롭다」).
         *
         * 전에는 ①실패 팝업 → ②닫기 → ③「글자로 읽어 보기」 누르기, 세 번을
         * 거쳐야 했다. 그런데 **QR 이 안 읽히면 할 일은 하나뿐**이다 — 표에
         * 네모를 치는 것. 고를 것이 없는 자리에서 멈춰 세울 까닭이 없다.
         * 왜 창이 열렸는지는 창 머리에 한 줄로 적는다.
         */
        setFallbackFile(file);
        setRegionOpen(true);
        setPhase({ kind: "IDLE" });
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
    <div className="mt-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
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
          {reading ? "사진 읽는 중…" : "명판 사진 읽기"}
        </button>
        {/*
          QR 이 안 읽히면 창이 **저절로** 열린다. 이 단추는 그 창을 닫은 뒤
          같은 사진으로 **다시 열고 싶을 때**만 쓴다.
        */}
        {fallbackFile && !regionOpen && !reading && (
          <button
            type="button"
            disabled={disabled}
            onClick={() => setRegionOpen(true)}
            className="rounded-md border border-amber-500 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-900 hover:border-amber-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            같은 사진으로 다시 네모 치기
          </button>
        )}
        <p aria-live="polite" className="text-xs text-zinc-500 dark:text-zinc-400">
          {reading
            ? "사진을 읽고 있습니다. 잠시만 기다려 주세요."
            : phase.kind === "DONE"
              ? phase.line
              : fallbackFile
                ? "QR 이 없는 명판이라 글자로 읽는 창이 열립니다."
                : "Model · L/N · S/N 의 빈칸을 채웁니다. 사진은 저장되지 않습니다."}
        </p>
      </div>

      {/*
        🔴 **사진을 어떻게 찍어 와야 하는지**를 고르기 전에 말한다.
        지금까지 잰 것 가운데 성적을 가장 잘 설명한 것이 **사진 속 명판의
        크기**였다 — 표본 다섯 중 넷이 메신저로 1440px 이하로 줄어든 것이고,
        유일한 원본 화질 한 장이 제일 잘 읽혔다. 흔들림은 해상도보다 더
        치명적이다(통문증 때 측정). 사진을 받고 나서 다듬는 것보다 **처음에
        제대로 받는 쪽이 훨씬 싸다.** 문장은 2026-10-02 사용자가 적어 준 그대로다.
      */}
      <p className="mt-1 text-xs font-medium text-amber-800">
        명판 표가 화면을 가득 채우게 가까이서, 흔들리지 않은 사진을 보여주세요.
      </p>

      {/* 🔴 글자로 읽어 채운 값은 QR 과 **눈에 띄게 다르게** 남긴다. */}
      {phase.kind === "TEXT" && (
        <div
          aria-live="polite"
          className="mt-2 rounded-md border border-amber-400 bg-amber-50 px-3 py-2"
        >
          <p className="text-xs font-semibold text-amber-900">{phase.line}</p>
          <p className="mt-1 text-xs leading-relaxed text-amber-800">
            글자 인식에는 QR 같은 오류 검사가 없습니다 — 채워진 값을 명판과 맞춰 보고 다르면
            고쳐 주세요.
          </p>
        </div>
      )}

      {phase.kind === "NOTICE" && (
        <NoticePopup
          title={phase.title}
          lines={phase.lines}
          onClose={() => setPhase({ kind: "IDLE" })}
        />
      )}

      {regionOpen && fallbackFile && (
        <NameplateRegionPicker
          // 다른 사진으로 바뀌면 통째로 갈아 끼운다 — 네모와 읽은 결과가 앞
          // 사진의 것으로 남아 있지 않게. (사진 주소 자체는 안쪽 effect 가
          // `file` 을 보고 다시 만들므로 이 key 가 없어도 깨지지는 않는다.)
          key={`${fallbackFile.name}:${fallbackFile.size}:${fallbackFile.lastModified}`}
          file={fallbackFile}
          models={models}
          fields={fields}
          lockedByQr={filledByQr}
          lookupBySerial={lookupBySerial}
          onFill={onFill}
          onResult={(line) => setPhase({ kind: "TEXT", line })}
          onClose={() => setRegionOpen(false)}
        />
      )}
    </div>
  );
}
