const { Client, GatewayIntentBits } = require("discord.js");

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

client.once("ready", () => {
  console.log("✅ ASTRO BOT ONLINE:", client.user.tag);
});

client.login(process.env.TOKEN_DISCORD);
