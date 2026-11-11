/** 概念谱系：跨案件复用的概念库。
 *
 * 一个词条存多个义项，每个义项带判准与出处案件。同一个词在不同案件里被拆开过，
 * 下次再遇到就不必从零开始。
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { defaultStateDir } from './store.ts'

export interface ConceptReading {
  /** 义项名，例如「消极自由」。 */
  name: string
  /** 判准：怎么把它和相邻义项分开。 */
  criterion: string
  /** 出自哪个案件。 */
  fromCase?: string
}

export interface ConceptEntry {
  id: string
  term: string
  readings: ConceptReading[]
  updatedAt: string
}

function slug(term: string): string {
  return term.trim().toLowerCase().replace(/\s+/g, '-')
}

export class ConceptStore {
  private readonly file: string
  private cache: ConceptEntry[] | undefined
  private queue: Promise<unknown> = Promise.resolve()

  constructor(stateDir: string = defaultStateDir()) {
    this.file = join(stateDir, 'concepts.json')
  }

  get path(): string {
    return this.file
  }

  private async load(): Promise<ConceptEntry[]> {
    if (this.cache) return this.cache
    try {
      const parsed = JSON.parse(await readFile(this.file, 'utf8')) as { concepts?: ConceptEntry[] }
      this.cache = Array.isArray(parsed.concepts) ? parsed.concepts : []
    } catch {
      this.cache = []
    }
    return this.cache
  }

  private async persist(entries: ConceptEntry[]): Promise<void> {
    this.cache = entries
    await mkdir(dirname(this.file), { recursive: true })
    const tmp = `${this.file}.tmp`
    await writeFile(tmp, JSON.stringify({ version: 1, concepts: entries }, null, 2), 'utf8')
    await rename(tmp, this.file)
  }

  private serial<T>(work: () => Promise<T>): Promise<T> {
    const next = this.queue.then(work, work)
    this.queue = next.catch(() => undefined)
    return next
  }

  list(): Promise<ConceptEntry[]> {
    return this.serial(async () =>
      (await this.load()).slice().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)))
  }

  /** 按词合并：同名义项只更新判准与出处，不会重复堆积。 */
  upsert(input: { term: string; readings: ConceptReading[]; caseId?: string }): Promise<ConceptEntry> {
    return this.serial(async () => {
      const entries = await this.load()
      const term = input.term.trim()
      if (!term) throw new Error('概念不能为空')
      const id = slug(term)
      const now = new Date().toISOString()

      let entry = entries.find(e => e.id === id)
      if (!entry) {
        entry = { id, term, readings: [], updatedAt: now }
        entries.unshift(entry)
      }

      for (const reading of input.readings) {
        const name = reading.name.trim()
        if (!name) continue
        const criterion = reading.criterion.trim()
        const existing = entry.readings.find(r => r.name === name)
        if (existing) {
          if (criterion) existing.criterion = criterion
          if (input.caseId) existing.fromCase = input.caseId
        } else {
          entry.readings.push({ name, criterion, ...(input.caseId ? { fromCase: input.caseId } : {}) })
        }
      }
      entry.updatedAt = now
      await this.persist(entries)
      return entry
    })
  }

  remove(id: string): Promise<boolean> {
    return this.serial(async () => {
      const entries = await this.load()
      const next = entries.filter(e => e.id !== id)
      if (next.length === entries.length) return false
      await this.persist(next)
      return true
    })
  }
}
