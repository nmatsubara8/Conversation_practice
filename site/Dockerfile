FROM node:22-alpine
WORKDIR /app
COPY --chmod=644 index.html island.js speech.js style.css server.mjs characters.mjs ./
ENV OLLAMA_URL=http://127.0.0.1:11434 OLLAMA_MODEL=qwen3:14b STT_URL=http://127.0.0.1:11435 PORT=80
USER node
EXPOSE 80
CMD ["node", "server.mjs"]
