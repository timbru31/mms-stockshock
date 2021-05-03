export interface ConfigModel {
    saturn: StoreConfiguration;
    mmde: StoreConfiguration;
    mmat: StoreConfiguration;
}

export interface StoreConfiguration {
    email: string;
    password: string;
    webhook_url?: string;
    webhook_role_ping?: string;
    proxy_url?: string;
    proxy_username?: string;
    proxy_password?: string;
    start_url?: string;
}
