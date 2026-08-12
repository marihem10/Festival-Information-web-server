// 🔒 데이터 소스:
// ① hubItems: 한국관광콘텐츠랩 내부 API (실시간, 이미지/설명)
// ② detailIntro2(공식 TourAPI)로 보완된 날짜
// ③ extra: Firestore(또는 실패 시 extraFestivals.js) - 직접 추가하는 축제

// --- 탭 전환 로직 ---
const tabs = document.querySelectorAll('.menu li');
const views = document.querySelectorAll('.view-section');

// popstate(뒤로가기)로 인한 화면 전환일 땐 history.pushState를 다시 하면 안 되므로 구분하는 플래그
let isHandlingPopState = false;

function showView(id, detailKey = null) {
    views.forEach(v => v.style.display = 'none');
    const target = document.getElementById(id);
    target.style.removeProperty('display');
    target.scrollTop = 0;
    window.scrollTo(0, 0);

    if (!isHandlingPopState) {
        const state = { view: id };
        if (id === 'view-detail' && detailKey) state.festKey = detailKey;
        history.pushState(state, '', '#' + id);
    }
}

history.replaceState({ view: 'view-home' }, '', '#view-home');

window.addEventListener('popstate', (e) => {
    isHandlingPopState = true;
    const state = e.state || { view: 'view-home' };

    if (state.view === 'view-detail' && state.festKey) {
        showFestivalDetailByKey(state.festKey);
    } else {
        const view = state.view || 'view-home';
        closeMobileMenu();
        tabs.forEach(t => t.classList.toggle('active', t.getAttribute('data-target') === view));
        showView(view);
        if (view === 'view-home') renderPage();
        if (view === 'view-bookmarks') renderBookmarkPage();
        if (view === 'view-calendar') renderCalendar();
        if (view === 'view-map') renderMapView();
    }

    isHandlingPopState = false;
});

tabs.forEach(tab => {
    tab.addEventListener('click', () => {
        closeMobileMenu();
        tabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        const target = tab.getAttribute('data-target');
        showView(target);
        if (target === 'view-home') renderPage();
        if (target === 'view-bookmarks') renderBookmarkPage();
        if (target === 'view-calendar') renderCalendar();
        if (target === 'view-map') renderMapView();
    });
});

let lastViewBeforeDetail = 'view-home';

document.querySelectorAll('.logo').forEach(el => {
    el.addEventListener('click', () => {
        closeMobileMenu();
        tabs.forEach(t => t.classList.toggle('active', t.getAttribute('data-target') === 'view-home'));
        showView('view-home');
        renderPage();
    });
});
document.getElementById('detail-back-btn').addEventListener('click', () => {
    history.back();
});

document.getElementById('sidebar-toggle').addEventListener('click', () => {
    document.getElementById('sidebar').classList.toggle('collapsed');
});

const mobileMenuToggle = document.getElementById('mobile-menu-toggle');
const sidebarBackdrop = document.getElementById('sidebar-backdrop');
const sidebarEl = document.getElementById('sidebar');

function openMobileMenu() {
    sidebarEl.classList.add('mobile-open');
    sidebarBackdrop.classList.add('show');
}
function closeMobileMenu() {
    sidebarEl.classList.remove('mobile-open');
    sidebarBackdrop.classList.remove('show');
}
mobileMenuToggle?.addEventListener('click', () => {
    sidebarEl.classList.contains('mobile-open') ? closeMobileMenu() : openMobileMenu();
});
sidebarBackdrop?.addEventListener('click', closeMobileMenu);

function ymdToIso(ymd) {
    if (!ymd || ymd.length !== 8) return '';
    return `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`;
}

function parseIso(s) {
    if (!s) return null;
    const m = s.match(/(\d{4})-(\d{2})-(\d{2})/);
    return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
}

function formatDateRange(fest) {
    if (!fest.startDate) return '';
    const start = fest.startDate.replace(/-/g, '.');
    const end = (fest.endDate || fest.startDate).replace(/-/g, '.');
    return start === end ? start : `${start} ~ ${end}`;
}

