import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, test } from "node:test";

import { CUSTOMER_PORTAL_FORMS } from "../domain/customer-portal-forms";

/**
 * ============================================================================
 * 「통문증에서 읽기」가 **어디에 붙어 있는가**
 * ============================================================================
 * 값으로 도는 부분은 이웃 세 시험이 본다(pass-slip-number · pass-slip-preprocess ·
 * pass-slip-goods). 여기서 못 박는 것은 그 기능이 화면·통로에 붙은 **모양**이다.
 * 전부 조용히 깨지는 것들이라 오류로는 드러나지 않는다.
 *
 *  1. 🔴 **통문증 첨부 id 와 아는 Q코드 목록이 고객에게 나가지 않는다.** 화면과
 *     고객 화면이 같은 조회를 쓰므로, 내보내는 자리에 칸 이름이 한 줄 끼면 샌다.
 *  2. 🔴 조회가 **휴지통을 빼고** · 「통문증」 분류만 보고 · **최신순**으로 준다.
 *  3. 🔴 양식 쪽 칸 키와 읽기 쪽 칸 키가 **같다.** 한쪽만 바뀌면 그 칸이 조용히
 *     읽기 대상에서 빠지고 아무도 모른다. 🔴 **Q4.Level 은 대상이 아니다.**
 *  4. 🔴 단추는 **양식 보기 · 읽을 칸 있음 · 고칠 권한 있음** 셋이 다 맞을
 *     때만 보인다.
 *  5. 🔴 **저장하지 않는다.** 읽기 쪽은 저장 통로를 부르지 않는다.
 *  6. 🔴 **이미 적힌 값을 덮지 않는다** — 칸마다 따로 본다.
 *  7. 🔴 **원본**을 받는다(썸네일로 읽으면 번호가 뭉개진다).
 *  8. 🔴 **인터넷을 쓰지 않는다** — 인식기와 언어 데이터가 저장소 안에 있다.
 *  9. 🔴 **바코드를 쓰지 않는다**(틀린 값을 자신 있게 내놓은 적이 있다).
 * 10. 🔴 사진을 펼치는 일은 **한 장에 한 번**이고, 「없음」과 「못 읽음」이 화면에서
 *     **다른 글자**로 나온다.
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
const goods = read("src/lib/ocr/pass-slip-goods.ts");
const suggestions = read("src/components/customer-portal/pass-slip-suggestions.ts");

describe("🔴 1. 통문증 첨부 id 와 아는 Q코드 목록이 고객에게 나가지 않는다", () => {
  test("내보내는 자리에 칸 이름이 없다", () => {
    assert.ok(
      !code(sync).includes("passSlipAttachmentIds"),
      "통문증 첨부 id 가 고객 쪽으로 샌다"
    );
    assert.ok(
      !code(sync).includes("knownQCodes"),
      "그 고객사가 쓰던 Q코드 목록이 고객 쪽으로 샌다"
    );
  });

  test("줄을 통째로 펼치지 않는다 — 펼치는 순간 앞으로 늘 칸이 전부 새어 나간다", () => {
    assert.ok(!/\.\.\.item\b/.test(code(sync)));
  });

  test("조회의 타입에는 있다 — 사내 표가 그것으로 읽는다", () => {
    assert.ok(code(query).includes("passSlipAttachmentIds: string[]"));
    assert.ok(code(query).includes("knownQCodes: string[]"));
  });

  test("🔴 Q코드 목록은 **그 고객사 것만** 모은다 — 상태 표는 고객사를 가리지 않고 읽힌다", () => {
    const body = flat(code(query));
    assert.ok(
      body.includes("collectKnownQCodes(statusRows, customerCaseIds)"),
      "다른 고객사의 Q코드가 섞이면 「아는 값」이 뜻을 잃는다"
    );
    assert.ok(body.includes("if (!caseIds.has(row.repairCaseId)) continue;"));
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
  const jusung = CUSTOMER_PORTAL_FORMS.find((form) => form.id === "JUSUNG");

  test("JUSUNG 양식에 손으로 적는 세 칸이 있다", () => {
    assert.ok(Boolean(jusung), "JUSUNG 양식이 사라졌다");
    for (const [key, label] of [
      ["passNumber", "통문번호"],
      ["prvNumber", "PRV No."],
      ["qCode", "Q코드"],
    ]) {
      const column = jusung?.columns.find((item) => item.key === key);
      assert.equal(column?.kind, "MANUAL", `JUSUNG 양식에서 ${key} 칸이 사라졌다`);
      assert.equal(column?.label, label);
    }
  });

  test("읽기 쪽이 그 키들을 그대로 가리킨다", () => {
    for (const line of [
      'export const PASS_SLIP_COLUMN_KEY = "passNumber"',
      'export const PASS_SLIP_PRV_COLUMN_KEY = "prvNumber"',
      'export const PASS_SLIP_Q_COLUMN_KEY = "qCode"',
    ]) {
      assert.ok(code(panel).includes(line), `두 쪽의 칸 키가 갈리면 ${line} 칸이 조용히 빠진다`);
    }
  });

  test("🔴 「Q4.Level」은 읽지 않는다 — 통문증에 아예 없는 값이라 자동으로 알 길이 없다", () => {
    assert.ok(
      jusung?.columns.some((column) => column.key === "qLevel"),
      "Q4.Level 칸이 사라졌다(손으로 적는 칸이다)"
    );
    assert.ok(
      !code(panel).includes("qLevel"),
      "읽기 쪽이 Q4.Level 을 건드린다 — 지어낸 값이 고객사 표에 적힌다"
    );
  });

  test("세 칸이 없는 양식에서는 단추가 없다 — ICD · INVENIA 에는 그 칸이 없다", () => {
    for (const id of ["ICD", "INVENIA"]) {
      const form = CUSTOMER_PORTAL_FORMS.find((item) => item.id === id);
      assert.ok(form, `${id} 양식이 사라졌다`);
      assert.equal(
        form.columns.some((column) =>
          ["passNumber", "prvNumber", "qCode"].includes(column.key)
        ),
        false
      );
    }
  });
});

describe("🔴 4. 단추가 보이는 조건", () => {
  test("양식 보기 · 읽을 칸 있음 · 고칠 권한 셋이 다 맞을 때만 그린다", () => {
    assert.ok(
      flat(code(screen)).includes(
        "{showForm && form && passSlipColumns.length > 0 && canEdit ? ("
      ),
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
    assert.ok(flat(code(panel)).includes('if (item.sourceKind !== "CASE") return [];'));
  });

  test("🔴 이미 적힌 **칸**은 고르지 않는다 — 줄째 건너뛰지 않고 칸마다 본다", () => {
    assert.ok(
      flat(code(panel)).includes(
        '.filter((column) => (written[column.key] ?? "").trim() === "")'
      ),
      "빈 칸을 고르는 방식이 바뀌었다"
    );
  });

  test("🔴 아직 손대지 않은 칸에만 얹는다 — 적어 둔 값도, 지운 값도 덮지 않는다", () => {
    // 갈래별 동작은 pass-slip-suggestions.test.ts 가 본다.
    assert.ok(
      flat(code(suggestions)).includes(
        "if (Object.prototype.hasOwnProperty.call(typedValues, key)) continue;"
      ),
      "읽은 값이 사람이 적어 둔 값(또는 지운 칸)을 덮어쓴다"
    );
    assert.ok(
      flat(code(screen)).includes(
        "const values = applyPassSlipSuggestions(typedValues, passSlipOutcome);"
      ),
      "화면이 그 함수를 쓰지 않는다 — 규칙이 둘로 갈렸다"
    );
  });

  test("🔴 엉뚱한 서류의 값은 **애초에 칸에 쓰지 않는다** — 막을 것도 남지 않는다", () => {
    const body = flat(code(suggestions));
    assert.ok(
      body.includes('if (outcome.serialCheck?.state === "MISMATCH") {'),
      "S/N 이 어긋난 줄을 걸러 내는 자리가 사라졌다"
    );
    assert.ok(
      body.includes("counts: { ...NO_COUNTS, skipped: targetKeys.length },"),
      "어긋난 줄의 칸을 「채움」으로 세고 있다"
    );
    // 🔴 못 읽음(UNREAD)까지 버리면 흐린 사진에서 쓸 수 있는 값을 잃는다.
    assert.ok(
      !/serialCheck\?\.state === "UNREAD"[\s\S]{0,80}return/.test(body),
      "못 읽음까지 버리고 있다"
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

describe("🔴 10. 세 칸을 한 장에서 읽는 모양", () => {
  test("🔴 사진을 펼치는 일은 **한 장에 한 번**이다 — 네 전처리가 그 픽셀을 나눠 쓴다", () => {
    const body = flat(code(worker));
    assert.equal(
      (body.match(/await decodeToRgba\(/g) ?? []).length,
      1,
      "디코드가 여러 번이면 한 장에 몇 배가 걸린다"
    );
    assert.ok(
      body.includes("for (const name of request.passes) {"),
      "한 번 펼친 픽셀로 여러 전처리를 도는 모양이 바뀌었다"
    );
  });

  test("🔴 쪽 나눔 방식은 **패스마다** 정한다 — 띠는 6, 물품정보 표는 4 다", () => {
    assert.ok(
      flat(code(reader)).includes(
        "await worker.setParameters({ tessedit_pageseg_mode: pass.pageSegMode });"
      ),
      "psm 을 한 번만 정하면 둘 가운데 하나가 틀린 설정으로 읽힌다"
    );
  });

  test("🔴 PRV 는 **그 건의 S/N** 으로 줄을 고른다", () => {
    assert.ok(flat(code(panel)).includes("serialNumber: item.serialNumber,"));
    assert.ok(flat(code(reader)).includes("decidePrvNumber(readings, serialNumber)"));
  });

  test("🔴 아는 Q코드 목록은 **거절하는 목록이 아니다** — 없어도 채우고 표시만 다르다", () => {
    const body = flat(code(goods));
    assert.ok(
      body.includes("const known = Boolean(knownQCodes && knownQCodes.size > 0 && knownQCodes.has(voted.value));"),
      "아는 값인지 보는 자리가 바뀌었다"
    );
    assert.ok(
      !/knownQCodes[\s\S]{0,120}state: "UNREAD"/.test(body),
      "목록에 없다고 채우기를 거절하면 목록이 얇은 처음에는 기능이 아무 일도 못 한다"
    );
  });

  test("🔴 「서류에 없음」과 「못 읽음」이 화면에서 **다른 글자 · 다른 색**이다", () => {
    const body = code(suggestions);
    assert.ok(body.includes('text: "이 통문증에 없음"'), "「없음」 글자가 사라졌다");
    assert.ok(body.includes("text: WRITE_BY_HAND"), "「못 읽음」 글자가 사라졌다");
    assert.ok(
      body.includes('export const WRITE_BY_HAND = "못 읽음 — 손으로 적어 주세요"'),
      "「못 읽음」 글자가 바뀌었다"
    );
    // 색도 갈라져 있다(색만으로 알리지는 않는다 — 위 글자가 먼저다).
    const tones = code(panel);
    assert.ok(/absent: "text-sky-700"/.test(tones));
    assert.ok(/none: "text-zinc-500"/.test(tones));
  });

  test("🔴 사진이 **그 건의 것이 아니면 한 칸도 쓰지 않는다** — 끝난 뒤 팝업으로 알린다", () => {
    assert.ok(
      flat(code(reader)).includes("checkSerialAgainstDocument(readings, serialNumber)"),
      "서류의 S/N 을 맞춰보는 자리가 사라졌다"
    );
    // 🔴 어긋난 줄은 값을 버린다(갈래별 동작은 pass-slip-suggestions.test.ts).
    assert.ok(
      flat(code(suggestions)).includes('if (outcome.serialCheck?.state === "MISMATCH") {'),
      "어긋난 줄을 걸러 내는 자리가 사라졌다"
    );
    // 🔴 알리는 것은 **끝난 뒤 한 번**이고, 사람이 닫아야 닫히는 팝업이다.
    const panelBody = flat(code(panel));
    assert.ok(panelBody.includes("if (mismatchRows.length > 0) setMismatch(mismatchRows);"));
    assert.ok(panelBody.includes("<NoticePopup"), "경고 팝업이 사라졌다");
    assert.ok(
      !panelBody.includes("showSavePopup"),
      "0.5초 뒤 사라지는 저장 팝업으로 경고를 띄운다"
    );
  });

  test("🔴 판정이 세 갈래 그대로다 — ABSENT 과 UNREAD 를 합치면 걸린다", () => {
    const body = code(goods);
    for (const state of ['state: "READ"', 'state: "ABSENT"', 'state: "UNREAD"']) {
      assert.ok(body.includes(state), `${state} 가 사라졌다`);
    }
  });
});
