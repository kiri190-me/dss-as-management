import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * ============================================================================
 * 제품 모델 파일 목록의 **원본 수정일** — 화면과 통로가 그 값을 실제로 그렇게 쓰는가
 * ============================================================================
 * 값으로 도는 부분(무엇을 터무니없다고 보는가 · 이상하면 빈칸인가)은 unit 목록의
 * lib/domain/attachment-original-modified-at.test.ts 가 이미 본다. 여기서 못 박는
 * 것은 그 값이 **화면과 통로에서 어떻게 쓰이는가**다:
 *
 *  1. 🔴 표의 새 열이 **「올린 날짜」 바로 옆**에 있고(사용자 요청 2026-09-30),
 *     이름이 「올린 날짜」와 헷갈리지 않는다.
 *  2. 🔴 모르는 파일은 **빈칸**이다 — 올린 날짜로 메우는 길이 아예 없어야 한다.
 *     메우면 아무 오류 없이 거짓이 표에 적힌다.
 *  3. 🔴 **올린 날짜 표시는 그대로다** — 두 자리(표 · 미리보기) 모두.
 *  4. 🔴 못 믿을 값을 거르는 판정을 화면이 따로 적지 않는다 — 보내는 쪽과 받는
 *     쪽이 같은 함수 하나를 지난다. 두 벌이 되면 "보냈는데 서버가 버리는" 어긋남이
 *     생기고 그때는 아무 오류도 나지 않는다.
 *  5. 🔴 이 값 때문에 **업로드가 막히는 길이 없다** — 통로에 새 실패 코드가 없다.
 *  6. 🔴 접수 건 · 견적서 올리는 통로는 **손대지 않았다**(이번 요청은 모델 상세다).
 *  7. 열이 하나 늘어난 것이 표의 폭 판정에 반영된다 — measureKey.
 *
 * ── 왜 렌더하지 않고 원본을 읽는가 ──────────────────────────────────────
 * ProductModelFilesSection 은 서버 액션(actions/attachments)을 직접 import 하는
 * 클라이언트 컴포넌트라, 그 사슬 끝의 `server-only` 때문에 react-server 조건 없이
 * 도는 test:components 에서는 import 자체가 던진다. 통로(route.ts)와 조회도 같은
 * 사정이다. 이웃(product-model-customer-source.test.ts · preview-object-fit.test.ts)
 * 과 같은 방법으로 원본을 글자로 읽는다.
 * ============================================================================
 */

const repoUrl = new URL("../../../", import.meta.url);
/** CRLF 로 받아 둔 저장소에서도 표지가 맞도록 LF 로 맞춘다. */
const read = (relativePath: string) =>
  readFileSync(new URL(relativePath, repoUrl), "utf8").replace(/\r\n/g, "\n");
/** 줄바꿈·들여쓰기 차이로 시험이 깨지지 않도록 공백을 하나로 접는다. */
const flat = (source: string) => source.replace(/\s+/g, " ");
/**
 * 주석을 지운다. 이 파일들은 주석에 서로의 함수 이름과 칸 이름을 **까닭과 함께**
 * 길게 적어 두므로, 글자를 그냥 세면 주석 한 줄에 시험이 거짓으로 통과한다.
 */
const code = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");

const screen = read("src/components/product-models/ProductModelFilesSection.tsx");
const modelRoute = read("src/app/api/product-models/[id]/attachments/route.ts");
const caseRoute = read("src/app/api/repair-cases/[id]/attachments/route.ts");
const quoteRoute = read("src/app/api/quotes/[id]/attachments/route.ts");
const queries = read("src/lib/db/queries/attachments.ts");
const mutations = read("src/lib/db/mutations/attachments.ts");

