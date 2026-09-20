import { readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

import { columnLettersToNumber, readSheetGrid } from "../src/lib/xlsx/sheet-grid";
import { WORKBOOK_PART } from "../src/lib/xlsx/workbook-parts";
import { decodeXmlCharacterData } from "../src/lib/xlsx/xml-entities";
import { ZipArchive } from "../src/lib/xlsx/zip-reader";

/**
 * ============================================================================
 * 교산 연락서(`*.xlsm`) 판본 조사 — 읽기만 하는 도구
 * ============================================================================
 * 앞으로 연락서 450장을 읽어 수리 건을 채우는 **판독기**를 만든다. 이 스크립트는
 * 그 앞 단계다 — 판독기를 짜기 전에 **판독기가 무엇을 견뎌야 하는지 먼저 세는**
 * 도구다. 세 가지를 알고 싶다.
 *
 *  1. 양식 판본이 몇 가지인가
 *  2. 판본마다 어떤 라벨이 **어느 칸**에 앉아 있는가
 *  3. 같은 라벨이 판본마다 **어디로 옮겨 가는가**  ← 판독기 설계의 핵심
 *
 * 이미 아는 것: 양식이 최소 둘이고(매처용·제너레이터용), 제너레이터 것은 Card
 * 시트 이름이 반각 `ｶｰﾄﾞ` 이며 `Photographs` 시트가 없다. 같은 라벨이 파일마다
 * 다른 줄에 있다(`客先故障状況①` 이 B53 / B51). 그래서 판독기는 고정 주소가
 * 아니라 **라벨 글자로** 찾아야 한다 — 이 표가 그 근거를 실측해 준다.
 *
 * ── 🔴 개인정보 보호 — 이 스크립트의 핵심 ───────────────────────────────
 * 연락서에는 고객명·모델·S/N·고장 증상이 그대로 들어 있다. 결과물에 그것이
 * 새어 나오면 안 된다. 그래서 글자를 **그대로 적는 기준은 하나**다:
 *
 *   ▸ 서로 다른 파일 N장 이상에 똑같이 나온 글자만 그대로 적는다(`--min-files`,
 *     기본 2). 그 미만이면 내용을 적지 않고 모양만 적는다 — `<값·글자12>`.
 *
 * 양식 라벨은 모든 파일에 공통으로 나오므로 남고, 고객 고유값은 그 파일에만
 * 나오므로 **자동으로 가려진다.** 규칙 하나가 둘을 동시에 처리한다.
 *
 * 곁들여 지키는 것:
 *  · **숫자 칸은 값을 아예 목록에 올리지 않는다** — 판본별 개수만 센다. 지시서의
 *    `<수>` 자리표시자보다 한 단계 더 센 보호다(적을 자리 자체를 없앴다).
 *  · **파일 이름을 적지 않는다.** 이름에 모델·L/N·S/N 이 들어 있다
 *    (`Repair_Report_A7_6020_CMK300M-IC2_WT9842_2207083.xlsm`). 번호(#1…)로만 부른다.
 *  · **시트 이름도 같은 규칙을 통과해야** 적는다. 시트 이름은 거의 언제나 양식의
 *    일부지만, 누가 시트 이름에 고객명을 적어 두지 않았다고 보증할 수 없다.
 *  · `--out` 이 저장소 안을 가리키면 거부한다. 결과물에 고객 내용이 섞일 수 있고
 *    저장소는 언젠가 push 된다.
 *  · `--min-files=1` 은 거부한다 — 그러면 모든 글자가 그대로 나가 보호가 사라진다.
 *
 * ⚠️ 이 규칙의 한계를 알고 쓴다: **같은 값이 파일 N장에 겹치면 그 값도 공개된다.**
 * 같은 고객사가 여러 번 수리를 맡기면 고객사 이름이 그 문턱을 넘는다. 그래서
 * 결과물은 저장소 밖에 두고, 밖으로 낼 표라면 `--min-files` 를 올려서 다시 뽑는다.
 *
 * ── 판본으로 묶는 법 ────────────────────────────────────────────────────
 * 지문은 (시트 이름 차례) + (Card 계열 시트에서 **라벨이 놓인 칸 주소**)다.
 * 여기서 "라벨" 을 두 단계로 걸러야 쓸 만한 묶음이 나온다:
 *
 *  1. 서로 다른 파일 **2장 이상**에 나온 글자 — 한 파일에만 있는 글자는 고객 값이다.
 *     (이 문턱은 `--min-files` 와 **별개로 고정**이다. `--min-files` 는 적을지
 *     말지만 정하는 손잡이여야 한다 — 그것이 묶는 방식까지 바꾸면 `--min-files=99`
 *     로 검증할 때 판본 개수가 달라져 같은 표를 견줄 수 없다.)
 *  2. 🔴 **한 파일 안에서 두 번 이상 나오지 않는 글자.** 이 걸름이 없으면 묶음이
 *     망가진다 — 실측에서 `OK`(체크 표시) · `-`(빈칸 채움) 같은 **값**이 파일마다
 *     수십 군데에 흩어져 있어, 같은 양식인 파일 둘이 서로 다른 판본으로 갈렸다.
 *     양식 라벨은 한 장에 한 번 적힌다. 여러 자리에 겹치는 글자는 라벨이 아니라
 *     표시다.
 *
 * 그리고 지문을 **똑같은지**가 아니라 **어긋나는지**로 견준다. 값 하나가 다르다고
 * 판본을 가르면 450장은 450가지가 된다. 두 파일은 시트 차례가 같고, **둘 다 가진
 * 라벨의 자리가 모두 같으면** 한 판본이다(한쪽에만 있는 라벨은 가르지 않는다).
 * 지시서의 엄격한 집합-일치 지문도 함께 세어 머리말에 적는다 — 둘을 견주면 값
 * 때문에 갈린 정도가 바로 보인다.
 *
 * ── 매크로는 실행하지 않는다 ────────────────────────────────────────────
 * `.xlsm` 은 확장자만 다를 뿐 zip 구조가 `.xlsx` 와 같다. 여기서는 zip 항목을
 * 풀어 XML 을 읽을 뿐이고 `xl/vbaProject.bin` 은 손도 대지 않는다.
 *
 * ── 쓰는 법 ─────────────────────────────────────────────────────────────
 *   npx tsx scripts/scan-kyosan-reports.ts --dir="D:/연락서" [--out=D:/조사.md] [--min-files=3]
 * ============================================================================
 */

/** 라벨로 쳐 주는 최소 파일 수. 판본을 묶는 데만 쓴다(위 주석 참조). */
const COMMON_LABEL_MIN_FILES = 2;

/** 지시서 기본값. `--min-files` 로 올릴 수는 있어도 이 아래로는 못 내린다. */
const DEFAULT_MIN_FILES = 2;

/** B절 한 칸에 주소를 몇 개까지 적을지. 넘으면 "외 N칸" 으로 줄인다. */
const MAX_ADDRESSES_PER_CELL = 6;

type Options = {
  dir: string;
  out: string | null;
  minFiles: number;
};

/** 한 파일에서 실측한 것. 파일 이름은 **일부러 담지 않는다** — 번호로만 부른다. */
type ScannedFile = {
  /** #1 부터. 경로 오름차순으로 매겨 실행할 때마다 같은 번호가 나온다. */
  number: number;
  /** workbook.xml 에 적힌 차례 그대로. */
  sheetNames: string[];
  /** 찾아낸 Card 계열 시트 이름. 없으면 null. */
  cardSheetName: string | null;
  /** 칸 주소(`B53`) → 글자. Card 계열 시트의 글자 칸 전부. */
  cardTexts: Map<string, string>;
  /** Card 계열 시트의 숫자 칸 개수. 값은 담지 않는다. */
  cardNumberCells: number;
  /** 못 읽었으면 사유. 읽었으면 null. */
  failure: string | null;
};

type FormVersion = {
  label: string;
  files: ScannedFile[];
  /** 대표 파일 — 라벨이 가장 많은 파일. 시트 차례·개수를 이 파일로 적는다. */
  sample: ScannedFile;
  /** 라벨 → 칸 주소. 판본에 속한 파일들에서 합친 것(어긋남이 없음은 묶을 때 확인했다). */
  labelAddress: Map<string, string>;
};

// ── 인자 ───────────────────────────────────────────────────────────────────

function parseOptions(argv: readonly string[]): Options | string {
  let dir: string | null = null;
  let out: string | null = null;
  let minFiles = DEFAULT_MIN_FILES;

  for (const argument of argv) {
    const matched = /^--([a-z-]+)(?:=([\s\S]*))?$/.exec(argument);
    if (!matched) return `모르는 인자입니다: ${argument}`;
    const [, name, value] = matched;

    switch (name) {
      case "dir":
        if (!value) return "--dir 에 폴더 경로가 없습니다.";
        dir = value;
        break;
      case "out":
        if (!value) return "--out 에 파일 경로가 없습니다.";
        out = value;
        break;
      case "min-files": {
        const parsed = Number(value);
        if (!Number.isInteger(parsed)) return "--min-files 는 정수여야 합니다.";
        // 1 이면 "한 파일에만 있는 글자" 까지 그대로 나간다 = 고객 내용이 새는 값이다.
        if (parsed < 2) return "--min-files 는 2 이상이어야 합니다(1 이면 보호가 사라집니다).";
        minFiles = parsed;
        break;
      }
      default:
        return `모르는 인자입니다: --${name}`;
    }
  }

  if (!dir) return "--dir=<폴더> 가 필요합니다.";
  return { dir, out, minFiles };
}

/**
 * 결과물이 저장소 안으로 떨어지는 것을 막는다. 가려지지 않은 라벨만 적히더라도
 * 저장소는 언젠가 push 되고, 그때 판단하는 사람은 이 스크립트를 모른다.
 */
function isInsideRepo(outPath: string): boolean {
  const relative = path.relative(process.cwd(), path.resolve(outPath));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

// ── 파일 찾기 ──────────────────────────────────────────────────────────────

/**
 * 폴더를 재귀로 훑어 `.xlsm` 을 모은다. 경로 오름차순으로 돌려주므로 파일 번호가
 * 실행할 때마다 같다.
 *
 * `~$…` 는 엑셀이 열어 둔 문서 옆에 만드는 잠금 파일이라 건너뛴다. 심볼릭 링크는
 * 따라가지 않는다 — 링크를 따라가면 조사 범위 밖의 파일이 딸려 들어온다.
 */
function findWorkbooks(rootDir: string): string[] {
  const found: string[] = [];

  function walk(dir: string): void {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const child = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(child);
      } else if (entry.isFile()) {
        if (entry.name.startsWith("~$")) continue;
        if (path.extname(entry.name).toLowerCase() === ".xlsm") found.push(child);
      }
    }
  }

  walk(rootDir);
  return found.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

// ── 한 파일 읽기 ───────────────────────────────────────────────────────────

/**
 * workbook.xml 의 시트 차례. `resolveSheetPart` 는 이름을 주면 파트를 찾아 주지만
 * **이름 목록**은 주지 않으므로 여기서 읽는다.
 *
 * `<sheet\b` 는 `<sheets>` 를 잡지 않는다(`t`↔`s` 사이에 낱말 경계가 없다).
 */
function readSheetNames(archive: ZipArchive): string[] {
  const workbookXml = archive.readText(WORKBOOK_PART);
  const sheetsBlock = /<sheets\b[^>]*>([\s\S]*?)<\/sheets>/.exec(workbookXml);
  if (!sheetsBlock) return [];

  const names: string[] = [];
  for (const tag of sheetsBlock[1].matchAll(/<sheet\b[^>]*?\/?>/g)) {
    const name = /\bname="([^"]*)"/.exec(tag[0])?.[1];
    if (name !== undefined) names.push(decodeXmlCharacterData(name));
  }
  return names;
}

