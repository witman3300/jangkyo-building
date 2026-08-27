// auth.js - 회원 / 등급 / 승인 / 관리자 (Firebase Authentication + Firestore 기반)
// 로그인 세션은 Firebase Auth가 관리하고, 등급/승인 상태 등 프로필은 Firestore(users 컬렉션)에 보관한다.
// 비밀번호는 Firebase Auth에만 저장되며 이 앱 코드/DB 어디에도 평문으로 남지 않는다.

// ===== Firebase SDK 로드 (모든 페이지 공통) =====
// createElement로 순서를 보장하며 3개 스크립트를 비동기 로드한다 (async=false 로 실행 순서 고정).
// 로드가 끝나기 전까지 fbAuth/db는 undefined이므로, 이를 사용하는 함수는 반드시 window.authReady를
// 먼저 기다려야 한다 (아래 registerUser/loginUser 등은 내부에서 이미 기다린다).
var fbAuth, db;
var _sdkLoadedResolve;
var _sdkLoaded = new Promise(function (resolve) {
  _sdkLoadedResolve = resolve;
});
(function loadFirebaseSDK() {
  var firebaseConfig = {
    apiKey: "AIzaSyDOL0q9yugEQbyDOsQkdmz4zfh5Qaf0C8U",
    authDomain: "jangkyo-building.firebaseapp.com",
    projectId: "jangkyo-building",
    storageBucket: "jangkyo-building.firebasestorage.app",
    messagingSenderId: "791708703483",
    appId: "1:791708703483:web:5433034b25ffd4d3dfee5e",
  };
  var v = "10.13.2";
  var base = "https://www.gstatic.com/firebasejs/" + v + "/";
  var files = ["firebase-app-compat.js", "firebase-auth-compat.js", "firebase-firestore-compat.js"];
  var loaded = 0;
  files.forEach(function (f) {
    var s = document.createElement("script");
    s.src = base + f;
    s.async = false; // 로드는 병렬로 하되, 실행 순서는 삽입 순서대로 고정 (app -> auth -> firestore)
    s.onload = function () {
      loaded++;
      if (loaded === files.length) {
        firebase.initializeApp(firebaseConfig);
        fbAuth = firebase.auth();
        db = firebase.firestore();
        _sdkLoadedResolve();
      }
    };
    document.head.appendChild(s);
  });
})();

var USERS_COL = "users"; // uid를 문서ID로 하는 회원 프로필
var USERNAMES_COL = "usernames"; // 아이디(로그인용) -> {uid, email} 공개 조회용 (로그인 전 이메일 조회에 필요)
var EMAILS_COL = "emails"; // 이메일 -> {id} 공개 조회용 (아이디 찾기에 필요, 이메일을 정확히 아는 사람만 조회 가능)

// 등급 정의
var GRADES = { normal: "일반회원", special: "특별회원", admin: "관리자" };
function gradeLabel(g) {
  return GRADES[g] || g;
}

function userDocRef(uid) {
  return db.collection(USERS_COL).doc(uid);
}
function usernameDocRef(id) {
  return db.collection(USERNAMES_COL).doc(id);
}
function emailDocRef(email) {
  return db.collection(EMAILS_COL).doc(email.toLowerCase());
}

// 휴대폰번호 형식 검증 (010-0000-0000 형태, 하이픈 없어도 허용)
function isValidPhone(phone) {
  return /^01[016789]-?\d{3,4}-?\d{4}$/.test(String(phone || "").trim());
}

/* ===== 로그인 세션 (Firebase onAuthStateChanged 로 갱신되는 캐시) =====
   getSession()/isLoggedIn()/isAdmin()/isSpecial() 은 동기 함수로 유지한다 (기존 페이지 코드 호환).
   대신 페이지가 이 값들을 사용하기 전에 반드시 window.authReady 를 기다려야 한다. */
var _session = null;
var _authReadyResolve;
window.authReady = new Promise(function (resolve) {
  _authReadyResolve = resolve;
});

// DOMContentLoaded + authReady 를 함께 기다린 뒤 fn을 실행하는 헬퍼 (다른 파일에서도 사용)
window.onAuthReady = function (fn) {
  function run() {
    window.authReady.then(fn);
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", run);
  } else {
    run();
  }
};

function getSession() {
  return _session;
}
function isLoggedIn() {
  return !!_session;
}
function isAdmin() {
  return !!(_session && _session.grade === "admin");
}
// 특별회원 권한: 특별회원 또는 관리자 (모두 승인된 상태)
function isSpecial() {
  return !!(_session && (_session.grade === "special" || _session.grade === "admin"));
}

_sdkLoaded.then(function () {
  fbAuth.onAuthStateChanged(function (user) {
    var next;
    if (!user) {
      next = Promise.resolve(null);
    } else {
      next = userDocRef(user.uid)
        .get()
        .then(function (snap) {
          if (!snap.exists || !snap.data().approved) return null;
          var p = snap.data();
          return { id: p.id, name: p.name, grade: p.grade, approved: true, uid: user.uid, phone: p.phone || "" };
        })
        .catch(function () {
          return null;
        });
    }
    next.then(function (sess) {
      _session = sess;
      if (_authReadyResolve) {
        _authReadyResolve();
        _authReadyResolve = null;
      }
      renderAuthStatus();
      document.dispatchEvent(new CustomEvent("authchange"));
    });
  });
});

/* ===== 회원가입 =====
   user: {id, pw, name, email, phone, unit, company, requestedSpecial}
   반환: {ok:true} 또는 {ok:false, reason: "phone"|"id"|"auth"|"profile", message?} */
