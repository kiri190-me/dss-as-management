import "../../../../scripts/load-env";

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { and, asc, eq, inArray, like } from "drizzle-orm";

import { db, pgClient } from "../connection";
import { attachments, auditLogs, improvementRequests, users } from "../schema";
import {
  ImprovementRequestAttachmentRejectedError,
  createAttachmentRecord,
  type CreateAttachmentRecordInput,
  type ImprovementRequestAttachmentRejectionCode,
} from "./attachments";
import {
  IMPROVEMENT_REQUEST_DELETED_ATTACHMENT_REASON,
  recordAttachmentDownload,
  restoreAttachment,
  softDeleteAttachment,
} from "./attachment-trash";
import {
  changeImprovementRequestStatus,
  createImprovementRequest,
  deleteImprovementRequest,
} from "./improvement-requests";
import { getAttachmentForDownload } from "../queries/attachment-download";
import { getImprovementRequestAttachmentTarget } from "../queries/attachments";
import { listImprovementRequests } from "../queries/improvement-requests";
import { MAX_ATTACHMENT_SIZE_BYTES } from "@/lib/domain/attachment-allowlist";
import type { AttachmentCategory } from "@/lib/domain/attachment-category";
import {
  buildImprovementRequestAttachmentPreviewPath,
  buildImprovementRequestAttachmentStoredPath,
  resolveAttachmentAbsolutePath,
} from "@/lib/domain/attachment-path";
import {
  decideAttachmentDownload,
  isAttachmentOwnerAccessAllowed,
} from "@/lib/domain/attachment-download-policy";
import {
  IMPROVEMENT_REQUEST_SCREENSHOT_FORBIDDEN_MESSAGE,
  IMPROVEMENT_REQUEST_SCREENSHOT_LIMIT_MESSAGE,
  IMPROVEMENT_REQUEST_SCREENSHOT_MAX_COUNT,
} from "@/lib/domain/improvement-request";
import { createLocalFileSystemStorageAdapter } from "@/lib/storage/local-fs-adapter";
import type { StorageAdapter } from "@/lib/storage/storage-adapter";

/**
 * ============================================================================
 * 개선 요청 스크린샷 — 올리기 · 5장 · 내려받기 · 지우기 · 글 삭제 · 목록 (S2)
 * ============================================================================
 * 확인하는 것:
 *  1. **올리기** — 행의 주인 칸(개선 요청만 차고 앞의 둘은 NULL) · 분류(SCREENSHOT) ·
 *     경로 모양(`improvement-requests/{글id}/{첨부id}.{확장자}`) · FILE_UPLOAD 감사의 주인.
 *  2. **누가** — 남의 글 · 진행중인 자기 글은 FORBIDDEN, 관리 권한은 남의 글에도.
 *  3. **5장** — 6장째는 LIMIT_REACHED(사람이 읽는 문구). 🔴 **동시에 여러 장을 올려도
 *     5장을 넘지 않는다** — 글 행을 잠근 같은 트랜잭션에서 세기 때문이다.
 *  4. **내려받기** — 조회가 셋째 주인을 싣고, 판정이 통과시키고, 보기 권한
 *     (improvementRequests READ)이 없으면 주인별 판정이 거짓(라우트는 404).
 *  5. **지우기 · 되살리기** — 올리기와 같은 판정. 되살리기는 5장을 다시 센다.
 *  6. **글을 지우면** — 살아 있는 스크린샷이 같은 트랜잭션에서 첨부 휴지통으로(네 칸 ·
 *     FILE_DELETE), PURGE 스냅숏에 그 id 목록, 디스크 실물은 그대로. 낡은 version 이면
 *     스크린샷도 그대로.
 *  7. **다른 주인에 스크린샷 분류** — 마지막 방어선(createAttachmentRecord)이 거절한다.
 *  8. **목록** — 글마다 살아 있는 스크린샷을 올린 차례대로.
 *
 * ── 라우트를 직접 부르지 않는다 ─────────────────────────────────────────
 * 올리기 · 내려받기 · 미리보기 라우트는 세션(next/headers 의 쿠키)을 읽어야 해서 이
 * 저장소의 시험은 라우트를 부르지 않는다(auth 라우트 둘만 예외). 대신 **라우트가
 * 부르는 함수를 그대로** 부른다 — 판정(isAttachmentOwnerAccessAllowed ·
 * decideAttachmentDownload)은 라우트와 같은 함수이고, 저장(createAttachmentRecord ·
 * softDeleteAttachment)은 라우트 · 액션이 계산해 넘기는 `canManage` 를 직접 넘긴다.
 * 역할 · 관리자 설정은 여기서 시험하지 않는다(개선 요청 통합 시험과 같은 나눔).
 * 라우트의 400(다른 주인의 스크린샷 분류)은 같은 순수 함수
 * (isAttachmentCategoryAllowedForOwner)를 단위 시험이 못박는다.
 *
 * ── 디스크는 임시 폴더에 쓴다 ────────────────────────────────────────────
 * 실제 저장 루트(UPLOADS_DIR)를 건드리지 않는다. 어댑터를 임시 루트로 직접 만들어
 * after()에서 폴더째 지운다. 대부분의 시험은 행만 본다 — createAttachmentRecord 는
 * 파일을 쓰지 않고 경로의 모양만 본다(mutations/attachments.ts 헤더).
 *
 * ── 격리 규약 ────────────────────────────────────────────────────────────
 * 이 스위트가 만드는 글은 본문이 "IR-SHOT-TEST-" 로 시작한다(개선 요청 통합 시험의
 * "IR-TEST-" 와 겹치지 않는다 — 그쪽 after() 가 이쪽 글을 지우지 않게). after() 는
 * 이 스위트가 만든 첨부 행을 id 로 먼저 지운 뒤 글 행을 지운다. 감사 로그는 지우지
 * 않는다 — append-only 이고, 첨부 시험들과 같은 규칙이다.
 * ============================================================================
 */

