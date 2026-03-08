"""
EverNodes — Flask backend
API:   Groq Cloud / meta-llama/llama-4-scout-17b-16e-instruct
State: browser localStorage only (key 'evernodes_v3')
 
To change API key: edit GROQ_API_KEY in .env, then restart Flask.
"""
 
from flask import Flask, request, jsonify, render_template
from groq import Groq
import json, os, re, difflib
from dotenv import load_dotenv
 
load_dotenv()
 
_raw_key = os.getenv("GROQ_API_KEY", "")
if not _raw_key or not _raw_key.startswith("gsk_"):
    print("\n  WARNING: GROQ_API_KEY missing or invalid in .env")
    print("   Add:  GROQ_API_KEY=gsk_your_key_here  to your .env file.\n")
 
app    = Flask(__name__)
client = Groq(api_key=_raw_key or "invalid")
 
# In-memory topic cache — saves tokens for repeated requests
_TOPIC_CACHE: dict = {}


def find_cached_topic(goal: str, level: str):
    """
    Return (cache_key, data, matched_topic) if an identical or sufficiently
    similar topic at the same level is already cached; otherwise (None, None, None).

    Matching strategy (in order):
      1. Exact key match.
      2. One topic is a prefix/suffix of the other (e.g. "ML" ↔ "Machine Learning").
      3. Word-set overlap ≥ 75 % of the shorter topic's words.
      4. SequenceMatcher ratio ≥ 0.82 (catches typos and minor rephrasing).
    """
    goal_lower = goal.lower().strip()
    exact_key = f"{goal_lower}::{level}"

    if exact_key in _TOPIC_CACHE:
        return exact_key, _TOPIC_CACHE[exact_key], goal

    goal_words = set(goal_lower.split())
    best_ratio  = 0.0
    best_key    = None

    for key, data in _TOPIC_CACHE.items():
        if not key.endswith(f"::{level}"):
            continue
        stored = key[:-(len(level) + 2)]

        # Substring containment
        if goal_lower in stored or stored in goal_lower:
            return key, data, stored

        # Word-set overlap
        stored_words = set(stored.split())
        shorter = min(len(goal_words), len(stored_words)) or 1
        overlap = len(goal_words & stored_words) / shorter
        if overlap >= 0.75:
            return key, data, stored

        # Sequence similarity
        ratio = difflib.SequenceMatcher(None, goal_lower, stored).ratio()
        if ratio > best_ratio:
            best_ratio = ratio
            best_key   = key

    if best_ratio >= 0.82 and best_key:
        stored = best_key[:-(len(level) + 2)]
        return best_key, _TOPIC_CACHE[best_key], stored

    return None, None, None
 
TOKEN_BUDGET = {
    "beginner":     5000,
    "intermediate": 7000,
    "expert":       8192,   # model hard cap — was 9000 which caused 400 errors
}
 
 
LEVEL_NOTE = {
    "beginner":     "Plain everyday language. Zero jargon. Build from absolute scratch.",
    "intermediate": "Mix theory and practice. Use real-world examples and applications.",
    "expert":       "Full technical precision. Include nuance, edge-cases, formal definitions.",
}
 
SYSTEM_PROMPT = (
    "You are a strict educational content architect. "
    "Output ONLY raw valid JSON — no markdown, no backticks, no explanation. "
    "Refuse nonsensical inputs by returning: "
    "{\"error\":\"invalid_topic\",\"message\":\"<reason>\"}"
)
 
 
def looks_like_junk(text: str) -> bool:
    t = text.strip()
    if len(t) < 3:
        return True
    if not re.search(r'[a-zA-Z]', t):
        return True
    if re.fullmatch(r'([a-zA-Z])\1{3,}', t.replace(' ', '')):
        return True
    words = t.split()
    if len(words) <= 2:
        letters = re.sub(r'[^a-zA-Z]', '', t).lower()
        if len(letters) > 2 and sum(1 for c in letters if c in 'aeiou') / len(letters) < 0.05:
            return True
    return False
 
 
