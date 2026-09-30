import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * ============================================================================
 * 고객사 현황표 엑셀 패널 — 덮어쓰기를 말하는가 · 여기서 설치할 수 있는가
 * ============================================================================
 * 사용자가 실제로 눌러 보고 둘을 더 요청했다(2026-09-30):
 *   ① 「같은 제목의 엑셀이 있다면 덮어씌워줘.」
 *   ② 「폴더열기 도우미를 [폴더 열기] 버튼이 있는 곳 어디서든 설치할 수 있도록 해줘.」
 *
 * 값으로 도는 부분은 딴 데서 본다 — 덮어쓰기 자체는 unit 목록의
 * lib/storage/customer-portal-archive.test.ts, 설치 권한은 lib/server/quote-folder-helper.test.ts
 * 와 두 route-source 시험. 여기서 못 박는 것은 **화면이 그 결과를 어떻게 말하는가**다:
 *
 *  1. 🔴 「덮어썼다」를 **사람이 읽는 문장으로** 말한다 — 조용히 덮어쓰면 사람은 자기가 손으로
 *     고쳐 둔 내용이 사라진 것을 모른 채 그 파일을 고객사에 보낸다.
 *  2. 🔴 「새로 만듦」 · 「덮어씀」 · 「내용이 같아 그대로 둠」이 **서로 다른 문장**이고,
 *     덮어쓴 경우만 **경고 결**로 난다(나머지와 같은 색이면 눈에 걸리지 않는다).
 *  3. 🔴 이 화면에서 도우미를 **설치할 수 있다** — [설치 명령 복사]가 있고, 안내 문장이
 *     그 단추를 가리킨다. 「예전 설치본이면 한 번 더」라는 뜻이 견적서 화면과 어긋나지 않는다.
 *  4. 🔴 **새 도우미를 만들지 않았다** — 견적서 화면과 같은 흐름 하나를 부른다. 설치 파일
 *     통로(installer)를 부르지 않고, 네 번째 복사 구현을 두지 않는다.
 *
 * ── 왜 렌더하지 않고 원본을 읽는가 ──────────────────────────────────────
 * CustomerFormExportPanel 은 서버 액션(actions/customer-portal-export)을 직접 import 하는
 * 클라이언트 컴포넌트라, 그 사슬 끝의 `server-only` 때문에 react-server 조건 없이 도는
 * test:components 에서는 import 자체가 던진다. 이웃(customer-portal-form-view.test.ts)과 같은
 * 방법으로 원본을 글자로 읽는다.
 * ============================================================================
 */

const repoUrl = new URL("../../../", import.meta.url);
/** CRLF 로 받아 둔 저장소에서도 표지가 맞도록 LF 로 맞춘다. */
const read = (relativePath: string) =>
  readFileSync(new URL(relativePath, repoUrl), "utf8").replace(/\r\n/g, "\n");
/** 줄바꿈·들여쓰기 차이로 시험이 깨지지 않도록 공백을 하나로 접는다. */
const flat = (source: string) => source.replace(/\s+/g, " ");
/** 머리말은 없앤 길 · 지난 규칙을 **일부러** 설명한다 — 「무엇을 부르는가」는 주석을 뺀 원본으로 본다. */
const withoutComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

const PANEL = "src/components/customer-portal/CustomerFormExportPanel.tsx";
const ACTION = "src/lib/server/actions/customer-portal-export.ts";

const panel = read(PANEL);
const panelFlat = flat(panel);
const panelCode = withoutComments(panel);
const action = read(ACTION);
const actionFlat = flat(action);

describe("🔴 덮어쓴 사실을 화면이 말한다", () => {
  test("세 갈래가 서로 다른 문장이다 — 새로 만듦 · 덮어씀 · 그대로 둠", () => {
    const messages = ["saved", "replaced", "unchanged"].map((status) => {
      const at = actionFlat.indexOf(`case "${status}":`);
      assert.ok(at >= 0, `saveMessage 에 ${status} 갈래가 없다`);
      const line = actionFlat.slice(at, actionFlat.indexOf(";", at));
      assert.ok(line.includes("${fileName}"), `${status} 문장이 파일 이름을 말하지 않는다`);
      return line;
    });
    assert.equal(new Set(messages).size, 3, "세 갈래의 문장이 겹친다");
  });

  test("🔴 덮어썼다는 사실과 그 뜻을 함께 말한다 — 손으로 고친 내용이 사라졌다", () => {
    const at = actionFlat.indexOf('case "replaced":');
    const line = actionFlat.slice(at, actionFlat.indexOf(";", at));
    assert.ok(line.includes("덮어썼습니다"), line);
    assert.ok(line.includes("사라졌습니다"), line);
  });

  test("「그대로 둠」을 「저장했다」로 말하지 않는다", () => {
    const at = actionFlat.indexOf('case "unchanged":');
    const line = actionFlat.slice(at, actionFlat.indexOf(";", at));
    assert.ok(line.includes("그대로 두었습니다"), line);
    assert.ok(!line.includes("저장했습니다"), line);
  });

  test("🔴 화면은 덮어쓴 경우만 경고 결로 낸다 — 나머지와 색이 같으면 눈에 걸리지 않는다", () => {
    assert.ok(
      panelFlat.includes('tone: result.status === "replaced" ? "warning" : "normal"'),
      "덮어쓴 결과를 나머지와 같은 결로 낸다"
    );
    assert.ok(panelFlat.includes('warning: "text-amber-800"'), "경고 결의 색이 없다");
  });

  test("🔴 통로가 status 를 화면까지 가져온다 — 화면이 혼자 짐작하지 않는다", () => {
    assert.ok(actionFlat.includes('status: "saved" | "replaced" | "unchanged"'), "결과 모양에 status 가 없다");
    assert.ok(actionFlat.includes("status: saved.status"), "status 를 그대로 올려 보내지 않는다");
  });
});

