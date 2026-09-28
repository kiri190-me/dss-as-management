import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

import {
  KYOSAN_PHOTO_ATTACHMENT_DESCRIPTION,
  KYOSAN_SOURCE_ATTACHMENT_DESCRIPTION,
  countQuarantineFiles,
  countQuarantinePreviewFiles,
  decideTraceRevert,
  kyosanPhotoNamePrefix,
  legacyUsedPartLinesFromAudit,
  matchLegacyUsedPartRows,
  readKyosanTraceMetadata,
  selectLegacyKyosanAttachments,
  type AttachmentRowSnapshot,
  type TraceRevertInput,
  type UsedPartRowSnapshot,
} from "./kyosan-import-revert-plan";

/**
 * ============================================================================
 * 연락서 이식 되돌리기 — **고르는 규칙**을 값으로 못 박는다 (조각 S5-B)
 * ============================================================================
 * DB 없이 돈다. 이 시험이 지키는 것은 「잘 지우는가」가 아니라 **「지우면 안 될
 * 것을 안 지우는가」**다. 실제로 개발 DB 에서 걸린 것이 있다:
 *
 *  · `category = 'KYOSAN_DOCUMENT'` 인 첨부에 **사람이 올린 1건**이 섞여 있다
 *    (`description` 이 NULL). 분류만 보고 고르면 그 파일이 함께 사라진다.
 *  · 옛 흔적에는 넣은 줄의 id 가 없다 — 감사 스냅숏과 값으로 맞춰야 하고,
 *    하나라도 못 맞추면 **한 줄도 지우지 않아야** 한다.
 *
 * 🔴 여기 나오는 해시 · UUID 는 전부 **손으로 지은 가짜**다. 품명도 대개 가짜인데,
 * 「번역 대조」 묶음의 여섯 쌍만은 **개발 DB 실측값**이다 — 2026-09-23 백필이
 * 실제로 바꾼 글자여야 「그 백필을 되짚는가」를 잴 수 있다. 그 여섯은 고객
 * 내용이 아니라 교산 부품 카탈로그의 낱말이다.
 * ============================================================================
 */

const SHA = "1f84fed184fbaaaabbbbccccddddeeeeffff00001111222233334444555566667";
const OTHER_SHA = "c851fda7a5669999888877776666555544443333222211110000aaaabbbbcccc";
const CASE_ID = "11111111-1111-4111-8111-111111111111";
const TRACE_ID = "22222222-2222-4222-8222-222222222222";

function attachmentRow(overrides: Partial<AttachmentRowSnapshot> & { id: string }): AttachmentRowSnapshot {
  return {
    category: "KYOSAN_DOCUMENT",
    description: KYOSAN_SOURCE_ATTACHMENT_DESCRIPTION,
    originalFileName: "연락서.xlsm",
    checksumSha256: SHA,
    storedPath: `repair-cases/${CASE_ID}/${overrides.id}.xlsm`,
    previewPath: null,
    isDeleted: false,
    ...overrides,
  };
}

function photoRow(id: string, index: number, sha = SHA): AttachmentRowSnapshot {
  return attachmentRow({
    id,
    description: KYOSAN_PHOTO_ATTACHMENT_DESCRIPTION,
    originalFileName: `${kyosanPhotoNamePrefix(sha)}${index}.png`,
    checksumSha256: `photo-${index}`,
    storedPath: `repair-cases/${CASE_ID}/${id}.png`,
  });
}

function usedPartRow(id: string, lineNo: number, partNameText: string, quantity: number): UsedPartRowSnapshot {
  return { id, lineNo, partNameText, quantity };
}

function baseInput(overrides: Partial<TraceRevertInput> = {}): TraceRevertInput {
  return {
    traceId: TRACE_ID,
    repairCaseId: CASE_ID,
    intakeNumber: "D210101",
    metadata: {
      source: "KYOSAN_REPORT",
      sourceSha256: SHA,
      workRecordIds: [],
      reportedSymptomFilled: false,
      usedPartCount: 0,
      attachmentCount: 1,
      photoCount: 0,
    },
    foundWorkRecordIds: [],
    usedPartRows: [],
    attachmentRows: [attachmentRow({ id: "aaaa1111-0000-4000-8000-000000000001" })],
    legacyUsedPartLines: null,
    symptomAudit: null,
    currentReportedSymptom: null,
    ...overrides,
  };
}

function expectRevert(input: TraceRevertInput) {
  const decision = decideTraceRevert(input);
  assert.equal(decision.kind, "revert", `건너뛰었다: ${JSON.stringify(decision)}`);
  assert.ok(decision.kind === "revert");
  return decision;
}

function expectSkip(input: TraceRevertInput) {
  const decision = decideTraceRevert(input);
  assert.equal(decision.kind, "skip", `되돌리기로 판정했다: ${JSON.stringify(decision)}`);
  assert.ok(decision.kind === "skip");
  assert.ok(decision.reasons.length > 0, "건너뛰면서 사유를 안 적었다");
  return decision;
}

// ══════════════════════════════════════════════ 상수가 이식기와 갈라지지 않았는가

