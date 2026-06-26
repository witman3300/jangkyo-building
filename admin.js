// admin.js - 관리자 회원관리 (승인 / 등급부여 / 삭제). auth.js 이후 로드 필요.

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
    등급을 <strong>특별회원</strong>으로 부여하면 공지사항·자료실·결산보고서·월간회의록·회원게시판을 이용할 수 있습니다.</p>`;
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