/**
 * 🔴 Card 계열 시트 판별 규칙.
 *
 * 같은 "카드" 를 양식마다 다르게 적는다 — 매처 양식은 `Card`, 제너레이터 양식은
 * **반각 가타카나** `ｶｰﾄﾞ` 다. 이름을 글자 그대로 견주면 둘 중 하나를 놓친다.
 * 그래서 세 단계로 눌러 맞춘다:
 *
 *  1. `NFKC` 정규화 — 반각 `ｶｰﾄﾞ` 가 전각 `カード` 가 된다(탁점 `ﾞ` 도 합쳐진다).
 *  2. 공백을 걷고 소문자로 — ` CARD ` 와 `card` 를 같게 본다.
 *  3. 가타카나 → 히라가나 — `カード` 와 `かーど` 를 같게 본다.
 *
 * 그렇게 눌러서 `card` 또는 `かーど` 가 되면 Card 계열이다. 여럿이면 workbook 에
 * 먼저 적힌 것을 쓴다.
 *
 * 일부러 **접두사 일치(`startsWith("card")`)를 쓰지 않는다** — `Card_List` 같은
 * 딴 시트를 Card 로 잘못 집으면 라벨 지도가 통째로 틀린다. 놓치는 쪽이 낫다:
 * 놓치면 C절에 "Card 계열 시트 없음" 으로 드러나 사람이 규칙을 고칠 수 있다.
 */
