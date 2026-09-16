import "server-only";

import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, notInArray, sql } from "drizzle-orm";
import { db } from "../client";
import { powerTestTasks, repairLaborSettings, repairTaskCatalog } from "../schema";
import { insertAuditLog } from "./audit-logs";
import {
  REPAIR_LABOR_SCOPES,
  repairLaborScopeLabels,
  type RepairLaborFields,
  type RepairLaborScope,
} from "@/lib/validation/repair-task-input";

/**
 * ============================================================================
 * 수리 작업 비용 — 저장
 * ============================================================================
 * 화면이 **장비 종류 하나분을 통째로** 편집한다(단가 설정 + 작업 목록). 그래서
 * 저장도 종류 하나가 단위이고, 전부 **한 트랜잭션**이다 — 목록은 저장됐는데
 * 단가는 안 된 반쪽 상태가 되면 그 사이에 뽑은 견적서가 틀린 금액으로 나간다.
 *
 * ── 🔴 목록에서 빠진 줄은 **소프트 삭제**다 ─────────────────────────────
 * 지운 작업을 하드 삭제하면, 그 작업으로 이미 뽑아 둔 견적서가 무엇을 청구한
 * 것인지 답할 수 없게 된다. 견적서는 고객사에 나간 문서라 나중에 반드시
 * 되짚어 보게 된다. 그래서 목록에서 사라져도 줄 자체는 남는다.
 *
 * ── 차례는 화면이 늘어놓은 순서다 ───────────────────────────────────────
 * 사진의 표 순서가 그대로 뜻을 갖는다(OH 가 맨 아래인 데는 이유가 있다).
 * 저장하는 쪽이 1부터 다시 매긴다 — oh_part_templates 의 replaceItems 와 같다.
 *
 * ── 갈래 목록 셋도 같은 방식으로 나란히 저장한다 ────────────────────────
 * 표는 다르지만(power_test_tasks) 다루는 법은 똑같다: 목록 통째로 받아 빠진 줄은
 * 소프트 삭제하고, 남은 줄은 차례를 1부터 다시 매긴다. **같은 트랜잭션 안이다** —
 * 수리 목록은 저장됐는데 갈래 목록은 안 된 반쪽 상태를 만들지 않는다.
 * 이 목록들에는 **공수시간이 없다**(schema/repair-labor.ts 의 그 표 머리말).
 *
 * ── 🔴 갈래마다 따로 돈다 — 한 갈래의 저장이 옆 갈래를 지우지 않는다 ────
 * 2026-09-16 부터 그 표는 조사 · 통전 · 서류 셋을 한 표에 담는다. 그래서 아래
 * (1)(2)(3) 이 **언제나 `scope` 까지 걸고** 돈다. 안 걸면 (1)의 소프트 삭제가
 * 「이 장비에서 이번에 안 보낸 줄 전부」를 지워, 조사 탭에서 저장하는 순간 통전·서류
 * 목록이 통째로 사라진다. **이 파일에서 가장 크게 다칠 수 있는 자리다.**
 *
 * 부르는 쪽은 세 목록을 **언제나 셋 다** 싣는다 — 타입이
 * `Record<RepairLaborScope, …>` 라 하나를 빠뜨릴 수 없다
 * (validation/repair-task-input.ts 의 scopeTasks).
 *
 * ── 🔴 기본 작업비(base_cost) 칸은 **건드리지 않는다** ──────────────────
 * 2026-09-16 부터 기본 작업비는 세 공수시간의 합 × 시간당 단가이고, 그 칸은 넘어오기
 * 전의 금액을 되짚을 근거로만 남는다(schema/repair-labor.ts 의 그 주석). 그래서 아래
 * upsert 의 `values` 에도 `set` 에도 그 칸이 없다 — **안 보냈다고 NULL 로 덮이면
 * 이미 나간 견적서가 왜 그 금액이었는지 물어볼 곳이 사라진다.**
 *
 * ── 🔴 쓰는 차례가 규칙이다: 지우기 → 이름 밀어 두기 → 쓰기 ────────────
 * 두 목록 표에는 `(equipment_kind, task_name) WHERE is_deleted = false` 부분
 * unique 색인이 걸려 있다. 사람이 화면에서 당연히 하는 두 조작이 그 색인과
 * **찰나에** 부딪힌다.
 *
 *  - 작업 두 개의 **이름을 맞바꾼다.** 순환이라 어느 쪽을 먼저 써도 상대가 아직
 *    그 이름을 쥐고 있다.
 *  - 줄을 빼면서 **그 이름을 같은 저장에서 새 줄에** 쓴다. 새 줄이 들어갈 때 옛
 *    줄이 아직 살아 있다.
 *
 * 예전에는 「쓰기 → 지우기」 차례라 둘 다 색인 위반으로 막혔다. 자료가 깨지지는
 * 않았지만(트랜잭션이 통째로 되돌아간다) 정당한 조작이 안 됐고, 화면에는 "잠시 후
 * 다시 시도해 주세요"가 떴다 — 구조적인 문제라 다시 눌러도 영영 안 되는데도.
 *
 * 그래서 차례를 셋으로 나눈다. 아래 두 목록에 **똑같이** 적용한다.
 *
 *  (1) 목록에서 빠진 줄을 **먼저** 소프트 삭제한다. 삭제 대상은 payload 의 id 만
 *      보면 알 수 있으므로 아무것도 쓰기 전에 판정할 수 있다.
 *  (2) 고칠 줄의 이름을 **줄마다 다른 임시값**으로 한꺼번에 밀어 둔다.
 *  (3) 그 다음에 진짜 값을 쓴다 — 이제 어느 순서로 써도 부딪히지 않는다.
 *
 * 그러고도 남는 길은 **다른 쓰는 쪽과 같은 순간에 부딪히는** 경우뿐이다. 그것은
 * 아래 `NAME_CONFLICT` 가 사실대로 말한다("잠시 후 다시"라고 하지 않는다).
 * ============================================================================
 */

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * 🔴 이름을 잠깐 옮겨 담는 임시값의 머리글자.
 *
 * 이름 맞바꾸기(A↔B)를 **한 번의 저장으로** 끝내려고, 고칠 줄의 이름을 먼저 겹칠
 * 수 없는 값으로 밀어 두고 진짜 이름을 쓴다(saveRepairLabor 의 (2)단계). 한
 * 트랜잭션 안이라 이 값이 밖으로 보이는 순간은 없고, 실패하면 통째로 되돌아간다.
 *
 * 사람이 적을 수 없는 모양으로 둔다 — 어쩌다 이 값이 남는 사고가 나면 목록에서
 * 곧바로 눈에 띄어야 하기 때문이다. 시험이 "저장이 끝난 뒤 이 글자를 쥔 줄이
 * 하나도 없다"를 못 박으므로 밖으로 내보낸다.
 */
