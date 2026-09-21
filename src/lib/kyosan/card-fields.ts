import {
  findLabelCells,
  readDateValue,
  readValuesFor,
  type GridLike,
  type LabelMatcher,
} from "./card-grid";

/**
 * ============================================================================
 * 교산 연락서 Card 계열 시트 — 어떤 항목을 어떤 라벨로 찾는가 (2026-09-21, S1)
 * ============================================================================
 * `card-grid.ts` 가 「라벨을 찾아 값을 읽는 법」이라면, 여기는 **무엇을 찾을지의
 * 목록**이다. 라벨 글자는 전부 실측에서 왔다 — %TEMP%/kyosan-version-map.md 의
 * B절(라벨 지도)과 실제 파일을 열어 본 결과다. 짐작으로 넣은 라벨은 없다.
 *
 * ── 앞머리를 얼마나 길게 적는가 ────────────────────────────────────────
 * 앞머리가 짧으면 남의 라벨을 먹는다. 실측에서 걸린 것들:
 *  · `客先` → `客先希望納期` · `客先依頼書番号` · `客先故障状況①` · `客先指示日`
 *    까지 잡는다. 그래서 `客先(customer)` 로 못 박았다.
 *  · `l/n` 은 `製造l/n` 을 잡지 않는다(앞머리 일치라서). 둘을 따로 뽑는다.
 *  · `詳細` 은 `詳細な内容(Requirements)`(반품 사유)와 `詳細(Details/Comments)`
 *    (원인 상세) 둘을 먹는다. 뒤엣것은 `詳細(details` 로 괄호까지 적어 가른다.
 *  · `進捗状況` 은 큰 제목 `８．進捗状況(State_of_Progress)` 도 같이 잡힐 것
 *    같지만 그 열쇠는 `8.진…` 으로 시작하므로 앞머리 일치에 걸리지 않는다.
 *
 * ── 🔴 동그라미 번호는 열쇠에서 **보통 숫자**가 된다 ──────────────────
 * `normalizeKey` 의 `NFKC` 가 `①` 을 `1` 로 바꾼다(호환 분해). 그래서 라벨
 * `故障①/⑥` 의 열쇠는 `故障1/6` 이고, `予防措置⑪` 은 `予防措置11` 이다.
 * 정규식에 `[①-⑳]` 를 적으면 **하나도 맞지 않는다** — 실측에서 교체 부품이
 * 469장 전부 옛 양식 되돌림으로 새어 흘렀고, 한 장에 하나씩만 잡혔다.
 * 반드시 `\d` 로 적는다. (`故障\d` 는 `故障箇所`·`故障個所1/6` 을 잡지 않는다 —
 * 그쪽은 숫자가 아니라 한자로 이어진다.)
 *
 * ── 목록 항목과 「옛 양식」 되돌림 ────────────────────────────────────
 * 증상·고장 부위·교체 부품은 줄이 여럿이다. 2020년대 양식은 줄마다 라벨이
 * 붙어 있고(`客先故障状況①`·`故障①/⑥`), 2010년대 양식은 라벨 하나 아래에
 * `①②③` 칸이 늘어선다. 그래서 목록마다 **주 라벨**과 **옛 양식 되돌림 라벨**을
 * 둘 다 적어 두고, 주 라벨이 하나도 없을 때만 되돌림을 쓴다. 되돌림 쪽의 동그라미
 * 번호 처리는 `card-grid.ts` 의 `readValuesFor` 가 이미 한다.
 *
 * ── 🔴 못 뽑으면 「없음」 ──────────────────────────────────────────────
 * 값이 없으면 `null`, 목록이면 빈 배열이다. 빈 글자나 `-` 를 값인 척 돌려주지
 * 않는다. 사람이 나중에 확인할 때 「비었다」와 「틀렸다」는 하늘과 땅 차이다.
 * 그래서 `labelAddress` 를 함께 돌려준다 — **라벨 자체가 없었나**(판본이 그
 * 항목을 안 쓴다)와 **라벨은 있는데 칸이 비었나**를 가를 수 있어야 S2·S3 가
 * 어디를 손볼지 정할 수 있다.
 * ============================================================================
 */

