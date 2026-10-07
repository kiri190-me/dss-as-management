import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import PurgeAttachmentDialog from "./PurgeAttachmentDialog";

/**
 * ============================================================================
 * 첨부 영구 삭제 — 확인 창이 무엇을 말하는가, 단추가 어디에만 있는가 (2026-10-07)
 * ============================================================================
 * 되돌릴 수 없는 길이다. 그래서 이 시험이 못 박는 것은 「되는가」가 아니라
 * **「사람이 그 사실을 알고 누르는가」**와 **「누를 수 없어야 하는 사람에게는 단추가
 * 아예 없는가」**다.
 *
 * 못 박는 것:
 *  1. 🔴 확인 창이 **되돌릴 수 없다**고 말하고 **디스크 파일까지** 지워진다고 말한다
 *  2. 🔴 **사유를 받지 않는다** — 휴지통에 넣을 때 받은 사유가 감사에 함께 실린다
 *  3. 🔴 휴지통 확인 창(DeleteAttachmentDialog)을 **고쳐 쓰지 않았다** — 그 창의
 *     「언제든 복원할 수 있습니다」가 그대로 살아 있다(성질이 정반대인 두 창이다)
 *  4. 🔴 세 화면이 **같은 창 하나**를 쓰고, 단추는 **휴지통 구역에만** 있다
 *  5. 🔴 권한이 없으면 단추가 **안 그려진다** — 세 화면 모두 휴지통의 되살리기와
 *     **같은 깃발** 아래에 있다(새 문턱을 만들지 않았다)
 *  6. 🔴 서버 쪽도 **같은 문**이다 — 액션이 resolveWriteActor 를 그대로 쓰고, 저장소
 *     어댑터는 액션이 넘긴다(mutation 이 UPLOADS_DIR 을 집지 않는다 — 시험이 진짜
 *     업로드 폴더를 지우는 사고를 막는 울타리다)
 *  7. 기존 소프트 삭제 · 되살리기 통로가 세 화면에 **그대로** 있다
 *
 * ── 왜 세 화면은 렌더하지 않고 원본을 글자로 읽는가 ──────────────────────
 * 셋 다 서버 액션(actions/attachments)을 직접 import 하는 클라이언트 컴포넌트라,
 * 그 사슬 끝의 `server-only` 때문에 react-server 조건 없이 도는 test:components 에서는
 * import 자체가 던진다. 이웃들과 같은 방법이다(product-model-kind-files-screen.test.ts ·
 * case-kind-share-docs-section.test.tsx). 확인 창 자체는 아무것도 물지 않으므로
 * **실제로 그려 본다.**
 * ============================================================================
 */

const repoUrl = new URL("../../../../", import.meta.url);
/** CRLF 로 받아 둔 저장소에서도 표지가 맞도록 LF 로 맞춘다. */
const read = (relativePath: string) =>
  readFileSync(new URL(relativePath, repoUrl), "utf8").replace(/\r\n/g, "\n");
/** 줄바꿈·들여쓰기 차이로 시험이 깨지지 않도록 공백을 하나로 접는다. */
const flat = (source: string) => source.replace(/\s+/g, " ");
/** "이 글자가 있으면 안 된다" 를 볼 때 쓴다 — 주석에 적힌 까닭에 걸리지 않게. */
const code = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");

const dialogSource = read("src/components/repair-cases/files/PurgeAttachmentDialog.tsx");
const trashDialogSource = read("src/components/repair-cases/files/DeleteAttachmentDialog.tsx");
const filesScreen = read("src/components/repair-cases/files/FilesScreen.tsx");
const modelSection = read("src/components/product-models/ProductModelFilesSection.tsx");
const kindScreen = read("src/components/product-models/ProductModelKindFilesScreen.tsx");
const action = read("src/lib/server/actions/attachments.ts");
const mutation = read("src/lib/db/mutations/attachment-purge.ts");
const trashMutation = read("src/lib/db/mutations/attachment-trash.ts");

const FILE_NAME = "인수 사진.txt";

