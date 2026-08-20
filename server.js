// 🖥️ フェスナビ - 백엔드 서버
// main.js(Electron)가 하던 "hub 호출 + 번역 + 캐시 + Firestore" 로직을 그대로 가져와서
// 웹 서버(Express)로 감싼 버전. 폰(PWA)이든 데스크톱 웹이든, 여기 하나에만 물어보면 됨.
//
// 실행: npm install 후 node server.js (기본 포트 3000, PORT 환경변수로 변경 가능)

const express = require('express');
const path = require('path');
const fs = require('fs');
const https = require('https');

// 🔐 비밀값은 환경변수(.env)에서 읽음 - 서버는 exe와 달리 코드/키가 사용자 기기에 안 나가므로
// 이게 표준적이고 더 안전한 방식임. 로컬 개발 편의를 위해 .env 파일도 지원함(dotenv).
require('dotenv').config();
const config = {
  DATA_GO_KR_API_KEY: process.env.DATA_GO_KR_API_KEY || '',
  DEEPL_API_KEY: process.env.DEEPL_API_KEY || ''
};

const extraFestivalsPath = path.join(__dirname, 'extraFestivals.js');
const extraFestivals = fs.existsSync(extraFestivalsPath) ? require('./extraFestivals') : [];

// --- 🔥 Firestore (관리자 권한) ---
// ⚠️ 데스크톱 앱(main.js)과 달리, 서버는 사용자에게 배포되지 않는 "신뢰된 환경"이라
// 관리자 SDK(firebase-admin)를 써도 안전함 - 이 키는 서버에만 있고 사용자 기기로 절대 안 나감.
// 관리자 권한이 필요한 이유: hub 캐시를 Firestore에도 저장해서, 서버가 재시작돼도
// (예: Render 무료 요금제처럼 로컬 파일이 날아가는 환경) 캐시가 유지되게 하기 위함.
let firestoreDb = null;
try {
  const admin = require('firebase-admin');
  const svcJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (svcJson) {
    const serviceAccount = JSON.parse(svcJson);
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    firestoreDb = admin.firestore();
    console.log('[server] Firestore(관리자) 연결 성공');
  } else {
    console.log('[server] FIREBASE_SERVICE_ACCOUNT_JSON 환경변수 없음 - Firestore 없이 진행');
  }
} catch (e) {
  console.log('[server] Firestore 연결 실패:', e.message);
}

async function fetchFirestoreFestivals() {
  if (!firestoreDb) return null;
  const snapshot = await firestoreDb.collection('festivals').get();
  return snapshot.docs.map((doc) => doc.data());
}

async function fetchFirestoreHubSnapshot() {
  if (!firestoreDb) return null;
  const snapshot = await firestoreDb.collection('hub_snapshot').get();
  return snapshot.docs.map((doc) => doc.data());
}

// 서버용 캐시(hub/extra 공용) - 로컬 파일이 날아가도 여기 남아있어서 재시작에 강함
async function readFirestoreCache(docId, ttlMs, ignoreTTL = false) {
  if (!firestoreDb) return null;
  try {
    const doc = await firestoreDb.collection('server_cache').doc(docId).get();
    if (!doc.exists) return null;
    const data = doc.data();
    if (data.schemaVersion !== CACHE_SCHEMA_VERSION) return null;
    if (ignoreTTL || Date.now() - data.savedAt < ttlMs) return data.items;
  } catch (e) {
    console.log(`[server] Firestore 캐시(${docId}) 읽기 실패:`, e.message);
  }
  return null;
}
// 🧪 로컬에서 테스트용 코드 변경(예: 지역 확장 실험)을 돌릴 때, 그 결과가 실수로
// Firestore 캐시에 저장돼서 Render(실제 서비스)에 새어나가는 걸 원천 차단하는 안전장치.
// .env에 SKIP_FIRESTORE_CACHE_WRITE=true 를 넣으면 로컬 파일엔 그대로 저장되지만
// Firestore에는 안 써짐 - 테스트 끝나고 지우는 걸 깜빡해도 안전함.
// Render 배포본의 .env(Environment 탭)에는 이 값을 절대 넣지 않아야 정상 캐시 저장됨.
const SKIP_FIRESTORE_CACHE_WRITE = process.env.SKIP_FIRESTORE_CACHE_WRITE === 'true';

