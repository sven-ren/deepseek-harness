/**
 * Audit-space panel state. Pure presentation state — the store never touches
 * the session service. The controller (apply world) folds session events into
 * `lines`/`streaming` snapshots and commits them through `setTranscript`;
 * every other field is direct user input.
 */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

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
  projectQuery: string
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
  setProjectQuery(draft: AuditSpaceState, query: string): void
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

/**
 * The panel store factory, consumed by the main-slot registration.
 * @returns the store handle whose single instance the panel reads and writes.
 */
export function createAuditSpaceStore(): EngineStoreHandle<AuditSpaceState, AuditSpaceActions> {
  return defineStore({
    init: (): AuditSpaceState => ({
      project: null,
      selectedTables: [],
      tableQuery: '',
      projectQuery: '',
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
      setProjectQuery: (draft, query) => {
        draft.projectQuery = query
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
