const DATA_URL = "./data/stores.json";
const FETCH_TIMEOUT_MS = 8000;

let allStores = [];
let cursor = 0;
const pageSize = 20;
let isLoading = false;
let observer = null;

const debugState = {
  lastUrl: "",
  status: "",
  type: "",
  count: 0,
  cursor: 0,
  message: "",
  error: "",
};

const ensureDebugPanel = () => {
  let panel = document.getElementById("debug-panel");
  if (panel) return panel;

  panel = document.createElement("section");
  panel.id = "debug-panel";
  panel.className = "debug-panel";
  panel.innerHTML = `
    <div class="debug-header">
      <strong>Debug</strong>
      <button type="button" class="btn btn-outline btn-xs" id="debug-copy">Copy debug info</button>
    </div>
    <pre class="debug-body" id="debug-body"></pre>
  `;
  document.body.appendChild(panel);

  const copyButton = panel.querySelector("#debug-copy");
  copyButton?.addEventListener("click", async () => {
    const text = buildDebugText();
    try {
      await navigator.clipboard.writeText(text);
      setDebugMessage("DEBUG_COPIED");
    } catch (error) {
      setDebugMessage(`DEBUG_COPY_FAILED: ${error instanceof Error ? error.message : String(error)}`);
    }
  });

  return panel;
};

const buildDebugText = () => {
  return [
    debugState.message,
    `url=${debugState.lastUrl}`,
    `status=${debugState.status}`,
    `type=${debugState.type}`,
    `count=${debugState.count}`,
    `cursor:${debugState.cursor}`,
    debugState.error ? `error=${debugState.error}` : "",
  ]
    .filter(Boolean)
    .join("\n");
};

const setDebugMessage = (message) => {
  debugState.message = message;
  updateDebugPanel();
};

const setDebugError = (error) => {
  debugState.error = error;
  updateDebugPanel();
};

const updateDebugPanel = () => {
  const panel = ensureDebugPanel();
  const body = panel.querySelector("#debug-body");
  if (!body) return;
  body.textContent = buildDebugText();
};

window.addEventListener("error", (event) => {
  const message = event?.error instanceof Error ? event.error.stack || event.error.message : event.message;
  setDebugError(message || "UNKNOWN_ERROR");
});

window.addEventListener("unhandledrejection", (event) => {
  const reason = event?.reason instanceof Error ? event.reason.stack || event.reason.message : String(event?.reason);
  setDebugError(reason || "UNHANDLED_REJECTION");
});

const formatValue = (value, fallback = "미등록") =>
  value && String(value).trim().length > 0 ? value : fallback;

const slugify = (text) =>
  text
    .toString()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9가-힣]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();

const getImageUrl = (item) =>
  item.imageUrl || item.image_url || item.thumbnail || item.images?.[0] || "";

const getPlaceLink = (item) =>
  item.naverPlaceUrl || item.naver_place_url || "";

const buildAddress = (item) =>
  item.address ||
  [item.region?.sido, item.region?.sigungu, item.region?.eupmyeondong]
    .filter(Boolean)
    .join(" ");

const buildMenuList = (menus) => {
  if (!menus || menus.length === 0) {
    return "대표 메뉴 미등록";
  }
  return menus.slice(0, 3).join(" · ");
};

const getBadgeLabel = (item) =>
  item.verifiedBadge ? "오직미 인증" : "인증 확인중";

const buildSearchText = (item) =>
  [
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
    .toLowerCase();

const debounce = (callback, delay = 200) => {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => callback(...args), delay);
  };
};

const updateKakaoShare = () => {
  const kakaoShare = document.getElementById("kakao-share");
  if (!kakaoShare) return;
  const url = encodeURIComponent(window.location.href);
  kakaoShare.href = `https://share.kakao.com/?url=${url}`;
};

const renderSkeletons = (container, count = 6) => {
  container.innerHTML = "";
  Array.from({ length: count }).forEach(() => {
    const card = document.createElement("div");
    card.className = "skeleton-card";
    card.innerHTML = `
      <div class="skeleton" style="width: 70%; height: 18px;"></div>
      <div class="skeleton" style="width: 45%; height: 14px;"></div>
      <div class="skeleton" style="width: 80%; height: 14px;"></div>
      <div class="skeleton" style="width: 60%; height: 14px;"></div>
    `;
    container.appendChild(card);
  });
};

