import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  CONTACT_FOLDER_FILE_MAX_NAME_LENGTH,
  contactFolderCopyFileName,
} from "./contact-folder-naming";
import {
  CONTACT_FOLDER_SAVE_FILE_NAME_HIDDEN_REASON,
  CONTACT_FOLDER_SAVE_FILE_NAME_PATH_REASON,
  CONTACT_FOLDER_SAVE_FILE_NAME_TOO_LONG_REASON,
  checkContactFolderSaveFileName,
  contactFolderSaveFileName,
  contactFolderSaveFileNameDefault,
  contactFolderSaveFileNameToSend,
} from "./contact-folder-save-file-name";
import { isIgnoredShareFolderEntryName } from "./share-folder-naming";

/**
 * ============================================================================
 * [연락서 폴더에 저장] — **사람이 적는 파일 이름** (2026-11-26)
 * ============================================================================
 * 사용자 요청: 「저장될 폴더를 선택한 다음에 파일 이름을 어떻게 할지 적을 수 있도록
 * (기본적으로 기존 이름이 적혀 있고, 변경할 수 있도록)」.
 *
 * 못 박는 것:
 *  · 🔴 기본값이 **지금 저장될 이름**이다 — 원본 이름 그대로가 아니라 다듬기를 지난 뒤다
 *  · 🔴 **경로를 깨는 글자**가 막힌다(거절형 — 조용히 바꾸지 않는다)
 *  · 🔴 **목록이 감추는 이름**이 막힌다(넣었다는데 안 보이는 파일이 생기지 않게)
 *  · 🔴 **다듬는 함수를 지난다** — 길이 상한 · 금지 글자가 그대로 듣는다
 *  · 🔴 **확장자는 원본 것으로 끝난다** — 지워도 돌아오고, 자르지 않는다
 *  · 🔴 **손대지 않았거나 비우면 칸을 안 보낸다** = 원본 이름 그대로(주소가 예전 그대로)
 *
 * 🔴 실제 고객사명 · 사람 이름을 쓰지 않는다 — 전부 가짜다.
 * ============================================================================
 */

/** 가리킴 한 줄의 자리(가짜). 공백 · 한글 · `/` 가 섞여 있다. */
const SOURCE_PATH = "2. 인수시 서류/MB 인수시 체크시트.xlsx";
const SOURCE_NAME = "MB 인수시 체크시트.xlsx";

describe("① 🔴 기본값은 **지금 저장될 이름**이다", () => {
  test("가리킨 자리의 마지막 마디를 **다듬은** 이름이다", () => {
    // 🔵 무엇을 재는지 먼저 — 경로의 마지막 마디가 이 이름이다(통로가 읽는 그 값).
    assert.equal(SOURCE_PATH.split("/").at(-1), SOURCE_NAME);
    assert.equal(contactFolderSaveFileNameDefault(SOURCE_PATH), contactFolderCopyFileName(SOURCE_NAME));
    assert.equal(contactFolderSaveFileNameDefault(SOURCE_PATH), SOURCE_NAME);
  });

  test("🔴 **원본 이름 그대로가 아니다** — 다듬기가 글자를 바꾸는 이름에서 갈린다", () => {
    // 금지 글자가 섞인 이름: 다듬기가 `:` 를 공백으로 바꾼다. 원본을 그대로 보여 주면
    // 창이 말한 이름과 공유폴더에 생긴 이름이 달라진다.
    const raw = "점검표:2026.xlsx";
    const path = `2. 인수시 서류/${raw}`;
    assert.notEqual(contactFolderSaveFileNameDefault(path), raw, "원본 글자를 그대로 내밀었다");
    assert.equal(contactFolderSaveFileNameDefault(path), contactFolderCopyFileName(raw));
    assert.equal(contactFolderSaveFileNameDefault(path), "점검표 2026.xlsx");
  });

  test("🔴 긴 이름은 **잘린 뒤의 이름**을 보여 준다 — 상한 안이다", () => {
    const raw = `${"가".repeat(200)}.xlsx`;
    const shown = contactFolderSaveFileNameDefault(`2. 인수시 서류/${raw}`);
    assert.notEqual(shown, raw);
    assert.ok(shown.length <= CONTACT_FOLDER_FILE_MAX_NAME_LENGTH, `${shown.length}`);
    assert.ok(shown.endsWith(".xlsx"), shown);
  });

  test("🔴 쓸 수 있는 이름이 안 나오면 **원본을 그대로** 내민다(빈 칸이 아니다)", () => {
    // 줄기가 통째로 걷히는 이름 — 다듬기가 null 을 돌려준다.
    const raw = "...";
    assert.equal(contactFolderCopyFileName(raw), null, "표본이 틀렸다 — 다듬기가 null 이 아니다");
    assert.equal(contactFolderSaveFileNameDefault(`2. 인수시 서류/${raw}`), raw);
  });

  test("폴더가 없는 자리(맨 위 칸)도 마디 하나로 읽는다", () => {
    assert.equal(contactFolderSaveFileNameDefault("회로도.pdf"), "회로도.pdf");
  });
});

