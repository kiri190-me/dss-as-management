"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * ============================================================================
 * 앱 안에서 도는 카메라 — 셔터를 계속 누를 수 있다
 * ============================================================================
 * `<input type="file" capture>`로는 연속 촬영이 안 된다. 그 방식은 폰의 기본
 * 카메라 앱을 열고 한 장을 받아 오는 것이라, 확인을 누르면 카메라가 닫히고
 * 웹 화면으로 돌아온다. 닫힌 카메라를 코드로 다시 열려면 브라우저가 "지금
 * 사용자가 누르는 중"으로 인정해 줘야 하는데 그 인정이 한 번 더까지만 이어져서
 * **두 장에서 멈춘다.** 자동 재실행으로는 이 벽을 넘을 수 없다.
 *
 * 그래서 카메라 영상을 이 화면 안에 직접 띄운다(getUserMedia). 카메라가 켜진
 * 채로 남아 있으므로 셔터를 누르는 만큼 계속 찍힌다.
 *
 * ── 카메라 앱처럼 보이게 하는 것 ─────────────────────────────────────────
 * 켜면 화면 전체를 덮는다. 웹 페이지 위에 조그맣게 얹힌 영상은 장비 앞에서
 * 각도를 잡을 때 쓸 수 없다 — 손에 든 것이 카메라라고 느껴져야 조준이 된다.
 * 그래서 배경을 검게 깔고, 조작은 영상 위에 얹고, 셔터는 엄지가 닿는 자리에
 * 크고 둥글게 둔다.
 *
 * **가로로 돌리면 조작이 오른쪽으로 간다.** 가로에서 아래쪽에 두면 영상이
 * 눌리고, 폰을 가로로 쥔 손의 엄지는 화면 옆에 있지 아래에 있지 않다.
 * portrait/landscape 변형으로 배치만 바꾸고 같은 요소를 쓴다.
 *
 * ── 두 가지 대가 ─────────────────────────────────────────────────────────
 *  1. **보안 컨텍스트가 필요하다.** getUserMedia는 HTTPS나 localhost에서만
 *     동작한다. 사내망에서 http://192.168.x.x 로 접속할 때는 폰 Chrome의
 *     `chrome://flags` → "Insecure origins treated as secure"에 그 주소를
 *     등록해 두어야 한다. NAS로 옮겨 운영할 때는 HTTPS가 정공법이다.
 *  2. **해상도가 기본 카메라 앱보다 낮다.** 폰 기본 앱은 센서 전체를 쓰지만
 *     getUserMedia는 보통 미리보기용 스트림을 준다. 아래에서 큰 값을 요청하고
 *     실제로 받은 크기 그대로 저장한다. 원본 화질이 필요하면 기본 앱으로 찍어
 *     앨범에서 올리는 경로를 쓰면 된다.
 * ============================================================================
 */

type InAppCameraProps = {
  /** 한 장 찍을 때마다 불린다. 카메라는 닫히지 않는다. */
  onCapture: (file: File) => void;
  /** 업로드 중처럼 지금 찍으면 안 되는 상황. */
  disabled?: boolean;
  /**
   * 이 기기에서 카메라를 쓸 수 없다고 판정됐을 때. 부르는 쪽이 대체 경로를
   * 안내하기 위한 것이다. **이 컴포넌트는 같은 문구를 스스로 또 그리지
   * 않는다** — 그러면 화면에 같은 말이 두 번 뜬다.
   */
  onUnavailable?: (reason: string) => void;
};

function cameraApiAvailable(): boolean {
  return typeof navigator !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia);
}

const UNAVAILABLE_NO_API =
  "이 브라우저에서는 앱 안 카메라를 쓸 수 없습니다. 사내망 주소(http)로 접속했다면 폰 Chrome의 chrome://flags에서 그 주소를 보안 예외로 등록해야 합니다.";