const buildMediaFrame = ({ src, alt, aspectRatio, className = "" }) => {
  const frame = document.createElement("div");
  frame.className = `media-frame ${className}`.trim();
  if (aspectRatio) {
    frame.style.setProperty("--media-aspect", aspectRatio);
  }
  const placeholder = document.createElement("div");
  placeholder.className = "media-placeholder";
  placeholder.innerHTML = `<span aria-hidden="true">🍚</span><span>이미지 준비중</span>`;
  frame.appendChild(placeholder);
  if (src) {
    const img = document.createElement("img");
    img.src = src;
    img.alt = alt;
    img.loading = "lazy";
    img.decoding = "async";
    img.addEventListener("load", () => {
      frame.classList.add("media-loaded");
    });
    img.addEventListener("error", () => {
      frame.classList.add("media-error");
      img.remove();
    });
    frame.appendChild(img);
  } else {
    frame.classList.add("media-error");
  }
  return frame;
};

const buildActionButton = ({
  label,
  href,
  primary,
  external,
  disabled,
  onClick,
  ariaLabel,
}) => {
  const element = document.createElement(href ? "a" : "button");
  element.className = `btn ${primary ? "btn-primary" : "btn-outline"} btn-sm`;
  element.textContent = label;
  if (ariaLabel) element.setAttribute("aria-label", ariaLabel);
  if (href) {
    element.href = href;
    if (external) {
      element.target = "_blank";
      element.rel = "noopener";
    }
  } else {
    element.type = "button";
  }
  if (disabled) {
    element.classList.add("btn-disabled");
    element.setAttribute("aria-disabled", "true");
  }
  if (onClick) {
    element.addEventListener("click", onClick);
  }
  return element;
};

const buildRegionLabel = (item) => {
  const parts = [item.region?.sigungu, item.region?.eupmyeondong].filter(Boolean);
  if (parts.length > 0) return parts.join(" · ");
  return formatValue(item.region?.sido);
};

const renderCard = (item) => {
  const placeLink = getPlaceLink(item);
  const card = document.createElement("article");
  card.className = "restaurant-card";

  const mediaFrame = buildMediaFrame({
    src: getImageUrl(item),
    alt: `${item.name} 대표 이미지`,
    aspectRatio: "16 / 9",
    className: "media-card",
  });

  const cardBody = document.createElement("div");
  cardBody.className = "card-body";
  cardBody.innerHTML = `
    <h3 class="card-title">${item.name}</h3>
    <p class="card-meta">${formatValue(item.category)} · ${buildMenuList(
    item.signatureMenus || item.mainDishes
  )}</p>
    <div class="card-info">
      <p>지역: ${buildRegionLabel(item)}</p>
      <p>주소: ${formatValue(buildAddress(item))}</p>
    </div>
  `;

  const actions = document.createElement("div");
  actions.className = "card-actions is-single";
  actions.appendChild(
    placeLink
      ? buildActionButton({
          label: "더 알아보기",
          href: placeLink,
          primary: true,
          external: true,
          ariaLabel: `${item.name} 더 알아보기`,
        })
      : buildActionButton({
          label: "링크 없음",
          primary: true,
          disabled: true,
          ariaLabel: `${item.name} 링크 없음`,
        })
  );

  cardBody.appendChild(actions);
  card.append(mediaFrame, cardBody);
  return card;
};

const updateMetaTags = (item) => {
  const title = `${item.name} | 오직미`;
  const description = `${formatValue(item.category)} · ${formatValue(
    item.region?.sido
  )} ${formatValue(item.region?.sigungu)}의 오직미 인증 매장. 네이버 플레이스에서 상세 정보를 확인하세요.`;
  document.title = title;
  const descTag = document.querySelector('meta[name="description"]');
  if (descTag) descTag.setAttribute("content", description);
  const ogTitle = document.querySelector('meta[property="og:title"]');
  if (ogTitle) ogTitle.setAttribute("content", title);
  const ogDesc = document.querySelector('meta[property="og:description"]');
  if (ogDesc) ogDesc.setAttribute("content", description);
  const ogImage = document.querySelector('meta[property="og:image"]');
  if (ogImage) ogImage.setAttribute("content", getImageUrl(item) || "/og-placeholder.png");
};

