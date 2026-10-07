import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { resolveRepairDocsArchiveRoot } from "./repair-docs-archive";

/**
 * ============================================================================
 * 「수리 관련」 서류 공유폴더 루트 — 읽는 시점 · 꺼짐 (2026-10-07)
 * ============================================================================
 * 이웃 셋(견적서 · 연락서 · 현황표)과 **같은 약속**을 값으로 못 박는다:
 *  · 비었거나 공백이면 null — 그 기능만 조용히 꺼진다.
 *  · 🔴 **부르는 시점에** 읽는다 — 모듈을 불러오는 것만으로 값이 굳으면, 시험이 환경을
 *    갈아 끼워도 첫 값이 그대로 산다(= 시험이 사내 서류함을 보게 되는 길이다).
 * 디스크를 건드리지 않는다 — 경로를 다듬기만 한다.
 * ============================================================================
 */
test("resolveRepairDocsArchiveRoot — 부르는 시점에 읽고, 비었거나 공백이면 null(기능 꺼짐)", () => {
  const original = process.env.REPAIR_DOCS_ARCHIVE_DIR;
  try {
    delete process.env.REPAIR_DOCS_ARCHIVE_DIR;
    assert.equal(resolveRepairDocsArchiveRoot(), null);

    process.env.REPAIR_DOCS_ARCHIVE_DIR = "";
    assert.equal(resolveRepairDocsArchiveRoot(), null);

    process.env.REPAIR_DOCS_ARCHIVE_DIR = "   ";
    assert.equal(resolveRepairDocsArchiveRoot(), null);

    const first = path.join(os.tmpdir(), "repair-docs-root-a");
    process.env.REPAIR_DOCS_ARCHIVE_DIR = `  ${first}  `;
    assert.equal(resolveRepairDocsArchiveRoot(), path.resolve(first));

    // 모듈을 불러온 뒤에 바꿔도 새 값을 읽는다.
    const second = path.join(os.tmpdir(), "repair-docs-root-b");
    process.env.REPAIR_DOCS_ARCHIVE_DIR = second;
    assert.equal(resolveRepairDocsArchiveRoot(), path.resolve(second));
  } finally {
    if (original === undefined) delete process.env.REPAIR_DOCS_ARCHIVE_DIR;
    else process.env.REPAIR_DOCS_ARCHIVE_DIR = original;
  }
});
