// pay-create-order：前端下单入口（需登录 JWT）
// 鉴权：Authorization: Bearer <JWT> 或 Supabase anon key
// 入参：{ plan_id, provider }   provider: alipay | wxpay | qqpay
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { createPayment } from '../_shared/ezfp.js';
import { corsHeaders } from '../_shared/cors.js';

const PID = Deno.env.get('EZFP_PID') || '';
const KEY = Deno.env.get('EZFP_KEY') || '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const FUNC_BASE = Deno.env.get('FUNC_BASE') || '';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (!PID || !KEY) return json({ code: -1, msg: '支付未配置(EZFP_KEY/PID)' }, 500);

  const auth = req.headers.get('Authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '');
  if (!token) return json({ code: -1, msg: '请先登录' }, 401);

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
  const { data: user, error } = await supabase.auth.getUser(token);
  if (error || !user || !user.user) return json({ code: -1, msg: '登录态无效，请重新登录' }, 401);

  let body;
  try { body = await req.json(); } catch { return json({ code: -1, msg: '参数错误' }, 400); }
  const planId = Number(body.plan_id);
  const provider = String(body.provider || '').toLowerCase();
  if (![1, 2, 3, 4].includes(planId)) return json({ code: -1, msg: '套餐不存在' }, 400);
  if (!['alipay', 'wxpay', 'qqpay'].includes(provider)) return json({ code: -1, msg: '支付方式不支持' }, 400);

  const { data: plan } = await supabase.from('plans').select('*').eq('id', planId).maybeSingle();
  if (!plan || !plan.active) return json({ code: -1, msg: '套餐已下架' }, 400);

  const orderNo = 'VT' + Date.now() + Math.floor(Math.random() * 9000 + 1000);
  const { error: orderErr } = await supabase.from('orders').insert({
    user_id: user.user.id,
    plan_id: planId,
    order_no: orderNo,
    provider,
    amount_cents: plan.price_cents,
    status: 'pending'
  });
  if (orderErr) return json({ code: -1, msg: '下单失败: ' + orderErr.message }, 500);

  const notifyUrl = `${FUNC_BASE}/pay-callback`;
  const returnUrl = (body.return_url || `${FUNC_BASE.replace(/\/functions.*$/, '')}`) || '';

  const clientip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || '127.0.0.1';
  const ua = req.headers.get('user-agent') || '';
  let device = 'pc';
  if (/Mobile|Android|iPhone/i.test(ua)) device = 'mobile';
  if (/MicroMessenger/i.test(ua)) device = 'wechat';
  if (/AlipayClient/i.test(ua)) device = 'alipay';

  const params = {
    pid: PID,
    type: provider,
    out_trade_no: orderNo,
    notify_url: notifyUrl,
    return_url: returnUrl,
    name: plan.name,
    money: (plan.price_cents / 100).toFixed(2),
    clientip,
    device,
    param: user.user.id
  };

  const r = await createPayment(params, KEY);
  if (r.code !== 1) {
    // 下单失败：关闭订单
    await supabase.from('orders').update({ status: 'closed' }).eq('order_no', orderNo);
    return json({ code: -1, msg: r.msg || '支付平台下单失败，请稍后再试' }, 502);
  }

  return json({
    code: 1,
    order_no: orderNo,
    provider,
    payurl: r.payurl || '',
    qrcode: r.qrcode || '',
    urlscheme: r.urlscheme || ''
  });
});

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}
