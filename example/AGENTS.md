# 原则

追求最高的简洁性，只保留必要的复杂 

# cli

-  使用`rg` 替代 `grep`,`fd` 替代 `find`
- `gh`可用来访问github

# 网络搜索

使用 Exa API 的本地搜索脚本：`~/.dsh/web-search`。

## 示例

```bash
# 默认 auto + highlights，返回 10 条
web-search "Next.js route handler authentication example"

# 指定数量/类型
web-search -n 10 -t deep "Rust async runtime comparison"

# 只看 URL/元数据
web-search --no-contents "Fedora 44 release notes"

# 指定域名/新鲜度
web-search --include-domains arxiv.org,github.com --max-age-hours 24 "LLM agent survey"

# 结构化输出
web-search --type deep \
  --system-prompt "Prefer official sources" \
  --output-schema '{"type":"object","properties":{"summary":{"type":"string"}},"required":["summary"]}' \
  "Exa API overview"

# 原始 JSON
web-search --json "query"
```

## 参数

- `-n, --num-results`：结果数，默认 10
- `-t, --type`：可选 `auto|fast|instant|deep-lite|deep|deep-reasoning`
- `--text` / `--summary` / `--no-contents`：切换内容模式
- `--max-characters`：配合 `--text` 限制正文长度，默认 20000
- `--max-age-hours`：0 强制实时抓取，-1 只用缓存
- `--include-domains`, `--exclude-domains`：域名过滤
- `--output-schema`, `--system-prompt`：结构化/综合输出
- `--json`：输出原始响应

> 如果 API 行为与脚本不一致，以 <https://docs.exa.ai/reference/search-api-guide-for-coding-agents> 为准。