const initRestaurantsPage = async () => {
  const searchInput = document.getElementById("search-input");
  const resultCount = document.getElementById("result-count");
  const grid = document.getElementById("restaurant-grid");
  const listState = document.getElementById("list-state");
  const listLoader = document.getElementById("list-loader");
  const listEnd = document.getElementById("list-end");
  const sentinel = document.getElementById("scroll-sentinel");
  const searchForm = document.getElementById("search-form");

  if (!grid || !searchInput || !resultCount || !sentinel || !listLoader) return;

  const setListState = (message) => {
    if (!listState) return;
    listState.textContent = message || "";
    listState.style.display = message ? "block" : "none";
  };

  const setLoading = (isLoading) => {
    listLoader.textContent = isLoading ? "불러오는 중..." : "";
    listLoader.style.display = isLoading ? "block" : "none";
  };

  const setResultStatus = (message) => {
    if (!resultCount) return;
    resultCount.textContent = message;
  };

  const setListEnd = (message) => {
    if (!listEnd) return;
    listEnd.textContent = message || "";
  };

  let activeQuery = "";
  let totalCount = 0;
  let errorMessage = "";
  let filteredStores = [];
  let dataReady = false;

  const renderErrorState = (message) => {
    if (!listState) return;
    listState.innerHTML = "";
    listState.style.display = "block";
    const text = document.createElement("p");
    text.textContent = message;
    const retryButton = buildActionButton({
      label: "다시 시도",
      primary: true,
      onClick: () => {
        errorMessage = "";
        allStores = [];
        dataReady = false;
        resetList(true);
        renderSkeletons(grid, 8);
        setResultStatus("매장을 불러오는 중...");
        loadAndRender();
      },
    });
    listState.appendChild(text);
    listState.appendChild(retryButton);
  };

  const updateResultCount = () => {
    if (!resultCount) return;
    if (activeQuery) {
      resultCount.textContent = `검색 결과 ${totalCount.toLocaleString()}개`;
    } else {
      resultCount.textContent = `전체 ${totalCount.toLocaleString()}개 매장`;
    }
  };

  const resetList = (preserveQuery = false) => {
    grid.innerHTML = "";
    totalCount = 0;
    errorMessage = "";
    cursor = 0;
    isLoading = false;
    filteredStores = [];
    if (!preserveQuery) {
      activeQuery = "";
    }
    setListState("");
    setListEnd("");
  };

  const fetchWithTimeout = async (url) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      return await fetch(url, { signal: controller.signal });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new Error("DATA_ERROR_TIMEOUT");
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  };

  const normalizeStore = (row, index = 0) => {
    try {
      const nameCandidates = ["name", "store_name", "상호", "식당명"];
      const addressCandidates = ["address", "addr", "도로명주소", "주소"];
      const placeCandidates = [
        "naver_place_url",
        "naverPlaceUrl",
        "naverPlace",
        "네이버플레이스",
        "플레이스링크",
      ];
      const imageCandidates = ["image_url", "imageUrl", "image", "thumbnail", "대표이미지", "이미지링크"];

      const pickValue = (obj, keys) => {
        for (const key of keys) {
          if (obj && obj[key]) return obj[key];
        }
        return "";
      };

      const name = pickValue(row, nameCandidates) || "";
      const address = pickValue(row, addressCandidates) || buildAddress(row);
      const naverPlaceUrl = pickValue(row, placeCandidates) || "";
      const imageUrl = pickValue(row, imageCandidates) || "";
      const id = row?.id || row?.store_id || row?.storeId || row?.slug || `store-${index + 1}`;

      return {
        ...row,
        id,
        name,
        address,
        naverPlaceUrl,
        imageUrl,
      };
    } catch (error) {
      return {
        id: `store-${index + 1}`,
        name: "",
        address: "",
        naverPlaceUrl: "",
        imageUrl: "",
      };
    }
  };

  const parseCsvText = (text) => {
    if (!window.Papa) {
      throw new Error("CSV_PARSER_MISSING");
    }
    const result = window.Papa.parse(text, { header: true, skipEmptyLines: true });
    if (result?.errors?.length) {
      throw new Error(`CSV_PARSE_ERROR_${result.errors[0].message || "UNKNOWN"}`);
    }
    return result.data || [];
  };

  const loadAllStores = async () => {
    if (dataReady && allStores.length > 0) return allStores;

    const candidates = ["data/stores.json", "stores.json", "data/stores.csv", "stores.csv"];
    let lastError = "";

    for (const candidate of candidates) {
      const url = new URL(candidate, document.baseURI).toString();
      debugState.lastUrl = url;
      updateDebugPanel();
      try {
        const response = await fetchWithTimeout(url);
        debugState.status = String(response.status);
        updateDebugPanel();
        if (!response.ok) {
          lastError = `DATA_ERROR_${response.status}`;
          continue;
        }

        const contentType = response.headers.get("content-type") || "";
        const isJson = contentType.includes("application/json") || candidate.endsWith(".json");
        let rawData;
        let parseType = "JSON";

        if (isJson) {
          rawData = await response.json();
          parseType = "JSON";
        } else {
          const csvText = await response.text();
          rawData = parseCsvText(csvText);
          parseType = "CSV";
        }

        if (!Array.isArray(rawData)) {
          throw new Error("DATA_ERROR_INVALID");
        }

        allStores = rawData.map((item, index) => {
          const normalized = normalizeStore(item, index);
          return {
            ...normalized,
            searchText: buildSearchText(normalized),
          };
        });

        dataReady = true;
        debugState.type = parseType;
        debugState.count = allStores.length;
        debugState.cursor = cursor;
        setDebugError("");
        setDebugMessage(`DATA_OK(url=${url}, type=${parseType}, count=${allStores.length})`);
        return allStores;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        setDebugError(lastError);
      }
    }

    throw new Error(lastError || "DATA_ERROR_NOT_FOUND");
  };

  const filterStores = () => {
    const tokens = activeQuery
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);
    filteredStores =
      tokens.length === 0
        ? allStores
        : allStores.filter((item) =>
            tokens.every((token) => item.searchText.includes(token))
          );
    totalCount = filteredStores.length;
    updateResultCount();
  };

  const renderNextPage = () => {
    if (isLoading || errorMessage) return;
    if (cursor >= filteredStores.length) {
      if (filteredStores.length > 0) {
        setListEnd("마지막입니다.");
      }
      if (observer && cursor >= allStores.length) {
        observer.disconnect();
      }
      return;
    }
    isLoading = true;
    setLoading(true);
    const next = filteredStores.slice(cursor, cursor + pageSize);
    if (cursor === 0) {
      grid.innerHTML = "";
    }
    if (cursor === 0 && next.length === 0) {
      setListState("조건에 맞는 매장이 없습니다. 검색어를 바꿔보세요.");
    } else {
      setListState("");
    }

    next.forEach((item) => {
      grid.appendChild(renderCard(item));
    });

    cursor += next.length;
    debugState.cursor = cursor;
    updateDebugPanel();
    if (cursor >= filteredStores.length) {
      setListEnd(filteredStores.length > 0 ? "마지막입니다." : "");
    }
    if (observer && cursor >= allStores.length) {
      observer.disconnect();
    }

    isLoading = false;
    setLoading(false);
  };

  const loadAndRender = async () => {
    if (isLoading) return;
    isLoading = true;
    setLoading(true);
    try {
      await loadAllStores();
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : "UNKNOWN_ERROR";
      grid.innerHTML = "";
      setResultStatus("데이터 로드 실패");
      setListEnd("");
      renderErrorState("데이터 로드 실패(재시도)");
      return;
    } finally {
      isLoading = false;
      setLoading(false);
    }
    filterStores();
    renderNextPage();
  };

  const applySearch = () => {
    activeQuery = searchInput.value.trim();
    errorMessage = "";
    cursor = 0;
    setListEnd("");
    renderSkeletons(grid, 8);
    setResultStatus("매장을 불러오는 중...");
    setupInfiniteScroll();
    filterStores();
    renderNextPage();
  };

  const debouncedSearch = debounce(applySearch, 300);
  searchInput.addEventListener("input", debouncedSearch);
  if (searchForm) {
    searchForm.addEventListener("submit", (event) => {
      event.preventDefault();
      applySearch();
    });
  }

  const setupInfiniteScroll = () => {
    if (!observer) {
      observer = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting && !isLoading && !errorMessage) {
              renderNextPage();
            }
          });
        },
        { rootMargin: "200px" }
      );
    }
    observer.observe(sentinel);
  };

  setupInfiniteScroll();

  renderSkeletons(grid, 8);
  setListState("");
  setResultStatus("매장을 불러오는 중...");
  loadAndRender();
};

