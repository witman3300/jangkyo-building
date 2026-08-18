// 홈 히어로 슬라이드쇼 (크로스페이드, 6초 간격) + 좌측 페이지 인디케이터
(function () {
  var hero = document.querySelector('.bs-hero');
  if (!hero) return;

  var slides = Array.prototype.slice.call(hero.querySelectorAll('.bs-hero-slide'));
  if (slides.length < 2) return;

  var pagenav = hero.querySelector('.bs-hero-pagenav');
  var navBtns = pagenav ? Array.prototype.slice.call(pagenav.querySelectorAll('.bs-hero-pagenav-btn')) : [];
  var indicator = pagenav ? pagenav.querySelector('.bs-hero-pagenav-indicator') : null;

  var current = 0;
  var INTERVAL = 6000;
  var timer = null;

  function goTo(index) {
    slides[current].classList.remove('is-active');
    current = (index + slides.length) % slides.length;
    slides[current].classList.add('is-active');

    navBtns.forEach(function (btn, i) {
      btn.classList.toggle('is-active', i === current);
    });
    if (indicator && navBtns[current]) {
      indicator.style.top = navBtns[current].offsetTop + navBtns[current].offsetHeight / 2 + 'px';
    }
  }

  function next() {
    goTo(current + 1);
  }

  function start() {
    stop();
    timer = setInterval(next, INTERVAL);
  }

  function stop() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  navBtns.forEach(function (btn, i) {
    btn.addEventListener('click', function () {
      goTo(i);
      start();
    });
  });

  if (indicator && navBtns[0]) {
    indicator.style.top = navBtns[0].offsetTop + navBtns[0].offsetHeight / 2 + 'px';
  }

  start();
})();
