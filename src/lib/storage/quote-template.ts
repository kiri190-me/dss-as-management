import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  QUOTE_WORK_SCOPE_SECTIONS,
  type QuoteWorkScopeSection,
} from "@/lib/validation/quote-input";
import type { QuoteTemplateKey } from "@/lib/domain/quote-template-variant";
import type { WorkScopeLabels } from "@/lib/xlsx/quote-sheet-layout";
import { QUOTE_WORK_SCOPE_LABELS } from "@/lib/xlsx/quote-template";
import { OH_QUOTE_WORK_SCOPE_LABELS } from "@/lib/xlsx/oh-quote-template";
import { MATCHER_WORK_SCOPE_LABELS } from "@/lib/xlsx/matcher-quote-template";

/**
 * ============================================================================
 * 견적서 원본 양식을 읽는 단 하나의 자리
 * ============================================================================
 * `내자견적서.xlsx` 에는 **법인 직인 이미지·계좌번호·사업자등록번호·대표자
 * 성명**이 들어 있다. 그래서 저장소에 커밋하지 않고, 경로를 환경변수로 받는다
 * (`.env.example` 의 같은 항목).
 *
 * ── 읽기 전용이다 ───────────────────────────────────────────────────────
 * 이 파일에 쓰기 함수가 없는 것은 실수가 아니다. 원본 양식은 프로그램이 절대
 * 고치지 않는다 — 값이 채워진 사본은 메모리에서 만들어 응답으로 흘려보내고
 * 디스크에 남기지 않는다(api/quotes/[id]/xlsx/route.ts).
 *
 * ── 캐시하지 않는다 ─────────────────────────────────────────────────────
 * 86KB 짜리 파일을 요청마다 한 번 읽는다. 캐시해 두면 양식을 바꾼 뒤 서버를
 * 다시 띄우기 전까지 옛 양식이 계속 나가고, 그 상태는 **잘못된 견적서가
 * 고객사로 나간 뒤에야** 드러난다. 회사 로고나 계좌가 바뀌는 날이 그날이다.
 * 파일 하나 읽는 비용보다 그쪽이 비싸다.
 * ============================================================================
 */

export class QuoteTemplateError extends Error {}

/**
 * 설정된 양식 경로. 없거나 빈 값이면 던진다 — 조용히 기본 경로로 넘어가면
 * 아무도 없는 자리를 가리킨 채 "파일을 찾을 수 없습니다"만 반복하게 된다.
 */
export function resolveQuoteTemplatePath(): string {
  const configured = process.env.QUOTE_TEMPLATE_PATH;
  if (!configured || configured.trim().length === 0) {
    throw new QuoteTemplateError(
      "QUOTE_TEMPLATE_PATH가 설정되지 않았습니다. 견적서 원본 양식 경로를 .env.local에 지정해야 합니다."
    );
  }
  return path.resolve(configured.trim());
}

/**
 * 양식 바이트. 못 읽으면 QuoteTemplateError 로 바꿔 던진다 — 부르는 쪽이
 * "설정 문제"와 "그 밖의 오류"를 가려 답할 수 있어야 하고, **경로를 사용자에게
 * 보여 주지 않기 위해서**이기도 하다(오류 메시지가 디스크 구조를 알려 주는
 * 창구가 되면 안 된다. 첨부 다운로드 라우트의 같은 판단).
 */
export async function readQuoteTemplate(): Promise<Buffer> {
  return readTemplateAt(resolveQuoteTemplatePath());
}

/**
 * OH 견적서 양식. **내자와 다른 파일이다**(`견적서 OH.xlsx`) — 시트 이름도 셀
 * 자리도 다르고, 외부 통합문서 링크까지 들어 있다(xlsx/oh-quote-template.ts).
 * 그래서 경로를 따로 받는다.
 */
export function resolveOhQuoteTemplatePath(): string {
  const configured = process.env.OH_QUOTE_TEMPLATE_PATH;
  if (!configured || configured.trim().length === 0) {
    throw new QuoteTemplateError(
      "OH_QUOTE_TEMPLATE_PATH가 설정되지 않았습니다. OH 견적서 양식 경로를 .env.local에 지정해야 합니다."
    );
  }
  return path.resolve(configured.trim());
}

export async function readOhQuoteTemplate(): Promise<Buffer> {
  return readTemplateAt(resolveOhQuoteTemplatePath());
}

