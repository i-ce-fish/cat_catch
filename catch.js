#!/usr/bin/env node
/**
 * cat_catch —— Playwright 复刻猫抓：输入网址自动嗅探下载网页视频
 * 用法: node catch.js <url> [选项]   （详见 --help 或 README.md）
 */
import { parseArgs } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sniff, UnsupportedError } from './lib/sniffer.js';
import { pickResources, interactivePick, printTable, dashPair } from './lib/picker.js';
import { downloadResources } from './lib/download/index.js';
import { ensureCookie, ensureReferer } from './lib/headers.js';

/** 项目根目录（catch.js 所在处）：profile 锚定到这里，不随运行目录漂移 */
const PROJECT_ROOT = path.dirname(fileURLToPath(import.meta.url));

const HELP = `
cat_catch —— 输入网址自动嗅探下载网页视频（B站 m4s 音画自动合并）

用法:
  node catch.js <url> [选项]

选项:
  -o, --out <dir>        输出目录（默认 ./downloads）
  -t, --timeout <ms>     嗅探硬超时（默认 45000）
      --quiet <ms>       静默判定窗口（默认 4000）
  -j, --concurrency <n>  分片/文件并发（默认 6）
      --pick <mode>      best（默认）| all | 序号如 1,3 | list（仅列出）
      --format <fmt>     HLS 输出 mp4（默认）| ts
      --name <tpl>       文件名模板（默认 "{title}.{ext}"）
      --headed           显示浏览器窗口（首次登录 B 站用）
      --no-autoplay      不模拟播放
      --no-hook          关闭深度 hook 嗅探
      --profile <dir>    持久化 profile 目录（默认 ./.catch-profile）
      --keep-parts       合并后保留 m4s/ts 源文件
      --dry-run          只嗅探，JSON 打印资源清单
  -v, --verbose          详细日志
  -h, --help             显示帮助

示例:
  node catch.js "https://www.bilibili.com/video/BV1xx411c7mD"
  node catch.js "https://example.com/page" --pick list
  node catch.js "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8"
  node catch.js "<url>" --headed        # 首次登录 B 站（登录态存入 profile 复用）
`;