# Per-level detail field templates — shared preamble extracted to avoid token waste
_DETAIL_PREAMBLE = "ONE single line. Use || to separate parts. No real newlines. Parts in order: "
_DETAIL_PARTS = {
    "beginner": (
        "INTRO: plain sentence what this is || "
        "BULLET: key idea 1 (≤18 words) || "
        "BULLET: key idea 2 (≤18 words) || "
        "BULLET: key idea 3 (≤18 words) || "
        "NEXT: encouraging sentence or first step || "
        "RESOURCE: 2-3 free resources e.g. Khan Academy (khanacademy.org), Wikipedia (wikipedia.org)"
    ),
    "intermediate": (
        "INTRO: concept and its role (1 sentence) || "
        "BULLET: definition (≤22 words) || "
        "BULLET: how it works (≤22 words) || "
        "BULLET: real-world example (≤22 words) || "
        "BULLET: common pitfall (≤22 words) || "
        "NEXT: connection to adjacent topics || "
        "RESOURCE: 2-3 quality resources with names and URLs"
    ),
    "expert": (
        "INTRO: precise technical definition (1 sentence) || "
        "BULLET: formal definition or theorem (≤28 words) || "
        "BULLET: underlying mechanism (≤28 words) || "
        "BULLET: concrete technical example (≤28 words) || "
        "BULLET: edge cases or limitations (≤28 words) || "
        "BULLET: current research frontier (≤28 words) || "
        "NEXT: advanced extensions or open questions || "
        "RESOURCE: 3 authoritative resources (papers, specs, textbooks) with URLs"
    ),
}
 
def detail_format(level: str) -> str:
    return _DETAIL_PREAMBLE + _DETAIL_PARTS.get(level, _DETAIL_PARTS["beginner"])
 
 
def build_prompt(goal: str, prior: str, level: str) -> str:
    note    = LEVEL_NOTE[level]
    det_fmt = detail_format(level)
 
    # Depth and breadth guidance by level — Groq decides exact counts
    if level == "beginner":
        structure_guide = (
            "Build 2-3 tiers below the root (tier 1 = main concepts, tier 2 = their details, tier 3 = optional deeper details). "
            "Use 5-8 concept nodes. Each concept gets 2-3 child detail nodes. "
            "Where a concept genuinely has a deeper layer worth explaining, add 1-2 tier-3 deep nodes beneath it. "
            "Prioritise breadth — cover the topic well across multiple concepts before going deep. "
            "Plain language throughout — no jargon, no assumptions."
        )
    elif level == "intermediate":
        structure_guide = (
            "Build 2-3 tiers below the root. "
            "Use 4-7 concept nodes. Each concept gets 2-3 children. "
            "Where a concept is complex enough, add a tier-3 'deep' node beneath its tier-2 children."
        )
    else:  # expert
        structure_guide = (
            "Build 3-4 tiers below the root. "
            "Use 5-9 concept nodes. Each concept gets 2-4 children. "
            "Add tier-3 and tier-4 nodes where the topic genuinely warrants deeper breakdown. "
            "Do NOT add depth just to fill space — only where it aids understanding."
        )
 
    return f"""TOPIC CHECK: Is "{goal}" a real subject a person can learn?
If NO return exactly: {{"error":"invalid_topic","message":"Not a real learnable subject"}}
If YES continue below.
 
Topic: "{goal}"
Prior knowledge: "{prior or 'none'}"
Level: {level.upper()} — {note}
 
ACCURACY RULE: Only include verifiable facts. Never invent or fabricate. Omit anything uncertain.
 
DETAIL FORMAT FOR EVERY NODE:
{det_fmt}
 
STRUCTURE — you decide exact counts within the guidance below:
{structure_guide}
- Node IDs are sequential integers starting at 1. Root is always ID 1 (tier 0).
- tier 1 nodes: category "concept". tier 2 nodes: category "detail". tier 3+: category "deep".
- Each node must have exactly one parent (connected by one incoming edge). No cycles.
 
Return raw valid JSON only — no markdown, no backticks, no text before or after:
 
{{
  "topic": "short title",
  "level": "{level}",
  "nodes": [
    {{"id": 1, "label": "max 4 words", "description": "1-sentence overview", "detail": "INTRO: ... || BULLET: ... || RESOURCE: ...", "category": "root", "tier": 0}},
    {{"id": 2, "label": "max 4 words", "description": "1 sentence", "detail": "INTRO: ... || BULLET: ... || RESOURCE: ...", "category": "concept", "tier": 1}}
  ],
  "edges": [{{"from": 1, "to": 2, "label": "introduces"}}],
  "known": []
}}
 
FINAL JSON RULES:
1. NO literal newline or tab characters inside any string value.
2. Use || as separator in detail fields only. No backslash-n.
3. Every opened double-quote must be closed.
4. Apostrophes fine; double-quotes inside values must be escaped: \\"
5. Output the COMPLETE JSON in one block — never truncate."""
 
 
def fix_json_newlines(raw: str) -> str:
    """Escape bare newlines/tabs inside JSON string values before parsing."""
    result      = []
    in_string   = False
    escape_next = False
    for ch in raw:
        if escape_next:
            result.append(ch)
            escape_next = False
            continue
        if ch == '\\':
            result.append(ch)
            escape_next = True
            continue
        if ch == '"':
            result.append(ch)
            in_string = not in_string
            continue
        if in_string:
            if ch == '\n':
                result.append('\\n')
                continue
            if ch == '\r':
                continue
            if ch == '\t':
                result.append('\\t')
                continue
        result.append(ch)
    return ''.join(result)


