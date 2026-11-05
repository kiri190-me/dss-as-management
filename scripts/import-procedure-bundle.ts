import "./load-env";

import { readFileSync } from "node:fs";

import { and, eq, inArray, isNotNull, or } from "drizzle-orm";

import { db, pgClient } from "../src/lib/db/connection";
import {
  procedureTemplateEdges,
  procedureTemplateNodes,
  procedureTemplateValidationIssues,
  procedureTemplates,
  users,
} from "../src/lib/db/schema";
import { describeDatabaseTarget, formatDatabaseTarget } from "./lib/dev-database-write-guard";
import {
  formatBundleApplySummary,
  formatBundleBlockers,
  parseProcedureBundle,
  planProcedureBundleInsert,
  type BundleApplySummary,
  type ExistingInTarget,
  type ProcedureBundle,
} from "./lib/procedure-template-bundle";

/**
 * ============================================================================
 * 떠 온 파일을 **넣는다** (JSON → DB) — 🔴 **운영에서 도는 쪽**
 * ============================================================================
 * 짝이 되는 뜨는 쪽은 `export-procedure-bundle.ts` 다. 왜 둘로 나눴고 무엇을
 * 싣지 않는지는 `lib/procedure-template-bundle.ts` 머리말에 있다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 🔴 여기엔 「개발 DB 에서만」 자물쇠가 **없다** — 일부러다
 * ──────────────────────────────────────────────────────────────────────
 * 들여오기(`import-technical-task-procedures.ts`)에는
 * `dev-database-write-guard.ts` 가 달려 있다. **이 도구는 운영에서 도는 것이
 * 목적**이라 같은 자물쇠를 달면 쓸 수가 없다. 대신 **다른 안전장치**를 건다:
 *
 *   ① 넣기 전에 **전부 세어 보고**, 하나라도 걸리면 **한 글자도 안 쓰고** 멈춘다.
 *      (id 충돌 · code 충돌 · 이름 충돌 · DRAFT 아님 · 작성자 못 찾음 · 짐이 깨짐)
 *   ② **기본은 드라이런**이다. `APPLY=1` 일 때만 쓴다.
 *   ③ 쓰기는 **한 트랜잭션** 안에서 한다 — 중간에 죽으면 통째로 되돌아간다.
 *   ④ 끝에 **결과 한 줄**을 찍고, 실패면 **0 아닌 종료 코드**로 나간다.
 *
 * 🔵 대신 **어느 DB 에 넣는지를 맨 위에 찍는다**(호스트:포트/DB 이름, 비밀번호는
 * 안 찍는다). 자물쇠로 못 막는 자리에서는 사람이 보고 가릴 수 있어야 한다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 돌리는 법
 * ──────────────────────────────────────────────────────────────────────
 * 개발에서(드라이런으로 연습):
 *   npm run procedures:import -- --file "<bundle.json>" --actor <uuid>
 *
 * 🔵 **운영에서는 NAS 의 도구 컨테이너(`tools-as`)가 이 자리를 맡는다.** 운영
 * 이미지에는 tsx 가 없고(devDependency), 도구 이미지(`Dockerfile` 의 `tools`
 * 스테이지)가 `scripts/` 와 `src/` 와 `vendor/` 를 통째로 담는다. 🔴 짐 파일은
 * 이미지 안에 없으므로 **볼륨으로 붙여 넣어야** 한다:
 *
 *   sudo docker compose -f docker-compose.nas.yml --env-file .env.nas --profile tools \
 *     run --rm -v /volume1/dss/transfer:/transfer:ro tools-as \
 *     npm run procedures:import -- --file /transfer/bundle.json --actor <uuid>
 *
 * 쓰려면 앞에 `-e APPLY=1` 을 더한다(`run --rm -e APPLY=1 …`).
 * 🔴 **이 도구는 새 이미지에만 들어 있다** — `scripts/` 와 `package.json` 이 둘 다
 * 바뀌었으므로, 옛 도구 이미지로 부르면 `Missing script` 가 나거나 파일이 없다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 🔴 상태는 **DRAFT 그대로** 넣는다
 * ──────────────────────────────────────────────────────────────────────
 * 게시는 사람이 운영 화면에서 눈으로 보고 따로 한다(2026-11-06 사용자 결정).
 * 이 도구에는 게시하는 길이 없다.
 */