export const STAGED_TASK_NAME_PREFIX = "⟪저장중⟫";

export type SaveRepairLaborResult =
  | { ok: true; changedCount: number }
  | { ok: false; code: "NOT_FOUND"; message: string }
  /**
   * 같은 건명이 이미 있어 색인이 막았다.
   *
   * 위 (1)(2) 뒤로 이 갈래에 닿는 길은 **이 표를 쓰는 다른 쪽과 같은 순간에
   * 부딪히는** 경우뿐이다 — 지금은 `scripts/seed-repair-tasks.ts` 가 그것이다.
   * 그 스크립트는 repair_task_catalog 에 먼저 넣고 repair_labor_settings 를
   * 나중에 손대며, 한 트랜잭션으로 묶지도 않는다.
   *
   * 이 함수끼리는 부딪히지 않는다: 첫 쓰기가 그 종류의 repair_labor_settings 줄에
   * 대한 upsert 라, 같은 종류를 동시에 저장하면 두 번째가 **그 줄 잠금에서**
   * 기다린다. 먼저 것이 커밋된 뒤에야 (1)이 돌고, 그때는 상대가 만든 줄까지 보고
   * 판정한다. 그래도 이 갈래를 남긴다 — 쓰는 쪽이 하나 더 늘 때 사람이 다시
   * "잠시 후 다시 시도해 주세요"를 듣게 되는 것을 막는 그물이다.
   *
   * payload 안의 중복 건명은 여기까지 오지 않는다 — 그건 칸별 오류로 화면에
   * 뜬다(validation/repair-task-input.ts 의 seenNames).
   */
  | { ok: false; code: "NAME_CONFLICT"; message: string };

