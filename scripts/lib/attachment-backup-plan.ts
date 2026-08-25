/**
 * ============================================================================
 * 사진 백업의 판단 — 무엇을 복사하고 무엇을 빠뜨렸는가
 * ============================================================================
 *
 * 이 파일에는 **파일 시스템도 DB도 없다.** 문자열만 받아 문자열만 돌려준다.
 * 그래서 실제 사진 21MB를 건드리지 않고 단위 테스트로 못박을 수 있다
 * (attachment-backup-plan.test.ts). 디스크에 닿는 일은 전부
 * scripts/backup-attachments.ts가 한다.
 *
 * ── 경로를 비교하기 전에 반드시 눕힌다 ───────────────────────────────────
 * 이 시스템은 사내 NAS(Docker 안은 Linux)로 옮기는 것을 전제로 설계돼 있다.
 * src/lib/domain/attachment-path.ts가 같은 이유로 세 규칙을 못박고 있는데,
 * 백업은 그 규칙이 지켜지지 **않은 값도 만난다** — 디스크를 직접 훑어 얻은
 * 경로는 OS가 주는 대로라 Windows에서는 `\`가 섞이고, 옛 파일에는 대문자가
 * 남아 있을 수 있다. 그 둘을 그대로 비교하면
 *
 *   "repair-cases\abc\1.JPG" ≠ "repair-cases/abc/1.jpg"
 *
 * 가 되어, 이미 백업해 둔 파일을 "없다"고 판단해 다시 복사하거나 — 더 나쁘게 —
 * DB에 적힌 파일이 백업에 있는데도 "빠졌다"고 보고한다. 그래서 비교에 쓰는
 * 모든 경로는 `/`로 통일하고 소문자로 눕힌 뒤에만 맞대어 본다.
 *
 * ── 이 백업은 더하기만 한다 ──────────────────────────────────────────────
 * 사진 파일명은 첨부 ID(UUID)라 같은 이름이 두 번 쓰이는 일이 없다. 따라서
 * 한 번 백업된 파일은 영원히 그대로이고, 다시 복사할 이유가 없다. 원본에서
 * 사라진 파일을 백업에서도 지우는 계산은 **여기에 없다** — 실수로 지운 것까지
 * 따라 지우면 백업이 백업이 아니게 된다.
 * ============================================================================
 */

/** 쓰다 만 업로드가 잠시 머무는 자리. 완결되지 않은 파일이라 백업하지 않는다. */
export const TEMP_UPLOAD_DIR_NAME = ".tmp-uploads";

/**
 * 저장 루트 기준 상대 경로를 **비교용 열쇠**로 눕힌다.
 *
 * 돌려주는 값은 비교에만 쓴다 — 디스크를 열 때는 원래 값을 쓴다. 소문자로
 * 눕힌 이름으로 파일을 열면 대소문자를 구분하는 Linux에서 열리지 않는다.
 *
 * `..`는 여기서 풀지 않는다. 상위로 올라가는 경로는 백업이 조용히 해석해 줄
 * 값이 아니라 거부해야 할 값이고, 그 판단은 부르는 쪽(assertPortableStoredPath)이
 * 한다.
 */
export function normalizeRelativePathKey(relativePath: string): string {
  return relativePath
    .trim()
    .replace(/\\/g, "/")
    .split("/")
    .filter((segment) => segment !== "" && segment !== ".")
    .join("/")
    .toLowerCase();
}

/**
 * 절대 경로(루트)를 비교용으로 눕힌다.
 *
 * 상대 경로와 달리 여기서는 `.`과 `..`를 풀어 준다 — `C:\A\uploads\..\uploads`가
 * `C:\A\uploads`와 다른 곳으로 읽히면 아래 isDestinationInsideSource가
 * 무한 복사를 놓친다.
 */
function normalizeRootKey(rootPath: string): string {
  const slashed = rootPath.trim().replace(/\\/g, "/");

  // 앞머리의 `/`(POSIX 절대경로)와 `//`(윈도우 UNC)는 마디를 세면서 사라지므로
  // 따로 떼어 두었다가 다시 붙인다. 둘을 구분하지 않으면 `//nas/share`와
  // `/nas/share`가 같은 자리로 읽힌다.
  let prefix = "";
  if (slashed.startsWith("//")) {
    prefix = "//";
  } else if (slashed.startsWith("/")) {
    prefix = "/";
  }

  const segments: string[] = [];
  for (const segment of slashed.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      segments.pop();
      continue;
    }
    segments.push(segment);
  }

  return `${prefix}${segments.join("/")}`.toLowerCase();
}