function extractUrl(text) {
    if (!text) return '';
    const m = text.match(/https?:\/\/[^\s"'<>]+/);
    return m ? m[0] : '';
}

function getMapUrl(fest) {
    const addr = (fest.orig && fest.orig.address) || fest.address;
    if (!addr || addr === '場所未定') return '';
    return `https://map.naver.com/v5/search/${encodeURIComponent(addr)}`;
}

function stripHtml(s) {
    return (s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

// 👉 한국관광콘텐츠랩의 카테고리 체계는 개수가 정해져 있어서(대분류 3개, 세부분류 20개),
// 자동번역 대신 직접 정확한 일본어로 사전을 만들어둠. 이러면:
// ① 번역이 항상 정확하고 자연스러움 (자동번역의 어색한 표현 문제 없음)
// ② 표시 순서가 항상 고정됨 (데이터에 어느 게 먼저 나오는지와 무관)
// 이 목록에 없는 값이 나오면(향후 분류 추가 등) 원문 그대로 보여줌(안 깨지게)
const CATEGORY_ORDER = ['행사', '축제', '공연'];
const CATEGORY_JA = {
    '축제': '祭り',
    '공연': '公演',
    '행사': 'イベント'
};

const SUBCATEGORY_ORDER = [
    // 축제
    '문화관광축제', '문화예술축제', '지역특산물축제', '전통역사축제', '생태자연축제', '기타축제',
    // 공연
    '전통공연', '연극', '뮤지컬', '오페라', '무용', '클래식음악회', '대중콘서트', '영화', '기타공연', '넌버벌',
    // 행사
    '전시회', '박람회', '스포츠경기', '기타행사'
];
const SUBCATEGORY_JA = {
    '문화관광축제': '文化観光祭り',
    '문화예술축제': '文化芸術祭り',
    '지역특산물축제': '地域特産物祭り',
    '전통역사축제': '伝統歴史祭り',
    '생태자연축제': '生態自然祭り',
    '기타축제': 'その他祭り',
    '전통공연': '伝統公演',
    '연극': '演劇',
    '뮤지컬': 'ミュージカル',
    '오페라': 'オペラ',
    '무용': '舞踊',
    '클래식음악회': 'クラシックコンサート',
    '대중콘서트': 'コンサート',
    '영화': '映画',
    '기타공연': 'その他公演',
    '넌버벌': 'ノンバーバル',
    '전시회': '展示会',
    '박람회': '博覧会',
    '스포츠경기': 'スポーツ競技',
    '기타행사': 'その他イベント'
};

// 👉 지역(부산/경남/울산) 판별 - hub 응답 자체엔 이 항목이 명확히 안 들어있어서,
// 원문(한국어) 주소 텍스트에 어떤 지명이 포함되어 있는지로 판단함
// 👉 부산/울산은 그대로 두고, "경남"으로 뭉뚱그려지던 걸 실제 시군 단위로 세분화함.
// 경상남도의 18개 시/군을 다 사전에 넣어두고, 그 중 실제로 축제가 있는 곳만 자동으로
// 필터에 나타남(renderRegionDetailChips가 present인 것만 걸러서 보여줌).
const REGION_ORDER = [
    '부산', '울산',
    '창원', '진주', '통영', '사천', '김해', '밀양', '거제', '양산',
    '의령', '함안', '창녕', '고성', '남해', '하동', '산청', '함양', '거창', '합천',
    '경남'
];
const REGION_JA = {
    '부산': '釜山', '울산': '蔚山',
    '창원': '昌原', '진주': '晋州', '통영': '統営', '사천': '泗川',
    '김해': '金海', '밀양': '密陽', '거제': '巨済', '양산': '梁山',
    '의령': '宜寧', '함안': '咸安', '창녕': '昌寧', '고성': '固城',
    '남해': '南海', '하동': '河東', '산청': '山淸', '함양': '咸陽',
    '거창': '居昌', '합천': '陜川', '경남': 'その他慶尚南道'
};
// 시군 이름을 먼저 다 확인해보고, 매칭 안 되면 "경남"(그 외 경상남도 지역)으로 처리
const GYEONGNAM_CITIES = REGION_ORDER.filter(r => r !== '부산' && r !== '울산');
function deriveRegion(koreanText) {
    if (!koreanText) return '경남';
    if (koreanText.includes('울산')) return '울산';
    if (koreanText.includes('부산')) return '부산';
    for (const city of GYEONGNAM_CITIES) {
        if (koreanText.includes(city)) return city;
    }
    return '경남'; // 시군명이 주소에 명확히 안 보이는 경우의 대비책
}

// 👉 제목/주소 둘 다 지역명이 없을 때 마지막으로 쓰는 안전장치 - 좌표(위경도)가
// 부산/울산의 대략적인 범위 안에 있는지로 판별함. 정확한 시군 경계선까지는 아니고
// 대략적인 사각형 범위라 완벽하진 않지만, 텍스트로 아예 못 찾는 것보단 훨씬 나음.
function deriveRegionByCoord(lat, lng) {
    if (!lat || !lng || isNaN(lat) || isNaN(lng)) return null;
    if (lat >= 34.88 && lat <= 35.40 && lng >= 128.74 && lng <= 129.30) return '부산';
    if (lat >= 35.30 && lat <= 35.68 && lng >= 129.17 && lng <= 129.55) return '울산';
    return '경남'; // hub가 애초에 이 3개 지역만 가져오고 있어서, 둘 다 아니면 경남으로 간주
}

function normalizeHubItem(item) {
    const lat = item.yCoord || '';
    const lng = item.xCoord || '';
    // 제목/주소로 판별 시도 → 실패(그 외 경남으로 떨어짐)하면 좌표로 한 번 더 확인
    let regionKo = deriveRegion(`${item.orig_title || ''} ${item.orig_eventPlace || ''} ${item.orig_addr1 || ''}`);
    if (regionKo === '경남' && lat && lng) {
        const coordRegion = deriveRegionByCoord(parseFloat(lat), parseFloat(lng));
        if (coordRegion) {
            console.log(`[진단-지역] "${item.title}" 제목/주소로 못 찾아서 좌표로 판별함 → ${coordRegion}`);
            regionKo = coordRegion;
        }
    }
    return {
        title: item.title || '',
        summary: item.outl || '',
        address: item.eventPlace || item.addr1 || '',
        region: REGION_JA[regionKo] || REGION_JA['경남'],
        // 👉 대분류(行事/祭り/パフォーマンス)는 category, 세부분류(전통역사축제 등)는
        // subCategory로 따로 보관 - 대분류 먼저 고르고 그 안에서 세부분류를 고르는
        // 2단계 필터로 씀 (한 번에 세부분류 20개를 다 보여주면 너무 많아서)
        category: CATEGORY_JA[item.cat2Nm] || item.cat2Nm || item.cat1Nm || '',
        subCategory: SUBCATEGORY_JA[item.cat3Nm] || item.cat3Nm || '',
        image: item.firstImage || item.firstImage2 || '',
        homepage: extractUrl(item.hmpg),
        startDate: ymdToIso(item.eventStartDate),
        endDate: ymdToIso(item.eventEndDate),
        playTime: stripHtml(item.playTime),
        program: stripHtml(item.program),
        subEvent: stripHtml(item.subEvent),
        sponsor1: stripHtml(item.sponsor1),
        sponsor1Tel: item.sponsor1Tel || '',
        sponsor2: stripHtml(item.sponsor2),
        ageLimit: stripHtml(item.ageLimit),
        bookingPlace: stripHtml(item.bookingPlace),
        discountInfo: stripHtml(item.discountInfo),
        placeInfo: stripHtml(item.placeInfo),
        progressType: stripHtml(item.progressType),
        spendTime: stripHtml(item.spendTime),
        useFee: stripHtml(item.useFee),
        // 위/경도 좌표 - hub 원본 응답 확인 결과 xCoord(경도)/yCoord(위도)로 옴 (진단 로그로 확인함)
        lat,
        lng,
        reading: item.reading || '',
        orig: {
            title: item.orig_title || '',
            summary: item.orig_outl || '',
            address: item.orig_eventPlace || item.orig_addr1 || '',
            category: item.cat2Nm || item.cat1Nm || '',
            subCategory: item.cat3Nm || '',
            playTime: stripHtml(item.orig_playTime),
            program: stripHtml(item.orig_program),
            subEvent: stripHtml(item.orig_subEvent),
            sponsor1: stripHtml(item.orig_sponsor1),
            sponsor2: stripHtml(item.orig_sponsor2),
            ageLimit: stripHtml(item.orig_ageLimit),
            bookingPlace: stripHtml(item.orig_bookingPlace),
            discountInfo: stripHtml(item.orig_discountInfo),
            placeInfo: stripHtml(item.orig_placeInfo),
            progressType: stripHtml(item.orig_progressType),
            useFee: stripHtml(item.orig_useFee)
        }
    };
}

function normalizeSimpleItem(item) {
    return {
        title: item.title || '',
        summary: item.summary || '',
        address: item.place || item.address || '',
        region: REGION_JA[deriveRegion(`${item.orig_title || ''} ${item.orig_place || ''}`)],
        category: item.category || '',
        subCategory: '', // 직접추가 항목은 세부분류 개념이 없음 - 대분류에서만 뜸
        image: item.image || '',
        homepage: extractUrl(item.homepage),
        startDate: item.startDate || '',
        endDate: item.endDate || '',
        playTime: item.playTime || '',
        program: item.program || '',
        subEvent: item.subEvent || '',
        sponsor1: item.sponsor1 || '',
        sponsor1Tel: item.sponsor1Tel || '',
        sponsor2: item.sponsor2 || '',
        ageLimit: item.ageLimit || '',
        bookingPlace: item.bookingPlace || '',
        discountInfo: item.discountInfo || '',
        placeInfo: item.placeInfo || '',
        useFee: item.useFee || '',
        reading: item.reading || '',
        orig: {
            title: item.orig_title || '',
            summary: item.orig_summary || '',
            address: item.orig_place || '',
            category: item.orig_category || '',
            playTime: item.orig_playTime || '',
            program: item.orig_program || '',
            subEvent: item.orig_subEvent || '',
            sponsor1: item.orig_sponsor1 || '',
            sponsor2: item.orig_sponsor2 || '',
            ageLimit: item.orig_ageLimit || '',
            bookingPlace: item.orig_bookingPlace || '',
            discountInfo: item.orig_discountInfo || '',
            placeInfo: item.orig_placeInfo || '',
            useFee: item.orig_useFee || ''
        }
    };
}

const ICON_CALENDAR = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px; margin-right:4px;"><rect x="3" y="5" width="18" height="16" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="8" y1="3" x2="8" y2="7"/><line x1="16" y1="3" x2="16" y2="7"/></svg>';
const ICON_PIN = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px; margin-right:4px;"><path d="M12 21s7-6.5 7-11.5A7 7 0 0 0 5 9.5C5 14.5 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.3"/></svg>';
const ICON_DOT = '<svg viewBox="0 0 8 8" width="8" height="8" fill="currentColor" style="margin-top:6px; flex-shrink:0;"><circle cx="4" cy="4" r="4"/></svg>';
const ICON_BOOKMARK = '<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1z"/></svg>';
const ICON_STAR = '<svg viewBox="0 0 24 24" width="12" height="12" style="vertical-align:-2px; margin-right:3px;"><path d="M12 2.5l2.95 6.28 6.55.83-4.9 4.7 1.3 6.69L12 17.77l-5.9 3.23 1.3-6.69-4.9-4.7 6.55-.83z" fill="#FFB300" stroke="#8a5700" stroke-width="1"/></svg>';

function looseKey(s) {
    return (s || '').replace(/\s|\(|\)|[0-9]/g, '').toLowerCase();
}

function katakanaToHiragana(s) {
    return (s || '').replace(/[\u30A1-\u30F6]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60));
}

function normalizeForSearch(s) {
    return katakanaToHiragana((s || '').toLowerCase());
}

function getStatus(fest) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const start = parseIso(fest.startDate);
    const end = parseIso(fest.endDate) || start;
    if (!start) return { key: 'unknown', label: '' };
    if (start <= today && (!end || end >= today)) return { key: 'ongoing', label: '開催中' };
    if (start > today) {
        const diffDays = Math.round((start - today) / 86400000);
        return { key: 'upcoming', label: diffDays === 0 ? '本日開催' : `あと${diffDays}日` };
    }
    return { key: 'ended', label: '終了' };
}

let bookmarkedKeys = new Set();

async function loadBookmarks() {
    try {
        const list = await window.api.getBookmarks();
        bookmarkedKeys = new Set(list);
    } catch (e) {
        bookmarkedKeys = new Set();
    }
}

async function toggleBookmark(key) {
    try {
        const list = await window.api.toggleBookmark(key);
        bookmarkedKeys = new Set(list);
    } catch (e) {
        if (bookmarkedKeys.has(key)) bookmarkedKeys.delete(key);
        else bookmarkedKeys.add(key);
    }
    refreshAfterBookmarkChange();
}

function refreshAfterBookmarkChange() {
    if (document.getElementById('view-home').style.display !== 'none') renderPage();
    if (document.getElementById('view-bookmarks').style.display !== 'none') renderBookmarkPage();
    const btn = document.getElementById('detail-bookmark-btn');
    if (btn) {
        const key = btn.getAttribute('data-key');
        const isBm = bookmarkedKeys.has(key);
        btn.classList.toggle('active', isBm);
        const label = btn.querySelector('.bm-label');
        if (label) label.textContent = isBm ? 'ブックマーク済み' : 'ブックマークする';
    }
    renderCalendar();
}

function renderTagFilterChips(containerId, sourceList, activeFilter, onSelect) {
    const container = document.getElementById(containerId);
    const present = new Set(sourceList.map(f => f.category).filter(Boolean));
    // 고정 순서(CATEGORY_ORDER)를 일본어로 바꾼 뒤, 실제 데이터에 있는 것만 남김 -
    // 이러면 데이터가 바뀌어도(축제 상태 변화 등) 순서는 항상 똑같이 유지됨
    const orderedJa = CATEGORY_ORDER.map(ko => CATEGORY_JA[ko]);
    const extras = [...present].filter(c => !orderedJa.includes(c)); // 사전에 없는 예상 밖 값은 뒤에
    const categories = [...orderedJa, ...extras].filter(c => present.has(c));
    if (categories.length === 0) {
        container.innerHTML = '';
        return;
    }
    // 開催中/開催予定 버튼과 똑같은 토글 방식 - すべて 칩 없이, 같은 걸 다시 누르면 해제됨
    container.innerHTML = categories.map(c => {
        const active = activeFilter === c;
        return `<span class="tag-chip ${active ? 'active' : ''}" data-cat="${c}">${c}</span>`;
    }).join('');
    container.querySelectorAll('.tag-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            const val = chip.getAttribute('data-cat');
            onSelect(activeFilter === val ? null : val);
        });
    });
}

