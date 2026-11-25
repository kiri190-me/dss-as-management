import "../../../../scripts/load-env";

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, like } from "drizzle-orm";
import { db, pgClient } from "../connection";
import {
  procedureTemplates,
  procedureTemplateNodes,
  procedureTemplateEdges,
  procedureTemplateEditHistory,
  users,
} from "../schema";
import { createDraftProcedureTemplateFromImport, createNewDraftVersion, publishProcedureTemplate } from "./procedure-templates";
import { updateProcedureTemplateNode } from "./procedure-template-editor";
import { getProcedureTemplateForEditor } from "../queries/procedure-template-editor";
import type { ExtractedTemplate } from "../../../../scripts/lib/xlsx/types";

/**
 * ============================================================================
 * 기술 작업 절차 노드의 「관련 파일」 — DB 까지 (2026-11-25, 조각 E2)
 * ============================================================================
 * 재는 것 다섯:
 *  ① 🔴 **초안에서는 담기고 게시본에서는 거절된다** — 이것이 절차 쪽 **고유**다. 진단
 *     Flowchart 에는 「게시」라는 상태가 없고, 여기서는 assertEditableDraft 가
 *     `status !== "DRAFT"` 를 NOT_DRAFT 로 거절한다. 🔴 **짝으로** 잰다: 같은 노드에
 *     같은 값을 초안일 때 한 번, 게시된 뒤에 한 번. 한쪽만 재면 「원래부터 안 되는
 *     기능」과 구별이 안 된다.
 *  ② 🔴 조회가 그 칸을 **돌려준다** — 안 읽으면 저장은 되는데 새로 고칠 때마다
 *     「가리킨 적 없음」으로 되돌아가고, 다음 저장이 **지우는 쪽으로** 나간다.
 *  ③ 🔴 편집 이력에 **before/after 가 함께** 남는다 — 안 실으면 [편집 이력]에 「노드
 *     수정」만 뜨고 무엇이 바뀌었는지 알 길이 없다.
 *  ④ 🔴 **새 초안을 만들면 가리킴이 따라온다**(판 복제). 안 따라오면 절차를 개정할
 *     때마다 매 둔 파일 위치가 오류 없이 사라진다.
 *  ⑤ 🔴 마지막 그물 — 액션을 건너뛰고 들어온 **규칙 밖 경로**는 DB CHECK 가 거절한다.
 *
 * 🔵 이 시험은 **서버 액션을 지나지 않는다**(`"use server"` 모듈은 이 틀에서 못 부른다).
 *    그래서 「공유폴더에 그 파일이 실제로 있는가」는 여기서 안 재고 — 그쪽은 액션의 몫이라
 *    원본을 글자로 읽는 이웃 시험(validation/procedure-node-share-doc.test.ts)이 본다 —
 *    여기서는 **DB 까지 값이 가는가**만 본다. 그래서 아래 경로들은 디스크에 없어도 된다.
 *
 * 🔵 뒷정리는 이웃 procedure-template-editor.integration.test.ts 와 같은 규약이다:
 *    이 파일이 만든 절차는 전부 TEST_CODE_PREFIX 로 시작하고, after() 가 이력 →
 *    연결선 → 노드 → 절차 차례로 지운다(이력 FK 가 restrict 다).
 * ============================================================================
 */

const TEST_CODE_PREFIX = "test-node-sharedoc-";

/** 🔵 디스크에 없어도 되는, **모양은 올바른** 경로 하나(머리말). */
const SAMPLE_PATH = "1. 수리 관련/2026/점검 절차.pdf";
const OTHER_PATH = "1. 수리 관련/2026/체크시트.xlsx";

let superAdminId: string;
const createdTemplateIds: string[] = [];

function uniqueCode(suffix: string): string {
  return `${TEST_CODE_PREFIX}${suffix}-${randomUUID().slice(0, 8)}`;
}

