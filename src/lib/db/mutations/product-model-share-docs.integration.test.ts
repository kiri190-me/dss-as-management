import "../../../../scripts/load-env";

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { and, eq, inArray, like } from "drizzle-orm";

import { db, pgClient } from "../connection";
import { auditLogs, productModelShareDocs, productModels, users } from "../schema";
import {
  PRODUCT_MODEL_SHARE_DOCS_AUDIT_ENTITY,
  addProductModelShareDoc,
  removeProductModelShareDoc,
} from "./product-model-share-docs";
import {
  getShareDocProductModel,
  listShareDocsForProductModel,
} from "../queries/product-model-share-docs";

/**
 * ============================================================================
 * 제품 **모델별** 공유폴더 가리킴 담기 · 지우기 — 실제 DB 통합 시험 (2026-10-07)
 * ============================================================================
 * 종류별 표의 짝(product-model-kind-share-docs.integration.test.ts)과 같은 것을 못 박고,
 * **주인이 행이라서 생기는 둘**을 더 본다:
 *  1. 🔴 **지우면 줄이 정말로 사라지고**, 그 흔적은 **감사 로그 하나뿐**이다 —
 *     이 표에는 휴지통이 없다. 그래서 `previous_value` 에 지워진 줄이 **통째로**
 *     들어 있는지 본다(그 값 하나로 줄을 다시 적을 수 있어야 한다).
 *  2. 🔴 **같은 모델에 접어서 같은 경로는 둘이 될 수 없다** — 대소문자 · 연속 공백 ·
 *     앞뒤 공백 · 한글 풀어쓰기(NFD)가 모두 같은 자리로 접힌다. 그리고 그 거절이
 *     `23505` 가 아니라 **사람이 읽는 말**로 나온다.
 *  3. 🔴 **모델이 다르면 같은 경로를 담을 수 있다** — 접는 식의 앞 칸이 모델이다.
 *  4. 🔴 **DB CHECK 가 마지막 울타리다** — 역슬래시 · 절대 경로 · `..` 마디 · 빈
 *     이름은 앱이 다 막고 있지만, 그 앞을 지나쳐 들어와도 표에는 들어가지 못한다.
 *  5. 🔴 **휴지통에 있는 모델은 없는 것과 같다** — 담고 지우는 길을 여는 조회
 *     (getShareDocProductModel)가 그 자리에서 막는다.
 *  6. 🔴 **모델이 사라지면 가리킴도 사라진다**(FK 의 ON DELETE CASCADE).
 *
 * 디스크는 한 번도 건드리지 않는다 — 「그 자리에 있는가」는 서버 액션의 몫이고
 * (storage/repair-docs-entries.ts), 이 파일은 DB 만 본다.
 *
 * 🔴 **격리 이름**: 모델 이름 `AS-TEST-SHARE-MODEL-<실행마다 다른 uuid>-…`, 경로 앞머리
 * `AS-TEST-MODEL-SHARE-DOC-<같은 uuid>/`. after() 가 그 앞머리로 고른 줄과 **그 줄들에
 * 달린 감사 기록만** 지운다(중간에 끊긴 지난 실행이 남겼을 수 있으므로 앞머리는 고정
 * 부분으로도 한 번 더 훑는다).
 * ============================================================================
 */

const RUN_TOKEN = randomUUID();
const PATH_PREFIX_BASE = "AS-TEST-MODEL-SHARE-DOC-";
const PATH_PREFIX = `${PATH_PREFIX_BASE}${RUN_TOKEN}/`;
const MODEL_PREFIX_BASE = "AS-TEST-SHARE-MODEL-";
const MODEL_PREFIX = `${MODEL_PREFIX_BASE}${RUN_TOKEN}-`;

let actorId: string;
let modelId: string;
let otherModelId: string;

/** 줄이 지워져도 감사 기록은 남으므로, 본 적 있는 id 를 따로 쥔다(뒷정리가 그것까지 걷는다). */
const auditIdsSeen: string[] = [];

