/**
 * ============================================================================
 * 통문증에서 통문번호 읽기 — **브라우저 안에서만** 도는 한 벌
 * ============================================================================
 * 사진 한 장을 받아 통문번호를 돌려주기까지의 흐름을 여기서 엮는다.
 *
 *   1. 첨부 통로에서 **원본** 사진을 받는다 (권한 검사는 그 통로가 한다)
 *   2. Web Worker 가 전처리한다 (pass-slip-worker.ts)
 *   3. tesseract.js 가 글자를 읽는다 (제 워커에서 돈다)
 *   4. 글자에서 통문번호를 뽑고 날짜로 검산한다 (pass-slip-number.ts)
 *
 * ── 🔴 고객 자료가 이 PC 를 떠나지 않는다 ───────────────────────────────
 * 글자 인식기도 언어 데이터도 **우리 서버에서** 내려온다(`/ocr/…`). 클라우드
 * OCR 도 CDN 도 쓰지 않는다 — 운영 NAS 가 인터넷에 닿는다는 보장이 없고,
 * 무엇보다 고객 서류를 남의 서비스에 보내지 않는다는 약속이 먼저다.
 *
 * ── 🔴 두 번째부터는 다시 받지 않는다 ───────────────────────────────────
 * tesseract.js 의 기본 캐시(IndexedDB)를 그대로 쓴다. 언어 데이터가 5MB 라
 * 끌 이유가 없다 — `cacheMethod` 를 `"none"` 으로 두면 줄 수만큼 다시 받는다.
 *
 * ── 왜 npm 꾸러미가 아니라 `/ocr/` 의 파일인가 ─────────────────────────
 * tesseract.js 는 제 워커와 wasm 코어를 **주소로** 불러 쓰는 구조라, 꾸러미로
 * 들여와도 결국 그 파일들을 정적 자원으로 내놓아야 한다. 그럴 바에는 한 군데
 * (`public/ocr/`)에 두고 주소만 가리키는 쪽이 어디서 무엇을 읽는지 분명하다.
 * ============================================================================
 */

import { readPassSlipNumber } from "./pass-slip-number";
import { PASS_SLIP_PAGE_SEG_MODE } from "./pass-slip-preprocess";
import type { PassSlipPrepareRequest, PassSlipPrepareResponse } from "./pass-slip-worker";

/** 글자 인식기 한 벌이 사는 자리. `public/ocr/` 이 그대로 나간다. */
const OCR_ASSET_BASE = "/ocr";

/**
 * 첨부 **원본**을 화면 안에서 받는 주소.
 *
 * 🔴 `view=thumb` 이 아니다. 썸네일은 작게 줄인 사진이라 통문번호가 뭉개진다 —
 * 전처리는 원본 해상도를 1800px 로 늘리는 것을 전제로 맞춰져 있다.
 */
export function passSlipImageUrl(attachmentId: string): string {
  return `/api/attachments/${encodeURIComponent(attachmentId)}/download?view=full`;
}

export type PassSlipReadOutcome =
  | {
      status: "VERIFIED";
      passNumber: string;
      writtenDates: string[];
    }
  | {
      status: "UNVERIFIED";
      passNumber: string;
      writtenDates: string[];
    }
  | { status: "FAILED"; message: string };

/* ────────────────────────────────────────────────────────────────────────── *
 * tesseract.js — 꾸러미가 아니라 전역으로 들어온다. 쓰는 만큼만 적는다.
 * ────────────────────────────────────────────────────────────────────────── */

type TesseractWorkerLike = {
  setParameters(parameters: Record<string, string>): Promise<unknown>;
  recognize(image: unknown): Promise<{ data: { text: string; confidence: number } }>;
  terminate(): Promise<unknown>;
};

type TesseractGlobal = {
  createWorker(
    languages: string,
    oem: number,
    options: Record<string, unknown>
  ): Promise<TesseractWorkerLike>;
};

function tesseractOnWindow(): TesseractGlobal | null {
  const found = (window as unknown as { Tesseract?: TesseractGlobal }).Tesseract;
  return found ?? null;
}

let tesseractScriptPromise: Promise<TesseractGlobal> | null = null;

