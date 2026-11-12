import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { baselineLeafLevel } from "./permission-baseline";
import { findPermissionFeature, isSettingsEnforced, selectableLevelsOfLeaf } from "./permission-features";
import { meetsPermissionLevel, type PermissionLevel } from "./permission-areas";
import {
  REPAIR_CASE_DETAIL_TAB_PERMISSIONS,
  isRepairCaseDetailTabOpen,
} from "./repair-case-detail-tab-permissions";
import { REQUEST_ELIGIBLE_ROLES } from "@/lib/domain/local/approval/transitions";
import { ROLE_CODES, type Role } from "@/lib/domain/types";

/**
 * ============================================================================
 * 수리 건 승인 **요청** 자격이 [역할별 접근 권한]으로 옮겨 왔다 (2026-11-12 셋째)
 * ============================================================================
 * 사용자 요구: 「[전체 A/S 현황 > 검수/승인]에 [읽기+쓰기], 즉 **승인 요청 가능한지
 * 여부**를 정할 수 있는 기능이 필요하지 않을까」.
 *
 * ── 옮기기 전의 실측 ────────────────────────────────────────────────────
 * 요청을 막던 자격 검사는 **하드코딩 역할 목록 하나**였고(SUPER_ADMIN · ADMIN ·
 * AS_ENGINEER), 같은 리터럴이 **네 곳**에 흩어져 있었다:
 *   · mutations/repair-case-approvals.ts   — 서버 관문
 *   · DatabaseRepairInspectionCard.tsx     — 검수 카드의 단추 노출
 *   · DatabaseFinalShipmentCard.tsx        — 출하 카드의 단추 노출
 *   · domain/local/approval/transitions.ts — local-demo(DB 모드가 아니다)
 * 그 사슬에 `hasPermission` 호출은 **0건**이었다.
 *
 * ── 옮긴 뒤 ─────────────────────────────────────────────────────────────
 * 앞의 **셋을 걷어내고** 전부 `repairCases.approval` **쓰기** 하나를 본다. 네 번째
 * (local-demo)는 DB 모드가 아니라 **일부러 그대로 둔다** — 이 파일이 그 하나만
 * 남았는지까지 센다.
 *
 * 🔴 이 파일이 못 박는 것:
 *  ① 다섯 역할의 「요청 가능 여부」가 **전과 같다** — 셋만 가능, 둘은 불가.
 *  ② 읽기만 가진 역할은 **탭은 보이고 요청 단추만 없다**(둘은 다른 문턱이다).
 *  ③ [접근 불가]면 탭도 요청도 둘 다 막힌다.
 *  ④ 하드코딩 리터럴이 서버·화면에서 **사라졌다** — local-demo 하나만 남는다.
 *  ⑤ 서버 관문과 화면이 **같은 열쇠**를 본다(갈리면 단추는 보이는데 눌리지 않는다).
 *  ⑥ 🔵 결재(승인·반려) 쪽은 **한 글자도 안 바뀌었다.**
 *  ⑦ 설명과 수준별 안내가 화면에서 **사실**을 말한다.
 *
 * 🔵 「서버가 실제로 거절하는가 / 설정을 넓히면 실제로 열리는가」는 값으로 잴 수 없어
 * mutations/repair-case-approvals.integration.test.ts 가 **진짜 DB 위에서** 잰다.
 * 여기서 재는 것은 **기본 정책**과 **코드의 모양**이다.
 * ============================================================================
 */

const APPROVAL_LEAF = "repairCases.approval";

const SERVER_MUTATION = "src/lib/db/mutations/repair-case-approvals.ts";
const APPROVAL_PAGE = "src/app/(app)/repair-cases/[id]/approval/page.tsx";
const APPROVAL_SCREEN = "src/components/repair-cases/approval/DatabaseApprovalScreen.tsx";
const INSPECTION_CARD = "src/components/repair-cases/approval/DatabaseRepairInspectionCard.tsx";
const SHIPMENT_CARD = "src/components/repair-cases/approval/DatabaseFinalShipmentCard.tsx";
const LOCAL_DEMO_TRANSITIONS = "src/lib/domain/local/approval/transitions.ts";
/** 저장소를 훑는 시험이 **자기 자신**을 세지 않게 — 아래 ④ 의 주석 참조. */
const SELF = "src/lib/auth/repair-case-approval-request-permission.test.ts";

