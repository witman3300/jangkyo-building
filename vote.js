// vote.js - 회원 투표 (관리자가 주제 생성/마감/삭제, 회원이 참여). auth.js 이후 로드.

const POLLS_KEY = "jangkyo_polls_v1";

function loadPolls() {
  try {
    const p = JSON.parse(localStorage.getItem(POLLS_KEY));
    if (Array.isArray(p)) return p;
  } catch (e) {}
  return [];
}

function savePolls(polls) {
  localStorage.setItem(POLLS_KEY, JSON.stringify(polls));
}

// 공지사항 게시판과 동일한 저장소 (board.js 와 공유)
const BOARD_KEY = "jangkyo_board_posts";
let noticeSeq = 0;

function addNoticePost(title, content) {
  let posts;
  try {
    posts = JSON.parse(localStorage.getItem(BOARD_KEY)) || [];
  } catch (e) {
    posts = [];
  }
  const now = new Date();
  const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  posts.push({
    id: "pv" + Date.now() + "_" + noticeSeq++,
    cat: "notice",
    title: title,
    author: "관리자(자동)",
    content: content,
    date: date,
    files: [],
  });
  localStorage.setItem(BOARD_KEY, JSON.stringify(posts));
}

// 마감 결과 본문 구성
function buildResultText(poll) {
  const total = poll.counts.reduce((a, b) => a + b, 0);
  const lines = poll.options
    .map((o, i) => {
      const c = poll.counts[i];
      const pct = total ? Math.round((c / total) * 100) : 0;
      return `- ${o}: ${c}표 (${pct}%)`;
    })
    .join("\n");
  let winLine;
  if (total === 0) {
    winLine = "\n\n※ 참여자가 없습니다.";
  } else {
    const max = Math.max.apply(null, poll.counts);
    const winners = poll.options.filter((o, i) => poll.counts[i] === max);
    winLine = `\n\n▶ 최다 득표: ${winners.join(", ")} (${max}표)`;
  }
  const dl = poll.deadline ? `\n마감일: ${poll.deadline.replace("T", " ")}` : "";
  return `투표가 마감되어 결과를 안내드립니다.\n\n[주제] ${poll.question}\n총 투표수: ${total}표${dl}\n\n${lines}${winLine}`;
}

// 마감되었으나 아직 공지하지 않은 투표 → 공지사항 자동 게시
function announceClosedPolls() {
  const polls = loadPolls();
  let changed = false;
  polls.forEach((poll) => {
    if (isClosed(poll) && !poll.announced) {
      addNoticePost(`[투표결과] ${poll.question}`, buildResultText(poll));
      poll.announced = true;
      changed = true;
    }
  });
  if (changed) savePolls(polls);
}

function escV(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;",
  })[c]);
}

// 마감일이 지났는지
function isExpired(poll) {
  return !!(poll.deadline && new Date(poll.deadline).getTime() <= Date.now());
}

// 실제 종료 여부 (관리자 마감 OR 기한 종료)
function isClosed(poll) {
  return !poll.open || isExpired(poll);
}

// 마감일 표시 문자열
function deadlineText(poll) {
  if (!poll.deadline) return "";
  const d = new Date(poll.deadline);
  const fmt = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  if (isExpired(poll)) return `마감일 ${fmt} (종료됨)`;
  // 남은 시간
  let diff = Math.floor((d.getTime() - Date.now()) / 1000);
  const day = Math.floor(diff / 86400);
  diff %= 86400;
  const hr = Math.floor(diff / 3600);
  const min = Math.floor((diff % 3600) / 60);
  const remain = day > 0 ? `${day}일 ${hr}시간 남음` : hr > 0 ? `${hr}시간 ${min}분 남음` : `${min}분 남음`;
  return `마감 ${fmt} · ${remain}`;
}

