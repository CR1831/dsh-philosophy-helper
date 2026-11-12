/** 论证结构图：前提在左，结论在右，隐含前提虚线框，反驳画红虚线。 */
import type { ArgGraph, ArgNode } from '../types.ts'

const PAD = 24
const P_W = 252
const C_W = 276
const GAP = 124
const ROW = 86
const NODE_H = 68

function wrap(text: string, perLine: number, maxLines = 3): string[] {
  const chars = [...text]
  const lines: string[] = []
  for (let i = 0; i < chars.length; i += perLine) lines.push(chars.slice(i, i + perLine).join(''))
  if (lines.length > maxLines) {
    lines.length = maxLines
    lines[maxLines - 1] = lines[maxLines - 1].slice(0, perLine - 1) + '…'
  }
  return lines
}

function nodeHeight(lines: number): number {
  return Math.max(NODE_H, lines * 20 + 26)
}

interface Placed {
  node: ArgNode
  x: number
  y: number
  w: number
  h: number
  lines: string[]
}

export function ArgMap({ graph }: { graph: ArgGraph }) {
  const premises = graph.premises ?? []
  const rows = Math.max(premises.length, 1)
  const height = Math.max(rows * ROW + PAD * 2, 170)
  const width = P_W + GAP + C_W + PAD * 2

  const leftX = PAD
  const rightX = PAD + P_W + GAP

  const placedPremises: Placed[] = premises.map((node, i) => {
    const lines = wrap(node.text, 13)
    const h = nodeHeight(lines.length)
    return { node, x: leftX, y: PAD + i * ROW + (ROW - h) / 2, w: P_W, h, lines }
  })

  const cLines = wrap(graph.conclusion.text, 15)
  const cH = nodeHeight(cLines.length)
  const placedConclusion: Placed = {
    node: graph.conclusion,
    x: rightX,
    y: (height - cH) / 2,
    w: C_W,
    h: cH,
    lines: cLines,
  }

  const byId = new Map<string, Placed>()
  for (const p of placedPremises) byId.set(p.node.id, p)
  byId.set(placedConclusion.node.id, placedConclusion)

  const supports = graph.supports ?? premises.map(p => [p.id, graph.conclusion.id] as [string, string])
  const attacks = graph.attacks ?? []

  return (
    <div className="ph-argmap">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="ph-argmap-svg"
        role="img"
        aria-label="论证结构图"
      >
        <defs>
          <marker id="am-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L8,4 L0,8 z" fill="var(--dsw-alias-border-l2)" />
          </marker>
          <marker id="am-arrow-bad" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L8,4 L0,8 z" fill="var(--dsw-alias-state-error-primary)" />
          </marker>
        </defs>

        {/* 支撑线：前提右侧中点 → 结论左侧中点 */}
        {supports.map(([from, to], i) => {
          const a = byId.get(from)
          const b = byId.get(to)
          if (!a || !b) return null
          const x1 = a.x + a.w
          const y1 = a.y + a.h / 2
          const x2 = b.x
          const y2 = b.y + b.h / 2
          const mx = (x1 + x2) / 2
          return (
            <path
              key={`s${i}`}
              d={`M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`}
              className="ph-argmap-edge"
              markerEnd="url(#am-arrow)"
            />
          )
        })}

        {/* 反驳线：红虚线，从攻击方指向被攻击方 */}
        {attacks.map((atk, i) => {
          const a = byId.get(atk.from)
          const b = byId.get(atk.to)
          if (!a || !b) return null
          const x1 = a.x + a.w / 2
          const y1 = a.y < b.y ? a.y + a.h : a.y
          const x2 = b.x + b.w / 2
          const y2 = a.y < b.y ? b.y : b.y + b.h
          return (
            <g key={`a${i}`}>
              <path
                d={`M ${x1} ${y1} L ${x2} ${y2}`}
                className="ph-argmap-attack"
                markerEnd="url(#am-arrow-bad)"
              >
                {atk.reason && <title>{atk.reason}</title>}
              </path>
            </g>
          )
        })}

        {/* 节点 */}
        {[...placedPremises, placedConclusion].map((p, i) => (
          <g key={`n${i}`} className="ph-argmap-node" data-implicit={p.node.implicit ? 'true' : undefined}>
            <rect x={p.x} y={p.y} width={p.w} height={p.h} rx={4} />
            <text x={p.x + 12} y={p.y + 18} className="ph-argmap-tag">
              {p.node.implicit ? '隐含前提' : p === placedConclusion ? '结论' : `前提 ${p.node.id}`}
            </text>
            {p.lines.map((line, li) => (
              <text key={li} x={p.x + 12} y={p.y + 36 + li * 20} className="ph-argmap-text">
                {line}
              </text>
            ))}
          </g>
        ))}
      </svg>
      <div className="ph-argmap-legend">
        <span><i className="lg-solid" />支撑</span>
        <span><i className="lg-dash" />反驳</span>
        <span><i className="lg-implicit" />虚线框 = 没说出口的前提</span>
      </div>
    </div>
  )
}
