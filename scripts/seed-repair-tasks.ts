/**
 * ============================================================================
 * 수리 작업 목록 · 시간당 단가 · 기본 작업비 넣기
 * ============================================================================
 * 사용자가 준 표 두 장을 그대로 옮긴다(2026-08-31).
 *   · 제너레이터 20건 — 「FH 작업비」
 *   · 매쳐 16건 — 「수리 작업 목록 (단독 수리 진행 시)」
 *
 * ── 여러 번 돌려도 안전하다 ─────────────────────────────────────────────
 * 이미 있는 건명은 **건드리지 않는다.** 사람이 화면에서 시간을 고쳐 둔 것을
 * 시드가 되돌려 놓으면, 고친 사람은 자기 변경이 사라진 이유를 알 수 없다.
 * 없는 것만 더한다.
 *
 * ── 건명에서 시간을 뗀다 ────────────────────────────────────────────────
 * 매쳐 표는 `바리콘 교환 작업(8h)` 처럼 이름 안에 시간이 적혀 있다. 그대로 두면
 * 같은 값이 이름과 hours 두 곳에 살고, 시간을 고치는 날 이름이 거짓말을 한다.
 * 이름에서 떼고 hours 로만 둔다.
 *
 * 돌리는 법:  node --conditions=react-server --import tsx scripts/seed-repair-tasks.ts
 * ============================================================================
 */
import "./load-env";

import { and, eq, inArray } from "drizzle-orm";
import { db, pgClient } from "../src/lib/db/connection";
import { repairLaborSettings, repairTaskCatalog, users } from "../src/lib/db/schema";

/** 시간당 작업비. 세 장비 종류 모두 같다(2026-08-31). */
const HOURLY_RATE = "100000";

/**
 * 오버홀 작업의 건명. 견적서 종류를 O/H 로 고르면 자동으로 체크되는 줄이다.
 *
 * 🔴 **표시는 자료로 둔다.** 코드가 이름을 뒤져 맞히게 하면 이름이 바뀌는 날
 * 조용히 아무것도 못 찾고, 그러면 O/H 견적서에서 오버홀 작업비가 빠진 채 나간다.
 * 여기서 한 번 표시해 두고, 그 뒤로는 화면의 `O/H` 칸으로 사람이 고친다.
 */
const OVERHAUL_TASK_NAMES = new Set(["OH", "O/H(스위칭전원,휴즈 교환) 작업"]);

/** 제너레이터 —「FH 작업비」표 순서 그대로. */
const GENERATOR_TASKS: [name: string, hours: number][] = [
  ["종단 Amp 교환 작업(열)", 6],
  ["HB2 기판 교환 작업", 8],
  ["S-cont 교환 작업", 7],
  ["CHOPPER IGBT 교환 작업", 3],
  ["정류 다이오드 교환 작업", 3],
  ["FH-SEQ 교환 작업", 4],
  ["3상 휴즈 교환 작업", 1],
  ["VSWR 교환 작업(필터박스)", 6],
  ["톱터치 교환 작업", 7],
  ["유량계 교환 작업(30kW、20kW)", 7],
  ["중단 AMP 교환 작업", 3],
  ["스플릿터 교환 작업", 3],
  ["MCU 기판 교환 작업", 12],
  ["FH-CONT 교환 작업 (MCB 판금 포함)", 7],
  ["스위칭 전원 교환 작업", 1],
  ["필터박스VFC교환", 4],
  ["D-NET、CAN 케이블 교환", 4],
  ["FAN 교환", 2],
  ["2SPL(TC) 교환", 4],
  // 오버홀도 목록의 한 줄이다 — 따로 사는 값이 아니다(2026-08-31 사용자 정정).
  ["OH", 24],
];

/** 매쳐 —「수리 작업 목록 (단독 수리 진행 시)」표 순서 그대로. */
const MATCHER_TASKS: [name: string, hours: number][] = [
  ["바리콘 교환 작업", 8],
  ["O/H(스위칭전원,휴즈 교환) 작업", 4],
  ["호스 교환 작업", 8],
  ["톱터치 교환 작업", 2],
  ["VIP유닛 교환 작업", 8],
  ["RPI 재조정 작업", 2],
  ["유량계 교환 작업", 2],
  ["FAN 교환 작업", 2],
  ["출력바 교환 작업", 6],
  ["누수 검지기 교환 작업", 8],
  ["코일 교환 작업", 4],
  ["판금 교환 작업", 4],
  ["고정 콘덴서 교환 작업", 2],
  ["ROM Writing 작업", 1],
  ["MCU 기판 교환 작업", 8],
  ["VPP_VDC 기판 교환 작업", 6],
];

/**
 * 기본 작업비(2026-08-31 사용자 제시).
 *
 * **350만원이 기본이고 T/C 만 예외로 220만원**이다 — 제너레이터와 매쳐가 같은
 * 값이라 "기본 작업비가 350만원"이라는 말이 곧 그 둘을 가리킨다.
 *
 * T/C 는 작업 목록을 아직 받지 못했지만 기본 작업비는 정해져 있다. 목록이 비어
 * 있어도 이 줄을 만들어 두는 이유는, 화면에 자리가 있어야 사람이 거기 채워 넣을
 * 수 있기 때문이다.
 */
