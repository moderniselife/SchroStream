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
  AutocompleteInteraction,
  ActivityType,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ModalSubmitInteraction,
} from 'discord.js';
import config from '../config.js';
import plexClient from '../plex/client.js';
import { getVideoStreamer, getPlaybackPosition } from '../stream/video-streamer.js';
import { formatDuration as formatPlexDuration, parseTimeString, getNextEpisode } from '../plex/library.js';
import type { MediaItem } from '../types/index.js';
import { client as selfbotClient } from '../bot/client.js';
import { getQueue, addToQueue, removeFromQueue, clearQueue, popQueue, peekQueue, formatQueueEntry } from '../data/queue.js';
import { getWatchDeck, formatDeckEntry, markVideoAsFullyWatched, cleanupFullyWatchedVideos } from '../data/watch-deck.js';
import { getYtdlpBaseArgs } from '../youtube/downloader.js';

// Store search results per user
const searchSessions = new Map<string, { results: MediaItem[], timestamp: number }>();
const youtubeSearchSessions = new Map<string, { results: any[], timestamp: number }>();
const youtubeSearchPages = new Map<string, { page: number }>();
const SESSION_TIMEOUT = 10 * 60 * 1000; // 10 minutes

// State tracking for play-enhanced autocomplete
interface PlayEnhancedState {
  selectedMedia?: MediaItem;
  selectedSeason?: number;
  seasons?: any[];
  episodes?: any[];
  timestamp: number;
}
const playEnhancedState = new Map<string, PlayEnhancedState>();

interface YouTubeSearchResult {
  id: string;
  title: string;
  duration: string;
  channel: string;
  url: string;
  thumbnail: string;
  description: string;
  views: string;
  likes: string;
  uploadDate: string;
}

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
    .setName('speed')
    .setDescription('Adjust playback speed')
    .addNumberOption(option =>
      option.setName('multiplier')
        .setDescription('Speed multiplier (0.5-3, default 1)')
        .setRequired(true)
        .setMinValue(0.5)
        .setMaxValue(3)
    ),
  new SlashCommandBuilder()
    .setName('yt')
    .setDescription('Play a YouTube video')
    .addStringOption(option =>
      option.setName('url')
        .setDescription('YouTube URL')
        .setRequired(true)
    )
    .addStringOption(option =>
      option.setName('time')
        .setDescription('Start time (e.g., "3:31" or "1:23:45")')
        .setRequired(false)
    )
    .addBooleanOption(option =>
      option.setName('queue')
        .setDescription('Add to queue instead of playing immediately')
        .setRequired(false)
    ),
  new SlashCommandBuilder()
    .setName('ytm')
    .setDescription('Play YouTube audio with a music visualizer (album art + progress)')
    .addStringOption(option =>
      option.setName('url')
        .setDescription('YouTube URL (single track, playlist, album, or mix)')
        .setRequired(false)
    )
    .addStringOption(option =>
      option.setName('action')
        .setDescription('Subcommand: mix | autoplay | autoplay-off | queue | stop')
        .setRequired(false)
        .addChoices(
          { name: 'mix — play auto-mix (no URL needed)', value: 'mix' },
          { name: 'autoplay on — enable autoplay recommendations', value: 'autoplay' },
          { name: 'autoplay off — disable autoplay', value: 'autoplay-off' },
          { name: 'queue — show queue status', value: 'queue' },
          { name: 'stop — stop music and clear queue', value: 'stop' },
        )
    )
    .addStringOption(option =>
      option.setName('query')
        .setDescription('Search query for mix (e.g., "lo-fi hip hop")')
        .setRequired(false)
    )
    .addStringOption(option =>
      option.setName('time')
        .setDescription('Start time (e.g., "1:30" or "0:45") — single tracks only')
        .setRequired(false)
    ),
  new SlashCommandBuilder()
    .setName('yts')
    .setDescription('Search YouTube')
    .addStringOption(option =>
      option.setName('query')
        .setDescription('Search query')
        .setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName('ytp')
    .setDescription('Play a YouTube search result')
    .addIntegerOption(option =>
      option.setName('number')
        .setDescription('Result number to play')
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(20)
    ),
  new SlashCommandBuilder()
    .setName('ytrending')
    .setDescription('Show trending YouTube videos')
    .addStringOption(option =>
      option.setName('category')
        .setDescription('Category of trending videos')
        .setRequired(false)
        .addChoices(
          { name: 'All', value: 'default' },
          { name: 'Music', value: 'music' },
          { name: 'Gaming', value: 'gaming' },
          { name: 'News', value: 'news' },
          { name: 'Movies', value: 'movies' },
          { name: 'Sports', value: 'sports' },
          { name: 'Learning', value: 'learning' },
          { name: 'Tech', value: 'tech' }
        )
    ),
  new SlashCommandBuilder()
    .setName('url')
    .setDescription('Play a direct stream URL')
    .addStringOption(option =>
      option.setName('url')
        .setDescription('Stream URL (M3U8, MP4, etc.)')
        .setRequired(true)
    )
    .addStringOption(option =>
      option.setName('title')
        .setDescription('Optional title for the stream')
        .setRequired(false)
    )
    .addBooleanOption(option =>
      option.setName('queue')
        .setDescription('Add to queue instead of playing immediately')
        .setRequired(false)
    ),
  new SlashCommandBuilder()
    .setName('clear')
    .setDescription('Clear all SchroStream and Co\'s messages'),
  new SlashCommandBuilder()
    .setName('downloads')
    .setDescription('Show downloaded YouTube videos with options to play or delete'),
  new SlashCommandBuilder()
    .setName('play-download')
    .setDescription('Play a downloaded video by number')
    .addIntegerOption(option =>
      option.setName('number')
        .setDescription('Video number from /downloads list')
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(50)
    ),
  new SlashCommandBuilder()
    .setName('delete-download')
    .setDescription('Delete a downloaded video by number')
    .addIntegerOption(option =>
      option.setName('number')
        .setDescription('Video number from /downloads list')
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(50)
    ),
  new SlashCommandBuilder()
    .setName('delete-all-downloads')
    .setDescription('Delete all downloaded videos'),
  new SlashCommandBuilder()
    .setName('channels')
    .setDescription('List available Live TV channels'),
  new SlashCommandBuilder()
    .setName('channel')
    .setDescription('Play a Live TV channel')
    .addIntegerOption(option =>
      option.setName('number')
        .setDescription('Channel number to play')
        .setRequired(true)
        .setMinValue(1)
    ),
  new SlashCommandBuilder()
    .setName('queue')
    .setDescription('Manage the playback queue')
    .addSubcommand(subcommand =>
      subcommand
        .setName('add')
        .setDescription('Add a media item to the queue')
        .addIntegerOption(option =>
          option.setName('number')
            .setDescription('Search result number to add')
            .setRequired(true)
            .setMinValue(1)
            .setMaxValue(20)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('list')
        .setDescription('Show the current queue')
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('remove')
        .setDescription('Remove an item from the queue')
        .addIntegerOption(option =>
          option.setName('number')
            .setDescription('Queue position to remove')
            .setRequired(true)
            .setMinValue(1)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('clear')
        .setDescription('Clear the entire queue')
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('start')
        .setDescription('Start playing from the first item in the queue')
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('next')
        .setDescription('Play the next item in the queue')
    ),
  new SlashCommandBuilder()
    .setName('ondeck')
    .setDescription('Show recently watched media (watch deck)')
    .addIntegerOption(option =>
      option.setName('number')
        .setDescription('Item number to resume watching')
        .setRequired(false)
        .setMinValue(1)
    ),
  new SlashCommandBuilder()
    .setName('watched')
    .setDescription('Mark a video as fully watched and clean it up')
    .addIntegerOption(option =>
      option.setName('number')
        .setDescription('Watch deck item number to mark as watched')
        .setRequired(true)
        .setMinValue(1)
    ),
  new SlashCommandBuilder()
    .setName('cleanup')
    .setDescription('Clean up all fully watched videos'),
  new SlashCommandBuilder()
    .setName('play-enhanced')
    .setDescription('Play media with autocomplete (bypasses 25 option limit)')
    .addStringOption(option =>
      option.setName('media')
        .setDescription('Search for a movie or TV show')
        .setRequired(true)
        .setAutocomplete(true)
    )
    .addIntegerOption(option =>
      option.setName('season')
        .setDescription('Season number (for TV shows)')
        .setRequired(false)
        .setAutocomplete(true)
    )
    .addIntegerOption(option =>
      option.setName('episode')
        .setDescription('Episode number')
        .setRequired(false)
        .setAutocomplete(true)
    ),
].map(cmd => cmd.toJSON());

export async function initControllerBot(): Promise<Client | null> {
  const botToken = config.discord.botToken;
  
  if (!botToken) {
    console.log('[Controller] No bot token configured, skipping controller bot');
    return null;
  }

  // Clean up fully watched videos on startup
  try {
    cleanupFullyWatchedVideos();
    console.log('[Controller] Startup cleanup completed');
  } catch (error) {
    console.error('[Controller] Failed to cleanup on startup:', error);
  }
  
  controllerBot = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildVoiceStates,
      GatewayIntentBits.GuildMembers, // Required to show in members list
      GatewayIntentBits.GuildPresences, // Required for presence updates
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
      if (interaction.isAutocomplete()) {
        await handleAutocomplete(interaction);
      } else if (interaction.isChatInputCommand()) {
        await handleSlashCommand(interaction);
      } else if (interaction.isButton()) {
        await handleButton(interaction);
      } else if (interaction.isStringSelectMenu()) {
        await handleSelectMenu(interaction);
      } else if (interaction.isModalSubmit()) {
        await handleModalSubmit(interaction);
      }
    } catch (error) {
      // Check if it's an expired interaction error
      if (error instanceof Error && 
          (error.message.includes('Unknown interaction') ||
           (error as any).code === 10062)) {
        console.log('[Controller] Interaction expired (15min timeout), ignoring');
        return;
      }
      
      console.error('[Controller] Interaction error:', error);
      if (interaction.isRepliable()) {
        const reply = { content: '❌ An error occurred', ephemeral: true };
        try {
          if (interaction.replied || interaction.deferred) {
            await interaction.followUp(reply);
          } else {
            await interaction.reply(reply);
          }
        } catch (followUpError) {
          // Handle "Unknown Message" error - this happens when the original interaction message
          // has been deleted or expired (15 minute timeout)
          // Handle "Unknown interaction" error - this happens when the interaction itself
          // has expired (15 minute timeout)
          if (followUpError instanceof Error && 
              (followUpError.message.includes('Unknown Message') || 
               followUpError.message.includes('Unknown interaction') ||
               (followUpError as any).code === 10008 ||
               (followUpError as any).code === 10062)) {
            console.log('[Controller] Original interaction expired (15min timeout), skipping error response');
          } else {
            console.error('[Controller] Failed to send error response:', followUpError);
          }
        }
      }
    }
  });

  controllerBot.once('ready', () => {
    console.log(`[Controller] Bot ready as ${controllerBot?.user?.tag}`);
    
    // Set full presence (status and activity in one call)
    controllerBot?.user?.setPresence({
      status: 'online',
      activities: [{
        name: '/help for commands',
        type: ActivityType.Listening
      }]
    });
  });

  // Monitor voice state changes to stop stream when channel is empty (except bot)
  controllerBot.on('voiceStateUpdate', async (oldState, newState) => {
    try {
      const streamer = getVideoStreamer();
      if (!streamer) return;

      // Check if someone left a voice channel
      if (oldState.channelId && !newState.channelId) {
        const channel = oldState.channel;
        if (!channel) return;

        // Check if there's an active stream in this guild
        const guildId = oldState.guild.id;
        if (!streamer.isStreaming(guildId)) return;

        // Count non-bot members in the channel
        const nonBotMembers = channel.members.filter(m => !m.user.bot).size;
        
        // If only bots are left (or channel is empty), stop the stream
        if (nonBotMembers === 0) {
          console.log(`[Controller] Voice channel empty (only bots left), stopping stream in guild ${guildId}`);
          await streamer.stopStream(guildId);
        } else {
          console.log(`[Controller] ${nonBotMembers} non-bot member(s) still in voice channel, keeping stream active`);
        }
      }
    } catch (error) {
      console.error('[Controller] Error in voiceStateUpdate:', error);
    }
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
    case 'speed':
      await handleSpeed(interaction);
      break;
    case 'yt':
      await handleYouTube(interaction);
      break;
    case 'ytm':
      await handleYouTubeMusic(interaction);
      break;
    case 'yts':
      await handleYouTubeSearch(interaction);
      break;
    case 'ytp':
      await handleYouTubePlay(interaction);
      break;
    case 'ytrending':
      await handleYouTubeTrending(interaction);
      break;
    case 'url':
      await handleUrl(interaction);
      break;
    case 'clear':
      await handleClear(interaction);
      break;
    case 'downloads':
      await handleDownloads(interaction);
      break;
    case 'play-download':
      await handlePlayDownload(interaction);
      break;
    case 'delete-download':
      await handleDeleteDownload(interaction);
      break;
    case 'delete-all-downloads':
      await handleDeleteAllDownloads(interaction);
      break;
    case 'channels':
      await handleChannels(interaction);
      break;
    case 'channel':
      await handleChannel(interaction);
      break;
    case 'queue':
      await handleQueue(interaction);
      break;
    case 'ondeck':
      await handleOnDeck(interaction);
      break;
    case 'watched':
      await handleWatched(interaction);
      break;
    case 'cleanup':
      await handleCleanup(interaction);
      break;
    case 'play-enhanced':
      await handlePlayEnhanced(interaction);
      break;
  }
}

