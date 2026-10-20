FROM python:3.12-slim
WORKDIR /app
COPY file-service/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt \
    && groupadd --gid 10001 nla \
    && useradd --uid 10001 --gid nla --no-create-home nla
COPY file-service/*.py ./
COPY file-service/third-party ./third-party
USER 10001:10001
EXPOSE 8011
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8011", "--no-access-log", "--workers", "1"]
