const DATA_URL = "public-restaurants.json";

const PLACEHOLDER_IMAGE =
  "https://images.unsplash.com/photo-1504674900247-0877df9cc836?auto=format&fit=crop&w=900&q=80";

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

const getBestDate = (item) => {
  if (item.verifiedMonth) {
    return new Date(`${item.verifiedMonth}-01`);
  }
  if (item.lastOrder) {
    return new Date(item.lastOrder);
  }
  if (item.firstOrder) {
    return new Date(item.firstOrder);
  }
  return new Date(0);
};

const getThumbnail = (item) =>
  item.thumbnail || item.images?.[0] || PLACEHOLDER_IMAGE;

const getReserveLink = (reserveLinks = {}) =>
  reserveLinks.catchtable ||
  reserveLinks.naverReservation ||
  reserveLinks.kakao ||
  "";

const getMapLink = (mapLinks = {}) =>
  mapLinks.naver || mapLinks.kakao || mapLinks.google || "";

const getHomepageLink = (reserveLinks = {}) => reserveLinks.homepage || "";

const getPhoneLink = (reserveLinks = {}) =>
  reserveLinks.phone ? `tel:${reserveLinks.phone}` : "";

const hasReservation = (item) => Boolean(getReserveLink(item.reserveLinks));

const buildMenuList = (menus) => {
  if (!menus || menus.length === 0) {
    return "대표 메뉴 미등록";
  }
  return menus.slice(0, 2).join(" · ");
};

const getBadgeLabel = (item) =>
  item.verifiedBadge ? "오직미 인증" : "인증 확인중";

