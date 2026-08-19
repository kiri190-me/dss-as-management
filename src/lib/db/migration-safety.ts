/**
 * ============================================================================
 * 마이그레이션에서 되돌릴 수 없는 문장을 찾아낸다
 * ============================================================================
 * 마이그레이션은 대개 표나 열을 **더한다**. 그런 문장은 잘못돼도 되돌릴 수
 * 있다. 그런데 가끔 지우는 문장이 섞이고, 그건 적용하는 순간 자료가 사라진다 —
 * git으로도, 되돌리기 마이그레이션으로도 복구되지 않는다.
 *
 * 이 파일은 SQL 텍스트만 보고 "지우는 문장"을 골라낸다. DB에 붙지 않으므로
 * 테스트하기 쉽고, 실제 개수 세기는 부르는 쪽(scripts/check-pending-migrations.ts)이
 * 한다.
 *
 * ── 왜 만들었나 ─────────────────────────────────────────────────────────
 * 2026-08-19에 Excel 이관 기능을 걷어내면서 표 3개를 drop했다. 그때는 사람이
 * 손으로 "이 표에 자료가 얼마나 있나", "다른 표가 이걸 참조하나"를 확인했다.
 * 다음번에도 누군가 그걸 기억하고 있으리라 기대하는 대신, 확인을 자동으로 하게
 * 만든 것이 이 장치다.
 *
 * ── 놓치는 것 ───────────────────────────────────────────────────────────
 * 정규식으로 읽으므로 완벽하지 않다. 문자열 안에 든 "DROP TABLE" 같은 것을
 * 잘못 잡을 수 있고, 아주 특이한 문법은 놓칠 수 있다. 그래도 **지우는 문장을
 * 못 보고 지나치는 것보다 한 번 더 물어보는 쪽이 낫다** — 이 도구는 막는 것이
 * 아니라 눈에 띄게 하는 것이 일이다.
 * ============================================================================
 */

export type DestructiveOperation =
  | { kind: "DROP_TABLE"; table: string }
  | { kind: "TRUNCATE"; table: string }
  | { kind: "DELETE"; table: string }
  | { kind: "DROP_COLUMN"; table: string; column: string }
  | { kind: "DROP_SCHEMA"; schema: string };

/** "public"."foo" / "foo" / foo → foo */
function bareName(raw: string): string {
  const parts = raw.split(".");
  const last = parts[parts.length - 1] ?? raw;
  return last.replace(/["`]/g, "").trim();
}

/** 주석을 걷어낸다 — 주석 속 예시 SQL을 진짜로 착각하지 않도록. */
function stripComments(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ");
}

const PATTERNS: {
  re: RegExp;
  build: (m: RegExpMatchArray) => DestructiveOperation;
}[] = [
  {
    re: /\bDROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?([\w".]+)/gi,
    build: (m) => ({ kind: "DROP_TABLE", table: bareName(m[1]) }),
  },
  {
    re: /\bTRUNCATE\s+(?:TABLE\s+)?(?:ONLY\s+)?([\w".]+)/gi,
    build: (m) => ({ kind: "TRUNCATE", table: bareName(m[1]) }),
  },
  {
    re: /\bDELETE\s+FROM\s+(?:ONLY\s+)?([\w".]+)/gi,
    build: (m) => ({ kind: "DELETE", table: bareName(m[1]) }),
  },
  {
    re: /\bALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?([\w".]+)[\s\S]*?\bDROP\s+COLUMN\s+(?:IF\s+EXISTS\s+)?([\w".]+)/gi,
    build: (m) => ({ kind: "DROP_COLUMN", table: bareName(m[1]), column: bareName(m[2]) }),
  },
  {
    re: /\bDROP\s+SCHEMA\s+(?:IF\s+EXISTS\s+)?([\w".]+)/gi,
    build: (m) => ({ kind: "DROP_SCHEMA", schema: bareName(m[1]) }),
  },
];

/**
 * 이 SQL이 지우는 것들.
 *
 * enum(DROP TYPE)은 일부러 넣지 않았다 — 타입을 지우는 것은 그 타입을 쓰던 표가
 * 이미 없다는 뜻이고, 자료가 사라지는 지점은 표 쪽이다. 여기서 함께 알리면
 * 진짜 위험한 줄이 묻힌다.
 */
export function findDestructiveOperations(sql: string): DestructiveOperation[] {
  const clean = stripComments(sql);
  const found: DestructiveOperation[] = [];
  const seen = new Set<string>();

  for (const { re, build } of PATTERNS) {
    // 매 호출마다 새로 만들어 lastIndex가 남지 않게 한다.
    const pattern = new RegExp(re.source, re.flags);
    for (const match of clean.matchAll(pattern)) {
      const op = build(match);
      const key = JSON.stringify(op);
      if (seen.has(key)) continue;
      seen.add(key);
      found.push(op);
    }
  }
  return found;
}

/** 사람이 읽을 한 줄. */
export function describeOperation(op: DestructiveOperation): string {
  switch (op.kind) {
    case "DROP_TABLE":
      return `표 삭제: ${op.table}`;
    case "TRUNCATE":
      return `표 비우기: ${op.table}`;
    case "DELETE":
      return `행 삭제: ${op.table}`;
    case "DROP_COLUMN":
      return `열 삭제: ${op.table}.${op.column}`;
    case "DROP_SCHEMA":
      return `스키마 삭제: ${op.schema}`;
  }
}
