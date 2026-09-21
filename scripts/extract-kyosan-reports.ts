import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

import { CARD_FIELDS, CARD_LISTS } from "../src/lib/kyosan/card-fields";
import { readKyosanReport, type KyosanReport } from "../src/lib/kyosan/kyosan-report";

/**
 * ============================================================================
 * 교산 연락서 판독기 실측 — 469장에서 **얼마나 뽑히는가** (2026-09-21, S1)
 * ============================================================================
 * `src/lib/kyosan/` 의 판독기를 실제 연락서 무더기에 돌려 항목별 추출률을 센다.
 * 시험이 통과하는 것과 실제 자료에서 뽑히는 것은 다른 이야기이고, 이 표가
 * S2(원인 사전)·S3(저장)의 설계 근거가 된다.
 *
 * ── 🔴 개인정보 — 이 스크립트의 핵심 ──────────────────────────────────
 * 연락서에는 고객명·모델·S/N·고장 내용이 그대로 들어 있다. 그래서 결과물에
 * **값을 한 글자도 적지 않는다.** 적는 것은 개수와 비율뿐이다.
 *
 *  · 뽑아낸 값은 세기만 하고 버린다 — 적을 자리 자체를 두지 않았다.
 *  · 파일 이름도 적지 않는다(이름에 모델·L/N·S/N 이 들어 있다). 번호로만 부른다.
 *  · 딱 하나 글자를 적는 곳이 「원인·처치 보기」인데, 그것도 **서로 다른 파일
 *    N장 이상(`--min-files`, 기본 20)에 똑같이 나온 글자만** 적는다. 양식의
 *    보기는 수백 장에 공통으로 나오므로 남고, 누가 손으로 적어 넣은 글자는
 *    그 파일에만 있으므로 자동으로 가려진다. 규칙 하나가 둘을 처리한다.
 *  · `--out` 이 저장소 안을 가리키면 거부한다 — 저장소는 언젠가 push 된다.
 *
 * ── 쓰는 법 ─────────────────────────────────────────────────────────────
 *   npx tsx scripts/extract-kyosan-reports.ts --dir="D:/a" --dir="D:/b" --out=D:/표.md
 * ============================================================================
 */

const DEFAULT_MIN_FILES = 20;

/** 확장자가 이것이면 통합문서로 본다(`.xlsm` 은 확장자만 다른 zip 이다). */
const WORKBOOK_EXTENSIONS = new Set([".xlsm", ".xlsx"]);

type Options = { dirs: string[]; out: string | null; minFiles: number };

function parseOptions(argv: readonly string[]): Options | string {
  const dirs: string[] = [];
  let out: string | null = null;
  let minFiles = DEFAULT_MIN_FILES;

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
      case "min-files": {
        const parsed = Number(value);
        if (!Number.isInteger(parsed)) return "--min-files 는 정수여야 합니다.";
        if (parsed < 2) return "--min-files 는 2 이상이어야 합니다(1 이면 보호가 사라집니다).";
        minFiles = parsed;
        break;
      }
      default:
        return `모르는 인자입니다: --${name}`;
    }
  }

  if (dirs.length === 0) return "--dir=<폴더> 가 하나 이상 필요합니다.";
  return { dirs, out, minFiles };
}