export default function InAppCamera({ onCapture, disabled = false, onUnavailable }: InAppCameraProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [isOpen, setIsOpen] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [shotCount, setShotCount] = useState(0);
  /** 방금 찍은 한 장의 미리보기. 카메라 앱의 왼쪽 아래 썸네일과 같은 역할이다. */
  const [lastShotUrl, setLastShotUrl] = useState<string | null>(null);
  /** 셔터를 눌렀다는 것을 눈으로 알려 주는 짧은 흰 섬광. */
  const [isFlashing, setIsFlashing] = useState(false);
  /** 카메라가 켜진 동안에만 쓰는 오류. 켜기 실패는 부모가 안내한다. */
  const [runtimeError, setRuntimeError] = useState<string | null>(null);

  /**
   * 가로로 쥐고 있는가.
   *
   * Tailwind의 portrait:/landscape: 변형에 기대지 않고 직접 잰다. 그 변형이
   * 이 프로젝트의 빌드에서 생성되지 않아, 세로인데 가로 배치가 그려지는 일이
   * 실제로 있었다 — 그런 어긋남은 화면에서만 드러나고 타입·테스트·빌드는 전부
   * 통과한다. 값으로 들고 있으면 코드에서 무엇이 켜졌는지 읽힌다.
   *
   * 초기값을 초기화 함수에서 재는 이유는 효과 안에서 setState를 부르지 않기
   * 위해서다(이 저장소의 lint 규칙). 효과는 이후의 회전만 구독한다.
   */
  const [isLandscape, setIsLandscape] = useState(() =>
    typeof window === "undefined" ? false : window.matchMedia("(orientation: landscape)").matches
  );

  useEffect(() => {
    const query = window.matchMedia("(orientation: landscape)");
    const onChange = (event: MediaQueryListEvent) => setIsLandscape(event.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  const stopStream = useCallback(() => {
    // 트랙을 멈추지 않으면 카메라 표시등이 계속 켜져 있고 배터리를 먹는다.
    for (const track of streamRef.current?.getTracks() ?? []) {
      track.stop();
    }
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  // 화면을 떠날 때 카메라와 미리보기 메모리를 놓아 준다. 상태를 건드리지 않는
  // 정리 전용 효과다.
  useEffect(() => {
    return () => {
      stopStream();
      if (lastShotUrl) URL.revokeObjectURL(lastShotUrl);
    };
    // lastShotUrl을 의존성에 넣으면 찍을 때마다 카메라가 꺼진다. 마지막 값은
    // 언마운트 시점에만 필요하므로 ref 없이 이 형태를 유지한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stopStream]);

  // 카메라가 켜져 있는 동안에는 뒤 페이지가 스크롤되지 않게 한다 — 조준하며
  // 손가락을 끌면 뒤 화면이 밀려 영상이 따라 움직이는 것처럼 보인다.
  useEffect(() => {
    if (!isOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [isOpen]);

  // 스트림을 video에 붙인다. video 요소는 isOpen이 참일 때만 그려지므로,
  // 스트림을 먼저 잡아 두고 이 효과에서 연결한다.
  useEffect(() => {
    if (!isOpen) return;
    const video = videoRef.current;
    const stream = streamRef.current;
    if (!video || !stream) return;
    video.srcObject = stream;
    void video.play().catch(() => {});
  }, [isOpen]);

  async function openCamera() {
    if (!cameraApiAvailable()) {
      onUnavailable?.(UNAVAILABLE_NO_API);
      return;
    }

    setIsStarting(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          // 후면 카메라를 요청한다. ideal이라 없으면 있는 것으로 대체된다.
          facingMode: { ideal: "environment" },
          // 기기가 줄 수 있는 만큼 큰 것을 요청한다. 실제로 무엇을 받았는지는
          // 찍을 때 videoWidth/Height로 다시 읽는다.
          width: { ideal: 2560 },
          height: { ideal: 1440 },
        },
        audio: false,
      });
      streamRef.current = stream;
      setShotCount(0);
      setRuntimeError(null);
      setIsOpen(true);
    } catch (caught) {
      // 권한 거부와 기기 없음을 구분해 준다 — 사용자가 할 수 있는 일이 다르다.
      const name = caught instanceof Error ? caught.name : "";
      onUnavailable?.(
        name === "NotAllowedError" || name === "SecurityError"
          ? "카메라 사용이 거부되었습니다. 브라우저 주소창의 권한 설정에서 카메라를 허용해 주세요."
          : name === "NotFoundError"
            ? "이 기기에서 카메라를 찾지 못했습니다."
            : "카메라를 열지 못했습니다."
      );
    } finally {
      setIsStarting(false);
    }
  }

  function closeCamera() {
    stopStream();
    setIsOpen(false);
    if (lastShotUrl) URL.revokeObjectURL(lastShotUrl);
    setLastShotUrl(null);
  }

  /** 지금 화면에 보이는 한 프레임을 사진으로 만든다. 카메라는 계속 켜져 있다. */
  async function takeShot() {
    const video = videoRef.current;
    if (!video) return;

    // 실제로 받은 스트림 크기 그대로 담는다 — 요청값이 아니라 기기가 준 값이어야
    // 사진이 늘어나거나 잘리지 않는다.
    const width = video.videoWidth;
    const height = video.videoHeight;
    if (width === 0 || height === 0) {
      setRuntimeError("카메라 준비가 끝나기 전입니다. 잠시 후 다시 눌러 주세요.");
      return;
    }

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) {
      setRuntimeError("사진을 만들지 못했습니다.");
      return;
    }
    context.drawImage(video, 0, 0, width, height);

    const blob = await new Promise<Blob | null>((resolve) => {
      // 0.92는 눈으로 차이를 느끼지 않으면서 파일 크기를 크게 줄이는 구간이다.
      canvas.toBlob((result) => resolve(result), "image/jpeg", 0.92);
    });
    if (!blob) {
      setRuntimeError("사진을 만들지 못했습니다.");
      return;
    }

    const nextIndex = shotCount + 1;
    // 확장자는 .jpg여야 한다 — 서버의 허용목록이 확장자와 실제 내용을 함께 본다.
    const file = new File([blob], `촬영-${Date.now()}-${nextIndex}.jpg`, { type: "image/jpeg" });

    setShotCount(nextIndex);
    setRuntimeError(null);
    // 방금 찍은 것을 왼쪽 아래에 보여 준다. 앞의 것은 놓아 준다.
    setLastShotUrl((previous) => {
      if (previous) URL.revokeObjectURL(previous);
      return URL.createObjectURL(blob);
    });
    setIsFlashing(true);
    window.setTimeout(() => setIsFlashing(false), 120);

    onCapture(file);
  }

  // ── 닫혀 있을 때: 켜는 버튼만 ─────────────────────────────────────────
  if (!isOpen) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={openCamera}
          disabled={disabled || isStarting}
          className="rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          {isStarting ? "카메라 준비 중…" : "카메라 켜기"}
        </button>
        <span className="text-xs text-zinc-500 dark:text-zinc-400">
          켜 두고 셔터를 누르는 만큼 계속 찍힙니다.
        </span>
      </div>
    );
  }

  // ── 켜져 있을 때: 화면 전체를 덮는다 ──────────────────────────────────
  //
  // 영상이 화면을 가득 채우고 조작은 그 **위에** 뜬다. 화면을 둘로 갈라
  // 한쪽에 조작을 두면 영상이 그만큼 좁아지는데, 실제 카메라 앱은 그렇게
  // 하지 않는다 — 조준할 면적이 곧 쓸모다.
  return (
    <div role="dialog" aria-modal="true" aria-label="촬영" className="fixed inset-0 z-50 bg-black">
      <video
        ref={videoRef}
        playsInline
        muted
        autoPlay
        className="absolute inset-0 h-full w-full object-contain"
      />

      {/* 셔터를 눌렀다는 신호 */}
      {isFlashing && <div className="pointer-events-none absolute inset-0 bg-white/70" />}

      {/* 찍은 장수 — 왼쪽 위, 노치를 피해서 */}
      <span className="absolute left-3 top-[calc(0.75rem+env(safe-area-inset-top))] rounded-full bg-black/60 px-3 py-1 text-sm font-medium text-white tabular-nums">
        {shotCount}장
      </span>

      {/* 닫기 — 오른쪽 위, 카메라 앱의 X와 같은 자리 */}
      <button
        type="button"
        onClick={closeCamera}
        disabled={disabled}
        aria-label="카메라 끄기"
        className="absolute right-3 top-[calc(0.75rem+env(safe-area-inset-top))] flex h-11 w-11 items-center justify-center rounded-full bg-black/60 text-2xl leading-none text-white disabled:opacity-50"
      >
        ×
      </button>

      {runtimeError && (
        <p
          role="alert"
          className="absolute inset-x-4 top-20 rounded-md bg-black/80 px-3 py-2 text-center text-sm text-red-200"
        >
          {runtimeError}
        </p>
      )}

      {/*
        조작. 세로에서는 아래 가로줄, 가로에서는 오른쪽 세로줄이다 — 폰을
        가로로 쥐면 엄지가 화면 옆에 오지 아래에 오지 않는다. 배치는
        matchMedia로 잰 값으로 정한다(Tailwind 방향 변형에 기대지 않는다).
      */}
      <div
        className={
          isLandscape
            ? "absolute inset-y-0 right-0 flex w-28 flex-col items-center justify-center gap-5 bg-gradient-to-l from-black/80 to-transparent pr-[env(safe-area-inset-right)]"
            : "absolute inset-x-0 bottom-0 flex h-36 items-center justify-around gap-4 bg-gradient-to-t from-black/80 to-transparent pb-[env(safe-area-inset-bottom)]"
        }
      >
        {/* 방금 찍은 것 */}
        <div className="h-14 w-14 shrink-0 overflow-hidden rounded-lg border border-white/40 bg-white/10">
          {lastShotUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={lastShotUrl} alt="방금 찍은 사진" className="h-full w-full object-cover" />
          )}
        </div>

        {/*
          셔터. 카메라 앱과 같은 큰 원이다 — 화면을 보면서 안 보고 누르는
          버튼이라 겨냥이 필요 없을 만큼 커야 한다.
        */}
        <button
          type="button"
          onClick={takeShot}
          disabled={disabled}
          aria-label="사진 찍기"
          className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full border-4 border-white/90 disabled:opacity-50"
        >
          <span className="block h-16 w-16 rounded-full bg-white transition-transform active:scale-90" />
        </button>

        {/* 끝내기 — 셔터 반대쪽. 썸네일과 균형을 맞춘다. */}
        <button
          type="button"
          onClick={closeCamera}
          disabled={disabled}
          className="w-14 shrink-0 text-sm font-medium text-white disabled:opacity-50"
        >
          완료
        </button>
      </div>
    </div>
  );
}
