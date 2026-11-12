/** 哲学工作台的工具层：让 Agent 与侧边栏面板共享同一份案件记录。 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-tools'
import { z } from 'zod'
import type { CaseStore } from './store.ts'
import type { ConceptStore } from './concepts.ts'
import { CONTROVERSY, ENGINES, ENGINE_ORDER, MODES, type ArgGraph, type Case, type ConceptTree, type Controversy, type Engine, type Mode, type StanceMap } from './types.ts'
import { loadPersonas } from './personas.ts'

const ModeSchema = z.enum(['advisor', 'coach', 'review', 'debate'])
const EngineSchema = z.enum(['concept', 'argument', 'stance', 'counterfactual', 'dialogue', 'ethics', 'history', 'writing', 'pedagogy', 'meta'])
const ControversySchema = z.enum(['consensus', 'debatable', 'contested', 'speculative'])

/** 精简的案件视图，避免列表把全文塞进上下文。 */
function brief(c: Case) {
  return {
    id: c.id,
    question: c.question,
    mode: MODES[c.mode].zh,
    status: c.status,
    personas: c.personas,
    engines: c.findings.map(f => ENGINES[f.engine].zh),
    updatedAt: c.updatedAt,
  }
}

/** 每个引擎在被调用时该产出的形状。工具返回它，让 Agent 不必先读长文档。 */
const ENGINE_CONTRACT: Record<Engine, string> = {
  concept: [
    '输出三段：',
    '1) 歧义分叉——这个词在这句话的第几处劈开，各有几条岔路（消极/积极/形而上学自由这类），每条给一句判准。',
    '2) 定义三件套——必要充分条件、一个反例、一个边界案例。',
    '3) 邻近概念对比——成对给出，说清差别落在哪个判准上。',
    '如果要概念工程，另起「v1 → 哪里不够用 → v2 → 代价」，不得悄悄替换定义。',
  ].join('\n'),
  argument: [
    '输出四段：',
    '1) 重构——P1/P2/…/C 逐条列出，并单独标出「隐含前提」。',
    '2) 谬误诊断——分三级：形式谬误（可判定）/ 语用谬误（依赖语境）/ 这未必是谬误（并说明为什么）。不要一律扣帽子。',
    '3) 强度——有效性、前提可接受性、说服对象，三维分开评，归纳强度要分级不是二值。',
    '4) 反驳——逻辑反驳 / 前提反驳 / 框架反驳，各给最强版本。',
  ].join('\n'),
  stance: [
    '输出三段：',
    '1) 预设挖掘——用否定测试：把预设取反，看原命题还成立吗。逐条列。',
    '2) 立场表——每行五列：核心主张 / 依据 / 对反例的回应 / 代价 / 盲点。中西哲并置，各自锚定文本。',
    '3) 价值排序——从我用的词强度和设的例外反推我真正在乎什么。',
  ].join('\n'),
  counterfactual: [
    '输出三段：',
    '1) 变量枚举——主体身份、数量、因果、意图、时间、可逆性、同意。逐个说明改动会动到哪条直觉。',
    '2) 单变量扰动——只改一个条件，问「直觉变了吗？变在哪一步？」',
    '3) 判别力检验——这个思想实验能不能区分两个理论？不能就删掉，别凑数。',
  ].join('\n'),
  dialogue: [
    '硬约束：一次只问一个问题，且每问必须带「我为什么问这个」。',
    '不替用户补完立场：宁可问「你的意思是 X 还是 Y」，不要替他选 X。',
    '发现张力时温和且具体：「你刚才说 A，现在说 B，这两条在 C 情况下会打架」。',
    '用户说「别问了，直接说」就切模式，不要继续审讯。',
  ].join('\n'),
  ethics: [
    '输出四段：',
    '1) 受影响者——谁被影响、影响到什么程度、有没有不在场的人（未来人、动物、非人、弱势方）。',
    '2) 权利冲突——哪两项权利在打架，各自的范围与边界在哪。',
    '3) 四维评估——后果 / 动机 / 德性 / 关系，逐维给判断。只算后果是功利主义的偷懒，不是伦理审议。',
    '4) 伦理影响评估——隐私、自主、公平、责任、可解释性，逐项标风险高低并说明理由。',
    '收尾必须说：这是价值排序问题，我不替你选。列代价，不给结论。',
  ].join('\n'),
  history: [
    '输出四段：',
    '1) 问题脉络——这个问题最早在什么语境里提出，后来被改写过几次，每次改写丢掉了什么。',
    '2) 谁讨论过——按时期列，每人一句核心立场，锚定篇目。',
    '3) 核心分歧——把分歧归结成一两句可辨的判断，不要写成综述。',
    '4) 阅读路线——入门 / 原典 / 二手 / 争议点，四级各给一到两项。',
    '三重标注是硬约束：`[原意]` 文本说什么、`[常见解释]` 学界怎么读、`[我的推断]` 我怎么看。三者不得混写。',
    '记不清篇目就说记不清，禁止编造。跨传统比较先判断问题意识是否同一个。',
  ].join('\n'),
  writing: [
    '输出四段：',
    '1) 提纲——主论点 / 分论点 / 每节要证什么 / 预计的反驳。',
    '2) 反方意见——最强的三条，不是稻草人。',
    '3) 审稿十问——真审稿人会问的十个问题，按杀伤力排序。',
    '4) 缺口——概念不一致处、论证跳跃处、文献缺口，都要给定位（段落或引文），不要泛泛说「论证不够充分」。',
    '只挑错，不夸奖。',
  ].join('\n'),
  pedagogy: [
    '输出四段：',
    '1) 学情判断——对方现在能处理多抽象的东西，据此定深度，不要一上来讲体系。',
    '2) 课程 / 问题链——从具体例子推到抽象原则，每步一个问题，且写明为什么下一步是这个。',
    '3) 训练设计——谬误识别 / 思想实验 / 概念区分，各给一个可以真做的练习。',
    '4) 检查点——怎么判断对方真的懂了：不是复述定义，而是能把它用到新案例上。',
    '禁止把课程写成知识点罗列。',
  ].join('\n'),
  meta: [
    '输出三样：',
    '1) 依据标签——[逻辑] [文本] [直觉] [价值立场] [经验] [推断]，只在有分歧风险处标，别贴成免责声明噪音。',
    '2) 争议度——共识 / 主流但可辩 / 活跃争议 / 我的推测。',
    '3) 问题类型判定——这是事实问题、概念问题，还是价值排序问题。',
  ].join('\n'),
}

