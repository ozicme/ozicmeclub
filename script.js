const DATA_URL = "public-restaurants.json";
const MAX_RESULTS = 490;
const PAGE_SIZE = 24;
const SEARCH_DEBOUNCE_MS = 300;

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

const getThumbnail = (item) => item.thumbnail || item.images?.[0] || "";

const getReservationLink = (item) =>
  item.naverReservationUrl || item.naverPlaceUrl || "";

const getReservationLabel = (item) =>
  item.naverReservationUrl
    ? "네이버 예약"
    : item.naverPlaceUrl
      ? "네이버 플레이스"
      : "예약 준비중";

const getMapLink = (item) =>
  item.naverMapUrl ||
  item.mapLinks?.naver ||
  item.mapLinks?.kakao ||
  item.mapLinks?.google ||
  "";

const getPhoneLink = (item) => (item.phone ? `tel:${item.phone}` : "");

const buildMenuList = (menus) => {
  if (!menus || menus.length === 0) {
    return "대표 메뉴 미등록";
  }
  return menus.slice(0, 3).join(" · ");
};

const getBadgeLabel = (item) =>
  item.verifiedBadge ? "오직미 인증" : "인증 확인중";

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
      <div class="skeleton skeleton-media"></div>
      <div class="skeleton" style="width: 70%; height: 18px;"></div>
      <div class="skeleton" style="width: 50%; height: 14px;"></div>
      <div class="skeleton" style="width: 80%; height: 14px;"></div>
    `;
    container.appendChild(card);
  });
};

const buildMediaFrame = ({ src, alt, withOverlay }) => {
  const frame = document.createElement("div");
  frame.className = "media-frame";
  if (src) {
    const img = document.createElement("img");
    img.src = src;
    img.alt = alt;
    img.loading = "lazy";
    img.decoding = "async";
    frame.appendChild(img);
  } else {
    const placeholder = document.createElement("div");
    placeholder.className = "media-placeholder";
    placeholder.textContent = "OZICME";
    frame.appendChild(placeholder);
  }
  if (withOverlay) {
    const overlay = document.createElement("div");
    overlay.className = "media-overlay";
    frame.appendChild(overlay);
  }
  return frame;
};

const debounce = (callback, delay = SEARCH_DEBOUNCE_MS) => {
  let timer;
  return (...args) => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => callback(...args), delay);
  };
};

const buildActionButton = ({ label, href, primary, external, staticText }) => {
  const element = document.createElement(href ? "a" : "span");
  element.className = `btn ${primary ? "btn-primary" : "btn-ghost"} btn-sm`;
  if (staticText) {
    element.classList.add("btn-static");
  }
  element.textContent = label;
  if (href) {
    element.href = href;
    if (external) {
      element.target = "_blank";
      element.rel = "noopener";
    }
  }
  return element;
};

const renderCard = (item) => {
  const reserveLink = getReservationLink(item);
  const mapLink = getMapLink(item);
  const phoneLink = getPhoneLink(item);
  const card = document.createElement("article");
  card.className = "restaurant-card";

  const cardLink = document.createElement("a");
  cardLink.className = "card-media";
  cardLink.href = `restaurant.html?slug=${slugify(item.name)}`;
  cardLink.setAttribute("aria-label", `${item.name} 상세보기`);

  const frame = buildMediaFrame({
    src: getThumbnail(item),
    alt: `${item.name} 썸네일`,
    withOverlay: true,
  });

  const mediaContent = document.createElement("div");
  mediaContent.className = "media-content";
  mediaContent.innerHTML = `
    <span class="badge">${getBadgeLabel(item)}${
    item.verifiedMonth ? ` · ${item.verifiedMonth}` : ""
  }</span>
    <h3 class="card-title">${item.name}</h3>
    <p class="card-meta">${formatValue(item.region?.sido)} · ${formatValue(
    item.region?.sigungu
  )} · ${formatValue(item.category)}</p>
  `;

  frame.appendChild(mediaContent);
  cardLink.appendChild(frame);

  const cardBody = document.createElement("div");
  cardBody.className = "card-body";
  cardBody.innerHTML = `
    <div class="menu-list">${buildMenuList(item.signatureMenus)}</div>
    <p class="card-meta">${formatValue(item.priceRange, "가격대 미등록")}</p>
    <p class="cta-hint">예약: ${getReservationLabel(item)}</p>
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
      : buildActionButton({ label: "예약 준비중", primary: true, staticText: true })
  );

  if (mapLink) {
    actions.appendChild(
      buildActionButton({ label: "길찾기", href: mapLink, external: true })
    );
  }

  if (!reserveLink && phoneLink) {
    actions.appendChild(buildActionButton({ label: "전화 문의", href: phoneLink }));
  }

  cardBody.appendChild(actions);
  card.append(cardLink, cardBody);
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
  const loadingGrid = document.getElementById("loading-grid");
  const scrollSentinel = document.getElementById("scroll-sentinel");

  if (!grid || !searchInput || !scrollSentinel) return;

  const setListState = (message) => {
    if (!listState) return;
    listState.textContent = message || "";
    listState.style.display = message ? "block" : "none";
  };

  const showLoading = (count = 6) => {
    if (!loadingGrid) return;
    renderSkeletons(loadingGrid, count);
    loadingGrid.style.display = "grid";
  };

  const hideLoading = () => {
    if (!loadingGrid) return;
    loadingGrid.innerHTML = "";
    loadingGrid.style.display = "none";
  };

  renderSkeletons(grid, 8);
  setListState("");

  try {
    const response = await fetch(DATA_URL);
    const data = await response.json();
    const allData = data.slice(0, MAX_RESULTS);
    let filteredData = [];
    let renderedCount = 0;
    let isLoading = false;
    let observer;

    const updateResultCount = () => {
      if (!resultCount) return;
      resultCount.textContent = `총 ${filteredData.length}개 매장`;
    };

    const resetList = () => {
      grid.innerHTML = "";
      renderedCount = 0;
      setListState("");
      hideLoading();
    };

    const loadNextPage = () => {
      if (isLoading) return;
      if (renderedCount >= filteredData.length) return;
      isLoading = true;
      showLoading();

      const start = renderedCount;
      const end = Math.min(start + PAGE_SIZE, filteredData.length);
      const nextItems = filteredData.slice(start, end);

      nextItems.forEach((item) => {
        grid.appendChild(renderCard(item));
      });

      renderedCount = end;
      hideLoading();
      isLoading = false;
    };

    const applySearch = (value) => {
      const searchValue = value.trim().toLowerCase();
      filteredData = allData.filter((item) =>
        item.name.toLowerCase().includes(searchValue)
      );

      updateResultCount();
      resetList();

      if (filteredData.length === 0) {
        setListState("검색 결과가 없습니다. 다른 키워드를 입력해 보세요.");
        return;
      }

      loadNextPage();
    };

    const updateQueryString = (value) => {
      const params = new URLSearchParams(window.location.search);
      if (value) {
        params.set("q", value);
      } else {
        params.delete("q");
      }
      const query = params.toString();
      const nextUrl = query ? `${window.location.pathname}?${query}` : window.location.pathname;
      window.history.replaceState(null, "", nextUrl);
    };

    const debouncedSearch = debounce((value) => {
      updateQueryString(value);
      applySearch(value);
    });

    observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          loadNextPage();
        }
      },
      { rootMargin: "200px" }
    );

    observer.observe(scrollSentinel);

    const params = new URLSearchParams(window.location.search);
    const initialQuery = params.get("q") || "";
    searchInput.value = initialQuery;
    searchInput.addEventListener("input", (event) => {
      debouncedSearch(event.target.value);
    });

    filteredData = allData;
    updateResultCount();
    resetList();
    applySearch(initialQuery);
  } catch (error) {
    grid.innerHTML = "";
    setListState("데이터를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.");
  }
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
              label: "예약 준비중",
              primary: true,
              staticText: true,
            })
      );
      if (mapLink) {
        actions.appendChild(
          buildActionButton({ label: "길찾기", href: mapLink, external: true })
        );
      }
      if (!reserveLink && phoneLink) {
        actions.appendChild(buildActionButton({ label: "전화 문의", href: phoneLink }));
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
