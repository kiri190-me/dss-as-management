import "./load-env";

import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { and, asc, eq, inArray, like, or } from "drizzle-orm";

import { db, pgClient } from "../src/lib/db/connection";
import {
  procedureTemplateEdges,
  procedureTemplateNodes,
  procedureTemplateValidationIssues,
  procedureTemplates,
} from "../src/lib/db/schema";
import { describeDatabaseTarget, formatDatabaseTarget } from "./lib/dev-database-write-guard";
import {
  PROCEDURE_BUNDLE_FORMAT,
  PROCEDURE_BUNDLE_FORMAT_VERSION,
  checkBundleInternalConsistency,
  formatBundleBlockers,
  type BundleEdge,
  type BundleIssue,
  type BundleNode,
  type BundleTemplate,
  type ProcedureBundle,
} from "./lib/procedure-template-bundle";

/**
 * ============================================================================
 * 절차를 **떠서 파일 하나로** 만든다 (개발 DB → JSON)
 * ============================================================================
 *
 *   npm run procedures:export
 *   npm run procedures:export -- --out "D:/어딘가/bundle.json"
 *
 * 🔵 **읽기만 한다.** `INSERT`·`UPDATE`·`DELETE` 가 한 줄도 없고 `--apply` 같은
 * 깃발도 **일부러** 두지 않았다 — 뜨는 도구에 쓰는 길을 내 두면 언젠가 누가 그 길을
 * 넓힌다(`check-requested-due-date-sync.ts` 와 같은 규율).
 *
 * 넣는 쪽은 짝이 되는 `import-procedure-bundle.ts` 다. 왜 이렇게 둘로 나눴는지는
 * `lib/procedure-template-bundle.ts` 머리말에 있다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 🔴 뜬 파일은 **저장소 밖**에 둔다
 * ──────────────────────────────────────────────────────────────────────
 * 기본 자리는 OS 임시 폴더(`%TEMP%`)다. 저장소 안을 가리키면 **거절한다** — 고객
 * 정보가 아니라 절차 내용뿐이지만, 자료 파일이 커밋에 섞여 들어가는 일은
 * 되돌리기가 어렵다(공개 저장소로 밀려가면 더하다).
 *
 * ──────────────────────────────────────────────────────────────────────
 * 🔴 **고르는 잣대**와, 고르지 **않은** 것까지 함께 찍는다
 * ──────────────────────────────────────────────────────────────────────
 * 기본 잣대는 셋이다 — 분류가 `TECHNICAL_TASK` · 안 지워짐 · 이름이 `[RFG]` 나
 * `[MB]` 로 시작. 🔵 그런데 **고른 수만 찍으면 빠뜨린 것이 안 보인다.** 그래서 같은
 * 분류인데 잣대에 안 걸린 줄을 **이름까지 적어** 함께 찍는다. 스물다섯이 아닌 수가
 * 나오는 날, 그 목록이 까닭을 바로 말해 준다.
 */

const DEFAULT_NAME_PREFIXES = ["[RFG]", "[MB]"] as const;

/**
 * 🔴 **`--prefix` 로 한 갈래만 뜰 수 있다** (2026-11-06).
 *
 * 까닭: 넣는 쪽은 `--actor` 를 **하나만** 받고, 그 한 사람이 짐 전체의 「만든 사람」이
 * 된다. 그런데 사용자가 **RFG 는 정영빈 · MB 는 이남준**으로 적기로 했다(2026-11-06).
 *
 * 🔵 **넣는 쪽을 고치지 않는 쪽을 골랐다.** 그 도구는 이미 운영 이미지
 * (`dss-as-tools:12`)에 구워져 있어서, 고치면 이미지를 다시 굽고 배포를 또 해야 한다.
 * 뜨는 쪽은 **개발 PC 에서만** 도니 고쳐도 배포가 필요 없다 — 짐을 둘로 떠서
 * 넣는 쪽을 **두 번** 부르면 같은 결과가 된다.
 *
 * 🔴 **쪼개도 안전한 까닭은 재서 알았다**: 절차끼리의 이어가기 12건이 **전부
 * `RFG → RFG`** 다(2026-11-06 실측). RFG 와 MB 를 가로지르는 연결이 하나도 없어서,
 * 갈라 담아도 넣는 쪽의 「짐 밖을 가리킨다」(INTERNAL_INCONSISTENT) 검사에 안 걸린다.
 * 🔴 **가로지르는 연결이 생기는 날 이 전제가 깨진다** — 그때는 쪼개면 안 되고,
 * 넣는 쪽이 작성자를 여럿 받도록 고쳐야 한다.
 */