// 👉 세부분류 칩 - 대분류를 하나 고른 상태일 때만 나타남. 그 대분류 안에 실제로 존재하는
// 세부분류만 추려서 보여줌 (예: "祭り" 골랐으면 그 밑에 전통역사축제/생태자연축제 등만)
function renderSubTagFilterChips(containerId, sourceList, broadFilter, activeSubFilter, onSelect) {
    const container = document.getElementById(containerId);
    if (!broadFilter) {
        container.innerHTML = '';
        return;
    }
    const relevant = sourceList.filter(f => f.category === broadFilter);
    const present = new Set(relevant.map(f => f.subCategory).filter(Boolean));
    const orderedJa = SUBCATEGORY_ORDER.map(ko => SUBCATEGORY_JA[ko]);
    const extras = [...present].filter(c => !orderedJa.includes(c));
    const subCategories = [...orderedJa, ...extras].filter(c => present.has(c));
    if (subCategories.length === 0) {
        container.innerHTML = '';
        return;
    }
    // "└" 화살표를 붙여서 위 대분류의 하위 항목이라는 걸 시각적으로 더 명확하게 함
    container.innerHTML = subCategories.map(c => {
        const active = activeSubFilter === c;
        return `<span class="tag-chip sub-chip ${active ? 'active' : ''}" data-subcat="${c}">└ ${c}</span>`;
    }).join('');
    container.querySelectorAll('.tag-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            const val = chip.getAttribute('data-subcat');
            onSelect(activeSubFilter === val ? null : val);
        });
    });
}

// 👉 지역(釜山/慶尚南道/蔚山) 필터 칩 - 카테고리/상태 필터랑 같은 줄에, 토글 방식으로
// 👉 地域 버튼 하나만 메인 줄에 두고, 누르면 그 밑에 실제 지역 선택지가 펼쳐지는 방식
function renderRegionToggleButton(containerId, activeFilter, isOpen, onToggle) {
    const container = document.getElementById(containerId);
    const label = activeFilter || '地域';
    container.innerHTML = `<span class="tag-chip region-chip ${activeFilter ? 'active' : ''}">${label} ${isOpen ? '▲' : '▼'}</span>`;
    container.querySelector('.tag-chip').addEventListener('click', onToggle);
}

function renderRegionDetailChips(containerId, sourceList, activeFilter, isOpen, onSelect) {
    const container = document.getElementById(containerId);
    if (!isOpen) {
        container.innerHTML = '';
        return;
    }
    const present = new Set(sourceList.map(f => f.region).filter(Boolean));
    const orderedJa = REGION_ORDER.map(ko => REGION_JA[ko]);
    const regions = orderedJa.filter(r => present.has(r));
    if (regions.length === 0) {
        container.innerHTML = '';
        return;
    }
    container.innerHTML = regions.map(r => {
        const active = activeFilter === r;
        return `<span class="tag-chip region-sub-chip ${active ? 'active' : ''}" data-region="${r}">${r}</span>`;
    }).join('');
    container.querySelectorAll('.tag-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            const val = chip.getAttribute('data-region');
            onSelect(activeFilter === val ? null : val);
        });
    });
}

function renderStatusFilterButtons(containerId, activeFilter, onToggle) {
    const container = document.getElementById(containerId);
    const options = [
        { label: '開催中', short: '<svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>', val: 'ongoing', cls: 'status-filter-ongoing' },
        { label: '開催予定', short: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.2 2"/></svg>', val: 'upcoming', cls: 'status-filter-upcoming' }
    ];
    container.innerHTML = options.map(o => {
        const active = activeFilter === o.val;
        return `<span class="tag-chip ${o.cls} ${active ? 'active' : ''}" data-status="${o.val}" title="${o.label}"><span class="status-label-full">${o.label}</span><span class="status-label-short">${o.short}</span></span>`;
    }).join('');
    container.querySelectorAll('.tag-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            const val = chip.getAttribute('data-status');
            onToggle(activeFilter === val ? null : val);
        });
    });
}

let allFestivalsCache = [];
let currentPage = 1;
let searchQuery = '';
let homeTagFilter = null;
let homeSubTagFilter = null;
let homeStatusFilter = null;
let homeRegionFilter = null;
let homeRegionPanelOpen = false;
const PAGE_SIZE = 6;

function getFilteredList() {
    let list = allFestivalsCache;
    if (homeRegionFilter) list = list.filter(f => f.region === homeRegionFilter);
    if (homeStatusFilter) list = list.filter(f => f.status.key === homeStatusFilter);
    if (homeTagFilter) list = list.filter(f => f.category === homeTagFilter);
    if (homeSubTagFilter) list = list.filter(f => f.subCategory === homeSubTagFilter);
    if (searchQuery) {
        const q = normalizeForSearch(searchQuery);
        list = list.filter(f =>
            normalizeForSearch(f.title).includes(q) ||
            normalizeForSearch(f.address).includes(q) ||
            normalizeForSearch(f.reading).includes(q)
        );
    }
    return list;
}

