import { IncomingWebhook, IncomingWebhookHTTPError } from "@slack/webhook";
import { AxiosError } from "axios";
import { Logger } from "winston";
import { Item } from "./models/api/item";
import { Product } from "./models/api/product";
import { StoreConfiguration } from "./models/stores/config-model";
import { Store } from "./models/stores/store";
import { ProductHelper } from "./product-helper";
import WebSocket from "ws";
import http from "http";
import https from "https";
import { readFileSync } from "fs";

export class Notifier {
    private readonly stockWebhook: IncomingWebhook | undefined;
    private readonly cookieWebhook: IncomingWebhook | undefined;
    private readonly adminWebhook: IncomingWebhook | undefined;
    private readonly stockWebhookRolePing: string | undefined;
    private readonly cookieWebhookRolePing: string | undefined;
    private readonly adminWebhookRolePing: string | undefined;
    private readonly announceCookies: boolean = true;
    private readonly store: Store;
    private readonly logger: Logger;
    private readonly productHelper = new ProductHelper();
    private readonly wss: WebSocket.Server | null;

    constructor(store: Store, storeConfig: StoreConfiguration, logger: Logger) {
        this.store = store;
        if (storeConfig?.stock_webhook_url || storeConfig?.webhook_url) {
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            this.stockWebhook = new IncomingWebhook((storeConfig?.stock_webhook_url || storeConfig?.webhook_url)!);
        }
        if (storeConfig?.stock_webhook_role_ping || storeConfig?.webhook_role_ping) {
            this.stockWebhookRolePing = storeConfig?.stock_webhook_role_ping || storeConfig?.webhook_role_ping;
        }

        if (storeConfig?.cookie_webhook_url || storeConfig?.webhook_url) {
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            this.cookieWebhook = new IncomingWebhook((storeConfig?.cookie_webhook_url || storeConfig?.webhook_url)!);
        }
        if (storeConfig?.cookie_webhook_role_ping || storeConfig?.webhook_role_ping) {
            this.cookieWebhookRolePing = storeConfig?.cookie_webhook_role_ping || storeConfig?.webhook_role_ping;
        }

        if (storeConfig?.admin_webhook_url || storeConfig?.webhook_url) {
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            this.adminWebhook = new IncomingWebhook((storeConfig?.admin_webhook_url || storeConfig?.webhook_url)!);
        }
        if (storeConfig?.admin_webhook_role_ping || storeConfig?.webhook_role_ping) {
            this.adminWebhookRolePing = storeConfig?.admin_webhook_role_ping || storeConfig?.webhook_role_ping;
        }

        this.announceCookies = storeConfig.announce_cookies ?? true;

        this.logger = logger;
        this.wss = this.setupWebSocketServer(storeConfig);
    }

    setupWebSocketServer(storeConfig: StoreConfiguration): WebSocket.Server | null {
        if (!storeConfig.use_websocket) {
            return null;
        }

        let server: http.Server | https.Server;
        if (storeConfig.websocket_https) {
            server = https.createServer({
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                cert: readFileSync(storeConfig.websocket_cert_path!),
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                key: readFileSync(storeConfig.websocket_key_path!),
            });
        } else {
            server = http.createServer();
        }
        const wss = new WebSocket.Server({ noServer: true });

        server.on("upgrade", (request, socket, head) => {
            if (request.headers["sec-websocket-protocol"] !== storeConfig.websocket_password) {
                socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
                socket.destroy();
                this.logger.info(`😵‍💫 WebSocket connection from client from ${socket?.remoteAddress} was denied!`);
                return;
            }
            this.logger.info(`👌 WebSocket client from ${socket?.remoteAddress} connected successfully`);
            wss.handleUpgrade(request, socket, head, (ws) => wss.emit("connection", ws, request));
        });

        server.listen(storeConfig.websocket_port ?? 8080);
        return wss;
    }

    closeWebSocketServer(): void {
        this.wss?.close();
    }

    async notifyAdmin(message: string): Promise<void> {
        if (this.adminWebhook) {
            const decoratedMessage = this.decorateMessageWithRoles(message, this.adminWebhookRolePing);
            try {
                await this.adminWebhook.send({
                    text: decoratedMessage,
                    username: `Bender 🤖`,
                });
            } catch (e) {
                this.logger.error("Error sending webook, error code" + (e as IncomingWebhookHTTPError).code);
                if (((e as IncomingWebhookHTTPError).original as AxiosError)?.response?.data) {
                    this.logger.error("Discord error data, %O", ((e as IncomingWebhookHTTPError).original as AxiosError)?.response?.data);
                }
                if (((e as IncomingWebhookHTTPError).original as AxiosError)?.response?.headers) {
                    this.logger.error(
                        "HTTP error headers, %O",
                        ((e as IncomingWebhookHTTPError).original as AxiosError)?.response?.headers
                    );
                }
            }
        }
    }

