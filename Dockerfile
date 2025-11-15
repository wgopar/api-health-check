FROM oven/bun:1 AS base

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --ci --no-progress

COPY . .

ENV NODE_ENV=production
EXPOSE 8787

CMD ["bun", "run", "src/index.ts"]
