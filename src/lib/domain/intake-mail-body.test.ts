import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  composeIntakeMail,
  fillPlaceholders,
  formatOverhaulLine,
  DEFAULT_INTAKE_MAIL_TEMPLATE,
  INTAKE_MAIL_PREVIEW_SAMPLE,
  displayWidth,
  type IntakeMailCase,
} from "./intake-mail-body";

/**
 * ============================================================================
 * 접수 알림 메일 본문 — 무엇을 단정하고 무엇을 단정하지 않는가
 * ============================================================================
 * 이 메일은 전사원에게 나간다. 한 번 나가면 되돌릴 수 없으므로, 여기서 보는
 * 것은 "예쁘게 나오는가"가 아니라 **틀린 말을 하지 않는가**다.
 *
 *  1. 🔴 O/H 는 세 갈래 모두 OP TIME 을 언급한다. 판정 근거가 반쪽인 것을
 *     감추면, 5만 시간 넘긴 4년 미만 장비를 "대상 아님"이라고 잘라 말하게 된다.
 *  2. 🔴 S/N 형식이 다르면 "대상 아님"이 아니라 "판정 불가"다.
 *  3. 과거 이력이 없으면 "없습니다"라고 적고, 그 근거(이 시스템 기록 기준)를
 *     밝힌다 — 빈칸으로 두면 조회가 실패한 것인지 정말 없는 것인지 모른다.
 *  4. 빠진 값은 "-" 다. 라벨만 남기고 값을 지우면 칸을 빠뜨린 것처럼 보인다.
 *  5. 모르는 치환자는 그대로 남는다 — 조용히 지우면 오타를 눈치채지 못한다.
 *  6. 같은 모델 이력은 담지 않는다(사용자 결정).
 * ============================================================================
 */

const BASE: IntakeMailCase = INTAKE_MAIL_PREVIEW_SAMPLE.intake;