/** START → TASK → END. 구조 검증을 통과하므로 publish 가 된다(①·④ 가 게시를 쓴다). */
function makeTemplate(code: string): ExtractedTemplate {
  return {
    code,
    name: `관련 파일 시험 ${code}`,
    equipmentType: "RFG",
    description: "노드 관련 파일 통합 시험 밑자락",
    sourceWorksheets: ["(TEST) 관련 파일 시트"],
    category: "FULL_SERVICE",
    isReferenceOnly: false,
    referenceItems: [],
    nodes: [
      { nodeCode: "n1", nodeType: "START", title: "시작", positionX: 0, positionY: 0, sortOrder: 0, sourceWorksheet: "(TEST) 관련 파일 시트", sourceShapeId: "1" },
      { nodeCode: "n2", nodeType: "TASK", title: "작업", positionX: 100, positionY: 0, sortOrder: 1, sourceWorksheet: "(TEST) 관련 파일 시트", sourceShapeId: "2" },
      { nodeCode: "n3", nodeType: "END", title: "종료", positionX: 200, positionY: 0, sortOrder: 2, sourceWorksheet: "(TEST) 관련 파일 시트", sourceShapeId: "3" },
    ],
    edges: [
      { fromNodeCode: "n1", toNodeCode: "n2", branchType: "DEFAULT", branchLabel: null, sortOrder: 0, sourceConnectorId: "c1" },
      { fromNodeCode: "n2", toNodeCode: "n3", branchType: "DEFAULT", branchLabel: null, sortOrder: 1, sourceConnectorId: "c2" },
    ],
    checklistSections: [],
    troubleshootingEntries: [],
    issues: [],
  };
}

async function createDraft(code: string): Promise<string> {
  const result = await createDraftProcedureTemplateFromImport(makeTemplate(code), superAdminId, {
    sourceFileName: "share-doc-fixture.xlsx",
    sourceFileHash: `hash-${code}`,
  });
  assert.equal(result.ok, true, `밑자락 만들기 실패: ${JSON.stringify(result)}`);
  if (!result.ok) throw new Error("unreachable");
  createdTemplateIds.push(result.id);
  return result.id;
}

async function loadTemplateRow(templateId: string) {
  const [row] = await db.select().from(procedureTemplates).where(eq(procedureTemplates.id, templateId));
  return row;
}

async function loadNodesByCode(templateId: string) {
  const rows = await db.select().from(procedureTemplateNodes).where(eq(procedureTemplateNodes.procedureTemplateId, templateId));
  return new Map(rows.map((n) => [n.nodeCode, n]));
}

async function loadNode(nodeId: string) {
  const [row] = await db.select().from(procedureTemplateNodes).where(eq(procedureTemplateNodes.id, nodeId));
  return row;
}

before(async () => {
  const [superAdmin] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.role, "SUPER_ADMIN"), eq(users.approvalStatus, "APPROVED"), eq(users.isDeleted, false), eq(users.isActive, true)))
    .limit(1);
  assert.ok(superAdmin, "개발/시험 DB 에 승인된 SUPER_ADMIN 이 있어야 한다");
  superAdminId = superAdmin.id;
});

after(async () => {
  const testTemplates = await db.select({ id: procedureTemplates.id }).from(procedureTemplates).where(like(procedureTemplates.code, `${TEST_CODE_PREFIX}%`));
  const allIds = [...new Set([...createdTemplateIds, ...testTemplates.map((t) => t.id)])];
  if (allIds.length > 0) {
    // 이력 FK 가 restrict 다 — 반드시 먼저 지운다.
    await db.delete(procedureTemplateEditHistory).where(inArray(procedureTemplateEditHistory.procedureTemplateId, allIds));
    await db.delete(procedureTemplateEdges).where(inArray(procedureTemplateEdges.procedureTemplateId, allIds));
    await db.delete(procedureTemplateNodes).where(inArray(procedureTemplateNodes.procedureTemplateId, allIds));
    await db.delete(procedureTemplates).where(inArray(procedureTemplates.id, allIds));
  }
  await pgClient.end({ timeout: 5 });
});