function testPath(name: string): string {
  return `${PATH_PREFIX}${name}`;
}

async function createTestModel(suffix: string): Promise<string> {
  const [row] = await db
    .insert(productModels)
    .values({ modelName: `${MODEL_PREFIX}${suffix}`, kind: "MATCHER" })
    .returning({ id: productModels.id });
  return row.id;
}

before(async () => {
  const [user] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.approvalStatus, "APPROVED"), eq(users.isDeleted, false)))
    .limit(1);
  assert.ok(user, "expected at least one approved user in the test DB");
  actorId = user.id;

  modelId = await createTestModel("MAIN");
  otherModelId = await createTestModel("OTHER");
});

/** 이 파일이 만든 줄 · 모델과 그 줄들의 감사 기록만 지운다. */
async function cleanUp(): Promise<void> {
  const ours = await db
    .select({ id: productModelShareDocs.id })
    .from(productModelShareDocs)
    .where(like(productModelShareDocs.relativePath, `${PATH_PREFIX_BASE}%`));
  const ids = ours.map((row) => row.id);
  // 지운 줄의 감사 기록은 줄이 사라진 뒤에도 남는다 — 아래 auditIdsSeen 이 그것까지 쥔다.
  const targets = [...new Set([...ids, ...auditIdsSeen])];
  if (targets.length > 0) {
    await db
      .delete(auditLogs)
      .where(
        and(
          eq(auditLogs.targetEntity, PRODUCT_MODEL_SHARE_DOCS_AUDIT_ENTITY),
          inArray(auditLogs.targetRecordId, targets)
        )
      );
  }
  if (ids.length > 0) {
    await db.delete(productModelShareDocs).where(inArray(productModelShareDocs.id, ids));
  }
  // 남은 가리킴은 모델을 지울 때 cascade 가 함께 걷는다.
  await db.delete(productModels).where(like(productModels.modelName, `${MODEL_PREFIX_BASE}%`));
}

after(async () => {
  await cleanUp();
  await pgClient.end({ timeout: 5 });
});

async function addDoc(params: {
  productModelId?: string;
  relativePath: string;
  entryKind?: "FILE" | "FOLDER";
  label?: string | null;
}) {
  const result = await addProductModelShareDoc({
    productModelId: params.productModelId ?? modelId,
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
        eq(auditLogs.targetEntity, PRODUCT_MODEL_SHARE_DOCS_AUDIT_ENTITY),
        eq(auditLogs.targetRecordId, id)
      )
    );
}

