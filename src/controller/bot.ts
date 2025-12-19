import {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ComponentType,
  ChatInputCommandInteraction,
  ButtonInteraction,
  StringSelectMenuInteraction,
} from 'discord.js';
import config from '../config.js';
import plexClient from '../plex/client.js';
import { getVideoStreamer } from '../stream/video-streamer.js';
import { formatDuration, parseTimeString, getNextEpisode } from '../plex/library.js';
import type { PlexMediaItem } from '../types/index.js';

// Store search results per user
const searchSessions = new Map<string, { results: PlexMediaItem[], timestamp: number }>();
const SESSION_TIMEOUT = 10 * 60 * 1000; // 10 minutes

// Discord bot client
let controllerBot: Client | null = null;

// Slash commands definition
const commands = [
  new SlashCommandBuilder()
    .setName('search')
    .setDescription('Search for movies and TV shows on Plex')
    .addStringOption(option =>
      option.setName('query')
        .setDescription('Search query')
        .setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName('play')
    .setDescription('Play media from your last search')
    .addIntegerOption(option =>
      option.setName('number')
        .setDescription('Result number to play')
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(20)
    )
    .addStringOption(option =>
      option.setName('episode')
        .setDescription('Episode to play (e.g., S02E05)')
        .setRequired(false)
    ),
  new SlashCommandBuilder()
    .setName('stop')
    .setDescription('Stop the current stream'),
  new SlashCommandBuilder()
    .setName('pause')
    .setDescription('Pause or resume playback'),
  new SlashCommandBuilder()
    .setName('seek')
    .setDescription('Seek to a specific time')
    .addStringOption(option =>
      option.setName('time')
        .setDescription('Time to seek to (e.g., 1:30:00 or 45:00)')
        .setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName('skip')
    .setDescription('Skip to the next episode'),
  new SlashCommandBuilder()
    .setName('ff')
    .setDescription('Fast forward')
    .addStringOption(option =>
      option.setName('time')
        .setDescription('Time to skip forward (default: 30s)')
        .setRequired(false)
    ),
  new SlashCommandBuilder()
    .setName('rw')
    .setDescription('Rewind')
    .addStringOption(option =>
      option.setName('time')
        .setDescription('Time to rewind (default: 30s)')
        .setRequired(false)
    ),
  new SlashCommandBuilder()
    .setName('np')
    .setDescription('Show what\'s currently playing'),
  new SlashCommandBuilder()
    .setName('volume')
    .setDescription('Adjust playback volume')
    .addIntegerOption(option =>
      option.setName('level')
        .setDescription('Volume level (0-200)')
        .setRequired(true)
        .setMinValue(0)
        .setMaxValue(200)
    ),
  new SlashCommandBuilder()
    .setName('yt')
    .setDescription('Play a YouTube video')
    .addStringOption(option =>
      option.setName('url')
        .setDescription('YouTube URL')
        .setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName('url')
    .setDescription('Play a stream URL directly')
    .addStringOption(option =>
      option.setName('url')
        .setDescription('Stream URL (m3u8, mp4, etc.)')
        .setRequired(true)
    )
    .addStringOption(option =>
      option.setName('title')
        .setDescription('Optional title for the stream')
        .setRequired(false)
    ),
].map(cmd => cmd.toJSON());

export async function initControllerBot(): Promise<Client | null> {
  const botToken = config.discord.botToken;
  
  if (!botToken) {
    console.log('[Controller] No bot token configured, skipping controller bot');
    return null;
  }

  controllerBot = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildVoiceStates,
    ],
  });

  // Register slash commands
  const rest = new REST().setToken(botToken);

  try {
    console.log('[Controller] Registering slash commands...');
    
    if (config.discord.clientId) {
      await rest.put(
        Routes.applicationCommands(config.discord.clientId),
        { body: commands }
      );
      console.log('[Controller] Slash commands registered globally');
    }
  } catch (error) {
    console.error('[Controller] Failed to register commands:', error);
  }

  // Handle interactions
  controllerBot.on('interactionCreate', async (interaction) => {
    try {
      if (interaction.isChatInputCommand()) {
        await handleSlashCommand(interaction);
      } else if (interaction.isButton()) {
        await handleButton(interaction);
      } else if (interaction.isStringSelectMenu()) {
        await handleSelectMenu(interaction);
      }
    } catch (error) {
      console.error('[Controller] Interaction error:', error);
      if (interaction.isRepliable()) {
        const reply = { content: '❌ An error occurred', ephemeral: true };
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp(reply);
        } else {
          await interaction.reply(reply);
        }
      }
    }
  });

  controllerBot.once('ready', () => {
    console.log(`[Controller] Bot ready as ${controllerBot?.user?.tag}`);
  });

  await controllerBot.login(botToken);
  return controllerBot;
}