describe("🔴 이식기와 같은 글자를 쓴다", () => {
  /**
   * 🔴 `SOURCE_DESCRIPTION` · `PHOTO_DESCRIPTION` 은 이식기 모듈 안에만 있는 상수라
   * 불러올 수 없다(그 파일은 이번 조각에서 고치지 않는다). 그래서 **글자를 읽어**
   * 맞춰 본다 — 한쪽만 바뀌면 여기서 깨진다. 안 깨지면 되돌리기가 조용히
   * 아무것도 못 고르게 된다.
   */
  test("첨부 설명 두 낱말이 kyosan-report-import.ts 의 글자와 같다", () => {
    const source = readFileSync(
      path.join(process.cwd(), "src/lib/server/services/kyosan-report-import.ts"),
      "utf8"
    );
    assert.ok(
      source.includes(`const SOURCE_DESCRIPTION = "${KYOSAN_SOURCE_ATTACHMENT_DESCRIPTION}";`),
      "이식기의 SOURCE_DESCRIPTION 이 바뀌었다 — 되돌리기가 원본 첨부를 못 고른다"
    );
    assert.ok(
      source.includes(`const PHOTO_DESCRIPTION = "${KYOSAN_PHOTO_ATTACHMENT_DESCRIPTION}";`),
      "이식기의 PHOTO_DESCRIPTION 이 바뀌었다 — 되돌리기가 사진 첨부를 못 고른다"
    );
  });

  test("사진 이름 앞머리가 이식기가 짓는 모양과 같다", () => {
    const source = readFileSync(
      path.join(process.cwd(), "src/lib/server/services/kyosan-report-import.ts"),
      "utf8"
    );
    assert.ok(
      source.includes("`연락서-${input.report.sourceSha256.slice(0, 8)}-사진${index}.${extension}`"),
      "이식기가 사진 이름을 짓는 모양이 바뀌었다 — 옛 흔적의 사진을 못 고른다"
    );
    assert.equal(kyosanPhotoNamePrefix(SHA), "연락서-1f84fed1-사진");
  });
});

// ══════════════════════════════════════════════ 🔴 디스크 파일을 몇 개 옮기는가

describe("🔴 계획이 적는 디스크 파일 수가 실제로 옮길 수와 같다 (S5-C ②)", () => {
  /**
   * ⚠️ 2026-09-28 실측에서 어긋났다 — 계획은 「19개」라 적었는데 실제로 옮겨진
   * 것은 **37개**였다. 까닭은 **미리보기(썸네일)** 다: `attachments.preview_path`
   * 가 있는 행은 실물이 둘인데 계획이 **첨부 행 수**를 세고 있었다.
   * 계획 출력은 사람이 그 수를 보고 승인하는 자리라, 수가 다르면 판단이 흐려진다.
   */
  const target = (id: string, previewPath: string | null) => ({
    attachmentId: id,
    storedPath: `repair-cases/${CASE_ID}/${id}.png`,
    previewPath,
  });

  test("미리보기가 없으면 첨부 행 수와 같다", () => {
    const files = [target("a", null), target("b", null)];
    assert.equal(countQuarantineFiles(files), 2);
    assert.equal(countQuarantinePreviewFiles(files), 0);
  });

  test("🔴 미리보기가 있는 행은 파일이 둘이다", () => {
    const files = [
      target("a", null),
      target("b", `repair-cases/${CASE_ID}/b-preview.png`),
      target("c", `repair-cases/${CASE_ID}/c-preview.png`),
    ];
    assert.equal(files.length, 3, "첨부 행은 셋");
    assert.equal(countQuarantineFiles(files), 5, "🔴 실물은 다섯(원본 3 + 미리보기 2)");
    assert.equal(countQuarantinePreviewFiles(files), 2);
  });

  test("2026-09-28 실측의 수 — 첨부 84행 + 미리보기 20개 = 실물 104개", () => {
    const files = Array.from({ length: 84 }, (_unused, index) =>
      target(`a${index}`, index < 20 ? `repair-cases/${CASE_ID}/a${index}-preview.png` : null)
    );
    assert.equal(countQuarantineFiles(files), 104);
  });

  test("빈 목록은 0", () => {
    assert.equal(countQuarantineFiles([]), 0);
    assert.equal(countQuarantinePreviewFiles([]), 0);
  });

  test("🔴 판정이 내놓은 `files` 를 그대로 세면 옮길 파일 수가 나온다", () => {
    const decision = expectRevert(
      baseInput({
        metadata: {
          source: "KYOSAN_REPORT",
          sourceSha256: SHA,
          workRecordIds: [],
          reportedSymptomFilled: false,
          usedPartCount: 0,
          attachmentCount: 2,
          attachmentIds: ["aaaa1111-0000-4000-8000-000000000001", "dddd4444-0000-4000-8000-000000000004"],
          photoCount: 1,
        },
        attachmentRows: [
          attachmentRow({ id: "aaaa1111-0000-4000-8000-000000000001" }),
          {
            ...photoRow("dddd4444-0000-4000-8000-000000000004", 1),
            previewPath: `repair-cases/${CASE_ID}/dddd4444-preview.png`,
          },
        ],
      })
    );
    assert.equal(decision.files.length, 2, "첨부 행은 둘");
    assert.equal(countQuarantineFiles(decision.files), 3, "🔴 실물은 셋 — 사진에 미리보기가 있다");
  });
});

