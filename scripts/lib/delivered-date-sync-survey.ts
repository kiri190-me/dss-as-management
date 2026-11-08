import { foldBlankToNull } from "../../src/lib/domain/domestic-order-list";

/**
 * ============================================================================
 * 내자 `납품일` ↔ 수리 건 `실제 출하일` — **옮기기 전에 무엇이 어떻게 적혀 있나**
 * ============================================================================
 * DB 도 화면도 모르는 순수 함수다. 받은 자료를 세기만 하고, 실제로 읽어 오는 일은
 * `scripts/check-delivered-date-sync.ts` 가 한다 — 이웃
 * `scripts/lib/requested-due-date-sync-survey.ts` 와 같은 나눔이고 같은 이유다
 * (세는 규칙은 값으로 시험할 수 있어야 한다).
 *
 * ── 🔴 왜 세어야 하는가 ─────────────────────────────────────────────────
 * 2026-11-07 사용자 요구는 **내자정리의 납품일을 납기요청일 줄에 달고, 수리 건의 실제
 * 출하일과 양방향으로 잇는** 것이다. 그것은 **자료를 옮기는 일**인데, 운영에 지금 무엇이
 * 어떻게 적혀 있는지 아무도 모른다. 2026-10-30 에 납기일을 묶을 때도 세는 도구를 먼저
 * 만들고 그 수를 보고 설계를 정했다 — 이 파일은 그 자리의 같은 일을 한다.
 *
 * ── 🔴 **그 일이 2026-11-08 에 끝났다 — 이 도구는 자리를 바꿨다** ─────────
 * 납품일·납품자는 이제 `domestic_order_due_dates` 의 행에 있고(결정 1), 화면이 그리는
 * 값도 그 행이다. **옛 칸(`domestic_orders.delivered_date`·`delivered_by`)은 지우지
 * 않았지만 A/S 는 그리지도 쓰지도 않는다**(결정 11 — PO 가 같은 DB 에서 쓴다).
 *
 * 🔴 그래서 이 도구가 세는 자리도 **둘**이 되었다. 아래 ①~⑧ 의 칸 여섯은 **옛 칸**을
 * 재는 수 그대로다 — 한 글자도 안 바꿨고, 그 수가 계속 두 가지를 증명한다: **A/S 가
 * 더 이상 그 칸에 안 쓴다**는 것과, **PO 가 거기 적어 둔 값이 몇인지**. 🔴 다만 그
 * 수만 보고 「두 날짜가 맞다」고 읽으면 안 된다. 화면이 그리는 납품일은 새 자리이고,
 * 그쪽은 아래 `deliveredRows`·`deliveredByRows` 가 센다. 이름을 ②③ 과 다르게 둔 까닭이
 * 그것이다 — 같은 이름을 쓰면 다음에 읽는 사람이 한 수인 줄 안다.
 *
 * 🔴 **두 칸은 애초에 다른 사실을 적는 칸이다.** `delivered_date` 는 내자 시트의
 * 「납품일」이고(사람이 손으로 적는다 — 그 표의 `delivered_by` 가 바로 옆에 있다),
 * `actual_shipment_date` 는 수리 건이 **우리 손을 떠난 날**이다. 보내는 날과 받는 날
 * 사이에는 운송이 끼어 있어, 둘이 며칠 어긋나 있는 것이 **잘못이 아닐 수 있다.**
 * 그래서 이 도구는 「몇 줄이 다른가」만 세지 않고 **얼마나, 어느 쪽으로 벌어져 있는지**를
 * 함께 센다 — 며칠씩 한 방향으로 쏠려 있으면 그것은 오타가 아니라 두 칸이 서로 다른
 * 사실을 적고 있다는 뜻이고, 한쪽으로 묶는 순간 그 사실 하나가 사라진다.
 *
 * ── 🔴 「다르다」는 **날짜가 다르면 다르다** ────────────────────────────
 * 며칠까지는 같은 것으로 쳐 주는 여유를 **두지 않는다.** 둘 다 `date` 칸이라 시각도
 * 시간대도 없고(비교는 "YYYY-MM-DD" 글자 그대로다), 무엇보다 여유를 두면 **이 도구가
 * 재려던 것을 그 여유가 가린다**: 운송 때문에 3일씩 벌어진 줄을 「같다」로 세면 사람은
 * 「거의 다 같으니 묶어도 된다」고 읽는다. 벌어진 날수는 숨기지 않고 따로 세어 함께 찍고,
 * 그것을 보고 「운송 시차인가 오타인가」를 **사람이** 정한다.
 *
 * ── 🔴 갈래는 `repair_case_id` **하나로** 가른다 ────────────────────────
 * 「수리 건이 붙은 줄」과 「기타건(수리 건이 없는 줄)」을 가르는 것은 그 칸 하나다 —
 * 인수번호 글자(`intake_number_text`)가 아니다. 그 글자는 **연결을 못 찾은 줄에도 남아
 * 있어서**(schema/domestic-orders.ts 의 그 칸 주석), 그것으로 가르면 수리 건과 이어지지
 * 않은 줄이 조용히 다른 갈래로 샌다. 🔴 「기타건 현황」이 쓰는 조건(`listMiscDomesticOrders`
 * 의 `is_deleted = false` + `repair_case_id IS NULL`)과 **같아야** 한다 — 다르면 이 도구와
 * 그 화면이 같은 것을 두고 다른 수를 말한다.
 *
 * 🔵 그래서 **수리 건이 휴지통에 든 줄도 「수리 건이 붙은 줄」에 그대로 둔다.** 그 줄은
 * 기타건 현황에 뜨지 않으므로(repair_case_id 가 차 있다) 여기서 빼면 두 갈래의 합이
 * 살아 있는 줄 전체보다 작아진다. 대신 그런 줄이 몇인지 `caseInTrashLines` 로 따로 세어
 * 숨기지 않는다.
 *
 * ── 🔴 「못 읽었다」와 「없다」를 가른다 ─────────────────────────────────
 * `repair_case_id` 가 차 있는데 수리 건을 못 읽어 온 줄은 `case-unreadable` 칸에 들어간다.
 * 0 이 아니면 조인이 샌 것이고, 그때 ④(실제 출하일이 적힌 줄)는 **적게 세어진 수**다.
 * 그 줄을 「출하일이 없는 줄」로 접으면 그 사실이 영영 안 드러난다.
 *
 * ── 🔴 **이름도 글자도 꺼내지 않는다** ──────────────────────────────────
 * 납품자(`delivered_by`)는 **적혀 있나만** 불리언으로 받는다 — 그 칸은 사람 이름이고
 * (`users` FK 가 아니라 시트 그대로의 글자다) 그 표의 PII 항목에 적혀 있다. 납기요청일
 * 행의 비고(`note`)도 같다(「1차분」일 수도, 담당자 이름일 수도 있다). 고객사·형식·L/N·
 * S/N 은 애초에 이 타입에 들어올 자리가 없다.
 *
 * 🔵 본보기에 찍는 글자는 **접수번호 하나뿐**이고, 그것도 수리 건이 붙은 줄에만 있다.
 * 기타건 줄은 **본보기를 만들지 않는다** — 그 줄을 가리킬 글자가 발주서번호·고객사·
 * 인수번호 글자뿐인데, 셋 다 꺼내지 않기로 한 것들이다. 기타건 쪽은 수로만 말한다.
 *
 * ── 🔴 **읽기만 한다** ──────────────────────────────────────────────────
 * 이 파일에는 고칠 값을 내놓는 함수가 하나도 없다. 「옮길 때 어느 쪽 값이 이기나」를
 * 여기서 정하지 않는 것도 일부러다 — 재는 도구에 그 답을 미리 적어 두면 다음 조각이
 * 그것을 설계 결정으로 물려받는다. 그 결정은 이 수를 보고 사람이 한다.
 * ============================================================================
 */