async function handleSlashCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  const { commandName } = interaction;

  switch (commandName) {
    case 'search':
      await handleSearch(interaction);
      break;
    case 'play':
      await handlePlay(interaction);
      break;
    case 'stop':
      await handleStop(interaction);
      break;
    case 'pause':
      await handlePause(interaction);
      break;
    case 'seek':
      await handleSeek(interaction);
      break;
    case 'skip':
      await handleSkip(interaction);
      break;
    case 'ff':
      await handleFastForward(interaction);
      break;
    case 'rw':
      await handleRewind(interaction);
      break;
    case 'np':
      await handleNowPlaying(interaction);
      break;
    case 'volume':
      await handleVolume(interaction);
      break;
    case 'yt':
      await handleYouTube(interaction);
      break;
    case 'url':
      await handleUrl(interaction);
      break;
  }
}

async function handleSearch(interaction: ChatInputCommandInteraction): Promise<void> {
  const query = interaction.options.getString('query', true);
  
  await interaction.deferReply();

  const results = await plexClient.search(query);

  if (results.length === 0) {
    await interaction.editReply('❌ No results found');
    return;
  }

  // Store results
  searchSessions.set(interaction.user.id, {
    results,
    timestamp: Date.now(),
  });

  // Build embed
  const embed = new EmbedBuilder()
    .setTitle(`🔍 Search: "${query}"`)
    .setColor(0xe5a00d)
    .setDescription(
      results.slice(0, 10).map((item, i) => {
        const type = item.type === 'show' ? '📺' : '🎬';
        const year = item.year ? ` (${item.year})` : '';
        return `**${i + 1}.** ${type} ${item.title}${year}`;
      }).join('\n')
    )
    .setFooter({ text: 'Select a result below or use /play <number>' });

  // Build select menu
  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId('search_select')
    .setPlaceholder('Select media to play...')
    .addOptions(
      results.slice(0, 10).map((item, i) => ({
        label: `${i + 1}. ${item.title}`.substring(0, 100),
        description: `${item.type === 'show' ? 'TV Show' : 'Movie'}${item.year ? ` (${item.year})` : ''}`.substring(0, 100),
        value: `${i}`,
      }))
    );

  const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);

  await interaction.editReply({ embeds: [embed], components: [row] });
}

async function handlePlay(interaction: ChatInputCommandInteraction): Promise<void> {
  const number = interaction.options.getInteger('number', true);
  const episodeStr = interaction.options.getString('episode');

  const session = searchSessions.get(interaction.user.id);
  if (!session || Date.now() - session.timestamp > SESSION_TIMEOUT) {
    await interaction.reply({ content: '❌ No search results. Use `/search` first.', ephemeral: true });
    return;
  }

  const mediaItem = session.results[number - 1];
  if (!mediaItem) {
    await interaction.reply({ content: '❌ Invalid selection', ephemeral: true });
    return;
  }

  await interaction.deferReply();
  await startPlayback(interaction, mediaItem, episodeStr);
}

