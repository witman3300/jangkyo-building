// auth.js - 회원 / 등급 / 승인 / 관리자 (Firebase Authentication + Firestore 기반)
// 로그인 세션은 Firebase Auth가 관리하고, 등급/승인 상태 등 프로필은 Firestore(users 컬렉션)에 보관한다.
// 비밀번호는 Firebase Auth에만 저장되며 이 앱 코드/DB 어디에도 평문으로 남지 않는다.

// ===== Firebase SDK 로드 (모든 페이지 공통) =====
// createElement로 순서를 보장하며 3개 스크립트를 비동기 로드한다 (async=false 로 실행 순서 고정).
// 로드가 끝나기 전까지 fbAuth/db는 undefined이므로, 이를 사용하는 함수는 반드시 window.authReady를
// 먼저 기다려야 한다 (아래 registerUser/loginUser 등은 내부에서 이미 기다린다).
var fbAuth, db, fbStorage;
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
  // storage: 게시판 첨부파일을 Firebase Storage에 올리는 데 사용한다 (Firestore 문서는 1MB 제한).
  var files = [
    "firebase-app-compat.js",
    "firebase-auth-compat.js",
    "firebase-firestore-compat.js",
    "firebase-storage-compat.js",
  ];
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
        fbStorage = firebase.storage();
        _sdkLoadedResolve();
      }
    };
    document.head.appendChild(s);
  });
})();

/* 구회원 아이디 선점 (janggyo.co.kr 구 사이트 회원 명단).
   구회원은 이메일·비밀번호가 남아 있지 않아 계정을 대신 만들어 줄 수 없다. 대신 아이디를
   미리 등록해 두고, 본인 아이디로 가입하면 기존 회원으로 알아보고 승인 없이 바로 이용하게 한다.
   문서ID = 구회원 아이디, 내용 = { unit }. 이름은 담지 않는다.
   아이디를 정확히 아는 사람만 단건 조회(get)할 수 있고 목록 나열(list)은 막혀 있어
   전체 회원 아이디를 긁어갈 수 없다. */
var LEGACY_COL = "legacyMembers";

function legacyMemberDocRef(id) {
  return db.collection(LEGACY_COL).doc(id);
}

// 구회원 명단에 있는 아이디인지 확인한다. 있으면 { unit }, 없으면 null.
async function findLegacyMember(id) {
  await _sdkLoaded;
  var key = String(id || "").trim();
  if (!key) return null;
  try {
    var snap = await legacyMemberDocRef(key).get();
    return snap.exists ? snap.data() || {} : null;
  } catch (e) {
    return null; // 조회에 실패하면 일반 가입 절차로 진행한다
  }
}
window.findLegacyMember = findLegacyMember;

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

  /* 승인 정책
     - 구회원(구 사이트 명단에 있는 아이디): 이미 확인된 회원이므로 승인 없이 일반회원으로 바로 이용.
       특별회원 부여가 필요하면 관리사무소가 회원관리 화면에서 처리한다.
     - 신규 가입자: 일반회원이든 특별회원이든 관리자 승인 후 로그인할 수 있다. */
  var legacy = await findLegacyMember(user.id);
  var requestedSpecial = !!user.requestedSpecial && !legacy;
  var approved = !!legacy;

  var profile = {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: String(user.phone).trim(),
    birth: user.birth || "",
    gender: user.gender || "",
    unit: user.unit || (legacy && legacy.unit) || "",
    company: user.company || "",
    grade: "normal",
    approved: approved,
    requestedSpecial: requestedSpecial,
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    // 가입과 동시에 로그인되므로 최근 로그인도 이 시각으로 시작한다
    lastLoginAt: firebase.firestore.FieldValue.serverTimestamp(),
  };
  if (legacy) profile.legacy = true; // 구 사이트 회원이 아이디를 되찾은 계정

  try {
    var batch = db.batch();
    batch.set(userDocRef(uid), profile);
    batch.set(usernameDocRef(user.id), { uid: uid, email: user.email });
    batch.set(emailDocRef(user.email), { id: user.id });
    await batch.commit();
  } catch (e) {
    return { ok: false, reason: "profile", message: e.message };
  }

  return { ok: true, approved: approved, legacy: !!legacy };
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
  // 최근 로그인 시각을 남긴다 (회원관리 화면의 "최근로그인" 값이 저절로 갱신된다).
  // 실패해도 로그인 자체는 그대로 진행한다.
  userDocRef(uid)
    .update({ lastLoginAt: firebase.firestore.FieldValue.serverTimestamp() })
    .catch(function () {});

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