export function registerTools(ctx: Context, store: CaseStore, concepts: ConceptStore): void {
  const register = (definition: Parameters<Context['tools']['register']>[0]): void => {
    ctx.effect(() => ctx.tools.register(definition))
  }

  register({
    name: 'philosophy_case_open',
    description: '开一个哲学案件（工作台里的一行记录）。返回案件 id 与该模式的义务说明。之后用 philosophy_case_save 把各引擎结论写回，面板会显示。',
    parameters: z.toJSONSchema(z.object({
      question: z.string().min(1).describe('一句话问题，作为案件标题。'),
      mode: ModeSchema.describe('advisor 顾问 / coach 教练 / review 评审 / debate 辩论。'),
      personas: z.array(z.string()).optional().describe('参与审议的人格 id；不传就留空，由你在分析时自行挑选立场。可用 philosophy_personas 查全量。'),
      text: z.string().optional().describe('审查模式下的原文（论证稿、论文片段）。'),
    }).strict()),
    output: { schema: { type: 'object', additionalProperties: true }, render: (_args: unknown, value: unknown) => [{ type: 'text' as const, text: JSON.stringify(value) }] },
    execute: async (args: unknown) => {
      const a = args as { question: string; mode: Mode; personas?: string[]; text?: string }
      const record = await store.open({ question: a.question, mode: a.mode, personas: a.personas ?? [], text: a.text })
      return {
        case: brief(record),
        duty: MODES[record.mode].duty,
        next: '按该模式跑相关引擎，每次产出用 philosophy_case_save 写回。',
      }
    },
  })

  register({
    name: 'philosophy_case_save',
    description: '把一个引擎的结论写回案件。同一引擎重复保存会覆盖，面板实时显示。可顺手标出这个结论支撑或反驳了哪些引擎，地图会画成有向边。',
    parameters: z.toJSONSchema(z.object({
      id: z.string().min(1).describe('案件 id。'),
      engine: EngineSchema.describe(`引擎：${ENGINE_ORDER.map(e => `${e}=${ENGINES[e].zh}`).join(' / ')}。`),
      body: z.string().min(1).describe('引擎输出正文，Markdown。按该引擎的契约写。'),
      links: z.array(z.object({
        to: EngineSchema.describe('指向的引擎。'),
        kind: z.enum(['supports', 'attacks']).describe('support=支撑，attack=反驳。'),
        reason: z.string().optional().describe('一句话理由，显示在地图边上。'),
      })).optional().describe('这个结论与其它引擎的关系。只写真实存在的支撑或反驳，不确定就留空。'),
      graph: z.object({
        premises: z.array(z.object({
          id: z.string().min(1).describe('前提编号，如 p1。'),
          text: z.string().min(1).describe('前提内容，一句话。'),
          implicit: z.boolean().optional().describe('这是没说出口的隐含前提时设 true。'),
        })).describe('前提列表。'),
        conclusion: z.object({
          id: z.string().min(1).describe('结论编号，如 c。'),
          text: z.string().min(1).describe('结论内容。'),
        }).describe('结论。'),
        attacks: z.array(z.object({
          from: z.string().min(1).describe('攻击方节点 id。'),
          to: z.string().min(1).describe('被攻击节点 id。'),
          reason: z.string().optional().describe('一句话理由。'),
        })).optional().describe('反驳关系。'),
      }).optional().describe('论证结构图。仅 argument 引擎用，写了面板才会画图。'),
      conceptTree: z.object({
        term: z.string().min(1).describe('被拆开的那个词。'),
        readings: z.array(z.object({
          name: z.string().min(1).describe('义项名，如「统计变量」。'),
          criterion: z.string().describe('判准：怎么和相邻义项分开。'),
          appliesWhen: z.string().optional().describe('什么时候这条读法成立。'),
          failsWhen: z.string().optional().describe('什么时候失效。'),
        })).min(2).describe('至少两条分叉。'),
      }).optional().describe('概念分叉树。仅 concept 引擎用。'),
      stanceMap: z.object({
        xAxis: z.object({ label: z.string(), low: z.string(), high: z.string() }).describe('横轴：轴名 + 两端的意思。'),
        yAxis: z.object({ label: z.string(), low: z.string(), high: z.string() }).describe('纵轴：轴名 + 两端的意思。'),
        positions: z.array(z.object({
          name: z.string().min(1).describe('哲学家名或立场名。'),
          x: z.number().min(0).max(100).describe('0–100，从左到右。'),
          y: z.number().min(0).max(100).describe('0–100，从下到上。'),
          reason: z.string().optional().describe('为什么放在这个位置。'),
        })).min(1).describe('点。'),
        empty: z.array(z.object({
          quadrant: z.string().describe('哪个象限，如「右上」。'),
          note: z.string().describe('这里没人，为什么值得说。'),
        })).optional().describe('没有人的区域。'),
      }).optional().describe('立场坐标图。仅 stance 引擎用。'),
      sources: z.array(z.string()).optional().describe('依据标签，如 ["逻辑","文本"]。'),
      controversy: ControversySchema.optional().describe('争议度。'),
    }).strict()),
    output: { schema: { type: 'object', additionalProperties: true }, render: (_args: unknown, value: unknown) => [{ type: 'text' as const, text: JSON.stringify(value) }] },
    execute: async (args: unknown) => {
      const a = args as {
        id: string; engine: Engine; body: string
        links?: Array<{ to: Engine; kind: 'supports' | 'attacks'; reason?: string }>
        graph?: ArgGraph
        conceptTree?: ConceptTree
        stanceMap?: StanceMap
        sources?: string[]; controversy?: Controversy
      }
      const updated = await store.addFinding(a.id, {
        engine: a.engine,
        body: a.body,
        links: a.links,
        graph: a.graph,
        conceptTree: a.conceptTree,
        stanceMap: a.stanceMap,
        sources: a.sources,
        controversy: a.controversy,
      })
      if (!updated) return { error: `找不到案件 ${a.id}` }
      // 不要留 undefined：工具返回值必须能无损 JSON 往返。
      return {
        case: brief(updated),
        contract: ENGINE_CONTRACT[a.engine],
        ...(a.controversy ? { controversyLabel: CONTROVERSY[a.controversy] } : {}),
      }
    },
  })

  register({
    name: 'philosophy_concept_save',
    description: '把一个概念的不同义项存进概念库，跨案件复用。同一个词会自动合并，不会重复堆积。',
    parameters: z.toJSONSchema(z.object({
      term: z.string().min(1).describe('概念本身，例如「自由」。'),
      readings: z.array(z.object({
        name: z.string().min(1).describe('义项名，例如「消极自由」。'),
        criterion: z.string().describe('判准：怎么把它和相邻义项区分开。'),
      })).min(1).describe('至少一个义项。'),
      caseId: z.string().optional().describe('出自哪个案件，便于回溯。'),
    }).strict()),
    output: { schema: { type: 'object', additionalProperties: true }, render: (_args: unknown, value: unknown) => [{ type: 'text' as const, text: JSON.stringify(value) }] },
    execute: async (args: unknown) => {
      const a = args as { term: string; readings: Array<{ name: string; criterion: string }>; caseId?: string }
      const entry = await concepts.upsert({ term: a.term, readings: a.readings, ...(a.caseId ? { caseId: a.caseId } : {}) })
      return { concept: entry, total: (await concepts.list()).length }
    },
  })

  register({
    name: 'philosophy_concept_list',
    description: '查概念库：某个词以前在哪些案件里被拆开过，各义项的判准是什么。',
    parameters: z.toJSONSchema(z.object({
      query: z.string().optional().describe('按词或义项名过滤。'),
      limit: z.number().int().min(1).max(100).optional().describe('最多几条，默认 30。'),
    }).strict()),
    output: { schema: { type: 'object', additionalProperties: true }, render: (_args: unknown, value: unknown) => [{ type: 'text' as const, text: JSON.stringify(value) }] },
    execute: async (args: unknown) => {
      const a = args as { query?: string; limit?: number }
      const all = await concepts.list()
      const q = a.query?.trim()
      const filtered = q
        ? all.filter(e => e.term.includes(q) || e.readings.some(r => r.name.includes(q)))
        : all
      return { total: filtered.length, concepts: filtered.slice(0, a.limit ?? 30) }
    },
  })

  register({
    name: 'philosophy_belief_add',
    description: '记下用户在追问里表达过的一条立场。发现它和之前某条冲突时，用 tension 写明冲突在哪——信念地图靠这个显示前后是否自洽。',
    parameters: z.toJSONSchema(z.object({
      caseId: z.string().min(1).describe('案件 id。'),
      text: z.string().min(1).describe('用户的原话或一句话转述。'),
      tension: z.string().optional().describe('和谁冲突、怎么冲突。没冲突就别写。'),
    }).strict()),
    output: { schema: { type: 'object', additionalProperties: true }, render: (_args: unknown, value: unknown) => [{ type: 'text' as const, text: JSON.stringify(value) }] },
    execute: async (args: unknown) => {
      const a = args as { caseId: string; text: string; tension?: string }
      const updated = await store.addBelief(a.caseId, { text: a.text, ...(a.tension ? { tension: a.tension } : {}) })
      if (!updated) return { error: `找不到案件 ${a.caseId}` }
      return { beliefs: updated.beliefs ?? [], total: (updated.beliefs ?? []).length }
    },
  })

  register({
    name: 'philosophy_case_list',
    description: '列出最近的哲学案件。用于接着上次的讨论，或让用户挑一个。',
    parameters: z.toJSONSchema(z.object({
      status: z.enum(['open', 'deliberating', 'done']).optional().describe('按状态筛选。'),
      limit: z.number().int().min(1).max(50).default(10).describe('最多几条。'),
    }).strict()),
    output: { schema: { type: 'object', additionalProperties: true }, render: (_args: unknown, value: unknown) => [{ type: 'text' as const, text: JSON.stringify(value) }] },
    execute: async (args: unknown) => {
      const a = args as { status?: Case['status']; limit: number }
      const all = await store.list()
      const filtered = a.status ? all.filter(c => c.status === a.status) : all
      return { total: filtered.length, cases: filtered.slice(0, a.limit).map(brief) }
    },
  })

  register({
    name: 'philosophy_case_read',
    description: '读一个案件的完整内容，含已产出的各引擎结论。',
    parameters: z.toJSONSchema(z.object({ id: z.string().min(1) }).strict()),
    output: { schema: { type: 'object', additionalProperties: true }, render: (_args: unknown, value: unknown) => [{ type: 'text' as const, text: JSON.stringify(value) }] },
    execute: async (args: unknown) => {
      const a = args as { id: string }
      const found = await store.get(a.id)
      return found ? { case: found } : { error: `找不到案件 ${a.id}` }
    },
  })

  register({
    name: 'philosophy_personas',
    description: '取哲学人格方阵，用于多子 Agent 编排。每个条目带文本锚点与最易被误读成的漫画像，避免廉价扮演。',
    parameters: z.toJSONSchema(z.object({
      tradition: z.enum(['west', 'cn', 'all']).default('all').describe('west 西哲 / cn 中哲（含佛学）/ all 双轨。'),
      ids: z.array(z.string()).optional().describe('只取这些 id。'),
    }).strict()),
    output: { schema: { type: 'object', additionalProperties: true }, render: (_args: unknown, value: unknown) => [{ type: 'text' as const, text: JSON.stringify(value) }] },
    execute: async (args: unknown) => {
      const a = args as { tradition: 'west' | 'cn' | 'all'; ids?: string[] }
      let list = loadPersonas().personas
      if (a.tradition !== 'all') list = list.filter(p => p.tradition === a.tradition)
      if (a.ids?.length) list = list.filter(p => a.ids!.includes(p.id))
      return {
        personas: list,
        steelmanTask: '给每个子 Agent 的指令必须是：先基于锚定文本把这个立场说到最强，再指出它的代价与盲点。禁止写成漫画像，禁止编造引文。',
        synthRule: '主 Agent 只做合成：分出事实分歧 / 价值分歧 / 概念分歧，不替用户裁决。',
      }
    },
  })

  register({
    name: 'philosophy_engine_contract',
    description: '取某个引擎的输出契约（该写哪几段、有哪些硬约束）。不想记格式时调用它。',
    parameters: z.toJSONSchema(z.object({ engine: EngineSchema }).strict()),
    output: { schema: { type: 'object', additionalProperties: true }, render: (_args: unknown, value: unknown) => [{ type: 'text' as const, text: JSON.stringify(value) }] },
    execute: async (args: unknown) => {
      const a = args as { engine: Engine }
      return { engine: a.engine, name: ENGINES[a.engine].zh, cue: ENGINES[a.engine].cue, contract: ENGINE_CONTRACT[a.engine] }
    },
  })
}

export { ENGINE_CONTRACT }