def fix_json_by_error_pos(raw: str, max_fixes: int = 30) -> str:
    """
    Iteratively fix JSON by using the exact character position reported by
    JSONDecodeError.  Each pass finds the nearest unescaped double-quote
    before the error position and escapes it.  This reliably resolves
    "Expecting \',' delimiter" errors caused by unescaped quotes inside
    string values (common LLM output defect).
    """
    text = raw
    for _ in range(max_fixes):
        try:
            json.loads(text)
            return text          # valid — done
        except json.JSONDecodeError as exc:
            msg = str(exc)
            if "Expecting ',' delimiter" not in msg and                "Expecting ':' delimiter" not in msg and                "Invalid control character" not in msg:
                break            # different kind of error — stop
            pos = exc.pos
            # Walk backward from error position to find the nearest
            # unescaped double-quote (the one that terminated the string early)
            fix_at = -1
            p = pos - 1
            while p >= 0:
                if text[p] == '"':
                    # Count preceding backslashes to check if it is escaped
                    n_bs = 0
                    q = p - 1
                    while q >= 0 and text[q] == '\\':
                        n_bs += 1
                        q -= 1
                    if n_bs % 2 == 0:   # not escaped → this is our culprit
                        fix_at = p
                        break
                p -= 1
            if fix_at < 0:
                break            # couldn\'t find a quote to fix
            text = text[:fix_at] + '\\"' + text[fix_at + 1:]
    return text


def sanitize_unicode(raw: str) -> str:
    """Replace smart/curly quotes and problematic Unicode with ASCII equivalents."""
    replacements = {
        '\u201c': '"',  '\u201d': '"',   # curly double quotes → straight
        '\u2018': "'",  '\u2019': "'",   # curly single quotes → straight
        '\u2026': '...', '\u00a0': ' ',  # ellipsis, non-breaking space
        '\u2013': '-',  '\u2014': '-',   # en-dash, em-dash
    }
    for old, new in replacements.items():
        raw = raw.replace(old, new)
    return raw
 
 
def _repair_json(s: str) -> str:
    """Close unclosed JSON brackets/braces to fix truncated LLM output."""
    stack = []
    in_string = False
    escape_next = False
    for ch in s:
        if escape_next:
            escape_next = False
            continue
        if ch == '\\' and in_string:
            escape_next = True
            continue
        if ch == '"':
            in_string = not in_string
            continue
        if not in_string:
            if ch in '{[':
                stack.append('}' if ch == '{' else ']')
            elif ch in '}]':
                if stack and stack[-1] == ch:
                    stack.pop()
    return s + ''.join(reversed(stack))
 
 
