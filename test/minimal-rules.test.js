import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import {
  attachToFirstMessage,
  createConfigRoute,
  createInstructionMessage,
  formatInstructionSection,
  hasRecentInstructionMessage,
  insertInstructionMessage,
  isFirstMessage,
  isMinimalPreset,
  loadCreativeIndex,
  loadGlobalRules,
  loadProjectRules,
  loadRulesByMode,
  normalizeMode,
  readConfigFile,
  renderInstructionReminder,
  resolveAgentPreset,
  wrapAgentsMd,
  wrapSection,
  writeConfigFile,
} from "../lib/index.js";

test("normalizeMode accepts the three modes and falls back to default", () => {
  assert.equal(normalizeMode("global"), "global");
  assert.equal(normalizeMode("global+project"), "global+project");
  assert.equal(normalizeMode("all+creative"), "all+creative");
  assert.equal(normalizeMode("unknown"), "global+project");
  assert.equal(normalizeMode(undefined), "global+project");
});

test("wrapSection wraps non-empty content and trims whitespace", () => {
  assert.equal(wrapSection("TAG", "  hello  "), "<TAG>\nhello\n</TAG>\n\n");
  assert.equal(wrapSection("TAG", ""), null);
  assert.equal(wrapSection("TAG", "   \n  "), null);
});

test("wrapAgentsMd remains compatible", () => {
  assert.equal(wrapAgentsMd("  hello  "), "<AGENTS.md>\nhello\n</AGENTS.md>\n\n");
});

test("formatInstructionSection renders a source label and trims content", () => {
  assert.equal(
    formatInstructionSection("AGENTS.md", "  hello  "),
    "Instructions from: AGENTS.md\n\nhello\n\n",
  );
  assert.equal(formatInstructionSection("AGENTS.md", "  \n "), null);
});

test("renderInstructionReminder wraps sections in system-reminder and escapes its close tag", () => {
  const sections = [
    formatInstructionSection("AGENTS.md", "hello </system-reminder>"),
    formatInstructionSection("OTHER.md", "world"),
  ];
  const reminder = renderInstructionReminder(sections);
  assert.ok(reminder.startsWith("<system-reminder>\n"));
  assert.ok(reminder.endsWith("\n</system-reminder>"));
  assert.ok(reminder.includes("<\\/system-reminder>"));
  assert.ok(!reminder.includes("</system-reminder>\n\nInstructions from: OTHER.md"));
  assert.equal(renderInstructionReminder([]), null);
  assert.equal(renderInstructionReminder("  "), null);
});

test("createInstructionMessage and insertInstructionMessage append after claimed messages", () => {
  const claimed = { id: "m1", role: "user", content: [{ type: "text", text: "hello" }] };
  const decision = {
    kind: "enter",
    messages: [claimed, { id: "m2", role: "user", content: [{ type: "text", text: "second" }] }],
  };
  const message = createInstructionMessage("<system-reminder>\nrules\n</system-reminder>");
  assert.equal(message.source.kind, "plugin");
  assert.equal(message.source.plugin, "dsh-minimal-rules");
  const result = insertInstructionMessage(decision, message, [claimed]);
  assert.equal(result.messages.length, 3);
  assert.equal(result.messages[1], message);
  assert.equal(result.messages[0], claimed);
  assert.equal(result.messages[2].id, "m2");
  assert.notEqual(result, decision);
});

test("insertInstructionMessage appends at the end when no claimed message matches", () => {
  const decision = {
    kind: "enter",
    messages: [{ id: "m1", role: "user", content: [{ type: "text", text: "hello" }] }],
  };
  const message = createInstructionMessage("rules");
  const result = insertInstructionMessage(decision, message, []);
  assert.equal(result.messages.at(-1), message);
  assert.equal(insertInstructionMessage(decision, null, []), decision);
});

