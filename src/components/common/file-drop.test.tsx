import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { FileDropZone } from "./FileDropZone";
import {
  FOLDER_ONLY_NOTICE,
  createFileDropHandlers,
  dragCarriesFiles,
  droppedFilesText,
  fileSizeText,
  folderSkippedNotice,
  installFileDropGuard,
  isDroppedFolder,
  planFileDrop,
  tooManyFilesNotice,
  type DragEventLike,
} from "./file-drop";

/**
 * ============================================================================
 * 끌어다 놓기 — 공통 조각이 무엇을 하고 무엇을 하지 않는가
 * ============================================================================
 * file-drop.ts 는 DOM 없이 도는 순수 파일이라 **실제로 돌려 본다**(흉내 낸 이벤트를
 * 넘긴다). 일곱 화면이 이 조각을 제자리에서 부르는지는 file-drop-screens.test.ts 가
 * 원본을 읽어 본다.
 * ============================================================================
 */

function file(name: string, size = 1024): File {
  return { name, size } as unknown as File;
}

/** 폴더는 크기 0 에 확장자가 없다. */
function folder(name: string): File {
  return { name, size: 0 } as unknown as File;
}

type FakeEvent = DragEventLike & { prevented: number; stopped: number };

function dragEvent(files: readonly File[], types: string[] = ["Files"]): FakeEvent {
  const event: FakeEvent = {
    prevented: 0,
    stopped: 0,
    preventDefault() {
      event.prevented += 1;
    },
    stopPropagation() {
      event.stopped += 1;
    },
    dataTransfer: { types, files },
  };
  return event;
}

type Recorder = {
  files: File[][];
  notices: (string | null)[];
  dragging: boolean[];
};

function handlers(options: { multiple: boolean; disabled?: boolean }) {
  const record: Recorder = { files: [], notices: [], dragging: [] };
  const depth = { current: 0 };
  return {
    record,
    depth,
    ...createFileDropHandlers({
      depth,
      disabled: options.disabled ?? false,
      multiple: options.multiple,
      onFiles: (files) => record.files.push(files),
      onNotice: (notice) => record.notices.push(notice),
      setDragging: (dragging) => record.dragging.push(dragging),
    }),
  };
}

// ───────────────────────────── 무엇을 끌고 오는가

describe("파일을 끌고 올 때만 반응한다", () => {
  test("types 에 Files 가 있어야 참 — 글자 끌기는 건드리지 않는다", () => {
    assert.equal(dragCarriesFiles(["Files"]), true);
    assert.equal(dragCarriesFiles(["text/plain", "Files"]), true);
    assert.equal(dragCarriesFiles(["text/plain"]), false);
    assert.equal(dragCarriesFiles([]), false);
    assert.equal(dragCarriesFiles(null), false);
    assert.equal(dragCarriesFiles(undefined), false);
  });

  test("글자를 끌어 놓아도 기본 동작을 막지 않는다 — 입력칸 안의 글자 끌기가 살아 있다", () => {
    const zone = handlers({ multiple: true });
    const event = dragEvent([file("a.png")], ["text/plain"]);
    zone.onDragOver(event);
    zone.onDrop(event);
    assert.equal(event.prevented, 0);
    assert.deepEqual(zone.record.files, []);
  });
});

// ───────────────────────────── 폴더

describe("폴더는 걸러 낸다", () => {
  test("크기 0 에 확장자가 없으면 폴더다 — 크기 0 인 .txt 는 폴더가 아니다", () => {
    assert.equal(isDroppedFolder({ name: "사진모음", size: 0 }), true);
    assert.equal(isDroppedFolder({ name: "빈파일.txt", size: 0 }), false);
    assert.equal(isDroppedFolder({ name: "확장자없음", size: 10 }), false);
  });

  test("파일과 폴더를 함께 놓으면 파일만 받고 폴더는 건너뛰었다고 알린다", () => {
    const plan = planFileDrop([file("a.png"), folder("사진모음")], { multiple: true });
    assert.deepEqual(
      plan.accepted.map((entry) => entry.name),
      ["a.png"]
    );
    assert.equal(plan.notice, folderSkippedNotice(1));
  });

  test("폴더만 놓으면 아무것도 받지 않고 까닭을 말한다 — 조용히 넘어가지 않는다", () => {
    const plan = planFileDrop([folder("사진모음")], { multiple: true });
    assert.deepEqual(plan.accepted, []);
    assert.equal(plan.notice, FOLDER_ONLY_NOTICE);
  });

  test("🔴 크기 0 인 파일은 그대로 넘긴다 — 「빈 파일」이라 말하는 것은 자리마다의 판정이다", () => {
    const plan = planFileDrop([{ name: "빈파일.txt", size: 0 }], { multiple: true });
    assert.equal(plan.accepted.length, 1);
    assert.equal(plan.notice, null);
  });
});

