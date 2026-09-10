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

/**
 * ── 두 갈래가 함께 쓴다 ─────────────────────────────────────────────────
 * 문장 단위로 자른다.
 *
 * 대상 이름과 동작 사이를 문장 경계 너머까지 건너뛰면, 앞 문장의 표 이름이 뒷
 * 문장의 동작에 붙는다. 0029(2026)가 실제로 그랬다 — 그 파일 위쪽 다른 표의
 * 이름이 아래쪽 열 삭제에 붙었고, **부르는 쪽은 그 이름으로 행을 센다.** 엉뚱한
 * 표를 세면 숫자가 틀릴 뿐 아니라 정작 사라지는 표는 한 번도 세지 않는다. 잘못
 * 붙은 표가 비어 있었다면 "비어 있음"이라는 거짓 안심까지 나온다.
 *
 * 그래서 두 갈래 모두 먼저 잘라 두고 **한 문장 안에서만** 이름과 동작을 짝짓는다.
 * 자르는 규칙을 갈래마다 따로 두면 언젠가 한쪽만 고쳐지므로 한 벌만 둔다.
 *
 * 주석을 걷어낸 뒤라 `--> statement-breakpoint`는 이미 사라졌고, 남는 구분자는
 * 세미콜론뿐이다. 이 저장소의 마이그레이션에는 함수 본문(`$$ ... $$`)이 없어
 * 세미콜론으로 갈라도 문장이 깨지지 않는다.
 */
function splitStatements(sql: string): string[] {
  return sql
    .split(";")
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}

