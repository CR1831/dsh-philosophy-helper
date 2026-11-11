/** 哲学工作台的领域类型：一个「案件」是一次完整的哲学审议记录。 */

export type Mode = 'advisor' | 'coach' | 'review' | 'debate'

export const MODES: Record<Mode, { zh: string; en: string; duty: string }> = {
  advisor: { zh: '顾问', en: 'Advisor', duty: '给多视角分析，列代价，不替我下判断' },
  coach: { zh: '教练', en: 'Coach', duty: '连续追问，逼我自己想清楚，不急着给答案' },
  review: { zh: '评审', en: 'Reviewer', duty: '查概念一致性、论证跳跃、隐含前提，只挑错不夸奖' },
  debate: { zh: '辩论', en: 'Debate', duty: '给正反双方最强论证，钢铁人化，最后出争议地图' },
}

/** 十个引擎：概念 / 论证 / 立场 / 反事实 / 对话 / 伦理 / 谱系 / 写作 / 教学 / 元层。 */
export type Engine =
  | 'concept' | 'argument' | 'stance' | 'counterfactual' | 'dialogue'
  | 'ethics' | 'history' | 'writing' | 'pedagogy' | 'meta'

export const ENGINES: Record<Engine, { zh: string; en: string; cue: string }> = {
  concept: { zh: '概念澄清', en: 'Concept', cue: '这个词有几种意思 · 反例与边界 · 和相近概念的区别' },
  argument: { zh: '论证分析', en: 'Argument', cue: '拆成前提和结论 · 隐藏假设 · 谬误分级 · 反驳' },
  stance: { zh: '立场比较', en: 'Stance', cue: '挖出隐含预设 · 各派主张与代价 · 你真正在乎什么' },
  counterfactual: { zh: '思想实验', en: 'Counterfactual', cue: '换一个条件直觉会变吗 · 能不能区分两种理论' },
  dialogue: { zh: '追问对话', en: 'Dialogue', cue: '一次只问一个问题 · 指出前后矛盾' },
  ethics: { zh: '伦理审议', en: 'Ethics', cue: '谁受影响 · 哪些权利打架 · 后果与责任' },
  history: { zh: '哲学史脉络', en: 'History', cue: '谁讨论过 · 分歧在哪 · 该读什么' },
  writing: { zh: '写作辅助', en: 'Writing', cue: '提纲 · 反方意见 · 审稿人会问什么 · 哪里有漏洞' },
  pedagogy: { zh: '教学训练', en: 'Pedagogy', cue: '按水平定深浅 · 问题链 · 练习题 · 怎么算学会了' },
  meta: { zh: '依据标注', en: 'Meta', cue: '这条依据是逻辑、文本还是立场 · 争议有多大' },
}

export const ENGINE_ORDER: Engine[] = [
  'concept', 'argument', 'stance', 'counterfactual', 'dialogue',
  'ethics', 'history', 'writing', 'pedagogy', 'meta',
]

export const ENGINE_TOOL: Record<Engine, string> = {
  concept: 'philosophy_concept',
  argument: 'philosophy_argument',
  stance: 'philosophy_stance',
  counterfactual: 'philosophy_counterfactual',
  dialogue: 'philosophy_socratic',
  ethics: 'philosophy_ethics',
  history: 'philosophy_history',
  writing: 'philosophy_writing',
  pedagogy: 'philosophy_pedagogy',
  meta: 'philosophy_meta',
}

/** 每个模式该跑哪些引擎。前后端共用，改这里就够。 */
export const MODE_ENGINES: Record<Mode, Engine[]> = {
  advisor: ['concept', 'stance', 'ethics', 'meta'],
  coach: ['dialogue', 'pedagogy', 'meta'],
  review: ['argument', 'concept', 'writing', 'meta'],
  debate: ['stance', 'counterfactual', 'argument', 'history', 'meta'],
}

/** 开案预设：把「用哪套参数」一次带进去，省得每次重新勾。 */
export interface CaseTemplate {
  id: string
  name: string
  hint: string
  mode: Mode
  personas: string[]
  tags: string[]
}

export const TEMPLATES: CaseTemplate[] = [
  {
    id: 'ethics',
    name: '伦理困境',
    hint: '多方受影响，列代价但不下判断',
    mode: 'advisor',
    personas: ['kant', 'mill', 'aristotle', 'confucius'],
    tags: ['伦理'],
  },
  {
    id: 'concept',
    name: '概念辨析',
    hint: '一个词有几种意思，先把它拆开',
    mode: 'review',
    personas: [],
    tags: ['概念'],
  },
  {
    id: 'paper',
    name: '论文审查',
    hint: '查概念一致性、论证跳跃、哪里缺证据',
    mode: 'review',
    personas: [],
    tags: ['写作'],
  },
  {
    id: 'class',
    name: '课堂讨论',
    hint: '一次只问一个问题，逼人自己想',
    mode: 'coach',
    personas: [],
    tags: ['教学'],
  },
]

