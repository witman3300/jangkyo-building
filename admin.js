// admin.js - 관리자 회원관리 (실회원 명단 + 사이트 로그인 계정 승인/등급부여/삭제). auth.js 이후 로드 필요.

/* 실회원 명단에는 등급/승인/가입일 정보가 원본 CSV에 없으므로, 관리자가 이 화면에서 직접 기록한다.
   예전에는 이 기록을 localStorage에 넣어 기록한 그 브라우저에서만 보였는데, 이제는 Firestore
   memberMeta 컬렉션(문서ID = 실회원 아이디)에 저장해 어느 PC에서 고쳐도 모든 관리자에게 반영된다.
   사이트 로그인 계정(아래 "사이트 로그인 계정" 표)과는 별개의 명단이다. */
const MEMBER_META_COL = "memberMeta";
const LEGACY_HIDDEN_KEY = "jangkyo_real_members_hidden"; // 옛 localStorage 키 (이전 대상)
const LEGACY_META_KEY = "jangkyo_real_members_meta";

/* 실회원 명단 본체(이름·호수·가입일 등). 관리자만 읽을 수 있는 Firestore 컬렉션에서 불러온다.
   예전에는 real-members-data.js 파일에 두었는데, 화면은 관리자만 볼 수 있어도 파일 자체는
   주소만 알면 누구나 내려받을 수 있었다. 202명의 이름·아이디·호수가 그대로 공개돼 있었다. */
const REAL_MEMBERS_COL = "realMembers";
let REAL_MEMBERS = [];

async function loadRealMembers() {
  try {
    const snap = await db.collection(REAL_MEMBERS_COL).get();
    REAL_MEMBERS = snap.docs.map((d) => Object.assign({ id: d.id }, d.data()));
  } catch (e) {
    REAL_MEMBERS = []; // 관리자가 아니면 읽히지 않는다
  }
}

let META_MAP = {}; // Firestore 구독으로 채워지는 { 회원아이디: {grade, approved, joinDate, lastLogin, hidden} }
let metaLoaded = false;

function escM(s) {
  return String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;",
  })[c]);
}

function memberMetaRef(id) {
  return db.collection(MEMBER_META_COL).doc(id);
}

// 다른 PC의 수정도 즉시 표에 반영한다. 단, 입력칸에 타이핑 중이면 표를 다시 그리지 않는다.
function subscribeMemberMeta() {
  db.collection(MEMBER_META_COL).onSnapshot(
    (snap) => {
      META_MAP = {};
      snap.docs.forEach((d) => (META_MAP[d.id] = d.data()));
      metaLoaded = true;
      const active = document.activeElement;
      const table = document.getElementById("real-member-table-wrap");
      if (table && active && table.contains(active)) return; // 편집 중인 칸은 건드리지 않는다
      if (document.getElementById("real-member-search")) renderRealMemberTable();
    },
    () => {
      metaLoaded = true;
    }
  );
}

// 명단에 hidden으로 확정된 회원 + 관리자가 화면에서 숨김 처리한 회원
function getHiddenRealMemberIds() {
  const fixed = REAL_MEMBERS
    .filter((m) => m.hidden)
    .map((m) => m.id);
  const remote = Object.keys(META_MAP).filter((id) => META_MAP[id].hidden);
  return new Set(fixed.concat(remote));
}

// 구회원(실회원 명단)은 모두 일반회원으로 시작한다. 관리자가 이 화면에서 특별회원으로 바꾸면
// 그 값이 memberMeta에 저장되어 모든 관리자 화면에 반영된다.
// 가입년월일·최근 로그인은 명단의 원본 값을 기본으로 쓴다.
function getRealMemberMeta(id) {
  const src = REAL_MEMBERS.find((m) => m.id === id) || {};
  // 명단에 없는 신규 가입자는 로그인 계정에 기록된 가입 시각·최근 로그인 시각을 그대로 쓴다
  const u = USERS_BY_ID[id];
  return Object.assign(
    {
      grade: "normal",
      // 로그인 계정이 없는 명단 회원의 관리자 승인 기록. 승인 버튼을 눌러야 true가 된다.
      approved: false,
      joinDate: src.joinDate || tsToYmd(u && u.createdAt),
      lastLogin: src.lastLogin || tsToYmd(u && u.lastLoginAt),
      note: "",
    },
    META_MAP[id]
  );
}

