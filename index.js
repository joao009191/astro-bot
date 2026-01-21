const fs = require("fs");
const path = require("path");
const {
  Client,
  GatewayIntentBits,
  Partials,
  SlashCommandBuilder,
  REST,
  Routes,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionsBitField,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ChannelType,
} = require("discord.js");

// =====================
// CONFIG / ENV
// =====================
const TOKEN = process.env.TOKEN_DISCORD;
const CLIENT_ID = process.env.CLIENT_ID;

const PIX_KEY = process.env.PIX_KEY || "SUA_CHAVE_PIX_AQUI";
const MP_LINK = process.env.MP_LINK || "SEU_LINK_MERCADOPAGO_AQUI";

const LOG_CHANNEL_ID = process.env.LOG_CHANNEL_ID || "";
const STAFF_ROLE_ID = process.env.STAFF_ROLE_ID || "";
const CART_CATEGORY_ID = process.env.CART_CATEGORY_ID || "";

// =====================
// DATA (simples)
// ⚠️ Render Free pode resetar disco às vezes.
// =====================
const DB_FILE = path.join(__dirname, "db.json");

function loadDb() {
  if (!fs.existsSync(DB_FILE)) {
    const seed = {
      coupons: {
        ASTRO10: 10, // 10% off
      },
      // Estoque de códigos (exemplo)
      // Coloque aqui seus códigos reais (um por linha) depois.
      stock: {
        "GIFT-10": ["CODIGO-AAAA-1111", "CODIGO-BBBB-2222"],
      },
      // Catálogo
      products: [
        { id: "ff110", name: "🔥 110 Diamantes (FF)", price: 7.99, type: "MANUAL" },
        { id: "ff341", name: "🔥 341 Diamantes (FF)", price: 19.99, type: "MANUAL" },
        { id: "rbx400", name: "🟩 400 Robux", price: 24.9, type: "MANUAL" },
        { id: "gift10", name: "🎁 Gift Card 10 (CÓDIGO)", price: 10.0, type: "CODE", stockKey: "GIFT-10" },
      ],
    };
    fs.writeFileSync(DB_FILE, JSON.stringify(seed, null, 2));
  }
  return JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
}

function saveDb(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

let DB = loadDb();

// =====================
// CARTS / ORDERS (memória)
// =====================
const carts = new Map(); // userId -> { items: [{id, qty}], coupon: "ASTRO10"|null }
const orders = new Map(); // orderId -> data
let orderSeq = 1;

// =====================
// BOT
// =====================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages, // para o canal carrinho
    GatewayIntentBits.MessageContent, // para usuário mandar comprovante/infos
  ],
  partials: [Partials.Channel, Partials.Message],
});

// =====================
// Helpers
// =====================
function money(n) {
  return `R$ ${n.toFixed(2).replace(".", ",")}`;
}

function isStaff(member) {
  if (!member) return false;
  if (member.permissions.has(PermissionsBitField.Flags.Administrator)) return true;
  if (STAFF_ROLE_ID && member.roles.cache.has(STAFF_ROLE_ID)) return true;
  return false;
}

async function log(guild, text) {
  if (!LOG_CHANNEL_ID) return;
  try {
    const ch = await guild.channels.fetch(LOG_CHANNEL_ID);
    if (ch) ch.send({ content: text }).catch(() => {});
  } catch {}
}

function getCart(userId) {
  if (!carts.has(userId)) carts.set(userId, { items: [], coupon: null });
  return carts.get(userId);
}

function cartLines(cart) {
  const lines = [];
  let subtotal = 0;

  for (const it of cart.items) {
    const p = DB.products.find(x => x.id === it.id);
    if (!p) continue;
    const line = `${it.qty}x ${p.name} — ${money(p.price * it.qty)}`;
    lines.push(line);
    subtotal += p.price * it.qty;
  }

  const discountPct = cart.coupon && DB.coupons[cart.coupon] ? DB.coupons[cart.coupon] : 0;
  const discount = subtotal * (discountPct / 100);
  const total = Math.max(0, subtotal - discount);

  return { lines, subtotal, discountPct, discount, total };
}