describe("🔴 이 화면에서 도우미를 설치할 수 있다", () => {
  test("[설치 명령 복사] 단추가 있고, [폴더 열기]가 통한 뒤에 난다", () => {
    assert.ok(panelFlat.includes("> 설치 명령 복사 </button>"), "설치 단추가 없다");
    assert.ok(panelFlat.includes("data-portal-folder-helper-install-command"), "단추를 집을 표가 없다");
    assert.ok(panelFlat.includes("{offerHelperInstall ? ("), "단추가 늘 나 있다");
    assert.ok(panelFlat.includes("setOfferHelperInstall(true)"), "폴더 열기가 통해도 단추가 나지 않는다");
    assert.ok(panelFlat.includes("setOfferHelperInstall(false)"), "폴더를 열지 못했는데도 단추가 남는다");
  });

  test("🔴 안내 문장이 이 화면의 단추를 가리킨다 — 견적서 화면으로 보내지 않는다", () => {
    const hint = panel.slice(panel.indexOf("export const PORTAL_FOLDER_HELPER_HINT_TEXT"));
    const text = hint.slice(0, hint.indexOf(";"));
    assert.ok(text.includes("[설치 명령 복사]"), text);
    assert.ok(text.includes("예전 설치본"), "「예전 설치본이면 한 번 더」라는 뜻이 사라졌다");
    assert.ok(text.includes("이미 설치했더라도"), "이미 설치한 사람이 멈춘다");
    assert.ok(!text.includes("견적서 화면의 [폴더 열기]"), "아직도 견적서 화면으로 보낸다");
    // 견적서 화면의 같은 자리 문장과 뜻이 어긋나지 않게 — 둘 다 관리자 권한이 필요 없다고 말한다.
    const quoteMissing = read("src/components/quotes/quote-folder-open.ts");
    assert.ok(quoteMissing.includes("관리자 권한은 필요 없습니다"), "견적서 쪽 문장이 바뀌었다");
    assert.ok(text.includes("관리자 권한은 필요 없습니다"), text);
  });

  test("🔴 새 도우미를 만들지 않았다 — 견적서 쪽 흐름 하나를 그대로 부른다", () => {
    assert.ok(
      panel.includes(
        'import { runQuoteFolderHelperInstallCommandCopy } from "@/components/quotes/quote-folder-open";'
      ),
      "견적서 쪽 설치 흐름을 부르지 않는다"
    );
    assert.ok(panelCode.includes("await runQuoteFolderHelperInstallCommandCopy()"), panelCode.slice(0, 200));
    // 설치 자리(레지스트리 · 스크립트)를 이 화면이 아는 일이 없다.
    for (const forbidden of ["dss-folder://", "LOCALAPPDATA", "HKCU", "open-dss-folder", "installer"]) {
      assert.equal(panelCode.includes(forbidden), false, `화면이 ${forbidden} 를 안다`);
    }
  });

  test("🔴 설치 명령 본문을 화면에 · 콘솔에 쏟지 않는다 — 사내 공유폴더 주소가 들어 있다", () => {
    assert.equal(panel.includes("console."), false, "콘솔에 찍는 곳이 있다");
    // 돌려받는 것은 줄(text · tone)뿐이다 — 명령 본문을 꺼내 쥐는 자리가 없다.
    assert.equal(/\.command\b/.test(panelCode), false, "설치 명령 본문을 화면이 쥔다");
    assert.ok(panelCode.includes("lines.map((line) => ({ text: line.text, tone: noticeToneOf(line.tone) }))"));
  });

  test("네 번째 복사 구현을 두지 않았다 — 공용 copyText 와 견적서 흐름뿐", () => {
    assert.equal(panel.includes("execCommand"), false);
    assert.equal(/navigator\.clipboard\.writeText/.test(panel), false);
    assert.ok(panel.includes('import { copyText } from "@/components/common/copy-text";'));
  });
});

