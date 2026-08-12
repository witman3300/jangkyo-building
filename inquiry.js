// inquiry.js - 1:1 문의 (로그인 회원 누구나 작성, 관리자가 답변). auth.js 이후 로드.

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

/* ===== 화면 렌더 ===== */
function renderInquiry() {
  const app = document.getElementById("inquiry-app");
  if (!app) return;

  const sess = typeof getSession === "function" ? getSession() : null;
  if (!sess) {
    app.innerHTML = `<div class="board-head"><h1>1:1 문의</h1></div>
      <div class="lock-box">
        <div class="lock-icon">🔒</div>
        <h2>로그인이 필요합니다</h2>
        <p>1:1 문의는 로그인한 회원만 작성하고 확인할 수 있습니다.</p>
        <div class="btn-row">
          <a href="login.html" class="btn btn-primary btn-sm">로그인</a>
          <a href="signup.html" class="btn btn-outline btn-sm">회원가입</a>
        </div>
      </div>`;
    return;
  }

  const admin = typeof isAdmin === "function" && isAdmin();
  const all = loadInquiries();
  const mine = admin ? all.slice().reverse() : all.filter((q) => q.authorId === sess.id).slice().reverse();

  const writeForm = admin
    ? ""
    : `<div class="poll-card poll-create">
        <h2 class="poll-q">✎ 새 문의 작성</h2>
        <input type="text" id="inq-title" class="poll-input" placeholder="제목을 입력하세요" />
        <textarea id="inq-content" class="poll-input" style="min-height:120px;resize:vertical" placeholder="문의 내용을 입력하세요"></textarea>
        <div class="btn-row" style="justify-content:flex-start">
          <button type="button" class="btn btn-primary btn-sm" onclick="submitInquiry()">문의 등록</button>
        </div>
      </div>`;

  let list;
  if (mine.length === 0) {
    list = `<p class="poll-msg">${admin ? "등록된 문의가 없습니다." : "아직 작성한 문의가 없습니다. 위에서 새 문의를 남겨보세요."}</p>`;
  } else {
    list = mine.map((q) => renderInquiryCard(q, sess, admin)).join("");
  }

  app.innerHTML = `<div class="board-head"><h1>1:1 문의</h1></div>${writeForm}${list}`;
}

function renderInquiryCard(q, sess, admin) {
  const answered = !!q.answer;
  const status = answered
    ? `<span class="badge ok">답변완료</span>`
    : `<span class="badge wait">답변대기</span>`;

  const meta = admin
    ? `작성자 ${escI(q.authorName)} · ${q.date}`
    : `${q.date}`;

  const answerBox = answered
    ? `<div class="inq-answer">
        <strong>💬 답변</strong> <span style="color:#9aa3b5;font-size:12px">${escI(q.answerDate || "")}</span>
        <div style="margin-top:6px;white-space:pre-wrap">${escI(q.answer)}</div>
      </div>`
    : admin
    ? `<div class="inq-answer" style="background:#fff8ea;border-left-color:#c9a84c">
        <textarea id="ans-${q.id}" class="poll-input" style="min-height:90px;resize:vertical" placeholder="답변을 입력하세요"></textarea>
        <div class="btn-row" style="justify-content:flex-start;margin-top:8px">
          <button type="button" class="btn btn-primary btn-sm" onclick="answerInquiry('${q.id}')">답변 등록</button>
        </div>
      </div>`
    : `<p class="poll-msg">아직 답변이 등록되지 않았습니다. 조금만 기다려 주세요.</p>`;

  const canDelete = admin || q.authorId === sess.id;
  const delBtn = canDelete
    ? `<div class="btn-row" style="justify-content:flex-start">
        <button type="button" class="mini danger" onclick="deleteInquiry('${q.id}')">삭제</button>
      </div>`
    : "";

  return `<div class="poll-card">
    <div class="poll-head"><h2 class="poll-q">${escI(q.title)}</h2>${status}</div>
    <div class="inq-meta">${meta}</div>
    <div class="view-body" style="padding:0 0 14px;min-height:0">${escI(q.content)}</div>
    ${answerBox}
    ${delBtn}
  </div>`;
}

/* ===== 회원: 문의 작성 ===== */
function submitInquiry() {
  const sess = getSession();
  if (!sess) {
    alert("로그인이 필요합니다.");
    return;
  }
  const titleEl = document.getElementById("inq-title");
  const contentEl = document.getElementById("inq-content");
  const title = titleEl.value.trim();
  const content = contentEl.value.trim();
  if (!title || !content) {
    alert("제목과 내용을 모두 입력해 주세요.");
    return;
  }
  const list = loadInquiries();
  list.push({
    id: "inq" + Date.now(),
    authorId: sess.id,
    authorName: sess.name,
    title,
    content,
    date: todayStr(),
    answer: null,
    answerDate: null,
  });
  saveInquiries(list);
  alert("문의가 등록되었습니다. 답변까지 조금 기다려 주세요.");
  renderInquiry();
}

/* ===== 관리자: 답변 등록 ===== */
function answerInquiry(id) {
  if (!isAdmin()) return;
  const ta = document.getElementById("ans-" + id);
  const answer = ta.value.trim();
  if (!answer) {
    alert("답변 내용을 입력해 주세요.");
    return;
  }
  const list = loadInquiries();
  const q = list.find((x) => x.id === id);
  if (q) {
    q.answer = answer;
    q.answerDate = todayStr();
    saveInquiries(list);
    alert("답변이 등록되었습니다.");
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
  renderInquiry();
}

window.addEventListener("DOMContentLoaded", renderInquiry);
