FROM node:22-slim

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY cloud_simulator ./cloud_simulator

ENV NODE_ENV=production
CMD ["node", "cloud_simulator/src/run_tick_with_holdings.js"]
