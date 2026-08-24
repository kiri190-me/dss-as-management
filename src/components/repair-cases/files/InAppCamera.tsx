"use client";

import { useCallback, useEffect, useRef, useState, type TouchEvent as ReactTouchEvent } from "react";

import {
  DIGITAL_ZOOM_RANGE,
  clampZoom,
  digitalCropRect,
  formatZoom,
  isZoomAtPreset,
  zoomFromPinch,
  zoomPresets,
  type ZoomRange,
} from "@/lib/domain/camera-zoom";

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
 * ── 배율(줌) ─────────────────────────────────────────────────────────────
 * 랙 안쪽이나 전원이 들어와 있는 보드 앞에서는 장비에 몸을 붙일 수 없다. 그래서
 * 순정 카메라 앱과 같은 두 가지 조작을 둔다 — **핀치**와 **배율 버튼**이다.
 *
 * 방식은 카메라를 열 때 한 번 정한다. 트랙에 zoom 능력이 있으면(주로 Android
 * Chrome) 카메라에 직접 부탁해 프레임 자체를 확대한다. 없으면(iOS Safari, PC
 * 웹캠) 미리보기를 CSS로 확대하고 **찍을 때도 같은 배율로 가운데를 잘라낸다.**
 * 잘라내지 않으면 화면에는 크게 보이는데 저장된 사진만 광각으로 남고, 그것은
 * 현장을 떠난 뒤에야 드러난다. 둘을 동시에 걸지 않는 이유는 그러면 두 배로
 * 확대되기 때문이다. 배율 계산은 @/lib/domain/camera-zoom에 있다.
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

/**
 * ── zoom은 표준 DOM 타입에 없다 ──────────────────────────────────────────
 * 카메라 배율은 W3C Image Capture 확장이라 TypeScript가 들고 있는
 * MediaTrackCapabilities / MediaTrackConstraintSet / MediaTrackSettings에는
 * zoom이 적혀 있지 않다. `as any`로 뚫으면 오타나 잘못된 모양까지 조용히
 * 통과하므로, **필요한 모양만** 여기에 지역 타입으로 적어 두고 그것으로만
 * 다룬다. 표준 타입과 교집합으로 두었기 때문에 나머지 항목은 그대로 검사된다.
 *
 * 값의 존재는 타입이 아니라 실행 시점에 확인해야 한다 — 기기가 zoom을 안 줄 때
 * 그 자리는 그냥 비어 있다. 그래서 min/max를 typeof로 다시 본다.
 */
type ZoomCapabilities = MediaTrackCapabilities & {
  zoom?: { min?: number; max?: number; step?: number };
};
type ZoomSettings = MediaTrackSettings & { zoom?: number };
type ZoomConstraintSet = MediaTrackConstraintSet & { zoom: number };
type ZoomConstraints = MediaTrackConstraints & { advanced: ZoomConstraintSet[] };

/**
 * 이 카메라가 하드웨어 배율을 낼 수 있는가. 못 내면 null이고, 그때는 디지털이다.
 *
 * min과 max가 같은 기기는 "있다"고 알려 놓고 실제로는 움직이지 않는다. 그것을
 * 하드웨어 줌으로 받아들이면 CSS 확대까지 막아 버려 **배율이 아예 없는 카메라**가
 * 된다. 그래서 움직일 수 있을 때만 하드웨어로 친다.
 */
function readHardwareZoomRange(track: MediaStreamTrack): ZoomRange | null {
  // iOS Safari에는 getCapabilities 자체가 없다.
  if (typeof track.getCapabilities !== "function") return null;
  const capabilities: ZoomCapabilities = track.getCapabilities();
  const zoom = capabilities.zoom;
  if (!zoom || typeof zoom.min !== "number" || typeof zoom.max !== "number") return null;
  if (!(zoom.max > zoom.min)) return null;
  return { min: zoom.min, max: zoom.max };
}

/** 지금 트랙이 실제로 걸고 있는 배율. 표시를 실제에 맞추기 위해 읽는다. */
function readTrackZoom(track: MediaStreamTrack, range: ZoomRange): number {
  if (typeof track.getSettings !== "function") return clampZoom(1, range);
  const settings: ZoomSettings = track.getSettings();
  return clampZoom(typeof settings.zoom === "number" ? settings.zoom : 1, range);
}

