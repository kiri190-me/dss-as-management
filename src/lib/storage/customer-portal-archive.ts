import "server-only";

import { open, readdir, readFile, stat, unlink } from "node:fs/promises";
import path from "node:path";

import {
  numberedPortalExportFileName,
  parsePortalExportFileName,
  pickLatestPortalExportFile,
  PORTAL_EXPORT_MAX_NUMBERED_COPIES,
  type CustomerPortalExportSpec,
  type ParsedPortalExportFileName,
  type PortalExportFolderEntry,
} from "@/lib/domain/customer-portal-export";

/**
 * ============================================================================
 * 「업체별 수리품현황」 공유폴더 — 직전 파일을 읽고, 새 이름으로 **새로** 쓴다
 * ============================================================================
 * 폴더 하나뿐이다(연도 폴더 · 건별 폴더가 없다). 그 안에 고객사마다 파일 하나가
 * 있고 이름 끝이 만든 날짜다. 옛 판은 사람이 `OLD` 하위 폴더로 옮긴다 — 우리는
 * **맨 위 칸만** 본다(하위 폴더로 내려가지 않는다).
 *
 * ── 견적서 공유폴더(storage/quote-archive.ts)와 무엇이 같고 다른가 ────────
 * 같은 것: 루트를 만들지 않는다 · 덮어쓰지 않는다(`wx`) · 같은 내용이면 새로 쓰지
 * 않는다 · 던지지 않고 `{ status: "failed", reason }` 으로 돌아간다 · 사유에 경로와
 * 설정값을 담지 않는다.
 * 다른 것: **설정이 따로다**(`CUSTOMER_PORTAL_ARCHIVE_DIR`). 견적서 폴더와 다른 곳을
 * 가리키고, 견적서 쪽 코드는 한 글자도 건드리지 않는다.
 *
 * ── 🔴 덮어쓰지 않는다 ──────────────────────────────────────────────────
 * 같은 날 두 번 내보내면 이름이 겹친다. 그때 덮어쓰지 않고 ` (2)`, ` (3)` … 으로
 * 넘어간다. 사람이 이미 고객사에 보낸 파일을 우리가 조용히 바꾸는 일이 없어야 한다.
 * 다만 **바이트가 똑같으면** 새로 쓰지 않고 그 파일을 가리킨다(`unchanged`) — 미리보기
 * 뒤 저장을 두 번 눌러도 사본이 쌓이지 않게. 그 ` (2)` 파일도 다음 날 직전 파일로
 * 뽑힌다(domain 의 parsePortalExportFileName 이 번호까지 읽는다).
 * ============================================================================
 */

/** 파일 하나를 읽어 들이는 상한 — 실측 파일은 171KB 다. 폭주 방지다. */
export const PORTAL_EXPORT_MAX_FILE_BYTES = 32 * 1024 * 1024;

/**
 * 공유폴더 루트. `CUSTOMER_PORTAL_ARCHIVE_DIR` 을 **부르는 시점에** 읽는다.
 * 비었거나 공백이면 null(= 이 기능이 꺼져 있다). 값 자체는 로그로 찍지 않는다.
 */
export function resolveCustomerPortalArchiveRoot(): string | null {
  const configured = process.env.CUSTOMER_PORTAL_ARCHIVE_DIR;
  if (!configured || configured.trim().length === 0) return null;
  return path.resolve(configured.trim());
}

class PortalArchiveFailure extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = "PortalArchiveFailure";
  }
}

export type PortalArchiveLatestFile =
  | { status: "found"; fileName: string; parsed: ParsedPortalExportFileName; bytes: Buffer }
  /** 🔴 이름 규칙에 맞는 파일이 하나도 없다 — **만들지 않는다.** 사람에게 알린다. */
  | { status: "not-found" }
  | { status: "failed"; reason: string };

/**
 * 그 고객사의 **직전 파일**을 찾아 읽는다. 던지지 않는다.
 * 고르는 규칙과 근거는 domain/customer-portal-export.ts 의 pickLatestPortalExportFile.
 */
