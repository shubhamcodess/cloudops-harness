FROM node:20-alpine
WORKDIR /app
COPY . .
RUN corepack enable && pnpm install && pnpm build
EXPOSE 3000
CMD ["node", "dist/server.js"]
