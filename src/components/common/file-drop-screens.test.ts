import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

/**
 * ============================================================================
 * 끌어다 놓기 — 여덟 자리가 모두 붙었는가, 그리고 **고르기와 같은 길**인가
 * ============================================================================
 * 이 화면들은 서버 액션 · 브라우저 API 를 끌고 와 통째로 그려 볼 수 없다. 그래서
 * 이웃 시험(quote-attachment-screens.test.ts · save-popup-screens.test.ts)과 같은
 * 방법으로 원본을 글자로 읽는다. 공통 조각이 실제로 무엇을 하는지는 돌려 보는
 * 시험(file-drop.test.tsx)이 본다.
 *
 * 🔴 여기서 못 박는 것은 하나다 — **떨군 파일이 고르기 칸으로 고른 것과 같은 함수를
 * 지나는가.** 두 길이 갈리면 떨구기로만 이상한 파일이 들어간다.
 * ============================================================================
 */

const read = (path: string) => readFileSync(path, "utf8").replace(/\r\n/g, "\n");
const flat = (path: string) => read(path).replace(/\s+/g, " ");

/** `src/` 아래의 `.tsx` 전부. 슬래시 경로로 돌려준다(윈도에서도 같은 글자). */
function tsxFilesUnder(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) found.push(...tsxFilesUnder(path));
    else if (entry.name.endsWith(".tsx")) found.push(path);
  }
  return found;
}

/**
 * 파일을 올리는 여덟 자리. `drop` 은 떨군 파일이 타는 식, `picker` 는 지금 고르기
 * 칸이 타는 식이다 — **두 줄에 같은 함수 이름이 있어야 한다**(같은 길이라는 뜻).
 *
 * 🔴 연락서 한 장 넣기(`kyosan-report-upload`)는 이 목록에 **빠져 있었다**
 * (2026-09-23 에 찾았다). 일곱 자리를 붙인 뒤에 생긴 자리라, 「고르기와 같은 길인가」를
 * 아무도 보고 있지 않았다. 실제로 「끌어다 놓으면 연락서를 못 읽는다」는 신고가 온 자리가
 * 바로 여기다 — 길이 같다는 것은 확인했고(같은 `onFileChange`), 다시 갈리지 않게 못 박는다.
 */
const SITES: {
  file: string;
  zone: string;
  multiple: boolean;
  drop: string;
  picker: string;
  why: string;
}[] = [
  {
    file: "src/components/excel-imports/KyosanImportRunParts.tsx",
    zone: 'name="kyosan-import-upload"',
    multiple: false,
    drop: "onFiles={(files) => onFileChange(files[0])}",
    picker: "onChange={(event) => onFileChange(event.target.files?.[0] ?? null)}",
    why: "과거 인수품 엑셀 — 판정은 부르는 쪽의 checkKyosanUploadFile",
  },
  {
    file: "src/components/excel-imports/KyosanReportImportParts.tsx",
    zone: 'name="kyosan-report-upload"',
    multiple: false,
    drop: "onFiles={(files) => onFileChange(files[0])}",
    picker: "onChange={(event) => onFileChange(event.target.files?.[0] ?? null)}",
    why: "연락서 한 장 — 판정은 부르는 쪽의 checkKyosanReportFile",
  },
  {
    file: "src/components/product-models/ProductModelFilesSection.tsx",
    zone: 'name="product-model-files-upload"',
    multiple: true,
    drop: "onFiles={receiveDroppedFiles}",
    picker: "const files = Array.from(fileInputRef.current?.files ?? []);",
    why: "제품 모델 파일 — 떨군 것을 고르기 칸에 담아 같은 handleUpload 가 읽는다",
  },
  {
    file: "src/components/quotes/QuoteAttachmentParts.tsx",
    zone: "name={`quote-attachment-${definition.category}`}",
    multiple: false,
    drop: "onFiles={(files) => onPickFile(files[0])}",
    picker: "onFile={onPickFile}",
    why: "견적서 첨부 — 판정은 부르는 쪽의 checkQuoteAttachmentFile",
  },
  {
    file: "src/components/quotes/NewQuoteDialog.tsx",
    zone: 'name="new-quote-excel"',
    multiple: false,
    drop: "onFiles={(files) => onPickExcel(files[0])}",
    picker: "onFile={onPickExcel}",
    why: "[새 견적서] 팝업의 수기 견적서 엑셀 — 판정은 폼의 엑셀 칸과 같은 checkQuoteAttachmentFile",
  },
  {
    file: "src/components/repair-cases/files/AttachmentFormDialog.tsx",
    zone: 'name="attachment-form-file"',
    multiple: false,
    drop: "onFiles={(files) => applyPickedFile(files[0])}",
    picker: "applyPickedFile(file);",
    why: "수리건 첨부 창 — 칸을 채우는 자리가 하나다",
  },
  {
    file: "src/components/repair-cases/files/FilesScreen.tsx",
    zone: 'name="repair-case-files-upload"',
    multiple: true,
    drop: "onFiles={receiveDroppedFiles}",
    picker: "onChange={notePickedFiles}",
    why: "수리건 파일 화면 — 떨군 것을 고르기 칸에 담아 같은 rejectionReasonFor 를 지난다",
  },
  {
    file: "src/components/settings/IntakeMailSettingsScreen.tsx",
    zone: 'name="intake-mail-signature-image"',
    multiple: false,
    drop: "onFiles={(files) => uploadImage(files[0])}",
    picker: "if (file) uploadImage(file);",
    why: "접수 메일 설정 서명 이미지 — 판정은 서버의 uploadSignatureImageAction",
  },
];

