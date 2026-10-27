import "./load-env";

import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  INVENTORY_CLOSED_STATUS_LABEL,
  INVENTORY_OH_LINE_FIELD,
  INVENTORY_PART_FIELDS,
  INVENTORY_REQUEST_STATUS_CODES,
  INVENTORY_REQUEST_STATUS_LABELS,
  INVENTORY_STOCK_REQUEST_DECISION_FIELDS,
  INVENTORY_STOCK_REQUEST_FIELDS,
  INVENTORY_STOCK_REQUEST_HOLD_FIELDS,
  INVENTORY_STOCK_REQUEST_LINE_CHARGE_FIELDS,
  INVENTORY_STOCK_REQUEST_LINE_FIELDS,
  INVENTORY_STOCK_REQUEST_LINE_OWNER_FIELDS,
  INVENTORY_STOCK_REQUEST_REQUESTER_FIELDS,
  codesMissingFromInventory,
  codesUnknownToAs,
  judgedStatusCodes,
  missingFields,
  scanStatusCodeChecks,
  statusLabelMatches,
} from "../src/lib/domain/inventory-contract";
import {
  STOCK_REQUEST_OH_TAG_VALUE,
  canCancelStockRequest,
  isInventoryRequestSettled,
  parseInventoryPartsResponse,
  parseInventoryStockRequestsResponse,
  stockRequestDecisionLabel,
} from "../src/lib/domain/inventory-gateway";

/**
 * ============================================================================
 * A/S 와 재고 관리가 **같은 말을 하고 있는가** (브라우저 없이, 진짜 서버에 대고)
 * ============================================================================
 *   npm run check:inventory-contract
 *   npm run check:inventory-contract -- D260701 D260702   ← 들여다볼 인수번호
 *
 * 왜 필요한가: A/S 는 부품 요청을 **제 표에 저장하지 않고 재고 관리에서 직접 읽는다**
 * (`src/lib/server/inventory-gateway.ts`). 그 둘이 어긋나도 🔴 **아무 오류가 안 난다** —
 * 코드값 비교가 그냥 거짓이 되어 단추가 안 그려지거나 머리글이 틀린 채로 몇 달을 간다.
 * 2026-10-21 에 재고 관리가 상태를 하나 더했을 때(`IN_APPROVAL`) A/S 가 안 깨진 것은
 * **양쪽이 우연히 안전한 쪽으로 적혀 있었기 때문**이고, 그것을 재는 도구가 없었다.
 *
 * 🔴 **아무것도 바꾸지 않는다.** A/S DB 에는 붙지 않고, 재고 관리에는 **읽기 요청만** 보낸다
 *    (`GET` 둘). 신청을 올리거나 거두는 통로는 두드리지 않는다.
 *
 * ── 🔴 「못 쟀다」를 통과로 세지 않는다 ───────────────────────────────────
 * 서버가 안 떠 있거나, 토큰이 없거나, 볼 신청이 한 건도 없으면 그것은 **통과가 아니다.**
 * 조용히 ✓ 로 세면 도구가 있으나 마나 하다 — 포털의 본보기들과 같은 가름이고
 * (`dss-auth/scripts/check-site-notifications.ts` 의 `skip`), 여기서는 한 발 더 나가
 * **못 잰 것이 하나라도 있으면 종료 코드가 1** 이다.
 *
 * ── 석 토막으로 잰다 ─────────────────────────────────────────────────────
 *  ㉠ **서버 없이**(순수) — 우리가 코드값으로 판단하는 자리를 **원본 글자에서 긁어모아**
 *     저쪽 코드 목록에 다 들어 있는지 본다. 모르는 코드를 어느 쪽으로 접는지도 **실제로
 *     함수를 불러** 잰다. 이 토막은 시험도 덮는다(`src/lib/domain/inventory-contract.test.ts`).
 *  ㉡ **살아 있는 서버에 대고** — 왕복 · 거절 · 응답의 칸 · 상태 글자.
 *  ㉢ **저쪽 저장소의 원본 글자에 대고** (2026-10-22). 🔴 ㉡ 이 못 재는 방향이 있다:
 *     **A/S 가 보내는 쪽**이다. 이 도구는 아무것도 바꾸지 않으므로 `POST` 를 두드리지
 *     않고, 그래서 「우리가 적어 보내는 칸 이름을 저쪽이 그 이름으로 읽는가」는 살아 있는
 *     서버로 잴 길이 없다. 그 하나를 **저쪽 저장소의 파일을 읽어** 맞댄다. 🔵 사람이 보는
 *     딱지 글자(「O/H」)도 같은 자리에서 맞댄다 — 두 저장소에 나뉘어 있어 어느 쪽도 혼자서는
 *     어긋난 것을 알지 못한다.
 * ============================================================================
 */

