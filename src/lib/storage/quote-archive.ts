import "server-only";

import { mkdir, open, readdir, stat, unlink } from "node:fs/promises";
import path from "node:path";

import {
  isQuoteArchiveYearFolder,
  matchesQuoteArchiveFolder,
  normalizeQuoteArchiveNameForCompare,
  numberedQuoteArchiveName,
  quoteArchiveFileName,
  quoteArchiveFolderName,
  quoteArchiveSignedPdfFileName,
  quoteArchiveYearFolderName,
  quoteArchiveYearFromDate,
  type QuoteArchiveNamingInput,
} from "@/lib/domain/quote-archive-naming";
import type { QuoteFileExtension } from "@/lib/domain/quote-file-name";

/**
 * ============================================================================
 * 사내 공유폴더에 견적서 파일을 저장한다 — 덮어쓰지 않고, 정해진 자리에
 * ============================================================================
 * 이름 규칙은 domain/quote-archive-naming.ts 가 정한다. 이 모듈은 그 이름으로
 * 폴더를 찾거나 만들고 파일을 **새로** 쓴다.
 *
 *   <루트>/<연도 폴더>/<견적서 폴더>/<파일>
 *
 * ── 「UUID 파일명」 규칙의 의도된 예외 ─────────────────────────────────────
 * 앱 저장소(UPLOADS_DIR)의 디스크 이름은 첨부 ID 다. 이 공유폴더는 사람이 수년째
 * 손으로 쓰고 탐색기 · 엑셀로 여는 폴더라, 사람이 읽는 이름(한글 · 공백)을 쓴다.
 * 이 폴더는 앱의 데이터가 아니라 **사람의 서류함에 사본을 꽂아 주는 것**이다 —
 * DB 에는 이 경로를 적지 않는다.
 *
 * ── 루트는 만들지 않는다 ─────────────────────────────────────────────────
 * 운영에서는 공유폴더를 컨테이너에 연결(마운트)해 쓴다. 연결이 빠진 채 루트를
 * 만들면 컨테이너 안 임시 디스크에 저장하고 「저장했습니다」라고 거짓말하게 된다.
 * 루트가 없거나 폴더가 아니면 `failed` 다. 연도 폴더 · 견적서 폴더만 만든다.
 *
 * ── 덮어쓰지 않는다 ─────────────────────────────────────────────────────
 * 파일은 `open(…, "wx")` 로만 연다 — 이미 있으면 `EEXIST` 로 실패하고 다음 번호
 * ` (2)`, ` (3)` … 로 넘어간다. 존재 확인과 쓰기 사이의 틈이 없으므로 두 사람이 동시에
 * 저장해도 서로 덮지 않는다. 폴더 만들기도 같은 이유로 `EEXIST` 면 다시 찾는다.
 *
 * ── 던지지 않는다 ───────────────────────────────────────────────────────
 * 모든 오류는 `{ status: "failed", reason }` 으로 돌아간다. `reason` 은 화면 · 응답
 * 헤더로 나가므로 **절대 경로 · 루트 값을 담지 않는다**(fs 오류의 message 에는 경로가
 * 들어 있으므로 쓰지 않는다 — 오류 코드만 보고 짧은 한국어로 바꾼다).
 * ============================================================================
 */

/** 같은 이름이 있을 때 붙이는 번호의 상한. 넘으면 사람이 폴더를 정리해야 한다. */
export const QUOTE_ARCHIVE_MAX_NUMBERED_COPIES = 99;

/**
 * 공유폴더 루트. `QUOTE_ARCHIVE_DIR` 을 **부르는 시점에** 읽는다 — 모듈을 불러오는
 * 것만으로 값이 굳지 않게. 비었거나 공백이면 null(= 공유폴더 저장 기능이 꺼져 있다).
 *
 * 값 자체를 로그로 찍지 않는다(보안 규칙: .env 내용은 출력하지 않는다).
 */
export function resolveQuoteArchiveRoot(): string | null {
  const configured = process.env.QUOTE_ARCHIVE_DIR;
  if (!configured || configured.trim().length === 0) return null;
  return path.resolve(configured.trim());
}

export type QuoteArchiveFileKind = "QUOTE_FILE" | "SIGNED_PDF";

