import fs from "fs";
import os from "os";
import path from "path";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const server = new Server(
  {
    name: "zentao-mcp",
    version: "0.1.0",
  },
  {
    // Declare supported feature sets so initialization succeeds.
    capabilities: {
      resources: {}, // enables resources/list & read
      tools: {}, // enables tools/list & call
    },
  }
);

function loadEnvFallback() {
  const candidates = [
    path.join(process.cwd(), ".env"),
    path.join(os.homedir(), ".env"),
    path.join(os.homedir(), ".zshrc"),
  ];
  const envRegex = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*["']?(.*?)["']?\s*$/;
  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    const content = fs.readFileSync(file, "utf8");
    for (const line of content.split("\n")) {
      const match = envRegex.exec(line);
      if (!match) continue;
      const [, key, value] = match;
      if (!process.env[key] && value !== undefined) {
        process.env[key] = value.trim();
      }
    }
  }
}

loadEnvFallback();

const baseUrl = process.env.ZENTAO_BASE_URL?.replace(/\/$/, "") || "";
const account = process.env.ZENTAO_ACCOUNT || "";
const password = process.env.ZENTAO_PASSWORD || "";
let cachedToken = process.env.ZENTAO_TOKEN || "";

function assertConfig() {
  if (!baseUrl) throw new Error("Missing ZENTAO_BASE_URL");
  if (!account) throw new Error("Missing ZENTAO_ACCOUNT");
  if (!password) throw new Error("Missing ZENTAO_PASSWORD");
}

async function fetchToken(forceRefresh = false) {
  if (cachedToken && !forceRefresh) return cachedToken;
  assertConfig();
  const url = `${baseUrl}/api.php/v1/tokens`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ account, password }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Token request failed: ${res.status} ${text}`);
  const data = safeJson(text);
  if (!data?.token) throw new Error("Token missing in response");
  cachedToken = data.token;
  return cachedToken;
}

async function callZenTao({
  path,
  method = "GET",
  query,
  body,
  headers = {},
  forceTokenRefresh = false,
}) {
  assertConfig();
  const token = await fetchToken(forceTokenRefresh);
  const url = buildUrl(path, query);
  const res = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      Token: token,
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = safeJson(text);
  if (!res.ok) {
    throw new Error(
      `Request failed ${res.status}: ${text || res.statusText || "unknown"}`
    );
  }
  return {
    status: res.status,
    headers: Object.fromEntries(res.headers.entries()),
    data: data ?? text,
  };
}

function buildUrl(path, query) {
  const cleaned = path.startsWith("http")
    ? path
    : `${baseUrl}/api.php/v1/${path.replace(/^\//, "")}`;
  if (!query || Object.keys(query).length === 0) return cleaned;
  const usp = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    if (value === undefined || value === null) return;
    usp.append(key, String(value));
  });
  return `${cleaned}?${usp.toString()}`;
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch (err) {
    return null;
  }
}

function extractArray(payload, keys = []) {
  if (Array.isArray(payload)) return payload;
  for (const key of keys) {
    if (Array.isArray(payload?.[key])) return payload[key];
  }
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
}

function normalizeAccount(value) {
  const values = [];
  if (!value) return values;
  if (typeof value === "string" || typeof value === "number") {
    values.push(String(value));
  } else if (typeof value === "object") {
    const candidates = [
      value.account,
      value.name,
      value.realname,
      value.realName,
      value.username,
      value.user,
      value.id,
    ];
    candidates.forEach((v) => {
      if (v !== undefined && v !== null) values.push(String(v));
    });
  }
  return values
    .map((v) => v.trim().toLowerCase())
    .filter((v) => v.length > 0 && v !== "[object object]");
}

function parseImageSources(html = "") {
  const regex = /<img[^>]+src=["']?([^"'>\s]+)["']?[^>]*>/gi;
  const urls = [];
  let match;
  while ((match = regex.exec(html))) {
    const url = match[1];
    if (url && /^https?:\/\//i.test(url)) {
      urls.push(url);
    }
  }
  return urls;
}

