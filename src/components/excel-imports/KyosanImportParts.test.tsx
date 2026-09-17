import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import type { ImportedCaseNeedingBillingReview } from "@/lib/db/queries/kyosan-intake-import";
import type { KyosanRawRow } from "@/lib/domain/kyosan-intake-import/types";
import type {
  KyosanChunkRowResult,
  KyosanExistingCaseView,
  KyosanNewNames,
  KyosanPreviewRow,
  KyosanPreviewStatus,
  KyosanRowPlan,
} from "@/lib/server/services/kyosan-intake-import";
import {
  KyosanCountCards,
  KyosanFailureNotice,
  KyosanNewNamesPanel,
  KyosanPreviewTable,
} from "./KyosanImportPreviewParts";
import {
  KyosanBillingReviewList,
  KyosanImportBar,
  KyosanImportConfirmDialogView,
  KyosanImportProgressView,
  KyosanImportResultView,
  KyosanUploadPanel,
} from "./KyosanImportRunParts";
import {
  describeKyosanFailure,
  describeKyosanNetworkFailure,
  nextKyosanChunk,
  pauseKyosanRun,
  recordKyosanChunkFailure,
  recordKyosanChunkSuccess,
  settleKyosanPause,
  startKyosanRun,
  summarizeKyosanResults,
  type KyosanRunState,
} from "./kyosan-import-view-model";

/**
 * ============================================================================
 * 과거 인수품 가져오기 — 무엇이 그려지는가
 * ============================================================================
 * KyosanIntakeImportScreen 은 서버 액션을 부르고 그 사슬 끝에 `server-only` 가 있어 이
 * 시험 환경에서 통째로 그릴 수 없다. 그리기만 하는 조각(KyosanImport*Parts.tsx)을 따로
 * 그려 보고, 화면이 서버를 어떻게 부르는지는 원본을 읽어 확인한다
 * (UserDeletionParts.test.tsx 와 같은 방식).
 * ============================================================================
 */

const noop = () => {};
const render = (element: React.ReactElement) => renderToStaticMarkup(element);

function raw(rowNumber: number, overrides: Partial<KyosanRawRow> = {}): KyosanRawRow {
  return {
    rowNumber,
    intakeNumber: `K${rowNumber}`,
    receivedAt: "2025-04-01",
    modelName: "RF-100",
    kindText: "マッチャー",
    lotNumber: "L7",
    serialNumber: `SN${rowNumber}`,
    customerName: "교산전기",
    endUserName: "라인A",
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
    reportedSymptom: null,
    customer: { kind: "EXISTING", id: "c1", name: "교산전기" },
    endUser: null,
    productModel: { kind: "EXISTING", id: "m1", name: "RF-100" },
    ...overrides,
  };
}