function parseArgs(): { out: string; prefixes: readonly string[] } {
  const args = process.argv.slice(2);
  const prefixIndex = args.indexOf("--prefix");
  if (prefixIndex >= 0 && !args[prefixIndex + 1]) {
    console.error("--prefix 뒤에 이름 앞가지를 적어 주세요 (예: \"[RFG]\").");
    process.exit(1);
  }
  const wanted = prefixIndex >= 0 ? args[prefixIndex + 1] : null;
  if (wanted !== null && !DEFAULT_NAME_PREFIXES.includes(wanted as (typeof DEFAULT_NAME_PREFIXES)[number])) {
    // 🔴 아무 글자나 받지 않는다 — 오타 하나로 **0개짜리 짐**이 조용히 떠지면
    //    그것을 넣어도 「만듦 0」으로 끝나고 아무도 왜인지 모른다.
    console.error(`🔴 모르는 앞가지: ${wanted}`);
    console.error(`   고를 수 있는 것: ${DEFAULT_NAME_PREFIXES.join(" · ")}`);
    process.exit(1);
  }
  const prefixes = wanted === null ? DEFAULT_NAME_PREFIXES : [wanted];
  const outIndex = args.indexOf("--out");
  if (outIndex >= 0 && !args[outIndex + 1]) {
    console.error("--out 뒤에 파일 경로를 적어 주세요.");
    process.exit(1);
  }
  const stamp = new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\..*$/, "")
    .replace("T", "-");
  const out =
    outIndex >= 0
      ? path.resolve(args[outIndex + 1])
      : path.join(tmpdir(), `dss-as-procedure-bundle-${stamp}.json`);
  return { out, prefixes };
}

/**
 * 🔴 저장소 안을 가리키면 거절한다(위 머리말). `path.relative` 가 `..` 로 시작하지
 * **않고** 절대경로도 아니면 저장소 안이다 — 윈도우에서 드라이브가 다르면
 * `path.relative` 가 절대경로를 돌려준다는 성질을 함께 쓴다.
 */
function assertOutsideRepository(outPath: string): void {
  const repositoryRoot = process.cwd();
  const relative = path.relative(repositoryRoot, outPath);
  if (relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative)) {
    console.error(
      [
        "🔴 뜬 파일을 저장소 안에 두지 않습니다.",
        `   받은 곳 : ${outPath}`,
        `   저장소  : ${repositoryRoot}`,
        "   --out 으로 저장소 밖(예: %TEMP%)을 적어 주세요.",
      ].join("\n")
    );
    process.exit(1);
  }
}

