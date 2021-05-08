export interface Availability {
    productId?: string;
    delivery: {
        availabilityType: "IN_WAREHOUSE" | "IN_STORE" | "LONG_TAIL" | "NONE";
        quantity: number;
        earliest: Date | null;
        latest: Date | null;
    };
    pickup?: unknown;
}
