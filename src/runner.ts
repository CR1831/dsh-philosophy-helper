/** 一键推进：为每个案件开一个**专用会话**跑引擎，不占用当前对话。
 *
 * 会话 id 固定为 `philosophy-<caseId>`，所以同一个案件反复推进复用同一个会话，
 * 历史会累积在它自己的会话里。专用会话建不出来时回退到当前会话，保证功能不哑火。
 */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import type {} from '@deepseek-ai/dsh-workspace'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-llm'
import { freezeMessage, MessageId, type UserMessage } from '@deepseek-ai/dsh-llm'
import type { CaseStore } from './store.ts'
import { defaultStateDir } from './store.ts'
import { ENGINES, MODE_ENGINES, MODES, type Case, type Engine } from './types.ts'

// 插件自己的消息来源，不冒充人的输入。role 用来区分「自动派工」和「殿下手动追问」。
declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'dsh-philosophy': { kind: 'dsh-philosophy'; role?: 'dispatch' | 'user' }
  }
}

export interface RunResult {
  /** 实际干活的会话 id。 */
  sessionId: string
  /** 是否落在专用会话里（false 表示回退到了当前对话）。 */
  dedicated: boolean
  /** 回退原因，面板可以显示出来排查。 */
  fallbackReason?: string
  /** 这次派下去的引擎。 */
  engines: Engine[]
  /** 注入给 agent 的正文，面板可以显示。 */
  text: string
}

/** 案件的专用会话 id。 */
export const sessionIdFor = (caseId: string): string => `philosophy-${caseId}`

/** 选出要干活的主会话：优先当前发起者，否则取最新的根会话。回退路径用。 */
function pickAgent(ctx: Context): Agent {
  const current = ctx.agents.currentInitiator()
  if (current) return current
  const roots = ctx.agents.roots()
  if (roots.length === 0) throw new Error('没有可用的会话')
  return roots[roots.length - 1]!
}

/** 解析或创建案件的专用会话。 */
async function ensureSession(ctx: Context, caseId: string, title: string): Promise<Agent> {
  const id = sessionIdFor(caseId) as SessionId
  let resolved = await ctx.sessionController.resolveAgent(id)
  if ('error' in resolved && resolved.error.code === 'session/not-found') {
    // 直接传 cwd，不经过 workspaceRegistry：create 自己会处理归属。
    const cwd = defaultStateDir()
    await ctx.sessionController.create({ sessionId: id, cwd, agentPreset: 'standard' })
    resolved = await ctx.sessionController.resolveAgent(id)
    if (!('error' in resolved)) {
      await ctx.sessionController.rename({ sessionId: id, title }).catch(() => undefined)
    }
  }
  if ('error' in resolved) throw resolved.error
  return resolved.agent
}

/** 算出这个案件还缺哪些引擎。 */
export function missingEngines(record: Case): Engine[] {
  const expected = MODE_ENGINES[record.mode] ?? []
  const done = new Set(record.findings.map(f => f.engine))
  return expected.filter(engine => !done.has(engine))
}

/** 构造派工文本。写得具体，agent 才不用猜。 */
export function buildTask(record: Case, missing: Engine[]): string {
  const done = record.findings.map(f => ENGINES[f.engine].zh)
  return [
    `【自动审议】案件 ${record.id}「${record.question}」`,
    `模式：${MODES[record.mode].zh}（${MODES[record.mode].duty}）`,
    `参与立场：${record.personas.join('、') || '未指定，你自己挑最合适的几位'}`,
    `已完成：${done.join('、') || '无'}`,
    `这次要跑：${missing.map(e => ENGINES[e].zh).join('、')}`,
    '',
    '直接开跑，不要问我确认，也不要重新建档。',
    `每个引擎先用 philosophy_engine_contract 取它要求的输出契约，写完用 philosophy_case_save 存回 ${record.id}。`,
    '需要多立场对比时用 subagent 并行，每个子 Agent 只做两件事：基于锚定文本说到最强，再指出它自己的代价。',
    '全部跑完后只用一句话说明完成，不要复述结论。',
  ].join('\n')
}

/** 把任务注入会话。agent 正在跑就 steer 进当前 turn，否则 followup 唤醒它开新一轮。 */
export async function runCase(ctx: Context, store: CaseStore, caseId: string): Promise<RunResult> {
  const record = await store.get(caseId)
  if (!record) throw new Error(`找不到案件 ${caseId}`)

  const missing = missingEngines(record)
  if (missing.length === 0) throw new Error(`「${MODES[record.mode].zh}」模式需要的引擎已经跑完了`)

  const text = buildTask(record, missing)

  let agent: Agent
  let dedicated = true
  let fallbackReason: string | undefined
  try {
    agent = await ensureSession(ctx, caseId, `哲学 · ${record.question.slice(0, 24)}`)
  } catch (error) {
    // 专用会话建不出来时不能让功能哑火，退回当前会话继续跑。
    fallbackReason = error instanceof Error ? error.message : String(error)
    agent = pickAgent(ctx)
    dedicated = false
  }

  const message = freezeMessage({
    id: MessageId(`philosophy:${caseId}:${Date.now()}`),
    role: 'user' as const,
    content: [{ type: 'text' as const, text }],
    source: { kind: 'dsh-philosophy' as const, role: 'dispatch' as const },
  }) as UserMessage

  if (agent.status === 'running') agent.steer(message)
  else agent.followup(message)

  await store.finish(caseId, 'deliberating')

  return { sessionId: agent.id, dedicated, engines: missing, text, ...(fallbackReason ? { fallbackReason } : {}) }
}

