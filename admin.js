// admin.js - 관리자 회원관리 (실회원 명단 + 사이트 로그인 계정 승인/등급부여/삭제). auth.js 이후 로드 필요.

/* 실회원 명단에는 등급/승인/가입일 정보가 원본 CSV에 없으므로, 관리자가 이 화면에서 직접 기록한다.
   예전에는 이 기록을 localStorage에 넣어 기록한 그 브라우저에서만 보였는데, 이제는 Firestore
   memberMeta 컬렉션(문서ID = 실회원 아이디)에 저장해 어느 PC에서 고쳐도 모든 관리자에게 반영된다.
   사이트 로그인 계정(아래 "사이트 로그인 계정" 표)과는 별개의 명단이다. */
const MEMBER_META_COL = "memberMeta";
const LEGACY_HIDDEN_KEY = "jangkyo_real_members_hidden"; // 옛 localStorage 키 (이전 대상)
const LEGACY_META_KEY = "jangkyo_real_members_meta";

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

// real-members-data.js에 hidden:true로 확정된 회원 + 서버에서 숨김 처리된 회원
function getHiddenRealMemberIds() {
  const fixed = (typeof REAL_MEMBERS !== "undefined" ? REAL_MEMBERS : [])
    .filter((m) => m.hidden)
    .map((m) => m.id);
  const remote = Object.keys(META_MAP).filter((id) => META_MAP[id].hidden);
  return new Set(fixed.concat(remote));
}

