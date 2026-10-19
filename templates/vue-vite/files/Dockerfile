# Build the static bundle, then serve it with nginx.
FROM node:26.12.0-alpine3.24@sha256:6f08a523443ddedf52941874c203475b0ad503e859ad70cb26ab8be9a517dbd5 AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm test && npm run build

FROM nginxinc/nginx-unprivileged:1.31.6-alpine3.24@sha256:884e0b7f42f303641b0f4e78755aea647521dca0b89ca3be7992ad78b5c07434
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 8080
