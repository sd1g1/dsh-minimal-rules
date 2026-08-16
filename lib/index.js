// dsh-minimal-rules —— 极简模式（minimal / minimal-fast）规则自动附加插件。
//
// 宿主侧：
//   - 在 agent/pre-step 中，仅对极简模式、且会话还没有任何历史消息（首条消息）时，
//     根据当前模式读取规则内容并附加到第一条用户消息开头：
//       global        -> 仅读取 ~/.dsh/AGENTS.md（或 $DSH_HOME/AGENTS.md）
//       global+project -> 再读取 cwd/AGENTS.md
//       all+creative  -> 再读取创造模式关键文档索引
//   - 内容使用 XML 风格标记包裹；
//   - 通过 /dsh-minimal-rules/config 提供模式读取和持久化。
//
// 浏览器侧（lib/client.js）：
//   - 在输入框权限下拉菜单右侧的 conversation.input.left 槽位渲染一个下拉菜单；
//   - 可选模式：global / global+project / all+creative；
//   - 默认 global+project，模式保存到宿主配置文件，重启后仍然生效。

import { realpathSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const name = "dsh-minimal-rules";
export const inject = ["webServer"];

export const RULE_MODES = Object.freeze(["global", "global+project", "all+creative"]);

export const DEFAULT_CONFIG = Object.freeze({
  mode: "global+project",
});

const CONFIG_FILE_NAME = "dsh-minimal-rules.json";

const PLUGIN_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

export function configPath(dshHome = process.env.DSH_HOME || join(homedir(), ".dsh")) {
  return join(dshHome, CONFIG_FILE_NAME);
}

/** 定位 DSH 安装目录（@deepseek-ai/dsh 包根目录）。 */
export function resolveDshInstallDir() {
  try {
    const entry = realpathSync(process.argv[1]);
    const libDir = dirname(entry);
    if (basename(libDir) === "lib" && basename(dirname(libDir)) === "dsh" && basename(dirname(dirname(libDir))) === "@deepseek-ai") {
      return dirname(libDir);
    }
  } catch {
    // 忽略定位失败，后续按无安装目录处理。
  }
  return null;
}

export function normalizeMode(value) {
  return RULE_MODES.includes(value) ? value : DEFAULT_CONFIG.mode;
}

export async function readConfigFile(filePath = configPath()) {
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw);
    return {
      mode: normalizeMode(parsed?.mode),
    };
  } catch (error) {
    if (error?.code !== "ENOENT") {
      // 配置文件损坏时按默认值继续，不阻塞插件。
      console.warn(`dsh-minimal-rules: cannot read config "${filePath}" (${String(error)}); using defaults`);
    }
    return { ...DEFAULT_CONFIG };
  }
}

export async function writeConfigFile(config, filePath = configPath()) {
  const next = {
    ...DEFAULT_CONFIG,
    ...config,
    mode: normalizeMode(config?.mode),
  };
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return next;
}

/** 解析会话当前实际使用的 preset：最新的 agent-preset/selected 事件优先。 */
export function resolveAgentPreset(agent) {
  const session = agent?.session;
  if (session == null) return undefined;
  if (Array.isArray(session.events)) {
    for (let index = session.events.length - 1; index >= 0; index -= 1) {
      const event = session.events[index];
      if (event?.type === "agent-preset/selected") return event.data?.agentPreset;
    }
  }
  return session.header?.agentPreset;
}

/** 只对极简模式（内置 minimal 或 dsh-minimal-bash-fix 的 minimal-fast）启用。 */
export function isMinimalPreset(agent) {
  const preset = resolveAgentPreset(agent);
  return preset === "minimal" || preset === "minimal-fast";
}

/** 仅当会话还没有任何已落地的消息时，才视为“首条消息”。 */
export function isFirstMessage(agent) {
  if (typeof agent?.session?.deriveMessages !== "function") return false;
  const messages = agent.session.deriveMessages();
  return Array.isArray(messages) && messages.length === 0;
}

/** 把一段原文用 XML 风格标记包裹；空内容返回 null。 */
export function wrapSection(tag, content) {
  const text = typeof content === "string" ? content.trim() : "";
  if (text.length === 0) return null;
  return `<${tag}>\n${text}\n</${tag}>\n\n`;
}

