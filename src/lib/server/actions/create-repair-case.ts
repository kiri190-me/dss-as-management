"use server";

import { readSession } from "@/lib/auth/session";
import { sessionActorWithDeveloperFlag } from "@/lib/auth/acting-user";
import { getRepairCaseReadSource } from "@/lib/config/read-source";
import { getRepairCaseWriteSource } from "@/lib/config/write-source";
import { MAX_ATTACHMENT_SIZE_BYTES } from "@/lib/domain/attachment-allowlist";
import { checkIntakeRepairRequestFile } from "@/lib/domain/intake-repair-request";
import { createRepairCaseWithIdempotency } from "@/lib/server/services/create-repair-case";
import type { CreateRepairCaseResult } from "@/lib/validation/repair-case-input";
import type { IntakeSubmissionInput } from "@/lib/domain/local/submit-intake";

/**
 * Server Action: database-backed repair-case creation. Called directly
 * (not via <form action>) from IntakeFormInner.tsx's submit handler, which
 * already builds this exact IntakeSubmissionInput shape for the existing
 * local/localStorage path — reused verbatim here rather than defining a
 * parallel input type.
 *
 * Never called unless REPAIR_CASE_WRITE_SOURCE=database (the caller
 * branches on the flag; this function re-checks it independently too, so
 * it is never reachable via a stale/misconfigured caller either).
 *
 * `idempotencyKey`: client-generated crypto.randomUUID(), minted once per
 * intake draft (src/lib/domain/local/intake-idempotency-key.ts) and reused
 * verbatim across double-click/refresh/network-retry resubmissions of that
 * same draft. Claimed via claimIdempotencyKey() *before* insertRepairCase()
 * runs, and resolved (SUCCEEDED/FAILED) immediately after — three short,
 * independent statements rather than one long transaction spanning the
 * whole request, so a claim survives even if insertRepairCase() itself
 * throws (see idempotency-keys.ts's module comment).
 *
 * ============================================================================
 * 🔴 `repairRequest` — 접수와 **함께** 올라오는 수리 의뢰서 (2026-10-19, 선택)
 * ============================================================================
 * 사용자 결정은 「접수할 때 파일도 함께 보내기」다. 그래서 **요청을 둘로 가르지
 * 않는다** — 단추 한 번이 요청 하나이고, 파일 바이트가 그 요청에 실려 온다.
 *
 * ── 왜 서버 액션으로 보내는가 (올리기 통로를 따로 내지 않았다) ────────────
 *  · 🔴 **덩치가 이미 통과하는 길이다.** `next.config.ts` 의
 *    `serverActions.bodySizeLimit` 이 **21mb** 로 잡혀 있고, 과거 인수품
 *    가져오기(actions/kyosan-intake-import.ts)가 같은 방식으로 20MiB 통합문서를
 *    FormData 에 담아 보낸다. 이 파일의 상한은 첨부와 같은 **20MB** 라 그 안이다.
 *  · 🔴 **스트림으로 흘려보낼 자리가 없다.** 첨부 올리기 통로(Route Handler)가
 *    본문을 디스크로 흘려보내는 까닭은 파일을 **디스크에 앉히기** 때문인데, 이
 *    파일은 **서버 디스크에 남기지 않기로** 한 것이다. 메일에 붙이려면 어차피
 *    바이트가 메모리에 있어야 하므로, 스트리밍이 아끼는 것이 없다.
 *  · 🔴 **차례를 지킬 수 있다.** 폴더 → 파일 → 메일 순서는 접수 서비스 안에서만
 *    지켜진다. 파일을 다른 요청으로 보내면 그 차례가 두 요청에 걸쳐 쪼개지고,
 *    둘째 요청이 영영 안 오면 메일이 통째로 안 나가거나 두 번 나간다.
 *  · base64 가 아니라 **FormData** 다 — base64 는 33% 부푼다(서명 이미지 ·
 *    과거 인수품 가져오기와 같은 판단).
 *
 * ── 한계(알고 고른 것) ───────────────────────────────────────────────────
 *  · 파일 한 장, **20MB** 까지. 그 위는 거절이고 화면이 사유를 보여 준다.
 *  · 20MB 는 요청이 끝날 때까지 **메모리에 머문다**(바이트 + 메일 첨부 인코딩).
 *    상한이 그것을 묶어 두고, 접수는 사람이 한 건씩 누르는 조작이다.
 *  · 🔴 메일 서버가 받아 주는 첨부 크기는 **이것과 별개**다 — 20MB 가 거절되면
 *    메일만 실패한다. 그때도 **파일은 연락서 폴더에 이미 들어가 있다**(순서의 덕).
 *
 * ── 🔴 받아도 되는 파일인지는 **만들기 전에** 가린다 ──────────────────────
 * 멱등 키를 집기 전, 접수를 만들기 전에 거절한다. 그래야 못 붙일 파일을 고른
 * 사람이 **접수를 다시 만들지 않고** 파일만 바꿔 다시 누를 수 있다. 🔵 접수가
 * 만들어진 **뒤**의 실패(폴더 · 메일)는 접수를 뒤집지 않는다 — 그쪽은 서비스가
 * 전부 삼킨다. 가르는 선은 「접수가 이미 생겼는가」다.
 * ============================================================================
 */
