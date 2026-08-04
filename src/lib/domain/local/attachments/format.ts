const UNITS = ["B", "KB", "MB", "GB"] as const;

/** 1024 기준 사람이 읽기 쉬운 크기 문자열("2.1 MB" 등)로 변환한다. */
export function formatFileSizeKorean(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;

  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < UNITS.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const formatted = value >= 100 ? value.toFixed(0) : value.toFixed(1);
  return `${formatted} ${UNITS[unitIndex]}`;
}

export function megabytesToBytes(megabytes: number): number {
  return Math.round(megabytes * 1024 * 1024);
}

export function bytesToMegabytes(bytes: number): number {
  return bytes / (1024 * 1024);
}

export function formatAttachmentDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