describe("접수 알림 메일 본문", () => {
  test("기본 문구로 제목과 본문이 만들어진다", () => {
    const { subject, body } = composeIntakeMail({
      template: DEFAULT_INTAKE_MAIL_TEMPLATE,
      intake: BASE,
      history: INTAKE_MAIL_PREVIEW_SAMPLE.history,
    });

    assert.equal(subject, "[A/S 접수] D260901 · (예시) 교산 · MFC-3000 · S/N 1904097");
    assert.match(body, /■ 이번 접수/);
    assert.match(body, /Bias Fwd Drop 발생/);
    assert.match(body, /유상/);
    assert.match(body, /■ 이 제품의 과거 접수 \(2건\)/);
    assert.match(body, /D250312.*2025-03-12.*RF 출력 불안정.*출하 2025-04-02/);
  });

  test("🔴 O/H 는 대상이든 아니든 OP TIME 미확인을 함께 적는다", () => {
    const due = formatOverhaulLine({
      kind: "ASSESSED",
      production: { year: 2019, month: 4, sequence: 97 },
      monthsElapsed: 89,
      isDue: true,
      opTimeUnknown: true,
    });
    assert.match(due, /^대상 \(/);
    assert.match(due, /OP TIME 미확인/);

    const notDue = formatOverhaulLine({
      kind: "ASSESSED",
      production: { year: 2025, month: 1, sequence: 3 },
      monthsElapsed: 8,
      isDue: false,
      opTimeUnknown: true,
    });
    assert.match(notDue, /^대상 아님 \(/);
    // 여기가 핵심이다 — "대상 아님"이라고만 적으면 5만 시간 넘긴 장비를
    // 시스템이 틀리게 잘라 말하는 셈이 된다.
    assert.match(notDue, /OP TIME 미확인/);
  });

  test("🔴 S/N 형식이 다르면 '대상 아님'이 아니라 '판정 불가'다", () => {
    const line = formatOverhaulLine({ kind: "UNKNOWN" });
    assert.match(line, /판정 불가/);
    assert.doesNotMatch(line, /대상 아님/);
    assert.match(line, /OP TIME 미확인/);
  });

  test("과거 이력이 없으면 근거와 함께 '없습니다'라고 적는다", () => {
    const { body } = composeIntakeMail({
      template: DEFAULT_INTAKE_MAIL_TEMPLATE,
      intake: BASE,
      history: [],
    });
    assert.match(body, /■ 이 제품의 과거 접수/);
    assert.match(body, /없습니다 — 이 시스템에 남은 접수 기록 기준입니다\./);
  });

  test("출하되지 않은 과거 건은 '미출하'로 적는다 — 빈칸으로 두지 않는다", () => {
    const { body } = composeIntakeMail({
      template: DEFAULT_INTAKE_MAIL_TEMPLATE,
      intake: BASE,
      history: [
        {
          intakeNumber: "D260101",
          receivedAt: "2026-01-05",
          reportedSymptom: "출력 저하",
          actualShipmentDate: null,
        },
      ],
    });
    assert.match(body, /\(미출하\)/);
  });

  test("빠진 값은 '-' 로 적는다", () => {
    const { body } = composeIntakeMail({
      template: DEFAULT_INTAKE_MAIL_TEMPLATE,
      intake: {
        ...BASE,
        endUserName: null,
        serialNumber: null,
        lotNumber: null,
        reportedSymptom: null,
        billingType: null,
        overhaul: { kind: "UNKNOWN" },
      },
      history: [],
    });
    // 칸 수 자체는 아래 정렬 시험이 본다. 여기서 보는 것은 "값이 - 인가"뿐이다.
    assert.ok(body.includes(`  증상${" ".repeat(6)}-`), body);
    assert.match(body, /S\/N - · L\/N -/);
    // End-User 가 없으면 괄호 자체가 붙지 않는다.
    assert.doesNotMatch(body, /End-User/);
  });

  test("🔴 이름표 칸이 한글·영문 섞여도 값이 한 줄에 선다", () => {
    const { body } = composeIntakeMail({
      template: DEFAULT_INTAKE_MAIL_TEMPLATE,
      intake: BASE,
      history: [],
    });

    // "  인수번호      D260901" 같은 줄들만 고른다.
    const fieldLines = body
      .split("\n")
      .filter((line) => /^ {2}\S/.test(line) && !line.startsWith("  없습니다"));
    assert.ok(fieldLines.length >= 7, `자료 줄을 못 찾았다:\n${body}`);

    // 값이 시작하는 칸 수가 전부 같아야 한다. padEnd(글자 수)로 짜면
    // "인수번호"(8칸)와 "O/H"(3칸)가 어긋나 여기서 걸린다.
    const columns = new Set(
      fieldLines.map((line) => displayWidth(line.slice(0, line.length - line.trimStart().length + 0)) )
    );
    const valueColumns = new Set(
      fieldLines.map((line) => {
        const label = line.trimStart().split(/ {2,}/)[0];
        const idx = line.indexOf(label) + label.length;
        const gap = line.slice(idx).length - line.slice(idx).trimStart().length;
        return displayWidth(line.slice(0, idx)) + gap;
      })
    );
    assert.equal(
      valueColumns.size,
      1,
      `값 시작 칸이 어긋난다(${[...valueColumns].join(", ")}):\n${fieldLines.join("\n")}`
    );
    assert.ok(columns.size >= 1);
  });

  test("머리말·꼬리말을 비우면 그 줄이 아예 빠진다", () => {
    const { body } = composeIntakeMail({
      template: { subject: "제목", intro: "   ", outro: "" },
      intake: BASE,
      history: [],
    });
    assert.ok(body.startsWith("■ 이번 접수"), `머리말 자리가 빈 줄로 남았다:\n${body}`);
    assert.ok(!body.endsWith("\n"), "꼬리말 자리가 빈 줄로 남았다");
  });

  test("모르는 치환자는 그대로 남는다 — 조용히 지우지 않는다", () => {
    assert.equal(
      fillPlaceholders("{{인수번호}} / {{담당자}}", BASE),
      "D260901 / {{담당자}}"
    );
  });

  test("같은 치환자를 여러 번 써도 전부 바뀐다", () => {
    assert.equal(fillPlaceholders("{{모델}}-{{모델}}", BASE), "MFC-3000-MFC-3000");
  });

  test("미리보기 예시는 실제 조립을 통과한다 — 화면과 메일이 같은 함수를 쓴다", () => {
    const { subject, body } = composeIntakeMail({
      template: DEFAULT_INTAKE_MAIL_TEMPLATE,
      ...INTAKE_MAIL_PREVIEW_SAMPLE,
    });
    assert.ok(subject.length > 0);
    assert.match(body, /■ 이번 접수/);
    // 예시임이 드러나야 한다 — 실제 고객사로 오해하면 안 된다.
    assert.match(body, /\(예시\)/);
  });
});
