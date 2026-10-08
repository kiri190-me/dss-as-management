import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";

import {
  QUOTE_FOLDER_FILE_LINK_PREFIX,
  QUOTE_FOLDER_OPENABLE_EXTENSIONS,
  buildQuoteFolderFileLink,
} from "@/lib/domain/quote-folder-file-link";
import {
  QUOTE_FOLDER_LINK_MAX_ENCODED_LENGTH,
  QUOTE_FOLDER_LINK_PREFIX,
  QUOTE_FOLDER_RELATIVE_PATH_MAX_LENGTH,
  buildQuoteFolderLink,
} from "@/lib/domain/quote-folder-link";
import {
  QUOTE_FOLDER_HELPER_COMMAND_BUILDER_PS,
  QUOTE_FOLDER_HELPER_INSTALLED_MESSAGE,
  QUOTE_FOLDER_HELPER_INSTALLER_FILE_NAME,
  QUOTE_FOLDER_HELPER_INSTALLER_PATH_ENV,
  QUOTE_FOLDER_HELPER_INSTALL_AREA_KEYS,
  QUOTE_FOLDER_HELPER_INSTALL_EXIT_PS,
  QUOTE_FOLDER_HELPER_INSTALL_FAILED_MESSAGE,
  QUOTE_FOLDER_HELPER_PAYLOAD_READER_PS,
  QUOTE_FOLDER_HELPER_ROOT_MAX_LENGTH,
  QUOTE_FOLDER_HELPER_ZONE_FAILED_MESSAGE,
  QUOTE_FOLDER_HELPER_ZONE_RANGES_PATH,
  QUOTE_FOLDER_HELPER_ZONE_REGISTERED_MESSAGE,
  QUOTE_FOLDER_HELPER_ZONE_REGISTER_PS,
  QUOTE_FOLDER_XLSX2PDF_LINK_PREFIX,
  QUOTE_FOLDER_XLSX2PDF_OUTPUT_EXTENSION,
  QUOTE_FOLDER_XLSX2PDF_SOURCE_EXTENSION,
  QuoteFolderHelperRootError,
  buildQuoteFolderHelperInlineInstallCommand,
  buildQuoteFolderHelperInstaller,
  buildQuoteFolderHelperScript,
  buildQuoteFolderHelperUncPath,
  mayInstallQuoteFolderHelper,
  normalizeQuoteFolderHelperRoot,
  quoteFolderHelperInlinePayloadReaderPs,
  quoteFolderHelperInstallCommand,
  quoteFolderHelperInteractiveStatements,
  quoteFolderHelperRootsInput,
  quoteFolderHelperScriptBytes,
  quoteFolderHelperZoneHosts,
  resolveQuoteFolderHelperInstallRoots,
  resolveQuoteFolderHelperRoot,
  resolveQuoteFolderHelperUncPath,
} from "./quote-folder-helper";

/*
 * ============================================================================
 * 「견적서 폴더 열기」 도우미 — 스크립트 · 설치 파일 (견적서 ④a)
 * ============================================================================
 * 🔴 설치 파일(.cmd)은 **돌리지 않는다** — 이 PC 의 레지스트리를 바꾸지 않는다. 시험은
 *   · 본문 문자열을 보고,
 *   · 설치 파일에서 **payload 를 읽는 한 줄**(QUOTE_FOLDER_HELPER_PAYLOAD_READER_PS)과 **명령을 만드는
 *     한 줄**(QUOTE_FOLDER_HELPER_COMMAND_BUILDER_PS)만 PowerShell 로 돌리고,
 *   · 도우미 스크립트는 DSS_FOLDER_DRY_RUN=1 로만 돌린다(탐색기를 열지 않고 결과를 적는다).
 * 루트는 OS 임시 폴더(mkdtemp)거나 가짜 UNC(`\\TESTNAS\archive`)다 — 실제 공유폴더에 닿지 않는다.
 * PowerShell 을 돌리는 시험은 Windows 에서만 돈다.
 * ============================================================================
 */

const IS_WINDOWS = process.platform === "win32";
const WINDOWS_ONLY = IS_WINDOWS ? false : "Windows 에서만 — PowerShell 스크립트를 실제로 돌린다";
const POWERSHELL = path.join(
  process.env.SystemRoot ?? "C:\\Windows",
  "System32",
  "WindowsPowerShell",
  "v1.0",
  "powershell.exe"
);
const FAKE_UNC = "\\\\TESTNAS\\archive";

type RunResult = { code: number | null; stdout: string; stderr: string };

function runPowerShell(
  args: readonly string[],
  options: { env?: Record<string, string>; verbatim?: boolean } = {}
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(POWERSHELL, [...args], {
      env: { ...process.env, ...options.env },
      windowsHide: true,
      windowsVerbatimArguments: options.verbatim ?? false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => out.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => err.push(chunk));
    child.on("error", reject);
    child.on("close", (code) =>
      resolve({ code, stdout: Buffer.concat(out).toString("utf8"), stderr: Buffer.concat(err).toString("utf8") })
    );
  });
}

/** 규칙을 거치지 않고 아무 문자열이나 주소로 싼다 — 다른 사이트가 만든 주소 흉내. */
function rawLink(text: string): string {
  return `${QUOTE_FOLDER_LINK_PREFIX}${Buffer.from(text, "utf8").toString("base64url")}`;
}

function linkOf(relativePath: string): string {
  const link = buildQuoteFolderLink(relativePath);
  assert.ok(link !== null, relativePath);
  return link;
}

// ── 루트 검사 ──────────────────────────────────────────────────────────────

describe("도우미 루트(QUOTE_ARCHIVE_UNC_ROOT) 검사", () => {
  test("UNC · 드라이브 경로를 받고 끝의 \\ 와 앞뒤 공백을 뗀다", () => {
    const accepted: Array<[string, string]> = [
      [FAKE_UNC, FAKE_UNC],
      [`${FAKE_UNC}\\`, FAKE_UNC],
      [`  ${FAKE_UNC}  `, FAKE_UNC],
      ["\\\\TESTNAS\\견적 공유\\하위 폴더", "\\\\TESTNAS\\견적 공유\\하위 폴더"],
      ["\\\\TESTNAS\\archive$\\R&D 100%", "\\\\TESTNAS\\archive$\\R&D 100%"],
      ["Z:\\견적서", "Z:\\견적서"],
    ];
    for (const [raw, expected] of accepted) {
      assert.equal(normalizeQuoteFolderHelperRoot(raw), expected, raw);
    }
  });

  test("🔴 따옴표 · 줄바꿈 · 제어문자 · 장치 경로 · 상대 경로 · 점 마디는 받지 않는다", () => {
    const rejected = [
      "",
      "   ",
      "\\\\TESTNAS",
      "\\\\TESTNAS\\",
      "\\\\\\TESTNAS\\archive",
      "\\\\TESTNAS\\\\archive",
      "\\\\?\\C:\\archive",
      "\\\\.\\pipe\\archive",
      "C:\\",
      "C:",
      "C:archive",
      "archive\\2026",
      "/mnt/archive",
      "\\\\TESTNAS/archive",
      "\\\\TESTNAS\\arch'ive",
      '\\\\TESTNAS\\arch"ive',
      `\\\\TESTNAS\\arch${String.fromCharCode(0x2019)}ive`,
      `\\\\TESTNAS\\arch${String.fromCharCode(0x201c)}ive`,
      "\\\\TESTNAS\\arch`ive",
      "\\\\TESTNAS\\arch\nive",
      "\\\\TESTNAS\\arch\tive",
      `\\\\TESTNAS\\arch${String.fromCharCode(0x2028)}ive`,
      `\\\\TESTNAS\\arch${String.fromCharCode(0x85)}ive`,
      "\\\\TESTNAS\\archive\\..\\other",
      "\\\\TESTNAS\\archive\\.",
      "\\\\TESTNAS\\a:b",
      "\\\\TESTNAS\\archive.",
      "\\\\TESTNAS\\archive \\2026",
      "\\\\TESTNAS\\arc*ive",
      "\\\\TESTNAS\\arc?ive",
      "\\\\TESTNAS\\arc<ive",
      "\\\\TESTNAS\\arc>ive",
      "\\\\TESTNAS\\arc|ive",
      `\\\\TESTNAS\\${"a".repeat(QUOTE_FOLDER_HELPER_ROOT_MAX_LENGTH)}`,
    ];
    for (const raw of rejected) {
      assert.equal(normalizeQuoteFolderHelperRoot(raw), null, JSON.stringify(raw));
    }
    for (const value of [undefined, null, 1, {}]) {
      assert.equal(normalizeQuoteFolderHelperRoot(value), null);
    }
  });

  test("틀린 루트로는 스크립트 · 설치 파일을 만들지 않는다 — 오류에 값이 실리지 않는다", () => {
    for (const make of [
      () => buildQuoteFolderHelperScript({ uncRoot: "\\\\TESTNAS\\it's" }),
      () => buildQuoteFolderHelperInstaller({ uncRoot: "\\\\TESTNAS\\it's" }),
    ]) {
      assert.throws(make, (error: unknown) => {
        assert.ok(error instanceof QuoteFolderHelperRootError);
        assert.equal(error.message.includes("TESTNAS"), false);
        return true;
      });
    }
  });

  test("resolveQuoteFolderHelperRoot — 부르는 시점에 읽는다: 비었으면 unset · 틀리면 invalid · 맞으면 ok", () => {
    const original = process.env.QUOTE_ARCHIVE_UNC_ROOT;
    try {
      delete process.env.QUOTE_ARCHIVE_UNC_ROOT;
      assert.deepEqual(resolveQuoteFolderHelperRoot(), { status: "unset" });
      process.env.QUOTE_ARCHIVE_UNC_ROOT = "   ";
      assert.deepEqual(resolveQuoteFolderHelperRoot(), { status: "unset" });
      process.env.QUOTE_ARCHIVE_UNC_ROOT = "/mnt/archive";
      assert.deepEqual(resolveQuoteFolderHelperRoot(), { status: "invalid" });
      process.env.QUOTE_ARCHIVE_UNC_ROOT = ` ${FAKE_UNC}\\ `;
      assert.deepEqual(resolveQuoteFolderHelperRoot(), { status: "ok", root: FAKE_UNC });
    } finally {
      if (original === undefined) delete process.env.QUOTE_ARCHIVE_UNC_ROOT;
      else process.env.QUOTE_ARCHIVE_UNC_ROOT = original;
    }
  });
});

// ── 스크립트 본문 ──────────────────────────────────────────────────────────

describe("도우미 스크립트 본문", () => {
  const script = buildQuoteFolderHelperScript({ uncRoot: FAKE_UNC });

  test("루트가 작은따옴표 문자열로 박히고, 주소 규칙의 값이 서버와 같다", () => {
    assert.ok(script.includes(`$Roots = @('${FAKE_UNC}')\r\n`));
    assert.ok(script.includes(`$Prefix = '${QUOTE_FOLDER_LINK_PREFIX}'\r\n`));
    assert.ok(script.includes(`$MaxRelativeLength = ${QUOTE_FOLDER_RELATIVE_PATH_MAX_LENGTH}\r\n`));
    assert.ok(script.includes(`$MaxEncodedLength = ${QUOTE_FOLDER_LINK_MAX_ENCODED_LENGTH}\r\n`));
    assert.ok(script.includes("$DryRun = ($env:DSS_FOLDER_DRY_RUN -eq '1')"));
  });

  test("줄 끝은 CRLF 뿐 · 파일 바이트는 UTF-8 BOM + 본문", () => {
    assert.equal(/[^\r]\n/.test(script), false);
    const bytes = quoteFolderHelperScriptBytes({ uncRoot: FAKE_UNC });
    assert.deepEqual([...bytes.slice(0, 3)], [0xef, 0xbb, 0xbf]);
    assert.equal(Buffer.from(bytes.slice(3)).toString("utf8"), script);
  });

  /**
   * 🔴 2026-10-05 — 이 시험의 금지 목록에서 `Start-Process` 를 **일부러 뺐다.**
   * 조각 4 가 불변식 (a) 를 바꿨다: 도우미가 `openfile/` 주소를 받으면 허용 목록에 든
   * 확장자의 파일 하나를 **연결 프로그램으로 연다**(사용자가 위험을 설명 듣고 고름).
   * 그 자리를 검사 일곱이 메우므로, 여기서는 「없다」 대신 **있는 것이 딱 그 모양인지**를 센다:
   *  · `Start-Process` 는 **정확히 한 번**, `-FilePath $full` 로만 — 인자가 그 경로 하나뿐이다.
   *  · `-ArgumentList` 가 없다 — 명령줄을 문자열로 조립하지 않는다.
   *  · 폴더 쪽(explorer.exe)은 **한 글자도 바뀌지 않았다**.
   */
  test("🔴 탐색기와 연결 프로그램 말고는 아무것도 부르지 않는다 — 코드 실행 · 네트워크 · 파일 쓰기가 없다", () => {
    for (const forbidden of [
      "Invoke-Expression",
      "iex ",
      "Invoke-Item",
      "Invoke-Command",
      "ScriptBlock",
      "-Command",
      "-EncodedCommand",
      "-Verb",
      "cmd.exe",
      "Invoke-WebRequest",
      "Invoke-RestMethod",
      "WebClient",
      "Net.Sockets",
      "Set-Content",
      "Add-Content",
      "Out-File",
      "WriteAllBytes",
      "WriteAllText",
      "Remove-Item",
      "Start-Transcript",
      "Shell.Application",
      "ShellExecuteEx",
      "UseShellExecute = $true",
    ]) {
      assert.equal(script.includes(forbidden), false, forbidden);
    }
    // 폴더 — 예전 그대로.
    assert.equal(script.match(/Process\]::Start\(/g)?.length, 1);
    assert.ok(script.includes("$start.FileName = Join-Path $env:SystemRoot 'explorer.exe'"));
    assert.ok(script.includes("$start.UseShellExecute = $false"));
    assert.ok(script.includes(`$start.Arguments = '"' + $full + '\\"'`));
    // 🔴 파일 — 인자는 그 경로 하나뿐이다. 명령줄을 문자열로 조립하지 않는다.
    assert.equal(script.match(/Start-Process/g)?.length, 1);
    assert.ok(script.includes("Start-Process -FilePath $full\r\n"));
    // `-ArgumentList` 는 스크립트에 딱 한 번 있고, 그것은 UTF-8 읽개를 만드는 자리다 —
    // 🔴 Start-Process 쪽에는 없다(인자 목록을 넘기면 그것이 곧 명령줄 조립이다).
    assert.equal(script.match(/-ArgumentList/g)?.length, 1);
    assert.ok(script.includes("New-Object System.Text.UTF8Encoding -ArgumentList $false, $true"));
  });

  test("거절 · 확인 단계가 순서대로 있다 — 인자 수 → 모양 → 인코딩 → 규칙 → 루트 안 → 폴더 → 바로 가기 → 탐색기", () => {
    const marks = [
      "if ($args.Count -ne 1) { Stop-Helper 'REJECT argument-count' 2 }",
      "Stop-Helper 'REJECT not-a-folder-link' 2",
      "$encoded -cnotmatch '^[A-Za-z0-9_-]+\\z'",
      "if ($canonical -cne $encoded) { Stop-Helper 'REJECT bad-encoding' 2 }",
      "if (-not (Test-RelativePath $relative)) { Stop-Helper 'REJECT bad-path' 3 }",
      "[System.IO.Path]::GetFullPath($rootFull + '\\' + $relative.Replace('/', '\\'))",
      "$full.StartsWith($rootFull + '\\', [System.StringComparison]::OrdinalIgnoreCase)",
      // 폴더 확인 · 바로 가기 확인은 함수로 빼 두었다 — 못 닿는 주소가 던져도 다음 루트로
      // 넘어가야 해서다(Test-FolderState 머리 주석). 여기서는 부르는 자리를 본다.
      "if ((Test-FolderState $full) -ne 'found') { continue }",
      "if (-not (Test-NoReparsePoint $rootFull $relative)) { $reparse = $true; break }",
      "if ($DryRun) { Stop-Helper ('OPEN ' + $full) 0 }",
      "[System.Diagnostics.Process]::Start($start)",
    ];
    let previous = -1;
    for (const mark of marks) {
      const at = script.indexOf(mark);
      assert.ok(at >= 0, `없다: ${mark}`);
      assert.ok(at > previous, `순서가 어긋났다: ${mark}`);
      previous = at;
    }
  });
});

// ── 도우미 스크립트를 실제로 돌린다 (DRY_RUN) ──────────────────────────────