/**
 * 두 손가락 사이 거리. 손가락이 둘이 아니면 0이고, 그때는 배율이 움직이지 않는다.
 *
 * React의 TouchList와 DOM의 TouchList는 이름만 같고 서로 다른 타입이다. 필요한
 * 것은 두 점의 좌표뿐이라 그만큼만 받는다 — 그러면 둘 다 그대로 들어온다.
 */
type TouchPoints = ArrayLike<{ clientX: number; clientY: number }>;

function pinchGap(touches: TouchPoints): number {
  const first = touches[0];
  const second = touches[1];
  if (!first || !second) return 0;
  return Math.hypot(first.clientX - second.clientX, first.clientY - second.clientY);
}

type PixelSize = { width: number; height: number };

/**
 * 오버레이가 차지하는 크기. 이 화면은 fixed inset-0이라 곧 뷰포트다.
 *
 * 100vh 같은 뷰포트 단위를 쓰지 않는 이유는, 모바일 브라우저의 주소창이 접히고
 * 펴질 때 그 값과 fixed 요소의 실제 높이가 어긋나기 때문이다. clientWidth/Height는
 * 스크롤바를 뺀 실제 배치 영역이라 fixed inset-0의 크기와 같다.
 */
function readViewportSize(): PixelSize {
  if (typeof document === "undefined") return { width: 0, height: 0 };
  const root = document.documentElement;
  return {
    width: root.clientWidth || window.innerWidth,
    height: root.clientHeight || window.innerHeight,
  };
}

/**
 * 미리보기를 자를 상자의 크기 — **프레임과 종횡비가 같아야 한다.**
 *
 * 여기가 이 파일에서 가장 조용히 틀리기 쉬운 곳이다. 자르는 상자가 화면 전체이면
 * (object-contain이 만드는 검은 여백이 상자 안에 들어 있으면) scale은 꽉 찬 축만
 * 자르고 여백이 남는 축은 여백만 갉아먹는다. 그러면 2배에서 **가로는 절반만
 * 보이는데 세로는 전부 보이고**, 촬영은 가로·세로를 똑같이 절반으로 잘라 담으니
 * 화면에서 확인한 위아래가 사진에서 사라진다.
 *
 * 그래서 object-contain이 만들던 그 콘텐츠 상자를 직접 재서 값으로 들고 있는다.
 * 상자와 프레임의 종횡비가 같으면 scale(Z)는 가로·세로를 똑같이 1/Z로 자른다 —
 * digitalCropRect가 담는 것과 정확히 같은 영역이다.
 *
 * 프레임 크기를 아직 모르면(메타데이터 도착 전) null이다.
 */