function markup(overrides: { isOpen?: boolean; isSubmitting?: boolean } = {}): string {
  return renderToStaticMarkup(
    createElement(PurgeAttachmentDialog, {
      isOpen: overrides.isOpen ?? true,
      displayName: FILE_NAME,
      isSubmitting: overrides.isSubmitting ?? false,
      onConfirm: () => undefined,
      onCancel: () => undefined,
    })
  );
}

/**
 * 깃발 하나 아래 묶인 토막을 떼어 온다 — 그 안에 단추 둘이 **함께** 있는지 보기
 * 위해서다. 깃발이 다시 나오는 자리에서 끊는다.
 */
function gatedBlock(source: string, gate: string, gateName: string): string {
  // 🔴 주석을 먼저 걷는다 — 주석에 적힌 깃발 이름에서 끊기면 안 된다.
  const flatSource = flat(code(source));
  const start = flatSource.indexOf(gate);
  assert.ok(start > 0, `깃발을 찾지 못했다: ${gate}`);
  const rest = flatSource.slice(start + gate.length);
  const next = rest.indexOf(gateName);
  return next === -1 ? rest : rest.slice(0, next);
}

describe("① 🔴 확인 창은 되돌릴 수 없다고 말한다", () => {
  test("파일 이름 · 「되돌릴 수 없습니다」 · 「디스크의 파일까지」 셋이 모두 보인다", () => {
    const html = markup();
    assert.ok(html.includes(FILE_NAME), html);
    assert.ok(html.includes("되돌릴 수 없습니다"), html);
    assert.ok(html.includes("디스크의 파일까지 지워집니다"), html);
    // 머리말도 「영구 삭제」라고 말한다 — 「삭제」만으로는 휴지통과 구별되지 않는다.
    assert.ok(html.includes("첨부파일 영구 삭제"), html);
  });

  test("🔴 되살릴 수 있다는 말을 하지 않는다 — 휴지통 창과 성질이 정반대다", () => {
    const html = markup();
    for (const forbidden of ["복원", "되살릴 수 있습니다", "소프트 삭제", "언제든"]) {
      assert.equal(html.includes(forbidden), false, `${forbidden} 가 있다`);
    }
  });

  test("🔴 사유를 받지 않는다 — 휴지통에 넣을 때 받은 사유가 감사에 함께 실린다", () => {
    const html = markup();
    assert.equal(html.includes("<textarea"), false, html);
    assert.equal(html.includes("삭제 사유"), false, html);
    // 원본에도 사유를 쥘 자리가 없다.
    const body = code(dialogSource);
    assert.equal(body.includes("useState"), false, "사유를 담을 상태를 들고 있다");
    assert.equal(body.includes("MAX_DELETION_REASON_LENGTH"), false);
    // 확인 손잡이가 인자를 받지 않는다 — 받으면 부르는 쪽이 사유를 지어내게 된다.
    assert.ok(flat(dialogSource).includes("onConfirm: () => void;"), dialogSource);
  });

  test("누르는 동안 두 단추가 모두 잠긴다 — 두 번 누르기로 두 번 지워지지 않는다", () => {
    const html = markup({ isSubmitting: true });
    assert.equal(html.match(/disabled=""/g)?.length, 2, html);
    assert.ok(html.includes("삭제 중..."), html);
    const idle = markup();
    assert.ok(idle.includes("영구 삭제</button>"), idle);
    // `disabled:opacity-50` 은 클래스 이름이다 — 속성만 센다.
    assert.equal(idle.match(/disabled=""/g), null, idle);
  });
});

describe("② 🔴 휴지통 확인 창을 고쳐 쓰지 않았다", () => {
  test("DeleteAttachmentDialog 의 문구와 사유 칸이 그대로다", () => {
    assert.ok(
      trashDialogSource.includes("소프트 삭제입니다. 기록은 저장소에 남아 있으며 언제든 복원할 수 있습니다."),
      "휴지통 창의 문구가 바뀌었다"
    );
    assert.ok(trashDialogSource.includes("삭제 사유 *"), "휴지통 창의 사유 칸이 사라졌다");
    assert.ok(trashDialogSource.includes("onConfirm: (reason: string) => void;"), trashDialogSource);
    // 두 창은 서로를 부르지 않는다 — 한쪽을 고쳐 다른 쪽이 흔들리는 길이 없다.
    assert.equal(code(trashDialogSource).includes("PurgeAttachmentDialog"), false);
    assert.equal(code(dialogSource).includes("DeleteAttachmentDialog"), false);
  });
});