async function main(): Promise<void> {
  const { out, prefixes } = parseArgs();
  assertOutsideRepository(out);

  const target = describeDatabaseTarget(process.env.DATABASE_URL);
  console.log("=".repeat(74));
  console.log("절차를 떠서 파일 하나로 (읽기 전용)");
  console.log("=".repeat(74));
  console.log(`읽는 DB : ${formatDatabaseTarget(target)}   (비밀번호는 안 찍습니다)`);
  console.log(`쓸 파일 : ${out}`);

  try {
    const nameFilter = or(...prefixes.map((prefix) => like(procedureTemplates.name, `${prefix}%`)));

    /**
     * 🔴 **차례를 못 박는다.** 두 번 떠서 맞대어 볼 수 있어야 하고(사람이 diff 로
     * 본다), 차례가 흔들리면 같은 내용인데 파일이 달라 보인다.
     */
    const templateRows = await db
      .select()
      .from(procedureTemplates)
      .where(
        and(
          eq(procedureTemplates.category, "TECHNICAL_TASK"),
          eq(procedureTemplates.isDeleted, false),
          nameFilter
        )
      )
      .orderBy(asc(procedureTemplates.name), asc(procedureTemplates.code));

    // 🔵 같은 분류인데 **안 걸린** 줄 — 빠뜨린 것이 보이게 이름까지 찍는다.
    const otherTechnicalTasks = await db
      .select({
        id: procedureTemplates.id,
        name: procedureTemplates.name,
        code: procedureTemplates.code,
        status: procedureTemplates.status,
        isDeleted: procedureTemplates.isDeleted,
      })
      .from(procedureTemplates)
      .where(eq(procedureTemplates.category, "TECHNICAL_TASK"))
      .orderBy(asc(procedureTemplates.name));
    const selectedIds = new Set(templateRows.map((row) => row.id));
    const skipped = otherTechnicalTasks.filter((row) => !selectedIds.has(row.id));

    console.log(`\n고른 절차 : ${templateRows.length}개`);
    for (const row of templateRows) {
      console.log(`   ${row.code}  ${row.status.padEnd(9)} ${row.name}`);
    }
    console.log(`\n같은 분류인데 안 고른 것 : ${skipped.length}개`);
    for (const row of skipped) {
      console.log(
        `   ${row.code}  ${row.status.padEnd(9)}${row.isDeleted ? " 🔴휴지통" : "        "} ${row.name}`
      );
    }

    if (templateRows.length === 0) {
      console.error("\n🔴 뜰 절차가 한 개도 없습니다 — 빈 파일을 만들지 않고 멈춥니다.");
      process.exitCode = 1;
      return;
    }

    /**
     * 🔴 **싣지 않기로 한 칸이 정말 비어 있는지 여기서 잰다.** 사용자 칸 셋과 그
     * 짝이 되는 날짜 칸은 짐에 아예 없는데(짐 타입에 없다), 원본에 값이 들어 있다면
     * 그 줄은 **단순한 초안이 아니다** — 말없이 떨어뜨리면 「누가 게시했는지는
     * 사라지고 게시한 날짜만 남은」 줄을 운영에 만든다. 그래서 **멈춘다.**
     */
    const notPlainDraft = templateRows.filter(
      (row) =>
        row.status !== "DRAFT" ||
        row.publishedByUserId !== null ||
        row.archivedByUserId !== null ||
        row.deletedBy !== null ||
        row.publishedAt !== null ||
        row.archivedAt !== null ||
        row.deletedAt !== null ||
        row.deleteReason !== null
    );
    if (notPlainDraft.length > 0) {
      console.error(`\n🔴 평범한 초안이 아닌 줄이 ${notPlainDraft.length}개 섞여 있습니다 — 뜨지 않고 멈춥니다.`);
      for (const row of notPlainDraft) {
        console.error(
          `   "${row.name}" status=${row.status} published=${row.publishedAt ? "있음" : "없음"} ` +
            `archived=${row.archivedAt ? "있음" : "없음"} deleted=${row.deletedAt ? "있음" : "없음"}`
        );
      }
      process.exitCode = 1;
      return;
    }

    const templateIds = templateRows.map((row) => row.id);

    const nodeRows = await db
      .select()
      .from(procedureTemplateNodes)
      .where(inArray(procedureTemplateNodes.procedureTemplateId, templateIds))
      .orderBy(asc(procedureTemplateNodes.procedureTemplateId), asc(procedureTemplateNodes.nodeCode));

    const edgeRows = await db
      .select()
      .from(procedureTemplateEdges)
      .where(inArray(procedureTemplateEdges.procedureTemplateId, templateIds))
      .orderBy(asc(procedureTemplateEdges.procedureTemplateId), asc(procedureTemplateEdges.id));

    const issueRows = await db
      .select()
      .from(procedureTemplateValidationIssues)
      .where(inArray(procedureTemplateValidationIssues.procedureTemplateId, templateIds))
      .orderBy(
        asc(procedureTemplateValidationIssues.procedureTemplateId),
        asc(procedureTemplateValidationIssues.id)
      );

    // 🔴 메모의 사용자 칸도 같은 잣대다 — 누가 풀었는지가 적힌 줄은 안 나른다.
    const resolvedIssues = issueRows.filter((row) => row.resolvedByUserId !== null || row.resolvedAt !== null);
    if (resolvedIssues.length > 0) {
      console.error(
        `\n🔴 이미 처리된 검증 메모가 ${resolvedIssues.length}건 있습니다 — 누가 처리했는지를 옮길 길이 없어 멈춥니다.`
      );
      for (const row of resolvedIssues.slice(0, 10)) {
        console.error(`   ${row.issueType} / ${row.resolutionStatus} — ${row.message.slice(0, 60)}`);
      }
      process.exitCode = 1;
      return;
    }

    const templates: BundleTemplate[] = templateRows.map((row) => ({
      id: row.id,
      code: row.code,
      name: row.name,
      equipmentType: row.equipmentType,
      category: row.category,
      description: row.description,
      status: "DRAFT",
      isReferenceOnly: row.isReferenceOnly,
      version: row.version,
      sourceType: row.sourceType,
      sourceFileName: row.sourceFileName,
      sourceFileHash: row.sourceFileHash,
      supersedesTemplateId: row.supersedesTemplateId,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }));

    const nodes: BundleNode[] = nodeRows.map((row) => ({
      id: row.id,
      procedureTemplateId: row.procedureTemplateId,
      nodeCode: row.nodeCode,
      nodeType: row.nodeType,
      title: row.title,
      description: row.description,
      objective: row.objective,
      preparation: row.preparation,
      toolsAndEquipment: row.toolsAndEquipment,
      safetyCaution: row.safetyCaution,
      instructions: row.instructions,
      expectedNormalResult: row.expectedNormalResult,
      ngSymptoms: row.ngSymptoms,
      recommendedCorrectiveAction: row.recommendedCorrectiveAction,
      acceptanceCriteria: row.acceptanceCriteria,
      workerMayAddNextTask: row.workerMayAddNextTask,
      nextProcedureTemplateId: row.nextProcedureTemplateId,
      positionX: row.positionX,
      positionY: row.positionY,
      userPositionX: row.userPositionX,
      userPositionY: row.userPositionY,
      sortOrder: row.sortOrder,
      sourceWorksheet: row.sourceWorksheet,
      sourceShapeId: row.sourceShapeId,
      sourceCellRange: row.sourceCellRange,
      isActive: row.isActive,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }));

    const edges: BundleEdge[] = edgeRows.map((row) => ({
      id: row.id,
      procedureTemplateId: row.procedureTemplateId,
      fromNodeId: row.fromNodeId,
      toNodeId: row.toNodeId,
      branchType: row.branchType,
      branchLabel: row.branchLabel,
      conditionDefinition: row.conditionDefinition ?? null,
      sortOrder: row.sortOrder,
      sourceConnectorId: row.sourceConnectorId,
      clonedFromEdgeId: row.clonedFromEdgeId,
      userRoutePoints: row.userRoutePoints ?? null,
    }));

    const issues: BundleIssue[] = issueRows.map((row) => ({
      id: row.id,
      procedureTemplateId: row.procedureTemplateId,
      severity: row.severity,
      issueType: row.issueType,
      message: row.message,
      sourceWorksheet: row.sourceWorksheet,
      sourceReference: row.sourceReference,
      rawEvidence: row.rawEvidence ?? null,
      resolutionStatus: row.resolutionStatus,
      createdAt: row.createdAt.toISOString(),
    }));

    const bundle: ProcedureBundle = {
      format: PROCEDURE_BUNDLE_FORMAT,
      formatVersion: PROCEDURE_BUNDLE_FORMAT_VERSION,
      exportedAt: new Date().toISOString(),
      // 🔴 호스트:포트/DB이름 까지다 — 비밀번호도 사용자명도 파일에 안 들어간다.
      exportedFrom: formatDatabaseTarget(target),
      selection: `category=TECHNICAL_TASK · is_deleted=false · name LIKE ${prefixes.map((p) => `"${p}%"`).join(" 또는 ")}`,
      counts: {
        templates: templates.length,
        nodes: nodes.length,
        edges: edges.length,
        issues: issues.length,
      },
      templates,
      nodes,
      edges,
      issues,
    };

    /**
     * 🔴 **쓰기 전에 스스로 검사한다.** 넣는 쪽이 같은 함수로 다시 보지만, 여기서
     * 걸리는 것은 뜨는 쪽의 결함이라 **이 자리에서** 알아야 고칠 사람이 안다.
     * (넣는 쪽은 운영에서 돌고, 거기서 처음 보면 이미 늦다.)
     */
    const blockers = checkBundleInternalConsistency(bundle);
    if (blockers.length > 0) {
      console.error(`\n${formatBundleBlockers(blockers)}`);
      console.error("🔴 파일을 만들지 않았습니다.");
      process.exitCode = 1;
      return;
    }

    mkdirSync(path.dirname(out), { recursive: true });
    writeFileSync(out, `${JSON.stringify(bundle, null, 2)}\n`, "utf8");

    const nextLinks = nodes.filter((node) => node.nextProcedureTemplateId !== null);
    const supersedes = templates.filter((template) => template.supersedesTemplateId !== null);
    const clonedFrom = edges.filter((edge) => edge.clonedFromEdgeId !== null);

    console.log(`\n${"=".repeat(74)}`);
    console.log(`결과: 절차 ${templates.length} · 노드 ${nodes.length} · 분기 ${edges.length} · 메모 ${issues.length}`);
    console.log(
      `      이어가기 ${nextLinks.length} · 상위판 ${supersedes.length} · 복제원본 ${clonedFrom.length} ` +
        "(넣을 때 전부 **나중에** 채웁니다)"
    );
    console.log(`파일: ${out}`);
    console.log("✅ 끝났습니다 — DB 는 한 글자도 안 바꿨습니다.");
    console.log("=".repeat(74));
  } finally {
    await pgClient.end({ timeout: 5 });
  }
}

main().catch((error) => {
  console.error("실패:", error instanceof Error ? (error.stack ?? error.message) : String(error));
  process.exit(1);
});
