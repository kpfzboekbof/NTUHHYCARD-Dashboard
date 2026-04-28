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
          <div className="space-y-4">
            <input
              type="password"
              className="w-full rounded border px-3 py-2 text-sm"
              placeholder="請輸入管理員密碼"
              value={password}
              onChange={e => setPassword(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleLogin()}
              autoFocus
            />
            {authError && <p className="text-sm text-red-500">{authError}</p>}
            <Button className="w-full" onClick={handleLogin} disabled={authLoading || !password}>
              {authLoading ? '驗證中...' : '登入'}
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-zinc-500">
              驗證碼已寄至 <span className="font-medium text-zinc-700">{otpEmail}</span>
            </p>
            <input
              ref={otpInputRef}
              type="text"
              inputMode="numeric"
              maxLength={6}
              className="w-full rounded border px-3 py-2 text-center text-lg font-bold tracking-[0.5em]"
              placeholder="000000"
              value={otp}
              onChange={e => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
              onKeyDown={e => e.key === 'Enter' && otp.length === 6 && handleVerifyOtp()}
            />
            {authError && <p className="text-sm text-red-500">{authError}</p>}
            <Button className="w-full" onClick={handleVerifyOtp} disabled={authLoading || otp.length !== 6}>
              {authLoading ? '驗證中...' : '驗證'}
            </Button>
            <div className="flex items-center justify-between text-xs text-zinc-400">
              <button
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
          </div>
        )}
      </CardContent>
    </Card>
  );
}
