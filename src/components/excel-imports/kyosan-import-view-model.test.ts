import { describe, test } from "node:test";
import assert from "node:assert/strict";
import type { KyosanRawRow } from "@/lib/domain/kyosan-intake-import/types";
import type {
  KyosanChunkRowResult,
  KyosanPreviewRow,
  KyosanPreviewStatus,
  KyosanRowPlan,
} from "@/lib/server/services/kyosan-intake-import";
import { REPAIR_CASE_XLSX_SAFETY_LIMITS } from "@/lib/xlsx/xlsx-upload-safety";
import {
  DEFAULT_KYOSAN_ROW_FILTER,
  KYOSAN_UPLOAD_MAX_BYTES,
  checkKyosanUploadFile,
  countKyosanBillingFlags,
  describeHeaderMismatch,
  describeKyosanFailure,
  describeKyosanNetworkFailure,
  filterKyosanPreviewRows,
  formatKstDate,
  formatKyosanRowNumbers,
  importableKyosanRowNumbers,
  isKyosanRunActive,
  kyosanImportConfirmLines,
  kyosanRunDoneMessage,
  kyosanRunProgress,
  nextKyosanChunk,
  paginateKyosanRows,
  pauseKyosanRun,
  recordKyosanChunkFailure,
  recordKyosanChunkSuccess,
  resumeKyosanRun,
  retryKyosanRun,
  settleKyosanPause,
  splitKyosanChunks,
  startKyosanRun,
  summarizeKyosanResults,
  type KyosanFailureInput,
  type KyosanRunState,
} from "./kyosan-import-view-model";

/**
 * ============================================================================
 * 과거 인수품 가져오기 — 화면의 판단
 * ============================================================================
 * 화면은 서버 액션을 불러 그릴 수 없으므로(`server-only`), 조각을 어떻게 나누고 언제 멈추고
 * 무엇을 다시 보내는지를 여기서 순수 함수로 붙잡는다.
 * ============================================================================
 */

const range = (count: number, start = 18) => Array.from({ length: count }, (_, index) => start + index);

function raw(rowNumber: number, overrides: Partial<KyosanRawRow> = {}): KyosanRawRow {
  return {
    rowNumber,
    intakeNumber: `K${rowNumber}`,
    receivedAt: "2025-04-01",
    modelName: "RF-100",
    kindText: "マッチャー",
    lotNumber: null,
    serialNumber: `SN${rowNumber}`,
    customerName: "교산전기",
    endUserName: null,
    reportedSymptom: null,
    statusText: "出荷済み",
    shippedAt: "2025-05-01",
    reportNumber: null,
    billingText: "有償",
    ...overrides,
  };
}

function plan(overrides: Partial<KyosanRowPlan> = {}): KyosanRowPlan {
  return {
    workflowKind: "MATCHER",
    billingType: "PAID",
    workflowType: "PAID_MATCHER",
    targetStepKey: "shipment_completed",
    actualShipmentDate: "2025-05-01",
    billingReview: false,
    billingAdjustment: null,
    sourceBilling: "有償",
    customer: { kind: "EXISTING", id: "c1", name: "교산전기" },
    endUser: null,
    productModel: { kind: "EXISTING", id: "m1", name: "RF-100" },
    ...overrides,
  };
}

function row(rowNumber: number, status: KyosanPreviewStatus, extra: Partial<KyosanPreviewRow> = {}): KyosanPreviewRow {
  return {
    rowNumber,
    raw: raw(rowNumber),
    status,
    reasons: [],
    warnings: [],
    plan: status === "IMPORTABLE" ? plan() : null,
    existing: null,
    ...extra,
  };
}

function created(rowNumbers: readonly number[]): KyosanChunkRowResult[] {
  return rowNumbers.map((rowNumber) => ({
    rowNumber,
    outcome: "CREATED",
    repairCaseId: `r${rowNumber}`,
    intakeNumber: `K${rowNumber}`,
  }));
}

/** 지금 조각을 성공으로 적는다. */
function succeed(state: KyosanRunState): KyosanRunState {
  const chunk = nextKyosanChunk(state);
  assert.ok(chunk, "보낼 조각이 없다");
  return recordKyosanChunkSuccess(state, created(chunk));
}

