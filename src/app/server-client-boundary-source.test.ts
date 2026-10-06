import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

/**
 * ============================================================================
 * 🔴 서버 컴포넌트가 **`"use client"` 파일이 내보낸 것을 함수로 부르지 않는다** (2026-10-06)
 * ============================================================================
 * 실제로 터뜨린 적이 있다 — 수리 건 상세의 「견적서」 탭이 통째로 안 열렸다:
 *
 *     Error: Attempted to call hasQuoteArchiveProductKeys() from the server but
 *     hasQuoteArchiveProductKeys is on the client. It's not possible to invoke a
 *     client function from the server, it can only be rendered as a Component or
 *     passed to props of a Client Component.
 *
 * `"use client"` 파일의 export 는 번들러가 **「클라이언트 참조」로 바꿔치기**한다. 서버에서는
 * 컴포넌트로 **그리거나**(`<Foo />`) 클라이언트 컴포넌트의 props 로 **넘기는** 것만 된다.
 * 순수 함수라도 서버에서 괄호를 붙여 부르면 그 자리에서 터진다.
 *
 * 🔴 **이 고장은 타입 검사도 단위 시험도 못 잡는다.** 타입은 맞고(함수 모양 그대로다),
 * 시험은 두 파일을 다 클라이언트로 불러 쓴다. `npm run build` 를 돌리거나 실제로 그 화면을
 * 열어야 드러난다 — 즉 **사용자가 먼저 본다.** 그래서 원본 글자로 미리 막는다.
 *
 * ── 무엇을 보는가 ───────────────────────────────────────────────────────
 * `src/app/` 아래의 **서버 쪽 파일**(그 파일 자신에 `"use client"` 가 없는 것)이
 *  1. `"use client"` 파일에서 무엇을 가져오고
 *  2. 그 이름을 **괄호를 붙여 부르는가**
 * 를 본다. 둘 다면 고장이다.
 *
 * ── 🔴 무엇을 보지 않는가 (일부러) ───────────────────────────────────────
 *  · `import type { … }` 과 `{ type X }` — 타입은 번들에 남지 않는다. 가져와도 된다.
 *  · 컴포넌트로 **그리는** 것(`<Foo />`) · props 로 **넘기는** 것 — 바로 그 둘이 되는 길이다.
 *  · `src/app/` 밖 — `src/components/` 의 `"use client"` 없는 파일은 **클라이언트 쪽 부모가
 *    가져다 쓰면 클라이언트 모듈이 된다**(Next 가 부모를 따라 가른다). 그 자리는 훅을 부르는
 *    것이 정상이라 여기서 보면 헛걸린다. 서버/클라이언트가 갈리는 지점은 `src/app/` 이다.
 *
 * ── 뚫릴 자리 ───────────────────────────────────────────────────────────
 * 원본 글자로 보는 시험이라 완전하지 않다 — `import()` 로 늦게 부르거나 이름을 변수에 담아
 * 부르면 못 본다. 그래도 **실제로 일어난 모양**(위에서 함수 하나를 가져와 바로 부른다)은 막는다.
 * ============================================================================
 */

const srcDir = fileURLToPath(new URL("../", import.meta.url));
const appDir = path.join(srcDir, "app");

const SOURCE_FILE = /\.tsx?$/;
const TEST_FILE = /\.test\.tsx?$/;

function walk(dir: string, found: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      walk(full, found);
    } else if (SOURCE_FILE.test(entry.name) && !TEST_FILE.test(entry.name)) {
      found.push(full);
    }
  }
  return found;
}

const textCache = new Map<string, string | null>();
function readSource(file: string): string | null {
  const cached = textCache.get(file);
  if (cached !== undefined) return cached;
  let text: string | null = null;
  try {
    text = fs.readFileSync(file, "utf8").replace(/^﻿/, "").replace(/\r\n/g, "\n");
  } catch {
    text = null;
  }
  textCache.set(file, text);
  return text;
}

/** 주석을 뺀 원본 — 머리말이 까닭을 설명하느라 적은 낱말에 걸리지 않게. */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

