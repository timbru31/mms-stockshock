import { readFileSync } from "fs";
import http from "http";
import https from "https";
import type { Socket } from "net";
import type { Logger } from "winston";
import WebSocket from "ws";
import type { CofrProductAggregate } from "../models/api/product-aggregate";
import type { Notifier } from "../models/notifier";
import type { StoreConfiguration } from "../models/stores/config-model";
import { ProductHelper } from "../utils/product-helper";
import { noopPromise, shuffle } from "../utils/utils";

export class WebSocketNotifier implements Notifier {
    private heartBeatPing: NodeJS.Timeout | undefined;
    private readonly logger: Logger;
    private readonly checkOnlineStatus: boolean;
    private readonly checkInAssortment: boolean;
    private readonly productHelper = new ProductHelper();
    private readonly wss: WebSocket.Server | null;
    private readonly fallbackPrice = 0;

    constructor(storeConfig: StoreConfiguration, logger: Logger) {
        this.logger = logger;
        this.checkOnlineStatus = storeConfig.check_online_status ?? false;
        this.checkInAssortment = storeConfig.check_in_assortment ?? true;

        this.wss = this.setupWebSocketServer(storeConfig);
    }

    async notifyAdmin(): Promise<void> {
        await noopPromise();
    }

    async notifyRateLimit(): Promise<void> {
        await noopPromise();
    }

    async notifyCookies(): Promise<void> {
        await noopPromise();
    }

    async notifyStock(item: CofrProductAggregate | undefined): Promise<void> {
        if (!item) {
            return Promise.resolve(undefined);
        }
        const fullAlert = this.productHelper.isProductBuyable(item, this.checkOnlineStatus, this.checkInAssortment);
        if (fullAlert) {
            this.notifyWebSocketClients(item, true);
        } else if (!this.productHelper.canProductBeAddedToBasket(item, this.checkOnlineStatus, this.checkInAssortment)) {
            this.notifyWebSocketClients(item, false);
        }
    }

    async notifyPriceChange(): Promise<void> {
        await noopPromise();
    }

    shutdown(): void {
        this.closeWebSocketServer();
    }

    private setupWebSocketServer(storeConfig: StoreConfiguration): WebSocket.Server | null {
        if (!storeConfig.use_websocket) {
            return null;
        }

        let server: http.Server | https.Server;
        if (storeConfig.websocket_https && storeConfig.websocket_cert_path && storeConfig.websocket_key_path) {
            server = https.createServer({
                cert: readFileSync(storeConfig.websocket_cert_path),
                key: readFileSync(storeConfig.websocket_key_path),
            });
        } else {
            server = http.createServer();
        }
        const wss = new WebSocket.Server({ noServer: true });

        server.on("upgrade", (request: http.IncomingMessage, socket: Socket, head: Buffer) => {
            const password = request.headers["sec-websocket-protocol"];
            if (!password || !storeConfig.websocket_passwords?.includes(password)) {
                this.logger.info(`😵‍💫 WebSocket connection from client from ${socket.remoteAddress ?? ""} was denied!`);
                socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
                socket.destroy();
                return;
            }
            this.logger.info(
                `👌 WebSocket client from ${socket.remoteAddress ?? ""} connected successfully with ${
                    storeConfig.log_passwords ? password : "***"
                }`,
            );
            wss.handleUpgrade(request, socket, head, (ws) => wss.emit("connection", ws, request));
        });

        const defaultPort = 8080;
        server.listen(storeConfig.websocket_port ?? defaultPort);

        const heartbeatInMilliseconds = 30000;
        this.heartBeatPing = setInterval(() => {
            for (const client of wss.clients) {
                if (client.readyState === WebSocket.OPEN) {
                    client.ping();
                    this.logger.info("💖 Sending heartbeat ping to client");
                }
            }
        }, heartbeatInMilliseconds);
        return wss;
    }

    private notifyWebSocketClients(item: CofrProductAggregate, direct: boolean) {
        if (!item.productId) {
            return;
        }
        if (this.wss) {
            for (const client of shuffle(Array.from(this.wss.clients))) {
                if (client.readyState === WebSocket.OPEN) {
                    client.send(
                        JSON.stringify({
                            direct,
                            title: item.cofrCoreFeature?.productName ?? item.productId,
                            id: item.productId,
                            price: item.cofrPriceFeature?.price?.amount ?? this.fallbackPrice,
                        }),
                        (e: unknown) => {
                            if (e) {
                                this.logger.info("😵‍💫 Error sending stock ping, %O", e);
                            }
                        },
                    );
                }

                this.logger.info(
                    `🏓 Sending stock ping to client (${(client as WebSocketExtended)._socket.remoteAddress ?? ""}) with ready state ${
                        client.readyState
                    }`,
                );
            }
        }
    }

    private closeWebSocketServer() {
        if (this.heartBeatPing) {
            clearInterval(this.heartBeatPing);
        }
        this.wss?.close();
    }
}

interface WebSocketExtended extends WebSocket {
    _socket: Socket;
}