async function handleAutocomplete(interaction: AutocompleteInteraction): Promise<void> {
  if (interaction.commandName !== 'play-enhanced') return;
  
  const focusedOption = interaction.options.getFocused(true);
  const userId = interaction.user.id;
  
  // Get or create user state
  let state = playEnhancedState.get(userId);
  if (!state || Date.now() - state.timestamp > SESSION_TIMEOUT) {
    state = { timestamp: Date.now() };
    playEnhancedState.set(userId, state);
  }
  
  try {
    if (focusedOption.name === 'media') {
      // Search for media
      const query = focusedOption.value as string;
      let results: MediaItem[] = [];
      
      if (query.length > 0) {
        results = await plexClient.search(query);
      } else {
        // Show a prompt when no query entered
        await interaction.respond([{ name: 'Start typing to search...', value: 'none' }]);
        return;
      }
      
      if (results.length === 0) {
        await interaction.respond([{ name: 'No results found', value: 'none' }]);
        return;
      }
      
      // Store results for later use
      searchSessions.set(userId, { results, timestamp: Date.now() });
      
      // Format for autocomplete (max 25 options)
      const options = results.slice(0, 25).map((item, index) => {
        const type = item.type === 'show' ? '📺' : '🎬';
        const year = 'year' in item && item.year ? ` (${item.year})` : '';
        const name = `${type} ${item.title}${year}`;
        return {
          name: name.substring(0, 100),
          value: `${index}:${item.ratingKey}`
        };
      });
      
      await interaction.respond(options);
      
    } else if (focusedOption.name === 'season') {
      // Get selected media from the media option
      const mediaValue = interaction.options.getString('media');
      
      if (!mediaValue) {
        await interaction.respond([{ name: 'Select a TV show first', value: 0 }]);
        return;
      }
      
      const [indexStr, ratingKey] = mediaValue.split(':');
      const session = searchSessions.get(userId);
      
      if (!session) {
        await interaction.respond([{ name: 'Search again', value: 0 }]);
        return;
      }
      
      const media = session.results.find(r => r.ratingKey === ratingKey);
      
      if (!media || media.type !== 'show') {
        await interaction.respond([{ name: 'Not a TV show - just play it!', value: 0 }]);
        return;
      }
      
      // Store selected media
      state.selectedMedia = media;
      state.timestamp = Date.now();
      
      // Get seasons
      const seasons = await plexClient.getSeasons(media.ratingKey);
      state.seasons = seasons;
      
      // Filter based on what user typed
      const filterValue = String(focusedOption.value || '');
      
      const options = seasons
        .filter(season => season.index !== undefined)
        .map(season => ({
          name: `Season ${season.index}`,
          value: season.index as number
        }))
        .filter(opt => filterValue === '' || String(opt.value).startsWith(filterValue));
      
      await interaction.respond(options.slice(0, 25));
      
    } else if (focusedOption.name === 'episode') {
      const seasonNum = interaction.options.getInteger('season');
      const mediaValue = interaction.options.getString('media');
      
      console.log(`[Autocomplete] Episode - seasonNum: ${seasonNum}, mediaValue: ${mediaValue}`);
      
      if (!seasonNum) {
        await interaction.respond([{ name: 'Select a season first', value: 0 }]);
        return;
      }
      
      if (!mediaValue) {
        await interaction.respond([{ name: 'Select a show first', value: 0 }]);
        return;
      }
      
      // Try to get media - first from state, then from session by ratingKey, then by searching
      let media = state.selectedMedia;
      
      if (!media) {
        // Try parsing the value format "index:ratingKey"
        const parts = mediaValue.split(':');
        if (parts.length >= 2) {
          const ratingKey = parts[1];
          const session = searchSessions.get(userId);
          if (session) {
            media = session.results.find(r => r.ratingKey === ratingKey);
          }
          // Also try direct Plex lookup
          if (!media) {
            const plexMedia = await plexClient.getMetadata(ratingKey);
            if (plexMedia) media = plexMedia;
          }
        }
        
        // Fallback: Search by title extracted from display value
        if (!media) {
          // Extract title from display format like "📺 South Park (1997)"
          const titleMatch = mediaValue.match(/[📺🎬]\s*(.+?)(?:\s*\(\d{4}\))?$/);
          const searchTitle = titleMatch ? titleMatch[1].trim() : mediaValue.replace(/[📺🎬]/g, '').trim();
          console.log(`[Autocomplete] Searching by title: ${searchTitle}`);
          
          const searchResults = await plexClient.search(searchTitle);
          media = searchResults.find(r => r.type === 'show');
        }
        
        if (media) {
          state.selectedMedia = media;
          console.log(`[Autocomplete] Found media: ${media.title} (${media.ratingKey})`);
        }
      }
      
      if (!media) {
        console.log(`[Autocomplete] Could not find media for: ${mediaValue}`);
        await interaction.respond([{ name: 'Could not find show - try searching again', value: 0 }]);
        return;
      }
      
      // Clear seasons cache if media changed
      if (state.selectedMedia?.ratingKey !== media.ratingKey) {
        console.log(`[Autocomplete] Media changed, clearing seasons cache`);
        state.seasons = undefined;
        state.episodes = undefined;
      }
      
      state.selectedMedia = media;
      state.selectedSeason = seasonNum;
      state.timestamp = Date.now();
      
      // Always fetch seasons fresh to ensure correct data
      console.log(`[Autocomplete] Fetching seasons for ${media.title} (${media.ratingKey})`);
      state.seasons = await plexClient.getSeasons(media.ratingKey);
      console.log(`[Autocomplete] Fetched ${state.seasons.length} seasons: ${state.seasons.map(s => s.index).join(', ')}`);
      
      // Find the season
      const season = state.seasons?.find(s => s.index === seasonNum);
      if (!season) {
        console.log(`[Autocomplete] Season ${seasonNum} not found in seasons`);
        await interaction.respond([{ name: `Season ${seasonNum} not found (have: ${state.seasons.map(s => s.index).join(', ')})`, value: 0 }]);
        return;
      }
      
      console.log(`[Autocomplete] Found season ${seasonNum} with ratingKey: ${season.ratingKey}`);
      
      // Get ALL episodes for the show, then filter by season (parentIndex)
      // This is how showEpisodesForSeason works - getEpisodes takes SHOW ratingKey, not season!
      const allEpisodes = await plexClient.getEpisodes(media.ratingKey);
      const episodes = allEpisodes.filter(ep => (ep.parentIndex || 0) === seasonNum);
      state.episodes = episodes;
      console.log(`[Autocomplete] Found ${allEpisodes.length} total episodes, ${episodes.length} for season ${seasonNum}`);
      
      // Filter based on what user typed
      const filterValue = String(focusedOption.value || '');
      
      const options = episodes
        .filter(ep => ep.index !== undefined)
        .map(ep => ({
          name: `E${ep.index}: ${ep.title}`.substring(0, 100),
          value: ep.index as number
        }))
        .filter(opt => filterValue === '' || String(opt.value).startsWith(filterValue));
      
      await interaction.respond(options.slice(0, 25));
    }
  } catch (error) {
    console.error('[Controller] Autocomplete error:', error);
    await interaction.respond([]);
  }
}

async function handlePlayEnhanced(interaction: ChatInputCommandInteraction): Promise<void> {
  const mediaValue = interaction.options.getString('media', true);
  const seasonNum = interaction.options.getInteger('season');
  const episodeNum = interaction.options.getInteger('episode');
  const userId = interaction.user.id;
  
  await interaction.deferReply();
  
  try {
    const [indexStr, ratingKey] = mediaValue.split(':');
    const session = searchSessions.get(userId);
    
    if (!session) {
      await interaction.editReply('❌ Session expired. Please search again.');
      return;
    }
    
    const media = session.results.find(r => r.ratingKey === ratingKey);
    
    if (!media) {
      await interaction.editReply('❌ Media not found. Please search again.');
      return;
    }
    
    // Get voice channel
    const member = await interaction.guild?.members.fetch(interaction.user.id);
    const voiceChannel = member?.voice.channel;
    
    if (!voiceChannel) {
      await interaction.editReply('❌ You need to be in a voice channel!');
      return;
    }
    
    let itemToPlay: MediaItem = media;
    
    // If it's a show, get the specific episode
    if (media.type === 'show' && seasonNum && episodeNum) {
      const state = playEnhancedState.get(userId);
      
      if (state?.episodes) {
        const episode = state.episodes.find((ep: any) => ep.index === episodeNum);
        if (episode) {
          itemToPlay = episode;
        }
      } else {
        // Fallback: fetch episodes directly
        const seasons = await plexClient.getSeasons(media.ratingKey);
        const season = seasons.find(s => s.index === seasonNum);
        if (season) {
          const episodes = await plexClient.getEpisodes(season.ratingKey);
          const episode = episodes.find((ep: any) => ep.index === episodeNum);
          if (episode) {
            itemToPlay = episode;
          }
        }
      }
    } else if (media.type === 'show' && !seasonNum) {
      // Show selected but no episode - show help
      await interaction.editReply('📺 This is a TV show. Please also select a **season** and **episode**.');
      return;
    }
    
    // Get stream URL
    const streamInfo = await plexClient.getDirectStreamUrl(itemToPlay.ratingKey);
    if (!streamInfo) {
      await interaction.editReply('❌ Could not get stream URL');
      return;
    }
    
    // Start playback
    const videoStreamer = getVideoStreamer();
    const guildId = interaction.guildId!;
    
    const embed = new EmbedBuilder()
      .setTitle('▶️ Now Playing')
      .setDescription(`**${itemToPlay.title}**`)
      .setColor(0x00ff00);
    
    await interaction.editReply({ embeds: [embed] });
    
    await videoStreamer.startStream(
      guildId,
      voiceChannel.id,
      itemToPlay,
      streamInfo.url,
      0,
      interaction.user.id
    );
    
    // Clean up state
    playEnhancedState.delete(userId);
    
  } catch (error: any) {
    console.error('[Controller] Play enhanced error:', error);
    await interaction.editReply(`❌ Error: ${error.message}`);
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

  // Separate movies and TV shows
  const movies = results.filter(item => item.type === 'movie');
  const shows = results.filter(item => item.type === 'show');
  
  let description = '';
  
  if (movies.length > 0) {
    description += '**🎬 Movies**\n';
    description += movies.map((item, i) => {
      const year = item.year ? ` (${item.year})` : '';
      const rating = item.rating ? ` ⭐ ${item.rating}` : '';
      return `**${i + 1}.** ${item.title}${year}${rating}`;
    }).join('\n');
  }
  
  if (shows.length > 0) {
    if (description) description += '\n\n';
    description += '**📺 TV Shows**\n';
    description += shows.map((item, i) => {
      const year = item.year ? ` (${item.year})` : '';
      const seasons = item.childCount ? ` • ${item.childCount} Seasons` : '';
      const rating = item.rating ? ` ⭐ ${item.rating}` : '';
      return `**${movies.length + i + 1}.** ${item.title}${year}${seasons}${rating}`;
    }).join('\n');
  }
  
  // Build select menu with proper numbering (Discord limit is 25 options)
  const allResults = [...movies, ...shows];

  // Build embed
  const embed = new EmbedBuilder()
    .setTitle(`🔍 Search: "${query}"`)
    .setColor(0xe5a00d)
    .setDescription(description || 'No results found')
    .setFooter({ 
  text: allResults.length > 25 
    ? `Showing ${allResults.length} results (select menu limited to 25). Use /play <number> for all results.`
    : 'Select a result below or use /play <number>'
});

  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId('search_select')
    .setPlaceholder('Select media to play...')
    .addOptions(
      allResults.slice(0, 25).map((item, i) => {
        const actualIndex = results.indexOf(item);
        const description = item.type === 'show' 
          ? `TV Show${item.year ? ` (${item.year})` : ''}${item.childCount ? ` • ${item.childCount} Seasons` : ''}`
          : `Movie${item.year ? ` (${item.year})` : ''}`;
        return {
          label: `${actualIndex + 1}. ${item.title}`.substring(0, 100),
          description: description.substring(0, 100),
          value: `${actualIndex}`,
        };
      })
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
  mediaItem: MediaItem,
  episodeStr?: string | null
): Promise<void> {
  // Debug logging
  console.log('[Controller] Interaction type:', interaction.constructor.name);
  console.log('[Controller] guildId:', interaction.guildId);
  console.log('[Controller] guild:', interaction.guild);
  
  // For component interactions, try to get guildId from message
  let guildId = interaction.guildId;
  if (!guildId && 'message' in interaction) {
    guildId = (interaction as any).message?.guildId;
  }
  
  if (!guildId) {
    await interaction.editReply('❌ Guild ID not found - try running the command again');
    return;
  }

  // Use selfbot client to get voice state (it has full access)
  const guild = selfbotClient.guilds.cache.get(guildId);
  const member = guild?.members.cache.get(interaction.user.id);
  const voiceChannel = member?.voice?.channel;

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

  // Get stream URL - use different method for Live TV channels
  let streamInfo;
  console.log('[Controller] Media item type:', itemToPlay.type);
  console.log('[Controller] Media item ratingKey:', itemToPlay.ratingKey);
  
  if (itemToPlay.type === 'channel') {
    console.log('[Controller] Using getChannelStreamUrl for Live TV channel');
    streamInfo = await plexClient.getChannelStreamUrl(itemToPlay.ratingKey);
  } else {
    console.log('[Controller] Using getDirectStreamUrl for regular media');
    streamInfo = await plexClient.getDirectStreamUrl(itemToPlay.ratingKey);
  }
  
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

  // Create playback controls
  const controlRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId('ctrl_pause').setEmoji('⏸️').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('ctrl_stop').setEmoji('⏹️').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('ctrl_rw').setEmoji('⏪').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('ctrl_ff').setEmoji('⏩').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('ctrl_skip').setEmoji('⏭️').setStyle(ButtonStyle.Primary),
  );
  const speedRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId('ctrl_speed_down').setLabel('🐢').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('ctrl_speed').setLabel('1x').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('ctrl_speed_up').setLabel('🐇').setStyle(ButtonStyle.Secondary),
  );

  const embed = new EmbedBuilder()
    .setTitle('📺 Now Playing')
    .setDescription(`**${title}**`)
    .setColor(0x00ff00);

  if (itemToPlay.type === 'movie' || itemToPlay.type === 'show' || itemToPlay.type === 'episode' || itemToPlay.type === 'channel') {
    // Plex media item
    const plexItem = itemToPlay as any;
    if (plexItem.thumb) {
      embed.setThumbnail(`${config.plex.url}${plexItem.thumb}?X-Plex-Token=${config.plex.token}`);
    }
  } else if (itemToPlay.type === 'youtube') {
    // YouTube item
    const ytItem = itemToPlay as any;
    if (ytItem.thumb) {
      embed.setThumbnail(ytItem.thumb);
    }
  }

  const reply = await interaction.editReply({ embeds: [embed], components: [controlRow, speedRow] });

  // Start stream
  const videoStreamer = getVideoStreamer();
  // Store message info for embed updates
  videoStreamer.setEmbedMessage(guildId, reply.id, interaction.channelId);
  try {
    if (itemToPlay.type === 'youtube') {
      const ytItem = itemToPlay as any;
      if (ytItem.filePath) {
        // Play downloaded YouTube video
        await videoStreamer.startLocalFile(
          guildId,
          voiceChannel.id,
          itemToPlay,
          ytItem.filePath,
          interaction.user.id
        );
      } else {
        // Stream YouTube video directly
        await videoStreamer.startExternalStream(
          guildId,
          voiceChannel.id,
          itemToPlay,
          ytItem.url,
          interaction.user.id
        );
      }
    } else if (itemToPlay.type === 'external') {
      const extItem = itemToPlay as any;
      await videoStreamer.startExternalStream(
        guildId,
        voiceChannel.id,
        itemToPlay,
        extItem.url,
        interaction.user.id
      );
    } else {
      // Plex media item
      await videoStreamer.startStream(
        guildId,
        voiceChannel.id,
        itemToPlay,
        streamInfo.url,
        0,
        interaction.user.id
      );
    }
  } catch (err: any) {
    console.error('[Controller] Stream error:', err);
    
    // Check if it's a 400 Bad Request error
    if (err.message && err.message.includes('400 Bad Request')) {
      const errorEmbed = new EmbedBuilder()
        .setTitle('❌ Stream Failed to Start')
        .setDescription('Sorry, Plex is having trouble starting the stream. This usually happens when too many transcode sessions are active.')
        .addFields(
          { name: 'What to try:', value: '• Wait a minute or two and try again\n• Try a different episode, show, or movie\n• Try playing a YouTube video or external stream' }
        )
        .setColor(0xff0000);
      
      await interaction.editReply({ embeds: [errorEmbed], components: [] });
    } else {
      await interaction.editReply({ content: `❌ Stream error: ${err.message}`, components: [] });
    }
  }
}

async function handleStop(interaction: ChatInputCommandInteraction): Promise<void> {
  const videoStreamer = getVideoStreamer();
  const guildId = interaction.guildId;
  
  if (!guildId) {
    await interaction.reply({ content: '❌ Guild not found', ephemeral: true });
    return;
  }
  
  const session = videoStreamer.getSession(guildId);
  
  if (session) {
    // Set stopping flag to prevent auto-play
    session.isStopping = true;
    
    // Remove current item from queue if it exists
    const queue = getQueue();
    const currentInQueue = queue.find(item => item.ratingKey === session.mediaItem.ratingKey);
    if (currentInQueue) {
      removeFromQueue(currentInQueue.id);
      console.log(`[Controller] Removed current item from queue: ${session.mediaItem.title}`);
    }
  }
  
  await videoStreamer.stopStream(guildId);
  await interaction.reply('⏹️ Stopped playback and removed from queue');
}

async function handlePause(interaction: ChatInputCommandInteraction): Promise<void> {
  const videoStreamer = getVideoStreamer();
  const guildId = interaction.guildId;
  
  if (!guildId) {
    await interaction.reply({ content: '❌ Guild not found', ephemeral: true });
    return;
  }
  
  const session = videoStreamer.getSession(guildId);

  if (!session) {
    await interaction.reply({ content: '❌ Nothing is playing', ephemeral: true });
    return;
  }

  if (session.isPaused) {
    await videoStreamer.resumeStream(guildId);
    await interaction.reply('▶️ Resumed playback');
  } else {
    await videoStreamer.pauseStream(guildId);
    await interaction.reply('⏸️ Paused playback');
  }
}

async function handleSeek(interaction: ChatInputCommandInteraction): Promise<void> {
  const timeStr = interaction.options.getString('time', true);
  const videoStreamer = getVideoStreamer();
  const guildId = interaction.guildId;
  
  if (!guildId) {
    await interaction.reply({ content: '❌ Guild not found', ephemeral: true });
    return;
  }
  
  const timeMs = parseTimeString(timeStr);
  
  if (timeMs === null) {
    await interaction.reply({ content: '❌ Invalid time format. Use `HH:MM:SS`, `MM:SS`, or seconds', ephemeral: true });
    return;
  }
  
  const success = await videoStreamer.seekStream(guildId, timeMs);

  if (success) {
    await interaction.reply(`⏩ Seeked to ${formatDuration(timeMs)}`);
  } else {
    await interaction.reply({ content: '❌ Failed to seek', ephemeral: true });
  }
}

async function handleSkip(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply();

  const videoStreamer = getVideoStreamer();
  const guildId = interaction.guildId;
  
  if (!guildId) {
    await interaction.editReply('❌ Guild not found');
    return;
  }
  
  const session = videoStreamer.getSession(guildId);

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
    guildId,
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
  const videoStreamer = getVideoStreamer();
  const guildId = interaction.guildId;
  
  if (!guildId) {
    await interaction.reply({ content: '❌ Guild not found', ephemeral: true });
    return;
  }
  
  const session = videoStreamer.getSession(guildId);

  if (!session) {
    await interaction.reply({ content: '❌ Nothing is playing', ephemeral: true });
    return;
  }

  const offsetMs = parseTimeString(timeStr) || 30000;
  const currentTime = videoStreamer.getCurrentTime(guildId);
  const newTime = Math.min(currentTime + offsetMs, session.duration);

  // Acknowledge immediately to avoid Discord timeout
  await interaction.reply(`⏩ Skipping forward ${formatDuration(offsetMs)}...`);

  // Perform the seek operation (this can take several seconds)
  const success = await videoStreamer.seekStream(guildId, newTime);

  // Follow up with the result
  try {
    if (success) {
      await interaction.followUp(`⏩ Skipped to ${formatDuration(newTime)}`);
    } else {
      await interaction.followUp({ content: '❌ Failed to skip forward', ephemeral: true });
    }
  } catch (followUpError) {
    console.error('[Controller] Failed to follow up after fast forward:', followUpError);
  }
}

