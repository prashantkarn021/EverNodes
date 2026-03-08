/* EverNodes — Knowledge Map */

const STORAGE_KEY = "evernodes_v3";

// ─── State ───────────────────────────────────────────────────
let network = null;
let currentData = null;
let currentGoal = "";
let learnedNodes = new Set();
let selectedLevel = "beginner";
let selectedNodeId = null;
let currentScale = 1.0;
let autoSaveOn = true;
let autoSaveTimer = null;
let defaultPositions = {};
let userPositions = {};
let hasUndoState = false;

// Portal
let explorerList = [];
let explorerIndex = 0;

// ─── Deep Dive State ─────────────────────────────────────────
// Each entry: { data, goal, learnedNodes: Set, originNodeId, originSide, preDiveDtId }
let diveStack = [];
let rootData = null;    // original top-level data
let rootGoal = "";      // original top-level goal
// Track which nodes have been dived into (across all levels)
let divedNodeLabels = new Set();

// ─── Dive Tree (Structure Map) ────────────────────────────────
// Tracks the full branching history of all dives across the session.
// DiveNode: { id, label, description, detail, children: [], parentId }
let diveTree    = null;
let _dtCount    = 0;
let currentDtId = null; // which tree node = the current view

// ═══════════════════════════════════════════════════════════
// NODE VISUAL CONFIG
// ═══════════════════════════════════════════════════════════
const NODE_CFG = {
  root:    { bg: "#1a1200", border: "#f0c060", glow: "rgba(240,192,96,", fontSize: 14, maxW: 190, radius: 10 },
  concept: { bg: "#001e24", border: "#40d8e8", glow: "rgba(64,216,232,", fontSize: 13, maxW: 165, radius: 8 },
  detail:  { bg: "#001a0e", border: "#4ade80", glow: "rgba(74,222,128,", fontSize: 12, maxW: 145, radius: 7 },
  deep:    { bg: "#0e0018", border: "#a78bfa", glow: "rgba(167,139,250,", fontSize: 11, maxW: 130, radius: 6 },
};
const LEARNED_CFG = { bg: "#e8f4ff", border: "#ffffff", glow: "rgba(255,255,255,", fontSize: 13, maxW: 165, radius: 8 };

function buildVisNode(node) {
  const isLearned = learnedNodes.has(node.id);
  const cat = node.category || "concept";
  const cfg = isLearned ? LEARNED_CFG : NODE_CFG[cat] || NODE_CFG.concept;

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
    id: node.id,
    label: abbreviateLabel(node.label, currentScale),
    title: tooltip,
    shape: "box",
    shapeProperties: { borderRadius: cfg.radius },
    widthConstraint: { minimum: 80, maximum: cfg.maxW },
    margin: { top: 10, right: 18, bottom: 10, left: 18 },
    color: {
      background: cfg.bg, border: cfg.border,
      highlight: { background: cfg.bg, border: "#ffffff" },
      hover:     { background: cfg.bg, border: "#ffffff" },
    },
    font: { color: isLearned ? "#050f1a" : cfg.border, size: cfg.fontSize, face: "JetBrains Mono", strokeWidth: 0, multi: false },
    borderWidth: isLearned ? 3 : 2,
    borderWidthSelected: isLearned ? 4 : 3,
    shadow: {
      enabled: true,
      color: cfg.glow + (isLearned ? "0.55)" : "0.45)"),
      size: isLearned ? 18 : cat === "root" ? 16 : cat === "concept" ? 11 : 7,
      x: 2, y: 2,
    },
  };
}

function abbreviateLabel(label, scale) {
  const t = label.trim();
  if (scale >= 0.55) return t;
  if (scale >= 0.35) {
    const words = t.split(/\s+/);
    let out = "";
    for (const w of words) {
      const next = out ? out + " " + w : w;
      if (next.length <= 12) out = next; else break;
    }
    return out || t.slice(0, 11) + "…";
  }
  const ws = t.split(/\s+/);
  return ws.length > 1 ? ws.map(w => w[0].toUpperCase()).join("") : t.length > 4 ? t.slice(0, 3) + "." : t;
}

function refreshAllLabels() {
  if (!network || !currentData) return;
  network.body.data.nodes.update(
    currentData.nodes.map(n => {
      const cat = n.category || 'concept';
      const isLearned = learnedNodes.has(n.id);
      const cfg = isLearned ? LEARNED_CFG : (NODE_CFG[cat] || NODE_CFG.concept);
      const scaleClamp = Math.min(Math.max(currentScale, 0.3), 1.5);
      const scaledSize = Math.max(8, Math.round(cfg.fontSize * Math.sqrt(scaleClamp)));
      return { id: n.id, label: abbreviateLabel(n.label, currentScale), font: { size: scaledSize } };
    })
  );
}

// ═══════════════════════════════════════════════════════════
// STARFIELD
// ═══════════════════════════════════════════════════════════
function initStarfield() {
  const canvas = document.getElementById("starfield-canvas");
  const ctx = canvas.getContext("2d");
  function resize() { canvas.width = window.innerWidth; canvas.height = window.innerHeight; }
  resize();
  window.addEventListener("resize", resize);

  function makeStarState() {
    const dormantMs = 3000 + Math.random() * 14000;
    const fadeInMs = 800 + Math.random() * 2400;
    const holdMs = 400 + Math.random() * 2200;
    const fadeOutMs = 1000 + Math.random() * 3000;
    return { dormantMs, fadeInMs, holdMs, fadeOutMs, state: 0, elapsed: Math.random() * dormantMs };
  }
  const roll = () => Math.random();
  const stars = Array.from({ length: 300 }, () => {
    const r = roll();
    const color = r > 0.8 ? "rgba(240,192,96," : r > 0.55 ? "rgba(160,210,255," : "rgba(220,235,255,";
    const bright = roll() > 0.84;
    return { x: roll(), y: roll(), baseR: 0.3 + roll() * (bright ? 1.6 : 1.0), bright, color, alpha: 0, ...makeStarState() };
  });

  const nebulae = [
    { x: 0.15, y: 0.25, r: 0.42, c: "rgba(240,192,96,0.016)" },
    { x: 0.78, y: 0.62, r: 0.38, c: "rgba(64,216,232,0.018)" },
    { x: 0.52, y: 0.8, r: 0.3, c: "rgba(74,222,128,0.014)" },
  ];

  let last = 0;
  function draw(ts) {
    requestAnimationFrame(draw);
    const dtMs = Math.min(ts - last, 80);
    last = ts;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    nebulae.forEach(n => {
      const g = ctx.createRadialGradient(n.x*canvas.width, n.y*canvas.height, 0, n.x*canvas.width, n.y*canvas.height, Math.max(canvas.width,canvas.height)*n.r);
      g.addColorStop(0, n.c); g.addColorStop(1, "transparent");
      ctx.fillStyle = g; ctx.fillRect(0, 0, canvas.width, canvas.height);
    });

    stars.forEach(s => {
      s.elapsed += dtMs;
      if (s.state === 0 && s.elapsed >= s.dormantMs) { s.state = 1; s.elapsed = 0; s.alpha = 0; }
      else if (s.state === 1) { s.alpha = Math.min(1, s.elapsed / s.fadeInMs); if (s.elapsed >= s.fadeInMs) { s.state = 2; s.elapsed = 0; } }
      else if (s.state === 2) { if (s.elapsed >= s.holdMs) { s.state = 3; s.elapsed = 0; } }
      else if (s.state === 3) { s.alpha = Math.max(0, 1 - s.elapsed / s.fadeOutMs); if (s.elapsed >= s.fadeOutMs) { s.state = 0; s.elapsed = 0; s.alpha = 0; Object.assign(s, makeStarState()); } }
      if (s.alpha <= 0.01) return;
      const peakAlpha = s.bright ? 0.95 : 0.65;
      const a = s.alpha * peakAlpha;
      const cx = s.x * canvas.width, cy = s.y * canvas.height;
      if (s.bright && a > 0.3) {
        const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, s.baseR * 7);
        glow.addColorStop(0, s.color + (a*0.22).toFixed(3) + ")"); glow.addColorStop(1, "transparent");
        ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(cx, cy, s.baseR*7, 0, Math.PI*2); ctx.fill();
      }
      ctx.beginPath(); ctx.arc(cx, cy, Math.max(0.1, s.baseR), 0, Math.PI*2);
      ctx.fillStyle = s.color + a.toFixed(3) + ")"; ctx.fill();
    });
  }
  requestAnimationFrame(draw);
}

