FROM timbru31/node-chrome:alpine

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

ARG STORE
ENV STORE ${STORE}

RUN mkdir -p /opt/mms-stockshock \
    && adduser -D stonks \
    && chown -R stonks:stonks /opt/mms-stockshock

COPY package*.json /opt/mms-stockshock
COPY src /opt/mms-stockshock/src
COPY tsconfig.json /opt/mms-stockshock

USER stonks
WORKDIR /opt/mms-stockshock

RUN npm install
CMD ["npm", "start", "--", "--store", "$STORE", "--sandbox", "false"]