async function readTemplateAt(templatePath: string): Promise<Buffer> {
  try {
    return await readFile(templatePath);
  } catch (err) {
    // 경로는 서버 로그에만 남긴다.
    console.error("[quote-template] 원본 양식을 읽지 못했다", {
      templatePath,
      error: err instanceof Error ? err.message : String(err),
    });
    throw new QuoteTemplateError("견적서 원본 양식을 읽을 수 없습니다. 관리자에게 문의해 주세요.");
  }
}

/**
 * ============================================================================
 * 양식에 적힌 회사 정보와 기본 문구
 * ============================================================================
 * PDF 미리보기가 쓴다. **코드에 베껴 적지 않는 이유가 둘이다.**
 *
 *  1. `은행계좌`가 여기 있다. 계좌번호를 코드나 DB 에 두지 않는다는 규칙은
 *     그대로 지키면서 화면에는 정본과 같은 값이 나와야 한다 — 양식에서 읽어
 *     오는 것이 그 둘을 동시에 만족하는 유일한 방법이다. 이 값은 **응답으로만
 *     흐르고 어디에도 저장되지 않는다.**
 *  2. 상호·대표자·주소·전화가 바뀌면 양식만 고치면 PDF 도 따라간다. 베껴 적어
 *     두면 두 벌이 되어, 양식을 고친 뒤로 xlsx 와 PDF 가 다른 회사처럼 보인다.
 *
 * 셀 주소는 원본 실측값이다(B3~B7 · E6 · E7 회사 정보, D15~D18 기본 문구).
 * 없는 칸은 null 로 돌려주고, 화면은 그 줄을 비운 채 그린다 — 양식이 바뀌어
 * 한 칸을 못 찾았다고 미리보기 전체가 실패하면 안 된다.
 * ============================================================================
 */

export type QuoteTemplateHeader = {
  companyName: string | null;
  ceoLine: string | null;
  address: string | null;
  tel: string | null;
  fax: string | null;
  email: string | null;
  homepage: string | null;
  defaultValidity: string | null;
  defaultDelivery: string | null;
  defaultPayment: string | null;
  bankAccount: string | null;
};

const HEADER_CELLS = {
  companyName: "B3",
  ceoLine: "B4",
  address: "B5",
  tel: "B6",
  fax: "E6",
  email: "B7",
  homepage: "E7",
  defaultValidity: "D15",
  defaultDelivery: "D16",
  defaultPayment: "D17",
  bankAccount: "D18",
} as const;

export async function readQuoteTemplateHeader(): Promise<QuoteTemplateHeader> {
  return readVariantHeader(TEMPLATE_VARIANTS["GENERATOR:DOMESTIC"]);
}

/**
 * ============================================================================
 * 🔴 양식은 넷이다 — 장비 종류 × 견적서 종류
 * ============================================================================
 * 처음에는 `내자 1 + OH 1` 두 벌이라고 보고 만들었는데, 실제로는 넷이고
 * **기본 문구가 넷 다 다르다**(2026-08-31 실측):
 *
 *   제너레이터 내자  납기 `발주일로부터 3주 이내`
 *   제너레이터 OH    납기 `발주일로부터 4주 이내`
 *   매쳐 내자        납기 `발행일로 부터 약 3개월 이내`
 *   매쳐 OH          납기 `발행일로 부터 6주`
 *
 * 그동안 시스템은 **제너레이터 내자 것 하나만** 읽었다. 그래서 O/H 견적서
 * 미리보기에 3주가 뜨는데 실제로 나가는 파일에는 4주가 찍히는, 화면과 문서가
 * 다른 말을 하는 상태였다.
 *
 * ── 🔴 매쳐는 셀 자리도 다르다 ─────────────────────────────────────────
 * 같은 주소로 읽으면 엉뚱한 값이 나온다 — 매쳐 D15 에는 유효기간이 아니라
 * **금액(숫자)** 이 들어 있다. 빈 줄이 더 있어 아래로 밀렸다:
 *
 *   구분        제너레이터   매쳐
 *   시트 이름   내자견적서/OH견적서   둘 다 `견적서`
 *   유효기간    D15          D17
 *   납기        D16          D18
 *   결재조건    D17          D19
 *   은행계좌    D18          D20
 *
 * 회사 정보(B3~B7 · E6 · E7)는 넷이 같다.
 *
 * ── 여기서 하는 것은 **문구까지**다 ────────────────────────────────────
 * 실제 xlsx 를 만드는 쪽(xlsx/quote-template.ts · oh-quote-template.ts)은 아직
 * 제너레이터 배치만 안다. 매쳐 양식으로 파일을 만들려면 채워 넣는 코드가 한 벌
 * 더 필요하고, 그것은 별도 작업이다.
 * ============================================================================
 */