// ═══════════════════════════════════════════════════════════
// SAVE / LOAD
// ═══════════════════════════════════════════════════════════
function getSavedMaps() { try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}"); } catch { return {}; } }
function putSavedMaps(m) { localStorage.setItem(STORAGE_KEY, JSON.stringify(m)); }
function getCurrentPositions() { if (!network || !currentData) return {}; return network.getPositions(currentData.nodes.map(n => n.id)); }

function saveCurrentMap(isAuto = false) {
  if (!currentData || !currentGoal) return;
  const maps = getSavedMaps();
  const key = (rootGoal || currentGoal).toLowerCase().trim();
  maps[key] = {
    goal: rootGoal || currentGoal,
    level: selectedLevel,
    data: rootData || currentData,
    learned: Array.from(learnedNodes),
    positions: getCurrentPositions(),
    savedAt: Date.now(),
  };
  putSavedMaps(maps);
  renderSavedList();
  if (!isAuto) {
    const btn = document.getElementById("save-btn");
    const orig = btn.textContent;
    btn.textContent = "✦ Saved!"; btn.style.color = "var(--gold)";
    setTimeout(() => { btn.textContent = orig; btn.style.color = ""; }, 1800);
  }
}

function applyPositions(posMap) {
  if (!network || !currentData || !Object.keys(posMap).length) return;
  const updates = currentData.nodes.map(n => { const p = posMap[n.id]; return p ? { id: n.id, x: p.x, y: p.y } : null; }).filter(Boolean);
  network.body.data.nodes.update(updates);
}
function updateResetBtn() {
  const btn = document.getElementById("reset-structure-btn");
  if (!btn) return;
  if (hasUndoState) { btn.textContent = "↩ Undo Reset"; btn.classList.add("has-undo"); btn.title = "Go back to your custom arrangement"; }
  else { btn.textContent = "↺ Reset Structure"; btn.classList.remove("has-undo"); btn.title = "Snap nodes back to original layout"; }
}
function scheduleAutoSave() { if (!autoSaveOn) return; clearTimeout(autoSaveTimer); autoSaveTimer = setTimeout(() => saveCurrentMap(true), 5000); }

document.getElementById("autosave-toggle").addEventListener("change", e => { autoSaveOn = e.target.checked; });

function deleteSavedMap(key) { const m = getSavedMaps(); delete m[key]; putSavedMaps(m); renderSavedList(); }
function loadSavedMap(m) {
  learnedNodes = new Set(m.learned || []);
  selectedLevel = m.level || "beginner";
  diveStack = []; divedNodeLabels = new Set();
  rootData = m.data; rootGoal = m.goal;
  const _loadRootN = m.data.nodes.find(n => n.category === 'root') || m.data.nodes[0];
  initDiveTree(m.goal, _loadRootN);
  renderGraph(m.data, m.goal, m.positions || {});
}

function renderSavedList(query = "") {
  const maps = getSavedMaps();
  const list = document.getElementById("saved-list");
  let keys = Object.keys(maps);
  const q = query.toLowerCase().trim();
  if (q) keys = keys.filter(k => maps[k].goal.toLowerCase().includes(q));
  keys.sort((a, b) => maps[b].savedAt - maps[a].savedAt);
  if (!Object.keys(maps).length) { list.innerHTML = '<p class="empty-state">No saved maps yet.<br>Generate your first one!</p>'; return; }
  if (!keys.length) { list.innerHTML = `<p class="empty-state">No maps match<br><em style="color:var(--gold)">"${query}"</em></p>`; return; }
  list.innerHTML = keys.map(key => {
    const m = maps[key]; const learned = (m.learned||[]).length; const total = (m.data?.nodes||[]).length;
    const date = new Date(m.savedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" });
    const displayName = q ? m.goal.replace(new RegExp(`(${q})`, "gi"), "<mark>$1</mark>") : m.goal;
    return `<div class="saved-item" data-key="${key}">
      <div class="lvl-pip ${m.level||"beginner"}"></div>
      <div class="saved-item-info"><div class="saved-item-name">${displayName}</div><div class="saved-item-meta">${learned}/${total} · ${date}</div></div>
      <button class="saved-item-del" data-key="${key}">✕</button></div>`;
  }).join("");
  list.addEventListener("click", e => {
    const item = e.target.closest(".saved-item");
    if (!item) return;
    if (e.target.classList.contains("saved-item-del")) { e.stopPropagation(); deleteSavedMap(item.dataset.key); }
    else { const m = maps[item.dataset.key]; if (m) loadSavedMap(m); }
  });
}

// ═══════════════════════════════════════════════════════════
// LEVEL TABS
// ═══════════════════════════════════════════════════════════
document.querySelectorAll(".level-tab").forEach(tab => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".level-tab").forEach(t => t.classList.remove("active"));
    tab.classList.add("active");
    selectedLevel = tab.dataset.level;
  });
});

// ═══════════════════════════════════════════════════════════
// INPUT
// ═══════════════════════════════════════════════════════════
const goalEl = document.getElementById("goal");
goalEl.addEventListener("keydown", e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); generate(); } });

function setGraphTitle(goalText) {
  const words = goalText.trim().split(/\s+/);
  const titleEl = document.getElementById("graph-title");
  if (words.length <= 50) { titleEl.textContent = goalText; return; }
  const short = words.slice(0, 50).join(" ") + "…";
  let expanded = false;
  titleEl.innerHTML = "";
  const span = document.createElement("span"); span.textContent = short;
  const btn = document.createElement("button");
  btn.textContent = " see more";
  btn.style.cssText = "background:none;border:none;color:var(--gold);font-size:0.72rem;cursor:pointer;font-family:var(--font-mono);margin-left:6px;padding:0;";
  btn.onclick = () => { expanded = !expanded; span.textContent = expanded ? goalText : short; btn.textContent = expanded ? " see less" : " see more"; };
  titleEl.appendChild(span); titleEl.appendChild(btn);
}

// ═══════════════════════════════════════════════════════════
// GENERATE
// ═══════════════════════════════════════════════════════════
document.getElementById("generate-btn").addEventListener("click", generate);

const CLIENT_CACHE_KEY = "evernodes_topic_cache_v1";
function getClientCache() { try { return JSON.parse(sessionStorage.getItem(CLIENT_CACHE_KEY) || "{}"); } catch { return {}; } }
function setClientCache(key, value) { try { const c = getClientCache(); c[key] = value; const keys = Object.keys(c); if (keys.length > 20) delete c[keys[0]]; sessionStorage.setItem(CLIENT_CACHE_KEY, JSON.stringify(c)); } catch {} }

