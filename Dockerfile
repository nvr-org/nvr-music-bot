FROM node:20-slim

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY index.js bot.js ./

EXPOSE 8080

CMD ["node", "index.js"]
