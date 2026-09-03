'use client';

import { useEffect } from 'react';
import { preload } from 'swr';
import { useAdminAuth } from '@/hooks/use-admin-auth';
import { AdminLoginCard } from '@/components/admin-login-card';

/**
 * The fetcher the gated pages use: a JSON body, thrown as an error on a
 * non-2xx status so SWR sees a failure rather than an `{error}` object. The
 * preload has to behave the same way, because SWR hands the preloaded promise
 * to the page's hook in place of its own fetcher's first call.
 */
async function fetchJson(url: string) {
  const res = await fetch(url);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

/**
 * Wraps a page whose API needs the manager role.
 *
 * The check here is only about what to render — every route behind it does its
 * own `requireRole`, so a page that guessed wrong shows the wrong screen and
 * never the wrong data.
 *
 * `prefetch` lists the SWR keys the page will ask for. They are requested the
 * moment the gate mounts, in parallel with the auth check, instead of after
 * it: the page used to sit through one round trip to /api/auth before its data
 * request could even start. An unauthenticated visitor's preload fails with a
 * 401 and is discarded along with the page it was for.
 */
export function AdminGate({ children, prefetch = [] }: { children: React.ReactNode; prefetch?: string[] }) {
  const auth = useAdminAuth();

  useEffect(() => {
    for (const key of prefetch) {
      // The rejection surfaces through the page's hook, not here.
      preload(key, fetchJson)?.catch(() => {});
    }
    // Keys are static per page; re-running on a re-render would only add
    // duplicate preloads that SWR ignores anyway.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
