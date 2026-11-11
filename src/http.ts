/** 面板用的只读 + 轻写 HTTP 路由，仅回环与同源可达。 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import type { CaseStore } from './store.ts'
import type { ConceptStore } from './concepts.ts'
import type { Case, Mode } from './types.ts'
import { ENGINES, ENGINE_ORDER, MODES } from './types.ts'
import { loadPersonas } from './personas.ts'
import { runCase, askCase, readChat, sessionIdFor } from './runner.ts'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { renderMindmap } from './mindmap.ts'
import { exportFilename, toHtml, toMarkdown } from './export.ts'

const PREFIX = '/philosophy-api'
const MARKER = 'dsh-philosophy'

/** 背景图：lib/ 的上一级是插件根，assets/ 跟着插件走，换图不用重编译。 */
const BACKGROUND = new URL('../assets/background.jpg', import.meta.url)

function json(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  })
  res.end(JSON.stringify(value))
}

async function readBody(req: IncomingMessage, maxBytes = 256 * 1024): Promise<unknown> {
  let size = 0
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    const bytes = Buffer.from(chunk)
    size += bytes.length
    if (size > maxBytes) throw new Error('body too large')
    chunks.push(bytes)
  }
  if (size === 0) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
}

function sameOrigin(req: Pick<IncomingMessage, 'headers'>, port: number): boolean {
  const host = req.headers.host
  if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) return false
  return req.headers['x-dsh-philosophy'] === MARKER
    && (req.headers.origin === undefined || req.headers.origin === `http://${host}`)
}

export interface ApiHost {
  store: CaseStore
  concepts: ConceptStore
}

