import {
  buildShareFolderStem,
  compareShareFolderNames,
  matchesShareFolderPrefix,
  sanitizeShareFolderNamePiece,
  truncateShareFolderNamePiece,
} from "./share-folder-naming";

/**
 * ============================================================================
 * A/S 수리 건마다 두는 **연락서 폴더**의 이름 규칙 (순수 — 파일시스템 없음)
 * ============================================================================
 * 사내 공유폴더에 수리 건 하나당 폴더 하나를 둔다. 사람이 탐색기로 여는 폴더라
 * 이름이 곧 목록이다:
 *
 *   <루트>/
 *     D260908 INVENIA T2RCONT-AD2 WN3947 1802034 점검요청/
 *     = 인수번호 고객사 모델명 L/N S/N 신고증상
 *
 * 다듬기 · 비교 · 길이 줄이기의 원시 규칙은 domain/share-folder-naming.ts 에 있다
 * (견적서 폴더와 **같은 한 벌**이다 — 금지 글자 표가 갈라지지 않게).
 *
 * ── 🔴 찾는 열쇠는 **인수번호 하나뿐**이다 ───────────────────────────────
 * 이 저장소는 이미 같은 판단을 내려 두었다(kyosan/report-match.ts 머리말).
 * 인수번호는 `repair_cases.intake_number` 에 유니크가 걸려 있고 `D`+YY+MM+2자리
 * **정확히 7자**로 CHECK 가 걸려 있으며(vendor/dss-core/src/schema/repair-cases.ts),
 * 수정 통로가 없다(validation/repair-case-update-input.ts 의 고칠 수 있는 칸 목록에
 * `intakeNumber` 가 없다). 그래서 번호 하나는 수리 건 **0 또는 1 개**를 가리킨다.
 *
 * 나머지 넷은 **전부 사후 수정된다.** 고객사명 · 모델명은 마스터에서 고치면
 * (updateCustomer · updateProductModel) 그 고객사의 **모든 건이 한꺼번에** 바뀐다.
 * 그러므로:
 *   · **찾을 때는 인수번호만 쓴다.** 모델 · S/N · L/N · 고객사로 짝을 확정하지 않는다
 *     — 같은 장비가 여러 번 수리를 오기 때문에 S/N 으로 짝지으면 **지난번 수리 건에
 *     이번 자료를 넣는다.**
 *   · **이름을 지을 때만** 여섯 조각을 전부 쓴다(사람이 목록에서 읽기 위한 것이다).
 *
 * ── 🔴 비교할 때와 이을 때가 다르다 ─────────────────────────────────────
 * 비교는 다듬은 이름으로, 경로를 이을 때는 **디스크의 실제 이름**으로 한다. 사람이
 * 적은 폴더 이름은 공백이 두 칸이거나 한글이 풀어쓴(NFD) 모양이라, 다듬은 이름으로
 * 경로를 이으면 **없는 폴더**가 된다.
 * ============================================================================
 */

/**
 * 연락서 폴더 이름 전체의 글자 수 상한(UTF-16 단위 — Windows 경로 한도가 세는 단위).
 *
 * 🔴 견적서의 `QUOTE_ARCHIVE_MAX_STEM_LENGTH` 를 그대로 쓰지 않는다. 그 값은 **견적서
 * 루트 길이와 연도 폴더**를 전제로 뽑은 값이다 — 연락서는 루트가 다르고 연도 폴더가
 * 없다. 같은 두 한도에서 다시 계산한다:
 *
 *   루트 `\\192.168.0.222\2_AS센터\1. 수리 관련\3. 연락서(활용)\2. 연락서` = **49 자**
 *   경로 = 루트(49) + `\`(1) + 폴더 이름(N) + `\`(1) + 그 안의 파일 이름(F)
 *   폴더 안의 파일은 사람이 넣는 연락서 스캔 · 엑셀이고, 실제로 **폴더 이름을 그대로
 *   쓴 파일**이 가장 길다 — F ≤ N + `.xlsx`(5) + ` (99)`(5) = N + 10.
 *
 *   1. **엑셀은 전체 경로 218 자를 넘는 파일을 열지 못한다.**
 *      49 + 1 + N + 1 + (N + 10) ≤ 218  →  2N ≤ 157  →  **N ≤ 78**
 *      (Windows 탐색기의 260 자 한도는 이보다 넉넉하다.)
 *   2. **NAS(Linux) 파일 이름 한도는 UTF-8 255 바이트다.** 한글 한 자가 3 바이트이고,
 *      가장 긴 이름은 폴더가 아니라 그 안의 파일(N + 10)이다.
 *      (N + 10) × 3 ≤ 255  →  **N ≤ 75**
 *
 * 둘 중 작은 쪽 75 에서 **세 자를 남겨 72**. 남기는 까닭은 루트가 지금보다 한 단계
 * 깊어지거나(폴더를 하나 더 두는 날) 사람이 파일 이름을 조금 더 길게 붙여도 견디게
 * 하기 위해서다. 실제로 N = 72 일 때 경로는 205 자, NAS 파일 이름은 246 바이트다.
 *
 * 견적서 상한과 숫자가 같지만 **계산은 다르다**(견적서는 연도 폴더가 있고 줄기가
 * 경로에 두 번 들어간다). 한쪽을 고칠 일이 있어도 다른 쪽을 따라 고치지 말 것.
 */
