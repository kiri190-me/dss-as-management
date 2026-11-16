import "server-only";
import { eq, inArray } from "drizzle-orm";
import { db } from "../client";
import { portalApprovalDelegations, users } from "../schema";
import { insertAuditLog } from "./audit-logs";
import type { PortalDelegationOutcome } from "@/lib/server/integration/portal-delegation-push";

/**
 * ============================================================================
 * 포털이 전파한 결재권 위임을 받아 적는다 — 이 표에 쓰는 **유일한** 자리
 * ============================================================================
 * 표는 `portal_approval_delegations` 다. 🔴 **옆의 `approval_route_delegations`
 * (A/S 화면에서 사람이 맡기는 위임)와 다른 표**이고, 이 파일은 그 표를 한 글자도
 * 건드리지 않는다. 둘이 어떻게 갈리는지는 표 머리말의 네 줄짜리 비교표에 있다 —
 * 고칠 일이 생기면 **어느 쪽 이야기인지 먼저 가린 뒤에** 손대라(설계 B-4: 둘 다
 * 살려 둔다).
 *
 * 부르는 자리는 `app/api/integration/delegations/route.ts` 하나뿐이다. 화면에도
 * 서버 액션에도 이 함수들을 부르는 길이 없다 — 🔴 **이 표의 줄은 A/S 에서 만들지도
 * 되돌리지도 않는다**(표 머리말). 되돌리기는 통합 승인함에서 하고, 그 결과가 다시
 * 이 통로로 들어온다.
 *
 * ── 🔴 인가 판정이 **여기에 없다** ──────────────────────────────────────
 * 옆 표의 같은 파일은 `hasPermission(…, "users.shipmentRepresentatives", "MANAGE")`
 * 을 보고, 「본인인가 남인가」를 가른다. 여기는 **보지 않는다** — 부르는 쪽이
 * **사람이 아니라 포털**이고, 자격은 라우트가 포털의 서명 토큰으로 확인한다
 * (auth/portal-service-token.ts). 「누가 지정할 수 있는가」는 **승인함과 포털이**
 * 판정한다. 여기서 한 번 더 판정하면 판정 규칙이 두 곳이 되고, 포털에서는 통과한
 * 지정이 여기서만 거절돼 **전파 실패 → 지정 거절**(설계 B-13)이 된다.
 * 🔵 그 대신 **들어오는 값의 모양**은 깐깐하게 본다(server/integration/
 * portal-delegation-push.ts 의 parse — uuid·기간·사람 둘).
 *
 * ── 🔴 멱등을 무엇이 지키나 ─────────────────────────────────────────────
 * 포털은 전파가 실패하면 재시도한다(설계 B-13 — 한 곳이라도 실패하면 지정 자체를
 * 거절하므로, 사람은 다시 누르고 포털은 다시 보낸다). 그래서 같은 `id` 로 두 번
 * 와도 **한 줄**이어야 한다. 지키는 것은 둘이다:
 *   1. `id` 가 **기본키**이고 포털이 정한 값이다(표에 `defaultRandom()` 이 없다).
 *   2. 넣는 문장이 `ON CONFLICT (id) DO UPDATE` 다 — 두 번째는 **덮어쓴다.**
 * 🔵 「먼저 읽어 보고 없으면 INSERT」 가 아니다. 그 모양은 두 전파가 겹친 순간
 * 둘 다 「없다」를 읽고 둘 다 INSERT 해서 한쪽이 기본키 위반으로 500 이 된다.
 *
 * ── 🔴 `revoked_at` 은 **한 방향으로만** 움직인다 ───────────────────────
 * `upsert` 가 이 칸에 하는 일이 둘로 갈린다(2026-11-16 규약 보완):
 *   · **값이 실려 왔으면 그대로 적는다.** 포털이 거둔 줄을 `upsert` 로 보낼 수 있고,
 *     그 값을 흘리면 **포털은 거뒀다고 믿는데 여기서는 살아 있는** 줄이 남는다 —
 *     설계 B-13 이 가장 피하려는 모양이다.
 *   · 🔴 **널(또는 안 실림)이면 이미 적힌 값을 지우지 않는다.** 거둔 줄에 늦게 닿은
 *     `upsert`(두 전파가 길에서 뒤바뀐 경우)가 **위임을 되살리는** 길을 없애려는
 *     것이다. 되살아난 위임은 아무 오류도 없이 남의 결재를 누를 수 있게 한다.
 *     🔵 포털은 새 지정에 **새 `id`** 를 쓰므로 거둔 줄을 되살리는 정상적인 쓰임이
 *     없다 — 그래서 이 비대칭으로 잃는 것이 없다. 🔴 **세 시스템이 같아야 하는
 *     자리라, 규약이 이 경우를 적는 날 함께 고칠 것**(규약은 「값이 오면 적어라」까지만
 *     정했다).
 *
 * ── 감사 로그를 남긴다 — `actor_user_id` 는 **널**이다 ──────────────────
 * 남길지 말지를 정해야 했다. 「사람이 한 일」이 아니고 포털에 이미 기록이 있으므로
 * 안 남기는 선택지도 있었지만, **남기기로 했다.** 까닭 셋:
 *   1. 이 표의 줄은 **남의 결재를 누를 수 있게 하는 권한**이다. 옆 표의 같은 일이
 *      CREATE/UPDATE 로 남는데 이쪽만 안 남기면, 「그날 누가 이 결재를 누를 수
 *      있었나」를 뒤에서 되짚을 때 **포털 로그가 없으면 아무것도 안 나온다.**
 *   2. `synced_at` 은 **마지막** 전파 시각 하나뿐이라 덮어쓰면 앞의 것이 사라진다.
 *      기간이 바뀐 이력은 감사 로그에만 남는다.
 *   3. 어긋남 점검(설계 B-14)이 「여기만 있는 줄」을 발견했을 때, **언제 어떤 모양으로
 *      들어왔는지**를 읽을 자리가 필요하다.
 * `actorUserId: null` 은 이 저장소에서 **시스템이 한 일**을 뜻한다(audit-logs.ts 의
 * 규약 — 가짜 사용자 행을 만들지 않는다). 🔴 포털 쪽에서 **누가** 지정했는지를 여기
 * 적지 않는 것은, 그 사람이 A/S 계정이 아예 없을 수 있고 빈 칸이 「본인이 했다」로
 * 읽히는 날이 오기 때문이다(표 머리말).
 * ============================================================================
 */

