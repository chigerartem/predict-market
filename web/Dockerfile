FROM node:22-alpine AS builder
WORKDIR /app
ARG VITE_API_BASE
ENV VITE_API_BASE=$VITE_API_BASE

COPY package.json ./
RUN npm install --legacy-peer-deps

COPY . .
RUN npm run build

FROM nginx:1.27-alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