function mainPanelText() {
  return (
    `**🔮 ASTRO BOT — Painel de Vendas**\n\n` +
    `Escolha uma opção abaixo para continuar:`
  );
}

function mainPanelComponents(isUserStaff) {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("astro:shop").setLabel("🛒 Loja").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("astro:cart").setLabel("🧺 Carrinho").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("astro:checkout").setLabel("💳 Pagamento").setStyle(ButtonStyle.Success),
  );

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("astro:help").setLabel("📞 Suporte").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("astro:tos").setLabel("📜 Termos").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("astro:admin").setLabel("👑 Admin").setStyle(ButtonStyle.Secondary).setDisabled(!isUserStaff),
  );

  return [row, row2];
}

function shopText() {
  const prods = DB.products
    .map(p => `• **${p.name}** — ${money(p.price)} ${p.type === "CODE" ? "(`código`)" : "(`manual`)"}\n  ID: \`${p.id}\``)
    .join("\n");
  return `**🛒 Loja — Produtos**\n\n${prods}\n\nClique em um produto abaixo para adicionar ao carrinho.`;
}

function shopButtons() {
  // 4 botões por linha é ok; vamos dividir em linhas de 2
  const btns = DB.products.map(p =>
    new ButtonBuilder()
      .setCustomId(`astro:add:${p.id}`)
      .setLabel(p.name.slice(0, 20))
      .setStyle(ButtonStyle.Primary)
  );

  const rows = [];
  for (let i = 0; i < btns.length; i += 2) {
    rows.push(new ActionRowBuilder().addComponents(btns[i], btns[i + 1]).filter(Boolean));
  }

  rows.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("astro:back").setLabel("⬅️ Voltar").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("astro:cart").setLabel("🧺 Carrinho").setStyle(ButtonStyle.Secondary),
    )
  );

  return rows;
}

function cartViewText(cart) {
  const { lines, subtotal, discountPct, discount, total } = cartLines(cart);

  if (lines.length === 0) {
    return `**🧺 Seu carrinho está vazio**\n\nVolte na Loja e adicione produtos.`;
  }

  return (
    `**🧺 Detalhes da sua compra**\n` +
    `Aqui estão os produtos que você escolheu.\n\n` +
    `**Produtos no Carrinho (${lines.reduce((s, l) => s + 1, 0)} itens)**\n` +
    `${lines.map(l => `• ${l}`).join("\n")}\n\n` +
    `**Subtotal:** ${money(subtotal)}\n` +
    `${discountPct ? `**Cupom (${cart.coupon}) — ${discountPct}%:** -${money(discount)}\n` : ""}` +
    `**Valor à vista:** ${money(total)}`
  );
}

function cartButtons(cart) {
  const hasItems = cart.items.length > 0;

  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("astro:checkout").setLabel("✅ Ir para pagamento").setStyle(ButtonStyle.Success).setDisabled(!hasItems),
      new ButtonBuilder().setCustomId("astro:qty").setLabel("🖊️ Editar quantidade").setStyle(ButtonStyle.Primary).setDisabled(!hasItems),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("astro:coupon").setLabel("🏷️ Usar cupom").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("astro:clear").setLabel("🧹 Limpar carrinho").setStyle(ButtonStyle.Danger).setDisabled(!hasItems),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("astro:back").setLabel("⬅️ Voltar").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("astro:shop").setLabel("🛒 Loja").setStyle(ButtonStyle.Secondary),
    ),
  ];
}

function checkoutText(cart, orderId = null) {
  const { total } = cartLines(cart);
  const oid = orderId ? `**Pedido:** #${orderId}\n` : "";

  return (
    `**💳 Escolha a sua forma de pagamento**\n` +
    `Dê uma última olhada na sua compra e escolha como pagar.\n\n` +
    oid +
    `**Valor à vista:** ${money(total)}\n\n` +
    `**PIX:** \`${PIX_KEY}\`\n` +
    `**Mercado Pago:** ${MP_LINK}\n\n` +
    `Após pagar, clique em **📤 Enviar comprovante** (no seu canal do carrinho).`
  );
}

