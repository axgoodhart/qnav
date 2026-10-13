const Profiles = {
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
            const revision = JSON.stringify([Object.entries(data.profiles || {}).map(([key, p]) => [key, p.fingerprint, p.analyzedAt]), data.enabled, data.active, data.queued, data.error]);
            if (revision === this.revision) return;
            this.revision = revision;
            this.status = data;
            this.saved = data.profiles || {};
            this.extra = data.projects || [];
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
        status.textContent = s.error || (this.staticSnapshot ? 'Saved source readings below. Restart qnav to continue automatic library analysis.' :
            s.active ? `Reading ${s.active} · ${ready} projects understood · ${s.queued} waiting` :
            s.enabled ? `${ready} projects understood${s.queued ? ` · ${s.queued} waiting` : ' · source changes are monitored'}` : `Analysis paused · ${ready} saved profiles available`);
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
                const recentA = day - (history[a.id] ?? -100000) < 14;
                const recentB = day - (history[b.id] ?? -100000) < 14;
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
        const visible = candidates.filter(c => `${c.p.name} ${c.p.profile?.summary || ''} ${c.reasons.join(' ')}`.toLowerCase().includes(query)).slice(0, 50);
        document.getElementById('profileCandidates').innerHTML = visible.length ? visible.map(c => {
            const seen = history[c.p.id];
            const decision = !c.score ? 'Outside selection' : seen === day ? 'Featured today' : day - (seen ?? -100000) < 14 ? `Cooldown · ${day - seen} days since shown` : 'Eligible';
            return `<tr><td><button class="link-btn" data-profile-open="${this.escape(c.p.id)}">${this.escape(c.p.name)}</button></td><td>${c.reasons.map(r => this.escape(r)).join(' · ')}</td><td>${decision}</td></tr>`;
        }).join('') : '<tr><td colspan="3">No candidates match this search.</td></tr>';
    }
};