/** 그 파일 자신의 첫 줄이 `"use client"` 인가 — 주석 머리말은 앞에 있어도 된다. */
function isClientModule(file: string): boolean {
  const source = readSource(file);
  if (source === null) return false;
  const head = withoutComments(source).trimStart();
  return head.startsWith('"use client"') || head.startsWith("'use client'");
}

/** `@/…` 와 상대경로만 푼다. 패키지(`react` 등)는 null — 볼 것이 없다. */
function resolveImport(spec: string, fromFile: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = path.join(srcDir, spec.slice(2));
  else if (spec.startsWith(".")) base = path.resolve(path.dirname(fromFile), spec);
  else return null;
  for (const candidate of [`${base}.tsx`, `${base}.ts`, path.join(base, "index.tsx"), path.join(base, "index.ts")]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
}

type ImportedName = { local: string; spec: string };

/** 가져온 이름들 — 타입만 가져오는 줄과 `{ type X }` 는 뺀다. */
function importedNames(code: string, fromFile: string): ImportedName[] {
  const names: ImportedName[] = [];
  for (const match of code.matchAll(/\bimport\s+(type\s+)?([\s\S]*?)\s+from\s+["']([^"']+)["']/g)) {
    if (match[1]) continue;
    const clause = match[2];
    const spec = match[3];
    const target = resolveImport(spec, fromFile);
    if (target === null || !isClientModule(target)) continue;

    // `import Foo, { a, b as c } from "…"` — 기본 이름과 중괄호 안을 모두 본다.
    const braces = clause.match(/\{([\s\S]*)\}/);
    const defaultPart = clause.slice(0, braces ? clause.indexOf("{") : clause.length).replace(/,\s*$/, "").trim();
    if (defaultPart !== "" && !defaultPart.startsWith("*")) names.push({ local: defaultPart, spec });
    for (const raw of braces ? braces[1].split(",") : []) {
      const part = raw.trim();
      if (part === "" || /^type\b/.test(part)) continue;
      const local = (part.split(/\s+as\s+/).pop() ?? "").trim();
      if (local !== "") names.push({ local, spec });
    }
  }
  return names;
}

/** import 줄을 뺀 몸통 — 「가져온다」가 아니라 「부른다」만 본다. */
function bodyWithoutImports(code: string): string {
  return code.replace(/\bimport\s+(?:type\s+)?[\s\S]*?\s+from\s+["'][^"']+["'];?/g, "");
}

function isCalled(body: string, name: string): boolean {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![A-Za-z0-9_$.])${escaped}\\s*\\(`).test(body);
}

const appServerFiles = walk(appDir).filter((file) => !isClientModule(file));

describe("🔴 서버/클라이언트 경계 — 서버가 클라이언트 함수를 부르지 않는다", () => {
  test("걷기가 조용히 망가지지 않았다 — 실제로 볼 파일이 있다", () => {
    assert.ok(appServerFiles.length > 50, `src/app 아래 서버 파일을 ${appServerFiles.length}개밖에 못 찾았다`);
    // 이 고장이 났던 바로 그 파일이 표본에 들어 있어야 한다.
    const quotesTab = appServerFiles.map((file) => path.relative(srcDir, file).split(path.sep).join("/"));
    assert.ok(
      quotesTab.includes("app/(app)/repair-cases/[id]/quotes/page.tsx"),
      "고장이 났던 「견적서」 탭이 표본에 없다"
    );
  });

  test('🔴 `"use client"` 파일에서 가져온 이름을 서버가 괄호 붙여 부르지 않는다', () => {
    const offences: string[] = [];
    for (const file of appServerFiles) {
      const source = readSource(file);
      if (source === null) continue;
      const code = withoutComments(source);
      const body = bodyWithoutImports(code);
      for (const { local, spec } of importedNames(code, file)) {
        if (isCalled(body, local)) {
          const where = path.relative(srcDir, file).split(path.sep).join("/");
          offences.push(`src/${where}: ${local}() ← "use client" 인 ${spec}`);
        }
      }
    }
    assert.deepEqual(
      offences,
      [],
      '서버 컴포넌트가 `"use client"` 파일의 함수를 부른다 — 그 화면은 열리지 않는다. ' +
        "순수 함수라면 `\"use client\"` 가 없는 중립 파일로 옮길 것" +
        "(본보기: src/components/quotes/quote-archive-product-keys.ts)"
    );
  });
});