const APPLY = process.env.APPLY === "1";

/** 한 번에 넣는 줄 수. postgres 의 바인딩 자리 수 한계(65535)에 한참 못 미친다. */
const INSERT_CHUNK_SIZE = 200;

function parseArgs(): { file: string; actor: string | null } {
  const args = process.argv.slice(2);
  const fileIndex = args.indexOf("--file");
  const file = fileIndex >= 0 ? args[fileIndex + 1] : undefined;
  if (!file) {
    console.error(
      "Usage: npm run procedures:import -- --file <bundle.json> --actor <운영 사용자 uuid>"
    );
    process.exit(1);
  }
  const actorIndex = args.indexOf("--actor");
  return { file, actor: actorIndex >= 0 ? (args[actorIndex + 1] ?? null) : null };
}

/**
 * 🔴 `--actor` 를 안 줬을 때 **고를 수 있는 사람을 찍어 준다.** 운영 사용자 id 는
 * 개발 PC 에서 알 길이 없다 — 「uuid 를 적으세요」로 끝내면 사람이 그 자리에서
 * 막히고, 그러면 DB 를 손으로 뒤지게 된다. 읽기만 하고 그대로 멈춘다.
 */
async function printActorCandidates(): Promise<void> {
  const candidates = await db
    .select({ id: users.id, name: users.name, role: users.role })
    .from(users)
    .where(
      and(
        or(eq(users.role, "SUPER_ADMIN"), eq(users.role, "ADMIN")),
        eq(users.approvalStatus, "APPROVED"),
        eq(users.isActive, true),
        eq(users.isDeleted, false)
      )
    )
    .limit(20);
  console.error("\n🔴 --actor <운영 사용자 uuid> 를 주세요 — 만든 사람으로 적힐 계정입니다.");
  console.error("   (created_by_user_id 는 NOT NULL 이고 외래키가 걸려 있어 비워 둘 수 없습니다.)");
  console.error(`\n   이 DB 에서 고를 수 있는 계정 ${candidates.length}개:`);
  for (const candidate of candidates) {
    console.error(`     ${candidate.id}  ${candidate.role.padEnd(12)} ${candidate.name}`);
  }
}