const initRestaurantDetail = async () => {
  const params = new URLSearchParams(window.location.search);
  const slug = params.get("slug");
  if (!slug) return;

  const detailHero = document.getElementById("detail-hero");
  const detailSummary = document.getElementById("detail-summary");
  const detailInfo = document.getElementById("detail-info");
  const stickyCta = document.getElementById("sticky-cta");
  const certText = document.getElementById("detail-cert-text");

  try {
    const response = await fetch(new URL(DATA_URL, document.baseURI).toString());
    const data = await response.json();
    const item = data.find((restaurant) => slugify(restaurant.name) === slug);

    if (!item) {
      detailHero.innerHTML = `<h1>식당 정보를 찾을 수 없습니다.</h1>`;
      return;
    }

    updateMetaTags(item);

    const placeLink = getPlaceLink(item);

    if (detailHero) {
      detailHero.innerHTML = "";
      const frame = buildMediaFrame({
        src: getImageUrl(item),
        alt: `${item.name} 대표 이미지`,
      });
      const titleWrap = document.createElement("div");
      titleWrap.className = "detail-title";
      titleWrap.innerHTML = `
        <span class="badge">${getBadgeLabel(item)}${
        item.verifiedMonth ? ` · ${item.verifiedMonth}` : ""
      }</span>
        <h1>${item.name}</h1>
        <p class="card-meta">${formatValue(item.region?.sido)} · ${formatValue(
        item.region?.sigungu
      )}</p>
        <p class="card-meta">${formatValue(item.category)} · ${formatValue(
        item.priceRange,
        "가격대 미등록"
      )}</p>
        <p class="card-meta">대표 메뉴: ${buildMenuList(item.signatureMenus)}</p>
      `;

      const actions = document.createElement("div");
      actions.className = "card-actions is-single";
      actions.appendChild(
        placeLink
          ? buildActionButton({
              label: "더 알아보기",
              href: placeLink,
              primary: true,
              external: true,
            })
          : buildActionButton({
              label: "링크 없음",
              primary: true,
              disabled: true,
            })
      );

      titleWrap.appendChild(actions);
      detailHero.append(frame, titleWrap);
    }

    if (detailSummary) {
      detailSummary.innerHTML = `
        <div class="summary-card">
          <span>지역</span>
          <strong>${formatValue(item.region?.sido)} ${formatValue(
        item.region?.sigungu
      )}</strong>
        </div>
        <div class="summary-card">
          <span>카테고리</span>
          <strong>${formatValue(item.category)}</strong>
        </div>
        <div class="summary-card">
          <span>가격대</span>
          <strong>${formatValue(item.priceRange, "미등록")}</strong>
        </div>
        <div class="summary-card">
          <span>대표 메뉴</span>
          <strong>${buildMenuList(item.signatureMenus)}</strong>
        </div>
      `;
    }

    if (detailInfo) {
      detailInfo.innerHTML = `
        <div class="info-card">
          <h3>네이버 플레이스</h3>
          <div class="info-list">
            <span>플레이스 링크: ${
              placeLink
                ? `<a class="link" href="${placeLink}" target="_blank" rel="noopener">네이버 플레이스 열기</a>`
                : "미등록"
            }</span>
          </div>
        </div>
        <div class="info-card">
          <h3>대표 메뉴</h3>
          <div class="info-list">
            ${(item.signatureMenus || ["미등록"]).map((menu) => `<span>${menu}</span>`).join("")}
          </div>
        </div>
      `;

      if (item.images?.length) {
        const galleryCard = document.createElement("div");
        galleryCard.className = "info-card";
        galleryCard.innerHTML = `
          <h3>갤러리</h3>
          <div class="gallery">
            ${item.images
              .slice(0, 6)
              .map(
                (src) =>
                  `<img src="${src}" alt="${item.name} 사진" loading="lazy" />`
              )
              .join("")}
          </div>
        `;
        detailInfo.appendChild(galleryCard);
      }
    }

    if (certText) {
      certText.textContent = item.verifiedMonth
        ? `오직미는 매장별로 정기 확인을 통해 쌀 사용 여부를 확인합니다. 최근 확인 월은 ${item.verifiedMonth}이며, 소비자에게는 필요한 정보만 공개합니다.`
        : "오직미는 매장별로 정기 확인을 통해 쌀 사용 여부를 확인합니다. 소비자에게는 필요한 정보만 공개합니다.";
    }

    if (stickyCta) {
      const placeAction = placeLink
        ? `<a class="btn btn-primary" href="${placeLink}" target="_blank" rel="noopener">더 알아보기</a>`
        : `<span class="btn btn-primary btn-static">링크 없음</span>`;

      stickyCta.innerHTML = `
        <div class="cta-content">
          <div>
            <strong>${item.name}</strong>
            <p class="card-meta">네이버 플레이스</p>
          </div>
          <div class="cta-actions">
            ${placeAction}
          </div>
        </div>
      `;
    }

    updateKakaoShare();
  } catch (error) {
    if (detailHero) {
      detailHero.innerHTML = `<h1>식당 정보를 불러올 수 없습니다.</h1>`;
    }
  }
};

const initShare = () => {
  const copyButton = document.getElementById("copy-link");
  if (!copyButton) return;

  copyButton.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      copyButton.textContent = "링크 복사 완료";
      setTimeout(() => {
        copyButton.textContent = "링크 복사";
      }, 2000);
    } catch (error) {
      copyButton.textContent = "복사 실패";
    }
  });
};

const init = () => {
  if (document.getElementById("restaurant-grid")) {
    initRestaurantsPage();
  }
  if (document.getElementById("detail-page")) {
    initRestaurantDetail();
    initShare();
  }
};

document.addEventListener("DOMContentLoaded", init);
