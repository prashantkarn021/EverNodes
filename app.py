"""
EverNodes — Flask backend
API:      Groq Cloud  (https://console.groq.com)
Model:    llama-3.3-70b-versatile  (served by Groq)
Database: None — all state is stored client-side in the browser's localStorage.
          Saved maps, node positions, and learned progress live in the user's
          browser under the key  'evernodes_v3'.
          If you want server-side persistence in the future, swap localStorage
          for a SQLite / PostgreSQL / Redis store and add user auth.
"""

from flask import Flask, request, jsonify, render_template
from groq import Groq
import json, os, re
from dotenv import load_dotenv

load_dotenv()
app    = Flask(__name__)
client = Groq(api_key=os.getenv("GROQ_API_KEY"))

# ─── Level configuration ─────────────────────────────────────
LEVEL_CONFIG = {
    "beginner":     {"parents": 3, "note": "Use plain language. Build from absolute zero. No jargon."},
    "intermediate": {"parents": 4, "note": "Balance theory and practice. Use real-world examples."},
    "expert":       {"parents": 5, "note": "Technical precision. Include nuance, edge-cases, and depth."},
}

# ─── System prompt ────────────────────────────────────────────
# Note on hallucination: LLMs can never be 100% hallucination-free.
# We reduce it by (a) keeping temperature low (0.2), (b) using a two-phase
# approach — first validate the topic, then generate — (c) explicitly telling
# the model to refuse nonsensical inputs, and (d) requiring factual framing
# ("a real, established subject that can be learned and taught").
SYSTEM_PROMPT = (
    "You are a strict educational content architect. "
    "Your ONLY output is raw valid JSON — no markdown, no backticks, no prose. "
    "You refuse to generate learning maps for nonsensical, offensive, or "
    "meaningless inputs. If a topic is not a real, learnable subject you return "
    "exactly: {\"error\":\"invalid_topic\",\"message\":\"<brief reason>\"}"
)

# ─── Lightweight pre-validation (Python-side, no API call) ───
# Catches obvious junk before spending an API token.
JUNK_PATTERN = re.compile(
    r'^[^a-zA-Z]*$'                  # no letters at all
    r'|^(.)\1{4,}$'                  # same char repeated 5+ times (e.g. "aaaaa")
    r'|^[aeiou\s]{1,4}$'             # very short vowel-only strings
)

def looks_like_junk(text: str) -> bool:
    """Return True when the input is obviously not a learnable topic."""
    t = text.strip()
    if len(t) < 3:
        return True
    # All non-alpha (symbols, numbers-only, etc.)
    if not re.search(r'[a-zA-Z]', t):
        return True
    # Repeated chars: uhhhh, aaaaaa, zzzzz, lmaooo
    if re.fullmatch(r'([a-zA-Z])\1{3,}', t.replace(' ', '')):
        return True
    # Tiny word count AND looks like random letters (no vowel-consonant pattern)
    words = t.split()
    if len(words) <= 2:
        letter_only = re.sub(r'[^a-zA-Z]', '', t).lower()
        vowels = sum(1 for c in letter_only if c in 'aeiou')
        if len(letter_only) > 2 and vowels / len(letter_only) < 0.05:
            return True  # e.g. "zzxq", "hhhh", "brrr"
    return False


