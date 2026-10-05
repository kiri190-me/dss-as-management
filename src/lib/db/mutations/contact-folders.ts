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

/**
 * ============================================================================
 * 🔴 **[DATA에 저장]** — 저장된 파일의 사본이 공유폴더에 생겼다는 기록 (조각 12)
 * ============================================================================
 * 사내 폴더로 가는 것이라 「밖으로 나갔다」는 아니다. 그래도 **남긴다**: 그 순간
 * 시스템 창고(권한 · 휴지통 · 감사가 걸린 자리)의 파일이 **사람이 읽는 이름으로
 * 공유폴더에 한 벌 더 생긴다.** 그 사본에는 앱의 권한이 걸리지 않고, 앱은 그것을
 * 지우지도 않는다 — 나중에 「이 파일이 왜 공유폴더에 있나」를 물을 곳이 있어야 한다.
 *
 * ── 🔴 새 감사 코드를 만들지 않았다 (위 폴더 만들기와 같은 판단) ──────────
 * `audit_log_action_type` 은 pgEnum 이라 값을 더하면 마이그레이션이다. 기존 목록에서
 * 고른 것은 **`FILE_DOWNLOAD`** 다 — 「저장돼 있던 파일을 꺼내 간 일」이고, 감사를
 * 훑는 사람이 「이 첨부가 어디로 나갔나」를 **한 코드로** 볼 수 있어야 하기 때문이다.
 * (`CREATE` 도 말은 되지만, 그러면 내려받기만 훑는 점검에서 이 줄이 빠진다.)
 *
 * ── 🔴 내려받기 줄과 **섞이지 않는다** ──────────────────────────────────
 * `target_entity` 가 `attachments` 가 아니라 **`repair_case_contact_folder`** 다
 * (text 라 마이그레이션이 없다 — schema/audit-logs.ts 머리말). 섞어 적으면 「누가
 * 손에 들고 나갔는가」와 「누가 사내 폴더에 꽂았는가」를 가를 수 없다. 대신 `new_value`
 * 에 첨부 id 를 실어 두 줄을 이을 수 있게 한다.
 *
 *  · `target_record_id` — 🔴 **수리 건 id**(폴더 기록과 같다. 폴더에는 id 가 없고,
 *    이 기록을 찾는 사람은 늘 수리 건에서 출발한다).
 *  · `new_value` — 첨부 id · 공유폴더에 **실제로 쓴 파일 이름** · 바이트 수, 그리고
 *    줄여서 꽂았으면 그 이름표. 🔴 루트 · 절대 경로 · 폴더 이름은 적지 않는다.
 *  · `previous_value` — 없다(없던 파일이 생긴 것이다).
 *
 * 🔴 **이번에 새로 꽂았을 때만 부른다.** 같은 내용이 이미 있어 쓰지 않은 경우
 * (`unchanged`)에는 공유폴더에 새로 생긴 것이 없다 — 폴더 기록이 `created` 일 때만
 * 남는 것과 같은 규율이다.
 * ============================================================================
 */
export async function recordContactFolderFileSaved(input: {
  /** 누른 사람. 🔴 이 길에도 시스템이 혼자 하는 경우가 없다. */
  actorUserId: string;
  repairCaseId: string;
  attachmentId: string;
  /** 공유폴더에 **실제로 쓴** 파일 이름(번호가 붙었을 수 있다). */
  fileName: string;
  fileSize: number;
  /** 줄여서 꽂았으면 그 이름표(`50pct` · `500KB`). 원본 그대로면 없다. */
  shrunkLabel?: string;
}): Promise<void> {
  await db.transaction(async (tx) => {
    await insertAuditLog(tx, {
      actorUserId: input.actorUserId,
      actionType: "FILE_DOWNLOAD",
      targetEntity: CONTACT_FOLDER_AUDIT_ENTITY,
      targetRecordId: input.repairCaseId,
      newValue: {
        attachmentId: input.attachmentId,
        // 원본 파일명과 같은 대접이다 — 무엇이 공유폴더에 생겼는지 알 수 없으면
        // 기록의 뜻이 없다(FILE_UPLOAD · FILE_DOWNLOAD 와 같은 판단).
        fileName: input.fileName,
        fileSize: input.fileSize,
        ...(input.shrunkLabel === undefined ? {} : { shrunkLabel: input.shrunkLabel }),
      },
    });
  });
}
