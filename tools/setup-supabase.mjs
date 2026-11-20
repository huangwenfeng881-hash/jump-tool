#!/usr/bin/env node
/**
 * 一键重建 Supabase 后端（自动建库 + 建表 + 回填配置）
 * ------------------------------------------------------------------
 * 前置（只需做一次，约 3 分钟，只能由你本人完成）：
 *   1) 打开 https://supabase.com/dashboard 注册并登录（邮箱 + 密码，需点邮件确认）
 *   2) 右上头像 → Account → Access Tokens → Generate new token
 *   3) 把 token（sbp_ 开头）存到 D:\jump app\.supabase-token（这个文件已在 .gitignore）
 *
 * 然后运行：
 *   node tools/setup-supabase.mjs
 *
 * 它会：
 *   - 用 Management API 创建项目（新加坡区，免费档）
 *   - 轮询到项目可用
 *   - 依次执行仓库里的 supabase-*.sql 建表/建策略/建 RPC
 *   - 把 URL + anon key 写回 js/supabase-config.js、android/.../SupabaseConfig.kt、_redirects
 *   - 打印结果
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ROOT = process.cwd();
const API = 'https://api.supabase.com/v1';
const TOKEN_FILE = path.join(ROOT, '.supabase-token');

const SQL_ORDER = [
  'supabase-setup.sql',
  'supabase-batch1.sql',
  'supabase-batch2.sql',
  'supabase-pay.sql',
  'supabase-feedback.sql',
  'supabase-add.sql',
  'supabase-jump-type.sql',
  'supabase-barbell-weight.sql'
];

function die(msg) { console.error('\n[失败] ' + msg); process.exit(1); }
function log(msg) { console.log(msg); }

function readToken() {
  if (process.env.SUPABASE_ACCESS_TOKEN) return process.env.SUPABASE_ACCESS_TOKEN.trim();
  if (fs.existsSync(TOKEN_FILE)) return fs.readFileSync(TOKEN_FILE, 'utf8').trim();
  die('找不到 token：请把 sbp_... 保存到 ' + TOKEN_FILE + '，或设置环境变量 SUPABASE_ACCESS_TOKEN');
}

async function api(token, method, p, body) {
  const res = await fetch(API + p, {
    method,
    headers: {
      Authorization: 'Bearer ' + token,
      'Content-Type': 'application/json'
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (e) { data = text; }
  if (!res.ok) {
    const msg = typeof data === 'object' && data ? (data.message || JSON.stringify(data)) : String(data);
    throw new Error(method + ' ' + p + ' -> HTTP ' + res.status + ': ' + msg);
  }
  return data;
}

function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

async function main() {
  const token = readToken();
  const name = arg('name', 'vertrise');
  const region = arg('region', 'ap-southeast-1');
  const dbPass = arg('db-pass', 'Vr' + Math.random().toString(36).slice(2, 12) + '!9');

  log('1/6 读取组织…');
  const orgs = await api(token, 'GET', '/organizations');
  if (!Array.isArray(orgs) || !orgs.length) die('该账号下没有组织（请先在网页端创建一个免费组织）');
  const org = orgs[0];
  log('   组织：' + org.name + ' (' + org.id + ')');

  log('2/6 创建项目（区域 ' + region + '）…');
  let project;
  try {
    project = await api(token, 'POST', '/projects', {
      organization_id: org.id,
      name: name,
      region: region,
      db_pass: dbPass,
      plan: 'free'
    });
  } catch (e) {
    die('创建项目失败：' + e.message + '\n（免费账号默认最多 2 个项目，若已有项目可先删除，或加 --name 换个名字）');
  }
  const ref = project.id;
  log('   项目 ref：' + ref + '（数据库密码：' + dbPass + '，请自己记一下，用于直连数据库）');

  log('3/6 等待项目变为 ACTIVE_HEALTHY（通常 1~3 分钟）…');
  let status = '';
  for (let i = 0; i < 90; i++) {
    await new Promise(r => setTimeout(r, 4000));
    const info = await api(token, 'GET', '/projects/' + ref);
    status = info.status || '';
    process.stdout.write('\r   status=' + status + '   ');
    if (status === 'ACTIVE_HEALTHY') break;
    if (status === 'INIT_FAILED' || status === 'PAUSED') die('项目状态异常：' + status);
  }
  console.log('');
  if (status !== 'ACTIVE_HEALTHY') die('等待超时，请到网页控制台看一下项目状态');

  log('4/6 执行建表 SQL …');
  for (const f of SQL_ORDER) {
    const full = path.join(ROOT, f);
    if (!fs.existsSync(full)) { log('   跳过（不存在）：' + f); continue; }
    const sql = fs.readFileSync(full, 'utf8');
    try {
      await api(token, 'POST', '/projects/' + ref + '/database/query', { query: sql });
      log('   OK ' + f);
    } catch (e) {
      die('执行 ' + f + ' 失败：' + e.message + '\n（可以到控制台 SQL Editor 手动执行该文件后重跑本脚本）');
    }
  }

  log('5/6 读取 anon key …');
  const keys = await api(token, 'GET', '/projects/' + ref + '/api-keys?reveal=true');
  const anon = (keys || []).find(k => (k.name || '').toLowerCase() === 'anon' || k.type === 'publishable');
  if (!anon) die('没取到 anon key，返回：' + JSON.stringify(keys));
  const anonKey = anon.api_key || anon.apiKey || anon.key;
  const url = 'https://' + ref + '.supabase.co';

  log('6/6 写回配置 …');
  const cfgPath = path.join(ROOT, 'js', 'supabase-config.js');
  let cfg = fs.readFileSync(cfgPath, 'utf8');
  cfg = cfg.replace(/SUPABASE_URL:\s*'[^']*'/, "SUPABASE_URL: '" + url + "'");
  cfg = cfg.replace(/SUPABASE_ANON_KEY:\s*'[^']*'/, "SUPABASE_ANON_KEY: '" + anonKey + "'");
  fs.writeFileSync(cfgPath, cfg);
  log('   js/supabase-config.js 已更新');

  const ktPath = path.join(ROOT, 'android', 'app', 'src', 'main', 'java', 'com', 'vertrise', 'jumptool', 'SupabaseConfig.kt');
  if (fs.existsSync(ktPath)) {
    let kt = fs.readFileSync(ktPath, 'utf8');
    kt = kt.replace(/const val DIRECT = "[^"]*"/, 'const val DIRECT = "' + url + '"');
    kt = kt.replace(/const val ANON_KEY = "[^"]*"/, 'const val ANON_KEY = "' + anonKey + '"');
    fs.writeFileSync(ktPath, kt);
    log('   SupabaseConfig.kt 已更新');
  }

  const redirects = path.join(ROOT, '_redirects');
  if (fs.existsSync(redirects)) {
    let rd = fs.readFileSync(redirects, 'utf8');
    rd = rd.replace(/https:\/\/[a-z0-9]+\.supabase\.co/g, url);
    fs.writeFileSync(redirects, rd);
    log('   _redirects 已更新');
  }

  const tempRef = path.join(ROOT, 'supabase', '.temp', 'project-ref');
  if (fs.existsSync(path.dirname(tempRef))) {
    fs.writeFileSync(tempRef, ref + '\n');
    log('   supabase/.temp/project-ref 已更新（CLI 可直接用）');
  }

  console.log('\n================ 完成 ================');
  console.log('项目地址   : ' + url);
  console.log('控制台     : https://supabase.com/dashboard/project/' + ref);
  console.log('anon key   : ' + anonKey.slice(0, 24) + '…（已写入配置）');
  console.log('数据库密码 : ' + dbPass);
  console.log('\n下一步：');
  console.log('  1) git add -A && git commit -m "后端重建：新 Supabase 项目" && git push  （Netlify 会自动部署）');
  console.log('  2) 回到 App 登录页刷新，就会自动切回云端账号');
  console.log('  3) 到 Supabase 控制台 Authentication → Providers → Email，关闭 Confirm email 可免邮箱验证');
}

main().catch(e => die(e && e.message ? e.message : String(e)));
