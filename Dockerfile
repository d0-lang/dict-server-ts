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
# The templates, the default legal documents with INCLUDE_LEGAL=true. Mount
# your filled-in copies and point PRIVACY_FILE and TOS_FILE at them.
COPY legal legal

# The release this image is, so self-host/compose.yaml fetches its dictionaries.
ARG VERSION=""
ENV DICT_RELEASE=$VERSION

# Dictionaries are mounted at /app/data, see compose.yaml. Created here so a named
# volume mounted on them starts out writable by bun.
RUN mkdir -p /app/data /app/identity && chown bun:bun /app/data /app/identity
USER bun
EXPOSE 3000
CMD ["bun", "apps/server/src/index.ts"]
