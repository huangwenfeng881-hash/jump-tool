// pay-create-order：生成下单签名参数（前端浏览器直发 submit.php）
// 原因：易支付校验两个域名维度——
//   1) 请求来源域名：前端表单从 jumptool.netlify.app 直发 submit.php，匹配白名单；
//   2) notify_url 域名：也必须在白名单内，因此回调统一走 Netlify 代理
//      https://jumptool.netlify.app/api/pay-callback → 转发到本 Supabase 回调函数。
// 安全：EZFP_KEY 只在本函数（服务端）内参与签名，前端拿到的仅签名参数（sign 已算好）。
// 鉴权：Authorization: Bearer <JWT>
// 入参：{ plan_id, provider }   provider: alipay | wxpay | qqpay
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { buildSubmitParams } from '../_shared/ezfp.js';
import { corsHeaders } from '../_shared/cors.js';

const PID = Deno.env.get('EZFP_PID') || '';
const KEY = Deno.env.get('EZFP_KEY') || '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const SUBMIT_URL = 'https://www.ezfp.cn/submit.php';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (!PID || !KEY) return json({ code: -1, msg: '支付未配置(EZFP_KEY/PID)' }, 500);
  console.log('[pay-create-order] PID?', !!PID, 'KEY?', !!KEY);

  const auth = req.headers.get('Authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '');
  if (!token) return json({ code: -1, msg: '请先登录' }, 401);
  console.log('[pay-create-order] has token', !!token);

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
  const { data: user, error } = await supabase.auth.getUser(token);
  if (error || !user || !user.user) return json({ code: -1, msg: '登录态无效，请重新登录' }, 401);
  console.log('[pay-create-order] user', user.user.id);

  let body;
  try { body = await req.json(); } catch { return json({ code: -1, msg: '参数错误' }, 400); }
  const planId = Number(body.plan_id);
  const provider = String(body.provider || '').toLowerCase();
  console.log('[pay-create-order] planId', planId, 'provider', provider);
  if (![1, 2, 3, 4].includes(planId)) return json({ code: -1, msg: '套餐不存在' }, 400);
  if (!['alipay', 'wxpay', 'qqpay'].includes(provider)) return json({ code: -1, msg: '支付方式不支持' }, 400);

  const { data: plan } = await supabase.from('plans').select('*').eq('id', planId).maybeSingle();
  if (!plan || !plan.active) return json({ code: -1, msg: '套餐已下架' }, 400);
  console.log('[pay-create-order] plan', plan && plan.name, plan && plan.price_cents);

  const orderNo = 'VT' + Date.now() + Math.floor(Math.random() * 9000 + 1000);
  const { error: orderErr } = await supabase.from('orders').insert({
    user_id: user.user.id,
    plan_id: planId,
    order_no: orderNo,
    provider,
    amount_cents: plan.price_cents,
    status: 'pending'
  });
  if (orderErr) { console.error('[pay-create-order] insert order error', orderErr.message); return json({ code: -1, msg: '下单失败: ' + orderErr.message }, 500); }
  console.log('[pay-create-order] order created', orderNo);

  // 易支付校验 notify_url 域名必须在商户后台「授权支付域名」列表中，
  // 因此回调统一走 Netlify 代理：https://jumptool.netlify.app/api/pay-callback
  const notifyUrl = 'https://jumptool.netlify.app/api/pay-callback';
  const returnUrl = body.return_url || 'https://jumptool.netlify.app/membership.html';

  // 签名参数集（submit.php 用）：KEY 在服务端参与签名，前端不可篡改金额
  let params;
  try {
    params = buildSubmitParams({
      pid: PID,
      type: provider,
      out_trade_no: orderNo,
      notify_url: notifyUrl,
      return_url: returnUrl,
      name: plan.name,
      money: (plan.price_cents / 100).toFixed(2),
      param: user.user.id
    }, KEY);
  } catch (e) {
    console.error('[pay-create-order] buildSubmitParams error', e.message);
    return json({ code: -1, msg: '下单失败: 签名错误' }, 500);
  }
  console.log('[pay-create-order] params built', Object.keys(params).join(','));

  return json({
    code: 1,
    order_no: orderNo,
    provider,
    action: SUBMIT_URL,
    params: params
  });
});

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}
