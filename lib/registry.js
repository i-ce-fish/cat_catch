/**
 * 资源登记表：URL 去重 + found 事件 + 候选 AES key 收集。
 * 对照猫抓 background.js:221-231 的 G.urlMap 去重。
 * B 站同一 m4s 的多个 Range 请求在此天然去重（Range 在请求头，URL 不变）。
 */
import { EventEmitter } from 'node:events';

export class Registry extends EventEmitter {
  constructor() {
    super();
    /** @type {Map<string, object>} url -> resource */
    this.byUrl = new Map();
    /** 深度 hook 上报的无 URL 资源（如 m3u8 文本） */
    this.anonymous = [];
    /** 深度 hook 上报的候选 AES key（base64） */
    this.keys = [];
  }

  /**
   * @param {object} resource {url, ext, mime?, size?, source, headers?, pageTitle?, pageUrl?, userAgent?}
   * @returns {boolean} 是否为新资源
   */
  add(resource) {
    if (!resource) return false;
    if (!resource.url) {
      this.anonymous.push(resource);
      this.emit('found', resource);
      return true;
    }
    if (this.byUrl.has(resource.url)) {
      // 已存在时补充缺失信息（如后到的响应带 content-length）
      const old = this.byUrl.get(resource.url);
      if (!old.size && resource.size) old.size = resource.size;
      if (!old.mime && resource.mime) old.mime = resource.mime;
      return false;
    }
    this.byUrl.set(resource.url, resource);
    this.emit('found', resource);
    return true;
  }

  addKey(keyInfo) {
    this.keys.push(keyInfo);
    this.emit('key', keyInfo);
  }

  list() {
    return [...this.byUrl.values(), ...this.anonymous];
  }

  get size() {
    return this.byUrl.size + this.anonymous.length;
  }
}
