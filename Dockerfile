FROM node:24.10.0-bookworm-slim AS web

WORKDIR /build/product-studio
RUN corepack enable
COPY product-studio/package.json product-studio/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY product-studio/ ./
RUN pnpm build && pnpm prune --prod

FROM ghcr.io/astral-sh/uv:0.8.15 AS uv

FROM python:3.11-slim-bookworm AS python-build

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    PYTHONUTF8=1 \
    UV_LINK_MODE=copy \
    UV_CONCURRENT_DOWNLOADS=4 \
    UV_CONCURRENT_INSTALLS=4 \
    UV_CONCURRENT_BUILDS=2 \
    PATH=/opt/venv/bin:${PATH}

COPY --from=uv /uv /uvx /usr/local/bin/

WORKDIR /app
COPY . /app

RUN --mount=type=cache,target=/root/.cache/uv \
    uv venv --python /usr/local/bin/python /opt/venv \
    && uv sync --active --frozen --no-dev

RUN --mount=type=cache,target=/root/.cache/uv \
    uv venv --python /usr/local/bin/python /opt/voice-venv \
    && uv pip install --python /opt/voice-venv/bin/python \
      torch==2.8.0+cu128 torchaudio==2.8.0+cu128 \
      --index-url https://download.pytorch.org/whl/cu128

RUN --mount=type=cache,target=/root/.cache/uv \
    uv pip install --python /opt/voice-venv/bin/python \
      qwen-tts==0.1.1 huggingface-hub \
      librosa==0.10.2.post1 llvmlite==0.46.0 numba==0.63.0 numpy==2.2.6 \
      scipy==1.16.2 soundfile==0.13.1 soxr==1.0.0

FROM python:3.11-slim-bookworm

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    PYTHONUTF8=1 \
    PATH=/app/.venv/bin:/usr/local/bin:${PATH} \
    INDEXTTS_PYTHON=/app/.venv/bin/python \
    INDEXTTS_VOICE_PYTHON=/opt/voice-venv/bin/python \
    HOST=0.0.0.0 \
    PORT=7864

RUN apt-get update && apt-get install -y --no-install-recommends \
      libgl1 libglib2.0-0 sox \
    && rm -rf /var/lib/apt/lists/*

COPY --from=web /usr/local/ /usr/local/
COPY --from=python-build /opt/voice-venv /opt/voice-venv
COPY --from=python-build /app /app
COPY --from=web /build/product-studio/dist /app/product-studio/dist
COPY --from=web /build/product-studio/node_modules /app/product-studio/node_modules

WORKDIR /app
RUN ln -sfn /usr/local/bin/python3.11 /app/.venv/bin/python \
    && /app/.venv/bin/python -c "import sys; assert sys.prefix == '/app/.venv', sys.prefix" \
    && npm install --global ffmpeg-static@5.2.0 \
    && ln -sf /usr/local/lib/node_modules/ffmpeg-static/ffmpeg /usr/local/bin/ffmpeg \
    && ffmpeg -version >/dev/null \
    && sox --version >/dev/null \
    && chmod +x /app/scripts/docker-entrypoint.sh \
    && mkdir -p /app/checkpoints /app/outputs /app/runtime-output /app/artifacts

EXPOSE 7864
VOLUME ["/app/checkpoints", "/app/outputs", "/app/runtime-output", "/app/artifacts"]

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:7864/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

ENTRYPOINT ["/app/scripts/docker-entrypoint.sh"]
CMD ["node", "product-studio/server/index.mjs"]