async function generate() {
  const goal = goalEl.value.trim();
  const prior = document.getElementById("prior").value.trim();
  if (!goal) { setStatus("Enter a topic to map.", true); goalEl.focus(); return; }

  const cacheKey = goal.toLowerCase().trim() + "::" + selectedLevel;
  const clientHit = getClientCache()[cacheKey];
  if (clientHit) {
    learnedNodes = new Set(clientHit.known || []);
    diveStack = []; divedNodeLabels = new Set();
    rootData = clientHit; rootGoal = goal;
    const _cacheRootN = clientHit.nodes.find(n => n.category === 'root') || clientHit.nodes[0];
    initDiveTree(goal, _cacheRootN);
    renderGraph(clientHit, goal, {});
    return;
  }

  setStatus("Building your knowledge map…"); setLoading(true);
  try {
    const res = await fetch("/everNodes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ goal, prior, level: selectedLevel }) });
    const data = await res.json();
    if (data.error === "rate_limit") { setStatus("⚠️ API daily limit reached. Update GROQ_API_KEY in your .env file.", true); setLoading(false); return; }
    if (data.error === "invalid_topic") { setStatus(data.message || "That does not look like a learnable topic.", true); setLoading(false); return; }
    if (data.error) { setStatus("Error: " + (data.message || "Generation failed."), true); setLoading(false); return; }
    setClientCache(cacheKey, data);
    // Show a subtle hint if the server served a similar cached topic to save tokens
    if (data.from_cache && data.matched_topic && data.matched_topic.toLowerCase() !== goal.toLowerCase()) {
      setStatus(`✦ Showing cached map for "${data.matched_topic}" (similar topic — zero tokens used)`);
    }
    learnedNodes = new Set(data.known || []);
    diveStack = []; divedNodeLabels = new Set();
    rootData = data; rootGoal = goal;
    const _genRootN = data.nodes.find(n => n.category === 'root') || data.nodes[0];
    initDiveTree(goal, _genRootN);
    renderGraph(data, goal, {});
  } catch { setStatus("Network error — is the Flask server running?", true); setLoading(false); }
}

function setStatus(msg, err = false) { const el = document.getElementById("status"); el.textContent = msg; el.className = err ? "error" : ""; }
function setLoading(on) {
  document.getElementById("btn-text").classList.toggle("hidden", on);
  document.getElementById("btn-loader").classList.toggle("hidden", !on);
  document.getElementById("generate-btn").disabled = on;
}

// ═══════════════════════════════════════════════════════════
// RENDER GRAPH
// ═══════════════════════════════════════════════════════════
function renderGraph(data, goal, savedPositions, originSide) {
  currentData = data;
  currentGoal = goal;
  currentScale = 1.0;
  selectedNodeId = null;
  defaultPositions = {};
  userPositions = {};
  hasUndoState = false;

  document.getElementById("input-screen").style.display = "none";
  document.getElementById("graph-screen").classList.remove("hidden");
  setGraphTitle(goal);

  const lb = document.getElementById("level-badge");
  const lvl = data.level || selectedLevel;
  lb.textContent = lvl.charAt(0).toUpperCase() + lvl.slice(1);
  lb.className = "level-chip " + lvl;
  updateProgress();
  updateDiveBreadcrumb();

  const hasSavedPos = Object.keys(savedPositions).length > 0;

  const visNodes = new vis.DataSet(
    data.nodes.map(n => {
      const vn = buildVisNode(n);
      vn.level = n.tier ?? (n.category === "root" ? 0 : n.category === "concept" ? 1 : 2);
      if (hasSavedPos && savedPositions[n.id]) { vn.x = savedPositions[n.id].x; vn.y = savedPositions[n.id].y; vn.fixed = { x: false, y: false }; }
      return vn;
    })
  );

  // Smooth bezier arrows — arrowStrikethrough OFF so line stops before arrowhead
  const visEdges = new vis.DataSet(data.edges.map(e => ({
    from: e.from, to: e.to,
    arrows: { to: { enabled: true, scaleFactor: 0.6, type: 'arrow' } },
    arrowStrikethrough: false,
    color: { color: '#b08a30', highlight: '#f0c060', hover: '#d4a843', inherit: false, opacity: 1.0 },
    width: 2, selectionWidth: 3, hoverWidth: 2.5,
    smooth: { enabled: true, type: 'cubicBezier', forceDirection: 'vertical', roundness: 0.45 },
    dashes: false,
  })));

  const container = document.getElementById("graph-container");
  if (network) { network.destroy(); network = null; }

  network = new vis.Network(container, { nodes: visNodes, edges: visEdges }, {
    layout: {
      hierarchical: { enabled: !hasSavedPos, direction: "UD", sortMethod: "directed", levelSeparation: 195, nodeSpacing: 210, treeSpacing: 270, blockShifting: true, edgeMinimization: true, parentCentralization: true },
    },
    physics: {
      enabled: !hasSavedPos,
      hierarchicalRepulsion: { centralGravity: 0.0, springLength: 175, springConstant: 0.01, nodeDistance: 200, damping: 0.09 },
      solver: "hierarchicalRepulsion",
      stabilization: { enabled: true, iterations: 200, updateInterval: 20 },
    },
    interaction: { hover: true, tooltipDelay: 180, zoomView: true, dragView: true, dragNodes: true, zoomMin: 0.12, zoomMax: 4.0, zoomSpeed: 0.4, keyboard: { enabled: false } },
    nodes: { borderWidth: 2 },
    edges: { arrowStrikethrough: false, hoverWidth: 3, smooth: { type: 'cubicBezier', forceDirection: 'vertical', roundness: 0.45 } },
  });

  network.on("zoom", p => { currentScale = p.scale; refreshAllLabels(); });
  network.on("click", p => { if (p.nodes.length > 0) openPanel(p.nodes[0]); else closePanel(); });
  network.on("doubleClick", p => { if (p.nodes.length > 0) openPortal(p.nodes[0]); });
  network.on("dragEnd", p => { if (p.nodes.length > 0) scheduleAutoSave(); });

  const overlay = document.getElementById("stabilize-overlay");
  const stabBar = document.getElementById("stabilize-bar");

  if (hasSavedPos) {
    overlay.style.opacity = "0"; setTimeout(() => { overlay.style.display = "none"; }, 100);
    network.setOptions({ physics: { enabled: false } });
    defaultPositions = { ...savedPositions }; hasUndoState = false; updateResetBtn();
    renderFlowchartSidebar();
  } else {
    overlay.style.display = "flex"; overlay.style.opacity = "1"; stabBar.style.width = "0%";
    network.on("stabilizationProgress", p => { stabBar.style.width = (p.iterations / p.total) * 100 + "%"; });
    network.once("stabilizationIterationsDone", () => {
      stabBar.style.width = "100%"; overlay.style.opacity = "0";
      setTimeout(() => { overlay.style.display = "none"; }, 400);
      network.setOptions({ physics: { enabled: false } });
      defaultPositions = network.getPositions(data.nodes.map(n => n.id));
      hasUndoState = false; updateResetBtn();

      // Render flowchart AFTER stabilization so positions reflect final layout
      renderFlowchartSidebar();

      // Position camera based on origin side (left-side children stay left in dive view)
      if (originSide && originSide !== 'center') {
        setTimeout(() => {
          const rootId = data.nodes[0]?.id;
          if (rootId && network) {
            const rp = network.getPositions([rootId])[rootId];
            if (rp) {
              const off = originSide === 'left' ? -100 : 100;
              network.moveTo({ position: { x: rp.x + off, y: rp.y - 20 }, scale: 0.85, animation: { duration: 700, easingFunction: 'easeInOutQuad' } });
            }
          }
        }, 150);
      }
    });
  }

  document.getElementById("panel-drag-handle").onclick = () => { document.getElementById("node-panel").classList.toggle("panel-open"); };
  document.getElementById("panel-enter-btn").onclick = () => { if (selectedNodeId !== null) openPortal(selectedNodeId); };
  document.getElementById("fit-btn").onclick = () => { network.fit({ animation: { duration: 600, easingFunction: "easeInOutQuad" } }); };
  document.getElementById("reset-structure-btn").onclick = () => {
    if (!network || !currentData) return;
    if (hasUndoState) { applyPositions(userPositions); hasUndoState = false; }
    else { userPositions = network.getPositions(currentData.nodes.map(n => n.id)); applyPositions(defaultPositions); hasUndoState = true; }
    updateResetBtn();
    network.fit({ animation: { duration: 500, easingFunction: "easeInOutQuad" } });
  };

  explorerList = data.nodes.filter(n => data.edges.some(e => e.from === n.id)).sort((a, b) => (a.tier ?? 1) - (b.tier ?? 1) || a.id - b.id);
  renderSavedList(); setLoading(false);

  const pCanvas = document.getElementById("particle-canvas");
  const gcEl = document.getElementById("graph-container");
  function sizeParticleCanvas() { pCanvas.width = gcEl.clientWidth; pCanvas.height = gcEl.clientHeight; }
  sizeParticleCanvas();
  window.addEventListener("resize", sizeParticleCanvas);
  // Note: renderFlowchartSidebar() is called after stabilization completes (so positions are available)
}

// ═══════════════════════════════════════════════════════════
// QUICK-INFO PANEL
// ═══════════════════════════════════════════════════════════
function openPanel(nodeId) {
  selectedNodeId = nodeId;
  const node = currentData.nodes.find(n => n.id === nodeId);
  if (!node) return;

  const isLearned = learnedNodes.has(nodeId);
  document.querySelector(".panel-placeholder").classList.add("hidden");
  document.getElementById("panel-node-info").classList.remove("hidden");
  document.getElementById("node-panel").classList.add("panel-open");

  const cat = document.getElementById("panel-cat");
  cat.textContent = isLearned ? "✦ learned" : node.category || "concept";
  cat.className = "cat-badge " + (isLearned ? "learned" : node.category || "concept");
  document.getElementById("panel-label").textContent = node.label;
  document.getElementById("panel-desc").textContent = node.description;

  const learnBtn = document.getElementById("panel-learn-btn");
  updateLearnBtn(learnBtn, isLearned);
  learnBtn.onclick = () => toggleLearned(nodeId);

  // Show dive button for any non-root node
  const panelDiveBtn = document.getElementById("panel-dive-btn");
  const isRoot = node.category === "root";
  if (!isRoot) {
    panelDiveBtn.classList.remove("hidden");
    panelDiveBtn.onclick = () => diveDeeper(nodeId);
  } else {
    panelDiveBtn.classList.add("hidden");
  }

  const wrap = document.getElementById("panel-chips");
  const prereqs = currentData.edges.filter(e => e.to === nodeId).map(e => e.from);
  const nexts = currentData.edges.filter(e => e.from === nodeId).map(e => e.to);
  wrap.innerHTML = [
    ...prereqs.map(id => { const n = currentData.nodes.find(n => n.id === id); return n ? `<span class="chip prereq">← ${n.label}</span>` : ""; }),
    ...nexts.map(id => { const n = currentData.nodes.find(n => n.id === id); return n ? `<span class="chip next">→ ${n.label}</span>` : ""; }),
  ].join("");

}

function closePanel() { document.getElementById("node-panel").classList.remove("panel-open"); }

function updateLearnBtn(btn, isLearned) {
  btn.textContent = isLearned ? "✦ Learned — undo" : "✦ Mark Learned";
  btn.className = ("learn-btn " + (btn.classList.contains("sm") ? "sm " : "") + (isLearned ? "is-learned" : "")).trim();
}

function linkify(text) {
  // Match http/https URLs
  let result = text.replace(/https?:\/\/[^\s,)"<\]]+/g,
    url => `<a href="${url}" target="_blank" rel="noopener noreferrer" class="resource-link">${url}</a>`);
  // Match bare domains in parentheses like (khanacademy.org) or (en.wikipedia.org/wiki/X)
  result = result.replace(/\(([a-zA-Z0-9][a-zA-Z0-9-]*(?:\.[a-zA-Z]{2,})+(?:\/[^\s)]*)?)\)/g,
    (match, domain) => {
      if (match.includes('href=')) return match; // already linked
      return `(<a href="https://${domain}" target="_blank" rel="noopener noreferrer" class="resource-link">${domain}</a>)`;
    });
  return result;
}