describe("절차 노드의 「관련 파일」 — 초안 ↔ 게시본", () => {
  test("🔴 ① 초안에서는 담기고, 게시된 뒤에는 거절된다(짝으로 잰다)", async () => {
    const templateId = await createDraft(uniqueCode("draft-vs-published"));
    const nodes = await loadNodesByCode(templateId);
    const nodeId = nodes.get("n2")!.id;

    // 🔵 표본 먼저 — 처음에는 아무것도 안 가리킨다. 안 그러면 아래 「담겼다」가 공짜다.
    assert.equal((await loadNode(nodeId)).shareDocRelativePath, null, "밑자락이 이미 가리키고 있다 — 아래 단언이 뜻을 잃는다");

    // ── 초안: 담긴다 ────────────────────────────────────────────────
    const draftRow = await loadTemplateRow(templateId);
    const okResult = await updateProcedureTemplateNode(nodeId, superAdminId, { shareDocRelativePath: SAMPLE_PATH }, draftRow.updatedAt.toISOString());
    assert.equal(okResult.ok, true, `초안에서 거절당했다: ${JSON.stringify(okResult)}`);
    assert.equal((await loadNode(nodeId)).shareDocRelativePath, SAMPLE_PATH, "초안에서 담기지 않았다");

    // ── 게시본: 거절된다 ───────────────────────────────────────────
    const published = await publishProcedureTemplate(templateId, superAdminId);
    assert.equal(published.ok, true, `게시 실패: ${JSON.stringify(published)}`);

    const publishedRow = await loadTemplateRow(templateId);
    assert.equal(publishedRow.status, "PUBLISHED");
    const rejected = await updateProcedureTemplateNode(nodeId, superAdminId, { shareDocRelativePath: OTHER_PATH }, publishedRow.updatedAt.toISOString());
    assert.equal(rejected.ok, false, "게시본인데 통과했다 — 울타리가 뚫렸다");
    if (!rejected.ok) assert.equal(rejected.code, "NOT_DRAFT");
    // 🔴 거절만으로는 모자라다 — **값이 안 바뀌었는지**까지 본다.
    assert.equal((await loadNode(nodeId)).shareDocRelativePath, SAMPLE_PATH, "거절했다면서 값이 바뀌었다");
  });

  test("🔴 ② 가리킴 지우기(null)도 초안에서는 되고 게시본에서는 거절된다", async () => {
    const templateId = await createDraft(uniqueCode("clear"));
    const nodes = await loadNodesByCode(templateId);
    const nodeId = nodes.get("n2")!.id;

    const row1 = await loadTemplateRow(templateId);
    const set = await updateProcedureTemplateNode(nodeId, superAdminId, { shareDocRelativePath: SAMPLE_PATH }, row1.updatedAt.toISOString());
    assert.equal(set.ok, true);
    assert.equal((await loadNode(nodeId)).shareDocRelativePath, SAMPLE_PATH, "표본이 비었다 — 지울 것이 없다");

    const row2 = await loadTemplateRow(templateId);
    const cleared = await updateProcedureTemplateNode(nodeId, superAdminId, { shareDocRelativePath: null }, row2.updatedAt.toISOString());
    assert.equal(cleared.ok, true, `지우기가 거절당했다: ${JSON.stringify(cleared)}`);
    assert.equal((await loadNode(nodeId)).shareDocRelativePath, null, "지웠는데 값이 남아 있다");

    // 다시 담고 게시한 뒤에는 **지우는 것도** 막힌다(assertEditableDraft 는 갈래를 안 가른다).
    const row3 = await loadTemplateRow(templateId);
    assert.equal((await updateProcedureTemplateNode(nodeId, superAdminId, { shareDocRelativePath: SAMPLE_PATH }, row3.updatedAt.toISOString())).ok, true);
    assert.equal((await publishProcedureTemplate(templateId, superAdminId)).ok, true);
    const publishedRow = await loadTemplateRow(templateId);
    const rejected = await updateProcedureTemplateNode(nodeId, superAdminId, { shareDocRelativePath: null }, publishedRow.updatedAt.toISOString());
    assert.equal(rejected.ok, false);
    if (!rejected.ok) assert.equal(rejected.code, "NOT_DRAFT");
    assert.equal((await loadNode(nodeId)).shareDocRelativePath, SAMPLE_PATH);
  });

  test("🔴 ③ 칸을 **안 실으면 건드리지 않는다** — 제목만 고친 저장이 가리킴을 지우지 않는다", async () => {
    const templateId = await createDraft(uniqueCode("untouched"));
    const nodes = await loadNodesByCode(templateId);
    const nodeId = nodes.get("n2")!.id;

    const row1 = await loadTemplateRow(templateId);
    assert.equal((await updateProcedureTemplateNode(nodeId, superAdminId, { shareDocRelativePath: SAMPLE_PATH }, row1.updatedAt.toISOString())).ok, true);
    assert.equal((await loadNode(nodeId)).shareDocRelativePath, SAMPLE_PATH, "표본이 비었다");

    const row2 = await loadTemplateRow(templateId);
    const titleOnly = await updateProcedureTemplateNode(nodeId, superAdminId, { title: "제목만 고침" }, row2.updatedAt.toISOString());
    assert.equal(titleOnly.ok, true);
    const after = await loadNode(nodeId);
    assert.equal(after.title, "제목만 고침");
    assert.equal(after.shareDocRelativePath, SAMPLE_PATH, "🔴 안 실은 칸이 지워졌다 — patch 가 부분 적용이 아니게 됐다");
  });
});

