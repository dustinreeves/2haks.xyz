FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /srv
COPY requirements.txt .
RUN pip install -r requirements.txt

COPY app ./app
# uid 10001 owns /opt/apps/portal/data on the host (the SQLite database lives there).
RUN useradd --system --uid 10001 --no-create-home portal
USER 10001

EXPOSE 8000
# Keep idle connections open longer than Caddy does (2 min). Otherwise Caddy can reuse a
# connection uvicorn already closed, and a POST fails with a 502 (Caddy won't retry POSTs).
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--no-server-header", "--timeout-keep-alive", "130"]