/**
 * 내자 줄에 달린 납기요청일 한 행. `hasNote` 는 비고가 **적혀 있나**만 말한다(글자는
 * 안 읽는다).
 *
 * 🔴 **납품 둘이 2026-11-08 에 이 행으로 옮겨 왔다**(사용자 결정 1). 그래서 이 도구가
 * 세는 자리도 둘이 되었다 — 옛 칸(`domestic_orders.delivered_date`)과 **새 자리(이
 * 행)**. 옛 칸 쪽 셈(아래 bucket 여섯)은 한 글자도 안 바꿨다: 그 수가 **A/S 가 더
 * 이상 그 칸에 안 쓴다**는 사실을 계속 증명해 주고, PO 가 거기 적어 둔 값이 몇인지도
 * 그 수로만 알 수 있다. 🔴 다만 그 수만 보고 「두 날짜가 맞다」고 읽으면 안 된다 —
 * 화면이 그리는 납품일은 이제 이 행의 값이다.
 */
export type SurveyDueDateRow = {
  dueDate: string;
  hasNote: boolean;
  /** 🔴 **새 자리**의 납품일(`domestic_order_due_dates.delivered_date`). */
  deliveredDate: string | null;
  /** 🔴 **새 자리**의 납품자가 적혀 있나. 이름은 이 타입에 들어오지 않는다(머리말의 PII). */
  hasDeliveredBy: boolean;
};

