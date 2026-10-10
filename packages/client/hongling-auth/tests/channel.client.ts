/**
 * The typed-channel test double. A panel is handed an {@link AuthRpcCall}, not
 * a bare spy, so the caller here keeps the answer function a test controls
 * while presenting the generic call signature the panel requires.
 */
import { vi } from 'vitest'
import type { AuthRpcCall } from '../src/client/auth-rpc.ts'
import type { AuthRpc, AuthRpcEndpoint } from '../src/types.ts'

/** Produce one endpoint's answer, as a value or a promise. */
export type ChannelRespond = (endpoint: string, payload: unknown) => unknown

/**
 * Build a typed channel caller over `respond`.
 * @param respond - produces each endpoint's answer.
 * @returns the caller the panel takes, and the spy the assertions inspect.
 */
export function channel(respond: ChannelRespond): { call: AuthRpcCall; log: ReturnType<typeof vi.fn> } {
  const log = vi.fn((endpoint: string, payload: unknown) => respond(endpoint, payload))
  const call: AuthRpcCall = async <E extends AuthRpcEndpoint>(endpoint: E, payload: AuthRpc[E]['payload']) => {
    const answer: unknown = await log(endpoint, payload)
    return answer as AuthRpc[E]['result']
  }
  return { call, log }
}