// 마이페이지: 로그인한 본인의 전체 프로필 조회 (이메일 등 세션에 없는 값 포함)
async function getMyProfile() {
  await _sdkLoaded;
  if (!_session) return null;
  var snap = await userDocRef(_session.uid).get();
  return snap.exists ? Object.assign({ uid: _session.uid }, snap.data()) : null;
}

// 마이페이지: 본인 프로필 수정 (이름/호수/회사명/휴대전화만 허용 — 등급·승인·아이디·이메일은 여기서 못 바꾼다)
// patch: {name, phone, unit, company}
async function updateMyProfile(patch) {
  await _sdkLoaded;
  if (!_session) return { ok: false, reason: "invalid" };
  if (!patch.name || !patch.name.trim()) return { ok: false, reason: "name" };
  if (!isValidPhone(patch.phone)) return { ok: false, reason: "phone" };
  var data = {
    name: patch.name.trim(),
    phone: String(patch.phone).trim(),
    unit: (patch.unit || "").trim(),
    company: (patch.company || "").trim(),
  };
  try {
    await userDocRef(_session.uid).update(data);
    _session.name = data.name;
    _session.phone = data.phone;
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: "save", message: e.message };
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

/* 특별회원 신청 승인: 등급을 특별회원으로 올리고, 계정 승인까지 함께 처리한다.
   신청 표시는 처리했으므로 내린다. (거절은 신청 표시만 내리고 등급은 그대로 둔다) */
async function adminApproveSpecial(uid, accept) {
  var patch = { requestedSpecial: false };
  if (accept) {
    patch.grade = "special";
    patch.approved = true;
  }
  await userDocRef(uid).update(patch);
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
      <a href="myinfo.html">내 정보 수정</a>
      <span class="divider">|</span>
      ${adminLink}
      <a href="#" onclick="logoutUser().then(function(){location.reload();});return false;">로그아웃</a>`;
  } else {
    box.innerHTML = `<a href="login.html">로그인</a>`;
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

  // 메뉴가 넘치지 않으면 화살표를 감춰 메뉴가 한 화면에 모두 보이도록.
  // 화살표 자체가 폭을 차지하므로, 감춘 상태에서 넘침 여부를 판정한다.
  function updateFit() {
    slider.classList.add("no-overflow");
    const fits = menu.scrollWidth - menu.clientWidth <= 4; // 소수점 반올림 오차 허용
    slider.classList.toggle("no-overflow", fits);
    updateArrows();
  }
  menu.addEventListener("scroll", updateArrows, { passive: true });
  window.addEventListener("resize", updateFit);
  updateFit();
  // 웹폰트 적용 후 글자 폭이 바뀌므로 다시 판정
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(updateFit);
  window.addEventListener("load", updateFit);
}

window.addEventListener("DOMContentLoaded", setupMenuSlider);

/* ===== 관리자 본문 수정 (Firestore pages 컬렉션에 저장) =====
   예전에는 수정 내용을 localStorage에 넣었는데, 그러면 (1) 수정한 사람의 브라우저에만 남아
   다른 방문자에게는 안 보이고, (2) 그 브라우저에서는 저장본이 매번 원본 HTML을 덮어써서
   파일을 고쳐 배포해도 계속 예전 화면이 보였다("원상복구" 증상).
   이제는 Firestore에 저장해 모든 방문자에게 공통으로 반영하고, 저장 당시 원본 HTML의 지문을
   함께 기록한다. 배포로 원본이 바뀌면 지문이 달라지므로 예전 수정본은 적용하지 않고
   새로 배포한 내용을 그대로 보여준다. */
const PAGES_COL = "pages";
const LEGACY_CONTENT_PREFIX = "jangkyo_content::"; // 옛 localStorage 방식의 키 (정리 대상)

function currentPageKey() {
  return location.pathname.split("/").pop() || "index.html";
}

// 원본 HTML의 지문(FNV-1a 32bit + 길이). 배포로 파일이 바뀌면 값이 달라진다.
function contentFingerprint(html) {
  const s = String(html).replace(/\s+/g, " ").trim();
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16) + "-" + s.length;
}

function pageDocRef(pageKey) {
  return db.collection(PAGES_COL).doc(pageKey);
}

async function setupContentEdit() {
  const mainEl = document.querySelector("main.about-body");
  if (!mainEl) return;

  const pageKey = currentPageKey();

  // 본문을 별도 영역으로 감싸서 툴바는 편집 대상에서 제외
  const area = document.createElement("div");
  area.className = "content-editable-area";
  while (mainEl.firstChild) area.appendChild(mainEl.firstChild);
  mainEl.appendChild(area);

  // 지문과 원본 HTML은 반드시 "배포된 상태"에서 확보한다 (저장본을 적용하기 전).
  const deployedHTML = area.innerHTML;
  const baseHash = contentFingerprint(deployedHTML);

  // 옛 localStorage 저장본은 이 브라우저에서만 새 배포를 가리는 원인이므로 지운다.
  try {
    localStorage.removeItem(LEGACY_CONTENT_PREFIX + pageKey);
  } catch (e) {
    /* 저장소 접근이 막힌 브라우저는 무시 */
  }

  let saved = null;
  try {
    const snap = await pageDocRef(pageKey).get();
    if (snap.exists) saved = snap.data();
  } catch (e) {
    /* 읽기 실패 시에는 배포된 원본을 그대로 보여준다 */
  }

  // 저장본이 있어도, 그 뒤에 페이지가 새로 배포됐다면(지문 불일치) 적용하지 않는다.
  const stale = !!(saved && saved.baseHash !== baseHash);
  let applied = !!saved && !stale;
  if (applied) area.innerHTML = saved.html;

  // 페이지별 스크립트(공실 추가·서식 업로드 등)가 이 시점 이후에 DOM을 다루도록 알린다.
  const notifyReady = () => document.dispatchEvent(new CustomEvent("contentready"));

  /* 다른 PC에서 관리자가 저장하면 새로고침 없이 이 화면에도 바로 반영한다.
     편집 중일 때는 덮어쓰지 않고, 편집을 끝낸 뒤에 적용한다. */
  let editing = false;
  let pendingRemote = null;
  // 지금 화면에 적용해 둔 본문. 게시판 목록처럼 페이지 스크립트가 그려 넣은 내용은
  // 여기 포함되지 않으므로, 살아 있는 DOM이 아니라 이 값과 비교해야 한다.
  // (DOM과 비교하면 서버 내용이 그대로일 때도 화면을 되돌려 게시판 목록이 지워진다.)
  let appliedHTML = applied ? saved.html : deployedHTML;

  function applyRemote(data) {
    const html = data && data.baseHash === baseHash ? data.html : deployedHTML;
    if (html === appliedHTML) return; // 서버 내용이 그대로면 화면을 건드리지 않는다
    appliedHTML = html;
    area.innerHTML = html;
    applied = !!(data && data.baseHash === baseHash);
    notifyReady(); // 페이지별 스크립트가 바뀐 본문에 다시 붙도록 한다
  }

  pageDocRef(pageKey).onSnapshot(
    function (snap) {
      if (snap.metadata.hasPendingWrites) return; // 아직 서버에 반영 전인 내 저장은 무시
      const data = snap.exists ? snap.data() : null;
      if (editing) {
        pendingRemote = data;
        return;
      }
      applyRemote(data);
    },
    function () {
      /* 구독 실패(네트워크 등)는 무시 — 이미 불러온 내용을 그대로 보여준다 */
    }
  );

  if (!isAdmin()) {
    notifyReady();
    return;
  }

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
  resetBtn.style.display = applied ? "" : "none";

  toolbar.appendChild(editBtn);
  toolbar.appendChild(saveBtn);
  toolbar.appendChild(cancelBtn);
  toolbar.appendChild(resetBtn);
  mainEl.insertBefore(toolbar, area);

  // 새 버전이 배포돼 예전 수정본이 무시된 경우, 관리자에게만 안내한다.
  if (stale) {
    const notice = document.createElement("div");
    notice.className = "content-edit-notice";
    notice.textContent = "이 페이지가 새 버전으로 배포되어, 예전에 저장한 수정 내용은 적용하지 않았습니다.";
    const dropBtn = document.createElement("button");
    dropBtn.type = "button";
    dropBtn.className = "btn btn-outline btn-sm";
    dropBtn.textContent = "예전 수정본 삭제";
    dropBtn.addEventListener("click", async function () {
      try {
        await pageDocRef(pageKey).delete();
        notice.remove();
      } catch (e) {
        alert("삭제하지 못했습니다: " + e.message);
      }
    });
    notice.appendChild(dropBtn);
    mainEl.insertBefore(notice, toolbar);
  }

  /* 엔터 줄바꿈 통일.
     contentEditable에서 엔터를 그대로 두면 브라우저가 문단(<p>)을 새로 만들어, 문단 아래
     여백(margin-bottom)만큼 줄 간격이 더 벌어진다. 그래서 같은 글인데도 자동 줄바꿈된 줄과
     엔터로 넘긴 줄의 간격이 달라 보인다(이 사이트 기준 27.75px vs 39.75px).
     엔터를 항상 줄바꿈(<br>)으로 넣어, 문단·목록·표 어디서 쳐도 간격이 같게 한다.
     한글 입력 중(조합 중)의 엔터는 글자 확정용이므로 건드리지 않는다. */
  area.addEventListener("keydown", function (e) {
    if (e.key !== "Enter" || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;
    if (area.contentEditable !== "true") return;
    if (e.isComposing || e.keyCode === 229) return;
    e.preventDefault();
    document.execCommand("insertLineBreak");
  });

  let originalHTML = null;

  // 페이지별 스크립트가 본문을 바꾼 뒤 호출한다 (예: 공실 추가, 서식 파일 업로드).
  window.saveContentEdit = async function () {
    const html = area.innerHTML;
    try {
      await pageDocRef(pageKey).set({
        html: html,
        baseHash: baseHash,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        updatedBy: (getSession() && getSession().id) || "",
      });
      applied = true;
      appliedHTML = html; // 서버에서 되돌아오는 같은 내용으로 화면을 다시 그리지 않도록 맞춰 둔다
      resetBtn.style.display = "";
      return true;
    } catch (e) {
      alert(
        "저장하지 못했습니다. 첨부 파일이 너무 크면 저장이 거부될 수 있습니다(페이지당 1MB 제한).\n" + e.message
      );
      return false;
    }
  };

  // 편집을 끝낸 뒤, 그 사이 다른 PC에서 들어온 저장 내용이 있으면 그때 반영한다.
  function endEditing() {
    editing = false;
    if (pendingRemote !== null) {
      const data = pendingRemote;
      pendingRemote = null;
      applyRemote(data);
    }
  }

  editBtn.addEventListener("click", function () {
    editing = true;
    originalHTML = area.innerHTML;
    area.contentEditable = "true";
    area.classList.add("editing");
    area.focus();
    editBtn.style.display = "none";
    saveBtn.style.display = "";
    cancelBtn.style.display = "";
  });

  saveBtn.addEventListener("click", async function () {
    saveBtn.disabled = true;
    const ok = await window.saveContentEdit();
    saveBtn.disabled = false;
    if (!ok) return;
    area.contentEditable = "false";
    area.classList.remove("editing");
    editBtn.style.display = "";
    saveBtn.style.display = "none";
    cancelBtn.style.display = "none";
    pendingRemote = null; // 내 저장이 최신이므로 편집 중 들어온 알림은 버린다
    editing = false;
  });

  cancelBtn.addEventListener("click", function () {
    area.innerHTML = originalHTML;
    area.contentEditable = "false";
    area.classList.remove("editing");
    editBtn.style.display = "";
    saveBtn.style.display = "none";
    cancelBtn.style.display = "none";
    endEditing();
  });

  resetBtn.addEventListener("click", async function () {
    if (!confirm("수정 내용을 지우고 원래 페이지 내용으로 되돌릴까요?")) return;
    try {
      await pageDocRef(pageKey).delete();
      location.reload();
    } catch (e) {
      alert("복원하지 못했습니다: " + e.message);
    }
  });

  notifyReady();
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
