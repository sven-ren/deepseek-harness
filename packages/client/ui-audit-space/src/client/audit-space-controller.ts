/**
 * Audit-space controller (apply world). Owns one agent Session and folds its
 * event window into the store's transcript snapshot.
 *
 * Lifecycle: the first `send()` creates a session on the Host
 * (`ctx.sessions.create`), retains it under this plugin's source label, and
 * awaits the shared initial open (`reference.ready`). Every later send prompts
 * the same binding. `newSession()` releases the reference and resets the
 * transcript so the next send opens a fresh session.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {
  SessionBinding,
  SessionEventLikeEntry,
  SessionReference,
} from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { BakedActions } from '@deepseek-ai/dsh-client-store'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { AuditLine, StreamingText } from './audit-space-store.ts'
import type { AuditSpaceActions, AuditSpaceState } from './audit-space-store.ts'

/** Typed translator for the audit-space namespace (resolves through the LocaleNamespaceMap merge). */
type Translate = PropsLocale<'auditSpace'>['t']

/** One prompt send's completion; business failures reject here and land in the transcript. */
type SendResult = 'accepted' | 'failed'

declare module '@deepseek-ai/dsh-api-session-controller/client' {
  interface SessionReferenceSourceMap {
    /** The audit-space panel's chat session. */
    uiAuditSpace: unknown
  }
}

/** Fold a message's content blocks into plain text (text blocks only). */
function blocksToText(content: readonly ContentBlock[]): string {
  return content
    .map(block => (block.type === 'text' ? block.text : ''))
    .filter(text => text.length > 0)
    .join('\n')
}

interface StreamingEntry {
  readonly attemptId: string
  readonly turn: number
  readonly step: number
  text: string
}

/** Mutable fold state kept beside the store so a re-fold stays idempotent. */
interface FoldState {
  lines: AuditLine[]
  streaming: Map<string, StreamingEntry>
  running: boolean
  lastDurableSeq: number
  lastTransientSeq: number
}

function freshFoldState(): FoldState {
  return { lines: [], streaming: new Map(), running: false, lastDurableSeq: -1, lastTransientSeq: -1 }
}

/**
 * Methods the audit-space page can call; registered as the slot's inject face.
 * Only the operations that need the apply closure (the owned Session) live
 * here — every pure state mutation goes through `props.actions.*` instead.
 */
export interface AuditSpaceFace {
  /** Prompt the owned session with `text` and await acceptance. */
  send(text: string): Promise<SendResult>
  /** Release the owned session and start a fresh chat. */
  newSession(): void
}

/**
 * Drives the audit chat Session and mirrors its transcript into the store.
 * @param ctx - the browser plugin context (for `ctx.sessions`).
 * @param actions - the store's bound actions.
 * @param getSnapshot - reads the current store snapshot (for send gating).
 * @param t - the bound translator for the audit-space namespace.
 */
export class AuditSpaceController {
  private reference: SessionReference | null = null
  private binding: SessionBinding | null = null
  private fold: FoldState = freshFoldState()

  constructor(
    private readonly ctx: ClientContext,
    private readonly actions: BakedActions<AuditSpaceState, AuditSpaceActions>,
    private readonly getSnapshot: () => AuditSpaceState,
    private readonly t: Translate,
  ) {}

  /**
   * The stable face handed to the panel component.
   * @returns the face with `send` and `newSession` bound to this controller.
   */
  inject(): AuditSpaceFace {
    return {
      send: text => this.send(text),
      newSession: () =>{  this.newSession() },
    }
  }

  /** Release the session reference and tear down event folding. */
  dispose(): void {
    this.reference?.release()
    this.reference = null
    this.binding = null
  }

  /**
   * Prompt the owned session with `text`, opening it on first use.
   * Rejects outright while another send or turn is in flight; a prompt failure
   * lands as a system notice in the transcript instead of throwing.
   * @param text - the user's message; trimmed, and empty text is refused.
   * @returns `accepted` once the prompt was queued, `failed` otherwise.
   */
  async send(text: string): Promise<SendResult> {
    const trimmed = text.trim()
    if (trimmed.length === 0) return 'failed'
    const snapshot = this.getSnapshot()
    if (snapshot.sending || snapshot.running) return 'failed'
    this.actions.setSending(true)
    try {
      const binding = await this.ensureSession()
      this.actions.setDraft('')
      await binding.session.prompt([{ type: 'text', text: trimmed }], 'queue')
      return 'accepted'
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.notice(this.t('promptError', { message }))
      return 'failed'
    } finally {
      this.actions.setSending(false)
    }
  }

  /** Append a system notice to the transcript (the user's own prompt echoes back as a `user/message` event). */
  private notice(text: string): void {
    this.fold.lines.push({ kind: 'system', text })
    this.commit()
  }

