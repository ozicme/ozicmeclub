const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const restaurantRoot = path.join(root, "restaurants");
const homeHtml = fs.readFileSync(path.join(root, "index.html"), "utf8");
const aboutHtml = fs.readFileSync(path.join(root, "about", "index.html"), "utf8");
const sitemapXml = fs.readFileSync(path.join(root, "sitemap.xml"), "utf8");

if (!homeHtml.includes('"@type": "SearchAction"')) {
  throw new Error("홈페이지 WebSite 구조화 정보에 SearchAction이 없습니다.");
}

if (!aboutHtml.includes('"@type":"AboutPage"')) {
  throw new Error("소개·운영기준 페이지에 AboutPage 구조화 정보가 없습니다.");
}
if (!sitemapXml.includes("https://ozicmeclub.com/about/")) {
  throw new Error("사이트맵에 소개·운영기준 페이지가 없습니다.");
}

const restaurantDirectories = fs
  .readdirSync(restaurantRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

let menuPageCount = 0;
for (const directory of restaurantDirectories) {
  const html = fs.readFileSync(path.join(restaurantRoot, directory, "index.html"), "utf8");
  const match = html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s);
  if (!match) throw new Error(`${directory}: JSON-LD가 없습니다.`);

  const structuredData = JSON.parse(match[1]);
  const graph = structuredData["@graph"] || [structuredData];
  const restaurant = graph.find((item) => item["@type"] === "Restaurant");
  const breadcrumb = graph.find((item) => item["@type"] === "BreadcrumbList");
  if (!restaurant) throw new Error(`${directory}: Restaurant 구조화 정보가 없습니다.`);
  if (!breadcrumb) throw new Error(`${directory}: BreadcrumbList 구조화 정보가 없습니다.`);
  if (!restaurant.mainEntityOfPage?.["@id"]) {
    throw new Error(`${directory}: mainEntityOfPage가 없습니다.`);
  }
  if (!restaurant.dateModified) {
    throw new Error(`${directory}: dateModified가 없습니다.`);
  }
  if (!restaurant.hasMenu?.hasMenuSection?.hasMenuItem?.length) {
    throw new Error(`${directory}: 대표 메뉴 구조화 정보가 없습니다.`);
  }
  menuPageCount += 1;
}

console.log(
  `검색 구조 검증 통과: 식당 ${restaurantDirectories.length.toLocaleString("ko-KR")}곳, 대표 메뉴 구조화 ${menuPageCount.toLocaleString("ko-KR")}곳`
);
