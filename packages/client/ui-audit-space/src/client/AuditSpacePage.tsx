/**
 * The audit-space page: a project picker, a wide-table picker, and a chat
 * zone that prompts a real agent Session. A vertical slice of the audit
 * workbench prototype — the project and table data are mock rows, the chat
 * is live.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { IconShieldOutlineRegular, MarkdownText, type MarkdownLabels } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import { AUDIT_PROJECTS, WIDE_TABLES } from './mock-data.ts'
import type { AuditSpaceFace } from './audit-space-controller.ts'
import type { AuditLine } from './audit-space-store.ts'
import { createAuditSpaceStore } from './audit-space-store.ts'
import css from './AuditSpacePage.module.css'

/** Full component props assembled by the main slot renderer. */
export type AuditSpacePageProps =
  PropsRuntime<'main'>
  & PropsLocale<'auditSpace'>
  & PropsStore<ReturnType<typeof createAuditSpaceStore>>
  & AuditSpaceFace

function lineKey(index: number, line: AuditLine): string {
  return `${index}:${line.kind}${'callId' in line ? `:${line.callId}` : ''}`
}

/**
 * Render the audit workbench.
 * @param props - the composed props: locale seat, store seat, and the controller face.
 * @returns the page element.
 */
export function AuditSpacePage(props: AuditSpacePageProps): ReactNode {
  const { t } = props
  const state = props.useStore(snapshot => snapshot)
  const [toast, setToast] = useState<string | null>(null)
  const toastTimer = useRef<number | null>(null)
  const scrollEnd = useRef<HTMLDivElement>(null)

  useEffect(() => {
    scrollEnd.current?.scrollIntoView({ block: 'end' })
  }, [state.lines, state.streaming])

  useEffect(() => () => {
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current)
  }, [])

  const showToast = (message: string): void => {
    setToast(message)
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() =>{  setToast(null) }, 2200)
  }

  const markdownLabels: MarkdownLabels = useMemo(() => ({
    code: { copyLabel: t('copy'), copiedLabel: t('copied') },
    footnotes: t('footnotes'),
  }), [t])

  const projects = useMemo(
    () => AUDIT_PROJECTS.filter(project => !state.projectQuery || project.name.includes(state.projectQuery)),
    [state.projectQuery],
  )
  const tables = useMemo(
    () => WIDE_TABLES.filter(table => !state.tableQuery || table.name.includes(state.tableQuery)),
    [state.tableQuery],
  )

  const onSave = (): void =>{  showToast(t('saved')) }
  const onSelectProject = (name: string): void => {
    props.actions.selectProject(name)
    showToast(t('panel'))
  }
  const onSend = (): void => {
    if (state.draft.trim().length === 0) return
    void props.send(state.draft)
  }
  const onComposeKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      onSend()
    }
  }

  const transcript = (
    <>
      {state.lines.map((line, index) => {
        switch (line.kind) {
          case 'user':
            return (
              <div key={lineKey(index, line)} className={css.msgRowUser}>
                <div className={`${css.bubble} ${css.userBubble}`}>{line.text}</div>
              </div>
            )
          case 'assistant':
            return (
              <div key={lineKey(index, line)} className={css.msgRowAssistant}>
                <div className={`${css.bubble} ${css.assistantBubble}`}>
                  <MarkdownText text={line.text} labels={markdownLabels} />
                </div>
              </div>
            )
          case 'tool':
            return (
              <div key={lineKey(index, line)} className={css.toolRow}>
                <span className={css.toolDot} data-state={line.state} />
                <span className={css.toolName}>{line.name}</span>
                <span className={css.toolState}>
                  {line.state === 'running' ? t('toolRunning', { name: line.name })
                    : line.state === 'error' ? t('toolError', { name: line.name })
                      : t('toolDone', { name: line.name })}
                </span>
              </div>
            )
          case 'turn':
            return <div key={lineKey(index, line)} className={css.turnDivider}>{t('turn', { turn: line.turn })}</div>
          case 'system':
            return <div key={lineKey(index, line)} className={css.systemRow}>{line.text}</div>
        }
      })}
      {state.streaming.map(entry => (
        <div key={`stream:${entry.attemptId}`} className={css.msgRowAssistant}>
          <div className={`${css.bubble} ${css.assistantBubble}`}>
            <MarkdownText text={entry.text} streaming labels={markdownLabels} />
          </div>
        </div>
      ))}
      {state.running && state.streaming.length === 0 && (
        <div className={css.runningRow}>{t('running')}</div>
      )}
      <div ref={scrollEnd} />
    </>
  )

  return (
    <div className={css.page}>
      <header className={css.topbar}>
        <span className={css.crumb}>
          <span className={css.crumbBase}>{t('panel')}</span>
          {state.project !== null && (<><span className={css.crumbSep}>/</span><b className={css.crumbProject}>{state.project}</b></>)}
        </span>
        <span className={css.spacer} />
        <button type="button" className={css.primaryBtn} onClick={onSave}>{t('saveConfig')}</button>
      </header>

      <div className={css.content}>
        {/* ── 项目选择 ── */}
        <section className={`${css.card} ${css.projectCard}`}>
          <div className={css.cardHead}>
            <span className={css.bar} />
            <h2>{t('panel')}</h2>
            <span className={css.count}>{t('projects', { count: projects.length })}</span>
            <div className={css.search}>
              <input
                type="text"
                placeholder={t('searchProject')}
                value={state.projectQuery}
                onChange={(event) =>{  props.actions.setProjectQuery(event.target.value) }}
              />
            </div>
          </div>
          <div className={css.projectChips}>
            {projects.map(project => (
              <button
                key={project.name}
                type="button"
                className={`${css.chip} ${state.project === project.name ? css.chipActive : ''}`}
                onClick={() =>{  onSelectProject(project.name) }}
              >
                <span className={css.chipDot} style={{ background: project.color }} />
                {project.name}
              </button>
            ))}
            {projects.length === 0 && <span className={css.noHit}>{t('noProject')}</span>}
          </div>
        </section>

        {/* ── 宽表选择（选中项目后）── */}
        {state.project !== null && (
          <section className={`${css.card} ${css.tablesCard}`}>
            <div className={css.cardHead}>
              <span className={css.bar} />
              <h2>{t('selectTables')}</h2>
              <span className={css.count}>{t('totalTables', { count: tables.length })}</span>
              <div className={css.search}>
                <input
                  type="text"
                  placeholder={t('searchTables')}
                  value={state.tableQuery}
                  onChange={(event) =>{  props.actions.setTableQuery(event.target.value) }}
                />
              </div>
            </div>
            <div className={css.tableList}>
              {tables.map((table) => {
                const selected = state.selectedTables.includes(table.id)
                return (
                  <div key={table.id} className={css.tableRow} data-auth={table.auth}>
                    <label className={css.tableToggle}>
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={() =>{  props.actions.toggleTable(table.id) }}
                      />
                      <span className={`${css.authBadge} ${table.auth ? css.authYes : css.authNo}`}>
                        {table.auth ? t('authorized') : t('unauthorized')}
                      </span>
                    </label>
                    <div className={css.tableMeta}>
                      <div className={css.tableName}>{table.name}</div>
                      <div className={css.tableShort}>{table.short}</div>
                      <div className={css.tableFoot}>
                        <span>{t('companies', { count: table.companies })}</span>
                        <span>{t('viewFields')} {table.fields.length}</span>
                      </div>
                    </div>
                    <span className={css.tableArrow}>›</span>
                  </div>
                )
              })}
            </div>
          </section>
        )}

        {/* ── 聊天区（复用 harness 会话）── */}
        <section className={css.chatZone}>
          <div className={css.transcript}>
            {state.lines.length === 0 && state.streaming.length === 0 && (
              <div className={css.emptyChat}>
                <IconShieldOutlineRegular size={30} />
                <p>{state.project !== null ? t('intro') : t('emptyDesc')}</p>
              </div>
            )}
            {transcript}
          </div>
          <div className={css.composer}>
            <textarea
              className={css.input}
              placeholder={t('chatPlaceholder')}
              value={state.draft}
              onChange={(event) =>{  props.actions.setDraft(event.target.value) }}
              onKeyDown={onComposeKeyDown}
              rows={2}
            />
            <div className={css.composerBar}>
              <span className={css.sessionState} data-ready={state.sessionReady}>
                {state.sessionId !== null ? t('panel') : t('emptyTitle')}
              </span>
              <span className={css.spacer} />
              <button
                type="button"
                className={`${css.sendBtn} ${(state.sending || state.running || state.draft.trim().length === 0) ? css.sendDisabled : ''}`}
                onClick={onSend}
                disabled={state.sending || state.running}
              >
                {state.sending ? '…' : t('send')}
              </button>
            </div>
          </div>
        </section>
      </div>

      {toast !== null && <div className={css.toast}>{toast}</div>}
    </div>
  )
}
