FROM --platform=$BUILDPLATFORM golang:1.27.0-alpine@sha256:4c9fe60190a2a3350ddc51de80d0224b8a6698d12bdfc999fee45ea9d6c46dbc AS build
WORKDIR /build/data-tool-runtime
COPY vendor/upstream/data-tool-platform/ /build/vendor/upstream/data-tool-platform/
COPY data-tool-runtime/go.mod data-tool-runtime/go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod go mod download
COPY data-tool-runtime/*.go ./
ARG TARGETOS
ARG TARGETARCH
RUN --mount=type=cache,target=/go/pkg/mod --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH go build -trimpath -ldflags='-s -w' -o /out/data-tool-runtime .

FROM gcr.io/distroless/static-debian12:nonroot@sha256:afa5c872c891853ca7fcf1f12c3edb23f7eeef36189728842dd51042ff57f7ab
COPY --from=build /out/data-tool-runtime /app/data-tool-runtime
COPY data-tool-runtime/LICENSE data-tool-runtime/NOTICE.md /app/licenses/data-tool-runtime/
USER 65532:65532
EXPOSE 8090
ENTRYPOINT ["/app/data-tool-runtime"]
