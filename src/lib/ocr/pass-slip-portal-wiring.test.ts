import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, test } from "node:test";

import { CUSTOMER_PORTAL_FORMS } from "../domain/customer-portal-forms";

/**
 * ============================================================================
 * 「통문증에서 통문번호 읽기」가 **어디에 붙어 있는가**
 * ============================================================================
 * 값으로 도는 부분은 이웃 두 시험이 본다(pass-slip-number · pass-slip-preprocess).
 * 여기서 못 박는 것은 그 기능이 화면·통로에 붙은 **모양**이다. 전부 조용히
 * 깨지는 것들이라 오류로는 드러나지 않는다.
 *
 *  1. 🔴 **통문증 첨부 id 가 고객에게 나가지 않는다.** 화면과 고객 화면이 같은
 *     조회를 쓰므로, 내보내는 자리에 칸 이름이 한 줄 끼면 그대로 샌다.
 *  2. 🔴 조회가 **휴지통을 빼고** · 「통문증」 분류만 보고 · **최신순**으로 준다.
 *  3. 🔴 양식 쪽 칸 키와 읽기 쪽 칸 키가 **같다.** 한쪽만 바뀌면 단추가 조용히
 *     사라지고 아무도 모른다.
 *  4. 🔴 단추는 **양식 보기 · 통문번호 칸 있음 · 고칠 권한 있음** 셋이 다 맞을
 *     때만 보인다.
 *  5. 🔴 **저장하지 않는다.** 읽기 쪽은 저장 통로를 부르지 않는다.
 *  6. 🔴 **이미 적힌 값을 덮지 않는다.**
 *  7. 🔴 **원본**을 받는다(썸네일로 읽으면 번호가 뭉개진다).
 *  8. 🔴 **인터넷을 쓰지 않는다** — 인식기와 언어 데이터가 저장소 안에 있다.
 *  9. 🔴 **바코드를 쓰지 않는다**(틀린 값을 자신 있게 내놓은 적이 있다).
 *
 * ── 왜 불러 보지 않고 원본을 글자로 읽는가 ─────────────────────────────
 * 화면 쪽은 `server-only` 사슬에 걸려 이 러너에서 import 자체가 던지고, 읽기
 * 쪽은 Worker · document 가 있는 브라우저에서만 산다. 이웃
 * customer-portal-form-view.test.ts 와 같은 방법이다.
 * ============================================================================
 */

const repoUrl = new URL("../../../", import.meta.url);
/** CRLF 로 받아 둔 저장소에서도 같게 읽히도록 LF 로 맞춘다. */
const read = (relativePath: string) =>
  fs.readFileSync(new URL(relativePath, repoUrl), "utf8").replace(/\r\n/g, "\n");
/** 주석을 지운다 — 이 파일들은 주석에 서로의 칸 이름을 까닭과 함께 길게 적는다. */
const code = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");
/** 줄바꿈·들여쓰기 차이로 깨지지 않도록 공백을 하나로 접는다. */
const flat = (source: string) => source.replace(/\s+/g, " ");

const query = read("src/lib/db/queries/customer-portal.ts");
const sync = read("src/lib/server/services/customer-portal-sync.ts");
const screen = read("src/components/customer-portal/CustomerPortalScreen.tsx");
const panel = read("src/components/customer-portal/PassSlipOcrPanel.tsx");
const reader = read("src/lib/ocr/pass-slip-reader.ts");
const worker = read("src/lib/ocr/pass-slip-worker.ts");

describe("🔴 1. 통문증 첨부 id 가 고객에게 나가지 않는다", () => {
  test("내보내는 자리에 칸 이름이 없다", () => {
    assert.ok(
      !code(sync).includes("passSlipAttachmentIds"),
      "통문증 첨부 id 가 고객 쪽으로 샌다"
    );
  });

  test("줄을 통째로 펼치지 않는다 — 펼치는 순간 앞으로 늘 칸이 전부 새어 나간다", () => {
    assert.ok(!/\.\.\.item\b/.test(code(sync)));
  });

  test("조회의 타입에는 있다 — 사내 표가 그것으로 읽는다", () => {
    assert.ok(code(query).includes("passSlipAttachmentIds: string[]"));
  });
});

