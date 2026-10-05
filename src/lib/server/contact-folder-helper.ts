import "server-only";

/**
 * ============================================================================
 * 연락서 공유폴더의 **전체 주소**(UNC) — [위치 복사] 하나에만 쓴다
 * ============================================================================
 * 도우미 설치가 막힌 PC 를 위한 우회로다. 사람이 `\\서버\공유\…` 를 탐색기 주소창에
 * 붙여넣으면 도우미 없이도 그 폴더가 열린다.
 *
 * ── 🔴 서버가 계산하지 않는다 ────────────────────────────────────────────
 * 돌려주는 것은 `CONTACT_FOLDER_ARCHIVE_UNC_PATH` 에 **적힌 값 그대로**다. 루트에 폴더
 * 이름을 이어 붙이지 않는다 — 이 값은 「연락서 폴더들이 모여 있는 곳」을 가리키고,
 * 사람은 거기서 제 인수번호 폴더를 눈으로 찾는다. 고객사 현황표 쪽
 * (services/customer-portal-export.ts 의 resolveCustomerPortalFolderTarget)과 같은 방법이다.
 *
 * ── 🔴 설치본에 박히는 루트는 여기서 나가지 않는다 ────────────────────────
 * `CONTACT_FOLDER_ARCHIVE_UNC_ROOT` 는 **도우미 설치본에만** 들어간다
 * (server/quote-folder-helper.ts 의 resolveQuoteFolderHelperInstallRoots). 이 파일은 그 값을
 * 읽지 않는다 — 화면으로 나가는 설정은 아래 한 칸뿐이다.
 *
 * ── 🔴 값을 로그로 찍지 않는다 ───────────────────────────────────────────
 * .env 내용은 출력하지 않는다(CLAUDE.md 보안 규칙). 비었으면 null 이고, 부르는 쪽은
 * 그 칸만 빼고 나머지 응답을 그대로 낸다 — [폴더 열기]가 이것 때문에 죽지 않는다.
 * ============================================================================
 */

/** 사람이 탐색기 주소창에 붙여넣을 전체 주소를 담는 환경변수. 🔴 이 값만 화면으로 나간다. */
export const CONTACT_FOLDER_UNC_PATH_ENV = "CONTACT_FOLDER_ARCHIVE_UNC_PATH";

/**
 * 설정된 전체 주소. **부르는 시점에** 읽는다 — 모듈을 불러오는 것만으로 값이 굳지 않게.
 * 비었거나 공백뿐이면 null(= [위치 복사] 단추가 아예 없다).
 */
export function resolveContactFolderUncPath(): string | null {
  const configured = process.env.CONTACT_FOLDER_ARCHIVE_UNC_PATH;
  const value = typeof configured === "string" ? configured.trim() : "";
  return value === "" ? null : value;
}