async function startPlayback(
  interaction: ChatInputCommandInteraction | StringSelectMenuInteraction,
  mediaItem: PlexMediaItem,
  episodeStr?: string | null
): Promise<void> {
  // Get voice channel of user
  const member = interaction.guild?.members.cache.get(interaction.user.id);
  const voiceChannel = member?.voice.channel;

  if (!voiceChannel) {
    await interaction.editReply('❌ You must be in a voice channel');
    return;
  }

  let itemToPlay = mediaItem;

  // Handle TV show episode selection
  if (mediaItem.type === 'show') {
    let targetSeason = 1;
    let targetEpisode = 1;

    if (episodeStr) {
      const match = episodeStr.toUpperCase().match(/S(\d+)E?(\d+)?/);
      if (match) {
        targetSeason = parseInt(match[1], 10);
        targetEpisode = match[2] ? parseInt(match[2], 10) : 1;
      }
    }

    const episode = await plexClient.getEpisode(mediaItem.ratingKey, targetSeason, targetEpisode);
    if (!episode) {
      await interaction.editReply(`❌ Episode S${String(targetSeason).padStart(2, '0')}E${String(targetEpisode).padStart(2, '0')} not found`);
      return;
    }
    itemToPlay = episode;
  }

  // Get stream URL
  const streamInfo = await plexClient.getDirectStreamUrl(itemToPlay.ratingKey);
  if (!streamInfo) {
    await interaction.editReply('❌ Could not get stream URL');
    return;
  }

  // Build title
  let title = itemToPlay.title;
  if (itemToPlay.type === 'episode' && itemToPlay.grandparentTitle) {
    const season = itemToPlay.parentIndex ? `S${String(itemToPlay.parentIndex).padStart(2, '0')}` : '';
    const episode = itemToPlay.index ? `E${String(itemToPlay.index).padStart(2, '0')}` : '';
    title = `${itemToPlay.grandparentTitle} ${season}${episode} - ${itemToPlay.title}`;
  }

  const duration = itemToPlay.duration ? formatDuration(itemToPlay.duration) : 'Unknown';

  // Create playback controls
  const controlRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId('ctrl_pause').setEmoji('⏸️').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('ctrl_stop').setEmoji('⏹️').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('ctrl_rw').setEmoji('⏪').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('ctrl_ff').setEmoji('⏩').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('ctrl_skip').setEmoji('⏭️').setStyle(ButtonStyle.Primary),
  );

  const embed = new EmbedBuilder()
    .setTitle('📺 Now Playing')
    .setDescription(`**${title}**`)
    .addFields({ name: 'Duration', value: duration, inline: true })
    .setColor(0x00ff00);

  if (itemToPlay.thumb) {
    embed.setThumbnail(`${config.plex.url}${itemToPlay.thumb}?X-Plex-Token=${config.plex.token}`);
  }

  await interaction.editReply({ embeds: [embed], components: [controlRow] });

  // Start stream
  const videoStreamer = getVideoStreamer();
  videoStreamer.startStream(
    interaction.guild!.id,
    voiceChannel.id,
    itemToPlay,
    streamInfo.url,
    0,
    interaction.user.id
  ).catch(err => console.error('[Controller] Stream error:', err));
}

async function handleStop(interaction: ChatInputCommandInteraction): Promise<void> {
  const videoStreamer = getVideoStreamer();
  await videoStreamer.stopStream(interaction.guild!.id);
  await interaction.reply('⏹️ Stopped playback');
}

async function handlePause(interaction: ChatInputCommandInteraction): Promise<void> {
  const videoStreamer = getVideoStreamer();
  const session = videoStreamer.getSession(interaction.guild!.id);

  if (!session) {
    await interaction.reply({ content: '❌ Nothing is playing', ephemeral: true });
    return;
  }

  if (session.isPaused) {
    await videoStreamer.resumeStream(interaction.guild!.id);
    await interaction.reply('▶️ Resumed');
  } else {
    await videoStreamer.pauseStream(interaction.guild!.id);
    await interaction.reply('⏸️ Paused');
  }
}

async function handleSeek(interaction: ChatInputCommandInteraction): Promise<void> {
  const timeStr = interaction.options.getString('time', true);
  const timeMs = parseTimeString(timeStr);

  if (timeMs === null) {
    await interaction.reply({ content: '❌ Invalid time format', ephemeral: true });
    return;
  }

  const videoStreamer = getVideoStreamer();
  const success = await videoStreamer.seekStream(interaction.guild!.id, timeMs);

  if (success) {
    await interaction.reply(`⏩ Seeked to ${formatDuration(timeMs)}`);
  } else {
    await interaction.reply({ content: '❌ Failed to seek', ephemeral: true });
  }
}

