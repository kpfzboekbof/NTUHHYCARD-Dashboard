'use client';

import { useState, useCallback, useEffect, useRef } from 'react';

interface AdminAuthState {
  authenticated: boolean | null;
  password: string;
  otp: string;
  otpRequired: boolean;
  otpEmail: string;
  otpCountdown: number;
  authError: string;
  authLoading: boolean;
  otpInputRef: React.RefObject<HTMLInputElement | null>;

  setPassword: (v: string) => void;
  setOtp: (v: string) => void;
  handleLogin: () => Promise<void>;
  handleVerifyOtp: () => Promise<void>;
  handleLogout: () => Promise<void>;
  handleBackToPassword: () => void;
}

export function useAdminAuth(): AdminAuthState {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [password, setPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [otpRequired, setOtpRequired] = useState(false);
  const [otpEmail, setOtpEmail] = useState('');
  const [otpCountdown, setOtpCountdown] = useState(0);
  const [authError, setAuthError] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const otpInputRef = useRef<HTMLInputElement>(null);

  // Check auth on mount
  useEffect(() => {
    fetch('/api/auth').then(r => r.json()).then(d => setAuthenticated(d.authenticated));
  }, []);

  // OTP countdown timer
  useEffect(() => {
    if (otpCountdown <= 0) return;
    const timer = setInterval(() => {
      setOtpCountdown(prev => {
        if (prev <= 1) { clearInterval(timer); return 0; }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [otpCountdown]);

  // Focus OTP input when shown
  useEffect(() => {
    if (otpRequired && otpInputRef.current) {
      otpInputRef.current.focus();
    }
  }, [otpRequired]);

  const handleLogin = useCallback(async () => {
    setAuthLoading(true);
    setAuthError('');
    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const data = await res.json();
      if (res.ok && data.requireOtp) {
        setOtpRequired(true);
        setOtpEmail(data.email || '');
        setOtpCountdown(300);
        setPassword('');
      } else if (res.ok && data.ok) {
        setAuthenticated(true);
        setPassword('');
      } else {
        setAuthError(data.error || '登入失敗');
      }
    } finally {
      setAuthLoading(false);
    }
  }, [password]);

  const handleVerifyOtp = useCallback(async () => {
    setAuthLoading(true);
    setAuthError('');
    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ otp }),
      });
      const data = await res.json();
      if (res.ok) {
        setAuthenticated(true);
        setOtp('');
        setOtpRequired(false);
      } else {
        setAuthError(data.error || '驗證失敗');
      }
    } finally {
      setAuthLoading(false);
    }
  }, [otp]);

  const handleLogout = useCallback(async () => {
    await fetch('/api/auth', { method: 'DELETE' });
    setAuthenticated(false);
    setOtpRequired(false);
    setOtp('');
  }, []);

  const handleBackToPassword = useCallback(() => {
    setOtpRequired(false);
    setOtp('');
    setAuthError('');
  }, []);

  return {
    authenticated,
    password,
    otp,
    otpRequired,
    otpEmail,
    otpCountdown,
    authError,
    authLoading,
    otpInputRef,
    setPassword,
    setOtp,
    handleLogin,
    handleVerifyOtp,
    handleLogout,
    handleBackToPassword,
  };
}
