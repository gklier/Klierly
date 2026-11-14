# Klierly worker: file parsing + numerical validation.
# Multi-arch friendly: every dependency ships manylinux wheels for amd64 and arm64.
FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

RUN groupadd --system --gid 10001 worker \
 && useradd --system --uid 10001 --gid worker --home-dir /app --shell /usr/sbin/nologin worker

WORKDIR /app
COPY requirements.txt ./
RUN pip install -r requirements.txt

COPY app ./app

USER worker
EXPOSE 8001

# WORKER_TOKEN must be supplied at runtime; MAX_UPLOAD_MB defaults to 25.
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD ["python", "-c", "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8001/health', timeout=2).status == 200 else 1)"]

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8001", "--no-access-log"]
