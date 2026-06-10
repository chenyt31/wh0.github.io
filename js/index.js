function buildSlides(track, items, videoDir, captionClass) {
  track.innerHTML = '';
  items.forEach(function (item) {
    var slide = document.createElement('div');
    slide.className = 'carousel-slide';
    slide.innerHTML =
      '<div class="carousel-slide-inner">' +
        '<video muted loop playsinline preload="metadata">' +
          '<source src="' + videoDir + encodeURIComponent(item.file) + '" type="video/mp4">' +
        '</video>' +
        '<p class="carousel-caption ' + captionClass + '">' +
          '<span class="caption-label">Instruction</span>' +
          '<span class="caption-text">' + item.instruction + '</span>' +
        '</p>' +
      '</div>';
    track.appendChild(slide);
  });
}

function initCarousel(carousel) {
  var track = carousel.querySelector('.carousel-track');
  var slides = Array.from(carousel.querySelectorAll('.carousel-slide'));
  var prevBtn = carousel.querySelector('.carousel-btn.prev');
  var nextBtn = carousel.querySelector('.carousel-btn.next');
  var dotsContainer = carousel.querySelector('.carousel-dots');
  var current = 0;
  var touchStartX = 0;
  var touchEndX = 0;

  function getSlidesToShow() {
    return window.innerWidth < 768 ? 1 : 3;
  }

  function getMaxIndex() {
    return Math.max(0, slides.length - getSlidesToShow());
  }

  function buildDots() {
    var maxIndex = getMaxIndex();
    dotsContainer.innerHTML = '';
    for (var i = 0; i <= maxIndex; i++) {
      var dot = document.createElement('button');
      dot.className = 'carousel-dot' + (i === current ? ' active' : '');
      dot.setAttribute('aria-label', 'Go to slide ' + (i + 1));
      dot.dataset.index = i;
      dot.addEventListener('click', function () {
        goTo(parseInt(this.dataset.index, 10));
      });
      dotsContainer.appendChild(dot);
    }
  }

  function updateSlides() {
    var slidesToShow = getSlidesToShow();
    var maxIndex = getMaxIndex();
    if (current > maxIndex) current = maxIndex;

    var slideWidth = 100 / slidesToShow;
    slides.forEach(function (slide) {
      slide.style.flex = '0 0 ' + slideWidth + '%';
    });
    track.style.transform = 'translateX(-' + (current * slideWidth) + '%)';

    var dots = dotsContainer.querySelectorAll('.carousel-dot');
    dots.forEach(function (dot, i) {
      dot.classList.toggle('active', i === current);
    });

    slides.forEach(function (slide, i) {
      var video = slide.querySelector('video');
      if (!video) return;
      if (i >= current && i < current + slidesToShow) {
        video.play().catch(function () {});
      } else {
        video.pause();
      }
    });
  }

  function goTo(index) {
    current = Math.max(0, Math.min(index, getMaxIndex()));
    updateSlides();
  }

  function next() {
    goTo(current >= getMaxIndex() ? 0 : current + 1);
  }

  function prev() {
    goTo(current <= 0 ? getMaxIndex() : current - 1);
  }

  prevBtn.addEventListener('click', prev);
  nextBtn.addEventListener('click', next);

  carousel.addEventListener('touchstart', function (e) {
    touchStartX = e.changedTouches[0].screenX;
  }, { passive: true });

  carousel.addEventListener('touchend', function (e) {
    touchEndX = e.changedTouches[0].screenX;
    var diff = touchStartX - touchEndX;
    if (Math.abs(diff) > 40) {
      diff > 0 ? next() : prev();
    }
  }, { passive: true });

  carousel.addEventListener('mousedown', function (e) {
    touchStartX = e.screenX;
    function onMouseUp(ev) {
      touchEndX = ev.screenX;
      var diff = touchStartX - touchEndX;
      if (Math.abs(diff) > 40) {
        diff > 0 ? next() : prev();
      }
      document.removeEventListener('mouseup', onMouseUp);
    }
    document.addEventListener('mouseup', onMouseUp);
  });

  carousel._refresh = function () {
    slides = Array.from(carousel.querySelectorAll('.carousel-slide'));
    buildDots();
    updateSlides();
  };

  buildDots();
  updateSlides();
  return carousel;
}

function refreshAllCarousels() {
  document.querySelectorAll('.video-carousel').forEach(function (carousel) {
    if (carousel._refresh) carousel._refresh();
  });
}

function setupCarousel(id, items, videoDir, captionClass) {
  var carousel = document.getElementById(id);
  if (!carousel || !items || !items.length) return;
  buildSlides(carousel.querySelector('.carousel-track'), items, videoDir, captionClass);
  initCarousel(carousel);
}

