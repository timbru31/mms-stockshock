import type { Availability } from "./availability.js";
import type { Product } from "./product.js";

export interface Item {
    product?: Product;
    price?: {
        price: number;
        currency: string;
    } | null;
    availability: Availability;
    productControl?: {
        isInAssortment: boolean;
    };
}
