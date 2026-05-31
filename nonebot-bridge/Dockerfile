FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
  PYTHONUNBUFFERED=1 \
  DRIVER=~fastapi+~httpx \
  HOST=0.0.0.0 \
  PORT=8095 \
  BACKEND_API_BASE=http://app:3000/api/v1 \
  HEARTBEAT_INTERVAL_SECONDS=30

WORKDIR /app
COPY pyproject.toml ./
RUN pip install --no-cache-dir .
COPY . .

EXPOSE 8095
CMD ["python", "bot.py"]
