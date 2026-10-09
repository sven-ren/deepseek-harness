/**
 * The audit-space page: the prototype's right pane, rebuilt on top of a real
 * agent Session. The 项目基础信息 card, wide-table list, three modals and the
 * chat chrome are transcribed from the product prototype; the chat zone is the
 * only piece wired to the harness — every other row is mock data.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { MarkdownText, type MarkdownLabels } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import { AUDIT_PROJECTS, COMPANY_POOL, PROJECT_DETAIL, WIDE_TABLES } from './mock-data.ts'
import type { WideTable } from './mock-data.ts'
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

/* ── Inline icons, lifted from the prototype's markup ─────────────────────── */

const ICON_FOLD = (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round">
    <path d="M18 15l-6-6-6 6" />
  </svg>
)
const ICON_PJ_DETAIL = (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round">
    <circle cx="9" cy="8" r="3.2" /><path d="M3.5 19c.6-3.2 2.9-5 5.5-5s4.9 1.8 5.5 5" />
    <circle cx="17" cy="9" r="2.4" /><path d="M15.5 14.2c2.6.2 4.4 1.7 5 4.3" />
  </svg>
)
const ICON_RIGHT = (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round">
    <path d="M9 6l6 6-6 6" />
  </svg>
)
const ICON_SEARCH = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#a0a5ae" strokeWidth={2} strokeLinecap="round">
    <circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" />
  </svg>
)
const ICON_SCOPE = (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round">
    <circle cx="9" cy="8" r="3.2" /><path d="M3.5 19c.6-3.2 2.9-5 5.5-5s4.9 1.8 5.5 5" />
    <circle cx="17" cy="9" r="2.4" /><path d="M15.5 14.2c2.6.2 4.4 1.7 5 4.3" />
  </svg>
)
const ICON_FIELD = (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
    <rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 10h18M9 10v10" />
  </svg>
)
const ICON_FOLDER = (
  <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#8a52e0" strokeWidth={1.5} strokeLinejoin="round">
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
  </svg>
)
const ICON_SHIELD = (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6z" />
  </svg>
)
const ICON_INFO = (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
    <circle cx="12" cy="12" r="9" /><path d="M12 8v5M12 16h.01" />
  </svg>
)
const ICON_SEND = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 19V5M5 12l7-7 7 7" />
  </svg>
)
const ICON_RELOAD = (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
    <path d="M21 12a9 9 0 1 1-2.6-6.3" /><path d="M21 3v6h-6" />
  </svg>
)
const AVATAR_AI = (
  <svg width="16" height="16" viewBox="0 0 26 26">
    <path d="M13 12 C9 4, 2 3, 3 9 C4 14, 9 15, 13 14 Z" fill="#a05cf0" />
    <path d="M13 12 C17 4, 24 3, 23 9 C22 14, 17 15, 13 14 Z" fill="#1f2329" />
    <rect x="11.4" y="12" width="3.2" height="9" rx="1.6" fill="#1f2329" />
    <circle cx="13" cy="11.5" r="2.6" fill="#fff" stroke="#1f2329" strokeWidth={1.2} />
  </svg>
)

/** The hovered 取数逻辑 anchor, in viewport coordinates. */
interface LogicTipAnchor {
  readonly tableId: number
  readonly left: number
  readonly top: number
  readonly bottom: number
}

function lineKey(index: number, line: AuditLine): string {
  return `${index}:${line.kind}${'callId' in line ? `:${line.callId}` : ''}`
}