async function handleRewind(interaction: ChatInputCommandInteraction): Promise<void> {
  const timeStr = interaction.options.getString('time') || '30';
  const videoStreamer = getVideoStreamer();
  const guildId = interaction.guildId;
  
  if (!guildId) {
    await interaction.reply({ content: '❌ Guild not found', ephemeral: true });
    return;
  }
  
  const session = videoStreamer.getSession(guildId);

  if (!session) {
    await interaction.reply({ content: '❌ Nothing is playing', ephemeral: true });
    return;
  }

  const offsetMs = parseTimeString(timeStr) || 30000;
  const currentTime = videoStreamer.getCurrentTime(guildId);
  const newTime = Math.max(currentTime - offsetMs, 0);

  // Acknowledge immediately to avoid Discord timeout
  await interaction.reply(`⏪ Rewinding ${formatDuration(offsetMs)}...`);

  // Perform the seek operation (this can take several seconds)
  const success = await videoStreamer.seekStream(guildId, newTime);

  // Follow up with the result
  try {
    if (success) {
      await interaction.followUp(`⏪ Rewound to ${formatDuration(newTime)}`);
    } else {
      await interaction.followUp({ content: '❌ Failed to rewind', ephemeral: true });
    }
  } catch (followUpError) {
    console.error('[Controller] Failed to follow up after rewind:', followUpError);
  }
}

async function handleNowPlaying(interaction: ChatInputCommandInteraction): Promise<void> {
  const videoStreamer = getVideoStreamer();
  const guildId = interaction.guildId;
  
  if (!guildId) {
    await interaction.reply({ content: '❌ Guild not found', ephemeral: true });
    return;
  }
  
  const session = videoStreamer.getSession(guildId);

  if (!session) {
    await interaction.reply({ content: '❌ Nothing is playing', ephemeral: true });
    return;
  }

  const currentTime = videoStreamer.getCurrentTime(guildId);
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
      { name: 'Progress', value: `${progressBar}\n${formatPlexDuration(currentTime)} / ${formatPlexDuration(duration)} (${progress}%)` }
    )
    .setColor(session.isPaused ? 0xffaa00 : 0x00ff00);

  await interaction.reply({ embeds: [embed] });
}

async function handleVolume(interaction: ChatInputCommandInteraction): Promise<void> {
  const level = interaction.options.getInteger('level', true);

  const videoStreamer = getVideoStreamer();
  const guildId = interaction.guildId;
  
  if (!guildId) {
    await interaction.reply({ content: '❌ Guild not found', ephemeral: true });
    return;
  }
  
  const success = await videoStreamer.setVolume(guildId, level);

  if (success) {
    await interaction.reply(`🔊 Volume set to ${level}%`);
  } else {
    await interaction.reply({ content: '❌ Nothing is playing', ephemeral: true });
  }
}

async function handleSpeed(interaction: ChatInputCommandInteraction): Promise<void> {
  const multiplier = interaction.options.getNumber('multiplier', true);

  const videoStreamer = getVideoStreamer();
  const guildId = interaction.guildId;
  
  if (!guildId) {
    await interaction.reply({ content: '❌ Guild not found', ephemeral: true });
    return;
  }
  
  const success = await videoStreamer.setSpeed(guildId, multiplier);

  if (success) {
    const speedEmoji = multiplier > 1 ? '⏩' : multiplier < 1 ? '⏪' : '▶️';
    await interaction.reply(`${speedEmoji} Playback speed set to **${multiplier}x**`);
  } else {
    await interaction.reply({ content: '❌ Nothing is playing', ephemeral: true });
  }
}

