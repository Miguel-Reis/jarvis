# PalKeeper — daemon de gestão para servidor dedicado de Palworld
# bookworm-slim (glibc): o better-sqlite3 usa binários pré-compilados
# e o tar (GNU) já vem incluído — sem toolchain de compilação na imagem.
FROM node:20-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:20-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:20-bookworm-slim
ENV NODE_ENV=production TZ=Europe/Lisbon
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./

RUN groupadd -r palkeeper && useradd -r -g palkeeper palkeeper \
  && mkdir -p /data && chown palkeeper:palkeeper /data
USER palkeeper

ENV PALKEEPER_CONFIG=/config/config.yaml
VOLUME ["/data"]
EXPOSE 8300

# o daemon trata SIGTERM/SIGINT diretamente (shutdown gracioso)
CMD ["node", "dist/index.js"]
