# PollSlide deck converter — CLOUD FALLBACK image.
# Same server.py as the Mac primary, but converts with LibreOffice (headless).
# Deploy to Fly.io / Railway / any container host, then set on Vercel:
#   CONVERT_FALLBACK_URL = https://<your-app-host>
#   CONVERT_FALLBACK_KEY = <same value as CONVERT_KEY below>
FROM python:3.12-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    libreoffice-impress \
    fonts-liberation fonts-dejavu fonts-noto-cjk \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY server.py .

ENV PORT=8080
EXPOSE 8080
CMD ["python3", "server.py"]
