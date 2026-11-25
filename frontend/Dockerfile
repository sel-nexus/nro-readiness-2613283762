FROM node:24.11.1-alpine AS build
USER node
WORKDIR /home/node
RUN mkdir app
WORKDIR /home/node/app
COPY --chown=node:node package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY --chown=node:node . .
RUN npm run build

FROM nginx:1.28.2-alpine
COPY nginx-runtime.conf /etc/nginx/nginx.conf
COPY --from=build /home/node/app/dist/ /usr/share/nginx/html/
COPY nginx.conf /etc/nginx/conf.d/default.conf
USER 101:101
EXPOSE 8080
ENTRYPOINT ["nginx"]
CMD ["-g", "daemon off;"]
