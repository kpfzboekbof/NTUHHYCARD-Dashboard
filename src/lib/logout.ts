/**
 * Sign out of the admin layer — and out of the dashboard entirely when the
 * caller was signed in individually.
 *
 * `DELETE /api/auth` clears both cookies, so for a magic-link user there is no
 * page left to return to: staying put would render an admin password form that
 * cannot help them. It answers `sessionCleared` to say which happened.
 */
export async function logoutAdmin(): Promise<void> {
  try {
    const res = await fetch('/api/auth', { method: 'DELETE' });
    const data = await res.json().catch(() => ({}));
    if (data?.sessionCleared) {
      window.location.replace('/login');
      // The navigation is under way; the caller's local reset does not matter.
      return;
    }
  } catch {
    // Fall through: reset local state so the UI returns to the login screen
    // instead of appearing stuck.
  }
}