describe("🔴 도우미 스크립트 — DSS_FOLDER_DRY_RUN=1 로 실제로 돌린다", { skip: WINDOWS_ONLY, concurrency: 4 }, () => {
  const YEAR = "21. 2026 내자견적서";
  const QUOTE = "DSS 2026-089 R&D 100% 'Q' 가나상사 수리 견적서";
  let parent = "";
  let root = "";
  let outside = "";
  let scriptPath = "";
  let canary = "";

  before(async () => {
    parent = await mkdtemp(path.join(os.tmpdir(), "dss-folder-helper-test-"));
    root = path.join(parent, "견적 공유폴더");
    outside = path.join(parent, "바깥 폴더");
    await mkdir(path.join(root, YEAR, QUOTE), { recursive: true });
    await mkdir(path.join(outside, "안쪽"), { recursive: true });
    await writeFile(path.join(root, YEAR, "memo.txt"), "파일이다");
    await writeFile(path.join(root, YEAR, "run.cmd"), "@echo off");
    // 루트 안의 정션 — 루트 밖을 가리킨다(관리자 권한 없이 만들 수 있다).
    await symlink(outside, path.join(root, YEAR, "바로가기"), "junction");
    scriptPath = path.join(parent, "open-dss-folder.ps1");
    await writeFile(scriptPath, quoteFolderHelperScriptBytes({ uncRoot: root }));
    canary = path.join(parent, "injected.txt");
  });

  after(async () => {
    if (parent) await rm(parent, { recursive: true, force: true });
  });

  function runHelper(args: readonly string[]): Promise<RunResult> {
    return runPowerShell(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", scriptPath, ...args], {
      env: { DSS_FOLDER_DRY_RUN: "1" },
    });
  }

  async function assertOutcome(args: readonly string[], expected: string, code: number): Promise<void> {
    const result = await runHelper(args);
    assert.equal(result.stdout.trim(), expected, `stderr: ${result.stderr}`);
    assert.equal(result.code, code);
    if (!expected.startsWith("OPEN ")) assert.equal(result.stdout.includes("OPEN"), false);
  }

  test("정상 — 견적서 폴더를 연다고 적는다(한글 · 공백 · & · % · 작은따옴표)", async () => {
    await assertOutcome([linkOf(`${YEAR}/${QUOTE}`)], `OPEN ${path.join(root, YEAR, QUOTE)}`, 0);
  });

  test("정상 — 연도 폴더도 폴더다", async () => {
    await assertOutcome([linkOf(YEAR)], `OPEN ${path.join(root, YEAR)}`, 0);
  });

  test("레지스트리 명령과 같은 모양(-WindowStyle Hidden -File \"…\" \"%1\")으로 불러도 연다", async () => {
    const tail = `-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "${scriptPath}" "${linkOf(`${YEAR}/${QUOTE}`)}"`;
    const result = await runPowerShell([tail], { env: { DSS_FOLDER_DRY_RUN: "1" }, verbatim: true });
    assert.equal(result.stdout.trim(), `OPEN ${path.join(root, YEAR, QUOTE)}`, result.stderr);
    assert.equal(result.code, 0);
  });

  const pathRejects: Array<[string, string]> = [
    ["..", "..-마디"],
    ["../바깥 폴더", "루트 밖으로 한 칸"],
    [`${YEAR}/../../바깥 폴더`, "안에서 두 칸 올라가기"],
    ["C:/Windows", "드라이브"],
    ["/Windows", "/ 로 시작"],
    ["\\\\OTHERNAS\\share", "다른 UNC"],
    ["//OTHERNAS/share", "슬래시 UNC"],
    [`${YEAR}\\${QUOTE}`, "역슬래시 구분자"],
    [`${YEAR}/${QUOTE}:stream`, "콜론"],
    [`${YEAR}/a\nb`, "제어문자"],
    [`${YEAR}/.. `, "끝 공백으로 가린 .."],
    [`${YEAR}/`, "빈 마디"],
  ];
  for (const [relativePath, label] of pathRejects) {
    test(`🔴 경로 거절 — ${label}`, async () => {
      await assertOutcome([rawLink(relativePath)], "REJECT bad-path", 3);
    });
  }

  test("🔴 절대 경로(루트 밖 실제 폴더)는 거절", async () => {
    await assertOutcome([rawLink(outside)], "REJECT bad-path", 3);
  });

  test("🔴 파일은 폴더가 아니다 — 열지 않는다(문서 · 실행 파일 모두)", async () => {
    await assertOutcome([linkOf(`${YEAR}/memo.txt`)], "NOT-FOUND", 4);
    await assertOutcome([linkOf(`${YEAR}/run.cmd`)], "NOT-FOUND", 4);
  });

  test("없는 폴더는 NOT-FOUND", async () => {
    await assertOutcome([linkOf(`${YEAR}/없는 폴더`)], "NOT-FOUND", 4);
  });

  test("🔴 루트 밖을 가리키는 정션(바로 가기 폴더)은 거절 — 그 아래 폴더도", async () => {
    await assertOutcome([linkOf(`${YEAR}/바로가기`)], "REJECT reparse-point", 3);
    await assertOutcome([linkOf(`${YEAR}/바로가기/안쪽`)], "REJECT reparse-point", 3);
  });

  test("🔴 모양 아닌 주소는 거절", async () => {
    const body = linkOf(YEAR).slice(QUOTE_FOLDER_LINK_PREFIX.length);
    for (const link of [
      "https://example.com/",
      `dss-folder://open/?q=${body}`,
      `DSS-FOLDER://open/?p=${body}`,
      `dss-folder://evil/?p=${body}`,
      `${QUOTE_FOLDER_LINK_PREFIX}${"A".repeat(QUOTE_FOLDER_LINK_MAX_ENCODED_LENGTH + 4)}`,
    ]) {
      await assertOutcome([link], "REJECT not-a-folder-link", 2);
    }
  });

  test("🔴 인코딩이 표준이 아니면 거절(빈 몸통 · 채움 · 알파벳 밖 · 다른 표기 · UTF-8 아님)", async () => {
    const body = linkOf(YEAR).slice(QUOTE_FOLDER_LINK_PREFIX.length);
    for (const encoded of [
      "",
      `${body}=`,
      `${body}+`,
      "YR",
      "A",
      Buffer.from([0xff]).toString("base64url"),
      Buffer.from([0xed, 0xa0, 0x80]).toString("base64url"),
    ]) {
      await assertOutcome([`${QUOTE_FOLDER_LINK_PREFIX}${encoded}`], "REJECT bad-encoding", 2);
    }
  });

  test("🔴 삽입 시도 — 인자 하나 안의 따옴표 · 세미콜론 · $( ) 는 문자열일 뿐이다", async () => {
    const plant = `New-Item -ItemType File -Path '${canary}'`;
    await assertOutcome(['"; calc; "'], "REJECT not-a-folder-link", 2);
    await assertOutcome([`${QUOTE_FOLDER_LINK_PREFIX}QQ"; ${plant}; "`], "REJECT bad-encoding", 2);
    await assertOutcome([`${QUOTE_FOLDER_LINK_PREFIX}$(${plant})`], "REJECT bad-encoding", 2);
    assert.equal(existsSync(canary), false, "🔴 끼워 넣은 명령이 돌았다");
  });

  test("🔴 삽입 시도 — 따옴표를 깨고 인자를 늘린 주소(레지스트리 명령에 그대로 넣은 모양)는 인자 수로 거절", async () => {
    const plant = `New-Item -ItemType File -Path '${canary}'`;
    // 셸이 "%1" 자리에 `…QQ" -Command "<명령>` 을 넣은 명령줄 그대로.
    const tail = `-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "${scriptPath}" "${QUOTE_FOLDER_LINK_PREFIX}QQ" -Command "${plant}"`;
    const result = await runPowerShell([tail], { env: { DSS_FOLDER_DRY_RUN: "1" }, verbatim: true });
    assert.equal(result.stdout.trim(), "REJECT argument-count", result.stderr);
    assert.equal(result.code, 2);
    assert.equal(existsSync(canary), false, "🔴 끼워 넣은 명령이 돌았다");
  });

  test("🔴 인자가 없거나 둘이면 거절", async () => {
    await assertOutcome([], "REJECT argument-count", 2);
    await assertOutcome([linkOf(YEAR), linkOf(YEAR)], "REJECT argument-count", 2);
  });

  test("길이 — 규칙 안의 긴 경로는 규칙을 통과한다(없는 폴더라 NOT-FOUND)", async () => {
    await assertOutcome([linkOf(`${YEAR}/${"가".repeat(100)}`)], "NOT-FOUND", 4);
  });

  test("길이 — 규칙 상한의 경로가 Windows 경로 한도를 넘으면 오류로 끝난다(열지 않는다)", async () => {
    const longest = "가".repeat(QUOTE_FOLDER_RELATIVE_PATH_MAX_LENGTH);
    await assertOutcome([linkOf(longest)], "REJECT error", 9);
  });
});

// ── 🔴 파일 열기(openfile) ─────────────────────────────────────────────────

/**
 * ============================================================================
 * 🔴 조각 4 — `dss-folder://openfile/?p=…` 는 **검사 일곱**을 모두 지나야 연다
 * ============================================================================
 * 불변식 (a) 가 2026-10-05 에 바뀌었다(사용자가 위험을 설명 듣고 「바로 열린다」를 골랐다).
 * 없어진 「파일은 안 연다」 한 줄의 자리를 메우는 것이 이 블록이다 — **거절 쪽을 훨씬 많이**
 * 본다. 스크립트를 실제로 돌려(DSS_FOLDER_DRY_RUN=1) 표준출력을 값으로 읽는다.
 * ============================================================================
 */

/** 규칙을 거치지 않고 아무 문자열이나 **파일** 주소로 싼다 — 다른 사이트가 만든 주소 흉내. */
function rawFileLink(text: string): string {
  return `${QUOTE_FOLDER_FILE_LINK_PREFIX}${Buffer.from(text, "utf8").toString("base64url")}`;
}

function fileLinkOf(relativePath: string): string {
  const link = buildQuoteFolderFileLink(relativePath);
  assert.ok(link !== null, relativePath);
  return link;
}

describe("🔴 파일 열기 — TS 의 허용 목록과 PS 안의 목록이 글자 그대로 같은가", () => {
  const script = buildQuoteFolderHelperScript({ uncRoot: FAKE_UNC });

  test("스크립트에 박힌 목록을 도로 꺼내 TS 의 목록과 맞춘다", () => {
    const head = "$OpenableExtensions = @(";
    const line = script.split("\r\n").find((candidate) => candidate.startsWith(head));
    assert.ok(line, "$OpenableExtensions 줄이 없다");
    assert.ok(line.endsWith(")"), line);
    const embedded = line
      .slice(head.length, -1)
      .split(", ")
      .map((token) => {
        assert.ok(token.startsWith("'") && token.endsWith("'"), token);
        return token.slice(1, -1);
      });
    // 🔴 값도 차례도 같아야 한다 — 한쪽만 고치면 화면과 도우미가 다른 말을 한다.
    assert.deepEqual(embedded, [...QUOTE_FOLDER_OPENABLE_EXTENSIONS]);
  });

  test("🔴 허용 목록은 사용자가 정한 열여덟 개 — .xlsm 이 일부러 들어 있다", () => {
    assert.deepEqual(
      [...QUOTE_FOLDER_OPENABLE_EXTENSIONS],
      "xlsx xls xlsm pdf docx doc pptx ppt hwp hwpx jpg jpeg png gif bmp txt csv zip".split(" ")
    );
    // 연락서 원본이 .xlsm 이다 — 못 열면 이 기능의 뜻이 없다(올리기 허용목록과는 다른 판단).
    assert.ok(QUOTE_FOLDER_OPENABLE_EXTENSIONS.includes("xlsm"));
    // 🔴 실행되는 것은 하나도 없다.
    for (const dangerous of [
      "exe", "bat", "cmd", "ps1", "vbs", "js", "lnk", "url", "scf", "msi",
      "reg", "hta", "com", "scr", "jar", "pif", "cpl", "msc", "wsf", "jse",
    ]) {
      assert.equal(QUOTE_FOLDER_OPENABLE_EXTENSIONS.includes(dangerous), false, dangerous);
    }
    // 소문자로만 적는다 — 비교는 접어서 한다.
    for (const extension of QUOTE_FOLDER_OPENABLE_EXTENSIONS) {
      assert.equal(extension, extension.toLowerCase(), extension);
      assert.equal(extension.startsWith("."), false, extension);
    }
  });

  test("🔴 검사 일곱이 스크립트 안에 있다 — 하나도 서버에 맡기지 않았다", () => {
    assert.ok(script.includes(`$FilePrefix = '${QUOTE_FOLDER_FILE_LINK_PREFIX}'\r\n`));
    for (const mark of [
      // 1 상대 경로 규칙(폴더와 같은 함수) · 2 루트 담김 · 3 바로 가기
      "if (-not (Test-RelativePath $relative)) { Stop-Helper 'REJECT bad-path' 3 }",
      "$full.StartsWith($rootFull + '\\', [System.StringComparison]::OrdinalIgnoreCase)",
      "if (-not (Test-NoReparsePoint $rootFull $relative)) { $reparse = $true; break }",
      // 4 · 6 확장자 허용 목록 · 확장자 없는 것
      "function Test-OpenableFileName([string]$Name) {",
      "if (-not (Test-OpenableFileName $segments[$segments.Length - 1])) { Stop-Helper 'REJECT bad-extension' 3 }",
      "$extension = $Name.Substring($dot + 1).ToLowerInvariant()",
      "if ($dot -lt 1) { return $false }",
      // 5 폴더가 아니라 파일인가
      "function Test-FileState([string]$Path) {",
      "if ([System.IO.Directory]::Exists($Path)) { return 'directory' }",
      "if ([System.IO.File]::Exists($Path)) { return 'found' }",
      "if ($state -ceq 'directory') { $NotAFile = $true; break }",
      "Stop-Helper 'REJECT not-a-file' 3",
      // 7 실행 — 인자는 경로 하나뿐
      "Start-Process -FilePath $full",
    ]) {
      assert.ok(script.includes(mark), `없다: ${mark}`);
    }
  });
});

describe("🔴 파일 열기 — DSS_FOLDER_DRY_RUN=1 로 실제로 돌린다", { skip: WINDOWS_ONLY, concurrency: 4 }, () => {
  const FOLDER = "D260908 INVENIA T2RCONT-AD2 WN3947 1802034 점검요청";
  let parent = "";
  let root = "";
  let outside = "";
  let scriptPath = "";
  let canary = "";

  before(async () => {
    parent = await mkdtemp(path.join(os.tmpdir(), "dss-folder-openfile-test-"));
    root = path.join(parent, "연락서 공유폴더");
    outside = path.join(parent, "바깥 폴더");
    await mkdir(path.join(root, FOLDER), { recursive: true });
    await mkdir(outside, { recursive: true });
    await writeFile(path.join(outside, "비밀 문서.pdf"), "바깥");

    // 허용 목록의 확장자마다 한 장씩.
    for (const extension of QUOTE_FOLDER_OPENABLE_EXTENSIONS) {
      await writeFile(path.join(root, FOLDER, `연락서.${extension}`), "x");
    }
    await writeFile(path.join(root, FOLDER, "D260908 연락서 (주)한국 & 제어 100%.xlsm"), "x");
    await writeFile(path.join(root, FOLDER, "사진.JPG"), "x");
    // 목록 밖 · 확장자 없는 이름 — **디스크에 실제로 있어도** 열리지 않아야 한다.
    for (const name of ["설치.exe", "실행.BAT", "문서", "바로가기.lnk"]) {
      await writeFile(path.join(root, FOLDER, name), "x");
    }
    // 🔴 폴더에 .pdf 이름을 붙인 함정.
    await mkdir(path.join(root, FOLDER, "함정.pdf"), { recursive: true });
    // 🔴 루트 밖을 가리키는 정션 — 그 아래 파일도 열리면 안 된다.
    await symlink(outside, path.join(root, FOLDER, "바로가기"), "junction");

    scriptPath = path.join(parent, "open-dss-folder.ps1");
    await writeFile(scriptPath, quoteFolderHelperScriptBytes({ uncRoot: root }));
    canary = path.join(parent, "injected.txt");
  });

  after(async () => {
    if (parent) await rm(parent, { recursive: true, force: true });
  });

  function runHelper(args: readonly string[]): Promise<RunResult> {
    return runPowerShell(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", scriptPath, ...args], {
      env: { DSS_FOLDER_DRY_RUN: "1" },
    });
  }

  async function assertOutcome(args: readonly string[], expected: string, code: number): Promise<void> {
    const result = await runHelper(args);
    assert.equal(result.stdout.trim(), expected, `stderr: ${result.stderr}`);
    assert.equal(result.code, code);
    if (!expected.startsWith("OPEN")) assert.equal(result.stdout.includes("OPEN"), false);
  }

  // ── 통과해야 하는 것 ─────────────────────────────────────────────────────

  test("허용 목록의 확장자마다 열린다 — 특히 .xlsm", async () => {
    for (const extension of QUOTE_FOLDER_OPENABLE_EXTENSIONS) {
      const relative = `${FOLDER}/연락서.${extension}`;
      await assertOutcome([fileLinkOf(relative)], `OPEN-FILE ${path.join(root, FOLDER, `연락서.${extension}`)}`, 0);
    }
  });

  test("한글 · 공백 · & · % · 괄호가 든 이름도 열린다", async () => {
    const name = "D260908 연락서 (주)한국 & 제어 100%.xlsm";
    await assertOutcome([fileLinkOf(`${FOLDER}/${name}`)], `OPEN-FILE ${path.join(root, FOLDER, name)}`, 0);
  });

  test("🔴 확장자는 접어서 본다 — .JPG 도 열린다", async () => {
    await assertOutcome([fileLinkOf(`${FOLDER}/사진.JPG`)], `OPEN-FILE ${path.join(root, FOLDER, "사진.JPG")}`, 0);
  });

  test("레지스트리 명령과 같은 모양으로 불러도 연다", async () => {
    const link = fileLinkOf(`${FOLDER}/연락서.pdf`);
    const tail = `-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "${scriptPath}" "${link}"`;
    const result = await runPowerShell([tail], { env: { DSS_FOLDER_DRY_RUN: "1" }, verbatim: true });
    assert.equal(result.stdout.trim(), `OPEN-FILE ${path.join(root, FOLDER, "연락서.pdf")}`, result.stderr);
    assert.equal(result.code, 0);
  });

  // ── 🔴 거절 ─────────────────────────────────────────────────────────────

  const FORBIDDEN_EXTENSIONS = [
    "exe", "bat", "cmd", "ps1", "vbs", "js", "lnk", "url",
    "scf", "msi", "reg", "hta", "com", "scr", "jar", "pif",
  ];
  for (const extension of FORBIDDEN_EXTENSIONS) {
    test(`🔴 허용 목록 밖은 거절 — .${extension}`, async () => {
      await assertOutcome([rawFileLink(`${FOLDER}/무언가.${extension}`)], "REJECT bad-extension", 3);
    });
  }

  test("🔴 디스크에 실제로 있는 실행 파일도 거절 — 있다고 열리지 않는다", async () => {
    for (const name of ["설치.exe", "실행.BAT", "바로가기.lnk"]) {
      await assertOutcome([rawFileLink(`${FOLDER}/${name}`)], "REJECT bad-extension", 3);
    }
    assert.equal(existsSync(path.join(root, FOLDER, "설치.exe")), true, "시험 준비가 틀렸다");
  });

  test("🔴 대문자 확장자도 거절 — 접어서 본다", async () => {
    for (const name of ["무언가.EXE", "무언가.Exe", "무언가.PS1", "무언가.LnK"]) {
      await assertOutcome([rawFileLink(`${FOLDER}/${name}`)], "REJECT bad-extension", 3);
    }
  });

  test("🔴 확장자 없는 이름은 거절 — 점이 없는 것 · 점이 맨 앞인 것", async () => {
    for (const name of ["문서", "연락서사본", ".pdf", ".xlsm"]) {
      await assertOutcome([rawFileLink(`${FOLDER}/${name}`)], "REJECT bad-extension", 3);
    }
  });

  test("🔴 끝에 점 · 공백이 붙은 이름은 거절 — Windows 가 조용히 떼어 다른 것을 연다", async () => {
    for (const name of ["보고서.pdf.", "보고서.pdf ", "보고서.pdf. ", "보고서.exe."]) {
      await assertOutcome([rawFileLink(`${FOLDER}/${name}`)], "REJECT bad-path", 3);
    }
  });

  test("🔴 폴더에 .pdf 이름을 붙인 것은 거절 — 열리는 것은 파일뿐이다", async () => {
    await assertOutcome([fileLinkOf(`${FOLDER}/함정.pdf`)], "REJECT not-a-file", 3);
  });

  test("🔴 루트 자체 · 중간 폴더를 파일로 열려 해도 거절", async () => {
    // 확장자가 없으니 확장자 검사에서, 폴더 이름에 점이 있어도 허용 목록 밖이다.
    await assertOutcome([rawFileLink(FOLDER)], "REJECT bad-extension", 3);
  });

  test("🔴 바로 가기(정션)를 지나는 파일은 거절 — 루트 밖을 가리킬 수 있다", async () => {
    await assertOutcome([fileLinkOf(`${FOLDER}/바로가기/비밀 문서.pdf`)], "REJECT reparse-point", 3);
  });

  test("🔴 루트 밖은 거절 — .. · 절대 경로 · 다른 드라이브 · 다른 UNC", async () => {
    for (const relative of [
      "../바깥 폴더/비밀 문서.pdf",
      `${FOLDER}/../../바깥 폴더/비밀 문서.pdf`,
      "C:/Windows/win.ini",
      "/Windows/win.ini",
      "\\\\OTHERNAS\\share\\문서.pdf",
      "//OTHERNAS/share/문서.pdf",
      `${FOLDER}\\연락서.pdf`,
      `${FOLDER}/연락서.pdf:stream`,
      `${FOLDER}/연락\n서.pdf`,
      `${FOLDER}//연락서.pdf`,
    ]) {
      await assertOutcome([rawFileLink(relative)], "REJECT bad-path", 3);
    }
    // 규칙은 통과하지만 어느 루트 아래도 아닌 절대 경로 — outside-root 로 갈라 센다.
    await assertOutcome([rawFileLink(path.join(outside, "비밀 문서.pdf").replace(/\\/g, "/"))], "REJECT bad-path", 3);
  });

  test("🔴 base64 가 비표준이거나 깨졌으면 거절", async () => {
    const body = fileLinkOf(`${FOLDER}/연락서.pdf`).slice(QUOTE_FOLDER_FILE_LINK_PREFIX.length);
    for (const encoded of [
      "",
      `${body}=`,
      `${body}+`,
      "YR",
      "A",
      Buffer.from([0xff]).toString("base64url"),
      Buffer.from([0xed, 0xa0, 0x80]).toString("base64url"),
    ]) {
      await assertOutcome([`${QUOTE_FOLDER_FILE_LINK_PREFIX}${encoded}`], "REJECT bad-encoding", 2);
    }
  });

  test("🔴 모양 아닌 주소는 거절 — 접두어가 조금만 달라도", async () => {
    const body = fileLinkOf(`${FOLDER}/연락서.pdf`).slice(QUOTE_FOLDER_FILE_LINK_PREFIX.length);
    for (const link of [
      `dss-folder://openfile/?q=${body}`,
      `DSS-FOLDER://openfile/?p=${body}`,
      `dss-folder://openFile/?p=${body}`,
      `dss-folder://open-file/?p=${body}`,
      `dss-file://openfile/?p=${body}`,
      `${QUOTE_FOLDER_FILE_LINK_PREFIX}${"A".repeat(QUOTE_FOLDER_LINK_MAX_ENCODED_LENGTH + 4)}`,
    ]) {
      await assertOutcome([link], "REJECT not-a-folder-link", 2);
    }
  });

  test("🔴 인자가 없거나 둘 이상이면 거절 — 끼워 넣은 명령이 돌지 않는다", async () => {
    const link = fileLinkOf(`${FOLDER}/연락서.pdf`);
    await assertOutcome([], "REJECT argument-count", 2);
    await assertOutcome([link, link], "REJECT argument-count", 2);
    const plant = `New-Item -ItemType File -Path '${canary}'`;
    const tail = `-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "${scriptPath}" "${QUOTE_FOLDER_FILE_LINK_PREFIX}QQ" -Command "${plant}"`;
    const result = await runPowerShell([tail], { env: { DSS_FOLDER_DRY_RUN: "1" }, verbatim: true });
    assert.equal(result.stdout.trim(), "REJECT argument-count", result.stderr);
    assert.equal(result.code, 2);
    assert.equal(existsSync(canary), false, "🔴 끼워 넣은 명령이 돌았다");
  });

  test("🔴 삽입 시도 — 인자 하나 안의 따옴표 · 세미콜론 · $( ) 는 문자열일 뿐이다", async () => {
    const plant = `New-Item -ItemType File -Path '${canary}'`;
    await assertOutcome([`${QUOTE_FOLDER_FILE_LINK_PREFIX}QQ"; ${plant}; "`], "REJECT bad-encoding", 2);
    await assertOutcome([`${QUOTE_FOLDER_FILE_LINK_PREFIX}$(${plant})`], "REJECT bad-encoding", 2);
    assert.equal(existsSync(canary), false, "🔴 끼워 넣은 명령이 돌았다");
  });

  test("없는 파일은 NOT-FOUND — 지어내지 않는다", async () => {
    await assertOutcome([fileLinkOf(`${FOLDER}/없는 파일.pdf`)], "NOT-FOUND", 4);
  });

  // ── 🔴 폴더 쪽(open/)은 한 글자도 바뀌지 않았다 ──────────────────────────

  test("🔴 폴더 주소는 예전 그대로 — 폴더는 열리고, 파일을 가리키면 NOT-FOUND", async () => {
    await assertOutcome([linkOf(FOLDER)], `OPEN ${path.join(root, FOLDER)}`, 0);
    await assertOutcome([linkOf(`${FOLDER}/연락서.pdf`)], "NOT-FOUND", 4);
    await assertOutcome([linkOf(`${FOLDER}/설치.exe`)], "NOT-FOUND", 4);
  });

  test("🔴 파일 주소로 폴더를 열 수 없고, 폴더 주소로 파일을 열 수 없다", async () => {
    // 폴더 이름에 허용 확장자를 붙여도(함정.pdf) 파일이 아니라 거절이다.
    await assertOutcome([fileLinkOf(`${FOLDER}/함정.pdf`)], "REJECT not-a-file", 3);
    // 거꾸로, 폴더 주소에 파일 경로를 넣으면 「폴더가 없다」로 끝난다.
    await assertOutcome([linkOf(`${FOLDER}/연락서.xlsm`)], "NOT-FOUND", 4);
  });
});

