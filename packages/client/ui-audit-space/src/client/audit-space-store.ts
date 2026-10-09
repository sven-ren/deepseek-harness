/**
 * Audit-space panel state. Pure presentation state — the store never touches
 * the session service. The controller (apply world) folds session events into
 * `lines`/`streaming` snapshots and commits them through `setTranscript`;
 * every other field is direct user input.
 */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { WIDE_TABLES } from './mock-data.ts'

/** One chat row in the audit transcript. */
export type AuditLine =
  | { kind: 'user'; text: string }
  | { kind: 'assistant'; text: string }
  | { kind: 'tool'; callId: string; name: string; state: 'running' | 'done' | 'error' }
  | { kind: 'turn'; turn: number }
  | { kind: 'system'; text: string }

/** Live assistant text of one in-flight attempt (not yet settled into a durable message). */
export type StreamingText = {
  attemptId: string
  turn: number
  step: number
  text: string
}

/** Snapshot of the whole audit-space panel. */
export type AuditSpaceState = {
  /** Selected audit project name, or null before one is picked. */
  project: string | null
  /** Ids of the wide tables toggled on in the picker. */
  selectedTables: readonly number[]
  tableQuery: string
  /** Whether the 项目基础信息 card is folded down to its header. */
  folded: boolean
  /** Committed field selection per wide-table id (field numbers). */
  fieldSelection: Readonly<Record<number, readonly number[]>>
  /** Wide table whose 字段选择 modal is open, or null when closed. */
  fieldTableId: number | null
  /** Draft field numbers being edited inside the open modal. */
  fieldDraft: readonly number[]
  fieldQuery: string
  /** Whether the open field modal is showing its "pick at least one" error. */
  fieldError: boolean
  /** Wide table whose 数据范围 modal is open, or null when closed. */
  scopeTableId: number | null
  /** Whether the 项目详情 modal is open. */
  pjInfoOpen: boolean
  /** Settled chat lines, in display order. */
  lines: readonly AuditLine[]
  /** In-flight assistant text streaming live at the end of the transcript. */
  streaming: readonly StreamingText[]
  /** Whether an agent turn is currently running. */
  running: boolean
  /** Whether a prompt submit is in flight. */
  sending: boolean
  draft: string
  sessionId: SessionId | null
  /** Whether the owned session binding has opened and can accept prompts. */
  sessionReady: boolean
}

/** Draft mutators the panel writes through; each receives the store draft first. */
export type AuditSpaceActions = {
  selectProject(draft: AuditSpaceState, project: string): void
  clearProject(draft: AuditSpaceState): void
  toggleTable(draft: AuditSpaceState, id: number): void
  setTableQuery(draft: AuditSpaceState, query: string): void
  /** Fold or unfold the 项目基础信息 card. */
  toggleFold(draft: AuditSpaceState): void
  /** Fold the card without toggling (used when a chat message is sent). */
  foldCard(draft: AuditSpaceState): void
  /** Open the 字段选择 modal for `tableId`, seeding the draft from the committed selection. */
  openFieldModal(draft: AuditSpaceState, tableId: number): void
  closeFieldModal(draft: AuditSpaceState): void
  setFieldQuery(draft: AuditSpaceState, query: string): void
  /** Toggle one field number in the open modal's draft. */
  toggleField(draft: AuditSpaceState, no: number): void
  /** Set every field of the open modal's table on or off. */
  setAllFields(draft: AuditSpaceState, on: boolean): void
  /** Commit the draft into `fieldSelection` and close the modal. */
  confirmFields(draft: AuditSpaceState): void
  openScope(draft: AuditSpaceState, tableId: number): void
  closeScope(draft: AuditSpaceState): void
  openPjInfo(draft: AuditSpaceState): void
  closePjInfo(draft: AuditSpaceState): void
  setDraft(draft: AuditSpaceState, text: string): void
  setSending(draft: AuditSpaceState, sending: boolean): void
  setSession(draft: AuditSpaceState, sessionId: SessionId): void
  setSessionReady(draft: AuditSpaceState, ready: boolean): void
  /** Drop the transcript and un-ready the session (a fresh audit chat). */
  resetTranscript(draft: AuditSpaceState): void
  /** Replace the transcript with a controller-folded snapshot. */
  setTranscript(
    draft: AuditSpaceState,
    lines: readonly AuditLine[],
    streaming: readonly StreamingText[],
    running: boolean,
  ): void
}

