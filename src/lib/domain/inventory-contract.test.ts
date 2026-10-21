import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  INVENTORY_CLOSED_STATUS_LABEL,
  INVENTORY_PART_FIELDS,
  INVENTORY_REQUEST_STATUS_CODES,
  INVENTORY_REQUEST_STATUS_LABELS,
  INVENTORY_STATUS_LABEL_OVERRIDES,
  INVENTORY_STOCK_REQUEST_FIELDS,
  INVENTORY_STOCK_REQUEST_LINE_FIELDS,
  codesMissingFromInventory,
  codesUnknownToAs,
  judgedStatusCodes,
  missingFields,
  scanStatusCodeChecks,
  statusLabelMatches,
} from "./inventory-contract";
import {
  canCancelStockRequest,
  parseInventoryPartsResponse,
  parseInventoryStockRequestsResponse,
} from "./inventory-gateway";

/**
 * ============================================================================
 * 🔴 두 시스템이 같은 말을 하는지 **서버 없이 잴 수 있는 만큼**은 여기서 잰다 (2026-10-21)
 * ============================================================================
 * 점검 도구(`scripts/check-inventory-contract.ts`)는 재고 관리 서버가 떠 있어야 돈다.
 * 🔴 **그러면 서버가 안 뜬 날에는 아무도 못 잰다** — 그런 점검은 「돌려 보셨나요」에 매달려
 * 있어 언젠가 아무도 안 돌린다. 그래서 **망 없이 잴 수 있는 것은 전부 시험으로 내린다**:
 *
 *  ㉠ 우리가 코드값으로 판단하는 자리를 **원본 글자에서 긁어모으는 자**가 제대로 긁는가
 *     (글자로 적은 것 · 상수로 빼 둔 것 · 주석 · 그냥 그리는 자리를 가르는가).
 *  ㉡ 🔴 **진짜 `src/` 를 긁어** 거기서 나온 코드가 저쪽 목록에 **다 들어 있는가.**
 *     이것이 「영영 거짓인 판정」을 잡는 자리다.
 *  ㉢ 🔴 되돌릴 수 없는 판정([요청 취소])이 **저쪽 코드 전수**에 대고 안전한 쪽으로 접는가.
 *  ㉣ 「파서가 읽는 칸」 목록이 **실제 파서와 어긋나지 않는가** — 칸을 하나씩 빼 보고
 *     파서의 답이 달라지는지로 잰다. 손으로 맞춰 둔 목록은 언젠가 갈리지만, 「빼면 답이
 *     달라진다」는 거짓말을 할 수 없다.
 *
 * 🔵 서버가 있어야만 잴 수 있는 것(저쪽이 **지금** 무슨 코드를 내는가 · 칸이 다 오는가)은
 *    점검 도구 몫이고, 거기서는 서버가 없으면 「못 쟀다」로 센다.
 * ============================================================================
 */

/* ── ㉠ 긁어모으는 자 ─────────────────────────────────────────────────── */

