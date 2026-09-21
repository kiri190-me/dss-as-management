import "./load-env";

import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

import { loadKyosanReportLinkTargets, serialLookupKey } from "../src/lib/db/queries/kyosan-report-link";
import { readKyosanReport, type KyosanReport } from "../src/lib/kyosan/kyosan-report";
import {
  matchKyosanReport,
  readKyosanIdentity,
  type KyosanCaseCandidate,
  type KyosanMatch,
  type KyosanReportIdentity,
} from "../src/lib/kyosan/report-match";
import { buildKyosanReportPreview, type KyosanReportPreview } from "../src/lib/kyosan/report-preview";

/**
 * ============================================================================
 * 교산 연락서 짝짓기 실측 — **실제로 몇 장이 짝지어지는가** (2026-09-21, S3a)
 * ============================================================================
 * 연락서 무더기를 판독해 **개발 DB 의 실제 수리 건**과 맞춰 보고, 짝이 하나 /
 * 여럿 / 없음으로 몇 장씩 갈리는지 센다. 이 표가 S3b(저장)의 설계 근거다.
 *
 * ── 🔴 DB 를 읽기만 한다 ──────────────────────────────────────────────
 * 부르는 것은 `loadKyosanReportLinkTargets` 하나뿐이고, 그 안에는 `select` 밖에
 * 없다. insert · update · delete 를 한 줄도 부르지 않는다.
 *
 * ── 🔴 개인정보 ───────────────────────────────────────────────────────
 * 결과에 **값을 한 글자도 적지 않는다**(`scripts/extract-kyosan-reports.ts` 와
 * 같은 규칙). 파일 이름도, 접수번호도, 모델도, S/N 도 적지 않는다. 적는 것은
 * 개수와 비율뿐이다. `--out` 이 저장소 안을 가리키면 거부한다.
 *
 * ── 쓰는 법 ─────────────────────────────────────────────────────────────
 *   node --conditions=react-server --import tsx scripts/match-kyosan-reports.ts \
 *     --dir="D:/연락서" [--dir=…] [--out=<저장소 밖 파일>]
 *   (`--conditions=react-server` 가 있어야 질의 쪽 `server-only` 가 풀린다.)
 * ============================================================================
 */

const WORKBOOK_EXTENSIONS = new Set([".xlsm", ".xlsx"]);

type Options = { dirs: string[]; out: string | null };

function parseOptions(argv: readonly string[]): Options | string {
  const dirs: string[] = [];
  let out: string | null = null;

  for (const argument of argv) {
    const matched = /^--([a-z-]+)(?:=([\s\S]*))?$/.exec(argument);
    if (!matched) return `모르는 인자입니다: ${argument}`;
    const [, name, value] = matched;
    switch (name) {
      case "dir":
        if (!value) return "--dir 에 폴더 경로가 없습니다.";
        dirs.push(value);
        break;
      case "out":
        if (!value) return "--out 에 파일 경로가 없습니다.";
        out = value;
        break;
      default:
        return `모르는 인자입니다: --${name}`;
    }
  }
  if (dirs.length === 0) return "--dir=<폴더> 가 하나 이상 필요합니다.";
  return { dirs, out };
}

