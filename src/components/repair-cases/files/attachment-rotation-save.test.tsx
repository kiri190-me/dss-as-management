import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";

import AttachmentViewer, { canOfferOrientationSave } from "./AttachmentViewer";
import SaveRotationDialog from "./SaveRotationDialog";
import { IDENTITY_ORIENTATION, type ImageOrientation } from "@/lib/domain/image-orientation";
import type { RepairCaseAttachmentListItem } from "@/lib/db/queries/attachments";

/**
 * ============================================================================
 * 「돌린 대로 저장」 단추가 **있어야 할 때만** 있는가
 * ============================================================================
 * 🔴 이 단추는 원본을 덮어쓴다. 되돌릴 수 없다. 그래서 「눌렀더니 거절당했다」가
 * 아니라 **처음부터 없어야** 하는 경우가 셋이다:
 *
 *   1. 권한이 없는 사람  — 부모가 저장할 길(onSaveOrientation)을 넘기지 않는다
 *   2. 사진이 아닌 것    — PDF · 압축 파일
 *   3. 돌린 것이 없을 때 — 그대로인 원본을 다시 인코딩하면 화질만 잃는다
 *
 * 판정은 순수 함수 하나(canOfferOrientationSave)가 하고, 화면이 그것을 그대로
 * 쓰는지는 원본을 글자로 읽어 확인한다 — 그려진 화면만으로는 「돌려 놓은 상태」를
 * 만들 수 없기 때문이다(뷰어의 방향은 안쪽 상태라 인자로 넣을 길이 없다).
 * ============================================================================
 */

const TURNED: ImageOrientation = { rotate: 90, flipX: false, flipY: false };

function attachment(overrides: Partial<RepairCaseAttachmentListItem> = {}): RepairCaseAttachmentListItem {
  return {
    id: "att-1",
    category: "INTAKE_PHOTO",
    originalFileName: "외관.jpg",
    storedPath: "repair-cases/case-1/att-1.jpg",
    previewPath: "repair-cases/case-1/att-1.preview.jpg",
    mimeType: "image/jpeg",
    fileSize: 1024,
    checksumSha256: "0".repeat(64),
    malwareScanStatus: "CLEAN",
    description: null,
    uploadedById: "user-1",
    uploadedByName: "홍길동",
    uploadedAt: "2026-09-29T01:02:03.000Z",
    ...overrides,
  };
}

async function noopSave() {
  return { ok: true } as const;
}

function renderViewer(options: { withSave: boolean; item?: RepairCaseAttachmentListItem }): string {
  return renderToStaticMarkup(
    <AttachmentViewer
      items={[options.item ?? attachment()]}
      initialIndex={0}
      onClose={() => {}}
      onSaveOrientation={options.withSave ? noopSave : undefined}
    />
  );
}

const viewerSource = readFileSync(new URL("./AttachmentViewer.tsx", import.meta.url), "utf8").replace(
  /\r\n/g,
  "\n"
);

// ───────────────────────────────── 판정 — 셋이 모두 참일 때만

describe("단추를 내미는 조건", () => {
  test("길이 있고 · 사진이고 · 돌려 놓았으면 참", () => {
    assert.equal(
      canOfferOrientationSave({ hasHandler: true, mimeType: "image/jpeg", orientation: TURNED }),
      true
    );
    assert.equal(
      canOfferOrientationSave({ hasHandler: true, mimeType: "image/png", orientation: TURNED }),
      true
    );
  });

  test("🔴 권한이 없으면(길이 없으면) 거짓 — 눌렀다 거절당하는 것이 아니다", () => {
    assert.equal(
      canOfferOrientationSave({ hasHandler: false, mimeType: "image/jpeg", orientation: TURNED }),
      false
    );
  });

  test("🔴 사진이 아니면 거짓 — PDF · 압축에는 단추가 없다", () => {
    for (const mimeType of [
      "application/pdf",
      "application/zip",
      "text/plain",
      "application/vnd.ms-excel",
    ]) {
      assert.equal(
        canOfferOrientationSave({ hasHandler: true, mimeType, orientation: TURNED }),
        false,
        `${mimeType} 에 단추가 생긴다`
      );
    }
  });

  test("🔴 돌린 것이 없으면 거짓", () => {
    assert.equal(
      canOfferOrientationSave({
        hasHandler: true,
        mimeType: "image/jpeg",
        orientation: IDENTITY_ORIENTATION,
      }),
      false
    );
  });

  test("뒤집기만 해도 참이다 — 회전만 보고 넘기면 뒤집은 것을 저장할 길이 없다", () => {
    for (const orientation of [
      { rotate: 0, flipX: true, flipY: false },
      { rotate: 0, flipX: false, flipY: true },
    ] as ImageOrientation[]) {
      assert.equal(
        canOfferOrientationSave({ hasHandler: true, mimeType: "image/jpeg", orientation }),
        true
      );
    }
  });
});

// ───────────────────────────────── 그려진 화면