/** 매쳐 양식의 기본 문구 자리. 회사 정보는 제너레이터와 같다. */
const MATCHER_HEADER_CELLS = {
  ...HEADER_CELLS,
  defaultValidity: "D17",
  defaultDelivery: "D18",
  defaultPayment: "D19",
  bankAccount: "D20",
} as const;

type TemplateVariant = {
  /** 이 양식 경로를 담은 환경변수 이름. */
  envVar: string;
  /** 사람이 읽는 이름. 설정이 빠졌을 때 어느 양식인지 말해 주려고 둔다. */
  label: string;
  sheetName: string;
  headerCells: Record<string, string>;
  /**
   * 작업 내역 세 묶음의 D열 머리글. **양식마다 다르다** — 제너레이터는
   * `인수 조사`, 매쳐는 `조사작업`, O/H 의 ② 는 `OH 및 수리 작업`.
   *
   * 🔴 글자를 여기 적지 않고 **xlsx 채우개가 들고 있는 것을 가져다 쓴다.** 두
   * 곳에 따로 적으면 한쪽만 고쳐지는 날이 오고, 그때 증상은 "화면에 뜨는 작업
   * 내역과 파일에 적히는 작업 내역이 다른" 것이다.
   */
  workScopeLabels: WorkScopeLabels;
};

/**
 * 넷의 설정.
 *
 * 제너레이터 둘은 **예전 이름을 그대로 쓴다** — 이미 `.env.local` 에 설정돼
 * 돌아가고 있는 값이라, 이름을 바꾸면 이 변경만으로 견적서가 안 나가게 된다.
 * 새로 생기는 매쳐 둘만 접두사를 붙인다.
 */
const TEMPLATE_VARIANTS: Record<string, TemplateVariant> = {
  "GENERATOR:DOMESTIC": {
    envVar: "QUOTE_TEMPLATE_PATH",
    label: "제너레이터 내자 견적서",
    sheetName: "내자견적서",
    headerCells: HEADER_CELLS,
    workScopeLabels: QUOTE_WORK_SCOPE_LABELS,
  },
  "GENERATOR:OVERHAUL": {
    envVar: "OH_QUOTE_TEMPLATE_PATH",
    label: "제너레이터 O/H 견적서",
    sheetName: "OH견적서",
    headerCells: HEADER_CELLS,
    workScopeLabels: OH_QUOTE_WORK_SCOPE_LABELS,
  },
  "MATCHER:DOMESTIC": {
    envVar: "MATCHER_QUOTE_TEMPLATE_PATH",
    label: "매쳐 내자 견적서",
    sheetName: "견적서",
    headerCells: MATCHER_HEADER_CELLS,
    workScopeLabels: MATCHER_WORK_SCOPE_LABELS,
  },
  "MATCHER:OVERHAUL": {
    envVar: "MATCHER_OH_QUOTE_TEMPLATE_PATH",
    label: "매쳐 O/H 견적서",
    sheetName: "견적서",
    headerCells: MATCHER_HEADER_CELLS,
    workScopeLabels: MATCHER_WORK_SCOPE_LABELS,
  },
};


/** 그 변형의 설정 경로. 설정이 빠졌으면 어느 양식인지 말해 주고 던진다. */
function resolveVariantPath(variant: TemplateVariant): string {
  const configured = process.env[variant.envVar];
  if (!configured || configured.trim().length === 0) {
    throw new QuoteTemplateError(
      `${variant.envVar} 가 설정되지 않았습니다. ${variant.label} 양식 경로를 .env.local 에 지정해야 합니다.`
    );
  }
  return path.resolve(configured.trim());
}

