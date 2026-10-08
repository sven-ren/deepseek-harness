---
description: "Audit-space panel for the dsh web client: a project picker, a wide-table picker, and a chat zone that drives a real agent Session."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-audit-space

English | [中文](README.zh.md)

## Summary

The Audit Space panel is a custom UI surface in the dsh web client, modeled on the audit-workbench prototype. It registers a main-column panel plus its sidebar entry, renders a project picker and a wide-table picker from mock data, and reuses the harness's real chat capability: the chat zone creates an agent Session through the standard `ctx.sessions` service and streams its events into the transcript.

This minimal verification slice of the "custom panel + custom layout + reuse chat" direction keeps the mock data in the client package and wires only the chat to real machinery.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

Open the **Audit Space** entry in the sidebar. The page shows:

1. **Project picker** — the prototype's seven audit projects as colored chips, filterable by name.
2. **Wide-table picker** — the prototype's wide tables, each marked authorized/not, with a company count and a short description; pick any subset.
3. **Chat zone** — the live part. Type a message and send it; the first send creates and opens a Host session (`ctx.sessions.create` → `retain`), subsequent sends prompt the same binding, and the transcript renders user bubbles, streamed assistant text, and tool-call rows as events arrive.

"保存配置" is cosmetic (shows a toast); "新会话" releases the owned session and starts a fresh one on the next send.

<a id="understand-the-implementation"></a>
## Understand the implementation

- [src/client/index.ts](src/client/index.ts) — the Cordis `apply`: registers the `auditSpace` dictionary, the `main` keyed slot (`PANEL_ID = 'audit-space'`), and the `sidebar.panellist` entry, exactly like `ui-plugin-manager`.
- [src/client/audit-space-controller.ts](src/client/audit-space-controller.ts) — apply-world session driver. `send()` lazily creates/retains a Session, prompts it, and folds `binding.eventSource` window entries into a transcript snapshot. The fold is idempotent: it tracks the last processed durable `seq` and transient `seq`, so repeated window reads never duplicate rows; `assistant/live-chunk` transient text accumulates into a `streaming` buffer that the settled `assistant/message` event clears.
- [src/client/audit-space-store.ts](src/client/audit-space-store.ts) — pure presentation store (project, selected tables, draft, transcript). The component writes through `props.actions.*`; only `send`/`newSession` go through the inject face because they need the apply closure.
- [src/client/AuditSpacePage.tsx](src/client/AuditSpacePage.tsx) — the page component; five-share props, markdown assistant bubbles via `MarkdownText`, auto-scroll transcript.
- [src/client/mock-data.ts](src/client/mock-data.ts) — the prototype's wide tables and projects.

## Model Experience

Indirectly, through the stock agent Session the chat zone drives, which owns the prompt, tool set, and transcript of every turn; this panel renders that Session's events and contributes no model-facing text of its own.

#### KV Cache effect

The panel registers nothing in the request prefix, so it never invalidates reuse on its own. Each chat's Session follows the ordinary append-only growth of the session packages, and "新会话" starts an independent request chain that shares no reusable prefix with the previous one.

## Known Limitations and Deferred Work

- Project/table data is mock; field-level configuration and the data-scope company pool from the prototype are not yet rendered.
- A single shared Session per panel mount; no per-project session history, persistence, or sidebar list.
- No locale-agnostic tests yet; the package is a verification slice.

<a id="dev-note"></a>
### Dev Note

Built from the [adding-a-package checklist](../../../docs/cookbook/adding-a-package.md) and the `ui-plugin-manager` registration pattern. Rebuild with `pnpm --filter @deepseek-ai/dsh-client-ui-audit-space bundle` before probing a live `dsh web` server.

**Runtime invariant:** No companion is published. The panel owns no commit-event contract to observe: it folds the stock Session's own events into a transcript snapshot and keeps no independently maintained projection.
