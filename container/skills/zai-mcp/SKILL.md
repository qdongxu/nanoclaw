---
name: zai-mcp
description: Web search, web page reading, and GitHub repo exploration via z.ai MCP servers. Use for web search, reading URLs, and exploring open source repositories.
allowed-tools: mcp__web-search-prime__*, mcp__web-reader__*, mcp__web_reader__*, mcp__zread__*
---

# z.ai MCP Tools

Web search, web page reading, and GitHub repo exploration tools provided via z.ai MCP servers.

## Web Search

Use `mcp__web-search-prime__web_search_prime` to search the web:

```
Search query: "latest Node.js features"
Location: "cn" (Chinese region) or "us" (non-Chinese region)
```

## Web Page Reader

Use `mcp__web-reader__webReader` or `mcp__web_reader__webReader` to fetch and read web page content:

```
URL: "https://example.com/article"
Return format: "markdown" (default) or "text"
```

## GitHub Repo Tools

Use `mcp__zread__*` tools to explore open source repositories:

- `get_repo_structure` - Get directory structure of a GitHub repo
- `read_file` - Read specific file content from a GitHub repo
- `search_doc` - Search documentation, issues, and commits of a GitHub repo

Example:
```
repo_name: "vitejs/vite"
query: "how to configure plugins"
```