/** `/ocr/tesseract.min.js` 를 한 번만 끌어온다. */
function loadTesseract(): Promise<TesseractGlobal> {
  const already = tesseractOnWindow();
  if (already) return Promise.resolve(already);
  if (tesseractScriptPromise) return tesseractScriptPromise;

  tesseractScriptPromise = new Promise<TesseractGlobal>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `${OCR_ASSET_BASE}/tesseract.min.js`;
    script.async = true;
    script.onload = () => {
      const loaded = tesseractOnWindow();
      if (loaded) resolve(loaded);
      else reject(new Error("글자 인식기를 불러왔지만 쓸 수 없습니다."));
    };
    script.onerror = () => {
      // 다음 시도가 다시 받을 수 있게 약속을 비운다.
      tesseractScriptPromise = null;
      reject(new Error("글자 인식기를 불러오지 못했습니다 (/ocr/tesseract.min.js)."));
    };
    document.head.appendChild(script);
  });
  return tesseractScriptPromise;
}

/* ────────────────────────────────────────────────────────────────────────── *
 * 전처리 워커 — 요청마다 번호를 붙여 답을 짝짓는다.
 * ────────────────────────────────────────────────────────────────────────── */

type PendingPrepare = {
  resolve: (value: PassSlipPrepareResponse) => void;
  reject: (reason: Error) => void;
};

export type PassSlipReader = {
  /**
   * 글자 인식기를 미리 띄운다. 처음 한 번은 언어 데이터 3MB 를 받으므로 몇 초가
   * 걸린다 — 읽기 전에 따로 불러 두면 화면이 「준비 중」을 말할 수 있다.
   */
  prepare(): Promise<void>;
  /** 한 장을 읽는다. 던지지 않는다 — 실패도 결과의 한 갈래다. */
  read(attachmentId: string): Promise<PassSlipReadOutcome>;
  /** 워커 둘을 정리한다. 화면을 떠날 때 부른다. */
  dispose(): void;
};