const BODY_PREFIX = "IR-SHOT-TEST-";
const MENU_KEY = "repairCases";

/** PNG 앞머리 — 내용 대조를 흉내 낼 필요는 없지만 실제 파일에 그럴듯한 바이트를 둔다. */
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

let authorId: string;
let otherUserId: string;
let storageRoot: string;
let storage: StorageAdapter;
const touchedRequestIds = new Set<string>();
const createdAttachmentIds: string[] = [];

type RequestRef = { id: string; version: number };

async function createRequest(label: string): Promise<RequestRef> {
  const result = await createImprovementRequest({
    body: `${BODY_PREFIX}${label}`,
    menuKey: MENU_KEY,
    actorUserId: authorId,
  });
  assert.equal(result.ok, true, `setup create failed: ${JSON.stringify(result)}`);
  if (!result.ok) throw new Error("unreachable");
  touchedRequestIds.add(result.id);
  return { id: result.id, version: result.version };
}

async function moveToInProgress(target: RequestRef): Promise<RequestRef> {
  const result = await changeImprovementRequestStatus({
    id: target.id,
    expectedVersion: target.version,
    to: "IN_PROGRESS",
    actorUserId: otherUserId,
    canManage: true,
  });
  assert.equal(result.ok, true, `setup move failed: ${JSON.stringify(result)}`);
  if (!result.ok) throw new Error("unreachable");
  return { id: result.id, version: result.version };
}

/** 스크린샷 한 장의 입력. 파일은 쓰지 않는다 — 경로 모양만 규칙대로 만든다. */
function screenshotInput(
  improvementRequestId: string,
  options: { actorUserId?: string; canManage?: boolean; fileName?: string; category?: AttachmentCategory } = {}
): CreateAttachmentRecordInput {
  const attachmentId = randomUUID().toLowerCase();
  createdAttachmentIds.push(attachmentId);
  return {
    id: attachmentId,
    owner: {
      kind: "IMPROVEMENT_REQUEST",
      improvementRequestId,
      canManage: options.canManage ?? false,
    },
    category: options.category ?? "SCREENSHOT",
    originalFileName: options.fileName ?? "화면.png",
    storedPath: buildImprovementRequestAttachmentStoredPath({ improvementRequestId, attachmentId, extension: "png" }),
    mimeType: "image/png",
    fileSize: PNG_BYTES.byteLength,
    checksumSha256: "0".repeat(64),
    description: null,
    uploadedBy: options.actorUserId ?? authorId,
  };
}

async function addScreenshot(
  improvementRequestId: string,
  options: Parameters<typeof screenshotInput>[1] = {}
): Promise<string> {
  const created = await createAttachmentRecord(screenshotInput(improvementRequestId, options));
  return created.id;
}

async function expectRejected(
  run: () => Promise<unknown>,
  code: ImprovementRequestAttachmentRejectionCode
): Promise<void> {
  await assert.rejects(run, (error: unknown) => {
    assert.ok(error instanceof ImprovementRequestAttachmentRejectedError, `다른 오류로 실패했다: ${String(error)}`);
    assert.equal(error.code, code);
    return true;
  });
}

async function liveCount(improvementRequestId: string): Promise<number> {
  const rows = await db
    .select({ id: attachments.id })
    .from(attachments)
    .where(and(eq(attachments.improvementRequestId, improvementRequestId), eq(attachments.isDeleted, false)));
  return rows.length;
}

async function readAttachment(attachmentId: string) {
  const [row] = await db.select().from(attachments).where(eq(attachments.id, attachmentId));
  return row;
}

