// dsh-minimal-rules —— 极简模式（minimal / minimal-fast）规则自动附加插件。
//
// 宿主侧：
//   - 在 agent/pre-step 中，仅对极简模式，根据当前模式读取规则内容：
//       global         -> 仅读取 ~/.dsh/AGENTS.md（或 $DSH_HOME/AGENTS.md）
//       global+project -> 再读取 cwd/AGENTS.md
//       all+creative   -> 再读取创造模式关键文档索引
//   - 规则渲染成一条独立的 user 消息（<system-reminder> 包裹），插在
//     当前已领取消息之后，避免与用户输入混在同一个 text block 中；
//   - 每个 agent 只注入一次；恢复会话且近期历史中没有当前规则时重新注入；
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

const INSTRUCTION_INTRO = [
  "以下工作区指令来自 AGENTS.md 文件，请把它们作为需要遵守的规则。",
  "更具体、更靠近当前目录的规则优先；除非用户在本轮给出明确冲突的指示，否则按这些规则执行。",
].join(" ");

/** 恢复会话时只回看最近这么多条派生消息，避免每次扫描完整历史。 */
export const RECENT_INJECTION_LOOKBACK = 200;

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

/** 兼容旧导出：判断会话是否还没有任何已落地消息（apply 已不再使用）。 */
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

/** 把一段规则原文渲染成带来源路径的 instruction section。 */
export function formatInstructionSection(label, content) {
  const text = typeof content === "string" ? content.trim() : "";
  if (text.length === 0) return null;
  return `Instructions from: ${label}\n\n${text}\n\n`;
}

/**
 * 兼容旧导出：将前缀文本附加到 decision 中第一条 user 消息的文本块开头。
 * apply 已改用 createInstructionMessage + insertInstructionMessage。
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
  if (content === null) return null;
  const label = dshHome === join(homedir(), ".dsh") ? "~/.dsh/AGENTS.md" : "$DSH_HOME/AGENTS.md";
  return formatInstructionSection(label, content);
}

/** 读取 cwd 下的项目规则文件。 */
export async function loadProjectRules(cwd) {
  const content = await readFirstExisting(cwd, [
    ["AGENTS.md"],
    ["agents.md"],
  ]);
  if (content === null) return null;
  return formatInstructionSection("AGENTS.md", content);
}

