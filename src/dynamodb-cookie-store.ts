import {
    DynamoDBClient,
    DynamoDBClientConfig,
    GetItemCommandInput,
    GetItemCommand,
    UpdateItemCommand,
    UpdateItemCommandInput,
} from "@aws-sdk/client-dynamodb";

import { Product } from "./models/api/product";
import { StoreConfiguration } from "./models/stores/config-model";
import { Store } from "./models/stores/store";

export class DynamoDBCookieStore {
    private readonly store: Store;
    private readonly storeConfiguration: StoreConfiguration;
    private readonly client: DynamoDBClient;

    constructor(store: Store, storeConfiguration: StoreConfiguration) {
        this.store = store;
        this.storeConfiguration = storeConfiguration;
        const options = { region: this.storeConfiguration.dynamo_db_region } as DynamoDBClientConfig;
        if (this.storeConfiguration.dynamo_db_access_key && this.storeConfiguration.dynamo_db_secret_access_key) {
            options.credentials = {
                accessKeyId: this.storeConfiguration.dynamo_db_access_key,
                secretAccessKey: this.storeConfiguration.dynamo_db_secret_access_key,
            };
        }
        this.client = new DynamoDBClient(options);
    }

    async storeCookies(product: Product, cookies: string[]): Promise<void> {
        const params: UpdateItemCommandInput = {
            TableName: this.storeConfiguration.dynamo_db_table_name,
            Key: {
                store: { S: this.store.shortCode },
                productId: { S: product.id },
            },
            UpdateExpression: "SET cookies = list_append(if_not_exists(cookies, :empty_list), :cookies), title = :title",
            ExpressionAttributeValues: {
                ":cookies": {
                    L: cookies.map((cookie) => ({
                        S: `${this.store.baseUrl}?cookie=${cookie}`,
                    })),
                },
                ":empty_list": {
                    L: [],
                },
                ":title": {
                    S: product.title,
                },
            },
        };
        const command = new UpdateItemCommand(params);
        await this.client.send(command);
    }

    async hasCookies(product: Product): Promise<boolean> {
        const params: GetItemCommandInput = {
            TableName: this.storeConfiguration.dynamo_db_table_name,
            Key: {
                store: { S: this.store.shortCode },
                productId: { S: product.id },
            },
        };
        const command = new GetItemCommand(params);
        try {
            const response = await this.client.send(command);
            if (response.Item?.cookies.L?.length) {
                return true;
            }
            return false;
        } catch (e) {
            return false;
        }
    }
}
