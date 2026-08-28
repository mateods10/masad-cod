FROM node:22-alpine

RUN apk add --no-cache openssl && corepack enable

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm prisma generate && pnpm build

EXPOSE 3000
CMD ["pnpm", "docker-start"]