// ── 🔴 PDF 변환(xlsx2pdf) — 이 도우미가 **처음으로 파일을 쓴다** ─────────────

/**
 * ============================================================================
 * 🔴 조각 — `dss-folder://xlsx2pdf/?p=…` 는 **쓰는** 명령이다 (2026-10-08)
 * ============================================================================
 * 앞의 두 명령은 읽기만 했다. 이것은 공유폴더에 PDF 를 **쓴다.** 그래서 이 블록은 두 가지를
 * 본다:
 *  1. 🔴 **쓸 수 있는 곳이 하나뿐인가** — 원본과 같은 폴더의, 원본과 같은 이름의 `.pdf`.
 *     주소는 결과 자리를 고르지 못한다(경로를 하나만 받는다). 그리고 그 하나도 루트 안 ·
 *     바로 가기 검사를 다시 지난다.
 *  2. 🔴 **기존 두 명령이 한 글자도 안 바뀌었는가** — 글자 그대로의 덩어리를 맞춰 본다.
 * 🔴 **시험은 Excel 을 부르지 않는다.** DSS_FOLDER_DRY_RUN=1 에서는 「어디에 쓸 것인가」까지만
 * 적고 끝나므로, 디스크에 아무것도 쓰지 않고 결과 경로 규칙을 값으로 확인할 수 있다. Excel 을
 * 숨기고 finally 로 닫는 것은 **본문**으로 본다(아래 「본문」 블록).
 * ============================================================================
 */

/** 규칙을 거치지 않고 아무 문자열이나 **PDF 변환** 주소로 싼다 — 다른 사이트가 만든 주소 흉내. */
function rawConvertLink(text: string): string {
  return `${QUOTE_FOLDER_XLSX2PDF_LINK_PREFIX}${Buffer.from(text, "utf8").toString("base64url")}`;
}

/** 여러 줄을 스크립트의 줄 끝(CRLF)으로 잇는다 — 「글자 그대로 같은가」를 보려고. */
function crlf(lines: readonly string[]): string {
  return lines.join("\r\n");
}

