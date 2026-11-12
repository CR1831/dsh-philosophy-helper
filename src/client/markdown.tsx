/** 轻量 Markdown 渲染：只处理哲学引擎实际会产出的那几种块，不引依赖。 */
import { useState, type ReactNode } from 'react'
import { TERM_MAP, TERM_RE, type Term } from '../terms.ts'

const INLINE_RE = /(\*\*[^*\n]+\*\*|`[^`\n]+`)/g

/** 纯文本段里把术语包成可点的 span；代码块不走这一层。 */
function withTerms(text: string, key: string): ReactNode[] {
  if (!text) return []
  const nodes: ReactNode[] = []
  let last = 0
  const re = new RegExp(TERM_RE.source, 'g')
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index))
    nodes.push(
      <span
        key={`${key}-t${m.index}`}
        className="ph-term"
        data-term={m[0]}
        role="button"
        tabIndex={0}
      >
        {m[0]}
      </span>,
    )
    last = m.index + m[0].length
  }
  if (last < text.length) nodes.push(text.slice(last))
  return nodes
}

function inline(text: string, key: string): ReactNode[] {
  const nodes: ReactNode[] = []
  let last = 0
  let match: RegExpExecArray | null
  const re = new RegExp(INLINE_RE.source, 'g')
  while ((match = re.exec(text)) !== null) {
    if (match.index > last) nodes.push(...withTerms(text.slice(last, match.index), key))
    const token = match[0]
    if (token.startsWith('**')) {
      nodes.push(<strong key={`${key}-b${match.index}`}>{withTerms(token.slice(2, -2), `${key}b`)}</strong>)
    } else {
      nodes.push(<code key={`${key}-c${match.index}`} className="ph-inline-code">{token.slice(1, -1)}</code>)
    }
    last = match.index + token.length
  }
  if (last < text.length) nodes.push(...withTerms(text.slice(last), key))
  return nodes
}

const LIST_RE = /^([-*+]|\d+\.)\s+/
const HEAD_RE = /^(#{1,4})\s+(.*)$/

function isSeparatorRow(cells: string[]): boolean {
  return cells.length > 0 && cells.every(c => /^:?-{2,}:?$/.test(c))
}

function splitRow(row: string): string[] {
  return row.replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim())
}

function renderTable(rows: string[], key: string): ReactNode {
  const cells = rows.map(splitRow)
  const head = cells.length > 1 && isSeparatorRow(cells[1]) ? cells[0] : undefined
  const body = cells.filter((row, index) => !isSeparatorRow(row) && index !== (head ? 0 : -1))
  return (
    <div key={key} className="ph-md-table-wrap">
      <table className="ph-md-table">
        {head && (
          <thead>
            <tr>{head.map((cell, i) => <th key={i}>{inline(cell, `${key}h${i}`)}</th>)}</tr>
          </thead>
        )}
        <tbody>
          {body.map((row, r) => (
            <tr key={r}>
              {row.map((cell, c) => (
                <td key={c} data-first={c === 0 ? 'true' : undefined}>{inline(cell, `${key}r${r}c${c}`)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

interface TipState {
  term: Term
  left: number
  top: number
}

/**
 * 把引擎产出的 Markdown 渲染成块。
 * 支持：`#` 标题、`-`/`1.` 列表、`| |` 表格、`**粗体**`、`` `代码` ``。
 * 术语表里有的词会变成可点的下划线，点开弹卡片。
 */