async function handleSkip(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply();

  const videoStreamer = getVideoStreamer();
  const session = videoStreamer.getSession(interaction.guild!.id);

  if (!session || session.mediaItem.type !== 'episode') {
    await interaction.editReply('❌ Can only skip TV show episodes');
    return;
  }

  const nextEpisode = await getNextEpisode(session.mediaItem);
  if (!nextEpisode) {
    await interaction.editReply('❌ No next episode found');
    return;
  }

  const streamInfo = await plexClient.getDirectStreamUrl(nextEpisode.ratingKey);
  if (!streamInfo) {
    await interaction.editReply('❌ Could not get stream URL');
    return;
  }

  const season = nextEpisode.parentIndex ? `S${String(nextEpisode.parentIndex).padStart(2, '0')}` : '';
  const episode = nextEpisode.index ? `E${String(nextEpisode.index).padStart(2, '0')}` : '';
  const title = `${nextEpisode.grandparentTitle} ${season}${episode} - ${nextEpisode.title}`;

  await videoStreamer.startStream(
    interaction.guild!.id,
    session.channelId,
    nextEpisode,
    streamInfo.url,
    0,
    interaction.user.id
  );

  await interaction.editReply(`⏭️ Now playing: **${title}**`);
}

async function handleFastForward(interaction: ChatInputCommandInteraction): Promise<void> {
  const timeStr = interaction.options.getString('time') || '30';
  const offsetMs = parseTimeString(timeStr) || 30000;

  const videoStreamer = getVideoStreamer();
  const session = videoStreamer.getSession(interaction.guild!.id);

  if (!session) {
    await interaction.reply({ content: '❌ Nothing is playing', ephemeral: true });
    return;
  }

  const currentTime = videoStreamer.getCurrentTime(interaction.guild!.id);
  const newTime = Math.min(currentTime + offsetMs, session.duration);

  const success = await videoStreamer.seekStream(interaction.guild!.id, newTime);

  if (success) {
    await interaction.reply(`⏩ +${formatDuration(offsetMs)} → ${formatDuration(newTime)}`);
  } else {
    await interaction.reply({ content: '❌ Failed to skip forward', ephemeral: true });
  }
}

async function handleRewind(interaction: ChatInputCommandInteraction): Promise<void> {
  const timeStr = interaction.options.getString('time') || '30';
  const offsetMs = parseTimeString(timeStr) || 30000;

  const videoStreamer = getVideoStreamer();
  const session = videoStreamer.getSession(interaction.guild!.id);

  if (!session) {
    await interaction.reply({ content: '❌ Nothing is playing', ephemeral: true });
    return;
  }

  const currentTime = videoStreamer.getCurrentTime(interaction.guild!.id);
  const newTime = Math.max(currentTime - offsetMs, 0);

  const success = await videoStreamer.seekStream(interaction.guild!.id, newTime);

  if (success) {
    await interaction.reply(`⏪ -${formatDuration(offsetMs)} → ${formatDuration(newTime)}`);
  } else {
    await interaction.reply({ content: '❌ Failed to rewind', ephemeral: true });
  }
}

async function handleNowPlaying(interaction: ChatInputCommandInteraction): Promise<void> {
  const videoStreamer = getVideoStreamer();
  const session = videoStreamer.getSession(interaction.guild!.id);

  if (!session) {
    await interaction.reply({ content: '❌ Nothing is playing', ephemeral: true });
    return;
  }

  const currentTime = videoStreamer.getCurrentTime(interaction.guild!.id);
  const duration = session.duration;
  const progress = duration > 0 ? Math.round((currentTime / duration) * 100) : 0;

  let title = session.mediaItem.title;
  if (session.mediaItem.type === 'episode' && session.mediaItem.grandparentTitle) {
    const s = session.mediaItem.parentIndex ? `S${String(session.mediaItem.parentIndex).padStart(2, '0')}` : '';
    const e = session.mediaItem.index ? `E${String(session.mediaItem.index).padStart(2, '0')}` : '';
    title = `${session.mediaItem.grandparentTitle} ${s}${e} - ${session.mediaItem.title}`;
  }

  const progressBar = createProgressBar(progress);

  const embed = new EmbedBuilder()
    .setTitle(session.isPaused ? '⏸️ Paused' : '▶️ Now Playing')
    .setDescription(`**${title}**`)
    .addFields(
      { name: 'Progress', value: `${progressBar}\n${formatDuration(currentTime)} / ${formatDuration(duration)} (${progress}%)` }
    )
    .setColor(session.isPaused ? 0xffaa00 : 0x00ff00);

  await interaction.reply({ embeds: [embed] });
}