function isInsideRepo(outPath: string): boolean {
  const relative = path.relative(process.cwd(), path.resolve(outPath));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function findWorkbooks(rootDir: string): string[] {
  const found: string[] = [];
  function walk(dir: string): void {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const child = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(child);
      else if (entry.isFile() && WORKBOOK_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        found.push(child);
      }
    }
  }
  walk(rootDir);
  return found.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

type Counter = Map<string, number>;
function bump(counter: Counter, key: string, by = 1): void {
  counter.set(key, (counter.get(key) ?? 0) + by);
}
function sortedByCount(counter: Counter): [string, number][] {
  return [...counter.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
}
function percent(count: number, total: number): string {
  if (total === 0) return "—";
  return `${Math.round((count / total) * 1000) / 10}%`;
}
function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

type Scanned = { report: KyosanReport; identity: KyosanReportIdentity };

async function main(): Promise<number> {
  const options = parseOptions(process.argv.slice(2));
  if (typeof options === "string") {
    console.error(options);
    console.error(
      '쓰는 법: node --conditions=react-server --import tsx scripts/match-kyosan-reports.ts --dir="<폴더>" [--out=<저장소 밖 파일>]'
    );
    return 1;
  }
  if (options.out && isInsideRepo(options.out)) {
    console.error("--out 이 저장소 안을 가리킵니다. 저장소 밖 경로를 쓰세요.");
    return 1;
  }

  // ── 1. 판독 ─────────────────────────────────────────────────────────────
  const scanned: Scanned[] = [];
  const failures: Counter = new Map();
  let filesSeen = 0;

  for (const dir of options.dirs) {
    const rootDir = path.resolve(dir);
    try {
      if (!statSync(rootDir).isDirectory()) {
        console.error("--dir 가 폴더가 아닙니다.");
        return 1;
      }
    } catch (error) {
      console.error(`--dir 를 열지 못했습니다: ${error instanceof Error ? error.message : String(error)}`);
      return 1;
    }
    for (const filePath of findWorkbooks(rootDir)) {
      filesSeen += 1;
      const result = readKyosanReport(readFileSync(filePath));
      if (!result.ok) {
        bump(failures, result.reason);
        continue;
      }
      scanned.push({ report: result.report, identity: readKyosanIdentity(result.report.card) });
    }
  }

  // ── 2. DB 에서 후보 읽기 (🔴 select 만) ─────────────────────────────────
  const targets = await loadKyosanReportLinkTargets({
    intakeNumbers: scanned
      .map((entry) => entry.identity.intakeNumber)
      .filter((value): value is string => value !== null),
    serialNumbers: scanned
      .map((entry) => entry.identity.serialNumber)
      .filter((value): value is string => value !== null),
  });

  // ── 3. 짝짓기 · 미리보기 ────────────────────────────────────────────────
  const intakeStatus: Counter = new Map();
  const outcomes: Counter = new Map();
  const unmatchedReasons: Counter = new Map();
  const ambiguousReasons: Counter = new Map();
  const identityAgreement: Counter = new Map();
  const blockerKinds: Counter = new Map();
  const warningKinds: Counter = new Map();
  const filesPerCase: Counter = new Map();
  const intakeNumberFiles: Counter = new Map();
  const sourceHashes: Counter = new Map();

  let importable = 0;
  let matchedInTrash = 0;
  let matchedWithExistingReport = 0;
  const lineCounts: number[] = [];
  const partCounts: number[] = [];
  const photoCounts: number[] = [];
  let photoTotal = 0;
  let formAssetTotal = 0;

  for (const entry of scanned) {
    const { identity, report } = entry;
    bump(sourceHashes, report.sourceSha256);
    if (identity.intakeNumber !== null) bump(intakeNumberFiles, identity.intakeNumber);

    const serialKey = serialLookupKey(identity.serialNumber);
    const identityCandidates: readonly KyosanCaseCandidate[] =
      serialKey === null ? [] : (targets.casesBySerialKey.get(serialKey) ?? []);

    const match: KyosanMatch = matchKyosanReport({
      identity,
      caseByIntakeNumber:
        identity.intakeNumber === null
          ? null
          : (targets.casesByIntakeNumber.get(identity.intakeNumber) ?? null),
      identityCandidates,
    });

    bump(intakeStatus, match.intakeNumberStatus);
    bump(outcomes, match.outcome.kind);

    const caseState =
      match.outcome.kind === "matched"
        ? (targets.caseStates.get(match.outcome.candidate.repairCaseId) ?? null)
        : null;
    const preview: KyosanReportPreview = buildKyosanReportPreview(report, match, caseState);

    if (match.outcome.kind === "unmatched") bump(unmatchedReasons, match.outcome.reason);
    if (match.outcome.kind === "ambiguous") {
      bump(ambiguousReasons, `${match.outcome.reason} (후보 ${match.outcome.candidates.length}건)`);
    }
    if (match.outcome.kind === "matched") {
      for (const [field, agreement] of Object.entries(match.outcome.identity)) {
        bump(identityAgreement, `${field}\u0000${agreement}`);
      }
      if (match.outcome.candidate.isDeleted) matchedInTrash += 1;
      if ((caseState?.serviceReportCount ?? 0) > 0) matchedWithExistingReport += 1;
      bump(filesPerCase, match.outcome.candidate.repairCaseId);
    }

    for (const blocker of preview.blockers) bump(blockerKinds, blocker);
    for (const warning of preview.warnings) bump(warningKinds, warning);

    if (preview.plan !== null) {
      importable += 1;
      lineCounts.push(preview.plan.lines.length);
      partCounts.push(preview.plan.parts.length);
      photoCounts.push(preview.plan.photoCount);
      photoTotal += preview.plan.photoCount;
      formAssetTotal += preview.plan.formAssetCount;
    }
  }

  // ── 4. 표 ───────────────────────────────────────────────────────────────
  const readable = scanned.length;
  const lines: string[] = [];
  const failed = [...failures.values()].reduce((sum, value) => sum + value, 0);

  lines.push("# 교산 연락서 ↔ 수리 건 짝짓기 실측");
  lines.push("");
  lines.push(`- 훑은 파일 **${filesSeen}장** · 읽어 낸 파일 **${readable}장** · 열지 못함 **${failed}장**`);
  lines.push("- 🔴 DB 는 **읽기만** 했다(select). 🔴 값은 한 글자도 적지 않는다 — 개수와 비율뿐이다.");
  lines.push("");

  lines.push("| 열지 못한 사유 | 장수 |");
  lines.push("|---|---:|");
  if (failures.size === 0) lines.push("| (없음) | 0 |");
  for (const [reason, value] of sortedByCount(failures)) lines.push(`| \`${reason}\` | ${value} |`);
  lines.push("");

  lines.push("## A. 접수번호");
  lines.push("");
  lines.push("| 상태 | 장수 | 비율 |");
  lines.push("|---|---:|---:|");
  for (const key of ["found", "not-found", "malformed", "missing"]) {
    lines.push(`| \`${key}\` | ${intakeStatus.get(key) ?? 0} | ${percent(intakeStatus.get(key) ?? 0, readable)} |`);
  }
  lines.push("");
  const duplicateNumbers = [...intakeNumberFiles.values()].filter((value) => value > 1);
  lines.push(
    `- 서로 다른 접수번호 **${intakeNumberFiles.size}개** · 🔴 **여러 장에 겹치는 번호 ${duplicateNumbers.length}개** ` +
      `(${duplicateNumbers.reduce((sum, value) => sum + value, 0)}장, 최대 ${Math.max(0, ...duplicateNumbers)}장)`
  );
  const duplicateHashes = [...sourceHashes.values()].filter((value) => value > 1);
  lines.push(
    `- 원본 파일 해시: 서로 다른 것 **${sourceHashes.size}개** / ${readable}장 · 내용이 같은 묶음 ${duplicateHashes.length}개`
  );
  lines.push("");

  lines.push("## B. 🔴 짝짓기 결과");
  lines.push("");
  lines.push("| 갈래 | 장수 | 비율 |");
  lines.push("|---|---:|---:|");
  for (const kind of ["matched", "ambiguous", "unmatched"]) {
    lines.push(`| ${kind} | ${outcomes.get(kind) ?? 0} | ${percent(outcomes.get(kind) ?? 0, readable)} |`);
  }
  lines.push("");
  lines.push("| 짝 없음 — 까닭 | 장수 | 비율 |");
  lines.push("|---|---:|---:|");
  if (unmatchedReasons.size === 0) lines.push("| (없음) | 0 | — |");
  for (const [reason, value] of sortedByCount(unmatchedReasons)) {
    lines.push(`| \`${reason}\` | ${value} | ${percent(value, readable)} |`);
  }
  lines.push("");
  lines.push("| 짝 여럿 — 까닭 | 장수 |");
  lines.push("|---|---:|");
  if (ambiguousReasons.size === 0) lines.push("| (없음) | 0 |");
  for (const [reason, value] of sortedByCount(ambiguousReasons)) lines.push(`| \`${reason}\` | ${value} |`);
  lines.push("");

  lines.push("## C. 짝지은 건의 신원 견줌");
  lines.push("");
  lines.push("| 항목 | 같음 | 다름 | 모름 |");
  lines.push("|---|---:|---:|---:|");
  for (const field of ["model", "serialNumber", "lotNumber", "customer"]) {
    const get = (agreement: string) => identityAgreement.get(`${field}\u0000${agreement}`) ?? 0;
    lines.push(`| ${field} | ${get("agree")} | ${get("differ")} | ${get("unknown")} |`);
  }
  lines.push("");
  lines.push(`- 짝지었는데 **휴지통**의 건: **${matchedInTrash}장**`);
  lines.push(`- 짝지은 건에 **이미 보고서가 있는** 것: **${matchedWithExistingReport}장**`);
  const multiFileCases = [...filesPerCase.values()].filter((value) => value > 1);
  lines.push(
    `- 🔴 짝지어진 수리 건 **${filesPerCase.size}건** · 그 가운데 **연락서가 여러 장 걸린 건 ${multiFileCases.length}건** ` +
      `(${multiFileCases.reduce((sum, value) => sum + value, 0)}장, 최대 ${Math.max(0, ...multiFileCases)}장) — S3b 가 결정해야 한다.`
  );
  lines.push("");

  lines.push("## D. 미리보기로 들어갈 것");
  lines.push("");
  lines.push(`- 넣을 수 있는(plan 이 있는) 연락서: **${importable}장** (${percent(importable, readable)})`);
  lines.push(
    `- 보고서 줄: 합계 ${lineCounts.reduce((sum, value) => sum + value, 0)}줄 · 중앙값 ${median(lineCounts)}줄 · 최대 ${Math.max(0, ...lineCounts)}줄`
  );
  lines.push(
    `- 교체 부품: 합계 ${partCounts.reduce((sum, value) => sum + value, 0)}개 · 중앙값 ${median(partCounts)}개 · 최대 ${Math.max(0, ...partCounts)}개`
  );
  lines.push(
    `- 🔴 사진(양식 자산을 걸러 낸 것): 합계 **${photoTotal}장** · 중앙값 ${median(photoCounts)}장 · 최대 ${Math.max(0, ...photoCounts)}장 ` +
      `· 걸러 낸 양식 아이콘·도장 ${formAssetTotal}개`
  );
  lines.push("");

  lines.push("## E. 막은 까닭 · 알린 것");
  lines.push("");
  lines.push("| 막은 까닭(blocker) | 장수 |");
  lines.push("|---|---:|");
  if (blockerKinds.size === 0) lines.push("| (없음) | 0 |");
  for (const [text, value] of sortedByCount(blockerKinds)) lines.push(`| ${text} | ${value} |`);
  lines.push("");
  lines.push("| 알린 것(warning) | 장수 |");
  lines.push("|---|---:|");
  if (warningKinds.size === 0) lines.push("| (없음) | 0 |");
  for (const [text, value] of sortedByCount(warningKinds)) lines.push(`| ${text} | ${value} |`);
  lines.push("");

  const report = lines.join("\n");
  if (options.out) {
    writeFileSync(path.resolve(options.out), report, "utf8");
    console.log(`결과를 저장했습니다. 훑은 ${filesSeen}장 가운데 ${readable}장을 읽었습니다.`);
  } else {
    console.log(report);
  }
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(`실패: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
