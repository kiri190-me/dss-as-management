import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

import { formatBytes } from "./image-shrink";
import {
  SHARE_FOLDER_ENTRY_ACTIONS_CLASS,
  SHARE_FOLDER_ENTRY_META_MODIFIED_CLASS,
  SHARE_FOLDER_ENTRY_META_SIZE_CLASS,
  SHARE_FOLDER_ENTRY_ROW_CLASS,
  formatShareFolderEntryModifiedAt,
  shareFolderEntryMeta,
} from "./share-folder-entry-meta";

/**
 * ============================================================================
 * 공유폴더 한 줄의 **곁말 두 열** — 값 쪽 (2026-10-08)
 * ============================================================================
 * 「공유폴더 창에서 수정 날짜가 나오고 있는데 그걸 **별도의 열**로 해서 보여줘」
 * (사용자 요구 2026-10-08, 범위는 「공유폴더를 보여 주는 창 전부」 = 넷).
 *
 * 🔴 못 박는 것:
 *  · 크기와 수정시각이 **따로** 나온다 — 한 글자로 이어 붙지 않는다
 *  · 🔴 수정시각이 없으면 **빈 글자**다(칸은 화면이 그대로 둔다)
 *  · 폴더 줄은 **부르는 쪽이 준 글자**다 — 낱말을 여기서 정하지 않는다
 *  · 🔴 못 읽는 값은 **원본 그대로**
 *  · 🔴 날짜 글자 모양이 **안 바뀌었다**(ko-KR · medium · short)
 *  · 🔴 **네 창이 이 한 벌을 쓴다** — 네 원본을 읽어 못 박는다
 *  · 🔴 순수하다(fs · 통로 · 서버 · DB 가 한 글자도 없다)
 *
 * 화면이 이것을 **어떻게 그리는가**(두 칸이 실제로 서는가 · 빈 줄도 칸이 남는가)는
 * components 목록의 네 시험이 상태를 넣어 그려 보고 잰다.
 * ============================================================================
 */

const repoUrl = new URL("../../../", import.meta.url);
const read = (relativePath: string) => readFileSync(new URL(relativePath, repoUrl), "utf8").replace(/\r\n/g, "\n");
/** "이 글자가 있으면 안 된다" 를 볼 때 쓴다 — 주석에 적힌 까닭에 걸리지 않게. */
const code = (value: string) => value.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");

const metaSource = read("src/lib/domain/share-folder-entry-meta.ts");

/** 🔴 공유폴더를 **보여 주는** 창 넷. 가리킨 서류 목록(…ShareDocList)은 여기 들어오지 않는다. */
const SCREENS = [
  {
    label: "수리건 파일관리의 「공유폴더」",
    path: "src/components/repair-cases/files/ContactFolderSection.tsx",
    meta: "contactFolderEntryMeta",
    folderLabel: "CONTACT_FOLDER_SECTION_FOLDER_LABEL",
  },
  {
    label: "제품 종류 「공유폴더에서 고르기」",
    path: "src/components/product-models/KindShareFolderPicker.tsx",
    meta: "kindShareFolderEntryMeta",
    folderLabel: "KIND_SHARE_FOLDER_FOLDER_LABEL",
  },
  {
    label: "제품 모델 「공유폴더에서 고르기」",
    path: "src/components/product-models/ModelShareFolderPicker.tsx",
    meta: "modelShareFolderEntryMeta",
    folderLabel: "MODEL_SHARE_FOLDER_FOLDER_LABEL",
  },
  {
    label: "견적서 폴더",
    path: "src/components/quotes/QuoteArchiveFolderSection.tsx",
    meta: "quoteArchiveFolderEntryMeta",
    folderLabel: "QUOTE_ARCHIVE_FOLDER_SECTION_FOLDER_LABEL",
  },
] as const;

const FOLDER_LABEL = "폴더";
const file = (sizeBytes: number, modifiedAt?: string) => ({
  isDirectory: false,
  sizeBytes,
  ...(modifiedAt === undefined ? {} : { modifiedAt }),
});
const folder = (modifiedAt?: string) => ({
  isDirectory: true,
  sizeBytes: 0,
  ...(modifiedAt === undefined ? {} : { modifiedAt }),
});

