# Stage 1: Build the Vue client
FROM node:24-alpine AS build

WORKDIR /app

# Install root dependencies
COPY package.json package-lock.json ./
RUN npm ci

# Install client dependencies and build
COPY client/package.json client/package-lock.json ./client/
RUN npm ci --prefix client
COPY client/ ./client/
RUN npm run build:client

# Stage 2: Production image
FROM node:24-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server/ ./server/
COPY --from=build /app/client/dist ./client/dist

# Create data directory for persistent token storage
RUN mkdir -p /app/data

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

CMD ["node", "server/index.js"]