describe("🔴 표 — 올린 날짜 옆에 원본 수정일", () => {
  const headers = flat(screen);

  test("「올린 날짜」 **바로 다음**이 「원본 수정일」이다", () => {
    assert.match(
      headers,
      />올린 날짜<\/th> \{\/\*.*?\*\/\} \{hasOriginalModifiedAt && <th scope="col" className="px-3 py-2 font-medium">원본 수정일<\/th>\}/,
      "두 날짜가 붙어 있지 않으면 견줄 수가 없다"
    );
  });

  test("열 이름이 「올린 날짜」와 다른 낱말로 갈린다", () => {
    assert.ok(headers.includes(">원본 수정일</th>"), "열 이름이 사라졌다");
    assert.ok(
      !headers.includes(">수정 날짜</th>") && !headers.includes(">수정일</th>"),
      "「원본」이 빠지면 우리 시스템에서 고친 때로 읽힌다 — 정반대의 뜻이다"
    );
  });

  test("값이 있으면 그 날짜를, 없으면 줄표를 적는다", () => {
    assert.match(
      headers,
      /\{item\.originalModifiedAt \? formatTimestamp\(item\.originalModifiedAt\) : UNKNOWN_ORIGINAL_MODIFIED_AT\}/,
      "빈칸 처리가 사라졌다"
    );
    assert.match(
      flat(screen),
      /const UNKNOWN_ORIGINAL_MODIFIED_AT = "—";/,
      "모르는 파일의 칸을 무엇으로 채우는지가 한 자리에 있어야 한다"
    );
  });

  test("🔴 올린 날짜로 메우는 길이 없다 — 그건 거짓이 된다", () => {
    const body = flat(code(screen));
    for (const forbidden of [
      "item.originalModifiedAt ?? item.uploadedAt",
      "item.originalModifiedAt || item.uploadedAt",
      "originalModifiedAt ?? uploadedAt",
    ]) {
      assert.ok(!body.includes(forbidden), `${forbidden} — 모르는 값을 올린 날짜로 메웠다`);
    }
  });

  test("날짜 꾸미는 자리는 예전 그대로 하나뿐이다", () => {
    assert.equal(
      code(screen).split("toLocaleString").length - 1,
      1,
      "formatTimestamp 말고 날짜를 꾸미는 자리가 또 생기면 두 날짜의 모양이 갈린다"
    );
  });
});

describe("🔴 올린 날짜 표시는 그대로다", () => {
  test("표에도 미리보기에도 올린 사람·올린 날짜가 예전 그대로 있다", () => {
    const body = flat(screen);
    assert.match(
      body,
      /<td className="whitespace-nowrap px-3 py-2 tabular-nums text-zinc-700 dark:text-zinc-300"> \{formatTimestamp\(item\.uploadedAt\)\} <\/td>/,
      "표의 올린 날짜 칸이 달라졌다"
    );
    assert.match(
      body,
      /\{item\.uploadedByName\} · \{formatTimestamp\(item\.uploadedAt\)\}/,
      "미리보기의 올린 사람 · 올린 날짜 줄이 달라졌다"
    );
  });
});

describe("🔴 미리보기 격자 — 아는 파일에만 한 줄 더", () => {
  test("올린 날짜 줄 바로 다음에, 이름을 붙여 적는다", () => {
    assert.match(
      flat(screen),
      /\{item\.originalModifiedAt && \( <span className="text-\[11px\] text-zinc-500 dark:text-zinc-400"> 원본 수정일 \{formatTimestamp\(item\.originalModifiedAt\)\} <\/span> \)\}/,
      "미리보기 쪽 표시가 사라졌거나 조건이 풀렸다"
    );
  });
});

describe("🔴 열이 늘어난 것이 표 폭 판정에 반영된다", () => {
  test("아는 파일이 하나도 없으면 열 자체를 그리지 않는다", () => {
    assert.match(
      flat(screen),
      /const hasOriginalModifiedAt = useMemo\( \(\) => attachments\.some\(\(item\) => item\.originalModifiedAt !== null\), \[attachments\] \);/,
      "판정이 사라지면 예전 모델의 표가 줄표만 늘어선 열 하나만큼 넓어진다"
    );
  });

  test("measureKey 에 함께 들어간다 — 안 넣으면 늘어난 폭을 다시 재지 않는다", () => {
    assert.match(
      flat(screen),
      /measureKey=\{\[attachments\.length, canManageFiles, hasPreviewable, hasOriginalModifiedAt\]\}/
    );
  });
});

