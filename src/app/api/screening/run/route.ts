import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { exec } from 'child_process';
import path from 'path';

/** Verify admin auth */
async function isAuthenticated(): Promise<boolean> {
  const adminPw = process.env.ADMIN_PASSWORD || '';
  if (!adminPw) return false;
  const data = `${adminPw}-ohca-admin-salt`;
  let hash = 0;
  for (let i = 0; i < data.length; i++) {
    hash = ((hash << 5) - hash) + data.charCodeAt(i);
    hash |= 0;
  }
  const expected = Math.abs(hash).toString(36);
  const cookieStore = await cookies();
  const token = cookieStore.get('admin_token')?.value;
  return token === expected;
}

/**
 * POST /api/screening/run
 *
 * 觸發 Python scraper 執行 OHCA 篩選。
 * Body: { date?: "YYYY/MM/DD", site?: "hsinchu" }
 */
export async function POST(request: NextRequest) {
  if (!await isAuthenticated()) {
    return NextResponse.json({ error: '未授權' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const date = body.date || new Date().toISOString().slice(0, 10).replace(/-/g, '/');
  const site = body.site || '';

  const scraperDir = process.env.SCRAPER_DIR || path.join(process.cwd(), '..', 'scraper');
  const python = process.env.PYTHON_PATH || 'python3';

  let cmd = `cd "${scraperDir}" && ${python} main.py --date "${date}"`;
  if (site) {
    cmd += ` --site "${site}"`;
  }

  // 傳遞院區帳號密碼的環境變數
  const envVars = [
    'NTUH_HSINCHU_USERNAME', 'NTUH_HSINCHU_PASSWORD',
    'NTUH_MAIN_USERNAME', 'NTUH_MAIN_PASSWORD',
    'NTUH_BIO_USERNAME', 'NTUH_BIO_PASSWORD',
    'NTUH_YUNLIN_USERNAME', 'NTUH_YUNLIN_PASSWORD',
  ];

  const env = { ...process.env };
  for (const key of envVars) {
    if (process.env[key]) {
      env[key] = process.env[key];
    }
  }

  return new Promise<NextResponse>((resolve) => {
    exec(cmd, { env, timeout: 600000 }, (error, stdout, stderr) => {
      if (error) {
        console.error('[screening/run] Error:', error.message);
        console.error('[screening/run] Stderr:', stderr);
        resolve(NextResponse.json({
          ok: false,
          error: error.message,
          stdout: stdout.slice(-2000),
          stderr: stderr.slice(-2000),
        }, { status: 500 }));
      } else {
        console.log('[screening/run] Done:', stdout.slice(-500));
        resolve(NextResponse.json({
          ok: true,
          date,
          stdout: stdout.slice(-2000),
        }));
      }
    });
  });
}