function loadManifest() {
  if (window.VIDEO_MANIFEST) {
    return Promise.resolve(window.VIDEO_MANIFEST);
  }
  return fetch('data/manifest.json').then(function (res) {
    if (!res.ok) throw new Error('manifest fetch failed');
    return res.json();
  });
}

var PIPELINE_STEPS = [
  {
    title: 'Instruction Generation',
    desc: 'A dual-agent LLM system discovers object nouns & adjectives, then preferentially samples under-represented words to compose balanced manipulation instructions.'
  },
  {
    title: 'Scene Alignment',
    desc: 'Background images are captured from the robot deployment camera. Qwen-Image-Edit inserts specified objects into the scene, producing the initial frame for video synthesis.'
  },
  {
    title: 'Video Generation',
    desc: 'Qwen3-VL generates a detailed augmented_text describing expected hand-object state changes, which is appended to the instruction prompt. Wan-I2V then animates the edited scene into an egocentric manipulation video.'
  },
  {
    title: 'Embodiment Alignment',
    desc: 'Qwen-Image-Edit replaces the human hand with a realistic robot hand on selected frames, preserving pose and object motion while closing the embodiment gap.'
  },
  {
    title: 'Motion Extraction',
    desc: 'HaWoR reconstructs per-frame 3D hand poses from the generated videos, outputting wrist pose in camera space and articulated MANO parameters as action supervision.'
  },
  {
    title: 'WM-H Dataset',
    desc: 'The full pipeline scales purely with GPU compute — no teleoperation or manual labeling. At 5.44 GPU-hours per 1k videos, 50k episodes cost ~272 GPU-hours and are ready for robot policy co-training.'
  }
];