export const CONTACT_FOLDER_MAX_NAME_LENGTH = 72;

/**
 * 신고증상 조각 혼자 쓸 수 있는 글자 수 상한.
 *
 * 🔴 신고증상은 **자유 입력 4000 자**까지 들어온다(validation/repair-case-input.ts 의
 * `MAX_LONG_TEXT`). 줄바꿈 · 일본어 · 금지 글자가 제한 없이 들어 있다. 전체 상한만
 * 두면 가장 긴 조각부터 줄이는 규칙에 걸려 **신고증상이 60 자쯤을 혼자 차지하고**
 * 고객사 · 모델 · L/N · S/N 이 한 글자씩 남는다 — 사람이 목록에서 못 알아본다.
 *
 * 인수번호 7 자 + 조각 사이 공백 다섯을 빼면 다섯 조각이 나눠 쓸 자리가 60 자다.
 * 신고증상에 20 자를 주면 「출력 저하 노이즈 발생」 정도가 들어가고 나머지 40 자가
 * 고객사 · 모델 · L/N · S/N 에 남는다.
 */
export const CONTACT_FOLDER_MAX_SYMPTOM_LENGTH = 20;

/**
 * 이름을 만드는 데 쓰는 수리 건의 칸. 🔴 **DB 의 빈 칸(null)을 그대로 넘긴다** —
 * 화면이 쓰는 `-`(db/mappers/repair-case.ts 의 `?? "-"`)를 넘기지 말 것. 넘겨도
 * 아래에서 빼지만, 그 자리표시는 폴더 이름에 들어갈 값이 아니다.
 */
export type ContactFolderNamingInput = {
  /** 인수번호 `D`+YY+MM+2자리. 🔴 찾는 열쇠다 — 비면 이름을 만들지 않는다. */
  intakeNumber: string;
  customerName?: string | null;
  modelName?: string | null;
  /** L/N — DB 가 nullable 이고 과거 이관 건에 실제로 비어 있다. */
  lotNumber?: string | null;
  /** S/N — 위와 같다. 🔴 고유키가 아니다(같은 S/N 에 모델이 여럿일 수 있다). */
  serialNumber?: string | null;
  /** 신고증상 — 자유 입력. 위 상한까지만 쓴다. */
  reportedSymptom?: string | null;
};

/** 이름을 만들 수 없는 입력(인수번호가 비었다). */
export class ContactFolderNamingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContactFolderNamingError";
  }
}

/** 화면 매퍼가 빈 칸에 넣는 자리표시. 폴더 이름에 들어가면 안 된다. */
const EMPTY_FIELD_PLACEHOLDER = "-";

/**
 * 조각 하나를 다듬되, 화면 자리표시(`-`)면 **빈 조각으로 친다.** 빈 조각은 이름에서
 * 빠진다 — `D260908 INVENIA T2RCONT-AD2 - - 점검요청` 같은 폴더가 생기지 않게.
 */
