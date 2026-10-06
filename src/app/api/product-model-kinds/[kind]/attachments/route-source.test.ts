import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

/**
 * ============================================================================
 * POST /api/product-model-kinds/{kind}/attachments — 통로가 빠뜨린 것이 없는가
 * ============================================================================
 * 이 저장소는 라우트를 직접 부르지 않는다(세션 · DB · 스트림이 필요하다). 이웃
 * 통로들과 같은 방법으로 **원본 글자**를 읽는다.
 *
 * 이 통로는 제품 모델 통로(api/product-models/[id]/attachments)를 본떠 만들었고,
 * 그 사실 자체가 가장 중요한 성질이다 — 빠뜨린 검사가 있으면 그 하나가 곧 구멍이
 * 된다. 그래서 여기서 못 박는 것은 「무엇을 넣었나」가 아니라 **「모델 통로가
 * 하는 일 중 빠진 것이 없나」**다: 두 파일을 나란히 읽어 대조한다.
 *
 * 그 위에 이 통로만의 규율 넷:
 *  · 🔴 종류 코드가 셋 중 하나가 아니면 **400** (완료 기준 ①)
 *  · 🔴 주인 칸을 **종류 하나만** 채운다 — 나머지 셋은 손에 쥐지도 않는다 (②)
 *  · 🔴 권한은 **productModels.files WRITE** 다. 새 권한을 만들지 않았다 (⑤)
 *  · 🔴 받는 분류 목록을 **베껴 적지 않는다** — domain 의 한 함수를 부른다
 *
 * 실제 DB 에 그렇게 저장되는가는 db 목록의
 * queries/product-model-kind-attachments.integration.test.ts 의 몫이다(아직 안 돌렸다).
 * ============================================================================
 */