/** Postgres unique_violation. */
const PG_UNIQUE_VIOLATION = "23505";

/**
 * 건명 중복을 막는 부분 unique 색인 이름 → 사람에게 할 말.
 *
 * 🔴 **23505 만 보고 삼키지 않는다.** 색인 이름까지 맞춰야 앞으로 이 표에 다른
 * 유니크 색인이 붙는 날 그 위반이 "건명이 겹칩니다"로 둔갑하지 않는다. 여기에
 * 없는 오류는 그대로 던져 서버 액션이 진짜 장애로 다루게 둔다.
 */
const NAME_CONFLICT_MESSAGES: Record<string, (scope: RepairLaborScope | null) => string> = {
  repair_task_catalog_kind_name_not_deleted_unique: () =>
    "같은 건명의 작업이 이미 있습니다. 같은 장비 종류를 같은 순간에 고친 쪽이 있습니다 — 최신 정보를 다시 불러온 뒤 겹치는 건명을 고쳐 주세요.",
  // 0100 에서 색인이 (장비, scope, 건명) 으로 넓어지며 이름이 바뀌었다. 🔴 옛 이름을
  // 그대로 두면 열쇠가 어긋나 겹침이 "건명이 겹칩니다" 대신 **진짜 장애**로 올라간다.
  //
  // 🔴 **문구가 어느 갈래인지 말한다.** 색인 이름 하나로 세 목록을 다 막으므로, 예전처럼
  // '통전'으로 굳혀 두면 조사 탭에서 겹친 사람이 통전 목록을 뒤지게 된다. 색인 이름만으로는
  // 갈래를 알 수 없어, **그때 쓰고 있던 갈래**를 함께 받는다(saveRepairLabor 의 writingScope).
  power_test_tasks_kind_scope_name_not_deleted_unique: (scope) =>
    `같은 건명의 ${scope ? `${repairLaborScopeLabels[scope]} 작업` : "작업"}이 이미 있습니다. 같은 장비 종류를 같은 순간에 고친 쪽이 있습니다 — 최신 정보를 다시 불러온 뒤 겹치는 건명을 고쳐 주세요.`,
};

/**
 * 건명 색인 위반이면 사람에게 할 말을, 아니면 undefined 를 준다.
 *
 * 🔴 drizzle 이 드라이버 오류를 **자기 오류로 감싸므로** `cause` 까지 본다. 바깥
 * 오류에는 코드도 색인 이름도 없다(이 저장소의 customers.ts · product-models.ts
 * 가 같은 이유로 cause 를 본다). 그 모양은 통합 시험이 못 박아 둔다.
 *
 * @param scope 그 오류가 났을 때 쓰고 있던 갈래. 수리 작업 목록을 쓰던 중이면 null 이다.
 */
function nameConflictMessage(err: unknown, scope: RepairLaborScope | null): string | undefined {
  for (const candidate of [err, err instanceof Error ? err.cause : undefined]) {
    if (typeof candidate !== "object" || candidate === null) continue;
    const fields = candidate as { code?: unknown; constraint_name?: unknown };
    if (fields.code !== PG_UNIQUE_VIOLATION) continue;
    if (typeof fields.constraint_name !== "string") continue;
    const message = NAME_CONFLICT_MESSAGES[fields.constraint_name];
    if (message) return message(scope);
  }
  return undefined;
}

/**
 * 🔴 거절을 **트랜잭션 밖으로 던지기** 위한 신호.
 *
 * 콜백에서 그냥 `return` 하면 트랜잭션이 **커밋된다.** 아래 거절은 단가와 앞쪽
 * 작업 줄을 이미 고친 뒤에 나오므로, 반환해 버리면 "일부만 저장되고 오류 메시지가
 * 뜬" 최악의 상태가 된다 — 사람은 저장이 안 된 줄 알고 다시 누른다.
 * (part-overhaul-unit-prices.ts · oh-part-templates.ts 의 같은 장치.)
 */
