#!/usr/bin/env node
/**
 * figma-bridge — ZCode ↔ Figma 桥接 MCP 服务器
 *
 * 零依赖、stdio、换行分隔 JSON-RPC 2.0（MCP 协议）。
 * 封装 Figma REST API (https://api.figma.com/v1)。
 *
 * 令牌解析顺序：
 *   1. 环境变量 FIGMA_PERSONAL_ACCESS_TOKEN（或 FIGMA_TOKEN）
 *   2. ~/.zcode/figma-bridge.json 中的 { "personalAccessToken": "figd_..." }
 *
 * 令牌创建：Figma → Settings → Security → Personal access tokens
 *   建议 scope：File content: Read（必需）、File comments: Write（评论）、Dev resources: Read（开发资源）
 */

import { createInterface } from "node:readline";
import { homedir } from "node:os";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const VERSION = "0.1.0";
const SERVER_NAME = "figma-bridge";
const API_BASE = "https://api.figma.com/v1";
const DEFAULT_PROTOCOL_VERSION = "2024-11-05";
const MAX_TEXT = 200_000; // 单个工具返回文本上限（字符）
const MAX_IMAGE_BYTES = 4_500_000; // 单张返回图片上限（字节）
const MAX_SCREENSHOT_NODES = 10;

// ---------------------------------------------------------------- token

let tokenCache;
function getToken() {
  if (tokenCache !== undefined) return tokenCache;
  const fromEnv = process.env.FIGMA_PERSONAL_ACCESS_TOKEN || process.env.FIGMA_TOKEN;
  if (fromEnv && fromEnv.trim()) return (tokenCache = fromEnv.trim());
  try {
    const raw = readFileSync(join(homedir(), ".zcode", "figma-bridge.json"), "utf8");
    const cfg = JSON.parse(raw);
    if (cfg && typeof cfg.personalAccessToken === "string" && cfg.personalAccessToken.trim()) {
      return (tokenCache = cfg.personalAccessToken.trim());
    }
  } catch {
    // 文件不存在或非法 → 视为未配置
  }
  return (tokenCache = null);
}

function requireToken() {
  const token = getToken();
  if (token) return token;
  throw new FigmaError(
    [
      "尚未配置 Figma 访问令牌。请任选其一：",
      "1. 在 ~/.zcode/figma-bridge.json 写入：{\"personalAccessToken\": \"figd_你的令牌\"}",
      "2. 设置环境变量 FIGMA_PERSONAL_ACCESS_TOKEN",
      "令牌获取：Figma 网页版 → 左上头像 → Settings → Security → Personal access tokens → Generate new token，",
      "并勾选 scope：File content: Read（必需）、File comments: Write（需要发评论时）、Dev resources: Read（可选）。",
      "也可以在 ZCode 中运行 figma-bridge 插件的 setup 命令，由助手代为配置和验证。",
    ].join("\n"),
  );
}

// ---------------------------------------------------------------- errors

class FigmaError extends Error {}

// ---------------------------------------------------------------- figma api

async function figmaRequest(path, { method = "GET", body } = {}) {
  const token = requireToken();
  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: {
        "X-Figma-Token": token,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    throw new FigmaError(`无法访问 api.figma.com：${e.message}。请检查本机网络或代理设置。`);
  }
  if (!res.ok) {
    let detail = "";
    try {
      detail = (await res.text()).slice(0, 500);
    } catch {}
    if (res.status === 401 || res.status === 403) {
      throw new FigmaError(`Figma 认证失败（HTTP ${res.status}）。请检查令牌是否有效、是否具有所需 scope${detail ? `。响应：${detail}` : ""}`);
    }
    if (res.status === 404) {
      throw new FigmaError(`资源不存在（HTTP 404）。请检查 file key、node id 或团队/项目 ID 是否正确${detail ? `。响应：${detail}` : ""}`);
    }
    if (res.status === 429) {
      throw new FigmaError(`已触发 Figma 速率限制（HTTP 429），请稍后重试${detail ? `。响应：${detail}` : ""}`);
    }
    throw new FigmaError(`Figma API 错误（HTTP ${res.status}）${detail ? `：${detail}` : ""}`);
  }
  return res.json();
}

