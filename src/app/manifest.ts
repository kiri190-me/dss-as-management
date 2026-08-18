import type { MetadataRoute } from "next";

/**
 * 홈 화면에 설치했을 때 브라우저 크롬(주소창/탭/메뉴) 없이 뜨게 하는 설정
 * 파일이다. Next.js가 이 파일을 `/manifest.webmanifest`로 서빙하고,
 * layout.tsx의 `metadata.manifest`가 <head>에서 그것을 가리킨다.
 *
 * `display: "standalone"`이 그 스위치다. iOS Safari는 manifest 대신
 * layout.tsx의 `appleWebApp.capable`(= apple-mobile-web-app-capable 메타
 * 태그)을 보므로 두 곳을 같이 유지해야 한다 — 한쪽만 바꾸면 플랫폼별로
 * 동작이 갈린다.
 *
 * `start_url`이 "/"인 이유: 루트는 /dashboard로 리다이렉트하고, 미로그인
 * 상태면 (app)/layout.tsx가 다시 /login으로 보낸다. 즉 세션 상태와 무관하게
 * 항상 올바른 첫 화면에 도달한다 — /dashboard를 직접 넣으면 미로그인 설치
 * 사용자에게 리다이렉트가 한 번 더 붙는다.
 *
 * 아이콘은 public/icons/의 PNG 4종이다. `purpose: "maskable"` 항목은
 * 안드로이드 런처가 기기별 모양(원형/스쿼클 등)으로 잘라내는 용도라 로고가
 * 중앙 안전 영역 안에 들어가도록 별도로 만든 파일이고, `"any"` 두 개는
 * 잘라내지 않고 그대로 쓰는 용도다. 둘을 한 파일로 겸용하면 어느 한쪽이
 * 반드시 어색해진다.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "DSS A/S 관리 시스템",
    short_name: "DSS A/S",
    description: "DSS A/S 관리 시스템 Phase 1 데모 프로젝트",
    lang: "ko",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#ffffff",
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
