/* EverNodes — Knowledge Map */

const STORAGE_KEY = 'evernodes_v3';

// ─── State ───────────────────────────────────────────────────
let network        = null;
let currentData    = null;
let currentGoal    = '';
let learnedNodes   = new Set();
let selectedLevel  = 'beginner';
let selectedNodeId = null;
let currentScale   = 1.0;
let autoSaveOn     = true;
let autoSaveTimer  = null;
let defaultPositions = {};  // positions right after first stabilisation
let userPositions    = {};  // positions before a reset (for undo)
let hasUndoState     = false;

// Portal
let explorerList  = [];
let explorerIndex = 0;

// ═══════════════════════════════════════════════════════════
// NODE VISUAL CONFIG — category colours (gold/cyan/green)
// ═══════════════════════════════════════════════════════════
const NODE_CFG = {
    root:    { bg: '#1a1200', border: '#f0c060', glow: 'rgba(240,192,96,',  fontSize: 14, maxW: 190, radius: 10 },
    concept: { bg: '#001e24', border: '#40d8e8', glow: 'rgba(64,216,232,',  fontSize: 13, maxW: 165, radius: 8  },
    detail:  { bg: '#001a0e', border: '#4ade80', glow: 'rgba(74,222,128,',  fontSize: 12, maxW: 145, radius: 7  },
    deep:    { bg: '#0e0018', border: '#a78bfa', glow: 'rgba(167,139,250,', fontSize: 11, maxW: 130, radius: 6  },
};
const LEARNED_CFG = { bg: '#e8f4ff', border: '#ffffff', glow: 'rgba(255,255,255,', fontSize: 13, maxW: 165, radius: 8 };

// ─── Build one vis.js node ───────────────────────────────────
// shape:'box' is the only vis.js shape that renders text INSIDE the node boundary.
// widthConstraint caps the box width; text wraps or we abbreviate at low zoom.
function buildVisNode(node) {
    const isLearned = learnedNodes.has(node.id);
    const cat = node.category || 'concept';
    const cfg = isLearned ? LEARNED_CFG : (NODE_CFG[cat] || NODE_CFG.concept);

    const tooltip = `<div style="
        max-width:230px;padding:10px 13px;
        font-family:'DM Sans',sans-serif;font-size:13px;
        color:#dce4f0;line-height:1.6;
        word-wrap:break-word;overflow-wrap:break-word;
        white-space:normal;overflow:hidden;">
        <strong style="display:block;font-family:'Syne',sans-serif;
            color:${cfg.border};margin-bottom:5px;">${node.label}</strong>
        ${node.description}
    </div>`;

    return {
        id:    node.id,
        label: abbreviateLabel(node.label, currentScale),
        title: tooltip,
        shape: 'box',
        shapeProperties: { borderRadius: cfg.radius },
        widthConstraint: { minimum: 60, maximum: cfg.maxW },
        margin: { top: 9, right: 13, bottom: 9, left: 13 },
        color: {
            background: cfg.bg,
            border:     cfg.border,
            highlight:  { background: cfg.bg, border: '#ffffff' },
            hover:      { background: cfg.bg, border: '#ffffff' },
        },
        font: {
            color:       isLearned ? '#050f1a' : cfg.border,
            size:        cfg.fontSize,
            face:        'JetBrains Mono',
            strokeWidth: 4,
            strokeColor: isLearned ? 'rgba(255,255,255,0)' : 'rgba(0,0,0,0.96)',
            multi:       false,
        },
        borderWidth:         isLearned ? 3 : 2,
        borderWidthSelected: isLearned ? 4 : 3,
        shadow: {
            enabled: true,
            color:   cfg.glow + (isLearned ? '0.55)' : '0.45)'),
            size:    isLearned ? 18 : (cat === 'root' ? 16 : cat === 'concept' ? 11 : 7),
            x: 2, y: 2,
        },
    };
}

// ─── Zoom-aware label abbreviation ──────────────────────────
// At normal zoom the full label shows inside the box.
// Zooming out progressively shortens it so boxes stay readable.
function abbreviateLabel(label, scale) {
    const t = label.trim();
    if (scale >= 0.55) return t;                    // full label

    if (scale >= 0.35) {                            // first ~12 chars of words
        const words = t.split(/\s+/);
        let out = '';
        for (const w of words) {
            const next = out ? out + ' ' + w : w;
            if (next.length <= 12) out = next; else break;
        }
        return out || t.slice(0, 11) + '…';
    }

    // Very zoomed out — initials only
    const ws = t.split(/\s+/);
    return ws.length > 1
        ? ws.map(w => w[0].toUpperCase()).join('')
        : (t.length > 4 ? t.slice(0, 3) + '.' : t);
}

function refreshAllLabels() {
    if (!network || !currentData) return;
    network.body.data.nodes.update(
        currentData.nodes.map(n => ({ id: n.id, label: abbreviateLabel(n.label, currentScale) }))
    );
}

