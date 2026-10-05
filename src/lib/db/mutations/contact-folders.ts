import "server-only";
import { db } from "../client";
import { insertAuditLog } from "./audit-logs";

/**
 * ============================================================================
 * 연락서 폴더를 **우리가 만들었다**는 기록 (연락서 조각 5)
 * ============================================================================
 * 사내 공유폴더의 연락서 폴더는 **사람의 서류함**이다 — DB 에 그 경로를 적지 않는다
 * (storage/quote-archive.ts 머리말의 「UUID 파일명 규칙의 의도된 예외」와 같은 자리).
 * 그래서 폴더가 하나 늘어나도 DB 에는 아무 흔적이 없다.
 *
 * 🔴 그러면 나중에 **「우리가 만든 폴더」와 「사람이 만든 폴더」를 구별할 수 없다.**
 * 접수할 때 자동으로 만드는 조각(조각 7)이 들어오면 더 그렇다 — 어느 날 폴더가
 * 갑자기 늘었을 때 「앱이 만든 것인가」를 물어볼 곳이 있어야 한다. 그 한 줄을 여기서
 * 남긴다.
 *
 * ── 🔴 새 감사 코드를 만들지 않았다 ──────────────────────────────────────
 * `audit_log_action_type` 은 **pgEnum** 이라 값을 하나 더하면 마이그레이션이다.
 * 기존 목록에 맞는 값이 있다 — `CREATE`(없던 것을 하나 만들었다)다.
 * `target_entity` 는 enum 이 아니라 **text** 이므로(schema/audit-logs.ts 머리말:
 * "auditing a new entity never requires a schema migration") 새 대상 이름은
 * 마이그레이션 없이 적을 수 있다. **스키마 변경이 0 이다.**
 *
 * ── 무엇을 적는가 ───────────────────────────────────────────────────────
 *  · `target_record_id` — 🔴 **수리 건 id**. 폴더에는 id 가 없고, 이 기록을 찾는
 *    사람은 늘 수리 건에서 출발한다.
 *  · `new_value` — 만든 **폴더 이름**뿐이다. 🔴 루트 · 절대 경로는 적지 않는다
 *    (그 값은 서버 구조를 알려 주고, 마운트 위치가 바뀌면 거짓이 된다).
 *  · `previous_value` — 없다. 없던 것이 생긴 것이라 적을 지난 값이 없다.
 *
 * 트랜잭션 하나에 이 줄만 들어간다 — 이 일의 본체는 DB 가 아니라 **파일시스템**이라
 * 함께 묶을 다른 쓰기가 없다. 그래도 insertAuditLog 의 약속(늘 트랜잭션 안에서 쓴다)은
 * 지킨다.
 * ============================================================================
 */

/** 감사 기록에서 이 폴더를 가리키는 이름. 🔴 테이블이 아니라 **사람의 서류함**이다. */
export const CONTACT_FOLDER_AUDIT_ENTITY = "repair_case_contact_folder";

export async function recordContactFolderCreated(input: {
  /** 누른 사람. 🔴 이 길에는 시스템이 혼자 만드는 경우가 없다 — 늘 사람이 있다. */
  actorUserId: string;
  repairCaseId: string;
  /** 디스크에 만들어진 **실제 폴더 이름**. */
  folderName: string;
}): Promise<void> {
  await db.transaction(async (tx) => {
    await insertAuditLog(tx, {
      actorUserId: input.actorUserId,
      actionType: "CREATE",
      targetEntity: CONTACT_FOLDER_AUDIT_ENTITY,
      targetRecordId: input.repairCaseId,
      newValue: { folderName: input.folderName },
    });
  });
}