const read = (relative: string) => readFileSync(join(process.cwd(), relative), "utf8").replace(/\r\n/g, "\n");

/**
 * 🔴 **주석을 먼저 걷어낸다.** 이 조각의 주석들은 걷어낸 이름(REQUEST_ELIGIBLE_ROLES)을
 * **일부러 글자로 적고 있다** — 무엇이 왜 사라졌는지를 다음 사람이 읽어야 하기 때문이다.
 * 날것으로 세면 「아직 남아 있다」가 되어, 멀쩡한 변경이 주석 때문에 ✗ 가 된다.
 */
const stripComments = (source: string) =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^[ \t]*\/\/[^\n]*$/gm, " ")
    .replace(/\/\/[^\n]*$/gm, " ");

/** 공백을 한 칸으로 눌러 「줄바꿈이 어디서 일어나든」 같은 글자로 읽는다. */
const flat = (source: string) => source.replace(/\s+/g, " ");

const code = (relative: string) => stripComments(read(relative));

function sliceBetween(source: string, start: string, end: string): string {
  const from = source.indexOf(start);
  assert.ok(from >= 0, `시험이 잡는 자리를 못 찾았다(시작): ${start}`);
  const to = source.indexOf(end, from + start.length);
  assert.ok(to > from, `시험이 잡는 자리를 못 찾았다(끝): ${end}`);
  return source.slice(from, to);
}

/** 적힌 잎만 그 수준이고 나머지는 접근 불가인 세계. */
function levels(map: Record<string, PermissionLevel>) {
  return (key: string): PermissionLevel => map[key] ?? "NONE";
}

describe("① 🔴 다섯 역할의 「요청 가능 여부」가 전과 같다", () => {
  test("표본 확인 — 역할 다섯을 실제로 훑고, 옛 목록이 아직 읽을 수 있는 자리에 있다", () => {
    assert.equal(ROLE_CODES.length, 5, "역할 수가 달라졌다 — 이 파일을 다시 잴 것");
    // 🔴 local-demo 의 목록이 **옮기기 전의 규칙이 남아 있는 유일한 기록**이다.
    //    그것을 건드리지 않기로 했으므로, 새 기본값을 저 목록과 맞대면 「전과 같다」가
    //    우리가 지금 적은 표가 아니라 **그날의 코드**와 맞대어진다.
    assert.deepEqual([...REQUEST_ELIGIBLE_ROLES].sort(), ["ADMIN", "AS_ENGINEER", "SUPER_ADMIN"]);
  });

  test("🔴 기본값의 쓰기 = 2026-11-12 이전에 요청할 수 있던 바로 그 셋", () => {
    const withWrite = ROLE_CODES.filter((role) =>
      meetsPermissionLevel(baselineLeafLevel(APPROVAL_LEAF, role), "WRITE")
    );
    assert.deepEqual(
      [...withWrite].sort(),
      [...REQUEST_ELIGIBLE_ROLES].sort(),
      "요청할 수 있는 사람이 달라졌다 — 설정을 만지지 않은 상태는 종전 동작이어야 한다"
    );
  });

  test("🔴 역할별로 하나씩 — 셋은 올릴 수 있고 둘은 못 올린다", () => {
    const EXPECTED: Record<Role, boolean> = {
      SUPER_ADMIN: true,
      ADMIN: true,
      AS_ENGINEER: true,
      SALES: false,
      INVENTORY_MANAGER: false,
    };
    assert.equal(Object.values(EXPECTED).filter(Boolean).length, 3, "표본이 한쪽으로 쏠렸다");
    for (const role of ROLE_CODES) {
      const level = baselineLeafLevel(APPROVAL_LEAF, role);
      assert.equal(
        meetsPermissionLevel(level, "WRITE"),
        EXPECTED[role],
        `${role}: 요청 가능 여부가 달라졌다 (지금 ${level})`
      );
    }
  });
});

