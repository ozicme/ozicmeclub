const DATA_URL = "public-restaurants.json";

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

const buildSearchText = (item) => {
  const parts = [
    item.name,
    buildAddress(item),
    item.category,
    item.categoryDetail,
    ...(item.searchTags || []),
    ...(item.signatureMenus || []),
    ...(item.mainDishes || []),
  ];
  return parts.filter(Boolean).join(" ").toLowerCase();
};

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
      <div class="skeleton skeleton-media"></div>
      <div class="skeleton" style="width: 70%; height: 18px;"></div>
      <div class="skeleton" style="width: 50%; height: 14px;"></div>
      <div class="skeleton" style="width: 80%; height: 14px;"></div>
    `;
    container.appendChild(card);
  });
};

const buildMediaFrame = ({ src, alt }) => {
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

const renderCard = (item, onReserveMissing, onMapMissing) => {
  const reserveLink = getReservationLink(item);
  const mapLink = getMapLink(item);
  const card = document.createElement("article");
  card.className = "restaurant-card";

  const cardLink = document.createElement("a");
  cardLink.className = "card-media";
  cardLink.href = `restaurant.html?slug=${slugify(item.name)}`;
  cardLink.setAttribute("aria-label", `${item.name} 상세보기`);

  const frame = buildMediaFrame({
    src: getThumbnail(item),
    alt: `${item.name} 썸네일`,
  });

  if (item.verifiedBadge) {
    const badge = document.createElement("span");
    badge.className = "badge badge-verified";
    badge.textContent = "오직미 인증";
    frame.appendChild(badge);
  }

  const label = document.createElement("span");
  label.className = "media-label";
  label.textContent = "OZICME";
  frame.appendChild(label);

  cardLink.appendChild(frame);

  const cardBody = document.createElement("div");
  cardBody.className = "card-body";
  cardBody.innerHTML = `
    <h3 class="card-title">${item.name}</h3>
    <p class="card-meta">${formatValue(item.region?.sido)} · ${formatValue(
    item.region?.sigungu
  )} · ${formatValue(item.category)}</p>
    <div class="card-info">
      <p>대표 메뉴: ${buildMenuList(item.signatureMenus)}</p>
      <p>가격대: ${formatValue(item.priceRange, "가격대 미등록")}</p>
      <p>예약: ${getReservationLabel(item)}</p>
    </div>
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
          ariaLabel: `${item.name} 예약`,
        })
      : buildActionButton({
          label: "예약",
          primary: true,
          disabled: true,
          onClick: onReserveMissing,
          ariaLabel: `${item.name} 예약 링크 없음`,
        })
  );

  actions.appendChild(
    mapLink
      ? buildActionButton({
          label: "길찾기",
          href: mapLink,
          external: true,
          ariaLabel: `${item.name} 길찾기`,
        })
      : buildActionButton({
          label: "길찾기",
          disabled: true,
          onClick: onMapMissing,
          ariaLabel: `${item.name} 길찾기 링크 없음`,
        })
  );

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
  const aiToggle = document.getElementById("ai-toggle");
  const aiChips = document.getElementById("ai-chips");
  const loadMoreButton = document.getElementById("load-more");
  const toast = document.getElementById("toast");

  if (!grid || !searchInput || !resultCount || !loadMoreButton) return;

  const setListState = (message) => {
    if (!listState) return;
    listState.textContent = message || "";
    listState.style.display = message ? "block" : "none";
  };

  const showToast = (message) => {
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add("is-visible");
    setTimeout(() => {
      toast.classList.remove("is-visible");
    }, 2000);
  };

  renderSkeletons(grid, 12);
  setListState("");

  try {
    const response = await fetch(DATA_URL);
    const data = await response.json();
    const searchableData = data.map((item) => ({
      ...item,
      searchText: buildSearchText(item),
    }));

    const PAGE_SIZE = 30;
    let filtered = searchableData;
    let page = 1;
    let renderedCount = 0;

    const renderResults = (reset = false) => {
      if (reset) {
        grid.innerHTML = "";
        renderedCount = 0;
      }
      setListState("");
      if (filtered.length === 0) {
        setListState("조건에 맞는 매장이 없습니다. 검색어를 바꿔보세요.");
        loadMoreButton.style.display = "none";
        return;
      }

      const targetCount = Math.min(filtered.length, page * PAGE_SIZE);
      const slice = filtered.slice(renderedCount, targetCount);
      slice.forEach((item) => {
        grid.appendChild(
          renderCard(
            item,
            () => showToast("예약 링크 없음"),
            () => showToast("길찾기 링크 없음")
          )
        );
      });
      renderedCount = targetCount;
      loadMoreButton.style.display =
        renderedCount < filtered.length ? "inline-flex" : "none";
    };

    const applyFilters = () => {
      const searchValue = searchInput.value.trim().toLowerCase();
      const tokens = searchValue.split(/\s+/).filter(Boolean);
      filtered = searchableData.filter((item) =>
        tokens.every((token) => item.searchText.includes(token))
      );
      resultCount.textContent = `${filtered.length}개 매장`;
      page = 1;
      renderResults(true);
    };

    const debouncedSearch = debounce(applyFilters, 200);
    searchInput.addEventListener("input", debouncedSearch);

    if (aiToggle && aiChips) {
      aiToggle.addEventListener("click", () => {
        const isPressed = aiToggle.getAttribute("aria-pressed") === "true";
        aiToggle.setAttribute("aria-pressed", String(!isPressed));
        aiChips.hidden = isPressed;
      });

      aiChips.addEventListener("click", (event) => {
        const chip = event.target.closest(".chip");
        if (!chip) return;
        const term = chip.dataset.term || chip.textContent;
        searchInput.value = term;
        applyFilters();
      });
    }

    loadMoreButton.addEventListener("click", () => {
      page += 1;
      renderResults();
    });

    applyFilters();
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