/** 감사 기록의 targetEntity — **표 이름 그대로**(이 저장소의 규약). */
const AUDIT_ENTITY = "portal_approval_delegations";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type StorePortalApprovalDelegationParams = {
  /** 🔴 **포털이 정한 번호.** 여기서 만들지 않는다 — 멱등과 철회가 이 값에 달렸다. */
  id: string;
  /** A/S `users.id`. 포털 번호를 바꾼 결과다(라우트가 바꾼다). */
  delegatorUserId: string;
  delegateUserId: string;
  startsAt: Date;
  /** 🔴 이 순간은 포함하지 않는다(반열린 구간). */
  endsAt: Date;
  /** 안 보냈으면 빈 글자. 이 칸은 널을 받지 않는다. */
  reason: string;
  /**
   * 🔴 포털이 실어 보낸 철회 시각. 없거나 널이면 **살아 있는 줄**이다.
   * 🔴 널이 이미 적힌 값을 **지우지는 않는다**(머리말의 한 방향 규칙).
   */
  revokedAt: Date | null;
};

/** 두 사람의 이름을 한 번에. 🔴 **감사 로그가 스스로를 설명하게** 하는 값이다. */
async function readNames(tx: Tx, userIds: readonly string[]): Promise<Map<string, string>> {
  const rows = await tx
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(inArray(users.id, [...userIds]));
  return new Map(rows.map((row) => [row.id, row.name]));
}

/**
 * 포털이 보낸 위임 한 줄을 넣거나 덮어쓴다.
 *
 * 🔴 언제나 `"stored"` 다 — 「해당 없음」 판정은 **열쇠를 바꾸는 자리**에서 이미
 * 끝났다(server/integration/portal-delegation-push.ts). 돌려주는 타입을 맞춰 둔 것은
 * 라우트가 두 함수를 같은 모양으로 쓰게 하려는 것이다.
 *
 * 🔴 사람 둘이 **쓸 수 있는 계정인가**를 보지 않는다. 옆 표의 `createApprovalRoute
 * Delegation` 은 승인·활성·잠금을 보는데, 여기서 같은 것을 보면 포털에서는 통과한
 * 지정이 A/S 에서만 거절돼 **전파 실패 → 지정 자체가 거절**된다(설계 B-13). 잠기거나
 * 비활성인 계정이 결재를 못 누르는 것은 **결재 길목이 따로 막는다** — 위임 줄이
 * 있다고 로그인도 못 하는 사람이 결재를 누르지는 못한다.
 */
