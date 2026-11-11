/** 浏览器插件入口：注册侧边栏图标与主面板。 */
import { Component, type ReactNode } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type { SidebarPanelIconOwnerProps } from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { App } from './app.tsx'
import { en, zh, type T } from './locales.ts'

type ClientContext = Context
const NS = 'dshPhilosophy'
const PANEL_ID = 'dsh-philosophy' as MainPanelId

/** 天平：哲学的老符号，比问号少一点套路感。 */
function ScalesIcon({ size }: SidebarPanelIconOwnerProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 3.5v17" />
      <path d="M7.5 20.5h9" />
      <path d="M4.5 7.5h15" />
      <path d="M4.5 7.5 2 13.5a3.2 3.2 0 0 0 5 0z" />
      <path d="M19.5 7.5 17 13.5a3.2 3.2 0 0 0 5 0z" />
      <circle cx="12" cy="5.6" r="1.4" />
    </svg>
  )
}

/** 渲染失败时把堆栈摊在面板上，而不是留一块黑。 */
class Boundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error }
  }

  render() {
    const { error } = this.state
    if (error) {
      return (
        <pre style={{
          margin: 0,
          padding: 12,
          fontSize: 11.5,
          lineHeight: 1.6,
          whiteSpace: 'pre-wrap',
          overflow: 'auto',
          height: '100%',
          boxSizing: 'border-box',
          color: '#e08a8a',
        }}>
          {`哲学面板渲染失败\n\n${error.message}\n\n${error.stack ?? ''}`}
        </pre>
      )
    }
    return this.props.children
  }
}

export const inject = ['slots', 'locale']

export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-philosophy: dictionaries')
  const fallback = ctx.locale.bind(NS) as unknown as T
  ctx.slots.inject('main', () => ctx.slots.register(
    { name: 'main', key: PANEL_ID, locale: NS, inject: () => ({}) },
    (props: { t?: T }) => <Boundary><App t={props.t ?? fallback} /></Boundary>,
  ))
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register(
    { name: 'sidebar.panellist', id: PANEL_ID, order: 90, label: () => fallback('panel'), locale: NS },
    ScalesIcon,
  ))
}