class SaveRejected extends Error {
  constructor(readonly result: Extract<SaveRepairLaborResult, { ok: false }>) {
    super(result.message);
    this.name = "SaveRejected";
  }
}

/**
 * 장비 종류 하나분을 저장한다.
 *
 * 권한·행위자 판정은 **부르는 쪽(서버 액션)이 이미 마쳤다.** 이 계층은 기계다
 * (mutations/quotes.ts 와 같은 판단).
 */
export async function saveRepairLabor(params: {
  fields: RepairLaborFields;
  actorUserId: string;
}): Promise<SaveRepairLaborResult> {
  const {
    equipmentKind,
    hourlyRate,
    investigationHours,
    powerTestHours,
    documentHours,
    tasks,
    scopeTasks,
  } = params.fields;

  /**
   * 🔴 색인 위반이 났을 때 **어느 갈래를 쓰고 있었는지**. 아래 catch 가 사람에게 할
   * 말을 고를 때 쓴다(NAME_CONFLICT_MESSAGES 의 그 항목). 색인 이름 하나가 세 목록을
   * 다 막으므로 이것 없이는 "통전"으로 굳은 말밖에 못 한다. 수리 작업 목록을 쓰는
   * 동안에는 null 이다.
   */
  let writingScope: RepairLaborScope | null = null;

  /**
   * 이름을 잠깐 옮겨 담을 임시값의 앞부분(아래 (2)단계).
   *
   * 뒤에 **그 줄의 id** 를 붙여 쓰므로 줄마다 반드시 다르다. 앞에는 사람이 적을
   * 수 없는 머리글자(STAGED_TASK_NAME_PREFIX)에 더해 저장 한 번마다 새로 뽑는
   * 값을 둔다 — 누군가 임시값처럼 생긴 이름을 실제로 적어 둔 표에서도 그 이름과
   * 부딪히지 않게 하려는 것이다. 한 트랜잭션 안에서만 존재하고, 그 안에서
   * (3)단계가 반드시 진짜 이름으로 덮는다.
   */
  const stagedNamePrefix = `${STAGED_TASK_NAME_PREFIX}${randomUUID()}:`;

  return db.transaction(async (tx): Promise<SaveRepairLaborResult> => {
    const previous = await readKind(tx, equipmentKind);

    // ── 단가 설정 ────────────────────────────────────────────────────────
    // 종류마다 한 줄이므로 충돌 대상도 그 칸 하나다. 줄이 없으면 만든다 —
    // 시드를 안 돌린 채로 화면에서 먼저 저장하는 길도 막히지 않아야 한다.
    //
    // 🔴 `baseCost` 가 없는 것이 빠뜨린 것이 아니다 — 이 파일 머리말의 「기본 작업비
    // 칸은 건드리지 않는다」. 없던 종류를 새로 만들 때만 그 칸이 NULL 로 시작한다.
    await tx
      .insert(repairLaborSettings)
      .values({
        equipmentKind,
        hourlyRate,
        investigationHours,
        powerTestHours,
        documentHours,
        updatedBy: params.actorUserId,
      })
      .onConflictDoUpdate({
        target: repairLaborSettings.equipmentKind,
        set: {
          hourlyRate,
          investigationHours,
          powerTestHours,
          documentHours,
          updatedBy: params.actorUserId,
          updatedAt: new Date(),
        },
      });

    // ── 작업 목록 ────────────────────────────────────────────────────────
    // 차례는 **지우기 → 이름 밀어 두기 → 쓰기**다. 왜 그 차례인지는 이 파일
    // 머리말의 「쓰는 차례가 규칙이다」에 있다.

    // (1) 목록에서 빠진 줄을 **먼저** 소프트 삭제한다(위 머리말).
    //     삭제 대상은 payload 에 실려 온 id 만 보면 알 수 있다 — 예전처럼 UPDATE
    //     가 성공한 id 를 모을 때까지 기다릴 이유가 없다. 먼저 지워야 「뺀 줄의
    //     이름을 같은 저장에서 새 줄에 다시 쓰는」 조작이 색인에 걸리지 않는다:
    //     새 줄이 들어갈 때 옛 줄은 이미 `is_deleted = true` 라 색인 밖이다.
    //     🔴 목록이 **빈 배열**이면 지금까지처럼 그 종류가 통째로 소프트
    //     삭제된다 — 이 함수의 계약이고, 이 작업은 그 계약을 바꾸지 않는다.
    //     notInArray 에 빈 배열을 넘길 수 없어 조건을 나눈다.
    const submittedTaskIds = [...new Set(tasks.flatMap((task) => (task.id ? [task.id] : [])))];
    await tx
      .update(repairTaskCatalog)
      .set({ isDeleted: true, deletedAt: new Date(), deletedBy: params.actorUserId })
      .where(
        and(
          eq(repairTaskCatalog.equipmentKind, equipmentKind),
          eq(repairTaskCatalog.isDeleted, false),
          submittedTaskIds.length > 0
            ? notInArray(repairTaskCatalog.id, submittedTaskIds)
            : sql`true`
        )
      );

    // (2) 고칠 줄의 이름을 임시값으로 밀어 둔다 — 맞바꾸기(A↔B)가 되게 하는 단계다.
    //     (1)만으로는 안 풀린다: 두 줄 다 살아남으므로 먼저 쓰는 쪽이 아직 살아
    //     있는 상대의 이름을 집는다. 순환이라 어떤 순서로 써도 마찬가지다.
    //
    //     🔴 **이름이 안 바뀌는 줄까지 전부 거치게 한다.** 무엇이 바뀌는지 가리려면
    //     지금 DB 의 이름을 다시 읽어 견주는 판정이 하나 더 생기고, 그 판정이
    //     틀리는 날의 증상은 "가끔 저장이 안 된다"가 된다. 게다가 아래는 줄 수와
    //     무관하게 UPDATE **한 번**이라, 전부 거쳐도 비용이 늘지 않는다.
    if (submittedTaskIds.length > 0) {
      const staged = await tx
        .update(repairTaskCatalog)
        .set({ taskName: sql`${stagedNamePrefix} || ${repairTaskCatalog.id}::text` })
        .where(
          and(
            eq(repairTaskCatalog.equipmentKind, equipmentKind),
            eq(repairTaskCatalog.isDeleted, false),
            inArray(repairTaskCatalog.id, submittedTaskIds)
          )
        )
        .returning({ id: repairTaskCatalog.id });
      // 화면이 보낸 id 가 이 종류에 없다(딴 종류거나, 이미 지워졌거나, 아예
      // 없다). 조용히 새로 만들면 사람이 고친 줄이 아니라 딴 줄이 하나 생긴다 —
      // 거절하고 다시 불러오게 한다. 예전에는 이 판정을 아래 (3)의 UPDATE 가
      // 했는데, 그 답이 달라지지는 않는다: 두 곳 다 `id + 종류 + 안 지워짐`을
      // 본다. 🔴 반환이 아니라 **던진다** — 반환하면 (1)의 삭제가 커밋된다
      // (SaveRejected 주석).
      if (staged.length !== submittedTaskIds.length) {
        throw new SaveRejected({
          ok: false,
          code: "NOT_FOUND",
          message: "이미 지워진 작업이 있습니다. 최신 정보를 다시 불러온 뒤 시도해 주세요.",
        });
      }
    }

    // (3) 진짜 값을 쓴다. 여기서는 어떤 순서로 써도 색인에 걸리지 않는다 —
    //     고칠 줄은 전부 임시값을 쥐고 있고, 빠진 줄은 이미 색인 밖이다.
    for (const [index, task] of tasks.entries()) {
      const displayOrder = index + 1;
      if (task.id) {
        const [updated] = await tx
          .update(repairTaskCatalog)
          .set({
            taskName: task.taskName,
            hours: task.hours,
            isOverhaul: task.isOverhaul,
            displayOrder,
            updatedAt: new Date(),
            updatedBy: params.actorUserId,
          })
          .where(
            and(
              eq(repairTaskCatalog.id, task.id),
              eq(repairTaskCatalog.equipmentKind, equipmentKind),
              eq(repairTaskCatalog.isDeleted, false)
            )
          )
          .returning({ id: repairTaskCatalog.id });
        // (2)에서 이미 살아 있는 줄임을 확인했고 그 줄은 이 트랜잭션이 잠가 두고
        // 있으므로 여기서 못 찾히는 길은 없다. 그래도 판정을 남겨 둔다 — 위
        // 차례가 언젠가 다시 바뀌면, 임시값을 쥔 반쪽 저장이 조용히 커밋되는
        // 대신 거절로 드러나야 한다.
        if (!updated) {
          throw new SaveRejected({
            ok: false,
            code: "NOT_FOUND",
            message: "이미 지워진 작업이 있습니다. 최신 정보를 다시 불러온 뒤 시도해 주세요.",
          });
        }
        continue;
      }

      await tx.insert(repairTaskCatalog).values({
        equipmentKind,
        taskName: task.taskName,
        hours: task.hours,
        isOverhaul: task.isOverhaul,
        displayOrder,
        createdBy: params.actorUserId,
        updatedBy: params.actorUserId,
      });
    }

    // ── 갈래 목록 셋 — 조사 · 통전 · 서류 ────────────────────────────────
    // 위 작업 목록과 **같은 차례**다((1)(2)(3)). 다른 점은 공수시간도 오버홀 표시도
    // 없다는 것과, 🔴 **모든 조건에 `scope` 가 함께 걸린다**는 것이다
    // (schema/repair-labor.ts 의 power_test_tasks 머리말 — 한 표가 셋을 담는다).
    //
    // 🔴 갈래를 안 걸면 (1)의 소프트 삭제가 옆 갈래의 줄까지 「이번에 안 보낸 줄」로
    // 보고 지운다. 조사 탭에서 저장하는 순간 통전 목록이 통째로 사라지는 길이다.
    for (const scope of REPAIR_LABOR_SCOPES) {
      writingScope = scope;
      const scopeLabel = repairLaborScopeLabels[scope];
      const scopeList = scopeTasks[scope];
      const notFound = () =>
        new SaveRejected({
          ok: false,
          code: "NOT_FOUND",
          message: `이미 지워진 ${scopeLabel} 작업이 있습니다. 최신 정보를 다시 불러온 뒤 시도해 주세요.`,
        });

      const submittedScopeIds = [
        ...new Set(scopeList.flatMap((task) => (task.id ? [task.id] : []))),
      ];
      await tx
        .update(powerTestTasks)
        .set({ isDeleted: true, deletedAt: new Date(), deletedBy: params.actorUserId })
        .where(
          and(
            eq(powerTestTasks.equipmentKind, equipmentKind),
            eq(powerTestTasks.scope, scope),
            eq(powerTestTasks.isDeleted, false),
            submittedScopeIds.length > 0
              ? notInArray(powerTestTasks.id, submittedScopeIds)
              : sql`true`
          )
        );

      if (submittedScopeIds.length > 0) {
        const staged = await tx
          .update(powerTestTasks)
          .set({ taskName: sql`${stagedNamePrefix} || ${powerTestTasks.id}::text` })
          .where(
            and(
              eq(powerTestTasks.equipmentKind, equipmentKind),
              // 🔴 갈래까지 본다 — 옆 갈래의 id 를 보내온 저장은 **거절**이어야 한다.
              // 안 걸면 그 줄이 남몰래 이 목록으로 옮겨 온다.
              eq(powerTestTasks.scope, scope),
              eq(powerTestTasks.isDeleted, false),
              inArray(powerTestTasks.id, submittedScopeIds)
            )
          )
          .returning({ id: powerTestTasks.id });
        // 위 작업 목록과 같은 이유로 **던진다**(SaveRejected 주석).
        if (staged.length !== submittedScopeIds.length) throw notFound();
      }

      for (const [index, task] of scopeList.entries()) {
        const displayOrder = index + 1;
        if (task.id) {
          const [updated] = await tx
            .update(powerTestTasks)
            .set({
              taskName: task.taskName,
              displayOrder,
              updatedAt: new Date(),
              updatedBy: params.actorUserId,
            })
            .where(
              and(
                eq(powerTestTasks.id, task.id),
                eq(powerTestTasks.equipmentKind, equipmentKind),
                eq(powerTestTasks.scope, scope),
                eq(powerTestTasks.isDeleted, false)
              )
            )
            .returning({ id: powerTestTasks.id });
          // 위 작업 목록의 같은 자리와 같은 뜻의 방어다.
          if (!updated) throw notFound();
          continue;
        }

        await tx.insert(powerTestTasks).values({
          equipmentKind,
          // 🔴 보내온 갈래를 그대로 쓴다. 예전에는 "POWER_TEST" 로 굳어 있었다 —
          // 화면이 통전 탭 하나만 보내던 때의 자리다(schema/repair-labor.ts 의
          // repair_labor_scope).
          scope,
          taskName: task.taskName,
          displayOrder,
          createdBy: params.actorUserId,
          updatedBy: params.actorUserId,
        });
      }
    }
    // 여기부터는 갈래 목록을 쓰지 않는다 — 색인 위반이 나도 갈래 이름을 붙이면 거짓말이 된다.
    writingScope = null;

    await insertAuditLog(tx, {
      actorUserId: params.actorUserId,
      actionType: "UPDATE",
      targetEntity: "repair_labor_settings",
      // 이 표는 장비 종류마다 한 줄이라 그 줄의 id 가 곧 대상이다. 아직 없던
      // 종류였다면 방금 만들어졌으므로 반드시 찾힌다.
      targetRecordId: await kindRowId(tx, equipmentKind),
      previousValue: previous,
      newValue: {
        equipmentKind,
        hourlyRate,
        // 🔴 이 저장은 base_cost 를 쓰지 않는다(파일 머리말). 그래서 바뀌기 전 값을
        // 그대로 싣는다 — 빼 버리면 감사만 보고는 "그때 그 칸이 비워졌나"를 알 수 없다.
        baseCost: previous.baseCost,
        investigationHours,
        powerTestHours,
        documentHours,
        taskCount: tasks.length,
        // 시간 합계를 함께 남긴다 — 나중에 "그때 작업비가 왜 그 값이었나"를
        // 물을 때 목록 전체를 복원하지 않고도 크기를 가늠할 수 있다.
        totalHours: tasks.reduce((sum, task) => sum + task.hours, 0),
        // 🔴 갈래 목록은 **건명을 그대로** 남긴다. 수리 목록처럼 건수와 시간
        // 합계로 가늠할 수가 없고(시간이 없다), 무엇보다 이 글이 앞으로 견적서
        // 문서에 적히는 내용이라 "누가 언제 무슨 문구로 바꿨나"에 답해야 한다.
        // 갈래마다 100줄 상한이 있어(validation/repair-task-input.ts) 감사 한 줄이
        // 감당 못할 크기가 되지 않는다.
        investigationTaskCount: scopeTasks.INVESTIGATION.length,
        investigationTaskNames: scopeTasks.INVESTIGATION.map((task) => task.taskName),
        powerTestTaskCount: scopeTasks.POWER_TEST.length,
        powerTestTaskNames: scopeTasks.POWER_TEST.map((task) => task.taskName),
        documentTaskCount: scopeTasks.DOCUMENT.length,
        documentTaskNames: scopeTasks.DOCUMENT.map((task) => task.taskName),
      },
    });

    // 🔴 `changedCount` 는 여전히 **수리 작업 건수**다. 화면이 이 숫자를 "작업 N건을
    // 저장했습니다"에 그대로 쓰므로, 통전 목록을 더해 버리면 수리 작업 탭의 문장이
    // 사람이 보고 있는 표의 줄 수와 어긋난다. 통전 탭의 문장은 자기 목록을 따로 센다.
    return { ok: true, changedCount: tasks.length };
  }).catch((err: unknown): SaveRepairLaborResult => {
    if (err instanceof SaveRejected) return err.result;
    /*
     * 건명 색인 위반은 **사실대로 말한다.**
     *
     * 예전에는 이 오류가 그대로 올라가 서버 액션의 마지막 catch 가 받았고, 사람은
     * "일시적으로 처리할 수 없습니다. 잠시 후 다시 시도해 주세요"를 들었다.
     * 일시적인 문제가 아니라서 사람은 되지 않는 일을 계속 다시 눌렀다.
     *
     * 색인 위반이 났다는 것은 트랜잭션이 이미 통째로 되돌아갔다는 뜻이기도 하다 —
     * 반쪽 저장이 남지 않는 것은 SaveRejected 갈래와 같다.
     *
     * 🔴 **다른 오류는 그대로 던진다.** 여기서 모든 예외를 삼키면 진짜 장애가
     * "이름이 겹칩니다"로 둔갑한다(nameConflictMessage 주석).
     */
    const message = nameConflictMessage(err, writingScope);
    if (message) return { ok: false, code: "NAME_CONFLICT", message };
    throw err;
  });
}