async function handleYouTube(interaction: ChatInputCommandInteraction): Promise<void> {
  const url = interaction.options.getString('url', true);
  const timeStr = interaction.options.getString('time');
  const queueOption = interaction.options.getBoolean('queue') || false;
  await interaction.deferReply();
  
  // Parse time string (e.g., "3:31", "1:23:45") to milliseconds
  let startTimeMs = 0;
  if (timeStr) {
    const parts = timeStr.split(':').map(Number);
    if (parts.length === 2) {
      // MM:SS format
      startTimeMs = (parts[0] * 60 + parts[1]) * 1000;
    } else if (parts.length === 3) {
      // HH:MM:SS format
      startTimeMs = (parts[0] * 3600 + parts[1] * 60 + parts[2]) * 1000;
    } else {
      await interaction.editReply('❌ Invalid time format. Use MM:SS or HH:MM:SS');
      return;
    }
  }

  const guildId = interaction.guildId;
  if (!guildId) {
    await interaction.editReply('❌ This command can only be used in a server');
    return;
  }

  // If queue option is selected, add to queue instead of playing
  if (queueOption) {
    try {
      // Check if video is already downloaded first
      const { findDownloadedVideoByUrl } = await import('../youtube/downloader.js');
      const existingVideo = findDownloadedVideoByUrl(url);
      
      // Get YouTube info to create media item
      const { getYouTubeInfo, getYtdlpBaseArgs } = await import('../youtube/downloader.js');
      const info = await getYouTubeInfo(url);
      
      if (!info) {
        await interaction.editReply('❌ Failed to get YouTube video info');
        return;
      }

      const mediaItem: MediaItem = {
        ratingKey: `yt-${Date.now()}`,
        key: url,
        type: 'youtube', // Always 'youtube' type, filePath indicates if downloaded
        title: info.title,
        duration: info.duration,
        thumb: info.thumbnail,
        uploader: info.uploader,
        viewCount: info.view_count ? formatNumber(info.view_count) : undefined,
        uploadDate: info.upload_date ? new Date(info.upload_date).toLocaleDateString() : undefined,
        url: url,
        filePath: existingVideo?.filePath // Add file path if downloaded
      };

      const added = addToQueue(mediaItem, interaction.user.id);
      if (!added) {
        await interaction.editReply('❌ This video is already in the queue');
        return;
      }

      const message = existingVideo 
        ? `✅ Added downloaded video to queue: **${info.title}**`
        : `✅ Added to queue: **${info.title}**`;
      
      await interaction.editReply(message);
      return;
    } catch (error) {
      console.error('[Controller] Error adding YouTube to queue:', error);
      await interaction.editReply('❌ Failed to add video to queue');
      return;
    }
  }

  // Original playback logic continues here...
  const guild = selfbotClient.guilds.cache.get(guildId);
  const member = guild?.members.cache.get(interaction.user.id);
  const voiceChannel = member?.voice?.channel;

  if (!voiceChannel) {
    await interaction.editReply('❌ You must be in a voice channel');
    return;
  }

  // Import YouTube downloader
  const { downloadYouTubeVideo, findDownloadedVideoByUrl } = await import('../youtube/downloader');
  type DownloadProgress = import('../youtube/downloader').DownloadProgress;

  // Check if video is already downloaded
  const existingVideo = findDownloadedVideoByUrl(url);
  if (existingVideo) {
    console.log(`[Controller] Found existing download for: ${url}`);
    
    const videoStreamer = getVideoStreamer();
    
    const mediaItem = {
      ratingKey: `yt-${Date.now()}`,
      key: url,
      title: existingVideo.title,
      type: 'youtube' as const,
      duration: existingVideo.duration,
      thumb: existingVideo.thumbnail,
      uploader: existingVideo.uploader,
      viewCount: existingVideo.viewCount,
      uploadDate: existingVideo.uploadDate,
      url: url,
      filePath: existingVideo.filePath
    };

    const embed = new EmbedBuilder()
      .setTitle('📺 Starting Stream')
      .setDescription(`**${existingVideo.title}**`)
      .addFields(
        { name: 'Channel', value: existingVideo.uploader || 'Unknown', inline: true },
        { name: 'Duration', value: existingVideo.duration ? formatPlexDuration(existingVideo.duration) : 'Live', inline: true },
        { name: 'Source', value: '📥 Local file (no buffering!)', inline: true }
      )
      .setColor(0x00ff00)
      .setThumbnail(existingVideo.thumbnail || null);

    const controlRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId('ctrl_pause').setEmoji('⏸️').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('ctrl_stop').setEmoji('⏹️').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('ctrl_rw').setEmoji('⏪').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('ctrl_ff').setEmoji('⏩').setStyle(ButtonStyle.Secondary),
    );
    const speedRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId('ctrl_speed_down').setLabel('🐢').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('ctrl_speed').setLabel('1x').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('ctrl_speed_up').setLabel('🐇').setStyle(ButtonStyle.Secondary),
    );

    await interaction.editReply({ embeds: [embed], components: [controlRow, speedRow] });

    // Start streaming the existing file
    await videoStreamer.startLocalFile(
      guildId,
      voiceChannel.id,
      mediaItem,
      existingVideo.filePath,
      interaction.user.id,
      startTimeMs,
      existingVideo.subtitlePath
    );
    
    return;
  }

  function createProgressBar(percent: number): string {
    const barLength = 20;
    const filledLength = Math.round((percent / 100) * barLength);
    const bar = '█'.repeat(filledLength) + '░'.repeat(barLength - filledLength);
    return `[${bar}] ${percent.toFixed(1)}%`;
  }

  try {
    let downloadComplete = false;
    let currentProgress: DownloadProgress | null = null;
    let lastUpdateTime = 0;
    const UPDATE_COOLDOWN = 2000; // Update at most every 2 seconds

    // Start download with progress tracking
    const downloadPromise = downloadYouTubeVideo(url, {
      onProgress: async (progress: DownloadProgress) => {
        currentProgress = progress;
        const now = Date.now();
        
        // Rate limit updates to prevent Discord API issues
        if (now - lastUpdateTime < UPDATE_COOLDOWN) {
          return;
        }
        
        lastUpdateTime = now;
        const progressBar = createProgressBar(progress.percent);
        
        try {
          await interaction.editReply(
            `📥 **Downloading Video**\n` +
            `${progressBar}\n` +
            `📊 ${progress.speed} | ⏱️ ETA: ${progress.eta}\n` +
            `📁 Total: ${progress.total}\n\n` +
            `*Download will auto-start streaming when complete...*`
          );
          console.log(`[Controller] Updated interaction with progress: ${progress.percent.toFixed(1)}%`);
        } catch (updateError) {
          // Log but don't fail the download if interaction updates fail
          console.error('[Controller] Failed to update progress embed:', updateError);
        }
      },
      onComplete: async () => {
        console.log('[Controller] YouTube download completion callback triggered');
        downloadComplete = true;
        
        // Show final progress as 100% before showing completion message
        try {
          await interaction.editReply(
            `📥 **Downloading Video**\n` +
            `[████████████████████] 100.0%\n` +
            `📊 Complete | ⏱️ Done\n` +
            `📁 Total: ${currentProgress?.total || 'Unknown'}\n\n` +
            `🎬 *Starting stream automatically...*`
          );
          console.log('[Controller] Updated interaction with final 100% progress');
          
          // Small delay then show completion message
          await new Promise(resolve => setTimeout(resolve, 500));
          
          await interaction.editReply(
            `📥 **Download Complete!**\n` +
            `✅ Video downloaded successfully\n\n` +
            `🎬 *Starting stream automatically...*`
          );
          console.log('[Controller] Successfully updated interaction with completion message');
        } catch (error) {
          console.error('[Controller] Failed to update interaction on completion:', error);
        }
      },
      onError: async (error: string) => {
        await interaction.editReply(`❌ Download failed: ${error}`);
      }
    });

    // Wait for download to complete
    const downloadedVideo = await downloadPromise;
    
    if (!downloadedVideo) {
      return; // Error already handled by onError callback
    }

    const videoStreamer = getVideoStreamer();
    
    const mediaItem = {
      ratingKey: `yt-${Date.now()}`,
      key: url,
      title: downloadedVideo.title,
      type: 'movie' as const,
      duration: downloadedVideo.duration,
      thumb: downloadedVideo.thumbnail,
    };

    const embed = new EmbedBuilder()
      .setTitle('📺 Starting Stream')
      .setDescription(`**${downloadedVideo.title}**`)
      .addFields(
        { name: 'Channel', value: downloadedVideo.uploader || 'Unknown', inline: true },
        { name: 'Duration', value: downloadedVideo.duration ? formatPlexDuration(downloadedVideo.duration) : 'Live', inline: true },
        { name: 'Source', value: '📥 Local file (no buffering!)', inline: true }
      )
      .setColor(0x00ff00)
      .setThumbnail(downloadedVideo.thumbnail || null);

    const controlRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId('ctrl_pause').setEmoji('⏸️').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('ctrl_stop').setEmoji('⏹️').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('ctrl_rw').setEmoji('⏪').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('ctrl_ff').setEmoji('⏩').setStyle(ButtonStyle.Secondary),
    );
    const speedRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId('ctrl_speed_down').setLabel('🐢').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('ctrl_speed').setLabel('1x').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('ctrl_speed_up').setLabel('🐇').setStyle(ButtonStyle.Secondary),
    );

    await interaction.editReply({ embeds: [embed], components: [controlRow, speedRow] });

    // Start streaming the downloaded file
    videoStreamer.startLocalFile(
      guildId,
      voiceChannel.id,
      mediaItem,
      downloadedVideo.filePath,
      interaction.user.id,
      startTimeMs,
      downloadedVideo.subtitlePath
    ).catch(err => console.error('[Controller] YouTube stream error:', err));

  } catch (error) {
    console.error('[Controller] YouTube error:', error);
    await interaction.editReply(`❌ Failed to play: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

async function handleYouTubeMusic(interaction: ChatInputCommandInteraction): Promise<void> {
  const url = interaction.options.getString('url');
  const action = interaction.options.getString('action');
  const mixQuery = interaction.options.getString('query') || 'popular music';
  const timeStr = interaction.options.getString('time');

  await interaction.deferReply();

  const guildId = interaction.guildId;
  if (!guildId) {
    await interaction.editReply('❌ This command can only be used in a server');
    return;
  }

  const {
    downloadYouTubeMusic,
    findDownloadedMusicByUrl,
    getPlaylistTracks,
    getMusicRecommendations,
    isPlaylistUrl,
  } = await import('../youtube/music-downloader.js');
  type MusicDownloadProgress = import('../youtube/music-downloader.js').MusicDownloadProgress;
  type MusicTrackInfo = import('../youtube/music-downloader.js').MusicTrackInfo;
  type MusicMediaItemType = import('../types/index.js').MusicMediaItem;

  const {
    seedMusicQueue,
    clearMusicQueue,
    addToMusicQueue,
    setAutoplay,
    isAutoplayEnabled,
    getMusicQueueLength,
  } = await import('../data/music-queue.js');

  // --- Helper: build a music media item and play it ---
  async function downloadAndPlayInteraction(trackUrl: string, startTimeMs = 0): Promise<boolean> {
    const videoStreamer = getVideoStreamer();

    const guild = selfbotClient.guilds.cache.get(guildId!);
    const member = guild?.members.cache.get(interaction.user.id);
    const voiceChannel = member?.voice?.channel;
    if (!voiceChannel) {
      await interaction.editReply('❌ You must be in a voice channel');
      return false;
    }

    const existing = findDownloadedMusicByUrl(trackUrl);
    if (existing) {
      const mediaItem: MusicMediaItemType = {
        ratingKey: `music-${Date.now()}`,
        key: trackUrl,
        title: existing.title,
        artist: existing.artist,
        type: 'music',
        duration: existing.duration,
        thumb: existing.thumbnailUrl,
        url: trackUrl,
        audioPath: existing.audioPath,
        thumbnailPath: existing.thumbnailPath,
      };

      const embed = new EmbedBuilder()
        .setTitle('🎵 Now Playing')
        .setDescription(`**${existing.title}**`)
        .addFields(
          { name: 'Artist', value: existing.artist, inline: true },
          { name: 'Duration', value: existing.duration ? formatPlexDuration(existing.duration) : 'Unknown', inline: true },
          { name: 'Source', value: '📥 Cached (instant!)', inline: true },
        )
        .setColor(0x1DB954)
        .setThumbnail(existing.thumbnailUrl || null);

      const controlRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId('ctrl_pause').setEmoji('⏸️').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('ctrl_stop').setEmoji('⏹️').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('ctrl_rw').setEmoji('⏪').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('ctrl_ff').setEmoji('⏩').setStyle(ButtonStyle.Secondary),
      );

      await interaction.editReply({ embeds: [embed], components: [controlRow] });
      videoStreamer.startMusicStream(guildId!, voiceChannel.id, mediaItem, existing.audioPath, existing.thumbnailPath, existing.artist, interaction.user.id, startTimeMs)
        .catch(err => console.error('[Controller] Music stream error:', err));
      return true;
    }

    // Download fresh
    let lastUpdate = 0;
    const downloaded = await downloadYouTubeMusic(trackUrl, {
      onProgress: async (p: MusicDownloadProgress) => {
        const now = Date.now();
        if (now - lastUpdate < 2000) return;
        lastUpdate = now;
        const bar = '█'.repeat(Math.round(p.percent / 5)) + '░'.repeat(20 - Math.round(p.percent / 5));
        try {
          await interaction.editReply(
            `🎵 **Downloading Audio**\n[${bar}] ${p.percent.toFixed(1)}%\n📊 ${p.speed} | ⏱️ ETA: ${p.eta}\n\n*Will start when complete...*`,
          );
        } catch { /* ignore */ }
      },
      onComplete: async () => {
        try { await interaction.editReply(`🎵 **Download Complete!**\n✅ Audio ready\n🎶 *Starting music visualizer...*`); } catch { /* ignore */ }
      },
      onError: async (error: string) => {
        try { await interaction.editReply(`❌ Download failed: ${error}`); } catch { /* ignore */ }
      },
    });

    if (!downloaded) return false;

    const mediaItem: MusicMediaItemType = {
      ratingKey: `music-${Date.now()}`,
      key: trackUrl,
      title: downloaded.title,
      artist: downloaded.artist,
      type: 'music',
      duration: downloaded.duration,
      thumb: downloaded.thumbnailUrl,
      url: trackUrl,
      audioPath: downloaded.audioPath,
      thumbnailPath: downloaded.thumbnailPath,
    };

    const embed = new EmbedBuilder()
      .setTitle('🎵 Now Playing')
      .setDescription(`**${downloaded.title}**`)
      .addFields(
        { name: 'Artist', value: downloaded.artist, inline: true },
        { name: 'Duration', value: downloaded.duration ? formatPlexDuration(downloaded.duration) : 'Unknown', inline: true },
      )
      .setColor(0x1DB954)
      .setThumbnail(downloaded.thumbnailUrl || null);

    const controlRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId('ctrl_pause').setEmoji('⏸️').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('ctrl_stop').setEmoji('⏹️').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('ctrl_rw').setEmoji('⏪').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('ctrl_ff').setEmoji('⏩').setStyle(ButtonStyle.Secondary),
    );

    await interaction.editReply({ embeds: [embed], components: [controlRow] });
    videoStreamer.startMusicStream(guildId!, voiceChannel.id, mediaItem, downloaded.audioPath, downloaded.thumbnailPath, downloaded.artist, interaction.user.id, startTimeMs)
      .catch(err => console.error('[Controller] Music stream error:', err));
    return true;
  }

  // --- Helper: pick a seed track via yt-dlp search ---
  async function getMixSeedTrack(query: string): Promise<MusicTrackInfo | null> {
    const { spawn } = await import('child_process');
    return new Promise((resolve) => {
      const baseArgs = getYtdlpBaseArgs();
      const ytdlp = spawn('yt-dlp', [
        ...baseArgs,
        '--dump-json', '--flat-playlist', '--no-warnings',
        '-I', '1:1',
        `ytsearch1:${query}`,
      ]);
      let output = '';
      ytdlp.stdout.on('data', (d: Buffer) => { output += d.toString(); });
      ytdlp.on('close', (code: number | null) => {
        if (code !== 0 || !output.trim()) { resolve(null); return; }
        try {
          const info = JSON.parse(output.trim().split('\n')[0]);
          resolve({
            id: info.id,
            title: info.title || info.id,
            artist: info.channel || info.uploader || info.uploader_id || 'Unknown Artist',
            duration: info.duration || 0,
            url: info.url || info.webpage_url || `https://www.youtube.com/watch?v=${info.id}`,
            thumbnailUrl: info.thumbnail || `https://i.ytimg.com/vi/${info.id}/hqdefault.jpg`,
          });
        } catch { resolve(null); }
      });
      ytdlp.on('error', () => resolve(null));
    });
  }

  // --- Subcommand: autoplay ---
  if (action === 'autoplay') {
    setAutoplay(guildId, true);
    await interaction.editReply('🔁 Autoplay **enabled**. Recommendations will play when the queue is empty.');
    return;
  }

  if (action === 'autoplay-off') {
    setAutoplay(guildId, false);
    await interaction.editReply('🔁 Autoplay **disabled**. Music will stop after the queue is empty.');
    return;
  }

  // --- Subcommand: queue status ---
  if (action === 'queue') {
    const len = getMusicQueueLength(guildId);
    const autoplay = isAutoplayEnabled(guildId);
    await interaction.editReply(
      `🎵 **Music Queue:** ${len} track${len !== 1 ? 's' : ''} queued\n` +
      `🔁 Autoplay: **${autoplay ? 'on' : 'off'}**`,
    );
    return;
  }

  // --- Subcommand: stop ---
  if (action === 'stop') {
    clearMusicQueue(guildId);
    const videoStreamer = getVideoStreamer();
    await videoStreamer.stopStream(guildId);
    await interaction.editReply('⏹️ Music stopped and queue cleared.');
    return;
  }

  // --- Subcommand: mix ---
  if (action === 'mix' || (!url && !action)) {
    const guild = selfbotClient.guilds.cache.get(guildId);
    const member = guild?.members.cache.get(interaction.user.id);
    if (!member?.voice?.channel) {
      await interaction.editReply('❌ You must be in a voice channel');
      return;
    }

    await interaction.editReply(`🎵 Finding a mix for: **${mixQuery}**...`);

    try {
      const seedTrack = await getMixSeedTrack(mixQuery);
      if (!seedTrack) {
        await interaction.editReply('❌ Could not find a seed track. Try a different query.');
        return;
      }

      await interaction.editReply(`🎵 Found seed: **${seedTrack.title}** — fetching mix...`);

      const recommendations = await getMusicRecommendations(seedTrack.id, 10);
      if (recommendations.length === 0) {
        await interaction.editReply('❌ Could not fetch mix recommendations. Try a direct playlist URL instead.');
        return;
      }

      clearMusicQueue(guildId);
      if (recommendations.length > 1) {
        addToMusicQueue(guildId, recommendations.slice(1));
      }

      await interaction.editReply(
        `🎵 **Mix loaded:** ${recommendations.length} tracks\n` +
        `▶️ Starting with: **${recommendations[0].title}**\n\n` +
        `*Downloading first track...*`,
      );

      await downloadAndPlayInteraction(recommendations[0].url, 0);

      try {
        await interaction.followUp(
          `📋 **${recommendations.length - 1} more track${recommendations.length - 1 !== 1 ? 's' : ''}** queued.\n` +
          `Autoplay is **${isAutoplayEnabled(guildId) ? 'on' : 'off'}** — use \`/ytm action:autoplay-off\` to disable.`,
        );
      } catch { /* ignore follow-up errors */ }
    } catch (error) {
      console.error('[Controller] Mix error:', error);
      await interaction.editReply(`❌ Failed to load mix: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
    return;
  }

  // --- No URL provided and no actionable subcommand ---
  if (!url) {
    await interaction.editReply(
      '❌ Provide a URL or use the `action` option.\n' +
      '• `/ytm url:<url>` — single track, playlist, or album\n' +
      '• `/ytm action:mix query:<search>` — play an auto-mix\n' +
      '• `/ytm action:queue` — show queue status\n' +
      '• `/ytm action:stop` — stop music',
    );
    return;
  }

  // --- Playlist / Album ---
  if (isPlaylistUrl(url)) {
    const guild = selfbotClient.guilds.cache.get(guildId);
    const member = guild?.members.cache.get(interaction.user.id);
    if (!member?.voice?.channel) {
      await interaction.editReply('❌ You must be in a voice channel');
      return;
    }

    try {
      await interaction.editReply('🎵 Fetching playlist tracks...');
      const tracks = await getPlaylistTracks(url);

      if (tracks.length === 0) {
        await interaction.editReply('❌ Could not fetch any tracks from that playlist/album. Try a direct video URL instead.');
        return;
      }

      clearMusicQueue(guildId);
      if (tracks.length > 1) {
        seedMusicQueue(guildId, tracks.slice(1));
      }

      await interaction.editReply(
        `🎵 **Playlist loaded:** ${tracks.length} tracks\n` +
        `▶️ Starting with: **${tracks[0].title}**\n\n` +
        `*Downloading first track...*`,
      );

      await downloadAndPlayInteraction(tracks[0].url, 0);

      try {
        await interaction.followUp(
          `📋 **${tracks.length - 1} more track${tracks.length - 1 !== 1 ? 's' : ''}** queued after this one.\n` +
          `Use \`/ytm action:queue\` to check | \`/ytm action:autoplay-off\` to disable autoplay.`,
        );
      } catch { /* ignore */ }
    } catch (error) {
      console.error('[Controller] Playlist error:', error);
      await interaction.editReply(`❌ Failed to load playlist: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
    return;
  }

  // --- Single track ---
  const guild = selfbotClient.guilds.cache.get(guildId);
  const member = guild?.members.cache.get(interaction.user.id);
  if (!member?.voice?.channel) {
    await interaction.editReply('❌ You must be in a voice channel');
    return;
  }

  let startTimeMs = 0;
  if (timeStr) {
    const parsed = parseTimeString(timeStr);
    if (parsed === null) {
      await interaction.editReply('❌ Invalid time format. Use MM:SS or HH:MM:SS');
      return;
    }
    startTimeMs = parsed;
  }

  clearMusicQueue(guildId);

  try {
    await interaction.editReply('🎵 Fetching music info...');
    await downloadAndPlayInteraction(url, startTimeMs);
  } catch (error) {
    console.error('[Controller] YouTube Music error:', error);
    await interaction.editReply(`❌ Failed to play: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

async function handleUrl(interaction: ChatInputCommandInteraction): Promise<void> {
  const url = interaction.options.getString('url', true);
  const title = interaction.options.getString('title') || 'External Stream';
  const queueOption = interaction.options.getBoolean('queue') || false;

  const guildId = interaction.guildId;
  if (!guildId) {
    await interaction.reply({ content: '❌ This command can only be used in a server', ephemeral: true });
    return;
  }

  // If queue option is selected, add to queue instead of playing
  if (queueOption) {
    try {
      // Get stream type for better queue display
      const { getStreamType } = await import('../bot/commands/url.js');
      const streamType = getStreamType(url);
      
      const mediaItem: MediaItem = {
        ratingKey: `url-${Date.now()}`,
        key: url,
        type: 'external',
        title: title,
        duration: 0, // Unknown for external streams
        url: url,
        streamType: streamType
      };

      const added = addToQueue(mediaItem, interaction.user.id);
      if (!added) {
        await interaction.reply({ content: '❌ This stream is already in the queue', ephemeral: true });
        return;
      }

      await interaction.reply(`✅ Added to queue: **${title}** (${streamType})`);
      return;
    } catch (error) {
      console.error('[Controller] Error adding URL to queue:', error);
      await interaction.reply({ content: '❌ Failed to add stream to queue', ephemeral: true });
      return;
    }
  }

  // Original playback logic continues here...
  const guild = selfbotClient.guilds.cache.get(guildId);
  const member = guild?.members.cache.get(interaction.user.id);
  const voiceChannel = member?.voice?.channel;

  if (!voiceChannel) {
    await interaction.reply({ content: '❌ You must be in a voice channel', ephemeral: true });
    return;
  }

  await interaction.deferReply();

  // Try to extract actual stream URL using yt-dlp for masked streams
  let streamUrl = url;
  let actualTitle = title;
  
  // Use yt-dlp for suspicious URLs (json, svg, etc. that might be masked streams)
  if (url.includes('.json') || url.includes('.svg') || url.includes('.php') || url.includes('.js')) {
    await interaction.editReply({ content: '🔍 Detecting masked stream...', embeds: [], components: [] });
    
    try {
      const { spawn } = await import('child_process');
      const extractedUrl = await new Promise<string>((resolve) => {
        const baseArgs = getYtdlpBaseArgs();
        const ytdlp = spawn('yt-dlp', [
          ...baseArgs,
          '-g',
          '--no-warnings',
          url
        ]);

        let output = '';
        ytdlp.stdout.on('data', (data) => {
          output += data.toString();
        });

        ytdlp.on('close', (code) => {
          if (code !== 0 || !output.trim()) {
            resolve('');
            return;
          }
          resolve(output.trim().split('\n')[0]);
        });

        ytdlp.on('error', () => {
          resolve('');
        });
      });

      if (extractedUrl) {
        streamUrl = extractedUrl;
        console.log(`[Controller] Extracted real stream URL: ${streamUrl}`);
      }
    } catch (error) {
      console.error('[Controller] Failed to extract stream URL:', error);
    }
  }

  const mediaItem = {
    ratingKey: `url-${Date.now()}`,
    key: url,
    title: actualTitle,
    type: 'movie' as const,
    duration: 0,
  };

  const embed = new EmbedBuilder()
    .setTitle('📺 Now Streaming')
    .setDescription(`**${actualTitle}**`)
    .setColor(0x0099ff);

  const controlRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId('ctrl_pause').setEmoji('⏸️').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('ctrl_stop').setEmoji('⏹️').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('ctrl_rw').setEmoji('⏪').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('ctrl_ff').setEmoji('⏩').setStyle(ButtonStyle.Secondary),
  );
  const speedRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId('ctrl_speed_down').setLabel('🐢').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('ctrl_speed').setLabel('1x').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('ctrl_speed_up').setLabel('🐇').setStyle(ButtonStyle.Secondary),
  );

  await interaction.editReply({ embeds: [embed], components: [controlRow, speedRow] });

  const videoStreamer = getVideoStreamer();
  videoStreamer.startExternalStream(
    guildId,
    voiceChannel.id,
    mediaItem,
    streamUrl,
    interaction.user.id
  ).catch(err => console.error('[Controller] URL stream error:', err));
}

async function handleYouTubeSearch(interaction: ChatInputCommandInteraction): Promise<void> {
  const query = interaction.options.getString('query', true);
  await interaction.deferReply();

  const { spawn } = await import('child_process');
  
  const results = await new Promise<YouTubeSearchResult[]>((resolve) => {
    const baseArgs = getYtdlpBaseArgs();
    const ytdlp = spawn('yt-dlp', [
      ...baseArgs,
      '--dump-json',
      '--flat-playlist',
      '--no-warnings',
      '-I', '1:10',
      `ytsearch10:${query}`
    ]);

    let output = '';
    let error = '';

    ytdlp.stdout.on('data', (data) => {
      output += data.toString();
    });

    ytdlp.stderr.on('data', (data) => {
      error += data.toString();
    });

    ytdlp.on('close', (code) => {
      if (code !== 0 || !output) {
        console.error('[YouTubeSearch] yt-dlp error:', error);
        resolve([]);
        return;
      }

      try {
        const results: YouTubeSearchResult[] = [];
        const lines = output.trim().split('\n');
        
        for (const line of lines) {
          if (!line.trim()) continue;
          const info = JSON.parse(line);
          
          // Generate thumbnail URL from video ID if not provided
          const thumbnailUrl = info.thumbnail || `https://i.ytimg.com/vi/${info.id}/hqdefault.jpg`;
          
          results.push({
            id: info.id,
            title: info.title || 'Unknown',
            duration: info.duration ? formatDuration(info.duration) : 'Unknown',
            channel: info.channel || info.uploader || info.uploader_id || 'Unknown',
            url: info.url || `https://www.youtube.com/watch?v=${info.id}`,
            thumbnail: thumbnailUrl,
            description: 'Click play for details',
            views: info.view_count ? formatNumber(info.view_count) : 'Unknown',
            likes: info.like_count ? formatNumber(info.like_count) : 'Unknown',
            uploadDate: info.upload_date ? formatDate(info.upload_date) : 'Unknown',
          });
        }
        
        resolve(results);
      } catch (e) {
        console.error('[YouTubeSearch] Failed to parse results:', e);
        resolve([]);
      }
    });

    ytdlp.on('error', (err) => {
      console.error('[YouTubeSearch] yt-dlp spawn error:', err);
      resolve([]);
    });
  });

  if (results.length === 0) {
    await interaction.editReply('❌ No results found. Try a different search query.');
    return;
  }

  // Cache results and set page to 0
  youtubeSearchSessions.set(interaction.user.id, {
    results,
    timestamp: Date.now(),
  });
  youtubeSearchPages.set(interaction.user.id, { page: 0 });

  // Display first page
  await displayYouTubeSearchPage(interaction, 0);
}

