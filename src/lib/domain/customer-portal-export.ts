import {
  partsNameFromModelName,
  readManualValues,
  type CustomerPortalForm,
  type PortalSystemField,
} from "./customer-portal-forms";

/**
 * ============================================================================
 * 고객사 양식 표를 **엑셀로 내보낼 때**의 규칙 — 파일 이름 · 탭 · 줄 자료 (순수)
 * ============================================================================
 * 화면의 고객사 양식 표(customer-portal-forms.ts)를 공유폴더의 **직전 파일에 이어**
 * 엑셀로 내보낸다. 이 파일은 그 일의 «판단»만 담는다 — zip 도 디스크도 모른다.
 * 실제로 통합문서를 손보는 것은 xlsx/customer-portal-export-workbook.ts 이고,
 * 폴더를 읽고 쓰는 것은 storage/customer-portal-archive.ts 다.
 *
 * ── 🔴 열은 여기서 다시 정하지 않는다 ────────────────────────────────────
 * 열 구성 · 차례 · 보일 이름은 전부 customer-portal-forms.ts 것을 **읽어 쓴다.**
 * 여기서 한 벌 더 적으면 화면과 엑셀이 다른 표를 보이게 되고, 그 순간 둘 중 하나가
 * 거짓이 된다. 이 파일이 더하는 것은 «그 열이 엑셀 칸에서 어떤 값이 되는가»뿐이다.
 *
 * ── 양식마다 다른 세 가지 (실측 2026-09-30, 공유폴더의 실제 파일) ──────────
 *
 *          | 탭 이름            | 탭을 쌓는가              | 셀에 날짜
 *   ICD    | 수리 Parts (ICD)   | 하나를 덮어쓴다          | 없다
 *   INVENIA| 만든 날짜 YYMMDD   | 하나 — 이름만 새 날짜로  | 없다
 *   JUSUNG | 만든 날짜 YYMMDD   | 🔴 새 탭을 **앞에** 더한다 | N1
 *
 * 🔴 **JUSUNG 의 탭은 최신이 앞이다.** 실측: 첫 탭 `260929`(sheetId 88) …
 * 마지막 탭 `241217`(sheetId 3), 84장. 그래서 «가장 최근 탭»은 첫 탭이고 새 탭도
 * 맨 앞에 넣는다. 지시서에는 「탭을 더한다」까지만 있었고 방향은 적혀 있지 않았다 —
 * 뒤에 붙이면 사람이 여는 순간 최신이 맨 끝에 가 있다.
 *
 * 🔴 **하루에 한 탭이다.** 탭 이름이 곧 만든 날짜라, 같은 날 두 번 저장하면서 탭을
 * 또 더하면 같은 이름의 탭이 둘 생긴다 — 엑셀이 열지 못하는 파일이다. 오늘 탭이 이미
 * 있으면 더하지 않고 **그 탭을 갈아 끼운다**(xlsx/customer-portal-export-workbook.ts).
 *
 * ── 파일 이름 (실측) ────────────────────────────────────────────────────
 *   ICD      수리 품목 현황 관련 정리 자료_260928.xlsx
 *   INVENIA_RF Gen Matcher 수리 현황_260929.xlsx
 *   JUSUNG_LGD RF Gen Matcher 수리 현황_260929.xlsx
 * 셋 다 `…_YYMMDD.xlsx` 다. 이름의 앞머리(ICD · INVENIA · JUSUNG)가 그 고객사의 것을
 * 가리고, 뒤의 여섯 자리가 만든 날짜다. **새 이름은 직전 이름의 날짜만 오늘로 갈아
 * 끼운다** — 가운데 글자(사람이 붙인 제목)는 우리가 짓지 않는다.
 * ============================================================================
 */

/** 어느 탭을 본으로 삼는가. */
export type PortalExportModelSheet =
  /** 이름이 고정된 탭(ICD). 없으면 실패다 — 다른 탭을 짐작해 고르지 않는다. */
  | { kind: "NAME"; name: string }
  /** 탭 차례의 **첫째**. JUSUNG 은 최신이 앞이고, INVENIA 는 탭이 하나뿐이다. */
  | { kind: "FIRST_TAB" };

