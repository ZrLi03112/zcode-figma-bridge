---
description: 配置并验证 figma-bridge 插件的 Figma 访问令牌（Personal Access Token）
---

帮用户完成 figma-bridge MCP 服务器的 Figma 令牌配置。按以下流程执行：

## 1. 获取令牌

询问用户是否已有 Figma Personal Access Token（`figd_` 开头）。没有则引导：

1. 打开 Figma 网页版 → 左上角头像 → **Settings**。
2. 进入 **Security** 标签 → 找到 **Personal access tokens** → **Generate new token**。
3. 填写令牌名称（如 `zcode-figma-bridge`），scope 勾选：
   - **File content: Read**（必需——浏览与读取设计稿）
   - **File comments: Write**（可选——需要在设计稿上发评论）
   - **Dev resources: Read**（可选——读取开发资源链接）
4. 生成后**立即复制**（令牌只显示一次）。

## 2. 写入配置

拿到令牌后，将其写入 `~/.zcode/figma-bridge.json`（文件已存在时保留其中其他字段，只更新 `personalAccessToken`）：

```json
{ "personalAccessToken": "figd_用户提供的令牌" }
```

安全要求：不要把令牌写入插件源码、终端历史或任何版本控制的文件；用户若直接在聊天中粘贴令牌，提醒完成后可随时更新该文件来轮换。

## 3. 验证连接

调用 MCP 工具 `figma_get_me`：

- 成功 → 向用户报告连接的账号名与邮箱，说明现在可以在任务中直接使用 Figma 链接（设计转代码、截图、评论等）。
- 失败 → 按错误信息排查：令牌无效/被撤销（重新生成）、scope 不足（补勾选）、网络无法访问 api.figma.com（检查代理）。

## 4. 工具不可用时

若 `figma_*` 工具在会话中不存在（配置前安装的会话需要新会话才会加载），或 ZCode **设置 → MCP** 中 `figma-bridge` 显示启动失败：

- 提示用户重启会话或检查 MCP 状态。
- 若错误与找不到 `node` 有关：在终端运行 `which node` 取得绝对路径（如 `/Users/xxx/.nvm/versions/node/v22.x.x/bin/node`），在 **设置 → MCP** 的 figma-bridge 服务器配置中把命令 `node` 改为该绝对路径。
