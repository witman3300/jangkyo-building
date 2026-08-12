// 좌측 세로 섹션 내비게이션: 스크롤 위치 추적 + 클릭 이동
(function () {
  var nav = document.querySelector('.secnav');
  if (!nav) return;

  var buttons = Array.prototype.slice.call(nav.querySelectorAll('.secnav-btn'));
  var indicator = nav.querySelector('.secnav-indicator');
  var labelEl = nav.querySelector('.secnav-label');
  if (!buttons.length || !indicator) return;

  var sections = buttons.map(function (btn) {
    return document.getElementById(btn.getAttribute('data-target'));
  });

  function setActive(index) {
    if (index < 0) return;
    buttons.forEach(function (b, i) {
      b.classList.toggle('is-active', i === index);
    });

    var btn = buttons[index];
    var offset = btn.offsetTop + btn.offsetHeight / 2;
    indicator.style.transform = 'translateY(' + offset + 'px)';
    if (labelEl) labelEl.textContent = btn.getAttribute('data-label') || '';

    var sec = sections[index];
    var isDark = sec && sec.getAttribute('data-secnav-theme') === 'dark';
    nav.classList.toggle('secnav--on-dark', !!isDark);
  }

  buttons.forEach(function (btn, i) {
    btn.addEventListener('click', function () {
      var target = sections[i];
      if (target) target.scrollIntoView({ behavior: 'smooth' });
    });
  });

  if ('IntersectionObserver' in window) {
    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            var idx = sections.indexOf(entry.target);
            if (idx > -1) setActive(idx);
          }
        });
      },
      { rootMargin: '-45% 0px -45% 0px', threshold: 0 }
    );
    sections.forEach(function (sec) {
      if (sec) observer.observe(sec);
    });
  }

  setActive(0);
})();
