// Username/password account rules, shared so the form and the server agree.

export const USERNAME_MIN = 3;
export const USERNAME_MAX = 16; // same cap as the in-game name
export const PASSWORD_MIN = 6;
export const PASSWORD_MAX = 72;
const USERNAME_RE = /^[A-Za-z0-9_-]+$/;

/** An error message for bad credentials, or null if they're acceptable. */
export function checkCredentials(username: string, password: string): string | null {
  if (typeof username !== 'string' || typeof password !== 'string') return 'Enter a username and password.';
  if (username.length < USERNAME_MIN || username.length > USERNAME_MAX) return `Usernames are ${USERNAME_MIN}-${USERNAME_MAX} characters.`;
  if (!USERNAME_RE.test(username)) return 'Usernames can use letters, numbers, _ and -.';
  if (password.length < PASSWORD_MIN) return `Passwords need at least ${PASSWORD_MIN} characters.`;
  if (password.length > PASSWORD_MAX) return `Passwords can be at most ${PASSWORD_MAX} characters.`;
  return null;
}
