export function formatDate(iso: string | null | undefined, opts: Intl.DateTimeFormatOptions = {}): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  // Intl rejects combining dateStyle with granular fields, so pick one strategy.
  const options: Intl.DateTimeFormatOptions = Object.keys(opts).length > 0 ? opts : { dateStyle: 'medium' };
  return new Intl.DateTimeFormat(undefined, options).format(date);
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return 'never';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 'never';
  const diff = Date.now() - then;
  const minutes = Math.round(diff / 60_000);
  if (Math.abs(minutes) < 1) return 'just now';
  if (Math.abs(minutes) < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return `${hours} hr${Math.abs(hours) === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  if (Math.abs(days) < 30) return `${days} day${Math.abs(days) === 1 ? '' : 's'} ago`;
  return formatDate(iso);
}

export function presenceLabel(presence: string): string {
  switch (presence) {
    case 'online':
      return 'Online';
    case 'idle':
      return 'Idle';
    case 'dnd':
      return 'Do Not Disturb';
    case 'invisible':
      return 'Invisible';
    default:
      return 'Offline';
  }
}

export const ACCENT_COLOURS: { name: string; label: string; value: string }[] = [
  { name: 'cyan', label: 'Neon Cyan', value: '#22d3ee' },
  { name: 'blue', label: 'Electric Blue', value: '#3b82f6' },
  { name: 'violet', label: 'Violet Pulse', value: '#8b5cf6' },
  { name: 'emerald', label: 'Emerald', value: '#10b981' },
  { name: 'rose', label: 'Rose', value: '#f43f5e' },
  { name: 'amber', label: 'Amber', value: '#f59e0b' },
];

export const PROFILE_COLOURS = ['#22d3ee', '#38bdf8', '#6366f1', '#8b5cf6', '#10b981', '#f59e0b', '#f43f5e', '#64748b'];
