require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  SlashCommandBuilder,
  REST,
  Routes,
  PermissionFlagsBits,
  ActionRowBuilder,
  StringSelectMenuBuilder,
} = require("discord.js");
const crypto = require("crypto");

const TOKEN = process.env.DISCORD_TOKEN;
const GUILD_ID = process.env.GUILD_ID || "1420742723991900233";
const CHANNEL_ID = process.env.CHANNEL_ID || "1559955029627244705";
const STAFF_ROLE_ID = process.env.STAFF_ROLE_ID || "1559959552710021302";
const NEWBIE_ROLE_ID = process.env.NEWBIE_ROLE_ID || ""; // Заполнить позже в Render

const BOT_NAME = "Lunar Кадровый Аудит";
const COLOR_GREEN = 0x2ecc71;
const COLOR_RED = 0xe74c3c;
const POSITION_PREFIX = "lunar_accept_position:";
const PENDING_TTL_MS = 2 * 60 * 1000;

if (!TOKEN) {
  console.error("❌ Не задана переменная DISCORD_TOKEN в окружении.");
  process.exit(1);
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
});

const pendingAcceptances = new Map();

const positions = [
  { label: "LA | *Owner*", value: "owner_1", logged: "LA | *Owner*" },
  { label: "LA | *Owner*", value: "owner_2", logged: "LA | *Owner*" },
  { label: "LA | *Dep.Leader*", value: "dep_leader", logged: "LA |  *Dep.Leader*" },
  { label: "LA | *Recrut*", value: "recruit", logged: "LA | *Recrut*" },
  { label: "LA | Lunar", value: "lunar", logged: "LA | Lunar" },
];

const commands = [
  new SlashCommandBuilder()
    .setName("принятие")
    .setDescription("Записать принятие сотрудника")
    .addUserOption(option =>
      option.setName("участник").setDescription("Кого принимаем").setRequired(true)
    )
    .addStringOption(option =>
      option.setName("ник_статик").setDescription("Игровой ник и статик").setRequired(true).setMaxLength(100)
    ),
  new SlashCommandBuilder()
    .setName("выдача_ролей")
    .setDescription("Выдать участнику роль с проверкой иерархии")
    .addUserOption(option =>
      option.setName("участник").setDescription("Кому выдать роль").setRequired(true)
    )
    .addStringOption(option =>
      option.setName("роль").setDescription("Роль, которую нужно выдать").setRequired(true).setAutocomplete(true)
    ),
].map(command => command.toJSON());

function makeEmbed(color, title, description) {
  return new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setDescription(description || null)
    .setFooter({ text: BOT_NAME })
    .setTimestamp(new Date());
}

function errorEmbed(message) {
  return makeEmbed(COLOR_RED, "❌ Ошибка", message);
}

function successEmbed(title) {
  return makeEmbed(COLOR_GREEN, `✅ ${title}`);
}

function hasStaffRole(member) {
  return Boolean(member?.roles?.cache?.has(STAFF_ROLE_ID));
}

async function replyPublic(interaction, embed, usersToMention = []) {
  // Разрешаем упоминать только явно указанных пользователей; роли не пингуются.
  const payload = { embeds: [embed], allowedMentions: { parse: [], users: usersToMention, roles: [], repliedUser: false } };
  if (interaction.deferred || interaction.replied) {
    return interaction.editReply(payload);
  }
  return interaction.reply(payload);
}

async function checkCommandContext(interaction) {
  if (!interaction.inGuild() || interaction.guildId !== GUILD_ID) {
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ embeds: [errorEmbed("Эта команда доступна только на настроенном сервере.")], ephemeral: true }).catch(() => {});
    }
    return false;
  }

  if (interaction.channelId !== CHANNEL_ID) {
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        embeds: [errorEmbed(`Используйте команды только в канале <#${CHANNEL_ID}>.`)],
        ephemeral: true,
        allowedMentions: { parse: [] },
      }).catch(() => {});
    }
    return false;
  }

  return true;
}

async function getMember(guild, userId) {
  try {
    return await guild.members.fetch(userId);
  } catch {
    return null;
  }
}

function canAssignRole({ issuer, recipient, role, botMember }) {
  if (!issuer || !recipient || !role || !botMember) return false;
  if (role.id === issuer.guild.id || role.managed) return false;
  if (role.position >= issuer.roles.highest.position) return false;
  if (role.position >= recipient.roles.highest.position) return false;
  if (role.position >= botMember.roles.highest.position) return false;
  return true;
}