// ───────────────────────────── 올리기

describe("올리기 — 화면에서 먼저 막는다", () => {
  test("🔴 20MB 한도가 서버의 xlsx 안전 검사 한도와 같다", () => {
    assert.equal(KYOSAN_UPLOAD_MAX_BYTES, REPAIR_CASE_XLSX_SAFETY_LIMITS.maxCompressedBytes);
  });

  test(".xlsx 만 · 빈 파일 · 20MB 초과", () => {
    assert.equal(checkKyosanUploadFile({ name: "list.xlsx", size: 1_000 }), null);
    assert.equal(checkKyosanUploadFile({ name: "LIST.XLSX", size: KYOSAN_UPLOAD_MAX_BYTES }), null);
    assert.equal(checkKyosanUploadFile({ name: "list.xls", size: 1_000 }), ".xlsx 파일만 올릴 수 있습니다.");
    assert.equal(checkKyosanUploadFile({ name: "list.xlsx.csv", size: 1_000 }), ".xlsx 파일만 올릴 수 있습니다.");
    assert.equal(checkKyosanUploadFile({ name: "list.xlsx", size: 0 }), "빈 파일입니다.");
    assert.equal(
      checkKyosanUploadFile({ name: "list.xlsx", size: KYOSAN_UPLOAD_MAX_BYTES + 1 }),
      "20MB 이하의 .xlsx 파일만 올릴 수 있습니다."
    );
  });
});

// ───────────────────────────── 조각 나누기

describe("조각 나누기", () => {
  test("🔴 25줄씩 — 마지막 조각은 남은 줄만, 빠지거나 겹치는 줄이 없다", () => {
    const chunks = splitKyosanChunks(range(60), 25);
    assert.deepEqual(
      chunks.map((chunk) => chunk.length),
      [25, 25, 10]
    );
    assert.deepEqual(chunks[2], range(10, 68));
    assert.deepEqual(chunks.flat(), range(60));
  });

  test("딱 나누어떨어지면 빈 조각이 없다 · 줄이 없으면 조각도 없다", () => {
    assert.deepEqual(
      splitKyosanChunks(range(50), 25).map((chunk) => chunk.length),
      [25, 25]
    );
    assert.deepEqual(splitKyosanChunks([], 25), []);
  });

  test("🔴 조각 크기가 이상하면 25로, 서버 상한 50을 넘지 않는다", () => {
    for (const size of [0, -3, 2.5, Number.NaN]) {
      assert.deepEqual(
        splitKyosanChunks(range(30), size).map((chunk) => chunk.length),
        [25, 5],
        String(size)
      );
    }
    assert.deepEqual(
      splitKyosanChunks(range(120), 80).map((chunk) => chunk.length),
      [50, 50, 20]
    );
  });

  test("🔴 가져올 줄의 행 번호만 · 행 번호 순", () => {
    const rows = [
      row(30, "IMPORTABLE"),
      row(18, "NEEDS_REVIEW"),
      row(19, "IMPORTABLE"),
      row(20, "ALREADY_EXISTS"),
      row(21, "ALREADY_EXISTS_TRASHED"),
      row(22, "EXCLUDED"),
    ];
    assert.deepEqual(importableKyosanRowNumbers(rows), [19, 30]);
  });

  test("확인 창 문구 — 몇 건 · 조각 크기 · 되돌리려면 건마다 휴지통", () => {
    const lines = kyosanImportConfirmLines(512, 25);
    assert.equal(lines[0], "수리 건 512건을 새로 만듭니다.");
    assert.ok(lines[1].includes("25줄씩 차례로"), lines[1]);
    assert.ok(lines.some((line) => line.includes("하나씩 휴지통으로")), lines.join("\n"));
  });
});

// ───────────────────────────── 가져오기 흐름