export type SaveToQuoteArchiveInput = {
  /** 공유폴더 루트(resolveQuoteArchiveRoot 의 값, 시험에서는 임시 폴더). 이미 있어야 한다. */
  root: string;
  /** 발행일자 `"YYYY-MM-DD"` — 연도 폴더를 정한다. */
  quoteDate: string;
  naming: QuoteArchiveNamingInput;
  bytes: Uint8Array;
} & (
  | { fileKind: "QUOTE_FILE"; extension: QuoteFileExtension }
  /** 결재 PDF 는 확장자가 늘 pdf 다. */
  | { fileKind: "SIGNED_PDF"; extension?: "pdf" }
);

export type QuoteArchiveSaveResult =
  | {
      status: "saved";
      /** 루트 기준 슬래시 경로 — `21. 2026 내자견적서/…/….xlsx`. 디스크의 실제 폴더 이름이다. */
      relativePath: string;
      /** 맞는 연도 폴더나 견적서 폴더가 둘 이상이어서 이름순 첫째를 골랐다 — 사람이 확인할 일. */
      multipleFolderMatches: boolean;
    }
  | { status: "failed"; reason: string };

/** 사람이 읽는 실패 사유를 들고 나오는 내부 오류. 밖으로 던지지 않는다. */
class QuoteArchiveFailure extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = "QuoteArchiveFailure";
  }
}

/**
 * 견적서 파일 하나를 공유폴더에 새로 저장한다. **던지지 않는다.**
 * (기능이 꺼졌는지는 부르는 쪽이 resolveQuoteArchiveRoot() === null 로 판단한다 —
 * 이 함수는 루트가 주어졌다고 가정한다.)
 */
export async function saveToQuoteArchive(input: SaveToQuoteArchiveInput): Promise<QuoteArchiveSaveResult> {
  try {
    return await save(input);
  } catch (error) {
    return {
      status: "failed",
      reason: error instanceof QuoteArchiveFailure ? error.reason : reasonFromFsError(error),
    };
  }
}

async function save(input: SaveToQuoteArchiveInput): Promise<QuoteArchiveSaveResult> {
  const year = quoteArchiveYearFromDate(input.quoteDate);
  if (year === null) {
    throw new QuoteArchiveFailure("발행일자가 올바르지 않아 연도 폴더를 정할 수 없습니다.");
  }

  let yearFolderName: string;
  let quoteFolderName: string;
  let fileName: string;
  try {
    yearFolderName = quoteArchiveYearFolderName(year);
    quoteFolderName = quoteArchiveFolderName(input.naming);
    fileName =
      input.fileKind === "SIGNED_PDF"
        ? quoteArchiveSignedPdfFileName(input.naming)
        : quoteArchiveFileName(input.naming, { extension: input.extension });
  } catch {
    throw new QuoteArchiveFailure("견적서 정보로 파일 이름을 만들 수 없습니다(발행번호 · 파일 형식을 확인하세요).");
  }

  const root = await requireExistingRoot(input.root);

  const yearFolder = await findOrCreateFolder(
    root,
    root,
    (name) => isQuoteArchiveYearFolder(name, year),
    yearFolderName
  );
  // 이을 때는 디스크의 실제 이름을 쓴다 — 다듬은 이름으로 이으면 없는 폴더가 된다.
  const yearDirectory = path.join(root, yearFolder.name);

  const quoteFolder = await findOrCreateFolder(
    root,
    yearDirectory,
    (name) => matchesQuoteArchiveFolder(name, input.naming.quoteNumber),
    quoteFolderName
  );
  const quoteDirectory = path.join(yearDirectory, quoteFolder.name);

  const savedName = await writeNewFile(root, quoteDirectory, fileName, input.bytes);

  return {
    status: "saved",
    // 루트 기준, 구분자는 슬래시 — OS 와 무관하게 같은 값이 나오도록 문자열로 잇는다.
    relativePath: [yearFolder.name, quoteFolder.name, savedName].join("/"),
    multipleFolderMatches: yearFolder.multiple || quoteFolder.multiple,
  };
}

/** 루트는 이미 있는 폴더여야 한다 — 없으면 만들지 않고 실패한다(머리말 「루트는 만들지 않는다」). */
async function requireExistingRoot(rawRoot: string): Promise<string> {
  if (typeof rawRoot !== "string" || rawRoot.trim().length === 0) {
    throw new QuoteArchiveFailure("공유폴더 위치가 설정되지 않았습니다.");
  }
  const root = path.resolve(rawRoot.trim());
  let info;
  try {
    info = await stat(root);
  } catch (error) {
    const code = errorCode(error);
    if (code === "EACCES" || code === "EPERM") {
      throw new QuoteArchiveFailure("공유폴더에 접근할 권한이 없습니다.");
    }
    if (code === "ENOENT" || code === "ENOTDIR") {
      throw new QuoteArchiveFailure("공유폴더를 찾을 수 없습니다(연결이 끊겼을 수 있습니다).");
    }
    throw error;
  }
  if (!info.isDirectory()) {
    throw new QuoteArchiveFailure("공유폴더를 찾을 수 없습니다(폴더가 아닙니다).");
  }
  return root;
}

