// Cloudflare Worker entry point for greenmixlabs.com
import { onRequestGet as getQuota, onRequestPost as postQuota, onRequestOptions as optionsQuota } from './functions/api/quota';
import { onRequestGet as getLogLogin, onRequestPost as postLogLogin, onRequestOptions as optionsLogLogin } from './functions/api/log-login';
import { onRequestGet as getContact, onRequestPost as postContact, onRequestOptions as optionsContact } from './functions/api/contact';

export interface Env {
  HYPERVOX_QUOTA?: any;
  GOOGLE_SHEET_WEBHOOK_URL?: string;
  ASSETS: {
    fetch: (request: Request) => Promise<Response>;
  };
}

export default {
  async fetch(request: Request, env: Env, _ctx: any): Promise<Response> {
    const url = new URL(request.url);
    const pathname = url.pathname;

    // 1. Quota API
    if (pathname === '/api/quota') {
      if (request.method === 'OPTIONS') return optionsQuota();
      if (request.method === 'POST') return postQuota({ request });
      return getQuota({ request });
    }

    // 2. Log-Login API
    if (pathname === '/api/log-login') {
      if (request.method === 'OPTIONS') return optionsLogLogin();
      if (request.method === 'POST') return postLogLogin({ request, env });
      return getLogLogin({ request, env });
    }

    // 3. Contact Form API
    if (pathname === '/api/contact') {
      if (request.method === 'OPTIONS') return optionsContact();
      if (request.method === 'POST') return postContact({ request, env });
      return getContact({ request, env });
    }

    // 4. Fallback to static assets
    return env.ASSETS.fetch(request);
  },
};
