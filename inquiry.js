// inquiry.js - 1:1 문의 (특별회원 작성, 관리자가 답변). auth.js 이후 로드.
// 게시판 형태: 목록 → "문의하기" 버튼으로 작성 → 상세보기 → 관리자는 "답변하기" 버튼으로 답변 입력.

const INQUIRY_KEY = "jangkyo_inquiries";

function loadInquiries() {
  try {
    const list = JSON.parse(localStorage.getItem(INQUIRY_KEY));
    if (Array.isArray(list)) return list;
  } catch (e) {}
  return [];
}

function saveInquiries(list) {
  localStorage.setItem(INQUIRY_KEY, JSON.stringify(list));
}

function escI(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;",
  })[c]);
}

function todayStr() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function myInquiries(sess, admin) {
  const all = loadInquiries();
  return admin ? all.slice().reverse() : all.filter((q) => q.authorId === sess.id).slice().reverse();
}

/* ===== 라우터 ===== */
function renderInquiry() {
  const app = document.getElementById("inquiry-app");
  if (!app) return;

  if (typeof isSpecial === "function" && !isSpecial()) {
    guardSpecial("inquiry-app");
    return;
  }
  const sess = typeof getSession === "function" ? getSession() : null;
  if (!sess) return;

  const admin = typeof isAdmin === "function" && isAdmin();
  const hash = location.hash || "#list";

  if (hash === "#write") {
    if (admin) { location.hash = "#list"; return; } // 관리자는 문의를 작성하지 않음
    return renderInquiryWrite();
  }
  if (hash.indexOf("#view/") === 0) {
    return renderInquiryDetail(hash.slice(6), sess, admin);
  }
  renderInquiryList(sess, admin);
}

