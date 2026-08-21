/**
 * Vertrise跃升 · GLM API Key 运行时解密模块
 * ------------------------------------------------------------
 * key 不存明文，存 AES-256-GCM 密文（js/supabase-config.js 的 GLM_API_KEY_ENC）。
 * 运行时用 WebCrypto 在本地解密，内存中缓存，绝不写入磁盘/存储。
 * - 需要 HTTPS / localhost 环境（WebCrypto 在非安全上下文不可用）；
 *   Cloudflare Pages 生产环境满足，本地 file:// 不支持（可先用 page 内联回退提示）。
 * - 暴露：window.GLMKey
 * - 解密失败或缺少密文时 get() 返回 null，glm.js 自行降级处理。
 */
window.GLMKey = (function () {
  'use strict';

  var CONFIG = window.JTConfig || {};
  var cached = null;       // 解密成功后的明文 key（仅内存）
  var pending = null;      // 进行中的解密 Promise

  function _b64ToBuf(b64) {
    var bin = atob(b64);
    var len = bin.length;
    var bytes = new Uint8Array(len);
    for (var i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
    return bytes.buffer;
  }

  function _bufToHex(buf) {
    var bytes = new Uint8Array(buf);
    var hex = '';
    for (var i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, '0');
    return hex;
  }

  // SHA-256(passphrase) 派生 32 字节 AES 密钥
  function _deriveKey(passphrase) {
    return crypto.subtle.digest('SHA-256', new TextEncoder().encode(passphrase)).then(function (hashBuf) {
      return crypto.subtle.importKey('raw', hashBuf, { name: 'AES-GCM' }, false, ['decrypt']);
    });
  }

  // 密文格式 base64(iv(12) || ciphertext || tag(16))
  function _decrypt(cipherB64, passphrase) {
    var raw = new Uint8Array(_b64ToBuf(cipherB64));
    if (raw.length < 12 + 16) return Promise.reject(new Error('GLM 密文格式错误'));
    var iv = raw.slice(0, 12);
    var data = raw.slice(12);
    return _deriveKey(passphrase).then(function (key) {
      return crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: iv, tagLength: 128 },
        key,
        data
      );
    }).then(function (plainBuf) {
      return new TextDecoder().decode(plainBuf);
    });
  }

  function isConfigured() {
    return !!(CONFIG.GLM_API_KEY_ENC && CONFIG.GLM_API_KEY_ENC.trim() && CONFIG.GLM_CRYPTO_PASSPHRASE);
  }

  function get() {
    if (cached !== null) return Promise.resolve(cached);
    if (pending) return pending;
    if (!isConfigured()) {
      pending = null;
      return Promise.resolve(null);
    }
    pending = _decrypt(CONFIG.GLM_API_KEY_ENC.trim(), CONFIG.GLM_CRYPTO_PASSPHRASE).then(function (key) {
      cached = key || '';
      pending = null;
      return cached;
    }).catch(function (err) {
      pending = null;
      // 解密失败（口令不匹配/密文损坏/环境不支持）：记为 null，避免反复重试
      cached = '';
      return null;
    });
    return pending;
  }

  // 仅供调试：确认解密后的 key 前缀，不输出完整 key
  function debugPrefix() {
    return get().then(function (k) {
      return k ? k.slice(0, 6) + '…(len=' + k.length + ')' : '(null)';
    });
  }

  return {
    get: get,
    isConfigured: isConfigured,
    debugPrefix: debugPrefix
  };
})();
