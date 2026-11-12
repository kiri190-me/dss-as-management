import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import { baselineLeafLevel } from "./permission-baseline";
import { PERMISSION_AREAS } from "./permission-areas";
import {
  PERMISSION_LEAF_KEYS,
  areaLevelFromLeaves,
  featuresOfArea,
  findPermissionFeature,
  fixedNoticeOf,
  isSettingsEnforced,
  levelHintOfLeaf,
  selectableLevelsOfLeaf,
} from "./permission-features";
import {
  canEditSection,
  editableFieldsForRoleInSection,
  isFieldEditable,
} from "./repair-case-edit-authorization";
import { SECTION_FIELD_NAMES } from "@/lib/validation/repair-case-update-input";
import { ROLE_CODES } from "@/lib/domain/types";

/**
 * ============================================================================
 * 역할별 접근 권한 화면이 **사실대로 말하는가** (2026-11-12, 같은 날 넷째)
 * ============================================================================
 * 사용자 요구: 「어떤 것을 수정할 수 있는 권한인지에 대해 명확한 설명이 필요할 것
 * 같아」 → 「B 로 진행하고, 기타건 현황의 문구도 함께 고치자」.
 *
 * 고친 것이 셋이고, 셋 다 **화면에 나가는 글**이다. 코드의 동작이 아니라 글이
 * 바뀌는 조각이라 시험이 없으면 조용히 되돌아간다:
 *
 *  ① 🔴 `repairCases.edit`(접수 건 수정)을 **고정**으로 잠갔다. 그 칸은 양방향 다
 *     장식이었다 — 저장 경로가 보는 것은 EDITABLE_FIELDS_BY_ROLE 하드코딩 표이고
 *     `hasPermission(…, "repairCases.edit", …)` 호출은 **저장소에 0건**이다.
 *     넓혀도 안 열리고 **좁혀도 안 막힌다.**
 *  ② 🔴 '고정' 안내 문구를 **까닭별로 갈랐다.** 그전에는 한 문장이 모든 고정 칸에
 *     공통으로 붙었는데, 그 문장(「되돌릴 사람이 아무도 남지 않습니다」)은
 *     `users.rolePermissions` 의 까닭이라 ①에 붙으면 **사실이 아니다.**
 *  ③ 🔴 `miscCases`(기타건 현황)를 SETTINGS_ENFORCED_LEAVES 에 넣었다. 빠져 있는
 *     동안 화면이 「넓혀도 실제로는 열리지 않을 수 있습니다」라는 **거짓 경고**를
 *     띄우고 있었다.
 *
 * 🔵 **글을 값으로 잰다.** 설명과 안내 문구는 permission-features.ts 가 들고 있는
 * **문자열 값**이라, 주석에 같은 낱말이 아무리 많아도 이 셈을 흔들지 못한다(원본을
 * 글자로 읽는 시험이었다면 주석을 먼저 걷어내야 했을 자리다 — 이 저장소에서 실제로
 * 겪은 함정이다). 원본을 글자로 읽는 절은 ⑤·⑥ 둘뿐이고, 거기서는 주석을 걷어낸다.
 *
 * 🔴 **설명이 코드의 표와 어긋나면 안 된다**(④). 화면의 글이 틀리는 쪽이 아무 글도
 * 없는 쪽보다 나쁘다 — 읽은 사람이 그 글을 믿고 권한을 정하기 때문이다. 그래서
 * 설명에 적힌 역할별 규칙을 EDITABLE_FIELDS_BY_ROLE 에 하나씩 맞대어 본다.
 * ============================================================================
 */

const EDIT_LEAF = "repairCases.edit";
const ROLE_PERMISSIONS_LEAF = "users.rolePermissions";

/** 2026-11-12 이전부터 모든 고정 칸에 붙던 그 한 문장. 한 글자도 바뀌면 안 된다. */
const LOCKOUT_NOTICE =
  "이 기능은 설정으로 여닫을 수 없습니다. 여기를 잠글 수 있게 하면, 잘못 저장한 순간 권한을 되돌릴 사람이 아무도 남지 않습니다.";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));

