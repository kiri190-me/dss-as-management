import "./load-env";

import { createHash } from "node:crypto";
import { constants as fsConstants, createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

import { pgClient } from "../src/lib/db/connection";
import {
  assertPortableStoredPath,
  resolveAttachmentAbsolutePath,
} from "../src/lib/domain/attachment-path";
import {
  findMissingFromBackup,
  isDestinationInsideSource,
  normalizeRelativePathKey,
  planCopies,
  shouldExcludeFromBackup,
} from "./lib/attachment-backup-plan";

/**
 * ============================================================================
 * 사진 백업 — 첨부 파일을 복사하고, 복사본이 온전한지 DB와 대조한다
 * ============================================================================
 *
 * `npm run backup:attachments [-- --dest <경로>] [-- --dry-run]`
 *
 * ── 왜 사진만 따로 뜨는가 ────────────────────────────────────────────────
 * DB는 end-work.ps1이 매일 뜬다. 그런데 사진은 DB 안에 없다 — 디스크에 있고,
 * 파일명은 첨부 ID(UUID)다. 그 이름만으로는 어느 건의 무슨 사진인지 알 수 없고,
 * 원본 파일명·분류·설명은 attachments 표에만 있다. **둘은 한 쌍이라야 쓸모가
 * 있다.** 그래서 이 스크립트는 end-work.ps1의 DB 백업 바로 뒤에 붙어 있고,
 * DB 백업이 성공한 날에만 돈다.
 *
 * 순서도 DB가 먼저다. 업로드 코드는 파일을 **먼저** 최종 자리에 놓고
 * (attachments/route.ts의 storage.commit) DB 기록을 **나중에** 남긴다. 그래서
 * 먼저 뜬 덤프에 적힌 사진은 이미 디스크에 있어 반드시 복사된다. 반대로 하면
 * "목록에는 있는데 파일이 없는" 사진이 생긴다.
 *
 * ── 검증은 원본이 아니라 DB와 대조한다 ──────────────────────────────────
 * 복사본을 원본과 견주면 원본이 이미 상한 경우를 못 잡는다 — 상한 것을 그대로
 * 복사해 놓고 "같으니 성공"이라고 답한다. attachments 표에는 올린 그 순간의
 * SHA-256 지문(checksum_sha256)이 남아 있으므로, 복사본을 그 지문과 맞대어
 * 본다. 파일이 언제 상했든 그 시점 이후라면 전부 걸린다.
 *
 * 미리보기(preview_path)에는 지문이 없다. 있는지와 원본과 크기가 같은지만 본다.
 *
 * ── 삭제된 첨부도 백업한다 ──────────────────────────────────────────────
 * `is_deleted = true`는 휴지통에 있다는 뜻이고 휴지통 건은 **되살릴 수 있다.**
 * 그래서 아래 조회에는 조건절이 없다. 필터를 걸면 되살릴 수 있는 것을 백업에서
 * 빠뜨린다.
 *
 * ── 이 스크립트가 하지 않는 일 ───────────────────────────────────────────
 * **아무것도 지우지 않는다.** 원본에서 사라진 파일을 백업에서도 지우는 코드는
 * 여기에 한 줄도 없다 — 그렇게 만들면 실수로 지운 파일이나 앱 버그로 사라진
 * 파일까지 백업에서 따라 사라져, 정작 필요할 때 백업이 비어 있게 된다.
 * **DB에도 쓰지 않는다.** SELECT 하나뿐이다.
 * ============================================================================
 */

/** BACKUPS_DIR도 없을 때 쓰는 자리. .env.example의 값과 같다. */
const FALLBACK_DEST_ROOT = "C:\\DSS-AS-DATA\\backups\\uploads";

/** 연습 모드에서 복사 계획을 몇 줄까지 보여 줄 것인가. */
const DRY_RUN_PREVIEW_LINES = 8;

type AttachmentRow = {
  id: string;
  stored_path: string;
  preview_path: string | null;
  checksum_sha256: string;
  /** bigint 컬럼이라 postgres.js가 문자열로 돌려준다. */
  file_size: string;
};

type Mismatch = {
  relPath: string;
  reason: string;
};

type Options = {
  destRoot: string | null;
  dryRun: boolean;
};

function parseArgs(argv: string[]): Options {
  let destRoot: string | null = null;
  let dryRun = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--dest") {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new Error("--dest 뒤에 경로가 없습니다.");
      }
      destRoot = value;
      index += 1;
    } else if (arg.startsWith("--dest=")) {
      destRoot = arg.slice("--dest=".length);
    } else {
      throw new Error(`알 수 없는 인자입니다: ${arg}`);
    }
  }

  return { destRoot, dryRun };
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const mb = bytes / (1024 * 1024);
  return `${bytes.toLocaleString("en-US")} B (${mb.toFixed(1)} MB)`;
}

