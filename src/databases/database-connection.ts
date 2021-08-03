import { Product } from "../models/api/product";

export interface DatabaseConnection {
    storeCookies(product: Product, cookies: string[]): Promise<void>;
    getCookiesAmount(product: Product): Promise<number>;
    storePrice(product: Product, price: number): Promise<void>;
    getLastKnownPrice(product: Product): Promise<number>;
}