export function registerApi(ctx: Context, host: ApiHost): void {
  const port = (ctx.webServer as unknown as { port?: number }).port ?? 0
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: PREFIX,
    handler: async (req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      const route = url.pathname.slice(PREFIX.length) || '/'
      const method = req.method ?? 'GET'

      // CSS 的 url() 请求由浏览器直接发起，不会带自定义头，所以这一条不走同源校验。
      // 返回的只是背景图，不含案件数据。
      if (method === 'GET' && route === '/background') {
        try {
          const data = await readFile(fileURLToPath(BACKGROUND))
          res.writeHead(200, {
            'content-type': 'image/jpeg',
            'content-length': String(data.length),
            'cache-control': 'public, max-age=86400',
            'x-content-type-options': 'nosniff',
          })
          res.end(data)
        } catch {
          json(res, 404, { error: 'background not found' })
        }
        return
      }

      // 思维导图是浏览器直接打开的单文件页面，和背景图一样不带自定义头，
      // 同样不走同源校验——它是只读页面，不含写入能力。
      if (method === 'GET' && route.startsWith('/mindmap/')) {
        const id = decodeURIComponent(route.slice('/mindmap/'.length))
        const record = await host.store.get(id)
        if (!record) {
          res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' })
          res.end('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>找不到案件</title><p style="font:14px system-ui;padding:24px">找不到这个案件。</p></html>')
          return
        }
        const html = renderMindmap(record)
        res.writeHead(200, {
          'content-type': 'text/html; charset=utf-8',
          'content-length': String(Buffer.byteLength(html)),
          'cache-control': 'no-store',
          'x-content-type-options': 'nosniff',
        })
        res.end(html)
        return
      }

      // 导出同样是浏览器直连的只读页面：Markdown 或单文件 HTML。
      if (method === 'GET' && route.startsWith('/export/')) {
        const rest = route.slice('/export/'.length)
        const dot = rest.lastIndexOf('.')
        const id = decodeURIComponent(dot > 0 ? rest.slice(0, dot) : rest)
        const ext = (dot > 0 ? rest.slice(dot + 1) : 'md').toLowerCase()
        const record = await host.store.get(id)
        if (!record) {
          res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
          res.end('找不到这个案件。')
          return
        }
        const isHtml = ext === 'html' || ext === 'htm'
        const payload = isHtml ? toHtml(record) : toMarkdown(record)
        const name = exportFilename(record, isHtml ? 'html' : 'md')
        res.writeHead(200, {
          'content-type': isHtml ? 'text/html; charset=utf-8' : 'text/markdown; charset=utf-8',
          'content-length': String(Buffer.byteLength(payload)),
          'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
          'cache-control': 'no-store',
          'x-content-type-options': 'nosniff',
        })
        res.end(payload)
        return
      }

      if (!sameOrigin(req, port)) {
        json(res, 403, { error: 'same-origin required' })
        return
      }
      try {
        if (method === 'GET' && route === '/meta') {
          json(res, 200, catalog())
          return
        }
        if (method === 'GET' && route === '/concepts') {
          const concepts = await host.concepts.list()
          const q = url.searchParams.get('q')?.trim()
          const filtered = q
            ? concepts.filter(e => e.term.includes(q) || e.readings.some(r => r.name.includes(q)))
            : concepts
          json(res, 200, { concepts: filtered, total: filtered.length })
          return
        }
        if (method === 'GET' && route === '/cases') {
          const cases = await host.store.list()
          json(res, 200, { cases: cases.map(summarize), total: cases.length })
          return
        }
        // 这两条必须排在「读单个案件」之前，否则 `/cases/<id>/chat` 会被当成 id 吞掉。
        if (method === 'GET' && route.startsWith('/cases/') && route.endsWith('/chat')) {
          const id = decodeURIComponent(route.slice('/cases/'.length, -'/chat'.length))
          try {
            const turns = await readChat(ctx, host.store, id)
            json(res, 200, { turns })
          } catch (error) {
            json(res, 400, { error: error instanceof Error ? error.message : String(error) })
          }
          return
        }
        if (method === 'POST' && route.startsWith('/cases/') && route.endsWith('/ask')) {
          const id = decodeURIComponent(route.slice('/cases/'.length, -'/ask'.length))
          const body = await readBody(req) as { text?: unknown }
          const text = typeof body.text === 'string' ? body.text.trim() : ''
          if (!text) { json(res, 400, { error: 'text required' }); return }
          try {
            const result = await askCase(ctx, host.store, id, text)
            json(res, 200, result)
          } catch (error) {
            json(res, 400, { error: error instanceof Error ? error.message : String(error) })
          }
          return
        }
        if (method === 'GET' && route.startsWith('/cases/')) {
          const id = decodeURIComponent(route.slice('/cases/'.length))
          // `/cases/<id>/run` 这类子路径不该被当成案件 id
          if (id.includes('/')) { json(res, 404, { error: 'not found' }); return }
          const found = await host.store.get(id)
          json(res, found ? 200 : 404, found ? { case: found } : { error: 'not found' })
          return
        }
        if (method === 'POST' && route === '/cases') {
          const body = await readBody(req) as { question?: unknown; mode?: unknown; personas?: unknown; text?: unknown; tags?: unknown }
          const question = typeof body.question === 'string' ? body.question.trim() : ''
          if (!question) { json(res, 400, { error: 'question required' }); return }
          const mode = (typeof body.mode === 'string' && body.mode in MODES ? body.mode : 'advisor') as Mode
          const personas = Array.isArray(body.personas) ? body.personas.filter((p): p is string => typeof p === 'string') : []
          const tags = Array.isArray(body.tags) ? body.tags.filter((t): t is string => typeof t === 'string') : []
          const record = await host.store.open({ question, mode, personas, tags, text: typeof body.text === 'string' ? body.text : undefined })
          json(res, 200, { case: record })
          return
        }
        // 改标签：必须排在「/cases/<id>」之前，否则 tags 会被当成案件 id。
        if (method === 'POST' && route === '/cases/tags') {
          const body = await readBody(req) as { id?: unknown; tags?: unknown }
          const id = typeof body.id === 'string' ? body.id : ''
          const tags = Array.isArray(body.tags) ? body.tags.filter((t): t is string => typeof t === 'string') : []
          const updated = await host.store.setTags(id, tags)
          json(res, updated ? 200 : 404, updated ? { case: summarize(updated) } : { error: 'not found' })
          return
        }
        // 收起分析会话：从会话列表里隐去，案件和日志都保留。
        if (method === 'POST' && route.startsWith('/cases/') && route.endsWith('/archive')) {
          const id = decodeURIComponent(route.slice('/cases/'.length, -'/archive'.length))
          const sessionId = sessionIdFor(id) as SessionId
          try {
            await (ctx as unknown as {
              workspaceRegistry: { archiveSession(sessionId: SessionId, options?: { stopActivity?: boolean }): Promise<void> }
            }).workspaceRegistry.archiveSession(sessionId, { stopActivity: true })
            json(res, 200, { archived: true, sessionId })
          } catch (error) {
            json(res, 400, { error: error instanceof Error ? error.message : String(error) })
          }
          return
        }
        // 取消正在跑的分析会话。
        if (method === 'POST' && route.startsWith('/cases/') && route.endsWith('/cancel')) {
          const id = decodeURIComponent(route.slice('/cases/'.length, -'/cancel'.length))
          const sessionId = sessionIdFor(id) as SessionId
          const live = ctx.agents.get(sessionId)
          if (!live) { json(res, 404, { error: '这个案件还没有分析会话' }); return }
          live.cancel({ kind: 'user' }, { keepInbox: true })
          await host.store.finish(id, 'deliberating')
          json(res, 200, { cancelled: true, sessionId })
          return
        }
        if (method === 'POST' && route.startsWith('/cases/') && route.endsWith('/run')) {
          const id = decodeURIComponent(route.slice('/cases/'.length, -'/run'.length))
          try {
            const result = await runCase(ctx, host.store, id)
            json(res, 200, result)
          } catch (error) {
            json(res, 400, { error: error instanceof Error ? error.message : String(error) })
          }
          return
        }
        if (method === 'POST' && route === '/cases/finish') {
          const body = await readBody(req) as { id?: unknown }
          const id = typeof body.id === 'string' ? body.id : ''
          const done = await host.store.finish(id, 'done')
          json(res, done ? 200 : 404, done ? { case: summarize(done) } : { error: 'not found' })
          return
        }
        if (method === 'DELETE' && route === '/cases') {
          const body = await readBody(req) as { id?: unknown }
          const id = typeof body.id === 'string' ? body.id : ''
          const removed = await host.store.remove(id)
          json(res, removed ? 200 : 404, { removed })
          return
        }
        json(res, 404, { error: 'unknown route' })
      } catch (error) {
        json(res, 500, { error: error instanceof Error ? error.message : String(error) })
      }
    },
  }))
}

function summarize(c: Case) {
  return {
    id: c.id,
    question: c.question,
    mode: c.mode,
    status: c.status,
    personas: c.personas,
    tags: c.tags ?? [],
    engines: c.findings.map(f => f.engine),
    updatedAt: c.updatedAt,
    findings: c.findings.length,
  }
}

function catalog() {
  const lib = loadPersonas()
  return {
    modes: MODES,
    engines: Object.fromEntries(ENGINE_ORDER.map(e => [e, ENGINES[e]])),
    personas: lib.personas,
    defaults: { personas: lib.defaults },
    personasSource: lib.source,
    ...(lib.error ? { personasError: lib.error } : {}),
  }
}