describe("② 🔴 **경로를 깨는 글자**가 막힌다 — 조용히 바꾸지 않는다", () => {
  test("`/` · `\\` · `..` · 제어문자는 **까닭과 함께 거절**된다", () => {
    for (const bad of [
      "../점검표.xlsx",
      "..",
      "2. 인수시 서류/점검표.xlsx",
      "폴더\\점검표.xlsx",
      "점검\t표.xlsx",
      // 줄바꿈도 제어문자다 — 소스에 날것으로 두면 이 파일이 깨지므로 코드로 만든다.
      `점검표${String.fromCharCode(10)}2026.xlsx`,
    ]) {
      assert.equal(checkContactFolderSaveFileName(bad), CONTACT_FOLDER_SAVE_FILE_NAME_PATH_REASON, bad);
    }
  });

  test("🔴 거절은 **치환이 아니다** — 바뀐 이름이 조용히 나가지 않는다", () => {
    // 치환형(sanitizeShareFolderNamePiece)으로 받았다면 `2026 11 점검표.xlsx` 가 나갔을
    // 것이다. 사람이 제가 적은 이름이 바뀐 줄 모른 채 탐색기에서 그 이름을 찾게 된다.
    const typed = "2026/11 점검표.xlsx";
    assert.notEqual(checkContactFolderSaveFileName(typed), null, "경로 글자를 그냥 받았다");
    // 그래도 통로가 두 겹이라, 걸러지지 않고 와도 **원본 이름**으로 간다(지어내지 않는다).
    assert.equal(contactFolderSaveFileName(typed, SOURCE_NAME), SOURCE_NAME);
  });

  test("너무 긴 이름은 **길이** 까닭으로 거절된다 — 경로 까닭과 갈라져 있다", () => {
    assert.equal(checkContactFolderSaveFileName("가".repeat(256)), CONTACT_FOLDER_SAVE_FILE_NAME_TOO_LONG_REASON);
    // 255 자는 지나간다 — 실제로 디스크에 쓰일 때 다듬기가 더 깎는 것은 거절할 거리가 아니다.
    assert.equal(checkContactFolderSaveFileName("가".repeat(255)), null);
  });

  test("🔴 **목록이 감추는 이름**도 막는다 — 넣었다는데 안 보이는 파일이 생기지 않게", () => {
    for (const hidden of [".점검표.xlsx", "~$점검표.xlsx", "Thumbs.db", "desktop.ini"]) {
      // 🔵 표본이 맞는지 먼저 — 정말 목록이 거르는 이름인가.
      assert.equal(isIgnoredShareFolderEntryName(hidden), true, `표본이 틀렸다: ${hidden}`);
      assert.equal(checkContactFolderSaveFileName(hidden), CONTACT_FOLDER_SAVE_FILE_NAME_HIDDEN_REASON, hidden);
    }
  });

  test("쓸 수 있는 이름은 **지나간다** — 한글 · 공백 · 괄호 · 점이 섞여도 된다", () => {
    for (const good of ["점검표.xlsx", "점검표 (최종).xlsx", "2026.11 점검표.xlsx", "확장자없음", "MB 체크시트"]) {
      assert.equal(checkContactFolderSaveFileName(good), null, good);
    }
  });

  test("🔴 **빈 글자는 거절이 아니다** — 「안 적었다」는 원본 이름을 뜻한다", () => {
    for (const empty of ["", "   ", null, undefined]) {
      assert.equal(checkContactFolderSaveFileName(empty), null, JSON.stringify(empty));
    }
  });
});