/** 내자 줄에 붙은 수리 건에서 읽어 온 것. 🔴 여기 있는 글자는 접수번호뿐이다. */
export type SurveyRepairCase = {
  /**
   * 건을 묶는 열쇠(수리 건 id). 🔴 **찍지 않는다** — ⑭(한 건에 줄이 여럿)을 세려고
   * 묶는 데만 쓴다. 접수번호로 묶지 않는 까닭은 그 칸이 UNIQUE 가 아니기 때문이다.
   */
  key: string;
  /** 접수번호. 본보기에 찍는 **하나뿐인 글자**다. */
  intakeNumber: string;
  /** 실제 출하일(`repair_cases.actual_shipment_date`). */
  actualShipmentDate: string | null;
  /** 그 수리 건이 휴지통에 들어 있나. 🔵 갈래를 가르지는 않는다(파일 머리말). */
  isDeleted: boolean;
};

/** 살아 있는 내자 줄 하나. */
export type SurveyOrderLine = {
  /**
   * 🔴 갈래를 가르는 **하나뿐인 값** — `repair_case_id` 가 차 있나. 기타건 현황이 보는
   * 그 칸이다. 아래 `repairCase` 의 유무로 갈래를 정하지 않는 것은 일부러다: 조인이
   * 새면 수리 건이 붙은 줄이 조용히 기타건으로 세어진다.
   */
  linkedToRepairCase: boolean;
  /** 붙은 수리 건. `linkedToRepairCase` 가 참인데 null 이면 **못 읽은 줄**이다. */
  repairCase: SurveyRepairCase | null;
  /** 손으로 적은 납품일(`domestic_orders.delivered_date`). */
  deliveredDate: string | null;
  /** 납품자가 **적혀 있나**만. 🔴 이름은 이 타입에 들어오지 않는다(파일 머리말). */
  hasDeliveredBy: boolean;
  /** 옛 칸(`domestic_orders.requested_due_date`)에 값이 남아 있나 — ⑫. 날짜는 안 받는다. */
  hasLegacyRequestedDueDate: boolean;
  /** 그 줄에 달린 납기요청일 행 전부(`domestic_order_due_dates`). */
  dueDateRows: readonly SurveyDueDateRow[];
};

/** 갈래. 🔴 기타건 현황과 같은 기준이다(파일 머리말). */
export type LineKind = "linked" | "misc";

/**
 * 수리 건이 붙은 줄이 어느 칸에 들어가는가. 여섯은 **서로 겹치지 않고 빠짐도 없다** —
 * 부르는 쪽이 여섯의 합과 「수리 건이 붙은 줄 수」를 맞대어 검산할 수 있어야 한다.
 */
export type LineBucket =
  /** 양쪽 다 적혔고 다르다. ← 한쪽으로 묶으면 **덮인다** */
  | "differ"
  /** 양쪽 다 적혔고 같다 */
  | "same"
  /** 납품일만 적혔다 — 수리 건 쪽으로 밀 값이 있다 */
  | "delivered-only"
  /** 실제 출하일만 적혔다 — 내자 쪽으로 끌어올 값이 있다 */
  | "shipment-only"
  /** 둘 다 비었다 */
  | "neither"
  /** 🔴 수리 건을 **못 읽었다**. 0 이 아니면 위 다섯은 믿을 수 없다(파일 머리말) */
  | "case-unreadable";

/** 납기요청일 행이 몇인가 — ⑨. `many` 는 둘 이상이다(분할 납품이 그 모습이다). */
export type DueDateRowBuckets = {
  none: number;
  one: number;
  many: number;
};

/** 갈래별로 가른 수. 두 수를 더하면 그 조건에 걸린 줄 전체다. */
export type KindCount = {
  linked: number;
  misc: number;
};

