// Mercy Presbyterian — mockup interactions
(() => {
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  // ---------- Sticky header shadow on scroll ----------
  const top = $('.site-top');
  if (top) {
    const onScroll = () => top.classList.toggle('scrolled', window.scrollY > 12);
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  // ---------- Mobile menu ----------
  const toggle = $('.nav-toggle');
  const menu   = $('.mobile-menu');
  const close  = $('.mobile-menu-close');
  if (toggle && menu) {
    const openMenu  = () => { menu.classList.add('open'); menu.setAttribute('aria-hidden', 'false'); };
    const closeMenu = () => { menu.classList.remove('open'); menu.setAttribute('aria-hidden', 'true'); };
    toggle.addEventListener('click', openMenu);
    if (close) close.addEventListener('click', closeMenu);
    $$('.mobile-menu-list a').forEach(a => a.addEventListener('click', closeMenu));
  }

  // ---------- Audio player (visual only) ----------
  $$('.audio-play-btn').forEach(btn => {
    const playIcon  = '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>';
    const pauseIcon = '<svg viewBox="0 0 24 24"><path d="M6 5h4v14H6zm8 0h4v14h-4z"/></svg>';
    btn.innerHTML = playIcon;
    btn.addEventListener('click', () => {
      const playing = btn.classList.toggle('is-playing');
      btn.innerHTML = playing ? pauseIcon : playIcon;

      // simulate progress
      const card = btn.closest('.featured-sermon-content, .audio-player') || btn.parentElement;
      const fill = card && card.querySelector('.audio-progress');
      if (!fill) return;
      if (playing) {
        let w = parseFloat(fill.style.getPropertyValue('--w') || '32');
        fill.timer = setInterval(() => {
          w = (w + 0.4) % 100;
          fill.style.setProperty('--w', w);
          fill.querySelector('::before'); // not needed
          fill.style.background = `linear-gradient(to right, var(--gold-deep) ${w}%, var(--rule) ${w}%)`;
        }, 200);
      } else if (fill.timer) {
        clearInterval(fill.timer);
      }
    });
  });

  // ---------- Sermon archive filter chips ----------
  const filterGroups = $$('.filter-bar');
  filterGroups.forEach(bar => {
    const chips = $$('.chip', bar);
    chips.forEach(chip => {
      chip.addEventListener('click', () => {
        chips.forEach(c => c.classList.remove('is-active'));
        chip.classList.add('is-active');
        const filterVal = chip.dataset.filter;
        const rows = $$('.sermon-row');
        rows.forEach(r => {
          if (!filterVal || filterVal === 'all' || r.dataset.series === filterVal || r.dataset.book === filterVal || r.dataset.preacher === filterVal) {
            r.style.display = '';
          } else {
            r.style.display = 'none';
          }
        });
      });
    });
  });

  // ---------- Group filters ----------
  $$('.group-filter').forEach(btn => {
    btn.addEventListener('click', () => {
      const group = btn.closest('.group-filter-bar');
      $$('.group-filter', group).forEach(b => b.classList.remove('is-active'));
      btn.classList.add('is-active');
      const filterVal = btn.dataset.filter;
      $$('.group-card').forEach(card => {
        if (!filterVal || filterVal === 'all' || (card.dataset.tags || '').split(' ').includes(filterVal)) {
          card.style.display = '';
        } else {
          card.style.display = 'none';
        }
      });
    });
  });

  // ---------- Give form ----------
  $$('.amount-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      $$('.amount-btn').forEach(b => b.classList.remove('is-active'));
      btn.classList.add('is-active');
      const input = $('.amount-input');
      if (input) input.value = btn.dataset.amount || '';
    });
  });
  $$('.freq-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      $$('.freq-btn').forEach(b => b.classList.remove('is-active'));
      btn.classList.add('is-active');
    });
  });

  // ---------- Reveal on scroll ----------
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('is-visible'); io.unobserve(e.target); } });
    }, { rootMargin: '-40px' });
    $$('.in-view').forEach(el => io.observe(el));
  } else {
    $$('.in-view').forEach(el => el.classList.add('is-visible'));
  }
})();
