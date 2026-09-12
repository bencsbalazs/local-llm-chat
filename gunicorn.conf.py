import multiprocessing

# Bind
bind = "0.0.0.0:5000"

# Workers: gevent is async-friendly and keeps SSE connections alive
worker_class = "gevent"
workers = multiprocessing.cpu_count() * 2 + 1
worker_connections = 1000

# Timeouts – set high so long Ollama responses don't get cut off
timeout = 300
keepalive = 5

# Logging
accesslog = "-"
errorlog = "-"
loglevel = "info"

# Preload the app to share ChromaDB client across workers
preload_app = True