async function attachmentAudits(attachmentId: string, actionType: "FILE_UPLOAD" | "FILE_DELETE" | "FILE_DOWNLOAD" | "RESTORE") {
  return db
    .select({ actorUserId: auditLogs.actorUserId, previousValue: auditLogs.previousValue, newValue: auditLogs.newValue })
    .from(auditLogs)
    .where(
      and(
        eq(auditLogs.targetEntity, "attachments"),
        eq(auditLogs.targetRecordId, attachmentId),
        eq(auditLogs.actionType, actionType)
      )
    );
}

async function existsOnDisk(absolutePath: string): Promise<boolean> {
  try {
    return (await stat(absolutePath)).isFile();
  } catch {
    return false;
  }
}

function streamOf(bytes: Uint8Array): ReadableStream<Uint8Array> {
  let sent = false;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent) {
        controller.close();
        return;
      }
      controller.enqueue(bytes);
      sent = true;
    },
  });
}

before(async () => {
  const [engineer] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.role, "AS_ENGINEER"), eq(users.approvalStatus, "APPROVED"), eq(users.isDeleted, false)))
    .limit(1);
  assert.ok(engineer, "expected at least one approved AS_ENGINEER in the test DB");
  authorId = engineer.id;

  const [superAdmin] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.role, "SUPER_ADMIN"), eq(users.approvalStatus, "APPROVED"), eq(users.isDeleted, false)))
    .limit(1);
  assert.ok(superAdmin, "expected an approved SUPER_ADMIN in the test DB");
  assert.notEqual(superAdmin.id, authorId, "두 계정은 서로 달라야 한다");
  otherUserId = superAdmin.id;

  storageRoot = await mkdtemp(path.join(tmpdir(), "dss-ir-shot-test-"));
  storage = createLocalFileSystemStorageAdapter(storageRoot);
});

after(async () => {
  if (createdAttachmentIds.length > 0) {
    await db.delete(attachments).where(inArray(attachments.id, createdAttachmentIds));
  }
  const leftovers = await db
    .select({ id: improvementRequests.id })
    .from(improvementRequests)
    .where(like(improvementRequests.body, `${BODY_PREFIX}%`));
  const requestIds = [...new Set([...touchedRequestIds, ...leftovers.map((row) => row.id)])];
  if (requestIds.length > 0) {
    await db.delete(improvementRequests).where(inArray(improvementRequests.id, requestIds));
  }
  if (storageRoot) {
    await rm(storageRoot, { recursive: true, force: true });
  }
  await pgClient.end({ timeout: 5 });
});

// ─────────────────────────────────────────────────── 1 · 2. 올리기와 누가

