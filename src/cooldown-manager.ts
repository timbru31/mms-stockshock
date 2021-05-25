import { add, isAfter, parseISO } from "date-fns";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { Item } from "./models/api/item";
import { Product } from "./models/api/product";
import { NotificationCooldown } from "./models/cooldown";
import { ProductHelper } from "./product-helper";

export class CooldownManager {
    private readonly cooldowns = new Map<string, NotificationCooldown>();
    private readonly basketCooldowns = new Map<string, NotificationCooldown>();
    private readonly productHelper = new ProductHelper();

    constructor() {
        if (existsSync("basket-cooldowns.json")) {
            try {
                this.basketCooldowns = new Map(JSON.parse(readFileSync("basket-cooldowns.json", "utf-8")));
            } catch {
                this.basketCooldowns = new Map<string, NotificationCooldown>();
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
        const canBeAddedToBasket = this.productHelper.canProductBeAddedToBasket(item);
        const endTime = add(new Date(), {
            minutes: isProductBuyable ? 5 : canBeAddedToBasket ? 0 : 30,
            hours: isProductBuyable ? 0 : canBeAddedToBasket ? 4 : 0,
        });
        this.cooldowns.set(item?.product?.id, {
            id: item?.product?.id,
            isProductBuyable,
            endTime,
        });
    }

    addToBasketCooldownMap(product: Product): void {
        const endTime = add(new Date(), {
            hours: 8,
        });
        this.basketCooldowns.set(product?.id, {
            id: product?.id,
            isProductBuyable: null,
            endTime,
        });
    }

    cleanupCooldowns(): void {
        const now = new Date();
        for (const [id, cooldown] of this.cooldowns) {
            if (isAfter(now, typeof cooldown.endTime === "string" ? parseISO(cooldown.endTime as string) : cooldown.endTime)) {
                this.cooldowns.delete(id);
            }
        }

        for (const [id, cooldown] of this.basketCooldowns) {
            if (isAfter(now, typeof cooldown.endTime === "string" ? parseISO(cooldown.endTime as string) : cooldown.endTime)) {
                this.basketCooldowns.delete(id);
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

    hasBasketCooldown(itemId: string): boolean {
        return this.basketCooldowns.has(itemId);
    }

    saveCooldowns(): void {
        const basketCooldowns = JSON.stringify(Array.from(this.basketCooldowns.entries()));
        const cooldowns = JSON.stringify(Array.from(this.cooldowns.entries()));
        writeFileSync("basket-cooldowns.json", basketCooldowns, "utf-8");
        writeFileSync("cooldowns.json", cooldowns, "utf-8");
    }
}
