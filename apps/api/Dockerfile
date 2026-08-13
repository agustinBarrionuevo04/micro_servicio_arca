# syntax=docker/dockerfile:1.7
#
# Primer Dockerfile del repo (PLAN.md no traía ninguno hasta esta rama,
# `feature/pdf-generation` — no había artefacto de despliegue todavía).
#
# IMPORTANTE — build context: esta imagen se construye desde la RAÍZ del
# monorepo, no desde `apps/api/`, porque pnpm workspace necesita
# `pnpm-workspace.yaml`, `pnpm-lock.yaml` y `patches/` (el patch de
# `@arcasdk/pdf`, ver `apps/api/src/services/pdf/index.ts`), que viven en la
# raíz, no dentro de `apps/api/`:
#
#   docker build -f apps/api/Dockerfile -t arca-billing-api .
#
# Por qué Debian "slim" y no Alpine: Puppeteer descarga un binario de
# Chromium prebuilt para glibc. En Alpine (musl) ese binario no corre —
# hay que instalar el paquete `chromium` del sistema operativo y apuntar
# `PUPPETEER_EXECUTABLE_PATH` a mano, con su propia superficie de
# mantenimiento (parchear CVEs de un Chromium de distro en vez de las
# versiones que valida Puppeteer). Para el primer Dockerfile del repo, se
# prioriza el camino soportado oficialmente por Puppeteer.
#
# Versión de Node: se fija `node:24-slim` para matchear exactamente la
# versión de Node con la que se corrieron el build y los tests de esta rama
# en el sandbox de desarrollo (`node -v` → v24.18.0) — evita el clásico
# "funciona en mi máquina pero no en Docker" por una diferencia de runtime.
#
# Sandbox de Chromium (la pieza más importante de este archivo): el patch
# local `patches/@arcasdk__pdf@0.2.0.patch` hace que Puppeteer lance
# Chromium con `--no-sandbox --disable-setuid-sandbox`. Ese patch existe
# porque el sandbox por setuid/user-namespaces de Chromium falla tanto en el
# sandbox de desarrollo (AppArmor restringiendo unprivileged user
# namespaces) como en contenedores Docker normales, que no corren con
# `--cap-add=SYS_ADMIN` ni con el binario `chrome_sandbox` setuid-root
# (inviable en una imagen mínima). El aislamiento que da el propio
# contenedor reemplaza al sandbox interno de Chromium — trade-off
# documentado y estándar de Puppeteer en Docker
# (https://pptr.dev/troubleshooting#running-puppeteer-in-docker), no un
# descuido de seguridad.

FROM node:24-slim AS base

