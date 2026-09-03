// home-notice.js - 메인 화면의 공지사항 미리보기
// notices-data.js의 실제 공지를 읽어 최신 글부터 그린다. 예전에는 목록이 HTML에 박혀 있어
// 공지를 올려도 메인은 그대로였고, NEW 표시도 손으로 붙였다 떼야 했다.

const HOME_NOTICE_COUNT = 5; // 메인에 보여줄 개수
const HOME_NEW_DAYS = 7; // NEW 표시 기간 (게시판 목록과 같은 기준)

/* 올린 지 7일이 지나지 않았으면 NEW.
   날짜는 "YYYY-MM-DD" 형태다. Date.parse는 이 형태를 UTC 0시로 읽어 한국 시각과
   9시간 어긋나므로(오늘 올린 글이 오전에는 NEW로 안 잡힌다) 직접 현지 0시로 만든다. */
function homeNoticeIsNew(dateStr) {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(String(dateStr || "").trim());
  if (!m) return false;
  const posted = new Date(+m[1], +m[2] - 1, +m[3]);
  return (Date.now() - posted.getTime()) / (24 * 60 * 60 * 1000) < HOME_NEW_DAYS;
}

// "2026-08-20" -> "08.20"
function homeNoticeDate(dateStr) {
  const m = /^\d{4}-(\d{2})-(\d{2})/.exec(String(dateStr || "").trim());
  return m ? m[1] + "." + m[2] : "";
}

function homeNoticeEsc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);
}

function renderHomeNotices() {
  const ul = document.querySelector(".bs-notice-list");
  if (!ul || typeof NOTICES === "undefined") return;

  // 관리비 부과내역은 별도 게시판으로 분리되어 정보마당 공지사항에서는 빠진다
  const list = NOTICES.filter((p) => p.title.indexOf("관리비") === -1)
    .slice()
    .sort((a, b) => b.no - a.no)
    .slice(0, HOME_NOTICE_COUNT);

  if (!list.length) return;

  ul.innerHTML = list
    .map(
      (p) => `<li>
              <a href="notice-view.html?id=${encodeURIComponent(p.id)}">
                ${homeNoticeIsNew(p.date) ? '<span class="bs-notice-tag">NEW</span>' : ""}
                <span class="bs-notice-title">${homeNoticeEsc(p.title)}</span>
                <span class="bs-notice-date">${homeNoticeDate(p.date)}</span>
              </a>
            </li>`
    )
    .join("");
}

window.addEventListener("DOMContentLoaded", renderHomeNotices);
