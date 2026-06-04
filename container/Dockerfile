FROM node:22-alpine

WORKDIR /app

RUN apk add --no-cache ffmpeg unzip

COPY package.json .
RUN npm install --omit=dev

COPY server.mjs .

EXPOSE 8080

CMD ["npm", "run", "start"]