export function createPassSlipReader(): PassSlipReader {
  let prepareWorker: Worker | null = null;
  const pending = new Map<number, PendingPrepare>();
  let nextRequestId = 1;

  let tesseractWorkerPromise: Promise<TesseractWorkerLike> | null = null;
  let tesseractWorker: TesseractWorkerLike | null = null;
  let disposed = false;

  function ensurePrepareWorker(): Worker {
    if (prepareWorker) return prepareWorker;
    // 🔴 `new URL(..., import.meta.url)` 꼴이어야 묶는 도구가 워커를 알아보고
    //    따로 떼어 낸다. 글자로 적은 주소를 주면 개발에서만 되고 배포에서 깨진다.
    const worker = new Worker(new URL("./pass-slip-worker.ts", import.meta.url), {
      type: "module",
    });
    worker.addEventListener("message", (event: MessageEvent) => {
      const response = event.data as PassSlipPrepareResponse;
      const waiting = pending.get(response.id);
      if (!waiting) return;
      pending.delete(response.id);
      waiting.resolve(response);
    });
    worker.addEventListener("error", (event: ErrorEvent) => {
      const message = event.message || "사진을 펼치지 못했습니다.";
      for (const waiting of pending.values()) waiting.reject(new Error(message));
      pending.clear();
    });
    prepareWorker = worker;
    return worker;
  }

  function prepareInWorker(image: Blob): Promise<PassSlipPrepareResponse> {
    const worker = ensurePrepareWorker();
    const id = nextRequestId;
    nextRequestId += 1;
    const request: PassSlipPrepareRequest = { id, image };
    return new Promise<PassSlipPrepareResponse>((resolve, reject) => {
      pending.set(id, { resolve, reject });
      worker.postMessage(request);
    });
  }

  function ensureTesseractWorker(): Promise<TesseractWorkerLike> {
    if (tesseractWorkerPromise) return tesseractWorkerPromise;
    tesseractWorkerPromise = (async () => {
      const Tesseract = await loadTesseract();
      // oem 1 = LSTM 만. 옛 엔진을 빼면 wasm 코어가 한 벌만 필요하다.
      const worker = await Tesseract.createWorker("eng", 1, {
        workerPath: `${OCR_ASSET_BASE}/worker.min.js`,
        /*
         * 🔴 **wasm 코어를 파일 하나로 못박는다. 폴더를 주지 마라.**
         *
         * 폴더(`/ocr/`)를 주면 tesseract.js 가 SIMD 지원 여부를 보고 파일 이름을
         * 스스로 고른다 — SIMD 가 없는 브라우저에서는 `tesseract-core-lstm.wasm.js`
         * 를 찾는데, **그 예비본은 저장소에 없다**(2026-10-01 사용자 결정). 3.8MB 를
         * 빼기로 한 까닭은 WebAssembly SIMD 가 Chrome · Edge 91(2021-05) 이후 모두
         * 들어 있어 사내에 그보다 낡은 브라우저가 있을 가능성이 매우 낮고, 설령
         * 있더라도 그 PC 에서는 「못 읽음(회색)」으로 떨어져 손으로 적으면 되기
         * 때문이다 — 자료가 틀리는 일은 없다.
         *
         * 그래서 **이름을 직접 적는다.** 폴더로 되돌리면 그 낡은 브라우저에서
         * 404 가 나고, 「예비본이 빠졌네」 하고 파일만 되살리면 저장소가 다시
         * 3.8MB 커진다. 되돌리기 전에 위 결정을 먼저 확인할 것.
         */
        corePath: `${OCR_ASSET_BASE}/tesseract-core-simd-lstm.wasm.js`,
        langPath: `${OCR_ASSET_BASE}/tessdata`,
        // 언어 데이터는 `.gz` 로 두었다(5,199,098 → 2,931,173 바이트). 받아서 푼다.
        gzip: true,
        // 🔴 기본값 그대로 IndexedDB 에 넣어 둔다 — 두 번째부터는 안 받는다.
        cacheMethod: "write",
        logger: () => {},
        errorHandler: (error: unknown) => {
          console.error("[pass-slip-ocr] tesseract", error);
        },
      });
      // 6 = 「하나의 균일한 글자 덩어리」. 띠 하나를 잘라 넘기므로 이것이 맞는다.
      await worker.setParameters({ tessedit_pageseg_mode: PASS_SLIP_PAGE_SEG_MODE });
      tesseractWorker = worker;
      return worker;
    })().catch((error: unknown) => {
      // 실패를 기억해 두면 다시 눌러도 영영 안 된다.
      tesseractWorkerPromise = null;
      throw error;
    });
    return tesseractWorkerPromise;
  }

  async function read(attachmentId: string): Promise<PassSlipReadOutcome> {
    try {
      const response = await fetch(passSlipImageUrl(attachmentId), {
        credentials: "same-origin",
      });
      if (!response.ok) {
        return {
          status: "FAILED",
          message:
            response.status === 403 || response.status === 404
              ? "통문증 사진을 열 권한이 없거나 파일을 찾을 수 없습니다."
              : `통문증 사진을 받지 못했습니다 (HTTP ${response.status}).`,
        };
      }
      const image = await response.blob();

      const prepared = await prepareInWorker(image);
      if (!prepared.ok) return { status: "FAILED", message: prepared.message };

      const worker = await ensureTesseractWorker();
      if (disposed) return { status: "FAILED", message: "읽기를 멈췄습니다." };
      const recognized = await worker.recognize(prepared.png);

      const reading = readPassSlipNumber(recognized.data.text);
      if (!reading.passNumber) {
        return { status: "FAILED", message: "사진에서 통문번호를 찾지 못했습니다." };
      }
      return {
        status: reading.dateVerified ? "VERIFIED" : "UNVERIFIED",
        passNumber: reading.passNumber,
        writtenDates: reading.writtenDates,
      };
    } catch (error) {
      return {
        status: "FAILED",
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  function dispose(): void {
    disposed = true;
    for (const waiting of pending.values()) {
      waiting.reject(new Error("읽기를 멈췄습니다."));
    }
    pending.clear();
    prepareWorker?.terminate();
    prepareWorker = null;
    // 글자 인식기는 끄는 데도 시간이 걸린다. 실패해도 화면이 할 일은 없다.
    void tesseractWorker?.terminate().catch(() => {});
    tesseractWorker = null;
    tesseractWorkerPromise = null;
  }

  async function prepare(): Promise<void> {
    await ensureTesseractWorker();
  }

  return { prepare, read, dispose };
}
