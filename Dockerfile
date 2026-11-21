# The site plus the play-together server. No dependencies to install.
FROM node:22-alpine
WORKDIR /app
COPY server.mjs config.json ./
COPY docs ./docs
ENV PORT=8080
EXPOSE 8080
CMD ["node", "server.mjs"]
