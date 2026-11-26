import { ApiError } from './api';

/** Turns an API error into a per-field message map plus a summary message. */
export function describeError(error: unknown): { message: string; fields: Record<string, string> } {
  if (error instanceof ApiError) {
    const fields: Record<string, string> = {};
    for (const entry of error.fields) {
      if (entry?.field) fields[entry.field] = entry.message;
    }
    return { message: error.message, fields };
  }
  if (error instanceof Error && error.message) {
    return { message: error.message, fields: {} };
  }
  return { message: 'Something went wrong. Please try again.', fields: {} };
}

export const USERNAME_PATTERN = /^[a-zA-Z0-9_.]{3,24}$/;

export function usernameProblem(value: string): string | null {
  if (!value.trim()) return 'Choose a username.';
  if (!USERNAME_PATTERN.test(value.trim())) {
    return 'Usernames are 3–24 characters and use letters, numbers, dots or underscores.';
  }
  return null;
}

export function passwordProblem(value: string): string | null {
  if (value.length < 10) return 'Use at least 10 characters.';
  if (value.length > 200) return 'That password is too long.';
  if (!/[a-zA-Z]/.test(value) || !/[0-9]/.test(value)) {
    return 'Include at least one letter and one number.';
  }
  return null;
}

export function emailProblem(value: string): string | null {
  if (!value.trim()) return 'Enter your email address.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value.trim())) return 'Enter a valid email address.';
  return null;
}
