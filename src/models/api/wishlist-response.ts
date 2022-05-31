import type { Response } from "./response";
import type { WishlistItem } from "./wishlist-item";

export interface WishlistResponse extends Response {
    data?: {
        wishlistItems?: {
            total: number;
            items: WishlistItem[];
        };
    };
}