describe("올리기 — 개선 요청이 주인인 첨부", () => {
  test("글쓴이가 접수 상태인 자기 글에 올리면 주인 칸 · 분류 · 경로 모양이 맞고 FILE_UPLOAD 감사가 남는다", async () => {
    const request = await createRequest("올리기 성공");

    // 라우트와 같은 순서 — 임시 저장 → 최종 자리 → 그 다음에 행.
    const written = await storage.writeTemp(streamOf(PNG_BYTES), { maxBytes: MAX_ATTACHMENT_SIZE_BYTES });
    const input = screenshotInput(request.id, { fileName: "로그인 화면.png" });
    await storage.commit(written.tempPath, input.storedPath);
    const created = await createAttachmentRecord({ ...input, fileSize: written.size, checksumSha256: written.sha256 });

    const row = await readAttachment(created.id);
    assert.equal(row.improvementRequestId, request.id);
    // 🔴 주인이 아닌 두 칸은 NULL — 여기에 값이 들어가면 사는 폴더가 정해지지 않는다.
    assert.equal(row.repairCaseId, null);
    assert.equal(row.productModelId, null);
    assert.equal(row.category, "SCREENSHOT");
    assert.equal(row.storedPath, `improvement-requests/${request.id}/${created.id}.png`);
    assert.equal(row.storedPath, row.storedPath.toLowerCase());
    assert.equal(row.mimeType, "image/png");
    assert.equal(row.checksumSha256, written.sha256);
    assert.equal(row.isDeleted, false);
    assert.equal(
      await existsOnDisk(resolveAttachmentAbsolutePath(storageRoot, row.storedPath)),
      true,
      "최종 자리에 실제 파일이 있어야 한다"
    );

    const audits = await attachmentAudits(created.id, "FILE_UPLOAD");
    assert.equal(audits.length, 1);
    const newValue = audits[0].newValue as Record<string, unknown>;
    assert.equal(newValue.ownerType, "IMPROVEMENT_REQUEST");
    assert.equal(newValue.improvementRequestId, request.id);
    assert.equal("repairCaseId" in newValue, false, "주인이 아닌 쪽 키는 싣지 않는다");
    assert.equal("productModelId" in newValue, false);
    assert.equal(newValue.category, "SCREENSHOT");
    assert.equal(audits[0].actorUserId, authorId);
  });

  test("남의 글에는 관리 권한 없이 올릴 수 없다 — FORBIDDEN, 행도 감사도 남지 않는다", async () => {
    const request = await createRequest("남의 글");
    const input = screenshotInput(request.id, { actorUserId: otherUserId, canManage: false });

    await assert.rejects(
      () => createAttachmentRecord(input),
      (error: unknown) => {
        assert.ok(error instanceof ImprovementRequestAttachmentRejectedError);
        assert.equal(error.code, "FORBIDDEN");
        assert.equal(error.message, IMPROVEMENT_REQUEST_SCREENSHOT_FORBIDDEN_MESSAGE);
        return true;
      }
    );
    assert.equal(await readAttachment(input.id), undefined, "거절된 시도는 행을 남기지 않는다");
    assert.equal((await attachmentAudits(input.id, "FILE_UPLOAD")).length, 0);
  });

  test("진행중인 자기 글에도 올릴 수 없다 — 맡은 사람이 움직이기 시작한 글이다", async () => {
    const request = await moveToInProgress(await createRequest("진행중인 내 글"));
    await expectRejected(() => addScreenshot(request.id, { actorUserId: authorId, canManage: false }), "FORBIDDEN");
    assert.equal(await liveCount(request.id), 0);
  });

  test("관리 권한이 있으면 남의 글 · 진행중인 글에도 올린다", async () => {
    const request = await moveToInProgress(await createRequest("관리자가 붙이는 글"));
    const id = await addScreenshot(request.id, { actorUserId: otherUserId, canManage: true });
    assert.equal((await readAttachment(id)).uploadedBy, otherUserId);
    assert.equal(await liveCount(request.id), 1);
  });

  test("없는 글이면 NOT_FOUND — 행을 넣기 전에 잠금에서 걸린다", async () => {
    await expectRejected(() => addScreenshot(randomUUID().toLowerCase(), { canManage: true }), "NOT_FOUND");
  });
});

// ─────────────────────────────────────────────────── 3. 5장

describe("5장 상한", () => {
  test("5장까지 들어가고 6장째는 LIMIT_REACHED — 사람이 읽는 문구와 함께", async () => {
    const request = await createRequest("다섯 장");
    for (let index = 0; index < IMPROVEMENT_REQUEST_SCREENSHOT_MAX_COUNT; index += 1) {
      await addScreenshot(request.id);
    }
    const sixth = screenshotInput(request.id);
    await assert.rejects(
      () => createAttachmentRecord(sixth),
      (error: unknown) => {
        assert.ok(error instanceof ImprovementRequestAttachmentRejectedError);
        assert.equal(error.code, "LIMIT_REACHED");
        assert.equal(error.message, "스크린샷은 한 글에 5장까지 붙일 수 있습니다.");
        assert.equal(error.message, IMPROVEMENT_REQUEST_SCREENSHOT_LIMIT_MESSAGE);
        return true;
      }
    );
    assert.equal(await liveCount(request.id), 5);
    assert.equal(await readAttachment(sixth.id), undefined);
  });

  test("관리 권한이 있어도 5장은 5장이다", async () => {
    const request = await createRequest("관리자도 다섯 장");
    for (let index = 0; index < 5; index += 1) {
      await addScreenshot(request.id, { actorUserId: otherUserId, canManage: true });
    }
    await expectRejected(() => addScreenshot(request.id, { actorUserId: otherUserId, canManage: true }), "LIMIT_REACHED");
  });

  test("휴지통에 있는 것은 세지 않는다 — 한 장을 지우면 한 장이 다시 들어간다", async () => {
    const request = await createRequest("지우고 다시");
    const ids: string[] = [];
    for (let index = 0; index < 5; index += 1) ids.push(await addScreenshot(request.id));

    const removed = await softDeleteAttachment({ attachmentId: ids[0], actorUserId: authorId, reason: null });
    assert.equal(removed.ok, true, JSON.stringify(removed));
    await addScreenshot(request.id);
    assert.equal(await liveCount(request.id), 5);
  });

  test("🔴 동시에 여러 장을 올려도 5장을 넘지 않는다 — 글 행을 잠근 트랜잭션에서 센다", async () => {
    const request = await createRequest("동시에 여덟 장");
    const inputs = Array.from({ length: 8 }, (_, index) => screenshotInput(request.id, { fileName: `동시-${index}.png` }));

    const results = await Promise.allSettled(inputs.map((input) => createAttachmentRecord(input)));

    const fulfilled = results.filter((result) => result.status === "fulfilled");
    const rejected = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
    assert.equal(fulfilled.length, 5, "정확히 다섯 장만 들어가야 한다");
    assert.equal(rejected.length, 3);
    for (const failure of rejected) {
      assert.ok(failure.reason instanceof ImprovementRequestAttachmentRejectedError, String(failure.reason));
      assert.equal(failure.reason.code, "LIMIT_REACHED");
    }
    assert.equal(await liveCount(request.id), 5, "DB 에도 다섯 장뿐이다");
  });

  test("올리기 통로의 빠른 거절 — 대상 조회가 상태 · 글쓴이 · 살아 있는 첨부 수를 준다", async () => {
    const request = await createRequest("빠른 거절");
    const first = await addScreenshot(request.id);
    await addScreenshot(request.id);
    await softDeleteAttachment({ attachmentId: first, actorUserId: authorId, reason: null });

    const target = await getImprovementRequestAttachmentTarget(request.id);
    assert.ok(target);
    assert.equal(target.id, request.id);
    assert.equal(target.status, "OPEN");
    assert.equal(target.createdBy, authorId);
    assert.equal(target.liveAttachmentCount, 1, "휴지통의 것은 세지 않는다");

    assert.equal(await getImprovementRequestAttachmentTarget(randomUUID()), null);
    assert.equal(await getImprovementRequestAttachmentTarget("not-a-uuid"), null);
  });
});

