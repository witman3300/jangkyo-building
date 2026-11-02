/* 정보마당 자료실·결산보고서 공용 — 관리자에게만 "글쓰기" 버튼과 자료 올리기 틀을 붙인다.
   파일 본체는 Firebase Storage에 올리고, 본문 목록에는 보기(제목)·다운로드 링크만 남긴다.
   예전처럼 본문에 통째로 담으면 페이지당 1MB 제한에 걸려 600KB까지만 올릴 수 있었다.
   목록이 바뀌면 auth.js(saveContentEdit)가 본문을 Firestore에 저장해 모든 방문자에게 반영된다.

   setupInfoUpload({
     sectionId: "data",     // 목록(.link-list)이 들어 있는 section의 id
     cat: "infodata",       // Storage 경로 board/{cat}/... (storage.rules가 받는 자리)
     list: "data",          // 보기 화면(info-doc-view.html)에서 돌아갈 목록 (data 자료실 · report 결산보고서)
     placeholder: "예: 2026년 관리비 예산안",
   }) */
(function () {
  // storage.rules의 업로드 제한(20MB 미만)에 맞춘다.
  var MAX_MB = 20;
  var MAX_SIZE = MAX_MB * 1024 * 1024;

  // 경로를 깨뜨리는 글자를 걸러 낸 Storage용 파일 이름 (board.js의 safeStorageName과 같은 규칙)
  function safeStorageName(name) {
    var clean = Array.from(String(name || 'file'))
      .filter(function (ch) { return ch.charCodeAt(0) > 31 && ch.charCodeAt(0) !== 127; })
      .join('')
      .replace(/[\\/#?%*:|"'<>\[\]{}]/g, '_')
      .replace(/\s+/g, '_')
      .replace(/_+/g, '_')
      .replace(/^[._]+/, '');
    var dot = clean.lastIndexOf('.');
    var ext = dot > 0 ? clean.slice(dot, dot + 12) : '';
    var stem = (dot > 0 ? clean.slice(0, dot) : clean).slice(0, 60);
    return (stem || 'file') + ext;
  }

  // 파일을 Storage에 올리고 { url, path }를 돌려준다. 진행률은 onProgress(0~100)로 알린다.
  function uploadFile(cat, file, onProgress) {
    var path = 'board/' + cat + '/page-' + Date.now() + '/' + safeStorageName(file.name);
    var task = fbStorage.ref(path).put(file, {
      contentType: file.type || 'application/octet-stream',
      // 다른 도메인 주소라 download 속성이 안 먹으므로, 원래 이름으로 저장되게 여기 적어 둔다
      contentDisposition: "attachment; filename*=UTF-8''" + encodeURIComponent(file.name)
    });
    return new Promise(function (resolve, reject) {
      task.on('state_changed', function (snap) {
        if (onProgress && snap.totalBytes) onProgress(Math.round(snap.bytesTransferred / snap.totalBytes * 100));
      }, reject, function () {
        task.snapshot.ref.getDownloadURL().then(function (url) {
          resolve({ url: url, path: path });
        }, reject);
      });
    });
  }

  // 본문이 바뀌면 auth.js가 Firestore에 저장한다 (모든 방문자·모든 기기에 공통 반영)
  function saveContent() {
    if (window.saveContentEdit) window.saveContentEdit();
  }

  // 관리자에게만 보이는 삭제 버튼
  function attachDelete(li, name) {
    var del = document.createElement('button');
    del.type = 'button';
    del.className = 'data-delete-btn';
    del.textContent = '삭제';
    del.addEventListener('click', function () {
      if (!confirm('"' + name + '" 자료를 목록에서 지우시겠습니까?')) return;
      var path = li.getAttribute('data-path');
      li.remove();
      saveContent();
      // Storage에 올린 파일도 지운다 (예전 방식으로 본문에 담긴 자료는 path가 없다)
      if (path && window.fbStorage) fbStorage.ref(path).delete().catch(function () {});
    });
    li.appendChild(del);
  }

  function pinToTop(list) {
    var pinned = list.querySelectorAll(':scope > li.pinned');
    for (var i = pinned.length - 1; i >= 0; i--) list.insertBefore(pinned[i], list.firstChild);
  }

  // 제목을 누르면 보기 화면에서 본문을 바로 보여 준다
  function viewHref(list, title, file, url) {
    return 'info-doc-view.html?list=' + list
      + '&title=' + encodeURIComponent(title)
      + '&name=' + encodeURIComponent(file.name)
      + '&src=' + encodeURIComponent(url);
  }

  window.setupInfoUpload = function (opts) {
    function init() {
      var section = document.getElementById(opts.sectionId);
      var list = section && section.querySelector('.link-list');
      if (!list) return;

      // 상단 고정 문서(li.pinned, 예: 관리규약·관리규정)는 내용 수정으로 순서가 바뀌었어도 늘 맨 위에 둔다
      pinToTop(list);

      // 저장된 본문에 예전 폼·버튼이 섞여 들어왔거나 init이 다시 불릴 때를 대비해 먼저 지운다
      section.querySelectorAll('.data-add-form').forEach(function (el) { el.remove(); });
      document.querySelectorAll('.data-add-btn').forEach(function (el) { el.remove(); });

      var toolbar = document.querySelector('.content-edit-toolbar');
      if (!toolbar) return; // 관리자가 아니면 여기서 끝

      // 올린 자료에는 삭제 버튼을 붙여 둔다 (원래 있던 문서는 건드리지 않는다)
      list.querySelectorAll('.data-delete-btn').forEach(function (el) { el.remove(); });
      list.querySelectorAll('li.uploaded').forEach(function (li) {
        var a = li.querySelector('a');
        attachDelete(li, a ? a.textContent.trim() : '자료');
      });

      var addBtn = document.createElement('button');
      addBtn.type = 'button';
      addBtn.className = 'btn btn-primary btn-sm data-add-btn';
      addBtn.textContent = '글쓰기';
      toolbar.appendChild(addBtn);

      var form = document.createElement('form');
      form.className = 'data-add-form';
      form.innerHTML =
        '<div><label>자료 이름</label><input type="text" class="da-name" placeholder="' + opts.placeholder + '" required /></div>' +
        '<div><label>파일 <span class="size-hint">' + MAX_MB + 'MB 미만 · PDF·이미지·텍스트는 제목을 누르면 바로 보입니다</span></label><input type="file" class="da-file" required /></div>' +
        '<div class="data-add-actions">' +
          '<button type="submit" class="btn btn-primary btn-sm">등록</button>' +
          '<button type="button" class="btn btn-outline btn-sm da-cancel">취소</button>' +
        '</div>';
      list.parentNode.insertBefore(form, list);

      addBtn.addEventListener('click', function () {
        form.classList.add('show');
        form.querySelector('.da-name').focus();
      });

      form.querySelector('.da-cancel').addEventListener('click', function () {
        form.reset();
        form.classList.remove('show');
      });

      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var name = form.querySelector('.da-name').value.trim();
        var file = form.querySelector('.da-file').files[0];
        if (!name || !file) return;
        if (file.size >= MAX_SIZE) { showToast(MAX_MB + 'MB 미만 파일만 올릴 수 있습니다.'); return; }
        if (!file.size) { showToast('빈 파일은 올릴 수 없습니다.'); return; }

        var submitBtn = form.querySelector('button[type="submit"]');
        submitBtn.disabled = true;
        submitBtn.textContent = '올리는 중 0%';

        uploadFile(opts.cat, file, function (pct) {
          submitBtn.textContent = '올리는 중 ' + pct + '%';
        }).then(function (up) {
          var li = document.createElement('li');
          li.className = 'with-dl uploaded';
          li.setAttribute('data-path', up.path);

          var title = document.createElement('a');
          title.className = 'doc-title';
          title.href = viewHref(opts.list, name, file, up.url);
          title.appendChild(document.createTextNode(name + ' '));
          var go = document.createElement('span');
          go.className = 'go';
          go.textContent = '보기 ›';
          title.appendChild(go);

          var dl = document.createElement('a');
          dl.className = 'dl-btn';
          dl.href = up.url;
          dl.setAttribute('download', file.name);
          dl.textContent = '다운로드';

          li.appendChild(title);
          li.appendChild(dl);
          attachDelete(li, name);
          // 새 자료는 상단 고정 문서 바로 아래(다른 자료보다 위)에 넣는다
          var pinned = list.querySelectorAll(':scope > li.pinned');
          var after = pinned.length ? pinned[pinned.length - 1].nextSibling : list.firstChild;
          list.insertBefore(li, after);

          saveContent();
          form.reset();
          form.classList.remove('show');
          showToast('자료를 등록했습니다.');
        }).catch(function (err) {
          var code = (err && err.code) || '';
          showToast(code === 'storage/unauthorized'
            ? '올릴 권한이 없습니다. 다시 로그인해 주세요.'
            : '자료를 올리지 못했습니다: ' + ((err && err.message) || code));
        }).then(function () {
          submitBtn.disabled = false;
          submitBtn.textContent = '등록';
        });
      });
    }

    // auth.js가 저장된 본문을 불러오고 관리자 툴바를 만든 뒤 발생시키는 이벤트
    document.addEventListener('contentready', init);
  };
})();
