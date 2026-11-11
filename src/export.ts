/** 案件导出：Markdown 与单文件 HTML。
 *
 * 导出成能直接发给别人的东西——面板里的成果锁在面板里等于不能交付。
 * HTML 是阅读版：正文渲染成真正的标题/列表/表格，而不是把 Markdown 塞进 <pre>。
 */
import type { Case } from './types.ts'
import { ENGINES, MODES } from './types.ts'

const MODE_ZH: Record<string, string> = Object.fromEntries(Object.entries(MODES).map(([k, v]) => [k, v.zh]))

function stamp(iso: string): string {
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/** 引擎正文自带 `## 一、…` 这类标题，Markdown 导出时整体降一级，免得和引擎名撞层。 */
function demoteHeadings(text: string): string {
  return text.replace(/^(#{1,5})\s+/gm, (_m, hashes: string) => `${hashes}# `)
}

const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** 行内：只处理加粗与行内代码。 */
function inlineHtml(escaped: string): string {
  return escaped
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`\n]+)`/g, '<code>$1</code>')
}

/** 把引擎正文渲染成 HTML。满屏 `###` `**` 的源码观感是「AI 味」的主要来源。 */
export function markdownToHtml(source: string): string {
  const lines = source.split(/\r?\n/)
  const out: string[] = []
  let list: 'ul' | 'ol' | null = null
  let para: string[] = []
  let i = 0

  const closeList = (): void => { if (list) { out.push(`</${list}>`); list = null } }
  const closePara = (): void => { if (para.length) { out.push(`<p>${para.join('<br />')}</p>`); para = [] } }
  const closeAll = (): void => { closePara(); closeList() }

  while (i < lines.length) {
    const line = lines[i].trim()
    if (!line) { closeAll(); i += 1; continue }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    if (heading) {
      closeAll()
      const level = Math.min(heading[1].length + 1, 6)
      out.push(`<h${level}>${inlineHtml(escapeHtml(heading[2]))}</h${level}>`)
      i += 1
      continue
    }

    if (/^[-—]{3,}$/.test(line)) { closeAll(); out.push('<hr />'); i += 1; continue }

    if (line.startsWith('>')) {
      closeAll()
      const quoted: string[] = []
      while (i < lines.length && lines[i].trim().startsWith('>')) {
        quoted.push(lines[i].trim().replace(/^>\s?/, ''))
        i += 1
      }
      out.push(`<blockquote>${quoted.map(q => `<p>${inlineHtml(escapeHtml(q))}</p>`).join('')}</blockquote>`)
      continue
    }

    if (line.startsWith('|')) {
      closeAll()
      const rows: string[][] = []
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        const cells = lines[i].trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim())
        if (!cells.every(c => /^:?-{2,}:?$/.test(c))) rows.push(cells)
        i += 1
      }
      if (rows.length) {
        const [head, ...body] = rows
        out.push('<div class="table-wrap"><table><thead><tr>'
          + head.map(c => `<th>${inlineHtml(escapeHtml(c))}</th>`).join('')
          + '</tr></thead><tbody>'
          + body.map(r => '<tr>' + r.map(c => `<td>${inlineHtml(escapeHtml(c))}</td>`).join('') + '</tr>').join('')
          + '</tbody></table></div>')
      }
      continue
    }

    const ordered = /^\d+\.\s+(.*)$/.exec(line)
    const bullet = /^[-*+]\s+(.*)$/.exec(line)
    if (ordered || bullet) {
      closePara()
      const kind: 'ul' | 'ol' = ordered ? 'ol' : 'ul'
      if (list !== kind) { closeList(); out.push(`<${kind}>`); list = kind }
      out.push(`<li>${inlineHtml(escapeHtml((ordered ?? bullet)![1]))}</li>`)
      i += 1
      continue
    }

    closeList()
    para.push(inlineHtml(escapeHtml(line)))
    i += 1
  }

  closeAll()
  return out.join('\n')
}

