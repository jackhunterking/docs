import fs from "node:fs";
import path from "node:path";
import https from "node:https";

function readText(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function walkFiles(dir, predicate) {
  const out = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      out.push(...walkFiles(p, predicate));
    } else if (predicate(p)) {
      out.push(p);
    }
  }
  return out;
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function fetchJson(url) {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "";
  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      {
        method: "GET",
        headers: {
          Accept: "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          "User-Agent": "adsgateway-docs-guardrails",
        },
      },
      (res) => {
        let data = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`Fetch failed (${res.statusCode}) for ${url}`));
            return;
          }
          try {
            resolve(JSON.parse(data));
          } catch (err) {
            reject(new Error(`Invalid JSON from ${url}: ${err instanceof Error ? err.message : String(err)}`));
          }
        });
      },
    );
    req.on("error", reject);
    req.end();
  });
}

async function loadMcpToolsJson() {
  const repoRoot = process.cwd();

  const envPath = (process.env.MCP_TOOLS_JSON_PATH || "").trim();
  if (envPath) {
    const resolved = path.isAbsolute(envPath) ? envPath : path.join(repoRoot, envPath);
    return JSON.parse(readText(resolved));
  }

  // Local workspace convenience: docs repo often sits next to product repo.
  const siblingPath = path.join(repoRoot, "..", "adsgpt-gateway", "fastmcp-server", "docs", "mcp-tools.json");
  if (fs.existsSync(siblingPath)) {
    return JSON.parse(readText(siblingPath));
  }

  const url = (process.env.MCP_TOOLS_JSON_URL || "").trim();
  if (url) {
    return await fetchJson(url);
  }

  // Fallback: vendored copy (optional).
  const vendored = path.join(repoRoot, "tooling", "mcp-tools.json");
  if (fs.existsSync(vendored)) {
    return JSON.parse(readText(vendored));
  }

  throw new Error(
    [
      "Unable to locate mcp-tools.json.",
      "Set MCP_TOOLS_JSON_PATH or MCP_TOOLS_JSON_URL, or add tooling/mcp-tools.json.",
    ].join(" "),
  );
}

function extractToolNames(mcpToolsJson) {
  const tools =
    Array.isArray(mcpToolsJson) ? mcpToolsJson :
    (mcpToolsJson && Array.isArray(mcpToolsJson.tools)) ? mcpToolsJson.tools :
    [];

  const names = [];
  for (const t of tools) {
    const n = t?.name || t?.tool || t?.id;
    if (typeof n === "string" && n.trim()) names.push(n.trim());
  }

  const uniq = Array.from(new Set(names));
  uniq.sort();
  return uniq;
}

function findBannedDomains(repoRoot) {
  const banned = [
    "docs.adsgateway.io",
    "status.adsgateway.io",
  ];

  const files = walkFiles(repoRoot, (p) =>
    p.endsWith(".mdx") || p.endsWith(".md") || path.basename(p) === "docs.json",
  );

  const hits = [];
  for (const file of files) {
    const txt = readText(file);
    const lines = txt.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      for (const domain of banned) {
        if (line.includes(domain)) {
          hits.push({ file, line: i + 1, domain, text: line.trim() });
        }
      }
    }
  }

  return hits;
}

function checkToolsCovered(toolNames, toolsDocsRoot) {
  const toolFiles = walkFiles(toolsDocsRoot, (p) => p.endsWith(".mdx"));
  const corpus = toolFiles.map((f) => ({ file: f, text: readText(f) }));

  const missing = [];
  for (const name of toolNames) {
    const re = new RegExp(`(^|[^a-z0-9_])${escapeRegExp(name)}([^a-z0-9_]|$)`, "i");
    const found = corpus.some(({ text }) => re.test(text));
    if (!found) missing.push(name);
  }

  return { toolFiles, missing };
}

async function main() {
  const repoRoot = process.cwd();
  const toolsDocsRoot = path.join(repoRoot, "tools");
  if (!fs.existsSync(toolsDocsRoot)) {
    throw new Error("Missing tools/ directory in docs repo.");
  }

  const mcpToolsJson = await loadMcpToolsJson();
  const toolNames = extractToolNames(mcpToolsJson);

  const { missing } = checkToolsCovered(toolNames, toolsDocsRoot);
  const bannedHits = findBannedDomains(repoRoot);

  let ok = true;

  if (missing.length) {
    ok = false;
    console.error("\n[guardrails] Missing tools documentation entries (tools/*.mdx):");
    for (const n of missing) console.error(`- ${n}`);
  }

  if (bannedHits.length) {
    ok = false;
    console.error("\n[guardrails] Banned domains found:");
    for (const h of bannedHits) {
      console.error(`- ${h.domain} in ${path.relative(repoRoot, h.file)}:${h.line} :: ${h.text}`);
    }
  }

  if (!ok) {
    process.exit(1);
  }

  console.log(`[guardrails] OK: ${toolNames.length} tools covered; no banned domains found.`);
}

main().catch((err) => {
  console.error("\n[guardrails] Failed:");
  console.error(err instanceof Error ? err.stack || err.message : String(err));
  process.exit(1);
});

