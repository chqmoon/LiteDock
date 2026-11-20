FROM python:3.12-alpine

LABEL org.opencontainers.image.title="LiteDock" \
      org.opencontainers.image.version="1.0.31" \
      org.opencontainers.image.description="Pure Docker container dashboard"

ENV PYTHONUNBUFFERED=1 \
    PORT=8000 \
    DATA_DIR=/app/data \
    DOCKER_SOCK=/var/run/docker.sock \
    ACCESS_PASSWORD= \
    TZ=Asia/Shanghai

WORKDIR /app
COPY app/ /app/

RUN mkdir -p /app/data/uploads/wallpaper /app/data/uploads/icon /app/data/uploads/card \
 && python -m compileall -q /app/server.py

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=8s --start-period=20s --retries=3 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/api/health',timeout=6).status==200 else 1)"

CMD ["python", "/app/server.py"]