describe("🔴 파일을 올리는 여덟 자리가 모두 끌어다 놓기를 받는다", () => {
  for (const site of SITES) {
    test(`${site.file} — ${site.why}`, () => {
      const source = flat(site.file);

      assert.ok(
        source.includes('from "@/components/common/FileDropZone"'),
        "공통 조각을 부르지 않는다 — 자리마다 따로 짜면 일곱 번 틀릴 자리가 생긴다"
      );
      assert.ok(source.includes("<FileDropZone"), "떨구는 자리가 없다");
      assert.ok(source.includes(site.zone), `자리 이름(${site.zone})이 없다`);

      // 🔴 떨구기와 고르기가 **같은 함수**를 탄다.
      assert.ok(source.includes(site.drop), `떨군 파일이 타는 식이 없다: ${site.drop}`);
      assert.ok(source.includes(site.picker), `고르기 칸의 길이 바뀌었다: ${site.picker}`);
    });
  }

  test("🔴 하나만 받는 자리는 multiple 이 false 다 — 여럿을 놓으면 거절한다", () => {
    for (const site of SITES) {
      const source = flat(site.file);
      const zoneAt = source.indexOf(site.zone);
      assert.ok(zoneAt >= 0, site.file);
      // 자리 이름 바로 뒤 한 조각 안에 multiple 이 적혀 있다.
      const near = source.slice(zoneAt, zoneAt + 200);
      if (site.multiple) {
        assert.ok(/\bmultiple\b(?!=\{false\})/.test(near), `${site.file}: 여럿 받는 자리인데 multiple 이 없다`);
      } else {
        assert.ok(near.includes("multiple={false}"), `${site.file}: 하나만 받는 자리인데 multiple={false} 가 아니다`);
      }
    }
  });

  test("🔴 떨구는 자리를 새로 만들면 이 목록에도 적어야 한다 — 빠지면 아무도 안 본다", () => {
    const names = SITES.map((site) => site.zone);
    assert.equal(new Set(names).size, names.length, "자리 이름이 겹친다");

    // `src/` 를 훑어 `<FileDropZone` 을 그리는 파일을 모두 찾아 목록과 맞춘다.
    // (2026-09-23 이전에는 개수만 세고 있어 연락서 자리가 조용히 빠져 있었다.)
    const zoneFiles = tsxFilesUnder("src").filter(
      (path) =>
        path !== "src/components/common/FileDropZone.tsx" &&
        !path.endsWith(".test.tsx") &&
        read(path).includes("<FileDropZone")
    );

    assert.deepEqual(
      [...zoneFiles].sort(),
      [...new Set(SITES.map((site) => site.file))].sort(),
      "떨구는 자리가 목록과 다르다 — 새로 만든 자리를 SITES 에 적어라"
    );
    assert.equal(SITES.length, 8);
  });
});

