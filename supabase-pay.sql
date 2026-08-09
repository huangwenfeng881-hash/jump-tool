-- ============================================================
-- Vertrise跃升 · 付费系统建表 + RPC + RLS
-- 使用方法：Supabase 控制台 → SQL Editor → 全选粘贴 → Run
-- 幂等：可重复执行（IF NOT EXISTS / DROP FUNCTION 先删）
-- ============================================================

-- ---------- 1. 套餐目录（服务端定价，以"分"存储防篡改） ----------
create table if not exists public.plans (
  id          int primary key,
  code        text not null unique,
  name        text not null,
  type        text not null check (type in ('credit','membership')),
  price_cents int not null,
  credits     int not null default 0,
  days        int not null default 0,
  sort_order  int not null default 0,
  active      boolean not null default true
);
insert into public.plans (id, code, name, type, price_cents, credits, days, sort_order) values
  (1, 'credit_1', 'AI分析 ×1',    'credit',     199, 1, 0,   1),
  (2, 'vip_1m',   'VIP 会员 1个月', 'membership', 990, 0, 30,  2),
  (3, 'vip_3m',   'VIP 会员 3个月', 'membership', 1990,0, 90,  3),
  (4, 'vip_1y',   'VIP 会员 1年',  'membership', 7990,0, 365, 4)
on conflict (id) do nothing;
alter table public.plans enable row level security;
drop policy if exists "plans read active" on public.plans;
create policy "plans read active" on public.plans for select using (active);

-- ---------- 2. 订单表（支付回调写入，客户端只读自己的） ----------
create table if not exists public.orders (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  plan_id           int  not null references public.plans(id),
  order_no          text not null unique,
  provider          text not null check (provider in ('alipay','wxpay','qqpay')),
  provider_trade_no text unique,
  status            text not null default 'pending'
                    check (status in ('pending','paid','closed','refunded')),
  amount_cents      int  not null,
  pay_code          text,
  paid_at           timestamptz,
  created_at        timestamptz not null default now()
);
create index if not exists idx_orders_user   on public.orders(user_id, created_at desc);
create index if not exists idx_orders_status on public.orders(status);
alter table public.orders enable row level security;
drop policy if exists "orders select own" on public.orders;
create policy "orders select own" on public.orders for select using (auth.uid() = user_id);

-- ---------- 3. 用户 AI 余额（1.99 充值制） ----------
create table if not exists public.user_credits (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  credits    int not null default 0 check (credits >= 0),
  updated_at timestamptz not null default now()
);
alter table public.user_credits enable row level security;
drop policy if exists "credits select own" on public.user_credits;
create policy "credits select own" on public.user_credits for select using (auth.uid() = user_id);

