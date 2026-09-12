# ===========================================================================
# Stage 1 – base: shared Python environment
# ===========================================================================
FROM python:3.11-slim AS base

# System packages needed by chromadb / hnswlib at runtime
RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential \
        curl \
    && rm -rf /var/lib/apt/lists/*

# Create a non-root user
RUN useradd --create-home --shell /bin/bash appuser

WORKDIR /app

# Copy and install Python dependencies first (layer-cached separately)
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Give ownership to the non-root user
RUN chown -R appuser:appuser /app

USER appuser


# ===========================================================================
# Stage 2 – test: inherits base, runs Flask in debug mode
# ===========================================================================
FROM base AS test

# Install dev/test extras – extend as needed
RUN pip install --no-cache-dir pytest

# Copy only the files the app actually needs
COPY --chown=appuser:appuser templates/ templates/
COPY --chown=appuser:appuser static/ static/

ENV FLASK_ENV=development
ENV FLASK_DEBUG=1
# Ollama on host; overridable via env file
ENV OLLAMA_HOST=http://host.docker.internal:11434

EXPOSE 5000

CMD ["python", "app.py"]


# ===========================================================================
# Stage 3 – prod: inherits base, runs gunicorn + gevent (SSE-friendly)
# ===========================================================================
FROM base AS prod

RUN pip install --no-cache-dir gunicorn gevent

# Copy only the files the app actually needs
COPY --chown=appuser:appuser app.py gunicorn.conf.py ./
COPY --chown=appuser:appuser templates/ templates/
COPY --chown=appuser:appuser static/ static/

ENV FLASK_ENV=production
ENV FLASK_DEBUG=0
ENV OLLAMA_HOST=http://host.docker.internal:11434

EXPOSE 5000

CMD ["gunicorn", "--config", "gunicorn.conf.py", "app:app"]