// ─────────────────────────────────────────────────── 7. 분류와 주인의 짝

describe("분류와 주인의 짝 — 마지막 방어선", () => {
  test("접수 건 · 제품 모델에 스크린샷 분류, 개선 요청에 다른 분류는 행을 넣기 전에 거절한다", async () => {
    // 통로(라우트)가 먼저 400 으로 거절한다. 여기는 통로를 거치지 않은 호출이다.
    // 분류 판정이 DB 보다 앞이라 주인 행이 실재할 필요도 없다 — 그래서 거절 이유가
    // FK 가 아니라 분류라는 것이 문구로 드러난다.
    const request = await createRequest("다른 분류");
    const attempts: CreateAttachmentRecordInput[] = [
      {
        ...screenshotInput(request.id),
        owner: { kind: "REPAIR_CASE", repairCaseId: randomUUID().toLowerCase() },
      },
      {
        ...screenshotInput(request.id),
        owner: { kind: "PRODUCT_MODEL", productModelId: randomUUID().toLowerCase() },
      },
      screenshotInput(request.id, { category: "INTAKE_PHOTO" }),
    ];
    for (const attempt of attempts) {
      await assert.rejects(() => createAttachmentRecord(attempt), /분류는 이 주인/, attempt.owner.kind);
      assert.equal(await readAttachment(attempt.id), undefined);
    }
  });
});

// ─────────────────────────────────────────────────── 4. 내려받기

describe("내려받기 — 조회 · 판정 · 보기 권한", () => {
  test("조회가 개선 요청 주인을 싣고 판정이 통과시킨다. 휴지통에 들어가면 DELETED", async () => {
    const request = await createRequest("내려받기");
    const id = await addScreenshot(request.id);

    const found = await getAttachmentForDownload(id);
    assert.ok(found);
    assert.equal(found.improvementRequestId, request.id);
    assert.equal(found.repairCaseId, null);
    assert.equal(found.productModelId, null);
    assert.equal(decideAttachmentDownload(found).allowed, true, "개선 요청 주인은 주인 없음(DETACHED)이 아니다");

    await softDeleteAttachment({ attachmentId: id, actorUserId: authorId, reason: null });
    const trashed = await getAttachmentForDownload(id);
    assert.ok(trashed);
    const decision = decideAttachmentDownload(trashed);
    assert.equal(decision.allowed === false && decision.reason, "DELETED");
  });

  test("보기 권한 — improvementRequests READ 가 있으면 열리고, 없으면 다른 두 권한이 있어도 주인별 판정이 거짓(라우트는 404)", async () => {
    const request = await createRequest("보기 권한");
    const found = await getAttachmentForDownload(await addScreenshot(request.id));
    assert.ok(found);

    // 라우트가 hasPermission 으로 채우는 그 모양을 그대로 넘긴다.
    assert.equal(
      isAttachmentOwnerAccessAllowed(found, {
        REPAIR_CASE: false,
        PRODUCT_MODEL: false,
        IMPROVEMENT_REQUEST: true,
        QUOTE: false,
      }),
      true
    );
    assert.equal(
      isAttachmentOwnerAccessAllowed(found, {
        REPAIR_CASE: true,
        PRODUCT_MODEL: true,
        IMPROVEMENT_REQUEST: false,
        // 넷째 주인(2026-09-15 Q2)의 권한으로도 열리지 않는다.
        QUOTE: true,
      }),
      false,
      "🔴 접수 건 파일 권한으로 스크린샷이 열리면 안 된다"
    );
  });

  test("내려받기 기록에 개선 요청 주인이 적힌다", async () => {
    const request = await createRequest("내려받기 기록");
    const found = await getAttachmentForDownload(await addScreenshot(request.id));
    assert.ok(found);

    await recordAttachmentDownload({
      attachmentId: found.id,
      actorUserId: otherUserId,
      owner: {
        repairCaseId: found.repairCaseId,
        productModelId: found.productModelId,
        improvementRequestId: found.improvementRequestId,
        quoteId: found.quoteId,
      },
      originalFileName: found.originalFileName,
      fileSize: found.fileSize,
    });

    const [audit] = await attachmentAudits(found.id, "FILE_DOWNLOAD");
    const newValue = audit.newValue as Record<string, unknown>;
    assert.equal(newValue.ownerType, "IMPROVEMENT_REQUEST");
    assert.equal(newValue.improvementRequestId, request.id);
    assert.equal("repairCaseId" in newValue, false);
  });
});

