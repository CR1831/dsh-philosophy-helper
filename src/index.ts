/** dsh-philosophy host 入口：案件存储、哲学工具、提示注入、面板 API。 */
import type { Context } from '@deepseek-ai/cordis'
import { registerApi } from './http.ts'
import { registerPrompt } from './prompt.ts'
import { CaseStore, defaultStateDir } from './store.ts'
import { ConceptStore } from './concepts.ts'
import { registerTools } from './tools.ts'

export const name = 'dsh-philosophy'
export const inject = ['tools', 'systemPrompt', 'webServer', 'agents', 'sessionController', 'sessionPersistence', 'workspaceRegistry']

export interface Config {
  /** 案件落盘目录，缺省 ~/.dsh/storages/philosophy-agent。 */
  stateDir?: string
}

export function apply(ctx: Context, config: Config = {}): void {
  const stateDir = config.stateDir ?? defaultStateDir()
  const store = new CaseStore(stateDir)
  const concepts = new ConceptStore(stateDir)
  registerTools(ctx, store, concepts)
  registerPrompt(ctx, store)
  registerApi(ctx, { store, concepts })
  ctx.logger.info('哲学工作台就绪：侧边栏「哲学」；案件存于 %s', store.path)
}

export { CaseStore, defaultStateDir } from './store.ts'
export { PHILOSOPHY_PROMPT } from './prompt.ts'
export * from './types.ts'
