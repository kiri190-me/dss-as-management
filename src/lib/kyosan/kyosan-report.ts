import { createHash } from "node:crypto";

import { readSheetGrid } from "../xlsx/sheet-grid";
import { WORKBOOK_PART } from "../xlsx/workbook-parts";
import { decodeXmlCharacterData } from "../xlsx/xml-entities";
import { ZipArchive } from "../xlsx/zip-reader";
import { readCardFields, type CardFields } from "./card-fields";
import { normalizeKey } from "./card-grid";
import {
  pickPartsDetailSheetNames,
  readPartsDetailSheet,
  type KyosanDetailPart,
} from "./parts-detail-sheet";
import { pickRepairReportSheetName, readMarkGroup, type MarkGroup } from "./report-marks";
import { collectPhotos, type KyosanPhoto } from "./report-photos";

/**
 * ============================================================================
 * 교산 연락서 판독기 — 엑셀 한 장 → 수리 건에 들어갈 내용 (2026-09-21, 조각 S1)
 * ============================================================================
 * 교산에서 수리를 맡길 때 함께 주는 연락서(`.xlsm`/`.xlsx`)를 읽어, 지금 사람이
 * 손으로 옮겨 적는 것을 구조로 돌려준다. **이번 조각은 읽는 것까지다** — DB 에
 * 넣지 않고 화면도 만들지 않는다.
 *
 * ── 🔴 `server-only` 를 부르지 않는다 ─────────────────────────────────
 * 이 파일과 이웃 파일들은 `server-only` 를 **절대** import 하지 않는다. 그래야
 * `scripts/extract-kyosan-reports.ts` 가 CLI 로 469장에 돌려 볼 수 있다. 읽기
 * 전용 순수 함수이므로 서버 경계를 따질 이유도 없다. 뒷 조각에서 서버 코드가
 * 이것을 부르는 것은 괜찮다 — 반대 방향만 막으면 된다.
 *
 * ── 두 양식 갈래 ───────────────────────────────────────────────────────
 * 실측 326장이 두 갈래다. 가르는 것은 **카드 시트의 이름**이다:
 *  · `Card`   — 매처(정합기) 양식. 시트 12~15장.
 *  · `ｶｰﾄﾞ`   — 제너레이터 양식. 반각 가타카나. 시트 23~28장, `Photographs` 없음.
 * 이름을 글자 그대로 견주면 한 갈래를 통째로 놓친다. NFKC 로 눌러 반각 가타카나를
 * 전각으로 옮기고, 가타카나를 히라가나로 내려 `card` / `かーど` 로 만들어 견준다
 * (scripts/scan-kyosan-reports.ts 가 판본 지도를 만들 때 쓴 것과 같은 규칙이다).
 *
 * ── 어느 시트를 믿는가 ─────────────────────────────────────────────────
 * 🔴 `Repair_Record` 시트는 읽지 않는다. 그 시트는 Card 를 **한 줄 어긋나게**
 * 참조한다(Card 의 라벨 줄을 값 줄로 본다). 거기서 읽으면 모든 항목이 한 칸씩
 * 밀린 채 그럴듯하게 채워진다 — 비어 있는 것보다 나쁜 결과다.
 * 읽는 곳은 **Card 계열 시트**와, ○ 표시를 읽는 **수리보고서 시트**와,
 * 교체 부품을 읽는 **`交換部品詳細` 계열 시트**다(2026-09-22 로 하나 늘었다 —
 * Card 시트의 `５．処置` 머리글이 「나머지는 그 시트에 적으라」고 지시하고 있고,
 * 그것을 읽지 않아 교체 부품이 절반 이상 빠지고 있었다. `parts-detail-sheet.ts`).
 *
 * ── 원본 파일 해시 ─────────────────────────────────────────────────────
 * 🔴 `sourceSha256` 은 나중에 **같은 연락서를 두 번 넣는 것**을 막는 데 쓴다.
 * `service_reports` 에 유니크 제약이 하나도 없어, 두 번 넣으면 아무 소리 없이
 * 두 장이 쌓인다. S3(저장)이 이 값을 열쇠로 쓸 수 있도록 지금부터 함께 돌려준다.
 *
 * ── 🔴 고객 정보 ───────────────────────────────────────────────────────
 * 돌려주는 값에는 고객명·모델·S/N·고장 내용이 **그대로** 들어 있다. 이 모듈을
 * 부르는 쪽은 결과를 저장소 안 파일이나 바깥 서비스로 내보내지 않는다.
 * ============================================================================
 */

