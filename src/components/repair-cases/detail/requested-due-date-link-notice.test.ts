import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * ============================================================================
 * 🔴 수리 건 상세 — 「내자가 못 따라갔다」를 **사람이 알게 하는가** (2026-10-30)
 * ============================================================================
 * 고객 요청 납기일을 고치면 연결된 내자 정리의 납기요청일도 같은 날짜가 된다
 * (db/mutations/repair-cases.ts). 묶지 못하는 자리가 있고(줄이나 날짜가 여럿),
 * 그때 서버는 **까닭을 저장 결과에 실어 보낸다.** 화면이 그것을 버리면 사람은
 * 「A/S 정보를 저장했습니다」만 보고 양쪽이 맞춰진 줄 안다.
 *
 * ── 🔴 왜 알림을 **폼이 아니라 상세 화면**이 띄우는가 ────────────────────
 * 저장에 성공하면 편집 폼은 닫힌다(onDone → 언마운트). 읽고 닫아야 하는 알림을 그
 * 안에서 그리면 뜨자마자 함께 사라진다. 그래서 상태와 그리기는 폼보다 오래 사는
 * RepairCaseDetailView 가 가지고, 폼은 **올려 보내기만** 한다.
 *
 * 🔵 그 올려 보내는 자리를 훅이 **선택 인자**로 둔 것도 같은 이유의 뒷면이다 —
 * 다섯 부르는 곳 중 이 값을 받는 것은 인수정보 폼 하나뿐이고(고객 요청 납기일을
 * 보내는 폼이 그것뿐이다), 「알림을 띄울 때까지 폼을 닫지 않는다」로 만들었으면
 * 나머지 넷이 언젠가 닫히지 않는 폼이 된다. 저장 팝업과 겹치지 않게 **그때만**
 * 팝업을 건너뛴다는 사실은 save-popup-screens.test.ts 가 훅 원본에서 본다.
 * ============================================================================
 */

const repoUrl = new URL("../../../../", import.meta.url);
const read = (relativePath: string) =>
  readFileSync(new URL(relativePath, repoUrl), "utf8").replace(/\r\n/g, "\n");
const flat = (source: string) => source.replace(/\s+/g, " ");

const hook = read("src/components/repair-cases/detail/edit/useSectionEditSubmit.ts");
const intakeForm = read("src/components/repair-cases/detail/edit/IntakeInfoEditForm.tsx");
const intakeSection = read("src/components/repair-cases/detail/IntakeInfoSection.tsx");
const detailView = read("src/components/repair-cases/detail/RepairCaseDetailView.tsx");

test("🔴 묶기 결과가 훅 → 폼 → 구역 → 상세 화면까지 **끊기지 않고** 이어진다", () => {
  // 한 칸이라도 빠지면 타입이 막아 주지만(필수 프롭), **엉뚱한 곳에 묶는 것**은
  // 타입이 안 막는다. 그래서 이름을 자리마다 글자로 확인한다.
  assert.match(hook, /onRequestedDueDateNotLinked\?: \(message: string\) => void;/);
  assert.match(
    flat(hook),
    /const link = result\.requestedDueDateLink; if \(link && !link\.linked && params\.onRequestedDueDateNotLinked\) \{ params\.onRequestedDueDateNotLinked\(link\.message\); return; \}/
  );
  assert.match(flat(intakeForm), /savedPopup: REPAIR_CASE_SAVED_POPUP, [^;]*onRequestedDueDateNotLinked, \}\);/);
  assert.match(intakeForm, /onRequestedDueDateNotLinked: \(message: string\) => void;/);
  assert.match(
    flat(intakeSection),
    /<IntakeInfoEditForm[^>]*onRequestedDueDateNotLinked=\{onRequestedDueDateNotLinked\}/
  );
  assert.match(
    flat(detailView),
    /<IntakeInfoSection[^>]*onRequestedDueDateNotLinked=\{setRequestedDueDateNotLinked\}/
  );
});

test("🔴 알림은 **상세 화면**이 띄운다 — 폼은 저장에 성공하면 닫히기 때문이다", () => {
  assert.match(
    detailView,
    /const \[requestedDueDateNotLinked, setRequestedDueDateNotLinked\] = useState<string \| null>\(null\);/
  );
  assert.match(
    flat(detailView),
    /\{requestedDueDateNotLinked !== null && \( <NoticePopup title="내자 정리의 납기요청일은 바뀌지 않았습니다" lines=\{\[requestedDueDateNotLinked\]\} onClose=\{\(\) => setRequestedDueDateNotLinked\(null\)\}/
  );
  // 폼과 구역에는 대화상자가 없어야 한다 — 있으면 뜨자마자 함께 사라진다. 🔴 이름이
  // 아니라 **여는 꺾쇠**로 센다: 주석이 그 부품을 까닭으로 들 수 있어서, 글자만 세면
  // 설명을 적은 날 시험이 깨진다.
  assert.doesNotMatch(intakeForm, /<NoticePopup/, "편집 폼이 제 안에서 알림을 그린다");
  assert.doesNotMatch(intakeSection, /<NoticePopup/, "인수 정보 구역이 제 안에서 알림을 그린다");
});

test("🔴 같은 훅을 쓰는 다른 넷은 이 값을 넘기지 않는다 — 넘겨도 할 일이 없다", () => {
  // 고객 요청 납기일을 보내는 폼은 인수정보 하나뿐이다. 나머지 넷이 이 자리를 채우면
  // 「서버가 보내지도 않는 값을 기다리는 자리」가 넷 생기고, 그중 하나가 언젠가
  // 쓰이지 않는 상태 변수를 들고 다니게 된다.
  for (const name of [
    "ProductInfoEditForm.tsx",
    "FaultServiceEditForm.tsx",
    "EngineerEditCell.tsx",
    "ReportNumberEditCell.tsx",
  ]) {
    const source = read(`src/components/repair-cases/detail/edit/${name}`);
    assert.equal(
      source.includes("onRequestedDueDateNotLinked"),
      false,
      `${name} 이 묶기 알림을 받는다 — 이 구역은 고객 요청 납기일을 보내지 않는다`
    );
  }
  // 🔴 보고서번호 칸은 **같은 INTAKE 구역**인데도 아니다 — 보내는 칸이 하나뿐이라
  //    서버가 묶기 결과를 실을 일이 없다. 그 전제를 함께 못 박는다.
  const reportNumberCell = read("src/components/repair-cases/detail/edit/ReportNumberEditCell.tsx");
  assert.match(flat(reportNumberCell), /void submit\(\{ legacyReportNumber: [^}]*\}\);/);
});