async function handleVolume(interaction: ChatInputCommandInteraction): Promise<void> {
  const level = interaction.options.getInteger('level', true);

  const videoStreamer = getVideoStreamer();
  const success = await videoStreamer.setVolume(interaction.guild!.id, level);

  if (success) {
    await interaction.reply(`🔊 Volume set to ${level}%`);
  } else {
    await interaction.reply({ content: '❌ Nothing is playing', ephemeral: true });
  }
}

async function handleYouTube(interaction: ChatInputCommandInteraction): Promise<void> {
  const url = interaction.options.getString('url', true);
  await interaction.deferReply();

  const member = interaction.guild?.members.cache.get(interaction.user.id);
  const voiceChannel = member?.voice.channel;

  if (!voiceChannel) {
    await interaction.editReply('❌ You must be in a voice channel');
    return;
  }

  // Import YouTube functions
  const { spawn } = await import('child_process');

  // Get video info
  const info = await new Promise<any>((resolve) => {
    const ytdlp = spawn('yt-dlp', ['--dump-json', '--no-playlist', '--no-warnings', url]);
    let output = '';
    ytdlp.stdout.on('data', (data) => output += data.toString());
    ytdlp.on('close', (code) => {
      if (code !== 0 || !output) { resolve(null); return; }
      try { resolve(JSON.parse(output)); } catch { resolve(null); }
    });
    ytdlp.on('error', () => resolve(null));
  });

  if (!info) {
    await interaction.editReply('❌ Failed to get video info');
    return;
  }

  // Get stream URLs
  const urls = await new Promise<{ video: string; audio: string | null } | null>((resolve) => {
    const ytdlp = spawn('yt-dlp', ['-g', '-f', 'bestvideo[height<=1080]+bestaudio/best[height<=1080]/best', '--no-playlist', '--no-warnings', url]);
    let output = '';
    ytdlp.stdout.on('data', (data) => output += data.toString());
    ytdlp.on('close', (code) => {
      if (code !== 0 || !output.trim()) { resolve(null); return; }
      const lines = output.trim().split('\n');
      resolve({ video: lines[0], audio: lines[1] || null });
    });
    ytdlp.on('error', () => resolve(null));
  });

  if (!urls) {
    await interaction.editReply('❌ Failed to get stream URL');
    return;
  }

  const mediaItem = {
    ratingKey: `yt-${Date.now()}`,
    key: url,
    title: info.title || 'Unknown',
    type: 'movie' as const,
    duration: (info.duration || 0) * 1000,
    thumb: info.thumbnail,
  };

  const embed = new EmbedBuilder()
    .setTitle('📺 Now Playing')
    .setDescription(`**${info.title}**`)
    .addFields(
      { name: 'Channel', value: info.uploader || info.channel || 'Unknown', inline: true },
      { name: 'Duration', value: info.duration ? formatDuration(info.duration * 1000) : 'Live', inline: true }
    )
    .setColor(0xff0000)
    .setThumbnail(info.thumbnail || null);

  const controlRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId('ctrl_pause').setEmoji('⏸️').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('ctrl_stop').setEmoji('⏹️').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('ctrl_rw').setEmoji('⏪').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('ctrl_ff').setEmoji('⏩').setStyle(ButtonStyle.Secondary),
  );

  await interaction.editReply({ embeds: [embed], components: [controlRow] });

  const videoStreamer = getVideoStreamer();
  videoStreamer.startExternalStream(
    interaction.guild!.id,
    voiceChannel.id,
    mediaItem,
    urls.video,
    interaction.user.id,
    urls.audio
  ).catch(err => console.error('[Controller] YouTube stream error:', err));
}