/**
 * 기종·종류에 맞는 양식 바이트.
 *
 * 위 `readQuoteTemplate`·`readOhQuoteTemplate` 는 제너레이터 둘만 읽는 예전
 * 길이고 그대로 남겨 둔다 — 이미 돌아가는 통로라 건드릴 이유가 없다. 넷 중
 * 하나를 골라야 하는 쪽(견적서 xlsx 라우트)이 이 길을 쓴다.
 */
export async function readQuoteTemplateFor(templateKey: QuoteTemplateKey): Promise<Buffer> {
  const variant = TEMPLATE_VARIANTS[templateKey];
  if (!variant) throw new QuoteTemplateError(`알 수 없는 양식 구분입니다: ${templateKey}`);
  return readTemplateAt(resolveVariantPath(variant));
}

async function readVariantHeader(variant: TemplateVariant): Promise<QuoteTemplateHeader> {
  const { ZipArchive } = await import("@/lib/xlsx/zip-reader");
  const { resolveSheetTextCells } = await import("@/lib/xlsx/sheet-text");

  const archive = ZipArchive.fromBuffer(await readTemplateAt(resolveVariantPath(variant)));
  const values = resolveSheetTextCells(archive, variant.sheetName, Object.values(variant.headerCells));

  const header = {} as QuoteTemplateHeader;
  for (const [key, cell] of Object.entries(variant.headerCells)) {
    (header as Record<string, string | null>)[key] = values.get(cell) ?? null;
  }
  return header;
}

/**
 * 넷의 머리말을 한 번에. **못 읽은 것은 빈 값으로 채운다** — 매쳐 양식 경로를
 * 아직 설정하지 않았다고 해서 제너레이터 견적서까지 못 쓰게 되면 안 된다.
 *
 * 화면(견적서 폼)이 넷을 다 들고 있다가 사람이 종류를 바꾸는 순간 그에 맞는
 * 것으로 갈아 끼운다. 서버에 다시 묻지 않으므로 기다리는 시간이 없고, 넷을
 * 합쳐도 짧은 글자 마흔 남짓이라 실어 보내는 값이 늘어난 티가 나지 않는다.
 */
export async function readAllQuoteTemplateHeaders(): Promise<Record<string, QuoteTemplateHeader>> {
  const entries = await Promise.all(
    Object.entries(TEMPLATE_VARIANTS).map(async ([key, variant]) => {
      try {
        return [key, await readVariantHeader(variant)] as const;
      } catch (err) {
        if (!(err instanceof QuoteTemplateError)) throw err;
        return [key, emptyQuoteTemplateHeader()] as const;
      }
    })
  );
  return Object.fromEntries(entries);
}

function emptyQuoteTemplateHeader(): QuoteTemplateHeader {
  return {
    companyName: null,
    ceoLine: null,
    address: null,
    tel: null,
    fax: null,
    email: null,
    homepage: null,
    defaultValidity: null,
    defaultDelivery: null,
    defaultPayment: null,
    bankAccount: null,
  };
}

/**
 * 미리보기용 머리말. **양식을 못 읽어도 던지지 않는다** — 값만 빈 채로 돌려준다.
 *
 * 미리보기는 양식이 없어도 떠야 한다. 회사 정보·기본 문구·계좌가 비어 보일 뿐,
 * 사람이 적은 값(금액·품목·공급처)은 그대로 확인할 수 있다. 정본이 필요하면
 * Excel 을 받으면 되고 그쪽은 자기 오류를 따로 알려 준다.
 *
 * 세 곳이 같은 되돌림 값을 쓴다(미리보기 페이지 · 새 견적서 · 견적서 수정).
 * 각자 적어 두면 한 곳만 고쳐지는 날이 오고, 그때 증상은 "어느 화면에서는
 * 회사명이 뜨는데 어느 화면에서는 안 뜨는" 것이다.
 */
export async function readQuoteTemplateHeaderOrEmpty(): Promise<QuoteTemplateHeader> {
  try {
    return await readQuoteTemplateHeader();
  } catch (err) {
    if (!(err instanceof QuoteTemplateError)) throw err;
    return emptyQuoteTemplateHeader();
  }
}