// Firestore 타임스탬프를 YYYY-MM-DD로. 값이 없으면 빈 문자열.
function tsToYmd(ts) {
  if (!ts || typeof ts.seconds !== "number") return "";
  const d = new Date(ts.seconds * 1000);
  return (
    d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0")
  );
}

function setRealMemberMeta(id, patch) {
  META_MAP[id] = Object.assign({}, getRealMemberMeta(id), patch); // 화면에 즉시 반영
  memberMetaRef(id)
    .set(patch, { merge: true })
    .catch((e) => showToast("저장하지 못했습니다: " + e.message));
}

/* 사이트 로그인 계정(Firestore users). 아이디를 키로 실회원 명단과 짝지어 한 표에 보여준다. */
let USERS_BY_ID = {};

/* 구회원 아이디 선점: 서버(legacyMembers)에 등록된 아이디 모음.
   여기 등록된 아이디로 가입하면 승인 절차 없이 바로 일반회원으로 이용할 수 있다. */
let LEGACY_IDS = new Set();

async function loadLegacyIds() {
  try {
    const snap = await db.collection(LEGACY_COL).get();
    LEGACY_IDS = new Set(snap.docs.map((d) => d.id));
  } catch (e) {
    LEGACY_IDS = new Set();
  }
}

// 실회원 명단의 아이디를 서버에 등록해, 구회원이 본인 아이디로 가입하면 바로 이용하게 한다.
async function registerLegacyIds() {
  const all = REAL_MEMBERS;
  const todo = all.filter((m) => !LEGACY_IDS.has(m.id));
  if (!todo.length) {
    showToast("이미 모든 구회원 아이디가 등록되어 있습니다.");
    return;
  }
  if (!confirm(`구회원 ${todo.length}명의 아이디를 등록합니다.\n등록된 아이디로 가입하면 승인 없이 바로 일반회원으로 이용할 수 있습니다.`)) return;

  showToast(`구회원 아이디 ${todo.length}건 등록 중...`);
  try {
    // Firestore 배치는 한 번에 500건까지라 400건씩 나눠 올린다
    for (let i = 0; i < todo.length; i += 400) {
      const batch = db.batch();
      todo.slice(i, i + 400).forEach((m) => {
        batch.set(db.collection(LEGACY_COL).doc(m.id), { unit: m.unit || "" });
      });
      await batch.commit();
    }
    await loadLegacyIds();
    showToast(`구회원 아이디 ${todo.length}건을 등록했습니다.`);
    renderRealMemberTable();
  } catch (e) {
    showToast("등록하지 못했습니다: " + e.message);
  }
}

/* 실회원 명단 + 로그인 계정을 아이디로 합친 회원 목록.
   - 명단에 있는 회원: 계정이 있으면 이메일·휴대폰·등급·승인상태를 계정 값으로 채운다.
   - 명단에 없는 신규 가입자: 계정만 있는 회원으로 뒤에 이어 붙인다. */