async function handleYouTubeTrending(interaction: ChatInputCommandInteraction): Promise<void> {
  const category = interaction.options.getString('category') || 'default';
  await interaction.deferReply();

  const { spawn } = await import('child_process');
  
  // Category URLs for trending
  const CATEGORY_URLS: Record<string, string> = {
    default: 'https://www.youtube.com/feed/trending',
    music: 'https://www.youtube.com/feed/trending?bp=4gIuCggvbS8wNGZrbmIyUgIIAzABOAFAAUgBUAFYAWAAaAGqAQtUcmVuZGluZyBub3c%3D',
    gaming: 'https://www.youtube.com/feed/trending?bp=4gIuCggvbS8wNGZrbmIyUgIIAzABOAFAAUgBUAFYAWAAaAGqAQtUcmVuZGluZyBub3c%3D',
    news: 'https://www.youtube.com/feed/trending?bp=4gIuCggvbS8wNGZrbmIyUgIIAzABOAFAAUgBUAFYAWAAaAGqAQtUcmVuZGluZyBub3c%3D',
    movies: 'https://www.youtube.com/feed/trending?bp=4gIuCggvbS8wNGZrbmIyUgIIAzABOAFAAUgBUAFYAWAAaAGqAQtUcmVuZGluZyBub3c%3D',
    sports: 'https://www.youtube.com/feed/trending?bp=4gIuCggvbS8wNGZrbmIyUgIIAzABOAFAAUgBUAFYAWAAaAGqAQtUcmVuZGluZyBub3c%3D',
    learning: 'https://www.youtube.com/feed/trending?bp=4gIuCggvbS8wNGZrbmIyUgIIAzABOAFAAUgBUAFYAWAAaAGqAQtUcmVuZGluZyBub3c%3D',
    tech: 'https://www.youtube.com/feed/trending?bp=4gIuCggvbS8wNGZrbmIyUgIIAzABOAFAAUgBUAFYAWAAaAGqAQtUcmVuZGluZyBub3c%3D',
  };

  // Fallback channels if trending fails
  const FALLBACK_CHANNELS = {
    music: ['https://www.youtube.com/@music', 'https://www.youtube.com/@billboard'],
    gaming: ['https://www.youtube.com/@YouTubeGaming', 'https://www.youtube.com/@IGN'],
    news: ['https://www.youtube.com/@BBCNews', 'https://www.youtube.com/@CNN'],
    tech: ['https://www.youtube.com/@MKBHD', 'https://www.youtube.com/@LinusTechTips'],
    default: ['https://www.youtube.com/@MrBeast', 'https://www.youtube.com/@pewdiepie'],
  };

  const fetchFromUrl = async (url: string, limit: number): Promise<YouTubeSearchResult[]> => {
    // First get video IDs with flat playlist
    const videoIds = await new Promise<string[]>((resolve) => {
      const baseArgs = getYtdlpBaseArgs();
      const ytdlp = spawn('yt-dlp', [
        ...baseArgs,
        '--flat-playlist',
        '--no-warnings',
        '-I', `1:${limit}`,
        '--get-id',
        url
      ]);

      let output = '';
      let error = '';

      ytdlp.stdout.on('data', (data) => {
        output += data.toString();
      });

      ytdlp.stderr.on('data', (data) => {
        error += data.toString();
      });

      ytdlp.on('close', (code) => {
        if (code !== 0 || !output) {
          console.error('[YouTubeTrending] yt-dlp error:', error);
          resolve([]);
          return;
        }

        const ids = output.trim().split('\n').filter(line => line.trim());
        resolve(ids);
      });

      ytdlp.on('error', (err) => {
        console.error('[YouTubeTrending] yt-dlp spawn error:', err);
        resolve([]);
      });
    });

    if (videoIds.length === 0) return [];

    // Now fetch full metadata for each video in parallel
    const metadataPromises = videoIds.map(id => 
      new Promise<YouTubeSearchResult | null>((resolve) => {
        const baseArgs = getYtdlpBaseArgs();
        const ytdlp = spawn('yt-dlp', [
          ...baseArgs,
          '--dump-json',
          '--no-warnings',
          `https://www.youtube.com/watch?v=${id}`
        ]);

        let output = '';
        let error = '';

        ytdlp.stdout.on('data', (data) => {
          output += data.toString();
        });

        ytdlp.stderr.on('data', (data) => {
          error += data.toString();
        });

        ytdlp.on('close', (code) => {
          if (code !== 0 || !output) {
            resolve(null);
            return;
          }

          try {
            const info = JSON.parse(output.trim());
            resolve({
              id: info.id,
              title: info.title || 'Unknown',
              duration: info.duration ? formatDuration(info.duration) : 'Live',
              channel: info.channel || info.uploader || info.uploader_id || 'Unknown',
              url: info.url || `https://www.youtube.com/watch?v=${info.id}`,
              thumbnail: info.thumbnail || `https://i.ytimg.com/vi/${info.id}/hqdefault.jpg`,
              description: info.description ? (info.description.substring(0, 100) + '...') : 'No description',
              views: info.view_count ? formatNumber(info.view_count) : 'Unknown',
              likes: info.like_count ? formatNumber(info.like_count) : 'Unknown',
              uploadDate: info.upload_date ? formatDate(info.upload_date) : 'Unknown',
            });
          } catch (e) {
            resolve(null);
          }
        });

        ytdlp.on('error', () => {
          resolve(null);
        });
      })
    );

    const metadataResults = await Promise.all(metadataPromises);
    const results = metadataResults.filter((r): r is YouTubeSearchResult => r !== null);
    return results;
  };

  const formatDuration = (seconds: number | null): string => {
    if (!seconds) return 'Live';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) {
      return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }
    return `${m}:${String(s).padStart(2, '0')}`;
  };

  const formatNumber = (num: number): string => {
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(0)}K`;
    return num.toString();
  };

  const formatDate = (dateStr: string): string => {
    const date = new Date(dateStr);
    return date.toLocaleDateString();
  };

  // Try trending feed first
  const categoryKey = category as keyof typeof CATEGORY_URLS;
  const trendingUrl = CATEGORY_URLS[categoryKey] || CATEGORY_URLS.default;
  let results = await fetchFromUrl(trendingUrl, 10);
  
  // If trending fails, try fallback channels
  if (results.length === 0) {
    const categoryKey = category as keyof typeof FALLBACK_CHANNELS;
    const fallbackChannelUrls = FALLBACK_CHANNELS[categoryKey] || FALLBACK_CHANNELS.default;
    
    for (const channelUrl of fallbackChannelUrls) {
      const channelResults = await fetchFromUrl(channelUrl, 5);
      results.push(...channelResults);
      if (results.length >= 10) break;
    }
  }

  if (results.length === 0) {
    await interaction.editReply('❌ No trending videos found. Try again later or a different category.');
    return;
  }

  // Cache results for ytp command
  youtubeSearchSessions.set(interaction.user.id, {
    results,
    timestamp: Date.now(),
  });
  youtubeSearchPages.set(interaction.user.id, { page: 0 });

  // Display results
  await displayYouTubeSearchPage(interaction, 0);
}

async function displayYouTubeSearchPage(interaction: ChatInputCommandInteraction | ButtonInteraction, page: number): Promise<void> {
  const session = youtubeSearchSessions.get(interaction.user.id);
  if (!session || Date.now() - session.timestamp > SESSION_TIMEOUT) {
    if (interaction.replied || interaction.deferred) {
      await interaction.editReply({ content: '❌ Search expired. Use /yts to search first.', embeds: [], components: [] });
    } else {
      await interaction.reply({ content: '❌ Search expired. Use /yts to search first.', ephemeral: true });
    }
    return;
  }

  const results = session.results;
  const totalPages = results.length; // One video per page
  
  if (page >= totalPages || page < 0) {
    await interaction.editReply({ content: '❌ Invalid page number', embeds: [], components: [] });
    return;
  }

  const video = results[page];
  const actualIndex = page + 1;

  // Create embed with full video details
  const embed = new EmbedBuilder()
    .setTitle(`🎬 ${video.title}`)
    .setURL(video.url)
    .setColor(0xff0000)
    .setThumbnail(video.thumbnail)
    .addFields(
      { name: '👤 Channel', value: video.channel, inline: true },
      { name: '⏱️ Duration', value: video.duration, inline: true },
      { name: '👁️ Views', value: video.views, inline: true },
      { name: '👍 Likes', value: video.likes, inline: true },
      { name: '📅 Uploaded', value: video.uploadDate, inline: true },
      { name: '🔗 Video ID', value: video.id, inline: true }
    )
    .setDescription(`**Description:**\n${video.description}`)
    .setFooter({ 
      text: `Result ${actualIndex} of ${results.length} • Use /ytp ${actualIndex} to play` 
    });

  // Create action row with play button and pagination
  const actionRow = new ActionRowBuilder<ButtonBuilder>();
  
  // Play button
  actionRow.addComponents(
    new ButtonBuilder()
      .setCustomId(`yt_play_${page}`)
      .setLabel('▶️ Play')
      .setStyle(ButtonStyle.Success)
  );

  // Previous button
  if (page > 0) {
    actionRow.addComponents(
      new ButtonBuilder()
        .setCustomId('yt_page_prev')
        .setLabel('◀️ Previous')
        .setStyle(ButtonStyle.Secondary)
    );
  }

  // Page info
  actionRow.addComponents(
    new ButtonBuilder()
      .setCustomId('yt_page_info')
      .setLabel(`${page + 1}/${totalPages}`)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(true)
  );

  // Next button
  if (page < totalPages - 1) {
    actionRow.addComponents(
      new ButtonBuilder()
        .setCustomId('yt_page_next')
        .setLabel('Next ▶️')
        .setStyle(ButtonStyle.Secondary)
    );
  }

  // Quick navigation row for many results
  const navRow = new ActionRowBuilder<ButtonBuilder>();
  if (totalPages > 5) {
    navRow.addComponents(
      new ButtonBuilder()
        .setCustomId('yt_page_first')
        .setLabel('⏮️ First')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('yt_page_last')
        .setLabel('⏭️ Last')
        .setStyle(ButtonStyle.Secondary)
    );
  }

  const components = [actionRow];
  if (navRow.components.length > 0) {
    components.push(navRow);
  }

  if (interaction.isButton()) {
    await interaction.update({ embeds: [embed], components });
  } else {
    await interaction.editReply({ embeds: [embed], components });
  }
}

async function handleYouTubePlay(interaction: ChatInputCommandInteraction): Promise<void> {
  const number = interaction.options.getInteger('number', true);
  
  const session = youtubeSearchSessions.get(interaction.user.id);
  if (!session || Date.now() - session.timestamp > SESSION_TIMEOUT) {
    await interaction.reply({ content: '❌ Search expired. Use /yts to search first.', ephemeral: true });
    return;
  }

  const result = session.results[number - 1];
  if (!result) {
    await interaction.reply({ content: '❌ Invalid selection', ephemeral: true });
    return;
  }

  await interaction.deferReply();

  // Get voice channel
  const guildId = interaction.guildId;
  if (!guildId) {
    await interaction.editReply('❌ Guild not found');
    return;
  }

  const guild = selfbotClient.guilds.cache.get(guildId);
  const member = guild?.members.cache.get(interaction.user.id);
  const voiceChannel = member?.voice?.channel;

  if (!voiceChannel) {
    await interaction.editReply('❌ You must be in a voice channel');
    return;
  }

  // Get video info and stream
  const { spawn } = await import('child_process');
  
  const info = await new Promise<any>((resolve) => {
    const baseArgs = getYtdlpBaseArgs();
    const ytdlp = spawn('yt-dlp', [...baseArgs, '--dump-json', '--no-playlist', '--no-warnings', result.url]);
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

  const urls = await new Promise<{ video: string; audio: string | null } | null>((resolve) => {
    const baseArgs = getYtdlpBaseArgs();
    const ytdlp = spawn('yt-dlp', [
      ...baseArgs,
      '-g',
      '-f', 'bestvideo[height<=1080]+bestaudio/best[height<=1080]/best',
      '--no-playlist',
      '--no-warnings',
      result.url
    ]);

    let output = '';
    ytdlp.stdout.on('data', (data) => output += data.toString());
    ytdlp.on('close', (code) => {
      if (code !== 0 || !output.trim()) { resolve(null); return; }
      const urls = output.trim().split('\n');
      resolve({
        video: urls[0],
        audio: urls[1] || null,
      });
    });
    ytdlp.on('error', () => resolve(null));
  });

  if (!urls) {
    await interaction.editReply('❌ Failed to get stream URL');
    return;
  }

  const mediaItem = {
    ratingKey: `yt-${Date.now()}`,
    key: result.url,
    title: info.title,
    type: 'movie' as const,
    duration: info.duration,
    thumb: info.thumbnail,
    summary: info.uploader ? `By ${info.uploader}` : undefined,
  };

  const embed = new EmbedBuilder()
    .setTitle('📺 Now Playing')
    .setDescription(`**${info.title}**\n${info.uploader ? `👤 ${info.uploader}\n` : ''}⏱️ ${formatDuration(info.duration)}`)
    .setColor(0xff0000)
    .setThumbnail(info.thumbnail || null);

  const controlRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId('ctrl_pause').setEmoji('⏸️').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('ctrl_stop').setEmoji('⏹️').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('ctrl_rw').setEmoji('⏪').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('ctrl_ff').setEmoji('⏩').setStyle(ButtonStyle.Secondary),
  );
  const speedRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId('ctrl_speed_down').setLabel('🐢').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('ctrl_speed').setLabel('1x').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('ctrl_speed_up').setLabel('🐇').setStyle(ButtonStyle.Secondary),
  );

  const reply = await interaction.editReply({ embeds: [embed], components: [controlRow, speedRow] });

  const videoStreamer = getVideoStreamer();
  // Store message info for embed updates
  videoStreamer.setEmbedMessage(guildId, reply.id, interaction.channelId);
  
  videoStreamer.startExternalStream(
    guildId,
    voiceChannel.id,
    mediaItem,
    urls.video,
    interaction.user.id,
    urls.audio
  ).catch(err => console.error('[Controller] YouTube stream error:', err));
}

function formatDuration(milliseconds: number | null): string {
  if (!milliseconds) return 'Live/Unknown';
  const totalSeconds = Math.floor(milliseconds / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${m}:${String(s).padStart(2, '0')}`;
}

function formatNumber(num: number): string {
  if (num >= 1000000) {
    return (num / 1000000).toFixed(1) + 'M';
  } else if (num >= 1000) {
    return (num / 1000).toFixed(1) + 'K';
  }
  return num.toString();
}

function formatDate(dateStr: string): string {
  // yt-dlp returns YYYYMMDD format
  if (dateStr.length !== 8) return dateStr;
  const year = dateStr.substring(0, 4);
  const month = dateStr.substring(4, 6);
  const day = dateStr.substring(6, 8);
  return `${day}/${month}/${year}`;
}

