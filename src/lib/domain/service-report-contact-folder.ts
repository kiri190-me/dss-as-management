import type { AttachmentCategory } from "./attachment-category";
import { isQuoteFolderRelativePath } from "./quote-folder-link";
import type { ServiceReportKind } from "@/lib/xlsx/service-report-template";

/**
 * ============================================================================
 * 검사 · 수리 보고서가 **연락서 폴더 어디에 들어가는가** (순수 — 서버 · 화면 · 시험이 함께 쓴다)
 * ============================================================================
 * 사용자 결정 2026-10-12: 보고서 [저장]이 성공하면 그 건의 **연락서 폴더 안 분류 폴더**에
 * 엑셀을 쓰고, 그 엑셀을 PDF 로 바꿔 같은 자리에 둔다.
 *
 *   D260908 INVENIA T2RCONT-AD2 WN3947 1802034 점검요청/
 *     ├─ 검사 보고서/
 *     │    ├─ 검사보고서_T2RCONT-AD2_WN3947_1802034.xlsx
 *     │    └─ 검사보고서_T2RCONT-AD2_WN3947_1802034.pdf
 *     └─ 수리 보고서/
 *
 * ── 🔴 분류는 **이미 있는 것**을 쓴다 — 새로 만들지 않는다 ────────────────
 * `domain/attachment-category.ts` 에 `INSPECTION_REPORT`(「검사 보고서」) ·
 * `REPAIR_REPORT`(「수리 보고서」)가 이미 있다. 폴더 이름도 그 이름표에서 나온다
 * (`contactFolderCategoryFolderName`). 그래서 이 파일이 하는 일은 **종류 → 분류** 한 칸을
 * 잇는 것뿐이고, 폴더 이름을 짓는 규칙은 한 글자도 여기 없다.
 *
 * 🔴 **`Record<ServiceReportKind, …>` 로 적는다** — 종류가 하나 늘면 tsc 가 빠진 칸을
 * 짚는다(`service-report-kind-param.ts` 의 같은 판단). 배열 · switch 로 적으면 새 종류가
 * 조용히 한쪽 폴더로 떨어진다.
 *
 * ── 🔴 둘을 섞지 않는다 ─────────────────────────────────────────────────
 * 검사 보고서는 검사 폴더, 수리 보고서는 수리 폴더다. 한 건에 두 종류가 다 있는 일이
 * 보통이라(같은 장비를 검사하고 고친다) 섞이면 사람이 탐색기에서 그것을 못 가린다.
 *
 * ── ⚠️ 타입만 가져온다 ──────────────────────────────────────────────────
 * `@/lib/xlsx/*` 를 값으로 가져오면 `node:fs` · `node:zlib` 가 딸려 온다. 이 파일은 화면도
 * 읽으므로 타입만 가져온다(컴파일에서 지워진다 — `service-report-form.ts` 와 같은 규칙).
 * ============================================================================
 */

/**
 * 보고서 종류 → 연락서 폴더의 **분류**. 🔴 이 표가 원본이고, 부르는 쪽(통로 · 화면 · 시험)이
 * `"INSPECTION_REPORT"` 를 손으로 적지 않는다.
 */
export const SERVICE_REPORT_CONTACT_FOLDER_CATEGORY: Record<ServiceReportKind, AttachmentCategory> = {
  INSPECTION: "INSPECTION_REPORT",
  REPAIR: "REPAIR_REPORT",
};

/** 위 표를 읽는 한 줄. 종류가 곧 분류를 정한다 — 섞일 자리가 없다. */
export function serviceReportContactFolderCategory(kind: ServiceReportKind): AttachmentCategory {
  return SERVICE_REPORT_CONTACT_FOLDER_CATEGORY[kind];
}

/**
 * 공유폴더 **루트 기준 상대 폴더 경로** — `연락서 폴더/분류 폴더`. 분류 폴더가 없으면
 * (같은 이름의 파일이 자리를 막아 연락서 폴더 바로 아래에 꽂은 경우) 연락서 폴더 하나다.
 *
 * 🔴 **도우미가 받을 수 있는 모양이 아니면 null** 이다 — 주소를 지어내지 않는다. 검사는
 * 폴더 열기 · PDF 변환 주소가 쓰는 **그 규칙 그대로**다(domain/quote-folder-link.ts).
 * 부르는 쪽은 null 을 받으면 「공유폴더에서 직접 바꿔 주세요」로 끝낸다.
 */
export function serviceReportContactFolderRelativePath(
  folderName: string,
  categoryFolderName: string | null
): string | null {
  const relativePath =
    categoryFolderName === null || categoryFolderName.length === 0
      ? folderName
      : `${folderName}/${categoryFolderName}`;
  return isQuoteFolderRelativePath(relativePath) ? relativePath : null;
}
