import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  KYOSAN_BACKFILL_OUTCOME_LABEL,
  KYOSAN_BACKFILL_OUTCOME_ORDER,
  KYOSAN_BACKFILL_RETRYABLE_OUTCOMES,
  backfillLinesAreIdentical,
  backfillQuantityTotal,
  backfillRowsMatchTrace,
  backfillTallyTotal,
  buildBackfillNextLines,
  classifyBackfillTraceShape,
  emptyBackfillTally,
  formatKyosanUsedPartsBackfillSummary,
  screenSafeMessage,
  tallyBackfillOutcomes,
  type BackfillUsedPartRow,
  type KyosanBackfillTraceRecord,
  type KyosanUsedPartsBackfillRecord,
} from "./kyosan-used-parts-backfill-plan";
import type { KyosanPreviewPart } from "../../src/lib/kyosan/report-preview";

/**
 * ============================================================================
 * 연락서 **사용 부품 백필**의 고르는 규칙 (2026-10-28)
 * ============================================================================
 * 이 시험이 지키는 것은 「많이 바꾸는가」가 아니라 **「바꾸지 말아야 할 때 한 줄도
 * 안 바꾸는가」**와 **「이식기와 같은 줄을 만드는가」**다.
 *
 * 🔴 **가장 중요한 둘**
 *  1. 사람이 그 뒤에 고친 칸은 손대지 않는다(`backfillRowsMatchTrace`).
 *  2. 넣을 줄의 글자가 이식기(`replaceUsedParts`)가 만드는 글자와 **한 글자도
 *     다르지 않다** — 같은 두 함수를 같은 차례로 부른다.
 * ============================================================================
 */

// ─────────────────────────────────────────────── 거들이

function rowOf(overrides: Partial<BackfillUsedPartRow> & { id: string }): BackfillUsedPartRow {
  return {
    lineNo: 1,
    partId: null,
    partNameText: "값-부품",
    quantity: 1,
    ...overrides,
  };
}

function partOf(text: string, quantity?: number): KyosanPreviewPart {
  return quantity === undefined ? { kind: "fault", text } : { kind: "fault", text, quantity };
}

// ══════════════════════════════════════════════ 흔적의 모양

describe("흔적이 백필 대상인가 — 모양만 보고 가른다", () => {
  const healthy = {
    caseAlive: true,
    traceCountForCase: 1,
    usedPartIds: ["u1", "u2"],
    usedPartCount: 2,
  };

  test("🔵 먼저 **대상이 되는 모양**이 실제로 통과한다 — 아니면 아래 단언들이 공짜로 통과한다", () => {
    assert.equal(classifyBackfillTraceShape(healthy), null);
  });

  test("수리 건이 없거나 휴지통이면 case-missing", () => {
    assert.equal(classifyBackfillTraceShape({ ...healthy, caseAlive: false }), "case-missing");
  });

  test("🔴 한 건에 연락서 흔적이 둘 이상이면 multi-trace — 어느 장의 부품이 남을지 못 정한다", () => {
    assert.equal(classifyBackfillTraceShape({ ...healthy, traceCountForCase: 2 }), "multi-trace");
    assert.equal(classifyBackfillTraceShape({ ...healthy, traceCountForCase: 9 }), "multi-trace");
  });

  test("🔴 옛 흔적(usedPartIds·usedPartCount 가 없다)은 legacy-trace — 갈아 끼울 칸이 없다", () => {
    assert.equal(classifyBackfillTraceShape({ ...healthy, usedPartIds: null }), "legacy-trace");
    assert.equal(classifyBackfillTraceShape({ ...healthy, usedPartCount: null }), "legacy-trace");
  });

  test("흔적 안에서 개수가 어긋나면 trace-inconsistent", () => {
    assert.equal(
      classifyBackfillTraceShape({ ...healthy, usedPartIds: ["u1"], usedPartCount: 2 }),
      "trace-inconsistent"
    );
  });

  test("🔴 이식이 한 줄도 안 넣었던 건(usedPartCount 0)은 no-imported-parts — 백필이 새로 넣지 않는다", () => {
    assert.equal(
      classifyBackfillTraceShape({ ...healthy, usedPartIds: [], usedPartCount: 0 }),
      "no-imported-parts"
    );
  });

  test("🔴 차례: 수리 건이 없으면 다른 흠이 있어도 case-missing 이 먼저다", () => {
    assert.equal(
      classifyBackfillTraceShape({
        caseAlive: false,
        traceCountForCase: 3,
        usedPartIds: null,
        usedPartCount: null,
      }),
      "case-missing"
    );
  });
});

