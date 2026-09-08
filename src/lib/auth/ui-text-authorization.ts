import { mayEnterDeveloperMode, type DeveloperModeActor } from "./developer-mode-gate";

/**
 * 화면 문구(역할 이름·상태 배지 …)를 바꿀 수 있는가 — 개발자 모드 관문과 같은 넓이.
 *
 * ── 왜 이름을 따로 두면서 답은 빌려 오는가 ──────────────────────────────
 * ui-theme-authorization.ts 가 색 쪽에서, notification-settings-authorization.ts
 * 가 알림 쪽에서 한 것과 정확히 같은 모양이다. 이것은 "누가 개발자 화면에
 * 들어가는가"와 **다른 질문**이다 — "누가 앱 전체가 쓰는 말을 정하는가"다.
 * 지금은 두 답이 같아야 하지만(편집기가 개발자 모드 화면 안에 있다) 질문마다
 * 이름이 있어야, 나중에 한쪽만 바뀔 때 고칠 자리가 어디인지 알 수 있다. 그날
 * 고칠 것은 이 함수 한 줄이다.
 *
 * 역할 명단을 여기 다시 적지 않는 이유도 같다. 같아야 하는 값을 두 곳에 적어
 * 두면 한쪽만 고쳐지는 날이 오고, 그 어긋남은 이 저장소가 이미 여러 번 겪었다
 * (permission-baseline.ts 머리말).
 *
 * ── 🔴 mayManageDeveloperFlag 처럼 좁히지 않는다 ────────────────────────
 * 그 판정은 "진짜 최고관리자만"이라 승격된 개발자를 막는다. 그 칸이 권한을
 * 최고관리자급으로 올리는 스위치 그 자체라서 특별히 좁혀 둔 것이다. 화면 문구는
 * 권한을 하나도 움직이지 않는다 — 화면에 보이는 말이 바뀔 뿐이다. 여기서 같이
 * 좁히면 **"들어와서 편집기는 보이는데 누르면 거절"** 이 된다.
 *
 * ── 🔴 actorMay 로 감싸지 않는다 ────────────────────────────────────────
 * mayEnterDeveloperMode 는 이미 "이 사람이 개발자냐"를 묻는 관문이고 승인
 * 상태까지 본다. 그 위에 승격(developer-promotion.ts)을 한 겹 더 얹으면 뜻이
 * 겹치고, 승격 규칙을 손보는 날 이 문이 함께 움직인다.
 *
 * 다른 *-authorization.ts 와 같은 관례를 따른다: 자료를 읽지 않는 순수 함수이고,
 * 페이지와 서버 액션과 mutation 이 각자 독립적으로 다시 검사한다.
 */
export function mayEditUiText(actor: DeveloperModeActor<string>): boolean {
  return mayEnterDeveloperMode(actor);
}
