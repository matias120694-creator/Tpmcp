import http from "http";

import {
  McpServer,
} from "@modelcontextprotocol/sdk/server/mcp.js";

import {
  SSEServerTransport,
} from "@modelcontextprotocol/sdk/server/sse.js";

const SERPER_API_KEY = process.env.SERPER_API_KEY;

if (!SERPER_API_KEY) {
  console.error("Missing SERPER_API_KEY env var");
  process.exit(1);
}

const mcp = new McpServer({
  name: "typingmind-web-mcp",
  version: "1.0.0",
});

// Tool: web_search
mcp.tool(
  "web_search",
  "Search the live web (Google results via Serper). Returns titles, links, snippets.",
  {
    query: { type: "string", description: "Search query" },
    num: { type: "number", description: "Number of results (1-20)", default: 10 },
    gl: { type: "string", description: "Country code (e.g., us, br)", default: "us" },
    hl: { type: "string", description: "Language (e.g., en, pt)", default: "en" }
  },
  async ({ query, num = 10, gl = "us", hl = "en" }) => {
    const resp = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: {
        "X-API-KEY": SERPER_API_KEY,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        q: query,
        num,
        gl,
        hl
      })
    });

    if (!resp.ok) {
      const t = await resp.text();
      throw new Error(`Serper error ${resp.status}: ${t}`);
    }

    const data = await resp.json();

    const organic = (data.organic || []).map((r) => ({
      title: r.title,
      link: r.link,
      snippet: r.snippet,
      position: r.position
    }));

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ query, organic }, null, 2)
        }
      ]
    };
  }
);

// Tool: fetch_url (via Jina Reader)
mcp.tool(
  "fetch_url",
  "Fetch readable text content of a URL using Jina AI Reader (r.jina.ai).",
  {
    url: { type: "string", description: "URL to fetch (http/https)" }
  },
  async ({ url }) => {
    const safeUrl = url.replace(/^https?:\/\//, (m) => m); // keep
    const readerUrl = `https://r.jina.ai/${safeUrl}`;

    const resp = await fetch(readerUrl, { method: "GET" });
    if (!resp.ok) {
      const t = await resp.text();
      throw new Error(`Fetch error ${resp.status}: ${t}`);
    }

    const text = await resp.text();

    // Keep response bounded (TypingMind/LLM context). Trim if huge.
    const trimmed = text.length > 20000 ? text.slice(0, 20000) + "\n\n[TRUNCATED]" : text;

    return {
      content: [
        { type: "text", text: trimmed }
      ]
    };
  }
);

const server = http.createServer(async (req, res) => {
  // Health check
  if (req.method === "GET" && req.url === "/") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("OK");
    return;
  }

  // MCP over SSE endpoint
  if (req.method === "GET" && req.url === "/sse") {
    const transport = new SSEServerTransport("/sse", res);
    await mcp.connect(transport);
    return;
  }

  res.writeHead(404);
  res.end();
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`MCP SSE listening on :${PORT}`));