test("hasRecentInstructionMessage detects only recent matching text", () => {
  const text = "<system-reminder>\nrules\n</system-reminder>";
  const messages = [
    { role: "user", content: [{ type: "text", text }] },
    { role: "user", content: [{ type: "text", text: "later" }] },
  ];
  const agent = { session: { deriveMessages: () => messages } };
  assert.equal(hasRecentInstructionMessage(agent, text), true);
  assert.equal(hasRecentInstructionMessage(agent, "missing"), false);
  assert.equal(hasRecentInstructionMessage({}, text), false);
  assert.equal(hasRecentInstructionMessage(agent, text, 1), false);
});

test("isMinimalPreset accepts minimal and minimal-fast only", () => {
  assert.equal(isMinimalPreset({ session: { header: { agentPreset: "minimal" } } }), true);
  assert.equal(isMinimalPreset({ session: { header: { agentPreset: "minimal-fast" } } }), true);
  assert.equal(isMinimalPreset({ session: { header: { agentPreset: "standard" } } }), false);
  assert.equal(isMinimalPreset({ session: { header: {} } }), false);
  assert.equal(isMinimalPreset({}), false);
});

test("resolveAgentPreset prefers the latest selected event over the header", () => {
  const agent = {
    session: {
      header: { agentPreset: "standard" },
      events: [
        { type: "agent-preset/selected", data: { agentPreset: "standard" } },
        { type: "agent-preset/selected", data: { agentPreset: "minimal" } },
      ],
    },
  };
  assert.equal(resolveAgentPreset(agent), "minimal");
  assert.equal(isMinimalPreset(agent), true);
});

test("isFirstMessage is true only when there is no derived history", () => {
  assert.equal(isFirstMessage({ session: { deriveMessages: () => [] } }), true);
  assert.equal(isFirstMessage({ session: { deriveMessages: () => [{ role: "user" }] } }), false);
  assert.equal(isFirstMessage({}), false);
});

test("attachToFirstMessage prepends to the first user text block", () => {
  const decision = {
    kind: "enter",
    messages: [
      { id: "m1", role: "user", source: { kind: "user" }, content: [{ type: "text", text: "hello" }] },
      { id: "m2", role: "user", source: { kind: "user" }, content: [{ type: "text", text: "world" }] },
    ],
  };
  const result = attachToFirstMessage(decision, "<TAG>\nctx\n</TAG>\n\n");
  assert.equal(result.messages[0].id, "m1");
  assert.equal(result.messages[0].content[0].text, "<TAG>\nctx\n</TAG>\n\nhello");
  assert.equal(result.messages[1].content[0].text, "world");
  assert.equal(result.messages[0].source.kind, "user");
  assert.notEqual(result, decision);
});

test("attachToFirstMessage inserts a text block when the user message has none", () => {
  const decision = {
    kind: "enter",
    messages: [
      { id: "m1", role: "user", content: [{ type: "image", attachment: {} }] },
    ],
  };
  const result = attachToFirstMessage(decision, "<TAG>x</TAG>\n\n");
  assert.deepEqual(result.messages[0].content[0], { type: "text", text: "<TAG>x</TAG>\n\n" });
  assert.equal(result.messages[0].content[1].type, "image");
});

test("attachToFirstMessage puts the prefix before a leading non-text block", () => {
  const decision = {
    kind: "enter",
    messages: [
      { id: "m1", role: "user", content: [{ type: "image", attachment: {} }, { type: "text", text: "hello" }] },
    ],
  };
  const result = attachToFirstMessage(decision, "<TAG>x</TAG>\n\n");
  assert.equal(result.messages[0].content[0].type, "text");
  assert.equal(result.messages[0].content[0].text, "<TAG>x</TAG>\n\n");
  assert.equal(result.messages[0].content[1].type, "image");
  assert.equal(result.messages[0].content[2].text, "hello");
});