function read(relativePath: string): string {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8").replace(/\r\n/g, "\n");
}

/**
 * 🔴 주석을 걷어낸다 — 이 저장소의 파일들은 「왜 그렇게 했는가」를 길게 적고 그 글에
 * 키와 함수 이름이 그대로 들어 있다. 걷어내지 않으면 「이 키를 아무도 안 쓴다」가
 * **주석 때문에** 거짓으로 뒤집힌다.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^[ \t]*\/\/[^\n]*$/gm, " ")
    .replace(/\/\/[^\n]*$/gm, " ");
}

/** src/ 아래의 **시험이 아닌** 원본 전부. 판정 경로를 세는 절이 쓴다. */
function productionSources(): string[] {
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
        found.push(path.relative(ROOT, full).split(path.sep).join("/"));
      }
    }
  };
  walk(path.join(ROOT, "src"));
  return found;
}

const descriptionOf = (leafKey: string): string => {
  const description = findPermissionFeature(leafKey)?.description;
  assert.ok(description, `${leafKey}: 설명이 없다 — 화면에 빈 칸이 나간다`);
  return description;
};

describe("① 🔴 「접수 건 수정」은 고정이다 — 만질 수 있는데 아무 효과가 없던 칸", () => {
  test("표본이 비어 있지 않다 — 잎이 실재하고 선택지는 전과 같다", () => {
    assert.ok(findPermissionFeature(EDIT_LEAF), `${EDIT_LEAF} 가 트리에서 사라졌다`);
    // 🔴 선택지를 건드리지 않았다. 고정은 **고를 수 없게** 하는 것이지 칸을 지우는
    // 일이 아니다 — 지우면 화면의 「기본 정책」 칸이 빈 칸으로 뜬다.
    assert.deepEqual(selectableLevelsOfLeaf(EDIT_LEAF), ["NONE", "WRITE"]);
  });

  test("🔴 고정이다", () => {
    assert.ok(findPermissionFeature(EDIT_LEAF)?.fixed, "고정이 풀렸다 — 라디오가 다시 살아난다");
  });

  test("🔴 화면의 라디오가 고정 칸에서 비활성이다", () => {
    const screen = stripComments(read("src/components/users/RolePermissionSettings.tsx"));
    // 🔵 먼저 무엇을 재는지 못 박는다 — 라디오가 없으면 아래 비교가 공짜로 통과한다.
    assert.equal(screen.split('type="radio"').length - 1, 1, "라디오 입력이 하나가 아니다");
    assert.match(
      screen,
      /disabled=\{disabled \|\| isFixed \|\| !editableRole \|\| blocked\}/,
      "고정 칸의 라디오가 살아 있다 — 고를 수 있는데 저장은 건너뛴다"
    );
  });

  test("🔴 저장이 고정 칸을 건너뛴다 — 화면만 잠그면 액션으로 저장된다", () => {
    const mutation = stripComments(read("src/lib/db/mutations/role-permissions.ts"));
    assert.match(
      mutation,
      /if \(findPermissionFeature\(leafKey\)\?\.fixed\) continue;/,
      "서버가 고정 칸을 그대로 저장한다"
    );
  });

  test("🔴 '하위 기능 전부 닫기'가 고정 칸을 건너뛴다는 사실이 그 자리에 적혀 있다", () => {
    /**
     * 그 단추는 **처음부터** 고정 칸을 건너뛰었다(applyToArea). 고정이 '사용자 관리'
     * 아래 하나뿐일 때는 드러날 일이 없었는데, 이제 '전체 A/S 현황'에서 전부 닫기를
     * 눌러도 접수 건 수정이 기본값으로 남아 **메뉴가 접근 불가로 안 내려간다.**
     * 까닭이 화면에 없으면 단추가 고장 난 것으로 보인다.
     */
    const screen = stripComments(read("src/components/users/RolePermissionSettings.tsx"));
    assert.ok(screen.includes("findPermissionFeature(feature.key)?.fixed) continue"), screen);
    assert.ok(screen.includes("고정 항목과 최고관리자 줄은 바뀌지 않습니다."), screen);
  });

  test("🔴 levelHints 를 두지 않는다 — 고정 칸에서는 화면이 그것을 안 그린다", () => {
    // 적어 두면 **누구에게도 안 보이는 글**이 되고, 그 글이 아래 설명과 반대말이면
    // (전에 적혀 있던 「내용을 고칠 수 있습니다」가 그랬다) 나중에 읽은 사람이
    // 그것을 근거로 고친다.
    const screen = stripComments(read("src/components/users/RolePermissionSettings.tsx"));
    assert.ok(screen.includes("{!isFixed &&"), "화면이 고정 칸에서도 수준별 설명을 그린다");
    assert.equal(levelHintOfLeaf(EDIT_LEAF, "WRITE"), undefined);
  });
});