document.getElementById('festival-search-input').addEventListener('input', (e) => {
    searchQuery = e.target.value.trim();
    currentPage = 1;
    renderPage();
});

function renderLoadingUI() {
    const grid = document.getElementById('festival-grid');
    grid.style.display = 'flex';
    grid.style.alignItems = 'center';
    grid.style.justifyContent = 'center';
    grid.innerHTML = `
        <div class="loading-box">
            <div class="spinner"></div>
            <p id="loading-text" class="loading-text">イベント情報を読み込んでいます...</p>
            <div class="loading-progress-track">
                <div id="loading-progress-bar" class="loading-progress-bar" style="width: 0%;"></div>
            </div>
            <p id="loading-subtext" class="loading-subtext"></p>
        </div>
    `;
}

function updateLoadingUI({ stage, current, total }) {
    const text = document.getElementById('loading-text');
    const sub = document.getElementById('loading-subtext');
    const bar = document.getElementById('loading-progress-bar');
    if (!text || !bar) return;
    if (stage === 'list') {
        text.textContent = 'イベント一覧を取得しています...';
        sub.textContent = '';
        bar.style.width = '5%';
    } else if (stage === 'detail') {
        text.textContent = '日程・詳細情報を取得しています...';
        sub.textContent = `${current} / ${total}`;
        bar.style.width = `${5 + (current / total) * 45}%`;
    } else if (stage === 'translate') {
        text.textContent = '日本語に翻訳しています...';
        sub.textContent = `${current} / ${total}`;
        bar.style.width = `${50 + (current / total) * 50}%`;
    }
}

window.api.onFetchProgress(updateLoadingUI);

async function fetchFestivals() {
    renderLoadingUI();
    try {
        const { hubItems, extra, errors, debug } = await window.api.fetchAllFestivals();

        console.log(`[진단] hub=${hubItems.length}건, 직접추가=${extra.length}건`, errors);
        console.log(`[진단-main] ${debug}`);

        const hub = hubItems.map(normalizeHubItem);
        const extraItems = extra.map(normalizeSimpleItem);

        const merged = [...hub, ...extraItems]
            .filter((f, idx, arr) => arr.findIndex(x => looseKey(x.title) === looseKey(f.title)) === idx);
        console.log(`[진단-단계] ①원본 합계(hub+직접추가)=${hub.length + extraItems.length}건 → ②제목중복제거후=${merged.length}건`);

        const rankOf = { ongoing: 0, upcoming: 1, unknown: 2, ended: 3 };
        const withStatusRaw = merged.map(f => ({ ...f, key: looseKey(f.title), status: getStatus(f) }));

        // 👉 종료된 지 너무 오래된 축제는 목록에서 아예 제외 (고객 피드백: "종료된 건 많이 볼 필요 없음")
        // 특정 연도로 딱 자르면 해마다 코드를 손봐야 해서, 대신 "종료 후 N일"이라는 굴러가는
        // 기준을 씀 - 이러면 시간이 지나도 자동으로 오래된 것만 걸러지고 매년 안 고쳐도 됨
        const ENDED_CUTOFF_DAYS = 60;
        const cutoffToday = new Date();
        cutoffToday.setHours(0, 0, 0, 0);
        const withStatus = withStatusRaw.filter(f => {
            if (f.status.key !== 'ended') return true;
            const end = parseIso(f.endDate) || parseIso(f.startDate);
            if (!end) return true;
            const daysSinceEnd = (cutoffToday - end) / 86400000;
            return daysSinceEnd <= ENDED_CUTOFF_DAYS;
        });
        console.log(`[진단-단계] ③상태분류후=${withStatusRaw.length}건 → ④종료60일초과제외후=${withStatus.length}건 (제외된 개수: ${withStatusRaw.length - withStatus.length}건)`);

        const counts = withStatus.reduce((acc, f) => {
            acc[f.status.key] = (acc[f.status.key] || 0) + 1;
            return acc;
        }, {});
        console.log(`[진단] 합쳐서 중복제거=${merged.length}건 → 진행중=${counts.ongoing||0}, 예정=${counts.upcoming||0}, 종료=${counts.ended||0}, 날짜없음=${counts.unknown||0}`);

        withStatus.sort((a, b) => {
            const rankDiff = rankOf[a.status.key] - rankOf[b.status.key];
            if (rankDiff !== 0) return rankDiff;
            const aStart = parseIso(a.startDate);
            const bStart = parseIso(b.startDate);
            if (!aStart && !bStart) return 0;
            if (!aStart) return 1;
            if (!bStart) return -1;
            return a.status.key === 'ended' ? bStart - aStart : aStart - bStart;
        });

        if (withStatus.length > 0) {
            allFestivalsCache = withStatus;
            currentPage = 1;

            // 🔎 진단용: 지역 필터가 이상하게 동작하는 원인을 찾기 위해, 각 축제의
            // 판별용 원문 주소랑 최종적으로 계산된 지역값을 콘솔에 다 찍어봄
            console.log('[진단-지역] 축제별 지역 판별 결과:');
            withStatus.forEach(f => {
                console.log(`  "${f.title}" → region="${f.region}"`);
            });
            const regionTally = {};
            withStatus.forEach(f => { regionTally[f.region] = (regionTally[f.region] || 0) + 1; });
            console.log('[진단-지역] 지역별 집계:', regionTally);

            renderPage();
            renderCalendar();


        } else {
            throw new Error(errors.join('\n') || '조건에 맞는 축제/행사 데이터가 0개입니다.');
        }
    } catch (err) {
        console.error('API 에러 상세:', err);
        document.getElementById('festival-grid').innerHTML = `
            <div style="grid-column: 1 / -1; background: rgba(255, 100, 100, 0.2); backdrop-filter: blur(10px); padding: 20px; border-radius: 12px; margin-bottom: 20px; border: 1px solid rgba(255, 0, 0, 0.3);">
                <h3 style="color: #d32f2f; margin-top: 0;">⚠️ 데이터 로드 실패</h3>
                <pre style="white-space: pre-wrap; font-size: 13px; color: #111;">${err.message}</pre>
            </div>
        `;
    }
}

function renderPage() {
    const filtered = getFilteredList();
    const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    currentPage = Math.min(Math.max(1, currentPage), totalPages);
    const start = (currentPage - 1) * PAGE_SIZE;
    const pageItems = filtered.slice(start, start + PAGE_SIZE);

    // ⚠️ 순서 중요: 필터 칩들(특히 세부분류 줄)을 먼저 그려서 화면 높이가 확정된 다음에
    // renderFestivals를 불러야 함 - renderFestivals 안에서 카드 높이를 계산하는데,
    // 그걸 먼저 하면 세부분류 줄이 나타나기/사라지기 전 높이로 잘못 계산해서 스크롤이 생김
    renderRegionToggleButton('region-filter-wrap', homeRegionFilter, homeRegionPanelOpen, () => {
        homeRegionPanelOpen = !homeRegionPanelOpen;
        renderPage();
    });
    renderRegionDetailChips('region-detail-wrap', allFestivalsCache, homeRegionFilter, homeRegionPanelOpen, (region) => {
        homeRegionFilter = region;
        homeRegionPanelOpen = false; // 고르면 자동으로 접힘
        currentPage = 1;
        renderPage();
    });
    renderStatusFilterButtons('status-filter-wrap', homeStatusFilter, (status) => {
        homeStatusFilter = status;
        currentPage = 1;
        renderPage();
    });
    renderTagFilterChips('tag-filter-wrap', allFestivalsCache, homeTagFilter, (cat) => {
        homeTagFilter = cat;
        homeSubTagFilter = null; // 대분류가 바뀌면 세부분류 선택은 초기화
        currentPage = 1;
        renderPage();
    });
    renderSubTagFilterChips('sub-tag-filter-wrap', allFestivalsCache, homeTagFilter, homeSubTagFilter, (subcat) => {
        homeSubTagFilter = subcat;
        currentPage = 1;
        renderPage();
    });
    renderFestivals(pageItems, true, filtered.length, 'festival-grid', '該当するイベントが見つかりませんでした。');
    renderPaginationControls(totalPages, 'pagination-controls', currentPage, (p) => { currentPage = p; renderPage(); });
}

