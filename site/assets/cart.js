/* Concepts shopping cart — selection → save → highlight → ask Claude */
(function () {
  'use strict';

  const STORAGE_KEY = 'tracktion_cart_v1';
  const PREF_KEY = 'tracktion_cart_pref_v1';
  const SCOPE_SEL = '.commentary, .lede, .page-header, .glossary-def, .toc-card .toc-summary, main.page > p';
  const CLAUDE_URL_WEB = 'https://claude.ai/new?q=';
  const CLAUDE_URL_DESKTOP = 'claude://claude.ai/new?q=';

  const Pref = {
    get mode() {
      try { return JSON.parse(localStorage.getItem(PREF_KEY) || '{}').mode || 'desktop'; }
      catch (e) { return 'desktop'; }
    },
    set mode(v) {
      localStorage.setItem(PREF_KEY, JSON.stringify({ mode: v }));
    }
  };

  // ---------- page identity ----------
  function pageKey() {
    const p = location.pathname.split('/').filter(Boolean);
    // e.g. ["site","diagrams","05-transport.html"] -> "diagrams/05-transport.html"
    const idx = p.findIndex(x => x === 'diagrams');
    if (idx >= 0) return p.slice(idx).join('/');
    return p[p.length - 1] || 'index.html';
  }
  function pageTitle() {
    const h1 = document.querySelector('main.page h1');
    return (h1 && h1.textContent.trim()) || document.title.split('—')[0].trim();
  }

  // ---------- store ----------
  const Store = {
    list() {
      try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); }
      catch (e) { return []; }
    },
    save(items) { localStorage.setItem(STORAGE_KEY, JSON.stringify(items)); fire(); },
    add(item) {
      const items = this.list();
      if (items.some(i => i.page === item.page && i.text === item.text)) return null;
      items.push(item);
      this.save(items);
      return item;
    },
    remove(id) {
      this.save(this.list().filter(i => i.id !== id));
    },
    update(id, patch) {
      const items = this.list();
      const i = items.findIndex(x => x.id === id);
      if (i < 0) return;
      items[i] = Object.assign({}, items[i], patch);
      this.save(items);
    },
    clear() { this.save([]); },
    forPage(key) { return this.list().filter(i => i.page === key); },
  };

  function fire() { document.dispatchEvent(new CustomEvent('cart:change')); }

  // ---------- scope check ----------
  function inScope(node) {
    const el = node.nodeType === 1 ? node : node.parentElement;
    if (!el) return false;
    // exclude nav and action widgets
    if (el.closest('.site-nav, .pager, .cart-toolbar, .cart-drawer, .diagram-sidebar .sidebar-action, .flag-list, .flow-list, button, .mono.file, svg')) return false;
    return !!el.closest(SCOPE_SEL);
  }

  // ---------- context (surrounding paragraph) ----------
  function contextFor(range) {
    const container = range.commonAncestorContainer;
    const el = container.nodeType === 1 ? container : container.parentElement;
    const block = el.closest('p, li, .commentary-section, .glossary-def, .lede');
    if (!block) return '';
    const text = block.textContent.replace(/\s+/g, ' ').trim();
    if (text.length <= 320) return text;
    // center around selection text
    const sel = range.toString().trim();
    const i = text.indexOf(sel);
    if (i < 0) return text.slice(0, 320) + '…';
    const start = Math.max(0, i - 140);
    const end = Math.min(text.length, i + sel.length + 140);
    return (start > 0 ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : '');
  }

  // ---------- toolbar ----------
  let toolbar = null;
  function ensureToolbar() {
    if (toolbar) return toolbar;
    toolbar = document.createElement('div');
    toolbar.className = 'cart-toolbar';
    toolbar.setAttribute('role', 'toolbar');
    toolbar.innerHTML = '<button class="cart-add" title="Save to concepts cart">+ save concept</button>';
    toolbar.style.display = 'none';
    document.body.appendChild(toolbar);
    toolbar.querySelector('.cart-add').addEventListener('mousedown', (e) => {
      e.preventDefault();
      addCurrentSelection();
    });
    return toolbar;
  }
  function showToolbar(rect) {
    ensureToolbar();
    const top = window.scrollY + rect.top - 42;
    const left = window.scrollX + rect.left + (rect.width / 2) - 70;
    toolbar.style.top = Math.max(8 + window.scrollY, top) + 'px';
    toolbar.style.left = Math.max(8, left) + 'px';
    toolbar.style.display = 'flex';
  }
  function hideToolbar() { if (toolbar) toolbar.style.display = 'none'; }

  // ---------- add selection ----------
  function currentSelectionIfValid() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
    const range = sel.getRangeAt(0);
    const text = sel.toString().trim();
    if (text.length < 3) return null;
    if (!inScope(range.startContainer) || !inScope(range.endContainer)) return null;
    return { sel, range, text };
  }
  function addCurrentSelection() {
    const info = currentSelectionIfValid();
    if (!info) return;
    // duplicate guard (same page + same text)
    const existing = Store.list().find(i => i.page === pageKey() && i.text === info.text);
    if (existing) {
      window.getSelection().removeAllRanges();
      hideToolbar();
      toastBrief('already in cart');
      return;
    }
    const item = {
      id: 'c_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      page: pageKey(),
      pageTitle: pageTitle(),
      text: info.text,
      context: contextFor(info.range),
      ts: Date.now(),
    };
    // Wrap the live Range BEFORE the selection is cleared — this is the
    // authoritative highlight. Text-matching on reload is a secondary path.
    let wrapped = false;
    try {
      wrapRange(info.range, item, { flash: true });
      wrapped = true;
    } catch (e) { /* fall through to text-match */ }
    Store.add(item);
    window.getSelection().removeAllRanges();
    hideToolbar();
    if (!wrapped) renderHighlights();
    flashBadge();
  }

  // ---------- highlights ----------
  // Walk text nodes inside scope containers, find exact text match, wrap a Range with <mark>.
  function renderHighlights() {
    // Clear existing marks we added (leave structure intact)
    document.querySelectorAll('mark.concept-saved').forEach(m => {
      const parent = m.parentNode;
      while (m.firstChild) parent.insertBefore(m.firstChild, m);
      parent.removeChild(m);
      parent.normalize();
    });

    const items = Store.forPage(pageKey());
    if (items.length === 0) return;

    document.querySelectorAll(SCOPE_SEL).forEach(container => {
      items.forEach(item => highlightInContainer(container, item));
    });
  }
  function highlightInContainer(container, item) {
    // Skip if this item is already wrapped somewhere (e.g. live-wrapped at save time)
    if (container.querySelector(`mark.concept-saved[data-cart-id="${item.id}"]`)) return;

    // Build flat text with node/offset map.
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
      acceptNode(n) {
        if (!n.nodeValue) return NodeFilter.FILTER_REJECT;
        if (n.parentElement && n.parentElement.closest('mark.concept-saved, .cart-toolbar, .cart-drawer, script, style')) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    const nodes = [];
    let flat = '';
    let n;
    while ((n = walker.nextNode())) {
      nodes.push({ node: n, start: flat.length, end: flat.length + n.nodeValue.length });
      flat += n.nodeValue;
    }

    const span = findMatchSpan(flat, item.text);
    if (!span) return;

    const startInfo = nodes.find(nn => span.start >= nn.start && span.start < nn.end);
    const endInfo = nodes.find(nn => span.end > nn.start && span.end <= nn.end);
    if (!startInfo || !endInfo) return;

    try {
      const range = document.createRange();
      range.setStart(startInfo.node, span.start - startInfo.start);
      range.setEnd(endInfo.node, span.end - endInfo.start);
      wrapRange(range, item);
    } catch (e) { /* skip */ }
  }

  // Find `needle` inside `hay` with whitespace-tolerant matching.
  // Returns {start, end} indices into the ORIGINAL hay string, or null.
  function findMatchSpan(hay, needle) {
    // Fast path: exact match
    let idx = hay.indexOf(needle);
    if (idx >= 0) return { start: idx, end: idx + needle.length };

    // Normalized match: collapse all whitespace runs to a single space.
    // Build a map from normalized index -> original index.
    const normChars = [];
    const origMap = [];   // origMap[i] = original index of normChars[i]
    let prevWs = false;
    for (let i = 0; i < hay.length; i++) {
      const ch = hay[i];
      const isWs = /\s/.test(ch);
      if (isWs) {
        if (!prevWs) { normChars.push(' '); origMap.push(i); }
        prevWs = true;
      } else {
        normChars.push(ch); origMap.push(i);
        prevWs = false;
      }
    }
    const normHay = normChars.join('');
    const normNeedle = needle.replace(/\s+/g, ' ').trim();
    if (!normNeedle) return null;
    const nIdx = normHay.indexOf(normNeedle);
    if (nIdx < 0) return null;
    const start = origMap[nIdx];
    const endNormIdx = nIdx + normNeedle.length - 1;
    if (endNormIdx >= origMap.length) return null;
    // end should point one past the last matched char in original
    let endOrig = origMap[endNormIdx];
    // if last matched normalized char is a space, extend endOrig to consume the run
    if (normHay[endNormIdx] === ' ') {
      while (endOrig < hay.length && /\s/.test(hay[endOrig])) endOrig++;
    } else {
      endOrig += 1;
    }
    return { start, end: endOrig };
  }
  function wrapRange(range, item, opts) {
    const flash = opts && opts.flash;
    // Walk every text node intersecting the range, in document order. The
    // TreeWalker root must be an Element — it won't yield text nodes when
    // rooted on a text node.
    let root = range.commonAncestorContainer;
    if (root.nodeType !== 1) root = root.parentNode;
    if (!root) return;

    // Snapshot boundaries — DOM mutations below will invalidate the live range.
    const startNode = range.startContainer;
    const startOffset = range.startOffset;
    const endNode = range.endContainer;
    const endOffset = range.endOffset;

    const pieces = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(n) {
        if (!n.nodeValue) return NodeFilter.FILTER_REJECT;
        if (n.parentElement && n.parentElement.closest('mark.concept-saved, .cart-toolbar, .cart-drawer, script, style')) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    let node;
    while ((node = walker.nextNode())) {
      if (range.intersectsNode(node)) pieces.push(node);
    }

    let firstMark = null;
    pieces.forEach(n => {
      let from = 0, to = n.nodeValue.length;
      if (n === startNode) from = startOffset;
      if (n === endNode) to = endOffset;
      if (to <= from) return;
      const before = n.nodeValue.slice(0, from);
      const middle = n.nodeValue.slice(from, to);
      const after = n.nodeValue.slice(to);
      if (!middle) return;
      const mark = document.createElement('mark');
      mark.className = 'concept-saved';
      mark.dataset.cartId = item.id;
      mark.textContent = middle;
      const parent = n.parentNode;
      if (!parent) return;
      if (before) parent.insertBefore(document.createTextNode(before), n);
      parent.insertBefore(mark, n);
      if (after) parent.insertBefore(document.createTextNode(after), n);
      parent.removeChild(n);
      if (!firstMark) firstMark = mark;
    });
    if (flash && firstMark) {
      firstMark.classList.add('just-added');
      setTimeout(() => firstMark.classList.remove('just-added'), 900);
    }
  }

  // ---------- nav button + drawer ----------
  let drawer = null;
  let navBtn = null;
  function ensureNavButton() {
    if (navBtn) return;
    const pager = document.querySelector('.site-nav .pager') || document.querySelector('.site-nav');
    if (!pager) return;
    navBtn = document.createElement('button');
    navBtn.className = 'cart-nav-btn';
    navBtn.type = 'button';
    navBtn.innerHTML = 'concepts <span class="cart-count">0</span>';
    navBtn.addEventListener('click', () => toggleDrawer());
    pager.appendChild(navBtn);
    updateCount();
  }
  function updateCount() {
    if (!navBtn) return;
    const n = Store.list().length;
    navBtn.querySelector('.cart-count').textContent = String(n);
    navBtn.classList.toggle('has-items', n > 0);
  }
  function flashBadge() {
    if (!navBtn) return;
    navBtn.classList.add('flash');
    setTimeout(() => navBtn.classList.remove('flash'), 700);
  }

  function ensureDrawer() {
    if (drawer) return drawer;
    drawer = document.createElement('aside');
    drawer.className = 'cart-drawer';
    drawer.setAttribute('aria-hidden', 'true');
    drawer.innerHTML = `
      <header class="cart-drawer-head">
        <h2>Concepts cart</h2>
        <div class="cart-drawer-actions">
          <button type="button" class="cart-export">export md</button>
          <button type="button" class="cart-clear">clear all</button>
          <button type="button" class="cart-close" aria-label="close">✕</button>
        </div>
      </header>
      <div class="cart-drawer-subhead">
        <span class="cart-pref-label">ask Claude opens in</span>
        <div class="cart-pref-toggle" role="radiogroup" aria-label="launch target">
          <button type="button" class="cart-pref" data-mode="desktop" role="radio">desktop</button>
          <button type="button" class="cart-pref" data-mode="web" role="radio">web</button>
        </div>
      </div>
      <div class="cart-drawer-body"></div>
    `;
    document.body.appendChild(drawer);
    drawer.querySelector('.cart-close').addEventListener('click', () => toggleDrawer(false));
    drawer.querySelector('.cart-clear').addEventListener('click', () => {
      if (Store.list().length === 0) return;
      if (confirm('Clear all saved concepts?')) { Store.clear(); renderHighlights(); }
    });
    drawer.querySelectorAll('.cart-pref').forEach(btn => {
      btn.addEventListener('click', () => {
        Pref.mode = btn.dataset.mode;
        updatePrefUI();
      });
    });
    drawer.querySelector('.cart-export').addEventListener('click', async () => {
      const items = Store.list();
      if (items.length === 0) { toastBrief('cart is empty'); return; }
      const md = exportMarkdown(items);
      try {
        await navigator.clipboard.writeText(md);
        toastBrief('markdown copied');
      } catch (e) { toastBrief('copy failed'); }
    });
    return drawer;
  }
  function toggleDrawer(open) {
    ensureDrawer();
    const want = (open === undefined) ? !drawer.classList.contains('open') : !!open;
    drawer.classList.toggle('open', want);
    drawer.setAttribute('aria-hidden', want ? 'false' : 'true');
    if (want) { renderDrawer(); updatePrefUI(); }
  }
  function updatePrefUI() {
    if (!drawer) return;
    const mode = Pref.mode;
    drawer.querySelectorAll('.cart-pref').forEach(b => {
      b.classList.toggle('active', b.dataset.mode === mode);
      b.setAttribute('aria-checked', b.dataset.mode === mode ? 'true' : 'false');
    });
  }
  function renderDrawer() {
    ensureDrawer();
    const body = drawer.querySelector('.cart-drawer-body');
    const items = Store.list().slice().sort((a, b) => a.ts - b.ts);
    if (items.length === 0) {
      body.innerHTML = '<p class="cart-empty">Your cart is empty. Highlight text on a diagram to add concepts.</p>';
      return;
    }
    // Group by page, preserve first-added order within groups
    const groups = new Map();
    items.forEach(i => {
      if (!groups.has(i.page)) groups.set(i.page, { title: i.pageTitle, page: i.page, items: [] });
      groups.get(i.page).items.push(i);
    });
    const parts = [];
    groups.forEach(g => {
      const href = toHref(g.page);
      parts.push(`<section class="cart-group">
        <h3><a href="${href}">${escapeHtml(g.title || g.page)}</a></h3>
        ${g.items.map(renderItem).join('')}
      </section>`);
    });
    body.innerHTML = parts.join('');
    body.querySelectorAll('textarea.cart-item-questions').forEach(ta => {
      // autosize a little
      ta.addEventListener('input', () => {
        ta.style.height = 'auto';
        ta.style.height = Math.min(ta.scrollHeight, 260) + 'px';
        clearTimeout(ta._saveH);
        ta._saveH = setTimeout(() => {
          Store.update(ta.dataset.id, { questions: ta.value });
        }, 250);
      });
      // trigger initial autosize
      ta.style.height = 'auto';
      ta.style.height = Math.min(ta.scrollHeight, 260) + 'px';
    });
    body.querySelectorAll('[data-action]').forEach(el => {
      const id = el.dataset.id;
      const action = el.dataset.action;
      el.addEventListener('click', (ev) => {
        ev.preventDefault();
        const item = Store.list().find(x => x.id === id);
        if (!item) return;
        if (action === 'remove') { Store.remove(id); renderHighlights(); renderDrawer(); }
        else if (action === 'ask') { askClaude(item); }
        else if (action === 'jump') { jumpTo(item); }
        else if (action === 'copy') { copyPrompt(item); }
      });
    });
  }
  function renderItem(item) {
    const onThisPage = item.page === pageKey();
    const qs = item.questions || '';
    return `<article class="cart-item" data-cart-id="${item.id}">
      <blockquote class="cart-item-text">${escapeHtml(item.text)}</blockquote>
      <textarea id="q-${item.id}" class="cart-item-questions" data-id="${item.id}"
        placeholder="What do you want to understand?"
        rows="2">${escapeHtml(qs)}</textarea>
      <div class="cart-item-actions">
        <button type="button" class="ask-claude" data-action="ask" data-id="${item.id}">ask Claude →</button>
        <button type="button" data-action="copy" data-id="${item.id}">copy prompt</button>
        ${onThisPage ? `<button type="button" data-action="jump" data-id="${item.id}">jump to</button>` : ''}
        <button type="button" class="cart-remove" data-action="remove" data-id="${item.id}">remove</button>
      </div>
    </article>`;
  }
  function toHref(page) {
    // from current page to the target page
    const here = pageKey();
    if (here === page) return '#';
    const inDiagrams = here.startsWith('diagrams/');
    const targetInDiagrams = page.startsWith('diagrams/');
    if (inDiagrams && targetInDiagrams) return page.replace('diagrams/', '');
    if (inDiagrams && !targetInDiagrams) return '../' + page;
    if (!inDiagrams && targetInDiagrams) return page;
    return page;
  }

  function jumpTo(item) {
    const mark = document.querySelector(`mark.concept-saved[data-cart-id="${item.id}"]`);
    if (!mark) return;
    toggleDrawer(false);
    mark.scrollIntoView({ behavior: 'smooth', block: 'center' });
    mark.classList.add('pulse');
    setTimeout(() => mark.classList.remove('pulse'), 1400);
  }

  // ---------- Claude handoff ----------
  function buildPrompt(item) {
    const userQs = (item.questions || '').trim();
    const hasQs = userQs.length > 0;
    const lines = [
      `# Concept deep-dive — Tracktion Engine`,
      ``,
      `I'm reading a teaching microsite that walks through the architecture of **Tracktion Engine** (a C++ DAW built on JUCE, v3.2.0, commit 2877b621). Each page covers one subsystem with a diagram and commentary. I got stuck on a concept and saved it to a "concepts cart" — now I'm asking you to unpack it.`,
      ``,
      `## The concept`,
      `> ${item.text.replace(/\n+/g, ' ')}`,
      ``,
    ];
    if (hasQs) {
      lines.push(`## My specific questions`, ``);
      userQs.split(/\n+/).forEach(q => {
        const t = q.trim();
        if (t) lines.push(`- ${t}`);
      });
      lines.push(``);
    }
    lines.push(
      `## Where I read it`,
      `- Page: **${item.pageTitle}**`,
      `- Page slug: \`${item.page}\``,
      ``,
      `## Surrounding paragraph (for framing)`,
      `> ${(item.context || '(no surrounding context captured)').replace(/\n+/g, ' ')}`,
      ``,
      `## How I learn`,
      `I'm a visual learner — draw diagrams to explain this, using whatever diagramming tool you have. Keep prose tight around them.`,
      ``,
      `## How to answer`,
      hasQs
        ? `Prioritise my specific questions above. Then, if relevant, round out the answer with:`
        : `I didn't write specific questions, so please cover:`,
      `1. What the concept is — plain-English first, then the precise definition.`,
      `2. Where it sits in DAW/audio-engine architecture: what problem it solves, what it is between, which threads or lifecycles it touches.`,
      `3. A concrete example — a code sketch or a realistic user-visible scenario — grounded in how a DAW actually works.`,
      `4. The subtle tradeoff or gotcha most readers miss on first pass.`,
      ``,
      `Assume I'm a confident developer and know JUCE only vaguely. Be thorough and don't pad with disclaimers.`,
    );
    return lines.join('\n');
  }
  function askClaude(item) {
    const prompt = buildPrompt(item);
    const encoded = encodeURIComponent(prompt.slice(0, 13500));
    if (Pref.mode === 'desktop') {
      // claude:// scheme — opens Claude Desktop if installed, OS dialog if not.
      window.location.href = CLAUDE_URL_DESKTOP + encoded;
    } else {
      window.open(CLAUDE_URL_WEB + encoded, '_blank', 'noopener');
    }
  }
  async function copyPrompt(item) {
    const prompt = buildPrompt(item);
    try {
      await navigator.clipboard.writeText(prompt);
      toastBrief('prompt copied');
    } catch (e) {
      // fallback
      const ta = document.createElement('textarea');
      ta.value = prompt;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); toastBrief('prompt copied'); }
      finally { document.body.removeChild(ta); }
    }
  }
  function exportMarkdown(items) {
    const groups = new Map();
    items.forEach(i => {
      if (!groups.has(i.page)) groups.set(i.page, { title: i.pageTitle, items: [] });
      groups.get(i.page).items.push(i);
    });
    const lines = ['# Tracktion concepts cart', ''];
    groups.forEach(g => {
      lines.push(`## ${g.title}`, '');
      g.items.forEach(it => {
        lines.push(`- **${it.text}**`);
        if (it.context) lines.push(`  - context: ${it.context}`);
        if (it.questions && it.questions.trim()) {
          it.questions.split(/\n+/).map(q => q.trim()).filter(Boolean).forEach(q => {
            lines.push(`  - ? ${q}`);
          });
        }
        lines.push('');
      });
    });
    return lines.join('\n');
  }
  function toastBrief(msg) {
    let t = document.querySelector('.cart-toast');
    if (!t) { t = document.createElement('div'); t.className = 'cart-toast'; document.body.appendChild(t); }
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(t._h);
    t._h = setTimeout(() => t.classList.remove('show'), 1400);
  }

  // ---------- utils ----------
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  // ---------- events ----------
  function onMouseUp() {
    // small delay so selection is finalized
    setTimeout(() => {
      const info = currentSelectionIfValid();
      if (!info) { hideToolbar(); return; }
      const rect = info.range.getBoundingClientRect();
      if (!rect || (rect.width === 0 && rect.height === 0)) { hideToolbar(); return; }
      showToolbar(rect);
    }, 10);
  }
  function onSelectionChange() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) hideToolbar();
  }
  function onKey(e) {
    if (e.key === 'Escape') { hideToolbar(); toggleDrawer(false); }
    else if ((e.key === 'c' || e.key === 'C') && !e.metaKey && !e.ctrlKey && !e.altKey) {
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      toggleDrawer();
    }
  }
  function onClickOutside(e) {
    if (!toolbar || toolbar.style.display === 'none') return;
    if (toolbar.contains(e.target)) return;
    // If click is outside the selection, hide.
    setTimeout(() => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed) hideToolbar();
    }, 0);
  }

  // ---------- init ----------
  function onMarkClick(e) {
    const mark = e.target.closest && e.target.closest('mark.concept-saved');
    if (!mark) return;
    // If user is selecting text, don't hijack.
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed) return;
    const id = mark.dataset.cartId;
    if (!id) return;
    e.preventDefault();
    openCartToItem(id);
  }
  function openCartToItem(id) {
    toggleDrawer(true);
    // Wait for drawer slide-in + DOM render
    requestAnimationFrame(() => {
      setTimeout(() => {
        const article = drawer && drawer.querySelector(`.cart-item[data-cart-id="${id}"]`);
        if (!article) return;
        article.scrollIntoView({ behavior: 'smooth', block: 'center' });
        article.classList.add('cart-item-focus');
        setTimeout(() => article.classList.remove('cart-item-focus'), 1400);
      }, 220);
    });
  }

  function init() {
    ensureNavButton();
    renderHighlights();
    document.addEventListener('mouseup', onMouseUp);
    document.addEventListener('selectionchange', onSelectionChange);
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClickOutside);
    document.addEventListener('click', onMarkClick);
    document.addEventListener('cart:change', () => { updateCount(); });
    window.addEventListener('storage', (e) => {
      if (e.key === STORAGE_KEY) { updateCount(); renderHighlights(); if (drawer && drawer.classList.contains('open')) renderDrawer(); }
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
