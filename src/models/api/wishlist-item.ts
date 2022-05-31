import type { Item } from "./item";

export interface WishlistItem {
    id: string;
    updated: Date;
    productAggregate: Item;
}
