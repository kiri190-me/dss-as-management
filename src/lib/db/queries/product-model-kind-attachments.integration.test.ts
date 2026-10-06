import "../../../../scripts/load-env";

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, like } from "drizzle-orm";

import { db, pgClient } from "../connection";
import { attachments, productModels, users } from "../schema";
import {
  countAttachmentsByProductModelKind,
  listAttachmentsForProductModelKind,
  listTrashedAttachmentsForProductModelKind,
} from "./product-model-kind-attachments";
import { createAttachmentRecord } from "../mutations/attachments";
import { buildProductModelKindAttachmentStoredPath } from "@/lib/domain/attachment-path";
import { PRODUCT_MODEL_KIND_CODES, type ProductModelKind } from "@/lib/domain/product-model-kind";

/**
 * ============================================================================
 * 제품 종류 공통 서류함 — 실제 DB 에서 무엇이 나오고 무엇이 빠지는가
 * ============================================================================
 * 묻는 것은 넷이다(완료 기준 ②③④).
 *
 *  1. 🔴 **주인 넷 중 하나다** — 종류 서류를 만들면 repair_case_id ·
 *     product_model_id · quote_id 가 **전부 NULL** 이다. 그리고 그 셋 중 하나라도
 *     함께 채우면 DB 가 **거절한다**(attachments_kind_owner_alone CHECK). 값이
 *     그렇게 적히는 것과 반대가 막히는 것을 **둘 다** 본다.
 *  2. 🔴 **종류로 좁혀지는가** — 다른 종류의 서류도, 모델 하나에 붙은 첨부도
 *     섞이지 않는다.
 *  3. 🔴 **휴지통이 갈리는가** — 지운 것은 목록에서 빠지고 휴지통 조회에만
 *     나오며, **개수에도 안 들어간다**.
 *  4. 🔴 **개수가 맞는가** — 종류마다 따로 센다.
 *
 * ── 🔴 개수는 **차이**로 잰다 ────────────────────────────────────────────
 * countAttachmentsByProductModelKind 는 표 전체를 센다(종류 서류에는 격리할
 * 주인 행이 없다 — 주인이 enum 값이라 스위트마다 다른 종류를 쓸 수가 없다).
 * 그래서 절대값을 못 박지 않고 **이 스위트가 넣기 전후의 차이**를 본다. 절대값을
 * 적어 두면 개발 DB 에 서류가 한 장만 들어와도 깨진다.
 *
 * ── 격리 규약 ────────────────────────────────────────────────────────────
 * 접수 건을 하나도 만들지 않는다(종류 서류는 접수 건과 무관하다). 쓰는 이름
 * 공간은 product_models 의 접두사 "PMK-FILES-TEST-" 하나뿐이고, 그 모델은 「모델
 * 첨부와 섞이지 않는가」를 보는 데에만 쓴다. after() 가 이 스위트가 만든 첨부
 * 행을 id 로 먼저 지운 뒤 모델 행을 지운다.
 *
 * 🔴 **감사 로그는 지우지 않는다.** 한 시험(아래 createAttachmentRecord)이 실제
 * 통로와 같은 길로 행을 만들어 audit_logs 에 FILE_UPLOAD 를 남긴다 — 감사 기록은
 * 지우지 않는 것이 이 저장소의 규율이고, 그 줄은 시험 사용자의 것으로 남는다.
 *
 * 🔴 **디스크에는 아무것도 쓰지 않는다.** stored_path 는 실제 경로 규칙으로
 * 만들어 두되, 그 자리에 파일이 있어야 하는 것은 내려받기 라우트의 몫이다.
 * ============================================================================
 */

const TEST_PRODUCT_MODEL_PREFIX = "PMK-FILES-TEST-";

let uploaderId: string;
let uploaderName: string;
const createdAttachmentIds: string[] = [];

