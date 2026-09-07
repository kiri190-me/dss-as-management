import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../client";
import { partOverhaulUnitPrices, parts } from "../schema";
import { insertAuditLog } from "./audit-logs";
import { resolveEligibleActor, type Tx } from "./procedure-templates";
import { hasPermission } from "@/lib/auth/permission-resolver";
import {
  validatePartOverhaulUnitPriceEntries,
  type PartOverhaulUnitPriceEntry,
} from "@/lib/validation/part-overhaul-unit-price-input";

/**
 * ============================================================================
 * O/H 단가 저장
 * ============================================================================
 * mutations/part-unit-prices.ts 와 **같은 모양**이고, 거기 적힌 판단들이 그대로
 * 적용된다:
 *
 *  · **🔴 빈 값은 0 으로 저장하지 않고 행을 지운다.** "정하지 않음"과 "0원(무상)"은
 *    다른 뜻이다(schema/part-overhaul-unit-prices.ts 머리말). 0 으로 바꿔 저장하면
 *    O/H 견적서가 정하지 않은 부품을 0원으로 청구하게 된다.
 *  · **바뀌지 않은 칸은 쓰지 않는다.** 저장을 눌렀다는 이유만으로 updated_by /
 *    updated_at 이 갈아엎어지면, "누가 이 O/H 단가를 정했나"를 물었을 때 실제로
 *    정한 사람이 아니라 마지막으로 저장 단추를 누른 사람이 나온다.
 *  · 행을 지울 때도 감사는 **UPDATE** 로 남긴다 — SOFT_DELETE/PURGE 는 "자료가
 *    없어졌다"는 뜻이라 여기서는 오해를 만든다.
 *
 * ── 형제 파일과 다른 곳은 두 군데뿐이다 ─────────────────────────────────
 *  1. **소유구분이 없다.** 그래서 감사 로그에도 owner / ownerLabel 을 싣지
 *     않는다 — 실을 값 자체가 없다(그 축이 없는 것이 이 표의 존재 이유다).
 *  2. **한 번의 저장이 부품 여럿에 걸친다.** 형제 쪽은 "부품 하나 × 소유자 넷"을
 *     한 표에서 편집하지만, O/H 단가는 O/H 부품 템플릿 화면이 "부품 열몇 개"를
 *     한 표에서 편집한다. 그래서 아래 savePartOverhaulUnitPrices 는 부품 하나를
 *     받지 않고 줄 목록을 받는다.
 * ============================================================================
 */

/**
 * ── 이 함수에는 트랜잭션도 권한 검사도 없다 ─────────────────────────────
 * 일부러다. 형제 파일(applyOneUnitPrice)과 같은 판단이다 — 부르는 쪽이 트랜잭션과
 * 행위자 판정, 권한(`inventory.parts` WRITE), 부품 잠금을 이미 마친 뒤 이 함수를
 * 부른다. 그 자리에서 하는 검사를 여기서 두 번 하지 않는다.
 *
 * 여기서 트랜잭션을 따로 열면 부품 열 개짜리 저장이 열 개의 트랜잭션으로 쪼개져,
 * 다섯째에서 막혔을 때 앞의 넷만 저장된 반쪽 상태가 만들어진다.
 *
 * 부품 한 칸분의 저장. 지우기·넣기·그대로 두기 셋 중 하나이고, 실제로 쓴 칸의
 * 수(0 또는 1)를 돌려준다.
 */