type FolderPick = { name: string; multiple: boolean };

/**
 * 부모 폴더 안에서 맞는 폴더를 찾는다 — `isDirectory()` 만 본다. readdir 의
 * withFileTypes 는 링크를 따라가지 않으므로 심볼릭 링크는 폴더로 치지 않는다.
 * 여럿이면 이름순 첫째(다듬은 이름으로 비교하고, 같으면 실제 이름으로).
 */
async function findFolder(parent: string, matches: (name: string) => boolean): Promise<FolderPick | null> {
  const entries = await readdir(parent, { withFileTypes: true });
  const names = entries
    .filter((entry) => entry.isDirectory() && matches(entry.name))
    .map((entry) => entry.name)
    .sort(compareFolderNames);
  if (names.length === 0) return null;
  return { name: names[0], multiple: names.length > 1 };
}

function compareFolderNames(a: string, b: string): number {
  const left = normalizeQuoteArchiveNameForCompare(a);
  const right = normalizeQuoteArchiveNameForCompare(b);
  if (left !== right) return left < right ? -1 : 1;
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/**
 * 맞는 폴더가 있으면 그것, 없으면 새 이름으로 만든다. 만들다가 `EEXIST` 면(두 사람이
 * 동시에) 다시 찾아서 그것을 쓴다. 다시 찾아도 없으면 같은 이름의 **파일**이 자리를
 * 차지하고 있는 것이다.
 */
async function findOrCreateFolder(
  root: string,
  parent: string,
  matches: (name: string) => boolean,
  newName: string
): Promise<FolderPick> {
  const found = await findFolder(parent, matches);
  if (found) {
    assertInsideRoot(root, path.join(parent, found.name));
    return found;
  }

  const target = path.join(parent, newName);
  assertInsideRoot(root, target);
  try {
    // recursive 없이 — 부모(결국 루트)가 없으면 만들지 않고 실패해야 한다.
    await mkdir(target);
    return { name: newName, multiple: false };
  } catch (error) {
    if (errorCode(error) !== "EEXIST") throw error;
  }

  const again = await findFolder(parent, matches);
  if (again) {
    assertInsideRoot(root, path.join(parent, again.name));
    return again;
  }
  throw new QuoteArchiveFailure("같은 이름의 파일이 자리를 차지하고 있어 폴더를 만들 수 없습니다.");
}

/**
 * 파일을 새로 쓴다. `wx` 로만 연다 — 있으면 다음 번호. 열고 나서 쓰다 실패하면
 * **방금 만든 그 파일만** 지운다(반쯤 쓰인 견적서를 남기지 않는다).
 */
async function writeNewFile(root: string, directory: string, fileName: string, bytes: Uint8Array): Promise<string> {
  for (let n = 1; n <= QUOTE_ARCHIVE_MAX_NUMBERED_COPIES; n += 1) {
    const candidate = numberedQuoteArchiveName(fileName, n);
    const target = path.join(directory, candidate);
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
  throw new QuoteArchiveFailure(
    `같은 이름의 파일이 너무 많습니다(${QUOTE_ARCHIVE_MAX_NUMBERED_COPIES}개). 견적서 폴더를 정리한 뒤 다시 시도하세요.`
  );
}

/**
 * 이은 경로가 루트 밖이면 거절한다. 이름을 다듬으므로 일어나지 않아야 하지만,
 * 디스크의 이름을 그대로 잇는 자리가 있어 방어로 둔다.
 */
function assertInsideRoot(root: string, target: string): void {
  const relative = path.relative(root, target);
  if (
    relative === "" ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new QuoteArchiveFailure("저장 위치가 공유폴더 밖을 가리켜 저장하지 않았습니다.");
  }
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

/** fs 오류 → 사람이 읽는 짧은 사유. **오류의 message 는 쓰지 않는다**(경로가 들어 있다). */
function reasonFromFsError(error: unknown): string {
  switch (errorCode(error)) {
    case "EACCES":
    case "EPERM":
      return "공유폴더에 쓸 권한이 없습니다.";
    case "ENOENT":
    case "ENOTDIR":
      return "공유폴더의 폴더를 찾을 수 없습니다(저장 중 옮겨졌거나 연결이 끊겼을 수 있습니다).";
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
