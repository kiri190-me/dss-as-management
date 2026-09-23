import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";

import type { KyosanIdentityCheck } from "@/lib/kyosan/report-match";
import type {
  KyosanReportPreviewReady,
  KyosanReportTarget,
} from "@/lib/domain/kyosan-report-import/preview-view";
import {
  canImportKyosanReport,
  kyosanReportSaveOffer,
} from "@/lib/domain/kyosan-report-import/preview-view";
import type { KyosanReportImportResult } from "@/lib/server/services/kyosan-report-import";
import { KyosanMemoText, KyosanText } from "@/components/kyosan/KyosanText";
import { KYOSAN_IMPORT_MARK, kyosanOriginHeading } from "@/lib/kyosan/report-detail-values";
import { translateKyosanTerm } from "@/lib/kyosan/report-terms";
import {
  KyosanReportContentPanel,
  KyosanReportImportBar,
  KyosanReportMatchPanel,
  KyosanReportNotices,
  KyosanReportResultPanel,
} from "./KyosanReportImportParts";

/**
 * ============================================================================
 * 연락서 한 장 넣기 — **무엇이 그려지는가** (조각 S4)
 * ============================================================================
 * `KyosanReportImportScreen` 은 서버 액션을 부르고 그 사슬 끝에 `server-only` 가
 * 있어 여기서 통째로 그릴 수 없다. 그리기만 하는 조각을 따로 그려 본다
 * (`KyosanImportParts.test.tsx` 와 같은 방식).
 *
 * 🔴 여기서 못 박는 것:
 *  · 짝이 없으면 **[이식] 단추가 화면에 없다**.
 *  · 짝이 여럿이면 라디오가 그려지고, **고르기 전에는 단추를 누를 수 없다**.
 *  · 무엇이 어긋나는지(모델 · S/N · L/N · 고객사) 항목마다 보인다.
 *  · 🔴 「수리 건 새로 만들기」 단추가 어디에도 없다.
 * ============================================================================
 */

const noop = () => {};
const render = (element: React.ReactElement) => renderToStaticMarkup(element);

/**
 * 🔴 「사전에 없는 일본어」 본보기 — **가짜 글자를 쓴다.**
 *
 * 2026-09-23 에 이 파일의 시험 둘이 깨졌다. 본보기로 `焼損・煙・異臭発生` 이라는
 * **실제 연락서 문장**(실측 139줄)을 써 두었는데, 자유 기술 사전이 192줄로
 * 자라면서 그 글자가 **사전 안으로 들어왔기** 때문이다. 제품이 망가진 것이 아니라
 * 본보기가 낡은 것이었다.
 *
 * 실제 연락서 문장은 사전이 자랄 때마다 이 자리를 깨뜨린다. 41자 넘는 문장을
 * 가져다 쓰는 것도 안 된다 — 그 무리에는 고객사명·모델명이 박혀 있다
 * (`lib/kyosan/report-free-text-lines.fixture.ts` 머리말).
 *
 * ⚠️ `lib/kyosan/report-terms.test.ts` · `lib/xlsx/service-report-template.test.ts`
 * 와 **같은 글자**다. 파일마다 따로 지으면 다음에 또 여기저기서 깨진다.
 */
const 사전에_없는_일본어 = "試験用ダミー故障";

/**
 * 🔴 **지킴이.** 다음 사람이 이 글자를 사전에 넣는 날 **여기서** 잡힌다 — 아래
 * 두 시험이 마크업 비교로 깨지는 대신이다(마크업이 틀린 것처럼 보여 한참 헤맨다).
 * 깨지면 사전을 되돌리지 말고 **본보기 글자를 바꿔라.**
 *
 * ⚠️ `translateKyosanTerm` 은 사전 **둘 다**(양식 · 자유 기술)를 지나는 문이다.
 * 이 파일이 이미 `KyosanText` 를 들여오고 그 조각이 같은 사전을 보므로, 여기서
 * 사전을 들여다보는 것은 겉돌지 않는다 — 같은 사슬이다.
 */
test("🔴 본보기가 아직 사전 밖에 있다 — 들어갔으면 다른 글자로 바꿔라", () => {
  assert.equal(translateKyosanTerm(사전에_없는_일본어), null);
});

const ALL_AGREE: KyosanIdentityCheck = {
  model: "agree",
  serialNumber: "agree",
  lotNumber: "unknown",
  customer: "agree",
};

