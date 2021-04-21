# stockshock

> Your friendly 🤖 to check the wishlist of MediaMarkt and Saturn for available items

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
If desired, configure the webhook URL, too.

### Slack/Discord notifications

Any Slack compatible webhook URL can be used, for instance Discord.  
Here is an example how the message looks like:

![Discord Notification](docs/stockshock-discord-notification.png)

# Run the bot

Run

```sh
npm start
```

and follow the terminal instructions.  
Happy hunting! 🏹⚡️

---

Built by (c) Tim Brust and contributors. Released under the GPL v3 license.