// ═══════════════════════════════════════════════════════════
// PORTAL EXPLORER + DETAIL PARSER
// ═══════════════════════════════════════════════════════════
function parseDetail(raw) {
  if (!raw) return '<p class="detail-intro">No detail available.</p>';

  // Normalize: replace escaped newlines with real ones for splitting
  const normalized = raw.replace(/\\n/g, '\n').replace(/\\t/g, ' ');

  let parts;
  if (normalized.includes("||")) {
    parts = normalized.split("||").map(p => p.trim()).filter(Boolean);
  } else if (normalized.includes("\n")) {
    parts = normalized.split(/\n+/).map(p => p.trim()).filter(Boolean);
  } else {
    // Try splitting on sentence-ending punctuation followed by known label patterns
    parts = [normalized];
  }

  let intro = "", closing = "", resources = "";
  const bullets = [];

  for (const part of parts) {
    const upper = part.toUpperCase().trimStart();
    if (upper.startsWith("INTRO:"))    { intro   = part.replace(/^intro:\s*/i, ""); }
    else if (upper.startsWith("BULLET:")) { bullets.push(part.replace(/^bullet:\s*/i, "")); }
    else if (upper.startsWith("NEXT:"))  { closing   = part.replace(/^next:\s*/i, ""); }
    else if (upper.startsWith("RESOURCE:")) { resources = part.replace(/^resource:\s*/i, ""); }
    else if (upper.startsWith("START HERE:")) { resources = part.replace(/^start here:\s*/i, ""); }
    else if (part.startsWith("•") || part.startsWith("-")) { bullets.push(part.replace(/^[•\-]\s*/, "")); }
    else if (!intro) { intro = part; }
    else if (!closing && bullets.length > 0) { closing = part; }
    else { bullets.push(part); }
  }

  let html = '<div class="detail-body">';
  if (intro) html += `<p class="detail-intro">${intro}</p>`;
  if (bullets.length) {
    html += '<div class="detail-bullets">';
    bullets.forEach(b => {
      html += `<div class="bullet-item"><span class="bullet-dot">◆</span><span>${b}</span></div>`;
    });
    html += "</div>";
  }
  if (closing) html += `<p class="detail-closing">${closing}</p>`;
  if (resources) {
    html += `<div class="detail-resources">
      <div class="detail-resources-label">📍 Resources</div>
      <div class="detail-resources-text">${linkify(resources)}</div>
    </div>`;
  }
  html += "</div>";
  return html;
}

function openPortal(nodeId) {
  if (!currentData) return;
  explorerIndex = explorerList.findIndex(n => n.id === nodeId);
  if (explorerIndex < 0) {
    const node = currentData.nodes.find(n => n.id === nodeId);
    if (node) { explorerList = [node, ...explorerList]; explorerIndex = 0; } else return;
  }
  renderPortal();
  document.getElementById("portal-overlay").classList.remove("hidden");
}

