FROM python:3.12-slim

WORKDIR /app
ENV PYTHONUNBUFFERED=1

# Timezone data so token times match the clinic's local time (set with TZ)
RUN apt-get update && apt-get install -y --no-install-recommends tzdata && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 5000
# Create tables + default logins (and demo history), then start the API
CMD ["sh", "-c", "python seed.py --demo && python app.py"]
