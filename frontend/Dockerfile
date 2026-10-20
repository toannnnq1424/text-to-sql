FROM node:22-alpine3.23@sha256:baf676f7d0e552f3231945c2f979055ca121bce128c152f7a34e6bd1728b1c5a AS build
WORKDIR /build/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
COPY docs/contracts/examples/ /build/docs/contracts/examples/
ARG OIDC_AUTHORITY=http://127.0.0.1:8180/realms/nla
ARG OIDC_CLIENT_ID=nla-web
ARG OIDC_ALLOW_HTTP_LOOPBACK=false
ENV VITE_API_BASE_URL=/api/v1 \
    VITE_OIDC_AUTHORITY=$OIDC_AUTHORITY \
    VITE_OIDC_CLIENT_ID=$OIDC_CLIENT_ID \
    VITE_OIDC_ALLOW_HTTP_LOOPBACK=$OIDC_ALLOW_HTTP_LOOPBACK \
    VITE_OIDC_SCOPE="openid profile email" \
    VITE_OIDC_ROLE_CLAIM=roles \
    VITE_ALLOW_ANONYMOUS_DEV=false \
    VITE_LOCAL_AUTH=false
RUN npm run build

FROM nginxinc/nginx-unprivileged:stable-alpine@sha256:f5116ed4606f3eb015dd4a8e28cb9b351476dc0ad4bc6e9f93b19cec130cdf03
COPY infra/docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /build/frontend/dist/ /usr/share/nginx/html/
USER 101:101
EXPOSE 8080