// ══════════════════════════════════════════════ 🔴 사람이 손댄 칸은 건드리지 않는다

describe("🔴 지금 줄이 「이식이 넣은 그 줄 그대로」인가", () => {
  test("🔵 먼저 **그대로인 경우**가 참이다 — 아니면 아래가 전부 공짜로 통과한다", () => {
    const rows = [rowOf({ id: "u1", lineNo: 1 }), rowOf({ id: "u2", lineNo: 2 })];
    assert.equal(backfillRowsMatchTrace(rows, ["u1", "u2"]), true);
  });

  test("차례가 달라도 id 집합이 같으면 그대로다(줄 차례는 다른 함수가 본다)", () => {
    const rows = [rowOf({ id: "u2", lineNo: 2 }), rowOf({ id: "u1", lineNo: 1 })];
    assert.equal(backfillRowsMatchTrace(rows, ["u1", "u2"]), true);
  });

  test("🔴 흔적이 모르는 줄이 하나라도 섞여 있으면 거짓 — 사람이 적은 줄이다", () => {
    const rows = [rowOf({ id: "u1" }), rowOf({ id: "u2" }), rowOf({ id: "손으로-적은-줄" })];
    assert.equal(backfillRowsMatchTrace(rows, ["u1", "u2"]), false);
  });

  test("🔴 흔적이 말한 줄이 이미 하나 사라졌으면 거짓", () => {
    assert.equal(backfillRowsMatchTrace([rowOf({ id: "u1" })], ["u1", "u2"]), false);
  });

  test("🔴 part_id 가 붙은 줄이 있으면 거짓 — 이식은 부품 대장과 이어 붙이지 않는다", () => {
    const rows = [rowOf({ id: "u1" }), rowOf({ id: "u2", partId: "부품-대장-id" })];
    assert.equal(backfillRowsMatchTrace(rows, ["u1", "u2"]), false);
  });

  test("흔적 쪽 id 가 겹쳐 적혀 있으면 거짓 — 셈이 맞아도 믿지 않는다", () => {
    const rows = [rowOf({ id: "u1" }), rowOf({ id: "u1" })];
    assert.equal(backfillRowsMatchTrace(rows, ["u1", "u1"]), false);
  });

  test("한 줄도 없는 칸 + 빈 목록은 그대로다(그 갈래는 모양 판정이 먼저 거른다)", () => {
    assert.equal(backfillRowsMatchTrace([], []), true);
  });
});

// ══════════════════════════════════════════════ 🔴 넣을 줄 — 이식기와 같은 글자

describe("🔴 넣을 줄 만들기 — 묶고 나서 번역한다(이식기와 같은 차례)", () => {
  test("🔵 묶기: 같은 이름이 갈래만 다르게 둘이면 **한 줄 · 수량 합**이 된다", () => {
    const next = buildBackfillNextLines([
      { kind: "fault", text: "終段AMP基板", quantity: 3 },
      { kind: "preventive", text: "終段AMP基板", quantity: 7 },
    ]);
    assert.equal(next.length, 1);
    assert.equal(next[0].quantity, 10);
  });

  test("🔴 번역: 일본어 품명이 **한글로** 들어간다(사용 부품 칸은 저장할 때 바꾼다)", () => {
    const next = buildBackfillNextLines([partOf("終段AMP基板", 1), partOf("スプリッタ基板", 2)]);
    assert.deepEqual(
      next.map((line) => line.partNameText),
      ["종단 AMP 기판", "스플리터 기판"]
    );
  });

  test("🔴 사전이 모르는 글자는 **원문 그대로** — 반쪽짜리 글자가 생기지 않는다", () => {
    const next = buildBackfillNextLines([partOf("謎の部品ZZZ", 1)]);
    assert.equal(next.length, 1);
    assert.equal(next[0].partNameText, "謎の部品ZZZ");
  });

  test("수량이 안 적힌 줄은 1로 센다", () => {
    const next = buildBackfillNextLines([partOf("終段AMP基板")]);
    assert.equal(next[0].quantity, 1);
  });

  test("🔴 차례(lineNo)는 1번부터 빠짐없이 다시 매긴다", () => {
    const next = buildBackfillNextLines([
      partOf("終段AMP基板", 1),
      partOf("スプリッタ基板", 1),
      partOf("謎の部品ZZZ", 1),
    ]);
    assert.deepEqual(
      next.map((line) => line.lineNo),
      [1, 2, 3]
    );
  });

  test("🔴 묶어도 **수량 합계는 그대로**다 — 줄 수만 준다", () => {
    const parts: KyosanPreviewPart[] = [
      { kind: "fault", text: "終段AMP基板", quantity: 3 },
      { kind: "preventive", text: "終段AMP基板", quantity: 7 },
      { kind: "fault", text: "スプリッタ基板", quantity: 2 },
    ];
    const next = buildBackfillNextLines(parts);
    assert.equal(next.length, 2, "세 줄이 두 줄로 묶인다");
    assert.equal(
      backfillQuantityTotal(next),
      parts.reduce((sum, part) => sum + (part.quantity ?? 1), 0)
    );
  });

  test("교체 부품이 없으면 빈 목록(부르는 쪽이 그 전에 거른다)", () => {
    assert.deepEqual(buildBackfillNextLines([]), []);
  });
});

