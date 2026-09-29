/**
 * ============================================================================
 * 한 요청에 두 파일 — 본문을 정해진 바이트에서 가른다
 * ============================================================================
 * 돌린 사진을 저장할 때는 **원본과 썸네일이 함께** 와야 한다. 하나만 바뀌면
 * 목록은 옛 방향, 크게 보기는 새 방향이 되어 사용자는 "저장이 안 됐다"고 여긴다.
 * 둘을 한 요청에 실어야 「둘 다 아니면 둘 다」를 지킬 수 있다.
 *
 * ── multipart/form-data 를 쓰지 않는 까닭 ────────────────────────────────
 * `request.formData()` 는 **파일 전체를 메모리에 담고 나서야** 돌려준다. 원본이
 * 20MB 까지 올 수 있는 통로에서 그것은 올리기 라우트가 처음부터 피해 온 일이다
 * (api/repair-cases/[id]/attachments/route.ts 머리말 1번). 그래서 본문은 예전처럼
 * **바이트 그 자체**로 두고, 두 덩어리의 경계만 주소의 인자로 받는다:
 *
 *     PUT …/rotation?previewBytes=41234&rotate=90…
 *     본문 = [썸네일 JPEG 41234바이트][돌린 원본 …]
 *
 * ── 🔴 앞을 다 읽은 **뒤에** 뒤를 읽는다 — 차례를 여기서 강제한다 ───────
 * 두 스트림은 같은 reader 하나를 나눠 쓴다. 뒤쪽이 먼저 당기면 앞쪽 바이트가
 * 뒤쪽으로 흘러간다 — 그러면 원본 앞에 썸네일 꼬리가 붙은 채로 원본을 덮어쓴다.
 *
 * 부르는 쪽이 「head 를 다 저장한 다음 tail」로 부르는 것만으로는 **모자란다.**
 * ReadableStream 은 만들어지는 순간 `pull` 을 한 번 부른다(아무도 읽지 않아도).
 * 그래서 tail 을 만들기만 해도 그 pull 이 reader 에서 한 조각을 가져가 버린다 —
 * 실제로 시험이 그 어긋남을 잡았다(chunk 하나가 head 를 건너뛰고 tail 로 갔다).
 * tail 은 head 가 끝날 때까지 **기다렸다가** 읽는다.
 *
 * ── 짧게 끝나도 던지지 않는다 ────────────────────────────────────────────
 * 본문이 previewBytes 보다 짧으면 head 가 그만큼만 나오고 tail 은 비어서 끝난다.
 * 여기서 던지지 않는 까닭은, **실제로 받은 바이트 수를 세는 쪽**(저장소의
 * writeTemp)이 이미 그 값을 알고 있어서다 — 라우트가 그 값과 선언한 값을
 * 견주어 거절한다. 스트림을 가르는 자리에서까지 판정하면 같은 규칙이 두 벌이 된다.
 * ============================================================================
 */

export type SplitStreams = {
  /** 앞 `headBytes` 바이트. 본문이 짧으면 그만큼만 나오고 끝난다. */
  head: ReadableStream<Uint8Array>;
  /** 나머지 전부. **head 를 다 읽은 뒤에** 읽어야 한다. */
  tail: ReadableStream<Uint8Array>;
};

/**
 * 스트림 하나를 `headBytes` 에서 둘로 가른다. 원본 스트림은 여기서 잠기므로
 * (getReader) 부르는 쪽이 다시 읽지 않는다.
 */
export function splitStreamAt(
  source: ReadableStream<Uint8Array>,
  headBytes: number
): SplitStreams {
  if (!Number.isInteger(headBytes) || headBytes < 0) {
    throw new TypeError("가를 위치는 0 이상의 정수여야 합니다.");
  }

  const reader = source.getReader();
  let remaining = headBytes;
  /** 경계를 넘어선 조각의 뒷부분. tail 이 맨 처음 받아 간다. */
  let carried: Uint8Array | null = null;

  /** head 가 reader 에서 손을 뗐는가 — tail 은 이것이 풀려야 읽는다(파일 머리말). */
  let releaseTail: () => void = () => {};
  const headFinished = new Promise<void>((resolve) => {
    releaseTail = resolve;
  });

  const head = new ReadableStream<Uint8Array>({
    async pull(controller) {
      // 🔴 **한 번 불릴 때 반드시 내보내거나 닫는다.** 아무것도 안 하고
      //    돌아오면 다시 불리지 않아 그대로 멈춰 선다(파일 머리말).
      for (;;) {
        if (remaining === 0) {
          releaseTail();
          controller.close();
          return;
        }
        const { done, value } = await reader.read();
        if (done) {
          // 선언한 것보다 본문이 짧다. 여기서는 그대로 끝내고, 센 바이트 수로
          // 거절하는 것은 부르는 쪽의 몫이다(파일 머리말).
          remaining = 0;
          releaseTail();
          controller.close();
          return;
        }
        // 빈 조각은 건너뛰고 **이 안에서** 다음 것을 읽는다.
        if (!value || value.byteLength === 0) continue;

        if (value.byteLength <= remaining) {
          remaining -= value.byteLength;
          controller.enqueue(value);
          if (remaining === 0) {
            releaseTail();
            controller.close();
          }
          return;
        }

        // 조각 하나가 경계를 넘었다. subarray 가 아니라 slice 로 베낀다 —
        // 스트림이 넘겨준 버퍼는 다음 조각에서 재사용될 수 있어서, 뷰만 들고
        // 있으면 내용이 뒤바뀐다(local-fs-adapter 의 같은 주의).
        const boundary = remaining;
        carried = value.slice(boundary);
        remaining = 0;
        controller.enqueue(value.slice(0, boundary));
        releaseTail();
        controller.close();
        return;
      }
    },
    cancel(reason) {
      // 앞을 버렸으면 뒤도 더 기다릴 것이 없다 — 풀어 주지 않으면 tail 이 영영
      // 멈춰 선다.
      releaseTail();
      return reader.cancel(reason);
    },
  });

  const tail = new ReadableStream<Uint8Array>({
    async pull(controller) {
      // 🔴 만들어지자마자 한 번 불린다. 여기서 기다리지 않으면 앞쪽 바이트를
      //    가져가 버린다(파일 머리말).
      await headFinished;

      if (carried !== null) {
        const chunk = carried;
        carried = null;
        controller.enqueue(chunk);
        return;
      }
      // head 와 같은 규칙 — 빈 조각에 걸려 멈춰 서지 않게 안에서 돈다.
      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          controller.close();
          return;
        }
        if (!value || value.byteLength === 0) continue;
        controller.enqueue(value);
        return;
      }
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });

  return { head, tail };
}
