import { Item } from "./models/api/item";

export class ProductHelper {
    /*
     * Check if an item can be added to basket (onlineStatus) - this overrules everything
     * Otherwise check if the item is listed as IN_WAREHOUSE or LONG_TAIL with at least a quantity > 0
     * There seems to be IN_STORE too, where the quantity does not matter. Probably a local store will ship the item
     * Special note: LONG_TAIL needs to be purchasable (onlineStatus)!
     */
    isProductAvailable(item: Item): boolean {
        if (item?.product?.onlineStatus) {
            return true;
        }

        switch (item?.availability?.delivery?.availabilityType) {
            case "IN_STORE":
                return true;
            case "IN_WAREHOUSE":
                return item?.availability?.delivery?.quantity > 0;
            case "LONG_TAIL":
                return item?.product.onlineStatus && item?.availability?.delivery?.quantity > 0;
        }
        return false;
    }

    isProductBuyable(item: Item): boolean {
        if (item?.product?.onlineStatus) {
            switch (item?.availability?.delivery?.availabilityType) {
                case "IN_STORE":
                    return true;
                case "IN_WAREHOUSE":
                case "LONG_TAIL":
                    return item?.availability?.delivery?.quantity > 0;
            }
        }
        return false;
    }

    canProductBeAddedToBasket(item: Item): boolean {
        return item?.product?.onlineStatus;
    }

    getProductURL(item: Item): string {
        return item?.product?.url || `/de/product/-${item.product.id}.html`;
    }
}