// ══════════════════════════════════════════════ 주인 없는 흔적

describe("🔴 주인 없는 흔적은 대상에서 뺀다", () => {
  test("repairCaseId 가 null 이면 건너뛴다", () => {
    const decision = expectSkip(baseInput({ repairCaseId: null }));
    assert.ok(decision.reasons.some((reason) => reason.includes("주인 없는 흔적")), decision.reasons.join(" / "));
  });

  test("연락서 이식 흔적이 아니면 건너뛴다", () => {
    const decision = expectSkip(baseInput({ metadata: { source: "KYOSAN_INTAKE_LIST" } }));
    assert.ok(decision.reasons.some((reason) => reason.includes("KYOSAN_REPORT")));
  });
});

// ══════════════════════════════════════════════ 🔴 사람이 올린 첨부

describe("🔴 사람이 올린 「설명 없음」 첨부는 절대 안 걸린다", () => {
  test("같은 분류 · 같은 건에 있어도 고르지 않는다 (옛 흔적)", () => {
    const human = attachmentRow({
      id: "557a5216-19a5-44bd-9658-6b1dc666604e",
      description: null,
      originalFileName: "촬영-1787561581563-1.jpg",
      checksumSha256: SHA, // 🔴 해시까지 같아도 설명이 없으면 안 걸려야 한다.
      storedPath: `repair-cases/${CASE_ID}/557a5216-19a5-44bd-9658-6b1dc666604e.jpg`,
    });
    const mine = attachmentRow({ id: "aaaa1111-0000-4000-8000-000000000001" });

    const selected = selectLegacyKyosanAttachments([human, mine], SHA);
    assert.deepEqual(selected.sourceRows.map((row) => row.id), [mine.id]);
    assert.deepEqual(selected.photoRows, []);

    const decision = expectRevert(baseInput({ attachmentRows: [human, mine] }));
    assert.deepEqual(decision.attachmentIds, [mine.id]);
    assert.equal(
      decision.attachmentIds.includes(human.id),
      false,
      "🔴 사람이 올린 파일이 되돌리기 대상에 들어갔다"
    );
  });

  test("설명이 「교산 연락서 원본」이어도 체크섬이 다르면 안 걸린다", () => {
    const other = attachmentRow({ id: "bbbb2222-0000-4000-8000-000000000002", checksumSha256: OTHER_SHA });
    const mine = attachmentRow({ id: "aaaa1111-0000-4000-8000-000000000001" });
    const selected = selectLegacyKyosanAttachments([other, mine], SHA);
    assert.deepEqual(selected.sourceRows.map((row) => row.id), [mine.id]);
  });

  test("사진 설명이어도 이름이 다른 연락서의 것이면 안 걸린다", () => {
    const foreign = photoRow("cccc3333-0000-4000-8000-000000000003", 1, OTHER_SHA);
    const mine = photoRow("dddd4444-0000-4000-8000-000000000004", 1, SHA);
    const selected = selectLegacyKyosanAttachments([foreign, mine], SHA);
    assert.deepEqual(selected.photoRows.map((row) => row.id), [mine.id]);
  });

  test("분류가 KYOSAN_DOCUMENT 가 아니면 설명이 같아도 안 걸린다", () => {
    const wrongCategory = attachmentRow({
      id: "eeee5555-0000-4000-8000-000000000005",
      category: "REPAIR_PHOTO",
    });
    const selected = selectLegacyKyosanAttachments([wrongCategory], SHA);
    assert.deepEqual(selected.sourceRows, []);
  });
});

// ══════════════════════════════════════════════ 🔴 개수가 어긋나면 건너뛴다