/** Render one 取数逻辑 bullet, emboldening the prototype's lead-in label. */
function logicBullet(text: string): ReactNode {
  const split = text.indexOf('：')
  if (split <= 0) return text
  return (<><b>{text.slice(0, split)}</b>{text.slice(split)}</>)
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
  const [tip, setTip] = useState<LogicTipAnchor | null>(null)
  const [tipBox, setTipBox] = useState<{ left: number; top: number; width: number } | null>(null)
  const toastTimer = useRef<number | null>(null)
  const scrollEnd = useRef<HTMLDivElement>(null)
  const tipRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    scrollEnd.current?.scrollIntoView({ block: 'end' })
  }, [state.lines, state.streaming])

  useEffect(() => () => {
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current)
  }, [])

  // The 取数逻辑 tooltip is `position: fixed` so the scrolling table list cannot
  // clip it; its box is measured once it is in the DOM, then clamped on-screen.
  useLayoutEffect(() => {
    if (tip === null) {
      setTipBox(null)
      return
    }
    const element = tipRef.current
    if (element === null) return
    const width = Math.min(540, window.innerWidth - 24)
    const height = element.offsetHeight
    let left = Math.min(tip.left, window.innerWidth - width - 12)
    left = Math.max(12, left)
    let top = tip.bottom + 6
    if (top + height > window.innerHeight - 12) top = Math.max(12, tip.top - height - 6)
    setTipBox({ left, top, width })
  }, [tip])

  const showToast = (message: string): void => {
    setToast(message)
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => { setToast(null) }, 2200)
  }

  // Escape closes whichever modal is open, mirroring the prototype's handler.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      props.actions.closeFieldModal()
      props.actions.closeScope()
      props.actions.closePjInfo()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => { window.removeEventListener('keydown', onKeyDown) }
  }, [props.actions])

  const markdownLabels: MarkdownLabels = useMemo(() => ({
    code: { copyLabel: t('copy'), copiedLabel: t('copied') },
    footnotes: t('footnotes'),
  }), [t])

  const tables = useMemo(
    () => WIDE_TABLES.filter(table => !state.tableQuery || table.name.includes(state.tableQuery)),
    [state.tableQuery],
  )

  const activeTable: WideTable | null = state.fieldTableId === null
    ? null
    : WIDE_TABLES.find(table => table.id === state.fieldTableId) ?? null
  const scopedTable: WideTable | null = state.scopeTableId === null
    ? null
    : WIDE_TABLES.find(table => table.id === state.scopeTableId) ?? null

  const fields = useMemo(() => {
    if (activeTable === null) return []
    const query = state.fieldQuery.trim().toLowerCase()
    if (query.length === 0) return activeTable.fields
    return activeTable.fields.filter(field =>
      field.en.toLowerCase().includes(query) || field.cn.toLowerCase().includes(query))
  }, [activeTable, state.fieldQuery])

  const selection = state.fieldSelection
  const selectedCount = (table: WideTable): number => (selection[table.id] ?? []).length

  const onSend = (): void => {
    if (state.draft.trim().length === 0) {
      showToast(t('emptyMessage'))
      return
    }
    // 发送会话消息后，基础信息版块自动折叠（原型行为）.
    props.actions.foldCard()
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
              <div key={lineKey(index, line)} className={`${css.msg} ${css.msgUser}`}>
                <span className={`${css.avatar} ${css.avatarUser}`}>我</span>
                <div className={`${css.bubble} ${css.userBubble}`}>{line.text}</div>
              </div>
            )
          case 'assistant':
            return (
              <div key={lineKey(index, line)} className={css.msg}>
                <span className={`${css.avatar} ${css.avatarAi}`}>{AVATAR_AI}</span>
                <div className={css.bubble}>
                  <MarkdownText text={line.text} labels={markdownLabels} />
                </div>
              </div>
            )
          case 'tool':
            return (
              <div key={lineKey(index, line)} className={css.toolRow}>
                <span className={css.toolDot} data-state={line.state} />
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
        <div key={`stream:${entry.attemptId}`} className={css.msg}>
          <span className={`${css.avatar} ${css.avatarAi}`}>{AVATAR_AI}</span>
          <div className={css.bubble}>
            <MarkdownText text={entry.text} streaming labels={markdownLabels} />
          </div>
        </div>
      ))}
      {state.running && state.streaming.length === 0 && (
        <div className={css.msg}>
          <span className={`${css.avatar} ${css.avatarAi}`}>{AVATAR_AI}</span>
          <div className={css.bubble}>{t('running')}</div>
        </div>
      )}
      <div ref={scrollEnd} />
    </>
  )

  return (
    <div className={css.page}>
      <div className={css.topbar}>
        <div className={css.back} title={t('back')} onClick={() => { props.actions.clearProject() }}>←</div>
        <div className={css.crumb}>
          <span>{t('panel')}</span>
          {state.project !== null && (<><span className={css.crumbSep}> / </span><b>{state.project}</b></>)}
        </div>
        <div className={css.spacer} />
        <button type="button" className={css.btnPrimary} onClick={() => { showToast(t('saved')) }}>{t('saveConfig')}</button>
      </div>

      {/* ── 未选择项目时的空状态 ── */}
      {state.project === null && (
        <div className={css.emptyState}>
          <div className={css.esIcon}>{ICON_FOLDER}</div>
          <div className={css.esTitle}>{t('emptyTitle')}</div>
          <div className={css.esDesc}>{t('emptyDesc')}</div>
          <div className={css.esChips}>
            {AUDIT_PROJECTS.map(project => (
              <span
                key={project.name}
                className={css.esChip}
                onClick={() => {
                  props.actions.selectProject(project.name)
                  showToast(t('enterProject', { name: project.name }))
                }}
              >{project.name}</span>
            ))}
          </div>
        </div>
      )}

      {/* ── 主内容区：项目基础信息（含宽表）+ 会话窗口同屏 ── */}
      {state.project !== null && (
        <div className={css.content}>
          <div className={`${css.upper} ${state.folded ? css.upperFolded : ''}`}>
            <div className={css.wrap}>
              <div className={`${css.card} ${state.folded ? css.cardFolded : ''}`}>
                <div className={css.cardHead}>
                  <span className={css.bar} />
                  <h2 className={css.cardTitle}>{t('projectInfo')}</h2>
                  <span className={css.infoIconBtn} title={t('pjInfoTitle')} onClick={() => { props.actions.openPjInfo() }}>
                    {ICON_PJ_DETAIL}
                    {t('projectDetail')}
                    {ICON_RIGHT}
                  </span>
                  <div className={css.headTools}>
                    <span className={css.wtTitle}>{t('selectTables')}</span>
                    <span className={css.wtCnt}>{t('totalTables', { count: tables.length })}</span>
                    <div className={css.wtSearch}>
                      {ICON_SEARCH}
                      <input
                        type="text"
                        placeholder={t('searchTables')}
                        value={state.tableQuery}
                        onChange={(event) => { props.actions.setTableQuery(event.target.value) }}
                      />
                    </div>
                  </div>
                  <span className={css.foldBtn} title={t('foldedTip')} onClick={() => { props.actions.toggleFold() }}>
                    <span className={css.chev2}>{ICON_FOLD}</span>
                  </span>
                </div>

                <div className={css.cardBody}>
                  <div className={css.wtList}>
                    {tables.map((table) => {
                      const checked = state.selectedTables.includes(table.id)
                      const logicAnchor = (element: HTMLElement): LogicTipAnchor => {
                        const rect = element.getBoundingClientRect()
                        return { tableId: table.id, left: rect.left, top: rect.top, bottom: rect.bottom }
                      }
                      return (
                        <div key={table.id} className={css.wtItem} data-auth={table.auth} data-on={checked}>
                          <div className={`${css.wtHead} ${table.auth ? '' : css.wtHeadUnauth}`}>
                            <div className={css.wtCheck}>
                              <input
                                type="checkbox"
                                checked={checked}
                                disabled={!table.auth}
                                onChange={() => {
                                  props.actions.toggleTable(table.id)
                                  showToast(checked
                                    ? t('tableUnselected')
                                    : t('tableSelected', { name: table.name }))
                                }}
                              />
                            </div>
                            <div className={css.wtMain}>
                              <div className={css.wtNameLine}>
                                <span className={`${css.wtName} ${table.auth ? '' : css.mutedName}`}>{table.name}</span>
                                <span className={`${css.wtTag} ${table.auth ? css.wtTagOk : css.wtTagNo}`}>
                                  {table.auth ? t('authorized') : t('unauthorized')}
                                </span>
                              </div>
                              <div className={css.wtMetaRow1}>
                                <span className={css.mi}>
                                  <span className={css.k}>{t('dataSource')}</span>
                                  <span className={`${css.v} ${table.auth ? '' : css.muted}`}>
                                    <span className={css.sourceChip}>{t('sourceReport')}</span>
                                  </span>
                                </span>
                                <span className={css.mi}>
                                  <span className={css.k}>{t('catalog')}</span>
                                  <span className={`${css.v} ${table.auth ? '' : css.muted}`}>{t('catalogName')}</span>
                                </span>
                                <span className={css.mi}>
                                  <span className={css.k}>{t('dataScope')}</span>
                                  <span className={css.v}>
                                    <span
                                      className={css.miniChip}
                                      title={t('scopeNotice')}
                                      onClick={() => { props.actions.openScope(table.id) }}
                                    >
                                      {ICON_SCOPE}{t('companiesInfo')} <span className={css.cnt}>{table.companies}</span>
                                    </span>
                                  </span>
                                </span>
                              </div>
                              <div className={css.wtMetaRow2}>
                                <span className={css.k}>{t('logic')}</span>
                                <span className={css.v}>
                                  <span
                                    className={css.logicMini}
                                    onMouseEnter={(event) => { setTip(logicAnchor(event.currentTarget)) }}
                                    onMouseLeave={() => { setTip(null) }}
                                  >
                                    <span className={`${css.lt} ${table.auth ? '' : css.muted}`}>{table.short}</span>
                                  </span>
                                </span>
                              </div>
                            </div>
                            <div className={css.wtActions}>
                              {table.auth ? (
                                <span
                                  className={css.miniChip}
                                  title={t('fieldSelect')}
                                  onClick={() => { props.actions.openFieldModal(table.id) }}
                                >
                                  <span className={css.req}>*</span>{ICON_FIELD}{t('fieldSelect')}{' '}
                                  <span className={css.cnt}>{selectedCount(table)}</span>/<span>{table.fields.length}</span>
                                </span>
                              ) : (
                                <span
                                  className={css.miniChip}
                                  title={t('unauthNotice')}
                                  onClick={() => { props.actions.openFieldModal(table.id) }}
                                >
                                  <span className={`${css.req} ${css.reqMuted}`}>*</span>{ICON_FIELD}{t('fieldSelect')}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      )
                    })}
                    {tables.length === 0 && <div className={css.wtEmpty}>{t('noTable')}</div>}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* ── 下：聊天窗口 ── */}
          <div className={css.chatZone}>
            <div className={css.chatInner}>
              <div className={css.chatMsgs}>{transcript}</div>
              <div className={css.chatCard}>
                <textarea
                  className={css.chatTextarea}
                  placeholder={t('chatPlaceholder')}
                  value={state.draft}
                  onChange={(event) => { props.actions.setDraft(event.target.value) }}
                  onKeyDown={onComposeKeyDown}
                  rows={1}
                />
                <div className={css.chatToolbar}>
                  <div className={css.toolLeft}>
                    <span className={css.iconBtn} title={t('addContext')}>＋</span>
                    <span className={css.ctxPill}>
                      {ICON_SHIELD}
                      {t('workspaceModify')} <span className={css.caret}>▾</span>
                    </span>
                  </div>
                  <div className={css.toolRight}>
                    <span className={css.modelPill}>
                      <b>{t('model')}</b> <span className={css.high}>{t('effort')}</span> <span className={css.caret}>▾</span>
                    </span>
                    <span className={css.loadBtn} title={t('loadingTasks')}>{ICON_RELOAD}</span>
                    <span
                      className={`${css.sendBtn} ${(state.sending || state.running || state.draft.trim().length === 0) ? css.sendBtnOff : ''}`}
                      title={t('send')}
                      onClick={onSend}
                    >{state.sending ? '…' : ICON_SEND}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── 取数逻辑浮层（fixed 定位，避免被列表滚动区裁剪）── */}
      {tip !== null && (() => {
        const table = WIDE_TABLES.find(candidate => candidate.id === tip.tableId)
        if (table === undefined) return null
        return (
          <div
            ref={tipRef}
            className={css.logicTip}
            style={{
              left: tipBox?.left ?? tip.left,
              top: tipBox?.top ?? tip.bottom + 6,
              width: tipBox?.width ?? 540,
              visibility: tipBox === null ? 'hidden' : 'visible',
            }}
          >
            <div className={css.tipTitle}>{table.auth ? t('logicFull') : t('logicFullView')}</div>
            <ul>{table.logic.map(bullet => <li key={bullet}>{logicBullet(bullet)}</li>)}</ul>
          </div>
        )
      })()}

      {/* ── 项目详情弹窗（纯展示）── */}
      {state.pjInfoOpen && (
        <div className={css.mask} onClick={(event) => { if (event.target === event.currentTarget) props.actions.closePjInfo() }}>
          <div className={css.modal}>
            <div className={css.modalHead}>
              <h3>{t('pjInfoTitle')}</h3>
              <span className={css.modalSub}>{t('readonly')}</span>
              <span className={css.modalX} onClick={() => { props.actions.closePjInfo() }}>✕</span>
            </div>
            <div className={css.modalBody}>
              <div className={css.pjGrid}>
                {PROJECT_DETAIL.map(field => (
                  <div key={field.label} className={css.pjField}>
                    <div className={css.plabel}>
                      {field.required && <span className={css.req}>*</span>}{field.label}
                    </div>
                    <div className={css.pvalue}>
                      {field.tags !== undefined
                        ? (
                          <span className={css.coInline}>
                            {field.tags.map(tag => (
                              <span key={tag.name} className={css.coTagSm}>
                                {tag.name}
                                {tag.code.length > 0 && <span className={css.code}>({tag.code})</span>}
                              </span>
                            ))}
                          </span>
                        )
                        : field.range === true
                          ? <span className={css.rangeLine}>{rangeParts(field.value)}</span>
                          : field.value.length > 0 ? field.value : <span className={css.muted}>—</span>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className={css.modalFoot}>
              <button type="button" className={css.btnPrimary} onClick={() => { props.actions.closePjInfo() }}>{t('gotIt')}</button>
            </div>
          </div>
        </div>
      )}

      {/* ── 数据范围弹窗（只读）── */}
      {scopedTable !== null && (
        <div className={css.mask} onClick={(event) => { if (event.target === event.currentTarget) props.actions.closeScope() }}>
          <div className={css.modal}>
            <div className={css.modalHead}>
              <h3>
                {t('scopeTitle')}（{scopedTable.name}{scopedTable.auth ? '' : t('unauthOnlyViewSuffix')}）
              </h3>
              <span className={css.modalSub}>
                {t('scopeCount', { count: COMPANY_POOL.slice(0, scopedTable.companies).length })}
              </span>
              <span className={css.modalX} onClick={() => { props.actions.closeScope() }}>✕</span>
            </div>
            <div className={css.modalBody}>
              <div className={`${css.coInline} ${css.coCloud}`}>
                {COMPANY_POOL.slice(0, scopedTable.companies).map(company => (
                  <span key={company.code} className={`${css.coTagSm} ${css.coTagBig}`}>
                    {company.name} <span className={css.code}>({company.code})</span>
                  </span>
                ))}
              </div>
              <div className={`${css.fsNotice} ${css.fsNoticeShow}`}>
                {ICON_INFO}
                {t('scopeNotice')}
              </div>
            </div>
            <div className={css.modalFoot}>
              <button type="button" className={css.btnPrimary} onClick={() => { props.actions.closeScope() }}>{t('gotIt')}</button>
            </div>
          </div>
        </div>
      )}

      {/* ── 字段选择弹窗 ── */}
      {activeTable !== null && (
        <div className={css.mask} onClick={(event) => { if (event.target === event.currentTarget) props.actions.closeFieldModal() }}>
          <div className={`${css.modal} ${css.modalNarrow}`}>
            <div className={css.modalHead}>
              <h3>
                {activeTable.auth && <span className={css.req}>*</span>}{t('fieldTitle')}
              </h3>
              <span className={css.modalSub}>
                {activeTable.name}{activeTable.auth ? '' : `（${t('unauthOnlyView')}）`}
              </span>
              <span className={css.modalX} onClick={() => { props.actions.closeFieldModal() }}>✕</span>
            </div>
            <div className={css.modalBody}>
              <div className={css.fsToolbar}>
                {activeTable.auth && (
                  <label className={css.fsSelectAll}>
                    <input
                      type="checkbox"
                      checked={state.fieldDraft.length === activeTable.fields.length}
                      ref={(element) => {
                        if (element === null) return
                        element.indeterminate = state.fieldDraft.length > 0
                          && state.fieldDraft.length < activeTable.fields.length
                      }}
                      onChange={(event) => { props.actions.setAllFields(event.target.checked) }}
                    />{' '}{t('selectAll')}
                  </label>
                )}
                <div className={css.fsSearch}>
                  {ICON_SEARCH}
                  <input
                    type="text"
                    placeholder={t('fieldSearch')}
                    value={state.fieldQuery}
                    onChange={(event) => { props.actions.setFieldQuery(event.target.value) }}
                  />
                </div>
              </div>
              <div className={css.fsList}>
                {fields.map(field => (
                  <label key={field.no} className={`${css.fsRow} ${activeTable.auth ? '' : css.fsRowUnauth}`}>
                    <input
                      type="checkbox"
                      checked={activeTable.auth && state.fieldDraft.includes(field.no)}
                      disabled={!activeTable.auth}
                      onChange={() => { props.actions.toggleField(field.no) }}
                    />
                    <span className={css.fno}>{field.no}</span>
                    <span className={css.fen}>{field.en}</span>
                    <span className={css.fcn}>{field.cn}</span>
                    <span className={css.ftype}>{field.type}</span>
                  </label>
                ))}
                {fields.length === 0 && <div className={css.fsEmpty}>{t('noField')}</div>}
              </div>
              <div
                className={`${css.fsNotice} ${(state.fieldError || !activeTable.auth) ? css.fsNoticeShow : ''} ${state.fieldError ? css.fsNoticeDanger : ''}`}
              >
                {ICON_INFO}
                {state.fieldError ? t('fieldRequired') : t('unauthNotice')}
              </div>
            </div>
            <div className={css.modalFoot}>
              {activeTable.auth && (
                <span className={css.selInfo}>
                  {t('selectedFields', { count: state.fieldDraft.length, total: activeTable.fields.length })}
                </span>
              )}
              <button type="button" className={css.btn} onClick={() => { props.actions.closeFieldModal() }}>
                {activeTable.auth ? t('cancel') : t('close')}
              </button>
              <button
                type="button"
                className={css.btnPrimary}
                onClick={() => {
                  if (!activeTable.auth) {
                    props.actions.closeFieldModal()
                    return
                  }
                  // A filled draft commits and closes; an empty one keeps the
                  // modal open on its "pick at least one" error.
                  const filled = state.fieldDraft.length > 0
                  props.actions.confirmFields()
                  if (filled) showToast(t('fieldsSaved'))
                }}
              >{activeTable.auth ? t('confirmSelect') : t('close')}</button>
            </div>
          </div>
        </div>
      )}

      {toast !== null && <div className={css.toast}>{ICON_INFO}{toast}</div>}
    </div>
  )
}

/** Split the prototype's `start ~ end` value into its two halves. */
function rangeParts(value: string): ReactNode {
  const parts = value.split(' ~ ')
  if (parts.length !== 2) return value
  return (<>{parts[0]}<span className={css.tilde}>~</span>{parts[1]}</>)
}
