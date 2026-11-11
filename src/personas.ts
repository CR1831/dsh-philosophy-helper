/** 人格方阵加载：优先读 assets/personas.json，读不到退回内置表。
 *
 * 改完 JSON 不用重新编译，也不用重载插件——按 mtime 缓存，下次请求自动生效。
 */
import { readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { DEFAULT_PERSONAS, PERSONAS, type Persona } from './types.ts'

const FILE = new URL('../assets/personas.json', import.meta.url)

export interface PersonaLibrary {
  personas: Persona[]
  defaults: string[]
  /** 数据来源：外置文件还是内置表。 */
  source: 'file' | 'builtin'
  /** 读文件失败时的原因，成功时不出现。 */
  error?: string
}

interface FileShape {
  version?: number
  defaults?: string[]
  personas?: Persona[]
}

const TRADITIONS: ReadonlySet<string> = new Set(['west', 'cn'])

function isValidPersona(value: unknown): value is Persona {
  if (!value || typeof value !== 'object') return false
  const p = value as Record<string, unknown>
  return typeof p.id === 'string' && p.id.trim().length > 0
    && typeof p.zh === 'string' && p.zh.trim().length > 0
    && typeof p.en === 'string'
    && typeof p.tradition === 'string' && TRADITIONS.has(p.tradition)
    && typeof p.anchor === 'string'
    && typeof p.caricature === 'string'
}

let cache: { mtime: number; library: PersonaLibrary } | undefined

function builtin(reason?: string): PersonaLibrary {
  return { personas: PERSONAS, defaults: DEFAULT_PERSONAS, source: 'builtin', ...(reason ? { error: reason } : {}) }
}

/** 读一次人格库；文件没变就走缓存。绝不抛错——坏了就退回内置表。 */
export function loadPersonas(): PersonaLibrary {
  try {
    const path = fileURLToPath(FILE)
    const stat = statSync(path)
    if (cache && cache.mtime === stat.mtimeMs) return cache.library

    const parsed = JSON.parse(readFileSync(path, 'utf8')) as FileShape
    const list = Array.isArray(parsed.personas) ? parsed.personas.filter(isValidPersona) : []
    if (list.length === 0) return builtin('personas.json 里没有有效人格，已退回内置表')

    const known = new Set(list.map(p => p.id))
    const wanted = Array.isArray(parsed.defaults) ? parsed.defaults.filter(id => known.has(id)) : []
    const defaults = wanted.length > 0 ? wanted : DEFAULT_PERSONAS.filter(id => known.has(id))
    const fallbackDefaults = defaults.length > 0 ? defaults : list.slice(0, 4).map(p => p.id)

    const library: PersonaLibrary = { personas: list, defaults: fallbackDefaults, source: 'file' }
    cache = { mtime: stat.mtimeMs, library }
    return library
  } catch (error) {
    return builtin(error instanceof Error ? error.message : String(error))
  }
}
