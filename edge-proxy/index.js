const API_PREFIX = '/api';

function jsonResponse(body, status = 500) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

export default {
  async fetch(request) {
    const { env } = await import('alibaba:workers');
    const incomingUrl = new URL(request.url);
    if (
      incomingUrl.pathname !== API_PREFIX &&
      !incomingUrl.pathname.startsWith(`${API_PREFIX}/`)
    ) {
      return jsonResponse({ error: 'Not found' }, 404);
    }

    const origin = env.FC_ORIGIN_URL;
    const bearerToken = env.FC_BEARER_TOKEN;
    if (!origin || !bearerToken) {
      return jsonResponse({ error: 'Proxy configuration missing' }, 500);
    }

    let targetUrl;
    try {
      const parsedOrigin = new URL(origin);
      if (parsedOrigin.protocol !== 'https:') {
        return jsonResponse({ error: 'Invalid upstream protocol' }, 500);
      }
      targetUrl = new URL(
        `${incomingUrl.pathname}${incomingUrl.search}`,
        `${parsedOrigin.origin}/`,
      );
    } catch {
      return jsonResponse({ error: 'Invalid upstream URL' }, 500);
    }

    const headers = new Headers(request.headers);
    headers.delete('host');
    headers.delete('content-length');
    headers.delete('connection');
    headers.delete('keep-alive');
    headers.set('authorization', `Bearer ${bearerToken}`);
    headers.set('x-forwarded-host', incomingUrl.host);
    headers.set('x-forwarded-proto', 'https');
    headers.set('x-lilyplan-proxy', 'esa');

    const requestInit = {
      method: request.method,
      headers,
      redirect: 'manual',
    };
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      requestInit.body = request.body;
    }

    try {
      const upstream = await fetch(new Request(targetUrl.toString(), requestInit));
      const responseHeaders = new Headers(upstream.headers);
      responseHeaders.set('cache-control', 'private, no-store');
      if (incomingUrl.pathname === '/api/report/html') {
        responseHeaders.delete('content-disposition');
      }
      return new Response(upstream.body, {
        status: upstream.status,
        statusText: upstream.statusText,
        headers: responseHeaders,
      });
    } catch {
      return jsonResponse({ error: 'Backend temporarily unavailable' }, 502);
    }
  },
};