/** 导出成 Markdown：元信息 + 每个引擎的正文。 */
export function toMarkdown(record: Case): string {
  const lines: string[] = []
  lines.push(`# ${record.question}`, '')
  lines.push(`- 案件：\`${record.id}\``)
  lines.push(`- 模式：${MODE_ZH[record.mode] ?? record.mode}`)
  lines.push(`- 状态：${record.status === 'done' ? '已结' : record.status === 'deliberating' ? '审议中' : '开放'}`)
  lines.push(`- 建档：${stamp(record.createdAt)}`)
  if (record.personas.length) lines.push(`- 参与立场：${record.personas.join('、')}`)
  if (record.tags?.length) lines.push(`- 标签：${record.tags.join('、')}`)
  lines.push('')

  if (record.input?.trim()) {
    lines.push('## 原文', '', '```', record.input.trim(), '```', '')
  }

  if (record.findings.length === 0) {
    lines.push('> 这个案件还没有分析结果。', '')
  }

  for (const finding of record.findings) {
    const meta = ENGINES[finding.engine]
    lines.push(`## ${meta?.zh ?? finding.engine}`, '')
    lines.push(demoteHeadings(finding.body.trim()), '')
    const marks: string[] = []
    if (finding.sources?.length) marks.push(`依据：${finding.sources.join('、')}`)
    if (finding.controversy) marks.push(`争议度：${finding.controversy}`)
    if (marks.length) lines.push(`> ${marks.join(' · ')}`, '')
  }

  if (record.beliefs?.length) {
    lines.push('## 你在这条对话里的立场', '')
    for (const belief of record.beliefs) {
      lines.push(`- ${belief.text}`)
      if (belief.tension) lines.push(`  - 张力：${belief.tension}`)
    }
    lines.push('')
  }

  if (record.notes?.trim()) {
    lines.push('## 备注', '', record.notes.trim(), '')
  }

  lines.push('---', '', `由哲学工作台导出 · ${stamp(new Date().toISOString())}`)
  return lines.join('\n')
}

