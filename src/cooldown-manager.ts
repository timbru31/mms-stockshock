import { add } from "date-fns";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { Item } from "./models/api/item";
import { Product } from "./models/api/product";
import { NotificationCooldown } from "./models/cooldown";

export class CooldownManager {
    private readonly cooldowns = new Map<string, NotificationCooldown>();
    private readonly cartCooldowns = new Map<string, NotificationCooldown>();

    constructor() {
        if (existsSync("cart-cooldowns.json")) {
            try {
                this.cartCooldowns = new Map(JSON.parse(readFileSync("cart-cooldowns.json", "utf-8")));
            } catch {
                this.cartCooldowns = new Map<string, NotificationCooldown>();
            }
        }

        if (existsSync("cooldowns.json")) {
            try {
                this.cooldowns = new Map(JSON.parse(readFileSync("cooldowns.json", "utf-8")));
            } catch {
                this.cooldowns = new Map<string, NotificationCooldown>();
            }
        }
    }

    addToCooldownMap(isProductBuyable: boolean, item: Item): void {
        const endTime = add(new Date(), {
            minutes: isProductBuyable ? 5 : 0,
            hours: isProductBuyable ? 0 : 4,
        });
        this.cooldowns.set(item?.product?.id, {
            id: item?.product?.id,
            isProductBuyable,
            endTime,
        });
    }

    addToCartCooldownMap(product: Product): void {
        const endTime = add(new Date(), {
            hours: 8,
        });
        this.cartCooldowns.set(product?.id, {
            id: product?.id,
            isProductBuyable: null,
            endTime,
        });
    }

    cleanupCooldowns(): void {
        const now = new Date();
        for (const [id, cooldown] of this.cooldowns) {
            if (now > cooldown.endTime) {
                this.cooldowns.delete(id);
            }
        }

        for (const [id, cooldown] of this.cartCooldowns) {
            if (now > cooldown.endTime) {
                this.cartCooldowns.delete(id);
            }
        }
    }

    hasCooldown(itemId: string): boolean {
        return this.cooldowns.has(itemId);
    }

    deleteCooldown(itemId: string): boolean {
        return this.cooldowns.delete(itemId);
    }

    getItem(itemId: string): NotificationCooldown | undefined {
        return this.cooldowns.get(itemId);
    }

    hasCartCooldown(itemId: string): boolean {
        return this.cartCooldowns.has(itemId);
    }

    saveCooldowns(): void {
        const cartCooldowns = JSON.stringify(Array.from(this.cartCooldowns.entries()));
        const cooldowns = JSON.stringify(Array.from(this.cooldowns.entries()));
        writeFileSync("cart-cooldowns.json", cartCooldowns, "utf-8");
        writeFileSync("cooldowns.json", cooldowns, "utf-8");
    }
}