async function listProjectsForAccount({ keyword, limit = 50 } = {}) {
  const res = await callZenTao({
    path: "projects",
    query: { page: 1, limit },
  });
  const projects = extractArray(res.data, ["projects"]);
  const accountLower = (account || "").trim().toLowerCase();
  const filtered = projects.filter((p) => {
    const name = `${p.name || ""}`.toLowerCase();
    const matchKeyword = keyword ? name.includes(keyword.toLowerCase()) : true;
    if (!accountLower) return matchKeyword;
    const fields = [
      p.PM,
      p.PO,
      p.QD,
      p.RD,
      p.openedBy,
      p.lastEditedBy,
      p.assignedTo,
    ]
      .filter(Boolean)
      .map((v) => `${v}`.toLowerCase());
    const team = Array.isArray(p.teamMembers) ? p.teamMembers : [];
    const teamMatch = team.some((m) => `${m.account || m.name || ""}`.toLowerCase() === accountLower);
    const fieldMatch = fields.includes(accountLower);
    return matchKeyword && (teamMatch || fieldMatch);
  });
  return filtered.slice(0, limit);
}

async function listProducts({ keyword, limit = 20 } = {}) {
  const res = await callZenTao({
    path: "products",
    query: { page: 1, limit, keywords: keyword },
  });
  const products = extractArray(res.data, ["products"]);
  const filtered = keyword
    ? products.filter((p) =>
        `${p.name || ""}`.toLowerCase().includes(keyword.toLowerCase())
      )
    : products;
  return filtered.slice(0, limit);
}

async function findProductByName(name) {
  if (!name) throw new Error("productName is required");
  const candidates = await listProducts({ keyword: name, limit: 50 });
  const exact = candidates.find(
    (p) => `${p.name || ""}`.toLowerCase() === name.toLowerCase()
  );
  if (exact) return { product: exact, matches: candidates };
  if (candidates.length === 1) return { product: candidates[0], matches: candidates };
  return { product: undefined, matches: candidates };
}

async function fetchBugsByProduct({
  productId,
  keyword,
  allStatuses = false,
  status,
  limit = 20,
  page = 1,
}) {
  const res = await callZenTao({
    // Use /bugs with product filter; works better for assignedTo filtering.
    path: "bugs",
    query: {
      page,
      limit,
      product: productId,
      keywords: keyword,
    },
  });
  const bugs = extractArray(res.data, ["bugs"]);
  const accountLower = (account || "").trim().toLowerCase();
  const statusLower = status ? String(status).trim().toLowerCase() : null;
  const filtered = bugs.filter((bug) => {
    const assignedCandidates = [
      ...normalizeAccount(bug.assignedTo),
      ...normalizeAccount(bug.assignedToName),
      ...normalizeAccount(bug.assignedToRealname),
    ];
    const matchAssignee = accountLower
      ? assignedCandidates.includes(accountLower)
      : true;
    const matchKeyword = keyword
      ? `${bug.title || bug.name || ""}`
      .toLowerCase()
      .includes(keyword.toLowerCase())
      : true;
    const matchStatus = allStatuses
      ? true
      : statusLower
      ? String(bug.status || bug.state || "")
          .trim()
          .toLowerCase() === statusLower
      : true;
    return matchAssignee && matchKeyword && matchStatus;
  });
  return { bugs: filtered, raw: res.data };
}

async function getBugWithImages(bugId) {
  const res = await callZenTao({ path: `bugs/${bugId}` });
  const bug = res.data || {};
  const stepsHtml = bug.steps || bug.stepsHtml || "";
  const stepsImages = parseImageSources(stepsHtml);
  return { ...bug, stepsHtml, stepsImages };
}