function renderPortal() {
  const node = explorerList[explorerIndex];
  const isLearned = learnedNodes.has(node.id);
  const cat = node.category || "concept";
  const cfg = NODE_CFG[cat] || NODE_CFG.concept;

  document.getElementById("portal-topic-crumb").textContent = currentGoal.split(/\s+/).slice(0, 6).join(" ");
  document.getElementById("portal-node-crumb").textContent = node.label;
  document.getElementById("portal-nav-counter").textContent = `${explorerIndex + 1} / ${explorerList.length}`;
  document.getElementById("portal-prev-btn").disabled = explorerIndex <= 0;
  document.getElementById("portal-next-btn").disabled = explorerIndex >= explorerList.length - 1;

  const catBadge = document.getElementById("portal-parent-cat");
  catBadge.textContent = isLearned ? "✦ learned" : cat;
  catBadge.className = "cat-badge " + (isLearned ? "learned" : cat);

  const labelEl = document.getElementById("portal-parent-label");
  labelEl.textContent = node.label;
  labelEl.style.color = isLearned ? "#90d0f8" : cfg.border;

  document.getElementById("portal-parent-detail").innerHTML = parseDetail(node.detail || node.description);

  const markBtn = document.getElementById("portal-mark-btn");
  updateLearnBtn(markBtn, isLearned);
  markBtn.onclick = () => { toggleLearned(node.id); renderPortal(); };

  // Dive deeper button — any non-root node can dive
  const diveBtn = document.getElementById("portal-dive-btn");
  const isRoot = node.category === "root";
  if (!isRoot) {
    diveBtn.classList.remove("hidden");
    diveBtn.onclick = () => { closePortal(); diveDeeper(node.id); };
  } else {
    diveBtn.classList.add("hidden");
  }

  // Children cards
  const childIds = currentData.edges.filter(e => e.from === node.id).map(e => e.to);
  const children = currentData.nodes.filter(n => childIds.includes(n.id));
  const grid = document.getElementById("portal-children-grid");

  if (!children.length) {
    grid.innerHTML = '<p style="color:var(--text3);font-size:0.85rem;grid-column:1/-1;">No deeper concepts from this node.</p>';
  } else {
    grid.innerHTML = children.map(child => {
      const childCfg = NODE_CFG[child.category || "detail"] || NODE_CFG.detail;
      const canDive = child.category !== "root";
      return `<div class="child-card" data-child-id="${child.id}">
        <div class="child-card-label" style="color:${childCfg.border};">${child.label}</div>
        <div class="child-card-detail">${parseDetail(child.detail || child.description)}</div>
        ${canDive ? `<button class="dive-btn sm" style="margin-top:10px;" onclick="event.stopPropagation();closePortal();diveDeeper(${child.id});">⬢ Dive Deeper</button>` : ''}
      </div>`;
    }).join("");
  }

  if (network) network.selectNodes([node.id]);
}

document.getElementById("portal-close-btn").onclick = closePortal;
document.getElementById("portal-backdrop").onclick = closePortal;
document.getElementById("portal-prev-btn").onclick = () => { if (explorerIndex > 0) { explorerIndex--; renderPortal(); } };
document.getElementById("portal-next-btn").onclick = () => { if (explorerIndex < explorerList.length - 1) { explorerIndex++; renderPortal(); } };

function closePortal() { document.getElementById("portal-overlay").classList.add("hidden"); if (network) network.selectNodes([]); }

// ═══════════════════════════════════════════════════════════
// CONFETTI — fires on mark learned
// ═══════════════════════════════════════════════════════════
const confettiState = { particles: [], animId: null };

function launchConfetti(cx, cy) {
  const canvas = document.getElementById("confetti-canvas");
  const ctx = canvas.getContext("2d");
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;

  const colors = ['#f0c060','#40d8e8','#4ade80','#a78bfa','#f87171','#ffffff','#fbbf24','#38bdf8'];
  for (let i = 0; i < 45; i++) {
    const angle = (Math.PI * 2 * i) / 45 + (Math.random() - 0.5) * 0.5;
    const spd = 4 + Math.random() * 8;
    confettiState.particles.push({
      x: cx, y: cy,
      vx: Math.cos(angle) * spd * (0.6 + Math.random() * 0.8),
      vy: Math.sin(angle) * spd * (0.6 + Math.random() * 0.8) - 3,
      life: 1.0,
      decay: 0.012 + Math.random() * 0.012,
      size: 3 + Math.random() * 5,
      color: colors[Math.floor(Math.random() * colors.length)],
      rotation: Math.random() * Math.PI * 2,
      rotSpeed: (Math.random() - 0.5) * 0.3,
      shape: Math.random() > 0.5 ? 'rect' : 'circle',
    });
  }
  if (!confettiState.animId) confettiLoop();
}

function confettiLoop() {
  const canvas = document.getElementById("confetti-canvas");
  if (!canvas) { confettiState.animId = null; return; }
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  for (let i = confettiState.particles.length - 1; i >= 0; i--) {
    const p = confettiState.particles[i];
    p.x += p.vx; p.y += p.vy; p.vy += 0.15; // gravity
    p.vx *= 0.99; p.life -= p.decay;
    p.rotation += p.rotSpeed;
    if (p.life <= 0) { confettiState.particles.splice(i, 1); continue; }

    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rotation);
    ctx.globalAlpha = p.life;
    ctx.fillStyle = p.color;
    if (p.shape === 'rect') { ctx.fillRect(-p.size/2, -p.size/4, p.size, p.size/2); }
    else { ctx.beginPath(); ctx.arc(0, 0, p.size/2, 0, Math.PI*2); ctx.fill(); }
    ctx.restore();
  }

  if (confettiState.particles.length > 0) {
    confettiState.animId = requestAnimationFrame(confettiLoop);
  } else {
    confettiState.animId = null;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
}

// ═══════════════════════════════════════════════════════════
// PARTICLE BURST (original)
// ═══════════════════════════════════════════════════════════
(function () {
  const COLORS = ["rgba(240,192,96,", "rgba(255,255,255,", "rgba(74,222,128,", "rgba(64,216,232,"];
  let animId = null;
  const particles = [];

  function spawnBurst(cx, cy) {
    const count = 28;
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.4;
      const spd = 1.5 + Math.random() * 4.5;
      particles.push({ x: cx, y: cy, vx: Math.cos(angle)*spd, vy: Math.sin(angle)*spd, life: 1.0, decay: 0.022+Math.random()*0.022, size: 2+Math.random()*3.5, color: COLORS[Math.floor(Math.random()*COLORS.length)], shape: Math.random()>0.5?"circle":"star" });
    }
    for (let i = 0; i < 8; i++) {
      const a = (Math.PI * 2 * i) / 8;
      const spd = 0.6 + Math.random() * 1.2;
      particles.push({ x: cx, y: cy, vx: Math.cos(a)*spd, vy: Math.sin(a)*spd, life: 1.0, decay: 0.014+Math.random()*0.01, size: 1.5+Math.random()*2, color: "rgba(255,255,255,", shape: "circle" });
    }
    if (!animId) loop();
  }

  function loop() {
    const canvas = document.getElementById("particle-canvas");
    if (!canvas) { animId = null; return; }
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i]; p.x += p.vx; p.y += p.vy; p.vy += 0.06; p.life -= p.decay;
      if (p.life <= 0) { particles.splice(i, 1); continue; }
      const a = p.life * 0.9;
      ctx.beginPath();
      if (p.shape === "star") {
        const s = p.size * p.life;
        for (let j = 0; j < 4; j++) { const ang = (Math.PI/2)*j + p.life*3; ctx.moveTo(p.x, p.y); ctx.lineTo(p.x+Math.cos(ang)*s*1.8, p.y+Math.sin(ang)*s*1.8); }
        ctx.strokeStyle = p.color + a.toFixed(2) + ")"; ctx.lineWidth = 1.5; ctx.stroke();
      } else { ctx.arc(p.x, p.y, Math.max(0.3, p.size*p.life), 0, Math.PI*2); ctx.fillStyle = p.color + a.toFixed(2) + ")"; ctx.fill(); }
    }
    if (particles.length > 0) { animId = requestAnimationFrame(loop); } else { animId = null; ctx.clearRect(0, 0, canvas.width, canvas.height); }
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
// TOGGLE LEARNED — with confetti
// ═══════════════════════════════════════════════════════════
function toggleLearned(nodeId) {
  const wasLearned = learnedNodes.has(nodeId);
  if (wasLearned) learnedNodes.delete(nodeId);
  else {
    learnedNodes.add(nodeId);
    window.burstParticles(nodeId);
    // Launch confetti from screen center
    launchConfetti(window.innerWidth / 2, window.innerHeight / 2);
  }

  if (network && currentData) {
    const node = currentData.nodes.find(n => n.id === nodeId);
    if (node) { const vn = buildVisNode(node); vn.level = node.tier ?? (node.category === "root" ? 0 : node.category === "concept" ? 1 : 2); network.body.data.nodes.update(vn); }
  }

  const isLearned = learnedNodes.has(nodeId);
  if (selectedNodeId === nodeId) {
    updateLearnBtn(document.getElementById("panel-learn-btn"), isLearned);
    const cat = document.getElementById("panel-cat");
    const node = currentData?.nodes.find(n => n.id === nodeId);
    if (node) { cat.textContent = isLearned ? "✦ learned" : node.category || "concept"; cat.className = "cat-badge " + (isLearned ? "learned" : node.category || "concept"); }
  }
  updateProgress();
  scheduleAutoSave();
  renderFlowchartSidebar();
}

