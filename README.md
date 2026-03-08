# ✦ EverNodes — Road Map Explorer

> **Every subject is a cosmos. Enter it.**

EverNodes is an interactive, AI-powered knowledge mapping tool. Enter any topic and it instantly generates a beautifully visualized, hierarchical graph of concepts — powered by **Groq** (Llama 4 Scout) on the backend and **vis.js** on the frontend. Explore concepts node by node, dive deeper into any subject, mark what you've learned, and save your progress.

---

## ✨ Features

| Feature | Description |
|---|---|
| **Dynamic Knowledge Maps** | AI generates structured topic trees with root, concept, detail, and deep nodes |
| **Interactive Graph** | Click to preview, double-click to enter, drag to rearrange any node |
| **Structure Map Tab** | Live flowchart sidebar showing the full graph hierarchy — scrollable in both directions, color-coded by node type, click any node to focus it |
| **Deep Dive** | Double-click or dive button on any node to generate an AI sub-tree for that concept |
| **Fuzzy Topic Cache** | Server-side + client-side caching with similarity matching — entering "ML" or "machine learning" reuses the same cached map, saving Groq tokens |
| **Mark Learned** | Track your progress per node with confetti + particle bursts |
| **Saved Maps** | Auto-save + manual save to localStorage; searchable sidebar |
| **Three Depth Levels** | Beginner, Intermediate, Expert — each uses tailored prompts and token budgets |
| **Starfield UI** | Animated cosmic background with nebulae and twinkling stars |
| **Congratulations Overlay** | Shooting star animation when you learn every node on a map |

---

## 🛠 Tech Stack