function existing(overrides: Partial<KyosanExistingCaseView> = {}): KyosanExistingCaseView {
  return {
    repairCaseId: "case-live",
    intakeNumber: "K20",
    trashed: false,
    customerName: "교산전기",
    modelName: "RF-100",
    serialNumber: "SN20",
    looksDifferent: false,
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

/** `data-row="N"` 인 표 줄 한 개. */
function tableRow(html: string, rowNumber: number): string {
  const match = html.match(new RegExp(`<tr[^>]*data-row="${rowNumber}"[\\s\\S]*?</tr>`));
  assert.ok(match, `${rowNumber}행이 없다: ${html}`);
  return match[0];
}

function openTag(html: string, pattern: RegExp): string {
  const match = html.match(pattern);
  assert.ok(match, `태그가 없다(${pattern}): ${html}`);
  return match[0];
}

// ───────────────────────────── 건수 카드

describe("건수 카드", () => {
  const counts = { total: 12, IMPORTABLE: 5, ALREADY_EXISTS: 2, ALREADY_EXISTS_TRASHED: 1, EXCLUDED: 1, NEEDS_REVIEW: 3 };

  function card(html: string, filter: string): { tag: string; inner: string } {
    const match = html.match(new RegExp(`(<button[^>]*data-filter="${filter}"[^>]*>)([\\s\\S]*?)</button>`));
    assert.ok(match, `${filter} 카드가 없다: ${html}`);
    return { tag: match[1], inner: match[2] };
  }

  test("🔴 다섯 상태 · 전체 · 가져올 것 중 유/무상 확인 필요 · 일부 유상으로 바뀜", () => {
    const html = render(
      <KyosanCountCards counts={counts} billing={{ billingReview: 2, billingAdjusted: 4 }} filter="ALL" onFilterChange={noop} />
    );
    const expected: [string, string, number][] = [
      ["ALL", "전체", 12],
      ["IMPORTABLE", "가져올 것", 5],
      ["ALREADY_EXISTS", "이미 있음", 2],
      ["ALREADY_EXISTS_TRASHED", "이미 있음(휴지통)", 1],
      ["EXCLUDED", "제외", 1],
      ["NEEDS_REVIEW", "확인 필요", 3],
      ["BILLING_REVIEW", "가져올 것 중 유/무상 확인 필요", 2],
      ["BILLING_ADJUSTED", "가져올 것 중 일부 유상으로 바뀜", 4],
    ];
    for (const [filter, label, value] of expected) {
      const { inner } = card(html, filter);
      assert.ok(inner.includes(`>${label}<`), `${filter}: ${inner}`);
      assert.ok(inner.includes(`>${value}<`), `${filter}: ${inner}`);
    }
    assert.equal((html.match(/data-filter="/g) ?? []).length, 8);
  });

  test("누른 카드가 켜진다 · 확인 필요가 있으면 눈에 띄는 색", () => {
    const html = render(
      <KyosanCountCards counts={counts} billing={{ billingReview: 0, billingAdjusted: 0 }} filter="NEEDS_REVIEW" onFilterChange={noop} />
    );
    assert.ok(card(html, "NEEDS_REVIEW").tag.includes('aria-pressed="true"'), html);
    assert.ok(card(html, "ALL").tag.includes('aria-pressed="false"'), html);
    assert.ok(card(html, "NEEDS_REVIEW").inner.includes("text-amber-700"), "확인 필요 수가 눈에 띄지 않는다");
    assert.ok(!card(html, "BILLING_REVIEW").inner.includes("text-amber-700"), "0 인데 칠했다");
  });
});

// ───────────────────────────── 줄 표

describe("줄 표", () => {
  test("🔴 이미 있음 — 기존 건과 나란히, 다른 건으로 보이면 줄까지 칠한다", () => {
    const html = render(
      <KyosanPreviewTable
        rows={[
          row(20, "ALREADY_EXISTS", {
            reasons: ["인수번호 K20 인 건이 이미 있습니다 — 가져오지 않습니다(덮어쓰지 않습니다)."],
            existing: existing({ customerName: "다른회사", serialNumber: "SN999", looksDifferent: true }),
          }),
          row(21, "ALREADY_EXISTS", { existing: existing({ repairCaseId: "case-same", intakeNumber: "K21", serialNumber: "SN21" }) }),
        ]}
      />
    );
    const different = tableRow(html, 20);
    assert.ok(different.includes('data-looks-different="true"'), different);
    assert.ok(different.includes("bg-red-50"), "줄이 칠해지지 않았다");
    assert.ok(different.includes("다른 건으로 보임"), different);
    // 파일과 기존 건의 값이 나란히.
    assert.ok(different.includes(">교산전기<") && different.includes(">다른회사<"), different);
    assert.ok(different.includes(">SN20<") && different.includes(">SN999<"), different);
    assert.ok(different.includes("덮어쓰지 않습니다"), "사유가 없다");

    const same = tableRow(html, 21);
    assert.ok(!same.includes("다른 건으로 보임"), same);
    assert.ok(!same.includes("data-looks-different"), same);
  });

  test("🔴 살아 있는 기존 건은 상세 링크, 휴지통 건은 휴지통 링크 + 복원 또는 완전 삭제 안내", () => {
    const html = render(
      <KyosanPreviewTable
        rows={[
          row(20, "ALREADY_EXISTS", { existing: existing() }),
          row(21, "ALREADY_EXISTS_TRASHED", {
            existing: existing({ repairCaseId: "case-trashed", intakeNumber: "K21", trashed: true, serialNumber: "SN21" }),
          }),
        ]}
      />
    );
    const live = tableRow(html, 20);
    assert.ok(live.includes('href="/repair-cases/case-live"'), live);
    assert.ok(live.includes("기존 건 K20 열기"), live);

    const trashed = tableRow(html, 21);
    assert.ok(trashed.includes('href="/repair-cases"'), trashed);
    assert.ok(!trashed.includes("/repair-cases/case-trashed"), "휴지통 건을 상세로 보낸다");
    assert.ok(trashed.includes("휴지통 탭"), trashed);
    assert.ok(trashed.includes("복원 또는 완전 삭제 후 다시 가져오기"), trashed);
    assert.ok(trashed.includes("기존 건(휴지통)"), trashed);
    assert.ok(trashed.includes(">이미 있음(휴지통)<"), trashed);
  });

  test("가져올 줄은 무엇이 되는지 — 절차 종류 · 절차 · 유무상 · 목표 단계 · 출하일 · 새로 생길 이름", () => {
    const html = render(
      <KyosanPreviewTable
        rows={[
          row(18, "IMPORTABLE", {
            plan: plan({ customer: { kind: "NEW", name: "새고객" }, productModel: { kind: "NEW", name: "RF-900" } }),
            warnings: ["인수일과 인수번호의 연월이 다릅니다."],
          }),
          row(19, "IMPORTABLE", {
            plan: plan({ billingReview: true, sourceBilling: null, targetStepKey: "repair_in_progress", actualShipmentDate: null }),
          }),
          row(22, "IMPORTABLE", {
            plan: plan({
              workflowKind: "GENERATOR",
              workflowType: "PAID_GENERATOR",
              billingType: "PARTIAL_PAID",
              billingAdjustment: "WARRANTY_PO_TO_PARTIAL_PAID",
              sourceBilling: "無償",
            }),
          }),
        ]}
      />
    );
    const first = tableRow(html, 18);
    assert.ok(first.includes("매쳐 · 유상 Matcher · 유상"), first);
    assert.ok(first.includes(">shipment_completed<"), first);
    assert.ok(first.includes("출하일 2025-05-01"), first);
    assert.ok(first.includes("새로 생김: 고객사 「새고객」 · 모델 「RF-900」"), first);
    assert.ok(first.includes("주의: 인수일과 인수번호의 연월이 다릅니다."), first);
    assert.ok(first.includes(">가져올 것<"), first);

    const second = tableRow(html, 19);
    assert.ok(second.includes("유/무상 확인 필요 — 원본 費用: 비어 있음"), second);
    assert.ok(!second.includes("출하일 "), second);

    const third = tableRow(html, 22);
    assert.ok(third.includes("제너레이터 · 유상 Generator · 일부유상"), third);
    assert.ok(third.includes("일부 유상으로 바뀜"), third);
  });

  test("확인 필요 · 제외 줄은 사유와 원문을 보인다", () => {
    const html = render(
      <KyosanPreviewTable
        rows={[
          row(30, "NEEDS_REVIEW", { reasons: ["인수일(D열)을 읽을 수 없습니다: 「2025/13/40」"], raw: raw(30, { statusText: "修理中" }) }),
          row(31, "EXCLUDED", { reasons: ["상태가 キャンセル 인 줄은 가져오지 않습니다."] }),
        ]}
      />
    );
    const review = tableRow(html, 30);
    assert.ok(review.includes("인수일(D열)을 읽을 수 없습니다"), review);
    assert.ok(review.includes(">修理中<"), review);
    assert.ok(review.includes("text-amber-700"), "확인 필요 사유가 눈에 띄지 않는다");
    assert.ok(review.includes(">K30<") && review.includes("End-User 라인A") && review.includes("S/N SN30 · L/N L7"), review);
    assert.ok(tableRow(html, 31).includes("キャンセル"), html);
  });

  /** 「원본 상태 · 費用 · 신고증상」 칸의 신고증상 줄 하나. */
  function symptomLine(html: string, rowNumber: number): string {
    const match = tableRow(html, rowNumber).match(/<div data-role="reported-symptom"[^>]*>([\s\S]*?)<\/div>/);
    assert.ok(match, `${rowNumber}행에 신고증상 줄이 없다`);
    return match[1];
  }

  test("🔴 신고증상 — 바뀐 값과 원문을 함께, 안 달라진 줄엔 화살표가 없다 · plan 이 없어도 그린다", () => {
    const html = render(
      <KyosanPreviewTable
        rows={[
          row(40, "IMPORTABLE", {
            raw: raw(40, { reportedSymptom: "FWDノイズ発生" }),
            plan: plan({ reportedSymptom: "FWD 노이즈 발생" }),
          }),
          row(41, "IMPORTABLE", {
            raw: raw(41, { reportedSymptom: "출력이 나오지 않음" }),
            plan: plan({ reportedSymptom: "출력이 나오지 않음" }),
          }),
          row(42, "EXCLUDED", { raw: raw(42, { reportedSymptom: "異常なし" }) }),
          row(43, "IMPORTABLE", { raw: raw(43, { reportedSymptom: null }), plan: plan({ reportedSymptom: null }) }),
        ]}
      />
    );
    assert.ok(html.includes("원본 상태 · 費用 · 신고증상"), "머리글이 신고증상을 말하지 않는다");

    const changed = symptomLine(html, 40);
    assert.ok(changed.includes("FWDノイズ発生") && changed.includes("FWD 노이즈 발생"), changed);
    assert.ok(changed.includes("→"), "바뀐 줄인데 원문 → 바뀐 값 화살표가 없다");

    const same = symptomLine(html, 41);
    assert.ok(same.includes("출력이 나오지 않음"), same);
    assert.ok(!same.includes("→"), "안 달라진 줄에 화살표가 떴다");

    // 🔴 plan 이 없는 줄(제외)에서도 터지지 않고 원문만 보인다.
    const excluded = symptomLine(html, 42);
    assert.ok(excluded.includes("異常なし") && !excluded.includes("→"), excluded);

    assert.ok(symptomLine(html, 43).includes("—"), "비어 있는 신고증상이 — 로 보이지 않는다");
    // 긴 글이 표를 무너뜨리지 않게 이웃 칸들처럼 break-words.
    assert.ok(/<div data-role="reported-symptom" class="[^"]*break-words/.test(html), "신고증상 줄에 break-words 가 없다");
  });

  test("표만 가로로 밀린다 · 줄이 없으면 안내", () => {
    const html = render(<KyosanPreviewTable rows={[row(18, "EXCLUDED")]} />);
    assert.ok(/^<div class="overflow-x-auto/.test(html), html.slice(0, 80));
    assert.ok(/<th scope="col" class="[^"]*px-3/.test(html), "머리글 칸 여백이 px-3 이 아니다");
    assert.ok(/<td class="px-3/.test(html), "칸 여백이 px-3 이 아니다");
    assert.ok(render(<KyosanPreviewTable rows={[]} />).includes("이 조건에 맞는 줄이 없습니다."));
  });
});

// ───────────────────────────── 실패 알림

describe("실패 알림", () => {
  test("🔴 머리글 불일치는 열마다 한 줄씩 목록으로", () => {
    const html = render(
      <KyosanFailureNotice
        failure={describeKyosanFailure({
          ok: false,
          code: "INVALID_FILE",
          message: "머리글이 양식과 다릅니다.",
          parseFailureCode: "HEADER_MISMATCH",
          mismatches: [
            { column: "G", expected: "種別", actual: "種類" },
            { column: "S", expected: "出荷日", actual: null },
          ],
        })}
      />
    );
    assert.ok(html.includes('role="alert"'), html);
    assert.ok(html.includes(">파일을 읽을 수 없습니다.<"), html);
    assert.ok(html.includes("<li>G열 머리글은 「種別」이어야 하는데 「種類」였습니다.</li>"), html);
    assert.ok(html.includes("<li>S열 머리글은 「出荷日」이어야 하는데 비어 있었습니다.</li>"), html);
  });

  test("늘어놓을 것이 없으면 목록을 그리지 않는다", () => {
    const html = render(<KyosanFailureNotice failure={describeKyosanNetworkFailure()} />);
    assert.ok(html.includes("서버와 연결이 끊겼습니다."), html);
    assert.ok(!html.includes("<ul"), html);
  });
});

// ───────────────────────────── 새로 생길 이름

describe("새로 생길 이름", () => {
  const newNames: KyosanNewNames = {
    customers: [{ name: "교산전기(주)", rowNumbers: [18, 19], suggestions: [{ id: "c1", name: "교산전기" }] }],
    endUsers: [
      { customerName: "교산전기", customerId: "c1", name: "라인A", rowNumbers: [20], suggestions: [] },
      { customerName: "새고객", customerId: null, name: "라인B", rowNumbers: [21], suggestions: [] },
    ],
    productModels: [
      {
        name: "RF-200",
        kind: "GENERATOR",
        rowNumbers: Array.from({ length: 12 }, (_, index) => 30 + index),
        suggestions: [{ id: "m1", name: "RF-20" }],
      },
    ],
  };

  test("🔴 고객사 · End-User(어느 고객사 밑) · 모델(종류) · 쓰인 행 · 비슷한 기존 이름 · 오타 안내", () => {
    const html = render(<KyosanNewNamesPanel newNames={newNames} />);
    assert.ok(html.includes("새로 생길 이름 (4개)"), html);
    assert.ok(html.includes("엑셀을 고쳐 다시 올리세요"), "오타 안내가 없다");

    const group = (name: string) => openTag(html, new RegExp(`<div data-group="${name}">[\\s\\S]*?</ul></div>`));
    const customers = group("customers");
    assert.ok(customers.includes(">교산전기(주)<") && customers.includes("행 18, 19"), customers);
    assert.ok(customers.includes("비슷한 기존 이름: 「교산전기」"), customers);

    const endUsers = group("end-users");
    assert.ok(endUsers.includes("라인A") && endUsers.includes("고객사 「교산전기」 밑"), endUsers);
    assert.ok(endUsers.includes("라인B") && endUsers.includes("새 고객사 「새고객」 밑"), endUsers);

    const models = group("product-models");
    assert.ok(models.includes("RF-200") && models.includes("제너레이터"), models);
    assert.ok(models.includes("외 2줄"), models);
    assert.ok(models.includes("비슷한 기존 이름: 「RF-20」"), models);
  });

  test("새로 생길 이름이 없으면 그렇다고 말한다", () => {
    const html = render(<KyosanNewNamesPanel newNames={{ customers: [], endUsers: [], productModels: [] }} />);
    assert.ok(html.includes("새로 생길 이름이 없습니다"), html);
    assert.ok(!html.includes("data-group"), html);
  });
});

// ───────────────────────────── 올리기 · 가져오기 · 결과

describe("올리기", () => {
  test(".xlsx 만 고르게 · 읽는 동안 잠금 · 파일 문제는 알림", () => {
    const ready = render(
      <KyosanUploadPanel hasFile fileError={null} busy={false} disabled={false} onFileChange={noop} onPreview={noop} />
    );
    assert.ok(ready.includes('accept=".xlsx,'), ready);
    assert.ok(!/data-role="kyosan-preview"[^>]*disabled=""/.test(ready), "파일이 있는데 [미리보기]가 꺼져 있다");

    const busy = render(<KyosanUploadPanel hasFile fileError={null} busy disabled={false} onFileChange={noop} onPreview={noop} />);
    assert.ok(busy.includes("읽는 중..."), busy);
    assert.ok(/disabled=""[^>]*data-role="kyosan-preview"|data-role="kyosan-preview"[^>]*disabled=""/.test(busy), busy);

    const bad = render(
      <KyosanUploadPanel
        hasFile
        fileError="20MB 이하의 .xlsx 파일만 올릴 수 있습니다."
        busy={false}
        disabled={false}
        onFileChange={noop}
        onPreview={noop}
      />
    );
    assert.ok(bad.includes("20MB 이하의 .xlsx 파일만 올릴 수 있습니다."), bad);
    assert.ok(/<button[^>]*disabled=""[^>]*>미리보기<\/button>/.test(bad), "파일 문제가 있는데 [미리보기]가 켜져 있다");
  });
});

describe("가져오기", () => {
  test("[가져오기 N건] — 가져올 줄이 없으면 꺼진다", () => {
    const html = render(<KyosanImportBar importableCount={512} chunkSize={25} disabled={false} onRequestImport={noop} />);
    assert.ok(html.includes(">가져오기 512건<"), html);
    assert.ok(html.includes("25줄씩 차례로"), html);
    const none = render(<KyosanImportBar importableCount={0} chunkSize={25} disabled={false} onRequestImport={noop} />);
    assert.ok(/<button[^>]*disabled=""[^>]*>가져오기 0건<\/button>/.test(none), none);
    assert.ok(none.includes("가져올 줄이 없습니다."), none);
  });

  test("🔴 확인 창 — 몇 건이 생기는지 · 되돌리려면 건마다 휴지통", () => {
    const html = render(<KyosanImportConfirmDialogView count={512} chunkSize={25} onConfirm={noop} onCancel={noop} />);
    assert.ok(html.includes("과거 인수품 512건을 가져옵니다"), html);
    assert.ok(html.includes("수리 건 512건을 새로 만듭니다."), html);
    assert.ok(html.includes("하나씩 휴지통으로"), html);
    assert.ok(html.includes(">512건 가져오기<"), html);
  });

  function renderProgress(state: KyosanRunState): string {
    return render(<KyosanImportProgressView state={state} onPause={noop} onResume={noop} onRetry={noop} onReset={noop} />);
  }
  const rowNumbers = Array.from({ length: 60 }, (_, index) => 18 + index);
  const succeed = (state: KyosanRunState) =>
    recordKyosanChunkSuccess(
      state,
      (nextKyosanChunk(state) ?? []).map((rowNumber) => ({ rowNumber, outcome: "CREATED" as const, intakeNumber: `K${rowNumber}` }))
    );

  test("🔴 진행 막대 — 보낸 줄 / 전체 · 보내는 중에는 [멈춤]", () => {
    const html = renderProgress(succeed(startKyosanRun(rowNumbers, 25)));
    const bar = openTag(html, /<div role="progressbar"[^>]*>/);
    assert.ok(bar.includes('aria-valuenow="25"') && bar.includes('aria-valuemax="60"'), bar);
    assert.ok(html.includes('style="width:41%"'), html);
    assert.ok(html.includes("25 / 60줄 보냄 (41%) · 조각 1 / 3"), html);
    assert.ok(html.includes('data-role="kyosan-pause"'), html);
    assert.ok(!html.includes('data-role="kyosan-retry"'), html);
    assert.ok(html.includes("이 페이지를 떠나지 마세요"), html);
  });

  test("멈추는 중 · 멈춤 — [이어서 가져오기]", () => {
    const pausing = renderProgress(pauseKyosanRun(startKyosanRun(rowNumbers, 25)));
    assert.ok(pausing.includes("끝나면 멈춥니다"), pausing);
    assert.ok(!pausing.includes('data-role="kyosan-pause"'), pausing);
    const paused = renderProgress(settleKyosanPause(pauseKyosanRun(startKyosanRun(rowNumbers, 25))));
    assert.ok(paused.includes(">이어서 가져오기<"), paused);
  });

  test("🔴 네트워크 실패는 사유와 [다시 시도], 다시 보내면 안 되는 실패는 [다른 파일 올리기]만", () => {
    const network = renderProgress(recordKyosanChunkFailure(startKyosanRun(rowNumbers, 25), describeKyosanNetworkFailure()));
    assert.ok(network.includes("서버와 연결이 끊겼습니다."), network);
    assert.ok(network.includes(">다시 시도<"), network);
    assert.ok(!network.includes('data-role="kyosan-reset"'), network);

    const changed = renderProgress(
      recordKyosanChunkFailure(
        startKyosanRun(rowNumbers, 25),
        describeKyosanFailure({ ok: false, code: "FILE_CHANGED", message: "다릅니다." })
      )
    );
    assert.ok(changed.includes("올린 파일이 미리보기 때의 파일과 다릅니다."), changed);
    assert.ok(!changed.includes(">다시 시도<"), changed);
    assert.ok(changed.includes(">다른 파일 올리기<"), changed);
  });

  test("끝나면 막대가 가득 차고 [다른 파일 올리기]", () => {
    const html = renderProgress(succeed(succeed(succeed(startKyosanRun(rowNumbers, 25)))));
    assert.ok(html.includes('style="width:100%"'), html);
    assert.ok(html.includes("모두 보냈습니다."), html);
    assert.ok(html.includes(">다른 파일 올리기<"), html);
    assert.ok(!html.includes('data-role="kyosan-pause"'), html);
  });
});

describe("결과", () => {
  const results: KyosanChunkRowResult[] = [
    { rowNumber: 18, outcome: "CREATED", repairCaseId: "r18", intakeNumber: "K18" },
    { rowNumber: 19, outcome: "CREATED", repairCaseId: "r19", intakeNumber: "K19", message: "이 가져오기에서 이미 만든 건입니다(다시 실행해도 같은 건)." },
    { rowNumber: 20, outcome: "ALREADY_EXISTS", repairCaseId: "r20", intakeNumber: "K20", message: "인수번호 K20 인 건이 방금 생겼습니다." },
    { rowNumber: 21, outcome: "SKIPPED", intakeNumber: "K21", message: "가져올 수 없는 줄입니다." },
    { rowNumber: 22, outcome: "FAILED", intakeNumber: "K22", message: "고객사 이름이 너무 깁니다." },
  ];

  test("🔴 합계 · 만든 건은 링크 · 실패는 사유", () => {
    const html = render(<KyosanImportResultView summary={summarizeKyosanResults(results)} finished />);
    assert.ok(html.includes(">4. 결과<"), html);
    assert.ok(html.includes("만듦 2 · 이미 있음 1 · 건너뜀 1 · 실패 1 · 합계 5건"), html);
    assert.ok(html.includes('href="/repair-cases/r18"') && html.includes('href="/repair-cases/r19"'), html);
    // 이미 있던 건은 휴지통일 수도 있어 상세로 보내지 않는다.
    assert.ok(!html.includes('href="/repair-cases/r20"'), html);
    assert.ok(html.includes("고객사 이름이 너무 깁니다."), html);
    assert.ok(html.includes(">실패 1건<") && html.includes(">건너뜀 1건<") && html.includes(">이미 있음 1건<") && html.includes(">만든 건 2건<"), html);
  });

  test("도중이면 「지금까지」 · 만든 건이 많으면 접어 둔다", () => {
    const many: KyosanChunkRowResult[] = Array.from({ length: 30 }, (_, index) => ({
      rowNumber: 18 + index,
      outcome: "CREATED",
      repairCaseId: `r${18 + index}`,
      intakeNumber: `K${18 + index}`,
    }));
    const html = render(<KyosanImportResultView summary={summarizeKyosanResults(many)} finished={false} />);
    assert.ok(html.includes("4. 결과 (지금까지)"), html);
    assert.ok(!openTag(html, /<details[^>]*data-group="created"[^>]*>/).includes("open"), "30건인데 펼쳐져 있다");
  });
});

describe("유/무상 확인 필요 목록", () => {
  const items: ImportedCaseNeedingBillingReview[] = [
    {
      repairCaseId: "r40",
      intakeNumber: "K40",
      billingType: "PAID",
      importBatchId: null,
      sourceRowNumber: 40,
      sourceBilling: null,
      importedAt: "2026-09-14T16:30:00.000Z",
    },
    {
      repairCaseId: "r41",
      intakeNumber: "K41",
      billingType: "PAID",
      importBatchId: null,
      sourceRowNumber: null,
      sourceBilling: "未定",
      importedAt: "2026-09-15T01:00:00.000Z",
    },
  ];

  test("🔴 인수번호 링크 · 지금 유/무상 · 원본 費用 · 가져온 날(한국 날짜)", () => {
    const html = render(<KyosanBillingReviewList items={items} />);
    assert.ok(html.includes("유/무상 확인 필요 (2건)"), html);
    assert.ok(html.includes('href="/repair-cases/r40"') && html.includes(">K40<"), html);
    assert.ok(html.includes(">유상<"), html);
    assert.ok(html.includes(">비어 있음<") && html.includes(">未定<"), html);
    assert.ok(html.includes(">2026-09-15<"), html);
    assert.ok(/^<section[\s\S]*<div class="mt-3 overflow-x-auto">/.test(html), "표가 가로 스크롤 틀 안에 있지 않다");
  });

  test("없으면 그렇다고 말한다", () => {
    const html = render(<KyosanBillingReviewList items={[]} />);
    assert.ok(html.includes("유/무상 확인 필요 (0건)"), html);
    assert.ok(html.includes("확인할 건이 없습니다."), html);
    assert.ok(!html.includes("<table"), html);
  });
});

// ───────────────────────────── 화면이 서버를 어떻게 부르는가 (원본)

const read = (relative: string) => readFileSync(join(process.cwd(), relative), "utf8");
const withoutComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");

describe("연결 — 원본", () => {
  const screen = withoutComments(read("src/components/excel-imports/KyosanIntakeImportScreen.tsx"));
  const page = withoutComments(read("src/app/(app)/excel-imports/kyosan-intake-list/page.tsx"));
  const previewParts = read("src/components/excel-imports/KyosanImportPreviewParts.tsx");
  const runParts = read("src/components/excel-imports/KyosanImportRunParts.tsx");
  const viewModel = read("src/components/excel-imports/kyosan-import-view-model.ts");

  test("🔴 페이지는 관리(MANAGE) 가드가 먼저이고, 그 뒤에 목록을 읽어 화면에 넘긴다", () => {
    const guard = page.indexOf('await requireAreaAccessForCurrentUser("kyosanIntakeImport", "MANAGE")');
    const list = page.indexOf("await listImportedCasesNeedingBillingReview()");
    assert.ok(guard >= 0, "MANAGE 가드가 없다");
    assert.ok(list > guard, "가드보다 먼저 목록을 읽는다");
    assert.ok(/billingReviewItems=\{billingReviewItems\}/.test(page), "화면에 목록을 넘기지 않는다");
    assert.ok(/export const dynamic = "force-dynamic"/.test(page), "캐시된 목록을 보일 수 있다");
  });

  test("🔴 조각은 한 번에 하나씩 차례로 — 병렬이 없고, 흐름이 둘 생기지 않는다", () => {
    assert.ok(!/Promise\.(all|allSettled|race|any)\(/.test(screen), "조각을 병렬로 보낸다");
    const loop = screen.slice(screen.indexOf("for (;;)"));
    assert.ok(screen.includes("for (;;)"), "차례로 보내는 반복이 없다");
    assert.ok(/result = await executeKyosanIntakeImportChunkAction\(form\)/.test(loop), "조각 답을 기다리지 않는다");
    assert.equal((screen.match(/executeKyosanIntakeImportChunkAction\(/g) ?? []).length, 1, "조각을 보내는 곳이 둘 이상이다");
    assert.ok(/if \(loopRef\.current\) return;\s*loopRef\.current = true;/.test(screen), "흐름 중복을 막지 않는다");
  });

  test("🔴 같은 File · batchId · fileSha256 과 행 번호 JSON 을 보낸다 — 조각 크기는 미리보기가 준 값", () => {
    for (const line of [
      'form.set("file", source)',
      'form.set("batchId", batchId)',
      'form.set("fileSha256", fileSha256)',
      'form.set("rowNumbers", JSON.stringify(chunk))',
    ]) {
      assert.ok(screen.includes(line), line);
    }
    assert.ok(/setPreview\(\{ result, file \}\)/.test(screen), "미리보기에 쓴 File 을 붙들어 두지 않는다");
    assert.ok(/startKyosanRun\(importableKyosanRowNumbers\(result\.rows\), result\.chunkSize\)/.test(screen), screen);
    assert.ok(!/KYOSAN_IMPORT_CHUNK_SIZE/.test(screen), "서버 상수를 화면에서 가져온다");
  });

  test("🔴 가져오는 동안 떠나면 경고 · 끝나면 머문 채로 팝업과 목록 새로 받기", () => {
    assert.ok(/addEventListener\("beforeunload", handleBeforeUnload\)/.test(screen), "떠날 때 경고가 없다");
    assert.ok(/if \(!importing\) return;/.test(screen), "가져오는 중에만 경고하지 않는다");
    assert.ok(screen.includes("router.refresh()"), "목록을 새로 받지 않는다");
    assert.ok(/showSavePopup\(\{ message, redirectTo: null \}\)/.test(screen), "팝업이 결과 화면을 떠난다");
    assert.ok(!/router\.push\(/.test(screen), "결과 화면을 떠난다");
  });

  test("🔴 그리기 조각 · 판단은 서버 모듈을 타입으로만 가져온다 · console 을 쓰지 않는다", () => {
    const serverImport = /import\s+(type\s+)?\{[^}]*\}\s+from\s+"@\/lib\/(?:server|db)\/[^"]+"/g;
    for (const [label, source] of [
      ["미리보기 조각", previewParts],
      ["가져오기 조각", runParts],
      ["판단", viewModel],
    ] as const) {
      const imports = [...source.matchAll(serverImport)];
      assert.ok(imports.length > 0, `${label}: 서버 타입을 쓰지 않는다 — 시험이 헛돈다`);
      for (const match of imports) assert.ok(match[1], `${label}: 서버 모듈을 값으로 가져온다 — ${match[0]}`);
    }
    for (const [label, source] of [
      ["화면", screen],
      ["미리보기 조각", previewParts],
      ["가져오기 조각", runParts],
      ["판단", viewModel],
      ["페이지", page],
    ] as const) {
      assert.ok(!/\bconsole\./.test(withoutComments(source)), `${label}: console 을 쓴다`);
    }
  });
});