async function handleAcceptance(interaction) {
  // Проверяем канал до доступа; сообщение в чужом канале будет только для исполнителя.
  if (!(await checkCommandContext(interaction))) return;

  const issuer = await getMember(interaction.guild, interaction.user.id);
  if (!hasStaffRole(issuer)) {
    // Отклонить без публичного сообщения и без ответа пользователю.
    await interaction.deferReply({ ephemeral: true }).catch(() => {});
    await interaction.deleteReply().catch(() => {});
    return;
  }

  const targetUser = interaction.options.getUser("участник", true);
  const gameNick = interaction.options.getString("ник_статик", true).trim();
  const target = await getMember(interaction.guild, targetUser.id);

  if (!target || !gameNick) {
    await replyPublic(interaction, errorEmbed("Не удалось получить участника или игровые данные."));
    return;
  }

  const requestId = crypto.randomBytes(8).toString("hex");
  pendingAcceptances.set(requestId, {
    guildId: interaction.guildId,
    channelId: interaction.channelId,
    issuerId: interaction.user.id,
    targetId: target.id,
    gameNick,
    createdAt: Date.now(),
  });

  const menu = new StringSelectMenuBuilder()
    .setCustomId(`${POSITION_PREFIX}${requestId}`)
    .setPlaceholder("Выберите должность")
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(positions.map(p => ({
      label: p.label,
      value: p.value,
      description: "Записать эту должность в журнал",
    })));

  const row = new ActionRowBuilder().addComponents(menu);
  await interaction.reply({
    content: `**Принятие сотрудника:** ${target}\n**Игровой ник/статик:** ${gameNick}\nВыберите должность:`,
    components: [row],
    allowedMentions: { parse: [], users: [], roles: [] },
  });

  setTimeout(() => pendingAcceptances.delete(requestId), PENDING_TTL_MS).unref?.();
}

async function handleAcceptancePosition(interaction) {
  const requestId = interaction.customId.slice(POSITION_PREFIX.length);
  const pending = pendingAcceptances.get(requestId);

  if (!pending || Date.now() - pending.createdAt > PENDING_TTL_MS) {
    await interaction.reply({ embeds: [errorEmbed("Выбор должности истёк. Запустите команду ещё раз.")], ephemeral: true });
    return;
  }

  if (interaction.user.id !== pending.issuerId) {
    await interaction.reply({ embeds: [errorEmbed("Этот выбор предназначен другому сотруднику.")], ephemeral: true });
    return;
  }

  if (interaction.guildId !== pending.guildId || interaction.channelId !== pending.channelId) {
    await interaction.reply({ embeds: [errorEmbed("Выбор можно завершить только в исходном канале.")], ephemeral: true });
    return;
  }

  await interaction.deferUpdate();
  pendingAcceptances.delete(requestId);

  const guild = interaction.guild;
  const issuer = await getMember(guild, pending.issuerId);
  const target = await getMember(guild, pending.targetId);
  const position = positions.find(p => p.value === interaction.values[0]);

  if (!issuer || !hasStaffRole(issuer) || !target || !position) {
    await interaction.message.edit({ content: "Принятие не завершено: данные участника или права недоступны.", components: [] }).catch(() => {});
    await interaction.channel.send({ embeds: [errorEmbed("Не удалось завершить принятие: участник или права недоступны.")], allowedMentions: { parse: [] } });
    return;
  }

  const embed = successEmbed("Принятие сотрудника")
    .addFields(
      { name: "Исполнитель", value: `<@${pending.issuerId}>`, inline: true },
      { name: "Принят сотрудник", value: `<@${pending.targetId}>`, inline: true },
      { name: "Игровой ник / статик", value: pending.gameNick, inline: false },
      { name: "Должность", value: position.logged, inline: false },
    );

  // Принятие логируется независимо от настроенности роли новичка.
  await interaction.channel.send({
    embeds: [embed],
    allowedMentions: { parse: [], users: [pending.issuerId, pending.targetId], roles: [] },
  });

  await interaction.message.edit({ content: "Принятие записано в журнал.", components: [] }).catch(() => {});

  if (!NEWBIE_ROLE_ID) {
    await interaction.channel.send({
      embeds: [errorEmbed("Принятие записано, но роль новичка не настроена. Укажите NEWBIE_ROLE_ID в переменных Render.")],
      allowedMentions: { parse: [] },
    });
    return;
  }

  const newbieRole = guild.roles.cache.get(NEWBIE_ROLE_ID) || await guild.roles.fetch(NEWBIE_ROLE_ID).catch(() => null);
  const botMember = guild.members.me || await guild.members.fetchMe().catch(() => null);

  if (!newbieRole || !botMember || newbieRole.managed || newbieRole.position >= botMember.roles.highest.position) {
    await interaction.channel.send({
      embeds: [errorEmbed("Принятие записано, но роль новичка недоступна или находится выше роли бота.")],
      allowedMentions: { parse: [] },
    });
    return;
  }

  try {
    if (!target.roles.cache.has(newbieRole.id)) {
      await target.roles.add(newbieRole, `Принятие сотрудника исполнителем ${interaction.user.tag}`);
    }
  } catch (error) {
    console.error("Не удалось выдать роль новичка:", error);
    await interaction.channel.send({
      embeds: [errorEmbed("Принятие записано, но выдать роль новичка не удалось. Проверьте права бота и иерархию ролей.")],
      allowedMentions: { parse: [] },
    });
  }
}

