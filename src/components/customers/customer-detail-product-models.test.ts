import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * ============================================================================
 * 고객사 상세 [연결된 제품 모델] — **접수 기록에서 온 모델도 보인다** (2026-10-08)
 * ============================================================================
 * 이 구역은 오래 **사람이 손으로 걸어 둔 연결**만 보여 주었다. 실측(개발 DB)에서
 * 그 수기 연결은 6건(고객사 5곳 · 모델 3개)뿐인데 접수 건으로 이어지는 짝은 132쌍
 * 이었고, 접수 건이 있는 고객사 32곳 가운데 **27곳**이 이 자리에서 「없습니다」를
 * 보고 있었다.
 *
 * 조회가 두 갈래를 모두 읽도록 넓혔고(queries/product-model-customers.ts), 그 결과가
 * 실제로 두 갈래를 돌려주는지는 DB 를 켜고 보는 통합 시험의 몫이다
 * (db/mutations/product-models.integration.test.ts 의 listProductModelsForCustomer).
 * 여기서 보는 것은 **화면이 그 값을 쓰는 방식**이다.
 *
 * ── 🔴 왜 그려 보지 않고 원본을 글자로 읽는가 ───────────────────────────────
 * CustomerDetailScreen 은 수정 폼·담당자 목록·End-User 구역을 품은 클라이언트
 * 컴포넌트이고, 그 사슬이 서버 액션(update-customer · customer-contacts ·
 * end-users)을 거쳐 `server-only` 에 닿는다. react-server 조건을 켜지 않는
 * test:components 에서는 **import 자체가 던진다**:
 *
 *   Error: This module cannot be imported from a Client Component module.
 *
 * (조건을 켜면 이번에는 react-dom/server 가 스스로 막는다 — components.txt 머리말.)
 * 그래서 이웃들과 같은 방법을 쓴다 — product-models/product-model-customer-source.test.ts
 * 가 ProductModelEditForm 을 같은 까닭으로 글자로 읽는다. 값으로 볼 수 있는 것
 * (고르개의 키 · 줄 세우는 규칙)은 전부 domain/product-model-sort.test.ts 가
 * **값으로** 본다.
 * ============================================================================
 */

const repoUrl = new URL("../../../", import.meta.url);
/** CRLF 로 받아 둔 저장소에서도 표지가 맞도록 LF 로 맞춘다. */
const read = (relativePath: string) =>
  readFileSync(new URL(relativePath, repoUrl), "utf8").replace(/\r\n/g, "\n");
/** 줄바꿈·들여쓰기 차이로 시험이 깨지지 않도록 공백을 하나로 접는다. */
const flat = (source: string) => source.replace(/\s+/g, " ");
/** "이 이름이 나오면 안 된다" 를 볼 때 쓴다 — 주석에 적힌 까닭에 걸리지 않게. */
const code = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");

const screen = read("src/components/customers/CustomerDetailScreen.tsx");
const modelDetailScreen = read("src/components/product-models/ProductModelDetailScreen.tsx");
const queries = read("src/lib/db/queries/product-model-customers.ts");