function initPipeline() {
  var root = document.getElementById('wmh-pipeline');
  if (!root) return;

  var steps = Array.from(root.querySelectorAll('.pipeline-step'));
  var panels = Array.from(root.querySelectorAll('.pipeline-panel'));
  var trackFill = root.querySelector('.pipeline-track-fill');
  var packet = root.querySelector('.pipeline-packet');
  var titleEl = root.querySelector('.pipeline-step-title');
  var descEl = root.querySelector('.pipeline-step-desc');
  var prevBtn = root.querySelector('.pipeline-ctrl.prev');
  var nextBtn = root.querySelector('.pipeline-ctrl.next');
  var playBtn = root.querySelector('.pipeline-ctrl.play-pause');
  var typingEl = root.querySelector('.typing-text');
  var qwenAugmentEl = root.querySelector('.qwen-augment-text');
  var counterEl = root.querySelector('.episode-counter');
  var gpuHoursEl = root.querySelector('.gpu-hours-counter');
  var scaleBarFill = root.querySelector('.scale-bar-fill');

  var current = -1;
  var playing = true;
  var timer = null;
  var typingTimer = null;
  var qwenTypingTimer = null;
  var counterAnim = null;
  var QWEN_CHAR_MS = 22;
  var QWEN_PAUSE_MS = 3000;
  var DEFAULT_STEP_MS = 6500;

  function stepPosition(index) {
    if (steps.length <= 1) return 0;
    return (index / (steps.length - 1)) * 100;
  }

  function loadVideos(panel) {
    panel.querySelectorAll('video.pipeline-video').forEach(function (video) {
      if (!video.src && video.dataset.src) {
        video.src = video.dataset.src;
      }
    });
  }

  function playPanelVideos(panel) {
    panel.querySelectorAll('video.pipeline-video').forEach(function (video) {
      video.play().catch(function () {});
    });
  }

  function pauseAllVideos() {
    root.querySelectorAll('video.pipeline-video').forEach(function (video) {
      video.pause();
    });
  }

  function startTyping(el, timerRef, speed, onDone) {
    if (!el) return null;
    var text = el.dataset.text || '';
    el.textContent = '';
    el.classList.remove('done');
    var i = 0;
    if (timerRef) clearInterval(timerRef);
    var id = setInterval(function () {
      if (i < text.length) {
        el.textContent += text.charAt(i);
        i++;
      } else {
        clearInterval(id);
        el.classList.add('done');
        if (onDone) onDone();
      }
    }, speed || 45);
    return id;
  }

  function getStepDuration() {
    return DEFAULT_STEP_MS;
  }

  function startInstructionTyping() {
    typingTimer = startTyping(typingEl, typingTimer, 45);
  }

  function startQwenTyping() {
    qwenTypingTimer = startTyping(qwenAugmentEl, qwenTypingTimer, QWEN_CHAR_MS, function () {
      if (!playing || current !== 2) return;
      clearTimeout(timer);
      timer = setTimeout(function () {
        goTo(current >= steps.length - 1 ? 0 : current + 1);
      }, QWEN_PAUSE_MS);
    });
  }

  function animateCounter() {
    if (!counterEl) return;
    var episodeTarget = parseInt(counterEl.dataset.target, 10) || 50000;
    var gpuTarget = gpuHoursEl ? parseFloat(gpuHoursEl.dataset.target) || 272 : 272;
    var duration = 2200;
    var start = performance.now();
    cancelAnimationFrame(counterAnim);

    counterEl.textContent = '0';
    if (gpuHoursEl) gpuHoursEl.textContent = '0';
    if (scaleBarFill) scaleBarFill.style.width = '0%';

    function tick(now) {
      var t = Math.min((now - start) / duration, 1);
      var eased = 1 - Math.pow(1 - t, 3);
      var episodes = Math.floor(eased * episodeTarget);
      var gpuHours = eased * gpuTarget;

      counterEl.textContent = episodes.toLocaleString();
      if (gpuHoursEl) {
        gpuHoursEl.textContent = gpuHours < 10
          ? gpuHours.toFixed(1)
          : Math.round(gpuHours).toLocaleString();
      }
      if (scaleBarFill) {
        scaleBarFill.style.width = (episodes / episodeTarget * 100) + '%';
      }

      if (t < 1) {
        counterAnim = requestAnimationFrame(tick);
      } else if (gpuHoursEl) {
        gpuHoursEl.textContent = Math.round(gpuTarget).toLocaleString();
      }
    }
    counterAnim = requestAnimationFrame(tick);
  }

  function restartPanelAnimations(panel) {
    panel.querySelectorAll('.chip, .freq-bars span, .contrast-yes').forEach(function (el) {
      el.style.animation = 'none';
      void el.offsetHeight;
      el.style.animation = '';
    });
  }

  function goTo(index) {
    index = Math.max(0, Math.min(index, steps.length - 1));
    if (index === current && current >= 0 && panels[current].classList.contains('active')) return;

    pauseAllVideos();
    if (qwenTypingTimer) {
      clearInterval(qwenTypingTimer);
      qwenTypingTimer = null;
    }
    if (current >= 0) {
      panels[current].classList.remove('active');
      panels[current].classList.add('exit-left');
    }

    current = index;

    steps.forEach(function (step, i) {
      step.classList.toggle('active', i === current);
      step.classList.toggle('done', i < current);
      step.setAttribute('aria-selected', i === current ? 'true' : 'false');
    });

    panels.forEach(function (panel, i) {
      panel.classList.toggle('active', i === current);
      panel.classList.remove('exit-left');
      if (i === current) {
        loadVideos(panel);
        restartPanelAnimations(panel);
        playPanelVideos(panel);
      }
    });

    if (trackFill) trackFill.style.width = stepPosition(current) + '%';
    if (packet) packet.style.left = stepPosition(current) + '%';

    if (titleEl) titleEl.textContent = PIPELINE_STEPS[current].title;
    if (descEl) descEl.textContent = PIPELINE_STEPS[current].desc;

    if (current === 0) startInstructionTyping();
    if (current === 2) startQwenTyping();
    if (current === 5) animateCounter();

    if (current !== 2) scheduleAuto();
  }

  function scheduleAuto() {
    clearTimeout(timer);
    if (!playing) return;
    timer = setTimeout(function () {
      goTo(current >= steps.length - 1 ? 0 : current + 1);
    }, getStepDuration());
  }

  function togglePlay() {
    playing = !playing;
    playBtn.innerHTML = playing
      ? '<i class="fas fa-pause"></i>'
      : '<i class="fas fa-play"></i>';
    playBtn.setAttribute('aria-label', playing ? 'Pause auto-play' : 'Resume auto-play');
    if (playing) {
      scheduleAuto();
      playPanelVideos(panels[current]);
    } else {
      clearTimeout(timer);
      pauseAllVideos();
    }
  }

  steps.forEach(function (step) {
    step.addEventListener('click', function () {
      goTo(parseInt(step.dataset.step, 10));
    });
  });

  prevBtn.addEventListener('click', function () {
    goTo(current <= 0 ? steps.length - 1 : current - 1);
  });

  nextBtn.addEventListener('click', function () {
    goTo(current >= steps.length - 1 ? 0 : current + 1);
  });

  playBtn.addEventListener('click', togglePlay);

  goTo(0);
}

var POLICY_DONUT_CIRC = 2 * Math.PI * 38;

