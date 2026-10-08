/**
 * Audit-space panel, node half.
 *
 * The whole feature is browser-presentation: a project picker, a wide-table
 * picker, and a chat zone that drives an ordinary agent Session. The node
 * half has no behavior — the Host already owns sessions through the standard
 * session-controller service the client half reuses.
 */

/** Host plugin body — nothing runs server-side. */
export function apply(): void {}