function memberRows(q) {
  const all = REAL_MEMBERS;
  const hidden = getHiddenRealMemberIds();

  const merged = all
    .filter((m) => !hidden.has(m.id))
    .map((m) => Object.assign({}, m, { user: USERS_BY_ID[m.id] || null }));

  const listed = new Set(merged.map((m) => m.id));
  Object.keys(USERS_BY_ID)
    .filter((id) => !listed.has(id) && !hidden.has(id))
    .forEach((id) => {
      const u = USERS_BY_ID[id];
      merged.push({ id: id, name: u.name || "", unit: u.unit || "", postCount: 0, user: u });
    });

  const query = (q || "").trim().toLowerCase();
  const rows = !query
    ? merged
    : merged.filter((m) =>
        [m.id, m.name, m.unit, m.user && m.user.email, m.user && m.user.phone]
          .some((v) => String(v || "").toLowerCase().includes(query))
      );

  // 가입일 내림차순(최근 가입이 위). 가입일이 비어 있는 회원은 맨 아래에 모은다.
  // 날짜는 YYYY-MM-DD 형태라 문자열 비교로 정렬해도 날짜 순서와 같다.
  const joinDateOf = {};
  rows.forEach((m) => (joinDateOf[m.id] = getRealMemberMeta(m.id).joinDate || ""));
  return rows.slice().sort((a, b) => {
    const da = joinDateOf[a.id];
    const db = joinDateOf[b.id];
    if (da === db) return 0;
    if (!da) return 1;
    if (!db) return -1;
    return da < db ? 1 : -1;
  });
}

/* 승인 버튼이 떠 있는 줄 — 로그인 계정이 있고 아직 승인되지 않은 회원.
   최고관리자 줄은 표에도 "승인됨"으로 나오고 Firestore 규칙(protected)이 막고 있어 뺀다.
   승인대기 숫자와 일괄 승인 대상이 어긋나지 않도록 두 곳에서 이 함수를 같이 쓴다. */
function pendingApprovalRows(rows) {
  return rows.filter((m) => m.user && !m.user.approved && m.user.grade !== "admin" && !m.user.protected);
}

function renderRealMemberTable() {
  const q = document.getElementById("real-member-search").value;
  const rows = memberRows(q);
  const withAccount = rows.filter((m) => m.user).length;
  const pendingRows = pendingApprovalRows(rows);
  document.getElementById("real-member-count").textContent =
    `총 ${rows.length}명 · 로그인 계정 ${withAccount}명 · 승인대기 ${pendingRows.length}명`;

  // 승인대기가 있을 때만 일괄 승인 버튼을 띄운다 (검색 중이면 지금 보이는 회원만 대상)
  const bulkWrap = document.getElementById("approve-all-wrap");
  if (bulkWrap) {
    bulkWrap.innerHTML = pendingRows.length
      ? `<button type="button" class="btn btn-outline btn-sm" id="approve-all-btn" onclick="onApproveAllPending()">승인대기 ${pendingRows.length}명 일괄 승인</button>`
      : "";
  }

  document.getElementById("real-member-table-wrap").innerHTML = `
    ${legacyIdNoticeHtml()}
    ${legacyMemberNoticeHtml()}
    <div class="sticky-table-wrap">
      <table class="board-table admin-table real-member-table">
        <thead>
          <tr>
            <th width="40">no</th><th width="120">id</th><th width="116">이름</th><th width="170">이메일</th>
            <th width="120">휴대폰번호</th><th width="90">호실</th><th width="104">가입일</th><th width="104">최근로그인</th>
            <th width="104">등급</th><th width="112">신청</th><th width="140">상태</th><th width="70">게시글수</th><th width="270">비고</th>
          </tr>
        </thead>
        <tbody>${
          rows.length
            ? rows.map((m, i) => memberRowHtml(m, i)).join("")
            : `<tr><td colspan="13" class="board-empty">검색 결과가 없습니다.</td></tr>`
        }</tbody>
      </table>
    </div>`;
}

// 구회원 아이디 선점 현황과 등록 버튼
function legacyIdNoticeHtml() {
  const all = REAL_MEMBERS;
  const done = all.filter((m) => LEGACY_IDS.has(m.id)).length;
  if (done >= all.length && all.length) {
    return `<p class="admin-note">구회원 아이디 ${done}명이 등록되어 있습니다.
      명단의 아이디로 가입하면 승인 절차 없이 바로 일반회원으로 로그인됩니다.</p>`;
  }
  return `<div class="content-edit-notice">
    구회원 ${all.length}명 중 ${done}명의 아이디만 등록되어 있습니다.
    등록해야 구회원이 본인 아이디로 가입할 때 승인 없이 바로 이용할 수 있습니다.
    <button type="button" class="btn btn-outline btn-sm" onclick="registerLegacyIds()">구회원 아이디 등록</button>
  </div>`;
}

