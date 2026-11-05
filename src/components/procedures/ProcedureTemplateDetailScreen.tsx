"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import ProcedureFlowGraph from "./ProcedureFlowGraph";
import ProcedureChecklistViewer from "./ProcedureChecklistViewer";
import ProcedureTroubleshootingViewer from "./ProcedureTroubleshootingViewer";
import ProcedureReferenceItemsViewer from "./ProcedureReferenceItemsViewer";
import ProcedureValidationIssuePanel from "./ProcedureValidationIssuePanel";
import CreateDraftVersionButton from "./editor/CreateDraftVersionButton";
import PublishTemplateButton from "./editor/PublishTemplateButton";
import DeleteProcedureVersionButton from "./editor/DeleteProcedureVersionButton";
import ProcedureVersionList, { type ProcedureVersionListRow } from "./ProcedureVersionList";
import {
  procedureEquipmentTypeLabels,
  procedureTemplateSourceTypeLabels,
  procedureTemplateStatusLabels,
} from "@/lib/domain/procedure-template-types";
import type { ProcedureTemplateDetail } from "@/lib/db/queries/procedure-templates";
import { resolveInitialGraphTarget } from "@/lib/domain/procedure-graph-navigation";
import {
  canPublishFromProcedureStatus,
  pickPublishedSiblingsToExpire,
} from "@/lib/domain/procedure-template-publish-policy";
import { resolveProcedureListLink } from "@/lib/domain/procedure-list-navigation";

const STATUS_BADGE: Record<string, string> = {
  DRAFT: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  PUBLISHED: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400",
  ARCHIVED: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-500",
};

function formatDate(iso: string | null): string {
  if (!iso) return "-";
  return new Date(iso).toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short" });
}

/**
 * Read-only template detail — no editing anywhere on this screen (Phase 2
 * scope). Renders whichever of the three imported content shapes the
 * template actually has: a shape-graph (edges present), a checklist
 * (checklistSections present), and/or a troubleshooting matrix
 * (troubleshootingEntries present) — a future combined template could in
 * principle carry more than one, so these are independent, not
 * mutually-exclusive branches.
 */