/**
 * 루트 아래의 모든 파일을 **저장 루트 기준 상대 경로**로 돌려준다. 구분자는
 * 언제나 `/`다 — Windows에서 만든 값이 Linux에서도 같은 파일을 가리켜야 한다
 * (src/lib/domain/attachment-path.ts의 규칙 1).
 *
 * 대소문자는 디스크에 적힌 그대로 둔다. 눕힌 이름으로 파일을 열면 대소문자를
 * 구분하는 Linux에서 열리지 않기 때문이다. 비교할 때만 눕힌다.
 */
async function listRelativeFiles(rootAbs: string): Promise<string[]> {
  const found: string[] = [];

  async function walk(dirAbs: string, dirRel: string): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(dirAbs, { withFileTypes: true });
    } catch (error) {
      // 목적지가 아직 없는 첫 실행은 정상이다 — 빈 백업으로 읽는다.
      if (isNotFound(error)) return;
      throw error;
    }

    for (const entry of entries) {
      const childRel = dirRel === "" ? entry.name : `${dirRel}/${entry.name}`;
      const childAbs = path.join(dirAbs, entry.name);
      if (entry.isDirectory()) {
        await walk(childAbs, childRel);
      } else if (entry.isFile()) {
        found.push(childRel);
      }
      // 심볼릭 링크와 그 밖의 특수 항목은 건너뛴다. 링크를 따라가면 저장 루트
      // 밖의 파일이 백업에 딸려 들어온다.
    }
  }

  await walk(rootAbs, "");
  return found;
}

async function sha256OfFile(absPath: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(absPath)) {
    hash.update(chunk as Buffer);
  }
  return hash.digest("hex");
}