/* 회원 한 줄.
   로그인 계정이 있는 회원의 등급·승인은 실제 계정 값을 바꾸고(사이트 권한이 즉시 바뀐다),
   계정이 없는 명단 회원의 등급·승인은 관리자가 적어 두는 기록이다. */
function memberRowHtml(m, i) {
  const meta = getRealMemberMeta(m.id);
  const u = m.user;
  const id = escM(m.id);

  /* 등급 선택상자. 모든 줄을 같은 모양으로 둔다.
     관리자처럼 목록에 없는 등급이면 현재 값을 항목으로 덧붙여 그대로 보이게 한다. */
  const gradeOptions = (cur) =>
    (cur === "normal" || cur === "special" ? "" : `<option value="${escM(cur)}" selected>${escM(gradeLabel(cur))}</option>`) +
    `<option value="normal" ${cur === "normal" ? "selected" : ""}>일반회원</option>` +
    `<option value="special" ${cur === "special" ? "selected" : ""}>특별회원</option>`;

  const grade = u
    ? `<select class="grade-select" onchange="onGrade('${escM(u.uid)}', this.value)">${gradeOptions(u.grade)}</select>`
    : `<select class="grade-select" onchange="onRealMemberGrade('${id}', this.value)">${gradeOptions(meta.grade)}</select>`;

  /* 신청: 가입할 때 낸 신청을 관리자가 승인하는 자리.
     구분소유자·임차인·건물관리자는 가입할 때 특별회원으로 신청할 수 있고, 승인하면 특별회원이
     되어 회원광장을 이용한다. 특별회원 신청이 아니면 일반회원으로 로그인만 승인한다.
     승인한 줄은 버튼이 "승인취소"로 바뀌어, 한 번 더 누르면 신청 상태로 되돌아간다. */
  let req;
  if (!u) {
    /* 로그인 계정이 아직 없는 명단 회원 — 관리사무소가 회원으로 확인했다는 표시를 남긴다.
       승인해 두면 본인이 그 아이디로 로그인할 때 새 비밀번호를 만들고 바로 이용할 수 있다. */
    req = meta.approved
      ? `<button type="button" class="mini" onclick="onMemberApprove('${id}', false)" title="승인 표시를 내리고, 이 아이디로 가입할 때 다시 관리자 승인을 받도록 되돌립니다">승인취소</button>`
      : `<button type="button" class="mini primary" onclick="onMemberApprove('${id}', true)" title="이 회원을 승인합니다. 본인 아이디로 로그인하면 새 비밀번호와 연락처를 직접 입력하고 바로 이용할 수 있습니다">승인</button>`;
  } else {
    const special = u.requestedSpecial || u.grade === "special";
    req = u.approved
      ? `<button type="button" class="mini" onclick="onApproveMember('${escM(u.uid)}', false)" title="승인을 취소합니다. 로그인할 수 없게 되고, 특별회원이면 일반회원으로 되돌아가 다시 신청 상태가 됩니다">승인취소</button>`
      : `<button type="button" class="mini primary" onclick="onApproveMember('${escM(u.uid)}', true)" title="${special ? "특별회원으로 승인합니다. 회원광장을 이용할 수 있게 됩니다" : "가입을 승인합니다. 바로 로그인할 수 있게 됩니다"}">승인</button>`;
  }

  /* 상태: 이 사이트에 로그인 계정이 있는지만 나타낸다.
     승인 여부는 신청 칸에서 다루므로, 아직 승인 전이라 로그인할 수 없을 때만 함께 표시한다. */
  const status = u
    ? `<span class="badge ok" title="이 사이트에 로그인 계정이 있습니다">계정있음</span>` +
      (u.approved ? "" : ` <span class="badge wait" title="아직 승인 전이라 로그인할 수 없습니다">승인대기</span>`)
    : `<span class="badge" title="실회원 명단에는 있으나 아직 이 사이트에 가입하지 않았습니다">계정없음</span>`;

  // 비고: 관리자가 적어 두는 메모 + 계정삭제
  const removeBtn = u
    ? `<button type="button" class="mini danger" onclick="onDelete('${escM(u.uid)}', '${id}')" title="이 회원의 로그인 계정을 삭제합니다">계정삭제</button>`
    : `<button type="button" class="mini danger" onclick="onDeleteRealMember('${id}')" title="아직 로그인 계정이 없는 회원입니다. 실회원 명단에서 삭제합니다">계정삭제</button>`;

  // data-label은 모바일에서 표를 세로 카드로 펼칠 때 각 값 앞에 붙는 항목 이름이다.
  return `<tr>
    <td data-label="no">${i + 1}</td>
    <td data-label="id" class="col-id">${id}</td>
    <td data-label="이름">${escM((u && u.name) || m.name)}</td>
    <td data-label="이메일" class="col-email">${escM((u && u.email) || "-")}</td>
    <td data-label="휴대폰번호">${escM((u && u.phone) || "-")}</td>
    <td data-label="호실">${escM((u && u.unit) || m.unit || "-")}</td>
    <td data-label="가입일"><input type="text" class="join-date-input" placeholder="YYYY-MM-DD" value="${escM(meta.joinDate)}" onchange="onRealMemberJoinDate('${id}', this.value)"></td>
    <td data-label="최근로그인"><input type="text" class="join-date-input" placeholder="YYYY-MM-DD" value="${escM(meta.lastLogin)}" onchange="onRealMemberLastLogin('${id}', this.value)"></td>
    <td data-label="등급">${grade}</td>
    <td data-label="신청" class="act col-req">${req}</td>
    <td data-label="상태" class="act">${status}</td>
    <td data-label="게시글수">${m.postCount || 0}</td>
    <td data-label="비고" class="act col-note">
      <input type="text" class="note-input" placeholder="메모" value="${escM(meta.note || "")}" onchange="onRealMemberNote('${id}', this.value)">
      ${removeBtn}
    </td>
  </tr>`;
}