// ─────────────────────────────────────────────────── 5. 지우기 · 되살리기

describe("지우기 · 되살리기 — 올리기와 같은 판정", () => {
  test("글쓴이는 접수 상태인 자기 글의 스크린샷을 지운다 — FILE_DELETE 에 개선 요청 주인", async () => {
    const request = await createRequest("내 스크린샷 지우기");
    const id = await addScreenshot(request.id);

    const result = await softDeleteAttachment({ attachmentId: id, actorUserId: authorId, reason: "잘못 붙임" });
    assert.equal(result.ok, true, JSON.stringify(result));

    const row = await readAttachment(id);
    assert.equal(row.isDeleted, true);
    assert.equal(row.deletedBy, authorId);
    assert.equal(row.deleteReason, "잘못 붙임");
    const [audit] = await attachmentAudits(id, "FILE_DELETE");
    const newValue = audit.newValue as Record<string, unknown>;
    assert.equal(newValue.ownerType, "IMPROVEMENT_REQUEST");
    assert.equal(newValue.improvementRequestId, request.id);
    assert.equal(newValue.storedFileRetained, true);
  });

  test("남의 글 스크린샷은 관리 권한 없이 못 지운다 — FORBIDDEN 이고 표시도 감사도 그대로. 관리 권한이면 지운다", async () => {
    const request = await createRequest("남이 지우려는 스크린샷");
    const id = await addScreenshot(request.id);

    const refused = await softDeleteAttachment({
      attachmentId: id,
      actorUserId: otherUserId,
      reason: null,
      canManageImprovementRequests: false,
    });
    assert.equal(refused.ok, false);
    assert.equal(refused.ok === false && refused.code, "FORBIDDEN");
    assert.equal(refused.ok === false && refused.message, IMPROVEMENT_REQUEST_SCREENSHOT_FORBIDDEN_MESSAGE);
    assert.equal((await readAttachment(id)).isDeleted, false);
    assert.equal((await attachmentAudits(id, "FILE_DELETE")).length, 0);

    const allowed = await softDeleteAttachment({
      attachmentId: id,
      actorUserId: otherUserId,
      reason: null,
      canManageImprovementRequests: true,
    });
    assert.equal(allowed.ok, true, JSON.stringify(allowed));
  });

  test("진행중인 자기 글의 스크린샷도 못 지운다 — 관리 권한을 생략하면 거짓이다(닫히는 쪽)", async () => {
    const created = await createRequest("진행중 글의 스크린샷");
    const id = await addScreenshot(created.id);
    await moveToInProgress(created);

    // canManageImprovementRequests 를 넘기지 않는다 — 기존 호출 모양 그대로다.
    const result = await softDeleteAttachment({ attachmentId: id, actorUserId: authorId, reason: null });
    assert.equal(result.ok === false && result.code, "FORBIDDEN");
    assert.equal((await readAttachment(id)).isDeleted, false);
  });

  test("되살리기는 5장을 다시 센다 — 지우고 새로 올린 뒤 되살리면 여섯 장이 되지 않는다", async () => {
    const request = await createRequest("되살리기 상한");
    const ids: string[] = [];
    for (let index = 0; index < 5; index += 1) ids.push(await addScreenshot(request.id));

    await softDeleteAttachment({ attachmentId: ids[0], actorUserId: authorId, reason: null });
    await addScreenshot(request.id); // 다시 다섯 장

    const refused = await restoreAttachment({ attachmentId: ids[0], actorUserId: authorId });
    assert.equal(refused.ok === false && refused.code, "LIMIT_REACHED");
    assert.equal(refused.ok === false && refused.message, IMPROVEMENT_REQUEST_SCREENSHOT_LIMIT_MESSAGE);
    assert.equal((await readAttachment(ids[0])).isDeleted, true, "거절된 되살리기는 표시를 바꾸지 않는다");
    assert.equal(await liveCount(request.id), 5);

    // 대조 — 한 장을 더 지우면 자리가 나서 되살아난다(막힌 이유가 상한이었다).
    await softDeleteAttachment({ attachmentId: ids[1], actorUserId: authorId, reason: null });
    const restored = await restoreAttachment({ attachmentId: ids[0], actorUserId: authorId });
    assert.equal(restored.ok, true, JSON.stringify(restored));
    const [audit] = await attachmentAudits(ids[0], "RESTORE");
    assert.equal((audit.newValue as Record<string, unknown>).ownerType, "IMPROVEMENT_REQUEST");
  });

  test("남의 글 스크린샷은 관리 권한 없이 되살릴 수도 없다", async () => {
    const request = await createRequest("남이 되살리려는 스크린샷");
    const id = await addScreenshot(request.id);
    await softDeleteAttachment({ attachmentId: id, actorUserId: authorId, reason: null });

    const refused = await restoreAttachment({ attachmentId: id, actorUserId: otherUserId, canManageImprovementRequests: false });
    assert.equal(refused.ok === false && refused.code, "FORBIDDEN");
    assert.equal((await readAttachment(id)).isDeleted, true);
  });
});

