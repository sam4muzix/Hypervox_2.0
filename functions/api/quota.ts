// Cloudflare API endpoint for Studio Quota & Status
interface Context {
  request: Request;
}

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store, no-cache, must-revalidate',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export const onRequestGet = async (_context: Context): Promise<Response> => {
  return new Response(
    JSON.stringify({
      allowed: true,
      status: 'active',
      tier: 'Hypervox Studio Active',
    }),
    { status: 200, headers: CORS_HEADERS }
  );
};

export const onRequestPost = async (_context: Context): Promise<Response> => {
  return new Response(
    JSON.stringify({
      success: true,
      allowed: true,
      status: 'active',
    }),
    { status: 200, headers: CORS_HEADERS }
  );
};

export const onRequestOptions = async (): Promise<Response> => {
  return new Response(null, {
    status: 204,
    headers: CORS_HEADERS,
  });
};
