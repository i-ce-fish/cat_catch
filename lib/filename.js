/**
 * 文件名清洗与模板。对照猫抓 function.js:249-292（filterFileName/stringModify）。
 */
import { access } from 'node:fs/promises';
import path from 'node:path';

// 用 RegExp 构造器避开字面量转义歧义：匹配 < > : " | ? * \ / 及控制字符
const ILLEGAL_CHARS = new RegExp('[<>:"|?*\\\\/\\u0000-\\u001f]', 'g');
const ZERO_WIDTH = /[​‌‍⁠﻿]/g;
const BILIBILI_SUFFIX = /[_-]?(哔哩哔哩|bilibili).*$/i;

/** 清洗文件名单段：去非法字符/零宽字符/首尾点与空格，截断 150 字符 */
export function sanitizeFileName(name, fallback = 'video') {
  let s = String(name ?? '')
    .replace(ZERO_WIDTH, '')
    .replace(ILLEGAL_CHARS, '_')
    .replace(/\s+/g, ' ')
    .trim();
  s = s.replace(/^[.\s]+/, '').replace(/[.\s]+$/, '');
  if (s.length > 150) s = s.slice(0, 150).replace(/[.\s]+$/, '');
  return s || fallback;
}

/** B 站页面标题去后缀："xxxx_哔哩哔哩_bilibili" → "xxxx" */
export function cleanTitle(title, fallback = 'video') {
  const s = String(title ?? '').replace(BILIBILI_SUFFIX, '').trim().replace(/[-_\s]+$/, '');
  return sanitizeFileName(s, fallback);
}

/** 文件名模板：{title} {ext} {n} */
export function renderNameTemplate(tpl, data) {
  return String(tpl || '{title}.{ext}')
    .replaceAll('{title}', data.title ?? '')
    .replaceAll('{ext}', data.ext ?? '')
    .replaceAll('{n}', data.n != null ? String(data.n) : '');
}

/** 目录下重名时追加 " (n)"，返回可用完整路径 */
export async function uniquePath(dir, fileName) {
  const dot = fileName.lastIndexOf('.');
  const stem = dot > 0 ? fileName.slice(0, dot) : fileName;
  const ext = dot > 0 ? fileName.slice(dot) : '';
  let candidate = path.join(dir, fileName);
  for (let i = 1; ; i++) {
    try {
      await access(candidate);
      candidate = path.join(dir, `${stem} (${i})${ext}`);
    } catch {
      return candidate;
    }
  }
}