| Layer | Technology |
|---|---|
| **Backend** | Python 3 · Flask · Groq Python SDK |
| **AI Model** | `meta-llama/llama-4-scout-17b-16e-instruct` via Groq Cloud |
| **Graph Rendering** | [vis.js](https://visjs.org/) — hierarchical network layout |
| **Frontend** | Vanilla JS · SVG · CSS custom properties |
| **Fonts** | Syne · DM Sans · JetBrains Mono (Google Fonts) |
| **Persistence** | Browser `localStorage` for saved maps · Server in-memory cache for tokens |

---

## 🚀 Quick Start

### 1. Clone the repository
```bash
git clone https://github.com/your-username/EverNodes.git
cd EverNodes
```

### 2. Install Python dependencies
```bash
pip install -r requirements.txt
```

`requirements.txt` includes:
```
flask
groq
python-dotenv
```

### 3. Get a Groq API key
Sign up at [console.groq.com](https://console.groq.com) — the free tier is generous for personal use.

### 4. Configure your `.env`
Create a `.env` file in the project root:
```env
GROQ_API_KEY=gsk_your_key_here
```

### 5. Run the app
```bash
python app.py
```

Open [http://127.0.0.1:5000](http://127.0.0.1:5000) in your browser.

---

## 📖 Usage Guide

### Generating a Map
1. Type any learnable topic in the text area (e.g. *"Quantum Mechanics"*, *"Jazz Theory"*, *"Ancient Rome"*)
2. Optionally describe what you already know
3. Select **Beginner**, **Intermediate**, or **Expert**
4. Click **Generate Map**

### Navigating the Graph
- **Click** a node → preview in the bottom info panel
- **Double-click** a node → open the Portal (full detail view with child cards)
- **Drag** nodes → rearrange the layout (auto-saved)
- **Scroll / pinch** → zoom in and out
- **⊹ Reset View** → fit all nodes back into viewport
- **↺ Reset Structure** → snap nodes back to original AI-generated positions

### Structure Map (Flowchart Sidebar)
- Click **⊞ Map** in the top-right to toggle the sidebar
- The sidebar shows a **live top-down flowchart** of the entire current graph
- **Root node** at the top; concept, detail, and deep nodes spread downward
- **Color-coded** by node type (gold = root, cyan = concept, green = detail, purple = deep, white = learned)
- Click any node in the sidebar to **focus it** in the main graph and open its panel
- The flowchart scrolls both vertically and horizontally for large maps

### Deep Dive
Click **⬢ Dive Deeper** on any non-root node (panel or portal) to generate an AI sub-tree for that specific concept. The breadcrumb trail in the top bar shows your dive path and lets you navigate back to any level.

### Saving & Loading
- Toggle **Auto-save** in the top bar (on by default — saves 5 seconds after any change)
- Click **✦ Save Map** to save immediately
- Open the hamburger menu (☰) on the home screen to browse, search, and load saved maps

---

## 🗂 Project Structure

```
EverNodes/
├── app.py                  # Flask backend — Groq API, caching, JSON validation
├── requirements.txt
├── .env                    # Your GROQ_API_KEY (not committed)
├── .gitignore
├── README.md
├── static/
│   ├── script.js           # All frontend logic — graph, portal, structure map, dives
│   └── style.css           # Full UI design system (dark cosmic theme)
└── templates/
    └── index.html          # Single-page app shell
```

---

## ⚙️ API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/` | Serve the frontend |
| `POST` | `/everNodes` | Generate a knowledge map for a topic |
| `POST` | `/deepDive` | Generate a sub-tree for a specific node |
| `POST` | `/cache/clear` | Clear the server-side topic cache |
| `GET` | `/cache/stats` | View currently cached topics and their levels |

### `POST /everNodes` — Request body
```json
{
  "goal":  "Machine Learning",
  "prior": "Basic Python, some statistics",
  "level": "intermediate"
}
```

### `POST /deepDive` — Request body
```json
{
  "topic":  "Gradient Descent",
  "parent": "Optimization",
  "level":  "intermediate",
  "detail": "Existing node detail text for context…"
}
```

---

## 🔋 Token Efficiency & Caching

EverNodes uses a **two-layer caching system** to minimize Groq API usage:

### Server-side (in-memory, `_TOPIC_CACHE`)
- Exact match: same topic + level returns instantly
- **Fuzzy match** (new): checks substring containment, word-set overlap (≥ 75%), and sequence similarity (≥ 82%) — so *"ML"*, *"machine learning"*, and *"Machine Learning basics"* all resolve to the same cached map
- Response includes `matched_topic` so the UI can inform you which cached entry was used

### Client-side (`sessionStorage`)
- Stores up to 20 topic/level pairs in the browser session
- Bypasses the server entirely for repeated lookups within the same browser tab

### Per-level token budgets
| Level | Max tokens |
|---|---|
| Beginner | 5,000 |
| Intermediate | 7,000 |
| Expert | 8,192 |

---

## 🛡 Input Validation

The backend validates all inputs before sending to Groq:
- Rejects topics shorter than 3 characters
- Rejects pure numeric or symbol input
- Rejects repeated-character sequences (`"aaaaaaa"`)
- Detects and rejects consonant-only gibberish
- All JSON from the LLM is sanitized, repaired (trailing commas, unclosed brackets, unescaped quotes, smart quotes), and validated before returning to the client

---

## 🎨 Node Categories

| Category | Color | Meaning |
|---|---|---|
| **Root** | Gold | The top-level topic you entered |
| **Concept** | Cyan | Major sub-topics or key ideas (tier 1) |
| **Detail** | Green | Specific facts or sub-concepts (tier 2) |
| **Deep** | Purple | Advanced or niche details (tier 3+) |
| **Learned** | White | Any node you've marked as learned |

---

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/your-feature`
3. Commit your changes: `git commit -m 'Add some feature'`
4. Push to the branch: `git push origin feature/your-feature`
5. Open a Pull Request

Bug reports and suggestions are welcome via [GitHub Issues](https://github.com/your-username/EverNodes/issues).

---

## 📄 License

This project is licensed under the terms in the [LICENSE](LICENSE) file.

---

## 🙏 Acknowledgements

- [Groq](https://groq.com) — blazing-fast LLM inference
- [Meta Llama 4](https://ai.meta.com/llama/) — the model powering all AI generation
- [vis.js](https://visjs.org/) — network graph rendering
- [Google Fonts](https://fonts.google.com) — Syne, DM Sans, JetBrains Mono

---

<p align="center">
  <em>Built with ✦ and curiosity.</em>
</p>