def extract_json(raw: str) -> dict:
    raw = raw.strip()
    raw = sanitize_unicode(raw)
    # Strip markdown fences
    raw = re.sub(r'^```(?:json)?\s*', '', raw, flags=re.MULTILINE)
    raw = re.sub(r'\s*```\s*$',       '', raw, flags=re.MULTILINE)
    raw = raw.strip()
    # Trim anything before the first {
    s = raw.find('{')
    if s > 0:
        raw = raw[s:]
    # Fix literal newlines/tabs inside strings
    raw = fix_json_newlines(raw)

    # Attempt 1: direct parse
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        pass

    # Attempt 2: position-guided inner-quote fix (handles "Expecting ',' delimiter")
    try:
        return json.loads(fix_json_by_error_pos(raw))
    except json.JSONDecodeError:
        pass

    # Attempt 3: trim to last }
    e = raw.rfind('}')
    chunk = raw[:e + 1] if e != -1 else raw

    try:
        return json.loads(chunk)
    except json.JSONDecodeError:
        pass

    # Attempt 4: remove trailing commas
    cleaned = re.sub(r',\s*([}\]])', r'\1', chunk)
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        pass

    # Attempt 5: inner-quote fix on trailing-comma-cleaned version
    try:
        return json.loads(fix_json_by_error_pos(cleaned))
    except json.JSONDecodeError:
        pass

    # Attempt 6: repair truncated JSON (close unclosed brackets)
    try:
        repaired = _repair_json(cleaned)
        return json.loads(fix_json_by_error_pos(repaired))
    except json.JSONDecodeError:
        pass

    # Attempt 7: strip non-printable control characters and retry everything
    sanitised = fix_json_by_error_pos(
        _repair_json(re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f]', '', cleaned))
    )
    return json.loads(sanitised)
 
 
def _coerce_id(v) -> int:
    """Safely coerce an LLM-generated id to int (handles dicts, strings, floats)."""
    if isinstance(v, int):
        return v
    if isinstance(v, float):
        return int(v)
    if isinstance(v, str):
        try:
            return int(v.strip())
        except ValueError:
            return hash(v) % 10000   # last resort — stable unique int
    if isinstance(v, dict):
        # LLM occasionally wraps id in {"value": 1} or {"id": 1}
        for key in ("value", "id", "node_id"):
            if key in v:
                return _coerce_id(v[key])
        # grab first numeric value found
        for val in v.values():
            if isinstance(val, (int, float)):
                return int(val)
    return 0


def validate_graph(data: dict) -> dict:
    if "error" in data:
        raise ValueError(data.get("message", "Invalid topic"))
    assert "nodes" in data and "edges" in data
    assert len(data["nodes"]) >= 3

    # Normalise all node ids to plain ints first (prevents "unhashable type: dict")
    for node in data["nodes"]:
        node["id"] = _coerce_id(node.get("id", 0))

    node_ids = {n["id"] for n in data["nodes"]}

    for node in data["nodes"]:
        assert "label" in node, f"Node {node['id']} missing label"
        # Ensure label is a plain string
        if not isinstance(node["label"], str):
            node["label"] = str(node["label"])
        node.setdefault("description", f"Learn about {node['label']}.")
        node.setdefault("detail", node["description"])
        if node.get("category") not in {"root", "concept", "detail", "deep"}:
            node["category"] = "concept"
        node.setdefault("tier", {"root": 0, "concept": 1, "detail": 2, "deep": 3}.get(node["category"], 1))
        words = node["label"].split()
        if len(words) > 5:
            node["label"] = " ".join(words[:4])

    # Normalise edge from/to ids and filter out dangling edges
    for edge in data.get("edges", []):
        edge["from"] = _coerce_id(edge.get("from", 0))
        edge["to"]   = _coerce_id(edge.get("to",   0))
    data["edges"] = [
        e for e in data.get("edges", [])
        if e["from"] in node_ids and e["to"] in node_ids and e["from"] != e["to"]
    ]
    for edge in data["edges"]:
        edge.setdefault("label", "→")

    known = data.get("known", [])
    data["known"] = [_coerce_id(k) for k in known if _coerce_id(k) in node_ids]                     if isinstance(known, list) else []
    return data
 
 
@app.route("/")
def index():
    return render_template("index.html")
 
 
