/** 立场坐标图：两根由问题决定的轴，把立场摆上去。空白区域也要标出来。 */
import type { StanceMap } from '../types.ts'

const W = 640
const H = 600
const LEFT = 78
const TOP = 44
const PLOT_W = W - LEFT - 40
const PLOT_H = H - TOP - 74

const px = (x: number): number => LEFT + (Math.max(0, Math.min(100, x)) / 100) * PLOT_W
const py = (y: number): number => TOP + PLOT_H - (Math.max(0, Math.min(100, y)) / 100) * PLOT_H

export function StanceMapView({ map }: { map: StanceMap }) {
  const cx = px(50)
  const cy = py(50)

  return (
    <div className="ph-stance">
      <svg viewBox={`0 0 ${W} ${H}`} className="ph-stance-svg" role="img" aria-label="立场坐标图">
        <defs>
          <marker id="sa-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M0,0 L8,4 L0,8 z" fill="var(--dsw-alias-border-l2)" />
          </marker>
        </defs>

        {/* 绘图区 */}
        <rect x={LEFT} y={TOP} width={PLOT_W} height={PLOT_H} className="ph-sa-plot" />

        {/* 十字轴 */}
        <line x1={LEFT} y1={cy} x2={LEFT + PLOT_W} y2={cy} className="ph-sa-axis" markerEnd="url(#sa-arrow)" />
        <line x1={cx} y1={TOP + PLOT_H} x2={cx} y2={TOP} className="ph-sa-axis" markerEnd="url(#sa-arrow)" />

        {/* 轴端标签 */}
        <text x={LEFT - 6} y={cy + 16} className="ph-sa-end" textAnchor="end">{map.xAxis.low}</text>
        <text x={LEFT + PLOT_W + 4} y={cy - 8} className="ph-sa-end" textAnchor="start">{map.xAxis.high}</text>
        <text x={cx - 8} y={TOP + PLOT_H + 20} className="ph-sa-end" textAnchor="end">{map.yAxis.low}</text>
        <text x={cx + 8} y={TOP - 8} className="ph-sa-end" textAnchor="start">{map.yAxis.high}</text>

        {/* 轴名 */}
        <text x={LEFT + PLOT_W / 2} y={H - 22} className="ph-sa-name" textAnchor="middle">{map.xAxis.label}</text>
        <text
          x={18}
          y={TOP + PLOT_H / 2}
          className="ph-sa-name"
          textAnchor="middle"
          transform={`rotate(-90 18 ${TOP + PLOT_H / 2})`}
        >
          {map.yAxis.label}
        </text>

        {/* 空白区域的说明：往往比有点的地方更有信息量 */}
        {(map.empty ?? []).map((e, i) => {
          const pos = quadrantSpot(e.quadrant)
          return (
            <g key={`e${i}`} className="ph-sa-empty">
              <rect x={pos.x - 62} y={pos.y - 15} width={124} height={30} rx={4} />
              <text x={pos.x} y={pos.y + 4} textAnchor="middle">{e.quadrant} 无人</text>
              <title>{e.note}</title>
            </g>
          )
        })}

        {/* 点 */}
        {map.positions.map((p, i) => {
          const x = px(p.x)
          const y = py(p.y)
          return (
            <g key={`p${i}`} className="ph-sa-point">
              <circle cx={x} cy={y} r={5} />
              <text x={x} y={y - 12} textAnchor="middle">{p.name}</text>
              {p.reason && <title>{p.reason}</title>}
            </g>
          )
        })}
      </svg>
      <div className="ph-stance-legend">
        {map.positions.map((p, i) => (
          <span key={i}><b>{p.name}</b>{p.reason ? `：${p.reason}` : ''}</span>
        ))}
      </div>
    </div>
  )
}

/** 四个象限里各挑一个位置放「无人」标签。 */
function quadrantSpot(quadrant: string): { x: number; y: number } {
  const q = quadrant.trim()
  const left = LEFT + PLOT_W * 0.26
  const right = LEFT + PLOT_W * 0.74
  const top = TOP + PLOT_H * 0.26
  const bottom = TOP + PLOT_H * 0.74
  if (q.includes('左上')) return { x: left, y: top }
  if (q.includes('右上')) return { x: right, y: top }
  if (q.includes('左下')) return { x: left, y: bottom }
  if (q.includes('右下')) return { x: right, y: bottom }
  return { x: right, y: top }
}