/** Seed the committed selection from the prototype's per-field defaults. */
function seedFieldSelection(): Record<number, readonly number[]> {
  const seeded: Record<number, readonly number[]> = {}
  for (const table of WIDE_TABLES) {
    seeded[table.id] = table.fields.filter(field => field.checked).map(field => field.no)
  }
  return seeded
}

/** Seed the wide-table checkboxes from the prototype's authorization flags. */
function seedSelectedTables(): readonly number[] {
  return WIDE_TABLES.filter(table => table.auth).map(table => table.id)
}

/**
 * The panel store factory, consumed by the main-slot registration.
 * @returns the store handle whose single instance the panel reads and writes.
 */
export function createAuditSpaceStore(): EngineStoreHandle<AuditSpaceState, AuditSpaceActions> {
  return defineStore({
    init: (): AuditSpaceState => ({
      project: null,
      selectedTables: seedSelectedTables(),
      tableQuery: '',
      folded: false,
      fieldSelection: seedFieldSelection(),
      fieldTableId: null,
      fieldDraft: [],
      fieldQuery: '',
      fieldError: false,
      scopeTableId: null,
      pjInfoOpen: false,
      lines: [],
      streaming: [],
      running: false,
      sending: false,
      draft: '',
      sessionId: null,
      sessionReady: false,
    }),
    actions: {
      selectProject: (draft, project) => {
        draft.project = project
        draft.folded = false
      },
      clearProject: (draft) => {
        draft.project = null
      },
      toggleTable: (draft, id) => {
        draft.selectedTables = draft.selectedTables.includes(id)
          ? draft.selectedTables.filter(entry => entry !== id)
          : [...draft.selectedTables, id]
      },
      setTableQuery: (draft, query) => {
        draft.tableQuery = query
      },
      toggleFold: (draft) => {
        draft.folded = !draft.folded
      },
      foldCard: (draft) => {
        draft.folded = true
      },
      openFieldModal: (draft, tableId) => {
        draft.fieldTableId = tableId
        draft.fieldDraft = draft.fieldSelection[tableId] ?? []
        draft.fieldQuery = ''
        draft.fieldError = false
      },
      closeFieldModal: (draft) => {
        draft.fieldTableId = null
        draft.fieldDraft = []
        draft.fieldQuery = ''
        draft.fieldError = false
      },
      setFieldQuery: (draft, query) => {
        draft.fieldQuery = query
      },
      toggleField: (draft, no) => {
        draft.fieldDraft = draft.fieldDraft.includes(no)
          ? draft.fieldDraft.filter(entry => entry !== no)
          : [...draft.fieldDraft, no]
        draft.fieldError = false
      },
      setAllFields: (draft, on) => {
        const tableId = draft.fieldTableId
        if (tableId === null) return
        const table = WIDE_TABLES.find(candidate => candidate.id === tableId)
        if (table === undefined) return
        draft.fieldDraft = on ? table.fields.map(field => field.no) : []
        draft.fieldError = false
      },
      confirmFields: (draft) => {
        const tableId = draft.fieldTableId
        if (tableId === null) return
        // 字段选择是必填项：an empty draft keeps the modal open on its error.
        if (draft.fieldDraft.length === 0) {
          draft.fieldError = true
          return
        }
        draft.fieldSelection = { ...draft.fieldSelection, [tableId]: [...draft.fieldDraft] }
        draft.fieldTableId = null
        draft.fieldDraft = []
        draft.fieldQuery = ''
        draft.fieldError = false
      },
      openScope: (draft, tableId) => {
        draft.scopeTableId = tableId
      },
      closeScope: (draft) => {
        draft.scopeTableId = null
      },
      openPjInfo: (draft) => {
        draft.pjInfoOpen = true
      },
      closePjInfo: (draft) => {
        draft.pjInfoOpen = false
      },
      setDraft: (draft, text) => {
        draft.draft = text
      },
      setSending: (draft, sending) => {
        draft.sending = sending
      },
      setSession: (draft, sessionId) => {
        draft.sessionId = sessionId
      },
      setSessionReady: (draft, ready) => {
        draft.sessionReady = ready
      },
      resetTranscript: (draft) => {
        draft.lines = []
        draft.streaming = []
        draft.running = false
        draft.sessionReady = false
      },
      setTranscript: (draft, lines, streaming, running) => {
        draft.lines = lines
        draft.streaming = streaming
        draft.running = running
      },
    },
  })
}
