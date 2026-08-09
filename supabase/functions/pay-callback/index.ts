// pay-callback：易支付异步通知（--no-verify-jwt 部署）
// 易支付以 GET 发送参数，验签通过后返回纯文本 success
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { verify } from '../_shared/ezfp.js';

const KEY = Deno.env.get('EZFP_KEY') || '';
const PID = Deno.env.get('EZFP_PID') || '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const params = {};
  url.searchParams.forEach((v, k) => { params[k] = v; });

  // 验签（EZFP 算法：去除 sign/sign_type/空值后 ASCII 排序拼接 + KEY）
  if (!verify(params, KEY)) {
    return new Response('FAIL', { status: 200 });
  }
  if (params.trade_status !== 'TRADE_SUCCESS') {
    return new Response('FAIL', { status: 200 });
  }
  if (String(params.pid) !== String(PID)) {
    return new Response('FAIL', { status: 200 });
  }

  const orderNo = params.out_trade_no || '';
  const tradeNo = params.trade_no || '';
  const amountCents = Math.round((parseFloat(params.money || '0') || 0) * 100);

  if (!orderNo) return new Response('FAIL', { status: 200 });

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
  // 调 RPC：幂等到账（内部校验金额 + 行锁）
  const { data, error } = await supabase.rpc('finalize_payment', {
    p_order_no: orderNo,
    p_trade_no: tradeNo,
    p_amount_cents: amountCents
  });

  if (error) {
    console.error('finalize_payment error:', error.message);
    return new Response('FAIL', { status: 200 });
  }
  const res = data && data[0];
  if (!res || !res.ok) {
    console.error('finalize_payment rejected:', JSON.stringify(res));
    return new Response('FAIL', { status: 200 });
  }
  // 已支付(幂等)也返回 success，易支付才不会重复推送
  return new Response('success', { status: 200 });
});