/** `ALTER TABLE <이름> <나머지>` 로 시작하는 문장에서 표 이름과 나머지를 가른다. */
const ALTER_TABLE_HEAD =
  /^ALTER\s+TABLE\s+(?:ONLY\s+)?(?:IF\s+EXISTS\s+)?([\w".]+)\s+([\s\S]+)$/i;

/**
 * 어느 표에 매이지 않은 문장들 — 대상 이름이 그 문장 안에 바로 붙어 있다.
 * 문장 단위로 돌리기는 하지만, 이름이 동작에 붙어 있어 원래도 어긋나지 않았다.
 */
const STANDALONE_DESTRUCTIVE: {
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
    re: /\bDROP\s+SCHEMA\s+(?:IF\s+EXISTS\s+)?([\w".]+)/gi,
    build: (m) => ({ kind: "DROP_SCHEMA", schema: bareName(m[1]) }),
  },
];

/**
 * 표 하나에 매인 문장. 표 이름은 위 머리에서 이미 떼어 냈으므로 여기서는 동작만 본다.
 *
 * 한 문장이 칸을 여럿 지우는 모양도 있으므로 문장 안에서 전부 훑는다.
 */
const TABLE_SCOPED_DESTRUCTIVE: {
  re: RegExp;
  build: (table: string, m: RegExpMatchArray) => DestructiveOperation;
}[] = [
  {
    re: /\bDROP\s+COLUMN\s+(?:IF\s+EXISTS\s+)?([\w".]+)/gi,
    build: (table, m) => ({ kind: "DROP_COLUMN", table, column: bareName(m[1]) }),
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
  const found: DestructiveOperation[] = [];
  const seen = new Set<string>();

  const remember = (op: DestructiveOperation) => {
    const key = JSON.stringify(op);
    if (seen.has(key)) return;
    seen.add(key);
    found.push(op);
  };

  for (const statement of splitStatements(stripComments(sql))) {
    for (const { re, build } of STANDALONE_DESTRUCTIVE) {
      // 매 호출마다 새로 만들어 lastIndex가 남지 않게 한다.
      const pattern = new RegExp(re.source, re.flags);
      for (const match of statement.matchAll(pattern)) remember(build(match));
    }

    const head = statement.match(ALTER_TABLE_HEAD);
    if (!head) continue;

    const table = bareName(head[1]);
    const rest = head[2];
    for (const { re, build } of TABLE_SCOPED_DESTRUCTIVE) {
      const pattern = new RegExp(re.source, re.flags);
      for (const match of rest.matchAll(pattern)) remember(build(table, match));
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

/**
 * ============================================================================
 * 둘째 갈래 — 자료는 남지만 사람이 눈으로 확인해야 하는 문장
 * ============================================================================
 * 위 갈래는 "자료가 사라지는가"만 본다. 그래서 부르는 쪽이 대상 표의 행을 세어
 * "N건이 사라집니다"를 찍을 수 있었다.
 *
 * 그런데 이 저장소는 인가와 무결성의 상당 부분을 유니크 인덱스와 CHECK 제약에
 * 맡기고 있다 — 「한 번에 한 단계만 결재 대기」, 「지금 쓰는 결재선 판은 하나」가
 * 전부 그렇다. 그 인덱스가 없어져도 자료는 한 줄도 사라지지 않지만, 다음 날부터
 * 중복이 조용히 들어온다. 2026-09-10에 인덱스를 하나 없애고 하나 만드는
 * 마이그레이션이 실제로 "더하기만 합니다"로 통과했다.
 *
 * 그렇다고 이것들을 위 갈래에 끼워 넣을 수는 없다. 인덱스나 제약에는 셀 행이
 * 없어서 "N건이 사라집니다"를 만들 수 없을뿐더러, **자료가 사라지지 않는 것까지
 * 같은 경고로 묶으면 사람이 곧 경고 전체를 흘려보낸다.** 그러면 진짜 위험한
 * 줄도 함께 묻힌다. 그래서 갈래를 하나 더 둔다.
 *
 * 이쪽은 **막지 않는다.** 보여 주기만 하고, 위 갈래와 달리 DB에 붙지도 않는다
 * — 셀 것이 없기 때문이다.
 * ============================================================================
 */
export type RiskyOperation =
  | { kind: "DROP_INDEX"; index: string }
  | { kind: "DROP_CONSTRAINT"; table: string; constraint: string }
  | { kind: "SET_NOT_NULL"; table: string; column: string }
  | { kind: "RENAME_TABLE"; table: string; to: string }
  | { kind: "RENAME_COLUMN"; table: string; column: string; to: string }
  | { kind: "CHANGE_COLUMN_TYPE"; table: string; column: string; to: string }
  | { kind: "DROP_TYPE"; type: string };

/** 어느 표에 매이지 않은 문장들. */
const STANDALONE_RISKY: {
  re: RegExp;
  build: (m: RegExpMatchArray) => RiskyOperation;
}[] = [
  {
    // 유니크가 사라지면 중복이 조용히 들어온다.
    re: /\bDROP\s+INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+EXISTS\s+)?([\w".]+)/gi,
    build: (m) => ({ kind: "DROP_INDEX", index: bareName(m[1]) }),
  },
  {
    // 그 값을 아직 쓰는 칸이 하나라도 있으면 적용이 통째로 실패한다.
    re: /\bDROP\s+TYPE\s+(?:IF\s+EXISTS\s+)?([\w".]+)/gi,
    build: (m) => ({ kind: "DROP_TYPE", type: bareName(m[1]) }),
  },
];

/**
 * 표 하나에 매인 문장들. 표 이름은 위 머리에서 이미 떼어 냈으므로 여기서는 동작만 본다.
 *
 * ⚠ 외래키 구절의 `ON DELETE cascade` / `ON DELETE restrict` / `ON DELETE set null`
 * 은 무엇도 지우지 않는다. 아래 어느 것도 그 구절에 걸리지 않아야 한다.
 */
const TABLE_SCOPED_RISKY: {
  re: RegExp;
  build: (table: string, m: RegExpMatchArray) => RiskyOperation;
}[] = [
  {
    // CHECK·외래키가 사라진다. 승인 표의 CHECK 넷이 여기에 걸려 있다.
    // (`DROP DEFAULT`·`DROP NOT NULL`은 제약을 떼는 것이 아니므로 걸리지 않는다.)
    re: /\bDROP\s+CONSTRAINT\s+(?:IF\s+EXISTS\s+)?([\w".]+)/gi,
    build: (table, m) => ({
      kind: "DROP_CONSTRAINT",
      table,
      constraint: bareName(m[1]),
    }),
  },
  {
    // 기존 행에 빈 값이 하나라도 있으면 적용이 통째로 실패한다.
    re: /\bALTER\s+(?:COLUMN\s+)?([\w".]+)\s+SET\s+NOT\s+NULL\b/gi,
    build: (table, m) => ({ kind: "SET_NOT_NULL", table, column: bareName(m[1]) }),
  },
  {
    // 값이 잘리거나 변환에 실패한다.
    re: /\bALTER\s+(?:COLUMN\s+)?([\w".]+)\s+(?:SET\s+DATA\s+)?TYPE\s+([\w".]+(?:\s*\([^)]*\))?(?:\s*\[\s*\])?)/gi,
    build: (table, m) => ({
      kind: "CHANGE_COLUMN_TYPE",
      table,
      column: bareName(m[1]),
      to: bareName(m[2]),
    }),
  },
  {
    // 이름이 바뀌면 되돌리기 설계가 조용히 무효가 된다.
    re: /\bRENAME\s+TO\s+([\w".]+)/gi,
    build: (table, m) => ({ kind: "RENAME_TABLE", table, to: bareName(m[1]) }),
  },
  {
    re: /\bRENAME\s+(?:COLUMN\s+)?([\w".]+)\s+TO\s+([\w".]+)/gi,
    build: (table, m) => ({
      kind: "RENAME_COLUMN",
      table,
      column: bareName(m[1]),
      to: bareName(m[2]),
    }),
  },
];

/**
 * 이 SQL에서 **자료는 그대로 두지만 사람이 확인해야 하는** 것들.
 *
 * 위 갈래(`findDestructiveOperations`)와 겹치지 않는다. 둘은 따로 부르고 따로
 * 보여 준다.
 */
export function findRiskyOperations(sql: string): RiskyOperation[] {
  const found: RiskyOperation[] = [];
  const seen = new Set<string>();

  const remember = (op: RiskyOperation) => {
    const key = JSON.stringify(op);
    if (seen.has(key)) return;
    seen.add(key);
    found.push(op);
  };

  // 위 갈래와 똑같이 주석을 먼저 걷어낸다 — 설명 주석에 적힌 예시 문장을
  // 진짜로 세면 헛경고가 되고, 헛경고는 곧 무시된다.
  for (const statement of splitStatements(stripComments(sql))) {
    for (const { re, build } of STANDALONE_RISKY) {
      // 매 호출마다 새로 만들어 lastIndex가 남지 않게 한다.
      const pattern = new RegExp(re.source, re.flags);
      for (const match of statement.matchAll(pattern)) remember(build(match));
    }

    const head = statement.match(ALTER_TABLE_HEAD);
    if (!head) continue;

    const table = bareName(head[1]);
    const rest = head[2];
    for (const { re, build } of TABLE_SCOPED_RISKY) {
      const pattern = new RegExp(re.source, re.flags);
      for (const match of rest.matchAll(pattern)) remember(build(table, match));
    }
  }

  return found;
}

/** 사람이 읽을 한 줄. */
export function describeRiskyOperation(op: RiskyOperation): string {
  switch (op.kind) {
    case "DROP_INDEX":
      return `인덱스 삭제: ${op.index}`;
    case "DROP_CONSTRAINT":
      return `제약 삭제: ${op.table}.${op.constraint}`;
    case "SET_NOT_NULL":
      return `필수값 전환: ${op.table}.${op.column}`;
    case "RENAME_TABLE":
      return `표 이름 변경: ${op.table} → ${op.to}`;
    case "RENAME_COLUMN":
      return `열 이름 변경: ${op.table}.${op.column} → ${op.to}`;
    case "CHANGE_COLUMN_TYPE":
      return `열 자료형 변경: ${op.table}.${op.column} → ${op.to}`;
    case "DROP_TYPE":
      return `타입 삭제: ${op.type}`;
  }
}