function animatePolicyDonuts(root) {
  var segs = root.querySelectorAll('.donut-seg');
  segs.forEach(function (seg, i) {
    var pct = parseFloat(seg.dataset.pct) || 0;
    var offset = parseFloat(seg.dataset.offset) || 0;
    var color = seg.dataset.color || '#888';
    var arc = (pct / 100) * POLICY_DONUT_CIRC;

    seg.setAttribute('fill', 'none');
    seg.setAttribute('stroke', color);
    seg.setAttribute('stroke-width', '14');
    seg.style.strokeDashoffset = String(-(offset / 100) * POLICY_DONUT_CIRC);
    seg.style.strokeDasharray = '0 ' + POLICY_DONUT_CIRC;
    seg.style.transition = 'none';

    setTimeout(function () {
      seg.style.transition = 'stroke-dasharray 1.3s cubic-bezier(0.4, 0, 0.2, 1)';
      seg.style.strokeDasharray = arc + ' ' + (POLICY_DONUT_CIRC - arc);
    }, 120 + i * 70);
  });
}

function initPolicyFigure() {
  var root = document.getElementById('policy-figure');
  if (!root) return;

  var ratioTags = Array.from(root.querySelectorAll('.ratio-tag'));
  var ratioSegs = [
    root.querySelector('.policy-donut-4 .seg-wmh'),
    root.querySelector('.policy-donut-4 .seg-teleop'),
    root.querySelector('.policy-donut-4 .seg-ea')
  ];
  var ratioTimer = null;
  var ratioIdx = 0;
  var hasAnimated = false;

  function highlightRatio() {
    ratioTags.forEach(function (tag, i) {
      tag.classList.toggle('active', i === ratioIdx);
    });
    ratioSegs.forEach(function (seg, i) {
      if (seg) seg.classList.toggle('seg-active', i === ratioIdx);
    });
    ratioIdx = (ratioIdx + 1) % ratioTags.length;
  }

  function startRatioCycle() {
    if (!ratioTags.length) return;
    highlightRatio();
    clearInterval(ratioTimer);
    ratioTimer = setInterval(highlightRatio, 2200);
  }

  function stopRatioCycle() {
    clearInterval(ratioTimer);
    ratioTags.forEach(function (tag) {
      tag.classList.remove('active');
    });
    ratioSegs.forEach(function (seg) {
      if (seg) seg.classList.remove('seg-active');
    });
  }

  function onVisible() {
    root.classList.add('is-visible');
    if (!hasAnimated) {
      animatePolicyDonuts(root);
      hasAnimated = true;
    }
    startRatioCycle();
  }

  function onHidden() {
    root.classList.remove('is-visible');
    stopRatioCycle();
  }

  if ('IntersectionObserver' in window) {
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          onVisible();
        } else {
          onHidden();
        }
      });
    }, { threshold: 0.25 });
    observer.observe(root);
  } else {
    onVisible();
  }
}

function assetUrl(path) {
  var clean = path.split('?')[0];
  var versions = window.ASSET_VERSIONS || {};
  var version = versions[clean];
  return version ? clean + '?v=' + version : clean;
}

function initSectionImages() {
  document.querySelectorAll('.section-image').forEach(function (img) {
    var src = img.getAttribute('src');
    if (src) img.src = assetUrl(src);
  });
}

function initImageLightbox() {
  var overlay = document.createElement('div');
  overlay.className = 'image-lightbox';
  overlay.innerHTML =
    '<button class="lightbox-close" type="button" aria-label="Close">&times;</button>' +
    '<img class="lightbox-img" alt="">';
  document.body.appendChild(overlay);

  var lightboxImg = overlay.querySelector('.lightbox-img');
  var closeBtn = overlay.querySelector('.lightbox-close');

  function close() {
    overlay.classList.remove('active');
    document.body.style.overflow = '';
    lightboxImg.removeAttribute('src');
  }

  function open(img) {
    lightboxImg.src = img.currentSrc || img.src;
    lightboxImg.alt = img.alt || '';
    overlay.classList.add('active');
    document.body.style.overflow = 'hidden';
  }

  closeBtn.addEventListener('click', close);
  overlay.addEventListener('click', function (e) {
    if (e.target === overlay) close();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') close();
  });

  document.querySelectorAll('.section-image').forEach(function (img) {
    img.addEventListener('click', function () {
      open(img);
    });
  });
}

document.addEventListener('DOMContentLoaded', function () {
  initSectionImages();
  initImageLightbox();

  loadManifest()
    .then(function (manifest) {
      setupCarousel('video-carousel', manifest.robot, 'assets/video/wh0/', 'caption-robot');
      setupCarousel('wmh-carousel', manifest.wmh, 'assets/video/wmh/', 'caption-wmh');
      setupCarousel('wmh-wo-sa-carousel', manifest.wmh_wo_sa, 'assets/video/wmh-wo-sa/', 'caption-wmh-wo-sa');
      setupCarousel('wmh-ea-carousel', manifest.wmh_ea, 'assets/video/wmh-ea/', 'caption-wmh-ea');
    })
    .catch(function (err) {
      console.error('Failed to load manifest:', err);
    });

  initPipeline();
  initPolicyFigure();
  window.addEventListener('resize', refreshAllCarousels);
});
