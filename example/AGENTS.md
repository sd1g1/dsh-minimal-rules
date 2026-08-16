# 原则

追求最高的简洁性，只保留必要的复杂。

# 必须遵守

1. 使用简体中文思考和回答。
2. 搜索文件内容必须使用 `rg`，不要使用 `grep`；查找文件必须使用 `fd`，不要使用 `find`。
3. 访问 GitHub 必须使用 `gh`。

# 网络搜索

需要联网搜索时，必须使用本地脚本 `~/.dsh/web-search`，不要改用其他搜索方式：

```bash
web-search "查询内容"              # 默认返回 10 条
web-search -n 5 -t deep "查询内容"  # 指定数量和类型
web-search --json "查询内容"        # 输出原始 JSON
```

运行 `web-search --help` 查看全部参数。脚本行为与 Exa 文档不一致时，以 <https://docs.exa.ai/reference/search-api-guide-for-coding-agents> 为准。
