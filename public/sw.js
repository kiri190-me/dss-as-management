/**
 * ============================================================================
 * 알림을 띄우는 통로 — 그것 하나만 한다
 * ============================================================================
 * 안드로이드 Chrome 은 페이지에서 직접 만드는 알림(`new Notification(...)`)을
 * **금지**한다. 만들려고 하면 그 자리에서
 *
 *     TypeError: Failed to construct 'Notification': Illegal constructor.
 *                Use ServiceWorkerRegistration.showNotification() instead.
 *
 * 를 던진다. 그래서 폰에서 알림이 뜨게 하려면 서비스워커가 **반드시** 있어야
 * 한다 — 이 파일이 존재하는 유일한 이유다.
 *
 * ── 🔴 fetch 를 다루지 않는다 ───────────────────────────────────────────
 * 서비스워커가 사이트를 망가뜨리는 경로는 사실상 하나뿐이다: `fetch` 이벤트를
 * 가로채는 것. 한 번 가로채기 시작하면 화면·API·파일 내려받기가 전부 이 파일을
 * 거치게 되고, 여기서 실수 하나가 나면 **브라우저에 눌어붙은 채로** 사이트
 * 전체가 죽는다(서비스워커는 페이지를 새로고침해도 사라지지 않는다).
 *
 * 그래서 이 파일에는 `fetch` 리스너가 없다. 요청을 하나도 가로채지 않으므로
 * 서비스워커가 설치돼 있어도 화면·API·내려받기는 지금과 100% 똑같이 돈다.
 * 같은 이유로 `caches` API 에도 손대지 않는다 — 캐시가 없으면 낡은 화면이 남을
 * 일도 없다.
 *
 * 🔴 나중에 누가 오프라인 캐시를 붙이고 싶어지더라도 **여기에 붙이지 말 것.**
 * 그것은 별도의 설계·검증이 필요한 다른 일이다.
 *
 * ── 웹 푸시가 아니다 ────────────────────────────────────────────────────
 * `PushManager` 도, VAPID 키도, 바깥 푸시 서비스도 쓰지 않는다. 알림은 여전히
 * **화면을 열어 둔 동안** 페이지가 만들어 이 통로로 넘기는 것뿐이다. 인터넷도
 * 구글 푸시 서비스도 필요 없고, 인터넷 없는 NAS 에서도 그대로 돈다.
 * ============================================================================
 */

/**
 * 새 판이 곧바로 먹게 한다.
 *
 * 기본 동작은 "열려 있는 탭이 전부 닫힐 때까지 옛 서비스워커가 계속 산다"이다.
 * 그러면 이 파일을 고쳐도 사람들 브라우저에서는 한참 동안 옛것이 돈다.
 * install 의 skipWaiting() 과 activate 의 clients.claim() 이 그 둘을 없앤다.
 */
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

/**
 * 알림을 눌렀을 때.
 *
 * 서비스워커로 띄운 알림은 클릭이 **페이지가 아니라 여기로** 온다 — 페이지의
 * `notification.onclick` 은 불리지 않는다. 그래서 갈 주소를 알림에 실어 보내고
 * (`data.href`) 여기서 그 주소를 연다.
 *
 * 이미 열려 있는 창을 앞으로 가져오는 것을 먼저 시도한다. 새 창을 여는 쪽이
 * 언제나 되긴 하지만, 쓰던 화면이 뒤에 남고 같은 시스템이 두 개 열린다.
 */
self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  var raw = (event.notification.data && event.notification.data.href) || "/";
  var target = new URL(raw, self.location.origin).href;

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then(function (windows) {
        // 1) 그 주소가 이미 열려 있으면 그 창을 앞으로.
        for (var i = 0; i < windows.length; i += 1) {
          if (windows[i].url === target) return windows[i].focus();
        }

        // 2) 아니면 아무 창이나 앞으로 가져와 그 주소로 옮긴다.
        for (var j = 0; j < windows.length; j += 1) {
          var client = windows[j];
          if (typeof client.navigate !== "function") continue;
          return client.focus().then(function (focused) {
            return focused.navigate(target).catch(function () {
              // 창을 옮기지 못하는 경우가 있다(다른 출처로 이동한 창 등).
              // 앞으로 가져온 것만으로도 사람은 시스템을 다시 볼 수 있으므로
              // 여기서 더 하지 않는다.
              return focused;
            });
          });
        }

        // 3) 열린 창이 하나도 없으면 새로 연다.
        if (typeof self.clients.openWindow === "function") {
          return self.clients.openWindow(target);
        }
        return undefined;
      })
  );
});
