FROM python:3.15-slim@sha256:94d3426f1def7db4a106a232ac121bfd975393e5dfd40a619b955fae45fe7913 AS base
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY . .

FROM base AS test
RUN python -m unittest discover -s tests

FROM base AS runtime
RUN useradd --system --uid 10001 app && chown -R app:app /app
USER app
EXPOSE 8000
# --preload imports the settings once, so all workers share one generated
# SECRET_KEY when no persistent key is configured.
CMD ["gunicorn", "--preload", "config.wsgi:application", "-b", "0.0.0.0:8000"]
