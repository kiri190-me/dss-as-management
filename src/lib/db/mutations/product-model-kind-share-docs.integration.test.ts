import "../../../../scripts/load-env";

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { and, eq, inArray, like } from "drizzle-orm";

import { db, pgClient } from "../connection";
import { auditLogs, productModelKindShareDocs, users } from "../schema";
import {
  PRODUCT_MODEL_KIND_SHARE_DOCS_AUDIT_ENTITY,
  addProductModelKindShareDoc,
  removeProductModelKindShareDoc,
} from "./product-model-kind-share-docs";
import { listShareDocsForProductModelKind } from "../queries/product-model-kind-share-docs";

/**
 * ============================================================================
 * 제품 종류별 공유폴더 **가리킴** 담기 · 지우기 — 실제 DB 통합 시험 (2026-10-07)
 * ============================================================================
 * 여기서 못 박는 것 넷:
 *  1. 🔴 **지우면 줄이 정말로 사라지고**, 그 흔적은 **감사 로그 하나뿐**이다 —
 *     이 표에는 휴지통이 없다(schema/product-model-kind-share-docs.ts 머리말).
 *     그래서 `previous_value` 에 지워진 줄이 **통째로** 들어 있는지 본다.
 *  2. 🔴 **같은 종류에 접어서 같은 경로는 둘이 될 수 없다** — 대소문자 · 연속 공백 ·
 *     앞뒤 공백 · 한글 풀어쓰기(NFD)가 모두 같은 자리로 접힌다. 그리고 그 거절이
 *     `23505` 가 아니라 **사람이 읽는 말**로 나온다.
 *  3. 🔴 **종류가 다르면 같은 경로를 담을 수 있다** — 접는 식의 앞 칸이 종류다.
 *  4. 🔴 **DB CHECK 가 마지막 울타리다** — 역슬래시 · 절대 경로 · `..` 마디 · 빈
 *     이름은 앱이 다 막고 있지만, 그 앞을 지나쳐 들어와도 표에는 들어가지 못한다.
 *
 * 디스크는 한 번도 건드리지 않는다 — 「그 자리에 있는가」는 서버 액션의 몫이고
 * (storage/repair-docs-entries.ts), 이 파일은 DB 만 본다.
 *
 * 🔴 **격리 이름**: 경로 앞머리 `AS-TEST-SHARE-DOC-<실행마다 다른 uuid>/`. after() 가
 * 그 앞머리로 고른 줄과 **그 줄들에 달린 감사 기록만** 지운다(중간에 끊긴 지난 실행이
 * 남겼을 수 있으므로 앞머리는 고정 부분으로도 한 번 더 훑는다).
 * ============================================================================
 */

const PATH_PREFIX_BASE = "AS-TEST-SHARE-DOC-";
const RUN_TOKEN = randomUUID();
const PATH_PREFIX = `${PATH_PREFIX_BASE}${RUN_TOKEN}/`;

let actorId: string;

/** 줄이 지워져도 감사 기록은 남으므로, 본 적 있는 id 를 따로 쥔다(뒷정리가 그것까지 걷는다). */
const auditIdsSeen: string[] = [];

function testPath(name: string): string {
  return `${PATH_PREFIX}${name}`;
}

before(async () => {
  const [user] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.approvalStatus, "APPROVED"), eq(users.isDeleted, false)))
    .limit(1);
  assert.ok(user, "expected at least one approved user in the test DB");
  actorId = user.id;
});

/** 이 파일이 만든 줄과 그 줄들의 감사 기록만 지운다. */
async function cleanUp(): Promise<void> {
  const ours = await db
    .select({ id: productModelKindShareDocs.id })
    .from(productModelKindShareDocs)
    .where(like(productModelKindShareDocs.relativePath, `${PATH_PREFIX_BASE}%`));
  const ids = ours.map((row) => row.id);
  // 지운 줄의 감사 기록은 줄이 사라진 뒤에도 남는다 — 아래 auditIdsSeen 이 그것까지 쥔다.
  const targets = [...new Set([...ids, ...auditIdsSeen])];
  if (targets.length > 0) {
    await db
      .delete(auditLogs)
      .where(
        and(
          eq(auditLogs.targetEntity, PRODUCT_MODEL_KIND_SHARE_DOCS_AUDIT_ENTITY),
          inArray(auditLogs.targetRecordId, targets)
        )
      );
  }
  if (ids.length > 0) {
    await db.delete(productModelKindShareDocs).where(inArray(productModelKindShareDocs.id, ids));
  }
}

