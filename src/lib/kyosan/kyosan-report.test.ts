import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, test } from "node:test";

import { writeZip, type ZipEntryInput } from "../xlsx/zip-writer";
import { isCardSheetName, readKyosanReport } from "./kyosan-report";

/**
 * ============================================================================
 * 🔴 시험용 연락서는 전부 **손으로 지은 가짜**다 — 실제 연락서를 넣지 않는다
 * ============================================================================
 * 실제 연락서에는 고객명·모델·S/N·고장 내용이 그대로 들어 있다. 고정 시험
 * 파일로 한 장이라도 넣으면 그 고객 정보가 git 에 영영 남는다. 여기서는
 * `zip-writer` 로 최소한의 통합문서를 조립한다 — 라벨(양식의 글자)만 실측에서
 * 가져오고, 값 자리에는 `값-…` 을, 사진 자리에는 손으로 지은 바이트를 넣는다.
 * ============================================================================
 */

const MAIN_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const PKG_REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships";

type FakeSheet = {
  name: string;
  cells?: Record<string, string | number>;
  /** 이 시트에 놓을 그림들 — 값은 zip 안의 파트 이름(`xl/media/…`)이다. */
  images?: string[];
};

function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function sheetXml(cells: Record<string, string | number>, hasDrawing: boolean): string {
  const byRow = new Map<number, { column: string; xml: string }[]>();
  for (const [address, value] of Object.entries(cells)) {
    const matched = /^([A-Z]+)(\d+)$/.exec(address);
    assert.ok(matched, `칸 주소가 아니다: ${address}`);
    const row = Number(matched[2]);
    const xml =
      typeof value === "number"
        ? `<c r="${address}"><v>${value}</v></c>`
        : `<c r="${address}" t="inlineStr"><is><t>${escapeXml(value)}</t></is></c>`;
    byRow.set(row, [...(byRow.get(row) ?? []), { column: matched[1], xml }]);
  }
  const rowsXml = [...byRow.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(
      ([row, entries]) =>
        `<row r="${row}">${entries
          .sort((a, b) => a.column.length - b.column.length || (a.column < b.column ? -1 : 1))
          .map((entry) => entry.xml)
          .join("")}</row>`
    )
    .join("");
  return (
    `<worksheet xmlns="${MAIN_NS}" xmlns:r="${REL_NS}"><sheetData>${rowsXml}</sheetData>` +
    `${hasDrawing ? '<drawing r:id="rIdD1"/>' : ""}</worksheet>`
  );
}

/** 시험용 통합문서를 만든다. `media` 는 파트 이름 → 바이트. */
function workbookOf(sheets: readonly FakeSheet[], media: Record<string, Buffer> = {}): Buffer {
  const entries: ZipEntryInput[] = [];

  const sheetTags = sheets
    .map((sheet, index) => `<sheet name="${escapeXml(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`)
    .join("");
  entries.push({
    name: "xl/workbook.xml",
    data: Buffer.from(
      `<workbook xmlns="${MAIN_NS}" xmlns:r="${REL_NS}"><workbookPr/><sheets>${sheetTags}</sheets></workbook>`,
      "utf8"
    ),
  });
  entries.push({
    name: "xl/_rels/workbook.xml.rels",
    data: Buffer.from(
      `<Relationships xmlns="${PKG_REL_NS}">${sheets
        .map(
          (_sheet, index) =>
            `<Relationship Id="rId${index + 1}" Type="${REL_NS}/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`
        )
        .join("")}</Relationships>`,
      "utf8"
    ),
  });

  sheets.forEach((sheet, index) => {
    const number = index + 1;
    const images = sheet.images ?? [];
    entries.push({
      name: `xl/worksheets/sheet${number}.xml`,
      data: Buffer.from(sheetXml(sheet.cells ?? {}, images.length > 0), "utf8"),
    });
    if (images.length === 0) return;

    entries.push({
      name: `xl/worksheets/_rels/sheet${number}.xml.rels`,
      data: Buffer.from(
        `<Relationships xmlns="${PKG_REL_NS}"><Relationship Id="rIdD1" Type="${REL_NS}/drawing" ` +
          `Target="../drawings/drawing${number}.xml"/></Relationships>`,
        "utf8"
      ),
    });
    entries.push({
      name: `xl/drawings/drawing${number}.xml`,
      data: Buffer.from(
        `<xdr:wsDr xmlns:xdr="x" xmlns:a="y" xmlns:r="${REL_NS}">${images
          .map((_part, imageIndex) => `<xdr:pic><a:blip r:embed="rIdI${imageIndex + 1}"/></xdr:pic>`)
          .join("")}</xdr:wsDr>`,
        "utf8"
      ),
    });
    entries.push({
      name: `xl/drawings/_rels/drawing${number}.xml.rels`,
      data: Buffer.from(
        `<Relationships xmlns="${PKG_REL_NS}">${images
          .map(
            (part, imageIndex) =>
              `<Relationship Id="rIdI${imageIndex + 1}" Type="${REL_NS}/image" ` +
              `Target="../${part.replace(/^xl\//, "")}"/>`
          )
          .join("")}</Relationships>`,
        "utf8"
      ),
    });
  });

  for (const [part, bytes] of Object.entries(media)) entries.push({ name: part, data: bytes });
  return writeZip(entries);
}

/** 매처 양식의 최소 카드 — 실측 라벨, 가짜 값. */
const CARD_CELLS: Record<string, string | number> = {
  A11: "引取No.(Receiving_No.)",
  C11: "값-접수번호",
  A25: "客先(Customer)",
  C25: "값-고객사",
  A34: "型式(MODEL)",
  C34: "값-모델",
  A36: "S/N",
  C36: "값-시리얼",
  A88: "詳細(Details/Comments)",
  B71: "故障①/⑥",
  C71: "값-부품1",
};

/** 수리보고서의 최소 조각 — 원인 보기와 그 **왼쪽**의 ○. */
const REPORT_CELLS: Record<string, string | number> = {
  C30: "原　因",
  J30: "製作不良",
  R30: "部品不良",
  P30: "○",
  C64: "備　考",
};

describe("isCardSheetName — 두 양식 갈래를 가르는 이름", () => {
  test("`Card` 와 반각 가타카나 `ｶｰﾄﾞ` 를 둘 다 알아본다", () => {
    assert.equal(isCardSheetName("Card"), true);
    assert.equal(isCardSheetName("ｶｰﾄﾞ"), true);
    assert.equal(isCardSheetName("カード"), true);
  });

  test("이름이 비슷한 딴 시트는 Card 가 아니다 — 잘못 집으면 모든 항목이 엉뚱해진다", () => {
    assert.equal(isCardSheetName("Card_List"), false);
    assert.equal(isCardSheetName("Repair_Record"), false);
    assert.equal(isCardSheetName("ｶｰﾄﾞ一覧"), false);
  });
});

describe("🔴 두 양식 갈래를 구분한다", () => {
  test("`Card` 는 매처 양식", () => {
    const result = readKyosanReport(
      workbookOf([{ name: "List" }, { name: "Card", cells: CARD_CELLS }, { name: "Repair_Report", cells: REPORT_CELLS }])
    );
    assert.equal(result.ok, true);
    assert.ok(result.ok);
    assert.equal(result.report.formFamily, "card");
    assert.equal(result.report.cardSheetName, "Card");
    assert.equal(result.report.repairReportSheetName, "Repair_Report");
  });

  test("반각 가타카나 `ｶｰﾄﾞ` 는 제너레이터 양식", () => {
    const result = readKyosanReport(
      workbookOf([
        { name: "Repair_Record" },
        { name: "ｶｰﾄﾞ", cells: CARD_CELLS },
        { name: "修理報告書GEx", cells: REPORT_CELLS },
      ])
    );
    assert.equal(result.ok, true);
    assert.ok(result.ok);
    assert.equal(result.report.formFamily, "katakana-card");
    assert.equal(result.report.cardSheetName, "ｶｰﾄﾞ");
    assert.equal(result.report.repairReportSheetName, "修理報告書GEx");
  });
});

describe("판독 결과 — 항목·원인·해시", () => {
  const bytes = workbookOf([
    { name: "Card", cells: CARD_CELLS },
    { name: "Repair_Report", cells: REPORT_CELLS },
  ]);
  const result = readKyosanReport(bytes);
  assert.ok(result.ok);
  const report = result.report;

  test("Card 시트의 머리 정보와 부품 목록을 읽는다", () => {
    assert.equal(report.card.fields.intakeNumber.value, "값-접수번호");
    assert.equal(report.card.fields.customer.value, "값-고객사");
    assert.equal(report.card.fields.model.value, "값-모델");
    assert.equal(report.card.fields.serialNumber.value, "값-시리얼");
    assert.deepEqual(report.card.lists.faultParts.values, ["값-부품1"]);
  });

  test("🔴 없는 항목은 「없음」 — 빈 글자도 가짜 값도 아니다", () => {
    assert.equal(report.card.fields.causeDetail.value, null);
    assert.equal(report.card.fields.causeDetail.labelAddress, "A88");
    assert.equal(report.card.fields.endUser.value, null);
    assert.equal(report.card.fields.endUser.labelAddress, null);
    assert.deepEqual(report.card.lists.preventiveParts.values, []);
  });

  test("🔴 원인 ○ 는 보기의 왼쪽에서 읽는다", () => {
    assert.deepEqual(report.cause.marked, ["部品不良"]);
    assert.deepEqual(report.cause.options, ["製作不良", "部品不良"]);
  });

  test("🔴 원본 파일 해시 — 같은 연락서를 두 번 넣는 것을 막는 열쇠", () => {
    assert.equal(report.sourceSha256, createHash("sha256").update(bytes).digest("hex"));
    assert.match(report.sourceSha256, /^[0-9a-f]{64}$/);
  });
});

/** 판본 C 의 교체부품상세 — 실측 머리글(16행) 배치 그대로, 값만 가짜. */
const PARTS_DETAIL_CELLS: Record<string, string | number> = {
  H1: "故障・修理",
  A15: "交換部品（故障・予防措置）",
  B16: "部品名 / 型式",
  D16: "仕様書番号 / 型式",
  G16: "数量",
  H16: "状況",
  A17: "①",
  B17: "값-상세부품1",
  D17: "값-상세규격1",
  G17: 4,
  H17: "故障・修理",
};

describe("🔴 交換部品詳細 시트도 함께 읽는다", () => {
  test("Card 시트 밖의 교체 부품이 실려 온다 — 수량과 함께", () => {
    const result = readKyosanReport(
      workbookOf([
        { name: "Card", cells: CARD_CELLS },
        { name: "交換部品詳細", cells: PARTS_DETAIL_CELLS },
        { name: "Repair_Report", cells: REPORT_CELLS },
      ])
    );
    assert.ok(result.ok);
    assert.deepEqual(
      result.report.detailParts.map((part) => [part.name, part.quantity, part.sheetName]),
      [["값-상세부품1", 4, "交換部品詳細"]]
    );
    assert.deepEqual(result.report.problems, []);
  });

  test("🔴 (RF)/(DC) 두 장짜리 판본은 두 시트가 이어 붙는다 — 실측 167장", () => {
    const result = readKyosanReport(
      workbookOf([
        { name: "Card", cells: CARD_CELLS },
        { name: "交換部品詳細(RF)", cells: PARTS_DETAIL_CELLS },
        { name: "交換部品詳細(DC)", cells: { ...PARTS_DETAIL_CELLS, B17: "값-상세부품2", G17: 1 } },
      ])
    );
    assert.ok(result.ok);
    assert.deepEqual(
      result.report.detailParts.map((part) => [part.name, part.sheetName]),
      [
        ["값-상세부품1", "交換部品詳細(RF)"],
        ["값-상세부품2", "交換部品詳細(DC)"],
      ]
    );
  });

  test("🔴 그 시트가 없는 장에서 던지지 않고 빈 목록이 된다", () => {
    const result = readKyosanReport(
      workbookOf([{ name: "Card", cells: CARD_CELLS }, { name: "Repair_Report", cells: REPORT_CELLS }])
    );
    assert.ok(result.ok);
    assert.deepEqual(result.report.detailParts, []);
    assert.deepEqual(result.report.problems, []);
  });
});

describe("🔴 같은 그림이 여러 시트에 있으면 한 번만 센다", () => {
  /** 실측: 1KB 짜리 아이콘 하나가 `Card` 30번 · `交換部品詳細` 30번 놓여 있었다. */
  const icon = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);
  const photo = Buffer.from("사진처럼 생긴 바이트", "utf8");

  test("같은 파트를 여러 시트가 나눠 쓰면 그림 하나", () => {
    const result = readKyosanReport(
      workbookOf(
        [
          { name: "Card", cells: CARD_CELLS, images: ["xl/media/image1.png", "xl/media/image1.png"] },
          { name: "交換部品詳細", images: ["xl/media/image1.png"] },
          { name: "Photographs", images: ["xl/media/image2.jpg"] },
        ],
        { "xl/media/image1.png": icon, "xl/media/image2.jpg": photo }
      )
    );
    assert.ok(result.ok);
    const photos = result.report.photos;
    assert.equal(photos.length, 2, "그림은 둘이다 — 놓인 자리는 넷이어도");

    const iconEntry = photos.find((entry) => entry.bytes === icon.length);
    assert.ok(iconEntry);
    assert.equal(iconEntry.placements, 3);
    assert.deepEqual(iconEntry.sheets, ["Card", "交換部品詳細"]);
    assert.deepEqual(iconEntry.parts, ["xl/media/image1.png"]);
    assert.equal(iconEntry.sha256, createHash("sha256").update(icon).digest("hex"));
  });

  test("🔴 파트 이름이 달라도 **내용**이 같으면 그림 하나 — 이름은 증거가 못 된다", () => {
    const result = readKyosanReport(
      workbookOf(
        [
          { name: "Card", cells: CARD_CELLS, images: ["xl/media/image1.png"] },
          { name: "Photographs", images: ["xl/media/image9.png"] },
        ],
        { "xl/media/image1.png": icon, "xl/media/image9.png": Buffer.from(icon) }
      )
    );
    assert.ok(result.ok);
    assert.equal(result.report.photos.length, 1);
    assert.deepEqual(result.report.photos[0].parts, ["xl/media/image1.png", "xl/media/image9.png"]);
    assert.equal(result.report.photos[0].placements, 2);
  });

  test("그림이 하나도 없으면 빈 배열", () => {
    const result = readKyosanReport(workbookOf([{ name: "Card", cells: CARD_CELLS }]));
    assert.ok(result.ok);
    assert.deepEqual(result.report.photos, []);
    assert.deepEqual(result.report.problems, []);
  });
});

describe("열지 못하는 파일은 던지지 않고 사유를 돌려준다", () => {
  test("🔴 엑셀 잠금 파일은 zip 이 아니다 — 469장을 돌릴 때 여기서 멈추면 안 된다", () => {
    const result = readKyosanReport(Buffer.alloc(165, 0x20));
    assert.equal(result.ok, false);
    assert.ok(!result.ok);
    assert.equal(result.reason, "not-a-workbook");
  });

  test("Card 계열 시트가 없으면 `no-card-sheet`", () => {
    const result = readKyosanReport(workbookOf([{ name: "일반 수리 부품 출하증" }, { name: "DATA" }]));
    assert.equal(result.ok, false);
    assert.ok(!result.ok);
    assert.equal(result.reason, "no-card-sheet");
  });
});