describe("② 🔴 '고정' 안내가 까닭별로 갈린다", () => {
  test("`users.rolePermissions` 의 안내는 **전과 한 글자도 다르지 않다**", () => {
    assert.equal(fixedNoticeOf(ROLE_PERMISSIONS_LEAF), LOCKOUT_NOTICE);
  });

  test("🔴 `repairCases.edit` 의 안내는 **제 까닭**이다 — 되돌릴 사람 이야기가 아니다", () => {
    const notice = fixedNoticeOf(EDIT_LEAF);
    assert.ok(notice, "고정인데 안내가 없다 — 잠긴 까닭을 화면 어디에서도 알 수 없다");
    assert.notEqual(notice, LOCKOUT_NOTICE, "남의 까닭이 붙어 있다");
    assert.ok(
      !notice.includes("되돌릴 사람"),
      `권한 설정 화면의 까닭이 섞여 있다: ${notice}`
    );
    // 제 까닭 — 「역할마다 칸이 달라 두 단으로 접히지 않는다」.
    assert.ok(notice.includes("역할마다"), notice);
    assert.ok(notice.includes("접히지 않아서"), notice);
  });

  test("고정이 아닌 칸에는 안내가 없다", () => {
    // 🔵 표본 확인 — 모든 칸에 안내가 붙는다면 ②가 통째로 공짜 통과다.
    assert.equal(fixedNoticeOf("repairCases.view"), undefined);
    assert.equal(fixedNoticeOf("miscCases"), undefined);
  });

  test("🔴 문구는 잎이 들고, 화면은 그리기만 한다", () => {
    // 화면에 문장을 박아 두면 고정 칸이 늘어날 때마다 한 문장이 전부를 덮는다 —
    // 2026-11-12 까지가 그 상태였다.
    const screen = stripComments(read("src/components/users/RolePermissionSettings.tsx"));
    assert.ok(screen.includes("fixedNoticeOf(leafKey)"), "화면이 잎의 문구를 안 읽는다");
    assert.ok(
      !screen.includes("되돌릴 사람이 아무도 남지 않습니다"),
      "화면에 공통 문장이 다시 박혔다"
    );
  });
});

