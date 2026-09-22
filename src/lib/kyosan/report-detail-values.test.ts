import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  KYOSAN_IMPORT_MARK,
  KYOSAN_MEMO_LIMIT,
  KYOSAN_REPORTED_SYMPTOM_LIMIT,
  buildKyosanDetailValues,
  kyosanLineDestination,
  kyosanPartDestination,
} from "./report-detail-values";
import {
  KYOSAN_ACTION_MARK_ORIGIN,
  KYOSAN_CAUSE_MARK_ORIGIN,
  type KyosanImportPlan,
  type KyosanPreviewLine,
} from "./report-preview";

/**
 * ============================================================================
 * 연락서 내용 → **수리 건 상세의 제자리 칸** (조각 S5)
 * ============================================================================
 * 못 박는 것은 여섯이다.
 *  1. 🔴 **줄마다 갈 자리가 정해져 있다** — 「확인 내용」·「조치」 같은 보고서
 *     칸이 아니라 상세의 진짜 칸이다.
 *  2. 🔴 **신고 증상은 비어 있을 때만 쓴다** — 사람이 적은 글자를 지우지 않는다.
 *  3. 🔴 **못 넣은 내용을 잃지 않는다** — 칸에 못 넣으면 작업 기록으로 간다.
 *  4. 🔴 **4000자를 말없이 자르지 않는다** — 나눠 넣고, 종류를 단 조각은 하나다.
 *  5. 🔴 **원문을 고치지 않는다** — 머리글만 따로 끼운다.
 *  6. 🔴 **정보량 0 인 보기(처치 ○ · 원인 ○)는 요약 칸을 차지하지 않는다** —
 *     그렇다고 버리지도 않는다(「작업 이력」에 남는다). 2026-09-22 사용자 지시.
 * ============================================================================
 */

function line(origin: string, text: string, section: KyosanPreviewLine["section"] = "FINDINGS"): KyosanPreviewLine {
  return { section, origin, text };
}

function planOf(overrides: Partial<KyosanImportPlan> = {}): KyosanImportPlan {
  return {
    repairCaseId: "11111111-1111-4111-8111-111111111111",
    intakeNumber: "D210105",
    lines: [],
    parts: [],
    causeMarks: [],
    actionMarks: [],
    photoCount: 0,
    formAssetCount: 0,
    ...overrides,
  };
}

function build(plan: KyosanImportPlan, currentReportedSymptom: string | null = null) {
  return buildKyosanDetailValues({ plan, currentReportedSymptom });
}

function memoOf(result: ReturnType<typeof build>, kind: string): string {
  const found = result.workRecords.find((draft) => draft.recordKind === kind);
  assert.ok(found, `${kind} 기록이 있어야 한다: ${JSON.stringify(result.workRecords.map((d) => d.recordKind))}`);
  return found.memo;
}

// ══════════════════════════════════════════════ 1. 어느 자리로 가는가

