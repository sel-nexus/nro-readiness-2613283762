FROM node:24.11.1-alpine AS build
USER node
WORKDIR /home/node
RUN mkdir app
WORKDIR /home/node/app
COPY --chown=node:node package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY --chown=node:node . .
RUN npm run build

FROM nginxinc/nginx-unprivileged:1.28.0-alpine
USER 101
COPY --from=build /home/node/app/dist/ /usr/share/nginx/html/
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 8080
CMD ["nginx", "-g", "daemon off;"]
