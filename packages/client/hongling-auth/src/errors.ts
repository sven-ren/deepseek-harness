/**
 * Failure carrying a stable code for logs and audit, with a message written
 * for the operator reading the login panel.
 *
 * @module @deepseek-ai/dsh-client-hongling-auth/errors
 */

/** A login or verification failure with a machine-readable `code`. */
export class AuthError extends Error {
  /** Stable failure code. */
  readonly code: string

  /**
   * @param code - stable failure code, logged with the endpoint that raised it.
   * @param message - operator-facing text, safe to render in the login panel.
   */
  constructor(code: string, message: string) {
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
