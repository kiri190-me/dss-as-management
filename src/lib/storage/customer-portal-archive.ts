import "server-only";

import { randomUUID } from "node:crypto";
import { open, readdir, readFile, rename, stat, unlink } from "node:fs/promises";
import path from "node:path";

import {
  parsePortalExportFileName,
  pickLatestPortalExportFile,
  type CustomerPortalExportSpec,
  type ParsedPortalExportFileName,
  type PortalExportFolderEntry,
} from "@/lib/domain/customer-portal-export";

/**
 * ============================================================================
 * 「업체별 수리품현황」 공유폴더 — 직전 파일을 읽고, 오늘 이름으로 쓴다
 * ============================================================================
 * 폴더 하나뿐이다(연도 폴더 · 건별 폴더가 없다). 그 안에 고객사마다 파일 하나가
 * 있고 이름 끝이 만든 날짜다. 옛 판은 사람이 `OLD` 하위 폴더로 옮긴다 — 우리는
 * **맨 위 칸만** 본다(하위 폴더로 내려가지 않는다).
 *
 * ── 견적서 공유폴더(storage/quote-archive.ts)와 무엇이 같고 다른가 ────────
 * 같은 것: 루트를 만들지 않는다 · 같은 내용이면 새로 쓰지 않는다 · 던지지 않고
 * `{ status: "failed", reason }` 으로 돌아간다 · 사유에 경로와 설정값을 담지 않는다.
 * 다른 것: **설정이 따로다**(`CUSTOMER_PORTAL_ARCHIVE_DIR`) · 🔴 **덮어쓴다**(아래).
 * 견적서 쪽은 지금까지 그대로 ` (2)` 로 넘어간다 — 그 코드는 한 글자도 건드리지 않는다.
 *
 * ── 🔴 같은 이름이 있으면 덮어쓴다 (사용자 결정 2026-09-30) ────────────────
 * 같은 날 두 번 내보내면 이름이 겹친다. 예전에는 ` (2)`, ` (3)` … 으로 넘어갔는데,
 * 사람이 「같은 제목의 엑셀이 있다면 덮어씌워 달라」고 정했다 — 그 고객사의 오늘 파일은
 * **하나**여야 한다.
 * 🔴 덮어쓰면 사람이 그 파일을 손으로 고쳐 둔 내용이 사라진다. 그래서 돌려주는 값이
 * 「새로 만듦(`saved`)」과 「덮어씀(`replaced`)」을 **가른다** — 화면이 그 둘을 다른
 * 문장으로 말한다(actions/customer-portal-export.ts). 조용히 덮어쓰지 않는다.
 * 다만 **바이트가 똑같으면** 손대지 않고 그 파일을 가리킨다(`unchanged`) — 미리보기
 * 뒤 저장을 두 번 눌러도 수정 시각만 흔들리지 않게.
 * 이미 만들어져 있는 옛 ` (2)` 파일은 **그대로 둔다**(지우지 않는다). 그 파일도 다음 날
 * 직전 파일 후보로 그대로 뽑힌다(domain 의 parsePortalExportFileName 이 번호까지 읽는다).
 *
 * ── 🔴 반쯤 쓰인 파일이 제 이름을 얻지 않게 ───────────────────────────────
 * 덮어쓰기는 **바꿔치기**다: 같은 폴더의 임시 이름(`~$…tmp`)에 다 쓴 뒤 `rename` 으로
 * 제 이름에 밀어 넣는다. 쓰다가 끊기면(공간 부족 · 연결 끊김) 임시 파일만 지우고 끝나므로
 * **있던 파일은 한 글자도 바뀌지 않는다.** 예전처럼 제 이름으로 바로 열어 쓰면 그 순간
 * 파일이 비워지고, 거기서 끊기면 고객사에 보낼 현황표가 반쪽으로 남는다.
 * 임시 이름을 `~$` 로 시작하고 끝을 `.xlsx` 가 아니게 두는 까닭: 어쩌다 남더라도 직전 파일
 * 고르기가 그것을 보지 않는다(parsePortalExportFileName 이 `~$` 와 다른 확장자를 버린다).
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
  /** 그 이름의 파일이 없어 **새로 만들었다.** */
  | { status: "saved"; fileName: string }
  /** 🔴 같은 이름의 파일이 있어 **덮어썼다.** 사람이 손으로 고쳐 둔 내용은 사라졌다. */
  | { status: "replaced"; fileName: string }
  /** 같은 바이트의 파일이 이미 있어 손대지 않았다. */
  | { status: "unchanged"; fileName: string }
  | { status: "failed"; reason: string };

