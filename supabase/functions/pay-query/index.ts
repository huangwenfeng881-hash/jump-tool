// pay-query：查询订单支付状态（前端轮询兜底）
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { queryOrder } from '../_shared/ezfp.js';
import { corsHeaders } from '../_shared/cors.js';

const PID = Deno.env.get('EZFP_PID') || '';
const KEY = Deno.env.get('EZFP_KEY') || '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const auth = req.headers.get('Authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '');
  if (!token) return json({ code: -1, msg: '请先登录' }, 401);

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
  const { data: user, error } = await supabase.auth.getUser(token);
  if (error || !user || !user.user) return json({ code: -1, msg: '登录态无效' }, 401);

  let body;
  try { body = await req.json(); } catch { return json({ code: -1, msg: '参数错误' }, 400); }
  const orderNo = String(body.order_no || '');
  if (!orderNo) return json({ code: -1, msg: '缺少订单号' }, 400);

  // 只允许查询本人的订单
  const { data: order } = await supabase.from('orders')
    .select('*').eq('order_no', orderNo).eq('user_id', user.user.id).maybeSingle();
  if (!order) return json({ code: -1, msg: '订单不存在' }, 404);

  // 本地已到账则直接返回
  if (order.status === 'paid') return json({ code: 1, status: 'paid', pay_code: order.pay_code });

  // 主动向易支付查一次（超时兜底），仍未支付则返回当前状态
  try {
    const q = await queryOrder(orderNo, PID, KEY);
    if (q && q.code === 1 && q.status === 1) {
      const { data } = await supabase.rpc('finalize_payment', {
        p_order_no: orderNo,
        p_trade_no: String(q.trade_no || ''),
        p_amount_cents: order.amount_cents
      });
      if (data && data[0] && data[0].ok) return json({ code: 1, status: 'paid', pay_code: data[0].pay_code });
    }
  } catch (e) {
    console.error('queryOrder failed:', e.message);
  }

  return json({ code: 1, status: order.status });
});

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}
