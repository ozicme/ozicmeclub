const DATA_URL = "public-restaurants.json";
const API_URL = "/api/stores";
const FETCH_TIMEOUT_MS = 8000;

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

const getThumbnail = (item) =>
  item.imageUrl || item.thumbnail || item.images?.[0] || "";

const getReservationLink = (item) =>
  item.naverBookingUrl ||
  item.naverReservationUrl ||
  item.naverPlaceUrl ||
  "";

const getReservationLabel = (item) =>
  item.naverBookingUrl || item.naverReservationUrl
    ? "네이버 예약"
    : item.naverPlaceUrl
      ? "네이버 플레이스"
      : "예약 링크 없음";

const buildAddress = (item) =>
  item.address ||
  [item.region?.sido, item.region?.sigungu, item.region?.eupmyeondong]
    .filter(Boolean)
    .join(" ");

const getMapLink = (item) => {
  if (item.naverMapUrl) return item.naverMapUrl;
  if (item.lat && item.lng) {
    return `https://map.naver.com/v5/directions?c=${item.lng},${item.lat},15,0,0,0,dh`;
  }
  const query = [item.name, buildAddress(item)].filter(Boolean).join(" ");
  return query ? `https://map.naver.com/v5/search/${encodeURIComponent(query)}` : "";
};

const getPhoneLink = (item) => (item.phone ? `tel:${item.phone}` : "");

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

