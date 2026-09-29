import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  IDENTITY_ORIENTATION,
  describeOrientation,
  isIdentityOrientation,
  isQuarterTurned,
  orientationDrawSteps,
  orientationSearchParams,
  orientedPixelSize,
  parseOrientation,
  type ImageOrientation,
} from "./image-orientation";

/**
 * ============================================================================
 * 화면에서 돌린 것과 파일에 적히는 것이 같은가
 * ============================================================================
 * 같은 값이 세 자리를 지난다 — 화면(CSS transform) · 주소의 인자 · 캔버스.
 * 어긋나면 **오류 없이 결과만 다르다**(90° 돌려 저장했는데 위아래가 뒤집혀
 * 저장되는 식). 그것을 여기서 못박는다.
 *
 * 저장은 되돌릴 수 없으므로 **닫히는 쪽으로 실패하는지**도 함께 본다 —
 * 알아들을 수 없는 인자는 짐작하지 않고 null 이다.
 * ============================================================================
 */

const TURNED: ImageOrientation = { rotate: 90, flipX: false, flipY: false };

describe("인자 읽기 — 알아들을 수 없으면 짐작하지 않는다", () => {
  test("네 각도와 두 깃발을 그대로 읽는다", () => {
    assert.deepEqual(parseOrientation({ rotate: "0", flipX: "0", flipY: "0" }), IDENTITY_ORIENTATION);
    assert.deepEqual(parseOrientation({ rotate: "90", flipX: "1", flipY: "0" }), {
      rotate: 90,
      flipX: true,
      flipY: false,
    });
    assert.deepEqual(parseOrientation({ rotate: "270", flipX: "0", flipY: "1" }), {
      rotate: 270,
      flipX: false,
      flipY: true,
    });
  });

  test("깃발이 아예 없으면 꺼진 것으로 본다 — 없는 것과 0 은 같은 말이다", () => {
    assert.deepEqual(parseOrientation({ rotate: "180", flipX: null, flipY: null }), {
      rotate: 180,
      flipX: false,
      flipY: false,
    });
  });

  test("🔴 목록에 없는 각도는 null 이다 — 45° 로 돌려 저장하는 길이 없다", () => {
    for (const rotate of ["45", "360", "-90", "90.0", " 90", "ninety", "", null]) {
      assert.equal(
        parseOrientation({ rotate, flipX: "0", flipY: "0" }),
        null,
        `rotate=${JSON.stringify(rotate)} 가 통과했다`
      );
    }
  });

  test("🔴 깃발에 아무 말이나 쓰면 null 이다 — true·yes 를 받아 주지 않는다", () => {
    for (const flag of ["true", "yes", "2", "on", "-1"]) {
      assert.equal(parseOrientation({ rotate: "90", flipX: flag, flipY: "0" }), null, `flipX=${flag}`);
      assert.equal(parseOrientation({ rotate: "90", flipX: "0", flipY: flag }), null, `flipY=${flag}`);
    }
  });

  test("주소로 실었다가 다시 읽으면 같은 값이다", () => {
    for (const orientation of [
      IDENTITY_ORIENTATION,
      TURNED,
      { rotate: 180, flipX: true, flipY: true } as ImageOrientation,
      { rotate: 270, flipX: true, flipY: false } as ImageOrientation,
    ]) {
      const params = orientationSearchParams(orientation);
      assert.deepEqual(
        parseOrientation({ rotate: params.rotate, flipX: params.flipX, flipY: params.flipY }),
        orientation
      );
    }
  });
});

describe("그대로인가", () => {
  test("돌리지도 뒤집지도 않았으면 참", () => {
    assert.equal(isIdentityOrientation(IDENTITY_ORIENTATION), true);
  });

  test("🔴 뒤집기만 해도 거짓이다 — 각도만 보고 「그대로」로 넘기면 저장이 조용히 막힌다", () => {
    assert.equal(isIdentityOrientation({ rotate: 0, flipX: true, flipY: false }), false);
    assert.equal(isIdentityOrientation({ rotate: 0, flipX: false, flipY: true }), false);
    assert.equal(isIdentityOrientation(TURNED), false);
  });
});

describe("돌린 뒤의 크기", () => {
  test("🔴 90°·270° 는 가로와 세로가 바뀐다", () => {
    assert.equal(isQuarterTurned(TURNED), true);
    assert.deepEqual(orientedPixelSize({ width: 4000, height: 3000 }, TURNED), {
      width: 3000,
      height: 4000,
    });
    assert.deepEqual(
      orientedPixelSize({ width: 4000, height: 3000 }, { rotate: 270, flipX: false, flipY: false }),
      { width: 3000, height: 4000 }
    );
  });

  test("0°·180° 와 뒤집기는 크기를 바꾸지 않는다", () => {
    assert.equal(isQuarterTurned(IDENTITY_ORIENTATION), false);
    assert.deepEqual(orientedPixelSize({ width: 4000, height: 3000 }, IDENTITY_ORIENTATION), {
      width: 4000,
      height: 3000,
    });
    assert.deepEqual(
      orientedPixelSize({ width: 4000, height: 3000 }, { rotate: 180, flipX: true, flipY: true }),
      { width: 4000, height: 3000 }
    );
  });
});