async function createTestProductModel(): Promise<string> {
  const [row] = await db
    .insert(productModels)
    .values({ modelName: `${TEST_PRODUCT_MODEL_PREFIX}${randomUUID().slice(0, 8)}` })
    .returning({ id: productModels.id });
  return row.id;
}

/** 종류 서류 행 하나를 **직접** 넣는다 — 조회를 검사하는 자리라 통로를 거치지 않는다. */
async function insertKindAttachment(params: {
  kind: ProductModelKind;
  originalFileName: string;
  extension?: string;
  mimeType?: string;
  trashed?: { deletedAt: Date; deletedBy: string | null; reason: string | null };
}): Promise<string> {
  const attachmentId = randomUUID().toLowerCase();
  const extension = params.extension ?? "pdf";

  await db.insert(attachments).values({
    id: attachmentId,
    productModelKind: params.kind,
    category: "CHECKLIST",
    originalFileName: params.originalFileName,
    storedPath: buildProductModelKindAttachmentStoredPath({
      kind: params.kind,
      attachmentId,
      extension,
    }),
    mimeType: params.mimeType ?? "application/pdf",
    fileSize: 2048,
    checksumSha256: "0".repeat(64),
    uploadedBy: uploaderId,
    ...(params.trashed
      ? {
          isDeleted: true,
          deletedAt: params.trashed.deletedAt,
          deletedBy: params.trashed.deletedBy,
          deleteReason: params.trashed.reason,
        }
      : {}),
  });

  createdAttachmentIds.push(attachmentId);
  return attachmentId;
}

before(async () => {
  const [uploader] = await db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(
      and(
        eq(users.role, "AS_ENGINEER"),
        eq(users.approvalStatus, "APPROVED"),
        eq(users.isDeleted, false),
        eq(users.isActive, true)
      )
    )
    .limit(1);
  assert.ok(uploader, "expected an approved AS_ENGINEER in the test DB");
  uploaderId = uploader.id;
  uploaderName = uploader.name;
});

after(async () => {
  if (createdAttachmentIds.length > 0) {
    await db.delete(attachments).where(inArray(attachments.id, createdAttachmentIds));
  }
  await db.delete(productModels).where(like(productModels.modelName, `${TEST_PRODUCT_MODEL_PREFIX}%`));
  await pgClient.end({ timeout: 5 });
});

