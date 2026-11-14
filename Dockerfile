FROM oven/bun:1.4.4-slim
WORKDIR /app

# Every workspace's package.json, so the lockfile matches.
COPY package.json bun.lock tsconfig.json ./
COPY packages/core/package.json packages/core/
COPY apps/importer/package.json apps/importer/
COPY apps/server/package.json apps/server/
RUN bun install --frozen-lockfile --production

COPY packages/core/src packages/core/src
COPY apps/server/src apps/server/src
# Each language's settings, read at startup (grammar files are the importer's).
COPY languages languages
# The privacy policy and terms hashed into the metadata (PRIVACY_FILE, TOS_FILE).
# Fill them in before building, or mount your own and point the settings at them.
COPY legal legal

# Dictionaries and the identity key are mounted at /app/data, see compose.yaml.
USER bun
EXPOSE 3000
CMD ["bun", "apps/server/src/index.ts"]