describe("② 🔴 읽기만 가진 역할 — 탭은 보이고 요청 단추만 없다", () => {
  test("기본 정책에서 영업·자재 담당자는 탭을 보되 올리지는 못한다", () => {
    for (const role of ["SALES", "INVENTORY_MANAGER"] as const) {
      const levelOf = (key: string) => baselineLeafLevel(key, role);
      assert.equal(
        isRepairCaseDetailTabOpen("approval", levelOf),
        true,
        `${role}: [검수/승인] 탭을 잃었다 — 결재 알림 종이 가리키는 화면이다`
      );
      assert.equal(
        meetsPermissionLevel(levelOf(APPROVAL_LEAF), "WRITE"),
        false,
        `${role}: 요청이 열렸다 — 이 조각은 아무에게도 권한을 더 주지 않는다`
      );
    }
  });

  test("🔴 설정으로 읽기만 준 역할도 같다 — 탭 문턱은 읽기 그대로다", () => {
    const readOnly = levels({ [APPROVAL_LEAF]: "READ" });
    assert.equal(isRepairCaseDetailTabOpen("approval", readOnly), true);
    assert.equal(meetsPermissionLevel(readOnly(APPROVAL_LEAF), "WRITE"), false);
    // 표가 묻는 수준이 쓰기로 올라가 있으면 위 첫 줄이 거짓이 된다 — 그때 요청을 못 하는
    // 사람이 탭을 통째로 잃는다. 값으로 한 번 더 못 박는다.
    assert.deepEqual(REPAIR_CASE_DETAIL_TAB_PERMISSIONS.approval, {
      anyOf: [{ key: APPROVAL_LEAF, level: "READ" }],
    });
  });

  test("🔴 화면: 요청 단추는 `canRequestApproval` 안쪽에만 있다", () => {
    for (const [name, relative] of [
      ["검수 카드", INSPECTION_CARD],
      ["출하 카드", SHIPMENT_CARD],
    ] as const) {
      const source = flat(code(relative));
      // 표본이 비어서 공짜로 통과하지 않게 — 단추를 미는 자리가 정말 있다.
      assert.ok(source.includes('key: "request"'), `${name}: 요청 단추를 미는 자리가 없다`);
      const gate = source.indexOf("canRequestApproval) {");
      const button = source.indexOf('key: "request"');
      assert.ok(gate >= 0, `${name}: 서버가 내려준 값으로 가르지 않는다`);
      assert.ok(gate < button, `${name}: 요청 단추가 자격 갈래 **밖**에 있다`);
    }
  });
});

describe("③ 🔴 [접근 불가]면 탭도 요청도 둘 다 막힌다", () => {
  test("아무 수준도 없는 세계에서는 탭이 숨고 요청도 닫힌다", () => {
    const none = levels({});
    assert.equal(isRepairCaseDetailTabOpen("approval", none), false, "탭이 그대로 보인다");
    assert.equal(meetsPermissionLevel(none(APPROVAL_LEAF), "WRITE"), false);
    const explicitNone = levels({ [APPROVAL_LEAF]: "NONE" });
    assert.equal(isRepairCaseDetailTabOpen("approval", explicitNone), false);
    assert.equal(meetsPermissionLevel(explicitNone(APPROVAL_LEAF), "WRITE"), false);
  });

  test("🔵 거꾸로 — 쓰기를 주면 탭도 함께 열린다(사다리라 당연하지만 값으로 적어 둔다)", () => {
    const write = levels({ [APPROVAL_LEAF]: "WRITE" });
    assert.equal(isRepairCaseDetailTabOpen("approval", write), true);
    assert.equal(meetsPermissionLevel(write(APPROVAL_LEAF), "WRITE"), true);
  });
});