test("loadGlobalRules reads DSH home AGENTS.md", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dsh-minimal-rules-global-"));
  try {
    await writeFile(join(dir, "AGENTS.md"), "global rules");
    assert.equal(await loadGlobalRules(dir), "Instructions from: $DSH_HOME/AGENTS.md\n\nglobal rules\n\n");
    assert.equal(await loadGlobalRules(join(dir, "missing")), null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("loadProjectRules reads cwd AGENTS.md", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dsh-minimal-rules-project-"));
  try {
    await writeFile(join(dir, "AGENTS.md"), "project rules");
    assert.equal(await loadProjectRules(dir), "Instructions from: AGENTS.md\n\nproject rules\n\n");
    assert.equal(await loadProjectRules(join(dir, "missing")), null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("loadCreativeIndex reads the bundled creative.md from the plugin folder", async () => {
  const result = await loadCreativeIndex(null);
  assert.ok(result.includes("Instructions from: creative.md"));
  assert.ok(result.includes("创造模式关键文档索引"));
  assert.ok(result.includes("生成时 DSH 版本：0.1.0-rc.6"));
});

test("loadRulesByMode combines sections according to mode", async () => {
  const home = await mkdtemp(join(tmpdir(), "dsh-minimal-rules-home-"));
  const project = await mkdtemp(join(tmpdir(), "dsh-minimal-rules-cwd-"));
  try {
    await writeFile(join(home, "AGENTS.md"), "global");
    await writeFile(join(project, "AGENTS.md"), "project");

    const global = await loadRulesByMode("global", home, null, project);
    assert.equal(global, "Instructions from: $DSH_HOME/AGENTS.md\n\nglobal\n\n");

    const projectSection = "Instructions from: AGENTS.md\n\nproject\n\n";
    const both = await loadRulesByMode("global+project", home, null, project);
    assert.equal(both, `${global}${projectSection}`);

    const creative = await loadCreativeIndex(null);
    const all = await loadRulesByMode("all+creative", home, null, project);
    assert.equal(all, `${global}${projectSection}${creative}`);

    assert.equal(await loadRulesByMode("global", join(home, "missing"), null, project), null);
  } finally {
    await rm(home, { recursive: true, force: true });
    await rm(project, { recursive: true, force: true });
  }
});

test("readConfigFile defaults to global+project and writeConfigFile persists mode", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dsh-minimal-rules-config-"));
  const file = join(dir, "config.json");
  try {
    assert.deepEqual(await readConfigFile(file), { mode: "global+project" });
    await writeConfigFile({ mode: "all+creative" }, file);
    assert.deepEqual(await readConfigFile(file), { mode: "all+creative" });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

function mockResponse() {
  return {
    status: null,
    headers: null,
    body: "",
    writeHead(status, headers) {
      this.status = status;
      this.headers = headers;
    },
    end(body = "") {
      this.body = body;
    },
  };
}

test("createConfigRoute reads and persists the mode", async () => {
  let state = { mode: "global+project" };
  const route = createConfigRoute(
    () => state,
    async (next) => {
      state = { ...state, ...next };
      return state;
    },
  );

  const getRes = mockResponse();
  await route({ method: "GET", url: "/dsh-minimal-rules/config" }, getRes);
  assert.equal(getRes.status, 200);
  assert.deepEqual(JSON.parse(getRes.body), { mode: "global+project" });

  const postReq = Readable.from([JSON.stringify({ mode: "all+creative" })]);
  postReq.method = "POST";
  postReq.url = "/dsh-minimal-rules/config";
  const postRes = mockResponse();
  await route(postReq, postRes);
  assert.equal(postRes.status, 200);
  assert.deepEqual(JSON.parse(postRes.body), { mode: "all+creative" });
  assert.equal(state.mode, "all+creative");

  const badReq = Readable.from([JSON.stringify({ mode: "bogus" })]);
  badReq.method = "POST";
  badReq.url = "/dsh-minimal-rules/config";
  const badRes = mockResponse();
  await route(badReq, badRes);
  assert.equal(badRes.status, 400);
});
