// 데모 체크섬: 실제 파일 바이트가 아니라 메타데이터 문자열의 SHA-256이다.
// seed-data.ts의 시드 레코드는 useSyncExternalStore의 동기 getSnapshot 안에서
// 생성되어야 하므로(await 불가) 여기와 동일한 알고리즘/문자열 포맷으로 Node의
// crypto.createHash("sha256")를 이용해 빌드 전에 미리 계산한 상수를 쓴다
// (seed-data.ts 주석 참고). 사용자가 화면에서 새로 등록하는 레코드만 이 함수로
// 런타임에 실제 계산한다.

export const DEMO_CHECKSUM_PREFIX = "demo-meta-sha256:";
export const DEMO_CHECKSUM_PATTERN = /^demo-meta-sha256:[0-9a-f]{64}$/;

export function buildChecksumInput(input: {
  id: string;
  originalFileName: string;
  fileSizeBytes: number;
  category: string;
  uploadedAt: string;
}): string {
  return `${input.id}|${input.originalFileName}|${input.fileSizeBytes}|${input.category}|${input.uploadedAt}`;
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function computeDemoChecksum(input: {
  id: string;
  originalFileName: string;
  fileSizeBytes: number;
  category: string;
  uploadedAt: string;
}): Promise<string> {
  const data = new TextEncoder().encode(buildChecksumInput(input));
  const digest = await crypto.subtle.digest("SHA-256", data);
  return `${DEMO_CHECKSUM_PREFIX}${toHex(digest)}`;
}

export function isValidDemoChecksum(value: unknown): value is string {
  return typeof value === "string" && DEMO_CHECKSUM_PATTERN.test(value);
}