export async function applyOneOverhaulUnitPrice(
  tx: Tx,
  params: {
    partId: string;
    /** 감사 로그에 남길 품명. 부품이 나중에 지워져도 무엇의 단가였는지 읽히게. */
    partName: string;
    /** null 은 "정하지 않음" — 행을 지운다. */
    unitPrice: string | null;
    actorUserId: string;
  }
): Promise<number> {
  const { partId, unitPrice } = params;

  const [previous] = await tx
    .select({ id: partOverhaulUnitPrices.id, unitPrice: partOverhaulUnitPrices.unitPrice })
    .from(partOverhaulUnitPrices)
    .where(eq(partOverhaulUnitPrices.partId, partId));

  // ── 비운 칸 = 정하지 않음 → 행을 지운다(0 으로 저장하지 않는다) ────────
  if (unitPrice === null) {
    if (!previous) return 0;

    await tx.delete(partOverhaulUnitPrices).where(eq(partOverhaulUnitPrices.id, previous.id));
    await insertAuditLog(tx, {
      actorUserId: params.actorUserId,
      actionType: "UPDATE",
      targetEntity: "part_overhaul_unit_prices",
      targetRecordId: previous.id,
      previousValue: {
        partId,
        partName: params.partName,
        unitPrice: previous.unitPrice,
      },
      newValue: { partId, unitPrice: null, cleared: true },
    });
    return 1;
  }

  // ── 바뀌지 않았으면 쓰지 않는다 ────────────────────────────────────────
  //
  // ⚠️ 문자열끼리 비교하지 않는다. DB 는 numeric(15,2) 를 "125000.00" 으로
  // 돌려주는데 사람은 "125000" 이라고 친다 — 글자로 대면 늘 다르다고 나와서,
  // 저장할 때마다 updated_by 가 갈아엎어지고 감사 로그에 값이 같은 UPDATE 가
  // 쌓인다. 원화 금액 범위에서 Number 비교는 안전하다(2^53 보다 한참 작다).
  if (previous && Number(previous.unitPrice) === Number(unitPrice)) return 0;

  const [saved] = await tx
    .insert(partOverhaulUnitPrices)
    .values({ partId, unitPrice, updatedBy: params.actorUserId })
    .onConflictDoUpdate({
      // 부품마다 한 줄이므로 충돌 대상도 part_id 한 칸이다(형제 표가
      // (part_id, owner) 를 쓰는 자리).
      target: partOverhaulUnitPrices.partId,
      set: { unitPrice, updatedBy: params.actorUserId, updatedAt: new Date() },
    })
    .returning({ id: partOverhaulUnitPrices.id });

  await insertAuditLog(tx, {
    actorUserId: params.actorUserId,
    actionType: previous ? "UPDATE" : "CREATE",
    targetEntity: "part_overhaul_unit_prices",
    targetRecordId: saved.id,
    // 행이 없던 상태의 "이전 값"은 null 이다 — 기본값이 따로 없고, 정하지
    // 않았다는 것이 그때 실제로 통하던 상태다.
    previousValue: {
      partId,
      partName: params.partName,
      unitPrice: previous?.unitPrice ?? null,
    },
    newValue: { partId, unitPrice },
  });
  return 1;
}

export type SavePartOverhaulUnitPricesResult =
  | { ok: true; changedCount: number }
  | {
      ok: false;
      code: "FORBIDDEN" | "NOT_FOUND" | "INVALID_INPUT";
      message: string;
      /** 부품 id → 그 줄에 붙일 문장. 형식 오류일 때만 실린다. */
      fieldErrors?: Record<string, string>;
    };

/**
 * 거절을 트랜잭션 밖으로 던지기 위한 신호. 콜백에서 그냥 반환하면 트랜잭션이
 * **커밋된다**(savePartOwnerSettings 의 SaveRejected 와 같은 이유).
 */
class SaveRejected extends Error {
  constructor(readonly result: Extract<SavePartOverhaulUnitPricesResult, { ok: false }>) {
    super(result.message);
    this.name = "SaveRejected";
  }
}

/**
 * 재고 mutation 들이 쓰는 그 함수를 그대로 부른다 — 계정이 지워졌는지·잠겼는지·
 * 승인됐는지를 한 곳에서만 판정하기 위한 것이다. 실패는 이 파일의 거절 신호로
 * 바꿔 던진다(저쪽 오류 종류가 이 파일 밖으로 새지 않게).
 */
