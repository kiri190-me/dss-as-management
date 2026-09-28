import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

import {
  KYOSAN_NON_DOCUMENT_MAX_BYTES,
  KYOSAN_RUN_OUTCOME_ORDER,
  USED_PARTS_SKIPPED_WARNING_MARK,
  classifyPlanOutcome,
  countUsedPartsSkippedFiles,
  emptyRunTally,
  findDuplicateHashGroups,
  isKyosanNonDocumentFile,
  isUsedPartsSkippedWarning,
  kyosanMessageKind,
  looksLikeZipArchive,
  outcomeForFailureCode,
  runTallyTotal,
  tallyMessageKinds,
  tallyRunOutcomes,
} from "./kyosan-import-run-plan";

/**
 * ============================================================================
 * 일괄 이식 러너의 **가려내는 규칙 · 세는 규칙** (조각 S5-C)
 * ============================================================================
 * DB 없이 돈다. 이 시험이 지키는 것 넷:
 *
 *  1. 🔴 **문서가 아닌 파일을 오류로 세지 않는다** — 백업된 503장 가운데 31장이
 *     165바이트짜리 엑셀 잠금 파일(`~$…`)이다. 그것이 「실패 31장」으로 찍히면
 *     아무도 그 수가 정상인지 모른다.
 *  2. 🔴 **계획의 판정이 이식기와 갈라지지 않는다** — `classifyPlanOutcome` 은
 *     `kyosan-report-import.ts` 의 네 줄을 그대로 옮긴 것이다.
 *  3. 🔴 **부품 건너뛰기를 놓치지 않는다** — 이식이 실패하지 않고 경고만 남는
 *     갈래라, 세지 않으면 나중에 「부품이 왜 안 들어왔지」가 터진다. 가르는 글자가
 *     이식기와 같은지 **그 파일을 읽어** 본다.
 *  4. 🔴 **같은 파일을 두 번 세지 않되, 이름이 아니라 내용으로 가른다** — 백업된
 *     두 폴더는 파일 이름이 겹치지만 내용은 전부 다르다.
 * ============================================================================
 */

/** 시험은 저장소 뿌리에서 돈다(`kyosan-import-revert-plan.test.ts` 와 같은 방식). */
const REPO_ROOT = process.cwd();

function zipBytes(size: number): Buffer {
  const bytes = Buffer.alloc(size, 0x41);
  bytes[0] = 0x50;
  bytes[1] = 0x4b;
  bytes[2] = 0x03;
  bytes[3] = 0x04;
  return bytes;
}

/** 실측 그대로 — 165바이트, 앞머리가 ZIP 이 아니다. */
function lockFileBytes(): Buffer {
  const bytes = Buffer.alloc(165, 0x00);
  bytes.set([0x06, 0xc1, 0xa4, 0xbf, 0xb5, 0xba, 0xf3], 0);
  return bytes;
}

// ══════════════════════════════════════════════ 1. 문서가 아닌 파일

describe("🔴 문서가 아닌 파일을 오류가 아니라 「건너뜀」으로 가려낸다", () => {
  test("165바이트 엑셀 잠금 파일은 문서가 아니다", () => {
    assert.equal(isKyosanNonDocumentFile(lockFileBytes()), true);
  });

  test("작아도 ZIP 이면 문서다 — 여는 일은 판독기가 한다", () => {
    assert.equal(isKyosanNonDocumentFile(zipBytes(200)), false);
    assert.equal(looksLikeZipArchive(zipBytes(200)), true);
  });

  test("ZIP 이 아니어도 상한보다 크면 「문서인데 못 읽었다」 쪽이다", () => {
    const big = Buffer.alloc(KYOSAN_NON_DOCUMENT_MAX_BYTES + 1, 0x41);
    assert.equal(isKyosanNonDocumentFile(big), false);
  });

  test("경계값 — 상한과 같으면 문서가 아니고, 한 바이트 크면 문서 쪽이다", () => {
    assert.equal(isKyosanNonDocumentFile(Buffer.alloc(KYOSAN_NON_DOCUMENT_MAX_BYTES, 0x41)), true);
    assert.equal(isKyosanNonDocumentFile(Buffer.alloc(KYOSAN_NON_DOCUMENT_MAX_BYTES + 1, 0x41)), false);
  });

  test("빈 파일도 문서가 아니다 — 앞머리를 읽을 것조차 없다", () => {
    assert.equal(isKyosanNonDocumentFile(Buffer.alloc(0)), true);
    assert.equal(looksLikeZipArchive(Buffer.alloc(2)), false);
  });

  test("ZIP 의 다른 서명들도 문서로 본다(빈 저장소 · 분할)", () => {
    const empty = Buffer.from([0x50, 0x4b, 0x05, 0x06, 0x00]);
    const spanned = Buffer.from([0x50, 0x4b, 0x07, 0x08, 0x00]);
    assert.equal(looksLikeZipArchive(empty), true);
    assert.equal(looksLikeZipArchive(spanned), true);
    assert.equal(looksLikeZipArchive(Buffer.from([0x50, 0x4b, 0x09, 0x09])), false);
  });
});