describe("④ 🔴 하드코딩 역할 목록이 서버·화면에서 사라졌다", () => {
  test("세 자리에서 **이름 자체가** 사라졌다 — 주석은 걷어내고 센다", () => {
    for (const [name, relative] of [
      ["서버 관문", SERVER_MUTATION],
      ["검수 카드", INSPECTION_CARD],
      ["출하 카드", SHIPMENT_CARD],
    ] as const) {
      const source = code(relative);
      // 표본 확인 — 파일을 제대로 읽었는가(빈 글자로 공짜 통과를 막는다).
      assert.ok(source.length > 500, `${name}: 소스를 못 읽었다`);
      assert.equal(
        /\bREQUEST_ELIGIBLE_ROLES\b/.test(source),
        false,
        `${name}: 요청 자격 역할 목록이 아직 코드에 있다 — 문턱이 둘이 된다`
      );
    }
  });

  test("🔴 저장소 전체에서 그 목록을 **선언하는** 파일은 local-demo 하나뿐이다", () => {
    const declarations: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(join(process.cwd(), dir), { withFileTypes: true })) {
        const relative = `${dir}/${entry.name}`;
        if (entry.isDirectory()) {
          walk(relative);
          continue;
        }
        if (!/\.(ts|tsx)$/.test(entry.name)) continue;
        // 🔴 **이 파일 자신은 뺀다.** 바로 아래 정규식이 그 이름을 글자로 품고 있어서
        //    제가 제 패턴에 걸린다 — 주석을 걷어내도 코드에 남는 글자라 못 피한다.
        if (relative === SELF) continue;
        if (/\bconst REQUEST_ELIGIBLE_ROLES\b/.test(stripComments(read(relative)))) {
          declarations.push(relative);
        }
      }
    };
    walk("src");
    assert.deepEqual(
      declarations,
      [LOCAL_DEMO_TRANSITIONS],
      "요청 자격 목록을 선언한 자리가 local-demo 말고 또 있다(또는 local-demo 쪽이 사라졌다)"
    );
  });

  test("🔵 local-demo 쪽은 **일부러 남겼다** — DB 모드가 아니다", () => {
    const source = code(LOCAL_DEMO_TRANSITIONS);
    assert.match(source, /const REQUEST_ELIGIBLE_ROLES/, "local-demo 의 목록까지 걷어냈다");
    assert.equal(
      /hasPermission/.test(source),
      false,
      "local-demo 가 설정을 보게 됐다 — 그쪽은 DB 없이 도는 데모 층이다"
    );
  });
});

