import assert from "node:assert/strict";
import path from "node:path";
import { describe, test } from "node:test";

import {
  ATTACHMENT_CATEGORY_CODES,
  attachmentCategoriesForOwner,
  attachmentCategoriesForProductModelKind,
  isAttachmentCategoryAllowedForOwner,
  isAttachmentCategoryAllowedForProductModelKind,
} from "./attachment-category";
import {
  ATTACHMENT_MODEL_KIND_STORED_PATH_PREFIX,
  AttachmentPathError,
  assertPortableStoredPath,
  buildProductModelKindAttachmentStoredPath,
  buildProductModelKindAttachmentStoredPathFromFileName,
  isPortableStoredPath,
  resolveAttachmentAbsolutePath,
} from "./attachment-path";
import {
  type AttachmentOwnerAccess,
  type AttachmentOwnerRef,
  decideAttachmentDownload,
  isAttachmentOwnerAccessAllowed,
  isDetachedAttachment,
  isProductModelKindOwned,
} from "./attachment-download-policy";
import { PRODUCT_MODEL_KIND_CODES } from "./product-model-kind";

/**
 * ============================================================================
 * 제품 종류 공통 서류함 — 값으로 볼 수 있는 규율 셋 (2026-10-06)
 * ============================================================================
 * 1. **저장 경로** — 첫 마디가 주인을 말하고, 둘째 마디가 종류다. 한글이 없고
 *    대문자가 없다. 리눅스 NAS 에서도 같은 파일을 가리켜야 하기 때문이다.
 * 2. **받는 분류** — 「지금 모델 첨부가 받는 것과 같은 집합」이다. 목록을 베낀
 *    것이 아니라 그 판정을 그대로 돌려 쓰는지 본다 — 베꼈다면 모델 쪽이 바뀌는
 *    날 한쪽만 따라오고, 그때 「화면에는 보이는데 통로가 거절하는」 날이 온다.
 * 3. **주인 판정** — 종류 서류는 FK 칸 셋이 전부 NULL 이다. 그 사실 때문에
 *    「주인 없음(DETACHED)」으로 막히면 안 되고, 접수 건 권한으로 열려서도 안
 *    된다. 둘 다 못 박는다.
 *
 * DB 에서 실제로 그렇게 저장되는가는 db 목록의
 * queries/product-model-kind-attachments.integration.test.ts 의 몫이다.
 * ============================================================================
 */

const ATTACHMENT_ID = "3f1c6a52-9b77-4a2e-8d41-0c5e2a7b19d4";

// ─────────────────────────────────────────────────────────────── 저장 경로

