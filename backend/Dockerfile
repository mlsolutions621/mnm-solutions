FROM python:3.10-slim

# Install Chromium + Driver + Utils
RUN apt-get update && apt-get install -y \
    chromium \
    chromium-driver \
    fonts-liberation \
    fonts-ipafont-gothic \
    wget \
    curl \
    && rm -rf /var/lib/apt/lists/*

# VERIFY INSTALL — This will FAIL BUILD if not found (good for debugging)
RUN which chromium && chromium --version
RUN which chromedriver && chromedriver --version

# Set critical environment variables
ENV CHROME_BIN=/usr/bin/chromium
ENV CHROMEDRIVER_PATH=/usr/bin/chromedriver
ENV PYTHONUNBUFFERED=1
ENV TZ=UTC
ENV SELENIUM_BROWSER=chromium  # 👈 Disable Selenium Manager auto-download

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 10000

CMD ["python", "server.py"]