/**
 * ============================================================================
 * 양식에 적힌 작업 내역 기본 목록 — 조사작업 · 수리작업 · 통전작업
 * ============================================================================
 * 매쳐 견적서의 `2. 작업 비용` 아래에 세 묶음으로 적혀 있다. 새 견적서를 열 때
 * 조사작업·통전작업을 이 목록으로 채워 준다(수리작업은 고른 수리 작업에서 온다).
 *
 * ── 🔴 행 번호를 박지 않는다 ────────────────────────────────────────────
 * 같은 매쳐 양식인데도 내자와 OH 의 행이 다르다 — 부품 줄 수가 달라서 아래가
 * 통째로 밀려 있다(내자는 조사작업이 34행, OH 는 39행). 행을 박아 두면 양식을
 * 한 줄만 고쳐도 엉뚱한 글자를 읽어 온다.
 *
 * 그래서 **머리글을 찾아 훑는다**: D열에 `조사작업` 같은 이름이 나오면 그 묶음이
 * 시작된 것이고, 이어지는 줄 중 C열이 `-` 인 것들이 그 묶음의 항목이다. 다음
 * 머리글이 나오면 묶음이 바뀐다.
 *
 * 부품 줄도 C열이 `-` 라 같아 보이지만, **머리글보다 위에 있어서** 걸리지 않는다
 * (묶음이 시작되기 전에는 아무것도 담지 않는다).
 *
 * ── 🔴 머리글이 양식마다 다르다 ────────────────────────────────────────
 * 예전에는 매쳐 표기(`조사작업`·`수리작업`·`통전작업`) 하나만 알아서, 제너레이터
 * 양식은 **셋 다 0줄로 읽혔다.** 제너레이터는 `인수 조사` · `수리 작업` /
 * `OH 및 수리 작업` · `통전검사[출하검사]` 다.
 *
 * 그 글자는 여기 적지 않고 **xlsx 채우개가 들고 있는 것을 가져다 쓴다**
 * (TemplateVariant 의 workScopeLabels). 화면에 뜨는 목록과 파일에 적히는 목록이
 * 같은 글자를 봐야 한다.
 *
 * ── 못 읽으면 빈 목록이다 ───────────────────────────────────────────────
 * 양식이 없거나 그 구역이 없는 양식이면 셋 다 빈 배열이다. 화면은 사람이 직접
 * 적을 수 있게 빈 목록으로 그린다 — 여기서 던지면 양식 하나 때문에 견적서를
 * 못 쓰게 된다.
 * ============================================================================
 */

/** 훑는 범위. 양식의 작업 내역은 20행대에서 시작해 60행대에서 끝난다. */
const WORK_SCOPE_SCAN_ROWS = { from: 20, to: 90 } as const;

/** 그 줄의 D열 글자가 어느 묶음의 머리글인가. 아니면 null. */
function sectionOfLabel(
  labels: WorkScopeLabels,
  text: string
): QuoteWorkScopeSection | null {
  for (const section of QUOTE_WORK_SCOPE_SECTIONS) {
    const { label, match } = labels[section];
    // `통전검사[출하검사]` 처럼 뒤에 덧붙은 글자가 있는 머리글은 앞부분만 본다
    // (xlsx 채우개의 findItemBlock 과 같은 규칙이다).
    if (match === "prefix" ? text.startsWith(label) : text === label) return section;
  }
  return null;
}

/**
 * 미리보기가 그리는 묶음 하나 — 문서에 적힌 **머리글 그대로**와 그 아래 줄들.
 *
 * `label` 이 찾을 때 쓰는 글자와 다를 수 있다: `통전검사[출하검사]` 는 앞부분만
 * 보고 찾지만 화면에는 통째로 보여야 한다.
 */
export type QuoteWorkScopeSectionView = { label: string; items: string[] };

function emptyWorkScopeView(labels: WorkScopeLabels): Record<
  QuoteWorkScopeSection,
  QuoteWorkScopeSectionView
> {
  return {
    INVESTIGATION: { label: labels.INVESTIGATION.label, items: [] },
    REPAIR: { label: labels.REPAIR.label, items: [] },
    POWER_TEST: { label: labels.POWER_TEST.label, items: [] },
  };
}

