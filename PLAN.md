# cat_catch — Playwright 复刻猫抓：任务计划文档

> 本文档记录项目的完整设计方案。制定日期：2026-08-05。
> 参考对象：猫抓(cat-catch) v2.7.2 源码（https://github.com/xifangczy/cat-catch）

## 一、目标

命令行脚本替代猫抓扩展的手动操作：`node catch.js <网址>` 全自动完成「嗅探页面媒体资源 → 下载 → 音画合并/转封装」。

## 二、猫抓源码调研结论

### 2.1 嗅探机制（js/background.js、js/init.js、catch-script/）

| 猫抓机制 | 位置 | 说明 |
|---|---|---|
| webRequest 被动嗅探 | background.js:64-93 | onSendHeaders 暂存请求头 + onResponseStarted 识别媒体 |
| 扩展名白名单 | init.js:29-62 | `flv hlv f4v mp4 mp3 wma wav m4a ts webm ogg ogv acc mov mkv m4s m3u8 m3u mpeg avi wmv asf divx mpeg4 vid aac mpd weba opus`（ts/srt 默认关） |
| MIME 白名单 | init.js:63-73 | `audio/* video/* application/ogg application/vnd.apple.mpegurl application/x-mpegurl application/mpegurl application/octet-stream-m3u8 application/dash+xml application/m4s` |
| resourceType=media | background.js:190-192 | video/audio 元素发出的请求无条件放行 |
| 请求头白名单 | background.js:932-964 | `referer origin cookie authorization auth token key access-token api-key app-token authtoken session-id` + `x-*` 且匹配 `/(auth\|token\|sign\|key\|ticket\|session)/` |
| URL 去重 | background.js:221-231 | 每 tab 一个 URL Set，指纹到 500 清空重来 |
| 深度搜索 search.js | catch-script/search.js | MAIN world 注入 hook：fetch/XHR.open/JSON.parse/TextDecoder.decode/atob/String.fromCharCode，检测 `#EXTM3U`、`urn:mpeg:dash:schema:mpd`、16 字节 AES key；相对路径 m3u8 补全为绝对路径上报 |
| MSE 缓存捕获 catch.js | catch-script/catch.js | Proxy `MediaSource.prototype.addSourceBuffer`/`appendBuffer` 录播放器 buffer（本项目不做） |
| DOM 扫描 | content-script.js:9-56 | `video, audio` 取 currentSrc，遍历 iframe |

### 2.2 下载机制（js/m3u8.downloader.js、js/downloader.js、js/m3u8.js）

- **并发模型**：多文件/分片并发，默认 6（thread），完成一个补拉一个
- **重试阶梯**（downloader.js:246-257）：裸请求 → 加 `Range: bytes=0-` → 加 `sec-fetch-mode: no-cors / sec-fetch-site: same-site`
- **分片重试**（m3u8.downloader.js:324-332）：失败 3 次，延迟 500ms×retryCount
- **M3U8 解析**：hls.js 仅作解析器（MANIFEST_PARSED 选最高带宽子清单、LEVEL_LOADED 枚举分片）
- **AES-128-CBC**（m3u8.js:685-712, 1571-1574）：key 从 EXT-X-KEY URI 拉取必须 16 字节（Map 缓存）；IV 优先清单值，缺省 = 分片 media sequence number 的 16 字节大端；去 PKCS7 padding；SAMPLE-AES-CTR = DRM 直接报错
- **合并**：分片 buffer 按 index 排序拼接；EXT-X-MAP initSegment 前置；EXT-X-BYTERANGE 转 Range 头；伪装 PNG/JPG 头的 ts 裁剪
- **文件名**：`${页面标题}.${ext}`，清洗非法字符
- **B 站直播屏蔽**（init.js:74-79）：`.*\.bilivideo\.(com|cn).*\/live-bvc\/.*m4s` 默认 blackList

### 2.3 Playwright 复刻对应关系

| 猫抓 | Playwright/Node 等价 |
|---|---|
| webRequest onResponseStarted | `page.on('response')`（不取 body，只读 headers，天然流式友好） |
| data.type == "media" | `request.resourceType() === 'media'` |
| 请求头（含 Cookie） | `response.request().allHeaders()`，兜底 `context.cookies(url)` 现拼 |
| MAIN world 注入（search.js） | `context.addInitScript()`（页面 JS 之前、所有 iframe 生效） |
| hook 结果回传 background | `context.exposeBinding('__catchReport', cb)` |
| DOM 扫描跨域 iframe | `page.frames()` 无同源限制，逐 frame evaluate |
| DNR 改 Referer/Cookie | Node fetch 直接带 headers 重放（比扩展更自由） |
| AES 软件解密（lib/m3u8-decrypt.js） | Node `crypto.createDecipheriv('aes-128-cbc')` 自动去 PKCS7 |
| mux.js 转封装 mp4 | ffmpeg `-c copy`（流拷贝不重编码） |
| chrome.downloads / StreamSaver | Node `stream.pipeline` → `fs.createWriteStream` |