/**
 * 백업에서 빼야 할 경로인가.
 *
 * `.tmp-uploads`는 업로드가 끝나기 전의 파일이 머무는 자리다. 반쯤 쓰인 파일을
 * 백업해 두면 나중에 되살릴 때 멀쩡한 사진과 구분되지 않는다.
 *
 * 마디 단위로 견준다 — `.tmp-uploads-old`나 `tmp-uploads`처럼 이름만 닮은
 * 폴더는 남긴다. 앞머리 문자열만 보면 그런 폴더가 통째로 백업에서 빠지는데,
 * 빠진 것은 화면에 나타나지 않으므로 아무도 알아채지 못한다.
 */
export function shouldExcludeFromBackup(relativePath: string): boolean {
  return normalizeRelativePathKey(relativePath)
    .split("/")
    .includes(TEMP_UPLOAD_DIR_NAME);
}

/**
 * 원본에는 있는데 백업에는 아직 없는 것 — 이번에 복사할 목록.
 *
 * 돌려주는 값은 **받은 그대로의 원본 경로**다(눕힌 열쇠가 아니다). 부르는 쪽이
 * 이 값으로 실제 파일을 열기 때문이다.
 *
 * 제외 대상은 여기서도 한 번 더 걸러 낸다. 부르는 쪽이 거르는 것을 잊어도
 * `.tmp-uploads`가 백업에 실리는 일은 없어야 한다.
 */
export function planCopies(sourceRelPaths: string[], destRelPaths: string[]): string[] {
  const alreadyThere = new Set(destRelPaths.map(normalizeRelativePathKey));
  const planned: string[] = [];
  const seen = new Set<string>();

  for (const sourceRelPath of sourceRelPaths) {
    if (shouldExcludeFromBackup(sourceRelPath)) continue;

    const key = normalizeRelativePathKey(sourceRelPath);
    if (key === "") continue;
    if (alreadyThere.has(key)) continue;
    // 같은 파일을 가리키는 값이 두 번 들어와도 한 번만 복사한다.
    if (seen.has(key)) continue;

    seen.add(key);
    planned.push(sourceRelPath);
  }

  return planned;
}

/**
 * **DB에 적혀 있는데 백업에 없는 경로.** 이 백업의 핵심 안전장치다.
 *
 * 사진 파일은 이름이 UUID라 그 자체로는 어느 건의 무슨 사진인지 말해 주지
 * 않는다. 원본 파일명·분류·설명은 attachments 표에만 있으므로, 표에 적힌 것이
 * 하나라도 백업에 없으면 그 행은 되살릴 수 없는 껍데기가 된다. 그래서 "몇 개
 * 복사했다"가 아니라 "표에 적힌 것이 전부 있는가"로 성공을 판정한다.
 *
 * 제외 규칙을 여기에는 걸지 않는다 — DB에 적힌 경로가 `.tmp-uploads` 아래를
 * 가리킨다면 그것은 걸러 낼 일이 아니라 드러내야 할 이상 신호다.
 */
export function findMissingFromBackup(dbRelPaths: string[], destRelPaths: string[]): string[] {
  const backedUp = new Set(destRelPaths.map(normalizeRelativePathKey));
  const missing: string[] = [];
  const seen = new Set<string>();

  for (const dbRelPath of dbRelPaths) {
    const key = normalizeRelativePathKey(dbRelPath);
    if (key === "") continue;
    if (backedUp.has(key)) continue;
    if (seen.has(key)) continue;

    seen.add(key);
    missing.push(dbRelPath);
  }

  return missing;
}

/**
 * 목적지가 원본 안(또는 원본 그 자체)인가.
 *
 * 안이면 복사가 스스로를 먹는다 — 복사한 파일이 다음 훑기에서 새 원본으로
 * 잡히고, 그것을 또 복사한 것이 다시 원본이 되어 디스크가 찰 때까지 늘어난다.
 * 그래서 이 값이 참이면 부르는 쪽은 아무것도 하지 않고 멈춰야 한다.
 *
 * 마디 경계까지 함께 본다 — `C:\...\uploads-old`는 `C:\...\uploads` 안이
 * 아니다. 앞머리 문자열만 견주면 멀쩡한 목적지가 거부된다.
 */
export function isDestinationInsideSource(sourceRoot: string, destRoot: string): boolean {
  const source = normalizeRootKey(sourceRoot);
  const dest = normalizeRootKey(destRoot);

  // 빈 값은 "안이다"로 답하지 않는다. 빈 원본을 모든 것의 조상으로 읽으면
  // 설정이 비어 있는 순간 백업이 통째로 막히는데, 정작 진짜 문제(설정 누락)는
  // 부르는 쪽이 먼저 잡아 더 정확한 말로 알려 준다.
  if (source === "" || dest === "") return false;

  return dest === source || dest.startsWith(`${source}/`);
}
