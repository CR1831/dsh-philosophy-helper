/** 审议地图：把案件渲染成一张自包含的交互式 HTML 思维导图。
 *
 * 数据全部来自案件本身：
 *   中心 = 问题
 *   一层 = 已完成的引擎（正文摘要）
 *   二层 = 参与过的立场（从 persona 列表 + 正文里提到的哲学家名）
 *   连线 = 某个引擎的正文里提到了某个立场
 *
 * 不依赖任何外部库或 CDN，单个 HTML 文件即可离线打开、转发、打印。
 */
import type { Case } from './types.ts'
import { ENGINES, MODES, PERSONAS } from './types.ts'

export interface MapNode {
  id: string
  label: string
  kind: 'root' | 'engine' | 'persona'
  /** 点击节点后在侧栏显示的正文。 */
  body: string
  /** 环形层级：0 中心，1 引擎，2 立场。 */
  ring: number
  /** 引擎节点：争议度。 */
  controversy?: string
  /** 引擎节点：依据标签。 */
  sources?: string[]
  /** 引擎节点：正文字数，决定卡片宽度。 */
  weight?: number
  /** 立场节点：中西传统，用于分区。 */
  tradition?: 'west' | 'cn'
  /** 立场节点：锚点命题。 */
  anchor?: string
  /** 副标题：一行小字，写在主标题下面。 */
  sub?: string
}

export interface MapEdge {
  from: string
  to: string
  /** supports / attacks 表示这是一条论点依赖边。 */
  kind?: 'supports' | 'attacks'
  reason?: string
}