after(async () => {
  await cleanUp();
  await pgClient.end({ timeout: 5 });
});

async function addDoc(params: {
  kind: "GENERATOR" | "MATCHER" | "TOTAL_CONTROLLER";
  relativePath: string;
  entryKind?: "FILE" | "FOLDER";
  label?: string | null;
}) {
  const result = await addProductModelKindShareDoc({
    productModelKind: params.kind,
    entryKind: params.entryKind ?? "FILE",
    relativePath: params.relativePath,
    label: params.label ?? null,
    actorUserId: actorId,
  });
  if (result.ok) auditIdsSeen.push(result.id);
  return result;
}

async function auditRowsFor(id: string) {
  return db
    .select({
      actorUserId: auditLogs.actorUserId,
      actionType: auditLogs.actionType,
      targetEntity: auditLogs.targetEntity,
      previousValue: auditLogs.previousValue,
      newValue: auditLogs.newValue,
    })
    .from(auditLogs)
    .where(
      and(
        eq(auditLogs.targetEntity, PRODUCT_MODEL_KIND_SHARE_DOCS_AUDIT_ENTITY),
        eq(auditLogs.targetRecordId, id)
      )
    );
}

async function rowById(id: string) {
  const [row] = await db
    .select({
      id: productModelKindShareDocs.id,
      productModelKind: productModelKindShareDocs.productModelKind,
      entryKind: productModelKindShareDocs.entryKind,
      relativePath: productModelKindShareDocs.relativePath,
      label: productModelKindShareDocs.label,
      displayOrder: productModelKindShareDocs.displayOrder,
      createdBy: productModelKindShareDocs.createdBy,
    })
    .from(productModelKindShareDocs)
    .where(eq(productModelKindShareDocs.id, id));
  return row ?? null;
}

/** DB 제약 위반인지 본다 — drizzle 이 감싼 오류의 원본은 `.cause` 에 있다. */
async function assertRejectsWithCause(run: Promise<unknown>, pattern: RegExp): Promise<void> {
  await assert.rejects(run, (error: unknown) => {
    const messages: string[] = [];
    let current: unknown = error;
    for (let depth = 0; depth < 5 && current instanceof Error; depth += 1) {
      messages.push(current.message);
      const next: unknown = current.cause;
      current = next;
    }
    const joined = messages.join(" | ");
    assert.match(joined, pattern);
    return true;
  });
}