async function fetchBinary(url) {
  const res = await fetch(url);
  if (!res.ok) throw new FigmaError(`下载渲染结果失败（HTTP ${res.status}）。Figma 渲染链接有时效性，请重新调用工具获取。`);
  return { buf: Buffer.from(await res.arrayBuffer()), mime: res.headers.get("content-type") || "image/png" };
}

async function fetchText(url) {
  const res = await fetch(url);
  if (!res.ok) throw new FigmaError(`下载渲染结果失败（HTTP ${res.status}）。Figma 渲染链接有时效性，请重新调用工具获取。`);
  return res.text();
}

// ---------------------------------------------------------------- helpers

function capText(str, hint) {
  if (str.length <= MAX_TEXT) return str;
  return `${str.slice(0, MAX_TEXT)}\n…[输出已截断，完整大小 ${str.length} 字符${hint ? `。${hint}` : ""}]`;
}

function stringify(value, hint) {
  return capText(JSON.stringify(value, null, 2), hint);
}

function normalizeNodeId(id) {
  const s = String(id).trim();
  return /^\d+-\d+$/.test(s) ? s.replace("-", ":") : s; // 链接里的 node-id=12-345 → API 的 12:345
}

function parseIds(value, what = "node id") {
  const arr = (Array.isArray(value) ? value : String(value ?? "").split(","))
    .map((s) => String(s).trim())
    .filter(Boolean)
    .map(normalizeNodeId);
  if (!arr.length) throw new FigmaError(`缺少 ${what}。可从 Figma 链接的 node-id= 参数获取，例如 12-345 → 12:345。`);
  return arr;
}

function textResult(text) {
  return { content: [{ type: "text", text }] };
}

// ---------------------------------------------------------------- tools