/** 감사의 previousValue 에 실을, 바꾸기 전 상태. */
async function readKind(tx: Tx, equipmentKind: RepairLaborFields["equipmentKind"]) {
  const [setting] = await tx
    .select({
      hourlyRate: repairLaborSettings.hourlyRate,
      baseCost: repairLaborSettings.baseCost,
      investigationHours: repairLaborSettings.investigationHours,
      powerTestHours: repairLaborSettings.powerTestHours,
      documentHours: repairLaborSettings.documentHours,
    })
    .from(repairLaborSettings)
    .where(eq(repairLaborSettings.equipmentKind, equipmentKind));

  const tasks = await tx
    .select({ hours: repairTaskCatalog.hours })
    .from(repairTaskCatalog)
    .where(
      and(
        eq(repairTaskCatalog.equipmentKind, equipmentKind),
        eq(repairTaskCatalog.isDeleted, false)
      )
    );

  // 바뀌기 전의 갈래 목록도 건명 그대로 남긴다 — newValue 와 짝이 맞아야
  // 감사 기록만 보고 "어느 줄의 문구가 어떻게 달라졌나"를 읽을 수 있다.
  // 🔴 여기서도 scope 로 갈라 읽는다. 안 가르면 세 목록이 한 덩어리로 섞여 남아
  // 나중에 "그때 통전 목록이 무엇이었나"에 답할 수 없다.
  const scopeRows = await tx
    .select({ scope: powerTestTasks.scope, taskName: powerTestTasks.taskName })
    .from(powerTestTasks)
    .where(
      and(eq(powerTestTasks.equipmentKind, equipmentKind), eq(powerTestTasks.isDeleted, false))
    )
    .orderBy(asc(powerTestTasks.displayOrder));
  const namesOf = (scope: RepairLaborScope) =>
    scopeRows.filter((row) => row.scope === scope).map((row) => row.taskName);
  const investigationNames = namesOf("INVESTIGATION");
  const powerTestNames = namesOf("POWER_TEST");
  const documentNames = namesOf("DOCUMENT");

  return {
    equipmentKind,
    hourlyRate: setting?.hourlyRate ?? null,
    baseCost: setting?.baseCost ?? null,
    investigationHours: setting?.investigationHours ?? null,
    powerTestHours: setting?.powerTestHours ?? null,
    documentHours: setting?.documentHours ?? null,
    taskCount: tasks.length,
    totalHours: tasks.reduce((sum, task) => sum + task.hours, 0),
    investigationTaskCount: investigationNames.length,
    investigationTaskNames: investigationNames,
    powerTestTaskCount: powerTestNames.length,
    powerTestTaskNames: powerTestNames,
    documentTaskCount: documentNames.length,
    documentTaskNames: documentNames,
  };
}

async function kindRowId(tx: Tx, equipmentKind: RepairLaborFields["equipmentKind"]): Promise<string> {
  const [row] = await tx
    .select({ id: repairLaborSettings.id })
    .from(repairLaborSettings)
    .where(eq(repairLaborSettings.equipmentKind, equipmentKind));
  return row.id;
}