describe("🔴 공통 조각은 검사를 하지 않는다", () => {
  test("허용목록 · 자리마다의 판정 모듈을 부르지 않는다", () => {
    const zone = read("src/components/common/file-drop.ts") + read("src/components/common/FileDropZone.tsx");
    for (const forbidden of [
      "attachment-allowlist",
      "attachment-category",
      "quote-attachment-files",
      "kyosan-import-view-model",
    ]) {
      assert.ok(!zone.includes(`from "@/lib/domain/${forbidden}"`), `공통 조각이 ${forbidden} 을 부른다`);
      assert.ok(!zone.includes(`./${forbidden}"`), `공통 조각이 ${forbidden} 을 부른다`);
    }
  });

  test("규칙 파일은 아무것도 부르지 않는다 — 부를 것이 없으면 갈릴 길도 없다", () => {
    const rules = read("src/components/common/file-drop.ts");
    assert.ok(!/^\s*import\s/m.test(rules), "file-drop.ts 가 무언가를 부른다");
    assert.ok(!/MAX_[A-Z_]*(SIZE|BYTES|COUNT)/.test(rules), "공통 조각에 크기 · 장수 상한이 적혀 있다");

    // 그리는 조각은 React 와 규칙 파일만 부른다.
    const imports = [...read("src/components/common/FileDropZone.tsx").matchAll(/from "([^"]+)"/g)].map(
      (match) => match[1]
    );
    assert.deepEqual(imports, ["react", "./file-drop"]);
  });
});

describe("🔴 앱 안 카메라는 대상이 아니다", () => {
  test("InAppCamera 는 건드리지 않았다 — 파일을 고르는 자리가 아니다", () => {
    const camera = read("src/components/repair-cases/files/InAppCamera.tsx");
    assert.ok(!camera.includes("FileDropZone"), "카메라에 떨구는 자리를 붙였다");
    assert.ok(!camera.includes("onDrop"), "카메라에 떨구기를 붙였다");
    assert.ok(!camera.includes("dataTransfer"), "카메라에 떨구기를 붙였다");
  });
});

describe("기존 고르기 칸은 그대로다", () => {
  test("여덟 자리 모두 고르기 칸(또는 고르기 단추)이 남아 있다", () => {
    // [새 견적서] 팝업은 견적서 첨부 칸의 **고르기 단추 조각**을 그대로 쓴다 — 그 조각 안에
    // 숨긴 `type="file"` 칸이 있다(QuoteAttachmentParts 의 QuoteAttachmentFilePicker).
    assert.ok(
      read("src/components/quotes/NewQuoteDialog.tsx").includes("<QuoteAttachmentFilePicker"),
      "src/components/quotes/NewQuoteDialog.tsx: 고르기 단추가 사라졌다"
    );
    const withPicker = [
      "src/components/excel-imports/KyosanImportRunParts.tsx",
      "src/components/excel-imports/KyosanReportImportParts.tsx",
      "src/components/product-models/ProductModelFilesSection.tsx",
      "src/components/quotes/QuoteAttachmentParts.tsx",
      "src/components/repair-cases/files/AttachmentFormDialog.tsx",
      "src/components/repair-cases/files/FilesScreen.tsx",
      "src/components/settings/IntakeMailSettingsScreen.tsx",
    ];
    for (const path of withPicker) {
      assert.ok(read(path).includes('type="file"'), `${path}: 고르기 칸이 사라졌다`);
    }
  });

  test("떨군 것을 고르기 칸에 담는 두 자리는 올릴 때 그 칸을 읽는다", () => {
    for (const path of [
      "src/components/product-models/ProductModelFilesSection.tsx",
      "src/components/repair-cases/files/FilesScreen.tsx",
    ]) {
      const source = flat(path);
      assert.ok(source.includes("putFilesInPicker(fileInputRef.current, files)"), path);
      assert.ok(source.includes("fileInputRef.current?.files ?? []"), `${path}: 올릴 때 고르기 칸을 읽지 않는다`);
    }
  });
});
