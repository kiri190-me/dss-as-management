import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

/**
 * ============================================================================
 * 데스크톱 북마크 아이콘 = 모바일 홈 화면 아이콘 (2026-09-15 사용자 요청)
 * ============================================================================
 * 북마크·탭은 app/favicon.ico 를 쓰는데, 그 파일이 프로젝트를 만들 때 들어온
 * **Next.js 기본 로고(검은 원 안의 흰 삼각형)** 그대로였다.
 *
 * 모바일 아이콘(public/icons/)은 사용자가 폰에서 보는 아이콘 — 통합 로그인 포털
 * (dss-auth)의 **흰 바탕에 파랑 · 흰색 · 빨강 사각형** 그림 — 으로 맞췄고(포털 원본을
 * 그대로 복사했다), 파비콘도 그 icon-512.png 로 만들었다. 기본 로고로 되돌아가거나
 * 포털과 다른 그림이 되면 여기서 걸린다.
 * ============================================================================
 */

/** create-next-app 이 넣어 준 기본 favicon.ico 의 SHA-256(25,931바이트). */
const NEXT_DEFAULT_FAVICON_SHA256 = "2b8ad2d33455a8f736fc3a8ebf8f0bdea8848ad4c0db48a2833bd0f9cd775932";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * 통합 로그인 포털(dss-auth)의 모바일 아이콘 원본 넷의 SHA-256. 이 저장소의
 * public/icons/ 는 그 원본을 **그대로 복사한 것**이다(2026-09-15 사용자 — 폰에 저장한
 * 웹앱의 삼색 아이콘으로). 포털 저장소가 옆에 없는 PC · NAS 에서도 돌도록 지문을 적어
 * 둔다 — 포털 아이콘을 바꾸는 날에는 이 값도 함께 바꾼다.
 */
const PORTAL_ICON_SHA256: Readonly<Record<string, string>> = {
  "apple-touch-icon.png": "62fae6251b2f7b6449e4ecf97c9e0582bec7858e4b9eda53e7f044b7673c9c8c",
  "icon-192.png": "5788c418492c705813d2ed904eb8c712a95f93d2e2118103d4de26f0f5624f07",
  "icon-512.png": "0b1592249f54267442103c2576308af237fe8c255264696d65284f4be62e668e",
  "icon-maskable-512.png": "ea6d351a98f90323b53cf88a185f3c76b9b771af7a64ccccde4cc3c1dea464db",
};

const sha256 = (buffer: Buffer) => createHash("sha256").update(buffer).digest("hex");

const favicon = readFileSync("src/app/favicon.ico");

test("🔴 모바일 아이콘 넷이 통합 로그인 포털의 원본과 같은 파일이다", () => {
  for (const [name, expected] of Object.entries(PORTAL_ICON_SHA256)) {
    assert.equal(sha256(readFileSync(`public/icons/${name}`)), expected, `${name} 이 포털 원본과 다르다`);
  }
});

/** ICO 머리의 목록 — 크기(0 은 256) · 그림이 든 자리. */
function icoEntries(buffer: Buffer) {
  assert.equal(buffer.readUInt16LE(2), 1, "ICO 파일이 아니다");
  const count = buffer.readUInt16LE(4);
  return Array.from({ length: count }, (_, index) => {
    const at = 6 + index * 16;
    const length = buffer.readUInt32LE(at + 8);
    const offset = buffer.readUInt32LE(at + 12);
    return { size: buffer[at] === 0 ? 256 : buffer[at], length, offset };
  });
}

test("🔴 파비콘이 Next.js 기본 로고가 아니다", () => {
  assert.notEqual(createHash("sha256").update(favicon).digest("hex"), NEXT_DEFAULT_FAVICON_SHA256);
});

test("🔴 북마크·탭이 쓰는 크기(16·32·48)와 큰 크기(256)가 모두 PNG 로 들어 있다", () => {
  const entries = icoEntries(favicon);
  assert.deepEqual(
    entries.map((entry) => entry.size),
    [16, 32, 48, 256]
  );
  for (const entry of entries) {
    assert.ok(entry.offset + entry.length <= favicon.length, `${entry.size} 크기가 파일 밖을 가리킨다`);
    const png = favicon.subarray(entry.offset, entry.offset + entry.length);
    assert.ok(png.subarray(0, 8).equals(PNG_SIGNATURE), `${entry.size} 크기가 PNG 가 아니다`);
    // IHDR 의 가로·세로가 목록에 적힌 크기와 같아야 한다 — 어긋나면 브라우저가 흐리게 늘린다.
    assert.equal(png.readUInt32BE(16), entry.size, `${entry.size} 크기 그림의 가로가 다르다`);
    assert.equal(png.readUInt32BE(20), entry.size, `${entry.size} 크기 그림의 세로가 다르다`);
  }
});

test("레이아웃이 큰 아이콘으로 모바일과 같은 PNG 를 가리키고, 애플 아이콘도 그대로다", () => {
  const layout = readFileSync("src/app/layout.tsx", "utf8").replace(/\s+/g, " ");
  assert.ok(
    layout.includes('icon: [{ url: "/icons/icon-192.png", type: "image/png", sizes: "192x192" }],'),
    "큰 아이콘 링크가 모바일 아이콘을 가리키지 않는다"
  );
  assert.ok(layout.includes('apple: "/icons/apple-touch-icon.png",'), "애플 아이콘이 달라졌다");
  const manifest = readFileSync("src/app/manifest.ts", "utf8");
  assert.ok(manifest.includes('"/icons/icon-192.png"'), "모바일(manifest) 아이콘 경로가 달라졌다");
});
