FROM python:3.12-slim-bookworm@sha256:34386ef0cb081344d7ec1c103ba398e6e9f64e9ab3a1509accc92a4e24a07258
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1
WORKDIR /app
COPY ai-service/requirements.txt ./requirements.txt
COPY ai-service/sdk-requirements.txt ./sdk-requirements.txt
RUN pip install --no-cache-dir -r requirements.txt -r sdk-requirements.txt \
    && groupadd --gid 10001 nla \
    && useradd --uid 10001 --gid nla --no-create-home nla
COPY vendor/upstream/semantic-engine/wren/ /opt/upstream/semantic-sdk/
COPY vendor/upstream/semantic-engine/LICENSE /app/third-party/licenses/semantic-sdk/LICENSE
RUN pip install --no-cache-dir --no-deps /opt/upstream/semantic-sdk
COPY --chown=10001:10001 ai-service/*.py ./
COPY --chown=10001:10001 ai-service/third_party/wren_semantic/ ./third_party/wren_semantic/
COPY --chown=10001:10001 ai-service/third-party/licenses/ /app/third-party/licenses/
COPY --chown=10001:10001 infra/docker/ai-health.py /app/ai-health.py
USER 10001:10001
EXPOSE 8000
ENTRYPOINT ["python", "-m", "uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000", "--no-access-log"]