describe("크게 보기에 그려지는 것", () => {
  test("🔴 처음 열었을 때(돌린 것이 없을 때)는 단추가 없다 — 권한이 있어도", () => {
    assert.ok(!renderViewer({ withSave: true }).includes("돌린 대로 저장"));
  });

  test("🔴 저장할 길이 없으면 확인 창조차 DOM 에 없다", () => {
    const html = renderViewer({ withSave: false });
    assert.ok(!html.includes("돌린 대로 저장"), "단추가 있다");
    assert.ok(!html.includes("돌린 대로 원본에 저장"), "확인 창이 남아 있다");
    assert.ok(!html.includes("되돌릴 수 없습니다"), "경고 문장이 남아 있다");
  });

  test("길이 있으면 확인 창은 닫힌 채로 붙어 있다", () => {
    const html = renderViewer({ withSave: true });
    assert.ok(html.includes("돌린 대로 원본에 저장"), "확인 창이 붙지 않았다");
    assert.ok(html.includes("원본 파일을 덮어씁니다. 되돌릴 수 없습니다."));
  });

  test("돌리기 · 뒤집기 · 확대 단추는 그대로 있다 — 있던 것을 잃지 않았다", () => {
    const html = renderViewer({ withSave: true });
    for (const label of [
      "왼쪽으로 90도 회전",
      "오른쪽으로 90도 회전",
      "좌우 뒤집기",
      "상하 뒤집기",
      "확대",
      "축소",
      "원래대로",
    ]) {
      assert.ok(html.includes(`aria-label="${label}"`), `${label} 단추가 사라졌다`);
    }
  });
});

// ───────────────────────────────── 화면이 그 판정을 실제로 쓰는가

describe("화면이 판정을 그대로 쓴다", () => {
  test("🔴 단추는 canSaveOrientation 으로만 그려진다 — 조건을 따로 적지 않았다", () => {
    assert.ok(
      viewerSource.includes("const canSaveOrientation = canOfferOrientationSave({"),
      "판정을 순수 함수에서 받아 오지 않는다"
    );
    assert.ok(
      viewerSource.includes("{canSaveOrientation && ("),
      "단추가 그 판정으로 여닫히지 않는다"
    );
    assert.ok(
      viewerSource.includes('aria-label="돌린 대로 저장"'),
      "단추에 이름표가 없다"
    );
  });

  test("🔴 판정의 세 재료가 화면에서 그대로 온다 — 길 · mime · 방향", () => {
    const start = viewerSource.indexOf("const canSaveOrientation = canOfferOrientationSave({");
    assert.ok(start >= 0);
    const block = viewerSource.slice(start, viewerSource.indexOf("});", start));
    assert.ok(block.includes("hasHandler: Boolean(onSaveOrientation)"), block);
    assert.ok(block.includes("mimeType: current.mimeType"), block);
    assert.ok(block.includes("orientation: transform.orientation"), block);
  });

  test("저장 중에는 단추가 잠긴다", () => {
    const start = viewerSource.indexOf("{canSaveOrientation && (");
    const block = viewerSource.slice(start, viewerSource.indexOf("</button>", start));
    assert.ok(block.includes("disabled={isSaving}"), block);
  });

  test("🔴 목록 화면은 지울 수 있는 사람에게만 저장할 길을 넘긴다", () => {
    const listSource = readFileSync(new URL("./StoredAttachmentList.tsx", import.meta.url), "utf8");
    assert.ok(
      listSource.includes("onSaveOrientation={canManage ? saveOrientation : undefined}"),
      "권한과 무관하게 저장할 길이 넘어간다"
    );
  });

  test("🔴 제품 모델 파일 화면에는 넣지 않았다 — 요청은 수리 건 상세였다", () => {
    const modelSource = readFileSync(
      new URL("../../product-models/ProductModelFilesSection.tsx", import.meta.url),
      "utf8"
    );
    assert.ok(
      !modelSource.includes("onSaveOrientation"),
      "제품 모델 화면에도 되돌릴 수 없는 단추가 생겼다 — 요청에 없던 자리다"
    );
  });
});

// ───────────────────────────────── 확인 창

describe("확인 창", () => {
  function renderDialog(orientation: ImageOrientation, errorMessage: string | null = null): string {
    return renderToStaticMarkup(
      <SaveRotationDialog
        isOpen
        displayName="외관.jpg"
        orientation={orientation}
        isSubmitting={false}
        errorMessage={errorMessage}
        onConfirm={() => {}}
        onCancel={() => {}}
      />
    );
  }

  test("🔴 되돌릴 수 없다고 분명히 말한다", () => {
    const html = renderDialog(TURNED);
    assert.ok(html.includes("원본 파일을 덮어씁니다. 되돌릴 수 없습니다."));
    assert.ok(html.includes("목록에 쓰는 작은 그림도 함께 새 방향으로 바뀝니다."));
  });

  test("무엇을 어느 방향으로 바꾸는지 보여 준다", () => {
    const html = renderDialog({ rotate: 180, flipX: true, flipY: false });
    assert.ok(html.includes("외관.jpg"), "대상 파일 이름이 없다");
    assert.ok(html.includes("오른쪽으로 180도 회전 · 좌우 뒤집기"), "바꿀 방향이 없다");
  });

  test("막혔을 때 서버가 준 문장을 그 자리에 보여 준다", () => {
    const html = renderDialog(TURNED, "그 사이 이 파일이 바뀌었습니다.");
    assert.ok(html.includes("그 사이 이 파일이 바뀌었습니다."));
    assert.ok(html.includes('role="alert"'));
  });

  test("이 저장소의 확인 창 관행을 따른다 — window.confirm 이 아니다", () => {
    const html = renderDialog(TURNED);
    assert.ok(html.startsWith("<dialog"), html.slice(0, 40));
    assert.ok(html.includes("취소"), "취소가 없다");
  });
});