const FIRST_ID = "11111111-1111-4111-8111-111111111111";
const SECOND_ID = "22222222-2222-4222-8222-222222222222";

function target(overrides: Partial<KyosanReportTarget> = {}): KyosanReportTarget {
  return {
    repairCaseId: FIRST_ID,
    intakeNumber: "D250101",
    isDeleted: false,
    customerName: "값-고객사",
    modelName: "값-모델",
    serialNumber: "값-시리얼",
    lotNumber: null,
    identity: ALL_AGREE,
    serviceReportCount: 0,
    hasReportedSymptom: false,
    alreadyImported: false,
    ...overrides,
  };
}

function preview(overrides: Partial<KyosanReportPreviewReady> = {}): KyosanReportPreviewReady {
  return {
    ok: true,
    sourceSha256: "a".repeat(64),
    formFamily: "card",
    intakeNumberStatus: "found",
    reportIdentity: {
      rawIntakeNumber: "D250101",
      intakeNumber: "D250101",
      model: "값-모델",
      serialNumber: "값-시리얼",
      lotNumber: "값-로트",
      customer: "값-고객사",
    },
    match: { kind: "matched" },
    targets: [target()],
    confirmedRepairCaseId: FIRST_ID,
    content: {
      lines: [{ section: "FINDINGS", text: "값-고장내용", origin: "お客様不具合" }],
      parts: [{ kind: "fault", text: "값-부품" }],
      causeMarks: ["値-원인"],
      actionMarks: [],
      photoCount: 2,
      formAssetCount: 5,
    },
    blockers: [],
    warnings: [],
    problems: [],
    ...overrides,
  };
}

/** 미리보기 하나를 실제 판단 함수에 태워 그대로 그린다(화면과 같은 길). */
function renderBar(ready: KyosanReportPreviewReady, selected: string | null): string {
  return render(
    <KyosanReportImportBar
      saveOffer={kyosanReportSaveOffer(ready)}
      canImport={canImportKyosanReport(ready, selected)}
      busy={false}
      onImport={noop}
    />
  );
}

// ══════════════════════════════════════════════ 짝이 없을 때

describe("🔴 짝이 없으면 저장 단추가 없다", () => {
  const unmatched = preview({
    match: { kind: "unmatched", reason: "intake-number-not-found" },
    targets: [],
    confirmedRepairCaseId: null,
    blockers: ["짝이 없습니다 — 그 접수번호로 등록된 수리 건이 없습니다. 넣지 않습니다."],
  });

  test("[이식] 단추가 화면에 아예 없다", () => {
    const markup = renderBar(unmatched, null);
    assert.ok(
      !markup.includes('data-role="kyosan-report-import"'),
      "🔴 짝이 없는데 눌러 볼 단추가 있으면 안 된다"
    );
    assert.match(markup, /data-offer="none"/);
    assert.match(markup, /넣을 수 없습니다/);
  });

  test("까닭을 갈라 보여 주고, 수리 건을 새로 만드는 길은 없다", () => {
    const markup = render(
      <KyosanReportMatchPanel
        preview={unmatched}
        saveOffer="none"
        selectedRepairCaseId={null}
        disabled={false}
        onSelect={noop}
      />
    );
    assert.match(markup, /data-match="unmatched"/);
    assert.match(markup, /그 접수번호로 등록된 수리 건이 없습니다/);
    assert.match(markup, /수리 건을 새로 만들지 않습니다/);
    assert.ok(!markup.includes('data-role="kyosan-report-target-radio"'), "고를 후보가 없어야 한다");
    assert.ok(!/새로 만들기|건 만들기|create/i.test(markup), "🔴 수리 건을 만드는 단추가 있으면 안 된다");
  });

  for (const [reason, text] of [
    ["intake-number-missing", "접수번호를 읽지 못했습니다"],
    ["intake-number-malformed", "번호 꼴"],
    ["intake-number-not-found", "등록된 수리 건이 없습니다"],
  ] as const) {
    test(`까닭 ${reason} 이 그대로 보인다`, () => {
      const markup = render(
        <KyosanReportMatchPanel
          preview={preview({ match: { kind: "unmatched", reason }, targets: [], confirmedRepairCaseId: null })}
          saveOffer="none"
          selectedRepairCaseId={null}
          disabled={false}
          onSelect={noop}
        />
      );
      assert.ok(markup.includes(text), `${reason}: "${text}" 가 보여야 한다`);
    });
  }
});