describe("🔴 PDF 변환 — 스크립트 본문", () => {
  const script = buildQuoteFolderHelperScript({ uncRoot: FAKE_UNC });

  test("셋째 접두어와 확장자가 서버 상수 그대로 박힌다", () => {
    assert.equal(QUOTE_FOLDER_XLSX2PDF_LINK_PREFIX, "dss-folder://xlsx2pdf/?p=");
    assert.equal(QUOTE_FOLDER_XLSX2PDF_SOURCE_EXTENSION, "xlsx");
    assert.equal(QUOTE_FOLDER_XLSX2PDF_OUTPUT_EXTENSION, "pdf");
    assert.ok(script.includes(`$ConvertPrefix = '${QUOTE_FOLDER_XLSX2PDF_LINK_PREFIX}'\r\n`));
    assert.ok(script.includes(`$ConvertSourceSuffix = '.${QUOTE_FOLDER_XLSX2PDF_SOURCE_EXTENSION}'\r\n`));
    assert.ok(script.includes(`$ConvertOutputSuffix = '.${QUOTE_FOLDER_XLSX2PDF_OUTPUT_EXTENSION}'\r\n`));
  });

  /**
   * 🔴 **상수가 domain 으로 옮겨 가도 스크립트는 한 글자도 바뀌지 않는다**(2026-10-08 오후).
   * 세 상수(접두어 · 원본 확장자 · 결과 확장자)는 화면이 읽을 수 있어야 해서
   * domain/quote-folder-xlsx2pdf-link.ts 로 옮겼고, server 쪽은 그것을 다시 내보낸다.
   * 값이 한 글자라도 달라지면 **이미 설치된 도우미가 새 주소를 못 알아듣는다** — 그런데
   * 위 시험들은 상수를 양쪽에 똑같이 끼워 넣어 견주므로 **값이 함께 바뀌면 통과한다.**
   * 그래서 여기서는 **스크립트 전체의 바이트**를 옮기기 **직전**에 잰 값으로 못 박는다.
   *
   * 🔴 재는 입력은 아래 세 루트로 고정이다.
   * 이 시험이 깨지면 스크립트가 **정말로** 바뀐 것이다 — 일부러 바꾼 조각이라면 그 조각이
   * 새 값을 적고 **무엇을 왜 바꿨는지**를 여기 주석에 남긴다.
   *
   * ── 값이 바뀐 자취 ─────────────────────────────────────────────────────────
   *  · 길이 16015 · `22783ebc…` — 2026-10-08 오후, 세 상수를 domain 으로 옮기기 직전.
   *  · 길이 16123 · `76f85922…` — 🔴 **2026-10-08, 「그 탭만 내보낸다」로 일부러 바꿨다.**
   *    바꾼 줄은 **셋뿐**이다: `$book.ExportAsFixedFormat(0, $pdf)` →
   *    `$book.ActiveSheet.ExportAsFixedFormat(0, $pdf)` 와 그 위 주석 두 줄.
   *    양식 파일 하나에 시트가 여럿이라 통합문서 전체를 내보내면 인쇄 영역이 잡힌 다른
   *    시트가 함께 딸려 나갔다(내자 견적서 PDF 에 OH 장이 붙어 나간다 — 사용자 요구).
   *    🔴 울타리(검사 여덟~열하나 · 덮어쓰기 · 창 숨김 · `finally` 닫기)는 **한 글자도
   *    바뀌지 않았다** — 바로 아래 시험들이 그 줄들을 글자 그대로 다시 센다.
   */
  test("🔴 상수를 domain 으로 옮겨도 스크립트 글자가 안 바뀐다 — 전체 sha256", () => {
    const fixed = buildQuoteFolderHelperScript({
      uncRoot: String.raw`\\NAS\견적서`,
      uncRootAlt: String.raw`\\10.0.0.9\견적서`,
      extraRoots: [String.raw`Z:\현황표`],
    });
    assert.equal(fixed.length, 16123);
    assert.equal(
      createHash("sha256").update(fixed, "utf8").digest("hex"),
      "76f85922a93cd2abb92515c20f8c39ab4498585240edf7630761bef7403e8c55"
    );
  });

  /**
   * 🔴 **이 시험이 이 조각의 중심이다.** 설계가 금지한 것은 「결과 경로를 받는 것」이다 —
   * 받으면 이 명령은 「아무 데나 쓰기」가 된다. 그래서 `$pdf` 가 **오직 `$full` 에서만** 나오고,
   * `$relative`(주소가 나른 글자)에서는 나오지 않는 것을 본문으로 못 박는다.
   */
  test("🔴 결과 경로는 주소가 아니라 원본에서 나온다 — $pdf 를 만드는 자리가 하나뿐이다", () => {
    const made = script.split("\r\n").filter((line) => /^\s*\$pdf = /.test(line));
    assert.deepEqual(made, [
      "  $pdf = ''",
      "      $pdf = $full.Substring(0, $full.Length - $ConvertSourceSuffix.Length) + $ConvertOutputSuffix",
    ]);
    // 🔴 주소가 나른 글자에서 결과를 만들지 않는다 — $relative 는 $pdf 쪽에 한 번도 안 붙는다.
    assert.equal(/\$pdf[^\r\n]*\$relative/.test(script), false);
    assert.equal(/\$relative[^\r\n]*\$pdf = /.test(script), false);
  });

  test("🔴 검사 8~11 이 본문에 순서대로 있다 — 확장자 · 같은 폴더 · 같은 이름 · 루트 안 · 쓸 자리", () => {
    const marks = [
      // 8 — .xlsx 하나뿐
      "function Test-XlsxFileName([string]$Name) {",
      "  return ($Name.Substring($dot).ToLowerInvariant() -ceq $ConvertSourceSuffix)",
      "    if (-not (Test-XlsxFileName $segments[$segments.Length - 1])) { Stop-Helper 'REJECT bad-extension' 3 }",
      // 9 — 결과는 원본에서, 같은 폴더 · 같은 이름
      "    if ($full.EndsWith($ConvertSourceSuffix, [System.StringComparison]::OrdinalIgnoreCase)) {",
      "    if ($pdf.Length -eq 0) { Stop-Helper 'REJECT bad-output' 3 }",
      "    if ([System.IO.Path]::GetDirectoryName($pdf) -cne [System.IO.Path]::GetDirectoryName($full)) { Stop-Helper 'REJECT bad-output' 3 }",
      "    if ([System.IO.Path]::GetFileName($pdf) -cne ([System.IO.Path]::GetFileNameWithoutExtension($full) + $ConvertOutputSuffix)) { Stop-Helper 'REJECT bad-output' 3 }",
      // 10 — 루트 담김 검사를 **결과에도**
      "    if (-not $pdf.StartsWith($targetRoot + '\\', [System.StringComparison]::OrdinalIgnoreCase)) { Stop-Helper 'REJECT outside-root' 3 }",
      // 11 — 쓸 자리가 바로 가기 · 폴더면 거절
      "    if (-not (Test-WritableOutput $pdf)) { Stop-Helper 'REJECT bad-output' 3 }",
    ];
    let previous = -1;
    for (const mark of marks) {
      const at = script.indexOf(mark);
      assert.ok(at >= 0, `없다: ${mark}`);
      assert.ok(at > previous, `순서가 어긋났다: ${mark}`);
      previous = at;
    }
    // 🔴 결과 쪽 담김 검사는 **원본이 실제로 걸린 그 루트**로 한다(아무 루트가 아니다).
    assert.ok(script.includes("    $targetRoot = $rootFull\r\n"));
  });

  test("🔴 Test-WritableOutput — 없으면 참 · 바로 가기와 폴더는 거짓 · 확인 못 하면 거짓", () => {
    const body = script.slice(
      script.indexOf("function Test-WritableOutput([string]$Path) {"),
      script.indexOf("# 상대 경로 규칙 — 서버의 domain/quote-folder-link.ts 와 같다.")
    );
    assert.ok(body.includes("  } catch [System.IO.FileNotFoundException] {\r\n    return $true"), body);
    assert.ok(body.includes("if (($attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) { return $false }"));
    assert.ok(body.includes("if (($attributes -band [System.IO.FileAttributes]::Directory) -ne 0) { return $false }"));
    // 확인하지 못한 자리에는 쓰지 않는다 — 그 밖의 예외는 전부 거짓.
    assert.ok(body.includes("  } catch {\r\n    return $false"), body);
  });

  /**
   * 🔴 쓰는 자리를 **센다.** 머리말의 약속은 「이 스크립트가 파일을 쓰는 곳은 하나」다.
   * 지우는 것(Delete)도 내보내는 것(ExportAsFixedFormat)도 **각각 한 번**이고, 둘 다 인자가
   * `$pdf` 다. 그 밖의 쓰기 수단은 예전 금지 목록 그대로 하나도 없다(위 「탐색기와 연결
   * 프로그램 말고는…」 시험).
   */
  test("🔴 파일을 쓰는 곳이 딱 하나다 — Delete 하나 · ExportAsFixedFormat 하나, 둘 다 $pdf", () => {
    assert.equal(script.match(/::Delete\(/g)?.length, 1);
    assert.ok(script.includes("if ([System.IO.File]::Exists($pdf)) { [System.IO.File]::Delete($pdf) }"));
    assert.equal(script.match(/ExportAsFixedFormat/g)?.length, 1);
    assert.ok(script.includes("$book.ActiveSheet.ExportAsFixedFormat(0, $pdf)"));
    // 🔴 원본은 **읽기 전용**으로 열고 저장하지 않고 닫는다 — 원본 .xlsx 를 바꾸지 않는다.
    assert.ok(script.includes("$book = $excel.Workbooks.Open($full, 0, $true)"));
    assert.ok(script.includes("$book.Close($false)"));
    assert.equal(script.includes(".Save()"), false);
    assert.equal(script.includes("SaveAs"), false);
  });

  /**
   * ============================================================================
   * 🔴 2026-10-08 — **활성 시트 하나만** 내보낸다
   * ============================================================================
   * 견적서 양식은 **한 파일에 시트가 여럿**이다(내자 양식은 `내자견적서` · `OH견적서` ·
   * `Sheet1`). 통합문서째 내보내면 인쇄 영역이 잡힌 다른 시트가 함께 딸려 나가서, 내자
   * 견적서를 저장했는데 PDF 에 OH 장이 붙어 고객사로 간다(사용자 요구 2026-10-08).
   *
   * 🔴 **어느 시트가 활성인지는 도우미가 정하지 않는다** — 서버가 엑셀을 만들 때 그 종류의
   * 시트를 활성으로 두고 보낸다(xlsx/active-sheet.ts). 도우미는 받은 파일이 말하는 대로
   * 한 장만 내보낼 뿐이다. 그래서 여기서는 **「통합문서째 내보내는 자리가 없다」**를 센다.
   * ============================================================================
   */
  test("🔴 활성 시트 하나만 내보낸다 — 통합문서째 내보내는 자리가 없다", () => {
    assert.ok(script.includes("        $book.ActiveSheet.ExportAsFixedFormat(0, $pdf)\r\n"));
    // 🔴 예전 줄(통합문서째)이 한 자리도 남아 있지 않다.
    assert.equal(/\$book\.ExportAsFixedFormat/.test(script), false);
    // 활성 시트를 집는 자리도 내보내는 자리도 **각각 하나**다.
    assert.equal(script.match(/ActiveSheet/g)?.length, 1);
    assert.equal(script.match(/ExportAsFixedFormat/g)?.length, 1);
    // 🔴 「어느 탭인가」를 도우미가 정하지 않는다 — 시트를 이름 · 번호로 집거나 고르는
    //    자리가 하나도 없다. 그 판단은 서버에만 있다(xlsx/active-sheet.ts).
    for (const forbidden of ["Worksheets", "Sheets(", "SelectedSheets", ".Activate(", ".Select("]) {
      assert.equal(script.includes(forbidden), false, `도우미가 시트를 고른다: ${forbidden}`);
    }
  });

  /**
   * 🔴 **그 한 줄 말고는 아무것도 안 바뀌었다**(2026-10-08). 변환 덩어리를 여는 곳부터
   * `finally` 까지 **글자 그대로** 맞춘다 — 덮어쓰기 · 창 숨김 · 읽기 전용 열기 · 닫기가
   * 예전 자리에 예전 모양으로 있고, 가운데 한 줄만 `ActiveSheet` 가 붙었다.
   */
  test("🔴 변환 덩어리의 다른 줄은 한 글자도 안 바뀌었다 — 덩어리를 그대로 맞춘다", () => {
    assert.ok(
      script.includes(
        crlf([
          "      try { $excel = New-Object -ComObject Excel.Application } catch { $excel = $null }",
          "      if ($null -eq $excel) {",
          "        $failed = 'no-excel'",
          "      } else {",
          "        $excel.Visible = $false",
          "        $excel.DisplayAlerts = $false",
          "        $book = $excel.Workbooks.Open($full, 0, $true)",
          "        # 🔵 덮어씁니다 — 지우는 것은 위에서 정한 이 한 경로뿐입니다.",
          "        if ([System.IO.File]::Exists($pdf)) { [System.IO.File]::Delete($pdf) }",
        ])
      ),
      "변환 덩어리의 앞부분이 바뀌었다"
    );
    assert.ok(
      script.includes(
        crlf([
          "        $book.ActiveSheet.ExportAsFixedFormat(0, $pdf)",
          "      }",
          "    } catch {",
          "      $failed = 'convert'",
          "    } finally {",
          "      if ($null -ne $book) { try { $book.Close($false) } catch { } }",
          "      if ($null -ne $excel) { try { $excel.Quit() } catch { } }",
        ])
      ),
      "변환 덩어리의 뒷부분이 바뀌었다"
    );
  });

  test("🔴 Excel 창을 숨기고 finally 로 닫는다 — 유령 프로세스가 쌓이지 않는다", () => {
    const hidden = script.indexOf("        $excel.Visible = $false");
    const open = script.indexOf("$book = $excel.Workbooks.Open($full, 0, $true)");
    const finallyAt = script.indexOf("    } finally {");
    const close = script.indexOf("if ($null -ne $book) { try { $book.Close($false) } catch { } }");
    const quit = script.indexOf("if ($null -ne $excel) { try { $excel.Quit() } catch { } }");
    const release = script.indexOf("ReleaseComObject($excel)");
    assert.ok(hidden >= 0, "Visible = $false 가 없다");
    // 🔴 창을 띄우지 않는다 — $true 로 되돌려 놓는 자리가 없다.
    assert.equal(script.includes("$excel.Visible = $true"), false);
    assert.ok(hidden < open, "여는 것보다 숨기는 것이 먼저다");
    assert.ok(open < finallyAt, finallyAt.toString());
    assert.ok(finallyAt < close && close < quit && quit < release, "finally 안에서 닫고 끝내고 놓는다");
    // 🔴 끝내는 일은 전부 finally 안이다 — try 쪽에는 Quit 이 없다.
    assert.equal(script.match(/\$excel\.Quit\(\)/g)?.length, 1);
    assert.equal(script.match(/\$book\.Close\(/g)?.length, 1);
    assert.ok(script.includes("[System.GC]::WaitForPendingFinalizers()"));
    // Excel 이 없는 PC 는 조용히 끝난다 — 끝냄 5.
    assert.ok(script.includes("if ($failed -ceq 'no-excel') { Stop-Helper 'REJECT no-excel' 5 }"));
  });

  /**
   * 🔴 **이 조각의 약속 — 기존 두 명령은 한 글자도 바뀌지 않았다.**
   * 가지를 하나 **끼워 넣기만** 했으므로, 예전 덩어리가 글자 그대로 남아 있어야 한다.
   */
  test("🔴 기존 두 명령(open/ · openfile/)이 한 글자도 안 바뀌었다 — 덩어리를 그대로 맞춘다", () => {
    const untouched = [
      // 주소를 가르는 자리 — 폴더 가지와 파일 가지, 그리고 그 뒤의 else.
      crlf([
        "  if ($link.StartsWith($Prefix, [System.StringComparison]::Ordinal)) {",
        "    if ($link.Length -gt ($Prefix.Length + $MaxEncodedLength)) { Stop-Helper 'REJECT not-a-folder-link' 2 }",
        "    $encoded = $link.Substring($Prefix.Length)",
        "  } elseif ($link.StartsWith($FilePrefix, [System.StringComparison]::Ordinal)) {",
        "    if ($link.Length -gt ($FilePrefix.Length + $MaxEncodedLength)) { Stop-Helper 'REJECT not-a-folder-link' 2 }",
        "    $Mode = 'file'",
        "    $encoded = $link.Substring($FilePrefix.Length)",
      ]),
      crlf(["  } else {", "    Stop-Helper 'REJECT not-a-folder-link' 2", "  }"]),
      // 파일 쪽 확장자 검사 — 허용 목록 그대로.
      crlf([
        "  if ($Mode -ceq 'file') {",
        "    $segments = $relative.Split([char]'/')",
        "    if (-not (Test-OpenableFileName $segments[$segments.Length - 1])) { Stop-Helper 'REJECT bad-extension' 3 }",
        "  }",
      ]),
      // 루트 고리 — 파일 가지와 폴더 가지.
      crlf([
        "      $state = Test-FileState $full",
        "      if ($state -ceq 'directory') { $NotAFile = $true; break }",
        "      if ($state -cne 'found') { continue }",
      ]),
      crlf(["    } else {", "      # (f) 폴더가 아니면(없음 · 파일 · 서버에 못 닿음) 다음 루트로.", "      if ((Test-FolderState $full) -ne 'found') { continue }", "    }"]),
      // 여는 자리 — 파일(연결 프로그램)과 폴더(탐색기).
      crlf([
        "  if ($Mode -ceq 'file') {",
        "    if ([System.IO.Directory]::Exists($full)) { Stop-Helper 'REJECT not-a-file' 3 }",
        "    if (-not [System.IO.File]::Exists($full)) { Stop-Helper 'NOT-FOUND' 4 }",
        "    Start-Process -FilePath $full",
        "    exit 0",
        "  }",
      ]),
      crlf([
        "  if (-not [System.IO.Directory]::Exists($full)) { Stop-Helper 'NOT-FOUND' 4 }",
        "  $start = New-Object System.Diagnostics.ProcessStartInfo",
        "  $start.FileName = Join-Path $env:SystemRoot 'explorer.exe'",
        `  $start.Arguments = '"' + $full + '\\"'`,
        "  $start.UseShellExecute = $false",
        "  [void][System.Diagnostics.Process]::Start($start)",
        "  exit 0",
      ]),
      // 두 명령의 DRY_RUN 줄 — 글자 그대로.
      "  if ($DryRun -and ($Mode -ceq 'file')) { Stop-Helper ('OPEN-FILE ' + $full) 0 }\r\n",
      "  if ($DryRun) { Stop-Helper ('OPEN ' + $full) 0 }\r\n",
    ];
    for (const block of untouched) {
      assert.ok(script.includes(block), `바뀌었다:\n${block}`);
    }
    // 🔴 가지는 셋뿐이다 — 접두어를 보는 자리가 늘지도 줄지도 않았다.
    assert.equal(script.match(/\$link\.StartsWith\(/g)?.length, 3);
  });
});

describe("🔴 PDF 변환 — DSS_FOLDER_DRY_RUN=1 로 실제로 돌린다", { skip: WINDOWS_ONLY, concurrency: 4 }, () => {
  const FOLDER = "D260908 INVENIA T2RCONT-AD2 WN3947 1802034 점검요청";
  let parent = "";
  let root = "";
  let outside = "";
  let scriptPath = "";
  let namesBefore: string[] = [];

  before(async () => {
    parent = await mkdtemp(path.join(os.tmpdir(), "dss-folder-xlsx2pdf-test-"));
    root = path.join(parent, "연락서 공유폴더");
    outside = path.join(parent, "바깥 폴더");
    await mkdir(path.join(root, FOLDER), { recursive: true });
    await mkdir(outside, { recursive: true });
    await writeFile(path.join(outside, "바깥 장부.xlsx"), "x");

    await writeFile(path.join(root, FOLDER, "D260908 연락서 (주)한국 & 제어 100%.xlsx"), "x");
    await writeFile(path.join(root, FOLDER, "대문자.XLSX"), "x");
    await writeFile(path.join(root, FOLDER, "점.둘.있는.xlsx"), "x");
    // 🔴 결과 자리에 **보통 파일**이 이미 있다 — 덮어쓰기(사용자 결정)라 통과해야 한다.
    await writeFile(path.join(root, FOLDER, "덮어쓰기.xlsx"), "x");
    await writeFile(path.join(root, FOLDER, "덮어쓰기.pdf"), "낡은 PDF");
    // 🔴 .xlsx 밖 — 디스크에 **실제로 있어도** 거절해야 한다.
    for (const name of ["연락서.xlsm", "연락서.xls", "연락서.pdf", "설치.exe", "문서"]) {
      await writeFile(path.join(root, FOLDER, name), "x");
    }
    // 🔴 폴더에 .xlsx 이름을 붙인 함정.
    await mkdir(path.join(root, FOLDER, "함정.xlsx"), { recursive: true });
    // 🔴 **결과 자리가 바로 가기**인 함정 — 원본은 멀쩡한 파일이지만 쓸 곳이 루트 밖을 가리킨다.
    await writeFile(path.join(root, FOLDER, "출력함정.xlsx"), "x");
    await symlink(outside, path.join(root, FOLDER, "출력함정.pdf"), "junction");
    // 🔴 지나는 길이 바로 가기.
    await symlink(outside, path.join(root, FOLDER, "바로가기"), "junction");

    scriptPath = path.join(parent, "open-dss-folder.ps1");
    await writeFile(scriptPath, quoteFolderHelperScriptBytes({ uncRoot: root }));
    namesBefore = (await readdir(path.join(root, FOLDER))).sort();
  });

  after(async () => {
    if (parent) await rm(parent, { recursive: true, force: true });
  });

  function runHelper(args: readonly string[]): Promise<RunResult> {
    return runPowerShell(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", scriptPath, ...args], {
      env: { DSS_FOLDER_DRY_RUN: "1" },
    });
  }

  async function assertOutcome(args: readonly string[], expected: string, code: number): Promise<void> {
    const result = await runHelper(args);
    assert.equal(result.stdout.trim(), expected, `stderr: ${result.stderr}`);
    assert.equal(result.code, code);
  }

  /** 원본 이름 하나를 주면 `XLSX2PDF <원본> -> <결과>` 를 기대한다. */
  function expectedLine(name: string, pdfName: string): string {
    return `XLSX2PDF ${path.join(root, FOLDER, name)} -> ${path.join(root, FOLDER, pdfName)}`;
  }

  // ── 통과해야 하는 것 ─────────────────────────────────────────────────────

  test("🔴 결과는 원본과 같은 폴더의 같은 이름 .pdf 다 — 다른 곳에 쓸 수 없다", async () => {
    const name = "D260908 연락서 (주)한국 & 제어 100%.xlsx";
    const result = await runHelper([rawConvertLink(`${FOLDER}/${name}`)]);
    assert.equal(result.code, 0, result.stderr);
    const [source, output] = result.stdout.trim().replace("XLSX2PDF ", "").split(" -> ");
    // 🔴 폴더가 같다 · 이름이 확장자만 다르다 — 이 둘이 「아무 데나 쓰기」를 막는 규칙 전부다.
    assert.equal(path.dirname(output), path.dirname(source));
    assert.equal(path.basename(output), `${path.basename(source, ".xlsx")}.pdf`);
    assert.equal(output, path.join(root, FOLDER, "D260908 연락서 (주)한국 & 제어 100%.pdf"));
    // 🔴 결과도 루트 아래다.
    assert.ok(output.toLowerCase().startsWith(`${root.toLowerCase()}\\`), output);
  });

  test("🔴 대문자 .XLSX 도 받고, 결과는 소문자 .pdf 다", async () => {
    await assertOutcome([rawConvertLink(`${FOLDER}/대문자.XLSX`)], expectedLine("대문자.XLSX", "대문자.pdf"), 0);
  });

  test("🔴 이름에 점이 여럿이면 **맨 뒤 확장자만** 바뀐다", async () => {
    await assertOutcome([rawConvertLink(`${FOLDER}/점.둘.있는.xlsx`)], expectedLine("점.둘.있는.xlsx", "점.둘.있는.pdf"), 0);
  });

  test("🔵 같은 이름의 PDF 가 이미 있어도 통과한다 — 덮어쓴다(사용자 결정)", async () => {
    await assertOutcome([rawConvertLink(`${FOLDER}/덮어쓰기.xlsx`)], expectedLine("덮어쓰기.xlsx", "덮어쓰기.pdf"), 0);
    // 🔴 DRY_RUN 이라 낡은 PDF 는 그대로다 — 시험이 디스크를 건드리지 않았다.
    assert.equal(await readFile(path.join(root, FOLDER, "덮어쓰기.pdf"), "utf8"), "낡은 PDF");
  });

  test("레지스트리 명령과 같은 모양으로 불러도 돈다", async () => {
    const link = rawConvertLink(`${FOLDER}/대문자.XLSX`);
    const tail = `-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "${scriptPath}" "${link}"`;
    const result = await runPowerShell([tail], { env: { DSS_FOLDER_DRY_RUN: "1" }, verbatim: true });
    assert.equal(result.stdout.trim(), expectedLine("대문자.XLSX", "대문자.pdf"), result.stderr);
    assert.equal(result.code, 0);
  });

  // ── 🔴 거절 ─────────────────────────────────────────────────────────────

  test("🔴 .xlsx 가 아니면 거절한다 — .xlsm · .xls · .pdf 까지(읽기 허용 목록보다 좁다)", async () => {
    for (const name of ["연락서.xlsm", "연락서.xls", "연락서.pdf", "설치.exe", "문서", ".xlsx", "연락서.xlsxx"]) {
      await assertOutcome([rawConvertLink(`${FOLDER}/${name}`)], "REJECT bad-extension", 3);
    }
    // 읽기 쪽 허용 목록에는 .xlsm 이 들어 있다 — 🔴 **두 목록은 일부러 다르다.**
    assert.ok(QUOTE_FOLDER_OPENABLE_EXTENSIONS.includes("xlsm"));
    assert.notEqual(QUOTE_FOLDER_XLSX2PDF_SOURCE_EXTENSION, "xlsm");
  });

  test("🔴 폴더를 가리키면 거절 — 루트 자체 · 중간 폴더 · .xlsx 이름을 붙인 폴더", async () => {
    await assertOutcome([rawConvertLink(FOLDER)], "REJECT bad-extension", 3);
    await assertOutcome([rawConvertLink(`${FOLDER}/함정.xlsx`)], "REJECT not-a-file", 3);
  });

  test("🔴 루트 밖은 거절 — .. · 절대 경로 · 다른 드라이브 · 다른 UNC", async () => {
    for (const relative of [
      "../바깥 폴더/바깥 장부.xlsx",
      `${FOLDER}/../../바깥 폴더/바깥 장부.xlsx`,
      "C:/Windows/장부.xlsx",
      "/Windows/장부.xlsx",
      "\\\\OTHERNAS\\share\\장부.xlsx",
      "//OTHERNAS/share/장부.xlsx",
      `${FOLDER}\\연락서.xlsx`,
      `${FOLDER}/연락서.xlsx:stream`,
      `${FOLDER}//연락서.xlsx`,
      `${FOLDER}/연락서.xlsx.`,
      `${FOLDER}/연락서.xlsx `,
    ]) {
      await assertOutcome([rawConvertLink(relative)], "REJECT bad-path", 3);
    }
    await assertOutcome([rawConvertLink(path.join(outside, "바깥 장부.xlsx").replace(/\\/g, "/"))], "REJECT bad-path", 3);
  });

  test("🔴 바로 가기(정션)를 지나는 경로는 거절 — 읽는 쪽과 같은 잣대다", async () => {
    await assertOutcome([rawConvertLink(`${FOLDER}/바로가기/바깥 장부.xlsx`)], "REJECT reparse-point", 3);
  });

  /**
   * 🔴 **쓰기에만 있는 함정.** 원본은 루트 안의 멀쩡한 `.xlsx` 이고 지나는 길에도 바로 가기가
   * 없다 — 읽는 명령이었다면 통과했을 것이다. 그런데 **쓸 자리**(같은 이름의 `.pdf`)가 루트
   * 밖을 가리키는 바로 가기다. 거기에 쓰면 사내 서류함 밖에 쓰인다.
   */
  test("🔴 결과 자리가 바로 가기면 거절 — 원본이 멀쩡해도 쓰지 않는다", async () => {
    await assertOutcome([rawConvertLink(`${FOLDER}/출력함정.xlsx`)], "REJECT bad-output", 3);
  });

  test("없는 파일은 NOT-FOUND — 지어내지 않는다", async () => {
    await assertOutcome([rawConvertLink(`${FOLDER}/없는 장부.xlsx`)], "NOT-FOUND", 4);
  });

  test("🔴 모양 아닌 주소는 거절 — 접두어가 조금만 달라도", async () => {
    const body = rawConvertLink(`${FOLDER}/대문자.XLSX`).slice(QUOTE_FOLDER_XLSX2PDF_LINK_PREFIX.length);
    for (const link of [
      `dss-folder://xlsx2pdf/?q=${body}`,
      `DSS-FOLDER://xlsx2pdf/?p=${body}`,
      `dss-folder://XLSX2PDF/?p=${body}`,
      `dss-folder://xlsx2Pdf/?p=${body}`,
      `dss-folder://xlsx-2-pdf/?p=${body}`,
      `${QUOTE_FOLDER_XLSX2PDF_LINK_PREFIX}${"A".repeat(QUOTE_FOLDER_LINK_MAX_ENCODED_LENGTH + 4)}`,
    ]) {
      await assertOutcome([link], "REJECT not-a-folder-link", 2);
    }
  });

  test("🔴 인코딩이 표준이 아니면 거절 · 인자가 하나가 아니면 거절", async () => {
    for (const encoded of ["", "A", "YR", Buffer.from([0xff]).toString("base64url")]) {
      await assertOutcome([`${QUOTE_FOLDER_XLSX2PDF_LINK_PREFIX}${encoded}`], "REJECT bad-encoding", 2);
    }
    const link = rawConvertLink(`${FOLDER}/대문자.XLSX`);
    await assertOutcome([link, link], "REJECT argument-count", 2);
  });

  // ── 🔴 기존 두 명령은 그대로다 ──────────────────────────────────────────

  test("🔴 같은 폴더에서 폴더 열기 · 파일 열기가 예전 그대로 돈다", async () => {
    await assertOutcome([linkOf(FOLDER)], `OPEN ${path.join(root, FOLDER)}`, 0);
    await assertOutcome([fileLinkOf(`${FOLDER}/연락서.xlsm`)], `OPEN-FILE ${path.join(root, FOLDER, "연락서.xlsm")}`, 0);
    // 🔴 접두어가 동작을 가른다 — 같은 경로라도 명령이 다르면 결과가 다르다.
    await assertOutcome([fileLinkOf(`${FOLDER}/대문자.XLSX`)], `OPEN-FILE ${path.join(root, FOLDER, "대문자.XLSX")}`, 0);
    await assertOutcome([linkOf(`${FOLDER}/대문자.XLSX`)], "NOT-FOUND", 4);
  });

  /**
   * 🔴 「시험이 사내 서류함을 건드릴 뻔했다」와 같은 잣대 — **쓰는 명령을 시험하면서 디스크에
   * 아무것도 만들지 않았다**는 것을 숫자로 센다. DRY_RUN 이 Excel 앞에서 멈추기 때문이다.
   */
  test("🔴 이 블록이 돌아도 폴더 안이 그대로다 — 쓴 것이 하나도 없다", async () => {
    assert.deepEqual((await readdir(path.join(root, FOLDER))).sort(), namesBefore);
  });
});

// ── 루트 둘 ────────────────────────────────────────────────────────────────

/**
 * ============================================================================
 * 🔴 같은 폴더를 가리키는 주소가 둘일 때 — 차례로 해 보고 처음으로 있는 것을 연다
 * ============================================================================
 * 사내 PC 마다 이름(`\\DSS-NAS\…`)이 풀리기도 하고 안 되기도 한다. 하나만 두면 그 하나가
 * 안 닿는 PC 에서는 [폴더 열기]가 통째로 먹통이 된다. 그래서 둘을 심고 차례로 해 본다.
 *
 * 여기서 지키는 것은 **불변식 (a) 가 루트마다 그대로 산다**는 것이다 — 루트가 둘이 되었다고
 * 루트 밖이 열려서는 안 된다. 닿지 않는 주소는 「없는 폴더」와 같게 다뤄 다음 주소로 넘어간다.
 * ============================================================================
 */
describe("🔴 루트 둘 — 차례로 해 보고 처음으로 있는 것을 연다", { skip: WINDOWS_ONLY, concurrency: 2 }, () => {
  // 앞 블록의 YEAR · QUOTE 는 그 블록 안에만 있다 — 여기서 따로 둔다.
  const YEAR = "21. 2026 내자견적서";
  const QUOTE = "DSS 2026-089 (주)한국 & 제어 100%";
  let parent = "";
  let real = "";
  let second = "";
  let missing = "";

  before(async () => {
    parent = await mkdtemp(path.join(os.tmpdir(), "dss-folder-helper-roots-"));
    real = path.join(parent, "진짜 루트");
    second = path.join(parent, "둘째 루트");
    // 닿지 않는 주소를 흉내 낸다 — 없는 UNC 서버는 시험 기계에서 오래 기다리므로 없는 폴더로 둔다.
    missing = path.join(parent, "없는 루트");
    await mkdir(path.join(real, YEAR, QUOTE), { recursive: true });
    await mkdir(path.join(second, YEAR, QUOTE), { recursive: true });
  });

  after(async () => {
    if (parent) await rm(parent, { recursive: true, force: true });
  });

  /** 주어진 루트들로 도우미를 심고 한 번 돌린다. */
  async function runWithRoots(
    roots: { uncRoot: string; uncRootAlt?: string },
    relativePath: string
  ): Promise<RunResult> {
    const scriptPath = path.join(parent, `open-${Math.random().toString(36).slice(2)}.ps1`);
    await writeFile(scriptPath, quoteFolderHelperScriptBytes(roots));
    return runPowerShell(
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", scriptPath, linkOf(relativePath)],
      { env: { DSS_FOLDER_DRY_RUN: "1" } }
    );
  }

  test("첫째가 없으면 둘째로 연다 — 하나가 안 닿아도 열린다", async () => {
    const result = await runWithRoots({ uncRoot: missing, uncRootAlt: real }, `${YEAR}/${QUOTE}`);
    assert.equal(result.stdout.trim(), `OPEN ${path.join(real, YEAR, QUOTE)}`, result.stderr);
    assert.equal(result.code, 0);
  });

  /**
   * 🔴 2026-09-16 에 실제로 겪은 것. 없는 **로컬 폴더**는 Test-Path 가 얌전히 $false 를
   * 주지만, **풀리지 않는 서버 이름**은 던진다 — 스크립트가 $ErrorActionPreference = 'Stop'
   * 이라 바깥 catch 로 빠져 'REJECT error'(9)로 끝나고 둘째 주소를 시도조차 못 했다.
   * 위의 "없는 루트" 시험은 로컬 폴더라 이 차이를 못 잡았다. 그래서 하나 더 둔다.
   */
  test("🔴 첫째가 풀리지 않는 서버 이름이어도 둘째로 연다 — 던지는 것과 없는 것은 다르다", async () => {
    const unresolvable = "\\\\NOSUCHSERVER-DSS\\share";
    const result = await runWithRoots({ uncRoot: unresolvable, uncRootAlt: real }, `${YEAR}/${QUOTE}`);
    assert.equal(result.stdout.trim(), `OPEN ${path.join(real, YEAR, QUOTE)}`, result.stderr);
    assert.equal(result.code, 0);
  });

  test("첫째가 있으면 첫째로 연다 — 둘째는 보지 않는다", async () => {
    const result = await runWithRoots({ uncRoot: real, uncRootAlt: second }, `${YEAR}/${QUOTE}`);
    assert.equal(result.stdout.trim(), `OPEN ${path.join(real, YEAR, QUOTE)}`, result.stderr);
    assert.equal(result.code, 0);
  });

  test("둘 다 없으면 NOT-FOUND — 지어내지 않는다", async () => {
    const result = await runWithRoots({ uncRoot: missing, uncRootAlt: path.join(parent, "이것도 없다") }, YEAR);
    assert.equal(result.stdout.trim(), "NOT-FOUND");
    assert.equal(result.code, 4);
  });

  test("🔴 루트가 둘이어도 루트 밖은 열리지 않는다", async () => {
    // 규칙을 거치지 않고 싼 주소 — 다른 사이트가 만든 주소 흉내다. 둘째 루트가 실제로
    // 있으므로, 담김 검사가 루트마다 살아 있지 않으면 여기서 열려 버린다.
    const scriptPath = path.join(parent, "open-escape.ps1");
    await writeFile(scriptPath, quoteFolderHelperScriptBytes({ uncRoot: missing, uncRootAlt: real }));
    for (const escape of ["../진짜 루트", "..", `${YEAR}/../../진짜 루트`]) {
      const result = await runPowerShell(
        ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", scriptPath, rawLink(escape)],
        { env: { DSS_FOLDER_DRY_RUN: "1" } }
      );
      assert.equal(result.stdout.includes("OPEN"), false, escape);
      assert.equal(result.code, 3, escape);
    }
  });

  test("둘째를 주지 않으면 하나만 심는다", () => {
    const script = buildQuoteFolderHelperScript({ uncRoot: FAKE_UNC });
    assert.ok(script.includes(`$Roots = @('${FAKE_UNC}')\r\n`));
  });

  test("같은 값을 둘 주면 하나로 줄인다 — 없는 서버를 두 번 기다리지 않게", () => {
    const script = buildQuoteFolderHelperScript({ uncRoot: FAKE_UNC, uncRootAlt: FAKE_UNC.toLowerCase() });
    assert.ok(script.includes(`$Roots = @('${FAKE_UNC}')\r\n`));
  });

  test("둘을 주면 적은 차례 그대로 심는다", () => {
    const script = buildQuoteFolderHelperScript({ uncRoot: FAKE_UNC, uncRootAlt: "\\\\10.0.0.9\\archive" });
    assert.ok(script.includes(`$Roots = @('${FAKE_UNC}', '\\\\10.0.0.9\\archive')\r\n`));
  });

  test("둘째가 규칙 밖이면 만들지 않는다 — 오류에 값이 실리지 않는다", () => {
    assert.throws(
      () => buildQuoteFolderHelperScript({ uncRoot: FAKE_UNC, uncRootAlt: "\\\\TESTNAS\\it's" }),
      (error: unknown) => error instanceof QuoteFolderHelperRootError && !String(error).includes("it's")
    );
  });
});

// ── 서로 다른 폴더의 루트를 함께 ────────────────────────────────────────────

/**
 * ============================================================================
 * 🔴 루트가 **서로 다른 폴더**일 때 — 각각 아래가 열리고, 어느 쪽 아래도 아니면 안 열린다
 * ============================================================================
 * 고객사 현황표 폴더는 견적서 루트 **아래가 아니다**(2026-09-30 실측). 도우미는 PC 당 한 벌만
 * 설치되므로(레지스트리 자리가 하나) 따로 설치할 수 없다 — 한 벌에 루트를 여럿 심는다.
 *
 * 여기서 지키는 것은 위 「루트 둘」과 같다: **불변식 (a) 가 루트마다 그대로 산다.** 루트가
 * 늘었다고 (1) 루트 밖이 열려서도, (2) 바로 가기 폴더가 열려서도 안 되고, (3) 견적서 루트만
 * 설정된 PC 는 **예전과 글자 하나 다르지 않아야** 한다.
 * ============================================================================
 */
describe("🔴 루트가 여럿 — 서로 다른 공유폴더를 한 도우미가 안다", { skip: WINDOWS_ONLY, concurrency: 2 }, () => {
  const YEAR = "21. 2026 내자견적서";
  const QUOTE = "DSS 2026-089 (주)한국 & 제어 100%";
  const PORTAL = "3. 업체별 수리품현황";
  let parent = "";
  let quoteRoot = "";
  let portalRoot = "";
  let outside = "";
  let scriptPath = "";
  let quoteOnlyScriptPath = "";

  before(async () => {
    parent = await mkdtemp(path.join(os.tmpdir(), "dss-folder-helper-many-"));
    quoteRoot = path.join(parent, "견적 공유폴더");
    portalRoot = path.join(parent, "수리품 목록");
    outside = path.join(parent, "바깥 폴더");
    await mkdir(path.join(quoteRoot, YEAR, QUOTE), { recursive: true });
    await mkdir(path.join(portalRoot, PORTAL), { recursive: true });
    await mkdir(path.join(outside, "안쪽"), { recursive: true });
    // 둘째 루트 아래의 정션 — 루트 밖을 가리킨다.
    await symlink(outside, path.join(portalRoot, "바로가기"), "junction");

    scriptPath = path.join(parent, "open-many.ps1");
    await writeFile(scriptPath, quoteFolderHelperScriptBytes({ uncRoot: quoteRoot, extraRoots: [portalRoot] }));
    // 견적서만 설정된 PC — 설정을 바꾸지 않은 곳이 예전 그대로인지 본다.
    quoteOnlyScriptPath = path.join(parent, "open-quote-only.ps1");
    await writeFile(quoteOnlyScriptPath, quoteFolderHelperScriptBytes({ uncRoot: quoteRoot }));
  });

  after(async () => {
    if (parent) await rm(parent, { recursive: true, force: true });
  });

  function runScript(file: string, link: string): Promise<RunResult> {
    return runPowerShell(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", file, link], {
      env: { DSS_FOLDER_DRY_RUN: "1" },
    });
  }

  test("첫째 루트 아래의 폴더가 열린다 — 견적서", async () => {
    const result = await runScript(scriptPath, linkOf(`${YEAR}/${QUOTE}`));
    assert.equal(result.stdout.trim(), `OPEN ${path.join(quoteRoot, YEAR, QUOTE)}`, result.stderr);
    assert.equal(result.code, 0);
  });

  test("🔴 둘째 루트 아래의 폴더도 열린다 — 현황표(견적서 루트 아래가 아니다)", async () => {
    const result = await runScript(scriptPath, linkOf(PORTAL));
    assert.equal(result.stdout.trim(), `OPEN ${path.join(portalRoot, PORTAL)}`, result.stderr);
    assert.equal(result.code, 0);
  });

  test("🔴 어느 루트 아래도 아닌 경로는 거절 — 담김 검사는 루트마다 따로 산다", async () => {
    // 규칙을 거치지 않고 싼 주소 — 다른 웹사이트가 만든 주소 흉내다.
    for (const escape of [
      "..",
      "../바깥 폴더",
      `${PORTAL}/../../바깥 폴더`,
      `${YEAR}/../../수리품 목록/${PORTAL}`,
      outside,
      path.join(outside, "안쪽"),
    ]) {
      const result = await runScript(scriptPath, rawLink(escape));
      assert.equal(result.stdout.includes("OPEN"), false, escape);
      assert.equal(result.code, 3, escape);
    }
  });

  test("🔴 바로 가기 폴더가 낀 경로는 거절 — 둘째 루트 아래여도", async () => {
    for (const relativePath of ["바로가기", "바로가기/안쪽"]) {
      const result = await runScript(scriptPath, linkOf(relativePath));
      assert.equal(result.stdout.trim(), "REJECT reparse-point", result.stderr);
      assert.equal(result.code, 3);
    }
  });

  test("🔴 견적서만 설정된 PC 는 예전 그대로 — 견적서는 열리고 현황표는 NOT-FOUND", async () => {
    const opened = await runScript(quoteOnlyScriptPath, linkOf(`${YEAR}/${QUOTE}`));
    assert.equal(opened.stdout.trim(), `OPEN ${path.join(quoteRoot, YEAR, QUOTE)}`, opened.stderr);
    assert.equal(opened.code, 0);
    const missing = await runScript(quoteOnlyScriptPath, linkOf(PORTAL));
    assert.equal(missing.stdout.trim(), "NOT-FOUND");
    assert.equal(missing.code, 4);
  });

  test("셋 이상도 적은 차례 그대로 심는다 — 같은 값은 하나로 줄인다", () => {
    const script = buildQuoteFolderHelperScript({
      uncRoot: FAKE_UNC,
      uncRootAlt: "\\\\10.0.0.9\\archive",
      extraRoots: ["\\\\TESTNAS\\현황표", ` ${FAKE_UNC.toLowerCase()} `, "", "\\\\10.0.0.9\\현황표"],
    });
    assert.ok(
      script.includes(
        `$Roots = @('${FAKE_UNC}', '\\\\10.0.0.9\\archive', '\\\\TESTNAS\\현황표', '\\\\10.0.0.9\\현황표')\r\n`
      )
    );
  });

  test("더한 루트가 규칙 밖이면 만들지 않는다 — 오류에 값이 실리지 않는다", () => {
    assert.throws(
      () => buildQuoteFolderHelperScript({ uncRoot: FAKE_UNC, extraRoots: ["\\\\TESTNAS\\it's"] }),
      (error: unknown) => error instanceof QuoteFolderHelperRootError && !String(error).includes("it's")
    );
  });
});

// ── 설치에 심을 루트를 모으는 자리 ──────────────────────────────────────────

/**
 * 🔴 설정이 **일부만** 있을 때 무엇이 심기는지 — 견적서만 설정된 PC 가 실제로 있다.
 * 견적서 루트의 오타는 크게 울고(invalid), 곁다리(둘째 주소 · 현황표)의 오타는 없는 셈 친다 —
 * 곁다리 하나 때문에 견적서 [폴더 열기]가 죽으면 안 된다.
 */
describe("설치에 심을 루트 모으기(resolveQuoteFolderHelperInstallRoots)", () => {
  const KEYS = [
    "QUOTE_ARCHIVE_UNC_ROOT",
    "QUOTE_ARCHIVE_UNC_ROOT_ALT",
    "CUSTOMER_PORTAL_ARCHIVE_UNC_ROOT",
    "CUSTOMER_PORTAL_ARCHIVE_UNC_ROOT_ALT",
    "CONTACT_FOLDER_ARCHIVE_UNC_ROOT",
    "REPAIR_DOCS_ARCHIVE_UNC_ROOT",
  ] as const;
  const PORTAL_UNC = "\\\\TESTNAS\\현황표";
  const CONTACT_UNC = "\\\\TESTNAS\\연락서";
  const REPAIR_DOCS_UNC = "\\\\TESTNAS\\수리 관련";

  /** 여섯 칸을 그대로 세워 두고 돌린 뒤 되돌린다 — 다른 시험의 환경을 건드리지 않게. */
  function withEnv(values: Partial<Record<(typeof KEYS)[number], string>>, body: () => void): void {
    const original = KEYS.map((key) => [key, process.env[key]] as const);
    try {
      for (const key of KEYS) {
        const value = values[key];
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      body();
    } finally {
      for (const [key, value] of original) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  }

  test("하나도 없으면 unset — 설치 파일을 받을 수 없다(지금까지와 같다)", () => {
    withEnv({}, () => {
      assert.deepEqual(resolveQuoteFolderHelperInstallRoots(), { status: "unset" });
    });
    withEnv({ QUOTE_ARCHIVE_UNC_ROOT: "   ", CUSTOMER_PORTAL_ARCHIVE_UNC_ROOT: "  " }, () => {
      assert.deepEqual(resolveQuoteFolderHelperInstallRoots(), { status: "unset" });
    });
  });

  test("🔴 견적서만 설정된 PC 는 견적서 루트 하나 — 예전 그대로다", () => {
    withEnv({ QUOTE_ARCHIVE_UNC_ROOT: ` ${FAKE_UNC}\\ ` }, () => {
      assert.deepEqual(resolveQuoteFolderHelperInstallRoots(), { status: "ok", roots: [FAKE_UNC] });
    });
  });

  test("넷 다 설정되면 견적서 · 견적서 다른 주소 · 현황표 · 현황표 다른 주소 차례로", () => {
    withEnv(
      {
        QUOTE_ARCHIVE_UNC_ROOT: FAKE_UNC,
        QUOTE_ARCHIVE_UNC_ROOT_ALT: "\\\\10.0.0.9\\archive",
        CUSTOMER_PORTAL_ARCHIVE_UNC_ROOT: PORTAL_UNC,
        CUSTOMER_PORTAL_ARCHIVE_UNC_ROOT_ALT: "\\\\10.0.0.9\\현황표",
      },
      () => {
        assert.deepEqual(resolveQuoteFolderHelperInstallRoots(), {
          status: "ok",
          roots: [FAKE_UNC, "\\\\10.0.0.9\\archive", PORTAL_UNC, "\\\\10.0.0.9\\현황표"],
        });
      }
    );
  });

  /**
   * ============================================================================
   * 🔴 2026-10-07 — 「수리 관련」 서류 루트는 **맨 뒤**다
   * ============================================================================
   * 차례가 뜻을 가진다. 루트 목록은 **설치할 때 그 PC 의 스크립트에 글자 그대로 박히고**,
   * 이미 설치된 PC 는 새 설정을 모른다. 그래서 새 루트를 앞에 끼워 넣으면 **이미 깔린 PC 의
   * 차례와 새로 까는 PC 의 차례가 어긋난다** — 같은 상대 경로가 PC 마다 다른 폴더로 풀릴 수
   * 있다. 더하는 자리는 언제나 맨 뒤다.
   * ============================================================================
   */
  test("🔴 수리 관련 서류 루트는 맨 뒤에 붙는다 — 앞의 다섯 차례가 한 칸도 밀리지 않는다", () => {
    withEnv(
      {
        QUOTE_ARCHIVE_UNC_ROOT: FAKE_UNC,
        QUOTE_ARCHIVE_UNC_ROOT_ALT: "\\\\10.0.0.9\\archive",
        CUSTOMER_PORTAL_ARCHIVE_UNC_ROOT: PORTAL_UNC,
        CUSTOMER_PORTAL_ARCHIVE_UNC_ROOT_ALT: "\\\\10.0.0.9\\현황표",
        CONTACT_FOLDER_ARCHIVE_UNC_ROOT: CONTACT_UNC,
        REPAIR_DOCS_ARCHIVE_UNC_ROOT: REPAIR_DOCS_UNC,
      },
      () => {
        const resolution = resolveQuoteFolderHelperInstallRoots();
        assert.deepEqual(resolution, {
          status: "ok",
          roots: [
            FAKE_UNC,
            "\\\\10.0.0.9\\archive",
            PORTAL_UNC,
            "\\\\10.0.0.9\\현황표",
            CONTACT_UNC,
            REPAIR_DOCS_UNC,
          ],
        });
        // 🔴 그 차례 그대로 스크립트에 박힌다 — 맨 뒤가 맨 뒤다.
        if (resolution.status !== "ok") throw new Error("루트를 모으지 못했다");
        assert.ok(
          buildQuoteFolderHelperScript(quoteFolderHelperRootsInput(resolution.roots)).includes(
            `$Roots = @('${FAKE_UNC}', '\\\\10.0.0.9\\archive', '${PORTAL_UNC}', ` +
              `'\\\\10.0.0.9\\현황표', '${CONTACT_UNC}', '${REPAIR_DOCS_UNC}')\r\n`
          )
        );
      }
    );
  });

  test("🔴 수리 관련 서류 루트만 늘어도 앞은 그대로다 — 설정이 예전인 PC 와 차례가 같다", () => {
    withEnv({ QUOTE_ARCHIVE_UNC_ROOT: FAKE_UNC, CONTACT_FOLDER_ARCHIVE_UNC_ROOT: CONTACT_UNC }, () => {
      assert.deepEqual(resolveQuoteFolderHelperInstallRoots(), {
        status: "ok",
        roots: [FAKE_UNC, CONTACT_UNC],
      });
    });
    withEnv(
      {
        QUOTE_ARCHIVE_UNC_ROOT: FAKE_UNC,
        CONTACT_FOLDER_ARCHIVE_UNC_ROOT: CONTACT_UNC,
        REPAIR_DOCS_ARCHIVE_UNC_ROOT: REPAIR_DOCS_UNC,
      },
      () => {
        assert.deepEqual(resolveQuoteFolderHelperInstallRoots(), {
          status: "ok",
          roots: [FAKE_UNC, CONTACT_UNC, REPAIR_DOCS_UNC],
        });
      }
    );
  });

  test("🔴 수리 관련 서류 루트가 틀리면 없는 셈 친다 — 견적서 [폴더 열기]가 죽지 않는다", () => {
    withEnv({ QUOTE_ARCHIVE_UNC_ROOT: FAKE_UNC, REPAIR_DOCS_ARCHIVE_UNC_ROOT: "/mnt/repair-docs" }, () => {
      assert.deepEqual(resolveQuoteFolderHelperInstallRoots(), { status: "ok", roots: [FAKE_UNC] });
    });
    withEnv({ QUOTE_ARCHIVE_UNC_ROOT: FAKE_UNC, REPAIR_DOCS_ARCHIVE_UNC_ROOT: "\\\\TESTNAS\\it's" }, () => {
      assert.deepEqual(resolveQuoteFolderHelperInstallRoots(), { status: "ok", roots: [FAKE_UNC] });
    });
  });

  test("🔴 현황표 루트가 틀리면 없는 셈 친다 — 견적서 [폴더 열기]가 죽지 않는다", () => {
    withEnv({ QUOTE_ARCHIVE_UNC_ROOT: FAKE_UNC, CUSTOMER_PORTAL_ARCHIVE_UNC_ROOT: "/mnt/portal" }, () => {
      assert.deepEqual(resolveQuoteFolderHelperInstallRoots(), { status: "ok", roots: [FAKE_UNC] });
    });
    withEnv(
      { QUOTE_ARCHIVE_UNC_ROOT: FAKE_UNC, CUSTOMER_PORTAL_ARCHIVE_UNC_ROOT_ALT: "\\\\TESTNAS\\it's" },
      () => {
        assert.deepEqual(resolveQuoteFolderHelperInstallRoots(), { status: "ok", roots: [FAKE_UNC] });
      }
    );
  });

  test("🔴 견적서 루트가 틀리면 invalid — 현황표가 멀쩡해도(첫째의 오타는 크게 운다)", () => {
    withEnv({ QUOTE_ARCHIVE_UNC_ROOT: "/mnt/archive", CUSTOMER_PORTAL_ARCHIVE_UNC_ROOT: PORTAL_UNC }, () => {
      assert.deepEqual(resolveQuoteFolderHelperInstallRoots(), { status: "invalid" });
    });
  });

  test("견적서 루트가 비고 현황표만 있으면 현황표 하나로 만든다", () => {
    withEnv({ CUSTOMER_PORTAL_ARCHIVE_UNC_ROOT: PORTAL_UNC }, () => {
      assert.deepEqual(resolveQuoteFolderHelperInstallRoots(), { status: "ok", roots: [PORTAL_UNC] });
    });
  });

  test("모은 목록은 그대로 입력이 된다 — 첫째가 uncRoot, 나머지가 extraRoots", () => {
    assert.deepEqual(quoteFolderHelperRootsInput([FAKE_UNC]), { uncRoot: FAKE_UNC, extraRoots: [] });
    assert.deepEqual(quoteFolderHelperRootsInput([FAKE_UNC, PORTAL_UNC]), {
      uncRoot: FAKE_UNC,
      extraRoots: [PORTAL_UNC],
    });
    // 🔴 그 입력으로 만든 스크립트에 둘 다 심긴다.
    assert.ok(
      buildQuoteFolderHelperScript(quoteFolderHelperRootsInput([FAKE_UNC, PORTAL_UNC])).includes(
        `$Roots = @('${FAKE_UNC}', '${PORTAL_UNC}')\r\n`
      )
    );
  });

  test("🔴 오류에는 값이 실리지 않는다 — 어느 칸이 틀렸든", () => {
    withEnv({ QUOTE_ARCHIVE_UNC_ROOT: "/mnt/archive/비밀 폴더" }, () => {
      const resolution = resolveQuoteFolderHelperInstallRoots();
      assert.equal(JSON.stringify(resolution).includes("비밀"), false);
      assert.equal(new QuoteFolderHelperRootError().message.includes("비밀"), false);
    });
  });
});

// ── 설치 권한 ──────────────────────────────────────────────────────────────

/**
 * ============================================================================
 * 🔴 누가 설치 파일 · 설치 명령을 받을 수 있는가 (2026-09-30 · 2026-10-07 사용자 결정)
 * ============================================================================
 * [폴더 열기]가 있는 화면이 둘이 되어(견적서 편집 화면 · 고객사 현황표 패널) 설치 통로가
 * `quotes` READ **하나**에서 「`quotes` 또는 `customerPortal` READ」로 넓어졌고(2026-09-30),
 * 제품 모델 화면이 셋째가 되어 `productModels.view` 가 더해졌다(2026-10-07).
 * 여기서 값으로 못 박는 것은 다섯이다:
 *  1. `quotes` 만 있는 사람이 받는다 — **지금까지와 같다**(견적서만 쓰는 사람이 막히면 안 된다).
 *  2. `customerPortal` 만 있는 사람도 받는다 — 2026-09-30 에 막은 구멍이다.
 *  3. `productModels.view` 만 있는 사람도 받는다 — 2026-10-07 에 막은 구멍이다.
 *  4. 🔴 **하나도 없는 사람은 못 받는다** — 넓혔지 「누구나」로 열지 않았다.
 *  5. 🔴 묻는 열쇠는 **조회(`productModels.view`)**다 — 파일 관리(`productModels.files`)로도,
 *     메뉴 열쇠(`productModels`)로도 통과하지 않는다. 그 둘로 열면 「화면은 보이는데 설치는
 *     못 하는 사람」이 남거나(파일 관리), 「화면을 못 보는 사람이 받는」(메뉴 열쇠) 쪽으로
 *     어긋난다 — 까닭은 server/quote-folder-helper.ts 의 머리말.
 * 통로가 이 함수를 그 자리에서 부르는지는 두 route-source 시험이 본다.
 * ============================================================================
 */
describe("🔴 설치 권한 — 견적서 · 현황표 · 제품 모델 조회 가운데 하나라도 READ", () => {
  /** 이 영역들만 READ 인 사람. 물어본 영역을 그대로 적어 두어 **무엇을 물었는지**까지 본다. */
  function actorWith(...areas: string[]): { canRead: (areaKey: string) => Promise<boolean>; asked: string[] } {
    const asked: string[] = [];
    return {
      asked,
      canRead: async (areaKey: string) => {
        asked.push(areaKey);
        return areas.includes(areaKey);
      },
    };
  }

  test("물어보는 영역은 견적서 · 현황표 · 제품 모델 조회 셋뿐이다", () => {
    assert.deepEqual(
      [...QUOTE_FOLDER_HELPER_INSTALL_AREA_KEYS],
      ["quotes", "customerPortal", "productModels.view"]
    );
  });

  test("견적서만 볼 수 있는 사람이 받는다 — 지금까지와 같다", async () => {
    const actor = actorWith("quotes");
    assert.equal(await mayInstallQuoteFolderHelper(actor.canRead), true);
    // 첫째에서 통과하면 더 묻지 않는다(조회 한 번이면 끝난다).
    assert.deepEqual(actor.asked, ["quotes"]);
  });

  test("🔴 현황표만 볼 수 있는 사람도 받는다 — 이번에 막은 구멍", async () => {
    const actor = actorWith("customerPortal");
    assert.equal(await mayInstallQuoteFolderHelper(actor.canRead), true);
    assert.deepEqual(actor.asked, ["quotes", "customerPortal"]);
  });

  test("둘 다 볼 수 있는 사람도 받는다(기본값의 네 역할)", async () => {
    assert.equal(await mayInstallQuoteFolderHelper(actorWith("quotes", "customerPortal").canRead), true);
  });

  test("🔴 제품 모델 조회만 있는 사람도 받는다 — 2026-10-07 에 막은 구멍", async () => {
    const actor = actorWith("productModels.view");
    assert.equal(await mayInstallQuoteFolderHelper(actor.canRead), true);
    assert.deepEqual(actor.asked, ["quotes", "customerPortal", "productModels.view"]);
  });

  test("🔴 하나도 없는 사람은 못 받는다 — 「누구나」가 아니다", async () => {
    const actor = actorWith();
    assert.equal(await mayInstallQuoteFolderHelper(actor.canRead), false);
    assert.deepEqual(
      actor.asked,
      ["quotes", "customerPortal", "productModels.view"],
      "묻지 않고 통과시킨 영역이 있다"
    );
  });

  test("🔴 다른 영역을 아무리 많이 가져도 받지 못한다", async () => {
    // 🔴 `productModels` 는 **메뉴 열쇠**다 — 잎 `productModels.view` 가 아니므로 통과하지
    // 못한다. 메뉴 열쇠는 잎들의 최대값이라, 그것으로 열면 보기가 NONE 이고 삭제·복원만
    // 열린 역할(화면 자체를 못 보는 사람)까지 들어온다.
    const actor = actorWith("repairCases", "inventory", "users", "settings", "productModels");
    assert.equal(await mayInstallQuoteFolderHelper(actor.canRead), false);
  });

  test("🔴 사진·도면(파일 관리)만으로는 받지 못한다 — 묻는 것은 조회다", async () => {
    // 이 문은 「그 화면을 볼 수 있는 사람」의 문이다. 파일 관리 잎(`productModels.files`)은
    // 읽기가 없는 노드라, 그것으로 물으면 묻는 말과 뜻하는 말이 어긋난다.
    assert.equal(await mayInstallQuoteFolderHelper(actorWith("productModels.files").canRead), false);
    assert.equal(await mayInstallQuoteFolderHelper(actorWith("productModels.edit").canRead), false);
  });

  test("🔴 참이 아닌 값은 참으로 치지 않는다", async () => {
    // 물음이 던지는 것이 아니라 이상한 값을 돌려줄 때 — 닫히는 쪽으로 틀린다.
    const sloppy = async () => undefined as unknown as boolean;
    assert.equal(await mayInstallQuoteFolderHelper(sloppy), false);
  });
});

// ── 설치 파일 ──────────────────────────────────────────────────────────────

/** 설치 파일에서 이름 붙은 payload 덩어리를 TypeScript 로 푼다. */
function payloadOf(installer: string, name: string): Buffer {
  const lines = installer.split("\r\n");
  const begin = lines.indexOf(`DSS-PAYLOAD-${name}-BEGIN`);
  const end = lines.indexOf(`DSS-PAYLOAD-${name}-END`);
  assert.ok(begin >= 0 && end > begin + 1, `payload ${name}`);
  return Buffer.from(lines.slice(begin + 1, end).join(""), "base64");
}

function powerShellLineOf(installer: string): string {
  const line = installer
    .split("\r\n")
    .find((candidate) => candidate.includes("powershell.exe") && !candidate.startsWith("rem"));
  assert.ok(line);
  return line;
}

describe("설치 파일 본문", () => {
  const installer = buildQuoteFolderHelperInstaller({ uncRoot: FAKE_UNC });
  const lines = installer.split("\r\n");

  test("ASCII 만 · 줄 끝 CRLF 뿐 · 이름이 정해져 있다", () => {
    assert.equal(QUOTE_FOLDER_HELPER_INSTALLER_FILE_NAME, "install-dss-folder-helper.cmd");
    for (let index = 0; index < installer.length; index += 1) {
      assert.ok(installer.charCodeAt(index) < 0x80, `ASCII 밖 글자: ${index}`);
    }
    assert.equal(/[^\r]\n/.test(installer), false);
    assert.equal(lines[0], "@echo off");
  });

  test("🔴 루트(UNC)는 base64 로 싼 스크립트 안에만 있다 — cmd 의 날 글자에는 없다", () => {
    assert.equal(installer.includes("TESTNAS"), false);
    const helper = payloadOf(installer, "HELPER");
    assert.deepEqual(new Uint8Array(helper), quoteFolderHelperScriptBytes({ uncRoot: FAKE_UNC }));
    assert.ok(helper.toString("utf8").includes(`$Roots = @('${FAKE_UNC}')`));
    assert.equal(payloadOf(installer, "DONE").toString("utf8"), QUOTE_FOLDER_HELPER_INSTALLED_MESSAGE);
    assert.equal(payloadOf(installer, "FAILED").toString("utf8"), QUOTE_FOLDER_HELPER_INSTALL_FAILED_MESSAGE);
  });

  test("요청마다 만든다 — 루트가 다르면 본문이 다르다", () => {
    const other = buildQuoteFolderHelperInstaller({ uncRoot: "\\\\TESTNAS2\\archive" });
    assert.notEqual(other, installer);
    assert.ok(payloadOf(other, "HELPER").toString("utf8").includes("$Roots = @('\\\\TESTNAS2\\archive')"));
  });

  test("🔴 cmd 줄 — 지연 확장을 끄고, 자기 경로는 환경변수로, PowerShell 은 전체 경로로 한 번", () => {
    const setlocal = lines.indexOf("setlocal DisableDelayedExpansion");
    const self = lines.indexOf('set "DSS_HELPER_INSTALLER=%~f0"');
    const psLine = lines.indexOf(powerShellLineOf(installer));
    const exit = lines.indexOf("exit /b %DSS_HELPER_EXIT%");
    const firstPayload = lines.indexOf("DSS-PAYLOAD-HELPER-BEGIN");
    assert.ok(setlocal >= 0 && self > setlocal && psLine > self && exit > psLine && firstPayload > exit);
    assert.ok(
      powerShellLineOf(installer).startsWith(
        '"%SystemRoot%\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "'
      )
    );
    assert.equal(lines.filter((line) => line.includes("powershell.exe") && !line.startsWith("rem")).length, 1);
  });

  test("🔴 -Command 본문에는 cmd 가 해석하는 글자가 없다(% ! ^ & | < > 따옴표)", () => {
    const line = powerShellLineOf(installer);
    const body = line.slice(line.indexOf('-Command "') + '-Command "'.length, -1);
    assert.equal(body, quoteFolderHelperInstallCommand());
    assert.ok(line.endsWith('"'));
    for (const character of ["%", "!", "^", "&", "|", "<", ">", '"', "`"]) {
      assert.equal(body.includes(character), false, `cmd 특수문자: ${character}`);
    }
    // rem 줄에도 < > | & 가 없다.
    for (const rem of lines.filter((candidate) => candidate.startsWith("rem"))) {
      assert.equal(/[<>|&]/.test(rem), false, rem);
    }
  });

  test("🔴 설치가 하는 일 — 파일 하나 쓰기 · HKCU 만 · 풀어서 코드로 실행하는 것은 없다", () => {
    const body = quoteFolderHelperInstallCommand();
    assert.ok(body.includes(QUOTE_FOLDER_HELPER_PAYLOAD_READER_PS));
    assert.ok(body.includes(QUOTE_FOLDER_HELPER_COMMAND_BUILDER_PS));
    assert.ok(body.includes("$dir = Join-Path $env:LOCALAPPDATA 'DSS'"));
    assert.ok(body.includes("$script = Join-Path $dir 'open-dss-folder.ps1'"));
    assert.ok(body.includes("[System.IO.File]::WriteAllBytes($script, (Read-DssPayload 'HELPER'))"));
    assert.ok(body.includes("$powershell = Join-Path $env:SystemRoot 'System32\\WindowsPowerShell\\v1.0\\powershell.exe'"));
    assert.ok(body.includes("[Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('Software\\Classes\\dss-folder')"));
    assert.ok(body.includes("$key.SetValue('', 'URL:DSS Folder')"));
    assert.ok(body.includes("$key.SetValue('URL Protocol', '')"));
    assert.ok(body.includes("$commandKey = $key.CreateSubKey('shell\\open\\command')"));
    assert.ok(body.includes("$commandKey.SetValue('', $command)"));
    for (const forbidden of [
      "LocalMachine",
      "HKLM",
      "Invoke-Expression",
      "iex ",
      "ScriptBlock",
      "EncodedCommand",
      "Start-Process",
      "RunAs",
      "reg.exe",
    ]) {
      assert.equal(installer.includes(forbidden), false, forbidden);
    }
    assert.equal(body.match(/WriteAllBytes/g)?.length, 1);
    // 🔴 세 번은 `dss-folder` 주소 처리기(예전 그대로), 두 번은 영역 등록의 `:Range` · `*` 다.
    assert.equal(body.match(/SetValue\(/g)?.length, 5);
  });

  test("제거 방법이 머리 주석에 있다", () => {
    assert.ok(lines.includes('rem    reg delete "HKCU\\Software\\Classes\\dss-folder" /f'));
    assert.ok(lines.includes('rem    del "%LOCALAPPDATA%\\DSS\\open-dss-folder.ps1"'));
  });
});

describe("🔴 설치 파일 — payload 읽개와 명령 만들기 한 줄만 PowerShell 로 돌린다(레지스트리 쓰기 없음)", { skip: WINDOWS_ONLY }, () => {
  let parent = "";

  before(async () => {
    parent = await mkdtemp(path.join(os.tmpdir(), "dss-folder-installer-test-"));
  });

  after(async () => {
    if (parent) await rm(parent, { recursive: true, force: true });
  });

  test("payload 읽개가 뽑은 스크립트 바이트가 원문과 같고, 그 스크립트가 돈다", async () => {
    const root = path.join(parent, "견적 공유폴더");
    await mkdir(path.join(root, "21. 2026 내자견적서"), { recursive: true });
    const installerPath = path.join(parent, "install-dss-folder-helper.cmd");
    await writeFile(installerPath, buildQuoteFolderHelperInstaller({ uncRoot: root }), "ascii");
    const outputs = { HELPER: "helper.ps1", DONE: "done.txt", FAILED: "failed.txt" } as const;

    for (const [name, file] of Object.entries(outputs)) {
      const target = path.join(parent, file);
      const result = await runPowerShell(
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          `${QUOTE_FOLDER_HELPER_PAYLOAD_READER_PS}; [System.IO.File]::WriteAllBytes($env:DSS_TEST_OUT, (Read-DssPayload '${name}'))`,
        ],
        { env: { DSS_HELPER_INSTALLER: installerPath, DSS_TEST_OUT: target } }
      );
      assert.equal(result.code, 0, result.stderr);
    }

    const extracted = await readFile(path.join(parent, outputs.HELPER));
    assert.deepEqual(new Uint8Array(extracted), quoteFolderHelperScriptBytes({ uncRoot: root }));
    assert.equal(await readFile(path.join(parent, outputs.DONE), "utf8"), QUOTE_FOLDER_HELPER_INSTALLED_MESSAGE);
    assert.equal(await readFile(path.join(parent, outputs.FAILED), "utf8"), QUOTE_FOLDER_HELPER_INSTALL_FAILED_MESSAGE);

    const opened = await runPowerShell(
      [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        path.join(parent, outputs.HELPER),
        linkOf("21. 2026 내자견적서"),
      ],
      { env: { DSS_FOLDER_DRY_RUN: "1" } }
    );
    assert.equal(opened.stdout.trim(), `OPEN ${path.join(root, "21. 2026 내자견적서")}`, opened.stderr);
  });

  test("payload 가 없으면 읽개가 실패한다(빈 파일을 쓰지 않는다)", async () => {
    const broken = path.join(parent, "broken.cmd");
    await writeFile(broken, "@echo off\r\nDSS-PAYLOAD-HELPER-BEGIN\r\nDSS-PAYLOAD-HELPER-END\r\n", "ascii");
    const target = path.join(parent, "should-not-exist.ps1");
    const result = await runPowerShell(
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `$ErrorActionPreference = 'Stop'; ${QUOTE_FOLDER_HELPER_PAYLOAD_READER_PS}; [System.IO.File]::WriteAllBytes($env:DSS_TEST_OUT, (Read-DssPayload 'HELPER'))`,
      ],
      { env: { DSS_HELPER_INSTALLER: broken, DSS_TEST_OUT: target } }
    );
    assert.notEqual(result.code, 0);
    assert.equal(existsSync(target), false);
  });

  test("레지스트리에 적을 명령 — -File \"<스크립트>\" \"%1\" 모양(한글 · 공백 경로)", async () => {
    const powershell = "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe";
    const script = "C:\\Users\\가 나\\AppData\\Local\\DSS\\open-dss-folder.ps1";
    const result = await runPowerShell([
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      [
        `$powershell = '${powershell}'`,
        `$script = '${script}'`,
        QUOTE_FOLDER_HELPER_COMMAND_BUILDER_PS,
        "$bytes = [System.Text.Encoding]::UTF8.GetBytes($command)",
        "$out = [System.Console]::OpenStandardOutput()",
        "$out.Write($bytes, 0, $bytes.Length)",
        "$out.Flush()",
      ].join("; "),
    ]);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(
      result.stdout,
      `"${powershell}" -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "${script}" "%1"`
    );
  });
});

// ── 파일 없이 도는 설치 명령 (견적서 ④c) ───────────────────────────────────

/** 붙여넣는 명령이 품은 payload — 읽개에 박힌 `'<이름>' { '<base64>' }` 를 되꺼낸다. */
function inlinePayloadOf(command: string, name: string): Buffer {
  const match = new RegExp(`'${name}' \\{ '([A-Za-z0-9+/=]+)' \\}`).exec(command);
  assert.ok(match, `payload ${name}`);
  return Buffer.from(match[1], "base64");
}

/** 설치가 실패했을 때 예외 메시지를 알리는 마지막 조각 — 양쪽 명령의 끝이다. */
const CATCH_TAIL_PS = "Write-Host $_.Exception.Message";

describe("파일 없이 도는 설치 명령 본문", () => {
  const command = buildQuoteFolderHelperInlineInstallCommand({ uncRoot: FAKE_UNC });
  const installer = buildQuoteFolderHelperInstaller({ uncRoot: FAKE_UNC });

  test("붙여넣기 한 번으로 끝난다 — 줄바꿈이 없다", () => {
    assert.equal(/[\r\n]/.test(command), false);
  });

  /**
   * ============================================================================
   * 🔴 2026-10-08 에 **실제로 깨졌다가 고친 것** — 명령 한 줄의 길이 한도
   * ============================================================================
   * 설치 명령은 도우미 스크립트 전체를 base64 로 품는다. 스크립트의 한글 주석 한 글자는
   * UTF-8 로 3바이트 → base64 **4글자**가 된다. 그래서 스크립트에 주석 몇 줄을 더하면 명령이
   * 그 네 배 가까이 늘어난다.
   *
   * PDF 변환(xlsx2pdf)을 더하면서 명령이 **34,724 글자**가 되어 Windows 의 명령줄 한도
   * (CreateProcess · 32,767)를 넘었고, 이 저장소의 시험 하나가 `spawn ENAMETOOLONG` 으로
   * 깨졌다(아래 「설치 명령이 품은 ZONEHOSTS …」). 스크립트 안의 주석을 줄여 되돌렸다 —
   * **까닭을 적는 자리는 이 서버 모듈의 머리말이지, PC 에 깔리는 .ps1 이 아니다.**
   *
   * 🔴 그러므로 **도우미 스크립트에 한글 주석을 늘릴 때마다 이 시험이 먼저 운다.** 남은 자리가
   * 얼마 없다(아래 숫자). 다음에 또 막히면 주석을 줄이거나, HELPER payload 를 압축하는
   * 조각을 따로 잡아야 한다(설치 절차가 한 벌이므로 설치 파일 쪽과 함께 바꿔야 한다).
   *
   * ── 잰 값 ─────────────────────────────────────────────────────────────────
   *  · 31,248 — 주석을 줄여 되돌린 직후(2026-10-08 오전).
   *  · 31,436 — 세 상수를 domain 으로 옮긴 뒤(스크립트는 그대로, 설치 쪽 글자만 늘었다).
   *  · 🔴 31,720 — 「그 탭만 내보낸다」(2026-10-08). 남은 자리는 **791 글자**뿐이다.
   *    한글 한 글자가 base64 **네 글자**이므로, 스크립트에 더 쓸 수 있는 한글 주석은
   *    **200 글자 남짓**이다. 다음 조각에서 막히면 고치려 들지 말고 압축을 잡아라.
   * ============================================================================
   */
  test("🔴 명령 한 줄이 Windows 명령줄 한도 안이다 — 넘으면 설치가 통째로 막힌다", () => {
    // Windows CreateProcess 의 lpCommandLine 한도. powershell.exe 전체 경로 · 깃발 ·
    // 따옴표가 앞에 붙으므로 그만큼 뺀 자리에 들어가야 한다.
    const WINDOWS_COMMAND_LINE_MAX = 32767;
    const INVOCATION_OVERHEAD = 256;
    // 루트를 가장 많이 심은 PC 가 가장 길다 — 설정이 꽉 찬 경우로 잰다.
    const widest = buildQuoteFolderHelperInlineInstallCommand({
      uncRoot: "\\\\10.77.88.99\\견적서 공유폴더\\하위",
      uncRootAlt: "\\\\DSS-NAS-LONG-NAME\\견적서 공유폴더\\하위",
      extraRoots: [
        "\\\\10.77.88.99\\고객사 현황표",
        "\\\\DSS-NAS-LONG-NAME\\고객사 현황표",
        "\\\\10.77.88.99\\연락서 공유폴더",
        "\\\\10.77.88.99\\수리 관련 서류",
      ],
    });
    assert.ok(
      widest.length + INVOCATION_OVERHEAD < WINDOWS_COMMAND_LINE_MAX,
      `설치 명령이 ${widest.length} 글자다 — 한도 ${WINDOWS_COMMAND_LINE_MAX} 를 넘보고 있다. ` +
        "도우미 스크립트의 한글 주석을 줄이거나 payload 압축 조각을 잡아라."
    );
  });

  test("🔴 설치 절차가 설치 파일과 한 벌이다 — 매체가 달라서 다른 두 자리만 갈아 끼웠다", () => {
    const fileVersion = quoteFolderHelperInstallCommand();
    const reader = quoteFolderHelperInlinePayloadReaderPs({ uncRoot: FAKE_UNC });
    assert.ok(fileVersion.includes(QUOTE_FOLDER_HELPER_PAYLOAD_READER_PS));
    assert.ok(command.includes(reader));
    // 다른 자리는 둘뿐이다 — 읽개(읽을 파일이 있느냐)와 끝냄(돌아갈 곳이 있느냐).
    // 그 둘을 되돌려 놓으면 설치 파일의 명령과 글자 그대로 같아야 한다.
    const restored = command
      .replace(reader, () => QUOTE_FOLDER_HELPER_PAYLOAD_READER_PS)
      .replace(`${CATCH_TAIL_PS} }`, () => `${CATCH_TAIL_PS}${QUOTE_FOLDER_HELPER_INSTALL_EXIT_PS} }`);
    assert.equal(restored, fileVersion);
    // 이름 · 인자가 같아서 그 뒤 설치 문장이 그대로 돈다.
    assert.ok(command.includes("function Read-DssPayload([string]$Name)"));
    // 파일에 기대는 흔적이 없다.
    assert.equal(command.includes(QUOTE_FOLDER_HELPER_INSTALLER_PATH_ENV), false);
    assert.equal(command.includes("ReadAllLines"), false);
    assert.equal(command.includes("DSS-PAYLOAD-"), false);
  });

  test("🔴 붙여넣는 명령에는 exit 가 없다 — 실패해도 창이 남아 문구를 읽는다", () => {
    assert.equal(command.includes(QUOTE_FOLDER_HELPER_INSTALL_EXIT_PS), false);
    // base64 payload 안에 우연히 든 글자에 걸리지 않게 payload 를 걷어내고 본다.
    const withoutPayloads = command.replace(new RegExp("'[A-Za-z0-9+/=]{64,}'", "g"), "'PAYLOAD'");
    assert.equal(/exit/i.test(withoutPayloads), false, withoutPayloads.slice(0, 200));
    // 없앤 것은 끝냄뿐이다 — 실패했다고 알려 주는 두 줄은 그대로다.
    assert.ok(command.includes("Write-Host ([System.Text.Encoding]::UTF8.GetString((Read-DssPayload 'FAILED')))"));
    assert.ok(command.endsWith(`${CATCH_TAIL_PS} }`));
  });

  test("🔴 설치 파일 쪽은 그대로다 — exit 1 이 %ERRORLEVEL% 로 이어진다", () => {
    const fileVersion = quoteFolderHelperInstallCommand();
    assert.ok(fileVersion.endsWith(`${CATCH_TAIL_PS}${QUOTE_FOLDER_HELPER_INSTALL_EXIT_PS} }`));
    assert.ok(installer.includes(`${CATCH_TAIL_PS}${QUOTE_FOLDER_HELPER_INSTALL_EXIT_PS} }`));
    const lines = installer.split("\r\n");
    assert.ok(lines.includes('set "DSS_HELPER_EXIT=%ERRORLEVEL%"'));
    assert.ok(lines.includes("exit /b %DSS_HELPER_EXIT%"));
  });

  test("🔴 갈아 끼울 자리를 못 찾으면 던진다 — 반쪽짜리 명령을 내주지 않는다", () => {
    const reader = "function Read-DssPayload([string]$Name) { }";
    const tail = `${CATCH_TAIL_PS}${QUOTE_FOLDER_HELPER_INSTALL_EXIT_PS} }`;
    // 읽개 한 자리 · 끝냄 한 자리면 둘 다 옮긴다.
    assert.deepEqual(quoteFolderHelperInteractiveStatements([QUOTE_FOLDER_HELPER_PAYLOAD_READER_PS, tail], reader), [
      reader,
      `${CATCH_TAIL_PS} }`,
    ]);
    // 읽개가 없다 · 둘이다 — 끝냄이 없다 · 둘이다.
    assert.throws(() => quoteFolderHelperInteractiveStatements([tail], reader), /읽개/);
    assert.throws(
      () =>
        quoteFolderHelperInteractiveStatements(
          [QUOTE_FOLDER_HELPER_PAYLOAD_READER_PS, QUOTE_FOLDER_HELPER_PAYLOAD_READER_PS, tail],
          reader
        ),
      /읽개/
    );
    assert.throws(() => quoteFolderHelperInteractiveStatements([QUOTE_FOLDER_HELPER_PAYLOAD_READER_PS], reader), /끝냄/);
    assert.throws(
      () => quoteFolderHelperInteractiveStatements([QUOTE_FOLDER_HELPER_PAYLOAD_READER_PS, tail, tail], reader),
      /끝냄/
    );
  });

  test("payload 셋(HELPER · DONE · FAILED)이 base64 로 온전히 들어 있다 — 설치 파일의 것과 같다", () => {
    for (const name of ["HELPER", "DONE", "FAILED"]) {
      assert.deepEqual(
        new Uint8Array(inlinePayloadOf(command, name)),
        new Uint8Array(payloadOf(installer, name)),
        name
      );
    }
    const helper = inlinePayloadOf(command, "HELPER");
    assert.deepEqual(new Uint8Array(helper), quoteFolderHelperScriptBytes({ uncRoot: FAKE_UNC }));
    assert.deepEqual([...helper.slice(0, 3)], [0xef, 0xbb, 0xbf]);
    assert.equal(helper.slice(3).toString("utf8"), buildQuoteFolderHelperScript({ uncRoot: FAKE_UNC }));
    assert.equal(inlinePayloadOf(command, "DONE").toString("utf8"), QUOTE_FOLDER_HELPER_INSTALLED_MESSAGE);
    assert.equal(inlinePayloadOf(command, "FAILED").toString("utf8"), QUOTE_FOLDER_HELPER_INSTALL_FAILED_MESSAGE);
  });

  test("🔴 루트(UNC)는 base64 안에만 있다 — 명령의 날 글자에는 없다 · 요청마다 만든다", () => {
    assert.equal(command.includes("TESTNAS"), false);
    assert.ok(inlinePayloadOf(command, "HELPER").toString("utf8").includes(`$Roots = @('${FAKE_UNC}')`));
    const other = buildQuoteFolderHelperInlineInstallCommand({ uncRoot: "\\\\TESTNAS2\\archive" });
    assert.notEqual(other, command);
    assert.ok(inlinePayloadOf(other, "HELPER").toString("utf8").includes("$Roots = @('\\\\TESTNAS2\\archive')"));
  });

  test("틀린 루트로는 명령을 만들지 않는다 — 오류에 값이 실리지 않는다", () => {
    assert.throws(
      () => buildQuoteFolderHelperInlineInstallCommand({ uncRoot: "\\\\TESTNAS\\it's" }),
      (error: unknown) => {
        assert.ok(error instanceof QuoteFolderHelperRootError);
        assert.equal(error.message.includes("TESTNAS"), false);
        return true;
      }
    );
  });

  test("🔴 설치가 하는 일은 설치 파일과 같다 — 파일 하나 쓰기 · HKCU 만 · 풀어서 코드로 실행하는 것은 없다", () => {
    assert.ok(command.includes("[System.IO.File]::WriteAllBytes($script, (Read-DssPayload 'HELPER'))"));
    assert.ok(command.includes("$dir = Join-Path $env:LOCALAPPDATA 'DSS'"));
    assert.ok(command.includes("[Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('Software\\Classes\\dss-folder')"));
    for (const forbidden of [
      "LocalMachine",
      "HKLM",
      "Invoke-Expression",
      "iex ",
      "ScriptBlock",
      "EncodedCommand",
      "Start-Process",
      "RunAs",
      "reg.exe",
    ]) {
      assert.equal(command.includes(forbidden), false, forbidden);
    }
    assert.equal(command.match(/WriteAllBytes/g)?.length, 1);
    // 🔴 세 번은 `dss-folder` 주소 처리기(예전 그대로), 두 번은 영역 등록의 `:Range` · `*` 다.
    assert.equal(command.match(/SetValue\(/g)?.length, 5);
  });
});

describe("🔴 설치 명령 — 문법 검사와 읽개 한 줄만 돌린다(설치하지 않는다)", { skip: WINDOWS_ONLY }, () => {
  let parent = "";

  before(async () => {
    parent = await mkdtemp(path.join(os.tmpdir(), "dss-folder-install-command-test-"));
  });

  after(async () => {
    if (parent) await rm(parent, { recursive: true, force: true });
  });

  test("PowerShell 파서를 통과한다 — 파싱만 하고 돌리지 않는다", async () => {
    const file = path.join(parent, "install-command.txt");
    await writeFile(file, buildQuoteFolderHelperInlineInstallCommand({ uncRoot: FAKE_UNC }), "utf8");
    const result = await runPowerShell(
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        [
          "$text = [System.IO.File]::ReadAllText($env:DSS_TEST_IN, [System.Text.Encoding]::UTF8)",
          "$tokens = $null",
          "$errors = $null",
          "[void][System.Management.Automation.Language.Parser]::ParseInput($text, [ref]$tokens, [ref]$errors)",
          "if ($errors.Count -gt 0) { Write-Output $errors[0].ToString(); exit 1 }",
          "Write-Output 'PARSED'",
        ].join("; "),
      ],
      { env: { DSS_TEST_IN: file } }
    );
    assert.equal(result.stdout.trim(), "PARSED", result.stdout + result.stderr);
    assert.equal(result.code, 0);
  });

  test("명령이 품은 읽개가 payload 셋을 그대로 되돌린다 — 읽개 한 줄만 돌린다", async () => {
    const reader = quoteFolderHelperInlinePayloadReaderPs({ uncRoot: FAKE_UNC });
    const outputs = { HELPER: "helper.ps1", DONE: "done.txt", FAILED: "failed.txt" } as const;

    for (const [name, file] of Object.entries(outputs)) {
      const result = await runPowerShell(
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          `${reader}; [System.IO.File]::WriteAllBytes($env:DSS_TEST_OUT, (Read-DssPayload '${name}'))`,
        ],
        { env: { DSS_TEST_OUT: path.join(parent, file) } }
      );
      assert.equal(result.code, 0, result.stderr);
    }

    const extracted = await readFile(path.join(parent, outputs.HELPER));
    assert.deepEqual(new Uint8Array(extracted), quoteFolderHelperScriptBytes({ uncRoot: FAKE_UNC }));
    assert.equal(await readFile(path.join(parent, outputs.DONE), "utf8"), QUOTE_FOLDER_HELPER_INSTALLED_MESSAGE);
    assert.equal(await readFile(path.join(parent, outputs.FAILED), "utf8"), QUOTE_FOLDER_HELPER_INSTALL_FAILED_MESSAGE);
  });

  test("이름이 다르면 읽개가 실패한다(빈 파일을 쓰지 않는다)", async () => {
    const target = path.join(parent, "should-not-exist.bin");
    const reader = quoteFolderHelperInlinePayloadReaderPs({ uncRoot: FAKE_UNC });
    const result = await runPowerShell(
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `$ErrorActionPreference = 'Stop'; ${reader}; [System.IO.File]::WriteAllBytes($env:DSS_TEST_OUT, (Read-DssPayload 'NOPE'))`,
      ],
      { env: { DSS_TEST_OUT: target } }
    );
    assert.notEqual(result.code, 0);
    assert.equal(existsSync(target), false);
  });
});