function onRealMemberGrade(id, grade) {
  setRealMemberMeta(id, { grade });
}

function onRealMemberNote(id, note) {
  setRealMemberMeta(id, { note: note.trim() });
}

function onRealMemberJoinDate(id, joinDate) {
  setRealMemberMeta(id, { joinDate: joinDate.trim() });
}

function onRealMemberLastLogin(id, lastLogin) {
  setRealMemberMeta(id, { lastLogin: lastLogin.trim() });
}

/* ===== 옛 localStorage 회원관리 기록 서버로 옮기기 =====
   예전 방식으로 이 브라우저에만 저장돼 있던 등급·가입일·숨김 기록을 memberMeta로 이전한다. */
function legacyMemberMeta() {
  const out = {};
  try {
    const map = JSON.parse(localStorage.getItem(LEGACY_META_KEY)) || {};
    Object.keys(map).forEach((id) => (out[id] = Object.assign({}, map[id])));
  } catch (e) {
    /* 깨진 값은 무시 */
  }
  try {
    (JSON.parse(localStorage.getItem(LEGACY_HIDDEN_KEY)) || []).forEach((id) => {
      out[id] = Object.assign({}, out[id], { hidden: true });
    });
  } catch (e) {
    /* 깨진 값은 무시 */
  }
  // 이미 서버에 같은 내용이 있으면 옮길 필요가 없다
  Object.keys(out).forEach((id) => {
    const cur = META_MAP[id] || {};
    const same = Object.keys(out[id]).every((k) => cur[k] === out[id][k]);
    if (same) delete out[id];
  });
  return out;
}

