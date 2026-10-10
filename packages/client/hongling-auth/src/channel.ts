/**
 * The RPC channel name, shared by both halves of the plugin.
 *
 * It lives in its own module because the browser half must not import the
 * Host entry: `src/index.ts` pulls in `node:http`, `node:fs`, and
 * `node:child_process`, and the client bundle's purity gate rejects Node
 * builtins in a browser artifact.
 *
 * @module @deepseek-ai/dsh-client-hongling-auth/channel
 */

/** The authenticated Connection RPC channel the Host half serves. */
export const CHANNEL = '/hongling-auth'
