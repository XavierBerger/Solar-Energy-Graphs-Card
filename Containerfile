FROM docker.io/library/node:26.12.1-alpine3.23

# Chromium renders the Mermaid documentation diagrams (mermaid-cli).
RUN apk add --no-cache chromium font-noto
ENV PUPPETEER_SKIP_DOWNLOAD=1 \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

WORKDIR /workspace/solar-energy-graphs-card

RUN mkdir -p node_modules
