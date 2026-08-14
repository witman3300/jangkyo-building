// admin.js - 관리자 회원관리 (실회원 명단 + 사이트 로그인 계정 승인/등급부여/삭제). auth.js 이후 로드 필요.

const REAL_MEMBER_HIDDEN_KEY = "jangkyo_real_members_hidden";

function escM(s) {
  return String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;",
  })[c]);
}

function getHiddenRealMemberIds() {
  try {
    return new Set(JSON.parse(localStorage.getItem(REAL_MEMBER_HIDDEN_KEY)) || []);
  } catch (e) {
    return new Set();
  }
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
    <table class="board-table admin-table">
      <thead>
        <tr><th width="50">#</th><th>아이디</th><th>이름</th><th>호수(별명)</th><th width="80">포인트</th><th width="100">최종접속</th><th width="110">관리</th></tr>
      </thead>
      <tbody>${
        rows.length
          ? rows.map((m, i) => `<tr>
              <td>${i + 1}</td>
              <td>${escM(m.id)}</td>
              <td>${escM(m.name)}</td>
              <td>${escM(m.unit)}</td>
              <td>${escM(m.points)}</td>
              <td>${escM(m.last)}</td>
              <td class="act"><button type="button" class="mini danger" onclick="hideRealMember('${escM(m.id)}')">목록에서 제거</button></td>
            </tr>`).join("")
          : `<tr><td colspan="7" class="board-empty">검색 결과가 없습니다.</td></tr>`
      }</tbody>
    </table>`;
}

function hideRealMember(id) {
  if (!confirm(`'${id}' 회원을 이 목록에서 제거하시겠습니까? (이 브라우저 화면에서만 숨겨지며, 실제 명단에는 영향이 없습니다)`)) return;
  const hidden = getHiddenRealMemberIds();
  hidden.add(id);
  localStorage.setItem(REAL_MEMBER_HIDDEN_KEY, JSON.stringify(Array.from(hidden)));
  renderRealMemberTable();
}

function renderAdmin() {
  if (!guardAdmin("admin-app")) return;

  const users = getUsers();
  const pending = users.filter((u) => !u.approved).length;

  const rows = users
    .map((u) => {
      const statusBadge = u.approved
        ? `<span class="badge ok">승인됨</span>`
        : `<span class="badge wait">승인대기</span>`;
      const req = u.requestedSpecial ? `<span class="badge req">특별 신청</span>` : "";
      const isAdminRow = u.grade === "admin";

      // 등급 선택
      const gradeSel = isAdminRow
        ? gradeLabel(u.grade)
        : `<select onchange="onGrade('${u.id}', this.value)">
             <option value="normal" ${u.grade === "normal" ? "selected" : ""}>일반회원</option>
             <option value="special" ${u.grade === "special" ? "selected" : ""}>특별회원</option>
           </select>`;

      // 액션 버튼
      let actions = "";
      if (!isAdminRow) {
        actions += u.approved
          ? `<button class="mini" onclick="onApprove('${u.id}', false)">승인취소</button>`
          : `<button class="mini primary" onclick="onApprove('${u.id}', true)">승인</button>`;
        actions += ` <button class="mini danger" onclick="onDelete('${u.id}')">삭제</button>`;
      } else {
        actions = `<span style="color:#bbb">-</span>`;
      }

      return `<tr>
        <td>${escAuth(u.name)}</td>
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
    <p class="admin-note">jangkyo.co.kr 관리자 페이지에서 가져온 실회원 명단입니다 (기준일 2026-08-14). "제거"는 이 브라우저 화면에서만 숨겨지며 실제 명단에는 영향이 없습니다.</p>
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
          <th>이름</th><th>아이디</th><th>이메일</th>
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

function onApprove(id, approved) {
  adminApprove(id, approved);
  renderAdmin();
}

function onGrade(id, grade) {
  adminSetGrade(id, grade);
  renderAdmin();
}

function onDelete(id) {
  if (!confirm(`'${id}' 회원을 삭제하시겠습니까?`)) return;
  adminDeleteUser(id);
  renderAdmin();
}

window.addEventListener("DOMContentLoaded", renderAdmin);