// ══════════════════════════════════════════════ 짝이 여럿일 때

describe("🔴 짝이 여럿이면 고르기 전에는 저장할 수 없다", () => {
  const many = preview({
    match: { kind: "ambiguous", reason: "identity-candidates" },
    intakeNumberStatus: "missing",
    targets: [
      target(),
      target({
        repairCaseId: SECOND_ID,
        intakeNumber: "D240707",
        modelName: "값-다른모델",
        identity: { model: "differ", serialNumber: "agree", lotNumber: "unknown", customer: "differ" },
        serviceReportCount: 1,
      }),
    ],
    confirmedRepairCaseId: null,
    blockers: ["접수번호로 짝을 못 정했습니다. S/N 으로 찾은 후보가 2건 있습니다 — 사람이 골라야 합니다."],
  });

  test("고르기 전 — 단추는 있지만 눌리지 않는다", () => {
    const markup = renderBar(many, null);
    assert.match(markup, /data-offer="choose"/);
    assert.match(markup, /data-role="kyosan-report-import"[^>]*\sdisabled=""/);
    assert.match(markup, /넣을 수리 건을 먼저 골라 주세요/);
  });

  test("고른 뒤 — 단추가 열린다", () => {
    const markup = renderBar(many, SECOND_ID);
    assert.match(markup, /data-role="kyosan-report-import"/);
    assert.ok(
      !/data-role="kyosan-report-import"[^>]*\sdisabled=""/.test(markup),
      "고른 뒤에는 누를 수 있어야 한다"
    );
  });

  test("후보마다 라디오가 있고 처음에는 아무것도 골라져 있지 않다", () => {
    const markup = render(
      <KyosanReportMatchPanel
        preview={many}
        saveOffer="choose"
        selectedRepairCaseId={null}
        disabled={false}
        onSelect={noop}
      />
    );
    const radios = markup.match(/data-role="kyosan-report-target-radio"/g) ?? [];
    assert.equal(radios.length, 2);
    assert.ok(!/data-checked="true"/.test(markup), "🔴 미리 골라 두면 사람이 고르지 않고 누른다");
    assert.match(markup, /data-match="ambiguous"/);
    assert.match(markup, /사람이 골라야 합니다/);
  });

  test("🔴 무엇이 맞고 무엇이 다른지 항목마다 보인다", () => {
    const markup = render(
      <KyosanReportMatchPanel
        preview={many}
        saveOffer="choose"
        selectedRepairCaseId={null}
        disabled={false}
        onSelect={noop}
      />
    );
    // 네 항목 × 후보 2건 = 배지 8개.
    const badges = markup.match(/data-role="kyosan-agreement"/g) ?? [];
    assert.equal(badges.length, 8);
    assert.match(markup, /data-agreement="differ"/);
    assert.match(markup, /data-agreement="agree"/);
    assert.match(markup, /data-agreement="unknown"/);
    // 연락서에 적힌 값과 나란히 볼 수 있어야 고를 수 있다.
    assert.match(markup, /data-role="kyosan-report-identity-row"/);
    assert.ok(markup.includes("값-로트"), "연락서의 L/N 이 보여야 한다");
  });

  test("휴지통 · 이미 넣은 건은 고를 수 없다(라디오가 잠긴다)", () => {
    const blocked = preview({
      match: { kind: "ambiguous", reason: "identity-candidates" },
      targets: [target({ isDeleted: true }), target({ repairCaseId: SECOND_ID, alreadyImported: true })],
      confirmedRepairCaseId: null,
    });
    const markup = render(
      <KyosanReportMatchPanel
        preview={blocked}
        saveOffer="choose"
        selectedRepairCaseId={null}
        disabled={false}
        onSelect={noop}
      />
    );
    const locked = markup.match(/data-role="kyosan-report-target-radio"[^>]*\sdisabled=""/g) ?? [];
    assert.equal(locked.length, 2, "두 후보 모두 잠겨 있어야 한다");
    assert.match(markup, /휴지통/);
    assert.match(markup, /이 연락서를 이미 넣음/);
  });
});

// ══════════════════════════════════════════════ 짝이 하나일 때

