import type { Item } from "./item.js";

export interface WishlistItem {
    id: string;
    updated: Date;
    productAggregate: Item;
}