describe("가져오기 흐름", () => {
  test("시작하면 첫 조각부터 · 조각마다 다음으로 · 마지막 조각 뒤 끝", () => {
    let state = startKyosanRun(range(60), 25);
    assert.equal(state.phase, "running");
    assert.deepEqual(nextKyosanChunk(state), range(25));

    state = succeed(state);
    assert.equal(state.phase, "running");
    assert.deepEqual(nextKyosanChunk(state), range(25, 43));

    state = succeed(state);
    assert.deepEqual(nextKyosanChunk(state), range(10, 68));
    state = succeed(state);
    assert.equal(state.phase, "done");
    assert.equal(nextKyosanChunk(state), null);
    assert.equal(state.results.length, 60);
  });

  test("가져올 줄이 없으면 바로 끝", () => {
    const state = startKyosanRun([], 25);
    assert.equal(state.phase, "done");
    assert.equal(nextKyosanChunk(state), null);
  });

  test("🔴 [멈춤]은 보내는 조각을 끝낸 뒤 멈추고, [이어서]는 다음 조각부터", () => {
    let state = startKyosanRun(range(60), 25);
    state = pauseKyosanRun(state);
    assert.equal(state.phase, "pausing");
    assert.equal(isKyosanRunActive(state), true, "멈추는 중에도 조각이 가고 있다");
    // 보내던 조각의 답이 오면 멈춘다.
    state = succeed(state);
    assert.equal(state.phase, "paused");
    assert.equal(isKyosanRunActive(state), false);
    assert.deepEqual(nextKyosanChunk(state), range(25, 43), "멈춘 뒤 다음 조각이 바뀌었다");

    state = resumeKyosanRun(state);
    assert.equal(state.phase, "running");
    assert.deepEqual(nextKyosanChunk(state), range(25, 43), "이어서 보낼 조각이 다음 조각이 아니다");
    state = succeed(succeed(state));
    assert.equal(state.phase, "done");
    assert.deepEqual(
      state.results.map((result) => result.rowNumber),
      range(60)
    );
  });

  test("멈추는 중에 [계속]을 누르면 멈춤을 거둔다 · 조각 사이면 멈춤으로 굳힌다", () => {
    const pausing = pauseKyosanRun(startKyosanRun(range(60), 25));
    assert.equal(resumeKyosanRun(pausing).phase, "running");
    assert.equal(settleKyosanPause(pausing).phase, "paused");
    const running = startKyosanRun(range(60), 25);
    assert.equal(settleKyosanPause(running), running);
    // 이미 끝났으면 멈춤도 이어서도 아무것도 하지 않는다.
    const done = startKyosanRun([], 25);
    assert.equal(pauseKyosanRun(done), done);
    assert.equal(resumeKyosanRun(done), done);
  });

  test("🔴 조각이 실패하면 차례를 그대로 두어 [다시 시도]가 같은 조각을 보낸다", () => {
    let state = succeed(startKyosanRun(range(60), 25));
    state = recordKyosanChunkFailure(state, describeKyosanNetworkFailure());
    assert.equal(state.phase, "failed");
    assert.equal(isKyosanRunActive(state), false);
    assert.deepEqual(nextKyosanChunk(state), range(25, 43));
    assert.equal(kyosanRunProgress(state).sentRows, 25, "실패한 조각을 보낸 것으로 셌다");

    state = retryKyosanRun(state);
    assert.equal(state.phase, "running");
    assert.equal(state.failure, null);
    assert.deepEqual(nextKyosanChunk(state), range(25, 43), "다시 시도가 다른 조각을 보낸다");
  });

  test("🔴 다시 보내면 안 되는 실패(파일 바뀜 등)는 [다시 시도]가 아무것도 하지 않는다", () => {
    const failed = recordKyosanChunkFailure(
      startKyosanRun(range(60), 25),
      describeKyosanFailure({ ok: false, code: "FILE_CHANGED", message: "다릅니다." })
    );
    assert.equal(retryKyosanRun(failed), failed);
    // 실패하지 않았으면 다시 시도할 것도 없다.
    const running = startKyosanRun(range(60), 25);
    assert.equal(retryKyosanRun(running), running);
  });

  test("🔴 같은 줄의 결과가 다시 오면 나중 것이 이긴다 — 두 번 세지 않는다", () => {
    let state = startKyosanRun(range(3), 25);
    state = recordKyosanChunkSuccess(state, [
      { rowNumber: 18, outcome: "CREATED", repairCaseId: "r18", intakeNumber: "K18" },
      { rowNumber: 18, outcome: "CREATED", repairCaseId: "r18", intakeNumber: "K18", message: "이 가져오기에서 이미 만든 건입니다." },
      { rowNumber: 19, outcome: "FAILED", intakeNumber: "K19", message: "실패" },
    ]);
    assert.equal(state.results.length, 2);
    assert.equal(state.results[0].message, "이 가져오기에서 이미 만든 건입니다.");
  });

  test("조각을 보내는 중인가 — running · pausing 만", () => {
    assert.equal(isKyosanRunActive(null), false);
    const running = startKyosanRun(range(30), 25);
    assert.equal(isKyosanRunActive(running), true);
    assert.equal(isKyosanRunActive(pauseKyosanRun(running)), true);
    assert.equal(isKyosanRunActive(settleKyosanPause(pauseKyosanRun(running))), false);
    assert.equal(isKyosanRunActive(recordKyosanChunkFailure(running, describeKyosanNetworkFailure())), false);
    assert.equal(isKyosanRunActive(succeed(succeed(running))), false);
  });
});