describe("짝이 하나로 확정됐을 때", () => {
  test("[이식] 단추가 열리고 「확정」으로 보인다", () => {
    const one = preview();
    const markup = renderBar(one, FIRST_ID);
    assert.match(markup, /data-offer="confirm"/);
    assert.ok(!/data-role="kyosan-report-import"[^>]*\sdisabled=""/.test(markup));

    const panel = render(
      <KyosanReportMatchPanel
        preview={one}
        saveOffer="confirm"
        selectedRepairCaseId={FIRST_ID}
        disabled={false}
        onSelect={noop}
      />
    );
    assert.match(panel, /data-match="matched"/);
    assert.match(panel, /확정/);
    assert.ok(!panel.includes('data-role="kyosan-report-target-radio"'), "고를 것이 없으면 라디오도 없다");
  });

  test("🔴 막는 것이 있으면 단추가 사라진다", () => {
    const blocked = preview({
      confirmedRepairCaseId: null,
      targets: [target({ alreadyImported: true })],
      blockers: ["이미 넣은 연락서입니다(원본 파일이 같습니다) — 다시 넣지 않습니다."],
    });
    const markup = renderBar(blocked, FIRST_ID);
    assert.ok(!markup.includes('data-role="kyosan-report-import"'));
  });
});

// ══════════════════════════════════════════════ 무엇이 들어가는가 · 알림 · 결과

