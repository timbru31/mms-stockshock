FROM timbru31/node-chrome:gallium-alpine

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser \
    NODE_ENV=production

RUN mkdir -p /opt/mms-stockshock \
    && adduser -D stonks \
    && chown -R stonks:stonks /opt/mms-stockshock

COPY package*.json /opt/mms-stockshock/
COPY dist /opt/mms-stockshock/dist
COPY tsconfig.json /opt/mms-stockshock

USER stonks
WORKDIR /opt/mms-stockshock

RUN npm install
EXPOSE 8080
CMD ["sh", "-c", "node --unhandled-rejections=strict dist/src/index.js --store ${STORE} --sandbox false --shmUsage false"]