## 三、需求边界（用户确认）

- **主场景：B 站（m4s，音画双轨分离）**，兼顾普通站（m3u8/mp4 直链）
- **音画合并：npm `ffmpeg-static`**（自动下载二进制，免 brew）
- **清晰度：跟随当前播放**（不拦截 playurl API 拿全清晰度列表）
- B 站关键事实：
  - m4s 分片请求完全暴露（`*.bilivideo.com/*.m4s`），**不需要 MSE 录制**
  - 同一 m4s 会被 Range 请求多次 → 按 URL 去重即可
  - 防盗链只查 Referer/UA → 白名单头重放可破
  - 1080P+ 需登录 → 持久化 profile + 首次 `--headed` 人工登录
  - 视频轨/音频轨 content-type 分别为 `video/mp4`、`audio/mp4`，据此配对

### 交付范围

✅ response 网络嗅探（含 m4s）｜✅ 深度 hook（隐藏 m3u8）｜✅ DOM video 扫描｜✅ 自动播放触发｜✅ 直链/m4s 流式下载｜✅ m3u8 下载（含 AES-128 解密、EXT-X-MAP/BYTERANGE）｜✅ ffmpeg 音画合并 + ts 转 mp4｜✅ 持久化登录 profile｜✅ CLI（--headed/--pick/--dry-run 等）

❌ 不做：MSE 录制（YouTube 等纯 blob 站）、MPD 直播、B 站直播（检测即提示）、DRM（Widevine/FairPlay 检测即报错）、playurl 全清晰度列表

## 四、项目结构

```
/Volumes/DevEnv/projects/cat_catch/
├── catch.js               # CLI 入口：parseArgs + 编排 sniff→pick→download→merge
├── package.json           # type: module；依赖仅 3 个（pnpm 安装）
├── PLAN.md                # 本文档
├── README.md              # 用法、B站登录说明、限制清单
├── lib/
│   ├── sniffer.js         # 启动 persistent context、挂 response、autoplay、settle 循环
│   ├── filter.js          # 扩展名/MIME 白名单命中判定
│   ├── registry.js        # EventEmitter：URL 去重、资源存取、found 事件
│   ├── autoplay.js        # 静音 play() + 播放按钮启发式点击
│   ├── domscan.js         # page.frames() 跨 iframe 扫 video/audio currentSrc
│   ├── headers.js         # 请求头白名单筛选 + context.cookies 兜底
│   ├── hook-source.js     # addInitScript 注入源码（深度 hook）
│   ├── picker.js          # best / all / 交互式 readline 选择
│   ├── filename.js        # 文件名清洗（去 B站标题后缀、非法字符）
│   ├── progress.js        # stderr 单行进度（无依赖）
│   ├── ffmpeg.js          # ffmpeg-static 封装：mergeAV(v,a,out)、tsToMp4(in,out)
│   └── download/
│       ├── index.js       # 按 ext 分发 direct/m3u8；下载后检测音画配对触发合并
│       ├── direct.js      # fetch 流式落盘 + Range→sec-fetch 三级重试
│       ├── m3u8.js        # m3u8-parser 解析、master 选最高 BANDWIDTH、直播/DRM 检测
│       ├── segments.js    # 分片 pool(6) 下载→解密→落 .parts 目录→按序流式合并
│       ├── aes.js         # AES-128-CBC（Node crypto）；IV 缺省规则
│       ├── pool.js        # 20 行并发池
│       └── net.js         # fetch 封装：30s 超时、重放头、text/buffer 辅助
├── downloads/             # 默认输出目录
└── .catch-profile/        # 持久化浏览器 profile（登录态，gitignore）
```

**依赖（仅 3 个，pnpm 安装）**：`playwright`（只装 chromium）、`m3u8-parser`、`ffmpeg-static`。其余全用 Node 22 内置（parseArgs / crypto / stream.pipeline / fs）。

## 五、关键实现要点

### 5.1 嗅探过滤（lib/filter.js）

- 扩展名表（ts 不收，避免 m3u8 分片刷屏；m4s 必收）
- MIME 表 + `resourceType()==='media'` 无条件放行；OPTIONS 丢弃；blob:/data: 标记 unsupported
- content-disposition 附件名再查一次扩展名；ext 缺失时从 MIME 推断（`type.split('/')[1]`）

### 5.2 嗅探流程（lib/sniffer.js）