    async notifyRateLimit(seconds: number): Promise<void> {
        if (this.adminWebhook && seconds > 300) {
            const message = this.decorateMessageWithRoles(
                `💤 [${this.store.getName()}] Too many requests, we need to pause ${(seconds / 60).toFixed(2)} minutes... 😴`,
                this.adminWebhookRolePing
            );
            try {
                await this.adminWebhook.send({
                    text: message,
                    username: `Stock Shock 💤`,
                });
            } catch (e) {
                this.logger.error("Error sending webook, error code" + (e as IncomingWebhookHTTPError).code);
                if (((e as IncomingWebhookHTTPError).original as AxiosError)?.response?.data) {
                    this.logger.error("Discord error data, %O", ((e as IncomingWebhookHTTPError).original as AxiosError)?.response?.data);
                }
                if (((e as IncomingWebhookHTTPError).original as AxiosError)?.response?.headers) {
                    this.logger.error(
                        "HTTP error headers, %O",
                        ((e as IncomingWebhookHTTPError).original as AxiosError)?.response?.headers
                    );
                }
            }
        }
    }

    async notifyCookies(product: Product, cookies: string[]): Promise<void> {
        let rawMessage = `🍪 ${cookies.length} basket cookies were made for **${product?.id}**, **${
            product?.title
        }** for ${this.store.getName()}`;
        if (this.announceCookies) {
            rawMessage += `:\n\`${cookies.map((cookie) => `${this.store.baseUrl}?cookie=${cookie}`).join("\n")}\`\n`;
        }
        const message = this.decorateMessageWithRoles(rawMessage, this.cookieWebhookRolePing);
        if (this.cookieWebhook) {
            try {
                await this.cookieWebhook.send({
                    text: message,
                    username: "Cookie Monster 🍪 (light)",
                });
            } catch (e) {
                this.logger.error("Error sending webook, error code" + (e as IncomingWebhookHTTPError).code);
                if (((e as IncomingWebhookHTTPError).original as AxiosError)?.response?.data) {
                    this.logger.error("Discord error data, %O", ((e as IncomingWebhookHTTPError).original as AxiosError)?.response?.data);
                }
                if (((e as IncomingWebhookHTTPError).original as AxiosError)?.response?.headers) {
                    this.logger.error(
                        "HTTP error headers, %O",
                        ((e as IncomingWebhookHTTPError).original as AxiosError)?.response?.headers
                    );
                }
            }
        }
    }

    async notifyStock(item: Item): Promise<string> {
        let message;
        const fullAlert = this.productHelper.isProductBuyable(item);
        if (fullAlert) {
            message = this.decorateMessageWithRoles(
                `🟢 Item **available**: ${item?.product?.id}, ${item?.product?.title} for ${item?.price?.price} ${
                    item?.price?.currency
                }! Go check it out: ${this.store.baseUrl}${this.productHelper.getProductURL(item)}?magician=${item?.product?.id}`,
                this.stockWebhookRolePing
            );
            if (this.wss) {
                for (const client of this.wss.clients) {
                    if (client.readyState === WebSocket.OPEN) {
                        client.send(
                            JSON.stringify({
                                direct: true,
                                title: item.product.title,
                                id: item.product.id,
                            })
                        );
                    }
                }
            }
        } else if (this.productHelper.canProductBeAddedToBasket(item)) {
            message = this.decorateMessageWithRoles(
                `🛒 Item **can be added to basket**: ${item?.product?.id}, ${item?.product?.title} for ${item?.price?.price} ${
                    item?.price?.currency
                }! Go check it out: ${this.store.baseUrl}${this.productHelper.getProductURL(item)}?magician=${item?.product?.id}`,
                this.stockWebhookRolePing
            );
        } else {
            message = this.decorateMessageWithRoles(
                `🟡 Item for **basket parker**: ${item?.product?.id}, ${item?.product?.title} for ${item?.price?.price} ${
                    item?.price?.currency
                }! Go check it out: ${this.store.baseUrl}${this.productHelper.getProductURL(item)}`,
                this.stockWebhookRolePing
            );
            if (this.wss) {
                for (const client of this.wss.clients) {
                    if (client.readyState === WebSocket.OPEN) {
                        client.send(
                            JSON.stringify({
                                direct: false,
                                title: item.product.title,
                                id: item.product.id,
                            })
                        );
                    }
                }
            }
        }
        if (this.stockWebhook) {
            try {
                await this.stockWebhook.send({
                    text: message,
                    username: `Stock Shock ${fullAlert ? "🧚" : "⚡️"}`,
                    attachments: [
                        {
                            title_link: `${this.store.baseUrl}${item.product.url}`,
                            image_url: `https://assets.mmsrg.com/isr/166325/c1/-/${item.product.titleImageId}/mobile_200_200.png`,
                        },
                    ],
                });
            } catch (e) {
                this.logger.error("Error sending webook, error code" + (e as IncomingWebhookHTTPError).code);
                if (((e as IncomingWebhookHTTPError).original as AxiosError)?.response?.data) {
                    this.logger.error("Discord error data, %O", ((e as IncomingWebhookHTTPError).original as AxiosError)?.response?.data);
                }
                if (((e as IncomingWebhookHTTPError).original as AxiosError)?.response?.headers) {
                    this.logger.error(
                        "Discord error headers, %O",
                        ((e as IncomingWebhookHTTPError).original as AxiosError)?.response?.headers
                    );
                }
            }
        }
        if (fullAlert) {
            this.beep();
            setTimeout(() => this.beep(), 250);
            setTimeout(() => this.beep(), 500);
        }
        return message;
    }

    private beep() {
        process.stdout.write("\x07");
    }

    private decorateMessageWithRoles(message: string, webhookRolePing: string | undefined) {
        if (!webhookRolePing) {
            return message;
        }

        return `${message} <@&${webhookRolePing}>`;
    }
}