export type LineVerdict = {
  kind: LineKind;
  /** 수리 건이 붙은 줄만 칸을 받는다. 기타건 줄은 null — 견줄 상대가 아예 없다. */
  bucket: LineBucket | null;
  deliveredDate: string | null;
  /** 접은 뒤의 실제 출하일. 기타건 줄과 못 읽은 줄은 null. */
  actualShipmentDate: string | null;
  /**
   * ⑤ 의 벌어짐 — **양수면 납품일이 더 늦다**(보낸 뒤에 받았다는 뜻이고, 운송이 끼면
   * 그 모습이 정상이다). 칸이 `differ` 가 아니면 null 이다.
   */
  gapDays: number | null;
  /**
   * 🔴 `differ` 인데 날수를 **못 쟀다**(날짜 꼴이 아니다). 0 일과 가르려고 따로 든다 —
   * 0 으로 접으면 「같은 날인데 다른 줄」이라는 있을 수 없는 수가 보고에 선다.
   */
  gapUnmeasured: boolean;
  /** 그 줄에 달린 납기요청일 행 수. */
  dueDateRowCount: number;
  /** 그중 비고가 적힌 행 수 — ⑩. 🔴 글자는 안 읽는다. */
  notedDueDateRows: number;
  /** 🔴 그중 **새 자리**에 납품일이 적힌 행 수(2026-11-08). */
  deliveredRows: number;
  /** 🔴 그중 **새 자리**에 납품자가 적힌 행 수. 이름은 세지도 담지도 않는다. */
  deliveredByRows: number;
  /**
   * ⑪ 의 쓸모 — 납품일이 그 줄의 납기요청일 **가운데 하나와 같은가.** 같으면 「어느 행에
   * 달 것인가」가 자료만으로 정해진다. 납품일이 없거나 행이 없으면 거짓이다.
   */
  deliveredDateMatchesADueDate: boolean;
  hasDeliveredBy: boolean;
  hasLegacyRequestedDueDate: boolean;
  /** 🔵 붙은 수리 건이 휴지통인가. 갈래는 그대로 `linked` 다(파일 머리말). */
  caseInTrash: boolean;
  /**
   * 🔴 말이 어긋난 줄 — `linkedToRepairCase` 가 거짓인데 수리 건이 실려 왔다. 부르는 쪽의
   * 조회가 샌 것이고, 그 줄의 실제 출하일은 **쓰지 않는다**(기타건으로 센다).
   */
  contradictory: boolean;
};

/** 보고에 찍는 한 줄. 🔴 글자는 접수번호뿐이고 나머지는 날짜와 수다. */
export type SurveySample = {
  intakeNumber: string;
  deliveredDate: string | null;
  actualShipmentDate: string | null;
  gapDays: number | null;
  dueDateRowCount: number;
};

export type Survey = {
  /** 살아 있는 내자 줄 전부. `linkedLines + miscLines` 와 같다(검산 항목). */
  lines: number;
  /** ① 갈래별 줄 수. */
  linkedLines: number;
  miscLines: number;
  /** 🔵 그중 붙은 수리 건이 **휴지통**인 줄 — 빼지 않았다(파일 머리말). */
  caseInTrashLines: number;
  /** 🔴 말이 어긋난 줄 — 0 이 아니면 조회가 샜다. */
  contradictoryLines: number;
  /** ② 납품일이 적힌 줄. */
  deliveredDateLines: KindCount;
  /** ③ 납품자가 적힌 줄. 🔴 이름은 세지도 담지도 않는다. */
  deliveredByLines: KindCount;
  /** 🔵 납품자는 적혔는데 납품일이 없는 줄 — 「누가 했는지는 아는데 언제인지 모른다」. */
  deliveredByWithoutDateLines: KindCount;
  /** ④ 실제 출하일이 적힌 줄(수리 건이 붙은 줄만 가질 수 있다). */
  shipmentDateLines: number;
  /** ⑤⑥⑦⑧ — 수리 건이 붙은 줄을 여섯 칸으로. 합은 `linkedLines` 와 같다. */
  buckets: Record<LineBucket, number>;
  /** ⑤ 안의 방향과 벌어짐. */
  differ: {
    /** 손으로 적은 납품일이 **더 늦다**(출하 뒤에 납품 — 운송이 끼면 이 모습이다). */
    deliveredLater: number;
    /** 손으로 적은 납품일이 **더 이르다**(출하 전에 납품 — 설명이 필요한 쪽이다). */
    deliveredEarlier: number;
    /** 🔴 벌어진 날수를 못 잰 줄. 0 이 아니면 아래 날수들은 그만큼 못 본 수다. */
    unmeasured: number;
    /** 가장 크게 벌어진 날수(절댓값). 잴 줄이 하나도 없으면 null — 0 이 아니다. */
    gapDaysMaxAbs: number | null;
    /** 가운데쯤(절댓값의 **아래쪽 가운데값**). 아래 `lowerMedian` 머리말 참조. */
    gapDaysMedianAbs: number | null;
    /** 부호를 살린 양 끝 — 한 방향으로 쏠려 있는지가 여기서 드러난다. */
    gapDaysMin: number | null;
    gapDaysMax: number | null;
  };
  /** ⑨ 납기요청일 행 수의 분포 — 갈래별. 각 갈래의 세 칸 합은 그 갈래의 줄 수다. */
  dueDateRowBuckets: { linked: DueDateRowBuckets; misc: DueDateRowBuckets };
  /** 납기요청일 행 수 합계 — 갈래별. */
  dueDateRows: KindCount;
  /** ⑩ 비고가 적힌 납기요청일 행 — 갈래별. 🔴 글자는 안 읽는다. */
  notedDueDateRows: KindCount;
  /**
   * 🔴 **새 자리**에 납품일이 적힌 행 — 갈래별(2026-11-08). 위 ② 와 **다른 수**다:
   * ② 는 옛 칸(`domestic_orders.delivered_date`)이고 이것은 화면이 실제로 그리는 값이다.
   */
  deliveredRows: KindCount;
  /** 🔴 **새 자리**에 납품자가 적힌 행 — 갈래별. 🔴 이름은 세지도 담지도 않는다. */
  deliveredByRows: KindCount;
  /** ⑪ 납기요청일 행이 **둘 이상인데** 납품일이 적힌 줄 — 어느 행에 달지가 모호하다. */
  ambiguousTargetLines: KindCount;
  /** 그중 납품일이 그 줄의 납기요청일 **하나와 같은** 줄 — 달 자리가 자료로 정해진다. */
  ambiguousTargetLinesMatchingADueDate: KindCount;
  /** ⑫ 옛 칸(`requested_due_date`)에 값이 남은 줄. */
  legacyRequestedDueDateLines: KindCount;
  /** ⑬ 납기요청일 행이 **하나도 없는데** 납품일이 적힌 줄 — 달 행이 아예 없다. */
  deliveredWithoutDueDateRowLines: KindCount;
  /** ⑭ 내자 줄이 **둘 이상**인 수리 건과, 그 건들에 붙은 줄 수의 합. */
  multiLineCases: number;
  multiLineCaseLines: number;
  /**
   * 🔴 그 건들 가운데 줄들의 납품일이 **서로 다른** 건(빈 칸은 빼고 세어 두 가지 이상).
   * 수리 건에는 실제 출하일 칸이 하나뿐이라, 그런 건은 「어느 납품일을 올릴 것인가」에
   * 자료만으로는 답할 수 없다.
   */
  multiLineCasesWithDifferentDeliveredDates: number;
  samples: {
    differ: SurveySample[];
    noDueDateRow: SurveySample[];
    ambiguous: SurveySample[];
    multiLine: SurveySample[];
  };
};

