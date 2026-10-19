import "server-only";

import { INTAKE_REPAIR_REQUEST_CATEGORY } from "@/lib/domain/intake-repair-request";
import { copyIntoContactFolder } from "@/lib/storage/contact-folder-archive";

/**
 * ============================================================================
 * 접수와 함께 올라온 **수리 의뢰서**를 연락서 폴더에 꽂는다 (2026-10-19)
 * ============================================================================
 * 사용자 결정: 「접수 때 수리의뢰서를 첨부하면, 연락서에 **[수리 의뢰서] 폴더를
 * 만들고 그 안에** 파일을 저장해 줘」.
 *
 * 그래서 올리기 사본과 **같은 길**(copyIntoContactFolder)을 쓴다 — 그 길이
 * `연락서폴더/{분류 한글 이름표}/` 에 꽂고, 분류 `REPAIR_REQUEST` 의 이름표가
 * 「수리 의뢰서」라서 폴더 이름이 정확히 그것이 된다. 🔴 **폴더 이름을 글자로
 * 적지 않는다** — 적는 순간 이름표가 바뀌는 날 폴더가 둘로 갈린다.
 * 🔵 `공통/`(종류마다 같은 서류)도 `DATA/`(사람이 넣는 측정 자료)도 아니다.
 *
 * ── 🔴 첨부 표에 행을 만들지 않는다 ─────────────────────────────────────
 * 이 파일은 **서버 디스크에 남지 않는다**(시스템 창고에 쓰지 않는다). 그런데
 * `attachments` 에 행만 남기면 화면에 **눌러도 안 열리는 줄**이 생긴다. 그래서
 * 행도 감사 기록도 만들지 않는다 — 🔴 `recordContactFolderFileSaved` 는
 * `attachmentId` 를 요구하므로 이 길에서는 부를 수 없다(없는 첨부를 가리키게
 * 된다). 공유폴더에 들어간 사실은 **파일 그 자체**로 남는다.
 *
 * ── 🔴 연락서 폴더를 만들지 않는다 ───────────────────────────────────────
 * 이 길은 **이미 있는 폴더에만** 꽂는다(`no-folder`). 접수 흐름이 바로 앞에서
 * 폴더를 만들고(createContactFolderForIntake), 그 결과가 `created` · `found` 일
 * 때만 여기로 온다 — 순서를 보장하는 것은 부르는 쪽의 몫이다.
 *
 * ── 🔴 던지지 않는다 · 지우지 않는다 ─────────────────────────────────────
 * 접수는 이미 확정됐다. 여기서 무슨 일이 나든 접수가 되돌아가면 안 되므로 모든
 * 실패를 값으로 돌려준다(send-intake-mail.ts · create-contact-folder.ts 와 같은
 * 약속). 그리고 **지우는 코드가 한 글자도 없다** — 공유폴더는 사람의 서류함이고,
 * 🔴 **메일이 실패해도 이 파일은 그대로 남아야 한다**(지우면 다시 보낼 길이 없다).
 *
 * ── 🔴 결과에 경로 · 폴더 이름을 담지 않는다 ─────────────────────────────
 * 이 값은 부르는 쪽이 서버 로그에 적는다. 연락서 폴더 이름에는 고객사와 S/N 이
 * 들어 있고 fs 오류 message 에는 전체 경로가 들어 있다 — 나가는 것은 **상태 코드**와,
 * storage 가 정한 **짧은 한국어 사유**뿐이다.
 * ============================================================================
 */

export type IntakeRepairRequestSave =
  /** 이번에 새로 꽂았다. */
  | { status: "copied" }
  /** 같은 내용의 파일이 이미 있어 **쓰지 않았다**(다시 접수하거나 두 번 눌렀을 때). */
  | { status: "unchanged" }
  /** 🔴 연락서 폴더가 아직 없다 — **만들지 않는다.** */
  | { status: "no-folder" }
  /** 인수번호가 같은 폴더가 여럿이다 — 🔴 앱이 고르지 않는다. */
  | { status: "multiple" }
  /** 공유폴더 위치가 설정되지 않았다 — 이 기능만 꺼져 있다. 실패가 아니다. */
  | { status: "disabled" }
  /** 🔴 사유는 늘 storage 가 정한 짧은 문장이다(경로가 들어 있지 않다). */
  | { status: "failed"; reason: string };

/** 예상 못 한 오류. 🔴 오류 message 를 쓰지 않는다 — 경로가 들어 있다. */
const UNEXPECTED_REASON = "수리 의뢰서를 공유폴더에 넣는 중 문제가 발생했습니다.";

/**
 * 수리 의뢰서를 그 건의 연락서 폴더 안 「수리 의뢰서」 폴더에 꽂는다.
 * **던지지 않는다.**
 *
 * 🔴 부르는 쪽은 이 결과가 무엇이든 **접수를 성공으로 끝낸다.**
 */
export async function saveIntakeRepairRequest(input: {
  /** 🔴 연락서 폴더를 찾는 열쇠는 인수번호 하나뿐이다. */
  intakeNumber: string;
  /** 접수 화면에서 고른 원본 이름 — 검사를 지난 것이 온다. */
  fileName: string;
  /** 🔴 **메모리에 있는 바이트**다. 디스크에서 읽어 오는 것이 아니다. */
  bytes: Uint8Array;
  /** 공유폴더 루트. 주지 않으면 설정을 읽는다. 시험에서는 임시 폴더를 준다. */
  root?: string | null;
  /** 폴더를 **찾는** 동안의 기다리기 상한. 시험에서만 바꾼다. */
  timeoutMs?: number;
}): Promise<IntakeRepairRequestSave> {
  try {
    const placed = await copyIntoContactFolder({
      intakeNumber: input.intakeNumber,
      // 🔴 폴더 이름은 이 분류의 **한글 이름표**에서 나온다(글자로 적지 않는다).
      category: INTAKE_REPAIR_REQUEST_CATEGORY,
      originalFileName: input.fileName,
      bytes: input.bytes,
      root: input.root,
      timeoutMs: input.timeoutMs,
    });

    // 🔴 파일 이름 · 폴더 이름을 밖으로 내보내지 않는다 — 상태만 옮긴다.
    if (placed.status === "copied") return { status: "copied" };
    if (placed.status === "unchanged") return { status: "unchanged" };
    if (placed.status === "no-folder") return { status: "no-folder" };
    if (placed.status === "multiple") return { status: "multiple" };
    if (placed.status === "disabled") return { status: "disabled" };
    return { status: "failed", reason: placed.reason };
  } catch {
    // storage 는 던지지 않기로 약속했지만, 그 약속이 깨져도 접수가 뒤집히면 안 된다.
    // 🔴 잡은 오류를 들여다보지 않는다 — message 에 경로가 들어 있다.
    return { status: "failed", reason: UNEXPECTED_REASON };
  }
}
