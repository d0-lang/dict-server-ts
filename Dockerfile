FROM oven/bun:1.4.4-slim
WORKDIR /app

COPY package.json bun.lock tsconfig.json ./
RUN bun install --frozen-lockfile --production

COPY src ./src

# Dictionaries and the identity key are mounted at /app/data, see compose.yaml.
USER bun
EXPOSE 3000
CMD ["bun", "src/index.ts"]