const TOOLS = [
  {
    name: "figma_get_me",
    description:
      "Verify the Figma connection: return the account bound to the configured personal access token (name, email, plan). Use this first to validate setup. 验证 Figma 令牌与账号连接。",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { title: "验证 Figma 连接", readOnlyHint: true },
    run: async () => textResult(stringify(await figmaRequest("/me"))),
  },
  {
    name: "figma_list_projects",
    description:
      "List all projects in a Figma team. Get the team id from a team page URL (figma.com/files/team/<team_id>/...) . 列出团队下的所有项目。",
    inputSchema: {
      type: "object",
      properties: { team_id: { type: "string", description: "Figma 团队 ID" } },
      required: ["team_id"],
      additionalProperties: false,
    },
    annotations: { title: "列出团队项目", readOnlyHint: true },
    run: async (args) => textResult(stringify(await figmaRequest(`/teams/${encodeURIComponent(args.team_id)}/projects`))),
  },
  {
    name: "figma_get_project_files",
    description:
      "List files inside a Figma project (file key, name, last modified, thumbnail). 列出项目中的所有设计文件。",
    inputSchema: {
      type: "object",
      properties: { project_id: { type: "string", description: "Figma 项目 ID" } },
      required: ["project_id"],
      additionalProperties: false,
    },
    annotations: { title: "列出项目文件", readOnlyHint: true },
    run: async (args) =>
      textResult(stringify(await figmaRequest(`/projects/${encodeURIComponent(args.project_id)}/files`))),
  },
  {
    name: "figma_get_file",
    description:
      "Get a Figma file's document tree (pages and frames). Use depth=2 (default) for an overview, increase to go deeper. Find the file key in a design URL: figma.com/design/<file_key>/.... 读取设计文件的页面与图层结构。",
    inputSchema: {
      type: "object",
      properties: {
        file_key: { type: "string", description: "文件 key，来自 Figma 链接 /design/<file_key>/…" },
        depth: { type: "number", description: "遍历深度，默认 2（页面+顶层对象）；需要更深层级时增大" },
      },
      required: ["file_key"],
      additionalProperties: false,
    },
    annotations: { title: "读取文件结构", readOnlyHint: true },
    run: async (args) => {
      const depth = Number.isFinite(Number(args.depth)) && Number(args.depth) > 0 ? Math.floor(Number(args.depth)) : 2;
      const data = await figmaRequest(`/files/${encodeURIComponent(args.file_key)}?depth=${depth}`);
      const overview = {
        name: data.name,
        lastModified: data.lastModified,
        version: data.version,
        role: data.role,
        thumbnailUrl: data.thumbnailUrl,
        depth,
        pages: (data.document?.children ?? []).map((p) => ({
          id: p.id,
          name: p.name,
          type: p.type,
          children: (p.children ?? []).map((c) => ({ id: c.id, name: c.name, type: c.type })),
        })),
      };
      return textResult(
        stringify(overview, "需要更深层级时请增大 depth 参数，或用 figma_get_nodes 读取具体节点。"),
      );
    },
  },
  {
    name: "figma_get_nodes",
    description:
      "Get full node details (layout, fills, strokes, text, effects, children) for specific node ids in a file. Node ids look like 12:345 (URL form 12-345 also accepted). Pass geometry=path to include vector paths. 读取具体节点的完整设计属性（用于设计转代码）。",
    inputSchema: {
      type: "object",
      properties: {
        file_key: { type: "string", description: "文件 key" },
        ids: {
          type: ["string", "array"],
          description: "节点 id，如 \"12:345\" 或 [\"12:345\",\"9:10\"]；支持链接形式 12-345",
        },
        geometry: { type: "string", enum: ["path", "points", "instances"], description: "可选，附带矢量路径数据" },
      },
      required: ["file_key", "ids"],
      additionalProperties: false,
    },
    annotations: { title: "读取节点详情", readOnlyHint: true },
    run: async (args) => {
      const ids = parseIds(args.ids);
      const q = new URLSearchParams({ ids: ids.join(",") });
      if (args.geometry) q.set("geometry", String(args.geometry));
      const data = await figmaRequest(`/files/${encodeURIComponent(args.file_key)}/nodes?${q}`);
      return textResult(
        stringify(data, "节点很多时输出可能被截断，请分批请求更少的节点 id。"),
      );
    },
  },
  {
    name: "figma_get_screenshot",
    description:
      "Render node(s) of a Figma file and RETURN THE ACTUAL IMAGES so the assistant can see the design. Essential for design review and design-to-code. format png (default) | jpg | svg; scale 0.01–4 (default 2). 渲染设计稿截图，让助手直接“看”到设计。",
    inputSchema: {
      type: "object",
      properties: {
        file_key: { type: "string", description: "文件 key" },
        node_ids: {
          type: ["string", "array"],
          description: "要渲染的节点 id，可多个；如 \"12:345\" 或 [\"12:345\",\"9:10\"]（链接形式 12-345 亦可）",
        },
        format: { type: "string", enum: ["png", "jpg", "svg"], description: "渲染格式，默认 png" },
        scale: { type: "number", description: "缩放倍率 0.01–4，默认 2" },
      },
      required: ["file_key", "node_ids"],
      additionalProperties: false,
    },
    annotations: { title: "渲染设计截图", readOnlyHint: true },
    run: async (args) => {
      const ids = parseIds(args.node_ids);
      if (ids.length > MAX_SCREENSHOT_NODES) {
        throw new FigmaError(`一次最多渲染 ${MAX_SCREENSHOT_NODES} 个节点（当前 ${ids.length}）。请分批调用。`);
      }
      const format = ["png", "jpg", "svg"].includes(args.format) ? args.format : "png";
      const scale =
        format === "svg"
          ? undefined
          : Math.min(4, Math.max(0.01, Number.isFinite(Number(args.scale)) ? Number(args.scale) : 2));
      const q = new URLSearchParams({ ids: ids.join(","), format });
      if (scale !== undefined) q.set("scale", String(scale));
      const data = await figmaRequest(`/images/${encodeURIComponent(args.file_key)}?${q}`);
      if (data.err) throw new FigmaError(`渲染失败：${data.err}`);
      const entries = Object.entries(data.images ?? {});
      if (!entries.length) throw new FigmaError("没有可渲染的节点，请检查 node id 是否属于该文件。");
      const content = [];
      for (const [nodeId, url] of entries) {
        if (!url) {
          content.push({ type: "text", text: `节点 ${nodeId}：渲染结果为空（可能节点本身不可见）。` });
          continue;
        }
        if (format === "svg") {
          const svg = await fetchText(url);
          content.push({ type: "text", text: `节点 ${nodeId} 的 SVG：\n${capText(svg, "SVG 过大时可改用 png/jpg。")}` });
        } else {
          const { buf, mime } = await fetchBinary(url);
          if (buf.length > MAX_IMAGE_BYTES) {
            content.push({
              type: "text",
              text: `节点 ${nodeId}：图片太大（${(buf.length / 1e6).toFixed(1)}MB）未返回。请降低 scale 或改用 svg。`,
            });
            continue;
          }
          content.push({
            type: "text",
            text: `节点 ${nodeId}（${format.toUpperCase()}，scale=${scale}，${(buf.length / 1024).toFixed(0)}KB）：`,
          });
          content.push({ type: "image", data: buf.toString("base64"), mimeType: mime });
        }
      }
      return { content };
    },
  },
  {
    name: "figma_get_image_fills",
    description:
      "List URLs of images used as fills in a file (photos, bitmaps) — useful to export/download image assets. 列出文件中使用的位图资源链接。",
    inputSchema: {
      type: "object",
      properties: { file_key: { type: "string", description: "文件 key" } },
      required: ["file_key"],
      additionalProperties: false,
    },
    annotations: { title: "列出位图资源", readOnlyHint: true },
    run: async (args) => {
      const data = await figmaRequest(`/files/${encodeURIComponent(args.file_key)}/images`);
      return textResult(stringify(data, "链接有时效性，过期后请重新获取。"));
    },
  },
  {
    name: "figma_get_components",
    description: "List published/local components in a file. 列出文件中的组件。",
    inputSchema: {
      type: "object",
      properties: { file_key: { type: "string", description: "文件 key" } },
      required: ["file_key"],
      additionalProperties: false,
    },
    annotations: { title: "列出组件", readOnlyHint: true },
    run: async (args) => textResult(stringify(await figmaRequest(`/files/${encodeURIComponent(args.file_key)}/components`))),
  },
  {
    name: "figma_get_styles",
    description: "List color/text/effect/grid styles defined in a file — the design tokens. 列出文件中的样式（设计令牌）。",
    inputSchema: {
      type: "object",
      properties: { file_key: { type: "string", description: "文件 key" } },
      required: ["file_key"],
      additionalProperties: false,
    },
    annotations: { title: "列出样式", readOnlyHint: true },
    run: async (args) => textResult(stringify(await figmaRequest(`/files/${encodeURIComponent(args.file_key)}/styles`))),
  },
  {
    name: "figma_get_dev_resources",
    description:
      "List dev resources (links to specs, stories, tickets) attached to nodes of a file. 列出节点上挂载的开发资源链接。",
    inputSchema: {
      type: "object",
      properties: {
        file_key: { type: "string", description: "文件 key" },
        node_ids: { type: ["string", "array"], description: "可选，限定节点（链接形式 12-345 亦可）" },
      },
      required: ["file_key"],
      additionalProperties: false,
    },
    annotations: { title: "列出开发资源", readOnlyHint: true },
    run: async (args) => {
      const q = new URLSearchParams();
      if (args.node_ids) q.set("node_ids", parseIds(args.node_ids).join(","));
      const suffix = q.toString() ? `?${q}` : "";
      const data = await figmaRequest(`/files/${encodeURIComponent(args.file_key)}/dev_resources${suffix}`);
      return textResult(stringify(data));
    },
  },
  {
    name: "figma_get_comments",
    description: "Read comments on a Figma file. 读取设计稿上的评论。",
    inputSchema: {
      type: "object",
      properties: { file_key: { type: "string", description: "文件 key" } },
      required: ["file_key"],
      additionalProperties: false,
    },
    annotations: { title: "读取评论", readOnlyHint: true },
    run: async (args) => textResult(stringify(await figmaRequest(`/files/${encodeURIComponent(args.file_key)}/comments`))),
  },
  {
    name: "figma_post_comment",
    description:
      "Post a comment on a Figma file, optionally anchored to a node (and an x/y offset inside it). Requires a token with file comments write scope. 在设计稿上发表评论。",
    inputSchema: {
      type: "object",
      properties: {
        file_key: { type: "string", description: "文件 key" },
        message: { type: "string", description: "评论文本" },
        node_id: { type: "string", description: "可选，锚定节点（链接形式 12-345 亦可）" },
        x: { type: "number", description: "可选，节点内偏移 x" },
        y: { type: "number", description: "可选，节点内偏移 y" },
      },
      required: ["file_key", "message"],
      additionalProperties: false,
    },
    annotations: { title: "发表评论", readOnlyHint: false },
    run: async (args) => {
      const body = { message: String(args.message) };
      if (args.node_id) {
        body.client_meta = {
          node_id: normalizeNodeId(args.node_id),
          ...(Number.isFinite(Number(args.x)) || Number.isFinite(Number(args.y))
            ? { node_offset: { x: Number(args.x) || 0, y: Number(args.y) || 0 } }
            : {}),
        };
      }
      const data = await figmaRequest(`/files/${encodeURIComponent(args.file_key)}/comments`, {
        method: "POST",
        body,
      });
      return textResult(stringify(data));
    },
  },
];

