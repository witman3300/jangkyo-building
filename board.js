// 회원게시판 - Firestore(posts 컬렉션) + Firebase Storage(첨부파일) 기반.
// 예전에는 글을 localStorage에 저장해서 글을 쓴 그 브라우저에서만 보였는데,
// 이제는 서버에 저장되므로 어느 PC에서 쓰든 모든 회원에게 보이고, 목록을 켜 둔 다른 PC에도
// 새로고침 없이 바로 반영된다(onSnapshot 구독).
// 게시글 문서: { cat, title, author, authorUid, content, date, pinned, createdAt,
//                files: [{ name, type, size, path, url }] }
// 첨부파일 본체는 Storage의 board/{cat}/{postId}/ 아래에 두고, 문서에는 주소만 저장한다.

const POSTS_COL = "posts";
const LEGACY_STORE_KEY = "jangkyo_board_posts"; // 옛 localStorage 방식으로 그 브라우저에만 남아 있던 글
const MAX_FILE_MB = 20; // Storage에 올리므로 예전(3MB)보다 크게 잡을 수 있다

/* 게시판 카테고리
   정보마당(공개): notice 공지사항 · infodata 자료실 · forms 서식 다운로드 · faq 자주 묻는 질문
     — 비회원 포함 누구나 열람할 수 있고, 등록은 관리자만 한다.
   회원광장(특별회원 전용): info 공지사항 · data 자료실 · report 결산보고서 ·
     minutes 월간회의록 · fee 관리비 부과내역
   rental 임대안내는 공개 게시판이다.
   info와 notice는 이름은 같지만 서로 다른 게시판이다(회원광장 / 정보마당). */
const CATEGORIES = {
  notice: "공지사항",
  infodata: "자료실",
  forms: "서식 다운로드",
  faq: "자주 묻는 질문",
  data: "자료실",
  report: "결산보고서",
  minutes: "월간회의록",
  rental: "임대안내",
  info: "공지사항",
  fee: "관리비 부과내역",
};

// 글쓰기를 관리자만 할 수 있는 카테고리
// 관리사무소가 배포하는 공식 자료이거나(결산보고서·월간회의록·관리비 부과내역),
// 정보마당처럼 건물 공식 안내를 싣는 게시판이다.
const ADMIN_WRITE_CATS = ["info", "report", "minutes", "fee", "notice", "infodata", "forms", "faq"];

/* 공지사항은 정보마당(notice)과 회원광장(info) 두 곳에 따로 있다.
   같은 이름이지만 보는 사람이 다르다 — 정보마당은 누구나, 회원광장은 특별회원만 본다.
   두 곳 사이에서 글을 옮길 수 있게 목록에 이동 열을 둔다. */
const MOVE_CATS = ["notice", "info"];
const MOVE_LABELS = { notice: "정보마당", info: "회원광장" };

// 정적 데이터 파일에 원본 글이 들어 있는 카테고리.
// 목록에는 원본 글(data)과 이 사이트에서 새로 올린 글을 함께 보여주고,
// 원본 글은 전용 상세 페이지(view)로 연결한다.
const DOC_CATS = {
  // 정보마당 공지사항은 관리단 공지 원본(notices-data.js)을 그대로 싣는다.
  // 관리비 관련 공지는 board-fee.html(관리비 부과내역)로 옮겨 여기서는 제외한다.
  notice: {
    data: () =>
      typeof NOTICES !== "undefined"
        ? NOTICES.filter((p) => p.title.indexOf("관리비") === -1)
        : [],
    view: "notice-view.html",
  },
  report: {
    data: () => (typeof REPORTS !== "undefined" ? REPORTS : []),
    view: "report-view.html",
  },
  minutes: {
    data: () => (typeof MINUTES !== "undefined" ? MINUTES : []),
    view: "minutes-view.html",
  },
  // 관리비 부과내역은 별도 데이터 파일 없이 공지사항 중 "관리비" 글만 모아 원본으로 삼는다.
  fee: {
    data: () =>
      typeof NOTICES !== "undefined"
        ? NOTICES.filter((p) => p.title.indexOf("관리비") !== -1)
        : [],
    view: "notice-view.html",
  },
};