// ═══════════════════════════════════════════════════════════
// PROGRESS
// ═══════════════════════════════════════════════════════════
function updateProgress() {
  if (!currentData) return;
  const total = currentData.nodes.length;
  const learned = learnedNodes.size;
  document.getElementById("progress-text").textContent = `${learned} / ${total} learned`;
  document.getElementById("progress-bar").style.width = (total > 0 ? Math.round((learned / total) * 100) : 0) + "%";
  if (total > 0 && learned === total) { setTimeout(() => showCongrats(currentGoal), 500); }
}

// ═══════════════════════════════════════════════════════════
// BACK BUTTON
// ═══════════════════════════════════════════════════════════
document.getElementById("back-btn").addEventListener("click", () => {
  clearTimeout(autoSaveTimer);
  closePortal();
  document.getElementById("graph-screen").classList.add("hidden");
  document.getElementById("input-screen").style.display = "flex";
  document.getElementById("status").textContent = "";
  goalEl.value = "";
  document.getElementById("prior").value = "";
  document.getElementById("generate-btn").disabled = false;
  document.getElementById("btn-text").classList.remove("hidden");
  document.getElementById("btn-loader").classList.add("hidden");
  closePanel();
  renderSavedList();
  if (network) { network.destroy(); network = null; }
  currentData = null; currentGoal = ""; learnedNodes = new Set(); selectedNodeId = null; currentScale = 1.0;
  diveStack = []; rootData = null; rootGoal = ""; divedNodeLabels = new Set();
  diveTree = null; _dtCount = 0; currentDtId = null;
  closeStructureMapPopup();
});

document.getElementById("save-btn").addEventListener("click", () => saveCurrentMap(false));

// ═══════════════════════════════════════════════════════════
// HAMBURGER SIDEBAR TOGGLE
// ═══════════════════════════════════════════════════════════
(function() {
  const backdrop = document.createElement('div');
  backdrop.id = 'sidebar-backdrop';
  document.getElementById('input-screen').appendChild(backdrop);

  const sidebar = document.getElementById('saved-sidebar');
  const toggleBtn = document.getElementById('sidebar-toggle');

  function openSidebar() { sidebar.classList.add('open'); backdrop.classList.add('active'); toggleBtn.setAttribute('aria-expanded', 'true'); }
  function closeSidebar() { sidebar.classList.remove('open'); backdrop.classList.remove('active'); toggleBtn.setAttribute('aria-expanded', 'false'); }

  toggleBtn.addEventListener('click', () => { sidebar.classList.contains('open') ? closeSidebar() : openSidebar(); });
  backdrop.addEventListener('click', closeSidebar);
  document.getElementById('input-screen').addEventListener('click', e => {
    if (!sidebar.contains(e.target) && !toggleBtn.contains(e.target)) closeSidebar();
  });
})();

// ═══════════════════════════════════════════════════════════
// DEEP DIVE SYSTEM
// ═══════════════════════════════════════════════════════════
async function diveDeeper(nodeId) {
  if (!currentData) return;
  const node = currentData.nodes.find(n => n.id === nodeId);
  if (!node) return;

  // Determine which side of the graph this node is on
  let originSide = 'center';
  if (network) {
    try {
      const pos = network.getPositions([nodeId])[nodeId];
      const rootPos = network.getPositions([currentData.nodes[0].id])[currentData.nodes[0].id];
      if (pos && rootPos) {
        originSide = pos.x < rootPos.x ? 'left' : pos.x > rootPos.x ? 'right' : 'center';
      }
    } catch {}
  }

  // Push current state to dive stack (preDiveDtId = current tree node before dive)
  const _preDiveDtId = currentDtId;
  diveStack.push({
    data: currentData,
    goal: currentGoal,
    learnedNodes: new Set(learnedNodes),
    originNodeId: nodeId,
    originSide,
    preDiveDtId: _preDiveDtId,
  });

  // Track that this node has been dived into
  divedNodeLabels.add(node.label);

  // Find parent context
  const parentEdge = currentData.edges.find(e => e.to === nodeId);
  const parentNode = parentEdge ? currentData.nodes.find(n => n.id === parentEdge.from) : null;

  // Show loading state
  closePanel(); closePortal();
  setGraphTitle(`Diving into: ${node.label}…`);
  const overlay = document.getElementById("stabilize-overlay");
  overlay.style.display = "flex"; overlay.style.opacity = "1";
  document.getElementById("stabilize-bar").style.width = "30%";

  try {
    const res = await fetch("/deepDive", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        topic: node.label,
        parent: parentNode ? parentNode.label : currentGoal,
        level: selectedLevel,
        detail: node.detail || node.description || "",
      }),
    });
    const data = await res.json();

    if (data.error) {
      // Restore state on error
      const prev = diveStack.pop();
      divedNodeLabels.delete(node.label);
      overlay.style.opacity = "0"; setTimeout(() => { overlay.style.display = "none"; }, 400);
      setGraphTitle(prev.goal);
      alert("Dive failed: " + (data.message || "Unknown error"));
      return;
    }

    // Register this dive in the tree (grows the structure map)
    addDiveTreeChild(node.label, node.description || '', node.detail || node.description || '');

    // Render the new sub-tree — pass origin side for camera positioning
    learnedNodes = new Set();
    const lastDive = diveStack[diveStack.length - 1];
    renderGraph(data, node.label, {}, lastDive ? lastDive.originSide : 'center');
    renderFlowchartSidebar();
    updateDiveBreadcrumb();
  } catch (err) {
    const prev = diveStack.pop();
    divedNodeLabels.delete(node.label);
    overlay.style.opacity = "0"; setTimeout(() => { overlay.style.display = "none"; }, 400);
    setGraphTitle(prev.goal);
    alert("Network error during dive.");
  }
}