/** 🔴 운영에 **이미 있는 것**을 전부 세어 온다. 넣기 전에 한 번, 여기서만 읽는다. */
async function readExisting(bundle: ProcedureBundle, actorUserId: string): Promise<ExistingInTarget> {
  const templateIds = bundle.templates.map((template) => template.id);
  const nodeIds = bundle.nodes.map((node) => node.id);
  const edgeIds = bundle.edges.map((edge) => edge.id);
  const issueIds = bundle.issues.map((issue) => issue.id);
  const names = [...new Set(bundle.templates.map((template) => template.name))];
  const codes = [...new Set(bundle.templates.map((template) => template.code))];

  const existingTemplates = await selectIdsIn(templateIds, (ids) =>
    db.select({ id: procedureTemplates.id }).from(procedureTemplates).where(inArray(procedureTemplates.id, ids))
  );
  const existingNodes = await selectIdsIn(nodeIds, (ids) =>
    db
      .select({ id: procedureTemplateNodes.id })
      .from(procedureTemplateNodes)
      .where(inArray(procedureTemplateNodes.id, ids))
  );
  const existingEdges = await selectIdsIn(edgeIds, (ids) =>
    db
      .select({ id: procedureTemplateEdges.id })
      .from(procedureTemplateEdges)
      .where(inArray(procedureTemplateEdges.id, ids))
  );
  const existingIssues = await selectIdsIn(issueIds, (ids) =>
    db
      .select({ id: procedureTemplateValidationIssues.id })
      .from(procedureTemplateValidationIssues)
      .where(inArray(procedureTemplateValidationIssues.id, ids))
  );

  /**
   * 🔴 이름은 **지워진 줄까지** 센다. `name` 에 유일 제약이 없어 DB 는 안 막아 주고,
   * 휴지통의 줄은 15일 안에 복원되면 똑같이 겹친다(계획 세우기 쪽 머리말).
   */
  const nameMatches =
    names.length === 0
      ? []
      : await db
          .select({
            id: procedureTemplates.id,
            name: procedureTemplates.name,
            code: procedureTemplates.code,
            status: procedureTemplates.status,
            isDeleted: procedureTemplates.isDeleted,
          })
          .from(procedureTemplates)
          .where(inArray(procedureTemplates.name, names));

  /**
   * 🔴 `(code, version)` 이 유일키다 — code 만으로 세면 다른 판이 걸려 가짜로 멈추고,
   * 그 가짜 ✗ 는 사람이 「이 검사는 믿을 게 못 된다」로 읽는 쪽으로 간다. 그래서 code
   * 로 한 번 좁혀 온 뒤 **짐에 있는 판과 같은 줄만** 남긴다.
   */
  const codeRows =
    codes.length === 0
      ? []
      : await db
          .select({ id: procedureTemplates.id, code: procedureTemplates.code, version: procedureTemplates.version })
          .from(procedureTemplates)
          .where(inArray(procedureTemplates.code, codes));
  const wantedCodeVersions = new Set(
    bundle.templates.map((template) => `${template.code}@${template.version}`)
  );
  const codeVersionMatches = codeRows.filter((row) => wantedCodeVersions.has(`${row.code}@${row.version}`));

  const [actor] = await db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(
      and(
        eq(users.id, actorUserId),
        eq(users.approvalStatus, "APPROVED"),
        eq(users.isActive, true),
        eq(users.isDeleted, false)
      )
    )
    .limit(1);

  return {
    templateIds: existingTemplates,
    nodeIds: existingNodes,
    edgeIds: existingEdges,
    issueIds: existingIssues,
    nameMatches,
    codeVersionMatches,
    actor: actor ?? null,
  };
}

/**
 * `IN (…)` 을 토막내 돌린다. 🔵 836·1095개를 한 문장에 넣어도 한계에는 안 닿지만,
 * 짐이 커지는 날 조용히 깨지는 자리라 처음부터 토막낸다.
 */
async function selectIdsIn(
  ids: readonly string[],
  run: (ids: string[]) => Promise<{ id: string }[]>
): Promise<string[]> {
  const found: string[] = [];
  for (let i = 0; i < ids.length; i += INSERT_CHUNK_SIZE) {
    const chunk = ids.slice(i, i + INSERT_CHUNK_SIZE);
    if (chunk.length === 0) continue;
    const rows = await run(chunk);
    for (const row of rows) found.push(row.id);
  }
  return found;
}

/**
 * 🔴 커밋 뒤에 **DB 를 다시 읽어** 몇 줄이 서 있는지 센다. 넣으면서 센 값과 다른
 * 질문이다 — 「몇 번 불렀나」가 아니라 「지금 거기 있나」.
 * 🔵 이어가기는 **채워졌는지**까지 본다. 2단계가 조용히 안 돌면 1단계만 남아 연결이
 * 빈 절차가 서는데, 줄 수만 세면 그것이 안 드러난다.
 */
