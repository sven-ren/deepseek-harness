/**
 * The typed channel caller: the absent-connection code, a successful call's
 * unwrapping, and a refused call turned into a thrown {@link AuthClientError}.
 */
import { describe, expect, it, vi } from 'vitest'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type { ClientConnectionRpc } from '@deepseek-ai/dsh-client-connection/src/rpc.ts'
import { AuthClientError, createAuthRpcCall, HOST_UNAVAILABLE } from '../src/client/auth-rpc.ts'
import { CHANNEL } from '../src/channel.ts'

/** A connection handle carrying `call`; the caller touches no other member. */
function connectionOf(call: ClientConnectionRpc['call']): ConnectionHandle {
  return { rpc: { call } } as ConnectionHandle
}

describe('createAuthRpcCall', () => {
  it('refuses every call while the Host connection service is absent', async () => {
    const call = createAuthRpcCall(undefined)
    await expect(call('auth.getStatus', {})).rejects.toMatchObject({
      code: HOST_UNAVAILABLE, message: 'Host connection service is not published',
    })
    expect(HOST_UNAVAILABLE).toBe('HOST_UNAVAILABLE')
  })

  it('unwraps the value of a successful call on the plugin channel', async () => {
    const call = vi.fn(async () => ({ ok: true as const, value: { loggedIn: false } }))
    await expect(createAuthRpcCall(connectionOf(call))('auth.getStatus', {}))
      .resolves.toEqual({ loggedIn: false })
    expect(call).toHaveBeenCalledWith(CHANNEL, 'auth.getStatus', {})
  })

  it('raises the Host failure as a named client error', async () => {
    const call = vi.fn(async () => ({
      ok: false as const,
      error: { code: 'DEV_AUTH_DISABLED', message: '未启用', details: {} },
    }))
    const failure = createAuthRpcCall(connectionOf(call))('auth.devLogin', { username: 'sven' })
    await expect(failure).rejects.toBeInstanceOf(AuthClientError)
    await expect(failure).rejects.toMatchObject({ name: 'AuthClientError', code: 'DEV_AUTH_DISABLED', message: '未启用' })
  })
})
