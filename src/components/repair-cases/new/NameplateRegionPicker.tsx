"use client";

import { useEffect, useRef, useState } from "react";

import {
  NAMEPLATE_OCR_PAGE_SEG_MODES,
  NAMEPLATE_OCR_VARIANTS,
  createBrowserNameplateRecognizer,
  isNameplateRegionSmall,
  nameplateRegionPixelWidth,
  cropNameplateRegionFromFile,
  readNameplateRegion,
  stage2NameplateSettings,
  type BrowserNameplateRecognizer,
  type NameplateOcrSetting,
  type NameplatePassText,
} from "@/lib/ocr/nameplate-ocr";
import {
  NAMEPLATE_TEXT_ALL_TAKEN_MESSAGE,
  NAMEPLATE_TEXT_EMPTY_MESSAGE,
  fieldsFromRegisteredProduct,
  keepEarlierReading,
  offeredByDeeperRead,
  planNameplateTextFill,
  rankRegisteredProducts,
  summarizeNameplateTextFill,
  summarizeRegisteredFill,
  type NameplateFieldKey,
  type NameplateTextCurrent,
  type NameplateTextFields,
  type NameplateTextReading,
  type RegisteredProduct,
  type RegisteredProductChoice,
} from "@/lib/ocr/nameplate-text";
import type { CropRegion } from "@/lib/ocr/pass-slip-preprocess";

/**
 * ============================================================================
 * 명판 표에 **네모를 치고 글자로 읽는다** — QR 이 없을 때의 길
 * ============================================================================
 * 2013년 구 양식 명판에는 QR 이 아예 인쇄돼 있지 않다. 그래서 QR 읽기가
 * 실패한 뒤에만 이 창이 열린다.
 *
 * ── 🔴 왜 사람이 네모를 치는가 ─────────────────────────────────────────
 * 명판 표를 자동으로 찾아내는 것은 실측에서 되지 않았고, **사진을 통째로**
 * 글자 인식에 넣으면 0/4 였다. 반대로 사람이 표만 잘라 주면 세 칸 가운데
 * 여럿이 나온다. 「어디가 표인가」는 사람 눈에는 0.5초짜리 일이다.
 *
 * ── 🔴 이 창이 **하지 않는** 일 ────────────────────────────────────────
 *  · **사진을 저장하지 않는다.** 메모리에서만 펼쳐 읽고 버린다.
 *  · **접수를 제출하지 않는다.**
 *  · **이미 적힌 칸을 덮지 않는다** — 칸마다 따로 본다.
 *  · **새 모델을 만들지 않는다.** 모델명도 기존 입력 경로를 그대로 지난다.
 *  · **비긴 모델명을 마음대로 고르지 않는다** — 후보를 보여 주고 사람이 누른다.
 *
 * ── 🔴 채운 값은 전부 「확인 필요」다 ──────────────────────────────────
 * QR 에는 오류 검출 부호가 있어 읽혔으면 맞지만, 글자 인식에는 그런 장치가
 * 없다. 꼴 검사와 등록 모델 대조로 **틀린 값이 들어가는 길**은 최대한 막아
 * 두었지만(실측 4장에서 틀린 값 0), 그래도 사람이 명판과 맞춰 봐야 한다.
 * ============================================================================
 */

/** 네모가 이보다 작으면 「잘못 눌렀다」로 본다(가로·세로 각각, 사진 대비 비율). */
const MIN_REGION = 0.02;

/* ────────────────────────────────────────────────────────────────────────── *
 * 🔴 **개발 모드 StrictMode 를 견디는 두 가지** — 2026-10-02 「사진이 안 뜬다」
 *
 * React 는 개발 모드에서 컴포넌트를 **일부러 붙였다 떼었다 다시 붙인다.**
 * effect 는 「실행 → 정리 → 다시 실행」이 되지만 **`useState` 의 초기값은 다시
 * 돌지 않는다**(React 가 상태를 재사용한다). 그래서 「만들기」와 「없애기」가
 * 서로 다른 자리에 있으면 두 번째로 붙은 뒤에 **없어진 것을 들고 있게 된다.**
 *
 * 아래 두 함수는 그 짝을 **한 덩어리로 묶어** 내놓는다. 효과 본문에서 불러
 * 돌려받은 것을 그대로 정리에 쓰면 짝이 어긋날 길이 없고, 시험이 「실행 →
 * 정리 → 다시 실행」을 손으로 돌려 못박을 수 있다.
 *
 * 🔴 `npm run build` 로 만든 운영 묶음에는 StrictMode 가 없어 이 증상이 **안
 * 난다.** 시험·타입검사·빌드가 전부 통과했는데도 눈에서만 잡힌 까닭이다.
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * 사진을 보여 줄 임시 주소를 만들고, **없애는 길까지 함께** 돌려준다.
 *
 * 🔴 `useState(() => URL.createObjectURL(file))` 로 만들지 마라. 그러면
 * StrictMode 가 떼어낼 때 정리가 그 주소를 없애고, 다시 붙을 때 초기값은 다시
 * 돌지 않아 **이미 없어진 주소로 `<img>` 를 그린다**(깨진 그림만 뜬다).
 * 「effect 안에서 상태를 바꾸면 한 번 더 그려진다」가 피할 이유가 되지 못한다 —
 * 여기서 한 번 더 그리는 값은 사진 한 장 `<img src>` 를 다시 거는 것뿐이다.
 */