/** 兼容旧名称：默认使用 AGENTS.md 标签包裹。 */
export function wrapAgentsMd(content) {
  return wrapSection("AGENTS.md", content);
}

/**
 * 将前缀文本附加到 decision 中第一条 user 消息的文本块开头。
 * 保留原消息 id、source 和其他 content block；返回新的 decision。
 */
export function attachToFirstMessage(decision, prefix) {
  if (decision?.kind !== "enter" || !Array.isArray(decision.messages) || decision.messages.length === 0) {
    return decision;
  }
  const messages = decision.messages;
  const targetIndex = messages.findIndex((message) => message?.role === "user" && Array.isArray(message.content));
  if (targetIndex === -1) return decision;

  const original = messages[targetIndex];
  const content = original.content.map((block) => ({ ...block }));
  const textIndex = content.findIndex((block) => block?.type === "text");
  if (textIndex === 0) {
    const block = content[0];
    content[0] = {
      ...block,
      text: prefix + (typeof block.text === "string" ? block.text : ""),
    };
  } else {
    // 无论第一条是否是文本，都让规则内容位于 content 最前面。
    content.unshift({ type: "text", text: prefix });
  }

  const nextMessages = [...messages];
  nextMessages[targetIndex] = { ...original, content };
  return { ...decision, messages: nextMessages };
}

async function readFirstExisting(baseDir, candidates) {
  if (typeof baseDir !== "string" || baseDir.length === 0) return null;
  for (const candidate of candidates) {
    try {
      const content = await readFile(join(baseDir, ...candidate), "utf8");
      if (content.trim().length > 0) return content;
    } catch (error) {
      if (error?.code !== "ENOENT" && error?.code !== "EISDIR" && error?.code !== "ENOTDIR") {
        console.warn(`dsh-minimal-rules: cannot read "${join(baseDir, ...candidate)}" (${String(error)})`);
      }
    }
  }
  return null;
}

/** 读取 ~/.dsh 下的全局规则文件。 */
export async function loadGlobalRules(dshHome) {
  const content = await readFirstExisting(dshHome, [
    ["AGENTS.md"],
    ["agents.md"],
  ]);
  return wrapSection("DSH_AGENTS.md", content);
}

/** 读取 cwd 下的项目规则文件。 */
export async function loadProjectRules(cwd) {
  const content = await readFirstExisting(cwd, [
    ["AGENTS.md"],
    ["agents.md"],
  ]);
  return wrapSection("PROJECT_AGENTS.md", content);
}

/** 读取创造模式关键文档索引（优先使用插件自带 creative.md）。 */
export async function loadCreativeIndex(dshInstallDir) {
  // 索引文件随插件分发，存放在插件根目录。
  const local = await readFirstExisting(PLUGIN_ROOT, [
    ["creative.md"],
    ["creative-index.md"],
    ["INDEX.md"],
  ]);
  if (local !== null) return wrapSection("CREATIVE_INDEX.md", local);

  // 容错：如果插件内没有索引文件，再尝试 DSH 安装目录中的 cordis preset。
  if (typeof dshInstallDir === "string" && dshInstallDir.length > 0) {
    const installed = await readFirstExisting(dshInstallDir, [
      ["config", "agent-presets", "cordis", "INDEX.md"],
      ["config", "agent-presets", "cordis", "index.md"],
    ]);
    if (installed !== null) return wrapSection("CREATIVE_INDEX.md", installed);
  }

  // 最后回退生成指向关键文档的链接。
  const docs = [
    "config/agent-presets/cordis/agent.cordis.yml",
    "config/agent-presets/cordis/skills/cordis-plugin-development/SKILL.md",
    "config/agent-presets/cordis/skills/editing-cordis-compositions/SKILL.md",
  ];
  const lines = docs.map((doc) => `- ${doc}`);
  return wrapSection("CREATIVE_INDEX.md", lines.join("\n"));
}

/** 兼容旧函数：读取 cwd 下的 AGENTS.md，使用旧 AGENTS.md 标签。 */
export async function loadAgentsMd(cwd) {
  const content = await readFirstExisting(cwd, [
    ["AGENTS.md"],
    ["agents.md"],
  ]);
  return wrapAgentsMd(content);
}