describe("절차 노드의 「관련 파일」 — 조회 · 이력 · 판 복제 · DB CHECK", () => {
  test("🔴 ④ 편집기 조회가 그 칸을 **돌려준다**", async () => {
    const templateId = await createDraft(uniqueCode("read-back"));
    const nodes = await loadNodesByCode(templateId);
    const nodeId = nodes.get("n2")!.id;

    // 🔵 표본 먼저 — 담기 전에는 null 로 돌아온다(아래가 「언제나 그 값」이 아님을 보인다).
    const before = await getProcedureTemplateForEditor(templateId);
    assert.ok(before, "조회가 비었다");
    assert.equal(before.nodes.find((n) => n.id === nodeId)!.shareDocRelativePath, null);

    const row = await loadTemplateRow(templateId);
    assert.equal((await updateProcedureTemplateNode(nodeId, superAdminId, { shareDocRelativePath: SAMPLE_PATH }, row.updatedAt.toISOString())).ok, true);

    const read = await getProcedureTemplateForEditor(templateId);
    assert.ok(read);
    assert.equal(
      read.nodes.find((n) => n.id === nodeId)!.shareDocRelativePath,
      SAMPLE_PATH,
      "🔴 조회가 안 읽어 온다 — 새로 고칠 때마다 가리킴이 사라진 것처럼 보이고 다음 저장이 지운다"
    );
  });

  test("🔴 ⑤ 편집 이력에 before/after 가 **둘 다** 남는다", async () => {
    const templateId = await createDraft(uniqueCode("history"));
    const nodes = await loadNodesByCode(templateId);
    const nodeId = nodes.get("n2")!.id;

    const row1 = await loadTemplateRow(templateId);
    assert.equal((await updateProcedureTemplateNode(nodeId, superAdminId, { shareDocRelativePath: SAMPLE_PATH }, row1.updatedAt.toISOString())).ok, true);
    const row2 = await loadTemplateRow(templateId);
    assert.equal((await updateProcedureTemplateNode(nodeId, superAdminId, { shareDocRelativePath: OTHER_PATH }, row2.updatedAt.toISOString())).ok, true);

    const [latest] = await db
      .select()
      .from(procedureTemplateEditHistory)
      .where(and(eq(procedureTemplateEditHistory.nodeId, nodeId), eq(procedureTemplateEditHistory.actionType, "UPDATE_NODE")))
      .orderBy(desc(procedureTemplateEditHistory.createdAt))
      .limit(1);
    assert.ok(latest, "UPDATE_NODE 이력이 한 줄도 없다");
    const before = latest.beforeState as Record<string, unknown>;
    const afterState = latest.afterState as Record<string, unknown>;
    assert.equal(before.shareDocRelativePath, SAMPLE_PATH, "🔴 before 에 그 칸이 없다 — 무엇에서 바뀌었는지 알 길이 사라진다");
    assert.equal(afterState.shareDocRelativePath, OTHER_PATH, "🔴 after 에 그 칸이 없다");
  });

  test("🔴 ⑥ 새 초안을 만들면 가리킴이 **따라온다**(판 복제)", async () => {
    const templateId = await createDraft(uniqueCode("clone"));
    const nodes = await loadNodesByCode(templateId);
    const nodeId = nodes.get("n2")!.id;

    const row = await loadTemplateRow(templateId);
    assert.equal((await updateProcedureTemplateNode(nodeId, superAdminId, { shareDocRelativePath: SAMPLE_PATH }, row.updatedAt.toISOString())).ok, true);
    assert.equal((await publishProcedureTemplate(templateId, superAdminId)).ok, true);

    const newDraft = await createNewDraftVersion(templateId, superAdminId);
    assert.equal(newDraft.ok, true, `새 초안 만들기 실패: ${JSON.stringify(newDraft)}`);
    if (!newDraft.ok) return;
    createdTemplateIds.push(newDraft.id);

    const clonedNodes = await loadNodesByCode(newDraft.id);
    assert.equal(clonedNodes.size, 3, "복제된 노드 수가 다르다 — 표본이 어긋났다");
    assert.equal(
      clonedNodes.get("n2")!.shareDocRelativePath,
      SAMPLE_PATH,
      "🔴 복제 목록에서 빠졌다 — 개정할 때마다 매 둔 파일 위치가 오류 없이 사라진다"
    );
    // 🔵 안 가리킨 노드는 그대로 null 이다(복제가 아무 값이나 넣는 것이 아님을 보인다).
    assert.equal(clonedNodes.get("n1")!.shareDocRelativePath, null);
    // 🔴 원본(게시본)은 그대로다.
    assert.equal((await loadNode(nodeId)).shareDocRelativePath, SAMPLE_PATH);
  });

  test("🔴 ⑦ 마지막 그물 — 규칙 밖 경로는 **DB CHECK** 가 거절한다(액션을 건너뛰어도)", async () => {
    const templateId = await createDraft(uniqueCode("db-check"));
    const nodes = await loadNodesByCode(templateId);
    const nodeId = nodes.get("n2")!.id;

    // 🔴 액션의 글자 검사를 **일부러 건너뛴다** — mutation 을 바로 부른다.
    //    400자 상한 · 드라이브 문자 · 앞뒤 공백은 액션이 먼저 막지만, 그 길로 안 들어온
    //    값이 있을 때 마지막으로 무는 것이 CHECK 다.
    for (const bad of ["C:/점검.pdf", " 1. 수리 관련/점검.pdf", `1. 수리 관련/${"a".repeat(400)}.pdf`]) {
      const row = await loadTemplateRow(templateId);
      let threw = false;
      try {
        await updateProcedureTemplateNode(nodeId, superAdminId, { shareDocRelativePath: bad }, row.updatedAt.toISOString());
      } catch {
        threw = true;
      }
      assert.equal(threw, true, `CHECK 가 안 물었다: ${bad.slice(0, 40)}`);
      assert.equal((await loadNode(nodeId)).shareDocRelativePath, null, `거절됐는데 값이 남았다: ${bad.slice(0, 40)}`);
    }

    // 🔵 반대쪽 — 같은 길로 들어온 **올바른** 경로는 통과한다(위가 「무조건 거절」이 아님).
    const row = await loadTemplateRow(templateId);
    assert.equal((await updateProcedureTemplateNode(nodeId, superAdminId, { shareDocRelativePath: SAMPLE_PATH }, row.updatedAt.toISOString())).ok, true);
    assert.equal((await loadNode(nodeId)).shareDocRelativePath, SAMPLE_PATH);
  });
});