function isCardSheetName(sheetName: string): boolean {
  const compact = sheetName.normalize("NFKC").replace(/\s+/g, "").toLowerCase();
  // `ー`(U+30FC) 는 이 범위 밖이라 그대로 남는다 — 히라가나 표기에서도 같은 글자다.
  const hiragana = compact.replace(/[\u30A1-\u30F6]/g, (character) =>
    String.fromCodePoint((character.codePointAt(0) ?? 0) - 0x60)
  );
  return hiragana === "card" || hiragana === "かーど";
}

/**
 * 글자를 견주기 좋게 다듬는다. 줄바꿈(`_x000D_`)·전각 공백이 파일마다 들쭉날쭉이라
 * 그대로 견주면 같은 라벨이 다른 라벨로 갈린다. `\s` 는 전각 공백(U+3000)도 잡는다.
 */
function normalizeCellText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function scanFile(filePath: string, fileNumber: number): ScannedFile {
  const empty: ScannedFile = {
    number: fileNumber,
    sheetNames: [],
    cardSheetName: null,
    cardTexts: new Map(),
    cardNumberCells: 0,
    failure: null,
  };

  let archive: ZipArchive;
  let sheetNames: string[];
  try {
    archive = ZipArchive.fromFile(filePath);
    sheetNames = readSheetNames(archive);
  } catch (error) {
    return { ...empty, failure: `열지 못함 — ${errorMessage(error)}` };
  }

  const cardSheetName = sheetNames.find(isCardSheetName) ?? null;
  if (!cardSheetName) return { ...empty, sheetNames, failure: "Card 계열 시트 없음" };

  let grid: ReturnType<typeof readSheetGrid>;
  try {
    // readSheetGrid 가 후리가나(`<rPh>`)를 걷어낸 공유문자열로 읽는다 —
    // 안 걷으면 `種別` 이 `種別シュベツ` 가 되어 라벨 대조가 전부 어긋난다.
    grid = readSheetGrid(archive, cardSheetName);
  } catch (error) {
    return {
      ...empty,
      sheetNames,
      cardSheetName,
      failure: `Card 시트를 읽지 못함 — ${errorMessage(error)}`,
    };
  }
  if (!grid) {
    return { ...empty, sheetNames, cardSheetName, failure: "Card 시트 파트를 찾지 못함" };
  }

  const cardTexts = new Map<string, string>();
  let cardNumberCells = 0;
  for (const rowNumber of grid.rowNumbers) {
    for (const [columnLetters, cell] of grid.cells(rowNumber)) {
      if (cell.kind === "number") {
        // 🔴 값은 담지 않는다. 모델 연번·수량·날짜가 여기로 온다.
        cardNumberCells += 1;
        continue;
      }
      const text = normalizeCellText(cell.text);
      if (text === "") continue;
      cardTexts.set(`${columnLetters}${rowNumber}`, text);
    }
  }

  return {
    number: fileNumber,
    sheetNames,
    cardSheetName,
    cardTexts,
    cardNumberCells,
    failure: cardTexts.size === 0 ? "Card 시트에 글자 칸이 없음" : null,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// ── 몇 장에 나왔나 세기 ────────────────────────────────────────────────────

type TextStats = {
  /** 그 글자가 나온 **서로 다른 파일** 수. 한 파일에 몇 번 나오든 한 장이다. */
  files: number;
  /** 한 파일 안에서 나온 최대 횟수. 2 이상이면 라벨이 아니라 표시다. */
  maxPerFile: number;
};

/**
 * 시트 이름과 칸 글자를 **따로** 센다. 합치면 "어느 파일의 칸에 우연히 들어 있던
 * 글자" 때문에 한 파일에만 있는 시트 이름이 공개될 수 있다 — 따로 세는 쪽이 좁다.
 */
function tallyTexts(perFile: Iterable<readonly string[]>): Map<string, TextStats> {
  const tally = new Map<string, TextStats>();
  for (const texts of perFile) {
    const here = new Map<string, number>();
    for (const text of texts) here.set(text, (here.get(text) ?? 0) + 1);
    for (const [text, count] of here) {
      const stats = tally.get(text);
      if (stats) {
        stats.files += 1;
        stats.maxPerFile = Math.max(stats.maxPerFile, count);
      } else {
        tally.set(text, { files: 1, maxPerFile: count });
      }
    }
  }
  return tally;
}

function filesWith(tally: Map<string, TextStats>, text: string): number {
  return tally.get(text)?.files ?? 0;
}

/** 라벨인가 — 파일 2장 이상에 나오고, 한 파일 안에서 겹치지 않는 글자(위 주석 2번). */
function isLabelText(tally: Map<string, TextStats>, text: string): boolean {
  const stats = tally.get(text);
  return stats !== undefined && stats.files >= COMMON_LABEL_MIN_FILES && stats.maxPerFile === 1;
}

// ── 판본으로 묶기 ──────────────────────────────────────────────────────────

function addressSortKey(address: string): [number, number] {
  const matched = /^([A-Z]+)(\d+)$/.exec(address);
  if (!matched) return [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER];
  return [Number(matched[2]), columnLettersToNumber(matched[1])];
}

function compareAddresses(a: string, b: string): number {
  const [rowA, columnA] = addressSortKey(a);
  const [rowB, columnB] = addressSortKey(b);
  return rowA - rowB || columnA - columnB;
}

/** 이 파일의 **라벨 → 칸 주소**. 라벨은 파일마다 한 번뿐이라 주소도 하나다. */
function labelAddressesOf(file: ScannedFile, tally: Map<string, TextStats>): Map<string, string> {
  const byLabel = new Map<string, string>();
  for (const [address, text] of file.cardTexts) {
    if (!isLabelText(tally, text)) continue;
    byLabel.set(text, address);
  }
  return byLabel;
}

/**
 * 지시서 그대로의 **엄격 지문** — 시트 차례 + 공통 글자가 놓인 주소 집합이 완전히
 * 같아야 한 판본. 값 칸 하나만 달라도 갈리므로 본 묶음에는 쓰지 않고, 갈린 정도를
 * 머리말에 적기 위해 개수만 센다.
 */
function countStrictFingerprints(files: readonly ScannedFile[], tally: Map<string, TextStats>): number {
  const seen = new Set<string>();
  for (const file of files) {
    const pairs: string[] = [];
    for (const [address, text] of file.cardTexts) {
      if (filesWith(tally, text) < COMMON_LABEL_MIN_FILES) continue;
      pairs.push(`${address}\u0000${text}`);
    }
    pairs.sort();
    seen.add(JSON.stringify([file.sheetNames, pairs]));
  }
  return seen.size;
}

/**
 * 어긋나지 않으면 한 판본. 라벨이 많은 파일부터 보아 **가장 갖춘 파일이 판본을
 * 정의**하게 한다 — 그러면 뒤에 오는 부실한 파일이 판본을 쪼개지 않는다.
 */
function groupVersions(files: readonly ScannedFile[], tally: Map<string, TextStats>): FormVersion[] {
  const withLabels = files
    .map((file) => ({ file, labels: labelAddressesOf(file, tally) }))
    .sort((a, b) => b.labels.size - a.labels.size || a.file.number - b.file.number);

  const versions: FormVersion[] = [];
  for (const { file, labels } of withLabels) {
    const home = versions.find(
      (version) =>
        sameSheetNames(version.sample.sheetNames, file.sheetNames) &&
        agreesOnSharedLabels(version.labelAddress, labels)
    );
    if (home) {
      home.files.push(file);
      // 한쪽에만 있던 라벨을 보탠다 — 판본의 라벨 지도가 그만큼 촘촘해진다.
      for (const [text, address] of labels) if (!home.labelAddress.has(text)) home.labelAddress.set(text, address);
    } else {
      versions.push({ label: "", files: [file], sample: file, labelAddress: new Map(labels) });
    }
  }

  // 파일이 많은 판본이 먼저 — 대표 양식이 V1 이 되어 B절 표를 읽기 좋다.
  versions.sort((a, b) => b.files.length - a.files.length || a.sample.number - b.sample.number);
  for (const version of versions) {
    version.files.sort((a, b) => a.number - b.number);
    version.label = `V${versions.indexOf(version) + 1}`;
  }
  return versions;
}

function sameSheetNames(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((name, index) => name === b[index]);
}

/** 둘 다 가진 라벨의 자리가 모두 같은가. 한쪽에만 있는 라벨은 가르지 않는다. */
function agreesOnSharedLabels(
  known: ReadonlyMap<string, string>,
  candidate: ReadonlyMap<string, string>
): boolean {
  for (const [text, address] of candidate) {
    const placed = known.get(text);
    if (placed !== undefined && placed !== address) return false;
  }
  return true;
}

// ── 보고서 ─────────────────────────────────────────────────────────────────

/** 🔴 결과에 글자를 적는 유일한 통로. 여기를 지나지 않은 글자는 적지 않는다. */
function reveal(text: string, tally: Map<string, TextStats>, minFiles: number): string {
  if (filesWith(tally, text) >= minFiles) return text;
  return `<값·글자${[...text].length}>`;
}

/** 표 칸에 넣을 코드 조각. 글자 안의 `|` 가 칸을 가르지 않게 막는다. */
function codeSpan(text: string): string {
  const safe = text.replace(/\|/g, "\\|");
  return safe.includes("`") ? `\`\` ${safe} \`\`` : `\`${safe}\``;
}

/** 칸 주소가 많으면 줄인다 — 한 글자가 여러 칸에 흩어져 있어도 표가 안 무너진다. */
function formatAddresses(addresses: readonly string[]): string {
  if (addresses.length === 0) return "—";
  if (addresses.length <= MAX_ADDRESSES_PER_CELL) return addresses.join(", ");
  return `${addresses.slice(0, MAX_ADDRESSES_PER_CELL).join(", ")} 외 ${addresses.length - MAX_ADDRESSES_PER_CELL}칸`;
}

/**
 * V1 에 있는 라벨을 V1 의 읽는 차례로 먼저, V1 에 없는 것은 V2 차례로… 이렇게
 * 늘어놓는다. 그러면 표가 대표 양식을 위에서 아래로 읽는 모양이 된다.
 */
function sortTexts(
  texts: Iterable<string>,
  versions: readonly FormVersion[],
  placementsOf: (version: FormVersion, text: string) => string[]
): string[] {
  const keyOf = (label: string): number[] => {
    const key: number[] = [];
    for (const version of versions) {
      const address = placementsOf(version, label)[0];
      if (address === undefined) key.push(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER);
      else key.push(...addressSortKey(address));
    }
    return key;
  };

  const keyed = [...texts].map((label) => ({ label, key: keyOf(label) }));
  keyed.sort((a, b) => {
    for (let index = 0; index < a.key.length; index++) {
      if (a.key[index] !== b.key[index]) return a.key[index] - b.key[index];
    }
    return a.label < b.label ? -1 : a.label > b.label ? 1 : 0;
  });
  return keyed.map((entry) => entry.label);
}

function buildReport(
  files: readonly ScannedFile[],
  versions: readonly FormVersion[],
  cellTally: Map<string, TextStats>,
  sheetNameTally: Map<string, TextStats>,
  minFiles: number,
  strictVersionCount: number
): string {
  const lines: string[] = [];
  const revealCell = (text: string) => reveal(text, cellTally, minFiles);
  const revealSheet = (text: string) => reveal(text, sheetNameTally, minFiles);

  lines.push("# 교산 연락서 판본 조사");
  lines.push("");
  lines.push(`- 훑은 파일: **${files.length}장** (\`*.xlsm\`, 읽기 전용 · 매크로 실행 안 함)`);
  lines.push(`- 판본: **${versions.length}가지** (엄격 집합-일치 지문으로는 ${strictVersionCount}가지)`);
  lines.push(
    `- 🔴 보호 규칙: 서로 다른 파일 **${minFiles}장 이상**에 똑같이 나온 글자만 그대로 적는다. ` +
      `그 미만은 ${codeSpan("<값·글자N>")} 로 가린다(N 은 글자 수).`
  );
  lines.push("- 🔴 숫자 칸은 값을 아예 적지 않는다 — 판본별 **개수만** 센다.");
  lines.push("- 🔴 파일 이름은 적지 않는다 — 번호(#1…)로만 부른다. 번호는 경로 오름차순이다.");
  // 여기에 실제 칸 글자를 보기로 적지 않는다(체크 표시 같은 것도 파일에서 온 글자다).
  // 머리말은 보호 규칙을 설명하는 자리지, 파일 내용을 흘리는 자리가 아니다.
  lines.push(
    `- 라벨로 치는 기준은 파일 **${COMMON_LABEL_MIN_FILES}장 이상**에 나오고 **한 파일 안에서 겹치지 않는** 글자로 고정이다` +
      " — 체크 표시·빈칸 채움처럼 한 장에 수십 군데 흩어지는 글자를 걸러 내지 않으면 같은 양식이 서로 다른 판본으로 갈린다." +
      " `--min-files` 는 **적을지 말지**만 정한다(올려도 판본 개수는 그대로다)."
  );
  lines.push("");

  // ── A ────────────────────────────────────────────────────────────────────
  lines.push("## A. 판본 요약");
  lines.push("");
  if (versions.length === 0) {
    lines.push("읽어 낸 파일이 없습니다.");
  } else {
    lines.push("| 판본 | 파일 수 | 파일 | 대표 | 시트 수 | Card 계열 시트 | 라벨 | 겹친 공통 글자 | 가려진 글자 칸 | 숫자 칸 |");
    lines.push("|---|---:|---|---|---:|---|---:|---:|---:|---:|");
    for (const version of versions) {
      const sample = version.sample;
      const sampleTexts = [...sample.cardTexts.values()];
      const repeated = new Set(
        sampleTexts.filter(
          (text) => filesWith(cellTally, text) >= COMMON_LABEL_MIN_FILES && !isLabelText(cellTally, text)
        )
      ).size;
      const masked = sampleTexts.filter((text) => filesWith(cellTally, text) < COMMON_LABEL_MIN_FILES).length;
      lines.push(
        `| ${version.label} | ${version.files.length} | ${version.files.map((file) => `#${file.number}`).join(" ")} ` +
          `| #${sample.number} | ${sample.sheetNames.length} ` +
          `| ${sample.cardSheetName ? codeSpan(revealSheet(sample.cardSheetName)) : "—"} ` +
          `| ${version.labelAddress.size} | ${repeated} | ${masked} | ${sample.cardNumberCells} |`
      );
    }
    lines.push("");
    lines.push("**시트 차례** (대표 파일 기준, 왼쪽부터 탭 순서)");
    lines.push("");
    for (const version of versions) {
      const names = version.sample.sheetNames.map((name) => codeSpan(revealSheet(name)));
      lines.push(`- ${version.label} — ${names.length > 0 ? names.join(" · ") : "(없음)"}`);
    }
  }
  lines.push("");

  // ── B ────────────────────────────────────────────────────────────────────
  lines.push("## B. 라벨 지도");
  lines.push("");

  /**
   * 한 판본에서 그 글자가 앉은 칸.
   *  · 라벨(한 파일에 한 번)은 판본 안에서 자리가 같다고 확인했으므로 합친 지도를 쓴다.
   *  · 한 파일 안에서 겹치는 글자는 판본 안에서도 파일마다 자리가 다를 수 있어
   *    **대표 파일** 것을 적는다. 그래도 표에서 빼지는 않는다 — `客先(Customer)` 처럼
   *    한 시트에 두 번 적힌 **진짜 라벨**이 있고, 판독기는 그 겹침을 알아야 한다.
   */
  const placementsOf = (version: FormVersion, text: string): string[] => {
    if (isLabelText(cellTally, text)) {
      const address = version.labelAddress.get(text);
      return address === undefined ? [] : [address];
    }
    const addresses: string[] = [];
    for (const [address, value] of version.sample.cardTexts) if (value === text) addresses.push(address);
    return addresses.sort(compareAddresses);
  };

  const allTexts = new Set<string>();
  for (const version of versions) {
    for (const text of version.labelAddress.keys()) allTexts.add(text);
    for (const text of version.sample.cardTexts.values()) {
      if (filesWith(cellTally, text) >= COMMON_LABEL_MIN_FILES) allTexts.add(text);
    }
  }

  if (allTexts.size === 0) {
    lines.push("라벨을 하나도 찾지 못했습니다.");
  } else {
    lines.push(
      `판본별로 그 라벨이 앉은 칸. ${codeSpan("—")} 는 그 판본에 없다는 뜻이고, **이동** 칸의 ` +
        `${codeSpan("≠")} 는 판본마다 자리가 다르다는 뜻이다 — 판독기가 **주소가 아니라 라벨 글자로** 찾아야 하는 근거다.`
    );
    lines.push(
      `라벨 뒤의 ${codeSpan("※")} 는 **한 파일 안에서 여러 자리에 나오는 글자**라는 뜻이다. 판본을 묶는 데는 쓰지 않았고,` +
        " 주소는 대표 파일 기준이라 같은 판본의 다른 파일에서는 다를 수 있다 — 판독기가 라벨만 보고 찾으면 걸리는 자리들이다."
    );
    lines.push("");
    const header = ["라벨", ...versions.map((version) => version.label)];
    if (versions.length > 1) header.push("이동");
    lines.push(`| ${header.join(" | ")} |`);
    lines.push(`|${header.map(() => "---").join("|")}|`);

    for (const text of sortTexts(allTexts, versions, placementsOf)) {
      const placements = versions.map((version) => placementsOf(version, text));
      const marker = isLabelText(cellTally, text) ? "" : " ※";
      const row = [`${codeSpan(revealCell(text))}${marker}`, ...placements.map(formatAddresses)];
      if (versions.length > 1) {
        const present = placements.filter((addresses) => addresses.length > 0);
        const first = present[0]?.join(",");
        row.push(
          present.length < 2 ? "—" : present.every((addresses) => addresses.join(",") === first) ? "=" : "≠"
        );
      }
      lines.push(`| ${row.join(" | ")} |`);
    }
  }
  lines.push("");

  // ── C ────────────────────────────────────────────────────────────────────
  lines.push("## C. 이상 파일");
  lines.push("");
  const troubled = files.filter((file) => file.failure !== null);
  if (troubled.length === 0) {
    lines.push("없음 — 모든 파일을 열었고 Card 계열 시트와 라벨을 찾았습니다.");
  } else {
    lines.push("| 파일 | 사유 |");
    lines.push("|---|---|");
    for (const file of troubled) lines.push(`| #${file.number} | ${file.failure ?? ""} |`);
  }
  lines.push("");

  return lines.join("\n");
}

// ── 실행 ───────────────────────────────────────────────────────────────────

function main(): number {
  const options = parseOptions(process.argv.slice(2));
  if (typeof options === "string") {
    console.error(options);
    console.error(
      '쓰는 법: npx tsx scripts/scan-kyosan-reports.ts --dir="<폴더>" [--out=<저장소 밖 파일>] [--min-files=N]'
    );
    return 1;
  }

  if (options.out && isInsideRepo(options.out)) {
    console.error(
      "--out 이 저장소 안을 가리킵니다. 결과물에 고객 내용이 섞일 수 있으므로 저장소 밖 경로를 쓰세요."
    );
    return 1;
  }

  const rootDir = path.resolve(options.dir);
  try {
    if (!statSync(rootDir).isDirectory()) {
      console.error("--dir 가 폴더가 아닙니다.");
      return 1;
    }
  } catch (error) {
    console.error(`--dir 를 열지 못했습니다: ${errorMessage(error)}`);
    return 1;
  }

  const workbookPaths = findWorkbooks(rootDir);
  if (workbookPaths.length === 0) {
    console.error("폴더에서 .xlsm 파일을 찾지 못했습니다.");
    return 1;
  }

  // 1) 전부 읽는다. 2) 다 읽은 **뒤에** 가린다 — "몇 장에 나왔나" 는 전체를 봐야 안다.
  const files = workbookPaths.map((filePath, index) => scanFile(filePath, index + 1));
  const readable = files.filter((file) => file.cardTexts.size > 0);

  const cellTally = tallyTexts(readable.map((file) => [...file.cardTexts.values()]));
  const sheetNameTally = tallyTexts(files.map((file) => file.sheetNames));

  const versions = groupVersions(readable, cellTally);
  const report = buildReport(
    files,
    versions,
    cellTally,
    sheetNameTally,
    options.minFiles,
    countStrictFingerprints(readable, cellTally)
  );

  if (options.out) {
    writeFileSync(path.resolve(options.out), report, "utf8");
    console.log(`조사 결과를 저장했습니다. 파일 ${files.length}장, 판본 ${versions.length}가지.`);
  } else {
    console.log(report);
  }
  return 0;
}

process.exit(main());
