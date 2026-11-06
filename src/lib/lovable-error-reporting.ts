/**
 * Lovable editor telemetry shim.
 *
 * Outside Lovable (Render / local / any non-editor host) this is a deliberate
 * no-op: the `__lovableEvents` / `__lovableReportRuntimeError` hooks are never
 * injected, so nothing is reported. Kept only so the root error boundary can
 * still call `reportLovableError` without a special-case import.
 */
export function reportLovableError(
  _error: unknown,
  _context: Record<string, unknown> = {},
): void {
  // No-op outside Lovable. Inside the Lovable editor preview those window
  // hooks may exist; we intentionally do not forward anything from the live
  // demo so production never depends on Lovable telemetry.
  return;
}
