'use client';

import { useState, useCallback, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Lock } from 'lucide-react';
import { Header } from '@/components/layout/header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const from = searchParams.get('from') || '/';

  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/user-auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const d = await res.json();
      if (res.ok) {
        // Navigate to the originally requested path
        router.replace(from);
        router.refresh();
      } else {
        setError(d.error || '登入失敗');
      }
    } catch {
      setError('登入失敗');
    } finally {
      setLoading(false);
    }
  }, [password, router, from]);

  return (
    <Card className="w-80">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Lock className="h-5 w-5" />
          請輸入使用者密碼
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <input
            type="password"
            className="w-full rounded border px-3 py-2 text-sm"
            placeholder="使用者密碼"
            value={password}
            onChange={e => setPassword(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleLogin()}
            autoFocus
          />
          {error && <p className="text-sm text-red-500">{error}</p>}
          <Button className="w-full" onClick={handleLogin} disabled={loading || !password}>
            {loading ? '登入中...' : '登入'}
          </Button>
        </div>
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
