import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";

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
  const { ZipArchive } = await import("@/lib/xlsx/zip-reader");
  const { resolveSheetTextCells } = await import("@/lib/xlsx/sheet-text");

  const archive = ZipArchive.fromBuffer(await readQuoteTemplate());
  const values = resolveSheetTextCells(archive, "내자견적서", Object.values(HEADER_CELLS));

  const header = {} as QuoteTemplateHeader;
  for (const [key, cell] of Object.entries(HEADER_CELLS)) {
    (header as Record<string, string | null>)[key] = values.get(cell) ?? null;
  }
  return header;
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
}