@app.route("/everNodes", methods=["POST"])
def ever_nodes():
    body = request.get_json(silent=True)
    if not body:
        return jsonify({"error": "invalid_request", "message": "No JSON body"}), 400
 
    goal  = body.get("goal",  "").strip()
    prior = body.get("prior", "").strip()
    level = body.get("level", "beginner").lower()
 
    if not goal:
        return jsonify({"error": "missing_goal", "message": "Please enter a topic."}), 400
    if looks_like_junk(goal):
        return jsonify({
            "error":   "invalid_topic",
            "message": f'"{goal}" doesn\'t look like a learnable topic. Try something like "Machine Learning" or "Ancient Rome".',
        }), 422
    if level not in TOKEN_BUDGET:
        level = "beginner"
 
    # Check in-memory cache — zero tokens if identical or similar topic already generated
    cache_key, cached_data, matched_topic = find_cached_topic(goal, level)
    if cached_data is not None:
        result = dict(cached_data)
        result["from_cache"]     = True
        result["matched_topic"]  = matched_topic   # lets the client hint "showing cached: X"
        return jsonify(result)
 
    prompt     = build_prompt(goal, prior, level)
    last_error = None
 
    for attempt in range(3):
        try:
            response = client.chat.completions.create(
                model="meta-llama/llama-4-scout-17b-16e-instruct",
                messages=[
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user",   "content": prompt},
                ],
                temperature=0.2,
                max_tokens=TOKEN_BUDGET[level],
            )
            raw       = response.choices[0].message.content
            parsed    = extract_json(raw)
            validated = validate_graph(parsed)
            validated["topic"] = validated.get("topic", goal)
            validated["level"] = level
            new_key = f"{goal.lower().strip()}::{level}"
            _TOPIC_CACHE[new_key] = validated
            return jsonify(validated)
 
        except ValueError as e:
            return jsonify({"error": "invalid_topic", "message": str(e)}), 422
        except (AssertionError, KeyError, json.JSONDecodeError) as e:
            last_error = f"Attempt {attempt + 1}: {type(e).__name__}: {e}"
        except Exception as e:
            err_str = str(e)
            if "429" in err_str or "rate_limit" in err_str.lower():
                return jsonify({
                    "error":   "rate_limit",
                    "message": "Daily token limit reached. Update GROQ_API_KEY in your .env file with a fresh key from console.groq.com, then restart Flask (Ctrl-C → python app.py).",
                }), 429
            last_error = err_str
            break
 
    return jsonify({"error": "generation_failed", "message": last_error}), 500
 
 