describe("② 주인은 넷 중 하나다 — 나머지 셋은 NULL", () => {
  test("🔴 종류 서류를 통로와 같은 길로 만들면 다른 주인 칸이 전부 NULL 이다", async () => {
    const attachmentId = randomUUID().toLowerCase();
    const storedPath = buildProductModelKindAttachmentStoredPath({
      kind: "GENERATOR",
      attachmentId,
      extension: "pdf",
    });
    // 🔴 올리기 통로가 부르는 바로 그 함수다 — 갈래 하나를 넘기면 나머지 세 칸은
    // 이 함수가 NULL 로 정한다. 통로를 흉내 내지 않고 실제로 그 함수를 쓴다.
    const created = await createAttachmentRecord({
      id: attachmentId,
      owner: { kind: "PRODUCT_MODEL_KIND", productModelKind: "GENERATOR" },
      category: "CHECKLIST",
      originalFileName: "제너레이터 공통 점검표.pdf",
      storedPath,
      mimeType: "application/pdf",
      fileSize: 2048,
      checksumSha256: "0".repeat(64),
      description: null,
      originalModifiedAt: new Date("2026-05-01T00:00:00.000Z"),
      uploadedBy: uploaderId,
    });
    createdAttachmentIds.push(created.id);

    const [row] = await db
      .select({
        repairCaseId: attachments.repairCaseId,
        productModelId: attachments.productModelId,
        quoteId: attachments.quoteId,
        productModelKind: attachments.productModelKind,
        storedPath: attachments.storedPath,
        originalModifiedAt: attachments.originalModifiedAt,
      })
      .from(attachments)
      .where(eq(attachments.id, created.id));

    assert.equal(row.productModelKind, "GENERATOR");
    assert.equal(row.repairCaseId, null, "접수 건 칸이 비어 있어야 한다");
    assert.equal(row.productModelId, null, "제품 모델 칸이 비어 있어야 한다");
    assert.equal(row.quoteId, null, "견적서 칸이 비어 있어야 한다");
    // 경로의 종류 마디는 소문자다(리눅스 NAS).
    assert.equal(row.storedPath, `product-model-kinds/generator/${created.id}.pdf`);
    // 원본 수정일을 싣는 통로가 하나 늘었다 — 모델 통로와 같은 성격의 서류다.
    assert.ok(row.originalModifiedAt instanceof Date);
  });

  test("🔴 다른 주인 칸을 함께 채우면 DB 가 거절한다 — attachments_kind_owner_alone", async () => {
    const productModelId = await createTestProductModel();
    const attachmentId = randomUUID().toLowerCase();

    await assert.rejects(
      () =>
        db.insert(attachments).values({
          id: attachmentId,
          // 🔴 둘을 함께 채운다. 앱 코드로는 만들 수 없는 모양이지만(갈래 타입),
          // 마지막 방어선이 실제로 서 있는지 여기서 확인한다.
          productModelKind: "MATCHER",
          productModelId,
          category: "CHECKLIST",
          originalFileName: "섞인 주인.pdf",
          storedPath: `product-model-kinds/matcher/${attachmentId}.pdf`,
          mimeType: "application/pdf",
          fileSize: 1,
          checksumSha256: "0".repeat(64),
          uploadedBy: uploaderId,
        }),
      /attachments_kind_owner_alone/,
      "CHECK 가 막지 않는다"
    );
  });
});

describe("③ 목록 — 지워진 것은 안 보인다", () => {
  test("🔴 휴지통으로 보낸 서류는 목록에서 빠지고 휴지통 조회에만 나온다", async () => {
    const liveId = await insertKindAttachment({
      kind: "TOTAL_CONTROLLER",
      originalFileName: "남는다.pdf",
    });
    const trashedId = await insertKindAttachment({
      kind: "TOTAL_CONTROLLER",
      originalFileName: "지운다.pdf",
      trashed: { deletedAt: new Date(), deletedBy: uploaderId, reason: "잘못 올림" },
    });

    const live = await listAttachmentsForProductModelKind("TOTAL_CONTROLLER");
    const liveIds = live.map((item) => item.id);
    assert.ok(liveIds.includes(liveId), "살아 있는 서류가 목록에 없다");
    assert.ok(!liveIds.includes(trashedId), "🔴 지운 서류가 목록에 나온다");

    const trashed = await listTrashedAttachmentsForProductModelKind("TOTAL_CONTROLLER");
    const trashedIds = trashed.map((item) => item.id);
    assert.ok(trashedIds.includes(trashedId));
    assert.ok(!trashedIds.includes(liveId), "안 지워진 서류가 휴지통에 나온다");

    const trashedItem = trashed.find((item) => item.id === trashedId)!;
    assert.equal(trashedItem.deletedByName, uploaderName);
    assert.equal(trashedItem.deleteReason, "잘못 올림");
    assert.equal(typeof trashedItem.deletedAt, "string");
  });

  test("지운 사람을 알 수 없는 행도 휴지통에 남는다 — 아니면 되살릴 방법이 없다", async () => {
    const id = await insertKindAttachment({
      kind: "TOTAL_CONTROLLER",
      originalFileName: "지운사람모름.pdf",
      trashed: { deletedAt: new Date(), deletedBy: null, reason: null },
    });
    const trashed = await listTrashedAttachmentsForProductModelKind("TOTAL_CONTROLLER");
    const item = trashed.find((candidate) => candidate.id === id);
    assert.ok(item, "LEFT JOIN 이라 지운 사람이 없어도 빠지지 않아야 한다");
    assert.equal(item.deletedByName, null);
  });

  test("올린 사람 이름은 조인으로 채운다 — 행에는 UUID 만 있다", async () => {
    const id = await insertKindAttachment({ kind: "MATCHER", originalFileName: "이름확인.pdf" });
    const items = await listAttachmentsForProductModelKind("MATCHER");
    const item = items.find((candidate) => candidate.id === id)!;
    assert.equal(item.uploadedByName, uploaderName);
    assert.equal(item.category, "CHECKLIST");
    assert.equal(typeof item.uploadedAt, "string", "클라이언트로 넘기려고 ISO 문자열로 내린다");
  });

  test("셋 중 하나가 아닌 값으로 물으면 DB 를 읽지 않고 빈 목록이다", async () => {
    for (const bogus of ["", "generator", "제너레이터", "'; drop table attachments; --"]) {
      assert.deepEqual(await listAttachmentsForProductModelKind(bogus), [], bogus);
      assert.deepEqual(await listTrashedAttachmentsForProductModelKind(bogus), [], bogus);
    }
  });
});