export async function storePortalApprovalDelegation(
  params: StorePortalApprovalDelegationParams
): Promise<PortalDelegationOutcome> {
  const now = new Date();

  // 🔵 돌려주는 타입을 **거래 콜백에 적는다.** 안 적으면 `"stored"` 가 그냥 string
  //    으로 넓어져 바깥 서명과 어긋난다(tsc 가 거기서 멈춘다).
  return db.transaction(async (tx): Promise<PortalDelegationOutcome> => {
    // 앞 모습을 먼저 읽는다 — 감사 로그의 previousValue 와 「새로 생긴 줄인가」를
    // 가르는 값이다. 🔴 **이 읽기가 멱등을 지키는 것이 아니다**(머리말 2번) —
    // 겹쳐 들어와도 아래 ON CONFLICT 가 한 줄로 모은다.
    const [before] = await tx
      .select({
        delegatorUserId: portalApprovalDelegations.delegatorUserId,
        delegateUserId: portalApprovalDelegations.delegateUserId,
        startsAt: portalApprovalDelegations.startsAt,
        endsAt: portalApprovalDelegations.endsAt,
        reason: portalApprovalDelegations.reason,
        revokedAt: portalApprovalDelegations.revokedAt,
      })
      .from(portalApprovalDelegations)
      .where(eq(portalApprovalDelegations.id, params.id));

    await tx
      .insert(portalApprovalDelegations)
      .values({
        id: params.id,
        delegatorUserId: params.delegatorUserId,
        delegateUserId: params.delegateUserId,
        startsAt: params.startsAt,
        endsAt: params.endsAt,
        reason: params.reason,
        revokedAt: params.revokedAt,
        syncedAt: now,
      })
      .onConflictDoUpdate({
        target: portalApprovalDelegations.id,
        set: {
          delegatorUserId: params.delegatorUserId,
          delegateUserId: params.delegateUserId,
          startsAt: params.startsAt,
          endsAt: params.endsAt,
          reason: params.reason,
          syncedAt: now,
          // 🔴 **한 방향으로만** 움직인다(머리말). 값이 실려 왔으면 적고, 널이면
          //    이미 적힌 값을 **지우지 않는다** — 늦게 닿은 upsert 가 거둔 위임을
          //    되살리면 아무 오류 없이 남의 결재를 누를 수 있게 된다.
          ...(params.revokedAt === null ? {} : { revokedAt: params.revokedAt }),
        },
      });

    const names = await readNames(tx, [params.delegatorUserId, params.delegateUserId]);
    const nameOf = (id: string) => names.get(id) ?? null;

    await insertAuditLog(tx, {
      // 🔴 사람이 아니라 **포털이 한 일**이다(머리말 — 가짜 사용자 행을 만들지 않는다).
      actorUserId: null,
      actionType: before ? "UPDATE" : "CREATE",
      targetEntity: AUDIT_ENTITY,
      targetRecordId: params.id,
      previousValue: before
        ? {
            delegator: { id: before.delegatorUserId, name: nameOf(before.delegatorUserId) },
            delegate: { id: before.delegateUserId, name: nameOf(before.delegateUserId) },
            startsAt: before.startsAt.toISOString(),
            endsAt: before.endsAt.toISOString(),
            reason: before.reason,
            revokedAt: before.revokedAt?.toISOString() ?? null,
          }
        : null,
      newValue: {
        // 🔴 id 만이 아니라 **이름도** 적는다. 나중에 그 사람이 소프트삭제돼도 로그만
        // 읽고 누구였는지 알 수 있어야 한다(옆 표의 감사 기록과 같은 규율).
        delegator: { id: params.delegatorUserId, name: nameOf(params.delegatorUserId) },
        delegate: { id: params.delegateUserId, name: nameOf(params.delegateUserId) },
        startsAt: params.startsAt.toISOString(),
        endsAt: params.endsAt.toISOString(),
        reason: params.reason,
        // 🔴 **적히고 난 뒤의 값**이다 — 실려 온 값이 이기고, 널이면 이미 있던 값이
        // 남는다(한 방향 규칙). 로그에 이 값이 보여야 「왜 승인함에는 살아 있는데
        // 여기선 안 듣나」를 나중에 풀 수 있다.
        revokedAt: (params.revokedAt ?? before?.revokedAt)?.toISOString() ?? null,
        // 🔵 출처를 글자로 남긴다 — 감사 로그만 떼어 읽는 사람에게 `actor` 가 빈
        // 까닭을 설명하는 유일한 값이다.
        source: "portal",
      },
    });

    return "stored";
  });
}