@app.route("/deepDive", methods=["POST"])
def deep_dive():
    """Generate a focused sub-tree for a specific child node — token-optimised."""
    body = request.get_json(silent=True)
    if not body:
        return jsonify({"error": "invalid_request", "message": "No JSON body"}), 400
 
    topic     = body.get("topic", "").strip()       # child label
    parent    = body.get("parent", "").strip()       # parent context
    level     = body.get("level", "beginner").lower()
    detail    = body.get("detail", "").strip()       # existing detail text
 
    if not topic:
        return jsonify({"error": "missing_topic", "message": "No topic for deep dive."}), 400
    if level not in TOKEN_BUDGET:
        level = "beginner"
 
    dive_cache_key = f"dive::{parent}::{topic}::{level}".lower()
    cached_ck, cached_dive, _ = find_cached_topic(f"dive::{parent}::{topic}", level)
    if cached_dive is not None:
        result = dict(cached_dive)
        result["from_cache"] = True
        return jsonify(result)
 
    # Lighter prompt — fewer tokens for a focused sub-tree
    det_fmt = detail_format(level)
    note    = LEVEL_NOTE[level]
    ctx = f'\nContext: "{detail[:120]}"' if detail else ''
 
    dive_prompt = f"""Expand sub-topic "{topic}" (parent: "{parent}").{ctx}
Level: {level.upper()} — {note}

Only verifiable facts. DETAIL FORMAT: {det_fmt}

STRICT TREE STRUCTURE — follow this exactly:
- id=1  : root node, category="root", tier=0. Label = "{topic}" (max 4 words).
- id=2,3,4,5 : concept nodes, category="concept", tier=1. Each is a DIRECT CHILD of root (edge from=1).
  Use 3-5 concept nodes. Each must be a distinct major aspect of the topic.
- id=6+ : detail nodes, category="detail", tier=2. Each is a child of ONE concept node (not the root).
  Each concept node must have 2-3 detail children.

EDGES — the "from" field is the PARENT, "to" is the CHILD:
  Root → concepts : from=1, to=2 | from=1, to=3 | from=1, to=4 (etc.)
  Concepts → details: from=2, to=6 | from=2, to=7 | from=3, to=8 | from=3, to=9 (etc.)

FORBIDDEN: Linear chains like 1→2→3→4→5→6 where every node points to the next.
REQUIRED: A real 2-tier tree — root fans out to concepts, concepts fan out to details.

Total nodes: 10-16. IDs sequential from 1.

Raw JSON only — no markdown/backticks. Example shape (fill in real content):
{{"topic":"{topic}","level":"{level}","nodes":[
  {{"id":1,"label":"{topic[:20]}","description":"1 sentence","detail":"...","category":"root","tier":0}},
  {{"id":2,"label":"Aspect One","description":"...","detail":"...","category":"concept","tier":1}},
  {{"id":3,"label":"Aspect Two","description":"...","detail":"...","category":"concept","tier":1}},
  {{"id":6,"label":"Detail A","description":"...","detail":"...","category":"detail","tier":2}},
  {{"id":7,"label":"Detail B","description":"...","detail":"...","category":"detail","tier":2}}
],"edges":[
  {{"from":1,"to":2,"label":"→"}},{{"from":1,"to":3,"label":"→"}},
  {{"from":2,"to":6,"label":"→"}},{{"from":2,"to":7,"label":"→"}},
  {{"from":3,"to":8,"label":"→"}},{{"from":3,"to":9,"label":"→"}}
],"known":[]}}

RULES: No literal newlines in strings. Use || separator in detail. Escape inner quotes. Complete JSON."""
 
    # Use more tokens for deep dives to avoid truncation with larger tree prompts
    dive_budget = min(TOKEN_BUDGET[level], 5000)
    last_error = None
 
    for attempt in range(3):
        try:
            response = client.chat.completions.create(
                model="meta-llama/llama-4-scout-17b-16e-instruct",
                messages=[
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user",   "content": dive_prompt},
                ],
                temperature=0.2,
                max_tokens=dive_budget,
            )
            raw       = response.choices[0].message.content
            parsed    = extract_json(raw)
            validated = validate_graph(parsed)
            validated["topic"] = validated.get("topic", topic)
            validated["level"] = level
            _TOPIC_CACHE[dive_cache_key] = validated
            return jsonify(validated)
        except ValueError as e:
            return jsonify({"error": "invalid_topic", "message": str(e)}), 422
        except (AssertionError, KeyError, json.JSONDecodeError) as e:
            last_error = f"Attempt {attempt + 1}: {type(e).__name__}: {e}"
        except Exception as e:
            err_str = str(e)
            if "429" in err_str or "rate_limit" in err_str.lower():
                return jsonify({
                    "error": "rate_limit",
                    "message": "Daily token limit reached. Update GROQ_API_KEY.",
                }), 429
            last_error = err_str
            break
 
    return jsonify({"error": "generation_failed", "message": last_error}), 500
 
 
@app.route("/cache/clear", methods=["POST"])
def clear_cache():
    _TOPIC_CACHE.clear()
    return jsonify({"cleared": True})


@app.route("/cache/stats", methods=["GET"])
def cache_stats():
    """Return a summary of what is currently in the in-memory topic cache."""
    entries = []
    for key in _TOPIC_CACHE:
        parts = key.split("::")
        level = parts[-1] if len(parts) >= 2 else "unknown"
        topic = "::".join(parts[:-1])
        entries.append({"key": key, "topic": topic, "level": level})
    return jsonify({"total": len(_TOPIC_CACHE), "entries": entries})
 
 
if __name__ == "__main__":
    app.run(debug=True)