describe("미리보기가 무엇을 보여 주는가", () => {
  test("줄 · 부품 · 사진 수와 걸러 낸 양식 그림 수가 보인다", () => {
    const markup = render(<KyosanReportContentPanel preview={preview()} />);
    assert.match(markup, /내용 줄 1개/);
    assert.match(markup, /사진 2장/);
    assert.match(markup, /양식 그림 5장은 걸러 냈습니다/);
    assert.ok(markup.includes("값-고장내용"), "들어갈 글자가 그대로 보여야 한다");
    assert.ok(markup.includes("お客様不具合"), "어느 항목에서 왔는지 보여야 한다");
    // 분류와 부품 글자가 한 줄에 있다. 글자는 `KyosanText` 가 감싸므로 사이에
    // 태그가 낀다 — 분류만 견주고 글자는 따로 본다(조각 S5).
    assert.match(markup, /\[고장분\] /);
    assert.ok(markup.includes("값-부품"), "부품 글자가 그대로 보여야 한다");
  });

  /**
   * 🔴 사람이 이 표를 보고 [이식]을 누른다. 자리 이름이 틀리면 화면이 거짓말을
   * 한 것이 된다 — 그래서 「보고서」라는 말이 한 군데도 남아 있으면 안 된다.
   */
  test("🔴 줄마다 **상세의 어느 칸**으로 가는지 보여 준다 — 보고서를 만든다고 말하지 않는다", () => {
    const markup = render(
      <KyosanReportContentPanel
        preview={preview({
          content: {
            lines: [
              { section: "FINDINGS", text: "값-증상", origin: "고객 고장 상황" },
              { section: "FINDINGS", text: "값-확인", origin: "사내 확인 결과" },
              { section: "FINDINGS", text: "값-원인상세", origin: "원인 상세" },
              { section: "ACTIONS", text: "現品引取", origin: "처치(○ 표시)" },
              { section: "REMARK", text: "값-비고", origin: "비고" },
            ],
            parts: [],
            causeMarks: [],
            actionMarks: [],
            photoCount: 0,
            formAssetCount: 0,
          },
        })}
      />
    );

    assert.match(markup, /data-destination="REPORTED_SYMPTOM"/);
    assert.match(markup, /data-destination="INTAKE_INSPECTION_RESULT"/);
    assert.match(markup, /data-destination="DIAGNOSIS_REPAIR_SUMMARY"/);
    assert.match(markup, /data-destination="NOT_IMPORTED"/);
    // 🔴 **뜻을 다시 정했다**(2026-09-22): 처치 ○ · 원인 ○ 는 「현재 진단/조치
    //    요약」이 아니라 「작업 이력」으로 간다(정보량 0 — 실측 469장 전부
    //    `現品引取`). 화면도 그 자리를 그대로 말해야 한다. 그리고 버리지 않으므로
    //    `NOT_IMPORTED` 로 보여서는 **안 된다** — 요약 칸 몫은 「원인 상세」가 맡는다.
    assert.match(markup, /data-destination="WORK_RECORD_GENERAL"/);

    assert.ok(markup.includes("신고 증상"), "상세의 칸 이름이 보여야 한다");
    assert.ok(markup.includes("비어 있을 때만"), "덮지 않는다는 사실을 미리 말해야 한다");
    assert.ok(markup.includes("넣지 않음"), "비고는 넣지 않는다고 말해야 한다");
    assert.ok(markup.includes("작업 이력에만 남습니다"), "처치 ○ 가 어디로 가는지 말해야 한다");
    assert.ok(markup.includes("보고서를 만들지 않습니다"));

    // 🔴 「보고서 줄」·「확인 내용」 같은 옛 이름표가 남아 있으면 안 된다.
    assert.equal(/보고서 줄/.test(markup), false);
    assert.equal(/>확인 내용</.test(markup), false);
  });

  /**
   * ⚠️ 여기의 `交換無し` 는 **판독기가 더 이상 만들지 않는 값**이다(2026-09-22) —
   * 「바꾼 것이 없다」는 상태값이라 Card 시트 경로에서도 걸러진다
   * (`card-fields.ts` 의 `isPartNameList` · 실측 165장). 그래도 이 단언을 남겨
   * 두는 까닭은 **화면이 모르는 글자를 조용히 지우지 않는다**는 규칙을 못 박기
   * 때문이다: 사전에 있는 낱말은 한글로 보여 주고 **원문을 함께** 남긴다.
   * 🔴 화면에 「[예방분] 교체 없음」이 다시 뜨면 그것은 판독기가 새는 것이지
   * 이 시험이 시킨 일이 아니다 — 판독기 쪽 시험은 `card-fields.test.ts` 다.
   */
  test("🔴 양식의 고정 보기는 한글로, 원문은 옆에 남는다(조각 S5)", () => {
    const markup = render(
      <KyosanReportContentPanel
        preview={preview({
          content: {
            lines: [{ section: "ACTIONS", text: "現品引取", origin: "처치(○ 표시)" }],
            parts: [{ kind: "fault", text: "交換無し" }],
            causeMarks: [],
            actionMarks: ["現品引取"],
            photoCount: 0,
            formAssetCount: 0,
          },
        })}
      />
    );
    assert.ok(markup.includes("현품 인수"), "고정 보기는 한글로 보여야 한다");
    assert.ok(markup.includes("(現品引取)"), "🔴 원문을 버리지 않는다");
    assert.ok(markup.includes("교체 없음"), "부품 칸의 상태값도 한글로 보여야 한다");
    assert.ok(markup.includes("(交換無し)"), "🔴 부품 칸의 원문도 남는다");
  });

  test("🔴 사람이 적은 일본어는 원문 그대로 두고 그렇게 표시한다(조각 S5)", () => {
    const markup = render(
      <KyosanReportContentPanel
        preview={preview({
          content: {
            lines: [{ section: "FINDINGS", text: 사전에_없는_일본어, origin: "고객 고장 상황" }],
            parts: [],
            causeMarks: [],
            actionMarks: [],
            photoCount: 0,
            formAssetCount: 0,
          },
        })}
      />
    );
    assert.ok(markup.includes(사전에_없는_일본어), "🔴 자유 기술은 원문 그대로다");
    assert.ok(markup.includes("일본어 원문"), "일본어 원문임을 알려야 한다");
  });

  test("뽑은 것이 하나도 없으면 그렇게 말한다", () => {
    const empty = preview({
      content: { lines: [], parts: [], causeMarks: [], actionMarks: [], photoCount: 0, formAssetCount: 0 },
    });
    assert.match(render(<KyosanReportContentPanel preview={empty} />), /하나도 뽑지 못했습니다/);
  });

  test("막는 것 · 알리는 것 · 읽다가 만난 문제를 갈라 보여 준다", () => {
    const noticed = preview({
      blockers: ["막-하나"],
      warnings: ["알림-하나"],
      problems: ["문제-하나"],
    });
    const markup = render(<KyosanReportNotices preview={noticed} />);
    assert.match(markup, /data-role="kyosan-report-blockers"/);
    assert.match(markup, /data-role="kyosan-report-warnings"/);
    assert.match(markup, /data-role="kyosan-report-problems"/);
    assert.match(markup, /막-하나/);
  });

  test("아무 알림도 없으면 빈 상자를 그리지 않는다", () => {
    assert.equal(render(<KyosanReportNotices preview={preview()} />), "");
  });
});

