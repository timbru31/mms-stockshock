import type { Response } from "./response.js";
import type { WishlistItem } from "./wishlist-item.js";

export interface WishlistResponse extends Response {
    data?: {
        wishlistItems?: {
            total: number;
            items: WishlistItem[];
        };
    };
}
