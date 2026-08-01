from flask import logging
from flask import Flask, request, render_template, jsonify, Response, stream_with_context
import urllib.request
import json

app = Flask(__name__)


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/prompt", methods=["POST"])
def handle_prompt():
    try:
        if request.is_json:
            data = request.get_json()
            messages = data.get("messages", [])
        else:
            prompt = request.form.get("prompt", "")
            logging.info(f"Received prompt: {prompt}")
            messages = [{"role": "user", "content": prompt}]

        def generate():
            # Call local Qwen model using Ollama API with streaming
            ollama_url = "http://localhost:11434/api/chat"
            payload = {
                "model": "qwen2.5:7b",
                "messages": messages,
                "stream": True
            }

            req = urllib.request.Request(
                ollama_url,
                data=json.dumps(payload).encode("utf-8"),
                headers={"Content-Type": "application/json"},
                method="POST"
            )

            try:
                with urllib.request.urlopen(req, timeout=60) as response:
                    for line in response:
                        if line:
                            yield line
            except Exception as e:
                yield (json.dumps({
                    "error": f"Error calling local LLM: {str(e)}",
                    "done": True
                }) + "\n").encode("utf-8")

        return Response(stream_with_context(generate()), content_type="application/x-ndjson")

    except Exception as e:
        logging.error(f"Error initiating LLM connection: {str(e)}")
        return jsonify({
            "status": "error",
            "message": {"role": "assistant", "content": f"Error initiating LLM connection: {str(e)}"},
            "html": f"<p class='error-msg'>Error initiating LLM connection: {str(e)}</p>"
        }), 500


if __name__ == "__main__":
    app.run(debug=True)