/** "YYYY-MM-DD" 인가. 🔵 `date` 칸이라 다른 꼴이 올 수 없지만, 왔을 때 지어내지 않으려고 본다. */
const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 두 날짜 사이의 **달력 날수**. `from` 이 뒤면 양수다.
 *
 * 🔴 여기서 한 벌 더 짜는 까닭: `domain/date-only.ts` 의 날짜 셈은 **「오늘」과의 차이**만
 * 내놓고(daysSinceIntake), 두 날짜를 받는 길은 내보내지 않는다. 그 파일의 규율 —
 * 「UTC 자정으로 바꿔 놓고 빼라, Date 끼리 밀리초로 빼지 마라」 — 은 그대로 따른다.
 * 🔵 시간대를 타지 않는 셈이다: 양쪽 다 `date` 칸이라 시각이 없고, 같은 자로 바꾼 뒤
 * 빼기 때문에 서머타임도 KST 경계도 끼어들 자리가 없다.
 *
 * 날짜 꼴이 아니면 **null 이다 — 0 이 아니다.** 「같은 날」과 「못 쟀다」는 다른 말이다.
 */
function calendarDaysBetween(from: string, to: string): number | null {
  if (!DATE_ONLY_PATTERN.test(from) || !DATE_ONLY_PATTERN.test(to)) return null;
  const [fromYear, fromMonth, fromDay] = from.split("-").map(Number);
  const [toYear, toMonth, toDay] = to.split("-").map(Number);
  const fromUtc = Date.UTC(fromYear, fromMonth - 1, fromDay);
  const toUtc = Date.UTC(toYear, toMonth - 1, toDay);
  if (Number.isNaN(fromUtc) || Number.isNaN(toUtc)) return null;
  return Math.round((fromUtc - toUtc) / 86_400_000);
}

/**
 * 가운데쯤 — **아래쪽 가운데값**이다(짝수 개면 작은 쪽).
 *
 * 🔴 두 값의 평균을 쓰지 않는 까닭: 3일과 4일뿐인 묶음에서 「3.5일」이 찍히면, 그 수를
 * 읽는 사람은 **그런 줄이 있다고 읽는다.** 여기 찍히는 날수는 전부 실제로 어떤 줄에
 * 적혀 있는 날수여야 한다.
 */
function lowerMedian(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor((sorted.length - 1) / 2)];
}

