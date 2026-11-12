/** 常用哲学术语表。
 *
 * 只收「有公认定义」的词，定义控制在 40 字内。
 * 争议大的词（如「自由」）不在这里定义——那要靠引擎在具体语境里拆。
 * 单字术语（道、仁、义）不收，正则误伤太厉害。
 */

export interface Term {
  zh: string
  en?: string
  /** 一句话定义，40 字内。 */
  def: string
  /** 常见误读或使用提示。 */
  note?: string
}

export const TERMS: Term[] = [
  // ── 知识论与形而上学 ──
  { zh: '先验', en: 'a priori', def: '不依赖经验即可知道的东西。批评者说其实没有真正脱离经验的先验。' },
  { zh: '后验', en: 'a posteriori', def: '必须靠经验才能知道的东西。' },
  { zh: '分析命题', en: 'analytic', def: '谓语已含在主词里，否定它会自相矛盾。「单身汉未婚」。' },
  { zh: '综合命题', en: 'synthetic', def: '谓语给主词增加新信息，否定它不矛盾。「这张桌子是木头的」。' },
  { zh: '本体论', en: 'ontology', def: '研究「有什么存在」的学问。' },
  { zh: '认识论', en: 'epistemology', def: '研究「我们怎么知道」的学问。' },
  { zh: '形而上学', en: 'metaphysics', def: '研究经验之外的实在结构：实体、因果、必然性。' },
  { zh: '实在论', en: 'realism', def: '认为某类东西独立于我们的心智而存在。' },
  { zh: '唯名论', en: 'nominalism', def: '认为共相只是名称，真实存在的只有个别事物。' },
  { zh: '观念论', en: 'idealism', def: '认为实在最终由心智或观念构成。中文旧译「唯心论」。' },
  { zh: '实体', en: 'substance', def: '独立存在、承载属性的那个东西。' },
  { zh: '属性', en: 'property', def: '依附于实体、可以被述说的性质。' },
  { zh: '模态', en: 'modality', def: '必然、可能、偶然这一组范畴。' },
  { zh: '同一性', en: 'identity', def: '「a 就是 b」的关系。人格同一性问的是：什么时候前后的你还是你。' },
  { zh: '因果关系', en: 'causation', def: '一个事件引起另一个事件。休谟质疑：我们只看到先后恒常伴随，看不到必然性。' },
  { zh: '决定论', en: 'determinism', def: '一切事件都由先前状态与规律决定。' },
  { zh: '相容论', en: 'compatibilism', def: '认为自由意志与决定论可以并存。' },
  { zh: '自由意志', en: 'free will', def: '行动由自己发起、而非被外因强制的能力。争议在于这是否要求「本可以不这样做」。' },
  { zh: '他心问题', en: "problem of other minds", def: '你怎么知道别人有内心体验？你只能看到行为。' },
  { zh: '中文房间', en: 'Chinese room', def: '塞尔的思想实验：按规则操作符号不等于理解意义。' },
  { zh: '缸中之脑', en: 'brain in a vat', def: '普特南的思想实验，用来质疑我们能否确证外部世界。' },
  { zh: '奥卡姆剃刀', en: "Occam's razor", def: '不必要就别增加实体。是启发法，不是定理。' },

  // ── 伦理学与政治哲学 ──
  { zh: '义务论', en: 'deontology', def: '对错取决于行为本身是否符合规则或义务，而不只看后果。' },
  { zh: '后果论', en: 'consequentialism', def: '对错只取决于后果的好坏。' },
  { zh: '功利主义', en: 'utilitarianism', def: '最大化总体效用的后果论版本。' },
  { zh: '德性伦理', en: 'virtue ethics', def: '不问「该做什么」，问「该成为什么样的人」。' },
  { zh: '绝对命令', en: 'categorical imperative', def: '康德：只按你能同时愿意它成为普遍法则的准则行动。' },
  { zh: '目的公式', en: 'formula of humanity', def: '康德：把人性的东西始终同时当作目的，绝不仅仅当作手段。' },
  { zh: '无知之幕', en: 'veil of ignorance', def: '罗尔斯：定规则时不知道自己在社会中的位置，以保公平。' },
  { zh: '电车难题', en: 'trolley problem', def: '牺牲一人救五人，做不做？考的是「动手」与「放手」是否有道德差别。' },
  { zh: '休谟断头台', en: 'is-ought gap', def: '从「是」推不出「应当」。事实描述本身不产生规范。' },
  { zh: '自然主义谬误', en: 'naturalistic fallacy', def: '把「善」定义成某个自然属性（如「令人愉快」）。摩尔提出。' },
  { zh: '双重效应', en: 'double effect', def: '一个行为有好坏两种后果时，若坏后果非手段且不得已，或可允许。' },
  { zh: '道德运气', en: 'moral luck', def: '结果取决于你控制不了的因素，却仍影响道德评价。' },
  { zh: '家长主义', en: 'paternalism', def: '为你好而限制你的自由。' },
  { zh: '程序正义', en: 'procedural justice', def: '结果是否公正，看过程是否公平，而非结果本身。' },

  // ── 现象学与存在主义 ──
  { zh: '现象学', en: 'phenomenology', def: '回到事物本身：描述经验如何显现，而不先预设理论。' },
  { zh: '意向性', en: 'intentionality', def: '意识总是「关于某物」的意识。' },
  { zh: '此在', en: 'Dasein', def: '海德格尔对「人」的称呼：存在于世界之中的那个存在者。' },
  { zh: '在世存在', en: 'being-in-the-world', def: '海德格尔：人不是先存在再进入世界，而是一开始就在世界里。' },
  { zh: '常人', en: 'das Man', def: '海德格尔：匿名的「大家」，日常中代替我们做决定的那股力量。' },
  { zh: '本真', en: 'authenticity', def: '从「大家」那里收回自己的存在方式。' },
  { zh: '自欺', en: 'bad faith', def: '萨特：用「我就是这样的人」逃避自由选择的责任。' },
  { zh: '荒诞', en: 'absurd', def: '加缪：人对意义的渴求与世界的沉默之间的裂缝。' },
  { zh: '处境', en: 'situation', def: '你无法选择的既定条件，以及你对其采取的态度。' },

  // ── 语言与结构 ──
  { zh: '能指', en: 'signifier', def: '索绪尔：符号的物质形式（声音、字形）。' },
  { zh: '所指', en: 'signified', def: '索绪尔：符号所表示的概念。' },
  { zh: '言语行为', en: 'speech act', def: '奥斯汀：说话本身就在做事，如承诺、命令、命名。' },
  { zh: '私人语言', en: 'private language', def: '维特根斯坦论证：只自己能懂的语言不可能成立，因为无法检验对错。' },
  { zh: '语言游戏', en: 'language game', def: '维特根斯坦：词的意义来自它在具体活动中的用法。' },
  { zh: '家族相似', en: 'family resemblance', def: '同一类事物之间不必有共同本质，只要彼此有交叉相似之处。' },
  { zh: '解构', en: 'deconstruction', def: '德里达：揭示文本内部二元对立如何自我瓦解。' },
  { zh: '话语', en: 'discourse', def: '福柯：一套规定「什么能说、谁有资格说」的规则系统。' },
  { zh: '规训', en: 'discipline', def: '福柯：通过细密训练把身体塑造成可用的、顺从的。' },

  // ── 中国哲学 ──
  { zh: '仁政', def: '孟子：以不忍人之心行不忍人之政。' },
  { zh: '性善', def: '孟子：人天生有恻隐、羞恶、辞让、是非四端。' },
  { zh: '性恶', def: '荀子：人之性恶，其善者伪（人为）也。' },
  { zh: '中庸', def: '不过不及，随时处中。不是折中，是恰到好处。' },
  { zh: '格物致知', def: '《大学》：穷究事物之理以获得知识。朱王解释不同。' },
  { zh: '知行合一', def: '王阳明：知而不行，只是未知。知与行本是一事。' },
  { zh: '良知', def: '王阳明：不学而知的是非之心。' },
  { zh: '天理', def: '宋明理学：事物之所以然的普遍法则，也是人应循之则。' },
  { zh: '气', def: '构成万物的质料与动力。与「理」相对。' },
  { zh: '逍遥', def: '庄子：无所待而游于无穷，不依赖外在条件。' },
  { zh: '齐物', def: '庄子：从道的角度看，万物之别并不成立。' },
  { zh: '无为', def: '不妄为，顺自然之势。不是什么都不做。' },
  { zh: '经权', def: '经是常道，权是具体情境中的变通。「执中无权，犹执一也」。' },
  { zh: '内圣外王', def: '内在修养达到圣，外发为治理天下的功业。' },

  // ── 佛学 ──
  { zh: '缘起', def: '一切法依因待缘而生，无独立自性。' },
  { zh: '无我', def: '不存在恒常不变的自我实体。' },
  { zh: '空', def: '无自性，不是「什么都没有」。' },
  { zh: '二谛', def: '世俗谛与胜义谛。中观用二者说明「空」不坏世间。' },
  { zh: '中道', def: '不落常见、不落断见。' },
  { zh: '唯识', def: '万法唯识所现，无外境独立存在。' },
  { zh: '如来藏', def: '众生本具的成佛依据或真心。与「空」的关系有争议。' },

  // ── 方法论 ──
  { zh: '思想实验', en: 'thought experiment', def: '构造假想情境来检验一个原则。' },
  { zh: '钢人化', en: 'steelmanning', def: '把对方立场说到最强再反驳，而不是打成稻草人。' },
  { zh: '诉诸直觉', def: '用直觉判断作证据。在哲学里有时合法，有时是懒惰。' },
  { zh: '反例', en: 'counterexample', def: '一个使普遍命题失效的个别情形。' },
  { zh: '隐含前提', en: 'implicit premise', def: '论证里没说但必须成立的那一步。找到它常等于找到论证的弱点。' },
]

/** 最长优先，避免「先验」被「验」之类的短词抢先。 */
const SORTED = [...TERMS].sort((a, b) => b.zh.length - a.zh.length)

const ESCAPE = /[.*+?^${}()|[\]\\]/g
const escapeRe = (s: string): string => s.replace(ESCAPE, '\\$&')

/** 单个正则一次扫完所有术语。 */
export const TERM_RE = new RegExp(SORTED.map(t => escapeRe(t.zh)).join('|'), 'g')

export const TERM_MAP = new Map(TERMS.map(t => [t.zh, t]))