// ═══════════════════════════════════════════════════════════
// STARFIELD
// ═══════════════════════════════════════════════════════════
function initStarfield() {
    const canvas = document.getElementById('starfield-canvas');
    const ctx    = canvas.getContext('2d');
    function resize() { canvas.width = window.innerWidth; canvas.height = window.innerHeight; }
    resize();
    window.addEventListener('resize', resize);

    // Each star has its own RANDOM fade lifecycle:
    //   dormant  → slowly fading IN  → hold at peak → slowly fading OUT → dormant
    // Duration and timing are randomised per star so they never pulse in sync.
    function makeStarState() {
        // States: 0=dormant, 1=fade-in, 2=hold, 3=fade-out
        const dormantMs  = 3000 + Math.random() * 14000;  // 3-17s dark
        const fadeInMs   = 800  + Math.random() * 2400;
        const holdMs     = 400  + Math.random() * 2200;
        const fadeOutMs  = 1000 + Math.random() * 3000;
        return { dormantMs, fadeInMs, holdMs, fadeOutMs,
                 state: 0, elapsed: Math.random() * dormantMs }; // stagger initial phase
    }
    const roll = () => Math.random();
    const stars = Array.from({ length: 300 }, () => {
        const r = roll();
        const color = r > 0.80 ? 'rgba(240,192,96,' : r > 0.55 ? 'rgba(160,210,255,' : 'rgba(220,235,255,';
        const bright = roll() > 0.84;
        return {
            x: roll(), y: roll(),
            baseR: 0.3 + roll() * (bright ? 1.6 : 1.0),
            bright,
            color,
            alpha: 0,
            ...makeStarState(),
        };
    });

    const nebulae = [
        { x: 0.15, y: 0.25, r: 0.42, c: 'rgba(240,192,96,0.016)' },
        { x: 0.78, y: 0.62, r: 0.38, c: 'rgba(64,216,232,0.018)' },
        { x: 0.52, y: 0.80, r: 0.30, c: 'rgba(74,222,128,0.014)' },
    ];

    let last = 0;
    function draw(ts) {
        requestAnimationFrame(draw);
        const dtMs = Math.min(ts - last, 80);   // cap delta so tab-blur doesn't skip ahead
        last = ts;

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        nebulae.forEach(n => {
            const g = ctx.createRadialGradient(
                n.x * canvas.width, n.y * canvas.height, 0,
                n.x * canvas.width, n.y * canvas.height,
                Math.max(canvas.width, canvas.height) * n.r
            );
            g.addColorStop(0, n.c); g.addColorStop(1, 'transparent');
            ctx.fillStyle = g; ctx.fillRect(0, 0, canvas.width, canvas.height);
        });

        stars.forEach(s => {
            s.elapsed += dtMs;
            // Advance through lifecycle
            if (s.state === 0 && s.elapsed >= s.dormantMs) {
                s.state = 1; s.elapsed = 0; s.alpha = 0;
            } else if (s.state === 1) {
                s.alpha = Math.min(1, s.elapsed / s.fadeInMs);
                if (s.elapsed >= s.fadeInMs) { s.state = 2; s.elapsed = 0; }
            } else if (s.state === 2) {
                if (s.elapsed >= s.holdMs) { s.state = 3; s.elapsed = 0; }
            } else if (s.state === 3) {
                s.alpha = Math.max(0, 1 - s.elapsed / s.fadeOutMs);
                if (s.elapsed >= s.fadeOutMs) {
                    s.state = 0; s.elapsed = 0; s.alpha = 0;
                    // Randomise next cycle so stars don't sync up over time
                    Object.assign(s, makeStarState());
                }
            }

            if (s.alpha <= 0.01) return;

            const peakAlpha = s.bright ? 0.95 : 0.65;
            const a      = s.alpha * peakAlpha;
            const cx     = s.x * canvas.width;
            const cy     = s.y * canvas.height;

            if (s.bright && a > 0.3) {
                const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, s.baseR * 7);
                glow.addColorStop(0, s.color + (a * 0.22).toFixed(3) + ')');
                glow.addColorStop(1, 'transparent');
                ctx.fillStyle = glow;
                ctx.beginPath(); ctx.arc(cx, cy, s.baseR * 7, 0, Math.PI * 2); ctx.fill();
            }

            ctx.beginPath();
            ctx.arc(cx, cy, Math.max(0.1, s.baseR), 0, Math.PI * 2);
            ctx.fillStyle = s.color + a.toFixed(3) + ')';
            ctx.fill();
        });
    }
    requestAnimationFrame(draw);
}

// ═══════════════════════════════════════════════════════════
// SAVE / LOAD — includes node positions
// ═══════════════════════════════════════════════════════════
function getSavedMaps() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); } catch { return {}; }
}
function putSavedMaps(m) { localStorage.setItem(STORAGE_KEY, JSON.stringify(m)); }

function getCurrentPositions() {
    if (!network || !currentData) return {};
    return network.getPositions(currentData.nodes.map(n => n.id));
}

function saveCurrentMap(isAuto = false) {
    if (!currentData || !currentGoal) return;
    const maps = getSavedMaps();
    const key  = currentGoal.toLowerCase().trim();
    maps[key]  = {
        goal:      currentGoal,
        level:     selectedLevel,
        data:      currentData,
        learned:   Array.from(learnedNodes),
        positions: getCurrentPositions(),   // ← captures rearrangements
        savedAt:   Date.now(),
    };
    putSavedMaps(maps);
    renderSavedList();
    if (!isAuto) {
        const btn = document.getElementById('save-btn');
        const orig = btn.textContent;
        btn.textContent = '✦ Saved!';
        btn.style.color = 'var(--gold)';
        setTimeout(() => { btn.textContent = orig; btn.style.color = ''; }, 1800);
    }
}