/** 그 줄 하나를 판정한다 — 파일 머리말의 정의가 전부 여기 있다. */
export function classifyDeliveredDateLine(line: SurveyOrderLine): LineVerdict {
  const deliveredDate = foldBlankToNull(line.deliveredDate);

  let dueDateRowCount = 0;
  let notedDueDateRows = 0;
  let deliveredRows = 0;
  let deliveredByRows = 0;
  let deliveredDateMatchesADueDate = false;
  for (const row of line.dueDateRows) {
    // 날짜가 빈 행은 「납기일이 비어 있다」가 아니라 **행이 아니다**(그 표의 due_date 는
    // NOT NULL 이다). 비고만 남은 행도 마찬가지로 세지 않는다.
    const dueDate = foldBlankToNull(row.dueDate);
    if (dueDate === null) continue;
    dueDateRowCount += 1;
    if (row.hasNote) notedDueDateRows += 1;
    // 🔴 **새 자리** — 화면이 그리는 납품일은 2026-11-08 부터 이 값이다.
    if (foldBlankToNull(row.deliveredDate) !== null) deliveredRows += 1;
    if (row.hasDeliveredBy) deliveredByRows += 1;
    if (deliveredDate !== null && dueDate === deliveredDate) deliveredDateMatchesADueDate = true;
  }

  const base = {
    deliveredDate,
    dueDateRowCount,
    notedDueDateRows,
    deliveredRows,
    deliveredByRows,
    deliveredDateMatchesADueDate,
    hasDeliveredBy: line.hasDeliveredBy,
    hasLegacyRequestedDueDate: line.hasLegacyRequestedDueDate,
  };

  // 🔴 갈래는 `linkedToRepairCase` 하나로 정한다. 수리 건이 실려 왔는지는 보지 않는다 —
  //    조회가 새면 수리 건이 붙은 줄이 조용히 기타건으로 세어진다(파일 머리말).
  if (!line.linkedToRepairCase) {
    return {
      ...base,
      kind: "misc",
      bucket: null,
      actualShipmentDate: null,
      gapDays: null,
      gapUnmeasured: false,
      caseInTrash: false,
      // 기타건이라고 해 놓고 수리 건을 실어 보냈다면 그 사실을 삼키지 않는다.
      contradictory: line.repairCase !== null,
    };
  }

  const repairCase = line.repairCase;
  if (repairCase === null) {
    // 🔴 「없다」가 아니라 「못 읽었다」다. 출하일 없는 줄로 접지 않는다(파일 머리말).
    return {
      ...base,
      kind: "linked",
      bucket: "case-unreadable",
      actualShipmentDate: null,
      gapDays: null,
      gapUnmeasured: false,
      caseInTrash: false,
      contradictory: false,
    };
  }

  const actualShipmentDate = foldBlankToNull(repairCase.actualShipmentDate);
  const linked = {
    ...base,
    kind: "linked" as const,
    actualShipmentDate,
    caseInTrash: repairCase.isDeleted,
    contradictory: false,
  };

  if (deliveredDate === null && actualShipmentDate === null) {
    return { ...linked, bucket: "neither", gapDays: null, gapUnmeasured: false };
  }
  if (actualShipmentDate === null) {
    return { ...linked, bucket: "delivered-only", gapDays: null, gapUnmeasured: false };
  }
  if (deliveredDate === null) {
    return { ...linked, bucket: "shipment-only", gapDays: null, gapUnmeasured: false };
  }
  if (deliveredDate === actualShipmentDate) {
    return { ...linked, bucket: "same", gapDays: null, gapUnmeasured: false };
  }

  // 🔴 여유(며칠까지는 같은 것으로 쳐 주기)를 두지 않는다 — 파일 머리말의 「다르다」.
  const gapDays = calendarDaysBetween(deliveredDate, actualShipmentDate);
  return { ...linked, bucket: "differ", gapDays, gapUnmeasured: gapDays === null };
}

function toSample(intakeNumber: string, verdict: LineVerdict): SurveySample {
  return {
    intakeNumber,
    deliveredDate: verdict.deliveredDate,
    actualShipmentDate: verdict.actualShipmentDate,
    gapDays: verdict.gapDays,
    dueDateRowCount: verdict.dueDateRowCount,
  };
}

function bumpKind(counts: KindCount, kind: LineKind): void {
  if (kind === "linked") counts.linked += 1;
  else counts.misc += 1;
}

/**
 * 줄들을 통째로 세어 보고에 쓸 수를 만든다.
 *
 * 본보기는 **들어온 차례 그대로** 앞에서부터 `sampleLimit` 개만 담는다 — 부르는 쪽이
 * 접수번호순으로 읽어 오므로 돌릴 때마다 같은 줄이 찍힌다.
 */