async function handleUrl(interaction: ChatInputCommandInteraction): Promise<void> {
  const url = interaction.options.getString('url', true);
  const title = interaction.options.getString('title') || 'External Stream';

  const member = interaction.guild?.members.cache.get(interaction.user.id);
  const voiceChannel = member?.voice.channel;

  if (!voiceChannel) {
    await interaction.reply({ content: '❌ You must be in a voice channel', ephemeral: true });
    return;
  }

  await interaction.deferReply();

  const mediaItem = {
    ratingKey: `url-${Date.now()}`,
    key: url,
    title,
    type: 'movie' as const,
    duration: 0,
  };

  const embed = new EmbedBuilder()
    .setTitle('📺 Now Streaming')
    .setDescription(`**${title}**`)
    .setColor(0x0099ff);

  const controlRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId('ctrl_pause').setEmoji('⏸️').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('ctrl_stop').setEmoji('⏹️').setStyle(ButtonStyle.Danger),
  );

  await interaction.editReply({ embeds: [embed], components: [controlRow] });

  const videoStreamer = getVideoStreamer();
  videoStreamer.startExternalStream(
    interaction.guild!.id,
    voiceChannel.id,
    mediaItem,
    url,
    interaction.user.id
  ).catch(err => console.error('[Controller] URL stream error:', err));
}

async function handleButton(interaction: ButtonInteraction): Promise<void> {
  const videoStreamer = getVideoStreamer();
  const guildId = interaction.guild!.id;

  switch (interaction.customId) {
    case 'ctrl_pause': {
      const session = videoStreamer.getSession(guildId);
      if (!session) {
        await interaction.reply({ content: '❌ Nothing is playing', ephemeral: true });
        return;
      }
      if (session.isPaused) {
        await videoStreamer.resumeStream(guildId);
        await interaction.reply({ content: '▶️ Resumed', ephemeral: true });
      } else {
        await videoStreamer.pauseStream(guildId);
        await interaction.reply({ content: '⏸️ Paused', ephemeral: true });
      }
      break;
    }
    case 'ctrl_stop':
      await videoStreamer.stopStream(guildId);
      await interaction.reply({ content: '⏹️ Stopped', ephemeral: true });
      break;
    case 'ctrl_ff': {
      const session = videoStreamer.getSession(guildId);
      if (!session) {
        await interaction.reply({ content: '❌ Nothing is playing', ephemeral: true });
        return;
      }
      const currentTime = videoStreamer.getCurrentTime(guildId);
      const newTime = Math.min(currentTime + 30000, session.duration);
      await videoStreamer.seekStream(guildId, newTime);
      await interaction.reply({ content: `⏩ +30s → ${formatDuration(newTime)}`, ephemeral: true });
      break;
    }
    case 'ctrl_rw': {
      const currentTime = videoStreamer.getCurrentTime(guildId);
      const newTime = Math.max(currentTime - 30000, 0);
      await videoStreamer.seekStream(guildId, newTime);
      await interaction.reply({ content: `⏪ -30s → ${formatDuration(newTime)}`, ephemeral: true });
      break;
    }
    case 'ctrl_skip': {
      await interaction.deferReply({ ephemeral: true });
      const session = videoStreamer.getSession(guildId);
      if (!session || session.mediaItem.type !== 'episode') {
        await interaction.editReply('❌ Can only skip TV episodes');
        return;
      }
      const nextEpisode = await getNextEpisode(session.mediaItem);
      if (!nextEpisode) {
        await interaction.editReply('❌ No next episode');
        return;
      }
      const streamInfo = await plexClient.getDirectStreamUrl(nextEpisode.ratingKey);
      if (!streamInfo) {
        await interaction.editReply('❌ Could not get stream URL');
        return;
      }
      await videoStreamer.startStream(guildId, session.channelId, nextEpisode, streamInfo.url, 0, interaction.user.id);
      const s = nextEpisode.parentIndex ? `S${String(nextEpisode.parentIndex).padStart(2, '0')}` : '';
      const e = nextEpisode.index ? `E${String(nextEpisode.index).padStart(2, '0')}` : '';
      await interaction.editReply(`⏭️ Now: ${nextEpisode.grandparentTitle} ${s}${e}`);
      break;
    }
  }
}

