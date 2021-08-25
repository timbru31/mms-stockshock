export interface Availability {
    productId?: string;
    delivery: {
        availabilityType: "IN_STORE" | "IN_WAREHOUSE" | "LONG_TAIL" | "NONE";
        quantity: number;
        earliest: Date | null;
        latest: Date | null;
    };
    pickup?: unknown;
}
