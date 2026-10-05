import "server-only";

import { recordContactFolderCreated } from "@/lib/db/mutations/contact-folders";
import { getRepairCaseContactFolderNamingById } from "@/lib/db/queries/repair-cases";
import { createContactFolder, resolveContactFolderArchiveRoot } from "@/lib/storage/contact-folder-archive";

/**
 * ============================================================================
 * 접수한 그 자리에서 연락서 공유폴더를 만든다 (연락서 조각 7)
 * ============================================================================
 * 조각 5 가 만든 통로(`POST /api/repair-cases/{id}/contact-folder`)가 하는 일과 **같다.**
 * 다른 것은 **들어오는 길**뿐이다: 그 통로는 세션 · 권한 · 출하 잠금을 보지만, 여기서는
 * 방금 접수한 사람이 **그 건을 만든 당사자**이고 건은 조금 전에 생겼다(잠길 수 없다).
 * 그래서 이 모듈은 문지기 노릇을 하지 않고, **만들기 쪽 규율만** 그대로 가져온다:
 *
 *  · 🔴 **설정이 비면 아무 일도 하지 않는다** — DB 도 디스크도 보지 않는다. 기능이 꺼진
 *    환경에서 접수가 한 글자도 달라지지 않게(조각 6 의 첫 관문과 같다).
 *  · 🔴 **이미 있으면 만들지 않는다.** 새 인수번호라 보통 없지만 수기 인수번호를 받을 수
 *    있다 — 그 판정은 storage 의 createContactFolder 가 「먼저 찾는다」로 한다.
 *    🔴 **그것이 유일한 안전장치다**(인수번호가 같은 폴더가 둘 이상이면 `multiple` 로
 *    끝난다). S/N 으로 「비슷한 폴더」를 훑던 장치는 2026-10-05 에 걷어냈다 — 같은 장비가
 *    다시 수리를 오는 것이 정상이고 새 인수번호에는 새 폴더가 있어야 하기 때문이다
 *    (까닭 전부는 domain/contact-folder-naming.ts 의 「걷어낸 것」 머리말).
 *  · 🔴 **감사 기록을 남긴다** — 조각 5 와 같은 모양(recordContactFolderCreated).
 *    「우리가 만든 폴더」를 나중에 가릴 수 있어야 한다: 이 기능을 되돌릴 때 어느 폴더가
 *    앱이 만든 것인지 물어볼 곳은 그 한 줄뿐이다(db/mutations/contact-folders.ts 머리말).
 *
 * ── 🔴 던지지 않는다 ────────────────────────────────────────────────────
 * 이 함수는 **접수가 이미 확정된 뒤에** 불린다. 여기서 무슨 일이 나든 접수는 되돌아가면
 * 안 된다 — 물건은 이미 들어와 있고 접수 번호도 나갔다. 그래서 모든 실패를 값으로
 * 돌려주고(send-intake-mail.ts 와 같은 약속), 부르는 쪽은 **로그만** 남긴다.
 *
 * ── 🔴 사유 · 결과에 경로를 담지 않는다 ─────────────────────────────────
 * `reason` 은 부르는 쪽이 서버 로그에 적는다. 운영 로그에 사내 폴더 구조가 남으면 안 되므로
 * fs 오류의 message 를 쓰지 않고 **늘 이 모듈이 정한 짧은 문장**이다(storage 쪽 reason 도
 * 같은 규율로 만들어진 것이다 — contact-folder-archive.ts 머리말).
 *
 * ── 대량 이관에서는 부르지 않는다 ───────────────────────────────────────
 * 그 판단은 부르는 쪽(services/create-repair-case.ts)이 한다 — 메일과 똑같이, 이관 한 번에
 * 수백 건이 들어오기 때문이다. 이관 건의 폴더는 나중에 사람이 [폴더 만들고 열기]로 만든다.
 * ============================================================================
 */

/** 방금 만든 접수를 다시 읽지 못했다 — 있을 수 없지만 조용히 넘어가지 않는다. */
const CASE_GONE_REASON = "수리 건 정보를 읽지 못해 연락서 폴더를 만들지 못했습니다.";
/** 예상 못 한 오류. 🔴 오류 message 를 쓰지 않는다 — 경로가 들어 있다. */
const UNEXPECTED_REASON = "연락서 폴더를 만드는 중 문제가 발생했습니다.";

