/**
 * AES-128-CBC 分片解密（Node crypto 内建，自动去 PKCS7 padding）。
 * 对照猫抓 lib/m3u8-decrypt.js 与 m3u8.js:1571-1574 的调用方式。
 */
import crypto from 'node:crypto';

/** HLS 规范：清单未给 IV 时，用分片的 media sequence number 构造 16 字节大端 IV */
export function defaultIV(sn) {
  const b = Buffer.alloc(16);
  b.writeBigUInt64BE(BigInt(sn), 8);
  return b;
}

/**
 * m3u8-parser 把 EXT-X-KEY 的 IV 解析为 Uint32Array(4)，需按大端字节序还原成 16 字节。
 * @param {Uint32Array|number[]} iv
 */
export function ivToBuffer(iv) {
  if (!iv) return null;
  const b = Buffer.alloc(16);
  for (let i = 0; i < 4; i++) b.writeUInt32BE((iv[i] ?? 0) >>> 0, i * 4);
  return b;
}

/**
 * @param {Buffer} buf 加密分片
 * @param {Buffer} key 16 字节 key
 * @param {Buffer} iv 16 字节 iv
 * @returns {Buffer} 解密后数据（PKCS7 padding 已去除）
 */
export function aes128Decrypt(buf, key, iv) {
  if (key.length !== 16) throw new Error(`AES key 长度应为 16 字节，实际 ${key.length}`);
  const d = crypto.createDecipheriv('aes-128-cbc', key, iv);
  return Buffer.concat([d.update(buf), d.final()]);
}