// ─── Reset Structure helpers ─────────────────────────────────
function applyPositions(posMap) {
    if (!network || !currentData || !Object.keys(posMap).length) return;
    const updates = currentData.nodes.map(n => {
        const p = posMap[n.id];
        return p ? { id: n.id, x: p.x, y: p.y } : null;
    }).filter(Boolean);
    network.body.data.nodes.update(updates);
}

function updateResetBtn() {
    const btn = document.getElementById('reset-structure-btn');
    if (!btn) return;
    if (hasUndoState) {
        btn.textContent = '↩ Undo Reset';
        btn.classList.add('has-undo');
        btn.title = 'Go back to your custom arrangement';
    } else {
        btn.textContent = '↺ Reset Structure';
        btn.classList.remove('has-undo');
        btn.title = 'Snap nodes back to original layout';
    }
}

function scheduleAutoSave() {
    if (!autoSaveOn) return;
    clearTimeout(autoSaveTimer);
    autoSaveTimer = setTimeout(() => saveCurrentMap(true), 5000);
}

document.getElementById('autosave-toggle').addEventListener('change', e => {
    autoSaveOn = e.target.checked;
});

function deleteSavedMap(key) {
    const m = getSavedMaps(); delete m[key]; putSavedMaps(m); renderSavedList();
}

function loadSavedMap(m) {
    learnedNodes  = new Set(m.learned  || []);
    selectedLevel = m.level            || 'beginner';
    renderGraph(m.data, m.goal, m.positions || {});
}

function renderSavedList() {
    const maps = getSavedMaps();
    const list = document.getElementById('saved-list');
    const keys = Object.keys(maps);
    if (!keys.length) {
        list.innerHTML = '<p class="empty-state">No saved maps yet.<br>Generate your first one!</p>';
        return;
    }
    list.innerHTML = keys.sort((a, b) => maps[b].savedAt - maps[a].savedAt).map(key => {
        const m = maps[key];
        const learned = (m.learned || []).length, total = (m.data?.nodes || []).length;
        const date = new Date(m.savedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
        return `<div class="saved-item" data-key="${key}">
            <div class="lvl-pip ${m.level || 'beginner'}"></div>
            <div class="saved-item-info">
                <div class="saved-item-name">${m.goal}</div>
                <div class="saved-item-meta">${learned}/${total} · ${date}</div>
            </div>
            <button class="saved-item-del" data-key="${key}">✕</button>
        </div>`;
    }).join('');
    // Single event-delegation listener on the list instead of N per-item listeners
    list.addEventListener('click', e => {
        const item = e.target.closest('.saved-item');
        if (!item) return;
        if (e.target.classList.contains('saved-item-del')) {
            e.stopPropagation();
            deleteSavedMap(item.dataset.key);
        } else {
            const m = maps[item.dataset.key];   // reuse already-fetched maps object
            if (m) loadSavedMap(m);
        }
    });
}

// ═══════════════════════════════════════════════════════════
// LEVEL TABS
// ═══════════════════════════════════════════════════════════
document.querySelectorAll('.level-tab').forEach(tab => {
    tab.addEventListener('click', () => {
        document.querySelectorAll('.level-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        selectedLevel = tab.dataset.level;
    });
});

// ═══════════════════════════════════════════════════════════
// INPUT — no scroll, Enter submits, 50-word title truncation
// ═══════════════════════════════════════════════════════════
const goalEl = document.getElementById('goal');

goalEl.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); generate(); }
});

function setGraphTitle(goalText) {
    const words   = goalText.trim().split(/\s+/);
    const titleEl = document.getElementById('graph-title');
    if (words.length <= 50) { titleEl.textContent = goalText; return; }
    const short = words.slice(0, 50).join(' ') + '…';
    let expanded = false;
    titleEl.innerHTML = '';
    const span  = document.createElement('span');
    span.textContent = short;
    const btn = document.createElement('button');
    btn.textContent = ' see more';
    btn.style.cssText = 'background:none;border:none;color:var(--gold);font-size:0.72rem;cursor:pointer;font-family:var(--font-mono);margin-left:6px;padding:0;';
    btn.onclick = () => {
        expanded = !expanded;
        span.textContent = expanded ? goalText : short;
        btn.textContent  = expanded ? ' see less' : ' see more';
    };
    titleEl.appendChild(span);
    titleEl.appendChild(btn);
}

// ═══════════════════════════════════════════════════════════
// GENERATE
// ═══════════════════════════════════════════════════════════
document.getElementById('generate-btn').addEventListener('click', generate);

// ─── Client-side topic cache (saves tokens, instant reload) ─
const CLIENT_CACHE_KEY = 'evernodes_topic_cache_v1';
function getClientCache() {
    try { return JSON.parse(sessionStorage.getItem(CLIENT_CACHE_KEY) || '{}'); } catch { return {}; }
}
function setClientCache(key, value) {
    try {
        const c = getClientCache();
        c[key] = value;
        // Keep only the last 20 entries
        const keys = Object.keys(c);
        if (keys.length > 20) delete c[keys[0]];
        sessionStorage.setItem(CLIENT_CACHE_KEY, JSON.stringify(c));
    } catch {}
}