/** 값을 어떻게 읽을 것인가. `date` 만 일련번호를 `YYYY-MM-DD` 로 푼다. */
export type CardFieldKind = "text" | "date";

export type CardFieldKey =
  | "managementId"
  | "filledDate"
  | "repairCenter"
  | "receivedDate"
  | "intakeNumber"
  | "unitType"
  | "investigationStartDate"
  | "investigationEndDate"
  | "partsOrderedDate"
  | "partsArrivedDate"
  | "repairStartDate"
  | "repairEndDate"
  | "shippedDate"
  | "returnTo"
  | "customerDueDate"
  | "customer"
  | "endUser"
  | "country"
  | "equipmentName"
  | "customerRequestNo"
  | "customerContact"
  | "unitName"
  | "model"
  | "lotNumber"
  | "serialNumber"
  | "manufacturingLot"
  | "shippedYearMonth"
  | "usagePeriod"
  | "operatingHours"
  | "recallCount"
  | "requirementDetail"
  | "situationDetail"
  | "causeDetail"
  | "causeCategory"
  | "judgementId"
  | "repairReportNo"
  | "investigationReportNo"
  | "estimatedManHour"
  | "actualManHour"
  | "repairManHour"
  | "progress"
  | "notes";

export type CardFieldSpec = {
  key: CardFieldKey;
  /** 보고서·통계 표에 적을 짧은 이름. 고객 내용이 아니라 **양식의 항목 이름**이다. */
  caption: string;
  kind: CardFieldKind;
  labels: readonly LabelMatcher[];
};

/**
 * 뽑는 항목들. 차례는 Card 시트를 위에서 아래로 읽는 차례다 — 통계 표가 양식을
 * 따라 읽히도록.
 */