/** 만든 결과를 어느 탭에 담는가. */
export type PortalExportSheetPlacement =
  /** 본으로 삼은 탭을 **그대로 덮어쓴다**(ICD — 이름도 그대로). */
  | { kind: "REPLACE" }
  /** 본으로 삼은 탭을 덮어쓰되 **이름만** 오늘 날짜로 바꾼다(INVENIA). */
  | { kind: "REPLACE_AND_RENAME" }
  /**
   * 본을 **베껴 새 탭**을 맨 앞에 더한다. 본 탭은 한 글자도 바뀌지 않는다(JUSUNG).
   * 🔴 다만 **오늘 날짜 탭이 이미 있으면 더하지 않고 그 탭을 갈아 끼운다** — 하루에 한 탭이다.
   */
  | { kind: "PREPEND_COPY" };

export type CustomerPortalExportSpec = {
  /** customer-portal-forms.ts 의 양식 id 와 같다. */
  formId: string;
  /**
   * 공유폴더에서 이 고객사의 파일을 가리는 이름 앞머리. 뒤에 공백이나 밑줄이 와야
   * 맞는 것으로 본다 — 앞머리만 견주면 `ICD2` 같은 남의 파일이 딸려 온다.
   */
  fileNamePrefix: string;
  /** 머리글이 있는 줄(1부터). */
  headerRow: number;
  /** 표가 시작하는 열 문자. 셋 다 `B` 다(A 열은 여백). */
  firstColumn: string;
  modelSheet: PortalExportModelSheet;
  placement: PortalExportSheetPlacement;
  /** 그 주의 날짜를 적는 칸(JUSUNG 의 `N1`). 없으면 적지 않는다. */
  dateCell?: string;
};

const ICD_SPEC: CustomerPortalExportSpec = {
  formId: "ICD",
  fileNamePrefix: "ICD",
  headerRow: 5,
  firstColumn: "B",
  modelSheet: { kind: "NAME", name: "수리 Parts (ICD)" },
  placement: { kind: "REPLACE" },
};

const INVENIA_SPEC: CustomerPortalExportSpec = {
  formId: "INVENIA",
  fileNamePrefix: "INVENIA",
  headerRow: 3,
  firstColumn: "B",
  modelSheet: { kind: "FIRST_TAB" },
  placement: { kind: "REPLACE_AND_RENAME" },
};

const JUSUNG_SPEC: CustomerPortalExportSpec = {
  formId: "JUSUNG",
  fileNamePrefix: "JUSUNG",
  headerRow: 4,
  firstColumn: "B",
  modelSheet: { kind: "FIRST_TAB" },
  placement: { kind: "PREPEND_COPY" },
  dateCell: "N1",
};

export const CUSTOMER_PORTAL_EXPORT_SPECS: readonly CustomerPortalExportSpec[] = [
  ICD_SPEC,
  INVENIA_SPEC,
  JUSUNG_SPEC,
];

/** 양식 id 로 내보내기 규칙을 꺼낸다. 없으면 null(= 그 고객사는 내보내기가 없다). */
export function findPortalExportSpec(formId: string | null | undefined): CustomerPortalExportSpec | null {
  if (typeof formId !== "string" || formId === "") return null;
  return CUSTOMER_PORTAL_EXPORT_SPECS.find((spec) => spec.formId === formId) ?? null;
}

// ── 날짜 ─────────────────────────────────────────────────────────────────

/**
 * 만든 날짜 `YYMMDD`. 파일 이름과 탭 이름이 함께 쓴다.
 *
 * 🔴 **그 PC 의 달력 날짜**를 쓴다(UTC 가 아니다). 한국 시간 아침 9시 이전에 UTC 로
 * 찍으면 어제 날짜가 된다 — 사람이 파일을 보고 「어제 것 아닌가」 하게 된다.
 */
