import { config } from 'dotenv';
config();

const PLEX_URL = process.env.PLEX_URL?.replace(/\/$/, '') || 'http://localhost:32400';
const PLEX_TOKEN = process.env.PLEX_TOKEN || '';

if (!PLEX_TOKEN) {
  console.error('❌ PLEX_TOKEN not set in .env');
  process.exit(1);
}

async function testEndpoint(name: string, endpoint: string): Promise<any> {
  const url = `${PLEX_URL}${endpoint}${endpoint.includes('?') ? '&' : '?'}X-Plex-Token=${PLEX_TOKEN}`;
  
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Testing: ${name}`);
  console.log(`URL: ${PLEX_URL}${endpoint}`);
  console.log(`${'='.repeat(60)}`);
  
  try {
    const response = await fetch(url, {
      headers: { Accept: 'application/json' }
    });
    
    if (!response.ok) {
      console.log(`❌ HTTP ${response.status}: ${response.statusText}`);
      return null;
    }
    
    const data = await response.json();
    console.log(`✅ Success!`);
    return data;
  } catch (error) {
    console.log(`❌ Error: ${error}`);
    return null;
  }
}

async function main() {
  console.log('🔍 Plex API Endpoint Tester');
  console.log(`Server: ${PLEX_URL}`);
  
  // Test 1: Server info
  const serverInfo = await testEndpoint('Server Info', '/');
  if (serverInfo) {
    console.log(`Server: ${serverInfo.MediaContainer?.friendlyName}`);
  }
  
  // Test 2: Libraries
  const libraries = await testEndpoint('Libraries', '/library/sections');
  if (libraries?.MediaContainer?.Directory) {
    const dirs = Array.isArray(libraries.MediaContainer.Directory) 
      ? libraries.MediaContainer.Directory 
      : [libraries.MediaContainer.Directory];
    
    console.log('\nLibraries found:');
    for (const lib of dirs) {
      console.log(`  - [${lib.key}] ${lib.title} (${lib.type})`);
    }
    
    // Test 3: Search in each library
    const searchQuery = 'breaking bad';
    
    for (const lib of dirs) {
      // Test library contents
      const contents = await testEndpoint(
        `Library ${lib.key} (${lib.title}) - All items`,
        `/library/sections/${lib.key}/all`
      );
      
      if (contents?.MediaContainer?.Metadata) {
        const items = Array.isArray(contents.MediaContainer.Metadata)
          ? contents.MediaContainer.Metadata
          : [contents.MediaContainer.Metadata];
        console.log(`  Found ${items.length} items in library`);
        
        // Show first few items
        for (const item of items.slice(0, 5)) {
          console.log(`    - ${item.title} (${item.type})`);
        }
        if (items.length > 5) {
          console.log(`    ... and ${items.length - 5} more`);
        }
      }
      
      // Test search endpoint for this library
      const search1 = await testEndpoint(
        `Library ${lib.key} - Search (type=1, movies)`,
        `/library/sections/${lib.key}/search?type=1&query=${encodeURIComponent(searchQuery)}`
      );
      if (search1?.MediaContainer?.Metadata) {
        const items = Array.isArray(search1.MediaContainer.Metadata)
          ? search1.MediaContainer.Metadata
          : [search1.MediaContainer.Metadata];
        console.log(`  Found ${items.length} results`);
        for (const item of items) {
          console.log(`    - ${item.title}`);
        }
      }
      
      const search2 = await testEndpoint(
        `Library ${lib.key} - Search (type=2, shows)`,
        `/library/sections/${lib.key}/search?type=2&query=${encodeURIComponent(searchQuery)}`
      );
      if (search2?.MediaContainer?.Metadata) {
        const items = Array.isArray(search2.MediaContainer.Metadata)
          ? search2.MediaContainer.Metadata
          : [search2.MediaContainer.Metadata];
        console.log(`  Found ${items.length} results`);
        for (const item of items) {
          console.log(`    - ${item.title}`);
        }
      }
    }
    
    // Test 4: Global search
    const globalSearch = await testEndpoint(
      'Global Search',
      `/search?query=${encodeURIComponent(searchQuery)}`
    );
    if (globalSearch?.MediaContainer?.Metadata) {
      const items = Array.isArray(globalSearch.MediaContainer.Metadata)
        ? globalSearch.MediaContainer.Metadata
        : [globalSearch.MediaContainer.Metadata];
      console.log(`  Found ${items.length} global results`);
      for (const item of items) {
        console.log(`    - ${item.title} (${item.type})`);
      }
    }

    // Test 5: Hub search (used by Plex UI)
    const hubSearch = await testEndpoint(
      'Hub Search (Plex UI style)',
      `/hubs/search?query=${encodeURIComponent(searchQuery)}`
    );
    if (hubSearch?.MediaContainer?.Hub) {
      const hubs = Array.isArray(hubSearch.MediaContainer.Hub)
        ? hubSearch.MediaContainer.Hub
        : [hubSearch.MediaContainer.Hub];
      
      for (const hub of hubs) {
        if (hub.Metadata) {
          const items = Array.isArray(hub.Metadata) ? hub.Metadata : [hub.Metadata];
          console.log(`  ${hub.title}: ${items.length} results`);
          for (const item of items.slice(0, 3)) {
            console.log(`    - ${item.title} (${item.type})`);
          }
        }
      }
    }
  }
  
  console.log('\n' + '='.repeat(60));
  console.log('Test complete!');
}

main().catch(console.error);