async function verifyAfterApply(
  bundle: ProcedureBundle,
  linkedNodeIds: readonly string[]
): Promise<{ templates: number; nodes: number; edges: number; issues: number; linkedNextProcedure: number }> {
  const templates = await selectIdsIn(
    bundle.templates.map((template) => template.id),
    (ids) =>
      db.select({ id: procedureTemplates.id }).from(procedureTemplates).where(inArray(procedureTemplates.id, ids))
  );
  const nodes = await selectIdsIn(
    bundle.nodes.map((node) => node.id),
    (ids) =>
      db
        .select({ id: procedureTemplateNodes.id })
        .from(procedureTemplateNodes)
        .where(inArray(procedureTemplateNodes.id, ids))
  );
  const edges = await selectIdsIn(
    bundle.edges.map((edge) => edge.id),
    (ids) =>
      db
        .select({ id: procedureTemplateEdges.id })
        .from(procedureTemplateEdges)
        .where(inArray(procedureTemplateEdges.id, ids))
  );
  const issues = await selectIdsIn(
    bundle.issues.map((issue) => issue.id),
    (ids) =>
      db
        .select({ id: procedureTemplateValidationIssues.id })
        .from(procedureTemplateValidationIssues)
        .where(inArray(procedureTemplateValidationIssues.id, ids))
  );
  const linked = await selectIdsIn([...linkedNodeIds], (ids) =>
    db
      .select({ id: procedureTemplateNodes.id })
      .from(procedureTemplateNodes)
      .where(and(inArray(procedureTemplateNodes.id, ids), isNotNull(procedureTemplateNodes.nextProcedureTemplateId)))
  );
  return {
    templates: templates.length,
    nodes: nodes.length,
    edges: edges.length,
    issues: issues.length,
    linkedNextProcedure: linked.length,
  };
}

function chunked<T>(rows: readonly T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += INSERT_CHUNK_SIZE) out.push(rows.slice(i, i + INSERT_CHUNK_SIZE));
  return out;
}

