import "./load-env";

import { buildProceduresForSheets, planWorkbook } from "./lib/xlsx/technical-task-workbook";
import {
  planNextProcedureLinks,
  resolveNextProcedureLinks,
  summarizeNextProcedureLinks,
  type DbNodeFact,
  type DbTemplateFact,
  type NextProcedureLinkOutcome,
} from "./lib/xlsx/technical-task-next-procedure-plan";
import {
  checkDevelopmentWriteTarget,
  formatDatabaseTarget,
  formatWriteGuardBlockMessage,
} from "./lib/dev-database-write-guard";

/**
 * ============================================================================
 * 잇기 단계 — 다 만든 뒤 **이어가기만** 연결한다
 * ============================================================================
 * `import-technical-task-procedures.ts` 가 만들기 단계이고 이 스크립트가 그 짝이다.
 *
 * 🔴 **왜 따로인가** — 절차끼리 가리키는 관계가 **순환한다.** (8)이 (9)를 가리키고,
 * (9)는 (7)의 복제본이며 (7)이 다시 (8)을 가리킨다. 「가리켜지는 것부터 만든다」는
 * 차례가 **존재하지 않으므로**, 만들 때는 `next_procedure_template_id` 를 비워 두고
 * 전부 만든 뒤에 여기서 채운다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 🔴 **하나를 못 이어도 멈추지 않는다**
 * ──────────────────────────────────────────────────────────────────────
 * 하나 때문에 나머지가 다 막히면 안 된다. 못 이은 것은 **까닭과 함께 한 줄씩** 찍고
 * 넘어간다. 그리고 끝에 **이음 · 이미 이어짐 · 못 이음을 세어서** 찍는다 —
 * 「다 했다」와 「0건을 했다」는 화면에서 구별되어야 한다.
 *
 * 🔵 **여러 번 돌려도 같은 결과다.** 이미 같은 값이면 건드리지 않고, **다른** 값이
 * 들어 있으면 덮어쓰지 않는다(사람이 편집기에서 바꾼 값일 수 있다).
 *
 * ──────────────────────────────────────────────────────────────────────
 * 쓰는 법
 * ──────────────────────────────────────────────────────────────────────
 *   드라이런(기본): npx tsx scripts/link-technical-task-next-procedures.ts --file "<xlsx>"
 *   쓰기          : APPLY=1 node --conditions=react-server --import tsx \
 *                     scripts/link-technical-task-next-procedures.ts --file "<xlsx>"
 *
 * 🔵 `--sheet` 를 안 주면 **워크북의 만들 수 있는 시트 전부**를 훑는다. 만들기와 달리
 * 끊어 갈 이유가 없다 — 아직 없는 절차는 「DB 에 없습니다」로 건너뛰기 때문이다.
 */

const APPLY = process.env.APPLY === "1";

function parseArgs(): { file: string; sheetNames: string[] } {
  const args = process.argv.slice(2);
  const fileIndex = args.indexOf("--file");
  const file = fileIndex >= 0 ? args[fileIndex + 1] : undefined;
  if (!file) {
    console.error(
      'Usage: npx tsx scripts/link-technical-task-next-procedures.ts --file <xlsx> [--sheet "<시트 이름>" ...]'
    );
    process.exit(1);
  }
  const sheetNames: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--sheet" && args[i + 1]) sheetNames.push(args[i + 1]);
  }
  return { file, sheetNames };
}

function printOutcome(outcome: NextProcedureLinkOutcome): void {
  const mark = outcome.status === "LINK" ? "→" : outcome.status === "ALREADY_LINKED" ? "=" : "✗";
  console.log(
    `  ${mark} ${outcome.request.templateName} / ${outcome.request.nodeCode} "${outcome.request.nodeTitle}"`
  );
  console.log(`      ${outcome.reason}`);
}

