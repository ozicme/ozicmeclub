const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const SITE_URL = "https://ozicmeclub.com";
const BASE_CSV = path.join(
  ROOT,
  "오직미_식당리스트 - 오직미_식당디렉토리_사이트개발용_최종정비.csv"
);
const ADMIN_JSON = path.join(ROOT, "data", "admin-restaurants.json");
const OVERRIDES_JSON = path.join(ROOT, "data", "restaurant-overrides.json");
const CLEANUP_JSON = path.join(ROOT, "data", "naver-place-cleanup-2026-08-10.json");
const RESTAURANTS_DIR = path.join(ROOT, "restaurants");
const REGIONS_DIR = path.join(ROOT, "regions");
const LASTMOD = process.env.SEO_LASTMOD || new Date().toISOString().slice(0, 10);

const readJson = (filePath) => {
  if (!fs.existsSync(filePath)) return [];
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
};

const parseCsv = (content) => {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  const text = String(content || "").replace(/^\uFEFF/, "");
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  if (!rows.length) return [];
  const headers = rows[0].map((header) => header.trim());
  return rows
    .slice(1)
    .filter((values) => values.some((value) => String(value).trim()))
    .map((values) =>
      Object.fromEntries(headers.map((header, index) => [header, values[index] || ""]))
    );
};

const rawValueOf = (record, keys) => {
  for (const key of keys) {
    const value = record?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return String(value).trim();
    }
  }
  return "";
};

