import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { splitStreamAt } from "./split-stream";

/**
 * ============================================================================
 * 한 본문에 실려 온 두 파일이 섞이지 않는가
 * ============================================================================
 * 돌린 사진을 저장할 때 본문은 `[썸네일][돌린 원본]` 한 덩어리다. 경계를 한
 * 바이트라도 잘못 세면 **원본 앞에 썸네일 꼬리가 붙는다** — 그러면 앞머리 대조는
 * 통과하는데(앞머리는 멀쩡하다) 파일이 깨진 채로 원본을 덮어쓴다. 되돌릴 수 없는
 * 고장이라 여기서 바이트로 못박는다.
 * ============================================================================
 */

function streamOf(...chunks: number[][]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(Uint8Array.from(chunk));
      controller.close();
    },
  });
}

async function collect(stream: ReadableStream<Uint8Array>): Promise<number[]> {
  const out: number[] = [];
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    out.push(...value);
  }
  return out;
}

describe("경계에서 정확히 갈린다", () => {
  test("조각 하나가 경계를 넘을 때 — 남은 뒷부분이 뒤로 간다", async () => {
    const { head, tail } = splitStreamAt(streamOf([1, 2, 3, 4, 5, 6, 7]), 3);
    assert.deepEqual(await collect(head), [1, 2, 3]);
    assert.deepEqual(await collect(tail), [4, 5, 6, 7]);
  });

  test("경계가 조각 사이에 딱 맞을 때", async () => {
    const { head, tail } = splitStreamAt(streamOf([1, 2], [3, 4], [5]), 4);
    assert.deepEqual(await collect(head), [1, 2, 3, 4]);
    assert.deepEqual(await collect(tail), [5]);
  });

  test("여러 조각을 지나 갈릴 때 — 한 바이트도 새거나 겹치지 않는다", async () => {
    const { head, tail } = splitStreamAt(streamOf([1, 2], [3, 4], [5, 6], [7, 8, 9]), 5);
    const headBytes = await collect(head);
    const tailBytes = await collect(tail);
    assert.deepEqual(headBytes, [1, 2, 3, 4, 5]);
    assert.deepEqual(tailBytes, [6, 7, 8, 9]);
    assert.deepEqual([...headBytes, ...tailBytes], [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  test("경계가 0 이면 앞은 비고 전부가 뒤로 간다", async () => {
    const { head, tail } = splitStreamAt(streamOf([1, 2, 3]), 0);
    assert.deepEqual(await collect(head), []);
    assert.deepEqual(await collect(tail), [1, 2, 3]);
  });
});

describe("모자라거나 어긋날 때", () => {
  test("🔴 본문이 선언보다 짧으면 앞이 짧게 끝나고 뒤는 빈다 — 던지지 않는다", async () => {
    // 여기서 던지지 않는 까닭은 **센 바이트로 거절하는 자리가 따로** 있어서다
    // (rotation-payload 의 PAYLOAD_TRUNCATED). 이 시험은 그때 뒤 덩어리가 0바이트가
    // 되어 「빈 원본」으로 확실히 걸린다는 것을 못박는다.
    const { head, tail } = splitStreamAt(streamOf([1, 2, 3]), 10);
    assert.deepEqual(await collect(head), [1, 2, 3]);
    assert.deepEqual(await collect(tail), []);
  });

  test("본문이 아예 비어 있어도 둘 다 조용히 끝난다", async () => {
    const { head, tail } = splitStreamAt(streamOf(), 4);
    assert.deepEqual(await collect(head), []);
    assert.deepEqual(await collect(tail), []);
  });

  test("빈 조각이 섞여 있어도 바이트는 그대로다", async () => {
    const { head, tail } = splitStreamAt(streamOf([], [1, 2], [], [3, 4]), 2);
    assert.deepEqual(await collect(head), [1, 2]);
    assert.deepEqual(await collect(tail), [3, 4]);
  });

  test("가를 위치가 음수거나 정수가 아니면 던진다", () => {
    assert.throws(() => splitStreamAt(streamOf([1]), -1), TypeError);
    assert.throws(() => splitStreamAt(streamOf([1]), 1.5), TypeError);
  });
});