describe("③ 🔴 세 화면이 같은 창 하나를 쓴다 — 단추는 휴지통 구역에만", () => {
  const screens: [string, string][] = [
    ["수리건 파일 관리", filesScreen],
    ["제품 모델 사진·도면", modelSection],
    ["제품 종류 공통 서류", kindScreen],
  ];

  for (const [label, source] of screens) {
    test(`${label} — 창을 새로 만들지 않고 가져다 쓴다`, () => {
      assert.ok(source.includes("PurgeAttachmentDialog"), "확인 창을 쓰지 않는다");
      assert.ok(flat(source).includes("<PurgeAttachmentDialog isOpen={pendingPurge !== null}"), source);
      assert.ok(source.includes("purgeAttachmentAction"), "서버 액션을 부르지 않는다");
      // 창을 베껴 적은 자리가 없다 — 글자는 창 하나에만 있다.
      const body = code(source);
      assert.equal(body.includes("되돌릴 수 없습니다.</p>"), false, "문구를 베꼈다");
      assert.equal(body.includes("디스크의 파일까지 지워집니다"), false, "문구를 베꼈다");
    });

    test(`${label} — 단추는 휴지통 줄에만 하나다(살아 있는 목록에는 없다)`, () => {
      assert.equal(
        (source.match(/data-attachment-purge-button/g) ?? []).length,
        1,
        "영구 삭제 단추가 둘 이상 그려진다"
      );
      assert.equal(
        (source.match(/setPendingPurge\(item\)/g) ?? []).length,
        1,
        "영구 삭제를 세우는 자리가 둘 이상이다"
      );
      // 🔴 휴지통 목록을 그리는 자리보다 **뒤**다 — 살아 있는 목록에 섞이지 않았다.
      const trashAt = source.indexOf("trashedAttachments.map(");
      const buttonAt = source.indexOf("data-attachment-purge-button");
      assert.ok(trashAt > 0 && buttonAt > trashAt, "휴지통 목록 밖에 단추가 있다");
    });

    test(`${label} — 소프트 삭제 · 되살리기 통로가 그대로 있다`, () => {
      for (const fragment of [
        "softDeleteAttachmentAction",
        "restoreAttachmentAction",
        "DeleteAttachmentDialog",
        "RestoreAttachmentDialog",
        "되살리기",
      ]) {
        assert.ok(source.includes(fragment), `사라졌다: ${fragment}`);
      }
    });
  }
});

