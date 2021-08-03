import { Item } from "./api/item";
import { Product } from "./api/product";

export interface Notifier {
    notifyAdmin(message?: string): Promise<void>;
    notifyRateLimit(seconds?: number): Promise<void>;
    notifyCookies(product?: Product, cookies?: string[]): Promise<void>;
    notifyStock(item?: Item, cookiesAmount?: number): Promise<string | undefined>;
    notifyPriceChange(item?: Item, newPrice?: number): Promise<void>;
    shutdown(): void;
}
