/**
 * 저장소의 모든 *.test.ts(x) 가 시험 목록(scripts/test-lists/*.txt) 가운데 적어도 하나에
 * 들어 있는가.
 *
 * 시험은 목록에 적혀야만 돈다. 목록에서 빠진 파일은 아무 소리 없이 영영 안 돈다 —
 * 실패도 경고도 없다. 이 저장소에서 실제로 여러 번 겪었다. 그래서 파일 시스템을 직접
 * 걸어(git 에 기대지 않는다 — 아직 add 하지 않은 새 파일도 잡혀야 한다) 목록과 맞춘다.
 *
 * 걷는 범위: 저장소 뿌리 아래 전부. node_modules 와 점으로 시작하는 폴더(.git · .next ·
 * .claude 의 작업 트리 사본 등)는 건너뛴다.
 *
 * 목록 읽기·패턴 펼치기는 scripts/run-test-list.mjs 의 것을 그대로 쓴다 — 실행기와
 * 이 시험이 서로 다른 규칙으로 목록을 읽으면 이 시험이 무의미해진다.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

import {
  LIST_DIR,
  ROOT,
  expandPattern,
  findListProblems,
  isPatternEntry,
  listNames,
  readTestList,
} from "../run-test-list.mjs";

/**
 * 일부러 어느 목록에도 넣지 않는 시험 파일. 적으려면 이유를 반드시 단다.
 * 지금은 비어 있다 — 모든 시험 파일이 어딘가에서 돈다.
 */
const UNLISTED_ON_PURPOSE: ReadonlyArray<{ path: string; reason: string }> = [];

const TEST_FILE = /\.test\.tsx?$/;

function walkTestFiles(dir: string, found: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      walkTestFiles(path.join(dir, entry.name), found);
    } else if (entry.isFile() && TEST_FILE.test(entry.name)) {
      found.push(path.relative(ROOT, path.join(dir, entry.name)).split(path.sep).join("/"));
    }
  }
  return found;
}

/** package.json 이 run-test-list.mjs 로 부르는 목록 이름들. */
function listsWiredInPackageJson(): string[] {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")) as {
    scripts: Record<string, string>;
  };
  const names: string[] = [];
  for (const command of Object.values(pkg.scripts)) {
    for (const match of command.matchAll(/run-test-list\.mjs\s+(\S+)/g)) {
      names.push(match[1]);
    }
  }
  return [...new Set(names)].sort();
}

/** 목록들이 실제로 가리키는 파일 전부(패턴 줄은 펼친 결과로 센다). */
function registeredFiles(names: readonly string[]): Set<string> {
  const files = new Set<string>();
  for (const name of names) {
    for (const entry of readTestList(name)) {
      if (isPatternEntry(entry)) {
        for (const match of expandPattern(entry)) files.add(match);
      } else {
        files.add(entry);
      }
    }
  }
  return files;
}

describe("시험 목록 등록 감시", () => {
  const wired = listsWiredInPackageJson();

  test("package.json 이 부르는 목록과 목록 폴더의 .txt 가 한 짝이다 — 부르지 않는 목록은 안 돈다", () => {
    assert.ok(wired.length > 0, "package.json 에서 run-test-list.mjs 호출을 하나도 못 찾았다");
    assert.deepEqual(
      listNames(),
      wired,
      `${path.relative(ROOT, LIST_DIR)} 의 목록과 package.json 이 부르는 목록이 다르다`,
    );
  });

  test("목록마다 없는 파일·빈 패턴·중복 줄이 없다", () => {
    for (const name of wired) {
      assert.deepEqual(findListProblems(readTestList(name)), [], `${name}.txt 에 문제가 있다`);
    }
  });

  test("저장소의 모든 *.test.ts(x) 가 네 목록 가운데 적어도 하나에 들어 있다", () => {
    const onDisk = walkTestFiles(ROOT).sort();
    // 걷기가 조용히 망가져 0개를 찾고 통과하는 일이 없게, 이 파일 자신이 잡혀야 한다.
    assert.ok(
      onDisk.includes("scripts/test-lists/test-list-registration.test.ts"),
      "파일 시스템 걷기가 이 시험 파일조차 못 찾았다",
    );

    const registered = registeredFiles(wired);
    const exempt = new Set(UNLISTED_ON_PURPOSE.map((item) => item.path));
    const unlisted = onDisk.filter((file) => !registered.has(file) && !exempt.has(file));
    assert.deepEqual(
      unlisted,
      [],
      "어느 시험 목록에도 없는 시험 파일이 있다 — scripts/test-lists/ 의 알맞은 목록에 한 줄 더할 것" +
        "(플래그가 다르다: unit · components · db-safety · db, 각 파일 머리 참조)",
    );
  });

  test("예외 목록은 이유를 달고, 실제로 목록 밖에 있는 파일만 적는다", () => {
    const registered = registeredFiles(wired);
    for (const item of UNLISTED_ON_PURPOSE) {
      assert.ok(item.reason.trim() !== "", `${item.path}: 예외에는 이유가 있어야 한다`);
      assert.ok(fs.existsSync(path.join(ROOT, item.path)), `${item.path}: 없는 파일을 예외로 적었다`);
      assert.ok(!registered.has(item.path), `${item.path}: 이미 목록에 있다 — 예외에서 지울 것`);
    }
  });
});
