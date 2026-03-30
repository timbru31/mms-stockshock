import type { CooldownManager } from "../core/cooldown-manager";
import type { DatabaseConnection } from "../databases/database-connection";
import { CofrProductAggregate } from "../models/api/product-aggregate";
import type { Product } from "../models/api/product";
import type { Notifier } from "../models/notifier";
import type { Store } from "../models/stores/store";

export class ProductHelper {
    private readonly fallbackAmount = 0;

    /*
     * Check if an item can be added to basket (isInAssortment and/or onlineStatus) - this overrules everything
     * Otherwise check if the item is listed as IN_WAREHOUSE or LONG_TAIL with at least a quantity > 0
     * There seems to be IN_STORE too, where the quantity does not matter. Probably a local store will ship the item
     * Special note: LONG_TAIL needs to be purchasable (isInAssortment and/or onlineStatus)!
     */
    isProductAvailable(item: CofrProductAggregate, checkOnlineStatus: boolean, checkInAssortment: boolean): boolean {
        let onlineStatus = true;
        if (checkOnlineStatus) {
            onlineStatus = item.cofrOnlineStatusFeature?.onlineStatus === "AVAILABLE";
        }

        let inAssortmentStatus = true;
        if (checkInAssortment) {
            inAssortmentStatus = item.cofrDeliveryFeature?.isInAssortment ?? false;
        }

        if (onlineStatus && inAssortmentStatus) {
            return true;
        }

        switch (item.cofrDeliveryFeature?.delivery?.deliveryStatus) {
            case "AVAILABLE_ON_NEXT_DAY":
            case "AVAILABLE_WITHIN_REASONABLE_TIME_FRAME":
            case "AVAILABLE_OUTSIDE_REASONABLE_TIME_FRAME":
                return true;
            case "PERMANENTLY_NOT_AVAILABLE":
            case "NOT_AVAILABLE": {
                return false;
            }
            case undefined: {
                return false;
            }
        }
    }

    isProductBuyable(item: CofrProductAggregate, checkOnlineStatus: boolean, checkInAssortment: boolean): boolean {
        let onlineStatus = true;
        if (checkOnlineStatus) {
            onlineStatus = item.cofrOnlineStatusFeature?.onlineStatus === "AVAILABLE";
        }

        let inAssortmentStatus = true;
        if (checkInAssortment) {
            inAssortmentStatus = item.cofrDeliveryFeature?.isInAssortment ?? false;
        }

        if (onlineStatus && inAssortmentStatus) {
            switch (item.cofrDeliveryFeature?.delivery?.deliveryStatus) {
                case "AVAILABLE_ON_NEXT_DAY":
                case "AVAILABLE_WITHIN_REASONABLE_TIME_FRAME":
                case "AVAILABLE_OUTSIDE_REASONABLE_TIME_FRAME":
                    return true;
                case "PERMANENTLY_NOT_AVAILABLE":
                case "NOT_AVAILABLE": {
                    return false;
                }
                case undefined: {
                    return false;
                }
            }
        }
        return false;
    }

    canProductBeAddedToBasket(item: CofrProductAggregate, checkOnlineStatus: boolean, checkInAssortment: boolean): boolean {
        let onlineStatus = true;
        if (checkOnlineStatus) {
            onlineStatus = item.cofrOnlineStatusFeature?.onlineStatus === "AVAILABLE";
        }

        let inAssortmentStatus = true;
        if (checkInAssortment) {
            inAssortmentStatus = item.cofrDeliveryFeature?.isInAssortment ?? false;
        }
        return onlineStatus && inAssortmentStatus;
    }

    getProductURL(item: CofrProductAggregate, store: Store, replacements?: Map<string, string>, magician = false): string {
        if (!item.productId) {
            return "";
        }
        const replacement = replacements?.get(magician ? `${item.productId}*` : item.productId);
        if (replacement) {
            return replacement;
        }

        return (
            store.baseUrl +
            (item.cofrCoreFeature?.urlRelative ?? `/${store.languageCode}/product/-${item.productId}.html`) +
            (magician ? `?magician=${item.productId}` : "")
        );
    }

