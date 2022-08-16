/* eslint-disable @typescript-eslint/naming-convention */
import type { DynamoDBClientConfig, GetItemCommandInput, UpdateItemCommandInput } from "@aws-sdk/client-dynamodb";
import { DynamoDBClient, GetItemCommand, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import type { Product } from "../models/api/product.js";
import type { StoreConfiguration } from "../models/stores/config-model.js";
import type { Store } from "../models/stores/store.js";
import type { DatabaseConnection } from "./database-connection.js";

export class DynamoDBStore implements DatabaseConnection {
    private readonly store: Store;
    private readonly storeConfiguration: StoreConfiguration;
    private readonly client: DynamoDBClient;
    private readonly fallbackAmount = 0;

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
            UpdateExpression: "SET cookies = list_append(:cookies, if_not_exists(cookies, :empty_list)), title = :title",
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

    async storePrice(product: Product, price: number): Promise<void> {
        const params: UpdateItemCommandInput = {
            TableName: this.storeConfiguration.dynamo_db_table_name,
            Key: {
                store: { S: this.store.shortCode },
                productId: { S: product.id },
            },
            UpdateExpression: "SET price = :price, title = :title, cookies = list_append(if_not_exists(cookies, :empty_list), :empty_list)",
            ExpressionAttributeValues: {
                ":price": {
                    N: price.toString(),
                },
                ":title": {
                    S: product.title,
                },
                ":empty_list": {
                    L: [],
                },
            },
        };
        const command = new UpdateItemCommand(params);
        await this.client.send(command);
    }

    async getCookiesAmount(product: Product): Promise<number> {
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
            return response.Item?.cookies.L?.length ?? this.fallbackAmount;
        } catch (e: unknown) {
            return this.fallbackAmount;
        }
    }

    async getLastKnownPrice(product: Product): Promise<number> {
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
            const priceString = response.Item?.price.N;
            return priceString ? parseFloat(priceString) : NaN;
        } catch (e: unknown) {
            return NaN;
        }
    }
}