/** 去掉 Markdown 标记，留纯文本摘要。 */
function plain(markdown: string): string {
  return markdown
    .replace(/\r/g, '')
    .replace(/^#{1,4}\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/^\|/gm, '')
    .replace(/\|/g, ' · ')
    .replace(/^[-—]{3,}$/gm, '')
    .replace(/\n{2,}/g, '\n')
    .trim()
}

/** 从引擎正文里挖出提到这个人的那一段，前后各带一点上下文。 */
function usageSnippet(body: string, name: string): string {
  const paras = body.split(/\n{2,}/).filter(p => p.includes(name))
  if (paras.length === 0) return ''
  return paras.slice(0, 2).map(para => {
    const idx = para.indexOf(name)
    const start = Math.max(0, idx - 80)
    const end = Math.min(para.length, idx + name.length + 150)
    const flat = para.slice(start, end).replace(/\s+/g, ' ').trim()
    return `${start > 0 ? '…' : ''}${flat}${end < para.length ? '…' : ''}`
  }).join('\n\n')
}

/** 从正文里找出提到的哲学家。 */
function mentioned(record: Case): string[] {
  const bag = new Set(record.personas)
  const all = record.findings.map(f => f.body).join('\n')
  for (const persona of PERSONAS) {
    if (all.includes(persona.zh)) bag.add(persona.id)
  }
  return [...bag]
}

export function buildMap(record: Case): { nodes: MapNode[]; edges: MapEdge[] } {
  const nodes: MapNode[] = [
    {
      id: '__root',
      label: record.question,
      kind: 'root',
      body: record.input ?? record.question,
      ring: 0,
      sub: `${MODES[record.mode]?.zh ?? record.mode} · ${record.findings.length} 项分析 · ${record.personas.length} 位立场`,
    },
  ]
  const edges: MapEdge[] = []

  for (const finding of record.findings) {
    const meta = ENGINES[finding.engine]
    const id = `e:${finding.engine}`
    nodes.push({
      id,
      label: meta?.zh ?? finding.engine,
      kind: 'engine',
      body: finding.body,
      ring: 1,
      ...(finding.controversy ? { controversy: finding.controversy } : {}),
      ...(finding.sources?.length ? { sources: finding.sources } : {}),
      weight: finding.body.length,
      sub: [...(finding.sources ?? []).slice(0, 2), `${(finding.body.length / 1000).toFixed(1)}k 字`].join(' · '),
    })
    edges.push({ from: '__root', to: id })
  }

  // 论点依赖：引擎之间谁支撑谁、谁反驳谁。只连到真实存在的引擎。
  for (const finding of record.findings) {
    for (const link of finding.links ?? []) {
      if (!record.findings.some(f => f.engine === link.to)) continue
      if (link.to === finding.engine) continue
      edges.push({
        from: `e:${finding.engine}`,
        to: `e:${link.to}`,
        kind: link.kind,
        ...(link.reason ? { reason: link.reason } : {}),
      })
    }
  }

  const people = mentioned(record)
  for (const personaId of people) {
    const persona = PERSONAS.find(p => p.id === personaId)
    if (!persona) continue
    const id = `p:${persona.id}`
    // 哪个引擎提到了他，就连到哪个引擎；一个都没提到就连回中心。
    const linked = record.findings.filter(f => f.body.includes(persona.zh))

    // 侧栏先给「在本案里被怎么用」，再给人物简介
    const usage = linked
      .map(finding => {
        const engine = ENGINES[finding.engine]?.zh ?? finding.engine
        const snippet = usageSnippet(finding.body, persona.zh)
        if (!snippet) return ''
        const quoted = snippet.split(/\n{2,}/).map(p => `> ${p}`).join('\n>\n')
        return `> **${engine}**\n>\n${quoted}`
      })
      .filter(Boolean)
      .join('\n\n')
    const intro = [persona.intro ?? '', persona.anchor ? `锚点：${persona.anchor}` : ''].filter(Boolean).join('\n\n')

    nodes.push({
      id,
      label: persona.zh,
      kind: 'persona',
      body: [
        usage ? `## 在本案中的使用\n\n${usage}` : '',
        intro ? `## 人物简介\n\n${intro}` : '',
      ].filter(Boolean).join('\n\n'),
      ring: 2,
      ...(persona.tradition ? { tradition: persona.tradition } : {}),
      ...(persona.anchor ? { anchor: persona.anchor } : {}),
      sub: `${persona.tradition === 'cn' ? '中哲 / 佛学' : '西方'} · ${linked.length} 处提及`,
    })
    if (linked.length === 0) edges.push({ from: '__root', to: id })
    for (const finding of linked) edges.push({ from: `e:${finding.engine}`, to: id })
  }

  return { nodes, edges }
}

// 必须用 String.raw：模板字符串会把正则里的 \* \n \s \d 当转义序列吃掉，
// 生成出来的 JS 正则就散了（之前整段脚本因为语法错误直接不执行）。
const HTML = (data: string, title: string) => String.raw`<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title} · 审议地图</title>
<style>
  :root {
    /* 近白的暖纸，配纯白卡片；层次靠描边而不是明度差 */
    --bg: #fefdfa; --fg: #1c1814; --muted: #7b7062; --line: #dcd1c0;
    --dot: #f3efe6;
    --card: #ffffff; --accent: #b45309; --accent-soft: rgba(180,83,9,.07);
    --root: #b45309; --engine: #6b7c4a; --persona: #b9713f; --cn: #9a3b3b; --danger: #a8331f;
    --shadow: 0 1px 2px rgba(120,95,70,.05);
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #221e1a; --fg: #f2ebe0; --muted: #b0a393; --line: #4a4036;
      --dot: #2e2822;
      --card: #2e2925; --accent: #e8a862; --accent-soft: rgba(232,168,98,.14);
      --root: #df9142; --engine: #a8ba80; --persona: #e6a06d; --cn: #e28881; --danger: #e67862;
      --shadow: 0 1px 3px rgba(0,0,0,.35);
    }
  }
  * { box-sizing: border-box; }
  html, body { height: 100%; margin: 0; }
  body {
    background: var(--bg); color: var(--fg);
    font: 14px/1.65 -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
    display: flex; flex-direction: column;
  }
  header {
    display: flex; align-items: center; gap: 14px; flex-wrap: wrap;
    padding: 14px 20px; border-bottom: 1px solid var(--line);
    background: color-mix(in srgb, var(--bg) 92%, transparent);
  }
  header h1 { margin: 0; font-size: 17px; font-weight: 650; letter-spacing: .01em; }
  header .meta { color: var(--muted); font-size: 12px; }
  .legend { display: flex; gap: 16px; flex-wrap: wrap; font-size: 12px; color: var(--muted); margin-left: auto; }
  .legend span { display: inline-flex; align-items: center; gap: 6px; }
  .legend i.lg-dot { display: inline-block; width: 9px; height: 9px; border-radius: 3px; }
  .legend i.lg-line { display: inline-block; width: 18px; border-top: 2px solid var(--line); }
  .legend i.lg-line.solid { border-color: var(--engine); }
  .legend i.lg-line.dash { border-color: var(--danger); border-top-style: dashed; }
  main { flex: 1; display: flex; min-height: 0; }
  #stage {
    flex: 1; position: relative; min-width: 0; overflow: hidden;
    background-color: var(--bg);
    background-image: radial-gradient(var(--dot) 1px, transparent 1px);
    background-size: 26px 26px;
    background-position: 0 0;
  }
  svg { width: 100%; height: 100%; display: block; cursor: grab; }
  svg.dragging { cursor: grabbing; }

  .edge { stroke: var(--line); stroke-width: 1.6; fill: none; opacity: .85; transition: stroke .15s, opacity .15s; }
  .edge.supports { stroke: var(--engine); stroke-width: 1.8; opacity: .9; }
  .edge.attacks { stroke: var(--danger); stroke-width: 1.8; stroke-dasharray: 7 5; opacity: .9; }
  .edge.hi { stroke: var(--accent); stroke-width: 1.8; opacity: 1; stroke-dasharray: none; }

  /* 图版装饰：表头、分隔栏、行基线、图注 */
  .decor { pointer-events: none; }
  .rule { stroke: var(--line); stroke-width: 1; }
  .rule-v { stroke: var(--line); stroke-width: 1; stroke-dasharray: 2 5; opacity: .7; }
  .rule-row { stroke: var(--line); stroke-width: 1; opacity: .55; }
  .col-head {
    fill: var(--muted);
    font-size: 11px;
    font-weight: 600;
    letter-spacing: .16em;
    text-anchor: middle;
  }
  .col-head.west { fill: var(--persona); }
  .col-head.cn { fill: var(--cn); }
  .caption { fill: var(--muted); font-size: 11px; letter-spacing: .02em; }

  .node { cursor: pointer; animation: nodeIn .42s ease-out backwards; }
  @keyframes nodeIn { from { opacity: 0; } to { opacity: 1; } }
  @media (prefers-reduced-motion: reduce) {
    .node { animation: none; }
  }
  .node rect {
    fill: var(--card);
    stroke: var(--line);
    stroke-width: 1;
    filter: drop-shadow(var(--shadow));
    transition: stroke .15s, fill .15s;
  }
  .node-bar { fill: var(--line); transition: fill .15s; }
  .node.engine .node-bar { fill: var(--engine); }
  .node.persona .node-bar { fill: var(--persona); }
  .node.persona[data-tradition='cn'] .node-bar { fill: var(--cn); }
  .node.root .node-bar { fill: rgba(255, 253, 248, .55); }
  .node text { fill: var(--fg); font-size: 13px; text-anchor: start; pointer-events: none; }
  .node .node-sub { font-size: 10.5px; fill: var(--muted); letter-spacing: .01em; }
  .node.root .node-sub { fill: rgba(255,255,255,.82); }
  .node.root rect { fill: var(--root); stroke: var(--root); }
  .node.root text { fill: #fffdf8; font-weight: 650; font-size: 13.5px; }
  .node.engine rect { stroke: var(--line); }
  .node.persona rect { stroke: var(--line); }
  .node.persona[data-tradition='cn'] rect { stroke: var(--line); }
  .node:hover rect { stroke: var(--muted); }
  .node.active rect { fill: var(--accent-soft); stroke: var(--accent); }
  .node.persona.active rect { fill: color-mix(in srgb, var(--persona) 10%, transparent); stroke: var(--persona); }
  .node.persona[data-tradition='cn'].active rect { fill: color-mix(in srgb, var(--cn) 10%, transparent); stroke: var(--cn); }
  .node.dim { opacity: .14; }
  .node.flash rect { stroke: var(--muted); stroke-width: 1.6; }

  .badge { pointer-events: none; }
  .badge circle { stroke-width: 0; }

  /* 顶部工具条：搜索 + 过滤 */
  .tools {
    display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
    padding: 0 20px 12px; border-bottom: 1px solid var(--line);
  }
  #search {
    flex: 1 1 180px; min-width: 140px;
    font: inherit; font-size: 13px;
    padding: 7px 11px; border-radius: 9px;
    border: 1px solid var(--line); background: var(--card); color: var(--fg);
  }
  #search:focus { outline: none; border-color: var(--accent); }
  .filters { display: flex; gap: 4px; }
  .filters button {
    font: inherit; font-size: 12px; padding: 6px 11px;
    border-radius: 8px; border: 1px solid var(--line);
    background: transparent; color: var(--muted); cursor: pointer;
  }
  .filters button[data-on='true'] {
    border-color: var(--accent); color: var(--accent);
    background: var(--accent-soft);
  }

  aside {
    width: 380px; max-width: 44vw; border-left: 1px solid var(--line);
    padding: 20px 22px; overflow-y: auto; background: var(--bg);
  }
  .node.root rect {
    filter: drop-shadow(0 8px 22px color-mix(in srgb, var(--root) 40%, transparent));
  }
  aside h2 { margin: 0 0 6px; font-size: 18px; line-height: 1.4; letter-spacing: -.01em; }
  aside .meta {
    display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px;
  }
  aside .meta span {
    font-size: 11px; padding: 2px 8px; border-radius: 999px;
    border: 1px solid var(--line); color: var(--muted);
  }
  aside .kind {
    display: inline-block; font-size: 11px; letter-spacing: .08em;
    padding: 2px 8px; border-radius: 999px; border: 1px solid var(--line); color: var(--muted);
  }
  aside .body {
    margin-top: 16px; padding-top: 14px;
    border-top: 1px solid var(--line);
    font-size: 13.5px; line-height: 1.85;
  }
  aside::-webkit-scrollbar { width: 9px; }
  aside::-webkit-scrollbar-track { background: transparent; }
  aside::-webkit-scrollbar-thumb {
    background: var(--line); border-radius: 5px; border: 2px solid var(--bg);
  }
  aside::-webkit-scrollbar-thumb:hover { background: var(--muted); }
  aside .body p { margin: 0 0 10px; }
  aside .body p.row { color: var(--fg); }
  aside .body h3 {
    margin: 16px 0 8px; font-size: 14px; font-weight: 650;
    color: var(--accent); letter-spacing: .01em;
  }
  aside .body h3:first-child { margin-top: 0; }
  aside .body ul, aside .body ol { margin: 0 0 10px; padding-left: 20px; }
  aside .body li { margin: 3px 0; }
  aside .body strong { font-weight: 650; }
  aside .body code {
    font-family: ui-monospace, Menlo, monospace; font-size: 12px;
    background: var(--card); border: 1px solid var(--line);
    border-radius: 5px; padding: 1px 5px;
  }
  aside .body hr { border: 0; border-top: 1px solid var(--line); margin: 14px 0; }
  aside .body blockquote {
    margin: 10px 0;
    padding: 9px 13px;
    border-left: 3px solid var(--accent);
    background: var(--card);
    border-radius: 0 7px 7px 0;
  }
  aside .body blockquote p { margin: 0 0 7px; font-size: 13px; line-height: 1.8; }
  aside .body blockquote p:last-child { margin-bottom: 0; }
  aside .body blockquote strong {
    display: block;
    font-size: 11px;
    letter-spacing: .06em;
    color: var(--accent);
    margin-bottom: 2px;
  }
  aside .empty { color: var(--muted); font-size: 13.5px; }
  aside .hint { margin-top: 18px; font-size: 12px; color: var(--muted); }
  footer { padding: 9px 20px; border-top: 1px solid var(--line); color: var(--muted); font-size: 11.5px; }
</style>
</head>
<body>
<header>
  <h1 id="title"></h1>
  <span class="meta" id="meta"></span>
  <span class="legend">
    <span><i class="lg-dot" style="background:var(--root)"></i>问题</span>
    <span><i class="lg-dot" style="background:var(--engine)"></i>分析</span>
    <span><i class="lg-dot" style="background:var(--persona)"></i>西哲</span>
    <span><i class="lg-dot" style="background:var(--cn)"></i>中哲</span>
    <span><i class="lg-line solid"></i>支撑</span>
    <span><i class="lg-line dash"></i>反驳</span>
  </span>
</header>
<div class="tools">
  <input id="search" type="search" placeholder="搜节点名…" autocomplete="off" />
  <div class="filters">
    <button type="button" data-filter="all" data-on="true">全部</button>
    <button type="button" data-filter="claims">只看论点</button>
    <button type="button" data-filter="stances">只看立场</button>
  </div>
</div>
<main>
  <div id="stage"><svg id="map"></svg></div>
  <aside>
    <h2 id="side-title">点一个节点</h2>
    <div class="kind" id="side-kind"></div>
    <div class="meta" id="side-meta"></div>
    <div class="body" id="side-body"><span class="empty">节点上只显示摘要，点开看全文。</span></div>
    <div class="hint">拖动空白处平移 · 滚轮缩放 · 点节点看全文</div>
  </aside>
</main>
<footer>离线可用的单文件页面 · 数据来自案件本身</footer>
<script>
const DATA = ${data};
const KIND = { root: '问题', engine: '分析', persona: '立场' };
const NS = 'http://www.w3.org/2000/svg';
const svg = document.getElementById('map');

document.getElementById('title').textContent = DATA.title;
document.getElementById('meta').textContent = DATA.meta;

// 卡片尺寸：中心最大，引擎次之，立场最小
// 结构主义图版：横排文字、近乎直角、细框
const SPEC = {
  root:    { w: 340, h: 84, rx: 3, perLine: 23, lineH: 22 },
  engine:  { w: 212, h: 70, rx: 3, perLine: 10, lineH: 18 },
  persona: { w: 182, h: 60, rx: 3, perLine: 8,  lineH: 17 }
};

function wrap(text, perLine, maxLines) {
  const chars = [...text];
  const lines = [];
  for (let i = 0; i < chars.length; i += perLine) lines.push(chars.slice(i, i + perLine).join(''));
  if (lines.length > maxLines) {
    lines.length = maxLines;
    lines[maxLines - 1] = lines[maxLines - 1].slice(0, perLine - 1) + '…';
  }
  return lines;
}

// 节点上只放纯文字，去掉 Markdown 标记
function cleanLabel(text) {
  return String(text).replace(/[*#\x60_~]/g, '').replace(/\s+/g, ' ').trim();
}

// 侧栏把 Markdown 转成最简 HTML：标题 / 列表 / 粗体 / 代码 / 分隔线 / 表格压成一行
function esc(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function mdToHtml(src) {
  const inline = t => t
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\x60([^\x60\n]+)\x60/g, '<code>$1</code>');
  const out = [];
  let list = null;
  const closeList = () => { if (list) { out.push('</' + list + '>'); list = null; } };
  for (const raw of esc(String(src)).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) { closeList(); continue; }
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) { closeList(); out.push('<h3>' + inline(h[2]) + '</h3>'); continue; }
    if (/^[-—]{3,}$/.test(line)) { closeList(); out.push('<hr>'); continue; }
    if (line.startsWith('|')) {
      closeList();
      const cells = line.replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim()).filter(Boolean);
      if (cells.length && cells.every(c => /^:?-{2,}:?$/.test(c))) continue;
      if (cells.length) out.push('<p class="row">' + cells.map(inline).join(' · ') + '</p>');
      continue;
    }
    const ol = /^\d+\.\s+(.*)$/.exec(line);
    const ul = /^[-*+]\s+(.*)$/.exec(line);
    if (ol || ul) {
      const kind = ol ? 'ol' : 'ul';
      if (list !== kind) { closeList(); out.push('<' + kind + '>'); list = kind; }
      out.push('<li>' + inline((ol || ul)[1]) + '</li>');
      continue;
    }
    closeList();
    out.push('<p>' + inline(line) + '</p>');
  }
  closeList();
  return out.join('');
}

// 结构主义图版：中列分析，左列西哲，右列中哲，问题压顶
const COL_GAP = 244;
const ROW_H = 92;
const buckets = { root: [], engine: [], west: [], cn: [], other: [] };
for (const n of DATA.nodes) {
  if (n.kind === 'root') buckets.root.push(n);
  else if (n.kind === 'engine' || n.ring === 1) buckets.engine.push(n);
  else if (n.tradition === 'cn') buckets.cn.push(n);
  else if (n.tradition === 'west') buckets.west.push(n);
  else buckets.other.push(n);
}

const rows = Math.max(buckets.engine.length, buckets.west.length, buckets.cn.length, buckets.other.length, 1);
const bodyH = rows * ROW_H;
const bodyTop = -bodyH / 2;

function placeColumn(list, x) {
  const offset = (bodyH - list.length * ROW_H) / 2;
  list.forEach((node, i) => {
    node.x = x;
    node.y = bodyTop + offset + i * ROW_H + ROW_H / 2;
  });
}

buckets.root.forEach(n => { n.x = 0; n.y = bodyTop - 92; });
placeColumn(buckets.west, -COL_GAP);
placeColumn(buckets.engine, 0);
placeColumn(buckets.cn, COL_GAP);
placeColumn(buckets.other, COL_GAP * 2);

/** 正交折线：纵向直下，横向先走到中缝再拐。 */
function linkPath(a, b) {
  if (Math.abs(a.x - b.x) < 1) return 'M ' + a.x + ' ' + a.y + ' L ' + b.x + ' ' + b.y;
  const midX = (a.x + b.x) / 2;
  return 'M ' + a.x + ' ' + a.y + ' H ' + midX + ' V ' + b.y + ' H ' + b.x;
}

const CONTROVERSY = {
  consensus: ['共识', 'var(--engine)'],
  debatable: ['可辩', 'var(--persona)'],
  contested: ['争议', 'var(--danger)'],
  speculative: ['推测', 'var(--muted)'],
};

const pos = new Map(DATA.nodes.map(n => [n.id, n]));

// 箭头：支撑实线、反驳虚线，各自一个 marker
const defs = document.createElementNS(NS, 'defs');
for (const kind of ['supports', 'attacks']) {
  const marker = document.createElementNS(NS, 'marker');
  marker.setAttribute('id', 'arrow-' + kind);
  marker.setAttribute('viewBox', '0 0 8 8');
  marker.setAttribute('refX', '7');
  marker.setAttribute('refY', '4');
  marker.setAttribute('markerWidth', '7');
  marker.setAttribute('markerHeight', '7');
  marker.setAttribute('orient', 'auto-start-reverse');
  const tip = document.createElementNS(NS, 'path');
  tip.setAttribute('d', 'M0,0 L8,4 L0,8 z');
  tip.setAttribute('fill', kind === 'supports' ? 'var(--engine)' : 'var(--danger)');
  marker.appendChild(tip);
  defs.appendChild(marker);
}
svg.appendChild(defs);

const gRoot = document.createElementNS(NS, 'g');
svg.appendChild(gRoot);

// ── 图版装饰：列头、分隔栏、行基线、图注 ──
// 结构主义的图靠这些「架」立住，而不只是靠节点。
const gDecor = document.createElementNS(NS, 'g');
gDecor.setAttribute('class', 'decor');
gRoot.appendChild(gDecor);

const HEAD_Y = bodyTop - 152;
const BOTTOM = bodyTop + bodyH + 24;

function decorLine(x1, y1, x2, y2, cls) {
  const line = document.createElementNS(NS, 'line');
  line.setAttribute('x1', String(x1));
  line.setAttribute('y1', String(y1));
  line.setAttribute('x2', String(x2));
  line.setAttribute('y2', String(y2));
  line.setAttribute('class', cls);
  gDecor.appendChild(line);
}

function decorLabel(text, x, y, cls) {
  const t = document.createElementNS(NS, 'text');
  t.setAttribute('x', String(x));
  t.setAttribute('y', String(y));
  t.setAttribute('class', cls);
  t.textContent = text;
  gDecor.appendChild(t);
}

// 列头分隔线（横贯三列）
decorLine(-COL_GAP - 140, HEAD_Y + 12, COL_GAP + 140, HEAD_Y + 12, 'rule');
// 列与列之间的竖虚线
for (const x of [-COL_GAP / 2, COL_GAP / 2]) {
  decorLine(x, HEAD_Y + 12, x, BOTTOM, 'rule-v');
}
// 表头
decorLabel('西方传统', -COL_GAP, HEAD_Y, 'col-head west');
decorLabel('分析结构', 0, HEAD_Y, 'col-head');
decorLabel('中国 / 佛学', COL_GAP, HEAD_Y, 'col-head cn');

// 每一行的极淡横线，像账本
for (let i = 1; i < rows; i += 1) {
  const y = bodyTop + i * ROW_H;
  decorLine(-COL_GAP - 140, y, COL_GAP + 140, y, 'rule-row');
}

// 底部收口 + 图注
decorLine(-COL_GAP - 140, BOTTOM, COL_GAP + 140, BOTTOM, 'rule');
decorLabel(
  '图 1 · 审议结构：问题在上，分析居中，两个传统分列两侧',
  -COL_GAP - 140,
  BOTTOM + 26,
  'caption',
);

// 边：先画，压在节点下面
const edgeEls = [];
for (const e of DATA.edges) {
  const a = pos.get(e.from), b = pos.get(e.to);
  if (!a || !b) continue;
  const path = document.createElementNS(NS, 'path');
  path.setAttribute('d', linkPath(a, b));
  path.setAttribute('class', e.kind ? 'edge ' + e.kind : 'edge');
  if (e.kind) path.setAttribute('marker-end', 'url(#arrow-' + e.kind + ')');
  if (e.reason) path.appendChild(document.createElementNS(NS, 'title')).textContent = e.reason;
  path.dataset.from = e.from;
  path.dataset.to = e.to;
  if (e.kind) path.dataset.kind = e.kind;
  gRoot.appendChild(path);
  edgeEls.push(path);
}

// 节点：圆角卡片 + 自动折行的文字
const nodeEls = new Map();
let engineSeq = 0;
for (const n of DATA.nodes) {
  const spec = SPEC[n.kind] || SPEC.engine;
  const g = document.createElementNS(NS, 'g');
  g.setAttribute('class', 'node ' + n.kind);
  g.setAttribute('transform', 'translate(' + n.x + ',' + n.y + ')');
  g.style.animationDelay = (DATA.nodes.indexOf(n) * 32) + 'ms';
  if (n.tradition) g.dataset.tradition = n.tradition;

  const rect = document.createElementNS(NS, 'rect');
  rect.setAttribute('x', String(-spec.w / 2));
  rect.setAttribute('y', String(-spec.h / 2));
  rect.setAttribute('width', String(spec.w));
  rect.setAttribute('height', String(spec.h));
  rect.setAttribute('rx', String(spec.rx));
  g.appendChild(rect);

  // 左侧色条：像表格的行首标记，类型靠它区分，边框统一留白
  const bar = document.createElementNS(NS, 'rect');
  bar.setAttribute('class', 'node-bar');
  bar.setAttribute('x', String(-spec.w / 2));
  bar.setAttribute('y', String(-spec.h / 2));
  bar.setAttribute('width', '3');
  bar.setAttribute('height', String(spec.h));
  bar.setAttribute('rx', '1.5');
  g.appendChild(bar);

  const lines = wrap(cleanLabel(n.label), spec.perLine, 3);
  const text = document.createElementNS(NS, 'text');
  const top = -((lines.length - 1) * spec.lineH) / 2 - (n.sub ? 7 : 0);
  for (let i = 0; i < lines.length; i++) {
    const tspan = document.createElementNS(NS, 'tspan');
    tspan.setAttribute('x', String(-spec.w / 2 + 14));
    tspan.setAttribute('y', String(top + i * spec.lineH));
    tspan.textContent = lines[i];
    text.appendChild(tspan);
  }
  g.appendChild(text);

  // 副标题：字数、依据、传统——让卡片本身带信息
  if (n.sub) {
    const sub = document.createElementNS(NS, 'text');
    sub.setAttribute('class', 'node-sub');
    sub.setAttribute('x', String(-spec.w / 2 + 14));
    sub.setAttribute('y', String(spec.h / 2 - 12));
    sub.textContent = n.sub;
    g.appendChild(sub);
  }

  // 引擎卡片左上角编号，方便和面板里的顺序对上
  if (n.kind === 'engine') {
    engineSeq += 1;
    const seq = document.createElementNS(NS, 'text');
    seq.setAttribute('x', String(-spec.w / 2 + 9));
    seq.setAttribute('y', String(-spec.h / 2 + 13));
    seq.setAttribute('font-size', '9.5');
    seq.setAttribute('fill', 'var(--engine)');
    seq.setAttribute('text-anchor', 'start');
    seq.textContent = '0' + engineSeq;
    g.appendChild(seq);
  }

  // 引擎卡片右上角挂一个争议度小标记
  if (n.kind === 'engine' && n.controversy && CONTROVERSY[n.controversy]) {
    const [label, color] = CONTROVERSY[n.controversy];
    const badge = document.createElementNS(NS, 'g');
    badge.setAttribute('class', 'badge');
    badge.setAttribute('transform', 'translate(' + (spec.w / 2 + 6) + ',-4)');
    const dot = document.createElementNS(NS, 'circle');
    dot.setAttribute('r', '4');
    dot.setAttribute('fill', color);
    badge.appendChild(dot);
    const bt = document.createElementNS(NS, 'text');
    bt.setAttribute('x', '-8');
    bt.setAttribute('y', '3.5');
    bt.setAttribute('text-anchor', 'end');
    bt.setAttribute('font-size', '9.5');
    bt.setAttribute('fill', color);
    bt.textContent = label;
    badge.appendChild(bt);
    g.appendChild(badge);
  }

  g.addEventListener('click', ev => { ev.stopPropagation(); select(n.id); });
  g.addEventListener('mouseenter', () => { hoverNodeId = n.id; paintEdges(); });
  g.addEventListener('mouseleave', () => { hoverNodeId = null; paintEdges(); });
  gRoot.appendChild(g);
  nodeEls.set(n.id, g);
}

let activeNodeId = null;
let hoverNodeId = null;

/** 选中或悬停时，把相关的边点亮。悬停优先——移开就回到选中状态。 */
function paintEdges() {
  const focus = hoverNodeId || activeNodeId;
  for (const el of edgeEls) {
    const hit = focus ? (el.dataset.from === focus || el.dataset.to === focus) : false;
    el.classList.toggle('hi', hit);
  }
}

function select(id) {
  const n = pos.get(id);
  if (!n) return;
  activeNodeId = id;
  for (const [k, el] of nodeEls) el.classList.toggle('active', k === id);
  paintEdges();
  document.getElementById('side-title').textContent = cleanLabel(n.label);
  document.getElementById('side-kind').textContent = KIND[n.kind] || '';

  // 侧栏顶部的小标签：争议度、依据、传统、字数
  const metaEl = document.getElementById('side-meta');
  metaEl.textContent = '';
  const chips = [];
  if (n.controversy && CONTROVERSY[n.controversy]) chips.push(CONTROVERSY[n.controversy][0]);
  if (n.sources && n.sources.length) chips.push('依据 ' + n.sources.join('·'));
  if (n.tradition) chips.push(n.tradition === 'cn' ? '中哲' : '西哲');
  if (n.weight) chips.push(Math.round(n.weight / 100) / 10 + 'k 字');
  for (const c of chips) {
    const span = document.createElement('span');
    span.textContent = c;
    metaEl.appendChild(span);
  }

  const body = document.getElementById('side-body');
  body.innerHTML = n.body ? mdToHtml(n.body) : '<span class="empty">（无内容）</span>';
  document.querySelector('aside').scrollTop = 0;
}

// 平移 + 缩放：只在空白处按下才拖动，否则点节点会被拖拽吞掉
let tx = 0, ty = 0, scale = 1, dragging = false, lastX = 0, lastY = 0;
function apply() {
  gRoot.setAttribute('transform', 'translate(' + tx + ',' + ty + ') scale(' + scale + ')');
}
svg.addEventListener('mousedown', ev => {
  if (ev.target.closest && ev.target.closest('.node')) return;
  dragging = true; lastX = ev.clientX; lastY = ev.clientY; svg.classList.add('dragging');
});
window.addEventListener('mouseup', () => { dragging = false; svg.classList.remove('dragging'); });
window.addEventListener('mousemove', ev => {
  if (!dragging) return;
  tx += ev.clientX - lastX; ty += ev.clientY - lastY;
  lastX = ev.clientX; lastY = ev.clientY;
  apply();
});
svg.addEventListener('wheel', ev => {
  ev.preventDefault();
  const factor = ev.deltaY < 0 ? 1.12 : 0.89;
  const next = Math.min(2.4, Math.max(0.35, scale * factor));
  const rect = svg.getBoundingClientRect();
  const cx = ev.clientX - rect.left - rect.width / 2;
  const cy = ev.clientY - rect.top - rect.height / 2;
  tx = cx - (cx - tx) * (next / scale);
  ty = cy - (cy - ty) * (next / scale);
  scale = next;
  apply();
}, { passive: false });

// 搜索：匹配的高亮，其余淡出
const searchEl = document.getElementById('search');
searchEl.addEventListener('input', () => {
  const q = searchEl.value.trim();
  for (const [id, el] of nodeEls) {
    const n = pos.get(id);
    const hit = !q || (n && cleanLabel(n.label).includes(q));
    el.classList.toggle('dim', Boolean(q) && !hit);
    el.classList.toggle('flash', Boolean(q) && hit);
  }
});

// 过滤边：全部 / 只看论点关系 / 只看立场连接
let filterMode = 'all';
const isPersonaEdge = el => el.dataset.from.startsWith('p:') || el.dataset.to.startsWith('p:');
function applyFilter() {
  for (const el of edgeEls) {
    let show = true;
    if (filterMode === 'claims') show = Boolean(el.dataset.kind);
    else if (filterMode === 'stances') show = isPersonaEdge(el);
    el.style.display = show ? '' : 'none';
  }
}
for (const btn of document.querySelectorAll('.filters button')) {
  btn.addEventListener('click', () => {
    filterMode = btn.dataset.filter;
    for (const other of document.querySelectorAll('.filters button')) {
      other.dataset.on = String(other === btn);
    }
    applyFilter();
  });
}

// 按需适配：让整张图刚好落在可视区
function fit() {
  const rect = svg.getBoundingClientRect();
  const halfW = COL_GAP + 320;
  const halfH = bodyH / 2 + 210;
  const next = Math.min(rect.width / (halfW * 2), rect.height / (halfH * 2), 1.1);
  scale = Math.max(0.3, next);
  tx = rect.width / 2; ty = rect.height / 2;
  apply();
}
fit();
window.addEventListener('resize', fit);
</script>
</body>
</html>`

/** 生成可以直接给浏览器打开的单文件 HTML。 */
export function renderMindmap(record: Case): string {
  const { nodes, edges } = buildMap(record)
  const payload = JSON.stringify({
    title: record.question,
    meta: `${record.id} · ${record.findings.length} 项分析 · ${nodes.filter(n => n.kind === 'persona').length} 个立场`,
    nodes,
    edges,
  }).replace(/</g, '\\u003c')
  return HTML(payload, record.question.replace(/[<>&]/g, ''))
}