export const CARD_FIELDS: readonly CardFieldSpec[] = [
  { key: "managementId", caption: "관리ID", kind: "text", labels: ["管理id"] },
  { key: "filledDate", caption: "기입일", kind: "date", labels: ["記入日"] },
  { key: "repairCenter", caption: "수리 장소", kind: "text", labels: ["修理場所"] },
  { key: "receivedDate", caption: "인수일", kind: "date", labels: ["引取日"] },
  { key: "intakeNumber", caption: "접수번호", kind: "text", labels: ["引取no"] },
  { key: "unitType", caption: "유닛 종류", kind: "text", labels: ["ユニット(type)"] },
  { key: "investigationStartDate", caption: "조사 시작일", kind: "date", labels: ["調査開始日"] },
  { key: "investigationEndDate", caption: "조사 완료일", kind: "date", labels: ["調査完了日"] },
  { key: "partsOrderedDate", caption: "부품 수배일", kind: "date", labels: ["部品手配日"] },
  { key: "partsArrivedDate", caption: "부품 도착일", kind: "date", labels: ["部品到着日"] },
  { key: "repairStartDate", caption: "수리 착수일", kind: "date", labels: ["修理着手日"] },
  { key: "repairEndDate", caption: "수리 완료일", kind: "date", labels: ["修理完了日"] },
  { key: "shippedDate", caption: "반납일", kind: "date", labels: ["返却日"] },
  { key: "returnTo", caption: "반납처", kind: "text", labels: ["返却先"] },
  { key: "customerDueDate", caption: "고객 희망 납기", kind: "date", labels: ["客先希望納期"] },
  { key: "customer", caption: "고객사", kind: "text", labels: ["客先(customer)"] },
  { key: "endUser", caption: "납입처(END USER)", kind: "text", labels: ["納入先"] },
  { key: "country", caption: "지역", kind: "text", labels: ["地域"] },
  { key: "equipmentName", caption: "장치명/P-N", kind: "text", labels: ["装置名"] },
  { key: "customerRequestNo", caption: "고객 의뢰서 번호", kind: "text", labels: ["客先依頼書番号"] },
  { key: "customerContact", caption: "고객 담당자", kind: "text", labels: ["ご担当"] },
  { key: "unitName", caption: "유닛명", kind: "text", labels: ["ユニット名"] },
  { key: "model", caption: "모델", kind: "text", labels: ["型式"] },
  { key: "lotNumber", caption: "L/N", kind: "text", labels: ["l/n"] },
  { key: "serialNumber", caption: "S/N", kind: "text", labels: ["s/n"] },
  { key: "manufacturingLot", caption: "제조 L/N", kind: "text", labels: ["製造l/n"] },
  { key: "shippedYearMonth", caption: "출하 연월", kind: "date", labels: ["出荷年月"] },
  { key: "usagePeriod", caption: "사용 연수", kind: "text", labels: ["使用年数"] },
  { key: "operatingHours", caption: "가동 시간", kind: "text", labels: ["op.time"] },
  { key: "recallCount", caption: "RECALL 횟수", kind: "text", labels: ["recall_count"] },
  { key: "requirementDetail", caption: "반품 사유 상세", kind: "text", labels: ["詳細な内容"] },
  { key: "situationDetail", caption: "불량 현상 상세", kind: "text", labels: ["不具合現象の詳細"] },
  { key: "causeDetail", caption: "원인 상세", kind: "text", labels: ["詳細(details"] },
  { key: "causeCategory", caption: "원인 구분", kind: "text", labels: ["区分"] },
  { key: "judgementId", caption: "판정 ID", kind: "text", labels: [/^id$/] },
  { key: "repairReportNo", caption: "수리보고서 번호", kind: "text", labels: ["修理報告書番号"] },
  { key: "investigationReportNo", caption: "조사보고서 번호", kind: "text", labels: ["調査報告書番号"] },
  { key: "estimatedManHour", caption: "견적 공수", kind: "text", labels: ["見積工数"] },
  { key: "actualManHour", caption: "실작업 공수", kind: "text", labels: ["実作業工数"] },
  { key: "repairManHour", caption: "수리 공수", kind: "text", labels: ["修理工数"] },
  { key: "progress", caption: "진척 상황", kind: "text", labels: ["進捗状況"] },
  { key: "notes", caption: "비고", kind: "text", labels: ["備考(notes", "備考/要望"] },
];

export type CardListKey =
  | "customerFaults"
  | "internalFindings"
  | "brokenPoints"
  | "faultParts"
  | "preventiveParts";

export type CardListSpec = {
  key: CardListKey;
  caption: string;
  /** 2020년대 양식 — 줄마다 라벨이 붙는다. */
  labels: readonly LabelMatcher[];
  /** 🔴 2010년대 양식 되돌림 — 라벨 하나 아래 `①②③` 칸이 늘어선다. */
  legacyLabels: readonly LabelMatcher[];
};

export const CARD_LISTS: readonly CardListSpec[] = [
  {
    key: "customerFaults",
    caption: "고객 고장 상황",
    labels: ["客先故障状況"],
    legacyLabels: ["現象("],
  },
  {
    key: "internalFindings",
    caption: "사내 확인 결과",
    labels: ["社内確認結果"],
    legacyLabels: ["状況("],
  },
  {
    key: "brokenPoints",
    caption: "고장 부위",
    // 실측에 `故障個所` 와 `故障箇所` 가 둘 다 있다(판본마다 한자가 다르다).
    labels: [/^故障[個箇]所/],
    legacyLabels: ["主な故障箇所"],
  },
  {
    key: "faultParts",
    caption: "교체 부품(고장)",
    // 🔴 `[①-⑳]` 가 아니라 `\d` 다 — 위 머리말 「동그라미 번호는 보통 숫자가 된다」.
    labels: [/^故障\d/],
    legacyLabels: ["交換部品("],
  },
  {
    key: "preventiveParts",
    caption: "교체 부품(예방)",
    labels: [/^予防措置\d/],
    legacyLabels: ["予防措置("],
  },
];