async function handleRoleAutocomplete(interaction) {
  if (interaction.guildId !== GUILD_ID || interaction.channelId !== CHANNEL_ID) {
    await interaction.respond([]);
    return;
  }

  const issuer = await getMember(interaction.guild, interaction.user.id);
  if (!hasStaffRole(issuer)) {
    await interaction.respond([]);
    return;
  }

  const targetUser = interaction.options.getUser("участник");
  if (!targetUser) {
    await interaction.respond([]);
    return;
  }

  const recipient = await getMember(interaction.guild, targetUser.id);
  const botMember = interaction.guild.members.me || await interaction.guild.members.fetchMe().catch(() => null);
  if (!recipient || !botMember || !issuer) {
    await interaction.respond([]);
    return;
  }

  const query = (interaction.options.getFocused() || "").toLocaleLowerCase("ru");
  const choices = interaction.guild.roles.cache
    .filter(role => canAssignRole({ issuer, recipient, role, botMember }))
    .filter(role => !recipient.roles.cache.has(role.id))
    .filter(role => role.name.toLocaleLowerCase("ru").includes(query))
    .sort((a, b) => b.position - a.position)
    .first(25)
    .map(role => ({ name: role.name.slice(0, 100), value: role.id }));

  await interaction.respond(choices).catch(() => {});
}

async function handleRoleGrant(interaction) {
  if (!(await checkCommandContext(interaction))) return;

  const issuer = await getMember(interaction.guild, interaction.user.id);
  if (!hasStaffRole(issuer)) {
    await interaction.deferReply({ ephemeral: true }).catch(() => {});
    await interaction.deleteReply().catch(() => {});
    return;
  }

  const targetUser = interaction.options.getUser("участник", true);
  const roleId = interaction.options.getString("роль", true);
  const recipient = await getMember(interaction.guild, targetUser.id);
  const role = interaction.guild.roles.cache.get(roleId) || await interaction.guild.roles.fetch(roleId).catch(() => null);
  const botMember = interaction.guild.members.me || await interaction.guild.members.fetchMe().catch(() => null);

  if (!recipient || !role || !botMember) {
    await replyPublic(interaction, errorEmbed("Не удалось получить участника или роль."));
    return;
  }
  if (recipient.id === issuer.id) {
    await replyPublic(interaction, errorEmbed("Нельзя выдавать роль самому себе."));
    return;
  }
  if (recipient.roles.cache.has(role.id)) {
    await replyPublic(interaction, errorEmbed("У участника уже есть эта роль."));
    return;
  }
  if (!canAssignRole({ issuer, recipient, role, botMember })) {
    await replyPublic(interaction, errorEmbed("Выдача запрещена правилами иерархии ролей или ролью, которой бот не может управлять."));
    return;
  }

  try {
    await recipient.roles.add(role, `Выдача роли исполнителем ${interaction.user.tag}`);
    const embed = successEmbed("Выдача роли")
      .addFields(
        { name: "Исполнитель", value: `<@${issuer.id}>`, inline: true },
        { name: "Получатель", value: `<@${recipient.id}>`, inline: true },
        { name: "Роль", value: `${role} (\`${role.name}\`)`, inline: false },
      );
    await replyPublic(interaction, embed, [issuer.id, recipient.id]);
  } catch (error) {
    console.error("Не удалось выдать роль:", error);
    await replyPublic(interaction, errorEmbed("Не удалось выдать роль. Проверьте права бота и иерархию ролей."));
  }
}

client.once("ready", async () => {
  console.log(`✅ ${BOT_NAME} запущен как ${client.user.tag}`);
  try {
    const rest = new REST({ version: "10" }).setToken(TOKEN);
    await rest.put(Routes.applicationGuildCommands(client.user.id, GUILD_ID), { body: commands });
    console.log("✅ Команды сервера зарегистрированы.");
  } catch (error) {
    console.error("❌ Ошибка регистрации slash-команд:", error);
  }
});

client.on("interactionCreate", async interaction => {
  try {
    if (interaction.isAutocomplete()) {
      if (interaction.commandName === "выдача_ролей") await handleRoleAutocomplete(interaction);
      return;
    }

    if (interaction.isStringSelectMenu() && interaction.customId.startsWith(POSITION_PREFIX)) {
      await handleAcceptancePosition(interaction);
      return;
    }

    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === "принятие") {
      await handleAcceptance(interaction);
    } else if (interaction.commandName === "выдача_ролей") {
      await handleRoleGrant(interaction);
    }
  } catch (error) {
    console.error("Ошибка обработки interaction:", error);
    const embed = errorEmbed("Произошла непредвиденная ошибка. Проверьте настройки бота и попробуйте снова.");
    if (interaction.isAutocomplete()) {
      await interaction.respond([]).catch(() => {});
    } else if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
      await interaction.reply({ embeds: [embed], ephemeral: true, allowedMentions: { parse: [] } }).catch(() => {});
    }
  }
});

client.on("error", error => console.error("Discord client error:", error));
process.on("unhandledRejection", error => console.error("Unhandled rejection:", error));

client.login(TOKEN);
