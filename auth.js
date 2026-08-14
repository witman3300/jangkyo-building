// auth.js - 회원 / 등급 / 승인 / 관리자 (백엔드 없는 데모, 브라우저 저장소 기반)
// 회원 목록은 localStorage, 로그인 세션은 sessionStorage 에 보관

const USERS_KEY = "jangkyo_users";
const SESSION_KEY = "jangkyo_session";

// 등급 정의
const GRADES = { normal: "일반회원", special: "특별회원", admin: "관리자" };
function gradeLabel(g) {
  return GRADES[g] || g;
}

// 바로 테스트할 수 있는 기본 제공 계정 (모두 승인 완료 상태)
const DEFAULT_USERS = [
  { id: "admin", pw: "admin", name: "관리자", grade: "admin", approved: true, requestedSpecial: false },
  { id: "special", pw: "1234", name: "특별회원", grade: "special", approved: true, requestedSpecial: false },
  { id: "user", pw: "1234", name: "일반회원", grade: "normal", approved: true, requestedSpecial: false },
];

function getUsers() {
  let list;
  try {
    list = JSON.parse(localStorage.getItem(USERS_KEY));
  } catch (e) {}
  if (!Array.isArray(list)) list = [];

  // 필수 필드 정규화 (옛 스키마 호환)
  list.forEach((u) => {
    if (!u.grade) u.grade = u.special ? "special" : "normal";
    if (typeof u.approved !== "boolean") u.approved = false;
    delete u.special;
  });

  // 기본 계정은 항상 존재 + 올바른 값 보장 (admin 로그인 보장)
  DEFAULT_USERS.forEach((d) => {
    const found = list.find((u) => u.id === d.id);
    if (found) Object.assign(found, d);
    else list.push({ ...d });
  });
  return list;
}

function saveUsers(list) {
  localStorage.setItem(USERS_KEY, JSON.stringify(list));
}

// 회원가입: 중복 아이디면 false. 신규 회원은 항상 '승인 대기 + 일반회원'으로 시작
function registerUser(user) {
  const list = getUsers();
  if (list.some((u) => u.id === user.id)) return false;
  list.push({
    id: user.id,
    pw: user.pw,
    name: user.name,
    email: user.email || "",
    grade: "normal", // 등급은 관리자가 부여
    approved: false, // 관리자 승인 전까지 로그인 불가
    requestedSpecial: !!user.requestedSpecial, // 특별회원 신청 여부
  });
  saveUsers(list);
  return true;
}

// 로그인: { ok, reason } 형태 반환. 승인 전 계정은 reason:'pending'
function loginUser(id, pw) {
  const u = getUsers().find((x) => x.id === id && x.pw === pw);
  if (!u) return { ok: false, reason: "invalid" };
  if (!u.approved) return { ok: false, reason: "pending" };
  const sess = { id: u.id, name: u.name, grade: u.grade, approved: true };
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(sess));
  return { ok: true, session: sess };
}

function getSession() {
  try {
    return JSON.parse(sessionStorage.getItem(SESSION_KEY));
  } catch (e) {
    return null;
  }
}

function logoutUser() {
  sessionStorage.removeItem(SESSION_KEY);
}

function isLoggedIn() {
  return !!getSession();
}

function isAdmin() {
  const s = getSession();
  return !!(s && s.grade === "admin");
}

// 특별회원 권한: 특별회원 또는 관리자 (모두 승인된 상태)
function isSpecial() {
  const s = getSession();
  return !!(s && (s.grade === "special" || s.grade === "admin"));
}

/* ===== 관리자 기능 ===== */
function adminApprove(id, approved) {
  const list = getUsers();
  const u = list.find((x) => x.id === id);
  if (u) {
    u.approved = approved;
    saveUsers(list);
  }
}

function adminSetGrade(id, grade) {
  if (!GRADES[grade]) return;
  const list = getUsers();
  const u = list.find((x) => x.id === id);
  if (u) {
    u.grade = grade;
    saveUsers(list);
  }
}