async function registerUser(user) {
  await _sdkLoaded;
  if (!isValidPhone(user.phone)) return { ok: false, reason: "phone" };

  var takenSnap = await usernameDocRef(user.id).get();
  if (takenSnap.exists) return { ok: false, reason: "id" };

  var cred;
  try {
    cred = await fbAuth.createUserWithEmailAndPassword(user.email, user.pw);
  } catch (e) {
    return { ok: false, reason: "auth", message: e.message, code: e.code };
  }

  var uid = cred.user.uid;
  var approved = !user.requestedSpecial; // 일반회원은 즉시 승인, 입주자·구분소유자는 관리사무소 승인대기
  var profile = {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: String(user.phone).trim(),
    unit: user.unit || "",
    company: user.company || "",
    grade: "normal",
    approved: approved,
    requestedSpecial: !!user.requestedSpecial,
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
  };

  try {
    var batch = db.batch();
    batch.set(userDocRef(uid), profile);
    batch.set(usernameDocRef(user.id), { uid: uid, email: user.email });
    batch.set(emailDocRef(user.email), { id: user.id });
    await batch.commit();
  } catch (e) {
    return { ok: false, reason: "profile", message: e.message };
  }

  return { ok: true, approved: approved };
}

/* ===== 로그인: { ok, reason } 형태 반환. 승인 전 계정은 reason:'pending' ===== */
async function loginUser(id, pw) {
  await _sdkLoaded;
  var unameSnap;
  try {
    unameSnap = await usernameDocRef(id).get();
  } catch (e) {
    return { ok: false, reason: "invalid" };
  }
  if (!unameSnap.exists) return { ok: false, reason: "invalid" };
  var email = unameSnap.data().email;

  var cred;
  try {
    cred = await fbAuth.signInWithEmailAndPassword(email, pw);
  } catch (e) {
    return { ok: false, reason: "invalid" };
  }

  var uid = cred.user.uid;
  var profSnap = await userDocRef(uid).get();
  if (!profSnap.exists) {
    await fbAuth.signOut();
    return { ok: false, reason: "invalid" };
  }
  var p = profSnap.data();
  if (!p.approved) {
    await fbAuth.signOut();
    return { ok: false, reason: "pending" };
  }
  var sess = { id: p.id, name: p.name, grade: p.grade, approved: true, uid: uid, phone: p.phone || "" };
  _session = sess;
  return { ok: true, session: sess };
}

// 휴대폰번호 등록/수정 (로그인 시 미입력 회원에게 입력을 요구할 때 사용)
async function setUserPhone(uid, phone) {
  await _sdkLoaded;
  if (!isValidPhone(phone)) return false;
  try {
    await userDocRef(uid).update({ phone: String(phone).trim() });
    if (_session && _session.uid === uid) _session.phone = String(phone).trim();
    return true;
  } catch (e) {
    return false;
  }
}

// 휴대폰번호 미입력 계정에게 로그인 직후 입력을 강제하는 팝업.
// 휴대폰번호가 이미 등록돼 있으면 팝업 없이 바로 onComplete를 실행한다.
function ensurePhoneThenProceed(id, onComplete) {
  var s = _session;
  if (!s || isValidPhone(s.phone)) {
    if (onComplete) onComplete();
    return;
  }
  promptForPhone(s.uid, onComplete);
}

function promptForPhone(uid, onComplete) {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="card modal-card">
      <h2>휴대폰번호 등록</h2>
      <p class="subtitle">서비스 이용을 위해 휴대폰번호 등록이 필요합니다.</p>
      <form>
        <div class="form-group">
          <label>휴대폰번호</label>
          <input type="text" id="phone-modal-input" placeholder="010-0000-0000" autocomplete="tel" />
        </div>
        <div class="hint-err" id="phone-modal-err"></div>
        <button type="submit" class="btn btn-primary btn-block">등록하고 계속하기</button>
      </form>
    </div>`;
  document.body.appendChild(overlay);

  const form = overlay.querySelector("form");
  const input = overlay.querySelector("#phone-modal-input");
  const err = overlay.querySelector("#phone-modal-err");
  input.focus();

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const v = input.value.trim();
    if (!isValidPhone(v)) {
      err.textContent = "올바른 휴대폰번호 형식으로 입력해 주세요. (예: 010-1234-5678)";
      err.classList.add("show");
      return;
    }
    await setUserPhone(uid, v);
    overlay.remove();
    if (onComplete) onComplete();
  });
}

function logoutUser() {
  return fbAuth.signOut().then(function () {
    _session = null;
  });
}

/* ===== 관리자 기능 (모두 Firestore users/{uid} 문서를 직접 조작, uid 필요) ===== */
async function adminApprove(uid, approved) {
  await userDocRef(uid).update({ approved: approved });
}

async function adminSetGrade(uid, grade) {
  if (!GRADES[grade]) return;
  await userDocRef(uid).update({ grade: grade });
}

// 주의: Firestore 프로필만 삭제된다. Firebase Auth 계정 자체 삭제는 Admin SDK(서버)가 있어야 가능하므로
// 클라이언트에서는 지원하지 않는다. 프로필이 없으면 로그인해도 승인되지 않은 것으로 처리되어 접근이 막힌다.
async function adminDeleteUser(uid) {
  await userDocRef(uid).delete();
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
      <a href="#" onclick="logoutUser().then(function(){location.reload();});return false;">로그아웃</a>`;
  } else {
    box.innerHTML = `<a href="login.html">로그인</a>
      <span class="divider">|</span>
      <a href="signup.html">회원가입</a>`;
  }
}

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

window.onAuthReady(setupContentEdit);

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
