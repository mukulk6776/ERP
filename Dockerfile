FROM node:24-bookworm-slim
ENV NODE_ENV=production PORT=3000 ERP_HOST=0.0.0.0 ERP_DATA_DIR=/app/data
WORKDIR /app
COPY --chown=node:node package.json server.js auth.js school.js extensions.js demo.js ./
COPY --chown=node:node public ./public
COPY --chown=node:node tools ./tools
RUN mkdir -p /app/data && chown node:node /app/data
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
