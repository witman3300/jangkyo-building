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

/* 필요 없어진 원본 글(구 사이트에서 옮겨온 공지·결산보고서·회의록 등)은 파일에 들어 있어
   지울 수가 없다. 대신 "삭제됨" 자리로 보내 목록에서 빠지게 하고, 되살릴 수 있게 둔다. */
const HIDDEN_CAT = "__deleted__";

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

/* ===== 원본 글 이동·삭제 기록 =====
   목록에 함께 싣는 원본 글(notices-data.js 등)은 데이터 파일에 들어 있어 Firestore에
   문서가 없다. 파일을 화면에서 고칠 수는 없으므로, 어떤 원본 글을 어느 게시판에 보일지
   또는 목록에서 감출지만 Firestore에 적어 두고 목록을 그릴 때 반영한다.
   문서ID = "{원본게시판}-{원본글 id}", 내용 = { fromCat, srcId, toCat, prevCat }.
   toCat이 HIDDEN_CAT이면 지운 글이고, prevCat은 지우기 전에 있던 게시판이다(되살리기용).
   컬렉션 이름은 공지사항 이동에만 쓰던 때 지은 것이라 기록을 살려 두려고 그대로 쓴다.
   목록에서 감추는 데 쓰이므로 읽기는 누구나 할 수 있어야 하고, 쓰기는 관리자만 한다. */
const MOVES_COL = "noticeMoves";
let MOVES = {}; // "notice-246" -> { fromCat, srcId, toCat, prevCat }
let unsubscribeMoves = null;
let showDeletedStatic = false; // 관리자가 "펼쳐 보기"를 누르면 지운 원본 글도 목록에 잠시 보인다

function subscribeMoves() {
  // 원본 글이 있는 게시판과, 원본 글을 받을 수 있는 공지사항 두 곳에서 쓴다
  if (!DOC_CATS[getCat()] && !MOVE_CATS.includes(getCat())) return;
  if (unsubscribeMoves) unsubscribeMoves();
  unsubscribeMoves = db.collection(MOVES_COL).onSnapshot(
    (snap) => {
      MOVES = {};
      snap.docs.forEach((d) => (MOVES[d.id] = d.data()));
      onPostsChanged();
    },
    () => {} // 읽지 못하면 원래 게시판 그대로 보여 준다
  );
}

// 원본 글이 지금 어느 게시판에 속하는지 (옮긴 적도 지운 적도 없으면 원래 게시판 그대로)
function staticCatOf(srcCat, srcId) {
  const m = MOVES[srcCat + "-" + srcId];
  return (m && m.toCat) || srcCat;
}

// 지운 원본 글이 지우기 전에 있던 게시판 (삭제 목록을 어디에 보여 주고 어디로 되살릴지)
function staticHomeOf(srcCat, srcId) {
  const m = MOVES[srcCat + "-" + srcId];
  return (m && m.prevCat) || srcCat;
}

/* 목록에 실을 원본 글 모으기.
   ① 이 게시판의 원본 글 중 다른 게시판으로 보내거나 지우지 않은 것
   ② 다른 공지사항 게시판에서 이 게시판으로 보낸 원본 글
   ③ withDeleted면 이 게시판에서 지운 원본 글도 deleted 표시를 달아 함께 (관리자용)
   각 항목은 { post, srcCat, view, deleted } — view는 원본 상세 페이지 주소다. */