describe("종류 서류의 저장 경로", () => {
  test("첫 마디가 product-model-kinds 이고, 둘째 마디가 종류 코드다", () => {
    assert.equal(ATTACHMENT_MODEL_KIND_STORED_PATH_PREFIX, "product-model-kinds");
    const stored = buildProductModelKindAttachmentStoredPath({
      kind: "GENERATOR",
      attachmentId: ATTACHMENT_ID,
      extension: "pdf",
    });
    assert.equal(stored, `product-model-kinds/generator/${ATTACHMENT_ID}.pdf`);
  });

  test("🔴 종류 코드는 **소문자로 눕혀** 적힌다 — 리눅스에서 그 폴더만 안 열리는 일을 막는다", () => {
    for (const kind of PRODUCT_MODEL_KIND_CODES) {
      const stored = buildProductModelKindAttachmentStoredPath({
        kind,
        attachmentId: ATTACHMENT_ID,
        extension: "xlsx",
      });
      assert.equal(stored, stored.toLowerCase(), `${kind} 경로에 대문자가 섞였다`);
      assert.equal(stored.split("/")[1], kind.toLowerCase());
      // 통과하는 경로여야 한다 — 백업 스크립트가 이 검사로 전 행을 훑는다.
      assert.ok(isPortableStoredPath(stored), `${kind} 경로가 검사를 통과하지 못한다`);
    }
  });

  test("🔴 경로에 한글이 들어가지 않는다 — 인코딩이 다르게 풀리면 그 폴더만 못 찾는다", () => {
    for (const kind of PRODUCT_MODEL_KIND_CODES) {
      const stored = buildProductModelKindAttachmentStoredPath({
        kind,
        attachmentId: ATTACHMENT_ID,
        extension: "pdf",
      });
      assert.ok(!/[^\x20-\x7E]/.test(stored), `${kind} 경로에 아스키 밖 글자가 있다: ${stored}`);
    }
  });

  test("🔴 모델 하나의 자리(product-models/)와 한 글자도 겹치지 않는다", () => {
    const stored = buildProductModelKindAttachmentStoredPath({
      kind: "MATCHER",
      attachmentId: ATTACHMENT_ID,
      extension: "pdf",
    });
    // 폴더 하나만 보고 "모델 것인가 종류 것인가"를 알 수 있어야 한다.
    assert.ok(stored.startsWith("product-model-kinds/"));
    assert.ok(!stored.startsWith("product-models/"));
  });

  test("구분자는 `/` 하나뿐이다 — Windows 에서도 역슬래시가 섞이지 않는다", () => {
    const stored = buildProductModelKindAttachmentStoredPath({
      kind: "TOTAL_CONTROLLER",
      attachmentId: ATTACHMENT_ID,
      extension: "pdf",
    });
    assert.ok(!stored.includes("\\"));
    assert.equal(stored.split("/").length, 3);
  });

  test("종류 코드 모양이 아니면 던진다 — 경로가 저장 루트 밖을 가리키는 길을 닫는다", () => {
    for (const bogus of ["", " ", "generator", "../../etc", "GENERATOR/..", "제너레이터", "G"]) {
      assert.throws(
        () =>
          buildProductModelKindAttachmentStoredPath({
            kind: bogus,
            attachmentId: ATTACHMENT_ID,
            extension: "pdf",
          }),
        AttachmentPathError,
        JSON.stringify(bogus)
      );
    }
  });

  test("첨부 ID 가 UUID 가 아니거나 확장자가 실행 파일이면 던진다 — 앞의 세 벌과 같은 규칙", () => {
    assert.throws(
      () =>
        buildProductModelKindAttachmentStoredPath({
          kind: "GENERATOR",
          attachmentId: "not-a-uuid",
          extension: "pdf",
        }),
      AttachmentPathError
    );
    for (const extension of ["", "exe", "bat", "cmd"]) {
      assert.throws(
        () =>
          buildProductModelKindAttachmentStoredPath({
            kind: "GENERATOR",
            attachmentId: ATTACHMENT_ID,
            extension,
          }),
        AttachmentPathError,
        extension
      );
    }
  });

  test("파일명에서 바로 만드는 편의 함수도 같은 값을 낸다", () => {
    assert.equal(
      buildProductModelKindAttachmentStoredPathFromFileName({
        kind: "MATCHER",
        attachmentId: ATTACHMENT_ID,
        originalFileName: "매쳐 공통 점검표.XLSX",
      }),
      `product-model-kinds/matcher/${ATTACHMENT_ID}.xlsx`
    );
    assert.throws(
      () =>
        buildProductModelKindAttachmentStoredPathFromFileName({
          kind: "MATCHER",
          attachmentId: ATTACHMENT_ID,
          originalFileName: "확장자없음",
        }),
      AttachmentPathError
    );
  });

  test("🔴 백업이 멈추지 않는다 — 검사 함수가 넷째 접두어를 받는다(목록 밖은 여전히 거부)", () => {
    assert.doesNotThrow(() =>
      assertPortableStoredPath(`product-model-kinds/generator/${ATTACHMENT_ID}.pdf`)
    );
    // "넓혔다"가 "아무거나 받는다"가 되지 않았다.
    for (const rejected of [
      `product-model-kind/generator/${ATTACHMENT_ID}.pdf`, // 단수형은 목록에 없다
      `customers/generator/${ATTACHMENT_ID}.pdf`,
      `product-model-kinds/GENERATOR/${ATTACHMENT_ID}.pdf`, // 대문자
      "product-model-kinds/../../secrets.txt",
      `/product-model-kinds/generator/${ATTACHMENT_ID}.pdf`,
    ]) {
      assert.throws(() => assertPortableStoredPath(rejected), AttachmentPathError, rejected);
    }
  });

  test("절대 경로로 풀어도 저장 루트 안이다", () => {
    const root = path.join("C:", "DSS-AS-DATA", "uploads");
    const absolute = resolveAttachmentAbsolutePath(
      root,
      `product-model-kinds/generator/${ATTACHMENT_ID}.pdf`
    );
    assert.ok(absolute.includes(`${path.sep}product-model-kinds${path.sep}`));
    assert.throws(
      () => resolveAttachmentAbsolutePath(root, "product-model-kinds/../../secrets.txt"),
      AttachmentPathError
    );
  });
});

// ──────────────────────────────────────────────────────────────── 받는 분류

