const { EmbedBuilder } = require('discord.js');

const sendEmbed = async (interaction, title, description, color = 0x0099FF) => {
  const text = typeof description === 'string' && description.trim().length ? description.trim() : 'No content available.';
  const chunks = text.match(/[\s\S]{1,3900}/g) || [text];
  const build = (desc) => new EmbedBuilder().setTitle(title).setDescription(desc).setColor(color).setTimestamp();
  const send = interaction.deferred || interaction.replied ? interaction.editReply : interaction.reply;
  try {
    await send.call(interaction, { embeds: [build(chunks[0])], content: '' });
  } catch (error) {
    console.error('sendEmbed initial reply failed:', error.message);
    await (interaction.replied ? interaction.followUp : interaction.reply).call(interaction, { embeds: [build(chunks[0])], content: '' });
  }
  for (let i = 1; i < chunks.length; i++) {
    await interaction.followUp({ embeds: [new EmbedBuilder().setDescription(chunks[i]).setColor(color)], content: '' });
  }
};

module.exports = { sendEmbed };