def build_prompt(goal: str, prior: str, level: str) -> str:
    cfg       = LEVEL_CONFIG.get(level, LEVEL_CONFIG["beginner"])
    n_parents = cfg["parents"]
    n_children= n_parents * 2
    total     = 1 + n_parents + n_children
    parent_ids= list(range(2, 2 + n_parents))
    child_ids = list(range(2 + n_parents, 2 + n_parents + n_children))

    parent_edges = ", ".join(
        f'{{"from":1,"to":{pid},"label":"introduces"}}' for pid in parent_ids
    )
    child_edges = ""
    for i, pid in enumerate(parent_ids):
        c1 = child_ids[i * 2]
        c2 = child_ids[i * 2 + 1]
        child_edges += (
            f', {{"from":{pid},"to":{c1},"label":"explains"}}'
            f', {{"from":{pid},"to":{c2},"label":"covers"}}'
        )

    # ── Hallucination guard in the prompt itself ──────────────
    # We tell the model: if the topic is not real or learnable, return an error
    # JSON instead of fabricating content.  Temperature 0.2 also helps.
    return f"""TOPIC VALIDATION: Is "{goal}" a real, established subject that can be learned and taught?
If NO — return: {{"error":"invalid_topic","message":"Not a real learnable subject"}}
If YES — build the learning map below.

---
Build a learning path for: "{goal}"
Prior knowledge: "{prior or 'none'}"
Depth level: {level.upper()} — {cfg['note']}

IMPORTANT: Every fact must be accurate and grounded. Do NOT invent terminology,
fake studies, or fabricated examples. If you are uncertain about a detail, omit it.

Return EXACTLY this JSON with {total} nodes:

{{
  "topic": "{goal}",
  "level": "{level}",
  "nodes": [
    {{"id":1,"label":"Short Name","description":"1-sentence overview.","detail":"4-6 accurate, substantive sentences covering the full scope of this topic, why it matters, and what the learner will gain.","category":"root","tier":0}},
    {{"id":2,"label":"Concept Name","description":"1 sentence.","detail":"4-6 sentences: explain the concept clearly, give a real-world example, and state why it is important in this field.","category":"concept","tier":1}},
    {{"id":{2+n_parents},"label":"Sub-concept","description":"1 sentence.","detail":"4-6 sentences diving into this sub-concept with accurate mechanics, examples from real practice, and its relationship to the parent concept.","category":"detail","tier":2}}
  ],
  "edges": [{parent_edges}{child_edges}],
  "known": []
}}

STRICT RULES:
1. Raw JSON only — zero markdown, zero backticks, zero extra text.
2. Exactly {total} nodes with sequential IDs 1–{total}.
3. Node 1 = root. IDs {parent_ids[0]}–{parent_ids[-1]} = concepts. IDs {child_ids[0]}–{child_ids[-1]} = details.
4. Each node needs: id, label (≤4 words), description (1 sentence), detail (4-6 factual sentences), category, tier.
5. Root → every concept. Each concept → exactly 2 detail nodes.
6. No hallucinated facts. No invented references. Verifiable information only."""


def extract_json(raw: str) -> dict:
    raw = raw.strip()
    raw = re.sub(r'^```(?:json)?\s*', '', raw, flags=re.MULTILINE)
    raw = re.sub(r'\s*```$', '', raw, flags=re.MULTILINE)
    raw = raw.strip()
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        pass
    s, e = raw.find('{'), raw.rfind('}')
    if s != -1 and e > s:
        try:
            return json.loads(raw[s:e+1])
        except json.JSONDecodeError:
            pass
    return json.loads(re.sub(r',\s*([}\]])', r'\1', raw))


def validate_graph(data: dict) -> dict:
    # Surface-level error returned by the model for invalid topics
    if "error" in data:
        raise ValueError(data.get("message", "Invalid topic"))

    assert "nodes" in data and "edges" in data, "Missing nodes/edges"
    assert len(data["nodes"]) >= 3, "Too few nodes"

    node_ids = {n["id"] for n in data["nodes"]}
    for node in data["nodes"]:
        assert "id" in node and "label" in node, f"Bad node: {node}"
        node.setdefault("description", f"Learn about {node['label']}.")
        node.setdefault("detail", node["description"])
        if node.get("category") not in {"root", "concept", "detail"}:
            node["category"] = "concept"
        node.setdefault("tier", {"root":0,"concept":1,"detail":2}.get(node["category"],1))
        words = node["label"].split()
        if len(words) > 5:
            node["label"] = " ".join(words[:4])

    data["edges"] = [e for e in data.get("edges", [])
                     if e.get("from") in node_ids and e.get("to") in node_ids]
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

    goal  = body.get("goal", "").strip()
    prior = body.get("prior", "").strip()
    level = body.get("level", "beginner").lower()

    # ── Python-side junk filter (fast, no API cost) ──────────
    if not goal:
        return jsonify({"error": "missing_goal", "message": "Please enter a topic."}), 400
    if looks_like_junk(goal):
        return jsonify({
            "error":   "invalid_topic",
            "message": f'"{goal}" doesn\'t look like a learnable topic. Try something like "Machine Learning" or "Ancient Rome".'
        }), 422

    if level not in LEVEL_CONFIG:
        level = "beginner"

    prompt     = build_prompt(goal, prior, level)
    last_error = None

    for attempt in range(3):
        try:
            response = client.chat.completions.create(
                model="llama-3.3-70b-versatile",
                messages=[
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user",   "content": prompt},
                ],
                temperature=0.2,   # lower = more factual, less hallucination
                max_tokens=3000,
            )
            raw       = response.choices[0].message.content
            parsed    = extract_json(raw)
            validated = validate_graph(parsed)
            validated["topic"] = validated.get("topic", goal)
            validated["level"] = level
            return jsonify(validated)

        except ValueError as e:
            # Model said the topic is invalid
            return jsonify({"error": "invalid_topic", "message": str(e)}), 422
        except (AssertionError, KeyError, json.JSONDecodeError) as e:
            last_error = f"Attempt {attempt+1}: {e}"
        except Exception as e:
            last_error = str(e)
            break

    return jsonify({"error": "generation_failed", "message": last_error}), 500


if __name__ == "__main__":
    app.run(debug=True)