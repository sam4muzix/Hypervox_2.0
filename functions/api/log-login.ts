// Cloudflare Pages Function: Logs all user logins on the backend to KV and forwards to Google Sheets/Email
interface Env {
  HYPERVOX_QUOTA?: {
    get: (key: string) => Promise<string | null>;
    put: (key: string, value: string, options?: { expirationTtl?: number }) => Promise<void>;
    list: (options?: { prefix?: string; limit?: number }) => Promise<{ keys: { name: string }[] }>;
  };
  GOOGLE_SHEET_WEBHOOK_URL?: string;
}

interface Context {
  request: Request;
  env: Env;
}

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store, no-cache, must-revalidate',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const getClientIp = (request: Request): string => {
  const cfIp = request.headers.get('cf-connecting-ip');
  if (cfIp) return cfIp.trim();
  const xReal = request.headers.get('x-real-ip');
  if (xReal) return xReal.trim();
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return 'unknown_client';
};

export const onRequestPost = async (context: Context): Promise<Response> => {
  try {
    const data = (await context.request.json()) as any;
    const ip = getClientIp(context.request);

    const loginRecord = {
      timestamp: data.timestamp || new Date().toISOString(),
      date: data.date || new Date().toLocaleDateString('en-US'),
      time: data.time || new Date().toLocaleTimeString('en-US'),
      name: data.name || 'Anonymous User',
      email: data.email || 'N/A',
      userId: data.userId || 'N/A',
      picture: data.picture || '',
      ip,
      userAgent: data.userAgent || context.request.headers.get('user-agent') || 'Unknown',
      app: 'Hypervox AI Studio',
    };

    // 1. Store in Cloudflare KV (Backend persistence, 90 days retention)
    if (context.env.HYPERVOX_QUOTA) {
      try {
        const key = `login:${Date.now()}:${ip.replace(/[^a-zA-Z0-9]/g, '_')}`;
        await context.env.HYPERVOX_QUOTA.put(key, JSON.stringify(loginRecord), {
          expirationTtl: 86400 * 90,
        });
      } catch (err) {
        console.error('[log-login] Error saving to KV:', err);
      }
    }

    // 2. Forward to Backend Google Sheet Webhook
    const webhookUrl =
      context.env.GOOGLE_SHEET_WEBHOOK_URL ||
      'https://script.google.com/macros/s/AKfycbxIOmMomwe1dJ5bB7O986BAm3B3EZIEuQSgzKygaFkl_rDbWgfyDNIrZXqpwiszihUpvA/exec';
    if (webhookUrl) {
      try {
        await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify(loginRecord),
        });
      } catch (err) {
        console.error('[log-login] Error posting to backend Google Sheet webhook:', err);
      }
    }

    // 3. Backend automatic email notification / table logging backup
    try {
      const formData = new FormData();
      formData.append('_subject', `[Hypervox Login] ${loginRecord.name} (${loginRecord.email})`);
      formData.append('_template', 'table');
      formData.append('_captcha', 'false');
      formData.append('User Name', loginRecord.name);
      formData.append('Email Address', loginRecord.email);
      formData.append('Login Timestamp', loginRecord.timestamp);
      formData.append('Client IP', loginRecord.ip);
      formData.append('User Agent', loginRecord.userAgent);

      context.request.headers.get('host'); // keep active
      fetch('https://formsubmit.co/ajax/admin@greenmixlabs.com', {
        method: 'POST',
        body: formData,
        headers: { Accept: 'application/json' },
      }).catch(() => {});
    } catch {
      // Ignore background notification errors
    }

    return new Response(
      JSON.stringify({
        success: true,
        logged: loginRecord,
      }),
      { status: 200, headers: CORS_HEADERS }
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: err.message || 'Failed to log login event' }),
      { status: 500, headers: CORS_HEADERS }
    );
  }
};

