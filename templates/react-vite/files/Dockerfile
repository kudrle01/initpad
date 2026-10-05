# Build the static bundle, then serve it with nginx.
FROM node:26.10.0-alpine3.24@sha256:0b36e8c136b94cd4fcf02188228e76c31ad5872eef3fec8cbd2eee500cfd9e80 AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm test && npm run build

FROM nginxinc/nginx-unprivileged:1.31.6-alpine3.24@sha256:26b0bf6fbf07297983cb341998d79c831508787de26627dd2a112321b9c3a4af
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 8080