async function handleButton(interaction: ButtonInteraction): Promise<void> {
  const videoStreamer = getVideoStreamer();
  const guildId = interaction.guildId || (interaction as any).message?.guildId;
  
  if (!guildId) {
    await interaction.reply({ content: '❌ Guild not found', ephemeral: true });
    return;
  }

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
      const currentFormatted = formatDuration(currentTime);
      const remainingFormatted = formatDuration(session.duration - currentTime);
      
      const modal = new ModalBuilder()
        .setCustomId('seek_forward_modal')
        .setTitle('⏩ Seek Forward');
      
      const timeInput = new TextInputBuilder()
        .setCustomId('seek_time')
        .setLabel(`Current: ${currentFormatted} | Remaining: ${remainingFormatted}`)
        .setPlaceholder('Enter seconds to skip forward (e.g., 30, 60, 300)')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(4);
      
      const actionRow = new ActionRowBuilder<TextInputBuilder>().addComponents(timeInput);
      modal.addComponents(actionRow);
      
      await interaction.showModal(modal);
      break;
    }
    case 'ctrl_rw': {
      const session = videoStreamer.getSession(guildId);
      if (!session) {
        await interaction.reply({ content: '❌ Nothing is playing', ephemeral: true });
        return;
      }
      
      const currentTime = videoStreamer.getCurrentTime(guildId);
      const currentFormatted = formatDuration(currentTime);
      const remainingFormatted = formatDuration(session.duration - currentTime);
      
      const modal = new ModalBuilder()
        .setCustomId('seek_backward_modal')
        .setTitle('⏪ Seek Backward');
      
      const timeInput = new TextInputBuilder()
        .setCustomId('seek_time')
        .setLabel(`Current: ${currentFormatted} | Remaining: ${remainingFormatted}`)
        .setPlaceholder('Enter seconds to skip backward (e.g., 30, 60, 300)')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(4);
      
      const actionRow = new ActionRowBuilder<TextInputBuilder>().addComponents(timeInput);
      modal.addComponents(actionRow);
      
      await interaction.showModal(modal);
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
      await videoStreamer.startStream(
        guildId,
        session.channelId,
        nextEpisode,
        streamInfo.url,
        0,
        interaction.user.id
      );
      await interaction.editReply(`⏭️ Skipped to: ${nextEpisode.title}`);
      break;
    }
    case 'ctrl_speed': {
      // Cycle through speeds: 1x -> 1.25x -> 1.5x -> 2x -> 1x
      await interaction.deferReply({ ephemeral: true });
      const currentSpeed = videoStreamer.getSpeed(guildId);
      const speeds = [1, 1.25, 1.5, 2];
      const currentIndex = speeds.indexOf(currentSpeed);
      const nextSpeed = speeds[(currentIndex + 1) % speeds.length];
      
      await videoStreamer.setSpeed(guildId, nextSpeed);
      const speedEmoji = nextSpeed > 1 ? '⏩' : '▶️';
      await interaction.editReply(`${speedEmoji} Speed: **${nextSpeed}x**`);
      break;
    }
    case 'ctrl_speed_up': {
      await interaction.deferReply({ ephemeral: true });
      const currentSpeed = videoStreamer.getSpeed(guildId);
      const newSpeed = Math.min(currentSpeed + 0.25, 3);
      await videoStreamer.setSpeed(guildId, newSpeed);
      await interaction.editReply(`⏩ Speed: **${newSpeed}x**`);
      break;
    }
    case 'ctrl_speed_down': {
      await interaction.deferReply({ ephemeral: true });
      const currentSpeed = videoStreamer.getSpeed(guildId);
      const newSpeed = Math.max(currentSpeed - 0.25, 0.5);
      await videoStreamer.setSpeed(guildId, newSpeed);
      const speedEmoji = newSpeed < 1 ? '⏪' : newSpeed > 1 ? '⏩' : '▶️';
      await interaction.editReply(`${speedEmoji} Speed: **${newSpeed}x**`);
      break;
    }
    default: {
      // Handle YouTube play buttons
      if (interaction.customId.startsWith('yt_play_')) {
        const index = parseInt(interaction.customId.replace('yt_play_', ''), 10);
        const session = youtubeSearchSessions.get(interaction.user.id);
        
        if (!session || Date.now() - session.timestamp > SESSION_TIMEOUT) {
          await interaction.reply({ content: '❌ Search expired. Use /yts to search first.', ephemeral: true });
          return;
        }

        const result = session.results[index];
        if (!result) {
          await interaction.reply({ content: '❌ Invalid selection', ephemeral: true });
          return;
        }

        // Get voice channel
        const guild = selfbotClient.guilds.cache.get(guildId);
        const member = guild?.members.cache.get(interaction.user.id);
        const voiceChannel = member?.voice?.channel;

        if (!voiceChannel) {
          await interaction.reply({ content: '❌ You must be in a voice channel', ephemeral: true });
          return;
        }

        await interaction.deferReply();

        // Get video info and stream
        const { spawn } = await import('child_process');
        
        const info = await new Promise<any>((resolve) => {
          const baseArgs = getYtdlpBaseArgs();
          const ytdlp = spawn('yt-dlp', [...baseArgs, '--dump-json', '--no-playlist', '--no-warnings', result.url]);
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

        const urls = await new Promise<{ video: string; audio: string | null } | null>((resolve) => {
          const baseArgs = getYtdlpBaseArgs();
          const ytdlp = spawn('yt-dlp', [
            ...baseArgs,
            '-g',
            '-f', 'bestvideo[height<=1080]+bestaudio/best[height<=1080]/best',
            '--no-playlist',
            '--no-warnings',
            result.url
          ]);

          let output = '';
          ytdlp.stdout.on('data', (data) => output += data.toString());
          ytdlp.on('close', (code) => {
            if (code !== 0 || !output.trim()) { resolve(null); return; }
            const urls = output.trim().split('\n');
            resolve({
              video: urls[0],
              audio: urls[1] || null,
            });
          });
          ytdlp.on('error', () => resolve(null));
        });

        if (!urls) {
          await interaction.editReply('❌ Failed to get stream URL');
          return;
        }

        const mediaItem = {
          ratingKey: `yt-${Date.now()}`,
          key: result.url,
          title: info.title,
          type: 'movie' as const,
          duration: info.duration,
          thumb: info.thumbnail,
          summary: info.uploader ? `By ${info.uploader}` : undefined,
        };

        const embed = new EmbedBuilder()
          .setTitle('📺 Now Playing')
          .setDescription(`**${info.title}**\n${info.uploader ? `👤 ${info.uploader}\n` : ''}⏱️ ${formatDuration(info.duration)}`)
          .setColor(0xff0000)
          .setThumbnail(info.thumbnail || null);

        const controlRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setCustomId('ctrl_pause').setEmoji('⏸️').setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId('ctrl_stop').setEmoji('⏹️').setStyle(ButtonStyle.Danger),
          new ButtonBuilder().setCustomId('ctrl_rw').setEmoji('⏪').setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId('ctrl_ff').setEmoji('⏩').setStyle(ButtonStyle.Secondary),
        );
        const speedRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setCustomId('ctrl_speed_down').setLabel('🐢').setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId('ctrl_speed').setLabel('1x').setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId('ctrl_speed_up').setLabel('🐇').setStyle(ButtonStyle.Secondary),
        );

        const reply = await interaction.editReply({ embeds: [embed], components: [controlRow, speedRow] });

        const videoStreamer = getVideoStreamer();
        // Store message info for embed updates
        videoStreamer.setEmbedMessage(guildId, reply.id, interaction.channelId);
        
        videoStreamer.startExternalStream(
          guildId,
          voiceChannel.id,
          mediaItem,
          urls.video,
          interaction.user.id,
          urls.audio
        ).catch(err => console.error('[Controller] YouTube stream error:', err));
      }
      // Handle YouTube pagination buttons
      else if (interaction.customId === 'yt_page_prev') {
        const currentPage = youtubeSearchPages.get(interaction.user.id)?.page || 0;
        if (currentPage > 0) {
          youtubeSearchPages.set(interaction.user.id, { page: currentPage - 1 });
          await displayYouTubeSearchPage(interaction, currentPage - 1);
        }
      }
      else if (interaction.customId === 'yt_page_next') {
        const session = youtubeSearchSessions.get(interaction.user.id);
        if (!session || Date.now() - session.timestamp > SESSION_TIMEOUT) {
          await interaction.reply({ content: '❌ Search expired', ephemeral: true });
          return;
        }
        const currentPage = youtubeSearchPages.get(interaction.user.id)?.page || 0;
        const totalPages = session.results.length; // One video per page
        if (currentPage < totalPages - 1) {
          youtubeSearchPages.set(interaction.user.id, { page: currentPage + 1 });
          await displayYouTubeSearchPage(interaction, currentPage + 1);
        }
      }
      else if (interaction.customId === 'yt_page_first') {
        youtubeSearchPages.set(interaction.user.id, { page: 0 });
        await displayYouTubeSearchPage(interaction, 0);
      }
      else if (interaction.customId === 'yt_page_last') {
        const session = youtubeSearchSessions.get(interaction.user.id);
        if (!session || Date.now() - session.timestamp > SESSION_TIMEOUT) {
          await interaction.reply({ content: '❌ Search expired', ephemeral: true });
          return;
        }
        const lastPage = session.results.length - 1;
        youtubeSearchPages.set(interaction.user.id, { page: lastPage });
        await displayYouTubeSearchPage(interaction, lastPage);
      }
    }
  }
}

