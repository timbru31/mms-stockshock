import { Item } from "./item";

export interface WishlistReponse {
    data: {
        wishlistItems: {
            total: number;
            items: Item[];
        };
    };
    errors: unknown;
}
