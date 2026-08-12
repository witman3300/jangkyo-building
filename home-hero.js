// 홈 히어로 슬라이드쇼 (크로스페이드, 6초 간격)
(function () {
  var hero = document.querySelector('.bs-hero');
  if (!hero) return;

  var slides = Array.prototype.slice.call(hero.querySelectorAll('.bs-hero-slide'));
  if (slides.length < 2) return;

  var current = 0;
  var INTERVAL = 6000;

  setInterval(function () {
    slides[current].classList.remove('is-active');
    current = (current + 1) % slides.length;
    slides[current].classList.add('is-active');
  }, INTERVAL);
})();
