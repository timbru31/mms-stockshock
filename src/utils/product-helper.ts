import type { Logger } from "winston";
import type { CooldownManager } from "../core/cooldown-manager";
import type { DatabaseConnection } from "../databases/database-connection";
import type { Item } from "../models/api/item";
import type { Product } from "../models/api/product";
import type { Notifier } from "../models/notifier";
import type { Store } from "../models/stores/store";

export class ProductHelper {
    private readonly fallbackAmount = 0;

    /*
     * Check if an item can be added to basket (onlineStatus) - this overrules everything
     * Otherwise check if the item is listed as IN_WAREHOUSE or LONG_TAIL with at least a quantity > 0
     * There seems to be IN_STORE too, where the quantity does not matter. Probably a local store will ship the item
     * Special note: LONG_TAIL needs to be purchasable (onlineStatus)!
     */
    isProductAvailable(item: Item): boolean {
        if (item.product?.onlineStatus) {
            return true;
        }

        switch (item.availability.delivery.availabilityType) {
            case "IN_STORE":
                return true;
            case "IN_WAREHOUSE":
            case "LONG_TAIL":
                return item.availability.delivery.quantity > this.fallbackAmount;
            case "NONE": {
                return false;
            }
        }
    }

    isProductBuyable(item: Item): boolean {
        if (item.product?.onlineStatus) {
            switch (item.availability.delivery.availabilityType) {
                case "IN_STORE":
                    return true;
                case "IN_WAREHOUSE":
                case "LONG_TAIL":
                    return item.availability.delivery.quantity > this.fallbackAmount;
                case "NONE": {
                    return false;
                }
            }
        }
        return false;
    }

    canProductBeAddedToBasket(item: Item): boolean {
        return item.product?.onlineStatus ?? false;
    }

    getProductURL(item: Item, store: Store, replacements?: Map<string, string>, magician = false): string {
        if (!item.product) {
            return "";
        }
        const replacement = replacements?.get(magician ? `${item.product.id}*` : item.product.id);
        if (replacement) {
            return replacement;
        }

        return (
            store.baseUrl + (item.product.url || `/de/product/-${item.product.id}.html`) + (magician ? `?magician=${item.product.id}` : "")
        );
    }

    async checkItems(
        items: Item[] | undefined,
        cooldownManager: CooldownManager,
        database: DatabaseConnection | undefined,
        notifiers: Notifier[],
        logger: Logger
    ): Promise<Map<string, Product>> {
        const basketProducts = new Map<string, Product>();

        if (items) {
            for (const item of items) {
                await this.checkItem(item, basketProducts, cooldownManager, database, notifiers, logger);
            }
        }
        return basketProducts;
    }

    async checkItem(
        item: Item | undefined,
        basketProducts: Map<string, Product>,
        cooldownManager: CooldownManager,
        database: DatabaseConnection | undefined,
        notifiers: Notifier[],
        logger: Logger
    ): Promise<Map<string, Product>> {
        if (!item) {
            return basketProducts;
        }

        if (item.product && this.isProductAvailable(item)) {
            const itemId = item.product.id;
            if (!itemId) {
                return basketProducts;
            }
            const isProductBuyable = this.isProductBuyable(item);

            // Delete the cooldown in case the stock changes to really available
            if (!cooldownManager.getItem(itemId)?.isProductBuyable && isProductBuyable) {
                cooldownManager.deleteCooldown(itemId);
            }

            const lastKnownPrice = database ? await database.getLastKnownPrice(item.product) : NaN;
            const price = item.price?.price ?? NaN;
            if (price && lastKnownPrice && price !== lastKnownPrice) {
                for (const notifier of notifiers) {
                    await notifier.notifyPriceChange(item, lastKnownPrice);
                }
            }
            if (price && price !== lastKnownPrice) {
                await database?.storePrice(item.product, price);
            }

            if (!cooldownManager.hasCooldown(itemId)) {
                const cookiesAmount = database ? await database.getCookiesAmount(item.product) : this.fallbackAmount;
                for (const notifier of notifiers) {
                    const message = await notifier.notifyStock(item, cookiesAmount);
                    if (message) {
                        logger.info(message);
                    }
                }
                cooldownManager.addToCooldownMap(isProductBuyable, item, Boolean(cookiesAmount));
            }

            if (this.canProductBeAddedToBasket(item) && !cooldownManager.hasBasketCooldown(itemId)) {
                basketProducts.set(itemId, item.product);
            }
        }
        return basketProducts;
    }
}