/* ===== 화면 렌더 ===== */
function renderVote() {
  announceClosedPolls(); // 마감된 투표 결과를 공지사항에 자동 게시
  const app = document.getElementById("vote-app");
  if (!app) return; // 투표 페이지가 아니면 공지 처리만 하고 종료
  const polls = loadPolls();
  const admin = typeof isAdmin === "function" && isAdmin();
  const sess = typeof getSession === "function" ? getSession() : null;

  // 관리자 전용 투표 생성 폼
  const createForm = admin
    ? `<div class="poll-card poll-create">
        <h2 class="poll-q">＋ 새 투표 만들기</h2>
        <input type="text" id="new-q" class="poll-input" placeholder="투표 주제를 입력하세요" />
        <div id="new-opts" class="poll-create-opts">
          <input type="text" class="poll-input opt-input" placeholder="항목 1" />
          <input type="text" class="poll-input opt-input" placeholder="항목 2" />
        </div>
        <label class="poll-deadline-label">마감일시 (선택 — 지정 시 자동 종료)</label>
        <input type="datetime-local" id="new-deadline" class="poll-input" />
        <div class="btn-row" style="justify-content:flex-start">
          <button type="button" class="mini" onclick="addOptionField()">＋ 항목 추가</button>
          <button type="button" class="btn btn-primary btn-sm" onclick="createPoll()">투표 등록</button>
        </div>
      </div>`
    : "";

  // 투표 목록 (최신순)
  let list;
  if (polls.length === 0) {
    list = `<p class="poll-msg">${admin ? "등록된 투표가 없습니다. 위에서 새 투표를 만들어 보세요." : "현재 진행 중인 투표가 없습니다."}</p>`;
  } else {
    list = polls
      .slice()
      .reverse()
      .map((poll) => renderPollCard(poll, sess, admin))
      .join("");
  }

  app.innerHTML = `<div class="board-head"><h1>투표</h1></div>${createForm}${list}`;
}

function renderPollCard(poll, sess, admin) {
  const total = poll.counts.reduce((a, b) => a + b, 0);
  const voted = sess && poll.voters.includes(sess.id);

  const results = poll.options
    .map((opt, i) => {
      const cnt = poll.counts[i];
      const pct = total ? Math.round((cnt / total) * 100) : 0;
      return `<div class="poll-result">
        <div class="poll-result-label"><span>${escV(opt)}</span><span>${pct}% (${cnt}표)</span></div>
        <div class="poll-bar"><div class="poll-bar-fill" style="width:${pct}%"></div></div>
      </div>`;
    })
    .join("");

  // 투표 입력 / 안내
  const closed = isClosed(poll);
  let voteBox = "";
  if (closed) {
    voteBox = `<p class="poll-msg done">🔒 마감된 투표입니다.${isExpired(poll) ? " (마감일 도달)" : ""}</p>`;
  } else if (!sess) {
    voteBox = `<p class="poll-msg">투표하려면 <a href="login.html">로그인</a>이 필요합니다.</p>`;
  } else if (voted) {
    voteBox = `<p class="poll-msg done">✅ 이미 투표에 참여하셨습니다. 감사합니다!</p>`;
  } else {
    const opts = poll.options
      .map(
        (opt, i) => `<label class="poll-option">
          <input type="radio" name="poll-${poll.id}" value="${i}" /> ${escV(opt)}
        </label>`
      )
      .join("");
    voteBox = `<form onsubmit="submitVote(event, '${poll.id}')">
      <div class="poll-options">${opts}</div>
      <div class="btn-row" style="justify-content:flex-start">
        <button type="submit" class="btn btn-primary btn-sm">투표하기</button>
      </div>
    </form>`;
  }

  const adminCtrl = admin
    ? `<div class="btn-row poll-admin" style="justify-content:flex-start">
        <button class="mini" onclick="togglePoll('${poll.id}')">${poll.open ? "마감하기" : "재개하기"}</button>
        <button class="mini danger" onclick="deletePoll('${poll.id}')">삭제</button>
      </div>`
    : "";

  const status = closed
    ? `<span class="badge wait">마감</span>`
    : `<span class="badge ok">진행중</span>`;

  const dl = poll.deadline
    ? `<div class="poll-deadline ${isExpired(poll) ? "over" : ""}">⏰ ${deadlineText(poll)}</div>`
    : "";

  return `<div class="poll-card">
    <div class="poll-head"><h2 class="poll-q">${escV(poll.question)}</h2>${status}</div>
    <div class="poll-total">총 ${total}표</div>
    ${dl}
    ${voteBox}
    <hr class="poll-divider" />
    <h3 class="poll-results-title">실시간 결과</h3>
    ${results}
    ${adminCtrl}
  </div>`;
}

