import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * ============================================================================
 * 「기술 작업 절차」 편집기 — **구조 변경도 [저장]을 눌러야 저장된다** (2026-11-20, 조각 4)
 * ============================================================================
 * 쓰는 분의 요청(원문): 「노드·연결선 추가·삭제·재연결은 [저장] 없이 바로
 * 저장되는데, 그것들도 [저장]을 눌러야 저장되도록 해 달라.」
 *
 * 조각 1~3 이 만든 순수 도메인 셋(모아 두기 · 보내는 길 · 되돌리기)은 저마다
 * 값으로 시험이 있다(unit 목록). **이 파일이 재는 것은 화면이 그 셋을 제대로 물고
 * 있는가** 하나다 — 그 글루가 이번 일에서 유일하게 시험 없는 자리였고, 조각 1~3 이
 * 주석으로 「조각 4 가 여기서 걸린다」고 적어 둔 자리가 전부 여기다.
 *
 * ── 🔴 여기서 가장 조용히 깨지는 것 ─────────────────────────────────────
 *  ① 모아 두기만 하고 **[저장]에 안 세면** 단추가 꺼져 한 건도 안 나간다.
 *  ② 미리보기를 안 섞으면 **화면에 아무 일도 안 일어난다**(서버 목록만 돈다).
 *  ③ 되돌리기 서명에 구조 목록을 안 섞으면 **그 한 칸이 조용히 버려진다**.
 *  ④ 막 생긴 노드의 **정렬 번호 0 이 서버 값을 덮어쓴다**.
 *  ⑤ 부분 실패에서 **남은 조작과 네 지도를 따로** 손보면 어긋난다.
 * 다섯 다 오류가 안 나고, 넷은 화면에서도 티가 잘 안 난다.
 *
 * ── 왜 렌더가 아니라 원본을 읽는가 ──────────────────────────────────────
 * ProcedureTemplateEditorScreen 은 @xyflow/react 의 .css 와 서버 액션
 * (→ server-only)을 사슬로 물고 있어 어느 목록에서도 import 자체가 던진다.
 * 이웃들(procedure-template-editor-undo.test.ts · procedure-editor-confirm-dialogs.test.ts)
 * 이 같은 사정에서 쓴 방법 그대로다.
 *
 * ── 🔴 주석을 걷어내고 센다 ─────────────────────────────────────────────
 * 이번 변경의 주석에는 **고치기 전의 모습과 옛 문구가 글자 그대로** 들어 있다.
 * 안 걷으면 「사라졌는가」 쪽이 영영 깨지고 「있어야 한다」 쪽은 주석만으로 영영
 * 통과한다. ①절의 마지막 단언이 걷어내기가 실제로 일한다는 증거다.
 * ============================================================================
 */

const repoUrl = new URL("../../../", import.meta.url);
const read = (relativePath: string) => readFileSync(new URL(relativePath, repoUrl), "utf8");

