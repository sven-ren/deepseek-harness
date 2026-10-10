/**
 * Token persistence: a corrupt, absent, or foreign-shaped file reads as "not
 * logged in" rather than failing startup; a save replaces the document; a
 * logout is idempotent; and a filesystem that refuses the mode tightening does
 * not turn a successful login into a failure.
 */
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TokenSet } from '../src/types.ts'
import { clearTokenSet, loadTokenSet, saveTokenSet } from '../src/token-store.ts'

// chmod is the one call whose failure the module deliberately swallows; the
// spy is the only way to reach that arm on a filesystem that honors modes.
const chmodSpy = vi.hoisted(() => ({ impl: undefined as undefined | (() => Promise<void>) }))
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return { ...actual, chmod: (...args: Parameters<typeof actual.chmod>) => chmodSpy.impl?.() ?? actual.chmod(...args) }
})

const TOKENS: TokenSet = {
  version: 1,
  iss: 'https://agent-sphere.changhong.com',
  idToken: 'header.payload.signature',
  refreshToken: 'refresh',
  expiresAt: 1_700_000_000_000,
  profile: { username: 'sven', displayName: 'Sven', roles: ['admin'] },
  savedAt: 1_699_000_000_000,
}

const dirs: string[] = []

async function tempFile(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-hongling-auth-'))
  dirs.push(dir)
  return join(dir, 'auth.json')
}

afterEach(async () => {
  chmodSpy.impl = undefined
  await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

describe('loadTokenSet', () => {
  it('reads back a saved set', async () => {
    const file = await tempFile()
    await saveTokenSet(file, TOKENS)
    await expect(loadTokenSet(file)).resolves.toEqual(TOKENS)
  })

  it('reads an absent file as not logged in', async () => {
    await expect(loadTokenSet(join(await tempFile(), 'missing.json'))).resolves.toBeNull()
  })

  it('reads an unparsable file as not logged in', async () => {
    const file = await tempFile()
    await writeFile(file, '{ not json')
    await expect(loadTokenSet(file)).resolves.toBeNull()
  })

  it('refuses a document from another schema version or without a usable token', async () => {
    const file = await tempFile()
    for (const document of [
      { version: 2 },
      { version: 1 },
      { version: 1, idToken: '' },
      { version: 1, idToken: 7 },
      { version: 1, idToken: 'header.payload.signature' },
      { version: 1, idToken: 'header.payload.signature', profile: 'sven' },
      { version: 1, idToken: 'header.payload.signature', profile: null },
    ]) {
      await writeFile(file, JSON.stringify(document))
      await expect(loadTokenSet(file)).resolves.toBeNull()
    }
  })

  it('refuses a document that is not an object, or names no version', async () => {
    const file = await tempFile()
    for (const text of ['null', '"nope"', '[]', '{}', '7']) {
      await writeFile(file, text)
      await expect(loadTokenSet(file)).resolves.toBeNull()
    }
  })
})

describe('saveTokenSet', () => {
  it('creates the directory and writes the document owner-readable only', async () => {
    const file = await tempFile()
    await saveTokenSet(file, TOKENS)
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual(TOKENS)
    if (process.platform !== 'win32') expect((await stat(file)).mode & 0o777).toBe(0o600)
  })

  it('keeps the login when the filesystem refuses to tighten an existing file', async () => {
    const file = await tempFile()
    await saveTokenSet(file, TOKENS)
    chmodSpy.impl = () => Promise.reject(new Error('EPERM'))
    await expect(saveTokenSet(file, TOKENS)).resolves.toBeUndefined()
    await expect(loadTokenSet(file)).resolves.toEqual(TOKENS)
  })
})

describe('clearTokenSet', () => {
  it('deletes the document and treats a second call as success', async () => {
    const file = await tempFile()
    await saveTokenSet(file, TOKENS)
    await clearTokenSet(file)
    await expect(loadTokenSet(file)).resolves.toBeNull()
    await expect(clearTokenSet(file)).resolves.toBeUndefined()
  })
})
