FROM node:22-alpine
WORKDIR /app
COPY server/package.json server/package-lock.json* ./server/
RUN cd server && npm ci --omit=dev
COPY shared ./shared
COPY server ./server
ENV PORT=8788 POLYRANKED_DATA_DIR=/app/data
EXPOSE 8788
VOLUME ["/app/data"]
WORKDIR /app/server
CMD ["node", "src/index.js"]
