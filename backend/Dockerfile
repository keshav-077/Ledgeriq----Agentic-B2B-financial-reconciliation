FROM python:3.12-bookworm

WORKDIR /app

COPY requirements.txt .
RUN apt-get update && apt-get install -y graphviz libgomp1 && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

RUN python -c "import sys, os, traceback; os.chdir('/app'); print('Testing...'); \
exec('try:\\n    import main\\n    print(\"main OK:\", main.app.title)\\nexcept SystemExit as e:\\n    print(\"SystemExit:\", e.code)\\nexcept Exception as e:\\n    traceback.print_exc()')" 2>&1 || true

ENV PYTHONUNBUFFERED=1
ENV PORT=8080

EXPOSE 8080

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8080"]