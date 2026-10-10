/**
 * The browser half's typed caller for the plugin's Host channel.
 *
 * Connection already owns the envelope, request correlation, the Host/Origin
 * fence, and browser authentication, so this module only narrows the endpoint
 * table into a typed call and turns a failed result into a thrown error the
 * panel can report.
 *
 * @module @deepseek-ai/dsh-client-hongling-auth/client/auth-rpc
 */

import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import { CHANNEL } from '../channel.ts'
import type { AuthRpc, AuthRpcEndpoint } from '../types.ts'

/** Error code reported when the Host half has not published its connection service. */
export const HOST_UNAVAILABLE = 'HOST_UNAVAILABLE'

/** A failed call, carrying the Host's machine-readable code. */
export class AuthClientError extends Error {
  /**
   * @param code - stable machine-readable failure code.
   * @param message - operator-facing message.
   */
  constructor(readonly code: string, message: string) {
    super(message)
    this.name = 'AuthClientError'
  }
}

/** One typed call against the plugin's Host channel. */
export type AuthRpcCall = <E extends AuthRpcEndpoint>(
  endpoint: E,
  payload: AuthRpc[E]['payload'],
) => Promise<AuthRpc[E]['result']>

/**
 * Bind the caller to the connection handle this renderer published.
 * @param connection - the renderer's connection service, absent before it installs.
 * @returns the typed caller; it throws {@link AuthClientError} on every failure.
 */
export function createAuthRpcCall(connection: ConnectionHandle | undefined): AuthRpcCall {
  return async (endpoint, payload) => {
    if (connection === undefined) {
      throw new AuthClientError(HOST_UNAVAILABLE, 'Host connection service is not published')
    }
    const result = await connection.rpc.call(CHANNEL, endpoint, payload)
    if (!result.ok) throw new AuthClientError(result.error.code, result.error.message)
    return result.value as AuthRpc[typeof endpoint]['result']
  }
}