const TOOL_MAP = new Map(TOOLS.map((t) => [t.name, t]));

// ---------------------------------------------------------------- rpc

function write(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

function reply(id, result) {
  write({ jsonrpc: "2.0", id, result });
}

function replyError(id, code, message) {
  write({ jsonrpc: "2.0", id, error: { code, message } });
}

let pending = 0; // 在途请求计数：stdin 关闭后要等它们完成再退出

async function handleToolCall(id, params) {
  const name = params?.name;
  const args = params?.arguments ?? {};
  const tool = TOOL_MAP.get(name);
  if (!tool) {
    replyError(id, -32602, `Unknown tool: ${name}`);
    return;
  }
  pending++;
  try {
    reply(id, await tool.run(args));
  } catch (e) {
    reply(id, { content: [{ type: "text", text: `❌ ${e.message}` }], isError: true });
  } finally {
    pending--;
    if (stdinEnded && pending === 0) process.exit(0);
  }
}

let stdinEnded = false;

function handleRequest(msg) {
  const { id, method, params = {} } = msg;
  switch (method) {
    case "initialize": {
      const requested = typeof params.protocolVersion === "string" ? params.protocolVersion : null;
      const protocolVersion = requested && /^\d{4}-\d{2}-\d{2}$/.test(requested) ? requested : DEFAULT_PROTOCOL_VERSION;
      reply(id, {
        protocolVersion,
        capabilities: { tools: {} },
        serverInfo: { name: SERVER_NAME, title: "Figma Bridge", version: VERSION },
        instructions:
          "Figma Bridge bridges ZCode to the Figma REST API. Start with figma_get_me to verify the token; " +
          "use figma_get_file/figma_get_nodes for structure, figma_get_screenshot to SEE the design, " +
          "figma_get_image_fills for bitmap assets, and figma_get_comments/figma_post_comment for feedback. " +
          "Token lives in FIGMA_PERSONAL_ACCESS_TOKEN or ~/.zcode/figma-bridge.json.",
      });
      return;
    }
    case "ping":
      reply(id, {});
      return;
    case "tools/list":
      reply(id, { tools: TOOLS.map(({ run, ...rest }) => rest) });
      return;
    case "tools/call":
      handleToolCall(id, params);
      return;
    case "resources/list":
      reply(id, { resources: [] });
      return;
    case "prompts/list":
      reply(id, { prompts: [] });
      return;
    default:
      replyError(id, -32601, `Method not found: ${method}`);
  }
}

const rl = createInterface({ input: process.stdin, terminal: false });
rl.on("line", (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let msg;
  try {
    msg = JSON.parse(trimmed);
  } catch {
    return;
  }
  if (!msg || typeof msg !== "object") return;
  if (typeof msg.id !== "number" && typeof msg.id !== "string") {
    // 通知（initialized / cancelled 等）无需应答
    return;
  }
  handleRequest(msg);
});

process.on("uncaughtException", (err) => {
  process.stderr.write(`[figma-bridge] uncaught exception: ${err?.stack || err}\n`);
});
process.on("unhandledRejection", (err) => {
  process.stderr.write(`[figma-bridge] unhandled rejection: ${err?.stack || err}\n`);
});
process.stdin.on("end", () => {
  stdinEnded = true;
  if (pending === 0) process.exit(0);
});
