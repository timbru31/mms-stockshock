import type { Item } from "./item";
import type { Response } from "./response";

export interface WishlistResponse extends Response {
    data?: {
        wishlistItems?: {
            total: number;
            items: Item[];
        };
    };
}
