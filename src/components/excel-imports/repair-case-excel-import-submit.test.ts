import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  completeExcelImportPreviewNavigation,
  submitExcelImportPreview,
} from "./repair-case-excel-import-submit";

const file = new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04])], "preview.xlsx", {
  type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
});

describe("Excel Import Preview submission", () => {
  test("same-file lifecycle messages keep failed and partial batches distinct from completed", async () => {
    const cases = [
      ["COMPLETED", "이미 이관이 완료된 파일입니다."],
      ["PARTIAL_SUCCESS", "일부 행이 실패했습니다. 실패한 행만 재시도할 수 있습니다."],
      ["FAILED", "이관에 실패했습니다. 실패 원인을 확인한 뒤 다시 시도할 수 있습니다."],
      ["IMPORTING", "이관이 진행 중입니다."],
      ["READY", "동일한 파일의 기존 Preview가 있습니다."],
    ] as const;
    for (const [status, message] of cases) {
      const outcome = await submitExcelImportPreview({
        formData: new FormData(), mode: "normal", expired: null, parserRefresh: null,
        action: async () => ({ ok: true, outcome: "REUSED", batch: { batchId: "00000000-0000-4000-8000-000000000001", status, rowCounts: { total: 1, sourceReady: 1, sourceReview: 0 }, version: 1 } }),
      });
      assert.deepEqual(outcome, { kind: "EXISTING_BATCH", batchId: "00000000-0000-4000-8000-000000000001", status, message });
    }
  });
  test("refresh sends File, batch ID, expected version, and confirmation", async () => {
    const formData = new FormData();
    formData.set("file", file);
    const received: FormData[] = [];
    const outcome = await submitExcelImportPreview({
      formData,
      mode: "refresh",
      expired: null,
      parserRefresh: { batchId: "00000000-0000-4000-8000-000000000001", version: 6 },
      action: async (value) => {
        received.push(value);
        return {
          ok: true,
          outcome: "REFRESH",
          batch: {
            batchId: "00000000-0000-4000-8000-000000000001",
            status: "REVIEW_REQUIRED",
            rowCounts: { total: 1, sourceReady: 1, sourceReview: 0 },
            version: 7,
          },
        };
      },
    });
    assert.equal(outcome.kind, "SUCCESS");
    assert.equal(received.length, 1);
    assert.equal(received[0].get("file"), file);
    assert.equal(received[0].get("refreshExistingBatchId"), "00000000-0000-4000-8000-000000000001");
    assert.equal(received[0].get("expectedBatchVersion"), "6");
    assert.equal(received[0].get("confirmParserRefresh"), "true");
  });

  test("renders a stable action error without exposing server details", async () => {
    const outcome = await submitExcelImportPreview({
      formData: new FormData(),
      mode: "normal",
      expired: null,
      parserRefresh: null,
      action: async () => ({ ok: false, code: "BATCH_RESET_NOT_ALLOWED" }),
    });
    assert.deepEqual(outcome, {
      kind: "ERROR",
      issueCodes: [],
      message: "이 Preview에는 이미 이관 실행 흔적이 있어 다시 분석할 수 없습니다.",
    });
  });

  test("parser refresh confirmation warns that prior mapping choices are discarded", async () => {
    const outcome = await submitExcelImportPreview({
      formData: new FormData(),
      mode: "normal",
      expired: null,
      parserRefresh: null,
      action: async () => ({
        ok: false,
        code: "PARSER_REFRESH_REQUIRES_CONFIRMATION",
        batch: {
          batchId: "00000000-0000-4000-8000-000000000001",
          status: "REVIEW_REQUIRED",
          rowCounts: { total: 1, sourceReady: 0, sourceReview: 1 },
          version: 6,
        },
      }),
    });
    assert.equal(outcome.kind, "PARSER_REFRESH_CONFIRMATION");
    assert.match(outcome.message, /수동 매핑과 검토 선택은 폐기/);
  });

  test("turns rejected actions and transport failures into a safe message", async () => {
    const outcome = await submitExcelImportPreview({
      formData: new FormData(),
      mode: "normal",
      expired: null,
      parserRefresh: null,
      action: async () => {
        throw new Error("sensitive transport detail");
      },
    });
    assert.equal(outcome.kind, "ERROR");
    if (outcome.kind === "ERROR") {
      assert.equal(outcome.message.includes("sensitive transport detail"), false);
      assert.match(outcome.message, /서버와 통신/);
    }
  });

  test("success navigates to the batch and explicitly refreshes", async () => {
    const calls: string[] = [];
    const result = await completeExcelImportPreviewNavigation({
      batchId: "00000000-0000-4000-8000-000000000001",
      notice: "refresh",
      push: async (href) => {
        calls.push(`push:${href}`);
      },
      refresh: async () => {
        calls.push("refresh");
      },
    });
    assert.deepEqual(result, { ok: true });
    assert.deepEqual(calls, [
      "push:/excel-imports/repair-cases?batch=00000000-0000-4000-8000-000000000001&notice=refresh",
      "refresh",
    ]);
  });

  test("navigation failure returns an explicit completion warning", async () => {
    const result = await completeExcelImportPreviewNavigation({
      batchId: "00000000-0000-4000-8000-000000000001",
      notice: "refresh",
      push: async () => {
        throw new Error("navigation failed");
      },
      refresh: async () => undefined,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.message, /결과는 저장되었지만/);
  });
});
