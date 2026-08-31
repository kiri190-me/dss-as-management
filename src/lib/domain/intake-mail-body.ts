import { billingTypeLabels, type BillingType } from "./types";
import {
  formatElapsed,
  formatProduction,
  type OverhaulAssessment,
} from "./overhaul";

/**
 * ============================================================================
 * 접수 알림 메일의 제목과 본문을 만든다 — DB 도 SMTP 도 모르는 순수 함수
 * ============================================================================
 * 값만 받아 글자를 만든다. 그래서 **설정 화면의 미리보기와 실제로 나갈 메일이
 * 같은 함수를 쓴다** — 미리보기가 따로 만들어지면 사람이 확인한 문구와 실제로
 * 나간 문구가 갈리고, 그 어긋남은 메일이 나간 뒤에야 발견된다.
 *
 * ── 사람이 고치는 것은 세 칸뿐이다 ──────────────────────────────────────
 * 제목 형식 · 머리말 · 꼬리말. 가운데 **자료 부분은 여기서 만든다.** 표까지
 * 자유 편집으로 열면 값이 빠지거나("유/무상"을 지운 채 값만 남거나) 틀린
 * 이름표가 붙는데, 그걸 알아채는 건 전사원에게 나간 뒤다.
 *
 * ── O/H 는 단정하지 않는다 ──────────────────────────────────────────────
 * 지금 판정은 S/N 생산월 하나뿐이고 OP TIME 5만 시간을 담을 칸이 시스템에
 * 없다(domain/overhaul.ts 머리말). 그래서
 *   · 대상이든 아니든 **`OP TIME 미확인` 을 항상 함께 적고**
 *   · S/N 형식이 달라 생산월을 못 읽으면 "대상 아님"이 아니라 **"판정 불가"**
 * 라고 적는다. 5만 시간을 넘긴 4년 미만 장비를 "대상 아님"이라고 잘라 말하면
 * 그건 틀린 답이다.
 * ============================================================================
 */

/** 제목 형식에 쓸 수 있는 치환자. 화면이 이 목록을 그대로 안내한다. */
export const INTAKE_MAIL_PLACEHOLDERS = [
  "{{인수번호}}",
  "{{고객사}}",
  "{{모델}}",
  "{{S/N}}",
  "{{접수일}}",
] as const;

export type IntakeMailTemplate = {
  /** 제목 형식. 치환자를 쓸 수 있다. */
  subject: string;
  /** 자료 위에 붙는 인사말. 비워도 된다. */
  intro: string;
  /** 자료 아래에 붙는 맺음말. 비워도 된다. */
  outro: string;
};

export const DEFAULT_INTAKE_MAIL_TEMPLATE: IntakeMailTemplate = {
  subject: "[A/S 접수] {{인수번호}} · {{고객사}} · {{모델}} · S/N {{S/N}}",
  intro: "아래와 같이 A/S 접수되었습니다.",
  outro: "문의는 담당 엔지니어에게 부탁드립니다.",
};

/** 이번에 접수된 건. */
export type IntakeMailCase = {
  intakeNumber: string;
  /** "2026-09-01" */
  receivedAt: string;
  customerName: string;
  endUserName: string | null;
  modelName: string;
  serialNumber: string | null;
  lotNumber: string | null;
  reportedSymptom: string | null;
  billingType: BillingType | null;
  overhaul: OverhaulAssessment;
};

/**
 * 같은 제품의 과거 접수 한 줄.
 *
 * **같은 모델 이력은 담지 않는다.** 조회는 둘을 갈라 주지만(동일 제품 /
 * 동일 모델 참고) 이 메일에는 동일 제품만 싣는다 — 사용자 결정(2026-08-31).
 */
export type IntakeMailHistoryRow = {
  intakeNumber: string;
  receivedAt: string;
  reportedSymptom: string | null;
  actualShipmentDate: string | null;
};

const EMPTY = "-";

function orDash(value: string | null | undefined): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed : EMPTY;
}

/**
 * O/H 한 줄. 세 갈래 전부 OP TIME 을 언급한다 — 판정 근거가 반쪽인 것을
 * 감추지 않는 것이 이 줄의 목적이다.
 */
export function formatOverhaulLine(assessment: OverhaulAssessment): string {
  if (assessment.kind === "UNKNOWN") {
    return "판정 불가 (S/N 형식이 달라 생산월을 읽을 수 없음) · OP TIME 미확인";
  }
  const basis = `생산 ${formatProduction(assessment.production)}, ${formatElapsed(assessment.monthsElapsed)}`;
  const verdict = assessment.isDue ? "대상" : "대상 아님";
  return `${verdict} (${basis}) · OP TIME 미확인`;
}

/** 제목 형식의 치환자를 값으로 바꾼다. 모르는 치환자는 **그대로 둔다** — 조용히 지우면 사람이 오타를 눈치채지 못한다. */
export function fillPlaceholders(template: string, target: IntakeMailCase): string {
  return template
    .replaceAll("{{인수번호}}", orDash(target.intakeNumber))
    .replaceAll("{{고객사}}", orDash(target.customerName))
    .replaceAll("{{모델}}", orDash(target.modelName))
    .replaceAll("{{S/N}}", orDash(target.serialNumber))
    .replaceAll("{{접수일}}", orDash(target.receivedAt));
}

