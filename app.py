import logging
import json
import uuid
import urllib.request
import urllib.parse
from flask import Flask, request, render_template, jsonify, Response, stream_with_context
import chromadb
import ollama as ollama_client
from langchain_ollama import ChatOllama
from langchain.agents import create_agent
from langchain_core.messages import HumanMessage, AIMessage, SystemMessage
from langchain_core.tools import tool
from ddgs import DDGS

logging.basicConfig(level=logging.INFO)

app = Flask(__name__)

# ---------------------------------------------------------------------------
# ChromaDB persistent memory
# ---------------------------------------------------------------------------
CHROMA_PATH = "./chroma_memory"
EMBED_MODEL = "nomic-embed-text"

chroma_client = chromadb.PersistentClient(path=CHROMA_PATH)
memory_collection = chroma_client.get_or_create_collection(
    name="conversation_history",
    metadata={"hnsw:space": "cosine"}
)


def get_embedding(text: str) -> list[float]:
    """Generate an embedding vector using Ollama."""
    try:
        response = ollama_client.embeddings(model=EMBED_MODEL, prompt=text)
        return response.get("embedding", [])
    except Exception as e:
        logging.warning(f"Error generating embedding: {e}")
        return []


def save_memory(user_msg: str, assistant_msg: str):
    """Save a conversation turn to the vector store."""
    try:
        content = f"User: {user_msg}\nAssistant: {assistant_msg}"
        embedding = get_embedding(content)
        if embedding:
            memory_collection.add(
                documents=[content],
                embeddings=[embedding],
                metadatas=[{"role": "dialogue_turn"}],
                ids=[str(uuid.uuid4())]
            )
    except Exception as e:
        logging.warning(f"Could not save conversation turn to ChromaDB: {e}")


def query_relevant_memories(query: str, n_results: int = 3) -> list[str]:
    """Retrieve semantically relevant past conversation turns from ChromaDB."""
    try:
        if memory_collection.count() == 0:
            return []
        query_vector = get_embedding(query)
        if not query_vector:
            return []
        results = memory_collection.query(
            query_embeddings=[query_vector],
            n_results=min(n_results, memory_collection.count())
        )
        if results and "documents" in results and results["documents"]:
            return results["documents"][0]
        return []
    except Exception as e:
        logging.warning(f"Could not query ChromaDB memory: {e}")
        return []


# ---------------------------------------------------------------------------
# Tools with robust exception handling
# ---------------------------------------------------------------------------
@tool
def duckduckgo_search_tool(query: str) -> str:
    """A search engine. Useful for when you need to answer questions about current events."""
    try:
        with DDGS(timeout=10) as ddgs:
            results = list(ddgs.text(query, max_results=5))
            if not results:
                return f"No good DuckDuckGo search results found for query: '{query}'. Please answer using your existing knowledge or ask for clarification."
            return "\n".join([f"[{r['title']}]({r['href']})\n{r['body']}" for r in results])
    except Exception as e:
        logging.info(f"DuckDuckGo search encountered an issue: {e}")
        return f"DuckDuckGo search could not retrieve results ({str(e)}). Proceed using your existing knowledge."


@tool
def get_current_weather(location: str) -> str:
    """Gets the current weather for a specific city or location."""
    try:
        city = urllib.parse.quote(location)
        url = f"https://wttr.in/{city}?format=3"
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=5) as response:
            return response.read().decode('utf-8').strip()
    except Exception as e:
        return f"Error fetching weather for {location}: {str(e)}"


tools = [duckduckgo_search_tool, get_current_weather]

# ---------------------------------------------------------------------------
# Dynamic Model Discovery & Agent Management
# ---------------------------------------------------------------------------
DEFAULT_MODEL = "qwen2.5:7b"
_agents_cache: dict[str, any] = {}


def get_installed_llms() -> list[str]:
    """Retrieve locally installed LLM chat models from Ollama."""
    try:
        res = ollama_client.list()
        models_list = getattr(res, "models", None)
        if models_list is None and isinstance(res, dict):
            models_list = res.get("models", [])

        llms = []
        for m in models_list:
            name = getattr(m, "model", None) or (m.get("model") if isinstance(m, dict) else str(m))
            details = getattr(m, "details", None) or (m.get("details", {}) if isinstance(m, dict) else {})
            family = getattr(details, "family", "") or (details.get("family", "") if isinstance(details, dict) else "")

            # Filter out embedding models
            if "embed" in name.lower() or "nomic-bert" in str(family).lower() or "bge" in name.lower():
                continue
            llms.append(name)

        return llms if llms else [DEFAULT_MODEL]
    except Exception as e:
        logging.error(f"Error fetching Ollama models: {e}")
        return [DEFAULT_MODEL]


def get_default_model(installed: list[str]) -> str:
    """Return default model, preferring qwen."""
    if not installed:
        return DEFAULT_MODEL
    # First priority: qwen2.5:7b
    if "qwen2.5:7b" in installed:
        return "qwen2.5:7b"
    # Second priority: any model with qwen in its name
    for m in installed:
        if "qwen" in m.lower():
            return m
    return installed[0]