let passed = 0;
let failed = 0;
/** 🔴 **못 쟀다.** 통과가 아니다 — 끝에서 종료 코드를 1 로 만든다. */
let unmeasured = 0;

function check(label: string, ok: boolean, detail = "") {
  if (ok) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

/** 🔴 재지 **못한** 것. ✓ 도 ✗ 도 아니다 — 둘 중 하나로 접으면 거짓말이 된다. */
function cannotMeasure(label: string, why: string) {
  unmeasured += 1;
  console.log(`  ? ${label} — 못 쟀다 (${why})`);
}

function note(line: string) {
  console.log(`     ${line}`);
}

/**
 * 우리가 적어 둔 저쪽 글자. 🔵 **모르는 코드면 빈 글자**다 — 통로를 타고 들어온 값이라
 * 여기서는 그냥 `string` 이고, 표에 없을 수 있다는 것이 이 도구가 잡으려는 바로 그 일이다.
 */
function labelOf(code: string): string {
  const table: Record<string, string> = INVENTORY_REQUEST_STATUS_LABELS;
  return table[code] ?? "";
}

// ---------------------------------------------------------------------------
// ㉠ 서버 없이 — 우리가 코드값으로 판단하는 자리
// ---------------------------------------------------------------------------

/**
 * 🔵 **저장소 뿌리는 `npm run` 이 세워 준 자리다.** 이 파일의 위치에서 거꾸로 세지 않는
 * 까닭: tsx 는 이 저장소에서 CommonJS 로 옮겨 돌아가서(`scripts/load-env.ts` 머리말)
 * `import.meta.url` 이 있을 때와 없을 때가 갈린다 — 거기서 틀리면 파일을 하나도 못 찾고
 * **「판단하는 자리가 없다」로 조용히 통과**한다. `src/` 가 실제로 보이는지 아래에서 본다.
 */
const ROOT = process.cwd();

/**
 * `src/` 의 **원본 파일**만 모은다.
 *
 * 🔴 **시험 파일을 뺀다.** 시험에는 「이 글자가 화면에 있으면 안 된다」를 재는 줄이 있어
 *    (`assert.doesNotMatch(source, /status\.code === "PENDING"/)`) 판단하는 자리로 잘못 센다.
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
    out.push({ path: path.relative(ROOT, full).replace(/\\/g, "/"), source: readFileSync(full, "utf8") });
  }
  return out;
}

function checkOurJudgements(): string[] {
  console.log("\n─ ㉠ A/S 가 코드값으로 판단하는 자리 (서버 없이)");

  const files = sourceFiles(path.join(ROOT, "src"));
  /* 🔴 **읽은 파일이 없으면 「판단하는 자리가 없다」가 아니라 「못 쟀다」**다 — 뿌리를 잘못
     짚었을 때 조용히 통과하는 길이 이것 하나뿐이라 먼저 막는다. */
  check(`src/ 의 원본 파일 ${files.length}개를 읽었다`, files.length > 0, `뿌리를 ${ROOT} 로 짚었다`);

  const scan = scanStatusCodeChecks(files);
  const judged = judgedStatusCodes(scan);

  check("판단하는 자리를 하나 이상 찾았다", scan.checks.length > 0, "하나도 못 찾았다 — 긁어모으는 자가 깨졌다");
  for (const site of scan.checks) {
    note(`${site.file}:${site.line}  ${site.code ?? `(못 풂: ${site.unresolved})`}`);
  }

  /* 🔴 못 푼 자리는 **실패**다. 「아마 괜찮겠지」로 넘기면 그 자리만 영영 안 재어진다. */
  const unresolved = scan.checks.filter((site) => site.code === null);
  check(
    "🔴 견주는 값을 전부 풀었다 — 못 푼 자리가 없다",
    unresolved.length === 0,
    unresolved.map((site) => `${site.file}:${site.line} ${site.unresolved}`).join(", ")
  );

  /* 🔴 핵심 — 우리가 집는 코드가 저쪽 목록에 **다 들어 있는가**. 없으면 영영 거짓이다. */
  const missing = codesMissingFromInventory(judged, INVENTORY_REQUEST_STATUS_CODES);
  check(
    `🔴 A/S 가 집는 코드 ${judged.length}개가 재고 관리 목록에 다 있다`,
    missing.length === 0,
    `재고 관리가 내지 않는 코드: ${missing.join(", ")} — 그 판정은 영영 거짓이다`
  );
  note(`집는 코드: ${judged.join(", ") || "없음"}`);

  /* 🔵 반대쪽은 어긋남이 아니다 — 어느 쪽으로 접는지를 **실제로 함수를 불러** 본다. */
  const unknown = codesUnknownToAs(INVENTORY_REQUEST_STATUS_CODES, judged);
  note(`A/S 가 이름으로 집지 않는 코드 ${unknown.length}개: ${unknown.join(", ") || "없음"}`);
  for (const code of unknown) {
    const row = { status: { code, label: labelOf(code) }, closed: false };
    note(
      `${code} → 취소 단추 ${canCancelStockRequest({ ...row, mine: true, requestKey: "k" }) ? "열림" : "닫힘"} · ` +
        `${isInventoryRequestSettled(row) ? "끝난 것" : "안 끝난 것"} · 사유 머리글 「${stockRequestDecisionLabel(row)}」`
    );
  }

  /**
   * 🔴 **되돌릴 수 없는 일을 여는 판정은 전수로 잰다.** [요청 취소]는 눌리면 저쪽 신청이
   *    사라지는 단추라, 모르는 코드가 하나라도 이 문을 열면 사고다. 「PENDING 하나만 열린다」를
   *    저쪽 코드 **전부**에 대고 확인한다.
   */
  const opens = INVENTORY_REQUEST_STATUS_CODES.filter((code) =>
    canCancelStockRequest({ status: { code, label: "" }, closed: false, mine: true, requestKey: "k" })
  );
  check(
    "🔴 [요청 취소]가 열리는 코드는 「PENDING」 하나뿐이다 (저쪽 코드 전수)",
    opens.length === 1 && opens[0] === "PENDING",
    `열리는 코드: ${opens.join(", ") || "없음"}`
  );

  if (scan.mentions.length > 0) {
    note(`견주지 않고 쓰는 자리 ${scan.mentions.length}곳 (화면에 그냥 그리는 것 등):`);
    for (const site of scan.mentions) note(`  ${site.file}:${site.line}  ${site.text}`);
  }

  return judged;
}

