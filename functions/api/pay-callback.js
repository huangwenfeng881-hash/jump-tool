// Cloudflare Pages Function：易支付异步回调代理（替代原 Netlify _redirects 代理）
// 路由：/api/pay-callback → 转发到 Supabase Edge Function pay-callback（验签 + 到账）
// 说明：Cloudflare Pages 的 _redirects 不支持代理外部域名，必须用 Pages Functions。
// 易支付以 GET 发送回调参数（query string），本函数原样转发（保留 query、method、headers）。
const TARGET = 'https://iszxoejqhjpucczfsdfo.supabase.co/functions/v1/pay-callback';

async function proxy(context) {
  const request = context.request;
  const url = new URL(TARGET);
  // 保留原始 query string（验签参数都在里面）
  url.search = new URL(request.url).search;

  const headers = new Headers(request.headers);
  headers.delete('host');
  headers.delete('cf-connecting-ip');
  headers.delete('cf-ray');
  headers.delete('cf-visitor');
  headers.delete('x-forwarded-for');
  headers.delete('x-forwarded-proto');
  headers.delete('x-real-ip');

  const init = { method: request.method, headers, redirect: 'manual' };
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    init.body = await request.arrayBuffer();
  }
  return fetch(url, init);
}

export const onRequestGet = proxy;
export const onRequestPost = proxy;