describe("캔버스로 다시 그리는 값", () => {
  test("각도를 라디안으로, 뒤집기를 −1 로 준다", () => {
    assert.deepEqual(orientationDrawSteps(IDENTITY_ORIENTATION), {
      rotateRadians: 0,
      scaleX: 1,
      scaleY: 1,
    });
    assert.deepEqual(orientationDrawSteps({ rotate: 90, flipX: true, flipY: false }), {
      rotateRadians: Math.PI / 2,
      scaleX: -1,
      scaleY: 1,
    });
    assert.deepEqual(orientationDrawSteps({ rotate: 180, flipX: false, flipY: true }), {
      rotateRadians: Math.PI,
      scaleX: 1,
      scaleY: -1,
    });
    assert.equal(
      orientationDrawSteps({ rotate: 270, flipX: false, flipY: false }).rotateRadians,
      (3 * Math.PI) / 2
    );
  });

  test("🔴 화면(CSS)과 캔버스가 같은 곳을 가리킨다 — 한 점을 직접 옮겨 본다", () => {
    // 4000×3000 사진을 오른쪽 90° 돌리고 좌우(그림 기준)로 뒤집는다.
    const orientation: ImageOrientation = { rotate: 90, flipX: true, flipY: false };
    const source = { width: 4000, height: 3000 };
    const output = orientedPixelSize(source, orientation);
    const steps = orientationDrawSteps(orientation);

    // 캔버스가 하는 일: translate(출력 가운데) → rotate → scale → 그림을 가운데 정렬.
    // 그림 안의 점 p(가운데 기준)는 이렇게 옮겨진다.
    const place = (x: number, y: number) => {
      const sx = x * steps.scaleX;
      const sy = y * steps.scaleY;
      const cos = Math.round(Math.cos(steps.rotateRadians));
      const sin = Math.round(Math.sin(steps.rotateRadians));
      return { x: sx * cos - sy * sin, y: sx * sin + sy * cos };
    };

    // CSS 도 `rotate(90deg) scaleX(-1)` 로 같은 차례다(오른쪽 것이 점에 먼저).
    // 그림의 **왼쪽 위 모서리**(-2000, -1500)가 어디로 가는가:
    //   뒤집기 → (+2000, -1500),  90° 회전 → (+1500, +2000)
    assert.deepEqual(place(-2000, -1500), { x: 1500, y: 2000 });
    // 출력 캔버스는 3000×4000 이므로 그 점은 오른쪽 **아래** 모서리다.
    assert.deepEqual({ x: output.width / 2, y: output.height / 2 }, { x: 1500, y: 2000 });

    // 🔴 차례를 뒤집으면(회전 먼저, 뒤집기 나중) 같은 모서리가 왼쪽 위로 간다 —
    //    저장된 그림이 화면과 상하로 어긋나는 그 고장이다.
    const wrong = (() => {
      const cos = Math.round(Math.cos(steps.rotateRadians));
      const sin = Math.round(Math.sin(steps.rotateRadians));
      const rx = -2000 * cos - -1500 * sin;
      const ry = -2000 * sin + -1500 * cos;
      return { x: rx * steps.scaleX, y: ry * steps.scaleY };
    })();
    assert.notDeepEqual(wrong, place(-2000, -1500));
  });
});

describe("감사에 남는 말", () => {
  test("어느 방향으로 돌렸는지 사람 말로 적는다", () => {
    assert.equal(describeOrientation(IDENTITY_ORIENTATION), "그대로");
    assert.equal(describeOrientation(TURNED), "오른쪽으로 90도 회전");
    assert.equal(
      describeOrientation({ rotate: 180, flipX: true, flipY: true }),
      "오른쪽으로 180도 회전 · 좌우 뒤집기 · 상하 뒤집기"
    );
    assert.equal(describeOrientation({ rotate: 0, flipX: true, flipY: false }), "좌우 뒤집기");
  });

  test("🔴 파일 이름이나 경로는 담기지 않는다 — 방향만 말한다", () => {
    const said = describeOrientation({ rotate: 270, flipX: true, flipY: true });
    assert.ok(!said.includes("/"), said);
    assert.ok(!said.includes("."), said);
  });
});