function customerLine(target: IntakeMailCase): string {
  const endUser = target.endUserName?.trim();
  return endUser ? `${target.customerName} (End-User: ${endUser})` : orDash(target.customerName);
}

function productLine(target: IntakeMailCase): string {
  return [
    orDash(target.modelName),
    `S/N ${orDash(target.serialNumber)}`,
    `L/N ${orDash(target.lotNumber)}`,
  ].join(" · ");
}

/**
 * 고정폭 글꼴에서 이 글자가 차지하는 칸 수. 한글·한자·전각은 2칸이다.
 *
 * `padEnd` 를 그냥 쓰면 안 되는 이유가 여기 있다 — 그건 **글자 수**를 세므로
 * "인수번호"(4글자=8칸)와 "O/H"(3글자=3칸)에 같은 자릿수를 주고, 결과적으로
 * 메일에서 값이 들쭉날쭉 어긋난다. 실제로 그렇게 짰다가 어긋난 것을 보고
 * 고쳤다.
 */
export function displayWidth(text: string): number {
  let width = 0;
  for (const char of text) {
    width += /[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE6F\uFF00-\uFF60\uFFE0-\uFFE6]/.test(char)
      ? 2
      : 1;
  }
  return width;
}

/** 이름표가 차지하는 칸. 가장 넓은 이름표("인수번호" 8칸)보다 넉넉하게 잡는다. */
const LABEL_WIDTH = 10;

/** "  이름      값" — 이름표를 칸 수로 맞춰 값이 한 줄에 서게 한다. */
function field(label: string, value: string): string {
  const pad = " ".repeat(Math.max(1, LABEL_WIDTH - displayWidth(label)));
  return `  ${label}${pad}${value}`;
}

function historySection(history: IntakeMailHistoryRow[]): string[] {
  if (history.length === 0) {
    return ["■ 이 제품의 과거 접수", "  없습니다 — 이 시스템에 남은 접수 기록 기준입니다."];
  }
  const lines = [`■ 이 제품의 과거 접수 (${history.length}건)`];
  for (const row of history) {
    const shipped = row.actualShipmentDate ? `(출하 ${row.actualShipmentDate})` : "(미출하)";
    lines.push(`  ${row.intakeNumber}  ${row.receivedAt}  ${orDash(row.reportedSymptom)}  ${shipped}`);
  }
  return lines;
}

export type ComposedIntakeMail = { subject: string; body: string };

export function composeIntakeMail(input: {
  template: IntakeMailTemplate;
  intake: IntakeMailCase;
  history: IntakeMailHistoryRow[];
}): ComposedIntakeMail {
  const { template, intake, history } = input;

  const blocks: string[] = [];

  const intro = template.intro.trim();
  if (intro) blocks.push(intro);

  blocks.push(
    [
      "■ 이번 접수",
      field("인수번호", intake.intakeNumber),
      field("접수일", intake.receivedAt),
      field("고객사", customerLine(intake)),
      field("제품", productLine(intake)),
      field("증상", orDash(intake.reportedSymptom)),
      // billingType 이 없는 접수가 실제로 있다(Excel 이관의 추후결정 등).
      // 빈칸으로 두지 않고 "-" 로 적어, 칸을 빠뜨린 것이 아님을 보이게 한다.
      field("유/무상", intake.billingType ? billingTypeLabels[intake.billingType] : EMPTY),
      field("O/H", formatOverhaulLine(intake.overhaul)),
    ].join("\n")
  );

  blocks.push(historySection(history).join("\n"));

  const outro = template.outro.trim();
  if (outro) blocks.push(outro);

  return {
    subject: fillPlaceholders(template.subject, intake),
    body: blocks.join("\n\n"),
  };
}

/**
 * 미리보기용 예시 값.
 *
 * 실제 접수 건을 끌어오지 않는 이유: 설정 화면은 **문구를 고치는 자리**이고,
 * 거기에 실제 고객사·S/N·증상이 뜰 이유가 없다. 예시는 값이 고정이라 문구를
 * 고칠 때마다 같은 자리에서 같은 모양으로 비교된다.
 *
 * 일부러 어려운 값을 골랐다 — 과거 이력 2건, End-User 있음, O/H 대상.
 */
export const INTAKE_MAIL_PREVIEW_SAMPLE: {
  intake: IntakeMailCase;
  history: IntakeMailHistoryRow[];
} = {
  intake: {
    intakeNumber: "D260901",
    receivedAt: "2026-09-01",
    customerName: "(예시) 교산",
    endUserName: "(예시) 반도체 1공장",
    modelName: "MFC-3000",
    serialNumber: "1904097",
    lotNumber: "LN-2019-04",
    reportedSymptom: "Bias Fwd Drop 발생",
    billingType: "PAID",
    overhaul: {
      kind: "ASSESSED",
      production: { year: 2019, month: 4, sequence: 97 },
      monthsElapsed: 89,
      isDue: true,
      opTimeUnknown: true,
    },
  },
  history: [
    {
      intakeNumber: "D250312",
      receivedAt: "2025-03-12",
      reportedSymptom: "RF 출력 불안정",
      actualShipmentDate: "2025-04-02",
    },
    {
      intakeNumber: "D231107",
      receivedAt: "2023-11-07",
      reportedSymptom: "전원 인가 시 무반응",
      actualShipmentDate: "2023-11-29",
    },
  ],
};