// ───────────────────────────── 진행률

describe("진행률", () => {
  test("🔴 보낸 줄 / 전체 — 끝난 조각만 센다", () => {
    let state = startKyosanRun(range(60), 25);
    assert.deepEqual(kyosanRunProgress(state), { sentRows: 0, totalRows: 60, percent: 0, sentChunks: 0, totalChunks: 3 });
    state = succeed(state);
    assert.deepEqual(kyosanRunProgress(state), { sentRows: 25, totalRows: 60, percent: 41, sentChunks: 1, totalChunks: 3 });
    state = succeed(state);
    assert.deepEqual(kyosanRunProgress(state), { sentRows: 50, totalRows: 60, percent: 83, sentChunks: 2, totalChunks: 3 });
    state = succeed(state);
    assert.deepEqual(kyosanRunProgress(state), { sentRows: 60, totalRows: 60, percent: 100, sentChunks: 3, totalChunks: 3 });
  });

  test("줄이 없으면 100%", () => {
    assert.equal(kyosanRunProgress(startKyosanRun([], 25)).percent, 100);
  });
});

// ───────────────────────────── 결과

describe("결과 합계", () => {
  const results: KyosanChunkRowResult[] = [
    { rowNumber: 22, outcome: "FAILED", intakeNumber: "K22", message: "고객사 이름이 너무 깁니다." },
    { rowNumber: 18, outcome: "CREATED", repairCaseId: "r18", intakeNumber: "K18" },
    { rowNumber: 21, outcome: "SKIPPED", intakeNumber: "K21", message: "가져올 수 없는 줄입니다." },
    { rowNumber: 20, outcome: "ALREADY_EXISTS", repairCaseId: "r20", intakeNumber: "K20", message: "이미 있습니다." },
    { rowNumber: 19, outcome: "CREATED", repairCaseId: "r19", intakeNumber: "K19" },
  ];

  test("🔴 결과를 네 묶음으로 · 행 번호 순 · 합계", () => {
    const summary = summarizeKyosanResults(results);
    assert.deepEqual(
      summary.created.map((result) => result.rowNumber),
      [18, 19]
    );
    assert.deepEqual(
      summary.alreadyExists.map((result) => result.rowNumber),
      [20]
    );
    assert.deepEqual(
      summary.skipped.map((result) => result.rowNumber),
      [21]
    );
    assert.deepEqual(
      summary.failed.map((result) => result.rowNumber),
      [22]
    );
    assert.equal(summary.total, 5);
  });

  test("끝난 뒤 팝업 문구 — 만든 건수, 나머지가 있으면 결과를 보라고", () => {
    assert.equal(
      kyosanRunDoneMessage(summarizeKyosanResults(results)),
      "수리 건 2건을 만들었습니다(나머지 3건은 결과를 확인해 주세요)."
    );
    assert.equal(kyosanRunDoneMessage(summarizeKyosanResults(created([18, 19, 20]))), "수리 건 3건을 만들었습니다.");
  });
});

