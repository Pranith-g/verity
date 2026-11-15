# One image: the API, with the built web app served from the same port.
FROM node:22-alpine AS web
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    VDC_STATIC_DIR=/app/static \
    VDC_DATABASE_URL=sqlite:////data/vdc.db
WORKDIR /app
COPY backend/pyproject.toml ./
COPY backend/app ./app
RUN pip install --no-cache-dir .
COPY --from=web /web/dist ./static
RUN useradd --system --uid 10001 vdc && mkdir /data && chown vdc /data
USER vdc
VOLUME /data
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=2)"
# One worker on purpose: live benchmark streams and demo auto-runs are kept in this process's memory.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