describe("🔴 개수가 어긋나면 그 흔적을 통째로 건너뛴다", () => {
  test("옛 흔적 — 사진 수가 흔적과 다르면 건너뛴다", () => {
    const decision = expectSkip(
      baseInput({
        metadata: {
          source: "KYOSAN_REPORT",
          sourceSha256: SHA,
          workRecordIds: [],
          reportedSymptomFilled: false,
          usedPartCount: 0,
          attachmentCount: 3,
          photoCount: 2,
        },
        attachmentRows: [
          attachmentRow({ id: "aaaa1111-0000-4000-8000-000000000001" }),
          photoRow("dddd4444-0000-4000-8000-000000000004", 1),
        ],
      })
    );
    assert.ok(decision.reasons.some((reason) => reason.includes("사진 첨부를 2장")), decision.reasons.join(" / "));
  });

  test("옛 흔적 — 원본이 1장이 아니면 건너뛴다", () => {
    const decision = expectSkip(baseInput({ attachmentRows: [] }));
    assert.ok(decision.reasons.some((reason) => reason.includes("원본 첨부를 1장")));
  });

  test("옛 흔적 — attachmentCount 가 원본 1 + photoCount 와 다르면 건너뛴다", () => {
    const decision = expectSkip(
      baseInput({
        metadata: {
          source: "KYOSAN_REPORT",
          sourceSha256: SHA,
          workRecordIds: [],
          reportedSymptomFilled: false,
          usedPartCount: 0,
          attachmentCount: 9,
          photoCount: 1,
        },
        attachmentRows: [
          attachmentRow({ id: "aaaa1111-0000-4000-8000-000000000001" }),
          photoRow("dddd4444-0000-4000-8000-000000000004", 1),
        ],
      })
    );
    assert.ok(decision.reasons.some((reason) => reason.includes("attachmentCount 9")), decision.reasons.join(" / "));
  });

  test("새 흔적 — usedPartIds 개수와 usedPartCount 가 다르면 건너뛴다", () => {
    const decision = expectSkip(
      baseInput({
        metadata: {
          source: "KYOSAN_REPORT",
          sourceSha256: SHA,
          workRecordIds: [],
          reportedSymptomFilled: false,
          usedPartCount: 2,
          usedPartIds: ["ffff6666-0000-4000-8000-000000000006"],
          attachmentCount: 1,
          attachmentIds: ["aaaa1111-0000-4000-8000-000000000001"],
          photoCount: 0,
        },
        usedPartRows: [usedPartRow("ffff6666-0000-4000-8000-000000000006", 1, "통신 기판", 1)],
      })
    );
    assert.ok(decision.reasons.some((reason) => reason.includes("usedPartCount 2")), decision.reasons.join(" / "));
  });

  test("새 흔적 — 흔적이 말한 사용 부품 줄이 사라졌으면 건너뛴다", () => {
    const decision = expectSkip(
      baseInput({
        metadata: {
          source: "KYOSAN_REPORT",
          sourceSha256: SHA,
          workRecordIds: [],
          reportedSymptomFilled: false,
          usedPartCount: 1,
          usedPartIds: ["ffff6666-0000-4000-8000-000000000006"],
          attachmentCount: 1,
          attachmentIds: ["aaaa1111-0000-4000-8000-000000000001"],
          photoCount: 0,
        },
        usedPartRows: [],
      })
    );
    assert.ok(decision.reasons.some((reason) => reason.includes("1줄을 찾아야")), decision.reasons.join(" / "));
  });
});

// ══════════════════════════════════════════════ 🔴 옛 흔적의 사용 부품 대조

describe("🔴 옛 흔적의 사용 부품은 (line_no · 품명 · 수량)이 맞는 줄만", () => {
  const mineA = usedPartRow("1111aaaa-0000-4000-8000-00000000000a", 1, "통신 기판", 1);
  const mineB = usedPartRow("2222bbbb-0000-4000-8000-00000000000b", 2, "스플리터 기판", 3);
  const human = usedPartRow("3333cccc-0000-4000-8000-00000000000c", 3, "사람이 적은 부품", 5);

  test("맞는 줄만 고르고 사람이 적은 줄은 남긴다", () => {
    const match = matchLegacyUsedPartRows(
      [
        { lineNo: 1, partNameText: "통신 기판", quantity: 1 },
        { lineNo: 2, partNameText: "스플리터 기판", quantity: 3 },
      ],
      [mineA, mineB, human]
    );
    assert.deepEqual(match.unmatched, []);
    assert.deepEqual(match.matched.map((item) => item.row.id), [mineA.id, mineB.id]);
  });

  test("수량 하나만 달라도 못 맞춘 것으로 센다", () => {
    const match = matchLegacyUsedPartRows([{ lineNo: 1, partNameText: "통신 기판", quantity: 9 }], [mineA]);
    assert.deepEqual(match.matched, []);
    assert.equal(match.unmatched.length, 1);
  });

  test("line_no 가 다르면 못 맞춘 것으로 센다 — 같은 품명·같은 수량이어도", () => {
    const match = matchLegacyUsedPartRows([{ lineNo: 7, partNameText: "통신 기판", quantity: 1 }], [mineA]);
    assert.deepEqual(match.matched, []);
    assert.equal(match.unmatched.length, 1);
    assert.equal(match.unmatched[0].rowAtSameLineNo, null, "7번 자리에는 줄이 없다");
  });

  test("사전이 모르는 일본어는 원문으로 견주고, 그래도 다르면 못 맞춘다", () => {
    const match = matchLegacyUsedPartRows([{ lineNo: 1, partNameText: "謎の部品名前", quantity: 1 }], [mineA]);
    assert.deepEqual(match.matched, []);
    assert.equal(match.unmatched.length, 1);
    assert.equal(match.unmatched[0].rowAtSameLineNo?.partNameText, "통신 기판");
  });

  test("🔴 이름이 다른 두 줄이 같은 line_no·수량이어도 아무거나 맞다고 하지 않는다", () => {
    const one = usedPartRow("4444dddd-0000-4000-8000-00000000000d", 1, "엉뚱한 부품 가", 1);
    const two = usedPartRow("5555eeee-0000-4000-8000-00000000000e", 1, "엉뚱한 부품 나", 1);
    const match = matchLegacyUsedPartRows([{ lineNo: 1, partNameText: "通信基板", quantity: 1 }], [one, two]);
    assert.deepEqual(match.matched, [], "🔴 자리와 수량만 같은 남의 줄을 집었다");
    assert.equal(match.unmatched.length, 1);
  });

  test("🔴 하나라도 못 맞추면 그 흔적은 한 줄도 지우지 않는다", () => {
    const decision = expectSkip(
      baseInput({
        metadata: {
          source: "KYOSAN_REPORT",
          sourceSha256: SHA,
          workRecordIds: [],
          reportedSymptomFilled: false,
          usedPartCount: 2,
          attachmentCount: 1,
          photoCount: 0,
        },
        usedPartRows: [mineA, human],
        legacyUsedPartLines: [
          { lineNo: 1, partNameText: "통신 기판", quantity: 1 },
          { lineNo: 2, partNameText: "스플리터 기판", quantity: 3 },
        ],
      })
    );
    assert.ok(decision.reasons.some((reason) => reason.includes("못 맞췄습니다")), decision.reasons.join(" / "));
  });

  test("맞으면 그 줄의 id 만 대상이 된다 — 사람이 적은 줄은 대상 밖이다", () => {
    const decision = expectRevert(
      baseInput({
        metadata: {
          source: "KYOSAN_REPORT",
          sourceSha256: SHA,
          workRecordIds: [],
          reportedSymptomFilled: false,
          usedPartCount: 2,
          attachmentCount: 1,
          photoCount: 0,
        },
        usedPartRows: [mineA, mineB, human],
        legacyUsedPartLines: [
          { lineNo: 1, partNameText: "통신 기판", quantity: 1 },
          { lineNo: 2, partNameText: "스플리터 기판", quantity: 3 },
        ],
      })
    );
    assert.deepEqual(decision.usedPartIds, [mineA.id, mineB.id]);
    assert.equal(decision.basis, "legacy");
  });

  test("스냅숏을 못 찾았으면(null) 건너뛴다", () => {
    const decision = expectSkip(
      baseInput({
        metadata: {
          source: "KYOSAN_REPORT",
          sourceSha256: SHA,
          workRecordIds: [],
          reportedSymptomFilled: false,
          usedPartCount: 1,
          attachmentCount: 1,
          photoCount: 0,
        },
        usedPartRows: [mineA],
        legacyUsedPartLines: null,
      })
    );
    assert.ok(decision.reasons.some((reason) => reason.includes("감사 스냅숏")), decision.reasons.join(" / "));
  });
});

