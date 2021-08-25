import type { Availability } from "./availability";
import type { Product } from "./product";

export interface Item {
    product: Product;
    price?: {
        price: number;
        currency: string;
    } | null;
    availability: Availability;
}