/** 양식을 훑어 묶음별 머리글과 기본 목록을 모은다. 못 읽으면 빈 목록이다. */
async function scanWorkScope(
  templateKey: string
): Promise<Record<QuoteWorkScopeSection, QuoteWorkScopeSectionView>> {
  const variant = TEMPLATE_VARIANTS[templateKey];
  if (!variant) return emptyWorkScopeView(MATCHER_WORK_SCOPE_LABELS);

  const found = emptyWorkScopeView(variant.workScopeLabels);

  const configured = process.env[variant.envVar];
  if (!configured || configured.trim().length === 0) return found;

  const { ZipArchive } = await import("@/lib/xlsx/zip-reader");
  const { resolveSheetTextCells } = await import("@/lib/xlsx/sheet-text");

  let archive;
  try {
    archive = ZipArchive.fromBuffer(await readTemplateAt(path.resolve(configured.trim())));
  } catch (err) {
    if (!(err instanceof QuoteTemplateError)) throw err;
    return found;
  }

  const refs: string[] = [];
  for (let row = WORK_SCOPE_SCAN_ROWS.from; row <= WORK_SCOPE_SCAN_ROWS.to; row += 1) {
    refs.push(`C${row}`, `D${row}`);
  }
  const values = resolveSheetTextCells(archive, variant.sheetName, refs);

  let current: QuoteWorkScopeSection | null = null;
  for (let row = WORK_SCOPE_SCAN_ROWS.from; row <= WORK_SCOPE_SCAN_ROWS.to; row += 1) {
    const label = (values.get(`D${row}`) ?? "").trim();
    const bullet = (values.get(`C${row}`) ?? "").trim();

    const section = label === "" ? null : sectionOfLabel(variant.workScopeLabels, label);
    if (section) {
      current = section;
      // 화면에는 양식에 적힌 그대로 보여 준다(`통전검사[출하검사]`).
      found[section].label = label;
      continue;
    }
    // 묶음이 시작되기 전이거나, 글머리표가 아닌 줄(고정 안내 문구는 `*` 다)은 건너뛴다.
    if (current === null || bullet !== "-" || label === "") continue;
    found[current].items.push(label);
  }

  return found;
}

/**
 * 미리보기가 그릴 작업 내역 세 묶음.
 *
 * 🔴 **빈 묶음은 양식의 기본 목록으로 그린다** — 파일도 정확히 그 규칙으로
 * 나가기 때문이다(xlsx/quote-sheet-layout.ts 의 '빈 묶음은 양식 그대로 둔다').
 * 여기서 빈 채로 그리면 지금까지 저장된 제너레이터 견적서(작업 내역이 전부
 * 비어 있다)가 **화면에는 아무것도 없고 파일에는 표준 7줄이 적힌** 서로 다른
 * 문서가 된다.
 */
export async function readQuoteWorkSections(
  templateKey: string,
  lines: readonly { section: QuoteWorkScopeSection; text: string }[]
): Promise<Record<QuoteWorkScopeSection, QuoteWorkScopeSectionView>> {
  const sections = await scanWorkScope(templateKey);

  for (const section of QUOTE_WORK_SCOPE_SECTIONS) {
    const chosen = lines.filter((line) => line.section === section).map((line) => line.text);
    if (chosen.length > 0) sections[section].items = chosen;
  }
  return sections;
}

/**
 * 양식 넷의 작업 내역 기본값 — **머리글까지**. 머리말과 같은 이유로 **넷을 한
 * 번에** 준다: 화면이 들고 있다가 사람이 종류를 바꾸는 순간 갈아 끼운다.
 *
 * 🔴 줄 목록만이 아니라 머리글도 주는 것은 **편집 중 미리보기** 때문이다. 그
 * 화면(components/quotes/QuoteEditForm.tsx)은 서버에 다시 묻지 않고 지금 적혀
 * 있는 값으로 작업 내역을 그리는데, 머리글이 없으면 매쳐 견적서에 제너레이터
 * 문구(`인수 조사`)가 붙는다 — 저장하기 전과 후가 다른 문서로 보인다.
 *
 * 여기 담긴 것은 **양식의 기본값**이다. 견적서에 적어 둔 줄을 얹은 것이
 * 필요하면 readQuoteWorkSections 를 쓴다(빈 묶음은 이 기본값 그대로 남는다).
 */
export async function readAllQuoteWorkSectionDefaults(): Promise<
  Record<string, Record<QuoteWorkScopeSection, QuoteWorkScopeSectionView>>
> {
  const entries = await Promise.all(
    Object.keys(TEMPLATE_VARIANTS).map(async (key) => [key, await scanWorkScope(key)] as const)
  );
  return Object.fromEntries(entries);
}