/** 결과물이 저장소 안으로 떨어지는 것을 막는다(위 머리말). */
function isInsideRepo(outPath: string): boolean {
  const relative = path.relative(process.cwd(), path.resolve(outPath));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

/** 폴더를 재귀로 훑어 통합문서를 모은다. 경로 오름차순 = 파일 번호가 늘 같다. */
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

// ── 세는 것들 ──────────────────────────────────────────────────────────────

type Counter = Map<string, number>;

function bump(counter: Counter, key: string, by = 1): void {
  counter.set(key, (counter.get(key) ?? 0) + by);
}

type Tally = {
  /** 훑은 파일 수(폴더별). */
  perDirectory: { dir: string; files: number }[];
  /** 열지 못한 파일 — 사유별. 엑셀 잠금 파일은 여기 `not-a-workbook` 으로 온다. */
  failures: Counter;
  /** 양식 갈래별 장수. */
  families: Counter;
  /** 항목별: 라벨을 찾은 장수 / 값까지 뽑은 장수. */
  labelFound: Counter;
  valueFound: Counter;
  /** 목록 항목: 값이 하나라도 있는 장수 · 값 개수 합 · 옛 양식 되돌림 장수. */
  listNonEmpty: Counter;
  listValues: Counter;
  listLegacy: Counter;
  /** 원인·처치 보기 글자가 나온 장수(가림 문턱을 넘겨야 적는다). */
  optionText: Counter;
  markedText: Counter;
  /** 구역을 찾은 장수 · ○ 가 하나라도 있던 장수. */
  markSection: Counter;
  markAny: Counter;
  /** 사진. 크기별로도 센다 — 작은 것은 사진이 아니라 양식의 아이콘·도장이다. */
  filesWithPhotos: number;
  uniquePhotos: number;
  photoPlacements: number;
  photoSizeBuckets: Counter;
  /** 원본 해시 → 장수. 같은 연락서가 두 번 들어 있으면 여기서 드러난다. */
  sourceHashes: Counter;
  /** 수리보고서 시트를 찾은 장수. */
  reportSheetFound: number;
  /** 읽는 데 성공한 장수. 비율의 분모다. */
  readable: number;
  /** 판독기가 남긴 문제 쪽지 수. */
  problems: number;
};

function emptyTally(): Tally {
  return {
    perDirectory: [],
    failures: new Map(),
    families: new Map(),
    labelFound: new Map(),
    valueFound: new Map(),
    listNonEmpty: new Map(),
    listValues: new Map(),
    listLegacy: new Map(),
    optionText: new Map(),
    markedText: new Map(),
    markSection: new Map(),
    markAny: new Map(),
    filesWithPhotos: 0,
    uniquePhotos: 0,
    photoPlacements: 0,
    photoSizeBuckets: new Map(),
    sourceHashes: new Map(),
    reportSheetFound: 0,
    readable: 0,
    problems: 0,
  };
}

function record(tally: Tally, report: KyosanReport): void {
  tally.readable += 1;
  bump(tally.families, report.formFamily);
  bump(tally.sourceHashes, report.sourceSha256);
  if (report.repairReportSheetName !== null) tally.reportSheetFound += 1;
  tally.problems += report.problems.length;

  for (const spec of CARD_FIELDS) {
    const field = report.card.fields[spec.key];
    if (field.labelAddress !== null) bump(tally.labelFound, spec.key);
    if (field.value !== null) bump(tally.valueFound, spec.key);
  }

  for (const spec of CARD_LISTS) {
    const list = report.card.lists[spec.key];
    if (list.labelCount > 0) bump(tally.labelFound, spec.key);
    if (list.values.length > 0) bump(tally.listNonEmpty, spec.key);
    bump(tally.listValues, spec.key, list.values.length);
    if (list.usedLegacy) bump(tally.listLegacy, spec.key);
  }

  for (const [group, marks] of [
    ["원인", report.cause],
    ["처치", report.action],
  ] as const) {
    if (marks.sectionAddress !== null) bump(tally.markSection, group);
    if (marks.marked.length > 0) bump(tally.markAny, group);
    // 한 파일 안에서 같은 글자가 여러 번 나와도 한 장으로 센다(가림 문턱의 뜻).
    for (const text of new Set(marks.options)) bump(tally.optionText, `${group}\u0000${text}`);
    for (const text of new Set(marks.marked)) bump(tally.markedText, `${group}\u0000${text}`);
  }

  if (report.photos.length > 0) tally.filesWithPhotos += 1;
  tally.uniquePhotos += report.photos.length;
  for (const photo of report.photos) {
    tally.photoPlacements += photo.placements;
    bump(tally.photoSizeBuckets, photoSizeBucket(photo.bytes));
  }
}

/** 크기 구간. 실측에서 1KB 짜리는 양식 아이콘, 2~5KB 는 도장, 수십 KB 가 사진이다. */
function photoSizeBucket(bytes: number): string {
  if (bytes < 4 * 1024) return "4KB 미만(양식 아이콘)";
  if (bytes < 10 * 1024) return "4~10KB(도장·로고)";
  if (bytes < 100 * 1024) return "10~100KB";
  return "100KB 이상";
}

// ── 보고서 ─────────────────────────────────────────────────────────────────

function percent(count: number, total: number): string {
  if (total === 0) return "—";
  return `${Math.round((count / total) * 1000) / 10}%`;
}

/** 🔴 결과에 글자를 적는 유일한 통로. 문턱을 못 넘으면 모양만 적는다. */
function reveal(text: string, files: number, minFiles: number): string {
  return files >= minFiles ? `\`${text.replace(/\|/g, "\\|")}\`` : `<값·글자${[...text].length}>`;
}

function buildReport(tally: Tally, minFiles: number): string {
  const lines: string[] = [];
  const scanned = tally.perDirectory.reduce((sum, entry) => sum + entry.files, 0);
  const failed = [...tally.failures.values()].reduce((sum, count) => sum + count, 0);

  lines.push("# 교산 연락서 판독기 실측 — 항목별 추출률");
  lines.push("");
  lines.push(`- 훑은 파일: **${scanned}장** · 읽어 낸 파일: **${tally.readable}장** · 열지 못함: **${failed}장**`);
  lines.push(
    `- 🔴 보호 규칙: 뽑아낸 **값은 한 글자도 적지 않는다**. 파일 이름도 적지 않는다. ` +
      `원인·처치 보기만 서로 다른 파일 **${minFiles}장 이상**에 나온 것을 적고, 그 미만은 \`<값·글자N>\` 로 가린다.`
  );
  lines.push("- 매크로는 실행하지 않는다 — zip 항목을 풀어 XML 만 읽는다.");
  lines.push("");

  lines.push("## A. 훑은 범위");
  lines.push("");
  lines.push("| 폴더 | 파일 |");
  lines.push("|---|---:|");
  tally.perDirectory.forEach((entry, index) => {
    lines.push(`| 폴더 #${index + 1} | ${entry.files} |`);
  });
  lines.push("");
  lines.push("| 열지 못한 사유 | 장수 |");
  lines.push("|---|---:|");
  if (tally.failures.size === 0) lines.push("| (없음) | 0 |");
  for (const [reason, count] of sortedByCount(tally.failures)) lines.push(`| \`${reason}\` | ${count} |`);
  lines.push("");

  lines.push("## B. 양식 갈래");
  lines.push("");
  lines.push("| 갈래 | 장수 | 비율 |");
  lines.push("|---|---:|---:|");
  for (const [family, count] of sortedByCount(tally.families)) {
    lines.push(`| \`${family}\` | ${count} | ${percent(count, tally.readable)} |`);
  }
  lines.push("");
  lines.push(
    `- 수리보고서 시트를 찾은 파일: **${tally.reportSheetFound}장** (${percent(tally.reportSheetFound, tally.readable)})`
  );
  lines.push(`- 판독기가 남긴 문제 쪽지: **${tally.problems}개**`);
  lines.push("");

  lines.push("## C. 항목별 추출률");
  lines.push("");
  lines.push(
    "**라벨**은 그 판본에 그 항목 이름이 있었는가, **값**은 거기까지 읽어 냈는가다. " +
      "라벨은 높은데 값이 낮으면 **사람이 안 적은 칸**이고, 라벨부터 낮으면 **판본이 그 항목을 안 쓴다**는 뜻이다."
  );
  lines.push("");
  lines.push("| 항목 | 라벨 | 값 | 값 비율 |");
  lines.push("|---|---:|---:|---:|");
  for (const spec of CARD_FIELDS) {
    const labels = tally.labelFound.get(spec.key) ?? 0;
    const values = tally.valueFound.get(spec.key) ?? 0;
    lines.push(`| ${spec.caption} | ${labels} | ${values} | ${percent(values, tally.readable)} |`);
  }
  lines.push("");

  lines.push("## D. 목록 항목");
  lines.push("");
  lines.push("| 항목 | 라벨 있음 | 값 있음 | 값 비율 | 값 개수 합 | 옛 양식 되돌림 |");
  lines.push("|---|---:|---:|---:|---:|---:|");
  for (const spec of CARD_LISTS) {
    const labels = tally.labelFound.get(spec.key) ?? 0;
    const nonEmpty = tally.listNonEmpty.get(spec.key) ?? 0;
    lines.push(
      `| ${spec.caption} | ${labels} | ${nonEmpty} | ${percent(nonEmpty, tally.readable)} ` +
        `| ${tally.listValues.get(spec.key) ?? 0} | ${tally.listLegacy.get(spec.key) ?? 0} |`
    );
  }
  lines.push("");

  lines.push("## E. 원인·처치 ○ 표시");
  lines.push("");
  lines.push("| 구역 | 구역 찾음 | ○ 하나 이상 | ○ 비율 |");
  lines.push("|---|---:|---:|---:|");
  for (const group of ["원인", "처치"]) {
    const section = tally.markSection.get(group) ?? 0;
    const any = tally.markAny.get(group) ?? 0;
    lines.push(`| ${group} | ${section} | ${any} | ${percent(any, tally.readable)} |`);
  }
  lines.push("");
  lines.push("**보기별 ○ 장수** — 보기 글자는 양식의 것이고, 가림 문턱을 넘은 것만 그대로 적는다.");
  lines.push("");
  lines.push("| 구역 | 보기 | 보기가 나온 장수 | ○ 가 찍힌 장수 |");
  lines.push("|---|---|---:|---:|");
  let maskedKinds = 0;
  let maskedMarked = 0;
  for (const [composite, files] of sortedByCount(tally.optionText)) {
    const [group, text] = composite.split("\u0000");
    const marked = tally.markedText.get(composite) ?? 0;
    // 🔴 문턱을 못 넘은 글자는 줄 자체를 적지 않는다. 글자 수만 수백 줄 늘어놓아도
    // 「어느 파일에 몇 글자짜리 값이 있다」는 지도가 된다 — 종류와 개수만 센다.
    if (files < minFiles) {
      maskedKinds += 1;
      maskedMarked += marked;
      continue;
    }
    lines.push(`| ${group} | ${reveal(text, files, minFiles)} | ${files} | ${marked} |`);
  }
  lines.push("");
  lines.push(
    `- 가려진 보기: **${maskedKinds}종** (그 가운데 ○ 가 찍힌 것 ${maskedMarked}장분) — ` +
      "양식의 보기가 아니라 **사람이 손으로 적어 넣은 글자**이거나, 판독기가 옆 상자를 잘못 집은 것이다."
  );
  lines.push("");

  lines.push("## F. 사진");
  lines.push("");
  lines.push(`- 사진이 하나라도 있던 파일: **${tally.filesWithPhotos}장** (${percent(tally.filesWithPhotos, tally.readable)})`);
  lines.push(`- 내용 해시로 묶은 **서로 다른 그림**: **${tally.uniquePhotos}개**`);
  lines.push(`- 그림이 놓인 자리 수(묶기 전): **${tally.photoPlacements}개**`);
  lines.push(
    `- 🔴 묶어서 줄어든 비율: **${percent(tally.photoPlacements - tally.uniquePhotos, tally.photoPlacements)}** ` +
      "— 같은 그림이 여러 시트에 재사용되는 정도다."
  );
  lines.push("");
  lines.push("| 그림 크기 | 개수 |");
  lines.push("|---|---:|");
  for (const [bucket, count] of sortedByCount(tally.photoSizeBuckets)) {
    lines.push(`| ${bucket} | ${count} |`);
  }
  lines.push("");

  lines.push("## G. 원본 파일 해시");
  lines.push("");
  const duplicateGroups = [...tally.sourceHashes.values()].filter((count) => count > 1);
  const duplicateFiles = duplicateGroups.reduce((sum, count) => sum + count, 0);
  lines.push(`- 서로 다른 원본: **${tally.sourceHashes.size}개** / 읽은 파일 ${tally.readable}장`);
  lines.push(
    `- 🔴 내용이 똑같은 파일 묶음: **${duplicateGroups.length}묶음 ${duplicateFiles}장** ` +
      "— S3(저장)에서 유니크 제약을 걸 때 이 숫자가 근거다."
  );
  lines.push("");

  return lines.join("\n");
}

function sortedByCount(counter: Counter): [string, number][] {
  return [...counter.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
}

// ── 실행 ───────────────────────────────────────────────────────────────────

function main(): number {
  const options = parseOptions(process.argv.slice(2));
  if (typeof options === "string") {
    console.error(options);
    console.error(
      '쓰는 법: npx tsx scripts/extract-kyosan-reports.ts --dir="<폴더>" [--dir=…] [--out=<저장소 밖 파일>] [--min-files=N]'
    );
    return 1;
  }

  if (options.out && isInsideRepo(options.out)) {
    console.error("--out 이 저장소 안을 가리킵니다. 저장소 밖 경로를 쓰세요.");
    return 1;
  }

  const tally = emptyTally();

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

    const files = findWorkbooks(rootDir);
    tally.perDirectory.push({ dir: rootDir, files: files.length });

    for (const filePath of files) {
      const result = readKyosanReport(readFileSync(filePath));
      if (!result.ok) {
        bump(tally.failures, result.reason);
        continue;
      }
      record(tally, result.report);
    }
  }

  const report = buildReport(tally, options.minFiles);
  if (options.out) {
    writeFileSync(path.resolve(options.out), report, "utf8");
    const scanned = tally.perDirectory.reduce((sum, entry) => sum + entry.files, 0);
    console.log(`결과를 저장했습니다. 훑은 ${scanned}장 가운데 ${tally.readable}장을 읽었습니다.`);
  } else {
    console.log(report);
  }
  return 0;
}

process.exit(main());