/* 현재 카테고리: 페이지가 지정한 window.BOARD_CAT 우선, 없으면 ?cat=.
   기본값은 회원광장 공지사항(info)이다. board.js를 cat 없이 쓰는 곳은 board.html뿐이고
   그 페이지가 회원광장이기 때문이다. 예전에는 기본값이 notice여서, 상단 메뉴에서
   회원광장에 들어가면 정보마당 공지사항이 그대로 떴다.
   정보마당 공지사항은 info-notice.html이 BOARD_CAT으로 직접 지정한다. */
function getCat() {
  if (window.BOARD_CAT && CATEGORIES[window.BOARD_CAT]) return window.BOARD_CAT;
  const c = new URLSearchParams(location.search).get("cat");
  return CATEGORIES[c] ? c : "info";
}

let pendingFiles = []; // 작성 중 첨부 대기 목록 (File 객체를 그대로 들고 있다가 등록할 때 업로드)

/* ===== Firestore 구독 =====
   현재 카테고리의 글을 실시간으로 받아 POSTS에 담아 둔다.
   where + orderBy를 같이 쓰면 복합 색인을 만들어야 하므로, 정렬은 받아온 뒤 여기서 처리한다. */
let POSTS = [];
let postsLoaded = false;
let unsubscribePosts = null;

function postsRef() {
  return db.collection(POSTS_COL);
}

function subscribePosts() {
  if (unsubscribePosts) unsubscribePosts();
  unsubscribePosts = postsRef()
    .where("cat", "==", getCat())
    .onSnapshot(
      (snap) => {
        POSTS = snap.docs
          .map((d) => Object.assign({ id: d.id }, d.data()))
          .sort((a, b) => (a.createdAt ? a.createdAt.seconds : 0) - (b.createdAt ? b.createdAt.seconds : 0));
        postsLoaded = true;
        onPostsChanged();
      },
      () => {
        // 권한 없음·네트워크 오류 등: 빈 목록으로 두고 화면은 계속 그린다
        postsLoaded = true;
        onPostsChanged();
      }
    );
}

// 다른 PC에서 글이 등록·삭제되면 화면을 다시 그린다. 단, 글을 쓰는 중에는 폼을 지우지 않는다.
function onPostsChanged() {
  if ((location.hash || "#list") === "#write") return;
  route();
}

function loadPosts() {
  return POSTS;
}

function fmtSize(bytes) {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / 1024 / 1024).toFixed(1) + " MB";
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);
}

/* NEW 표시 기간: 올린 지 7일이 지나면 사라진다.
   날짜는 "YYYY-MM-DD" 형태다. Date.parse는 이 형태를 UTC 0시로 읽어 한국 시각과
   9시간 어긋나므로(오늘 올린 글이 오전에는 NEW로 안 잡힌다) 직접 현지 0시로 만든다. */
const NEW_DAYS = 7;

function isWithinNewDays(dateStr) {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(String(dateStr || "").trim());
  if (!m) return false;
  const posted = new Date(+m[1], +m[2] - 1, +m[3]); // 그날 0시(현지 시각)
  return (Date.now() - posted.getTime()) / (24 * 60 * 60 * 1000) < NEW_DAYS;
}

/* ===== 목록 보기 =====
   DOC_CATS 카테고리는 정적 원본 글(reports-data.js 등)을 아래쪽에 두고,
   이 사이트에서 새로 등록한 글은 원본 마지막 번호 다음 번호를 받아 위쪽에 쌓인다. */
