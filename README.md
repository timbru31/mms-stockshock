# stockshock

> Your friendly 🤖 to check the wishlist and categories of MediaMarkt and Saturn for available products featuring automatic basket cookie generation and price watching.

## Features

-   Category tracking of products
-   Wishlist tracking
-   Price watching/comparison
-   Automatic basket cookie generation
-   Rich notifications for
    -   Discord (stock alerts, cookies, price changes, admin messages)
    -   Telegram (stock alerts)
    -   Twitter (stock alerts)
-   Monitoring is API based, no Selenium involved
-   **_NO BUY BOT_**

## No support 🚨

Sadly, I can't offer any support to help you get the bot up and running.  
You need to figure the things out on your own.  
**However**, if you believe you found an actual bug, please open an issue.

## Prerequisites

You need to put products on your wishlist in order to have this bot working or have the categories you want to track ready.

### Supported stores

-   MediaMarkt Austria
-   MediaMarkt Germany
-   MediaMarkt Netherlands
-   MediaMarkt Spain
-   MediaWorld Italy
-   Saturn

## Installation

_See below for Docker_  
Install Node.js v16 or higher.  
Download or clone the project then run:

```sh
npm install
```

## Configuration & Usage

Copy the `stores_example.toml` to `stores.toml` and configure your credentials.  
**You need to supply the query hashes from the MM/S API as they change too often to maintain!**

You can setup different categories (use the ID) to check, too.  
If desired, configure the notification providers (see below), websocket announcements, id replacements (e.g., for affiliates), proxies or turn off shopping cart alerts.

### Cookies

The tracker can be configured to announce the made cookies, too (`announce_cookies`). Currently, this is for **Discord notifications only**.
Alternatively, you need to supply existing DynamoDB credentials if you want to store them there, too.

### Discord notifications

Discord can be used to send rich notifications to your server. You need to create a bot and have the bot credentials at hand. The configuration is done in the `Discord` section of the `stores.toml` file. You can configure different roles that should be pinged and the different channel IDs for the admin alerts, cookie announcements and stock pings.

If you want to split the notifications of the products to different channels and IDs you can supply regular expressions to do so.
Here is an example how the message looks like:

![Discord Notification](docs/stockshock-discord-notification.png)

### Telegram notifications

Alternatively, or additionally, you can send the notifications to Telegram.  
To configure it, create or re-use your Telegram bot and configure the bot API key and channel ID in the `Telegram` section of the `stores.toml`.

### Twitter notifications

In addition, this tracker offers a `Twitter` integration. The configuration is similar to Telegram, you need to supply the bearer token of your Twitter bot.  
If desired, you can supply an array of tags a tweet should contain.

## Run the bot

Run

```sh
npm start
```

and follow the terminal instructions.  
Happy hunting! 🏹⚡️

### Turn off headless mode

Per default the Chromium behind the scenes runs in headless mode. If the login fails due to CloudFlare, MM/S bot protection or you want to debug things, please launch it via

```sh
npm start -- --headless false
```

Do **not** close the browser window. You can minimize it though.

### Pass in a store via CLI

You can launch the bot directly with a store by supplying the store as an argument

```sh
npm start -- --store <mmat|mmde|mmes|saturn>
```

### Docker

You can use the provided Docker image (https://hub.docker.com/r/timbru31/mms-stockshock), too.
An example launch command would be:

Pro tips:

-   disable core dumps (`--ulimit core=0`)
-   limit swap and memory
-   restart on failures
-   dev null the log file (you can use the logs command of docker)

```sh
docker run --restart on-failure --memory 500m --memory-swap 500m --ulimit core=0 -v /dev/null:/opt/mms-stockshock/stockshock.log -v $PWD/stores.toml:/opt/mms-stockshock/stores.toml -v $PWD/cooldowns.json:/opt/mms-stockshock/cooldowns.json -v $PWD/basket-cooldowns.json:/opt/mms-stockshock/basket-cooldowns.json -v /etc/letsencrypt/live/my-domain/privkey.pem:/opt/mms-stockshock/key.pem -v /etc/letsencrypt/live/my-domain/fullchain.pem:/opt/mms-stockshock/cert.pem -e "STORE=saturn" -p 8080:8080 -d timbru31/mms-stockshock
```

---

Built by (c) Tim Brust and contributors. Released under the GPL v3 license.