// ── 🔴 「로컬 인트라넷」 영역 등록 (조각 9) ─────────────────────────────────

/**
 * ============================================================================
 * 🔴 설치가 **함께** 하는 일 — 공유폴더 주소를 「로컬 인트라넷」 영역에 (2026-10-05)
 * ============================================================================
 * Windows 는 `\\<IP>\…` 를 「인터넷 영역」으로 보고, 그 영역의 파일을 열 때마다 확인창을 띄운다.
 * 사용자가 그것을 없애 달라고 해서(위험을 설명 듣고 골랐다) 도우미를 설치할 때 그 주소를
 * 「로컬 인트라넷」 영역에 함께 등록한다.
 *
 * 여기서 못 박는 것:
 *  · 🔴 **코드에 IP 가 없다** — 설치본의 UNC 루트에서 뽑고, 값은 base64 payload 안에만 있다.
 *  · 🔴 **호스트가 이름이면 등록하지 않는다**(Windows 가 이미 인트라넷으로 본다).
 *  · 🔴 **루트 여럿이 같은 호스트면 한 번만.**
 *  · 🔴 **이미 같은 `:Range` 가 있으면 새로 만들지 않는다.**
 *  · 🔴 **다른 `RangeN` 을 건드리지 않는다** — 안 쓰이는 번호를 고른다.
 *  · 🔴 **HKLM 이 한 글자도 없다.**
 *  · 🔴 **영역 등록이 실패해도 도우미 설치는 끝난다**(던지지 않는다).
 *
 * 🔴 **이 PC 의 진짜 영역 설정은 건드리지 않는다.** PowerShell 로 도는 시험은 전부
 *    `HKCU\Software\DSS-Test-<무작위>\Ranges` 라는 **임시 키**에 쓰고 끝나면 지운다. 진짜 자리
 *    (ZoneMap\Ranges)는 **읽기만** 하고, 시험 앞뒤로 같은지 본다.
 * ============================================================================
 */

