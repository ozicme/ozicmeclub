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

const getBestDate = (item) => {
  if (item.verifiedAt) {
    return new Date(`${item.verifiedAt}-01`);
  }
  if (item.lastOrder) {
    return new Date(item.lastOrder);
  }
  if (item.firstOrder) {
    return new Date(item.firstOrder);
  }
  return new Date(0);
};

const hasReservation = (item) =>
  item.reserveLinks &&
  Object.values(item.reserveLinks).some((link) => Boolean(link));

const renderButtons = (item) => {
  const reserveLink = item.reserveLinks?.naverReservation || item.reserveLinks?.catchtable || item.reserveLinks?.kakao;
  const phoneLink = item.reserveLinks?.phone ? `tel:${item.reserveLinks.phone}` : null;
  const mapLink = item.mapLinks?.naver || item.mapLinks?.kakao || item.mapLinks?.google;

  return {
    reserveLink,
    phoneLink,
    mapLink,
  };
};

const buildMenuList = (menus) => {
  if (!menus || menus.length === 0) {
    return "대표 메뉴 미등록";
  }
  return menus.slice(0, 3).join(" · ");
};

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

const initRestaurantsPage = async () => {
  const response = await fetch(DATA_URL);
  const data = await response.json();

  const regionSelect = document.getElementById("region-select");
  const categoryGroup = document.querySelector(".category-group");
  const searchInput = document.getElementById("search-input");
  const reserveToggle = document.getElementById("reserve-toggle");
  const sortSelect = document.getElementById("sort-select");
  const resultCount = document.getElementById("result-count");
  const grid = document.getElementById("restaurant-grid");
  const quickRegionButtons = document.querySelectorAll(".quick-region .chip");

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

  let selectedCategory = "";

  const applyFilters = () => {
    const searchValue = searchInput.value.trim().toLowerCase();
    const regionValue = regionSelect.value;
    const mustHaveReserve = reserveToggle.checked;

    let results = data.filter((item) => {
      const matchesName = item.name.toLowerCase().includes(searchValue);
      const matchesRegion = regionValue ? item.region?.sido === regionValue : true;
      const matchesCategory = selectedCategory ? item.category === selectedCategory : true;
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

    if (results.length === 0) {
      const empty = document.createElement("p");
      empty.textContent = "조건에 맞는 매장이 없습니다.";
      empty.className = "card-meta";
      grid.appendChild(empty);
      return;
    }

    results.forEach((item) => {
      const slug = slugify(item.name);
      const { reserveLink, phoneLink, mapLink } = renderButtons(item);
      const card = document.createElement("article");
      card.className = "card";
      card.innerHTML = `
        <a href="restaurant.html?slug=${slug}" aria-label="${item.name} 상세보기">
          <img src="${item.images?.thumbnail || "https://images.unsplash.com/photo-1504674900247-0877df9cc836?auto=format&fit=crop&w=800&q=80"}" alt="${item.name} 썸네일" loading="lazy" />
        </a>
        <div>
          <span class="badge">오직미 쌀 사용</span>
          <h3 class="card-title">${item.name}</h3>
          <p class="card-meta">${formatValue(item.region?.sido)} · ${formatValue(item.region?.sigungu)}</p>
          <p class="card-meta">${buildMenuList(item.signatureMenus)}</p>
        </div>
        <div class="card-actions">
          <a class="btn btn-primary" ${reserveLink ? `href="${reserveLink}" target="_blank" rel="noreferrer"` : "aria-disabled=\"true\""}>예약하기</a>
          <div class="detail-actions">
            <a class="btn btn-ghost" ${mapLink ? `href="${mapLink}" target="_blank" rel="noreferrer"` : "aria-disabled=\"true\""}>길찾기</a>
            <a class="btn btn-ghost" ${phoneLink ? `href="${phoneLink}"` : "aria-disabled=\"true\""}>전화</a>
          </div>
        </div>
      `;
      grid.appendChild(card);
    });
  };

  categoryGroup.addEventListener("click", (event) => {
    const chip = event.target.closest(".chip");
    if (!chip) return;
    selectedCategory = chip.dataset.category;
    setActiveChip(categoryGroup, selectedCategory);
    applyFilters();
  });

  quickRegionButtons.forEach((button) => {
    button.addEventListener("click", () => {
      regionSelect.value = button.dataset.region;
      applyFilters();
    });
  });

  [searchInput, regionSelect, reserveToggle, sortSelect].forEach((el) => {
    el.addEventListener("input", applyFilters);
    el.addEventListener("change", applyFilters);
  });

  applyFilters();
};

const initRestaurantDetail = async () => {
  const params = new URLSearchParams(window.location.search);
  const slug = params.get("slug");
  if (!slug) return;

  const response = await fetch(DATA_URL);
  const data = await response.json();
  const item = data.find((restaurant) => slugify(restaurant.name) === slug);

  const detailHero = document.getElementById("detail-hero");
  const detailBody = document.getElementById("detail-body");

  if (!item) {
    detailHero.innerHTML = `<h1>식당 정보를 찾을 수 없습니다.</h1>`;
    return;
  }

  const { reserveLink, phoneLink, mapLink } = renderButtons(item);

  detailHero.innerHTML = `
    <img src="${item.images?.thumbnail || "https://images.unsplash.com/photo-1504674900247-0877df9cc836?auto=format&fit=crop&w=900&q=80"}" alt="${item.name} 썸네일" />
    <div class="detail-title">
      <span class="badge">오직미 쌀 사용 ${item.verifiedAt ? `· ${item.verifiedAt} 확인` : ""}</span>
      <h1>${item.name}</h1>
      <p class="card-meta">${formatValue(item.category)} · ${formatValue(item.priceRange)}</p>
      <p class="card-meta">${formatValue(item.region?.sido)} ${formatValue(item.region?.sigungu)} · ${formatValue(item.addressPublic)}</p>
      <div class="detail-actions">
        <a class="btn btn-primary" ${reserveLink ? `href="${reserveLink}" target="_blank" rel="noreferrer"` : "aria-disabled=\"true\""}>예약하기</a>
        <a class="btn btn-ghost" ${mapLink ? `href="${mapLink}" target="_blank" rel="noreferrer"` : "aria-disabled=\"true\""}>길찾기</a>
        <a class="btn btn-ghost" ${phoneLink ? `href="${phoneLink}"` : "aria-disabled=\"true\""}>전화</a>
      </div>
    </div>
  `;

  detailBody.innerHTML = `
    <div class="info-card">
      <h3>대표 메뉴</h3>
      <div class="info-list">
        ${(item.signatureMenus || ["미등록"]).map((menu) => `<span>${menu}</span>`).join("")}
      </div>
    </div>
    <div class="info-card">
      <h3>영업 정보</h3>
      <div class="info-list">
        <span>영업시간: ${formatValue(item.openHours)}</span>
        <span>휴무일: ${formatValue(item.closedDays)}</span>
        <span>최근 확인: ${formatValue(item.verifiedAt || "미등록")}</span>
      </div>
    </div>
    <div class="info-card">
      <h3>쌀 품종</h3>
      <div class="info-list">
        ${(item.riceVarieties || ["미등록"]).map((rice) => `<span>${rice}</span>`).join("")}
      </div>
    </div>
    <div class="info-card">
      <h3>지도 및 예약 링크</h3>
      <div class="info-list">
        <span>지도: ${mapLink ? `<a class=\"link\" href=\"${mapLink}\" target=\"_blank\" rel=\"noreferrer\">링크 열기</a>` : "미등록"}</span>
        <span>예약: ${reserveLink ? `<a class=\"link\" href=\"${reserveLink}\" target=\"_blank\" rel=\"noreferrer\">예약 링크</a>` : "미등록"}</span>
        <span>전화: ${phoneLink ? `<a class=\"link\" href=\"${phoneLink}\">${item.reserveLinks?.phone}</a>` : "미등록"}</span>
      </div>
    </div>
  `;

  if (item.images?.gallery?.length) {
    const galleryCard = document.createElement("div");
    galleryCard.className = "info-card";
    galleryCard.innerHTML = `
      <h3>갤러리</h3>
      <div class="gallery">
        ${item.images.gallery
          .map(
            (src) =>
              `<img src="${src}" alt="${item.name} 사진" loading="lazy" />`
          )
          .join("")}
      </div>
    `;
    detailBody.appendChild(galleryCard);
  }

  updateKakaoShare();
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
