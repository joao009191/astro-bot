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
const CLIENT_ID = process.env.CLIENT_ID;

// Banco simples em memória (depois dá pra salvar em arquivo)
const carts = new Map();

const commands = [
  new SlashCommandBuilder()
    .setName("astro")
    .setDescription("Abrir painel de vendas do As