describe("③ 🔴 설명에 셋이 다 들어 있다 — 안 여닫는다 · 왜 · 역할별 실제", () => {
  test("표본이 비어 있지 않다 — 한 문단짜리 설명이다", () => {
    assert.ok(descriptionOf(EDIT_LEAF).length > 300, "설명이 한 문단에 못 미친다");
  });

  test("🔴 ⓐ 「지금 아무것도 여닫지 않는다」 — **양방향 다** 적혀 있다", () => {
    const description = descriptionOf(EDIT_LEAF);
    assert.ok(description.includes("아무것도 여닫지 않습니다"), description);
    // 🔴 「넓혀도 안 열린다」만 적으면 **좁히면 막히는 줄 알고** 닫아 둔다.
    assert.ok(description.includes("넓혀도 열리지 않고"), description);
    assert.ok(description.includes("좁혀도 막히지 않습니다"), description);
  });

  test("🔴 ⓑ 왜 그런가 — 두 단으로 접히지 않는다는 말이 있다", () => {
    const description = descriptionOf(EDIT_LEAF);
    assert.ok(description.includes("역할마다 고칠 수 있는 칸이 서로 달라서"), description);
    assert.ok(description.includes("두 단으로 접히지 않습니다"), description);
  });

  test("🔴 ⓒ 역할 다섯이 **하나도 빠짐없이** 나온다", () => {
    const description = descriptionOf(EDIT_LEAF);
    // 🔵 이름표는 화면에서 바뀔 수 있는 값이지만(ui_text_overrides), 이 글은 기본
    // 이름표를 쓴다 — 다섯이 다 언급되는지만 본다. 하나가 빠지면 그 역할 사람은
    // 「나는 무엇을 고칠 수 있나」를 화면 어디에서도 못 읽는다.
    for (const label of ["최고관리자", "관리자", "A/S 엔지니어", "영업 담당자", "재고 담당자"]) {
      assert.ok(description.includes(label), `${label} 이야기가 설명에 없다`);
    }
    assert.equal(ROLE_CODES.length, 5, "역할 수가 달라졌다 — 설명을 다시 쓸 것");
  });

  test("🔴 ⓓ 눈에 띄는 셋이 적혀 있다 — 단추가 아예 안 뜨는 둘과 관리자 전용 하나", () => {
    const description = descriptionOf(EDIT_LEAF);
    // 영업 담당자: 제품 정보 카드에 [수정] 단추 자체가 없다.
    assert.ok(description.includes("제품 정보는 [수정] 단추 자체가 뜨지 않습니다"), description);
    // 재고 담당자: 세 카드 모두 없다(읽기 전용).
    assert.ok(description.includes("세 카드 모두 [수정] 단추가 없습니다"), description);
    // 새 제품모델명: 최고관리자·관리자만.
    assert.ok(description.includes("「새 모델로 등록」"), description);
  });
});

describe("④ 🔴 그 설명이 코드의 표와 어긋나지 않는가", () => {
  /**
   * 설명은 EDITABLE_FIELDS_BY_ROLE 을 사람 말로 옮긴 것이다. 표가 바뀌는 날 글만
   * 남으면 화면이 거짓을 말하게 되고, 그 거짓은 **아무도 신고하지 않는다**(권한을
   * 정하는 사람은 코드를 읽지 않는다). 그래서 글의 주장 하나하나를 표에 맞댄다.
   */
  test("표본이 비어 있지 않다 — 구간 셋의 칸 수", () => {
    assert.equal(SECTION_FIELD_NAMES.INTAKE.length, 15);
    assert.equal(SECTION_FIELD_NAMES.PRODUCT.length, 8);
    assert.equal(SECTION_FIELD_NAMES.FAULT_SERVICE.length, 3);
  });

  test("최고관리자·관리자는 세 카드의 **모든** 칸을 고친다", () => {
    for (const role of ["SUPER_ADMIN", "ADMIN"] as const) {
      for (const section of ["INTAKE", "PRODUCT", "FAULT_SERVICE"] as const) {
        assert.deepEqual(
          editableFieldsForRoleInSection(role, section),
          [...SECTION_FIELD_NAMES[section]],
          `${role} / ${section}: 설명은 「모든 칸」이라고 적었다`
        );
      }
    }
  });

  test("A/S 엔지니어는 담당자 연락처 셋과 「새 모델로 등록」만 못 고친다", () => {
    const blocked = ["contactName", "contactPhone", "contactEmail", "newProductModelName"];
    for (const field of blocked) {
      assert.equal(isFieldEditable("AS_ENGINEER", field), false, `${field}: 열려 있다`);
    }
    // 🔴 「만 빼고 전부」가 참인지 반대쪽으로도 본다 — 막힌 칸이 더 늘면 설명이 거짓이 된다.
    const allFields = [
      ...SECTION_FIELD_NAMES.INTAKE,
      ...SECTION_FIELD_NAMES.PRODUCT,
      ...SECTION_FIELD_NAMES.FAULT_SERVICE,
    ];
    const actuallyBlocked = allFields.filter((field) => !isFieldEditable("AS_ENGINEER", field));
    assert.deepEqual(
      [...actuallyBlocked].sort(),
      [...blocked].sort(),
      "A/S 엔지니어가 못 고치는 칸이 설명과 다르다"
    );
  });

  test("영업 담당자 — 인수 정보의 여섯 칸 · 고장 및 서비스는 비고뿐 · 제품 정보는 단추 없음", () => {
    for (const field of [
      "billingType",
      "priority",
      "internalTargetInspectionCompletionDate",
      "internalTargetShipmentDate",
      "actualShipmentDate",
      "legacyReportNumber",
    ]) {
      assert.equal(isFieldEditable("SALES", field), false, `${field}: 영업에게 열려 있다`);
    }
    assert.deepEqual(editableFieldsForRoleInSection("SALES", "FAULT_SERVICE"), ["notes"]);
    assert.equal(canEditSection("SALES", "PRODUCT"), false, "제품 정보에 [수정] 단추가 뜬다");
    // 인수 정보는 **여전히 열려 있다** — 설명이 「고칠 수 없는 여섯」만 꼽았으므로,
    // 구간째 닫히면 그 글이 거짓이 된다.
    assert.equal(canEditSection("SALES", "INTAKE"), true);
  });

  test("재고 담당자는 세 카드 모두 읽기 전용이다", () => {
    for (const section of ["INTAKE", "PRODUCT", "FAULT_SERVICE"] as const) {
      assert.equal(
        canEditSection("INVENTORY_MANAGER", section),
        false,
        `${section}: 재고 담당자에게 [수정] 단추가 뜬다`
      );
    }
  });
});