export async function findLatestPortalExportFile(input: {
  root: string;
  spec: CustomerPortalExportSpec;
}): Promise<PortalArchiveLatestFile> {
  try {
    const root = await requireExistingRoot(input.root);
    const entries = await listFolderEntries(root);
    const latest = pickLatestPortalExportFile(input.spec, entries);
    if (latest === null) return { status: "not-found" };

    const target = path.join(root, latest.entry.fileName);
    assertInsideRoot(root, target);
    const info = await stat(target);
    if (!info.isFile()) return { status: "not-found" };
    if (info.size > PORTAL_EXPORT_MAX_FILE_BYTES) {
      throw new PortalArchiveFailure("직전 파일이 너무 커서 읽지 않았습니다.");
    }
    return {
      status: "found",
      fileName: latest.entry.fileName,
      parsed: latest.parsed,
      bytes: await readFile(target),
    };
  } catch (error) {
    return {
      status: "failed",
      reason: error instanceof PortalArchiveFailure ? error.reason : reasonFromReadError(error),
    };
  }
}

/** 맨 위 칸의 **파일만**. 하위 폴더(`OLD`)와 링크는 보지 않는다. */
async function listFolderEntries(root: string): Promise<PortalExportFolderEntry[]> {
  const dirents = await readdir(root, { withFileTypes: true });
  const entries: PortalExportFolderEntry[] = [];
  for (const dirent of dirents) {
    if (!dirent.isFile()) continue;
    if (parsePortalExportFileName(dirent.name) === null) continue;
    let modifiedAtMs = 0;
    try {
      modifiedAtMs = (await stat(path.join(root, dirent.name))).mtimeMs;
    } catch {
      // 수정 시각을 못 읽어도 이름의 날짜로 고를 수 있다 — 곁가지 기준일 뿐이다.
    }
    entries.push({ fileName: dirent.name, modifiedAtMs });
  }
  return entries;
}

export type PortalArchiveSaveResult =
  | { status: "saved"; fileName: string }
  /** 같은 바이트의 파일이 이미 있어 새로 쓰지 않았다. */
  | { status: "unchanged"; fileName: string }
  | { status: "failed"; reason: string };

/**
 * 만든 파일을 **새 이름으로** 저장한다. 던지지 않는다.
 * 덮어쓰지 않는다 — 있으면 ` (2)`, ` (3)` … 으로 넘어간다(머리말).
 */
export async function savePortalExportFile(input: {
  root: string;
  fileName: string;
  bytes: Uint8Array;
}): Promise<PortalArchiveSaveResult> {
  try {
    const root = await requireExistingRoot(input.root);
    if (parsePortalExportFileName(input.fileName) === null) {
      throw new PortalArchiveFailure("저장할 파일 이름을 만들지 못했습니다.");
    }

    const same = await findSameContentFile(root, input.fileName, input.bytes);
    if (same !== null) return { status: "unchanged", fileName: same };

    return { status: "saved", fileName: await writeNewFile(root, input.fileName, input.bytes) };
  } catch (error) {
    return {
      status: "failed",
      reason: error instanceof PortalArchiveFailure ? error.reason : reasonFromWriteError(error),
    };
  }
}

/** 이번 이름의 후보들 가운데 **같은 바이트**의 파일. 없으면 null. */
async function findSameContentFile(
  root: string,
  fileName: string,
  bytes: Uint8Array
): Promise<string | null> {
  const dirents = await readdir(root, { withFileTypes: true });
  const files = new Set(dirents.filter((dirent) => dirent.isFile()).map((dirent) => dirent.name));
  for (let number = 1; number <= PORTAL_EXPORT_MAX_NUMBERED_COPIES; number += 1) {
    const candidate = numberedPortalExportFileName(fileName, number);
    if (!files.has(candidate)) continue;
    const target = path.join(root, candidate);
    assertInsideRoot(root, target);
    if (await hasSameBytes(target, bytes)) return candidate;
  }
  return null;
}

/** 크기가 같을 때만 읽어 맞춘다. 못 읽으면 「같지 않음」 — 새로 쓰는 쪽으로 틀린다. */
async function hasSameBytes(target: string, bytes: Uint8Array): Promise<boolean> {
  try {
    const info = await stat(target);
    if (!info.isFile() || info.size !== bytes.byteLength) return false;
    return (await readFile(target)).equals(Buffer.from(bytes));
  } catch {
    return false;
  }
}

/**
 * `wx` 로만 연다 — 있으면 다음 번호. 쓰다 실패하면 **방금 만든 그 파일만** 지운다
 * (반쯤 쓰인 현황표를 남기지 않는다).
 */
