import { useState } from 'react';
import type { MessagePoll } from '../lib/api';
import { IconClose } from './icons';

export type PollDraft = { question: string; options: string[]; multiple: boolean };

/** Renders a message poll with live percentages and a click-to-vote option list. */
export function PollCard({
  poll,
  canVote,
  onVote,
}: {
  poll: MessagePoll;
  canVote: boolean;
  onVote: (optionIds: string[]) => Promise<void>;
}) {
  const [busy, setBusy] = useState<string | null>(null);

  const vote = async (optionId: string) => {
    if (!canVote || busy) return;
    setBusy(optionId);
    try {
      await onVote([optionId]);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div
      className="poll-card"
      style={{
        marginTop: 6,
        padding: 12,
        borderRadius: 12,
        border: '1px solid rgba(255,255,255,0.09)',
        background: 'rgba(255,255,255,0.03)',
        maxWidth: 460,
      }}
    >
      <div style={{ fontWeight: 600 }}>{poll.question}</div>
      <div className="muted small" style={{ margin: '2px 0 8px' }}>
        {poll.multiple ? 'Select all that apply' : 'Pick one'} · {poll.totalVotes}{' '}
        {poll.totalVotes === 1 ? 'vote' : 'votes'}
      </div>
      <div className="stack" style={{ gap: 6 }}>
        {poll.options.map((option) => {
          const mine = poll.myOptionIds.includes(option.id);
          return (
            <button
              key={option.id}
              type="button"
              onClick={() => void vote(option.id)}
              disabled={!canVote || busy !== null}
              aria-pressed={mine}
              aria-label={`Vote for ${option.label}, ${option.percent}%`}
              style={{
                position: 'relative',
                textAlign: 'left',
                padding: '9px 11px',
                borderRadius: 10,
                border: `1px solid ${mine ? '#22d3ee' : 'rgba(255,255,255,0.10)'}`,
                background: 'transparent',
                color: 'inherit',
                cursor: canVote ? 'pointer' : 'default',
                overflow: 'hidden',
                font: 'inherit',
              }}
            >
              <span
                aria-hidden
                style={{
                  position: 'absolute',
                  inset: 0,
                  width: `${option.percent}%`,
                  background: mine ? 'rgba(34,211,238,0.22)' : 'rgba(255,255,255,0.07)',
                  transition: 'width 160ms ease',
                }}
              />
              <span style={{ position: 'relative', display: 'flex', gap: 8, justifyContent: 'space-between' }}>
                <span className="truncate">
                  {mine ? '✓ ' : ''}
                  {option.label}
                </span>
                <span className="muted small">{option.percent}%</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Modal used to compose a new poll message. */
export function PollComposer({
  onCancel,
  onSubmit,
  sending,
}: {
  onCancel: () => void;
  onSubmit: (draft: PollDraft) => void;
  sending?: boolean;
}) {
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState<string[]>(['', '']);
  const [multiple, setMultiple] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setOption = (index: number, value: string) => {
    setOptions((prev) => prev.map((entry, position) => (position === index ? value : entry)));
  };

  const submit = () => {
    const cleanQuestion = question.trim();
    const cleanOptions = options.map((option) => option.trim()).filter(Boolean);
    if (!cleanQuestion) {
      setError('Add a question for your poll.');
      return;
    }
    if (cleanOptions.length < 2) {
      setError('A poll needs at least two options.');
      return;
    }
    setError(null);
    onSubmit({ question: cleanQuestion, options: cleanOptions, multiple });
  };

  return (
    <div className="modal-scrim" onClick={onCancel}>
      <div
        className="modal"
        style={{ maxWidth: 460 }}
        role="dialog"
        aria-label="Create a poll"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
          <h2 style={{ margin: 0, fontSize: 16 }}>Create a poll</h2>
          <button type="button" className="icon-btn" aria-label="Close poll composer" onClick={onCancel}>
            <IconClose size={16} />
          </button>
        </div>

        <label className="stack" style={{ gap: 6 }}>
          <span className="small muted">Question</span>
          <input
            className="input"
            value={question}
            maxLength={300}
            placeholder="What should we play tonight?"
            aria-label="Poll question"
            onChange={(event) => setQuestion(event.target.value)}
          />
        </label>

        <div className="stack" style={{ gap: 8, marginTop: 12 }}>
          {options.map((option, index) => (
            <div key={index} className="row" style={{ gap: 6 }}>
              <input
                className="input grow"
                value={option}
                maxLength={120}
                placeholder={`Option ${index + 1}`}
                aria-label={`Poll option ${index + 1}`}
                onChange={(event) => setOption(index, event.target.value)}
              />
              {options.length > 2 && (
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={`Remove option ${index + 1}`}
                  onClick={() => setOptions((prev) => prev.filter((_, position) => position !== index))}
                >
                  <IconClose size={14} />
                </button>
              )}
            </div>
          ))}
          {options.length < 10 && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setOptions((prev) => [...prev, ''])}
            >
              Add option
            </button>
          )}
        </div>

        <label className="row" style={{ gap: 8, marginTop: 12 }}>
          <input
            type="checkbox"
            checked={multiple}
            onChange={(event) => setMultiple(event.target.checked)}
            aria-label="Allow multiple choices"
          />
          <span className="small">Allow multiple choices</span>
        </label>

        {error && (
          <p className="small" style={{ color: '#f87171', marginTop: 10 }} role="alert">
            {error}
          </p>
        )}

        <div className="row" style={{ gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary btn-sm" onClick={submit} disabled={sending}>
            {sending ? 'Sending…' : 'Post poll'}
          </button>
        </div>
      </div>
    </div>
  );
}
