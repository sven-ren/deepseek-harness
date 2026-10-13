/**
 * Failure carrying a stable code for logs and for the sign-in attempt's
 * published `errorCode`, with a message written for the operator.
 *
 * The code set is exactly the account seam's `SignInErrorCode`, so every
 * failure maps onto a published phase without a translation table of its own.
 *
 * @module @deepseek-ai/dsh-hongling-account/errors
 */

import type { SignInErrorCode } from '@deepseek-ai/dsh-deepseek-account'

/** A login or verification failure carrying one published sign-in error code. */
export class AuthError extends Error {
  /** Stable failure code, rendered through the caller's locale dictionary. */
  readonly code: SignInErrorCode

  /**
   * @param code - published failure classification for this attempt.
   * @param message - operator-facing text, safe to render in the login panel.
   */
  constructor(code: SignInErrorCode, message: string) {
    super(message)
    this.name = 'AuthError'
    this.code = code
  }
}

/**
 * Render any thrown value as an operator-facing message.
 * @param error - the caught value, an Error or anything else.
 * @returns the Error message, or the value's string form.
 */
export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
