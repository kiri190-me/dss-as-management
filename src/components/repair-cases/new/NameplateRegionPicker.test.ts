import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

import { armNameplateCancel, showNameplatePhoto } from "./NameplateRegionPicker";

/**
 * ============================================================================
 * 네모 치기 창 — **개발 모드 StrictMode 두 번 붙이기를 견디는가**
 * ============================================================================
 * 2026-10-02, 사용자가 「글자로 읽어 보기」를 눌렀더니 창은 떴는데 **사진 자리에
 * 깨진 그림만** 나왔다. 시험도 타입검사도 빌드도 전부 통과한 뒤였다.
 *
 * 까닭: `useState(() => URL.createObjectURL(file))` 로 주소를 만들고 **다른
 * effect 의 정리**에서 없앴다. React 는 개발 모드에서 컴포넌트를 일부러
 * 「붙였다 → 떼었다 → 다시 붙인다」. 떼어질 때 정리가 돌아 주소를 없애는데,
 * 다시 붙을 때 `useState` 의 초기값은 **다시 돌지 않는다** — 그래서 이미
 * 없어진 주소로 `<img>` 를 그렸다.
 *
 * 🔴 **운영 묶음(`npm run build`)에는 StrictMode 가 없어 이 증상이 안 난다.**
 * 그래서 「빌드가 되니 괜찮다」가 근거가 되지 못한다.
 *
 * ── 이 시험이 보는 것 ──────────────────────────────────────────────────
 * 이 저장소의 화면 시험 틀에는 브라우저가 없다(정적 렌더뿐이고, 효과를 실제로
 * 돌려 주는 장치가 없다). 그래서 `NewQuoteDialog` 가 같은 문제를 풀었던 방식을
 * 그대로 쓴다 — **효과의 알맹이를 순수 함수로 꺼내 두고**, 시험이 「실행 →
 * 정리 → 다시 실행」을 손으로 돌린다. 컴포넌트가 그 함수를 **제자리에서 쓰고
 * 있는지**는 소스를 읽어 못박는다(쓰지 않으면 이 시험이 아무것도 못 지킨다).
 *
 * ── 🔴 그래도 눈으로 봐야 하는 것 ──────────────────────────────────────
 * 효과를 실제로 거는 것은 React 다. 이 시험은 「우리가 넘긴 알맹이가 옳은가」와
 * 「컴포넌트가 그것을 쓰는가」까지만 본다. **창을 열어 사진이 실제로 보이는지**,
 * 드래그한 네모가 손가락을 따라오는지는 여전히 사람이 봐야 한다.
 * ============================================================================
 */

/** `URL.createObjectURL` 을 가짜로 바꿔 끼우고, 무엇이 살아 있는지 센다. */
function fakeObjectUrls() {
  const original = {
    create: URL.createObjectURL,
    revoke: URL.revokeObjectURL,
  };
  let next = 0;
  const alive = new Set<string>();
  const created: string[] = [];
  const revoked: string[] = [];
  URL.createObjectURL = () => {
    next += 1;
    const url = `blob:fake/${next}`;
    alive.add(url);
    created.push(url);
    return url;
  };
  URL.revokeObjectURL = (url: string) => {
    alive.delete(url);
    revoked.push(url);
  };
  const restore = () => {
    URL.createObjectURL = original.create;
    URL.revokeObjectURL = original.revoke;
  };
  return { alive, created, revoked, restore };
}

/** 화면에 걸린 주소를 들고 있는 가짜 상태. */
function fakeShow() {
  const shown: (string | null)[] = [];
  return {
    shown,
    show: (url: string | null) => {
      shown.push(url);
    },
    get current() {
      return shown.length === 0 ? null : shown[shown.length - 1];
    },
  };
}

const PHOTO = { name: "명판.jpg" } as unknown as Blob;

