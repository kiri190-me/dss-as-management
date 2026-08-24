/**
 * ============================================================================
 * 사진을 줄여서 내려받기 — 목표를 정하는 규칙과, 실제로 줄이는 일
 * ============================================================================
 * 현장 사진은 한 장에 3~5MB다. 보고서에 붙이거나 메일로 보낼 때는 그대로
 * 쓰기 어렵고, 그렇다고 원본을 지울 수도 없다(원본은 반영구 보관이다).
 * 그래서 **원본은 그대로 두고 내려받을 때만 줄인다.**
 *
 * ── 서버가 아니라 브라우저에서 줄인다 ────────────────────────────────────
 * 서버에서 줄이려면 이미지 처리 라이브러리(sharp 등)가 필요한데, 그것은
 * 네이티브 바이너리라 Docker 컨테이너로 옮길 때 OS별 빌드를 따라다녀야 한다.
 * 이 시스템은 NAS(Linux 컨테이너)로 옮기는 것이 정해져 있어 그 짐을 지지
 * 않기로 했다. 브라우저는 canvas로 같은 일을 할 수 있고 의존성이 0개다.
 *
 * ── 이 파일에서 계산만 떼어 둔 이유 ──────────────────────────────────────
 * 실제로 줄이는 부분은 canvas가 필요해 브라우저에서만 돌지만, **목표 용량을
 * 정하는 규칙**은 순수 계산이라 여기서 따로 검증할 수 있다. 목표를 잘못
 * 계산하면 "50%로 줄였는데 원본보다 크다" 같은 일이 조용히 생긴다.
 * ============================================================================
 */

/** 줄이는 기준 — 원본 대비 비율이거나, 절대 용량이다. */
export type ShrinkTarget =
  | { kind: "ratio"; /** 0보다 크고 1보다 작거나 같다. 0.5면 원본의 절반. */ ratio: number }
  | { kind: "bytes"; /** 한 장당 목표 용량. */ bytes: number };

/** 빠른 선택 버튼에 쓰는 비율. 100%는 "줄이지 않음"이라 넣지 않는다. */
export const SHRINK_RATIO_PRESETS = [0.25, 0.5, 0.75, 0.9] as const;

/** 이 정도보다 작게는 목표를 잡지 않는다 — 사진이 알아볼 수 없게 된다. */
export const MIN_TARGET_BYTES = 20 * 1024;

/**
 * 이 한 장의 목표 용량은 몇 바이트인가.
 *
 * 비율은 **원본 대비**다. 절대 용량은 원본과 무관하게 그 값이다. 다만 원본이
 * 이미 목표보다 작으면 목표를 원본 크기로 낮춘다 — 줄이랬는데 커지는 일이
 * 없어야 한다(JPEG를 다시 인코딩하면 화질만 잃고 커지는 경우가 실제로 있다).
 */
export function resolveTargetBytes(target: ShrinkTarget, originalBytes: number): number {
  const raw = target.kind === "ratio" ? Math.floor(originalBytes * target.ratio) : target.bytes;
  const capped = Math.min(raw, originalBytes);
  return Math.max(capped, MIN_TARGET_BYTES);
}

/**
 * 고른 것들을 줄이면 대략 얼마가 되는가 — 고르자마자 보여 주는 값이다.
 *
 * 실제로 인코딩해 보기 전의 **예상**이다. 비율은 그 비율만큼이라고 보고,
 * 절대 용량은 한 장당 그 값을 넘지 않는다고 본다(상한). 원본이 이미 목표보다
 * 작은 장은 줄지 않으므로 원본 크기로 센다 — 그래서 실제 결과는 이 값보다
 * 작거나 같다.
 */
export function estimateTotalBytes(target: ShrinkTarget, originalSizes: readonly number[]): number {
  return originalSizes.reduce((sum, size) => sum + resolveTargetBytes(target, size), 0);
}

/**
 * 줄인 파일의 이름.
 *
 * 원본 이름을 그대로 쓰면 원본과 줄인 것이 같은 이름으로 섞인다. PNG는 줄일 때
 * JPEG로 바꾸므로(투명 정보가 없어지고 확장자도 달라진다) 확장자까지 바꾼다.
 */
export function shrunkFileName(originalFileName: string, percentLabel: string): string {
  const lastDot = originalFileName.lastIndexOf(".");
  const base = lastDot > 0 ? originalFileName.slice(0, lastDot) : originalFileName;
  return `${base}_${percentLabel}.jpg`;
}

/** 비율을 사람이 읽는 이름으로 — 파일명에 들어간다. */
export function ratioLabel(ratio: number): string {
  return `${Math.round(ratio * 100)}pct`;
}

/** 용량을 사람이 읽는 문자열로. 화면과 이 파일이 같은 규칙을 쓴다. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/**
 * 사람이 적은 목표 용량을 바이트로. 빈 값이나 말이 안 되는 값은 null이다.
 *
 * 화면에서 숫자와 단위를 따로 받으므로 여기서는 곱하기만 한다. 0이나 음수를
 * 통과시키면 목표가 MIN_TARGET_BYTES로 올라가 사용자가 적은 것과 달라진다 —
 * 그 경우 아예 고르지 못하게 하는 편이 낫다.
 */
export function parseTargetBytes(value: string, unit: "KB" | "MB"): number | null {
  const parsed = Number(value.trim());
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  const bytes = Math.floor(parsed * (unit === "KB" ? 1024 : 1024 * 1024));
  return bytes > 0 ? bytes : null;
}
