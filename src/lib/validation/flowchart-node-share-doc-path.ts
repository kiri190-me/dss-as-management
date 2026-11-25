import type { QuoteFolderPathRejection } from "@/lib/domain/quote-folder-link";
import {
  QUOTE_FOLDER_OPENABLE_EXTENSIONS,
  checkQuoteFolderOpenableFilePath,
  type QuoteFolderFileRejection,
} from "@/lib/domain/quote-folder-file-link";

/**
 * ============================================================================
 * 🔴 흐름도 **노드**가 가리키는 공유폴더 속 파일 한 자리 — 검사 (2026-11-25)
 * ============================================================================
 * 「수리 관련」 공유폴더(`REPAIR_DOCS_ARCHIVE_DIR`) 루트 기준 **상대 경로**다. 값이
 * 없으면 `null` — 아무것도 안 가리킨 노드가 보통이고, `null` 이 곧 「가리킴 지우기」다.
 *
 * ── 🔴 **두 표가 이 한 벌을 함께 쓴다** (2026-11-25 조각 E2 에서 여기로 옮겼다) ──
 * `repair_case_flowchart_nodes`(진단 Flowchart)와 `procedure_template_nodes`(기술
 * 작업 절차) 두 표에 같은 칸이 있고, 마이그레이션 0132 가 **CHECK 식을 글자 그대로**
 * 같게 적었다(그 사실을 지키는 시험이 db/schema/flowchart-node-share-doc-path-shape
 * .test.ts 다 — 셋의 식이 같은가를 값으로 잰다). DB 규칙이 한 벌이면 앱 쪽 검사도
 * 한 벌이어야 한다. 🔴 **베끼지 마라** — 한쪽만 고치면 tsc 도 eslint 도 침묵한 채
 * 「한 화면에서는 거절당하고 다른 화면에서는 통과하는 경로」가 생긴다.
 * 🔵 처음에는 이 함수가 validation/repair-case-flowchart-graph-input.ts 안에 있었고,
 * 그 모듈은 지금도 **같은 이름으로 다시 내보낸다** — 진단 쪽 호출부·시험이 쓰던 길이
 * 그대로 산다.
 *
 * ── 🔴 왜 공용 검사에 한 겹을 더 두는가 — 상한이 어긋나 있다 ───────────────
 * 글자 규칙은 `checkQuoteFolderOpenableFilePath`(domain/quote-folder-file-link.ts)가
 * 그대로 본다 — 새 규칙도, 두 벌째 확장자 목록도 만들지 않는다. **다만 길이 상한만
 * 두 곳이 다르다**: 그쪽 `QUOTE_FOLDER_RELATIVE_PATH_MAX_LENGTH` 는 **512** 인데 이
 * 칸의 DB CHECK 는 **400** 이다. 그래서 401~512 글자는 **검사를 통과하고 insert 에서
 * 터진다** — 그때 사람에게 가는 말은 「일시적으로 처리할 수 없습니다」(액션의 DB 오류
 * 가리기)라서 무엇이 틀렸는지 영영 알 수 없다. 🔴 **공용 쪽 512 는 고치지 않는다** —
 * 견적서 폴더 열기 · 연락서 · 제품 모델 가리킴이 그 숫자를 함께 쓰고, 그 자리들의 DB
 * 상한은 또 다르다. 좁히는 것은 **이 칸을 쓰는 이 자리**다.
 *
 * ── 🔴 앞뒤 공백도 여기서 막는다 — 같은 종류의 어긋남이다 ─────────────────
 * DB CHECK 는 `값 = btrim(값)` 도 함께 본다. 공용 검사는 **마디 끝의** 공백만 막아
 * (TRAILING_DOT_OR_SPACE) 맨 앞 마디의 **앞** 공백(` 2026 점검.pdf`)이 그대로 지나간다.
 * 공유폴더에는 그런 이름이 실제로 있을 수 있고, 들어온 글자를 **다듬어서** 담으면
 * 디스크에 없는 경로가 된다(그래서 다듬지 않고 거절한다 — 제품 모델 쪽 액션 머리말의
 * 「들어온 글자 그대로」와 같은 규율이다).
 * ============================================================================
 */
const MAX_SHARE_DOC_PATH_LENGTH = 400;

export type NodeShareDocPathValidationResult =
  | { ok: true; shareDocRelativePath: string | null }
  | { ok: false; error: string };

/** 거절할 까닭 → 사람이 읽는 말. 🔴 판정을 여기서 다시 하지 않는다 — 코드만 글자로 바꾼다. */
const SHARE_DOC_PATH_REJECTION_MESSAGES: Record<QuoteFolderPathRejection | QuoteFolderFileRejection, string> = {
  EMPTY: "가리킬 파일을 고르세요.",
  TOO_LONG: "경로가 너무 깁니다.",
  CONTROL_CHARACTER: "경로에 쓸 수 없는 문자가 들어 있습니다.",
  ABSOLUTE: "공유폴더 안에서의 경로만 가리킬 수 있습니다(전체 경로 · 드라이브 문자는 담지 않습니다).",
  FORBIDDEN_CHARACTER: "경로에 쓸 수 없는 문자가 들어 있습니다(마디 구분은 / 하나입니다).",
  EMPTY_SEGMENT: "경로의 마디가 비어 있습니다.",
  DOT_SEGMENT: "경로에 . 또는 .. 마디를 담을 수 없습니다.",
  TRAILING_DOT_OR_SPACE: "폴더 · 파일 이름이 점이나 공백으로 끝날 수 없습니다.",
  NO_EXTENSION: "확장자가 없는 파일은 열 수 없어 가리키지 않습니다.",
  EXTENSION_NOT_ALLOWED: `열 수 있는 파일 형식이 아닙니다(${QUOTE_FOLDER_OPENABLE_EXTENSIONS.map((extension) => `.${extension}`).join(" · ")}).`,
};

export function validateNodeShareDocRelativePath(value: unknown): NodeShareDocPathValidationResult {
  // 🔴 안 가리킴(= 가리킴 지우기). 아래 글자 검사를 **한 줄도** 지나지 않는다.
  if (value === null || value === undefined) return { ok: true, shareDocRelativePath: null };
  if (typeof value !== "string") return { ok: false, error: "가리킨 파일 경로의 형식이 올바르지 않습니다." };

  const rejection = checkQuoteFolderOpenableFilePath(value);
  if (rejection !== null) return { ok: false, error: SHARE_DOC_PATH_REJECTION_MESSAGES[rejection] };

  // 🔴 공용 검사보다 **좁게** 다시 잰다(머리말) — DB CHECK 와 같은 수다.
  if (value.length > MAX_SHARE_DOC_PATH_LENGTH) {
    return { ok: false, error: `가리킨 파일 경로는 ${MAX_SHARE_DOC_PATH_LENGTH}자를 초과할 수 없습니다.` };
  }
  // 🔴 `btrim` 과 같은 자리 — 다듬지 않고 **거절**한다(머리말).
  if (value !== value.replace(/^ +| +$/g, "")) {
    return { ok: false, error: "경로의 앞뒤에 공백을 둘 수 없습니다." };
  }

  return { ok: true, shareDocRelativePath: value };
}