function renderList() {
  const cat = getCat();
  const all = loadPosts().filter((p) => (p.cat || "notice") === cat);
  // 고정글은 항상 상단, 그 다음 일반글(최신순)
  const pinned = all.filter((p) => p.pinned).reverse();
  const normal = all.filter((p) => !p.pinned).reverse();

  const doc = DOC_CATS[cat];
  const staticRows = doc ? doc.data().slice().sort((a, b) => b.no - a.no) : [];
  const baseNo = staticRows.reduce((m, p) => Math.max(m, p.no || 0), 0);

  /* 이동 열: 두 공지사항 게시판(정보마당·회원광장) 사이에서 글을 옮긴다.
     관리자에게만 보이고, 이 사이트에서 등록한 글에만 붙는다.
     구 사이트에서 옮겨온 원본 공지는 파일에 들어 있어 옮길 수 없다. */
  const showMove = MOVE_CATS.includes(cat) && typeof isAdmin === "function" && isAdmin();

  const moveCell = (p) =>
    `<select class="move-select" onchange="movePost('${p.id}', this.value)">${MOVE_CATS.map(
      (c) => `<option value="${c}"${c === cat ? " selected" : ""}>${MOVE_LABELS[c]}</option>`
    ).join("")}</select>`;

  const rowHtml = (o) => {
    const clip = o.files
      ? `<span class="clip" title="첨부파일 ${o.files}개">📎${o.files}</span>`
      : "";
    const flag = o.pinned
      ? `<span class="pin-flag">📌 공지</span> `
      : o.isNew
        ? `<span class="pin-flag">NEW</span> `
        : "";
    // 셀마다 이름을 붙여 둔다. 모바일에서는 이 이름으로 제목을 윗줄, 나머지를 아랫줄로 배치한다.
    return `<tr class="${o.pinned ? "pinned-row" : ""}">
      <td class="num">${o.num}</td>
      <td class="title">${flag}<a href="${o.href}">${esc(o.title)}</a>${clip}</td>
      <td class="author">${esc(o.author)}</td>
      <td class="date">${o.date}</td>
      <td class="files${o.files ? " has-file" : ""}">${o.files ? o.files : ""}</td>
      ${showMove ? `<td class="move">${o.move || "-"}</td>` : ""}
    </tr>`;
  };

  const localRow = (p, num, pin) =>
    rowHtml({
      num,
      title: p.title,
      author: p.author,
      date: p.date,
      href: "#view/" + p.id,
      files: (p.files && p.files.length) || 0,
      pinned: pin,
      isNew: isWithinNewDays(p.date),
      move: showMove ? moveCell(p) : '',
    });

  const staticRow = (p) =>
    rowHtml({
      num: p.no,
      title: p.title,
      author: "관리자",
      date: p.date,
      href: doc.view + "?id=" + p.id,
      files: p.imgCount || 0,
      pinned: false,
      isNew: isWithinNewDays(p.date),
    });

  let rows;
  if (!postsLoaded && staticRows.length === 0) {
    rows = `<tr><td colspan="${showMove ? 6 : 5}" class="board-empty">불러오는 중...</td></tr>`;
  } else if (all.length === 0 && staticRows.length === 0) {
    rows = `<tr><td colspan="${showMove ? 6 : 5}" class="board-empty">등록된 게시글이 없습니다.</td></tr>`;
  } else {
    let n = baseNo + normal.length;
    rows =
      pinned.map((p) => localRow(p, "📌", true)).join("") +
      normal.map((p) => localRow(p, n--, false)).join("") +
      staticRows.map(staticRow).join("");
  }

  const canWrite = !ADMIN_WRITE_CATS.includes(cat) || (typeof isAdmin === "function" && isAdmin());
  const writeBtn = canWrite ? `<a href="#write" class="btn btn-primary btn-sm">글쓰기</a>` : "";

  // 정보마당처럼 페이지에 이미 제목이 있는 자리에 게시판을 끼워 넣을 때는
  // window.BOARD_HIDE_TITLE = true 로 두어 제목을 겹쳐 쓰지 않는다.
  const heading = window.BOARD_HIDE_TITLE ? "" : `<h1>${CATEGORIES[cat]}</h1>`;

  document.getElementById("app").innerHTML = `
    <div class="board-head">
      ${heading}
      ${writeBtn}
    </div>
    ${legacyNoticeHtml()}
    <table class="board-table">
      <thead>
        <tr><th width="60">번호</th><th>제목</th><th width="100">작성자</th><th width="110">작성일</th><th width="70">첨부</th>${showMove ? '<th width="120">이동</th>' : ""}</tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

/* ===== 옛 localStorage 글 서버로 옮기기 =====
   예전 방식으로 이 브라우저에만 저장돼 있던 글이 있으면 목록 위에 안내를 띄우고,
   버튼을 누르면 첨부파일까지 Storage에 올려 서버(Firestore)로 이전한다. */
function legacyPosts() {
  try {
    return (JSON.parse(localStorage.getItem(LEGACY_STORE_KEY)) || []).filter(
      (p) => (p.cat || "notice") === getCat()
    );
  } catch (e) {
    return [];
  }
}

function legacyNoticeHtml() {
  const n = legacyPosts().length;
  if (!n || !(typeof isSpecial === "function" && isSpecial())) return "";
  return `<div class="content-edit-notice">
    이 브라우저에만 저장된 예전 게시글이 ${n}개 있습니다. 서버로 옮기면 다른 PC에서도 보입니다.
    <button type="button" class="btn btn-outline btn-sm" onclick="migrateLegacyPosts()">서버로 옮기기</button>
  </div>`;
}

async function migrateLegacyPosts() {
  const olds = legacyPosts();
  if (!olds.length) return;
  showToast(`예전 게시글 ${olds.length}개를 서버로 옮기는 중...`);
  const session = typeof getSession === "function" ? getSession() : null;
  try {
    for (const old of olds) {
      const ref = postsRef().doc();
      const files = [];
      for (let i = 0; i < (old.files || []).length; i++) {
        const f = old.files[i];
        // 예전 글의 첨부는 base64 데이터URL로 본문에 들어 있었다 → 실제 파일로 되살려 업로드한다
        const blob = await fetch(f.data).then((r) => r.blob());
        files.push(await uploadAttachment(ref.id, i, new File([blob], f.name, { type: f.type || blob.type })));
      }
      await ref.set({
        cat: old.cat || "notice",
        title: old.title || "",
        author: old.author || "",
        authorUid: (session && session.uid) || "",
        content: old.content || "",
        date: old.date || "",
        pinned: !!old.pinned,
        files: files,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
    }
    // 옮긴 글만 남은 목록에서 지운다 (다른 카테고리 글은 그대로 둔다)
    const keep = JSON.parse(localStorage.getItem(LEGACY_STORE_KEY) || "[]").filter(
      (p) => (p.cat || "notice") !== getCat()
    );
    if (keep.length) localStorage.setItem(LEGACY_STORE_KEY, JSON.stringify(keep));
    else localStorage.removeItem(LEGACY_STORE_KEY);
    showToast(`${olds.length}개를 서버로 옮겼습니다.`);
    route();
  } catch (e) {
    showToast("옮기지 못했습니다: " + e.message);
  }
}

/* ===== 작성 보기 ===== */
function renderWrite() {
  pendingFiles = [];
  const session = typeof getSession === "function" ? getSession() : null;
  document.getElementById("app").innerHTML = `
    <div class="board-head"><h1>${CATEGORIES[getCat()]} · 글쓰기</h1></div>
    <form class="write-form" onsubmit="submitPost(event)">
      <div class="write-row">
        <div class="label">제목</div>
        <div class="field"><input type="text" id="f-title" placeholder="제목을 입력하세요" required /></div>
      </div>
      <div class="write-row">
        <div class="label">작성자</div>
        <div class="field"><input type="text" id="f-author" placeholder="이름" value="${esc((session && session.name) || "")}" required /></div>
      </div>
      <div class="write-row">
        <div class="label">자료첨부</div>
        <div class="field">
          <input type="file" id="f-files" multiple onchange="onPickFiles(event)" />
          <span class="file-hint">여러 개 선택 가능 · 파일당 최대 ${MAX_FILE_MB}MB</span>
          <ul class="file-list" id="file-list"></ul>
        </div>
      </div>
      <div class="write-row">
        <div class="label">내용</div>
        <div class="field"><textarea id="f-content" placeholder="내용을 입력하세요" required></textarea></div>
      </div>
      ${(typeof isAdmin === "function" && isAdmin())
        ? `<div class="write-row">
            <div class="label">상단 고정</div>
            <div class="field"><label class="pin-check"><input type="checkbox" id="f-pinned" /> 이 글을 목록 상단에 고정(공지)</label></div>
          </div>`
        : ""}
      <div class="btn-row">
        <button type="submit" class="btn btn-primary btn-sm" id="f-submit">등록</button>
        <a href="#list" class="btn btn-outline btn-sm">취소</a>
      </div>
    </form>`;
}

function renderFileList() {
  const ul = document.getElementById("file-list");
  if (!ul) return;
  ul.innerHTML = pendingFiles
    .map((f, i) => `<li>📎 ${esc(f.name)} <span style="color:#aaa">(${fmtSize(f.size)})</span>
      <button type="button" class="remove" onclick="removeFile(${i})">삭제</button></li>`)
    .join("");
}

function onPickFiles(e) {
  Array.from(e.target.files).forEach((file) => {
    if (file.size > MAX_FILE_MB * 1024 * 1024) {
      showToast(`"${file.name}" 은(는) ${MAX_FILE_MB}MB를 초과하여 제외됩니다.`);
      return;
    }
    pendingFiles.push(file);
  });
  renderFileList();
  e.target.value = ""; // 같은 파일 다시 선택 가능하도록 초기화
}

function removeFile(i) {
  pendingFiles.splice(i, 1);
  renderFileList();
}

// 첨부 1개를 Storage에 올리고, 문서에 저장할 정보(주소 포함)를 돌려준다.
async function uploadAttachment(postId, index, file) {
  const path = `board/${getCat()}/${postId}/${index}_${file.name}`;
  const snap = await fbStorage.ref(path).put(file, { contentType: file.type || "application/octet-stream" });
  return {
    name: file.name,
    type: file.type || "",
    size: file.size,
    path: path,
    url: await snap.ref.getDownloadURL(),
  };
}

async function submitPost(e) {
  e.preventDefault();
  const title = document.getElementById("f-title").value.trim();
  const author = document.getElementById("f-author").value.trim();
  const content = document.getElementById("f-content").value.trim();
  if (!title || !author || !content) return;

  const btn = document.getElementById("f-submit");
  btn.disabled = true;
  btn.textContent = "등록 중...";

  const now = new Date();
  const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const pinEl = document.getElementById("f-pinned");
  const session = typeof getSession === "function" ? getSession() : null;
  const ref = postsRef().doc(); // 첨부 경로에 쓰려고 문서 ID를 먼저 받아 둔다

  try {
    const files = [];
    for (let i = 0; i < pendingFiles.length; i++) {
      btn.textContent = `첨부 올리는 중 ${i + 1}/${pendingFiles.length}...`;
      files.push(await uploadAttachment(ref.id, i, pendingFiles[i]));
    }
    await ref.set({
      cat: getCat(),
      title, author, content, date,
      authorUid: (session && session.uid) || "",
      files: files,
      pinned: !!(pinEl && pinEl.checked),
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    location.hash = "#view/" + ref.id;
  } catch (err) {
    showToast("등록하지 못했습니다: " + err.message);
    btn.disabled = false;
    btn.textContent = "등록";
  }
}

/* ===== 상세 보기 ===== */
function renderView(id) {
  const p = loadPosts().find((x) => x.id === id);
  if (!p) {
    // 아직 못 불러온 상태면 기다리고, 다 불러왔는데 없으면 목록으로 되돌린다
    if (!postsLoaded) {
      document.getElementById("app").innerHTML = `<p class="board-empty">불러오는 중...</p>`;
      return;
    }
    location.hash = "#list";
    return;
  }
  const attach = (p.files && p.files.length)
    ? `<div class="view-attach"><strong>📎 첨부파일</strong>${p.files
        .map((f) => `<a href="${f.url}" target="_blank" rel="noopener">${esc(f.name)} (${fmtSize(f.size)})</a>`)
        .join("")}</div>`
    : "";

  // 결산보고서·회의록처럼 스캔 이미지를 올린 경우 본문 아래에 그대로 펼쳐 보여준다
  const images = (p.files || []).filter((f) => (f.type || "").indexOf("image/") === 0);
  const imagesHtml = images.length
    ? `<div class="view-images">${images
        .map((f) => `<img src="${f.url}" alt="${esc(f.name)}" loading="lazy" />`)
        .join("")}</div>`
    : "";

  const admin = typeof isAdmin === "function" && isAdmin();
  const session = typeof getSession === "function" ? getSession() : null;
  const mine = !!(session && p.authorUid && session.uid === p.authorUid);
  const pinBtn = admin
    ? `<button type="button" class="btn btn-outline btn-sm" onclick="togglePin('${p.id}')">${p.pinned ? "고정 해제" : "상단 고정"}</button>`
    : "";
  // 삭제는 글쓴이 본인과 관리자만 (서버 규칙에서도 동일하게 막는다)
  const delBtn = admin || mine
    ? `<button type="button" class="btn btn-primary btn-sm" onclick="deletePost('${p.id}')">삭제</button>`
    : "";
  const pinTag = p.pinned ? `<span class="pin-flag">📌 공지</span> ` : "";

  document.getElementById("app").innerHTML = `
    <div class="board-head"><h1>${CATEGORIES[p.cat || getCat()]}</h1></div>
    <div class="view-head">
      <h2>${pinTag}${esc(p.title)}</h2>
      <div class="view-meta"><span>작성자 ${esc(p.author)}</span><span>${p.date}</span></div>
    </div>
    ${attach}
    <div class="view-body">${esc(p.content)}</div>
    ${imagesHtml}
    <div class="btn-row">
      <a href="#list" class="btn btn-outline btn-sm">목록</a>
      ${pinBtn}
      ${delBtn}
    </div>`;
}

/* 두 공지사항 게시판 사이에서 글을 옮긴다 (관리자만).
   옮기면 이 목록의 구독에서 빠져 화면에서 사라지고, 옮겨간 게시판에 나타난다. */
async function movePost(id, cat) {
  if (!(typeof isAdmin === "function" && isAdmin())) return;
  const p = loadPosts().find((x) => x.id === id);
  if (!p || p.cat === cat) return;
  if (!confirm(`"${p.title}" 글을 ${MOVE_LABELS[cat]} 공지사항으로 옮기시겠습니까?`)) {
    renderList(); // 선택을 원래대로 되돌린다
    return;
  }
  try {
    await postsRef().doc(id).update({ cat: cat });
    showToast(`${MOVE_LABELS[cat]} 공지사항으로 옮겼습니다.`);
  } catch (e) {
    showToast("옮기지 못했습니다: " + e.message);
    renderList();
  }
}

async function togglePin(id) {
  if (!(typeof isAdmin === "function" && isAdmin())) return;
  const p = loadPosts().find((x) => x.id === id);
  if (!p) return;
  try {
    await postsRef().doc(id).update({ pinned: !p.pinned });
  } catch (e) {
    showToast("변경하지 못했습니다: " + e.message);
  }
}

async function deletePost(id) {
  if (!confirm("이 게시글을 삭제하시겠습니까?")) return;
  const p = loadPosts().find((x) => x.id === id);
  try {
    // 첨부파일부터 지우고(실패해도 글 삭제는 진행) 문서를 지운다
    for (const f of (p && p.files) || []) {
      if (f.path) await fbStorage.ref(f.path).delete().catch(() => {});
    }
    await postsRef().doc(id).delete();
    location.hash = "#list";
  } catch (e) {
    showToast("삭제하지 못했습니다: " + e.message);
  }
}

/* 현재 카테고리에 해당하는 사이드바 메뉴 활성화 */
function highlightSidebar() {
  const cat = getCat();
  const currentPage = location.pathname.split("/").pop();
  document.querySelectorAll(".about-sub a").forEach((a) => {
    const href = a.getAttribute("href");
    // board.html?cat=X 형태의 링크, 또는(예: info-notice.html처럼) 카테고리 전용 페이지 자기 자신 링크 둘 다 인식
    a.classList.toggle("active", href === "board.html?cat=" + cat || href === currentPage);
  });
}

// 특별회원 전용 카테고리 (회원광장 공지사항·자료실·결산보고서·월간회의록·관리비 부과내역).
// 정보마당(notice·infodata·forms·faq)과 임대안내는 누구나 볼 수 있는 공개 게시판이라 제외.
const PROTECTED_CATS = ["info", "data", "report", "minutes", "fee"];

/* ===== 해시 라우터 ===== */
function route() {
  highlightSidebar();
  // 보호 카테고리는 특별회원만 접근 가능
  if (PROTECTED_CATS.includes(getCat()) && typeof isSpecial === "function" && !isSpecial()) {
    return guardSpecial("app");
  }
  const hash = location.hash || "#list";
  if (hash === "#write") {
    // 관리자 전용 글쓰기 카테고리는 관리자가 아니면 목록으로 되돌린다
    if (ADMIN_WRITE_CATS.includes(getCat()) && !(typeof isAdmin === "function" && isAdmin())) {
      location.hash = "#list";
      return renderList();
    }
    return renderWrite();
  }
  if (hash.startsWith("#view/")) return renderView(hash.slice(6));
  return renderList();
}

window.addEventListener("hashchange", route);
window.onAuthReady(function () {
  subscribePosts();
  route();
});
