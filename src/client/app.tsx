/** 哲学工作台面板：案件 / 审议 / 资料三栏。 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { MODE_ENGINES, TEMPLATES, type Case, type CaseTemplate, type Engine, type Mode, type Persona } from '../types.ts'
import { reviewCitations } from '../citations.ts'
import type { T } from './locales.ts'
import { Markdown } from './markdown.tsx'
import styles from './styles.css?raw'

const API = '/philosophy-api'
const MARKER = 'dsh-philosophy'

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(API + path, {
    ...init,
    headers: { 'x-dsh-philosophy': MARKER, 'content-type': 'application/json', ...(init?.headers ?? {}) },
  })
  const body = await res.json().catch(() => ({})) as { error?: string }
  if (!res.ok) throw new Error(body.error ?? `${res.status} ${res.statusText}`)
  return body as T
}

interface Summary {
  id: string
  question: string
  mode: Mode
  status: 'open' | 'deliberating' | 'done'
  personas: string[]
  tags: string[]
  engines: Engine[]
  updatedAt: string
  findings: number
}

interface Catalog {
  modes: Record<Mode, { zh: string; en: string; duty: string }>
  engines: Record<Engine, { zh: string; en: string; cue: string }>
  personas: Persona[]
  defaults: { personas: string[] }
}

interface ChatTurn {
  role: 'user' | 'assistant' | 'dispatch'
  text: string
  at?: number
}

interface ConceptEntry {
  id: string
  term: string
  readings: Array<{ name: string; criterion: string; fromCase?: string }>
  updatedAt: string
}

const MODE_KEYS: Mode[] = ['advisor', 'coach', 'review', 'debate']
const ENGINE_KEYS: Engine[] = ['concept', 'argument', 'stance', 'counterfactual', 'dialogue', 'ethics', 'history', 'writing', 'pedagogy', 'meta']

const SOURCES = [
  { name: 'Stanford Encyclopedia of Philosophy', href: 'https://plato.stanford.edu/', note: '概念与哲学史的第一依据' },
  { name: '国家哲学社会科学文献中心', href: 'https://ncpssd.org/', note: '中文学术文献' },
  { name: 'PubScholar', href: 'https://pubscholar.cn/', note: '中科院文献平台' },
  { name: '哲学研究', href: 'https://zxyj.cbpt.cnki.net/', note: '中文学界当前争议' },
]

const STATUS_KEY = { open: 'statusOpen', deliberating: 'statusDeliberating', done: 'statusDone' } as const

export function App({ t }: { t: T }) {
  const [tab, setTab] = useState<'cases' | 'new' | 'refs'>('cases')
  const [cases, setCases] = useState<Summary[]>([])
  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const [selected, setSelected] = useState<Case | null>(null)
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [list, meta] = await Promise.all([
        api<{ cases: Summary[]; total: number }>('/cases'),
        catalog ? Promise.resolve(catalog) : api<Catalog>('/meta'),
      ])
      setCases(list.cases)
      if (!catalog) setCatalog(meta)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [catalog])

  useEffect(() => { void refresh() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const openCase = useCallback(async (id: string) => {
    if (!id) { setSelected(null); return }
    setError(null)
    try {
      const res = await api<{ case: Case }>(`/cases/${encodeURIComponent(id)}`)
      setSelected(res.case)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  // 审议中的案件自动轮询：agent 在专用会话里跑，跑完面板自己就更新了。
  const pollingId = selected?.status === 'deliberating' ? selected.id : undefined
  useEffect(() => {
    if (!pollingId) return
    // 页面在后台时不轮询，省掉无意义的请求
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void openCase(pollingId)
    }, 5000)
    return () => clearInterval(timer)
  }, [pollingId, openCase])

  const finish = useCallback(async (id: string) => {
    await api('/cases/finish', { method: 'POST', body: JSON.stringify({ id }) })
    await refresh()
    await openCase(id)
  }, [refresh, openCase])

  const remove = useCallback(async (id: string) => {
    await api('/cases', { method: 'DELETE', body: JSON.stringify({ id }) })
    setSelected(null)
    await refresh()
  }, [refresh])

  const gotoNew = useCallback(() => { setTab('new'); setSelected(null) }, [])

  return (
    <div className="ph-wrap">
      <style>{styles}</style>

      <header className="ph-head">
        <h2 className="ph-title">{t('title')}</h2>
        {cases.length > 0 && <span className="ph-count">{cases.length}</span>}
        <nav className="ph-tabs">
          {([['cases', 'tabCases'], ['new', 'tabNew'], ['refs', 'tabRefs']] as const).map(([key, label]) => (
            <button key={key} type="button" className="ph-tab" data-on={tab === key} onClick={() => setTab(key)}>
              {t(label)}
            </button>
          ))}
        </nav>
      </header>

      {error && (
        <div className="ph-error">
          <span>{t('error')}: {error}</span>
          <button type="button" className="ph-btn" onClick={() => void refresh()}>{t('retry')}</button>
        </div>
      )}

      <div className="ph-body">
        {tab === 'cases' && (
          <CasesView
            t={t}
            cases={cases}
            query={query}
            onQuery={setQuery}
            loading={loading}
            selected={selected}
            catalog={catalog}
            onOpen={id => void openCase(id)}
            onFinish={id => void finish(id)}
            onRemove={id => void remove(id)}
            onGoNew={gotoNew}
          />
        )}
        {tab === 'new' && catalog && (
          <NewView t={t} catalog={catalog} onCreated={async id => { setTab('cases'); await refresh(); await openCase(id) }} />
        )}
        {tab === 'refs' && <RefsView t={t} catalog={catalog} />}
      </div>
    </div>
  )
}

function CasesView({ t, cases, query, onQuery, loading, selected, catalog, onOpen, onFinish, onRemove, onGoNew }: {
  t: T; cases: Summary[]; query: string; onQuery: (q: string) => void
  loading: boolean; selected: Case | null; catalog: Catalog | null
  onOpen: (id: string) => void; onFinish: (id: string) => void; onRemove: (id: string) => void; onGoNew: () => void
}) {
  // hooks 必须在所有提前 return 之前
  const [compare, setCompare] = useState<string[]>([])
  const [showCompare, setShowCompare] = useState(false)

  if (selected) {
    return (
      <CaseDetail
        key={selected.id}
        t={t}
        catalog={catalog}
        record={selected}
        onOpen={onOpen}
        onFinish={onFinish}
        onRemove={onRemove}
      />
    )
  }

  if (loading && cases.length === 0) {
    return <div className="ph-empty"><span className="ph-empty-text">{t('loading')}</span></div>
  }

  if (cases.length === 0) {
    return (
      <div className="ph-empty">
        <span className="ph-empty-mark">⚖</span>
        <span className="ph-empty-text">{t('empty')}</span>
        <button type="button" className="ph-btn ph-btn--primary" onClick={onGoNew}>{t('tabNew')}</button>
      </div>
    )
  }

  const q = query.trim().toLowerCase()
  const shown = q
    ? cases.filter(c =>
        c.question.toLowerCase().includes(q)
        || (c.tags ?? []).some(tag => tag.toLowerCase().includes(q)))
    : cases
  return (
    <div className="ph-list">
      <input
        className="ph-input"
        value={query}
        placeholder={t('searchPlaceholder')}
        onChange={e => onQuery(e.target.value)}
      />
      {showCompare && compare.length >= 2 && (
        <CompareView t={t} catalog={catalog} ids={compare} onClose={() => setShowCompare(false)} />
      )}
      {compare.length >= 2 && (
        <div className="ph-compare-bar">
          <span>{t('compareSelected')} {compare.length}</span>
          <button type="button" className="ph-btn ph-btn--primary" onClick={() => setShowCompare(true)}>{t('compareOpen')}</button>
          <button type="button" className="ph-btn" onClick={() => setCompare([])}>{t('compareClear')}</button>
        </div>
      )}
      {shown.length === 0 && q && <div className="ph-hint">{t('noMatch')}</div>}
      {shown.map(c => (
        <div key={c.id} className="ph-case-row" data-picked={compare.includes(c.id) || undefined}>
          <input
            type="checkbox"
            className="ph-case-check"
            checked={compare.includes(c.id)}
            onChange={() => setCompare(prev => prev.includes(c.id) ? prev.filter(x => x !== c.id) : [...prev, c.id])}
            aria-label={t('comparePick')}
          />
          <button type="button" className="ph-case" onClick={() => onOpen(c.id)}>
            <div className="ph-case-top">
              <span className="ph-case-title">{c.question}</span>
              {statusPill(c.status, t)}
            </div>
            {(c.tags ?? []).length > 0 && (
              <div className="ph-tags">
                {(c.tags ?? []).map(tag => <span key={tag} className="ph-tag-chip">{tag}</span>)}
              </div>
            )}
            <div className="ph-case-meta">
              <span>{modeLabel(c.mode, catalog)}</span>
              {c.engines.length > 0 && <><span className="ph-dot" /><span>{c.engines.join(' · ')}</span></>}
              <span className="ph-dot" />
              <span>{new Date(c.updatedAt).toLocaleString()}</span>
            </div>
          </button>
        </div>
      ))}
    </div>
  )
}

/** 并排看几个案件：按引擎对齐，同一个引擎放在同一行。 */
function CompareView({ t, catalog, ids, onClose }: {
  t: T; catalog: Catalog | null; ids: string[]; onClose: () => void
}) {
  const [records, setRecords] = useState<Case[]>([])
  const [error, setError] = useState('')
  const key = ids.join(',')

  useEffect(() => {
    void (async () => {
      try {
        const loaded = await Promise.all(ids.map(id => api<{ case: Case }>(`/cases/${encodeURIComponent(id)}`)))
        setRecords(loaded.map(r => r.case))
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  const engines = [...new Set(records.flatMap(r => r.findings.map(f => f.engine)))]

  return (
    <div className="ph-modal" onClick={onClose}>
      <div className="ph-modal-body ph-modal-body--compare" onClick={e => e.stopPropagation()}>
        <button type="button" className="ph-modal-close" onClick={onClose} title="关闭">×</button>
        <div className="ph-compare">
          {error && <div className="ph-missing">{error}</div>}
          <div className="ph-compare-head" style={{ gridTemplateColumns: `120px repeat(${records.length}, minmax(0, 1fr))` }}>
            <div />
            {records.map(r => (
              <div key={r.id}>
                <div className="ph-compare-title">{r.question}</div>
                <div className="ph-compare-sub">
                  {modeLabel(r.mode, catalog)} · {r.personas.join(' / ') || '未指定立场'}
                </div>
              </div>
            ))}
          </div>
          {engines.map(engine => (
            <div key={engine} className="ph-compare-row" style={{ gridTemplateColumns: `120px repeat(${records.length}, minmax(0, 1fr))` }}>
              <div className="ph-compare-engine">{engineLabel(engine, catalog)}</div>
              {records.map(r => {
                const finding = r.findings.find(f => f.engine === engine)
                return (
                  <div key={r.id} className="ph-compare-cell">
                    {finding
                      ? <Markdown text={finding.body} />
                      : <span className="ph-hint">{t('compareMissing')}</span>}
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

/** 折叠状态下的一行摘要：去掉 Markdown 标记，压成一行。 */
function peekLine(body: string): string {
  const flat = body.replace(/[*#`>|_~]/g, '').replace(/\s+/g, ' ').trim()
  return flat.length > 78 ? `${flat.slice(0, 78)}…` : flat
}

/** 案件详情：进度 + 引擎结论 + 续推。独立组件才能在内部用 hooks。 */
function CaseDetail({ t, catalog, record, onOpen, onFinish, onRemove }: {
  t: T; catalog: Catalog | null; record: Case
  onOpen: (id: string) => void; onFinish: (id: string) => void; onRemove: (id: string) => void
}) {
  const expected = MODE_ENGINES[record.mode] ?? []
  const doneEngines = new Set(record.findings.map(f => f.engine))
  const missing = expected.filter(e => !doneEngines.has(e))
  const empty = record.findings.length === 0

  const buildBrief = (): string => {
    const doneList = expected.filter(e => doneEngines.has(e)).map(e => engineLabel(e, catalog)).join('、')
    const head = empty ? t('seedStartHead') : t('seedNextHead')
    const tail = empty ? t('seedStartTail') : t('seedNextTail')
    return [
      `${head}${record.id}「${record.question}」`,
      `${t('seedMode')}${modeLabel(record.mode, catalog)}`,
      `${t('seedStances')}${record.personas.join('、') || '—'}`,
      `已完成：${doneList || '—'}`,
      missing.length > 0 ? `${t('missing')}：${missing.map(e => engineLabel(e, catalog)).join('、')}` : t('complete'),
      '',
      tail,
    ].join('\n')
  }

  // 新建的空案件一进详情就把指令摊开，省得殿下再点一次
  const [brief, setBrief] = useState<string>(() => (empty ? buildBrief() : ''))
  const [copied, setCopied] = useState(false)
  const [dispatching, setDispatching] = useState(false)
  const [runNote, setRunNote] = useState('')
  const [runError, setRunError] = useState('')
  const [mapOpen, setMapOpen] = useState(false)
  const [openFindings, setOpenFindings] = useState<Set<Engine>>(new Set())

  const toggleFinding = (engine: Engine) => setOpenFindings(prev => {
    const next = new Set(prev)
    if (next.has(engine)) next.delete(engine)
    else next.add(engine)
    return next
  })
  const allOpen = record.findings.length > 0 && record.findings.every(f => openFindings.has(f.engine))
  const toggleAllFindings = () => setOpenFindings(
    allOpen ? new Set() : new Set(record.findings.map(f => f.engine)),
  )

  const citations = useMemo(
    () => reviewCitations(record.findings.map(f => f.body)),
    [record.id, record.findings.length],
  )

  const makeBrief = () => {
    setBrief(buildBrief())
    setCopied(false)
  }

  const startRun = async () => {
    setDispatching(true)
    setRunError('')
    try {
      const res = await api<{ sessionId: string; engines: string[] }>(`/cases/${record.id}/run`, { method: 'POST' })
      setRunNote(`已派给会话，正在跑 ${res.engines.length} 个引擎。跑完刷新面板即可看到结论。`)
    } catch (e) {
      setRunError(e instanceof Error ? e.message : String(e))
    } finally {
      setDispatching(false)
    }
  }

  const cancelRun = async () => {
    setRunError('')
    try {
      await api(`/cases/${record.id}/cancel`, { method: 'POST' })
      setRunNote('已请求停止这次分析。')
    } catch (e) {
      setRunError(e instanceof Error ? e.message : String(e))
    }
  }

  const archiveSession = async () => {
    setRunError('')
    try {
      await api(`/cases/${record.id}/archive`, { method: 'POST' })
      setRunNote('分析会话已从会话列表收起，案件和日志都还在。')
    } catch (e) {
      setRunError(e instanceof Error ? e.message : String(e))
    }
  }

  // 追问区：直接和这个案件的专用会话对话
  const [turns, setTurns] = useState<ChatTurn[]>([])
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)

  const loadChat = useCallback(async () => {
    try {
      const res = await api<{ turns: ChatTurn[] }>(`/cases/${record.id}/chat`)
      setTurns(res.turns)
    } catch {
      // 专用会话还没建，当作空对话
    }
  }, [record.id])

  useEffect(() => {
    void loadChat()
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void loadChat()
    }, 3000)
    return () => clearInterval(timer)
  }, [loadChat])

  const sendAsk = async () => {
    const text = draft.trim()
    if (!text) return
    setSending(true)
    setRunError('')
    try {
      await api(`/cases/${record.id}/ask`, { method: 'POST', body: JSON.stringify({ text }) })
      setDraft('')
      await loadChat()
    } catch (e) {
      setRunError(e instanceof Error ? e.message : String(e))
    } finally {
      setSending(false)
    }
  }

  const copy = async () => {
    try { await navigator.clipboard.writeText(brief); setCopied(true) } catch { setCopied(false) }
  }

  return (
    <div className="ph-detail">
      <button type="button" className="ph-back" onClick={() => onOpen('')}>← {t('tabCases')}</button>

      <div className="ph-card">
        <div className="ph-detail-head">
          <h3 className="ph-detail-title">{record.question}</h3>
          {statusPill(record.status, t)}
        </div>
        <div className="ph-detail-sub">
          <span>{modeLabel(record.mode, catalog)} · {record.personas.join(' / ') || '未指定立场'}</span>
          <code className="ph-id">{record.id}</code>
        </div>
        {(record.tags ?? []).length > 0 && (
          <div className="ph-tags ph-tags--detail">
            {(record.tags ?? []).map(tag => <span key={tag} className="ph-tag-chip">{tag}</span>)}
          </div>
        )}

        <div className="ph-progress">
          <span>{t('progress')} {expected.length - missing.length}/{expected.length}</span>
          <span className="ph-dots">
            {expected.map(e => (
              <span key={e} className="ph-dot-item" data-done={doneEngines.has(e)} title={engineLabel(e, catalog)} />
            ))}
          </span>
        </div>
        {missing.length > 0
          ? <div className="ph-missing">{t('missing')}：{missing.map(e => engineLabel(e, catalog)).join('、')}</div>
          : <div className="ph-hint">{t('complete')}</div>}

        {record.input && <pre className="ph-input-preview">{record.input}</pre>}

        {/* 主操作紧跟进度条：不用滑到底才能继续跑 */}
        {record.status !== 'done' && (missing.length > 0 || record.status === 'deliberating') && (
          <div className="ph-actions ph-actions--primary">
            {missing.length > 0 && (
              <button type="button" className="ph-btn ph-btn--primary" disabled={dispatching} onClick={() => void startRun()}>
                {dispatching ? t('autoRunning') : t('autoRun')}
              </button>
            )}
            {missing.length > 0 && (
              <button type="button" className="ph-btn" onClick={makeBrief}>{t('nextStep')}</button>
            )}
            {record.status === 'deliberating' && (
              <button type="button" className="ph-btn" onClick={() => void cancelRun()}>{t('cancelRun')}</button>
            )}
            <button type="button" className="ph-btn" onClick={() => onFinish(record.id)}>{t('finish')}</button>
          </div>
        )}
      </div>

      {(citations.known.length + citations.unknown.length) > 0 && (
        <details className="ph-fold">
          <summary>
            {t('citationsTitle')}
            <span className="ph-fold-count">{citations.known.length + citations.unknown.length}</span>
          </summary>
          <div className="ph-fold-body">
            {citations.known.length > 0 && (
              <div className="ph-cite-known">{t('citationsKnown')}{citations.known.join('、')}</div>
            )}
            {citations.unknown.length > 0 && (
              <div className="ph-cite-unknown">
                {t('citationsUnknown')}{citations.unknown.join('、')}
                <div className="ph-hint">{t('citationsHint')}</div>
              </div>
            )}
          </div>
        </details>
      )}

      <div className="ph-findings-head">
        <span className="ph-section-label">{t('findings')}</span>
        {record.findings.length > 1 && (
          <button type="button" className="ph-link-btn" onClick={toggleAllFindings}>
            {allOpen ? t('collapseAll') : t('expandAll')}
          </button>
        )}
      </div>

      {record.findings.length === 0 && (
        <div className="ph-empty">
          <span className="ph-empty-mark">◦</span>
          <span className="ph-empty-text">{t('noFindings')}</span>
        </div>
      )}

      {record.findings.map(f => {
        const open = openFindings.has(f.engine)
        return (
          <div key={f.engine} className="ph-finding" data-open={open}>
            <button type="button" className="ph-finding-head" onClick={() => toggleFinding(f.engine)}>
              <span className="ph-finding-caret">{open ? '▾' : '▸'}</span>
              <span className="ph-finding-name">{engineLabel(f.engine, catalog)}</span>
              {f.sources?.map(s => <code key={s} className="ph-tag">[{s}]</code>)}
              {f.controversy && <span className="ph-tag">{t(controversyKey(f.controversy))}</span>}
            </button>
            {open
              ? <div className="ph-finding-body"><Markdown text={f.body} /></div>
              : <div className="ph-finding-peek">{peekLine(f.body)}</div>}
          </div>
        )
      })}

      {brief && (
        <div className="ph-brief">
          <span className="ph-hint">{t('nextHint')}</span>
          <pre>{brief}</pre>
          <div className="ph-actions">
            <button type="button" className="ph-btn" onClick={() => void copy()}>{copied ? t('copied') : t('copy')}</button>
          </div>
        </div>
      )}

      {(record.beliefs ?? []).length > 0 && (
        <details className="ph-fold">
          <summary>
            {t('beliefsTitle')}
            <span className="ph-fold-count">{(record.beliefs ?? []).length}</span>
          </summary>
          <div className="ph-fold-body">
            <div className="ph-belief-list">
              {(record.beliefs ?? []).map(belief => (
                <div key={belief.id} className="ph-belief" data-tension={belief.tension ? 'true' : undefined}>
                  <div className="ph-belief-text">{belief.text}</div>
                  {belief.tension && <div className="ph-belief-tension">{belief.tension}</div>}
                </div>
              ))}
            </div>
          </div>
        </details>
      )}

      <div className="ph-chat">
        <div className="ph-section-label">{t('chatTitle')}</div>
        <div className="ph-chat-list">
          {turns.length === 0 && <div className="ph-hint">{t('chatEmpty')}</div>}
          {turns.map((turn, i) => (
            <div key={i} className="ph-bubble" data-role={turn.role}>
              {turn.role === 'assistant' ? <Markdown text={turn.text} /> : turn.text}
            </div>
          ))}
        </div>
        <div className="ph-chat-send">
          <textarea className="ph-textarea" rows={2} value={draft} placeholder={t('chatPlaceholder')}
            onChange={e => setDraft(e.target.value)} />
          <button type="button" className="ph-btn ph-btn--primary" disabled={sending || !draft.trim()}
            onClick={() => void sendAsk()}>
            {sending ? t('chatSending') : t('chatSend')}
          </button>
        </div>
      </div>

      {runNote && <div className="ph-hint">{runNote}</div>}
      {runError && <div className="ph-missing">派工失败：{runError}</div>}

      {/* 查看与导出 */}
      {record.findings.length > 0 && (
        <div className="ph-actions ph-actions--tools">
          <button type="button" className="ph-btn" onClick={() => setMapOpen(true)}>{t('mindmap')}</button>
          <a className="ph-btn" download href={`/philosophy-api/export/${encodeURIComponent(record.id)}.md`}>
            {t('exportMd')}
          </a>
          <a className="ph-btn" download href={`/philosophy-api/export/${encodeURIComponent(record.id)}.html`}>
            {t('exportHtml')}
          </a>
        </div>
      )}

      {/* 管理操作收起来，避免和主流程抢注意力 */}
      <details className="ph-fold ph-fold--manage">
        <summary>{t('manage')}</summary>
        <div className="ph-actions">
          {record.findings.length > 0 && (
            <button type="button" className="ph-btn" onClick={() => void archiveSession()}>{t('archiveSession')}</button>
          )}
          <button type="button" className="ph-btn ph-btn--danger" onClick={() => onRemove(record.id)}>{t('remove')}</button>
        </div>
      </details>

      {mapOpen && (
        <div className="ph-modal" onClick={() => setMapOpen(false)}>
          <div className="ph-modal-body" onClick={e => e.stopPropagation()}>
            <button type="button" className="ph-modal-close" onClick={() => setMapOpen(false)} title="关闭">×</button>
            <a className="ph-modal-new" target="_blank" rel="noopener"
              href={`/philosophy-api/mindmap/${encodeURIComponent(record.id)}`}>新窗口打开</a>
            <iframe title="思维导图" src={`/philosophy-api/mindmap/${encodeURIComponent(record.id)}`} />
          </div>
        </div>
      )}
    </div>
  )
}

function NewView({ t, catalog, onCreated }: { t: T; catalog: Catalog; onCreated: (id: string) => Promise<void> }) {
  const [question, setQuestion] = useState('')
  const [mode, setMode] = useState<Mode>('advisor')
  const [personas, setPersonas] = useState<string[]>([])
  const [text, setText] = useState('')
  const [tagInput, setTagInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [personaOpen, setPersonaOpen] = useState(false)

  const toggle = (id: string) => setPersonas(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id])

  const create = async () => {
    if (!question.trim()) return
    setBusy(true)
    try {
      const tags = tagInput.split(/[\s,，、]+/).map(s => s.trim()).filter(Boolean)
      const res = await api<{ case: Case }>('/cases', { method: 'POST', body: JSON.stringify({ question, mode, personas, tags, text: text || undefined }) })
      setQuestion(''); setText(''); setTagInput('')
      await onCreated(res.case.id)
    } finally { setBusy(false) }
  }

  const west = catalog.personas.filter(p => p.tradition === 'west')
  const cn = catalog.personas.filter(p => p.tradition === 'cn')

  const applyTemplate = (tpl: CaseTemplate) => {
    setMode(tpl.mode)
    setPersonas(tpl.personas)
    setTagInput(tpl.tags.join(' '))
  }

  return (
    <div className="ph-form">
      <label className="ph-field">
        <span className="ph-label">{t('question')}</span>
        <input className="ph-input" value={question} placeholder={t('questionPlaceholder')}
          onChange={e => setQuestion(e.target.value)} />
      </label>

      {/* 模式是这次审议里最关键的决策，给它卡片而不是小芯片 */}
      <div className="ph-field">
        <span className="ph-label">{t('mode')}</span>
        <div className="ph-modes">
          {MODE_KEYS.map(m => (
            <button key={m} type="button" className="ph-mode" data-on={mode === m} onClick={() => setMode(m)}>
              <span className="ph-mode-name">{catalog.modes[m].zh}</span>
              <span className="ph-mode-duty">{catalog.modes[m].duty}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="ph-field">
        <span className="ph-label">{t('templateLabel')}</span>
        <div className="ph-templates">
          {TEMPLATES.map(tpl => (
            <button key={tpl.id} type="button" className="ph-template" onClick={() => applyTemplate(tpl)}>
              <span className="ph-template-name">{tpl.name}</span>
              <span className="ph-template-hint">{tpl.hint}</span>
            </button>
          ))}
        </div>
        <span className="ph-hint">{t('templateHint')}</span>
      </div>

      {/* 64 位哲学家默认收起来，选了才展开 */}
      <div className="ph-field">
        <button type="button" className="ph-fold-toggle" onClick={() => setPersonaOpen(v => !v)}>
          <span className="ph-fold-caret">{personaOpen ? '▾' : '▸'}</span>
          <span className="ph-fold-title">{t('personas')}</span>
          <span className="ph-fold-count">{personas.length > 0 ? `${personas.length} 位` : '可选'}</span>
        </button>
        {personaOpen && (
          <div className="ph-persona-pick">
            {([['traditionWest', west], ['traditionCn', cn]] as const).map(([key, list]) => (
              <div key={key} className="ph-chips">
                <span className="ph-tradition">{t(key)}</span>
                {list.map(p => (
                  <button key={p.id} type="button" className="ph-chip" data-on={personas.includes(p.id)}
                    title={`${p.anchor}｜最易被误读成：${p.caricature}`} onClick={() => toggle(p.id)}>
                    {p.zh}
                  </button>
                ))}
              </div>
            ))}
            <span className="ph-hint">{t('personasHint')}</span>
          </div>
        )}
      </div>

      <details className="ph-fold">
        <summary>{t('text')}<span className="ph-fold-count">可选</span></summary>
        <div className="ph-fold-body">
          <textarea className="ph-textarea" rows={5} value={text} placeholder={t('textPlaceholder')}
            onChange={e => setText(e.target.value)} />
        </div>
      </details>

      <label className="ph-field">
        <span className="ph-label">{t('tagsLabel')}</span>
        <input className="ph-input" value={tagInput} placeholder={t('tagsPlaceholder')}
          onChange={e => setTagInput(e.target.value)} />
      </label>

      <div className="ph-actions ph-form-submit">
        <button type="button" className="ph-btn ph-btn--primary" disabled={busy || !question.trim()} onClick={() => void create()}>
          {busy ? t('creating') : t('act')}
        </button>
      </div>
    </div>
  )
}

/** 把图片压到 1600px 以内再存，localStorage 只有 5MB。 */
async function compressImage(file: File, max = 1600): Promise<string> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(bitmap.width * scale))
  canvas.height = Math.max(1, Math.round(bitmap.height * scale))
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas 不可用')
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close?.()
  return canvas.toDataURL('image/jpeg', 0.82)
}

const BG_KEY = 'dsh-philosophy-bg'

function applyBg(value: string | null): void {
  const root = document.documentElement
  if (value === null) root.style.setProperty('--ph-bg-image', 'none')
  else if (value) root.style.setProperty('--ph-bg-image', `url("${value}")`)
  else root.style.removeProperty('--ph-bg-image')
}

/** 侧边栏背景：选图 / 恢复默认 / 关掉。存在浏览器本地，不上传。 */
function BgSettings({ t }: { t: T }) {
  const [custom, setCustom] = useState(false)
  const [off, setOff] = useState(false)
  const [note, setNote] = useState('')

  useEffect(() => {
    const saved = localStorage.getItem(BG_KEY)
    if (saved) {
      applyBg(saved)
      setCustom(true)
    }
  }, [])

  const pick = async (file: File) => {
    try {
      const dataUrl = await compressImage(file)
      localStorage.setItem(BG_KEY, dataUrl)
      applyBg(dataUrl)
      setCustom(true)
      setOff(false)
      setNote(t('bgApplied'))
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e))
    }
  }

  const reset = () => {
    localStorage.removeItem(BG_KEY)
    applyBg(null)
    setCustom(false)
    setOff(true)
    setNote(t('bgReset'))
  }

  const restore = () => {
    localStorage.removeItem(BG_KEY)
    applyBg(null)
    setCustom(false)
    setOff(false)
    setNote(t('bgRestored'))
  }

  return (
    <div className="ph-field">
      <span className="ph-label">{t('bgTitle')}</span>
      <div className="ph-bg-row">
        <label className="ph-btn ph-btn--small">
          {t('bgPick')}
          <input
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={e => {
              const file = e.target.files?.[0]
              if (file) void pick(file)
              e.target.value = ''
            }}
          />
        </label>
        {custom && <button type="button" className="ph-btn ph-btn--small" onClick={restore}>{t('bgRestore')}</button>}
        {!off && <button type="button" className="ph-btn ph-btn--small" onClick={reset}>{t('bgOff')}</button>}
        {off && <button type="button" className="ph-btn ph-btn--small" onClick={restore}>{t('bgOn')}</button>}
      </div>
      <span className="ph-hint">{note || t('bgHint')}</span>
    </div>
  )
}

function RefsView({ t, catalog }: { t: T; catalog: Catalog | null }) {
  const personas = useMemo(() => catalog?.personas ?? [], [catalog])
  const [openId, setOpenId] = useState<string | null>(null)
  const [concepts, setConcepts] = useState<ConceptEntry[]>([])
  const [openConcept, setOpenConcept] = useState<string | null>(null)
  const [stats, setStats] = useState<{ total: number; done: number; findings: number } | null>(null)

  useEffect(() => {
    void (async () => {
      try {
        const [cj, cs] = await Promise.all([
          api<{ concepts: ConceptEntry[] }>('/concepts'),
          api<{ cases: Summary[]; total: number }>('/cases'),
        ])
        setConcepts(cj.concepts)
        setStats({
          total: cs.total,
          done: cs.cases.filter(c => c.status === 'done').length,
          findings: cs.cases.reduce((sum, c) => sum + c.findings, 0),
        })
      } catch {
        // 概念库还没建，忽略
      }
    })()
  }, [])
  return (
    <div className="ph-refs">
      <BgSettings t={t} />

      <div className="ph-section-label">{t('sourcesTitle')}</div>
      {SOURCES.map(s => (
        <a key={s.href} className="ph-source" href={s.href} target="_blank" rel="noreferrer">
          <span className="ph-source-name">{s.name}</span>
          <span className="ph-source-url">{s.href}</span>
          <span className="ph-source-note">{s.note}</span>
        </a>
      ))}
      <span className="ph-hint">{t('sourcesHint')}</span>

      <div className="ph-section-label">{t('enginesTitle')}</div>
      {ENGINE_KEYS.map(e => (
        <div key={e} className="ph-engine">
          <span className="ph-engine-name">{catalog?.engines[e]?.zh ?? e}</span>
          <span className="ph-engine-cue">{catalog?.engines[e]?.cue ?? ''}</span>
        </div>
      ))}

      {stats && stats.total > 0 && (
        <div className="ph-stats">
          <div className="ph-stat"><b>{stats.total}</b><span>{t('statCases')}</span></div>
          <div className="ph-stat"><b>{stats.done}</b><span>{t('statDone')}</span></div>
          <div className="ph-stat"><b>{stats.findings}</b><span>{t('statFindings')}</span></div>
          <div className="ph-stat"><b>{concepts.length}</b><span>{t('statConcepts')}</span></div>
          <div className="ph-stat"><b>{concepts.reduce((n, c) => n + c.readings.length, 0)}</b><span>{t('statReadings')}</span></div>
        </div>
      )}

      {concepts.length > 0 && (
        <>
          <div className="ph-section-label">{t('conceptsTitle')}</div>
          {concepts.map(c => {
            const open = openConcept === c.id
            return (
              <div key={c.id} className="ph-persona" data-open={open}>
                <button type="button" className="ph-persona-toggle" onClick={() => setOpenConcept(open ? null : c.id)}>
                  <span className="ph-persona-head">
                    <strong>{c.term}</strong>
                    <span className="ph-id">{c.readings.length} 个义项</span>
                  </span>
                  <span className="ph-persona-caret">{open ? '−' : '+'}</span>
                </button>
                {open && (
                  <div className="ph-persona-body">
                    {c.readings.map(reading => (
                      <div key={reading.name} className="ph-concept-reading">
                        <strong>{reading.name}</strong>
                        <div>{reading.criterion}</div>
                        {reading.fromCase && <div className="ph-persona-warn">出自 {reading.fromCase}</div>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </>
      )}

      {personas.length > 0 && (
        <>
          <div className="ph-section-label">{t('personas')}</div>
          {personas.map(p => {
            const open = openId === p.id
            return (
              <div key={p.id} className="ph-persona" data-open={open}>
                <button type="button" className="ph-persona-toggle" onClick={() => setOpenId(open ? null : p.id)}>
                  <span className="ph-persona-head">
                    <strong>{p.zh}</strong>
                    <span className="ph-id">{p.en}</span>
                    <span className="ph-persona-tag">{p.tradition === 'west' ? t('traditionWest') : t('traditionCn')}</span>
                  </span>
                  <span className="ph-persona-caret">{open ? '−' : '+'}</span>
                </button>
                {open && (
                  <div className="ph-persona-body">
                    {p.intro && <p className="ph-persona-intro">{p.intro}</p>}
                    <div className="ph-persona-anchor">锚点：{p.anchor}</div>
                    <div className="ph-persona-warn">勿写成：{p.caricature}</div>
                  </div>
                )}
              </div>
            )
          })}
        </>
      )}
    </div>
  )
}

function engineLabel(engine: Engine, catalog: Catalog | null): string {
  return catalog?.engines[engine]?.zh ?? engine
}

function modeLabel(mode: Mode, catalog: Catalog | null): string {
  return catalog?.modes[mode]?.zh ?? mode
}

function controversyKey(c: string): 'controversyConsensus' | 'controversyDebatable' | 'controversyContested' | 'controversySpeculative' {
  if (c === 'debatable') return 'controversyDebatable'
  if (c === 'contested') return 'controversyContested'
  if (c === 'speculative') return 'controversySpeculative'
  return 'controversyConsensus'
}

function statusPill(status: string, t: T) {
  const key = STATUS_KEY[status as keyof typeof STATUS_KEY] ?? 'statusOpen'
  return <span className="ph-pill" data-s={status}>{t(key)}</span>
}
