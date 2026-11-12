/** 概念分叉树：一个词在各种意义上劈开，每条带判准、适用与失效条件。 */
import type { ConceptTree } from '../types.ts'

const COL_W = 208
const GAP = 26
const PAD = 28
const ROOT_H = 52
const BRANCH_Y = 130
const CARD_H = 196

function wrap(text: string, perLine: number, maxLines = 4): string[] {
  const chars = [...text]
  const lines: string[] = []
  for (let i = 0; i < chars.length; i += perLine) lines.push(chars.slice(i, i + perLine).join(''))
  if (lines.length > maxLines) {
    lines.length = maxLines
    lines[maxLines - 1] = lines[maxLines - 1].slice(0, perLine - 1) + '…'
  }
  return lines
}

export function ConceptTreeView({ tree }: { tree: ConceptTree }) {
  const n = Math.max(tree.readings.length, 1)
  const width = PAD * 2 + n * COL_W + (n - 1) * GAP
  const height = BRANCH_Y + CARD_H + PAD + 18

  const rootW = Math.min(260, Math.max(160, tree.term.length * 22 + 48))
  const rootX = (width - rootW) / 2

  const colX = (i: number) => PAD + i * (COL_W + GAP)
  const trunkY = PAD + ROOT_H
  const busY = BRANCH_Y - 42

  return (
    <div className="ph-concept-tree">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="ph-concept-svg"
        role="img"
        aria-label="概念分叉树"
      >
        {/* 主干与横梁 */}
        <path
          d={`M ${width / 2} ${trunkY} L ${width / 2} ${busY}`}
          className="ph-ct-trunk"
        />
        <path
          d={`M ${colX(0) + COL_W / 2} ${busY} L ${colX(n - 1) + COL_W / 2} ${busY}`}
          className="ph-ct-trunk"
        />

        {/* 根节点 */}
        <g className="ph-ct-root">
          <rect x={rootX} y={PAD} width={rootW} height={ROOT_H} rx={4} />
          <text x={width / 2} y={PAD + 32} textAnchor="middle">{tree.term}</text>
        </g>

        {/* 分叉 */}
        {tree.readings.map((reading, i) => {
          const x = colX(i)
          const cx = x + COL_W / 2
          return (
            <g key={i}>
              <path d={`M ${cx} ${busY} L ${cx} ${BRANCH_Y}`} className="ph-ct-trunk" />
              <g className="ph-ct-card">
                <rect x={x} y={BRANCH_Y} width={COL_W} height={CARD_H} rx={4} />
                <text x={x + 12} y={BRANCH_Y + 24} className="ph-ct-name">{reading.name}</text>
                {wrap(reading.criterion, 16, 3).map((line, li) => (
                  <text key={`c${li}`} x={x + 12} y={BRANCH_Y + 46 + li * 18} className="ph-ct-body">
                    {line}
                  </text>
                ))}
                {reading.appliesWhen && (
                  <text x={x + 12} y={BRANCH_Y + 116} className="ph-ct-ok">
                    成立：{wrap(reading.appliesWhen, 13, 1)[0]}
                  </text>
                )}
                {reading.failsWhen && (
                  <text x={x + 12} y={BRANCH_Y + 140} className="ph-ct-bad">
                    失效：{wrap(reading.failsWhen, 13, 1)[0]}
                  </text>
                )}
              </g>
            </g>
          )
        })}
      </svg>
      <div className="ph-concept-legend">
        <span><i className="ct-root-dot" />被拆的词</span>
        <span><i className="ct-card-dot" />一条读法</span>
        <span>每条都配判准——没有判准的分叉只是列举</span>
      </div>
    </div>
  )
}
