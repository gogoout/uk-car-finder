import { useEffect, useRef, useState } from 'react';
import { Pencil } from 'lucide-react';

/**
 * A one-line reason, shown as text and edited in place.
 *
 * The reason you shortlisted or rejected a car is worth exactly as much as it
 * is easy to write down, so this never blocks anything: the decision is already
 * saved by the time this appears, and typing nothing is a normal outcome.
 *
 * `startEditing` opens it focused, used at the moment of the decision — that is
 * when you know why, and a fortnight later is when you need it.
 */
export function NoteField({
  value,
  icon,
  placeholder,
  startEditing = false,
  onSave,
}: {
  value: string | null;
  icon: React.ReactNode;
  placeholder: string;
  startEditing?: boolean;
  onSave: (note: string | null) => void;
}) {
  const [editing, setEditing] = useState(startEditing);
  const [draft, setDraft] = useState(value ?? '');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  // A reload can bring back a newer note than the draft was based on.
  useEffect(() => {
    if (!editing) setDraft(value ?? '');
  }, [value, editing]);

  const commit = () => {
    setEditing(false);
    const next = draft.trim();
    if (next === (value ?? '')) return;
    onSave(next || null);
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        className="note-input"
        value={draft}
        placeholder={placeholder}
        aria-label={placeholder}
        maxLength={500}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') {
            setDraft(value ?? '');
            setEditing(false);
          }
        }}
      />
    );
  }

  return (
    <button type="button" className="note-line tiny" onClick={() => setEditing(true)}>
      <span className="note-icon" aria-hidden="true">
        {icon}
      </span>
      {value ? <span className="note-text">{value}</span> : <span className="muted">{placeholder}</span>}
      <Pencil size={11} aria-hidden="true" className="note-pencil" />
    </button>
  );
}