describe("④ 종류별 개수 — 다른 종류 것이 안 섞인다", () => {
  test("🔴 넣은 종류만 그만큼 늘어난다", async () => {
    const before = await countAttachmentsByProductModelKind();

    await insertKindAttachment({ kind: "GENERATOR", originalFileName: "G1.pdf" });
    await insertKindAttachment({ kind: "GENERATOR", originalFileName: "G2.pdf" });
    await insertKindAttachment({ kind: "MATCHER", originalFileName: "M1.pdf" });
    // 휴지통 행은 세지 않는다 — 입구의 숫자와 서류함의 줄 수가 달라지면 안 된다.
    await insertKindAttachment({
      kind: "MATCHER",
      originalFileName: "M-지움.pdf",
      trashed: { deletedAt: new Date(), deletedBy: uploaderId, reason: null },
    });
    // 모델 하나에 붙은 첨부는 이 수에 섞이지 않는다 — 주인 칸이 다르다.
    const productModelId = await createTestProductModel();
    const modelAttachmentId = randomUUID().toLowerCase();
    await db.insert(attachments).values({
      id: modelAttachmentId,
      productModelId,
      category: "CHECKLIST",
      originalFileName: "모델전용.pdf",
      storedPath: `product-models/${productModelId}/${modelAttachmentId}.pdf`,
      mimeType: "application/pdf",
      fileSize: 1,
      checksumSha256: "0".repeat(64),
      uploadedBy: uploaderId,
    });
    createdAttachmentIds.push(modelAttachmentId);

    const after = await countAttachmentsByProductModelKind();
    assert.equal(after.GENERATOR - before.GENERATOR, 2);
    assert.equal(after.MATCHER - before.MATCHER, 1, "휴지통 행이 세어졌다");
    assert.equal(after.TOTAL_CONTROLLER - before.TOTAL_CONTROLLER, 0, "다른 종류가 늘었다");
  });

  test("키는 늘 종류 셋이다 — 한 건도 없는 종류도 0 으로 나온다", async () => {
    const counts = await countAttachmentsByProductModelKind();
    assert.deepEqual(Object.keys(counts).sort(), [...PRODUCT_MODEL_KIND_CODES].sort());
    for (const kind of PRODUCT_MODEL_KIND_CODES) {
      assert.equal(typeof counts[kind], "number", kind);
      assert.ok(Number.isInteger(counts[kind]) && counts[kind] >= 0, kind);
    }
  });

  test("세는 수와 목록의 줄 수가 같다 — 입구의 숫자가 서류함과 어긋나지 않는다", async () => {
    const counts = await countAttachmentsByProductModelKind();
    for (const kind of PRODUCT_MODEL_KIND_CODES) {
      const items = await listAttachmentsForProductModelKind(kind);
      assert.equal(items.length, counts[kind], `${kind} 의 수가 목록과 다르다`);
    }
  });
});
