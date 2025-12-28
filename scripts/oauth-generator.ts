#!/usr/bin/env tsx

import { config } from '../src/config.js';
import { REST } from 'discord.js';

// OAuth2 scopes for the bot
const OAUTH_SCOPES = [
  'bot',              // Required for bot to appear in members list
  'applications.commands', // Required for slash commands
];

// Bot permissions (8 = Administrator)
const PERMISSIONS = '8';

function generateOAuthUrl(): string {
  const clientId = config.discord.clientId;
  
  if (!clientId) {
    throw new Error('BOT_CLIENT_ID not set in environment');
  }

  const params = new URLSearchParams({
    client_id: clientId,
    permissions: PERMISSIONS,
    scope: OAUTH_SCOPES.join(' '),
  });

  return `https://discord.com/api/oauth2/authorize?${params.toString()}`;
}

async function testBotAccess(): Promise<void> {
  const botToken = config.discord.botToken;
  
  if (!botToken) {
    console.log('❌ BOT_TOKEN not set in environment');
    return;
  }

  const rest = new REST().setToken(botToken);

  try {
    // Test bot authentication
    const user = await rest.get('/users/@me');
    console.log('✅ Bot authentication successful');
    console.log(`   Bot: ${(user as any).username}#${(user as any).discriminator}`);
    console.log(`   ID: ${(user as any).id}`);

    // Test bot guilds
    const guilds = await rest.get('/users/@me/guilds');
    console.log(`✅ Bot is in ${(guilds as any[]).length} guild(s)`);
    
    // Check if bot is in the configured guild
    if (config.discord.allowedGuilds.length > 0) {
      const guildId = config.discord.allowedGuilds[0];
      const isInGuild = (guilds as any[]).some(g => g.id === guildId);
      
      if (isInGuild) {
        console.log(`✅ Bot is in the configured guild (${guildId})`);
      } else {
        console.log(`❌ Bot is NOT in the configured guild (${guildId})`);
        console.log('   Make sure to invite the bot using the URL below');
      }
    }

    // Test bot connections (gateway intents)
    const gateway = await rest.get('/gateway/bot');
    console.log(`✅ Gateway info retrieved`);
    console.log(`   Session limit: ${(gateway as any).session_start_limit.remaining}/${(gateway as any).session_start_limit.total}`);
    
  } catch (error: any) {
    console.error('❌ Bot access test failed');
    if (error.status === 401) {
      console.log('   Invalid bot token');
    } else if (error.status === 403) {
      console.log('   Bot lacks required permissions');
    } else {
      console.log(`   Error: ${error.message}`);
    }
  }
}

function printHelp(): void {
  console.log(`
Usage: bun run scripts/oauth-generator.ts [command]

Commands:
  url      Generate OAuth2 invitation URL
  test     Test bot access and permissions
  all      Generate URL and test access (default)

Environment variables required:
  BOT_CLIENT_ID    Discord bot client ID
  BOT_TOKEN        Discord bot token (for testing)
  ALLOWED_GUILDS   Comma-separated guild IDs (optional)

Example:
  bun run scripts/oauth-generator.ts url
  bun run scripts/oauth-generator.ts test
  bun run scripts/oauth-generator.ts
`);
}

async function waitForConfirmation(): Promise<void> {
  const readline = await import('readline');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    rl.question('\n⏳ Press Enter after you have invited the bot to test access...', () => {
      rl.close();
      resolve();
    });
  });
}

async function main(): Promise<void> {
  const command = process.argv[2] || 'all';

  switch (command) {
    case 'url':
      console.log('🔗 OAuth2 Invitation URL:');
      console.log(generateOAuthUrl());
      console.log('\n💡 Copy this URL and paste it in your browser to invite the bot');
      break;

    case 'test':
      console.log('🔍 Testing bot access...\n');
      await testBotAccess();
      break;

    case 'all':
      console.log('🔗 OAuth2 Invitation URL:');
      console.log(generateOAuthUrl());
      console.log('\n💡 Copy this URL and paste it in your browser to invite the bot');
      
      await waitForConfirmation();
      
      console.log('\n🔍 Testing bot access...\n');
      await testBotAccess();
      break;

    case 'help':
    case '--help':
    case '-h':
      printHelp();
      break;

    default:
      console.log(`❌ Unknown command: ${command}`);
      printHelp();
      process.exit(1);
  }
}

main().catch(error => {
  console.error('❌ Error:', error.message);
  process.exit(1);
});