/** 按模式组装要注入的规则内容；没有任何可用内容时返回 null。 */
export async function loadRulesByMode(mode, dshHome, dshInstallDir, cwd) {
  const normalized = normalizeMode(mode);
  const sections = [];

  if (normalized === "global" || normalized === "global+project" || normalized === "all+creative") {
    const global = await loadGlobalRules(dshHome);
    if (global !== null) sections.push(global);
  }

  if (normalized === "global+project" || normalized === "all+creative") {
    const project = await loadProjectRules(cwd);
    if (project !== null) sections.push(project);
  }

  if (normalized === "all+creative") {
    const creative = await loadCreativeIndex(dshInstallDir);
    if (creative !== null) sections.push(creative);
  }

  return sections.length > 0 ? sections.join("") : null;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new Error("request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function jsonResponse(res, status, value) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(value));
}

/**
 * 创建模式配置路由。GET 返回当前模式；POST 写入并持久化。
 * 使用闭包中的可变 mode，避免每次首条消息都读盘。
 */
export function createConfigRoute(getConfig, setConfig) {
  return async (req, res) => {
    if (req.method === "GET") {
      jsonResponse(res, 200, { mode: getConfig().mode });
      return;
    }

    if (req.method === "HEAD") {
      res.writeHead(200, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      });
      res.end();
      return;
    }

    if (req.method === "POST") {
      try {
        const raw = await readBody(req);
        const parsed = JSON.parse(raw || "{}");
        const mode = normalizeMode(parsed?.mode);
        if (!RULE_MODES.includes(parsed?.mode)) {
          jsonResponse(res, 400, { error: `mode must be one of: ${RULE_MODES.join(", ")}` });
          return;
        }
        const next = await setConfig({ mode });
        jsonResponse(res, 200, { mode: next.mode });
      } catch (error) {
        jsonResponse(res, 500, { error: String(error?.message ?? error) });
      }
      return;
    }

    res.writeHead(405, { allow: "GET, HEAD, POST" });
    res.end();
  };
}

export function apply(ctx, options = {}) {
  const dshHome = typeof options.dshHome === "string" && options.dshHome.length > 0
    ? options.dshHome
    : process.env.DSH_HOME || join(homedir(), ".dsh");
  const dshInstallDir = typeof options.dshInstallDir === "string" && options.dshInstallDir.length > 0
    ? options.dshInstallDir
    : resolveDshInstallDir();
  const filePath = typeof options.configPath === "string" && options.configPath.length > 0
    ? options.configPath
    : configPath(dshHome);

  // 内存中的模式；启动时从持久化文件恢复，默认 global+project。
  // loaded 用于防止“初始读盘尚未完成时用户已经通过界面切换”的竞态被旧值覆盖。
  let mode = DEFAULT_CONFIG.mode;
  let loaded = false;
  readConfigFile(filePath).then((config) => {
    if (!loaded) mode = config.mode;
    loaded = true;
  }).catch((error) => {
    loaded = true;
    ctx.logger?.warn?.(`dsh-minimal-rules: failed to load config (${String(error)})`);
  });

  const getConfig = () => ({ mode });
  const setConfig = async (config) => {
    loaded = true;
    const next = await writeConfigFile(config, filePath);
    mode = next.mode;
    return next;
  };

  ctx.effect(() => ctx.webServer.register({
    kind: "exact",
    path: "/dsh-minimal-rules/config",
    handler: createConfigRoute(getConfig, setConfig),
  }), "dsh-minimal-rules: config route");

  ctx.on("agent/pre-step", async ({ agent, signal }, next) => {
    // 非极简模式、非首条消息时直接放行。
    if (!isMinimalPreset(agent) || !isFirstMessage(agent)) {
      return next();
    }

    const decision = await next();
    if (decision?.kind !== "enter" || !Array.isArray(decision.messages) || decision.messages.length === 0) {
      return decision;
    }

    try {
      const cwd = agent?.session?.header?.cwd;
      const prefix = await loadRulesByMode(mode, dshHome, dshInstallDir, cwd);
      signal?.throwIfAborted?.();
      if (prefix === null) return decision;
      return attachToFirstMessage(decision, prefix);
    } catch (error) {
      ctx.logger?.warn?.(`dsh-minimal-rules: attach failed (${String(error)}); forwarding original decision`);
      return decision;
    }
  });
}