describe("🔴 출처가 화면에 보인다", () => {
  test("두 갈래 모두 딱지가 있고, 색만이 아니라 글자가 있다", () => {
    // 색만으로 구분하지 않는다 — UI_GUIDELINE 7.
    assert.ok(screen.includes('label: "직접 연결"'), "수기 연결의 딱지 글자가 없다");
    assert.ok(screen.includes('label: "접수 기록"'), "접수 기록 딱지 글자가 없다");
  });

  test("딱지마다 왜 그런지 알려 주는 설명이 붙는다", () => {
    assert.ok(
      screen.includes("제품 모델 상세의 모델 기본정보에서 직접 걸어 둔 연결입니다."),
      "수기 연결을 어디서 만들었는지 알 길이 없어진다"
    );
    assert.ok(
      screen.includes("A/S 접수 기록에서 자동으로 나온 모델입니다. 수정 화면에서 지울 수 없습니다."),
      "왜 수정 화면에서 지울 수 없는지 알 길이 없어진다"
    );
  });

  test("🔴 갈래 이름은 도메인 한 벌에서 온다 — 화면이 글자를 새로 정하지 않는다", () => {
    assert.match(
      screen,
      /import type \{ ProductModelCustomerSource \} from "@\/lib\/domain\/product-model-customer-merge"/,
      "모델 → 고객사 방향과 다른 이름을 쓰면 같은 사실이 두 말로 불린다"
    );
    // Record<ProductModelCustomerSource, ...> 라 갈래가 하나 늘면 tsc 가 먼저 막는다
    // — 딱지가 없는 줄이 조용히 생기지 않는다.
    assert.ok(
      flat(screen).includes("const PRODUCT_MODEL_SOURCE_BADGES: Record< ProductModelCustomerSource,"),
      "갈래를 빠짐없이 덮는 표가 아니다"
    );
  });

  test("🔴 생김새와 글자가 반대 방향 화면의 딱지와 같다", () => {
    // 제품 모델 상세의 `고객사` 칸이 접수 기록에서 나온 고객사에 붙이는 알약.
    // 같은 사실을 두 화면이 다르게 보이면 보는 사람은 다른 사실이라고 읽는다.
    const pill =
      "rounded-full border border-sky-200 bg-sky-50 px-1.5 py-0.5 text-[10px] leading-none text-sky-700 dark:border-sky-900 dark:bg-sky-950 dark:text-sky-300";
    assert.ok(modelDetailScreen.includes(pill), "본보기가 바뀌었다 — 이 시험이 읽는 자리를 다시 맞춰야 한다");
    assert.ok(screen.includes(pill), "접수 기록 딱지의 생김새가 반대 방향 화면과 갈라졌다");
    assert.ok(modelDetailScreen.includes("접수 기록"), "본보기의 글자가 바뀌었다");
  });

  test("🔴 양쪽에서 이어진 모델은 한 줄이고 딱지가 둘이다", () => {
    // 조회가 이미 모델마다 한 줄로 접어 두 갈래를 모두 담아 준다. 화면이 첫 갈래만
    // 보고 말면 「수기이기도 하고 기록이기도 하다」는 사실이 사라진다.
    assert.ok(
      flat(screen).includes("{model.sources.map((source) => ( <ProductModelSourceBadge key={source} source={source} /> ))}"),
      "출처 전부를 그리지 않는다"
    );
    assert.equal(
      code(screen).includes("model.sources[0]"),
      false,
      "첫 갈래만 보면 둘 다인 줄이 한쪽으로만 보인다"
    );
  });

  test("🔴 딱지는 링크 밖이다 — 설명까지 눌리는 것처럼 보이면 안 된다", () => {
    const flatScreen = flat(screen);
    const linkAt = flatScreen.indexOf('<Link href={`/product-models/${model.id}`}');
    const badgeAt = flatScreen.indexOf("{model.sources.map((source) => (");
    assert.ok(linkAt >= 0, "모델 링크를 찾지 못했다");
    assert.ok(badgeAt > linkAt, "딱지는 링크를 닫은 뒤에 와야 한다");
    assert.ok(
      flatScreen.slice(linkAt, badgeAt).includes("</Link>"),
      "딱지가 링크 안에 들어가 있다 — 제품 모델 상세의 고객사 칸과 같은 규칙을 깬다"
    );
  });

  test("🔴 출처는 조회가 정한다 — 화면이 짐작하지 않는다", () => {
    // 화면이 받는 것은 `model.sources` 한 칸뿐이다. 접수 건 목록(이 화면의 `A/S
    // 이력` 구역이 따로 받는다)을 뒤져 "이 모델은 기록 쪽이군" 하고 짐작하거나,
    // 모델 → 고객사 방향의 합치는 함수를 끌어다 쓰면 두 화면이 서로 다른 답을 낸다.
    const body = code(screen);
    for (const forbidden of [
      "productModelCustomers",
      "derivedCustomers",
      "mergeProductModelCustomers",
      "repairCases.some",
      "repairCases.filter",
      "repairCases.map",
    ]) {
      assert.equal(body.includes(forbidden), false, `화면이 출처를 스스로 만들려 한다: ${forbidden}`);
    }
  });
});

describe("🔴 빈 문구가 이제 두 길을 말한다", () => {
  test("접수 건으로도 이어진다는 사실이 들어 있다", () => {
    assert.ok(
      screen.includes("A/S 접수 건이 생기면 그 제품의 모델이"),
      "접수 기록으로도 채워진다는 사실을 숨기면, 비어 있는 까닭을 잘못 읽는다"
    );
  });

  test("직접 거는 길도 그대로 알려 준다", () => {
    assert.ok(
      screen.includes("제품 모델 상세의 모델"),
      "수기 연결을 어디서 만드는지 알려 주던 길이 사라졌다"
    );
  });

  test("옛 문구는 남아 있지 않다", () => {
    assert.equal(
      flat(screen).includes(
        "이 고객사와 연결된 제품 모델이 없습니다. 연결은 제품 모델 상세의 모델 기본정보에서 만듭니다."
      ),
      false,
      "한 길만 알려 주던 문구가 그대로 남아 있다"
    );
  });
});

describe("🔴 이 구역은 여전히 보기 전용이다", () => {
  test("조회만 넓혔을 뿐 연결을 만들거나 지우는 길이 생기지 않았다", () => {
    const start = screen.indexOf("연결된 제품 모델</h2>");
    assert.ok(start >= 0, "구역 제목을 찾지 못했다");
    const section = screen.slice(start, screen.indexOf("A/S 이력</h2>", start));
    assert.equal(section.includes("Action("), false, "보기 전용 구역에서 서버 액션을 부른다");
    assert.equal(section.includes("<button"), false, "보기 전용 구역에 단추가 생겼다");
  });

  test("🔴 파생 연결은 표에 쓰이지 않는다 — 조회가 읽을 때 계산한다", () => {
    for (const write of [
      "insert(productModelCustomers",
      "update(productModelCustomers",
      "delete(productModelCustomers",
    ]) {
      assert.equal(code(queries).includes(write), false, `읽는 파일이 표를 고치면 안 된다: ${write}`);
    }
  });
});
