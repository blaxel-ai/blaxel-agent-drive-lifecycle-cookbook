FROM node:22-alpine@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32

COPY --from=ghcr.io/blaxel-ai/sandbox@sha256:17c2840e7edf02cd0c3444efcaf234f191a36ede5b0d55b166b84b7ce5e3f3e8 /sandbox-api /usr/local/bin/sandbox-api

RUN apk add --no-cache ca-certificates curl git jq python3 \
  && addgroup -S agent \
  && adduser -S -G agent agent \
  && mkdir -p /workspace /opt/agent \
  && chown -R agent:agent /workspace /opt/agent

COPY --chown=agent:agent run-analysis.py /opt/agent/run-analysis.py
COPY entrypoint.sh /entrypoint.sh

RUN chmod 0755 /entrypoint.sh /opt/agent/run-analysis.py

WORKDIR /workspace
ENV HOME=/home/agent
ENTRYPOINT ["/entrypoint.sh"]