-- ---------- 4. 用户 VIP 会员 ----------
create table if not exists public.memberships (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  vip_until  timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.memberships enable row level security;
drop policy if exists "membership select own" on public.memberships;
create policy "membership select own" on public.memberships for select using (auth.uid() = user_id);

-- ---------- 5. 每日 AI 使用统计（免费 2 次/日） ----------
create table if not exists public.ai_usage (
  user_id    uuid not null references auth.users(id) on delete cascade,
  usage_date date not null default current_date,
  count      int  not null default 0,
  primary key (user_id, usage_date)
);
alter table public.ai_usage enable row level security;
drop policy if exists "usage select own" on public.ai_usage;
create policy "usage select own" on public.ai_usage for select using (auth.uid() = user_id);

-- ---------- 6. AI 调用审计日志 ----------
create table if not exists public.ai_logs (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  ai_type    text not null check (ai_type in ('evaluation','trainer')),
  used_kind  text not null check (used_kind in ('free','credit','vip')),
  created_at timestamptz not null default now()
);
create index if not exists idx_ai_logs_user on public.ai_logs(user_id, created_at desc);
alter table public.ai_logs enable row level security;
-- 审计表：客户端不开放读写，仅 RPC(security definer) / 后台写

-- ---------- 7. 邀请码（纯发码制，后台生成） ----------
create table if not exists public.invite_codes (
  code        text primary key,
  created_by  uuid,
  status      text not null default 'active' check (status in ('active','disabled')),
  max_uses    int  not null default 1,
  used_count  int  not null default 0,
  reward_days int  not null default 30,
  expires_at  timestamptz,
  created_at  timestamptz not null default now()
);
alter table public.invite_codes enable row level security;
-- 客户端不可读 invite_codes（防枚举），仅 RPC 内部读

create table if not exists public.invite_redemptions (
  id          uuid primary key default gen_random_uuid(),
  code        text not null references public.invite_codes(code),
  user_id     uuid not null references auth.users(id) on delete cascade,
  reward_days int  not null default 30,
  redeemed_at timestamptz not null default now(),
  unique (code, user_id)
);
alter table public.invite_redemptions enable row level security;
drop policy if exists "redeem select own" on public.invite_redemptions;
create policy "redeem select own" on public.invite_redemptions for select using (auth.uid() = user_id);

-- ============================================================
-- RPC 函数（security definer，固定 search_path）
-- ============================================================

-- 查询用户 AI 状态（VIP 状态 / 余额 / 今日剩余免费次数）
create or replace function public.get_ai_status()
returns table (
  is_vip boolean, vip_until timestamptz,
  credits int, today_used int, free_limit int,
  remaining_free int, remaining_any int
)
language sql stable security definer set search_path = public as $$
  select
    coalesce(m.vip_until > now(), false),
    m.vip_until,
    coalesce(c.credits, 0),
    coalesce(u.count, 0),
    2,
    greatest(0, 2 - coalesce(u.count, 0)),
    case when coalesce(m.vip_until > now(), false) then 9999
         else coalesce(c.credits, 0) + greatest(0, 2 - coalesce(u.count, 0)) end
  from auth.users au
  left join public.memberships  m on m.user_id = au.id
  left join public.user_credits c on c.user_id = au.id
  left join public.ai_usage     u on u.user_id = au.id and u.usage_date = current_date
  where au.id = auth.uid();
$$;

-- 消耗 1 次 AI 分析（VIP 无限 → 免费额度 → 余额；加锁防并发）
create or replace function public.consume_ai(p_type text)
returns table (ok boolean, msg text, used_kind text)
language plpgsql security definer set search_path = public as $$
declare
  v_uid    uuid := auth.uid();
  v_kind   text;
  v_count  int;
  v_plan   int;
begin
  if v_uid is null then
    return query select false, '请先登录后使用 AI 分析', null::text;
    return;
  end if;
  perform pg_advisory_xact_lock(hashtext('vt_ai:' || v_uid::text));

  -- 1) VIP 无限
  if exists (select 1 from public.memberships where user_id = v_uid and vip_until > now()) then
    v_kind := 'vip';
  else
    -- 2) 免费每日额度
    insert into public.ai_usage (user_id, usage_date, count)
    values (v_uid, current_date, 1)
    on conflict (user_id, usage_date)
    do update set count = public.ai_usage.count + 1
    returning count into v_count;

    if v_count <= 2 then
      v_kind := 'free';
    else
      -- 超免费额度：回滚当日计数，改走余额
      update public.ai_usage set count = count - 1
      where user_id = v_uid and usage_date = current_date;
      update public.user_credits set credits = credits - 1, updated_at = now()
      where user_id = v_uid and credits > 0
      returning credits into v_plan;
      if found then
        v_kind := 'credit';
      else
        return query select false,
          '今日免费次数(2次)已用完，可购买 ¥1.99 单次或升级 VIP 无限使用', null::text;
        return;
      end if;
    end if;
  end if;

  insert into public.ai_logs (user_id, ai_type, used_kind) values (v_uid, p_type, v_kind);
  return query select true, 'ok', v_kind;
end; $$;

-- GLM 调用失败时退回本次消耗
create or replace function public.refund_ai(p_kind text)
returns void language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then return; end if;
  perform pg_advisory_xact_lock(hashtext('vt_ai:' || v_uid::text));
  if p_kind = 'free' then
    update public.ai_usage set count = count - 1
    where user_id = v_uid and usage_date = current_date and count > 0;
  elsif p_kind = 'credit' then
    insert into public.user_credits (user_id, credits) values (v_uid, 1)
    on conflict (user_id) do update set credits = public.user_credits.credits + 1, updated_at = now();
  end if;
end; $$;

