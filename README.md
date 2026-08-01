# Local llm chat

> This is a ChatGPT like chat using local LLM.  
> I used Qwen2.5:7b model via Ollama.
> You can get the model by running `ollama run qwen2.5:7b` in your terminal.
> This project is just to use locally LLM without any API key or external service so it is free to use and doesn't require any payment. Also it is more private than using any external LLM.

## Prerequisites

- Ollama installed and running

## Installation

```bash
git clone https://github.com/bencsbalazs/local-llm-chat.git
cd local-llm-chat
Create virtualenv (e.g. python3 -m venv venv)
Activate virtualenv (e.g. source venv/bin/activate on Linux/Mac, venv\Scripts\activate on Windows)
pip install -r requirements.txt
```

## Usage

```bash
python app.py
```

## Future Plans

If you want to help improving this project you can do that via pull requests.
I would be happy to merge them!

Short term plan:

- Add support for other models (via Ollama API) or even via Hugging Face API (if needed) The goal is to select the locally installed models from the dropdown list from the UI.
- Improve the UI with skins.
- On first load, query the saved conversation from the database. It's just a list of message dictionaries with role and content. Find out how can it be more effective.

## Simple Architecture

```

                   ┌───────────────────────────────────────┐
                   │          User Interface               │
                   │       (HTML + CSS + JS)               │
                   │    Flask renders index.html           │
                   │    AJAX requests to /prompt           │
                   └───────────────────────────────────────┘
                                   │
                                   ▼
                        ┌─────────────────────┐
                        │     Flask App       │
                        │   (Python)          │
                        └─────────────────────┘
                                   │
            /prompt (POST) → ┌──────────────────────────────────┐
                             │  Build Ollama API payload        │
                             │  - model: "qwen2.5:7b"           │
                             │  - messages: from UI             │
                             │  - stream: True                  │
                             └──────────────────────────────────┘
                                   │
                                   ▼
                    ┌──────────────────────────────────────────┐
                    │   urllib.request.urlopen                 │
                    │   → http://localhost:11434/api/chat      │
                    │   (Ollama server)                        │
                    └──────────────────────────────────────────┘
                                   │
                                   ▼
            ┌───────────────────────────────────────────────────────┐
            │   Ollama Server receives request, generates response    │
            │   in streaming JSON chunks (ndjson format)            │
            └───────────────────────────────────────────────────────┘
                                   │
                        Stream chunks back → ┌───────────────────────────────┐
                                             │ Flask streams chunks to UI    │
                                             │ using Response + stream_with_context │
                                             └───────────────────────────────┘

```