1. `chromium.launchPersistentContext('.catch-profile', { headless, userAgent: 真实Chrome UA, args: ['--disable-blink-features=AutomationControlled'] })`
2. `context.exposeBinding('__catchReport', cb)` → `context.addInitScript(hookSource)`（顺序不能反）
3. `page.route` 拦截 image/font/css 省带宽（media/xhr 不拦）
4. `page.on('response')` → filter 命中 → 记录 {url, ext, mime, size, headers白名单, pageTitle} → registry 去重（**B 站同一 m4s 的多个 Range 请求在此天然去重**）
5. goto(domcontentloaded) → autoplay（静音 play + 点击 `.bpx-player-ctrl-btn-play` 等播放按钮选择器）→ settle 循环：静默 4s / 硬超时 45s / 满 50 个资源，任一满足收工 → domscan 补一刀 → 关浏览器
6. B 站直播检测：`live.bilibili.com` 或 URL 含 `live-bvc` → 提示不支持并跳过

### 5.3 深度 hook（lib/hook-source.js）

页面 JS 之前注入：包装 `fetch`/`XMLHttpRequest.open`/`JSON.parse`/`TextDecoder.prototype.decode`/`atob`，检测响应文本含 `#EXTM3U` → 相对路径 `new URL(rel, location.href)` 补全 → `__catchReport({url, ext:'m3u8', source:'hook'})`；16 字节 ArrayBuffer → 上报为候选 AES key。所有 hook 重写 toString 伪装原生、内部全 try/catch。

### 5.4 下载（lib/download/）

- **headers.js**：白名单照抄猫抓；cookie 缺失时 `context.cookies(url)` 现拼；UA 与浏览器一致 —— **B 站防盗链成败在此**
- **direct.js**（m4s/mp4 直链）：Node fetch 流式 `pipeline(Readable.fromWeb(res.body), createWriteStream(out))`；失败按 `裸请求 → +Range: bytes=0- → +sec-fetch-*` 重试
- **m3u8.js + segments.js**：m3u8-parser 解析；master 选 max BANDWIDTH；`SAMPLE-AES(-CTR)` 报 DRM；无 ENDLIST 报直播不支持；分片 pool(6)（失败 3 次退避 500ms×n）→ AES-128 解密（key 16 字节、Map 缓存、IV=清单 IV 或 mediaSequence+i 大端）→ 写 `out.parts/000001.part` → 按序流式拼接 → 删临时目录 → ffmpeg 转 mp4
- **ffmpeg.js**：`import ffmpegPath from 'ffmpeg-static'` spawn；`mergeAV`: `-i v.m4s -i a.m4s -c copy out.mp4`；`tsToMp4`: `-i in.ts -c copy out.mp4`（流拷贝不重编码）
- **音画配对（download/index.js）**：同批下载完成后，mime 为 `video/*` 的 m4s 与 `audio/*` 的 m4s 各取体积最大者自动合并为 `<标题>.mp4`；`--keep-parts` 保留源文件

### 5.5 CLI（catch.js）

```
node catch.js <url> [-o downloads] [--pick best|all|list|1,3] [--timeout 45000]
  [--concurrency 6] [--format mp4|ts] [--headed] [--no-autoplay] [--no-hook]
  [--keep-parts] [--dry-run] [--name "{title}.{ext}"] [-v]
```

- TTY 且嗅探到多个资源 → 打印编号表交互选择；非 TTY 落 best
- `--headed`：显示窗口用于首次登录 B 站（登录态存入 .catch-profile，之后 headless 复用）
- `--dry-run`：只嗅探打印 JSON
- 1080P+ 流程：`node catch.js <url> --headed` 登录+页面切清晰度一次 → 之后直接跑

## 六、实施步骤

1. ✅ 保存计划文档
2. pnpm init、pnpm add playwright m3u8-parser ffmpeg-static、pnpm exec playwright install chromium
3. 无状态工具：pool / net / filename / progress / headers / filter
4. sniffer.js + autoplay + registry + hook-source + domscan
5. direct.js → 直链跑通
6. m3u8.js + segments.js + aes.js → HLS 跑通
7. ffmpeg.js + 音画配对 → B 站全链路跑通
8. picker + CLI 打磨 + README

## 七、验证方案

1. **B 站主场景**：公开 BV 视频，`node catch.js <url>` → 断言嗅探到 2 个 m4s（video/audio 各一）→ 下载 → 自动合并出 `<标题>.mp4`（校验 ftyp 魔数+文件大小）；`--dry-run` 验证清单
2. **登录态**：`--headed` 跑一次确认 profile 落盘，二次运行 headless 复用 cookie
3. **通用 m3u8**：`https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8` → 合并出 mp4
4. **直链**：任一直链 mp4 → 校验 content-length 一致
5. **加密 HLS**：`https://demo.unified-streaming.com/k8s/features/stable/video/tears-of-steel/tears-of-steel.ism/.m3u8`（AES-128 公开流）→ 解密合并可播
6. 全部 headless 无人工干预完成；卡壳时 `--headed` 对照排查