describe("🔴 줄마다 갈 자리가 정해져 있다", () => {
  test("연락서 항목 이름이 자리를 정한다 — 보고서 구역 이름이 아니다", () => {
    assert.equal(kyosanLineDestination(line("고객 고장 상황", "값")), "REPORTED_SYMPTOM");

    for (const origin of ["사내 확인 결과", "고장 부위", "불량 현상 상세", "반품 사유 상세"]) {
      assert.equal(kyosanLineDestination(line(origin, "값")), "INTAKE_INSPECTION_RESULT", origin);
    }

    // 🔴 사람이 손으로 적은 자유 기술만 요약 칸으로 간다.
    assert.equal(kyosanLineDestination(line("원인 상세", "값")), "DIAGNOSIS_REPAIR_SUMMARY");

    // 🔴 비고는 넣지 않는다(실측 469장 중 0장). 화면이 「넣지 않음」으로 보여 준다.
    assert.equal(kyosanLineDestination(line("비고", "값", "REMARK")), "NOT_IMPORTED");
  });

  /**
   * 🔴 **뜻을 다시 정한 시험** (2026-09-22). 예전에는 처치 ○ · 원인 ○ 가
   * `DIAGNOSIS_REPAIR_SUMMARY` 로 간다고 못 박혀 있었다. 사용자 지시
   * (「현품인수, 조치 완료 등은 내용으로 넣지 않아도 돼」)와 실측이 그 규칙을
   * 뒤집었다 — 처치 ○ 는 469장 전부가 `現品引取`, 466장이 `処置完了` 이고
   * 원인 ○ 는 88%가 `その他` 다. 정보량 0 인 문장이 「현재 진단/조치 요약」을
   * 차지하면 안 된다.
   *
   * 🔴 그러나 **버리지도 않는다** — 새 규칙은 「요약 칸에서 빼고 작업 이력에
   * 남긴다」이지 「없앤다」가 아니다. 아래 두 단언이 그 둘을 함께 못 박는다.
   */
  test("🔴 처치 ○ · 원인 ○ 는 요약 칸이 아니라 「일반」 작업 기록으로 간다 — 버리지는 않는다", () => {
    for (const origin of [KYOSAN_ACTION_MARK_ORIGIN, KYOSAN_CAUSE_MARK_ORIGIN]) {
      const destination = kyosanLineDestination(line(origin, "값"));
      assert.equal(destination, "WORK_RECORD_GENERAL", origin);
      // 🔴 `NOT_IMPORTED` 로 바꾸면 화면에서 영구히 사라진다 — 그러면 안 된다.
      assert.notEqual(destination, "NOT_IMPORTED", `${origin} 를 버리면 안 된다`);
    }
  });

  test("🔴 처치 ○ 와 원인 ○ 의 원문은 작업 기록에 그대로 남는다 — 요약 칸에는 없다", () => {
    const result = build(
      planOf({
        lines: [
          line(KYOSAN_CAUSE_MARK_ORIGIN, "部品不良"),
          line(KYOSAN_ACTION_MARK_ORIGIN, "現品引取", "ACTIONS"),
        ],
      })
    );
    assert.deepEqual(
      result.workRecords.map((draft) => draft.recordKind),
      ["GENERAL"],
      "🔴 요약 칸으로 파생되는 기록을 만들면 안 된다"
    );
    const memo = memoOf(result, "GENERAL");
    assert.ok(memo.includes("[원인(○ 표시)]\n部品不良"), memo);
    assert.ok(memo.includes("[처치(○ 표시)]\n現品引取"), memo);
    // 🔴 넣지 않은 항목으로 세지도 않는다 — 넣었으니까.
    assert.deepEqual(result.skippedOrigins, []);
  });

  test("🔴 모르는 항목은 버리지 않고 「일반」 작업 기록으로 간다", () => {
    assert.equal(kyosanLineDestination(line("아직 없는 새 항목", "값")), "WORK_RECORD_GENERAL");
  });

  test("교체 부품 요약은 「진단/조치」로 간다 — 사용 부품 칸과 둘 다", () => {
    assert.equal(kyosanPartDestination(), "DIAGNOSIS_REPAIR_SUMMARY");
  });

  test("🔴 상세에 없는 레거시 칸을 가리키지 않는다", () => {
    const result = build(
      planOf({
        lines: [line("사내 확인 결과", "값-확인"), line("원인 상세", "값-원인상세")],
      })
    );
    // 상세가 읽는 것은 작업 기록의 파생값이다. 여기서 만드는 것도 작업 기록뿐이다.
    assert.deepEqual(
      result.workRecords.map((draft) => draft.recordKind),
      ["INTAKE_INSPECTION_RESULT", "DIAGNOSIS_REPAIR_SUMMARY"]
    );
    assert.equal(result.reportedSymptom, null);
  });
});

// ══════════════════════════════════════════════ 2. 원문 · 머리글

describe("🔴 원문을 고치지 않는다", () => {
  test("내용 줄은 한 글자도 안 바뀌고, 근거는 머리글 줄로 따로 붙는다", () => {
    const result = build(
      planOf({
        lines: [
          line("사내 확인 결과", "不具合内容 その１"),
          line("사내 확인 결과", "不具合内容 その２"),
          line("고장 부위", "電源基板"),
        ],
      })
    );

    assert.equal(
      memoOf(result, "INTAKE_INSPECTION_RESULT"),
      [
        KYOSAN_IMPORT_MARK,
        "",
        "[사내 확인 결과]",
        "不具合内容 その１",
        "不具合内容 その２",
        "",
        "[고장 부위]",
        "電源基板",
      ].join("\n")
    );
  });

  test("🔴 사람이 적은 기록과 구별되게 머리글이 맨 앞에 붙는다", () => {
    const result = build(planOf({ lines: [line("사내 확인 결과", "값")] }));
    assert.ok(memoOf(result, "INTAKE_INSPECTION_RESULT").startsWith(KYOSAN_IMPORT_MARK));
  });

  test("교체 부품은 고장분 · 예방분을 갈라 「진단/조치」 기록에 요약한다", () => {
    const result = build(
      planOf({
        parts: [
          { kind: "fault", text: "값-부품1" },
          { kind: "preventive", text: "값-부품2" },
        ],
      })
    );
    const memo = memoOf(result, "DIAGNOSIS_REPAIR_SUMMARY");
    assert.ok(memo.includes("[교체 부품(고장)]\n값-부품1"), memo);
    assert.ok(memo.includes("[교체 부품(예방)]\n값-부품2"), memo);
  });
});

// ══════════════════════════════════════════════ 3. 신고 증상 — 덮지 않는다

