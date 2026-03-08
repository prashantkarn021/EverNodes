/* ═══════════════════════════════════════════════════════════
   EVERNODES — KNOWLEDGE MAP SCRIPT
   No twinkle · Sticky nodes · Gold/Cyan/Green palette
   Auto-save positions · Portal explorer
   ═══════════════════════════════════════════════════════════ */

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
    root:    { bg: '#1a1200', border: '#f0c060', hi: '#fff5cc', glow: 'rgba(240,192,96,',  size: 34 },
    concept: { bg: '#001e24', border: '#40d8e8', hi: '#ccf7ff', glow: 'rgba(64,216,232,',  size: 28 },
    detail:  { bg: '#001a0e', border: '#4ade80', hi: '#ccffe0', glow: 'rgba(74,222,128,',  size: 22 },
};
const LEARNED_CFG = { bg: '#e8f4ff', border: '#ffffff', hi: '#ffffff', glow: 'rgba(255,255,255,', size: 26 };

// ─── Build one vis.js node ───────────────────────────────────
function buildVisNode(node) {
    const isLearned = learnedNodes.has(node.id);
    const cat  = node.category || 'concept';
    const cfg  = isLearned ? LEARNED_CFG : (NODE_CFG[cat] || NODE_CFG.concept);

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
        size:  cfg.size,
        shape: 'dot',
        color: {
            background: cfg.bg,
            border:     cfg.border,
            highlight:  { background: cfg.bg, border: '#ffffff' },
            hover:      { background: cfg.bg, border: '#ffffff' },
        },
        font: {
            color:       isLearned ? '#050f1a' : cfg.border,
            size:        12,
            face:        'JetBrains Mono',
            strokeWidth: 5,
            strokeColor: isLearned ? 'rgba(255,255,255,0)' : 'rgba(0,0,0,0.98)',
        },
        borderWidth:         isLearned ? 3 : 2,
        borderWidthSelected: isLearned ? 4 : 3,
        // 3-D depth: offset shadow gives sphere feel
        shadow: {
            enabled: true,
            color:   cfg.glow + (isLearned ? '0.55)' : '0.50)'),
            size:    isLearned ? 20 : (cat === 'root' ? 18 : cat === 'concept' ? 12 : 8),
            x: 3, y: 3,
        },
    };
}

// ─── Zoom-aware label abbreviation ──────────────────────────
function abbreviateLabel(label, scale) {
    const words = label.trim().split(/\s+/);
    if (scale >= 0.75) return label;
    if (scale >= 0.45) return words[0];
    if (words.length === 1) return label.length > 4 ? label.slice(0, 3) + '.' : label;
    return words.map(w => w[0].toUpperCase()).join('');
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

    const stars = Array.from({ length: 280 }, () => ({
        x: Math.random(), y: Math.random(),
        r: 0.2 + Math.random() * 1.1,
        phase: Math.random() * Math.PI * 2,
        speed: 0.004 + Math.random() * 0.01,
        color: Math.random() > 0.65 ? 'rgba(240,192,96,' : 'rgba(200,225,255,',
    }));

    const nebulae = [
        { x: 0.15, y: 0.25, r: 0.42, c: 'rgba(240,192,96,0.016)' },
        { x: 0.78, y: 0.62, r: 0.38, c: 'rgba(64,216,232,0.018)' },
        { x: 0.52, y: 0.80, r: 0.30, c: 'rgba(74,222,128,0.014)' },
    ];

    function draw() {
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
            s.phase += s.speed * 0.016;
            const a = 0.2 + 0.6 * (0.5 + 0.5 * Math.sin(s.phase));
            ctx.beginPath();
            ctx.arc(s.x * canvas.width, s.y * canvas.height, s.r, 0, Math.PI * 2);
            ctx.fillStyle = s.color + a.toFixed(2) + ')';
            ctx.fill();
        });
        requestAnimationFrame(draw);
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
    list.querySelectorAll('.saved-item').forEach(el => {
        el.addEventListener('click', e => {
            if (e.target.classList.contains('saved-item-del')) return;
            const m = getSavedMaps()[el.dataset.key];
            if (m) loadSavedMap(m);
        });
    });
    list.querySelectorAll('.saved-item-del').forEach(btn => {
        btn.addEventListener('click', e => { e.stopPropagation(); deleteSavedMap(btn.dataset.key); });
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

async function generate() {
    const goal  = goalEl.value.trim();
    const prior = document.getElementById('prior').value.trim();
    if (!goal) { setStatus('Enter a topic to map.', true); goalEl.focus(); return; }

    setStatus('Building your knowledge map…');
    setLoading(true);

    try {
        const res  = await fetch('/everNodes', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ goal, prior, level: selectedLevel }),
        });
        const data = await res.json();

        // Handle invalid-topic responses (junk input or model refusal)
        if (data.error === 'invalid_topic') {
            setStatus(data.message || 'That doesn\'t look like a learnable topic. Try again.', true);
            setLoading(false);
            return;
        }
        if (data.error) {
            setStatus(`Error: ${data.message || 'Generation failed.'}`, true);
            setLoading(false);
            return;
        }

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
                enabled:              !hasSavedPos,  // free layout when positions restored
                direction:            'UD',
                sortMethod:           'directed',
                levelSeparation:      145,
                nodeSpacing:          165,
                treeSpacing:          220,
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

// ═══════════════════════════════════════════════════════════
// PORTAL EXPLORER  — enter a node
// ═══════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════
// DETAIL PARSER — turns plain-text bullet format into HTML
// ═══════════════════════════════════════════════════════════
function parseDetail(raw) {
    if (!raw) return '<p class="detail-intro">No detail available.</p>';

    const lines = raw.split(/\n/).map(l => l.trim()).filter(l => l.length > 0);

    let intro    = '';
    let bullets  = [];
    let closing  = '';
    let resources= '';
    let pastBullets = false;

    for (const line of lines) {
        if (line.startsWith('•') || line.startsWith('-')) {
            bullets.push(line.replace(/^[•\-]\s*/, ''));
            pastBullets = true;
        } else if (line.toLowerCase().startsWith('start here:')) {
            resources = line.replace(/^start here:\s*/i, '');
        } else if (!pastBullets && !intro) {
            intro = line;
        } else if (pastBullets && !line.toLowerCase().startsWith('start here:') && !resources) {
            closing = line;
        }
    }

    // Build HTML
    let html = '';
    html += '<div class="detail-body">';

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
            <div class="detail-resources-text">${resources}</div>
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
// TOGGLE LEARNED
// ═══════════════════════════════════════════════════════════
function toggleLearned(nodeId) {
    if (learnedNodes.has(nodeId)) learnedNodes.delete(nodeId);
    else learnedNodes.add(nodeId);

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
// INIT
// ═══════════════════════════════════════════════════════════
initStarfield();
renderSavedList();