// ══════════════════════════════════════════════ 2. 계획의 판정

describe("🔴 계획의 판정은 이식기의 네 줄 그대로다", () => {
  test("짝이 있고 계획이 있으면 「넣을 수 있음」", () => {
    assert.equal(
      classifyPlanOutcome({ hasMatch: true, hasPlan: true, caseAlreadyHasSourceHash: false }),
      "importable"
    );
  });

  test("계획이 없고 그 건에 같은 해시가 이미 있으면 「이미 있음」", () => {
    assert.equal(
      classifyPlanOutcome({ hasMatch: true, hasPlan: false, caseAlreadyHasSourceHash: true }),
      "already-imported"
    );
  });

  test("계획이 없고 해시도 없으면 「짝 없음·막힘」", () => {
    assert.equal(
      classifyPlanOutcome({ hasMatch: true, hasPlan: false, caseAlreadyHasSourceHash: false }),
      "not-importable"
    );
  });

  test("🔴 짝이 없으면 해시가 있어도 「이미 있음」이 아니다 — 견줄 건이 없다", () => {
    assert.equal(
      classifyPlanOutcome({ hasMatch: false, hasPlan: false, caseAlreadyHasSourceHash: true }),
      "not-importable"
    );
  });

  test("🔴 실패 코드 일곱이 빠짐없이 갈래로 옮겨진다", () => {
    assert.equal(outcomeForFailureCode("ALREADY_IMPORTED"), "already-imported");
    assert.equal(outcomeForFailureCode("NOT_IMPORTABLE"), "not-importable");
    for (const code of [
      "TARGET_CHANGED",
      "SOURCE_REJECTED",
      "SOURCE_TOO_LARGE",
      "STORAGE_FAILED",
      "SAVE_REJECTED",
    ] as const) {
      assert.equal(outcomeForFailureCode(code), "failed", code);
    }
  });
});

// ══════════════════════════════════════════════ 3. 세기

describe("결과를 갈래별로 센다", () => {
  test("합계가 훑은 장수와 같다 — 어느 갈래에도 안 들어간 장이 없다", () => {
    const tally = tallyRunOutcomes([
      "importable",
      "importable",
      "already-imported",
      "not-importable",
      "not-importable",
      "not-importable",
      "non-document",
      "unreadable",
      "failed",
    ]);
    assert.equal(tally.importable, 2);
    assert.equal(tally["already-imported"], 1);
    assert.equal(tally["not-importable"], 3);
    assert.equal(tally["non-document"], 1);
    assert.equal(tally.unreadable, 1);
    assert.equal(tally.failed, 1);
    assert.equal(tally.imported, 0);
    assert.equal(runTallyTotal(tally), 9);
  });

  test("빈 표는 0 이고, 표에 찍는 차례가 갈래를 하나도 빠뜨리지 않는다", () => {
    const empty = emptyRunTally();
    assert.equal(runTallyTotal(empty), 0);
    assert.deepEqual([...KYOSAN_RUN_OUTCOME_ORDER].sort(), Object.keys(empty).sort());
  });
});

// ══════════════════════════════════════════════ 4. 같은 해시

describe("🔴 같은 파일을 두 번 세지 않는다 — 이름이 아니라 내용(sha256)으로", () => {
  test("이름이 겹쳐도 내용이 다르면 중복이 아니다 — 백업된 두 폴더가 그 모양이다", () => {
    const groups = findDuplicateHashGroups([
      { fileName: "0001.xlsm", sha256: "aaaa" },
      { fileName: "0001.xlsm", sha256: "bbbb" },
      { fileName: "0002.xlsm", sha256: "cccc" },
    ]);
    assert.deepEqual(groups, []);
  });

  test("이름이 달라도 내용이 같으면 중복으로 알린다", () => {
    const groups = findDuplicateHashGroups([
      { fileName: "0001.xlsm", sha256: "aaaa" },
      { fileName: "D210101.xlsx", sha256: "aaaa" },
      { fileName: "0002.xlsm", sha256: "bbbb" },
      { fileName: "0003.xlsm", sha256: "bbbb" },
      { fileName: "0004.xlsm", sha256: "bbbb" },
      { fileName: "0005.xlsm", sha256: "cccc" },
    ]);
    assert.equal(groups.length, 2);
    assert.deepEqual(
      groups.find((group) => group.sha256 === "aaaa")?.fileNames,
      ["0001.xlsm", "D210101.xlsx"]
    );
    assert.equal(groups.find((group) => group.sha256 === "bbbb")?.fileNames.length, 3);
  });

  test("빈 목록에서는 아무것도 알리지 않는다", () => {
    assert.deepEqual(findDuplicateHashGroups([]), []);
  });
});

// ══════════════════════════════════════════════ 5. 경고 · 막은 까닭