export default function ProcedureTemplateDetailScreen({
  template,
  versions = [],
  canManageValidation,
  canCreateDraftVersion = false,
  canEditDraft = false,
  canPublish = false,
  canDeleteVersion = false,
  referencedVersionIds = [],
}: {
  template: ProcedureTemplateDetail;
  /**
   * 같은 code 줄기의 판 전부 — 판 번호 내림차순. **볼 수 있는 것만** 넘어온다
   * (페이지가 거른다). 빈 배열이면 [버전 목록]을 아예 안 그린다.
   */
  versions?: ProcedureVersionListRow[];
  canManageValidation: boolean;
  /** Phase 4A — "새 DRAFT 버전 만들기" from a PUBLISHED template. */
  canCreateDraftVersion?: boolean;
  /** Phase 4A — "편집 시작" straight into the controlled editor for an already-editable DRAFT. */
  canEditDraft?: boolean;
  /**
   * "게시" — DRAFT 를 게시해 A/S 접수 건의 "기술 절차 불러오기" 목록에 올린다.
   *
   * 이 값은 페이지가 **서버가 실제로 보는 관문 그대로** 계산해서 넘긴다
   * (page.tsx 의 canPublish 주석 참조). 🔵 이 값은 **권한만** 말한다 — 상태로
   * 가리는 일은 아래 canPublishFromProcedureStatus 가 한다. 2026-11-04 부터
   * 만료본(ARCHIVED)도 올릴 수 있으므로, 막히는 상태는 PUBLISHED 하나다.
   */
  canPublish?: boolean;
  /**
   * [버전 목록]의 [삭제] — **권한만** 말한다(2026-11-04). 어느 줄에 단추가
   * 서는지는 상태와 참조가 정하고, 그 규칙은 domain/procedure-version-deletion.ts
   * 한 곳에 있다. 🔵 기본값이 false 라 안 넘기는 호출부에는 삭제 자리가 없다.
   */
  canDeleteVersion?: boolean;
  /** 다른 곳에서 쓰이고 있어 지울 수 없는 판의 id 들(서버가 세어 넘긴다 — 수행 기록 · 후속 버전 · 이어가기). */
  referencedVersionIds?: string[];
}) {
  // 이번 게시에 딸려 [만료됨]으로 내려갈 판 번호들 — 확인 창이 "무엇이
  // 내려가는지"를 번호로 말할 수 있게 한다. 🔴 고르는 규칙은 서버가 쓰는 것과
  // **같은 함수**다(pickPublishedSiblingsToExpire). 여기서 따로 걸러 적으면
  // 창에 적힌 판과 실제로 내려가는 판이 다른 날이 온다.
  //
  // 🔵 versions 는 **볼 수 있는 판만** 넘어오지만(페이지가 거른다), 게시본은
  // 어느 역할이든 볼 수 있으므로 이 목록은 비어서 모자라지 않는다.
  const expiringPublishedVersions = pickPublishedSiblingsToExpire(versions, template.id).map(
    (row) => row.version
  );

  // 목록으로 나가는 길 — 분류가 정한다(아래 Link 의 주석).
  const listLink = resolveProcedureListLink(template.category);

  const hasGraph = template.edges.length > 0 || template.nodes.some((n) => n.nodeType !== "CHECKLIST" && n.nodeType !== "TROUBLESHOOTING");
  const hasChecklist = template.checklistSections.length > 0;
  const hasTroubleshooting = template.troubleshootingEntries.length > 0;
  const hasReferenceItems = template.referenceItems.length > 0;

  // Error-to-node navigation (Phase 3B revision) — a validation issue links
  // here with its stable source identity in the query string (never node
  // title text, which may be duplicated). `node` wins outright when the
  // linking screen already resolved it (the issue detail page, which has
  // full candidate ranking); otherwise `shape`/`connector` are resolved
  // against this template's already-loaded node/edge list.
  const searchParams = useSearchParams();
  const issueParam = searchParams.get("issue");
  const navigationTarget = resolveInitialGraphTarget(
    {
      nodeParam: searchParams.get("node"),
      worksheetParam: searchParams.get("worksheet"),
      shapeParam: searchParams.get("shape"),
      connectorParam: searchParams.get("connector"),
      fallbackParam: searchParams.get("fallback"),
      modeParam: searchParams.get("mode"),
    },
    template.nodes,
    template.edges
  );
  // 오류 집중 보기 (Problem 2 revision) only makes sense once a node is
  // actually resolved — the worksheet-only/candidate-evidence state (no
  // exact node, no connector fallback) has nothing to focus the camera on,
  // so it stays on the plain full graph even when mode=error-focus was
  // requested.
  const errorFocusMode = navigationTarget.errorFocus && navigationTarget.nodeId !== null;

  return (
    <div className="flex flex-col gap-6">
      {issueParam && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs dark:border-blue-900 dark:bg-blue-950">
          <p className="text-blue-800 dark:text-blue-300">
            {errorFocusMode && !navigationTarget.isFallback && "검증 이슈에서 이동했습니다 — 오류 집중 보기로 표시 중입니다."}
            {errorFocusMode && navigationTarget.isFallback &&
              "이슈에 정확히 연결된 노드가 없어, 연결선(connector)의 가장 가까운 바인딩 노드로 대체 이동했습니다(오류 집중 보기)."}
            {!navigationTarget.nodeId && "정확한 노드가 아직 연결되지 않았습니다. 후보 위치를 확인하세요."}
          </p>
          <div className="flex shrink-0 flex-wrap gap-2">
            <Link
              href={`/procedures/${template.id}/validation/${issueParam}`}
              className="rounded-md border border-blue-300 px-2 py-1 font-medium text-blue-700 hover:bg-blue-100 dark:border-blue-800 dark:text-blue-300 dark:hover:bg-blue-900"
            >
              ← 오류 상세로 돌아가기
            </Link>
            <Link
              href={`/procedures/${template.id}/validation/${issueParam}#resolution`}
              className="rounded-md border border-blue-300 px-2 py-1 font-medium text-blue-700 hover:bg-blue-100 dark:border-blue-800 dark:text-blue-300 dark:hover:bg-blue-900"
            >
              검토/처리 화면 열기
            </Link>
            {errorFocusMode && (
              <Link
                href={`/procedures/${template.id}`}
                className="rounded-md border border-zinc-300 px-2 py-1 font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                전체 워크플로우 보기
              </Link>
            )}
          </div>
        </div>
      )}
      <div>
        {/*
          🔴 목록으로 빠져나오는 길(2026-11-04 사용자 요청). 그 전까지 이 화면에는
          나가는 길이 **하나도 없었다** — 검증 이슈에서 들어왔을 때만 "← 오류
          상세로"가 떴고, 그건 목록이 아니라 이슈로 간다.

          자리를 제목 **위 왼쪽**에 둔 까닭 둘:
           · 오른쪽에는 [게시]·[새 DRAFT 버전 만들기]·[편집 시작]이 모여 있다.
             나가는 길이 그 사이에 끼면 되돌릴 수 없는 단추 옆에서 눌리게 된다.
           · 편집 화면의 "← …상세로"와 **같은 모양·같은 자리**다. 두 화면을
             오가는 사람이 같은 곳에서 같은 것을 찾게 된다.

          가는 곳은 분류가 정한다(resolveProcedureListLink) — 어디서 들어왔는지에
          기대면 주소를 직접 치고 온 사람에게는 갈 곳이 없다.
        */}
        <Link
          href={listLink.href}
          className="mb-2 inline-block text-xs text-blue-700 hover:underline dark:text-blue-400"
        >
          ← {listLink.label}
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">{template.name}</h1>
          <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[template.status]}`}>
            {procedureTemplateStatusLabels[template.status]}
          </span>
          <span className="inline-flex rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
            v{template.version}
          </span>
          {template.isReferenceOnly && (
            <span className="inline-flex rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-950 dark:text-amber-400">
              참고용 — 실행 불가
            </span>
          )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {canManageValidation && !template.isReferenceOnly && (
              <Link
                href={`/procedures/${template.id}/validation`}
                className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                검증 문제 검토
              </Link>
            )}
            {/*
              🔴 2026-11-04 — 조건이 "DRAFT 인가" 에서 **"올릴 수 있는 상태인가"**
              로 바뀌었다(DRAFT + ARCHIVED). 상태 목록을 여기 적지 않고 서버가
              쓰는 것과 **같은 함수**를 부른다 — 두 벌로 적으면 화면과 서버가
              어긋나고, 그건 이 저장소가 이미 한 번 겪은 사고다(커밋 af6da9b).
              PUBLISHED 가 빠져 있는 것이 알맹이다: 이미 올라간 것에 또 뜨면
              사람은 눌린 것이 안 먹혔다고 읽는다.
            */}
            {canPublishFromProcedureStatus(template.status) && canPublish && (
              <PublishTemplateButton
                templateId={template.id}
                templateName={template.name}
                isReferenceOnly={template.isReferenceOnly}
                isRepublish={template.status === "ARCHIVED"}
                expiringPublishedVersions={expiringPublishedVersions}
              />
            )}
            {!template.isReferenceOnly && template.status === "PUBLISHED" && canCreateDraftVersion && <CreateDraftVersionButton templateId={template.id} />}
            {!template.isReferenceOnly && template.status === "DRAFT" && canEditDraft && (
              <Link
                href={`/procedures/${template.id}/edit`}
                className="rounded-md bg-primary-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-800 dark:bg-primary-50 dark:text-zinc-900"
              >
                편집 시작
              </Link>
            )}
          </div>
        </div>
        {/* 🔴 2026-11-05 — 제목 아래에 코드를 적던 줄을 걷었다(사용자 결정).
            걷어낸 것은 보여 주기뿐이고 `procedure_templates.code` 는 그대로다 —
            아래 [버전 목록]이 바로 그 값으로 같은 계열의 판을 모은다. */}
        {template.description && (
          <p className="mt-2 max-w-3xl text-sm text-zinc-600 dark:text-zinc-400">{template.description}</p>
        )}

        <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 text-xs sm:grid-cols-4">
          <div>
            <dt className="text-zinc-400 dark:text-zinc-600">설비 유형</dt>
            <dd className="mt-0.5 text-zinc-700 dark:text-zinc-300">{procedureEquipmentTypeLabels[template.equipmentType]}</dd>
          </div>
          <div>
            <dt className="text-zinc-400 dark:text-zinc-600">원본 유형</dt>
            <dd className="mt-0.5 text-zinc-700 dark:text-zinc-300">{procedureTemplateSourceTypeLabels[template.sourceType]}</dd>
          </div>
          <div>
            <dt className="text-zinc-400 dark:text-zinc-600">원본 파일</dt>
            <dd className="mt-0.5 truncate text-zinc-700 dark:text-zinc-300" title={template.sourceFileName ?? undefined}>
              {template.sourceFileName ?? "-"}
            </dd>
          </div>
          <div>
            <dt className="text-zinc-400 dark:text-zinc-600">작성자</dt>
            <dd className="mt-0.5 text-zinc-700 dark:text-zinc-300">{template.createdByName}</dd>
          </div>
          <div>
            <dt className="text-zinc-400 dark:text-zinc-600">생성일</dt>
            <dd className="mt-0.5 text-zinc-700 dark:text-zinc-300">{formatDate(template.createdAt)}</dd>
          </div>
          <div>
            <dt className="text-zinc-400 dark:text-zinc-600">게시자 / 게시일</dt>
            <dd className="mt-0.5 text-zinc-700 dark:text-zinc-300">
              {template.publishedByName ? `${template.publishedByName} · ${formatDate(template.publishedAt)}` : "-"}
            </dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-zinc-400 dark:text-zinc-600">노드 / 분기 수</dt>
            <dd className="mt-0.5 text-zinc-700 dark:text-zinc-300">
              노드 {template.nodes.length}개 · 분기 {template.edges.length}개 · 체크리스트 항목{" "}
              {template.checklistSections.reduce((sum, s) => sum + s.items.length, 0)}개 · 고장 진단 항목{" "}
              {template.troubleshootingEntries.length}개 · 참고 항목 {template.referenceItems.length}개
            </dd>
          </div>
        </dl>
      </div>

      {/* 플로우차트보다 **위**다 — 지금 보고 있는 것이 어느 판인지를 그림을
          보기 전에 알아야 한다. 판을 잘못 보고 있는 줄 모르고 그림을 읽는 것이
          이 화면의 가장 비싼 오독이다. */}
      {/*
        🔴 [삭제] 단추는 **여기서** 끼워 넣는다. ProcedureVersionList 가 직접
        import 하면 사슬 끝의 `server-only` 때문에 그 목록을 렌더해서 재는 시험이
        import 에서 통째로 던진다(그 파일의 renderDeleteAction 주석).

        🔵 권한이 없으면 슬롯을 **아예 안 넘긴다** — 그러면 삭제 자리도,
        「왜 못 지우는가」도 화면에 안 나온다.
      */}
      <ProcedureVersionList
        versions={versions}
        currentTemplateId={template.id}
        referencedVersionIds={referencedVersionIds}
        renderDeleteAction={
          canDeleteVersion
            ? (row) => (
                <DeleteProcedureVersionButton
                  templateId={row.id}
                  templateName={row.name}
                  templateVersion={row.version}
                  templateStatus={row.status}
                  isCurrentlyViewing={row.id === template.id}
                  listHref={listLink.href}
                />
              )
            : undefined
        }
      />

      <section>
        <h2 className="mb-2 text-sm font-semibold text-zinc-900 dark:text-zinc-50">검증 이슈</h2>
        <ProcedureValidationIssuePanel issues={template.validationIssues} />
      </section>

      {hasGraph && (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-zinc-900 dark:text-zinc-50">플로우차트</h2>
          <p className="mb-2 text-xs text-zinc-500 dark:text-zinc-400">
            읽기 전용 — 마우스 휠로 확대/축소, 드래그로 이동할 수 있습니다. 화살표 색상은 분기 유형을 나타냅니다
            (빨강=NG, 파랑=YES, 초록=정상, 보라 점선=재진행).
          </p>
          <ProcedureFlowGraph
            templateId={template.id}
            nodes={template.nodes}
            edges={template.edges}
            openIssuesByNodeId={template.openIssuesByNodeId}
            initialWorksheet={navigationTarget.worksheetFilter}
            initialSelectedNodeId={navigationTarget.nodeId}
            errorFocusMode={errorFocusMode}
            useAutoLayoutForUnpositionedNodes={template.category === "TECHNICAL_TASK"}
          />
        </section>
      )}

      {hasChecklist && (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-zinc-900 dark:text-zinc-50">체크리스트</h2>
          <ProcedureChecklistViewer sections={template.checklistSections} />
        </section>
      )}

      {hasTroubleshooting && (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-zinc-900 dark:text-zinc-50">고장 증상별 진단표</h2>
          <ProcedureTroubleshootingViewer entries={template.troubleshootingEntries} />
        </section>
      )}

      {hasReferenceItems && (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-zinc-900 dark:text-zinc-50">참고 항목</h2>
          <p className="mb-2 text-xs text-zinc-500 dark:text-zinc-400">
            이 템플릿은 참고용 인덱스로, 실행 가능한 절차 노드를 포함하지 않습니다. 원본 워크북의 이동 링크·외부
            파일 경로·교차 참조 번호를 그대로 보존한 목록입니다.
          </p>
          <ProcedureReferenceItemsViewer items={template.referenceItems} />
        </section>
      )}
    </div>
  );
}