async function writeFirestoreCache(docId, items) {
  if (!firestoreDb) return;
  if (SKIP_FIRESTORE_CACHE_WRITE) {
    console.log(`[server] SKIP_FIRESTORE_CACHE_WRITE=true - Firestore 캐시(${docId}) 저장 건너뜀(로컬 테스트 모드)`);
    return;
  }
  try {
    await firestoreDb.collection('server_cache').doc(docId).set({
      schemaVersion: CACHE_SCHEMA_VERSION,
      savedAt: Date.now(),
      items
    });
  } catch (e) {
    console.log(`[server] Firestore 캐시(${docId}) 쓰기 실패:`, e.message);
  }
}

// --- 📖 kuromoji (main.js와 동일) ---
let kuromojiTokenizer = null;
let kuromojiInitPromise = null;
function initKuromoji() {
  if (kuromojiInitPromise) return kuromojiInitPromise;
  kuromojiInitPromise = new Promise((resolve) => {
    try {
      const kuromoji = require('kuromoji');
      const dicPath = path.join(__dirname, 'node_modules', 'kuromoji', 'dict');
      kuromoji.builder({ dicPath }).build((err, tokenizer) => {
        if (err) {
          console.log('[server] kuromoji 사전 로드 실패:', err.message);
          resolve(null);
          return;
        }
        kuromojiTokenizer = tokenizer;
        console.log('[server] kuromoji 사전 로드 성공');
        resolve(tokenizer);
      });
    } catch (e) {
      console.log('[server] kuromoji 모듈 로드 실패:', e.message);
      resolve(null);
    }
  });
  return kuromojiInitPromise;
}
function getReading(text) {
  if (!kuromojiTokenizer || !text) return '';
  try {
    return kuromojiTokenizer.tokenize(text).map((t) => t.reading || t.surface_form).join('');
  } catch (e) {
    return '';
  }
}

// --- 💾 캐시 (로컬 파일 1순위 + Firestore 2순위) ---
// 서버는 한 프로세스가 계속 켜져있으면서 모든 사용자에게 같은 결과를 재사용하는 구조라,
// 캐시 효과가 데스크톱 버전보다 훨씬 큼(한 번 받아오면 몇 명이 접속하든 그걸 같이 씀).
// ⚠️ Render 같은 무료 호스팅은 서버가 재시작될 때 로컬 파일이 초기화될 수 있어서,
// Firestore에도 같이 저장해둠 - 재시작돼도 Firestore 쪽은 남아있어서 캐시가 안 날아감.
const CACHE_DIR = path.join(__dirname, '.cache');
if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

const CACHE_SCHEMA_VERSION = 8;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const EXTRA_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

function getCachePath() { return path.join(CACHE_DIR, 'hub-cache.json'); }
async function readCache(ignoreTTL = false) {
  try {
    const cache = JSON.parse(fs.readFileSync(getCachePath(), 'utf-8'));
    if (cache.schemaVersion === CACHE_SCHEMA_VERSION && (ignoreTTL || Date.now() - cache.savedAt < CACHE_TTL_MS)) {
      return cache.hubItems;
    }
  } catch (e) { /* 로컬 캐시 없거나 깨졌으면 Firestore로 */ }
  return readFirestoreCache('hub', CACHE_TTL_MS, ignoreTTL);
}
function writeCache(hubItems) {
  try {
    fs.writeFileSync(getCachePath(), JSON.stringify({ schemaVersion: CACHE_SCHEMA_VERSION, savedAt: Date.now(), hubItems }));
  } catch (e) { /* 저장 실패해도 서버 동작엔 지장 없음 */ }
  writeFirestoreCache('hub', hubItems);
}

function getExtraCachePath() { return path.join(CACHE_DIR, 'extra-cache.json'); }
async function readExtraCache() {
  try {
    const cache = JSON.parse(fs.readFileSync(getExtraCachePath(), 'utf-8'));
    if (cache.schemaVersion === CACHE_SCHEMA_VERSION && Date.now() - cache.savedAt < EXTRA_CACHE_TTL_MS) {
      return cache.extraItems;
    }
  } catch (e) { /* 로컬 캐시 없거나 깨졌으면 Firestore로 */ }
  return readFirestoreCache('extra', EXTRA_CACHE_TTL_MS, false);
}
function writeExtraCache(extraItems) {
  try {
    fs.writeFileSync(getExtraCachePath(), JSON.stringify({ schemaVersion: CACHE_SCHEMA_VERSION, savedAt: Date.now(), extraItems }));
  } catch (e) { /* 저장 실패해도 서버 동작엔 지장 없음 */ }
  writeFirestoreCache('extra', extraItems);
}