function adminDeleteUser(id) {
  saveUsers(getUsers().filter((x) => x.id !== id));
}

// ===== 토스트 메시지 (alert() 대체용, 모든 페이지 공통) =====
function showToast(message, duration) {
  duration = duration || 2800;
  let container = document.getElementById("toast-container");
  if (!container) {
    container = document.createElement("div");
    container.id = "toast-container";
    document.body.appendChild(container);
  }
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  container.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add("show"));
  setTimeout(() => {
    toast.classList.remove("show");
    toast.addEventListener("transitionend", () => toast.remove(), { once: true });
  }, duration);
}

function escAuth(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;",
  })[c]);
}

// 특별회원 전용 가드
function guardSpecial(targetId) {
  if (isSpecial()) return true;
  const el = document.getElementById(targetId);
  if (el) {
    const s = getSession();
    const sub = s
      ? `현재 <strong>${escAuth(s.name)}</strong> 님은 ${gradeLabel(s.grade)}입니다.`
      : `로그인이 필요합니다.`;
    el.innerHTML = `<div class="lock-box">
      <div class="lock-icon">🔒</div>
      <h2>특별회원 전용 메뉴</h2>
      <p>이 게시판은 <strong>특별회원</strong>만 이용할 수 있습니다.<br />${sub}</p>
      <div class="btn-row">
        <a href="login.html" class="btn btn-primary btn-sm">로그인</a>
        <a href="signup.html" class="btn btn-outline btn-sm">회원가입</a>
      </div>
    </div>`;
  }
  return false;
}

// 관리자 전용 가드
function guardAdmin(targetId) {
  if (isAdmin()) return true;
  const el = document.getElementById(targetId);
  if (el) {
    el.innerHTML = `<div class="lock-box">
      <div class="lock-icon">🔒</div>
      <h2>관리자 전용</h2>
      <p>관리자만 접근할 수 있는 페이지입니다.</p>
      <div class="btn-row">
        <a href="login.html" class="btn btn-primary btn-sm">관리자 로그인</a>
      </div>
    </div>`;
  }
  return false;
}

// 상단 유틸바의 로그인 상태 표시
function renderAuthStatus() {
  const box = document.getElementById("auth-status");
  if (!box) return;
  const s = getSession();
  if (s) {
    const adminLink = s.grade === "admin"
      ? `<a href="admin.html">회원관리</a><span class="divider">|</span>`
      : "";
    const star = s.grade === "special" ? " ⭐" : s.grade === "admin" ? " 🛠" : "";
    box.innerHTML = `<span class="welcome">${escAuth(s.name)}님(${gradeLabel(s.grade)})${star}</span>
      <span class="divider">|</span>
      ${adminLink}
      <a href="#" onclick="logoutUser();location.reload();return false;">로그아웃</a>`;
  } else {
    box.innerHTML = `<a href="login.html">로그인</a>
      <span class="divider">|</span>
      <a href="signup.html">회원가입</a>`;
  }
}

window.addEventListener("DOMContentLoaded", renderAuthStatus);