function namePiece(value: string | null | undefined): string {
  const piece = sanitizeShareFolderNamePiece(value);
  return piece === EMPTY_FIELD_PLACEHOLDER ? "" : piece;
}

/**
 * 새로 만드는 연락서 폴더 이름:
 * `{인수번호} {고객사} {모델명} {L/N} {S/N} {신고증상}` — **빈 조각은 뺀다.**
 *
 * 상한을 넘으면 **가장 긴 조각부터** 줄인다. 🔴 **인수번호는 절대 자르지 않는다** —
 * 그것이 다음에 이 폴더를 찾는 열쇠다.
 */
export function contactFolderName(input: ContactFolderNamingInput): string {
  const intakeNumber = namePiece(input.intakeNumber);
  if (intakeNumber.length === 0) {
    throw new ContactFolderNamingError("인수번호가 비어 있어 연락서 폴더 이름을 만들 수 없습니다.");
  }
  return buildShareFolderStem({
    head: intakeNumber,
    pieces: [
      namePiece(input.customerName),
      namePiece(input.modelName),
      namePiece(input.lotNumber),
      namePiece(input.serialNumber),
      // 자유 입력은 전체 상한에 닿기 전에 제 상한에서 먼저 잘린다.
      truncateShareFolderNamePiece(namePiece(input.reportedSymptom), CONTACT_FOLDER_MAX_SYMPTOM_LENGTH),
    ],
    maxLength: CONTACT_FOLDER_MAX_NAME_LENGTH,
  });
}

/**
 * 이미 있는 폴더가 이 수리 건의 연락서 폴더인가 — 다듬은 이름이 **인수번호로 시작하고
 * 바로 뒤가 공백**이면 맞다. 이름이 인수번호 그 자체인 폴더도 맞는 것으로 본다.
 *
 * 🔴 **경계를 본다.** `D2609081 …` 은 `D260908` 의 폴더가 **아니다** — 그냥 앞글자
 * 비교면 남의 수리 건 폴더에 이번 자료를 넣게 된다.
 *
 * 🔴 **대소문자를 접는다.** 사람이 `d260908 …` 로 적었을 수 있고, 리눅스(NAS)에서는
 * 그것이 다른 이름이라 접지 않으면 못 찾고 **폴더가 둘이 된다.** (견적서 번호는 접지
 * 않는다 — 거기는 사람이 적는 발행번호라 대소문자가 뜻을 가질 수 있다.)
 */
export function matchesContactFolder(existingName: string, intakeNumber: string): boolean {
  return matchesShareFolderPrefix(existingName, namePiece(intakeNumber), { foldCase: true });
}

/** 찾기 판정 — 디스크를 보지 않는다. 돌려주는 이름은 **받은 그대로**(디스크의 실제 이름)다. */
export type ContactFolderMatch =
  | { status: "found"; folderName: string }
  /** 🔴 맞는 폴더가 여럿이다 — 사람이 폴더를 둘 만들어 두었다. 앱이 고르지 않는다. */
  | { status: "multiple"; folderNames: string[] }
  | { status: "not-found" };

/**
 * 폴더 이름 목록에서 이 수리 건의 연락서 폴더를 고른다. **순수 함수다** — 디스크를
 * 읽는 일은 storage/contact-folder-archive.ts 가 하고, 규칙은 여기 하나뿐이다.
 *
 * 🔴 **돌려주는 것은 받은 이름 그대로다**(다듬은 이름이 아니다). 다듬은 이름으로
 * 경로를 이으면 없는 폴더가 된다 — NFC/NFD 와 공백 두 칸 때문이다.
 *
 * 여럿이면 고르지 않고 `multiple` 로 돌려준다(이름순). 어느 쪽이 맞는지는 사람이
 * 안다 — 앱이 골라 넣으면 틀렸을 때 조용히 틀린다.
 */
export function pickContactFolder(intakeNumber: string, existingNames: readonly string[]): ContactFolderMatch {
  const matched = existingNames
    .filter((name) => matchesContactFolder(name, intakeNumber))
    .sort(compareShareFolderNames);
  if (matched.length === 0) return { status: "not-found" };
  if (matched.length === 1) return { status: "found", folderName: matched[0] };
  return { status: "multiple", folderNames: matched };
}