async function writeNewFile(root: string, fileName: string, bytes: Uint8Array): Promise<string> {
  for (let number = 1; number <= PORTAL_EXPORT_MAX_NUMBERED_COPIES; number += 1) {
    const candidate = numberedPortalExportFileName(fileName, number);
    const target = path.join(root, candidate);
    assertInsideRoot(root, target);

    let handle;
    try {
      handle = await open(target, "wx");
    } catch (error) {
      if (errorCode(error) === "EEXIST") continue;
      throw error;
    }

    try {
      await handle.writeFile(bytes);
      await handle.close();
    } catch (error) {
      await handle.close().catch(() => undefined);
      await unlink(target).catch(() => undefined);
      throw error;
    }
    return candidate;
  }
  throw new PortalArchiveFailure(
    `같은 이름의 파일이 너무 많습니다(${PORTAL_EXPORT_MAX_NUMBERED_COPIES}개). 공유폴더를 정리한 뒤 다시 시도하세요.`
  );
}

/** 루트는 이미 있는 폴더여야 한다 — 없으면 만들지 않고 실패한다. */
async function requireExistingRoot(rawRoot: string): Promise<string> {
  if (typeof rawRoot !== "string" || rawRoot.trim().length === 0) {
    throw new PortalArchiveFailure("공유폴더 위치가 설정되지 않았습니다.");
  }
  const root = path.resolve(rawRoot.trim());
  let info;
  try {
    info = await stat(root);
  } catch (error) {
    const code = errorCode(error);
    if (code === "EACCES" || code === "EPERM") {
      throw new PortalArchiveFailure("공유폴더에 접근할 권한이 없습니다.");
    }
    if (code === "ENOENT" || code === "ENOTDIR") {
      throw new PortalArchiveFailure("공유폴더를 찾을 수 없습니다(연결이 끊겼을 수 있습니다).");
    }
    throw error;
  }
  if (!info.isDirectory()) {
    throw new PortalArchiveFailure("공유폴더를 찾을 수 없습니다(폴더가 아닙니다).");
  }
  return root;
}

/** 이은 경로가 루트 밖이면 거절한다. 이름을 다듬으므로 일어나지 않아야 하는 방어다. */
function assertInsideRoot(root: string, target: string): void {
  const relative = path.relative(root, target);
  if (
    relative === "" ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new PortalArchiveFailure("저장 위치가 공유폴더 밖을 가리켜 저장하지 않았습니다.");
  }
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

/** 🔴 오류의 message 는 쓰지 않는다 — 경로가 들어 있다. 코드만 보고 짧은 문장으로. */
function reasonFromReadError(error: unknown): string {
  switch (errorCode(error)) {
    case "EACCES":
    case "EPERM":
      return "공유폴더를 읽을 권한이 없습니다.";
    case "ENOENT":
    case "ENOTDIR":
      return "공유폴더의 파일을 찾을 수 없습니다(읽는 중 옮겨졌을 수 있습니다).";
    case "EIO":
    case "ETIMEDOUT":
    case "EHOSTDOWN":
    case "EHOSTUNREACH":
    case "ENETUNREACH":
    case "ECONNRESET":
      return "공유폴더에 연결할 수 없습니다(네트워크 · NAS 상태를 확인하세요).";
    default:
      return "공유폴더를 읽지 못했습니다.";
  }
}

function reasonFromWriteError(error: unknown): string {
  switch (errorCode(error)) {
    case "EACCES":
    case "EPERM":
      return "공유폴더에 쓸 권한이 없습니다.";
    case "ENOENT":
    case "ENOTDIR":
      return "공유폴더를 찾을 수 없습니다(저장 중 옮겨졌거나 연결이 끊겼을 수 있습니다).";
    case "ENOSPC":
    case "EDQUOT":
      return "공유폴더에 남은 공간이 없습니다.";
    case "ENAMETOOLONG":
      return "파일 이름이나 경로가 너무 깁니다.";
    case "EROFS":
      return "공유폴더가 읽기 전용입니다.";
    case "EBUSY":
      return "공유폴더의 파일이 사용 중이라 저장하지 못했습니다.";
    case "EIO":
    case "ETIMEDOUT":
    case "EHOSTDOWN":
    case "EHOSTUNREACH":
    case "ENETUNREACH":
    case "ECONNRESET":
      return "공유폴더에 연결할 수 없습니다(네트워크 · NAS 상태를 확인하세요).";
    default:
      return "공유폴더에 저장하지 못했습니다.";
  }
}