export type KyosanFormFamily = "card" | "katakana-card";

export type KyosanReport = {
  formFamily: KyosanFormFamily;
  cardSheetName: string;
  /** ○ 표시를 읽은 시트. 못 찾았으면 null 이고 `cause`·`action` 은 빈 값이다. */
  repairReportSheetName: string | null;
  sheetNames: readonly string[];
  /** 🔴 원본 파일 바이트의 SHA-256. 중복 등록을 막는 열쇠(위 머리말). */
  sourceSha256: string;
  card: CardFields;
  /** 수리보고서 시트의 `原　因` 보기들과 ○ 가 찍힌 것. */
  cause: MarkGroup;
  /** 수리보고서 시트의 `処　置` 보기들과 ○ 가 찍힌 것. */
  action: MarkGroup;
  /**
   * `交換部品詳細` 계열 시트의 교체 부품 줄들. 시트가 없으면 빈 배열이다
   * (`parts-detail-sheet.ts`). (RF)/(DC) 두 장짜리 판본은 두 시트가 이어 붙는다.
   */
  detailParts: readonly KyosanDetailPart[];
  photos: readonly KyosanPhoto[];
  /** 읽다가 만난 문제들. 고객 내용은 담지 않는다. */
  problems: readonly string[];
};

export type KyosanReadFailure = "not-a-workbook" | "no-card-sheet" | "unreadable-card-sheet";

export type KyosanReadResult =
  | { ok: true; report: KyosanReport }
  | { ok: false; reason: KyosanReadFailure; detail: string };

/**
 * Card 계열 시트 이름인가. 세 단계로 눌러 맞춘다 —
 *  1. NFKC: 반각 `ｶｰﾄﾞ` → 전각 `カード`(탁점도 합쳐진다)
 *  2. 공백 제거·소문자: ` CARD ` → `card`
 *  3. 가타카나 → 히라가나: `カード` → `かーど`
 *
 * 일부러 앞머리 일치를 쓰지 않는다 — `Card_List` 같은 딴 시트를 Card 로 잘못
 * 집으면 모든 항목이 엉뚱한 곳에서 온다. 놓치는 쪽이 낫다(「Card 시트 없음」으로
 * 드러나 사람이 규칙을 고칠 수 있다).
 */
export function isCardSheetName(sheetName: string): boolean {
  return cardSheetShape(sheetName) !== null;
}

function cardSheetShape(sheetName: string): KyosanFormFamily | null {
  const compact = normalizeKey(sheetName);
  if (compact === "card") return "card";
  // `ー`(U+30FC) 는 이 범위 밖이라 그대로 남는다 — 히라가나 표기에서도 같은 글자다.
  const hiragana = compact.replace(/[ァ-ヶ]/g, (character) =>
    String.fromCodePoint((character.codePointAt(0) ?? 0) - 0x60)
  );
  return hiragana === "かーど" ? "katakana-card" : null;
}

/** 통합문서의 시트 이름들, `workbook.xml` 에 적힌 차례 그대로. */
export function readSheetNames(archive: ZipArchive): string[] {
  const workbookXml = archive.readText(WORKBOOK_PART);
  const sheetsBlock = /<sheets\b[^>]*>([\s\S]*?)<\/sheets>/.exec(workbookXml);
  if (!sheetsBlock) return [];

  const names: string[] = [];
  // `<sheet\b` 는 `<sheets>` 를 잡지 않는다(`t`↔`s` 사이에 낱말 경계가 없다).
  for (const tag of sheetsBlock[1].matchAll(/<sheet\b[^>]*?\/?>/g)) {
    const name = /\bname="([^"]*)"/.exec(tag[0])?.[1];
    if (name !== undefined) names.push(decodeXmlCharacterData(name));
  }
  return names;
}