async function generate() {
    const goal  = goalEl.value.trim();
    const prior = document.getElementById('prior').value.trim();
    if (!goal) { setStatus('Enter a topic to map.', true); goalEl.focus(); return; }

    // Check client-side session cache first — zero network cost
    const cacheKey = goal.toLowerCase().trim() + '::' + selectedLevel;
    const clientHit = getClientCache()[cacheKey];
    if (clientHit) {
        learnedNodes = new Set(clientHit.known || []);
        renderGraph(clientHit, goal, {});
        return;
    }

    setStatus('Building your knowledge map…');
    setLoading(true);

    try {
        const res  = await fetch('/everNodes', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ goal, prior, level: selectedLevel }),
        });
        const data = await res.json();

        if (data.error === 'rate_limit') {
            setStatus(
                '⚠️ API daily limit reached. Update GROQ_API_KEY in your .env file with a new key from console.groq.com, then restart Flask.',
                true
            );
            setLoading(false);
            return;
        }
        if (data.error === 'invalid_topic') {
            setStatus(data.message || 'That does not look like a learnable topic. Try again.', true);
            setLoading(false);
            return;
        }
        if (data.error) {
            setStatus('Error: ' + (data.message || 'Generation failed.'), true);
            setLoading(false);
            return;
        }

        // Store in session cache so same topic is instant next time
        setClientCache(cacheKey, data);

        learnedNodes = new Set(data.known || []);
        renderGraph(data, goal, {});
    } catch {
        setStatus('Network error — is the Flask server running?', true);
        setLoading(false);
    }
}

function setStatus(msg, err = false) {
    const el = document.getElementById('status');
    el.textContent = msg;
    el.className   = err ? 'error' : '';
}
function setLoading(on) {
    document.getElementById('btn-text').classList.toggle('hidden', on);
    document.getElementById('btn-loader').classList.toggle('hidden', !on);
    document.getElementById('generate-btn').disabled = on;
}

// ═══════════════════════════════════════════════════════════
// RENDER GRAPH
// ═══════════════════════════════════════════════════════════
function renderGraph(data, goal, savedPositions) {
    currentData   = data;
    currentGoal   = goal;
    currentScale  = 1.0;
    selectedNodeId = null;
    defaultPositions = {};
    userPositions    = {};
    hasUndoState     = false;

    document.getElementById('input-screen').style.display = 'none';
    document.getElementById('graph-screen').classList.remove('hidden');

    setGraphTitle(goal);
    const lb  = document.getElementById('level-badge');
    const lvl = data.level || selectedLevel;
    lb.textContent = lvl.charAt(0).toUpperCase() + lvl.slice(1);
    lb.className   = 'level-chip ' + lvl;
    updateProgress();

    const hasSavedPos = Object.keys(savedPositions).length > 0;

    // Build node dataset — apply saved positions if available
    const visNodes = new vis.DataSet(data.nodes.map(n => {
        const vn = buildVisNode(n);
        // For hierarchical layout we need the level property
        vn.level = n.tier ?? (n.category === 'root' ? 0 : n.category === 'concept' ? 1 : 2);
        if (hasSavedPos && savedPositions[n.id]) {
            vn.x = savedPositions[n.id].x;
            vn.y = savedPositions[n.id].y;
            // Fix position so physics can't move it
            vn.fixed = { x: false, y: false };
        }
        return vn;
    }));

    // SHARP, LARGE arrows — easy to follow
    const visEdges = new vis.DataSet(data.edges.map(e => ({
        from:  e.from,
        to:    e.to,
        arrows: { to: { enabled: true, scaleFactor: 1.3, type: 'arrow' } },
        color: {
            color:     'rgba(240,192,96,0.35)',
            highlight: 'rgba(240,192,96,0.85)',
            hover:     'rgba(240,192,96,0.65)',
        },
        width:          2.5,
        selectionWidth: 4,
        hoverWidth:     3.5,
        smooth: { type: 'cubicBezier', forceDirection: 'vertical', roundness: 0.35 },
        dashes: false,
    })));

    const container = document.getElementById('graph-container');
    if (network) { network.destroy(); network = null; }

    network = new vis.Network(container, { nodes: visNodes, edges: visEdges }, {
        layout: {
            hierarchical: {
                enabled:              !hasSavedPos,
                direction:            'UD',
                sortMethod:           'directed',
                levelSeparation:      195,
                nodeSpacing:          210,
                treeSpacing:          270,
                blockShifting:        true,
                edgeMinimization:     true,
                parentCentralization: true,
            },
        },
        physics: {
            enabled: !hasSavedPos,
            hierarchicalRepulsion: {
                centralGravity: 0.0,
                springLength:   175,
                springConstant: 0.01,
                nodeDistance:   200,
                damping:        0.09,
            },
            solver:        'hierarchicalRepulsion',
            stabilization: { enabled: true, iterations: 200, updateInterval: 20 },
        },
        interaction: {
            hover:        true,
            tooltipDelay: 180,
            zoomView:     true,
            dragView:     true,
            dragNodes:    true,   // ← nodes stay exactly where dropped
            zoomMin:      0.12,
            zoomMax:      4.0,
        },
        nodes:  { borderWidth: 2 },
        edges:  { hoverWidth: 3 },
    });

    // Zoom → abbreviate labels
    network.on('zoom', p => { currentScale = p.scale; refreshAllLabels(); });

    // Single click → bottom panel
    network.on('click', p => {
        if (p.nodes.length > 0) openPanel(p.nodes[0]);
        else closePanel();
    });

    // Double-click → portal
    network.on('doubleClick', p => {
        if (p.nodes.length > 0) openPortal(p.nodes[0]);
    });

    // After any drag → schedule auto-save (positions change)
    network.on('dragEnd', p => {
        if (p.nodes.length > 0) scheduleAutoSave();
    });

    // Stabilisation overlay
    const overlay = document.getElementById('stabilize-overlay');
    const stabBar = document.getElementById('stabilize-bar');

    if (hasSavedPos) {
        // Restore saved positions — no stabilisation needed
        overlay.style.opacity = '0';
        setTimeout(() => { overlay.style.display = 'none'; }, 100);
        network.setOptions({ physics: { enabled: false } });
        // Saved positions ARE the default for this session
        defaultPositions = { ...savedPositions };
        hasUndoState     = false;
        updateResetBtn();
    } else {
        overlay.style.display  = 'flex';
        overlay.style.opacity  = '1';
        stabBar.style.width    = '0%';
        network.on('stabilizationProgress', p => {
            stabBar.style.width = (p.iterations / p.total * 100) + '%';
        });
        network.once('stabilizationIterationsDone', () => {
            stabBar.style.width = '100%';
            overlay.style.opacity = '0';
            setTimeout(() => { overlay.style.display = 'none'; }, 400);
            network.setOptions({ physics: { enabled: false } });
            // Capture the auto-layout as the "default" positions
            defaultPositions = network.getPositions(data.nodes.map(n => n.id));
            hasUndoState     = false;
            updateResetBtn();
        });
    }

    // Panel drag handle
    document.getElementById('panel-drag-handle').onclick = () => {
        document.getElementById('node-panel').classList.toggle('panel-open');
    };

    // "Enter ↗" in panel
    document.getElementById('panel-enter-btn').onclick = () => {
        if (selectedNodeId !== null) openPortal(selectedNodeId);
    };

    // Fit / Reset View
    document.getElementById('fit-btn').onclick = () => {
        network.fit({ animation: { duration: 600, easingFunction: 'easeInOutQuad' } });
    };

    // Reset Structure / Undo Reset
    document.getElementById('reset-structure-btn').onclick = () => {
        if (!network || !currentData) return;
        if (hasUndoState) {
            // Currently showing default — undo back to user layout
            applyPositions(userPositions);
            hasUndoState = false;
            updateResetBtn();
        } else {
            // Save current user positions, then snap to default
            userPositions = network.getPositions(currentData.nodes.map(n => n.id));
            applyPositions(defaultPositions);
            hasUndoState = true;
            updateResetBtn();
        }
        network.fit({ animation: { duration: 500, easingFunction: 'easeInOutQuad' } });
    };

    // Build explorer list — nodes that have children (concept + root)
    explorerList = data.nodes
        .filter(n => data.edges.some(e => e.from === n.id))
        .sort((a, b) => (a.tier ?? 1) - (b.tier ?? 1) || a.id - b.id);

    renderSavedList();
    setLoading(false);

    // Size particle canvas to match graph container
    const pCanvas = document.getElementById('particle-canvas');
    const gcEl    = document.getElementById('graph-container');
    function sizeParticleCanvas() {
        pCanvas.width  = gcEl.clientWidth;
        pCanvas.height = gcEl.clientHeight;
    }
    sizeParticleCanvas();
    window.addEventListener('resize', sizeParticleCanvas);
}

