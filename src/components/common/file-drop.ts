/**
 * ============================================================================
 * 끌어다 놓기 — 「떨구는 동작」 하나를 파일 올리는 모든 화면이 나눠 쓴다
 * ============================================================================
 * DOM 도 React 도 만지지 않는다 — 시험이 브라우저 없이 전부 돌린다. 그리는 일은
 * FileDropZone.tsx 가 하고, 이 파일은 그 조각이 따르는 규칙만 갖는다.
 *
 * ── 🔴 여기는 검사를 하지 않는다 ─────────────────────────────────────────
 * 허용 형식 · 크기 · 몇 장까지인가는 **자리마다 다르다**(스크린샷은 png·jpg 5장,
 * 교산 엑셀은 .xlsx 20MB 하나, 제품 모델은 고른 분류가 받는 확장자 …). 그 판정은
 * 자리마다 이미 있고, 떨군 파일은 **고르기 칸(`<input type="file">`)으로 고른 것과
 * 똑같은 함수**를 지나야 한다. 두 길이 갈리면 떨구기로만 이상한 파일이 들어간다.
 *
 * 그래서 이 파일이 넘기는 것은 **파일 목록뿐**이다. 부르는 쪽은 받은 목록을 지금
 * 고르기 칸의 onChange 가 하던 그 자리에 그대로 태운다.
 *
 * 예외는 둘이고, 둘 다 「검사」가 아니라 **떨구기 자체의 약속**이라 여기 있다:
 *
 *   1. 폴더 걸러 내기 — 브라우저는 폴더도 File 로 준다(크기 0 · 확장자 없음).
 *      어느 자리도 폴더를 받지 않으므로 자리마다 같은 줄을 일곱 번 적을 까닭이 없다.
 *   2. 하나만 받는 자리에 여럿을 떨구면 **거절하고 알린다**(2026-09-17 승인).
 *      `multiple` 은 고르기 칸의 같은 이름 속성을 그대로 옮긴 것이다 — 「몇 개까지」를
 *      새로 정하는 것이 아니라 그 칸이 이미 말하고 있는 것을 떨구기 쪽에도 지키는
 *      것이다. 말없이 첫 하나만 받으면 사람은 나머지도 붙은 줄 안다.
 *
 * ── 🔴 브라우저 기본 동작 ────────────────────────────────────────────────
 * 창에 파일을 떨구면 브라우저는 그 파일을 **연다** — 그 순간 작성 중이던 내용이
 * 통째로 날아간다. 그래서 떨구는 자리 안에서는 dragover · drop 을 막고, 빗나간
 * 자리를 위해 창 전체에도 같은 것을 건다(installFileDropGuard).
 * ============================================================================
 */

export type DroppedFileLike = { name: string; size: number };

// ────────────────────────────────────────────────── 끌고 오는 것이 파일인가

/**
 * 끌고 오는 것이 파일인가. 글자를 끌어 입력칸에 놓는 것(`text/plain`)이나 화면 안의
 * 다른 끌기(그래프 편집기 등)까지 막지 않으려고 **파일일 때만** 반응한다.
 */
export function dragCarriesFiles(types: ArrayLike<string> | null | undefined): boolean {
  if (!types) return false;
  for (let index = 0; index < types.length; index += 1) {
    if (types[index] === "Files") return true;
  }
  return false;
}

// ────────────────────────────────────────────────── 폴더 걸러 내기

/**
 * 떨군 것이 폴더인가. 브라우저는 폴더도 File 로 주는데 **크기 0 에 확장자가 없다**.
 *
 * 크기 0 인 `메모.txt` 는 폴더가 아니다 — 그런 파일은 걸러 내지 않고 그대로 넘긴다.
 * 「빈 파일」이라고 말하는 것은 자리마다의 판정이 할 일이고, 여기서 삼키면 사람은
 * 왜 안 올라갔는지 듣지 못한다.
 */
export function isDroppedFolder(file: DroppedFileLike): boolean {
  if (file.size !== 0) return false;
  return !/\.[^./\\]+$/.test(file.name.trim());
}

// ────────────────────────────────────────────────── 못 받은 것을 알리는 문구

export const FOLDER_ONLY_NOTICE = "폴더는 올릴 수 없습니다 — 폴더를 열어 안의 파일을 놓아 주세요.";

export function folderSkippedNotice(count: number): string {
  return `폴더 ${count}개는 건너뛰었습니다 — 폴더 안의 파일만 올릴 수 있습니다.`;
}

export function tooManyFilesNotice(count: number): string {
  return `파일 하나만 놓을 수 있습니다 — ${count}개를 놓았습니다. 하나만 다시 놓아 주세요.`;
}

// ────────────────────────────────────────────────── 한 번 떨군 것을 어떻게 할까

export type FileDropPlan<T> = {
  /** 부르는 쪽에 넘길 것 — 비어 있으면 아무것도 넘기지 않는다. */
  accepted: T[];
  /** 사람에게 보일 한 줄. 다 받았으면 null — 조용히 버리는 것은 없다. */
  notice: string | null;
};

/**
 * 한 번 떨군 것을 받을지 정한다. 폴더를 걸러 내고, 하나만 받는 자리에 여럿이 오면
 * **하나도 받지 않고** 까닭을 돌려준다(첫 하나만 몰래 받지 않는다).
 */
