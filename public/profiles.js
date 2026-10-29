const Profiles = {
    cooldownDays: 14,
    saved: {}, status: {}, staticSnapshot: false, initialized: false, pair: [],
    escape(value) { return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); },
    replaceContent(target, html) {
        const open = new Set([...target.querySelectorAll('details[open][data-key]')].map(d => d.dataset.key));
        const focused = target.contains(document.activeElement) ? document.activeElement.id : null;
        target.innerHTML = html;
        for (const detail of target.querySelectorAll('details[data-key]')) detail.open = open.has(detail.dataset.key);
        if (focused) document.getElementById(focused)?.focus({ preventScroll: true });
    },
    init() {
        if (this.initialized) return;
        this.initialized = true;
        document.getElementById('profileControl').addEventListener('click', () => this.control());
        document.getElementById('candidateSearch').addEventListener('input', () => this.renderCandidates());
        document.getElementById('profileSaveSettings').addEventListener('click', () => this.saveSettings());
        document.getElementById('readingSearch').addEventListener('input', () => this.renderReadings());
        document.getElementById('readingFilter').addEventListener('change', () => this.renderReadings());
        document.getElementById('profileReadingsWrap').addEventListener('toggle', (event) => { if (event.target.open) this.loadReadings(); });
        document.getElementById('profileReadings').addEventListener('click', (event) => {
            const button = event.target.closest('[data-profile-analyze]');
            if (button) this.analyze(button.dataset.profileAnalyze);
        });
        document.getElementById('profileCompare').addEventListener('change', event => {
            if (!event.target.matches('select')) return;
            this.pair[Number(event.target.dataset.side)] = event.target.value;
            this.pairSelected = true;
            this.renderCompare();
        });
        document.addEventListener('click', event => {
            const button = event.target.closest('[data-profile-open]');
            if (button) App.openById(button.dataset.profileOpen);
        });
        void this.refresh();
        setInterval(() => this.refresh(), 12000);
    },
    enrich(projects) {
        const merged = [...projects];
        for (const p of this.extra || []) if (!merged.some(item => item.path === p.path)) merged.push(p);
        return merged.map(p => {
            const saved = this.saved[p.path];
            const profile = saved && (!p.profile || saved.analyzedAt > p.profile.analyzedAt) ? saved : p.profile;
            if (!profile) return p;
            const semantic = {};
            for (const tag of profile.tags) (semantic[tag.category] ||= []).push(tag.label);
            return { ...p, profile, profileState: p.profileState || 'ready', desc: profile.summary, semanticTags: { ...p.semanticTags, purpose: [], domain: [], features: [], uiParadigm: [], deploymentTarget: [], dataHandling: [], ...semantic } };
        });
    },
    async refresh() {
        try {
            let response = await fetch('/api/profiles', { cache: 'no-store' });
            this.staticSnapshot = response.status === 404;
            if (this.staticSnapshot) response = await fetch('/profile-snapshot.json', { cache: 'no-store' });
            if (!response.ok) throw new Error('Source reader is being installed. Profiles will appear here when available.');
            const data = await response.json();
            const revision = JSON.stringify([Object.entries(data.profiles || {}).map(([key, p]) => [key, p.fingerprint, p.analyzedAt]), data.enabled, data.active, data.queued, data.error, data.settings]);
            if (revision === this.revision) return;
            this.revision = revision;
            this.status = data;
            this.saved = data.profiles || {};
            this.extra = data.projects || [];
            this.renderSettings();
            if (document.getElementById('profileReadingsWrap').open) void this.loadReadings();
            App.updateData(App.data);
            if (App.currentProject) {
                const current = App.data.find(p => p.id === App.currentProject.id);
                if (current) { App.currentProject = current; document.getElementById('detailPurpose').textContent = current.desc; this.renderDetail(current); App.renderRelatedProjects(current); }
            }
        } catch (error) {
            this.status = { error: error.message, enabled: false };
            this.render();
        }
    },
    async control() {
        const button = document.getElementById('profileControl');
        button.disabled = true;
        try {
            const response = await fetch('/api/profiles/control', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: !!this.status.error || !this.status.enabled }) });
            if (!response.ok) throw new Error('Restart qnav to activate the automatic background reader. Saved source profiles are available below.');
            this.status = await response.json();
        } catch (error) { this.status.error = error.message; }
        button.disabled = false;
        this.render();
    },
    render() {
        const s = this.status;
        const status = document.getElementById('profileStatus');
        if (!status) return;
        const ready = App.data.filter(p => p.profile).length;
        const manual = s.settings && s.settings.mode === 'manual';
        const capped = s.rateLimitedUntil && s.rateLimitedUntil > Date.now() ? ` · hourly cap until ${new Date(s.rateLimitedUntil).toLocaleTimeString()}` : '';
        status.textContent = s.error || (this.staticSnapshot ? 'Saved source readings below. Restart qnav to continue automatic library analysis.' :
            s.active ? `Reading ${s.active} · ${ready} projects understood · ${s.queued} waiting${capped}` :
            !s.enabled ? `Analysis paused · ${ready} saved profiles available` :
            manual ? `Manual mode · ${ready} projects understood${s.queued ? ` · ${s.queued} picked` : ''}${capped}` :
            `${ready} projects understood${s.queued ? ` · ${s.queued} waiting` : ' · source changes are monitored'}${capped}`);
        status.dataset.error = s.error ? 'true' : 'false';
        const button = document.getElementById('profileControl');
        button.textContent = s.error ? 'Retry analysis' : s.enabled ? 'Pause analysis' : 'Resume analysis';
        button.hidden = this.staticSnapshot;
        this.renderCompare();
        this.renderCandidates();
        if (!this.shown && ready >= 2 && new URLSearchParams(location.search).has('understanding')) {
            this.shown = true;
            document.getElementById('meaningHeading').scrollIntoView({ block: 'start' });
        }
    },
    renderSettings() {
        const s = (this.status && this.status.settings) || {};
        const wrap = document.getElementById('profileSettingsWrap');
        if (!wrap || wrap.contains(document.activeElement)) return;
        const mode = s.mode || 'auto';
        for (const radio of wrap.querySelectorAll('input[name="profileMode"]')) radio.checked = radio.value === mode;
        document.getElementById('profileMaxPerHour').value = s.maxCallsPerHour ?? 0;
        document.getElementById('profileGapSec').value = Math.round((s.minGapMs ?? 2000) / 1000);
        document.getElementById('profileMaxKB').value = Math.round((s.maxBytes ?? 85000) / 1024);
        document.getElementById('profileMaxFiles').value = s.maxFiles ?? 24;
        document.getElementById('profileIgnoreExt').value = (s.ignoreExtensions || []).join(', ');
        document.getElementById('profileIgnorePaths').value = (s.ignorePaths || []).join('\n');
    },
    async saveSettings() {
        const note = document.getElementById('profileSettingsNote');
        const mode = document.querySelector('input[name="profileMode"]:checked');
        const list = (value) => value.split(',').map(v => v.trim()).filter(Boolean);
        const lines = (value) => value.split('\n').map(v => v.trim()).filter(Boolean);
        const body = {
            mode: mode ? mode.value : 'auto',
            maxCallsPerHour: Number(document.getElementById('profileMaxPerHour').value || 0),
            minGapMs: Number(document.getElementById('profileGapSec').value || 0) * 1000,
            maxBytes: Math.round(Number(document.getElementById('profileMaxKB').value || 85) * 1024),
            maxFiles: Number(document.getElementById('profileMaxFiles').value || 24),
            ignoreExtensions: list(document.getElementById('profileIgnoreExt').value),
            ignorePaths: lines(document.getElementById('profileIgnorePaths').value),
        };
        try {
            const response = await fetch('/api/profiles/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
            if (!response.ok) throw new Error('Settings were not saved.');
            this.status.settings = (await response.json()).settings;
            this.renderSettings();
            this.render();
            note.textContent = 'Saved.';
        } catch (error) { note.textContent = error.message; }
        setTimeout(() => { note.textContent = ''; }, 4000);
    },
    async loadReadings() {
        try {
            const response = await fetch('/api/profiles/readings', { cache: 'no-store' });
            if (!response.ok) throw new Error('Readings are unavailable.');
            this.readings = (await response.json()).readings || [];
        } catch (error) { this.readings = []; this.readingsError = error.message; }
        this.renderReadings();
    },
    renderReadings() {
        const body = document.getElementById('profileReadings');
        if (!body || !document.getElementById('profileReadingsWrap').open) return;
        const query = document.getElementById('readingSearch').value.toLowerCase();
        const filter = document.getElementById('readingFilter').value;
        const rows = (this.readings || []).map(r => ({ ...r, display: r.state === 'error' ? 'error' : r.state === 'checking' ? 'queued' : r.state }));
        const visible = rows.filter(r => (!filter || r.display === filter) && r.name.toLowerCase().includes(query));
        const kb = (bytes) => bytes == null ? '—' : `${(bytes / 1024).toFixed(1)} KB`;
        document.getElementById('profileReadingsCount').textContent = `${visible.length} of ${rows.length} projects`;
        body.innerHTML = visible.length ? visible.map(r => {
            const sent = r.display === 'ready' ? `${kb(r.bytesSent)}${r.truncated ? ' · sampled' : ''} · ${r.filesRead} files` : '—';
            const state = r.display === 'ready' ? `Read ${r.analyzedAt ? new Date(r.analyzedAt).toLocaleDateString() : ''}` :
                r.display === 'reading' ? 'Reading…' : r.display === 'queued' ? 'Queued' :
                r.display === 'unread' ? 'Unread' : `Failed${r.error ? `: ${this.escape(r.error)}` : ''}`;
            return `<tr><td><button class="link-btn" data-profile-open="${this.escape(r.id)}">${this.escape(r.name)}</button></td><td title="${this.escape(r.error || '')}">${state}</td><td>${this.escape(sent)}</td><td>${r.display === 'reading' ? '' : `<button class="link-btn" data-profile-analyze="${this.escape(r.id)}">Analyze</button>`}</td></tr>`;
        }).join('') : `<tr><td colspan="4">${this.escape(this.readingsError || 'No projects match.')}</td></tr>`;
    },
    async analyze(id) {
        try {
            const response = await fetch('/api/profiles/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
            if (!response.ok) throw new Error('The reading was not queued.');
            this.status = await response.json();
            this.loadReadings();
            this.render();
        } catch (error) { this.status.error = error.message; this.render(); }
    },
    profileHTML(p) {
        if (!p?.profile) return `<p class="meaning-empty">${this.escape(p?.profileError || (this.staticSnapshot ? 'Waiting for the automatic background reader to start.' : 'Queued for automatic source reading. Opening this project moves it forward in the queue.'))}</p>`;
        const profile = p.profile;
        const esc = value => this.escape(value);
        const groups = [...new Set(profile.tags.map(t => t.category))];
        const headings = { purpose: 'Purpose', domain: 'Domain', features: 'Capabilities', uiParadigm: 'Interaction', deploymentTarget: 'Runs on', dataHandling: 'Data' };
        return `<p class="meaning-summary">${esc(profile.summary)}</p>
            <div class="meaning-kind">${esc(profile.kind)} · read ${new Date(profile.analyzedAt).toLocaleDateString()}</div>
            ${profile.apps.length ? `<details class="meaning-apps" data-key="${esc(p.id)}:apps"><summary>Apps found inside</summary>${profile.apps.map(a => `<div><strong>${esc(a.name)}</strong><code>${esc(a.root)}</code><p>${esc(a.summary)}</p></div>`).join('')}</details>` : ''}
            <div class="meaning-tag-groups">${groups.map(group => `<div class="meaning-tag-group"><h4>${headings[group] || esc(group)}</h4><div class="meaning-tags">${profile.tags.filter(t => t.category === group).map(t => `<details class="meaning-tag" data-key="${esc(p.id + ':' + t.category + ':' + t.label)}" data-confidence="${t.confidence}"><summary>${esc(t.label.replace(/-/g, ' '))}${t.confidence === 'inferred' ? '<span>inferred</span>' : ''}</summary><div class="meaning-evidence">${t.evidence.map(e => `<div><code>${esc(e.file)}:${e.line}</code><pre>${esc(e.quote)}</pre></div>`).join('')}</div></details>`).join('')}</div></div>`).join('')}</div>
            <details class="meaning-files" data-key="${esc(p.id)}:files"><summary>Sources read${profile.truncated ? ' · sampled' : ''}</summary><p>${profile.truncated ? 'This profile uses a bounded sample. Unread functionality may be missing.' : 'Profile derived from the following source files.'}</p><ul>${profile.filesRead.map(f => `<li><code>${esc(f)}</code></li>`).join('')}</ul></details>`;
    },
    renderCompare() {
        const container = document.getElementById('profileCompare');
        if (!container || !App.data.length) return;
        const choices = [...App.data].sort((a, b) => Number(!!b.profile) - Number(!!a.profile) || a.name.localeCompare(b.name));
        if (!this.pairSelected && choices.filter(p => p.profile).length >= 2 && this.pair.some(id => !choices.find(p => p.id === id)?.profile)) this.pair = choices.slice(0, 2).map(p => p.id);
        this.pair = [0, 1].map(side => choices.some(p => p.id === this.pair[side]) ? this.pair[side] : choices[Math.min(side, choices.length - 1)].id);
        this.replaceContent(container, this.pair.map((id, side) => {
            const p = App.data.find(p => p.id === id);
            return `<article class="meaning-project"><div class="meaning-picker"><label for="meaningProject${side}">Compare project</label><select id="meaningProject${side}" data-side="${side}">${choices.map(c => `<option value="${this.escape(c.id)}" ${c.id === id ? 'selected' : ''}>${this.escape(c.name)}${c.kind === 'file' ? ' · ' + this.escape(c.path.split('/').pop()) : ''}${c.profile ? '' : ' · queued'}</option>`).join('')}</select><button class="link-btn" data-profile-open="${this.escape(id)}">Open project</button></div>${this.profileHTML(p)}</article>`;
        }).join(''));
        const a = App.data.find(p => p.id === this.pair[0]);
        const b = App.data.find(p => p.id === this.pair[1]);
        const connection = document.getElementById('profileConnection');
        const relation = Meaning.compare(a, b);
        connection.innerHTML = `<h3>Connection between these projects</h3><p>${a.id === b.id ? 'Choose two different projects to compare.' : relation.reasons.length ? relation.reasons.map(r => this.escape(r)).join(' · ') : a.profile && b.profile ? 'No specific shared capability or project relationship is supported by these readings.' : 'Waiting for both source profiles.'}</p>${relation.sharedTech.length ? `<small>Also share ${relation.sharedTech.map(t => this.escape(t)).join(', ')}. Technology alone does not create a connection.</small>` : ''}`;
    },
    renderDetail(p) {
        const target = document.getElementById('detailProfile');
        this.replaceContent(target, `<h2 class="heading">Source evidence</h2>${this.profileHTML(p)}`);
        if (!p.profile && !this.staticSnapshot) fetch('/api/profiles/prioritize', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: p.id }) }).catch(() => {});
    },
    history() { try { return JSON.parse(localStorage.getItem('qnav.featured.history') || '{}'); } catch { return {}; } },
    featuredCandidates() {
        return App.data.filter(p => Meaning.featured(p).score > 0);
    },
    selectFeatured(scored) {
        const day = Math.floor(Date.now() / 86400000);
        const history = this.history();
        const eligible = scored.map(s => s.p);
        const chosen = eligible.filter(p => history[p.id] === day).slice(0, 3);
        const remaining = eligible.filter(p => !chosen.includes(p));
        while (chosen.length < 3 && remaining.length) {
            const duplicate = remaining.findIndex(p => chosen.some(other => p.family && p.family === other.family));
            if (duplicate >= 0) { remaining.splice(duplicate, 1); continue; }
            remaining.sort((a, b) => {
                const recentA = day - (history[a.id] ?? -100000) < this.cooldownDays;
                const recentB = day - (history[b.id] ?? -100000) < this.cooldownDays;
                if (recentA !== recentB) return Number(recentA) - Number(recentB);
                if (recentA && history[a.id] !== history[b.id]) return history[a.id] - history[b.id];
                const rank = p => Meaning.featured(p).score - chosen.reduce((n, selected) => n + Meaning.compare(p, selected).score * 4 + Number(p.profile.kind === selected.profile.kind), 0);
                return rank(b) - rank(a) || a.id.localeCompare(b.id);
            });
            chosen.push(remaining.shift());
        }
        return chosen;
    },
    recordFeatured(projects) {
        const history = this.history();
        const day = Math.floor(Date.now() / 86400000);
        for (const p of projects) history[p.id] = day;
        try { localStorage.setItem('qnav.featured.history', JSON.stringify(history)); } catch {}
    },
    renderCandidates() {
        const query = document.getElementById('candidateSearch')?.value.toLowerCase() || '';
        const history = this.history();
        const day = Math.floor(Date.now() / 86400000);
        const candidates = App.data.map(p => ({ p, ...Meaning.featured(p) })).sort((a, b) => b.score - a.score || a.p.name.localeCompare(b.p.name));
        const visible = candidates.filter(c => `${c.p.name} ${c.p.profile?.summary || ''} ${c.reasons.join(' ')}`.toLowerCase().includes(query));
        document.getElementById('profileCandidates').innerHTML = visible.length ? visible.map(c => {
            const seen = history[c.p.id];
            const decision = !c.score ? 'Outside selection' : seen === day ? 'Featured today' : day - (seen ?? -100000) < this.cooldownDays ? `Cooldown · ${day - seen} days since shown` : 'Eligible';
            return `<tr><td><button class="link-btn" data-profile-open="${this.escape(c.p.id)}">${this.escape(c.p.name)}</button></td><td>${c.reasons.map(r => this.escape(r)).join(' · ')}</td><td>${decision}</td></tr>`;
        }).join('') : '<tr><td colspan="3">No candidates match this search.</td></tr>';
    }
};