// ═══════════════════════════════════════════════════════════
// QUICK-INFO PANEL
// ═══════════════════════════════════════════════════════════
function openPanel(nodeId) {
    selectedNodeId = nodeId;
    const node     = currentData.nodes.find(n => n.id === nodeId);
    if (!node) return;

    const isLearned = learnedNodes.has(nodeId);
    document.querySelector('.panel-placeholder').classList.add('hidden');
    document.getElementById('panel-node-info').classList.remove('hidden');
    document.getElementById('node-panel').classList.add('panel-open');

    const cat = document.getElementById('panel-cat');
    cat.textContent = isLearned ? '✦ learned' : (node.category || 'concept');
    cat.className   = 'cat-badge ' + (isLearned ? 'learned' : (node.category || 'concept'));

    document.getElementById('panel-label').textContent = node.label;
    document.getElementById('panel-desc').textContent  = node.description;

    const learnBtn = document.getElementById('panel-learn-btn');
    updateLearnBtn(learnBtn, isLearned);
    learnBtn.onclick = () => toggleLearned(nodeId);

    const wrap    = document.getElementById('panel-chips');
    const prereqs = currentData.edges.filter(e => e.to   === nodeId).map(e => e.from);
    const nexts   = currentData.edges.filter(e => e.from === nodeId).map(e => e.to);
    wrap.innerHTML = [
        ...prereqs.map(id => { const n = currentData.nodes.find(n => n.id === id); return n ? `<span class="chip prereq">← ${n.label}</span>` : ''; }),
        ...nexts.map(id   => { const n = currentData.nodes.find(n => n.id === id); return n ? `<span class="chip next">→ ${n.label}</span>` : ''; }),
    ].join('');
}

function closePanel() { document.getElementById('node-panel').classList.remove('panel-open'); }

function updateLearnBtn(btn, isLearned) {
    btn.textContent = isLearned ? '✦ Learned — undo' : '✦ Mark Learned';
    btn.className   = ('learn-btn ' + (btn.classList.contains('sm') ? 'sm' : '') + (isLearned ? ' is-learned' : '')).trim();
}