/** 导出成单文件 HTML：可离线打开、可打印。 */
export function toHtml(record: Case): string {
  const esc = escapeHtml
  const body = record.findings.map(finding => {
    const meta = ENGINES[finding.engine]
    const marks = [
      finding.sources?.length ? `依据：${finding.sources.join('、')}` : '',
      finding.controversy ? `争议度：${finding.controversy}` : '',
    ].filter(Boolean).join(' · ')
    return `<section>
  <h2>${esc(meta?.zh ?? finding.engine)}</h2>
  <div class="prose">
${markdownToHtml(finding.body.trim())}
  </div>
  ${marks ? `<p class="marks">${esc(marks)}</p>` : ''}
</section>`
  }).join('\n')

  const beliefs = record.beliefs?.length
    ? `<section>
  <h2>你在这条对话里的立场</h2>
  <ul class="beliefs">
${record.beliefs.map(b => `    <li>${esc(b.text)}${b.tension ? `<em>张力：${esc(b.tension)}</em>` : ''}</li>`).join('\n')}
  </ul>
</section>`
    : ''

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(record.question)} · 哲学审议</title>
<style>
  :root {
    --bg: #fcfcfb; --fg: #1c1d1f; --muted: #6a6f76; --line: #e2e2de;
    --accent: #2f5fb0; --code-bg: #f2f2ee; --quote: #f7f7f3;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #14161a; --fg: #e4e6e9; --muted: #969ba3; --line: #2a2e35;
      --accent: #8ab0e6; --code-bg: #1d2127; --quote: #191d23;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--bg); color: var(--fg);
    font: 16px/1.95 Georgia, "Songti SC", "Noto Serif CJK SC", "Source Han Serif SC", "Microsoft YaHei", serif;
    text-rendering: optimizeLegibility;
  }
  .wrap { max-width: 46em; margin: 0 auto; padding: 56px 26px 96px; }

  h1 {
    font-size: 1.65em; line-height: 1.5; font-weight: 600;
    margin: 0 0 20px; letter-spacing: .005em;
  }
  .meta {
    font-family: -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
    display: flex; flex-wrap: wrap; gap: 6px 20px;
    font-size: 12.5px; color: var(--muted);
    padding-bottom: 22px; margin-bottom: 34px;
    border-bottom: 1px solid var(--line);
  }
  .meta b { font-weight: 600; color: var(--fg); }

  section { margin: 0 0 44px; }
  section > h2 {
    font-family: -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
    font-size: 13px; font-weight: 650; letter-spacing: .12em;
    color: var(--accent); margin: 0 0 18px;
    padding-bottom: 8px; border-bottom: 1px solid var(--line);
  }

  .prose > *:first-child { margin-top: 0; }
  .prose p { margin: 0 0 1.1em; }
  .prose h3 {
    font-family: -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
    font-size: 15px; font-weight: 650; line-height: 1.6;
    margin: 1.8em 0 .7em; letter-spacing: .01em;
  }
  .prose h4 {
    font-family: -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
    font-size: 14px; font-weight: 600; margin: 1.5em 0 .6em; color: var(--muted);
  }
  .prose strong { font-weight: 650; }
  .prose ul, .prose ol { margin: 0 0 1.1em; padding-left: 1.5em; }
  .prose li { margin: .35em 0; }
  .prose li::marker { color: var(--muted); }
  .prose code {
    font-family: ui-monospace, Menlo, Consolas, monospace; font-size: .86em;
    background: var(--code-bg); border-radius: 4px; padding: .12em .38em;
  }
  .prose blockquote {
    margin: 1.2em 0; padding: .2em 0 .2em 1.1em;
    border-left: 2px solid var(--line); color: var(--muted);
  }
  .prose blockquote p { margin: .3em 0; }
  .prose hr { border: 0; border-top: 1px solid var(--line); margin: 2em 0; }

  .table-wrap { overflow-x: auto; margin: 1.4em 0; }
  .prose table { border-collapse: collapse; width: 100%; font-family: -apple-system, "Microsoft YaHei", sans-serif; font-size: 13.5px; }
  .prose th {
    text-align: left; font-weight: 600; font-size: 12px; letter-spacing: .04em;
    color: var(--muted); padding: 8px 10px; border-bottom: 1px solid var(--line);
    white-space: nowrap;
  }
  .prose td { padding: 8px 10px; border-bottom: 1px solid var(--line); vertical-align: top; line-height: 1.7; }
  .prose tr:last-child td { border-bottom: 0; }
  .prose td:first-child { font-weight: 600; white-space: nowrap; }

  .marks {
    font-family: -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
    margin: 14px 0 0; font-size: 11.5px; color: var(--muted);
  }
  .beliefs { padding-left: 1.3em; margin: 0; }
  .beliefs li { margin: .55em 0; }
  .beliefs em {
    display: block; font-style: normal;
    font-family: -apple-system, "Microsoft YaHei", sans-serif;
    font-size: 12px; color: var(--muted); margin-top: .2em;
  }
  .input-box {
    white-space: pre-wrap; font-size: 14px; color: var(--muted);
    border-left: 2px solid var(--line); padding: 2px 0 2px 14px; margin: 0 0 34px;
  }
  footer {
    margin-top: 64px; padding-top: 16px; border-top: 1px solid var(--line);
    font-family: -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
    font-size: 11.5px; color: var(--muted);
  }
  @media print {
    body { background: #fff; color: #000; }
    .wrap { max-width: none; padding: 0; }
    section { break-inside: avoid; }
    .prose h3, .prose h4 { break-after: avoid; }
  }
</style>
</head>
<body>
<div class="wrap">
  <h1>${esc(record.question)}</h1>
  <div class="meta">
    <span>案件 <b>${esc(record.id)}</b></span>
    <span>模式 <b>${esc(MODE_ZH[record.mode] ?? record.mode)}</b></span>
    <span>${record.personas.length ? `立场 <b>${esc(record.personas.join('、'))}</b>` : '未指定立场'}</span>
    <span>建档 <b>${esc(stamp(record.createdAt))}</b></span>
    ${record.tags?.length ? `<span>标签 <b>${esc(record.tags.join('、'))}</b></span>` : ''}
  </div>
  ${record.input?.trim() ? `<div class="input-box">${esc(record.input.trim())}</div>` : ''}
  ${body || '<p class="input-box">这个案件还没有分析结果。</p>'}
  ${beliefs}
  <footer>由哲学工作台导出 · ${esc(stamp(new Date().toISOString()))}</footer>
</div>
</body>
</html>`
}

/** 安全的下载文件名。 */
export function exportFilename(record: Case, ext: 'md' | 'html'): string {
  const safe = record.question.replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 40) || record.id
  return `${safe}-${record.id}.${ext}`
}
