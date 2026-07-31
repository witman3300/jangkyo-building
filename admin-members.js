// admin-members.js - 실회원(jangkyo.co.kr) 정보 조회/관리
// members.csv는 개인정보라 git에 올리지 않음(.gitignore). 로컬 개발 환경에만 존재하며
// 공개 배포 사이트(GitHub Pages)에는 파일 자체가 없어 관리자가 로컬에서만 사용할 수 있다.

const REAL_MEMBERS_KEY = "jangkyo_real_members";

function splitCsvLine(line) {
  const result = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else { inQuotes = false; }
      } else cur += c;
    } else {
      if (c === ",") { result.push(cur); cur = ""; }
      else if (c === '"') { inQuotes = true; }
      else cur += c;
    }
  }
  result.push(cur);
  return result;
}

function parseCsv(text) {
  const clean = text.replace(/^﻿/, "").replace(/\r\n/g, "\n");
  const lines = clean.split("\n").filter((l) => l.length > 0);
  if (lines.length === 0) return [];
  const headers = splitCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const vals = splitCsvLine(line);
    const obj = {};
    headers.forEach((h, i) => { obj[h] = vals[i] || ""; });
    return obj;
  });
}

function loadRealMembers() {
  try {
    const cached = JSON.parse(localStorage.getItem(REAL_MEMBERS_KEY));
    if (Array.isArray(cached) && cached.length) return Promise.resolve(cached);
  } catch (e) {}
  return fetch("members.csv")
    .then((res) => {
      if (!res.ok) throw new Error("not found");
      return res.text();
    })
    .then((text) => {
      const rows = parseCsv(text);
      localStorage.setItem(REAL_MEMBERS_KEY, JSON.stringify(rows));
      return rows;
    });
}

function escM(s) {
  return String(s || "").replace(/[&<>"]/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;",
  })[c]);
}

let realMembersCache = [];

function renderMemberTable(list) {
  const rows = list
    .map((m, i) => `<tr>
      <td>${i + 1}</td>
      <td>${escM(m.mb_id)}</td>
      <td>${escM(m.name)}</td>
      <td>${escM(m.unit_or_nick)}</td>
      <td>${escM(m.email)}</td>
      <td>Lv.${escM(m.level)}</td>
      <td>${escM(m.join_date)}</td>
      <td class="act"><button type="button" class="mini danger" onclick="removeRealMember('${escM(m.mb_id)}')">목록에서 제거</button></td>
    </tr>`)
    .join("");

  document.getElementById("member-table-wrap").innerHTML = `
    <table class="board-table admin-table">
      <thead>
        <tr>
          <th width="40">#</th><th>아이디</th><th>이름</th><th>호수</th>
          <th>이메일</th><th width="70">등급</th><th width="100">가입일</th><th width="120">관리</th>
        </tr>
      </thead>
      <tbody>${rows || `<tr><td colspan="8" class="board-empty">검색 결과가 없습니다.</td></tr>`}</tbody>
    </table>`;
}

function applyFilter() {
  const q = document.getElementById("member-search").value.trim().toLowerCase();
  const filtered = !q
    ? realMembersCache
    : realMembersCache.filter((m) =>
        [m.mb_id, m.name, m.unit_or_nick, m.email].some((v) =>
          String(v || "").toLowerCase().includes(q)
        )
      );
  document.getElementById("member-count").textContent = `총 ${filtered.length}명 (전체 ${realMembersCache.length}명)`;
  renderMemberTable(filtered);
}

function removeRealMember(mbId) {
  if (!confirm(`'${mbId}' 회원을 이 목록에서 제거하시겠습니까? (실제 사이트에는 영향 없음, 이 브라우저 화면에서만 제거됩니다)`)) return;
  realMembersCache = realMembersCache.filter((m) => m.mb_id !== mbId);
  localStorage.setItem(REAL_MEMBERS_KEY, JSON.stringify(realMembersCache));
  applyFilter();
}

function renderMembersApp() {
  if (!guardAdmin("admin-members-app")) return;

  document.getElementById("admin-members-app").innerHTML = `
    <div class="board-head">
      <h1>실회원 정보</h1>
      <span class="pending-count" id="member-count">불러오는 중...</span>
      <a href="admin.html" class="btn btn-outline btn-sm">← 회원관리</a>
    </div>
    <p class="admin-note">jangkyo.co.kr 관리자 페이지에서 가져온 실제 회원 명단입니다. 개인정보이므로 <strong>members.csv 파일은 git에 포함되지 않으며</strong>,
    이 화면도 로컬에 해당 파일이 있을 때만(관리자가 직접 내려받아 프로젝트 폴더에 둔 경우) 동작합니다. "제거"는 이 브라우저 화면에서만 지워지며 실제 사이트 회원에는 영향을 주지 않습니다.</p>
    <div class="write-row" style="margin:16px 0;">
      <div class="field"><input type="text" id="member-search" placeholder="아이디·이름·호수·이메일 검색" oninput="applyFilter()"></div>
    </div>
    <div id="member-table-wrap"></div>`;

  loadRealMembers()
    .then((rows) => {
      realMembersCache = rows;
      applyFilter();
    })
    .catch(() => {
      document.getElementById("member-count").textContent = "";
      document.getElementById("member-table-wrap").innerHTML = `
        <div class="admin-note" style="color:#c0392b;">members.csv 파일을 찾을 수 없습니다. 이 화면은 로컬 개발 환경에서 members.csv를 프로젝트 루트에 둔 경우에만 동작합니다.
        (개인정보 보호를 위해 이 파일은 git 저장소와 공개 사이트에는 올라가지 않습니다.)</div>`;
    });
}

window.addEventListener("DOMContentLoaded", renderMembersApp);