// ══════════════════════════════════════════ 🔴 번역 대조 (조각 S5-B2, 2026-09-28)

/**
 * ────────────────────────────────────────────────────────────────────────────
 * 🔴 **개발 DB 에서 실제로 일어난 일이다.** 이식은 2026-09-22 에 돌면서 품명을
 * 일본어 그대로 넣었고, 다음 날 2026-09-23 에
 * `scripts/backfill-used-parts-korean.ts` 가 그것을 **한글로 바꿨다.** 감사
 * 스냅숏은 9/22 의 일본어를 그대로 들고 있어, 글자 통째로 견주면 `D210102`(1줄)
 * · `D260403`(5줄)이 한 줄도 안 맞아 통째로 건너뛰어졌다.
 *
 * 🔴 아래 여섯 쌍은 **개발 DB 실측값이다**(2026-09-28). 다른 시험의 품명과 달리
 * 손으로 지은 가짜가 아니다 — 그래야 「그때 그 백필을 되짚는가」를 잴 수 있다.
 * 부품 이름은 고객 내용이 아니라 교산 부품 카탈로그의 낱말이다.
 *
 * 🔴 **느슨해진 것이 아니다.** 느슨해진 칸은 품명 하나뿐이고, 그 한 칸조차
 * 「아무 글자나」가 아니라 **지금 DB 의 한글을 만든 그 함수를 한 번 통과한
 * 글자**여야 한다. `line_no` 와 `quantity` 는 그대로 정확히 맞아야 한다.
 * ────────────────────────────────────────────────────────────────────────────
 */
