---
description: "虹灵 enterprise OIDC SSO sign-in: the operator authenticates in a browser against the market backend, the Host half keeps the id_token, and the Web client shows the account section and the login overlay."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-hongling-auth

English | [中文](README.zh.md)

## Summary

Mount this package to sign an operator in to a 虹灵 deployment with enterprise SSO instead of the shipped DeepSeek Platform account page. The Web client shows an Account settings section and a login overlay; the Host half opens a loopback receiver, sends the operator to the market backend, verifies the returned id_token, and keeps it in a mode-0600 file under the harness home, so the browser never receives the token. Other plugins' Host halves read the live token through `ctx.honglingAuth`. Point `backendUrl` at another market, and enable `devAuth` only in development.

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

Mount this plugin as one row and the operator signs in from Settings ▸ Account.

### When to choose it

Choose this package when operators sign in through 虹灵's enterprise identity provider. The shipped account section signs in to DeepSeek Platform; this package claims the same `settings.section` id at priority `-1`, so the 虹灵 panel wins wherever both are composed. Without an enterprise IdP, omit the row: nothing else in the package is useful on its own.

### Minimal configuration

```yaml
- id: hongling-auth
  name: '@deepseek-ai/dsh-client-hongling-auth'
  config:
    backendUrl: https://agent-sphere.changhong.com
    verifyLocal: true
    devAuth: false
```

| Field | Default | Meaning |
|---|---|---|
| `backendUrl` | `https://agent-sphere.changhong.com` | Market backend origin, without the `/api/v1` suffix. |
| `redirectPort` | a free port | Fixed loopback port for SSH port-forwarding setups. |
| `verifyLocal` | `true` | Verify the id_token signature against the issuer's JWKS. |
| `devAuth` | `false` | Expose `auth.devLogin`, which mirrors the backend's `AUTH_MODE=dev` injection. |

Three environment variables fill in a field the config block omits: `HONGLING_DSH_BACKEND_URL`, `HONGLING_DSH_OIDC_REDIRECT_PORT`, and `HONGLING_DSH_OIDC_VERIFY_LOCAL`. A pinned port outside 1024–65535 is ignored rather than fatal, so a bad environment value degrades to a random port. The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-client-hongling-auth) is the exhaustive source for every accepted field.

### What the operator sees

The section shows the sign-in button, the signed-in profile with its roles and token expiry, and a sign-out action. Starting a sign-in opens the system browser at the market relay; the panel then reports four phases — waiting for the browser, receiving the callback, verifying, and signed in — and polls the progress line once a second. A host with no browser still shows the login URL with a copy button, so the operator can finish the flow by hand. Cancelling, or the five-minute deadline, closes the loopback receiver and returns the panel to rest. The page event `hongling-auth:request-login` opens the same panel as an overlay from anywhere in the client, and the overlay dismisses itself 600 ms after a sign-in lands.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The two halves never share the token, so the split is the design: the Host half owns the credential and the browser half owns the presentation. One RPC channel, `/hongling-auth`, carries six endpoints — status, login, progress, cancel, logout, and the development injection — and no result carries a token. Other plugins read `ctx.honglingAuth.getToken()` instead of opening their own channel; the runtime renews first when the token is inside the 60-second refresh margin, so a host-side caller never presents a token that expires mid-request.

The login flow is loopback-only. The backend relay returns the operator to `http://127.0.0.1:<port>/callback` with the tokens in the URL fragment, which browsers never send to a server; the served page reads `location.hash` itself, erases it, and posts the pairs to `/complete` on the same origin. The listener binds to the IPv4 loopback only, accepts one completion or cancellation, then closes. The backend is a confidential OIDC client, so this plugin holds no client secret: it renews through the backend's `/dsh/refresh` instead of exchanging a code itself, and an `invalid_grant` clears the login rather than retrying.

Verification is two-tier. Expiry is always enforced; the signature check against the issuer's JWKS degrades to a warning when the issuer cannot be reached, because the backend relay stays the final authority. The token file lives at `<harness home>/hongling-auth/auth.json`, mode 0600 inside a 0700 directory. A refresh response that omits `exp` falls back to the `expires_in` lifetime reported alongside it.

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Host plugin: config, the RPC channel, `ctx.honglingAuth`, restore-on-mount. |
| [`src/runtime.ts`](src/runtime.ts) | Login state, the refresh round trip, endpoint dispatch. |
| [`src/login-session.ts`](src/login-session.ts) | The loopback receiver and the callback page it serves. |
| [`src/jwt.ts`](src/jwt.ts) | Decoding, claim projection, JWKS verification, token assembly. |
| [`src/config.ts`](src/config.ts) | Config resolution, environment fallbacks, on-disk locations. |
| [`src/client/index.ts`](src/client/index.ts) | Both slot registrations and the login-request bridge. |
| [`src/client/auth-panel.ts`](src/client/auth-panel.ts) | Shared panel state and the actions both surfaces call. |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [ui-settings-account](../ui-settings-account/README.md) — the shipped account section this package shadows.
- [ui-settings](../ui-settings/README.md) — declares `settings.section`.
- [ui-layout](../ui-layout/README.md) — declares `shell.overlay`.
- [connection](../connection/README.md) — the authenticated transport the RPC channel runs on.
- [Web client architecture](../../../.agents/notes/implemented/architecture/2026-07-19-gui-web-client-architecture.md) — how browser plugin rows load and register slots.

-----

<a id="model-experience"></a>
## Model Experience

None, as account authorization registers no model context or tools; credentials affect HTTP authentication only.

#### KV Cache effect

No model request prefix changes.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits bound an enterprise deployment. They are current package constraints, not a comparison with Platform sign-in or a task backlog.

- **One backend and one login at a time** — the receiver serves a single in-flight login, and one config block names one market. A second market needs a second composition row with its own channel.
- **The token file is not encrypted** — mode 0600 beneath the harness home is the whole storage boundary, so anything that can read that account can read the token.
- **A JWKS that cannot be reached does not fail the sign-in** — the signature check degrades to a warning after the expiry check, so a relay compromise is not caught locally.
- **`devAuth` is a config switch, not a role check** — it lets any RPC caller mint a login for any username, so it belongs to development compositions only.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

Ported from the third-party `hongling-plugins/hongling-auth` desktop plugin of the HongLingElectron project. The port kept that plugin's config surface — `backendUrl`, `redirectPort`, `verifyLocal`, `devAuth` — and its loopback flow, and replaced the presentation: the plugin's own CSS variables and hardcoded purple became the shared `--dsw-alias-*` tokens, and its standalone account page became a section that shadows the shipped one at priority `-1` instead of adding a second Settings entry.

</details>

**Runtime invariant:** No companion is published. The plugin keeps no independently maintained runtime relationship to inspect: token freshness, the single in-flight receiver, and the service lifetime are asserted directly by the package's Host specs.