export function portalExportStamp(date: Date): string {
  if (Number.isNaN(date.getTime())) throw new Error("유효하지 않은 날짜입니다.");
  const year = String(date.getFullYear() % 100).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

// ── 파일 이름 ────────────────────────────────────────────────────────────

/** 이 기능이 읽고 쓰는 확장자. 엑셀 통합문서만 본다. */
export const PORTAL_EXPORT_EXTENSION = ".xlsx";

/** 같은 이름이 있을 때 붙이는 번호의 상한. 넘으면 사람이 폴더를 정리해야 한다. */
export const PORTAL_EXPORT_MAX_NUMBERED_COPIES = 99;

export type ParsedPortalExportFileName = {
  /** 날짜 앞까지 — 사람이 붙인 제목. 우리가 짓지 않고 물려받는다. */
  base: string;
  /** `YYMMDD`. */
  stamp: string;
  /** 같은 날 두 번 저장해 붙은 ` (2)` 의 숫자. 없으면 1. */
  copyNumber: number;
};

/**
 * `…_YYMMDD.xlsx` · `…_YYMMDD (2).xlsx` 를 갈라 읽는다. 모양이 아니면 null.
 *
 * ` (2)` 까지 읽는 까닭: 같은 날 두 번 저장하면 storage 가 덮어쓰지 않고 번호를 붙인다
 * (덮어쓰기는 하지 않는다). 그 파일이 다음 날 **직전 파일**로 뽑혀야 하므로 여기서
 * 읽을 수 있어야 한다 — 못 읽으면 두 번째 저장분이 영영 이어지지 않는다.
 */
export function parsePortalExportFileName(fileName: string): ParsedPortalExportFileName | null {
  if (typeof fileName !== "string") return null;
  // 엑셀이 열어 둔 파일의 잠금 파일(`~$…`)은 파일이 아니다.
  if (fileName.startsWith("~$") || fileName.startsWith(".")) return null;
  if (!fileName.toLowerCase().endsWith(PORTAL_EXPORT_EXTENSION)) return null;

  const stem = fileName.slice(0, fileName.length - PORTAL_EXPORT_EXTENSION.length);
  const numbered = /^(.*) \((\d+)\)$/.exec(stem);
  const withoutCopy = numbered ? numbered[1] : stem;
  const copyNumber = numbered ? Number(numbered[2]) : 1;
  if (!Number.isInteger(copyNumber) || copyNumber < 1) return null;

  const dated = /^(.*)_(\d{6})$/.exec(withoutCopy);
  if (!dated || dated[1] === "") return null;
  return { base: dated[1], stamp: dated[2], copyNumber };
}

/**
 * 그 고객사의 파일인가 — 이름 앞머리가 맞고, 그 뒤가 글자 · 숫자가 아니어야 한다.
 * (`INVENIA_…` · `ICD 수리…` 는 맞고, `ICD2_…` 는 아니다.) 대소문자는 가리지 않는다 —
 * 사람이 손으로 만든 파일이 섞이기 때문이다.
 */
export function matchesPortalExportPrefix(spec: CustomerPortalExportSpec, fileName: string): boolean {
  const prefix = spec.fileNamePrefix.toLowerCase();
  const name = fileName.toLowerCase();
  if (!name.startsWith(prefix)) return false;
  const next = name.charAt(prefix.length);
  return next === " " || next === "_" || next === "-";
}

export type PortalExportFolderEntry = {
  fileName: string;
  /** 디스크의 수정 시각(ms). 이름이 같은 날일 때의 곁가지 기준이다. */
  modifiedAtMs: number;
};

/**
 * ============================================================================
 * 🔴 **직전 파일 고르기** — 이름의 날짜가 먼저, 수정 시각은 곁가지
 * ============================================================================
 * 근거:
 *  · 이름의 여섯 자리는 **사람이 그 파일을 만든 날**이고, 이 폴더의 파일은 전부 그
 *    규칙으로 적혀 있다(실측). 사람이 고객사에 보낸 것도 그 이름의 파일이다.
 *  · 수정 시각은 못 믿는다 — NAS 로 복사하거나 옮기기만 해도 오늘로 바뀌고, 엑셀로
 *    열어 보기만 해도 바뀌는 경우가 있다. 그것으로 고르면 **아무도 고치지 않은 옛
 *    파일**이 「가장 최근」이 된다.
 *  · 그래서 차례는 «이름의 날짜 → 같은 날의 번호 → 수정 시각 → 이름» 이다. 수정 시각은
 *    날짜까지 같을 때만 쓰인다.
 *  · 이름 규칙에 안 맞는 파일(사람이 손으로 만든 `임시.xlsx` 따위)은 **아예 보지 않는다.**
 *    지어낸 서식으로 덮어쓰는 것보다 「직전 파일이 없습니다」가 낫다.
 * ============================================================================
 */
export function pickLatestPortalExportFile(
  spec: CustomerPortalExportSpec,
  entries: readonly PortalExportFolderEntry[]
): { entry: PortalExportFolderEntry; parsed: ParsedPortalExportFileName } | null {
  const candidates: { entry: PortalExportFolderEntry; parsed: ParsedPortalExportFileName }[] = [];
  for (const entry of entries) {
    if (!matchesPortalExportPrefix(spec, entry.fileName)) continue;
    const parsed = parsePortalExportFileName(entry.fileName);
    if (parsed === null) continue;
    candidates.push({ entry, parsed });
  }
  if (candidates.length === 0) return null;

  candidates.sort((left, right) => {
    if (left.parsed.stamp !== right.parsed.stamp) return left.parsed.stamp < right.parsed.stamp ? 1 : -1;
    if (left.parsed.copyNumber !== right.parsed.copyNumber) return right.parsed.copyNumber - left.parsed.copyNumber;
    if (left.entry.modifiedAtMs !== right.entry.modifiedAtMs) return right.entry.modifiedAtMs - left.entry.modifiedAtMs;
    return left.entry.fileName < right.entry.fileName ? 1 : -1;
  });
  return candidates[0];
}

/**
 * 직전 이름의 날짜만 오늘로 갈아 끼운 새 이름. 같은 날 붙었던 ` (2)` 는 떼어낸다 —
 * 그것은 「그날 두 번째로 저장했다」는 표시이지 제목의 일부가 아니다.
 */
export function nextPortalExportFileName(previous: ParsedPortalExportFileName, stamp: string): string {
  return `${previous.base}_${stamp}${PORTAL_EXPORT_EXTENSION}`;
}

/** `이름.xlsx` · `이름 (2).xlsx` … — 같은 이름이 이미 있을 때 다음 후보. */
export function numberedPortalExportFileName(fileName: string, copyNumber: number): string {
  if (copyNumber <= 1) return fileName;
  const stem = fileName.slice(0, fileName.length - PORTAL_EXPORT_EXTENSION.length);
  return `${stem} (${copyNumber})${PORTAL_EXPORT_EXTENSION}`;
}

// ── 머리글 대조 ──────────────────────────────────────────────────────────

/**
 * 머리글 한 칸을 견줄 수 있는 모양으로 다듬는다 — **첫 줄만**, 공백은 전부 뗀다.
 *
 * 🔴 첫 줄만 보는 까닭(실측 2026-09-30): ICD 의 마지막 머리글 칸은 한 칸 안에 네 줄이다.
 *
 *   중국 재 수출 마감 일자 (LGD CO 만)
 *   * 수리 시, 하기 날짜 참고 부탁드립니다.
 *   * 마감 일자는 해당 일자 전, 반드시 출하되어야 합니다.
 *   * 해당 마감 일자는 수리 납기가 아닙니다.
 *
 * 화면의 열 이름은 첫 줄뿐이다. 통째로 견주면 ICD 는 **언제나** 어긋나고, 그러면
 * 내보내기가 통째로 막힌다. 공백을 떼는 것은 사람이 칸 안에서 줄바꿈 · 띄어쓰기를
 * 자주 손보기 때문이다(뜻은 그대로다).
 */
export function normalizePortalExportHeader(text: string | null | undefined): string {
  if (typeof text !== "string") return "";
  const firstLine = text.split(/\r\n|\r|\n/)[0] ?? "";
  return firstLine.replace(/\s+/g, "");
}

// ── 줄 자료 ──────────────────────────────────────────────────────────────

/**
 * 엑셀 칸 하나에 들어갈 값. **어떤 칸으로 적을지는 여기서 정하지 않는다** — 그 자리에
 * 원래 있던 칸의 서식을 보고 통합문서 쪽이 정한다(날짜 서식이면 날짜, 아니면 글자).
 */
export type PortalExportCell =
  | { kind: "empty" }
  /**
   * 🔴 **줄바꿈이 들어 있을 수 있다** — 견적서 번호가 한 건에 여럿이면 `\n` 으로 이어
   * 한 칸에 들어온다(db/queries/customer-portal.ts 의 quoteNumber). 갈래를 따로 만들지
   * 않는 까닭: 값으로 보면 그냥 글자이고, 「한 칸에 두 줄로 **보이게** 하는 일」은 값이
   * 아니라 **서식**이다. 그 일은 통합문서 쪽이 한다(xlsx/customer-portal-export-workbook.ts
   * 의 isMultiLineText → wrapText). 여기서 갈래를 늘리면 같은 판단이 두 곳에 생긴다.
   */
  | { kind: "text"; text: string }
  | { kind: "number"; value: number }
  /** `YYYY-MM-DD`. 날짜 서식 칸이면 날짜로, 아니면 글자 그대로 적힌다. */
  | { kind: "date"; iso: string };

/**
 * 줄 하나를 만들 때 읽는 것. `CustomerPortalItem`(db/queries/customer-portal.ts)이
 * 이 모양을 그대로 만족한다 — 여기서 그 타입을 가져오지 않는 것은 이 파일이
 * `server-only` 를 끌어들이지 않게 하기 위해서다(화면도 이 파일을 읽는다).
 */
export type PortalExportItem = { [Field in PortalSystemField]: string | null } & {
  statusLabel: string | null;
  statusNote: string | null;
  formValues: Record<string, string>;
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * ⚠️ 다듬는 것은 **앞뒤**뿐이다(`trim`). 가운데 줄바꿈은 그대로 둔다 — 견적서 번호 여럿이
 * 한 칸에 `\n` 으로 들어오는 자리가 있다(위 PortalExportCell 주석).
 */
function textOrEmpty(value: string | null | undefined): PortalExportCell {
  const text = typeof value === "string" ? value.trim() : "";
  if (text === "") return { kind: "empty" };
  return ISO_DATE.test(text) ? { kind: "date", iso: text } : { kind: "text", text };
}

/**
 * 양식 표 한 줄을 엑셀 칸 값들로. **열 차례는 양식이 정한 그대로**이고 여기서 바꾸지 않는다.
 *
 * 갈래별로 하는 일은 화면(CustomerPortalScreen)이 그리는 것과 같다:
 *   ROW_NUMBER  위에서부터 매긴 번호(1부터)
 *   SYSTEM      `PortalSystemField` 와 `CustomerPortalItem` 의 칸 이름이 **같아서** 그대로 읽는다
 *   DERIVED     partsNameFromModelName — 모르는 모델명은 빈칸(짐작해 채우지 않는다)
 *   STATUS      고객 안내 상태의 이름
 *   NOTE        비고
 *   MANUAL      손으로 적은 값(readManualValues 로 «지금 양식의 칸»만 읽는다)
 *
 * ⚠️ 화면에서 빗금(`emptyMark: "SLASH"`)으로 보이는 빈 칸은 엑셀에서도 **빈 칸**이다.
 * 빗금은 화면의 그림이지 값이 아니고, 남의 양식 파일에 없던 대각선을 우리가 그려 넣지
 * 않는다.
 */
export function buildPortalExportRow(
  form: CustomerPortalForm,
  item: PortalExportItem,
  rowNumber: number
): PortalExportCell[] {
  const manual = readManualValues(form, item.formValues);
  return form.columns.map((column): PortalExportCell => {
    switch (column.kind) {
      case "ROW_NUMBER":
        return { kind: "number", value: rowNumber };
      case "SYSTEM":
        return textOrEmpty(item[column.field]);
      case "DERIVED":
        return textOrEmpty(partsNameFromModelName(item.modelName));
      case "STATUS":
        return textOrEmpty(item.statusLabel);
      case "NOTE":
        return textOrEmpty(item.statusNote);
      case "MANUAL":
        return textOrEmpty(manual[column.key]);
    }
  });
}

/** 표 전체. 줄 번호는 1부터 차례로 매긴다(화면의 `index + 1` 과 같다). */
export function buildPortalExportRows(
  form: CustomerPortalForm,
  items: readonly PortalExportItem[]
): PortalExportCell[][] {
  return items.map((item, index) => buildPortalExportRow(form, item, index + 1));
}