describe("① 🔴 크기와 수정시각이 **따로** 나온다 — 이어 붙지 않는다", () => {
  test("파일 줄 — 크기 칸과 수정시각 칸이 서로 다른 글자다", () => {
    const meta = shareFolderEntryMeta(file(2048, "2026-09-08T02:00:00.000Z"), FOLDER_LABEL);
    assert.equal(meta.sizeText, "2.0 KB");
    assert.notEqual(meta.modifiedText, "");
    // 🔴 가운뎃점으로 이어 붙이던 자리가 사라졌다 — 두 칸 어느 쪽에도 구분자가 없다.
    assert.equal(meta.sizeText.includes("·"), false, meta.sizeText);
    assert.equal(meta.modifiedText.includes("·"), false, meta.modifiedText);
    assert.equal(meta.modifiedText.includes("KB"), false, meta.modifiedText);
  });

  test("크기는 첨부 목록과 **같은 함수**로 적는다(formatBytes) — 모양을 새로 짓지 않았다", () => {
    for (const bytes of [0, 512, 1024, 1024 * 1024 * 3]) {
      assert.equal(shareFolderEntryMeta(file(bytes), FOLDER_LABEL).sizeText, formatBytes(bytes));
    }
    assert.equal(code(metaSource).includes("toFixed"), false, "크기 모양을 베껴 적었다");
  });
});

describe("② 🔴 수정시각이 없으면 **빈 글자**다 — 칸은 화면이 그대로 둔다", () => {
  test("modifiedAt 이 없는 줄 — 크기만 있고 수정시각은 빈 글자", () => {
    const meta = shareFolderEntryMeta(file(512), FOLDER_LABEL);
    assert.equal(meta.sizeText, "512 B");
    assert.equal(meta.modifiedText, "");
  });

  test("🔴 빈 글자가 「없음」 같은 말로 바뀌지 않는다 — 자리는 비워 두되 글자를 지어내지 않는다", () => {
    const meta = shareFolderEntryMeta(folder(), FOLDER_LABEL);
    assert.equal(meta.modifiedText, "");
    assert.equal(code(metaSource).includes("없음"), false, "빈 자리에 말을 지어 넣었다");
  });
});