function legacyMemberNoticeHtml() {
  const n = Object.keys(legacyMemberMeta()).length;
  if (!n) return "";
  return `<div class="content-edit-notice">
    이 브라우저에만 저장된 회원관리 기록이 ${n}건 있습니다. 서버로 옮기면 다른 PC에서도 반영됩니다.
    <button type="button" class="btn btn-outline btn-sm" onclick="migrateLegacyMemberMeta()">서버로 옮기기</button>
  </div>`;
}

async function migrateLegacyMemberMeta() {
  const map = legacyMemberMeta();
  const ids = Object.keys(map);
  if (!ids.length) return;
  try {
    const batch = db.batch();
    ids.forEach((id) => batch.set(memberMetaRef(id), map[id], { merge: true }));
    await batch.commit();
    localStorage.removeItem(LEGACY_META_KEY);
    localStorage.removeItem(LEGACY_HIDDEN_KEY);
    showToast(`회원관리 기록 ${ids.length}건을 서버로 옮겼습니다.`);
    renderRealMemberTable();
  } catch (e) {
    showToast("옮기지 못했습니다: " + e.message);
  }
}

let metaSubscribed = false;

async function renderAdmin() {
  if (!guardAdmin("admin-app")) return;

  document.getElementById("admin-app").innerHTML = '<p class="admin-note">불러오는 중...</p>';

  // 회원관리 기록을 먼저 불러온 뒤 표를 그리고, 이후 변경은 구독으로 받는다.
  if (!metaSubscribed) {
    metaSubscribed = true;
    try {
      const metaSnap = await db.collection(MEMBER_META_COL).get();
      META_MAP = {};
      metaSnap.docs.forEach((d) => (META_MAP[d.id] = d.data()));
    } catch (e) {
      /* 못 불러오면 명단의 기본값으로 표시한다 */
    }
    metaLoaded = true;
    subscribeMemberMeta();
  }

  // 실회원 명단과 구회원 아이디 목록 — 둘 다 관리자만 읽을 수 있는 컬렉션이다
  await loadRealMembers();
  await loadLegacyIds();

  // 로그인 계정을 아이디로 찾을 수 있게 담아 둔다 (실회원 명단과 한 표로 합쳐 보여준다)
  const snap = await db.collection(USERS_COL).get();
  USERS_BY_ID = {};
  snap.docs.forEach((d) => {
    const u = Object.assign({ uid: d.id }, d.data());
    if (u.id) USERS_BY_ID[u.id] = u;
  });

  document.getElementById("admin-app").innerHTML = `
    <div class="board-head">
      <h1>회원관리</h1>
      <div class="admin-head-right">
        <span class="pending-count" id="real-member-count">불러오는 중...</span>
        <span id="approve-all-wrap"></span>
      </div>
    </div>
    <p class="admin-note">janggyo.co.kr에서 가져온 실회원 명단과 이 사이트의 로그인 계정을 아이디로 합쳐 보여줍니다 (명단 기준일 2026-08-18).
    <strong>이메일·휴대폰번호</strong>는 로그인 계정에 등록된 값입니다.
    <strong>게시글수</strong>는 구 사이트 5개 게시판 전수 확인 결과입니다(admin 외 회원은 작성 이력이 없어 0건).
    <strong>상태</strong>는 이 사이트에 로그인 계정이 있는지를 나타냅니다 — <strong>계정있음</strong>은 가입을 마친 회원,
    <strong>계정없음</strong>은 명단에는 있으나 아직 가입하지 않은 회원입니다.
    <strong>신청</strong>은 가입할 때 낸 신청을 승인하는 자리입니다. 구분소유자·임차인·건물관리자는 가입할 때 특별회원으로
    신청할 수 있고, 승인하면 특별회원이 되어 회원광장(공지사항·자료실·결산보고서·월간회의록·관리비 부과내역)을
    이용할 수 있습니다. 승인 전에는 로그인할 수 없으며, 승인한 뒤 한 번 더 누르면 승인이 취소되어 신청 상태로 돌아갑니다.
    계정이 없는 회원의 등급과 <strong>가입일·최근로그인·비고</strong>는 관리자가 적어 두는 기록이며 모든 관리자 화면에 공유됩니다.</p>
    <div class="write-row" style="margin:16px 0;">
      <div class="field"><input type="text" id="real-member-search" placeholder="아이디·이름·호실·이메일·휴대폰 검색" oninput="renderRealMemberTable()"></div>
    </div>
    <div id="real-member-table-wrap"></div>`;

  renderRealMemberTable();
}