/** 시험용 IP 루트 — 운영 주소가 아니다(RFC 1918 사설 대역의 아무 값). */
const IP_ROOT = "\\\\10.77.88.99\\archive";
const IP_HOST = "10.77.88.99";
const IP_ROOT_2 = "\\\\10.77.88.100\\현황표";
const IP_HOST_2 = "10.77.88.100";

/** ZONEHOSTS payload 를 글자로 되돌린다 — 한 줄에 하나, 끝에도 줄바꿈. */
function zoneHostsPayloadText(installer: string): string {
  return payloadOf(installer, "ZONEHOSTS").toString("utf8");
}

describe("🔴 영역 등록할 주소 뽑기 — 설정값에서 · IP 만 · 한 번만", () => {
  test("UNC 루트의 호스트가 IP 면 그 하나를 뽑는다", () => {
    assert.deepEqual(quoteFolderHelperZoneHosts({ uncRoot: IP_ROOT }), [IP_HOST]);
  });

  test("🔴 호스트가 이름이면 등록하지 않는다 — 점 없는 이름도, 점 있는 이름도", () => {
    assert.deepEqual(quoteFolderHelperZoneHosts({ uncRoot: FAKE_UNC }), []);
    assert.deepEqual(quoteFolderHelperZoneHosts({ uncRoot: "\\\\dss-nas.example.com\\archive" }), []);
    assert.deepEqual(quoteFolderHelperZoneHosts({ uncRoot: "\\\\나스\\공유" }), []);
  });

  test("드라이브 경로는 호스트가 없다 — 건드리지 않는다", () => {
    assert.deepEqual(quoteFolderHelperZoneHosts({ uncRoot: "Z:\\견적서" }), []);
    assert.deepEqual(quoteFolderHelperZoneHosts({ uncRoot: "Z:\\견적서", extraRoots: [IP_ROOT] }), [IP_HOST]);
  });

  test("🔴 루트 여럿이 같은 호스트면 한 번만 — 견적서 · 현황표 · 연락서가 같은 NAS", () => {
    assert.deepEqual(
      quoteFolderHelperZoneHosts({
        uncRoot: IP_ROOT,
        uncRootAlt: FAKE_UNC,
        extraRoots: ["\\\\10.77.88.99\\현황표", "\\\\10.77.88.99\\연락서\\2. 연락서"],
      }),
      [IP_HOST]
    );
  });

  test("서로 다른 IP 는 적은 차례 그대로 둘 다", () => {
    assert.deepEqual(quoteFolderHelperZoneHosts({ uncRoot: IP_ROOT, extraRoots: [IP_ROOT_2] }), [IP_HOST, IP_HOST_2]);
    assert.deepEqual(quoteFolderHelperZoneHosts({ uncRoot: IP_ROOT_2, extraRoots: [IP_ROOT] }), [IP_HOST_2, IP_HOST]);
  });

  test("🔴 IP 비슷한 것은 IP 가 아니다 — 토막 셋 · 다섯 · 256 · 앞의 0", () => {
    for (const host of ["10.77.88", "10.77.88.99.1", "256.1.1.1", "010.1.1.1", "10.77.88.9a", "10.77.88.-1"]) {
      assert.deepEqual(quoteFolderHelperZoneHosts({ uncRoot: `\\\\${host}\\archive` }), [], host);
    }
  });

  test("루트가 규칙 밖이면 뽑지 않고 던진다 — 오류에 값이 실리지 않는다", () => {
    assert.throws(
      () => quoteFolderHelperZoneHosts({ uncRoot: "\\\\TESTNAS\\it's" }),
      (error: unknown) => error instanceof QuoteFolderHelperRootError && !String(error).includes("it's")
    );
  });
});