export function summarizeDeliveredDateSync(
  lines: readonly SurveyOrderLine[],
  sampleLimit = 20
): Survey {
  // ⑭ 먼저 — 「이 줄이 줄 여럿인 건의 한 줄인가」는 전체를 한 번 훑어야 알 수 있고,
  // 본보기를 담을 때 그 답이 이미 있어야 한다.
  const linesPerCase = new Map<string, number>();
  for (const line of lines) {
    const key = line.linkedToRepairCase ? line.repairCase?.key : undefined;
    if (key === undefined) continue;
    linesPerCase.set(key, (linesPerCase.get(key) ?? 0) + 1);
  }
  const deliveredDatesPerCase = new Map<string, Set<string>>();

  const survey: Survey = {
    lines: lines.length,
    linkedLines: 0,
    miscLines: 0,
    caseInTrashLines: 0,
    contradictoryLines: 0,
    deliveredDateLines: { linked: 0, misc: 0 },
    deliveredByLines: { linked: 0, misc: 0 },
    deliveredByWithoutDateLines: { linked: 0, misc: 0 },
    shipmentDateLines: 0,
    buckets: {
      differ: 0,
      same: 0,
      "delivered-only": 0,
      "shipment-only": 0,
      neither: 0,
      "case-unreadable": 0,
    },
    differ: {
      deliveredLater: 0,
      deliveredEarlier: 0,
      unmeasured: 0,
      gapDaysMaxAbs: null,
      gapDaysMedianAbs: null,
      gapDaysMin: null,
      gapDaysMax: null,
    },
    dueDateRowBuckets: {
      linked: { none: 0, one: 0, many: 0 },
      misc: { none: 0, one: 0, many: 0 },
    },
    dueDateRows: { linked: 0, misc: 0 },
    notedDueDateRows: { linked: 0, misc: 0 },
    deliveredRows: { linked: 0, misc: 0 },
    deliveredByRows: { linked: 0, misc: 0 },
    ambiguousTargetLines: { linked: 0, misc: 0 },
    ambiguousTargetLinesMatchingADueDate: { linked: 0, misc: 0 },
    legacyRequestedDueDateLines: { linked: 0, misc: 0 },
    deliveredWithoutDueDateRowLines: { linked: 0, misc: 0 },
    multiLineCases: 0,
    multiLineCaseLines: 0,
    multiLineCasesWithDifferentDeliveredDates: 0,
    samples: { differ: [], noDueDateRow: [], ambiguous: [], multiLine: [] },
  };

  const gaps: number[] = [];

  for (const line of lines) {
    const verdict = classifyDeliveredDateLine(line);
    const kind = verdict.kind;
    // 🔴 본보기에 쓸 글자는 **판정이 `linked` 일 때만** 꺼낸다. 말이 어긋난 줄
    //    (기타건이라면서 수리 건을 실어 온 줄)에서 접수번호가 새 나가지 않게 한다.
    const intakeNumber = kind === "linked" ? (line.repairCase?.intakeNumber ?? null) : null;

    if (kind === "linked") survey.linkedLines += 1;
    else survey.miscLines += 1;
    if (verdict.caseInTrash) survey.caseInTrashLines += 1;
    if (verdict.contradictory) survey.contradictoryLines += 1;

    if (verdict.deliveredDate !== null) bumpKind(survey.deliveredDateLines, kind);
    if (verdict.hasDeliveredBy) {
      bumpKind(survey.deliveredByLines, kind);
      if (verdict.deliveredDate === null) bumpKind(survey.deliveredByWithoutDateLines, kind);
    }
    if (verdict.actualShipmentDate !== null) survey.shipmentDateLines += 1;
    if (verdict.hasLegacyRequestedDueDate) bumpKind(survey.legacyRequestedDueDateLines, kind);

    if (verdict.bucket !== null) survey.buckets[verdict.bucket] += 1;
    if (verdict.bucket === "differ") {
      if (verdict.gapDays === null) survey.differ.unmeasured += 1;
      else {
        gaps.push(verdict.gapDays);
        if (verdict.gapDays > 0) survey.differ.deliveredLater += 1;
        else survey.differ.deliveredEarlier += 1;
      }
      if (intakeNumber !== null && survey.samples.differ.length < sampleLimit) {
        survey.samples.differ.push(toSample(intakeNumber, verdict));
      }
    }

    const rowBuckets = survey.dueDateRowBuckets[kind];
    if (verdict.dueDateRowCount === 0) rowBuckets.none += 1;
    else if (verdict.dueDateRowCount === 1) rowBuckets.one += 1;
    else rowBuckets.many += 1;

    if (kind === "linked") {
      survey.dueDateRows.linked += verdict.dueDateRowCount;
      survey.notedDueDateRows.linked += verdict.notedDueDateRows;
      survey.deliveredRows.linked += verdict.deliveredRows;
      survey.deliveredByRows.linked += verdict.deliveredByRows;
    } else {
      survey.dueDateRows.misc += verdict.dueDateRowCount;
      survey.notedDueDateRows.misc += verdict.notedDueDateRows;
      survey.deliveredRows.misc += verdict.deliveredRows;
      survey.deliveredByRows.misc += verdict.deliveredByRows;
    }

    if (verdict.deliveredDate !== null && verdict.dueDateRowCount >= 2) {
      bumpKind(survey.ambiguousTargetLines, kind);
      if (verdict.deliveredDateMatchesADueDate) {
        bumpKind(survey.ambiguousTargetLinesMatchingADueDate, kind);
      }
      if (intakeNumber !== null && survey.samples.ambiguous.length < sampleLimit) {
        survey.samples.ambiguous.push(toSample(intakeNumber, verdict));
      }
    }
    if (verdict.deliveredDate !== null && verdict.dueDateRowCount === 0) {
      bumpKind(survey.deliveredWithoutDueDateRowLines, kind);
      if (intakeNumber !== null && survey.samples.noDueDateRow.length < sampleLimit) {
        survey.samples.noDueDateRow.push(toSample(intakeNumber, verdict));
      }
    }

    const key = line.linkedToRepairCase ? line.repairCase?.key : undefined;
    if (key !== undefined && (linesPerCase.get(key) ?? 0) >= 2) {
      survey.multiLineCaseLines += 1;
      let dates = deliveredDatesPerCase.get(key);
      if (dates === undefined) {
        dates = new Set<string>();
        deliveredDatesPerCase.set(key, dates);
      }
      if (verdict.deliveredDate !== null) dates.add(verdict.deliveredDate);
      if (intakeNumber !== null && survey.samples.multiLine.length < sampleLimit) {
        survey.samples.multiLine.push(toSample(intakeNumber, verdict));
      }
    }
  }

  for (const lineCount of linesPerCase.values()) {
    if (lineCount >= 2) survey.multiLineCases += 1;
  }
  for (const dates of deliveredDatesPerCase.values()) {
    if (dates.size >= 2) survey.multiLineCasesWithDifferentDeliveredDates += 1;
  }

  const absoluteGaps = gaps.map((gap) => Math.abs(gap));
  survey.differ.gapDaysMaxAbs = absoluteGaps.length === 0 ? null : Math.max(...absoluteGaps);
  survey.differ.gapDaysMedianAbs = lowerMedian(absoluteGaps);
  survey.differ.gapDaysMin = gaps.length === 0 ? null : Math.min(...gaps);
  survey.differ.gapDaysMax = gaps.length === 0 ? null : Math.max(...gaps);

  return survey;
}