// ══════════════════════════════════════════════ 이미 같은가

describe("🔵 이미 같으면 한 글자도 쓰지 않는다", () => {
  const next = buildBackfillNextLines([partOf("終段AMP基板", 3), partOf("スプリッタ基板", 1)]);

  test("🔵 먼저 **같은 경우**가 참이다", () => {
    const rows = [
      rowOf({ id: "u1", lineNo: 1, partNameText: "종단 AMP 기판", quantity: 3 }),
      rowOf({ id: "u2", lineNo: 2, partNameText: "스플리터 기판", quantity: 1 }),
    ];
    assert.equal(backfillLinesAreIdentical(rows, next), true);
  });

  test("🔴 일본어가 그대로 남아 있으면 **같지 않다** — 그것이 이 백필이 고치려는 바로 그 상태다", () => {
    const rows = [
      rowOf({ id: "u1", lineNo: 1, partNameText: "終段AMP基板", quantity: 3 }),
      rowOf({ id: "u2", lineNo: 2, partNameText: "スプリッタ基板", quantity: 1 }),
    ];
    assert.equal(backfillLinesAreIdentical(rows, next), false);
  });

  test("수량이 다르면 같지 않다", () => {
    const rows = [
      rowOf({ id: "u1", lineNo: 1, partNameText: "종단 AMP 기판", quantity: 2 }),
      rowOf({ id: "u2", lineNo: 2, partNameText: "스플리터 기판", quantity: 1 }),
    ];
    assert.equal(backfillLinesAreIdentical(rows, next), false);
  });

  test("🔴 차례가 다르면 같지 않다 — 화면에 보이는 차례가 달라진다", () => {
    const rows = [
      rowOf({ id: "u1", lineNo: 1, partNameText: "스플리터 기판", quantity: 1 }),
      rowOf({ id: "u2", lineNo: 2, partNameText: "종단 AMP 기판", quantity: 3 }),
    ];
    assert.equal(backfillLinesAreIdentical(rows, next), false);
  });

  test("줄 수가 다르면 같지 않다", () => {
    const rows = [rowOf({ id: "u1", lineNo: 1, partNameText: "종단 AMP 기판", quantity: 3 })];
    assert.equal(backfillLinesAreIdentical(rows, next), false);
  });

  test("🔴 번호가 1부터가 아니면 같지 않다 — 백필은 1번부터 다시 매긴다", () => {
    const rows = [
      rowOf({ id: "u1", lineNo: 4, partNameText: "종단 AMP 기판", quantity: 3 }),
      rowOf({ id: "u2", lineNo: 5, partNameText: "스플리터 기판", quantity: 1 }),
    ];
    assert.equal(backfillLinesAreIdentical(rows, next), false);
  });
});

// ══════════════════════════════════════════════ 세기