// ─── Convert URLs to clickable hyperlinks ───────────────────
function linkify(text) {
    return text.replace(/https?:\/\/[^\s,)"<]+/g, url =>
        `<a href="${url}" target="_blank" rel="noopener noreferrer" class="resource-link">${url}</a>`
    );
}

// ═══════════════════════════════════════════════════════════
// PORTAL EXPLORER + DETAIL PARSER
// ═══════════════════════════════════════════════════════════
function parseDetail(raw) {
    if (!raw) return '<p class="detail-intro">No detail available.</p>';

    // Support both the new || separator format AND legacy \n format
    let parts;
    if (raw.includes('||')) {
        parts = raw.split('||').map(p => p.trim()).filter(Boolean);
    } else {
        // Legacy: split on real newlines
        parts = raw.split(/\n/).map(p => p.trim()).filter(Boolean);
    }

    let intro    = '';
    const bullets= [];
    let closing  = '';
    let resources= '';

    for (const part of parts) {
        const upper = part.toUpperCase();
        if (upper.startsWith('INTRO:')) {
            intro = part.replace(/^intro:\s*/i, '');
        } else if (upper.startsWith('BULLET:')) {
            bullets.push(part.replace(/^bullet:\s*/i, ''));
        } else if (upper.startsWith('NEXT:')) {
            closing = part.replace(/^next:\s*/i, '');
        } else if (upper.startsWith('RESOURCE:')) {
            resources = part.replace(/^resource:\s*/i, '');
        } else if (part.startsWith('•') || part.startsWith('-')) {
            // Legacy bullet format
            bullets.push(part.replace(/^[•\-]\s*/, ''));
        } else if (part.toLowerCase().startsWith('start here:')) {
            resources = part.replace(/^start here:\s*/i, '');
        } else if (!intro) {
            intro = part;
        } else if (!closing && bullets.length > 0) {
            closing = part;
        }
    }

    let html = '<div class="detail-body">';

    if (intro) {
        html += `<p class="detail-intro">${intro}</p>`;
    }

    if (bullets.length) {
        html += '<div class="detail-bullets">';
        bullets.forEach(b => {
            html += `<div class="bullet-item"><span class="bullet-dot">◆</span><span>${b}</span></div>`;
        });
        html += '</div>';
    }

    if (closing) {
        html += `<p class="detail-closing">${closing}</p>`;
    }

    if (resources) {
        html += `<div class="detail-resources">
            <div class="detail-resources-label">📍 Start Here</div>
            <div class="detail-resources-text">${linkify(resources)}</div>
        </div>`;
    }

    html += '</div>';
    return html;
}

function openPortal(nodeId) {
    if (!currentData) return;
    explorerIndex = explorerList.findIndex(n => n.id === nodeId);
    if (explorerIndex < 0) {
        const node = currentData.nodes.find(n => n.id === nodeId);
        if (node) { explorerList = [node, ...explorerList]; explorerIndex = 0; }
        else return;
    }
    renderPortal();
    document.getElementById('portal-overlay').classList.remove('hidden');
}

function renderPortal() {
    const node      = explorerList[explorerIndex];
    const isLearned = learnedNodes.has(node.id);
    const cat       = node.category || 'concept';
    const cfg       = NODE_CFG[cat] || NODE_CFG.concept;

    document.getElementById('portal-topic-crumb').textContent = currentGoal.split(/\s+/).slice(0, 6).join(' ');
    document.getElementById('portal-node-crumb').textContent  = node.label;
    document.getElementById('portal-nav-counter').textContent = `${explorerIndex + 1} / ${explorerList.length}`;
    document.getElementById('portal-prev-btn').disabled = explorerIndex <= 0;
    document.getElementById('portal-next-btn').disabled = explorerIndex >= explorerList.length - 1;

    const catBadge = document.getElementById('portal-parent-cat');
    catBadge.textContent = isLearned ? '✦ learned' : cat;
    catBadge.className   = 'cat-badge ' + (isLearned ? 'learned' : cat);

    const labelEl = document.getElementById('portal-parent-label');
    labelEl.textContent = node.label;
    labelEl.style.color = isLearned ? '#90d0f8' : cfg.border;

    document.getElementById('portal-parent-detail').innerHTML = parseDetail(node.detail || node.description);

    const markBtn = document.getElementById('portal-mark-btn');
    updateLearnBtn(markBtn, isLearned);
    markBtn.onclick = () => { toggleLearned(node.id); renderPortal(); };

    // Children cards
    const childIds  = currentData.edges.filter(e => e.from === node.id).map(e => e.to);
    const children  = currentData.nodes.filter(n => childIds.includes(n.id));
    const grid      = document.getElementById('portal-children-grid');

    if (!children.length) {
        grid.innerHTML = '<p style="color:var(--text3);font-size:0.85rem;grid-column:1/-1;">No deeper concepts from this node.</p>';
    } else {
        grid.innerHTML = children.map(child => {
            const childCfg = NODE_CFG[child.category || 'detail'] || NODE_CFG.detail;
            return `<div class="child-card">
                <div class="child-card-label" style="color:${childCfg.border};">${child.label}</div>
                <div class="child-card-detail">${parseDetail(child.detail || child.description)}</div>
            </div>`;
        }).join('');
    }

    if (network) network.selectNodes([node.id]);
}

