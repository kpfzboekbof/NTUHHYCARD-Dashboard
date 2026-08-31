'use client';

import { useState, useCallback, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { Lock, Mail } from 'lucide-react';
import { Header } from '@/components/layout/header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { safeInternalPath } from '@/lib/safe-path';

/**
 * What `/api/auth/callback` bounced back here for, in words.
 *
 * Read through `linkError` below, never indexed directly: `?error=constructor`
 * would otherwise resolve up the prototype chain to a function, and `useState`
 * treats a function argument as a lazy initializer and calls it.
 */
const LINK_ERRORS: Record<string, string> = {
  'link-invalid': '這個登入連結已失效或已被使用，請重新索取。',
  inactive: '這個帳號已停用，請聯絡管理者。',
  'no-database': '人員登記表尚未設定，請改用共用密碼登入。',
  error: '登入時發生錯誤，請再試一次。',
};

function linkError(key: string | null): string {
  return key && Object.hasOwn(LINK_ERRORS, key) ? LINK_ERRORS[key] : '';
}

function LoginForm() {
  const searchParams = useSearchParams();
  const from = safeInternalPath(searchParams.get('from'));

  // Two ways in while the migration runs: the shared password everyone
  // already knows, and a link to your own mailbox that signs you in as you.
  const [mode, setMode] = useState<'password' | 'email'>('password');
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState('');
  const [linkSent, setLinkSent] = useState(false);
  const [error, setError] = useState(linkError(searchParams.get('error')));
  const [verifying, setVerifying] = useState(false);
  // Stays true until the browser tears this page down — the button keeps
  // showing「登入成功」so the user knows the login worked while the
  // destination page loads.
  const [redirecting, setRedirecting] = useState(false);

  const busy = verifying || redirecting;

  const handleLogin = useCallback(async () => {
    if (busy || !password) return;
    setVerifying(true);
    setError('');
    try {
      const res = await fetch('/api/user-auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const d = await res.json();
      if (res.ok) {
        setRedirecting(true);
        // Full-document navigation instead of router.replace(): while the
        // user sat on /login unauthenticated, the sidebar <Link>s prefetched
        // every gated route and the proxy answered each with a redirect back
        // to /login. Those poisoned cache entries make a client-side
        // navigation land on the login screen again even though the cookie
        // is now set — a full reload resolves `from` server-side with the
        // fresh cookie and starts the router with a clean cache.
        window.location.replace(from);
      } else {
        setError(d.error || '登入失敗');
      }
    } catch {
      setError('連線失敗，請再試一次');
    } finally {
      setVerifying(false);
    }
  }, [busy, password, from]);

  const handleRequestLink = useCallback(async () => {
    if (busy || !email) return;
    setVerifying(true);
    setError('');
    try {
      await fetch('/api/auth/request-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, next: from }),
      });
      // The endpoint answers 204 whether or not the address is on the roster,
      // so this message has to read the same either way.
      setLinkSent(true);
    } catch {
      setError('連線失敗，請再試一次');
    } finally {
      setVerifying(false);
    }
  }, [busy, email, from]);

  return (
    <Card className="w-80">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {mode === 'password' ? <Lock className="h-5 w-5" /> : <Mail className="h-5 w-5" />}
          {mode === 'password' ? '請輸入使用者密碼' : '用 email 登入'}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {mode === 'password' ? (
          <form
            className="space-y-4"
            onSubmit={e => { e.preventDefault(); handleLogin(); }}
          >
            <input
              type="password"
              className="w-full rounded border px-3 py-2 text-sm disabled:opacity-50"
              placeholder="使用者密碼"
              value={password}
              onChange={e => setPassword(e.target.value)}
              disabled={busy}
              autoFocus
            />
            {error && <p className="text-sm text-red-500">{error}</p>}
            <Button type="submit" className="w-full" disabled={busy || !password}>
              {verifying ? '驗證中...' : redirecting ? '登入成功，載入頁面中...' : '登入'}
            </Button>
          </form>
        ) : linkSent ? (
          <div className="space-y-4">
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              如果 {email} 在人員名單上，登入連結已經寄出。連結 15 分鐘內有效，只能使用一次。
            </p>
            <Button
              variant="outline"
              className="w-full"
              onClick={() => { setLinkSent(false); setError(''); }}
            >
              換一個 email
            </Button>
          </div>
        ) : (
          <form
            className="space-y-4"
            onSubmit={e => { e.preventDefault(); handleRequestLink(); }}
          >
            <input
              type="email"
              className="w-full rounded border px-3 py-2 text-sm disabled:opacity-50"
              placeholder="你的 email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              disabled={busy}
              autoFocus
            />
            {error && <p className="text-sm text-red-500">{error}</p>}
            <Button type="submit" className="w-full" disabled={busy || !email}>
              {verifying ? '寄送中...' : '寄登入連結給我'}
            </Button>
          </form>
        )}

        <button
          type="button"
          className="mt-4 w-full text-center text-xs text-zinc-500 underline-offset-2 hover:underline"
          onClick={() => {
            setMode(mode === 'password' ? 'email' : 'password');
            setError('');
            setLinkSent(false);
          }}
        >
          {mode === 'password' ? '改用 email 登入（登入後系統會記錄是誰做的操作）' : '改用共用密碼登入'}
        </button>
      </CardContent>
    </Card>
  );
}

export default function LoginPage() {
  return (
    <div>
      <Header title="OHCA Dashboard" />
      <div className="flex min-h-[60vh] items-center justify-center">
        <Suspense fallback={<div className="text-zinc-400">載入中...</div>}>
          <LoginForm />
        </Suspense>
      </div>
    </div>
  );
}