describe("제품 종류별 공유폴더 가리킴 — 담기 · 지우기", () => {
  test("담으면 줄이 생기고 🔴 CREATE 감사 로그가 함께 남는다 — 글자를 다듬지 않는다", async () => {
    // 🔴 공백이 두 칸인 이름 — 다듬어 담으면 **없는 폴더**가 된다.
    const relativePath = testPath("2.  인수시 서류/2. MB 인수시 체크시트.xlsx");
    const created = await addDoc({ kind: "GENERATOR", relativePath, label: "인수시 체크시트" });
    assert.equal(created.ok, true, JSON.stringify(created));
    if (!created.ok) throw new Error("unreachable");

    const row = await rowById(created.id);
    assert.ok(row);
    assert.equal(row.productModelKind, "GENERATOR");
    assert.equal(row.entryKind, "FILE");
    // 들어온 글자 그대로다 — 공백 두 칸이 그대로 남아 있어야 한다.
    assert.equal(row.relativePath, relativePath);
    assert.equal(row.label, "인수시 체크시트");
    assert.equal(row.displayOrder, null);
    assert.equal(row.createdBy, actorId);

    const audits = await auditRowsFor(created.id);
    assert.equal(audits.length, 1, JSON.stringify(audits));
    assert.equal(audits[0].actionType, "CREATE");
    assert.equal(audits[0].actorUserId, actorId);
    assert.deepEqual(audits[0].newValue, {
      productModelKind: "GENERATOR",
      entryKind: "FILE",
      relativePath,
      label: "인수시 체크시트",
    });
    assert.equal(audits[0].previousValue, null);
  });

  test("🔴 같은 종류에 **접어서 같은** 경로는 사람 말로 거절된다 — 줄도 감사도 늘지 않는다", async () => {
    const base = testPath("중복/MB 체크시트.xlsx");
    const first = await addDoc({ kind: "MATCHER", relativePath: base });
    assert.equal(first.ok, true, JSON.stringify(first));

    // 대소문자 · 연속 공백 · 앞뒤 공백 · 한글 풀어쓰기(NFD) — 전부 같은 자리로 접힌다.
    const sameFolded = [
      base,
      base.toUpperCase(),
      base.replace("MB 체크시트", "MB  체크시트"),
      `  ${base}  `,
      base.normalize("NFD"),
    ];
    for (const relativePath of sameFolded) {
      const again = await addDoc({ kind: "MATCHER", relativePath });
      assert.equal(again.ok, false, `${relativePath} 가 두 번째로 담겼다`);
      if (again.ok) throw new Error("unreachable");
      assert.equal(again.code, "DUPLICATE");
      // 🔴 23505 가 사람에게 보이지 않는다.
      assert.ok(!/23505|duplicate key|unique/i.test(again.message), again.message);
      assert.match(again.message, /이미/);
    }

    const rows = await db
      .select({ id: productModelKindShareDocs.id })
      .from(productModelKindShareDocs)
      .where(
        and(
          eq(productModelKindShareDocs.productModelKind, "MATCHER"),
          like(productModelKindShareDocs.relativePath, `${PATH_PREFIX}중복/%`)
        )
      );
    assert.equal(rows.length, 1, "접어서 같은 경로가 둘이 되었다");
  });

  test("🔴 종류가 다르면 같은 경로를 담을 수 있다 — 접는 식의 앞 칸이 종류다", async () => {
    const relativePath = testPath("공용/작업 수순.pdf");
    const generator = await addDoc({ kind: "GENERATOR", relativePath });
    const totalController = await addDoc({ kind: "TOTAL_CONTROLLER", relativePath });
    assert.equal(generator.ok, true, JSON.stringify(generator));
    assert.equal(totalController.ok, true, JSON.stringify(totalController));
  });

  test("🔴 지우면 줄이 사라지고 PURGE 감사 로그에 **지워진 줄이 통째로** 남는다", async () => {
    const relativePath = testPath("지울것/인수시 서류");
    const created = await addDoc({
      kind: "TOTAL_CONTROLLER",
      relativePath,
      entryKind: "FOLDER",
      label: "인수시 서류 폴더",
    });
    assert.equal(created.ok, true, JSON.stringify(created));
    if (!created.ok) throw new Error("unreachable");

    const removed = await removeProductModelKindShareDoc({
      id: created.id,
      productModelKind: "TOTAL_CONTROLLER",
      actorUserId: actorId,
    });
    assert.equal(removed.ok, true, JSON.stringify(removed));

    // 🔴 휴지통이 없다 — 줄이 정말로 사라진다.
    assert.equal(await rowById(created.id), null, "지웠는데 줄이 남아 있다");

    const audits = await auditRowsFor(created.id);
    assert.equal(audits.length, 2, JSON.stringify(audits));
    const purge = audits.find((audit) => audit.actionType === "PURGE");
    assert.ok(purge, JSON.stringify(audits));
    assert.equal(purge.actorUserId, actorId);
    assert.equal(purge.newValue, null);

    // 🔴 되살리려면 이 값 하나로 줄을 다시 적을 수 있어야 한다.
    const previous = purge.previousValue as Record<string, unknown>;
    assert.equal(previous.id, created.id);
    assert.equal(previous.productModelKind, "TOTAL_CONTROLLER");
    assert.equal(previous.entryKind, "FOLDER");
    assert.equal(previous.relativePath, relativePath);
    assert.equal(previous.label, "인수시 서류 폴더");
    assert.equal(previous.displayOrder, null);
    assert.equal(previous.createdBy, actorId);
    assert.equal(typeof previous.createdAt, "string");
  });

  test("🔴 없는 id · 다른 종류의 id 로는 지워지지 않는다 — 감사 로그도 안 남는다", async () => {
    const relativePath = testPath("남의것/안 지워질 것.pdf");
    const created = await addDoc({ kind: "GENERATOR", relativePath });
    assert.equal(created.ok, true, JSON.stringify(created));
    if (!created.ok) throw new Error("unreachable");

    // 종류가 어긋나면 **없는 것과 같이** 답한다.
    const wrongKind = await removeProductModelKindShareDoc({
      id: created.id,
      productModelKind: "MATCHER",
      actorUserId: actorId,
    });
    assert.equal(wrongKind.ok, false);
    if (wrongKind.ok) throw new Error("unreachable");
    assert.equal(wrongKind.code, "NOT_FOUND");
    assert.ok(await rowById(created.id), "다른 종류로 부른 삭제가 줄을 지웠다");

    const missingId = randomUUID();
    const missing = await removeProductModelKindShareDoc({
      id: missingId,
      productModelKind: "GENERATOR",
      actorUserId: actorId,
    });
    assert.equal(missing.ok, false);
    assert.deepEqual(await auditRowsFor(missingId), [], "없는 줄을 지우며 감사 로그를 남겼다");

    // 담을 때의 CREATE 하나뿐이다 — 실패한 삭제가 기록을 남기지 않았다.
    const audits = await auditRowsFor(created.id);
    assert.deepEqual(
      audits.map((audit) => audit.actionType),
      ["CREATE"]
    );
  });

  test("한 종류의 목록을 차례대로 읽는다 — display_order, created_at (NULL 은 뒤로)", async () => {
    const first = await addDoc({ kind: "MATCHER", relativePath: testPath("차례/1 먼저.pdf") });
    const second = await addDoc({ kind: "MATCHER", relativePath: testPath("차례/2 나중.pdf") });
    const ordered = await addDoc({ kind: "MATCHER", relativePath: testPath("차례/3 맨 앞으로.pdf") });
    assert.ok(first.ok && second.ok && ordered.ok);
    if (!first.ok || !second.ok || !ordered.ok) throw new Error("unreachable");

    // 차례를 정하는 화면은 다음 조각이라, 여기서는 칸을 직접 채워 조회의 ORDER BY 만 본다.
    await db
      .update(productModelKindShareDocs)
      .set({ displayOrder: 10 })
      .where(eq(productModelKindShareDocs.id, ordered.id));

    const listed = await listShareDocsForProductModelKind("MATCHER");
    const ours = listed.filter((item) => item.relativePath.startsWith(`${PATH_PREFIX}차례/`));
    assert.deepEqual(
      ours.map((item) => item.relativePath),
      [testPath("차례/3 맨 앞으로.pdf"), testPath("차례/1 먼저.pdf"), testPath("차례/2 나중.pdf")]
    );
    // 돌려주는 모양 — 루트도 전체 경로도 없다.
    const [head] = ours;
    assert.deepEqual(Object.keys(head).sort(), [
      "createdAt",
      "createdById",
      "createdByName",
      "displayOrder",
      "entryKind",
      "id",
      "label",
      "relativePath",
    ]);
    assert.equal(head.displayOrder, 10);
    assert.equal(head.createdById, actorId);
    assert.ok(head.createdByName.length > 0);
    assert.equal(typeof head.createdAt, "string");
    // 목록 밖의 종류 코드는 빈 배열이다(DB 를 묻지 않는다).
    assert.deepEqual(await listShareDocsForProductModelKind("NOT_A_KIND"), []);
  });

  test("🔴 DB CHECK 가 마지막 울타리다 — 앱을 지나쳐 와도 표에 들어가지 못한다", async () => {
    // 역슬래시 · 절대 경로 · 앞뒤 공백 · `..` 마디 · 앞뒤 슬래시.
    for (const relativePath of [
      `${PATH_PREFIX}윈도우\\경로.pdf`,
      `C:/${PATH_PREFIX}절대경로.pdf`,
      ` ${PATH_PREFIX}앞에 공백.pdf`,
      `${PATH_PREFIX}../거슬러.pdf`,
      `/${PATH_PREFIX}앞 슬래시.pdf`,
      `${PATH_PREFIX}두//슬래시.pdf`,
    ]) {
      await assertRejectsWithCause(
        addProductModelKindShareDoc({
          productModelKind: "GENERATOR",
          entryKind: "FILE",
          relativePath,
          label: null,
          actorUserId: actorId,
        }),
        /relative_path_shape/
      );
    }

    // 🔴 빈 이름은 NULL 이어야 한다 — `""` 가 들어오면 CHECK 가 막는다.
    await assertRejectsWithCause(
      addProductModelKindShareDoc({
        productModelKind: "GENERATOR",
        entryKind: "FILE",
        relativePath: testPath("빈 이름.pdf"),
        label: "   ",
        actorUserId: actorId,
      }),
      /label_not_blank/
    );
  });
});