describe("🔴 영역 등록 본문 — 코드에 IP 가 없다 · HKCU 만 · payload 안에만", () => {
  test("🔴 설치 파일 · 설치 명령의 날 글자에 IP 가 없다 — ZONEHOSTS payload 안에만 있다", () => {
    const installer = buildQuoteFolderHelperInstaller({ uncRoot: IP_ROOT });
    const command = buildQuoteFolderHelperInlineInstallCommand({ uncRoot: IP_ROOT });
    assert.equal(installer.includes(IP_HOST), false, "설치 파일의 날 글자에 IP 가 있다");
    assert.equal(command.includes(IP_HOST), false, "설치 명령의 날 글자에 IP 가 있다");
    // 🔴 값은 설정에서 왔다 — payload 안에는 그대로 있다.
    assert.equal(zoneHostsPayloadText(installer), `${IP_HOST}\n`);
    assert.equal(inlinePayloadOf(command, "ZONEHOSTS").toString("utf8"), `${IP_HOST}\n`);
    // 루트가 다르면 본문도 다르다 — 코드에 박힌 값이 아니다.
    const other = buildQuoteFolderHelperInstaller({ uncRoot: IP_ROOT_2 });
    assert.equal(zoneHostsPayloadText(other), `${IP_HOST_2}\n`);
  });

  test("🔴 고정된 본문(알맹이 · 설치 문장 · 자리)에는 IP 가 한 글자도 없다", () => {
    const ipv4 = /\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/;
    for (const text of [
      QUOTE_FOLDER_HELPER_ZONE_REGISTER_PS,
      QUOTE_FOLDER_HELPER_ZONE_RANGES_PATH,
      QUOTE_FOLDER_HELPER_ZONE_REGISTERED_MESSAGE,
      QUOTE_FOLDER_HELPER_ZONE_FAILED_MESSAGE,
      quoteFolderHelperInstallCommand(),
    ]) {
      assert.equal(ipv4.test(text), false, text.slice(0, 120));
    }
  });

  test("등록할 주소가 없으면 payload 는 줄바꿈 하나 — 빈 덩어리를 만들지 않는다", () => {
    const installer = buildQuoteFolderHelperInstaller({ uncRoot: FAKE_UNC });
    assert.equal(zoneHostsPayloadText(installer), "\n");
    const command = buildQuoteFolderHelperInlineInstallCommand({ uncRoot: FAKE_UNC });
    assert.equal(inlinePayloadOf(command, "ZONEHOSTS").toString("utf8"), "\n");
  });

  test("🔴 자리는 HKCU 아래 ZoneMap\\Ranges 하나 — HKLM · LocalMachine 이 한 글자도 없다", () => {
    const body = quoteFolderHelperInstallCommand();
    const installer = buildQuoteFolderHelperInstaller({ uncRoot: IP_ROOT });
    assert.equal(
      QUOTE_FOLDER_HELPER_ZONE_RANGES_PATH,
      "Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings\\ZoneMap\\Ranges"
    );
    assert.equal(QUOTE_FOLDER_HELPER_ZONE_RANGES_PATH.startsWith("\\"), false, "HKCU 아래 상대 경로여야 한다");
    assert.ok(body.includes(`$zoneRangesPath = '${QUOTE_FOLDER_HELPER_ZONE_RANGES_PATH}'`));
    assert.equal(body.match(/ZoneMap/g)?.length, 1);
    // 🔴 레지스트리를 여는 자리는 CurrentUser 뿐이다 — 알맹이에도, 설치 문장에도.
    assert.equal(QUOTE_FOLDER_HELPER_ZONE_REGISTER_PS.match(/Registry\]::CurrentUser/g)?.length, 1);
    for (const forbidden of ["HKLM", "LocalMachine", "HKEY_LOCAL_MACHINE", "reg.exe", "RunAs", "Start-Process"]) {
      assert.equal(QUOTE_FOLDER_HELPER_ZONE_REGISTER_PS.includes(forbidden), false, forbidden);
      assert.equal(installer.includes(forbidden), false, forbidden);
    }
  });

  test("🔴 알맹이는 고른 키 하나에만 쓴다 — 다른 RangeN 은 읽기만 한다", () => {
    const core = QUOTE_FOLDER_HELPER_ZONE_REGISTER_PS;
    // 값을 쓰는 것은 둘(:Range · *)뿐이고, 둘 다 `$zoneKey`(고른 키) 위다.
    assert.equal(core.match(/SetValue\(/g)?.length, 2);
    assert.equal(core.match(/\$zoneKey\.SetValue\(/g)?.length, 2);
    assert.ok(core.includes("$zoneKey.SetValue(':Range', $zoneHost, [Microsoft.Win32.RegistryValueKind]::String)"));
    assert.ok(core.includes("$zoneKey.SetValue('*', 1, [Microsoft.Win32.RegistryValueKind]::DWord)"));
    // 지우는 코드는 **만들지 않았다** — 되돌리는 법은 소스 주석에만 있다.
    for (const forbidden of ["DeleteSubKey", "DeleteValue", "Remove-Item", "Remove-ItemProperty"]) {
      assert.equal(core.includes(forbidden), false, forbidden);
    }
    // 🔴 다른 키는 OpenSubKey 로 **읽기만** 한다.
    assert.ok(core.includes("$zoneExisting = $zoneRanges.OpenSubKey($zoneCandidate)"));
    assert.ok(core.includes("$zoneRange = $zoneExisting.GetValue(':Range')"));
  });

  test("🔴 알맹이에는 cmd 가 해석하는 글자가 없다 — 파이프도 쓰지 않는다", () => {
    for (const character of ["%", "!", "^", "&", "|", "<", ">", '"', "`"]) {
      assert.equal(QUOTE_FOLDER_HELPER_ZONE_REGISTER_PS.includes(character), false, character);
    }
    assert.equal(/[\r\n]/.test(QUOTE_FOLDER_HELPER_ZONE_REGISTER_PS), false);
  });

  test("🔴 영역 등록은 폴더 열기 등록이 **끝난 뒤** 돈다 — 곁다리가 앞을 막지 않는다", () => {
    const body = quoteFolderHelperInstallCommand();
    const marks = [
      "[System.IO.File]::WriteAllBytes($script, (Read-DssPayload 'HELPER'))",
      "[Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('Software\\Classes\\dss-folder')",
      "$commandKey.SetValue('', $command)",
      "$zoneHostText = ''",
      QUOTE_FOLDER_HELPER_ZONE_REGISTER_PS,
      "Write-Host ([System.Text.Encoding]::UTF8.GetString((Read-DssPayload 'DONE')))",
    ];
    let previous = -1;
    for (const mark of marks) {
      const at = body.indexOf(mark);
      assert.ok(at >= 0, `없다: ${mark.slice(0, 60)}`);
      assert.ok(at > previous, `순서가 어긋났다: ${mark.slice(0, 60)}`);
      previous = at;
    }
    // 🔴 payload 를 못 읽어도 설치는 이어진다 — 읽기도 자기 try/catch 안이다.
    assert.ok(
      body.includes(
        "try { $zoneHostText = [System.Text.Encoding]::UTF8.GetString((Read-DssPayload 'ZONEHOSTS')) } catch { $zoneHostText = '' }"
      )
    );
    // 🔴 알맹이의 마지막은 비어 있는 catch 다 — 던지지 않는다.
    assert.ok(QUOTE_FOLDER_HELPER_ZONE_REGISTER_PS.endsWith("catch { }"));
  });

  test("사람이 보는 결과 문구에 무엇을 했는지 한 줄 — 주소는 적지 않는다", () => {
    const installer = buildQuoteFolderHelperInstaller({ uncRoot: IP_ROOT });
    assert.equal(payloadOf(installer, "ZONE").toString("utf8"), QUOTE_FOLDER_HELPER_ZONE_REGISTERED_MESSAGE);
    assert.equal(payloadOf(installer, "ZONEFAIL").toString("utf8"), QUOTE_FOLDER_HELPER_ZONE_FAILED_MESSAGE);
    assert.ok(QUOTE_FOLDER_HELPER_ZONE_REGISTERED_MESSAGE.includes("로컬 인트라넷"));
    assert.ok(QUOTE_FOLDER_HELPER_ZONE_REGISTERED_MESSAGE.includes("확인창"));
    // 🔴 등록만 실패했을 때 — 도우미 설치는 끝났다고 분명히 말한다.
    assert.ok(QUOTE_FOLDER_HELPER_ZONE_FAILED_MESSAGE.includes("폴더 열기는 설치되었습니다"));
    for (const text of [QUOTE_FOLDER_HELPER_ZONE_REGISTERED_MESSAGE, QUOTE_FOLDER_HELPER_ZONE_FAILED_MESSAGE]) {
      assert.equal(/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/.test(text), false, text);
    }
    // 등록할 주소가 없으면 두 줄 다 나오지 않는다(설치 문장의 if).
    assert.ok(quoteFolderHelperInstallCommand().includes("if ($zoneWanted -ne 0) { if ($zoneCount -eq $zoneWanted)"));
  });

  test("🔴 payload 앞의 셋은 글자 하나 움직이지 않았다 — 더한 것은 뒤뿐이다", () => {
    const installer = buildQuoteFolderHelperInstaller({ uncRoot: FAKE_UNC });
    const lines = installer.split("\r\n");
    const order = ["HELPER", "DONE", "FAILED", "ZONEHOSTS", "ZONE", "ZONEFAIL"].map((name) =>
      lines.indexOf(`DSS-PAYLOAD-${name}-BEGIN`)
    );
    for (let index = 0; index < order.length; index += 1) {
      assert.ok(order[index] >= 0, `payload 가 없다: ${index}`);
      if (index > 0) assert.ok(order[index] > order[index - 1], `차례가 어긋났다: ${index}`);
    }
  });
});

/**
 * 🔴 **진짜 영역 설정을 건드리지 않는다** — `$zoneRangesPath` 에 임시 키를 넣어 알맹이만 돌린다.
 * `after` 가 그 임시 키를 통째로 지운다.
 */
describe("🔴 영역 등록 — 임시 키에 실제로 쓴다(진짜 자리는 읽기만)", { skip: WINDOWS_ONLY }, () => {
  const TEMP_BASE = `Software\\DSS-Test-${randomBytes(8).toString("hex")}`;
  const ZONE_PATH = `${TEMP_BASE}\\Ranges`;
  let parent = "";
  let realBefore = "";

  /** 키 하나를 읽어 `이름 :Range값 *값 :Range종류 *종류` 줄로. 없는 값 · 종류는 빈 글자. */
  const READ_RANGES_PS = [
    "$key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($env:DSS_TEST_ZONE_PATH)",
    "if ($null -eq $key) { Write-Output 'NO-KEY' } else { foreach ($name in $key.GetSubKeyNames()) { $sub = $key.OpenSubKey($name); $range = [string]$sub.GetValue(':Range'); $star = [string]$sub.GetValue('*'); $kindRange = ''; $kindStar = ''; try { $kindRange = [string]$sub.GetValueKind(':Range') } catch { }; try { $kindStar = [string]$sub.GetValueKind('*') } catch { }; $sub.Close(); Write-Output ($name + ' ' + $range + ' ' + $star + ' ' + $kindRange + ' ' + $kindStar) }; $key.Close() }",
  ].join("; ");

  async function readRanges(zonePath: string): Promise<string[]> {
    const result = await runPowerShell(["-NoProfile", "-NonInteractive", "-Command", READ_RANGES_PS], {
      env: { DSS_TEST_ZONE_PATH: zonePath },
    });
    assert.equal(result.code, 0, result.stderr);
    return result.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .sort();
  }

  /** 임시 키에 「사람이 먼저 만들어 둔 항목」을 심는다 — 전체 경로를 그대로 받는다. */
  async function seedAt(keyPath: string, range: string, star: number): Promise<void> {
    const result = await runPowerShell(
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        [
          "$ErrorActionPreference = 'Stop'",
          "$key = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey($env:DSS_TEST_SEED_PATH)",
          "$key.SetValue(':Range', $env:DSS_TEST_SEED_RANGE, [Microsoft.Win32.RegistryValueKind]::String)",
          "$key.SetValue('*', [int]$env:DSS_TEST_SEED_STAR, [Microsoft.Win32.RegistryValueKind]::DWord)",
          "$key.Close()",
        ].join("; "),
      ],
      {
        env: {
          DSS_TEST_SEED_PATH: keyPath,
          DSS_TEST_SEED_RANGE: range,
          DSS_TEST_SEED_STAR: String(star),
        },
      }
    );
    assert.equal(result.code, 0, result.stderr);
  }

  /** 알맹이를 한 번 돌린다 — 그 뒤에 「설치가 이어졌다」는 줄을 찍어 던지지 않았음을 본다. */
  async function runZone(options: { zonePath: string; hosts: readonly string[] }): Promise<RunResult> {
    const file = path.join(parent, `hosts-${randomBytes(4).toString("hex")}.txt`);
    await writeFile(file, `${options.hosts.join("\n")}\n`, "utf8");
    return runPowerShell(
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        [
          "$ErrorActionPreference = 'Stop'",
          "$zoneHostText = [System.IO.File]::ReadAllText($env:DSS_TEST_ZONE_HOSTS, [System.Text.Encoding]::UTF8)",
          "$zoneRangesPath = $env:DSS_TEST_ZONE_PATH",
          QUOTE_FOLDER_HELPER_ZONE_REGISTER_PS,
          "Write-Output ('WANTED=' + $zoneWanted)",
          "Write-Output ('COUNT=' + $zoneCount)",
          "Write-Output 'INSTALL-CONTINUED'",
        ].join("; "),
      ],
      { env: { DSS_TEST_ZONE_HOSTS: file, DSS_TEST_ZONE_PATH: options.zonePath } }
    );
  }

  async function deleteTempKey(): Promise<void> {
    await runPowerShell([
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      [
        "$key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($env:DSS_TEST_BASE)",
        "if ($null -ne $key) { $key.Close(); [Microsoft.Win32.Registry]::CurrentUser.DeleteSubKeyTree($env:DSS_TEST_BASE) }",
      ].join("; "),
    ], { env: { DSS_TEST_BASE: TEMP_BASE } });
  }

  before(async () => {
    parent = await mkdtemp(path.join(os.tmpdir(), "dss-folder-zone-test-"));
    // 🔴 진짜 자리는 **읽기만** 한다 — 시험 앞뒤로 같은지 보려고 적어 둔다.
    realBefore = (await readRanges(QUOTE_FOLDER_HELPER_ZONE_RANGES_PATH)).join("\n");
  });

  after(async () => {
    await deleteTempKey();
    if (parent) await rm(parent, { recursive: true, force: true });
  });

  test("비어 있던 자리에 Range1 — :Range 는 REG_SZ, * 는 REG_DWORD 1", async () => {
    const zonePath = `${ZONE_PATH}\\빈자리`;
    const result = await runZone({ zonePath, hosts: [IP_HOST] });
    assert.equal(result.code, 0, result.stderr);
    assert.ok(result.stdout.includes("WANTED=1"), result.stdout);
    assert.ok(result.stdout.includes("COUNT=1"), result.stdout);
    assert.deepEqual(await readRanges(zonePath), [`Range1 ${IP_HOST} 1 String DWord`]);
  });

  test("🔴 이미 같은 :Range 가 있으면 새로 만들지 않는다 — 그 키를 쓴다", async () => {
    const zonePath = `${ZONE_PATH}\\이미있음`;
    await seedAt(`${zonePath}\\Range7`, IP_HOST, 4);
    const result = await runZone({ zonePath, hosts: [IP_HOST] });
    assert.equal(result.code, 0, result.stderr);
    assert.ok(result.stdout.includes("COUNT=1"), result.stdout);
    // 🔴 키가 하나 그대로다 — 번호도 그대로이고 `*` 만 1 로 고쳐졌다.
    assert.deepEqual(await readRanges(zonePath), [`Range7 ${IP_HOST} 1 String DWord`]);
    // 대소문자가 달라도 같은 주소로 본다(여기서는 숫자라 값 자체로 한 번 더 확인).
    const again = await runZone({ zonePath, hosts: [IP_HOST] });
    assert.ok(again.stdout.includes("COUNT=1"), again.stdout);
    assert.deepEqual(await readRanges(zonePath), [`Range7 ${IP_HOST} 1 String DWord`]);
  });

  test("🔴 다른 RangeN 은 건드리지 않는다 — 안 쓰이는 번호를 고른다", async () => {
    const zonePath = `${ZONE_PATH}\\남의것`;
    await seedAt(`${zonePath}\\Range1`, "10.1.1.1", 2);
    await seedAt(`${zonePath}\\Range3`, "10.3.3.3", 3);
    const result = await runZone({ zonePath, hosts: [IP_HOST] });
    assert.equal(result.code, 0, result.stderr);
    assert.ok(result.stdout.includes("COUNT=1"), result.stdout);
    assert.deepEqual(await readRanges(zonePath), [
      "Range1 10.1.1.1 2 String DWord",
      `Range2 ${IP_HOST} 1 String DWord`,
      "Range3 10.3.3.3 3 String DWord",
    ]);
  });

  test("🔴 주소가 둘이면 키도 둘 · 같은 주소를 둘 주면 하나", async () => {
    const twice = `${ZONE_PATH}\\둘`;
    const result = await runZone({ zonePath: twice, hosts: [IP_HOST, IP_HOST_2] });
    assert.ok(result.stdout.includes("WANTED=2"), result.stdout);
    assert.ok(result.stdout.includes("COUNT=2"), result.stdout);
    assert.deepEqual(await readRanges(twice), [
      `Range1 ${IP_HOST} 1 String DWord`,
      `Range2 ${IP_HOST_2} 1 String DWord`,
    ]);

    const same = `${ZONE_PATH}\\같은것`;
    const second = await runZone({ zonePath: same, hosts: [IP_HOST, IP_HOST] });
    assert.ok(second.stdout.includes("COUNT=2"), second.stdout);
    // 두 번 돌아도 키는 하나 — 둘째가 첫째를 다시 찾는다.
    assert.deepEqual(await readRanges(same), [`Range1 ${IP_HOST} 1 String DWord`]);
  });

  test("🔴 등록할 주소가 없으면 키를 만들지도 않는다 — 이름뿐인 PC 는 그대로다", async () => {
    const zonePath = `${ZONE_PATH}\\없음`;
    const result = await runZone({ zonePath, hosts: [] });
    assert.equal(result.code, 0, result.stderr);
    assert.ok(result.stdout.includes("WANTED=0"), result.stdout);
    assert.ok(result.stdout.includes("COUNT=0"), result.stdout);
    assert.deepEqual(await readRanges(zonePath), ["NO-KEY"]);
  });

  test("🔴 영역 등록이 실패해도 던지지 않는다 — 설치는 이어진다", async () => {
    // 레지스트리 키 이름 한도를 넘겨 일부러 실패시킨다.
    const result = await runZone({ zonePath: `${ZONE_PATH}\\${"가".repeat(300)}`, hosts: [IP_HOST] });
    assert.equal(result.code, 0, result.stderr);
    assert.ok(result.stdout.includes("WANTED=1"), result.stdout);
    assert.ok(result.stdout.includes("COUNT=0"), result.stdout);
    // 🔴 여기까지 왔다는 것이 「도우미 설치가 끝난다」는 뜻이다.
    assert.ok(result.stdout.includes("INSTALL-CONTINUED"), result.stdout);
  });

  /**
   * 🔴 설정값 → payload → 읽개 → 레지스트리까지 **설치 명령이 가는 길 그대로** 한 번.
   * 자리만 임시 키로 바꿔 끼운다(`$zoneRangesPath`) — 그 한 줄이 진짜 자리를 가리키는지는
   * 위 「자리는 HKCU 아래 ZoneMap\Ranges 하나」가 본다.
   */
  test("🔴 설치 명령이 품은 ZONEHOSTS 를 읽개로 풀어 그대로 등록한다 — 같은 NAS 는 한 번만", async () => {
    const zonePath = `${ZONE_PATH}\\명령에서`;
    const reader = quoteFolderHelperInlinePayloadReaderPs({
      uncRoot: IP_ROOT,
      uncRootAlt: FAKE_UNC,
      extraRoots: [IP_ROOT_2, "\\\\10.77.88.99\\현황표"],
    });
    const result = await runPowerShell(
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        [
          "$ErrorActionPreference = 'Stop'",
          reader,
          "$zoneHostText = [System.Text.Encoding]::UTF8.GetString((Read-DssPayload 'ZONEHOSTS'))",
          "$zoneRangesPath = $env:DSS_TEST_ZONE_PATH",
          QUOTE_FOLDER_HELPER_ZONE_REGISTER_PS,
          "Write-Output ('COUNT=' + $zoneCount)",
        ].join("; "),
      ],
      { env: { DSS_TEST_ZONE_PATH: zonePath } }
    );
    assert.equal(result.code, 0, result.stderr);
    // 루트는 넷인데 IP 호스트는 둘 — 이름(FAKE_UNC)은 빠지고 같은 IP 는 한 번이다.
    assert.ok(result.stdout.includes("COUNT=2"), result.stdout);
    assert.deepEqual(await readRanges(zonePath), [
      `Range1 ${IP_HOST} 1 String DWord`,
      `Range2 ${IP_HOST_2} 1 String DWord`,
    ]);
  });

  test("🔴 이 PC 의 진짜 영역 설정이 그대로다 — 읽기만 했다", async () => {
    const realAfter = (await readRanges(QUOTE_FOLDER_HELPER_ZONE_RANGES_PATH)).join("\n");
    assert.equal(realAfter, realBefore, "🔴 진짜 ZoneMap\\Ranges 가 바뀌었다");
  });
});

