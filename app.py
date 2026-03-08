"""
EverNodes — Flask backend
API:   Groq Cloud / meta-llama/llama-4-scout-17b-16e-instruct
State: browser localStorage only (key 'evernodes_v3')

To change API key: edit GROQ_API_KEY in .env, then restart Flask.
"""

from flask import Flask, request, jsonify, render_template
from groq import Groq
import json, os, re
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

TOKEN_BUDGET = {
    "beginner":     5000,
    "intermediate": 7000,
    "expert":       9000,
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


def extract_json(raw: str) -> dict:
    raw = raw.strip()
    # Strip markdown fences
    raw = re.sub(r'^```(?:json)?\s*', '', raw, flags=re.MULTILINE)
    raw = re.sub(r'\s*```\s*$',       '', raw, flags=re.MULTILINE)
    raw = raw.strip()
    # Fix literal newlines inside strings
    raw = fix_json_newlines(raw)

    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        pass
    s, e = raw.find('{'), raw.rfind('}')
    if s != -1 and e > s:
        try:
            return json.loads(raw[s:e + 1])
        except json.JSONDecodeError:
            pass
    cleaned = re.sub(r',\s*([}\]])', r'\1', raw[s:e + 1] if s != -1 and e > s else raw)
    return json.loads(cleaned)


def validate_graph(data: dict) -> dict:
    if "error" in data:
        raise ValueError(data.get("message", "Invalid topic"))
    assert "nodes" in data and "edges" in data
    assert len(data["nodes"]) >= 3

    node_ids = {n["id"] for n in data["nodes"]}
    for node in data["nodes"]:
        assert "id" in node and "label" in node
        node.setdefault("description", f"Learn about {node['label']}.")
        node.setdefault("detail", node["description"])
        if node.get("category") not in {"root", "concept", "detail", "deep"}:
            node["category"] = "concept"
        node.setdefault("tier", {"root": 0, "concept": 1, "detail": 2, "deep": 3}.get(node["category"], 1))
        words = node["label"].split()
        if len(words) > 5:
            node["label"] = " ".join(words[:4])

    data["edges"] = [e for e in data.get("edges", []) if e.get("from") in node_ids and e.get("to") in node_ids]
    for edge in data["edges"]:
        edge.setdefault("label", "→")
    known = data.get("known", [])
    data["known"] = [k for k in known if k in node_ids] if isinstance(known, list) else []
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

    # Check in-memory cache — zero tokens if already generated this session
    cache_key = f"{goal.lower().strip()}::{level}"
    if cache_key in _TOPIC_CACHE:
        cached = dict(_TOPIC_CACHE[cache_key])
        cached["from_cache"] = True
        return jsonify(cached)

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
            _TOPIC_CACHE[cache_key] = validated
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


@app.route("/cache/clear", methods=["POST"])
def clear_cache():
    _TOPIC_CACHE.clear()
    return jsonify({"cleared": True})


if __name__ == "__main__":
    app.run(debug=True)