// ─────────────────────────────────────────────────── 6. 글을 지우면

describe("글을 지우면 — 스크린샷은 같은 트랜잭션에서 첨부 휴지통으로", () => {
  test("살아 있는 스크린샷이 휴지통으로 가고 PURGE 스냅숏에 그 id 가 올린 차례로 남는다. 디스크 실물은 그대로다", async () => {
    const request = await createRequest("지울 글과 스크린샷");

    // 한 장은 실제 파일까지 놓는다 — 휴지통으로 가도 실물이 남는지 본다.
    const written = await storage.writeTemp(streamOf(PNG_BYTES), { maxBytes: MAX_ATTACHMENT_SIZE_BYTES });
    const firstInput = screenshotInput(request.id);
    await storage.commit(written.tempPath, firstInput.storedPath);
    const first = (await createAttachmentRecord(firstInput)).id;
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = await addScreenshot(request.id);
    // 이미 휴지통에 있던 한 장 — 이번 삭제의 목록에 끼지 않고, 제 기록도 그대로여야 한다.
    const alreadyTrashed = await addScreenshot(request.id);
    await softDeleteAttachment({ attachmentId: alreadyTrashed, actorUserId: authorId, reason: "먼저 지움" });

    const result = await deleteImprovementRequest({
      id: request.id,
      expectedVersion: request.version,
      actorUserId: authorId,
      canManage: false,
    });
    assert.equal(result.ok, true, JSON.stringify(result));

    const rows = await db
      .select()
      .from(attachments)
      .where(inArray(attachments.id, [first, second, alreadyTrashed]))
      .orderBy(asc(attachments.uploadedAt));
    const byId = new Map(rows.map((row) => [row.id, row]));

    for (const id of [first, second]) {
      const row = byId.get(id);
      assert.ok(row);
      assert.equal(row.isDeleted, true, "살아 있던 스크린샷은 휴지통으로 간다");
      assert.equal(row.deletedBy, authorId);
      assert.ok(row.deletedAt);
      assert.equal(row.deleteReason, IMPROVEMENT_REQUEST_DELETED_ATTACHMENT_REASON);
      // 글 행이 지워져 FK(ON DELETE SET NULL)가 주인 칸을 비웠다.
      assert.equal(row.improvementRequestId, null);

      const audits = await attachmentAudits(id, "FILE_DELETE");
      assert.equal(audits.length, 1, "첨부마다 FILE_DELETE 한 줄");
      const newValue = audits[0].newValue as Record<string, unknown>;
      // 주인 칸은 비었지만 무엇에 붙어 있던 파일인지는 감사가 안다.
      assert.equal(newValue.ownerType, "IMPROVEMENT_REQUEST");
      assert.equal(newValue.improvementRequestId, request.id);
      assert.equal(newValue.storedFileRetained, true);
    }
    assert.equal(
      byId.get(first)?.deletedAt?.getTime(),
      byId.get(second)?.deletedAt?.getTime(),
      "한 번의 삭제로 함께 갔다"
    );

    const untouched = byId.get(alreadyTrashed);
    assert.ok(untouched);
    assert.equal(untouched.deleteReason, "먼저 지움", "이미 휴지통에 있던 것의 기록은 덮어쓰지 않는다");
    assert.equal((await attachmentAudits(alreadyTrashed, "FILE_DELETE")).length, 1);

    const [purge] = await db
      .select({ previousValue: auditLogs.previousValue })
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.targetEntity, "improvement_requests"),
          eq(auditLogs.targetRecordId, request.id),
          eq(auditLogs.actionType, "PURGE")
        )
      );
    assert.ok(purge, "PURGE 감사가 남아야 한다");
    const snapshot = purge.previousValue as Record<string, unknown>;
    assert.deepEqual(snapshot.trashedAttachmentIds, [first, second], "올린 차례대로, 이미 휴지통에 있던 것은 빼고");
    assert.equal(JSON.stringify(snapshot).includes(".png"), false, "파일 이름 · 경로는 싣지 않는다");

    // ★ 휴지통은 표시일 뿐이다 — 디스크 실물이 그 자리에 있다.
    assert.equal(await existsOnDisk(resolveAttachmentAbsolutePath(storageRoot, firstInput.storedPath)), true);
  });

  test("낡은 version 으로 온 삭제는 CONFLICT — 글도 스크린샷도 그대로 살아 있다(한 트랜잭션)", async () => {
    const created = await createRequest("충돌하는 삭제");
    const id = await addScreenshot(created.id);
    const moved = await moveToInProgress(created);

    const result = await deleteImprovementRequest({
      id: created.id,
      expectedVersion: created.version,
      actorUserId: otherUserId,
      canManage: true,
    });
    assert.equal(result.ok === false && result.code, "CONFLICT");

    const row = await readAttachment(id);
    assert.equal(row.isDeleted, false, "지워지지 않은 글의 스크린샷이 휴지통으로 가면 안 된다");
    assert.equal(row.improvementRequestId, created.id);
    assert.equal((await attachmentAudits(id, "FILE_DELETE")).length, 0);
    assert.ok(moved.version > created.version);
  });

  test("거절된 삭제(남의 글)도 스크린샷을 건드리지 않는다", async () => {
    const request = await createRequest("남이 지우려는 글");
    const id = await addScreenshot(request.id);

    const result = await deleteImprovementRequest({
      id: request.id,
      expectedVersion: request.version,
      actorUserId: otherUserId,
      canManage: false,
    });
    assert.equal(result.ok === false && result.code, "FORBIDDEN");
    assert.equal((await readAttachment(id)).isDeleted, false);
  });
});