/**
 * ============================================================================
 * 🔴 저장 뒤 **공유폴더의 파일이 움직인 일**을 화면이 말하는가 (2026-09-30)
 * ============================================================================
 * 「공유폴더에 저장을 눌렀을 때, 파일의 날짜가 다른 파일은 OLD 파일을 만들어서 거기로
 * 옮겨가도록 해줘.」 지금까지 사람이 손으로 하던 일을 자동으로 한다.
 *
 * 실제로 파일을 옮기는 것과 그 안전(무엇을 옮기고 무엇을 안 옮기는가 · 저장이 실패하면
 * 안 옮긴다 · 어떤 경우에도 파일이 사라지지 않는다)은 unit 목록의
 * lib/storage/customer-portal-archive.test.ts 가 값으로 지킨다. 여기서 못 박는 것은
 * **화면이 그 일을 사람에게 어떻게 말하는가**다:
 *
 *  1. 몇 개를 옮겼는지 말한다. 옮긴 것이 0개면 그 줄을 **아예 내지 않는다**(늘 나는 줄은
 *     읽히지 않는다).
 *  2. 🔴 못 옮긴 파일이 있으면 **이름과 함께** 경고 결로 내고, 「저장은 끝났다」를 먼저
 *     말한다 — 저장이 잘못된 것으로 읽히면 사람이 저장을 다시 누른다.
 *  3. 🔴 옮기기가 실패해도 **저장은 성공이다** — 통로가 `ok: false` 로 뒤집지 않는다.
 * ============================================================================
 */
describe("🔴 저장 뒤 파일이 OLD 로 간 것을 화면이 말한다", () => {
  test("저장 문장이 그대로 첫 줄이다 — 옮긴 이야기가 그것을 밀어내지 않는다", () => {
    assert.ok(
      panelFlat.includes(
        'const lines: Notice[] = [ { text: result.message, tone: result.status === "replaced" ? "warning" : "normal" }, ];'
      ),
      "저장 결과 문장이 첫 줄이 아니다"
    );
  });

  test("몇 개를 옮겼는지 말한다 — 0개면 그 줄을 내지 않는다", () => {
    assert.ok(panelFlat.includes("if (result.movedToOldCount > 0) {"), "옮긴 것이 0개여도 줄을 낸다");
    assert.ok(
      panelFlat.includes('lines.push({ text: movedToOldText(result.movedToOldCount), tone: "muted" });')
    );
    const at = panel.indexOf("export function movedToOldText");
    assert.ok(at >= 0, "옮긴 개수를 말하는 문장이 없다");
    const body = panel.slice(at, panel.indexOf("\n}", at));
    assert.ok(body.includes("${count}개"), body);
    assert.ok(body.includes("OLD 폴더로 옮겼습니다"), body);
  });

  test("🔴 못 옮긴 파일은 이름과 함께 경고 결로 낸다 — 「저장은 끝났다」를 먼저 말한다", () => {
    assert.ok(panelFlat.includes("if (result.moveFailedFileNames.length > 0) {"));
    assert.ok(
      panelFlat.includes(
        'lines.push({ text: moveFailedText(result.moveFailedFileNames), tone: "warning" });'
      ),
      "못 옮긴 파일을 경고 결로 내지 않는다"
    );
    const at = panel.indexOf("export function moveFailedText");
    assert.ok(at >= 0, "못 옮긴 파일을 말하는 문장이 없다");
    const body = panel.slice(at, panel.indexOf("\n}", at));
    assert.ok(body.includes("저장은 끝났"), body);
    assert.ok(body.includes("손으로 옮겨"), "사람이 할 일을 짚지 않는다");
    assert.ok(body.includes("fileNames.join"), "못 옮긴 파일 이름을 말하지 않는다");
  });

  test("🔴 옮기기가 실패해도 저장은 성공이다 — 통로가 ok: false 로 뒤집지 않는다", () => {
    assert.ok(actionFlat.includes("movedToOldCount: saved.archived.movedCount"), "옮긴 개수를 올리지 않는다");
    assert.ok(
      actionFlat.includes("moveFailedFileNames: saved.archived.failedFileNames"),
      "못 옮긴 이름을 올리지 않는다"
    );
    // 옮기기 결과를 보고 성패를 가르는 곳이 없다 — 저장이 성공이면 그대로 성공이다.
    assert.equal(actionFlat.includes("failedFileNames.length"), false, "옮기기 실패로 저장을 뒤집는다");
  });
});
