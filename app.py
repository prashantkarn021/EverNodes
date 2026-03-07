from flask import Flask, request, jsonify, render_template
from groq import Groq
import json
import os
from dotenv import load_dotenv

load_dotenv()
app = Flask(__name__)
client = Groq(api_key=os.getenv("GROQ_API_KEY"))

@app.route("/")
def index():
    return render_template("index.html")

@app.route("/everNodes", methods=["POST"])
def everNodes():
    data = request.get_json()
    goal = data.get("goal", "")
    prior = data.get("prior", "nothing yet")

    prompt = f"""You are an expert learning path designer.

The user wants to learn: "{goal}"
They already know: "{prior}"

Return ONLY a valid JSON object. No markdown. No backticks. No explanation. Just raw JSON.

{{
  "nodes": [
    {{"id": 1, "label": "Short Name", "description": "One sentence explanation"}},
    {{"id": 2, "label": "Short Name", "description": "One sentence explanation"}}
  ],
  "edges": [
    {{"from": 1, "to": 2}}
  ],
  "known": [1, 2]
}}

Rules:
- Exactly 10 nodes
- Labels 3 words maximum
- Edges go FROM prerequisite TO dependent concept
- known array has ids of concepts the user already knows
- No markdown, no backticks, nothing outside the JSON"""

    try:
        response = client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[{"role": "user", "content": prompt}]
        )

        raw = response.choices[0].message.content.strip()

        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]

        result = json.loads(raw)
        return jsonify(result)

    except json.JSONDecodeError:
        return jsonify({"error": "parsing_failed"}), 500

    except Exception as e:
        return jsonify({"error": str(e)}), 500

if __name__ == "__main__":
    app.run(debug=True)