describe("사진 주소 — 🔴 StrictMode 가 떼었다 다시 붙여도 살아 있다", () => {
  test("🔴 실행 → 정리 → 다시 실행 뒤, 화면에 걸린 주소가 **없어지지 않은 것**이다", () => {
    const urls = fakeObjectUrls();
    try {
      const view = fakeShow();
      // StrictMode 의 effect: 실행 → 정리 → 다시 실행.
      const cleanupFirst = showNameplatePhoto(PHOTO, view.show);
      cleanupFirst();
      showNameplatePhoto(PHOTO, view.show);

      const current = view.current;
      assert.ok(current, "다시 붙은 뒤 화면에 사진 주소가 없다");
      assert.ok(
        urls.alive.has(current),
        `없어진 주소를 그리고 있다(깨진 그림) — ${current}, 없앤 것 ${urls.revoked.join(",")}`
      );
      // 주소를 두 번 만들었으니 앞엣것은 반드시 없앴어야 한다(메모리 누수).
      assert.equal(urls.created.length, 2);
      assert.deepEqual(urls.revoked, [urls.created[0]]);
    } finally {
      urls.restore();
    }
  });

  test("한 번만 붙으면 바로 보여 준다", () => {
    const urls = fakeObjectUrls();
    try {
      const view = fakeShow();
      showNameplatePhoto(PHOTO, view.show);
      assert.equal(view.current, urls.created[0]);
      assert.ok(urls.alive.has(urls.created[0]));
    } finally {
      urls.restore();
    }
  });

  test("🔴 정리는 **화면에서 치운 뒤** 없앤다 — 죽은 주소가 그려질 틈이 없다", () => {
    const urls = fakeObjectUrls();
    try {
      const view = fakeShow();
      const cleanup = showNameplatePhoto(PHOTO, view.show);
      cleanup();
      assert.equal(view.current, null, "정리했는데 주소가 그대로 걸려 있다");
      assert.equal(urls.alive.size, 0);
      // 치우기가 없애기보다 먼저여야 한다.
      assert.deepEqual(view.shown, [urls.created[0], null]);
    } finally {
      urls.restore();
    }
  });

  test("정말로 창을 닫으면 주소를 남기지 않는다", () => {
    const urls = fakeObjectUrls();
    try {
      showNameplatePhoto(PHOTO, () => {})();
      assert.equal(urls.alive.size, 0, "닫았는데 blob 이 메모리에 남아 있다");
    } finally {
      urls.restore();
    }
  });
});

describe("읽기 취소 깃발 — 🔴 다시 붙으면 **내려가 있어야** 한다", () => {
  test("🔴 실행 → 정리 → 다시 실행 뒤 깃발이 내려가 있다", () => {
    const flag = { current: false };
    const disarmFirst = armNameplateCancel(flag);
    disarmFirst();
    assert.equal(flag.current, true, "떼어냈는데 깃발이 서지 않는다");
    armNameplateCancel(flag);
    assert.equal(
      flag.current,
      false,
      "다시 붙었는데 깃발이 서 있다 — 첫 인식에서 바로 멈춰 0/18 에 머문다"
    );
  });

  test("떼어내면 깃발이 선다 — 돌던 읽기가 칸을 채우지 않는다", () => {
    const flag = { current: false };
    armNameplateCancel(flag)();
    assert.equal(flag.current, true);
  });
});

describe("🔴 컴포넌트가 그 알맹이를 **제자리에서** 쓴다", () => {
  const source = readFileSync(new URL("./NameplateRegionPicker.tsx", import.meta.url), "utf8");

  /**
   * 🔴 **주석을 걷어낸 알맹이만 본다.**
   *
   * 저 파일의 주석에는 「`useState(() => URL.createObjectURL(file))` 로 만들지
   * 마라」가 **일부러** 적혀 있다(다음 사람이 되돌리지 않게 하려고). 주석째로
   * 재면 그 경고문 자체가 「되돌아갔다」로 잡혀 시험이 터진다 — 실제로 터졌다.
   */
  const code = source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

  test("🔴 주석을 걷어내도 알맹이가 남아 있다 — 이 시험의 바탕이다", () => {
    assert.ok(code.includes("useEffect"), "주석을 걷다가 코드까지 지웠다");
    assert.ok(!code.includes("로 만들지 마라"), "주석이 덜 걷혔다");
  });

  test("🔴 사진 주소를 `useState` 초기값으로 만들지 않는다 — 그것이 이 버그였다", () => {
    // 되돌아간 모양(실제로 있었던 줄): useState 초기값 안에서 주소를 만드는 것.
    // 자(regex)를 `[^)]*` 로 적으면 `() =>` 의 닫는 괄호를 못 넘어 **되돌려도
    // 통과한다** — 확인하고 고쳤으므로, 자가 제 일을 하는지도 함께 단언한다.
    const revertedShape = /useState\([\s\S]{0,40}?URL\.createObjectURL/;
    assert.ok(
      revertedShape.test("const [photoUrl] = useState(() => URL.createObjectURL(file));"),
      "이 시험의 자(regex)가 되돌아간 모양을 못 잡는다 — 자부터 고칠 것"
    );
    assert.ok(
      !revertedShape.test(code),
      "useState 초기값에서 주소를 만들고 있다 — StrictMode 가 떼었다 붙이면 깨진 그림이 된다"
    );
  });

  test("만들기와 없애기가 같은 effect 한 번 안에 있다", () => {
    assert.ok(
      code.includes("useEffect(() => showNameplatePhoto(file, setPhotoUrl), [file]);"),
      "effect 가 showNameplatePhoto 로 짝을 묶지 않는다"
    );
  });

  test("취소 깃발을 effect 본문에서 내린다", () => {
    assert.ok(
      code.includes("const disarm = armNameplateCancel(cancelledRef);"),
      "effect 가 armNameplateCancel 로 깃발을 내리지 않는다"
    );
  });

  test("🔴 주소가 없는 동안에는 `<img>` 를 그리지 않는다", () => {
    assert.ok(
      code.includes("photoUrl === null ?"),
      "주소가 null 인 동안에도 <img> 를 그린다 — 깨진 그림이 깜빡인다"
    );
  });
});