async function handleSelectMenu(interaction: StringSelectMenuInteraction): Promise<void> {
  if (interaction.customId === 'select_network') {
    await showChannelSelector(interaction);
  } else if (interaction.customId === 'select_channel') {
    await interaction.deferReply();
    const ratingKey = interaction.values[0];
    const channels = await plexClient.getLiveTVChannels();
    const channel = channels.find(ch => ch.ratingKey === ratingKey);
    
    if (!channel) {
      await interaction.followUp({ content: '❌ Channel not found', ephemeral: true });
      return;
    }
    
    await startPlayback(interaction, channel);
  } else if (interaction.customId === 'search_select') {
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
  } else if (interaction.customId.startsWith('season_select_')) {
    const ratingKey = interaction.customId.replace('season_select_', '');
    const [seasonRatingKey, seasonIndex] = interaction.values[0].split('_');
    
    const session = searchSessions.get(interaction.user.id);
    const show = session?.results.find(r => r.ratingKey === ratingKey);

    if (!show) {
      await interaction.reply({ content: '❌ Show not found', ephemeral: true });
      return;
    }

    await interaction.deferReply();
    await showEpisodesForSeason(interaction, show, seasonRatingKey, parseInt(seasonIndex));
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

async function showChannelSelector(interaction: StringSelectMenuInteraction): Promise<void> {
  // Get the selected network from the interaction message
  const selectedNetwork = interaction.values[0];
  
  // Get all channels and filter by selected network
  const allChannels = await plexClient.getLiveTVChannels();
  const networkChannels = allChannels.filter(ch => ch.grandparentTitle === selectedNetwork);
  
  if (networkChannels.length === 0) {
    await interaction.followUp({ content: '❌ No channels found for this network', ephemeral: true });
    return;
  }
  
  // Sort channels by number
  const sortedChannels = networkChannels.sort((a, b) => (a.index || 0) - (b.index || 0));
  
  // Create channel selection dropdown (limit to 25 options)
  const channelOptions = sortedChannels.slice(0, 25).map(channel => ({
    label: `${channel.index || '?'} - ${channel.title}`,
    description: channel.summary || `Channel ${channel.index}`,
    value: channel.ratingKey,
  }));
  
  const channelSelect = new StringSelectMenuBuilder()
    .setCustomId('select_channel')
    .setPlaceholder('Select a channel...')
    .addOptions(channelOptions);
  
  const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(channelSelect);
  
  // Update the embed
  const embed = new EmbedBuilder()
    .setTitle(`📺 ${selectedNetwork} Channels`)
    .setDescription(`Select a channel to start streaming. Showing ${Math.min(25, sortedChannels.length)} of ${sortedChannels.length} channels.`)
    .setColor(0xe5a00d);
  
  if (sortedChannels.length > 25) {
    embed.setFooter({ text: 'Only showing first 25 channels. Use /channel <number> for others.' });
  }
  
  await interaction.update({ 
    embeds: [embed],
    components: [row]
  });
}

async function showEpisodeSelector(
  interaction: StringSelectMenuInteraction,
  show: MediaItem
): Promise<void> {
  const seasons = await plexClient.getSeasons(show.ratingKey);

  if (!seasons || seasons.length === 0) {
    await interaction.editReply('❌ No seasons found');
    return;
  }

  // Show seasons selector
  const embed = new EmbedBuilder()
    .setTitle(`📺 ${show.title}`)
    .setDescription('Select a season to view episodes')
    .setColor(0xe5a00d);

  const seasonOptions = seasons.slice(0, 25).map(season => ({
    label: `Season ${season.index || 1}`,
    description: season.childCount ? `${season.childCount} episodes` : 'Unknown episodes',
    value: `${season.ratingKey}_${season.index || 1}`,
  }));

  const seasonSelect = new StringSelectMenuBuilder()
    .setCustomId(`season_select_${show.ratingKey}`)
    .setPlaceholder('Select a season...')
    .addOptions(seasonOptions);

  const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(seasonSelect);

  await interaction.editReply({ embeds: [embed], components: [row] });
}

async function showEpisodesForSeason(
  interaction: StringSelectMenuInteraction,
  show: MediaItem,
  seasonRatingKey: string,
  seasonIndex: number
): Promise<void> {
  // Get all episodes for the show, then filter by season
  const allEpisodes = await plexClient.getEpisodes(show.ratingKey);
  const episodes = allEpisodes.filter(ep => (ep.parentIndex || 0) === seasonIndex);

  if (!episodes || episodes.length === 0) {
    await interaction.editReply('❌ No episodes found for this season');
    return;
  }

  const embed = new EmbedBuilder()
    .setTitle(`📺 ${show.title}`)
    .setDescription(`Select an episode to play\n\n**Season ${seasonIndex}**`)
    .setColor(0xe5a00d);

  const episodeOptions = episodes.slice(0, 25).map(ep => ({
    label: `E${String(ep.index).padStart(2, '0')}: ${ep.title}`.substring(0, 100),
    description: ep.duration ? formatPlexDuration(ep.duration) : undefined,
    value: `${seasonIndex}_${ep.index}`,
  }));

  const episodeSelect = new StringSelectMenuBuilder()
    .setCustomId(`episode_select_${show.ratingKey}`)
    .setPlaceholder('Select an episode...')
    .addOptions(episodeOptions);

  const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(episodeSelect);

  await interaction.editReply({ embeds: [embed], components: [row] });
}

function createProgressBar(percent: number): string {
  const filled = Math.round(percent / 5);
  const empty = 20 - filled;
  return '▓'.repeat(filled) + '░'.repeat(empty);
}

async function handleChannels(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply();

  const channels = await plexClient.getLiveTVChannels();

  if (channels.length === 0) {
    await interaction.editReply('❌ No Live TV channels found. Make sure you have DVR/Live TV configured in Plex.');
    return;
  }

  // Group channels by network (grandparentTitle)
  const networks = new Map<string, typeof channels>();
  channels.forEach(channel => {
    const network = channel.grandparentTitle || 'Unknown Network';
    if (!networks.has(network)) {
      networks.set(network, []);
    }
    networks.get(network)!.push(channel);
  });

  // Create network selection dropdown
  const networkSelect = new StringSelectMenuBuilder()
    .setCustomId('select_network')
    .setPlaceholder('Select a network...')
    .addOptions(
      Array.from(networks.keys()).map(network => ({
        label: network,
        description: `${networks.get(network)!.length} channels`,
        value: network,
      }))
    );

  const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(networkSelect);

  // Create embed
  const embed = new EmbedBuilder()
    .setTitle('📺 Live TV Channels')
    .setDescription(`Select a network to view its channels. Found ${networks.size} networks with ${channels.length} total channels.`)
    .setColor(0xe5a00d)
    .addFields(
      { name: 'Available Networks', value: Array.from(networks.entries()).map(([name, chans]) => `• **${name}**: ${chans.length} channels`).join('\n') }
    );

  await interaction.editReply({ 
    embeds: [embed],
    components: [row]
  });
}

async function handleModalSubmit(interaction: ModalSubmitInteraction): Promise<void> {
  const videoStreamer = getVideoStreamer();
  const guildId = interaction.guildId;
  
  if (!guildId) {
    await interaction.reply({ content: '❌ This command can only be used in a server', ephemeral: true });
    return;
  }

  const session = videoStreamer.getSession(guildId);
  if (!session) {
    await interaction.reply({ content: '❌ Nothing is playing', ephemeral: true });
    return;
  }

  if (interaction.customId === 'seek_forward_modal') {
    const seekTimeStr = interaction.fields.getTextInputValue('seek_time');
    const seekSeconds = parseInt(seekTimeStr, 10);
    
    if (isNaN(seekSeconds) || seekSeconds < 1 || seekSeconds > 9999) {
      await interaction.reply({ content: '❌ Please enter a valid number of seconds (1-9999)', ephemeral: true });
      return;
    }

    const currentTime = videoStreamer.getCurrentTime(guildId);
    const newTime = Math.min(currentTime + (seekSeconds * 1000), session.duration);
    
    try {
      await videoStreamer.seekStream(guildId, newTime);
      await interaction.reply({ 
        content: `⏩ Skipped forward ${seekSeconds}s → ${formatDuration(newTime)}`, 
        ephemeral: true 
      });
    } catch (err: any) {
      if (err.message && err.message.includes('400 Bad Request')) {
        await interaction.reply({ content: '❌ Seek failed - wait a moment and try again', ephemeral: true });
      } else {
        await interaction.reply({ content: `❌ Seek error: ${err.message}`, ephemeral: true });
      }
    }
  } else if (interaction.customId === 'seek_backward_modal') {
    const seekTimeStr = interaction.fields.getTextInputValue('seek_time');
    const seekSeconds = parseInt(seekTimeStr, 10);
    
    if (isNaN(seekSeconds) || seekSeconds < 1 || seekSeconds > 9999) {
      await interaction.reply({ content: '❌ Please enter a valid number of seconds (1-9999)', ephemeral: true });
      return;
    }

    const currentTime = videoStreamer.getCurrentTime(guildId);
    const newTime = Math.max(currentTime - (seekSeconds * 1000), 0);
    
    try {
      await videoStreamer.seekStream(guildId, newTime);
      await interaction.reply({ 
        content: `⏪ Skipped backward ${seekSeconds}s → ${formatDuration(newTime)}`, 
        ephemeral: true 
      });
    } catch (err: any) {
      if (err.message && err.message.includes('400 Bad Request')) {
        await interaction.reply({ content: '❌ Seek failed - wait a moment and try again', ephemeral: true });
      } else {
        await interaction.reply({ content: `❌ Seek error: ${err.message}`, ephemeral: true });
      }
    }
  }
}

async function handleChannel(interaction: ChatInputCommandInteraction): Promise<void> {
  const channelNumber = interaction.options.getInteger('number', true);
  
  await interaction.deferReply();

  // Get all channels and find the one with matching channel number
  const channels = await plexClient.getLiveTVChannels();
  const channel = channels.find(ch => ch.index === channelNumber);

  if (!channel) {
    await interaction.editReply(`❌ Channel ${channelNumber} not found`);
    return;
  }

  // Get user's voice channel
  const member = interaction.member;
  if (!member || !('voice' in member) || !member.voice.channel) {
    await interaction.editReply('❌ You must be in a voice channel to play Live TV');
    return;
  }

  const voiceChannel = member.voice.channel;
  const guildId = interaction.guildId;

  if (!guildId) {
    await interaction.editReply('❌ Could not determine guild');
    return;
  }

  // Get stream URL for the channel
  const streamInfo = await plexClient.getChannelStreamUrl(channel.ratingKey);
  if (!streamInfo) {
    await interaction.editReply('❌ Failed to get stream URL for this channel');
    return;
  }

  // Start streaming the channel
  const streamer = getVideoStreamer();
  try {
    await streamer.startStream(
      guildId,
      voiceChannel.id,
      channel,
      streamInfo.url,
      0,
      interaction.user.id
    );

    await interaction.editReply(`📺 Now playing: **${channel.title}** (Channel ${channelNumber})`);
  } catch (error) {
    console.error('[Controller] Error starting Live TV channel:', error);
    await interaction.editReply('❌ Failed to start Live TV stream');
  }
}

async function handleQueue(interaction: ChatInputCommandInteraction): Promise<void> {
  const subcommand = interaction.options.getSubcommand();
  
  await interaction.deferReply();

  switch (subcommand) {
    case 'add': {
      const number = interaction.options.getInteger('number', true);
      const session = searchSessions.get(interaction.user.id);
      
      if (!session || Date.now() - session.timestamp > SESSION_TIMEOUT) {
        await interaction.editReply('❌ No active search session. Use `/search` first');
        return;
      }

      const mediaItem = session.results[number - 1];
      if (!mediaItem) {
        await interaction.editReply('❌ Invalid selection');
        return;
      }

      const added = addToQueue(mediaItem, interaction.user.id);
      if (!added) {
        await interaction.editReply('❌ Item already in queue');
        return;
      }

      await interaction.editReply(`✅ Added to queue: **${mediaItem.title}**`);
      break;
    }

    case 'list': {
      const queue = getQueue();
      if (queue.length === 0) {
        await interaction.editReply('📋 Queue is empty');
        return;
      }

      const lines = queue.map((entry, i) => formatQueueEntry(entry, i));
      await interaction.editReply(`📋 **Queue** (${queue.length} items)\n\n${lines.join('\n')}`);
      break;
    }

    case 'remove': {
      const number = interaction.options.getInteger('number', true);
      const removed = removeFromQueue(number);
      
      if (!removed) {
        await interaction.editReply('❌ Invalid queue position');
        return;
      }

      await interaction.editReply(`🗑️ Removed from queue: **${removed.title}**`);
      break;
    }

    case 'clear': {
      clearQueue();
      await interaction.editReply('🗑️ Queue cleared');
      break;
    }

    case 'start': {
      const queue = getQueue();
      if (queue.length === 0) {
        await interaction.editReply('❌ Queue is empty');
        return;
      }

      // Get user's voice channel
      const member = interaction.member;
      if (!member || !('voice' in member) || !member.voice.channel) {
        await interaction.editReply('❌ You must be in a voice channel');
        return;
      }

      const voiceChannel = member.voice.channel;
      const guildId = interaction.guildId;

      if (!guildId) {
        await interaction.editReply('❌ Could not determine guild');
        return;
      }

      // Get first item from queue but don't remove it yet (peek)
      const first = peekQueue();
      if (!first) {
        await interaction.editReply('❌ Queue is empty');
        return;
      }

      // Convert queue entry back to MediaItem
      let mediaItem: MediaItem;
      
      if (first.type === 'youtube') {
        mediaItem = {
          ratingKey: first.ratingKey,
          key: first.url || first.ratingKey,
          type: 'youtube',
          title: first.title,
          duration: first.duration || 0,
          thumb: undefined,
          uploader: first.uploader,
          viewCount: first.viewCount,
          uploadDate: first.uploadDate,
          url: first.url || '',
          filePath: first.filePath
        };
      } else if (first.type === 'external') {
        mediaItem = {
          ratingKey: first.ratingKey,
          key: first.url || first.ratingKey,
          type: 'external',
          title: first.title,
          duration: first.duration || 0,
          url: first.url || '',
          streamType: first.streamType
        };
      } else {
        // Plex media item
        mediaItem = {
          ratingKey: first.ratingKey,
          key: first.ratingKey,
          type: first.type as any, // movie, show, episode, channel
          title: first.title,
          duration: first.duration || 0
        };
      }

      // Handle different media types
      try {
        const videoStreamer = getVideoStreamer();
        
        if (first.type === 'youtube') {
          const ytItem = mediaItem as any;
          
          // Check if there's a downloaded file available
          if (!ytItem.filePath && ytItem.url) {
            // Try to find downloaded file for this YouTube video
            const { getVideoMetadata, downloadYouTubeVideo } = await import('../youtube/downloader.js');
            const { readdirSync, statSync } = await import('fs');
            const { join } = await import('path');
            
            const downloadsDir = join(process.cwd(), 'downloads');
            try {
              const files = readdirSync(downloadsDir);
              const videoFiles = files.filter(file => 
                file.endsWith('.mp4') || file.endsWith('.webm') || file.endsWith('.mkv') || file.endsWith('.avi')
              );
              
              // Look for a video file that might match this YouTube video
              for (const file of videoFiles) {
                const filePath = join(downloadsDir, file);
                const metadata = getVideoMetadata(filePath);
                
                // Check if this metadata matches our YouTube video
                if (metadata && metadata.url === ytItem.url) {
                  ytItem.filePath = filePath;
                  console.log(`[Controller] Found downloaded file for YouTube video: ${file}`);
                  break;
                }
              }
              
              // If no downloaded file found, download it now
              if (!ytItem.filePath) {
                await interaction.editReply('📥 Downloading YouTube video from queue...');
                
                // Create initial download embed
                const downloadEmbed = new EmbedBuilder()
                  .setTitle('📥 Downloading YouTube Video')
                  .setDescription(`**${first.title}**`)
                  .setColor(0x0099ff)
                  .addFields(
                    { name: 'Progress', value: '⏳ 0% - Starting download...' }
                  );

                const progressMessage = await interaction.followUp({ embeds: [downloadEmbed] });
                
                // Rate limiting for progress updates
                let lastUpdateTime = 0;
                const UPDATE_COOLDOWN = 2000; // Update at most every 2 seconds
                
                const downloadedVideo = await downloadYouTubeVideo(ytItem.url, {
                  onProgress: (progress) => {
                    const now = Date.now();
                    
                    // Rate limit updates to prevent Discord API issues
                    if (now - lastUpdateTime < UPDATE_COOLDOWN) {
                      return;
                    }
                    
                    lastUpdateTime = now;
                    
                    // Update progress embed
                    const progressBar = '█'.repeat(Math.floor(progress.percent / 5)) + '░'.repeat(20 - Math.floor(progress.percent / 5));
                    const updatedEmbed = new EmbedBuilder()
                      .setTitle('📥 Downloading YouTube Video')
                      .setDescription(`**${first.title}**`)
                      .setColor(0x0099ff)
                      .addFields(
                        { name: 'Progress', value: `${progressBar} ${progress.percent.toFixed(1)}% - ${progress.speed}` },
                        { name: 'ETA', value: progress.eta || 'Calculating...' }
                      );

                    // Update the progress message
                    progressMessage.edit({ embeds: [updatedEmbed] }).catch(err => {
                      // Ignore rate limit errors
                      if (!err.toString().includes('rate')) {
                        console.error('[Controller] Failed to update download progress:', err);
                      }
                    });
                  },
                  onComplete: async () => {
                    console.log('[Controller] Download complete, calculating SponsorBlock segments...');
                    // Update to SponsorBlock calculation message
                    const sponsorBlockEmbed = new EmbedBuilder()
                      .setTitle('🔍 Calculating SponsorBlock Segments')
                      .setDescription(`**${first.title}**`)
                      .setColor(0xffaa00)
                      .addFields(
                        { name: 'Status', value: '⏳ Identifying sponsor segments to skip...' }
                      );

                    await progressMessage.edit({ embeds: [sponsorBlockEmbed] });
                    
                    // Fetch SponsorBlock segments
                    try {
                      const { fetchSponsorSegments, formatSponsorBlockEmbed } = await import('../youtube/sponsorblock.js');
                      const sponsorResult = await fetchSponsorSegments(ytItem.url);
                      
                      // Update with final completion message including SponsorBlock results
                      const completeEmbed = new EmbedBuilder()
                        .setTitle('✅ Download Complete')
                        .setDescription(`**${first.title}**`)
                        .setColor(0x00ff00)
                        .addFields(
                          { name: 'Status', value: '🎬 Ready to play!' },
                          { name: 'SponsorBlock', value: formatSponsorBlockEmbed(sponsorResult || { videoId: '', segments: [], totalSkipTime: 0, categories: [] }) }
                        );

                      await progressMessage.edit({ embeds: [completeEmbed] });
                    } catch (sbError) {
                      console.error('[Controller] SponsorBlock calculation failed:', sbError);
                      
                      // Update with completion message even if SponsorBlock fails
                      const completeEmbed = new EmbedBuilder()
                        .setTitle('✅ Download Complete')
                        .setDescription(`**${first.title}**`)
                        .setColor(0x00ff00)
                        .addFields(
                          { name: 'Status', value: '🎬 Ready to play!' },
                          { name: 'SponsorBlock', value: '❌ Failed to calculate segments' }
                        );

                      await progressMessage.edit({ embeds: [completeEmbed] });
                    }
                  },
                  onError: (error) => {
                    console.error('[Controller] Download error:', error);
                    const errorEmbed = new EmbedBuilder()
                      .setTitle('❌ Download Failed')
                      .setDescription(`**${first.title}**`)
                      .setColor(0xff0000)
                      .addFields(
                        { name: 'Error', value: error }
                      );

                    progressMessage.edit({ embeds: [errorEmbed] }).catch(err => {
                      console.error('[Controller] Failed to update error message:', err);
                    });
                  }
                });
                
                if (downloadedVideo) {
                  ytItem.filePath = downloadedVideo.filePath;
                  await interaction.editReply(`✅ Downloaded: **${downloadedVideo.title}**`);
                }
              }
            } catch (error) {
              console.error('[Controller] Error checking/downloading YouTube file:', error);
            }
          }
          
          if (ytItem.filePath) {
            // Play downloaded YouTube video
            await videoStreamer.startLocalFile(
              guildId,
              voiceChannel.id,
              mediaItem,
              ytItem.filePath,
              interaction.user.id
            );
          } else if (ytItem.url) {
            // Stream YouTube video directly (fallback)
            await videoStreamer.startExternalStream(
              guildId,
              voiceChannel.id,
              mediaItem,
              ytItem.url,
              interaction.user.id
            );
          } else {
            await interaction.editReply('❌ No URL available for YouTube video');
            return;
          }
        } else if (first.type === 'external') {
          const extItem = mediaItem as any;
          if (!extItem.url) {
            await interaction.editReply('❌ No URL available for external stream');
            return;
          }
          await videoStreamer.startExternalStream(
            guildId,
            voiceChannel.id,
            mediaItem,
            extItem.url,
            interaction.user.id
          );
        } else {
          // Plex media item
          const streamInfo = await plexClient.getStreamUrl(first.ratingKey);
          if (!streamInfo) {
            await interaction.editReply('❌ Failed to get stream URL');
            return;
          }

          await videoStreamer.startStream(
            guildId,
            voiceChannel.id,
            mediaItem,
            streamInfo,
            0,
            interaction.user.id
          );
        }

        // Remove from queue after successfully starting
        popQueue();
        await interaction.editReply(`▶️ Now playing from queue: **${first.title}**`);
      } catch (error) {
        console.error('[Controller] Error starting queue playback:', error);
        await interaction.editReply('❌ Failed to start playback');
      }
      break;
    }

    case 'next': {
      const next = popQueue();
      if (!next) {
        await interaction.editReply('❌ Queue is empty');
        return;
      }

      // Get user's voice channel
      const member = interaction.member;
      if (!member || !('voice' in member) || !member.voice.channel) {
        await interaction.editReply('❌ You must be in a voice channel');
        return;
      }

      const voiceChannel = member.voice.channel;
      const guildId = interaction.guildId;

      if (!guildId) {
        await interaction.editReply('❌ Could not determine guild');
        return;
      }

      // Get full media item and stream URL
      const mediaItem = await plexClient.getMetadata(next.ratingKey);
      if (!mediaItem) {
        await interaction.editReply('❌ Could not find media item');
        return;
      }

      const streamInfo = await plexClient.getDirectStreamUrl(next.ratingKey);
      if (!streamInfo) {
        await interaction.editReply('❌ Could not get stream URL');
        return;
      }

      // Check for saved position
      const savedPosition = getPlaybackPosition(next.ratingKey);
      const startPosition = (savedPosition && savedPosition > 30000) ? savedPosition : 0;

      // Start streaming
      const streamer = getVideoStreamer();
      try {
        await streamer.startStream(
          guildId,
          voiceChannel.id,
          mediaItem,
          streamInfo.url,
          startPosition,
          interaction.user.id
        );

        await interaction.editReply(`▶️ Now playing from queue: **${next.title}**`);
      } catch (error) {
        console.error('[Controller] Error playing from queue:', error);
        await interaction.editReply('❌ Failed to start playback');
      }
      break;
    }
  }
}

async function handleOnDeck(interaction: ChatInputCommandInteraction): Promise<void> {
  const number = interaction.options.getInteger('number');
  
  await interaction.deferReply();

  const deck = getWatchDeck();
  
  if (deck.length === 0) {
    await interaction.editReply('📺 Watch deck is empty');
    return;
  }

  // If number is provided, resume that item
  if (number !== null) {
    const entry = deck[number - 1];
    if (!entry) {
      await interaction.editReply('❌ Invalid selection');
      return;
    }

    // Get user's voice channel
    const member = interaction.member;
    if (!member || !('voice' in member) || !member.voice.channel) {
      await interaction.editReply('❌ You must be in a voice channel');
      return;
    }

    const voiceChannel = member.voice.channel;
    const guildId = interaction.guildId;

    if (!guildId) {
      await interaction.editReply('❌ Could not determine guild');
      return;
    }

    // Get full media item and stream URL
    const mediaItem = await plexClient.getMetadata(entry.ratingKey);
    if (!mediaItem) {
      await interaction.editReply('❌ Could not find media item');
      return;
    }

    const streamInfo = await plexClient.getDirectStreamUrl(entry.ratingKey);
    if (!streamInfo) {
      await interaction.editReply('❌ Could not get stream URL');
      return;
    }

    // Check for saved position
    const savedPosition = getPlaybackPosition(entry.ratingKey);
    let startPosition = 0;

    if (savedPosition && savedPosition > 30000) {
      const minutes = Math.floor(savedPosition / 60000);
      const seconds = Math.floor((savedPosition % 60000) / 1000);
      await interaction.editReply(`🔄 Resume from ${minutes}:${seconds.toString().padStart(2, '0')}? React with ✅ to resume or ❌ to start from beginning`);
      
      const message = await interaction.fetchReply();
      await message.react('✅');
      await message.react('❌');

      try {
        const filter = (reaction: any, user: any) => {
          return ['✅', '❌'].includes(reaction.emoji.name) && user.id === interaction.user.id;
        };

        const collected = await message.awaitReactions({ filter, max: 1, time: 15000 });
        const reaction = collected.first();

        if (reaction?.emoji.name === '✅') {
          startPosition = savedPosition;
        }
      } catch {
        // Timeout, start from beginning
      }
    }

    // Start streaming
    const streamer = getVideoStreamer();
    try {
      await streamer.startStream(
        guildId,
        voiceChannel.id,
        mediaItem,
        streamInfo.url,
        startPosition,
        interaction.user.id
      );

      await interaction.editReply(`▶️ Now playing: **${entry.title}**`);
    } catch (error) {
      console.error('[Controller] Error playing from watch deck:', error);
      await interaction.editReply('❌ Failed to start playback');
    }
  } else {
    // Just show the watch deck
    const lines = deck.map((entry, i) => formatDeckEntry(entry, i));
    await interaction.editReply(`📺 **On Deck** (Recently Watched)\n\n${lines.join('\n')}\n\nUse \`/ondeck <number>\` to resume watching`);
  }
}

async function handleClear(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: false });

  try {
    const channel = interaction.channel;
    if (!channel) {
      await interaction.editReply('❌ This command can only be used in a channel');
      return;
    }

    // Fetch messages in the channel
    const messages = await channel.messages.fetch({ limit: 100 });
    
    // Get the interaction message ID to avoid deleting it
    const interactionMessageId = interaction.replied ? 
      (await interaction.fetchReply()).id : null;
    
    // Filter messages from the self bot and controller bot
    const botMessages = messages.filter(msg => 
      msg.author.bot && 
      msg.id !== interactionMessageId && // Don't delete the interaction's own message
      (
        msg.author.username === 'SchroStream' || // Controller bot
        msg.author.username === 'bob_psyketek' || // Self bot
        msg.author.id === '1348700495342207066' || // Self bot user ID
        msg.author.id === '1451453212681834536' || // Controller bot app ID
        msg.content.includes('📺') || 
        msg.content.includes('⏸️') ||
        msg.content.includes('⏹️') ||
        msg.content.includes('⏪') ||
        msg.content.includes('⏩') ||
        msg.content.includes('📥') ||
        msg.embeds.some(embed => 
          embed.title?.includes('Now Playing') ||
          embed.title?.includes('Starting') ||
          embed.title?.includes('Download')
        )
      )
    );

    if (botMessages.size === 0) {
      await interaction.editReply('✅ No bot messages found to clear');
      return;
    }

    // Delete the bot messages (bulk delete for efficiency)
    try {
      if (botMessages.size > 0) {
        // Convert Collection to Array for bulkDelete
        const messagesToDelete = Array.from(botMessages.values());
        
        // Discord allows bulk deleting up to 100 messages at once
        if (messagesToDelete.length <= 100) {
          await (channel as any).bulkDelete(messagesToDelete);
        } else {
          // If somehow more than 100, delete in batches
          for (let i = 0; i < messagesToDelete.length; i += 100) {
            const batch = messagesToDelete.slice(i, i + 100);
            await (channel as any).bulkDelete(batch);
          }
        }
      }

      await interaction.editReply(`✅ Cleared ${botMessages.size} bot messages`);
    } catch (error) {
      console.error('[Controller] Error clearing messages:', error);
      await interaction.editReply('❌ Failed to clear some messages. I may not have permission to delete messages older than 14 days.');
    }

  } catch (error) {
    console.error('[Controller] Error in handleClear:', error);
    await interaction.editReply('❌ An error occurred while clearing messages');
  }
}