const setActiveChip = (container, value) => {
  container.querySelectorAll(".chip").forEach((chip) => {
    chip.classList.toggle("is-active", chip.dataset.category === value);
  });
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

const buildCurationCard = (item) => {
  const card = document.createElement("article");
  card.className = "curation-card";
  card.innerHTML = `
    <a href="restaurant.html?slug=${slugify(item.name)}" aria-label="${item.name} 상세보기">
      <img src="${getThumbnail(item)}" alt="${item.name} 썸네일" loading="lazy" />
    </a>
    <div>
      <span class="badge is-muted">오직미 인증</span>
      <h3 class="card-title">${item.name}</h3>
      <p class="card-meta">${formatValue(item.category)} · ${formatValue(
    item.region?.sido
  )}</p>
      <p class="card-meta">${buildMenuList(item.signatureMenus)}</p>
    </div>
  `;
  return card;
};

const renderCard = (item) => {
  const reserveLink = getReserveLink(item.reserveLinks);
  const mapLink = getMapLink(item.mapLinks);
  const card = document.createElement("article");
  card.className = "restaurant-card";
  card.innerHTML = `
    <a class="card-media" href="restaurant.html?slug=${slugify(
      item.name
    )}" aria-label="${item.name} 상세보기">
      <img src="${getThumbnail(item)}" alt="${item.name} 썸네일" loading="lazy" />
      <div class="media-content">
        <span class="badge">${getBadgeLabel(item)}${item.verifiedMonth ? ` · ${item.verifiedMonth}` : ""}</span>
        <h3 class="card-title">${item.name}</h3>
        <p class="card-meta">${formatValue(item.region?.sido)} · ${formatValue(
    item.region?.sigungu
  )} · ${formatValue(item.category)}</p>
        <p class="card-meta">${formatValue(item.priceRange)}</p>
      </div>
    </a>
    <div class="card-body">
      <div class="menu-list">${buildMenuList(item.signatureMenus)}</div>
      <div class="card-actions">
        <a class="btn btn-primary btn-sm" ${
          reserveLink
            ? `href="${reserveLink}" target="_blank" rel="noreferrer"`
            : "aria-disabled=\"true\""
        }>예약</a>
        <a class="btn btn-ghost btn-sm" ${
          mapLink
            ? `href="${mapLink}" target="_blank" rel="noreferrer"`
            : "aria-disabled=\"true\""
        }>길찾기</a>
      </div>
    </div>
  `;
  return card;
};

const updateMetaTags = (item) => {
  const title = `${item.name} | 오직미`;
  const description = `${formatValue(item.category)} · ${formatValue(
    item.region?.sido
  )} ${formatValue(item.region?.sigungu)}의 오직미 인증 매장. 예약 및 길찾기 정보를 확인하세요.`;
  document.title = title;
  const descTag = document.querySelector('meta[name="description"]');
  if (descTag) descTag.setAttribute("content", description);
  const ogTitle = document.querySelector('meta[property="og:title"]');
  if (ogTitle) ogTitle.setAttribute("content", title);
  const ogDesc = document.querySelector('meta[property="og:description"]');
  if (ogDesc) ogDesc.setAttribute("content", description);
  const ogImage = document.querySelector('meta[property="og:image"]');
  if (ogImage) ogImage.setAttribute("content", getThumbnail(item));
};

const initRestaurantsPage = async () => {
  const regionSelect = document.getElementById("region-select");
  const categoryGroup = document.getElementById("category-group");
  const searchInput = document.getElementById("search-input");
  const reserveToggle = document.getElementById("reserve-toggle");
  const sortSelect = document.getElementById("sort-select");
  const resultCount = document.getElementById("result-count");
  const grid = document.getElementById("restaurant-grid");
  const listState = document.getElementById("list-state");
  const curationGrid = document.getElementById("curation-grid");
  const totalCount = document.getElementById("total-count");
  const reserveCount = document.getElementById("reserve-count");
  const verifiedCount = document.getElementById("verified-count");

  if (!grid || !regionSelect || !categoryGroup) return;

  renderSkeletons(grid, 8);
  listState.textContent = "";

  try {
    const response = await fetch(DATA_URL);
    const data = await response.json();

    if (totalCount) totalCount.textContent = data.length;
    if (reserveCount) reserveCount.textContent = data.filter(hasReservation).length;
    if (verifiedCount) {
      verifiedCount.textContent = data.filter((item) => item.verifiedBadge).length;
    }

    const regions = Array.from(
      new Set(data.map((item) => item.region?.sido).filter(Boolean))
    ).sort();
    regions.forEach((region) => {
      const option = document.createElement("option");
      option.value = region;
      option.textContent = region;
      regionSelect.appendChild(option);
    });

    const categories = Array.from(
      new Set(data.map((item) => item.category).filter(Boolean))
    ).sort();
    categories.forEach((category) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "chip";
      button.dataset.category = category;
      button.textContent = category;
      categoryGroup.appendChild(button);
    });

    const curated = data
      .filter((item) => item.verifiedBadge)
      .sort((a, b) => getBestDate(b) - getBestDate(a))
      .slice(0, 3);
    if (curationGrid) {
      curationGrid.innerHTML = "";
      if (curated.length === 0) {
        curationGrid.innerHTML = "<p class=\"card-meta\">추천 매장이 아직 없습니다.</p>";
      } else {
        curated.forEach((item) => {
          curationGrid.appendChild(buildCurationCard(item));
        });
      }
    }

    let selectedCategory = "";

    const applyFilters = () => {
      const searchValue = searchInput.value.trim().toLowerCase();
      const regionValue = regionSelect.value;
      const mustHaveReserve = reserveToggle.checked;

      let results = data.filter((item) => {
        const matchesName = item.name.toLowerCase().includes(searchValue);
        const matchesRegion = regionValue ? item.region?.sido === regionValue : true;
        const matchesCategory = selectedCategory
          ? item.category === selectedCategory
          : true;
        const matchesReserve = mustHaveReserve ? hasReservation(item) : true;
        return matchesName && matchesRegion && matchesCategory && matchesReserve;
      });

      const sortValue = sortSelect.value;
      if (sortValue === "name") {
        results = results.sort((a, b) => a.name.localeCompare(b.name, "ko"));
      } else if (sortValue === "region") {
        results = results.sort((a, b) => {
          const regionA = `${a.region?.sido || ""} ${a.region?.sigungu || ""}`.trim();
          const regionB = `${b.region?.sido || ""} ${b.region?.sigungu || ""}`.trim();
          return regionA.localeCompare(regionB, "ko");
        });
      } else {
        results = results.sort((a, b) => getBestDate(b) - getBestDate(a));
      }

      resultCount.textContent = `${results.length}개 매장`;
      grid.innerHTML = "";
      listState.textContent = "";

      if (results.length === 0) {
        listState.textContent = "조건에 맞는 매장이 없습니다.";
        return;
      }

      results.forEach((item) => {
        grid.appendChild(renderCard(item));
      });
    };

    categoryGroup.addEventListener("click", (event) => {
      const chip = event.target.closest(".chip");
      if (!chip) return;
      selectedCategory = chip.dataset.category;
      setActiveChip(categoryGroup, selectedCategory);
      applyFilters();
    });

    [searchInput, regionSelect, reserveToggle, sortSelect].forEach((el) => {
      el.addEventListener("input", applyFilters);
      el.addEventListener("change", applyFilters);
    });

    applyFilters();
  } catch (error) {
    grid.innerHTML = "";
    listState.textContent = "데이터를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.";
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

    const reserveLink = getReserveLink(item.reserveLinks);
    const mapLink = getMapLink(item.mapLinks);
    const phoneLink = getPhoneLink(item.reserveLinks);
    const homepageLink = getHomepageLink(item.reserveLinks);

    detailHero.innerHTML = `
      <img src="${getThumbnail(item)}" alt="${item.name} 대표 이미지" />
      <div class="detail-title">
        <span class="badge">${getBadgeLabel(item)}${item.verifiedMonth ? ` · ${item.verifiedMonth}` : ""}</span>
        <h1>${item.name}</h1>
        <p class="card-meta">${formatValue(item.category)} · ${formatValue(
      item.priceRange
    )}</p>
        <p class="card-meta">${formatValue(item.region?.sido)} ${formatValue(
      item.region?.sigungu
    )} · ${formatValue(item.addressPublic)}</p>
        <div class="card-actions">
          <a class="btn btn-primary btn-sm" ${
            reserveLink
              ? `href="${reserveLink}" target="_blank" rel="noreferrer"`
              : "aria-disabled=\"true\""
          }>예약하기</a>
          <a class="btn btn-ghost btn-sm" ${
            mapLink
              ? `href="${mapLink}" target="_blank" rel="noreferrer"`
              : "aria-disabled=\"true\""
          }>길찾기</a>
          <a class="btn btn-ghost btn-sm" ${
            phoneLink ? `href="${phoneLink}"` : "aria-disabled=\"true\""
          }>전화</a>
        </div>
      </div>
    `;

    detailSummary.innerHTML = `
      <div class="summary-card">
        <span>카테고리</span>
        <strong>${formatValue(item.category)}</strong>
      </div>
      <div class="summary-card">
        <span>가격대</span>
        <strong>${formatValue(item.priceRange)}</strong>
      </div>
      <div class="summary-card">
        <span>대표 메뉴</span>
        <strong>${buildMenuList(item.signatureMenus)}</strong>
      </div>
      <div class="summary-card">
        <span>위치</span>
        <strong>${formatValue(item.addressPublic)}</strong>
      </div>
    `;

    detailInfo.innerHTML = `
      <div class="info-card">
        <h3>예약 & 길찾기</h3>
        <div class="info-list">
          <span>예약 링크: ${
            reserveLink
              ? `<a class="link" href="${reserveLink}" target="_blank" rel="noreferrer">예약하기</a>`
              : "미등록"
          }</span>
          <span>지도 링크: ${
            mapLink
              ? `<a class="link" href="${mapLink}" target="_blank" rel="noreferrer">지도 열기</a>`
              : "미등록"
          }</span>
          <span>전화: ${
            phoneLink
              ? `<a class="link" href="${phoneLink}">${item.reserveLinks?.phone}</a>`
              : "미등록"
          }</span>
          <span>홈페이지: ${
            homepageLink
              ? `<a class="link" href="${homepageLink}" target="_blank" rel="noreferrer">바로가기</a>`
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
      <div class="info-card">
        <h3>오직미 쌀 품종</h3>
        <div class="info-list">
          ${(item.riceVarieties || ["미등록"]).map((rice) => `<span>${rice}</span>`).join("")}
        </div>
      </div>
      <div class="info-card">
        <h3>운영 정보</h3>
        <div class="info-list">
          <span>영업시간: ${formatValue(item.openHours)}</span>
          <span>휴무일: ${formatValue(item.closedDays)}</span>
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
              (src) => `<img src="${src}" alt="${item.name} 사진" loading="lazy" />`
            )
            .join("")}
        </div>
      `;
      detailInfo.appendChild(galleryCard);
    }

    if (certText) {
      certText.textContent = item.verifiedMonth
        ? `오직미는 매장별로 정기 확인을 통해 쌀 사용 여부를 확인합니다. 최근 확인 월은 ${item.verifiedMonth}이며, 소비자에게는 최소한의 정보만 공개합니다.`
        : "오직미는 매장별로 정기 확인을 통해 쌀 사용 여부를 확인합니다. 소비자에게는 최소한의 정보만 공개합니다.";
    }

    if (stickyCta) {
      const primaryAction = reserveLink
        ? { label: "예약하기", href: reserveLink, external: true }
        : mapLink
          ? { label: "길찾기", href: mapLink, external: true }
          : phoneLink
            ? { label: "전화하기", href: phoneLink, external: false }
            : homepageLink
              ? { label: "홈페이지", href: homepageLink, external: true }
              : null;

      const secondaryAction = reserveLink
        ? mapLink
          ? { label: "길찾기", href: mapLink, external: true }
          : phoneLink
            ? { label: "전화하기", href: phoneLink, external: false }
            : null
        : null;

      stickyCta.innerHTML = `
        <div class="cta-content">
          <div>
            <strong>${item.name}</strong>
            <p class="card-meta">${reserveLink ? "예약 가능한 링크가 있습니다" : "예약 링크가 없을 경우 길찾기/전화로 연결됩니다"}</p>
          </div>
          <div class="cta-actions">
            ${
              primaryAction
                ? `<a class="btn btn-primary" href="${primaryAction.href}" ${
                    primaryAction.external ? "target=\"_blank\" rel=\"noreferrer\"" : ""
                  }>${primaryAction.label}</a>`
                : `<button class="btn btn-primary" aria-disabled="true">예약 링크 준비중</button>`
            }
            ${
              secondaryAction
                ? `<a class="btn btn-ghost" href="${secondaryAction.href}" ${
                    secondaryAction.external ? "target=\"_blank\" rel=\"noreferrer\"" : ""
                  }>${secondaryAction.label}</a>`
                : ""
            }
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