describe("🔴 코드값으로 판단하는 자리를 긁어모은다", () => {
  test("글자로 적은 것과 상수로 빼 둔 것을 **둘 다** 집는다", () => {
    const source = [
      'const CANCELLABLE = "PENDING";',
      "function a(r) { return r.status.code === CANCELLABLE; }",
      'function b(r) { return r.status.code === "REJECTED"; }',
      'function c(r) { return r.status.code !== "CANCELLED"; }',
    ].join("\n");
    assert.deepEqual(judgedStatusCodes(scanStatusCodeChecks([{ path: "x.ts", source }])), [
      "CANCELLED",
      "PENDING",
      "REJECTED",
    ]);
  });

  test("🔴 못 푼 상수는 **지어내지 않고** 못 풀었다고 말한다", () => {
    const source = "function a(r) { return r.status.code === SOMEWHERE_ELSE; }";
    const scan = scanStatusCodeChecks([{ path: "x.ts", source }]);
    assert.equal(scan.checks.length, 1);
    assert.equal(scan.checks[0].code, null);
    assert.equal(scan.checks[0].unresolved, "SOMEWHERE_ELSE");
    // 🔴 못 푼 자리가 집은 코드 목록에 끼어들면 「다 있다」가 거짓말이 된다.
    assert.deepEqual(judgedStatusCodes(scan), []);
  });

  test("견주지 않고 **그냥 그리는** 자리는 판단으로 세지 않는다", () => {
    const scan = scanStatusCodeChecks([
      { path: "x.tsx", source: "<span>{request.status.label || request.status.code}</span>" },
    ]);
    assert.equal(scan.checks.length, 0);
    assert.equal(scan.mentions.length, 1);
    assert.match(scan.mentions[0].text, /status\.label/);
  });

  test("🔴 주석 안의 글자는 판단이 아니다 — 시험이 적어 둔 금지 문구에 걸리지 않게", () => {
    const source = [
      ' * 🔵 status.code === "PENDING" 일 때만 그린다(머리말).',
      '// status.code === "CONFIRMING" 은 쓰지 않는다',
      'function a(r) { return r.status.code === "PENDING"; }',
    ].join("\n");
    const scan = scanStatusCodeChecks([{ path: "x.ts", source }]);
    assert.equal(scan.comments.length, 2);
    assert.deepEqual(judgedStatusCodes(scan), ["PENDING"]);
  });

  test("줄 번호와 파일 이름을 들고 간다 — 사람이 바로 짚을 수 있게", () => {
    const scan = scanStatusCodeChecks([
      { path: "a/b.ts", source: '\n\nif (r.status.code === "PENDING") {}\n' },
    ]);
    assert.equal(scan.checks[0].file, "a/b.ts");
    assert.equal(scan.checks[0].line, 3);
  });
});

describe("두 목록을 맞댄다", () => {
  test("🔴 A/S 만 아는 코드는 **영영 거짓인 판정**으로 드러난다", () => {
    assert.deepEqual(codesMissingFromInventory(["PENDING", "PENDNIG"], INVENTORY_REQUEST_STATUS_CODES), [
      "PENDNIG",
    ]);
  });

  test("재고 관리만 아는 코드는 목록으로 보여 준다 — 그 자체는 어긋남이 아니다", () => {
    assert.deepEqual(codesUnknownToAs(["PENDING", "ON_HOLD"], ["PENDING"]), ["ON_HOLD"]);
  });
});

/* ── ㉡ 진짜 src/ 를 긁는다 ───────────────────────────────────────────── */

/**
 * 🔵 **점검 도구와 같은 규칙으로 모은다** — `src/` 아래 `.ts`·`.tsx` 에서 시험 파일만 뺀다
 *    (시험에는 「이 글자가 화면에 있으면 안 된다」를 재는 줄이 있어 판단으로 잘못 센다).
 * 🔴 **걷는 일을 순수 모듈에 두지 않는 까닭**: 그러려면 도메인 모듈이 `node:fs` 를 물게 되고,
 *    그러면 저 모듈을 불러 쓰는 화면 쪽 묶음에 파일 시스템이 딸려 간다.
 */
function sourceFiles(dir: string, out: { path: string; source: string }[] = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      sourceFiles(full, out);
      continue;
    }
    if (!/\.tsx?$/.test(entry.name)) continue;
    if (/\.test\.tsx?$/.test(entry.name) || entry.name.endsWith(".d.ts")) continue;
    out.push({ path: full.replace(/\\/g, "/"), source: readFileSync(full, "utf8") });
  }
  return out;
}