def get_agent(model_name: str):
    """Retrieve or create an agent configured for the specified model."""
    installed = get_installed_llms()
    default_m = get_default_model(installed)
    if not model_name or model_name not in installed:
        model_name = default_m

    if model_name not in _agents_cache:
        model_llm = ChatOllama(model=model_name, base_url="http://localhost:11434")
        _agents_cache[model_name] = create_agent(model_llm, tools=tools)

    return _agents_cache[model_name]


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------
@app.route("/", methods=["GET"])
def index():
    installed = get_installed_llms()
    default_m = get_default_model(installed)
    return render_template("index.html", installed_models=installed, default_model=default_m)


@app.route("/api/models", methods=["GET"])
def list_models():
    installed = get_installed_llms()
    default_m = get_default_model(installed)
    return jsonify({
        "models": installed,
        "default": default_m
    })


@app.route("/prompt", methods=["POST"])
def handle_prompt():
    try:
        model_name = None
        if request.is_json:
            data = request.get_json() or {}
            messages_data = data.get("messages", [])
            model_name = data.get("model")
        else:
            prompt = request.form.get("prompt", "")
            model_name = request.form.get("model")
            logging.info(f"Received prompt: {prompt}")
            messages_data = [{"role": "user", "content": prompt}]

        installed_models = get_installed_llms()
        default_model = get_default_model(installed_models)
        if not model_name or model_name not in installed_models:
            model_name = default_model

        agent = get_agent(model_name)

        # Extract the latest user message for memory retrieval / persistence
        latest_user_msg = ""
        for msg in reversed(messages_data):
            if msg.get("role") == "user":
                latest_user_msg = msg.get("content", "")
                break

        # Retrieve relevant memories and build the system prompt
        memories = query_relevant_memories(latest_user_msg) if latest_user_msg else []
        system_content = (
            "You are a very smart, helpful, and friendly AI assistant. "
            "Answer the user's questions clearly and accurately. "
            "You have access to tools: duckduckgo_search_tool (for web search, current news, or real-time info) "
            "and get_current_weather (for weather conditions). "
            "Use tools when current facts or external real-time data are needed. "
            "When using tools, analyze the findings and return the actual facts to the user. "
            "For general questions, coding, explanations, and casual conversation, answer directly."
        )
        if memories:
            context_str = "\n---\n".join(memories)
            system_content += (
                "\n\nHere are relevant details from previous conversations with the user:\n"
                f"{context_str}\n"
                "Use these if they are relevant to the current question."
            )

        # Convert simple dicts to LangChain message objects
        lc_messages = [SystemMessage(content=system_content)]
        for msg in messages_data:
            role = msg.get("role")
            content = msg.get("content", "")
            if role == "user":
                lc_messages.append(HumanMessage(content=content))
            elif role == "assistant":
                lc_messages.append(AIMessage(content=content))
            elif role == "system":
                lc_messages.append(SystemMessage(content=content))

        def generate():
            try:
                yield (json.dumps({"state": "thinking"}) + "\n").encode("utf-8")
                
                final_answer = ""
                for event in agent.stream({"messages": lc_messages}, stream_mode="updates"):
                    if "model" in event:
                        msg = event["model"]["messages"][-1]
                        if hasattr(msg, "tool_calls") and msg.tool_calls:
                            for tc in msg.tool_calls:
                                if tc["name"] == "duckduckgo_search_tool":
                                    yield (json.dumps({"state": "search on the internet"}) + "\n").encode("utf-8")
                                elif tc["name"] == "get_current_weather":
                                    yield (json.dumps({"state": "checking weather"}) + "\n").encode("utf-8")
                                else:
                                    yield (json.dumps({"state": f"using {tc['name']}"}) + "\n").encode("utf-8")
                        else:
                            content = msg.content
                            if isinstance(content, list):
                                final_answer = "".join(part.get("text", "") if isinstance(part, dict) else str(part) for part in content)
                            else:
                                final_answer = str(content or "")

                            yield (json.dumps({"state": "responding"}) + "\n").encode("utf-8")
                            yield (json.dumps({
                                "message": {"content": final_answer},
                                "done": False
                            }) + "\n").encode("utf-8")
                            
                    elif "tools" in event:
                        yield (json.dumps({"state": "processing the findings"}) + "\n").encode("utf-8")

                if latest_user_msg and final_answer:
                    save_memory(latest_user_msg, final_answer)

                yield (json.dumps({
                    "message": {"content": ""},
                    "done": True
                }) + "\n").encode("utf-8")

            except Exception as e:
                logging.exception(f"Error calling agent: {e}")
                yield (json.dumps({
                    "error": f"Error calling agent: {str(e)}",
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


@app.after_request
def add_header(response):
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    return response


if __name__ == "__main__":
    app.run(debug=True, port=5000)

