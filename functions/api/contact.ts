// Cloudflare API Endpoint: Contact Inquiries
// Persists inquiries to Cloudflare KV and forwards to admin@greenmixlabs.com

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
  env?: Env;
}

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store, no-cache, must-revalidate',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Accept',
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
    const contentType = context.request.headers.get('content-type') || '';
    let name = '';
    let email = '';
    let subject = 'New Inquiry - Greenmix Labs';
    let message = '';
    let inquiryType = 'General / Collaboration';
    let rawPayload: any = {};

    if (contentType.includes('application/json')) {
      rawPayload = await context.request.json().catch(() => ({}));
      name = rawPayload.name || rawPayload['User Name'] || '';
      email = rawPayload.email || rawPayload['Email Address'] || '';
      subject = rawPayload.subject || rawPayload._subject || subject;
      message = rawPayload.message || rawPayload['Message'] || '';
      inquiryType = rawPayload.inquiryType || rawPayload.serviceType || inquiryType;
    } else {
      const formData = await context.request.formData().catch(() => new FormData());
      name = (formData.get('name') || formData.get('User Name') || '').toString();
      email = (formData.get('email') || formData.get('Email Address') || '').toString();
      subject = (formData.get('_subject') || formData.get('subject') || subject).toString();
      message = (formData.get('message') || formData.get('Message') || '').toString();
      inquiryType = (formData.get('inquiryType') || formData.get('serviceType') || inquiryType).toString();
      formData.forEach((value, key) => {
        rawPayload[key] = value.toString();
      });
    }

    const ip = getClientIp(context.request);
    const now = new Date();
    const inquiryRecord = {
      timestamp: now.toISOString(),
      date: now.toLocaleDateString('en-US'),
      time: now.toLocaleTimeString('en-US'),
      name: name.trim() || 'Anonymous Client',
      email: email.trim() || 'unknown@greenmixlabs.com',
      subject: subject.trim(),
      message: message.trim(),
      inquiryType,
      ip,
      userAgent: context.request.headers.get('user-agent') || 'Unknown',
    };

    // 1. Store in Cloudflare KV (365 days retention)
    if (context.env?.HYPERVOX_QUOTA) {
      try {
        const key = `inquiry:${Date.now()}:${ip.replace(/[^a-zA-Z0-9]/g, '_')}`;
        await context.env.HYPERVOX_QUOTA.put(key, JSON.stringify(inquiryRecord), {
          expirationTtl: 86400 * 365,
        });
      } catch (err) {
        console.error('[contact-api] KV storage failed:', err);
      }
    }

    // 2. Trigger FormSubmit to deliver to admin@greenmixlabs.com
    try {
      const formBody = new FormData();
      formBody.append('_subject', `[Greenmix Contact] ${inquiryRecord.name} (${inquiryRecord.email})`);
      formBody.append('_template', 'table');
      formBody.append('_captcha', 'false');
      formBody.append('Client Name', inquiryRecord.name);
      formBody.append('Email Address', inquiryRecord.email);
      formBody.append('Inquiry Type', inquiryRecord.inquiryType);
      formBody.append('Subject', inquiryRecord.subject);
      formBody.append('Message Content', inquiryRecord.message || 'No written message provided.');
      formBody.append('Timestamp', inquiryRecord.timestamp);
      formBody.append('Client IP', inquiryRecord.ip);

      fetch('https://formsubmit.co/ajax/admin@greenmixlabs.com', {
        method: 'POST',
        body: formBody,
        headers: { Accept: 'application/json' },
      }).catch(() => {});
    } catch {
      // Ignore background notification errors
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Inquiry successfully transmitted and saved.',
        record: {
          timestamp: inquiryRecord.timestamp,
          name: inquiryRecord.name,
          email: inquiryRecord.email,
        },
      }),
      { status: 200, headers: CORS_HEADERS }
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({
        success: false,
        error: err.message || 'Failed to process inquiry submission.',
      }),
      { status: 500, headers: CORS_HEADERS }
    );
  }
};

export const onRequestGet = async (context: Context): Promise<Response> => {
  const url = new URL(context.request.url);
  const format = url.searchParams.get('format') || 'json';
  const ip = getClientIp(context.request);
  let inquiries: any[] = [];

  if (context.env?.HYPERVOX_QUOTA && typeof context.env.HYPERVOX_QUOTA.list === 'function') {
    try {
      const list = await context.env.HYPERVOX_QUOTA.list({ prefix: 'inquiry:', limit: 100 });
      for (const item of list.keys.reverse()) {
        const raw = await context.env.HYPERVOX_QUOTA.get(item.name);
        if (raw) {
          try {
            inquiries.push(JSON.parse(raw));
          } catch {
            // Ignore
          }
        }
      }
    } catch (err) {
      console.error('[contact-api] Error reading KV list:', err);
    }
  }

  if (format === 'csv') {
    const csvHeader = 'Timestamp,Date,Time,Name,Email,Type,Subject,Message,IP\n';
    const csvRows = inquiries
      .map(
        (i) =>
          `"${i.timestamp}","${i.date}","${i.time}","${(i.name || '').replace(/"/g, '""')}","${(i.email || '').replace(/"/g, '""')}","${(i.inquiryType || '').replace(/"/g, '""')}","${(i.subject || '').replace(/"/g, '""')}","${(i.message || '').replace(/"/g, '""')}","${i.ip}"`
      )
      .join('\n');

    return new Response(csvHeader + csvRows, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-cache',
      },
    });
  }

  return new Response(
    JSON.stringify({
      callerIp: ip,
      count: inquiries.length,
      inquiries,
    }),
    { status: 200, headers: CORS_HEADERS }
  );
};

export const onRequestOptions = async (): Promise<Response> => {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
};
