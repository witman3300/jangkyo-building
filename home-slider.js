// 홈화면 상단 이미지 슬라이드 (자동 전환 + 점 인디케이터)
(function () {
  var slider = document.getElementById('heroSlider');
  if (!slider) return;

  var track = slider.querySelector('.hero-slider-track');
  var dots = Array.prototype.slice.call(slider.querySelectorAll('.hero-dot'));
  var total = dots.length;
  var current = 0;
  var timer = null;
  var INTERVAL = 4000;

  // 좌측 세로 페이지 인디케이터 (있는 페이지에서만 동작)
  var pagenavBtns = Array.prototype.slice.call(slider.querySelectorAll('.hero-pagenav-btn'));
  var pagenavIndicator = slider.querySelector('.hero-pagenav-indicator');

  function goTo(index) {
    current = (index + total) % total;
    track.style.transform = 'translateX(-' + current * 100 + '%)';
    dots.forEach(function (dot, i) {
      dot.classList.toggle('is-active', i === current);
    });
    pagenavBtns.forEach(function (btn, i) {
      btn.classList.toggle('is-active', i === current);
    });
    if (pagenavIndicator && pagenavBtns[current]) {
      pagenavIndicator.style.top = pagenavBtns[current].offsetTop + pagenavBtns[current].offsetHeight / 2 + 'px';
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

  dots.forEach(function (dot, i) {
    dot.addEventListener('click', function () {
      goTo(i);
      start();
    });
  });

  pagenavBtns.forEach(function (btn, i) {
    btn.addEventListener('click', function () {
      goTo(i);
      start();
    });
  });

  slider.addEventListener('mouseenter', stop);
  slider.addEventListener('mouseleave', start);

  goTo(0);
  start();
})();
