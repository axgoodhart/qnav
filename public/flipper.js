/* Cufolio live flipper, sessions indicator, captures and contact sheet.
 * Talks to the qnav preview service (/api/preview/*) and capture worker (/api/captures/*).
 */
(() => {
  const consumerId = 'ui_' + Math.random().toString(36).slice(2, 10);
  const $ = (id) => document.getElementById(id);
  const esc = (t) => { const d = document.createElement('div'); d.textContent = t == null ? '' : String(t); return d.innerHTML; };
  const fmtTime = (iso) => { if (!iso) return '—'; const d = new Date(iso); return isNaN(d) ? iso : d.toLocaleString(); };
  const fmtSize = (n) => { if (n == null) return '—'; if (n < 1024) return n + ' B'; if (n < 1048576) return (n / 1024).toFixed(1) + ' KB'; return (n / 1048576).toFixed(1) + ' MB'; };
  const IFRAME_ALLOW = 'autoplay; fullscreen; microphone; camera; midi; gamepad; xr-spatial-tracking; clipboard-read; clipboard-write; accelerometer; gyroscope';
  const LOAD_NOTICE_MS = 30000;

  const api = {
    async get(url) { const r = await fetch(url); if (!r.ok) throw await api.err(r); return r.json(); },
    async post(url, body) { const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) }); if (!r.ok) throw await api.err(r); return r.json(); },
    async put(url, body) { const r = await fetch(url, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) }); if (!r.ok) throw await api.err(r); return r.json(); },
    async del(url) { const r = await fetch(url, { method: 'DELETE' }); if (!r.ok) throw await api.err(r); return r.json(); },
    async err(r) { let data = null; try { data = await r.json(); } catch {} const e = new Error((data && data.error) || `HTTP ${r.status}`); e.status = r.status; e.plan = data && data.plan; return e; },
  };

  function toast(msg, ms = 3200) {
    const el = document.createElement('div');
    el.className = 'cap-toast';
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), ms);
  }

  // ======================================================================
  // Sessions indicator (header)
  // ======================================================================
  const Sessions = {
    map: new Map(),
    track(s) {
      if (s.mode !== 'managed' && s.mode !== 'external') return;
      if (s.state === 'stopped' || s.state === 'failed') this.map.delete(s.id); else this.map.set(s.id, s);
      this.render();
    },
    async load() {
      try { const d = await api.get('/api/preview/sessions'); d.sessions.forEach(s => this.track(s)); } catch {}
    },
    render() {
      const btn = $('sessionsIndicator');
      const n = [...this.map.values()].filter(s => s.state === 'ready' || s.state === 'starting' || s.state === 'queued').length;
      $('sessionsCount').textContent = n;
      btn.classList.toggle('hidden', n === 0);
      const pop = $('sessionsPopover');
      if (pop && !pop.classList.contains('hidden')) this.renderPopover();
    },
    toggle() {
      let pop = $('sessionsPopover');
      if (!pop) {
        pop = document.createElement('div');
        pop.id = 'sessionsPopover';
        pop.className = 'popover';
        document.body.appendChild(pop);
      }
      pop.classList.toggle('hidden');
      if (!pop.classList.contains('hidden')) this.renderPopover();
    },
    renderPopover() {
      const pop = $('sessionsPopover'); if (!pop) return;
      const list = [...this.map.values()];
      pop.innerHTML = `<div class="popover-head"><span class="title">Dev servers owned by qnav</span><button onclick="document.getElementById('sessionsPopover').classList.add('hidden')"><span class="material-symbols-rounded">close</span></button></div>` +
        (list.length ? list.map(s => `
          <div class="popover-row">
            <span class="fl-badge state-${s.state}">${s.state}</span>
            <span class="name" title="${esc(s.url || '')}">${esc(s.projectName)}${s.external ? ' <span class="ext">(external)</span>' : ''}${s.pinned ? ' 📌' : ''}</span>
            <span class="use">${s.consumers.length ? s.consumers.length + ' in use' : 'idle'}</span>
            <button title="${s.pinned ? 'Unpin' : 'Pin (protect from idle eviction)'}" onclick="Flipper.pinSession('${s.id}', ${!s.pinned})"><span class="material-symbols-rounded">push_pin</span></button>
            ${s.external ? '<span class="na" title="External servers are never stopped by qnav">—</span>' : `<button class="stop" title="Stop" onclick="Flipper.stopSession('${s.id}')"><span class="material-symbols-rounded">stop_circle</span></button>`}
          </div>`).join('') : '<div class="popover-empty">No running dev servers.</div>');
    },
  };

  // ======================================================================
  // Flipper
  // ======================================================================
  const Flipper = {
    consumerId,
    isOpen: false,
    order: [],
    index: -1,
    token: 0,
    current: null,      // { id, plan, session, state, log: [] }
    saved: null,
    detailsOpen: false,
    els: {},

    init() {
      const ids = ['flipperView', 'flCloseBtn', 'flName', 'flModeBadge', 'flStateBadge', 'flBuildBadge', 'flPosition', 'flPrevBtn', 'flNextBtn', 'flReloadBtn', 'flOpenBtn', 'flCaptureBtn', 'flExploreBtn', 'flDetailsBtn', 'flScrubber', 'flStage', 'flDetails'];
      ids.forEach(id => this.els[id] = $(id));
      const e = this.els;
      e.flCloseBtn.addEventListener('click', () => this.close());
      e.flPrevBtn.addEventListener('click', () => this.go(-1));
      e.flNextBtn.addEventListener('click', () => this.go(1));
      e.flReloadBtn.addEventListener('click', () => this.reload());
      e.flCaptureBtn.addEventListener('click', () => { if (this.current) Captures.captureOne(this.current.id); });
      e.flExploreBtn.addEventListener('click', () => this.openExplorer());
      e.flDetailsBtn.addEventListener('click', () => this.toggleDetails());
      e.flScrubber.addEventListener('input', () => this.goTo(parseInt(e.flScrubber.value, 10)));
      try { this.detailsOpen = localStorage.getItem('qnav-flipper-details') === '1'; } catch {}

      // Arrow keys navigate only when focus is on the flipper chrome, never inside the page.
      e.flipperView.addEventListener('keydown', (ev) => this.onKey(ev));
      document.addEventListener('keydown', (ev) => {
        if (!this.isOpen) return;
        if (document.activeElement === document.body) this.onKey(ev);
      });
      window.addEventListener('beforeunload', () => this.releaseCurrent(true));

      // While the flipper is open, sidebar clicks jump the flipper instead of opening detail.
      $('projectList').addEventListener('click', (ev) => {
        if (!this.isOpen) return;
        const item = ev.target.closest('[data-project-id]');
        if (!item) return;
        ev.stopPropagation(); ev.preventDefault();
        this.jumpTo(item.dataset.projectId);
      }, true);

      $('sessionsIndicator').addEventListener('click', () => Sessions.toggle());
      Sessions.load();
    },

    onKey(ev) {
      const t = ev.target;
      const tag = t && t.tagName ? t.tagName.toLowerCase() : '';
      const typing = tag === 'input' || tag === 'textarea' || tag === 'select' || (t && t.isContentEditable);
      if (ev.key === 'Escape') { ev.preventDefault(); if ($('flExplorer')) { this.closeExplorer(); return; } this.close(); return; }
      if (typing) return;
      if (ev.key === 'ArrowLeft') { ev.preventDefault(); this.go(-1); }
      else if (ev.key === 'ArrowRight') { ev.preventDefault(); this.go(1); }
      else if (ev.key === 'r' || ev.key === 'R') { ev.preventDefault(); this.reload(); }
      else if (ev.key === 'd' || ev.key === 'D') { ev.preventDefault(); this.toggleDetails(); }
    },

    open(projectId, opts = {}) {
      const filtered = (App.lastFiltered && App.lastFiltered.length ? App.lastFiltered : App.data).map(p => p.id);
      let order = opts.order || filtered;
      if (!order.includes(projectId)) order = [projectId, ...order];
      if (!this.isOpen) {
        this.saved = { hash: location.hash, scrollTop: $('projectList').scrollTop, focus: document.activeElement };
        this.isOpen = true;
        this.els.flipperView.classList.remove('hidden');
        history.pushState({ flipper: true }, '', '#/preview/' + encodeURIComponent(projectId));
        this.els.flDetails.classList.toggle('hidden', !this.detailsOpen);
        this.els.flDetailsBtn.setAttribute('aria-expanded', String(this.detailsOpen));
      }
      this.order = order;
      this.index = order.indexOf(projectId);
      this.navigate();
      this.els.flipperView.focus({ preventScroll: true });
    },

    close(opts = {}) {
      if (!this.isOpen) return;
      this.closeExplorer();
      this.releaseCurrent();
      this.destroyIframe();
      this.current = null;
      this.token++;
      this.isOpen = false;
      this.els.flipperView.classList.add('hidden');
      if (!opts.fromHistory) history.replaceState(null, '', this.saved && this.saved.hash ? this.saved.hash : '#/');
      const list = $('projectList');
      if (this.saved) list.scrollTop = this.saved.scrollTop;
      const back = this.saved && this.saved.focus && document.contains(this.saved.focus) ? this.saved.focus : null;
      if (back && typeof back.focus === 'function') back.focus({ preventScroll: true });
      this.saved = null;
    },

    go(delta) { this.goTo(this.index + delta); },
    goTo(i) {
      if (!this.order.length) return;
      const clamped = Math.max(0, Math.min(this.order.length - 1, i));
      if (clamped === this.index) return;
      this.index = clamped;
      this.navigate();
      this.scrollListTo(this.order[this.index]);
    },
    jumpTo(projectId) {
      let i = this.order.indexOf(projectId);
      if (i < 0) { this.order.splice(this.index + 1, 0, projectId); i = this.index + 1; }
      this.index = i;
      this.navigate();
    },
    scrollListTo(id) {
      const el = document.querySelector(`#projectList [data-project-id="${CSS.escape(id)}"]`);
      const list = $('projectList');
      if (el) {
        // Scroll only the list container; scrollIntoView would also drag the page.
        const top = el.offsetTop - list.offsetTop;
        if (top < list.scrollTop) list.scrollTop = top;
        else if (top + el.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = top + el.offsetHeight - list.clientHeight;
      }
      document.querySelectorAll('#projectList .fl-active').forEach(x => x.classList.remove('fl-active'));
      if (el) el.classList.add('fl-active');
    },

    onCatalogUpdate() {
      if (!this.isOpen || !this.current) return;
      // A rescan must not move the selection; only react if the item vanished.
      if (!App.byId(this.current.id) && this.current.state !== 'removed') {
        this.releaseCurrent();
        this.destroyIframe();
        this.setState('removed');
      }
    },

    async navigate() {
      const id = this.order[this.index];
      const token = ++this.token;
      this.releaseCurrent();
      this.destroyIframe();
      const project = App.byId(id);
      this.current = { id, plan: null, session: null, state: 'loading', log: [], token };
      history.replaceState({ flipper: true }, '', '#/preview/' + encodeURIComponent(id));
      this.renderHeader(project);
      if (!project) { this.setState('removed'); return; }
      this.setState('loading', 'Resolving preview…');
      let result;
      try {
        result = await api.post('/api/preview/acquire', { projectId: id, consumerId });
      } catch (err) {
        if (token !== this.token) return;
        if (err.plan) { this.current.plan = err.plan; this.renderPlanState(err.plan); }
        else this.setState('failed', { code: 'request', message: err.message });
        this.renderDetails();
        return;
      }
      if (token !== this.token) {
        // Late response for a project we already left: give the session back.
        api.post('/api/preview/release', { sessionId: result.session.id, consumerId }).catch(() => {});
        return;
      }
      this.current.plan = result.plan;
      this.current.session = result.session;
      Sessions.track(result.session);
      if (result.session.mode === 'managed' && !result.session.external) {
        api.get('/api/preview/log/' + result.session.id).then(d => { if (this.current && this.current.session && this.current.session.id === result.session.id) { this.current.log = d.lines; this.renderLog(); } }).catch(() => {});
      }
      this.applySession(result.session);
      this.renderDetails();
    },

    releaseCurrent(unloading) {
      const c = this.current;
      if (!c || !c.session) return;
      const body = JSON.stringify({ sessionId: c.session.id, consumerId });
      if (unloading && navigator.sendBeacon) {
        navigator.sendBeacon('/api/preview/release', new Blob([body], { type: 'application/json' }));
      } else {
        fetch('/api/preview/release', { method: 'POST', headers: { 'content-type': 'application/json' }, body, keepalive: true }).catch(() => {});
      }
      c.session = null;
    },

    onSession(s) {
      Sessions.track(s);
      const c = this.current;
      if (!c || !c.session || c.session.id !== s.id) return;
      const prevState = c.session.state;
      c.session = s;
      if (s.state !== prevState || s.state === 'queued') this.applySession(s);
      this.renderDetails();
    },

    onLog({ sessionId, lines }) {
      const c = this.current;
      if (!c || !c.session || c.session.id !== sessionId) return;
      c.log.push(...lines);
      if (c.log.length > 300) c.log.splice(0, c.log.length - 300);
      if (c.state === 'loading') this.renderLoadingTail();
      this.renderLog();
    },

    applySession(s) {
      switch (s.state) {
        case 'ready':
          if (s.embedBlocked) { this.setState('embed-blocked', s); break; }
          this.setState('displayed');
          this.mountIframe(s.url);
          break;
        case 'starting':
          this.setState('loading', 'Starting dev server…');
          break;
        case 'queued':
          this.setState('loading', `Waiting for capacity — occupied by ${s.queueInfo ? s.queueInfo.occupying.join(', ') : 'other sessions'}`);
          break;
        case 'failed':
          this.setState('failed', s.error || { code: 'unknown', message: 'Preview failed.' });
          break;
        case 'stopping':
        case 'stopped':
          this.setState('stopped', s.error || { code: 'stopped', message: s.note || 'Session stopped.' });
          break;
      }
      this.renderHeader(App.byId(this.current.id));
    },

    // ---------------------------------------------------------------- iframe

    mountIframe(url) {
      this.destroyIframe();
      const frame = document.createElement('iframe');
      frame.setAttribute('allow', IFRAME_ALLOW);
      frame.setAttribute('referrerpolicy', 'no-referrer');
      frame.title = `Preview of ${this.current ? esc(App.byId(this.current.id)?.name || '') : ''}`;
      frame.src = url;
      this.els.flStage.appendChild(frame);
      this.current.iframe = frame;
      this.els.flOpenBtn.href = url;
      const token = this.token;
      this.current.loadTimer = setTimeout(() => {
        if (token !== this.token) return;
        this.showNotice('The page has not finished loading after 30s. Navigation stays available; the frame keeps loading.');
      }, LOAD_NOTICE_MS);
      frame.addEventListener('load', () => {
        if (token !== this.token) return;
        clearTimeout(this.current.loadTimer);
        this.hideNotice();
      }, { once: true });
    },

    destroyIframe() {
      const c = this.current;
      if (c && c.loadTimer) clearTimeout(c.loadTimer);
      // Replace rather than reuse: releases the old page's timers, audio, sockets.
      this.els.flStage.querySelectorAll('iframe').forEach(f => { try { f.src = 'about:blank'; } catch {} f.remove(); });
      this.hideNotice();
      if (c) c.iframe = null;
    },

    reload() {
      const c = this.current;
      if (!c) return;
      if (c.session && c.session.state === 'ready' && c.session.url) { this.setState('displayed'); this.mountIframe(c.session.url); }
      else { this.index = this.index; this.navigate(); }
    },

    showNotice(text) {
      let n = $('flNotice');
      if (!n) { n = document.createElement('div'); n.id = 'flNotice'; n.className = 'fl-notice'; this.els.flStage.appendChild(n); }
      n.textContent = text;
    },
    hideNotice() { const n = $('flNotice'); if (n) n.remove(); },

    // ---------------------------------------------------------------- state rendering

    setState(state, payload) {
      if (!this.current) return;
      this.current.state = state;
      this.current.payload = payload;
      const stage = this.els.flStage;
      stage.querySelectorAll('.fl-overlay').forEach(o => o.remove());
      const project = App.byId(this.current.id);
      const name = project ? project.name : this.current.id;
      let html = '';
      if (state === 'loading') {
        html = `<div class="fl-overlay translucent"><div class="fl-card fl-center"><div class="fl-spinner"></div><h3>${esc(name)}</h3><p id="flLoadingText">${esc(payload || 'Loading…')}</p><pre id="flLoadingTail" class="fl-log hidden"></pre></div></div>`;
      } else if (state === 'embed-blocked') {
        html = `<div class="fl-overlay"><div class="fl-card"><h3><span class="material-symbols-rounded fl-ico fl-ico--orange">web_asset_off</span>This app refuses to be embedded</h3><p>The server answered with <code class="fl-code">${esc(payload.embedBlocked)}</code>, so it cannot be shown inside the flipper. qnav does not strip headers.</p><div class="fl-actions"><a class="fl-btn primary" target="_blank" rel="noopener" href="${esc(payload.url)}"><span class="material-symbols-rounded">open_in_new</span>Open in new tab</a></div>${this.navActions()}</div></div>`;
      } else if (state === 'removed') {
        html = `<div class="fl-overlay"><div class="fl-card"><h3><span class="material-symbols-rounded fl-ico fl-ico--orange">inventory_2</span>No longer in the catalog</h3><p>This entry disappeared during a rescan (moved, renamed or deleted). Your position in the selection is kept.</p>${this.navActions()}</div></div>`;
      } else if (state === 'failed' || state === 'stopped') {
        const err = payload || {};
        html = `<div class="fl-overlay"><div class="fl-card"><h3><span class="material-symbols-rounded fl-ico fl-ico--red">error</span>${state === 'failed' ? 'Preview failed' : 'Session stopped'}</h3><p>${esc(err.message || '')}</p>${err.detail ? `<pre class="fl-log">${esc(err.detail)}</pre>` : ''}<div class="fl-actions"><button class="fl-btn primary" onclick="Flipper.retry()"><span class="material-symbols-rounded">refresh</span>Retry</button><button class="fl-btn" onclick="Flipper.toggleDetails(true)"><span class="material-symbols-rounded">tune</span>Edit launch settings</button>${this.current.session && this.current.session.url ? `<a class="fl-btn" target="_blank" rel="noopener" href="${esc(this.current.session.url)}"><span class="material-symbols-rounded">open_in_new</span>Open in new tab</a>` : ''}</div>${this.navActions()}</div></div>`;
      }
      if (html) stage.insertAdjacentHTML('beforeend', html);
      if (state === 'loading') this.renderLoadingTail();
      this.renderHeader(project);
    },

    navActions() {
      return `<div class="fl-actions"><button class="fl-btn" onclick="Flipper.go(-1)" ${this.index <= 0 ? 'disabled' : ''}><span class="material-symbols-rounded">chevron_left</span>Previous</button><button class="fl-btn" onclick="Flipper.go(1)" ${this.index >= this.order.length - 1 ? 'disabled' : ''}>Next<span class="material-symbols-rounded">chevron_right</span></button></div>`;
    },

    exploreAction() {
      return `<div class="fl-actions"><button class="fl-btn" onclick="Flipper.openExplorer()"><span class="material-symbols-rounded">folder_open</span>Explore all HTML files</button></div>`;
    },

    renderLoadingTail() {
      const tail = $('flLoadingTail');
      if (!tail || !this.current) return;
      const lines = this.current.log.slice(-6);
      tail.classList.toggle('hidden', lines.length === 0);
      tail.textContent = lines.join('\n');
    },

    renderPlanState(plan) {
      const stage = this.els.flStage;
      stage.querySelectorAll('.fl-overlay').forEach(o => o.remove());
      this.current.state = plan.mode;
      let body = '';
      if (plan.mode === 'choose-entry') {
        body = `<h3><span class="material-symbols-rounded fl-ico fl-ico--cyan">alt_route</span>Choose an entry point</h3><p>${esc(plan.reason || '')} The choice is remembered for this project.</p><ul class="choices">${plan.candidates.filter(c => !c.requiresBundler).map(c => `<li><button onclick="Flipper.chooseEntry(${JSON.stringify(c.relPath).replace(/"/g, '&quot;')})"><span>${esc(c.relPath)}</span><small>${esc(c.kind === 'built-output' ? 'existing build' : c.kind.replace('-', ' '))}</small></button></li>`).join('')}</ul>${this.exploreAction()}${this.navActions()}`;
      } else if (plan.mode === 'setup-required') {
        const cmd = (plan.overrides && plan.overrides.commandLine) || plan.suggestedCommandLine || (plan.launch ? `${plan.launch.command} ${plan.launch.args.join(' ')}` : '');
        body = `<h3><span class="material-symbols-rounded fl-ico fl-ico--yellow">build</span>Needs a development server</h3><p>${esc(plan.reason || '')}</p>${(plan.requirements || []).length ? `<ul class="why fl-warn">${plan.requirements.map(r => `<li>${esc(r)}</li>`).join('')}</ul>` : ''}
          ${plan.launchStatus === 'ambiguous' || plan.launchStatus === 'ok' ? `<label class="fl-label">Command to run in the project folder (use {PORT} or the PORT env var)</label><input type="text" id="flSetupCmd" class="fl-input" value="${esc(cmd)}"/><div class="fl-actions"><button class="fl-btn primary" onclick="Flipper.saveCommandAndLaunch()"><span class="material-symbols-rounded">play_arrow</span>Save command &amp; launch</button><button class="fl-btn" onclick="Flipper.toggleDetails(true)"><span class="material-symbols-rounded">tune</span>Details</button></div>` : `<div class="fl-actions"><button class="fl-btn" onclick="Flipper.toggleDetails(true)"><span class="material-symbols-rounded">tune</span>Details &amp; options</button></div>`}
          ${plan.staticAvailable ? `<p>A static entry also exists. <button class="fl-link" onclick="Flipper.setMode('static')">Show the static files instead</button>.</p>` : ''}${this.exploreAction()}${this.navActions()}`;
      } else {
        body = `<h3><span class="material-symbols-rounded fl-ico fl-ico--slate">block</span>No visual preview</h3><p>${esc(plan.reason || 'Nothing to show for this entry.')}</p><p class="fl-path">${esc(plan.projectPath)}</p><div class="fl-actions"><button class="fl-btn" onclick="Flipper.openExplorer()"><span class="material-symbols-rounded">folder_open</span>Explore all HTML files</button><button class="fl-btn" onclick="Flipper.toggleDetails(true)"><span class="material-symbols-rounded">tune</span>Attach a running server…</button></div>${this.navActions()}`;
      }
      stage.insertAdjacentHTML('beforeend', `<div class="fl-overlay"><div class="fl-card">${body}</div></div>`);
      this.renderHeader(App.byId(this.current.id));
    },

    renderHeader(project) {
      const e = this.els;
      const c = this.current;
      e.flName.textContent = project ? project.name : '(removed)';
      e.flPosition.textContent = `${this.index + 1} / ${this.order.length}`;
      e.flScrubber.max = Math.max(0, this.order.length - 1);
      e.flScrubber.value = String(Math.max(0, this.index));
      e.flPrevBtn.disabled = this.index <= 0;
      e.flNextBtn.disabled = this.index >= this.order.length - 1;
      const plan = c && c.plan;
      const session = c && c.session;
      const mode = plan && (plan.mode === 'static' || plan.mode === 'managed' || plan.mode === 'external') ? plan.mode : null;
      e.flModeBadge.classList.toggle('hidden', !mode);
      if (mode) { e.flModeBadge.className = 'fl-badge ' + mode; e.flModeBadge.textContent = mode; }
      e.flStateBadge.classList.toggle('hidden', !session);
      if (session) { e.flStateBadge.className = 'fl-badge state-' + session.state; e.flStateBadge.textContent = session.state; }
      e.flBuildBadge.classList.toggle('hidden', !(plan && plan.buildInfo));
      if (plan && plan.buildInfo) e.flBuildBadge.title = `Existing build output (${plan.buildInfo.path}) modified ${fmtTime(plan.buildInfo.mtime)} — may not reflect current source`;
      const url = session && session.url;
      e.flOpenBtn.href = url || '#';
      e.flOpenBtn.classList.toggle('is-dim', !url);
      e.flCaptureBtn.disabled = !(plan && mode);
      e.flExploreBtn.disabled = !c;
      e.flReloadBtn.disabled = !c;
    },

    // ---------------------------------------------------------------- actions

    async retry() {
      const c = this.current; if (!c) return;
      if (c.session && c.session.mode === 'managed' && (c.session.state === 'failed' || c.session.state === 'stopped')) {
        await api.post('/api/preview/forget', { sessionId: c.session.id }).catch(() => {});
      }
      this.navigate();
    },
    async chooseEntry(relPath) {
      const c = this.current; if (!c) return;
      try { await api.put('/api/preview/overrides/' + c.id, { entryRelPath: relPath, mode: 'static' }); this.navigate(); }
      catch (err) { toast('Could not save entry: ' + err.message); }
    },
    async setMode(mode) {
      const c = this.current; if (!c) return;
      try { await api.put('/api/preview/overrides/' + c.id, { mode }); this.navigate(); }
      catch (err) { toast('Could not switch mode: ' + err.message); }
    },
    async saveCommandAndLaunch() {
      const c = this.current; if (!c) return;
      const input = $('flSetupCmd') || $('flDetCmd');
      const commandLine = input ? input.value.trim() : '';
      if (!commandLine) { toast('Enter a command first.'); return; }
      const cwdInput = $('flDetCwd');
      try {
        await api.put('/api/preview/overrides/' + c.id, { commandLine, mode: 'managed', commandCwd: cwdInput ? cwdInput.value.trim() : '' });
        this.navigate();
      } catch (err) { toast('Could not save: ' + err.message); }
    },
    async attachExternal() {
      const c = this.current; if (!c) return;
      const url = ($('flDetExternal') || {}).value || '';
      if (!/^https?:\/\//.test(url)) { toast('Enter an http(s) URL.'); return; }
      try { await api.post('/api/preview/attach', { projectId: c.id, url }); this.navigate(); }
      catch (err) { toast('Could not attach: ' + err.message); }
    },
    async saveCaptureSettings() {
      const c = this.current; if (!c) return;
      const sel = ($('flDetSelector') || {}).value || '';
      const settle = parseInt(($('flDetSettle') || {}).value || '', 10);
      try { await api.put('/api/preview/overrides/' + c.id, { readinessSelector: sel, settleMs: Number.isFinite(settle) ? settle : '' }); toast('Capture settings saved.'); c.plan = await api.get('/api/preview/plan/' + c.id); this.renderDetails(); }
      catch (err) { toast('Could not save: ' + err.message); }
    },
    async resetOverrides() {
      const c = this.current; if (!c) return;
      try { await api.del('/api/preview/overrides/' + c.id); this.navigate(); }
      catch (err) { toast('Could not reset: ' + err.message); }
    },
    async stopSession(sessionId) {
      try { await api.post('/api/preview/stop', { sessionId }); } catch (err) { toast('Stop failed: ' + err.message); }
    },
    async restartSession(sessionId) {
      try { const d = await api.post('/api/preview/restart', { sessionId }); if (this.current && d.session) { this.current.session = d.session; this.applySession(d.session); this.renderDetails(); } }
      catch (err) { toast('Restart failed: ' + err.message); }
    },
    async pinSession(sessionId, pinned) {
      try { await api.post('/api/preview/pin', { sessionId, pinned }); } catch (err) { toast('Pin failed: ' + err.message); }
    },

    // ---------------------------------------------------------------- explore: every HTML file

    openExplorer() {
      const c = this.current; if (!c) return;
      this.closeExplorer();
      const project = App.byId(c.id);
      const modal = document.createElement('div');
      modal.id = 'flExplorer';
      modal.className = 'fl-overlay translucent ex-overlay';
      modal.innerHTML = `<div class="fl-card ex-wide" role="dialog" aria-label="Explore HTML files"><h3><span class="material-symbols-rounded fl-ico fl-ico--cyan">folder_open</span>Explore — ${esc(project ? project.name : c.id)}</h3><p class="fl-muted">Listing every HTML file…</p></div>`;
      document.body.appendChild(modal);
      modal.addEventListener('click', (ev) => { if (ev.target === modal) this.closeExplorer(); });
      (async () => {
        try {
          const [listing, plan] = await Promise.all([
            api.get('/api/preview/files/' + c.id),
            api.get('/api/preview/plan/' + c.id),
          ]);
          if (!document.getElementById('flExplorer')) return;
          Explorer.show(modal, c.id, plan, listing);
        } catch (err) {
          const card = modal.querySelector('.fl-card');
          if (card) card.innerHTML += `<p class="fl-red">Could not list files: ${esc(err.message)}</p>`;
        }
      })();
    },

    closeExplorer() { const m = $('flExplorer'); if (m) m.remove(); },

    async openFile(relPath) {
      const c = this.current; if (!c) return;
      const token = ++this.token;
      this.releaseCurrent();
      this.destroyIframe();
      this.closeExplorer();
      this.setState('loading', 'Opening ' + relPath + '…');
      let result;
      try {
        result = await api.post('/api/preview/acquire', { projectId: c.id, consumerId, entryRelPath: relPath });
      } catch (err) {
        if (token !== this.token) return;
        if (err.plan) { this.current.plan = err.plan; this.renderPlanState(err.plan); }
        else this.setState('failed', { message: err.message });
        this.renderDetails();
        return;
      }
      if (token !== this.token) {
        api.post('/api/preview/release', { sessionId: result.session.id, consumerId }).catch(() => {});
        return;
      }
      this.current.plan = result.plan;
      this.current.session = result.session;
      Sessions.track(result.session);
      this.applySession(result.session);
      this.renderDetails();
    },

    async saveExplorerEntry(relPath) {
      const c = this.current; if (!c) return;
      try {
        await api.put('/api/preview/overrides/' + c.id, { entryRelPath: relPath, mode: 'static' });
        this.closeExplorer();
        this.navigate();
      } catch (err) { toast('Could not save entry: ' + err.message); }
    },

    // ---------------------------------------------------------------- details drawer

    toggleDetails(force) {
      this.detailsOpen = typeof force === 'boolean' ? force : !this.detailsOpen;
      try { localStorage.setItem('qnav-flipper-details', this.detailsOpen ? '1' : '0'); } catch {}
      this.els.flDetails.classList.toggle('hidden', !this.detailsOpen);
      this.els.flDetailsBtn.setAttribute('aria-expanded', String(this.detailsOpen));
      if (this.detailsOpen) this.renderDetails();
    },

    renderDetails() {
      if (!this.detailsOpen || !this.current) return;
      const c = this.current;
      const plan = c.plan;
      const s = c.session;
      const project = App.byId(c.id);
      const root = this.els.flDetails;
      if (!plan) { root.innerHTML = `<section><h4>Preview plan</h4><p class="fl-muted">${c.state === 'loading' ? 'Resolving…' : 'No plan available.'}</p></section>`; return; }
      const ov = plan.overrides || {};
      const isFolder = plan.kind === 'folder';
      const candidates = plan.candidates.filter(x => !x.requiresBundler);
      const cmdValue = ov.commandLine || plan.suggestedCommandLine || (plan.launch ? `${plan.launch.command} ${plan.launch.args.join(' ')}` : '');
      const canManaged = isFolder && (plan.launchStatus === 'ok' || plan.launchStatus === 'ambiguous' || plan.launchStatus === 'setup-required' || ov.commandLine);
      root.innerHTML = `
        <section>
          <h4>Preview plan</h4>
          <dl>
            <dt>Mode</dt><dd>${esc(plan.mode)}${ov.mode ? ' (saved)' : ''}</dd>
            <dt>Project</dt><dd>${esc(plan.projectPath)}</dd>
            ${plan.servingRoot ? `<dt>Serving root</dt><dd>${esc(plan.servingRoot)}</dd>` : ''}
            ${plan.entryRelPath ? `<dt>Entry</dt><dd>${esc(plan.entryRelPath)}</dd>` : ''}
            ${plan.buildInfo ? `<dt>Build</dt><dd class="fl-orange">existing output, modified ${esc(fmtTime(plan.buildInfo.mtime))}</dd>` : ''}
            ${plan.launch ? `<dt>Command</dt><dd>${esc(plan.launch.command + ' ' + plan.launch.args.join(' '))}</dd><dt>Port via</dt><dd>${esc(plan.launch.portMode)}</dd>` : ''}
            ${plan.externalUrl ? `<dt>External</dt><dd>${esc(plan.externalUrl)}</dd>` : ''}
            <dt>Plan rev</dt><dd>${esc(plan.revision)}</dd>
            <dt>Project id</dt><dd>${esc(plan.id)}</dd>
          </dl>
          <h4 class="fl-gap">Why</h4>
          <ul class="why">${plan.explanation.map(x => `<li>${esc(x)}</li>`).join('')}${plan.launchReason && plan.mode !== 'managed' ? `<li class="fl-muted">Dev server: ${esc(plan.launchReason)}</li>` : ''}</ul>
        </section>
        ${isFolder ? `<section>
          <h4>Mode &amp; entry</h4>
          <div class="fl-row">
            <button class="fl-btn ${plan.mode === 'static' ? 'primary' : ''}" ${plan.staticAvailable || candidates.length ? '' : 'disabled'} onclick="Flipper.setMode('static')">Static files</button>
            <button class="fl-btn ${plan.mode === 'managed' ? 'primary' : ''}" ${canManaged ? '' : 'disabled'} onclick="Flipper.setMode('managed')">Dev server</button>
            ${ov.revision ? `<button class="fl-btn" onclick="Flipper.resetOverrides()" title="Forget saved choices for this project">Reset saved</button>` : ''}
          </div>
          ${candidates.length ? `<label>Static entry point</label><select id="flDetEntry" onchange="Flipper.chooseEntry(this.value)"><option value="" ${!plan.entryRelPath ? 'selected' : ''}>— auto —</option>${candidates.map(x => `<option value="${esc(x.relPath)}" ${x.relPath === plan.entryRelPath ? 'selected' : ''}>${esc(x.label)}${x.mtime && x.isBuild ? ' · ' + esc(fmtTime(x.mtime)) : ''}</option>`).join('')}</select>` : ''}
        </section>
        <section>
          <h4>Launch settings</h4>
          <label>Command (runs in the project folder; use {PORT} or PORT)</label>
          <input type="text" id="flDetCmd" value="${esc(cmdValue)}" placeholder="npm run dev"/>
          <label>Working directory (relative to project, optional)</label>
          <input type="text" id="flDetCwd" value="${esc(ov.commandCwd || '')}" placeholder="."/>
          <div class="fl-actions"><button class="fl-btn primary" onclick="Flipper.saveCommandAndLaunch()"><span class="material-symbols-rounded">play_arrow</span>Save &amp; launch</button></div>
          ${(plan.launchRequirements || []).length ? `<ul class="why fl-warn">${plan.launchRequirements.map(r => `<li>${esc(r)}</li>`).join('')}</ul>` : ''}
          <label>Or attach a server that is already running</label>
          <div class="fl-row"><input type="text" id="flDetExternal" value="${esc(ov.externalUrl || '')}" placeholder="http://localhost:5173/"/><button class="fl-btn" onclick="Flipper.attachExternal()">Attach</button></div>
        </section>` : ''}
        <section>
          <h4>Capture settings</h4>
          <label>Readiness selector (optional CSS selector to wait for)</label>
          <input type="text" id="flDetSelector" value="${esc(ov.readinessSelector || '')}" placeholder="#app canvas"/>
          <label>Extra settle time (ms)</label>
          <input type="number" id="flDetSettle" value="${ov.settleMs != null ? esc(ov.settleMs) : ''}" placeholder="2000"/>
          <div class="fl-actions"><button class="fl-btn" onclick="Flipper.saveCaptureSettings()">Save</button><button class="fl-btn" onclick="Captures.captureOne('${esc(c.id)}')"><span class="material-symbols-rounded">photo_camera</span>Capture now</button></div>
        </section>
        <section>
          <h4>Session</h4>
          ${s ? `<dl>
            <dt>State</dt><dd><span class="fl-badge state-${esc(s.state)}">${esc(s.state)}</span>${s.pinned ? ' 📌 pinned' : ''}</dd>
            ${s.url ? `<dt>URL</dt><dd><a class="fl-link" target="_blank" rel="noopener" href="${esc(s.url)}">${esc(s.url)}</a></dd>` : ''}
            ${s.port ? `<dt>Port</dt><dd>${esc(s.port)}</dd>` : ''}
            ${s.pid ? `<dt>PID</dt><dd>${esc(s.pid)}</dd>` : ''}
            ${s.httpStatus ? `<dt>HTTP</dt><dd>${esc(s.httpStatus)}</dd>` : ''}
            <dt>Consumers</dt><dd>${esc(s.consumers.join(', ') || '—')}</dd>
            <dt>Last used</dt><dd>${esc(fmtTime(s.lastUsedAt))}</dd>
            ${s.note ? `<dt>Note</dt><dd class="fl-orange fl-prose">${esc(s.note)}</dd>` : ''}
            ${s.error ? `<dt>Error</dt><dd class="fl-red fl-prose">${esc(s.error.message)}</dd>` : ''}
          </dl>
          ${s.mode === 'managed' && !s.external ? `<div class="fl-actions">
            <button class="fl-btn danger" onclick="Flipper.stopSession('${esc(s.id)}')"><span class="material-symbols-rounded">stop_circle</span>Stop</button>
            <button class="fl-btn" onclick="Flipper.restartSession('${esc(s.id)}')"><span class="material-symbols-rounded">restart_alt</span>Restart</button>
            <button class="fl-btn ${s.pinned ? 'primary' : ''}" onclick="Flipper.pinSession('${esc(s.id)}', ${!s.pinned})"><span class="material-symbols-rounded">push_pin</span>${s.pinned ? 'Unpin' : 'Pin'}</button>
          </div>` : ''}
          ${s.mode === 'managed' && !s.external ? `<h4 class="fl-gap">Log</h4><pre class="fl-log" id="flDetLog"></pre>` : ''}` : '<p class="fl-muted">No session.</p>'}
        </section>`;
      this.renderLog();
    },

    renderLog() {
      const el = $('flDetLog');
      if (!el || !this.current) return;
      const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 8;
      el.innerHTML = this.current.log.map(l => `<div class="${/error|failed|EADDRINUSE|cannot|exception/i.test(l) ? 'err' : ''}">${esc(l)}</div>`).join('');
      if (atBottom) el.scrollTop = el.scrollHeight;
    },
  };

  // ======================================================================
  // Captures (generated screenshots) and the contact sheet
  // ======================================================================
  const Captures = {
    index: {},
    queue: null,
    loaded: false,

    async load() {
      try {
        const d = await api.get('/api/captures');
        this.index = d.captures || {};
        this.queue = d.queue || null;
        this.loaded = true;
        this.patchThumbs();
        Sheet.refresh();
      } catch (err) { console.warn('captures unavailable', err); }
    },

    record(id) { return this.index[id] || null; },

    thumbFor(id) {
      const c = this.index[id];
      if (!c || !c.imagePath) return null;
      return { src: `/api/captures/${encodeURIComponent(id)}/image?v=${encodeURIComponent(c.capturedAt || '')}`, title: `${c.stale ? 'Stale capture' : 'Capture'} · ${fmtTime(c.capturedAt)}${c.verified ? '' : ' · unverified'}` };
    },

    onUpdate(data) {
      if (data.captures) Object.assign(this.index, data.captures);
      if (data.queue) this.queue = data.queue;
      if (data.captures) this.patchThumbs(Object.keys(data.captures));
      Sheet.refresh();
      if (App.currentProject && data.captures && data.captures[App.currentProject.id]) this.renderDetail(App.currentProject.id);
      if (data.event === 'item' && data.item && data.item.state === 'captured' && data.queue && data.queue.items.length === 1) toast(`Captured ${data.item.name}`);
      if (data.event === 'item' && data.item && data.item.state === 'failed' && data.queue && data.queue.items.length === 1) toast(`Capture failed: ${data.item.name} — ${data.item.error || ''}`, 5000);
    },

    patchThumbs(ids) {
      const items = ids ? ids.map(id => document.querySelector(`#projectList [data-project-id="${CSS.escape(id)}"]`)).filter(Boolean) : [...document.querySelectorAll('#projectList [data-project-id]')];
      for (const el of items) {
        const t = this.thumbFor(el.dataset.projectId);
        let img = el.querySelector('img.proj-thumb');
        if (t) {
          if (!img) { img = document.createElement('img'); img.className = 'proj-thumb'; img.loading = 'lazy'; img.alt = ''; el.prepend(img); }
          if (img.getAttribute('src') !== t.src) img.src = t.src;
          img.title = t.title;
        } else if (img) img.remove();
      }
    },

    renderDetail(id) {
      const box = $('detailCapture'); if (!box) return;
      const c = this.index[id];
      if (!c || !c.imagePath) { box.classList.add('hidden'); box.innerHTML = ''; return; }
      box.classList.remove('hidden');
      box.innerHTML = `<img src="/api/captures/${encodeURIComponent(id)}/image?v=${encodeURIComponent(c.capturedAt || '')}" class="capture-img" alt="Generated capture" onclick="Flipper.open('${esc(id)}')"/><div class="capture-meta"><span>Generated capture · ${esc(fmtTime(c.capturedAt))} · ${esc(c.mode)}</span><span>${c.stale ? '<span class="fl-orange">stale</span>' : 'current'}${c.verified ? '' : ' · <span class="fl-yellow">unverified</span>'}</span></div>`;
    },

    async captureOne(id) {
      try {
        const d = await api.post('/api/captures/run', { projectIds: [id] });
        this.queue = d.queue;
        toast(d.queued === 0 ? 'Capture is already queued or running.' : 'Capture queued.');
        Sheet.refresh();
      } catch (err) { toast('Capture failed to start: ' + err.message, 5000); }
    },

    async control(action) {
      try { const d = await api.post('/api/captures/' + action, {}); this.queue = d.queue; Sheet.refresh(); }
      catch (err) { toast(`${action} failed: ${err.message}`); }
    },
  };

  const Sheet = {
    visible: false,
    show() {
      const v = $('sheetView');
      v.classList.remove('hidden');
      this.visible = true;
      if (!Captures.loaded) Captures.load();
      this.refresh();
    },
    hide() { const v = $('sheetView'); v.classList.add('hidden'); this.visible = false; },
    toggle() { this.visible ? this.hide() : this.show(); },

    refresh() {
      if (!this.visible) return;
      this.renderToolbar();
      this.renderProgress();
      this.renderGrid();
    },

    selection() { return (App.lastFiltered && App.lastFiltered.length ? App.lastFiltered : App.data); },

    renderToolbar() {
      const q = Captures.queue;
      const running = q && (q.status === 'running' || q.status === 'paused');
      const failed = q ? q.items.filter(i => i.state === 'failed').length : 0;
      const sel = this.selection();
      $('sheetToolbar').innerHTML = `
        <span class="fl-hint">${sel.length} in current selection</span>
        <button class="fl-btn primary" id="sheetRunBtn" onclick="Sheet.runSelection()" ${running ? 'disabled' : ''}><span class="material-symbols-rounded">photo_camera</span>Capture selection</button>
        ${q && q.status === 'running' ? `<button class="fl-btn" onclick="Captures.control('pause')"><span class="material-symbols-rounded">pause</span>Pause</button>` : ''}
        ${q && q.status === 'paused' ? `<button class="fl-btn" onclick="Captures.control('resume')"><span class="material-symbols-rounded">play_arrow</span>Resume</button>` : ''}
        ${running ? `<button class="fl-btn danger" onclick="Captures.control('cancel')"><span class="material-symbols-rounded">cancel</span>Cancel</button>` : ''}
        ${!running && failed ? `<button class="fl-btn" onclick="Captures.control('retry')"><span class="material-symbols-rounded">replay</span>Retry ${failed} failed</button>` : ''}
        <span class="fl-hint fl-hint--small" title="Chromium via Playwright, 1440×1000, one capture at a time">${q ? esc(q.status) : 'idle'}</span>`;
      const runBtn = $('sheetRunBtn');
      if (runBtn) runBtn.className = 'fl-btn primary';
      // The sheet toolbar reuses the flipper button styling.
      $('sheetToolbar').querySelectorAll('.fl-btn').forEach(b => b.classList.add('fl-btn'));
    },

    renderProgress() {
      const q = Captures.queue;
      const wrap = $('sheetProgressWrap');
      if (!q || !q.items.length || q.status === 'idle') { wrap.classList.add('hidden'); return; }
      wrap.classList.remove('hidden');
      const counts = {};
      q.items.forEach(i => counts[i.state] = (counts[i.state] || 0) + 1);
      const done = q.items.filter(i => i.state !== 'queued' && i.state !== 'running').length;
      const cur = q.items.find(i => i.state === 'running');
      $('sheetProgressText').textContent = q.status === 'running' ? (cur ? `Capturing ${cur.name}…` : 'Working…') : q.status === 'paused' ? 'Paused — resumable' : q.status === 'canceled' ? 'Canceled' : 'Finished';
      $('sheetProgressCounts').textContent = Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(' · ') + ` · ${done}/${q.items.length}`;
      $('sheetProgressBar').style.width = `${Math.round(100 * done / q.items.length)}%`;
    },

    renderGrid() {
      const sel = this.selection();
      const q = Captures.queue;
      const qState = {};
      if (q) q.items.forEach(i => qState[i.projectId] = i);
      $('sheetBody').innerHTML = sel.length ? `<div class="sheet-grid">${sel.map(p => {
        const c = Captures.record(p.id);
        const qi = qState[p.id];
        const t = Captures.thumbFor(p.id);
        let badge = '';
        if (qi && (qi.state === 'running' || qi.state === 'queued')) badge = `<span class="fl-badge state-starting">${qi.state}</span>`;
        else if (qi && qi.state === 'failed') badge = `<span class="fl-badge state-failed" title="${esc(qi.error || '')}">failed</span>`;
        else if (c && c.stale) badge = '<span class="fl-badge build">stale</span>';
        else if (c && c.imagePath && !c.verified) badge = '<span class="fl-badge state-starting">unverified</span>';
        else if (c && c.imagePath) badge = '<span class="fl-badge state-ready">fresh</span>';
        return `<button class="sheet-card ${c && c.stale ? 'stale' : ''}" onclick="Flipper.open('${esc(p.id)}')" title="Open live preview">
          <div class="thumb">${t ? `<img loading="lazy" src="${t.src}" alt=""/>` : `<span class="material-symbols-rounded">${p.kind === 'file' ? 'description' : 'folder'}</span>`}${badge}</div>
          <div class="meta"><div class="name">${esc(p.name)}</div><div class="sub"><span>${c ? esc(fmtTime(c.capturedAt)) : 'not captured'}</span><span>${c ? esc(c.mode) : esc(p.type)}</span></div></div>
        </button>`;
      }).join('')}</div>` : '<div class="fl-muted">No projects in the current selection.</div>';
    },

    async runSelection() {
      const sel = this.selection();
      const ids = sel.map(p => p.id);
      let pre;
      try { pre = await api.post('/api/captures/preflight', { projectIds: ids }); }
      catch (err) { toast('Preflight failed: ' + err.message); return; }
      const modal = document.createElement('div');
      modal.className = 'fl-overlay translucent';
      modal.style.cssText = 'position:fixed;z-index:70';
      modal.innerHTML = `<div class="fl-card"><h3><span class="material-symbols-rounded fl-ico fl-ico--cyan">photo_camera</span>Capture ${ids.length} project${ids.length === 1 ? '' : 's'}</h3>
        <p>Scope: the current filtered selection, in its current order. Each capture opens a fresh browser context and records the initial page state; nothing is clicked.</p>
        <dl class="fl-facts">
          <dt>Static files</dt><dd>${pre.counts.static}</dd>
          <dt>Dev server (managed)</dt><dd>${pre.counts.managed}</dd>
          <dt>External servers</dt><dd>${pre.counts.external}</dd>
          <dt>Will be skipped (no preview)</dt><dd>${pre.counts.unavailable}</dd>
          <dt>Unchanged (reused)</dt><dd>${pre.counts.unchanged}</dd>
        </dl>
        <p class="fl-muted">Managed projects start their dev command inside qnav's session cap (${pre.maxManagedSessions}); pinned and in-use servers are never evicted by the worker.</p>
        <div class="fl-actions"><button class="fl-btn primary" id="capConfirm"><span class="material-symbols-rounded">play_arrow</span>Start</button><button class="fl-btn" id="capCancel">Cancel</button></div></div>`;
      document.body.appendChild(modal);
      modal.querySelector('#capCancel').onclick = () => modal.remove();
      modal.querySelector('#capConfirm').onclick = async () => {
        modal.remove();
        try { const d = await api.post('/api/captures/run', { projectIds: ids }); Captures.queue = d.queue; this.refresh(); toast(`Queued ${d.queued} capture${d.queued === 1 ? '' : 's'}.`); }
        catch (err) { toast('Could not start: ' + err.message, 5000); }
      };
    },
  };

  // ======================================================================
  // Explorer: every HTML file in the project as a launchable grid
  // ======================================================================
  const Explorer = {
    show(modal, projectId, plan, listing) {
      const files = listing.files || [];
      const devReady = plan.mode === 'managed' || plan.managedAvailable;
      const card = modal.querySelector('.fl-card');
      card.innerHTML = `
        <h3><span class="material-symbols-rounded fl-ico fl-ico--cyan">folder_open</span>Explore — ${esc(plan.name || projectId)}</h3>
        <p class="fl-muted">${esc(devReady
          ? 'How each file opens depends on the project: plain pages are served statically by qnav, files marked “needs dev server” open through the project’s dev server entry.'
          : 'Served statically by qnav from the project folder — no dev server involved.')}</p>
        <div class="ex-tools">
          <input type="search" id="exSearch" class="fl-input ex-search" placeholder="Filter files…" aria-label="Filter files"/>
          <span class="fl-hint mono" id="exCount"></span>
          <button class="fl-btn" id="exClose"><span class="material-symbols-rounded">close</span>Close</button>
        </div>
        ${listing.truncated ? '<p class="fl-warn fl-hint">Large project — showing the first 500 HTML files (up to 6 folders deep).</p>' : ''}
        ${files.length ? '<div class="ex-grid" id="exGrid"></div>' : '<p class="fl-muted">No HTML files found in this project.</p>'}`;
      modal.querySelector('#exClose').onclick = () => Flipper.closeExplorer();
      const grid = modal.querySelector('#exGrid');
      const search = modal.querySelector('#exSearch');
      modal.querySelector('#exCount').textContent = `0 / ${files.length}`;
      if (grid) {
        const state = { q: '' };
        const paint = () => {
          const q = state.q.toLowerCase();
          const shown = files.filter(f => !q || f.relPath.toLowerCase().includes(q));
          modal.querySelector('#exCount').textContent = `${shown.length} / ${files.length}`;
          grid.innerHTML = shown.map(f => this.tile(f, plan)).join('');
        };
        search.addEventListener('input', () => { state.q = search.value; paint(); });
        grid.addEventListener('click', (ev) => this.onGridClick(ev, projectId, plan));
        paint();
      }
      search.focus();
    },

    tile(f, plan) {
      const base = f.relPath.split('/').pop();
      const isCurrent = plan.entryRelPath === f.relPath;
      const badges = [
        isCurrent ? '<span class="fl-badge static">current</span>' : '',
        f.requiresBundler ? '<span class="fl-badge managed">needs dev server</span>' : '',
      ].join('');
      const canSave = plan.kind === 'folder' && !f.requiresBundler;
      return `<div class="ex-card" data-rel="${esc(f.relPath)}">
        <div class="ex-name" title="${esc(f.relPath)}">${esc(base)}</div>
        <div class="ex-rel mono">${esc(f.relPath)}${f.depth > 1 ? ` <span class="fl-muted">· ${f.depth} deep</span>` : ''}</div>
        <div class="ex-meta mono">${esc(fmtSize(f.size))} · ${esc(fmtTime(f.mtime))} ${badges}</div>
        <div class="ex-actions">
          <button class="fl-btn primary" data-ex-launch title="${esc(f.requiresBundler ? 'Open the project’s dev server entry' : 'Open this file in the flipper')}"><span class="material-symbols-rounded">play_arrow</span>${f.requiresBundler ? 'Dev server' : 'Launch'}</button>
          <button class="fl-btn" data-ex-tab title="Open in a new tab"><span class="material-symbols-rounded">open_in_new</span></button>
          ${canSave && !isCurrent ? `<button class="fl-btn" data-ex-save title="Remember as this project’s entry point"><span class="material-symbols-rounded">push_pin</span></button>` : ''}
        </div>
      </div>`;
    },

    async onGridClick(ev, projectId, plan) {
      const btn = ev.target.closest('[data-ex-launch],[data-ex-tab],[data-ex-save]');
      if (!btn) return;
      const card = btn.closest('.ex-card');
      const rel = card && card.dataset.rel;
      if (!rel) return;
      if (btn.hasAttribute('data-ex-save')) { Flipper.saveExplorerEntry(rel); return; }
      if (!btn.hasAttribute('data-ex-tab')) { Flipper.openFile(rel); return; }
      try {
        const result = await api.post('/api/preview/acquire', { projectId, consumerId, entryRelPath: rel });
        Sessions.track(result.session);
        window.open(result.session.url, '_blank', 'noopener');
        toast(plan.mode === result.plan.mode ? 'Opened in a new tab.' : `Opened in a new tab via ${result.plan.mode}.`);
      } catch (err) { toast('Could not open: ' + (err.plan ? (err.plan.reason || err.message) : err.message), 5000); }
    },
  };

  window.Flipper = Flipper;
  window.Captures = Captures;
  window.Sheet = Sheet;

  document.addEventListener('DOMContentLoaded', () => {
    Flipper.init();
    $('sheetViewToggle').addEventListener('click', () => Sheet.toggle());
    $('closeSheetBtn').addEventListener('click', () => Sheet.hide());
    Captures.load();
  });
})();
