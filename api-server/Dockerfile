# Production image for the Nail Salon POS API.
# Works on Railway, Render, Fly.io, or any container host.
FROM node:20-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build        # compiles TypeScript -> dist/

FROM node:20-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
# Compiled server + runtime assets the app reads at run time.
COPY --from=build /app/dist ./dist
COPY db ./db
COPY scripts ./scripts
# The host sets PORT; the server binds to it (default 4000).
EXPOSE 4000
CMD ["node", "dist/server.js"]