describe("⑤ 🔴 서버 관문과 화면이 같은 열쇠를 본다", () => {
  const KEY_AND_LEVEL = '"repairCases.approval", "WRITE"';

  test("서버: 요청 함수의 자격 검사가 `hasPermission` 한 줄이다", () => {
    const requestFn = flat(
      sliceBetween(
        code(SERVER_MUTATION),
        "export async function requestRepairCaseApproval",
        "export async function decideRepairCaseApproval"
      )
    );
    assert.ok(
      requestFn.includes(`hasPermission(actor, ${KEY_AND_LEVEL})`),
      "요청 관문이 `repairCases.approval` 쓰기를 보지 않는다"
    );
    // 🔴 **문턱이 둘이 되지 않았는가** — 역할 목록을 AND 로 남겨 두면 설정을 넓혀도
    //    열리지 않고, 그때 권한 설정 화면이 「넓히면 열립니다」라고 거짓말을 한다.
    assert.equal(
      requestFn.includes("actorHasAllowedRole(actor,"),
      false,
      "요청자 자격을 역할 목록으로 한 번 더 본다 — 문턱이 둘이다"
    );
    // 🔵 계정 승인 상태는 그대로 앞에 남아 있어야 한다(권한 수준이 말하지 못하는 물음).
    assert.ok(
      requestFn.includes('actor.approvalStatus !== "APPROVED"'),
      "계정 승인 상태 검사가 사라졌다 — 설정은 그 물음에 답하지 않는다"
    );
  });

  test("화면: 서버(page.tsx)가 구해 두 카드에 똑같이 내려준다", () => {
    const page = flat(code(APPROVAL_PAGE));
    assert.ok(
      page.includes(`hasPermission(actingUser, ${KEY_AND_LEVEL})`),
      "페이지가 서버 관문과 다른 열쇠(또는 다른 수준)를 본다"
    );
    assert.ok(page.includes("canRequestApproval={canRequestApproval}"), "화면으로 내려주지 않는다");

    const screen = flat(code(APPROVAL_SCREEN));
    const handed = screen.match(/canRequestApproval=\{canRequestApproval\}/g) ?? [];
    assert.equal(handed.length, 2, "두 카드 **모두** 에게 넘기지 않는다(검수·출하)");
  });

  test("🔴 탭에 들어오는 문턱은 **따로 서 있다** — 페이지가 둘을 한 관문으로 합치지 않았다", () => {
    const page = flat(code(APPROVAL_PAGE));
    assert.ok(
      page.includes('canOpenRepairCaseDetailTab(actingUser, "approval")'),
      "탭 관문이 사라졌다 — 주소를 직접 치면 들어와진다"
    );
    // 🔴 들어오는 관문이 **먼저**다. 요청 자격을 구하는 자리보다 뒤로 가면, 막아야 할
    //    사람에게 화면을 다 그려 놓고 돌려보내는 꼴이 된다.
    assert.ok(
      page.indexOf("canOpenRepairCaseDetailTab") < page.indexOf("hasPermission(actingUser"),
      "요청 자격을 탭 관문보다 먼저 구한다"
    );
  });
});

describe("⑥ 🔵 결재(승인·반려) 쪽은 한 글자도 안 바뀌었다", () => {
  test("검수 결재 자격은 여전히 역할 목록이고, 설정을 보지 않는다", () => {
    const source = flat(code(SERVER_MUTATION));
    // 결재 함수는 이 파일의 **마지막**이라 끝 표시가 없다 — 머리부터 끝까지가 그 몸이다.
    const decideFn = source.slice(source.indexOf("export async function decideRepairCaseApproval"));
    assert.ok(decideFn.length > 0, "표본이 비었다 — 결재 함수를 못 잘랐다");
    assert.equal(
      decideFn.includes("hasPermission("),
      false,
      "결재 자격까지 설정으로 옮겼다 — 이 조각은 결재권을 건드리지 않는다"
    );
    assert.ok(
      source.includes('export const INSPECTION_DECIDE_ELIGIBLE_ROLES = ["SUPER_ADMIN", "ADMIN", "AS_ENGINEER"] as const;'),
      "검수 결재 자격 목록이 바뀌었다 — 이 조각은 결재권을 건드리지 않는다"
    );
    assert.ok(
      source.includes("actorHasAllowedRole(actor, INSPECTION_DECIDE_ELIGIBLE_ROLES)"),
      "검수 결재 관문이 그 목록을 보지 않는다"
    );
  });

  test("화면: 검수 카드의 결재 자격도 그대로, 출하 카드는 결재선·위임 그대로", () => {
    const inspection = flat(code(INSPECTION_CARD));
    assert.ok(
      inspection.includes('const DECIDE_ELIGIBLE_ROLES = ["SUPER_ADMIN", "ADMIN", "AS_ENGINEER"] as const;'),
      "검수 카드의 결재 자격 목록이 바뀌었다"
    );
    assert.ok(
      inspection.includes("actorHasAllowedRole(actingUser, DECIDE_ELIGIBLE_ROLES)"),
      "검수 카드가 결재 자격을 다른 방식으로 판정한다"
    );

    const shipment = flat(code(SHIPMENT_CARD));
    for (const anchor of [
      "decideAuthorization.allowed",
      "mayDecideAssignedApproval(",
      "actingApproverUserIds",
    ]) {
      assert.ok(shipment.includes(anchor), `출하 카드의 결재 판정이 달라졌다: ${anchor}`);
    }
    // 🔴 요청 자격이 결재 갈래로 새지 않았는가 — 두 카드 모두 결재 단추는
    //    `canRequestApproval` 과 아무 상관이 없어야 한다.
    const decideBranch = sliceBetween(shipment, 'displayStatus === "REQUESTED"', 'displayStatus === "APPROVED"');
    assert.equal(
      decideBranch.includes("canRequestApproval"),
      false,
      "결재 갈래가 요청 자격을 본다 — 요청 권한으로 결재가 열린다"
    );
  });
});