describe("갈래별로 센다", () => {
  test("🔴 갈래마다 이름이 있고 차례 목록에 빠짐이 없다", () => {
    const labels = Object.keys(KYOSAN_BACKFILL_OUTCOME_LABEL).sort();
    assert.deepEqual([...KYOSAN_BACKFILL_OUTCOME_ORDER].sort(), labels);
    assert.ok(KYOSAN_BACKFILL_OUTCOME_ORDER.length >= 15, "갈래가 통째로 사라지지 않았다");
  });

  test("🔴 「다시 돌리면 되는 갈래」가 실제 갈래 목록 안에 있다", () => {
    assert.ok(KYOSAN_BACKFILL_RETRYABLE_OUTCOMES.length > 0);
    for (const outcome of KYOSAN_BACKFILL_RETRYABLE_OUTCOMES) {
      assert.ok(
        KYOSAN_BACKFILL_OUTCOME_ORDER.includes(outcome),
        `${outcome} 가 갈래 목록에 없다`
      );
    }
  });

  test("빈 셈은 모든 갈래가 0 이고 합계도 0", () => {
    const tally = emptyBackfillTally();
    assert.equal(backfillTallyTotal(tally), 0);
    for (const outcome of KYOSAN_BACKFILL_OUTCOME_ORDER) assert.equal(tally[outcome], 0);
  });

  test("🔴 합계가 센 개수와 같다 — 어느 갈래에도 안 들어간 건이 없다", () => {
    const outcomes = [
      "updated",
      "updated",
      "unchanged",
      "legacy-trace",
      "inventory-unknown",
    ] as const;
    const tally = tallyBackfillOutcomes([...outcomes]);
    assert.equal(tally.updated, 2);
    assert.equal(tally.unchanged, 1);
    assert.equal(backfillTallyTotal(tally), outcomes.length);
  });
});

// ══════════════════════════════════════════════ 🔴 요약에 파일 이름이 안 들어간다

/**
 * ============================================================================
 * 🔴 **요약(화면)에 파일 이름이 한 글자도 안 들어간다** (2026-10-28)
 * ============================================================================
 * 연락서 파일 이름에는 **고객사명 · 모델 · L/N · S/N** 이 그대로 들어 있다. 이 도구의
 * 첫 판이 「내용이 같은 파일」 절에 이름을 전부 늘어놓고 있었고, 계획을 한 번 돌려
 * 보니 한 묶음이 80장을 넘었다.
 *
 * 🔵 **소스 글자로 재지 않는다.** 「`fileNames` 를 안 쓴다」를 grep 으로 재면, 나중에
 * 다른 자리에서 이름이 새는 것을 못 잡는다. 그래서 **요약을 실제로 만들어** 그 안에
 * 이름이 있는지 본다.
 * 🔴 여기 쓰는 이름은 전부 **지어낸 것**이다 — 진짜 고객사·S/N 을 시험에 넣지 않는다.
 * ============================================================================
 */

const FAKE_FILE_NAME = "DSS 2026-0000 값-고객사 값-모델 값-LN 값-SN 수리연락서.xlsm";
const FAKE_LOCK_NAME = "~$DSS 2026-0000 값-고객사 값-모델.xlsm";
const FAKE_FS_ERROR =
  `ENOENT: no such file or directory, open 'C:\\값-공유폴더\\연락서\\${FAKE_FILE_NAME}'`;

function traceRecordOf(
  overrides: Partial<KyosanBackfillTraceRecord>
): KyosanBackfillTraceRecord {
  return {
    index: 1,
    traceId: "trace-1",
    repairCaseId: "case-1",
    intakeNumber: "D260101",
    sourceSha256: "a".repeat(64),
    fileName: FAKE_FILE_NAME,
    outcome: "updated",
    previousLineCount: 3,
    nextLineCount: 2,
    previousQuantityTotal: 5,
    nextQuantityTotal: 5,
    message: "3줄 → 2줄",
    ...overrides,
  };
}

function recordOf(
  overrides: Partial<KyosanUsedPartsBackfillRecord> = {}
): KyosanUsedPartsBackfillRecord {
  const traces = overrides.traces ?? [traceRecordOf({})];
  return {
    ranAt: "2026-10-28T00:00:00.000Z",
    databaseName: "값-DB",
    mode: "dry-run",
    backfillRunId: null,
    actorUserId: null,
    scannedFileCount: 1622,
    ignoredFileCount: 83,
    traceCount: 469,
    unmatchedTraceIntakeNumbers: ["D260102"],
    orphanFileCount: 1485,
    tally: tallyBackfillOutcomes(traces.map((trace) => trace.outcome)),
    changedPreviousLineTotal: 3,
    changedNextLineTotal: 2,
    changedPreviousQuantityTotal: 5,
    changedNextQuantityTotal: 5,
    duplicateHashGroups: [
      { sha256: "b".repeat(64), fileNames: [FAKE_LOCK_NAME, FAKE_LOCK_NAME, FAKE_FILE_NAME] },
      { sha256: "c".repeat(64), fileNames: [FAKE_FILE_NAME, FAKE_FILE_NAME] },
    ],
    ...overrides,
    traces,
  };
}