function staticEntries(cat, withDeleted) {
  const cats = MOVE_CATS.includes(cat) ? Array.from(new Set([cat].concat(MOVE_CATS))) : [cat];
  const out = [];
  cats.forEach((srcCat) => {
    const d = DOC_CATS[srcCat];
    if (!d) return;
    d.data().forEach((p) => {
      const now = staticCatOf(srcCat, p.id);
      if (now === cat) out.push({ post: p, srcCat: srcCat, view: d.view, deleted: false });
      else if (withDeleted && now === HIDDEN_CAT && staticHomeOf(srcCat, p.id) === cat)
        out.push({ post: p, srcCat: srcCat, view: d.view, deleted: true });
    });
  });
  // 두 게시판의 원본 글이 섞일 수 있으므로 번호 대신 날짜(최신순)로 줄 세운다
  return out.sort((a, b) =>
    a.post.date === b.post.date ? b.post.no - a.post.no : (a.post.date < b.post.date ? 1 : -1)
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

  /* 이동 열: 두 공지사항 게시판(정보마당·회원광장) 사이에서 글을 옮긴다. 관리자 전용.
     삭제 열: 필요 없어진 글을 상세 페이지에 들어가지 않고 목록에서 바로 지운다.
     관리자는 모든 글을, 회원은 자기가 쓴 글을 지운다(서버 규칙도 같은 기준이다).
     구 사이트에서 옮겨온 원본 글은 파일에 들어 있어 지울 수 없으므로, 글은 그대로 두고
     목록에서만 감춘다(관리자 전용, 되살릴 수 있다). */
  const admin = typeof isAdmin === "function" && isAdmin();
  const session = typeof getSession === "function" ? getSession() : null;
  const canDelete = (p) => admin || !!(session && p.authorUid && session.uid === p.authorUid);
  const showMove = MOVE_CATS.includes(cat) && admin;
  const showDelete = admin || all.some(canDelete);

  // 지운 원본 글은 평소에는 감추고, 관리자가 "펼쳐 보기"를 눌렀을 때만 목록에 섞어 보여 준다
  const staticAll = staticEntries(cat, admin);
  const deletedStatic = staticAll.filter((e) => e.deleted);
  const staticRows = showDeletedStatic ? staticAll : staticAll.filter((e) => !e.deleted);
  /* 목록 번호
     공지사항은 정보마당·회원광장 사이에서 글을 옮기거나 지울 수 있어, 원본에 붙어 있던
     번호를 그대로 쓰면 35, 34, 32... 처럼 중간이 빈다. 그래서 저장된 번호를 쓰지 않고
     화면에 보이는 순서대로 맨 위부터 1, 2, 3, 4, 5... 로 그때그때 새로 매긴다.
     고정글(📌)과 지운 원본 글(관리자가 펼쳐 봤을 때만 나온다)은 번호를 차지하지 않아,
     관리자가 보는 번호와 회원이 보는 번호가 어긋나지 않는다.
     그 밖의 게시판은 지금까지처럼 원본 번호를 쓰고, 새 글이 그 다음 번호를 받는다. */
  const renumber = MOVE_CATS.includes(cat);
  const baseNo = staticRows.reduce((m, e) => Math.max(m, e.post.no || 0), 0);
  let rowNo = 1;

  // 지금 보고 있는 게시판의 반대쪽으로 보내는 버튼 하나만 둔다
  const otherCat = MOVE_CATS.find((c) => c !== cat);

  const moveBtn = (call) =>
    `<button type="button" class="move-btn" onclick="${call}"
      title="이 글을 ${MOVE_LABELS[otherCat]} 공지사항으로 옮깁니다">${MOVE_LABELS[otherCat]}으로</button>`;

  const moveCell = (p) => moveBtn(`movePost('${p.id}', '${otherCat}')`);

  const staticMoveCell = (e) =>
    moveBtn(`moveStaticPost('${e.srcCat}', '${e.post.id}', '${otherCat}')`);

  const delCell = (p) =>
    `<button type="button" class="move-btn danger" onclick="deletePost('${p.id}')"
      title="이 글과 첨부파일을 지웁니다">삭제</button>`;

  // 원본 글은 파일에 그대로 남으므로 지운 뒤에도 되살릴 수 있다
  const staticDelCell = (e) =>
    e.deleted
      ? `<button type="button" class="move-btn" onclick="restoreStaticPost('${e.srcCat}', '${e.post.id}')"
          title="이 글을 목록에 되살립니다">되살리기</button>`
      : `<button type="button" class="move-btn danger" onclick="deleteStaticPost('${e.srcCat}', '${e.post.id}')"
          title="이 글을 목록에서 지웁니다">삭제</button>`;

  const rowHtml = (o) => {
    const flag = o.deleted
      ? `<span class="pin-flag">삭제됨</span> `
      : o.pinned
        ? `<span class="pin-flag">📌 공지</span> `
        : o.isNew
          ? `<span class="pin-flag">NEW</span> `
          : "";
    // 셀마다 이름을 붙여 둔다. 모바일에서는 이 이름으로 제목을 윗줄, 나머지를 아랫줄로 배치한다.
    return `<tr class="${o.pinned ? "pinned-row" : ""}${o.deleted ? " deleted-row" : ""}">
      <td class="num">${o.num}</td>
      <td class="title">${flag}<a href="${o.href}">${esc(o.title)}</a></td>
      <td class="author">${esc(o.author)}</td>
      <td class="date">${o.date}</td>
      <td class="files${o.files ? " has-file" : ""}">${o.files ? o.files : ""}</td>
      ${showMove ? `<td class="move">${o.move || "-"}</td>` : ""}
      ${showDelete ? `<td class="del">${o.del || "-"}</td>` : ""}
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
      move: showMove ? moveCell(p) : "",
      del: showDelete && canDelete(p) ? delCell(p) : "",
    });

  const staticRow = (e) =>
    rowHtml({
      num: renumber ? (e.deleted ? "-" : rowNo++) : e.post.no,
      title: e.post.title,
      author: "관리자",
      date: e.post.date,
      href: e.view + "?id=" + e.post.id,
      files: e.post.imgCount || 0,
      pinned: false,
      deleted: e.deleted,
      isNew: !e.deleted && isWithinNewDays(e.post.date),
      move: showMove && !e.deleted ? staticMoveCell(e) : "",
      del: admin ? staticDelCell(e) : "",
    });

  const cols = 5 + (showMove ? 1 : 0) + (showDelete ? 1 : 0);

  let rows;
  if (!postsLoaded && staticRows.length === 0) {
    rows = `<tr><td colspan="${cols}" class="board-empty">불러오는 중...</td></tr>`;
  } else if (all.length === 0 && staticRows.length === 0) {
    rows = `<tr><td colspan="${cols}" class="board-empty">등록된 게시글이 없습니다.</td></tr>`;
  } else {
    let n = baseNo + normal.length;
    rows =
      pinned.map((p) => localRow(p, "📌", true)).join("") +
      normal.map((p) => localRow(p, renumber ? rowNo++ : n--, false)).join("") +
      staticRows.map(staticRow).join("");
  }

  const canWrite = !ADMIN_WRITE_CATS.includes(cat) || (typeof isAdmin === "function" && isAdmin());
  const writeBtn = canWrite ? `<a href="#write" class="btn btn-primary btn-sm">글쓰기</a>` : "";

  // 정보마당처럼 페이지에 이미 제목이 있는 자리에 게시판을 끼워 넣을 때는
  // window.BOARD_HIDE_TITLE = true 로 두어 제목을 겹쳐 쓰지 않는다.
  const heading = window.BOARD_HIDE_TITLE ? "" : `<h1>${CATEGORIES[cat]}</h1>`;

  // 지운 원본 글 안내 (관리자 전용) — 몇 건인지 알리고, 펼쳐서 되살릴 수 있게 한다
  const deletedNotice = deletedStatic.length
    ? `<div class="content-edit-notice">
        목록에서 지운 원본 글이 ${deletedStatic.length}건 있습니다. 글은 그대로 남아 있어 되살릴 수 있습니다.
        <button type="button" class="btn btn-outline btn-sm" onclick="toggleDeletedStatic()">${showDeletedStatic ? "감추기" : "펼쳐 보기"}</button>
      </div>`
    : "";

  document.getElementById("app").innerHTML = `
    <div class="board-head">
      ${heading}
      ${writeBtn}
    </div>
    ${legacyNoticeHtml()}
    ${deletedNotice}
    <table class="board-table">
      <thead>
        <tr><th width="60">번호</th><th>제목</th><th width="100">작성자</th><th width="110">작성일</th><th width="70">첨부</th>${showMove ? '<th width="120">이동</th>' : ""}${showDelete ? '<th width="70">삭제</th>' : ""}</tr>
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
  uploadAborted = false;
  activeUploads = new Set();
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
          <span class="file-hint">여러 개 선택 가능 · 파일당 최대 ${MAX_FILE_MB}MB <b id="file-total"></b></span>
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
      <p class="upload-status" id="f-status"></p>
      <div class="btn-row">
        <button type="submit" class="btn btn-primary btn-sm" id="f-submit">등록</button>
        <a href="#list" class="btn btn-outline btn-sm">취소</a>
        <button type="button" class="btn btn-outline btn-sm" id="f-abort" style="display:none" onclick="abortUpload()">올리기 중단</button>
      </div>
    </form>`;
}

/* ===== 첨부 대기 목록 ===== */

// 지금 Storage에 올라가는 중인 작업들. 중단 버튼과 실패 뒷정리에 쓴다.
let activeUploads = new Set();
let uploadAborted = false;

const UPLOAD_STALL_MS = 45000; // 이만큼 한 바이트도 안 올라가면 멈춘 것으로 보고 끊는다
const UPLOAD_LANES = 3; // 한 번에 겹쳐 올리는 개수

function renderFileList() {
  const ul = document.getElementById("file-list");
  if (!ul) return;
  ul.innerHTML = pendingFiles
    .map(
      (f, i) => `<li data-i="${i}">
        <span class="fname">📎 ${esc(f.name)}</span>
        <span class="fsize">(${fmtSize(f.size)})</span>
        <button type="button" class="remove" onclick="removeFile(${i})">삭제</button>
        <span class="fbar"><i></i></span>
        <span class="fpct"></span>
      </li>`
    )
    .join("");
  const total = document.getElementById("file-total");
  if (total) {
    const bytes = pendingFiles.reduce((s, f) => s + f.size, 0);
    total.textContent = pendingFiles.length
      ? `· 담은 파일 ${pendingFiles.length}개 ${fmtSize(bytes)}`
      : "";
  }
}

function onPickFiles(e) {
  Array.from(e.target.files).forEach((file) => {
    // Storage 규칙이 20MB 미만만 받으므로 딱 20MB인 파일도 걸러야 한다
    if (file.size >= MAX_FILE_MB * 1024 * 1024) {
      showToast(`"${file.name}" 은(는) ${MAX_FILE_MB}MB를 넘어 제외됩니다.`);
      return;
    }
    if (!file.size) {
      showToast(`"${file.name}" 은(는) 빈 파일이라 제외됩니다.`);
      return;
    }
    // 같은 파일을 두 번 고르면 같은 자료가 두 번 올라가 시간만 배로 든다
    if (pendingFiles.some((p) => p.name === file.name && p.size === file.size)) return;
    pendingFiles.push(file);
  });
  renderFileList();
  e.target.value = ""; // 같은 파일 다시 선택 가능하도록 초기화
}

function removeFile(i) {
  if (activeUploads.size) return; // 올리는 중에는 목록을 건드리지 않는다
  pendingFiles.splice(i, 1);
  renderFileList();
}

/* Storage 경로에 쓰면 안 되는 글자를 걸러 낸다.
   이름에 #, ?, %, / 같은 글자가 섞여 있으면 올라가더라도 내려받기 주소가 어긋나
   "올렸는데 파일이 안 열린다"가 된다. 원래 이름은 게시글 문서에 그대로 저장하고,
   내려받을 때 쓰도록 Content-Disposition에도 따로 적어 두므로 보이는 이름은 그대로다. */
function safeStorageName(name) {
  // 제어문자는 코드값으로 걸러 낸다
  const clean = Array.from(String(name || "file"))
    .filter((ch) => ch.charCodeAt(0) > 31 && ch.charCodeAt(0) !== 127)
    .join("")
    .replace(/[\\/#?%*:|"'<>\[\]{}]/g, "_") // 경로·주소를 깨뜨리는 글자
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^[._]+/, "");
  const dot = clean.lastIndexOf(".");
  const ext = dot > 0 ? clean.slice(dot, dot + 12) : "";
  const stem = (dot > 0 ? clean.slice(0, dot) : clean).slice(0, 60);
  return (stem || "file") + ext;
}

/* 한 바이트도 못 보낸 채 끝났을 때의 안내.
   회선이 느린 것과 보관함에 아예 닿지 못한 것은 회원이 할 일이 다르다 —
   앞은 기다리거나 다시 걸면 되고, 뒤는 관리사무소가 서버를 손봐야 한다. */
function cannotReachStorageMessage(file) {
  return `"${file.name}" 을(를) 보관할 서버에 닿지 못했습니다. 잠시 뒤 다시 해 보시고, 계속 안 되면 관리사무소에 알려 주세요.`;
}

// Storage가 돌려주는 오류 코드를 회원이 읽을 수 있는 말로 바꾼다.
// sentBytes는 그때까지 실제로 올라간 양으로, 0이면 보관함에 닿지 못한 쪽이다.
function uploadErrorMessage(err, file, sentBytes) {
  const code = (err && err.code) || "";
  if (code === "storage/unauthorized")
    return `"${file.name}" 을(를) 올릴 권한이 없습니다. 로그아웃되었을 수 있으니 다시 로그인해 주세요.`;
  if (code === "storage/quota-exceeded")
    return "첨부파일 보관 용량이 가득 찼습니다. 관리사무소에 알려 주세요.";
  if (code === "storage/retry-limit-exceeded")
    return sentBytes
      ? `"${file.name}" 올리기가 거듭 실패했습니다. 인터넷 연결을 확인한 뒤 다시 등록해 주세요.`
      : cannotReachStorageMessage(file);
  if (code === "storage/canceled") return "첨부 올리기를 중단했습니다.";
  return `"${file.name}" 을(를) 올리지 못했습니다: ${(err && err.message) || code}`;
}

// 목록의 한 줄에 진행률 막대를 그린다
function setFileProgress(i, loaded, total) {
  const li = document.querySelector(`#file-list li[data-i="${i}"]`);
  if (!li) return;
  const pct = total ? Math.min(100, Math.round((loaded / total) * 100)) : 0;
  li.classList.add("uploading");
  const bar = li.querySelector(".fbar i");
  if (bar) bar.style.width = pct + "%";
  const txt = li.querySelector(".fpct");
  if (txt) txt.textContent = pct + "%";
  if (pct >= 100) li.classList.add("done");
}

// 진행률 막대를 처음 상태로 되돌린다 (등록에 실패해 다시 시도할 때)
function resetFileProgress() {
  document.querySelectorAll("#file-list li").forEach((li) => {
    li.classList.remove("uploading", "done");
    const bar = li.querySelector(".fbar i");
    if (bar) bar.style.width = "0%";
    const txt = li.querySelector(".fpct");
    if (txt) txt.textContent = "";
  });
}

// 남은 시간 어림 — 화면이 멈춘 게 아니라 올라가는 중임을 알려 준다
function remainText(sent, total, startedAt) {
  const sec = (Date.now() - startedAt) / 1000;
  if (sec < 2 || sent <= 0) return "";
  const left = Math.ceil((total - sent) / (sent / sec));
  if (!isFinite(left) || left <= 0) return "";
  return left >= 60 ? `약 ${Math.ceil(left / 60)}분 남음` : `약 ${left}초 남음`;
}

function cancelActiveUploads() {
  activeUploads.forEach((t) => {
    try {
      t.cancel();
    } catch (_) {}
  });
}

// "올리기 중단" 버튼
function abortUpload() {
  uploadAborted = true;
  cancelActiveUploads();
}

function warnLeaving(e) {
  e.preventDefault();
  e.returnValue = "";
  return "";
}

/* 첨부 1개를 Storage에 올리고, 문서에 저장할 정보(주소 포함)를 돌려준다.
   올라가는 동안 진행률을 알리고, 한동안 한 바이트도 못 올라가면 끊는다.
   예전에는 그냥 기다리기만 해서, 연결이 끊기면 아무 표시 없이 10분을 매달려 있었다. */
function uploadAttachment(postId, index, file, onProgress) {
  const path = `board/${getCat()}/${postId}/${index}_${safeStorageName(file.name)}`;
  const task = fbStorage.ref(path).put(file, {
    contentType: file.type || "application/octet-stream",
    // 경로에서 걸러 낸 글자가 있어도 내려받을 때는 원래 이름으로 저장되게 한다
    contentDisposition: "attachment; filename*=UTF-8''" + encodeURIComponent(file.name),
  });
  activeUploads.add(task);

  return new Promise((resolve, reject) => {
    let settled = false;
    // 0으로 두는 게 중요하다. -1로 두면 "0바이트 올라감" 알림조차 움직임으로 쳐서
    // 멈춤 시계가 되감기고, 실제로는 한 바이트도 못 올라갔는데 기다리는 시간이 배로 늘어난다.
    let lastBytes = 0;
    let movedAt = Date.now();

    const done = (fn) => (arg) => {
      if (settled) return;
      settled = true;
      clearInterval(watch);
      activeUploads.delete(task);
      fn(arg);
    };

    const watch = setInterval(() => {
      if (settled) return;
      if (Date.now() - movedAt > UPLOAD_STALL_MS) {
        done(() => {
          try {
            task.cancel();
          } catch (_) {}
          // 한 바이트도 못 올라갔다면 회선이 느린 게 아니라 첨부 보관함에 아예 닿지 못한 것이다.
          // (Storage가 준비되지 않았거나 주소가 틀리면 SDK가 조용히 재시도만 되풀이한다)
          reject(
            new Error(
              lastBytes === 0
                ? cannotReachStorageMessage(file)
                : `"${file.name}" 올리기가 ${Math.round(UPLOAD_STALL_MS / 1000)}초째 멈춰 있어 중단했습니다. 인터넷 연결을 확인한 뒤 다시 등록해 주세요.`
            )
          );
        })();
      }
    }, 2000);

    task.on(
      "state_changed",
      (snap) => {
        if (snap.bytesTransferred !== lastBytes) {
          lastBytes = snap.bytesTransferred;
          movedAt = Date.now(); // 한 바이트라도 움직였으면 멈춤 시계를 되감는다
        }
        if (onProgress) onProgress(snap.bytesTransferred, snap.totalBytes || file.size);
      },
      done((err) => reject(new Error(uploadErrorMessage(err, file, lastBytes)))),
      () => {
        task.snapshot.ref
          .getDownloadURL()
          .then(
            done((url) =>
              resolve({
                name: file.name,
                type: file.type || "",
                size: file.size,
                path: path,
                url: url,
              })
            )
          )
          .catch(done((err) => reject(new Error(uploadErrorMessage(err, file, lastBytes)))));
      }
    );
  });
}

/* 첨부 여러 개를 조금씩 겹쳐 올린다.
   하나씩 차례로 올리면 개수만큼 기다려야 해서, 파일이 몇 개만 되어도 한참 멈춘 듯 보였다.
   올라간 것은 out에 채워 넣는다 — 중간에 실패했을 때 지우려면 무엇이 올라갔는지 알아야 한다. */
async function uploadAllAttachments(postId, files, out, onProgress) {
  const sent = new Array(files.length).fill(0);
  const totalOf = () => sent.reduce((a, b) => a + b, 0);
  let next = 0;
  let failure = null;

  const worker = async () => {
    while (!failure && !uploadAborted) {
      const i = next++;
      if (i >= files.length) return;
      try {
        out[i] = await uploadAttachment(postId, i, files[i], (loaded, total) => {
          sent[i] = loaded;
          setFileProgress(i, loaded, total);
          onProgress(totalOf());
        });
        sent[i] = files[i].size;
        setFileProgress(i, files[i].size, files[i].size);
        onProgress(totalOf());
      } catch (e) {
        if (!failure) {
          failure = e;
          cancelActiveUploads(); // 어차피 등록이 안 되므로 나머지도 붙잡아 두지 않는다
        }
        return;
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(UPLOAD_LANES, files.length) }, worker));
  if (uploadAborted) throw new Error("첨부 올리기를 중단했습니다.");
  if (failure) throw failure;
}

async function submitPost(e) {
  e.preventDefault();
  if (activeUploads.size) return; // 이미 올리는 중이면 등록을 두 번 받지 않는다

  const title = document.getElementById("f-title").value.trim();
  const author = document.getElementById("f-author").value.trim();
  const content = document.getElementById("f-content").value.trim();
  if (!title || !author || !content) return;

  const btn = document.getElementById("f-submit");
  const abortBtn = document.getElementById("f-abort");
  const status = document.getElementById("f-status");
  const fileInput = document.getElementById("f-files");
  btn.disabled = true;
  btn.textContent = "등록 중...";
  if (fileInput) fileInput.disabled = true;
  document.querySelectorAll("#file-list .remove").forEach((b) => (b.disabled = true));

  const now = new Date();
  const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const pinEl = document.getElementById("f-pinned");
  const session = typeof getSession === "function" ? getSession() : null;
  const ref = postsRef().doc(); // 첨부 경로에 쓰려고 문서 ID를 먼저 받아 둔다

  const files = pendingFiles.slice();
  const uploaded = new Array(files.length);
  const totalBytes = files.reduce((s, f) => s + f.size, 0);
  uploadAborted = false;

  if (files.length) {
    if (abortBtn) abortBtn.style.display = "";
    window.addEventListener("beforeunload", warnLeaving);
    // 기본값(10분)이면 연결이 끊겨도 한참 동안 아무 반응이 없다
    if (fbStorage.setMaxUploadRetryTime) fbStorage.setMaxUploadRetryTime(60000);
  }

  try {
    if (files.length) {
      const startedAt = Date.now();
      await uploadAllAttachments(ref.id, files, uploaded, (bytes) => {
        const pct = totalBytes ? Math.round((bytes / totalBytes) * 100) : 0;
        btn.textContent = `첨부 올리는 중 ${pct}%`;
        if (status)
          status.textContent =
            `${fmtSize(bytes)} / ${fmtSize(totalBytes)} 올리는 중… ${remainText(bytes, totalBytes, startedAt)}`.trim();
      });
      if (status) status.textContent = "첨부 올리기 완료 · 글 저장 중…";
      btn.textContent = "저장 중...";
    }

    await ref.set({
      cat: getCat(),
      title, author, content, date,
      authorUid: (session && session.uid) || "",
      files: uploaded.filter(Boolean),
      pinned: !!(pinEl && pinEl.checked),
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    window.removeEventListener("beforeunload", warnLeaving);
    pendingFiles = [];
    location.hash = "#view/" + ref.id;
  } catch (err) {
    // 글은 저장되지 않았으므로, 이미 올라간 첨부는 Storage에 남지 않게 지운다
    for (const f of uploaded) {
      if (f && f.path) await fbStorage.ref(f.path).delete().catch(() => {});
    }
    window.removeEventListener("beforeunload", warnLeaving);
    showToast(err.message || "등록하지 못했습니다.");
    if (status) status.textContent = "";
    if (abortBtn) abortBtn.style.display = "none";
    if (fileInput) fileInput.disabled = false;
    document.querySelectorAll("#file-list .remove").forEach((b) => (b.disabled = false));
    resetFileProgress();
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
  // 첨부 목록은 화면에 펼쳐 보이지 않는다 — 아래 "다운로드" 버튼이 그 자리를 대신한다
  const attachFiles = (p.files || []).filter((f) => f && f.url);

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
  // 자료가 붙어 있을 때만 내려받기를 권한다 (첨부 목록을 감춘 대신 여기서 받는다)
  const downBtn = attachFiles.length
    ? `<button type="button" class="btn btn-outline btn-sm" onclick="downloadAttachments('${p.id}')"
        title="이 글에 붙은 자료 ${attachFiles.length}개를 내려받습니다">다운로드${
          attachFiles.length > 1 ? ` ${attachFiles.length}` : ""}</button>`
    : "";
  // 자료가 여럿이면 고를 자리를 미리 깔아 두고 접어 둔다 (버튼을 누르면 펴진다)
  const pickHtml = attachFiles.length > 1
    ? `<div class="attach-pick" id="attach-pick" hidden>${attachFiles
        .map((f, i) => `<button type="button" onclick="saveAttachmentAt('${p.id}',${i})">${esc(f.name)}${
          f.size ? ` <span>(${fmtSize(f.size)})</span>` : ""}</button>`)
        .join("")}</div>`
    : "";
  const printBtn = `<button type="button" class="btn btn-outline btn-sm" onclick="window.print()"
      title="이 글의 본문을 인쇄합니다">인쇄</button>`;
  const pinTag = p.pinned ? `<span class="pin-flag">📌 공지</span> ` : "";

  document.getElementById("app").innerHTML = `
    <div class="board-head"><h1>${CATEGORIES[p.cat || getCat()]}</h1></div>
    <div class="view-head">
      <h2>${pinTag}${esc(p.title)}</h2>
      <div class="view-meta"><span>작성자 ${esc(p.author)}</span><span>${p.date}</span></div>
    </div>
    <div class="view-body">${esc(p.content)}</div>
    ${imagesHtml}
    <div class="btn-row">
      <a href="#list" class="btn btn-outline btn-sm">목록</a>
      ${downBtn}
      ${printBtn}
      ${pinBtn}
      ${delBtn}
    </div>
    ${pickHtml}`;
}

/* ===== 자료 내려받기 =====
   첨부 목록을 늘 펼쳐 두지 않고, 버튼을 누른 사람에게만 보여 준다.

   한 번 눌러 여러 개를 한꺼번에 부르는 길은 막혀 있다. 브라우저는 "저절로 시작된
   내려받기"를 하나까지만 허용해서, 둘째부터는 아무 말 없이 사라진다 — 실제로
   2개짜리 회의록에서 한 장만 받아졌고, 받은 사람은 그게 전부인 줄 알 수밖에 없었다.
   (보관함에서 직접 읽어다 묶는 길도 막혀 있다 — 다른 출처라 fetch가 거절당한다.)
   그래서 여럿일 때는 고르게 한다. 하나씩 누르면 그 누름이 저마다 허락이 되어
   빠짐없이 받아진다. */
function downloadAttachments(id) {
  const files = attachmentsOf(id);
  if (!files.length) {
    showToast("내려받을 자료가 없습니다.");
    return;
  }
  if (files.length === 1) {
    saveAttachment(files[0]);
    return;
  }
  const pick = document.getElementById("attach-pick");
  if (pick) pick.hidden = !pick.hidden;
}

function saveAttachmentAt(id, index) {
  const f = attachmentsOf(id)[index];
  if (f) saveAttachment(f);
}

function attachmentsOf(id) {
  const p = loadPosts().find((x) => x.id === id);
  return ((p && p.files) || []).filter((f) => f && f.url);
}

/* 파일 하나를 내려받는다.
   새 탭(target="_blank")으로 열면 안 된다 — 브라우저는 누름 한 번에 새 탭 하나만 허용한다.
   첨부는 올릴 때 "내려받기용"으로 표시해 두므로(contentDisposition) 같은 탭에 걸어도
   저장만 시작되고 보던 글은 그대로 남는다. */
function saveAttachment(f) {
  const a = document.createElement("a");
  a.href = f.url;
  a.download = f.name || ""; // 다른 출처면 무시되지만, 올릴 때 원래 이름을 함께 넣어 두었다
  document.body.appendChild(a);
  a.click();
  a.remove();
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

/* 원본 글(파일에 들어 있는 구 사이트 공지)을 다른 공지사항 게시판으로 옮긴다 (관리자만).
   글과 첨부 이미지는 파일에 그대로 두고, 어느 게시판에 보일지만 Firestore에 적는다.
   원래 있던 게시판으로 되돌릴 때는 그 기록을 지운다. */
async function moveStaticPost(srcCat, srcId, toCat) {
  if (!(typeof isAdmin === "function" && isAdmin())) return;
  const d = DOC_CATS[srcCat];
  const p = d && d.data().find((x) => String(x.id) === String(srcId));
  if (!p) return;
  if (!confirm(`"${p.title}" 글을 ${MOVE_LABELS[toCat]} 공지사항으로 옮기시겠습니까?`)) return;
  const key = srcCat + "-" + srcId;
  try {
    if (toCat === srcCat) await db.collection(MOVES_COL).doc(key).delete();
    else
      await db
        .collection(MOVES_COL)
        .doc(key)
        .set({ fromCat: srcCat, srcId: String(srcId), toCat: toCat });
    showToast(`${MOVE_LABELS[toCat]} 공지사항으로 옮겼습니다.`);
  } catch (e) {
    showToast("옮기지 못했습니다: " + e.message);
  }
}

/* 원본 글을 목록에서 지운다 (관리자만).
   글과 첨부 이미지는 파일에 그대로 두고 "삭제됨" 자리로 보내 목록에서만 빼는데,
   지우기 전 게시판을 prevCat에 남겨 두어 되살릴 때 제자리로 돌려 놓는다. */
async function deleteStaticPost(srcCat, srcId) {
  if (!(typeof isAdmin === "function" && isAdmin())) return;
  const d = DOC_CATS[srcCat];
  const p = d && d.data().find((x) => String(x.id) === String(srcId));
  if (!p) return;
  if (!confirm(`"${p.title}" 글을 목록에서 지우시겠습니까?`)) return;
  try {
    await db
      .collection(MOVES_COL)
      .doc(srcCat + "-" + srcId)
      .set({
        fromCat: srcCat,
        srcId: String(srcId),
        toCat: HIDDEN_CAT,
        prevCat: staticCatOf(srcCat, srcId),
      });
    showToast("목록에서 지웠습니다.");
  } catch (e) {
    showToast("지우지 못했습니다: " + e.message);
  }
}

// 지운 원본 글을 지우기 전 게시판으로 되살린다 (관리자만)
async function restoreStaticPost(srcCat, srcId) {
  if (!(typeof isAdmin === "function" && isAdmin())) return;
  const key = srcCat + "-" + srcId;
  const prev = staticHomeOf(srcCat, srcId);
  try {
    if (prev === srcCat) await db.collection(MOVES_COL).doc(key).delete();
    else
      await db
        .collection(MOVES_COL)
        .doc(key)
        .set({ fromCat: srcCat, srcId: String(srcId), toCat: prev });
    showToast("목록에 되살렸습니다.");
  } catch (e) {
    showToast("되살리지 못했습니다: " + e.message);
  }
}

// 지운 원본 글을 목록에 펼쳐 보거나 다시 감춘다 (관리자에게만 버튼이 보인다)
function toggleDeletedStatic() {
  showDeletedStatic = !showDeletedStatic;
  renderList();
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
  const p = loadPosts().find((x) => x.id === id);
  // 목록에서도 지울 수 있으므로 어느 글인지 제목으로 확인시킨다
  if (!confirm(`${p ? `"${p.title}" 글을` : "이 게시글을"} 삭제하시겠습니까? 첨부파일도 함께 지워집니다.`)) return;
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
  // 글쓰기 화면을 떠나면 올리던 첨부도 멈춘다 — 보이지 않는 곳에서 계속 올라가지 않게
  if ((location.hash || "#list") !== "#write" && activeUploads.size) abortUpload();
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
  subscribeMoves();
  route();
});
