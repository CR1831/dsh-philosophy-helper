/** 案件存储：一个 JSON 文件，原子写入，进程内串行化。 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type { Case, Engine, Finding, Mode } from './types.ts'
import { MODE_ENGINES } from './types.ts'

/** 默认落盘位置：~/.dsh/storages/philosophy-agent/cases.json。 */
export function defaultStateDir(): string {
  return join(homedir(), '.dsh', 'storages', 'philosophy-agent')
}

interface StoreFile {
  version: 1
  cases: Case[]
}

export class CaseStore {
  private readonly file: string
  private queue: Promise<unknown> = Promise.resolve()
  private cache: Case[] | undefined

  constructor(stateDir: string = defaultStateDir()) {
    this.file = join(stateDir, 'cases.json')
  }

  get path(): string {
    return this.file
  }

  private async load(): Promise<Case[]> {
    if (this.cache) return this.cache
    try {
      const text = await readFile(this.file, 'utf8')
      const parsed = JSON.parse(text) as StoreFile
      const cases = Array.isArray(parsed.cases) ? parsed.cases : []
      // 自动结案是后加的逻辑，历史案件可能引擎都齐了却还停在「审议中」。
      // 读的时候校正一遍，保证面板状态和实际内容一致。
      for (const record of cases) {
        const expected = MODE_ENGINES[record.mode] ?? []
        const done = new Set(record.findings.map(f => f.engine))
        if (expected.length > 0 && expected.every(engine => done.has(engine))) record.status = 'done'
      }
      this.cache = cases
    } catch {
      this.cache = []
    }
    return this.cache
  }

  private async persist(cases: Case[]): Promise<void> {
    this.cache = cases
    await mkdir(dirname(this.file), { recursive: true })
    const tmp = `${this.file}.tmp`
    await writeFile(tmp, JSON.stringify({ version: 1, cases } satisfies StoreFile, null, 2), 'utf8')
    await rename(tmp, this.file)
  }

  /** 串行化所有写操作，避免并发工具调用互相覆盖。 */
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const next = this.queue.then(work, work)
    this.queue = next.catch(() => undefined)
    return next
  }

  list(): Promise<Case[]> {
    return this.serial(async () => (await this.load()).slice().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)))
  }

  async get(id: string): Promise<Case | undefined> {
    return (await this.load()).find(c => c.id === id)
  }

  open(input: { question: string; mode: Mode; personas?: string[]; text?: string; tags?: string[]; id?: string }): Promise<Case> {
    return this.serial(async () => {
      const cases = await this.load()
      const now = new Date().toISOString()
      const record: Case = {
        id: input.id ?? fallbackId(now),
        createdAt: now,
        updatedAt: now,
        question: input.question.trim(),
        mode: input.mode,
        status: 'open',
        input: input.text,
        personas: input.personas ?? [],
        ...(input.tags?.length ? { tags: input.tags } : {}),
        findings: [],
      }
      await this.persist([record, ...cases])
      return record
    })
  }

  /** 记一条用户立场；tension 写它和哪条冲突。 */
  addBelief(id: string, input: { text: string; tension?: string }): Promise<Case | undefined> {
    return this.serial(async () => {
      const cases = await this.load()
      const target = cases.find(c => c.id === id)
      if (!target) return undefined
      const text = input.text.trim()
      if (!text) return target
      const list = target.beliefs ?? []
      list.push({
        id: `b${list.length + 1}`,
        text,
        at: new Date().toISOString(),
        ...(input.tension?.trim() ? { tension: input.tension.trim() } : {}),
      })
      target.beliefs = list
      target.updatedAt = new Date().toISOString()
      await this.persist(cases)
      return target
    })
  }

  setTags(id: string, tags: string[]): Promise<Case | undefined> {
    return this.serial(async () => {
      const cases = await this.load()
      const target = cases.find(c => c.id === id)
      if (!target) return undefined
      const clean = [...new Set(tags.map(t => t.trim()).filter(Boolean))].slice(0, 12)
      if (clean.length) target.tags = clean
      else delete target.tags
      target.updatedAt = new Date().toISOString()
      await this.persist(cases)
      return target
    })
  }

  addFinding(id: string, finding: Omit<Finding, 'createdAt'>): Promise<Case | undefined> {
    return this.serial(async () => {
      const cases = await this.load()
      const target = cases.find(c => c.id === id)
      if (!target) return undefined
      target.findings = [
        ...target.findings.filter(f => f.engine !== finding.engine),
        { ...finding, createdAt: new Date().toISOString() },
      ]
      target.updatedAt = new Date().toISOString()
      // 该模式要求的引擎都齐了才结案；只补了部分就继续留在「审议中」。
      const expected = MODE_ENGINES[target.mode] ?? []
      const done = new Set(target.findings.map(f => f.engine))
      target.status = expected.length > 0 && expected.every(engine => done.has(engine)) ? 'done' : 'deliberating'
      await this.persist(cases)
      return target
    })
  }

  finish(id: string, status: Case['status'] = 'done', notes?: string): Promise<Case | undefined> {
    return this.serial(async () => {
      const cases = await this.load()
      const target = cases.find(c => c.id === id)
      if (!target) return undefined
      target.status = status
      if (notes !== undefined) target.notes = notes
      target.updatedAt = new Date().toISOString()
      await this.persist(cases)
      return target
    })
  }

  remove(id: string): Promise<boolean> {
    return this.serial(async () => {
      const cases = await this.load()
      const next = cases.filter(c => c.id !== id)
      if (next.length === cases.length) return false
      await this.persist(next)
      return true
    })
  }
}

function fallbackId(iso: string): string {
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `P${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

export type { Engine }