// ── 견적서 폴더의 전체 공유폴더 주소(UNC) ──────────────────────────────────

describe("전체 공유폴더 주소(UNC)", () => {
  const RELATIVE = "21. 2026 내자견적서/DSS 2026-089 R&D 100% 가나상사 수리 견적서";
  const EXPECTED = `${FAKE_UNC}\\21. 2026 내자견적서\\DSS 2026-089 R&D 100% 가나상사 수리 견적서`;

  test("루트와 상대 경로를 역슬래시 하나로 잇는다 — 루트 끝에 \\ 가 있든 없든", () => {
    assert.equal(buildQuoteFolderHelperUncPath({ uncRoot: FAKE_UNC, relativePath: RELATIVE }), EXPECTED);
    assert.equal(buildQuoteFolderHelperUncPath({ uncRoot: `${FAKE_UNC}\\`, relativePath: RELATIVE }), EXPECTED);
    assert.equal(buildQuoteFolderHelperUncPath({ uncRoot: `  ${FAKE_UNC}  `, relativePath: RELATIVE }), EXPECTED);
    // 맨 앞의 `\\` 말고는 역슬래시가 겹치지 않는다.
    assert.equal(EXPECTED.slice(2).includes("\\\\"), false);
    assert.equal(buildQuoteFolderHelperUncPath({ uncRoot: "Z:\\견적서", relativePath: "2026" }), "Z:\\견적서\\2026");
  });

  test("루트 · 경로가 규칙 밖이면 null — 주소를 지어내지 않는다", () => {
    for (const uncRoot of ["", "   ", "/mnt/archive", "\\\\TESTNAS", "\\\\TESTNAS\\it's"]) {
      assert.equal(buildQuoteFolderHelperUncPath({ uncRoot, relativePath: RELATIVE }), null, JSON.stringify(uncRoot));
    }
    for (const relativePath of ["", "..", "../바깥 폴더", "2026\\견적서", "/2026", "C:/Windows", "2026//견적서", "2026/견적서 "]) {
      assert.equal(
        buildQuoteFolderHelperUncPath({ uncRoot: FAKE_UNC, relativePath }),
        null,
        JSON.stringify(relativePath)
      );
    }
  });

  test("resolveQuoteFolderHelperUncPath — 비었으면(unset) · 틀리면(invalid) null, 맞으면 전체 주소", () => {
    const original = process.env.QUOTE_ARCHIVE_UNC_ROOT;
    try {
      delete process.env.QUOTE_ARCHIVE_UNC_ROOT;
      assert.equal(resolveQuoteFolderHelperUncPath(RELATIVE), null);
      process.env.QUOTE_ARCHIVE_UNC_ROOT = "   ";
      assert.equal(resolveQuoteFolderHelperUncPath(RELATIVE), null);
      process.env.QUOTE_ARCHIVE_UNC_ROOT = "/mnt/archive";
      assert.equal(resolveQuoteFolderHelperUncPath(RELATIVE), null);
      process.env.QUOTE_ARCHIVE_UNC_ROOT = `${FAKE_UNC}\\`;
      assert.equal(resolveQuoteFolderHelperUncPath(RELATIVE), EXPECTED);
      // 설정이 맞아도 경로가 규칙 밖이면 null.
      assert.equal(resolveQuoteFolderHelperUncPath("../바깥 폴더"), null);
    } finally {
      if (original === undefined) delete process.env.QUOTE_ARCHIVE_UNC_ROOT;
      else process.env.QUOTE_ARCHIVE_UNC_ROOT = original;
    }
  });
});
