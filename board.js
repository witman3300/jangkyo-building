// 회원게시판 - localStorage 기반 (백엔드 없이 동작하는 데모)
// 게시글 구조: { id, title, author, content, date, files: [{name, type, size, data(base64)}] }

const STORE_KEY = "jangkyo_board_posts";
const MAX_FILE_MB = 3; // localStorage 용량 한계로 첨부 1개당 권장 최대 크기

// 게시판 카테고리 (사이드바 4종 + 메인 메뉴 2종)
const CATEGORIES = {
  notice: "공지사항",
  data: "자료실",
  report: "결산보고서",
  minutes: "월간회의록",
  rental: "임대안내",
  info: "정보마당",
};

// 현재 카테고리: 페이지가 지정한 window.BOARD_CAT 우선, 없으면 ?cat=, 기본 notice
function getCat() {
  if (window.BOARD_CAT && CATEGORIES[window.BOARD_CAT]) return window.BOARD_CAT;
  const c = new URLSearchParams(location.search).get("cat");
  return CATEGORIES[c] ? c : "notice";
}

let pendingFiles = []; // 작성 중 첨부 대기 목록

function loadPosts() {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY)) || [];
  } catch (e) {
    return [];
  }
}

function savePosts(posts) {
  localStorage.setItem(STORE_KEY, JSON.stringify(posts));
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

/* ===== 목록 보기 ===== */
function renderList() {
  const cat = getCat();
  const all = loadPosts().filter((p) => (p.cat || "notice") === cat);
  // 고정글은 항상 상단, 그 다음 일반글(최신순)
  const pinned = all.filter((p) => p.pinned).reverse();
  const normal = all.filter((p) => !p.pinned).reverse();

  const rowHtml = (p, numCell, pin) => {
    const clip = p.files && p.files.length
      ? `<span class="clip" title="첨부파일 ${p.files.length}개">📎${p.files.length}</span>`
      : "";
    const flag = pin ? `<span class="pin-flag">📌 공지</span> ` : "";
    return `<tr class="${pin ? "pinned-row" : ""}">
      <td>${numCell}</td>
      <td class="title">${flag}<a href="#view/${p.id}">${esc(p.title)}</a>${clip}</td>
      <td>${esc(p.author)}</td>
      <td>${p.date}</td>
      <td>${(p.files && p.files.length) || 0}</td>
    </tr>`;
  };

  let rows;
  if (all.length === 0) {
    rows = `<tr><td colspan="5" class="board-empty">등록된 게시글이 없습니다.</td></tr>`;
  } else {
    const pinnedRows = pinned.map((p) => rowHtml(p, "📌", true)).join("");
    let n = normal.length;
    const normalRows = normal.map((p) => rowHtml(p, n--, false)).join("");
    rows = pinnedRows + normalRows;
  }

  document.getElementById("app").innerHTML = `
    <div class="board-head">
      <h1>${CATEGORIES[cat]}</h1>
      <a href="#write" class="btn btn-primary btn-sm">글쓰기</a>
    </div>
    <table class="board-table">
      <thead>
        <tr><th width="60">번호</th><th>제목</th><th width="100">작성자</th><th width="110">작성일</th><th width="70">첨부</th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

/* ===== 작성 보기 ===== */
function renderWrite() {
  pendingFiles = [];
  document.getElementById("app").innerHTML = `
    <div class="board-head"><h1>${CATEGORIES[getCat()]} · 글쓰기</h1></div>
    <form class="write-form" onsubmit="submitPost(event)">
      <div class="write-row">
        <div class="label">제목</div>
        <div class="field"><input type="text" id="f-title" placeholder="제목을 입력하세요" required /></div>
      </div>
      <div class="write-row">
        <div class="label">작성자</div>
        <div class="field"><input type="text" id="f-author" placeholder="이름" required /></div>
      </div>
      <div class="write-row">
        <div class="label">자료첨부</div>
        <div class="field">
          <input type="file" id="f-files" multiple onchange="onPickFiles(event)" />
          <span class="file-hint">여러 개 선택 가능 · 파일당 최대 ${MAX_FILE_MB}MB 권장</span>
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
        <button type="submit" class="btn btn-primary btn-sm">등록</button>
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
  const files = Array.from(e.target.files);
  let remaining = files.length;
  if (remaining === 0) return;
  files.forEach((file) => {
    if (file.size > MAX_FILE_MB * 1024 * 1024) {
      alert(`"${file.name}" 은(는) ${MAX_FILE_MB}MB를 초과하여 제외됩니다.`);
      remaining--;
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      pendingFiles.push({ name: file.name, type: file.type, size: file.size, data: reader.result });
      renderFileList();
    };
    reader.readAsDataURL(file);
  });
  e.target.value = ""; // 같은 파일 다시 선택 가능하도록 초기화
}

function removeFile(i) {
  pendingFiles.splice(i, 1);
  renderFileList();
}

function submitPost(e) {
  e.preventDefault();
  const title = document.getElementById("f-title").value.trim();
  const author = document.getElementById("f-author").value.trim();
  const content = document.getElementById("f-content").value.trim();
  if (!title || !author || !content) return;

  const now = new Date();
  const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const pinEl = document.getElementById("f-pinned");
  const post = {
    id: "p" + now.getTime(),
    cat: getCat(),
    title, author, content, date,
    files: pendingFiles.slice(),
    pinned: !!(pinEl && pinEl.checked),
  };
  const posts = loadPosts();
  posts.push(post);
  try {
    savePosts(posts);
  } catch (err) {
    alert("저장 공간이 부족합니다. 첨부파일 용량을 줄여주세요.");
    return;
  }
  location.hash = "#view/" + post.id;
}

/* ===== 상세 보기 ===== */
function renderView(id) {
  const posts = loadPosts();
  const p = posts.find((x) => x.id === id);
  if (!p) {
    location.hash = "#list";
    return;
  }
  const attach = (p.files && p.files.length)
    ? `<div class="view-attach"><strong>📎 첨부파일</strong>${p.files
        .map((f) => `<a href="${f.data}" download="${esc(f.name)}">${esc(f.name)} (${fmtSize(f.size)})</a>`)
        .join("")}</div>`
    : "";

  const admin = typeof isAdmin === "function" && isAdmin();
  const pinBtn = admin
    ? `<button type="button" class="btn btn-outline btn-sm" onclick="togglePin('${p.id}')">${p.pinned ? "고정 해제" : "상단 고정"}</button>`
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
    <div class="btn-row">
      <a href="#list" class="btn btn-outline btn-sm">목록</a>
      ${pinBtn}
      <button type="button" class="btn btn-primary btn-sm" onclick="deletePost('${p.id}')">삭제</button>
    </div>`;
}

function togglePin(id) {
  if (!(typeof isAdmin === "function" && isAdmin())) return;
  const posts = loadPosts();
  const p = posts.find((x) => x.id === id);
  if (p) {
    p.pinned = !p.pinned;
    savePosts(posts);
    renderView(id);
  }
}

function deletePost(id) {
  if (!confirm("이 게시글을 삭제하시겠습니까?")) return;
  savePosts(loadPosts().filter((p) => p.id !== id));
  location.hash = "#list";
}

/* 현재 카테고리에 해당하는 사이드바 메뉴 활성화 */
function highlightSidebar() {
  const cat = getCat();
  document.querySelectorAll(".sidebar a").forEach((a) => {
    a.classList.toggle("active", a.getAttribute("href") === "board.html?cat=" + cat);
  });
}

// 특별회원 전용 카테고리 (공지사항·자료실·결산보고서·월간회의록·회원게시판)
const PROTECTED_CATS = ["notice", "data", "report", "minutes"];

/* ===== 해시 라우터 ===== */
function route() {
  highlightSidebar();
  // 보호 카테고리는 특별회원만 접근 가능
  if (PROTECTED_CATS.includes(getCat()) && typeof isSpecial === "function" && !isSpecial()) {
    return guardSpecial("app");
  }
  const hash = location.hash || "#list";
  if (hash === "#write") return renderWrite();
  if (hash.startsWith("#view/")) return renderView(hash.slice(6));
  return renderList();
}

window.addEventListener("hashchange", route);
window.addEventListener("DOMContentLoaded", route);