// ===== 좌측 사이드 메뉴 드로어 (햄버거 토글) =====
// 모든 페이지 공통으로 햄버거 버튼/오버레이를 주입한다 (페이지별 HTML 수정 불필요)
function setupSidebarDrawer() {
  const navbar = document.querySelector(".navbar");
  const brand = navbar && navbar.querySelector(".brand");
  const sidebar = document.querySelector(".sidebar");
  if (!navbar || !brand || !sidebar) return;

  // 햄버거 버튼
  const btn = document.createElement("button");
  btn.className = "hamburger";
  btn.type = "button";
  btn.setAttribute("aria-label", "메뉴 열기");
  btn.setAttribute("aria-expanded", "false");
  btn.innerHTML = "<span></span><span></span><span></span>";

  // 좌상단 그룹(햄버거 + 브랜드)으로 묶기
  const left = document.createElement("div");
  left.className = "nav-left";
  navbar.insertBefore(left, brand);
  left.appendChild(btn);
  left.appendChild(brand);

  // 드로어 닫기(×) 버튼
  const closeBtn = document.createElement("button");
  closeBtn.className = "sidebar-close";
  closeBtn.type = "button";
  closeBtn.setAttribute("aria-label", "메뉴 닫기");
  closeBtn.innerHTML = "&times;";
  sidebar.insertBefore(closeBtn, sidebar.firstChild);

  // 어두운 배경 오버레이
  const overlay = document.createElement("div");
  overlay.className = "sidebar-overlay";
  document.body.appendChild(overlay);

  function open() {
    document.body.classList.add("sidebar-open");
    btn.setAttribute("aria-expanded", "true");
    btn.setAttribute("aria-label", "메뉴 닫기");
  }
  function close() {
    document.body.classList.remove("sidebar-open");
    btn.setAttribute("aria-expanded", "false");
    btn.setAttribute("aria-label", "메뉴 열기");
  }

  btn.addEventListener("click", function () {
    document.body.classList.contains("sidebar-open") ? close() : open();
  });
  closeBtn.addEventListener("click", close);
  overlay.addEventListener("click", close);
  // 사이드바 메뉴 링크 클릭 시 닫기
  sidebar.addEventListener("click", function (e) {
    if (e.target.closest("a")) close();
  });
  // ESC 로 닫기
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") close();
  });
}

window.addEventListener("DOMContentLoaded", setupSidebarDrawer);

// ===== 상단 메뉴 슬라이더 (모바일에서 좌우 화살표로 슬라이드) =====
function setupMenuSlider() {
  const navbar = document.querySelector(".navbar");
  const menu = navbar && navbar.querySelector(".menu");
  if (!navbar || !menu) return;

  // 슬라이더 래퍼로 감싸고 좌우 화살표 추가
  const slider = document.createElement("div");
  slider.className = "menu-slider";
  menu.parentNode.insertBefore(slider, menu);

  const prev = document.createElement("button");
  prev.type = "button";
  prev.className = "menu-arrow menu-prev";
  prev.setAttribute("aria-label", "이전 메뉴");
  prev.innerHTML = "&#8249;"; // ‹

  const next = document.createElement("button");
  next.type = "button";
  next.className = "menu-arrow menu-next";
  next.setAttribute("aria-label", "다음 메뉴");
  next.innerHTML = "&#8250;"; // ›

  slider.appendChild(prev);
  slider.appendChild(menu);
  slider.appendChild(next);

  function step() {
    return Math.max(120, Math.round(menu.clientWidth * 0.7));
  }
  prev.addEventListener("click", function () {
    menu.scrollBy({ left: -step(), behavior: "smooth" });
  });
  next.addEventListener("click", function () {
    menu.scrollBy({ left: step(), behavior: "smooth" });
  });

  // 양 끝에서 화살표 비활성화
  function updateArrows() {
    const max = menu.scrollWidth - menu.clientWidth;
    prev.disabled = menu.scrollLeft <= 1;
    next.disabled = menu.scrollLeft >= max - 1;
  }
  menu.addEventListener("scroll", updateArrows, { passive: true });
  window.addEventListener("resize", updateArrows);
  updateArrows();
}

window.addEventListener("DOMContentLoaded", setupMenuSlider);