export const onRequestGet = async (context: Context): Promise<Response> => {
  const url = new URL(context.request.url);
  const format = url.searchParams.get('format') || 'json';
  const ip = getClientIp(context.request);
  let logins: any[] = [];

  if (context.env.HYPERVOX_QUOTA && typeof context.env.HYPERVOX_QUOTA.list === 'function') {
    try {
      const list = await context.env.HYPERVOX_QUOTA.list({ prefix: 'login:', limit: 100 });
      for (const item of list.keys.reverse()) {
        const raw = await context.env.HYPERVOX_QUOTA.get(item.name);
        if (raw) {
          try {
            logins.push(JSON.parse(raw));
          } catch {
            // Ignore
          }
        }
      }
    } catch (err) {
      console.error('[log-login] Error reading KV list:', err);
    }
  }

  // 1. CSV format (can be directly imported into Google Sheets via =IMPORTDATA("https://greenmixlabs.com/api/log-login?format=csv"))
  if (format === 'csv') {
    const csvHeader = 'Timestamp,Date,Time,Name,Email,IP,UserAgent\n';
    const csvRows = logins
      .map(
        (l) =>
          `"${l.timestamp}","${l.date}","${l.time}","${(l.name || '').replace(/"/g, '""')}","${(l.email || '').replace(/"/g, '""')}","${l.ip}","${(l.userAgent || '').replace(/"/g, '""')}"`
      )
      .join('\n');

    return new Response(csvHeader + csvRows, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Cache-Control': 'no-cache',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  }

  // 2. HTML online spreadsheet format
  if (format === 'html') {
    const tableRows = logins
      .map(
        (l, i) => `
        <tr style="border-bottom: 1px solid #222;">
          <td style="padding: 10px 14px; font-family: monospace; color: #888;">${i + 1}</td>
          <td style="padding: 10px 14px; font-weight: bold; color: #fff;">${l.name}</td>
          <td style="padding: 10px 14px; color: #00FF88;">${l.email}</td>
          <td style="padding: 10px 14px; color: #aaa;">${l.date} ${l.time}</td>
          <td style="padding: 10px 14px; font-family: monospace; color: #00E5FF;">${l.ip}</td>
        </tr>`
      )
      .join('');

    const html = `<!DOCTYPE html>
    <html>
      <head>
        <title>Hypervox Logins Online Sheet</title>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #050505; color: #eee; margin: 0; padding: 32px; }
          .container { max-width: 1000px; margin: 0 auto; }
          h1 { color: #fff; font-size: 24px; margin-bottom: 8px; }
          p { color: #888; font-size: 13px; margin-bottom: 24px; }
          table { width: 100%; border-collapse: collapse; background: #0c0c0c; border: 1px solid #222; border-radius: 8px; overflow: hidden; }
          th { text-align: left; padding: 12px 14px; background: #141414; color: #00FF88; font-size: 12px; text-transform: uppercase; letter-spacing: 0.1em; border-bottom: 1px solid #222; }
          .btn { display: inline-block; background: #00FF88; color: #000; padding: 8px 16px; font-weight: bold; text-decoration: none; border-radius: 6px; font-size: 12px; margin-bottom: 16px; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>Hypervox Studio // Live Login Sheet</h1>
          <p>Real-time backend audit of all user sign-ins. Synchronized automatically with Cloudflare KV.</p>
          <a href="/api/log-login?format=csv" class="btn">Download / Export CSV</a>
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Name</th>
                <th>Email</th>
                <th>Date &amp; Time</th>
                <th>IP Address</th>
              </tr>
            </thead>
            <tbody>
              ${tableRows || '<tr><td colspan="5" style="padding: 20px; text-align: center; color: #666;">No logins recorded yet.</td></tr>'}
            </tbody>
          </table>
        </div>
      </body>
    </html>`;

    return new Response(html, {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
      },
    });
  }

  // 3. Default JSON response
  return new Response(
    JSON.stringify({
      callerIp: ip,
      count: logins.length,
      recentLogins: logins,
    }),
    { status: 200, headers: CORS_HEADERS }
  );
};

export const onRequestOptions = async (): Promise<Response> => {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
};
