import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { KYOSAN_FALLBACK_CAUSE, knownKyosanCauseMarks, mapKyosanCauses } from "./report-causes";

/**
 * ============================================================================
 * 연락서 ○ 원인 → 우리 원인 열 가지 (조각 S3b)
 * ============================================================================
 * 못 박는 것은 셋이다.
 *  1. 열 칸이 **그대로 맞물린다** — 양식이 같은 목록이기 때문이다.
 *  2. 🔴 **대응 없는 글자는 「기타」로 들어간다.** 행을 안 만들면 사람이 ○ 를
 *     찍어 둔 사실이 없던 일이 된다(2026-09-21 사용자 결정 1).
 *  3. ○ 가 하나도 없으면 원인도 하나도 안 넣는다 — 「안 골랐다」와 「기타를
 *     골랐다」는 다른 말이다.
 * ============================================================================
 */

describe("연락서 보기 글자 → 우리 원인", () => {
  test("열 가지가 그대로 맞물린다 — 양식이 같은 목록이다", () => {
    assert.equal(knownKyosanCauseMarks().length, 10);
    assert.deepEqual(
      mapKyosanCauses([
        "製作不良",
        "部品不良",
        "経年劣化",
        "輸送不良",
        "保管不良",
        "仕様不備",
        "検査ミス",
        "取扱不備",
        "再現せず",
        "その他",
      ]).causes,
      [
        "MANUFACTURING_DEFECT",
        "PART_DEFECT",
        "AGING",
        "TRANSPORT_DAMAGE",
        "STORAGE_DAMAGE",
        "SPEC_SHORTFALL",
        "INSPECTION_MISS",
        "MISHANDLING",
        "NOT_REPRODUCED",
        "OTHER",
      ]
    );
  });

  test("실측에서 가장 흔한 `その他` 는 「기타」다", () => {
    assert.deepEqual(mapKyosanCauses(["その他"]), { causes: ["OTHER"], unmapped: [] });
  });

  test("공백과 반각 가타카나를 눌러서 견준다 — 판본마다 섞여 들어온다", () => {
    assert.deepEqual(mapKyosanCauses(["その 他"]).causes, ["OTHER"]);
    assert.deepEqual(mapKyosanCauses(["検査ﾐｽ"]).causes, ["INSPECTION_MISS"]);
    assert.deepEqual(mapKyosanCauses(["　経年劣化　"]).causes, ["AGING"]);
  });
});

describe("🔴 대응이 없으면 「기타」로 — 원인이 사라지지 않는다", () => {
  test("모르는 글자는 기타로 들어가고, 원래 글자를 함께 돌려준다", () => {
    const mapped = mapKyosanCauses(["劣化"]);
    assert.deepEqual(mapped.causes, [KYOSAN_FALLBACK_CAUSE]);
    assert.deepEqual(mapped.causes, ["OTHER"]);
    // 사전을 고칠 사람에게 글자가 필요하다.
    assert.deepEqual(mapped.unmapped, ["劣化"]);
  });

  test("모르는 글자가 여럿이어도 「기타」 행은 하나다 — 유니크 인덱스가 하나뿐이다", () => {
    const mapped = mapKyosanCauses(["劣化", "謎の原因", "その他"]);
    assert.deepEqual(mapped.causes, ["OTHER"]);
    assert.deepEqual(mapped.unmapped, ["劣化", "謎の原因"]);
  });

  test("아는 것과 모르는 것이 섞이면 아는 것은 제 자리로, 모르는 것만 기타로", () => {
    const mapped = mapKyosanCauses(["部品不良", "謎の原因"]);
    assert.deepEqual(mapped.causes, ["PART_DEFECT", "OTHER"]);
    assert.deepEqual(mapped.unmapped, ["謎の原因"]);
  });
});

describe("고르지 않은 것을 고른 것으로 만들지 않는다", () => {
  test("🔴 ○ 가 하나도 없으면 원인도 하나도 없다 — 「기타」를 대신 넣지 않는다", () => {
    assert.deepEqual(mapKyosanCauses([]), { causes: [], unmapped: [] });
  });

  test("빈 글자·공백만 있는 보기는 세지 않는다", () => {
    assert.deepEqual(mapKyosanCauses(["", "  ", "　"]), { causes: [], unmapped: [] });
  });

  test("같은 보기가 두 번 찍혀도 행은 하나다", () => {
    assert.deepEqual(mapKyosanCauses(["部品不良", "部品不良"]).causes, ["PART_DEFECT"]);
  });
});
