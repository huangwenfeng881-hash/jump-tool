// Supabase Edge Function: 智谱 GLM 代理
// 目的：把智谱 API Key 放在服务端环境变量里，前端/App 不再持有密钥。
// 部署：
//   supabase functions deploy glm-proxy --project-ref <ref>
//   supabase secrets set GLM_API_KEY=<你的智谱key> --project-ref <ref>
// 可选环境变量：GLM_MODELS（逗号分隔，按顺序重试），默认 glm-4-flash,glm-4.7-flash

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

const MODELS = (Deno.env.get("GLM_MODELS") || "glm-4-flash,glm-4.7-flash,glm-4.5-flash")
  .split(",").map((s) => s.trim()).filter(Boolean);

// 极简内存限流（每个实例内生效，够挡住误刷）
const hits = new Map<string, number[]>();
const LIMIT = 20;
const WINDOW_MS = 24 * 3600 * 1000;

function rateOk(key: string): boolean {
  const now = Date.now();
  const arr = (hits.get(key) || []).filter((t) => now - t < WINDOW_MS);
  if (arr.length >= LIMIT) { hits.set(key, arr); return false; }
  arr.push(now);
  hits.set(key, arr);
  return true;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const key = Deno.env.get("GLM_API_KEY") || "";
  if (!key) return json({ error: "server_missing_key" }, 500);

  const ip = req.headers.get("x-forwarded-for") || "unknown";
  if (!rateOk(ip)) return json({ error: "rate_limited", msg: "今天 AI 次数已达上限" }, 429);

  let body: any;
  try { body = await req.json(); } catch (e) { return json({ error: "bad_json" }, 400); }

  const messages = body.messages || [];
  const temperature = typeof body.temperature === "number" ? body.temperature : 0.6;
  if (!Array.isArray(messages) || !messages.length) return json({ error: "no_messages" }, 400);

  const models = body.model ? [body.model, ...MODELS] : MODELS;
  let lastErr = "unknown";

  for (const model of models) {
    try {
      const resp = await fetch("https://open.bigmodel.cn/api/paas/v4/chat/completions", {
        method: "POST",
        headers: { "Authorization": "Bearer " + key, "Content-Type": "application/json" },
        body: JSON.stringify({ model, messages, temperature, stream: !!body.stream })
      });
      if (!resp.ok) { lastErr = "upstream_" + resp.status; continue; }
      if (body.stream) {
        return new Response(resp.body, {
          headers: { ...CORS, "Content-Type": "text/event-stream", "X-Model": model }
        });
      }
      const data = await resp.json();
      return json({ ok: true, model, data }, 200);
    } catch (e) {
      lastErr = String(e);
    }
  }
  return json({ error: "upstream_failed", detail: lastErr }, 502);
});

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" }
  });
}