describe("⑤ 🔴 그 칸은 지금도 아무것도 여닫지 않는다", () => {
  test("`repairCases.edit` 을 관문으로 읽는 원본이 하나도 없다", () => {
    /**
     * 🔴 이 절이 깨지는 날은 **좋은 날**이다 — 누군가 이 키를 실제 관문으로 쓰기
     * 시작했다는 뜻이고, 그러면 위 설명(「아무것도 여닫지 않습니다」)과 고정을 함께
     * 풀어야 한다. 조용히 어긋나지 않게 여기서 잡는다.
     *
     * 🔵 한계: 키를 변수에 담아 넘기면 이 셈이 못 본다. 그 대신 키 글자가 들어간
     * 원본을 **한 곳(기본 정책 표)만** 허용해 범위를 좁힌다.
     */
    const users = productionSources().filter((file) =>
      stripComments(read(file)).includes(`"${EDIT_LEAF}"`)
    );
    assert.deepEqual(
      users,
      ["src/lib/auth/permission-baseline.ts"],
      "기본 정책 표 말고 이 키를 읽는 원본이 생겼다"
    );
  });
});

describe("⑥ 🔴 기타건 현황 — 거짓 경고가 사라졌다", () => {
  test("설정이 최종 판정이라고 화면이 말한다", () => {
    assert.equal(isSettingsEnforced("miscCases"), true);
  });

  test("🔴 관문은 그 한 줄뿐이고, 그 줄은 설정만 본다", () => {
    const page = stripComments(read("src/app/(app)/misc-cases/page.tsx"));
    assert.equal(
      page.split("requireAreaAccessForCurrentUser(").length - 1,
      1,
      "가드가 하나가 아니다"
    );
    assert.ok(page.includes('requireAreaAccessForCurrentUser("miscCases")'), page);
    // 역할 함수와 AND 로 묶인 자리가 없다 — 있으면 「넓히면 열립니다」가 거짓이 된다.
    assert.ok(!page.includes("canViewDomesticOrders"), "역할 함수가 관문에 섞여 있다");
  });

  test("🔴 이 목록에 넣는 것은 **화면의 말만** 바꾼다 — 판정 경로는 안 본다", () => {
    /**
     * 지시서가 물은 것이 이것이다. `isSettingsEnforced` 를 부르는 원본이 권한 설정
     * 화면 한 곳뿐이면, 이 집합은 **문구를 고르는 값**이지 권한을 정하는 값이 아니다.
     * 판정은 permission-resolver 가 저장된 값과 기본 정책으로만 한다.
     */
    const callers = productionSources().filter((file) =>
      stripComments(read(file)).includes("isSettingsEnforced(")
    );
    assert.deepEqual(callers, [
      "src/components/users/RolePermissionSettings.tsx",
      "src/lib/auth/permission-features.ts",
    ]);
    const resolver = stripComments(read("src/lib/auth/permission-resolver.ts"));
    assert.ok(!resolver.includes("isSettingsEnforced"), "판정 경로가 이 집합을 본다");
  });

  test("🔴 기본값은 한 칸도 안 바뀌었다 — 내자 정리를 보는 사람이 그대로 본다", () => {
    for (const role of ROLE_CODES) {
      assert.equal(
        baselineLeafLevel("miscCases", role),
        baselineLeafLevel("domesticOrders.view", role),
        `${role}: 기타건 현황과 내자 정리 조회가 갈렸다`
      );
    }
  });
});