describe("🔴 2. 조회가 어떤 첨부를 주는가", () => {
  const body = flat(code(query));

  test("「통문증」 분류만 본다", () => {
    assert.ok(body.includes('eq(attachments.category, "PASS_SLIP")'));
  });

  test("휴지통에 있는 것은 뺀다", () => {
    assert.ok(body.includes("eq(attachments.isDeleted, false)"));
  });

  test("가장 나중에 올린 것이 앞이다(같은 시각이면 id 로 가른다)", () => {
    assert.ok(
      body.includes("orderBy(desc(attachments.uploadedAt), desc(attachments.id))"),
      "차례가 정해져 있지 않으면 새로고침마다 다른 사진을 읽는다"
    );
  });

  test("접수 전 의뢰 줄은 빈 배열이다 — 접수가 없으니 첨부가 걸릴 자리도 없다", () => {
    assert.ok(body.includes("passSlipAttachmentIds: []"));
  });
});

describe("🔴 3. 양식 쪽 칸 키와 읽기 쪽 칸 키가 같다", () => {
  test("JUSUNG 양식에 손으로 적는 「통문번호」 칸이 있다", () => {
    const jusung = CUSTOMER_PORTAL_FORMS.find((form) => form.id === "JUSUNG");
    assert.ok(jusung, "JUSUNG 양식이 사라졌다");
    const column = jusung.columns.find((item) => item.key === "passNumber");
    assert.ok(column, "JUSUNG 양식에서 passNumber 칸이 사라졌다");
    assert.equal(column.kind, "MANUAL");
    assert.equal(column.label, "통문번호");
  });

  test("읽기 쪽이 그 키를 그대로 가리킨다", () => {
    assert.ok(
      code(panel).includes('export const PASS_SLIP_COLUMN_KEY = "passNumber"'),
      "두 쪽의 칸 키가 갈리면 단추가 조용히 사라진다"
    );
  });

  test("통문번호 칸이 없는 양식에서는 단추가 없다 — ICD · INVENIA 에는 그 칸이 없다", () => {
    for (const id of ["ICD", "INVENIA"]) {
      const form = CUSTOMER_PORTAL_FORMS.find((item) => item.id === id);
      assert.ok(form, `${id} 양식이 사라졌다`);
      assert.equal(
        form.columns.some((column) => column.key === "passNumber"),
        false
      );
    }
  });
});

describe("🔴 4. 단추가 보이는 조건", () => {
  test("양식 보기 · 통문번호 칸 · 고칠 권한 셋이 다 맞을 때만 그린다", () => {
    assert.ok(
      flat(code(screen)).includes("{showForm && form && passSlipColumn && canEdit ? ("),
      "단추가 보이는 조건이 바뀌었다"
    );
  });

  test("표 **위**에 있다 — 엑셀 내보내기 칸 다음, 표 앞", () => {
    const body = flat(code(screen));
    const panelAt = body.indexOf("<PassSlipOcrPanel");
    const tableAt = body.indexOf("<CustomerFormTable");
    assert.ok(panelAt > 0 && tableAt > 0);
    assert.ok(panelAt < tableAt, "단추가 표 아래로 내려갔다");
  });
});