export function showNameplatePhoto(
  file: Blob,
  show: (url: string | null) => void
): () => void {
  const url = URL.createObjectURL(file);
  show(url);
  return () => {
    // 🔴 없애기 **전에** 화면에서 치운다 — 그래야 죽은 주소가 그려질 틈이 없다.
    show(null);
    URL.revokeObjectURL(url);
  };
}

/** 「그만 읽어라」 깃발. `useRef` 가 들고 있는 그 상자다. */
export type NameplateCancelFlag = { current: boolean };

/**
 * 읽기 취소 깃발을 **붙을 때 내리고 떼어질 때 든다.**
 *
 * 🔴 정리에서 들기만 하고 본문에서 내리지 않으면, StrictMode 가 한 번 떼었다
 * 다시 붙인 뒤로 깃발이 **처음부터 서 있다.** 그 상태로 「이 영역으로 읽기」를
 * 누르면 첫 인식에서 바로 멈춰 `0/18` 에 영영 머문다 — 개발 모드에서만 나는
 * 증상이라 더 찾기 어렵다.
 */
export function armNameplateCancel(flag: NameplateCancelFlag): () => void {
  flag.current = false;
  return () => {
    flag.current = true;
  };
}

type Phase =
  | { kind: "DRAW" }
  | { kind: "READING"; done: number; total: number }
  /**
   * 읽기가 끝난 상태. 🔴 **읽은 것 전부를 들고 있는다** — 「사람이 골라야 하는
   * 것」(모델명 비김 · L/N 후보)이 아직 남아 있고, 하나를 고르면 그 자리만
   * 지우고 나머지는 그대로 둬야 한다.
   */
  | {
      kind: "DONE";
      line: string;
      reading: NameplateTextReading;
      /** 여기까지 돈 배율·기울기. 🔴 **상태로 들고 있어야** 그릴 때 볼 수 있다. */
      settings: NameplateOcrSetting[];
      /**
       * 🔴 2단계가 새로 찾았지만 **아직 칸에 넣지 않은** 값들. 사람이 눌러야
       * 들어간다 — 2단계에서 나온 값은 실측에서 틀린 적이 있다.
       */
      offered?: NameplateTextFields;
      /**
       * 🔴 S/N 으로 찾은 등록 장비들. **한 대뿐이어도 자동으로 채우지 않는다** —
       * S/N 은 고유키가 아니라 같은 S/N 에 다른 모델·다른 L/N 이 실제로 있다.
       */
      productChoices?: RegisteredProductChoice[];
      /** 조회에 쓴 S/N. 안내 글이 「어느 S/N 으로 찾았는지」를 말한다. */
      lookupSerial?: string;
    }
  | { kind: "FAILED"; message: string };

/** 설정 한 벌마다 도는 수 — 그림 6가지 × 쪽나눔 3가지. */
const PASSES_PER_SETTING = NAMEPLATE_OCR_VARIANTS.length * NAMEPLATE_OCR_PAGE_SEG_MODES.length;

/** 2단계가 내놓는 값의 칸 이름과 차례. */
const FIELD_LABELS_FOR_OFFER: NameplateFieldKey[] = ["modelName", "lotNumber", "serialNumber"];
const FIELD_LABEL_TEXT: Record<NameplateFieldKey, string> = {
  modelName: "Model",
  lotNumber: "L/N",
  serialNumber: "S/N",
};

