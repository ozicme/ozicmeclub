const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const PORT = process.env.PORT || 3000;
const ROOT_DIR = __dirname;
const DATA_PATH = path.join(ROOT_DIR, "public-restaurants.json");

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
};

const loadRestaurants = () => {
  try {
    const raw = fs.readFileSync(DATA_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return parsed.map((item) => ({
      ...item,
      searchText: [
        item.name,
        item.address,
        item.category,
        item.categoryDetail,
        item.region?.sido,
        item.region?.sigungu,
        item.region?.eupmyeondong,
        ...(item.searchTags || []),
        ...(item.signatureMenus || []),
        ...(item.mainDishes || []),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase(),
    }));
  } catch (error) {
    console.error("Failed to load restaurant data:", error);
    return [];
  }
};

let restaurantCache = loadRestaurants();

const filterRestaurants = (query) => {
  if (!query) return restaurantCache;
  const tokens = query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  if (tokens.length === 0) return restaurantCache;
  return restaurantCache.filter((item) =>
    tokens.every((token) => item.searchText.includes(token))
  );
};

const sendJson = (res, status, payload) => {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
};

const serveFile = (res, filePath) => {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not Found");
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const type = CONTENT_TYPES[ext] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": type });
    res.end(data);
  });
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === "/api/stores") {
    const query = url.searchParams.get("query") || "";
    const cursor = Number.parseInt(url.searchParams.get("cursor") || "0", 10);
    const limit = Number.parseInt(url.searchParams.get("limit") || "20", 10);
    const safeCursor = Number.isNaN(cursor) || cursor < 0 ? 0 : cursor;
    const safeLimit = Number.isNaN(limit) || limit <= 0 ? 20 : Math.min(limit, 50);

    const filtered = filterRestaurants(query);
    const items = filtered.slice(safeCursor, safeCursor + safeLimit);
    const nextCursor = safeCursor + items.length;
    const hasMore = nextCursor < filtered.length;

    sendJson(res, 200, {
      items,
      nextCursor: hasMore ? nextCursor : null,
      hasMore,
      totalCount: filtered.length,
    });
    return;
  }

  let filePath = path.join(ROOT_DIR, url.pathname === "/" ? "index.html" : url.pathname);
  if (!filePath.startsWith(ROOT_DIR)) {
    res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Forbidden");
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not Found");
      return;
    }
    serveFile(res, filePath);
  });
});

server.listen(PORT, () => {
  console.log(`OZICME server running on http://localhost:${PORT}`);
});