describe("🔴 요약을 실제로 만들어 본다 — 파일 이름이 한 글자도 없다", () => {
  test("🔵 먼저 **요약이 실제로 내용을 담는다** — 아니면 아래가 전부 공짜로 통과한다", () => {
    const summary = formatKyosanUsedPartsBackfillSummary(recordOf());
    assert.ok(summary.includes("갈래별 합계"), summary);
    assert.ok(summary.includes("2묶음"), "내용이 같은 파일 묶음 수를 찍어야 한다");
    assert.ok(summary.includes("가장 큰 묶음 3장"), "묶음당 장수를 찍어야 한다");
    assert.ok(summary.includes("83장"), "세지 않은 찌꺼기 수를 찍어야 한다");
    assert.ok(summary.includes("1622장"), "연락서 장수를 찍어야 한다");
    assert.ok(summary.includes("D260102"), "접수번호는 찍는다 — 우리 번호다");
  });

  test("🔴 묶음 절에 파일 이름이 없다 — 수만 찍는다", () => {
    const summary = formatKyosanUsedPartsBackfillSummary(recordOf());
    assert.equal(summary.includes(FAKE_FILE_NAME), false, summary);
    assert.equal(summary.includes(FAKE_LOCK_NAME), false, summary);
    assert.equal(summary.includes("값-고객사"), false, "고객사명이 새어 나갔다");
    assert.equal(summary.includes("값-SN"), false, "S/N 이 새어 나갔다");
    assert.equal(summary.includes("~$DSS"), false, "잠금 파일 이름이 새어 나갔다");
  });

  test("🔴 실패한 건의 fs 오류 문장에 섞인 **경로**도 안 나간다", () => {
    const summary = formatKyosanUsedPartsBackfillSummary(
      recordOf({
        traces: [traceRecordOf({ outcome: "failed", message: FAKE_FS_ERROR })],
      })
    );
    // 🔵 그 건이 보이기는 해야 한다 — 조용히 사라지면 더 나쁘다.
    assert.ok(summary.includes("D260101"), "실패한 건의 접수번호는 찍어야 한다");
    assert.ok(summary.includes(KYOSAN_BACKFILL_OUTCOME_LABEL.failed), summary);
    // 🔴 그런데 이름·경로는 한 글자도 없다.
    assert.equal(summary.includes(FAKE_FILE_NAME), false, summary);
    assert.equal(summary.includes("값-공유폴더"), false, "공유폴더 경로가 새어 나갔다");
    assert.equal(summary.includes("ENOENT"), false, "fs 오류 문장이 통째로 실렸다");
    assert.ok(summary.includes("--out"), "대신 어디서 보는지 알려 줘야 한다");
  });

  test("🔴 어느 갈래가 와도 이름이 안 나간다 — 갈래를 전부 넣어 본다", () => {
    const traces = KYOSAN_BACKFILL_OUTCOME_ORDER.map((outcome, index) =>
      traceRecordOf({ index: index + 1, outcome, message: FAKE_FS_ERROR })
    );
    const summary = formatKyosanUsedPartsBackfillSummary(recordOf({ traces }));
    assert.equal(summary.includes(FAKE_FILE_NAME), false, summary);
    assert.equal(summary.includes("값-공유폴더"), false, summary);
    assert.equal(summary.includes("값-모델"), false, summary);
  });

  test("우리가 지은 문장(개수·까닭)은 그대로 보인다 — 지나치게 가리지 않는다", () => {
    const summary = formatKyosanUsedPartsBackfillSummary(
      recordOf({
        traces: [
          traceRecordOf({
            outcome: "row-mismatch",
            message: "흔적은 이식이 3줄을 넣었다고 말하는데 지금 칸에는 4줄이 있고 그 줄이 같지 않습니다.",
          }),
        ],
      })
    );
    assert.ok(summary.includes("3줄을 넣었다고 말하는데"), summary);
  });
});

