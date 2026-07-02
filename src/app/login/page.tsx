'use client';

import { useState, useCallback, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { Lock } from 'lucide-react';
import { Header } from '@/components/layout/header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

/**
 * Only allow same-site absolute paths as the post-login destination.
 * Anything else (`//evil.com`, `javascript:…`, relative paths) falls back
 * to `/` — the redirect target must never be an unsanitized URL.
 */
function safeRedirectPath(raw: string | null): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//')) return '/';
  return raw;
}

function LoginForm() {
  const searchParams = useSearchParams();
  const from = safeRedirectPath(searchParams.get('from'));

  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
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

  return (
    <Card className="w-80">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Lock className="h-5 w-5" />
          請輸入使用者密碼
        </CardTitle>
      </CardHeader>
      <CardContent>
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