let bookmarkPage = 1;
let bookmarkTagFilter = null;
let bookmarkStatusFilter = null;
let bookmarkSubTagFilter = null;
let bookmarkRegionFilter = null;
let bookmarkRegionPanelOpen = false;

function getBookmarkedList() {
    return allFestivalsCache.filter(f => bookmarkedKeys.has(f.key));
}

function getFilteredBookmarkList() {
    let list = getBookmarkedList();
    if (bookmarkRegionFilter) list = list.filter(f => f.region === bookmarkRegionFilter);
    if (bookmarkStatusFilter) list = list.filter(f => f.status.key === bookmarkStatusFilter);
    if (bookmarkTagFilter) list = list.filter(f => f.category === bookmarkTagFilter);
    if (bookmarkSubTagFilter) list = list.filter(f => f.subCategory === bookmarkSubTagFilter);
    return list;
}

function renderBookmarkPage() {
    const filtered = getFilteredBookmarkList();
    const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    bookmarkPage = Math.min(Math.max(1, bookmarkPage), totalPages);
    const start = (bookmarkPage - 1) * PAGE_SIZE;
    const pageItems = filtered.slice(start, start + PAGE_SIZE);

    renderRegionToggleButton('bookmark-region-filter-wrap', bookmarkRegionFilter, bookmarkRegionPanelOpen, () => {
        bookmarkRegionPanelOpen = !bookmarkRegionPanelOpen;
        renderBookmarkPage();
    });
    renderRegionDetailChips('bookmark-region-detail-wrap', getBookmarkedList(), bookmarkRegionFilter, bookmarkRegionPanelOpen, (region) => {
        bookmarkRegionFilter = region;
        bookmarkRegionPanelOpen = false;
        bookmarkPage = 1;
        renderBookmarkPage();
    });
    renderStatusFilterButtons('bookmark-status-filter-wrap', bookmarkStatusFilter, (status) => {
        bookmarkStatusFilter = status;
        bookmarkPage = 1;
        renderBookmarkPage();
    });
    renderTagFilterChips('bookmark-tag-filter-wrap', getBookmarkedList(), bookmarkTagFilter, (cat) => {
        bookmarkTagFilter = cat;
        bookmarkSubTagFilter = null;
        bookmarkPage = 1;
        renderBookmarkPage();
    });
    renderSubTagFilterChips('bookmark-sub-tag-filter-wrap', getBookmarkedList(), bookmarkTagFilter, bookmarkSubTagFilter, (subcat) => {
        bookmarkSubTagFilter = subcat;
        bookmarkPage = 1;
        renderBookmarkPage();
    });
    renderFestivals(pageItems, true, filtered.length, 'bookmark-grid', 'まだブックマークしたイベントがありません。');
    renderPaginationControls(totalPages, 'bookmark-pagination-controls', bookmarkPage, (p) => { bookmarkPage = p; renderBookmarkPage(); });
}

function renderPaginationControls(totalPages, containerId, page, onChange) {
    const container = document.getElementById(containerId);
    container.innerHTML = `
        <div style="display:flex; justify-content:center; align-items:center; gap:15px; margin-top: 12px;">
            <button class="page-prev" ${page <= 1 ? 'disabled' : ''} style="padding:6px 14px; border-radius:10px; border:none; background:rgba(255,255,255,0.6); cursor:${page <= 1 ? 'default' : 'pointer'}; opacity:${page <= 1 ? '0.4' : '1'}; font-size:13px;">&lt; 前へ</button>
            <span style="font-size:13px; color:#515154;">${page} / ${totalPages}</span>
            <button class="page-next" ${page >= totalPages ? 'disabled' : ''} style="padding:6px 14px; border-radius:10px; border:none; background:rgba(255,255,255,0.6); cursor:${page >= totalPages ? 'default' : 'pointer'}; opacity:${page >= totalPages ? '0.4' : '1'}; font-size:13px;">次へ &gt;</button>
        </div>
    `;
    container.querySelector('.page-prev')?.addEventListener('click', () => onChange(page - 1));
    container.querySelector('.page-next')?.addEventListener('click', () => onChange(page + 1));
}

let currentPageItems = [];

function renderFestivals(festivals, clearGrid = true, totalCount = 0, gridId = 'festival-grid', emptyMessage = '該当するイベントが見つかりませんでした。') {
    const grid = document.getElementById(gridId);
    grid.style.display = 'grid';
    grid.style.alignItems = '';
    grid.style.justifyContent = '';
    if (clearGrid) grid.innerHTML = '';

    currentPageItems = festivals;

    if (totalCount === 0) {
        grid.insertAdjacentHTML('beforeend',
            `<p style="grid-column: 1 / -1; padding: 30px; text-align:center; color:#8a8a8e;">${emptyMessage}</p>`
        );
        return;
    }

    festivals.forEach((fest, idx) => {
        const title = fest.title || 'タイトルなし';
        const location = fest.address || '場所未定';
        const dateStr = formatDateRange(fest);

        const imageTag = fest.image
            ? `<img src="${fest.image}" onerror="this.replaceWith(Object.assign(document.createElement('div'), {className:'card-thumb card-thumb-placeholder', innerText:'No Image'}))" class="card-thumb">`
            : `<div class="card-thumb card-thumb-placeholder">No Image</div>`;

        const badgeClass = fest.status?.key === 'ongoing' ? 'ongoing' : fest.status?.key === 'ended' ? 'ended' : 'upcoming';
        const badgeHtml = fest.status?.label
            ? `<span class="status-badge ${badgeClass}">${fest.status.label}</span>`
            : '';

        const isBookmarked = bookmarkedKeys.has(fest.key);
        const bookmarkBtnHtml = `<button class="bookmark-btn ${isBookmarked ? 'active' : ''}" onclick="event.stopPropagation(); toggleBookmark('${fest.key}')">${ICON_BOOKMARK}</button>`;

        const cardHTML = `
            <div class="card ${fest.status?.key === 'ended' ? 'ended-card' : ''}" onclick="showFestivalDetail(${idx})">
                ${badgeHtml}
                ${bookmarkBtnHtml}
                ${imageTag}
                <h3>${title}</h3>
                <p style="font-size: 12px; color: #515154; margin:4px 0; display:flex; align-items:center; min-width:0;">${ICON_CALENDAR}<span style="flex:1 1 auto; width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; min-width:0;">${dateStr || '日程未定'}</span></p>
                <p style="font-size: 12px; color: #515154; margin: 4px 0 10px 0; display:flex; align-items:center; min-width:0;" title="${location}">${ICON_PIN}<span style="flex:1 1 auto; width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; min-width:0;">${location}</span></p>
                <span class="tag">${fest.category || 'フェスティバル・イベント'}</span>
            </div>
        `;
        grid.insertAdjacentHTML('beforeend', cardHTML);
    });

    adjustCardImageHeights(gridId);
}

function adjustCardImageHeights(gridId) {
    if (window.innerWidth <= 768) return;

    const wrapId = gridId === 'bookmark-grid' ? 'bookmark-grid-wrap' : 'festival-grid-wrap';
    const wrap = document.getElementById(wrapId);
    const grid = document.getElementById(gridId);
    if (!wrap || !grid) return;

    const cards = grid.querySelectorAll('.card');
    if (cards.length === 0) return;

    const cols = 3;
    const rows = Math.ceil(cards.length / cols);
    const gap = 20;
    const wrapHeight = wrap.clientHeight;
    if (wrapHeight <= 0) return;

    const effectiveRows = Math.max(rows, 2);

    const firstCard = cards[0];
    const firstThumb = firstCard.querySelector('.card-thumb');
    if (!firstThumb) return;
    const chromeHeight = firstCard.offsetHeight - firstThumb.offsetHeight;

    const perRowHeight = (wrapHeight - gap * (effectiveRows - 1)) / effectiveRows;
    let idealThumbHeight = perRowHeight - chromeHeight;

    // 예전엔 최소 100px을 억지로 유지했는데, 필터 줄이 여러 개 겹쳐서 뜨면 실제 남는 공간이
    // 그보다 작아져서 스크롤이 생기는 원인이 됐음 - 최소값을 낮춰서 여유를 더 줌
    idealThumbHeight = Math.max(60, Math.min(280, idealThumbHeight));

    document.documentElement.style.setProperty('--card-thumb-height', `${Math.floor(idealThumbHeight)}px`);
}

