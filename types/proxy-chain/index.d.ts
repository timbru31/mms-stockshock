/// <reference types="node" />

declare module "proxy-chain" {
    import type { IncomingMessage } from "http";
    import { EventEmitter } from "events";

    interface ServerOptions {
        port?: number;
        verbose?: boolean;
        prepareRequestFunction?: (req: RequestFunction) => RequestFunctionResponse;
    }

    interface RequestFunction {
        request: IncomingMessage;
        username: string;
        password: string;
        hostname: string;
        port: number;
        isHttp: boolean;
        connectionId: string;
    }

    interface RequestFunctionResponse {
        requestAuthentication: boolean;
        upstreamProxyUrl: string;
        failMsg?: string;
    }

    class Server extends EventEmitter {
        port: number;
        constructor(options: ServerOptions);

        listen(callback?: () => void): Promise<void>;
        close(destroyConnections: boolean, callback?: () => void): Promise<void>;
    }
}