const endpointIndex = `ZenTao RESTful API v1 (api.php/v1)
- Token: POST /tokens { account, password } -> { token }
- Departments: GET /departments, GET /departments/{id}
- Users: GET /users, GET /users/{id}, PUT /users/{id}, DELETE /users/{id}, POST /users
- Program: GET /programs, POST /programs, PUT /programs/{id}, GET /programs/{id}, DELETE /programs/{id}
- Products: GET /products, POST /products, GET /products/{id}, PUT /products/{id}, DELETE /products/{id}
- Product Plans: GET /products/{productID}/plans, POST /products/{productID}/plans, GET/PUT/DELETE /productplans/{id}, relations: POST/DELETE /productplans/{id}/stories, /productplans/{id}/bugs
- Releases: GET /products/{productID}/releases, GET /projects/{projectID}/releases
- Stories (需求): GET /stories?product= /project= /execution=, POST /stories, GET/PUT/DELETE /stories/{id}, POST /stories/{id}/close
- Projects: GET /projects, POST /projects, GET/PUT/DELETE /projects/{id}
- Builds/Versions: GET /projects/{id}/builds, GET /executions/{id}/builds, POST /builds, GET/PUT/DELETE /builds/{id}
- Executions: GET /projects/{id}/executions, POST /executions, GET/PUT/DELETE /executions/{id}
- Tasks: GET /executions/{id}/tasks, POST /tasks, GET/PUT/DELETE /tasks/{id}, state: start/pause/continue/finish/close, logs: POST /tasks/{id}/efforts, GET /tasks/{id}/efforts
- Bugs: GET /products/{id}/bugs, POST /bugs, GET/PUT/DELETE /bugs/{id}, state: confirm/close/activate/resolve
- Cases: GET /products/{id}/cases, POST /cases, GET/PUT/DELETE /cases/{id}, POST /cases/{id}/results
- Test Runs: GET /testsuites/{id}/runs, GET /projects/{id}/testtasks, GET /testtasks/{id}
- Feedback: POST /feedback, PUT /feedback/{id}/assign, PUT /feedback/{id}/close, DELETE /feedback/{id}, PUT /feedback/{id}, GET /feedback/{id}, GET /feedback
- Tickets: GET /tickets, GET /tickets/{id}, PUT /tickets/{id}, POST /tickets, DELETE /tickets/{id}

Docs index: https://www.zentao.net/book/api.html (RESTful v1 section 2.x).`;

server.setRequestHandler(ListResourcesRequestSchema, async () => ({
  resources: [
    {
      uri: "zentao://endpoints",
      name: "ZenTao RESTful v1 endpoints summary",
      mimeType: "text/plain",
    },
    {
      uri: "zentao://config",
      name: "Current ZenTao config state (env names only)",
      mimeType: "text/plain",
    },
    {
      uri: "zentao://projects",
      name: "Projects related to current account",
      mimeType: "application/json",
    },
  ],
}));

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const { uri } = request.params;
  if (uri === "zentao://endpoints") {
    return {
      contents: [
        { uri, mimeType: "text/plain", text: endpointIndex },
      ],
    };
  }
  if (uri === "zentao://config") {
    return {
      contents: [
        {
          uri,
          mimeType: "text/plain",
          text: [
            `ZENTAO_BASE_URL: ${baseUrl ? "set" : "missing"}`,
            `ZENTAO_ACCOUNT: ${account ? "set" : "missing"}`,
            `ZENTAO_PASSWORD: ${password ? "set" : "missing"}`,
            `ZENTAO_TOKEN: ${cachedToken ? "set (cached)" : "not cached"}`,
          ].join("\\n"),
        },
      ],
    };
  }
  if (uri === "zentao://projects") {
    const projects = await listProjectsForAccount({ limit: 100 });
    return {
      contents: [
        {
          uri,
          mimeType: "application/json",
          text: JSON.stringify({ projects }, null, 2),
        },
      ],
    };
  }
  throw new Error(`Unknown resource: ${uri}`);
});

