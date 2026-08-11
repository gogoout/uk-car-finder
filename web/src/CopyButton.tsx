import { useEffect, useState } from 'react';

/**
 * Copies text and says so.
 *
 * The clipboard API is unavailable outside a secure context, and rejects if the
 * page has lost focus — both fail silently otherwise, leaving you unsure
 * whether it worked. The fallback covers the first case; the error state covers
 * the second.
 */
export function CopyButton({
  value,
  label = 'Copy',
  copiedLabel = 'Copied',
  failedLabel = 'Press ⌘C',
  className = '',
  title,
  ariaLabel,
}: {
  value: string;
  label?: string;
  copiedLabel?: string;
  /** Shown when the clipboard refuses. Keep it short for an icon button. */
  failedLabel?: string;
  className?: string;
  title?: string;
  /** Needed when the label is an icon, which reads as nothing to a screen reader. */
  ariaLabel?: string;
}) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');

  useEffect(() => {
    if (state === 'idle') return;
    const timer = setTimeout(() => setState('idle'), 1800);
    return () => clearTimeout(timer);
  }, [state]);

  const copy = async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
      } else {
        // http:// or an older browser — the clipboard API simply isn't there.
        const field = document.createElement('textarea');
        field.value = value;
        field.setAttribute('readonly', '');
        field.style.position = 'fixed';
        field.style.opacity = '0';
        document.body.appendChild(field);
        field.select();
        document.execCommand('copy');
        field.remove();
      }
      setState('copied');
    } catch {
      setState('failed');
    }
  };

  return (
    <button
      type="button"
      className={className}
      title={title ?? value}
      aria-label={ariaLabel}
      aria-live="polite"
      onClick={copy}
    >
      {state === 'copied' ? copiedLabel : state === 'failed' ? failedLabel : label}
    </button>
  );
}