describe("🔴 지금 이 저장소가 집는 코드가 재고 관리 목록에 다 있다", () => {
  const scan = scanStatusCodeChecks(sourceFiles("src"));

  test("판단하는 자리를 실제로 찾았다 — 못 찾고 통과하는 길을 막는다", () => {
    // 🔴 긁는 자가 깨지면 「집는 코드 0개가 다 들어 있다」로 **조용히** 통과한다.
    assert.ok(scan.checks.length > 0, "src/ 에서 status.code 판단을 하나도 못 찾았다");
  });

  test("🔴 견주는 값을 전부 풀었다 — 못 푼 자리가 하나도 없다", () => {
    const unresolved = scan.checks.filter((site) => site.code === null);
    assert.deepEqual(
      unresolved.map((site) => `${site.file}:${site.line} ${site.unresolved}`),
      [],
      "다른 파일의 상수를 견주고 있다 — 그 자리는 이 시험이 못 잰다"
    );
  });

  test("🔴 집는 코드가 재고 관리가 내는 코드 목록에 **다 있다**", () => {
    const judged = judgedStatusCodes(scan);
    assert.deepEqual(
      codesMissingFromInventory(judged, INVENTORY_REQUEST_STATUS_CODES),
      [],
      "재고 관리가 내지 않는 코드를 집고 있다 — 그 판정은 영영 거짓이다"
    );
  });
});

/* ── ㉢ 되돌릴 수 없는 판정은 전수로 ──────────────────────────────────── */

describe("🔴 모르는 코드를 안전한 쪽으로 접는다", () => {
  test("[요청 취소]가 열리는 코드는 재고 관리 코드 **전수** 가운데 「PENDING」 하나뿐이다", () => {
    const opens = INVENTORY_REQUEST_STATUS_CODES.filter((code) =>
      canCancelStockRequest({ status: { code, label: "" }, closed: false, mine: true, requestKey: "k" })
    );
    assert.deepEqual([...opens], ["PENDING"]);
  });

  test("마감된 줄은 「PENDING」이어도 안 열린다 — 준 것을 되돌릴 수는 없다", () => {
    assert.equal(
      canCancelStockRequest({ status: { code: "PENDING", label: "대기" }, closed: true, mine: true, requestKey: "k" }),
      false
    );
  });
});

describe("상태 글자가 양쪽에서 같은가", () => {
  test("코드마다 저쪽 글자가 적혀 있다", () => {
    for (const code of INVENTORY_REQUEST_STATUS_CODES) {
      assert.equal(statusLabelMatches(code, INVENTORY_REQUEST_STATUS_LABELS[code]), true, code);
    }
  });

  test("글자가 다르면 거짓이다", () => {
    assert.equal(statusLabelMatches("PENDING", "확인 대기"), false);
  });

  test("🔴 둘러 가는 글자 둘(마감 · 실행 대기)은 어긋남이 아니다", () => {
    // 저쪽은 상태값을 새로 만들지 않고 label 만 갈아 끼운다 — 모르고 재면 마감된 신청마다 ✗ 가 뜬다.
    assert.equal(statusLabelMatches("CONFIRMED", "마감"), true);
    assert.equal(statusLabelMatches("IN_APPROVAL", "실행 대기"), true);
  });

  test("🔴 모르는 코드는 거짓이 아니라 **못 쟀다**(null)다", () => {
    // 거짓으로 돌려주면 「코드가 새로 생겼다」가 「글자가 틀렸다」로 둔갑한다.
    assert.equal(statusLabelMatches("BRAND_NEW", "새 상태"), null);
  });

  test("🔴 「마감」 글자는 **이름 붙은 한 곳**에서 온다 — 화면이 그 글자에 기대고 있다", () => {
    // 🔴 A/S 화면은 마감 꼬리말을 걷어냈다(2026-10-21) — 저쪽 label 이 이미 그 말을 해서다.
    //    그래서 이 글자는 이제 **약속**이고, 점검 도구가 마감된 신청마다 저쪽에 되묻는다.
    assert.equal(INVENTORY_CLOSED_STATUS_LABEL, "마감");
    assert.ok((INVENTORY_STATUS_LABEL_OVERRIDES as readonly string[]).includes(INVENTORY_CLOSED_STATUS_LABEL));
    assert.equal(statusLabelMatches("CONFIRMED", INVENTORY_CLOSED_STATUS_LABEL), true);
  });
});

/* ── 칸 보기 ─────────────────────────────────────────────────────────── */