function checkoutButtons() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("astro:open_cart_channel").setLabel("🛒 Abrir canal do carrinho").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId("astro:back").setLabel("⬅️ Voltar").setStyle(ButtonStyle.Secondary),
    ),
  ];
}

// =====================
// Slash command register
// =====================
const commands = [
  new SlashCommandBuilder().setName("astro").setDescription("Abrir painel de vendas do Astro Bot"),
].map(c => c.toJSON());

const rest = new REST({ version: "10" }).setToken(TOKEN);

client.once("ready", async () => {
  console.log("🟢 ASTRO BOT ONLINE:", client.user.tag);
  await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
  console.log("✅ Comando /astro registrado");
});

// =====================
// Interactions
// =====================
client.on("interactionCreate", async (interaction) => {
  try {
    // /astro
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === "astro") {
        const cart = getCart(interaction.user.id);
        cart.items = [];
        cart.coupon = null;

        await interaction.reply({
          content: mainPanelText(),
          components: mainPanelComponents(isStaff(interaction.member)),
        });

        log(interaction.guild, `🟣 **/astro** aberto por <@${interaction.user.id}>`);
      }
      return;
    }

    // Modals
    if (interaction.isModalSubmit()) {
      const userId = interaction.user.id;
      const cart = getCart(userId);

      if (interaction.customId === "astro:modal:coupon") {
        const code = interaction.fields.getTextInputValue("coupon").trim().toUpperCase();
        if (!DB.coupons[code]) {
          return interaction.reply({ content: "❌ Cupom inválido.", ephemeral: true });
        }
        cart.coupon = code;
        await interaction.reply({ content: `✅ Cupom aplicado: **${code}** (${DB.coupons[code]}%)`, ephemeral: true });
        log(interaction.guild, `🏷️ Cupom **${code}** aplicado por <@${userId}>`);
        return;
      }

      if (interaction.customId === "astro:modal:qty") {
        const raw = interaction.fields.getTextInputValue("qty").trim();
        // formato: ff110=2,rbx400=1
        const parts = raw.split(",").map(s => s.trim()).filter(Boolean);
        const map = new Map();
        for (const p of parts) {
          const [id, q] = p.split("=").map(s => s.trim());
          const qty = Number(q);
          if (!id || !Number.isFinite(qty) || qty < 0) continue;
          map.set(id, Math.floor(qty));
        }
        cart.items = cart.items
          .map(it => ({ ...it, qty: map.has(it.id) ? map.get(it.id) : it.qty }))
          .filter(it => it.qty > 0);

        await interaction.reply({ content: "✅ Quantidades atualizadas.", ephemeral: true });
        log(interaction.guild, `🧺 Quantidades editadas por <@${userId}>`);
        return;
      }

      if (interaction.customId.startsWith("astro:modal:proof:")) {
        const orderId = interaction.customId.split(":").pop();
        const tx = interaction.fields.getTextInputValue("proof").trim();
        const ord = orders.get(orderId);
        if (!ord) return interaction.reply({ content: "❌ Pedido não encontrado.", ephemeral: true });

        ord.proofText = tx;
        ord.status = "AGUARDANDO_APROVACAO";

        // avisar staff no canal do carrinho
        const ch = await interaction.guild.channels.fetch(ord.cartChannelId).catch(() => null);
        if (ch) {
          const staffMention = STAFF_ROLE_ID ? `<@&${STAFF_ROLE_ID}>` : `@here`;
          ch.send({
            content:
              `📤 **Comprovante enviado** por <@${ord.userId}>\n` +
              `Pedido **#${orderId}** — Status: **AGUARDANDO APROVAÇÃO**\n\n` +
              `Texto/ID: \`${tx || "—"}\`\n\n` +
              `${staffMention}`,
            components: [
              new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`astro:approve:${orderId}`).setLabel("✅ Aprovar").setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId(`astro:reject:${orderId}`).setLabel("❌ Recusar").setStyle(ButtonStyle.Danger),
                new ButtonBuilder().setCustomId(`astro:deliver:${orderId}`).setLabel("📦 Entregar").setStyle(ButtonStyle.Primary),
              )
            ]
          });
        }

        await interaction.reply({ content: "✅ Comprovante enviado! Aguarde aprovação da staff.", ephemeral: true });
        log(interaction.guild, `📤 Comprovante enviado por <@${ord.userId}> no pedido #${orderId}`);
        return;
      }
    }

    // Buttons
    if (interaction.isButton()) {
      const userId = interaction.user.id;
      const cart = getCart(userId);

      // admin actions
      if (interaction.customId.startsWith("astro:approve:") || interaction.customId.startsWith("astro:reject:") || interaction.customId.startsWith("astro:deliver:")) {
        if (!isStaff(interaction.member)) return interaction.reply({ content: "❌ Sem permissão.", ephemeral: true });

        const [_, action, orderId] = interaction.customId.split(":");
        const ord = orders.get(orderId);
        if (!ord) return interaction.reply({ content: "❌ Pedido não encontrado.", ephemeral: true });

        if (action === "approve") {
          ord.status = "APROVADO";
          await interaction.reply({ content: `✅ Pedido #${orderId} aprovado.`, ephemeral: true });
          log(interaction.guild, `✅ Pedido #${orderId} aprovado por <@${interaction.user.id}>`);

          // entrega automática de códigos (se houver)
          const codeItems = ord.items
            .map(it => {
              const p = DB.products.find(x => x.id === it.id);
              return { it, p };
            })
            .filter(x => x.p && x.p.type === "CODE");

          if (codeItems.length > 0) {
            const delivered = [];
            for (const { it, p } of codeItems) {
              const key = p.stockKey;
              for (let i = 0; i < it.qty; i++) {
                const arr = DB.stock[key] || [];
                const code = arr.shift();
                if (!code) {
                  delivered.push(`❌ Sem estoque para ${p.name}`);
                } else {
                  delivered.push(`✅ ${p.name}: \`${code}\``);
                }
                DB.stock[key] = arr;
              }
            }
            saveDb(DB);

            // manda por DM para o comprador
            const buyer = await client.users.fetch(ord.userId).catch(() => null);
            if (buyer) {
              buyer.send({
                content:
                  `📦 **Entrega automática — Pedido #${orderId}**\n\n` +
                  delivered.join("\n") +
                  `\n\nObrigado pela compra!`
              }).catch(() => {});
            }

            // também no canal do carrinho
            const ch = await interaction.guild.channels.fetch(ord.cartChannelId).catch(() => null);
            if (ch) ch.send({ content: `📦 **Entrega automática enviada por DM** para <@${ord.userId}>.\n\n${delivered.join("\n")}` }).catch(() => {});

            ord.delivered = true;
            ord.status = "ENTREGUE";
            log(interaction.guild, `📦 Entrega automática concluída no pedido #${orderId}`);
          }

          return;
        }

        if (action === "reject") {
          ord.status = "RECUSADO";
          await interaction.reply({ content: `❌ Pedido #${orderId} recusado.`, ephemeral: true });
          log(interaction.guild, `❌ Pedido #${orderId} recusado por <@${interaction.user.id}>`);
          const ch = await interaction.guild.channels.fetch(ord.cartChannelId).catch(() => null);
          if (ch) ch.send({ content: `❌ Pedido **#${orderId}** foi **RECUSADO** pela staff.` }).catch(() => {});
          return;
        }

        if (action === "deliver") {
          ord.status = "ENTREGUE";
          ord.delivered = true;
          await interaction.reply({ content: `📦 Pedido #${orderId} marcado como ENTREGUE.`, ephemeral: true });
          log(interaction.guild, `📦 Pedido #${orderId} marcado como entregue por <@${interaction.user.id}>`);
          const ch = await interaction.guild.channels.fetch(ord.cartChannelId).catch(() => null);
          if (ch) ch.send({ content: `📦 Pedido **#${orderId}** foi marcado como **ENTREGUE**.` }).catch(() => {});
          return;
        }
      }

      // nav
      if (interaction.customId === "astro:back") {
        return interaction.update({
          content: mainPanelText(),
          components: mainPanelComponents(isStaff(interaction.member)),
        });
      }

      if (interaction.customId === "astro:help") {
        return interaction.reply({
          content: "📞 **Suporte:** fale com a staff do servidor. Se quiser, eu posso abrir um canal privado pelo checkout.",
          ephemeral: true,
        });
      }

      if (interaction.customId === "astro:tos") {
        return interaction.reply({
          content:
            "📜 **Termos (resumo):**\n" +
            "• Compras digitais podem levar alguns minutos.\n" +
            "• Pagamento confirmado = início do atendimento.\n" +
            "• Evite chargeback. Fraudes geram ban.\n",
          ephemeral: true,
        });
      }

      if (interaction.customId === "astro:admin") {
        if (!isStaff(interaction.member)) return interaction.reply({ content: "❌ Sem permissão.", ephemeral: true });
        return interaction.reply({
          content:
            "👑 **Admin (rápido):**\n" +
            "• Aprovar/recusar/entregar aparece dentro do canal do carrinho quando o usuário enviar comprovante.\n" +
            "• Estoque de códigos está no `db.json` (chave `stock`).\n",
          ephemeral: true,
        });
      }

      // shop
      if (interaction.customId === "astro:shop") {
        return interaction.update({
          content: shopText(),
          components: shopButtons(),
        });
      }

      // add product
      if (interaction.customId.startsWith("astro:add:")) {
        const pid = interaction.customId.split(":").pop();
        const p = DB.products.find(x => x.id === pid);
        if (!p) return interaction.reply({ content: "❌ Produto inválido.", ephemeral: true });

        const found = cart.items.find(x => x.id === pid);
        if (found) found.qty += 1;
        else cart.items.push({ id: pid, qty: 1 });

        await interaction.reply({ content: `✅ Adicionado ao carrinho: **${p.name}**`, ephemeral: true });
        log(interaction.guild, `➕ <@${userId}> adicionou **${p.name}** ao carrinho`);
        return;
      }

      // cart
      if (interaction.customId === "astro:cart") {
        return interaction.reply({
          content: cartViewText(cart),
          components: cartButtons(cart),
          ephemeral: true,
        });
      }

      // coupon modal
      if (interaction.customId === "astro:coupon") {
        const modal = new ModalBuilder().setCustomId("astro:modal:coupon").setTitle("Cupom de desconto");
        const input = new TextInputBuilder()
          .setCustomId("coupon")
          .setLabel("Digite o cupom (ex: ASTRO10)")
          .setStyle(TextInputStyle.Short)
          .setRequired(true);
        modal.addComponents(new ActionRowBuilder().addComponents(input));
        return interaction.showModal(modal);
      }

      // qty modal
      if (interaction.customId === "astro:qty") {
        const modal = new ModalBuilder().setCustomId("astro:modal:qty").setTitle("Editar quantidades");
        const example = cart.items.map(it => `${it.id}=${it.qty}`).join(",");
        const input = new TextInputBuilder()
          .setCustomId("qty")
          .setLabel("Formato: ff110=2,rbx400=1 (0 remove)")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setValue(example || "ff110=1");
        modal.addComponents(new ActionRowBuilder().addComponents(input));
        return interaction.showModal(modal);
      }

      // clear cart
      if (interaction.customId === "astro:clear") {
        cart.items = [];
        cart.coupon = null;
        await interaction.reply({ content: "🧹 Carrinho limpo.", ephemeral: true });
        log(interaction.guild, `🧹 <@${userId}> limpou o carrinho`);
        return;
      }

      // checkout
      if (interaction.customId === "astro:checkout") {
        if (cart.items.length === 0) {
          return interaction.reply({ content: "🧺 Seu carrinho está vazio.", ephemeral: true });
        }

        return interaction.reply({
          content: checkoutText(cart),
          components: checkoutButtons(),
          ephemeral: true,
        });
      }

      // open cart channel + create order
      if (interaction.customId === "astro:open_cart_channel") {
        if (cart.items.length === 0) return interaction.reply({ content: "🧺 Carrinho vazio.", ephemeral: true });

        const { total } = cartLines(cart);
        const orderId = String(orderSeq++).padStart(4, "0");

        // criar canal privado "carrinho_..."
        const guild = interaction.guild;
        const perms = [
          { id: guild.roles.everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] },
          { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] },
        ];
        if (STAFF_ROLE_ID) {
          perms.push({ id: STAFF_ROLE_ID, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] });
        }

        const ch = await guild.channels.create({
          name: `carrinho_${interaction.user.username}_${Date.now().toString().slice(-6)}`,
          type: ChannelType.GuildText,
          parent: CART_CATEGORY_ID || null,
          permissionOverwrites: perms,
        });

        const orderData = {
          id: orderId,
          userId: interaction.user.id,
          items: JSON.parse(JSON.stringify(cart.items)),
          coupon: cart.coupon,
          total,
          cartChannelId: ch.id,
          status: "AGUARDANDO_PAGAMENTO",
          createdAt: Date.now(),
          delivered: false,
          proofText: "",
        };

        orders.set(orderId, orderData);

        // mensagem no canal carrinho
        await ch.send({
          content:
            `🛒 **Canal do Carrinho** — <@${interaction.user.id}>\n` +
            `**Pedido #${orderId}**\n\n` +
            `${cartViewText(cart)}\n\n` +
            `**Pagamento (manual):**\n` +
            `PIX: \`${PIX_KEY}\`\n` +
            `Mercado Pago: ${MP_LINK}\n\n` +
            `Quando pagar, clique em **📤 Enviar comprovante**.`,
          components: [
            new ActionRowBuilder().addComponents(
              new ButtonBuilder().setCustomId(`astro:proof:${orderId}`).setLabel("📤 Enviar comprovante").setStyle(ButtonStyle.Primary),
              new ButtonBuilder().setCustomId(`astro:close:${orderId}`).setLabel("🔒 Fechar").setStyle(ButtonStyle.Secondary),
            )
          ]
        });

        await interaction.reply({
          content: `✅ Canal criado: <#${ch.id}>\nPedido **#${orderId}** — Total: **${money(total)}**`,
          ephemeral: true,
        });

        log(guild, `🧾 Pedido **#${orderId}** criado por <@${interaction.user.id}> — Total ${money(total)} — Canal <#${ch.id}>`);
        return;
      }

      // proof modal
      if (interaction.customId.startsWith("astro:proof:")) {
        const orderId = interaction.customId.split(":").pop();
        const ord = orders.get(orderId);
        if (!ord) return interaction.reply({ content: "❌ Pedido não encontrado.", ephemeral: true });
        if (interaction.user.id !== ord.userId && !isStaff(interaction.member)) {
          return interaction.reply({ content: "❌ Sem permissão.", ephemeral: true });
        }

        const modal = new ModalBuilder().setCustomId(`astro:modal:proof:${orderId}`).setTitle("Enviar comprovante");
        const input = new TextInputBuilder()
          .setCustomId("proof")
          .setLabel("Cole o TXID / info do Pix (ou 'pago')")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false);
        modal.addComponents(new ActionRowBuilder().addComponents(input));
        return interaction.showModal(modal);
      }

      // close channel
      if (interaction.customId.startsWith("astro:close:")) {
        const orderId = interaction.customId.split(":").pop();
        const ord = orders.get(orderId);
        if (!ord) return interaction.reply({ content: "❌ Pedido não encontrado.", ephemeral: true });

        if (interaction.user.id !== ord.userId && !isStaff(interaction.member)) {
          return interaction.reply({ content: "❌ Sem permissão.", ephemeral: true });
        }

        await interaction.reply({ content: "🔒 Canal será fechado.", ephemeral: true });
        log(interaction.guild, `🔒 Pedido #${orderId} canal fechado por <@${interaction.user.id}>`);

        setTimeout(async () => {
          const ch = await interaction.guild.channels.fetch(ord.cartChannelId).catch(() => null);
          if (ch) ch.delete().catch(() => {});
        }, 1500);
        return;
      }

      return;
    }
  } catch (e) {
    console.error(e);
    if (interaction.replied || interaction.deferred) {
      return interaction.followUp({ content: "⚠️ Ocorreu um erro. Veja os logs.", ephemeral: true }).catch(() => {});
    }
    return interaction.reply({ content: "⚠️ Ocorreu um erro. Veja os logs.", ephemeral: true }).catch(() => {});
  }
});

client.login(TOKEN);