describe("경고를 종류별로 센다", () => {
  test("수만 다른 문장은 한 종류로 묶인다", () => {
    assert.equal(kyosanMessageKind("교체 부품 3건을 사용 부품 칸에 적지 않았습니다 — 잠김"), kyosanMessageKind("교체 부품 17건을 사용 부품 칸에 적지 않았습니다 — 잠김"));
  });

  test("🔴 장 단위로 센다 — 한 장이 같은 종류를 두 줄 남겨도 1장이다", () => {
    const rows = tallyMessageKinds([
      ["사진 1장은 첨부로 받을 수 있는 그림이 아니라 건너뛰었습니다.", "사진 2장은 첨부로 받을 수 있는 그림이 아니라 건너뛰었습니다."],
      ["사진 5장은 첨부로 받을 수 있는 그림이 아니라 건너뛰었습니다."],
      [],
    ]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].files, 2);
    assert.ok(rows[0].kind.includes("사진 N장"), rows[0].kind);
  });

  test("많은 것부터 찍는다", () => {
    const rows = tallyMessageKinds([["가"], ["가"], ["나"], ["가"], ["나"]]);
    assert.deepEqual(rows, [
      { kind: "가", files: 3 },
      { kind: "나", files: 2 },
    ]);
  });

  test("🔴 부품 건너뛰기를 놓치지 않는다", () => {
    const perFile = [
      ["교체 부품 3건을 사용 부품 칸에 적지 않았습니다 — 출하 완료로 잠긴 접수 건입니다."],
      ["사진 1장은 첨부로 받을 수 있는 그림이 아니라 건너뛰었습니다."],
      ["교체 부품 1건을 사용 부품 칸에 적지 않았습니다 — 부품 요청(반출) 이력에서 잡힙니다."],
      [],
    ];
    assert.equal(countUsedPartsSkippedFiles(perFile), 2);
    assert.equal(isUsedPartsSkippedWarning(perFile[1][0]), false);
  });
});

// ══════════════════════════════════════════════ 6. 🔴 이식기·러너의 글자를 읽어 못 박는다

describe("🔴 러너가 이식기와 갈라지지 않았는가 — 파일의 글자를 읽어 본다", () => {
  const importerSource = readFileSync(
    path.join(REPO_ROOT, "src", "lib", "server", "services", "kyosan-report-import.ts"),
    "utf8"
  );
  const engineSource = readFileSync(path.join(REPO_ROOT, "scripts", "lib", "kyosan-import-run.ts"), "utf8");
  const cliSource = readFileSync(path.join(REPO_ROOT, "scripts", "import-kyosan-reports.ts"), "utf8");

  test("부품 건너뛰기를 가르는 글자가 이식기에 그대로 있다", () => {
    assert.ok(
      importerSource.includes(USED_PARTS_SKIPPED_WARNING_MARK),
      `이식기의 경고 문구가 바뀌었다 — 「${USED_PARTS_SKIPPED_WARNING_MARK}」 를 더 이상 찾을 수 없다. ` +
        "러너가 부품 건너뛰기를 세지 못하게 된다."
    );
  });

  test("🔴 러너에 수리 건을 만드는 길이 없다 — 이식기의 「짝이 없으면 안 넣는다」를 우회하지 않는다", () => {
    for (const [name, source] of [
      ["scripts/lib/kyosan-import-run.ts", engineSource],
      ["scripts/import-kyosan-reports.ts", cliSource],
    ] as const) {
      assert.equal(source.includes("createRepairCase"), false, `${name} 이 수리 건을 만든다`);
      assert.equal(source.includes("repairCases"), false, `${name} 이 repair_cases 표를 직접 만진다`);
    }
  });

  test("🔴 러너가 DB 에 직접 쓰지 않는다 — 쓰기는 전부 이식기의 트랜잭션 안이다", () => {
    for (const [name, source] of [
      ["scripts/lib/kyosan-import-run.ts", engineSource],
      ["scripts/import-kyosan-reports.ts", cliSource],
    ] as const) {
      // 🔴 `createHash(…).update(…)` 같은 남의 `.update(` 에 걸리지 않게 받는 쪽을 함께 본다.
      for (const forbidden of [
        "db.insert(",
        "db.update(",
        "db.delete(",
        "tx.insert(",
        "tx.update(",
        "tx.delete(",
      ]) {
        assert.equal(source.includes(forbidden), false, `${name} 에 ${forbidden} 가 있다`);
      }
    }
  });

  test("🔴 저장소 어댑터를 계획 단계에서 만들지 않는다 — `apply` 일 때만 부른다", () => {
    assert.ok(
      /options\.apply\s*\?\s*\(options\.storage\s*\?\?\s*getAttachmentStorage\(\)\)\s*:\s*null/.test(engineSource),
      "계획 단계가 UPLOADS_DIR 을 읽지 않는다는 보장이 사라졌다"
    );
  });
});