function stripComments(source: string): string {
  return source
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, " ") // JSX 주석 {/* ... */}
    .replace(/\/\*[\s\S]*?\*\//g, " ") // 블록 주석
    .split(/\r?\n/)
    .filter((line) => !/^\s*\/\//.test(line)) // 줄 주석
    .join("\n");
}

/** 줄바꿈·들여쓰기 차이로 시험이 깨지지 않도록 공백을 하나로 접는다. */
const flat = (source: string) => source.replace(/\s+/g, " ");

const PATHS = {
  screen: "src/components/procedures/ProcedureTemplateEditorScreen.tsx",
  nodePanel: "src/components/procedures/editor/NodePropertyPanel.tsx",
  edgePanel: "src/components/procedures/editor/EdgePropertyPanel.tsx",
} as const;

const screenRaw = read(PATHS.screen);
const screen = stripComments(screenRaw);
const f = flat(screen);
const nodePanel = flat(stripComments(read(PATHS.nodePanel)));
const edgePanel = flat(stripComments(read(PATHS.edgePanel)));

/** 어떤 글자 뒤 `window` 글자 안에 또 다른 글자가 있는가 — 함수 몸통을 괄호로 잘라 낼 수 없는 자리에서 쓴다. */
function nearAfter(haystack: string, anchor: string, needle: string, window = 900): boolean {
  const at = haystack.indexOf(anchor);
  if (at === -1) return false;
  return haystack.slice(at, at + window).includes(needle);
}

describe("저장 전 구조 변경 — ① 먼저 표본 확인", () => {
  test("🔵 파일이 읽혔고, 재려는 손잡이가 실제로 거기 있다", () => {
    for (const [name, source] of Object.entries({ screen, nodePanel, edgePanel })) {
      assert.ok(source.length > 2000, `${name} 이 비어 있거나 너무 짧다 — 경로가 틀리면 아래 단언이 전부 공짜로 통과한다`);
    }
    assert.ok(screen.includes("async function handleGlobalSave()"), "[저장]의 본체");
    assert.ok(screen.includes("function queueStructural("), "모아 두는 통로");
    assert.ok(screen.includes("async function executeStructuralOperation("), "한 건을 서버로 보내는 자리");
    assert.ok(screen.includes("const structuralPreview = useMemo("), "저장 전 미리보기");
  });

  test("🔴 주석 걷어내기가 실제로 일을 한다 — 날것에는 옛 문구와 경위가 남아 있다", () => {
    assert.ok(screenRaw.includes("[저장] 없이 바로 저장됩니다"), "뒤집기 전 문구가 주석에 경위로 남아 있어야 한다");
    assert.ok(!screen.includes("[저장] 없이 바로 저장됩니다"), "걷어낸 쪽에는 없어야 한다 — 코드에 남아 있으면 화면이 거짓말을 한다");
  });
});

describe("저장 전 구조 변경 — ② 모아 두는 길(조각 1·3 과의 이음새)", () => {
  test("🔴 임시 번호를 찍는 길이 **appendPendingStructuralOperations 하나**다", () => {
    // 🔴 도장(createTempIdMinter)을 화면이 직접 만들면 렌더마다 1 부터 다시 세어
    //    같은 번호가 두 번 나간다. 그러면 접기가 서로 다른 두 노드를 한 덩어리로
    //    보고, 하나를 지울 때 다른 하나가 같이 사라진다(오류는 한 번도 안 난다).
    assert.ok(f.includes("appendPendingStructuralOperations(prev, build)"));
    assert.ok(!screen.includes("createTempIdMinter"), "화면이 도장을 직접 만들면 번호가 겹친다");
    assert.ok(!screen.includes("makeTempNodeId"), "번호 글자 규칙을 화면이 다시 적으면 안 된다");
    assert.ok(!screen.includes("makeTempEdgeId"));
  });

  test("🔴 연결선 위 노드 끼우기는 **한 도장에서 번호를 둘** 받는다", () => {
    // 🔴 두 번 나눠 부르면 그 사이에 목록이 바뀌어 번호가 어긋난다
    //    (appendPendingStructuralOperations 가 build 를 **목록**으로 받는 까닭).
    assert.ok(
      nearAfter(f, "function handleQueueInsertNodeOnEdge(", "tempNodeId: mint.nextNodeId(), tempSecondEdgeId: mint.nextEdgeId(),"),
      "삽입이 노드 번호와 둘째 연결선 번호를 한 자리에서 안 받는다"
    );
  });

  test("🔴 확인 창·사유 칸이 받는 **사유가 조작에 실린다** — 안 실으면 이력에서 조용히 사라진다", () => {
    // 🔵 일곱 가운데 사유를 받는 것은 다섯이다(끼우기는 서버도 사유를 안 받는다).
    assert.ok(nearAfter(f, "function handleQueueChangeNodeType(", 'kind: "CHANGE_NODE_TYPE", nodeId, newNodeType, reason'));
    // 🔴 2026-11-21 — 노드 삭제는 줄을 **화면이 직접 안 적는다.** 붙은 연결선까지
    //    함께 쌓게 되면서 그 일이 순수 판정으로 옮겨 갔다
    //    (procedure-editor-node-deletion.ts). 여기서 재는 것은 **사유가 그쪽으로
    //    넘어가는가** 하나이고, 그 사유가 노드 줄과 선 줄 **모두**에 실리는지는
    //    unit 목록의 procedure-editor-node-deletion.test.ts ③절이 값으로 잰다.
    assert.ok(nearAfter(f, "function handleQueueDeleteNode(", "planProcedureNodeDeletionOperations(renderedEdges, nodeId, reason)"));
    assert.ok(nearAfter(f, "function handleQueueDeleteEdge(", 'kind: "DELETE_EDGE", edgeId, reason'));
    assert.ok(nearAfter(f, "function handleQueueRetargetEdge(", 'kind: "RETARGET_EDGE", edgeId, newFromNodeId, newToNodeId, reason'));
    assert.ok(nearAfter(f, "function handleQueueCreateEdge(", "reason: input.reason,"));
  });

  test("🔴 지우면 그 행의 **초안도 함께 버린다** — 안 버리면 없는 행을 고치려 든다", () => {
    assert.ok(nearAfter(f, "function handleQueueDeleteNode(", "setPendingNodeFieldDraftsById((prev) =>"));
    assert.ok(nearAfter(f, "function handleQueueDeleteNode(", "setPendingLayoutMoves((prev) =>"));
    assert.ok(nearAfter(f, "function handleQueueDeleteEdge(", "setPendingEdgeFieldDraftsById((prev) =>", 1400));
    assert.ok(nearAfter(f, "function handleQueueDeleteEdge(", "setPendingEdgeRouteMoves((prev) =>", 1400));
    assert.ok(nearAfter(f, "function handleQueueDeleteEdge(", "setPendingEdgeSaveNoteById((prev) =>", 1600));
    // 🔵 그래도 되돌리면 함께 돌아온다 — 통로가 **버리기 전에** 한 칸을 찍기 때문이다.
    const body = flat(screen.slice(screen.indexOf("function queueStructural(")));
    assert.ok(body.indexOf("pushPendingUndoStep();") < body.indexOf("setPendingStructuralOperations("));
  });
});

describe("저장 전 구조 변경 — ③ 그림에 미리 그린다", () => {
  test("🔴 두 목록이 **미리보기**를 돈다 — 서버 목록만 돌면 추가한 노드가 화면에 아예 안 뜬다", () => {
    assert.ok(f.includes("const renderedNodes: EditorNodeRow[] = useMemo( () => structuralPreview.nodes.map((n) => {"));
    assert.ok(f.includes("const renderedEdges: EditorEdgeRow[] = useMemo( () => structuralPreview.edges.map((e) => {"));
  });

  test("🔴 미리보기에 **「방금 보낸 것」도 함께** 얹는다 — 부분 실패에서 새 노드가 화면에서 사라진다", () => {
    // 🔴 보낸 조작은 모아 둔 목록에서 빠지는데(다시 보내면 두 번 만들어진다),
    //    화면은 부분 실패에서 router.refresh() 를 안 부른다 — 목록에도 없고 서버
    //    목록에도 없는 틈이 생긴다. 그래서 그림자 목록을 하나 더 들고 얹는다.
    assert.ok(f.includes("const previewOperations = useMemo( () => [...justSavedStructuralOperations, ...pendingStructuralOperations],"));
    assert.ok(f.includes("setJustSavedStructuralOperations((prev) => [...prev, ...structuralOutcome.succeededOperations]);"));
    // 🔵 비우는 자리는 다른 그림자 넷과 똑같다 — 진짜 새로고침이 닿으면 거짓이 된다.
    assert.ok(nearAfter(f, "if (template.updatedAt !== prevTemplateUpdatedAt) {", "setJustSavedStructuralOperations([]);"));
  });

  test("🔴 **받침이 둘**이다 — 저장 전 행은 미리보기 행 자체가 받침이어야 패널이 제목을 안 비운다", () => {
    // 🔴 안 세우면 nodeFieldDraft 가 `server?.title ?? ""` 로 떨어져, 방금 적은
    //    제목이 속성 패널에서만 사라진다(그림에는 그대로 있다 — 더 헷갈린다).
    assert.ok(f.includes("const source = templateNodeById.get(previewNode.id) ?? previewNode;"));
    assert.ok(f.includes("const source = templateEdgeById.get(previewEdge.id) ?? previewEdge;"));
  });

  test("🔴 저장 전 **연결선에서도** 곧게 펴기·경로점 추가가 산다", () => {
    assert.ok(f.includes("const edge = renderedEdges.find((e) => e.id === edgeId);"));
    assert.ok(f.includes("const edge = renderedEdges.find((e) => e.id === selectedEdgeId);"));
    assert.ok(!f.includes("template.edges.find("), "서버 목록을 뒤지면 저장 전 연결선에서 죽는다");
  });
});

describe("저장 전 구조 변경 — ④ 막는 것과 좁히는 것", () => {
  test("🔴 **아직 저장 안 된 연결선 위 끼우기**는 그 조작 자체를 막는다 — 저장을 통째로 막는 것보다 낫다", () => {
    assert.ok(
      f.includes('insertNodeBlockedReason={ isTempEdgeId(selectedEdge.id) ? "이 연결선은 아직 저장 전이라 노드를 끼울 수 없습니다. 먼저 [저장]한 뒤에 해 주세요." : null }'),
      "막는 자리가 없으면 그 조작이 목록에 들어가 [저장]이 통째로 멈춘다"
    );
    assert.ok(edgePanel.includes("disabled={selectedWaypointIndex === null || insertNodeBlockedReason !== null}"));
    assert.ok(edgePanel.includes("{canEdit && canInsertNode && insertNodeBlockedReason && <p"), "흐린 단추만 두면 고장으로 읽힌다");
  });

  test("🔴 **아직 안 만든 노드의 유형 고르개는 일곱**이다 — 아홉 중 둘은 새로 만들 수가 없다", () => {
    // 🔴 [체크리스트]·[고장 진단표]를 고를 수 있게 두면 접기가
    //    TEMP_NODE_TYPE_NOT_CREATABLE 로 올려 [저장]이 통째로 막힌다.
    assert.ok(nodePanel.includes("const nodeTypeOptions = isUnsavedNode ? MANUAL_TECHNICAL_NODE_TYPE_CODES : PROCEDURE_NODE_TYPE_CODES;"));
    assert.ok(nodePanel.includes("{nodeTypeOptions.map((t) => ("), "좁힌 목록을 세어 놓고 안 쓰면 아무것도 안 바뀐다");
    assert.ok(!nodePanel.includes("{PROCEDURE_NODE_TYPE_CODES.map((t) => ("), "아홉을 그대로 그리고 있다");
    // 화면이 「저장 전인가」를 제대로 넘기는가.
    assert.ok(f.includes("isUnsavedNode={unsavedNodeIds.has(selectedNode.id)}"));
    assert.ok(f.includes("const unsavedNodeIds = useMemo(() => new Set(structuralPreview.nodes.filter((n) => isTempNodeId(n.id)).map((n) => n.id)), [structuralPreview.nodes]);"));
  });

  test("🔴 **서버가 거절할 노드 삭제**는 미리 막고 까닭을 적는다 — 그림에서 먼저 사라져 보이기 때문이다", () => {
    // 🔴 서버는 전부터 NODE_HAS_DEPENDENT_CONTENT 로 거절했다. 즉시 저장하던
    //    시절에는 누르는 즉시 그 글이 떴지만, 모아 두는 지금은 [저장]을 누를
    //    때까지 모르고 그 사이 노드는 그림에서 사라져 보인다.
    //
    // 🔴 2026-11-21 — **까닭 둘 중 하나가 없어졌다.** 「연결선 N개가 붙어 있어
    //    삭제할 수 없습니다」는 쓰는 분 결정으로 걷어냈다(「노드를 지우면 연결된
    //    연결선도 함께 지워지는 걸로 하자 — 연결선을 지우지 않아도 노드를 지울 수
    //    있도록」). 막음 자체가 사라진 것이 아니라 **까닭 하나가 빠진 것**이라,
    //    아래는 「남은 까닭이 아직 막는가」와 「없어진 까닭이 정말 없는가」를 함께 잰다.
    //    바뀐 쪽을 값으로 재는 것은 unit 목록의 procedure-editor-node-deletion.test.ts.
    // 🔴 2026-11-21(조각 B3) — **셈이 순수 모듈로 나갔다.** 조건도 글자도 한 글자
    //    안 바뀌었고 자리만 옮겼다([범위 선택]으로 고른 여럿을 지우면서 같은 질문을
    //    노드마다 하게 됐다 — 규칙이 두 벌이 되면 패널과 키가 다른 말을 한다).
    //    막음 자체가 아직 사는지는 **그 함수를 부르는가**로 잰다.
    assert.ok(f.includes("const selectedNodeDeleteBlockedReason: string | null = resolveProcedureNodeDeleteBlockedReason(selectedNode);"));
    assert.ok(
      stripComments(read("src/lib/domain/procedure-editor-node-deletion.ts")).includes("if (node.hasChecklistContent || node.hasTroubleshootingContent) {"),
      "남은 까닭 하나"
    );
    assert.ok(!f.includes("const attached = renderedEdges.filter((e) => e.fromNodeId === selectedNode.id || e.toNodeId === selectedNode.id).length;"), "선을 세어 막는 줄이 남아 있다");
    assert.ok(!screen.includes("붙어 있어 삭제할 수 없습니다"), "막는 글이 아직 화면에 있다");
    assert.ok(f.includes("deleteBlockedReason={selectedNodeDeleteBlockedReason}"));
    assert.ok(nodePanel.includes("disabled={deleteBlockedReason !== null}"));
    assert.ok(nodePanel.includes("{deleteBlockedReason && <p"), "까닭을 안 적으면 흐린 단추가 고장으로 읽힌다");
  });
});

describe("저장 전 구조 변경 — ⑤ [저장]의 차례", () => {
  test("🔴 **구조가 먼저, 칸 값이 나중**이고 그 사이에 지도를 옮긴다", () => {
    const body = flat(screen.slice(screen.indexOf("async function handleGlobalSave()")));
    const order = [
      "runProcedureStructuralSequence<StructuralValidationSummary>(",
      "collectStructuralIdEffects(structuralOutcome)",
      "rebaseDraftMapAfterStructuralSave(pendingNodeFieldDraftsById, effects, \"node\")",
      "includeBrandNewDraftEntries(",
      "planProcedureSaveSteps({",
      "runProcedureSaveSequence(steps, tokenAfterStructural, executeStep)",
    ];
    let cursor = -1;
    for (const step of order) {
      const at = body.indexOf(step, cursor + 1);
      assert.ok(at > cursor, `차례가 어긋났다 — ${step} 이 앞 걸음보다 먼저다(또는 없다)`);
      cursor = at;
    }
  });

  test("🔴 **남은 조작 세우기와 지도 옮기기를 함께** 한다 — 하나만 하면 어긋난다", () => {
    // 🔴 목록만 바꾸면 초안이 임시 키를 든 채 남아 영영 안 가고(세는 쪽이 서버
    //    스냅숏에 없는 id 를 조용히 건너뛴다), 지도만 옮기면 이미 보낸 조작을
    //    다시 보내 같은 노드가 두 번 만들어진다.
    assert.ok(f.includes("setPendingStructuralOperations(structuralOutcome.remainingOperations);"));
    for (const map of [
      'rebaseDraftMapAfterStructuralSave(pendingNodeFieldDraftsById, effects, "node")',
      'rebaseDraftMapAfterStructuralSave(pendingLayoutMoves, effects, "node")',
      'rebaseDraftMapAfterStructuralSave(pendingEdgeFieldDraftsById, effects, "edge")',
      'rebaseDraftMapAfterStructuralSave(pendingEdgeRouteMoves, effects, "edge")',
      'rebaseDraftMapAfterStructuralSave(pendingEdgeSaveNoteById, effects, "edge")',
    ]) {
      assert.ok(f.includes(map), `${map} 가 빠졌다`);
    }
  });

  test("🔴 칸 값 단계는 **옮긴 뒤의 지역 지도**를 읽는다 — state 를 읽으면 옛 키를 본다", () => {
    // 🔴 setState 는 다음 렌더에야 닿는다. 같은 함수 안에서 state 를 다시 읽으면
    //    임시 id 가 그대로 남아 그 줄이 통째로 건너뛰어진다(오류는 안 난다).
    const body = flat(screen.slice(screen.indexOf("async function executeStep(step: ProcedureSaveStep")));
    assert.ok(body.includes("const draft = nodeDrafts.get(step.nodeId) ?? nodeFieldDraft(step.nodeId);"));
    assert.ok(body.includes("const draft = edgeDrafts.get(step.edgeId) ?? edgeFieldDraft(step.edgeId);"));
    assert.ok(body.includes("const pos = layoutMoves.get(nodeId)!;"));
    assert.ok(body.includes("points: routeMoves.has(edgeId) ? (routeMoves.get(edgeId) ?? null) : null"));
  });

  test("🔴 구조가 중간에 멈추면 **칸 값 단계로 안 넘어간다**", () => {
    // 🔴 넘어가면 실패 메시지가 둘이 되고, 둘째 단계가 쓰는 토큰과 id 가 어디까지
    //    맞는지 사람이 읽을 수 없다. 🔵 넘어가지 않아도 잃는 것은 없다.
    assert.ok(f.includes("if (!canProceedToFieldSave(structuralOutcome)) {"));
    assert.ok(nearAfter(f, "if (!canProceedToFieldSave(structuralOutcome)) {", "return;"));
  });

  test("🔴 토큰을 이어 넘긴다 — 화면이 들고 있던 값은 구조 단계가 서버를 건드린 순간 낡았다", () => {
    assert.ok(f.includes("tokenAfterStructural = structuralOutcome.finalUpdatedAt;"));
    assert.ok(f.includes("runProcedureSaveSequence(steps, tokenAfterStructural, executeStep)"));
  });

  test("🔴 검증 요약은 **더 나중 것**이 이긴다 — 칸 값 단계가 뒤라 그쪽이 더 새 사진이다", () => {
    const body = flat(screen.slice(screen.indexOf("setCurrentUpdatedAt(outcome.finalUpdatedAt);")));
    const fromStructural = body.indexOf("if (structuralValidationFromStructuralPhase) setLastStructuralValidation(structuralValidationFromStructuralPhase);");
    const fromFields = body.indexOf("if (capturedStructuralValidation) setLastStructuralValidation(capturedStructuralValidation);");
    assert.ok(fromStructural !== -1 && fromFields !== -1, "둘 중 하나가 없으면 요약이 한쪽만 반영된다");
    assert.ok(fromStructural < fromFields, "차례가 뒤집히면 저장이 끝난 화면에 구조 단계 중간의 낡은 요약이 선다");
  });

  test("🔴 보내는 함수가 **돌려받는 id 를 빠짐없이** 거둔다 — 특히 삽입은 **둘**이다", () => {
    const body = flat(screen.slice(screen.indexOf("async function executeStructuralOperation(")));
    assert.ok(body.includes("{ ok: true, updatedAt: result.updatedAt, nodeId: result.nodeId }"), "CREATE_NODE 의 새 id");
    assert.ok(body.includes("edgeId: result.edgeId, structuralValidation: result.structuralValidation"), "CREATE_EDGE 의 새 id");
    assert.ok(
      body.includes("{ ok: true, updatedAt: result.updatedAt, nodeId: result.nodeId, secondEdgeId: result.secondEdgeId }"),
      "삽입은 id 를 둘 돌려준다 — 하나만 거두면 뒤 걸음이 임시 id 를 든 채 나간다"
    );
    // 🔵 firstEdgeId 는 넘긴 edgeId 그 자체(이미 진짜 id)라 안 받는다.
    assert.ok(!body.includes("firstEdgeId: result.firstEdgeId"));
  });
});

describe("저장 전 구조 변경 — ⑥ 막 생긴 행의 칸 값", () => {
  test("🔴 막 생긴 id 는 초안이 있으면 **무조건 보낸다** — 안 그러면 설명·요약이 소리 없이 사라진다", () => {
    // 🔴 세는 함수들은 서버 스냅숏과 맞대어 재는데, 방금 만든 행은 그 스냅숏에
    //    아직 없다(화면을 새로 받아오기 전이다). 없으면 조용히 건너뛴다.
    assert.ok(f.includes("includeBrandNewDraftEntries( computeDirtyProcedureNodeFieldEntries(nodeDrafts, serverNodesById), brandNewNodeIds, nodeDrafts )"));
    assert.ok(f.includes("includeBrandNewDraftEntries( computeDirtyProcedureEdgeFieldEntries(edgeDrafts, serverEdgesById), brandNewEdgeIds, edgeDrafts )"));
    assert.ok(f.includes("includeBrandNewDraftIds(computeDirtyProcedurePositionNodeIds(layoutMoves, serverNodesById), brandNewNodeIds, layoutMoves)"));
    assert.ok(f.includes("includeBrandNewDraftIds(computeDirtyProcedureRouteEdgeIds(routeMoves, serverEdgesById), brandNewEdgeIds, routeMoves)"));
  });

  test("🔴 **정렬 번호는 막 생긴 노드에 안 보낸다** — 받침 0 이 서버가 매긴 번호를 덮어쓴다", () => {
    // 🔴 서버는 새 노드에 「맨 뒤 + 1」을 매긴다. 화면의 초안은 서버 스냅숏이 없을
    //    때 0 으로 받침을 세우는데, 위 「무조건 보낸다」와 만나면 그 0 이 그대로
    //    올라간다. 오류도 안 나고 「저장됐습니다」까지 뜬다.
    assert.ok(
      f.includes("...(brandNewNodeIdSet.has(step.nodeId) ? {} : { sortOrder: draft.sortOrder }),"),
      "막 생긴 노드의 정렬 번호가 0 으로 되돌아간다"
    );
    assert.ok(f.includes("const brandNewNodeIdSet = new Set(brandNewNodeIds);"));
  });

  test("🔴 못 보내는 칸은 **화면에서도 잠근다** — 고칠 수 있게 두면 고친 값이 조용히 사라진다", () => {
    assert.ok(nodePanel.includes("disabled={!canEdit || isUnsavedNode}"));
    assert.ok(
      nodePanel.includes("{isUnsavedNode && <p className=\"mt-2\">정렬 순서는 [저장]할 때 서버가 맨 뒤 번호로 매깁니다. 저장한 뒤에 고칠 수 있습니다.</p>}"),
      "잠그기만 하고 까닭을 안 적으면 고장으로 읽힌다"
    );
  });
});
