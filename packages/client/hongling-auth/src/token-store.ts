/**
 * Persistence for the login: one JSON document under the harness home,
 * owner-readable only.
 *
 * The file is written with `0700` on its directory and `0600` on the file,
 * and the mode is re-applied after the write so a pre-existing file with
 * looser permissions is tightened rather than left alone.
 *
 * @module @deepseek-ai/dsh-client-hongling-auth/token-store
 */

import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { TokenSet } from './types.ts'

/** Directory mode: only the owning user may list or enter. */
const DIR_MODE = 0o700
/** File mode: only the owning user may read the token. */
const FILE_MODE = 0o600

/**
 * Whether a parsed document is a token set this version may restore.
 *
 * The file is untrusted input: it may have been written by an earlier version,
 * truncated, or edited by hand, so the members the Host half goes on to read
 * are checked here rather than trusted through a cast.
 * @param value - the document read back from disk.
 * @returns whether the value carries a usable version, token, and profile.
 */
function isTokenSet(value: unknown): value is TokenSet {
  if (typeof value !== 'object' || value === null) return false
  if (!('version' in value) || value.version !== 1) return false
  if (!('idToken' in value) || typeof value.idToken !== 'string' || value.idToken === '') return false
  return 'profile' in value && typeof value.profile === 'object' && value.profile !== null
}

/**
 * Read a stored token set.
 *
 * Anything unreadable, unparsable, or of an unrecognized shape reads as "not
 * logged in" — a corrupt file must not fail plugin startup.
 * @param file - absolute token file path.
 * @returns the stored set, or null when there is nothing usable to restore.
 */
export async function loadTokenSet(file: string): Promise<TokenSet | null> {
  let text: string
  try {
    text = await readFile(file, 'utf8')
  } catch {
    return null
  }
  try {
    const parsed: unknown = JSON.parse(text)
    return isTokenSet(parsed) ? parsed : null
  } catch {
    return null
  }
}

/**
 * Write a token set, replacing any previous one.
 * @param file - absolute token file path.
 * @param tokens - the set to persist.
 */
export async function saveTokenSet(file: string, tokens: TokenSet): Promise<void> {
  await mkdir(dirname(file), { recursive: true, mode: DIR_MODE })
  await writeFile(file, JSON.stringify(tokens, null, 2), { mode: FILE_MODE })
  // writeFile's mode only applies when it creates the file, so tighten an
  // existing one explicitly. A filesystem that cannot express the mode (or a
  // Windows volume ignoring it) is not a reason to fail the login.
  await chmod(file, FILE_MODE).catch(() => {})
}

/**
 * Delete the stored token set. Absence is not an error — logout is
 * idempotent.
 * @param file - absolute token file path.
 */
export async function clearTokenSet(file: string): Promise<void> {
  await rm(file, { force: true })
}
