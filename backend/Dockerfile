FROM maven:3.9-eclipse-temurin-21@sha256:99e61abcff91a9b1333463bd8451fb18495d6eba9250ac66a338b518f8278320 AS build
WORKDIR /build/backend
COPY backend/pom.xml ./
COPY backend/src ./src
COPY infra/docker/HttpHealth.java /build/health/HttpHealth.java
RUN --mount=type=cache,target=/root/.m2 mvn -B -q -DskipTests package \
    && javac -d /build/health /build/health/HttpHealth.java

FROM eclipse-temurin:21-jre-noble@sha256:35501d3f93173b420ac9001658eb68157e813316b865087e345c187fca422c4c
WORKDIR /app
RUN groupadd --gid 10001 nla \
    && useradd --uid 10001 --gid nla --no-create-home nla
COPY --from=build --chown=10001:10001 /build/backend/target/analytics-backend-1.0.0.jar /app/backend.jar
COPY --from=build --chown=10001:10001 /build/health/HttpHealth.class /app/health/HttpHealth.class
USER 10001:10001
EXPOSE 8080
ENTRYPOINT ["java", "-XX:MaxRAMPercentage=70", "-jar", "/app/backend.jar"]
