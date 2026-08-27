import "../../../../scripts/load-env";

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, like } from "drizzle-orm";

import { db, pgClient } from "../connection";
import { attachments, productModels, users } from "../schema";
import {
  listAttachmentsForProductModel,
  listTrashedAttachmentsForProductModel,
} from "./attachments";
import { buildProductModelAttachmentStoredPath } from "@/lib/domain/attachment-path";

/**
 * ============================================================================
 * 제품 모델 첨부 목록 조회 — 무엇이 나오고 무엇이 빠지는가
 * ============================================================================
 * 모델 상세의 `사진·도면` 구역이 매번 쏘는 조회 둘을 실제 DB에 대고 확인한다.
 * 묻는 것은 넷이다.
 *
 *  1. **주인으로 좁혀지는가** — 다른 모델의 파일이 섞이지 않는다.
 *  2. **휴지통이 갈리는가** — 지운 것은 목록에서 빠지고 휴지통 조회에만 나온다
 *     (두 조회를 일부러 나눈 이유는 부분 인덱스다 — queries/attachments.ts 헤더).
 *  3. **올린 사람 이름이 조인으로 채워지는가** — 행에는 UUID만 있다.
 *  4. **지운 사람을 알 수 없는 행도 휴지통에 남는가** — 남지 않으면 되살릴
 *     방법이 없다. deleted_by 가 nullable 이라 LEFT JOIN 인 까닭이 이것이다.
 *
 * ── 격리 규약 ────────────────────────────────────────────────────────────
 * 이 스위트는 접수 건을 하나도 만들지 않는다(모델 첨부는 접수 건과 무관하다).
 * 그래서 접수 월 예약이 필요 없고, 쓰는 이름 공간은 product_models 의 접두사
 * "PM-FILES-TEST-" 하나뿐이다 — 다른 어떤 스위트도 쓰지 않는 값이다.
 * after() 가 이 스위트가 만든 첨부 행을 id 로 먼저 지운 뒤 모델 행을 지운다
 * (첨부가 남아 있으면 ON DELETE SET NULL 로 주인만 끊긴 채 표에 남는다).
 * 감사 로그는 건드리지 않는다 — 이 스위트는 애초에 audit_logs 에 쓰지 않는다
 * (조회만 검사하므로 첨부 행을 직접 INSERT 한다).
 * ============================================================================
 */

const TEST_PRODUCT_MODEL_PREFIX = "PM-FILES-TEST-";

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

/**
 * 모델 첨부 행 하나. 조회만 검사하므로 디스크에는 아무것도 쓰지 않는다 —
 * stored_path 는 실제 경로 규칙(buildProductModelAttachmentStoredPath)으로
 * 만들어 두되, 그 자리에 파일이 있어야 하는 것은 다운로드 라우트의 몫이다.
 */