async function handleDownloads(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply();

  try {
    const { readdirSync, statSync } = await import('fs');
    const { join } = await import('path');
    
    const downloadsDir = join(process.cwd(), 'downloads');
    
    // Check if downloads directory exists
    try {
      readdirSync(downloadsDir);
    } catch {
      await interaction.editReply('📁 No downloads directory found');
      return;
    }

    // Get all video files in downloads directory
    const files = readdirSync(downloadsDir);
    const videoFiles = files.filter(file => 
      file.endsWith('.mp4') || 
      file.endsWith('.webm') || 
      file.endsWith('.mkv') || 
      file.endsWith('.avi')
    );

    if (videoFiles.length === 0) {
      await interaction.editReply('📁 No downloaded videos found');
      return;
    }

    // Import metadata functions
    const { getVideoMetadata } = await import('../youtube/downloader.js');

    // Get file info for each video with metadata
    const videoInfo = videoFiles.map(file => {
      const filePath = join(downloadsDir, file);
      const stats = statSync(filePath);
      const sizeInMB = (stats.size / (1024 * 1024)).toFixed(1);
      const modifiedDate = new Date(stats.mtime).toLocaleDateString();
      
      // Extract timestamp from filename (video-1234567890.mp4)
      const timestampMatch = file.match(/video-(\d+)\./);
      const timestamp = timestampMatch ? parseInt(timestampMatch[1]) : 0;
      
      // Get metadata if available
      const metadata = getVideoMetadata(filePath);
      
      return {
        file,
        filePath,
        size: `${sizeInMB} MB`,
        modified: modifiedDate,
        timestamp,
        metadata
      };
    }).sort((a, b) => b.timestamp - a.timestamp); // Sort by newest first

    // Create embed with video list and metadata
    const embed = new EmbedBuilder()
      .setTitle('📥 Downloaded Videos')
      .setDescription(`Found ${videoInfo.length} downloaded video(s)`)
      .setColor(0x00ff00)
      .addFields(
        videoInfo.map((video, index) => {
          const metadata = video.metadata;
          const title = metadata?.title || video.file.replace(/video-\d+\./, '').replace(/\.[^.]+$/, '') || 'Unknown';
          const channel = metadata?.uploader || 'Unknown Channel';
          const views = metadata?.viewCount ? `👁 ${metadata.viewCount}` : '';
          const date = metadata?.uploadDate ? `📅 ${metadata.uploadDate}` : '';
          const description = metadata?.description ? metadata.description.substring(0, 50) + (metadata.description.length > 50 ? '...' : '') : '';
          
          const fieldValue = [
            `📁 Size: ${video.size} | 📅 ${video.modified}`,
            channel && views ? `${channel} | ${views}` : channel,
            date,
            description ? `\n📝 ${description}` : '',
            `\`/play-download ${index + 1}\` to play | \`/delete-download ${index + 1}\` to delete`
          ].filter(Boolean).join('\n');
          
          return {
            name: `${index + 1}. ${title}`,
            value: fieldValue,
            inline: false
          };
        })
      )
      .setFooter({ text: 'Use /play-download <number> to play or /delete-download <number> to delete' });

    await interaction.editReply({ embeds: [embed] });

  } catch (error) {
    console.error('[Controller] Error in handleDownloads:', error);
    await interaction.editReply('❌ Failed to list downloads');
  }
}

async function handlePlayDownload(interaction: ChatInputCommandInteraction): Promise<void> {
  const videoNumber = interaction.options.getInteger('number', true);
  await interaction.deferReply();

  try {
    const { readdirSync, statSync } = await import('fs');
    const { join } = await import('path');
    
    const downloadsDir = join(process.cwd(), 'downloads');
    
    // Get all video files
    const files = readdirSync(downloadsDir);
    const videoFiles = files.filter(file => 
      file.endsWith('.mp4') || 
      file.endsWith('.webm') || 
      file.endsWith('.mkv') || 
      file.endsWith('.avi')
    ).sort((a, b) => {
      // Sort by timestamp (newest first)
      const aTimestamp = a.match(/video-(\d+)\./);
      const bTimestamp = b.match(/video-(\d+)\./);
      const aTime = aTimestamp ? parseInt(aTimestamp[1]) : 0;
      const bTime = bTimestamp ? parseInt(bTimestamp[1]) : 0;
      return bTime - aTime;
    });

    // Check if video number is valid
    if (videoNumber < 1 || videoNumber > videoFiles.length) {
      await interaction.editReply(`❌ Invalid video number. Please use a number between 1 and ${videoFiles.length}`);
      return;
    }

    const selectedFile = videoFiles[videoNumber - 1];
    const filePath = join(downloadsDir, selectedFile);
    const stats = statSync(filePath);
    const sizeInMB = (stats.size / (1024 * 1024)).toFixed(1);

    // Check if user is in voice channel
    const guildId = interaction.guildId;
    if (!guildId) {
      await interaction.editReply('❌ This command can only be used in a server');
      return;
    }

    const guild = selfbotClient.guilds.cache.get(guildId);
    const member = guild?.members.cache.get(interaction.user.id);
    const voiceChannel = member?.voice?.channel;

    if (!voiceChannel) {
      await interaction.editReply('❌ You must be in a voice channel to play a video');
      return;
    }

    // Get video info from metadata
    const { getVideoMetadata } = await import('../youtube/downloader.js');
    const metadata = getVideoMetadata(filePath);
    const videoStreamer = getVideoStreamer();
    
    const mediaItem = {
      ratingKey: `download-${Date.now()}`,
      key: filePath,
      title: metadata?.title || selectedFile.replace(/video-\d+\./, '').replace(/\.[^.]+$/, '') || 'Downloaded Video',
      type: 'movie' as const,
      duration: metadata?.duration || 0,
      thumb: metadata?.thumbnail,
    };

    const embed = new EmbedBuilder()
      .setTitle('📺 Starting Downloaded Video')
      .setDescription(`**${mediaItem.title}**`)
      .addFields(
        { name: 'Channel', value: metadata?.uploader || 'Unknown', inline: true },
        { name: 'Duration', value: metadata?.duration ? formatPlexDuration(metadata.duration) : 'Unknown', inline: true },
        { name: 'Views', value: metadata?.viewCount || 'Unknown', inline: true },
        { name: 'Source', value: '📥 Local file', inline: true }
      )
      .setColor(0x00ff00)
      .setThumbnail(metadata?.thumbnail || null);

    const controlRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId('ctrl_pause').setEmoji('⏸️').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('ctrl_stop').setEmoji('⏹️').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('ctrl_rw').setEmoji('⏪').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('ctrl_ff').setEmoji('⏩').setStyle(ButtonStyle.Secondary),
    );
    const speedRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId('ctrl_speed_down').setLabel('🐢').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('ctrl_speed').setLabel('1x').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('ctrl_speed_up').setLabel('🐇').setStyle(ButtonStyle.Secondary),
    );

    await interaction.editReply({ embeds: [embed], components: [controlRow, speedRow] });

    // Start streaming the downloaded file
    videoStreamer.startLocalFile(
      guildId,
      voiceChannel.id,
      mediaItem,
      filePath,
      interaction.user.id
    ).catch(err => console.error('[Controller] Download play error:', err));

  } catch (error) {
    console.error('[Controller] Error in handlePlayDownload:', error);
    await interaction.editReply('❌ Failed to play downloaded video');
  }
}

async function handleDeleteDownload(interaction: ChatInputCommandInteraction): Promise<void> {
  const videoNumber = interaction.options.getInteger('number', true);
  await interaction.deferReply();

  try {
    const { readdirSync, statSync, unlinkSync } = await import('fs');
    const { join } = await import('path');
    
    const downloadsDir = join(process.cwd(), 'downloads');
    
    // Get all video files
    const files = readdirSync(downloadsDir);
    const videoFiles = files.filter(file => 
      file.endsWith('.mp4') || 
      file.endsWith('.webm') || 
      file.endsWith('.mkv') || 
      file.endsWith('.avi')
    ).sort((a, b) => {
      // Sort by timestamp (newest first)
      const aTimestamp = a.match(/video-(\d+)\./);
      const bTimestamp = b.match(/video-(\d+)\./);
      const aTime = aTimestamp ? parseInt(aTimestamp[1]) : 0;
      const bTime = bTimestamp ? parseInt(bTimestamp[1]) : 0;
      return bTime - aTime;
    });

    // Check if video number is valid
    if (videoNumber < 1 || videoNumber > videoFiles.length) {
      await interaction.editReply(`❌ Invalid video number. Please use a number between 1 and ${videoFiles.length}`);
      return;
    }

    const selectedFile = videoFiles[videoNumber - 1];
    const filePath = join(downloadsDir, selectedFile);
    const stats = statSync(filePath);
    const sizeInMB = (stats.size / (1024 * 1024)).toFixed(1);

    // Delete the file and metadata
    unlinkSync(filePath);
    
    // Also delete the metadata file if it exists
    const metadataPath = filePath.replace(/\.(mp4|webm|mkv|avi)$/, '.json');
    try {
      const { existsSync, unlinkSync: fsUnlinkSync } = await import('fs');
      if (existsSync(metadataPath)) {
        fsUnlinkSync(metadataPath);
        console.log(`[Controller] Deleted metadata file: ${metadataPath.replace(/^.*[\/\\]/, '')}`);
      }
    } catch (metaError) {
      console.error('[Controller] Failed to delete metadata file:', metaError);
    }
    
    const embed = new EmbedBuilder()
      .setTitle('🗑️ Video Deleted')
      .setDescription(`Successfully deleted **${selectedFile}**`)
      .addFields(
        { name: 'Size Freed', value: `${sizeInMB} MB`, inline: true },
        { name: 'File', value: selectedFile, inline: true }
      )
      .setColor(0xff0000);

    await interaction.editReply({ embeds: [embed] });

  } catch (error) {
    console.error('[Controller] Error in handleDeleteDownload:', error);
    await interaction.editReply('❌ Failed to delete downloaded video');
  }
}

async function handleDeleteAllDownloads(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply();

  try {
    const { readdirSync, statSync, unlinkSync } = await import('fs');
    const { join } = await import('path');
    
    const downloadsDir = join(process.cwd(), 'downloads');
    
    // Check if downloads directory exists
    try {
      readdirSync(downloadsDir);
    } catch {
      await interaction.editReply('📁 No downloads directory found');
      return;
    }

    // Get all video files
    const files = readdirSync(downloadsDir);
    const videoFiles = files.filter(file => 
      file.endsWith('.mp4') || 
      file.endsWith('.webm') || 
      file.endsWith('.mkv') || 
      file.endsWith('.avi')
    );

    if (videoFiles.length === 0) {
      await interaction.editReply('📁 No downloaded videos found');
      return;
    }

    let totalSize = 0;
    let deletedCount = 0;
    let errorCount = 0;
    const errors: string[] = [];

    // Delete each video file and its metadata
    for (const file of videoFiles) {
      try {
        const filePath = join(downloadsDir, file);
        const stats = statSync(filePath);
        totalSize += stats.size;
        
        // Delete the video file
        unlinkSync(filePath);
        deletedCount++;
        
        // Also delete the metadata file if it exists
        const metadataPath = filePath.replace(/\.(mp4|webm|mkv|avi)$/, '.json');
        try {
          const { existsSync, unlinkSync: fsUnlinkSync } = await import('fs');
          if (existsSync(metadataPath)) {
            fsUnlinkSync(metadataPath);
          }
        } catch (metaError) {
          // Don't count metadata errors as critical
          console.error('[Controller] Failed to delete metadata file:', metaError);
        }
      } catch (error) {
        errorCount++;
        errors.push(file);
        console.error(`[Controller] Failed to delete ${file}:`, error);
      }
    }

    const totalSizeMB = (totalSize / (1024 * 1024)).toFixed(1);
    
    const embed = new EmbedBuilder()
      .setTitle('🗑️ All Downloads Deleted')
      .setDescription(`Successfully deleted **${deletedCount}** video file(s)`)
      .addFields(
        { name: 'Total Space Freed', value: `${totalSizeMB} MB`, inline: true },
        { name: 'Files Deleted', value: `${deletedCount}`, inline: true }
      )
      .setColor(0xff0000);

    if (errorCount > 0) {
      embed.addFields(
        { name: 'Errors', value: `${errorCount} files failed to delete`, inline: true }
      );
      if (errors.length > 0) {
        embed.addFields(
          { name: 'Failed Files', value: errors.slice(0, 10).join('\n'), inline: false }
        );
      }
    }

    await interaction.editReply({ embeds: [embed] });

  } catch (error) {
    console.error('[Controller] Error in handleDeleteAllDownloads:', error);
    await interaction.editReply('❌ Failed to delete all downloads');
  }
}

async function handleWatched(interaction: ChatInputCommandInteraction): Promise<void> {
  const number = interaction.options.getInteger('number', true);
  
  await interaction.deferReply();

  const deck = getWatchDeck();
  
  if (deck.length === 0) {
    await interaction.editReply('📺 Watch deck is empty');
    return;
  }

  if (number < 1 || number > deck.length) {
    await interaction.editReply('❌ Invalid item number');
    return;
  }

  const entry = deck[number - 1];
  
  // Mark as fully watched
  markVideoAsFullyWatched(entry.ratingKey);
  
  const embed = new EmbedBuilder()
    .setTitle('✅ Marked as Fully Watched')
    .setDescription(`**${entry.title}**`)
    .addFields(
      { name: 'Status', value: '🎬 Video marked as fully watched' },
      { name: 'Cleanup', value: 'Will be automatically cleaned up on next restart or manual cleanup' }
    )
    .setColor(0x00ff00);

  await interaction.editReply({ embeds: [embed] });
}

async function handleCleanup(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply();
  
  try {
    cleanupFullyWatchedVideos();
    
    const embed = new EmbedBuilder()
      .setTitle('🧹 Cleanup Complete')
      .setDescription('All fully watched videos have been cleaned up')
      .addFields(
        { name: 'Files Deleted', value: 'Video files and metadata removed' },
        { name: 'Watch Deck', value: 'Updated to remove watched items' }
      )
      .setColor(0x00ff00);

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error('[Controller] Error in handleCleanup:', error);
    await interaction.editReply('❌ Failed to cleanup watched videos');
  }
}

export function getControllerBot(): Client | null {
  return controllerBot;
}
