# cat_catch

Playwright 复刻[猫抓(cat-catch)](https://github.com/xifangczy/cat-catch)：**输入网址，自动嗅探并下载网页视频**，无需手动打开浏览器点扩展。

针对 **B 站（m4s 音画分离）** 深度优化：自动拦截 playurl 接口拿到最高可用清晰度的视频轨+音频轨，下载后 ffmpeg 自动合并为 mp4。同时支持通用站点（m3u8/mp4 直链嗅探、AES-128 加密 HLS 解密）。

## 安装

```bash
pnpm install
./node_modules/.bin/playwright install chromium   # 首次必须，下载浏览器
```

> 环境要求：Node ≥ 18（推荐 22）。macOS 12 用户注意 playwright 需 ≤1.49（本项目已锁定 1.49.1）。
> ffmpeg 由 `ffmpeg-static` 依赖自动提供，无需单独安装。

## 快速开始

```bash
# B 站视频（自动配对音画、合并 mp4）
node catch.js "https://www.bilibili.com/video/BV1xx411c7mD"

# 通用 m3u8 直链
node catch.js "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8"

# 只嗅探不下载（看资源清单）
node catch.js "<url>" --dry-run

# 列出资源交互选择
node catch.js "<url>" --pick list
```

产出默认在 `./downloads/`（`-o` 可改）。

## 下载 B 站高清晰度（1080P+）

未登录只能拿到 360P/480P。登录一次，cookie 永久复用：

```bash
node catch.js "https://www.bilibili.com/video/BV你的视频" --headed
```

操作流程：

1. 终端会弹出真实浏览器窗口并打开该视频页
2. **在弹出的这个窗口里完成登录**：⚠️ 点 B 站up主昵称旁边的「发消息」→ 用 B 站 App 扫码（或账号密码）
   - ⚠️ **必须在这个弹出窗口里登录**：工具用的是独立浏览器 profile，你日常 Chrome/Safari 里登录了不算数
   - 扫码后**记得在手机上点确认**
3. 登录成功后**回到终端按回车**——页面自动刷新，playurl 会用登录态重新请求高清地址
4. 脚本自动继续：嗅探 → 下载 → 合并 mp4 → 关窗

**怎么确认登录生效了**：每次运行都会打印检测结果——

- `✓ 检测到 B 站登录态（SESSDATA），将获取登录后清晰度` → 成功
- `⚠ 未检测到 B 站登录态...` → 没登上，重跑 `--headed` 流程

登录态保存在项目目录的 `.catch-profile/`（固定位置，在任意目录运行都复用同一份）。**之后下载同一账号权限内的视频，直接正常运行即可**（不用再加 `--headed`）：

```bash
node catch.js "https://www.bilibili.com/video/BV另一个视频"
```

> 想换账号或登录态失效（B 站 cookie 约一个月过期）：重跑一次 `--headed` 流程即可。

## 配置文件

项目根目录 `cat_catch.config.json`：

```json
{
  "singleM4sFormat": "mp3"
}
```

| 配置项 | 默认 | 说明 |
|---|---|---|
| `singleM4sFormat` | `mp3` | **单个 m4s**（未参与音画配对的视频轨/音频轨）落盘时的输出格式。`mp3`/`wav` 会重编码只留声音（视频轨 → 提取音频）；`mp4`/`m4a`/`mkv` 等流拷贝；`m4s` 保留原样不转换 |

**只要音频**：`node catch.js "<url>" --pick audio` → 自动选最高码率音频轨，按配置转出 mp3。

## 全部参数

| 参数 | 默认 | 说明 |
|---|---|---|
| `-o, --out <dir>` | `./downloads` | 输出目录 |
| `-t, --timeout <ms>` | `45000` | 嗅探硬超时 |
| `--quiet <ms>` | `4000` | 静默判定窗口（无新资源多久后收工） |
| `-j, --concurrency <n>` | `6` | 分片/文件并发数 |
| `--pick <mode>` | `best` | `best` 智能选择 / `all` 全部 / `audio` 仅音频轨 / `1,3` 序号 / `list` 列出后交互 |
| `--format <fmt>` | `mp4` | HLS 输出封装（`ts` 则不转封装） |
| `--single-format <fmt>` | 读配置 | 单个 m4s 输出格式（覆盖配置项 singleM4sFormat） |
| `--name <tpl>` | `{title}.{ext}` | 文件名模板，支持 `{title}` `{ext}` `{n}` |
| `--headed` | 关 | 显示浏览器窗口（登录/调试） |
| `--no-autoplay` | 开 | 不模拟播放（某些站点会因此嗅探不到） |
| `--no-hook` | 开 | 关闭深度 hook 嗅探 |
| `--profile <dir>` | `./.catch-profile` | 持久化浏览器 profile（登录态） |
| `--keep-parts` | 关 | 合并后保留 m4s/ts 源文件 |
| `--dry-run` | 关 | 只嗅探，JSON 打印资源清单 |
| `-v, --verbose` | 关 | 详细日志 |

## 工作原理（对照猫抓）

| 猫抓扩展 | 本项目 |
|---|---|
| `chrome.webRequest` 监听 + 扩展名/MIME 白名单 | `page.on('response')` + 同三张表（`lib/filter.js`） |
| MAIN world 注入 search.js（hook fetch/XHR/JSON.parse 找隐藏 m3u8） | `context.addInitScript()` 注入同等 hook（`lib/hook-source.js`），`exposeBinding` 回传 |
| DNR 规则改写 Referer/Cookie | Node fetch 直接重放白名单请求头（`lib/headers.js`） |
| hls.js 解析 m3u8、软件 AES 解密 | `m3u8-parser` + Node `crypto` AES-128-CBC（IV 缺省=分片序号大端） |
| mux.js 转封装 mp4 | ffmpeg `-c copy`（流拷贝不重编码） |
| 播放器实际发请求才抓得到（B 站） | **增强**：直接解析 playurl JSON 结构，不依赖播放器行为 |

B 站流程：打开页面 → hook 拦截 playurl API 响应（`data.dash.video[]/audio[]`）→ 各取码率最高一档 → 带 Referer/Cookie 下载两路 m4s → ffmpeg 合并 `<标题>.mp4`。

## 限制（与猫抓一致或更严）

- ❌ **DRM**（Widevine/FairPlay/SAMPLE-AES-CTR）：检测即报错，不尝试破解
- ❌ **直播**（无 `#EXT-X-ENDLIST` 的清单、live.bilibili.com 等）：检测即提示
- ❌ **纯 blob/MSE 站点**（YouTube 等不暴露真实地址的）：需要 MSE 录制，未实现
- ❌ **MPD(DASH) 清单**：暂未支持（B 站不受影响——走 playurl 结构化通道）
- 登录才能看的视频：先 `--headed` 登录（见上）

## 目录结构

```
catch.js            CLI 入口
lib/
  sniffer.js        浏览器嗅探编排（response 监听 + hook + DOM 扫描 + settle）
  filter.js         扩展名/MIME 白名单判定（照抄猫抓三张表）
  hook-source.js    深度 hook 注入源码（fetch/XHR/JSON.parse/TextDecoder/atob）
  registry.js       URL 去重登记表
  autoplay.js       静音播放 + 播放按钮启发式点击
  domscan.js        跨 iframe video/audio 扫描
  headers.js        请求头白名单 + cookie 兜底
  picker.js         资源选择（best/all/交互）+ playurl 配对
  ffmpeg.js         ffmpeg-static 封装（音画合并/转封装）
  download/
    index.js        下载编排（音画配对、HLS 全流程）
    direct.js       直链流式下载 + Range→sec-fetch 重试阶梯
    m3u8.js         清单解析、master 选最高带宽、直播/DRM 检测
    segments.js     分片并发下载→解密→落盘→按序合并
    aes.js          AES-128-CBC（Node crypto）
    pool.js         并发池
    net.js          fetch 封装（超时/重试）
docs: PLAN.md       完整设计方案与猫抓源码调研笔记
```

## 已验证场景

- ✅ B 站视频页（playurl 结构化 → 音画合并 mp4）
- ✅ 通用 m3u8 直链（Apple bipbop → ts / mp4）
- ✅ AES-128 加密 HLS（oceans_aes → 解密合并 mp4）
- ✅ 直链 mp4（流式落盘 + 重试阶梯）