async function requireActor(tx: Tx, actorUserId: string) {
  try {
    return await resolveEligibleActor(tx, actorUserId);
  } catch {
    throw new SaveRejected({ ok: false, code: "FORBIDDEN", message: "사용자 정보를 확인할 수 없습니다." });
  }
}

export type SavePartOverhaulUnitPricesInput = {
  /** 보내지 않은 부품은 건드리지 않는다(= 지금 값 그대로). */
  entries: unknown;
  actorUserId: string;
};

/**
 * ============================================================================
 * 여러 부품의 O/H 단가를 **한 트랜잭션에** 저장한다
 * ============================================================================
 * savePartOwnerSettings 를 본보기로 삼았고, 거기서 이미 내려진 판단들을 그대로
 * 가져왔다.
 *
 *  1) **한 트랜잭션.** 화면이 부품 열몇 개를 한 표에서 한 단추로 저장하므로,
 *     다섯째에서 막혔는데 앞의 넷만 저장되는 일은 없어야 한다.
 *  2) **트랜잭션 안에서 행위자를 다시 읽는다.** 세션이 만들어진 뒤 역할이
 *     내려갔거나 계정이 잠겼을 수 있다(resolveEligibleActor).
 *  3) **권한은 일반 단가와 같은 판정이다** — `inventory.parts` WRITE. 오버홀
 *     단가도 그 부품을 어떻게 청구할지 정하는 값이라, 품명·도번·일반 단가를 고칠
 *     수 있는 사람과 같은 판정이 맞다. O/H 라는 이유로 다른 권한을 새로 만들면
 *     같은 성격의 값 둘이 서로 다른 사람에게 열리게 된다.
 *  4) **화면이 보낸 값을 그대로 믿지 않는다.** 화면을 거치지 않고 이 mutation 을
 *     부를 수 있으므로 validation 을 여기서 한 번 더 태운다 — 화면과 같은 순수
 *     함수를 부르므로 규칙이 두 벌이 되지 않는다.
 *  5) **검증은 쓰기 전에 전부 끝낸다.** 저장하다가 중간에 형식 오류를 만나면
 *     트랜잭션이 되돌려지긴 하지만, 그 전에 감사 로그까지 썼다가 되돌리는 것보다
 *     아예 시작하지 않는 편이 낫다.
 *
 * ── 부품 행을 잡아 두는 이유, 그리고 그 순서 ────────────────────────────
 * softDeletePart 도 같은 행을 FOR UPDATE 로 잡는다 — 저장하는 동안 그 부품이
 * 휴지통으로 넘어가지 않는 것만 보장한다. version 은 읽지도 올리지도 않는다
 * (그쪽은 품명을 고치는 일이고 이쪽은 단가를 고치는 일이라 서로를 막을 이유가
 * 없다 — savePartOwnerSettings 의 그 판단과 같다).
 *
 * ⚠️ 여러 부품을 한꺼번에 잡으므로 **잡는 순서를 id 로 고정한다.** 두 사람이
 * 겹치는 부품 목록을 서로 다른 순서로 저장하면 교착(deadlock)이 난다. 순서가
 * 같으면 뒤엣사람이 기다렸다 이어서 할 뿐이다.
 * ============================================================================
 */
export async function savePartOverhaulUnitPrices(
  input: SavePartOverhaulUnitPricesInput
): Promise<SavePartOverhaulUnitPricesResult> {
  const validated = validatePartOverhaulUnitPriceEntries(input.entries);
  if (!validated.ok) {
    return {
      ok: false,
      code: "INVALID_INPUT",
      message: "O/H 단가 입력을 확인해 주세요.",
      fieldErrors: validated.fieldErrors,
    };
  }

  const entries: PartOverhaulUnitPriceEntry[] = validated.data;
  // 고칠 줄이 하나도 없으면 트랜잭션을 열 이유가 없다. (inArray 에 빈 배열을
  // 넘기지 않기 위한 방어이기도 하다.)
  if (entries.length === 0) return { ok: true, changedCount: 0 };

  try {
    return await db.transaction(async (tx): Promise<SavePartOverhaulUnitPricesResult> => {
      const actor = await requireActor(tx, input.actorUserId);

      if (!(await hasPermission(actor, "inventory.parts", "WRITE"))) {
        throw new SaveRejected({ ok: false, code: "FORBIDDEN", message: "수정 권한이 없습니다." });
      }

      const applied = await applyOverhaulUnitPricesInTx(tx, { entries, actorUserId: actor.id });
      if (!applied.ok) {
        throw new SaveRejected({ ok: false, code: applied.code, message: applied.message });
      }

      return { ok: true, changedCount: applied.changedCount };
    });
  } catch (err) {
    if (err instanceof SaveRejected) return err.result;
    throw err;
  }
}

