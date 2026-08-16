import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import {
  attachToFirstMessage,
  createConfigRoute,
  isFirstMessage,
  isMinimalPreset,
  loadCreativeIndex,
  loadGlobalRules,
  loadProjectRules,
  loadRulesByMode,
  normalizeMode,
  readConfigFile,
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
    assert.equal(await loadGlobalRules(dir), "<DSH_AGENTS.md>\nglobal rules\n</DSH_AGENTS.md>\n\n");
    assert.equal(await loadGlobalRules(join(dir, "missing")), null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("loadProjectRules reads cwd AGENTS.md", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dsh-minimal-rules-project-"));
  try {
    await writeFile(join(dir, "AGENTS.md"), "project rules");
    assert.equal(await loadProjectRules(dir), "<PROJECT_AGENTS.md>\nproject rules\n</PROJECT_AGENTS.md>\n\n");
    assert.equal(await loadProjectRules(join(dir, "missing")), null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("loadCreativeIndex reads the bundled creative.md from the plugin folder", async () => {
  const result = await loadCreativeIndex(null);
  assert.ok(result.includes("<CREATIVE_INDEX.md>"));
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
    assert.equal(global, "<DSH_AGENTS.md>\nglobal\n</DSH_AGENTS.md>\n\n");

    const both = await loadRulesByMode("global+project", home, null, project);
    assert.equal(both, "<DSH_AGENTS.md>\nglobal\n</DSH_AGENTS.md>\n\n<PROJECT_AGENTS.md>\nproject\n</PROJECT_AGENTS.md>\n\n");

    const creative = await loadCreativeIndex(null);
    const all = await loadRulesByMode("all+creative", home, null, project);
    assert.equal(all, `${global}${"<PROJECT_AGENTS.md>\nproject\n</PROJECT_AGENTS.md>\n\n"}${creative}`);

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