describe("종류 서류가 받는 분류 — 모델 첨부와 **같은 집합**", () => {
  test("🔴 목록을 베낀 것이 아니라 모델 쪽 판정을 그대로 쓴다 — 전 분류가 같은 답이다", () => {
    for (const category of ATTACHMENT_CATEGORY_CODES) {
      assert.equal(
        isAttachmentCategoryAllowedForProductModelKind(category),
        isAttachmentCategoryAllowedForOwner(category, "PRODUCT_MODEL"),
        category
      );
    }
    assert.deepEqual(
      attachmentCategoriesForProductModelKind(),
      attachmentCategoriesForOwner("PRODUCT_MODEL")
    );
  });

  test("모델 전용 분류(파라미터 · 통전검사)와 점검표가 들어온다", () => {
    for (const category of ["PARAMETER", "POWER_TEST", "CHECKLIST", "CIRCUIT_DIAGRAM"] as const) {
      assert.equal(isAttachmentCategoryAllowedForProductModelKind(category), true, category);
    }
  });

  test("주인 없는 분류 · 견적서 전용 두 칸 · 수리 건 전용 통문증은 거절된다", () => {
    for (const category of [
      "SCREENSHOT",
      "SIGNED_QUOTE_PDF",
      "QUOTE_EXCEL",
      "PASS_SLIP",
    ] as const) {
      assert.equal(isAttachmentCategoryAllowedForProductModelKind(category), false, category);
    }
  });
});

// ──────────────────────────────────────────────────────────── 주인 판정

/** FK 칸 셋이 전부 NULL 이고 종류만 찬 것 — DB CHECK 가 요구하는 바로 그 모양이다. */
const KIND_OWNER: AttachmentOwnerRef = {
  repairCaseId: null,
  productModelId: null,
  quoteId: null,
  productModelKind: "GENERATOR",
};

const ALL_ACCESS: AttachmentOwnerAccess = {
  REPAIR_CASE: true,
  PRODUCT_MODEL: true,
  QUOTE: true,
};
const NO_ACCESS: AttachmentOwnerAccess = {
  REPAIR_CASE: false,
  PRODUCT_MODEL: false,
  QUOTE: false,
};

describe("종류 서류의 주인 판정", () => {
  test("🔴 FK 칸 셋이 NULL 이어도 「주인 없음」이 아니다 — 그랬다면 모든 종류 서류가 막힌다", () => {
    assert.equal(isProductModelKindOwned(KIND_OWNER), true);
    assert.equal(isDetachedAttachment(KIND_OWNER), false);

    const decision = decideAttachmentDownload({
      ...KIND_OWNER,
      isDeleted: false,
      quoteInTrash: false,
      malwareScanStatus: "NOT_SCANNED",
    });
    assert.deepEqual(decision, { allowed: true });
  });

  test("네 칸이 모두 비면 예전 그대로 주인 없음이다 — 그 동작은 안 바뀌었다", () => {
    const detached: AttachmentOwnerRef = {
      repairCaseId: null,
      productModelId: null,
      quoteId: null,
      productModelKind: null,
    };
    assert.equal(isDetachedAttachment(detached), true);
    assert.equal(isProductModelKindOwned(detached), false);
    // 칸이 아예 빠진 채 와도(옛 직렬화 · 손으로 만든 객체) 같은 답이다 — 닫히는 쪽.
    assert.equal(
      isDetachedAttachment({ repairCaseId: null, productModelId: null, quoteId: null }),
      true
    );
  });

  test("🔴 권한은 제품 모델과 같은 것을 본다 — 접수 건 파일 권한으로는 열리지 않는다", () => {
    assert.equal(isAttachmentOwnerAccessAllowed(KIND_OWNER, { ...NO_ACCESS, PRODUCT_MODEL: true }), true);
    // 모델 권한만 빼면 나머지가 다 있어도 막힌다. 🔴 이 줄이 깨지면 접수 건 파일
    // 권한만 가진 사람이 종류 공통 서류를 지울 수 있다는 뜻이다.
    assert.equal(isAttachmentOwnerAccessAllowed(KIND_OWNER, { ...ALL_ACCESS, PRODUCT_MODEL: false }), false);
    assert.equal(isAttachmentOwnerAccessAllowed(KIND_OWNER, { ...NO_ACCESS, REPAIR_CASE: true }), false);
    assert.equal(isAttachmentOwnerAccessAllowed(KIND_OWNER, { ...NO_ACCESS, QUOTE: true }), false);
  });

  test("휴지통에 있는 종류 서류는 내려받지 못한다 — 다른 주인과 같은 규칙", () => {
    const decision = decideAttachmentDownload({
      ...KIND_OWNER,
      isDeleted: true,
      quoteInTrash: false,
      malwareScanStatus: "NOT_SCANNED",
    });
    assert.equal(decision.allowed, false);
    assert.equal(decision.allowed === false && decision.reason, "DELETED");
  });

  test("검사가 막은 상태는 종류 서류에서도 그대로 막힌다", () => {
    for (const status of ["PENDING", "INFECTED", "FAILED"] as const) {
      const decision = decideAttachmentDownload({
        ...KIND_OWNER,
        isDeleted: false,
        quoteInTrash: false,
        malwareScanStatus: status,
      });
      assert.equal(decision.allowed, false, status);
      assert.equal(decision.allowed === false && decision.reason, "SCAN_BLOCKED", status);
    }
  });
});
