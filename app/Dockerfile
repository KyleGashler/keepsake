FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --no-audit --no-fund

COPY . .

ENV EXPO_NO_TELEMETRY=1
# Metro's file watcher needs polling to see changes through a bind mount.
ENV WATCHPACK_POLLING=true
ENV CHOKIDAR_USEPOLLING=true
EXPOSE 8081

CMD ["npx", "expo", "start", "--web", "--port", "8081"]
