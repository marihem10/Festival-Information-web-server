// 🌐 웹 버전 전용 - Electron의 preload.js(IPC)를 대신해서, renderer.js가 그대로 쓸 수 있게
// 똑같은 이름의 window.api를 만들어줌. 안쪽 구현만 fetch()/localStorage로 바뀐 것뿐이라
// renderer.js 코드는 거의 손 안 대도 됨.

function readBookmarksFromStorage() {
  try {
    return JSON.parse(localStorage.getItem('bookmarks') || '[]');
  } catch (e) {
    return [];
  }
}
function writeBookmarksToStorage(list) {
  localStorage.setItem('bookmarks', JSON.stringify(list));
}

window.api = {
  // 서버의 /api/festivals 에서 완성된(번역까지 끝난) 데이터를 받아옴
  fetchAllFestivals: async () => {
    const res = await fetch('/api/festivals');
    if (!res.ok) throw new Error(`서버 응답 오류: ${res.status}`);
    return res.json();
  },

  // 북마크는 서버가 아니라 "이 브라우저"에 저장함 (기기별로 따로 관리되는 건 기존 데스크톱 버전과 동일한 개념)
  getBookmarks: async () => readBookmarksFromStorage(),
  toggleBookmark: async (key) => {
    const list = readBookmarksFromStorage();
    const idx = list.indexOf(key);
    if (idx >= 0) list.splice(idx, 1);
    else list.push(key);
    writeBookmarksToStorage(list);
    return list;
  },

  // 웹 버전은 서버가 실시간 진행률을 안 보내줘서(1단계에서는 생략), 지금은 아무 동작 안 함.
  // 화면엔 로딩 상태만 계속 보이다가, 완료되면 결과가 한 번에 채워짐. 나중에 필요하면
  // Server-Sent Events 등으로 실시간 진행률도 추가할 수 있음.
  onFetchProgress: () => {}
};
