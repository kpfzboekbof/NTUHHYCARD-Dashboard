'use client';

import { useAdminAuth } from '@/hooks/use-admin-auth';
import { AdminLoginCard } from '@/components/admin-login-card';

/**
 * Wraps a page whose API needs the manager role.
 *
 * The check here is only about what to render — every route behind it does its
 * own `requireRole`, so a page that guessed wrong shows the wrong screen and
 * never the wrong data.
 */
export function AdminGate({ children }: { children: React.ReactNode }) {
  const auth = useAdminAuth();

  if (auth.authenticated === null) {
    return <div className="flex h-screen items-center justify-center text-zinc-500">驗證中...</div>;
  }
  if (!auth.authenticated) {
    return (
      <div className="flex h-screen items-center justify-center">
        <AdminLoginCard auth={auth} />
      </div>
    );
  }
  return <>{children}</>;
}