export async function createRepairCaseAction(
  input: IntakeSubmissionInput,
  idempotencyKey: string,
  /** 수리 의뢰서 한 장이 `file` 칸에 담겨 온다. 안 붙였으면 아예 넘어오지 않는다. */
  repairRequest?: FormData | null
): Promise<CreateRepairCaseResult> {
  const writeSource = getRepairCaseWriteSource();
  if (writeSource !== "database") {
    return {
      ok: false,
      code: "FORBIDDEN",
      message: "데이터베이스 저장 모드가 아닙니다.",
    };
  }

  // Approved policy: a DB write must never produce a case that then 404s
  // under a mock-mode detail resolver — fail clearly here rather than
  // silently falling back to either source.
  if (getRepairCaseReadSource() !== "database") {
    return {
      ok: false,
      code: "FORBIDDEN",
      message: "서버 설정 오류로 저장할 수 없습니다. 관리자에게 문의해 주세요.",
    };
  }

  const session = await readSession();
  if (!session) {
    return { ok: false, code: "UNAUTHORIZED", message: "로그인이 필요합니다." };
  }

  /*
   * ── 🔴 수리 의뢰서 — **로그인한 뒤, 접수를 만들기 전에** 가린다 ──────────
   * 안 붙였으면 `file` 이 없고, 이 토막은 아무것도 하지 않는다(선택 기능이다).
   *
   * 🔴 **브라우저가 알려 준 크기와 형식을 믿지 않는다** — `file.size` 로 먼저
   *   잘라 20MB 를 통째로 메모리에 올리는 일을 아끼지만, 판정은 **실물 바이트**로
   *   다시 한다(과거 인수품 가져오기와 같은 두 겹). 형식 판정은
   *   `checkIntakeRepairRequestFile` 하나가 하고, 그것이 부르는 것은 [파일 관리]
   *   올리기 통로와 **같은 허용목록 · 같은 앞머리 바이트 대조**다.
   *
   * 🔵 역할 관문(ALLOWED_INTAKE_CREATOR_ROLES)은 바로 아래 서비스가 본다 —
   *   여기서 가리는 것은 「이 바이트를 받아도 되는가」뿐이다.
   */
  let repairRequestFile: { fileName: string; mimeType: string; bytes: Buffer } | null = null;
  const picked = repairRequest?.get("file") ?? null;
  if (picked !== null) {
    if (!(picked instanceof File)) {
      return { ok: false, code: "VALIDATION_ERROR", message: "수리 의뢰서 파일을 확인할 수 없습니다." };
    }
    if (picked.size > MAX_ATTACHMENT_SIZE_BYTES) {
      return {
        ok: false,
        code: "VALIDATION_ERROR",
        message: `수리 의뢰서는 ${Math.round(MAX_ATTACHMENT_SIZE_BYTES / (1024 * 1024))}MB 이하만 붙일 수 있습니다.`,
      };
    }
    // 🔴 여기서 바이트가 **메모리로** 들어온다. 디스크에 쓰지 않으므로 지울 것이 없다.
    const bytes = Buffer.from(await picked.arrayBuffer());
    const checked = checkIntakeRepairRequestFile({ fileName: picked.name, bytes });
    if (!checked.ok) {
      return { ok: false, code: "VALIDATION_ERROR", message: checked.message };
    }
    repairRequestFile = { fileName: checked.fileName, mimeType: checked.mimeType, bytes };
  }

  // 역할·승인 상태는 예전대로 토큰 값이다. 개발자 표시만 살아 있는 행에서
  // 읽어 더한다 — 토큰에 담기지 않는 값이라 다른 길이 없다(acting-user.ts).
  const { isDeveloper } = await sessionActorWithDeveloperFlag(session);
  return createRepairCaseWithIdempotency({
    actor: {
      userId: session.userId,
      role: session.role,
      approvalStatus: session.approvalStatus,
      isDeveloper,
    },
    intake: input,
    idempotencyKey,
    logContext: "INTERACTIVE",
    // 🔴 안 붙였으면 null 이고, 서비스는 예전과 한 글자도 다르지 않게 돈다.
    repairRequest: repairRequestFile,
  });
}