document.getElementById('portal-close-btn').onclick   = closePortal;
document.getElementById('portal-backdrop').onclick    = closePortal;
document.getElementById('portal-prev-btn').onclick    = () => { if (explorerIndex > 0) { explorerIndex--; renderPortal(); } };
document.getElementById('portal-next-btn').onclick    = () => { if (explorerIndex < explorerList.length - 1) { explorerIndex++; renderPortal(); } };

function closePortal() {
    document.getElementById('portal-overlay').classList.add('hidden');
    if (network) network.selectNodes([]);
}

// ═══════════════════════════════════════════════════════════
// PARTICLE BURST — fires from node position when marked learned
// ═══════════════════════════════════════════════════════════
(function() {
    const COLORS = ['rgba(240,192,96,', 'rgba(255,255,255,', 'rgba(74,222,128,', 'rgba(64,216,232,'];
    let animId = null;
    const particles = [];

    function spawnBurst(cx, cy) {
        const count = 28;
        for (let i = 0; i < count; i++) {
            const angle = (Math.PI * 2 * i / count) + (Math.random() - 0.5) * 0.4;
            const spd   = 1.5 + Math.random() * 4.5;
            const size  = 2 + Math.random() * 3.5;
            particles.push({
                x: cx, y: cy,
                vx: Math.cos(angle) * spd,
                vy: Math.sin(angle) * spd,
                life: 1.0,
                decay: 0.022 + Math.random() * 0.022,
                size,
                color: COLORS[Math.floor(Math.random() * COLORS.length)],
                shape: Math.random() > 0.5 ? 'circle' : 'star',
            });
        }
        // Sparkle ring
        for (let i = 0; i < 8; i++) {
            const a = (Math.PI * 2 * i / 8);
            const spd = 0.6 + Math.random() * 1.2;
            particles.push({
                x: cx, y: cy,
                vx: Math.cos(a) * spd, vy: Math.sin(a) * spd,
                life: 1.0, decay: 0.014 + Math.random() * 0.01,
                size: 1.5 + Math.random() * 2,
                color: 'rgba(255,255,255,', shape: 'circle',
            });
        }
        if (!animId) loop();
    }

    function loop() {
        const canvas = document.getElementById('particle-canvas');
        if (!canvas) { animId = null; return; }
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        for (let i = particles.length - 1; i >= 0; i--) {
            const p = particles[i];
            p.x    += p.vx;
            p.y    += p.vy;
            p.vy   += 0.06;  // gravity
            p.life -= p.decay;
            if (p.life <= 0) { particles.splice(i, 1); continue; }
            const a = p.life * 0.9;
            ctx.beginPath();
            if (p.shape === 'star') {
                const s = p.size * p.life;
                for (let j = 0; j < 4; j++) {
                    const ang = Math.PI / 2 * j + p.life * 3;
                    ctx.moveTo(p.x, p.y);
                    ctx.lineTo(p.x + Math.cos(ang) * s * 1.8, p.y + Math.sin(ang) * s * 1.8);
                }
                ctx.strokeStyle = p.color + a.toFixed(2) + ')';
                ctx.lineWidth = 1.5;
                ctx.stroke();
            } else {
                ctx.arc(p.x, p.y, Math.max(0.3, p.size * p.life), 0, Math.PI * 2);
                ctx.fillStyle = p.color + a.toFixed(2) + ')';
                ctx.fill();
            }
        }

        if (particles.length > 0) {
            animId = requestAnimationFrame(loop);
        } else {
            animId = null;
            ctx.clearRect(0, 0, canvas.width, canvas.height);
        }
    }

    window.burstParticles = function(nodeId) {
        if (!network) return;
        try {
            const canvasPos = network.getPositions([nodeId])[nodeId];
            if (!canvasPos) return;
            const domPos = network.canvasToDOM(canvasPos);
            spawnBurst(domPos.x, domPos.y);
        } catch {}
    };
})();

// ═══════════════════════════════════════════════════════════
// TOGGLE LEARNED
// ═══════════════════════════════════════════════════════════
function toggleLearned(nodeId) {
    if (learnedNodes.has(nodeId)) learnedNodes.delete(nodeId);
    else {
        learnedNodes.add(nodeId);
        window.burstParticles(nodeId);
    }

    if (network && currentData) {
        const node = currentData.nodes.find(n => n.id === nodeId);
        if (node) {
            const vn  = buildVisNode(node);
            vn.level  = node.tier ?? (node.category === 'root' ? 0 : node.category === 'concept' ? 1 : 2);
            network.body.data.nodes.update(vn);
        }
    }

    const isLearned = learnedNodes.has(nodeId);
    if (selectedNodeId === nodeId) {
        updateLearnBtn(document.getElementById('panel-learn-btn'), isLearned);
        const cat  = document.getElementById('panel-cat');
        const node = currentData?.nodes.find(n => n.id === nodeId);
        if (node) {
            cat.textContent = isLearned ? '✦ learned' : (node.category || 'concept');
            cat.className   = 'cat-badge ' + (isLearned ? 'learned' : (node.category || 'concept'));
        }
    }
    updateProgress();
    scheduleAutoSave();
}

// ═══════════════════════════════════════════════════════════
// PROGRESS
// ═══════════════════════════════════════════════════════════
function updateProgress() {
    if (!currentData) return;
    const total   = currentData.nodes.length;
    const learned = learnedNodes.size;
    document.getElementById('progress-text').textContent = `${learned} / ${total} learned`;
    document.getElementById('progress-bar').style.width  = (total > 0 ? Math.round(learned / total * 100) : 0) + '%';
    if (total > 0 && learned === total) {
        setTimeout(() => showCongrats(currentGoal), 500);
    }
}