/**
 * 셈이 샜는가. 🔴 어긋나면 그 수로 설계를 정하면 안 된다 — 부르는 쪽이 이것으로 **멈춘다.**
 *
 * 눈으로 검산할 수 없는 수다(운영 자료). 그래서 스스로 검산할 길을 들고 있어야 한다 —
 * 이웃 `requested-due-date-sync-survey.ts` 의 `bucketTotalMismatch` 와 같은 규율이고,
 * 여기서는 볼 것이 넷이라 **처음 어긋난 하나**를 글로 돌려준다.
 */
export function deliveredDateSurveyMismatch(survey: Survey): string | null {
  if (survey.linkedLines + survey.miscLines !== survey.lines) {
    return (
      `갈래의 합 ${survey.linkedLines + survey.miscLines}줄이 전체 ${survey.lines}줄과 ` +
      "다릅니다 — 갈래 가르기가 샜습니다."
    );
  }
  const bucketTotal = Object.values(survey.buckets).reduce((sum, value) => sum + value, 0);
  if (bucketTotal !== survey.linkedLines) {
    return (
      `칸의 합 ${bucketTotal}줄이 수리 건이 붙은 줄 ${survey.linkedLines}줄과 ` +
      "다릅니다 — 셈이 샜습니다."
    );
  }
  const directionTotal =
    survey.differ.deliveredLater + survey.differ.deliveredEarlier + survey.differ.unmeasured;
  if (directionTotal !== survey.buckets.differ) {
    return (
      `방향의 합 ${directionTotal}줄이 「다른 줄」 ${survey.buckets.differ}줄과 ` +
      "다릅니다 — 셈이 샜습니다."
    );
  }
  for (const kind of ["linked", "misc"] as const) {
    const buckets = survey.dueDateRowBuckets[kind];
    const rowBucketTotal = buckets.none + buckets.one + buckets.many;
    const expected = kind === "linked" ? survey.linkedLines : survey.miscLines;
    if (rowBucketTotal !== expected) {
      return (
        `납기요청일 행 분포의 합 ${rowBucketTotal}줄이 그 갈래의 줄 ${expected}줄과 ` +
        "다릅니다 — 셈이 샜습니다."
      );
    }
  }
  if (survey.contradictoryLines > 0) {
    return (
      `수리 건이 안 붙었다고 해 놓고 수리 건이 실려 온 줄이 ${survey.contradictoryLines}줄 ` +
      "있습니다 — 조회가 샜습니다."
    );
  }
  return null;
}