async function fileSizeOrNull(absPath: string): Promise<number | null> {
  try {
    const stat = await fs.stat(absPath);
    return stat.size;
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

async function main(): Promise<number> {
  const options = parseArgs(process.argv.slice(2));

  // ── 1. 원본 루트 ────────────────────────────────────────────────────────
  const sourceRoot = process.env.UPLOADS_DIR?.trim();
  if (!sourceRoot) {
    console.error("UPLOADS_DIR이 설정돼 있지 않습니다. .env.local을 확인하세요 (.env.example 참고).");
    return 1;
  }

  // ── 2. 목적지 ───────────────────────────────────────────────────────────
  // 인자로 받는다 — 나중에 외장 하드나 NAS가 생기면 코드를 고치지 않고 쓴다.
  const backupsDir = process.env.BACKUPS_DIR?.trim();
  const destRoot =
    options.destRoot?.trim() ||
    (backupsDir ? path.join(backupsDir, "uploads") : FALLBACK_DEST_ROOT);

  const sourceRootAbs = path.resolve(sourceRoot);
  const destRootAbs = path.resolve(destRoot);

  console.log("사진 백업");
  console.log(`  원본:   ${sourceRootAbs}`);
  console.log(`  백업:   ${destRootAbs}`);
  if (options.dryRun) console.log("  [연습 모드] 아무것도 쓰지 않습니다.");

  // ── 3. 목적지가 원본 안이면 즉시 중단 ───────────────────────────────────
  // 안이면 복사한 파일이 다음 훑기에서 새 원본으로 잡혀 디스크가 찰 때까지 늘어난다.
  if (isDestinationInsideSource(sourceRootAbs, destRootAbs)) {
    console.error("백업 자리가 원본 폴더 안입니다. 복사가 스스로를 먹으므로 중단합니다.");
    return 1;
  }

  const sourceExists = await fs
    .stat(sourceRootAbs)
    .then((stat) => stat.isDirectory())
    .catch((error) => {
      if (isNotFound(error)) return false;
      throw error;
    });
  if (!sourceExists) {
    console.error(`원본 폴더가 없습니다: ${sourceRootAbs}`);
    return 1;
  }

  // ── 4. DB 조회 — 조건절 없이 전부 ───────────────────────────────────────
  // is_deleted 필터를 걸지 않는다: 휴지통 건은 되살릴 수 있으므로 백업 대상이다.
  const rows = await pgClient<AttachmentRow[]>`
    SELECT id, stored_path, preview_path, checksum_sha256, file_size
    FROM attachments
  `;

  const dbRelPaths: string[] = [];
  for (const row of rows) {
    dbRelPaths.push(row.stored_path);
    if (row.preview_path) dbRelPaths.push(row.preview_path);
  }

  // ── 5. 복사 ─────────────────────────────────────────────────────────────
  const sourceRelPathsAll = await listRelativeFiles(sourceRootAbs);
  const sourceRelPaths = sourceRelPathsAll.filter(
    (relPath) => !shouldExcludeFromBackup(relPath)
  );
  const excludedCount = sourceRelPathsAll.length - sourceRelPaths.length;

  const destRelPathsBefore = await listRelativeFiles(destRootAbs);
  const toCopy = planCopies(sourceRelPaths, destRelPathsBefore);
  const skipped = sourceRelPaths.length - toCopy.length;

  if (options.dryRun) {
    console.log("");
    console.log(`  복사할 것:   ${toCopy.length}개`);
    // 목록을 끝까지 찍지 않는다 — 이 출력은 end-work.ps1의 종료 화면 안에 그대로
    // 실리는데, 수십 줄이 흐르면 정작 읽어야 할 경고가 위로 밀려 사라진다.
    // 어긋난 것은 아래에서 전부 찍는다(그쪽은 반드시 읽혀야 하는 목록이므로).
    for (const relPath of toCopy.slice(0, DRY_RUN_PREVIEW_LINES)) console.log(`    + ${relPath}`);
    if (toCopy.length > DRY_RUN_PREVIEW_LINES) {
      console.log(`    … 외 ${toCopy.length - DRY_RUN_PREVIEW_LINES}개`);
    }
    console.log(`  이미 있음:   ${skipped}개`);
    if (excludedCount > 0) console.log(`  제외(.tmp-uploads): ${excludedCount}개`);

    // 연습 모드에서는 아무것도 복사하지 않았으므로 지문을 맞대어 볼 대상이
    // 없다. 대신 "복사를 마쳤다면 그래도 비어 있을 자리"만 미리 알려 준다 —
    // 그런 것이 있으면 디스크에 아예 없는 파일이라는 뜻이다.
    const wouldExist = [...destRelPathsBefore, ...toCopy];
    const wouldStillMiss = findMissingFromBackup(dbRelPaths, wouldExist);
    if (wouldStillMiss.length > 0) {
      console.log("");
      console.log(`  ⚠ DB에 적혀 있지만 원본 디스크에도 없는 파일 ${wouldStillMiss.length}개:`);
      for (const relPath of wouldStillMiss) console.log(`    ? ${relPath}`);
    }

    console.log("");
    console.log("연습 모드라 검증은 건너뜁니다. 실제로 뜨려면 --dry-run 없이 실행하세요.");
    return 0;
  }

  let copiedCount = 0;
  let copiedBytes = 0;
  const copyFailures: Mismatch[] = [];

  for (const relPath of toCopy) {
    const fromAbs = path.join(sourceRootAbs, ...relPath.split("/"));
    const toAbs = path.join(destRootAbs, ...relPath.split("/"));
    try {
      await fs.mkdir(path.dirname(toAbs), { recursive: true });
      // COPYFILE_EXCL — 이미 있는 파일은 덮어쓰지 않고 실패한다. 백업은 더하기만
      // 하는 자리이고, 덮어쓰기는 멀쩡한 백업을 상한 원본으로 바꿀 수 있는
      // 유일한 경로다.
      await fs.copyFile(fromAbs, toAbs, fsConstants.COPYFILE_EXCL);
      copiedCount += 1;
      copiedBytes += (await fileSizeOrNull(toAbs)) ?? 0;
    } catch (error) {
      copyFailures.push({ relPath, reason: `복사 실패: ${describeError(error)}` });
    }
  }

  // ── 6. 검증 ─────────────────────────────────────────────────────────────
  // 복사가 끝난 뒤의 목적지를 다시 훑는다 — "복사했으니 있겠지"가 아니라
  // 실제로 있는 것만 있다고 센다.
  const destRelPathsAfter = await listRelativeFiles(destRootAbs);
  const missingKeys = new Set(
    findMissingFromBackup(dbRelPaths, destRelPathsAfter).map(normalizeRelativePathKey)
  );

  const mismatches: Mismatch[] = [...copyFailures];
  const notes: string[] = [];
  let verifiedFiles = 0;

  for (const row of rows) {
    // ── 원본 파일: 존재 + 크기 + 지문 ──
    try {
      assertPortableStoredPath(row.stored_path);
    } catch (error) {
      mismatches.push({
        relPath: row.stored_path,
        reason: `DB의 저장 경로를 쓸 수 없습니다 (첨부 ${row.id}): ${describeError(error)}`,
      });
      continue;
    }

    if (missingKeys.has(normalizeRelativePathKey(row.stored_path))) {
      mismatches.push({
        relPath: row.stored_path,
        reason: `백업에 없습니다 (첨부 ${row.id})`,
      });
    } else {
      const backupAbs = resolveAttachmentAbsolutePath(destRootAbs, row.stored_path);
      const expectedSize = Number(row.file_size);
      const actualSize = await fileSizeOrNull(backupAbs);

      if (actualSize === null) {
        mismatches.push({
          relPath: row.stored_path,
          reason: `백업 파일을 열 수 없습니다 (첨부 ${row.id})`,
        });
      } else if (actualSize !== expectedSize) {
        mismatches.push({
          relPath: row.stored_path,
          reason: `크기가 다릅니다 — DB ${expectedSize} B, 백업 ${actualSize} B`,
        });
      } else {
        const actualChecksum = await sha256OfFile(backupAbs);
        if (actualChecksum.toLowerCase() !== row.checksum_sha256.trim().toLowerCase()) {
          mismatches.push({
            relPath: row.stored_path,
            reason: `SHA-256이 다릅니다 — DB ${row.checksum_sha256}, 백업 ${actualChecksum}`,
          });
        } else {
          verifiedFiles += 1;
        }
      }
    }

    // ── 미리보기: 지문이 없으므로 존재 여부와 원본 대비 크기만 ──
    if (!row.preview_path) continue;

    try {
      assertPortableStoredPath(row.preview_path);
    } catch (error) {
      mismatches.push({
        relPath: row.preview_path,
        reason: `DB의 미리보기 경로를 쓸 수 없습니다 (첨부 ${row.id}): ${describeError(error)}`,
      });
      continue;
    }

    if (missingKeys.has(normalizeRelativePathKey(row.preview_path))) {
      mismatches.push({
        relPath: row.preview_path,
        reason: `미리보기가 백업에 없습니다 (첨부 ${row.id})`,
      });
      continue;
    }

    const previewBackupAbs = resolveAttachmentAbsolutePath(destRootAbs, row.preview_path);
    const previewSourceAbs = resolveAttachmentAbsolutePath(sourceRootAbs, row.preview_path);
    const previewBackupSize = await fileSizeOrNull(previewBackupAbs);
    const previewSourceSize = await fileSizeOrNull(previewSourceAbs);

    if (previewBackupSize === null) {
      mismatches.push({
        relPath: row.preview_path,
        reason: `미리보기 백업 파일을 열 수 없습니다 (첨부 ${row.id})`,
      });
    } else if (previewSourceSize === null) {
      // 원본은 사라졌는데 백업에는 남아 있는 경우다. 이것은 백업이 제 일을 한
      // 모습이지 어긋난 것이 아니다 — 견줄 원본이 없다는 사실만 남긴다.
      notes.push(`${row.preview_path} — 원본이 없어 크기를 견주지 못했습니다 (백업본은 있습니다)`);
      verifiedFiles += 1;
    } else if (previewBackupSize !== previewSourceSize) {
      mismatches.push({
        relPath: row.preview_path,
        reason: `미리보기 크기가 원본과 다릅니다 — 원본 ${previewSourceSize} B, 백업 ${previewBackupSize} B`,
      });
    } else {
      verifiedFiles += 1;
    }
  }

  // ── 7. 결과 ─────────────────────────────────────────────────────────────
  const destTotalBytes = (
    await Promise.all(
      destRelPathsAfter.map((relPath) =>
        fileSizeOrNull(path.join(destRootAbs, ...relPath.split("/")))
      )
    )
  ).reduce<number>((sum, size) => sum + (size ?? 0), 0);

  console.log("");
  console.log(`  복사함:       ${copiedCount}개 (${formatBytes(copiedBytes)})`);
  console.log(`  이미 있어 건너뜀: ${skipped}개`);
  if (excludedCount > 0) console.log(`  제외(.tmp-uploads): ${excludedCount}개`);
  console.log(`  검증함:       ${verifiedFiles}개 / DB ${rows.length}건`);
  console.log(`  백업 전체:    ${destRelPathsAfter.length}개 (${formatBytes(destTotalBytes)})`);

  for (const note of notes) console.log(`  · ${note}`);

  if (mismatches.length > 0) {
    console.error("");
    console.error(`어긋난 것 ${mismatches.length}개 — 이 백업은 믿을 수 없습니다:`);
    for (const mismatch of mismatches) {
      console.error(`  ✗ ${mismatch.relPath}`);
      console.error(`      ${mismatch.reason}`);
    }
    return 1;
  }

  console.log("  어긋난 것 없음 — DB에 적힌 첨부가 전부 백업에 있고 지문도 같습니다.");
  return 0;
}

main()
  .then(async (exitCode) => {
    await pgClient.end({ timeout: 5 });
    process.exit(exitCode);
  })
  .catch(async (error) => {
    console.error("사진 백업에 실패했습니다:", describeError(error));
    await pgClient.end({ timeout: 5 });
    process.exit(1);
  });