  /**
   * Release the owned session and clear the transcript, so the next `send()`
   * opens a fresh session.
   */
  newSession(): void {
    this.reference?.release()
    this.reference = null
    this.binding = null
    this.fold = freshFoldState()
    this.actions.resetTranscript()
  }

  /** Create (once) and open the owned session. */
  private async ensureSession(): Promise<SessionBinding> {
    if (this.binding) return this.binding
    const sessionId: SessionId = await this.ctx.sessions.create({})
    this.actions.setSession(sessionId)
    const reference = this.ctx.sessions.retain(sessionId, { source: 'uiAuditSpace' })
    this.reference = reference
    const binding = await reference.ready
    this.binding = binding
    binding.eventSource.subscribe(() =>{  this.onEvents(binding) })
    // The window may already hold history (a re-opened panel): fold the current
    // revision once rather than waiting for the next mutation.
    this.onEvents(binding)
    this.actions.setSessionReady(true)
    this.notice(this.t('sessionReady'))
    return binding
  }

  /** Fold the latest event-window revision into the transcript snapshot. */
  private onEvents(binding: SessionBinding): void {
    const window = binding.eventSource.getSnapshot()
    let changed = false
    for (const entry of window.entries) {
      if (entry.type === 'event') {
        changed = this.foldDurable(entry) || changed
      } else {
        changed = this.foldTransient(entry) || changed
      }
    }
    if (changed) this.commit()
  }

  /** Fold one durable session event; returns whether the fold advanced. */
  private foldDurable(entry: Extract<SessionEventLikeEntry, { readonly type: 'event' }>): boolean {
    const event = entry.event
    const seq = Number(event.seq)
    if (seq <= this.fold.lastDurableSeq) return false
    this.fold.lastDurableSeq = seq
    switch (event.type) {
      case 'user/message': {
        // Injected context (agent instructions, runtime context, skills) also
        // arrives as `user/message`; only a human-authored row is a chat turn.
        // The cursor still advanced, but nothing re-renders.
        if (event.data.source.kind !== 'user') return false
        this.fold.lines.push({ kind: 'user', text: blocksToText(event.data.content) })
        return true
      }
      case 'assistant/message': {
        const { turn, step, message } = event.data
        const text = blocksToText(message.content)
        // A tool-call-only step carries no prose; the `tool/call` rows below
        // stand in for it, and an empty bubble would be pure chrome.
        if (text.length > 0) this.fold.lines.push({ kind: 'assistant', text })
        for (const [attemptId, entry] of this.fold.streaming) {
          if (entry.turn === turn && entry.step === step) this.fold.streaming.delete(attemptId)
        }
        return true
      }
      case 'tool/call': {
        this.fold.lines.push({ kind: 'tool', callId: event.data.callId, name: event.data.name, state: 'running' })
        return true
      }
      case 'tool/result': {
        // The call id lives on the tool-role message, not the event data.
        const { message } = event.data
        const callId = message.toolCallId
        const index = this.fold.lines.findIndex(
          candidate => candidate.kind === 'tool' && candidate.callId === callId)
        if (index >= 0) {
          const current = this.fold.lines[index] as Extract<AuditLine, { kind: 'tool' }>
          this.fold.lines[index] = { ...current, state: message.isError ? 'error' : 'done' }
          return true
        }
        return false
      }
      case 'turn/start': {
        this.fold.running = true
        this.fold.lines.push({ kind: 'turn', turn: event.data.turn })
        return true
      }
      case 'turn/end': {
        this.fold.running = false
        return true
      }
      default:
        // Other durable events (request/header, system/message, …) do not shape
        // the audit transcript; the cursor still advanced, but nothing re-renders.
        return false
    }
  }

  /** Fold one client-only live chunk into the streaming buffer. */
  private foldTransient(entry: Extract<SessionEventLikeEntry, { readonly type: 'transient' }>): boolean {
    const transient = entry.event
    if (transient.seq <= this.fold.lastTransientSeq) return false
    this.fold.lastTransientSeq = transient.seq
    if (transient.data.chunk.type !== 'text-delta') return false
    const { attemptId, turn, step, chunk } = transient.data
    const current = this.fold.streaming.get(attemptId) ?? { attemptId, turn, step, text: '' }
    current.text += chunk.text
    this.fold.streaming.set(attemptId, current)
    return true
  }

  /** Write the folded transcript back to the store. */
  private commit(): void {
    const streaming: readonly StreamingText[] = [...this.fold.streaming.values()]
      .filter(entry => entry.text.length > 0)
      .map(({ attemptId, turn, step, text }) => ({ attemptId, turn, step, text }))
    // Hand the store a copy: immer freezes committed state in dev, and the
    // controller keeps mutating its own working array between commits.
    this.actions.setTranscript([...this.fold.lines], streaming, this.fold.running)
  }
}