describe("🔴 신고 증상은 비어 있을 때만 채운다", () => {
  const plan = planOf({ lines: [line("고객 고장 상황", "값-고객이-말한-증상")] });

  test("비어 있으면 채운다", () => {
    const result = build(plan, null);
    assert.equal(result.reportedSymptom, `${KYOSAN_IMPORT_MARK}\n\n값-고객이-말한-증상`);
    assert.equal(result.symptomDivertedReason, null);
    assert.deepEqual(result.workRecords, []);
  });

  test("공백만 있는 칸도 비어 있는 것으로 본다", () => {
    assert.notEqual(build(plan, "  \n ").reportedSymptom, null);
  });

  test("🔴 값이 있으면 쓰지 않고, 그 내용을 「일반」 작업 기록으로 보낸다", () => {
    const result = build(plan, "사람이-적은-증상");
    assert.equal(result.reportedSymptom, null, "🔴 사람이 적은 글자를 덮으면 안 된다");
    assert.equal(result.symptomDivertedReason, "이미 값이 있음");

    const memo = memoOf(result, "GENERAL");
    assert.ok(memo.includes("[고객 고장 상황]"), memo);
    assert.ok(memo.includes("값-고객이-말한-증상"), "🔴 잃으면 안 된다");
  });

  test("🔴 4000자를 넘으면 칸 대신 작업 기록으로 간다 — 잘라 넣지 않는다", () => {
    const long = "가".repeat(KYOSAN_REPORTED_SYMPTOM_LIMIT + 10);
    const result = build(planOf({ lines: [line("고객 고장 상황", long)] }), null);
    assert.equal(result.reportedSymptom, null);
    assert.equal(result.symptomDivertedReason, "4000자를 넘음");
    assert.ok(
      result.workRecords.map((draft) => draft.memo).join("").includes("가".repeat(100)),
      "🔴 내용은 작업 기록으로 남아야 한다"
    );
  });

  test("고객 고장 상황이 아예 없으면 칸도 기록도 만들지 않는다", () => {
    const result = build(planOf(), null);
    assert.equal(result.reportedSymptom, null);
    assert.equal(result.symptomDivertedReason, null);
    assert.deepEqual(result.workRecords, []);
  });
});

// ══════════════════════════════════════════════ 4. 비고 — 넣지 않는다

describe("🔴 비고는 넣지 않되 조용히 버리지 않는다", () => {
  test("어느 기록에도 들어가지 않고, 넣지 않은 항목 이름이 돌아온다", () => {
    const result = build(planOf({ lines: [line("비고", "값-비고", "REMARK")] }));
    assert.deepEqual(result.workRecords, []);
    assert.deepEqual(result.skippedOrigins, ["비고"]);
  });

  test("🔴 돌려주는 것은 **항목 이름**뿐이다 — 값을 담지 않는다", () => {
    const result = build(planOf({ lines: [line("비고", "값-고객-내용", "REMARK")] }));
    assert.equal(result.skippedOrigins.join(" ").includes("값-고객-내용"), false);
  });
});

// ══════════════════════════════════════════════ 5. 4000자

describe("🔴 4000자를 말없이 자르지 않는다", () => {
  const long = `${"나".repeat(KYOSAN_MEMO_LIMIT * 2)}끝표시`;
  const result = build(planOf({ lines: [line("사내 확인 결과", long)] }));

  test("조각마다 상한 안이다", () => {
    assert.ok(result.workRecords.length > 1, "나뉘어야 한다");
    for (const draft of result.workRecords) {
      assert.ok(draft.memo.length <= KYOSAN_MEMO_LIMIT, `${draft.memo.length}자`);
    }
    assert.equal(result.didSplitForLength, true);
  });

  test("🔴 종류를 단 조각은 하나뿐이다 — 요약 칸이 뽑기가 되면 안 된다", () => {
    const kinds = result.workRecords.map((draft) => draft.recordKind);
    assert.equal(kinds.filter((kind) => kind === "INTAKE_INSPECTION_RESULT").length, 1);
    assert.equal(kinds[0], "INTAKE_INSPECTION_RESULT", "첫 조각이 종류를 단다");
    for (const kind of kinds.slice(1)) assert.equal(kind, "GENERAL");
  });

  test("🔴 한 글자도 잃지 않는다", () => {
    const joined = result.workRecords.map((draft) => draft.memo).join("");
    assert.equal((joined.match(/나/gu) ?? []).length, KYOSAN_MEMO_LIMIT * 2);
    assert.ok(joined.includes("끝표시"), "🔴 뒤쪽이 잘렸다");
  });

  test("조각마다 몇 번째인지 적는다 — 사람이 이어 읽을 수 있어야 한다", () => {
    const total = result.workRecords.length;
    result.workRecords.forEach((draft, index) => {
      assert.ok(draft.memo.startsWith(`${KYOSAN_IMPORT_MARK} (${index + 1}/${total})`), draft.memo.slice(0, 40));
    });
  });

  test("상한 안이면 나누지 않는다", () => {
    const small = build(planOf({ lines: [line("사내 확인 결과", "짧다")] }));
    assert.equal(small.workRecords.length, 1);
    assert.equal(small.didSplitForLength, false);
  });
});