const route = readFileSync(new URL("./route.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n");
/** 주석을 뺀 코드 — 머리말이 까닭을 설명하느라 적은 낱말에 걸리지 않게. */
const code = route.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const modelRoute = readFileSync(
  new URL("../../../product-models/[id]/attachments/route.ts", import.meta.url),
  "utf8"
).replace(/\r\n/g, "\n");
const modelCode = modelRoute.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

function exportedNames(source: string): string[] {
  return [
    ...source.matchAll(
      /^export\s+(?:async\s+)?(?:function|const|let|var|class|type|interface|enum)\s+([A-Za-z_$][\w$]*)/gm
    ),
  ]
    .map((match) => match[1])
    .sort();
}

describe("종류 서류 올리기 통로 — 모델 통로와 대조한다", () => {
  test("🔴 Next 가 정한 이름만 export 한다 — POST · runtime · dynamic 뿐", () => {
    assert.deepEqual(exportedNames(route), ["POST", "dynamic", "runtime"]);
    assert.ok(route.includes('export const runtime = "nodejs";'));
    assert.ok(route.includes('export const dynamic = "force-dynamic";'));
    for (const method of ["GET", "PUT", "PATCH", "DELETE"]) {
      assert.equal(
        new RegExp(`export\\s+(?:async\\s+)?function\\s+${method}\\b`).test(route),
        false,
        `${method} 가 생겼다`
      );
    }
  });

  test("🔴 모델 통로가 거치는 검사를 하나도 빠뜨리지 않았다", () => {
    // 이름을 하나씩 적는다. 「모델 통로에 있는 호출이 전부 여기에도 있다」로 적으면
    // 그쪽이 이 통로와 무관한 함수를 하나 더 부르는 날 뜻 없이 깨진다.
    const MUST_CALL = [
      "isTrustedOrigin", // 출처
      "readSession", // 세션
      "resolveActingUserForSession", // 살아 있는 계정
      "hasPermission", // 권한
      "isAttachmentCategory", // 분류가 목록에 있는가
      "normalizeFileExtension", // 확장자 정규화
      "isCategoryOpenToAnyExtension", // 형식을 가리지 않는 분류인가
      "isAllowedExtension", // 전체 허용목록
      "isExtensionAllowedForCategory", // 분류별 허용목록
      "isUploadContentCompatible", // 실제 앞머리 바이트 대조
      "canonicalMimeTypeForExtension", // 정본 MIME(브라우저 값이 아니다)
      "MAX_ATTACHMENT_SIZE_BYTES", // 크기 상한
      "AttachmentTooLargeError", // 상한 초과
      "originalModifiedAtFromSearchParams", // 원본 수정일
      "createAttachmentRecord", // 행 + 감사(한 트랜잭션)
    ];
    for (const name of MUST_CALL) {
      assert.ok(modelCode.includes(name), `대조 기준이 흔들렸다 — 모델 통로에 ${name} 이 없다`);
      assert.ok(code.includes(name), `🔴 ${name} 이 빠졌다`);
    }
  });

  test("🔴 승인 대기 계정은 못 올린다 — 모델 통로와 같은 문장·같은 자리", () => {
    assert.ok(code.includes('actingUser.approvalStatus !== "APPROVED"'));
    assert.ok(code.includes("ACCOUNT_NOT_APPROVED"));
  });

  test("🔴 실패 코드가 모델 통로와 같다 — 종류 몫 한 줄만 다르다", () => {
    const codesOf = (source: string) =>
      [...source.matchAll(/^\s*\|?\s*"([A-Z_]+)"$/gm)].map((match) => match[1]).sort();
    const mine = new Set(codesOf(code.slice(0, code.indexOf("function fail("))));
    const theirs = new Set(codesOf(modelCode.slice(0, modelCode.indexOf("function fail("))));

    // 모델 통로에만 있는 것은 MODEL_NOT_FOUND 하나다 — 그 자리를 INVALID_KIND 가
    // 대신한다(주인이 행이 아니라 enum 이라 "없더라"가 아니라 "애초에 종류가 아니다").
    assert.deepEqual([...theirs].filter((item) => !mine.has(item)), ["MODEL_NOT_FOUND"]);
    assert.deepEqual([...mine].filter((item) => !theirs.has(item)), ["INVALID_KIND"]);
  });

  test("🔴 원본 수정일 때문에 올리기가 막히는 길이 없다 — 그 몫의 실패 코드가 없다", () => {
    const afterModified = code.slice(code.indexOf("originalModifiedAtFromSearchParams"));
    // 그 줄 뒤에도 fail( 은 나오지만(크기 · 빈 본문 …), 원본 수정일을 근거로 삼는
    // 것은 없어야 한다. 코드 이름으로 본다.
    assert.ok(!/fail\([^)]*MODIFIED/i.test(afterModified));
    assert.ok(!code.includes("INVALID_MODIFIED_AT"));
  });
});

describe("이 통로만의 규율", () => {
  test("🔴 ① 종류 코드가 셋 중 하나가 아니면 400 이다", () => {
    assert.ok(code.includes("isProductModelKind(kind)"), "종류 코드를 검증하지 않는다");
    assert.match(code, /if \(!isProductModelKind\(kind\)\) \{\s*return fail\(400, "INVALID_KIND"/);
  });

  test("🔴 종류 확인은 **본문을 받기 전에** 끝난다", () => {
    const kindCheck = code.indexOf("isProductModelKind(kind)");
    const bodyRead = code.indexOf("request.body");
    const writeTemp = code.indexOf("storage.writeTemp");
    assert.ok(kindCheck > 0 && bodyRead > 0 && writeTemp > 0);
    assert.ok(kindCheck < bodyRead, "본문을 먼저 집었다");
    assert.ok(kindCheck < writeTemp, "임시 파일을 먼저 썼다");
  });

  test("🔴 ② 주인은 종류 하나뿐이다 — 나머지 세 칸은 이 통로에 글자조차 없다", () => {
    // 갈래 하나를 넘기므로 세 칸은 mutation 이 NULL 로 정한다. 여기서 그 이름이
    // 보이면 누군가 함께 채우려 한 것이다(DB CHECK 가 거절하지만, 그때는 이미
    // 파일을 디스크에 놓은 뒤다).
    assert.ok(code.includes('owner: { kind: "PRODUCT_MODEL_KIND", productModelKind: kind }'));
    for (const forbidden of ["repairCaseId", "productModelId", "quoteId"]) {
      assert.ok(!code.includes(forbidden), `🔴 다른 주인 칸을 건드린다: ${forbidden}`);
    }
  });

  test("🔴 ⑤ 권한은 productModels.files WRITE 다 — 새 권한을 만들지 않았다", () => {
    assert.ok(code.includes('hasPermission(actingUser, "productModels.files", "WRITE")'));
    // 모델 통로와 **같은 글자**여야 한다 — 다르면 둘 중 하나가 넓어진 것이다.
    assert.ok(modelCode.includes('hasPermission(actingUser, "productModels.files", "WRITE")'));
    // 권한 영역을 새로 지어내지 않았다.
    assert.ok(!/"productModelKinds?\./.test(code), "새 권한 영역이 생겼다");
    assert.equal((code.match(/hasPermission\(/g) ?? []).length, 1, "권한을 두 번 묻는다");
  });

  test("🔴 권한 확인이 본문을 받기 전이다", () => {
    assert.ok(code.indexOf("hasPermission(") < code.indexOf("storage.writeTemp"));
  });

  test("🔴 받는 분류 목록을 베껴 적지 않는다 — domain 의 한 함수를 부른다", () => {
    assert.ok(code.includes("isAttachmentCategoryAllowedForProductModelKind(category)"));
    // 분류 코드를 손으로 늘어놓은 자리가 없어야 한다.
    for (const literal of ['"CHECKLIST"', '"PARAMETER"', '"POWER_TEST"', '"CIRCUIT_DIAGRAM"']) {
      assert.ok(!code.includes(literal), `분류를 직접 적었다: ${literal}`);
    }
  });

  test("🔴 본문은 파일 바이트 그 자체다 — FormData 를 읽지 않는다", () => {
    assert.ok(code.includes("request.body"));
    assert.ok(!code.includes("formData"), "multipart 로 받으면 파일 전체가 메모리에 올라온다");
    // 메타데이터는 질의문자열이다.
    assert.ok(code.includes('searchParams.get("category")'));
    assert.ok(code.includes('searchParams.get("fileName")'));
  });

  test("🔴 파일을 먼저 놓고 DB 를 나중에 — 뒤집으면 눌러도 안 열리는 기록이 생긴다", () => {
    const commit = code.indexOf("storage.commit(");
    const record = code.indexOf("createAttachmentRecord(");
    assert.ok(commit > 0 && record > 0);
    assert.ok(commit < record, "DB 를 먼저 쓴다");
    // 기록이 실패하면 방금 놓은 파일을 치운다.
    assert.ok(code.includes("storage.delete(storedPath)"));
  });

  test("🔴 저장 경로는 종류 전용 함수가 만든다 — 모델 경로 함수를 빌려 쓰지 않는다", () => {
    assert.ok(code.includes("buildProductModelKindAttachmentStoredPath("));
    assert.ok(
      !code.includes("buildProductModelAttachmentStoredPath("),
      "모델 경로 함수를 쓰면 종류 서류가 모델 폴더에 섞인다"
    );
  });

  test("🔴 실패 응답에 저장 루트 · 상대 경로가 실리지 않는다", () => {
    // fail(...) 의 인자에 storedPath · uploadsRoot 가 들어가지 않는다.
    // (`[\s\S]` 로 적는다 — `s` 플래그는 이 저장소의 컴파일 대상보다 뒤다.)
    for (const match of code.matchAll(/fail\(([\s\S]*?)\);/g)) {
      assert.ok(!match[1].includes("storedPath"), "실패 응답에 저장 경로가 실린다");
      assert.ok(!match[1].includes("UPLOADS_DIR"), "실패 응답에 저장 루트가 실린다");
    }
  });
});
