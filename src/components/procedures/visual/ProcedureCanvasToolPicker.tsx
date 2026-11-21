"use client";

/**
 * 그림 위에서 **지금 마우스가 무슨 일을 하는가** — 도구 단추 둘(2026-11-21).
 *
 * 쓰는 분이 댄 본보기는 동영상 편집 프로그램이다: 「[마우스] 아이콘을 누르면
 * 지금처럼 일반 기능을, [점선 네모] 아이콘을 누르면 드래그 혹은 클릭으로 여러
 * 노드를 골라 한 번에 이동」.
 *
 * 🔴 **화면 글자와 코드 안의 호칭이 일부러 다르다**(2026-11-21 쓰는 분 결정:
 * 「기능을 설명하는 단어였으면 좋겠어」). 단추에는 **[선택·이동] · [범위 선택]**
 * 이라고 적고, 코드와 주석에서는 처음 이름(손짓 모양을 딴 **점선 네모**)과 값
 * 이름(POINTER · BOX_SELECT)을 그대로 쓴다. 화면 낱말은 앞으로도 바뀔 수 있는데
 * 그때마다 주석 스무 곳을 따라 고치면 **고치다 만 자리가 반드시 남는다.**
 * 🔵 그래서 **화면에 나가는 글자는 아래 TOOLS 의 label 과 title 뿐**이다 — 고칠
 *    곳이 한 군데임을 시험이 지킨다(procedure-box-selection-tool.test.ts).
 *
 * ──────────────────────────────────────────────────────────────────────
 * 🔴 **왜 보조키가 아니라 도구인가**
 * 이 그림은 Shift 를 **축 잠금 드래그**에 이미 쓰고 있다(axis-lock.ts). 그래서
 * 「Shift 누르고 끌면 선택 상자」 같은 흔한 길이 막혀 있다. 모드로 가르면 보조키가
 * 아예 필요 없어진다 — 점선 네모 모드에서는 **누르는 것이 곧 넣기/빼기**다.
 *
 * 🔴 **아이콘만 두지 않는다.** 그림 도구 아이콘은 쓰는 사람마다 읽는 뜻이 달라서,
 * 글자를 함께 적고 `title` 로 「이 모드에서 무엇이 되는지」까지 적어 둔다. 대신
 * **새 상시 안내 줄은 안 세운다** — 이 편집기의 안내 두 줄은 쓰는 분 요청으로
 * 걷어낸 자리다(커밋 d57f664a). 설명은 단추 안과 툴팁까지다.
 *
 * 🔵 **아이콘은 손으로 그린 인라인 SVG** 다 — 이 저장소의 방식 그대로이고
 * (ProcedureNodeIcons.tsx), 아이콘 묶음을 새로 들이지 않는다. 글자색을
 * 그대로 입도록 `currentColor` 로 그린다.
 * ──────────────────────────────────────────────────────────────────────
 */

/** 그림 위에서 마우스가 하는 일. 🔵 둘뿐이고, 늘 하나만 켜져 있다. */
export type ProcedureCanvasTool = "POINTER" | "BOX_SELECT";

type IconProps = { className?: string };

/** ProcedureNodeIcons.tsx 와 **같은 값**이다 — 같은 그림 안에 서는 아이콘들이라 굵기·끝모양이 갈리면 눈에 띈다. */
const STROKE_PROPS = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

/** 화살표 커서 — 「지금까지와 같은 마우스」. */
function PointerToolIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...STROKE_PROPS} aria-hidden="true">
      <path d="M5 3l6.5 16 2.3-6.2 6.2-2.3z" />
    </svg>
  );
}

/**
 * 점선 네모 — 쓰는 분이 부른 그 이름 그대로 **네 변이 끊긴 네모**로 그린다.
 * 🔵 `strokeDasharray` 로 끊는다: 네 귀퉁이만 그리는 모양도 흔하지만, 그러면
 *    화면에 실제로 그려지는 선택 상자(점선 테두리)와 안 닮는다.
 */
function BoxSelectToolIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...STROKE_PROPS} aria-hidden="true">
      <rect x="3.5" y="5" width="17" height="14" rx="1.5" strokeDasharray="3 2.5" />
    </svg>
  );
}