# Lista de paquetes apt = la lista REAL de dependencias del binario de
# Chromium que Puppeteer descarga para esta versión de `@arcasdk/pdf`
# (confirmada en el sandbox de desarrollo con
# `cat ~/.cache/puppeteer/chrome/*/chrome-linux64/deb.deps`), no una lista
# copiada de un tutorial. Si `puppeteer` sube de versión mayor de Chromium
# en el futuro, regenerar esta lista con el mismo comando después de
# `pnpm install`.
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates \
      fonts-liberation \
      libasound2 \
      libatk-bridge2.0-0 \
      libatk1.0-0 \
      libatspi2.0-0 \
      libcairo2 \
      libcups2 \
      libcurl4 \
      libdbus-1-3 \
      libexpat1 \
      libgbm1 \
      libglib2.0-0 \
      libgtk-3-0 \
      libnspr4 \
      libnss3 \
      libpango-1.0-0 \
      libudev1 \
      libvulkan1 \
      libx11-6 \
      libxcb1 \
      libxcomposite1 \
      libxdamage1 \
      libxext6 \
      libxfixes3 \
      libxkbcommon0 \
      libxrandr2 \
      tini \
      wget \
      xdg-utils \
    && rm -rf /var/lib/apt/lists/*

# pnpm fijo a la misma versión verificada en el sandbox de desarrollo
# (`pnpm -v` → 11.18.0), en vez de "latest" en build time (no reproducible).
RUN npm install -g pnpm@11.18.0

# Chromium se descarga durante `pnpm install` (postinstall de `puppeteer`,
# habilitado vía `allowBuilds.puppeteer: true` en `pnpm-workspace.yaml`) acá,
# a una ruta fija, en vez del default `$HOME/.cache/puppeteer` — así el
# stage de runtime puede copiar el cache sin depender de qué usuario/HOME
# corrió el install en el stage anterior.
ENV PUPPETEER_CACHE_DIR=/opt/puppeteer-cache

################################################################################
# deps: instala TODAS las dependencias (incluye devDependencies — hace
# falta `typescript` para el build de abajo). Se copian los `package.json`
# de TODOS los workspaces (`apps/api` y `apps/pwa`), no solo el de esta
# imagen, porque `pnpm install --frozen-lockfile` valida que el lockfile
# matchee el set completo de importers de `pnpm-workspace.yaml`
# (`packages: ['apps/*']`) — omitir `apps/pwa/package.json` rompería esa
# validación aunque esta imagen no empaquete la PWA.
FROM base AS deps
WORKDIR /app
COPY pnpm-workspace.yaml pnpm-lock.yaml ./
COPY patches ./patches
COPY apps/api/package.json apps/api/package.json
COPY apps/pwa/package.json apps/pwa/package.json
RUN pnpm install --frozen-lockfile

################################################################################
# prod-deps: mismo instalo pero solo dependencias de producción, en un stage
# aparte, para que la imagen final no cargue `typescript`/`vitest`/
# `drizzle-kit`/`testcontainers` (~cientos de MB de devDependencies que
# nunca se ejecutan en runtime). Se paga el costo de bajar Chromium dos
# veces en el build (acá y en `deps`) a cambio de una imagen final más chica
# — trade-off razonable para el "Dockerfile mínimo" que pide PLAN.md.
FROM base AS prod-deps
WORKDIR /app
COPY pnpm-workspace.yaml pnpm-lock.yaml ./
COPY patches ./patches
COPY apps/api/package.json apps/api/package.json
COPY apps/pwa/package.json apps/pwa/package.json
RUN pnpm install --frozen-lockfile --prod

################################################################################
# build: compila TypeScript → `dist/` usando las devDependencies de `deps`.
FROM deps AS build
COPY apps/api apps/api
RUN pnpm --filter arca-billing-api build

################################################################################
# runtime: imagen final. Solo `dist/`, `node_modules` de producción, y el
# cache de Chromium ya descargado — nada de código fuente, tests, ni
# devDependencies.
FROM base AS runtime
ENV NODE_ENV=production
WORKDIR /app/apps/api

# `node` (uid 1000) ya existe en la imagen oficial de Node — se reusa en vez
# de crear un usuario nuevo. Correr como no-root acá no soluciona el
# problema de sandbox de Chromium (eso ya lo resuelve `--no-sandbox` vía el
# patch, ver arriba) pero limita el blast radius si algún día este servicio
# renderizara HTML no confiable — hoy no lo hace (`@arcasdk/pdf` arma el
# HTML desde datos propios de la factura), pero no cuesta nada.
COPY --from=prod-deps --chown=node:node /opt/puppeteer-cache /opt/puppeteer-cache
COPY --from=prod-deps --chown=node:node /app/node_modules /app/node_modules
COPY --from=prod-deps --chown=node:node /app/apps/api/node_modules /app/apps/api/node_modules
COPY --from=build --chown=node:node /app/apps/api/dist ./dist
COPY --chown=node:node apps/api/package.json ./package.json

USER node
EXPOSE 3000

# `tini` como PID 1: Chromium deja procesos hijo/zombies si el proceso init
# del contenedor no los reaparenta y cosecha correctamente — problema
# conocido de Puppeteer en Docker, no específico de este servicio.
ENTRYPOINT ["tini", "--"]
CMD ["node", "dist/index.js"]
