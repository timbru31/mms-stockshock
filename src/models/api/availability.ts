export interface Availability {
    productId?: string;
    delivery: {
        availabilityType: "IN_STORE" | "IN_WAREHOUSE" | "LONG_TAIL" | "NONE";
        quantity: number;
        earliest: string | null; // Date compatible string
        latest: string | null; // Date compatible string
    };
    pickup?: unknown;
}