export interface ChatTurn {
  /** user = 殿下说的；assistant = agent 说的；dispatch = 插件自己派的任务。 */
  role: 'user' | 'assistant' | 'dispatch'
  text: string
  at?: number
}

/** 往案件的专用会话里追加一句追问。会话不存在就先建。 */
export async function askCase(ctx: Context, store: CaseStore, caseId: string, question: string): Promise<{ sessionId: string }> {
  const record = await store.get(caseId)
  if (!record) throw new Error(`找不到案件 ${caseId}`)
  const text = question.trim()
  if (!text) throw new Error('追问内容不能为空')

  const agent = await ensureSession(ctx, caseId, `哲学 · ${record.question.slice(0, 24)}`)
  const message = freezeMessage({
    id: MessageId(`philosophy:${caseId}:ask:${Date.now()}`),
    role: 'user' as const,
    content: [{ type: 'text' as const, text }],
    source: { kind: 'dsh-philosophy' as const, role: 'user' as const },
  }) as UserMessage

  if (agent.status === 'running') agent.steer(message)
  else agent.followup(message)
  return { sessionId: agent.id }
}

/** 读专用会话最近的对话。会话还没建时返回空数组，不报错。
 *
 * 用 sessionPersistence 逐条读日志——sessionController.inspect 只给事件前缀，拿不到消息。
 */
export async function readChat(ctx: Context, store: CaseStore, caseId: string, limit = 24): Promise<ChatTurn[]> {
  const record = await store.get(caseId)
  if (!record) throw new Error(`找不到案件 ${caseId}`)
  const id = sessionIdFor(caseId) as SessionId

  const turns: ChatTurn[] = []
  // 一轮里 agent 可能先说几句过程（「康德还在跑，先落元层」），真正的答复是最后一条。
  // 只保留每轮最后一条 assistant，过程播报不进案件。
  let pendingReply: ChatTurn | undefined
  const flush = (): void => {
    if (pendingReply) { turns.push(pendingReply); pendingReply = undefined }
  }

  const collect = (event: unknown): void => {
    const e = event as { type?: string; time?: number; data?: Record<string, unknown> }
    // 不按 turn/end 切分：agent 一轮里可能发好几条播报（「等海德格尔那一路」），
    // 按「殿下问一句 = 一段」切分，每段只留最后一条回复。
    if (e.type === 'user/message') {
      const data = e.data as {
        content?: readonly { type: string; text?: string }[]
        source?: { kind?: string; rpcId?: unknown }
      } | undefined
      const text = (data?.content ?? []).filter(b => b.type === 'text').map(b => b.text ?? '').join('\n').trim()
      if (!text) return
      const fromPlugin = data?.source?.kind === 'dsh-philosophy'
      const pluginRole = (data?.source as { role?: string } | undefined)?.role
      // DSH 会在每轮注入 runtime-context / system-reminder，它们的 source.kind 也是 'user'。
      // 只有带 rpcId 的才是殿下真敲进去的那句话。
      const fromHuman = data?.source?.kind === 'user' && typeof data.source.rpcId === 'string'
      // 自动派工是插件内部的动作，不当作对话内容呈现在案件里。
      if (fromPlugin && pluginRole !== 'user') return
      if (!fromPlugin && !fromHuman) return
      flush()
      turns.push({ role: 'user', text, ...(e.time ? { at: e.time } : {}) })
    } else if (e.type === 'assistant/message') {
      const data = e.data as { message?: { content?: readonly { type: string; text?: string }[] } } | undefined
      // 只取 text 块；reasoning（思考过程）根本不进来。
      const text = (data?.message?.content ?? []).filter(b => b.type === 'text').map(b => b.text ?? '').join('\n').trim()
      if (text) pendingReply = { role: 'assistant', text, ...(e.time ? { at: e.time } : {}) }
    }
  }

  try {
    const persistence = (ctx as unknown as {
      sessionPersistence?: {
        flush?: () => Promise<void>
        open: (id: string, mode: 'read') => Promise<{
          read: (offset: number, count: number) => Promise<{ events: readonly unknown[] }>
          [Symbol.asyncDispose]?: () => Promise<void>
        }>
      }
    }).sessionPersistence
    if (!persistence) return []
    await persistence.flush?.()
    const handle = await persistence.open(id, 'read')
    try {
      for (let offset = 0; ;) {
        const { events } = await handle.read(offset, 512)
        if (!events.length) break
        for (const event of events) collect(event)
        offset += events.length
      }
    } finally {
      await handle[Symbol.asyncDispose]?.()
    }
  } catch {
    // 会话还没落盘、或格式不兼容：当作空对话，不要让面板报错
    flush()
    return turns.slice(-limit)
  }
  flush()
  return turns.slice(-limit)
}