describe("🔴 옛 흔적의 품명은 번역 대조도 받는다 — 9/23 백필을 되짚는다", () => {
  /** 감사 스냅숏(9/22 일본어) ↔ 지금 값(9/23 백필 뒤 한글). 개발 DB 실측. */
  const REAL_PAIRS: readonly (readonly [string, string])[] = [
    ["終段AMP基板（AMP-DEH基板）", "종단 AMP 기판(AMP-DEH 기판)"],
    ["終段AMP入力保護用ヒューズ", "종단 AMP 입력 보호용 퓨즈"],
    ["終段AMPゲート基板(AMP-DEH-G基板)", "종단 AMP 게이트 기판(AMP-DEH-G 기판)"],
    ["終段AMPコンデンサ基板（AMP-DEH用）", "종단 AMP 콘덴서 기판(AMP-DEH용)"],
    ["通信基板", "통신 기판"],
    ["スプリッタ基板", "스플리터 기판"],
  ];

  test("🔴 실측 여섯 쌍이 전부 맞는다 — 그리고 via 가 translated 다", () => {
    REAL_PAIRS.forEach(([snapshotName, currentName], index) => {
      const lineNo = index + 1;
      const row = usedPartRow(`0000${index}000-0000-4000-8000-00000000000${index}`, lineNo, currentName, 1);
      const match = matchLegacyUsedPartRows(
        [{ lineNo, partNameText: snapshotName, quantity: 1 }],
        [row]
      );
      assert.deepEqual(match.unmatched, [], `못 맞췄다: ${snapshotName} ↔ ${currentName}`);
      assert.deepEqual(match.matched.map((item) => item.row.id), [row.id]);
      assert.equal(match.matched[0].via, "translated", snapshotName);
    });
  });

  test("여섯 줄을 한 흔적에서 한꺼번에 맞춘다 — D260403 이 걸린 모양이다", () => {
    const rows = REAL_PAIRS.map(([, currentName], index) =>
      usedPartRow(`1010${index}000-0000-4000-8000-0000000000${index}0`, index + 1, currentName, 1)
    );
    const match = matchLegacyUsedPartRows(
      REAL_PAIRS.map(([snapshotName], index) => ({ lineNo: index + 1, partNameText: snapshotName, quantity: 1 })),
      rows
    );
    assert.deepEqual(match.unmatched, []);
    assert.deepEqual(match.matched.map((item) => item.row.id), rows.map((row) => row.id));
  });

  test("🔴 번역으로 맞아도 line_no 가 다르면 안 맞는다", () => {
    const row = usedPartRow("6666ffff-0000-4000-8000-00000000000f", 2, "통신 기판", 1);
    const match = matchLegacyUsedPartRows([{ lineNo: 1, partNameText: "通信基板", quantity: 1 }], [row]);
    assert.deepEqual(match.matched, [], "🔴 자리가 다른 줄을 집었다");
    assert.equal(match.unmatched.length, 1);
  });

  test("🔴 번역으로 맞아도 수량이 다르면 안 맞는다", () => {
    const row = usedPartRow("7777aaaa-0000-4000-8000-00000000001a", 1, "통신 기판", 3);
    const match = matchLegacyUsedPartRows([{ lineNo: 1, partNameText: "通信基板", quantity: 1 }], [row]);
    assert.deepEqual(match.matched, [], "🔴 수량이 다른 줄을 집었다");
    assert.equal(match.unmatched.length, 1);
  });

  test("글자 그대로 맞으면 via 는 exact 다 — 번역을 거치지 않는다", () => {
    const row = usedPartRow("8888bbbb-0000-4000-8000-00000000001b", 1, "통신 기판", 1);
    const match = matchLegacyUsedPartRows([{ lineNo: 1, partNameText: "통신 기판", quantity: 1 }], [row]);
    assert.equal(match.matched[0].via, "exact");
  });

  test("흔적 판정까지 — 번역으로 맞은 줄만 대상이 되고 사람이 적은 줄은 남는다", () => {
    const mine = usedPartRow("9999cccc-0000-4000-8000-00000000001c", 1, "통신 기판", 1);
    const human = usedPartRow("9999dddd-0000-4000-8000-00000000001d", 2, "사람이 적은 부품", 5);
    const decision = expectRevert(
      baseInput({
        metadata: {
          source: "KYOSAN_REPORT",
          sourceSha256: SHA,
          workRecordIds: [],
          reportedSymptomFilled: false,
          usedPartCount: 1,
          attachmentCount: 1,
          photoCount: 0,
        },
        usedPartRows: [mine, human],
        legacyUsedPartLines: [{ lineNo: 1, partNameText: "通信基板", quantity: 1 }],
      })
    );
    assert.deepEqual(decision.usedPartIds, [mine.id]);
    assert.equal(decision.basis, "legacy");
    // 🔴 무엇으로 맞췄는지 계획 출력에 남는다 — 사람이 스냅숏 글자와 지금 값이
    //    눈으로 달라 보이는 까닭을 알아야 한다.
    assert.ok(
      decision.notes.some((note) => note.includes("번역 대조")),
      decision.notes.join(" / ")
    );
    assert.ok(
      decision.notes.some((note) => note.includes("通信基板") && note.includes("통신 기판")),
      decision.notes.join(" / ")
    );
  });

  test("🔴 번역해도 안 맞는 이름이 하나 섞이면 그 흔적은 통째로 건너뛴다", () => {
    const mine = usedPartRow("aaaa9999-0000-4000-8000-00000000001e", 1, "통신 기판", 1);
    // 🔴 지금 값이 이식이 넣은 것과 다르다(사람이 고쳤다) — 번역해도 안 맞는다.
    const edited = usedPartRow("bbbb9999-0000-4000-8000-00000000001f", 2, "사람이-고친-품명", 3);
    const decision = expectSkip(
      baseInput({
        metadata: {
          source: "KYOSAN_REPORT",
          sourceSha256: SHA,
          workRecordIds: [],
          reportedSymptomFilled: false,
          usedPartCount: 2,
          attachmentCount: 1,
          photoCount: 0,
        },
        usedPartRows: [mine, edited],
        legacyUsedPartLines: [
          { lineNo: 1, partNameText: "通信基板", quantity: 1 },
          { lineNo: 2, partNameText: "スプリッタ基板", quantity: 3 },
        ],
      })
    );
    assert.ok(decision.reasons.some((reason) => reason.includes("못 맞췄습니다")), decision.reasons.join(" / "));
    assert.ok(
      decision.reasons.some((reason) => reason.includes("사람이-고친-품명")),
      "어긋난 줄의 지금 값을 사람이 읽게 찍어 준다"
    );
  });

  test("🔴 사전이 모르는 일본어만 있는 흔적은 여전히 통째로 건너뛴다", () => {
    const row = usedPartRow("cccc9999-0000-4000-8000-000000000020", 1, "알 수 없는 부품", 1);
    const decision = expectSkip(
      baseInput({
        metadata: {
          source: "KYOSAN_REPORT",
          sourceSha256: SHA,
          workRecordIds: [],
          reportedSymptomFilled: false,
          usedPartCount: 1,
          attachmentCount: 1,
          photoCount: 0,
        },
        usedPartRows: [row],
        legacyUsedPartLines: [{ lineNo: 1, partNameText: "謎の部品名前", quantity: 1 }],
      })
    );
    assert.ok(decision.reasons.some((reason) => reason.includes("못 맞췄습니다")), decision.reasons.join(" / "));
  });
});