function diveBack(targetIndex) {
  // Navigate back to a specific level in the dive stack
  // targetIndex = -1 means go to root
  closeStructureMapPopup();
  if (targetIndex < 0) {
    // Go back to root
    if (!rootData) return;
    learnedNodes = diveStack.length > 0 ? new Set(diveStack[0].learnedNodes) : new Set();
    diveStack = [];
    currentDtId = diveTree ? diveTree.id : 1; // back to tree root
    renderGraph(rootData, rootGoal, {});
    renderFlowchartSidebar();
    updateDiveBreadcrumb();
    return;
  }

  // Go back to a specific level
  while (diveStack.length > targetIndex + 1) {
    diveStack.pop();
  }
  const target = diveStack.pop();
  if (!target) return;
  learnedNodes = new Set(target.learnedNodes);
  currentDtId = target.preDiveDtId ?? (diveTree ? diveTree.id : 1);
  renderGraph(target.data, target.goal, {});
  renderFlowchartSidebar();
  updateDiveBreadcrumb();
}

function updateDiveBreadcrumb() {
  const bc = document.getElementById("dive-breadcrumb");
  if (diveStack.length === 0) { bc.classList.add("hidden"); return; }
  bc.classList.remove("hidden");

  let html = `<span class="dive-crumb" onclick="diveBack(-1)">${rootGoal.split(/\s+/).slice(0,4).join(" ")}</span>`;
  diveStack.forEach((entry, i) => {
    const label = entry.goal.split(/\s+/).slice(0,4).join(" ");
    html += `<span class="dive-sep">›</span><span class="dive-crumb" onclick="diveBack(${i})">${label}</span>`;
  });
  html += `<span class="dive-sep">›</span><span class="dive-crumb current">${currentGoal.split(/\s+/).slice(0,4).join(" ")}</span>`;
  bc.innerHTML = html;
}

// ═══════════════════════════════════════════════════════════
// STRUCTURE MAP — dive-history tree
// Starts with just the root node (the topic you typed).
// Grows a branch every time you dive into a node.
// The SVG always scales to fit the sidebar width; scrolls only vertically.
// ═══════════════════════════════════════════════════════════