async function main(): Promise<void> {
  const { file, actor } = parseArgs();

  console.log("=".repeat(74));
  console.log("떠 온 절차 짐을 DB 에 넣는다");
  console.log("=".repeat(74));
  console.log(`짐 파일 : ${file}`);
  console.log(`대상 DB : ${formatDatabaseTarget(describeDatabaseTarget(process.env.DATABASE_URL))}   (비밀번호는 안 찍습니다)`);
  console.log(`모드    : ${APPLY ? "🔴 APPLY (DB 에 쓴다)" : "DRY RUN (DB 를 한 글자도 안 바꾼다)"}`);

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    console.error(`\n🔴 짐 파일을 읽지 못했습니다: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }

  const parsed = parseProcedureBundle(raw);
  if (!parsed.ok) {
    console.error(`\n${formatBundleBlockers(parsed.blockers)}`);
    console.log("\n🔴 실패했습니다.");
    process.exit(1);
  }
  const bundle = parsed.bundle;
  console.log(`뜬 때   : ${bundle.exportedAt}   뜬 곳: ${bundle.exportedFrom}`);
  console.log(`고른 잣대: ${bundle.selection}`);
  console.log(
    `짐 내용 : 절차 ${bundle.counts.templates} · 노드 ${bundle.counts.nodes} · ` +
      `분기 ${bundle.counts.edges} · 메모 ${bundle.counts.issues}`
  );

  try {
    if (!actor) {
      await printActorCandidates();
      process.exitCode = 1;
      return;
    }

    const existing = await readExisting(bundle, actor);
    const plan = planProcedureBundleInsert({ bundle, actorUserId: actor, existing });

    console.log(`\n${"=".repeat(74)}`);
    console.log("넣을 것");
    console.log("=".repeat(74));
    console.log(
      `  만든 사람으로 적힐 계정: ${existing.actor ? `${existing.actor.name} (${existing.actor.id})` : "🔴 못 찾음"}`
    );
    const nodesByTemplate = new Map<string, number>();
    for (const node of bundle.nodes) {
      nodesByTemplate.set(node.procedureTemplateId, (nodesByTemplate.get(node.procedureTemplateId) ?? 0) + 1);
    }
    const edgesByTemplate = new Map<string, number>();
    for (const edge of bundle.edges) {
      edgesByTemplate.set(edge.procedureTemplateId, (edgesByTemplate.get(edge.procedureTemplateId) ?? 0) + 1);
    }
    const issuesByTemplate = new Map<string, number>();
    for (const issue of bundle.issues) {
      issuesByTemplate.set(issue.procedureTemplateId, (issuesByTemplate.get(issue.procedureTemplateId) ?? 0) + 1);
    }
    for (const row of plan.templateRows) {
      console.log(
        `  ${row.code}  [${row.status}] ${row.name.padEnd(42)} ` +
          `노드 ${String(nodesByTemplate.get(row.id) ?? 0).padStart(3)} · ` +
          `분기 ${String(edgesByTemplate.get(row.id) ?? 0).padStart(3)} · ` +
          `메모 ${String(issuesByTemplate.get(row.id) ?? 0).padStart(2)}`
      );
    }

    /**
     * 🔴 **나중에 채우는 것**을 따로, 이름까지 적어 보여 준다. 절차끼리의 이어가기는
     * 넣는 차례로는 못 푸는 관계(순환한다)라 1단계에서 비워 두는데, 그 사실이 조용하면
     * 다 끝난 뒤에 「연결이 비었다」를 보고 사람이 결함으로 읽는다.
     */
    const templateNameById = new Map(bundle.templates.map((template) => [template.id, template.name]));
    console.log(`\n  ── 나중에 채울 이어가기 ${plan.deferredNodeNextProcedure.length}건 ${"─".repeat(26)}`);
    for (const link of plan.deferredNodeNextProcedure) {
      const node = bundle.nodes.find((candidate) => candidate.id === link.id);
      const ownerName = node ? (templateNameById.get(node.procedureTemplateId) ?? "?") : "?";
      console.log(
        `   "${ownerName}" / ${link.nodeCode} → "${templateNameById.get(link.nextProcedureTemplateId) ?? "?"}"`
      );
    }
    console.log(
      `  ── 나중에 채울 상위판 ${plan.deferredTemplateSupersedes.length}건 · ` +
        `복제원본 ${plan.deferredEdgeClonedFrom.length}건`
    );

    if (plan.blockers.length > 0) {
      console.error(`\n${formatBundleBlockers(plan.blockers)}`);
      console.log(`\n${"=".repeat(74)}`);
      console.log(
        formatBundleApplySummary({
          templates: 0,
          nodes: 0,
          edges: 0,
          issues: 0,
          linkedNextProcedure: 0,
          linkedSupersedes: 0,
          linkedClonedFrom: 0,
        })
      );
      console.log("🔴 실패했습니다 — 걸린 것이 있어 트랜잭션을 열지도 않았습니다.");
      console.log("=".repeat(74));
      process.exitCode = 1;
      return;
    }

    if (!APPLY) {
      console.log(`\n${"=".repeat(74)}`);
      console.log("걸린 것 없음 — 지금 APPLY=1 로 돌리면 위의 것이 그대로 들어갑니다.");
      console.log("드라이런입니다 — DB 에 아무것도 쓰지 않았습니다.");
      console.log(`쓰려면 같은 명령 앞에 APPLY=1 을 붙이세요 (--file "${file}" --actor ${actor}).`);
      console.log("=".repeat(74));
      return;
    }

    const summary: BundleApplySummary = {
      templates: 0,
      nodes: 0,
      edges: 0,
      issues: 0,
      linkedNextProcedure: 0,
      linkedSupersedes: 0,
      linkedClonedFrom: 0,
    };

    /**
     * 🔴 **한 트랜잭션.** 1단계(이어 걸리는 칸을 비운 채 넣기)와 2단계(채우기)가
     * 반드시 함께 끝나야 한다 — 1단계만 남으면 연결이 빈 절차 스물다섯이 운영에
     * 서고, 그것은 「아직 안 넣었다」보다 고치기 어렵다.
     */
    try {
      await db.transaction(async (tx) => {
        for (const rows of chunked(plan.templateRows)) {
          await tx.insert(procedureTemplates).values(rows);
          summary.templates += rows.length;
        }
        for (const rows of chunked(plan.nodeRows)) {
          await tx.insert(procedureTemplateNodes).values(rows);
          summary.nodes += rows.length;
        }
        for (const rows of chunked(plan.edgeRows)) {
          await tx.insert(procedureTemplateEdges).values(rows);
          summary.edges += rows.length;
        }
        for (const rows of chunked(plan.issueRows)) {
          await tx.insert(procedureTemplateValidationIssues).values(rows);
          summary.issues += rows.length;
        }

        // ── 2단계 — 전부 들어간 뒤에 이어 걸리는 칸을 채운다 ──────────────
        for (const link of plan.deferredTemplateSupersedes) {
          await tx
            .update(procedureTemplates)
            .set({ supersedesTemplateId: link.supersedesTemplateId })
            .where(eq(procedureTemplates.id, link.id));
          summary.linkedSupersedes += 1;
        }
        for (const link of plan.deferredNodeNextProcedure) {
          await tx
            .update(procedureTemplateNodes)
            .set({ nextProcedureTemplateId: link.nextProcedureTemplateId })
            .where(eq(procedureTemplateNodes.id, link.id));
          summary.linkedNextProcedure += 1;
        }
        for (const link of plan.deferredEdgeClonedFrom) {
          await tx
            .update(procedureTemplateEdges)
            .set({ clonedFromEdgeId: link.clonedFromEdgeId })
            .where(eq(procedureTemplateEdges.id, link.id));
          summary.linkedClonedFrom += 1;
        }
      });
    } catch (error) {
      console.log(`\n${"=".repeat(74)}`);
      console.log("🔴 쓰기 실패 — 트랜잭션이 통째로 되돌아갔습니다(DB 는 넣기 전과 같습니다).");
      console.log("=".repeat(74));
      console.log(error instanceof Error ? (error.stack ?? error.message) : String(error));
      console.log("-".repeat(74));
      // 🔴 되돌아갔으므로 **센 값을 그대로 찍지 않는다.** 들어간 줄은 0 이다.
      console.log(
        formatBundleApplySummary({
          templates: 0,
          nodes: 0,
          edges: 0,
          issues: 0,
          linkedNextProcedure: 0,
          linkedSupersedes: 0,
          linkedClonedFrom: 0,
        })
      );
      console.log("🔴 실패했습니다.");
      console.log("=".repeat(74));
      process.exitCode = 1;
      return;
    }

    /**
     * 🔴 **센 값이 아니라 DB 를 다시 읽어 확인한다.** 위의 `summary` 는 「내가 몇 번
     * 불렀나」일 뿐이다 — 커밋이 끝난 뒤 실제로 몇 줄이 서 있는지는 다른 질문이고,
     * 둘을 같은 것으로 읽다가 「만든 것」과 「도는 것」을 헷갈린 전례가 있다.
     * 어긋나면 🔴 로 찍고 **0 아닌 종료 코드**로 나간다.
     */
    const verified = await verifyAfterApply(bundle, plan.deferredNodeNextProcedure.map((link) => link.id));
    console.log(`\n${"=".repeat(74)}`);
    console.log(formatBundleApplySummary(summary));
    console.log(
      `되읽기: 절차 ${verified.templates}/${plan.templateRows.length} · ` +
        `노드 ${verified.nodes}/${plan.nodeRows.length} · ` +
        `분기 ${verified.edges}/${plan.edgeRows.length} · ` +
        `메모 ${verified.issues}/${plan.issueRows.length} · ` +
        `이어가기 ${verified.linkedNextProcedure}/${plan.deferredNodeNextProcedure.length}`
    );
    const mismatched =
      verified.templates !== plan.templateRows.length ||
      verified.nodes !== plan.nodeRows.length ||
      verified.edges !== plan.edgeRows.length ||
      verified.issues !== plan.issueRows.length ||
      verified.linkedNextProcedure !== plan.deferredNodeNextProcedure.length;
    if (mismatched) {
      console.log("🔴 되읽은 수가 넣으려던 수와 다릅니다 — 화면에서 확인하세요.");
      console.log("🔴 실패했습니다.");
      console.log("=".repeat(74));
      process.exitCode = 1;
      return;
    }
    console.log("넣은 절차는 전부 DRAFT 입니다 — 이 도구는 게시하지 않습니다. 화면에서 보고 따로 게시하세요.");
    console.log("✅ 끝났습니다.");
    console.log("=".repeat(74));
  } finally {
    await pgClient.end({ timeout: 5 });
  }
}

main().catch((error) => {
  console.error("실패:", error instanceof Error ? (error.stack ?? error.message) : String(error));
  process.exit(1);
});