/**
 * 만든 파일을 **오늘 이름으로** 저장한다. 던지지 않는다.
 * 같은 이름이 있으면 덮어쓰고, 그 사실을 `replaced` 로 알린다(머리말).
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

    const existing = await inspectTarget(root, input.fileName, input.bytes);
    if (existing === "same") return { status: "unchanged", fileName: input.fileName };

    await replaceThroughTemporaryFile(root, input.fileName, input.bytes);
    return { status: existing === "absent" ? "saved" : "replaced", fileName: input.fileName };
  } catch (error) {
    return {
      status: "failed",
      reason: error instanceof PortalArchiveFailure ? error.reason : reasonFromWriteError(error),
    };
  }
}

/**
 * 그 이름의 자리에 지금 무엇이 있는가 — 없는가(`absent`) · 같은 바이트인가(`same`) ·
 * 다른 것이 있는가(`different`).
 *
 * 크기가 같을 때만 읽어 맞춘다. **읽지 못하면**(엑셀이 열어 둔 파일 · 권한) 「다르다」로 친다 —
 * 덮어쓰는 쪽으로 틀린다. 지금 만든 것이 정본이기 때문이다.
 * 🔴 다만 stat 자체가 권한 · 연결 문제로 막히면 **던진다.** 자리에 무엇이 있는지도 모르는 채
 * 밀어붙이면 「새로 만들었습니다」라고 거짓말하면서 남의 파일을 지울 수 있다.
 */
async function inspectTarget(
  root: string,
  fileName: string,
  bytes: Uint8Array
): Promise<"absent" | "same" | "different"> {
  const target = path.join(root, fileName);
  assertInsideRoot(root, target);

  let info;
  try {
    info = await stat(target);
  } catch (error) {
    const code = errorCode(error);
    if (code === "ENOENT" || code === "ENOTDIR") return "absent";
    throw error;
  }

  // 파일이 아니면(같은 이름의 폴더가 자리를 차지하고 있다) 바꿔치기가 거절한다 — 여기서
  // 「다르다」로 두고 rename 이 울게 한다. 폴더를 지우는 일은 하지 않는다.
  if (!info.isFile() || info.size !== bytes.byteLength) return "different";
  try {
    return (await readFile(target)).equals(Buffer.from(bytes)) ? "same" : "different";
  } catch {
    return "different";
  }
}

/**
 * 같은 폴더의 임시 이름에 다 쓴 뒤 `rename` 으로 제 이름에 밀어 넣는다(머리말 「반쯤 쓰인
 * 파일이 제 이름을 얻지 않게」). 같은 폴더라 바꿔치기가 한 걸음이다 — 다른 디스크로 옮기면
 * 그 자체가 복사가 되어 뜻이 사라진다.
 *
 * 어디서 실패하든 **임시 파일만 지우고** 던진다. 있던 파일은 손대지 않았으므로 그대로 남는다.
 */
async function replaceThroughTemporaryFile(root: string, fileName: string, bytes: Uint8Array): Promise<void> {
  const target = path.join(root, fileName);
  assertInsideRoot(root, target);
  // 이름이 겹치지 않게 UUID 로 — 두 사람이 같은 순간에 저장해도 서로의 임시 파일을 밟지 않는다.
  const temporary = path.join(root, `~$dss-portal-${randomUUID()}.tmp`);
  assertInsideRoot(root, temporary);

  // `wx` — 있으면 실패한다(우리가 만든 이름이 아니면 건드리지 않는다).
  const handle = await open(temporary, "wx");
  try {
    await handle.writeFile(bytes);
    // 디스크에 밀어 넣은 뒤 바꿔치기한다. 못 해도(공유폴더가 받지 않는 경우가 있다) 그냥 간다 —
    // 여기서 던지면 다 쓴 파일을 버리게 된다.
    await handle.sync().catch(() => undefined);
    await handle.close();
  } catch (error) {
    await handle.close().catch(() => undefined);
    await unlink(temporary).catch(() => undefined);
    throw error;
  }

  try {
    await rename(temporary, target);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
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