async function rowById(id: string) {
  const [row] = await db
    .select({
      id: productModelShareDocs.id,
      productModelId: productModelShareDocs.productModelId,
      entryKind: productModelShareDocs.entryKind,
      relativePath: productModelShareDocs.relativePath,
      label: productModelShareDocs.label,
      displayOrder: productModelShareDocs.displayOrder,
      createdBy: productModelShareDocs.createdBy,
    })
    .from(productModelShareDocs)
    .where(eq(productModelShareDocs.id, id));
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

describe("제품 모델별 공유폴더 가리킴 — 담기 · 지우기", () => {
  test("담으면 줄이 생기고 🔴 CREATE 감사 로그가 함께 남는다 — 글자를 다듬지 않는다", async () => {
    // 🔴 공백이 두 칸인 이름 — 다듬어 담으면 **없는 폴더**가 된다.
    const relativePath = testPath("2.  인수시 서류/2. MB 인수시 체크시트.xlsx");
    const created = await addDoc({ relativePath, label: "인수시 체크시트" });
    assert.equal(created.ok, true, JSON.stringify(created));
    if (!created.ok) throw new Error("unreachable");

    const row = await rowById(created.id);
    assert.ok(row);
    assert.equal(row.productModelId, modelId);
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
      productModelId: modelId,
      entryKind: "FILE",
      relativePath,
      label: "인수시 체크시트",
    });
    assert.equal(audits[0].previousValue, null);
  });

  test("🔴 같은 모델에 **접어서 같은** 경로는 사람 말로 거절된다 — 줄도 감사도 늘지 않는다", async () => {
    const base = testPath("중복/MB 체크시트.xlsx");
    const first = await addDoc({ relativePath: base });
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
      const again = await addDoc({ relativePath });
      assert.equal(again.ok, false, `${relativePath} 가 두 번째로 담겼다`);
      if (again.ok) throw new Error("unreachable");
      assert.equal(again.code, "DUPLICATE");
      // 🔴 23505 가 사람에게 보이지 않는다.
      assert.ok(!/23505|duplicate key|unique/i.test(again.message), again.message);
      assert.match(again.message, /이미/);
    }

    const rows = await db
      .select({ id: productModelShareDocs.id })
      .from(productModelShareDocs)
      .where(
        and(
          eq(productModelShareDocs.productModelId, modelId),
          like(productModelShareDocs.relativePath, `${PATH_PREFIX}중복/%`)
        )
      );
    assert.equal(rows.length, 1, "접어서 같은 경로가 둘이 되었다");
  });

  test("🔴 모델이 다르면 같은 경로를 담을 수 있다 — 접는 식의 앞 칸이 모델이다", async () => {
    const relativePath = testPath("공용/작업 수순.pdf");
    const mine = await addDoc({ relativePath });
    const other = await addDoc({ productModelId: otherModelId, relativePath });
    assert.equal(mine.ok, true, JSON.stringify(mine));
    assert.equal(other.ok, true, JSON.stringify(other));
  });

  test("🔴 지우면 줄이 사라지고 PURGE 감사 로그에 **지워진 줄이 통째로** 남는다", async () => {
    const relativePath = testPath("지울것/인수시 서류");
    const created = await addDoc({
      relativePath,
      entryKind: "FOLDER",
      label: "인수시 서류 폴더",
    });
    assert.equal(created.ok, true, JSON.stringify(created));
    if (!created.ok) throw new Error("unreachable");

    const removed = await removeProductModelShareDoc({
      id: created.id,
      productModelId: modelId,
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
    assert.equal(previous.productModelId, modelId);
    assert.equal(previous.entryKind, "FOLDER");
    assert.equal(previous.relativePath, relativePath);
    assert.equal(previous.label, "인수시 서류 폴더");
    assert.equal(previous.displayOrder, null);
    assert.equal(previous.createdBy, actorId);
    assert.equal(typeof previous.createdAt, "string");

    // 🔴 **되살려 본다** — 감사 한 줄의 값만으로 같은 줄이 다시 선다.
    const reinserted = await addProductModelShareDoc({
      productModelId: previous.productModelId as string,
      entryKind: previous.entryKind as "FILE" | "FOLDER",
      relativePath: previous.relativePath as string,
      label: previous.label as string | null,
      actorUserId: previous.createdBy as string,
    });
    assert.equal(reinserted.ok, true, JSON.stringify(reinserted));
    if (!reinserted.ok) throw new Error("unreachable");
    auditIdsSeen.push(reinserted.id);
    const restored = await rowById(reinserted.id);
    assert.ok(restored);
    assert.equal(restored.relativePath, relativePath);
    assert.equal(restored.entryKind, "FOLDER");
    assert.equal(restored.label, "인수시 서류 폴더");
  });

  test("🔴 없는 id · 다른 모델의 id 로는 지워지지 않는다 — 감사 로그도 안 남는다", async () => {
    const relativePath = testPath("남의것/안 지워질 것.pdf");
    const created = await addDoc({ relativePath });
    assert.equal(created.ok, true, JSON.stringify(created));
    if (!created.ok) throw new Error("unreachable");

    // 모델이 어긋나면 **없는 것과 같이** 답한다.
    const wrongModel = await removeProductModelShareDoc({
      id: created.id,
      productModelId: otherModelId,
      actorUserId: actorId,
    });
    assert.equal(wrongModel.ok, false);
    if (wrongModel.ok) throw new Error("unreachable");
    assert.equal(wrongModel.code, "NOT_FOUND");
    assert.ok(await rowById(created.id), "다른 모델로 부른 삭제가 줄을 지웠다");

    const missingId = randomUUID();
    const missing = await removeProductModelShareDoc({
      id: missingId,
      productModelId: modelId,
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

  test("한 모델의 목록을 차례대로 읽는다 — display_order, created_at (NULL 은 뒤로)", async () => {
    const first = await addDoc({ relativePath: testPath("차례/1 먼저.pdf") });
    const second = await addDoc({ relativePath: testPath("차례/2 나중.pdf") });
    const ordered = await addDoc({ relativePath: testPath("차례/3 맨 앞으로.pdf") });
    assert.ok(first.ok && second.ok && ordered.ok);
    if (!first.ok || !second.ok || !ordered.ok) throw new Error("unreachable");

    // 차례를 정하는 화면은 다음 조각이라, 여기서는 칸을 직접 채워 조회의 ORDER BY 만 본다.
    await db
      .update(productModelShareDocs)
      .set({ displayOrder: 10 })
      .where(eq(productModelShareDocs.id, ordered.id));

    const listed = await listShareDocsForProductModel(modelId);
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
    // 다른 모델의 줄이 섞이지 않는다.
    const others = await listShareDocsForProductModel(otherModelId);
    assert.equal(
      others.some((item) => item.relativePath.startsWith(`${PATH_PREFIX}차례/`)),
      false
    );
    // UUID 모양이 아니면 빈 배열이다(DB 를 묻지 않는다).
    assert.deepEqual(await listShareDocsForProductModel("NOT-A-UUID"), []);
  });

  test("🔴 휴지통에 있는 모델은 **없는 것과 같다** — 담고 지우는 문이 거기서 닫힌다", async () => {
    const trashed = await createTestModel("TRASHED");
    assert.ok(await getShareDocProductModel(trashed), "살아 있는 모델이 안 열린다");

    await db
      .update(productModels)
      .set({ isDeleted: true, deletedAt: new Date(), deletedBy: actorId })
      .where(eq(productModels.id, trashed));

    assert.equal(await getShareDocProductModel(trashed), null, "휴지통에 든 모델이 열렸다");
    // 모양이 아예 아닌 값도 DB 를 묻지 않고 거절한다.
    assert.equal(await getShareDocProductModel("NOT-A-UUID"), null);
    assert.equal(await getShareDocProductModel(randomUUID()), null);
  });

  test("🔴 모델이 사라지면 가리킴도 함께 사라진다 — FK 의 ON DELETE CASCADE", async () => {
    const doomed = await createTestModel("CASCADE");
    const created = await addDoc({
      productModelId: doomed,
      relativePath: testPath("딸려갈것/도면.pdf"),
    });
    assert.equal(created.ok, true, JSON.stringify(created));
    if (!created.ok) throw new Error("unreachable");

    await db.delete(productModels).where(eq(productModels.id, doomed));

    assert.equal(await rowById(created.id), null, "모델이 지워졌는데 가리킴이 남았다");
    // 🔴 cascade 는 감사를 남기지 않는다 — 그래서 자동 정리(master-data-purge.ts)가
    //    모델을 지우기 **전에** 적는다. 그 시험은 product-models-trash 쪽에 있다.
    assert.deepEqual(
      (await auditRowsFor(created.id)).map((audit) => audit.actionType),
      ["CREATE"]
    );
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
        addProductModelShareDoc({
          productModelId: modelId,
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
      addProductModelShareDoc({
        productModelId: modelId,
        entryKind: "FILE",
        relativePath: testPath("빈 이름.pdf"),
        label: "   ",
        actorUserId: actorId,
      }),
      /label_not_blank/
    );
  });
});