describe("⑦ 🔴 설명과 수준별 안내가 화면에서 사실을 말한다", () => {
  const feature = findPermissionFeature(APPROVAL_LEAF);

  test("고를 수 있는 칸이 셋이고, 설정이 최종 판정이다", () => {
    assert.ok(feature, "잎을 못 찾았다");
    assert.equal(feature.maxMeaningfulLevel, "WRITE");
    assert.deepEqual(selectableLevelsOfLeaf(APPROVAL_LEAF), ["NONE", "READ", "WRITE"]);
    assert.equal(isSettingsEnforced(APPROVAL_LEAF), true);
  });

  test("🔴 설명이 **살려야 할 두 가지**를 그대로 말한다 — 결재권이 아니다 · 종 링크", () => {
    assert.ok(feature, "잎을 못 찾았다");
    const description = feature.description;
    assert.ok(description.includes("결재권"), "「결재권이 아니다」가 설명에서 사라졌다");
    assert.ok(description.includes("종"), "결재 알림 종 이야기가 사라졌다 — 읽기를 닫는 사람이 못 본다");
    assert.ok(description.includes("탭"), "어느 탭인지 말하지 않는다");
    assert.ok(description.includes("올릴"), "읽기+쓰기가 무엇인지 말하지 않는다");
  });

  test("🔴 수준별 안내가 읽기 = 탭 보기 · 읽기+쓰기 = 요청 올리기를 말한다", () => {
    const hints = feature?.levelHints;
    assert.ok(hints, "수준별 안내가 없다 — 고를 것이 둘인데 설명이 없다");
    assert.ok(hints.READ?.includes("탭"), `읽기 안내가 탭 보기를 말하지 않는다: ${hints.READ}`);
    assert.ok(hints.WRITE?.includes("올립니다"), `쓰기 안내가 요청을 말하지 않는다: ${hints.WRITE}`);
    assert.ok(
      hints.WRITE?.includes("결재"),
      "쓰기 안내가 「결재권은 아니다」를 말하지 않는다 — 가장 오해하기 쉬운 자리다"
    );
    assert.notEqual(hints.READ, hints.WRITE);
  });

  test("🔵 기타건과 **비대칭인 까닭**이 코드에 적혀 있다", () => {
    // 🔴 값이 아니라 **글**을 센다. 다음 사람이 「왜 수리 건만 approval 이고 기타건은
    //    edit 이지」에서 멈추지 않게 하려는 것이고, 그 설명이 사라지면 이 시험이 터진다.
    // 🔴 **수리 건 쪽 잎의 주석만** 잘라 본다. 기타건에도 `approval` 잎이 있어서(그쪽은
    //    파일 뒤쪽이다) 넓게 자르면 저쪽 글을 읽고 공짜로 통과한다.
    const features = read("src/lib/auth/permission-features.ts");
    const leafRegion = sliceBetween(features, "    approval: {", '      label: "검수/승인",');
    assert.ok(leafRegion.includes("domesticOrders.edit"), "기타건 쪽 문턱을 적어 두지 않았다");
    assert.ok(
      leafRegion.includes("EDITABLE_FIELDS_BY_ROLE"),
      "`repairCases.edit` 를 쓸 수 없었던 까닭을 적어 두지 않았다"
    );
  });
});
