const {
  Client,
  GatewayIntentBits,
  SlashCommandBuilder,
  REST,
  Routes,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require("discord.js");

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

const TOKEN = process.env.TOKEN_DISCORD;
const CLIENT_ID = process.env.CLIENT_ID; // vamos colocar já já

// REGISTRAR COMANDO /astro
const commands = [
  new SlashCommandBuilder()
    .setName("astro")
    .setDescription("Abrir painel de vendas do Astro Bot")
].map(cmd => cmd.toJSON());

const rest = new REST({ version: "10" }).setToken(TOKEN);

client.once("ready", async () => {
  console.log("🟢 ASTRO BOT ONLINE:", client.user.tag);

  await rest.put(
    Routes.applicationCommands(CLIENT_ID),
    { body: commands }
  );

  console.log("✅ Comando /astro registrado");
});

// INTERAÇÃO
client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === "astro") {
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("loja")
        .setLabel("🛒 Loja")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId("carrinho")
        .setLabel("🧺 Carrinho")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId("pagamento")
        .setLabel("💳 Pagamento")
        .setStyle(ButtonStyle.Success)
    );

    await interaction.reply({
      content:
        "**🔮 ASTRO BOT — Painel de Vendas**\n\n" +
        "Escolha uma opção abaixo para continuar sua compra.",
      components: [row]
    });
  }
});

client.login(TOKEN);