/* 신청 칸의 승인 ↔ 승인취소.
   승인하면 로그인할 수 있게 되고, 특별회원으로 신청한 회원은 등급도 특별회원이 된다.
   한 번 더 누르면(승인취소) 로그인 승인이 내려가고 신청 상태로 되돌아간다. */
async function onApproveMember(uid, accept) {
  const u = Object.keys(USERS_BY_ID).map((k) => USERS_BY_ID[k]).find((x) => x.uid === uid);
  const special = !!(u && (u.requestedSpecial || u.grade === "special"));

  const msg = accept
    ? special
      ? `이 회원을 특별회원으로 승인하시겠습니까?
회원광장(공지사항·자료실·결산보고서·월간회의록·관리비 부과내역)을 이용할 수 있게 됩니다.`
      : `이 회원의 가입을 승인하시겠습니까?
승인하면 바로 로그인할 수 있게 됩니다.`
    : special
      ? `승인을 취소하시겠습니까?
로그인할 수 없게 되고, 등급도 일반회원으로 되돌아가 다시 특별회원 신청 상태가 됩니다.`
      : `승인을 취소하시겠습니까?
이 회원은 로그인할 수 없게 됩니다.`;
  if (!confirm(msg)) return;

  try {
    await adminSetApproval(uid, accept, special);
    showToast(accept ? (special ? "특별회원으로 승인했습니다." : "승인했습니다.") : "승인을 취소했습니다.");
    renderAdmin();
  } catch (e) {
    showToast("처리하지 못했습니다: " + e.message);
    renderAdmin();
  }
}

async function onGrade(uid, grade) {
  try {
    await adminSetGrade(uid, grade);
  } catch (e) {
    showToast("등급을 바꾸지 못했습니다: " + e.message);
  }
  renderAdmin();
}

/* 승인대기 회원을 한 번에 승인한다.
   가입자가 몰린 뒤 한 명씩 누르던 일을 줄인다. 승인하면 바로 로그인할 수 있게 되므로,
   누구를 승인하는지 확인창에 이름을 적어 보여 준다.
   특별회원 신청은 구분소유자 확인이 필요한 별도 판단이라 여기서 함께 처리하지 않는다.
   (계정만 승인되고 "신청" 열의 승인·거절 버튼은 그대로 남는다) */
async function onApproveAllPending() {
  const targets = pendingApprovalRows(memberRows(document.getElementById("real-member-search").value));
  if (!targets.length) return;

  const shown = targets.slice(0, 10).map((m) => `${(m.user && m.user.name) || m.name || ""}(${m.id})`).join(", ");
  const more = targets.length > 10 ? ` 외 ${targets.length - 10}명` : "";
  if (
    !confirm(
      `승인대기 ${targets.length}명을 모두 승인하시겠습니까?

${shown}${more}

` +
        `승인하면 바로 로그인할 수 있게 됩니다. 특별회원 신청은 회원별로 따로 처리해 주세요.`
    )
  )
    return;

  const btn = document.getElementById("approve-all-btn");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "승인 중...";
  }

  // 한 명이 실패해도 나머지는 승인되도록 하나씩 처리하고, 실패한 아이디만 모아 알린다
  let done = 0;
  const failed = [];
  for (const m of targets) {
    try {
      await adminApprove(m.user.uid, true);
      done++;
    } catch (e) {
      failed.push(m.id);
    }
  }

  showToast(
    failed.length
      ? `${done}명 승인, ${failed.length}명 실패 (${failed.join(", ")})`
      : `${done}명을 승인했습니다.`
  );
  renderAdmin();
}