describe("🔴 보내는 쪽과 받는 쪽이 같은 문을 지난다", () => {
  test("화면은 판정을 스스로 적지 않고 도메인 함수를 부른다", () => {
    assert.match(
      flat(screen),
      /const modifiedAt = originalModifiedAtParamValue\(file\.lastModified\);/,
      "화면이 file.lastModified 를 제 손으로 다듬으면 서버 판정과 갈라진다"
    );
    assert.match(
      flat(screen),
      /if \(modifiedAt !== null\) query\.set\(ORIGINAL_MODIFIED_AT_PARAM, modifiedAt\);/,
      "실을 수 없는 값을 보내면 서버가 조용히 버린다"
    );
    assert.ok(
      !flat(code(screen)).includes('query.set("lastModified"'),
      "주소에 싣는 이름을 손으로 적으면 읽는 쪽 이름과 갈라진다"
    );
  });

  test("통로도 같은 파일의 함수로 읽는다", () => {
    assert.ok(
      flat(code(modelRoute)).includes(
        "const originalModifiedAt = originalModifiedAtFromSearchParams(searchParams);"
      ),
      "통로가 값을 읽는 자리가 사라졌다"
    );
    assert.ok(
      code(modelRoute).includes('from "@/lib/domain/attachment-original-modified-at"'),
      "판정을 통로 안에 다시 적으면 화면과 갈라진다"
    );
    assert.match(
      flat(code(modelRoute)),
      /originalModifiedAt, uploadedBy: actingUser\.id,/,
      "읽어 놓고 기록에 넘기지 않으면 표에는 영영 빈칸이다"
    );
  });
});

describe("🔴 이 값 때문에 업로드가 막히지 않는다", () => {
  test("통로에 원본 수정일 때문에 생긴 실패 코드가 없다", () => {
    const failureCodes = modelRoute.slice(
      modelRoute.indexOf("type FailureCode"),
      modelRoute.indexOf("function fail(")
    );
    for (const word of ["MODIFIED", "LAST_MODIFIED", "INVALID_DATE"]) {
      assert.ok(!failureCodes.includes(word), `${word} — 날짜 하나 때문에 파일을 못 올리게 됐다`);
    }
  });

  test("읽은 값을 fail 로 넘기는 자리가 없다", () => {
    const body = code(modelRoute);
    assert.ok(
      !/fail\([^)]*[Mm]odified/.test(body),
      "원본 수정일이 실패 응답의 근거가 됐다 — 빈칸으로 두고 올려야 한다"
    );
  });

  test("기록 쪽도 이 값이 없으면 그냥 NULL 로 둔다 — 던지지 않는다", () => {
    assert.match(
      flat(code(mutations)),
      /originalModifiedAt: input\.originalModifiedAt \?\? null,/,
      "넘기지 않은 통로에서 행이 만들어지지 않으면 접수 건 업로드가 통째로 깨진다"
    );
  });
});

describe("🔴 이번에 열지 않은 자리", () => {
  test("접수 건 · 견적서 올리는 통로는 이 값을 건드리지 않는다", () => {
    for (const [name, source] of [
      ["접수 건", caseRoute],
      ["견적서", quoteRoute],
    ] as const) {
      assert.ok(
        !code(source).includes("originalModifiedAt"),
        `${name} 통로까지 함께 열렸다 — 이번 요청은 제품 모델 상세 화면이다`
      );
    }
  });

  test("조회는 모르는 값을 null 그대로 내려보낸다", () => {
    assert.match(
      flat(code(queries)),
      /originalModifiedAt: row\.originalModifiedAt\?\.toISOString\(\) \?\? null,/,
      "조회가 메우면 화면이 아무리 조심해도 소용이 없다"
    );
    assert.ok(
      !flat(code(queries)).includes("originalModifiedAt: (row.originalModifiedAt ?? row.uploadedAt)"),
      "올린 날짜로 메웠다"
    );
  });
});