export function planFileDrop<T extends DroppedFileLike>(
  dropped: readonly T[],
  options: { multiple: boolean }
): FileDropPlan<T> {
  const files = dropped.filter((file) => !isDroppedFolder(file));
  const folderCount = dropped.length - files.length;

  if (files.length === 0) {
    return { accepted: [], notice: folderCount > 0 ? FOLDER_ONLY_NOTICE : null };
  }

  if (!options.multiple && files.length > 1) {
    const parts: string[] = [];
    if (folderCount > 0) parts.push(folderSkippedNotice(folderCount));
    parts.push(tooManyFilesNotice(files.length));
    return { accepted: [], notice: parts.join(" ") };
  }

  return { accepted: files, notice: folderCount > 0 ? folderSkippedNotice(folderCount) : null };
}

// ────────────────────────────────────────────────── 끌기 · 떨구기 다루기

/** 쓰는 것만 — 브라우저의 DataTransfer 가 그대로 맞고, 시험은 흉내 낸 객체를 넘긴다. */
export type DataTransferLike = {
  types?: ArrayLike<string>;
  files?: ArrayLike<File> | null;
  dropEffect?: string;
};

export type DragEventLike = {
  preventDefault: () => void;
  stopPropagation?: () => void;
  dataTransfer?: DataTransferLike | null;
};

export type FileDropHandlerOptions = {
  /**
   * 끌기가 자식 위로 옮겨 갈 때마다 부모는 dragleave 를 한 번 받는다. 그것을 그대로
   * 「떠났다」로 읽으면 표시가 깜빡인다 — 들어온 수를 세어 0 이 될 때만 끈다.
   */
  depth: { current: number };
  /** 올리는 중이라 받을 수 없는가. 그래도 기본 동작은 막는다(아래 onDrop 주석). */
  disabled: boolean;
  /** 고르기 칸의 `multiple` 과 같은 값. */
  multiple: boolean;
  onFiles: (files: File[]) => void;
  onNotice: (notice: string | null) => void;
  setDragging: (dragging: boolean) => void;
};

export type FileDropHandlers = {
  onDragEnter: (event: DragEventLike) => void;
  onDragOver: (event: DragEventLike) => void;
  onDragLeave: (event: DragEventLike) => void;
  onDrop: (event: DragEventLike) => void;
};

export function createFileDropHandlers(options: FileDropHandlerOptions): FileDropHandlers {
  const { depth, disabled, multiple, onFiles, onNotice, setDragging } = options;

  const carriesFiles = (event: DragEventLike) => dragCarriesFiles(event.dataTransfer?.types);

  return {
    onDragEnter(event) {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      if (disabled) return;
      depth.current += 1;
      onNotice(null);
      setDragging(true);
    },

    onDragOver(event) {
      if (!carriesFiles(event)) return;
      // 🔴 여기서 막지 않으면 drop 이 아예 오지 않고 브라우저가 파일을 열어 버린다.
      // 꺼져 있어도 막는 까닭이 그것이다 — 못 받는 것과 작성 중이던 내용이 날아가는
      // 것은 다른 일이다.
      event.preventDefault();
      if (!disabled && event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    },

    onDragLeave(event) {
      if (!carriesFiles(event)) return;
      if (disabled) return;
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setDragging(false);
    },

    onDrop(event) {
      if (!carriesFiles(event)) return;
      // 꺼져 있어도 먼저 막는다(위 onDragOver 주석).
      event.preventDefault();
      event.stopPropagation?.();
      depth.current = 0;
      setDragging(false);
      if (disabled) return;

      const plan = planFileDrop(Array.from(event.dataTransfer?.files ?? []), { multiple });
      onNotice(plan.notice);
      if (plan.accepted.length > 0) onFiles(plan.accepted);
    },
  };
}

// ────────────────────────────────────────────────── 창 전체의 기본 동작 막기

/**
 * 떨구는 자리를 **빗나가도** 브라우저가 파일을 열지 않게 한다.
 *
 * 떨구는 자리가 화면에 하나라도 있는 동안만 걸어 둔다 — 여러 자리가 함께 있어도
 * 한 벌만 걸고(세어 둔다), 마지막 자리가 사라질 때 걷는다. 파일이 아닌 끌기
 * (글자 · 화면 안의 조각)에는 손대지 않는다.
 */
export type DropGuardTarget = {
  addEventListener(type: string, listener: (event: DragEventLike) => void): void;
  removeEventListener(type: string, listener: (event: DragEventLike) => void): void;
};

let guardCount = 0;
let guardTarget: DropGuardTarget | null = null;
let guardListener: ((event: DragEventLike) => void) | null = null;

function preventFileDrop(event: DragEventLike): void {
  if (!dragCarriesFiles(event.dataTransfer?.types)) return;
  event.preventDefault();
}

/** 걸고, 걷는 함수를 돌려준다. 두 번 걷어도 한 번만 센다. */
export function installFileDropGuard(target: DropGuardTarget): () => void {
  guardCount += 1;
  if (guardCount === 1) {
    guardTarget = target;
    guardListener = preventFileDrop;
    target.addEventListener("dragover", guardListener);
    target.addEventListener("drop", guardListener);
  }

  let released = false;
  return () => {
    if (released) return;
    released = true;
    guardCount -= 1;
    if (guardCount === 0 && guardTarget && guardListener) {
      guardTarget.removeEventListener("dragover", guardListener);
      guardTarget.removeEventListener("drop", guardListener);
      guardTarget = null;
      guardListener = null;
    }
  };
}