export type IntakeContactFolderResult =
  /** 이번에 만들었다 — 감사 기록까지 남았다. */
  | { status: "created"; folderName: string }
  /** 이미 있었다 — **만들지 않았다**(수기 인수번호 · 사람이 먼저 만들어 둔 폴더). */
  | { status: "found" }
  /** 맞는 폴더가 여럿이다 — 🔴 앱이 고르지 않는다. 사람이 정리한다. */
  | { status: "multiple" }
  /** 공유폴더 위치가 설정되지 않았다 — 이 기능만 꺼져 있다. 실패가 아니다. */
  | { status: "disabled" }
  /**
   * 🔴 폴더는 만들었는데 감사 기록을 남기지 못했다. 폴더를 **지우지 않는다**(사람의
   * 서류함이다) — 대신 숨기지 않고 부르는 쪽이 로그로 알린다.
   */
  | { status: "audit-failed"; folderName: string }
  | { status: "failed"; reason: string };

/**
 * 그 수리 건의 연락서 폴더를 접수 직후에 만든다. **던지지 않는다.**
 *
 * 🔴 부르는 쪽은 이 결과가 무엇이든 **접수를 성공으로 끝낸다.**
 */
export async function createContactFolderForIntake(input: {
  repairCaseId: string;
  /** 접수한 사람. 🔴 이 길에도 시스템이 혼자 만드는 경우가 없다 — 늘 사람이 있다. */
  actorUserId: string;
}): Promise<IntakeContactFolderResult> {
  // ── 🔴 설정이 비면 여기서 끝난다 — DB 도 디스크도 보지 않는다 ───────────
  const root = resolveContactFolderArchiveRoot();
  if (root === null) return { status: "disabled" };

  try {
    // 이름 재료 — 조각 5 와 같은 최소 조회다(8-테이블 join 을 쓰지 않는다).
    const naming = await getRepairCaseContactFolderNamingById(input.repairCaseId);
    if (naming === null) return { status: "failed", reason: CASE_GONE_REASON };

    // 🔴 만들기 규율은 storage 하나에만 있다 — 여기서 mkdir 을 부르지 않고 「먼저 찾기」를
    //    다시 짜지도 않는다. 두 벌이 되면 반드시 갈라진다.
    const created = await createContactFolder({
      root,
      naming: {
        intakeNumber: naming.intakeNumber,
        customerName: naming.customerName,
        modelName: naming.modelName,
        lotNumber: naming.lotNumber,
        serialNumber: naming.serialNumber,
        reportedSymptom: naming.reportedSymptom,
      },
    });

    // ── 🔴 감사 기록 — **이번에 만들었을 때만** 남긴다 ────────────────────
    if (created.status === "created") {
      try {
        await recordContactFolderCreated({
          actorUserId: input.actorUserId,
          repairCaseId: input.repairCaseId,
          folderName: created.folderName,
        });
      } catch {
        // 폴더는 이미 디스크에 있다 — 🔴 지우지 않는다. 다시 [폴더 만들고 열기]를 눌러도
        // 그 폴더를 찾아 열 뿐 폴더가 둘이 되지는 않는다.
        return { status: "audit-failed", folderName: created.folderName };
      }
      return { status: "created", folderName: created.folderName };
    }

    // ── 만들지 않은 결과들 ───────────────────────────────────────────────
    if (created.status === "found") return { status: "found" };
    if (created.status === "multiple") return { status: "multiple" };
    // 루트를 먼저 보았으므로 disabled 에 닿지 않지만, 상태가 하나 늘면 컴파일러가 짚게 둔다.
    if (created.status === "disabled") return { status: "disabled" };
    return { status: "failed", reason: created.reason };
  } catch {
    // storage 는 던지지 않기로 약속했지만, 그 약속이 깨져도 접수가 뒤집히면 안 된다.
    // 🔴 잡은 오류를 들여다보지 않는다 — message 에 경로가 들어 있다.
    return { status: "failed", reason: UNEXPECTED_REASON };
  }
}