export type CaseStatus = 'open' | 'deliberating' | 'done'

/** 引擎之间的指向关系：谁支撑谁、谁反驳谁。 */
export interface ClaimLink {
  /** 指向另一个引擎。 */
  to: Engine
  /** 支撑还是反驳。 */
  kind: 'supports' | 'attacks'
  /** 一句话理由，写在地图边上。 */
  reason?: string
}

export interface Finding {
  engine: Engine
  /** 引擎输出正文，Markdown。 */
  body: string
  /** 依赖关系：这个引擎的结论支撑或反驳了哪些引擎。 */
  links?: ClaimLink[]
  /** 依据标签，例如 ['逻辑','文本']。 */
  sources?: string[]
  /** 争议度：consensus / debatable / contested / speculative。 */
  controversy?: Controversy
  createdAt: string
}

export type Controversy = 'consensus' | 'debatable' | 'contested' | 'speculative'

export const CONTROVERSY: Record<Controversy, string> = {
  consensus: '共识',
  debatable: '主流但可辩',
  contested: '活跃争议',
  speculative: '我的推测',
}

/** 用户在追问里表达过的一条立场，用于看前后是否自洽。 */
export interface Belief {
  id: string
  /** 用户的原话或转述。 */
  text: string
  at: string
  /** 与哪条信念冲突，以及怎么冲突。 */
  tension?: string
}

export interface Case {
  id: string
  createdAt: string
  updatedAt: string
  /** 一句话问题，用作标题。 */
  question: string
  mode: Mode
  status: CaseStatus
  /** 原文（审查模式下的论证稿），可空。 */
  input?: string
  /** 参与审议的人格 id。 */
  personas: string[]
  /** 自由标签，用于检索与归类。 */
  tags?: string[]
  /** 用户在对话里流露过的立场，教练模式用。 */
  beliefs?: Belief[]
  findings: Finding[]
  /** 我自己的补充笔记。 */
  notes?: string
}

/** 中西哲双轨的人格方阵。`tradition` 决定它在争议地图里落在哪一轨。 */
export interface Persona {
  id: string
  zh: string
  en: string
  tradition: 'west' | 'cn'
  /** 重构该立场时依据的文本锚点，避免廉价扮演。 */
  anchor: string
  /** 它最容易被误解成什么。 */
  caricature: string
  /** 通俗介绍，点开人格卡片时显示。缺省时只显示锚点与漫画像。 */
  intro?: string
}

export const PERSONAS: Persona[] = [
  { id: 'kant', zh: '康德', en: 'Kant', tradition: 'west', anchor: '《道德形而上学奠基》《实践理性批判》', caricature: '只会说"要遵守规则"的教条主义者' },
  { id: 'mill', zh: '密尔', en: 'Mill', tradition: 'west', anchor: '《论自由》《功利主义》', caricature: '会算总账、可以牺牲少数人的计算器' },
  { id: 'aristotle', zh: '亚里士多德', en: 'Aristotle', tradition: 'west', anchor: '《尼各马可伦理学》《政治学》', caricature: '只会说"中庸之道"的和事佬' },
  { id: 'nietzsche', zh: '尼采', en: 'Nietzsche', tradition: 'west', anchor: '《道德谱系学》《善恶的彼岸》', caricature: '只会喊"超越吧"的中二反派' },
  { id: 'hume', zh: '休谟', en: 'Hume', tradition: 'west', anchor: '《人性论》《道德原则研究》', caricature: '什么都不知道的怀疑论者' },
  { id: 'confucius', zh: '孔子', en: 'Confucius', tradition: 'cn', anchor: '《论语》', caricature: '只会说"要孝顺"的说教者' },
  { id: 'zhuangzi', zh: '庄子', en: 'Zhuangzi', tradition: 'cn', anchor: '《庄子》内篇', caricature: '什么都无所谓的躺平者' },
  { id: 'mencius', zh: '孟子', en: 'Mencius', tradition: 'cn', anchor: '《孟子》', caricature: '只会说"人性本善"的乐观者' },
  { id: 'xunzi', zh: '荀子', en: 'Xunzi', tradition: 'cn', anchor: '《荀子》', caricature: '只会说"人性本恶"的悲观者' },
  { id: 'nagarjuna', zh: '龙树', en: 'Nāgārjuna', tradition: 'cn', anchor: '《中论》《回诤论》', caricature: '什么都要否定的虚无主义' },
  { id: 'wangyangming', zh: '王阳明', en: 'Wang Yangming', tradition: 'cn', anchor: '《传习录》', caricature: '只会说"跟着心走"的直觉主义者' },
]

export const DEFAULT_PERSONAS = ['kant', 'mill', 'confucius', 'zhuangzi']

export function newCaseId(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `P${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}