-- 支付回调到账（幂等；Edge 验签后调用，金额二次校验）
create or replace function public.finalize_payment(
  p_order_no text, p_trade_no text, p_amount_cents int
) returns table (ok boolean, msg text, pay_code text)
language plpgsql security definer set search_path = public as $$
declare
  v_order public.orders%rowtype;
  v_plan  public.plans%rowtype;
  v_code  text;
begin
  select * into v_order from public.orders where order_no = p_order_no for update;
  if not found then
    return query select false, 'order not found', null::text;
    return;
  end if;
  if v_order.status = 'paid' then
    return query select true, 'already paid', v_order.pay_code;
    return;
  end if;
  if v_order.amount_cents <> p_amount_cents then
    return query select false, 'amount mismatch', null::text;
    return;
  end if;

  select * into v_plan from public.plans where id = v_order.plan_id;
  v_code := 'P-' || upper(substr(md5(v_order.id::text || v_order.order_no), 1, 8));

  update public.orders
  set status = 'paid', provider_trade_no = p_trade_no, paid_at = now(), pay_code = v_code
  where id = v_order.id;

  if v_plan.type = 'credit' then
    insert into public.user_credits (user_id, credits)
    values (v_order.user_id, v_plan.credits)
    on conflict (user_id) do update set credits = public.user_credits.credits + v_plan.credits, updated_at = now();
  else
    insert into public.memberships (user_id, vip_until)
    values (v_order.user_id, now() + (v_plan.days || ' days')::interval)
    on conflict (user_id) do update set
      vip_until = greatest(public.memberships.vip_until, now()) + (v_plan.days || ' days')::interval,
      updated_at = now();
  end if;

  return query select true, 'ok', v_code;
end; $$;

-- 邀请码兑换（得 reward_days 天 VIP，顺延）
create or replace function public.redeem_invite(p_code text)
returns table (ok boolean, msg text, vip_until timestamptz)
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_c   public.invite_codes%rowtype;
  v_vip timestamptz;
begin
  if v_uid is null then
    return query select false, '请先登录', null::timestamptz;
    return;
  end if;
  p_code := upper(trim(p_code));
  select * into v_c from public.invite_codes where code = p_code;
  if not found then
    return query select false, '邀请码不存在', null::timestamptz; return;
  end if;
  if v_c.status <> 'active' then
    return query select false, '邀请码已停用', null::timestamptz; return;
  end if;
  if v_c.expires_at is not null and v_c.expires_at < now() then
    return query select false, '邀请码已过期', null::timestamptz; return;
  end if;
  if v_c.used_count >= v_c.max_uses then
    return query select false, '邀请码使用次数已用完', null::timestamptz; return;
  end if;
  if exists (select 1 from public.invite_redemptions where code = p_code and user_id = v_uid) then
    return query select false, '你已使用过该邀请码', null::timestamptz; return;
  end if;

  insert into public.memberships (user_id, vip_until)
  values (v_uid, now() + (v_c.reward_days || ' days')::interval)
  on conflict (user_id) do update set
    vip_until = greatest(public.memberships.vip_until, now()) + (v_c.reward_days || ' days')::interval,
    updated_at = now()
  returning vip_until into v_vip;

  insert into public.invite_redemptions (code, user_id, reward_days)
  values (p_code, v_uid, v_c.reward_days);
  update public.invite_codes set used_count = used_count + 1 where code = p_code;

  return query select true, '兑换成功，VIP 已延长 ' || v_c.reward_days || ' 天', v_vip;
end; $$;

-- 后台生成邀请码（管理员在 SQL Editor 调用，或后台直接插表）
create or replace function public.create_invite_code(
  p_code text, p_max_uses int default 1, p_reward_days int default 30
) returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.invite_codes (code, created_by, max_uses, reward_days)
  values (upper(trim(p_code)), auth.uid(), coalesce(p_max_uses,1), coalesce(p_reward_days,30));
end; $$;

-- 示例：批量生成 5 个单次邀请码
-- select public.create_invite_code('VTRS-' || upper(substr(md5(random()::text),1,8)));
-- select public.create_invite_code('VTRS-ABC12345', 1, 30);

grant execute on function public.get_ai_status,
  public.consume_ai, public.refund_ai,
  public.redeem_invite to authenticated;
-- finalize_payment 仅 Edge Function(service_role) 调用，不开放给认证用户
grant execute on function public.finalize_payment to service_role;
