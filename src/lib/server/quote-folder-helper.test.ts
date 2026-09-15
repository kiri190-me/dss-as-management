import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";

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
  QUOTE_FOLDER_HELPER_INSTALL_FAILED_MESSAGE,
  QUOTE_FOLDER_HELPER_PAYLOAD_READER_PS,
  QUOTE_FOLDER_HELPER_ROOT_MAX_LENGTH,
  QuoteFolderHelperRootError,
  buildQuoteFolderHelperInstaller,
  buildQuoteFolderHelperScript,
  normalizeQuoteFolderHelperRoot,
  quoteFolderHelperInstallCommand,
  quoteFolderHelperScriptBytes,
  resolveQuoteFolderHelperRoot,
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
    assert.ok(script.includes(`$Root = '${FAKE_UNC}'\r\n`));
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

  test("🔴 탐색기 말고는 아무것도 부르지 않는다 — 셸 실행 · 코드 실행 · 네트워크 · 파일 쓰기가 없다", () => {
    for (const forbidden of [
      "Invoke-Expression",
      "iex ",
      "Invoke-Item",
      "Start-Process",
      "Invoke-Command",
      "ScriptBlock",
      "-Command",
      "-EncodedCommand",
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
    assert.equal(script.match(/Process\]::Start\(/g)?.length, 1);
    assert.ok(script.includes("$start.FileName = Join-Path $env:SystemRoot 'explorer.exe'"));
    assert.ok(script.includes("$start.UseShellExecute = $false"));
    assert.ok(script.includes(`$start.Arguments = '"' + $full + '\\"'`));
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
      "Test-Path -LiteralPath $full -PathType Container",
      "[System.IO.FileAttributes]::ReparsePoint",
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
    assert.ok(helper.toString("utf8").includes(`$Root = '${FAKE_UNC}'`));
    assert.equal(payloadOf(installer, "DONE").toString("utf8"), QUOTE_FOLDER_HELPER_INSTALLED_MESSAGE);
    assert.equal(payloadOf(installer, "FAILED").toString("utf8"), QUOTE_FOLDER_HELPER_INSTALL_FAILED_MESSAGE);
  });

  test("요청마다 만든다 — 루트가 다르면 본문이 다르다", () => {
    const other = buildQuoteFolderHelperInstaller({ uncRoot: "\\\\TESTNAS2\\archive" });
    assert.notEqual(other, installer);
    assert.ok(payloadOf(other, "HELPER").toString("utf8").includes("$Root = '\\\\TESTNAS2\\archive'"));
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
    assert.equal(body.match(/SetValue\(/g)?.length, 3);
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