describe("③ 🔴 확장자는 **원본 것**으로 끝난다", () => {
  test("지우고 적으면 원본 확장자가 **돌아온다** — 안 열리는 파일을 남기지 않는다", () => {
    assert.equal(contactFolderSaveFileName("점검표", SOURCE_NAME), "점검표.xlsx");
  });

  test("이미 그 확장자면 **겹쳐 붙지 않는다** — 대소문자를 접어서 본다", () => {
    assert.equal(contactFolderSaveFileName("점검표.xlsx", SOURCE_NAME), "점검표.xlsx");
    assert.equal(contactFolderSaveFileName("점검표.XLSX", SOURCE_NAME), "점검표.XLSX");
  });

  test("다른 확장자를 적으면 **뒤에 원본 것을 붙인다** — 보기엔 거칠어도 열린다", () => {
    assert.equal(contactFolderSaveFileName("점검표.pdf", SOURCE_NAME), "점검표.pdf.xlsx");
  });

  test("붙이는 글자는 **원본 그대로**다 — NAS 에서 대소문자는 다른 이름이다", () => {
    assert.equal(contactFolderSaveFileName("점검표", "체크시트.XLSX"), "점검표.XLSX");
  });

  test("원본에 확장자가 없으면 붙일 것이 없다 — 맨 앞의 점은 구분자가 아니다", () => {
    assert.equal(contactFolderSaveFileName("점검표", "확장자없는원본"), "점검표");
    assert.equal(contactFolderSaveFileName("점검표", ".gitignore"), "점검표");
    // 끝이 점인 원본도 확장자가 아니다.
    assert.equal(contactFolderSaveFileName("점검표", "이름."), "점검표");
  });

  test("앞뒤 공백은 걷고 보낸다", () => {
    assert.equal(contactFolderSaveFileName("  점검표  ", SOURCE_NAME), "점검표.xlsx");
  });

  test("🔴 안 적으면 **읽은 원본 이름 그대로** — 2026-10-08 의 동작이다", () => {
    for (const empty of ["", "   ", null, undefined]) {
      assert.equal(contactFolderSaveFileName(empty, SOURCE_NAME), SOURCE_NAME, JSON.stringify(empty));
    }
  });
});

describe("④ 🔴 **다듬는 함수를 지난다** — 건너뛰지 않는다", () => {
  test("금지 글자는 다듬기에서 걷힌다 — 거절형이 보지 않는 글자들이다", () => {
    // `:` · `*` · `?` 는 경로를 깨지 않으므로 거절형이 통과시킨다. 🔵 그 사실을 먼저 잰다.
    const typed = "점검표:2026*최종?.xlsx";
    assert.equal(checkContactFolderSaveFileName(typed), null, "거절형이 여기서 막았다 — 표본이 틀렸다");
    // 그리고 꽂는 함수가 쓰는 그 다듬기를 지나면 글자가 걷힌다.
    assert.equal(contactFolderCopyFileName(contactFolderSaveFileName(typed, SOURCE_NAME)), "점검표 2026 최종.xlsx");
  });

  test("🔴 길이 상한이 **그대로 듣는다** — 줄기만 깎이고 확장자는 남는다", () => {
    const typed = "가".repeat(200);
    const written = contactFolderCopyFileName(contactFolderSaveFileName(typed, SOURCE_NAME));
    assert.notEqual(written, null);
    assert.ok((written ?? "").length <= CONTACT_FOLDER_FILE_MAX_NAME_LENGTH, `${written?.length}`);
    // 🔴 확장자는 한 글자도 안 잘린다(`.xlsx` 가 `.xls` 가 되면 두 번 눌러도 안 열린다).
    assert.ok((written ?? "").endsWith(".xlsx"), written ?? "");
  });

  test("🔴 다듬기가 **원본 이름에 하던 일과 똑같다** — 사람이 적은 글자에 다른 자를 대지 않는다", () => {
    // 적은 이름이 원본 이름과 같은 글자면, 나가는 값도 원본을 넘겼을 때와 한 글자도 다르지 않다.
    assert.equal(contactFolderSaveFileName(SOURCE_NAME, SOURCE_NAME), SOURCE_NAME);
  });
});

describe("⑤ 🔴 손대지 않았거나 비우면 **칸을 안 보낸다**", () => {
  test("기본값 그대로면 `null` — 주소가 2026-11-18 과 한 글자도 달라지지 않는다", () => {
    assert.equal(contactFolderSaveFileNameToSend(contactFolderSaveFileNameDefault(SOURCE_PATH), SOURCE_PATH), null);
  });

  test("비우면 `null` — 원본 이름으로 간다([저장]을 막지 않는다)", () => {
    assert.equal(contactFolderSaveFileNameToSend("", SOURCE_PATH), null);
    assert.equal(contactFolderSaveFileNameToSend("    ", SOURCE_PATH), null);
  });

  test("앞뒤 공백만 늘어난 것은 **바꾼 것이 아니다**", () => {
    assert.equal(contactFolderSaveFileNameToSend(`  ${SOURCE_NAME} `, SOURCE_PATH), null);
  });

  test("바꾸면 **걷어낸 글자**가 간다", () => {
    assert.equal(contactFolderSaveFileNameToSend("  점검표  ", SOURCE_PATH), "점검표");
    assert.equal(contactFolderSaveFileNameToSend("점검표.xlsx", SOURCE_PATH), "점검표.xlsx");
  });
});
