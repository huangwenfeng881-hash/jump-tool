/**
 * 加密 GLM_API_KEY（AES-256-GCM），用于前端运行时解密。
 * 用法：node tools/encrypt-glm-key.js "<明文key>" "<口令>"
 * 输出 base64(iv || ciphertext || tag)，粘贴到 js/supabase-config.js 的 GLM_API_KEY_ENC。
 * 注意：口令也在前端代码中，此为混淆层；真实安全请用 Cloudflare Worker 代理。
 */
const crypto = require('crypto');
const plain = process.argv[2];
const pass = process.argv[3];
if (!plain || !pass) {
  console.error('用法: node tools/encrypt-glm-key.js "<明文key>" "<口令>"');
  process.exit(1);
}
const key = crypto.createHash('sha256').update(pass).digest();
const iv = crypto.randomBytes(12);
const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
const tag = cipher.getAuthTag();
const blob = Buffer.concat([iv, ct, tag]);
console.log(blob.toString('base64'));