describe("🔴 감사 스냅숏에서 이식이 **새로 넣은 줄**만 뽑는다", () => {
  test("previous_value 에 있던 줄은 빠진다 — 사람이 먼저 적은 줄을 지우지 않는다", () => {
    const lines = legacyUsedPartLinesFromAudit({
      previousValue: { lines: [{ lineNo: 1, partId: null, partNameText: "사람이 먼저", quantity: 2 }] },
      newValue: {
        source: "KYOSAN_REPORT",
        lines: [
          { lineNo: 1, partId: null, partNameText: "사람이 먼저", quantity: 2 },
          { lineNo: 2, partId: null, partNameText: "通信基板", quantity: 1 },
        ],
      },
    });
    assert.deepEqual(lines, [{ lineNo: 2, partNameText: "通信基板", quantity: 1 }]);
  });

  test("previous_value 가 비어 있으면 new_value 전부가 이식의 줄이다", () => {
    const lines = legacyUsedPartLinesFromAudit({
      previousValue: { lines: [] },
      newValue: { lines: [{ lineNo: 1, partId: null, partNameText: "通信基板", quantity: 1 }] },
    });
    assert.deepEqual(lines, [{ lineNo: 1, partNameText: "通信基板", quantity: 1 }]);
  });

  test("모양이 다르면 null 이다 — 모르는 채로 지우지 않는다", () => {
    assert.equal(legacyUsedPartLinesFromAudit({ previousValue: null, newValue: null }), null);
    assert.equal(legacyUsedPartLinesFromAudit({ previousValue: null, newValue: { lines: "없음" } }), null);
    assert.equal(
      legacyUsedPartLinesFromAudit({ previousValue: null, newValue: { lines: [{ lineNo: "1" }] } }),
      null
    );
  });
});

// ══════════════════════════════════════════════ 🔴 신고 증상

describe("🔴 신고 증상은 이식이 채운 그 값 그대로일 때만 되돌린다", () => {
  const filledMetadata = {
    source: "KYOSAN_REPORT",
    sourceSha256: SHA,
    workRecordIds: [],
    reportedSymptomFilled: true,
    usedPartCount: 0,
    attachmentCount: 1,
    photoCount: 0,
  };

  test("이식이 넣은 값 그대로면 이식 전 값으로 되돌린다", () => {
    const decision = expectRevert(
      baseInput({
        metadata: filledMetadata,
        symptomAudit: { previousValue: null, importedValue: "이식이-넣은-값" },
        currentReportedSymptom: "이식이-넣은-값",
      })
    );
    assert.deepEqual(decision.reportedSymptom, { restoreTo: null, expectNow: "이식이-넣은-값" });
  });

  test("🔴 그 사이에 사람이 고쳤으면 건너뛴다 — 덮어쓰지 않는다", () => {
    const decision = expectSkip(
      baseInput({
        metadata: filledMetadata,
        symptomAudit: { previousValue: null, importedValue: "이식이-넣은-값" },
        currentReportedSymptom: "사람이-고친-값",
      })
    );
    assert.ok(decision.reasons.some((reason) => reason.includes("사람이 고쳤습니다")), decision.reasons.join(" / "));
  });

  test("감사 기록을 못 찾았으면 건너뛴다 — 무슨 값으로 되돌릴지 모른다", () => {
    const decision = expectSkip(
      baseInput({ metadata: filledMetadata, symptomAudit: null, currentReportedSymptom: "이식이-넣은-값" })
    );
    assert.ok(decision.reasons.some((reason) => reason.includes("감사 기록")));
  });

  test("채운 적이 없으면 칸을 건드리지 않는다", () => {
    const decision = expectRevert(baseInput({ currentReportedSymptom: "사람이-적은-값" }));
    assert.equal(decision.reportedSymptom, null);
  });

  test("🔴 흔적이 말해 주지 않으면(칸 자체가 없음) 건너뛴다", () => {
    const decision = expectSkip(
      baseInput({
        metadata: {
          source: "KYOSAN_REPORT",
          sourceSha256: SHA,
          usedPartCount: 0,
          attachmentCount: 1,
          photoCount: 0,
        },
      })
    );
    assert.ok(
      decision.reasons.some((reason) => reason.includes("reportedSymptomFilled")),
      decision.reasons.join(" / ")
    );
  });
});