/* 계정이 없는 명단 회원의 승인 표시 (서버에 저장되어 모든 관리자 화면에 반영된다).

   승인은 "관리사무소가 확인한 회원"이라는 뜻이므로, 그 아이디를 구회원 명단(legacyMembers)에도
   함께 올린다. 그래야 이 회원이 로그인 화면에 본인 아이디를 넣었을 때 "홈페이지가 새롭게
   바뀌었습니다" 안내로 넘어가, 새 비밀번호와 연락처를 직접 입력하고 바로 로그인할 수 있다.
   승인 표시(memberMeta)는 관리자만 읽을 수 있어 로그인 화면에서는 참고할 수 없기 때문에,
   로그인 화면이 볼 수 있는 이 명단에 함께 적어 두어야 한다.
   승인을 취소하면 명단에서도 내려, 가입하더라도 다시 관리자 승인을 거치게 한다. */
async function onMemberApprove(id, approved) {
  setRealMemberMeta(id, { approved: approved });
  renderRealMemberTable();

  try {
    if (approved) {
      const m = REAL_MEMBERS.find((r) => r.id === id);
      await db.collection(LEGACY_COL).doc(id).set({ unit: (m && m.unit) || "" });
      LEGACY_IDS.add(id);
      showToast(`${id} 님을 승인했습니다. 이 아이디로 로그인하면 새 비밀번호를 만들고 바로 이용할 수 있습니다.`);
    } else {
      await db.collection(LEGACY_COL).doc(id).delete();
      LEGACY_IDS.delete(id);
      showToast(`${id} 님의 승인을 취소했습니다. 이 아이디로 가입하면 다시 관리자 승인을 받아야 합니다.`);
    }
  } catch (e) {
    showToast("구회원 아이디 등록을 바꾸지 못했습니다: " + e.message);
  }
  renderRealMemberTable();
}

/* 로그인 계정 삭제.
   Firestore의 회원 정보를 지운다. 프로필이 없으면 로그인해도 승인되지 않은 것으로 처리되어
   사이트를 쓸 수 없다. 다만 로그인에 쓰는 Firebase 인증 계정 자체는 Admin SDK(서버)가 있어야
   지울 수 있어, 그 부분은 콘솔에서 따로 지워야 한다는 것을 확인창에 적어 둔다. */
async function onDelete(uid, id) {
  if (
    !confirm(
      `'${id}' 회원의 계정을 정말로 삭제하시겠습니까?

` +
        `이 사이트의 회원 정보와 권한이 지워지며 되돌릴 수 없습니다.
` +
        `(로그인에 쓰는 Firebase 인증 계정 자체는 콘솔에서 따로 지워야 합니다)`
    )
  )
    return;
  try {
    await adminDeleteUser(uid);
    showToast(`'${id}' 회원의 계정을 삭제했습니다.`);
  } catch (e) {
    showToast("삭제하지 못했습니다: " + e.message);
  }
  renderAdmin();
}

/* 아직 로그인 계정이 없는 명단 회원 삭제.
   지울 계정이 없으므로 실회원 명단에서 내리고, 함께 적어 둔 관리 기록과 구회원 아이디
   등록도 같이 정리한다. */
async function onDeleteRealMember(id) {
  if (
    !confirm(
      `'${id}' 회원을 정말로 삭제하시겠습니까?

` +
        `아직 로그인 계정이 없는 회원이라 실회원 명단에서 지워집니다. 되돌릴 수 없습니다.`
    )
  )
    return;
  try {
    await db.collection(REAL_MEMBERS_COL).doc(id).delete();
    // 함께 남아 있던 관리 기록과 아이디 등록도 정리한다 (없으면 그냥 넘어간다)
    await memberMetaRef(id).delete().catch(() => {});
    await db.collection(LEGACY_COL).doc(id).delete().catch(() => {});
    showToast(`'${id}' 회원을 명단에서 삭제했습니다.`);
  } catch (e) {
    showToast("삭제하지 못했습니다: " + e.message);
  }
  renderAdmin();
}

window.onAuthReady(renderAdmin);