function escHtml(s) {
  return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── Layout constants (natural / unscaled pixel values) ───────
const FC_NODE_W = 120;   // natural node width
const FC_NODE_H = 30;    // natural node height
const FC_V_GAP  = 44;    // vertical gap between tiers
const FC_H_GAP  = 12;    // horizontal gap between sibling subtrees
const FC_PAD    = 16;    // canvas padding each side

// ── Colour palette per dive depth (cycles after 5) ───────────
const FC_DEPTH_COLORS = [
  { bg: 'rgba(240,192,96,0.18)',  stroke: '#f0c060', text: '#f0c060' },  // 0 root — gold
  { bg: 'rgba(64,216,232,0.14)',  stroke: '#40d8e8', text: '#40d8e8' },  // 1 — cyan
  { bg: 'rgba(74,222,128,0.12)',  stroke: '#4ade80', text: '#4ade80' },  // 2 — green
  { bg: 'rgba(167,139,250,0.14)', stroke: '#a78bfa', text: '#a78bfa' },  // 3 — purple
  { bg: 'rgba(251,146,60,0.14)',  stroke: '#fb923c', text: '#fb923c' },  // 4 — orange
];

function _dtDepth(dtNode) {
  let d = 0, n = dtNode;
  while (n.parentId !== null) { d++; n = _dtFind(diveTree, n.parentId) || { parentId: null }; }
  return d;
}

// Returns the total natural width a subtree needs
function _dtSubtreeW(dtNode) {
  if (!dtNode.children.length) return FC_NODE_W;
  const w = dtNode.children.reduce((s, c) => s + _dtSubtreeW(c), 0)
           + FC_H_GAP * (dtNode.children.length - 1);
  return Math.max(FC_NODE_W, w);
}

// Writes posMap[dtNode.id] = {x, y} for the whole subtree
function _dtLayout(dtNode, x, y, posMap) {
  const sw = _dtSubtreeW(dtNode);
  posMap[dtNode.id] = { x: x + (sw - FC_NODE_W) / 2, y };
  if (!dtNode.children.length) return;
  let cx = x;
  dtNode.children.forEach(child => {
    _dtLayout(child, cx, y + FC_NODE_H + FC_V_GAP, posMap);
    cx += _dtSubtreeW(child) + FC_H_GAP;
  });
}

function renderFlowchartSidebar() {
  const container = document.getElementById('flowchart-content');
  if (!container) return;

  // ── Nothing generated yet ──────────────────────────────
  if (!diveTree) {
    container.innerHTML = '<p class="fc-empty">Generate a topic map — the root node will appear here. Dive into nodes to grow the tree.</p>';
    return;
  }

  // ── Compute layout in natural coordinates ──────────────
  const posMap = {};
  _dtLayout(diveTree, FC_PAD, FC_PAD, posMap);

  let natW = 0, natH = 0;
  Object.values(posMap).forEach(p => {
    if (p.x + FC_NODE_W + FC_PAD > natW) natW = p.x + FC_NODE_W + FC_PAD;
    if (p.y + FC_NODE_H + FC_PAD > natH) natH = p.y + FC_NODE_H + FC_PAD;
  });

  // ── Build SVG strings ──────────────────────────────────
  let edgeSVG = '', nodeSVG = '';

  function drawNode(dtNode) {
    const p       = posMap[dtNode.id];
    const isCur   = dtNode.id === currentDtId;
    const isRoot  = dtNode.parentId === null;
    const depth   = _dtDepth(dtNode);
    const palette = FC_DEPTH_COLORS[depth % FC_DEPTH_COLORS.length];
    const lbl     = dtNode.label.length > 15 ? dtNode.label.slice(0, 14) + '…' : dtNode.label;
    const rx      = isRoot ? 10 : 6;
    const strokeW = isCur ? 2.5 : isRoot ? 2.2 : 1.6;
    const fsize   = isRoot ? 10 : 9;
    const fontW   = isCur || isRoot ? 700 : 400;

    // Draw edge to parent
    if (dtNode.parentId !== null) {
      const pp = posMap[dtNode.parentId];
      if (pp) {
        const x1 = pp.x + FC_NODE_W / 2, y1 = pp.y + FC_NODE_H;
        const x2 = p.x  + FC_NODE_W / 2, y2 = p.y;
        const my = (y1 + y2) / 2;
        edgeSVG += `<path d="M${x1},${y1} C${x1},${my} ${x2},${my} ${x2},${y2}"
          fill="none" stroke="${palette.stroke}" stroke-width="1.5" opacity="0.35"/>
          <polygon points="${x2},${y2} ${x2 - 4},${y2 - 8} ${x2 + 4},${y2 - 8}"
          fill="${palette.stroke}" opacity="0.4"/>`;
      }
    }

    // Glow pulse ring on current node
    if (isCur) {
      nodeSVG += `<rect x="${p.x - 5}" y="${p.y - 5}"
        width="${FC_NODE_W + 10}" height="${FC_NODE_H + 10}"
        rx="${rx + 4}" fill="${palette.stroke}" opacity="0.1"
        class="fc-cur-glow"/>`;
    }

    nodeSVG += `<g class="fc-dt-node${isCur ? ' fc-cur' : ''}" data-dt-id="${dtNode.id}" style="cursor:pointer">
      <rect x="${p.x}" y="${p.y}" width="${FC_NODE_W}" height="${FC_NODE_H}"
        rx="${rx}" fill="${palette.bg}" stroke="${palette.stroke}" stroke-width="${strokeW}"/>
      <text x="${p.x + FC_NODE_W / 2}" y="${p.y + FC_NODE_H / 2 + 1}"
        text-anchor="middle" dominant-baseline="middle"
        font-family="JetBrains Mono,monospace"
        font-size="${fsize}" fill="${palette.text}" font-weight="${fontW}"
        >${escHtml(lbl)}</text>
    </g>`;

    dtNode.children.forEach(drawNode);
  }

  drawNode(diveTree);

  // ── Render: SVG uses viewBox so it always fits the sidebar width ──
  // width="100%" + viewBox = scales to container, preserving aspect ratio
  // height is computed proportionally so the SVG is never taller than needed
  container.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg"
         viewBox="0 0 ${natW} ${natH}"
         width="100%"
         height="${natH}"
         preserveAspectRatio="xMidYMin meet"
         style="display:block;max-width:100%;overflow:visible;">
      <style>
        .fc-dt-node rect { transition: opacity .14s, stroke-width .14s; }
        .fc-dt-node:hover rect { opacity:.82; stroke-width:2.5 !important; }
        @keyframes fc-glow-pulse {
          0%,100% { opacity:.08; } 50% { opacity:.18; }
        }
        .fc-cur-glow { animation: fc-glow-pulse 2s ease-in-out infinite; }
      </style>
      ${edgeSVG}${nodeSVG}
    </svg>
    ${diveTree.children.length === 0
      ? '<p class="fc-hint">Dive into any node to grow the map ↓</p>'
      : ''}`;

  // ── Wire node clicks → open detail popup ──────────────
  container.querySelectorAll('.fc-dt-node').forEach(el => {
    el.addEventListener('click', e => {
      e.stopPropagation();
      showStructureMapPopup(+el.dataset.dtId);
    });
  });

  // ── Scroll the current node into view ─────────────────
  setTimeout(() => {
    const curEl = container.querySelector('.fc-dt-node.fc-cur');
    if (curEl) curEl.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
  }, 80);
}

// ── Dive-tree helpers ────────────────────────────────────────
function _dtFind(node, id) {
  if (!node) return null;
  if (node.id === id) return node;
  for (const c of node.children) { const f = _dtFind(c, id); if (f) return f; }
  return null;
}

function initDiveTree(label, rootNode) {
  _dtCount    = 1;
  diveTree    = { id: 1, label, description: rootNode?.description || '', detail: rootNode?.detail || '', children: [], parentId: null };
  currentDtId = 1;
}

function addDiveTreeChild(label, description, detail) {
  if (!diveTree) return;
  const parent = _dtFind(diveTree, currentDtId);
  if (!parent) return;
  const child = { id: ++_dtCount, label, description, detail, children: [], parentId: currentDtId };
  parent.children.push(child);
  currentDtId = child.id;
}

// ── Structure Map popup (clicking a node in the sidebar) ─────
function showStructureMapPopup(dtId) {
  const dtNode = _dtFind(diveTree, dtId);
  if (!dtNode) return;

  let popup = document.getElementById('sm-popup');
  if (!popup) {
    popup = document.createElement('div');
    popup.id = 'sm-popup';
    document.getElementById('graph-screen').appendChild(popup);
    document.addEventListener('click', e => {
      if (popup && !popup.contains(e.target) && !e.target.closest('.fc-dt-node'))
        closeStructureMapPopup();
    });
  }

  const detailHtml = dtNode.detail
    ? parseDetail(dtNode.detail)
    : (dtNode.description ? `<p class="detail-intro">${escHtml(dtNode.description)}</p>` : '');
  const isRoot = dtNode.parentId === null;

  popup.innerHTML = `
    <div class="sm-popup-header">
      <span class="sm-popup-badge">${isRoot ? 'Origin' : 'Dived Into'}</span>
      <button class="sm-popup-close" onclick="closeStructureMapPopup()">✕</button>
    </div>
    <h3 class="sm-popup-title">${escHtml(dtNode.label)}</h3>
    <div class="sm-popup-body">${detailHtml || '<p class="detail-intro" style="color:var(--text3)">No details available.</p>'}</div>`;

  popup.classList.add('visible');
}

function closeStructureMapPopup() {
  const popup = document.getElementById('sm-popup');
  if (popup) popup.classList.remove('visible');
}

// Flowchart sidebar toggle
document.getElementById("flowchart-toggle-btn").addEventListener("click", () => {
  const sidebar = document.getElementById("flowchart-sidebar");
  sidebar.classList.toggle("open");
});
document.getElementById("flowchart-close-btn").addEventListener("click", () => {
  document.getElementById("flowchart-sidebar").classList.remove("open");
});

// ═══════════════════════════════════════════════════════════
// CONGRATULATIONS + SHOOTING STARS
// ═══════════════════════════════════════════════════════════
let _congratsShown = false;

function showCongrats(topic) {
  if (_congratsShown) return;
  _congratsShown = true;

  const overlay = document.getElementById("congrats-overlay");
  document.getElementById("congrats-topic").textContent = topic || currentGoal;
  overlay.classList.remove("hidden");

  const canvas = document.getElementById("shooting-canvas");
  const ctx = canvas.getContext("2d");
  canvas.width = window.innerWidth; canvas.height = window.innerHeight;

  const shooters = [];
  function spawnStar() {
    const angle = ((-20 - Math.random() * 25) * Math.PI) / 180;
    const spd = 6 + Math.random() * 10;
    shooters.push({
      x: Math.random()*canvas.width, y: Math.random()*canvas.height*0.5,
      vx: Math.cos(angle)*spd, vy: Math.sin(angle)*spd, spd,
      len: 60+Math.random()*120, alpha: 0.9+Math.random()*0.1,
      color: Math.random()>0.5 ? "rgba(240,192,96," : "rgba(200,230,255,",
      life: 1.0, decay: 0.012+Math.random()*0.014,
    });
  }

  for (let i = 0; i < 12; i++) setTimeout(spawnStar, i * 120);
  const trickle = setInterval(() => { if (Math.random() > 0.35) spawnStar(); }, 350);

  let animId;
  function drawShooters() {
    animId = requestAnimationFrame(drawShooters);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (let i = shooters.length - 1; i >= 0; i--) {
      const s = shooters[i]; s.x += s.vx; s.y += s.vy; s.life -= s.decay;
      if (s.life <= 0 || s.x > canvas.width+50 || s.y > canvas.height+50) { shooters.splice(i, 1); continue; }
      const a = s.alpha * s.life;
      const grad = ctx.createLinearGradient(s.x, s.y, s.x-(s.vx*s.len)/s.spd, s.y-(s.vy*s.len)/s.spd);
      grad.addColorStop(0, s.color + a.toFixed(2) + ")"); grad.addColorStop(1, s.color + "0)");
      ctx.beginPath(); ctx.moveTo(s.x, s.y);
      ctx.lineTo(s.x - s.vx*(s.len/10), s.y - s.vy*(s.len/10));
      ctx.strokeStyle = grad; ctx.lineWidth = 1.5+s.life; ctx.stroke();
      ctx.beginPath(); ctx.arc(s.x, s.y, 1.5, 0, Math.PI*2);
      ctx.fillStyle = s.color + a.toFixed(2) + ")"; ctx.fill();
    }
  }
  drawShooters();

  // Also launch big confetti burst for congrats
  launchConfetti(window.innerWidth/2, window.innerHeight/2);

  document.getElementById("congrats-close").onclick = () => {
    overlay.classList.add("hidden"); clearInterval(trickle);
    cancelAnimationFrame(animId); ctx.clearRect(0, 0, canvas.width, canvas.height);
    _congratsShown = false;
  };
}

// ═══════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════
initStarfield();
renderSavedList();

document.getElementById("sidebar-search").addEventListener("input", e => { renderSavedList(e.target.value); });

(function () {
  const observer = new MutationObserver(() => {
    const sidebar = document.getElementById("saved-sidebar");
    if (!sidebar.classList.contains("open")) {
      const searchEl = document.getElementById("sidebar-search");
      if (searchEl) { searchEl.value = ""; renderSavedList(); }
    }
  });
  observer.observe(document.getElementById("saved-sidebar"), { attributes: true, attributeFilter: ["class"] });
})();