// ===== 관리자 본문 수정 (백엔드 없이 localStorage에 페이지별로 저장) =====
function setupContentEdit() {
  const mainEl = document.querySelector("main.about-body");
  if (!mainEl) return;

  const pageKey = "jangkyo_content::" + location.pathname.split("/").pop();

  // 본문을 별도 영역으로 감싸서 툴바는 편집 대상에서 제외
  const area = document.createElement("div");
  area.className = "content-editable-area";
  while (mainEl.firstChild) area.appendChild(mainEl.firstChild);
  mainEl.appendChild(area);

  // 저장된 수정 내용이 있으면 원본 대신 표시 (모든 방문자 공통)
  const saved = localStorage.getItem(pageKey);
  if (saved) area.innerHTML = saved;

  if (!isAdmin()) return;

  const toolbar = document.createElement("div");
  toolbar.className = "content-edit-toolbar";

  const editBtn = document.createElement("button");
  editBtn.type = "button";
  editBtn.className = "btn btn-outline btn-sm";
  editBtn.textContent = "✎ 내용 수정";

  const saveBtn = document.createElement("button");
  saveBtn.type = "button";
  saveBtn.className = "btn btn-primary btn-sm";
  saveBtn.textContent = "💾 저장";
  saveBtn.style.display = "none";

  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "btn btn-outline btn-sm";
  cancelBtn.textContent = "취소";
  cancelBtn.style.display = "none";

  const resetBtn = document.createElement("button");
  resetBtn.type = "button";
  resetBtn.className = "btn btn-outline btn-sm";
  resetBtn.textContent = "원본으로 복원";
  resetBtn.style.display = saved ? "" : "none";

  toolbar.appendChild(editBtn);
  toolbar.appendChild(saveBtn);
  toolbar.appendChild(cancelBtn);
  toolbar.appendChild(resetBtn);
  mainEl.insertBefore(toolbar, area);

  let originalHTML = null;

  editBtn.addEventListener("click", function () {
    originalHTML = area.innerHTML;
    area.contentEditable = "true";
    area.classList.add("editing");
    area.focus();
    editBtn.style.display = "none";
    saveBtn.style.display = "";
    cancelBtn.style.display = "";
  });

  saveBtn.addEventListener("click", function () {
    area.contentEditable = "false";
    area.classList.remove("editing");
    localStorage.setItem(pageKey, area.innerHTML);
    editBtn.style.display = "";
    saveBtn.style.display = "none";
    cancelBtn.style.display = "none";
    resetBtn.style.display = "";
  });

  cancelBtn.addEventListener("click", function () {
    area.innerHTML = originalHTML;
    area.contentEditable = "false";
    area.classList.remove("editing");
    editBtn.style.display = "";
    saveBtn.style.display = "none";
    cancelBtn.style.display = "none";
  });

  resetBtn.addEventListener("click", function () {
    if (!confirm("수정 내용을 지우고 원래 페이지 내용으로 되돌릴까요?")) return;
    localStorage.removeItem(pageKey);
    location.reload();
  });
}

window.addEventListener("DOMContentLoaded", setupContentEdit);

// ===== PWA: 모바일 홈 화면 설치 지원 =====
// 모든 페이지가 auth.js를 로드하므로, 여기서 한 번만 매니페스트/아이콘을 주입한다.
function setupPWA() {
  const head = document.head;

  const addLink = (rel, href, extra) => {
    if (document.querySelector(`link[rel="${rel}"]`)) return;
    const l = document.createElement("link");
    l.rel = rel;
    l.href = href;
    if (extra) Object.assign(l, extra);
    head.appendChild(l);
  };
  const addMeta = (name, content) => {
    if (document.querySelector(`meta[name="${name}"]`)) return;
    const m = document.createElement("meta");
    m.name = name;
    m.content = content;
    head.appendChild(m);
  };

  addLink("manifest", "manifest.json");
  addLink("icon", "icons/favicon-32.png");
  addLink("apple-touch-icon", "icons/apple-touch-icon.png");
  addMeta("theme-color", "#1a2744");
  addMeta("mobile-web-app-capable", "yes");
  addMeta("apple-mobile-web-app-capable", "yes");
  addMeta("apple-mobile-web-app-status-bar-style", "black-translucent");
  addMeta("apple-mobile-web-app-title", "장교빌딩");

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
}

window.addEventListener("DOMContentLoaded", setupPWA);
