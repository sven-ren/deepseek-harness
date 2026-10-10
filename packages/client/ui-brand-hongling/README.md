---
description: "虹灵 HongLing brand occupants for the sidebar and the conversation hero; for deployments branded as HongLing rather than DeepSeek Harness."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-brand-hongling

English | [中文](README.zh.md)

## Summary

This package puts the 虹灵 HongLing mark and wordmark in the sidebar and the mark in the blank-session hero, replacing whatever the shell or another brand package registered there. It applies to every build profile, so a deployment branded as HongLing composes this package instead of `ui-brand-official`. It has no runtime state and does not affect model requests.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount this plugin in the browser roster of a deployment branded as 虹灵. It needs no configuration and no build profile.

### How it takes over the slots

Every slot it fills is a `single` slot, so the lowest priority wins. This package registers at `-1` while the shipped occupants sit at the default `0`, so the 虹灵 artwork renders without the deployment having to disable anything. A deployment that wants the DeepSeek Harness brand back removes this package row rather than reconfiguring it.

### Replacing the brand again

Occupying these slots is the only composition route; there is no brand configuration surface here. Two brand packages can be mounted together, and the lower priority wins in each slot — which is why an explicit `-1` is part of the registration rather than an accident of load order.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The three occupants install as one declaration-aware registration set: nested `ctx.slots.inject()` calls wait on all three declaring packages, so the set works whether this row activates before or after them, withdraws together when any declaration collapses, and leaves no partial brand mix during HMR. The browser half is [`src/client/index.ts`](src/client/index.ts); the node half is an empty Loader seat.

The artwork lives in [`src/client/brand-artwork.ts`](src/client/brand-artwork.ts) as inner-SVG markup injected through `dangerouslySetInnerHTML`, following the code-file icons in `dsh-client-ui-primitives`. The authored attribute spelling survives, `class` rules became presentation attributes so nothing is injected document-wide, and the gradient and filter ids carry a `useId()`-derived instance id — the mark renders in the sidebar and the hero at once, so fixed ids would collide in the document. Ink follows `currentColor`, and only the mark's core cutout keeps the `--dsw-alias-bg-base` token.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the brand surface is not enough. They move from the slots this package occupies to the shell that renders them.

- [ui-sidebar](../ui-sidebar/README.md) — declares `sidebar.brand.mark` and `sidebar.brand.name` and renders their fallbacks.
- [ui-conversation](../ui-conversation/README.md) — declares `conversation.hero.brand.mark` in the hero.
- [ui-brand-official](../ui-brand-official/README.md) — the shipped occupant this package shadows.
- [Web client architecture](../../../.agents/notes/implemented/architecture/2026-07-19-gui-web-client-architecture.md) — how browser plugin rows load and register slots.

-----

<a id="model-experience"></a>
## Model Experience

None, as the package contributes browser presentation only; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define how brand presentation is supplied. They are current package constraints, not a brand-design comparison or a task backlog.

- **One occupant set** — alternative presentation belongs in another Cordis package occupying the same slots.
- **The browser title is independent** — the sidebar wordmark is a slot occupant, but the document title is a build-environment concern (`DSH_CLIENT_TITLE`).

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

Ported from the third-party `dsh-brand-hongling` desktop plugin, which filled the same three slots. The port dropped that plugin's `@deepseek-ai/dsh-client-runtime` inject entry (the package no longer exists) and its `<title>`/`<desc>` elements, which the shell's own decorative brand artwork does not carry either.

</details>

**Runtime invariant:** No companion is published. The package retains no mutable state, and its three slot occupants install and leave through one transactional effect.