// ───────────────────────────── 실패 문장

describe("실패 코드 → 문장", () => {
  test("🔴 머리글 불일치는 「어느 열이 무엇이어야 하는데 무엇이었다」 목록", () => {
    const text = describeKyosanFailure({
      ok: false,
      code: "INVALID_FILE",
      message: "머리글이 양식과 다릅니다.",
      parseFailureCode: "HEADER_MISMATCH",
      mismatches: [
        { column: "G", expected: "種別", actual: "種類" },
        { column: "S", expected: "出荷日", actual: null },
      ],
    });
    assert.equal(text.title, "파일을 읽을 수 없습니다.");
    assert.deepEqual(text.lines, [
      "G열 머리글은 「種別」이어야 하는데 「種類」였습니다.",
      "S열 머리글은 「出荷日」이어야 하는데 비어 있었습니다.",
    ]);
    assert.ok(text.detail?.startsWith("머리글이 양식과 다릅니다."), text.detail ?? "");
    assert.ok(text.detail?.includes("원래 양식대로"), text.detail ?? "");
    assert.equal(text.retryable, false);
    assert.equal(describeHeaderMismatch({ column: "C", expected: "引取番号", actual: "番号" }), "C열 머리글은 「引取番号」이어야 하는데 「番号」였습니다.");
  });

  test("안전 검사에 걸린 항목은 사람 말로 늘어놓는다", () => {
    const text = describeKyosanFailure({
      ok: false,
      code: "INVALID_FILE",
      message: "안전하지 않은 파일입니다.",
      parseFailureCode: "UNSAFE_FILE",
      safetyCodes: ["MACRO_CONTENT_DETECTED", "HYPERLINK_PRESENT"],
    });
    assert.deepEqual(text.lines, ["매크로가 들어 있습니다.", "하이퍼링크가 들어 있습니다."]);
    assert.ok(text.detail?.includes("안전 검사에 걸렸습니다"), text.detail ?? "");
  });

  test("코드마다 제목이 있고, 서버 문구가 필요한 곳은 싣는다", () => {
    const cases: [KyosanFailureInput, string, string | null][] = [
      [{ ok: false, code: "UNAUTHORIZED", message: "로그인이 필요합니다." }, "로그인이 필요합니다.", "다시 로그인"],
      [{ ok: false, code: "FORBIDDEN", message: "과거 인수품을 가져올 권한이 없습니다." }, "가져올 수 없습니다.", "과거 인수품을 가져올 권한이 없습니다."],
      [{ ok: false, code: "VALIDATION_ERROR", message: "실행 정보를 확인할 수 없습니다." }, "요청을 처리할 수 없습니다.", "실행 정보를 확인할 수 없습니다."],
      [{ ok: false, code: "FILE_CHANGED", message: "다릅니다." }, "올린 파일이 미리보기 때의 파일과 다릅니다.", "미리보기부터 다시"],
      [{ ok: false, code: "TOO_MANY_ROWS", message: "한 번에 50줄까지 실행할 수 있습니다(받은 줄: 60)." }, "한 번에 보낸 줄이 너무 많습니다.", "50줄까지"],
      [{ ok: false, code: "DATABASE_UNAVAILABLE", message: "일시적으로 처리할 수 없습니다." }, "일시적으로 처리할 수 없습니다.", "다시 시도"],
    ];
    for (const [failure, title, detailPart] of cases) {
      const text = describeKyosanFailure(failure);
      assert.equal(text.title, title, failure.code);
      if (detailPart) assert.ok(text.detail?.includes(detailPart), `${failure.code}: ${text.detail}`);
    }
  });

  test("🔴 [다시 시도]는 네트워크 · DB 일시 오류만", () => {
    for (const code of ["UNAUTHORIZED", "FORBIDDEN", "VALIDATION_ERROR", "INVALID_FILE", "FILE_CHANGED", "TOO_MANY_ROWS", "DATABASE_UNAVAILABLE"] as const) {
      assert.equal(describeKyosanFailure({ ok: false, code, message: "x" }).retryable, code === "DATABASE_UNAVAILABLE", code);
    }
    const network = describeKyosanNetworkFailure();
    assert.equal(network.retryable, true);
    assert.ok(network.detail?.includes("두 번 만들지 않습니다"), network.detail ?? "");
  });
});