describe("결과", () => {
  test("성공하면 무엇이 들어갔는지와 수리 건 링크가 보인다", () => {
    const ok: KyosanReportImportResult = {
      ok: true,
      repairCaseId: FIRST_ID,
      intakeNumber: "D250101",
      workRecordIds: ["33333333-3333-4333-8333-333333333333"],
      reportedSymptomFilled: true,
      lineCount: 4,
      usedPartCount: 2,
      attachmentIds: ["a", "b"],
      photoCount: 1,
      warnings: ["연락서에서 날짜를 하나도 읽지 못해 발행일을 오늘 날짜로 넣었습니다."],
    };
    const markup = render(<KyosanReportResultPanel result={ok} failureText="" />);
    assert.match(markup, /data-ok="true"/);
    assert.match(markup, /수리 건 D250101 에 넣었습니다/);
    // 🔴 보고서가 아니라 상세 칸에 들어갔다고 말해야 한다(조각 S5).
    assert.match(markup, /작업 기록 1건/);
    assert.match(markup, /신고 증상 채움/);
    assert.equal(/보고서/.test(markup), false);
    assert.ok(markup.includes(`/repair-cases/${FIRST_ID}`));
    assert.match(markup, /data-role="kyosan-report-result-warnings"/);
  });

  test("실패하면 까닭과 막는 문장들이 그대로 보인다", () => {
    const failed: KyosanReportImportResult = {
      ok: false,
      code: "NOT_IMPORTABLE",
      message: "이 연락서는 넣을 수 없습니다.",
      blockers: ["짝이 없습니다 — 넣지 않습니다."],
    };
    const markup = render(<KyosanReportResultPanel result={failed} failureText="넣지 않았습니다." />);
    assert.match(markup, /data-ok="false"/);
    assert.match(markup, /넣지 않았습니다\./);
    assert.match(markup, /짝이 없습니다/);
  });
});

// ══════════════════════════════════════════════ 공용 조각 (2026-09-22)

/**
 * ============================================================================
 * `@/components/kyosan/KyosanText` — 옮겨 온 공용 조각
 * ============================================================================
 * 미리보기 안에만 있던 `KyosanText` 를 공용 자리로 **옮겼다**(베낀 것이 아니다).
 * 상세 화면의 작업 기록·요약 칸도 같은 조각으로 그린다.
 *
 * 🔴 여기서 못 박는 것:
 *  · 미리보기의 마크업이 **옮기기 전과 한 글자도 다르지 않다.**
 *  · 여러 줄 덩어리에서 머리글 줄은 **번역되지 않는다.**
 *  · 🔴 원문·앞뒤 공백·빈 줄이 **하나도 사라지지 않는다.**
 *  · 덩어리 조각은 **바깥 요소를 만들지 않는다** — 색·취소선을 물려받아야 한다.
 * ============================================================================
 */

const TONE = 'class="text-zinc-800 dark:text-zinc-200"';

describe("공용 조각 — 연락서 글자 한 줄", () => {
  test("🔴 고정 보기 — 마크업이 옮기기 전과 같다(한글을 크게, 원문을 옆에 작게)", () => {
    assert.equal(
      render(<KyosanText value="現品引取" />),
      '<span data-role="kyosan-text" data-translated="true">' +
        `<span ${TONE}>현품 인수</span>` +
        '<span data-role="kyosan-text-original" class="ml-1.5 text-xs text-zinc-400 dark:text-zinc-500">(現品引取)</span>' +
        "</span>"
    );
  });

  test("🔴 사전에 없는 일본어 — 마크업이 옮기기 전과 같다(원문 + 「일본어 원문」)", () => {
    assert.equal(
      render(<KyosanText value={사전에_없는_일본어} />),
      '<span data-role="kyosan-text" data-japanese="true">' +
        `<span ${TONE}>${사전에_없는_일본어}</span>` +
        '<span data-role="kyosan-text-japanese-badge" class="ml-1.5 whitespace-nowrap rounded bg-zinc-100 px-1 py-0.5 text-[10px] text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">일본어 원문</span>' +
        "</span>"
    );
  });

  test("한국어 줄에는 아무 표시도 붙지 않는다", () => {
    assert.equal(
      render(<KyosanText value="출력이 나오지 않습니다" />),
      `<span data-role="kyosan-text"><span ${TONE}>출력이 나오지 않습니다</span></span>`
    );
  });

  test("색을 감싸는 곳에 맡길 수 있다(무효 처리된 작업 기록의 회색·취소선)", () => {
    const markup = render(<KyosanText value="출력이 나오지 않습니다" toneClassName={null} />);
    assert.equal(markup, '<span data-role="kyosan-text">출력이 나오지 않습니다</span>');
    assert.equal(markup.includes("text-zinc-800"), false, "🔴 바깥이 정한 색을 덮으면 안 된다");
  });
});