/**
 * ============================================================================
 * 줄들을 **남의 트랜잭션 안에서** 적용한다
 * ============================================================================
 * 위 savePartOverhaulUnitPrices 와 O/H 부품 템플릿 저장(mutations/oh-part-templates.ts)이
 * **이 함수 하나를 함께 쓴다.** 잠금 순서와 "하나라도 없으면 전부 거절" 규칙을
 * 두 곳에 베껴 두면 한쪽만 고쳐지는 날 두 진입점이 다르게 행동한다.
 *
 * ── 왜 템플릿 저장이 이것을 부르는가 ────────────────────────────────────
 * O/H 부품 템플릿 화면은 부품 목록 · 이 기종의 O/H 작업비 · 부품별 O/H 단가를
 * **한 표에서 한 단추로** 저장한다. 그런데 앞의 둘은 oh_part_templates 에, 단가는
 * part_overhaul_unit_prices 에 산다. 트랜잭션을 따로 열면 "부품 목록은 저장됐는데
 * 단가는 안 된" 반쪽 상태가 만들어지고, 템플릿 저장이 version 을 올리는 탓에
 * **실패한 저장이 버전만 올려놓고 끝난다.** 그래서 한 트랜잭션이다
 * (part-minimum-quantities.ts 가 한계수량과 단가를 묶은 것과 같은 판단).
 *
 * 권한과 행위자 판정은 **여기서 하지 않는다** — 부르는 쪽이 이미 마쳤고, 둘 다
 * 같은 판정(`inventory.parts` WRITE)을 쓴다. 그 자리에서 하는 검사를 여기서 두 번
 * 하지 않는다.
 * ============================================================================
 */
export async function applyOverhaulUnitPricesInTx(
  tx: Tx,
  params: { entries: PartOverhaulUnitPriceEntry[]; actorUserId: string }
): Promise<
  { ok: true; changedCount: number } | { ok: false; code: "NOT_FOUND"; message: string }
> {
  // 고칠 줄이 없으면 질의를 열지 않는다. inArray 에 빈 배열을 넘기지 않기 위한
  // 방어이기도 하다.
  if (params.entries.length === 0) return { ok: true, changedCount: 0 };

  const partIds = params.entries.map((entry) => entry.partId);
  const lockedParts = await tx
    .select({ id: parts.id, partName: parts.partName })
    .from(parts)
    .where(and(inArray(parts.id, partIds), eq(parts.isDeleted, false)))
    // 🔴 잡는 순서를 고정한다 — 위 머리말의 교착 이야기.
    .orderBy(parts.id)
    .for("update");

  const partNameById = new Map(lockedParts.map((part) => [part.id, part.partName]));
  // 하나라도 없으면 전부 거절한다. 없는 부품을 조용히 건너뛰면 사람은 그
  // 줄까지 저장됐다고 믿는다.
  if (partNameById.size !== partIds.length) {
    return { ok: false, code: "NOT_FOUND", message: "해당 부품을 찾을 수 없습니다." };
  }

  let changedCount = 0;
  for (const entry of params.entries) {
    changedCount += await applyOneOverhaulUnitPrice(tx, {
      partId: entry.partId,
      partName: partNameById.get(entry.partId) as string,
      unitPrice: entry.unitPrice,
      actorUserId: params.actorUserId,
    });
  }
  return { ok: true, changedCount };
}
