import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildEngineerSelectOptions, OFF_LIST_ENGINEER_PREFIX } from "./engineer-select-options";

/**
 * ============================================================================
 * 담당 엔지니어 드롭다운 — 목록 밖 담당자가 빈칸으로 보이지 않는다
 * ============================================================================
 * EngineerEditCell 은 저장 경로(useSectionEditSubmit → 서버 액션)를 부르므로 이 시험
 * 환경에서 그릴 수 없다. 선택지 만들기를 순수 함수로 떼어 값으로 보고, 칸이 그
 * 함수를 쓰는지는 원본을 읽어 확인한다.
 * ============================================================================
 */

const KIM = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", name: "김엔지" };
const LEE = { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", name: "이엔지" };
const GONE = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

test("지금 담당자가 후보 안에 있으면 후보 그대로 — 중복으로 더하지 않는다", () => {
  const options = buildEngineerSelectOptions([KIM, LEE], KIM.id, KIM.name);
  assert.deepEqual(options, [
    { id: KIM.id, label: "김엔지", isOffList: false },
    { id: LEE.id, label: "이엔지", isOffList: false },
  ]);
  // 대소문자만 다른 id 도 같은 사람이다.
  assert.equal(buildEngineerSelectOptions([KIM, LEE], KIM.id.toUpperCase(), KIM.name).length, 2);
});

test("🔴 지금 담당자가 후보 밖이면 그 사람을 선택지로 하나 더한다 — 라벨은 「(선택 목록에 없음)」", () => {
  const options = buildEngineerSelectOptions([KIM, LEE], GONE, "박옛담당");
  assert.equal(options.length, 3);
  assert.deepEqual(options[0], { id: GONE, label: "(선택 목록에 없음) 박옛담당", isOffList: true });
  assert.equal(OFF_LIST_ENGINEER_PREFIX, "(선택 목록에 없음)");
  // 이 칸은 삭제 여부를 모른다 — 「삭제」라고 단정하지 않는다.
  assert.ok(!options[0].label.includes("삭제"), options[0].label);
});

test("후보를 못 받았어도(referenceData 없음) 지금 담당자는 보인다 · 이름이 없으면 그렇다고", () => {
  assert.deepEqual(buildEngineerSelectOptions([], GONE, null), [
    { id: GONE, label: "(선택 목록에 없음) 이름을 알 수 없음", isOffList: true },
  ]);
});

test("담당자가 없으면 후보 그대로", () => {
  assert.deepEqual(buildEngineerSelectOptions([KIM], null, null), [{ id: KIM.id, label: "김엔지", isOffList: false }]);
});

test("🔴 칸이 이 함수로 선택지를 만든다 — 원본", () => {
  const source = readFileSync(
    join(process.cwd(), "src/components/repair-cases/detail/edit/EngineerEditCell.tsx"),
    "utf8"
  );
  assert.ok(/from "\.\/engineer-select-options"/.test(source), "선택지 함수를 부르지 않는다");
  assert.ok(
    /buildEngineerSelectOptions\(referenceData\?\.engineers \?\? \[\], assignedEngineerId, engineerName\)/.test(source),
    "지금 담당자와 표시 이름을 넘기지 않는다"
  );
  // 「미배정」 선택지는 그대로다.
  assert.ok(/<option value="">미배정<\/option>/.test(source), "미배정 선택지가 사라졌다");
});
