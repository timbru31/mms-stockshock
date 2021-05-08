# stockshock

> Your friendly 🤖 to check the wishlist and categories of MediaMarkt and Saturn for available items

## Prerequisities

You need to put items on your wishlist in order to have this bot working.

### Supported stores

-   Saturn
-   MediaMarkt Germany
-   MediaMarkt Austria

## Installation

Install Node.js v14 or higher.  
Download or clone the project then run:

```sh
npm install
```

## Configuration & Usage

Copy the `stores_example.toml` to `stores.toml` and configure your credentials.  
You can setup different categories (use the ID) to check, too.  
If desired, configure the webhook URL(s), too.

### Slack/Discord notifications

Any Slack compatible webhook URL can be used, for instance Discord.  
Here is an example how the message looks like:

![Discord Notification](docs/stockshock-discord-notification.png)

## Run the bot

Run

```sh
npm start
```

and follow the terminal instructions.  
Happy hunting! 🏹⚡️

### Turn off headless mode

Per default the Chromium behind the scenes is run in headless mode. If the login fails due to CloudFlare or MM/S bot protection, please launch it as

```sh
npm start -- --headless false
```

Do **not** close the browser window. You can minimize it though.

### Pass in a store via CLI

You can launch the bot directly with a store by suppyling the store as an argument

```sh
npm start -- --store <mmde|mmat|saturn>
```

### Docker

You can use the provided Docker image (https://hub.docker.com/r/timbru31/mms-stockshock), too.
An example launch command would be:

```sh
docker run --restart on-failure --memory 500m --memory-swap 500m -v $PWD/stores.toml:/opt/mms-stockshock/stores.toml -e "STORE=mmde" -d timbru31/mms-stockshock
```

---

Built by (c) Tim Brust and contributors. Released under the GPL v3 license.
