FROM python:3.14-slim

WORKDIR /srv
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1

COPY pyproject.toml README.md ./
COPY app ./app
COPY worker ./worker
RUN pip install --no-cache-dir .

# run as an unprivileged user, the container never needs root after install
RUN useradd --system --uid 10001 melophos
USER melophos

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