describe("🔴 5. 저장하지 않는다 · 6. 이미 적힌 값을 덮지 않는다", () => {
  test("읽기 쪽이 저장 통로를 부르지 않는다", () => {
    assert.ok(
      !code(panel).includes("setCustomerStatusAction"),
      "읽은 값이 사람 손을 거치지 않고 저장된다"
    );
    assert.ok(!code(reader).includes("setCustomerStatusAction"));
  });

  test("접수 전 의뢰는 아예 고르지 않는다", () => {
    assert.ok(flat(code(panel)).includes('if (item.sourceKind !== "CASE") return false;'));
  });

  test("이미 적힌 줄은 고르지 않는다", () => {
    assert.ok(flat(code(panel)).includes('return written.trim() === "";'));
  });

  test("🔴 아직 손대지 않은 칸에만 얹는다 — 적어 둔 값도, 지운 값도 덮지 않는다", () => {
    assert.ok(
      flat(code(screen)).includes(
        "!Object.prototype.hasOwnProperty.call(typedValues, passSlipColumnKey) " +
          "? { ...typedValues, [passSlipColumnKey]: passSlipFilled } : typedValues;"
      ),
      "읽은 값이 사람이 적어 둔 값(또는 지운 칸)을 덮어쓴다"
    );
  });

  test("저장은 예전 그대로 줄마다 [저장] 단추이고 expectedVersion 을 싣는다", () => {
    assert.ok(flat(code(screen)).includes("expectedVersion: item.statusVersion,"));
  });
});

describe("🔴 7~9. 사진을 어디서 받고 무엇으로 읽는가", () => {
  test("원본을 받는다 — 썸네일이 아니다", () => {
    assert.ok(code(reader).includes('/download?view=full'));
    assert.ok(!code(reader).includes("view=thumb"), "썸네일로 읽으면 번호가 뭉개진다");
  });

  test("인식기와 언어 데이터를 우리 안에서 불러온다 — 인터넷에 기대지 않는다", () => {
    const body = code(reader);
    assert.ok(body.includes('const OCR_ASSET_BASE = "/ocr"'));
    assert.ok(!/https?:\/\//.test(body), "바깥 주소를 부르고 있다");
  });

  test("언어 데이터와 인식기 파일이 실제로 저장소에 있다", () => {
    for (const file of [
      "public/ocr/tesseract.min.js",
      "public/ocr/worker.min.js",
      "public/ocr/tesseract-core-simd-lstm.wasm.js",
      "public/ocr/tessdata/eng.traineddata.gz",
    ]) {
      assert.ok(fs.existsSync(new URL(file, repoUrl)), `없는 파일: ${file}`);
    }
  });

  test("🔴 wasm 코어는 한 벌뿐이고, 경로가 **파일**을 직접 가리킨다", () => {
    // SIMD 없는 예비본은 두지 않기로 했다(2026-10-01 사용자 결정 — 3.8MB).
    assert.equal(
      fs.existsSync(new URL("public/ocr/tesseract-core-lstm.wasm.js", repoUrl)),
      false,
      "빼기로 한 예비본이 되살아났다 — 저장소가 3.8MB 커진다"
    );
    // 🔴 폴더를 주면 tesseract.js 가 SIMD 여부를 보고 이름을 스스로 고르다가
    //    없는 그 예비본을 찾는다. 그러면 인식기가 아예 안 뜬다.
    assert.ok(
      flat(code(reader)).includes(
        "corePath: `${OCR_ASSET_BASE}/tesseract-core-simd-lstm.wasm.js`,"
      ),
      "코어 경로가 폴더로 돌아갔다 — 없는 파일을 찾게 된다"
    );
  });

  test("🔴 캐시를 끄지 않는다 — 끄면 줄 수만큼 3MB 를 다시 받는다", () => {
    assert.ok(code(reader).includes('cacheMethod: "write"'));
    assert.ok(!code(reader).includes('cacheMethod: "none"'));
  });

  test("🔴 바코드를 쓰지 않는다", () => {
    for (const [name, source] of Object.entries({ panel, reader, worker })) {
      assert.ok(!/zxing|barcode/i.test(code(source)), `${name} 에 바코드가 들어왔다`);
    }
  });

  test("🔴 전처리는 Web Worker 에서 돈다 — 메인 스레드가 멈추면 화면이 죽는다", () => {
    assert.ok(
      flat(code(reader)).includes(
        'new Worker(new URL("./pass-slip-worker.ts", import.meta.url), { type: "module", })'
      ),
      "워커를 띄우는 모양이 바뀌었다"
    );
  });
});