export default function NameplateRegionPicker({
  file,
  models,
  fields,
  lockedByQr = [],
  lookupBySerial,
  onFill,
  onResult,
  onClose,
}: {
  /** QR 읽기에 썼던 그 사진. 다시 고르게 하지 않는다. */
  file: File;
  /** 등록된 Model 이름들. 🔴 대조에만 쓴다 — 새 모델을 만들지 않는다. */
  models: readonly string[];
  /** 지금 칸에 적혀 있는 값. 비어 있는 칸만 채우기 위해 본다. */
  fields: NameplateTextCurrent;
  /**
   * 🔴 **QR 이 채운 칸들.** 다시 읽어도 덮지 않는다 — QR 에는 오류 정정이 있어
   * 읽혔으면 맞고, 글자 인식에는 그런 장치가 없다.
   */
  lockedByQr?: readonly NameplateFieldKey[];
  /**
   * 🔴 S/N 으로 **등록된 장비**를 찾아 주는 길. 안 주면 이 기능이 꺼진다.
   *
   * 여기로 받는 까닭은 이 컴포넌트를 **DB 에서 떼어 놓기** 위해서다 — 서버
   * 액션을 직접 부르면 이 파일이 `server-only` 사슬을 끌고 들어와 화면 시험이
   * DB 없이는 못 돈다. 글자 인식기를 주입받는 것과 같은 까닭이다.
   */
  lookupBySerial?: (serial: string) => Promise<RegisteredProduct[]>;
  /** 채울 칸만 담은 조각. 비어 있으면 부르지 않는다. */
  onFill: (patch: Partial<NameplateTextCurrent>) => void;
  /** 창을 닫은 뒤에도 남길 한 줄(「확인 필요」 알림). */
  onResult: (line: string) => void;
  onClose: () => void;
}) {
  const [phase, setPhase] = useState<Phase>({ kind: "DRAW" });
  const [region, setRegion] = useState<CropRegion | null>(null);
  /**
   * 고른 사진을 화면에 보여 주기 위한 임시 주소.
   *
   * 🔴 **effect 안에서 만든다**(`showNameplatePhoto` 의 주석을 볼 것). 처음
   * 그릴 때는 아직 `null` 이라 사진 자리에 「사진을 여는 중…」만 보인다 —
   * 그 사이에 `<img src="">` 를 그리면 깨진 그림이 한 번 깜빡인다.
   */
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  /** 🔴 사진의 **원본** 가로 픽셀. 네모가 실제로 몇 픽셀인지 재는 데 쓴다. */
  const [naturalWidth, setNaturalWidth] = useState(0);

  const dialogRef = useRef<HTMLDialogElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  /** 드래그 시작점(비율). 누르고 있는 동안에만 값이 있다. */
  const dragFromRef = useRef<{ x: number; y: number } | null>(null);
  /** 글자 인식기는 한 번만 띄운다 — 언어 데이터를 다시 받지 않게. */
  const engineRef = useRef<Promise<BrowserNameplateRecognizer> | null>(null);
  /** 두 번 누르기 방어. */
  const busyRef = useRef(false);
  /**
   * 🔴 **이 창에서 몇 번째 읽기인가** — 두 번째부터 이미 적힌 칸을 덮어쓴다.
   *
   * 첫 판은 덮지 않는다(사람이 손으로 적어 둔 값을 날리면 안 된다). 「이
   * 영역으로 읽기」를 **다시** 누르는 것은 「아까 읽은 게 틀려서 다시 읽는다」는
   * 뜻이므로 그때부터는 덮는 쪽이 맞다(2026-10-02 사용자 요청).
   */
  const readCountRef = useRef(0);
  /** 🔴 앞 바퀴에서 나온 글. 2단계가 **지우지 않고 보탠다.** */
  const passesRef = useRef<NameplatePassText[]>([]);
  /**
   * 🔴 읽는 중에 창을 닫으면 **그 자리에서 손을 뗀다.**
   *
   * 열여덟 번을 다 도는 데 30초가 걸리는데, 그동안 닫기를 막아 두면 글자
   * 인식기를 못 불러왔을 때(네트워크 등) 사람이 창에 갇힌다. 돌고 있는
   * 인식은 중간에 끊을 수 없으므로, 한 번이 끝나는 자리마다 이 깃발을 보고
   * 멈춘다 — **닫은 뒤에는 칸도 채우지 않는다.**
   */
  const cancelledRef = useRef(false);

  /** 🔴 읽기가 끝난 **그 순간의** 칸 값을 본다 — 읽는 데 수십 초가 걸린다. */
  const latestRef = useRef({ fields, onFill, lockedByQr });
  useEffect(() => {
    latestRef.current = { fields, onFill, lockedByQr };
  });

  // 🔴 만들기와 없애기가 **같은 effect 한 번** 안에 있다.
  useEffect(() => showNameplatePhoto(file, setPhotoUrl), [file]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  // 창을 떠날 때 글자 인식기를 정리한다(워커가 남으면 메모리를 붙들고 있다).
  useEffect(() => {
    const disarm = armNameplateCancel(cancelledRef);
    return () => {
      disarm();
      // 🔴 함께 비운다 — 다시 붙었을 때 이미 끈 인식기를 다시 쓰지 않게.
      const dying = engineRef.current;
      engineRef.current = null;
      void dying?.then((engine) => engine.dispose()).catch(() => {});
    };
  }, []);

  function ratioAt(event: React.PointerEvent): { x: number; y: number } | null {
    const box = frameRef.current?.getBoundingClientRect();
    if (!box || box.width === 0 || box.height === 0) return null;
    const clamp = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
    return {
      x: clamp((event.clientX - box.left) / box.width),
      y: clamp((event.clientY - box.top) / box.height),
    };
  }

  function rectBetween(a: { x: number; y: number }, b: { x: number; y: number }): CropRegion {
    return {
      l: Math.min(a.x, b.x),
      t: Math.min(a.y, b.y),
      w: Math.abs(a.x - b.x),
      h: Math.abs(a.y - b.y),
    };
  }

  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (phase.kind === "READING") return;
    const from = ratioAt(event);
    if (!from) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragFromRef.current = from;
    setRegion({ l: from.x, t: from.y, w: 0, h: 0 });
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const from = dragFromRef.current;
    if (!from) return;
    const to = ratioAt(event);
    if (to) setRegion(rectBetween(from, to));
  }

  function handlePointerUp(event: React.PointerEvent<HTMLDivElement>) {
    const from = dragFromRef.current;
    if (!from) return;
    dragFromRef.current = null;
    const to = ratioAt(event);
    const made = to ? rectBetween(from, to) : null;
    // 그냥 한 번 누른 것(네모가 아니다)은 없던 일로 — 1픽셀짜리 영역을 읽지 않는다.
    setRegion(made && made.w >= MIN_REGION && made.h >= MIN_REGION ? made : null);
  }

  /**
   * 한 바퀴 읽는다.
   *
   * `deeper` 가 참이면 2단계 — 배율 셋 × 기울기 셋을 더 쓸어 본다. 🔴 **1단계
   * 결과를 지우지 않는다**: 앞서 나온 글(`passesRef`)을 그대로 넘겨 **합쳐서**
   * 판단하게 한다.
   */
  async function handleRead(deeper = false) {
    if (!region || busyRef.current) return;
    const doneSettings = phase.kind === "DONE" ? phase.settings : [];
    const settings = deeper ? stage2NameplateSettings(doneSettings) : undefined;
    if (deeper && settings && settings.length === 0) return;
    busyRef.current = true;
    const total = (settings?.length ?? 1) * PASSES_PER_SETTING;
    setPhase({ kind: "READING", done: 0, total });
    try {
      const rgba = await cropNameplateRegionFromFile(file, region);
      engineRef.current ??= createBrowserNameplateRecognizer();
      const engine = await engineRef.current;
      let done = 0;
      const outcome = await readNameplateRegion(
        rgba,
        null,
        async (png, pageSegMode) => {
          if (cancelledRef.current) throw new Error("읽기를 멈췄습니다.");
          const text = await engine.recognize(png, pageSegMode);
          done += 1;
          setPhase({ kind: "READING", done, total });
          return text;
        },
        models,
        { settings, previousPasses: deeper ? passesRef.current : [] }
      );
      if (cancelledRef.current) return;
      passesRef.current = outcome.passes;

      /*
       * 🔴 **2단계는 칸을 건드리지 않는다.**
       *
       * 1단계가 정한 값은 그대로 두고(`keepEarlierReading`), 2단계가 새로 찾은
       * 것은 **단추로만** 내놓는다(`offeredByDeeperRead`). 끝까지 돌려 재 보니
       * 바퀴를 더 돌수록 비슷한 오답이 같이 늘어 투표를 뒤집었다 — 다섯 장에서
       * 틀린 값이 0건에서 5건으로 늘었고 모델명까지 엉뚱한 것이 들어왔다.
       */
      const earlier = phase.kind === "DONE" ? phase.reading : null;
      const reading = deeper && earlier ? keepEarlierReading(earlier, outcome.reading) : outcome.reading;
      const offered =
        deeper && earlier ? offeredByDeeperRead(earlier, outcome.reading) : undefined;

      if (deeper) {
        const found = offered
          ? FIELD_LABELS_FOR_OFFER.filter((key) => offered[key] !== null)
          : [];
        setPhase({
          kind: "DONE",
          line:
            found.length > 0
              ? "더 자세히 읽어 값을 더 찾았습니다 — 🔴 사진과 대조해 고르세요."
              : "더 자세히 읽었지만 새로 찾은 값이 없습니다.",
          reading,
          settings: outcome.settings,
          offered,
        });
        return;
      }

      // 🔴 「다시 누른 것인가」로 덮어쓰기를 가른다.
      const overwrite = readCountRef.current > 0;
      readCountRef.current += 1;

      const now = latestRef.current;
      const plan = planNameplateTextFill(reading, now.fields, {
        overwrite,
        lockedByQr: now.lockedByQr,
      });
      const line = summarizeNameplateTextFill(plan, reading);
      if (Object.keys(plan.patch).length > 0) {
        now.onFill(plan.patch);
        // 🔴 채운 것이 있을 때만 바깥에 노랑 알림을 남긴다 — 아무것도 안 바뀐
        //    일로 「확인하세요」를 띄우면 사람이 없는 값을 찾아 헤맨다.
        onResult(line);
      }

      /*
       * S/N 으로 **등록된 장비를 찾아 보여 준다** — 🔴 **채우지는 않는다.**
       *
       * 세 칸 가운데 S/N 이 제일 잘 읽히니(5장 중 4장) 그 한 칸으로 `products`
       * 를 찾으면, 글자로는 못 읽던 Model·L/N 이 그냥 들어 있는 경우가 있다.
       *
       * 🔴 **그래도 자동으로 채우지 않는다. 한 대만 나와도 안 된다.** S/N 은
       * 고유키가 아니다 — 같은 S/N 에 다른 모델·다른 L/N 인 장비가 실제로
       * 있고(우리 표본 안에도 `1307006` 이 둘이다), 둘 중 하나만 등록돼 있으면
       * 한 대만 나와 **확신하고 남의 장비 값을 적게 된다.**
       *
       * 🔴 **접수폼의 S/N 이 방금 읽은 것과 같을 때만** 찾는다. 사람이 다른
       * S/N 을 적어 둔 채라면 엉뚱한 장비 목록을 들이밀게 된다.
       */
      const afterText: NameplateTextCurrent = { ...now.fields, ...plan.patch };
      const lookupSerial =
        reading.serialNumber && afterText.serialNumber.trim() === reading.serialNumber
          ? reading.serialNumber
          : null;
      let productChoices: RegisteredProductChoice[] | undefined;
      if (lookupSerial && lookupBySerial) {
        const rows = await lookupBySerial(lookupSerial);
        if (cancelledRef.current) return;
        if (rows.length > 0) productChoices = rankRegisteredProducts(rows, reading);
      }

      setPhase({
        kind: "DONE",
        line,
        reading,
        settings: outcome.settings,
        productChoices,
        lookupSerial: lookupSerial ?? undefined,
      });
    } catch (error) {
      // 🔴 떠 있던 인식기를 **끄고 나서** 비운다. 그냥 비우면 다음 시도가
      //    새 워커를 띄워 앞엣것이 메모리에 그대로 남는다.
      const dying = engineRef.current;
      engineRef.current = null;
      void dying?.then((engine) => engine.dispose()).catch(() => {});
      if (cancelledRef.current) return;
      setPhase({
        kind: "FAILED",
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      busyRef.current = false;
    }
  }

  /**
   * 🔴 **후보를 사람이 누른 것** — 모델명(비김)과 L/N(자동 실패) 둘 다 이리로 온다.
   *
   * 누르기 전에는 칸이 절대 채워지지 않는다. 글자 인식은 두 경우 모두 「어느
   * 것인지 가릴 수 없다」고 말했을 뿐이고, 그 판단은 사진을 보고 있는 사람의
   * 몫이다. 고른 값도 **빈칸일 때만** 들어가고(이미 적힌 것을 덮지 않는다),
   * 들어간 뒤에는 다른 글자 인식 값과 똑같이 「확인 필요」다.
   */
  function handlePick(picked: Partial<NameplateTextFields>, fromSerial?: string) {
    if (phase.kind !== "DONE") return;
    const now = latestRef.current;
    const chosen: NameplateTextFields = {
      modelName: picked.modelName ?? null,
      lotNumber: picked.lotNumber ?? null,
      serialNumber: picked.serialNumber ?? null,
    };
    const plan = planNameplateTextFill(chosen, now.fields, {
      // 🔴 **사람이 직접 고른 값**이다. 등록 장비에서 가져온 것이든 글자에서
      //    나온 후보든, 누른 그 칸은 들어가야 한다 — 그러지 않으면 단추가
      //    죽은 것처럼 보인다. QR 로 채운 칸만은 그대로 둔다.
      overwrite: true,
      lockedByQr: now.lockedByQr,
    });
    const line = fromSerial
      ? summarizeRegisteredFill(plan, fromSerial)
      : summarizeNameplateTextFill(plan, chosen);
    if (Object.keys(plan.patch).length > 0) {
      now.onFill(plan.patch);
      onResult(line);
    }
    // 고른 자리의 후보만 거둔다 — 나머지는 아직 사람이 골라야 한다.
    const next: NameplateTextReading = { ...phase.reading };
    if (chosen.modelName) {
      next.modelName = chosen.modelName;
      next.model = { state: "MATCHED", name: chosen.modelName, distance: 0 };
    }
    if (chosen.lotNumber) {
      next.lotNumber = chosen.lotNumber;
      next.lotCandidates = [];
    }
    if (chosen.serialNumber) next.serialNumber = chosen.serialNumber;
    // 고른 칸은 2단계가 내놓은 목록에서도 뺀다.
    const offered = phase.offered
      ? {
          modelName: chosen.modelName ? null : phase.offered.modelName,
          lotNumber: chosen.lotNumber ? null : phase.offered.lotNumber,
          serialNumber: chosen.serialNumber ? null : phase.offered.serialNumber,
        }
      : undefined;
    setPhase({
      kind: "DONE",
      line,
      reading: next,
      settings: phase.settings,
      offered,
      // 장비 한 대를 고르면 목록은 거둔다.
      productChoices: fromSerial ? undefined : phase.productChoices,
      lookupSerial: phase.lookupSerial,
    });
  }

  /** 🔴 읽는 중에도 닫을 수 있다 — 닫으면 돌던 읽기는 버린다. */
  function handleClose() {
    cancelledRef.current = true;
    onClose();
  }

  const reading = phase.kind === "READING";
  const ambiguous =
    phase.kind === "DONE" && phase.reading.model.state === "AMBIGUOUS" ? phase.reading.model : null;
  const lotCandidates = phase.kind === "DONE" ? phase.reading.lotCandidates : [];
  /**
   * 🔴 2단계 단추는 **모델명이나 L/N 이 아직 비어 있을 때만** 보인다.
   *
   * 몇 분이 걸리는 일이라 다 채워진 뒤에도 늘 보이면 사람이 습관적으로 누른다.
   * S/N 은 지금도 넷 중 셋이 나오므로 이 판단에 넣지 않았다.
   */
  const deeperHelps =
    phase.kind === "DONE" &&
    (phase.reading.modelName === null || phase.reading.lotNumber === null) &&
    stage2NameplateSettings(phase.settings).length > 0;
  /**
   * 🔴 네모 안이 **원본에서 몇 픽셀**인가. 작으면 「가까이서 다시 찍으라」고
   * 알린다 — 읽기를 막지는 않는다(작아도 S/N 은 자주 나온다).
   */
  const regionPixels = region ? nameplateRegionPixelWidth(region.w, naturalWidth) : 0;
  const regionIsSmall = isNameplateRegionSmall(regionPixels);
  /** 2단계가 새로 찾아 **단추로만** 내놓은 값들. */
  const offeredFields =
    phase.kind === "DONE" && phase.offered
      ? FIELD_LABELS_FOR_OFFER.filter((key) => phase.offered?.[key])
      : [];

  return (
    <dialog
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label="명판 표에 네모 치고 글자로 읽기"
      onCancel={(event) => {
        event.preventDefault();
        handleClose();
      }}
      className="m-auto w-[min(56rem,92vw)] max-w-none rounded-xl border border-amber-300 bg-white px-5 py-4 text-left shadow-xl outline-none backdrop:bg-black/40"
    >
      <h2 className="text-sm font-bold text-zinc-900">명판 표에 네모를 쳐 주세요</h2>
      {/* 🔴 **왜 이 창이 저절로 열렸는지**를 맨 위에 적는다. */}
      <p className="mt-1 text-xs font-semibold text-amber-800">
        이 사진에서 QR 을 찾지 못했습니다. 명판 표에 네모를 쳐 주세요.
      </p>
      <p className="mt-1 text-xs leading-relaxed text-zinc-600">
        사진 위에서 <b>Model · L/N · S/N 이 적힌 표</b>만 드래그로 감싸 주세요. 네모는 몇 번이든
        다시 칠 수 있습니다. 사진은 저장되지 않습니다.
      </p>

      {/*
        🔴 네모의 자리는 **네모를 그린 상자 기준의 비율**로 저장한다. 그래서
        그 상자가 **보이는 사진과 한 픽셀도 다르지 않아야** 한다. 사진을
        `w-full object-contain` 으로 늘리면 세로로 긴 사진에서 좌우에 빈 띠가
        생기고(상자는 넓은데 사진은 가운데만 차지한다), 사람이 친 네모와 실제로
        잘라내는 자리가 어긋난다. 그래서 상자는 `inline-block` 으로 사진에
        딱 붙이고, 크기는 사진 자신이 `max-h`·`max-w` 로 정한다.
      */}
      <div className="mt-3 flex min-h-32 items-center justify-center rounded-md border border-zinc-300 bg-zinc-100 p-2">
        {/*
          🔴 주소가 아직 없으면 `<img>` 를 **아예 그리지 않는다.** `src=""` 로
          한 번 그리면 깨진 그림이 깜빡이고, 그 사이 네모를 치면 사진이 아닌
          빈 상자 기준으로 비율이 잡혀 엉뚱한 자리를 읽는다.
        */}
        {photoUrl === null ? (
          <p className="py-10 text-xs text-zinc-500">사진을 여는 중…</p>
        ) : (
          <div
            ref={frameRef}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            className="relative inline-block touch-none select-none leading-none"
            style={{ cursor: reading ? "progress" : "crosshair" }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- 메모리에만 있는 사진이다(blob:). next/image 는 쓸 수 없다. */}
            <img
              src={photoUrl}
              alt="고른 명판 사진"
              draggable={false}
              // 🔴 **보이는 크기가 아니라 원본 크기**를 잰다 — 글자 인식이
              //    쓰는 것이 원본 픽셀이다.
              onLoad={(event) => setNaturalWidth(event.currentTarget.naturalWidth)}
              className="block max-h-[52vh] max-w-full"
            />
            {region && region.w > 0 && region.h > 0 && (
              <div
                aria-hidden="true"
                className="pointer-events-none absolute border-2 border-amber-500 bg-amber-300/20"
                style={{
                  left: `${region.l * 100}%`,
                  top: `${region.t * 100}%`,
                  width: `${region.w * 100}%`,
                  height: `${region.h * 100}%`,
                }}
              />
            )}
          </div>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={!region || reading}
          onClick={() => void handleRead()}
          className="rounded-md border border-amber-500 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-900 hover:border-amber-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {reading
            ? `글자를 읽는 중… ${phase.done}/${phase.total}`
            : phase.kind === "DONE"
              ? "이 영역으로 다시 읽기"
              : "이 영역으로 읽기"}
        </button>
        <button
          type="button"
          disabled={!region || reading}
          onClick={() => setRegion(null)}
          className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-800 hover:border-zinc-900 disabled:cursor-not-allowed disabled:opacity-50"
        >
          네모 지우기
        </button>
        <span className="text-xs text-zinc-500">
          {reading
            ? "같은 영역을 여러 가지로 다듬어 읽습니다."
            : phase.kind === "DONE"
              ? "🔴 다시 읽으면 이미 채워진 칸도 덮어씁니다(QR 로 읽은 칸은 그대로)."
              : region
                ? `네모 안만 원본 화질로 읽습니다 (${regionPixels}px).`
                : "아직 네모를 치지 않았습니다."}
        </span>
        <button
          type="button"
          onClick={handleClose}
          className="ml-auto rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-800 hover:border-zinc-900"
        >
          {reading ? "그만 읽고 닫기" : "닫기"}
        </button>
      </div>

      {/*
        🔴 **작게 찍혔으면 미리 알린다 — 막지는 않는다.**
        지금까지 잰 것 가운데 성적을 가장 잘 설명한 것이 네모의 원본 픽셀
        폭이다(600px 근거는 `nameplate-ocr.ts` 의 표). 작아도 S/N 은 다섯 중
        넷에서 나오므로 읽기는 그대로 둔다.
      */}
      {regionIsSmall && (
        <p className="mt-2 rounded-md border border-amber-400 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          명판이 작게 찍혔습니다({regionPixels}px). <b>가까이서 다시 찍으면 훨씬 잘
          읽힙니다.</b> 지금 그대로 읽어 볼 수도 있습니다 — S/N 은 작아도 자주 읽힙니다.
        </p>
      )}

      {phase.kind === "DONE" && (
        <div className="mt-3 rounded-md border border-amber-400 bg-amber-50 px-3 py-2">
          <p className="text-xs font-semibold text-amber-900">{phase.line}</p>
          <p className="mt-1 text-xs leading-relaxed text-amber-800">
            {phase.line === NAMEPLATE_TEXT_EMPTY_MESSAGE
              ? "네모를 표에 더 바짝 맞춰 다시 쳐 보시거나, 명판을 가까이서 다시 찍어 주세요."
              : phase.line === NAMEPLATE_TEXT_ALL_TAKEN_MESSAGE
                ? "이미 적혀 있는 값은 덮어쓰지 않습니다. 비우고 다시 읽으면 채울 수 있습니다."
                : "QR 과 달리 글자 인식에는 오류 검사가 없습니다. 채워진 값을 명판과 하나씩 맞춰 보고 다르면 고쳐 주세요."}
          </p>
          {ambiguous && (
            <div className="mt-2">
              <p className="text-xs text-amber-900">
                모델명 후보가 {ambiguous.names.length}개입니다 — 글자로는 가를 수 없습니다(등록된
                이름이 붙임표만 다릅니다). 명판에 인쇄된 대로 골라 주세요.
              </p>
              <div className="mt-1 flex flex-wrap gap-2">
                {ambiguous.names.map((name) => (
                  <button
                    key={name}
                    type="button"
                    onClick={() => handlePick({ modelName: name })}
                    className="rounded-md border border-amber-500 bg-white px-2 py-1 text-xs font-semibold text-amber-900 hover:border-amber-700"
                  >
                    {name}
                  </button>
                ))}
              </div>
            </div>
          )}
          {/*
            🔴 L/N 후보 — **1등이라도 자동으로 채우지 않는다.** 실측에서 틀린
            값이 맞는 값들과 똑같은 표를 받았고(092949573 의 `WZ6241`), 표 수로
            둘을 가를 방법이 없었다. 그리고 **맞는 것이 아예 없을 수도 있다** —
            그 사진이 실제로 그랬다. 그래서 「맞는 것이 없으면 직접 입력하세요」를
            반드시 함께 적는다. 이 말을 빼면 사람이 다섯 중 하나는 맞다고 믿는다.
          */}
          {/*
            🔴 S/N 으로 찾은 등록 장비 — **한 대뿐이어도 자동으로 안 채운다.**
            S/N 은 고유키가 아니다. 같은 S/N 에 다른 모델·다른 L/N 인 장비가
            실제로 있고(우리 표본의 `1307006` 이 그렇다), 둘 중 하나만 등록돼
            있으면 한 대만 나와 **확신하고 남의 장비 값을 적게 된다.**
            🔴 Model 과 L/N 을 **짝으로** 내놓는다 — 짝을 깨면 모델은 이 장비
            것, L/N 은 저 장비 것이 된다.
          */}
          {phase.kind === "DONE" &&
            phase.productChoices &&
            phase.productChoices.length > 0 && (
              <div className="mt-2 border-t border-amber-300 pt-2">
                <p className="text-xs text-amber-900">
                  S/N {phase.lookupSerial} 으로 등록된 장비 {phase.productChoices.length}대를
                  찾았습니다. <b>S/N 이 같아도 다른 장비일 수 있습니다.</b> 모델명과 L/N 을
                  사진과 맞춰 보고 고르세요.
                </p>
                <div className="mt-1 flex flex-col items-start gap-1">
                  {phase.productChoices.map((choice) => (
                    <button
                      key={choice.product.id}
                      type="button"
                      onClick={() =>
                        handlePick(fieldsFromRegisteredProduct(choice.product), phase.lookupSerial)
                      }
                      className="rounded-md border border-amber-500 bg-white px-2 py-1 text-left text-xs font-semibold text-amber-900 hover:border-amber-700"
                    >
                      {choice.product.modelName}
                      <span className="ml-2 font-mono font-normal">
                        L/N {choice.product.lotNumber?.trim() || "—"}
                      </span>
                      {choice.matchesReadModel && (
                        <span className="ml-2 font-normal text-amber-700">
                          · 사진에서 읽은 모델과 일치
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            )}
          {/*
            🔴 2단계가 찾은 값 — **자동으로 채우지 않는다.** 바퀴를 더 돌면
            비슷한 오답도 같이 늘어 투표를 뒤집는다(실측: 다섯 장에서 틀린 값이
            0건 → 5건, 모델명까지 엉뚱한 것이 들어왔다). 그래서 1단계가 정한
            칸은 건드리지 않고, 새로 찾은 것은 사람이 눌러야 들어간다.
          */}
          {phase.kind === "DONE" && offeredFields.length > 0 && (
            <div className="mt-2 border-t border-amber-300 pt-2">
              <p className="text-xs text-amber-900">
                더 자세히 읽어 찾은 값입니다 —{" "}
                <b>사진과 대조해 고르세요. 맞는 것이 없으면 직접 입력하세요.</b>
              </p>
              <div className="mt-1 flex flex-wrap gap-2">
                {offeredFields.map((key) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => handlePick({ [key]: phase.offered?.[key] })}
                    className="rounded-md border border-amber-500 bg-white px-2 py-1 text-xs font-semibold text-amber-900 hover:border-amber-700"
                  >
                    {FIELD_LABEL_TEXT[key]} <span className="font-mono">{phase.offered?.[key]}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {deeperHelps && (
            <div className="mt-2 border-t border-amber-300 pt-2">
              <button
                type="button"
                onClick={() => void handleRead(true)}
                className="rounded-md border border-amber-600 bg-white px-3 py-1.5 text-xs font-semibold text-amber-900 hover:border-amber-800"
              >
                더 자세히 읽기
              </button>
              <span className="ml-2 text-xs text-amber-800">
                배율 셋 × 기울기 셋을 더 써 봅니다 —{" "}
                <b>몇 분 걸립니다.</b> 지금까지 찾은 값은 지우지 않고 보탭니다.
              </span>
            </div>
          )}
          {lotCandidates.length > 0 && (
            <div className="mt-2 border-t border-amber-300 pt-2">
              <p className="text-xs text-amber-900">
                L/N 은 자동으로 채우지 못했습니다. 글자 인식이 내놓은 후보입니다 —{" "}
                <b>사진과 대조해 고르세요. 맞는 것이 없으면 직접 입력하세요.</b>
              </p>
              <div className="mt-1 flex flex-wrap gap-2">
                {lotCandidates.map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => handlePick({ lotNumber: value })}
                    className="rounded-md border border-amber-500 bg-white px-2 py-1 font-mono text-xs font-semibold text-amber-900 hover:border-amber-700"
                  >
                    {value}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {phase.kind === "FAILED" && (
        <div className="mt-3 rounded-md border border-rose-300 bg-rose-50 px-3 py-2">
          <p className="text-xs font-semibold text-rose-900">글자 인식을 마치지 못했습니다.</p>
          <p className="mt-1 text-xs text-rose-800">{phase.message}</p>
        </div>
      )}
    </dialog>
  );
}