export type RevokePortalApprovalDelegationParams = {
  id: string;
  /** 🔴 포털이 적은 시각을 **그대로** 적는다 — 양쪽 줄이 같은 값을 들고 있어야 한다. */
  revokedAt: Date;
};

/**
 * 포털이 거둔 위임을 받아 적는다.
 *
 * 🔴 **없는 줄이면 `"not_applicable"`** — 오류가 아니다. 애초에 두 사람 중 하나가
 * A/S 계정이 없어 `not_applicable` 로 저장하지 않았던 위임일 수 있다. 그것을 실패로
 * 돌려주면 포털이 **철회 자체를 거절해서**(설계 B-13) 거두려는 사람이 영영 못 거둔다.
 *
 * 🔴 **조건을 걸지 않는다 — 이미 거둔 줄에도 다시 적는다.** 옆 표의 되돌리기는
 * 「아직 안 거뒀고 아직 안 끝난」 줄만 고르고 0행이면 거절하는데, 여기는 **거꾸로**다:
 * 포털이 재시도할 수 있어야 하므로 같은 값으로 두 번 와도 같은 결과여야 하고
 * (멱등), 기간이 끝난 줄에 늦게 닿은 철회를 거절하면 그 전파가 **영영 성공하지
 * 못한다.** 🔵 이미 같은 시각으로 거둔 줄이면 **감사 로그를 더 남기지 않는다** —
 * 재시도마다 한 줄씩 쌓이면 나중에 「몇 번 거뒀나」가 거짓으로 읽힌다.
 */
export async function revokePortalApprovalDelegation(
  params: RevokePortalApprovalDelegationParams
): Promise<PortalDelegationOutcome> {
  const now = new Date();

  return db.transaction(async (tx): Promise<PortalDelegationOutcome> => {
    const [before] = await tx
      .select({
        delegatorUserId: portalApprovalDelegations.delegatorUserId,
        delegateUserId: portalApprovalDelegations.delegateUserId,
        revokedAt: portalApprovalDelegations.revokedAt,
      })
      .from(portalApprovalDelegations)
      .where(eq(portalApprovalDelegations.id, params.id))
      // 🔴 FOR UPDATE — 같은 줄에 겹쳐 닿은 전파끼리 줄을 세운다. 없는 줄이면
      //    아무것도 잠그지 않는다(그때는 아래에서 바로 돌아선다).
      .for("update");

    if (!before) return "not_applicable";

    await tx
      .update(portalApprovalDelegations)
      .set({ revokedAt: params.revokedAt, syncedAt: now })
      .where(eq(portalApprovalDelegations.id, params.id));

    // 같은 시각으로 이미 거둬 둔 줄이면 **바뀐 것이 없다**(위 머리말).
    if (before.revokedAt?.getTime() === params.revokedAt.getTime()) return "stored";

    const names = await readNames(tx, [before.delegatorUserId, before.delegateUserId]);
    const nameOf = (id: string) => names.get(id) ?? null;

    await insertAuditLog(tx, {
      actorUserId: null,
      // 🔴 SOFT_DELETE 가 아니라 UPDATE 다. 줄은 지워지지 않고 칸 하나가 채워질 뿐이며,
      // 로그를 읽는 사람이 찾는 것은 「살아 있던 위임이 이때 거둬졌다」이다(옆 표와
      // 같은 판단).
      actionType: "UPDATE",
      targetEntity: AUDIT_ENTITY,
      targetRecordId: params.id,
      previousValue: { revokedAt: before.revokedAt?.toISOString() ?? null },
      newValue: {
        delegator: { id: before.delegatorUserId, name: nameOf(before.delegatorUserId) },
        delegate: { id: before.delegateUserId, name: nameOf(before.delegateUserId) },
        revokedAt: params.revokedAt.toISOString(),
        source: "portal",
      },
    });

    return "stored";
  });
}
