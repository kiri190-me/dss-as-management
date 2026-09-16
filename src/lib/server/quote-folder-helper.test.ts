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
  QUOTE_FOLDER_HELPER_INSTALLER_PATH_ENV,
  QUOTE_FOLDER_HELPER_INSTALL_EXIT_PS,
  QUOTE_FOLDER_HELPER_INSTALL_FAILED_MESSAGE,
  QUOTE_FOLDER_HELPER_PAYLOAD_READER_PS,
  QUOTE_FOLDER_HELPER_ROOT_MAX_LENGTH,
  QuoteFolderHelperRootError,
  buildQuoteFolderHelperInlineInstallCommand,
  buildQuoteFolderHelperInstaller,
  buildQuoteFolderHelperScript,
  buildQuoteFolderHelperUncPath,
  normalizeQuoteFolderHelperRoot,
  quoteFolderHelperInlinePayloadReaderPs,
  quoteFolderHelperInstallCommand,
  quoteFolderHelperInteractiveStatements,
  quoteFolderHelperScriptBytes,
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
    assert.equal(command.match(/SetValue\(/g)?.length, 3);
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