const canonicalRestaurantUrl = (value) => {
  try {
    const url = new URL(String(value || "").trim());
    return `${url.hostname.toLowerCase()}${url.pathname.replace(/\/+$/, "")}`;
  } catch (error) {
    return String(value || "").trim().replace(/[?#].*$/, "").replace(/\/+$/, "");
  }
};

const restaurantPlaceId = (value) => {
  const text = String(value || "");
  const match =
    text.match(/\/(?:entry\/)?place\/(\d+)/i) || text.match(/\/(\d{5,})(?:\/|$|[?#])/);
  return match ? match[1] : "";
};

const restaurantFingerprint = (name, address) => {
  const normalized = `${name || ""}|${address || ""}`
    .replace(/[^0-9a-z가-힣]/gi, "")
    .toLowerCase();
  let value = 0x811c9dc5;
  for (const character of normalized) {
    value ^= character.codePointAt(0);
    value = Math.imul(value, 0x01000193) >>> 0;
  }
  return value.toString(16).padStart(8, "0");
};

const restaurantTargetKey = (record) => {
  if (record?.targetKey) return String(record.targetKey);
  if (record?.id) return `id:${record.id}`;
  const naverUrl = rawValueOf(record, [
    "naverPlaceUrl",
    "naver_place_url",
    "네이버플레이스",
    "네이버플레이스URL",
    "네이버플레이스링크",
  ]);
  const name = rawValueOf(record, ["name", "상호명", "식당명"]);
  const address = rawValueOf(record, ["address", "대표주소", "주소"]);
  const fingerprint = restaurantFingerprint(name, address);
  const placeId = restaurantPlaceId(naverUrl);
  if (placeId) return `place:${placeId}:${fingerprint}`;
  const canonical = canonicalRestaurantUrl(naverUrl);
  if (canonical) return `url:${canonical}:${fingerprint}`;
  return `record:${fingerprint}`;
};

const mergeRestaurantOverrides = (baseStores, adminStores, overrides, cleanupOverrides) => {
  const overrideMap = [...overrides, ...cleanupOverrides]
    .filter((item) => item && item.targetKey)
    .reduce((map, item) => {
      const key = String(item.targetKey);
      const current = map.get(key) || {};
      map.set(key, {
        ...current,
        ...item,
        region: { ...(current.region || {}), ...(item.region || {}) },
      });
      return map;
    }, new Map());
  const occurrences = new Map();
  return [
    ...baseStores.map((item) => ({ ...item, dataSource: "base" })),
    ...adminStores.map((item) => ({ ...item, dataSource: "admin" })),
  ]
    .map((item) => {
      const baseKey = restaurantTargetKey(item);
      const occurrence = (occurrences.get(baseKey) || 0) + 1;
      occurrences.set(baseKey, occurrence);
      const targetKey = occurrence === 1 ? baseKey : `${baseKey}:duplicate:${occurrence}`;
      const override = overrideMap.get(targetKey);
      if (!override) return { ...item, targetKey };
      if (override.deleted === true) return null;
      return {
        ...item,
        ...override,
        id: item.id || override.id,
        targetKey,
        dataSource: item.dataSource,
        region: { ...(item.region || {}), ...(override.region || {}) },
      };
    })
    .filter(Boolean);
};

const splitList = (value) => {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  return String(value || "")
    .split(/[\/,+]/g)
    .map((item) => item.trim())
    .filter(Boolean);
};

const valueOf = (record, keys) => {
  for (const key of keys) {
    const value = record?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== "") return value;
  }
  return "";
};

const normalizeStore = (row) => {
  const name = String(valueOf(row, ["name", "store_name", "상호", "상호명", "식당명"])).trim();
  const address = String(
    valueOf(row, ["address", "addr", "도로명주소", "주소", "대표주소"])
  ).trim();
  const naverPlaceUrl = String(
    valueOf(row, [
      "naver_place_url",
      "naverPlaceUrl",
      "naverPlace",
      "네이버플레이스",
      "네이버플레이스URL",
      "네이버플레이스링크",
      "네이버 플레이스",
      "플레이스링크",
    ])
  ).trim();
  const region = row.region || {
    sido: row.sido || row.지역_시도 || row.지역시도 || "",
    sigungu: row.sigungu || row.지역_시군구 || row.지역시군구 || "",
    eupmyeondong: row.eupmyeondong || row.지역_읍면동 || row.지역읍면동 || "",
  };
  const category = String(
    valueOf(row, ["category", "식당유형_대", "식당유형대", "카테고리"])
  ).trim();
  const categoryDetail = String(
    valueOf(row, ["categoryDetail", "category_detail", "식당유형_세부", "식당유형세부"])
  ).trim();
  const signatureMenus = splitList(
    valueOf(row, ["signatureMenus", "mainDishes", "주요리_대표", "대표메뉴", "메뉴"])
  );
  const imageUrl = String(
    valueOf(row, [
      "imageUrl",
      "image_url",
      "image",
      "thumbnail",
      "thumb",
      "img",
      "photo",
      "대표이미지",
      "이미지",
      "이미지링크",
    ])
  ).trim();
  const verifiedBadge = row.verifiedBadge === true || String(row.registrationType || "") === "ozicme";
  const placeId = restaurantPlaceId(naverPlaceUrl);
  const fingerprint = restaurantFingerprint(name, address);
  const seoId = placeId ? `p-${placeId}-${fingerprint}` : `r-${fingerprint}`;
  return {
    name,
    address,
    naverPlaceUrl,
    region: {
      sido: String(region?.sido || "").trim(),
      sigungu: String(region?.sigungu || "").trim(),
      eupmyeondong: String(region?.eupmyeondong || "").trim(),
    },
    category,
    categoryDetail,
    signatureMenus,
    imageUrl,
    verifiedBadge,
    badgeLabel: verifiedBadge ? "오직미클럽" : "",
    verifiedMonth: String(row.verifiedMonth || "").trim(),
    seoId,
    seoPath: `/restaurants/${seoId}/`,
  };
};

const escapeHtml = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const slugify = (value) => {
  const slug = String(value || "")
    .normalize("NFC")
    .replace(/[^0-9a-zA-Z가-힣]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return slug || "기타";
};

const publicUrl = (pathname) =>
  `${SITE_URL}${pathname
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/")}`;

const menuText = (item) => item.signatureMenus.slice(0, 5).join(" · ") || "대표 메뉴 정보 준비 중";
const regionText = (item) =>
  [item.region.sido, item.region.sigungu, item.region.eupmyeondong].filter(Boolean).join(" ");

const baseHeader = () => `
  <header class="seo-header">
    <a class="seo-logo" href="/">OZICME</a>
    <nav aria-label="주요 메뉴">
      <a href="/">식당 찾기</a>
      <a href="/restaurants/">전체 식당 목록</a>
      <a href="https://ozicme.com" target="_blank" rel="noopener">오직미 공식 사이트</a>
    </nav>
  </header>`;

const pageShell = ({ title, description, canonical, image, jsonLd, body }) => `<!doctype html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(description)}">
  <link rel="canonical" href="${escapeHtml(canonical)}">
  <meta property="og:site_name" content="오직미클럽">
  <meta property="og:type" content="website">
  <meta property="og:title" content="${escapeHtml(title)}">
  <meta property="og:description" content="${escapeHtml(description)}">
  <meta property="og:url" content="${escapeHtml(canonical)}">
  <meta property="og:image" content="${escapeHtml(image || `${SITE_URL}/assets/ozicmeclub-share.jpg`)}">
  <meta name="theme-color" content="#1f6b4e">
  <link rel="icon" type="image/png" href="/favicon.png">
  <link rel="stylesheet" href="/seo-pages.css?v=20261108-1">
  <script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, "\\u003c")}</script>
</head>
<body>
  <div class="seo-page">
    ${baseHeader()}
    <main>${body}</main>
    <footer class="seo-footer">© 2026 OZICME · 오직미클럽 식당 정보</footer>
  </div>
</body>
</html>
`;

const renderRestaurantPage = (item) => {
  const verifiedLabel = item.verifiedBadge
    ? "오직미 쌀 거래 확인 식당"
    : "외부 식당 정보 · 오직미클럽 인증 식당 아님";
  const area = regionText(item) || "지역 정보 준비 중";
  const title = item.verifiedBadge
    ? `${item.name} | ${item.region.sigungu || item.region.sido} 오직미클럽 인증 식당`
    : `${item.name} | ${item.region.sigungu || item.region.sido} 식당 정보`;
  const description = `${area} ${item.category || "식당"} ${item.name}. 대표 메뉴: ${menuText(
    item
  )}. ${verifiedLabel}.`;
  const canonical = publicUrl(item.seoPath);
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Restaurant",
    name: item.name,
    url: canonical,
    ...(item.imageUrl ? { image: [item.imageUrl] } : {}),
    ...(item.category ? { servesCuisine: item.category } : {}),
    address: {
      "@type": "PostalAddress",
      streetAddress: item.address,
      addressRegion: item.region.sido,
      addressLocality: item.region.sigungu,
      addressCountry: "KR",
    },
    ...(item.naverPlaceUrl ? { sameAs: [item.naverPlaceUrl] } : {}),
    isPartOf: { "@type": "WebSite", name: "오직미클럽", url: SITE_URL },
    additionalProperty: {
      "@type": "PropertyValue",
      name: "오직미클럽 인증 여부",
      value: item.verifiedBadge ? "오직미 쌀 거래 확인" : "인증 아님",
    },
  };
  const badgeClass = item.verifiedBadge ? "is-verified" : "is-external";
  const image = item.imageUrl
    ? `<img class="restaurant-image" src="${escapeHtml(item.imageUrl)}" alt="${escapeHtml(
        item.name
      )} 대표 이미지" referrerpolicy="no-referrer" loading="eager">`
    : `<div class="restaurant-image image-placeholder" aria-label="이미지 준비 중">🍚</div>`;
  const body = `
    <article class="restaurant-detail">
      <p class="breadcrumb"><a href="/">식당 찾기</a> / <a href="/restaurants/">전체 식당</a> / ${escapeHtml(
        item.name
      )}</p>
      <div class="restaurant-hero">
        ${image}
        <div class="restaurant-copy">
          <span class="verification ${badgeClass}">${escapeHtml(verifiedLabel)}</span>
          <h1>${escapeHtml(item.name)}</h1>
          <p class="lead">${escapeHtml(area)} · ${escapeHtml(item.category || "업종 정보 준비 중")}</p>
          <dl class="facts">
            <div><dt>주소</dt><dd>${escapeHtml(item.address || "주소 정보 준비 중")}</dd></div>
            <div><dt>업종</dt><dd>${escapeHtml(
              [item.category, item.categoryDetail].filter(Boolean).join(" · ") || "정보 준비 중"
            )}</dd></div>
            <div><dt>대표 메뉴</dt><dd>${escapeHtml(menuText(item))}</dd></div>
            <div><dt>등록 구분</dt><dd>${escapeHtml(verifiedLabel)}</dd></div>
          </dl>
          <div class="detail-actions">
            ${
              item.naverPlaceUrl
                ? `<a class="seo-button primary" href="${escapeHtml(
                    item.naverPlaceUrl
                  )}" target="_blank" rel="noopener">네이버 지도에서 보기</a>`
                : ""
            }
            <a class="seo-button" href="/?sido=${encodeURIComponent(
              item.region.sido
            )}&sigungu=${encodeURIComponent(item.region.sigungu)}">같은 지역 식당 찾기</a>
          </div>
        </div>
      </div>
      <section class="verification-note">
        <h2>${item.verifiedBadge ? "오직미클럽 인증 안내" : "등록 정보 안내"}</h2>
        <p>${
          item.verifiedBadge
            ? `이 식당은 오직미 쌀 거래가 확인되어 오직미클럽 초록 배지가 표시됩니다.${
                item.verifiedMonth ? ` 최근 확인 월은 ${escapeHtml(item.verifiedMonth)}입니다.` : ""
              }`
            : "이 페이지는 식당 검색을 위한 외부 정보입니다. 현재 오직미 쌀 거래가 확인된 오직미클럽 인증 식당은 아닙니다."
        }</p>
      </section>
    </article>`;
  return pageShell({ title, description, canonical, image: item.imageUrl, jsonLd, body });
};

const groupBy = (items, keyOf) => {
  const groups = new Map();
  for (const item of items) {
    const key = keyOf(item) || "기타";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  return groups;
};

const restaurantList = (items) => `
  <ul class="restaurant-link-list">
    ${items
      .map(
        (item) => `<li>
          <a href="${escapeHtml(item.seoPath)}">${escapeHtml(item.name)}</a>
          ${item.verifiedBadge ? '<span class="mini-badge">오직미클럽</span>' : ""}
          <small>${escapeHtml(
            [item.region.sigungu, item.region.eupmyeondong, item.category].filter(Boolean).join(" · ")
          )}</small>
        </li>`
      )
      .join("\n")}
  </ul>`;

const renderIndexPage = (stores, regionEntries) => {
  const title = `전체 식당 ${stores.length.toLocaleString("ko-KR")}곳 | 오직미클럽`;
  const description = `오직미클럽 인증 식당과 외부 식당 정보를 지역별로 확인하세요. 오직미 쌀 거래 확인 식당은 초록 배지로 구분합니다.`;
  const canonical = `${SITE_URL}/restaurants/`;
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: title,
    url: canonical,
    description,
  };
  const body = `
    <section class="directory-page">
      <p class="breadcrumb"><a href="/">식당 찾기</a> / 전체 식당</p>
      <h1>전체 식당 목록</h1>
      <p class="lead">총 ${stores.length.toLocaleString("ko-KR")}곳 · 오직미클럽 인증 ${stores
        .filter((item) => item.verifiedBadge)
        .length.toLocaleString("ko-KR")}곳</p>
      <div class="status-legend">
        <span class="verification is-verified">오직미 쌀 거래 확인 식당</span>
        <span class="verification is-external">외부 식당 정보</span>
      </div>
      <h2>지역별 찾기</h2>
      <div class="region-grid">
        ${regionEntries
          .map(
            ({ label, url, count }) =>
              `<a href="${escapeHtml(url)}"><strong>${escapeHtml(label)}</strong><span>${count.toLocaleString(
                "ko-KR"
              )}곳</span></a>`
          )
          .join("\n")}
      </div>
      <h2>식당명으로 찾기</h2>
      ${restaurantList(stores)}
    </section>`;
  return pageShell({ title, description, canonical, jsonLd, body });
};

const renderRegionPage = ({ label, stores, pathname, childRegions = [] }) => {
  const verifiedCount = stores.filter((item) => item.verifiedBadge).length;
  const title = `${label} 오직미클럽·식당 목록 ${stores.length.toLocaleString("ko-KR")}곳`;
  const description = `${label} 식당 ${stores.length.toLocaleString(
    "ko-KR"
  )}곳을 확인하세요. 오직미 쌀 거래 확인 식당 ${verifiedCount.toLocaleString(
    "ko-KR"
  )}곳은 초록 배지로 구분됩니다.`;
  const canonical = publicUrl(pathname);
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: title,
    url: canonical,
    description,
  };
  const body = `
    <section class="directory-page">
      <p class="breadcrumb"><a href="/">식당 찾기</a> / <a href="/restaurants/">전체 식당</a> / ${escapeHtml(
        label
      )}</p>
      <h1>${escapeHtml(label)} 식당 찾기</h1>
      <p class="lead">전체 ${stores.length.toLocaleString(
        "ko-KR"
      )}곳 · 오직미클럽 인증 ${verifiedCount.toLocaleString("ko-KR")}곳</p>
      ${
        childRegions.length
          ? `<div class="region-grid">${childRegions
              .map(
                ({ label: childLabel, url, count }) =>
                  `<a href="${escapeHtml(url)}"><strong>${escapeHtml(
                    childLabel
                  )}</strong><span>${count.toLocaleString("ko-KR")}곳</span></a>`
              )
              .join("\n")}</div>`
          : ""
      }
      ${restaurantList(stores)}
    </section>`;
  return pageShell({ title, description, canonical, jsonLd, body });
};

const ensureCleanDirectory = (directory) => {
  fs.rmSync(directory, { recursive: true, force: true });
  fs.mkdirSync(directory, { recursive: true });
};

const writePage = (directory, content) => {
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, "index.html"), content, "utf8");
};

const generate = () => {
  const baseStores = parseCsv(fs.readFileSync(BASE_CSV, "utf8"));
  const merged = mergeRestaurantOverrides(
    baseStores,
    readJson(ADMIN_JSON),
    readJson(OVERRIDES_JSON),
    readJson(CLEANUP_JSON)
  );
  const seen = new Set();
  const stores = merged
    .map(normalizeStore)
    .filter((item) => {
      const key = `${item.name}|${item.address}`.replace(/\s+/g, "").toLowerCase();
      if (!item.name || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.name.localeCompare(b.name, "ko"));

  ensureCleanDirectory(RESTAURANTS_DIR);
  ensureCleanDirectory(REGIONS_DIR);

  for (const item of stores) {
    writePage(path.join(RESTAURANTS_DIR, item.seoId), renderRestaurantPage(item));
  }

  const sitemapPaths = ["/", "/restaurants/"];
  const sidoGroups = groupBy(stores, (item) => item.region.sido);
  const regionEntries = [];
  for (const [sido, sidoStores] of Array.from(sidoGroups).sort(([a], [b]) => a.localeCompare(b, "ko"))) {
    const sidoSlug = slugify(sido);
    const sidoPath = `/regions/${sidoSlug}/`;
    const sigunguGroups = groupBy(sidoStores, (item) => item.region.sigungu);
    const childRegions = [];
    for (const [sigungu, sigunguStores] of Array.from(sigunguGroups).sort(([a], [b]) =>
      a.localeCompare(b, "ko")
    )) {
      const sigunguSlug = slugify(sigungu);
      const sigunguPath = `/regions/${sidoSlug}/${sigunguSlug}/`;
      writePage(
        path.join(REGIONS_DIR, sidoSlug, sigunguSlug),
        renderRegionPage({ label: `${sido} ${sigungu}`, stores: sigunguStores, pathname: sigunguPath })
      );
      childRegions.push({ label: sigungu, url: sigunguPath, count: sigunguStores.length });
      sitemapPaths.push(sigunguPath);
    }
    writePage(
      path.join(REGIONS_DIR, sidoSlug),
      renderRegionPage({ label: sido, stores: sidoStores, pathname: sidoPath, childRegions })
    );
    regionEntries.push({ label: sido, url: sidoPath, count: sidoStores.length });
    sitemapPaths.push(sidoPath);
  }

  writePage(RESTAURANTS_DIR, renderIndexPage(stores, regionEntries));
  fs.writeFileSync(
    path.join(ROOT, "restaurants-data.json"),
    `${JSON.stringify(stores)}\n`,
    "utf8"
  );
  sitemapPaths.push(...stores.map((item) => item.seoPath));
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${sitemapPaths
    .map(
      (pathname) => `  <url>\n    <loc>${escapeHtml(publicUrl(pathname))}</loc>\n    <lastmod>${LASTMOD}</lastmod>\n  </url>`
    )
    .join("\n")}\n</urlset>\n`;
  fs.writeFileSync(path.join(ROOT, "sitemap.xml"), sitemap, "utf8");

  const stats = {
    generatedAt: LASTMOD,
    totalRestaurants: stores.length,
    verifiedRestaurants: stores.filter((item) => item.verifiedBadge).length,
    externalRestaurants: stores.filter((item) => !item.verifiedBadge).length,
    regionPages: sitemapPaths.filter((item) => item.startsWith("/regions/")).length,
    sitemapUrls: sitemapPaths.length,
  };
  fs.writeFileSync(path.join(ROOT, "seo-build-stats.json"), `${JSON.stringify(stats, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(stats, null, 2));
};

generate();
