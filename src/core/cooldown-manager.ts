import { Duration, add, isAfter, parseISO } from "date-fns";
import { existsSync, readFileSync, writeFileSync } from "fs";
import type { Item } from "../models/api/item";
import type { Product } from "../models/api/product";
import type { NotificationCooldown } from "../models/cooldown";
import type { StoreConfiguration } from "../models/stores/config-model";
import { ProductHelper } from "../utils/product-helper";

export class CooldownManager {
    private readonly cooldowns = new Map<string, NotificationCooldown>();
    private readonly basketCooldowns = new Map<string, NotificationCooldown>();
    private readonly productHelper = new ProductHelper();
    private readonly cooldownInStockMinutes: number;
    private readonly cooldownCanBeAddedToBasketMinutes: number;
    private readonly cooldownStockWithCookiesMinutes: number;
    private readonly cooldownStockNoCookiesMinutes: number;

    constructor(storeConfig: StoreConfiguration) {
        if (existsSync("basket-cooldowns.json")) {
            try {
                // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
                this.basketCooldowns = new Map(JSON.parse(readFileSync("basket-cooldowns.json", "utf-8")));
            } catch {
                this.basketCooldowns = new Map<string, NotificationCooldown>();
            }
        }

        if (existsSync("cooldowns.json")) {
            try {
                // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
                this.cooldowns = new Map(JSON.parse(readFileSync("cooldowns.json", "utf-8")));
            } catch {
                this.cooldowns = new Map<string, NotificationCooldown>();
            }
        }

        // eslint-disable-next-line @typescript-eslint/no-magic-numbers
        this.cooldownInStockMinutes = storeConfig.cooldown_in_stock_minutes ?? 10;
        // eslint-disable-next-line @typescript-eslint/no-magic-numbers
        this.cooldownCanBeAddedToBasketMinutes = storeConfig.cooldown_can_be_added_to_basket_minutes ?? 12 * 60;
        // eslint-disable-next-line @typescript-eslint/no-magic-numbers
        this.cooldownStockWithCookiesMinutes = storeConfig.cooldown_stock_with_cookies_minutes ?? 2 * 60;
        // eslint-disable-next-line @typescript-eslint/no-magic-numbers
        this.cooldownStockNoCookiesMinutes = storeConfig.cooldown_stock_no_cookies_minutes ?? 24 * 60;
    }

    addToCooldownMap(
        isProductBuyable: boolean,
        item: Item,
        checkOnlineStatus: boolean,
        checkInAssortment: boolean,
        hasCookies?: boolean,
    ): void {
        if (!item.product) {
            return;
        }
        const canBeAddedToBasket = this.productHelper.canProductBeAddedToBasket(item, checkOnlineStatus, checkInAssortment);
        let cooldownTime: Duration;
        if (isProductBuyable) {
            cooldownTime = {
                minutes: this.cooldownInStockMinutes,
            };
        } else if (canBeAddedToBasket) {
            cooldownTime = {
                minutes: this.cooldownCanBeAddedToBasketMinutes,
            };
        } else {
            cooldownTime = {
                minutes: hasCookies ? this.cooldownStockWithCookiesMinutes : this.cooldownStockNoCookiesMinutes,
            };
        }
        const endTime = add(new Date(), cooldownTime);
        this.cooldowns.set(item.product.id, {
            id: item.product.id,
            isProductBuyable,
            endTime,
        });
    }

    addToBasketCooldownMap(product: Product): void {
        const endTime = add(new Date(), {
            minutes: this.cooldownCanBeAddedToBasketMinutes,
        });
        this.basketCooldowns.set(product.id, {
            id: product.id,
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
