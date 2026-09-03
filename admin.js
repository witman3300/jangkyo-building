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

// 기본값은 real-members-data.js의 값(관리자가 확정한 등급·가입년월일·최근 로그인)을 쓰고,
// 승인 여부는 이미 존재하는 실회원 수입 데이터이므로 승인됨으로 시작한다.
// 서버(memberMeta)에 값이 있으면 그 값이 우선한다.
function getRealMemberMeta(id) {
  const src = (typeof REAL_MEMBERS !== "undefined" ? REAL_MEMBERS : []).find((m) => m.id === id) || {};
  return Object.assign(
    {
      grade: src.grade || "normal",
      approved: src.approved !== false,
      joinDate: src.joinDate || "",
      lastLogin: src.lastLogin || "",
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

function realMemberRows(q) {
  const all = typeof REAL_MEMBERS !== "undefined" ? REAL_MEMBERS : [];
  const hidden = getHiddenRealMemberIds();
  const visible = all.filter((m) => !hidden.has(m.id));
  const query = (q || "").trim().toLowerCase();
  return !query
    ? visible
    : visible.filter((m) =>
        [m.id, m.name, m.unit].some((v) => String(v).toLowerCase().includes(query))
      );
}

function renderRealMemberTable() {
  const q = document.getElementById("real-member-search").value;
  const rows = realMemberRows(q);
  document.getElementById("real-member-count").textContent = `총 ${rows.length}명`;
  document.getElementById("real-member-table-wrap").innerHTML = `
    ${legacyMemberNoticeHtml()}
    <div class="sticky-table-wrap">
      <table class="board-table admin-table real-member-table">
        <thead>
          <tr>
            <th width="36">#</th><th width="90">아이디</th><th width="84">이름</th><th width="90">호수(별명)</th>
            <th width="100">가입년월일</th><th width="100">최근 로그인</th><th width="76">게시글수</th><th width="92">회원등급</th>
            <th width="132">신규회원 승인</th><th width="110">관리</th>
          </tr>
        </thead>
        <tbody>${
          rows.length
            ? rows.map((m, i) => {
                const meta = getRealMemberMeta(m.id);
                const gradeSel = `<select class="grade-select" onchange="onRealMemberGrade('${escM(m.id)}', this.value)">
                  <option value="normal" ${meta.grade === "normal" ? "selected" : ""}>일반회원</option>
                  <option value="special" ${meta.grade === "special" ? "selected" : ""}>특별회원</option>
                </select>`;
                const approveBtn = meta.approved
                  ? `<span class="badge ok">승인됨</span> <button type="button" class="mini" onclick="onRealMemberApprove('${escM(m.id)}', false)">취소</button>`
                  : `<span class="badge wait">승인대기</span> <button type="button" class="mini primary" onclick="onRealMemberApprove('${escM(m.id)}', true)">승인</button>`;
                return `<tr>
                  <td>${i + 1}</td>
                  <td>${escM(m.id)}</td>
                  <td>${escM(m.name)}</td>
                  <td>${escM(m.unit)}</td>
                  <td><input type="text" class="join-date-input" placeholder="YYYY-MM-DD" value="${escM(meta.joinDate)}" onchange="onRealMemberJoinDate('${escM(m.id)}', this.value)"></td>
                  <td><input type="text" class="join-date-input" placeholder="YYYY-MM-DD" value="${escM(meta.lastLogin)}" onchange="onRealMemberLastLogin('${escM(m.id)}', this.value)"></td>
                  <td>${m.postCount || 0}</td>
                  <td>${gradeSel}</td>
                  <td class="act">${approveBtn}</td>
                  <td class="act"><button type="button" class="mini danger" onclick="hideRealMember('${escM(m.id)}')">목록에서 제거</button></td>
                </tr>`;
              }).join("")
            : `<tr><td colspan="10" class="board-empty">검색 결과가 없습니다.</td></tr>`
        }</tbody>
      </table>
    </div>`;
}

function onRealMemberGrade(id, grade) {
  setRealMemberMeta(id, { grade });
}

function onRealMemberApprove(id, approved) {
  setRealMemberMeta(id, { approved });
  renderRealMemberTable();
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

  const snap = await db.collection(USERS_COL).get();
  const users = snap.docs.map((d) => Object.assign({ uid: d.id }, d.data()));
  const pending = users.filter((u) => !u.approved).length;

  const rows = users
    .map((u) => {
      const statusBadge = u.approved
        ? `<span class="badge ok">승인됨</span>`
        : `<span class="badge wait">승인대기</span>`;
      const req = u.requestedSpecial ? `<span class="badge req">특별 신청</span>` : "";
      const isAdminRow = u.grade === "admin";
      const protectedTag = u.protected ? ` <span class="badge admin" title="Firestore 보안 규칙으로 보호되어 앱에서는 등급 변경·삭제가 불가능합니다">🛡 최고관리자</span>` : "";

      // 등급 선택
      const gradeSel = isAdminRow
        ? gradeLabel(u.grade) + protectedTag
        : `<select onchange="onGrade('${u.uid}', this.value)">
             <option value="normal" ${u.grade === "normal" ? "selected" : ""}>일반회원</option>
             <option value="special" ${u.grade === "special" ? "selected" : ""}>특별회원</option>
           </select>`;

      // 액션 버튼
      let actions = "";
      if (!isAdminRow) {
        actions += u.approved
          ? `<button class="mini" onclick="onApprove('${u.uid}', false)">승인취소</button>`
          : `<button class="mini primary" onclick="onApprove('${u.uid}', true)">승인</button>`;
        actions += ` <button class="mini danger" onclick="onDelete('${u.uid}')">삭제</button>`;
      } else {
        actions = `<span style="color:#bbb">-</span>`;
      }

      return `<tr>
        <td>${escAuth(u.name)}</td>
        <td>${escAuth(u.phone || "미입력")}</td>
        <td>${escAuth(u.unit || "-")}</td>
        <td>${escAuth(u.id)}</td>
        <td>${escAuth(u.email || "-")}</td>
        <td>${gradeSel}</td>
        <td>${req || "-"}</td>
        <td>${statusBadge}</td>
        <td class="act">${actions}</td>
      </tr>`;
    })
    .join("");

  document.getElementById("admin-app").innerHTML = `
    <div class="board-head">
      <h1>회원관리</h1>
      <span class="pending-count" id="real-member-count">불러오는 중...</span>
    </div>
    <p class="admin-note">jangkyo.co.kr 관리자 페이지에서 가져온 실회원 명단입니다 (기준일 2026-08-18). 가입년월일·최근 로그인·게시글수는 원본 사이트의 실제 값입니다(게시글수는 자료실·임대안내·회원게시판·공지사항·결산보고서 5개 게시판 전수 확인 결과이며, admin 외 회원은 작성 이력이 없어 0건). 가입년월일·최근 로그인은 직접 수정하면 그 값이 우선 저장됩니다(이 브라우저에만 저장). 회원등급·신규회원 승인 값은 원본에 없어 이 화면에서 직접 기록하는 참고용 메모이며, "제거"와 마찬가지로 실제 명단·사이트 로그인 계정에는 영향을 주지 않습니다.</p>
    <div class="write-row" style="margin:16px 0;">
      <div class="field"><input type="text" id="real-member-search" placeholder="아이디·이름·호수 검색" oninput="renderRealMemberTable()"></div>
    </div>
    <div id="real-member-table-wrap"></div>

    <div class="board-head" style="margin-top:36px;">
      <h1>사이트 로그인 계정</h1>
      <span class="pending-count">승인대기 ${pending}명</span>
    </div>
    <table class="board-table admin-table">
      <thead>
        <tr>
          <th>이름</th><th width="130">휴대폰번호</th><th width="90">호실</th><th>아이디</th><th>이메일</th>
          <th width="130">등급</th><th width="90">신청</th>
          <th width="90">상태</th><th width="160">관리</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    <p class="admin-note">신규 가입자는 <strong>승인대기</strong> 상태이며, 승인 전에는 로그인할 수 없습니다.
    등급을 <strong>특별회원(구분소유자)</strong>으로 부여하면 공지사항·자료실·결산보고서·월간회의록·회원게시판을 이용할 수 있습니다.</p>`;

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