server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => ({
  resourceTemplates: [],
}));

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "get_token",
      description: "Fetch a token via POST /tokens using env ZENTAO_ACCOUNT/PASSWORD. Caches in-memory.",
      inputSchema: {
        type: "object",
        properties: {
          forceRefresh: { type: "boolean", description: "Ignore cached token" },
        },
        required: [],
        additionalProperties: false,
      },
    },
    {
      name: "call",
      description:
        "Call any ZenTao RESTful API endpoint (api.php/v1). Automatically injects Token header. Paths accept leading slash or relative.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "Relative path, e.g. /projects or projects/1" },
          method: {
            type: "string",
            description: "HTTP verb",
            enum: ["GET", "POST", "PUT", "PATCH", "DELETE"],
            default: "GET",
          },
          query: { type: "object", description: "Query params object", additionalProperties: true },
          body: { type: "object", description: "JSON body", additionalProperties: true },
          forceTokenRefresh: {
            type: "boolean",
            description: "Refresh token before request",
          },
        },
        required: ["path"],
        additionalProperties: false,
      },
    },
    {
      name: "listMyProjects",
      description: "List projects related to the current account (PM/PO/QD/RD/assigned/team).",
      inputSchema: {
        type: "object",
        properties: {
          keyword: { type: "string", description: "Filter by project name keyword" },
          limit: { type: "number", description: "Max items", default: 50 },
        },
        required: [],
        additionalProperties: false,
      },
    },
    {
      name: "searchProducts",
      description: "Search products by keyword; returns a short list of products.",
      inputSchema: {
        type: "object",
        properties: {
          keyword: { type: "string", description: "Keyword to match product name" },
          limit: { type: "number", description: "Max items", default: 20 },
        },
        required: [],
        additionalProperties: false,
      },
    },
    {
      name: "getMyBug",
      description:
        "Get the first active bug assigned to me in a product (by productName). Returns full bug detail.",
      inputSchema: {
        type: "object",
        properties: {
          productName: { type: "string", description: "Product name to match (required)" },
          keyword: { type: "string", description: "Keyword filter on bug title" },
          status: { type: "string", description: "Status filter (e.g., active)" },
          allStatuses: {
            type: "boolean",
            description: "Include non-active bugs",
            default: false,
          },
        },
        required: ["productName"],
        additionalProperties: false,
      },
    },
    {
      name: "getMyBugs",
      description:
        "List bugs assigned to me under a product. Defaults to active bugs only.",
      inputSchema: {
        type: "object",
        properties: {
          productId: { type: "number", description: "Product ID (required)" },
          keyword: { type: "string", description: "Keyword filter on bug title" },
          status: { type: "string", description: "Status filter (e.g., active)" },
          allStatuses: {
            type: "boolean",
            description: "Include non-active bugs",
            default: false,
          },
          limit: { type: "number", description: "Max items", default: 20 },
        },
        required: ["productId"],
        additionalProperties: false,
      },
    },
    {
      name: "getNextBug",
      description:
        "Get the next active bug assigned to me under a product (first match).",
      inputSchema: {
        type: "object",
        properties: {
          productId: { type: "number", description: "Product ID (required)" },
          keyword: { type: "string", description: "Keyword filter on bug title" },
          status: { type: "string", description: "Status filter (e.g., active)" },
        },
        required: ["productId"],
        additionalProperties: false,
      },
    },
    {
      name: "getBugStats",
      description:
        "Get counts of bugs assigned to me under a product (total and active).",
      inputSchema: {
        type: "object",
        properties: {
          productId: { type: "number", description: "Product ID (required)" },
          activeOnly: {
            type: "boolean",
            description: "If true, only active count is returned",
            default: false,
          },
        },
        required: ["productId"],
        additionalProperties: false,
      },
    },
    {
      name: "getBugDetail",
      description:
        "Get bug detail by ID; also extracts image URLs from steps HTML into stepsImages.",
      inputSchema: {
        type: "object",
        properties: {
          bugId: { type: "number", description: "Bug ID (required)" },
        },
        required: ["bugId"],
        additionalProperties: false,
      },
    },
    {
      name: "markBugResolved",
      description: "Mark a bug as resolved (resolution=fixed).",
      inputSchema: {
        type: "object",
        properties: {
          bugId: { type: "number", description: "Bug ID (required)" },
          comment: { type: "string", description: "Resolution comment" },
        },
        required: ["bugId"],
        additionalProperties: false,
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;
  if (name === "get_token") {
    const token = await fetchToken(Boolean(args.forceRefresh));
    return {
      content: [
        {
          type: "text",
          text: `token=${token}`,
        },
      ],
    };
  }

  if (name === "call") {
    const { path, method = "GET", query, body, forceTokenRefresh = false } = args;
    if (!path) throw new Error("path is required");
    const response = await callZenTao({
      path,
      method,
      query,
      body,
      forceTokenRefresh,
    });
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(response, null, 2),
        },
      ],
    };
  }

  if (name === "listMyProjects") {
    const { keyword, limit } = args;
    const projects = await listProjectsForAccount({ keyword, limit });
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ projects }, null, 2),
        },
      ],
    };
  }

  if (name === "searchProducts") {
    const { keyword, limit } = args;
    const products = await listProducts({ keyword, limit });
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ products }, null, 2),
        },
      ],
    };
  }

  if (name === "getMyBug") {
    const { productName, keyword, status, allStatuses = false } = args;
    const { product, matches } = await findProductByName(productName);
    if (!product) {
      const names = matches.map((p) => `${p.id}:${p.name}`).join(", ");
      throw new Error(
        matches.length === 0
          ? `No product matched "${productName}"`
          : `Multiple products matched "${productName}", please specify one of: ${names}`
      );
    }
    const { bugs } = await fetchBugsByProduct({
      productId: product.id,
      keyword,
      status,
      allStatuses,
      limit: 1,
    });
    if (!bugs.length) {
      return {
        content: [
          {
            type: "text",
            text: `No active bugs assigned to ${account || "me"} in product "${product.name}"`,
          },
        ],
      };
    }
    const bugDetail = await getBugWithImages(bugs[0].id || bugs[0].bugId);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            { product: { id: product.id, name: product.name }, bug: bugDetail },
            null,
            2
          ),
        },
      ],
    };
  }

  if (name === "getMyBugs") {
    const { productId, keyword, status, allStatuses = false, limit = 20 } = args;
    const { bugs, raw } = await fetchBugsByProduct({
      productId,
      keyword,
      allStatuses,
      status,
      limit,
    });
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ bugs, raw }, null, 2),
        },
      ],
    };
  }

  if (name === "getNextBug") {
    const { productId, keyword, status } = args;
    let page = 1;
    const pageSize = 20;
    while (page <= 10) {
      const { bugs } = await fetchBugsByProduct({
        productId,
        keyword,
        status,
        limit: pageSize,
        page,
      });
      if (bugs.length) {
        const bugDetail = await getBugWithImages(bugs[0].id || bugs[0].bugId);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ bug: bugDetail }, null, 2),
            },
          ],
        };
      }
      page += 1;
    }
    return {
      content: [
        {
          type: "text",
          text: `No active bugs assigned to ${account || "me"} found under product ${productId}`,
        },
      ],
    };
  }

  if (name === "getBugStats") {
    const { productId, activeOnly = false } = args;
    const { bugs } = await fetchBugsByProduct({
      productId,
      allStatuses: !activeOnly,
      limit: 200,
    });
    const total = bugs.length;
    const active = bugs.filter((b) => (b.status || b.state || "").toLowerCase() === "active")
      .length;
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ productId, total, active }, null, 2),
        },
      ],
    };
  }

  if (name === "getBugDetail") {
    const { bugId } = args;
    const bug = await getBugWithImages(bugId);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ bug }, null, 2),
        },
      ],
    };
  }

  if (name === "markBugResolved") {
    const { bugId, comment } = args;
    const response = await callZenTao({
      path: `bugs/${bugId}/resolve`,
      method: "POST",
      body: { resolution: "fixed", comment },
    });
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(response, null, 2),
        },
      ],
    };
  }

  throw new Error(`Unknown tool: ${name}`);
});

const transport = new StdioServerTransport();
server.connect(transport);
