// rebuild.js - 재건축 추진현황 (구분소유자/특별회원 전용). auth.js 이후 로드 필요.

const REBUILD_STEPS = [
  { label: "준비위 구성", note: "2025.11 완료", state: "done" },
  { label: "예비 타당성", note: "2026.03 완료", state: "done" },
  { label: "정밀안전진단", note: "2026.06 ~ 진행중", state: "now" },
  { label: "조합설립 인가", note: "동의율 75% 필요", state: "" },
  { label: "사업시행 인가", note: "미정", state: "" },
  { label: "착공 · 준공", note: "미정", state: "" },
];

// [일자, 내용, 장소/비고, 배지클래스(ok|wait), 배지라벨]
const REBUILD_SCHEDULE = [
  ["2026.03.22", "예비 타당성 검토 설명회", "참석 74명", "ok", "완료"],
  ["2026.06.05", "정밀안전진단 용역 계약 체결", "OO구조안전진단㈜", "ok", "완료"],
  ["2026.08.14", "정밀안전진단 중간보고회", "지하 1층 대회의실 19:00", "wait", "예정"],
  ["2026.09.30", "정밀안전진단 최종 결과 발표", "결과 공지 + 우편 발송", "wait", "예정"],
  ["2026.11.20", "조합설립 동의서 1차 마감", "동의율 75% 목표", "wait", "예정"],
];

const REBUILD_DOCS = [
  ["예비 타당성 검토 보고서 (요약본)", "PDF · 3.2MB"],
  ["추진준비위원회 규약", "PDF · 480KB"],
  ["2026.03 설명회 발표자료", "PDF · 5.1MB"],
  ["구분소유자 동의서 양식", "HWP · 92KB"],
  ["추진 경과 회의록 모음 (2025.11~)", "PDF · 1.8MB"],
];

const OPINIONS_KEY = "jangkyo_rebuild_opinions";

function escRb(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;",
  })[c]);
}

function renderRebuild() {
  if (!guardSpecial("rebuild-app")) return;

  const stepsHtml = REBUILD_STEPS.map(
    (s) => `<div class="rb-step ${s.state}"><div class="dot"></div><h6>${s.label}</h6><span>${s.note}</span></div>`
  ).join("");

  const scheduleHtml = REBUILD_SCHEDULE.slice()
    .reverse()
    .map(
      ([date, title, place, cls, label]) =>
        `<tr><td>${date}</td><td class="title">${escRb(title)}</td><td>${escRb(place)}</td><td><span class="badge ${cls}">${label}</span></td></tr>`
    )
    .join("");

  const docsHtml = REBUILD_DOCS.map(
    ([name, meta]) => `<li><a href="#">${escRb(name)}</a><span class="d">${meta}</span></li>`
  ).join("");

  document.getElementById("rebuild-app").innerHTML = `
    <div class="board-head"><h1>재건축 추진현황</h1></div>

    <div class="rb-banner">
      <h2>장교빌딩 재건축 추진준비위원회</h2>
      <p>2025년 11월 발족 · 현재 <b>정밀안전진단 진행</b> 단계입니다.</p>
    </div>

    <div class="rb-steps">${stepsHtml}</div>

    <h3 class="rb-section-title">조합설립 동의율</h3>
    <div class="rb-gauge">
      <div class="fill" style="width:58.3%"></div>
      <div class="mark" style="left:75%"></div>
      <span class="label">58.3%</span>
    </div>
    <p class="rb-note">
      구분소유자 <b>112명 중 66명</b> 동의 · 의결권 지분 기준 58.3%<br>
      붉은 선은 조합설립에 필요한 동의율 <b>75%</b>입니다. (집합건물법 및 도시정비법 기준)
    </p>
    <div class="rb-stats">
      <div><b>1988년</b><span>준공 · 경과 38년</span></div>
      <div><b>112명</b><span>구분소유자 총수</span></div>
      <div><b>D등급</b><span>예비진단 결과(안전성)</span></div>
    </div>

    <h3 class="rb-section-title">주요 일정</h3>
    <table class="board-table">
      <thead><tr><th>일자</th><th>내용</th><th>장소·비고</th><th width="80">상태</th></tr></thead>
      <tbody>${scheduleHtml}</tbody>
    </table>

    <h3 class="rb-section-title">재건축 자료실</h3>
    <p class="rb-note">등기부상 구분소유자 본인만 열람·다운로드할 수 있습니다.</p>
    <ul class="rb-doclist">${docsHtml}</ul>

    <h3 class="rb-section-title">의견 제출</h3>
    <p class="rb-note">제출하신 의견은 준비위원회에 전달되며, 익명 처리를 선택할 수 있습니다.</p>
    <form class="write-form" onsubmit="submitOpinion(event)">
      <div class="write-row">
        <div class="label">구분</div>
        <div class="field">
          <select id="op-cat">
            <option>재건축 추진 찬반 의견</option>
            <option>분담금·사업성 관련 질의</option>
            <option>일정·절차 관련 질의</option>
            <option>준비위원회 운영 건의</option>
            <option>기타</option>
          </select>
        </div>
      </div>
      <div class="write-row">
        <div class="label">내용</div>
        <div class="field"><textarea id="op-content" placeholder="의견을 자유롭게 작성해 주세요" required></textarea></div>
      </div>
      <div class="write-row">
        <div class="label">익명 여부</div>
        <div class="field"><label class="pin-check"><input type="checkbox" id="op-anon" /> 익명으로 제출합니다 (호실·성명 미공개)</label></div>
      </div>
      <div class="btn-row">
        <button type="submit" class="btn btn-primary btn-sm">의견 제출하기</button>
      </div>
    </form>

    <div class="rb-warn">
      <b>안내</b> — 본 페이지의 수치는 예비 검토 단계의 <b>추정치</b>이며 법적 효력이 없습니다.
      정밀안전진단 결과 및 조합설립 이후 사업계획에 따라 분담금과 일정은 크게 변동될 수 있습니다.
      동의서 제출은 신중히 결정하시고, 필요 시 전문가 상담을 받으시기 바랍니다.
      재건축 관련 문의는 추진준비위원회(관리사무소 경유)로 연락 주세요.
    </div>`;
}

function submitOpinion(e) {
  e.preventDefault();
  const sess = typeof getSession === "function" ? getSession() : null;
  const cat = document.getElementById("op-cat").value;
  const content = document.getElementById("op-content").value.trim();
  const anon = document.getElementById("op-anon").checked;
  if (!content) return;

  let list;
  try {
    list = JSON.parse(localStorage.getItem(OPINIONS_KEY)) || [];
  } catch (err) {
    list = [];
  }
  const now = new Date();
  const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  list.push({
    id: "ro" + now.getTime(),
    cat,
    content,
    author: anon ? "익명" : sess ? sess.name : "익명",
    date,
  });
  localStorage.setItem(OPINIONS_KEY, JSON.stringify(list));
  alert("의견이 제출되었습니다.\n추진준비위원회에 전달되며, 처리 결과는 자료실 회의록에 반영됩니다.");
  document.getElementById("op-content").value = "";
  document.getElementById("op-anon").checked = false;
}

window.addEventListener("DOMContentLoaded", renderRebuild);