/** 读取创造模式关键文档索引（优先使用插件自带 creative.md）。 */
export async function loadCreativeIndex(dshInstallDir) {
  // 索引文件随插件分发，存放在插件根目录。
  const local = await readFirstExisting(PLUGIN_ROOT, [
    ["creative.md"],
    ["creative-index.md"],
    ["INDEX.md"],
  ]);
  if (local !== null) return formatInstructionSection("creative.md", local);

  // 容错：如果插件内没有索引文件，再尝试 DSH 安装目录中的 cordis preset。
  if (typeof dshInstallDir === "string" && dshInstallDir.length > 0) {
    const installed = await readFirstExisting(dshInstallDir, [
      ["config", "agent-presets", "cordis", "INDEX.md"],
      ["config", "agent-presets", "cordis", "index.md"],
    ]);
    if (installed !== null) return formatInstructionSection("config/agent-presets/cordis/INDEX.md", installed);
  }

  // 最后回退生成指向关键文档的链接。
  const docs = [
    "config/agent-presets/cordis/agent.cordis.yml",
    "config/agent-presets/cordis/skills/cordis-plugin-development/SKILL.md",
    "config/agent-presets/cordis/skills/editing-cordis-compositions/SKILL.md",
  ];
  const lines = docs.map((doc) => `- ${doc}`);
  return formatInstructionSection("config/agent-presets/cordis", lines.join("\n"));
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

/**
 * 把各 rule section 渲染成一条独立 user 消息的文本。
 * 使用官方 dsh-agent-instructions 同款 <system-reminder> 语义，
 * 并转义正文中可能出现的闭合标签，避免提前终止提醒区域。
 */
export function renderInstructionReminder(sections) {
  const body = (Array.isArray(sections) ? sections.join("") : typeof sections === "string" ? sections : "").trim();
  if (body.length === 0) return null;
  const escaped = body.replaceAll("</system-reminder>", "<\\/system-reminder>");
  return `<system-reminder>\n${INSTRUCTION_INTRO}\n\n${escaped}\n</system-reminder>`;
}

/** 创建承载规则文本的独立 user 消息。 */
export function createInstructionMessage(text) {
  if (typeof text !== "string" || text.length === 0) return null;
  return {
    role: "user",
    content: [{ type: "text", text }],
    source: { kind: "plugin", plugin: name },
  };
}

/**
 * 把规则消息插入到 decision 中最后一条已领取消息之后；
 * 找不到已领取消息时追加到 decision 末尾。不修改既有历史消息。
 */
export function insertInstructionMessage(decision, message, claimedMessages = []) {
  if (decision?.kind !== "enter" || !Array.isArray(decision.messages) || decision.messages.length === 0) {
    return decision;
  }
  if (message == null) return decision;

  const messages = [...decision.messages];
  const claimed = Array.isArray(claimedMessages) ? claimedMessages : [];
  const lastClaimedIndex = claimed.length > 0 ? messages.findLastIndex((item) => claimed.includes(item)) : -1;
  const insertAt = lastClaimedIndex >= 0 ? lastClaimedIndex + 1 : messages.length;
  messages.splice(insertAt, 0, message);
  return { ...decision, messages };
}

/**
 * 判断会话近期派生消息中是否已经存在完全相同的规则文本。
 * 用于恢复会话时避免重复注入，同时保证规则被长历史淹没后能重新补充。
 */
export function hasRecentInstructionMessage(agent, text, lookback = RECENT_INJECTION_LOOKBACK) {
  if (typeof agent?.session?.deriveMessages !== "function") return false;
  if (typeof text !== "string" || text.length === 0) return false;
  const messages = agent.session.deriveMessages();
  if (!Array.isArray(messages)) return false;
  const start = Math.max(0, messages.length - Math.max(0, Math.trunc(lookback)));
  for (let index = start; index < messages.length; index += 1) {
    const content = messages[index]?.content;
    if (Array.isArray(content) && content[0]?.type === "text" && content[0].text === text) return true;
  }
  return false;
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

export async function apply(ctx, options = {}) {
  const dshHome = typeof options.dshHome === "string" && options.dshHome.length > 0
    ? options.dshHome
    : process.env.DSH_HOME || join(homedir(), ".dsh");
  const dshInstallDir = typeof options.dshInstallDir === "string" && options.dshInstallDir.length > 0
    ? options.dshInstallDir
    : resolveDshInstallDir();
  const filePath = typeof options.configPath === "string" && options.configPath.length > 0
    ? options.configPath
    : configPath(dshHome);

  // 启动时同步恢复持久化模式，避免“首条消息早于读盘完成”的竞态。
  let mode = DEFAULT_CONFIG.mode;
  try {
    mode = (await readConfigFile(filePath)).mode;
  } catch (error) {
    ctx.logger?.warn?.(`dsh-minimal-rules: failed to load config (${String(error)})`);
  }

  const getConfig = () => ({ mode });
  const setConfig = async (config) => {
    const next = await writeConfigFile(config, filePath);
    mode = next.mode;
    return next;
  };

  ctx.effect(() => ctx.webServer.register({
    kind: "exact",
    path: "/dsh-minimal-rules/config",
    handler: createConfigRoute(getConfig, setConfig),
  }), "dsh-minimal-rules: config route");

  // 每个 agent 只注入一次；DSH 重启/会话恢复后得到新 agent 对象，会重新注入。
  const injectedAgents = new WeakSet();

  ctx.on("agent/pre-step", async ({ agent, messages: claimedMessages = [], signal }, next) => {
    if (!isMinimalPreset(agent) || injectedAgents.has(agent)) {
      return next();
    }

    const decision = await next();
    if (decision?.kind !== "enter" || !Array.isArray(decision.messages) || decision.messages.length === 0) {
      return decision;
    }

    try {
      const cwd = agent?.session?.header?.cwd;
      const sections = await loadRulesByMode(mode, dshHome, dshInstallDir, cwd);
      signal?.throwIfAborted?.();

      if (sections === null) {
        injectedAgents.add(agent);
        return decision;
      }

      const reminder = renderInstructionReminder(sections);
      if (reminder === null) {
        injectedAgents.add(agent);
        return decision;
      }

      // 恢复会话时，如果近期历史已经带着相同规则，就不重复追加；
      // 否则在本次已领取消息之后补一条（追加，不改旧历史）。
      if (hasRecentInstructionMessage(agent, reminder)
        || decision.messages.some((message) => Array.isArray(message?.content) && message.content[0]?.type === "text" && message.content[0].text === reminder)) {
        injectedAgents.add(agent);
        return decision;
      }

      injectedAgents.add(agent);
      return insertInstructionMessage(decision, createInstructionMessage(reminder), claimedMessages);
    } catch (error) {
      if (signal?.aborted) throw error;
      ctx.logger?.warn?.(`dsh-minimal-rules: attach failed (${String(error)}); forwarding original decision`);
      return decision;
    }
  });
}
