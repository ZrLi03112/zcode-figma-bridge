---
name: figma-bridge
description: >
  Connect ZCode to Figma through the figma-bridge MCP tools: browse files and projects,
  read design structure, render node screenshots so the assistant can SEE the design,
  export image assets, and read/post comments. Use when the user mentions Figma, shares a
  figma.com design link, or asks for 设计稿相关的工作：设计转代码、前端还原、设计评审、
  还原度对比、导出切图资源、查看设计评论. Requires a configured Figma personal access
  token — if tools report a missing token, run the figma-bridge plugin's setup command.
---

# Figma Bridge：在 ZCode 中使用 Figma

本插件通过 MCP 服务器（`figma-bridge`）提供 12 个 `figma_*` 工具，全部走 Figma REST API。当前任务涉及 Figma 设计稿时，按下面的流程使用它们。

## 前置条件：令牌

- 令牌来源：Figma 网页版 → 头像 → **Settings → Security → Personal access tokens → Generate new token**，scope 勾选 **File content: Read**（必需）、**File comments: Write**（要发评论时）、**Dev resources: Read**（可选）。
- 配置位置（二选一）：环境变量 `FIGMA_PERSONAL_ACCESS_TOKEN`，或文件 `~/.zcode/figma-bridge.json`（内容 `{"personalAccessToken": "figd_…"}`）。
- 用户没有配置时，引导其运行 figma-bridge 插件的 **setup 命令**，或按上面路径代为写入并验证。
- 连接验证：调用 `figma_get_me`，返回账号信息即配置成功。

## 从 Figma 链接提取参数

```text
https://www.figma.com/design/<file_key>/文件名?node-id=12-345
                            └─ file_key          └─ node id：把 12-345 转成 12:345 再传给工具
```

工具同时接受两种形式（`12-345` 会被自动转换），但优先教模型用 `:` 形式。

## 工具速查

| 工具 | 用途 |
|---|---|
| `figma_get_me` | 验证令牌/账号连接 |
| `figma_list_projects` | 团队 ID → 项目列表 |
| `figma_get_project_files` | 项目 ID → 文件列表 |
| `figma_get_file` | 文件结构总览（页面、顶层 Frame），`depth` 默认 2 |
| `figma_get_nodes` | 具体节点的完整属性（布局/填充/文字/效果），设计转代码的核心数据源 |
| `figma_get_screenshot` | 渲染节点并**返回真实图片**，让助手直接看到设计 |
| `figma_get_image_fills` | 文件内位图资源链接（照片/切图） |
| `figma_get_components` / `figma_get_styles` | 组件清单 / 样式（颜色、字体等设计令牌） |
| `figma_get_dev_resources` | 节点上挂的开发资源链接 |
| `figma_get_comments` / `figma_post_comment` | 读/发设计稿评论 |

## 推荐工作流

### 1. 设计转代码（design to code）

1. 从用户给的 Figma 链接解析 `file_key` 和 `node-id`。
2. `figma_get_screenshot` 渲染该节点（scale 2）→ 先看设计全貌。
3. `figma_get_nodes` 读取同一节点 → 从 `absoluteBoundingBox`、`layoutMode`（auto layout）、`fills`、`strokes`、`cornerRadius`、`characters` 等字段推导 CSS/组件结构；容器复杂时先看 `depth=2` 的结构树再逐层下钻。
4. `figma_get_styles` / `figma_get_components` 对齐项目的设计令牌与已有组件。
5. 位图（照片、Logo）：`figma_get_image_fills` 拿链接，或 `figma_get_screenshot` 指定该子节点导出。
6. 写代码；需要复核时再截图对比实现效果。

### 2. 设计评审 / 还原度对比

1. `figma_get_screenshot` 拿设计图。
2. 与用户实现的页面（截图/描述）逐项对比：布局、间距、颜色、字号字重、圆角、状态。
3. 差异整理成清单；用户要求回写意见时用 `figma_post_comment`（可锚定 `node_id`）。

### 3. 浏览与检索

- 用户只说"团队/项目"名字没给链接时：`figma_list_projects`（需要团队 ID，可让用户从 Figma 团页页 URL 复制）→ `figma_get_project_files` → 找到目标文件再进入上面两个流程。
- `figma_get_file` 的返回是精简总览（页面+顶层对象）；找不到目标 Frame 时增大 `depth` 或让用户直接给链接。

## 注意事项

- **先截图后写码**：涉及"做出来像不像"的任务，必须先 `figma_get_screenshot` 看图，不要只凭节点数据想象。
- 渲染链接有时效性，过期就重新调用工具；截图单次最多 10 个节点，图片过大（>4.5MB）时降低 `scale` 或改 `svg`。
- 节点详情可能非常大：一次取少量节点，输出被截断就分批。
- API 有速率限制；429 时稍等重试，不要并发轰炸。
- 评论写入需要 `File comments: Write` scope 的令牌；仅读操作不需要。
- MCP 工具不可用（`figma_*` 工具不存在）时：检查 ZCode **设置 → MCP** 中 `figma-bridge` 服务器状态；若启动失败提示找不到 `node`，把命令改为 Node 绝对路径（终端 `which node` 获取）。
