export interface ConfigModel {
    saturn: StoreConfiguration;
    mmde: StoreConfiguration;
    mmat: StoreConfiguration;
}

export interface StoreConfiguration {
    // User data
    email: string;
    password: string;

    // Categories to check
    categories?: string[];
    category_regex: string;
    start_url?: string;

    // Misc config settings
    ignore_sleep?: boolean;
    cookies?: number;
    announce_cookies: boolean;

    // Webhooks for notifications
    webhook_url?: string;
    stock_webhook_url?: string;
    cookie_webhook_url?: string;
    admin_webhook_url?: string;
    webhook_role_ping?: string;
    stock_webhook_role_ping?: string;
    cookie_webhook_role_ping?: string;
    admin_webhook_role_ping?: string;

    // Proxies
    proxy_url?: string;
    proxy_username?: string;
    proxy_password?: string;
    proxy_urls?: string[];

    // Cookie Jar
    dynamo_db_region?: string;
    dynamo_db_table_name?: string;
    dynamo_db_access_key?: string;
    dynamo_db_secret_access_key?: string;

    // WebSocket config
    use_websocket?: boolean;
    websocket_password?: string;
    websocket_port?: number;
    websocket_https?: boolean;
    websocket_cert_path?: string;
    websocket_key_path?: string;

    // SHA256 hashes for queries
    loginSHA256: string;
    categorySHA256: string;
    wishlistSHA256: string;
    addProductSHA256: string;
    getProductSHA256: string;
}
