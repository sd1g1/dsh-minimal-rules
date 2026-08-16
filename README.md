# dsh-minimal-rules

DSH 插件：在极简模式（`minimal` 或 `dsh-minimal-bash-fix` 提供的 `minimal-fast`）下，把规则内容渲染成独立的 `<system-reminder>` 消息注入到当前用户消息之后，并在输入框权限下拉菜单右侧提供模式下拉菜单。

## 安装

```bash
dsh plugin --profile web add github:sd1g1/dsh-minimal-rules
```

重启 DSH 后生效。

## 使用

输入框下拉菜单有三种模式：

| 模式 | 注入内容 |
| --- | --- |
| `global` | 仅注入 `~/.dsh/AGENTS.md`（或 `$DSH_HOME/AGENTS.md`） |
| `global+project` | 注入 `~/.dsh/AGENTS.md` + `cwd/AGENTS.md` |
| `all+creative` | 注入 `~/.dsh/AGENTS.md` + `cwd/AGENTS.md` + 创造模式关键文档索引 |

默认模式为 `global+project`。

- 只对 `minimal` / `minimal-fast` 极简模式生效。
- 每个会话只注入一次，不修改既有历史消息；重启 DSH 后恢复会话时，如果近期历史中已没有当前规则，会重新注入一次。
- 规则以独立 user 消息注入，使用 `<system-reminder>` 包裹并带有来源路径。
- 修改 `AGENTS.md` 或切换模式后，重启 DSH 对新会话/恢复会话生效；当前运行中的会话不会改写已有历史。
- 模式保存在 `~/.dsh/dsh-minimal-rules.json`。

### 创造模式关键文档索引

`all+creative` 会读取插件自带的索引文件：

```text
dsh-minimal-rules/creative.md
```

该文件包含创造模式（`cordis` preset）运行所需核心文档的简要介绍，并记录了生成时的 DSH 版本。

如果插件内索引文件缺失，会回退生成指向以下关键文档的链接：

```text
config/agent-presets/cordis/agent.cordis.yml
config/agent-presets/cordis/skills/cordis-plugin-development/SKILL.md
config/agent-presets/cordis/skills/editing-cordis-compositions/SKILL.md
```

如果仍不可用，`all+creative` 会继续注入 global 和 project 部分。

## 卸载

```bash
dsh plugin --profile web remove @local/dsh-minimal-rules
```

## 示例文件

`example/` 目录包含：

- `AGENTS.md`：当前全局 `~/.dsh/AGENTS.md` 的示例
- `web-search`：Exa 网络搜索脚本示例，可直接参考或复制到 `~/.dsh/web-search`
