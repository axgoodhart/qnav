(function (root) {
    const generic = new Set(['html', 'css', 'javascript', 'typescript', 'web', 'canvas', 'svg', 'animations', 'responsive', 'dark-mode']);
    const normalize = value => String(value).toLowerCase().trim().replace(/[\s_]+/g, '-');
    const tags = p => (p.profile?.tags || []).filter(t => t.confidence === 'supported');
    function compare(a, b) {
        const reasons = [];
        let score = 0;
        if (a.path !== b.path && (a.path.startsWith(b.path + '/') || b.path.startsWith(a.path + '/'))) {
            reasons.push('One project contains the other');
            score = 1;
        }
        if (a.family && a.family === b.family) {
            reasons.push('Likely variants in the same project family');
            score += 0.65;
        }
        const other = new Set(tags(b).map(t => `${t.category}:${normalize(t.label)}`));
        const shared = tags(a).filter(t => !generic.has(normalize(t.label)) && other.has(`${t.category}:${normalize(t.label)}`));
        const weights = { purpose: 0.16, domain: 0.08, features: 0.22, uiParadigm: 0.12, dataHandling: 0.18, deploymentTarget: 0.04 };
        const labels = new Set();
        for (const t of shared) {
            if (labels.has(normalize(t.label))) continue;
            labels.add(normalize(t.label));
            score += weights[t.category] || 0.08;
            reasons.push(`Both: ${t.label.replace(/-/g, ' ')}`);
        }
        const sharedTech = (a.tech || []).filter(t => (b.tech || []).some(u => normalize(t) === normalize(u)));
        return { score: Math.min(1, score), reasons, sharedTech, shared };
    }
    function featured(p) {
        if (!p.profile || p.profileState === 'stale') return { score: 0, reasons: ['Waiting for current source analysis'] };
        if (['collection', 'library', 'unknown'].includes(p.profile.kind)) return { score: 0, reasons: [`${p.profile.kind}: kept outside the app discovery selection`] };
        const supported = tags(p);
        const capabilities = new Set(supported.filter(t => t.category === 'features').map(t => normalize(t.label)));
        const reasons = [`${capabilities.size} capabilities supported by source`, `${p.profile.kind} identified from source`];
        const purpose = supported.some(t => t.category === 'purpose');
        if (!purpose || capabilities.size === 0) return { score: 0, reasons: ['Not enough supported purpose and capability evidence yet'] };
        return { score: 2 + Math.min(6, capabilities.size) + (p.profile.apps.length ? 1 : 0), reasons };
    }
    const api = { compare, featured, normalize };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.Meaning = api;
})(typeof window !== 'undefined' ? window : globalThis);