async function main(): Promise<void> {
  const { file, sheetNames } = parseArgs();
  const workbookPlan = planWorkbook(file);

  // `--sheet` 가 없으면 **만들 수 있는 모든 시트**가 대상이다.
  const targetSheetNames =
    sheetNames.length > 0
      ? sheetNames
      : [...workbookPlan.plansBySheetName.keys()].filter((name) =>
          (workbookPlan.plansBySheetName.get(name) ?? []).some((p) => !p.excluded)
        );

  console.log("=".repeat(74));
  console.log("기술 작업 절차 — 이어가기 잇기 단계");
  console.log("=".repeat(74));
  console.log(`원본 파일 : ${workbookPlan.workbook.sourceFileName}`);
  console.log(`sha256    : ${workbookPlan.workbook.sourceFileHash}`);
  console.log(`대상 시트 : ${targetSheetNames.length}개`);
  console.log(`모드      : ${APPLY ? "APPLY (DB 에 쓴다)" : "DRY RUN (DB 를 한 글자도 안 바꾼다)"}`);

  const { built } = buildProceduresForSheets(workbookPlan, targetSheetNames);
  const requests = planNextProcedureLinks({
    built: built.map(({ plan, result }) => ({ plan, nodes: result.nodes })),
    stageIndex: workbookPlan.stageIndex,
  });

  console.log(`\n엑셀이 말하는 이어가기 ${requests.length}건`);
  if (requests.length === 0) {
    // 🔴 「0건」을 성공처럼 조용히 넘기지 않는다. 대상 시트에 참조 노드가 정말
    //    없는 것과, 시트를 잘못 골라 0건인 것은 화면에서 같아 보인다.
    console.log("  이번 대상 시트에는 다른 절차를 가리키는 노드가 하나도 없습니다 — 이을 것이 없습니다.");
    console.log(`  (훑은 시트: ${targetSheetNames.join(", ")})`);
    return;
  }

  // 🔴 1차 — 붙기 전에 가린다(dev-database-write-guard.ts). 드라이런도 DB 를 읽어야
  //    「이미 이어졌는가」를 알 수 있으므로, 읽기 전에도 같은 잣대로 본다.
  const preflight = checkDevelopmentWriteTarget({ databaseUrl: process.env.DATABASE_URL });
  if (!preflight.allowed) throw new Error(formatWriteGuardBlockMessage(preflight));

  // 🔴 **쓰기 모듈은 여기서 안 불러온다.** `procedure-template-editor` 는
  //    `server-only` 를 들여오므로 `--conditions=react-server` 없이 부르면 그 자리에서
  //    터진다. 드라이런은 **읽기만** 하므로 그 조건 없이 돌 수 있어야 한다 —
  //    안 그러면 「보기만 하려는데 왜 깃발이 필요하냐」가 되고, 사람은 그 깃발을
  //    APPLY 에도 그대로 들고 간다. 쓰기 모듈은 APPLY 갈래 안에서 처음 부른다.
  const { sql, and, eq, inArray } = await import("drizzle-orm");
  const { db, pgClient } = await import("../src/lib/db/connection");
  const { procedureTemplates, procedureTemplateNodes, users } = await import("../src/lib/db/schema");

  try {
    const identity = await db.execute(sql`select current_database() as name`);
    const actualDatabaseName = (identity[0] as { name?: string } | undefined)?.name ?? null;
    const confirmed = checkDevelopmentWriteTarget({
      databaseUrl: process.env.DATABASE_URL,
      actualDatabaseName,
    });
    if (!confirmed.allowed) throw new Error(formatWriteGuardBlockMessage(confirmed));
    console.log(`\n대상 DB: ${formatDatabaseTarget(confirmed.identity)} (${confirmed.reason})`);

    // 필요한 절차 이름 전부 — 이 노드가 든 절차와 가리킬 절차 양쪽이다.
    const wantedNames = [
      ...new Set(
        requests.flatMap((r) => [r.templateName, ...(r.targetTemplateName ? [r.targetTemplateName] : [])])
      ),
    ];
    const templateRows = await db
      .select({
        id: procedureTemplates.id,
        name: procedureTemplates.name,
        status: procedureTemplates.status,
        updatedAt: procedureTemplates.updatedAt,
      })
      .from(procedureTemplates)
      .where(
        and(
          eq(procedureTemplates.category, "TECHNICAL_TASK"),
          eq(procedureTemplates.isDeleted, false),
          inArray(procedureTemplates.name, wantedNames)
        )
      );

    // 🔴 같은 이름의 기술 절차가 둘 이상이면 **어느 쪽인지 못 가린다.** 하나를 골라
    //    잇지 않고 그 이름만 통째로 뺀다 — 그러면 아래 판정이 「DB 에 없습니다」로
    //    떨어지고, 까닭이 화면에 남는다.
    const nameCounts = new Map<string, number>();
    for (const row of templateRows) nameCounts.set(row.name, (nameCounts.get(row.name) ?? 0) + 1);
    const ambiguousNames = [...nameCounts].filter(([, n]) => n > 1).map(([name]) => name);
    for (const name of ambiguousNames) {
      console.log(`  🔴 같은 이름의 기술 절차가 ${nameCounts.get(name)}개입니다: "${name}" — 이 이름은 건너뜁니다.`);
    }
    const templatesByName = new Map<string, DbTemplateFact>(
      templateRows
        .filter((row) => !ambiguousNames.includes(row.name))
        .map((row) => [
          row.name,
          { id: row.id, name: row.name, status: row.status, updatedAt: row.updatedAt.toISOString() },
        ])
    );

    const templateIds = [...templatesByName.values()].map((t) => t.id);
    const nodeRows =
      templateIds.length === 0
        ? []
        : await db
            .select({
              id: procedureTemplateNodes.id,
              procedureTemplateId: procedureTemplateNodes.procedureTemplateId,
              nodeCode: procedureTemplateNodes.nodeCode,
              nodeType: procedureTemplateNodes.nodeType,
              nextProcedureTemplateId: procedureTemplateNodes.nextProcedureTemplateId,
            })
            .from(procedureTemplateNodes)
            .where(inArray(procedureTemplateNodes.procedureTemplateId, templateIds));
    const nodesByTemplateId = new Map<string, DbNodeFact[]>();
    for (const row of nodeRows) {
      const list = nodesByTemplateId.get(row.procedureTemplateId) ?? [];
      list.push({
        id: row.id,
        nodeCode: row.nodeCode,
        nodeType: row.nodeType,
        nextProcedureTemplateId: row.nextProcedureTemplateId,
      });
      nodesByTemplateId.set(row.procedureTemplateId, list);
    }

    const outcomes = resolveNextProcedureLinks({ requests, templatesByName, nodesByTemplateId });
    console.log(`\n${"=".repeat(74)}`);
    console.log("판정");
    console.log("=".repeat(74));
    for (const outcome of outcomes) printOutcome(outcome);

    const planned = summarizeNextProcedureLinks(outcomes);
    console.log(
      `\n계획: 전체 ${planned.total}건 — 이을 것 ${planned.toLink} · 이미 이어짐 ${planned.alreadyLinked} · 못 이음 ${planned.skipped}`
    );

    if (!APPLY) {
      console.log("\n드라이런입니다 — DB 에 아무것도 쓰지 않았습니다.");
      return;
    }

    const { updateProcedureTemplateNode } = await import(
      "../src/lib/db/mutations/procedure-template-editor"
    );

    const [actor] = await db
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          eq(users.role, "SUPER_ADMIN"),
          eq(users.approvalStatus, "APPROVED"),
          eq(users.isActive, true),
          eq(users.isDeleted, false)
        )
      )
      .limit(1);
    if (!actor) throw new Error("승인된 활성 SUPER_ADMIN 계정이 없어 이을 수 없습니다.");

    let linked = 0;
    let failed = 0;
    for (const outcome of outcomes) {
      if (outcome.status !== "LINK" || !outcome.action) continue;
      /**
       * 🔴 `updatedAt` 을 **한 건마다 다시 읽는다.** 노드를 한 번 고치면 그 절차의
       * `updated_at` 이 바뀌고, 같은 절차의 두 번째 노드는 낡은 값을 들고 가서
       * 「다른 사용자가 수정했습니다」로 막힌다. 계획 단계에서 한 번 읽은 값으로
       * 전부 돌리면 **첫 건만 성공하고 나머지가 조용히 실패한다.**
       */
      const [fresh] = await db
        .select({ updatedAt: procedureTemplates.updatedAt })
        .from(procedureTemplates)
        .where(eq(procedureTemplates.id, outcome.action.templateId))
        .limit(1);
      if (!fresh) {
        failed += 1;
        console.log(`  ✗ ${outcome.request.nodeCode}: 절차를 다시 찾지 못했습니다.`);
        continue;
      }

      const result = await updateProcedureTemplateNode(
        outcome.action.nodeId,
        actor.id,
        { nextProcedureTemplateId: outcome.action.targetTemplateId },
        fresh.updatedAt.toISOString(),
        `엑셀 흐름도의 (${outcome.request.stageNumber})번 참조를 이어 붙임`
      );
      if (result.ok) {
        linked += 1;
        console.log(`  → 이었습니다: ${outcome.request.templateName} / ${outcome.request.nodeCode}`);
      } else {
        // 🔴 하나가 실패해도 멈추지 않는다 — 나머지가 다 막히면 안 된다.
        failed += 1;
        console.log(`  ✗ ${outcome.request.nodeCode}: [${result.code}] ${result.message}`);
      }
    }

    console.log(`\n${"=".repeat(74)}`);
    console.log(
      `결과: 이었음 ${linked} · 이미 이어져 있었음 ${planned.alreadyLinked} · ` +
        `못 이음 ${planned.skipped + failed} (계획에서 ${planned.skipped} · 쓰다가 ${failed})`
    );
    console.log("=".repeat(74));
    if (failed > 0) process.exitCode = 1;
  } finally {
    await pgClient.end({ timeout: 5 });
  }
}

main().catch((error) => {
  console.error("실패:", error instanceof Error ? (error.stack ?? error.message) : String(error));
  process.exit(1);
});