async function insertModelAttachment(params: {
  productModelId: string;
  originalFileName: string;
  extension?: string;
  mimeType?: string;
  description?: string | null;
  trashed?: { deletedAt: Date; deletedBy: string | null; reason: string | null };
}): Promise<string> {
  const attachmentId = randomUUID().toLowerCase();
  const extension = params.extension ?? "jpg";

  await db.insert(attachments).values({
    id: attachmentId,
    productModelId: params.productModelId,
    category: "CIRCUIT_DIAGRAM",
    originalFileName: params.originalFileName,
    storedPath: buildProductModelAttachmentStoredPath({
      productModelId: params.productModelId,
      attachmentId,
      extension,
    }),
    mimeType: params.mimeType ?? "image/jpeg",
    fileSize: 1234,
    checksumSha256: "0".repeat(64),
    description: params.description ?? null,
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

describe("listAttachmentsForProductModel", () => {
  test("그 모델의 안 지워진 첨부만, 최근 것부터 나온다", async () => {
    const productModelId = await createTestProductModel();
    const otherModelId = await createTestProductModel();

    await insertModelAttachment({ productModelId, originalFileName: "먼저.jpg" });
    // uploaded_at 기본값이 now()라 같은 밀리초에 두 행이 들어가면 순서가 흔들린다.
    await new Promise((resolve) => setTimeout(resolve, 10));
    await insertModelAttachment({ productModelId, originalFileName: "나중.jpg" });
    await insertModelAttachment({
      productModelId: otherModelId,
      originalFileName: "남의모델.jpg",
    });

    const items = await listAttachmentsForProductModel(productModelId);
    assert.deepEqual(
      items.map((item) => item.originalFileName),
      ["나중.jpg", "먼저.jpg"],
      "최근 것부터, 다른 모델의 파일은 섞이지 않는다"
    );
    assert.equal(items[0].uploadedByName, uploaderName, "올린 사람 이름은 조인으로 채운다");
    assert.equal(items[0].malwareScanStatus, "NOT_SCANNED");
    assert.equal(items[0].category, "CIRCUIT_DIAGRAM");
    assert.equal(typeof items[0].uploadedAt, "string", "클라이언트로 넘기려고 ISO 문자열로 내린다");
  });

  test("휴지통으로 보낸 첨부는 목록에서 빠지고 휴지통 조회에만 나온다", async () => {
    const productModelId = await createTestProductModel();
    const liveId = await insertModelAttachment({ productModelId, originalFileName: "남는다.jpg" });
    const trashedId = await insertModelAttachment({
      productModelId,
      originalFileName: "지운다.jpg",
      trashed: { deletedAt: new Date(), deletedBy: uploaderId, reason: "잘못 올림" },
    });

    const live = await listAttachmentsForProductModel(productModelId);
    assert.deepEqual(
      live.map((item) => item.id),
      [liveId],
      "휴지통 행은 목록에서 빠진다"
    );

    const trashed = await listTrashedAttachmentsForProductModel(productModelId);
    assert.deepEqual(
      trashed.map((item) => item.id),
      [trashedId],
      "안 지워진 행은 휴지통에 나오지 않는다"
    );
    assert.equal(trashed[0].deletedByName, uploaderName);
    assert.equal(trashed[0].deleteReason, "잘못 올림");
    assert.equal(typeof trashed[0].deletedAt, "string");
  });

  test("설명은 그대로 실려 나온다 — 화면이 파일명 밑에 적는다", async () => {
    const productModelId = await createTestProductModel();
    await insertModelAttachment({
      productModelId,
      originalFileName: "회로도.pdf",
      extension: "pdf",
      mimeType: "application/pdf",
      description: "rev B",
    });

    const [item] = await listAttachmentsForProductModel(productModelId);
    assert.equal(item.description, "rev B");
    assert.equal(item.mimeType, "application/pdf");
  });

  test("첨부가 하나도 없는 모델은 빈 목록이다", async () => {
    const productModelId = await createTestProductModel();
    assert.deepEqual(await listAttachmentsForProductModel(productModelId), []);
    assert.deepEqual(await listTrashedAttachmentsForProductModel(productModelId), []);
  });

  test("UUID가 아닌 값으로 물으면 DB를 읽지 않고 빈 목록이다", async () => {
    assert.deepEqual(await listAttachmentsForProductModel("local-demo-1"), []);
    assert.deepEqual(await listAttachmentsForProductModel(""), []);
    assert.deepEqual(await listAttachmentsForProductModel("'; drop table attachments; --"), []);
    assert.deepEqual(await listTrashedAttachmentsForProductModel("local-demo-1"), []);
    assert.deepEqual(await listTrashedAttachmentsForProductModel("'; drop table attachments; --"), []);
  });
});

describe("listTrashedAttachmentsForProductModel", () => {
  test("지운 사람을 알 수 없는 행도 목록에 남는다 — 아니면 되살릴 방법이 없다", async () => {
    const productModelId = await createTestProductModel();
    await insertModelAttachment({
      productModelId,
      originalFileName: "지운사람모름.jpg",
      trashed: { deletedAt: new Date(), deletedBy: null, reason: null },
    });

    const trashed = await listTrashedAttachmentsForProductModel(productModelId);
    assert.equal(trashed.length, 1, "LEFT JOIN 이라 지운 사람이 없어도 빠지지 않는다");
    assert.equal(trashed[0].deletedByName, null);
    assert.equal(trashed[0].deleteReason, null);
  });

  test("최근에 지운 것부터 나온다", async () => {
    const productModelId = await createTestProductModel();
    const older = new Date(Date.now() - 60_000);
    const newer = new Date();

    await insertModelAttachment({
      productModelId,
      originalFileName: "먼저지움.jpg",
      trashed: { deletedAt: older, deletedBy: uploaderId, reason: null },
    });
    await insertModelAttachment({
      productModelId,
      originalFileName: "나중지움.jpg",
      trashed: { deletedAt: newer, deletedBy: uploaderId, reason: null },
    });

    const trashed = await listTrashedAttachmentsForProductModel(productModelId);
    assert.deepEqual(
      trashed.map((item) => item.originalFileName),
      ["나중지움.jpg", "먼저지움.jpg"]
    );
  });
});