// 👉 카드 그리드 영역(festival-grid-wrap/bookmark-grid-wrap)의 "실제 크기가 바뀔 때마다"
// 자동으로 카드 높이를 재계산함. 예전엔 "필터 바뀜 → 다시 그리기" 타이밍을 일일이 맞춰야
// 했는데, 이 방식은 원인이 뭐든(필터 줄 높이 변화, 창 크기 변화, 폰트 로딩 등) 상관없이
// 그 영역의 크기가 실제로 바뀌는 순간 브라우저가 알아서 알려줘서 훨씬 확실함.
const cardHeightObserver = new ResizeObserver(() => {
    if (document.getElementById('view-home').style.display !== 'none') adjustCardImageHeights('festival-grid');
    if (document.getElementById('view-bookmarks').style.display !== 'none') adjustCardImageHeights('bookmark-grid');
});
const homeGridWrapEl = document.getElementById('festival-grid-wrap');
const bookmarkGridWrapEl = document.getElementById('bookmark-grid-wrap');
if (homeGridWrapEl) cardHeightObserver.observe(homeGridWrapEl);
if (bookmarkGridWrapEl) cardHeightObserver.observe(bookmarkGridWrapEl);

let currentDetailFest = null;
let showingOriginalLang = false;

function openDetailForFest(fest) {
    if (!fest) return;

    const current = [...views].find(v => v.style.display !== 'none' && v.id !== 'view-detail');
    if (current) lastViewBeforeDetail = current.id;

    currentDetailFest = fest;
    showingOriginalLang = false;
    renderDetailContent();
    tabs.forEach(t => t.classList.remove('active'));
    showView('view-detail', fest.key);
}

function showFestivalDetail(idx) {
    openDetailForFest(currentPageItems[idx]);
}

function toggleOriginalLanguage() {
    showingOriginalLang = !showingOriginalLang;
    renderDetailContent();
}

function copyLinkToClipboard(url, btnEl) {
    navigator.clipboard.writeText(url).then(() => {
        const original = btnEl.innerHTML;
        btnEl.innerHTML = '✓';
        btnEl.classList.add('copied');
        setTimeout(() => {
            btnEl.innerHTML = original;
            btnEl.classList.remove('copied');
        }, 1200);
    }).catch(() => {
    });
}

function renderDetailContent() {
    const fest = currentDetailFest;
    if (!fest) return;

    const d = (showingOriginalLang && fest.orig) ? { ...fest, ...fest.orig } : fest;

    const L = showingOriginalLang
        ? { playTime: '시간', sponsor1: '주최', sponsor2: '주관', ageLimit: '관람가능연령', bookingPlace: '예약', useFee: '요금', discountInfo: '할인정보', spendTime: '관람소요시간', placeInfo: '위치안내', program: '프로그램', subEvent: '부대행사', noPlace: '장소미정', noDate: '일정미정', officialSite: '공식사이트를 보기 →' }
        : { playTime: '時間', sponsor1: '主催', sponsor2: '主管', ageLimit: '観覧可能年齢', bookingPlace: '予約', useFee: '料金', discountInfo: '割引情報', spendTime: '観覧所要時間', placeInfo: '位置案内', program: 'プログラム', subEvent: '付帯行事', noPlace: '場所未定', noDate: '日程未定', officialSite: '公式サイトを見る →' };

    const dateStr = formatDateRange(fest) || L.noDate;
    const summary = d.summary ? d.summary.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : '';

    const imageHtml = fest.image
        ? `<img src="${fest.image}" class="detail-image" onerror="this.replaceWith(Object.assign(document.createElement('div'), {className:'detail-image-placeholder', innerText:'No Image'}))">`
        : `<div class="detail-image-placeholder">No Image</div>`;

    const badgeHtml = fest.status?.label
        ? `<span class="status-badge ${fest.status.key === 'ongoing' ? 'ongoing' : fest.status.key === 'ended' ? 'ended' : 'upcoming'}" style="position:static; display:inline-block; margin-bottom:10px;">${fest.status.label}</span>`
        : '';

    const isBookmarked = fest.key ? bookmarkedKeys.has(fest.key) : false;
    const bookmarkBtnHtml = fest.key
        ? `<button id="detail-bookmark-btn" class="detail-bookmark-btn ${isBookmarked ? 'active' : ''}" data-key="${fest.key}" onclick="toggleBookmark('${fest.key}')">${ICON_BOOKMARK}<span class="bm-label">${isBookmarked ? 'ブックマーク済み' : 'ブックマークする'}</span></button>`
        : '';

    const hasRealOrig = Boolean(fest.orig && fest.orig.title && fest.orig.title.trim() && fest.orig.title !== fest.title);
    const origToggleHtml = hasRealOrig
        ? `<button class="detail-orig-toggle-btn" onclick="toggleOriginalLanguage()">${showingOriginalLang ? '🇯🇵 日本語で見る' : '🇰🇷 原文（韓国語）を見る'}</button>`
        : '';

    const mapUrl = '';
    const addressText = d.address || L.noPlace;
    const addressRowHtml = mapUrl
        ? `<div class="detail-row"><span class="label">${ICON_PIN}</span><span>${addressText}</span><a href="${mapUrl}" target="_blank" rel="noopener" class="detail-map-btn">地図で見る</a></div>`
        : `<div class="detail-row"><span class="label">${ICON_PIN}</span><span>${addressText}</span></div>`;

    const infoRows = [
        [ICON_CALENDAR, dateStr],
        [ICON_DOT, d.category],
        [ICON_DOT, d.playTime && `${L.playTime}: ${d.playTime}`],
        [ICON_DOT, d.sponsor1 && `${L.sponsor1}: ${d.sponsor1}${fest.sponsor1Tel ? ' (' + fest.sponsor1Tel + ')' : ''}`],
        [ICON_DOT, d.sponsor2 && `${L.sponsor2}: ${d.sponsor2}`],
        [ICON_DOT, d.ageLimit && `${L.ageLimit}: ${d.ageLimit}`],
        [ICON_DOT, d.bookingPlace && `${L.bookingPlace}: ${d.bookingPlace}`],
        [ICON_DOT, d.useFee && `${L.useFee}: ${d.useFee}`],
        [ICON_DOT, d.discountInfo && `${L.discountInfo}: ${d.discountInfo}`],
        [ICON_DOT, fest.spendTime && `${L.spendTime}: ${fest.spendTime}`],
        [ICON_DOT, d.placeInfo && `${L.placeInfo}: ${d.placeInfo}`]
    ].filter(([, text]) => Boolean(text));

    const rowsHtml = addressRowHtml + infoRows.map(([icon, text]) =>
        `<div class="detail-row"><span class="label">${icon}</span><span>${text}</span></div>`
    ).join('');

    document.getElementById('detail-content').innerHTML = `
        <div class="detail-layout">
            <div class="detail-layout-image">${imageHtml}</div>
            <div class="detail-card">
                ${badgeHtml}
                <h2>${d.title || ''}</h2>
                <div style="display:flex; flex-wrap:wrap; gap:8px; margin-bottom:14px;">
                    ${bookmarkBtnHtml}
                    ${origToggleHtml}
                </div>
                ${rowsHtml}
                ${summary ? `<p class="detail-summary">${summary}</p>` : ''}
                ${d.program ? `<p class="detail-summary"><strong>${L.program}</strong><br>${d.program}</p>` : ''}
                ${d.subEvent ? `<p class="detail-summary"><strong>${L.subEvent}</strong><br>${d.subEvent}</p>` : ''}
                ${fest.homepage ? `
                <div style="display:flex; align-items:center; gap:8px; margin-top:4px;">
                    <a class="detail-link" href="${fest.homepage}" target="_blank" rel="noopener">${L.officialSite}</a>
                    <button class="copy-link-btn" onclick="copyLinkToClipboard('${fest.homepage}', this)" title="${showingOriginalLang ? 'URL 복사' : 'URLをコピー'}">
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                    </button>
                </div>` : ''}
            </div>
        </div>
    `;
}