describe("③ 폴더 줄은 크기 대신 **부르는 쪽이 준 글자**", () => {
  test("받은 글자를 그대로 쓴다 — 낱말을 여기서 정하지 않는다", () => {
    assert.equal(shareFolderEntryMeta(folder(), "폴더").sizeText, "폴더");
    // 창마다 말이 달라질 수 있다 — 다른 글자를 주면 그대로 나온다.
    assert.equal(shareFolderEntryMeta(folder(), "디렉터리").sizeText, "디렉터리");
  });

  test("🔴 「폴더」라는 낱말이 이 공용 조각의 **코드**에 박혀 있지 않다", () => {
    assert.equal(/["'`]폴더["'`]/.test(code(metaSource)), false, "낱말을 공용으로 모았다");
  });

  test("폴더 줄도 수정시각은 파일과 같은 자리에 똑같이 나온다", () => {
    const meta = shareFolderEntryMeta(folder("2026-09-08T01:00:00.000Z"), FOLDER_LABEL);
    assert.equal(meta.sizeText, FOLDER_LABEL);
    assert.equal(meta.modifiedText, formatShareFolderEntryModifiedAt("2026-09-08T01:00:00.000Z"));
  });
});

describe("④ 🔴 못 읽는 값은 **원본 그대로**", () => {
  test("날짜가 아닌 글자는 받은 그대로 돌아온다 — 줄이 비어 보이지 않게", () => {
    assert.equal(formatShareFolderEntryModifiedAt("날짜아님"), "날짜아님");
    assert.equal(shareFolderEntryMeta(file(1, "2026-13-45"), FOLDER_LABEL).modifiedText, "2026-13-45");
  });
});

describe("⑤ 🔴 날짜 글자 모양이 **안 바뀌었다** — 자리를 나눴을 뿐이다", () => {
  const ISO = "2026-09-08T02:00:00.000Z";

  test("ko-KR · dateStyle medium · timeStyle short 그대로", () => {
    assert.equal(
      formatShareFolderEntryModifiedAt(ISO),
      new Date(ISO).toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short" })
    );
    // 🔴 네 창이 쓰던 그 한 줄이 글자 그대로 옮겨 왔다.
    assert.ok(
      metaSource.includes('toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short" })'),
      "날짜 모양을 바꿨다"
    );
  });

  test("해 · 오전/오후가 그대로 들어 있다(모양을 ISO 로 되돌리지 않았다)", () => {
    const text = formatShareFolderEntryModifiedAt(ISO);
    assert.ok(text.includes("2026"), text);
    assert.ok(text.includes("오전") || text.includes("오후"), text);
    assert.equal(text.includes("T"), false, text);
  });
});

describe("⑥ 🔴 줄은 **표**다 — 1fr 은 이름 하나뿐이라 세 칸의 자리가 모든 줄에서 같다", () => {
  test("🔴 열 넷의 길이가 줄 하나에 **통째로** 박혀 있다 — 이름만 1fr, 나머지는 고정", () => {
    assert.ok(
      SHARE_FOLDER_ENTRY_ROW_CLASS.includes("sm:grid-cols-[minmax(0,1fr)_10rem_5rem_9rem]"),
      SHARE_FOLDER_ENTRY_ROW_CLASS
    );
    // 🔴 1fr 이 둘이면 줄마다 자리가 달라진다 — 늘어나는 칸은 이름 하나뿐이어야 한다.
    assert.equal(SHARE_FOLDER_ENTRY_ROW_CLASS.match(/1fr/g)?.length, 1, SHARE_FOLDER_ENTRY_ROW_CLASS);
    // 🔴 Tailwind 는 글자 그대로 긁는다 — 쪼개 이어 붙이면 빌드 결과에 없다.
    assert.ok(metaSource.includes("sm:grid-cols-[minmax(0,1fr)_10rem_5rem_9rem]"), "열 길이를 이어 붙였다");
  });

  test("🔴 폭은 **칸이 아니라 줄**이 쥔다 — 칸에 폭을 걸면 좁은 화면까지 따라간다", () => {
    for (const className of [
      SHARE_FOLDER_ENTRY_META_SIZE_CLASS,
      SHARE_FOLDER_ENTRY_META_MODIFIED_CLASS,
      SHARE_FOLDER_ENTRY_ACTIONS_CLASS,
    ]) {
      // 🔴 `min-w-0` 은 폭이 아니라 「줄어들 수 있다」는 표시다 — 앞에 글자가 붙지 않은 `w-` 만 본다.
      assert.equal(/(^|\s)w-/.test(className), false, `칸에 폭이 걸려 있다: ${className}`);
      assert.ok(className.includes("min-w-0"), className);
    }
    for (const className of [SHARE_FOLDER_ENTRY_META_SIZE_CLASS, SHARE_FOLDER_ENTRY_META_MODIFIED_CLASS]) {
      assert.ok(className.includes("tabular-nums"), className);
      assert.ok(className.includes("text-xs"), className);
    }
  });

  test("🔴 수정날짜 칸은 **왼쪽 맞춤** · 크기 칸은 오른쪽 맞춤", () => {
    assert.ok(SHARE_FOLDER_ENTRY_META_MODIFIED_CLASS.includes("text-left"), SHARE_FOLDER_ENTRY_META_MODIFIED_CLASS);
    assert.equal(
      SHARE_FOLDER_ENTRY_META_MODIFIED_CLASS.includes("text-right"),
      false,
      SHARE_FOLDER_ENTRY_META_MODIFIED_CLASS
    );
    assert.ok(SHARE_FOLDER_ENTRY_META_SIZE_CLASS.includes("text-right"), SHARE_FOLDER_ENTRY_META_SIZE_CLASS);
  });

  test("🔴 동작 칸은 안에서 접힌다 — 안내가 길어도 **줄 높이만** 늘고 열은 안 밀린다", () => {
    assert.ok(SHARE_FOLDER_ENTRY_ACTIONS_CLASS.includes("flex-wrap"), SHARE_FOLDER_ENTRY_ACTIONS_CLASS);
    assert.ok(SHARE_FOLDER_ENTRY_ACTIONS_CLASS.includes("min-w-0"), SHARE_FOLDER_ENTRY_ACTIONS_CLASS);
    // 칸이 제 손으로 늘어나면(고정 길이를 무시하면) 앞의 열이 밀린다.
    assert.equal(SHARE_FOLDER_ENTRY_ACTIONS_CLASS.includes("shrink-0"), false, SHARE_FOLDER_ENTRY_ACTIONS_CLASS);
    assert.equal(SHARE_FOLDER_ENTRY_ACTIONS_CLASS.includes("nowrap"), false, SHARE_FOLDER_ENTRY_ACTIONS_CLASS);
  });

  test("🔴 좁은 화면 배치가 **남아 있다** — sm 아래에서는 예전처럼 접힌다", () => {
    // grid 는 sm 이상에서만. 기본은 예전 그대로 flex-wrap 이다.
    assert.ok(SHARE_FOLDER_ENTRY_ROW_CLASS.includes("flex flex-wrap"), SHARE_FOLDER_ENTRY_ROW_CLASS);
    assert.ok(SHARE_FOLDER_ENTRY_ROW_CLASS.includes("sm:grid"), SHARE_FOLDER_ENTRY_ROW_CLASS);
    assert.equal(/(^|\s)grid(\s|$)/.test(SHARE_FOLDER_ENTRY_ROW_CLASS), false, "좁은 화면에서도 표가 선다");
    assert.equal(/(^|\s)grid-cols-/.test(SHARE_FOLDER_ENTRY_ROW_CLASS), false, SHARE_FOLDER_ENTRY_ROW_CLASS);
    // 접힐 때 아랫줄과 붙지 않게 하던 세로 사이도 그대로다.
    assert.ok(SHARE_FOLDER_ENTRY_ROW_CLASS.includes("gap-y-0.5"), SHARE_FOLDER_ENTRY_ROW_CLASS);
    assert.ok(SHARE_FOLDER_ENTRY_ROW_CLASS.includes("items-baseline"), SHARE_FOLDER_ENTRY_ROW_CLASS);
  });
});

describe("⑦ 🔴 **네 창이 이 한 벌을 쓴다** — 한 곳에만 있지 않다", () => {
  for (const screen of SCREENS) {
    test(`${screen.label} — 공용 조각을 불러 쓰고, 제 날짜·이어붙이기를 들고 있지 않다`, () => {
      const source = read(screen.path);
      const body = code(source);

      // ① 공용 조각을 불러 쓴다.
      assert.ok(
        body.includes('from "@/lib/domain/share-folder-entry-meta"'),
        `${screen.label}: 공용 조각을 불러 쓰지 않는다`
      );
      assert.ok(body.includes("shareFolderEntryMeta("), `${screen.label}: 공용 함수를 부르지 않는다`);
      assert.ok(body.includes(screen.meta), `${screen.label}: ${screen.meta} 가 없다`);

      // ② 🔴 제 손으로 날짜를 꾸미지 않는다 — 날짜 모양이 창마다 갈리지 않게.
      assert.equal(body.includes("toLocaleString"), false, `${screen.label}: 날짜를 제 손으로 꾸민다`);
      assert.equal(body.includes("function formatTimestamp"), false, `${screen.label}: 제 formatTimestamp 가 남았다`);

      // ③ 🔴 이어 붙이는 일을 더 하지 않는다.
      assert.equal(body.includes('join(" · ")'), false, `${screen.label}: 곁말을 이어 붙인다`);

      // ④ 🔴 크기도 공용 조각이 적는다 — 제 손으로 formatBytes 를 부르지 않는다.
      assert.equal(
        body.includes("formatBytes"),
        false,
        `${screen.label}: 크기를 제 손으로 적는다(공용 조각이 적어야 한다)`
      );

      // ⑤ 네 칸을 **각각** 그리고, 열 길이도 공용 값을 쓴다(제 손으로 적지 않는다).
      const modifiedAt = body.indexOf("className={SHARE_FOLDER_ENTRY_META_MODIFIED_CLASS}");
      const sizeAt = body.indexOf("className={SHARE_FOLDER_ENTRY_META_SIZE_CLASS}");
      const actionsAt = body.indexOf("className={SHARE_FOLDER_ENTRY_ACTIONS_CLASS}");
      assert.ok(modifiedAt > 0, `${screen.label}: 수정날짜 칸이 없다`);
      assert.ok(sizeAt > 0, `${screen.label}: 크기 칸이 없다`);
      assert.ok(actionsAt > 0, `${screen.label}: 동작 칸이 없다`);
      // 🔴 열 차례 — 이름 → **수정날짜** → 크기 → 동작(윈도우 탐색기와 같게).
      assert.ok(modifiedAt < sizeAt, `${screen.label}: 수정날짜가 크기보다 뒤에 있다`);
      assert.ok(sizeAt < actionsAt, `${screen.label}: 크기가 동작보다 뒤에 있다`);
      // 🔴 줄 자체도 공용 한 벌이다 — 열 길이를 제 손으로 적지 않는다.
      assert.ok(
        body.includes("className={SHARE_FOLDER_ENTRY_ROW_CLASS}"),
        `${screen.label}: 줄이 공용 열 길이를 안 쓴다`
      );
      assert.equal(body.includes("grid-cols-"), false, `${screen.label}: 열 길이를 제 손으로 적는다`);

      // ⑥ 🔴 「폴더」 글자는 **제 상수**를 그대로 쓴다 — 낱말은 공용으로 모으지 않았다.
      assert.ok(
        body.includes(`shareFolderEntryMeta(entry, ${screen.folderLabel})`),
        `${screen.label}: 제 「폴더」 글자(${screen.folderLabel})를 넘기지 않는다`
      );
    });
  }

  test("🔴 네 창이 **다른 네 벌**이 아니다 — 날짜를 꾸미는 자리는 저장소에 이 한 곳뿐이다", () => {
    const places = SCREENS.filter((screen) => code(read(screen.path)).includes("toLocaleString"));
    assert.deepEqual(places, [], "공유폴더 창이 아직 제 날짜를 꾸민다");
    assert.equal(code(metaSource).match(/toLocaleString/g)?.length, 1, metaSource);
  });
});

describe("⑧ 🔴 순수하다 — 통로도 서버도 DB 도 없다", () => {
  test("fs · fetch · 서버 · DB 가 한 글자도 없다", () => {
    for (const forbidden of ["node:fs", "fetch(", "server-only", "@/lib/db", "@/lib/server", "drizzle"]) {
      assert.equal(code(metaSource).includes(forbidden), false, `공용 조각이 ${forbidden} 를 문다`);
    }
  });
});