// ═══════════════════════════════════════════════════════════
// BACK BUTTON
// ═══════════════════════════════════════════════════════════
document.getElementById('back-btn').addEventListener('click', () => {
    clearTimeout(autoSaveTimer);
    closePortal();
    document.getElementById('graph-screen').classList.add('hidden');
    document.getElementById('input-screen').style.display = 'flex';
    document.getElementById('status').textContent = '';
    goalEl.value = '';
    document.getElementById('prior').value = '';
    document.getElementById('generate-btn').disabled = false;
    document.getElementById('btn-text').classList.remove('hidden');
    document.getElementById('btn-loader').classList.add('hidden');
    closePanel();
    renderSavedList();
    if (network) { network.destroy(); network = null; }
    currentData = null; currentGoal = ''; learnedNodes = new Set(); selectedNodeId = null; currentScale = 1.0;
});

document.getElementById('save-btn').addEventListener('click', () => saveCurrentMap(false));

// ═══════════════════════════════════════════════════════════
// HAMBURGER SIDEBAR TOGGLE
// ═══════════════════════════════════════════════════════════
(function() {
    // Inject the backdrop element once
    const backdrop = document.createElement('div');
    backdrop.id = 'sidebar-backdrop';
    document.getElementById('input-screen').appendChild(backdrop);

    const sidebar = document.getElementById('saved-sidebar');
    const toggleBtn = document.getElementById('sidebar-toggle');
    const closeBtn  = document.getElementById('sidebar-close');

    function openSidebar() {
        sidebar.classList.add('open');
        backdrop.classList.add('active');
        toggleBtn.setAttribute('aria-expanded', 'true');
    }
    function closeSidebar() {
        sidebar.classList.remove('open');
        backdrop.classList.remove('active');
        toggleBtn.setAttribute('aria-expanded', 'false');
    }

    toggleBtn.addEventListener('click', () => {
        sidebar.classList.contains('open') ? closeSidebar() : openSidebar();
    });
    closeBtn.addEventListener('click', closeSidebar);
    backdrop.addEventListener('click', closeSidebar);
})();

// ═══════════════════════════════════════════════════════════
// CONGRATULATIONS + SHOOTING STARS
// ═══════════════════════════════════════════════════════════
let _congratsShown = false;

function showCongrats(topic) {
    if (_congratsShown) return;
    _congratsShown = true;

    const overlay = document.getElementById('congrats-overlay');
    document.getElementById('congrats-topic').textContent = topic || currentGoal;
    overlay.classList.remove('hidden');

    // Launch shooting-star canvas
    const canvas = document.getElementById('shooting-canvas');
    const ctx    = canvas.getContext('2d');
    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;

    const shooters = [];
    function spawnStar() {
        const angle = (-20 - Math.random() * 25) * Math.PI / 180;
        const spd   = 6 + Math.random() * 10;
        shooters.push({
            x:     Math.random() * canvas.width,
            y:     Math.random() * canvas.height * 0.5,
            vx:    Math.cos(angle) * spd,
            vy:    Math.sin(angle) * spd,
            spd,                               // stored so drawShooters can use it
            len:   60 + Math.random() * 120,
            alpha: 0.9 + Math.random() * 0.1,
            color: Math.random() > 0.5 ? 'rgba(240,192,96,' : 'rgba(200,230,255,',
            life:  1.0,
            decay: 0.012 + Math.random() * 0.014,
        });
    }

    // Burst of 12 on open, then random trickle
    for (let i = 0; i < 12; i++) setTimeout(spawnStar, i * 120);
    const trickle = setInterval(() => {
        if (Math.random() > 0.35) spawnStar();
    }, 350);

    let animId;
    function drawShooters() {
        animId = requestAnimationFrame(drawShooters);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        for (let i = shooters.length - 1; i >= 0; i--) {
            const s = shooters[i];
            s.x    += s.vx;
            s.y    += s.vy;
            s.life -= s.decay;
            if (s.life <= 0 || s.x > canvas.width + 50 || s.y > canvas.height + 50) {
                shooters.splice(i, 1); continue;
            }
            const a = s.alpha * s.life;
            const grad = ctx.createLinearGradient(s.x, s.y, s.x - s.vx * s.len / s.spd, s.y - s.vy * s.len / s.spd);
            grad.addColorStop(0, s.color + a.toFixed(2) + ')');
            grad.addColorStop(1, s.color + '0)');
            ctx.beginPath();
            ctx.moveTo(s.x, s.y);
            ctx.lineTo(s.x - s.vx * (s.len / 10), s.y - s.vy * (s.len / 10));
            ctx.strokeStyle = grad;
            ctx.lineWidth   = 1.5 + s.life;
            ctx.stroke();
            // tiny bright head
            ctx.beginPath();
            ctx.arc(s.x, s.y, 1.5, 0, Math.PI * 2);
            ctx.fillStyle = s.color + a.toFixed(2) + ')';
            ctx.fill();
        }
    }
    drawShooters();

    document.getElementById('congrats-close').onclick = () => {
        overlay.classList.add('hidden');
        clearInterval(trickle);
        cancelAnimationFrame(animId);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        _congratsShown = false;
    };
}

// ═══════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════
initStarfield();
renderSavedList();