const TOOL_BUTTON_BASE = "flex items-center gap-1 px-2 py-1 transition-colors";
const TOOL_BUTTON_IDLE = "bg-white text-zinc-600 hover:bg-zinc-100 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800";
/**
 * 🔴 켜진 쪽은 **색이 확 달라야** 한다. `aria-pressed` 만 바뀌고 모양이 그대로면
 * 화면을 보는 사람은 지금 어느 도구인지 알 수 없고, 빈 바탕을 끌었을 때 화면이
 * 움직일지 네모가 그려질지 **눌러 봐야만** 알게 된다.
 * 🔵 파랑은 이 조작줄의 다른 단추들과 같은 결이다(「선택한 노드로 이동」).
 */
const TOOL_BUTTON_ACTIVE = "bg-blue-600 text-white hover:bg-blue-600 dark:bg-blue-500 dark:text-white";

const TOOLS: { tool: ProcedureCanvasTool; label: string; title: string; Icon: (props: IconProps) => React.JSX.Element }[] = [
  {
    tool: "POINTER",
    // 🔵 글자에 **이 모드에서 되는 일 둘**(고르기·화면 옮기기)이 다 들어 있다 —
    //    옆 단추와 갈리는 지점이 「몇 개를 고르나」와 「빈 바탕 끌기가 누구 것인가」라서다.
    label: "선택·이동",
    // 🔵 「빈 바탕을 끌면 화면이 움직인다」를 여기 적는 까닭: 범위 선택 모드에서는
    //    그 손짓을 선택 상자가 가져가므로(화면은 휠·미니맵·조작 단추로 옮긴다),
    //    두 모드가 **무엇이 다른지**가 이 한 줄에 들어 있어야 한다.
    title: "선택·이동 — 지금까지와 같습니다. 노드를 클릭하면 하나가 선택되고, 빈 바탕을 끌면 화면이 움직입니다.",
    Icon: PointerToolIcon,
  },
  {
    tool: "BOX_SELECT",
    label: "범위 선택",
    // 🔴 「**어느 하나를 끌어도**」를 적어 두는 까닭: 그림 바탕(React Flow)은 고른
    //    칸이 있으면 **고르지 않은 칸을 끌 때도** 고른 것들을 함께 끈다. 모르고
    //    보면 결함처럼 읽히는 자리라 미리 말해 둔다.
    title: "범위 선택 — 빈 바탕을 끌면 네모 범위에 닿은 노드가 한꺼번에 골라지고, 노드를 클릭하면 선택에 넣거나 뺍니다. 고른 노드는 어느 하나를 끌어도 함께 움직입니다. (빈 바탕을 클릭하면 선택이 풀립니다.)",
    Icon: BoxSelectToolIcon,
  },
];

export default function ProcedureCanvasToolPicker({
  tool,
  onToolChange,
  selectedCount,
}: {
  tool: ProcedureCanvasTool;
  onToolChange: (tool: ProcedureCanvasTool) => void;
  /** 점선 네모로 지금 골라 둔 칸의 수. 🔴 **0 도 보여 준다** — 「네모를 쳤는데 왜 안 움직이지」의 답이 거기 있다. */
  selectedCount: number;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-zinc-500 dark:text-zinc-400">도구:</span>
      <div className="flex items-center overflow-hidden rounded-md border border-zinc-200 dark:border-zinc-700">
        {TOOLS.map(({ tool: value, label, title, Icon }) => (
          <button
            key={value}
            type="button"
            title={title}
            aria-pressed={tool === value}
            onClick={() => onToolChange(value)}
            className={`${TOOL_BUTTON_BASE} ${tool === value ? TOOL_BUTTON_ACTIVE : TOOL_BUTTON_IDLE}`}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        ))}
      </div>
      {/*
        🔵 **고른 수는 점선 네모 모드에서만** 선다. 마우스 모드에는 이 집합이 늘
        비어 있고(모드를 바꾸는 순간 비운다), 거기에 「0개 선택」이 상시로 서면
        걷어낸 안내 줄을 다른 이름으로 다시 세우는 꼴이 된다.
      */}
      {tool === "BOX_SELECT" && (
        <span className="text-zinc-500 dark:text-zinc-400">
          <span className="font-medium text-zinc-700 dark:text-zinc-300">{selectedCount}개</span> 선택
        </span>
      )}
    </div>
  );
}
