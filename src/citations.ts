/** 引文核对的本地目录。
 *
 * 只做一件事：把正文里的《…》和一份常见哲学文本清单比对。
 * **不联网、不判定真伪**——不认识的书名只标「未在本地目录中」，
 * 不写成「编造」。误报比漏报更伤人。
 */

/** 常见哲学文本（书名，不含书名号）。中西并重。 */
export const KNOWN_TEXTS: readonly string[] = [
  // 古希腊罗马
  '理想国', '斐多', '美诺', '会饮', '申辩篇', '形而上学', '尼各马可伦理学', '政治学',
  '论自然', '九章集', '残篇',
  // 中世纪
  '忏悔录', '上帝之城', '神学大全', '反异教大全', '箴言四书注',
  // 近代
  '第一哲学沉思集', '方法谈', '伦理学', '神学政治论', '单子论', '神义论',
  '人类理解论', '政府论', '人类知识原理', '人性论', '人类理解研究', '道德原则研究',
  '利维坦', '论公民', '社会契约论', '爱弥儿', '论人类不平等的起源', '思想录',
  // 德国古典
  '纯粹理性批判', '实践理性批判', '判断力批判', '道德形而上学奠基', '精神现象学',
  '法哲学原理', '逻辑学', '作为意志和表象的世界',
  // 19 世纪
  '恐惧与颤栗', '非此即彼', '致死的疾病', '1844年经济学哲学手稿', '资本论',
  '德意志意识形态', '道德与立法原理导论', '论自由', '功利主义', '论代议制政府',
  '道德谱系学', '善恶的彼岸', '查拉图斯特拉如是说',
  // 现象学与存在主义
  '现象学的观念', '笛卡尔式的沉思', '欧洲科学的危机', '存在与时间', '林中路', '技术的追问',
  '存在与虚无', '存在主义是一种人道主义', '知觉现象学', '可见的与不可见的',
  '西西弗神话', '局外人', '反抗者', '总体与无限',
  // 分析哲学
  '概念文字', '算术基础', '数学原理', '哲学问题', '伦理学原理', '逻辑哲学论', '哲学研究',
  '世界的逻辑构造', '语言的逻辑句法', '从逻辑的观点看', '语词与对象', '命名与必然性',
  '理性、真理与历史', '心灵、语言和社会', '意向性',
  // 政治与伦理
  '正义论', '政治自由主义', '无政府、国家与乌托邦', '自由四论', '人的境况',
  '艾希曼在耶路撒冷', '论革命', '交往行为理论', '公共领域的结构转型',
  // 实用主义
  '信念的确定', '实用主义', '宗教经验之种种', '民主与教育', '经验与自然',
  // 法兰克福与后结构
  '否定的辩证法', '启蒙辩证法', '美学理论', '规训与惩罚', '性史', '知识考古学',
  '论文字学', '书写与差异', '差异与重复', '千高原', '第二性',
  // 中国哲学
  '论语', '孟子', '荀子', '庄子', '道德经', '韩非子', '传习录', '墨子',
  '大学', '中庸', '周易', '春秋繁露', '近思录',
  // 佛学
  '中论', '回诤论', '大智度论', '成唯识论', '坛经', '金刚经', '心经',
]

const KNOWN = new Set(KNOWN_TEXTS)

/** 书名号内的内容可能带篇章节，先削掉后半段再比。 */
function baseTitle(raw: string): string {
  return raw.split(/[·・:：]/)[0].trim()
}

/** 是否在本地目录中（允许「论自由·第三章」这类写法）。 */
export function isKnownTitle(raw: string): boolean {
  const base = baseTitle(raw)
  if (!base) return false
  if (KNOWN.has(base)) return true
  for (const known of KNOWN) {
    if (base.includes(known)) return true
  }
  return false
}

const CITE_RE = /《([^》]{1,40})》/g

/** 抽出正文里出现的全部书名，去重后按出现顺序返回。 */
export function extractCitations(text: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const match of text.matchAll(CITE_RE)) {
    const title = match[1].trim()
    if (title && !seen.has(title)) { seen.add(title); out.push(title) }
  }
  return out
}

export interface CitationReport {
  known: string[]
  unknown: string[]
}

/** 汇总一组正文里的引文；unknown 只是「本地目录里没有」，不是「编造」。 */
export function reviewCitations(texts: readonly string[]): CitationReport {
  const known = new Set<string>()
  const unknown = new Set<string>()
  for (const text of texts) {
    for (const title of extractCitations(text)) {
      if (isKnownTitle(title)) known.add(title)
      else unknown.add(title)
    }
  }
  return { known: [...known], unknown: [...unknown] }
}