const buildMediaFrame = ({ src, alt, aspectRatio }) => {
  const frame = document.createElement("div");
  frame.className = "media-frame";
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
  const placeLink = item.naverPlaceUrl || "";
  const card = document.createElement("article");
  card.className = "restaurant-card";

  const mediaFrame = buildMediaFrame({
    src: getThumbnail(item),
    alt: `${item.name} 대표 이미지`,
    aspectRatio: "16 / 9",
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
  )} ${formatValue(item.region?.sigungu)}의 오직미 인증 매장. 네이버 예약과 길찾기 정보를 확인하세요.`;
  document.title = title;
  const descTag = document.querySelector('meta[name="description"]');
  if (descTag) descTag.setAttribute("content", description);
  const ogTitle = document.querySelector('meta[property="og:title"]');
  if (ogTitle) ogTitle.setAttribute("content", title);
  const ogDesc = document.querySelector('meta[property="og:description"]');
  if (ogDesc) ogDesc.setAttribute("content", description);
  const ogImage = document.querySelector('meta[property="og:image"]');
  if (ogImage) ogImage.setAttribute("content", getThumbnail(item) || "/og-placeholder.png");
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

  const PAGE_SIZE = 20;
  let cursor = 0;
  let hasMore = true;
  let isLoading = false;
  let activeQuery = "";
  let totalCount = 0;
  let requestId = 0;
  let errorMessage = "";
  let lastRequestKey = "";
  let cachedRestaurants = null;
  let observer = null;

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
        requestId += 1;
        isLoading = false;
        hasMore = true;
        errorMessage = "";
        lastRequestKey = "";
        resetList();
        renderSkeletons(grid, 8);
        setResultStatus("매장을 불러오는 중...");
        if (observer) {
          observer.disconnect();
          observer.observe(sentinel);
        }
        fetchStores(requestId);
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

  const resetList = () => {
    grid.innerHTML = "";
    cursor = 0;
    hasMore = true;
    totalCount = 0;
    errorMessage = "";
    lastRequestKey = "";
    setListState("");
    setListEnd("");
  };

  const fetchJson = async (url, errorPrefix) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) {
        throw new Error(`${errorPrefix}_${response.status}`);
      }
      return await response.json();
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new Error(`${errorPrefix}_TIMEOUT`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  };

  const normalizePayload = (payload, sourceLabel) => {
    if (!payload || !Array.isArray(payload.items)) {
      throw new Error(`${sourceLabel}_INVALID_PAYLOAD`);
    }
    return {
      items: payload.items,
      nextCursor: payload.nextCursor ?? null,
      hasMore: Boolean(payload.hasMore),
      totalCount: Number.isFinite(payload.totalCount) ? payload.totalCount : payload.items.length,
      dataReady: payload.dataReady !== false,
      error: payload.error || "",
    };
  };

  const loadLocalRestaurants = async () => {
    if (cachedRestaurants) return cachedRestaurants;
    const data = await fetchJson(DATA_URL, "DATA_ERROR");
    cachedRestaurants = data.map((item) => ({
      ...item,
      searchText: buildSearchText(item),
    }));
    return cachedRestaurants;
  };

  const fetchStoresFromApi = async () => {
    const params = new URLSearchParams();
    if (activeQuery) params.set("query", activeQuery);
    params.set("cursor", String(cursor));
    params.set("limit", String(PAGE_SIZE));
    const response = await fetchJson(`${API_URL}?${params.toString()}`, "API_ERROR");
    return normalizePayload(response, "API_ERROR");
  };

  const fetchStoresFromJson = async () => {
    const restaurants = await loadLocalRestaurants();
    const tokens = activeQuery
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);
    const filtered =
      tokens.length === 0
        ? restaurants
        : restaurants.filter((item) =>
            tokens.every((token) => item.searchText.includes(token))
          );
    const items = filtered.slice(cursor, cursor + PAGE_SIZE);
    const nextCursor = cursor + items.length;
    const hasMoreItems = nextCursor < filtered.length;
    return normalizePayload(
      {
        items,
        nextCursor: hasMoreItems ? nextCursor : null,
        hasMore: hasMoreItems,
        totalCount: filtered.length,
        dataReady: true,
      },
      "DATA_ERROR"
    );
  };

  const fetchStores = async (token = requestId) => {
    if (isLoading || !hasMore || errorMessage) return;
    const requestKey = `${activeQuery}|${cursor}`;
    if (requestKey === lastRequestKey) return;
    lastRequestKey = requestKey;
    isLoading = true;
    setLoading(true);

    try {
      let payload;
      try {
        payload = await fetchStoresFromApi();
        if (payload.dataReady === false) {
          throw new Error(payload.error || "DATA_NOT_READY");
        }
      } catch (error) {
        payload = await fetchStoresFromJson();
      }
      if (token !== requestId) {
        isLoading = false;
        setLoading(false);
        return;
      }

      const items = payload.items || [];
      totalCount = payload.totalCount ?? totalCount;
      if (cursor === 0) {
        grid.innerHTML = "";
      }
      if (cursor === 0 && items.length === 0) {
        setListState("조건에 맞는 매장이 없습니다. 검색어를 바꿔보세요.");
      } else {
        setListState("");
      }

      items.forEach((item) => {
        grid.appendChild(renderCard(item));
      });

      cursor = payload.nextCursor ?? cursor + items.length;
      hasMore = payload.hasMore;
      updateResultCount();
      if (!hasMore && items.length > 0) {
        setListEnd("마지막입니다.");
      }
    } catch (error) {
      if (token === requestId) {
        hasMore = false;
        errorMessage =
          error instanceof Error ? error.message : "UNKNOWN_ERROR";
        if (cursor === 0) {
          grid.innerHTML = "";
        }
        setResultStatus("목록을 불러오지 못했습니다.");
        setListEnd("");
        renderErrorState("목록을 불러오지 못했습니다. 새로고침 또는 다시 시도해주세요.");
        if (observer) {
          observer.disconnect();
        }
      }
    } finally {
      if (token === requestId) {
        isLoading = false;
        setLoading(false);
      }
    }
  };

  const applySearch = () => {
    activeQuery = searchInput.value.trim();
    requestId += 1;
    isLoading = false;
    resetList();
    renderSkeletons(grid, 8);
    setResultStatus("매장을 불러오는 중...");
    fetchStores(requestId);
  };

  const debouncedSearch = debounce(applySearch, 300);
  searchInput.addEventListener("input", debouncedSearch);
  if (searchForm) {
    searchForm.addEventListener("submit", (event) => {
      event.preventDefault();
      applySearch();
    });
  }

  observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting && hasMore && !isLoading && !errorMessage) {
          fetchStores();
        }
      });
    },
    { rootMargin: "200px" }
  );

  observer.observe(sentinel);

  renderSkeletons(grid, 8);
  setListState("");
  setResultStatus("매장을 불러오는 중...");
  fetchStores();
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
    const response = await fetch(DATA_URL);
    const data = await response.json();
    const item = data.find((restaurant) => slugify(restaurant.name) === slug);

    if (!item) {
      detailHero.innerHTML = `<h1>식당 정보를 찾을 수 없습니다.</h1>`;
      return;
    }

    updateMetaTags(item);

    const reserveLink = getReservationLink(item);
    const reserveLabel = getReservationLabel(item);
    const mapLink = getMapLink(item);
    const phoneLink = getPhoneLink(item);

    if (detailHero) {
      detailHero.innerHTML = "";
      const frame = buildMediaFrame({
        src: getThumbnail(item),
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
        <p class="cta-hint">예약: ${reserveLabel}</p>
      `;

      const actions = document.createElement("div");
      actions.className = "card-actions";
      actions.appendChild(
        reserveLink
          ? buildActionButton({
              label: "예약",
              href: reserveLink,
              primary: true,
              external: true,
            })
          : buildActionButton({
              label: "예약",
              primary: true,
              disabled: true,
            })
      );
      if (mapLink) {
        actions.appendChild(
          buildActionButton({
            label: "길찾기",
            href: mapLink,
            external: true,
          })
        );
      }

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
      const reserveLinkLabel = reserveLink ? reserveLabel : "예약 준비중";
      detailInfo.innerHTML = `
        <div class="info-card">
          <h3>예약 & 길찾기</h3>
          <div class="info-list">
            <span>예약 링크: ${
              reserveLink
                ? `<a class="link" href="${reserveLink}" target="_blank" rel="noopener">${reserveLinkLabel}</a>`
                : reserveLinkLabel
            }</span>
            <span>지도 링크: ${
              mapLink
                ? `<a class="link" href="${mapLink}" target="_blank" rel="noopener">지도 열기</a>`
                : "미등록"
            }</span>
            <span>전화: ${
              phoneLink
                ? `<a class="link" href="${phoneLink}">${item.phone}</a>`
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
      const mapAction = mapLink
        ? `<a class="btn btn-ghost" href="${mapLink}" target="_blank" rel="noopener">길찾기</a>`
        : `<span class="btn btn-ghost btn-static">길찾기 준비중</span>`;
      const reserveAction = reserveLink
        ? `<a class="btn btn-primary" href="${reserveLink}" target="_blank" rel="noopener">예약</a>`
        : `<span class="btn btn-primary btn-static">예약 준비중</span>`;

      stickyCta.innerHTML = `
        <div class="cta-content">
          <div>
            <strong>${item.name}</strong>
            <p class="card-meta">예약: ${reserveLabel}</p>
          </div>
          <div class="cta-actions">
            ${mapAction}
            ${reserveAction}
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
