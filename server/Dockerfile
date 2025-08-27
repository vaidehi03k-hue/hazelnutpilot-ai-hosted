# Playwright image that matches our npm deps
FROM mcr.microsoft.com/playwright:v1.55.0-jammy

WORKDIR /app

# Copy package files, install deps
COPY package*.json ./
RUN npm ci || npm install --omit=dev

# Ensure browsers for this exact version are installed
RUN npx playwright install --with-deps

# Copy source
COPY . .

# Cloud-friendly defaults
ENV NODE_ENV=production \
    PORT=4000 \
    XDG_CACHE_HOME=/tmp/.cache

EXPOSE 4000
CMD ["node", "index.js"]
