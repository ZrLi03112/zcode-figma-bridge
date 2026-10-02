<div align="center">

<img src="assets/icon.png" width="96" alt="Figma Bridge">

# Figma Bridge（Figma 桥接）

**把 Figma 接入 ZCode：让 Agent 看得见设计稿，写出还原度更高的代码。**

对标 ChatGPT 官方 Figma 应用的体验 —— 连接账号、浏览文件、读取设计、渲染截图、设计转代码、同步评论。

[![ZCode Plugin](https://img.shields.io/badge/ZCode-Plugin-blue)](https://zcode.ai) [![Version](https://img.shields.io/badge/version-0.1.0-green)]() [![Node](https://img.shields.io/badge/node-%E2%89%A518-brightgreen)]() [![License: MIT](https://img.shields.io/badge/license-MIT-orange)](LICENSE)

</div>

---

## ✨ 功能

- 🧭 **浏览定位** — 团队 → 项目 → 文件逐层浏览，或直接解析 `figma.com/design/...` 链接
- 👁 **看见设计** — 将任意节点渲染为 PNG/JPG/SVG 并**以真实图片返回**，Agent 直接"看图"作业
- 🎨 **设计转代码** — 读取节点布局（auto layout）、填充、描边、圆角、文字等完整属性，推导 HTML/CSS/组件结构
- 🧱 **设计令牌** — 读取文件的颜色、字体、效果样式与组件清单，对齐既有设计系统
- 🖼 **资源导出** — 切图渲染 + 文件内位图资源链接提取
- 💬 **评论同步** — 读取设计稿评论，也能以锚定节点的方式代写评审意见

## 🧰 提供的 MCP 工具（12 个）

| 工具 | 用途 |
|---|---|
| `figma_get_me` | 验证令牌与账号连接 |
| `figma_list_projects` | 团队 ID → 项目列表 |
| `figma_get_project_files` | 项目 ID → 文件列表 |
| `figma_get_file` | 文件结构总览（页面 + 顶层 Frame，支持 depth） |
| `figma_get_nodes` | 节点完整属性（布局/填充/文字/效果），设计转代码核心 |
| `figma_get_screenshot` | 渲染节点并返回真实图片（png/jpg/svg，scale 0.01–4） |
| `figma_get_image_fills` | 文件内位图资源链接 |
| `figma_get_components` | 文件组件清单 |
| `figma_get_styles` | 颜色/字体/效果样式（设计令牌） |
| `figma_get_dev_resources` | 节点上挂载的开发资源 |
| `figma_get_comments` | 读取设计稿评论 |
| `figma_post_comment` | 发表评论（可锚定节点与偏移） |

## 📦 安装

在 ZCode 中打开 **插件市场 → 添加 → 添加插件市场**，粘贴本仓库地址：

```
https://github.com/ZrLi03112/zcode-figma-bridge
```

然后在 **个人 → figma-bridge-market** 中找到「**Figma 桥接**」，点击**安装**。

## 🔑 令牌配置

1. 创建 Figma Personal Access Token：Figma 网页版 → 头像 → **Settings → Security → Personal access tokens → Generate new token**，勾选 scope：

   | Scope | 用途 |
   |---|---|
   | **File content: Read** | 必需 —— 浏览与读取设计稿 |
   | File comments: Write | 可选 —— 发表评论 |
   | Dev resources: Read | 可选 —— 读取开发资源 |

2. 配置令牌（二选一）：
   - 写入文件 `~/.zcode/figma-bridge.json`（推荐，桌面版更可靠）：

     ```json
     { "personalAccessToken": "figd_xxxxxxxxxxxx" }
     ```

   - 或设置环境变量 `FIGMA_PERSONAL_ACCESS_TOKEN`

3. 安装插件后运行其 **figma-setup** 命令，可由 Agent 引导完成上述配置并自动调用 `figma_get_me` 验证连接。

> 🔒 令牌只保存在你本机，不会进入仓库或插件安装包。

## 🚀 用法示例

安装后在 ZCode 新建任务，直接发：

```text
用 figma-bridge 读取这条设计稿，给我看截图，然后把整个卡片组件还原成 React + TailCSS：
https://www.figma.com/design/<file_key>/xxx?node-id=12-345
```

```text
对比这条 Figma 设计稿和我下面贴的页面截图，列出还原度差异（间距、字号、颜色、圆角），
并把差异意见用 figma_post_comment 回写到设计稿上。
```

```text
从这条链接的设计稿里导出所有插画位图，下载到项目 assets/ 目录。
```

## ⚙️ 工作原理

```
ZCode 会话 ──MCP(stdio)──▶ figma-mcp.mjs（零依赖 Node 脚本）──HTTPS──▶ api.figma.com
```

插件由三部分组成：

- [`figma-bridge/mcp/figma-mcp.mjs`](figma-bridge/mcp/figma-mcp.mjs) — MCP 服务器，封装 Figma REST API，无任何 npm 依赖
- [`figma-bridge/skills/figma-bridge/SKILL.md`](figma-bridge/skills/figma-bridge/SKILL.md) — 技能文档，教 Agent 设计转代码/评审工作流
- [`figma-bridge/commands/figma-setup.md`](figma-bridge/commands/figma-setup.md) — `/figma-setup` 命令，令牌配置引导

## 🛠 故障排查

| 现象 | 处理 |
|---|---|
| `figma_*` 工具不存在 | 重启 ZCode 会话；检查 **设置 → MCP** 中 figma-bridge 状态 |
| MCP 启动失败（找不到 node） | 把服务器命令改为 Node 绝对路径（终端 `which node` 获取） |
| HTTP 401 | 令牌无效/被撤销或 scope 不足，重新生成并更新配置 |
| HTTP 429 | 触发 Figma 速率限制，稍后重试 |
| 截图返回过大 | 降低 `scale` 或改用 `svg` 格式 |

## 🔄 更新插件

修改源码 → 同步递增 [`plugin.json`](figma-bridge/.zcode-plugin/plugin.json) 与 [marketplace.json](marketplace.json) 的 `version` → 提交推送 → ZCode **市场源齿轮 → 刷新该市场 → 插件详情 → 更新**。

## 📄 许可与声明

[MIT](LICENSE) © ZrLi03112

Figma® 及其 logo 是 Figma, Inc. 的商标。本插件为**非官方**第三方工具，用于指示对 Figma 服务的兼容性，与 Figma, Inc. 无隶属或背书关系。