// ───────────────────────────── 하나만 받는 자리

describe("🔴 하나만 받는 자리에 여럿을 놓으면 거절하고 알린다", () => {
  test("첫 하나만 몰래 받지 않는다 — 하나도 받지 않는다", () => {
    const plan = planFileDrop([file("a.pdf"), file("b.pdf")], { multiple: false });
    assert.deepEqual(plan.accepted, []);
    assert.equal(plan.notice, tooManyFilesNotice(2));
  });

  test("하나면 받는다", () => {
    const plan = planFileDrop([file("a.pdf")], { multiple: false });
    assert.equal(plan.accepted.length, 1);
    assert.equal(plan.notice, null);
  });

  test("여럿 받는 자리는 그대로 다 받는다", () => {
    const plan = planFileDrop([file("a.png"), file("b.png"), file("c.png")], { multiple: true });
    assert.equal(plan.accepted.length, 3);
    assert.equal(plan.notice, null);
  });

  test("폴더까지 섞여 있으면 둘 다 말한다", () => {
    const plan = planFileDrop([file("a.pdf"), file("b.pdf"), folder("묶음")], { multiple: false });
    assert.deepEqual(plan.accepted, []);
    assert.equal(plan.notice, `${folderSkippedNotice(1)} ${tooManyFilesNotice(2)}`);
  });

  test("떨구는 자리도 같다 — 알림만 내고 파일은 넘기지 않는다", () => {
    const zone = handlers({ multiple: false });
    zone.onDrop(dragEvent([file("a.pdf"), file("b.pdf")]));
    assert.deepEqual(zone.record.files, []);
    assert.deepEqual(zone.record.notices, [tooManyFilesNotice(2)]);
  });
});

// ───────────────────────────── 브라우저 기본 동작

describe("🔴 브라우저 기본 동작을 막는다", () => {
  test("dragover · drop 둘 다 막는다 — dragover 를 막지 않으면 drop 이 오지도 않는다", () => {
    const zone = handlers({ multiple: true });
    const over = dragEvent([file("a.png")]);
    zone.onDragOver(over);
    assert.equal(over.prevented, 1);
    assert.equal(over.dataTransfer?.dropEffect, "copy");

    const drop = dragEvent([file("a.png")]);
    zone.onDrop(drop);
    assert.equal(drop.prevented, 1);
    assert.equal(drop.stopped, 1);
    assert.deepEqual(
      zone.record.files.map((batch) => batch.map((entry) => entry.name)),
      [["a.png"]]
    );
  });

  test("🔴 꺼져 있어도 막는다 — 못 받는 것과 작성 중이던 내용이 날아가는 것은 다른 일이다", () => {
    const zone = handlers({ multiple: true, disabled: true });
    const over = dragEvent([file("a.png")]);
    const drop = dragEvent([file("a.png")]);
    zone.onDragOver(over);
    zone.onDrop(drop);
    assert.equal(over.prevented, 1);
    assert.equal(drop.prevented, 1);
    assert.deepEqual(zone.record.files, [], "꺼져 있는데 파일을 넘겼다");
  });

  test("🔴 떨구는 자리 밖도 막는다 — 창 전체에 한 벌만 건다", () => {
    const listeners: { type: string; listener: (event: DragEventLike) => void }[] = [];
    const target = {
      addEventListener(type: string, listener: (event: DragEventLike) => void) {
        listeners.push({ type, listener });
      },
      removeEventListener(type: string, listener: (event: DragEventLike) => void) {
        const at = listeners.findIndex((entry) => entry.type === type && entry.listener === listener);
        if (at >= 0) listeners.splice(at, 1);
      },
    };

    const releaseFirst = installFileDropGuard(target);
    const releaseSecond = installFileDropGuard(target);
    assert.deepEqual(
      listeners.map((entry) => entry.type),
      ["dragover", "drop"],
      "떨구는 자리가 둘이어도 한 벌만 건다"
    );

    const outside = dragEvent([file("a.png")]);
    for (const entry of listeners) entry.listener(outside);
    assert.equal(outside.prevented, 2, "창 밖 dragover · drop 을 막지 않았다");

    // 파일이 아닌 끌기는 건드리지 않는다.
    const text = dragEvent([], ["text/plain"]);
    for (const entry of listeners) entry.listener(text);
    assert.equal(text.prevented, 0);

    releaseFirst();
    assert.equal(listeners.length, 2, "아직 남은 자리가 있는데 걷었다");
    releaseSecond();
    assert.equal(listeners.length, 0, "마지막 자리가 사라졌는데 걷지 않았다");
  });
});

// ───────────────────────────── 끌어오는 중임을 보인다

