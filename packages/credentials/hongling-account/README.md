---
description: "Sign the Desktop in through the company SSO relay, show the employee name in the account menu, and use the account token as the model credential."
kind: "package-reference"
---

# @deepseek-ai/dsh-hongling-account

English | [中文](README.zh.md)

This package implements the `ctx.deepseekAccount` seam for the enterprise deployment, so the account menu, the welcome gate, the bottom-left identity label, and the model credential path are the stock consumers and this package adds no renderer surface of its own. A home patch disables the official account row and inserts this one; nothing upstream is edited.

Sign-in does not exchange an authorization code here. The registered `redirect_uri` and the OIDC client secret belong to the company relay, so the relay performs the code exchange on its own server and returns the browser to this Host with the tokens in the URL fragment. Because a fragment never reaches a server, the relay lands the browser on a page served by this package, and that page posts the fragment back to the Host.

`startSignIn` binds a loopback receiver on `127.0.0.1` and publishes `waiting-browser` with `authorizeUrl` set to `<brokerOrigin>/dsh/login?port=<port>`. The Desktop opens that URL, the operator approves at the company identity provider, and the relay returns the browser to `http://127.0.0.1:<port>/callback`. Only loopback peers are served, and the first accepted fragment owns the result: a later request is refused rather than allowed to replace it. The landing page erases the fragment from the address bar before it posts, so the token does not survive in browser history.

Verification is what makes a relayed token trustworthy, since the token arrives over a redirect rather than from the issuer directly. Expiry and a non-empty subject are enforced on every login. The issuer is checked only when `issuer` is configured. The signature is checked against the keys at `jwksUri` whenever they can be fetched, and degrades to a warning when they cannot; the company gateway re-verifies every request it proxies, so an unreachable key list is an availability failure rather than a way to forge an identity.

`getProfile` answers from the claims captured at login, so the employee name paints immediately and no profile endpoint can blank the identity. `getBalance` reports an empty wallet for a signed-in account and the deployment has no bonus campaign, so bonus reads are always empty. `getPlatformSession` is always null because this deployment embeds no platform document.

`resolveToken` returns the stored `id_token` only for `inferenceOrigin`, and only for that exact origin. Expiry is deliberately not checked there: the gateway is the authority on the token, and letting it answer 401 is what makes `rejectToken` observable, which clears the grant, emits `deepseek-account/session-expired` and then `deepseek-account/signed-out`, and returns the operator to the login gate.

This provider does not register an authorization flow. The official provider commits through `ctx.authorization.begin()`, whose seam accepts only a commit it observed; nothing else in the runtime consumes that seam for the account key, so the attempt is driven directly and the grant is written through `ctx.credentials`. That removes the `NO_FLOW`, `ALREADY_IN_FLIGHT` and `NOT_COMMITTED` failure classes along with the interaction stubs they require.

## Summary

Sign the Desktop in through the company SSO relay, show the employee name in the account menu, and use the account token as the model credential.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## Use this package

The package exports `HonglingAccount`, a `DeepSeekAccount` subclass that also serves as the default export. It declares `static inject = ['credentials']` and takes the validated deployment configuration as its second constructor argument.

`brokerOrigin` is the company login relay that owns the browser round trip. `inferenceOrigin` is the exact origin allowed to receive the account token. `jwksUri` is the issuer's key list, read only for local signature verification. `usageUrl` and `topUpUrl` are the account menu's browser destinations and must be absolute https URLs, or loopback http ones, because the Desktop validates both before it publishes any account state.

`issuer` is empty by default, which accepts any declared issuer. The trust anchor is the signature check, not an `iss` string match, and the relay is free to re-issue the token under its own issuer, so a pinned default would reject the first successful login. Set it to the real `iss` once that value is known.

`verifyLocal` defaults to true. `callbackPort` defaults to 0, which selects a free loopback port, and `attemptTimeoutMs` bounds the whole attempt including the browser round trip.

## Model Experience

None, as account credentials affect HTTP authentication and never enter model prompts, Session logs, or tool results.

#### KV Cache effect

No model request prefix changes.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The receiver is loopback-only and binds a port on the machine running the Host, so this flow is supported for the Desktop and not for a Host reached over the network or through a remote development host; the relay always returns the browser to `127.0.0.1`. No refresh flow is implemented even though a relayed `refresh_token` is stored: once the `id_token` expires the gateway answers 401, the grant is cleared, and the operator signs in again. Sign-out is local only, because the deployment exposes no revocation endpoint. The issuer is unpinned by default, so a deployment that needs the stricter check must set `issuer` after reading the real `iss` from the login log. Signature verification degrades to a warning when `jwksUri` is unreachable, which makes the gateway the only authority for that attempt. The deployment has no wallet, no bonus campaign, and no embedded platform document, so balance reads report an empty wallet, bonus reads are always empty, and `getPlatformSession` is always null. Branding beyond the stock chrome, such as a logo or wordmark, is out of scope here because those are client-side occupants that must be compiled into the client build, which a Host-only added package cannot reach. The package is marked private and is never published, so it must be resolvable from the profile's `node_modules`. The web login path is untested; the port the relay is told to use is bound on the Host, which is the correct machine only when the browser and the Host are the same.

<a id="dev-note"></a>
### Dev Note

The two departures from the official provider are deliberate. Driving the attempt directly instead of registering an authorization flow removes three failure classes and the interaction stubs they require, at the cost of owning the commit path; the seam only ever accepted a commit it observed, and no consumer outside the provider reads it for this key. Receiving a token instead of exchanging a code is forced by the environment: the client secret is not ours to hold and the only registered `redirect_uri` belongs to the relay.

The identity is captured into the grant rather than fetched, so the bottom-left label is stable while offline and no profile request can delay it. The claims this depends on are `name`, `email` and `sub`, with `preferred_username` and `employee_no` as fallbacks for the display name.