const BASE_COSTS: Record<"GENERATOR" | "MATCHER" | "TOTAL_CONTROLLER", string | null> = {
  GENERATOR: "3500000",
  MATCHER: "3500000",
  TOTAL_CONTROLLER: "2200000",
};

async function main() {
  const [actor] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.role, "SUPER_ADMIN"), eq(users.approvalStatus, "APPROVED")))
    .limit(1);
  if (!actor) throw new Error("승인된 SUPER_ADMIN 계정을 찾지 못했습니다.");

  for (const [kind, tasks] of [
    ["GENERATOR", GENERATOR_TASKS],
    ["MATCHER", MATCHER_TASKS],
  ] as const) {
    const existing = await db
      .select({ taskName: repairTaskCatalog.taskName })
      .from(repairTaskCatalog)
      .where(
        and(
          eq(repairTaskCatalog.equipmentKind, kind),
          eq(repairTaskCatalog.isDeleted, false),
          inArray(
            repairTaskCatalog.taskName,
            tasks.map(([name]) => name)
          )
        )
      );
    const have = new Set(existing.map((row) => row.taskName));

    const toInsert = tasks
      .map(([taskName, hours], index) => ({ taskName, hours, displayOrder: index + 1 }))
      .filter((row) => !have.has(row.taskName));

    if (toInsert.length > 0) {
      await db.insert(repairTaskCatalog).values(
        toInsert.map((row) => ({
          equipmentKind: kind,
          taskName: row.taskName,
          hours: row.hours,
          displayOrder: row.displayOrder,
          isOverhaul: OVERHAUL_TASK_NAMES.has(row.taskName),
          createdBy: actor.id,
          updatedBy: actor.id,
        }))
      );
    }
    console.log(`${kind}: 표 ${tasks.length}건 중 ${toInsert.length}건 새로 넣음 (이미 있던 ${have.size}건은 그대로).`);

    // 이 시드를 돌리기 전에 이미 들어간 줄에도 표시를 붙인다. **오버홀 줄만
    // 켠다** — 끄는 쪽은 건드리지 않는다. 화면에서 사람이 다른 줄을 오버홀로
    // 표시해 두었을 수 있고, 시드가 그것을 되돌리면 안 된다.
    const marked = await db
      .update(repairTaskCatalog)
      .set({ isOverhaul: true })
      .where(
        and(
          eq(repairTaskCatalog.equipmentKind, kind),
          eq(repairTaskCatalog.isDeleted, false),
          eq(repairTaskCatalog.isOverhaul, false),
          inArray(repairTaskCatalog.taskName, [...OVERHAUL_TASK_NAMES])
        )
      )
      .returning({ taskName: repairTaskCatalog.taskName });
    if (marked.length > 0) {
      console.log(`${kind}: 오버홀 표시를 붙임 — ${marked.map((r) => r.taskName).join(", ")}`);
    }
  }

  for (const kind of ["GENERATOR", "MATCHER", "TOTAL_CONTROLLER"] as const) {
    const [row] = await db
      .select({ id: repairLaborSettings.id, baseCost: repairLaborSettings.baseCost })
      .from(repairLaborSettings)
      .where(eq(repairLaborSettings.equipmentKind, kind));

    if (row) {
      /**
       * 🔴 **비어 있는 칸만 채운다. 적혀 있는 값은 절대 덮지 않는다.**
       *
       * "정하지 않음(NULL)"을 채우는 것은 사람이 정해 둔 것을 되돌리는 일이
       * 아니다 — 몰라서 비어 있던 자리에 이제 답이 생긴 것뿐이다. 반대로 값이
       * 이미 있는데 시드가 덮으면, 화면에서 고쳐 둔 사람은 자기 변경이 왜
       * 사라졌는지 알 수 없다. 시간당 단가도 같은 이유로 손대지 않는다.
       */
      if (row.baseCost === null && BASE_COSTS[kind] !== null) {
        await db
          .update(repairLaborSettings)
          .set({ baseCost: BASE_COSTS[kind], updatedBy: actor.id, updatedAt: new Date() })
          .where(eq(repairLaborSettings.id, row.id));
        console.log(`${kind}: 비어 있던 기본 작업비를 ${BASE_COSTS[kind]} 로 채움.`);
      } else {
        console.log(`${kind}: 단가 설정이 이미 있어 건드리지 않음.`);
      }
      continue;
    }
    await db.insert(repairLaborSettings).values({
      equipmentKind: kind,
      hourlyRate: HOURLY_RATE,
      baseCost: BASE_COSTS[kind],
      updatedBy: actor.id,
    });
    console.log(
      `${kind}: 시간당 ${HOURLY_RATE}원 · 기본 작업비 ${BASE_COSTS[kind] ?? "(정하지 않음)"} 넣음.`
    );
  }
}

main()
  .then(() => pgClient.end())
  .catch(async (err) => {
    console.error("실패:", err);
    await pgClient.end();
    process.exit(1);
  });