/* ===== 관리자: 투표 생성 ===== */
function addOptionField() {
  const box = document.getElementById("new-opts");
  if (!box) return;
  const n = box.querySelectorAll(".opt-input").length + 1;
  const input = document.createElement("input");
  input.type = "text";
  input.className = "poll-input opt-input";
  input.placeholder = "항목 " + n;
  box.appendChild(input);
}

function createPoll() {
  if (!isAdmin()) return;
  const q = document.getElementById("new-q").value.trim();
  const opts = Array.from(document.querySelectorAll("#new-opts .opt-input"))
    .map((i) => i.value.trim())
    .filter((v) => v);
  if (!q) {
    alert("투표 주제를 입력해 주세요.");
    return;
  }
  if (opts.length < 2) {
    alert("선택 항목을 2개 이상 입력해 주세요.");
    return;
  }
  const deadlineRaw = document.getElementById("new-deadline").value;
  if (deadlineRaw && new Date(deadlineRaw).getTime() <= Date.now()) {
    alert("마감일시는 현재 시각 이후로 지정해 주세요.");
    return;
  }
  const polls = loadPolls();
  polls.push({
    id: "poll" + Date.now(),
    question: q,
    options: opts,
    counts: opts.map(() => 0),
    voters: [],
    open: true,
    deadline: deadlineRaw || null,
  });
  savePolls(polls);
  alert("새 투표가 등록되었습니다.");
  renderVote();
}

/* ===== 관리자: 마감/재개/삭제 ===== */
function togglePoll(id) {
  if (!isAdmin()) return;
  const polls = loadPolls();
  const p = polls.find((x) => x.id === id);
  if (p) {
    p.open = !p.open;
    if (p.open) p.announced = false; // 재개 시 다시 마감되면 새로 공지
    savePolls(polls);
    renderVote();
  }
}

function deletePoll(id) {
  if (!isAdmin()) return;
  if (!confirm("이 투표를 삭제하시겠습니까?")) return;
  savePolls(loadPolls().filter((x) => x.id !== id));
  renderVote();
}

/* ===== 회원: 투표 ===== */
function submitVote(e, id) {
  e.preventDefault();
  const sess = getSession();
  if (!sess) {
    alert("로그인이 필요합니다.");
    return;
  }
  const polls = loadPolls();
  const poll = polls.find((x) => x.id === id);
  if (!poll || isClosed(poll)) {
    alert("마감되었거나 존재하지 않는 투표입니다.");
    renderVote();
    return;
  }
  if (poll.voters.includes(sess.id)) {
    alert("이미 투표하셨습니다.");
    renderVote();
    return;
  }
  const sel = document.querySelector(`input[name="poll-${id}"]:checked`);
  if (!sel) {
    alert("항목을 선택해 주세요.");
    return;
  }
  poll.counts[Number(sel.value)]++;
  poll.voters.push(sess.id);
  savePolls(polls);
  alert("투표가 완료되었습니다. 감사합니다!");
  renderVote();
}

// 마감일 자동 종료 감지: 만료 목록이 바뀔 때만 다시 렌더(투표 중 방해 최소화)
let lastExpiredSig = "";
function expiredSig() {
  return loadPolls().filter(isExpired).map((p) => p.id).sort().join(",");
}
function tickDeadlines() {
  const sig = expiredSig();
  if (sig !== lastExpiredSig) {
    lastExpiredSig = sig;
    renderVote();
  }
}

window.addEventListener("DOMContentLoaded", () => {
  renderVote(); // 투표 페이지가 아니어도 announceClosedPolls 까지는 실행됨
  lastExpiredSig = expiredSig();
  // 투표 페이지에서만 주기적 마감 감지 (불필요한 타이머 방지)
  if (document.getElementById("vote-app")) {
    setInterval(tickDeadlines, 15000);
  }
});