// 구회원(실회원 명단)은 모두 일반회원으로 시작한다. 관리자가 이 화면에서 특별회원으로 바꾸면
// 그 값이 memberMeta에 저장되어 모든 관리자 화면에 반영된다.
// 가입년월일·최근 로그인은 real-members-data.js의 원본 값을 기본으로 쓴다.
function getRealMemberMeta(id) {
  const src = (typeof REAL_MEMBERS !== "undefined" ? REAL_MEMBERS : []).find((m) => m.id === id) || {};
  return Object.assign(
    {
      grade: "normal",
      approved: src.approved !== false,
      joinDate: src.joinDate || "",
      lastLogin: src.lastLogin || "",
      note: "",
    },
    META_MAP[id]
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

/* 실회원 명단 + 로그인 계정을 아이디로 합친 회원 목록.
   - 명단에 있는 회원: 계정이 있으면 이메일·휴대폰·등급·승인상태를 계정 값으로 채운다.
   - 명단에 없는 신규 가입자: 계정만 있는 회원으로 뒤에 이어 붙인다. */
function memberRows(q) {
  const all = typeof REAL_MEMBERS !== "undefined" ? REAL_MEMBERS : [];
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
  if (!query) return merged;
  return merged.filter((m) =>
    [m.id, m.name, m.unit, m.user && m.user.email, m.user && m.user.phone]
      .some((v) => String(v || "").toLowerCase().includes(query))
  );
}

function renderRealMemberTable() {
  const q = document.getElementById("real-member-search").value;
  const rows = memberRows(q);
  const withAccount = rows.filter((m) => m.user).length;
  const pending = rows.filter((m) => m.user && !m.user.approved).length;
  document.getElementById("real-member-count").textContent =
    `총 ${rows.length}명 · 로그인 계정 ${withAccount}명 · 승인대기 ${pending}명`;

  document.getElementById("real-member-table-wrap").innerHTML = `
    ${legacyMemberNoticeHtml()}
    <div class="sticky-table-wrap">
      <table class="board-table admin-table real-member-table">
        <thead>
          <tr>
            <th width="40">no</th><th width="96">id</th><th width="92">이름</th><th width="170">이메일</th>
            <th width="120">휴대폰번호</th><th width="90">호실</th><th width="104">가입일</th><th width="104">최근로그인</th>
            <th width="104">등급</th><th width="76">신청</th><th width="140">상태</th><th width="70">게시글수</th><th width="210">비고</th>
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

/* 회원 한 줄.
   로그인 계정이 있는 회원의 등급·승인은 실제 계정 값을 바꾸고(사이트 권한이 즉시 바뀐다),
   계정이 없는 명단 회원의 등급·승인은 관리자가 적어 두는 기록이다. */
function memberRowHtml(m, i) {
  const meta = getRealMemberMeta(m.id);
  const u = m.user;
  const id = escM(m.id);
  const isAdminRow = !!(u && u.grade === "admin");

  const grade = isAdminRow
    ? gradeLabel(u.grade) +
      (u.protected
        ? ` <span class="badge admin" title="Firestore 보안 규칙으로 보호되어 앱에서는 등급 변경·삭제가 불가능합니다">🛡</span>`
        : "")
    : u
      ? `<select class="grade-select" onchange="onGrade('${escM(u.uid)}', this.value)">
           <option value="normal" ${u.grade === "normal" ? "selected" : ""}>일반회원</option>
           <option value="special" ${u.grade === "special" ? "selected" : ""}>특별회원</option>
         </select>`
      : `<select class="grade-select" onchange="onRealMemberGrade('${id}', this.value)">
           <option value="normal" ${meta.grade === "normal" ? "selected" : ""}>일반회원</option>
           <option value="special" ${meta.grade === "special" ? "selected" : ""}>특별회원</option>
         </select>`;

  const req = u && u.requestedSpecial ? `<span class="badge req">특별 신청</span>` : "-";

  let status;
  if (!u) {
    status = `<span class="badge">계정없음</span>`;
  } else if (isAdminRow) {
    status = `<span class="badge ok">승인됨</span>`;
  } else if (u.approved) {
    status = `<span class="badge ok">승인됨</span> <button type="button" class="mini" onclick="onApprove('${escM(u.uid)}', false)">취소</button>`;
  } else {
    status = `<span class="badge wait">승인대기</span> <button type="button" class="mini primary" onclick="onApprove('${escM(u.uid)}', true)">승인</button>`;
  }

  // 비고: 관리자가 적어 두는 메모 + 정리 버튼 (최고관리자 줄에는 버튼을 두지 않는다)
  const removeBtn = isAdminRow
    ? ""
    : u
      ? `<button type="button" class="mini danger" onclick="onDelete('${escM(u.uid)}')" title="사이트 로그인 계정을 삭제합니다">계정삭제</button>`
      : `<button type="button" class="mini danger" onclick="hideRealMember('${id}')" title="이 목록에서만 감춥니다">목록제거</button>`;

  return `<tr>
    <td>${i + 1}</td>
    <td>${id}</td>
    <td>${escM((u && u.name) || m.name)}</td>
    <td class="col-email">${escM((u && u.email) || "-")}</td>
    <td>${escM((u && u.phone) || "-")}</td>
    <td>${escM((u && u.unit) || m.unit || "-")}</td>
    <td><input type="text" class="join-date-input" placeholder="YYYY-MM-DD" value="${escM(meta.joinDate)}" onchange="onRealMemberJoinDate('${id}', this.value)"></td>
    <td><input type="text" class="join-date-input" placeholder="YYYY-MM-DD" value="${escM(meta.lastLogin)}" onchange="onRealMemberLastLogin('${id}', this.value)"></td>
    <td>${grade}</td>
    <td>${req}</td>
    <td class="act">${status}</td>
    <td>${m.postCount || 0}</td>
    <td class="act col-note">
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

function hideRealMember(id) {
  if (!confirm(`'${id}' 회원을 이 목록에서 제거하시겠습니까? (모든 관리자 화면에서 숨겨지며, 실제 명단 데이터에는 영향이 없습니다)`)) return;
  setRealMemberMeta(id, { hidden: true });
  renderRealMemberTable();
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
      /* 못 불러오면 real-members-data.js의 기본값으로 표시한다 */
    }
    metaLoaded = true;
    subscribeMemberMeta();
  }

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
      <span class="pending-count" id="real-member-count">불러오는 중...</span>
    </div>
    <p class="admin-note">janggyo.co.kr에서 가져온 실회원 명단과 이 사이트의 로그인 계정을 아이디로 합쳐 보여줍니다 (명단 기준일 2026-08-18).
    <strong>이메일·휴대폰번호·신청</strong>은 로그인 계정에 등록된 값이고, 계정이 없는 회원은 상태가 <strong>계정없음</strong>으로 표시됩니다.
    <strong>게시글수</strong>는 구 사이트 5개 게시판 전수 확인 결과입니다(admin 외 회원은 작성 이력이 없어 0건).
    <strong>등급·상태</strong>는 계정이 있는 회원의 경우 실제 사이트 권한을 바꾸며, 승인 전에는 로그인할 수 없습니다.
    특별회원(구분소유자)이 되면 회원광장(공지사항·자료실·결산보고서·월간회의록·관리비 부과내역)을 이용할 수 있습니다.
    계정이 없는 회원의 등급과 <strong>가입일·최근로그인·비고</strong>는 관리자가 적어 두는 기록이며 모든 관리자 화면에 공유됩니다.</p>
    <div class="write-row" style="margin:16px 0;">
      <div class="field"><input type="text" id="real-member-search" placeholder="아이디·이름·호실·이메일·휴대폰 검색" oninput="renderRealMemberTable()"></div>
    </div>
    <div id="real-member-table-wrap"></div>`;

  renderRealMemberTable();
}

async function onApprove(uid, approved) {
  await adminApprove(uid, approved);
  renderAdmin();
}

async function onGrade(uid, grade) {
  await adminSetGrade(uid, grade);
  renderAdmin();
}

async function onDelete(uid) {
  if (!confirm(`이 회원을 삭제하시겠습니까? (사이트 접근 권한만 제거되며, 로그인 계정 자체는 Firebase 콘솔에서 별도로 삭제해야 합니다)`)) return;
  await adminDeleteUser(uid);
  renderAdmin();
}

window.onAuthReady(renderAdmin);