export function Markdown({ text }: { text: string }) {
  const [tip, setTip] = useState<TipState | null>(null)
  if (!text) return null
  const lines = text.split(/\r?\n/)
  const blocks: ReactNode[] = []
  let i = 0
  let key = 0

  while (i < lines.length) {
    const raw = lines[i]
    const trimmed = raw.trim()

    if (!trimmed) { i += 1; continue }

    if (/^([-*_])\1{2,}$/.test(trimmed)) {
      blocks.push(<hr key={`hr${key++}`} className="ph-md-hr" />)
      i += 1
      continue
    }

    if (trimmed.startsWith('|')) {
      const rows: string[] = []
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        rows.push(lines[i].trim())
        i += 1
      }
      blocks.push(renderTable(rows, `t${key++}`))
      continue
    }

    const head = HEAD_RE.exec(trimmed)
    if (head) {
      blocks.push(
        <div key={`h${key++}`} className="ph-md-h" data-l={head[1].length}>
          {inline(head[2], `hh${key}`)}
        </div>,
      )
      i += 1
      continue
    }

    if (LIST_RE.test(trimmed)) {
      const items: string[] = []
      while (i < lines.length) {
        // 列表项之间允许空行
        while (i < lines.length && !lines[i].trim()) i += 1
        if (i >= lines.length || !LIST_RE.test(lines[i].trim())) break

        let item = lines[i].trim().replace(LIST_RE, '')
        i += 1

        while (i < lines.length) {
          const next = lines[i]
          if (!next.trim()) {
            // 空行之后若仍是本项的缩进续行，一并吸收
            let look = i
            while (look < lines.length && !lines[look].trim()) look += 1
            if (look < lines.length && /^\s{2,}/.test(lines[look]) && !LIST_RE.test(lines[look].trim())) {
              i = look
              item += '\n' + lines[i].trim()
              i += 1
              continue
            }
            break
          }
          if (!/^\s{2,}/.test(next) || LIST_RE.test(next.trim())) break
          item += '\n' + next.trim()
          i += 1
        }
        items.push(item)
      }
      blocks.push(
        <ul key={`l${key++}`} className="ph-md-list">
          {items.map((item, n) => <li key={n}>{inline(item, `li${key}${n}`)}</li>)}
        </ul>,
      )
      continue
    }

    const para: string[] = []
    while (i < lines.length) {
      const current = lines[i].trim()
      if (!current || current.startsWith('|') || HEAD_RE.test(current) || LIST_RE.test(current)) break
      para.push(lines[i])
      i += 1
    }
    if (para.length === 0) { i += 1; continue }
    const joined = para.join('\n').trim()
    // 整段只有一个加粗 → 它是小标题式的重点，单独上色；否则是行内强调
    const caption = /^\*\*([^*\n]+)\*\*$/.exec(joined)
    if (caption) {
      blocks.push(<div key={`cap${key++}`} className="ph-md-cap">{inline(caption[1], `cap${key}`)}</div>)
    } else {
      blocks.push(<p key={`p${key++}`} className="ph-md-p">{inline(joined, `pp${key}`)}</p>)
    }
  }

  const handleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const el = (event.target as HTMLElement).closest('.ph-term') as HTMLElement | null
    if (!el) { setTip(null); return }
    const term = TERM_MAP.get(el.dataset.term ?? '')
    if (!term) return
    const rect = el.getBoundingClientRect()
    // 弹层固定定位，不会被滚动容器裁掉
    const width = 300
    const left = Math.max(12, Math.min(rect.left, window.innerWidth - width - 12))
    const top = rect.bottom + 8 > window.innerHeight - 140 ? rect.top - 8 : rect.bottom + 8
    setTip({ term, left, top })
  }

  return (
    <div className="ph-md" onClick={handleClick}>
      {blocks}
      {tip && (
        <>
          <div className="ph-term-scrim" onClick={() => setTip(null)} />
          <div
            className="ph-term-tip"
            style={{ left: tip.left, top: tip.top, width: 300 }}
            data-above={tip.top < 0 ? 'true' : undefined}
          >
            <div className="ph-term-head">
              <strong>{tip.term.zh}</strong>
              {tip.term.en && <span>{tip.term.en}</span>}
            </div>
            <div className="ph-term-def">{tip.term.def}</div>
            {tip.term.note && <div className="ph-term-note">{tip.term.note}</div>}
            <button type="button" className="ph-term-close" onClick={() => setTip(null)}>知道了</button>
          </div>
        </>
      )}
    </div>
  )
}