describe("⑦ 🔴 잎이 하나도 안 사라졌고, 기본값이 한 칸도 안 바뀌었다", () => {
  /**
   * 권한을 건드린 조각에서 가장 조용히 깨지는 것이 이쪽이다 — 키가 사라지면 운영
   * role_permissions 의 그 행이 가리킬 곳을 잃고 **오류 없이** 기본 정책으로 되돌아가고,
   * 기본값이 한 칸 내려가면 그 역할 사람만 조용히 막힌다(열린 쪽은 금방 드러나지만
   * 닫힌 쪽은 아무도 신고하지 않는다).
   *
   * 🔴 표는 **이 조각을 시작하기 전에 실측한 값**이다(2026-11-12). 다섯 역할의 차례는
   * ROLE_CODES 그대로다.
   */
  const BASELINE_BEFORE: Record<string, string> = {
    dashboard: "READ READ READ READ READ",
    weeklyReport: "WRITE WRITE WRITE READ READ",
    "repairCases.view": "READ READ READ READ READ",
    "repairCases.edit": "WRITE WRITE WRITE WRITE NONE",
    "repairCases.workRecords": "MANAGE MANAGE WRITE READ READ",
    "repairCases.usedParts": "WRITE WRITE WRITE NONE NONE",
    "repairCases.lifecycle": "MANAGE MANAGE NONE NONE NONE",
    "repairCases.files": "WRITE WRITE WRITE WRITE WRITE",
    "repairCases.procedureExecution": "MANAGE MANAGE WRITE READ READ",
    "repairCases.workHistory": "READ READ READ READ READ",
    "repairCases.serviceReports": "READ READ READ READ READ",
    "repairCases.approval": "WRITE WRITE WRITE READ READ",
    myActiveWork: "NONE NONE READ NONE NONE",
    repairCaseNew: "WRITE WRITE WRITE WRITE WRITE",
    customerPortal: "MANAGE MANAGE WRITE WRITE NONE",
    "diagnosisFlowcharts.view": "READ READ READ READ READ",
    "diagnosisFlowcharts.edit": "WRITE WRITE WRITE NONE NONE",
    "diagnosisFlowcharts.permanentDelete": "MANAGE MANAGE NONE NONE NONE",
    "workflows.view": "READ READ READ NONE NONE",
    "workflows.editDraft": "WRITE WRITE WRITE NONE NONE",
    "workflows.publish": "MANAGE MANAGE MANAGE NONE NONE",
    excelKyosanIntakeList: "READ READ READ READ READ",
    kyosanIntakeImport: "MANAGE MANAGE NONE NONE NONE",
    "users.view": "READ READ READ READ READ",
    "users.shipmentRepresentatives": "MANAGE NONE NONE NONE NONE",
    "users.rolePermissions": "MANAGE MANAGE NONE NONE NONE",
    "customers.view": "READ READ READ READ NONE",
    "customers.create": "WRITE WRITE WRITE WRITE NONE",
    "customers.edit": "WRITE WRITE NONE NONE NONE",
    "customers.endUsers": "MANAGE MANAGE WRITE WRITE NONE",
    "customers.contacts": "MANAGE MANAGE WRITE WRITE NONE",
    "customers.lifecycle": "MANAGE MANAGE NONE NONE NONE",
    "productModels.view": "READ READ READ READ NONE",
    "productModels.edit": "WRITE WRITE NONE NONE NONE",
    "productModels.files": "WRITE WRITE WRITE NONE NONE",
    "productModels.lifecycle": "MANAGE MANAGE NONE NONE NONE",
    "technicalProcedures.view": "READ READ READ NONE NONE",
    "technicalProcedures.editDraft": "WRITE WRITE NONE NONE NONE",
    "technicalProcedures.publish": "MANAGE MANAGE NONE NONE NONE",
    "technicalProcedures.validation": "WRITE READ NONE NONE NONE",
    "technicalProcedures.lifecycle": "MANAGE MANAGE NONE NONE NONE",
    "inventory.requests": "WRITE READ WRITE NONE READ",
    "domesticOrders.view": "READ READ READ READ NONE",
    "domesticOrders.edit": "WRITE WRITE WRITE WRITE NONE",
    "domesticOrders.lifecycle": "MANAGE MANAGE NONE NONE NONE",
    "domesticOrders.approval": "READ READ READ READ NONE",
    miscCases: "READ READ READ READ NONE",
    quotes: "MANAGE MANAGE WRITE WRITE NONE",
    repairLabor: "MANAGE MANAGE READ READ NONE",
    mailSettings: "MANAGE MANAGE NONE NONE NONE",
    settings: "READ READ READ READ READ",
  };

  test("잎 51개가 글자 그대로 남아 있다", () => {
    assert.equal(PERMISSION_LEAF_KEYS.length, 51);
    assert.deepEqual([...PERMISSION_LEAF_KEYS], Object.keys(BASELINE_BEFORE));
  });

  test("🔴 다섯 역할 × 잎 51개의 기본 정책이 그대로다", () => {
    assert.equal(ROLE_CODES.length, 5);
    for (const leafKey of PERMISSION_LEAF_KEYS) {
      assert.equal(
        ROLE_CODES.map((role) => baselineLeafLevel(leafKey, role)).join(" "),
        BASELINE_BEFORE[leafKey],
        `${leafKey}: 기본 정책이 달라졌다`
      );
    }
  });
});