describe("화면에 올려도 되는 문장인가", () => {
  test("🔵 개수·까닭만 담은 문장은 그대로 지난다", () => {
    assert.equal(screenSafeMessage("3줄 → 2줄"), "3줄 → 2줄");
    assert.equal(screenSafeMessage(null), null);
  });

  test("🔴 경로 구분자나 통합문서 확장자가 보이면 통째로 바꾼다", () => {
    for (const leaky of [
      FAKE_FS_ERROR,
      `열지 못했습니다: ${FAKE_FILE_NAME}`,
      "C:/값-폴더/값.xlsx 를 읽지 못했습니다",
      "값-폴더\\값-파일",
    ]) {
      const safe = screenSafeMessage(leaky);
      assert.notEqual(safe, leaky, `가려지지 않았다: ${leaky}`);
      assert.ok(safe !== null && safe.includes("--out"), safe ?? "(null)");
    }
  });
});

// ══════════════════════════════════════════════ 🔴 이식기와 갈라지지 않았는가

/**
 * 🔴 **이식기의 글자를 읽어 본다.** 백필과 이식기는 서로를 부르지 않으므로(이식기는
 * `server-only` 이고 제 트랜잭션 안에서 돈다) **갈라져도 컴파일러가 아무 말도 하지
 * 않는다.** 그 자리를 지키는 것은 이 시험뿐이다 — 선례는
 * `kyosan-import-run-plan.test.ts` 가 같은 파일의 경고 문구를 읽어 보는 자리다.
 *
 * 🔴 **주석을 먼저 걷어낸다.** 이 저장소의 머리말에는 함수 이름이 그대로 적혀
 * 있어서, 안 걷으면 **주석만으로 영영 통과한다**(「있어야 한다」 쪽 검사의 함정).
 */
function sourceWithoutComments(relativePath: string): string {
  const absolute = path.join(process.cwd(), relativePath);
  return readFileSync(absolute, "utf8")
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      return !(
        trimmed.startsWith("*") ||
        trimmed.startsWith("//") ||
        trimmed.startsWith("/*") ||
        trimmed.startsWith("*/")
      );
    })
    .join("\n");
}

describe("🔴 이식기가 사용 부품을 만드는 규칙이 그대로인가", () => {
  const IMPORTER = "src/lib/server/services/kyosan-report-import.ts";
  const code = sourceWithoutComments(IMPORTER);

  test("🔵 먼저 **주석을 실제로 걷어냈다** — 안 걷으면 아래가 전부 공짜로 통과한다", () => {
    const raw = readFileSync(path.join(process.cwd(), IMPORTER), "utf8");
    assert.ok(raw.length > code.length, "주석이 한 줄도 안 걷혔다");
    assert.ok(
      raw.includes("mergeKyosanPartsForUsedParts` 한 곳에 있다"),
      "머리말에 그 이름이 적혀 있다는 전제가 깨졌다 — 이 시험의 뜻이 사라진다"
    );
  });

  test("🔴 이식기가 아직 `mergeKyosanPartsForUsedParts` 로 묶는다", () => {
    assert.ok(
      code.includes("mergeKyosanPartsForUsedParts(params.parts)"),
      "이식기가 묶는 방식을 바꿨다 — 백필의 buildBackfillNextLines 도 함께 봐야 한다"
    );
  });

  test("🔴 이식기가 아직 `translateKyosanSentence(...) ?? line.text` 로 적는다", () => {
    assert.ok(
      code.includes("translateKyosanSentence(line.text) ?? line.text"),
      "이식기가 품명을 적는 방식을 바꿨다 — 백필이 다른 글자를 넣게 된다"
    );
  });

  test("🔴 이식기가 아직 `part_id` 를 비워 넣는다", () => {
    assert.ok(code.includes("partId: null"), "이식이 부품 대장과 이어 붙기 시작했다");
  });

  test("🔴 이식기가 아직 **그 건의 줄만** 지우고 다시 넣는다(덮어쓰기)", () => {
    assert.ok(
      code.includes("delete(repairCaseUsedParts)") &&
        code.includes("eq(repairCaseUsedParts.repairCaseId, params.repairCaseId)"),
      "이식기의 덮어쓰기가 바뀌었다 — 백필의 전제가 깨졌다"
    );
  });

  test("🔴 이식기가 아직 게이트와 재고 트레이스를 본다", () => {
    assert.ok(code.includes("resolveUsedPartsWriteGate({"), "게이트가 사라졌다");
    assert.ok(code.includes('trace.kind === "present"'), "부품 요청 흔적 검사가 사라졌다");
    assert.ok(code.includes('trace.kind === "unknown"'), "「모른다」 검사가 사라졌다");
  });
});