function showFestivalDetailByKey(key) {
    const fest = allFestivalsCache.find(f => f.key === key);
    openDetailForFest(fest);
}

let currentDate = new Date();

const CALENDAR_MAX_DURATION_DAYS = 30;

function getEventsForDate(dateObj) {
    return allFestivalsCache.filter(f => {
        const start = parseIso(f.startDate);
        if (!start) return false;
        const end = parseIso(f.endDate) || start;
        const durationDays = (end - start) / 86400000;
        if (durationDays > CALENDAR_MAX_DURATION_DAYS) return false;
        return dateObj >= start && dateObj <= end;
    });
}

function dateKeyOf(year, month, day) {
    return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

const calInfoIcon = document.querySelector('.calendar-info-icon');
calInfoIcon?.addEventListener('click', (e) => {
    e.stopPropagation();
    document.querySelector('.calendar-info-tooltip')?.classList.toggle('show');
});
document.addEventListener('click', () => {
    document.querySelector('.calendar-info-tooltip')?.classList.remove('show');
});

function getCalMetrics() {
    const isMobile = window.innerWidth <= 768;
    return isMobile
        ? { maxLanes: 2, barHeight: 13, barGap: 2, topOffset: 36 }
        : { maxLanes: 3, barHeight: 18, barGap: 3, topOffset: 38 };
}

let calendarBookmarkOnly = false;

document.getElementById('cal-filter-all').addEventListener('click', () => {
    calendarBookmarkOnly = false;
    document.getElementById('cal-filter-all').classList.add('active');
    document.getElementById('cal-filter-bookmark').classList.remove('active');
    renderCalendar();
});
document.getElementById('cal-filter-bookmark').addEventListener('click', () => {
    calendarBookmarkOnly = true;
    document.getElementById('cal-filter-bookmark').classList.add('active');
    document.getElementById('cal-filter-all').classList.remove('active');
    renderCalendar();
});

function renderCalendar() {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();

    document.getElementById('calendar-month-year').textContent = `${year}年 ${month + 1}月`;

    const firstDayIndex = new Date(year, month, 1).getDay();
    const lastDay = new Date(year, month + 1, 0).getDate();

    const calendarBody = document.getElementById('calendar-body');
    calendarBody.innerHTML = '';
    document.getElementById('calendar-day-detail').innerHTML = '';

    for (let i = 0; i < firstDayIndex; i++) {
        calendarBody.innerHTML += `<div class="calendar-cell empty"></div>`;
    }

    const today = new Date();
    for (let i = 1; i <= lastDay; i++) {
        const isToday = (i === today.getDate() && month === today.getMonth() && year === today.getFullYear()) ? 'today' : '';
        const dateKey = dateKeyOf(year, month, i);
        calendarBody.innerHTML += `
            <div class="calendar-cell ${isToday}" data-day="${i}" onclick="showDayDetail('${dateKey}')">
                <span class="calendar-date">${i}</span>
            </div>
        `;
    }

    renderEventOverlayBars(year, month, lastDay);
}

function renderEventOverlayBars(year, month, lastDay) {
    const { maxLanes: CAL_MAX_LANES, barHeight: CAL_BAR_HEIGHT, barGap: CAL_BAR_GAP, topOffset: CAL_TOP_OFFSET } = getCalMetrics();
    const calendarBody = document.getElementById('calendar-body');
    calendarBody.style.position = 'relative';

    const monthStart = new Date(year, month, 1);
    const monthEnd = new Date(year, month, lastDay);

    const sourceList = calendarBookmarkOnly
        ? allFestivalsCache.filter(f => bookmarkedKeys.has(f.key))
        : allFestivalsCache;

    const items = sourceList.map(f => {
        const start = parseIso(f.startDate);
        if (!start) return null;
        const end = parseIso(f.endDate) || start;
        const durationDays = (end - start) / 86400000;
        if (durationDays > CALENDAR_MAX_DURATION_DAYS) return null;
        if (end < monthStart || start > monthEnd) return null;
        return {
            fest: f,
            clipStart: start < monthStart ? monthStart : start,
            clipEnd: end > monthEnd ? monthEnd : end
        };
    }).filter(Boolean);

    items.sort((a, b) => a.clipStart - b.clipStart || (b.clipEnd - b.clipStart) - (a.clipEnd - a.clipStart));
    const laneEndDates = [];
    items.forEach(it => {
        let lane = 0;
        while (laneEndDates[lane] !== undefined && laneEndDates[lane] >= it.clipStart) lane++;
        it.lane = lane;
        laneEndDates[lane] = it.clipEnd;
    });

    const overflowBookmarkCountByDay = {};
    const overflowOtherCountByDay = {};
    const segments = [];

    items.forEach(it => {
        if (it.lane >= CAL_MAX_LANES) {
            const isBookmarked = bookmarkedKeys.has(it.fest.key);
            const d = new Date(it.clipStart);
            while (d <= it.clipEnd) {
                if (isBookmarked) {
                    overflowBookmarkCountByDay[d.getDate()] = (overflowBookmarkCountByDay[d.getDate()] || 0) + 1;
                } else {
                    overflowOtherCountByDay[d.getDate()] = (overflowOtherCountByDay[d.getDate()] || 0) + 1;
                }
                d.setDate(d.getDate() + 1);
            }
            return;
        }

        let segStart = new Date(it.clipStart);
        while (segStart <= it.clipEnd) {
            const daysLeftInRow = 6 - segStart.getDay();
            let segEnd = new Date(segStart);
            segEnd.setDate(segEnd.getDate() + daysLeftInRow);
            if (segEnd > it.clipEnd) segEnd = new Date(it.clipEnd);

            segments.push({
                fest: it.fest,
                lane: it.lane,
                startDay: segStart.getDate(),
                endDay: segEnd.getDate(),
                isTrueStart: segStart.getTime() === it.clipStart.getTime(),
                isTrueEnd: segEnd.getTime() === it.clipEnd.getTime()
            });

            segStart = new Date(segEnd);
            segStart.setDate(segStart.getDate() + 1);
        }
    });

    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:absolute; top:0; left:0; right:0; bottom:0; pointer-events:none;';
    calendarBody.appendChild(overlay);

    const bodyRect = calendarBody.getBoundingClientRect();

    segments.forEach(seg => {
        const startCell = calendarBody.querySelector(`.calendar-cell[data-day="${seg.startDay}"]`);
        const endCell = calendarBody.querySelector(`.calendar-cell[data-day="${seg.endDay}"]`);
        if (!startCell || !endCell) return;

        const startRect = startCell.getBoundingClientRect();
        const endRect = endCell.getBoundingClientRect();
        const isBookmarked = bookmarkedKeys.has(seg.fest.key);

        const bar = document.createElement('div');
        bar.className = `calendar-event-bar lane-${seg.lane % 3} ${seg.isTrueStart ? 'bar-start' : ''} ${seg.isTrueEnd ? 'bar-end' : ''} ${isBookmarked ? 'bookmarked' : ''}`;
        bar.style.position = 'absolute';
        bar.style.left = `${startRect.left - bodyRect.left}px`;
        bar.style.width = `${endRect.right - startRect.left}px`;
        bar.style.top = `${startRect.top - bodyRect.top + CAL_TOP_OFFSET + seg.lane * (CAL_BAR_HEIGHT + CAL_BAR_GAP)}px`;
        bar.style.height = `${CAL_BAR_HEIGHT}px`;
        bar.style.pointerEvents = 'auto';
        bar.style.cursor = 'pointer';
        bar.textContent = seg.isTrueStart ? (isBookmarked ? `★ ${seg.fest.title}` : seg.fest.title) : '';
        bar.title = `${isBookmarked ? '★ ' : ''}${seg.fest.title}${seg.fest.startDate ? ` (${seg.fest.startDate.replace(/-/g, '.')}${seg.fest.endDate && seg.fest.endDate !== seg.fest.startDate ? ' ~ ' + seg.fest.endDate.replace(/-/g, '.') : ''})` : ''}`;
        bar.onclick = (e) => {
            e.stopPropagation();
            showFestivalDetailByKey(seg.fest.key);
        };

        overlay.appendChild(bar);
    });

    const overflowDays = new Set([...Object.keys(overflowBookmarkCountByDay), ...Object.keys(overflowOtherCountByDay)]);
    overflowDays.forEach(dayStr => {
        const day = parseInt(dayStr, 10);
        const cell = calendarBody.querySelector(`.calendar-cell[data-day="${day}"]`);
        if (!cell) return;
        const rect = cell.getBoundingClientRect();

        const bmCount = overflowBookmarkCountByDay[day] || 0;
        const otherCount = overflowOtherCountByDay[day] || 0;

        let label = '';
        if (bmCount > 0 && otherCount > 0) label = `★${bmCount} +${otherCount}`;
        else if (bmCount > 0) label = `★${bmCount}件`;
        else label = `+${otherCount}件`;

        const moreEl = document.createElement('div');
        moreEl.className = `calendar-event-more ${bmCount > 0 ? 'has-bookmark' : ''}`;
        moreEl.style.position = 'absolute';
        moreEl.style.left = `${rect.left - bodyRect.left + 4}px`;
        moreEl.style.top = `${rect.top - bodyRect.top + CAL_TOP_OFFSET + CAL_MAX_LANES * (CAL_BAR_HEIGHT + CAL_BAR_GAP)}px`;
        moreEl.textContent = label;
        moreEl.style.cursor = 'pointer';
        moreEl.style.pointerEvents = 'auto';
        if (bmCount > 0 && otherCount > 0) {
            moreEl.title = `表示しきれていないイベント: ブックマーク${bmCount}件、その他${otherCount}件（クリックで全件表示）`;
        } else if (bmCount > 0) {
            moreEl.title = `表示しきれていないブックマーク${bmCount}件があります（クリックで全件表示）`;
        } else {
            moreEl.title = `他に${otherCount}件のイベントがあります（クリックで全件表示）`;
        }
        moreEl.onclick = (e) => {
            e.stopPropagation();
            showDayDetail(dateKeyOf(year, month, day));
        };
        overlay.appendChild(moreEl);
    });
}

function showDayDetail(dateKey) {
    const m = dateKey.match(/(\d{4})-(\d{2})-(\d{2})/);
    const day = +m[3];

    document.querySelectorAll('.calendar-cell.selected').forEach(c => c.classList.remove('selected'));
    const cell = document.querySelector(`.calendar-cell[data-day="${day}"]`);
    if (cell) cell.classList.add('selected');

    const events = getEventsForDate(new Date(+m[1], +m[2] - 1, +m[3]));
    const container = document.getElementById('calendar-day-detail');
    if (events.length === 0) {
        container.innerHTML = '';
        return;
    }
    container.innerHTML = `
        <div style="font-weight:700; margin-bottom:8px;">${dateKey} のイベント</div>
        ${events.map(f => `<div class="day-detail-item" onclick="showFestivalDetailByKey('${f.key}')">${bookmarkedKeys.has(f.key) ? ICON_STAR : ''}${f.title}</div>`).join('')}
    `;
    container.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

document.getElementById('btn-prev-month').addEventListener('click', () => {
    currentDate.setMonth(currentDate.getMonth() - 1);
    renderCalendar();
});
document.getElementById('btn-next-month').addEventListener('click', () => {
    currentDate.setMonth(currentDate.getMonth() + 1);
    renderCalendar();
});

window.addEventListener('resize', () => {
    if (document.getElementById('view-calendar').style.display !== 'none') {
        renderCalendar();
    }
});

// --- 🗺️ 지도 화면 ---
// 홈 화면에 지금 적용된 필터(지역/카테고리/상태/검색어)를 그대로 재사용함 -
// 지도만의 별도 필터 UI는 안 만들고, "지금 홈에서 보고 있는 걸 지도로도 보기" 개념
let leafletMap = null;
let mapMarkers = [];

// 👉 MapTiler 무료 API 키를 여기 넣어주세요 (https://cloud.maptiler.com/account/keys/ 에서 발급)
const MAPTILER_API_KEY = 'pLCMDRRAKjsl0vNzevy6';

function initMapIfNeeded() {
    if (leafletMap) return;
    // 부산+경남+울산이 대충 다 보이는 위치/줌으로 시작
    leafletMap = L.map('map-container').setView([35.15, 128.55], 9);
    L.maptiler.maptilerLayer({
        apiKey: MAPTILER_API_KEY,
        language: L.MaptilerLanguage.JAPANESE // 지도 자체(도로명/지명)도 일본어로 표시
    }).addTo(leafletMap);
}

function renderMapView() {
    initMapIfNeeded();
    // 탭이 숨겨져 있다가 다시 보일 때 지도 크기 계산이 깨지는 경우가 있어서,
    // 화면에 다시 보인 직후 한 번 더 크기를 재계산해줌
    setTimeout(() => leafletMap.invalidateSize(), 50);

    // 홈 화면 필터랑 별개로 독립적으로 동작 - 지도는 항상 "지금 갈 만한 곳 전체"를 보여줌
    // (홈에서 뭘 필터링해놨든 지도엔 영향 안 줌). 종료된 축제만 항상 제외함.
    const list = allFestivalsCache.filter(f => f.status.key !== 'ended');

    mapMarkers.forEach(m => leafletMap.removeLayer(m));
    mapMarkers = [];

    let shownCount = 0;
    let noCoordCount = 0;

    list.forEach(fest => {
        const lat = parseFloat(fest.lat);
        const lng = parseFloat(fest.lng);
        if (!lat || !lng || isNaN(lat) || isNaN(lng)) {
            noCoordCount += 1;
            return;
        }
        shownCount += 1;

        const isBookmarked = bookmarkedKeys.has(fest.key);
        const dateStr = formatDateRange(fest) || '日程未定';
        const badgeColor = fest.status?.key === 'ongoing' ? '#ff9500' : fest.status?.key === 'ended' ? 'rgba(60,60,67,0.7)' : '#34c759';
        const popupHtml = `
            <div style="min-width:180px;">
                ${fest.status?.label ? `<span style="display:inline-block; background:${badgeColor}; color:white; font-size:10px; font-weight:700; padding:2px 8px; border-radius:10px; margin-bottom:6px;">${fest.status.label}</span>` : ''}
                <div style="font-weight:700; font-size:13px; margin:4px 0;">${isBookmarked ? '★ ' : ''}${fest.title}</div>
                <div style="font-size:12px; color:#515154; margin-bottom:8px;">${dateStr}</div>
                <button onclick="showFestivalDetailByKey('${fest.key}')" style="font-size:12px; padding:5px 12px; border-radius:8px; border:none; background:#007AFF; color:white; cursor:pointer; font-family:'Noto Sans JP', sans-serif;">詳細を見る</button>
            </div>
        `;
        const marker = L.marker([lat, lng]).addTo(leafletMap);
        marker.bindPopup(popupHtml);
        mapMarkers.push(marker);
    });

    const countText = document.getElementById('map-count-text');
    if (countText) {
        countText.textContent = noCoordCount > 0
            ? `${shownCount}件を表示中（位置情報がない${noCoordCount}件は表示されません）`
            : `${shownCount}件を表示中`;
    }
}

window.onload = async () => {
    setTimeout(() => {
        const splash = document.getElementById('splash-overlay');
        splash.classList.add('hide');
        setTimeout(() => splash.remove(), 500);
    }, 2200);

    await loadBookmarks();
    await fetchFestivals();
    renderCalendar();
};