describe("끌어오는 중임이 보인다", () => {
  test("자식 위로 옮겨 가도 깜빡이지 않는다 — 들어온 수를 세어 0 일 때만 끈다", () => {
    const zone = handlers({ multiple: true });
    zone.onDragEnter(dragEvent([file("a.png")]));
    zone.onDragEnter(dragEvent([file("a.png")]));
    zone.onDragLeave(dragEvent([file("a.png")]));
    assert.deepEqual(zone.record.dragging, [true, true], "자식으로 들어갔을 뿐인데 껐다");
    zone.onDragLeave(dragEvent([file("a.png")]));
    assert.deepEqual(zone.record.dragging, [true, true, false]);
  });

  test("떨구면 꺼진다", () => {
    const zone = handlers({ multiple: true });
    zone.onDragEnter(dragEvent([file("a.png")]));
    zone.onDrop(dragEvent([file("a.png")]));
    assert.equal(zone.record.dragging.at(-1), false);
    assert.equal(zone.depth.current, 0);
  });
});

// ───────────────────────────── 받았다고 말해 준다

describe("🔴 놓은 파일의 이름을 되읽어 준다", () => {
  test("크기는 사람이 탐색기에서 보는 단위로 — B · KB · MB", () => {
    assert.equal(fileSizeText(0), "0B");
    assert.equal(fileSizeText(1023), "1023B");
    assert.equal(fileSizeText(1024), "1KB");
    assert.equal(fileSizeText(312 * 1024), "312KB");
    assert.equal(fileSizeText(1024 * 1024 - 1), "1024KB");
    assert.equal(fileSizeText(1024 * 1024), "1.0MB");
    assert.equal(fileSizeText(3.25 * 1024 * 1024), "3.3MB");
  });

  test("🔴 하나면 이름과 크기를 함께 적는다 — 같은 이름의 다른 판을 가르려면 크기가 있어야 한다", () => {
    assert.equal(
      droppedFilesText([{ name: "연락서.xlsm", size: 312 * 1024 }]),
      "놓은 파일: 연락서.xlsm (312KB)"
    );
  });

  test("여럿이면 개수와 이름을 적고, 많으면 외 N개로 줄인다", () => {
    assert.equal(
      droppedFilesText([
        { name: "a.png", size: 1024 },
        { name: "b.png", size: 1024 },
      ]),
      "놓은 파일 2개: a.png · b.png"
    );
    const many = Array.from({ length: 7 }, (_, index) => ({ name: `${index}.png`, size: 1024 }));
    assert.equal(droppedFilesText(many), "놓은 파일 7개: 0.png · 1.png · 2.png · 3.png · 4.png 외 2개");
  });

  test("받은 것이 없으면 적지 않는다", () => {
    assert.equal(droppedFilesText([]), null);
  });

  test("🔴 부르는 쪽에 넘기는 것은 그대로다 — 되읽어 주는 줄이 길을 바꾸지 않는다", () => {
    const zone = handlers({ multiple: false });
    zone.onDrop(dragEvent([file("연락서.xlsm", 4096)]));
    assert.deepEqual(
      zone.record.files.map((batch) => batch.map((entry) => entry.name)),
      [["연락서.xlsm"]]
    );
  });

  test("🔴 못 받았다고 말할 때는 지난번 영수증을 지운다 — 거짓이 화면에 남지 않게", () => {
    const zone = readFileSync("src/components/common/FileDropZone.tsx", "utf8").replace(/\s+/g, " ");
    assert.ok(zone.includes("setReceived(droppedFilesText(files));"), "받은 것을 적지 않는다");
    assert.ok(zone.includes("if (next !== null) setReceived(null);"), "못 받았을 때 지우지 않는다");
    assert.ok(
      zone.includes('if (target?.type === "file") setReceived(null);'),
      "고르기 칸을 쓸 때 지우지 않는다 — 보낼 파일과 적힌 파일이 갈린다"
    );
    assert.ok(zone.includes('data-role="file-drop-received"'), "되읽어 주는 줄을 그리지 않는다");
    assert.ok(zone.includes('role="status"'), "화면 낭독기에 들리지 않는다");
  });
});

// ───────────────────────────── 그려지는 모양

describe("떨구는 자리의 모양", () => {
  test("자리 이름을 남기고 자식을 그대로 그린다 — 고르기 칸을 새로 만들지 않는다", () => {
    const html = renderToStaticMarkup(
      <FileDropZone name="시험자리" multiple onFiles={() => {}}>
        <p>안쪽</p>
      </FileDropZone>
    );
    assert.ok(html.includes('data-file-drop="시험자리"'), html);
    assert.ok(html.includes("<p>안쪽</p>"), html);
    assert.ok(!html.includes('type="file"'), "공통 조각이 파일 칸을 새로 만들었다");
    // 처음에는 끌어오는 중이 아니다.
    assert.ok(!html.includes("data-dragging"), html);
    // 아직 받은 것이 없으니 영수증도 없다.
    assert.ok(!html.includes("file-drop-received"), html);
  });
});