describe("④ 🔴 권한이 없으면 단추가 아예 없다 — 되살리기와 같은 깃발 아래다", () => {
  test("수리건 파일 관리 — canManage 하나가 두 단추를 함께 연다", () => {
    const block = gatedBlock(filesScreen, "{canManage && (", "canManage");
    assert.ok(block.includes("setPendingRestore(item)"), block);
    assert.ok(block.includes("setPendingPurge(item)"), block);
    // 🔴 깃발이 하나다 — 영구 삭제에 다른 조건을 달지 않았다.
    assert.equal((filesScreen.match(/\{canManage && \(/g) ?? []).length, 1, "깃발이 둘 이상이다");
  });

  for (const [label, source] of [
    ["제품 모델 사진·도면", modelSection],
    ["제품 종류 공통 서류", kindScreen],
  ] as [string, string][]) {
    test(`${label} — 휴지통 구역 자체가 canManageFiles 아래다`, () => {
      const gate = "{canManageFiles && trashedAttachments.length > 0 && (";
      const block = gatedBlock(source, gate, "</details>");
      assert.ok(block.includes("setPendingRestore(item)"), block);
      assert.ok(block.includes("setPendingPurge(item)"), block);
    });
  }

  test("🔴 어느 화면도 단추를 깃발 밖에 두지 않았다 — 권한 이름을 새로 짓지도 않았다", () => {
    for (const source of [filesScreen, modelSection, kindScreen]) {
      const body = code(source);
      assert.equal(body.includes("hasPermission"), false, "화면이 권한을 직접 판정한다");
      assert.equal(/canPurge/.test(body), false, "새 깃발을 만들었다");
    }
  });
});

describe("⑤ 🔴 서버도 같은 문이다 — 액션이 저장소를 넘기고, mutation 은 집지 않는다", () => {
  test("액션은 휴지통과 **같은** resolveWriteActor 를 그대로 쓴다", () => {
    const purgeAt = action.indexOf("export async function purgeAttachmentAction");
    assert.ok(purgeAt > 0, "액션이 없다");
    const body = action.slice(purgeAt);
    assert.ok(body.includes("const actor = await resolveWriteActor(input.attachmentId);"), body);
    assert.ok(body.includes("if (!actor.ok) return actor.result;"), body);
    // 🔴 새 권한을 묻지 않는다 — 문턱은 지우기 · 되살리기와 한 글자도 같다.
    assert.equal(body.includes("hasPermission"), false, "액션이 따로 권한을 묻는다");
    assert.equal(body.includes("ATTACHMENT_OWNER_PERMISSIONS"), false);
    // 세 액션이 같은 함수를 부른다(셋 다 있다는 사실까지 본다).
    assert.equal((action.match(/await resolveWriteActor\(input\.attachmentId\)/g) ?? []).length, 3);
  });

  test("🔴 어댑터는 **액션이** 넘긴다 — mutation 이 UPLOADS_DIR 을 집으면 시험이 진짜 폴더를 지운다", () => {
    assert.ok(
      flat(action).includes("await purgeAttachment(getAttachmentStorage(), {"),
      "액션이 어댑터를 넘기지 않는다"
    );
    const body = code(mutation);
    assert.equal(body.includes("getAttachmentStorage"), false, "🔴 mutation 이 실제 저장소를 집는다");
    assert.equal(body.includes("UPLOADS_DIR"), false);
    assert.equal(body.includes("resolveUploadsRoot"), false);
    // 인자로 받는다는 사실 자체 — swapStoredFiles 와 같은 모양이다.
    assert.ok(
      flat(mutation).includes('storage: Pick<StorageAdapter, "delete">,'),
      "어댑터를 인자로 받지 않는다"
    );
  });

  test("🔴 차례 — 행을 지우고 **커밋 뒤에** 파일을 지운다", () => {
    const body = code(mutation);
    const txAt = body.indexOf("db.transaction");
    const deleteRowAt = body.indexOf("tx\n        .delete(attachments)");
    const deleteFileAt = body.indexOf("await storage.delete(relPath)");
    assert.ok(txAt > 0 && deleteRowAt > txAt, "행 삭제가 트랜잭션 안에 없다");
    assert.ok(deleteFileAt > deleteRowAt, "파일을 먼저 지운다 — 되돌릴 수 없는 쪽이 앞에 있다");
    // 🔴 트랜잭션 **밖**이다. 커밋 결과를 받은 뒤에만 파일을 건드린다.
    const committedAt = body.indexOf("if (!committed.ok) return committed.result;");
    assert.ok(committedAt > 0 && deleteFileAt > committedAt, "커밋 전에 파일을 지운다");
    // 「바꿔 끼우기」의 물려두기는 쓰지 않는다 — 옛 파일이 다시 필요해지는 길이 없다.
    assert.equal(body.includes("storage.stash"), false);
    assert.equal(body.includes("swapStoredFiles"), false);
  });

  test("🔴 휴지통 파일의 머리말이 더는 거짓말을 하지 않는다", () => {
    assert.ok(
      trashMutation.includes("mutations/attachment-purge.ts"),
      "휴지통 머리말이 영구 삭제 통로를 가리키지 않는다"
    );
    assert.equal(
      trashMutation.includes("범위가 아니다"),
      false,
      "「이 파일의 범위가 아니다」가 그대로 남아 있다"
    );
    // 🔴 휴지통 mutation 은 지금도 디스크를 건드리지 않는다 — 한 글자도 안 바뀌었다.
    assert.equal(code(trashMutation).includes("storage"), false, "휴지통이 저장소를 집는다");
  });
});