const MEDIA_URL_RE = /\.(m3u8|m3u|mpd|mp4|m4s|flv|mp3|m4a|aac|webm|mkv|mov|wav|ogg)(\?|#|$)/i;

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      out: { type: 'string', short: 'o', default: 'downloads' },
      timeout: { type: 'string', short: 't', default: '45000' },
      quiet: { type: 'string', default: '4000' },
      concurrency: { type: 'string', short: 'j', default: '6' },
      pick: { type: 'string', default: 'best' },
      format: { type: 'string', default: 'mp4' },
      name: { type: 'string', default: '{title}.{ext}' },
      headed: { type: 'boolean', default: false },
      autoplay: { type: 'boolean', default: true },
      'no-autoplay': { type: 'boolean', default: false },
      hook: { type: 'boolean', default: true },
      'no-hook': { type: 'boolean', default: false },
      profile: { type: 'string', default: '.catch-profile' },
      'keep-parts': { type: 'boolean', default: false },
      'dry-run': { type: 'boolean', default: false },
      'max-resources': { type: 'string', default: '50' },
      verbose: { type: 'boolean', short: 'v', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });

  if (values.help || positionals.length === 0) {
    console.log(HELP);
    process.exit(positionals.length === 0 && !values.help ? 1 : 0);
  }

  const url = positionals[0];
  const verbose = values.verbose;
  const log = (msg) => process.stderr.write(`[cat_catch] ${msg}\n`);
  const debug = (msg) => verbose && log(msg);

  const outDir = path.resolve(values.out);
  // profile 相对路径锚定项目根：在任何目录运行都复用同一份登录态
  const profileDir = path.isAbsolute(values.profile)
    ? values.profile
    : path.resolve(PROJECT_ROOT, values.profile);
  let resources = [];
  let cookies = [];
  let userAgent;
  let pageTitle = '';
  let keys = [];

  // 媒体直链短路：跳过浏览器直接下载
  const directMatch = MEDIA_URL_RE.exec(url);
  if (directMatch) {
    log('检测到媒体直链，跳过浏览器嗅探');
    resources = [{ url, ext: directMatch[1].toLowerCase(), source: 'direct', headers: {} }];
  } else {
    log('启动浏览器嗅探...');
    let sniffResult;
    try {
      sniffResult = await sniff(url, {
        profileDir,
        headed: values.headed,
        timeout: parseInt(values.timeout, 10),
        quietMs: parseInt(values.quiet, 10),
        maxResources: parseInt(values['max-resources'], 10),
        autoplay: !values['no-autoplay'],
        deepHook: !values['no-hook'],
        log: debug,
        infoLog: log,
      });
    } catch (err) {
      if (err instanceof UnsupportedError) {
        console.error(`不支持: ${err.message}`);
        process.exit(2);
      }
      throw err;
    }
    resources = sniffResult.resources;
    cookies = sniffResult.cookies;
    userAgent = sniffResult.userAgent;
    pageTitle = sniffResult.pageTitle;
    keys = sniffResult.keys;
    // B 站登录态检测：让用户立刻知道登录是否生效（SESSDATA 是 B 站登录核心 cookie）
    if (/bilibili\.com/.test(url)) {
      const loggedIn = cookies.some((c) => c.name === 'SESSDATA' && c.value);
      log(
        loggedIn
          ? '✓ 检测到 B 站登录态（SESSDATA），将获取登录后清晰度'
          : '⚠ 未检测到 B 站登录态：只能拿到 360P/480P。需要高清请用 --headed 在弹出的窗口里登录（日常 Chrome 的登录不算数）'
      );
    }
    // B 站 playurl 结构化数据优先：构造音画资源对置于列表最前（best 策略直接命中）
    if (sniffResult.dashInfo) {
      const pair = dashPair(sniffResult.dashInfo, pageTitle);
      if (pair) {
        log(`B 站 playurl: 视频 ${pair.video.meta?.width}x${pair.video.meta?.height}（${pair.video.meta?.codecs}）+ 音频（${pair.audio.meta?.codecs}）`);
        resources.unshift(pair.video, pair.audio);
      }
    }
    debug(`页面标题: ${pageTitle}`);
    if (keys.length) log(`深度 hook 捕获 ${keys.length} 个候选 AES key`);
  }

  if (resources.length === 0) {
    console.error('未嗅探到任何媒体资源。可尝试：--headed 查看页面、--timeout 加大超时、或确认页面确实有视频。');
    process.exit(3);
  }

  // 补齐请求头：referer 用页面 URL 回填、cookie 用浏览器会话兜底
  for (const res of resources) {
    res.headers = ensureReferer(res.headers ?? {}, res.pageUrl ?? url);
    res.headers = ensureCookie(res.headers, cookies);
  }

  log(`共嗅探到 ${resources.length} 个资源`);
  if (values.pick === 'list' || values['dry-run']) {
    printTable(resources);
  }
  if (values['dry-run']) {
    console.log(JSON.stringify({ pageTitle, count: resources.length, keys, resources }, null, 2));
    return;
  }

  // 选择资源
  let selected;
  if (values.pick === 'list') {
    selected = (await interactivePick(resources)) ?? [];
  } else if (values.pick === 'best' && process.stdin.isTTY && resources.length > 2) {
    selected = (await interactivePick(resources)) ?? pickResources(resources, 'best');
  } else {
    selected = pickResources(resources, values.pick);
  }

  if (!selected.length) {
    console.error('未选择任何资源');
    process.exit(4);
  }
  log(`选中 ${selected.length} 个资源，开始下载 → ${outDir}`);

  const { results, errors } = await downloadResources(selected, {
    outDir,
    format: values.format,
    concurrency: parseInt(values.concurrency, 10),
    nameTpl: values.name,
    keepParts: values['keep-parts'],
    userAgent,
    verbose,
    log,
  });

  console.log('');
  for (const f of results) console.log(`✓ ${f}`);
  if (errors?.length) {
    console.error(`\n${errors.length} 个资源下载失败`);
    process.exit(5);
  }
  if (!results.length) {
    console.error('没有产出任何文件');
    process.exit(5);
  }
}

main().catch((err) => {
  console.error(`\n[cat_catch] 错误: ${err.message}`);
  if (process.env.DEBUG) console.error(err.stack);
  process.exit(1);
});