describe("⑧ 🔴 장식 잎은 메뉴 수준을 떠받치지 않는다", () => {
  /**
   * 2026-11-12(넷째)에 `repairCases.edit` 을 고정으로 잠그자 **그 잎이 '전체 A/S 현황'
   * 메뉴를 혼자 열린 채로 붙잡는** 상태가 한 번 만들어졌다. 메뉴 수준은 잎들의
   * 최대값인데, 저장이 고정 잎을 건너뛰므로 그 잎은 기본 정책값(네 역할에게 읽기+쓰기)
   * 으로 영영 남는다 — '하위 기능 전부 닫기'를 눌러도 메뉴가 안 닫히고, 관리자에게
   * 되돌릴 길이 없었다. 아무것도 여닫지 않는 칸이 **메뉴를 여는 열쇠 노릇**을 한 셈이다.
   *
   * 그래서 장식 잎을 최대값 셈에서 뺐다(permission-features.ts 의 `doesNotRaiseAreaLevel`).
   * 🔴 이 절은 그 변경의 **안전 조건**을 잰다: 빼도 지금 열린 문이 한 짝도 안 닫혀야 한다.
   * 메뉴 수준이 내려가면 사이드바와 페이지 가드는 물론 보고서 쓰기 문턱까지 함께
   * 움직인다(service-report-authorization.ts 가 이 메뉴 수준을 본다).
   */
  const AREA_LEVEL_BEFORE: Record<string, string> = {
    dashboard: "READ READ READ READ READ",
    weeklyReport: "WRITE WRITE WRITE READ READ",
    repairCases: "MANAGE MANAGE WRITE WRITE WRITE",
    myActiveWork: "NONE NONE READ NONE NONE",
    repairCaseNew: "WRITE WRITE WRITE WRITE WRITE",
    customerPortal: "MANAGE MANAGE WRITE WRITE NONE",
    diagnosisFlowcharts: "MANAGE MANAGE WRITE READ READ",
    workflows: "MANAGE MANAGE MANAGE NONE NONE",
    excelKyosanIntakeList: "READ READ READ READ READ",
    kyosanIntakeImport: "MANAGE MANAGE NONE NONE NONE",
    users: "MANAGE MANAGE READ READ READ",
    customers: "MANAGE MANAGE WRITE WRITE NONE",
    productModels: "MANAGE MANAGE WRITE READ NONE",
    technicalProcedures: "MANAGE MANAGE READ NONE NONE",
    inventory: "WRITE READ WRITE NONE READ",
    domesticOrders: "MANAGE MANAGE WRITE WRITE NONE",
    miscCases: "READ READ READ READ NONE",
    quotes: "MANAGE MANAGE WRITE WRITE NONE",
    repairLabor: "MANAGE MANAGE READ READ NONE",
    mailSettings: "MANAGE MANAGE NONE NONE NONE",
    settings: "READ READ READ READ READ",
  };

  test("표본이 비어 있지 않다 — 메뉴 21개를 실제로 훑는다", () => {
    assert.equal(PERMISSION_AREAS.length, 21);
    assert.deepEqual(
      PERMISSION_AREAS.map((area) => area.key),
      Object.keys(AREA_LEVEL_BEFORE)
    );
  });

  test("🔴 다섯 역할 × 메뉴 21개의 수준이 **한 칸도** 안 달라졌다", () => {
    // 🔴 바꾸기 **전에** 실측해 둔 표다(2026-11-12). 설정이 하나도 없는 상태의 메뉴
    //    수준 — resolver 가 쓰는 바로 그 계산이다.
    for (const area of PERMISSION_AREAS) {
      assert.equal(
        ROLE_CODES.map((role) =>
          areaLevelFromLeaves(area.key, (leafKey) => baselineLeafLevel(leafKey, role))
        ).join(" "),
        AREA_LEVEL_BEFORE[area.key],
        `${area.key}(${area.label}): 메뉴 수준이 달라졌다 — 그 역할이 조용히 열리거나 닫힌다`
      );
    }
  });

  test("🔴 그 표시는 `repairCases.edit` 하나뿐이다", () => {
    const decorative = PERMISSION_AREAS.flatMap((area) => featuresOfArea(area.key)).filter(
      (feature) => feature.fixed?.doesNotRaiseAreaLevel
    );
    assert.deepEqual(
      decorative.map((feature) => feature.key),
      [EDIT_LEAF],
      "메뉴를 못 열게 된 잎이 소리 없이 늘었다"
    );
  });

  test("🔴 두 고정 잎이 **반대로** 움직인다 — 권한 설정 잎은 그대로 떠받친다", () => {
    // 장식 잎 하나만 열려 있으면 메뉴는 닫힌 것으로 셈한다.
    assert.equal(
      areaLevelFromLeaves("repairCases", (leafKey) => (leafKey === EDIT_LEAF ? "WRITE" : "NONE")),
      "NONE"
    );
    // 🔴 '역할별 접근 권한 설정'은 장식이 아니다 — 그 잎 하나로도 '사용자 관리'가 열린다.
    //    이 잎의 동작은 2026-11-12 넷째에 **한 칸도 건드리지 않았다.**
    assert.equal(
      areaLevelFromLeaves("users", (leafKey) =>
        leafKey === ROLE_PERMISSIONS_LEAF ? "MANAGE" : "NONE"
      ),
      "MANAGE"
    );
  });

  test("이웃 잎은 그대로 센다 — 장식 잎만 빠진다", () => {
    // 🔵 표본 확인: 빼는 것이 '전부'가 아니라 '그 하나'임을 본다.
    assert.equal(
      areaLevelFromLeaves("repairCases", (leafKey) =>
        leafKey === "repairCases.files" ? "WRITE" : "NONE"
      ),
      "WRITE"
    );
  });
});
