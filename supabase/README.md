# Vertrise 付费系统部署指南

## 1. 建表 + RPC + RLS
打开 Supabase 控制台 → SQL Editor → 执行 `supabase-pay.sql`（项目: iszxoejqhjpucczfsdfo）。

## 2. 安装 Supabase CLI
```
npm i -g supabase
supabase login
```

## 3. 注入密钥（Edge Function 环境变量）
```
supabase link --project-ref iszxoejqhjpucczfsdfo
supabase secrets set EZFP_PID=4962
supabase secrets set EZFP_KEY=DCAHddVz2ZlZLVleV2l9apCAE9vZhGla
supabase secrets set FUNC_BASE=https://iszxoejqhjpucczfsdfo.functions.supabase.co
```
> EZFP_KEY 为支付商户密钥，严禁写入任何前端/仓库文件。FUNC_BASE 是回调域名前缀。

## 4. 部署 Edge Functions
```
cd supabase
supabase functions deploy pay-create-order --project-ref iszxoejqhjpucczfsdfo
supabase functions deploy pay-callback --project-ref iszxoejqhjpucczfsdfo --no-verify-jwt
supabase functions deploy pay-query --project-ref iszxoejqhjpucczfsdfo
```
`pay-callback` 必须 `--no-verify-jwt`（易支付回调不带 Supabase JWT），安全靠 MD5 验签。

## 5. 后台生成邀请码
Supabase SQL Editor 执行（后台生成，非用户端）：
```sql
-- 单个：VTRS-XXXX
select public.create_invite_code('VTRS-A1B2C3D4', 1, 30);
-- 批量 5 个随机码
select public.create_invite_code('VTRS-' || upper(substr(md5(random()::text), 1, 8)), 1, 30)
from generate_series(1, 5);
```

## 6. 回调测试（curl 模拟易支付通知）
```
# 先建一个订单拿 order_no，然后手动构造签名
# 签名 = md5(参数按ASCII排序拼接 + KEY)
```
详见 JS 端 `supabase/functions/_shared/ezfp.js` 的 `sign()`。

## 7. 前端
- `membership.html`：套餐 + 微信/支付宝 + 邀请码兑换
- 其它页面引入 `js/membership.js` 获取权益状态