// ───────────────────────────── 거르기 · 쪽 나누기

describe("거르기 · 쪽 나누기", () => {
  const rows = [
    row(18, "IMPORTABLE"),
    row(19, "EXCLUDED"),
    row(20, "NEEDS_REVIEW"),
    row(21, "ALREADY_EXISTS_TRASHED"),
    row(22, "IMPORTABLE", { plan: plan({ billingReview: true, sourceBilling: null }) }),
    row(23, "ALREADY_EXISTS"),
    row(24, "NEEDS_REVIEW"),
    row(25, "IMPORTABLE", { plan: plan({ billingType: "PARTIAL_PAID", billingAdjustment: "WARRANTY_PO_TO_PARTIAL_PAID" }) }),
  ];

  test("🔴 기본은 「전체」이고, 확인 필요가 먼저 보인다 — 같은 상태 안에서는 행 번호 순", () => {
    assert.equal(DEFAULT_KYOSAN_ROW_FILTER, "ALL");
    assert.deepEqual(
      filterKyosanPreviewRows(rows, "ALL").map((item) => item.rowNumber),
      [20, 24, 23, 21, 18, 22, 25, 19]
    );
  });

  test("상태로 거르면 그 상태만 행 번호 순", () => {
    assert.deepEqual(
      filterKyosanPreviewRows(rows, "IMPORTABLE").map((item) => item.rowNumber),
      [18, 22, 25]
    );
    assert.deepEqual(
      filterKyosanPreviewRows(rows, "ALREADY_EXISTS").map((item) => item.rowNumber),
      [23]
    );
    assert.deepEqual(
      filterKyosanPreviewRows(rows, "ALREADY_EXISTS_TRASHED").map((item) => item.rowNumber),
      [21]
    );
  });

  test("가져올 것 중 「유/무상 확인 필요」 · 「일부 유상으로 바뀜」 — 거르기와 건수", () => {
    assert.deepEqual(
      filterKyosanPreviewRows(rows, "BILLING_REVIEW").map((item) => item.rowNumber),
      [22]
    );
    assert.deepEqual(
      filterKyosanPreviewRows(rows, "BILLING_ADJUSTED").map((item) => item.rowNumber),
      [25]
    );
    assert.deepEqual(countKyosanBillingFlags(rows), { billingReview: 1, billingAdjusted: 1 });
    // 가져올 줄이 아니면 세지 않는다.
    assert.deepEqual(countKyosanBillingFlags([row(30, "NEEDS_REVIEW", { plan: plan({ billingReview: true }) })]), {
      billingReview: 0,
      billingAdjusted: 0,
    });
  });

  test("쪽 나누기 — 범위를 벗어난 쪽은 끝으로 당긴다", () => {
    const items = range(120);
    const last = paginateKyosanRows(items, 3, 50);
    assert.equal(last.totalPages, 3);
    assert.deepEqual(last.rows, range(20, 118));
    assert.equal(paginateKyosanRows(items, 9, 50).page, 3);
    assert.equal(paginateKyosanRows(items, 0, 50).page, 1);
    assert.deepEqual(paginateKyosanRows([], 1, 50), { rows: [], page: 1, totalPages: 1 });
  });

  test("행 번호 목록 · 한국 날짜", () => {
    assert.equal(formatKyosanRowNumbers([18, 19, 20]), "18, 19, 20");
    assert.equal(formatKyosanRowNumbers(range(12)), "18, 19, 20, 21, 22, 23, 24, 25, 26, 27 외 2줄");
    assert.equal(formatKstDate("2026-09-14T16:30:00.000Z"), "2026-09-15");
    assert.equal(formatKstDate("not-a-date"), "not-a-date");
  });
});
