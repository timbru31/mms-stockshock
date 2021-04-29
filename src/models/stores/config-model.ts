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
}