    async checkItems(
        items: CofrProductAggregate[] | undefined,
        cooldownManager: CooldownManager,
        database: DatabaseConnection | undefined,
        notifiers: Notifier[],
        store: Store,
        checkOnlineStatus: boolean,
        checkInAssortment: boolean,
        cookieIds: string[],
    ): Promise<Map<string, Product>> {
        const basketProducts = new Map<string, Product>();

        if (items) {
            for (const item of items) {
                await this.checkItem(
                    item,
                    basketProducts,
                    cooldownManager,
                    database,
                    notifiers,
                    store,
                    checkOnlineStatus,
                    checkInAssortment,
                    cookieIds,
                );
            }
        }
        return basketProducts;
    }

    async checkItem(
        item: CofrProductAggregate | undefined,
        basketProducts: Map<string, Product>,
        cooldownManager: CooldownManager,
        database: DatabaseConnection | undefined,
        notifiers: Notifier[],
        store: Store,
        checkOnlineStatus: boolean,
        checkInAssortment: boolean,
        cookieIds: string[],
    ): Promise<Map<string, Product>> {
        if (!item) {
            return basketProducts;
        }

        const itemId = item.productId;
        if (itemId) {
            const lastKnownPrice = database ? await database.getLastKnownPrice(itemId) : NaN;
            const price = item.cofrPriceFeature?.price?.amount ?? NaN;
            if (price && price !== lastKnownPrice) {
                for (const notifier of notifiers) {
                    await notifier.notifyPriceChange(item, lastKnownPrice);
                }
            }
            if (price && price !== lastKnownPrice) {
                await database?.storePrice(this.convertCofrProductAggregateToProduct(item, store), price);
            }

            if (this.isMarketplaceOffer(item)) {
                return basketProducts;
            }

            if (this.isProductAvailable(item, checkOnlineStatus, checkInAssortment)) {
                if (!itemId) {
                    return basketProducts;
                }
                const isProductBuyable = this.isProductBuyable(item, checkOnlineStatus, checkInAssortment);

                // Delete the cooldown in case the stock changes to really available
                if (!cooldownManager.getItem(itemId)?.isProductBuyable && isProductBuyable) {
                    cooldownManager.deleteCooldown(itemId);
                }

                if (!cooldownManager.hasCooldown(itemId)) {
                    const cookiesAmount = database ? await database.getCookiesAmount(itemId) : this.fallbackAmount;
                    for (const notifier of notifiers) {
                        await notifier.notifyStock(item, cookiesAmount);
                    }
                    cooldownManager.addToCooldownMap(isProductBuyable, item, checkOnlineStatus, checkInAssortment, Boolean(cookiesAmount));
                }

                if (
                    this.canProductBeAddedToBasket(item, checkOnlineStatus, checkInAssortment) &&
                    !cooldownManager.hasBasketCooldown(itemId) &&
                    (!cookieIds.length || cookieIds.includes(itemId))
                ) {
                    basketProducts.set(itemId, this.convertCofrProductAggregateToProduct(item, store));
                }
            }
        }
        return basketProducts;
    }

    convertCofrProductAggregateToProduct(item: CofrProductAggregate, store: Store): Product {
        return {
            id: item.productId,
            title: item.cofrCoreFeature?.productName ?? "",
            url: this.getProductURL(item, store, undefined, true),
            onlineStatus: item.cofrOnlineStatusFeature?.onlineStatus === "AVAILABLE",
            titleImageId: item.cofrMediaAssetsFeature?.productMainImage?.imageId ?? null,
        };
    }

    isMarketplaceOffer(item: CofrProductAggregate): boolean {
        return item.cofrOnlineStatusFeature?.onlineStatus === "MP_OFFER";
    }
}
