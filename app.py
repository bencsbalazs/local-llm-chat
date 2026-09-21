from flask import logging
from flask import Flask, request, render_template, jsonify, Response, stream_with_context
import json
import uuid
import chromadb
import ollama as ollama_client
from langchain_ollama import ChatOllama
from langchain.agents import create_agent
from langchain_core.messages import HumanMessage, AIMessage, SystemMessage, AIMessageChunk
from langchain_core.tools import tool
from ddgs import DDGS

import urllib.request
import urllib.parse

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
    response = ollama_client.embeddings(model=EMBED_MODEL, prompt=text)
    return response["embedding"]


def save_memory(user_msg: str, assistant_msg: str):
    """Save a conversation turn to the vector store."""
    content = f"User: {user_msg}\nAssistant: {assistant_msg}"
    embedding = get_embedding(content)
    memory_collection.add(
        documents=[content],
        embeddings=[embedding],
        metadatas=[{"role": "dialogue_turn"}],
        ids=[str(uuid.uuid4())]
    )


def query_relevant_memories(query: str, n_results: int = 3) -> list[str]:
    """Retrieve semantically relevant past conversation turns from ChromaDB."""
    if memory_collection.count() == 0:
        return []
    query_vector = get_embedding(query)
    results = memory_collection.query(
        query_embeddings=[query_vector],
        n_results=min(n_results, memory_collection.count())
    )
    if results and "documents" in results and results["documents"]:
        return results["documents"][0]
    return []


# ---------------------------------------------------------------------------
# Initialize the LLM and tools
# ---------------------------------------------------------------------------
llm = ChatOllama(model="qwen2.5:7b", base_url="http://localhost:11434")


@tool
def duckduckgo_search_tool(query: str) -> str:
    """A search engine. Useful for when you need to answer questions about current events."""
    with DDGS() as ddgs:
        results = list(ddgs.text(query, max_results=5))
        if not results:
            return "No good DuckDuckGo Search Result was found"
        return "\n".join([f"[{r['title']}]({r['href']})\n{r['body']}" for r in results])


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

# Create the ReAct agent
agent = create_agent(llm, tools=tools)


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------
@app.route("/", methods=["GET"])
def index():
    return render_template("index.html")


@app.route("/prompt", methods=["POST"])
def handle_prompt():
    try:
        if request.is_json:
            data = request.get_json()
            messages_data = data.get("messages", [])
        else:
            prompt = request.form.get("prompt", "")
            logging.info(f"Received prompt: {prompt}")
            messages_data = [{"role": "user", "content": prompt}]

        # Extract the latest user message for memory retrieval / persistence
        latest_user_msg = ""
        for msg in reversed(messages_data):
            if msg.get("role") == "user":
                latest_user_msg = msg.get("content", "")
                break

        # Retrieve relevant memories and build the system prompt
        memories = query_relevant_memories(latest_user_msg) if latest_user_msg else []
        system_content = (
            "You are a very smart and helpful AI assistant. "
            "When the user asks for information (e.g. weather, news, facts), you MUST use the "
            "appropriate tool to retrieve the data. Analyze the results and return the ACTUAL DATA "
            "to the user! NEVER say 'you can find it at this link' or 'search for it', instead give "
            "a concrete and precise answer based on the data."
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

        # Collect the full assistant reply so we can persist it after streaming
        full_reply_parts: list[str] = []

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
                            final_answer = msg.content
                            yield (json.dumps({"state": "create the plan"}) + "\n").encode("utf-8")
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