async function handleSelectMenu(interaction: StringSelectMenuInteraction): Promise<void> {
  if (interaction.customId === 'search_select') {
    const session = searchSessions.get(interaction.user.id);
    if (!session) {
      await interaction.reply({ content: '❌ Search expired', ephemeral: true });
      return;
    }

    const index = parseInt(interaction.values[0], 10);
    const mediaItem = session.results[index];

    if (!mediaItem) {
      await interaction.reply({ content: '❌ Invalid selection', ephemeral: true });
      return;
    }

    // If it's a show, show episode selector
    if (mediaItem.type === 'show') {
      await interaction.deferReply();
      await showEpisodeSelector(interaction, mediaItem);
    } else {
      await interaction.deferReply();
      await startPlayback(interaction, mediaItem);
    }
  } else if (interaction.customId.startsWith('episode_select_')) {
    const ratingKey = interaction.customId.replace('episode_select_', '');
    const [seasonNum, episodeNum] = interaction.values[0].split('_').map(Number);
    
    const session = searchSessions.get(interaction.user.id);
    const show = session?.results.find(r => r.ratingKey === ratingKey);

    if (!show) {
      await interaction.reply({ content: '❌ Show not found', ephemeral: true });
      return;
    }

    await interaction.deferReply();
    await startPlayback(interaction, show, `S${seasonNum}E${episodeNum}`);
  }
}

async function showEpisodeSelector(
  interaction: StringSelectMenuInteraction,
  show: PlexMediaItem
): Promise<void> {
  const seasons = await plexClient.getSeasons(show.ratingKey);

  if (!seasons || seasons.length === 0) {
    await interaction.editReply('❌ No seasons found');
    return;
  }

  // Get episodes for first season
  const firstSeason = seasons[0];
  const episodes = await plexClient.getEpisodes(firstSeason.ratingKey);

  if (!episodes || episodes.length === 0) {
    await interaction.editReply('❌ No episodes found');
    return;
  }

  const embed = new EmbedBuilder()
    .setTitle(`📺 ${show.title}`)
    .setDescription(`Select an episode to play\n\n**Season ${firstSeason.index || 1}**`)
    .setColor(0xe5a00d);

  const episodeOptions = episodes.slice(0, 25).map(ep => ({
    label: `E${String(ep.index).padStart(2, '0')}: ${ep.title}`.substring(0, 100),
    description: ep.duration ? formatDuration(ep.duration) : undefined,
    value: `${firstSeason.index || 1}_${ep.index}`,
  }));

  const episodeSelect = new StringSelectMenuBuilder()
    .setCustomId(`episode_select_${show.ratingKey}`)
    .setPlaceholder('Select episode...')
    .addOptions(episodeOptions);

  const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(episodeSelect);

  // Add season buttons if multiple seasons
  const components: ActionRowBuilder<any>[] = [row];

  if (seasons.length > 1) {
    const seasonButtons = seasons.slice(0, 5).map((s, i) =>
      new ButtonBuilder()
        .setCustomId(`season_${show.ratingKey}_${s.ratingKey}`)
        .setLabel(`S${s.index || i + 1}`)
        .setStyle(i === 0 ? ButtonStyle.Primary : ButtonStyle.Secondary)
    );
    components.push(new ActionRowBuilder<ButtonBuilder>().addComponents(seasonButtons));
  }

  await interaction.editReply({ embeds: [embed], components });
}

function createProgressBar(percent: number): string {
  const filled = Math.round(percent / 5);
  const empty = 20 - filled;
  return '▓'.repeat(filled) + '░'.repeat(empty);
}

export function getControllerBot(): Client | null {
  return controllerBot;
}