/* ===== 목록 ===== */
function renderInquiryList(sess, admin) {
  const app = document.getElementById("inquiry-app");
  const list = myInquiries(sess, admin);

  const rows = list.length === 0
    ? `<tr><td colspan="4" class="board-empty">${admin ? "등록된 문의가 없습니다." : "아직 작성한 문의가 없습니다. 오른쪽 위 “문의하기” 버튼으로 남겨보세요."}</td></tr>`
    : list.map((q, i) => {
        const status = q.answer
          ? `<span class="badge ok">답변완료</span>`
          : `<span class="badge wait">답변대기</span>`;
        return `<tr>
          <td>${list.length - i}</td>
          <td class="title"><a href="#view/${q.id}">${escI(q.title)}</a></td>
          <td>${status}</td>
          <td>${q.date}</td>
        </tr>`;
      }).join("");

  const writeBtn = admin ? "" : `<a href="#write" class="btn btn-primary btn-sm">문의하기</a>`;

  app.innerHTML = `
    <div class="board-head">
      <h1>1:1 문의</h1>
      ${writeBtn}
    </div>
    <table class="board-table">
      <thead>
        <tr><th width="60">번호</th><th>제목</th><th width="100">상태</th><th width="110">작성일</th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

/* ===== 작성 ===== */
function renderInquiryWrite() {
  const app = document.getElementById("inquiry-app");
  app.innerHTML = `
    <div class="board-head"><h1>1:1 문의 · 문의하기</h1></div>
    <div class="poll-card poll-create">
      <input type="text" id="inq-title" class="poll-input" placeholder="제목을 입력하세요" />
      <textarea id="inq-content" class="poll-input" style="min-height:140px;resize:vertical" placeholder="문의 내용을 입력하세요"></textarea>
      <div class="btn-row" style="justify-content:flex-start">
        <button type="button" class="btn btn-primary btn-sm" onclick="submitInquiry()">등록</button>
        <a href="#list" class="btn btn-outline btn-sm">취소</a>
      </div>
    </div>`;
}

/* ===== 상세보기 ===== */
function renderInquiryDetail(id, sess, admin) {
  const app = document.getElementById("inquiry-app");
  const q = loadInquiries().find((x) => x.id === id);
  if (!q || !(admin || q.authorId === sess.id)) {
    location.hash = "#list";
    return;
  }

  const status = q.answer
    ? `<span class="badge ok">답변완료</span>`
    : `<span class="badge wait">답변대기</span>`;
  const meta = admin ? `작성자 ${escI(q.authorName)} · ${q.date}` : `${q.date}`;

  let answerBox;
  if (q.answer) {
    answerBox = `<div class="inq-answer">
      <strong>💬 답변</strong> <span style="color:#9aa3b5;font-size:12px">${escI(q.answerDate || "")}</span>
      <div style="margin-top:6px;white-space:pre-wrap">${escI(q.answer)}</div>
    </div>`;
  } else if (admin) {
    answerBox = `<div id="answer-slot">
      <div class="btn-row" style="justify-content:flex-start">
        <button type="button" class="btn btn-primary btn-sm" onclick="showAnswerForm('${q.id}')">답변하기</button>
      </div>
    </div>`;
  } else {
    answerBox = `<p class="poll-msg">아직 답변이 등록되지 않았습니다. 조금만 기다려 주세요.</p>`;
  }

  const canDelete = admin || q.authorId === sess.id;
  const delBtn = canDelete
    ? `<button type="button" class="mini danger" onclick="deleteInquiry('${q.id}')">삭제</button>`
    : "";

  app.innerHTML = `
    <div class="board-head"><h1>1:1 문의</h1></div>
    <div class="poll-card">
      <div class="poll-head"><h2 class="poll-q">${escI(q.title)}</h2>${status}</div>
      <div class="inq-meta">${meta}</div>
      <div class="view-body" style="padding:0 0 14px;min-height:0;white-space:pre-wrap">${escI(q.content)}</div>
      ${answerBox}
      <div class="btn-row" style="margin-top:14px">
        <a href="#list" class="btn btn-outline btn-sm">목록</a>
        ${delBtn}
      </div>
    </div>`;
}

/* 관리자: "답변하기" 클릭 시 입력창 표시 */
function showAnswerForm(id) {
  const slot = document.getElementById("answer-slot");
  if (!slot) return;
  slot.innerHTML = `
    <div class="inq-answer" style="background:#fff8ea;border-left-color:#c9a84c">
      <textarea id="ans-${id}" class="poll-input" style="min-height:90px;resize:vertical" placeholder="답변을 입력하세요" autofocus></textarea>
      <div class="btn-row" style="justify-content:flex-start;margin-top:8px">
        <button type="button" class="btn btn-primary btn-sm" onclick="answerInquiry('${id}')">답변 등록</button>
      </div>
    </div>`;
  const ta = document.getElementById("ans-" + id);
  if (ta) ta.focus();
}

/* ===== 회원: 문의 작성 ===== */
function submitInquiry() {
  const sess = getSession();
  if (!sess) {
    showToast("로그인이 필요합니다.");
    return;
  }
  const titleEl = document.getElementById("inq-title");
  const contentEl = document.getElementById("inq-content");
  const title = titleEl.value.trim();
  const content = contentEl.value.trim();
  if (!title || !content) {
    showToast("제목과 내용을 모두 입력해 주세요.");
    return;
  }
  const list = loadInquiries();
  const post = {
    id: "inq" + Date.now(),
    authorId: sess.id,
    authorName: sess.name,
    title,
    content,
    date: todayStr(),
    answer: null,
    answerDate: null,
  };
  list.push(post);
  saveInquiries(list);
  showToast("문의가 등록되었습니다. 답변까지 조금 기다려 주세요.");
  location.hash = "#view/" + post.id;
}

/* ===== 관리자: 답변 등록 ===== */
function answerInquiry(id) {
  if (!isAdmin()) return;
  const ta = document.getElementById("ans-" + id);
  const answer = ta.value.trim();
  if (!answer) {
    showToast("답변 내용을 입력해 주세요.");
    return;
  }
  const list = loadInquiries();
  const q = list.find((x) => x.id === id);
  if (q) {
    q.answer = answer;
    q.answerDate = todayStr();
    saveInquiries(list);
    showToast("답변이 등록되었습니다.");
    renderInquiry();
  }
}

/* ===== 삭제 (작성자 본인 또는 관리자) ===== */
function deleteInquiry(id) {
  const sess = getSession();
  const admin = typeof isAdmin === "function" && isAdmin();
  const list = loadInquiries();
  const q = list.find((x) => x.id === id);
  if (!q || !(admin || (sess && q.authorId === sess.id))) return;
  if (!confirm("이 문의를 삭제하시겠습니까?")) return;
  saveInquiries(list.filter((x) => x.id !== id));
  location.hash = "#list";
  renderInquiry();
}

window.addEventListener("DOMContentLoaded", renderInquiry);
window.addEventListener("hashchange", renderInquiry);