function fitBoxSize(frame: PixelSize | null, viewport: PixelSize): PixelSize | null {
  if (!frame || !(frame.width > 0) || !(frame.height > 0)) return null;
  if (!(viewport.width > 0) || !(viewport.height > 0)) return null;
  const fit = Math.min(viewport.width / frame.width, viewport.height / frame.height);
  if (!Number.isFinite(fit) || fit <= 0) return null;
  return { width: frame.width * fit, height: frame.height * fit };
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
   * 배율. 카메라가 꺼져 있으면 범위가 null이고 배율 조작도 그리지 않는다.
   *
   * 범위와 방식(하드웨어/디지털)은 **카메라를 열 때 한 번** 정해서 켜져 있는
   * 동안 바뀌지 않는다. 도중에 방식이 바뀌면 그 순간 확대가 두 배가 되거나
   * 사라진다. 껐다 켜면 1배로 돌아오는 것도 이 자리에서 정해진다.
   */
  const [zoomRange, setZoomRange] = useState<ZoomRange | null>(null);
  const [isHardwareZoom, setIsHardwareZoom] = useState(false);
  const [zoom, setZoom] = useState(1);
  /** 핀치를 시작한 순간의 손가락 사이 거리와 배율. 매 프레임 이것과 비교한다. */
  const pinchRef = useRef<{ distance: number; zoom: number } | null>(null);
  /**
   * 하드웨어 줌 요청에 붙이는 번호.
   *
   * 핀치는 손가락을 미는 동안 요청을 연달아 낸다. applyConstraints는 비동기라
   * 늦게 낸 요청이 먼저 끝날 수 있고, 그러면 화면 표시가 뒤로 튄다. 마지막
   * 요청만 표시를 옮기게 한다.
   */
  const zoomRequestRef = useRef(0);

  /**
   * 들어오는 프레임의 실제 크기. 요청한 값이 아니라 기기가 준 값이며,
   * 메타데이터가 도착해야 알 수 있다(그전에는 null).
   */
  const [frameSize, setFrameSize] = useState<PixelSize | null>(null);
  /**
   * 화면 크기. isLandscape와 같은 이유로 CSS에 맡기지 않고 재서 들고 있는다 —
   * 확대한 미리보기와 촬영 잘라내기가 같은 숫자에서 나와야 하기 때문이다.
   * 초기값을 초기화 함수에서 재는 것도 같다(효과 안에서 setState를 부르지 않는다).
   */
  const [viewportSize, setViewportSize] = useState<PixelSize>(readViewportSize);

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

  // 화면이 바뀌면 미리보기 상자를 다시 잰다 — 회전, 주소창이 접히고 펴지는 것,
  // PC 창 크기 조절이 모두 여기로 온다. 다시 재지 않으면 상자가 옛 화면 크기로
  // 남아 확대한 미리보기와 촬영이 어긋난다.
  useEffect(() => {
    const onResize = () => {
      setViewportSize(readViewportSize());
      // 회전할 때 프레임의 가로·세로를 바꿔 주는 기기가 있다. 그 경우 상자만
      // 다시 재면 종횡비가 어긋나므로 프레임 크기도 함께 다시 읽는다.
      const video = videoRef.current;
      if (video && video.videoWidth > 0 && video.videoHeight > 0) {
        setFrameSize({ width: video.videoWidth, height: video.videoHeight });
      }
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
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

  /**
   * 미리보기를 자를 상자. 이 상자가 프레임과 종횡비가 같기 때문에 화면에서 본
   * 영역과 촬영이 담는 영역이 일치한다. 아직 모를 때는 null이고, 그동안은 예전처럼
   * 화면 전체 object-contain으로 두고 확대도 걸지 않는다.
   */
  const previewBox = fitBoxSize(frameSize, viewportSize);

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

      // 이 기기가 하드웨어 배율을 낼 수 있는지 여기서 한 번 본다. 낼 수 있으면
      // 프레임 자체가 확대돼 들어오므로 화면도 촬영도 손댈 것이 없고, 못 내면
      // 디지털(화면 확대 + 촬영 잘라내기)로 간다.
      const track = stream.getVideoTracks()[0];
      const hardwareRange = track ? readHardwareZoomRange(track) : null;
      setIsHardwareZoom(hardwareRange !== null);
      setZoomRange(hardwareRange ?? DIGITAL_ZOOM_RANGE);
      // 새 스트림은 기본 배율에서 시작한다. 표시를 1로 못박지 않고 트랙에게
      // 물어보는 이유는, 초광각을 기본으로 켜는 기기에서 실제와 어긋나기
      // 때문이다.
      setZoom(hardwareRange && track ? readTrackZoom(track, hardwareRange) : 1);
      pinchRef.current = null;
      // 프레임 크기는 이 스트림의 메타데이터가 도착해야 안다. 앞 스트림의 크기를
      // 물려받으면 상자의 종횡비가 틀린 채로 한동안 그려진다.
      setFrameSize(null);

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
    // 껐다 켜면 1배다. 앞 사람이 당겨 놓은 배율을 그대로 물려받으면, 다음 사람은
    // 왜 화면이 이런지 모른 채 찍는다.
    setZoom(1);
    setZoomRange(null);
    setIsHardwareZoom(false);
    setFrameSize(null);
    pinchRef.current = null;
  }

  /**
   * 배율을 바꾼다. 버튼과 핀치가 모두 이 길로 들어온다.
   *
   * 하드웨어 줌은 카메라에 부탁하는 일이라 비동기이고 거절당할 수 있다(다른 앱이
   * 잡고 있거나, 그 배율을 지금 낼 수 없을 때). 거절은 조용히 삼키되 **화면 표시는
   * 성공한 뒤에만 옮긴다** — 표시가 3배인데 실제가 1배면, 찍고 나서 파일을 열어
   * 봐야 알게 된다.
   */
  async function applyZoom(next: number) {
    const range = zoomRange;
    if (!range) return;
    const value = clampZoom(next, range);

    if (!isHardwareZoom) {
      // 상자가 아직 없으면 화면을 정확히 확대할 수 없다. 그 상태에서 배율만
      // 올리면 화면은 그대로인데 사진만 잘려 나간다.
      if (!previewBox) return;
      // 디지털은 우리가 그리는 것이라 실패할 일이 없다. 화면 확대와 촬영
      // 잘라내기가 이 값 하나를 같이 본다.
      setZoom(value);
      return;
    }

    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    const requestId = zoomRequestRef.current + 1;
    zoomRequestRef.current = requestId;
    try {
      const constraints: ZoomConstraints = { advanced: [{ zoom: value }] };
      await track.applyConstraints(constraints);
      if (zoomRequestRef.current === requestId) setZoom(value);
    } catch {
      // 이 기기가 이 배율을 거절했다. 표시를 그대로 두면 화면과 실제가 같다.
    }
  }

  /**
   * 핀치. 두 손가락일 때만 움직이고, 기준은 시작한 순간의 거리와 배율이다.
   *
   * preventDefault를 부르지 않는다 — React는 touchmove를 passive로 붙여 막을 수
   * 없다. 대신 영상 영역에 touch-action: none을 주어 브라우저가 페이지를 확대하지
   * 않게 한다.
   */
  function startPinch(event: ReactTouchEvent<HTMLDivElement>) {
    if (!zoomRange || event.touches.length !== 2) {
      pinchRef.current = null;
      return;
    }
    pinchRef.current = { distance: pinchGap(event.touches), zoom };
  }

  function movePinch(event: ReactTouchEvent<HTMLDivElement>) {
    const start = pinchRef.current;
    if (!start || !zoomRange || event.touches.length !== 2) return;
    void applyZoom(zoomFromPinch(start.zoom, start.distance, pinchGap(event.touches), zoomRange));
  }

  function endPinch() {
    pinchRef.current = null;
  }

  /**
   * 프레임 크기가 도착했다. 이 값이 있어야 미리보기 상자를 프레임과 같은 모양으로
   * 만들 수 있고, 그래야 화면에서 본 영역과 촬영이 담는 영역이 일치한다.
   * 촬영이 쓰는 videoWidth/Height와 같은 출처다.
   */
  function readFrameSize() {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0 || video.videoHeight === 0) return;
    setFrameSize({ width: video.videoWidth, height: video.videoHeight });
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

    /**
     * 디지털 줌으로 당겨 놓았다면 화면에 보이는 만큼만 잘라 담는다. 이것을
     * 빼먹으면 화면에는 크게 보였는데 저장된 사진은 광각이 된다.
     *
     * 하드웨어 줌은 프레임 자체가 이미 확대돼 들어오므로 1을 넘긴다 — 그러면
     * 원본 전체이고, 두 번 확대되지 않는다.
     */
    const crop = digitalCropRect(width, height, isHardwareZoom ? 1 : zoom);

    const canvas = document.createElement("canvas");
    // 저장 크기는 잘라낸 실제 크기 그대로다. 원래 크기로 다시 늘리면 없는 화질을
    // 만들어 내지 못하면서 파일만 커진다.
    canvas.width = crop.sw;
    canvas.height = crop.sh;
    const context = canvas.getContext("2d");
    if (!context) {
      setRuntimeError("사진을 만들지 못했습니다.");
      return;
    }
    context.drawImage(video, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, crop.sw, crop.sh);

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
  const presets = zoomRange ? zoomPresets(zoomRange) : [];

  return (
    <div role="dialog" aria-modal="true" aria-label="촬영" className="fixed inset-0 z-50 bg-black">
      {/*
        핀치 판정 영역은 화면 전체다 — 영상 옆 검은 여백 위에서 손가락을 벌려도
        배율이 움직여야 한다. touch-none이 없으면 두 손가락을 벌릴 때 브라우저가
        페이지를 확대해 버려서 카메라 화면 자체가 어그러진다.
      */}
      <div
        className="absolute inset-0 touch-none overflow-hidden"
        onTouchStart={startPinch}
        onTouchMove={movePinch}
        onTouchEnd={endPinch}
        onTouchCancel={endPinch}
      >
        {/*
          자르는 상자. **프레임과 종횡비가 같은 상자**를 화면 가운데 놓고 그 안에서
          확대한다. 화면 전체를 자르는 상자 안에서 확대하면 여백이 남는 축은 여백만
          줄어들 뿐 잘리지 않아서, 화면에는 세로가 다 보이는데 사진은 위아래가
          잘려 나간다.

          프레임 크기를 아직 모르는 동안(메타데이터 도착 전)에는 예전처럼 화면 전체
          object-contain이다. 그때는 배율이 1이라 보이는 것이 같다. video 요소를
          한 개로 두고 상자만 바꾸는 이유는, 갈아 끼우면 재생 중인 스트림이 떨어져
          화면이 검게 되기 때문이다.
        */}
        <div
          className={
            previewBox ? "absolute left-1/2 top-1/2 overflow-hidden" : "absolute inset-0"
          }
          style={
            previewBox
              ? {
                  width: `${previewBox.width}px`,
                  height: `${previewBox.height}px`,
                  transform: "translate(-50%, -50%)",
                }
              : undefined
          }
        >
          <video
            ref={videoRef}
            playsInline
            muted
            autoPlay
            // 상자가 프레임과 종횡비가 같으므로 object-cover여도 잘리는 것이 없다.
            className={previewBox ? "h-full w-full object-cover" : "h-full w-full object-contain"}
            onLoadedMetadata={readFrameSize}
            /*
              디지털 줌일 때만 화면을 확대한다. 하드웨어 줌 위에 이것까지 걸면 두
              배로 확대된다. 가운데 기준이라 잘라내기와 보이는 것이 같다 —
              상자가 프레임과 같은 모양이므로 scale(Z)는 가로도 세로도 1/Z만 남긴다.
            */
            style={
              previewBox && !isHardwareZoom && zoom !== 1
                ? { transform: `scale(${zoom})`, transformOrigin: "center" }
                : undefined
            }
          />
        </div>
      </div>

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
        배율. 기존 조작 묶음(썸네일·셔터·완료) 바로 안쪽에 붙여 겹치지 않게 두고,
        세로에서는 셔터 위, 가로에서는 셔터 왼쪽이다 — 두 자세 모두 엄지가 닿는
        자리다. 배치 판정은 아래 조작 묶음과 같은 isLandscape를 쓴다.

        슬라이더 대신 버튼인 이유는, 슬라이더는 세로·가로 두 벌을 만들어야 하고
        움직이는 화면 앞에서 정확히 집기도 어렵기 때문이다.
      */}
      {zoomRange && (
        <div
          className={
            isLandscape
              ? "absolute inset-y-0 right-32 flex flex-col items-center justify-center gap-2"
              : "absolute inset-x-0 bottom-40 flex flex-col items-center gap-2"
          }
        >
          <span className="rounded-full bg-black/60 px-2.5 py-1 text-xs font-medium text-white tabular-nums">
            {formatZoom(zoom)}
            {/*
              디지털이라는 것을 적어 둔다. 당길수록 화질이 떨어진다는 사실을 알아야
              "이건 기본 카메라 앱으로 찍자"는 판단을 할 수 있다.
            */}
            {!isHardwareZoom && <span className="ml-1 text-amber-200">디지털</span>}
          </span>
          <div className={isLandscape ? "flex flex-col gap-2" : "flex flex-row gap-2"}>
            {presets.map((preset) => {
              const active = isZoomAtPreset(zoom, preset);
              return (
                <button
                  key={preset}
                  type="button"
                  onClick={() => void applyZoom(preset)}
                  disabled={disabled}
                  aria-pressed={active}
                  aria-label={`배율 ${formatZoom(preset)}`}
                  className={
                    active
                      ? "h-10 min-w-10 rounded-full bg-white px-2 text-sm font-semibold text-black tabular-nums disabled:opacity-50"
                      : "h-10 min-w-10 rounded-full bg-black/60 px-2 text-sm font-medium text-white tabular-nums disabled:opacity-50"
                  }
                >
                  {formatZoom(preset)}
                </button>
              );
            })}
          </div>
        </div>
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