describe("공용 조각 — 연락서 여러 줄 덩어리", () => {
  /** 이식이 작업 기록 `memo` 한 칸에 실제로 넣는 모양(`report-detail-values.ts`). */
  const MEMO = [
    KYOSAN_IMPORT_MARK,
    "",
    kyosanOriginHeading("사내 확인 결과"),
    "不具合内容 その１",
    "  前置きの空白も残す  ",
    "",
    kyosanOriginHeading("처치(○ 표시)"),
    "現品引取",
    "출력이 나오지 않습니다",
  ].join("\n");

  const markup = render(<KyosanMemoText value={MEMO} />);

  test("🔴 머리글 줄은 번역되지도 「일본어 원문」이 되지도 않는다", () => {
    assert.ok(
      markup.includes(`<span data-role="kyosan-memo-heading">${KYOSAN_IMPORT_MARK}</span>`),
      "🔴 우리가 붙인 한글 이름이지 연락서 원문이 아니다"
    );
    assert.ok(markup.includes('<span data-role="kyosan-memo-heading">[사내 확인 결과]</span>'));
    assert.ok(markup.includes('<span data-role="kyosan-memo-heading">[처치(○ 표시)]</span>'));
    // 머리글은 셋뿐이고, 하나도 글자 줄로 떨어지지 않았다.
    assert.equal((markup.match(/data-role="kyosan-memo-heading"/g) ?? []).length, 3);
  });

  test("고정 보기 줄은 한글과 원문이 둘 다 나온다", () => {
    assert.ok(markup.includes("현품 인수"), "한글이 보여야 한다");
    assert.ok(markup.includes("(現品引取)"), "🔴 원문을 버리지 않는다");
    assert.match(markup, /data-translated="true"/);
  });

  test("🔴 사전에 없는 일본어 줄은 원문 그대로 + 「일본어 원문」 표시", () => {
    assert.ok(markup.includes("不具合内容 その１"), "🔴 자유 기술은 원문 그대로다");
    assert.ok(markup.includes("일본어 원문"));
    // 일본어 줄은 둘이다 — 불량 내용과 앞뒤 공백이 붙은 줄.
    assert.equal((markup.match(/data-japanese="true"/g) ?? []).length, 2);
  });

  test("한국어 줄에는 아무 표시도 안 붙는다", () => {
    assert.ok(
      markup.includes('<span data-role="kyosan-text">출력이 나오지 않습니다</span>'),
      "한국어 줄은 감싸는 것 말고는 아무것도 붙지 않아야 한다"
    );
  });

  test("🔴 앞뒤 공백이 살아 있다 — 저장 쪽이 일부러 남긴 것이다", () => {
    assert.ok(markup.includes(">  前置きの空白も残す  <"), "앞뒤 공백이 그대로 있어야 한다");
  });

  test("🔴 빈 줄이 살아 있다 — 덩어리 사이 간격이 사라지면 안 된다", () => {
    assert.equal((markup.match(/\n/g) ?? []).length, 8, "줄 아홉이면 줄바꿈은 여덟이다");
    assert.match(markup, /<\/span>\n\n<span data-role="kyosan-memo-heading">\[사내 확인 결과\]/);
  });

  test("🔴 바깥 요소를 만들지 않는다 — 쓰는 쪽의 글자 크기·색·취소선을 물려받는다", () => {
    assert.equal(markup.includes("text-zinc-800"), false, "🔴 바깥이 정한 색을 덮으면 안 된다");
    assert.equal(markup.startsWith("<span data-role=\"kyosan-memo-heading\""), true, "<p>·<dd> 는 쓰는 쪽 것이다");
  });

  test("연락서와 상관없는 보통 기록은 아무것도 달라지지 않는다", () => {
    const plain = render(<KyosanMemoText value={"점검 완료\n이상 없음"} />);
    assert.equal(
      plain,
      '<span data-role="kyosan-text">점검 완료</span>\n<span data-role="kyosan-text">이상 없음</span>'
    );
  });
});
