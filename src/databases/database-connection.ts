import type { Product } from "../models/api/product";

export interface DatabaseConnection {
    storeCookies: (product: Product, cookies: string[]) => Promise<void>;
    getCookiesAmount: (productId: string) => Promise<number>;
    storePrice: (product: Product, price: number) => Promise<void>;
    getLastKnownPrice: (productId: string) => Promise<number>;
}