describe("없는 칸 세기", () => {
  test("점 찍힌 길을 따라간다", () => {
    assert.deepEqual(missingFields({ status: { code: "P" } }, ["status.code", "status.label"]), ["status.label"]);
  });

  test("🔴 `null` 은 **있는 칸**이다 — 견적가도 결정도 null 이 정상이다", () => {
    assert.deepEqual(missingFields({ quotePrice: null, decision: null }, ["quotePrice", "decision"]), []);
  });

  test("길 중간이 객체가 아니면 없는 칸이다", () => {
    assert.deepEqual(missingFields({ status: "PENDING" }, ["status.code"]), ["status.code"]);
  });
});

/* ── ㉣ 「파서가 읽는 칸」 목록이 실제 파서와 같은가 ──────────────────── */

function withoutField<T>(value: T, field: string): T {
  const copy = JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
  const steps = field.split(".");
  let cursor: Record<string, unknown> = copy;
  for (const step of steps.slice(0, -1)) cursor = cursor[step] as Record<string, unknown>;
  delete cursor[steps[steps.length - 1]];
  return copy as T;
}

/** 🔴 칸마다 **기본값이 아닌 값**을 넣어 둔다 — 기본값과 같으면 빼도 답이 안 달라져 시험이 빈다. */
function sampleRequestRow() {
  return {
    requestKey: "AS-REQ-1",
    id: "r1",
    intakeNumber: "D260701",
    status: { code: "CONFIRMED", label: "확인됨" },
    closed: true,
    requestedAt: "2026-10-21T01:00:00.000Z",
    lines: [{ no: 165, name: "부품", quantity: 2, issued: 1 }],
    decision: { byName: "홍길동", at: "2026-10-21T02:00:00.000Z", note: "사유" },
    hold: null,
    requester: { sub: "s1", name: "홍길동" },
  };
}

function samplePartRow() {
  return {
    no: 165,
    name: "AMP-1",
    name2: "규격",
    customerName: "고객사 품명",
    kyosanPartNo: "KY-1",
    drawingNo: "DWG-1",
    quantity: 3,
    note: "비고",
    owner: { code: "DSS", label: "디에스에스" },
    quotePrice: 1000,
    overhaulQuotePrice: 2000,
  };
}

describe("🔴 「파서가 읽는 칸」 목록이 실제 파서와 어긋나지 않는다", () => {
  test("신청 줄 — 칸을 하나 빼면 파서의 답이 달라진다", () => {
    const full = { requests: [sampleRequestRow()] };
    const base = JSON.stringify(parseInventoryStockRequestsResponse(full));
    for (const field of INVENTORY_STOCK_REQUEST_FIELDS) {
      const without = { requests: [withoutField(sampleRequestRow(), field)] };
      assert.notEqual(
        JSON.stringify(parseInventoryStockRequestsResponse(without)),
        base,
        `${field} 를 빼도 파서의 답이 같다 — 목록에만 있고 아무도 안 읽는 칸이다`
      );
    }
  });

  test("신청 줄 안의 줄 — 네 칸 다 읽힌다", () => {
    const full = { requests: [sampleRequestRow()] };
    const base = JSON.stringify(parseInventoryStockRequestsResponse(full));
    for (const field of INVENTORY_STOCK_REQUEST_LINE_FIELDS) {
      const row = sampleRequestRow();
      const without = { requests: [{ ...row, lines: [withoutField(row.lines[0], field)] }] };
      assert.notEqual(JSON.stringify(parseInventoryStockRequestsResponse(without)), base, field);
    }
  });

  test("부품 줄 — 칸을 하나 빼면 파서의 답이 달라진다", () => {
    const full = { parts: [samplePartRow()] };
    const base = JSON.stringify(parseInventoryPartsResponse(full));
    for (const field of INVENTORY_PART_FIELDS) {
      const without = { parts: [withoutField(samplePartRow(), field)] };
      assert.notEqual(
        JSON.stringify(parseInventoryPartsResponse(without)),
        base,
        `${field} 를 빼도 파서의 답이 같다 — 목록에만 있고 아무도 안 읽는 칸이다`
      );
    }
  });
});
