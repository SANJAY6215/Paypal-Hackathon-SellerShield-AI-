/** Strip secrets and personal data before anything is sent to a model or logged. */
export function redact(text: string): string {
  return text
    .replace(/sk-[A-Za-z0-9_-]{16,}/g, '[REDACTED_KEY]')
    .replace(/AIza[A-Za-z0-9_-]{20,}/g, '[REDACTED_KEY]')
    .replace(/gsk_[A-Za-z0-9]{20,}/g, '[REDACTED_KEY]')
    .replace(/gh[pousr]_[A-Za-z0-9]{20,}/g, '[REDACTED_KEY]')
    .replace(/github_pat_[A-Za-z0-9_]{20,}/g, '[REDACTED_KEY]')
    .replace(/Bearer\s+[A-Za-z0-9._-]{12,}/gi, 'Bearer [REDACTED]')
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[REDACTED_EMAIL]')
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, '[REDACTED_TOKEN]');
}