// ---------------------------------------------------------------------------
// ㉡ 살아 있는 서버에 대고
// ---------------------------------------------------------------------------

function baseUrl(): string {
  return (process.env.INVENTORY_API_BASE_URL ?? "").trim().replace(/\/+$/, "");
}

type Answer = { status: number; body: unknown; cacheControl: string | null; error: string };

/** 한 번 두드린다. 🔵 던지지 않는다 — 연결 실패도 답의 한 가지(`status: 0`)로 들고 온다. */
async function ask(url: string, token: string | null): Promise<Answer> {
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { accept: "application/json", ...(token === null ? {} : { authorization: `Bearer ${token}` }) },
      cache: "no-store",
    });
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    return { status: response.status, body, cacheControl: response.headers.get("cache-control"), error: "" };
  } catch (error) {
    return {
      status: 0,
      body: null,
      cacheControl: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/** 신청 한 건을 뜯어본다. 🔵 돌려주는 값은 **코드값**이다 — 부르는 쪽이 「하나라도 봤나」를 센다. */
function checkOneRequest(raw: unknown, where: string): string | null {
  const row = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const gone = missingFields(row, INVENTORY_STOCK_REQUEST_FIELDS);
  check(`${where}: 통로가 A/S 가 읽는 칸을 다 준다`, gone.length === 0, `없는 칸: ${gone.join(", ")}`);

  /**
   * 🔴 **요청 비고는 「들어 있을 때만」이 아니다** (2026-10-22).
   *
   * 아래 `decision`·`hold`·`requester` 는 `null` 이 정상이라 **없으면 건너뛴다**. 요청 비고는
   * 다르다 — **언제나 있어야 하는 글자 칸**이고 안 적은 신청은 **빈 글자**다(A/S 쪽
   * `InventoryStockRequest` 머리말에 적어 둔 약속). 그래서 **칸 목록에 넣어** 위에서 재고,
   * 🔴 저쪽이 이 칸을 안 보내게 되는 날 **위 줄이 ✗** 가 된다. 건너뛰는 쪽에 두었으면 그날
   * 조용히 지나가고, A/S 화면에서는 **요청 비고 줄이 그냥 사라진다**(오류가 아니라 빠짐이라
   * 아무도 신고하지 않는다 — 이 도구가 막으려는 바로 그 모양이다).
   *
   * 🔵 **여기서는 나머지 반쪽을 본다**: 칸은 있는데 **글자가 아닌** 경우(`null` 이 그렇다).
   *    그때 A/S 파서는 빈 글자로 접으므로, 적어 보낸 말이 있어도 화면에서는 **안 적은 것과
   *    똑같이** 보인다. 🔵 칸이 아예 없을 때 또 세지 않는 까닭: 위에서 이미 ✗ 로 셌다.
   * 🔴 **「비어 있지 않은가」는 재지 않는다** — 빈 글자가 정상이다(안 적었거나 재고 관리에서
   *    직접 올린 신청). 그것까지 ✗ 로 세면 도구가 늘 빨개져 아무도 안 본다.
   */
  if ("note" in row) {
    check(
      `🔴 ${where}: 요청 비고가 **글자로** 온다 (빈 글자여도 좋다 · null 은 안 된다)`,
      typeof row.note === "string",
      `받은 값: ${JSON.stringify(row.note)} — A/S 는 이것을 빈 글자로 접어 「안 적은 신청」처럼 그린다`
    );
  }

  const status = (row.status && typeof row.status === "object" ? row.status : {}) as Record<string, unknown>;
  const code = typeof status.code === "string" ? status.code : "";
  const label = typeof status.label === "string" ? status.label : "";

  if (code === "") {
    check(`${where}: 상태 코드가 글자로 온다`, false, JSON.stringify(status).slice(0, 120));
    return null;
  }

  /* 🔴 여기가 「저쪽이 상태를 더했다」를 잡는 자리다 — 베껴 둔 목록이 옛것이 된 것이다. */
  check(
    `🔴 ${where}: 상태 코드 「${code}」가 우리가 아는 목록에 있다`,
    (INVENTORY_REQUEST_STATUS_CODES as readonly string[]).includes(code),
    `재고 관리가 모르는 코드를 보냈다 — src/lib/domain/inventory-contract.ts 를 다시 읽어 맞춰야 한다`
  );

  const sameLabel = statusLabelMatches(code, label);
  if (sameLabel === null) {
    cannotMeasure(`${where}: 상태 글자 맞대기`, `모르는 코드(${code})라 견줄 글자가 없다`);
  } else {
    check(
      `${where}: 상태 글자 「${label}」가 양쪽에서 같다`,
      sameLabel,
      `우리가 적어 둔 글자: 「${labelOf(code) || "?"}」`
    );
  }

  /**
   * 🔴 **마감된 신청은 글자가 이미 「마감」이라야 한다** (2026-10-21).
   *
   * A/S 화면은 `closed` 를 보고 「(마감)」 꼬리를 붙이던 것을 **걷어냈다** — 저쪽 `label` 이
   * 그 말을 이미 하고 있어서 둘이 겹쳐 **「마감 (마감)」**으로 떴기 때문이다. 그 뒤로 이쪽
   * 화면은 **저쪽 글자에 기대고 있다.** 저쪽이 이 약속을 그만두면 A/S 는 마감된 신청을
   * **「확인됨」**으로 그리는데, 오류가 아니라 빠짐이라 아무도 신고하지 않는다.
   *
   * 🔵 화면이 글자를 덧붙이고 있지 않은가는 여기서 못 잰다 — 그것은 원본을 읽는 일이라
   *    `src/components/repair-cases/detail/part-request-section-wiring.test.ts` 가 매번 잰다
   *    (2026-10-27 에 `components/inventory/` 에서 그리로 옮겼다). 이 도구는
   *    **저쪽이 지금 무슨 글자를 보내는가**라는, 거기서 못 재는 반쪽을 맡는다.
   */
  if (row.closed === true) {
    check(
      `🔴 ${where}: 마감된 신청은 글자가 이미 「${INVENTORY_CLOSED_STATUS_LABEL}」이다`,
      label === INVENTORY_CLOSED_STATUS_LABEL,
      `받은 글자: 「${label}」 — A/S 화면이 이 글자에 기대고 있다(꼬리말을 걷어냈다)`
    );
  }

  const lines = Array.isArray(row.lines) ? row.lines : [];
  if (lines.length === 0) {
    cannotMeasure(`${where}: 신청 줄의 칸`, "줄이 하나도 없는 신청이다");
  } else {
    const lineGone = missingFields(lines[0], INVENTORY_STOCK_REQUEST_LINE_FIELDS);
    check(`🔴 ${where}: 신청 줄이 A/S 가 읽는 칸을 다 준다`, lineGone.length === 0, `없는 칸: ${lineGone.join(", ")}`);

    /**
     * 🔴 **딱지 둘의 속까지 본다** (2026-10-21). A/S 신청 줄은 소유구분과 유상/무상을 상자로 그리는데,
     *    그릴 값은 `{ code, label }` 이다 — `code` 가 없으면 A/S 파서가 그 줄을 **통째로 `null`** 로
     *    접고(`codeLabelOrNull`) 딱지가 **조용히 사라진다.** 오류가 아니라 빠짐이라 아무도 신고하지 않는다.
     * 🔵 둘 다 **`null` 이 정상인 자리가 있다**(지워진 부품의 소유 · 반출이 아닌 줄의 유상/무상)라서
     *    `decision`·`hold`·`requester` 와 **같은 길**로 — 들어 있을 때만 속을 본다.
     * 🔴 **줄 하나만 보지 않는다.** 지워진 부품 줄 하나가 맨 앞에 서면 `null` 만 보고 「못 쟀다」로 끝나,
     *    같은 신청의 멀쩡한 줄이 주는 값을 영영 안 재게 된다.
     */
    for (const [name, fields] of [
      ["owner", INVENTORY_STOCK_REQUEST_LINE_OWNER_FIELDS],
      ["chargeType", INVENTORY_STOCK_REQUEST_LINE_CHARGE_FIELDS],
    ] as const) {
      const present = lines
        .map((line) => (line && typeof line === "object" ? (line as Record<string, unknown>)[name] : undefined))
        .filter((value) => value !== null && value !== undefined);
      if (present.length === 0) {
        cannotMeasure(`${where}: 신청 줄의 ${name} 속 칸`, `이 신청의 줄에는 ${name} 이 하나도 없다 (지워진 부품이거나 반출이 아닌 신청)`);
        continue;
      }
      const inner = present.flatMap((value) => missingFields(value, fields));
      check(`${where}: 신청 줄의 ${name} 칸이 다 있다`, inner.length === 0, `없는 칸: ${[...new Set(inner)].join(", ")}`);
    }
  }

  /* 🔵 셋 다 `null` 이 정상이라 **들어 있을 때만** 속을 본다(없다고 어긋난 것이 아니다). */
  for (const [name, fields] of [
    ["decision", INVENTORY_STOCK_REQUEST_DECISION_FIELDS],
    ["hold", INVENTORY_STOCK_REQUEST_HOLD_FIELDS],
    ["requester", INVENTORY_STOCK_REQUEST_REQUESTER_FIELDS],
  ] as const) {
    const value = row[name];
    if (value === null || value === undefined) continue;
    const inner = missingFields(value, fields);
    check(`${where}: ${name} 의 칸이 다 있다`, inner.length === 0, `없는 칸: ${inner.join(", ")}`);
  }

  return code;
}

async function checkLive(intakes: readonly string[]) {
  console.log("\n─ ㉡ 살아 있는 재고 관리에 대고");

  const base = baseUrl();
  const readToken = (process.env.INVENTORY_API_TOKEN ?? "").trim();
  const writeToken = (process.env.INVENTORY_WRITE_TOKEN ?? "").trim();

  if (base === "" || readToken === "") {
    cannotMeasure(
      "🔴 재고 관리와의 왕복 전부",
      "INVENTORY_API_BASE_URL · INVENTORY_API_TOKEN 이 .env.local 에 없다"
    );
    return;
  }
  console.log(`  통로: ${base}/api/v1/…`);

  // ── 거절돼야 하는 것들. 🔵 이 통로의 값어치 절반이 여기 있는데 아무도 눈으로 보지 않는다.
  const noAuth = await ask(`${base}/api/v1/parts`, null);
  if (noAuth.status === 0) {
    cannotMeasure("🔴 재고 관리와의 왕복 전부", `서버에 닿지 못했다 (${noAuth.error})`);
    return;
  }
  check("토큰 없이 부르면 401", noAuth.status === 401, `status ${noAuth.status}`);

  // 🔴 이 값은 **반드시 ASCII** 여야 한다. HTTP 머리말은 Latin-1(0~255)만 실을 수 있어서,
  //    한글처럼 255 를 넘는 문자가 들어가면 `fetch` 가 요청을 보내기도 전에 던진다
  //    ("Cannot convert argument to a ByteString because the character at index 7 has
  //    a value of 51060 which is greater than 255."). `ask()` 가 그 예외를 삼켜
  //    `status: 0` 을 돌려주므로 아래 검사는 **언제나 ✗** 가 된다 — 실제로 한글
  //    "이건-틀린-토큰" 을 썼을 때 그렇게 조용히 죽어 있었다(2026-10-22 에 발견). 서버는
  //    멀쩡하다(영문 가짜 토큰을 보내면 401 이 온다) — 「읽기 쉽게」 한글로 되돌리지 말 것.
  //    scripts/check-inventory-contract-bad-token.test.ts 가 이 값이 ASCII 인지 소스에서 잰다.
  const badToken = await ask(`${base}/api/v1/parts`, "not-a-real-token");
  check("토큰이 틀리면 401", badToken.status === 401, `status ${badToken.status}`);

  /* 🔴 읽기와 쓰기는 **다른 문**이다(저쪽 `lib/api/auth.ts`). 섞이면 읽기 토큰 하나로
     재고를 움직이는 신청까지 만들 수 있게 된다 — 값이 다른지를 여기서 실측한다. */
  if (writeToken === "") {
    cannotMeasure("🔴 쓰기 토큰으로는 읽기 통로가 안 열린다", "INVENTORY_WRITE_TOKEN 이 없다");
  } else if (writeToken === readToken) {
    check("🔴 읽기 토큰과 쓰기 토큰이 다른 값이다", false, "두 값이 같다 — 읽기 토큰으로 재고를 움직일 수 있다");
  } else {
    const crossed = await ask(`${base}/api/v1/stock-requests?intake=D260701`, writeToken);
    check("🔴 쓰기 토큰으로는 읽기 통로가 안 열린다 (401)", crossed.status === 401, `status ${crossed.status}`);
  }

  const noQuery = await ask(`${base}/api/v1/stock-requests`, readToken);
  check("무엇을 물을지 안 보내면 400 — 조용히 전부를 내주지 않는다", noQuery.status === 400, `status ${noQuery.status}`);

  const badIntake = await ask(`${base}/api/v1/stock-requests?intake=${encodeURIComponent("이건-인수번호가-아니다")}`, readToken);
  check("인수번호 모양이 아니면 400", badIntake.status === 400, `status ${badIntake.status}`);

  // ── 부품 목록 — 칸이 다 오는가, 우리 파서가 줄을 흘리지 않는가.
  console.log("\n  부품 목록 — GET /api/v1/parts");
  const parts = await ask(`${base}/api/v1/parts`, readToken);
  check("200 으로 답한다", parts.status === 200, `status ${parts.status}`);
  check("답이 어디에도 남지 않는다 (no-store)", parts.cacheControl === "no-store", String(parts.cacheControl));

  const rawParts = (parts.body && typeof parts.body === "object" ? (parts.body as { parts?: unknown }).parts : null);
  if (!Array.isArray(rawParts)) {
    cannotMeasure("부품 줄의 칸", "응답에 parts 배열이 없다");
  } else if (rawParts.length === 0) {
    cannotMeasure("부품 줄의 칸", "부품이 한 줄도 없다");
  } else {
    const gone = missingFields(rawParts[0], INVENTORY_PART_FIELDS);
    check("🔴 부품 줄이 A/S 가 읽는 칸을 다 준다", gone.length === 0, `없는 칸: ${gone.join(", ")}`);

    /* 🔴 **파서가 줄을 흘리지 않는가.** 번호나 품명이 빈 줄은 일부러 버리므로, 수가 다르면
       그 수만큼 고르개에서 **조용히 사라진 부품**이 있다는 뜻이다. */
    const parsed = parseInventoryPartsResponse(parts.body);
    if (parsed === null) {
      check("🔴 A/S 파서가 부품 응답을 읽는다", false, "모양이 아니라고 답했다 — 화면은 「불러오지 못했습니다」가 된다");
    } else {
      check(
        `A/S 파서가 부품 ${rawParts.length}줄을 하나도 안 흘린다`,
        parsed.length === rawParts.length,
        `받은 줄 ${rawParts.length} · 읽은 줄 ${parsed.length} — 번호나 품명이 빈 줄이 그만큼 있다`
      );
    }
  }

  // ── 반출 신청 — 상태 코드와 글자가 양쪽에서 같은가.
  console.log("\n  반출 신청 — GET /api/v1/stock-requests?intake=…");
  if (intakes.length === 0) {
    cannotMeasure(
      "🔴 상태 코드·글자 맞대기",
      "볼 인수번호를 안 줬다 — npm run check:inventory-contract -- D260701 처럼 뒤에 적는다"
    );
    return;
  }

  const seen = new Set<string>();
  let rowsSeen = 0;
  for (const intake of intakes) {
    const answer = await ask(`${base}/api/v1/stock-requests?intake=${encodeURIComponent(intake)}`, readToken);
    if (answer.status !== 200) {
      check(`${intake}: 200 으로 답한다`, false, `status ${answer.status}`);
      continue;
    }
    const body = (answer.body && typeof answer.body === "object" ? answer.body : {}) as Record<string, unknown>;
    check(
      `${intake}: 모양이 generatedAt · count · requests · notFound 네 칸이다`,
      typeof body.generatedAt === "string" &&
        typeof body.count === "number" &&
        Array.isArray(body.requests) &&
        Array.isArray(body.notFound),
      JSON.stringify(answer.body)?.slice(0, 160) ?? ""
    );

    /* 🔴 **「못 받아 왔다」와 「하나도 없다」를 가르는 그 파서**를 진짜 응답에 대고 돌려 본다. */
    const parsed = parseInventoryStockRequestsResponse(answer.body);
    if (parsed === null) {
      check(`🔴 ${intake}: A/S 파서가 신청 응답을 읽는다`, false, "모양이 아니라고 답했다");
      continue;
    }
    const rawRequests = Array.isArray(body.requests) ? body.requests : [];
    check(
      `${intake}: A/S 파서가 신청 ${rawRequests.length}건을 하나도 안 흘린다`,
      parsed.length === rawRequests.length,
      `받은 건 ${rawRequests.length} · 읽은 건 ${parsed.length} — id 가 빈 줄이 그만큼 있다`
    );

    rowsSeen += rawRequests.length;
    for (const [index, raw] of rawRequests.entries()) {
      const code = checkOneRequest(raw, `${intake}[${index}]`);
      if (code !== null) seen.add(code);
    }
  }

  if (rowsSeen === 0) {
    cannotMeasure(
      "🔴 상태 코드·글자 맞대기",
      `준 인수번호(${intakes.join(", ")})에 반출 신청이 한 건도 없다 — 신청이 있는 건으로 다시 돌려야 한다`
    );
    return;
  }
  note(`실제로 본 상태 코드 ${seen.size}가지: ${[...seen].sort().join(", ")}`);
  note(
    `이 한 번으로는 본 것만 잰 것이다 — 안 본 코드 ${
      INVENTORY_REQUEST_STATUS_CODES.filter((c) => !seen.has(c)).join(", ") || "없음"
    } 는 ㉠의 목록 맞대기가 덮는다.`
  );
}

// ---------------------------------------------------------------------------
// ㉢ 재고 관리 **저장소의 원본 글자**에 대고 (2026-10-22)
// ---------------------------------------------------------------------------

/**
 * 저쪽 저장소를 어디서 찾나. 🔵 **설정으로 덮을 수 있다** — 두 저장소가 나란히 있지 않은 PC 도
 * 있다. 없으면 이 PC 의 관례대로 **옆집**(`../dss-inventory`)을 본다.
 *
 * 🔴 **못 찾으면 「없는 것」이 아니라 「못 쟀다」**다 — 이 도구 전체의 규칙 그대로다. 조용히
 *    통과시키면 이 토막은 있으나 마나 하고, 하필 **어긋나도 오류가 안 나는** 자리를 재고 있다.
 */
const INVENTORY_REPO_ENV = "INVENTORY_REPO_PATH";

function inventoryRepoRoot(): string | null {
  const configured = (process.env[INVENTORY_REPO_ENV] ?? "").trim();
  const candidate = configured !== "" ? path.resolve(configured) : path.resolve(ROOT, "..", "dss-inventory");
  return existsSync(path.join(candidate, "package.json")) ? candidate : null;
}

/**
 * 🔴 **주석을 뗀다.** 안 떼면 저쪽 **주석에 적힌 글자**를 「코드가 쓰고 있다」로 세어 통과한다 —
 * 이 저장소들의 주석은 길고, 칸 이름을 설명하느라 그 글자가 거의 반드시 적혀 있다.
 * 🔵 재는 쪽을 좁히는 수법은 저쪽 `tests/part-limit-quantity.test.ts` 의 것과 같다.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

/** 저쪽 파일 하나를 **주석을 뗀 채** 읽는다. 없으면 `null`(못 쟀다). */
function inventorySource(root: string, relative: string): string | null {
  const full = path.join(root, relative.split("/").join(path.sep));
  if (!existsSync(full)) return null;
  return stripComments(readFileSync(full, "utf8"));
}

/**
 * 저쪽 파일에서 **함수 하나만** 떼어 낸다. 다음 `export` 앞에서 끊는다.
 *
 * 🔴 **파일 통째로 재면 헛통과한다.** 2026-10-22 에 실제로 겪었다: 받는 자리의 읽기를
 *    `line.ohTemplate` 으로 바꿔 놓고 돌려 봤는데, **같은 파일의 타입 선언과 쓰는 자리에**
 *    그 글자가 그대로 남아 있어 「쓰고 있다」로 세어졌다. 재는 자리를 **그 함수 안으로**
 *    좁혀야 「읽는 이름이 갈렸다」가 보인다.
 * 🔴 **못 찾으면 `null`** 이고 부르는 쪽이 그것을 실패로 센다 — 조용히 통과시키지 않는다.
 */
function inventoryFunction(source: string, name: string): string | null {
  const start = source.indexOf(`export function ${name}(`);
  if (start < 0) return null;
  const after = source.indexOf("\nexport ", start + 1);
  const cut = source.slice(start, after < 0 ? source.length : after);
  return cut.trim() === "" ? null : cut;
}

function checkInventoryRepo() {
  console.log("\n─ ㉢ 재고 관리 저장소와 맞대기 (A/S 가 **보내는** 쪽 · 사람이 보는 글자)");

  const root = inventoryRepoRoot();
  if (root === null) {
    cannotMeasure(
      "🔴 재고 관리 저장소 맞대기",
      `저장소를 못 찾았다 — ${INVENTORY_REPO_ENV} 에 경로를 적거나 옆집(../dss-inventory)에 두십시오`
    );
    return;
  }
  note(`저쪽 저장소: ${root}`);

  /**
   * 🔴 **보내는 쪽의 칸 이름.** 어긋나면 저쪽이 칸을 못 찾아 조용히 거짓으로 눕히고, 그 뒤로
   *    딱지는 한 번도 안 뜬다 — 양쪽 시험은 각자 제 이름으로 통과한다.
   *
   * 🔵 **받는 자리와 돌려주는 자리를 따로 본다**: 저쪽이 본문에서는 읽는데 응답에 안 실어 주면
   *    「담는 중에는 보이다 올리면 사라지는」 딱지가 된다. 한쪽만 보면 그 절반을 놓친다.
   * 🔴 **보는 모양도 다르다.** 받는 자리는 그 이름으로 **읽어야**(`.이름` 또는 `["이름"]`) 하고,
   *    돌려주는 자리는 그 이름으로 **써야**(`이름:`) 한다. 「파일 어딘가에 그 글자가 있나」로 재면
   *    **읽는 이름만 갈렸을 때 통과한다** — 타입 선언과 쓰는 자리에 글자가 그대로 남아 있기
   *    때문이고, 2026-10-22 에 일부러 깨 보고서야 드러났다.
   */
  for (const [label, relative, fn, shape, why] of [
    [
      "받는 자리 (POST 본문 파서)",
      "src/lib/api/stock-requests.ts",
      "parseApiStockRequest",
      new RegExp(`[.\\[]\\s*["']?${INVENTORY_OH_LINE_FIELD}\\b`),
      "그 이름으로 **읽지** 않는다 — 우리가 보낸 칸이 조용히 버려지고 딱지가 영영 안 뜬다",
    ],
    [
      "돌려주는 자리 (GET 응답)",
      "src/lib/api/stock-request-status.ts",
      "toApiRequestStatus",
      new RegExp(`\\b${INVENTORY_OH_LINE_FIELD}\\s*:`),
      "그 이름으로 **내보내지** 않는다 — 올린 뒤의 A/S 화면에서 딱지가 사라진다",
    ],
  ] as const) {
    const source = inventorySource(root, relative);
    if (source === null) {
      cannotMeasure(`${label} — ${relative}`, "그 파일이 없다 (저쪽에서 옮겼으면 이 경로를 고쳐라)");
      continue;
    }
    const body = inventoryFunction(source, fn);
    if (body === null) {
      check(
        `🔴 ${label}: 저쪽 함수 ${fn} 을 찾았다`,
        false,
        `${relative} 에 그 함수가 없다 — 이름이 바뀌었으면 이 점검도 함께 고쳐라(못 찾은 것을 통과로 세지 않는다)`
      );
      continue;
    }
    check(`🔴 ${label}: ${fn} 이 「${INVENTORY_OH_LINE_FIELD}」를 쓴다`, shape.test(body), `${relative} 의 ${fn} 이 ${why}`);
  }

  /**
   * 🔴 **사람이 보는 글자.** 네 화면에 서는 딱지인데 글자를 쥔 상수가 저장소마다 하나씩이다 —
   *    한쪽만 고치면 **같은 것이 화면마다 다른 말**로 불린다. 오류도 안 난다.
   * 🔵 저쪽 상수 이름(`REQUEST_ITEM_OH_TAG_VALUE`)을 짚어 읽고, **값끼리** 견준다. 글자를
   *    여기 또 적지 않는다 — 적으면 맞대는 자가 셋이 된다.
   */
  const detailRelative = "src/lib/stock/request-item-detail.ts";
  const detail = inventorySource(root, detailRelative);
  if (detail === null) {
    cannotMeasure(`딱지 글자 — ${detailRelative}`, "그 파일이 없다 (저쪽에서 옮겼으면 이 경로를 고쳐라)");
  } else {
    const found = /\bREQUEST_ITEM_OH_TAG_VALUE\b[^=\n]*=\s*"([^"]*)"/.exec(detail);
    if (found === null) {
      check(
        "🔴 저쪽 딱지 글자 상수를 찾았다",
        false,
        `${detailRelative} 에 REQUEST_ITEM_OH_TAG_VALUE 가 없다 — 이름이 바뀌었으면 여기도 함께 고쳐라`
      );
    } else {
      check(
        `🔴 두 저장소의 딱지 글자가 같다 — A/S 「${STOCK_REQUEST_OH_TAG_VALUE}」 / 재고 관리 「${found[1]}」`,
        found[1] === STOCK_REQUEST_OH_TAG_VALUE,
        "같은 딱지가 화면마다 다른 말을 한다"
      );
    }
    check(
      "🔴 저쪽 화면 조각이 그 딱지를 순수 함수로 묻는다 (requestItemOhTag)",
      detail.includes("export function requestItemOhTag"),
      `${detailRelative} 에 그 함수가 없다 — 저쪽 화면 셋이 딱지를 못 그린다`
    );
  }
}

async function main() {
  const intakes = process.argv.slice(2).filter((argument) => !argument.startsWith("-"));

  checkOurJudgements();
  checkInventoryRepo();
  await checkLive(intakes);

  console.log("\n" + "─".repeat(64));
  console.log(`  통과 ${passed} · 실패 ${failed} · 못 쟀다 ${unmeasured}`);
  if (unmeasured > 0) {
    console.log("  🔴 못 잰 것이 있으면 통과가 아니다 — 위의 ? 줄을 먼저 없애고 다시 돌리십시오.");
  }
  console.log("─".repeat(64) + "\n");
  if (failed > 0 || unmeasured > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