// --- hub API 호출 (main.js와 동일) ---
function postJson(url, bodyObj) {
  const body = JSON.stringify(bodyObj);
  return new Promise((resolve, reject) => {
    const req = https.request(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json;charset=UTF-8',
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0',
        'Origin': 'https://api.visitkorea.or.kr',
        'Referer': 'https://api.visitkorea.or.kr/'
      }
    }, (res) => {
      res.setEncoding('utf8');
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

const HUB_EXCLUDE_KEYWORDS = ['광안리 M', '광안리M'];
function filterExcludedHubItems(items) {
  return items.filter((item) => !HUB_EXCLUDE_KEYWORDS.some((kw) => (item.title || '').includes(kw)));
}

async function fetchHubEvents() {
  const url = 'https://api.visitkorea.or.kr/hub/getTourDbInfo.do';
  const PAGE_SIZE = 100;
  let pageNo = 1;
  let allItems = [];
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const payload = {
      type: 'cat', lang: 'KOR', cat1: ['EV'], cat2: ['EV01', 'EV02', 'EV03'], cat3: [],
      areaCd: ['26', '48', '31'], arrange: 'NEW', awardYear: [], fromDetail: false, langDiv: 'KOR',
      mainYn: 'N', nuri: [], pageCnt: 1, pageNo, photo1: [], photo2: [],
      searchCnt: PAGE_SIZE, searchStart: (pageNo - 1) * PAGE_SIZE, sigunguCd: [], title: ''
    };
    // eslint-disable-next-line no-await-in-loop
    const raw = await postJson(url, payload);
    const items = JSON.parse(raw);
    if (!Array.isArray(items)) throw new Error(`배열이 아닌 응답: ${raw.slice(0, 300)}`);
    allItems = allItems.concat(items);
    if (items.length < PAGE_SIZE) break;
    pageNo += 1;
    if (pageNo > 10) break;
  }
  const filtered = filterExcludedHubItems(allItems);
  // 🔎 진단용: 페이지 제한(10장=1000건)에 걸려서 잘린 건지 확인 + 지역별 대략적인 개수 확인
  console.log(`[server] hub 전체 ${filtered.length}건 받아옴 (${pageNo - 1}페이지 처리, 10페이지 제한 걸렸으면 더 있을 수 있음)`);
  const regionCounts = { 부산: 0, 울산: 0, 경남등: 0 };
  filtered.forEach((item) => {
    const addr = item.eventPlace || item.addr1 || '';
    if (addr.includes('울산')) regionCounts.울산 += 1;
    else if (addr.includes('부산')) regionCounts.부산 += 1;
    else regionCounts.경남등 += 1;
  });
  console.log('[server] 지역별 대략적인 개수(주소 텍스트 기준):', regionCounts);
  // 🔎 진단용: 좌표 필드가 실제로 어떤 이름으로 오는지 확인 (경로안내 기능 준비용)
  if (filtered[0]) {
    console.log('[server] hub 원본 항목 샘플(좌표 필드 확인용):', JSON.stringify(filtered[0], null, 2).slice(0, 1500));
  }
  return filtered;
}

function httpsGetJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      res.setEncoding('utf8');
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

let loggedSampleFailure = false;
async function fetchDetailIntro(contentId) {
  const key = encodeURIComponent(config.DATA_GO_KR_API_KEY);
  const url = `https://apis.data.go.kr/B551011/KorService2/detailIntro2?serviceKey=${key}&MobileOS=ETC&MobileApp=BusanNavi&_type=json&contentId=${contentId}&contentTypeId=15`;
  try {
    const raw = await httpsGetJson(url);
    const data = JSON.parse(raw);
    const item = data.response?.body?.items?.item;
    const record = Array.isArray(item) ? item[0] : item;
    if (!record?.eventstartdate && !loggedSampleFailure) {
      loggedSampleFailure = true;
      console.log('[server] detailIntro2 날짜 없는 샘플 응답:', raw.slice(0, 400));
    }
    return record || null;
  } catch (e) {
    if (!loggedSampleFailure) {
      loggedSampleFailure = true;
      console.log('[server] detailIntro2 요청 자체가 실패함(네트워크/파싱 오류):', e.message);
    }
    return null;
  }
}

// 👉 detailIntro2 응답을 우리 필드명으로 매핑하는 공통 함수 - 재시도 때도 똑같이 써서
// 코드 중복(그리고 실수로 필드 하나 빠뜨리는 것) 방지
function mapDetailFields(item, data) {
  return {
    ...item,
    eventStartDate: data?.eventstartdate || item.eventStartDate || '',
    eventEndDate: data?.eventenddate || item.eventEndDate || '',
    eventPlace: data?.eventplace || item.eventPlace || '',
    playTime: data?.playtime || item.playTime || '',
    program: data?.program || item.program || '',
    subEvent: data?.subevent || item.subEvent || '',
    sponsor1: data?.sponsor1 || item.sponsor1 || '',
    sponsor1Tel: data?.sponsor1tel || item.sponsor1Tel || '',
    sponsor2: data?.sponsor2 || item.sponsor2 || '',
    ageLimit: data?.agelimit || item.ageLimit || '',
    bookingPlace: data?.bookingplace || item.bookingPlace || '',
    discountInfo: data?.discountinfofestival || item.discountInfo || '',
    placeInfo: data?.placeinfo || item.placeInfo || '',
    progressType: data?.progresstype || item.progressType || '',
    spendTime: data?.spendtime || item.spendTime || '',
    useFee: data?.usetimefestival || item.useFee || ''
  };
}

async function enrichWithDates(items, concurrency = 15) {
  const queue = [...items];
  const results = [];
  async function worker() {
    while (queue.length > 0) {
      const item = queue.shift();
      try {
        // eslint-disable-next-line no-await-in-loop
        const data = await fetchDetailIntro(item.contentId);
        results.push(mapDetailFields(item, data));
      } catch (e) {
        results.push(item);
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  // 👉 날짜를 못 받은 항목만 한 번 더 재시도함 - 네트워크 일시적 실패였던 것들은
  // 이걸로 건질 수 있음. 재시도는 동시성을 낮춰서(5) 서버/API에 부담을 덜 줌
  const failedIndexes = results.map((r, i) => (!r.eventStartDate ? i : -1)).filter((i) => i >= 0);
  if (failedIndexes.length > 0) {
    console.log(`[server] detailIntro2 날짜 못 받은 ${failedIndexes.length}건 재시도 중...`);
    const retryQueue = [...failedIndexes];
    async function retryWorker() {
      while (retryQueue.length > 0) {
        const idx = retryQueue.shift();
        try {
          // eslint-disable-next-line no-await-in-loop
          const data = await fetchDetailIntro(results[idx].contentId);
          if (data?.eventstartdate) {
            results[idx] = mapDetailFields(results[idx], data);
          }
        } catch (e) {
          // 재시도도 실패하면 그냥 원래 값(빈 날짜) 유지
        }
      }
    }
    await Promise.all(Array.from({ length: 5 }, () => retryWorker()));
    const recoveredCount = failedIndexes.filter((i) => results[i].eventStartDate).length;
    console.log(`[server] 재시도로 ${recoveredCount}/${failedIndexes.length}건 추가 확보`);
  }

  const successCount = results.filter((r) => r.eventStartDate).length;
  console.log(`[server] detailIntro2 날짜 확보: ${successCount}/${results.length}건`);
  return results;
}

// --- 번역 (main.js와 동일 - DeepL 우선, 한도초과/실패 시 구글로 자동 전환) ---
// 👉 cat2Nm/cat3Nm(카테고리)은 여기서 뺐음 - 한국관광콘텐츠랩의 분류가 개수가 정해져 있어서
// (대분류 3개, 세부분류 20개), 자동번역 대신 renderer.js에 직접 정확한 일본어 사전을
// 만들어서 씀. 자동번역은 어색한 표현이 나올 수 있고, 표시 순서도 매번 흔들려서
// (데이터에 먼저 나오는 순서를 그대로 썼었음) 이 방식이 더 안정적임.
const HUB_TRANSLATABLE_FIELDS = [
  'title', 'outl', 'addr1', 'eventPlace', 'playTime', 'program', 'subEvent',
  'sponsor1', 'sponsor2', 'ageLimit', 'bookingPlace', 'discountInfo', 'placeInfo', 'progressType', 'useFee'
];
const SIMPLE_TRANSLATABLE_FIELDS = [
  'title', 'summary', 'place', 'category', 'playTime', 'program', 'subEvent',
  'sponsor1', 'sponsor2', 'ageLimit', 'bookingPlace', 'discountInfo', 'placeInfo', 'useFee'
];

function deeplRequest(hostname, texts) {
  const body = JSON.stringify({ text: texts, source_lang: 'KO', target_lang: 'JA' });
  return new Promise((resolve, reject) => {
    const req = https.request(
      { hostname, path: '/v2/translate', method: 'POST',
        headers: { 'Authorization': `DeepL-Auth-Key ${config.DEEPL_API_KEY.trim()}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } },
      (res) => {
        res.setEncoding('utf8');
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => resolve({ status: res.statusCode, body: data }));
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

let deeplHostOverride = null;
let deeplQuotaExceeded = false;
async function deeplTranslateBatch(texts) {
  const hostsToTry = deeplHostOverride ? [deeplHostOverride] : ['api-free.deepl.com', 'api.deepl.com'];
  let lastResult = null;
  for (const host of hostsToTry) {
    // eslint-disable-next-line no-await-in-loop
    const result = await deeplRequest(host, texts);
    if (result.status === 200) { deeplHostOverride = host; return result.body; }
    lastResult = result;
  }
  const err = new Error(`DeepL 인증/요청 실패 (status=${lastResult?.status})`);
  if (lastResult?.status === 456) err.isQuotaExceeded = true;
  throw err;
}

async function googleTranslateOne(text) {
  if (!text || !text.trim()) return text || '';
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=ko&tl=ja&dt=t&q=${encodeURIComponent(text)}`;
  try {
    const data = JSON.parse(await httpsGetJson(url));
    return data[0].map((seg) => seg[0]).join('');
  } catch (e) {
    return text;
  }
}

async function translateItemsToJapanese(items, fields = HUB_TRANSLATABLE_FIELDS) {
  const useDeepL = Boolean(config.DEEPL_API_KEY && config.DEEPL_API_KEY.trim());
  const flatTexts = [];
  const indexMap = [];
  items.forEach((item, itemIdx) => {
    fields.forEach((field) => {
      const val = item[field];
      if (val && val.trim()) { flatTexts.push(val); indexMap.push({ itemIdx, field }); }
    });
  });
  const results = items.map((item) => ({ ...item }));
  fields.forEach((field) => { results.forEach((r) => { r[`orig_${field}`] = r[field] || ''; }); });
  if (flatTexts.length === 0) return { items: results, allFailed: false };

  let failCount = 0;
  const tryDeepL = useDeepL && !deeplQuotaExceeded;

  if (tryDeepL) {
    const CHUNK = 50;
    let remainingStartIdx = flatTexts.length;
    for (let i = 0; i < flatTexts.length; i += CHUNK) {
      const chunk = flatTexts.slice(i, i + CHUNK);
      const chunkMap = indexMap.slice(i, i + CHUNK);
      try {
        // eslint-disable-next-line no-await-in-loop
        const raw = await deeplTranslateBatch(chunk);
        const data = JSON.parse(raw);
        if (!data.translations) throw new Error(raw.slice(0, 200));
        data.translations.forEach((t, j) => { const { itemIdx, field } = chunkMap[j]; results[itemIdx][field] = t.text; });
      } catch (e) {
        if (e.isQuotaExceeded) {
          console.log('[server] DeepL 한도 초과 - 나머지는 구글 번역으로 자동 전환');
          deeplQuotaExceeded = true;
          remainingStartIdx = i;
          break;
        }
        console.log('[server] DeepL 번역 실패, 이 묶음은 원문 유지:', e.message);
        failCount += chunk.length;
      }
    }
    if (deeplQuotaExceeded && remainingStartIdx < flatTexts.length) {
      const queue = [];
      for (let i = remainingStartIdx; i < flatTexts.length; i++) queue.push(i);
      async function worker() {
        while (queue.length > 0) {
          const i = queue.shift();
          const { itemIdx, field } = indexMap[i];
          // eslint-disable-next-line no-await-in-loop
          const translated = await googleTranslateOne(flatTexts[i]);
          if (translated === flatTexts[i]) failCount += 1;
          results[itemIdx][field] = translated;
        }
      }
      await Promise.all(Array.from({ length: 8 }, () => worker()));
    }
  } else {
    const queue = [...Array(flatTexts.length).keys()];
    async function worker() {
      while (queue.length > 0) {
        const i = queue.shift();
        const { itemIdx, field } = indexMap[i];
        // eslint-disable-next-line no-await-in-loop
        const translated = await googleTranslateOne(flatTexts[i]);
        if (translated === flatTexts[i]) failCount += 1;
        results[itemIdx][field] = translated;
      }
    }
    await Promise.all(Array.from({ length: 8 }, () => worker()));
  }

  console.log(`[server] 자동번역 완료: 텍스트 ${flatTexts.length}개 중 실패 ${failCount}개`);
  return { items: results, allFailed: failCount > 0 && failCount === flatTexts.length };
}

// --- 🌐 실제로 데이터를 모으는 메인 함수 (main.js의 fetch-all-festivals 핸들러와 동일 로직) ---
async function getAllFestivals() {
  initKuromoji(); // hub 처리 동안 백그라운드로 미리 로딩

  const result = { hubItems: [], extra: extraFestivals, errors: [], debug: '' };

  const cachedExtra = await readExtraCache();
  if (cachedExtra) {
    result.extra = cachedExtra;
    console.log(`[server] 직접추가 항목 캐시 사용 (${cachedExtra.length}건)`);
  } else {
    try {
      let extraSource = extraFestivals;
      try {
        const firestoreItems = await fetchFirestoreFestivals();
        if (firestoreItems && firestoreItems.length > 0) extraSource = firestoreItems;
      } catch (e) {
        console.log('[server] Firestore 조회 실패, extraFestivals.js로 대체:', e.message);
      }
      const { items: translatedExtra } = await translateItemsToJapanese(extraSource, SIMPLE_TRANSLATABLE_FIELDS);
      await initKuromoji();
      translatedExtra.forEach((item) => { if (!item.reading) item.reading = getReading(item.title); });
      result.extra = translatedExtra;
      writeExtraCache(translatedExtra);
    } catch (e) {
      result.errors.push(`직접추가 번역 실패(원문 유지): ${e.message}`);
    }
  }

  const cached = await readCache();
  if (cached) {
    result.hubItems = cached;
    result.debug = `캐시 사용 (${cached.length}건)`;
    return result;
  }

  try {
    const rawHubItems = await fetchHubEvents();
    const items = await enrichWithDates(rawHubItems);
    const { items: translatedItems, allFailed } = await translateItemsToJapanese(items);
    await initKuromoji();
    translatedItems.forEach((item) => { item.reading = getReading(item.title); });

    result.hubItems = translatedItems;
    result.debug = allFailed ? '⚠️ 번역 전부 실패(원문 표시중)' : '새로 받아옴';
    if (!allFailed) writeCache(translatedItems);
  } catch (e) {
    console.log('[server] hub 검색 실패, 대체 데이터를 찾습니다:', e.message);
    const staleCache = await readCache(true);
    if (staleCache) {
      result.hubItems = staleCache;
      result.debug = `⚠️ 최신 데이터를 못 받아와서 이전 데이터를 대신 보여드립니다. (${e.message})`;
      return result;
    }
    try {
      const snap = await fetchFirestoreHubSnapshot();
      if (snap && snap.length > 0) {
        result.hubItems = snap;
        result.debug = `⚠️ 최신 데이터를 못 받아와서 백업 스냅샷을 대신 보여드립니다. (${e.message})`;
        return result;
      }
    } catch (e2) {
      console.log('[server] 스냅샷 조회도 실패:', e2.message);
    }
    result.errors.push(`hub 검색 실패: ${e.message}`);
  }
  return result;
}

// --- 🚀 서버 ---
const app = express();
app.use(express.static(path.join(__dirname, 'public'))); // PWA 화면 파일들(index.html 등)

app.get('/health', (req, res) => res.json({ ok: true }));

app.get('/api/festivals', async (req, res) => {
  try {
    const result = await getAllFestivals();
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`[server] DATA_GO_KR_API_KEY 길이: ${config.DATA_GO_KR_API_KEY.length}자 (0이면 .env에 안 채워진 것)`);
  console.log(`[server] フェスナビ 서버 실행 중 - http://localhost:${PORT}`);
});