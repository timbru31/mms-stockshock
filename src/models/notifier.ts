import type { Item } from "./api/item.js";
import type { Product } from "./api/product.js";

export interface Notifier {
    notifyAdmin: (message: string, error?: unknown) => Promise<void>;
    notifyRateLimit: (seconds: number) => Promise<void>;
    notifyCookies: (product: Product, cookies: string[]) => Promise<void>;
    notifyStock: (item: Item, cookiesAmount?: number) => Promise<void>;
    notifyPriceChange: (item: Item, oldPrice?: number) => Promise<void>;
    shutdown: () => void;
}
