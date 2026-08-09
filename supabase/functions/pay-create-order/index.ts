// pay-create-order：生成下单签名参数（前端浏览器直发 submit.php）
// 原因：易支付校验"域名白名单"看请求来源 Host；若由本 Edge 直发 mapi.php，
//       Host 是 *.functions.supabase.co，会被拒。改为本函数生成签名参数，
//       前端在 jumptool.netlify.app 上以表单 POST 到 submit.php，来源域名匹配白名单。
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
const FUNC_BASE = Deno.env.get('FUNC_BASE') || '';
const SUBMIT_URL = 'https://www.ezfp.cn/submit.php';

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
  const returnUrl = body.return_url || 'https://jumptool.netlify.app/membership.html';

  // 签名参数集（submit.php 用）：KEY 在服务端参与签名，前端不可篡改金额
  const params = buildSubmitParams({
    pid: PID,
    type: provider,
    out_trade_no: orderNo,
    notify_url: notifyUrl,
    return_url: returnUrl,
    name: plan.name,
    money: (plan.price_cents / 100).toFixed(2),
    param: user.user.id
  }, KEY);

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