// ─────────────────────────────────────────────────── 8. 목록

describe("목록 — listImprovementRequests 가 스크린샷을 싣는다", () => {
  test("글마다 살아 있는 스크린샷을 올린 차례대로 — 휴지통 것은 빠지고 남의 글 것은 섞이지 않는다", async () => {
    const withShots = await createRequest("스크린샷 있는 글");
    const without = await createRequest("스크린샷 없는 글");
    const other = await createRequest("다른 글");

    const first = await addScreenshot(withShots.id, { fileName: "첫째.png" });
    await new Promise((resolve) => setTimeout(resolve, 5));
    const trashed = await addScreenshot(withShots.id, { fileName: "지운것.png" });
    await new Promise((resolve) => setTimeout(resolve, 5));
    const third = await addScreenshot(withShots.id, { fileName: "셋째.png" });
    await addScreenshot(other.id, { fileName: "남의것.png" });
    await softDeleteAttachment({ attachmentId: trashed, actorUserId: authorId, reason: null });

    // 첫째 장에만 미리보기가 있다고 적는다(미리보기 통로가 하는 기록과 같은 칸).
    await db
      .update(attachments)
      .set({ previewPath: buildImprovementRequestAttachmentPreviewPath({ improvementRequestId: withShots.id, attachmentId: first }) })
      .where(eq(attachments.id, first));

    const items = await listImprovementRequests();
    const listed = items.find((item) => item.id === withShots.id);
    assert.ok(listed);
    assert.deepEqual(
      listed.screenshots.map((shot) => [shot.id, shot.originalFileName, shot.hasPreview]),
      [
        [first, "첫째.png", true],
        [third, "셋째.png", false],
      ]
    );
    for (const shot of listed.screenshots) {
      assert.equal(new Date(shot.uploadedAt).toISOString(), shot.uploadedAt, "올린 시각은 ISO 문자열이다");
      assert.equal("previewPath" in shot, false, "내부 경로는 싣지 않는다");
      assert.equal("storedPath" in shot, false);
    }
    assert.deepEqual(items.find((item) => item.id === without.id)?.screenshots, []);
    assert.deepEqual(
      items.find((item) => item.id === other.id)?.screenshots.map((shot) => shot.originalFileName),
      ["남의것.png"]
    );
  });
});