/**
 * 연락서 한 장을 읽는다. 열지 못하면 던지지 않고 `ok: false` 를 돌려준다 —
 * 469장을 한 번에 돌리는 쪽이 한 장 때문에 멈추면 안 되고, 엑셀 잠금 파일
 * (`~$…`, 165바이트, zip 이 아니다)이 실제로 섞여 있다.
 */
export function readKyosanReport(fileBytes: Buffer): KyosanReadResult {
  const sourceSha256 = createHash("sha256").update(fileBytes).digest("hex");

  let archive: ZipArchive;
  let sheetNames: string[];
  try {
    archive = ZipArchive.fromBuffer(fileBytes);
    sheetNames = readSheetNames(archive);
  } catch (error) {
    return { ok: false, reason: "not-a-workbook", detail: errorMessage(error) };
  }

  const cardSheetName = sheetNames.find(isCardSheetName);
  if (cardSheetName === undefined) {
    return { ok: false, reason: "no-card-sheet", detail: `시트 ${sheetNames.length}장` };
  }
  const formFamily = cardSheetShape(cardSheetName) ?? "card";

  let cardGrid: ReturnType<typeof readSheetGrid>;
  try {
    cardGrid = readSheetGrid(archive, cardSheetName);
  } catch (error) {
    return { ok: false, reason: "unreadable-card-sheet", detail: errorMessage(error) };
  }
  if (!cardGrid) {
    return { ok: false, reason: "unreadable-card-sheet", detail: "시트 파트를 찾지 못했다" };
  }

  const problems: string[] = [];
  const card = readCardFields(cardGrid, cardGrid.date1904);

  const repairReportSheetName = pickRepairReportSheetName(sheetNames);
  let cause: MarkGroup = { sectionAddress: null, options: [], marked: [] };
  let action: MarkGroup = { sectionAddress: null, options: [], marked: [] };
  if (repairReportSheetName !== null) {
    try {
      const reportGrid = readSheetGrid(archive, repairReportSheetName);
      if (reportGrid) {
        cause = readMarkGroup(reportGrid, "原因");
        action = readMarkGroup(reportGrid, "処置");
      } else {
        problems.push("수리보고서 시트 파트를 찾지 못했다");
      }
    } catch (error) {
      problems.push(`수리보고서 시트를 읽지 못했다 — ${errorMessage(error)}`);
    }
  }

  // 🔴 이 시트가 없는 장에서 던지지 않는다 — 실측 469장에는 전부 있지만, 없는
  //    판본이 나오더라도 「교체 부품 없음」으로 지나가야 이식이 멈추지 않는다.
  const detailParts: KyosanDetailPart[] = [];
  for (const detailSheetName of pickPartsDetailSheetNames(sheetNames)) {
    try {
      const detailGrid = readSheetGrid(archive, detailSheetName);
      if (detailGrid) {
        detailParts.push(...readPartsDetailSheet(detailGrid, detailSheetName));
      } else {
        problems.push("교체부품상세 시트 파트를 찾지 못했다");
      }
    } catch (error) {
      problems.push(`교체부품상세 시트를 읽지 못했다 — ${errorMessage(error)}`);
    }
  }

  const photoScan = collectPhotos(archive, sheetNames);
  problems.push(...photoScan.problems);

  return {
    ok: true,
    report: {
      formFamily,
      cardSheetName,
      repairReportSheetName,
      sheetNames,
      sourceSha256,
      card,
      cause,
      action,
      detailParts,
      photos: photoScan.photos,
      problems,
    },
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