// ══════════════════════════════════════════════ 알림 · 흔적 읽기

describe("흔적 읽기와 알림", () => {
  test("새 흔적은 id 로 고르고 basis 가 id 다", () => {
    const decision = expectRevert(
      baseInput({
        metadata: {
          source: "KYOSAN_REPORT",
          sourceSha256: SHA,
          workRecordIds: ["9999aaaa-0000-4000-8000-00000000000f"],
          reportedSymptomFilled: false,
          usedPartCount: 0,
          usedPartIds: [],
          attachmentCount: 2,
          attachmentIds: [
            "aaaa1111-0000-4000-8000-000000000001",
            "dddd4444-0000-4000-8000-000000000004",
          ],
          photoCount: 1,
          importBatchId: "8888cccc-0000-4000-8000-00000000000e",
        },
        foundWorkRecordIds: ["9999aaaa-0000-4000-8000-00000000000f"],
        attachmentRows: [
          attachmentRow({ id: "aaaa1111-0000-4000-8000-000000000001" }),
          photoRow("dddd4444-0000-4000-8000-000000000004", 1),
          // 🔴 흔적이 말하지 않은 사람 업로드 — id 로 고르므로 안 걸려야 한다.
          attachmentRow({ id: "557a5216-19a5-44bd-9658-6b1dc666604e", description: null }),
        ],
      })
    );
    assert.equal(decision.basis, "id");
    assert.equal(decision.importBatchId, "8888cccc-0000-4000-8000-00000000000e");
    assert.deepEqual(decision.workRecordIds, ["9999aaaa-0000-4000-8000-00000000000f"]);
    assert.deepEqual(decision.photoAttachmentIds, ["dddd4444-0000-4000-8000-000000000004"]);
    assert.equal(decision.attachmentIds.includes("557a5216-19a5-44bd-9658-6b1dc666604e"), false);
    assert.equal(decision.files.length, 2);
  });

  test("흔적이 말한 작업 기록이 이미 사라졌으면 남은 것만 지우고 알린다", () => {
    const decision = expectRevert(
      baseInput({
        metadata: {
          source: "KYOSAN_REPORT",
          sourceSha256: SHA,
          workRecordIds: ["9999aaaa-0000-4000-8000-00000000000f", "9999bbbb-0000-4000-8000-00000000000d"],
          reportedSymptomFilled: false,
          usedPartCount: 0,
          attachmentCount: 1,
          photoCount: 0,
        },
        foundWorkRecordIds: ["9999aaaa-0000-4000-8000-00000000000f"],
      })
    );
    assert.deepEqual(decision.workRecordIds, ["9999aaaa-0000-4000-8000-00000000000f"]);
    assert.ok(decision.notes.some((note) => note.includes("2줄 가운데 1줄")), decision.notes.join(" / "));
  });

  test("🔴 보고서를 만들던 아주 옛 흔적은 알리되 보고서를 건드리지 않는다", () => {
    const decision = expectRevert(
      baseInput({
        metadata: {
          source: "KYOSAN_REPORT",
          sourceSha256: SHA,
          serviceReportId: "7777dddd-0000-4000-8000-00000000000c",
          reportedSymptomFilled: false,
          usedPartCount: 0,
          attachmentCount: 1,
          photoCount: 0,
        },
      })
    );
    assert.ok(decision.notes.some((note) => note.includes("서비스 보고서")), decision.notes.join(" / "));
    assert.equal(
      JSON.stringify(decision).includes("7777dddd-0000-4000-8000-00000000000c"),
      false,
      "🔴 보고서 id 가 지울 목록에 실리면 안 된다"
    );
  });

  test("readKyosanTraceMetadata — 칸이 없으면 null, 모양이 틀려도 null", () => {
    const old = readKyosanTraceMetadata({ source: "KYOSAN_REPORT", sourceSha256: SHA, usedPartCount: 1 });
    assert.equal(old.usedPartIds, null);
    assert.equal(old.attachmentIds, null);
    assert.equal(old.reportedSymptomFilled, null);
    assert.equal(old.importBatchId, null);

    const broken = readKyosanTraceMetadata({
      source: "KYOSAN_REPORT",
      sourceSha256: SHA,
      usedPartIds: [1, 2],
      attachmentIds: "없음",
    });
    assert.equal(broken.usedPartIds, null, "모양이 틀린 id 목록을 그대로 믿으면 안 된다");
    assert.equal(broken.attachmentIds, null);
  });
});