/**
 * 항목 하나의 결과.
 *  · `value === null` 이면 **없음**이다.
 *  · `labelAddress === null` 이면 **그 판본에 그 라벨이 아예 없다**.
 *    라벨은 있는데 `value` 가 null 이면 **사람이 안 적은 것**이다. 이 둘을 가르는
 *    것이 S2·S3 가 어디를 손볼지 정하는 근거다(머리말 참조).
 */
export type CardFieldValue = {
  value: string | null;
  labelAddress: string | null;
  valueAddress: string | null;
};

export type CardListValue = {
  values: readonly string[];
  /** 찾은 라벨 수. 0 이면 그 판본에 그 묶음이 없다. */
  labelCount: number;
  /** 옛 양식 되돌림으로 읽었는가. 통계에서 양식 세대를 세는 데 쓴다. */
  usedLegacy: boolean;
};

export type CardFields = {
  fields: Readonly<Record<CardFieldKey, CardFieldValue>>;
  lists: Readonly<Record<CardListKey, CardListValue>>;
};

const MISSING: CardFieldValue = { value: null, labelAddress: null, valueAddress: null };

/** 항목 하나를 읽는다. 라벨이 여럿 걸리면 **값이 있는 첫 라벨**을 쓴다. */
export function readCardField(
  grid: GridLike,
  spec: CardFieldSpec,
  date1904: boolean
): CardFieldValue {
  let firstLabelAddress: string | null = null;

  for (const matcher of spec.labels) {
    for (const label of findLabelCells(grid, matcher)) {
      firstLabelAddress ??= label.address;

      if (spec.kind === "date") {
        const found = readDateValue(grid, label, date1904);
        if (found) return { value: found.text, labelAddress: label.address, valueAddress: found.address };
        continue;
      }

      const [found] = readValuesFor(grid, label);
      if (found) return { value: found.text, labelAddress: label.address, valueAddress: found.address };
    }
  }

  return firstLabelAddress === null ? MISSING : { ...MISSING, labelAddress: firstLabelAddress };
}

/** 목록 항목 하나를 읽는다. 주 라벨이 하나도 없으면 옛 양식 되돌림을 쓴다. */
export function readCardList(grid: GridLike, spec: CardListSpec): CardListValue {
  const primary = collect(grid, spec.labels);
  if (primary.labelCount > 0) return { ...primary, usedLegacy: false };

  const legacy = collect(grid, spec.legacyLabels);
  return { ...legacy, usedLegacy: legacy.labelCount > 0 };
}

function collect(
  grid: GridLike,
  matchers: readonly LabelMatcher[]
): { values: string[]; labelCount: number } {
  const values: string[] = [];
  const seen = new Set<string>();
  let labelCount = 0;

  for (const matcher of matchers) {
    for (const label of findLabelCells(grid, matcher)) {
      labelCount += 1;
      for (const found of readValuesFor(grid, label)) {
        // 같은 글자가 RF부(C)와 DC부(F)에 한 번씩 적히는 판본이 있다. 보고서 줄로
        // 쓸 것이므로 **같은 글자는 한 번만** 남긴다.
        if (seen.has(found.text)) continue;
        seen.add(found.text);
        values.push(found.text);
      }
    }
  }

  return { values, labelCount };
}

/** Card 계열 시트 하나를 통째로 읽는다. */
export function readCardFields(grid: GridLike, date1904: boolean): CardFields {
  const fields = {} as Record<CardFieldKey, CardFieldValue>;
  for (const spec of CARD_FIELDS) fields[spec.key] = readCardField(grid, spec, date1904);

  const lists = {} as Record<CardListKey, CardListValue>;
  for (const spec of CARD_LISTS) lists[spec.key] = readCardList(grid, spec);

  return { fields, lists };
}
