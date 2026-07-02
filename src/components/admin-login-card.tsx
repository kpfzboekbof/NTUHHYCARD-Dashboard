'use client';

import { Lock } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import type { useAdminAuth } from '@/hooks/use-admin-auth';

type AuthState = ReturnType<typeof useAdminAuth>;

interface AdminLoginCardProps {
  auth: Pick<AuthState,
    'password' | 'otp' | 'otpRequired' | 'otpEmail' | 'otpCountdown' |
    'authError' | 'authLoading' | 'otpInputRef' |
    'setPassword' | 'setOtp' |
    'handleLogin' | 'handleVerifyOtp' | 'handleBackToPassword'
  >;
}

export function AdminLoginCard({ auth }: AdminLoginCardProps) {
  const {
    password, otp, otpRequired, otpEmail, otpCountdown,
    authError, authLoading, otpInputRef,
    setPassword, setOtp,
    handleLogin, handleVerifyOtp, handleBackToPassword,
  } = auth;

  return (
    <Card className="w-80">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Lock className="h-5 w-5" />
          {otpRequired ? '兩步驟驗證' : '管理員登入'}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {!otpRequired ? (
          <form
            className="space-y-4"
            onSubmit={e => { e.preventDefault(); handleLogin(); }}
          >
            <input
              type="password"
              className="w-full rounded border px-3 py-2 text-sm disabled:opacity-50"
              placeholder="請輸入管理員密碼"
              value={password}
              onChange={e => setPassword(e.target.value)}
              disabled={authLoading}
              autoFocus
            />
            {authError && <p className="text-sm text-red-500">{authError}</p>}
            <Button type="submit" className="w-full" disabled={authLoading || !password}>
              {authLoading ? '驗證中...' : '登入'}
            </Button>
          </form>
        ) : (
          <form
            className="space-y-4"
            onSubmit={e => { e.preventDefault(); handleVerifyOtp(); }}
          >
            <p className="text-sm text-zinc-500">
              驗證碼已寄至 <span className="font-medium text-zinc-700">{otpEmail}</span>
            </p>
            <input
              ref={otpInputRef}
              type="text"
              inputMode="numeric"
              maxLength={6}
              className="w-full rounded border px-3 py-2 text-center text-lg font-bold tracking-[0.5em] disabled:opacity-50"
              placeholder="000000"
              value={otp}
              onChange={e => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
              disabled={authLoading}
            />
            {authError && <p className="text-sm text-red-500">{authError}</p>}
            <Button type="submit" className="w-full" disabled={authLoading || otp.length !== 6}>
              {authLoading ? '驗證中...' : '驗證'}
            </Button>
            <div className="flex items-center justify-between text-xs text-zinc-400">
              <button
                type="button"
                className="text-blue-600 hover:underline"
                onClick={handleBackToPassword}
              >
                返回
              </button>
              <span>
                {otpCountdown > 0
                  ? `${Math.floor(otpCountdown / 60)}:${(otpCountdown % 60).toString().padStart(2, '0')}`
                  : '驗證碼已過期'}
              </span>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
